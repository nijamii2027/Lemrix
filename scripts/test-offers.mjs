import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import app from '../dist/server/index.js';

const origin = 'https://shop.example';
const records = new Map();
let revision = 0;
const bucket = {
  async get(key) {
    const entry = records.get(key);
    return entry && {...entry,json:async()=>JSON.parse(entry.value)};
  },
  async head(key) {return records.get(key);},
  async delete(key) {records.delete(key);},
  async put(key,value,{onlyIf,customMetadata}={}) {
    const current = records.get(key);
    if (onlyIf?.has('If-None-Match') && current) return null;
    if (onlyIf?.has('If-Match') && onlyIf.get('If-Match') !== '"' + current?.etag + '"') return null;
    const result = {key,value,etag:String(++revision),customMetadata}; records.set(key,result); return result;
  },
  async list({prefix}) {return {objects:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
};
const password='fixture-password';
const salt = Buffer.alloc(16,5);
const env = {BUCKET:bucket,ADMIN_PASSWORD_HASH:'pbkdf2-sha256$600000$'+salt.toString('hex')+'$'+pbkdf2Sync(password,salt,600000,32,'sha256').toString('hex'),
  SESSION_SECRET:'offer-fixture-secret',SQUARE_ACCESS_TOKEN:'fixture', SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture',SQUARE_LOCATION_ID:'here',
  SQUARE_ENVIRONMENT:'production', SQUARE_SHIPPING_CENTS:'100'};
await bucket.put('store/v1/catalogue.json',JSON.stringify([{id:'nigi',name:'Neegy',cents:1200,quantity:2,revision:1},
  {id:'upcoming',name:'Upcoming',collection:'pre-orders',cents:1000,quantity:1}]));
const call=(path,body,cookie='')=>app.fetch(new Request(origin+'/api/'+path,{
  method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
async function session(path,body) {
  const response=await call(path,body); assert.equal(response.status,200,await response.clone().text());
  return response.headers.get('Set-Cookie').split(';')[0];
}
async function ok(response) {
  const result=await response; const data=await result.json(); assert.equal(result.status,200,JSON.stringify(data)); return data;
}

const buyer=await session('customer/register',{username:'buyer',password});
const second=await session('customer/register',{username:'other',password});
const staff=await session('login',{username:'Lemrix',password});
const proposal={itemId:'nigi',copy:null,cents:850};
assert.equal((await call('offers/submit',proposal)).status,401);
assert.equal((await call('staff/offers/list',{},buyer)).status,401);
assert.equal((await call('offers/submit',{...proposal,itemId:'upcoming'},buyer)).status,409);
assert.equal((await call('offers/submit',{...proposal,cents:1201},buyer)).status,400);

const {offer}=await ok(call('offers/submit',proposal,buyer));
assert.equal((await ok(call('offers/submit',proposal,buyer))).offer.version,offer.version);
const revised=(await ok(call('offers/submit',{...proposal,cents:900,version:offer.version},buyer))).offer;
assert.equal((await call('staff/offers/review',{id:offer.id,version:offer.version,status:'accepted'},staff)).status,409);
assert.equal((await ok(call('offers/list',{},second))).offers.length,0);
assert.equal((await ok(call('offers/lookup',proposal,second))).offer,null);
assert.equal((await ok(call('offers/lookup',proposal,buyer))).offer.version,revised.version);
const inbox=await ok(call('staff/offers/list',{},staff));
assert.equal(inbox.offers[0].buyer,'buyer'); assert.equal(inbox.offers[0].cents,900);
const {offer:approved}=await ok(call('staff/offers/review',{id:offer.id,version:revised.version,status:'accepted'},staff));
assert.equal(approved.attempt,undefined);
assert.equal((await call('offers/checkout',approved,second)).status,404);

let checkout, paid=false, links=0;
globalThis.fetch=async (url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/v2/online-checkout/payment-links' && options.method==='POST') {
    links++;
    const payload=JSON.parse(options.body);
    assert.equal(payload.order.line_items[0].base_price_money.amount,900);
    assert.equal(payload.checkout_options.shipping_fee.charge.amount,100);
    checkout=payload.order.reference_id;
    return Response.json({payment_link:{id:'link',order_id:'order',url:'https://square.link/u/example'}});
  }
  if(path==='/v2/orders/order') return Response.json({order:{id:'order',reference_id:checkout,location_id:'here',state:paid?'COMPLETED':'OPEN',tenders:paid?[{payment_id:'pay'}]:[]}});
  if(path==='/v2/payments/pay') return Response.json({payment:{id:'pay',order_id:'order',location_id:'here',status:'COMPLETED',amount_money:{currency:'AUD',amount:1000}}});
  throw Error('Unexpected Square fixture request '+path);
};
const purchase={id:approved.id,version:approved.version,cents:1};
const link=await ok(call('offers/checkout',purchase,buyer));
assert.equal((await ok(call('offers/checkout',purchase,buyer))).url,link.url); assert.equal(links,1);
assert.equal((await ok(call('checkout/status',{session:link.attempt}))).url,link.url);
paid=true;
assert.equal((await ok(call('checkout/status',{session:link.attempt}))).status,'paid');
assert.equal((await (await bucket.get('store/v1/catalogue.json')).json())[0].quantity,1);
assert.equal((await ok(call('offers/list',{},buyer))).offers[0].status,'purchased');
assert.equal((await call('offers/checkout',purchase,buyer)).status,409);
const declined=(await ok(call('offers/submit',proposal,second))).offer;
assert.equal((await ok(call('staff/offers/review',{id:declined.id,version:declined.version,status:'declined'},staff))).offer.status,'declined');
console.log('Member offers, staff review, negotiated checkout, account isolation, stock settlement and retries passed.');
