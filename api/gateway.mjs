import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import application from '../dist/server/index.js';
import { createBlobBucket } from '../lib/blob-bucket.mjs';
import { readRuntimeConfig } from '../lib/runtime-config.mjs';

const PUBLIC_ORIGINS = new Set(['https://lemrix.vercel.app', 'https://lemrix-surf.vercel.app', 'https://lemrix.com.au', 'https://www.lemrix.com.au']);
const COOKIE_NAMES = new Set(['__Host-lemrix-admin', '__Host-lemrix-customer', '__Host-lemrix-google', '__Host-lemrix-pass']);
const READ_ONLY = new Set(['account', 'customer/session', 'rewards', 'rewards/code', 'rewards/art/hill-club', 'rewards/art/last-showing', 'rewards/art/after-hours']);
const WRITE_ONLY = new Set(['login', 'logout', 'logout-all', 'items/push', 'images', 'customer/challenge', 'customer/google', 'customer/logout', 'rewards/join', 'rewards/recover', 'checkout', 'checkout/status', 'checkout/cancel', 'square/webhook']);
const MAX_BODY = 4_400_000;

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function one(params, key) { const values = params.getAll(key); if (values.length !== 1) fail(400, 'Invalid shop request.'); return values[0]; }
function publicOrigin(request, env) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host)) fail(400, 'Invalid website address.');
  const origin = 'https://' + host.toLowerCase();
  const allowed = new Set(PUBLIC_ORIGINS);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    if (/^[a-z0-9-]+\.vercel\.app$/.test(env[key] || '')) allowed.add('https://' + env[key]);
  }
  if (!allowed.has(origin)) fail(400, 'Unknown website address.');
  return origin;
}
function route(params) {
  const resource = one(params, 'resource');
  if (resource === 'catalogue') return {pathname:'/shop/catalogue.js', methods:['GET', 'HEAD']};
  if (resource === 'media') {
    const id = one(params, 'id');
    if (!/^[a-f0-9]{32}$/.test(id)) fail(404, 'Image not found.');
    return {pathname:'/media/' + id, methods:['GET', 'HEAD']};
  }
  if (resource !== 'api') fail(404, 'Unknown shop route.');
  const path = one(params, 'path');
  if (path === 'items') return {pathname:'/api/items', methods:['GET', 'POST']};
  if (READ_ONLY.has(path)) return {pathname:'/api/' + path, methods:['GET']};
  if (WRITE_ONLY.has(path)) return {pathname:'/api/' + path, methods:['POST']};
  fail(404, 'Unknown shop route.');
}
function shopCookies(headers) {
  return headers.getSetCookie().filter(value => COOKIE_NAMES.has(value.slice(0, value.indexOf('='))) && /;\s*Path=\/(?:;|$)/i.test(value) && /;\s*Secure(?:;|$)/i.test(value) && /;\s*HttpOnly(?:;|$)/i.test(value) && !/;\s*Domain=/i.test(value));
}
async function bodyBytes(request) {
  if (Number(request.headers['content-length']) > MAX_BODY) fail(413, 'Choose an upload smaller than 4 MB.');
  const chunks = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY) fail(413, 'Choose an upload smaller than 4 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function clientIp(request) {
  // Vercel overwrites this header; do not accept arbitrary forwarding headers.
  const address = request.headers['x-vercel-forwarded-for'];
  return typeof address === 'string' && isIP(address) ? address : 'unknown';
}

export function createGateway({env = process.env, app = application, bucket, configLoader = readRuntimeConfig} = {}) {
  let storage = bucket;
  return async function gateway(request, response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const origin = publicOrigin(request, env);
      const selected = route(new URL(request.url, origin).searchParams);
      if (!selected.methods.includes(request.method)) fail(405, 'Method unavailable.');
      const webhook = selected.pathname === '/api/square/webhook';
      if (request.method === 'POST' && !webhook && request.headers.origin !== origin) fail(403, 'Invalid request origin.');
      if (!storage) {
        if (!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) fail(503, 'Shop storage is temporarily unavailable.');
        storage = createBlobBucket({token:env.BLOB_READ_WRITE_TOKEN, storeId:env.BLOB_STORE_ID});
      }
      const config = await configLoader(storage, env);
      const headers = new Headers();
      const incomingCookies = typeof request.headers.cookie === 'string' ? request.headers.cookie : '';
      const cookies = incomingCookies.split(/;\s*/).filter(part => COOKIE_NAMES.has(part.split('=')[0])).join('; ');
      if (cookies) headers.set('Cookie', cookies);
      if (request.headers.origin) headers.set('Origin', request.headers.origin);
      if (request.headers['content-type']) headers.set('Content-Type', request.headers['content-type']);
      if (webhook && request.headers['x-square-hmacsha256-signature']) headers.set('x-square-hmacsha256-signature', request.headers['x-square-hmacsha256-signature']);
      const body = request.method === 'POST' ? await bodyBytes(request) : undefined;
      const nativeRequest = new Request(origin + selected.pathname, {method:request.method === 'HEAD' ? 'GET' : request.method, headers, body});
      const result = await app.fetch(nativeRequest, {...env, ...config, BUCKET:storage, CLIENT_IP:clientIp(request), REQUIRE_STORED_CATALOGUE:true});
      response.statusCode = result.status;
      for (const key of ['content-type', 'content-disposition', 'retry-after']) {
        const value = result.headers.get(key);
        if (value) response.setHeader(key, value);
      }
      const cookiesOut = shopCookies(result.headers);
      if (cookiesOut.length) response.setHeader('Set-Cookie', cookiesOut);
      if (request.method === 'HEAD' || !result.body) { await result.body?.cancel(); response.end(); }
      else await pipeline(Readable.fromWeb(result.body), response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!error.status) console.error('Shop request failed:', error.name);
      response.statusCode = error.status || 503;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({error:error.status ? error.message : 'The shop service is temporarily unavailable. Please try again.'}));
    }
  };
}
export default createGateway();
