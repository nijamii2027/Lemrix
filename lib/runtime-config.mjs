import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

export const runtimeConfigPath = 'store/v2/runtime/config.json';
const allowedKeys = new Set(['ADMIN_PASSWORD_HASH', 'STRIPE_SECRET_KEY', 'STRIPE_SHIPPING_RATE', 'STRIPE_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID']);
const derive = promisify(pbkdf2);

export class RuntimeConfigError extends Error {
  constructor() {
    super('The shop runtime configuration is unavailable.');
    this.name = 'RuntimeConfigError';
  }
}

function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new RuntimeConfigError();
  return Buffer.from(value, 'hex');
}

function decodeBase64(value, length) {
  if (typeof value !== 'string') throw new RuntimeConfigError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new RuntimeConfigError();
  return bytes;
}

function validHash(value) {
  const match = typeof value === 'string' && value.match(/^pbkdf2-sha256\$600000\$([a-f0-9]{32,128})\$([a-f0-9]{64})$/);
  return Boolean(match && match[1].length % 2 === 0);
}

function configurationValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeConfigError();
  const entries = Object.entries(value);
  if (entries.some(([key, item]) => !allowedKeys.has(key) || typeof item !== 'string')) throw new RuntimeConfigError();
  if (!validHash(value.ADMIN_PASSWORD_HASH)) throw new RuntimeConfigError();
  return Object.fromEntries(entries);
}

/** Create the native admin hash; the salt is 16 random bytes, encoded as hex. */
export async function hashAdminPassword(password) {
  if (typeof password !== 'string' || !password.trim() || password.length > 256) throw new RuntimeConfigError();
  const salt = randomBytes(16);
  const digest = await derive(password, salt, 600000, 32, 'sha256');
  return 'pbkdf2-sha256$600000$' + salt.toString('hex') + '$' + digest.toString('hex');
}

/** The ciphertext is bound to this exact private object pathname by GCM AAD. */
export function encryptRuntimeConfig(values, keyHex) {
  const configuration = configurationValues(values);
  const key = encryptionKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(runtimeConfigPath, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(configuration), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptRuntimeConfig(envelope, keyHex) {
  try {
    if (!envelope || envelope.v !== 1) throw new RuntimeConfigError();
    const key = encryptionKey(keyHex);
    const iv = decodeBase64(envelope.iv, 12);
    const tag = decodeBase64(envelope.tag, 16);
    const ciphertext = decodeBase64(envelope.ciphertext);
    if (!ciphertext.length) throw new RuntimeConfigError();
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(runtimeConfigPath, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return configurationValues(JSON.parse(plaintext.toString('utf8')));
  } catch {
    // Do not propagate crypto/parser messages or partially decrypted content.
    throw new RuntimeConfigError();
  }
}

/** Always read the required encrypted object. Only the five allowed env keys override it. */
export async function readRuntimeConfig(bucket, env = process.env) {
  try {
    encryptionKey(env.LEMRIX_CONFIG_KEY);
    if (!bucket || typeof bucket.get !== 'function') throw new RuntimeConfigError();
    const object = await bucket.get(runtimeConfigPath);
    if (!object) throw new RuntimeConfigError();
    const values = decryptRuntimeConfig(await object.json(), env.LEMRIX_CONFIG_KEY);
    for (const key of allowedKeys) {
      if (env[key] !== undefined) values[key] = env[key];
    }
    return configurationValues(values);
  } catch {
    throw new RuntimeConfigError();
  }
}
