const customerPrefix = 'store/v1/customers/';
const customerCookie = '__Host-lemrix-customer';
const challengeCookie = '__Host-lemrix-google';
const customerLifetime = 60*60*24*14;
const identityProviders = {
  google: {setting:'GOOGLE_CLIENT_ID', name:'Google', issuers:['https://accounts.google.com','accounts.google.com'], keysUrl:'https://www.googleapis.com/oauth2/v3/certs'},
  apple: {setting:'APPLE_CLIENT_ID', name:'Apple', issuers:['https://appleid.apple.com'], keysUrl:'https://appleid.apple.com/auth/keys'},
};
const providerKeys = new Map();

function readCookie(request, name) {
  return (request.headers.get('Cookie') || '').split(/;\s*/).find(entry=>entry.startsWith(name+'='))?.slice(name.length+1);
}
function shopCookie(name, value, seconds) {
  return name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+seconds;
}
function unbase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid token encoding');
  return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
}
async function verifyCustomerToken(token, config, client, nonce) {
  const invalid = () => reject(401, config.name + ' could not verify this sign-in.');
  let head, claims, signature, message;
  try {
    const parts=token.split('.');
    if(parts.length!==3) throw new Error();
    head=JSON.parse(decoder.decode(unbase64url(parts[0])));
    claims=JSON.parse(decoder.decode(unbase64url(parts[1])));
    signature=unbase64url(parts[2]);
    message=encoder.encode(parts[0]+'.'+parts[1]);
  } catch { invalid(); }
  const now=Math.floor(Date.now()/1000);
  if(head?.alg!=='RS256' || !isText(head.kid,200) || !config.issuers.includes(claims?.iss) ||
    claims.aud!==client || (claims.azp && claims.azp!==client) || claims.nonce!==nonce ||
    !Number.isSafeInteger(claims.exp) || claims.exp<=now || !Number.isSafeInteger(claims.iat) ||
    claims.iat>now+60 || typeof claims.sub!=='string' || !/^[A-Za-z0-9._-]{1,255}$/.test(claims.sub) ||
    !isText(claims.email,320) || !(claims.email_verified===true || (config===identityProviders.apple && claims.email_verified==='true'))) invalid();

  let cached=providerKeys.get(config.keysUrl);
  if(!cached || Date.now()>=cached.expires) {
    const response=await fetch(config.keysUrl, {redirect:'error'});
    if (!response.ok) reject(503,config.name+' is temporarily unavailable.');
    const {keys}=await response.json();
    if (!Array.isArray(keys)) reject(503,config.name+' is temporarily unavailable.');
    const maxAge=Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/i)?.[1] || 300);
    cached={keys,expires:Date.now()+Math.min(86400,maxAge)*1000};
    providerKeys.set(config.keysUrl,cached);
  }
  const jwk=cached.keys.find(key=>key.kid===head.kid && key.kty==='RSA' && key.alg==='RS256');
  if (!jwk) invalid();
  const alg={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  const key=await crypto.subtle.importKey('jwk',jwk,alg,false,['verify']);
  if (!await crypto.subtle.verify(alg,key,signature,message)) invalid();
  return claims;
}
async function sessionPath(raw) {
  return customerPrefix+'sessions/'+hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));
}
async function customerSessionKey(request) {
  const raw=readCookie(request,customerCookie);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? sessionPath(raw) : null;
}
async function verifiedCustomer(request, env) {
  const key=await customerSessionKey(request);
  const stored=key && await env.BUCKET.get(key);
  const session=stored && await stored.json();
  return session?.expires>Date.now() ? session.user : null;
}
async function startCustomerSession(request,env,user) {
  const token=randomId()+randomId();
  const expires=Date.now()+customerLifetime*1000;
  await env.BUCKET.put(await sessionPath(token),JSON.stringify({expires,user}),{customMetadata:{expires:String(expires)}});
  const previous=await customerSessionKey(request);
  if(previous) await env.BUCKET.delete(previous);
  return json({user},200,{'Set-Cookie':shopCookie(customerCookie,token,customerLifetime)});
}
async function passwordAccount(request,env,register) {
  const {username,password}=await readForm(request);
  const name=typeof username==='string' ? username.trim() : '';
  if(!/^[A-Za-z0-9._-]{2,24}$/.test(name) || name.toLowerCase()==='lemrix')
    reject(400,'Choose a username with 2–24 letters, numbers, dots, dashes or underscores.');
  if(typeof password!=='string' || password.length>128 || password.length<(register?12:1))
    reject(400,register?'Use a password with 12–128 characters.':'Enter your password.');
  const address=String(env.CLIENT_IP || 'unknown');
  const rateKey=hex(await crypto.subtle.digest('SHA-256',encoder.encode(address)));
  await incrementLoginLimit(env,customerPrefix+'limits/ip/'+rateKey,40);
  const normalized=name.toLowerCase();
  if(normalized==='.' || normalized==='..') reject(400,'Choose another username.');
  const key=customerPrefix+'passwords/'+normalized;
  const user={key:'user/'+normalized,name};
  if(register) {
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const digest=await passwordDigest(password,salt);
    const hash='pbkdf2-sha256$600000$'+hex(salt)+'$'+hex(digest);
    const created=await env.BUCKET.put(key,JSON.stringify({name,hash}),{onlyIf:new Headers({'If-None-Match':'*'})});
    if(!created) reject(409,'That username is already in use. Sign in or choose another.');
  } else {
    await incrementLoginLimit(env,customerPrefix+'limits/username/'+normalized,20);
    const entry=await env.BUCKET.get(key);
    const account=entry && await entry.json();
    const expected=passwordParameters(account?.hash);
    const candidate=expected || {salt:new Uint8Array(16),digest:new Uint8Array(32)};
    if(!await verifyAdminPassword(password,candidate) || !expected) reject(401,'That username and password do not match.');
    user.name=account.name;
  }
  return startCustomerSession(request,env,user);
}
async function customerRoute(request,env,url) {
  const action=url.pathname.slice('/api/customer/'.length);
  const method=request.method;
  if(method==='POST') requireTrustedOrigin(request,url);
  if(action==='session' && method==='GET') return json({user:await verifiedCustomer(request,env)});
  if((action==='register' || action==='login') && method==='POST') return passwordAccount(request,env,action==='register');
  if(action==='logout' && method==='POST') {
    const sessionKey=await customerSessionKey(request);
    if(sessionKey) await env.BUCKET.delete(sessionKey);
    return json({ok:true},200,{'Set-Cookie':shopCookie(customerCookie,'',0)});
  }
  if(action==='challenge' && method==='POST') {
    const clients={};
    for (const [provider,config] of Object.entries(identityProviders)) {
      if (env[config.setting]) clients[provider]=env[config.setting];
    }
    if (!Object.keys(clients).length) return json({clients});
    const rawNonce=randomId()+randomId();
    const nonce=hex(await crypto.subtle.digest('SHA-256',encoder.encode(rawNonce)));
    return json({client:clients.google,clients,nonce},200,{'Set-Cookie':shopCookie(challengeCookie,rawNonce,600)});
  }
  const config=Object.hasOwn(identityProviders,action) && identityProviders[action];
  if(config && method==='POST') {
    if (!env[config.setting]) reject(503,config.name+' sign-in is awaiting activation.');
    const rawNonce=readCookie(request,challengeCookie);
    const body=await readForm(request);
    if (!/^[a-f0-9]{64}$/.test(rawNonce || '') || !isText(body.credential,16000)) reject(401,'Reopen sign-in and try again.');
    const nonce=hex(await crypto.subtle.digest('SHA-256',encoder.encode(rawNonce)));
    const claims=await verifyCustomerToken(body.credential,config,env[config.setting],nonce);
    const user={key:action+'/'+claims.sub,name:(typeof claims.name==='string' && claims.name.trim() || claims.email).slice(0,200),email:claims.email};
    const profileKey=customerPrefix+'profiles/'+(action==='google'?'':action+'/')+claims.sub;
    await env.BUCKET.put(profileKey,JSON.stringify(user));
    const result=await startCustomerSession(request,env,user);
    result.headers.append('Set-Cookie',shopCookie(challengeCookie,'',0));
    return result;
  }
  reject(404,'Unknown customer route.');
}
