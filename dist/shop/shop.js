const byId = id => document.getElementById(id);
const gallery = byId('gallery');
const searchDialog = byId('search-dialog');
const cart = window.LemrixCart;
let mode = 'showroom';
let category = 'All items';
let selectedId = products.find(item => item.id === history.state?.lemrixShown)?.id || products[0]?.id;
let detailItem = null;
let lastBrowseHash = '';
let pointerStart = null;
let ignoreClickUntil = 0;

const collections = {
  'recently-added': { title: 'Recently added', intro: 'The latest additions to the Lemrix art-card series.' },
  'pre-orders': { title: 'Pre-orders', intro: 'A first look at upcoming designs. Pre-order dates and reservations are still to come.' }
};
const dollars = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'code' });
const price = cents => dollars.format(cents / 100);
const copyName = index => 'Copy ' + String.fromCharCode(65 + index);
const copySelection = new Map();
let inspectionFace = 'front';
function listingPrice(item) {
  if (!item.copies) return price(item.cents);
  const chosen = copySelection.get(item.id);
  if (chosen !== undefined) return price(item.copies[chosen].cents);
  return 'From ' + price(Math.min(...item.copies.map(copy => copy.cents)));
}
function itemFormat(item) {
  return item.format + (Number.isInteger(item.quantity) ? (item.quantity ? ' · ' + item.quantity + ' in stock' : ' · Sold out') : '') + (item.collection === 'pre-orders' ? ' · Pre-order preview' : '');
}
const imagePath = item => item.image || 'art/' + item.id + '.webp';
const detailHash = item => '#item/' + item.id;
const filteredProducts = () => window.LemrixCollection.apply(products.filter(item =>
  category === 'All items' || item.category === category || item.collection === category
));
const getSelected = list => list.find(item => item.id === selectedId) || list[0];
const currentHash = () => window.location.hash;

function browseSettings(hash = currentHash()) {
  const collectionRoute = hash.match(/^#collection\/(recently-added|pre-orders)(?:\?(.*))?$/);
  if (collectionRoute) {
    const settings = new URLSearchParams(collectionRoute[2]);
    return { category: collectionRoute[1], mode: settings.get('view') === 'showroom' ? 'showroom' : 'catalogue' };
  }
  const params = new URLSearchParams(hash.slice(1));
  const filter = params.get('category');
  const category = ['Packs', 'Singles', 'Accessories'].includes(filter) ? filter : 'All items';
  const mode = (params.get('view') === 'catalogue' || hash==='#catalogue') ? 'catalogue' : 'showroom';
  return { mode, category };
}

function setBrowseRoute(view, filter) {
  const params = new URLSearchParams();
  if (view === 'catalogue') params.set('view', 'catalogue');
  if (filter !== 'All items') params.set('category', filter);
  const query = params.toString();
  const hash = collections[filter]
    ? '#collection/' + filter + (view === 'showroom' ? '?view=showroom' : '')
    : query ? '#' + query : '';
  if (currentHash() === hash) return;
  history.pushState({ lemrixShown: selectedId }, '', location.pathname + location.search + hash);
  transitionRoute({ type: 'navigate' });
}

function createImage(product, decorative = true) {
  const image = new Image();
  image.decoding = "async";
  image.src = imagePath(product);
  image.alt = decorative ? '' : product.name + ' — ' + product.format;
  image.draggable = false;
  return image;
}

const slots = new Map();
function rebuildGallery() {
  gallery.replaceChildren();
  slots.clear();
  products.forEach((item,index) => {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = 'slot';
  slot.dataset.pos = '2';
  slot.dataset.item = item.id;
  slot.style.setProperty('--delay', (-index * .69) + 's');
  if (item.category === 'Packs' && !item.image) {
    const pair = document.createElement('span');
    pair.className = 'object-pair';
    pair.append(createImage(item), createImage(item));
    slot.append(pair);
  } else {
    slot.append(createImage(item));
  }
  slot.addEventListener('click', () => {
    if (performance.now() < ignoreClickUntil) return;
    if (selectedId === item.id) location.hash = detailHash(item);
    else selectProduct(item);
  });
  gallery.append(slot);
  slots.set(item.id,slot);
  });
}
rebuildGallery();

function selectProduct(item) {
  selectedId = item.id;
  if (history.state?.lemrixShown !== item.id) {
    try { history.replaceState({ ...history.state, lemrixShown: item.id }, ''); } catch {}
  }
  const list = filteredProducts();
  const indices = new Map(list.map((p,i)=>[p.id,i]));
  const activeIndex = indices.get(item.id);
  for (const product of products) {
    const slot = slots.get(product.id);
    const index = indices.get(product.id) ?? -1;
    slot.hidden = index < 0;
    if (index < 0) continue;
    let distance = index - activeIndex;
    if (distance > list.length / 2) distance -= list.length;
    if (distance < -list.length / 2) distance += list.length;
    const place = Math.max(-2, Math.min(2, distance));
    slot.dataset.pos = String(place);
    slot.inert = Math.abs(place) > 1;
    slot.tabIndex = place === 0 ? 0 : -1;
    slot.setAttribute('aria-label', (place === 0 ? 'View ' : 'Show ') + product.name);
  }
  byId('featured-title').textContent = item.name;
  byId('featured-format').textContent = itemFormat(item);
  byId('featured-price').textContent = listingPrice(item);
  byId('featured-detail').href = detailHash(item);
  byId('position').textContent = String(activeIndex + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');
  for (const id of ['prev', 'next']) byId(id).disabled = list.length < 2;
}

function step(direction) {
  const list = filteredProducts();
  if (list.length < 2) return;
  const index = list.indexOf(getSelected(list));
  selectProduct(list[(index + direction + list.length) % list.length]);
}

function tileFor(item) {
  const link = document.createElement('a');
  link.href = detailHash(item);
  link.className = 'tile';
  const art = document.createElement('div');
  art.className = 'tile-art';
  art.append(createImage(item));
  const grade=window.LemrixCollection.badge(item);
  if(grade){const badge=document.createElement('span');badge.className='grade-badge';badge.textContent=grade;art.append(badge);}
  const title = document.createElement('h2');
  title.className = 'tile-name';
  title.textContent = item.name;
  const format = document.createElement('p');
  format.className = 'tile-type';
  format.textContent = [item.card?.set,item.card?.cardNumber,item.card?.language].filter(Boolean).join(' · ') || itemFormat(item);
  const amount = document.createElement('p');
  amount.className = 'tile-price';
  amount.textContent = listingPrice(item);
  link.append(art, title, format, amount);
  return link;
}

function addProductTile() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'catalogue-add';
  const plus = document.createElement('span');
  plus.className = 'catalogue-add-mark';
  plus.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'catalogue-add-label';
  label.textContent = 'add more';
  button.append(plus, label);
  button.addEventListener('click', () => window.shopEditor.addProduct());
  return button;
}

function renderBrowse() {
  window.LemrixCollection.sync();
  window.LemrixOffers?.setCopy(null);
  const list = filteredProducts();
  const isGrid = mode === 'catalogue' || !list.length;
  byId('browse').hidden = false;
  byId('detail').hidden = true;
  byId('showroom').hidden = isGrid;
  byId('catalogue').hidden = !isGrid;
  byId('show-grid').setAttribute('aria-pressed', String(isGrid));
  byId('show-stage').setAttribute('aria-pressed', String(!isGrid));
  for (const button of byId('categories').children) {
    button.setAttribute('aria-pressed', String(button.dataset.category === category));
  }
  for (const link of document.querySelectorAll('[data-collection]')) {
    if (link.dataset.collection === category) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  byId('back-link').href = '../';
  byId('back-link').setAttribute('aria-label', 'Back to Lemrix home');
  byId('back-link').title = 'Back to Lemrix home';
  document.title = (collections[category]?.title || 'The shop') + ' · Lemrix TCG';
  if (!isGrid) {
    selectProduct(getSelected(list));
    return;
  }
  byId('listing-title').textContent = window.LemrixCollection.selectedSet() || collections[category]?.title || category;
  byId('collection-intro').hidden = !collections[category];
  byId('collection-intro').textContent = collections[category]?.intro || '';
  byId('result-count').textContent = list.length + (list.length === 1 ? ' item' : ' items');
  const tiles = list.map(tileFor);
  if (window.shopEditor?.active) tiles.push(addProductTile());
  byId('tiles').replaceChildren(...tiles);
  byId('empty').hidden = !!list.length;
  byId('empty').firstElementChild.textContent = window.LemrixCollection.selectedSet()?'There are no matching Lemrix listings for this set yet.':'There are no matching items in this collection.';
}

function updateCartState() {
  cart.refresh();
  if (!detailItem) return;
  const copy=detailItem.copies ? copySelection.get(detailItem.id) ?? 0 : null;
  const present=cart.contains(detailItem.id,copy);
  const selected=copy===null?detailItem:detailItem.copies[copy];
  const unavailable=!present && detailItem.checkoutMode==='live' && Number.isInteger(detailItem.quantity) && !selected.canBuy;
  byId('add-to-cart').disabled=unavailable;
  byId('cart-label').textContent=present?'View cart':unavailable?'Unavailable':'Add to cart';
}
window.addEventListener('lemrix-cart-change',updateCartState);

function paintInspection() {
  const index = copySelection.get(detailItem.id) ?? 0;
  const copy = detailItem.copies[index];
  window.LemrixOffers?.setCopy(detailItem, index);
  renderCheckout(detailItem, copy);
  const [note, x, y] = copy[inspectionFace];
  byId('detail-price').textContent = price(copy.cents);
  byId('copy-heading').textContent = copyName(index) + ' · ' + copy.condition;
  byId('wear-note').textContent = note;
  const point = byId('wear-point');
  point.hidden = x === undefined;
  if (x !== undefined) {
    point.style.left = x + '%';
    point.style.top = y + '%';
  }
  byId('wear-map').dataset.face = inspectionFace;
  for (const face of ['front', 'back']) byId('face-' + face).setAttribute('aria-pressed', String(face === inspectionFace));
  window.shopEditor?.renderCopy(detailItem,index,inspectionFace);
}

function offerCopies(item) {
  byId('condition-panel').hidden = !item.copies;
  if (!item.copies) { renderCheckout(item, item); window.LemrixOffers?.setCopy(null); byId('detail-price').textContent = price(item.cents); return; }
  inspectionFace = 'front';
  const routeCopy = new URLSearchParams(location.hash.split('?')[1] || '').get('copy');
  const remembered = history.state?.lemrixCopy ?? (routeCopy === null ? undefined : Number(routeCopy));
  const initial = Number.isInteger(remembered) && item.copies[remembered] ? remembered : copySelection.get(item.id) ?? 0;
  copySelection.set(item.id, initial);
  const options = item.copies.map((copy, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'sample-copy';
    input.checked = initial === index;
    input.value = String(index);
    const name = document.createElement('strong');
    name.textContent = copyName(index);
    const description = document.createElement('span');
    description.textContent = copy.condition;
    const amount = document.createElement('small');
    amount.textContent = price(copy.cents);
    label.append(input, name, description, amount);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      copySelection.set(item.id, index);
      try { history.replaceState({ ...history.state, lemrixCopy: index }, ''); } catch {}
      paintInspection();
      window.LemrixCollection.inspect(item,index);
      window.shopEditor?.renderFacts(item);
      updateCartState();
    });
    return label;
  });
  byId('copy-options').replaceChildren(...options);
  paintInspection();
}

for (const face of ['front', 'back']) {
  byId('face-' + face).addEventListener('click', () => {
    inspectionFace = face;
    paintInspection();
  });
}
const checkoutButton = byId('checkout-button');
const checkoutNotice = byId('checkout-status');
let checkoutChoice = '', checkoutAttempt, checkoutBusy = false;
function checkoutMessage(message) {
  checkoutNotice.textContent = message;
  checkoutNotice.hidden = !message;
}
function renderCheckout(item, selected) {
  const index = item.copies ? copySelection.get(item.id) ?? 0 : null;
  const choice = JSON.stringify([item.id, index, selected.cents]);
  if (choice !== checkoutChoice) {
    checkoutChoice = choice;
    checkoutAttempt = null;
    checkoutMessage('');
  }
  checkoutButton.hidden = !selected.canBuy;
  checkoutButton.disabled = checkoutBusy;
  checkoutButton.textContent = item.checkoutMode === 'test' ? 'Test checkout' : 'Buy now';
  const setupPending = item.checkoutMode === 'off' && item.collection !== 'pre-orders';
  const note = byId('checkout-note');
  note.hidden = !selected.canBuy && !setupPending;
  note.textContent = setupPending ? 'Online checkout is being set up.'
    : item.checkoutMode === 'test' ? 'Square test checkout · No charge' : 'Square checkout · Ships within Australia';
}
async function checkoutPost(path, body) {
  const response = await fetch('/api/checkout' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const data = await response.json().catch(()=>null);
  if (!response.ok || !data) throw new Error(data?.error || 'Checkout is unavailable. Please try again.');
  return data;
}
checkoutButton.addEventListener('click', async () => {
  if (checkoutBusy || !detailItem) return;
  const [itemId, copy, expectedCents] = JSON.parse(checkoutChoice);
  if (!checkoutAttempt || Date.now()/1000 - checkoutAttempt.started > 540)
    checkoutAttempt = {attempt:crypto.randomUUID(), started:Math.floor(Date.now()/1000)};
  const choiceAtClick = checkoutChoice;
  checkoutBusy = true;
  checkoutButton.disabled = true;
  checkoutMessage('Opening secure checkout…');
  try {
    const result = await checkoutPost('', {itemId, copy, expectedCents, ...checkoutAttempt});
    if (choiceAtClick === checkoutChoice && detailItem?.id === itemId) window.location.assign(result.url);
  } catch (error) {
    checkoutMessage(error.message);
  } finally {
    checkoutBusy = false;
    checkoutButton.disabled = false;
  }
});
async function checkoutReturn() {
  const url = new URL(location.href);
  const session = url.searchParams.get('checkout');
  const fromCart = location.hash==='#cart';
  if (!session || (!detailItem && !fromCart)) return;
  const feedback = fromCart ? cart.message : checkoutMessage;
  if (session === 'cancelled') {
    try {
      const result = await checkoutPost('/cancel', {attempt:url.searchParams.get('attempt'), itemId:detailItem?.id});
      feedback(result.status === 'paid' ? 'Payment confirmed. Thank you for your order.' : 'Checkout closed.');
      if (result.status === 'expired' && !url.searchParams.has('released')) {
        url.searchParams.set('released','1');
        location.replace(url);
        return;
      }
    } catch {
      feedback('Checkout closed. Refresh to check the reservation.');
      return;
    }

  } else {
    feedback('Confirming your payment…');
    try {
      const {status,attempt} = await checkoutPost('/status', {session});
      const messages = {'test-paid':'Test payment confirmed. No money was charged.', paid:'Payment confirmed. Thank you for your order.', expired:'This checkout has expired.', pending:'Payment is still processing. Refresh to check again.'};
      if(fromCart && (status==='paid' || status==='test-paid')) cart.complete(attempt);
      feedback(messages[status] || 'Payment status unavailable.');
      if (status === 'pending') return;
    } catch {
      feedback('Payment confirmation is unavailable. Refresh to check again before placing another order.');
      return;
    }
  }
  for (const key of ['checkout','attempt','released']) url.searchParams.delete(key);
  history.replaceState(history.state, '', url);
}
if (products.some(p => p.checkoutMode === 'live' || p.checkoutMode === 'off')) {
  byId('shop-mode').textContent = 'Lemrix shop · AUD';
  byId('search-prices').textContent = 'Prices in Australian dollars';
}
function renderDetail(item) {
  byId('browse').hidden = true;
  byId('detail').hidden = false;
  const back = history.state?.lemrixCollection || lastBrowseHash || '#showroom';
  byId('back-link').setAttribute('href', back);
  byId('back-link').setAttribute('aria-label', 'Back to collection');
  byId('back-link').title = 'Back to collection';
  byId('detail-return').setAttribute('href', back);
  byId('detail-name').textContent = item.name;
  byId('detail-family').textContent = item.category + (item.checkoutMode !== 'test' && item.quantity != null ? ' / AUD' : ' / Sample AUD price');
  byId('detail-format').textContent = itemFormat(item);
  byId('availability').textContent = item.collection === 'pre-orders'
    ? 'This is a pre-order concept with an illustrative price. Release dates and reservations will be announced when confirmed.'
    : 'This is a demo catalogue with sample AUD prices. Stock and ordering will appear when the shop opens.';
  if (item.collection !== 'pre-orders' && item.checkoutMode === 'live' && item.quantity != null) byId('availability').textContent = item.canBuy ? 'Available to order. Prices are in Australian dollars.' : 'Currently unavailable.';
  if (item.collection !== 'pre-orders' && item.checkoutMode === 'off' && item.quantity != null) {
    byId('availability').textContent = item.quantity > 0 ? 'In stock.' : 'Currently unavailable.';
  }
  const defaultAvailability=byId('availability').textContent;
  if(item.availability) byId('availability').textContent=item.availability;
  if (item.reserved) byId('availability').textContent = 'Reserved in another checkout. Refresh later to check availability.';
  offerCopies(item);
  byId('detail-description').textContent = item.description;
  byId('detail-notes').textContent = item.notes;
  window.LemrixCollection.inspect(item,copySelection.get(item.id) ?? 0);
  if(byId('detail').dataset.item!==item.id){
    byId('detail').querySelectorAll('details').forEach((node, index) => { node.open = index === 0; });
    byId('detail').dataset.item=item.id;
  }
  updateCartState();
  window.shopEditor?.renderDetail(item,defaultAvailability);
  document.title = item.name + ' · Lemrix TCG shop';
}

function renderRoute(event) {
  const hash = currentHash();
  const match = hash.match(/^#item\/([\w-]+)(?:\?copy=\d+)?$/);
  const wasDetail = !!detailItem;
  detailItem = match ? products.find(item => item.id === match[1]) : null;
  if (searchDialog.open) dismissSearch();
  byId('cart').hidden=true;
  byId('cart-opener').removeAttribute('aria-current');
  if (hash==='#cart' || new URLSearchParams(hash.slice(1)).get('category')==='Saved') {
    byId('browse').hidden=true; byId('detail').hidden=true;
    byId('back-link').href='#catalogue';
    byId('back-link').setAttribute('aria-label','Back to collection');
    byId('back-link').title='Back to collection';
    cart.open(); cart.refresh();
    if(event) { window.scrollTo(0,0); byId('cart-title').focus({preventScroll:true}); }
    return;
  }
  if (detailItem) {
    selectedId = detailItem.id;
    if (!history.state?.lemrixCollection) {
      const previous = event?.oldURL ? new URL(event.oldURL) : null;
      const cameFromList = previous && previous.origin === location.origin &&
        previous.pathname === location.pathname && !previous.hash.startsWith('#item/');
      const back = (cameFromList ? previous.hash : lastBrowseHash) || '#showroom';
      try { history.replaceState({ ...history.state, lemrixCollection: back, lemrixListPrecedes: !!cameFromList }, ''); } catch {}
    }
    renderDetail(detailItem);
  } else {
    const previousItem = products.find(item => item.id === history.state?.lemrixShown);
    if (previousItem) selectedId = previousItem.id;
    lastBrowseHash = hash;
    ({ mode, category } = browseSettings(hash));
    renderBrowse();
    updateCartState();
  }
  if (event || wasDetail !== !!detailItem) {
    window.scrollTo(0, 0);
    if (wasDetail !== !!detailItem) {
      const target = detailItem ? byId('detail-name') : byId('main');
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }
}

for (const id of ['back-link', 'detail-return']) {
  byId(id).addEventListener('click', event => {
    if (!detailItem || !history.state?.lemrixListPrecedes || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.back();
  });
}
byId('categories').addEventListener('click', e => {
  const filter = e.target.closest('[data-category]');
  if (filter) setBrowseRoute(browseSettings().mode, filter.dataset.category);
});
byId('show-grid').addEventListener('click', () => setBrowseRoute('catalogue', browseSettings().category));
byId('show-stage').addEventListener('click', () => {
  const { category } = browseSettings();
  setBrowseRoute('showroom', category);
});
byId('reset-filter').addEventListener('click', () => setBrowseRoute('catalogue', 'All items'));
byId('prev').addEventListener('click', () => step(-1));
byId('next').addEventListener('click', () => step(1));
byId('showroom').addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const arrows = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  if (e.key in arrows) {
    e.preventDefault();
    step(arrows[e.key]);
  } else if (e.key === 'Home' || e.key === 'End') {
    const list = filteredProducts();
    if (list.length) {
      e.preventDefault();
      selectProduct(e.key === 'Home' ? list[0] : list[list.length - 1]);
    }
  } else return;
  if (e.target?.closest('.slot')) slots.get(selectedId)?.focus({ preventScroll: true });
});
gallery.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button !== 0) return;
  pointerStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
gallery.addEventListener('pointermove', e => {
  if (!pointerStart || pointerStart.id !== e.pointerId) return;
  if (Math.abs(e.clientX - pointerStart.x) > 12) gallery.classList.add('dragging');
});
function finishDrag(e) {
  if (!pointerStart || e.pointerId !== pointerStart.id) return;
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  pointerStart = null;
  gallery.classList.remove('dragging');
  if (e.type === 'pointercancel' || Math.abs(dx) < 35 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
  ignoreClickUntil = performance.now() + 320;
  step(dx > 0 ? -1 : 1);
}
window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);
// Trackpad momentum can continue long after the finger leaves the surface. Count one
// item per gesture, while discrete mouse-wheel detents can repeat at a readable cadence.
let wheelLast = -Infinity, wheelMove = -Infinity, wheelTotal = 0;
let wheelSign = 0, wheelLatched = false, wheelMagnitude = 0;
byId('showroom').addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || searchDialog.open || filteredProducts().length < 2) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const dx = e.deltaX * unit, dy = e.deltaY * unit;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  if (!horizontal && document.documentElement.scrollHeight > innerHeight + 8 && !gallery.contains(e.target)) return;

  const delta = horizontal ? dx : dy;
  const size = Math.abs(delta);
  if (size < .35) return;
  if (e.cancelable) e.preventDefault();
  const now = performance.now();
  const gap = now - wheelLast;
  const sign = Math.sign(delta);
  const discrete = e.deltaMode !== 0 || (Number.isInteger(delta) && size >= 48 && gap >= 45);
  const renewed = size > 8 && size > wheelMagnitude * 2.7 && now - wheelMove > 180;
  if (gap > 135 || sign !== wheelSign || renewed || (discrete && now - wheelMove >= 150)) {
    wheelTotal = 0;
    wheelLatched = false;
  }
  wheelLast = now;
  wheelSign = sign;
  wheelMagnitude = size;
  if (wheelLatched) return;
  wheelTotal += size;
  if (wheelTotal < (e.deltaMode === 1 ? 28 : 42)) return;
  wheelMove = now;
  wheelLatched = true;
  step(sign);
}, { passive: false });

byId('add-to-cart').addEventListener('click', () => {
  if (!detailItem) return;
  cart.add(detailItem.id,detailItem.copies ? copySelection.get(detailItem.id) ?? 0 : null);
  updateCartState();
});
byId('closeup').addEventListener('click', e => {
  const button = e.currentTarget;
  const zoomed = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(zoomed));
  button.setAttribute('aria-label', zoomed ? 'Zoom out' : 'Zoom artwork');
});
function renderSearch() {
  const query = byId('search-field').value.trim().toLowerCase();
  const found = products.filter(item => [item.name, item.format, item.category, collections[item.collection]?.title, ...Object.values(item.card||{})].join(' ').toLowerCase().includes(query));
  const links = found.map(item => {
    const link = document.createElement('a');
    link.href = detailHash(item);
    link.addEventListener('click', async event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      await dismissSearch();
      location.hash=detailHash(item);
    });
    const name = document.createElement('span');
    name.textContent = item.name;
    const categoryText = document.createElement('span');
    categoryText.textContent = listingPrice(item);
    link.append(createImage(item), name, categoryText);
    return link;
  });
  if (!links.length) {
    const message = document.createElement('p');
    message.textContent = 'No matches. Try another name or category.';
    links.push(message);
  }
  byId('search-results').replaceChildren(...links);
}
let searchClosing;
function dismissSearch() {
  if (!searchDialog.open) return Promise.resolve();
  if (searchClosing) return searchClosing;
  searchDialog.dataset.closing='true';
  const exit=searchDialog.getAnimations?.().find(a=>a.animationName==='search-out');
  // Some mobile browsers suspend the animation clock when a keyboard or tab closes.
  // The native dialog must always release its focus trap.
  const settled=exit ? Promise.race([exit.finished.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,260))]) : Promise.resolve();
  searchClosing=settled.then(()=>{
    searchDialog.close();
    delete searchDialog.dataset.closing;
    searchClosing=null;
  });
  return searchClosing;
}
searchDialog.querySelector('form').addEventListener('submit',e=>{e.preventDefault();dismissSearch();});
searchDialog.addEventListener('cancel',e=>{e.preventDefault();dismissSearch();});
byId('search-opener').addEventListener('click', () => {
  byId('search-field').value = '';
  renderSearch();
  searchDialog.showModal();
  byId('search-field').focus();
});
byId('search-field').addEventListener('input', renderSearch);
searchDialog.addEventListener('click', e => {
  if (e.target !== searchDialog) return;
  const box = searchDialog.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dismissSearch();
});
function artworkFor(id) {
  if (detailItem) return byId('detail-art');
  if (!byId('catalogue').hidden) {
    return byId('tiles').querySelector('a[href="#item/' + id + '"] img');
  }
  const slot = slots.get(id);
  return slot && slot.dataset.pos === '0' ? slot.firstElementChild : null;
}

let activeTransition;
let navigationVersion = 0;
let transitionArtwork = null;
function transitionRoute(event) {
  const hash = currentHash();
  if (event.newURL && new URL(event.newURL).hash !== hash) return;
  const version = ++navigationVersion;
  activeTransition?.skipTransition();
  if (transitionArtwork) transitionArtwork.style.viewTransitionName = '';
  transitionArtwork = null;
  const changesItem = hash.startsWith('#item/') || !!detailItem;
  if (!changesItem || !document.startViewTransition || (window.LemrixMotion || window.matchMedia('(prefers-reduced-motion: reduce)')).matches) {
    renderRoute(event);
    return;
  }
  const match = hash.match(/^#item\/([\w-]+)(?:\?copy=\d+)?$/);
  const productId = match ? match[1] : (detailItem?.id || selectedId);
  const oldArtwork = artworkFor(productId);
  transitionArtwork = oldArtwork;
  if (oldArtwork) oldArtwork.style.viewTransitionName = 'collection-artwork';
  const transition = document.startViewTransition(() => {
    if (version !== navigationVersion || hash !== currentHash()) return;
    if (oldArtwork) oldArtwork.style.viewTransitionName = '';
    renderRoute(event);
    transitionArtwork = artworkFor(productId);
    if (transitionArtwork) transitionArtwork.style.viewTransitionName = 'collection-artwork';
  });
  activeTransition = transition;
  transition.finished.finally(() => {
    if (activeTransition !== transition) return;
    if (transitionArtwork) transitionArtwork.style.viewTransitionName = '';
    transitionArtwork = null;
    activeTransition = null;
  });
}
window.addEventListener('hashchange', transitionRoute);
renderRoute();

checkoutReturn();
