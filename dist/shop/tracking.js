const byId = id => document.getElementById(id);
const lookup = byId('tracking-lookup');
const reference = byId('tracking-reference');
const status = byId('tracking-status');
const list = byId('tracking-shipments');
const actions = byId('tracking-actions');
const refresh = byId('tracking-refresh');
const share = byId('tracking-copy');
const copyStatus = byId('tracking-copy-status');
const manual = byId('tracking-manual-copy');
const validReference = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const labels = {
  awaiting:'Awaiting dispatch', processing:'Preparing for dispatch', partial:'Partially shipped',
  shipped:'Shipped', delivered:'Delivered', cancelled:'Shipment cancelled', issue:'Shipping issue'
};
let version = 0;
function parseReference(raw) {
  const value = raw.trim();
  if (validReference.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value, location.href);
    const candidate = url.hash.slice('#track/'.length);
    return url.hash.startsWith('#track/') && validReference.test(candidate) ? candidate.toLowerCase() : '';
  } catch { return ''; }
}
function carrierUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
  return '';
}
function shipmentRow(shipment, index, multiple) {
  const row = document.createElement('li');
  const title = document.createElement('strong');
  title.textContent = [multiple ? 'Parcel ' + (index+1) : '', shipment.carrier, labels[shipment.state] || 'Preparing for dispatch'].filter(Boolean).join(' · ');
  row.append(title);
  if (shipment.trackingNumber) {
    const number = document.createElement('span');
    number.textContent = 'Tracking number ' + shipment.trackingNumber;
    row.append(number);
  }
  const href = carrierUrl(shipment.trackingUrl);
  if (href) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = shipment.carrier ? 'Track with ' + shipment.carrier : 'Track with carrier';
    row.append(link);
  }
  return row;
}
export async function showTracking(hash) {
  const request = ++version;
  const id = validReference.test(hash.slice(7)) ? hash.slice(7).toLowerCase() : '';
  reference.setCustomValidity('');
  copyStatus.textContent = ''; manual.hidden = true; manual.value = '';
  list.hidden = true; list.replaceChildren(); actions.hidden = true; share.hidden = true;
  lookup.hidden = Boolean(id);
  reference.value = '';
  if (!id) {
    status.textContent = hash === '#track' ? '' : 'Check the order reference and try again.';
    return;
  }
  status.textContent = 'Checking dispatch status…';
  try {
    const response = await fetch('/api/checkout/tracking', {
      method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session:id})
    });
    if (request !== version || hash !== location.hash) return;
    if (!response.ok) {
      if (response.status === 404) {
        status.textContent='Tracking is available after payment. Check the reference on your Lemrix confirmation.';
        lookup.hidden = false;
      } else {
        status.textContent = 'Dispatch status is temporarily unavailable. Try again shortly.';
        actions.hidden = false;
      }
      return;
    }
    const data = await response.json();
    if (request !== version || hash !== location.hash) return;
    if (data.status !== 'paid') throw new Error('Order unavailable');
    const shipments = Array.isArray(data.shipments) ? data.shipments : [];
    const stateLabel = labels[data.dispatch] || 'Preparing for dispatch';
    status.textContent = !shipments.length && ['awaiting','processing'].includes(data.dispatch)
      ? stateLabel + '. Your tracking details will appear here when available.'
      : stateLabel + '.';
    if (shipments.length) {
      list.replaceChildren(...shipments.map((shipment,index) => shipmentRow(shipment,index,shipments.length>1)));
      list.hidden = false;
    }
    actions.hidden = false; share.hidden = false;
  } catch {
    if (request === version && hash === location.hash) {
      status.textContent = 'Dispatch status is temporarily unavailable. Try again shortly.';
      actions.hidden = false;
    }
  }
}
lookup.onsubmit = event => {
  event.preventDefault();
  const id = parseReference(reference.value);
  if (!id) { reference.setCustomValidity('Enter your full Lemrix order reference or tracking link.'); reference.reportValidity(); return; }
  const hash = '#track/' + id;
  if (location.hash === hash) showTracking(hash);
  else location.hash = hash;
};
reference.oninput = () => reference.setCustomValidity('');
refresh.onclick = () => showTracking(location.hash);
share.onclick = async () => {
  const url = new URL(location.pathname, location.origin);
  url.hash = location.hash;
  try {
    await navigator.clipboard.writeText(url.href);
    copyStatus.textContent = 'Order link copied.';
  } catch {
    manual.hidden = false; manual.value = url.href; manual.focus(); manual.select();
    copyStatus.textContent = 'Copy this order link to check your shipment later.';
  }
};
