// Temporary endpoint tests; remove this script with api/migrate.mjs after cutover.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { createMigrationHandler } from '../api/migrate.mjs';
import { decryptRuntimeConfig, runtimeConfigPath } from '../lib/runtime-config.mjs';

const password = 'fixture-owner-passphrase';
const key = '11'.repeat(32), migrationKey = '22'.repeat(32);
const values = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_SHIPPING_RATE: 'shr_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' };

function bucketFixture() {
  const records = new Map();
  let revision = 0;
  const bucket = {
    async get(key) {
      const record = records.get(key);
      if (!record) return null;
      return { etag: record.etag, httpMetadata: record.httpMetadata, customMetadata: record.customMetadata, size: record.bytes.length,
        json: async () => JSON.parse(record.bytes.toString('utf8')), text: async () => record.bytes.toString('utf8'),
        arrayBuffer: async () => Uint8Array.from(record.bytes).buffer };
    },
    async head(key) { return this.get(key); },
    async put(key, value, options = {}) {
      const previous = records.get(key);
      if (options.onlyIf?.get('if-none-match') === '*' && previous) return null;
      if (options.onlyIf?.has('if-match') && options.onlyIf.get('if-match') !== (previous ? '"' + previous.etag + '"' : '')) return null;
      const record = { bytes: Buffer.from(value), etag: String(++revision), httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} };
      records.set(key, record);
      return { etag: record.etag };
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key); },
  };
  return { bucket, records };
}

const { bucket, records } = bucketFixture();
const env = {
  LEMRIX_MIGRATION_TOKEN: 'fixture-migration-token-'.repeat(3), LEMRIX_MIGRATION_UNTIL: new Date(Date.now() + 3600000).toISOString(),
  LEMRIX_MIGRATION_SOURCE: 'https://lemrix-tcg-illustrated.beefybag2.chatgpt.site', LEMRIX_MIGRATION_KEY: migrationKey,
  LEMRIX_CONFIG_KEY: key, LEMRIX_BACKEND_TOKEN: 'fixture-service-token', SESSION_SECRET: 'fixture-native-session-secret',
};
const catalogue = Buffer.from('[ { "id":"real", "quantity":2, "revision":7, "checkoutHolds":[{"id":"pending"}] } ]');
const imageKey = 'store/v1/images/' + 'a'.repeat(32);
const sourceRecords = new Map([
  ['store/v1/catalogue.json', { bytes: catalogue, httpMetadata: { contentType: 'application/json' } }],
  [imageKey, { bytes: Buffer.from([0, 255, 128, 7]), httpMetadata: { contentType: 'image/png' }, customMetadata: { fixture: 'preserved' } }],
  ['store/v1/customers/profiles/123', { bytes: Buffer.from('{"id":"customer"}') }],
  ['store/v1/sessions/old', { bytes: Buffer.from('old-secret') }],
  ['store/v1/admin-generation', { bytes: Buffer.from('old-generation') }],
  ['store/v1/owner-proofs/old', { bytes: Buffer.from('old-proof') }],
  ['store/v2/reward-art/hill-club', { bytes: Buffer.from([0, 12, 34, 56]), httpMetadata: { contentType: 'image/webp' } }],
]);
let frozen = false, retired = false, sourceCalls = 0;
function sourceEnvelope(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(migrationKey, 'hex'), iv);
  cipher.setAAD(Buffer.from('lemrix-migration-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
  return Response.json({ v: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') });
}
async function sourceFetch(url, options) {
  sourceCalls++;
  assert.equal(url, env.LEMRIX_MIGRATION_SOURCE + '/api/migration');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers['X-Lemrix-Migration'], env.LEMRIX_MIGRATION_TOKEN);
  assert.equal(options.headers['OAI-Sites-Authorization'], 'Bearer fixture-service-token');
  assert.equal(JSON.stringify(options.headers).includes(migrationKey), false);
  const body = JSON.parse(options.body);
  if (body.action === 'config') return sourceEnvelope({ values: { ADMIN_PASSWORD: password, ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'ADMIN_PASSWORD_HASH')) } });
  if (['status', 'freeze', 'retire', 'resume'].includes(body.action)) {
    if (body.action !== 'status') { frozen = body.action !== 'resume'; retired = body.action === 'retire'; }
    return sourceEnvelope({ frozen, retired, updatedAt: '2026-11-25T12:00:00.000Z', secretFieldMustNotLeak: password });
  }
  if (body.action === 'list') {
    const keys = [...sourceRecords.keys()];
    const start = body.cursor ? Number(body.cursor) : 0;
    const selected = keys.slice(start, start + body.limit);
    return sourceEnvelope({ objects: selected.map(key => ({ key, size: sourceRecords.get(key).bytes.length, etag: 'source-etag' })), truncated: start + body.limit < keys.length,
      ...(start + body.limit < keys.length ? { cursor: String(start + body.limit) } : {}) });
  }
  if (body.action === 'get') {
    const record = sourceRecords.get(body.key);
    return sourceEnvelope(record ? { key: body.key, body: record.bytes.toString('base64'), size: record.bytes.length, httpMetadata: record.httpMetadata || {}, customMetadata: record.customMetadata || {}, etag: 'source-etag' } : { key: body.key, missing: true });
  }
  assert.fail('Unexpected source action');
}

const handler = createMigrationHandler({ env, createBucket: () => bucket, fetch: sourceFetch });
async function invoke(body, { handler: selected = handler, method = 'POST', token = env.LEMRIX_MIGRATION_TOKEN } = {}) {
  const result = { headers: {} };
  await selected({ method, headers: { 'x-lemrix-migration': token }, body }, {
    set statusCode(value) { result.status = value; },
    setHeader(key, value) { result.headers[key] = value; },
    end(value) { result.body = JSON.parse(value); result.serialized = value; },
  });
  return result;
}
for (const options of [{ method: 'GET' }, { token: 'wrong' }, { handler: createMigrationHandler({ env: { ...env, LEMRIX_MIGRATION_UNTIL: '2000-01-01T00:00:00Z' }, fetch: sourceFetch }) },
  { handler: createMigrationHandler({ env: { ...env, LEMRIX_MIGRATION_SOURCE: 'https://other.invalid' }, fetch: sourceFetch }) }]) {
  assert.equal((await invoke({ action: 'config' }, options)).status, 404);
}
assert.equal(sourceCalls, 0);
assert.equal((await invoke({ action: 'arbitrary-source-action' })).status, 400);
const configuration = await invoke({ action: 'config' });
assert.equal(configuration.status, 200);
assert.equal(configuration.body.configured, true);
assert.equal(configuration.serialized.includes(password), false);
assert.equal(records.get(runtimeConfigPath).bytes.toString().includes(password), false);
assert.equal(decryptRuntimeConfig(await (await bucket.get(runtimeConfigPath)).json(), key).ADMIN_PASSWORD, undefined);

const first = await invoke({ action: 'import', limit: 4 });
assert.equal(first.status, 200);
assert.equal(first.body.count, 3);
assert.equal(first.body.nextCursor, '4');
assert.equal(first.body.imported.find(item => item.key === 'store/v1/catalogue.json').sha256, createHash('sha256').update(catalogue).digest('hex'));
assert.equal(first.body.imported.find(item => item.key === 'store/v1/catalogue.json').sourceEtag, 'source-etag');
assert.deepEqual(records.get('store/v1/catalogue.json').bytes, catalogue);
assert.deepEqual(records.get(imageKey).customMetadata, { fixture: 'preserved' });
assert.equal(records.has('store/v1/sessions/old'), false);
const second = await invoke({ action: 'import', limit: 4, cursor: first.body.nextCursor });
assert.equal(second.status, 200);
assert.equal(second.body.count, 1);
assert.equal(second.body.truncated, false);
assert.equal(records.has('store/v1/admin-generation'), false);
assert.equal(records.has('store/v1/owner-proofs/old'), false);
assert.equal(records.has('store/v2/reward-art/hill-club'), true);

const protectedKey = 'store/v2/admin-sessions/new';
await bucket.put(protectedKey, 'native-session');
const newImageKey = 'store/v1/images/' + 'b'.repeat(32);
await bucket.put(newImageKey, 'native-object-not-imported');
const finalSourceKeys = [...sourceRecords.keys()].filter(key => key !== imageKey);
assert.equal((await invoke({ action: 'reconcile', finalSourceKeys })).status, 409);
assert.equal(records.has(imageKey), true);
frozen = true;
const reconciled = await invoke({ action: 'reconcile', finalSourceKeys });
assert.equal(reconciled.status, 200);
assert.deepEqual(reconciled.body.removed, [imageKey]);
assert.equal(records.has(newImageKey), true);
assert.equal(records.has(protectedKey), true);
assert.equal(records.has(runtimeConfigPath), true);
await bucket.put('store/v1/customers/profiles/123', 'changed-on-native');
assert.equal((await invoke({ action: 'reconcile', finalSourceKeys: finalSourceKeys.filter(key => key !== 'store/v1/customers/profiles/123') })).status, 409);
assert.equal(await (await bucket.get('store/v1/customers/profiles/123')).text(), 'changed-on-native');

for (const [action, expected] of [['resume', [false, false]], ['freeze', [true, false]], ['retire', [true, true]], ['status', [true, true]]]) {
  const result = await invoke({ action });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { frozen: expected[0], retired: expected[1], updatedAt: '2026-11-25T12:00:00.000Z' });
  assert.equal(result.serialized.includes(password), false);
}

const probed = await invoke({ action: 'probe' });
assert.equal(probed.status, 200);
assert.deepEqual(probed.body, { createOnlyWinners: 1, casWinners: 1, consistentRead: true, deleted: true });
assert.equal([...records.keys()].some(key => key.startsWith('store/v2/migration/probe-')), false);

const tokenCookie = '__Host-lemrix-admin=' + 'a'.repeat(64) + '.' + 'b'.repeat(64);
let loggedIn = false;
const verificationHandler = createMigrationHandler({ env, createBucket: () => bucket, fetch: sourceFetch, loadApplication: async () => ({ default: {
  async fetch(request, runtime) {
    assert.equal(runtime.SESSION_SECRET, env.SESSION_SECRET);
    assert.equal(runtime.ADMIN_PASSWORD, undefined);
    assert.equal(runtime.CLIENT_IP, 'migration-check');
    assert.equal(request.headers.get('origin'), 'https://lemrix.vercel.app');
    const path = new URL(request.url).pathname;
    if (path === '/api/login') {
      const body = await request.json();
      if (body.password !== password) return Response.json({}, { status: 401 });
      loggedIn = true;
      return Response.json({}, { headers: { 'Set-Cookie': tokenCookie + '; Path=/; Secure; HttpOnly; SameSite=Lax' } });
    }
    assert.equal(request.headers.get('cookie'), tokenCookie);
    if (path === '/api/account') return Response.json({}, { status: loggedIn ? 200 : 401 });
    if (path === '/api/logout') { loggedIn = false; return Response.json({}); }
    assert.fail('Unexpected verification path');
  },
} }) });
const verified = await invoke({ action: 'verify-admin' }, { handler: verificationHandler });
assert.equal(verified.status, 200);
assert.deepEqual(verified.body, { login: 200, account: 200, logout: 200, afterLogout: 401, wrongPassword: 401 });
assert.equal(verified.serialized.includes(password), false);
assert.equal(verified.serialized.includes(tokenCookie), false);
assert.equal(loggedIn, false);

const badSource = createMigrationHandler({ env, createBucket: () => bucket, fetch: async () => { throw new Error(password + migrationKey); } });
const failure = await invoke({ action: 'config' }, { handler: badSource });
assert.equal(failure.status, 502);
assert.equal(failure.serialized.includes(password), false);
assert.equal(failure.serialized.includes(migrationKey), false);

// Snapshot responses contain metadata only; bad read-back never enters the manifest.
{
  const snapshotHandler = createMigrationHandler({ env, fetch: async (url, options) => {
    assert.equal(url, env.LEMRIX_MIGRATION_SOURCE + '/api/migration');
    assert.deepEqual(JSON.parse(options.body), { action: 'list', limit: 12, cursor: 'snapshot-page' });
    return sourceEnvelope({ objects: [{ key: imageKey, size: 4, etag: 'snapshot-etag', body: password, customMetadata: { secret: password } }], truncated: true, cursor: 'following-page' });
  } });
  const snapshot = await invoke({ action: 'source-snapshot', cursor: 'snapshot-page' }, { handler: snapshotHandler });
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.body, { objects: [{ key: imageKey, size: 4, etag: 'snapshot-etag' }], truncated: true, nextCursor: 'following-page' });
  assert.equal(snapshot.serialized.includes(password), false);

  const copying = bucketFixture();
  const corruptRead = { ...copying.bucket, get: async key => key === 'store/v1/catalogue.json' ? { arrayBuffer: async () => Buffer.from('corrupt').buffer } : copying.bucket.get(key) };
  const corruptHandler = createMigrationHandler({ env, createBucket: () => corruptRead, fetch: sourceFetch });
  const failedImport = await invoke({ action: 'import', limit: 4 }, { handler: corruptHandler });
  assert.equal(failedImport.status, 502);
  assert.equal(copying.records.has('store/v2/migration/imported.json'), false);
}

const stripeKey = 'rk_live_fixture_restricted';
const stripeEnv = { ...env, STRIPE_SECRET_KEY: stripeKey };
const oldWebhookUrl = env.LEMRIX_MIGRATION_SOURCE + '/api/stripe/webhook';
const newWebhookUrl = 'https://lemrix.vercel.app/api/stripe/webhook';
const endpoint = {
  id: 'we_Existing123', url: oldWebhookUrl, livemode: true, status: 'enabled',
  enabled_events: ['checkout.session.completed', 'checkout.session.expired'],
  api_version: '2026-11-18.endive', application: null, description: 'fixture-private-description',
  metadata: { owner: 'fixture-private-metadata', purpose: 'store' }, secret: 'whsec_endpoint_response_secret',
};

function assertRedacted(result) {
  for (const secret of [password, key, migrationKey, env.LEMRIX_MIGRATION_TOKEN, env.LEMRIX_BACKEND_TOKEN,
    stripeKey, values.STRIPE_WEBHOOK_SECRET, endpoint.description, endpoint.metadata.owner, endpoint.secret]) {
    assert.equal(result.serialized.includes(secret), false, 'Sensitive fixture value leaked in response');
  }
}

function stripeFixture({ pages = [[endpoint]], after = { ...endpoint, url: newWebhookUrl }, listStatus = 200, writeStatus = 200, readStatus = 200 } = {}) {
  const calls = [];
  let page = 0;
  const selected = createMigrationHandler({ env: stripeEnv, createBucket: () => bucket, fetch: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body?.toString() });
    const parsed = new URL(url), headers = new Headers(options.headers);
    assert.equal(parsed.origin, 'https://api.stripe.com');
    assert.equal(options.redirect, 'manual');
    assert.equal(headers.get('authorization'), 'Bearer ' + stripeKey);
    assert.equal(headers.get('stripe-version'), '2026-11-18.endive');
    assert.equal(headers.has('x-lemrix-migration'), false);
    assert.equal(headers.has('oai-sites-authorization'), false);
    const denied = status => Response.json({ error: { message: password + stripeKey + endpoint.secret } }, { status });
    if (parsed.pathname === '/v1/webhook_endpoints' && options.method === 'GET') {
      assert.equal(parsed.searchParams.get('limit'), '100');
      if (listStatus !== 200) return denied(listStatus);
      if (page) assert.equal(parsed.searchParams.get('starting_after'), pages[page - 1].at(-1).id);
      const data = pages[page++];
      return Response.json({ data, has_more: page < pages.length });
    }
    assert.equal(parsed.pathname, '/v1/webhook_endpoints/' + endpoint.id);
    assert.equal(parsed.search, '');
    if (options.method === 'POST') {
      assert.ok(options.body instanceof URLSearchParams);
      assert.deepEqual([...options.body.entries()], [['url', newWebhookUrl]]);
      assert.equal(headers.get('idempotency-key'), 'lemrix-native-webhook-' + endpoint.id);
      const outgoing = new Request(url, options);
      assert.ok(outgoing.headers.get('content-type').startsWith('application/x-www-form-urlencoded'));
      if (writeStatus !== 200) return denied(writeStatus);
      return Response.json(after);
    }
    assert.equal(options.method, 'GET');
    if (readStatus !== 200) return denied(readStatus);
    return Response.json(after);
  } });
  return { handler: selected, calls };
}

// Inspection is read-only; mutation selects one exact URL and changes only its URL.
{
  const inspected = stripeFixture();
  const result = await invoke({ action: 'webhook-inspect' }, inspected);
  assert.equal(result.status, 200);
  assert.equal(result.body.configurationPreserved, true);
  assert.equal(result.body.changed, false);
  assert.equal(result.body.id, endpoint.id);
  assert.deepEqual(inspected.calls.map(call => call.method), ['GET']);
  assertRedacted(result);

  const nearMatches = [
    { ...endpoint, id: 'we_Query', url: oldWebhookUrl + '?other=1' },
    { ...endpoint, id: 'we_Trailing', url: oldWebhookUrl + '/' },
    { ...endpoint, id: 'we_Host', url: 'https://lemrix.vercel.app.attacker.invalid/api/stripe/webhook' },
  ];
  const moved = stripeFixture({ pages: [nearMatches, [endpoint]], after: { ...endpoint, url: newWebhookUrl, metadata: { purpose: 'store', owner: endpoint.metadata.owner } } });
  const changed = await invoke({ action: 'webhook-move', url: 'https://attacker.invalid', id: 'we_Attacker', enabled_events: ['*'] }, moved);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.id, endpoint.id);
  assert.equal(changed.body.url, newWebhookUrl);
  assert.equal(changed.body.changed, true);
  assert.equal(changed.body.configurationPreserved, true);
  assert.deepEqual(changed.body.events, endpoint.enabled_events);
  assert.equal(changed.body.apiVersion, endpoint.api_version);
  assert.deepEqual(moved.calls.map(call => call.method), ['GET', 'GET', 'POST', 'GET']);
  assertRedacted(changed);

  const already = stripeFixture({ pages: [[{ ...endpoint, url: newWebhookUrl }]] });
  const unchanged = await invoke({ action: 'webhook-move' }, already);
  assert.equal(unchanged.body.changed, false);
  assert.deepEqual(already.calls.map(call => call.method), ['GET']);
  for (const [listed, count] of [[nearMatches, 0], [[endpoint, { ...endpoint, id: 'we_Second', url: newWebhookUrl }], 2]]) {
    const ambiguous = stripeFixture({ pages: [listed] });
    const response = await invoke({ action: 'webhook-move' }, ambiguous);
    assert.deepEqual(response.body, { authorized: true, matchingEndpoints: count, changed: false });
    assert.deepEqual(ambiguous.calls.map(call => call.method), ['GET']);
  }
}

// Permission failures preserve their HTTP status without returning Stripe error bodies.
{
  for (const status of [401, 403, 302]) {
    const denied = stripeFixture({ listStatus: status });
    const response = await invoke({ action: 'webhook-move' }, denied);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { authorized: false, stripeStatus: status });
    assert.deepEqual(denied.calls.map(call => call.method), ['GET']);
    assertRedacted(response);
  }
  const deniedWrite = stripeFixture({ writeStatus: 403 });
  const response = await invoke({ action: 'webhook-move' }, deniedWrite);
  assert.deepEqual(response.body, { authorized: false, stripeStatus: 403, changed: false });
  assert.deepEqual(deniedWrite.calls.map(call => call.method), ['GET', 'POST']);
  assertRedacted(response);
  const deniedRead = stripeFixture({ readStatus: 403 });
  const unreadable = await invoke({ action: 'webhook-move' }, deniedRead);
  assert.equal(unreadable.status, 502);
  assertRedacted(unreadable);
}

// A different identity or configuration cannot be reported as a preserved move.
{
  for (const invalid of [{ id: 'we_../unsafe' }, { livemode: false }, { status: 'disabled' }]) {
    const scenario = stripeFixture({ pages: [[{ ...endpoint, ...invalid }]] });
    assert.equal((await invoke({ action: 'webhook-move' }, scenario)).status, 409);
    assert.deepEqual(scenario.calls.map(call => call.method), ['GET']);
  }
  for (const changed of [{ id: 'we_Different' }, { enabled_events: ['*'] }, { metadata: { owner: 'changed' } }]) {
    const scenario = stripeFixture({ after: { ...endpoint, url: newWebhookUrl, ...changed } });
    const rejected = await invoke({ action: 'webhook-move' }, scenario);
    assert.equal(rejected.status, 502);
    assertRedacted(rejected);
  }
  let called = false;
  const testKeyHandler = createMigrationHandler({ env, createBucket: () => bucket, fetch: async () => { called = true; } });
  assert.equal((await invoke({ action: 'webhook-inspect' }, { handler: testKeyHandler })).status, 409);
  assert.equal(called, false);
}

function webhookFixture({ hostname = 'lemrix-preview-123.vercel.app', expectedOrigin = 'https://lemrix-preview-123.vercel.app', validStatus = 200, invalidStatus = 400 } = {}) {
  const calls = [];
  const selected = createMigrationHandler({ env: { ...env, VERCEL_URL: hostname }, createBucket: () => bucket, fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, expectedOrigin + '/api/stripe/webhook');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    const headers = new Headers(options.headers);
    assert.deepEqual([...headers.keys()].sort(), ['content-type', 'stripe-signature']);
    assert.deepEqual(JSON.parse(options.body), { id: 'evt_lemrix_migration_check', type: 'lemrix.migration.check', data: { object: {} } });
    const match = headers.get('stripe-signature').match(/^t=(\d+),v1=([a-f0-9]{64})$/);
    assert.ok(match);
    assert.ok(Math.abs(Number(match[1]) - Date.now() / 1000) < 5);
    const expected = createHmac('sha256', values.STRIPE_WEBHOOK_SECRET).update(match[1] + '.' + options.body).digest('hex');
    if (calls.length === 1) assert.equal(match[2], expected);
    else { assert.notEqual(match[2], expected); assert.equal(match[2], '0'.repeat(64)); }
    return Response.json({ shouldNotLeak: password + values.STRIPE_WEBHOOK_SECRET }, { status: calls.length === 1 ? validStatus : invalidStatus });
  } });
  return { handler: selected, calls };
}

// Only a validated deployment hostname or the fixed production origin receives signatures.
{
  const preview = webhookFixture();
  const tested = await invoke({ action: 'verify-webhook', origin: 'https://attacker.invalid', url: 'https://attacker.invalid/hook' }, preview);
  assert.equal(tested.status, 200);
  assert.deepEqual(tested.body, { origin: 'https://lemrix-preview-123.vercel.app', valid: 200, invalid: 400, verified: true });
  assert.equal(preview.calls.length, 2);
  assertRedacted(tested);
  const production = webhookFixture({ hostname: 'untrusted.invalid', expectedOrigin: 'https://lemrix.vercel.app' });
  const testedProduction = await invoke({ action: 'verify-webhook', production: true }, production);
  assert.deepEqual(testedProduction.body, { origin: 'https://lemrix.vercel.app', valid: 200, invalid: 400, verified: true });
  assertRedacted(testedProduction);
  for (const hostname of ['https://lemrix.vercel.app', 'lemrix.vercel.app.attacker.invalid', 'lemrix.vercel.app/path', 'lemrix.vercel.app:443']) {
    const unsafe = webhookFixture({ hostname });
    assert.equal((await invoke({ action: 'verify-webhook' }, unsafe)).status, 409);
    assert.equal(unsafe.calls.length, 0);
  }
  for (const settings of [{ validStatus: 307 }, { invalidStatus: 200 }]) {
    const unhealthy = webhookFixture(settings);
    const response = await invoke({ action: 'verify-webhook' }, unhealthy);
    assert.equal(response.body.verified, false);
    assert.equal(unhealthy.calls.length, 2);
    assertRedacted(response);
  }
}

console.log('Verified migration protocol and copying, guarded reconciliation, native auth checks, fixed Stripe endpoint migration, configuration preservation, permission redaction and webhook signature delivery.');
