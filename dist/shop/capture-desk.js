window.LemrixCapture = function createDesk(form) {
  const id=s=>document.getElementById(s);
  const field=s=>form.elements.namedItem(s);
  const names=['set','series','cardNumber','language','grader','grade','certificate','year','itemCondition','productType'];
  const groups={card:'Singles',slab:'Singles',pack:'Packs',box:'Packs',accessory:'Accessories'};
  const thumbs=[...form.querySelectorAll('[data-capture]')];
  const key=face=>copy+':'+face;
  const entries=new Map(), incoming=new Map(), suggested=new Map();
  const directory=()=>window.LemrixSets||[];
  let kindWasSet=false,cameraGeneration=0,correction,previewing=false,shutterBusy=false;
  let item,copy=0,side='front',epoch=0,scanEpoch=0,loading=0,stream,cleanup,changed,scanTimer;
  function tell(value){id('capture-hint').textContent=value;}
  function stop() {
    cameraGeneration++;
    stream?.getTracks().forEach(track=>track.stop());
    stream=null;id('desk-video').srcObject=null;id('live-capture').hidden=true;
  }
  window.addEventListener('pagehide',stop);
  function discard(entry){
    entry?.prepared?.release();
    if(entry?.url)URL.revokeObjectURL(entry.url);
  }
  function reset(){
    epoch++;scanEpoch++;window.LemrixScan?.cancel();loading=0;clearTimeout(scanTimer);stop();cleanup?.();cleanup=null;
    entries.forEach(discard);entries.clear();incoming.clear();suggested.clear();correction=null;previewing=false;shutterBusy=false;
  }
  function open(row,markDirty,copyIndex=0,face='front') {
    reset();item=row;kindWasSet=!!row;changed=markDirty;copy=row?.copies?.[copyIndex]?copyIndex:0;side=face==='back'?'back':'front';
    for (const n of ['category', ...names].filter(window.LemrixTaxonomy.has)) {
      window.LemrixTaxonomy.attach(field(n), n, n === 'category' ? (row?.category || 'Singles') : row?.card?.[n]);
    }
    for(const n of names.filter(name=>!window.LemrixTaxonomy.has(name)))field(n).value=row?.card?.[n] || (n==='productType'? (row?.category==='Packs'?'pack':row?.category==='Accessories'?'accessory':'card'):'');
    if(!row)field('quantity').value='1';
    const select=id('capture-copy');
    select.replaceChildren(...(row?.copies||[]).map((c,i)=>new Option('Copy '+String.fromCharCode(65+i)+' · '+c.condition,i)));
    if(row?.copies)select.value=String(copy);
    id('capture-copy-wrap').hidden=!row?.copies;
    tell('Photograph the product upright against a plain, contrasting mat. Keep all four edges in frame.');
    paint();
  }
  function previous(face){
    if(item?.copies){const c=item.copies[copy];if(c?.photos?.[face])return c.photos[face];if(copy!==0)return '';}
    return face==='front'?(item?.image || (item?'/shop/art/'+item.id+'.webp':'')):item?.backImage;
  }
  function paint(){
    for (const b of thumbs){
      const face=b.dataset.capture,img=b.querySelector('img'),src=entries.get(key(face))?.url || previous(face);
      b.setAttribute('aria-pressed',String(face===side));
      if(src){if(img.getAttribute('src')!==src)img.src=src;}else img.removeAttribute('src');
      img.hidden=!src;
    }
    const cur=entries.get(key(side));
    id('crop-review').hidden=!cur?.prepared;
    id('read-label').hidden=!entries.get(key('front'))?.prepared;
    id('desk-shutter').textContent='Capture '+side;id('desk-shutter').disabled=shutterBusy;
    if(cur!==correction){
      cleanup?.();cleanup=null;correction=cur;previewing=false;
      if(cur?.prepared)cleanup=window.LemrixPhoto.mountCorrection(id('crop-corners'),cur.prepared,()=>refreshPhoto(cur));
    }
    const result=id('crop-proof');
    if(cur?.url && result.getAttribute('src')!==cur.url)result.src=cur.url;
    if(!cur?.url)result.removeAttribute('src');
    id('crop-corners').hidden=previewing;result.hidden=!previewing;
    id('crop-preview-toggle').textContent=previewing?'Adjust crop':'Preview result';
    id('crop-preview-toggle').setAttribute('aria-pressed',String(previewing));
    if(cur?.prepared){
      id('desk-balance').checked=cur.balance;
    }
  }
  const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare the image.')),'image/jpeg',.94));
  async function refreshPhoto(entry){
    const seq=++entry.seq,at=epoch;loading++;changed();
    entry.blob=null;
    try{
      // Consecutive keyboard nudges or rotations only export the last pose.
      await new Promise(resolve=>setTimeout(resolve,65));
      if(at!==epoch || seq!==entry.seq || entries.get(entry.slot)!==entry)return;
      const blob=await entry.prepared.proof(entry.rotation,entry.balance);
      if(at!==epoch || seq!==entry.seq || entries.get(entry.slot)!==entry)return;
      const oldUrl=entry.url;
      entry.blob=blob;entry.url=URL.createObjectURL(blob);paint();
      if(oldUrl)URL.revokeObjectURL(oldUrl);
    }catch(e){if(at===epoch && seq===entry.seq && entries.get(entry.slot)===entry)tell(e.message);}
    finally{if(at===epoch)loading--;}
  }
  async function ingest(file,fromCamera=false,face=side){
    if(!file)return;
    const at=epoch,slot=key(face);
    const entry={slot,prepared:null,url:null,blob:null,rotation:0,balance:false,seq:0};
    incoming.set(slot,entry);loading++;changed();scanEpoch++;clearTimeout(scanTimer);
    tell('Finding the product edges…');
    try{
      const kind=kindWasSet?field('productType').value:'auto';
      entry.prepared=await window.LemrixPhoto.openPhoto(file,kind==='pack'?'box':kind);
      if(epoch!==at || incoming.get(slot)!==entry)return;
      entry.blob=await entry.prepared.proof(0,false);
      if(epoch!==at || incoming.get(slot)!==entry)return;
      entry.url=URL.createObjectURL(entry.blob);
      const previousEntry=entries.get(slot);
      entries.set(slot,entry);
      if(fromCamera && side===face && face==='front')side='back';
      paint();discard(previousEntry);
      tell(fromCamera && side==='back' && face==='front'?'Front ready. Capture the back.':
        entry.prepared.confidence<.55?'Check the four crop corners before saving.':'Photo ready. Adjust the corners if needed.');
      if(!item)scanTimer=setTimeout(readLabel,450);
    }catch(e){if(at===epoch && incoming.get(slot)===entry)tell(e.message||'Could not read this photo.');}
    finally{
      if(entries.get(slot)!==entry)discard(entry);
      if(at===epoch){if(incoming.get(slot)===entry)incoming.delete(slot);loading--;}
    }
  }
  function applySuggestions(fields,before) {
    const accepted=[];
    for(const [n,raw] of Object.entries(fields||{})) {
      if(kindWasSet && (n==='productType'||n==='category'))continue;
      if(!raw||!['name','category','format',...names].includes(n))continue;
      const input=field(n),value=String(raw);
      if(!input||input.value!==before[n])continue;
      const provisional=n==='category'&&input.value==='Singles' || n==='productType'&&input.value==='card';
      if(input.value && input.value!==suggested.get(n) && !(provisional && !item))continue;
      if(window.LemrixTaxonomy.has(n))window.LemrixTaxonomy.selectValue(input,value);
      else {
        if(input.tagName==='SELECT' && ![...input.options].some(o=>o.value===value))continue;
        input.value=value.slice(0,input.maxLength>0?input.maxLength:180);
      }
      suggested.set(n,input.value);accepted.push(n);
    }
    if (fields?.grader && !kindWasSet && (!item && field('productType').value==='card')) field('productType').value='slab';
    if (fields?.category==='Packs' && !kindWasSet && !item && field('productType').value==='card')field('productType').value=/box|tin|bundle/i.test(fields.format||'')?'box':'pack';
    return accepted;
  }
  async function readLabel() {
    const front=entries.get(key('front')),back=entries.get(key('back'));
    if(item || !front?.prepared)return;
    const version=++scanEpoch,copyAt=copy;
    const before=Object.fromEntries(['name','category','format',...names].map(n=>[n,field(n).value]));
    const object=entry=>entry?.prepared?.forLabel(entry.rotation) || null;
    try {
      tell('Reading the label on this device. You can keep editing.');
      const photos=await Promise.all([object(front),object(back)]);
      if(version!==scanEpoch||copy!==copyAt)return;
      const result=await window.LemrixScan.read(...photos);
      if(version!==scanEpoch||copy!==copyAt)return;
      if(result.cancelled)return;
      if(result.warning?.includes('certificate readings disagree') && suggested.has('certificate') && field('certificate').value===suggested.get('certificate')){
        field('certificate').value='';suggested.delete('certificate');changed();
      }
      const accepted=applySuggestions(result.fields,before);
      if(accepted.length)changed();
      tell(result.warning || (accepted.length?'Suggested details are filled in. Compare them with the label before saving.':'Check the label and fill in any missing details.'));
    }catch{if(version===scanEpoch)tell('The label could not be read. You can enter the details below.');}
  }
  async function startCamera(preferredDevice){
    const at=epoch;
    if(!navigator.mediaDevices?.getUserMedia) {id('desk-mobile').click();return;}
    stop();
    const requestNumber=cameraGeneration;
    try{
      const device=preferredDevice?{deviceId:{exact:preferredDevice}}:{facingMode:{ideal:'environment'}};
      const feed=await navigator.mediaDevices.getUserMedia({audio:false,video:{...device,width:{ideal:2560},height:{ideal:1920}}});
      if(at!==epoch || requestNumber!==cameraGeneration){feed.getTracks().forEach(t=>t.stop());return;}
      stream=feed;const video=id('desk-video');video.srcObject=stream;id('live-capture').hidden=false;await video.play();paint();
      const cameras=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
      if(requestNumber!==cameraGeneration)return;
      const choices=cameras.filter(d=>d.kind==='videoinput'&&d.deviceId),picker=id('desk-camera');
      picker.replaceChildren(...choices.map((d,i)=>new Option(d.label||'Camera '+(i+1),d.deviceId)));
      picker.value=feed.getVideoTracks()[0]?.getSettings().deviceId||'';
      id('camera-picker').hidden=choices.length<2;
    }catch(e){if(at===epoch && requestNumber===cameraGeneration){stop();tell('Camera unavailable. Upload a photo, or use your device camera.');id('mobile-pick').hidden=false;}}
  }
  id('capture-copy').onchange=e=>{scanEpoch++;copy=Number(e.target.value);side='front';paint();};
  thumbs.forEach(b=>b.onclick=()=>{side=b.dataset.capture;paint();});
  id('camera-start').onclick=()=>startCamera();id('desk-camera').onchange=e=>startCamera(e.target.value);id('camera-stop').onclick=stop;
  id('desk-shutter').onclick=async()=>{
    const v=id('desk-video');if(!v.videoWidth||shutterBusy)return;
    shutterBusy=true;id('desk-shutter').disabled=true;
    const at=epoch,face=side;
    try{
      const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
      c.getContext('2d').drawImage(v,0,0);
      const blob=await toBlob(c);if(at===epoch)await ingest(blob,true,face);
    }
    catch(e){if(at===epoch)tell(e.message);}
    finally{if(at===epoch){shutterBusy=false;id('desk-shutter').disabled=false;}}
  };
  id('desk-upload').onclick=()=>id('desk-file').click();id('mobile-pick').onclick=()=>id('desk-mobile').click();
  for(const name of ['desk-file','desk-mobile'])id(name).onchange=e=>{const file=e.target.files[0];e.target.value='';ingest(file,name==='desk-mobile');};
  id('crop-preview-toggle').onclick=()=>{previewing=!previewing;paint();};
  id('desk-balance').onchange=e=>{const entry=entries.get(key(side));if(entry){entry.balance=e.target.checked;refreshPhoto(entry);}};
  id('desk-rotate').onclick=()=>{const entry=entries.get(key(side));if(entry){entry.rotation=(entry.rotation+1)%4;refreshPhoto(entry).then(readLabel);}};
  id('read-label').onclick=readLabel;
  field('productType').onchange=()=>{kindWasSet=true;window.LemrixTaxonomy.selectValue(field('category'),groups[field('productType').value]);};
  field('set').addEventListener('change',()=>{const match=directory().find(s=>s.name===field('set').value && (!field('language').value||s.language===field('language').value));if(match)window.LemrixTaxonomy.selectValue(field('series'),match.series);});
  function validate(){
    if(loading || [...entries.values()].some(v=>!v.blob))return 'Wait for the crop to finish or replace the unreadable photo.';
    if(item && !entries.size)return 'Choose a photo to save.';
    if(!item && !entries.has('0:front'))return 'Add a front photo first.';
    if(!item && ['card','slab'].includes(field('productType').value) && !entries.has('0:back'))return 'Add the back photo for this card.';
    return '';
  }
  async function save(row,upload){
    const card=Object.fromEntries(names.map(n=>[n,field(n).value.trim()]));
    const photos=row.copies?.map(c=>({...c.photos}));
    for(const [key,entry] of entries){
      const [index,face]=key.split(':');
      entry.uploaded=entry.uploaded?.blob===entry.blob?entry.uploaded:{blob:entry.blob,path:(await upload(entry.blob)).image};
      const path=entry.uploaded.path;
      if(photos)photos[Number(index)][face]=path;
      if(Number(index)===0){if(face==='front')row.image=path;else row.backImage=path;}
    }
    if(!item)row.card=card;
    if(photos)row.copies=row.copies.map((c,i)=>({...c,photos:photos[i]}));
    return {card,backImage:row.backImage,copyPhotos:photos};
  }
  return {open,reset,validate,save};
};
