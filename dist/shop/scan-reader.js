/* Worker-based capture suggestions. All assets and recognition requests stay on this origin. */
(() => {
  'use strict';
  const assets = new URL('ocr/', document.currentScript.src);
  const scripts = new Map(), indexes = new Map();
  const directory = () => Array.isArray(window.LemrixSets) ? window.LemrixSets : [];
  const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g,' ').trim();
  const plainNumber = n => String(n).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/,'$1');
  const clean = value => String(value || '').normalize('NFKC').replace(/[\u0000-\u0008]/g,'').slice(0,18000);
  const neat = text => text.replace(/\s+/g,' ').trim();
  const titleCase = text => text===text.toUpperCase() ? text.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()).replace(/\bEx\b/g,'ex') : text;
  const words = value => ' '+normalize(value)+' ';
  const first = (text,expression) => expression.exec(text)?.[1];
  const promoSeries = {SM:'Sun & Moon',XY:'XY',SWSH:'Sword & Shield',SV:'Scarlet & Violet',BW:'Black & White'};
  const qrHost = /^(?:www\.)?psacard\.com$/i;
  function certificateFromQR(value) {
    try {
      const url=new URL(value);
      return url.protocol==='https:' && qrHost.test(url.hostname) ?
        first(url.pathname,/^\/cert\/(\d{6,12})(?:\/|$)/i) : undefined;
    } catch { return undefined; }
  }
  function languageOf(text) {
    if (/\b(?:JPN|JAPANESE|JAPAN)\b|日本語/i.test(text)) return 'Japanese';
    if (/\b(?:ENGLISH|ENG)\b/i.test(text)) return 'English';
    if (/ポケモン|エネルギー|たねポケモン|ワザ|トレーナーズ|にげる|弱点|相手の|自分の|拡張パック|強化拡張|ブースターパック/.test(text)) return 'Japanese';
    if (/\b(?:weakness|retreat|stage [12]|basic energy|discard pile|your opponent|booster (?:pack|box|bundle)|elite trainer box)\b/i.test(text)) return 'English';
    return '';
  }

  // A number is evidence only in collector-number syntax, not any number on a card.
  function collector(text,slab) {
    const fraction=text.match(/(?:^|[^A-Za-z0-9])((?:[A-Z]{1,4})?\d{1,4}[a-z]?)\s*[/／]\s*((?:[A-Z]{1,4})?\d{1,4}|(?:SM|SV|XY|S|DP|BW|M)-?P)(?![A-Za-z\d])/i);
    if(fraction && !(Number(fraction[2])>=1900 && Number(fraction[2])<=2099))
      return fraction[1].toUpperCase()+'/'+fraction[2].toUpperCase();
    const numbered=first(text,/(?:#|№|No\.\s*)\s*([a-z]{0,4}\d{1,4}[a-z]?)(?![a-z\d])/i);
    if(numbered) return numbered.toUpperCase();
    if(!slab) return first(text,/\b((?:SWSH|SVP|SM|XY|BW)\d{2,3})\b/i)?.toUpperCase();
  }
  function findSet(text,language) {
    const input=words(text);
    const hits=[];
    for(const entry of directory()) {
      if(language && entry.language && entry.language!==language)continue;
      const aliases=[entry.name,...(entry.aliases||[])].filter(Boolean);
      if(entry.code?.length>=3 && !/^(?:base|promo)$/i.test(entry.code)) aliases.push(entry.code);
      let best=0;
      for(const alias of aliases){
        const candidate=normalize(alias);
        if(candidate.length<3 || /^(?:base|promo|jungle|rocket|151)$/.test(candidate))continue;
        if(input.includes(' '+candidate+' ') || (/[\u3040-\u30ff\u4e00-\u9fff]/.test(alias) && text.includes(alias))) best=Math.max(best,candidate.length);
      }
      if(best)hits.push({entry,score:best});
    }
    // Modern packs print both an era and its expansion. The era's name is also
    // the base set's name, so prefer a named expansion from that same era.
    const candidates=hits.filter(({entry})=> normalize(entry.name)!==normalize(entry.series) ||
      !hits.some(other=>other.entry!==entry && other.entry.language===entry.language &&
        other.entry.series===entry.series && normalize(other.entry.name)!==normalize(entry.series)));
    candidates.sort((a,b)=>b.score-a.score);
    if(candidates[0] && (!candidates[1] || candidates[0].score>candidates[1].score ||
      candidates[1].entry.name===candidates[0].entry.name))return candidates[0].entry;
    return null;
  }
  function parseText(frontText='',backText='',hints={}) {
    const front=clean(frontText), back=clean(backText);
    const header=clean(hints.header || front), text=[front,back].filter(Boolean).join('\n');
    const fields={}, notices=[];
    const packageLabel=front.match(/\b(?:elite trainer box|booster (?:box(?:es)?|bundle|display)|blister pack|display box|trainer.s toolkit|collection box|collector.s tin|mini tin)\b/i) ||
      front.match(/\b(booster pack)s?\b/i);
    const localBox=/プレミアムトレーナーボックス|デッキビルド[ ]*BOX|ブースター[ ]*BOX/i.test(front);
    const localPack=/強化拡張パック|拡張パック|ブースターパック/.test(front);
    const packFormat=packageLabel ? titleCase((packageLabel[1] || packageLabel[0]).toUpperCase()) :
      localBox ? 'Box' : localPack ? 'Booster Pack' : '';
    const grader=first(header+' '+back,/\b(PSA|CGC|BGS|SGC|ARK|BECKETT)\b/i)?.toUpperCase();
    const gradeWords=/\b(?:GEM\s*(?:MT|MINT)|(?:NEAR\s+)?MINT|PRISTINE|NM-MT|NM\s+MT|EX-MT)\b/i;
    const labelGrade=gradeWords.test(header);
    const isSlab=Boolean(grader || hints.qrCertificate || (hints.redLabel && (labelGrade || /\b(?:19|20)\d{2}\b/.test(header))) ||
      (labelGrade && /(?:#\d{1,4}|\b\d{8,10}\b)/.test(header)));
    const lang=languageOf(header)||languageOf(front);
    if(lang)fields.language=lang;
    const number=collector(header,isSlab)||collector(front,isSlab);
    if(number)fields.cardNumber=number;
    if(isSlab){
      fields.category='Singles';fields.format='Graded card';
      if(grader)fields.grader=grader==='BECKETT'?'BGS':grader;
      else if(hints.qrCertificate || (hints.redLabel && labelGrade && /\b\d{7,10}\b/.test(header+' '+back)))fields.grader='PSA';
      const inlineGrade=first(header,/(?:\b(?:PSA|CGC|BGS|SGC|ARK|GEM\s*MT|GEM\s*MINT|MINT|PRISTINE|NM-MT|NM\s+MT|EX-MT))\s*[:\-]?\s*(10|[1-9](?:\.5)?)(?![.\d])/i);
      // A PSA grade often occupies the right column on the row below MINT.
      const lineGrade=hints.redLabel && first(header,/\b(?:MINT|GEM\s*MT|NM-MT|EX-MT)[ \t]*\n[^\n#]{0,64}?[ \t]+(10|[1-9](?:\.5)?)[ \t]*(?:\n|$)/i);
      const grade=inlineGrade || hints.grade || lineGrade;
      if(grade && /^(?:10|[1-9](?:\.5)?)$/.test(grade))fields.grade=String(grade);
      const frontCert=first(header,/\b(\d{7,10})\b/), backCert=first(back,/\b(\d{7,10})\b/);
      const certs=[...new Set([hints.qrCertificate,frontCert,backCert].filter(Boolean))];
      if(certs.length===1 && fields.grader)fields.certificate=certs[0];
      if(certs.length>1)notices.push('The certificate readings disagree. Compare the two photos before entering it.');
      const lines=header.split('\n').map(neat).filter(Boolean);
      const yr=lines.findIndex(l=>/\b(?:19|20)\d{2}\b/.test(l) && /[A-Za-z]{2}/.test(l));
      if(yr>=0){
        const printedYear=first(lines[yr],/^((?:19|20)\d{2})\b/);
        if(printedYear)fields.year=printedYear;
        for(const candidate of lines.slice(yr+1,yr+4)){
          let name=candidate.replace(/\s+(?:GEM\s*(?:MT|MINT)|PRISTINE|MINT|NM-MT|EX-MT|#\s*\d+).*$/i,'').trim();
          if(/^[A-Za-z\u3040-\u30ff\u3400-\u9fff][A-Za-zÀ-ž\u3040-\u30ff\u3400-\u9fff0-9 '\u2019.\-:]{1,42}$/.test(name) &&
            !gradeWords.test(name) && !/^(?:PSA|PROMO|POKEMON|TRAINER|HOLO|MUNCH:|GEM)\b/i.test(name)){
            fields.name=titleCase(name);break;
          }
        }
      }
    }else if(packFormat){
      fields.category='Packs';fields.format=packFormat;
    }else if(number || /\b(?:HP\s*\d{2,3}|\d{2,3}\s*HP|retreat cost|weakness)\b|にげる|弱点/i.test(front)){
      fields.category='Singles';fields.format='Raw card';
    }else if(/\b(?:binder|deck sleeves|card sleeves|deck box)\b/i.test(front)) {
      fields.category='Accessories';fields.format=titleCase(front.match(/\b(?:binder|deck sleeves|card sleeves|deck box)\b/i)[0].toUpperCase());
    }
    const set=findSet(header+'\n'+front,lang);
    if(set) { fields.set=set.name;fields.series=set.series; }
    else if(isSlab){
      const promo=first(header,/\b(SM|XY|SWSH|SV|BW)[. ]+(?:BLACK STAR )?PROMOS?\b/i)?.toUpperCase();
      if(promo){fields.set=promo+' Promo';fields.series=promoSeries[promo];}
    }
    if(fields.category==='Packs' && fields.set) fields.name=fields.set+' '+fields.format;
    return {fields,text,warning:notices.join(' ')};
  }

  function printingName(text,name){
    const normalized=normalize(name);
    return normalized.length>=2 && (text.includes(' '+normalized+' ') ||
      (/[\u3040-\u30ff\u4e00-\u9fff]/.test(normalized) && text.replace(/ /g,'').includes(normalized.replace(/ /g,''))));
  }
  async function getIndex(lang){
    if(!indexes.has(lang)){
      const task=fetch(new URL(lang+'-printings.idx',assets)).then(async response=>{
        if(!response.ok)throw Error('Reference unavailable.');
        const groups=await response.json(),index=new Map();
        for(const [set,items] of Object.entries(groups))for(const [num,name] of items){
          const n=plainNumber(num);
          if(!index.has(n))index.set(n,[]);
          index.get(n).push({set,num,name});
        }
        return index;
      }).catch(error=>{indexes.delete(lang);throw error;});
      indexes.set(lang,task);
    }
    return indexes.get(lang);
  }
  async function matchPrinting(result) {
    const f=result.fields;
    if(f.category!=='Singles' || !f.cardNumber)return;
    const [num,denom]=f.cardNumber.split('/');
    const options=f.language==='English'?['en']:f.language==='Japanese'?['ja']:['en','ja'];
    const text=words([f.name,result.text].filter(Boolean).join(' '));
    const matches=[];
    for(const lang of options){
      const language=lang==='ja'?'Japanese':'English';
      const catalogue=await getIndex(lang);
      const rows=catalogue.get(plainNumber(num))||[];
      for(const row of rows){
        const set=directory().find(s=>s.id===row.set && s.language===language);
        const sameSet=Boolean(f.set && set && normalize(set.name)===normalize(f.set));
        if(f.set && !sameSet)continue;
        // A printed set code and collector number identify a printing even on a foil
        // whose title cannot be read through glare. A number alone never suffices.
        if(!sameSet && !printingName(text,row.name))continue;
        const printed=set?.printedTotal ?? set?.official;
        if(denom && /^\d+$/.test(denom) && printed && Number(denom)!==Number(printed))continue;
        matches.push({...row,language,entry:set});
      }
    }
    if(matches.length!==1)return;
    const match=matches[0];
    f.name=match.name; f.language=match.language;
    if(match.entry){f.set=match.entry.name;f.series=match.entry.series;}
  }

  function loadScript(file) {
    if(!scripts.has(file)) scripts.set(file,new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL(file,assets);script.async=true;
      script.onload=resolve;
      script.onerror=()=>{scripts.delete(file);script.remove();reject(Error('Scan tools could not load.'));};
      document.head.append(script);
    }));
    return scripts.get(file);
  }
  let engine,engineTask,generation=0,idleTimer,activeAbort;
  async function worker() {
    if(!engineTask){
      const token=generation;
      engineTask=(async()=>{
        await loadScript('tesseract.min.js');
        if(token!==generation)throw Error('Capture changed.');
        const w=await Tesseract.createWorker('eng+jpn',1,{
          workerPath:new URL('worker.min.js',assets).href,workerBlobURL:false,
          corePath:new URL('tesseract-core-lstm.js',assets).href,langPath:assets.href,
          cacheMethod:'none',errorHandler:()=>{}
        });
        if(token!==generation){await w.terminate();throw Error('Capture changed.');}
        engine=w;
        await w.setParameters({tessedit_pageseg_mode:'11',user_defined_dpi:'300'});
        return w;
      })().catch(e=>{if(generation===token)engineTask=null;throw e;});
    }
    return engineTask;
  }
  function release() {
    clearTimeout(idleTimer);generation++;
    if(engine)engine.terminate().catch(()=>{});
    engine=null;engineTask=null;
  }
  function cancel() {
    activeAbort?.();activeAbort=null;release();
  }
  function patch(image,x=0,y=0,w=1,h=1,target=900,scaleLimit=3) {
    const sw=Math.max(1,Math.round(w*image.width)),sh=Math.max(1,Math.round(h*image.height));
    const scale=Math.min(target/Math.max(sw,sh),scaleLimit);
    const result=document.createElement('canvas');
    result.width=Math.max(1,Math.round(sw*scale));result.height=Math.max(1,Math.round(sh*scale));
    const ctx=result.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,result.width,result.height);
    ctx.drawImage(image,Math.round(x*image.width),Math.round(y*image.height),sw,sh,0,0,result.width,result.height);
    return result;
  }
  function redLabel(image) {
    const cap=patch(image,0,0,1,.34,440,1);
    const data=cap.getContext('2d').getImageData(0,0,cap.width,cap.height).data;
    const groups=[];let band;
    for(let y=0;y<cap.height;y++){
      let left=cap.width,right=-1,count=0;
      for(let x=0;x<cap.width;x++){
        const i=4*(y*cap.width+x),r=data[i],g=data[i+1],b=data[i+2];
        if(r>100 && r>1.55*g && r>1.43*b){left=Math.min(left,x);right=x;count++;}
      }
      if(count>cap.width*.40 && right-left>cap.width*.53){
        if(!band || band.end!==y-1){band={start:y,end:y,left,right};groups.push(band);}
        else {band.end=y;band.left=Math.min(band.left,left);band.right=Math.max(band.right,right);}
      }
    }
    for(let i=0;i<groups.length-1;i++)for(let j=i+1;j<groups.length;j++){
      const top=groups[i],bottom=groups[j];
      const w=(top.right-top.left)/cap.width, h=(bottom.start-top.end)/cap.height*.34;
      if(h<.065 || h>.22 || Math.abs(bottom.left-top.left)>cap.width*.16)continue;
      return {x:top.left/cap.width+w*.025,y:top.end/cap.height*.34,w:w*.95,h};
    }
    return null;
  }
  async function detectQR(image){
    if(!image)return;
    await loadScript('jsQR.js');
    const head=patch(image,0,0,1,.32,800,2);
    const pixels=head.getContext('2d').getImageData(0,0,head.width,head.height);
    return certificateFromQR(window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'})?.data);
  }
  async function scan(front,back,token){
    const label=redLabel(front);
    const ensureCurrent=()=>{if(token!==generation)throw Error('Capture changed.');};
    const qrTask=detectQR(back).catch(()=>undefined);
    const w=await worker();
    let header='',body='',rear='',grade;
    async function readPatch(canvas,psm='11',onlyDigits=false){
      ensureCurrent();
      await w.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:onlyDigits?'0123456789.':''});
      ensureCurrent();
      const data=await w.recognize(canvas);
      return clean(data.data.text);
    }
    if(label) {
      const {x,y,w:width,h}=label;
      header=await readPatch(patch(front,x,y,width,h,1180,4),'6');
      const digit=await readPatch(patch(front,x+width*.89,y+h*.44,width*.11,h*.355,200,5),'7',true);
      if(/^(10|[1-9](?:\.5)?)$/.test(digit.trim()))grade=digit.trim();
    } else {
      header=await readPatch(patch(front,0,0,1,.28,1150),'11');
      body=await readPatch(patch(front,0,0,1,1,1250),'11');
      const lower=await readPatch(patch(front,0,.78,1,.22,1180),'11');
      body+='\n'+lower;
    }
    if(back)rear=await readPatch(patch(back,0,0,1,.24,1100),'11');
    const qrCertificate=await qrTask;
    const result=parseText(header+'\n'+body,rear,{header,grade,redLabel:Boolean(label),qrCertificate});
    try { await matchPrinting(result); } catch {}
    ensureCurrent();
    if(!Object.keys(result.fields).length)result.warning='No clear label was found. Retake the photo or enter its details.';
    return result;
  }
  async function read(front,back) {
    if(!front?.width || !front.height)return {fields:{},text:'',warning:'Capture the front first.'};
    if(activeAbort)cancel();
    clearTimeout(idleTimer);
    const token=generation;
    let timeout;
    const interrupted=new Promise((_,reject)=>{activeAbort=()=>reject(Error('Capture changed.'));});
    const limit=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Scanning took too long.')),55000);});
    try { return await Promise.race([scan(front,back,token),limit,interrupted]); }
    catch(error) {
      if(token!==generation)return {fields:{},text:'',cancelled:true};
      release();
      return {fields:{},text:'',warning:'Photo recognition is unavailable for this capture. Retake it or enter the details.'};
    } finally {
      clearTimeout(timeout);
      if(token===generation){activeAbort=null;idleTimer=setTimeout(release,120000);}
      else if(!engineTask)activeAbort=null;
    }
  }
  window.addEventListener('pagehide',cancel);
  window.LemrixScan=Object.freeze({read,parseText,cancel});
})();
