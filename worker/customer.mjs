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
function supabaseProject(env) {
  if (!env.SUPABASE_URL && !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const url=URL.canParse(env.SUPABASE_URL) && new URL(env.SUPABASE_URL);
  if (!url || url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || !env.SUPABASE_PUBLISHABLE_KEY)
    reject(503,'Customer sign-in configuration is incomplete.');
  return url.origin;
}
async function confirmSupabaseIdentity(project,env,provider,credential,rawNonce,subject) {
  const response=await fetch(project+'/auth/v1/token?grant_type=id_token', {
    method:'POST', redirect:'error',
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({provider,id_token:credential,nonce:rawNonce})
  });
  if (!response.ok) reject(response.status>=500?503:401,'The account sign-in service could not confirm this login.');
  const {user}=await response.json();
  // Match the verified provider subject. E-mail and client-editable metadata
  // alone are insufficient to link an existing collector account.
  if (typeof user?.id!=='string' || !user.identities?.some(i=>i.provider===provider && i.identity_data?.sub===subject))
    reject(401,'The sign-in service returned an unexpected identity.');
  return user.id;
}
async function sessionPath(raw) {
  return customerPrefix+'sessions/'+hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));
}
async function customerRoute(request,env,url) {
  const action=url.pathname.slice('/api/customer/'.length);
  const method=request.method;
  if(method==='POST') requireTrustedOrigin(request,url);
  const raw=readCookie(request,customerCookie);
  const sessionKey=raw && /^[a-f0-9]{64}$/.test(raw) ? await sessionPath(raw) : null;
  if(action==='session' && method==='GET') {
    const stored=sessionKey && await env.BUCKET.get(sessionKey);
    const session=stored && await stored.json();
    return json({user:session?.expires>Date.now()?session.user:null});
  }
  if(action==='logout' && method==='POST') {
    if(sessionKey) await env.BUCKET.delete(sessionKey);
    return json({ok:true},200,{'Set-Cookie':shopCookie(customerCookie,'',0)});
  }
  if(action==='challenge' && method==='POST') {
    const clients={};
    for (const [provider,config] of Object.entries(identityProviders)) {
      if (env[config.setting]) clients[provider]=env[config.setting];
    }
    if (!Object.keys(clients).length) reject(503,'Customer sign-in is awaiting activation.');
    supabaseProject(env);
    const rawNonce=randomId()+randomId();
    const nonce=hex(await crypto.subtle.digest('SHA-256',encoder.encode(rawNonce)));
    return json({client:clients.google,clients,nonce},200,{'Set-Cookie':shopCookie(challengeCookie,rawNonce,600)});
  }
  const config=Object.hasOwn(identityProviders,action) && identityProviders[action];
  if(config && method==='POST') {
    if (!env[config.setting]) reject(503,config.name+' sign-in is awaiting activation.');
    const project=supabaseProject(env);
    const rawNonce=readCookie(request,challengeCookie);
    const body=await readForm(request);
    if (!/^[a-f0-9]{64}$/.test(rawNonce || '') || !isText(body.credential,16000)) reject(401,'Reopen sign-in and try again.');
    const nonce=hex(await crypto.subtle.digest('SHA-256',encoder.encode(rawNonce)));
    const claims=await verifyCustomerToken(body.credential,config,env[config.setting],nonce);
    let supabaseId;
    if (project) supabaseId=await confirmSupabaseIdentity(project,env,action,body.credential,rawNonce,claims.sub);
    const user={key:action+'/'+claims.sub,name:(typeof claims.name==='string' && claims.name.trim() || claims.email).slice(0,200),email:claims.email};
    const profileKey=customerPrefix+'profiles/'+(action==='google'?'':action+'/')+claims.sub;
    await env.BUCKET.put(profileKey,JSON.stringify(supabaseId?{...user,supabaseId}:user));
    const token=randomId()+randomId();
    await env.BUCKET.put(await sessionPath(token),JSON.stringify({expires:Date.now()+customerLifetime*1000,user}));
    if(sessionKey) await env.BUCKET.delete(sessionKey);
    const result=json({user},200,{'Set-Cookie':shopCookie(customerCookie,token,customerLifetime)});
    result.headers.append('Set-Cookie',shopCookie(challengeCookie,'',0));
    return result;
  }
  reject(404,'Unknown customer route.');
}
