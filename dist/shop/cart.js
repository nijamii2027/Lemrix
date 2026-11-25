// A cart line identifies a particular physical copy when a single has condition variants.
window.LemrixCart = (() => {
  const key = 'lemrix-shop-cart-v1', oldKey = 'lemrix-shop-saved-v1';
  const byId = id => document.getElementById(id);
  const cash = new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',currencyDisplay:'code'});
  const money = cents => cash.format(cents/100);
  const find = id => products.find(item => item.id === id);
  const matches = (line,id,copy) => line.itemId === id && line.copy === copy;
  const linesKey = lines => JSON.stringify(lines);
  let lines = [], busy = false;
  function read() {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        lines = Array.isArray(parsed) ? parsed.filter(l => l && typeof l.itemId === 'string' &&
          (l.copy === null || Number.isInteger(l.copy)) && Number.isInteger(l.quantity) && l.quantity>0 && l.quantity<=99) : [];
      } else {
        const saved = JSON.parse(localStorage.getItem(oldKey) || '[]');
        lines = [...new Set(Array.isArray(saved)?saved:[])].filter(find).map(id => ({itemId:id,copy:find(id).copies?0:null,quantity:1}));
        if (lines.length) localStorage.setItem(key,linesKey(lines));
      }
    } catch { lines=[]; }
  }
  read();
  const count = () => lines.reduce((n,l) => n+l.quantity,0);
  const dispatchFormatter = new Intl.DateTimeFormat('en-AU', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
  function dispatchLabel(item) {
    if (!item?.preorderOpen || !item.preorderDispatch) return '';
    return dispatchFormatter.format(new Date(item.preorderDispatch + 'T00:00:00Z'));
  }
  function preorderStatus(item) {
    if (!item.preorderOpen || !Number.isInteger(item.quantity)) return 'Pre-orders closed';
    if (item.reserved) return 'Pre-order allocation reserved';
    if (!(item.quantity > 0) || item.copies?.every(copy => copy.sold)) return 'Pre-order allocation sold out';
    if (item.checkoutMode === 'off') return 'Online checkout unavailable';
    if (!item.canBuy) return 'Pre-orders closed';
    return 'Pre-order';
  }
  // Use the same public Square eligibility for a specific listing everywhere.
  function availability(item, copy) {
    const listing = item && (item.copies ? item.copies[copy] : copy === null ? item : null);
    let reason = '';
    if (!listing) reason = 'Listing no longer available';
    else if (item.collection === 'pre-orders' && preorderStatus(item) !== 'Pre-order') reason = preorderStatus(item);
    else if (listing.sold) reason = 'Sold out';
    else if (listing.reserved || item.reserved) reason = 'Temporarily reserved';
    else if (item.quantity === 0) reason = 'Sold out';
    else if (!item.checkoutMode || (item.checkoutMode === 'live' && !Number.isInteger(item.quantity))) reason = 'Preview only';
    else if (item.checkoutMode === 'off') reason = 'Online checkout unavailable';
    else if (!listing.canBuy) reason = 'Unavailable to order';
    const max = reason ? 0 : item.copies ? 1 : Math.min(99, item.quantity ?? 99);
    return {item, listing, reason, max};
  }
  function cartState() {
    const quantities = new Map();
    const rows = lines.map(line => {
      const row = availability(find(line.itemId), line.copy);
      if (!row.reason && line.expectedDispatch !== (row.item.collection === 'pre-orders' ? row.item.preorderDispatch : undefined))
        row.reason = 'Dispatch details changed. Remove this item and add it again to confirm.';
      if (!row.reason) quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + line.quantity);
      return {...row, line};
    });
    const order = [];
    let subtotal = 0;
    for (const row of rows) {
      const {item, listing, line} = row;
      if (!row.reason && item.copies && line.quantity !== 1) row.reason = 'Only one of this copy is available';
      if (!row.reason && (line.quantity > row.max || (item.checkoutMode === 'live' && quantities.get(item.id) > item.quantity)))
        row.reason = item.copies ? 'Choose up to '+item.quantity+' available cop'+(item.quantity===1?'y':'ies') : 'Only '+row.max+' available. Reduce the quantity to check out.';
      if (row.reason) continue;
      subtotal += listing.cents * line.quantity;
      order.push({...line, expectedCents:listing.cents});
    }
    return {rows, order, subtotal};
  }
  function commit() {
    try { localStorage.setItem(key,linesKey(lines)); } catch {}
    refresh();
  }
  function refresh() {
    byId('cart-count').textContent=count();
    byId('cart-opener').setAttribute('aria-label','Open cart, '+count()+(count()===1?' item':' items'));
    if (!byId('cart').hidden) render();
  }
  function contains(id,copy) { return lines.some(l => matches(l,id,copy)); }
  function add(id,copy) {
    if (contains(id,copy)) { location.hash='cart'; return; }
    const item = find(id);
    if (availability(item,copy).reason) return;
    const line = {itemId:id,copy,quantity:1};
    if (item.collection === 'pre-orders') line.expectedDispatch = item.preorderDispatch;
    lines.push(line);
    commit();
  }
  function text(tag,content,cls) {
    const node=document.createElement(tag);
    node.textContent=content;
    if(cls) node.className=cls;
    return node;
  }
  function control(label,action,description) {
    const b=text('button',label);
    b.type='button'; b.dataset.action=action; b.setAttribute('aria-label',description);
    return b;
  }
  function render() {
    const fragment=document.createDocumentFragment();
    const {rows, order, subtotal}=cartState();
    const mixed=order.length>0 && order.length<rows.length;
    for (const [index,{line,item,listing,reason,max}] of rows.entries()) {
      const row=document.createElement('li');
      row.dataset.index=index;
      const title=item?.name || 'Unavailable item';
      const link=text(item?'a':'span',title,'cart-name');
      const photo=document.createElement('span'); photo.className='cart-photo';
      if(item) {
        link.href='#item/'+item.id+(listing && item.copies?'?copy='+line.copy:'');
        const img=new Image(); img.src=item.image||'art/'+item.id+'.webp'; img.alt=''; img.decoding='async'; photo.append(img);
      }
      const info=document.createElement('div');
      const meta=listing && item.copies ? 'Copy '+String.fromCharCode(65+line.copy)+' · '+listing.condition : item?.format;
      info.append(link,text('p',meta||'Removed from the catalogue.'));
      if (line.expectedDispatch && item?.collection === 'pre-orders' && dispatchLabel(item))
        info.append(text('small', 'Pre-order · ' + (item.checkoutMode==='test'?'Test checkout':'Pay now') + ' · Expected dispatch ' + dispatchLabel(item)));
      if (reason) info.append(text('small', reason));
      const edit=document.createElement('div'); edit.className='cart-controls';
      if(listing && line.copy===null && max>0){
        const group=document.createElement('div'); group.className='cart-stepper';
        const minus=control('−','less','Decrease '+title+' quantity');
        const plus=control('+','more','Increase '+title+' quantity');
        minus.disabled=busy || line.quantity===1;
        plus.disabled=busy || line.quantity>=max;
        group.append(minus,text('span',line.quantity),plus); edit.append(group);
      } else if (line.quantity>1) edit.append(text('span','Quantity '+line.quantity));
      const remove=control('Remove','remove','Remove '+title+' from cart');
      remove.disabled=busy; edit.append(remove);
      info.append(edit);
      row.append(photo,info,text('strong',listing?money(listing.cents*line.quantity):'—','cart-price'));
      fragment.append(row);
    }
    byId('cart-lines').replaceChildren(fragment);
    byId('cart-empty').hidden=!!lines.length;
    byId('cart-summary').hidden=!lines.length;
    byId('cart-total').textContent=money(subtotal);
    byId('cart-subtotal-label').textContent=order.length===rows.length?'Subtotal':'Checkout subtotal';
    byId('cart-checkout').disabled=busy || checkoutInProgress() || !order.length || order.length>50;
    byId('cart-checkout').textContent=busy?'Opening checkout…':mixed?'Checkout available items':order.length && find(order[0].itemId)?.checkoutMode==='test'?'Test checkout':'Checkout';
    byId('cart-note').textContent=order.length>50?'Choose up to 50 listings per checkout.':
      mixed?'Only available items are included in the subtotal and checkout. Other items stay in your cart.':
      order.length?'Ships within Australia. Shipping is shown at Square checkout.':
      rows.length===1?rows[0].reason.replace(/\.?$/,'.'):
      'Each unavailable item is marked below its name.';
  }
  function open() {
    byId('cart').hidden=false; render();
    byId('cart-opener').setAttribute('aria-current','page');
    document.title='Your cart · Lemrix TCG';
  }
  function message(value) { byId('cart-status').textContent=value; }
  byId('cart-lines').addEventListener('click',e=>{
    const b=e.target.closest('button[data-action]'); if (!b || busy) return;
    const index=Number(b.closest('li').dataset.index), line=lines[index]; if(!line)return;
    if(b.dataset.action==='remove') lines.splice(index,1);
    else {
      const {max}=availability(find(line.itemId),line.copy);
      const next=line.quantity+(b.dataset.action==='more'?1:-1);
      if (!max || next<1 || (next>max && next>=line.quantity)) return;
      line.quantity=next;
    }
    const action=b.dataset.action;
    message(''); commit();
    const row=byId('cart-lines').children[Math.min(index,lines.length-1)];
    (row?.querySelector('[data-action="'+action+'"]:not(:disabled)')||row?.querySelector('button:not(:disabled)')||byId('cart-continue')).focus({preventScroll:true});
  });
  byId('cart-checkout').addEventListener('click',async()=>{
    if (busy || checkoutInProgress()) return;
    const {order}=cartState();
    if (!order.length || order.length>50) return;
    busy=true; message(''); render();
    try {
      await startCustomerCheckout({lines:order});
    } catch(error){ message(error.message); }
    finally { busy=false; render(); }
  });
  function complete(attempt) {
    if(!attempt)return;
    try {
      const order=JSON.parse(sessionStorage.getItem('cart-order-'+attempt)||'[]');
      if(!order.length)return;
      read();
      for(const paid of order) {
        const l=lines.find(l=>matches(l,paid.itemId,paid.copy));
        if(l) l.quantity-=paid.quantity;
      }
      lines=lines.filter(l=>l.quantity>0);
      sessionStorage.removeItem('cart-order-'+attempt);
      commit();
    } catch {}
  }
  window.addEventListener('storage',e=>{
    if(e.key===key || e.key===null){read();refresh();window.dispatchEvent(new Event('lemrix-cart-change'));}
  });
  return {add,contains,open,refresh,complete,message,availability,dispatchLabel,preorderStatus};
})();
