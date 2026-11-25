import assert from 'node:assert/strict';
import {pbkdf2Sync, randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

// All records and integrations in this suite are isolated fixtures.
const storefront = 'https://lemrix.vercel.app';
const password = 'fixture-native-password';
const salt = Buffer.from('native-auth-fixture-salt');
const passwordHash = 'pbkdf2-sha256$600000$' + salt.toString('hex') + '$' + pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex');
const credentials = {username:'Lemrix', password};
const forgedIdentity = {'oai-authenticated-user-email':'owner@example.com', 'x-lemrix-owner-email':'owner@example.com'};
const sessionPrefix = 'store/v2/admin-sessions/';
const ratePrefix = 'store/v2/admin-login-limits/';

function fixture(ip = '198.51.100.10') {
  const records = new Map();
  let revision = 0;
  const env = {
    ADMIN_PASSWORD_HASH:passwordHash, SESSION_SECRET:'fixture-native-session-secret', CLIENT_IP:ip,
    BUCKET:{
      async get(key) { return records.get(key) || null; },
      async head(key) { return records.get(key) || null; },
      async delete(key) { records.delete(key); },
      async put(key, value, options = {}) {
        const previous = records.get(key);
        const match = options.onlyIf?.get('If-Match');
        if (match && (!previous || match !== '"' + previous.etag + '"')) return null;
        if (options.onlyIf?.get('If-None-Match') === '*' && previous) return null;
        const entry = {...options, etag:String(++revision), json:async () => JSON.parse(value)};
        records.set(key, entry);
        return entry;
      },
    },
  };
  function call(path, body, headers = {}, options = {}) {
    const requestHeaders = new Headers({Origin:storefront});
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name);
      else requestHeaders.set(name, value);
    }
    return (options.worker || worker).fetch(new Request(storefront + path, {
      method:options.method || (body === undefined ? 'GET' : 'POST'), headers:requestHeaders,
      body:body === undefined ? undefined : JSON.stringify(body),
    }), options.env || env);
  }
  return {env, records, call};
}

const {env, records, call} = fixture();
const cookieFrom = response => response.headers.getSetCookie().find(value => value.startsWith('__Host-lemrix-admin=')).split(';')[0];
const cookieId = cookie => cookie.split('=')[1].split('.')[0];

// Unknown and removed routes disclose no credential or storage configuration.
for (const path of ['/api/unknown', '/api/owner-bridge/authorize', '/api/owner-bridge/exchange', '/api/owner/connect', '/api/owner/callback']) {
  assert.equal((await call(path, undefined, forgedIdentity, {env:{}})).status, 404);
}
assert.equal((await call('/api/login')).status, 405);
for (const hash of [undefined, '', 'pbkdf2-sha256$1$abcd$abcd', passwordHash.replace('$600000$', '$1000$')]) {
  const unconfigured = {...env, ADMIN_PASSWORD_HASH:hash, ADMIN_PASSWORD:password};
  assert.equal((await call('/api/login', credentials, forgedIdentity, {env:unconfigured})).status, 503, 'No plaintext password fallback is allowed');
}
assert.equal(records.size, 0);

assert.equal((await call('/api/account', undefined, forgedIdentity)).status, 401);
assert.equal((await call('/api/items', undefined, forgedIdentity)).status, 401);
assert.equal((await call('/api/items/push', {changes:[]}, forgedIdentity)).status, 401);
assert.equal((await call('/api/account', undefined, {Cookie:'__Host-lemrix-owner=' + 'a'.repeat(64), ...forgedIdentity})).status, 401);
assert.equal((await call('/api/login', {...credentials, password:'incorrect'}, forgedIdentity)).status, 401);
assert.equal((await call('/api/login', {...credentials, username:'someone-else'})).status, 401);
assert.equal((await call('/api/login', {username:'Lemrix'})).status, 401);

const login = await call('/api/login', credentials);
assert.equal(login.status, 200, 'Username and password work without an external identity');
const firstCookie = cookieFrom(login);
assert.match(firstCookie, /^__Host-lemrix-admin=[a-f0-9]{64}\.[a-f0-9]{64}$/);
assert.match(login.headers.getSetCookie()[0], /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800$/);
assert.doesNotMatch(login.headers.getSetCookie()[0], /Domain=|Partitioned|SameSite=None/i);
assert.equal((await call('/api/account', undefined, {Cookie:firstCookie})).status, 200);
assert.equal((await (await call('/api/account', undefined, {Cookie:firstCookie})).json()).username, 'Lemrix');
assert.equal((await call('/api/account', undefined, {Cookie:firstCookie.slice(0, -1) + (firstCookie.endsWith('0') ? '1' : '0'), ...forgedIdentity})).status, 401);
assert.equal((await call('/api/account', undefined, {Cookie:'__Host-lemrix-admin=' + 'a'.repeat(32) + '.' + 'b'.repeat(64), ...forgedIdentity})).status, 401, 'Old session tokens cannot authorize');

const sessionKey = sessionPrefix + cookieId(firstCookie);
const session = records.get(sessionKey);
await env.BUCKET.put(sessionKey, '1', {customMetadata:{...session.customMetadata, expires:String(Date.now() - 1)}});
assert.equal((await call('/api/account', undefined, {Cookie:firstCookie})).status, 401, 'Server expiry is enforced');
await env.BUCKET.put(sessionKey, '1', {customMetadata:session.customMetadata});
const changedHash = passwordHash.slice(0, -1) + (passwordHash.endsWith('0') ? '1' : '0');
assert.equal((await call('/api/account', undefined, {Cookie:firstCookie}, {env:{...env, ADMIN_PASSWORD_HASH:changedHash}})).status, 401, 'Password changes invalidate old signatures');
const renewed = await call('/api/login', credentials, {Cookie:firstCookie});
assert.equal(renewed.status, 200);
const renewedCookie = cookieFrom(renewed);
assert.notEqual(renewedCookie, firstCookie);
assert.equal((await call('/api/account', undefined, {Cookie:firstCookie})).status, 401, 'Login rotates the previous session');
assert.equal((await call('/api/account', undefined, {Cookie:renewedCookie})).status, 200);

for (const origin of ['https://attacker.example', 'https://lemrix-surf.vercel.app', 'null', null]) {
  const headers = {Cookie:renewedCookie, Origin:origin, ...forgedIdentity};
  assert.equal((await call('/api/login', credentials, headers)).status, 403);
  assert.equal((await call('/api/logout', {}, headers)).status, 403);
  assert.equal((await call('/api/items/push', {changes:[]}, headers)).status, 403);
  assert.equal((await call('/api/rewards/join', {}, headers)).status, 403);
  assert.equal((await call('/api/customer/logout', {}, headers)).status, 403);
}
assert.equal((await call('/api/customer/logout', {})).status, 200);
const secondCookie = cookieFrom(await call('/api/login', credentials));
assert.equal((await call('/api/logout', {}, {Cookie:renewedCookie})).status, 200);
assert.equal((await call('/api/account', undefined, {Cookie:renewedCookie})).status, 401);
assert.equal((await call('/api/account', undefined, {Cookie:secondCookie})).status, 200, 'Ordinary logout leaves another session alone');
const thirdCookie = cookieFrom(await call('/api/login', credentials));
const logoutAll = await call('/api/logout-all', {}, {Cookie:secondCookie});
assert.equal(logoutAll.status, 200);
assert.equal(logoutAll.headers.getSetCookie().length, 1);
assert.match(logoutAll.headers.getSetCookie()[0], /Max-Age=0$/);
for (const Cookie of [secondCookie, thirdCookie]) assert.equal((await call('/api/account', undefined, {Cookie})).status, 401);

env.REQUIRE_STORED_CATALOGUE = true;
const missing = await call('/shop/catalogue.js');
assert.equal(missing.status, 503, 'Production cannot fall back to seed stock');
assert.match((await missing.json()).error, /live inventory.*unavailable/);
await env.BUCKET.put('store/v1/catalogue.json', JSON.stringify([]));
assert.deepEqual(Array.from(runInNewContext((await (await call('/shop/catalogue.js')).text()) + ';products')), [], 'An empty real catalogue remains empty');

// Test checkout uses the native admin session, and return URLs use the exact
// current origin. This mock cannot create external orders or take payments.
const finalCookie = cookieFrom(await call('/api/login', credentials));
env.STRIPE_SECRET_KEY = 'sk_test_fixture';
await env.BUCKET.put('store/v1/catalogue.json', JSON.stringify([
  {id:'fixture-pack', name:'Fixture pack', category:'Packs', cents:850, quantity:2, revision:1},
]));
const originalFetch = globalThis.fetch;
let stripeCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  stripeCalls++;
  assert.match(options.body.get('success_url'), /^https:\/\/lemrix\.vercel\.app\/shop\/\?checkout=/);
  assert.match(options.body.get('cancel_url'), /^https:\/\/lemrix\.vercel\.app\/shop\/\?checkout=cancelled/);
  assert.equal(options.body.get('allowed_payment_method_types[0]'), 'card');
  assert.equal(options.body.has('payment_method_types[0]'), false);
  return Response.json({id:'cs_test_fixture123456789', status:'open', livemode:false,
    url:'https://checkout.stripe.com/c/pay/cs_test_fixture123456789'});
};
try {
  const order = {itemId:'fixture-pack', copy:null, expectedCents:850, attempt:randomUUID(), started:Math.floor(Date.now() / 1000)};
  assert.equal((await call('/api/checkout', order, forgedIdentity)).status, 403);
  assert.equal((await call('/api/checkout', order, {Cookie:finalCookie})).status, 200);
  assert.equal((await call('/api/checkout', order, {Cookie:finalCookie, Origin:'https://lemrix-surf.vercel.app'})).status, 403);
  assert.equal(stripeCalls, 1);
  assert.equal((await records.get('store/v1/catalogue.json').json())[0].quantity, 2);
} finally { globalThis.fetch = originalFetch; }

// Concurrent requests race on the persistent store. Exactly fifteen may reach
// password validation; restarting the module cannot reset that budget.
const limited = fixture('203.0.113.8');
const invalid = {username:'Lemrix', password:''};
const raced = await Promise.all(Array.from({length:20}, () => limited.call('/api/login', invalid)));
assert.equal(raced.filter(response => response.status === 401).length, 15);
assert.equal(raced.filter(response => response.status === 429).length, 5);
assert.ok(![...limited.records.keys()].some(key => key.startsWith(sessionPrefix)));
const limitedResponse = await limited.call('/api/login', credentials);
assert.equal(limitedResponse.status, 429, 'Correct credentials do not bypass an exhausted limit');
assert.ok(Number(limitedResponse.headers.get('Retry-After')) > 0 && Number(limitedResponse.headers.get('Retry-After')) <= 900);
const {default:reloadedWorker} = await import('../dist/server/index.js?native-auth-reload');
assert.equal((await limited.call('/api/login', invalid, {}, {worker:reloadedWorker, env:{...limited.env}})).status, 429);
assert.equal((await limited.call('/api/login', invalid, {'x-forwarded-for':'203.0.113.99'})).status, 429, 'Caller IP headers do not choose rate-limit keys');
assert.equal((await limited.call('/api/login', invalid, {}, {env:{...limited.env, CLIENT_IP:'203.0.113.9'}})).status, 401);
assert.ok(![...limited.records.keys()].some(key => key.includes('203.0.113.')));
const ipKeys = [...limited.records.keys()].filter(key => key.startsWith(ratePrefix) && !key.endsWith('/global'));
assert.equal(ipKeys.length, 2);
for (const key of ipKeys) {
  const previous = await limited.records.get(key).json();
  await limited.env.BUCKET.put(key, JSON.stringify({...previous, expires:Date.now() - 1}));
}
assert.equal((await limited.call('/api/login', invalid)).status, 401, 'Expired windows permit attempts again');
await limited.env.BUCKET.put(ratePrefix + 'global', JSON.stringify({attempts:300, expires:Date.now() + 60000}));
assert.equal((await limited.call('/api/login', invalid, {}, {env:{...limited.env, CLIENT_IP:'203.0.113.10'}})).status, 429);

const unknown = fixture();
delete unknown.env.CLIENT_IP;
for (let index = 0; index < 15; index++) assert.equal((await unknown.call('/api/login', invalid)).status, 401);
assert.equal((await unknown.call('/api/login', invalid, {}, {env:{...unknown.env, CLIENT_IP:''}})).status, 429, 'Missing client IP uses a stable limit bucket');

const contended = fixture();
const put = contended.env.BUCKET.put;
contended.env.BUCKET.put = async (key, ...rest) => key.startsWith(ratePrefix) ? null : put(key, ...rest);
assert.equal((await contended.call('/api/login', credentials)).status, 503, 'Unavailable atomic rate storage fails closed');
assert.equal(contended.records.size, 0);

console.log('Verified native password-only admin login, signed secure sessions, forged-identity rejection, expiry/rotation/logout-all, exact-origin CSRF, persistent concurrent rate limits, stored-only production catalogue and same-origin Stripe returns.');
