const adminUsername = 'Lemrix';
const adminCookieName = '__Host-lemrix-admin';
const adminSessionPrefix = 'store/v2/admin-sessions/';
const adminGenerationKey = 'store/v1/admin-generation';
const adminRatePrefix = 'store/v2/admin-login-limits/';
const adminSessionLifetime = 8 * 60 * 60;
const adminRateWindow = 15 * 60 * 1000;

function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g), byte => Number.parseInt(byte, 16));
}

function passwordParameters(value) {
  const match = typeof value === 'string' && value.match(/^pbkdf2-sha256\$600000\$([a-f0-9]{32,128})\$([a-f0-9]{64})$/);
  if (!match || match[1].length % 2) return null;
  return {salt:fromHex(match[1]), digest:fromHex(match[2])};
}

function requireAdminConfiguration(env) {
  const password = passwordParameters(env.ADMIN_PASSWORD_HASH);
  if (!password || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    reject(503, 'Admin credentials have not been configured.');
  }
  return password;
}

async function adminSigningKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}

function sessionMessage(env, id) {
  // The new context excludes every platform identity. Changing the password
  // hash or signing secret also invalidates previously issued sessions.
  return encoder.encode('lemrix-native-admin-v2|' + env.ADMIN_PASSWORD_HASH + '|' + id);
}

function adminCookie(value, seconds) {
  return adminCookieName + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + seconds;
}

async function sessionId(request, env) {
  if (!passwordParameters(env.ADMIN_PASSWORD_HASH) || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) return null;
  const token = (request.headers.get('Cookie') || '').split(/;\s*/).find(value => value.startsWith(adminCookieName + '='))?.slice(adminCookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return null;
  const [id, signature] = token.split('.');
  if (!await crypto.subtle.verify('HMAC', await adminSigningKey(env), fromHex(signature), sessionMessage(env, id))) return null;
  const entry = await env.BUCKET.head(adminSessionPrefix + id);
  const expires = Number(entry?.customMetadata?.expires);
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) return null;
  const generation = await env.BUCKET.head(adminGenerationKey);
  if ((entry.customMetadata.generation || '') !== (generation?.customMetadata?.generation || '')) return null;
  return {id, expires};
}

async function owner(request, env) {
  return Boolean(await sessionId(request, env));
}

async function incrementLoginLimit(env, key, maximum) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const object = await env.BUCKET.get(key);
    const previous = object && await object.json();
    const now = Date.now();
    if (previous && (!Number.isSafeInteger(previous.expires) || !Number.isSafeInteger(previous.attempts) || previous.attempts < 0)) {
      reject(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
    }
    const active = previous?.expires > now;
    if (active && previous.attempts >= maximum) {
      reject(429, 'Too many sign-in attempts. Please try again later.', {'Retry-After':String(Math.max(1, Math.ceil((previous.expires - now) / 1000)))});
    }
    const next = {attempts:active ? previous.attempts + 1 : 1, expires:active ? previous.expires : now + adminRateWindow};
    const onlyIf = new Headers(object ? {'If-Match':'"' + object.etag + '"'} : {'If-None-Match':'*'});
    if (await env.BUCKET.put(key, JSON.stringify(next), {onlyIf, httpMetadata:{contentType:'application/json'}, customMetadata:{expires:String(next.expires)}})) return;
  }
  reject(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
}

async function limitAdminLogin(env) {
  // CLIENT_IP is supplied by the server adapter, never read from request data.
  // A missing address shares one stable bucket instead of bypassing the limit.
  const ip = typeof env.CLIENT_IP === 'string' && env.CLIENT_IP.length > 0 && env.CLIENT_IP.length <= 128 ? env.CLIENT_IP : 'unknown';
  const key = await adminSigningKey(env);
  const id = hex(await crypto.subtle.sign('HMAC', key, encoder.encode('lemrix-login-ip-v1|' + ip)));
  await incrementLoginLimit(env, adminRatePrefix + id, 15);
  // Limit distributed guessing without letting one address exhaust this cap.
  await incrementLoginLimit(env, adminRatePrefix + 'global', 300);
}

async function verifyAdminPassword(candidate, expected) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(candidate), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', iterations:600000, salt:expected.salt}, key, 256));
  let different = 0;
  for (let index = 0; index < expected.digest.length; index++) different |= actual[index] ^ expected.digest[index];
  return different === 0;
}

async function adminLogin(request, env) {
  const expected = requireAdminConfiguration(env);
  await limitAdminLogin(env);
  const body = await readForm(request);
  if (!isText(body.password, 256)) reject(401, 'Incorrect login');
  const matches = await verifyAdminPassword(body.password, expected);
  if (body.username !== adminUsername || !matches) reject(401, 'Incorrect login');
  const id = randomId() + randomId();
  const signature = hex(await crypto.subtle.sign('HMAC', await adminSigningKey(env), sessionMessage(env, id)));
  const generation = await env.BUCKET.head(adminGenerationKey);
  const created = await env.BUCKET.put(adminSessionPrefix + id, '1', {onlyIf:new Headers({'If-None-Match':'*'}), customMetadata:{
    generation:generation?.customMetadata?.generation || '', expires:String(Date.now() + adminSessionLifetime * 1000),
  }});
  if (!created) reject(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
  const previous = await sessionId(request, env);
  if (previous) await env.BUCKET.delete(adminSessionPrefix + previous.id);
  return json({ok:true}, 200, {'Set-Cookie':adminCookie(id + '.' + signature, adminSessionLifetime)});
}

async function adminLogout(env, session, all) {
  if (all) await env.BUCKET.put(adminGenerationKey, '1', {customMetadata:{generation:randomId()}});
  await env.BUCKET.delete(adminSessionPrefix + session.id);
  return json({ok:true}, 200, {'Set-Cookie':adminCookie('', 0)});
}
