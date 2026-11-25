import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createCipheriv, randomBytes, webcrypto } from 'node:crypto';
import { decryptRuntimeConfig, encryptRuntimeConfig, hashAdminPassword, readRuntimeConfig, runtimeConfigPath, RuntimeConfigError } from '../lib/runtime-config.mjs';

const password = 'fixture-owner-passphrase';
const key = '11'.repeat(32);
const hash = await hashAdminPassword(password);
const [algorithm, iterations, saltHex, hashHex] = hash.split('$');
assert.equal(algorithm, 'pbkdf2-sha256');
assert.equal(iterations, '600000');
assert.equal(saltHex.length, 32);
assert.equal(hashHex.length, 64);
const verificationKey = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const verification = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: Buffer.from(saltHex, 'hex') }, verificationKey, 256);
assert.equal(Buffer.from(verification).toString('hex'), hashHex);

const values = { ADMIN_PASSWORD_HASH: hash, GOOGLE_CLIENT_ID: 'fixture-client' };
const encrypted = encryptRuntimeConfig(values, key);
assert.deepEqual(decryptRuntimeConfig(encrypted, key), values);
assert.notDeepEqual(encryptRuntimeConfig(values, key).iv, encrypted.iv);
assert.equal(JSON.stringify(encrypted).includes(password), false);
assert.throws(() => decryptRuntimeConfig(encrypted, '33'.repeat(32)), RuntimeConfigError);
for (const field of ['iv', 'tag', 'ciphertext']) {
  const edited = { ...encrypted };
  const data = Buffer.from(edited[field], 'base64'); data[0] ^= 1; edited[field] = data.toString('base64');
  assert.throws(() => decryptRuntimeConfig(edited, key), RuntimeConfigError);
}
assert.throws(() => encryptRuntimeConfig({ ...values, ADMIN_PASSWORD: password }, key), RuntimeConfigError);
assert.throws(() => encryptRuntimeConfig({ ...values, SESSION_SECRET: 'not-allowed' }, key), RuntimeConfigError);
const otherCipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(encrypted.iv, 'base64'));
otherCipher.setAAD(Buffer.from('different-path'));
const otherText = Buffer.concat([otherCipher.update(JSON.stringify(values)), otherCipher.final()]);
assert.throws(() => decryptRuntimeConfig({ v: 1, iv: encrypted.iv, tag: otherCipher.getAuthTag().toString('base64'), ciphertext: otherText.toString('base64') }, key), RuntimeConfigError);

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

const { bucket } = bucketFixture();
await bucket.put(runtimeConfigPath, JSON.stringify(encrypted));
assert.deepEqual(await readRuntimeConfig(bucket, { LEMRIX_CONFIG_KEY: key, GOOGLE_CLIENT_ID: 'override', ADMIN_PASSWORD: 'ignored', SESSION_SECRET: 'ignored' }), { ...values, GOOGLE_CLIENT_ID: 'override' });
// Earlier deployments also encrypted the retired processor credentials in this object.
const previousIv = randomBytes(12);
const previousCipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), previousIv);
previousCipher.setAAD(Buffer.from(runtimeConfigPath));
const previous = {...values, STRIPE_SECRET_KEY:'retired-test-value', STRIPE_WEBHOOK_SECRET:'retired-hook', STRIPE_SHIPPING_RATE:'retired-rate'};
const previousBytes = Buffer.concat([previousCipher.update(JSON.stringify(previous)), previousCipher.final()]);
await bucket.put(runtimeConfigPath, JSON.stringify({...encrypted, iv:previousIv.toString('base64'), tag:previousCipher.getAuthTag().toString('base64'), ciphertext:previousBytes.toString('base64')}));
const beforeMigration = (await bucket.head(runtimeConfigPath)).etag;
assert.deepEqual(await readRuntimeConfig(bucket, {LEMRIX_CONFIG_KEY:key}), values);
const afterMigration = (await bucket.head(runtimeConfigPath)).etag;
assert.notEqual(afterMigration, beforeMigration);
assert.deepEqual(await readRuntimeConfig(bucket, {LEMRIX_CONFIG_KEY:key}), values);
assert.equal((await bucket.head(runtimeConfigPath)).etag, afterMigration);
await bucket.put(runtimeConfigPath, JSON.stringify(encryptRuntimeConfig({ ...values, GOOGLE_CLIENT_ID: 'fresh-client' }, key)));
assert.equal((await readRuntimeConfig(bucket, { LEMRIX_CONFIG_KEY: key })).GOOGLE_CLIENT_ID, 'fresh-client');
await assert.rejects(() => readRuntimeConfig(bucketFixture().bucket, { LEMRIX_CONFIG_KEY: key, ...values }), RuntimeConfigError);
await assert.rejects(() => readRuntimeConfig(bucket, { LEMRIX_CONFIG_KEY: 'invalid' }), RuntimeConfigError);
await assert.rejects(() => readRuntimeConfig(bucket, { LEMRIX_CONFIG_KEY: key, ADMIN_PASSWORD_HASH: 'invalid' }), RuntimeConfigError);
await assert.rejects(() => readRuntimeConfig({ get: async () => { throw new Error('secret-detail'); } }, { LEMRIX_CONFIG_KEY: key }), error => error instanceof RuntimeConfigError && !error.message.includes('secret-detail'));

console.log('Verified PBKDF2 password hashing, authenticated runtime encryption, pathname binding, allowed overrides and uncached required configuration.');
