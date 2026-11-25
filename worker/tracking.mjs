// The buyer's checkout reference is a bearer secret. Resolve every provider ID
// from the paid checkout stored by Lemrix rather than accepting a Square order ID.
async function orderTracking(request, env, url) {
  requireTrustedOrigin(request, url);
  const {session} = await readForm(request, 1024);
  const unavailable = 'Tracking is available after payment.';
  if (typeof session !== 'string' || !attemptId.test(session)) reject(404, unavailable);
  const mode = checkoutMode(env);
  if (mode === 'off') reject(503, 'Order tracking is temporarily unavailable.');
  if (mode !== 'live') reject(404, unavailable);
  const closed = await getCheckoutPart(env, session, 'closed');
  if (closed?.status !== 'paid') reject(404, unavailable);

  const [quote, link] = await Promise.all(['quote', 'link'].map(part => getCheckoutPart(env, session, part)));
  if (quote?.attempt !== session || quote.location !== env.SQUARE_LOCATION_ID || !squareId.test(link?.orderId || ''))
    reject(404, unavailable);
  const {order} = await squareRequest(env, 'orders/' + link.orderId);
  validateOrder(quote, link, order);
  const shipments = (order.fulfillments || []).filter(f => f.type === 'SHIPMENT').map(publicShipment);
  return json({status:'paid', dispatch:shipmentSummary(shipments), shipments});
}

function publicShipment(fulfillment) {
  const details = fulfillment.shipment_details || {};
  const states = {PROPOSED:'awaiting', RESERVED:'processing', PREPARED:'processing', COMPLETED:'shipped', CANCELED:'cancelled', FAILED:'issue'};
  const state = states[fulfillment.state] || 'awaiting';
  const result = {state};
  if (isText(details.carrier, 50)) result.carrier = details.carrier.trim();
  if (isText(details.tracking_number, 100)) result.trackingNumber = details.tracking_number.trim();
  if (isText(details.tracking_url, 2000) && URL.canParse(details.tracking_url)) {
    const url = new URL(details.tracking_url);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname.includes('.'))
      result.trackingUrl = url.href;
  }
  if (!result.trackingUrl && /^(?:australia\s*post|aus\s*post)$/i.test(result.carrier || '') && /^[a-z\d-]{4,100}$/i.test(result.trackingNumber || '')) {
    result.trackingUrl = 'https://auspost.com.au/mypost/track/details/' + encodeURIComponent(result.trackingNumber);
  }
  return result;
}

function shipmentSummary(shipments) {
  if (!shipments.length) return 'awaiting';
  const states = new Set(shipments.map(shipment => shipment.state));
  if (states.size === 1) return states.values().next().value;
  if (states.has('issue')) return 'issue';
  if (states.has('shipped')) return 'partial';
  return states.has('processing') ? 'processing' : 'awaiting';
}
