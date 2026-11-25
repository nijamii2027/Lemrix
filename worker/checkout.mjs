const stripeSessionId = /^cs_(?:test_|live_)?[A-Za-z0-9]{12,240}$/;
const checkoutStore = 'lemrix-illustrated';
function checkoutMode(env) {
  if (/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '')) return 'test';
  if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '') && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_SHIPPING_RATE) return 'live';
  return 'off';
}
function forShop(item, mode) {
  const {checkoutHolds = [], ...publicItem} = item;
  const available = Math.max(0, (item.quantity ?? 0) - checkoutHolds.length);
  const demo = mode === 'test';
  const eligible = mode !== 'off' && item.collection !== 'pre-orders' &&
    (demo ? item.quantity !== 0 : available > 0);
  if (item.copies) publicItem.copies = item.copies.map((copy, index) => ({
    ...copy, canBuy: eligible && !copy.sold && copy.cents >= 50 &&
      (demo || !checkoutHolds.some(h => h.copy === index))
  }));
  publicItem.canBuy = eligible && (item.copies ? publicItem.copies.some(c => c.canBuy) : item.cents >= 50);
  publicItem.checkoutMode = mode;
  if (mode === 'live' && available === 0 && checkoutHolds.length) publicItem.reserved = true;
  if (Number.isInteger(item.quantity) && !demo) publicItem.quantity = available;
  return publicItem;
}
async function stripeRequest(env, path, form, requestId) {
  const headers = {Authorization:'Bearer ' + env.STRIPE_SECRET_KEY, 'Stripe-Version':'2024-06-20'};
  if (requestId) headers['Idempotency-Key'] = requestId;
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: form ? 'POST' : 'GET', headers, body: form
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const error = result?.error;
    const safe = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
    // Keep diagnostics useful without logging credentials, customer data or raw messages.
    console.error('Stripe API request failed', {
      status: response.status,
      field: ['version', 'expires_at', 'shipping_rate', 'payment method', 'activate', 'capabilit', 'currency', 'business', 'account', 'live mode'].find(term => error?.message?.toLowerCase().includes(term)),
      type: safe(error?.type, /^[a-z_]{1,80}$/),
      code: safe(error?.code, /^[a-z0-9_]{1,80}$/),
      param: safe(error?.param, /^[a-zA-Z0-9_.\[\]]{1,160}$/),
      requestId: safe(response.headers.get('Request-Id'), /^req_[a-zA-Z0-9]{1,100}$/)
    });
    reject(502, 'Stripe could not complete this request. Try again shortly.');
  }
  return response.json();
}
async function updateStock(env, initial, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const {items, etag} = await getCatalogue(env, initial);
    if (!change(items)) return;
    const onlyIf = new Headers(etag ? {'If-Match':'"' + etag + '"'} : {'If-None-Match':'*'});
    if (await env.BUCKET.put(catalogueKey, JSON.stringify(items), {onlyIf, httpMetadata:{contentType:'application/json'}})) return;
  }
  reject(503, 'The stockroom is busy. Try again.');
}
function selectedListing(items, body, mode) {
  const item = items.find(row => row.id === body.itemId);
  if (!item) reject(404, 'Listing not found.');
  const listing = forShop(item, mode);
  const selected = item.copies && Number.isInteger(body.copy) ? listing.copies[body.copy] : null;
  if (item.copies ? !selected?.canBuy : body.copy !== null || !listing.canBuy)
    reject(409, 'This item or copy is unavailable. Refresh the shop to see current stock.');
  const cents = selected ? selected.cents : item.cents;
  if (cents !== body.expectedCents) reject(409, 'The price changed. Refresh to see the new price.');
  return {item, cents, title: selected ? item.name + ' · Copy ' + String.fromCharCode(65 + body.copy) + ' · ' + selected.condition : item.name};
}
function matchesStore(session) {
  return stripeSessionId.test(session.id) && session.metadata?.store === checkoutStore;
}
async function settleCheckout(env, initial, session) {
  if (!matchesStore(session)) return 'unknown';
  const paid = session.status === 'complete' && session.payment_status === 'paid';
  if (!paid && session.status !== 'expired') return 'pending';
  if (!session.livemode) return paid ? 'test-paid' : 'expired';
  await updateStock(env, initial, items => {
    const order = items.map(item => ({item, units:(item.checkoutHolds || []).filter(h => h.session === session.id)}))
      .filter(line => line.units.length);
    if (!order.length) return false;
    const subtotal = order.reduce((sum, line) => sum + line.units.reduce((total,h) => total + h.cents,0),0);
    if (paid && (session.currency !== 'aud' || session.amount_subtotal !== subtotal)) reject(409, 'Order total needs review.');
    for (const {item,units} of order) {
      if (paid) {
        item.quantity = Math.max(0, item.quantity - units.length);
        for (const unit of units) if (unit.copy !== null) item.copies[unit.copy].sold = true;
      }
      item.checkoutHolds = item.checkoutHolds.filter(h => h.session !== session.id);
      item.revision++;
    }
    return true;
  });
  if(paid && session.currency==='aud')await recordReward(env,session.metadata,'subtotal',session.amount_subtotal);
  return paid ? 'paid' : 'expired';
}
async function refreshReservations(env, initial, item) {
  const due = (item?.checkoutHolds || []).filter(h => h.expires <= Date.now() / 1000);
  for (const id of [...new Set(due.map(h => h.session))].slice(0,8)) {
    const session = await stripeRequest(env, 'checkout/sessions/' + id);
    await settleCheckout(env, initial, session);
  }
}
function checkoutLines(body) {
  const input = body.lines === undefined ? [{...body,quantity:1}] : body.lines;
  if (!Array.isArray(input) || !input.length || input.length > 50) reject(400,'Choose between 1 and 50 cart lines.');
  const keys = new Set();
  return input.map(line => {
    if (!line || typeof line !== 'object') reject(400,'Invalid cart line.');
    const {itemId,copy,expectedCents,quantity}=line;
    const key = JSON.stringify([itemId,copy]);
    if (typeof itemId !== 'string' || !Number.isSafeInteger(expectedCents) || keys.has(key) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || (copy !== null && (!Number.isInteger(copy) || quantity !== 1)))
      reject(400,'Invalid cart line.');
    keys.add(key);
    return {itemId,copy,expectedCents,quantity};
  });
}
function priceOrder(items,lines,mode) {
  const requested = new Map();
  return lines.map(line => {
    const listing = selectedListing(items,line,mode);
    const item = listing.item;
    const count = (requested.get(item.id) || 0) + line.quantity;
    requested.set(item.id,count);
    if (mode === 'live' && count > item.quantity - (item.checkoutHolds?.length || 0))
      reject(409,'The requested quantity is no longer available. Update your cart.');
    return {...line,...listing};
  });
}
async function startCheckout(env, initial, body, origin, request) {
  const mode = checkoutMode(env);
  if (mode === 'off') reject(503, 'Checkout is not connected yet.');
  if (!/^[0-9a-f-]{36}$/.test(body.attempt || '')) reject(400, 'Invalid checkout attempt.');
  const lines = checkoutLines(body);
  let {items} = await getCatalogue(env, initial);
  const pending = items.filter(p => lines.some(l => l.itemId === p.id) && p.checkoutHolds?.some(h => h.expires <= Date.now()/1000));
  if (mode === 'live' && pending.length) {
    for (const p of pending) await refreshReservations(env, initial, p);
    ({items} = await getCatalogue(env, initial));
  }
  const held = items.flatMap(p => (p.checkoutHolds || []).filter(h => h.attempt === body.attempt).map(h => ({...h,itemId:p.id})));
  if (held.length && mode === 'live') {
    if (held.length !== lines.reduce((n,l)=>n+l.quantity,0) || lines.some(l =>
      held.filter(h=>h.itemId===l.itemId && h.copy===l.copy && h.cents===l.expectedCents).length !== l.quantity))
      reject(409,'The cart changed. Start a new checkout.');
    const existing = await stripeRequest(env, 'checkout/sessions/' + held[0].session);
    if (existing.status === 'open' && existing.url) return json({url:existing.url});
    await settleCheckout(env, initial, existing);
    reject(409, 'That checkout has ended. Refresh the shop.');
  }
  const order = priceOrder(items,lines,mode);
  const returnHash = body.lines ? '#cart' : '#item/' + encodeURIComponent(order[0].item.id);
  const details = new URLSearchParams({
    mode:'payment', 'payment_method_types[0]':'card',
    'shipping_address_collection[allowed_countries][0]':'AU', 'metadata[store]':checkoutStore,
    'metadata[item_id]':order[0].item.id, 'metadata[attempt]':body.attempt,
    'success_url':origin + '/shop/?checkout={CHECKOUT_SESSION_ID}&attempt=' + body.attempt + returnHash,
    'cancel_url':origin + '/shop/?checkout=cancelled&attempt=' + body.attempt + returnHash
  });
  if(mode==='live'){
    const wallet=await currentPass(request,env);
    if(wallet){
      details.set('metadata[reward_pass]',wallet.id);
      for(const [k,v] of Object.entries({store:checkoutStore,reward_pass:wallet.id,attempt:body.attempt}))
        details.set('payment_intent_data[metadata]['+k+']',v);
    }
  }
  for (const [i,line] of order.entries()) {
    const prefix = 'line_items[' + i + ']';
    details.set(prefix+'[quantity]', String(line.quantity));
    details.set(prefix+'[price_data][currency]', 'aud');
    details.set(prefix+'[price_data][unit_amount]', String(line.cents));
    details.set(prefix+'[price_data][product_data][name]', line.title);
  }
  if (env.STRIPE_SHIPPING_RATE && env.STRIPE_SHIPPING_RATE !== 'free') details.set('shipping_options[0][shipping_rate]', env.STRIPE_SHIPPING_RATE);
  // Derive expiry from a client attempt time so retries send identical Stripe parameters.
  if (!Number.isSafeInteger(body.started) || Math.abs(Date.now()/1000 - body.started) > 600) reject(400, 'Start a new checkout.');
  details.set('expires_at', String(body.started + 45 * 60));
  // A new request schema must not replay failures cached under the retired schema.
  const session = await stripeRequest(env, 'checkout/sessions', details, 'lemrix-card-' + body.attempt);
  if (!stripeSessionId.test(session.id) || session.status !== 'open' || !session.url ||
      new URL(session.url).origin !== 'https://checkout.stripe.com' || session.livemode !== (mode === 'live'))
    reject(502, 'Stripe checkout is unavailable.');
  if (mode === 'live') {
    try {
      await updateStock(env, initial, rows => {
        if (rows.some(item => item.checkoutHolds?.some(h => h.session === session.id))) return false;
        for (const line of priceOrder(rows,lines,mode)) {
          const holds = line.item.checkoutHolds ||= [];
          for (let unit=0; unit<line.quantity; unit++) holds.push({session:session.id,attempt:body.attempt,copy:line.copy,cents:line.cents,expires:session.expires_at});
          line.item.revision++;
        }
        return true;
      });
    } catch (error) {
      if (error.status === 409) await stripeRequest(env,'checkout/sessions/'+session.id+'/expire',new URLSearchParams());
      throw error;
    }
  }
  return json({url:session.url});
}
async function cancelCheckout(env, initial, body) {
  if (!/^[0-9a-f-]{36}$/.test(body.attempt || '')) reject(400, 'Invalid checkout attempt.');
  const {items} = await getCatalogue(env, initial);
  const hold = items.flatMap(row => row.checkoutHolds || []).find(h => h.attempt === body.attempt);
  if (!hold) return json({status:'closed'});
  let session = await stripeRequest(env, 'checkout/sessions/' + hold.session);
  if (session.status === 'open') session = await stripeRequest(env, 'checkout/sessions/' + hold.session + '/expire', new URLSearchParams());
  return json({status:await settleCheckout(env, initial, session)});
}
async function stripeEvent(request, env, initial) {
  if (!env.STRIPE_WEBHOOK_SECRET) reject(503, 'Webhook is not configured.');
  const raw = await readBody(request, 512000);
  const signature = request.headers.get('Stripe-Signature') || '';
  const values = signature.split(',').map(s => s.trim().split('='));
  const stamp = values.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(stamp || '') || Math.abs(Date.now()/1000 - Number(stamp)) > 300) reject(400, 'Invalid signature.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.STRIPE_WEBHOOK_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const prefix = encoder.encode(stamp + '.');
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix); signed.set(raw, prefix.length);
  let valid = false;
  for (const [name, value] of values) {
    if (name !== 'v1' || !/^[0-9a-f]{64}$/.test(value || '')) continue;
    const bytes = Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) {valid = true; break;}
  }
  if (!valid) reject(400, 'Invalid signature.');
  const event = JSON.parse(decoder.decode(raw));
  if(event.type==='charge.refunded'){
    const charge=event.data.object;
    if(charge.livemode && charge.currency==='aud')await recordReward(env,charge.metadata,'refund',charge.amount_refunded);
  }
  if (['checkout.session.completed','checkout.session.expired'].includes(event.type))
    await settleCheckout(env, initial, event.data.object);
  return json({received:true});
}
async function checkoutRoute(request, env, initial, url) {
  if (request.method !== 'POST') reject(405, 'Use POST for checkout.');
  if (url.pathname === '/api/stripe/webhook') return stripeEvent(request, env, initial);
  const publicOrigin = requireTrustedOrigin(request, url);
  const body = await readForm(request);
  if (url.pathname === '/api/checkout') return startCheckout(env, initial, body, publicOrigin, request);
  if (url.pathname === '/api/checkout/cancel') return cancelCheckout(env, initial, body);
  if (!stripeSessionId.test(body.session || '')) reject(400, 'Invalid checkout reference.');
  if (checkoutMode(env) === 'off') reject(503, 'Checkout is unavailable.');
  const session = await stripeRequest(env, 'checkout/sessions/' + body.session);
  const status = await settleCheckout(env, initial, session);
  if (status === 'unknown') reject(404, 'Order not found.');
  return json({status,attempt:session.metadata?.attempt || null});
}
