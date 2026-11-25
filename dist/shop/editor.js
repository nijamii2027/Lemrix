(() => {
  const el = id => document.getElementById(id);
  const form = el('editor'), drawer = el('edit-drawer'), bar = el('edit-bar');
  const field = key => form.elements.namedItem(key);
  const staged = new Map();
  let originals = [], published = [], active = false, authenticated = false;
  let busy = false, dirty = false;
  let expiry, sessionEpoch = 0;
  const post = body => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function api(path, options) {
    const response = await fetch('/api/' + path, {credentials:'same-origin',cache:'no-store',...options});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) {
      if (response.status === 401 && authenticated) setAccount(null);
      const error=new Error(data.error || 'Could not reach the shop. Try again.');
      error.status=response.status; throw error;
    }
    return data;
  }
  function setAccount(account) {
    clearTimeout(expiry);
    authenticated = Boolean(account);
    if (authenticated) expiry = setTimeout(()=>setAccount(null),Math.max(0,account.expires-Date.now()));
    else {
      staged.clear(); originals=[]; active=false; bar.hidden=true; document.body.classList.remove('shop-editing'); drawer.close();
      if (published.length) paint();
    }
    window.dispatchEvent(new Event('shop-account-change'));
  }
  const addButton=document.createElement('button');
  addButton.type='button';
  addButton.id='edit-add';
  addButton.textContent='Add product';
  addButton.onclick=()=>openEditor();
  el('edit-push').before(addButton);
  el('edit-push').textContent='Publish changes';
  function updateBar(message) {
    const count = staged.size;
    const drafts=[...staged.values()];
    const removed=drafts.filter(d=>d.remove).length;
    const invalid=drafts.find(d=>!d.remove && d.errors.size);
    const issue=invalid?(invalid.row.name||'Untitled product')+' · '+invalid.errors.values().next().value:'';
    let summary=count ? count+' product'+(count===1?'':'s')+' staged' : 'No unpublished changes';
    if(removed)summary+=' · '+removed+' to remove';
    const text=message || issue || summary;
    addButton.disabled=busy;
    if(el('edit-count').textContent!==text)el('edit-count').textContent=text;
    el('edit-push').disabled=busy || !count || !!invalid;
    el('edit-exit').disabled=busy;
  }
  function paint() {
    const items=active ? originals.map(original=>{
      const publicItem=published.find(p=>p.id===original.id);
      // The admin edits on-hand units. Public counts can already exclude holds.
      return {...structuredClone(publicItem),...structuredClone(original)};
    }) : structuredClone(published);
    if (active) for (const [id, draft] of staged) {
      const index=items.findIndex(p=>p.id===id);
      const row={...items[index],...draft.row};
      if(row.copies)row.copies=row.copies.map((copy,i)=>({...items[index]?.copies?.[i],...copy}));
      if (index>=0) items[index]=row; else items.push(row);
    }
    products.splice(0,products.length,...items);
    rebuildGallery(); renderRoute();
  }
  async function toggle() {
    if (!authenticated || busy) return;
    if (active) {
      if (staged.size && !confirm('Discard staged changes and exit editing?')) return;
      staged.clear(); active=false; paint();
    } else {
      try { originals=await api('items'); } catch(error) { alert(error.message); return; }
      if (!authenticated || active) return;
      if (!published.length) published=structuredClone(products);
      active=true; paint();
    }
    document.body.classList.toggle('shop-editing',active);
    bar.hidden=!active;
    el('staff-toggle').textContent=active?'Exit edit mode':'Edit shop';
    updateBar();
  }
  window.shopEditor={
    get authenticated(){return authenticated;},
    get active(){return authenticated && active;},
    addProduct:()=>openEditor(),
    refreshPublished(items){if(!active)published=structuredClone(items);},
    decorateTile(item,link) {
      if(!active || !authenticated)return link;
      const format=link.querySelector('.tile-type');
      if(format && ![item.card?.set,item.card?.cardNumber,item.card?.language].some(Boolean))format.textContent=item.format;
      const tile=document.createElement('article');
      tile.className='editable-tile';
      tile.append(link,inline.inventoryPanel(item,'catalogue'));
      if(read(item.id).remove)tile.classList.add('pending-removal');
      return tile;
    },
    renderShowroom(item) {
      const old=el('showroom-inventory');
      el('featured-detail').firstChild.textContent=active && authenticated?'Edit details ':'View item ';
      if(!active || !authenticated){old?.remove();return;}
      el('featured-format').textContent=item.format;
      const panel=inline.inventoryPanel(item,'showroom');
      panel.id='showroom-inventory';
      if(old)old.replaceWith(panel);
      else el('featured-detail').after(panel);
    },
    renderDetail(item,fallback){if(active && authenticated)inline.detail(item,fallback);},
    renderCopy(item,index,face){if(active && authenticated)inline.renderCopy(item,index,face);},
    renderFacts(item){if(active && authenticated)inline.renderFacts(item);},
    async login(password) {
      ++sessionEpoch;
      await api('login',post({username:'Lemrix',password}));
      setAccount(await api('account'));
    },
    async logout(all) {
      if (busy || (staged.size && !confirm('Discard staged changes and sign out?'))) return false;
      await api(all?'logout-all':'logout',post({}));
      ++sessionEpoch; staged.clear(); setAccount(null);
      if (published.length) paint();
      return true;
    },
    toggle
  };
  async function restore() {
    const epoch=++sessionEpoch;
    let account=null;
    try { account=await api('account'); } catch {}
    if (epoch===sessionEpoch) {
      setAccount(account);
      if (location.hash==='#account') el('account-opener').click();
    }
  }
  window.addEventListener('pageshow',restore);
  window.addEventListener('keydown',event=>{
    if (!authenticated || event.defaultPrevented || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase()!=='e' ||
      document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault(); toggle();
  });
  const desk=window.LemrixCapture(form);
  // A per-product draft holds its inventory revision alongside the ordinary shop
  // model. Keep typed values separate so incomplete inputs survive navigation.
  function read(id){
    return staged.get(id) || {row:originals.find(p=>p.id===id)};
  }
  function draftFor(id){
    let draft=staged.get(id);
    if(!draft){
      const original=originals.find(p=>p.id===id);
      if(!original)return;
      draft={row:structuredClone(original),inputs:new Map(),errors:new Map()};
      staged.set(id,draft);
    }
    return draft;
  }
  function toggleRemoval(item,view){
    if(!active || !authenticated || busy)return;
    const draft=draftFor(item.id);
    if(!draft)return;
    if(draft.row.create){
      staged.delete(item.id);
      if(location.hash.startsWith('#item/'+item.id))location.hash=el('detail-return').hash || '#catalogue';
    }else{
      draft.remove=!draft.remove;
      if(!draft.remove && !draft.inputs.size)staged.delete(item.id);
    }
    paint();updateBar();
    const panel=document.querySelector('[data-inventory-view="'+view+'"][data-product-id="'+CSS.escape(item.id)+'"]');
    (panel?.querySelector('.inventory-remove') || addButton).focus({preventScroll:true});
  }
  function changeValue(row,path,value){
    const [key,index,part]=path.split('.');
    if(key==='card')row.card={...row.card,[index]:value};
    else if(key==='copies'){
      const copy=row.copies[index];
      if(part==='front'||part==='back')copy[part]=[value,...(copy[part]||[]).slice(1)];
      else copy[part]=value;
    }else row[key]=value;
  }
  function write(item,path,raw,value,message){
    if(!active || !authenticated || busy)return;
    const draft=draftFor(item.id);
    if(!draft || draft.remove)return;
    draft.inputs.set(path,raw);
    if(message)draft.errors.set(path,message);else draft.errors.delete(path);
    changeValue(draft.row,path,value);
    // The detail and catalogue share this object. Use the staged value in both
    // without re-rendering the page, moving the caret, or closing an accordion.
    if(item!==draft.row)changeValue(item,path,value);
    updateBar();
  }
  const inline=window.LemrixInlineEditor({read,write,toggleRemoval,busy:()=>busy});
  function openEditor() {
    if (!authenticated || !active || busy || drawer.open) return;
    form.reset();
    field('category').value='Singles';
    field('collection').value='recently-added';
    const label=document.createElement('label');label.textContent='Price (AUD)';
    const input=document.createElement('input');
    Object.assign(input,{name:'price',type:'number',min:'0',max:'9999999.99',step:'.01',required:true});
    label.append(input);el('prices').replaceChildren(label);
    desk.open(null,()=>{dirty=true;});
    el('save').disabled=false;el('form-status').textContent='';
    dirty=false;drawer.showModal();
  }
  el('edit-exit').onclick=toggle;
  function closeEditor() {
    if (busy || (dirty && !confirm('Discard changes to this product?'))) return;
    drawer.close();
  }
  drawer.addEventListener('cancel',e=>{e.preventDefault(); closeEditor();});
  drawer.addEventListener('close',()=>{if(!drawer.open)desk.reset();});
  el('edit-close').onclick=closeEditor;
  form.oninput=()=>{dirty=true;};
  form.onsubmit=async event=>{
    event.preventDefault();
    if (!authenticated || !active || busy) return;
    const issue=desk.validate();
    if(issue){el('form-status').textContent=issue;return;}
    const next=el('stage-next').checked;
    const id=crypto.randomUUID().replaceAll('-','');
    const row={id,create:true,quantity:field('quantity').value===''?null:Number(field('quantity').value)};
    for(const key of ['name','category','format','description','notes','collection']) row[key]=field(key).value.trim();
    if (!row.format) row.format=row.category==='Singles'?'Trading card':row.category;
    row.cents=Math.round(Number(field('price').value)*100);
    busy=true; el('save').disabled=true; el('form-status').textContent='Staging…';
    const controls=Array.from(form.elements).filter(c=>!c.disabled);
    controls.forEach(c=>c.disabled=true);
    try {
      await desk.save(row,blob=>api('images',{method:'POST',body:blob}));
      if(!authenticated || !active)return;
      staged.set(id,{row,inputs:new Map(),errors:new Map()});
      dirty=false; busy=false; drawer.close(); paint(); updateBar();
      if(next) setTimeout(()=>{if(active && authenticated){openEditor();el('stage-next').checked=true;}},0);
    } catch(error){ el('form-status').textContent=error.message; }
    finally {busy=false;controls.forEach(c=>c.disabled=false);el('save').disabled=false;updateBar();}
  };
  function payload({row,remove}){
    if(remove)return {id:row.id,revision:row.revision,remove:true};
    const {id,create,revision,image,backImage,name,description,format,category,notes,availability,collection,card}=row;
    return {id,create,revision,image,backImage,name,description,format,category,notes,availability,collection,card,
      quantity:row.quantity??null,prices:row.copies?.map(c=>c.cents) || [row.cents],
      conditions:row.copies?.map(c=>c.condition),
      wear:row.copies?.map(c=>({front:c.front[0],back:c.back[0]}))};
  }
  el('edit-push').onclick=async()=>{
    if (!authenticated || !active || busy || !staged.size || [...staged.values()].some(d=>!d.remove && d.errors.size)) return;
    busy=true; updateBar('Publishing…');
    const enabled=[...document.querySelectorAll('.shop-input:enabled,.inventory-panel button:enabled')];
    enabled.forEach(input=>input.disabled=true);
    try {
      await api('items/push',post({changes:[...staged.values()].map(payload)}));
      staged.clear();
      sessionStorage.setItem('lemrix.shop.pushed','1');
      location.reload();
    } catch(error) {busy=false;enabled.forEach(input=>input.disabled=false);updateBar(error.message);}
  };
  if (sessionStorage.getItem('lemrix.shop.pushed')) {
    sessionStorage.removeItem('lemrix.shop.pushed');
    window.addEventListener('shop-account-change',async function resume(){
      window.removeEventListener('shop-account-change',resume);
      if(authenticated){await toggle();updateBar('Changes published');}
    });
  }
  window.addEventListener('beforeunload',event=>{
    if (staged.size || (dirty && drawer.open)) {event.preventDefault();event.returnValue='';}
  });
})();
