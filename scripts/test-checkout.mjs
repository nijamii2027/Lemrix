import assert from 'node:assert/strict';
import {randomUUID, createHash, createHmac, pbkdf2Sync} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import worker from '../dist/server/index.js';

const origin = 'https://shop.example';
const bucket = new Map();
let revision = 0;
const fixturePassword = 'fixture-password';
const salt = Buffer.from('native-checkout-fixture-salt');
const env = {
  ADMIN_PASSWORD_HASH:'pbkdf2-sha256$600000$' + salt.toString('hex') + '$' + pbkdf2Sync(fixturePassword,salt,600000,32,'sha256').toString('hex'),
  SESSION_SECRET:'fixture-native-session-secret', CLIENT_IP:'198.51.100.30', BUCKET:{
  async get(key) {
    const entry = bucket.get(key);
    return entry && {...entry, json:async () => JSON.parse(entry.value)};
  },
  async head(key) { return bucket.get(key); },
  async list({prefix}) { return {objects:[...bucket.keys()].filter(k => k.startsWith(prefix)).map(key=>({key})),truncated:false}; },
  async delete(key) { bucket.delete(key); },
  async put(key, value, options={}) {
    const entry = bucket.get(key);
    const match = options.onlyIf?.get('If-Match');
    if (match && (!entry || match !== '"' + entry.etag + '"')) return null;
    if (options.onlyIf?.get('If-None-Match')==='*' && entry) return null;
    const etag = String(++revision);
    bucket.set(key, {...options, etag, value});
    return {etag};
  }
}};
const links = new Map();
const orders = new Map();
const payments = new Map();
const idempotency = new Map();
const orderByAttempt = new Map();
const locationId = 'LTESTAU';
const money = amount => ({amount, currency:'AUD'});

function squareId() {
  return randomUUID().replaceAll('-', '');
}
function recordPayment(order) {
  const payment = {
    id:squareId(), order_id:order.id, location_id:locationId, status:'COMPLETED',
    amount_money:{...order.total_money}, total_money:{...order.total_money}, refunded_money:money(0),
  };
  order.state = 'COMPLETED';
  order.tenders = [{id:payment.id, payment_id:payment.id, type:'CARD', amount_money:order.total_money}];
  payments.set(payment.id, payment);
  return payment;
}

globalThis.fetch = async (url, options={}) => {
  const {origin:apiOrigin, pathname} = new URL(url);
  const sandbox = env.SQUARE_ENVIRONMENT === 'sandbox';
  assert.equal(apiOrigin, sandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer '+env.SQUARE_ACCESS_TOKEN);
  const method = options.method || 'GET';
  if (method === 'POST' && pathname === '/v2/online-checkout/payment-links') {
    const payload = JSON.parse(options.body);
    assert.ok(payload.idempotency_key);
    const {order, checkout_options:checkout} = payload;
    assert.equal(payload.idempotency_key, order.reference_id);
    assert.equal(order.location_id, locationId);
    assert.equal(checkout.ask_for_shipping_address, true);
    assert.equal(checkout.accepted_payment_methods.apple_pay, true);
    assert.equal(checkout.accepted_payment_methods.google_pay, true);
    const redirect = new URL(checkout.redirect_url);
    assert.equal(redirect.origin, origin);
    assert.equal(redirect.searchParams.get('checkout'), order.reference_id);
    assert.equal(redirect.searchParams.get('attempt'), order.reference_id);
    const [first, second] = order.line_items;
    if (second) {
      assert.equal(redirect.hash, '#cart');
      assert.deepEqual(first.base_price_money, money(2750));
      assert.deepEqual(second.base_price_money, money(850));
      assert.equal(second.quantity, '2');
    } else {
      assert.deepEqual(first.base_price_money, money(2050));
      assert.match(first.name, /Soft Landing.*Copy B.*Lightly played/);
    }
    const fee = Number(env.SQUARE_SHIPPING_CENTS);
    if (fee) assert.deepEqual(checkout.shipping_fee.charge, money(fee));
    const subtotal = order.line_items.reduce((sum, line) => sum + line.base_price_money.amount * Number(line.quantity), 0);
    let linkId = idempotency.get(payload.idempotency_key);
    if (!linkId) {
      linkId = squareId();
      const squareOrder = {...order, id:squareId(), state:'OPEN', total_money:money(subtotal+fee), tenders:[]};
      const link = {id:linkId, order_id:squareOrder.id, url:'https://'+(sandbox?'sandbox.square.link':'square.link')+'/u/'+linkId};
      orders.set(squareOrder.id, squareOrder);
      links.set(linkId, link);
      idempotency.set(payload.idempotency_key, linkId);
      orderByAttempt.set(order.reference_id, squareOrder);
    }
    const link = links.get(linkId);
    return Response.json({payment_link:link, related_resources:{orders:[orders.get(link.order_id)]}});
  }
  const id = pathname.split('/').pop();
  if (method==='GET' && pathname === '/v2/orders/'+id && orders.has(id)) return Response.json({order:orders.get(id)});
  if (method==='GET' && pathname === '/v2/payments/'+id && payments.has(id)) return Response.json({payment:payments.get(id)});
  if (pathname === '/v2/online-checkout/payment-links/'+id && links.has(id)) {
    const link = links.get(id);
    if (method==='GET') return Response.json({payment_link:link});
    if (method==='DELETE') {
      const order = orders.get(link.order_id);
      if (order.state==='COMPLETED') return Response.json({errors:[{code:'BAD_REQUEST', category:'INVALID_REQUEST_ERROR'}]}, {status:400});
      order.state='CANCELED';
      return Response.json({id, cancelled_order_id:order.id});
    }
  }
  throw new Error('Unexpected Square fixture request: '+method+' '+pathname);
};
let adminCookie = '';
const request = (path, payload, extra={}) => {
  const headers = new Headers({Origin:origin,'Content-Type':'application/json',Cookie:adminCookie});
  for (const [name,value] of Object.entries(extra)) headers.set(name,value);
  return worker.fetch(new Request(origin+path,{
    method:payload ? 'POST' : 'GET', headers, body:payload && JSON.stringify(payload)
  }),env);
};
const attempt = () => ({itemId:'soft-landing', copy:1, expectedCents:2050, attempt:randomUUID(), started:Math.floor(Date.now()/1000)});
const shop = async (extra) => {
  const text = await (await request('/shop/catalogue.js',null,extra)).text();
  return runInNewContext(text+';products');
};
const webhookPath = '/api/square/webhook';
async function event(object, signed=true, type='payment.updated', signingUrl=origin+webhookPath) {
  const kind = type.split('.')[0];
  const payload = {type, event_id:randomUUID(), data:{type:kind, id:object.id, object:{[kind]:object}}};
  const digest = createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(signingUrl + JSON.stringify(payload)).digest('base64');
  return request(webhookPath,payload,{'x-square-hmacsha256-signature':signed ? digest : Buffer.alloc(32).toString('base64')});
}
assert.equal((await request('/api/checkout',attempt())).status,503);
Object.assign(env, {SQUARE_ACCESS_TOKEN:'sandbox-fixture', SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture',
  SQUARE_LOCATION_ID:locationId, SQUARE_ENVIRONMENT:'sandbox', SQUARE_SHIPPING_CENTS:'0'});
assert.equal((await shop()).find(p => p.id === 'soft-landing').canBuy, true);
assert.equal((await request('/api/checkout',attempt())).status,200);
const login = await request('/api/login',{username:'Lemrix',password:fixturePassword});
assert.equal(login.status,200);
adminCookie = login.headers.get('Set-Cookie').split(';')[0];
assert.equal((await request('/api/checkout',{...attempt(),expectedCents:1})).status,409);
assert.equal((await request('/api/checkout',{...attempt(),copy:27})).status,409);
assert.equal((await request('/api/checkout',{...attempt(),itemId:'moon-run'})).status,409);
const sandboxOrder=attempt();
assert.equal((await request('/api/checkout',sandboxOrder)).status,200);
recordPayment(orderByAttempt.get(sandboxOrder.attempt));
assert.equal((await (await request('/api/checkout/status',{session:sandboxOrder.attempt})).json()).status,'test-paid');
assert.equal(bucket.has('store/v1/catalogue.json'),false, 'Sandbox checkout cannot change live stock.');
adminCookie = '';
const rows=await shop();
const product=rows.find(p=>p.id==='soft-landing');
product.quantity=2; product.revision=1;
const {canBuy, checkoutMode, ...savedProduct}=product;
bucket.set('store/v1/catalogue.json',{etag:'seed',value:JSON.stringify([savedProduct])});
env.SQUARE_ACCESS_TOKEN='live-fixture'; env.SQUARE_ENVIRONMENT='production'; env.SQUARE_SHIPPING_CENTS='800';
const first=attempt(), second=attempt();
const responses=await Promise.all([request('/api/checkout',first),request('/api/checkout',second)]);
assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
const winner=responses[0].status===200 ? first : second;
const selected=orderByAttempt.get(winner.attempt);
assert.equal((await request('/api/checkout',winner)).status,200);
assert.equal((await shop())[0].copies[1].canBuy,false);
assert.equal((await shop())[0].checkoutHolds,undefined);
assert.equal((await request('/api/checkout/cancel',{itemId:winner.itemId,attempt:winner.attempt})).status,200);
assert.equal(selected.state,'CANCELED');
assert.equal((await shop())[0].copies[1].canBuy,true);
const expiring=attempt();
assert.equal((await request('/api/checkout',expiring)).status,200);
assert.equal((await shop())[0].copies[1].canBuy,false);
const realNow = Date.now;
try {
  Date.now = () => realNow() + 60*60*1000;
  assert.equal((await shop())[0].copies[1].canBuy,true);
  assert.equal(orderByAttempt.get(expiring.attempt).state,'CANCELED');
} finally { Date.now = realNow; }

const final=attempt();
const guestPass = 'f'.repeat(32);
const guestLedgerKey = 'store/v1/rewards/'+createHash('sha256').update(guestPass).digest('hex')+'.json';
await env.BUCKET.put(guestLedgerKey, JSON.stringify({orders:{}}));
assert.equal((await request('/api/checkout',final,{cookie:'__Host-lemrix-pass='+guestPass})).status,200);
assert.equal((await (await request('/api/checkout/status',{session:final.attempt})).json()).status,'pending');
const paid=recordPayment(orderByAttempt.get(final.attempt));
assert.ok((await event(paid,false)).status >= 400);
assert.ok((await event(paid,true,'payment.updated','https://other.example'+webhookPath)).status >= 400);
assert.equal(Boolean((await shop())[0].copies[1].sold),false);
const correctMoney = paid.amount_money;
for (const wrongMoney of [money(correctMoney.amount-1), {amount:correctMoney.amount, currency:'USD'}]) {
  paid.amount_money=wrongMoney;
  assert.equal((await event(paid)).status,409);
  assert.equal(Boolean((await shop())[0].copies[1].sold),false);
}
paid.amount_money=correctMoney;
assert.equal((await event(paid)).status,200);
assert.equal((await event(paid)).status,200);
assert.equal((await (await request('/api/checkout/status',{session:final.attempt})).json()).status,'paid');
assert.deepEqual(await (await env.BUCKET.get(guestLedgerKey)).json(), {orders:{}}, 'A guest can pay with an old pass cookie but earns no rewards');
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
const digest = text => createHash('sha256').update(text).digest('hex');
const oldCode = 'b'.repeat(32), oldCookie = '__Host-lemrix-pass=' + oldCode;
const claimedCode = 'a'.repeat(32);
const existingOwner = 'google/existing';
for(const value of [oldCode,claimedCode]) await env.BUCKET.put('store/v1/rewards/'+digest(value)+'.json',JSON.stringify({orders:{prior:{subtotal:300}}}));
await env.BUCKET.put('store/v1/rewards/accounts/'+digest(existingOwner),JSON.stringify({code:claimedCode}));
async function account(short,key,expires=Date.now()+60000) {
  const token=short.repeat(64);
  await env.BUCKET.put('store/v1/customers/sessions/'+digest(token),JSON.stringify({expires,user:{key}}));
  return {cookie:'__Host-lemrix-customer='+token};
}
for(const cookie of ['',oldCookie,adminCookie]){
  for(const [suffix,body] of [['',null],['/join',{}],['/recover',{code:oldCode}],['/code',null],['/art/hill-club',null]]) {
    assert.equal((await request(rewards+suffix,body,{cookie})).status,401);
  }
}
const expired=await account('c','google/expired',Date.now()-1);
assert.equal((await request(rewards,null,expired)).status,401);
const oldAccount=await account('b',existingOwner), member=await account('1','google/new');
const other=await account('2','google/other'), rival=await account('3','google/rival');
assert.equal((await (await request(rewards,null,oldAccount)).json()).points,3);
assert.equal((await request(rewards+'/recover',{code:claimedCode},member)).status,409,'A previous owner retains their pass');
assert.equal((await request(rewards+'/recover',{code:oldCode},oldAccount)).status,409,'An existing member cannot acquire another pass');
const legacyDevice={cookie:other.cookie+'; '+oldCookie};
assert.equal((await (await request(rewards,null,legacyDevice)).json()).devicePass,true);
const raced=await Promise.all([request(rewards+'/join',{useDevicePass:true},legacyDevice),request(rewards+'/recover',{code:oldCode},rival)]);
assert.deepEqual(raced.map(r=>r.status).sort(),[200,409], 'Two simultaneous claims have exactly one owner');
assert.equal((await raced.find(r=>r.status===200).json()).points,3);
assert.equal((await request(rewards+'/join',{}, {origin:'https://unrelated.example'})).status,403);
const join=await request(rewards+'/join',{},member);
assert.equal((await join.json()).points,0);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,403);
const print=await request(rewards+'/art/hill-club',null,member);
assert.equal(print.headers.get('Content-Type'),'image/webp');
assert.equal(Buffer.from(await print.arrayBuffer()).toString('ascii',8,12),'WEBP');
const {code}=await (await request(rewards+'/code',null,member)).json();
assert.equal((await request(rewards+'/recover',{code:'wrong'},member)).status,400);
assert.equal((await request(rewards+'/recover',{code},member)).status,200);
assert.equal((await request(rewards+'/recover',{code},rival)).status,409);
assert.equal((await request('/api/checkout',b,member)).status,200);
const cartSession=recordPayment(orderByAttempt.get(b.attempt));
assert.equal((await event(cartSession)).status,200);
assert.equal((await event(cartSession)).status,200);
const receipt=await (await request('/api/checkout/status',{session:b.attempt})).json();
assert.equal(receipt.attempt,b.attempt);
cartRows=await shop();
assert.equal(cartRows.find(p=>p.id==='soft-landing').copies[0].sold,true);
assert.equal(cartRows.find(p=>p.id==='tide-pack').quantity,0);
console.log('Cart checks passed for selected copies, quantities, shared shipping, atomic reservation, expiry, retries and idempotent fulfilment.');

const balance=async()=>(await (await request(rewards,null,member)).json()).points;
assert.equal(await balance(),44);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,200);
assert.equal((await request(rewards+'/art/after-hours',null,member)).status,403);
cartSession.refunded_money=money(1550);
const refund={id:squareId(), order_id:cartSession.order_id, payment_id:cartSession.id, status:'COMPLETED', amount_money:money(1550)};
assert.equal((await event(refund,true,'refund.updated')).status,200);
assert.equal((await event(refund,true,'refund.updated')).status,200);
assert.equal(await balance(),29);
const remainingRefund={...refund, id:squareId(), amount_money:money(cartSession.amount_money.amount-1550)};
cartSession.refunded_money=money(cartSession.amount_money.amount);
await event(remainingRefund,true,'refund.updated');
await event(cartSession);
assert.equal(await balance(),0);
assert.equal((await request(rewards+'/art/last-showing',null,member)).status,403);
console.log('Verified rewards enrolment, recovery, protected artwork, shipping exclusion, duplicate webhook protection and partial/full refunds.');

// Card data and processor messages must not escape in a response or diagnostic.
const processorFetch = globalThis.fetch;
const originalConsoleError = console.error;
const processorErrors = [];
const stockBeforeError = bucket.get('store/v1/catalogue.json').value;
const privateMessage = 'DO_NOT_LOG_customer@example.com token-do-not-log';
globalThis.fetch = async () => Response.json({errors:[{
  category:'INVALID_REQUEST_ERROR', code:'BAD_REQUEST', detail:privateMessage,
}]}, {status:400});
console.error = (...args) => processorErrors.push(args);
try {
  const failure = await request('/api/checkout/status', {session:b.attempt});
  assert.ok(failure.status >= 400);
  const response = await failure.text();
  assert.ok(!response.includes(privateMessage));
  assert.equal(bucket.get('store/v1/catalogue.json').value, stockBeforeError);
  const logged = JSON.stringify(processorErrors);
  assert.ok(!logged.includes(privateMessage));
  assert.ok(!logged.includes(env.SQUARE_ACCESS_TOKEN));
} finally {
  globalThis.fetch = processorFetch;
  console.error = originalConsoleError;
}
console.log('Verified Square hosted guest payments, signed notifications and safe processor errors.');
