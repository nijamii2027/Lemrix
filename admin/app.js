const el = id => document.getElementById(id);
const form = el('editor');
const field = name => form.elements.namedItem(name);
const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
let rows = [], current, previewUrl, uploadedFile, uploadedImage;
let photoVersion = 0, rotation = 0, preparedPhoto;
let signedIn = false, busy = false, dirty = false;

function page(name) {
  for (const id of ['login', 'inventory', 'editing']) el(id).hidden = id !== name;
  el('logout').hidden = !signedIn;
}
function notice(message) {
  el('status').textContent = message;
}
async function api(path, options = {}) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin', ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      signedIn = false;
      dirty = false;
      page('login');
    }
    const error = new Error(result.error || 'Could not complete the request. Try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const imageOf = product => product.image || '/shop/art/' + product.id + '.webp';
function priceLabel(product) {
  if (!product.copies) return currency.format(product.cents / 100);
  return 'From ' + currency.format(Math.min(...product.copies.map(copy => copy.cents)) / 100);
}
function drawList() {
  const term = el('search').value.trim().toLowerCase();
  const matching = rows.filter(p => (p.name + ' ' + p.category).toLowerCase().includes(term));
  el('count').textContent = rows.length + (rows.length === 1 ? ' product' : ' products');
  el('empty').hidden = matching.length > 0;
  const list = document.createDocumentFragment();
  for (const product of matching) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'product';
    const photo = new Image(); photo.src = imageOf(product); photo.alt = ''; photo.loading = 'lazy';
    const details = document.createElement('span'), name = document.createElement('strong'), summary = document.createElement('small');
    name.textContent = product.name; summary.textContent = product.category + ' · ' + priceLabel(product);
    details.append(name, summary);
    const quantity = document.createElement('span'); quantity.className = 'inventory';
    quantity.textContent = product.quantity == null ? 'Stock unset' : product.quantity === 0 ? 'Sold out' : product.quantity + ' in stock';
    const icon = document.createElement('span'); icon.className = 'chev'; icon.setAttribute('aria-hidden', 'true');
    button.append(photo, details, quantity, icon);
    button.onclick = () => edit(product);
    list.append(button);
  }
  el('items').replaceChildren(list);
}
function releasePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
function showPhoto(src) {
  el('photo').hidden = !src; el('placeholder').hidden = Boolean(src);
  if (src) el('photo').src = src; else el('photo').removeAttribute('src');
}
function edit(product) {
  photoVersion++; rotation = 0; preparedPhoto = null; el('photo-tools').hidden = true;
  releasePreview(); current = product; uploadedFile = null; uploadedImage = null; dirty = false;
  form.reset(); field('photo').setCustomValidity(''); notice('');
  el('title').textContent = product ? 'Edit product' : 'Add product';
  for (const key of ['name', 'category', 'description', 'quantity']) {
    field(key).value = product?.[key] ?? (key === 'category' ? 'Singles' : '');
  }
  el('prices').replaceChildren();
  for (const [index, copy] of (product?.copies || [{ cents: product?.cents }]).entries()) {
    const label = document.createElement('label');
    label.textContent = product?.copies ? 'Copy ' + String.fromCharCode(65 + index) + ' · ' + copy.condition + ' (AUD)' : 'Price (AUD)';
    const input = document.createElement('input');
    Object.assign(input, { type:'number', inputMode:'decimal', min:'0', max:'9999999.99', step:'.01', required:true, value:copy.cents == null ? '' : (copy.cents / 100).toFixed(2) });
    label.append(input); el('prices').append(label);
  }
  field('photo').required = !product;
  showPhoto(product ? imageOf(product) : '');
  el('form-status').textContent = ''; el('save').disabled = false; el('save').textContent = product ? 'Save changes' : 'Add product';
  page('editing'); el('title').focus();
}
function leaveForm() {
  return !dirty || window.confirm('Discard your unsaved changes?');
}
function showInventory() {
  releasePreview(); dirty = false; page('inventory'); drawList(); el('inventory-title').focus();
}
async function load() {
  const [items, account] = await Promise.all([api('items'), api('account')]);
  rows = items;
  el('account-info').textContent = 'Signed in as ' + account.username + ' · Session ends ' + new Date(account.expires).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) + '.';
  signedIn = true; showInventory();
}
el('add').onclick = () => edit(null);
el('back').onclick = () => { if (!busy && leaveForm()) {notice(''); showInventory();} };
el('search').oninput = drawList;
form.oninput = () => { dirty = true; };
async function preparePhoto() {
  const version = ++photoVersion;
  const input = field('photo'), file = input.files[0];
  preparedPhoto = uploadedFile = uploadedImage = null;
  releasePreview();
  input.setCustomValidity('');
  dirty = true;
  el('photo-tools').hidden = !file;
  el('proof').removeAttribute('src');
  showPhoto(current ? imageOf(current) : '');
  el('save').disabled = Boolean(file);
  if (!file) return;
  let source;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image no larger than 20 MB.');
    source = await createImageBitmap(file);
    if (version !== photoVersion) return;
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 1260;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    const flipped = rotation % 2;
    const scale = Math.min(876 / (flipped ? source.height : source.width), 1236 / (flipped ? source.width : source.height));
    const w = source.width * scale, h = source.height * scale;
    ctx.translate(450,630); ctx.rotate(rotation * Math.PI / 2);
    ctx.drawImage(source,-w/2,-h/2,w,h);
    ctx.resetTransform();
    if (el('balance').checked) {
      const pixels = ctx.getImageData(0,0,900,1260);
      balancePhoto(pixels.data);
      ctx.putImageData(pixels,0,0);
    }
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#f3f4f5'; ctx.fillRect(0,0,900,1260);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .93));
    if (version !== photoVersion) return;
    if (!blob) throw new Error('Could not prepare the photo.');
    preparedPhoto = blob;
    previewUrl = URL.createObjectURL(blob);
    el('proof').src = previewUrl; showPhoto(previewUrl);
  } catch (err) {
    if (version !== photoVersion) return;
    const message = err.name === 'Error' ? err.message : 'Choose a readable JPEG, PNG or WebP photo.';
    input.setCustomValidity(message); input.reportValidity();
  } finally {
    source?.close();
    if (version === photoVersion) el('save').disabled = !preparedPhoto;
  }
}
function balancePhoto(data) {
  const histogram = new Uint32Array(256), neutral = [0,0,0];
  let samples = 0, whites = 0;
  for (let i=0; i<data.length; i+=16) {
    if (data[i+3] < 240) continue;
    const r=data[i], g=data[i+1], b=data[i+2];
    const luma=Math.round(.2126*r+.7152*g+.0722*b);
    histogram[luma]++; samples++;
    if (luma>120 && luma<242 && Math.max(r,g,b)-Math.min(r,g,b)<32) {
      neutral[0]+=r; neutral[1]+=g; neutral[2]+=b; whites++;
    }
  }
  if (!samples) return;
  let high=255, total=histogram[255];
  while(high>0 && total<samples*.035) total+=histogram[--high];
  const exposure=Math.max(.90,Math.min(1.22,233/Math.max(1,high)));
  const average=(neutral[0]+neutral[1]+neutral[2])/3;
  const gains=neutral.map(sum => exposure*(whites>samples*.01 ? Math.min(1.08,Math.max(.92,average/sum)) : 1));
  for (let i=0; i<data.length; i+=4) {
    for (let c=0; c<3; c++) data[i+c]=Math.round(255*Math.pow(data[i+c]/255,1/gains[c]));
  }
}
field('photo').onchange = () => {rotation=0; el('balance').checked=true; preparePhoto();};
el('take-photo').onclick = () => el('camera').click();
el('camera').onchange = () => {
  if (!el('camera').files.length) return;
  field('photo').files = el('camera').files;
  field('photo').onchange();
};
el('balance').onchange = preparePhoto;
el('rotate').onclick = () => {rotation=(rotation+1)%4; preparePhoto();};
el('login').onsubmit = async event => {
  event.preventDefault(); const button = el('login').querySelector('button'); button.disabled = true;
  notice('');
  try {
    await api('login', post(Object.fromEntries(new FormData(el('login')))));
    el('login').reset(); await load();
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
};
async function signOut(all) {
  if (busy || !leaveForm()) return;
  el('logout').disabled = true;
  try {
    await api(all ? 'logout-all' : 'logout', post({})); signedIn = false; dirty = false; rows = []; releasePreview();
    page('login'); notice('Signed out.'); el('login').elements.username.focus();
  } catch (error) { notice(error.message); }
  finally { el('logout').disabled = false; }
};
el('logout').onclick = () => signOut(false);
el('logout-all').onclick = () => signOut(true);
form.onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const file = preparedPhoto;
  if (field('photo').files.length && !file) return;
  const data = { id:current?.id, revision:current?.revision, image:current?.image, name:field('name').value.trim(), description:field('description').value.trim(), category:field('category').value, quantity:Number(field('quantity').value), prices:Array.from(el('prices').querySelectorAll('input'), p => Math.round(Number(p.value) * 100)) };
  busy = true;
  const controls = [...form.elements, el('back'), el('logout')];
  controls.forEach(control => control.disabled = true);
  notice(''); el('form-status').textContent = 'Saving…';
  try {
    if (file) {
      if (uploadedFile !== file) {
        uploadedImage = (await api('images', {method:'POST', body:file})).image;
        uploadedFile = file;
      }
      data.image = uploadedImage;
    }
    await api('items', post(data));
    dirty = false; el('search').value = '';
    await load(); notice('Saved “' + data.name + '” to the store.');
  } catch (error) {
    el('form-status').textContent = error.message;
    if (!signedIn) notice('Your session ended. Please sign in again.');
  } finally {
    busy = false; controls.forEach(control => control.disabled = false);
  }
};
load().catch(error => { if (error.status !== 401) notice(error.message); });
