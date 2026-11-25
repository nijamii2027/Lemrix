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
  __proto__: null,
  'recently-added': { title: 'Recently added', intro: 'The latest additions to the shop.' },
  'pre-orders': { title: 'Pre-orders', intro: 'Reserve upcoming releases. Each open pre-order shows its expected dispatch date.' }
};
const dollars = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'code' });
const price = cents => Number.isSafeInteger(cents) && cents > 0 ? dollars.format(cents / 100) : 'Price unavailable';
const copyName = index => 'Copy ' + String.fromCharCode(65 + index);
const copySelection = new Map();
let inspectionFace = 'front';
function listingPrice(item) {
  if (!item.copies) return price(item.cents);
  const chosen = copySelection.get(item.id);
  const copy = item.copies[chosen];
  if (copy && (copy.canBuy || !item.canBuy)) return price(copy.cents);
  const lowest=window.LemrixCollection.amount(item);
  return lowest > 0 ? 'From ' + price(lowest) : price(lowest);
}
function stockLabel(item) {
  if (item.collection === 'pre-orders') return cart.preorderStatus(item);
  if (item.reserved) return 'Temporarily reserved';
  if (Number.isInteger(item.quantity)) {
    const quantity=window.LemrixCollection.stockCount(item);
    if (quantity>0) return quantity+' in stock';
    return item.copies?.some(copy => copy.reserved) ? 'Temporarily reserved' : 'Sold out';
  }
  return item.checkoutMode === 'test' ? 'Test listing' : 'Preview only';
}
function itemFormat(item) {
  return [item.format, stockLabel(item)].filter(Boolean).join(' · ');
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
  const known = ['Packs', 'Singles', 'Accessories'].includes(filter) || products.some(item => item.category === filter);
  const category = known ? filter : 'All items';
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

function createImage(product, loading = 'eager') {
  const image = new Image();
  image.decoding = "async";
  image.loading = loading;
  image.src = imagePath(product);
  image.alt = '';
  image.draggable = false;
  return image;
}

const slots = new Map();
function rebuildGallery() {
  gallery.replaceChildren();
  slots.clear();
}

function gallerySlot(item, index) {
  if (slots.has(item.id)) return slots.get(item.id);
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
    if (window.shopEditor?.active) {
      if(selectedId !== item.id)selectProduct(item);
      window.shopEditor.openPhotos(item);
      return;
    }
    if (selectedId === item.id) location.hash = detailHash(item);
    else selectProduct(item);
  });
  gallery.append(slot);
  slots.set(item.id,slot);
  return slot;
}

function selectProduct(item, list = filteredProducts()) {
  selectedId = item.id;
  if (history.state?.lemrixShown !== item.id) {
    try { history.replaceState({ ...history.state, lemrixShown: item.id }, ''); } catch {}
  }
  const indices = new Map(list.map((p,i)=>[p.id,i]));
  const activeIndex = indices.get(item.id);
  // Only the current product and its immediate neighbours are visible.
  // Keep previously visited slots for the transition as they leave the stage.
  for (const offset of [0, -1, 1]) {
    const index = (activeIndex + offset + list.length) % list.length;
    gallerySlot(list[index], index);
  }
  for (const [id,slot] of slots) {
    const index = indices.get(id) ?? -1;
    slot.hidden = index < 0;
    if (index < 0) continue;
    const product = list[index];
    let distance = index - activeIndex;
    if (distance > list.length / 2) distance -= list.length;
    if (distance < -list.length / 2) distance += list.length;
    const place = Math.max(-2, Math.min(2, distance));
    slot.dataset.pos = String(place);
    slot.inert = Math.abs(place) > 1;
    slot.tabIndex = place === 0 ? 0 : -1;
    slot.setAttribute('aria-label', (window.shopEditor?.active ? 'Edit photos for ' : place === 0 ? 'View ' : 'Show ') + product.name);
  }
  byId('featured-title').textContent = item.name;
  byId('featured-format').textContent = itemFormat(item);
  byId('featured-price').textContent = listingPrice(item);
  byId('featured-detail').href = detailHash(item);
  byId('position').textContent = String(activeIndex + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');
  for (const id of ['prev', 'next']) byId(id).disabled = list.length < 2;
  window.shopEditor?.renderShowroom?.(item);
}

function step(direction) {
  const list = filteredProducts();
  if (list.length < 2) return;
  const index = list.indexOf(getSelected(list));
  selectProduct(list[(index + direction + list.length) % list.length], list);
}

function tileFor(item, index) {
  const link = document.createElement('a');
  link.href = detailHash(item);
  link.className = 'tile';
  const art = document.createElement('div');
  art.className = 'tile-art';
  art.append(createImage(item, index === 0 ? 'eager' : 'lazy'));
  const grade=window.LemrixCollection.badge(item);
  if(grade){const badge=document.createElement('span');badge.className='grade-badge';badge.textContent=grade;art.append(badge);}
  const title = document.createElement('h2');
  title.className = 'tile-name';
  title.textContent = item.name;
  const format = document.createElement('p');
  format.className = 'tile-type';
  const cardInfo = [item.card?.set,item.card?.cardNumber,item.card?.language].filter(Boolean);
  format.textContent = cardInfo.length ? [...cardInfo,stockLabel(item)].join(' · ') : itemFormat(item);
  const amount = document.createElement('p');
  amount.className = 'tile-price';
  amount.textContent = listingPrice(item);
  link.append(art, title, format, amount);
  return window.shopEditor?.decorateTile?.(item,link) || link;
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

const coreCategories = new Set(['Singles','Packs','Accessories','All items']);
let categoryMenuKey;
function syncCategoryMenu() {
  const menu = byId('categories');
  const names = [...new Set(products.map(item => item.category).filter(name => name && !coreCategories.has(name)))].sort((a,b) => a.localeCompare(b));
  const key = JSON.stringify(names);
  if (key === categoryMenuKey) return;
  categoryMenuKey = key;
  menu.querySelectorAll('[data-custom-category]').forEach(node => node.remove());
  if (names.length > 3) {
    const select = document.createElement('select');
    select.dataset.customCategory = '';
    select.setAttribute('aria-label','More product categories');
    select.add(new Option('More categories', ''));
    names.forEach(name => select.add(new Option(name, name)));
    select.onchange = () => { if (select.value) setBrowseRoute(browseSettings().mode, select.value); };
    menu.append(select);
    return;
  }
  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.customCategory = ''; button.dataset.category = name;
    button.textContent = name; menu.append(button);
  }
}
function renderBrowse() {
  syncCategoryMenu();
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
  const moreCategories = byId('categories').querySelector('select');
  if (moreCategories) moreCategories.value = [...moreCategories.options].some(option => option.value === category) ? category : '';
  for (const button of byId('categories').querySelectorAll('[data-category]')) {
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
    selectProduct(getSelected(list), list);
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
  byId('reset-filter').textContent = window.catalogueLoadFailed ? 'Reload collection' : 'Browse all items';
  if (window.catalogueLoadFailed) {
    byId('empty').firstElementChild.textContent = 'The collection could not load. You can try again.';
    return;
  }
  byId('empty').firstElementChild.textContent = window.LemrixCollection.selectedSet()?'There are no matching Lemrix listings for this set yet.':'There are no matching items in this collection.';
}

function updateCartState() {
  cart.refresh();
  if (!detailItem) return;
  const copy=detailItem.copies ? copySelection.get(detailItem.id) ?? 0 : null;
  const present=cart.contains(detailItem.id,copy);
  const {reason}=cart.availability(detailItem,copy);
  byId('add-to-cart').disabled=!present && !!reason;
  byId('cart-label').textContent=present?'View cart':reason || (detailItem.collection==='pre-orders'?'Add pre-order to cart':'Add to cart');
}
window.addEventListener('lemrix-cart-change',updateCartState);

function paintInspection() {
  const index = copySelection.get(detailItem.id) ?? 0;
  const copy = detailItem.copies[index];
  window.LemrixOffers?.setCopy(detailItem, index);
  renderCheckout(detailItem, copy);
  byId('detail-price').textContent = price(copy.cents);
  byId('copy-heading').textContent = copyName(index) + ' · ' + copy.condition;
  byId('wear-note').textContent = copy[inspectionFace]?.[0] || '';
  const backNote = byId('back-wear-note');
  const hasBackPhoto = copy.photos?.back || (index === 0 && detailItem.backImage);
  backNote.hidden = !!hasBackPhoto || !copy.back?.[0];
  backNote.textContent = backNote.hidden ? '' : 'Back · ' + copy.back[0];
  window.shopEditor?.renderCopy(detailItem,index,inspectionFace);
}

function offerCopies(item) {
  byId('condition-panel').hidden = !item.copies;
  if (!item.copies) { renderCheckout(item, item); window.LemrixOffers?.setCopy(item, null); byId('detail-price').textContent = price(item.cents); return; }
  inspectionFace = 'front';
  const routeCopy = new URLSearchParams(location.hash.split('?')[1] || '').get('copy');
  const remembered = routeCopy !== null ? Number(routeCopy) : history.state?.lemrixCopy ?? copySelection.get(item.id);
  const firstAvailable = item.copies.findIndex(copy => copy.canBuy);
  const initial = Number.isInteger(remembered) && item.copies[remembered] ? remembered : Math.max(0, firstAvailable);
  copySelection.set(item.id, initial);
  const options = item.copies.map((copy, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'shop-copy';
    input.checked = initial === index;
    input.value = String(index);
    const name = document.createElement('strong');
    name.textContent = copyName(index);
    const description = document.createElement('span');
    description.textContent = [copy.condition,cart.availability(item,index).reason].filter(Boolean).join(' · ');
    const amount = document.createElement('small');
    amount.textContent = price(copy.cents);
    label.append(input, name, description, amount);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      copySelection.set(item.id, index);
      try { history.replaceState({ ...history.state, lemrixCopy: index }, '', '#item/'+item.id+'?copy='+index); } catch {}
      inspectionFace = 'front';
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

document.addEventListener('lemrix-photo-face', event => {
  if (!detailItem?.copies) return;
  inspectionFace = event.detail;
  paintInspection();
});
byId('edit-hero-photo').onclick = () => window.shopEditor?.openPhotos(detailItem, copySelection.get(detailItem.id), window.LemrixCollection.photoFace());
const checkoutButton = byId('checkout-button');
const checkoutNotice = byId('checkout-status');
let checkoutChoice = '', openingCheckout = false;
const recoveryKey = 'lemrix-square-checkout-v1';
const openingKey = 'lemrix-square-opening-v1';
const attemptPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const terminalMessages = {
  'paid':'Payment confirmed. Thank you for your order.',
  'test-paid':'Test payment confirmed. No money was charged.',
  'expired':'This checkout has ended.',
  'closed':'Checkout closed.'
};
let ownedAttempt = '', uncertainAttempt = '';
try {
  const saved=sessionStorage.getItem(recoveryKey);
  if (attemptPattern.test(saved)) ownedAttempt=saved;
  uncertainAttempt=sessionStorage.getItem(openingKey) || '';
} catch {}
let recoveryBusy = false, stockRequest, lastStockRead = Date.now();
function checkoutInProgress() { return openingCheckout || !!ownedAttempt; }
function checkoutMessage(message) {
  checkoutNotice.textContent = message;
  checkoutNotice.hidden = !message;
}
function renderCheckout(item, selected) {
  const index = item.copies ? copySelection.get(item.id) ?? 0 : null;
  const choice = JSON.stringify([item.id, index, selected.cents, item.collection === 'pre-orders' ? item.preorderDispatch : null]);
  if (choice !== checkoutChoice) {
    checkoutChoice = choice;
    checkoutMessage('');
  }
  const {reason}=cart.availability(item,index);
  checkoutButton.hidden = !!reason;
  checkoutButton.disabled = checkoutInProgress();
  checkoutButton.textContent = item.checkoutMode === 'test' ? 'Test checkout' : item.collection === 'pre-orders' ? 'Pre-order now' : 'Buy now';
  const note = byId('checkout-note');
  note.hidden = false;
  note.textContent = reason || (item.checkoutMode === 'test' ? 'Square test checkout · No charge' :
    item.collection === 'pre-orders' ? 'Pay now · Expected dispatch ' + cart.dispatchLabel(item) : 'Square checkout · Ships within Australia');
}
async function checkoutPost(path, body) {
  const response = await fetch('/api/checkout' + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const data = await response.json().catch(()=>null);
  if (!response.ok || !data) {
    const error=new Error(data?.error || 'Checkout is unavailable. Please try again.');
    error.status=response.status;
    throw error;
  }
  return data;
}
function markUnconfirmed(attempt) {
  uncertainAttempt=attempt;
  try {
    if (attempt) sessionStorage.setItem(openingKey,attempt);
    else sessionStorage.removeItem(openingKey);
  } catch {}
}
function setOwnedAttempt(attempt) {
  if (uncertainAttempt && uncertainAttempt!==attempt) markUnconfirmed('');
  ownedAttempt=attempt;
  try {
    if (attempt) sessionStorage.setItem(recoveryKey,attempt);
    else sessionStorage.removeItem(recoveryKey);
  } catch {}
  cart.refresh();
  checkoutButton.disabled=checkoutInProgress();
}
function showRecovery(message='', {resume=false, check=false, cancel=false}={}) {
  byId('recovery-track').hidden=true;
  byId('checkout-recovery').hidden=!message;
  byId('recovery-message').textContent=message;
  byId('recovery-resume').hidden=!resume;
  byId('recovery-check').hidden=!check;
  byId('recovery-cancel').hidden=!cancel;
}
function squareAddress(value) {
  if (typeof value!=='string') return null;
  try {
    const url=new URL(value);
    if (!url.username && !url.password && ['https://square.link','https://checkout.square.site','https://sandbox.square.link'].includes(url.origin)) return url.href;
  } catch {}
  return null;
}
async function refreshStock(force=false) {
  if (window.shopEditor?.active || (!force && Date.now()-lastStockRead<15000)) return;
  if (stockRequest) return stockRequest;
  stockRequest=(async()=>{
    const response=await fetch('/shop/catalogue.js',{headers:{Accept:'application/json'},cache:'no-store'});
    if (!response.ok) return;
    const rows=await response.json();
    if (!Array.isArray(rows) || window.shopEditor?.active) return;
    lastStockRead=Date.now();
    const recovering=window.catalogueLoadFailed;
    window.catalogueLoadFailed=false;
    if (!recovering && JSON.stringify(rows)===JSON.stringify(products)) return;
    products.splice(0,products.length,...rows);
    window.shopEditor?.refreshPublished?.(rows);
    rebuildGallery();
    renderRoute();
    if (searchDialog.open) renderSearch();
  })().catch(()=>{}).finally(()=>{stockRequest=null;});
  return stockRequest;
}
function clearReturnQuery() {
  const url=new URL(location.href);
  for (const key of ['checkout','attempt','released']) url.searchParams.delete(key);
  history.replaceState(history.state,'',url);
}
async function checkOwnedCheckout(action='status') {
  const attempt=ownedAttempt;
  if (!attempt || recoveryBusy || openingCheckout) return;
  recoveryBusy=true;
  showRecovery(action==='cancel'?'Closing your Square checkout…':'Checking your Square checkout…');
  try {
    const result=await checkoutPost(action==='cancel'?'/cancel':'/status', action==='cancel'?{attempt}:{session:attempt});
    if (attempt!==ownedAttempt || result.attempt!==attempt) return;
    if (result.status==='pending') {
      const link=squareAddress(result.url);
      if (link && uncertainAttempt===attempt) markUnconfirmed('');
      if (action==='resume' && link) { location.assign(link); return; }
      const waiting = result.preparing ? 'Your Square link is still being prepared. Check again or cancel this checkout.' :
        'Square is checking this payment. Your items stay reserved while payment is in progress.';
      showRecovery(link?'Your Square checkout is still open. Resume it or cancel to release your items.':waiting,
        {resume:!!link,check:!link,cancel:!!link || result.preparing===true});
    } else if (Object.hasOwn(terminalMessages,result.status)) {
      if (result.status==='paid' || result.status==='test-paid') cart.complete(attempt);
      try { sessionStorage.removeItem('cart-order-'+attempt); } catch {}
      setOwnedAttempt('');
      clearReturnQuery();
      showRecovery(action==='cancel' && result.status==='expired'?'Checkout cancelled.':terminalMessages[result.status]);
      if (result.status === 'paid') {
        const trackLink = byId('recovery-track');
        trackLink.href = '#track/' + attempt;
        trackLink.hidden = false;
        // Keep the paid confirmation bookmarkable even when the buyer refreshes.
        history.replaceState(history.state, '', trackLink.href);
        renderRoute();
      }
    } else throw new Error('The checkout status could not be verified.');
  } catch (error) {
    if (attempt!==ownedAttempt) return;
    if (error.status===404 && uncertainAttempt===attempt) {
      showRecovery('Square has not confirmed that a checkout was created. Check again or cancel this attempt before starting over.',{check:true,cancel:true});
    } else if (error.status===404) {
      setOwnedAttempt('');
      clearReturnQuery();
      try { sessionStorage.removeItem('cart-order-'+attempt); } catch {}
      showRecovery('No open checkout was found.');
    } else showRecovery('Could not verify your Square checkout. Check its status or request cancellation.',{check:true,cancel:true});
  } finally {
    recoveryBusy=false;
    await refreshStock(true);
  }
}
byId('recovery-resume').addEventListener('click',()=>checkOwnedCheckout('resume'));
byId('recovery-cancel').addEventListener('click',()=>checkOwnedCheckout('cancel'));
byId('recovery-check').addEventListener('click',()=>checkOwnedCheckout());

async function startCustomerCheckout(selection) {
  if (checkoutInProgress()) return;
  const attempt=crypto.randomUUID(), started=Math.floor(Date.now()/1000);
  const route=location.hash;
  openingCheckout=true;
  showRecovery();
  setOwnedAttempt(attempt);
  markUnconfirmed(attempt);
  if (selection.lines) {
    try { sessionStorage.setItem('cart-order-'+attempt,JSON.stringify(selection.lines)); } catch {}
  }
  try {
    const result=await checkoutPost('',{attempt,started,...selection});
    const url=squareAddress(result.url);
    if (result.attempt!==attempt || !url) throw new Error('Could not verify the Square checkout address.');
    markUnconfirmed('');
    if (location.hash===route) location.assign(url);
    else showRecovery('Your Square checkout is ready.',{resume:true,cancel:true});
  } catch (error) {
    if (error.status>=400 && error.status<500) {
      setOwnedAttempt('');
      try { sessionStorage.removeItem('cart-order-'+attempt); } catch {}
      await refreshStock(true);
    } else {
      showRecovery('Could not verify whether Square opened your checkout. Check its status or cancel this attempt.',{check:true,cancel:true});
    }
    throw error;
  } finally {
    openingCheckout=false;
    checkoutButton.disabled=checkoutInProgress();
    cart.refresh();
  }
}
checkoutButton.addEventListener('click', async () => {
  if (checkoutInProgress() || !detailItem) return;
  const [itemId, copy, expectedCents, dispatch] = JSON.parse(checkoutChoice);
  if (cart.availability(detailItem,copy).reason) return;
  checkoutMessage('Opening secure checkout…');
  try { await startCustomerCheckout({itemId,copy,expectedCents,expectedDispatch:dispatch || undefined}); }
  catch(error) { checkoutMessage(error.message); }
});
function checkoutReturn() {
  const params=new URLSearchParams(location.search);
  const session=params.get('checkout');
  const attempt=session==='cancelled'?params.get('attempt'):session;
  if (attemptPattern.test(attempt)) {
    // Only an explicit cancel action from this tab may close a live payment link.
    setOwnedAttempt(attempt);
  }
  if (ownedAttempt) return checkOwnedCheckout();
}
window.addEventListener('pageshow',event=>{
  if (event.persisted) {
    if (ownedAttempt) checkOwnedCheckout();
    else refreshStock(true);
  }
});
document.addEventListener('visibilitychange',()=>{
  if (document.visibilityState!=='visible') return;
  if (ownedAttempt) checkOwnedCheckout();
  else refreshStock();
});
if (products.some(p => p.checkoutMode === 'live' || p.checkoutMode === 'off')) {
  byId('shop-mode').textContent = 'Lemrix shop · AUD';
  byId('search-prices').textContent = 'Prices in Australian dollars';
}
function renderDetail(item) {
  byId('browse').hidden = true;
  byId('detail').hidden = false;
  byId('edit-hero-photo').hidden = !window.shopEditor?.active;
  const back = history.state?.lemrixCollection || lastBrowseHash || '#showroom';
  byId('back-link').setAttribute('href', back);
  byId('back-link').setAttribute('aria-label', 'Back to collection');
  byId('back-link').title = 'Back to collection';
  byId('detail-return').setAttribute('href', back);
  byId('detail-name').textContent = item.name;
  byId('detail-family').textContent = item.category + ' / AUD';
  byId('detail-format').textContent = itemFormat(item);
  const stock = stockLabel(item);
  const defaultAvailability = item.collection === 'pre-orders'
    ? item.canBuy ? (item.checkoutMode==='test'?'Test checkout. ':'Pay in full at checkout. ') + 'Expected dispatch ' + cart.dispatchLabel(item) + '.' : stock + '.'
    : item.reserved ? 'Temporarily reserved in an open checkout.'
    : item.canBuy ? 'Available to order. Prices are in Australian dollars.'
    : item.checkoutMode === 'off' && item.quantity > 0 ? 'In stock. Online checkout is unavailable.'
    : stock+'.';
  byId('availability').textContent=item.availability && item.canBuy && item.collection !== 'pre-orders' ? item.availability : defaultAvailability;
  offerCopies(item);
  byId('detail-description').textContent = item.description;
  const notes = byId('detail-notes');
  notes.textContent = item.notes || '';
  notes.closest('details').hidden = !window.shopEditor?.active && !notes.textContent.trim();
  window.LemrixCollection.inspect(item,copySelection.get(item.id) ?? 0);
  if(byId('detail').dataset.item!==item.id){
    byId('detail').querySelectorAll('details:not([hidden])').forEach((node, index) => { node.open = index === 0; });
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
  byId('tracking-page').hidden=true;
  byId('cart').hidden=true;
  byId('cart-opener').removeAttribute('aria-current');
  if (hash === '#track' || hash.startsWith('#track/')) {
    byId('browse').hidden=true; byId('detail').hidden=true; byId('tracking-page').hidden=false;
    byId('back-link').href='#catalogue';
    byId('back-link').setAttribute('aria-label','Back to collection');
    byId('back-link').title='Back to collection';
    document.title='Track your order · Lemrix TCG';
    if(event) { window.scrollTo(0,0); byId('tracking-heading').focus({preventScroll:true}); }
    import('./tracking.js').then(module => {
      if (currentHash() === hash) module.showTracking(hash);
    }).catch(() => { byId('tracking-status').textContent='Tracking could not load. Refresh this page to try again.'; });
    return;
  }
  if (hash==='#cart' || new URLSearchParams(hash.slice(1)).get('category')==='Saved') {
    byId('browse').hidden=true; byId('detail').hidden=true;
    byId('back-link').href='#catalogue';
    byId('back-link').setAttribute('aria-label','Back to collection');
    byId('back-link').title='Back to collection';
    cart.open(); cart.refresh();
    if (event) refreshStock();
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
  if (filter) setBrowseRoute(filter.dataset.category === 'recently-added' ? 'catalogue' : browseSettings().mode, filter.dataset.category);
});
byId('show-grid').addEventListener('click', () => setBrowseRoute('catalogue', browseSettings().category));
byId('show-stage').addEventListener('click', () => {
  const { category } = browseSettings();
  setBrowseRoute('showroom', category);
});
byId('reset-filter').addEventListener('click', () => {
  if (window.catalogueLoadFailed) refreshStock(true);
  else setBrowseRoute('catalogue', 'All items');
});
byId('prev').addEventListener('click', () => step(-1));
byId('next').addEventListener('click', () => step(1));
byId('showroom').addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input,textarea,select')) return;
  const arrows = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  if (e.key in arrows) {
    e.preventDefault();
    step(arrows[e.key]);
  } else if (e.key === 'Home' || e.key === 'End') {
    const list = filteredProducts();
    if (list.length) {
      e.preventDefault();
      selectProduct(e.key === 'Home' ? list[0] : list[list.length - 1], list);
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
  if (e.ctrlKey || e.metaKey || e.altKey || searchDialog.open || byId('next').disabled) return;
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
  if (window.shopEditor?.active) { window.shopEditor.openPhotos(detailItem, copySelection.get(detailItem.id), window.LemrixCollection.photoFace()); return; }
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
    link.append(createImage(item, 'lazy'), name, categoryText);
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
