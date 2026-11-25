const shopOfferPrefix = 'store/v2/offers/';
const shopOfferId = /^[a-f0-9]{64}\/[a-f0-9]{64}$/;

async function offerDigest(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function offerListing(items, itemId, copy, env) {
  const item = items.find(row => row.id === itemId);
  if (!item || item.archived || item.collection === 'pre-orders') reject(409, 'This listing is unavailable for offers.');
  const listing = forShop(item, checkoutMode(env));
  const selected = copy === null && !item.copies ? listing : Number.isInteger(copy) && listing.copies?.[copy];
  if (!selected?.canBuy) reject(409, 'This item is currently unavailable.');
  return {name:item.name, condition:selected.condition || '', listCents:selected.cents};
}

async function offerStatus(env, record) {
  if (record.status !== 'accepted') return record.status;
  if (record.mode !== checkoutMode(env)) return 'expired';
  const closed = await getCheckoutPart(env, record.attempt, 'closed');
  if (closed) return ['test-paid','paid'].includes(closed.status) ? 'purchased' : 'expired';
  const quote = await getCheckoutPart(env, record.attempt, 'quote');
  if (quote ? quote.expires * 1000 < Date.now() : record.expires < Date.now()) return 'expired';
  return 'accepted';
}

async function publicOffer(env, record, staff) {
  const {id,itemId,copy,name,condition,listCents,cents,updated,version} = record;
  return {id,itemId,copy,name,condition,listCents,cents,updated,version,status:await offerStatus(env,record),
    ...(staff ? {buyer:record.buyer} : {})};
}

async function writeOffer(env, object, record) {
  const onlyIf = new Headers(object ? {'If-Match':'"' + object.etag + '"'} : {'If-None-Match':'*'});
  if (!await env.BUCKET.put(shopOfferPrefix + record.id + '.json', JSON.stringify(record),
    {onlyIf,httpMetadata:{contentType:'application/json'}})) reject(409, 'The offer just changed. Reopen your offers and try again.');
}

async function offerRoute(request, env, initial, url, staff=false) {
  const origin = requireTrustedOrigin(request,url);
  const user = staff ? null : await verifiedCustomer(request,env);
  if (!staff && !user) reject(401, 'Sign in to manage your offers.');
  const owner = user && await offerDigest(user.key);
  const action = url.pathname.split('/').pop();
  const body = await readForm(request, 5000);
  if (action === 'list') {
    if (body.cursor !== undefined && (!isText(body.cursor, 2048))) reject(400,'Invalid offers page.');
    const prefix = shopOfferPrefix + (staff ? '' : owner + '/');
    const page = await env.BUCKET.list({prefix, cursor:body.cursor, limit:15});
    const entries = await Promise.all(page.objects.map(async object => {
      if (!object.key.startsWith(prefix)) return null;
      const result = await env.BUCKET.get(object.key);
      return result && publicOffer(env,await result.json(),staff);
    }));
    return json({offers:entries.filter(Boolean).sort((a,b) => b.updated - a.updated), cursor:page.cursor || null});
  }
  let id = body.id;
  if (action === 'submit' || action === 'lookup') {
    if (!isText(body.itemId,160) || !(body.copy === null || Number.isInteger(body.copy) && body.copy >= 0))
      reject(400,'Choose a listing for your offer.');
    id = owner + '/' + await offerDigest(JSON.stringify([body.itemId,body.copy]));
  }
  if (typeof id !== 'string' || !shopOfferId.test(id) || (!staff && !id.startsWith(owner + '/'))) reject(404,'Offer not found.');
  const stored = await env.BUCKET.get(shopOfferPrefix + id + '.json');
  const previous = stored && await stored.json();
  if (action === 'lookup') return json({offer:previous && await publicOffer(env,previous,false) || null});
  if (action === 'submit') {
    const {items} = await getCatalogue(env,initial);
    const listing = offerListing(items,body.itemId,body.copy,env);
    if (!Number.isSafeInteger(body.cents) || body.cents <= 0 || body.cents > listing.listCents)
      reject(400,'Enter a positive offer up to the listed price.');
    if (previous && await offerStatus(env,previous) === 'accepted') reject(409,'You already have an accepted offer. Open your account to check out.');
    if (previous?.status === 'pending' && previous.cents === body.cents) return json({offer:await publicOffer(env,previous,false)});
    if (previous?.status === 'pending' && body.version !== previous.version) reject(409,'You already have an offer. Open your account to edit it.');
    const record = {...listing,id,itemId:body.itemId,copy:body.copy,cents:body.cents,buyer:user.name,
      status:'pending',updated:Date.now(),version:crypto.randomUUID()};
    await writeOffer(env,stored,record);
    return json({offer:await publicOffer(env,record,false)});
  }
  if (!previous) reject(404,'Offer not found.');
  if (action === 'review' && staff) {
    if (!['accepted','declined'].includes(body.status)) reject(400,'Choose accept or decline.');
    if (previous.status !== 'pending' || previous.version !== body.version) reject(409,'This offer changed. Reload the offers before reviewing it.');
    const record = {...previous,status:body.status,updated:Date.now(),version:crypto.randomUUID()};
    if (record.status === 'accepted') {
      const {items} = await getCatalogue(env,initial);
      const listing = offerListing(items,record.itemId,record.copy,env);
      if (record.listCents !== listing.listCents) reject(409,'The listing price changed. Decline this offer and request a new one.');
      Object.assign(record,{attempt:crypto.randomUUID(), expires:Date.now() + 7*86400000, mode:checkoutMode(env)});
    }
    await writeOffer(env,stored,record);
    return json({offer:await publicOffer(env,record,true)});
  }
  if (action === 'checkout' && !staff) {
    if (previous.version !== body.version || await offerStatus(env,previous) !== 'accepted') reject(409,'This offer is no longer open for checkout.');
    return startCheckout(env,initial,{attempt:previous.attempt,started:Math.floor(Date.now()/1000),
      itemId:previous.itemId,copy:previous.copy,expectedCents:previous.listCents},origin,request,previous);
  }
  reject(404,'Unknown offer action.');
}
