import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import worker from '../dist/server/index.js';

const records = new Map();
let revision = 0;
const fixturePassword = 'fixture-password';
const salt = Buffer.from('native-editor-fixture-salt');
const env = {
  ADMIN_PASSWORD_HASH:'pbkdf2-sha256$600000$' + salt.toString('hex') + '$' + pbkdf2Sync(fixturePassword,salt,600000,32,'sha256').toString('hex'),
  SESSION_SECRET:'fixture-native-session-secret', CLIENT_IP:'198.51.100.20',
  BUCKET: {
    head:async key=>records.get(key),
    get:async key=>records.get(key),
    delete:async key=>records.delete(key),
    async put(key, data, options={}) {
      const previous=records.get(key);
      const match=options.onlyIf?.get('If-Match');
      if (match && (!previous || match !== '"'+previous.etag+'"')) return null;
      if (options.onlyIf?.get('If-None-Match')==='*' && previous) return null;
      const entry={...options,etag:String(++revision),json:async()=>JSON.parse(data)};
      records.set(key,entry);
      return entry;
    }
  }
};
const origin='https://shop.example';
let cookie='';
function call(path,body,headers={}) {
  return worker.fetch(new Request(origin+path,{
    method:body?'POST':'GET', headers:{origin,cookie,...headers},
    body:body && JSON.stringify(body)
  }),env);
}
const credentials={username:'Lemrix',password:fixturePassword};
assert.equal((await call('/api/items/push',{changes:[]})).status,401);
assert.equal((await call('/api/login',{...credentials,password:'incorrect'},{'oai-authenticated-user-email':'owner@example.com'})).status,401);
const login=await call('/api/login',credentials);
assert.equal(login.status,200);
cookie=login.headers.get('set-cookie').split(';')[0];
const items=async()=>await (await call('/api/items')).json();
const old=await items();
const change=item=>({...item, quantity:item.quantity??null, name:item.name+' edited', prices:item.copies?.map(c=>c.cents) || [item.cents]});
const a=change(old[0]), b=change(old[1]);
const push=changes=>call('/api/items/push',{changes});
assert.equal((await push([a,{...b,revision:-1}])).status,409);
assert.deepEqual(await items(),old);
assert.equal((await push([a,b])).status,200);
assert.equal((await items())[1].name,b.name);
assert.equal((await push([a])).status,409);
assert.equal((await call('/api/items/push',{changes:[a]},{origin:'https://other.example'})).status,403);
const newId='f'.repeat(32),front='/media/'+'c'.repeat(32),back='/media/'+'d'.repeat(32);
for(const face of [front,back])records.set('store/v1/images/'+face.slice(7),{});
const card={productType:'slab',set:'Example set',series:'XY',language:'Japanese',cardNumber:'#287',grader:'PSA',grade:'9',certificate:'123456789'};
const listing={create:true,id:newId,name:'Photo desk fixture',description:'Isolated test',quantity:1,prices:[7500],category:'Singles',image:front,card};
assert.equal((await push([listing])).status,400);
assert.equal((await push([{...listing,backImage:'/media/'+'1'.repeat(32)}])).status,400);
assert.equal((await push([{...listing,backImage:back}])).status,200);
const created=(await items()).find(i=>i.id===newId);
assert.deepEqual(created.card,card);
assert.equal(created.backImage,back);assert.equal(created.image,front);
const catalogue=await (await call('/shop/catalogue.js')).text();assert.ok(catalogue.includes(back));
// Editing storefront copy must preserve the front and back and any stock data.
const availability='Available for collection.\nBring your order number.';
const edited={...change(created),availability,notes:'Silver label.',quantity:3};
assert.equal((await push([edited])).status,200);
const updated=(await items()).find(item=>item.id===newId);
assert.equal(updated.availability,availability);
assert.equal(updated.notes,edited.notes);
assert.equal(updated.quantity,3);
assert.deepEqual([updated.image,updated.backImage],[front,back]);
const publicCatalogue=await (await call('/shop/catalogue.js')).text();
assert.ok(publicCatalogue.includes(JSON.stringify(availability)));
// Clients with an older form omit the optional copy. An intentional clear
// from the inline editor restores the automatic availability message.
const {availability:ignored,...legacy}=change(updated);
assert.equal((await push([legacy])).status,200);
const preserved=(await items()).find(item=>item.id===newId);
assert.equal(preserved.availability,availability);
assert.equal((await push([{...change(preserved),availability:''}])).status,200);
assert.equal((await items()).find(item=>item.id===newId).availability,'');
const pack={...listing,id:'a'.repeat(32),category:'Packs',card:{productType:'box'}};
assert.equal((await push([pack])).status,200);
const published=(await items()).find(item=>item.id===newId);
const remove={id:newId,revision:published.revision,remove:true};
assert.equal((await push([{...remove,revision:remove.revision-1}])).status,409);
assert.equal((await push([remove,{id:pack.id,revision:-1,remove:true}])).status,409);
assert.ok((await items()).some(item=>item.id===newId),'A conflict in the batch rolls removal back');
const catalogueKey='store/v1/catalogue.json';
const stored=await (await env.BUCKET.get(catalogueKey)).json();
const held=stored.find(item=>item.id===newId);
held.checkoutHolds=[{provider:'square',expires:Math.floor(Date.now()/1000)+600}];
await env.BUCKET.put(catalogueKey,JSON.stringify(stored));
assert.equal((await push([remove])).status,409,'Active checkout holds prevent removal');
held.checkoutHolds=[];
await env.BUCKET.put(catalogueKey,JSON.stringify(stored));
assert.equal((await push([remove])).status,200);
assert.ok(!(await items()).some(item=>item.id===newId),'Archived listing is absent from the editor');
const afterRemoval=await (await call('/shop/catalogue.js',undefined,{Accept:'application/json'})).json();
assert.ok(!afterRemoval.some(item=>item.id===newId),'Archived listing is absent from the shop');
const archived=(await (await env.BUCKET.get(catalogueKey)).json()).find(item=>item.id===newId);
assert.equal(archived.archived,true);
assert.equal(archived.revision,published.revision+1);
assert.deepEqual([archived.image,archived.backImage,archived.quantity],[front,back,published.quantity]);
assert.equal((await push([{...change(published),revision:archived.revision}])).status,409,'Removal cannot be undone by an old editor');
assert.equal((await call('/api/logout',{})).status,200);
assert.equal((await call('/api/items')).status,401);
console.log('Verified native password login, session revocation on logout, batch publication, conflict rollback and cross-origin rejection.');
