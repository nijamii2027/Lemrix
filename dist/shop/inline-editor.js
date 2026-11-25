// Native form controls take the place of the corresponding shop text in owner edit mode.
window.LemrixInlineEditor = function createInlineEditor({read, write, busy}) {
  const el=id=>document.getElementById(id);
  const categories=['Singles','Packs','Accessories'];
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
    const input=document.createElement(choices?'select':multiline?'textarea':'input');
    input.className='shop-input';
    input.dataset.shopField=path;
    input.setAttribute('aria-label',label);
    if(choices) {
      for(const choice of choices){
        const [key,text]=Array.isArray(choice)?choice:[choice,choice];
        input.add(new Option(text,key));
      }
    }else{
      input.maxLength=max;input.required=required;input.placeholder=placeholder;
      if(numeric)input.inputMode=numeric==='price'?'decimal':'numeric';
      if(multiline)input.rows=1;
    }
    const model=read(item.id);
    input.value=model.inputs?.get(path)??value??'';
    input.disabled=busy();
    const issue=()=>{
      const raw=input.value.trim();
      if(required && !raw)return label+' is required.';
      if(numeric==='price' && (!/^\d+(?:\.\d{0,2})?$/.test(raw) || Number(raw)>9999999.99))return 'Enter an AUD price with up to two decimal places.';
      if(numeric==='stock' && raw && (!/^\d+$/.test(raw) || Number(raw)>1000000))return 'Enter a whole stock quantity of 0–1,000,000.';
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
      if(path==='quantity')showCount(item);
      if(path.startsWith('copies.'))syncCopyOption(item,path);
    };
    input.addEventListener(choices?'change':'input',edit);
    if(multiline)requestAnimationFrame(size);else size();
    return input;
  }
  function showCount(item){
    const count=el('inline-stock-count');
    if(count)count.textContent=Number.isInteger(item.quantity)? (item.quantity?' · '+item.quantity+' in stock':' · Sold out'):'';
  }
  function syncCopyOption(item,path){
    const [,index,property]=path.split('.');
    const label=el('copy-options').children[index];
    if(!label)return;
    if(property==='condition')label.querySelector('span').textContent=item.copies[index].condition;
    if(property==='cents')label.querySelector('small').textContent=price(item.copies[index].cents);
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
    family.replaceChildren(control(item,'category','Product category',row.category,{options:categories}),' / '+currency);
    el('detail-name').replaceChildren(control(item,'name','Product name',row.name,{max:100,required:true,multiline:true}));
    const count=document.createElement('span');count.id='inline-stock-count';
    el('detail-format').replaceChildren(control(item,'format','Product format',row.format,{max:100,placeholder:'Format'}),count);
    count.textContent=Number.isInteger(row.quantity)?(row.quantity?' · '+row.quantity+' in stock':' · Sold out'):'';
    if(!item.copies)priceField(item);
    for(const [id,key,label] of [['detail-description','description','Description'],['detail-notes','notes','Design notes']])
      el(id).replaceChildren(control(item,key,label,row[key],{required:key==='description',multiline:true,placeholder:'Add '+label.toLowerCase()}));
    const availability=control(item,'availability','Availability',row.availability||defaultAvailability,{multiline:true,placeholder:defaultAvailability,defaultText:defaultAvailability});
    const stock=control(item,'quantity','Stock quantity',row.quantity,{numeric:'stock',max:8,placeholder:'Unset'});
    const collection=control(item,'collection','Collection',row.collection||'',{options:[['','Main collection'],['recently-added','Recently added'],['pre-orders','Pre-orders']]});
    const settings=document.createElement('span');settings.className='availability-fields';
    for(const [label,input] of [['Stock quantity',stock],['Collection',collection]]){
      const wrap=document.createElement('label');wrap.append(label,input);settings.append(wrap);
    }
    el('availability').replaceChildren(availability,settings);
    renderFacts(item);
  }
  return {detail,renderCopy,renderFacts};
};
