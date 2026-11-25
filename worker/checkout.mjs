const checkoutStore = 'lemrix-illustrated';
const attemptId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const squareId = /^[a-zA-Z0-9_-]{1,192}$/;
const squareLinks = 'online-checkout/payment-links';

function checkoutMode(env) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID || !env.SQUARE_WEBHOOK_SIGNATURE_KEY ||
      !/^\d{1,9}$/.test(env.SQUARE_SHIPPING_CENTS ?? '')) return 'off';
  const environment = env.SQUARE_ENVIRONMENT ?? 'production';
  if (environment === 'sandbox') return 'test';
  return environment === 'production' ? 'live' : 'off';
}

function forShop(item, mode) {
  const {checkoutHolds = [], ...publicItem} = item;
  const available = Math.max(0, (item.quantity ?? 0) - checkoutHolds.length);
  const demo = mode === 'test';
  const eligible = !item.archived && mode !== 'off' && item.collection !== 'pre-orders' &&
    (demo ? item.quantity !== 0 : available > 0);
  if (item.copies) publicItem.copies = item.copies.map((copy, index) => {
    const reserved = !copy.sold && !demo && checkoutHolds.some(hold => hold.copy === index);
    return {...copy, reserved, canBuy:eligible && !copy.sold && !reserved && Number.isSafeInteger(copy.cents) && copy.cents > 0};
  });
  publicItem.canBuy = eligible && (item.copies ? publicItem.copies.some(c => c.canBuy) : Number.isSafeInteger(item.cents) && item.cents > 0);
  publicItem.checkoutMode = mode;
  publicItem.reserved = !demo && available === 0 && checkoutHolds.length > 0;
  if (Number.isInteger(item.quantity) && !demo) publicItem.quantity = available;
  return publicItem;
}
async function updateStock(env, initial, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const {items, etag} = await getCatalogue(env, initial);
    if (!await change(items)) return;
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

async function squareRequest(env, path, method = 'GET', body, allowMissing = false) {
  const host = checkoutMode(env) === 'test' ? 'connect.squareupsandbox.com' : 'connect.squareup.com';
  const response = await fetch('https://' + host + '/v2/' + path, {
    method, redirect:'error',
    headers:{Authorization:'Bearer ' + env.SQUARE_ACCESS_TOKEN, 'Content-Type':'application/json', 'Square-Version':'2026-11-18'},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  if (allowMissing && response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const code = data?.errors?.[0]?.code;
    console.error('Square request failed', response.status, /^[A-Z0-9_]{1,80}$/.test(code || '') ? code : 'UNKNOWN');
    reject(502, 'Square checkout is temporarily unavailable. Please try again.');
  }
  return data;
}

function checkoutPath(env, attempt, part) {
  return 'store/v2/square/' + checkoutMode(env) + '/' + attempt + '/' + part + '.json';
}
async function getCheckoutPart(env, attempt, part) {
  const obj = await env.BUCKET.get(checkoutPath(env, attempt, part));
  return obj ? obj.json() : null;
}
async function saveCheckoutPart(env, attempt, part, value) {
  const stored = await env.BUCKET.put(checkoutPath(env, attempt, part), JSON.stringify(value), {
    onlyIf:new Headers({'If-None-Match':'*'}), httpMetadata:{contentType:'application/json'}
  });
  if (stored) return value;
  const previous = await getCheckoutPart(env, attempt, part);
  if (!previous) reject(503, 'Please retry this checkout.');
  return previous;
}

function squareLink(env, link) {
  if (!squareId.test(link?.id || '') || !squareId.test(link?.order_id || '')) reject(502, 'Square returned an invalid checkout.');
  const url = URL.canParse(link.url) && new URL(link.url);
  const allowed = checkoutMode(env) === 'test' ? ['https://sandbox.square.link'] : ['https://square.link', 'https://checkout.square.site'];
  if (!url || url.username || url.password || !allowed.includes(url.origin)) reject(502, 'Square returned an invalid checkout address.');
  return {id:link.id, orderId:link.order_id, url:url.href};
}

async function prepareQuote(env, initial, request, body, origin) {
  const lines = checkoutLines(body);
  const {attempt} = body;
  let quote = await getCheckoutPart(env, attempt, 'quote');
  if (!quote) {
    if (!Number.isSafeInteger(body.started) || Math.abs(Date.now()/1000 - body.started) > 600) reject(400, 'Start a new checkout.');
    let {items} = await getCatalogue(env, initial);
    const requestedIds = new Set(lines.map(line => line.itemId));
    if (checkoutMode(env) === 'live' && await refreshReservations(env, initial, items.filter(item => requestedIds.has(item.id)))) {
      ({items} = await getCatalogue(env, initial));
    }
    const priced = priceOrder(items, lines, checkoutMode(env));
    const wallet = checkoutMode(env) === 'live' ? await currentPass(request, env) : null;
    const hash = body.lines ? '#cart' : '#item/' + encodeURIComponent(lines[0].itemId);
    quote = await saveCheckoutPart(env, attempt, 'quote', {
      attempt, lines, location:env.SQUARE_LOCATION_ID, expires:Math.floor(Date.now()/1000) + 45*60,
      subtotal:priced.reduce((sum, line) => sum + line.cents * line.quantity, 0),
      shipping:Number(env.SQUARE_SHIPPING_CENTS), pass:wallet?.id || null,
      returnUrl:origin + '/shop/?checkout=' + attempt + '&attempt=' + attempt + hash,
      items:priced.map(line => ({name:line.title, quantity:String(line.quantity), base_price_money:{amount:line.cents, currency:'AUD'}}))
    });
  }
  if (JSON.stringify(quote.lines) !== JSON.stringify(lines) || quote.location !== env.SQUARE_LOCATION_ID) reject(409, 'The cart changed. Start a new checkout.');
  return quote;
}

async function getOrCreateLink(env, quote) {
  const existing = await getCheckoutPart(env, quote.attempt, 'link');
  if (existing) return existing;
  const options = {
    redirect_url:quote.returnUrl, ask_for_shipping_address:true, allow_tipping:false, enable_coupon:false, enable_loyalty:false,
    accepted_payment_methods:{apple_pay:true, google_pay:true}
  };
  if (quote.shipping) options.shipping_fee = {name:'Shipping', charge:{amount:quote.shipping, currency:'AUD'}};
  const result = await squareRequest(env, squareLinks, 'POST', {
    idempotency_key:quote.attempt,
    order:{location_id:quote.location, reference_id:quote.attempt, line_items:quote.items},
    checkout_options:options
  });
  return saveCheckoutPart(env, quote.attempt, 'link', squareLink(env, result.payment_link));
}

async function reserveSquareStock(env, initial, quote, link) {
  await updateStock(env, initial, async rows => {
    // Recheck inside the conditional catalogue update. A concurrent cancel or
    // settlement must not be followed by recreating the same reservation.
    if (await getCheckoutPart(env, quote.attempt, 'closed') || await getCheckoutPart(env, quote.attempt, 'stop'))
      reject(409, 'That checkout has ended.');
    if (rows.some(item => item.checkoutHolds?.some(h => h.provider === 'square' && h.session === link.orderId))) return false;
    for (const line of priceOrder(rows, quote.lines, 'live')) {
      const holds = line.item.checkoutHolds ||= [];
      for (let n = 0; n < line.quantity; n++) {
        holds.push({provider:'square', session:link.orderId, attempt:quote.attempt, copy:line.copy, cents:line.cents, expires:quote.expires});
      }
      line.item.revision++;
    }
    return true;
  });
}

async function startCheckout(env, initial, body, origin, request) {
  const quote = await prepareQuote(env, initial, request, body, origin);
  if (await getCheckoutPart(env, quote.attempt, 'closed') || await getCheckoutPart(env, quote.attempt, 'stop'))
    reject(409, 'That checkout has ended.');
  if (quote.expires <= Date.now()/1000) reject(409, 'That checkout has expired. Start a new checkout.');
  const link = await getOrCreateLink(env, quote);
  if (checkoutMode(env) === 'live') {
    try {
      await reserveSquareStock(env, initial, quote, link);
    } catch (error) {
      // The link is private until stock is reserved. Cancel failed competing
      // checkouts; never release a hold just because a remote request failed.
      if (error.status === 409 && !await getCheckoutPart(env, quote.attempt, 'closed')) {
        await reconcileCheckout(env, initial, quote, link, true);
      }
      throw error;
    }
  }
  // A cancellation may have raced the first stock write while no holds were
  // visible. Finish any recorded terminal action before handing out the URL.
  const closed = await getCheckoutPart(env, quote.attempt, 'closed');
  if (closed) {
    await settleSquareStock(env, initial, quote, link, closed.status);
    reject(409, 'That checkout has ended.');
  }
  if (await getCheckoutPart(env, quote.attempt, 'stop')) {
    await reconcileCheckout(env, initial, quote, link, true);
    reject(409, 'That checkout has ended.');
  }
  return json({attempt:quote.attempt, url:link.url});
}

function validateOrder(quote, link, order) {
  if (order?.id !== link.orderId || order.reference_id !== quote.attempt || order.location_id !== quote.location) {
    reject(409, 'Square order details need review.');
  }
}
async function orderPayments(env, quote, link, order, eventPaymentId) {
  const ids = new Set((order.tenders || []).map(tender => tender.payment_id || tender.id));
  if (eventPaymentId) ids.add(eventPaymentId);
  const payments = [];
  for (const id of ids) {
    if (!squareId.test(id || '')) reject(409, 'Square payment needs review.');
    const {payment} = await squareRequest(env, 'payments/' + id);
    if (payment?.id !== id || payment.order_id !== link.orderId || payment.location_id !== quote.location) reject(409, 'Square payment details need review.');
    payments.push(payment);
  }
  return payments;
}
async function settleSquareStock(env, initial, quote, link, status) {
  const outcome = await saveCheckoutPart(env, quote.attempt, 'closed', {status});
  if (outcome.status !== status) reject(409, 'Square order status needs review.');
  if (checkoutMode(env) === 'test') return;
  await updateStock(env, initial, rows => {
    let count = 0, subtotal = 0;
    for (const item of rows) {
      const held = item.checkoutHolds?.filter(h => h.provider === 'square' && h.session === link.orderId);
      if (!held?.length) continue;
      count += held.length;
      for (const h of held) {
        subtotal += h.cents;
        if (status === 'paid' && h.copy !== null) item.copies[h.copy].sold = true;
      }
      if (status === 'paid') item.quantity -= held.length;
      item.checkoutHolds = item.checkoutHolds.filter(h => !(h.provider === 'square' && h.session === link.orderId));
      item.revision++;
    }
    if (count && status === 'paid' && (subtotal !== quote.subtotal || count !== quote.lines.reduce((n,l) => n+l.quantity,0))) reject(409, 'Order stock needs review.');
    return count > 0;
  });
}

async function reconcileCheckout(env, initial, quote, link, cancel = false, knownOrder, eventPaymentId) {
  const readOrder = async () => (await squareRequest(env, 'orders/' + link.orderId)).order;
  let order = knownOrder || await readOrder();
  validateOrder(quote, link, order);
  let payments = await orderPayments(env, quote, link, order, eventPaymentId);
  // Deleting a single-use Square link cancels its unpaid order. Read it
  // back even on a missing link, since a completed payment may have won.
  if (cancel && !payments.some(p => !['CANCELED','FAILED'].includes(p.status)) && ['OPEN','DRAFT'].includes(order.state)) {
    await squareRequest(env, squareLinks + '/' + link.id, 'DELETE', undefined, true);
    order = await readOrder();
    validateOrder(quote, link, order);
    payments = await orderPayments(env, quote, link, order, eventPaymentId);
  }
  const complete = payments.filter(p => p.status === 'COMPLETED');
  if (complete.length) {
    let received = 0, refunded = 0;
    for (const payment of complete) {
      const money = payment.amount_money;
      const refund = payment.refunded_money;
      if (money?.currency !== 'AUD' || !Number.isSafeInteger(money.amount) || money.amount <= 0 ||
          (refund && (refund.currency !== 'AUD' || !Number.isSafeInteger(refund.amount) || refund.amount < 0 || refund.amount > money.amount))) reject(409, 'Payment total needs review.');
      received += money.amount;
      refunded += refund?.amount || 0;
    }
    if (received !== quote.subtotal + quote.shipping) reject(409, 'Order total needs review.');
    const status = checkoutMode(env) === 'test' ? 'test-paid' : 'paid';
    await settleSquareStock(env, initial, quote, link, status);
    if (status === 'paid' && quote.pass) {
      const metadata = {store:checkoutStore, attempt:quote.attempt, reward_pass:quote.pass};
      await recordReward(env, metadata, 'subtotal', quote.subtotal);
      if (refunded) await recordReward(env, metadata, 'refund', Math.min(refunded, quote.subtotal));
    }
    return {status};
  }
  if (order.state === 'CANCELED' && payments.every(p => ['CANCELED','FAILED'].includes(p.status))) {
    await settleSquareStock(env, initial, quote, link, 'expired');
    return {status:'expired'};
  }
  const payable = ['OPEN','DRAFT'].includes(order.state) && payments.every(p => ['CANCELED','FAILED'].includes(p.status));
  return {status:'pending', payable};
}

async function checkoutState(env, initial, attempt, cancel) {
  let [quote, link, stopped] = await Promise.all(['quote','link','stop'].map(part => getCheckoutPart(env, attempt, part)));
  if (!link) {
    if (!cancel && !stopped) {
      if (!quote) reject(404, 'Order not found.');
      if (quote.expires > Date.now()/1000) return {status:'pending', preparing:true};
    }
    // Stop a worker already creating this attempt from subsequently handing
    // out a link. Keep this intent separate from the provider's payment result.
    if (!stopped) stopped = await saveCheckoutPart(env, attempt, 'stop', {requested:true});
    link = await getCheckoutPart(env, attempt, 'link');
    if (!link) return {status:'expired'};
    quote ||= await getCheckoutPart(env, attempt, 'quote');
  }
  if (!quote) reject(503, 'Order details are temporarily unavailable.');
  const expired = quote.expires <= Date.now()/1000;
  const shouldCancel = Boolean(cancel || stopped || expired);
  const {status, payable} = await reconcileCheckout(env, initial, quote, link, shouldCancel);
  if (!payable || shouldCancel) return {status};
  if (checkoutMode(env) === 'live') {
    // A link can already exist while a competing request is still trying to
    // reserve the stock. Only resume if every quoted unit is held for this link.
    const {items} = await getCatalogue(env, initial);
    const held = new Map();
    for (const item of items) {
      for (const hold of item.checkoutHolds || []) {
        if (hold.provider !== 'square' || hold.session !== link.orderId || hold.attempt !== attempt) continue;
        const key = JSON.stringify([item.id, hold.copy, hold.cents]);
        held.set(key, (held.get(key) || 0) + 1);
      }
    }
    if (!quote.lines.every(line => held.get(JSON.stringify([line.itemId, line.copy, line.expectedCents])) === line.quantity))
      return {status};
  }
  return {status, url:link.url};
}

async function refreshReservations(env, initial, items) {
  const now = Math.floor(Date.now()/1000);
  const due = new Set();
  for (const item of items) {
    for (const hold of item.checkoutHolds || []) {
      if (hold.provider === 'square' && hold.expires <= now && attemptId.test(hold.attempt)) due.add(hold.attempt);
    }
  }
  if (!due.size) return false;
  const attempts = [...due];
  // Rotate bounded work across all due orders. Pending payments and provider
  // errors must keep their own stock held without starving unrelated orders.
  const offset = attempts.length > 8 ? (Math.floor(now / 30) * 8) % attempts.length : 0;
  const batch = attempts.slice(offset).concat(attempts.slice(0, offset)).slice(0, 8);
  for (let i = 0; i < batch.length; i += 2) {
    await Promise.allSettled(batch.slice(i, i + 2).map(attempt => checkoutState(env, initial, attempt, true)));
  }
  return true;
}

async function squareWebhook(request, env, initial) {
  const raw = await readBody(request, 512000);
  const signature = request.headers.get('x-square-hmacsha256-signature') || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) reject(400, 'Invalid signature.');
  const url = encoder.encode(request.url);
  const signed = new Uint8Array(url.length + raw.length);
  signed.set(url);
  signed.set(raw, url.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), signed)) reject(400, 'Invalid signature.');
  let event;
  try { event = JSON.parse(decoder.decode(raw)); } catch { reject(400, 'Invalid event.'); }
  const data = event?.data?.object;
  let payment;
  if (['payment.created','payment.updated'].includes(event?.type)) payment = data?.payment;
  if (['refund.created','refund.updated'].includes(event?.type) && squareId.test(data?.refund?.payment_id || '')) {
    ({payment} = await squareRequest(env, 'payments/' + data.refund.payment_id));
  }
  if (squareId.test(payment?.order_id || '') && squareId.test(payment?.id || '') && payment.location_id === env.SQUARE_LOCATION_ID) {
    const {order} = await squareRequest(env, 'orders/' + payment.order_id);
    if (attemptId.test(order?.reference_id || '')) {
      const quote = await getCheckoutPart(env, order.reference_id, 'quote');
      const link = await getCheckoutPart(env, order.reference_id, 'link');
      if (quote && link?.orderId === payment.order_id) await reconcileCheckout(env, initial, quote, link, false, order, payment.id);
    }
  }
  return json({received:true});
}

async function checkoutRoute(request, env, initial, url) {
  if (request.method !== 'POST') reject(405, 'Use POST for checkout.');
  if (checkoutMode(env) === 'off') reject(503, 'Square checkout is not connected yet.');
  if (url.pathname === '/api/square/webhook') return squareWebhook(request, env, initial);
  const origin = requireTrustedOrigin(request, url);
  const body = await readForm(request);
  const attempt = url.pathname === '/api/checkout/status' ? body.session : body.attempt;
  if (typeof attempt !== 'string' || !attemptId.test(attempt)) reject(400, 'Invalid checkout reference.');
  if (url.pathname === '/api/checkout') return startCheckout(env, initial, body, origin, request);
  const result = await checkoutState(env, initial, attempt, url.pathname === '/api/checkout/cancel');
  return json({...result, attempt});
}
