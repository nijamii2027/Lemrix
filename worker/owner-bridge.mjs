const ownerProofCookie = '__Host-lemrix-owner';
const ownerBridgePrefix = 'store/v1/owner-bridge/';
const ownerProofPrefix = 'store/v1/owner-proofs/';
const ownerBridgeLifetime = 5 * 60;
const ownerProofLifetime = 8 * 60 * 60;
const bridgeTokenPattern = /^[a-f0-9]{64}$/;

function trustedSiteOwner(request, env) {
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return Boolean(email && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.trim().toLowerCase());
}

async function ownerBridgeDigest(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function ownerGeneration(env) {
  const object = await env.BUCKET.head('store/v1/admin-generation');
  return object?.customMetadata?.generation || '';
}

function ownerProofSetCookie(value, seconds) {
  return ownerProofCookie + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + seconds;
}

async function readOwnerProof(request, env) {
  const token = readCookie(request, ownerProofCookie);
  if (!bridgeTokenPattern.test(token || '')) return null;
  const key = ownerProofPrefix + await ownerBridgeDigest(token);
  const object = await env.BUCKET.get(key);
  if (!object) return null;
  const record = await object.json();
  if (!Number.isSafeInteger(record.expires) || record.expires <= Date.now() ||
      record.owner !== env.ADMIN_EMAIL?.trim().toLowerCase() ||
      record.origin !== ownerRequestOrigin(request) ||
      !publicStorefrontOrigins.has(record.origin) ||
      record.generation !== await ownerGeneration(env)) return null;
  return {key, record};
}

async function revokeOwnerProof(request, env) {
  const proof = await readOwnerProof(request, env);
  if (proof) await env.BUCKET.delete(proof.key);
}

async function ownerBridgeRoute(request, env, url) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    reject(503, 'Admin credentials have not been configured.');
  }
  if (url.pathname === '/api/owner-bridge/authorize') {
    if (request.method !== 'GET') reject(405, 'Use GET for owner verification.');
    // Only the hosting platform's verified identity can issue a bridge code.
    // A previously issued bridge cookie is deliberately insufficient here.
    if (!trustedSiteOwner(request, env)) reject(403, 'Verify the site owner account first.');
    const origin = url.searchParams.get('origin');
    const state = url.searchParams.get('state');
    const challenge = url.searchParams.get('challenge');
    if (!publicStorefrontOrigins.has(origin) ||
        !bridgeTokenPattern.test(state || '') || !bridgeTokenPattern.test(challenge || '')) {
      reject(400, 'Invalid owner verification request.');
    }
    const code = randomId() + randomId();
    const key = ownerBridgePrefix + await ownerBridgeDigest(code);
    const record = {
      origin, state, challenge, owner:env.ADMIN_EMAIL.trim().toLowerCase(),
      expires:Date.now() + ownerBridgeLifetime * 1000,
      generation:await ownerGeneration(env),
    };
    const created = await env.BUCKET.put(key, JSON.stringify(record), {
      onlyIf:new Headers({'If-None-Match':'*'}),
      httpMetadata:{contentType:'application/json'},
    });
    if (!created) reject(503, 'Owner verification could not start. Please retry.');
    const callback = new URL('/api/owner/callback', origin);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', state);
    return new Response(null, {status:302, headers:{
      ...errors, 'Referrer-Policy':'no-referrer', Location:callback.href,
    }});
  }
  if (url.pathname !== '/api/owner-bridge/exchange') reject(404, 'Unknown owner verification route.');
  if (request.method !== 'POST') reject(405, 'Use POST for owner verification.');
  const requestOrigin = requireTrustedOrigin(request, url);
  const body = await readForm(request, 4096);
  if (!publicStorefrontOrigins.has(body.origin) || body.origin !== requestOrigin ||
      !bridgeTokenPattern.test(body.code || '') || !bridgeTokenPattern.test(body.verifier || '') ||
      !bridgeTokenPattern.test(body.state || '')) reject(400, 'Invalid owner verification request.');
  const key = ownerBridgePrefix + await ownerBridgeDigest(body.code);
  const object = await env.BUCKET.get(key);
  const record = object && await object.json();
  if (!record || record.consumed || !Number.isSafeInteger(record.expires) || record.expires <= Date.now() ||
      record.origin !== body.origin || record.state !== body.state ||
      record.owner !== env.ADMIN_EMAIL.trim().toLowerCase() ||
      record.challenge !== await ownerBridgeDigest(body.verifier) ||
      record.generation !== await ownerGeneration(env)) {
    reject(401, 'Owner verification expired or could not be validated. Start again.');
  }
  // The conditional write makes the code single-use even across concurrent
  // Worker instances. A failed exchange cannot mint an owner cookie.
  const consumed = await env.BUCKET.put(key, JSON.stringify({consumed:true, expires:record.expires}), {
    onlyIf:new Headers({'If-Match':'"' + object.etag + '"'}),
    httpMetadata:{contentType:'application/json'},
  });
  if (!consumed) reject(401, 'Owner verification was already used. Start again.');
  const token = randomId() + randomId();
  const expires = Date.now() + ownerProofLifetime * 1000;
  const created = await env.BUCKET.put(ownerProofPrefix + await ownerBridgeDigest(token), JSON.stringify({
    owner:record.owner, origin:record.origin, generation:record.generation, expires,
  }), {onlyIf:new Headers({'If-None-Match':'*'}), httpMetadata:{contentType:'application/json'}});
  if (!created) reject(503, 'Owner verification could not finish. Start again.');
  return json({ok:true, expires}, 200, {'Set-Cookie':ownerProofSetCookie(token, ownerProofLifetime)});
}
