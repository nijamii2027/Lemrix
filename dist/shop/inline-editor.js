// Native form controls take the place of the corresponding shop text in owner edit mode.
window.LemrixInlineEditor = function createInlineEditor({read, write, toggleRemoval, busy}) {
  const el=id=>document.getElementById(id);
  const cardFields=[
    ['set','Set',120],['series','Era',100],['cardNumber','Number',35],
    ['language','Language',40],['year','Year',4],['grader','Grader',24],
    ['grade','Grade',30],['itemCondition','Condition',80],['certificate','Certificate',42]
  ];
  const productTypes=[['card','Raw card'],['slab','Graded slab'],['box','Box or tin'],['pack','Pack'],['accessory','Accessory']];
  function autoHeight(input) {
    if(!input.clientWidth)return;
    input.style.height='auto';
    input.style.height=input.scrollHeight+2+'px';
  }
  document.addEventListener('toggle',e=>{
    if(e.target.tagName==='DETAILS' && e.target.open)
      e.target.querySelectorAll('textarea.shop-input').forEach(autoHeight);
  },true);
  let resizeFrame=0;
  function reflow(){
    if(resizeFrame || !document.body.classList.contains('shop-editing'))return;
    resizeFrame=requestAnimationFrame(()=>{
      resizeFrame=0;
      el('detail').querySelectorAll('textarea.shop-input').forEach(autoHeight);
    });
  }
  window.addEventListener('resize',reflow);
  document.fonts?.addEventListener('loadingdone',reflow);
  function control(item,path,label,value,options={}) {
    const {options:choices,multiline=false,numeric,required=false,max=3000,placeholder=''}=options;
    const fieldName=path.replace(/^card\./,'');
    const taxonomy=window.LemrixTaxonomy.has(fieldName);
    const input=document.createElement(choices || taxonomy?'select':multiline?'textarea':'input');
    input.className='shop-input';
    input.dataset.shopField=path;
    input.setAttribute('aria-label',label);
    if(choices) {
      for(const choice of choices){
        const [key,text]=Array.isArray(choice)?choice:[choice,choice];
        input.add(new Option(text,key));
      }
    }else if(!taxonomy){
      input.maxLength=max;input.required=required;input.placeholder=placeholder;
      if(numeric)input.inputMode=numeric==='price'?'decimal':'numeric';
      if(multiline)input.rows=1;
    }
    const model=read(item.id);
    const current = model.inputs?.get(path)??value??'';
    if(taxonomy)window.LemrixTaxonomy.attach(input,fieldName,current);
    else input.value=current;
    input.disabled=busy() || Boolean(model.remove);
    const issue=()=>{
      const raw=input.value.trim();
      if(required && !raw)return label+' is required.';
      if(numeric==='price' && (!/^\d+(?:\.\d{0,2})?$/.test(raw) || Number(raw)>9999999.99))return 'Enter an AUD price with up to two decimal places.';
      if(numeric==='stock' && raw && (!/^\d+$/.test(raw) || Number(raw)>1000000))return 'Enter a whole stock quantity of 0–1,000,000.';
      if(numeric==='stock' && (model.row.checkoutHolds?.length || 0)>Number(raw))return 'Stock on hand must include all units held at checkout.';
      if(path==='card.year' && raw && !/^\d{4}$/.test(raw))return 'Enter a four-digit year.';
      return '';
    };
    function mark(message){
      input.setCustomValidity(message);
      if(message)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
    }
    mark(model.errors?.get(path)||'');
    const size=()=>{
      if(multiline)autoHeight(input);
      else if(input.matches('input') && ['cents','format'].includes(path.split('.').at(-1)))
        input.style.inlineSize=Math.max(4,(input.value||input.placeholder).length+1)+'ch';
    };
    const edit=()=>{
      if(busy())return;
      const raw=input.value,message=issue();
      mark(message);size();
      let normalized=raw;
      if(numeric==='price')normalized=message?null:Math.round(Number(raw)*100);
      else if(numeric==='stock')normalized=!raw.trim()||message?null:Number(raw);
      else if(options.defaultText && raw.trim()===options.defaultText)normalized='';
      write(item,path,raw,normalized,message);
      if(['quantity','collection','preorderDispatch'].includes(path))syncInventory(item);
      if(path.startsWith('copies.'))syncCopyOption(item,path);
    };
    input.addEventListener(choices || taxonomy?'change':'input',edit);
    if(multiline)requestAnimationFrame(size);else size();
    return input;
  }
  function inventoryStatus(row) {
    const held=row.checkoutHolds?.length || 0;
    if(row.collection==='pre-orders'){
      const todayInBrisbane = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if(!row.preorderDispatch || row.preorderDispatch < todayInBrisbane)return 'Pre-orders closed · Set a current dispatch date';
      const unsold=row.copies?.filter(copy=>!copy.sold).length ?? row.quantity;
      return Math.max(0,Math.min(row.quantity,unsold)-held)+' available to pre-order'+(held?' · '+held+' held':'');
    }
    if(row.quantity==null)return 'Stock unset';
    if(!row.quantity)return 'Sold out';
    const physical=row.copies ? row.copies.filter(copy=>!copy.sold).length : row.quantity;
    const available=Math.max(0,Math.min(row.quantity,physical)-held);
    return available+' available'+(held?' · '+held+' held':'');
  }
  function syncInventory(item){
    const model=read(item.id),row=model.row;
    if(!row)return;
    const selector='[data-product-id="'+CSS.escape(item.id)+'"]';
    for(const panel of document.querySelectorAll('.inventory-panel'+selector)){
      panel.querySelector('.inventory-status').textContent=model.remove?'Pending removal':inventoryStatus(row);
      const isPreorder=row.collection==='pre-orders';
      const quantityLabel=panel.querySelector('.inventory-quantity span');
      if(quantityLabel)quantityLabel.textContent=isPreorder?'Pre-order allocation':'Stock on hand';
      const dispatch=panel.querySelector('.inventory-dispatch');
      if(dispatch)dispatch.hidden=!isPreorder;
      const list=panel.querySelector('.inventory-promote');
      if(list)list.hidden=row.collection!=='pre-orders' || !(row.quantity>0) || !!model.remove;
      const undo=panel.querySelector('.inventory-remove');
      if(undo && !model.remove){
        const held=Boolean(row.checkoutHolds?.length);
        undo.disabled=busy() || held;
        if(held)undo.title='Removal is available when active checkouts end.';
      }
    }
    const count=el('inline-stock-count');
    if(count && el('detail').dataset.item===item.id)count.textContent=' · '+inventoryStatus(row);
  }
  function inventoryPanel(item,view) {
    const model=read(item.id),row=model.row;
    const panel=document.createElement('section');
    panel.className='inventory-panel';
    panel.dataset.productId=item.id;
    panel.dataset.inventoryView=view;
    panel.setAttribute('aria-label','Manage '+row.name);
    // Arrow keys on a form control must not advance the showroom carousel.
    panel.addEventListener('keydown',event=>event.stopPropagation());
    const status=document.createElement('span');
    status.className='inventory-status';
    status.textContent=model.remove?'Pending removal':inventoryStatus(row);
    const actions=document.createElement('div');
    actions.className='inventory-actions';
    const remove=document.createElement('button');
    remove.type='button';remove.className='inventory-remove';
    remove.textContent=model.remove?'Undo removal':row.create?'Discard draft':'Remove product';
    remove.setAttribute('aria-label',remove.textContent+' · '+row.name);
    remove.disabled=busy() || (!model.remove && Boolean(row.checkoutHolds?.length));
    if(remove.disabled && row.checkoutHolds?.length)remove.title='Removal is available when active checkouts end.';
    remove.onclick=()=>toggleRemoval(item,view);
    if(model.remove){
      panel.classList.add('pending-removal');
      panel.append(status,remove);return panel;
    }
    const stockLabel=document.createElement('label');
    stockLabel.className='inventory-quantity';
    const stock=control(item,'quantity','Stock quantity for '+row.name,row.quantity,{numeric:'stock',max:8,placeholder:'Unset'});
    const quantityCaption=document.createElement('span');
    quantityCaption.textContent=row.collection==='pre-orders'?'Pre-order allocation':'Stock on hand';
    stockLabel.append(quantityCaption,stock);
    const dispatchLabel=document.createElement('label');
    dispatchLabel.className='inventory-dispatch';
    dispatchLabel.hidden=row.collection!=='pre-orders';
    const dispatch=control(item,'preorderDispatch','Expected dispatch date for '+row.name,row.preorderDispatch);
    dispatch.type='date';
    dispatchLabel.append('Expected dispatch',dispatch);
    const promote=document.createElement('button');
    promote.type='button';promote.className='inventory-promote';
    promote.textContent='Move to in stock';
    promote.title='Use once the remaining allocation has arrived. The remaining units become stock on hand.';
    promote.hidden=row.collection!=='pre-orders' || !(row.quantity>0);
    promote.disabled=busy();
    promote.onclick=()=>{
      if(busy())return;
      write(item,'collection','','','');
      const select=el('detail').querySelector('[data-shop-field="collection"]');
      if(select && el('detail').dataset.item===item.id)select.value='';
      syncInventory(item);
      stock.focus();
    };
    actions.append(promote,remove);
    panel.append(stockLabel,dispatchLabel,status,actions);
    return panel;
  }
  function syncCopyOption(item,path){
    const [,index,property]=path.split('.');
    const label=el('copy-options').children[index];
    if(!label)return;
    if(property==='condition')label.querySelector('span').textContent=item.copies[index].condition;
    if(property==='cents')label.querySelector('small').textContent=price(item.copies[index].cents);
  }
  function browseFields(item) {
    const row=read(item.id).row;
    const wrap=document.createElement('div');
    wrap.className='browse-edit-fields';
    const add=(path,label,value,settings={})=>{
      const group=document.createElement('label');
      group.append(label,control(item,path,label,value,settings));
      wrap.append(group);
    };
    add('name','Product name',row.name,{required:true,max:100});
    add('format','Format',row.format,{max:100});
    (row.copies || [row]).forEach((copy,index)=>{
      const label=row.copies?copyName(index)+' price (AUD)':'Price (AUD)';
      add(row.copies?'copies.'+index+'.cents':'cents',label,copy.cents==null?'':(copy.cents/100).toFixed(2),{numeric:'price',required:true,max:16});
    });
    return wrap;
  }
  function priceField(item,index=null){
    const row=read(item.id).row;
    const value=index===null?row.cents:row.copies[index].cents;
    const key=index===null?'cents':'copies.'+index+'.cents';
    el('detail-price').replaceChildren('AUD ',control(item,key,'Price in AUD',value==null?'':(value/100).toFixed(2),{numeric:'price',required:true,max:16}));
  }
  function renderCopy(item,index,face){
    const copy=read(item.id).row.copies[index];
    priceField(item,index);
    el('copy-heading').replaceChildren(copyName(index)+' · ',control(item,'copies.'+index+'.condition','Copy condition',copy.condition,{required:true,max:80}));
    el('wear-note').replaceChildren(control(item,'copies.'+index+'.'+face,'Condition notes for '+face,copy[face]?.[0],{multiline:true,max:500,placeholder:'Add condition notes'}));
    const backNote=el('back-wear-note');
    if(!copy.photos?.back && !(index===0 && item.backImage)){
      backNote.hidden=false;
      backNote.replaceChildren(control(item,'copies.'+index+'.back','Back condition notes',copy.back?.[0],{multiline:true,max:500,placeholder:'Add back condition notes'}));
    }
  }
  function renderFacts(item) {
    const row=read(item.id).row,card=row.card||{},dl=el('card-facts');
    const hidden=[];
    const expanded=dl.dataset.item===item.id && dl.dataset.expanded==='true';
    dl.dataset.item=item.id;
    dl.dataset.expanded=String(expanded);
    dl.hidden=false;dl.replaceChildren();
    for(const [key,label,max] of [...cardFields,['productType','Product type',20]]){
      const term=document.createElement('dt'),val=document.createElement('dd');
      term.textContent=label;
      const config=key==='productType'?{options:[['','Choose type'],...productTypes]}:{max,placeholder:label};
      val.append(control(item,'card.'+key,label,card[key],config));
      dl.append(term,val);
      if(!card[key])hidden.push(term,val);
    }
    if(!hidden.length)return;
    const foot=document.createElement('dd'),toggle=document.createElement('button');
    foot.className='field-more';toggle.type='button';
    const setExpanded=open=>{
      hidden.forEach(n=>n.hidden=!open);
      dl.dataset.expanded=String(open);
      toggle.textContent=open?'Fewer details':'+ Collector details';toggle.setAttribute('aria-expanded',String(open));
    };
    toggle.onclick=()=>setExpanded(dl.dataset.expanded!=='true');
    setExpanded(expanded);foot.append(toggle);dl.append(foot);
  }
  function detail(item,defaultAvailability) {
    const row=read(item.id).row;
    const family=el('detail-family');const currency=family.textContent.split(' / ')[1] || 'AUD';
    family.replaceChildren(control(item,'category','Product category',row.category,{required:true}),' / '+currency);
    el('detail-name').replaceChildren(control(item,'name','Product name',row.name,{max:100,required:true,multiline:true}));
    const count=document.createElement('span');count.id='inline-stock-count';
    el('detail-format').replaceChildren(control(item,'format','Product format',row.format,{max:100,placeholder:'Format'}),count);
    count.textContent=' · '+inventoryStatus(row);
    if(!item.copies)priceField(item);
    for(const [id,key,label] of [['detail-description','description','Description'],['detail-notes','notes','Design notes']])
      el(id).replaceChildren(control(item,key,label,row[key],{required:key==='description',multiline:true,placeholder:'Add '+label.toLowerCase()}));
    const availability=control(item,'availability','Availability',row.availability||defaultAvailability,{multiline:true,placeholder:defaultAvailability,defaultText:defaultAvailability});
    const collection=control(item,'collection','Collection',row.collection||'',{options:[['','Main collection'],['recently-added','Recently added'],['pre-orders','Pre-orders']]});
    const settings=document.createElement('span');settings.className='availability-fields';
    for(const [label,input] of [['Collection',collection]]){
      const wrap=document.createElement('label');wrap.append(label,input);settings.append(wrap);
    }
    el('availability').replaceChildren(availability,settings);
    const panel=inventoryPanel(item,'detail');
    panel.id='detail-inventory';
    if(el('detail-inventory'))el('detail-inventory').replaceWith(panel);
    else el('detail').querySelector('.detail-heading').after(panel);
    renderFacts(item);
  }
  return {detail,renderCopy,renderFacts,inventoryPanel,browseFields};
};
