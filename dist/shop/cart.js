// A cart line identifies a particular physical copy when a single has condition variants.
window.LemrixCart = (() => {
  const key = 'lemrix-shop-cart-v1', oldKey = 'lemrix-shop-saved-v1';
  const byId = id => document.getElementById(id);
  const cash = new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',currencyDisplay:'code'});
  const money = cents => cash.format(cents/100);
  const find = id => products.find(item => item.id === id);
  const matches = (line,id,copy) => line.itemId === id && line.copy === copy;
  const linesKey = lines => JSON.stringify(lines);
  let lines = [], pending = null, busy = false;
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
  const resolve = line => {
    const item=find(line.itemId);
    const listing=item && (item.copies ? item.copies[line.copy] : line.copy===null ? item : null);
    return {item,listing};
  };
  function commit() {
    pending=null;
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
    lines.push({itemId:id,copy,quantity:1});
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
    let subtotal=0, ready=lines.length>0, hasPreview=false;
    for (const [index,line] of lines.entries()) {
      const {item,listing}=resolve(line);
      if (listing) subtotal+=listing.cents*line.quantity;
      const unavailable=!listing?.canBuy || (item.checkoutMode==='live' && line.quantity>item.quantity);
      ready &&= !unavailable;
      hasPreview ||= unavailable;
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
      if (unavailable) {
        const reason = item?.collection === 'pre-orders' ? 'Pre-order preview'
          : item?.reserved ? 'Temporarily reserved'
          : !item?.checkoutMode || item.checkoutMode === 'off' ? 'Checkout unavailable'
          : 'Unavailable to order';
        info.append(text('small', reason));
      }
      const edit=document.createElement('div'); edit.className='cart-controls';
      if(listing && line.copy===null){
        const group=document.createElement('div'); group.className='cart-stepper';
        const minus=control('−','less','Decrease '+title+' quantity');
        const plus=control('+','more','Increase '+title+' quantity');
        minus.disabled=busy || line.quantity===1;
        plus.disabled=busy || line.quantity>=Math.min(99,item.quantity??99);
        group.append(minus,text('span',line.quantity),plus); edit.append(group);
      }
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
    byId('cart-checkout').disabled=busy || !ready;
    byId('cart-checkout').textContent=busy?'Opening checkout…':products.some(i=>i.checkoutMode==='test')?'Test checkout':'Checkout';
    byId('cart-note').textContent=products.some(item => item.checkoutMode === 'off') ? 'Online checkout is being set up.' : hasPreview?'Checkout is available for in-stock items only.':'Ships within Australia. Shipping is shown at Square checkout.';
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
    else line.quantity+=b.dataset.action==='more'?1:-1;
    const action=b.dataset.action;
    message(''); commit();
    const row=byId('cart-lines').children[Math.min(index,lines.length-1)];
    (row?.querySelector('[data-action="'+action+'"]:not(:disabled)')||row?.querySelector('button:not(:disabled)')||byId('cart-continue')).focus({preventScroll:true});
  });
  byId('cart-checkout').addEventListener('click',async()=>{
    if (busy || !lines.length) return;
    const order=lines.map(l=>({...l, expectedCents:resolve(l).listing?.cents}));
    if(!order.every(l=>resolve(l).listing?.canBuy)) return;
    const signature=linesKey(order);
    if(!pending || pending.signature!==signature || Date.now()/1000-pending.started>540)
      pending={attempt:crypto.randomUUID(),started:Math.floor(Date.now()/1000),signature};
    const request=pending;
    busy=true; message(''); render();
    try {
      const result=await checkoutPost('',{attempt:request.attempt,started:request.started,lines:order});
      try { sessionStorage.setItem('cart-order-'+request.attempt,linesKey(order)); } catch {}
      location.assign(result.url);
    } catch(error){ message(error.message); }
    finally { busy=false; render(); }
  });
  function complete(attempt) {
    if(!attempt)return;
    try {
      const order=JSON.parse(sessionStorage.getItem('cart-order-'+attempt)||'[]');
      if(!order.length)return;
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
  return {add,contains,open,refresh,complete,message};
})();
