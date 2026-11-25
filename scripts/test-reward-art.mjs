import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

// Build without --test-art so embedded fixture images cannot hide a missing
// production object. Only generated output and local fixture data are used.
const root = new URL('../', import.meta.url);
await promisify(execFile)(process.execPath, [fileURLToPath(new URL('scripts/build-server.mjs', root))], {cwd:fileURLToPath(root)});
const {default:worker} = await import('../dist/server/index.js?stored-reward-art');

const code = '1'.repeat(32);
const ledgerKey = 'store/v1/rewards/' + createHash('sha256').update(code).digest('hex') + '.json';
const artworkPrefix = 'store/v2/reward-art/';
const ids = ['hill-club', 'last-showing', 'after-hours'];
const bytes = Buffer.from([82, 73, 70, 70, 0, 255, 128, 0, 87, 69, 66, 80, 13, 10, 0, 254]);
const records = new Map(ids.map((id, index) => [artworkPrefix + id, Buffer.concat([bytes, Buffer.from([index])])]));
const reads = [];
const ledger = subtotal => Buffer.from(JSON.stringify({orders:{fixture:{subtotal}}}));
records.set(ledgerKey, ledger(10000));
const env = {REQUIRE_STORED_CATALOGUE:true, BUCKET:{
  async get(key) {
    reads.push(key);
    const value = records.get(key);
    if (!value) return null;
    return {body:new Response(value).body, size:value.length,
      httpMetadata:{contentType:key.startsWith(artworkPrefix) ? 'image/webp' : 'application/json'},
      json:async () => JSON.parse(value.toString())};
  },
}};
const call = (id, cookie = '__Host-lemrix-pass=' + code) => worker.fetch(new Request('https://lemrix.vercel.app/api/rewards/art/' + id, {headers:{Cookie:cookie}}), env);

assert.equal((await call('hill-club', '')).status, 401);
assert.ok(!reads.some(key => key.startsWith(artworkPrefix)), 'Anonymous visitors cannot read protected artwork');
records.set(ledgerKey, ledger(0));
assert.equal((await call('after-hours')).status, 403);
assert.ok(!reads.some(key => key.startsWith(artworkPrefix)), 'Entitlement is checked before reading artwork');
records.set(ledgerKey, ledger(10000));

for (const id of ids) {
  const response = await call(id);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), records.get(artworkPrefix + id), 'Stored binary bytes are preserved for ' + id);
  assert.equal(response.headers.get('Content-Type'), 'image/webp');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="Lemrix-' + id + '.webp"');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(reads.includes(artworkPrefix + id));
}

records.delete(artworkPrefix + 'after-hours');
const missing = await call('after-hours');
assert.equal(missing.status, 503, 'A normal build must not substitute embedded test art');
assert.deepEqual(await missing.json(), {error:'This print is temporarily unavailable.'});
assert.equal(missing.headers.get('Cache-Control'), 'no-store');

console.log('Verified normal-build reward downloads use exact stored binary art, enforce entitlement before storage reads, and return 503 when production artwork is missing.');
