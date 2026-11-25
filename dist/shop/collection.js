// Keep visitor first paint independent of staff tools and the full set directory.
const loadShopScript = (() => {
  const base = document.currentScript.src;
  const loading = new Map();
  return function load(file) {
    if (!loading.has(file)) {
      const script = document.createElement('script');
      script.src = new URL(file, base).href;
      const ready = new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => {
          loading.delete(file);
          script.remove();
          reject(new Error('Could not load shop tools. Please try again.'));
        };
      });
      loading.set(file, ready);
      document.head.append(script);
    }
    return loading.get(file);
  };
})();

// The set index is reference data. Listing counts and prices always come from this shop.
window.LemrixCollection=(()=>{
  const id=s=>document.getElementById(s);
  const form=id('catalogue-tools'),dialog=id('sets-dialog'),faces=id('photo-faces');
  const norm=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
  const params=()=>new URLSearchParams(location.hash.startsWith('#collection/')?location.hash.split('?')[1]||'':location.hash.slice(1));
  const written=q=>{
    q.set('view','catalogue');
    const route=location.hash.startsWith('#collection/')?location.hash.split('?')[0]+'?':'#';
    location.hash=route+q.toString();
  };
  const setValue=(q,k,v)=>v?q.set(k,v):q.delete(k);
  function stockCount(item) {
    if (item.archived || item.reserved || item.collection === 'pre-orders' ||
        !Number.isInteger(item.quantity) || item.quantity <= 0) return 0;
    if (!item.copies) return item.quantity;
    const availableCopies = item.copies.filter(copy => !copy.sold && !copy.reserved);
    return Math.min(item.quantity, availableCopies.length);
  }
  const kind=item=>item.card?.productType || (item.category==='Singles'?'card':item.category==='Packs'?'pack':'accessory');
  const badge=item=>[item.card?.grader,item.card?.grade].filter(Boolean).join(' ');
  function amount(item) {
    if (!item.copies?.length) return item.cents;
    const available=item.copies.filter(copy=>copy.canBuy);
    const prices=(available.length?available:item.copies).map(copy=>copy.cents).filter(cents=>Number.isSafeInteger(cents) && cents>0);
    return prices.length?Math.min(...prices):0;
  }
  const eq=(a,b)=>norm(a)===norm(b);
  let era='',catalogue=[],current=null,front='',back='',side='front';
  function apply(items){
    const q=params(),type=q.get('type'),lang=q.get('language'),set=q.get('set'),series=q.get('era'),sort=q.get('sort');
    const out=items.filter(item=>(!type||kind(item)===type)&&(!lang||eq(item.card?.language,lang))&&
      (!set||eq(item.card?.set,set))&&(!series||eq(item.card?.series,series))&&(!q.has('stock')||stockCount(item)>0));
    if(sort==='low'||sort==='high')out.sort((a,b)=>(amount(a)-amount(b))*(sort==='high'?-1:1));
    else if(sort==='name')out.sort((a,b)=>a.name.localeCompare(b.name));
    else if(sort==='new')out.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    return out;
  }
  const baseLanguages = new Set([...form.elements.language.options].map(option => norm(option.value)));
  let languageMenuKey;
  function syncLanguages() {
    const names = new Map();
    for (const item of products) {
      const name = item.card?.language, key = norm(name);
      if (key && !baseLanguages.has(key)) names.set(key, name);
    }
    const values = [...names.values()].sort((a,b) => a.localeCompare(b));
    const key = JSON.stringify(values);
    if (key === languageMenuKey) return;
    languageMenuKey = key;
    const select = form.elements.language;
    select.querySelectorAll('[data-custom-language]').forEach(option => option.remove());
    for (const value of values) {
      const option = new Option(value,value);
      option.dataset.customLanguage = '';
      select.add(option);
    }
  }
  function sync() {
    syncLanguages();
    const q=params();
    for(const k of ['type','language','sort'])form.elements[k].value=q.get(k)||'';
    form.elements.stock.checked=q.has('stock');
    const clear=id('applied-set');clear.hidden=!q.get('set');
    clear.firstElementChild.textContent=q.get('set')||'';
  }
  form.addEventListener('change',()=>{
    const q=params();
    for(const k of ['type','language','sort'])setValue(q,k,form.elements[k].value);
    setValue(q,'stock',form.elements.stock.checked?'1':'');written(q);
  });
  id('applied-set').querySelector('button').onclick=()=>{const q=params();q.delete('set');q.delete('era');written(q);};
  function element(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;n.textContent=txt;return n;}
  function makeSetButton(set){
    const b=element('button','set-cell','');b.type='button';
    b.append(element('small','set-code',set.code||set.language),element('strong','',set.name));
    b.append(element('span','set-count',[set.language,set.printedTotal?set.printedTotal+' cards in set':'',set.stock+' in stock'].filter(Boolean).join(' · ')));
    b.onclick=()=>{
      dialog.close();
      const q=new URLSearchParams({view:'catalogue',set:set.name,language:set.language});
      location.hash=q.toString();
    };
    return b;
  }
  function drawSets(){
    const term=norm(id('set-query').value);
    const pool=catalogue.filter(s=>!term||[s.name,s.series,s.code,s.language,...s.aliases||[]].some(t=>norm(t).includes(term)));
    const counts=new Map();
    for (const set of pool) counts.set(set.series,(counts.get(set.series)||0)+1);
    const eras=[...counts.keys()];
    if(!eras.includes(era))era=eras[0]||'';
    const collection=term?pool:pool.filter(s=>s.series===era);
    const buttons=eras.map(name=>{
      const b=element('button','','');b.type='button';b.append(element('span','',name),element('small','',counts.get(name)));
      b.setAttribute('aria-pressed',String(era===name&&!term));b.onclick=()=>{era=name;id('set-query').value='';drawSets();};return b;
    });
    id('set-eras').replaceChildren(...buttons);id('era-heading').textContent=term?'Matching sets':era;
    id('set-options').replaceChildren(...(collection.length?collection.map(makeSetButton):[element('p','','No matching sets.')]));
  }
  async function openSets(){
    dialog.showModal();
    if (!window.LemrixSets) {
      id('era-heading').textContent='Loading sets…';
      id('set-options').replaceChildren();
      try {
        await loadShopScript('set-directory.js');
      } catch {
        id('era-heading').textContent='Could not load sets. Close and try again.';
        return;
      }
      if (!dialog.open) return;
    }
    catalogue=(window.LemrixSets||[]).map(s=>({...s,stock:0}));
    const lookup=new Map(catalogue.map(s=>[norm(s.language)+'/'+norm(s.name),s]));
    for(const item of products){
      const c=item.card;if(!c?.set)continue;
      const key=norm(c.language)+'/'+norm(c.set);
      let entry=lookup.get(key);
      if(!entry){entry={name:c.set,language:c.language||'',series:c.series||'Other sets',stock:0};lookup.set(key,entry);catalogue.push(entry);}
      entry.stock+=stockCount(item);
    }
    id('set-query').value='';era=catalogue.find(s=>s.stock)?.series||era||catalogue[0]?.series||'';
    drawSets();id('set-query').focus();
  }
  id('sets-open').onclick=openSets;id('set-query').oninput=drawSets;
  for(const d of document.querySelectorAll('.collector-dialog')){
    d.querySelector('[data-close]').onclick=()=>d.close();
    d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
  }
  function paintFace(){
    const src=side==='back'?back:front;
    for(const b of faces.children)b.setAttribute('aria-pressed',String(b.dataset.side===side));
    for(const key of ['detail-art','closeup-art']){
      const img=id(key);img.src=src;img.alt=key==='detail-art'?current.name+' · '+side:'';
    }
    const zoom=id('closeup');zoom.setAttribute('aria-pressed','false');zoom.setAttribute('aria-label',window.shopEditor?.active?'Edit '+side+' photo':'Zoom '+side+' photo');
    zoom.style.removeProperty('--zoom-point');
  }
  function inspect(item,copyIndex=0){
    current=item;side='front';
    const copy=item.copies?.[copyIndex];
    front=copy?.photos?.front||item.image||'art/'+item.id+'.webp';
    back=copy?.photos?.back||(!copy||copyIndex===0?item.backImage:'');
    faces.hidden=!back;paintFace();
    const c=item.card||{},dl=id('card-facts'),nodes=[];
    for(const [label,value] of [['Set',c.set],['Era',c.series],['Number',c.cardNumber],['Language',c.language],['Year',c.year],['Grade',badge(item)],['Condition',c.itemCondition],['Certificate',c.certificate]]){
      if(!value)continue;
      const dt=element('dt','',label),dd=element('dd','',value);
      if(label==='Certificate' && eq(c.grader,'PSA') && /^\d{5,12}$/.test(value)){
        const link=element('a','',value+' · View PSA record');link.href='https://www.psacard.com/cert/'+value;link.target='_blank';link.rel='noopener';dd.replaceChildren(link);
      }
      nodes.push(dt,dd);
    }
    dl.replaceChildren(...nodes);dl.hidden=!nodes.length;
  }
  for(const b of faces.children)b.onclick=()=>{
    side=b.dataset.side;paintFace();document.dispatchEvent(new CustomEvent('lemrix-photo-face',{detail:side}));
  };
  const zoom=id('closeup');
  zoom.addEventListener('pointermove',e=>{
    if(zoom.getAttribute('aria-pressed')!=='true')return;
    const r=zoom.getBoundingClientRect();zoom.style.setProperty('--zoom-point',Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100))+'% '+Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))+'%');
  });
  return {apply,sync,inspect,badge,stockCount,amount,photoFace:()=>side,selectedSet:()=>params().get('set')};
})();
