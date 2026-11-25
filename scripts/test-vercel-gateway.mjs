import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {createGateway} from '../api/gateway.mjs';

// Only the loopback HTTP transport is real. Application, storage, and runtime
// configuration are fixtures; any unexpected external fetch fails the suite.
const ORIGIN = 'https://lemrix.vercel.app';
const MAX_BODY = 4_400_000;
const ADMIN = '__Host-lemrix-admin=fixture-admin; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800';
const PASS = '__Host-lemrix-pass=fixture-pass; Path=/; Secure; HttpOnly; SameSite=Lax';
let gateway, calls, configCalls, handler, bucket;
let passed = 0;

function reset({env = {}, config = {}, loader, appHandler, withBucket = true} = {}) {
  calls = [];
  configCalls = [];
  bucket = Object.freeze({fixture:'persistent-bucket'});
  handler = appHandler || (() => Response.json({ok:true}));
  gateway = createGateway({
    env,
    bucket:withBucket ? bucket : undefined,
    configLoader:async (storage, environment) => {
      configCalls.push({storage, env:environment});
      return loader ? await loader(storage, environment) : config;
    },
    app:{
      async fetch(request, environment) {
        assert.ok(request instanceof Request, 'Application receives a native Web Request');
        const bytes = request.body ? Buffer.from(await request.clone().arrayBuffer()) : undefined;
        calls.push({request, env:environment, bytes});
        return handler(request, environment);
      },
    },
  });
}

const originalFetch = globalThis.fetch;
const outboundCalls = [];
globalThis.fetch = async (...args) => {
  outboundCalls.push(args);
  throw new Error('Unexpected outbound request from native gateway fixture');
};
const server = createServer((request, response) => gateway(request, response));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();

function call(path, {method = 'GET', headers = {}, body, chunks} = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname:'127.0.0.1', port:address.port, path, method, agent:false,
      headers:{Host:'lemrix.vercel.app', ...headers},
    }, response => {
      const buffers = [];
      response.on('data', chunk => buffers.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const data = Buffer.concat(buffers);
        resolve({status:response.statusCode, headers:response.headers, body:data,
          text:data.toString(), json:() => JSON.parse(data.toString())});
      });
    });
    request.on('error', reject);
    if (chunks) {
      for (const chunk of chunks) request.write(chunk);
      request.end();
    } else request.end(body);
  });
}

const api = path => '/api/gateway?resource=api&path=' + encodeURIComponent(path);
const post = body => ({method:'POST', headers:{Origin:ORIGIN, 'Content-Type':'application/json'}, body:JSON.stringify(body)});
function privateResponse(result) {
  for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.match(result.headers[name], /no-store/);
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
}
async function test(name, run) {
  reset();
  try { await run(); passed++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

try {
  await test('Routes only native catalogue, media and allowed API methods', async () => {
    const id = 'a'.repeat(32);
    for (const [path, method, pathname] of [
      ['/api/gateway?resource=catalogue', 'GET', '/shop/catalogue.js'],
      ['/api/gateway?resource=media&id=' + id, 'GET', '/media/' + id],
      [api('customer/session'), 'GET', '/api/customer/session'],
      [api('account'), 'GET', '/api/account'],
      [api('items'), 'GET', '/api/items'],
      [api('items'), 'POST', '/api/items'],
      [api('items/push'), 'POST', '/api/items/push'],
      [api('images'), 'POST', '/api/images'],
      [api('rewards'), 'GET', '/api/rewards'],
      [api('checkout/status'), 'POST', '/api/checkout/status'],
      [api('checkout/tracking'), 'POST', '/api/checkout/tracking'],
    ]) {
      const result = await call(path, method === 'POST' ? post({fixture:true}) : {});
      assert.equal(result.status, 200);
      assert.equal(calls.at(-1).request.url, ORIGIN + pathname);
      assert.equal(calls.at(-1).request.method, method);
      assert.equal(calls.at(-1).env.BUCKET, bucket);
      assert.equal(calls.at(-1).env.REQUIRE_STORED_CATALOGUE, true);
      assert.equal(configCalls.at(-1).storage, bucket);
      privateResponse(result);
    }
  });

  await test('Serves fresh equivalent script and JSON catalogue views from stored stock', async () => {
    const published = [
      {id:'first-light', cents:1150, quantity:2},
      {id:'preview', cents:1150, quantity:2, collection:'pre-orders'},
      {id:'unknown', cents:1150, quantity:null},
      {id:'sold', cents:1150, quantity:0},
      {id:'held', cents:1150, quantity:1, checkoutHolds:[{provider:'square', expires:Math.floor(Date.now()/1000)+600}]},
      {id:'archived', cents:1150, quantity:1, archived:true},
    ];
    const storage = {async get(key) {
      if (key === 'store/v1/catalogue.json') return {etag:'1',json:async()=>structuredClone(published)};
      return null;
    }};
    const config = {SQUARE_ACCESS_TOKEN:'fixture', SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture', SQUARE_LOCATION_ID:'fixture', SQUARE_SHIPPING_CENTS:'0'};
    const path = '/api/gateway?resource=catalogue';
    for (const [mode, env] of [['live',config], ['test',{...config,SQUARE_ENVIRONMENT:'sandbox'}], ['off',{}]]) {
      gateway = createGateway({bucket:storage,env,configLoader:async()=>({})});
      const json = await call(path, {headers:{Accept:'application/json'}});
      const script = await call(path, {headers:{Accept:'*/*'}});
      for (const response of [json,script]) {
        assert.equal(response.status,200);
        assert.equal(response.headers.vary,'Accept');
        privateResponse(response);
      }
      assert.match(json.headers['content-type'],/^application\/json/);
      assert.match(script.headers['content-type'],/^application\/javascript/);
      const rows = json.json();
      assert.deepEqual(JSON.parse(runInNewContext(script.text+'\nJSON.stringify(products)')),rows);
      assert.deepEqual(rows.map(row=>row.id),['first-light','preview','unknown','sold','held']);
      assert.ok(rows.every(row=>row.checkoutMode===mode && !('checkoutHolds' in row)));
      assert.deepEqual(rows.map(row=>row.canBuy),[mode!=='off',false,mode==='test',false,mode==='test']);
      assert.equal(rows[4].quantity,mode==='test' ? 1 : 0);
      assert.equal(rows[4].reserved,mode!=='test');
      if (mode !== 'off') {
        for (const itemId of ['archived','preview','sold']) {
          const result = await call(api('checkout'),post({
            itemId,copy:null,expectedCents:1150,attempt:crypto.randomUUID(),started:Math.floor(Date.now()/1000),
          }));
          assert.equal(result.status,409);
          assert.match(result.json().error,/unavailable/);
        }
      }
    }
  });

  await test('Rejects external, traversal, removed owner and unknown routes', async () => {
    for (const path of [
      '/api/gateway?resource=https://evil.example',
      '/api/gateway?resource=api&path=https://evil.example/',
      '/api/gateway?resource=api&path=../admin',
      '/api/gateway?resource=api&path=items%2F..%2Flogin',
      '/api/gateway?resource=api&path=%252e%252e%252fitems',
      api('owner-bridge/exchange'), api('owner/connect'), api('owner/callback'), api('unknown'),
      '/api/gateway?resource=media&id=../api/login',
      '/api/gateway?resource=media&id=' + 'a'.repeat(31),
    ]) assert.equal((await call(path)).status, 404, path);
    assert.equal(calls.length, 0);
    assert.equal(configCalls.length, 0);
    const valid = await call('/api/gateway?resource=catalogue&url=https://evil.example/&return_to=https://evil.example/');
    assert.equal(valid.status, 200);
    assert.equal(calls[0].request.url, ORIGIN + '/shop/catalogue.js', 'Unrelated queries cannot choose an upstream or reach application routing');
  });

  await test('Rejects duplicate and missing routing parameters', async () => {
    for (const path of [
      '/api/gateway', '/api/gateway?resource=api', '/api/gateway?resource=media',
      '/api/gateway?resource=catalogue&resource=api',
      '/api/gateway?resource=catalogue&%72esource=api',
      '/api/gateway?resource=api&path=account&path=items',
      '/api/gateway?resource=media&id=' + 'a'.repeat(32) + '&id=' + 'b'.repeat(32),
    ]) assert.equal((await call(path)).status, 400, path);
    assert.equal(calls.length, 0);
    assert.equal(configCalls.length, 0);
  });

  await test('Rejects invalid methods before config or application work', async () => {
    for (const [path, method] of [
      [api('login'), 'GET'], [api('account'), 'HEAD'], [api('customer/session'), 'POST'],
      [api('checkout'), 'PUT'], [api('items'), 'DELETE'], [api('items'), 'OPTIONS'],
      ['/api/gateway?resource=catalogue', 'POST'],
    ]) assert.equal((await call(path, {method, headers:{Origin:ORIGIN}})).status, 405);
    assert.equal(calls.length, 0);
    assert.equal(configCalls.length, 0);
  });

  await test('Requires exact same-origin writes and ignores spoofed forwarding', async () => {
    for (const headers of [
      {}, {Origin:'https://evil.example'}, {Origin:'null'}, {Origin:'https://lemrix-surf.vercel.app'},
      {Origin:'https://lemrix.vercel.app.evil.example', 'X-Forwarded-Host':'lemrix.vercel.app'},
      {Origin:'https://lemrix.vercel.app:443'}, {Origin:ORIGIN + '/'},
    ]) assert.equal((await call(api('login'), {method:'POST', headers, body:'{}'})).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(configCalls.length, 0);
    assert.equal((await call(api('login'), {method:'POST', headers:{Host:'lemrix-surf.vercel.app', Origin:'https://lemrix-surf.vercel.app'}, body:'{}'})).status, 200);
    assert.equal(calls[0].request.url, 'https://lemrix-surf.vercel.app/api/login');
  });

  await test('Validates the exact Host independently of forwarded headers', async () => {
    for (const host of ['', 'evil.example', 'lemrix.vercel.app.evil.example', 'lemrix.vercel.app:443', 'lemrix.vercel.app.', 'https://lemrix.vercel.app', 'lemrix.vercel.app@evil.example']) {
      assert.equal((await call('/api/gateway?resource=catalogue', {headers:{
        Host:host, 'X-Forwarded-Host':'lemrix.vercel.app', 'X-Forwarded-Proto':'https',
      }})).status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal((await call('/api/gateway?resource=catalogue', {headers:{Host:'LEMRIX.VERCEL.APP'}})).status, 200);
    assert.equal(calls[0].request.url, ORIGIN + '/shop/catalogue.js');
  });

  await test('Permits exact configured deployment hosts using their actual origin', async () => {
    for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
      reset({env:{[key]:'lemrix-fixture-123.vercel.app'}});
      assert.equal((await call(api('login'), {method:'POST', headers:{Host:'lemrix-fixture-123.vercel.app', Origin:'https://lemrix-fixture-123.vercel.app'}, body:'{}'})).status, 200);
      assert.equal(calls[0].request.url, 'https://lemrix-fixture-123.vercel.app/api/login');
      assert.equal(calls[0].request.headers.get('Origin'), 'https://lemrix-fixture-123.vercel.app');
      assert.equal((await call('/api/gateway?resource=catalogue', {headers:{Host:'lemrix-fixture-124.vercel.app'}})).status, 400);
    }
    reset({env:{VERCEL_URL:'*.vercel.app'}});
    assert.equal((await call('/api/gateway?resource=catalogue', {headers:{Host:'arbitrary.vercel.app'}})).status, 400);
    assert.equal(calls.length, 0);
  });

  await test('Allows only shop cookies and explicit request headers into the application', async () => {
    const result = await call(api('login'), {method:'POST', body:'{}', headers:{
      Origin:ORIGIN, 'Content-Type':'application/json', Authorization:'Bearer caller-token',
      'OAI-Sites-Authorization':'Bearer spoofed-token', 'oai-authenticated-user-email':'spoofed@example.com',
      'oai-authenticated-user-id':'spoofed-id', 'X-Forwarded-Host':'evil.example', 'X-Lemrix-Owner':'spoofed-owner',
      'x-square-hmacsha256-signature':'not-a-webhook', 'X-Extra':'not-allowed',
      Cookie:'session=foreign; __Host-lemrix-admin=admin; __Host-lemrix-customer=customer; __Host-lemrix-google=google; __Host-lemrix-owner=old-owner; __Host-lemrix-connect=old-bridge; __Host-lemrix-pass=pass',
    }});
    assert.equal(result.status, 200);
    assert.deepEqual(Array.from(calls[0].request.headers.keys()).sort(), ['content-type', 'cookie', 'origin']);
    assert.equal(calls[0].request.headers.get('Cookie'), '__Host-lemrix-admin=admin; __Host-lemrix-customer=customer; __Host-lemrix-google=google; __Host-lemrix-pass=pass');
    assert.equal(calls[0].request.headers.get('Origin'), ORIGIN);
    assert.equal(calls[0].bytes.toString(), '{}');
  });

  await test('Trusted Vercel client IP alone supplies internal rate-limit identity', async () => {
    reset({env:{CLIENT_IP:'env-spoof', REQUIRE_STORED_CATALOGUE:false}, config:{CLIENT_IP:'config-spoof', BUCKET:'config-spoof', REQUIRE_STORED_CATALOGUE:false, fixtureSecret:'private-config'}});
    for (const value of ['203.0.113.10', '2001:db8::10']) {
      assert.equal((await call(api('account'), {headers:{'X-Vercel-Forwarded-For':value, 'X-Forwarded-For':'198.51.100.99', 'X-Real-IP':'192.0.2.99'}})).status, 200);
      assert.equal(calls.at(-1).env.CLIENT_IP, value);
      assert.equal(calls.at(-1).env.BUCKET, bucket);
      assert.equal(calls.at(-1).env.REQUIRE_STORED_CATALOGUE, true);
      assert.equal(calls.at(-1).env.fixtureSecret, 'private-config');
      assert.equal(calls.at(-1).request.headers.get('x-vercel-forwarded-for'), null);
    }
    for (const value of ['', 'not-an-ip', '203.0.113.1, 203.0.113.2', '[2001:db8::10]', '999.0.0.1']) {
      await call(api('account'), {headers:{'X-Vercel-Forwarded-For':value, 'X-Forwarded-For':'203.0.113.10'}});
      assert.equal(calls.at(-1).env.CLIENT_IP, 'unknown');
    }
    await call(api('account'), {headers:{'X-Forwarded-For':'203.0.113.10'}});
    assert.equal(calls.at(-1).env.CLIENT_IP, 'unknown');
  });

  await test('Preserves separate secure cookies and drops unsafe or foreign cookies', async () => {
    handler = () => {
      const headers = new Headers({'Content-Type':'application/json', 'Cache-Control':'public, max-age=600', 'CDN-Cache-Control':'public, max-age=600'});
      for (const value of [ADMIN, PASS,
        'foreign=discard; Path=/; Secure; HttpOnly',
        '__Host-lemrix-owner=discard; Path=/; Secure; HttpOnly',
        '__Host-lemrix-admin=discard; Domain=example.com; Path=/; Secure; HttpOnly',
        '__Host-lemrix-customer=discard; Path=/; Secure',
        '__Host-lemrix-google=discard; Path=/sub; Secure; HttpOnly',
        '__Host-lemrix-pass=discard; Path=/; HttpOnly',
      ]) headers.append('Set-Cookie', value);
      return new Response('{}', {headers});
    };
    const result = await call(api('customer/session'));
    assert.deepEqual(result.headers['set-cookie'], [ADMIN, PASS]);
    privateResponse(result);
  });

  await test('Streams binary responses and turns HEAD into a cancelled native GET', async () => {
    const data = Buffer.from([0, 255, 254, 137, 80, 78, 71, 13, 10, 0, 127]);
    handler = () => new Response(data, {headers:{'Content-Type':'image/webp', 'Content-Disposition':'inline; filename="fixture.webp"'}});
    const path = '/api/gateway?resource=media&id=' + 'a'.repeat(32);
    const result = await call(path);
    assert.deepEqual(result.body, data);
    assert.equal(result.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.equal(result.headers['cdn-cache-control'], 'no-store');
    assert.equal(result.headers['content-type'], 'image/webp');
    assert.equal(result.headers['content-disposition'], 'inline; filename="fixture.webp"');
    let cancelled = false;
    handler = () => new Response(new ReadableStream({start(controller) {controller.enqueue(data);}, cancel() {cancelled = true;}}), {headers:{'Content-Type':'image/webp'}});
    const head = await call(path, {method:'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(calls.at(-1).request.method, 'GET');
    assert.equal(cancelled, true);
    handler = () => new Response('const products = [];', {headers:{'Content-Type':'application/javascript'}});
    assert.equal((await call('/api/gateway?resource=catalogue', {method:'HEAD'})).body.length, 0);
  });

  await test('Preserves raw webhook bytes and Square signature without browser Origin', async () => {
    const data = Buffer.from('{\n  "type": "fixture", "text": "café", "data": [1, 2]\n}\n', 'utf8');
    const signature = 'Zml4dHVyZS1zaWduYXR1cmU=';
    const result = await call(api('square/webhook'), {method:'POST', headers:{'Content-Type':'application/json', 'x-square-hmacsha256-signature':signature}, chunks:[data.subarray(0, 17), data.subarray(17)]});
    assert.equal(result.status, 200);
    assert.equal(calls[0].request.url, ORIGIN + '/api/square/webhook');
    assert.deepEqual(calls[0].bytes, data);
    assert.equal(calls[0].request.headers.get('x-square-hmacsha256-signature'), signature);
    assert.equal(calls[0].request.headers.get('Origin'), null);
    await call(api('customer/logout'), {...post({}), headers:{...post({}).headers, 'x-square-hmacsha256-signature':signature}});
    assert.equal(calls[1].request.headers.get('x-square-hmacsha256-signature'), null);
  });

  await test('Enforces declared and streamed upload limits before application work', async () => {
    const declared = await call(api('images'), {method:'POST', headers:{Origin:ORIGIN, 'Content-Length':String(MAX_BODY + 1)}, body:Buffer.alloc(1)});
    assert.equal(declared.status, 413);
    assert.equal(calls.length, 0);
    privateResponse(declared);
    const streamed = await call(api('images'), {method:'POST', headers:{Origin:ORIGIN, 'Content-Type':'image/jpeg'}, chunks:[Buffer.alloc(2_200_000), Buffer.alloc(2_200_001)]});
    assert.equal(streamed.status, 413);
    assert.equal(calls.length, 0);
    const boundary = await call(api('images'), {method:'POST', headers:{Origin:ORIGIN, 'Content-Type':'image/jpeg'}, body:Buffer.alloc(MAX_BODY)});
    assert.equal(boundary.status, 200);
    assert.equal(calls[0].bytes.length, MAX_BODY);
  });

  await test('Missing storage or failed runtime config cannot reach the application', async () => {
    reset({withBucket:false});
    const missing = await call('/api/gateway?resource=catalogue');
    assert.equal(missing.status, 503);
    assert.equal(calls.length, 0);
    assert.equal(configCalls.length, 0);
    privateResponse(missing);
    const logged = [], originalError = console.error;
    console.error = (...args) => logged.push(args);
    try {
      reset({loader:async () => {throw new Error('DO_NOT_EXPOSE_private_config_secret');}});
      const failed = await call('/api/gateway?resource=catalogue');
      assert.equal(failed.status, 503);
      assert.equal(calls.length, 0);
      assert.equal(configCalls.length, 1);
      assert.ok(!failed.text.includes('DO_NOT_EXPOSE'));
      assert.ok(!JSON.stringify(logged).includes('DO_NOT_EXPOSE'));
      privateResponse(failed);
    } finally {console.error = originalError;}
  });

  await test('Preserves application error status and Retry-After without cache leakage', async () => {
    handler = () => Response.json({error:'Try again later.'}, {status:429, headers:{'Retry-After':'60', 'Cache-Control':'public, max-age=600', 'X-Private':'not-forwarded'}});
    const result = await call(api('login'), post({}));
    assert.equal(result.status, 429);
    assert.deepEqual(result.json(), {error:'Try again later.'});
    assert.equal(result.headers['retry-after'], '60');
    assert.equal(result.headers['x-private'], undefined);
    privateResponse(result);
  });

  assert.equal(outboundCalls.length, 0, 'Native gateway must never proxy to any external backend');
  console.log('Passed ' + passed + ' native Vercel gateway checks: Web Request/context mapping, exact hosts/routes/origins, trusted IP, header/cookie isolation, raw webhooks, secure multi-cookie responses, HEAD/binary streaming, upload bounds and fail-closed storage. No external requests.');
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
