// Capture stays on the device. The neutral mat is added around the photographed
// object, without retouching its surface, printed colours or condition marks.
globalThis.LemrixPhoto = (() => {
  'use strict';
  const MAT = '#eff1f3';
  const inWorker=typeof document==='undefined';
  const scriptUrl=inWorker?null:document.currentScript?.src;
  const limit = (n,a,b) => Math.max(a,Math.min(b,n));
  const length = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const rectangle = (l,t,r,b) => [{x:l,y:t},{x:r,y:t},{x:r,y:b},{x:l,y:b}];
  const area = ps => Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p.x*q.y-p.y*q.x;},0))*.5;
  function canvas(w,h) {
    if(inWorker)return new OffscreenCanvas(Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));
    return c;
  }
  function median(values) {
    values.sort((a,b)=>a-b);
    return values[values.length>>1];
  }
  function sampleCorner(data,w,h,fx,fy) {
    const colors=[[],[],[]], noise=[];
    const dx=Math.max(3,Math.floor(w*.047)),dy=Math.max(3,Math.floor(h*.047));
    const cx=Math.round(fx*(w-1)),cy=Math.round(fy*(h-1));
    for(let y=Math.max(0,cy-dy);y<=Math.min(h-1,cy+dy);y+=2)
      for(let x=Math.max(0,cx-dx);x<=Math.min(w-1,cx+dx);x+=2) {
        const i=(y*w+x)*4;
        for(let c=0;c<3;c++)colors[c].push(data[i+c]);
      }
    const rgb=colors.map(median);
    for(let c=0;c<3;c++) for(const v of colors[c])noise.push(Math.abs(v-rgb[c]));
    return {rgb,mad:median(noise)};
  }
  function convexHull(points) {
    const sorted=points.sort((a,b)=>a.x-b.x || a.y-b.y);
    const half=ordered=>{
      const h=[];
      for(const p of ordered){
        while(h.length>1 && cross(h[h.length-2],h[h.length-1],p)<=0)h.pop();
        h.push(p);
      }
      return h.slice(0,-1);
    };
    return half(sorted).concat(half(sorted.reverse()));
  }
  function fourSides(hull,boundary) {
    const q=hull.slice();
    while(q.length>4){
      let cheapest=0,best=Infinity;
      for(let i=0;i<q.length;i++){
        const cost=Math.abs(cross(q[(i+q.length-1)%q.length],q[i],q[(i+1)%q.length]));
        if(cost<best){best=cost;cheapest=i;}
      }
      q.splice(cheapest,1);
    }
    if(q.length!==4)return null;
    // Fit sides using the long straight runs, so rounded slab corners do not
    // pull the four intersections inward.
    const lines=q.map((p,i)=>{
      const end=q[(i+1)%4],len=length(p,end),dx=(end.x-p.x)/len,dy=(end.y-p.y)/len;
      const band=Math.max(2.8,Math.min(10,len*.045)), samples=[];
      for(const b of boundary){
        const x=b.x-p.x,y=b.y-p.y,t=x*dx+y*dy,n=y*dx-x*dy;
        if(t>len*.12 && t<len*.88 && Math.abs(n)<band)samples.push([t,n]);
      }
      let m=0,k=0;
      if(samples.length>=8){
        k=median(samples.map(s=>s[1]));
        for(let step=0;step<2;step++){
          let sumT=0,sumN=0,sumTN=0,sumTT=0,count=0;
          for(const [t,n] of samples){
            if(Math.abs(n-(k+m*t))>Math.max(1.5,band*(step?.30:.65)))continue;
            sumT+=t;sumN+=n;sumTN+=t*n;sumTT+=t*t;count++;
          }
          const den=count*sumTT-sumT*sumT;
          if(count>=6 && den>0){m=(count*sumTN-sumT*sumN)/den;k=(sumN-m*sumT)/count;}
        }
      }
      return {x:p.x-dy*k,y:p.y+dx*k,dx:dx-dy*m,dy:dy+dx*m};
    });
    const fitted=q.map((p,i)=>{
      const a=lines[(i+3)%4],b=lines[i],det=a.dx*b.dy-a.dy*b.dx;
      if(Math.abs(det)<.16)return p;
      const u=((b.x-a.x)*b.dy-(b.y-a.y)*b.dx)/det;
      const hit={x:a.x+u*a.dx,y:a.y+u*a.dy};
      return length(hit,p)<Math.max(18,length(p,q[(i+1)%4])*.13)?hit:p;
    });
    // The side whose midpoint is highest is the top of the photographed object.
    const top=fitted.reduce((best,p,i)=>
      p.y+fitted[(i+1)%4].y<fitted[best].y+fitted[(best+1)%4].y?i:best,0);
    return fitted.map((_,i)=>fitted[(i+top)%4]);
  }
  function detect(image,kind) {
    const {width:w,height:h,data}=image;
    const total=w*h;
    const fallback=()=>({kind,confidence:.12,corners:rectangle(0,0,1,1),outline:null});
    if(w<20 || h<20)return fallback();
    const bg=[sampleCorner(data,w,h,.05,.05),sampleCorner(data,w,h,.95,.05),
      sampleCorner(data,w,h,.05,.95),sampleCorner(data,w,h,.95,.95)];
    const noise=median(bg.map(c=>c.mad));
    // A corner of an off-centre product may enter just one sampling patch.
    // Replace that outlier if the other three agree on the backdrop.
    const dist=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
    for(let j=0;j<4;j++) {
      const other=bg.filter((_,i)=>i!==j).map(s=>s.rgb);
      const center=[0,1,2].map(c=>median(other.map(rgb=>rgb[c])));
      if(Math.max(...other.map(rgb=>dist(rgb,center)))<28 && dist(bg[j].rgb,center)>65)
        bg[j]={rgb:center,mad:noise};
    }
    const threshold=limit(10+4*noise,10,39);
    const foreground=new Uint8Array(total);
    const rgb=bg.map(c=>c.rgb);
    for(let y=0,k=0;y<h;y++){
      const v=y/(h-1),left=rgb[0].map((c,i)=>c+(rgb[2][i]-c)*v);
      const right=rgb[1].map((c,i)=>c+(rgb[3][i]-c)*v);
      for(let x=0;x<w;x++,k++){
        const t=x/(w-1);let diff=0;
        for(let c=0;c<3;c++)diff=Math.max(diff,Math.abs(data[4*k+c]-(left[c]+(right[c]-left[c])*t)));
        foreground[k]=diff>=threshold?1:0;
      }
    }
    // Close thin gaps in transparent holders before finding connected silhouettes.
    const mask=new Uint8Array(total);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;
      mask[i]=foreground[i]+foreground[i-w]+foreground[i+w]+foreground[i-1]+foreground[i+1]>=2?1:0;
    }
    const labels=new Int32Array(total), queue=new Int32Array(total);
    let label=0,best=null;
    for(let i=0;i<total;i++){
      if(!mask[i] || labels[i])continue;
      let head=0,tail=1,minX=w,minY=h,maxX=0,maxY=0;
      queue[0]=i;labels[i]=++label;
      while(head<tail){
        const j=queue[head++],y=Math.floor(j/w),x=j-y*w;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const d of [-w,1,w,-1]){const k=j+d;if(mask[k]&&!labels[k]){labels[k]=label;queue[tail++]=k;}}
      }
      const boxArea=(1+maxX-minX)*(1+maxY-minY);
      if(boxArea<total*.009 || minX===maxX || minY===maxY)continue;
      const score=tail*Math.sqrt(tail/boxArea);
      if(!best || score>best.score)best={label,score,tail,minX,maxX,minY,maxY};
    }
    if(!best)return fallback();
    const {minX,maxX,minY,maxY}=best,boundary=[];
    function collectFirstLast(start,stop,stride) {
      let first=-1,last=-1;
      for(let k=start;k<=stop;k+=stride)if(labels[k]===best.label){if(first<0)first=k;last=k;}
      if(first<0)return;
      for(const k of [first,last])boundary.push({x:k%w+.5,y:Math.floor(k/w)+.5});
    }
    for(let y=minY;y<=maxY;y++)collectFirstLast(y*w+minX,y*w+maxX,1);
    for(let x=minX;x<=maxX;x++)collectFirstLast(minY*w+x,maxY*w+x,w);
    const hull=convexHull(boundary.slice()),hullArea=area(hull);
    if(hullArea<total*.008)return fallback();
    const quad=fourSides(hull,boundary);
    const rectQuality=quad?Math.min(1,area(quad)/hullArea):0;
    const edgeW=quad?length(quad[0],quad[1])+length(quad[2],quad[3]):maxX-minX;
    const edgeH=quad?length(quad[1],quad[2])+length(quad[3],quad[0]):maxY-minY;
    const aspect=Math.min(edgeW/edgeH,edgeH/edgeW);
    let type=kind;
    if(kind==='auto'){
      type='box';
      if(rectQuality>.87 && aspect>.47 && aspect<.82)type=aspect<.65?'slab':'card';
    }
    const planar=type==='card'||type==='slab';
    // A tightly photographed slab may fill every corner. Preserve the whole
    // holder when the colour model has isolated its printed insert instead.
    const fullAspect=Math.min(w/h,h/w);
    // When a clear holder fills a portrait capture, its card and ticket can
    // appear as separate objects. Retain the ticket above the card insert.
    const insetCard=maxX-minX>w*.60 && minY>h*.18 && minY<h*.38 && maxY>h*.80;
    if((kind==='auto'||kind==='slab') && h>w && fullAspect>.52 && fullAspect<.67 && insetCard){
      let ticketRows=0;
      for(let y=Math.floor(h*.03);y<minY-h*.02;y++) {
        let hits=0;
        for(let x=minX;x<=maxX;x++) hits+=foreground[y*w+x];
        if(hits>(maxX-minX)*.6)ticketRows++;
      }
      if(ticketRows>h*.018)return {...fallback(),kind:'slab'};
    }
    if(planar && Math.abs(fullAspect-(type==='slab'?.60:.716))<.065 &&
       hullArea/total<.78 && (noise>=4 || bg.filter(c=>Math.max(...c.rgb)-Math.min(...c.rgb)>34).length>1))
      return {...fallback(),kind:type};
    let points=planar&&rectQuality>.80?quad:rectangle(minX,minY,maxX+1,maxY+1);
    // Add a one-analysis-pixel guard at the outline to retain edge whitening.
    const cx=points.reduce((s,p)=>s+p.x,0)/4,cy=points.reduce((s,p)=>s+p.y,0)/4;
    const normalized=p=>({x:limit(p.x/w,0,1),y:limit(p.y/h,0,1)});
    points=points.map(p=>normalized({x:p.x+(p.x-cx)/Math.max(1,(maxX-minX)/2)*1.5,
      y:p.y+(p.y-cy)/Math.max(1,(maxY-minY)/2)*1.5}));
    const confidence=limit(.25+.45*rectQuality+.25*Math.min(1,best.tail/hullArea)-noise*.012,.15,.97);
    return {kind:type,confidence,corners:points,outline:hull.map(p=>normalized({x:p.x+(p.x-cx)*.009,y:p.y+(p.y-cy)*.009}))};
  }

  async function decode(file) {
    if(typeof createImageBitmap==='function'){
      try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}
    }
    if(inWorker)throw new Error('Image decoder unavailable.');
    const src=URL.createObjectURL(file);
    try{
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Choose a readable JPEG, PNG or WebP photo.'));img.src=src;});
      return img;
    }finally{URL.revokeObjectURL(src);}
  }
  async function prepare(file,kind='auto') {
    if(!file || !file.size || file.size>20*1024*1024)throw new Error('Choose a photo up to 20 MB.');
    const bitmap=await decode(file);
    try{
      if(Math.min(bitmap.width,bitmap.height)<20)throw new Error('The photo is too small. Capture the product again.');
      const ratio=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
      const source=canvas(bitmap.width*ratio,bitmap.height*ratio),ctx=source.getContext('2d',{willReadFrequently:true});
      ctx.fillStyle=MAT;ctx.fillRect(0,0,source.width,source.height);
      ctx.drawImage(bitmap,0,0,source.width,source.height);
      const scale=Math.min(1,360/Math.max(source.width,source.height));
      const probe=canvas(source.width*scale,source.height*scale),sample=probe.getContext('2d',{willReadFrequently:true});
      sample.drawImage(source,0,0,probe.width,probe.height);
      const found=detect(sample.getImageData(0,0,probe.width,probe.height),['card','slab','box','accessory'].includes(kind)?kind:'auto');
      return {...found,source,detectedCorners:found.corners.map(p=>({...p}))};
    }finally{bitmap.close?.();}
  }

  function validCorners(ps) {
    return Array.isArray(ps)&&ps.length===4&&ps.every((p,i)=>p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1 && cross(p,ps[(i+1)%4],ps[(i+2)%4])>.0001) && area(ps)>.0012;
  }
  // Unit square -> photographed quadrilateral. Inverse sampling keeps graded
  // label text straight without inventing missing detail along a card edge.
  function projective(src,points,w,h) {
    const out=canvas(w,h),ctx=out.getContext('2d');
    const [a,b,c,d]=points;
    // With a fixed mount most captures are almost affine. Draw those on the
    // native canvas path; the measured far corner must agree to within one
    // output pixel before treating it as a parallelogram.
    const xx=b.x-a.x,xy=b.y-a.y,yx=d.x-a.x,yy=d.y-a.y;
    const error=Math.hypot(a.x+xx+yx-c.x,a.y+xy+yy-c.y);
    const determinant=xx*yy-xy*yx;
    if(Math.abs(determinant)>.001 && error<=Math.min(length(a,b)/out.width,length(a,d)/out.height)){
      const m11=out.width*yy/determinant,m12=-out.height*xy/determinant;
      const m21=-out.width*yx/determinant,m22=out.height*xx/determinant;
      ctx.setTransform(m11,m12,m21,m22,-m11*a.x-m21*a.y,-m12*a.x-m22*a.y);
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(src,0,0);
      return out;
    }
    const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
    const det=dx1*dy2-dx2*dy1;
    if(Math.abs(det)<.001)throw new Error('The crop is too narrow. Move its corners apart.');
    const g=(dx3*dy2-dx2*dy3)/det,hp=(dx1*dy3-dx3*dy1)/det;
    const ux=b.x-a.x+g*b.x,uy=b.y-a.y+g*b.y,vx=d.x-a.x+hp*d.x,vy=d.y-a.y+hp*d.y;
    const sw=src.width,sh=src.height;
    const data=src.getContext('2d').getImageData(0,0,sw,sh).data;
    const pixels=ctx.createImageData(out.width,out.height),dest=pixels.data;
    const du=1/out.width,stepX=ux*du,stepY=uy*du,stepZ=g*du;
    for(let y=0,k=0;y<out.height;y++){
      const v=(y+.5)/out.height;
      let mx=a.x+vx*v+stepX*.5,my=a.y+vy*v+stepY*.5,z=1+hp*v+stepZ*.5;
      for(let x=0;x<out.width;x++,mx+=stepX,my+=stepY,z+=stepZ,k+=4){
        let cx=mx/z-.5,cy=my/z-.5;
        if(cx<0)cx=0;else if(cx>sw-1.001)cx=sw-1.001;
        if(cy<0)cy=0;else if(cy>sh-1.001)cy=sh-1.001;
        const ix=Math.floor(cx),iy=Math.floor(cy),rx=cx-ix,ry=cy-iy;
        const j=(iy*sw+ix)*4,j2=j+sw*4;
        for(let ch=0;ch<3;ch++){
          const upper=data[j+ch]+(data[j+4+ch]-data[j+ch])*rx;
          const lower=data[j2+ch]+(data[j2+4+ch]-data[j2+ch])*rx;
          dest[k+ch]=upper+(lower-upper)*ry;
        }
        dest[k+3]=255;
      }
    }
    ctx.putImageData(pixels,0,0);
    return out;
  }
  const cache=new WeakMap();
  function objectCanvas(prepared,corners=prepared.corners,quarterTurns=0) {
    if(!validCorners(corners))throw new Error('Keep the four crop corners around the product in order.');
    const key=corners.map(p=>p.x+','+p.y).join('/')+';'+quarterTurns;
    const cached=cache.get(prepared);
    if(cached?.key===key)return cached.canvas;
    const {source,kind}=prepared,sw=source.width,sh=source.height;
    const points=corners.map(p=>({x:p.x*sw,y:p.y*sh}));
    const flat=kind==='card'||kind==='slab';
    let out;
    if(flat){
      const w=(length(points[0],points[1])+length(points[2],points[3]))/2;
      const h=(length(points[1],points[2])+length(points[3],points[0]))/2;
      const factor=Math.min(1,1800/Math.max(w,h));
      let width=w*factor,height=h*factor;
      // Oblique shots can make a tall slab look almost square even after
      // its edges are straightened. Use the supplied standard slab silhouette
      // for visibly convergent sides, and retain a flat holder's own aspect.
      const aspect=Math.min(w/h,h/w),standard=kind==='card'?63/88:.595;
      const taper=Math.max(Math.abs(length(points[0],points[1])-length(points[3],points[2]))/w,
        Math.abs(length(points[0],points[3])-length(points[1],points[2]))/h);
      const standardSize=kind==='card'?Math.abs(aspect-standard)<.14:taper>.10 && aspect>.45 && aspect<.80;
      if(standardSize && prepared.confidence>.5){
        if(w<h)width=height*standard;else height=width*standard;
      }
      out=projective(source,points,width,height);
    }else{
      const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
      const w=Math.max(...points.map(p=>p.x))-x,h=Math.max(...points.map(p=>p.y))-y;
      const factor=Math.min(1,1800/Math.max(w,h));
      out=canvas(w*factor,h*factor);
      const ctx=out.getContext('2d');
      ctx.fillStyle=MAT;ctx.fillRect(0,0,out.width,out.height);
      const untouched=prepared.detectedCorners?.every((p,i)=>Math.abs(p.x-corners[i].x)+Math.abs(p.y-corners[i].y)<.0001);
      if(untouched && prepared.confidence>.72 && prepared.outline){
        ctx.beginPath();prepared.outline.forEach((p,i)=>ctx[i?'lineTo':'moveTo']((p.x*sw-x)*factor,(p.y*sh-y)*factor));ctx.closePath();ctx.clip();
      }
      ctx.drawImage(source,x,y,w,h,0,0,out.width,out.height);
    }
    const turn=((quarterTurns%4)+4)%4;
    if(turn){
      const rotated=canvas(turn%2?out.height:out.width,turn%2?out.width:out.height),ctx=rotated.getContext('2d');
      ctx.translate(rotated.width/2,rotated.height/2);ctx.rotate(turn*Math.PI/2);
      ctx.drawImage(out,-out.width/2,-out.height/2);
      out=rotated;
    }
    cache.set(prepared,{key,canvas:out});
    return out;
  }
  function render(prepared,corners=prepared.corners,quarterTurns=0) {
    const object=objectCanvas(prepared,corners,quarterTurns),proof=canvas(1152,1152),ctx=proof.getContext('2d');
    const factor=1008/Math.max(object.width,object.height),w=object.width*factor,h=object.height*factor;
    ctx.fillStyle=MAT;ctx.fillRect(0,0,1152,1152);ctx.imageSmoothingQuality='high';
    ctx.drawImage(object,(1152-w)/2,(1152-h)/2,w,h);
    return proof;
  }

  function balanceLight(data) {
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
    const curves=gains.map(gain=>Uint8Array.from({length:256},(_,n)=>Math.round(255*Math.pow(n/255,1/gain))));
    for (let i=0;i<data.length;i+=4){
      data[i]=curves[0][data[i]];data[i+1]=curves[1][data[i+1]];data[i+2]=curves[2][data[i+2]];
    }
  }

  // The full-resolution original stays with this side's processor. The UI only
  // paints a small preview while the crop or OCR image is being prepared.
  async function exportProof(source,corners,turns,balance){
    const proof=render(source,corners,turns);
    if(balance){
      const ctx=proof.getContext('2d'),pixels=ctx.getImageData(0,0,proof.width,proof.height);
      balanceLight(pixels.data);ctx.putImageData(pixels,0,0);
    }
    if(inWorker)return proof.convertToBlob({type:'image/jpeg',quality:.94});
    return new Promise((resolve,reject)=>proof.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare the image.')),'image/jpeg',.94));
  }
  if(inWorker){
    let original;
    self.onmessage=async({data})=>{
      const {id,action,file,kind,corners,turns,balance}=data;
      try{
        if(action==='open'){
          original=await prepare(file,kind);
          const src=original.source,scale=Math.min(1,750/Math.max(src.width,src.height));
          const view=canvas(src.width*scale,src.height*scale);
          view.getContext('2d').drawImage(src,0,0,view.width,view.height);
          const bitmap=view.transferToImageBitmap();
          self.postMessage({id,result:{...original,source:bitmap}},[bitmap]);return;
        }
        if(action==='proof'){
          self.postMessage({id,result:await exportProof(original,corners,turns,balance)});return;
        }
        const bitmap=await createImageBitmap(objectCanvas(original,corners,turns));
        self.postMessage({id,result:bitmap},[bitmap]);
      }catch(e){self.postMessage({id,error:e.message});}
    };
  }

  function processor(){
    if(!scriptUrl || !window.Worker || !window.OffscreenCanvas || !window.createImageBitmap)return null;
    const worker=new Worker(scriptUrl),pending=new Map();let sequence=0,closed=false;
    const close=()=>{
      if(closed)return;
      closed=true;worker.terminate();
      for(const job of pending.values())job.reject(Error('Photo processor closed.'));
      pending.clear();
    };
    worker.onerror=close;
    worker.onmessage=({data:{id,result,error}})=>{
      const job=pending.get(id);if(!job)return;
      pending.delete(id);if(error)job.reject(Error(error));else job.resolve(result);
    };
    function ask(action,options){
      if(closed)return Promise.reject(Error('Photo processor closed.'));
      return new Promise((resolve,reject)=>{
        const id=++sequence;pending.set(id,{resolve,reject});
        try{worker.postMessage({id,action,...options});}catch(e){pending.delete(id);reject(e);}
      });
    }
    return {ask,close};
  }
  async function openPhoto(file,kind){
    if(!file || !file.size || file.size>20*1024*1024)throw Error('Choose a photo up to 20 MB.');
    let client,local,view,disposed=false;
    try{client=processor();
      if(client)view=await client.ask('open',{file,kind});
    }catch{client?.close();client=null;}
    if(!view)view=await (local=prepare(file,kind));
    async function output(action,turns,balance){
      const corners=view.corners.map(p=>({...p}));
      if(client){
        try{
          const result=await client.ask(action,{corners,turns,balance});
          if(action==='proof')return result;
          const c=canvas(result.width,result.height);
          c.getContext('2d').drawImage(result,0,0);result.close();return c;
        }catch(error){
          if(disposed)throw error;
          client?.close();client=null;
        }
      }
      if(disposed)throw Error('Photo closed.');
      const original=await (local??=prepare(file,kind));
      return action==='proof'?exportProof(original,corners,turns,balance):objectCanvas(original,corners,turns);
    }
    return Object.assign(view,{
      proof:(turns,balance)=>output('proof',turns,balance),
      forLabel:turns=>output('label',turns,false),
      release(){disposed=true;client?.close();view.source.close?.();}
    });
  }

  function mountCorrection(container,prepared,onChange) {
    const frame=document.createElement('div');
    Object.assign(frame.style,{position:'relative',margin:'14px auto',width:'100%',maxWidth:'min(100%, '+(300*prepared.source.width/prepared.source.height)+'px)',lineHeight:'0'});
    const previewScale=Math.min(1,800/Math.max(prepared.source.width,prepared.source.height));
    const preview=canvas(prepared.source.width*previewScale,prepared.source.height*previewScale);
    Object.assign(preview.style,{width:'100%',height:'auto',borderRadius:'4px',display:'block'});
    preview.getContext('2d').drawImage(prepared.source,0,0,preview.width,preview.height);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),poly=document.createElementNS(ns,'polygon');
    svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    Object.assign(svg.style,{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'});
    poly.setAttribute('fill','none');poly.setAttribute('stroke','#195ead');poly.setAttribute('stroke-width','2');poly.setAttribute('vector-effect','non-scaling-stroke');
    const shade=document.createElementNS(ns,'path');shade.setAttribute('fill-rule','evenodd');shade.setAttribute('fill','#09183166');
    svg.append(shade,poly);frame.append(preview,svg);
    let paintFrame=0,active=null;
    const requestDraw=()=>{if(!paintFrame)paintFrame=requestAnimationFrame(draw);};
    const names=['Top left','Top right','Bottom right','Bottom left'];
    const controls=names.map((name,i)=>{
      const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',name+' crop corner. Drag or use arrow keys.');
      Object.assign(b.style,{position:'absolute',width:'44px',height:'44px',padding:0,margin:0,background:'transparent',border:0,boxShadow:'none',borderRadius:'50%',transform:'translate(-50%,-50%)',touchAction:'none',cursor:'grab',display:'grid',placeItems:'center'});
      const dot=document.createElement('span');
      Object.assign(dot.style,{display:'block',width:'13px',height:'13px',borderRadius:'50%',background:'#fff',border:'2px solid #195ead',transition:'transform .12s',boxShadow:'0 1px 3px #12284e88'});
      b.append(dot);frame.append(b);
      function move(x,y){
        const next=prepared.corners.map(p=>({...p}));
        next[i]={x:limit(x,0,1),y:limit(y,0,1)};
        if(prepared.kind==='box'||prepared.kind==='accessory'){
          // Rectangular bounds on 3D items keep the original perspective.
          next[(i+1)%4][i%2?'x':'y']=next[i][i%2?'x':'y'];
          next[(i+3)%4][i%2?'y':'x']=next[i][i%2?'y':'x'];
        }
        if(!validCorners(next))return false;
        prepared.corners=next;requestDraw();return true;
      }
      let dragging=null;
      b.onpointerdown=e=>{
        if(active!==null || e.button!==0)return;
        const rect=frame.getBoundingClientRect(),p=prepared.corners[i];
        active=e.pointerId;dragging={id:e.pointerId,rect,x:p.x-(e.clientX-rect.left)/rect.width,y:p.y-(e.clientY-rect.top)/rect.height,dirty:false};
        b.dataset.dragging='';b.setPointerCapture(e.pointerId);e.preventDefault();
      };
      const movePointer=e=>{
        const d=dragging;
        if(!d || d.id!==e.pointerId)return;
        const x=(e.clientX-d.rect.left)/d.rect.width+d.x,y=(e.clientY-d.rect.top)/d.rect.height+d.y;
        if(Math.abs(x-prepared.corners[i].x)+Math.abs(y-prepared.corners[i].y)>.00001 && move(x,y))d.dirty=true;
      };
      b.onpointermove=movePointer;b.onpointerup=movePointer;
      b.onlostpointercapture=()=>{
        if(!dragging)return;
        const dirty=dragging.dirty;active=null;dragging=null;delete b.dataset.dragging;
        if(dirty)onChange?.(prepared.corners);
      };
      b.onkeydown=e=>{
        const axis={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
        if(!axis)return;e.preventDefault();const p=prepared.corners[i],step=e.shiftKey?.02:.003;
        if(move(p.x+axis[0]*step,p.y+axis[1]*step))onChange?.(prepared.corners);
      };
      return b;
    });
    function draw() {
      paintFrame=0;
      prepared.corners.forEach((p,i)=>{controls[i].style.left=(100*p.x)+'%';controls[i].style.top=(100*p.y)+'%';});
      const points=prepared.corners.map(p=>p.x*1000+','+p.y*1000).join(' ');
      poly.setAttribute('points',points);shade.setAttribute('d','M0 0H1000V1000H0Z M'+points+'Z');
    }
    draw();container.replaceChildren(frame);
    return ()=>{cancelAnimationFrame(paintFrame);frame.remove();};
  }
  return {prepare,render,objectCanvas,openPhoto,mountCorrection};
})();
