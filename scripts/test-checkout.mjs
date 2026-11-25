import assert from 'node:assert/strict';
import {randomUUID, createHmac} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

const origin = 'https://shop.example';
const bucket = new Map();
let revision = 0;
const env = {ADMIN_EMAIL:'owner@example.com', BUCKET:{
  async get(key) {
    const entry = bucket.get(key);
    return entry && {etag:entry.etag, json:async () => JSON.parse(entry.value)};
  },
  async put(key, value, {onlyIf}) {
    const entry = bucket.get(key);
    if (entry ? onlyIf.get('If-Match') !== '"' + entry.etag + '"' : !onlyIf.has('If-None-Match')) return null;
    const etag = String(++revision);
    bucket.set(key, {etag, value});
    return {etag};
  }
}};
const sessions = new Map(), attempts = new Map();
let mostRecent;
globalThis.fetch = async (url, {headers, body}) => {
  const path = new URL(url).pathname;
  if (path === '/v1/checkout/sessions') {
    const multiple = body.has('line_items[1][quantity]');
    const unit = index => Number(body.get('line_items['+index+'][price_data][unit_amount]'));
    assert.equal(body.get('line_items[0][price_data][currency]'), 'aud');
    if (multiple) {
      assert.equal(unit(0),2750);
      assert.equal(unit(1),850);
      assert.equal(body.get('line_items[1][quantity]'),'2');
      assert.match(body.get('success_url'),/#cart$/);
    } else {
      assert.equal(unit(0),2050);
      assert.match(body.get('line_items[0][price_data][product_data][name]'),/Soft Landing · Copy B · Lightly played/);
    }
    assert.equal(body.get('shipping_address_collection[allowed_countries][0]'), 'AU');
    const pass=body.get('metadata[reward_pass]');
    if(pass) {
      assert.equal(pass,body.get('payment_intent_data[metadata][reward_pass]'));
      assert.equal(body.get('metadata[attempt]'),body.get('payment_intent_data[metadata][attempt]'));
    }
    const id = attempts.get(headers['Idempotency-Key']) || 'cs_'+randomUUID().replaceAll('-','');
    attempts.set(headers['Idempotency-Key'], id);
    if (!sessions.has(id)) sessions.set(id, {id, url:'https://checkout.stripe.com/c/pay/'+id, status:'open', currency:'aud',
      amount_subtotal:multiple ? 4450 : 2050, livemode:headers.Authorization.includes('_live_'), payment_status:'unpaid',
      metadata:{store:'lemrix-illustrated',reward_pass:pass,item_id:body.get('metadata[item_id]'),attempt:body.get('metadata[attempt]')}, expires_at:Number(body.get('expires_at'))});
    mostRecent = sessions.get(id);
    return Response.json(mostRecent);
  }
  const [, , , , id, expire] = path.split('/');
  const session = sessions.get(id);
  if (session && expire) session.status = 'expired';
  return Response.json(session || {}, {status:session ? 200 : 404});
};
const request = (path, payload, extra={}) => worker.fetch(new Request(origin+path,{
  method:payload ? 'POST' : 'GET',
  headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-email':env.ADMIN_EMAIL,...extra},
  body:payload && JSON.stringify(payload)
}),env);
const attempt = () => ({itemId:'soft-landing', copy:1, expectedCents:2050, attempt:randomUUID(), started:Math.floor(Date.now()/1000)});
const shop = async (extra) => {
  const text = await (await request('/shop/catalogue.js',null,extra)).text();
  return runInNewContext(text+';products');
};
async function event(session, signed=true,type='checkout.session.completed') {
  const payload = {type,data:{object:session}};
  const stamp = Math.floor(Date.now()/1000);
  const signature = createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(stamp+'.'+JSON.stringify(payload)).digest('hex');
  return request('/api/stripe/webhook',payload,{'Stripe-Signature':'t='+stamp+',v1='+(signed ? signature : 'bad')});
}
assert.equal((await request('/api/checkout',attempt())).status,503);
env.STRIPE_SECRET_KEY='sk_test_mock'; env.STRIPE_WEBHOOK_SECRET='fixture';
assert.equal((await request('/api/checkout',attempt(),{'oai-authenticated-user-email':'guest@example.com'})).status,403);
assert.equal((await request('/api/checkout',{...attempt(),expectedCents:1})).status,409);
assert.equal((await request('/api/checkout',{...attempt(),copy:27})).status,409);
assert.equal((await request('/api/checkout',{...attempt(),itemId:'moon-run'})).status,409);
assert.equal((await request('/api/checkout',attempt())).status,200);
mostRecent.status='complete'; mostRecent.payment_status='paid';
assert.equal((await (await request('/api/checkout/status',{session:mostRecent.id})).json()).status,'test-paid');
assert.equal(bucket.size,0);
const rows=await shop();
const product=rows.find(p=>p.id==='soft-landing');
product.quantity=2; product.revision=1;
const {canBuy, checkoutMode, ...savedProduct}=product;
bucket.set('store/v1/catalogue.json',{etag:'seed',value:JSON.stringify([savedProduct])});
env.STRIPE_SECRET_KEY='sk_live_mock'; env.STRIPE_SHIPPING_RATE='free';
const first=attempt(), second=attempt();
const responses=await Promise.all([request('/api/checkout',first),request('/api/checkout',second)]);
assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
const winner=responses[0].status===200 ? first : second;
const selected=sessions.get(attempts.get('lemrix-'+winner.attempt));
assert.equal((await request('/api/checkout',winner)).status,200);
assert.equal((await shop())[0].copies[1].canBuy,false);
assert.equal((await shop())[0].checkoutHolds,undefined);
assert.equal((await request('/api/checkout/cancel',{itemId:winner.itemId,attempt:winner.attempt})).status,200);
assert.equal(selected.status,'expired');
assert.equal((await shop())[0].copies[1].canBuy,true);
const final=attempt();
assert.equal((await request('/api/checkout',final)).status,200);
const paid=mostRecent;
paid.status='complete'; paid.payment_status='paid';
assert.equal((await event(paid,false)).status,400);
assert.equal((await event(paid)).status,200);
assert.equal((await event(paid)).status,200);
assert.equal((await (await request('/api/checkout/status',{session:paid.id})).json()).status,'paid');
const after=(await shop())[0];
assert.equal(after.quantity,1);
assert.equal(after.copies[1].sold,true);
assert.equal(after.copies[0].canBuy,true);
assert.equal((await request('/api/checkout',attempt())).status,409);
console.log('Checkout checks passed for sandbox stock isolation, price validation, simultaneous reservations, retries, cancellation, signed events and fulfilment.');

const pack=JSON.parse(JSON.stringify(rows.find(p=>p.id==='tide-pack')));
pack.quantity=2; pack.revision=1;
const stock=JSON.parse(bucket.get('store/v1/catalogue.json').value);
stock.push(pack);
bucket.set('store/v1/catalogue.json',{etag:'cart-seed',value:JSON.stringify(stock)});
const order=()=>({attempt:randomUUID(),started:Math.floor(Date.now()/1000),lines:[
  {itemId:'soft-landing',copy:0,quantity:1,expectedCents:2750},
  {itemId:'tide-pack',copy:null,quantity:2,expectedCents:850}
]});
const a=order();
assert.equal((await request('/api/checkout',{...a,lines:[]})).status,400);
assert.equal((await request('/api/checkout',{...a,lines:[a.lines[0],a.lines[0]]})).status,400);
assert.equal((await request('/api/checkout',{...a,lines:[a.lines[0],{...a.lines[1],quantity:3}]})).status,409);
assert.equal((await request('/api/checkout',a)).status,200);
assert.equal((await request('/api/checkout',a)).status,200);
assert.equal((await request('/api/checkout',order())).status,409);
assert.equal((await request('/api/checkout',{...a,lines:[a.lines[0]]})).status,409);
assert.equal((await request('/api/checkout/cancel',{attempt:a.attempt})).status,200);
let cartRows=await shop();
assert.equal(cartRows.find(p=>p.id==='soft-landing').quantity,1);
assert.equal(cartRows.find(p=>p.id==='tide-pack').quantity,2);
const b=order();
const rewards='/api/rewards';
assert.equal((await (await request(rewards)).json()).member,false);
assert.equal((await request(rewards+'/art/hill-club')).status,401);
assert.equal((await request(rewards+'/join',{}, {origin:'https://unrelated.example'})).status,403);
const join=await request(rewards+'/join',{}),member={cookie:join.headers.get('set-cookie').split(';')[0]};
assert.equal((await join.json()).points,0);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,403);
const print=await request(rewards+'/art/hill-club',null,member);
assert.equal(print.headers.get('Content-Type'),'image/webp');
assert.equal(Buffer.from(await print.arrayBuffer()).toString('ascii',8,12),'WEBP');
const {code}=await (await request(rewards+'/code',null,member)).json();
assert.equal((await request(rewards+'/recover',{code:'wrong'})).status,400);
assert.equal((await request(rewards+'/recover',{code})).headers.get('set-cookie').split(';')[0],member.cookie);
assert.equal((await request('/api/checkout',b,member)).status,200);
const cartSession=mostRecent;
Object.assign(cartSession,{status:'complete',payment_status:'paid'});
assert.equal((await event(cartSession)).status,200);
assert.equal((await event(cartSession)).status,200);
const receipt=await (await request('/api/checkout/status',{session:cartSession.id})).json();
assert.equal(receipt.attempt,b.attempt);
cartRows=await shop();
assert.equal(cartRows.find(p=>p.id==='soft-landing').copies[0].sold,true);
assert.equal(cartRows.find(p=>p.id==='tide-pack').quantity,0);
console.log('Cart checks passed for selected copies, quantities, shared shipping, atomic reservation, expiry, retries and idempotent fulfilment.');

const balance=async()=>(await (await request(rewards,null,member)).json()).points;
assert.equal(await balance(),44);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,200);
assert.equal((await request(rewards+'/art/after-hours',null,member)).status,403);
const refund={...cartSession,amount_refunded:1550};
assert.equal((await event(refund,true,'charge.refunded')).status,200);
assert.equal((await event(refund,true,'charge.refunded')).status,200);
assert.equal(await balance(),29);
await event({...refund,amount_refunded:4450},true,'charge.refunded');
await event(cartSession);
assert.equal(await balance(),0);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,403);
console.log('Verified rewards enrolment, recovery, protected artwork, shipping exclusion, duplicate webhook protection and partial/full refunds.');
