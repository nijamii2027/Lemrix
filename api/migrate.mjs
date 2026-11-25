// Temporary, token-gated migration endpoint. Remove this file and its dedicated
// environment variables after the native store has been verified and promoted.
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { createDecipheriv, createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createBlobBucket } from '../lib/blob-bucket.mjs';
import { encryptRuntimeConfig, hashAdminPassword, readRuntimeConfig, runtimeConfigPath } from '../lib/runtime-config.mjs';

const sourceOrigin = 'https://lemrix-tcg-illustrated.beefybag2.chatgpt.site';
const nativeOrigin = 'https://lemrix.vercel.app';
const manifestPath = 'store/v2/migration/imported.json';
const sourceAad = Buffer.from('lemrix-migration-v1');
const maxRequestBytes = 1024 * 1024;
const maxSourceBytes = 32 * 1024 * 1024;
const sourceConfigKeys = ['STRIPE_SECRET_KEY', 'STRIPE_SHIPPING_RATE', 'STRIPE_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID'];

class MigrationError extends Error {
  constructor(status = 502) { super('Migration could not be completed.'); this.status = status; }
}

function reply(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('CDN-Cache-Control', 'no-store');
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.end(JSON.stringify(body));
}

function authorized(request, env, now) {
  const expected = env.LEMRIX_MIGRATION_TOKEN;
  const supplied = request.headers?.['x-lemrix-migration'];
  const deadline = Date.parse(env.LEMRIX_MIGRATION_UNTIL || '');
  if (request.method !== 'POST' || typeof expected !== 'string' || expected.length < 32 ||
      typeof supplied !== 'string' || !Number.isFinite(deadline) || now() >= deadline ||
      env.LEMRIX_MIGRATION_SOURCE !== sourceOrigin || !/^[a-f0-9]{64}$/i.test(env.LEMRIX_MIGRATION_KEY || '')) return false;
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function requestJson(request) {
  if (Number(request.headers?.['content-length']) > maxRequestBytes) throw new MigrationError(413);
  let bytes;
  if (request.body !== undefined) {
    if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) bytes = Buffer.from(request.body);
    else bytes = Buffer.from(JSON.stringify(request.body));
  } else {
    const chunks = [];
    let length = 0;
    for await (const part of request) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      length += chunk.length;
      if (length > maxRequestBytes) throw new MigrationError(413);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length > maxRequestBytes) throw new MigrationError(413);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new MigrationError(400); }
}

function base64(value, length) {
  if (typeof value !== 'string') throw new MigrationError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new MigrationError();
  return bytes;
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > maxSourceBytes || !response.body) throw new MigrationError();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxSourceBytes) { await reader.cancel(); throw new MigrationError(); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readSource(action, env, fetcher) {
  if (env.LEMRIX_MIGRATION_SOURCE !== sourceOrigin) throw new MigrationError();
  const headers = { 'Content-Type': 'application/json', 'X-Lemrix-Migration': env.LEMRIX_MIGRATION_TOKEN };
  if (env.LEMRIX_BACKEND_TOKEN) headers['OAI-Sites-Authorization'] = 'Bearer ' + env.LEMRIX_BACKEND_TOKEN;
  const response = await fetcher(sourceOrigin + '/api/migration', {
    method: 'POST', headers, body: JSON.stringify(action), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 200) { await response.body?.cancel(); throw new MigrationError(); }
  const envelope = await boundedJson(response);
  if (!envelope || envelope.v !== 1) throw new MigrationError();
  const iv = base64(envelope.iv, 12);
  const combined = base64(envelope.ciphertext);
  if (combined.length <= 16) throw new MigrationError();
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(env.LEMRIX_MIGRATION_KEY, 'hex'), iv, { authTagLength: 16 });
  decipher.setAAD(sourceAad);
  decipher.setAuthTag(combined.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
  const value = JSON.parse(plaintext.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MigrationError();
  return value;
}

async function sourceState(action, env, fetcher) {
  const state = await readSource({ action }, env, fetcher);
  if (typeof state.frozen !== 'boolean' || typeof state.retired !== 'boolean' ||
      (state.updatedAt !== undefined && (typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt))))) throw new MigrationError();
  return { frozen: state.frozen, retired: state.retired, ...(state.updatedAt === undefined ? {} : { updatedAt: new Date(state.updatedAt).toISOString() }) };
}

function canonicalKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 1024 &&
    /^[A-Za-z0-9._/-]+$/.test(key) && !key.startsWith('/') && !key.endsWith('/') &&
    !key.split('/').some(part => !part || part === '.' || part === '..');
}

function importable(key) {
  if (!canonicalKey(key)) return false;
  return key === 'store/v1/catalogue.json' ||
    /^store\/v1\/images\/[a-f0-9]{32}$/.test(key) ||
    key.startsWith('store/v1/customers/') || key.startsWith('store/v1/rewards/') ||
    /^store\/v2\/reward-art\/(hill-club|last-showing|after-hours)$/.test(key);
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const condition = object => ({ onlyIf: new Headers(object ? { 'If-Match': '"' + object.etag + '"' } : { 'If-None-Match': '*' }) });

async function manifest(bucket) {
  const object = await bucket.get(manifestPath);
  if (!object) return { object: null, value: { v: 1, source: sourceOrigin, keys: [], digests: {} } };
  const value = await object.json();
  if (value?.v !== 1 || value.source !== sourceOrigin || !Array.isArray(value.keys) ||
      !value.digests || typeof value.digests !== 'object' || Array.isArray(value.digests) ||
      new Set(value.keys).size !== value.keys.length || value.keys.some(key => !importable(key) || !/^[a-f0-9]{64}$/.test(value.digests[key] || ''))) throw new MigrationError();
  return { object, value };
}

async function recordImport(bucket, key, sha256) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const { object, value } = await manifest(bucket);
    if (!value.keys.includes(key)) value.keys.push(key);
    value.keys.sort();
    value.digests[key] = sha256;
    value.updatedAt = new Date().toISOString();
    if (await bucket.put(manifestPath, JSON.stringify(value), { ...condition(object), httpMetadata: { contentType: 'application/json' } })) return;
  }
  throw new MigrationError(409);
}

async function importConfiguration(bucket, env, fetcher) {
  const source = await readSource({ action: 'config' }, env, fetcher);
  if (!source.values || typeof source.values !== 'object') throw new MigrationError();
  const values = { ADMIN_PASSWORD_HASH: await hashAdminPassword(source.values.ADMIN_PASSWORD) };
  for (const key of sourceConfigKeys) {
    if (source.values[key] === undefined) continue;
    if (typeof source.values[key] !== 'string') throw new MigrationError();
    values[key] = source.values[key];
  }
  const previous = await bucket.head(runtimeConfigPath);
  const encrypted = encryptRuntimeConfig(values, env.LEMRIX_CONFIG_KEY);
  if (!await bucket.put(runtimeConfigPath, JSON.stringify(encrypted), { ...condition(previous), httpMetadata: { contentType: 'application/json' } })) throw new MigrationError(409);
  return { configured: true, keys: Object.keys(values).sort() };
}

async function importPage(bucket, body, env, fetcher) {
  const limit = body.limit === undefined ? 12 : body.limit;
  if (!Number.isInteger(limit) || limit < 4 || limit > 12 ||
      (body.cursor !== undefined && (typeof body.cursor !== 'string' || !body.cursor || body.cursor.length > 4096))) throw new MigrationError(400);
  const page = await readSource({ action: 'list', limit, ...(body.cursor ? { cursor: body.cursor } : {}) }, env, fetcher);
  if (!Array.isArray(page.objects) || page.objects.length > limit || typeof page.truncated !== 'boolean' ||
      (page.truncated && (typeof page.cursor !== 'string' || !page.cursor || page.cursor === body.cursor)) ||
      page.objects.some(object => !canonicalKey(object?.key)) ||
      new Set(page.objects.map(object => object.key)).size !== page.objects.length) throw new MigrationError();
  const imported = [], skipped = [];
  for (const listed of page.objects) {
    const key = listed.key;
    if (!importable(key)) { skipped.push(key); continue; }
    const source = await readSource({ action: 'get', key }, env, fetcher);
    if (source.key !== key) throw new MigrationError();
    if (source.missing === true) { skipped.push(key); continue; }
    const bytes = base64(source.body);
    if (!Number.isSafeInteger(source.size) || source.size !== bytes.length) throw new MigrationError();
    await bucket.put(key, bytes, { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata });
    const sha256 = digest(bytes);
    const copied = await bucket.get(key);
    if (!copied || digest(Buffer.from(await copied.arrayBuffer())) !== sha256) throw new MigrationError();
    await recordImport(bucket, key, sha256);
    imported.push({ key, size: bytes.length, sha256, sourceEtag: source.etag });
  }
  return { imported, count: imported.length, sourceKeys: page.objects.map(object => object.key), skipped, truncated: page.truncated, nextCursor: page.truncated ? page.cursor : null };
}

async function sourceSnapshot(body, env, fetcher) {
  if (body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 3000)) throw new MigrationError(400);
  const page = await readSource({ action: 'list', limit: 12, ...(body.cursor ? {cursor:body.cursor} : {}) }, env, fetcher);
  if (!Array.isArray(page.objects) || typeof page.truncated !== 'boolean') throw new MigrationError();
  return { objects:page.objects.map(({key,size,etag}) => {
    if (!canonicalKey(key) || !Number.isSafeInteger(size) || typeof etag !== 'string') throw new MigrationError();
    return {key,size,etag};
  }), truncated:page.truncated, nextCursor:page.truncated ? page.cursor : null };
}

async function stripeManagement(config, fetcher, path, body, idempotencyKey) {
  const headers = {Authorization:'Bearer ' + config.STRIPE_SECRET_KEY, 'Stripe-Version':'2026-11-18.endive'};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetcher('https://api.stripe.com/v1/' + path, {
    method:body ? 'POST' : 'GET', headers, body, redirect:'manual', signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    return {errorStatus:status};
  }
  return boundedJson(response);
}

async function manageWebhook(bucket, env, fetcher, move) {
  const config = await readRuntimeConfig(bucket, env);
  if (!/^(sk|rk)_live_/.test(config.STRIPE_SECRET_KEY || '')) throw new MigrationError(409);
  const oldUrl = sourceOrigin + '/api/stripe/webhook';
  const newUrl = nativeOrigin + '/api/stripe/webhook';
  const endpoints = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const result = await stripeManagement(config, fetcher, 'webhook_endpoints?limit=100' + (cursor ? '&starting_after=' + encodeURIComponent(cursor) : ''));
    if (result.errorStatus) return {authorized:false, stripeStatus:result.errorStatus};
    if (!Array.isArray(result.data)) throw new MigrationError();
    endpoints.push(...result.data.filter(endpoint => endpoint.url === oldUrl || endpoint.url === newUrl));
    if (!result.has_more) break;
    cursor = result.data.at(-1)?.id;
    if (!/^we_[A-Za-z0-9]+$/.test(cursor || '') || page === 4) throw new MigrationError();
  }
  if (endpoints.length !== 1) return {authorized:true, matchingEndpoints:endpoints.length, changed:false};
  const before = endpoints[0];
  if (!/^we_[A-Za-z0-9]+$/.test(before.id || '') || before.livemode !== true || before.status !== 'enabled') throw new MigrationError(409);
  let after = before;
  if (move && before.url !== newUrl) {
    after = await stripeManagement(config, fetcher, 'webhook_endpoints/' + before.id, new URLSearchParams({url:newUrl}), 'lemrix-native-webhook-' + before.id);
    if (after.errorStatus) return {authorized:false, stripeStatus:after.errorStatus, changed:false};
    after = await stripeManagement(config, fetcher, 'webhook_endpoints/' + before.id);
    if (after.errorStatus) throw new MigrationError();
  }
  const fields = ['id','enabled_events','status','api_version','livemode','application','description','metadata'];
  const configurationPreserved = fields.every(field => isDeepStrictEqual(before[field],after[field]));
  if (!configurationPreserved || (move && after.url !== newUrl)) throw new MigrationError();
  return {authorized:true, id:after.id, url:after.url, live:after.livemode, status:after.status, events:after.enabled_events, apiVersion:after.api_version, changed:after.url !== before.url, configurationPreserved};
}

async function verifyWebhook(bucket, body, env, fetcher) {
  const config = await readRuntimeConfig(bucket, env);
  const origin = body.production === true ? nativeOrigin : (/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL || '') ? 'https://' + env.VERCEL_URL : null);
  if (!origin || !config.STRIPE_WEBHOOK_SECRET) throw new MigrationError(409);
  const stamp = String(Math.floor(Date.now()/1000));
  const payload = JSON.stringify({id:'evt_lemrix_migration_check',type:'lemrix.migration.check',data:{object:{}}});
  const signature = createHmac('sha256',config.STRIPE_WEBHOOK_SECRET).update(stamp + '.' + payload).digest('hex');
  const statuses = {};
  for (const [name, value] of [['valid',signature], ['invalid','0'.repeat(64)]]) {
    const response = await fetcher(origin + '/api/stripe/webhook', {method:'POST', headers:{'Content-Type':'application/json','Stripe-Signature':'t='+stamp+',v1='+value}, body:payload, redirect:'manual',signal:AbortSignal.timeout(20000)});
    statuses[name] = response.status;
    await response.body?.cancel();
  }
  return {origin,...statuses,verified:statuses.valid === 200 && statuses.invalid === 400};
}

async function reconcile(bucket, body, env, fetcher) {
  if (!Array.isArray(body.finalSourceKeys) || body.finalSourceKeys.length > 10000 || body.finalSourceKeys.some(key => !canonicalKey(key))) throw new MigrationError(400);
  const status = await readSource({ action: 'status' }, env, fetcher);
  if (status.frozen !== true) throw new MigrationError(409);
  const finalKeys = new Set(body.finalSourceKeys.filter(importable));
  const { object, value } = await manifest(bucket);
  const removed = value.keys.filter(key => !finalKeys.has(key));
  // Refuse to delete a copied object if the native application has since
  // changed it. Native auth/config keys are never eligible for the manifest.
  for (const key of removed) {
    const current = await bucket.get(key);
    if (current && digest(Buffer.from(await current.arrayBuffer())) !== value.digests[key]) throw new MigrationError(409);
  }
  if (removed.length) await bucket.delete(removed);
  value.keys = value.keys.filter(key => finalKeys.has(key));
  value.digests = Object.fromEntries(value.keys.map(key => [key, value.digests[key]]));
  value.updatedAt = new Date().toISOString();
  if (object && !await bucket.put(manifestPath, JSON.stringify(value), { ...condition(object), httpMetadata: { contentType: 'application/json' } })) throw new MigrationError(409);
  return { removed, count: removed.length, retained: value.keys.length };
}

async function probe(bucket) {
  const key = 'store/v2/migration/probe-' + randomUUID();
  let result;
  try {
    const values = ['create-a', 'create-b'];
    const created = await Promise.all(values.map(value => bucket.put(key, value, { onlyIf: new Headers({ 'If-None-Match': '*' }) })));
    if (created.filter(Boolean).length !== 1) throw new MigrationError();
    const first = await bucket.get(key);
    if (!first || await first.text() !== values[created.findIndex(Boolean)]) throw new MigrationError();
    const updates = ['update-a', 'update-b'];
    const written = await Promise.all(updates.map(value => bucket.put(key, value, { onlyIf: new Headers({ 'If-Match': '"' + first.etag + '"' }) })));
    if (written.filter(Boolean).length !== 1) throw new MigrationError();
    const latest = await bucket.get(key);
    if (!latest || latest.etag === first.etag || await latest.text() !== updates[written.findIndex(Boolean)]) throw new MigrationError();
    result = { createOnlyWinners: 1, casWinners: 1, consistentRead: true };
  } finally { await bucket.delete(key); }
  if (await bucket.head(key)) throw new MigrationError();
  return { ...result, deleted: true };
}

function adminCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
  const cookie = cookies.find(value => /^__Host-lemrix-admin=[a-f0-9]{64}\.[a-f0-9]{64};/.test(value));
  return cookie?.split(';')[0];
}

async function verifyAdmin(bucket, body, env, fetcher, loadApplication) {
  const source = await readSource({ action: 'config' }, env, fetcher);
  if (typeof source.values?.ADMIN_PASSWORD !== 'string') throw new MigrationError();
  const config = await readRuntimeConfig(bucket, env);
  const module = await loadApplication();
  const application = module.default || module;
  if (typeof application.fetch !== 'function') throw new MigrationError();
  const runtime = { ...config, BUCKET: bucket, SESSION_SECRET: env.SESSION_SECRET, CLIENT_IP: 'migration-check', REQUIRE_STORED_CATALOGUE: true };
  const call = (path, payload, cookie) => application.fetch(new Request(nativeOrigin + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Origin: nativeOrigin, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }), runtime);
  const statuses = {};
  let cookie;
  try {
    const login = await call('/api/login', { username: 'Lemrix', password: source.values.ADMIN_PASSWORD });
    statuses.login = login.status;
    cookie = adminCookie(login);
    await login.body?.cancel();
    if (login.status === 200 && cookie) {
      const account = await call('/api/account', undefined, cookie);
      statuses.account = account.status;
      await account.body?.cancel();
      const logout = await call('/api/logout', {}, cookie);
      statuses.logout = logout.status;
      await logout.body?.cancel();
      const revoked = await call('/api/account', undefined, cookie);
      statuses.afterLogout = revoked.status;
      await revoked.body?.cancel();
      if (logout.status === 200) cookie = undefined;
    }
    if (body.wrongPassword !== false) {
      const password = source.values.ADMIN_PASSWORD === 'migration-invalid' ? 'migration-invalid-2' : 'migration-invalid';
      const wrong = await call('/api/login', { username: 'Lemrix', password });
      statuses.wrongPassword = wrong.status;
      const unexpected = adminCookie(wrong);
      await wrong.body?.cancel();
      if (unexpected) { const logout = await call('/api/logout', {}, unexpected); await logout.body?.cancel(); }
    }
  } finally {
    if (cookie) { const logout = await call('/api/logout', {}, cookie); await logout.body?.cancel(); }
  }
  const verified = statuses.login === 200 && statuses.account === 200 && statuses.logout === 200 && statuses.afterLogout === 401 &&
    (body.wrongPassword === false || statuses.wrongPassword === 401);
  return { statuses, verified };
}

/** Dependency injection is for local tests; HTTP requests cannot choose URLs, credentials, or storage. */
export function createMigrationHandler({ env = process.env, createBucket = createBlobBucket, fetch: fetcher = globalThis.fetch, loadApplication = () => import('../dist/server/index.js'), now = Date.now } = {}) {
  return async function migrate(request, response) {
    if (!authorized(request, env, now)) return reply(response, 404, { error: 'Not found.' });
    try {
      const body = await requestJson(request);
      if (!['config', 'import', 'reconcile', 'probe', 'verify-admin', 'status', 'freeze', 'retire', 'resume', 'source-snapshot', 'webhook-inspect', 'webhook-move', 'verify-webhook'].includes(body.action)) throw new MigrationError(400);
      if (['status', 'freeze', 'retire', 'resume'].includes(body.action)) return reply(response, 200, await sourceState(body.action, env, fetcher));
      if (body.action === 'source-snapshot') return reply(response, 200, await sourceSnapshot(body,env,fetcher));
      const bucket = createBucket({ token: env.BLOB_READ_WRITE_TOKEN, storeId: env.BLOB_STORE_ID });
      let result;
      if (body.action === 'config') result = await importConfiguration(bucket, env, fetcher);
      if (body.action === 'import') result = await importPage(bucket, body, env, fetcher);
      if (body.action === 'reconcile') result = await reconcile(bucket, body, env, fetcher);
      if (body.action === 'probe') result = await probe(bucket);
      if (body.action === 'webhook-inspect' || body.action === 'webhook-move') result = await manageWebhook(bucket,env,fetcher,body.action === 'webhook-move');
      if (body.action === 'verify-webhook') result = await verifyWebhook(bucket,body,env,fetcher);
      if (body.action === 'verify-admin') {
        const verification = await verifyAdmin(bucket, body, env, fetcher, loadApplication);
        return reply(response, verification.verified ? 200 : 502, verification.statuses);
      }
      return reply(response, 200, result);
    } catch (error) {
      // Source responses, passwords, cookies, configuration values and keys must
      // never reach logs or error responses, even when a dependency throws.
      return reply(response, error instanceof MigrationError ? error.status : 502, { error: 'Migration could not be completed.' });
    }
  };
}

export default createMigrationHandler();
