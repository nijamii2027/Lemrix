import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import worker from '../dist/server/index.js';

// Every request and persisted object in this suite is an isolated fixture.
// The only outbound integration, Stripe, is replaced with a strict mock below.
const backend = 'https://lemrix-tcg-illustrated.beefybag2.chatgpt.site';
const storefront = 'https://lemrix.vercel.app';
const legacy = 'https://lemrix-surf.vercel.app';
const records = new Map();
let revision = 0;
const env = {
  ADMIN_EMAIL:'owner@example.com', ADMIN_PASSWORD:'fixture-password', SESSION_SECRET:'fixture-session-secret',
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
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const verified = {'oai-authenticated-user-email':env.ADMIN_EMAIL};
function call(path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') {
  const requestHeaders = new Headers({Origin:storefront, ...headers});
  for (const [name, value] of Object.entries(headers)) if (value === null) requestHeaders.delete(name);
  return worker.fetch(new Request(backend + path, {
    method, headers:requestHeaders,
    body:body === undefined ? undefined : JSON.stringify(body),
  }), env);
}
function authPath({origin = storefront, state = token(), verifier = token(), challenge = digest(verifier)} = {}) {
  return {origin, state, verifier, challenge,
    path:'/api/owner-bridge/authorize?' + new URLSearchParams({origin, state, challenge})};
}
async function issue(overrides = {}) {
  const request = authPath(overrides);
  const response = await call(request.path, undefined, verified);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const callback = new URL(response.headers.get('Location'));
  assert.equal(callback.origin, request.origin);
  assert.equal(callback.pathname, '/api/owner/callback');
  assert.equal(callback.searchParams.get('state'), request.state);
  const code = callback.searchParams.get('code');
  assert.match(code, /^[a-f0-9]{64}$/);
  return {...request, code};
}
const payload = request => ({origin:request.origin, state:request.state, verifier:request.verifier, code:request.code});
const exchange = (request, changes = {}, headers = {}) => call('/api/owner-bridge/exchange', {...payload(request), ...changes}, headers);
const cookieFrom = response => response.headers.getSetCookie().find(value => value.startsWith('__Host-lemrix-owner=')).split(';')[0];
const credentials = {username:'Lemrix', password:env.ADMIN_PASSWORD};

assert.equal((await call(authPath().path)).status, 403, 'Anonymous visitors cannot issue a bridge code');
assert.equal((await call(authPath().path, undefined, {'x-lemrix-owner-email':env.ADMIN_EMAIL})).status, 403);
assert.equal((await call(authPath().path, undefined, {'oai-authenticated-user-email':'guest@example.com'})).status, 403);
for (const overrides of [{origin:'https://attacker.example'}, {origin:storefront + '/shop/'}, {state:'bad'}, {challenge:'bad'}]) {
  assert.equal((await call(authPath(overrides).path, undefined, verified)).status, 400);
}
assert.equal((await call('/api/owner-bridge/exchange', {origin:storefront, state:token(), verifier:token(), code:token()})).status, 401);

const first = await issue();
assert.equal((await exchange(first, {verifier:token()})).status, 401, 'PKCE binds the verifier');
assert.equal((await exchange(first, {state:token()})).status, 401, 'State must match');
assert.equal((await exchange(first, {origin:legacy}, {Origin:legacy})).status, 401, 'Code is bound to one storefront');
assert.equal((await exchange(first, {}, {Origin:legacy})).status, 400);
assert.equal((await exchange(first, {}, {Origin:'https://attacker.example'})).status, 403);
assert.equal((await exchange(first, {}, {Origin:null})).status, 403, 'Missing browser origin is rejected');
const accepted = await exchange(first);
assert.equal(accepted.status, 200);
const proof = cookieFrom(accepted);
const cookieHeader = accepted.headers.getSetCookie()[0];
assert.match(cookieHeader, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800$/);
assert.doesNotMatch(cookieHeader, /Domain=/i);
assert.equal((await exchange(first)).status, 401, 'Code cannot be replayed');
assert.equal((await call(authPath().path, undefined, {Cookie:proof})).status, 403, 'Proof cannot issue another proof');
const proofToken = proof.split('=')[1];
assert.ok(records.has('store/v1/owner-proofs/' + digest(proofToken)));
assert.ok(![...records.keys()].some(key => key.endsWith(proofToken)), 'Stored session keys hash the bearer token');

assert.equal((await call('/api/account', undefined, {Cookie:proof})).status, 401, 'Owner verification still needs shop password');
assert.equal((await call('/api/login', {...credentials, password:'incorrect'}, {Cookie:proof})).status, 401);
const login = await call('/api/login', credentials, {Cookie:proof});
assert.equal(login.status, 200);
const adminCookie = login.headers.getSetCookie()[0].split(';')[0];
const authenticated = proof + '; ' + adminCookie;
assert.equal((await call('/api/account', undefined, {Cookie:authenticated})).status, 200);
assert.equal((await call('/api/account', undefined, {Cookie:adminCookie})).status, 403, 'Admin session alone cannot replace owner verification');
assert.equal((await call('/api/account', undefined, {Cookie:'__Host-lemrix-owner=' + token() + '; ' + adminCookie})).status, 403);
assert.equal((await call('/api/account', undefined, {Cookie:authenticated, Origin:legacy})).status, 403, 'Proof is bound to its storefront');
assert.equal((await call('/api/login', credentials, {Cookie:proof, Origin:'https://attacker.example'})).status, 403);
assert.equal((await call('/api/login', credentials, {...verified, Origin:'https://attacker.example'})).status, 403);
assert.equal((await call('/api/rewards/join', {}, {Origin:'https://attacker.example'})).status, 403);
assert.equal((await call('/api/customer/logout', {}, {Origin:'https://attacker.example'})).status, 403);
assert.equal((await call('/api/customer/logout', {})).status, 200, 'Approved storefront writes reach backend');

const raced = await issue();
const race = await Promise.all([exchange(raced), exchange(raced)]);
assert.deepEqual(race.map(response => response.status).sort(), [200, 401], 'Atomic consume permits one simultaneous exchange');

const expired = await issue();
const expiredKey = 'store/v1/owner-bridge/' + digest(expired.code);
await env.BUCKET.put(expiredKey, JSON.stringify({...await records.get(expiredKey).json(), expires:Date.now() - 1}));
assert.equal((await exchange(expired)).status, 401);
const proofKey = 'store/v1/owner-proofs/' + digest(proofToken);
const originalProof = await records.get(proofKey).json();
await env.BUCKET.put(proofKey, JSON.stringify({...originalProof, expires:Date.now() - 1}));
assert.equal((await call('/api/account', undefined, {Cookie:authenticated})).status, 403, 'Expired proof is not an owner');
await env.BUCKET.put(proofKey, JSON.stringify(originalProof));

// A mocked Stripe call verifies that checkout returns to the validated public
// domain. No checkout is created on any external service and stock is unchanged.
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
  return Response.json({id:'cs_test_fixture123456789', status:'open', livemode:false,
    url:'https://checkout.stripe.com/c/pay/cs_test_fixture123456789'});
};
try {
  const order = {itemId:'fixture-pack', copy:null, expectedCents:850, attempt:randomUUID(), started:Math.floor(Date.now() / 1000)};
  assert.equal((await call('/api/checkout', order, {Cookie:proof})).status, 200);
  assert.equal((await call('/api/checkout', order, {Cookie:proof, Origin:'https://attacker.example'})).status, 403);
  assert.equal(stripeCalls, 1);
  assert.equal((await records.get('store/v1/catalogue.json').json())[0].quantity, 2);
} finally { globalThis.fetch = originalFetch; }

const beforeRevocation = await issue();
const logoutAll = await call('/api/logout-all', {}, {Cookie:authenticated});
assert.equal(logoutAll.status, 200);
assert.equal(logoutAll.headers.getSetCookie().length, 2);
assert.equal((await exchange(beforeRevocation)).status, 401, 'Logout-all revokes unredeemed codes');
assert.equal((await call('/api/account', undefined, {Cookie:authenticated})).status, 403, 'Logout-all revokes owner proof');
const otherProof = cookieFrom(race.find(response => response.status === 200));
assert.equal((await call('/api/login', credentials, {Cookie:otherProof})).status, 403, 'Generation revokes all other proofs');

const finalProof = cookieFrom(await exchange(await issue()));
const finalLogin = await call('/api/login', credentials, {Cookie:finalProof});
const finalAdmin = finalLogin.headers.getSetCookie()[0].split(';')[0];
const finalLogout = await call('/api/logout', {}, {Cookie:finalProof + '; ' + finalAdmin});
assert.equal(finalLogout.status, 200);
assert.equal(finalLogout.headers.getSetCookie().length, 2);
assert.equal((await call('/api/login', credentials, {Cookie:finalProof})).status, 403, 'Logout revokes the current bridge proof');

console.log('Verified Vercel origin allowlist, owner SSO bridge, PKCE/state/audience binding, atomic single-use codes, expiry/revocation, password/session requirements, CSRF rejection and Stripe public return URLs.');
