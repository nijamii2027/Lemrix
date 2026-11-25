const customerPrefix = 'store/v1/customers/';
const customerCookie = '__Host-lemrix-customer';
const challengeCookie = '__Host-lemrix-google';
const customerLifetime = 60*60*24*14;
let googleKeys, keysExpire = 0;

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
async function verifyGoogleToken(token, client, nonce) {
  let head, claims, sig, message;
  try {
    const parts=token.split('.');
    if(parts.length!==3) throw new Error();
    head=JSON.parse(decoder.decode(unbase64url(parts[0])));
    claims=JSON.parse(decoder.decode(unbase64url(parts[1])));
    sig=unbase64url(parts[2]);
    message=encoder.encode(parts[0]+'.'+parts[1]);
  } catch { reject(401,'Google could not verify this sign-in.'); }
  const now=Math.floor(Date.now()/1000);
  if(head?.alg!=='RS256' || !isText(head.kid,200) ||
    !['accounts.google.com','https://accounts.google.com'].includes(claims?.iss) ||
    claims.aud!==client || (claims.azp && claims.azp!==client) || claims.nonce!==nonce ||
    !Number.isSafeInteger(claims.exp) || claims.exp<=now || !Number.isSafeInteger(claims.iat) ||
    claims.iat>now+60 || typeof claims.sub!=='string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub || '') ||
    claims.email_verified!==true || !isText(claims.email,320))
    reject(401,'Google could not verify this sign-in. Please try again.');
  if(!googleKeys || Date.now()>=keysExpire) {
    const response=await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) reject(503,'Google is temporarily unavailable.');
    const {keys}=await response.json();
    googleKeys=keys;
    const maxAge=Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/i)?.[1] || 300);
    keysExpire=Date.now()+Math.min(86400,maxAge)*1000;
  }
  const jwk=googleKeys.find(key=>key.kid===head.kid && key.kty==='RSA' && key.alg==='RS256');
  if (!jwk) reject(401,'Google could not verify this sign-in.');
  const alg={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
  const key=await crypto.subtle.importKey('jwk',jwk,alg,false,['verify']);
  if (!await crypto.subtle.verify(alg,key,sig,message)) reject(401,'Google could not verify this sign-in.');
  return claims;
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
  const client=env.GOOGLE_CLIENT_ID;
  if(!client) reject(503,'Google sign-in is awaiting activation.');
  if(action==='challenge' && method==='POST') {
    const nonce=randomId()+randomId();
    return json({client,nonce},200,{'Set-Cookie':shopCookie(challengeCookie,nonce,600)});
  }
  if(action==='google' && method==='POST') {
    const nonce=readCookie(request,challengeCookie);
    const body=await readForm(request);
    if (!nonce || !/^[a-f0-9]{64}$/.test(nonce) || !isText(body.credential,16000)) reject(401,'Reopen sign-in and try again.');
    const claims=await verifyGoogleToken(body.credential,client,nonce);
    const user={key:'google/'+claims.sub,name:(claims.name || claims.email).slice(0,200),email:claims.email};
    const accountKey=customerPrefix+'profiles/'+claims.sub;
    await env.BUCKET.put(accountKey,JSON.stringify(user));
    const token=randomId()+randomId();
    await env.BUCKET.put(await sessionPath(token),JSON.stringify({expires:Date.now()+customerLifetime*1000,user}));
    if(sessionKey) await env.BUCKET.delete(sessionKey);
    const result=json({user},200,{'Set-Cookie':shopCookie(customerCookie,token,customerLifetime)});
    result.headers.append('Set-Cookie',shopCookie(challengeCookie,'',0));
    return result;
  }
  reject(404,'Unknown customer route.');
}
