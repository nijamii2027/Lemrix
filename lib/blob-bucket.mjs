import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

const format = 'lemrix-r2-envelope-v1';
const httpHeaders = {
  contentType: 'content-type',
  contentLanguage: 'content-language',
  contentDisposition: 'content-disposition',
  contentEncoding: 'content-encoding',
  cacheControl: 'cache-control',
  cacheExpiry: 'expires',
};

export class BlobBucketDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlobBucketDataError';
  }
}

function canonicalPath(value, { empty = false, trailingSlash = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value) ||
      !/^[A-Za-z0-9._/-]*$/.test(value) || value.startsWith('/') ||
      (!trailingSlash && value.endsWith('/')) ||
      value.split('/').some((part, index, parts) =>
        part === '.' || part === '..' || (!part && !(index === parts.length - 1 && (trailingSlash || empty))))) {
    throw new TypeError('Blob bucket keys must be canonical relative paths.');
  }
  return value;
}

function metadataRecord(value, { http = false } = {}) {
  if (value === undefined) return {};
  if (http && value instanceof Headers) {
    return metadataRecord(Object.fromEntries(Object.entries(httpHeaders)
      .filter(([, header]) => value.has(header))
      .map(([field, header]) => [field, value.get(header)])), { http: true });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Blob bucket metadata must be an object.');
  }
  const entries = Object.entries(value).map(([key, item]) => {
    if (http && !Object.hasOwn(httpHeaders, key)) throw new TypeError('Unsupported HTTP metadata field.');
    if (http && key === 'cacheExpiry') {
      const date = item instanceof Date ? item : new Date(item);
      if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid HTTP cache expiry.');
      return [key, date.toISOString()];
    }
    if (typeof item !== 'string') throw new TypeError('Blob bucket metadata values must be strings.');
    return [key, item];
  });
  return Object.fromEntries(entries);
}

function strongEtag(value) {
  if (typeof value !== 'string' || !value || value.startsWith('W/')) {
    throw new TypeError('A strong Blob ETag is required.');
  }
  const quoted = value.startsWith('"') || value.endsWith('"');
  const normalized = quoted ? value.slice(1, -1) : value;
  if ((quoted && !/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value)) ||
      (!quoted && !/^[\x21\x23-\x7e\x80-\xff]+$/.test(value)) || normalized === '*') {
    throw new TypeError('A single strong Blob ETag is required.');
  }
  return normalized;
}

function writeCondition(onlyIf) {
  if (onlyIf === undefined) return { allowOverwrite: true };
  const headers = onlyIf instanceof Headers ? onlyIf : new Headers(onlyIf);
  for (const name of headers.keys()) {
    if (name !== 'if-match' && name !== 'if-none-match') throw new TypeError('Unsupported Blob write condition.');
  }
  const match = headers.get('if-match');
  const none = headers.get('if-none-match');
  if (match !== null && none !== null) throw new TypeError('Use only one Blob write condition.');
  if (none !== null) {
    if (none !== '*') throw new TypeError('Only If-None-Match: * is supported for Blob writes.');
    return { allowOverwrite: false };
  }
  if (match !== null) {
    if (!match.startsWith('"') || !match.endsWith('"')) throw new TypeError('If-Match requires one quoted strong ETag.');
    return { allowOverwrite: true, ifMatch: '"' + strongEtag(match) + '"' };
  }
  return { allowOverwrite: true };
}

async function bodyBytes(value) {
  if (value === null) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Blob || value instanceof ReadableStream) {
    return Buffer.from(await new Response(value).arrayBuffer());
  }
  throw new TypeError('Blob bucket bodies must be strings, bytes, Blobs, streams, or null.');
}

function conflict(error, sdk, condition) {
  if (condition.ifMatch || condition.allowOverwrite === false) {
    if (typeof sdk.BlobPreconditionFailedError === 'function' && error instanceof sdk.BlobPreconditionFailedError) return true;
  }
  // The SDK reports create-only collisions as a generic BlobError. Provider
  // wording varies ("File already exists", "A blob with this pathname already
  // exists", etc.). Require that specific object-collision sentence, the SDK
  // class and a create-only write; never mask store/auth/service failures.
  return condition.allowOverwrite === false && typeof sdk.BlobError === 'function' &&
    error instanceof sdk.BlobError &&
    /^Vercel Blob:\s+(?:(?:this|the|a|an)\s+)?(?:blob|file|object)(?:\s+(?:at|with)\b[^;\r\n]*)?\s+already exists\b/i.test(error.message);
}

function objectMetadata(key, envelope, blob) {
  const etag = strongEtag(blob.etag);
  const httpMetadata = { ...envelope.httpMetadata };
  if (httpMetadata.cacheExpiry) httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
  const uploaded = new Date(blob.uploadedAt || envelope.uploaded);
  if (!Number.isFinite(uploaded.getTime())) throw new BlobBucketDataError('Invalid Blob upload date.');
  return {
    key,
    version: envelope.revision,
    size: envelope.size,
    etag,
    httpEtag: '"' + etag + '"',
    uploaded,
    httpMetadata,
    customMetadata: { ...envelope.customMetadata },
    writeHttpMetadata(headers) {
      for (const [field, value] of Object.entries(httpMetadata)) {
        headers.set(httpHeaders[field], value instanceof Date ? value.toUTCString() : value);
      }
    },
  };
}

function unpack(envelope) {
  if (!envelope || envelope.format !== format || typeof envelope.data !== 'string' ||
      !Number.isSafeInteger(envelope.size) || envelope.size < 0 ||
      typeof envelope.revision !== 'string' || !envelope.revision ||
      typeof envelope.uploaded !== 'string') {
    throw new BlobBucketDataError('Invalid Blob bucket envelope.');
  }
  const bytes = Buffer.from(envelope.data, 'base64');
  if (bytes.length !== envelope.size || bytes.toString('base64') !== envelope.data) {
    throw new BlobBucketDataError('Invalid Blob bucket payload.');
  }
  try {
    envelope.httpMetadata = metadataRecord(envelope.httpMetadata, { http: true });
    envelope.customMetadata = metadataRecord(envelope.customMetadata);
  } catch {
    throw new BlobBucketDataError('Invalid Blob bucket metadata.');
  }
  return bytes;
}

/**
 * R2-compatible storage for the shop's get/head/put/delete/list operations.
 * Each canonical R2 key maps to `${prefix}${key}` in a PRIVATE Blob store.
 * One versioned JSON envelope atomically holds base64 bytes and both metadata
 * records. Blob size/content-type describe that envelope; returned R2 values
 * describe the original object. This is deliberately not a raw-Blob reader.
 *
 * Inject the @vercel/blob module as `sdk` for tests; otherwise it is imported
 * lazily. Omit credentials to use the SDK's Vercel OIDC/environment resolution.
 * The default prefix is empty. No data, session, or metadata reads are cached.
 */
export function createBlobBucket({ sdk, token, storeId, oidcToken, prefix = '' } = {}) {
  canonicalPath(prefix, { empty: true, trailingSlash: true });
  if (prefix && !prefix.endsWith('/')) throw new TypeError('The Blob bucket prefix must end with /.');
  const credentials = Object.fromEntries(Object.entries({ token, storeId, oidcToken }).filter(([, value]) => value !== undefined));
  let sdkPromise;
  const getSdk = () => sdkPromise ||= sdk ? Promise.resolve(sdk) : import('@vercel/blob');
  const pathname = key => prefix + canonicalPath(key);

  async function read(key, withBody) {
    const path = pathname(key);
    const client = await getSdk();
    // Content encoding can turn the transfer ETag into a weak validator. Read
    // the identity representation so its strong ETag remains usable for CAS.
    const result = await client.get(path, { ...credentials, access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
    if (result === null) return null;
    if (result?.statusCode !== 200 || !result.stream || !result.blob) {
      throw new BlobBucketDataError('Unexpected private Blob response.');
    }
    let envelope;
    try { envelope = await new Response(result.stream).json(); }
    catch { throw new BlobBucketDataError('Unreadable Blob bucket envelope.'); }
    const bytes = unpack(envelope);
    const object = objectMetadata(key, envelope, result.blob);
    if (!withBody) return object;
    const response = new Response(bytes, { headers: envelope.httpMetadata.contentType ? { 'content-type': envelope.httpMetadata.contentType } : {} });
    return Object.defineProperties(object, {
      body: { enumerable: true, value: response.body },
      bodyUsed: { enumerable: true, get: () => response.bodyUsed },
      arrayBuffer: { value: () => response.arrayBuffer() },
      text: { value: () => response.text() },
      json: { value: () => response.json() },
      blob: { value: () => response.blob() },
    });
  }

  return {
    get: key => read(key, true),
    head: key => read(key, false),
    async put(key, value, { onlyIf, httpMetadata, customMetadata } = {}) {
      const path = pathname(key);
      const condition = writeCondition(onlyIf);
      const metadata = { httpMetadata: metadataRecord(httpMetadata, { http: true }), customMetadata: metadataRecord(customMetadata) };
      const bytes = await bodyBytes(value);
      const envelope = {
        format,
        revision: randomUUID(),
        uploaded: new Date().toISOString(),
        size: bytes.length,
        data: bytes.toString('base64'),
        ...metadata,
      };
      const client = await getSdk();
      let result;
      try {
        result = await client.put(path, JSON.stringify(envelope), {
          ...credentials, access: 'private', addRandomSuffix: false,
          contentType: 'application/json; charset=utf-8', ...condition,
        });
      } catch (error) {
        if (conflict(error, client, condition)) return null;
        throw error;
      }
      return objectMetadata(key, envelope, result);
    },
    async delete(keyOrKeys) {
      const paths = Array.isArray(keyOrKeys) ? keyOrKeys.map(pathname) : pathname(keyOrKeys);
      if (Array.isArray(paths) && !paths.length) return;
      const client = await getSdk();
      await client.del(paths, { ...credentials });
    },
    async list({ prefix: keyPrefix = '', cursor, limit = 1000 } = {}) {
      canonicalPath(keyPrefix, { empty: true, trailingSlash: true });
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('List limit must be between 1 and 1000.');
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor)) throw new TypeError('Invalid Blob list cursor.');
      const client = await getSdk();
      const result = await client.list({ ...credentials, prefix: prefix + keyPrefix, limit, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.blobs) || typeof result.hasMore !== 'boolean' || (result.hasMore && !result.cursor)) {
        throw new BlobBucketDataError('Invalid Blob listing.');
      }
      // List metadata describes envelopes; read them consistently to return
      // original sizes and metadata. Listing is intended for migration, not auth.
      const objects = [];
      for (const entry of result.blobs) {
        if (typeof entry.pathname !== 'string' || !entry.pathname.startsWith(prefix + keyPrefix)) {
          throw new BlobBucketDataError('Blob listing escaped its prefix.');
        }
        const object = await read(entry.pathname.slice(prefix.length), false);
        if (object) objects.push(object); // An object may have been deleted since listing.
      }
      return { objects, truncated: result.hasMore, ...(result.hasMore ? { cursor: result.cursor } : {}), delimitedPrefixes: [] };
    },
  };
}
