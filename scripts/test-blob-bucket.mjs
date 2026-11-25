import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createBlobBucket, BlobBucketDataError } from '../lib/blob-bucket.mjs';

class BlobError extends Error {}
class BlobPreconditionFailedError extends BlobError {}

function fixture() {
  const records = new Map(), calls = [];
  let version = 0;
  const sdk = {
    BlobError, BlobPreconditionFailedError,
    async put(path, body, options) {
      calls.push({ method: 'put', path, options });
      const previous = records.get(path);
      // An atomic storage operation: the condition and write share one turn.
      if (options.ifMatch && previous?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      if (!options.allowOverwrite && previous) {
        throw new BlobError('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      }
      const record = { body, etag: '"revision-' + (++version) + '"', uploadedAt: new Date() };
      records.set(path, record);
      return { pathname: path, etag: record.etag };
    },
    async get(path, options) {
      calls.push({ method: 'get', path, options });
      const record = records.get(path);
      if (!record) return null;
      return {
        statusCode: 200,
        stream: new Response(record.body).body,
        blob: { etag: record.etag, size: Buffer.byteLength(record.body), uploadedAt: record.uploadedAt },
      };
    },
    async del(paths, options) {
      calls.push({ method: 'del', paths, options });
      for (const path of Array.isArray(paths) ? paths : [paths]) records.delete(path);
    },
    async list({ prefix, limit, cursor, ...options }) {
      calls.push({ method: 'list', prefix, options });
      const paths = [...records.keys()].filter(path => path.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const selected = paths.slice(start, start + limit);
      const hasMore = start + limit < paths.length;
      return { blobs: selected.map(pathname => ({ pathname })), hasMore, ...(hasMore ? { cursor: String(start + limit) } : {}) };
    },
  };
  return { sdk, records, calls, bucket: createBlobBucket({ sdk }) };
}

// The same fixed pathname atomically stores data and both metadata records.
{
  const { bucket, records, calls } = fixture();
  const key = 'store/v1/images/' + 'a'.repeat(32);
  const source = Uint8Array.from([7, 0, 255, 128, 10, 42, 9]);
  const bytes = source.subarray(1, 6);
  const options = { httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-cache' }, customMetadata: { generation: 'g1', expires: '12345' } };
  const saved = await bucket.put(key, bytes, options);
  assert.equal(saved.size, bytes.byteLength);
  assert.equal(saved.etag, 'revision-1');
  assert.equal(saved.httpEtag, '"revision-1"');
  const envelope = JSON.parse(records.get(key).body);
  assert.equal(envelope.data, Buffer.from(bytes).toString('base64'));
  assert.deepEqual(envelope.customMetadata, options.customMetadata);
  assert.equal(calls[0].options.contentType, 'application/json; charset=utf-8');

  const object = await bucket.get(key);
  assert.deepEqual(object.httpMetadata, options.httpMetadata);
  assert.deepEqual(object.customMetadata, options.customMetadata);
  assert.equal(object.bodyUsed, false);
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), bytes);
  assert.equal(object.bodyUsed, true);
  await assert.rejects(() => object.text(), TypeError);
  const head = await bucket.head(key);
  assert.equal(head.size, bytes.length);
  assert.equal(head.body, undefined);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  assert.equal(headers.get('content-type'), 'image/png');
  assert.equal(await bucket.get('store/v1/missing'), null);
  assert.equal(await bucket.head('store/v1/missing'), null);
  for (const call of calls.filter(call => call.method === 'get')) {
    assert.equal(call.options.access, 'private');
    assert.equal(call.options.useCache, false);
    assert.deepEqual(call.options.headers, { 'accept-encoding': 'identity' });
  }
  for (const call of calls.filter(call => call.method === 'put')) {
    assert.equal(call.options.access, 'private');
    assert.equal(call.options.addRandomSuffix, false);
  }
}

// Larger JSON responses may be compressed by delivery infrastructure. Require
// identity encoding instead of promoting a weak transfer ETag into a CAS token.
{
  const { sdk } = fixture();
  const compressedSdk = { ...sdk, async get(path, options) {
    const result = await sdk.get(path, options);
    if (result && options.headers?.['accept-encoding'] !== 'identity') result.blob.etag = 'W/' + result.blob.etag;
    return result;
  } };
  const bucket = createBlobBucket({ sdk: compressedSdk });
  const key = 'store/v2/runtime/config.json';
  const value = { ciphertext: 'fixture-encrypted-value'.repeat(600) };
  await bucket.put(key, JSON.stringify(value));
  const object = await bucket.get(key);
  assert.deepEqual(await object.json(), value);
  assert.equal((await bucket.head(key)).etag, object.etag);
  assert.ok(await bucket.put(key, JSON.stringify({ ...value, updated: true }), { onlyIf: new Headers({ 'If-Match': '"' + object.etag + '"' }) }));
}

// Only one concurrent stock writer with the same ETag can succeed. The loser
// re-reads the new state instead of overwriting the winner's reservation.
{
  const { bucket, calls } = fixture();
  const key = 'store/v1/catalogue.json';
  const first = await bucket.put(key, JSON.stringify({ stock: 1, holds: [] }), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
  const stateA = await bucket.get(key), stateB = await bucket.get(key);
  const writes = await Promise.all([stateA, stateB].map((state, i) => bucket.put(key,
    JSON.stringify({ stock: 1, holds: ['checkout-' + i] }),
    { onlyIf: new Headers({ 'If-Match': '"' + state.etag + '"' }) })));
  assert.equal(writes.filter(Boolean).length, 1);
  assert.equal(writes.filter(value => value === null).length, 1);
  assert.equal((await (await bucket.get(key)).json()).holds.length, 1);
  assert.notEqual((await bucket.head(key)).etag, first.etag);
  assert.equal(calls.filter(call => call.method === 'put')[1].options.ifMatch, '"revision-1"');
  assert.equal(await bucket.put('store/v1/not-created', 'x', { onlyIf: new Headers({ 'If-Match': '"missing"' }) }), null);

  const creations = await Promise.all(['one', 'two'].map(value => bucket.put('store/v1/new', value,
    { onlyIf: new Headers({ 'If-None-Match': '*' }) })));
  assert.equal(creations.filter(Boolean).length, 1);
  assert.equal(creations.filter(value => value === null).length, 1);
  assert.equal(calls.filter(call => call.path === 'store/v1/new' && call.method === 'put').every(call => call.options.allowOverwrite === false), true);
}

// Real create-only collisions use several generic BlobError messages. These
// are conflicts only for creation, never substitutes for update preconditions.
{
  const { sdk } = fixture();
  for (const message of [
    'Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.',
    'Vercel Blob: The blob already exists. Set allowOverwrite to true to replace it.',
    'Vercel Blob: A blob with this pathname already exists.',
    'Vercel Blob: The file at this path already exists.',
    'Vercel Blob: File already exists',
    'Vercel Blob: An object with the same key already exists.',
  ]) {
    const error = new BlobError(message);
    const bucket = createBlobBucket({ sdk: { ...sdk, put: async () => { throw error; } } });
    assert.equal(await bucket.put('existing', 'value', { onlyIf: new Headers({ 'If-None-Match': '*' }) }), null);
    await assert.rejects(() => bucket.put('existing', 'value'), candidate => candidate === error);
    await assert.rejects(() => bucket.put('existing', 'value', { onlyIf: new Headers({ 'If-Match': '"revision-1"' }) }), candidate => candidate === error);
  }
  for (const error of [
    new BlobError('Vercel Blob: Store already exists.'),
    new BlobError('Vercel Blob: Blob store already exists.'),
    new BlobError('Vercel Blob: A token already exists.'),
    new BlobError('Vercel Blob: Blob access denied; another resource already exists.'),
    new BlobError('Vercel Blob: Access denied.'),
    new BlobError('Vercel Blob: Service unavailable.'),
    new BlobError('Proxy: This blob already exists.'),
    new Error('Vercel Blob: This blob already exists.'),
  ]) {
    const bucket = createBlobBucket({ sdk: { ...sdk, put: async () => { throw error; } } });
    await assert.rejects(() => bucket.put('key', 'value', { onlyIf: new Headers({ 'If-None-Match': '*' }) }), candidate => candidate === error);
  }
}

// Mutable metadata is never cached, and updates do not carry old metadata over.
{
  const { bucket } = fixture();
  const key = 'store/v1/admin-generation';
  await bucket.put(key, '1', { customMetadata: { generation: 'before' } });
  assert.equal((await bucket.head(key)).customMetadata.generation, 'before');
  await bucket.put(key, '1', { customMetadata: { generation: 'after' } });
  assert.equal((await bucket.head(key)).customMetadata.generation, 'after');
  await bucket.put(key, 'fresh');
  assert.deepEqual((await bucket.head(key)).customMetadata, {});
  assert.equal(await (await bucket.get(key)).text(), 'fresh');
  await bucket.delete(key);
  assert.equal(await bucket.head(key), null);
}

// UTF-8, empty values and streaming binary uploads retain original byte sizes.
{
  const { bucket } = fixture();
  await bucket.put('text', 'Lemrix — café 🎴');
  assert.equal((await bucket.head('text')).size, Buffer.byteLength('Lemrix — café 🎴'));
  assert.equal(await (await bucket.get('text')).text(), 'Lemrix — café 🎴');
  for (const value of ['', null, new Uint8Array()]) {
    await bucket.put('empty', value);
    assert.equal((await bucket.head('empty')).size, 0);
    assert.equal(await (await bucket.get('empty')).text(), '');
  }
  await bucket.put('stream', new Response(Uint8Array.from([0, 200, 255])).body);
  assert.deepEqual(new Uint8Array(await new Response((await bucket.get('stream')).body).arrayBuffer()), Uint8Array.from([0, 200, 255]));
  await bucket.put('date', 'ok', { httpMetadata: { cacheExpiry: new Date('2030-01-01T00:00:00Z') } });
  assert.equal((await bucket.head('date')).httpMetadata.cacheExpiry.toISOString(), '2030-01-01T00:00:00.000Z');
  await bucket.put('headers', 'ok', { httpMetadata: new Headers({ 'content-type': 'text/plain', expires: 'Tue, 01 Jan 2030 00:00:00 GMT' }) });
  assert.equal((await bucket.head('headers')).httpMetadata.cacheExpiry.toISOString(), '2030-01-01T00:00:00.000Z');
  await assert.rejects(() => bucket.put('bad-date', 'ok', { httpMetadata: new Headers({ expires: 'invalid' }) }), TypeError);
}

// Migration listing exposes logical keys and decoded sizes, including pagination.
{
  const { sdk, records } = fixture();
  const bucket = createBlobBucket({ sdk, prefix: 'isolated/', token: 'test-token' });
  for (const key of ['store/v1/a', 'store/v1/b', 'other']) await bucket.put(key, key);
  assert.ok(records.has('isolated/store/v1/a'));
  const page = await bucket.list({ prefix: 'store/v1/', limit: 1 });
  assert.equal(page.truncated, true);
  assert.deepEqual(page.objects.map(object => object.key), ['store/v1/a']);
  assert.equal(page.objects[0].size, 'store/v1/a'.length);
  const last = await bucket.list({ prefix: 'store/v1/', limit: 1, cursor: page.cursor });
  assert.equal(last.truncated, false);
  assert.deepEqual(last.objects.map(object => object.key), ['store/v1/b']);
  await bucket.delete(['store/v1/a', 'store/v1/b']);
  assert.deepEqual((await bucket.list({ prefix: 'store/v1/' })).objects, []);
  assert.equal(await (await bucket.get('other')).text(), 'other');
}

// Unsupported conditions, malformed envelopes and provider failures fail closed.
{
  const { bucket, records, sdk } = fixture();
  for (const headers of [
    { 'If-Match': 'W/"weak"' }, { 'If-Match': '"one", "two"' }, { 'If-Match': '*' },
    { 'If-None-Match': '"other"' }, { 'If-Match': '"one"', 'If-None-Match': '*' },
    { 'If-Unmodified-Since': 'yesterday' },
  ]) await assert.rejects(() => bucket.put('bad', 'value', { onlyIf: new Headers(headers) }), TypeError);
  for (const key of ['../escape', 'a/../b', '/absolute', 'https://external.invalid/key', 'a//b', 'a?query']) {
    await assert.rejects(() => bucket.get(key), TypeError);
  }
  await bucket.put('corrupt', 'ok');
  records.get('corrupt').body = JSON.stringify({ data: 'unwrapped legacy object' });
  await assert.rejects(() => bucket.get('corrupt'), BlobBucketDataError);
  await bucket.put('weak-provider-etag', 'ok');
  records.get('weak-provider-etag').etag = 'W/"weak"';
  await assert.rejects(() => bucket.head('weak-provider-etag'), TypeError);
  const unavailable = new Error('Storage unavailable');
  const broken = createBlobBucket({ sdk: { ...sdk, put: async () => { throw unavailable; } } });
  for (const onlyIf of [undefined, new Headers({ 'If-None-Match': '*' }), new Headers({ 'If-Match': '"old"' })]) {
    await assert.rejects(() => broken.put('key', 'value', { onlyIf }), error => error === unavailable);
  }
}

console.log('Verified private consistent reads, atomic create/update conflicts, raw payload and metadata preservation, migration pagination, and closed failure handling.');
