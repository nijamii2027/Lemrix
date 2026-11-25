import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BACKEND = 'https://lemrix-tcg-illustrated.beefybag2.chatgpt.site';
const CANONICAL = 'https://lemrix.vercel.app';
const PUBLIC_ORIGINS = new Set([CANONICAL, 'https://lemrix-surf.vercel.app']);
const BRIDGE_COOKIE = '__Host-lemrix-connect';
const COOKIE_NAMES = new Set([
  '__Host-lemrix-admin', '__Host-lemrix-owner', '__Host-lemrix-customer',
  '__Host-lemrix-google', '__Host-lemrix-pass',
]);
const READ_ONLY = new Set(['account', 'customer/session', 'rewards', 'rewards/code',
  'rewards/art/hill-club', 'rewards/art/last-showing', 'rewards/art/after-hours']);
const WRITE_ONLY = new Set(['login', 'logout', 'logout-all', 'items/push', 'images',
  'customer/challenge', 'customer/google', 'customer/logout', 'rewards/join',
  'rewards/recover', 'checkout', 'checkout/status', 'checkout/cancel', 'stripe/webhook']);
const MAX_BODY = 4_400_000;
const HEX = /^[a-f0-9]{64}$/;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function one(params, key) {
  const values = params.getAll(key);
  if (values.length !== 1) fail(400, 'Invalid shop request.');
  return values[0];
}

function publicOrigin(request, env) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host)) fail(400, 'Invalid website address.');
  const origin = 'https://' + host.toLowerCase();
  const hosts = new Set(PUBLIC_ORIGINS);
  // Exact deployment hosts only; never trust a wildcard or forwarded-host header.
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    if (/^[a-z0-9-]+\.vercel\.app$/.test(env[key] || '')) hosts.add('https://' + env[key]);
  }
  if (!hosts.has(origin)) fail(400, 'Unknown website address.');
  return origin;
}

function route(params) {
  const resource = one(params, 'resource');
  if (resource === 'catalogue') return { pathname: '/shop/catalogue.js', methods: ['GET', 'HEAD'] };
  if (resource === 'media') {
    const id = one(params, 'id');
    if (!/^[a-f0-9]{32}$/.test(id)) fail(404, 'Image not found.');
    return { pathname: '/media/' + id, methods: ['GET', 'HEAD'] };
  }
  if (resource !== 'api') fail(404, 'Unknown shop route.');
  const path = one(params, 'path');
  if (path === 'owner/connect' || path === 'owner/callback') return { owner: path, methods: ['GET'] };
  if (path === 'items') return { pathname: '/api/items', methods: ['GET', 'POST'] };
  if (READ_ONLY.has(path)) return { pathname: '/api/' + path, methods: ['GET'] };
  if (WRITE_ONLY.has(path)) return { pathname: '/api/' + path, methods: ['POST'] };
  fail(404, 'Unknown shop route.');
}

function cookieValue(header, name) {
  const entries = (header || '').split(/;\s*/).filter(part => part.startsWith(name + '='));
  if (entries.length !== 1) return null;
  return entries[0].slice(name.length + 1);
}

function cookies(header) {
  return (header || '').split(/;\s*/).filter(part => COOKIE_NAMES.has(part.split('=')[0])).join('; ');
}

function shopCookies(headers) {
  return headers.getSetCookie().filter(value => {
    const name = value.slice(0, value.indexOf('='));
    return COOKIE_NAMES.has(name) && /;\s*Path=\/(?:;|$)/i.test(value) &&
      /;\s*Secure(?:;|$)/i.test(value) && /;\s*HttpOnly(?:;|$)/i.test(value) && !/;\s*Domain=/i.test(value);
  });
}

function transientCookie(value, seconds) {
  return `${BRIDGE_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}

function noStore(response) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('CDN-Cache-Control', 'no-store');
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

function redirect(response, location, values) {
  if (values?.length) response.setHeader('Set-Cookie', values);
  response.statusCode = 303;
  response.setHeader('Location', location);
  response.end();
}

async function bodyBytes(request) {
  if (Number(request.headers['content-length']) > MAX_BODY) fail(413, 'Choose an upload smaller than 4 MB.');
  const parts = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY) fail(413, 'Choose an upload smaller than 4 MB.');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export function createGateway({ env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  function headersFor(origin, request) {
    if (!env.LEMRIX_BACKEND_TOKEN) fail(503, 'The shop connection is being configured. Please try again shortly.');
    const headers = new Headers({
      'OAI-Sites-Authorization': 'Bearer ' + env.LEMRIX_BACKEND_TOKEN,
      Origin: origin, Accept: '*/*',
    });
    const cookie = cookies(request.headers.cookie);
    if (cookie) headers.set('Cookie', cookie);
    return headers;
  }

  async function ownerConnect(response, origin) {
    if (!PUBLIC_ORIGINS.has(origin)) fail(400, 'Open lemrix.vercel.app to verify the owner account.');
    const state = randomBytes(32).toString('hex');
    const verifier = randomBytes(32).toString('hex');
    const challenge = createHash('sha256').update(verifier).digest('hex');
    const proof = Buffer.from(JSON.stringify({ state, verifier, origin, expires: now() + 10 * 60_000 })).toString('base64url');
    const authorize = new URL('/api/owner-bridge/authorize', BACKEND);
    for (const [key, value] of Object.entries({ origin, state, challenge })) authorize.searchParams.set(key, value);
    const signin = new URL('/signin-with-chatgpt', BACKEND);
    signin.searchParams.set('return_to', authorize.pathname + authorize.search);
    redirect(response, signin.href, [transientCookie(proof, 600)]);
  }

  async function ownerCallback(request, response, origin, params) {
    let proof;
    try { proof = JSON.parse(Buffer.from(cookieValue(request.headers.cookie, BRIDGE_COOKIE) || '', 'base64url').toString()); }
    catch { fail(400, 'Owner verification expired. Return to the shop account and try again.'); }
    const state = one(params, 'state'), code = one(params, 'code');
    if (!PUBLIC_ORIGINS.has(origin) || !proof || proof.origin !== origin ||
        !Number.isFinite(proof.expires) || proof.expires <= now() || proof.expires > now() + 10 * 60_000 ||
        !HEX.test(state) || !HEX.test(code) || !HEX.test(proof.state || '') || !HEX.test(proof.verifier || '') ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(proof.state))) {
      fail(400, 'Owner verification expired. Return to the shop account and try again.');
    }
    const headers = headersFor(origin, request);
    headers.set('Content-Type', 'application/json');
    const upstream = await fetcher(BACKEND + '/api/owner-bridge/exchange', {
      method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ code, verifier: proof.verifier, origin, state }),
    });
    const values = shopCookies(upstream.headers);
    if (!upstream.ok || !values.some(value => value.startsWith('__Host-lemrix-owner='))) {
      fail(401, 'Owner verification could not be completed. Return to the shop account and try again.');
    }
    await upstream.body?.cancel();
    redirect(response, '/shop/#account', [...values, transientCookie('', 0)]);
  }

  return async function gateway(request, response) {
    noStore(response);
    try {
      const origin = publicOrigin(request, env);
      const url = new URL(request.url, origin);
      const selected = route(url.searchParams);
      if (!selected.methods.includes(request.method)) fail(405, 'Method unavailable.');
      const webhook = selected.pathname === '/api/stripe/webhook';
      if (request.method === 'POST' && !webhook && request.headers.origin !== origin) {
        fail(403, 'Invalid request origin.');
      }
      if (selected.owner === 'owner/connect') return await ownerConnect(response, origin);
      if (selected.owner === 'owner/callback') return await ownerCallback(request, response, origin, url.searchParams);

      // Preview URLs are exact Vercel-provided hosts. Public callbacks always use the stable domain.
      const publicSite = PUBLIC_ORIGINS.has(origin) ? origin : CANONICAL;
      const headers = headersFor(publicSite, request);
      if (request.headers['content-type']) headers.set('Content-Type', request.headers['content-type']);
      if (webhook && request.headers['stripe-signature']) headers.set('Stripe-Signature', request.headers['stripe-signature']);
      const body = request.method === 'POST' ? await bodyBytes(request) : undefined;
      const upstream = await fetcher(BACKEND + selected.pathname, {
        method: request.method === 'HEAD' ? 'GET' : request.method,
        headers, body, redirect: 'manual', signal: AbortSignal.timeout(25_000),
      });
      // Dynamic endpoints must return data; never send a shopper to the upstream site.
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        fail(502, 'The shop service could not complete this request. Please try again.');
      }
      response.statusCode = upstream.status;
      for (const name of ['content-type', 'content-disposition']) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      const values = shopCookies(upstream.headers);
      if (values.length) response.setHeader('Set-Cookie', values);
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel();
        response.end();
      } else {
        await pipeline(Readable.fromWeb(upstream.body), response);
      }
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error.status || 502;
      if (!error.status) console.error('Shop gateway request failed:', error.name);
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: error.status ? error.message : 'The shop service is temporarily unavailable. Please try again.' }));
    }
  };
}

export default createGateway();
