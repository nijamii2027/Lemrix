'use strict';

(() => {
 const {gsap,LemrixMotionState:motion}=window;
 const hero=document.querySelector('.moon-hero');
 if(!hero||!motion)return;

 const stage=hero.querySelector('.moon-stage');
 const shore=hero.querySelector('#hero-shore-shape');
 const lead=hero.querySelector('.moon-one-more');
 const pack=hero.querySelector('.moon-pack');
 const diorama=hero.querySelector('.moon-diorama');
 const letters=[...pack.querySelectorAll('.moon-letter')];
 const chapter=document.querySelector('#the-club');
 const chapterLayout=chapter.querySelector('.collab-layout');
 const lucky=document.querySelector('#lucky-find');
 const luckyPanel=lucky.querySelector('.lucky-panel');
 const trade=document.querySelector('.trade-section');
 const nav=document.querySelector('.site-header');
 const clamp=value=>Math.min(1,Math.max(0,value));
 const concealed=(progress,start,length)=>clamp((progress-start)/length);
 let entrance,entranceAt,ripple,rippleAt,rippleReduced;
 let entranceDecided=false,visible=false;
 let layout,dirty=true,previousScroll,lastFrame;

 function buildRipple(){
  ripple?.kill();
  gsap.set(letters,{clearProps:'transform'});
  rippleReduced=motion.systemReduced;
  const height=rippleReduced?4:10;
  ripple=gsap.timeline({repeat:-1,repeatDelay:2.65,paused:true});
  letters.forEach((letter,index)=>{
   const at=.09*index;
   ripple.to(letter,{yPercent:-height,rotation:-2.4,duration:.19,ease:'sine.out'},at)
    .to(letter,{yPercent:height*.24,rotation:1.7,duration:.24,ease:'sine.inOut'},at+.19)
    .to(letter,{yPercent:0,rotation:0,duration:.26,ease:'sine.out'},at+.43);
  });
 }

 function playIntro(){
  entranceDecided=true;
  hero.classList.remove('hero-entrance-pending');
  const canvas=stage.querySelector('#hero-hands');
  const hands=window.LemrixHandSprites?.renderer(canvas);
  if(!hands||!motion.enabled||motion.systemReduced||!visible||scrollY>36){
   return;
  }

  const box=stage.getBoundingClientRect();
  const lines=[lead,pack];
  const poses=lines.map((line,index)=>{
   const rect=line.getBoundingClientRect();
   const direction=index?1:-1;
   const x=rect.left-box.left+rect.width*(index?.9:.095);
   const y=rect.top-box.top+rect.height*(index?.41:.30);
   const size=Math.min(174,Math.max(55,rect.height*.92));
   return {x,y,size,pose:1,angle:direction*.08};
  });
  canvas.hidden=false;
  entrance=gsap.timeline({paused:true,onUpdate:()=>hands.paint(poses),onComplete:()=>{
   canvas.hidden=true;
   canvas.width=canvas.height=1;
   gsap.set(lines,{clearProps:'transform'});
   entrance=null;
   entranceAt=undefined;
  }});
  lines.forEach((line,index)=>{
   const hand=poses[index];
   const {x,y}=hand;
   const rect=line.getBoundingClientRect();
   const dx=index?box.width-rect.left+box.left+18:box.left-rect.right-18;
   const dy=index?-Math.min(92,box.height*.17):-Math.min(105,box.height*.20);
   const at=index*.13;
   const land=at+1.02;
   entrance.set(line,{x:dx,y:dy},0)
    .set(hand,{x:x+dx,y:y+dy},0)
    .to(line,{x:0,y:0,duration:1.02,ease:'power3.out'},at)
    .to(hand,{x,y,duration:1.02,ease:'power3.out'},at)
    .set(hand,{pose:2},land+.04)
    .to(hand,{y:y+(index?20:-22),angle:index?.2:-.2,duration:.18,ease:'sine.out'},land)
    .set(hand,{pose:0},land+.17)
    .to(hand,{x:x+dx,y:y+dy,duration:.58,ease:'power2.in'},land+.14);
  });
  // Render the first visible pose before the next screen paint.
  entrance.totalTime(.001);
 }


 function measure(){
  const pageTop=element=>element.getBoundingClientRect().top+scrollY;
  layout={heroTop:pageTop(hero),navHeight:nav.offsetHeight,width:stage.clientWidth,
   height:stage.clientHeight,viewport:innerHeight,chapterTop:pageTop(chapter),
   luckyTop:pageTop(lucky),tradeTop:pageTop(trade),tradeHeight:trade.offsetHeight};
  dirty=false;
  previousScroll=undefined;
 }

 function paintScroll(delta){
  const {heroTop,navHeight,height,viewport,chapterTop,luckyTop,tradeTop,tradeHeight}=layout;
  const position=scrollY;
  visible=heroTop-position<viewport&&heroTop+height-position>navHeight;
  const reduced=motion.systemReduced;
  const eased=previousScroll===undefined||reduced ? position
   : previousScroll+(position-previousScroll)*(1-Math.exp(-delta/90));
  const scroll=Math.abs(eased-position)<.4?position:eased;
  if(scroll===previousScroll)return;
  previousScroll=scroll;
  const progress=clamp((scroll+navHeight-heroTop)/Math.max(1,height));
  if(progress>.08)entrance?.progress(1);
  lead.style.setProperty('--shore-y',`${-height*progress*(reduced?.07:.40)}px`);
  pack.style.setProperty('--shore-y',`${-height*progress*(reduced?.05:.30)}px`);
  diorama.style.setProperty('--shore-y',`${height*progress*(reduced?.38:1.08)}px`);
  lead.style.opacity=pack.style.opacity=Math.cos(concealed(progress,.52,.45)*Math.PI/2);
  diorama.style.opacity=(1+Math.cos(concealed(progress,.66,.29)*Math.PI))/2;

  for(const [top,content,maxTravel] of [[chapterTop,chapterLayout,230],[luckyTop,luckyPanel,208]]){
   const reveal=clamp((scroll+viewport-top)/(viewport*.64));
   const travel=Math.min(maxTravel,viewport*.27)*(reduced?.28:1);
   content.style.translate=`0 ${-travel*(1-reveal)}px`;
  }
  const wash=clamp((scroll+viewport-tradeTop)/(viewport+tradeHeight));
  trade.style.setProperty('--binder-wash-shift',`${(wash*14-6)*(reduced?.3:1)}%`);
 }

 function paintShore(time){
  if(!visible||!shore)return;
  const reduced=motion.systemReduced;
  const depth=Math.min(17,Math.max(9,layout.width*.011))*(reduced?.65:1);
  const height=Math.max(1,layout.height);
  const amplitude=depth/height;
  const phase=time*Math.PI*2/(reduced?26000:12500);
  const frequency=4*Math.PI;
  const sample=x=>1-(depth+3)/height+amplitude*Math.sin(x*frequency-phase);
  const slope=x=>amplitude*frequency*Math.cos(x*frequency-phase);
  const n=value=>value.toFixed(4);
  const step=1/8;
  let d=`M0 0H1V${n(sample(1))}`;
  for(let i=8;i>0;i--){
   const a=i*step,b=(i-1)*step;
   d+=`C${n(a-step/3)} ${n(sample(a)-slope(a)*step/3)} ${n(b+step/3)} ${n(sample(b)+slope(b)*step/3)} ${n(b)} ${n(sample(b))}`;
  }
  shore.setAttribute('d',d+'Z');
 }
 function tick(time){
  const delta=lastFrame===undefined?0:Math.min(100,time-lastFrame);
  lastFrame=time;
  if(dirty)measure();
  paintScroll(delta);
  paintShore(time);
  const canPlay=visible&&!document.querySelector('dialog[open]');
  if(entrance){
   if(!canPlay)entrance.progress(1);
   else {
    entranceAt??=time;
    entrance.totalTime(Math.min(entrance.totalDuration(),(time-entranceAt)/1000));
   }
   return;
  }
  if(!entranceDecided||!gsap)return;
  if(!canPlay){
   if(rippleAt!==undefined)ripple?.totalTime(0);
   rippleAt=undefined;
   return;
  }
  if(!ripple||rippleReduced!==motion.systemReduced){
   buildRipple();
   rippleAt=undefined;
  }
  rippleAt??=time;
  ripple.totalTime((time-rippleAt)/1000);
 }

 const invalidate=()=>{dirty=true;};
 if(typeof ResizeObserver==='function'){
  const observer=new ResizeObserver(invalidate);
  [nav,stage,chapter,lucky,trade,document.querySelector('.breaks-section')].forEach(element=>observer.observe(element));
 }
 window.addEventListener('lemrix:motion-change',invalidate);
 window.addEventListener('load',invalidate,{once:true});
 window.addEventListener('resize',()=>{entrance?.progress(1);invalidate();},{passive:true});
 window.addEventListener('pagehide',()=>entrance?.progress(1));
 window.addEventListener('pageshow',invalidate);
 motion.onFrame(tick);
 tick(0);
 const handReady=window.LemrixHandSprites?.ready;
 if(gsap&&!motion.systemReduced&&scrollY<36&&handReady){
  hero.classList.add('hero-entrance-pending');
  const backdrop=hero.querySelector('.shop-backdrop');
  const backdropReady=backdrop.decode?.().then(()=>true,()=>false)??backdrop.complete;
  const fontsReady=document.fonts?.load('1em Caprasimo').then(()=>true,()=>false)??true;
  let deadline;
  const finish=ready=>{
   if(entranceDecided)return;
   clearTimeout(deadline);
   hero.classList.remove('hero-entrance-pending');
   if(ready&&!document.hidden)playIntro();
   else entranceDecided=true;
  };
  // The title stays in place if the intro assets miss the opening beat.
  deadline=setTimeout(()=>finish(false),1200);
  Promise.all([fontsReady,backdropReady,handReady]).then(results=>finish(results.every(Boolean)));
 }else entranceDecided=true;
})();
