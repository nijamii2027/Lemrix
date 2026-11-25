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
