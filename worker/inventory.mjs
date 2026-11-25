const catalogueKey = 'store/v1/catalogue.json';
const imagePrefix = 'store/v1/images/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const categories = new Set(['Singles', 'Packs', 'Accessories']);
const taxonomyKey = 'store/v1/taxonomy.json';
const taxonomyLimits = {category:60, set:120, series:100, grader:24, language:40, itemCondition:80};
async function taxonomyRoute(request, env) {
  if (request.method === 'GET') {
    const saved = await env.BUCKET.get(taxonomyKey);
    return json(saved ? await saved.json() : {});
  }
  const {field, value:raw} = await readForm(request, 2048);
  if (typeof field !== 'string' || !Object.hasOwn(taxonomyLimits, field) || !isText(raw, taxonomyLimits[field])) reject(400, 'Enter a valid choice.');
  const value = raw.normalize('NFKC').trim();
  if (!value || value.length > taxonomyLimits[field] || /[\u0000-\u001f\u007f]/u.test(value) || value === '__lemrix_add_choice__') reject(400, 'Enter a valid choice.');
  if (field === 'category' && ['all items','saved','pre-orders','recently-added','recently added','pre orders','browse sets','rewards','lem points'].includes(value.toLowerCase())) reject(400, 'This name is already used in the shop navigation.');
  for (let attempt=0; attempt<4; attempt++) {
    const saved = await env.BUCKET.get(taxonomyKey);
    const options = saved ? await saved.json() : {};
    const current = options[field] || [];
    if (current.some(name => name.toLowerCase() === value.toLowerCase())) return json(options);
    if (current.length >= 1000) reject(400, 'This dropdown has reached its maximum of 1,000 custom choices.');
    options[field] = [...current, value];
    const onlyIf = new Headers(saved ? {'If-Match':'"'+saved.etag+'"'} : {'If-None-Match':'*'});
    if (await env.BUCKET.put(taxonomyKey, JSON.stringify(options), {onlyIf, httpMetadata:{contentType:'application/json'}})) return json(options);
  }
  reject(409, 'Another choice was added at the same time. Please try again.');
}
async function validListingCategory(value, old, env) {
  if (!isText(value, taxonomyLimits.category)) return false;
  if (categories.has(value) || value === old?.category) return true;
  const saved = await env.BUCKET.get(taxonomyKey);
  return saved ? Boolean((await saved.json()).category?.includes(value)) : false;
}
const photoPath = /^\/media\/([a-f0-9]{32})$/;
const errors = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
class FormError extends Error {
  constructor(status, message, headers={}) { super(message); this.status = status; this.headers = headers; }
}
function reject(status, message, headers) { throw new FormError(status, message, headers); }
function json(data, status=200, headers={}) {
  return Response.json(data, {status, headers:{...errors, ...headers}});
}
function isText(value, max) { return typeof value === 'string' && value.trim() && value.length <= max; }
function quantity(value, max) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }
function hex(bytes) { return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join(''); }
function randomId() {return hex(crypto.getRandomValues(new Uint8Array(16)));}
async function readBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) reject(413, 'File or form too large.');
  if (!request.body) reject(400, 'Request body is empty.');
  const reader = request.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); reject(413, 'File or form too large.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {result.set(part, at); at += part.length;}
  return result;
}
async function readForm(request, limit=32000) {
  const buffer = await readBody(request, limit);
  try {
    const body = JSON.parse(decoder.decode(buffer));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* A malformed request gets the same response as an invalid form. */ }
  reject(400, 'Invalid form.');
}
function recognizedImage(data) {
  if (data.length < 20) return null;
  if (hex(data.slice(0,8)) === '89504e470d0a1a0a' && decoder.decode(data.slice(12,16)) === 'IHDR') return 'image/png';
  if (data[0]===255 && data[1]===216 && data[2]===255) return 'image/jpeg';
  if (decoder.decode(data.slice(0,4)) === 'RIFF' && decoder.decode(data.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
async function getCatalogue(env, initial) {
  const saved = await env.BUCKET.get(catalogueKey);
  if (!saved && env.REQUIRE_STORED_CATALOGUE) reject(503, 'The live inventory is temporarily unavailable. Please try again shortly.');
  if (!saved) return {items:initial.map(p=>({...p,revision:0})), etag:null};
  const items = await saved.json();
  const nigi = initial.find(item => item.id === 'nigi');
  const existing = items.find(item => item.id === 'nigi');
  if (!env.REQUIRE_STORED_CATALOGUE && nigi && !existing) items.push({...nigi, revision:0});
  if (existing?.name === 'Nigi') existing.name = 'Neegy';
  if (existing?.description === 'Nigi') existing.description = 'Neegy';
  return {items, etag:saved.etag};
}
async function applyListing(items,body,env) {
  if (!body || typeof body !== 'object') reject(400,'Invalid listing.');
  if (body.id != null && !isText(body.id,100)) reject(400,'Invalid listing.');
  const index = body.id ? items.findIndex(p=>p.id===body.id) : -1;
  if (body.create && (index >= 0 || !/^[a-f0-9]{32}$/.test(body.id))) reject(409,'This listing already exists. Refresh the shop.');
  if (body.id && !body.create && index<0) reject(404,'Listing not found.');
  const old = items[index];
  if (old?.archived) reject(409,'This listing has already been removed. Refresh the shop.');
  if (old && body.revision !== old.revision) reject(409,'Someone edited this listing. Refresh before saving.');
  if (body.remove === true) {
    if (!old || body.create) reject(400,'Choose a published product to remove.');
    if (old.checkoutHolds?.length) reject(409,old.name+' has items held at checkout. Try again after the checkout ends.');
    old.archived = true;
    old.revision++;
    return old.id;
  }
  if (!isText(body.name,100) || !isText(body.description,3000) || !(await validListingCategory(body.category, old, env)) || (body.quantity !== null && !quantity(body.quantity,1000000))) reject(400,'Check the name, description, category and stock quantity.');
  if (!old || body.image !== old.image) {
    const match = typeof body.image==='string' && body.image.match(photoPath);
    if (!match || !(await env.BUCKET.head(imagePrefix+match[1]))) reject(400, 'Upload a product image.');
  }
  if (!Array.isArray(body.prices) || body.prices.length!==(old?.copies?.length || 1) || !body.prices.every(n=>quantity(n,999999999))) reject(400,'Enter a valid price for each copy.');
  const previousPrices=old?.copies?.map(copy=>copy.cents) || [old?.cents];
  if(body.prices.some((cents,index)=>cents===0 && previousPrices[index]!==0)){
    reject(400,'Each new or updated price must be at least AUD 0.01.');
  }
  if ((old?.checkoutHolds?.length || 0) > (body.quantity || 0)) reject(409,'Stock cannot be reduced below copies currently held at checkout.');
  const next = {...(old || {id:body.id || randomId(),format:body.category==='Singles'?'Trading card':body.category,collection:'recently-added',notes:''}),
    name:body.name.trim(), description:body.description.trim(), category:body.category, quantity:body.quantity, image:body.image, revision:old?old.revision+1:0};
  if (old?.copies) next.copies=old.copies.map((copy,i)=>({...copy,cents:body.prices[i]}));
  else next.cents=body.prices[0];
  for (const [key,max] of [['notes',3000],['availability',3000],['format',100]]) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > max) reject(400,'Check the product details.');
    next[key] = body[key].trim();
  }
  if (body.collection !== undefined) {
    if (!['','pre-orders','recently-added'].includes(body.collection)) reject(400,'Unknown collection.');
    next.collection = body.collection;
  }
  if (next.collection === 'pre-orders') {
    if (body.preorderDispatch !== undefined && body.preorderDispatch !== '' && !validDispatchDate(body.preorderDispatch))
      reject(400, 'Choose a valid expected dispatch date.');
    if (body.preorderDispatch !== undefined) next.preorderDispatch = body.preorderDispatch;
  } else delete next.preorderDispatch;
  if (old?.checkoutHolds?.length && ((next.collection === 'pre-orders') !== (old.collection === 'pre-orders') ||
      next.preorderDispatch !== old.preorderDispatch)) reject(409, 'Wait for active checkouts to end before changing dispatch terms.');
  if (body.card!==undefined) {
    if (!body.card || typeof body.card!=='object' || Array.isArray(body.card)) reject(400,'Invalid collector details.');
    const card={};
    for (const [key,max] of Object.entries({set:120,series:100,cardNumber:35,language:40,grader:24,grade:30,certificate:42,year:4,itemCondition:80,productType:20})) {
      const value=body.card[key];
      if(value==null || value==='')continue;
      if(!isText(value,max))reject(400,'Check the collector details.');
      card[key]=value.trim();
    }
    if(card.productType && !['card','slab','pack','box','accessory'].includes(card.productType))reject(400,'Unknown product type.');
    if(card.year && !/^\d{4}$/.test(card.year))reject(400,'Enter a four-digit year.');
    if(card.grader?.toUpperCase()==='PSA' && card.certificate && !/^\d{5,12}$/.test(card.certificate))reject(400,'Check the PSA certificate number.');
    next.card=card;
  }
  async function photoReference(value,previous) {
    if (value===previous || value===undefined || value==='')return previous;
    const match=typeof value==='string' && value.match(photoPath);
    if(!match || !(await env.BUCKET.head(imagePrefix+match[1])))reject(400,'Upload a valid product photo.');
    return value;
  }
  if(body.backImage!==undefined) next.backImage=await photoReference(body.backImage,old?.backImage);
  if(!old && ['card','slab'].includes(next.card?.productType) && !next.backImage)reject(400,'Add a back photo for this card.');
  if(body.copyPhotos!==undefined) {
    if(!Array.isArray(body.copyPhotos)||body.copyPhotos.length!==next.copies?.length)reject(400,'Check the photos for each copy.');
    for(const [i,faces] of body.copyPhotos.entries()){
      if(!faces || typeof faces!=='object')reject(400,'Check the photos for each copy.');
      next.copies[i].photos={front:await photoReference(faces.front,old?.copies?.[i].photos?.front),back:await photoReference(faces.back,old?.copies?.[i].photos?.back)};
    }
  }
  if(!old)next.createdAt=new Date().toISOString();
  if (body.conditions) {
    if (!next.copies || !Array.isArray(body.conditions) || body.conditions.length !== next.copies.length || !body.conditions.every(c=>isText(c,80))) reject(400,'Check each copy condition.');
    next.copies = next.copies.map((c,i)=>({...c,condition:body.conditions[i].trim()}));
  }
  if (body.wear !== undefined) {
    if (!next.copies || !Array.isArray(body.wear) || body.wear.length !== next.copies.length ||
        !body.wear.every(notes => ['front','back'].every(face=>typeof notes?.[face] === 'string' && notes[face].length <= 500))) reject(400,'Check the condition notes.');
    next.copies=next.copies.map((copy,i)=>({...copy,front:[body.wear[i].front,...copy.front.slice(1)],back:[body.wear[i].back,...copy.back.slice(1)]}));
  }
  if (old) items[index]=next;
  else items.push(next);
  return next.id;
}
async function saveListings(changes,env,initial,single=false) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) reject(400,'Push between 1 and 100 products at once.');
  for (let attempt=0; attempt<4; attempt++) {
    const {items,etag}=await getCatalogue(env,initial);
    const ids=[];
    for (const change of changes) ids.push(await applyListing(items,change,env));
    const onlyIf=new Headers(etag ? {'If-Match':'"'+etag+'"'} : {'If-None-Match':'*'});
    if (await env.BUCKET.put(catalogueKey,JSON.stringify(items),{onlyIf,httpMetadata:{contentType:'application/json'}})) {
      if(single){
        const item=items.find(entry=>entry.id===ids[0]);
        return json({id:item.id,ids,item,listing:forShop(item,checkoutMode(env))});
      }
      return json({id:ids[0],ids});
    }
  }
  reject(409,'Another change is being saved. Try again.');
}
export async function handleInventory(request, env, initial) {
  const url = new URL(request.url), path = url.pathname;
  const image = path.match(photoPath);
  if (!path.startsWith('/api/') && path!=='/shop/catalogue.js' && !image) return null;
  try {
    if (path.startsWith('/api/')) {
      const methods = {
        '/api/login':['POST'], '/api/logout':['POST'], '/api/logout-all':['POST'], '/api/account':['GET'],
        '/api/items':['GET','POST'], '/api/taxonomy':['GET','POST'], '/api/items/push':['POST'], '/api/images':['POST'],
        '/api/customer/session':['GET'], '/api/customer/login':['POST'], '/api/customer/register':['POST'], '/api/customer/challenge':['POST'], '/api/customer/google':['POST'], '/api/customer/apple':['POST'], '/api/customer/logout':['POST'],
        '/api/rewards':['GET'], '/api/rewards/code':['GET'], '/api/rewards/join':['POST'], '/api/rewards/recover':['POST'],
        '/api/rewards/art/hill-club':['GET'], '/api/rewards/art/last-showing':['GET'], '/api/rewards/art/after-hours':['GET'],
        '/api/offers/list':['POST'], '/api/offers/lookup':['POST'], '/api/offers/submit':['POST'], '/api/offers/checkout':['POST'],
        '/api/staff/offers/list':['POST'], '/api/staff/offers/review':['POST'],
        '/api/checkout':['POST'], '/api/checkout/status':['POST'], '/api/checkout/tracking':['POST'], '/api/checkout/cancel':['POST'], '/api/square/webhook':['POST'],
      }[path];
      if (!methods) reject(404, 'Unknown route.');
      if (!methods.includes(request.method)) reject(405, 'Method unavailable.');
    }
    if (!env.BUCKET) reject(503,'Inventory storage is unavailable.');
    if (path==='/api/checkout/tracking') return await orderTracking(request,env,url);
    if (path==='/api/rewards'||path.startsWith('/api/rewards/')) return await rewardsRoute(request,env,url);
    if (path.startsWith('/api/offers/')) return await offerRoute(request,env,initial,url);
    if (path.startsWith('/api/customer/')) return await customerRoute(request,env,url);
    if (['/api/checkout','/api/checkout/status','/api/checkout/cancel','/api/square/webhook'].includes(path)) {
      return await checkoutRoute(request, env, initial, url);
    }
    if (path==='/shop/catalogue.js' && request.method==='GET') {
      let {items}=await getCatalogue(env,initial);
      const mode = checkoutMode(env);
      if (mode === 'live' && await refreshReservations(env, initial, items)) {
        ({items} = await getCatalogue(env, initial));
      }
      const catalogue = items.filter(item => !item.archived).map(item => forShop(item, mode));
      if (request.headers.get('Accept')?.split(',').some(type => type.trim().split(';')[0] === 'application/json')) {
        return json(catalogue, 200, {Vary:'Accept'});
      }
      return new Response('const products = '+JSON.stringify(catalogue)+';', {headers:{...errors,Vary:'Accept','Content-Type':'application/javascript; charset=utf-8'}});
    }
    if (image && (request.method==='GET' || request.method==='HEAD')) {
      const object=await env.BUCKET[request.method==='HEAD'?'head':'get'](imagePrefix+image[1]);
      if (!object) reject(404,'Image not found.');
      return new Response(object.body || null,{headers:{'Content-Type':object.httpMetadata.contentType,'Content-Length':String(object.size),'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=31536000, immutable'}});
    }
    if (!path.startsWith('/api/')) reject(405,'Method unavailable.');
    requireAdminConfiguration(env);
    if (request.method!=='GET') requireTrustedOrigin(request,url);
    if (path==='/api/login' && request.method==='POST') return await adminLogin(request,env);
    const session=await sessionId(request,env);
    if (!session) reject(401,'Sign in required');
    if (path.startsWith('/api/staff/offers/')) return await offerRoute(request,env,initial,url,true);
    if (path==='/api/account' && request.method==='GET') return json({username:adminUsername,expires:session.expires});
    if ((path==='/api/logout' || path==='/api/logout-all') && request.method==='POST') {
      return await adminLogout(env,session,path==='/api/logout-all');
    }
    if (path==='/api/taxonomy') return await taxonomyRoute(request, env);
    if (path==='/api/items' && request.method==='GET') return json((await getCatalogue(env,initial)).items.filter(item => !item.archived));
    if (path==='/api/items' && request.method==='POST') return await saveListings([await readForm(request)],env,initial,true);
    if (path==='/api/items/push' && request.method==='POST') return await saveListings((await readForm(request,1024*1024)).changes,env,initial);
    if (path==='/api/images' && request.method==='POST') {
      const data=await readBody(request,5*1024*1024), mime=recognizedImage(data);
      if (!mime) reject(415,'Choose a JPEG, PNG or WebP image.');
      const mediaId=randomId();
      await env.BUCKET.put(imagePrefix+mediaId,data,{httpMetadata:{contentType:mime}});
      return json({image:'/media/'+mediaId});
    }
    reject(404,'Unknown route.');
  } catch (error) {
    if (error instanceof FormError) return json({error:error.message},error.status,error.headers);
    console.error('Inventory operation failed:', error.name, error.message);
    return json({error:'Inventory could not be loaded or saved. Please try again.'},500);
  }
}
