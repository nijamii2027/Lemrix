import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createGateway } from '../api/gateway.mjs';

// Only the local HTTP transport is real. Every upstream response is a fixture;
// these tests cannot contact the store, authenticate a person or create orders.
const ORIGIN = 'https://lemrix.vercel.app';
const BACKEND = 'https://lemrix-tcg-illustrated.beefybag2.chatgpt.site';
const TOKEN = 'fixture-service-token';
const NOW = 1_800_000_000_000;
const OWNER = '__Host-lemrix-owner=fixture-owner; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600';
const PASS = '__Host-lemrix-pass=fixture-pass; Path=/; Secure; HttpOnly; SameSite=Lax';
let gateway, calls, upstream;
let passed = 0;

function reset({ env = {}, fetcher, now = () => NOW } = {}) {
  calls = [];
  upstream = fetcher || (() => Response.json({ ok: true }));
  gateway = createGateway({
    env: { LEMRIX_BACKEND_TOKEN: TOKEN, ...env }, now,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.equal(new URL(url).origin, BACKEND, 'Gateway must use its fixed backend origin');
      assert.equal(options.redirect, 'manual', 'Upstream redirects must never be followed');
      assert.ok(options.signal instanceof AbortSignal);
      return upstream(url, options);
    },
  });
}

const server = createServer((request, response) => gateway(request, response));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();

function call(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port: address.port, path, method,
      headers: { Host: 'lemrix.vercel.app', ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: response.statusCode, headers: response.headers, body: data,
          text: data.toString(), json: () => JSON.parse(data.toString()) });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

const api = path => '/api/gateway?resource=api&path=' + encodeURIComponent(path);
const post = body => ({ method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function privateResponse(result) {
  for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) {
    assert.match(result.headers[name], /no-store/);
  }
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
}

async function test(name, run) {
  reset();
  try { await run(); passed++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

function proofCookie(proof) {
  return '__Host-lemrix-connect=' + Buffer.from(JSON.stringify(proof)).toString('base64url');
}
const proof = () => ({ state: '1'.repeat(64), verifier: '2'.repeat(64), origin: ORIGIN, expires: NOW + 600_000 });
const code = '3'.repeat(64);
const callback = (state = proof().state, extra = '') => api('owner/callback') + '&state=' + state + '&code=' + code + extra;

try {
  await test('Routes catalogue, media, permitted API paths and methods', async () => {
    const id = 'a'.repeat(32);
    for (const [path, method, destination] of [
      ['/api/gateway?resource=catalogue', 'GET', '/shop/catalogue.js'],
      ['/api/gateway?resource=media&id=' + id, 'GET', '/media/' + id],
      [api('customer/session'), 'GET', '/api/customer/session'],
      [api('items'), 'GET', '/api/items'],
      [api('items'), 'POST', '/api/items'],
      [api('items/push'), 'POST', '/api/items/push'],
      [api('rewards/art/hill-club'), 'GET', '/api/rewards/art/hill-club'],
      [api('checkout/status'), 'POST', '/api/checkout/status'],
    ]) {
      const result = await call(path, method === 'POST' ? post({ fixture: true }) : {});
      assert.equal(result.status, 200);
      assert.equal(calls.at(-1).url, BACKEND + destination);
      assert.equal(calls.at(-1).options.method, method);
      privateResponse(result);
    }
  });

  await test('Rejects unknown, traversal and arbitrary proxy routes', async () => {
    for (const path of [
      '/api/gateway?resource=https://evil.example',
      '/api/gateway?resource=api&path=https://evil.example/',
      '/api/gateway?resource=api&path=../admin',
      '/api/gateway?resource=api&path=items%2F..%2Flogin',
      '/api/gateway?resource=api&path=owner-bridge/exchange',
      '/api/gateway?resource=api&path=unknown',
      '/api/gateway?resource=media&id=../api/login',
      '/api/gateway?resource=media&id=' + 'a'.repeat(31),
    ]) assert.equal((await call(path)).status, 404, path);
    assert.equal(calls.length, 0);
    const valid = await call('/api/gateway?resource=catalogue&url=https://evil.example/');
    assert.equal(valid.status, 200);
    assert.equal(calls[0].url, BACKEND + '/shop/catalogue.js');
  });

  await test('Rejects duplicate or missing routing parameters', async () => {
    for (const path of [
      '/api/gateway', '/api/gateway?resource=api', '/api/gateway?resource=media',
      '/api/gateway?resource=catalogue&resource=api',
      '/api/gateway?resource=api&path=account&path=items',
      '/api/gateway?resource=media&id=' + 'a'.repeat(32) + '&id=' + 'b'.repeat(32),
    ]) assert.equal((await call(path)).status, 400, path);
    assert.equal(calls.length, 0);
  });

  await test('Rejects incorrect methods before upstream requests', async () => {
    for (const [path, method] of [
      [api('login'), 'GET'], [api('customer/session'), 'POST'],
      [api('checkout'), 'PUT'], ['/api/gateway?resource=catalogue', 'POST'],
    ]) assert.equal((await call(path, { method, headers: { Origin: ORIGIN } })).status, 405);
    assert.equal(calls.length, 0);
  });

  await test('Requires same-origin writes and ignores spoofed forwarded origins', async () => {
    for (const headers of [
      {}, { Origin: 'https://evil.example' }, { Origin: 'null' },
      { Origin: 'https://lemrix.vercel.app.evil.example', 'X-Forwarded-Host': 'lemrix.vercel.app' },
      { Origin: 'https://lemrix.vercel.app:443' },
    ]) {
      assert.equal((await call(api('login'), { method: 'POST', headers, body: '{}' })).status, 403);
    }
    assert.equal(calls.length, 0);
  });

  await test('Rejects unknown hosts despite trusted-looking forwarded headers', async () => {
    for (const host of ['evil.example', 'lemrix.vercel.app.evil.example', 'lemrix.vercel.app:443']) {
      const result = await call('/api/gateway?resource=catalogue', { headers: {
        Host: host, 'X-Forwarded-Host': 'lemrix.vercel.app', 'X-Forwarded-Proto': 'https',
      } });
      assert.equal(result.status, 400);
    }
    assert.equal(calls.length, 0);
  });

  await test('Permits only configured preview hosts and uses canonical public origin', async () => {
    reset({ env: { VERCEL_URL: 'lemrix-fixture-123.vercel.app' } });
    assert.equal((await call('/api/gateway?resource=catalogue', { headers: { Host: 'lemrix-fixture-123.vercel.app' } })).status, 200);
    assert.equal(calls[0].options.headers.get('Origin'), ORIGIN);
    assert.equal((await call('/api/gateway?resource=catalogue', { headers: { Host: 'lemrix-fixture-124.vercel.app' } })).status, 400);
    reset({ env: { VERCEL_URL: '*.vercel.app' } });
    assert.equal((await call('/api/gateway?resource=catalogue', { headers: { Host: 'arbitrary.vercel.app' } })).status, 400);
  });

  await test('Strips caller identities, authorization, proxy headers and unrelated cookies', async () => {
    const result = await call(api('account'), { headers: {
      Authorization: 'Bearer caller-token', 'OAI-Sites-Authorization': 'Bearer spoofed-token',
      'oai-authenticated-user-email': 'spoofed@example.com', 'oai-authenticated-user-id': 'spoofed-id',
      'X-Forwarded-Host': 'evil.example', 'X-Lemrix-Owner': 'spoofed-owner',
      Cookie: 'cf_clearance=cf; session=foreign; __Host-lemrix-admin=admin; __Host-lemrix-customer=customer; __Host-lemrix-connect=bridge; __Host-lemrix-pass=pass',
    } });
    assert.equal(result.status, 200);
    const headers = calls[0].options.headers;
    assert.equal(headers.get('OAI-Sites-Authorization'), 'Bearer ' + TOKEN);
    for (const key of ['Authorization', 'oai-authenticated-user-email', 'oai-authenticated-user-id', 'X-Forwarded-Host', 'X-Lemrix-Owner']) assert.equal(headers.get(key), null);
    assert.equal(headers.get('Cookie'), '__Host-lemrix-admin=admin; __Host-lemrix-customer=customer; __Host-lemrix-pass=pass');
    assert.equal(headers.get('Origin'), ORIGIN);
  });

  await test('Preserves separate valid Set-Cookie headers and filters foreign cookies', async () => {
    upstream = () => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' });
      for (const cookie of [OWNER, PASS,
        'cf_clearance=foreign; Path=/; Secure; HttpOnly',
        '__Host-lemrix-admin=foreign; Domain=chatgpt.site; Path=/; Secure; HttpOnly',
        '__Host-lemrix-customer=unsafe; Path=/; Secure',
        '__Host-lemrix-google=unsafe; Path=/sub; Secure; HttpOnly',
        '__Host-lemrix-pass=unsafe; Path=/; HttpOnly',
      ]) headers.append('Set-Cookie', cookie);
      return new Response('{}', { headers });
    };
    const result = await call(api('customer/session'));
    assert.deepEqual(result.headers['set-cookie'], [OWNER, PASS]);
    privateResponse(result);
  });

  await test('Never follows or exposes upstream redirects', async () => {
    upstream = () => new Response(null, { status: 302, headers: { Location: BACKEND + '/shop/', 'Set-Cookie': OWNER } });
    const result = await call('/api/gateway?resource=catalogue');
    assert.equal(result.status, 502);
    assert.equal(calls.length, 1);
    assert.equal(result.headers.location, undefined);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.ok(!result.text.includes(BACKEND));
  });

  await test('Missing service token fails closed without upstream requests', async () => {
    reset({ env: { LEMRIX_BACKEND_TOKEN: undefined } });
    const result = await call('/api/gateway?resource=catalogue');
    assert.equal(result.status, 503);
    assert.equal(calls.length, 0);
    privateResponse(result);
  });

  await test('Streams binary media exactly and handles HEAD without returning a body', async () => {
    const data = Buffer.from([0, 255, 254, 137, 80, 78, 71, 13, 10, 0, 127]);
    upstream = () => new Response(data, { headers: { 'Content-Type': 'image/webp', 'Content-Disposition': 'inline; filename="fixture.webp"' } });
    const path = '/api/gateway?resource=media&id=' + 'a'.repeat(32);
    const result = await call(path);
    assert.deepEqual(result.body, data);
    assert.equal(result.headers['content-type'], 'image/webp');
    assert.equal(result.headers['content-disposition'], 'inline; filename="fixture.webp"');
    const head = await call(path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(calls.at(-1).options.method, 'GET');
  });

  await test('Preserves raw Stripe webhook bytes and signature without an Origin', async () => {
    const body = Buffer.from('{\n  "type": "fixture", "text": "café", "data": [1, 2]\n}\n', 'utf8');
    const signature = 't=1800000000,v1=fixture-signature';
    const result = await call(api('stripe/webhook'), { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Stripe-Signature': signature,
    }, body });
    assert.equal(result.status, 200);
    assert.equal(calls[0].url, BACKEND + '/api/stripe/webhook');
    assert.deepEqual(calls[0].options.body, body);
    assert.equal(calls[0].options.headers.get('Stripe-Signature'), signature);
    await call(api('customer/logout'), { ...post({}), headers: { ...post({}).headers, 'Stripe-Signature': signature } });
    assert.equal(calls[1].options.headers.get('Stripe-Signature'), null);
  });

  await test('Preserves upstream error status without leaking service credentials', async () => {
    upstream = () => Response.json({ error: 'Fixture sign-in required' }, { status: 401 });
    const result = await call(api('account'));
    assert.equal(result.status, 401);
    assert.deepEqual(result.json(), { error: 'Fixture sign-in required' });
    assert.ok(!result.text.includes(TOKEN));
    privateResponse(result);
  });

  await test('Owner connect binds state, PKCE and origin to a secure transient cookie', async () => {
    const result = await call(api('owner/connect') + '&return_to=https://evil.example/');
    assert.equal(result.status, 303);
    assert.equal(calls.length, 0);
    const signin = new URL(result.headers.location);
    assert.equal(signin.origin, BACKEND);
    assert.equal(signin.pathname, '/signin-with-chatgpt');
    const authorize = new URL(signin.searchParams.get('return_to'), BACKEND);
    assert.equal(authorize.origin, BACKEND);
    assert.equal(authorize.pathname, '/api/owner-bridge/authorize');
    assert.equal(authorize.searchParams.get('origin'), ORIGIN);
    const [cookie] = result.headers['set-cookie'];
    assert.match(cookie, /^__Host-lemrix-connect=/);
    assert.match(cookie, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
    const stored = JSON.parse(Buffer.from(cookie.split(';')[0].split('=')[1], 'base64url').toString());
    assert.match(stored.state, /^[a-f0-9]{64}$/);
    assert.match(stored.verifier, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.state, stored.verifier);
    assert.equal(stored.origin, ORIGIN);
    assert.equal(stored.expires, NOW + 600_000);
    assert.equal(authorize.searchParams.get('state'), stored.state);
    assert.equal(authorize.searchParams.get('challenge'), createHash('sha256').update(stored.verifier).digest('hex'));
    assert.ok(!result.headers.location.includes(stored.verifier));
    privateResponse(result);
  });

  await test('Owner verification is restricted to stable public origins', async () => {
    reset({ env: { VERCEL_URL: 'lemrix-fixture.vercel.app' } });
    for (const path of [api('owner/connect'), callback()]) {
      const result = await call(path, { headers: { Host: 'lemrix-fixture.vercel.app', Cookie: proofCookie(proof()) } });
      assert.equal(result.status, 400);
    }
    assert.equal(calls.length, 0);
  });

  await test('Owner callback exchanges matching proof, sets owner cookie and returns locally', async () => {
    upstream = (url, options) => {
      assert.equal(url, BACKEND + '/api/owner-bridge/exchange');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      assert.equal(options.headers.get('OAI-Sites-Authorization'), 'Bearer ' + TOKEN);
      assert.equal(options.headers.get('Cookie'), null, 'Temporary PKCE cookie stays on Vercel');
      assert.deepEqual(JSON.parse(options.body), { code, verifier: proof().verifier, origin: ORIGIN, state: proof().state });
      return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': OWNER } });
    };
    const result = await call(callback(), { headers: { Cookie: proofCookie(proof()) } });
    assert.equal(result.status, 303);
    assert.equal(result.headers.location, '/shop/#account');
    assert.deepEqual(result.headers['set-cookie'], [OWNER, '__Host-lemrix-connect=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
    assert.equal(calls.length, 1);
    privateResponse(result);
  });

  await test('Owner callback rejects missing, malformed and duplicate bridge cookies', async () => {
    for (const cookie of ['', '__Host-lemrix-connect=not-json', proofCookie(proof()) + '; ' + proofCookie(proof())]) {
      assert.equal((await call(callback(), { headers: { Cookie: cookie } })).status, 400);
    }
    assert.equal(calls.length, 0);
  });

  await test('Owner callback rejects state mismatch, expiration and tampered origin', async () => {
    const cases = [
      [callback('4'.repeat(64)), proof()],
      [callback(), { ...proof(), expires: NOW }],
      [callback(), { ...proof(), expires: NOW - 1 }],
      [callback(), { ...proof(), expires: NOW + 600_001 }],
      [callback(), { ...proof(), origin: 'https://evil.example' }],
      [callback(), { ...proof(), verifier: 'short' }],
      [callback(), { ...proof(), state: 'short' }],
    ];
    for (const [path, saved] of cases) assert.equal((await call(path, { headers: { Cookie: proofCookie(saved) } })).status, 400);
    assert.equal(calls.length, 0);
  });

  await test('Owner callback rejects duplicate or malformed callback parameters', async () => {
    for (const path of [
      callback() + '&state=' + proof().state, callback() + '&code=' + code,
      callback('invalid'), api('owner/callback') + '&state=' + proof().state,
    ]) assert.equal((await call(path, { headers: { Cookie: proofCookie(proof()) } })).status, 400);
    assert.equal(calls.length, 0);
  });

  await test('Owner callback requires a valid owner cookie from a successful exchange', async () => {
    for (const fixture of [
      () => Response.json({ error: 'Invalid grant' }, { status: 401 }),
      () => new Response('{}', { headers: { 'Set-Cookie': PASS } }),
      () => new Response(null, { status: 302, headers: { Location: BACKEND + '/shop/', 'Set-Cookie': OWNER } }),
      () => new Response('{}', { headers: { 'Set-Cookie': OWNER + '; Domain=chatgpt.site' } }),
    ]) {
      upstream = fixture;
      const result = await call(callback(), { headers: { Cookie: proofCookie(proof()) } });
      assert.equal(result.status, 401);
      assert.equal(result.headers.location, undefined);
      assert.equal(result.headers['set-cookie'], undefined);
    }
  });

  console.log(`Passed ${passed} Vercel gateway checks: fixed routing, CSRF and host checks, cookie and identity isolation, raw webhook forwarding, binary media, and owner PKCE/state lifecycle. All upstream traffic mocked.`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
