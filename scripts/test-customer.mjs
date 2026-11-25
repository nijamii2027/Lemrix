import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import worker from '../dist/server/index.js';

const records = new Map();
const origin='https://shop.example';
const env={GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com', BUCKET:{
  async put(key, value){records.set(key,value);},
  async get(key){return records.has(key)?{json:async()=>JSON.parse(records.get(key))}:null;},
  async delete(key){records.delete(key);}
}};
function request(action, body, cookie='', from=origin) {
  return worker.fetch(new Request(origin+'/api/customer/'+action,{
    method:body===undefined?'GET':'POST',headers:{origin:from,cookie},
    body:body===undefined?undefined:JSON.stringify(body)
  }),env);
}
const challenge=await request('challenge',{});
const {nonce}=await challenge.json();
const cookie=challenge.headers.get('Set-Cookie').split(';')[0];
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256'};
globalThis.fetch=async url=>{
  assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');
  return Response.json({keys:[jwk]});
};
const now=Math.floor(Date.now()/1000);
function credential(overrides={}, key=privateKey) {
  const claims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub:'12345',nonce,
    email_verified:true,email:'collector@example.com',name:'Collector',iat:now,exp:now+3600,...overrides};
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const msg=enc({kid:'fixture',alg:'RS256'})+'.'+enc(claims);
  return {credential:msg+'.'+sign('RSA-SHA256',Buffer.from(msg),key).toString('base64url')};
}
for(const overrides of [{aud:'wrong'},{iss:'wrong'},{nonce:'wrong'},{email_verified:false},{exp:now-1}])
  assert.equal((await request('google',credential(overrides),cookie)).status,401);
const wrong=generateKeyPairSync('rsa',{modulusLength:2048});
assert.equal((await request('google',credential({},wrong.privateKey),cookie)).status,401);
assert.equal((await request('google',credential(),cookie,'https://other.example')).status,403);
assert.equal((await request('google',credential())).status,401);
const login=await request('google',credential(),cookie);
assert.equal(login.status,200);
const session=login.headers.getSetCookie().find(v=>v.startsWith('__Host-lemrix-customer=')).split(';')[0];
const profile=(await login.json()).user;
assert.equal((await (await request('session',undefined,session)).json()).user.key,profile.key);
assert.equal((await request('logout',{},session)).status,200);
assert.equal((await (await request('session',undefined,session)).json()).user,null);
const second=await request('google',credential(),cookie);
assert.equal((await second.json()).user.key,profile.key);
delete env.GOOGLE_CLIENT_ID;
assert.equal((await request('challenge',{})).status,503);
console.log('Passed Google signature and claims checks, account creation and reuse, session restoration, sign-out, and missing configuration.');

env.APPLE_CLIENT_ID='au.com.lemrix.shop';
const appleChallenge=await request('challenge',{});
const {clients,nonce:appleNonce}=await appleChallenge.json();
assert.deepEqual(clients,{apple:env.APPLE_CLIENT_ID});
const appleCookie=appleChallenge.headers.get('Set-Cookie').split(';')[0];
const appleClaims={iss:'https://appleid.apple.com',aud:env.APPLE_CLIENT_ID,sub:'00002.123.ab',nonce:appleNonce,email_verified:'true'};
const appleToken=credential(appleClaims);
let returnedSubject=appleClaims.sub;
let exchangeCalls=0;
globalThis.fetch=async (url, options)=>{
  if(url==='https://appleid.apple.com/auth/keys')return Response.json({keys:[jwk]});
  assert.equal(url,'https://project.supabase.co/auth/v1/token?grant_type=id_token');
  assert.equal(options.headers.apikey,'dummy-publishable');
  assert.deepEqual(JSON.parse(options.body),{provider:'apple',id_token:appleToken.credential,nonce:appleCookie.split('=')[1]});
  exchangeCalls++;
  return Response.json({user:{id:'fixture-supabase-user',identities:[{provider:'apple',identity_data:{sub:returnedSubject}}]}});
};
assert.equal((await request('apple',credential({...appleClaims,aud:'wrong'}),appleCookie)).status,401);
assert.equal((await request('apple',credential({...appleClaims,iss:'https://accounts.google.com'}),appleCookie)).status,401);
assert.equal((await request('apple',credential({...appleClaims,nonce:'wrong'}),appleCookie)).status,401);
assert.equal((await request('apple',appleToken,appleCookie,'https://other.example')).status,403);
const apple=await request('apple',appleToken,appleCookie);
assert.equal(apple.status,200);
assert.equal((await apple.json()).user.key,'apple/'+appleClaims.sub);
env.SUPABASE_URL='https://project.supabase.co';
assert.equal((await request('challenge',{})).status,503);
env.SUPABASE_PUBLISHABLE_KEY='dummy-publishable';
returnedSubject='unrelated-subject';
assert.equal((await request('apple',appleToken,appleCookie)).status,401);
returnedSubject=appleClaims.sub;
const confirmed=await request('apple',appleToken,appleCookie);
assert.equal(confirmed.status,200);
assert.equal(exchangeCalls,2);
assert.equal((await confirmed.json()).user.key,'apple/'+appleClaims.sub);
const linked=JSON.parse(records.get('store/v1/customers/profiles/apple/'+appleClaims.sub));
assert.equal(linked.supabaseId,'fixture-supabase-user');
assert.equal(records.has('store/v1/customers/profiles/12345'),true);
console.log('Verified distinct Apple/Google identities and optional Supabase provider-subject matching.');
