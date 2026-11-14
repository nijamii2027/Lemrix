'use strict';
/* One motion controller for scrolling, parallax and finite UI animations. */
(() => {
 const root=document.documentElement;
 const motion=window.LemrixMotionState;
 const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
 const ease='cubic-bezier(.2,.75,.2,1)';
 let lenis=null,measureId=0,lastScroll=-1,observer=null,nativeScroll=null;
 const dismissals=new WeakMap();
 const finite=new Set(),revealed=new WeakSet(),observed=new WeakSet();
 const nav=document.querySelector('.nav-world');
 const layers=[...document.querySelectorAll('[data-parallax]')].map(el=>({el,anchor:el.parentElement,depth:Number(el.dataset.parallax)||20,top:0,height:0,last:null}));
 const enabled=()=>motion.enabled;
 const hasDialog=()=>!!document.querySelector('dialog[open]');
 const waves=[...document.querySelectorAll('.rolling-waves')].map(svg=>({
  svg,
  visible:false,
  layers:[...svg.querySelectorAll('.wave-front')].map(layer=>({
   layer,
   reverse:!!svg.closest('.site-footer'),
   period:svg.closest('.site-footer')?42000
    :svg.classList.contains('section-tide')?36000:28000
  }))
 }));
 let lastWaveMeasure=-Infinity;

 function measure(){
  measureId=0;
  // Measure the stable clipping parent, never the translated image itself.
  for(const l of layers){const r=l.anchor.getBoundingClientRect();l.top=r.top+scrollY;l.height=r.height;l.last=null;}
  lastScroll=-1;
 }
 function queueMeasure(){
  if(!measureId)measureId=setTimeout(measure,0);
 }
 function parallax(){
  if(lastScroll===scrollY)return;lastScroll=scrollY;
  const strength=finePointer.matches?1:.55;
  for(const l of layers){
   if(l.top+l.height<scrollY-100||l.top>scrollY+innerHeight+100)continue;
   const p=Math.max(-1,Math.min(1,(scrollY+innerHeight/2-l.top-l.height/2)/(innerHeight+l.height)));
   const value=Math.round(p*l.depth*strength*100)/100;
   if(l.last===null||Math.abs(value-l.last)>.04){l.el.style.setProperty('--parallax-y',`${value}px`);l.last=value;}
  }
 }
 function paintFrame(time){
  lenis?.raf(performance.now());
  parallax();
  if(time-lastWaveMeasure>160){
   lastWaveMeasure=time;
   for(const wave of waves)wave.visible=motion.isOnScreen(wave.svg);
  }
  for(const wave of waves){
   if(!wave.visible)continue;
   for(const {layer,reverse,period} of wave.layers){
    const progress=(time%period)/period;
    const x=-1440*(reverse?1-progress:progress);
    layer.classList.add('clock-driven');
    layer.setAttribute('transform',`translate(${x.toFixed(1)} 0)`);
   }
  }
 }
 function animate(el,keyframes,options={}){
  if(!el||!enabled()||document.hidden||!el.animate)return null;
  try{
   const animation=el.animate(keyframes,{duration:360,easing:ease,...options});
   if(!animation.finished){animation.cancel();return null;}
   finite.add(animation);
   animation.finished.then(()=>finite.delete(animation),()=>finite.delete(animation));
   return animation;
  }catch{return null;}
 }
 function finishFinite(){for(const a of [...finite]){try{a.finish();}catch{a.cancel();}}finite.clear();}
 function syncDialogs(){
  const open=hasDialog();root.classList.toggle('has-open-dialog',open);
  if(open)lenis?.stop();else lenis?.start();
 }
 function reveal(el,delay=null){
  if(revealed.has(el))return;revealed.add(el);observer?.unobserve(el);
  if(delay!==null)el.style.setProperty('--reveal-delay',`${delay}ms`);el.classList.add('is-visible');
 }
 function register(el,delay=0,forceVisible=false){
  el.style.setProperty('--reveal-delay',`${delay}ms`);
  if(forceVisible||!enabled()||!observer){el.classList.remove('motion-reveal');reveal(el);return;}
  el.classList.add('motion-reveal');
  const r=el.getBoundingClientRect();
  if(r.bottom<0){reveal(el);return;}
  if(!observed.has(el)){observed.add(el);observer.observe(el);}
 }
 function sync(){
  const off=!enabled();root.classList.toggle('motion-paused',off);root.classList.toggle('page-hidden',document.hidden);
  if(off){
   nativeScroll?.kill();nativeScroll=null;
   lenis?.destroy();lenis=null;finishFinite();
   for(const l of layers){l.el.style.setProperty('--parallax-y','0px');l.last=null;}
   document.querySelectorAll('.motion-reveal').forEach(el=>reveal(el));
  }else{
   if(!lenis&&window.Lenis){
    try{
     lenis=new Lenis({lerp:.1,smoothWheel:!motion.touch&&!motion.systemReduced,syncTouch:false,anchors:false,prevent:node=>!!node.closest('dialog,[data-lenis-prevent]')});
    }
    catch{lenis=null;}
   }
   measure();syncDialogs();
  }
 }
 function scrollToTarget(target,{focus=false,immediate=false}={}){
  const node=typeof target==='number'?null:typeof target==='string'?document.querySelector(target):target;
  if(!node&&typeof target!=='number')return;
  const offset=(nav?.offsetHeight||0)+(node?.id==='the-club'?0:10);
  const top=node?Math.max(0,node.getBoundingClientRect().top+scrollY-offset):target;
  immediate=immediate||motion.systemReduced;
  nativeScroll?.kill();nativeScroll=null;
  const complete=()=>{
   if(focus&&node){if(!node.hasAttribute('tabindex'))node.setAttribute('tabindex','-1');node.focus({preventScroll:true});}
  };
  const duration=Math.min(1.15,Math.max(.64,Math.abs(top-scrollY)/2100+.42));
  if(lenis&&!hasDialog()){
   lenis.scrollTo(top,{immediate,force:immediate,duration,lerp:0,
    easing:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,onComplete:complete});
  }else if(!immediate&&enabled()&&window.gsap){
   const travel={top:scrollY};
   nativeScroll=gsap.to(travel,{top,duration,ease:'power2.inOut',
    onUpdate:()=>window.scrollTo({top:travel.top,behavior:'instant'}),
    onComplete:()=>{nativeScroll=null;complete();}});
  }else{
   window.scrollTo({top,behavior:immediate?'instant':'smooth'});
   complete();
  }
 }
 function enterDialog(dialog){
  const pending=dismissals.get(dialog);if(pending){dismissals.delete(dialog);pending.cancel();}
  dialog.removeAttribute('data-closing');
  if(!motion.systemReduced)animate(dialog,[{opacity:0,transform:'translateY(16px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:260});
 }
 function dismissDialog(dialog,close){
  if(!dialog?.open||dialog.hasAttribute('data-closing'))return;
  if(!enabled()||document.hidden||motion.systemReduced){close();return;}
  dialog.setAttribute('data-closing','');
  // Finish an entrance before reversing it; never leave a half-visible dialog.
  for(const animation of dialog.getAnimations?.()||[]){try{animation.finish();}catch{animation.cancel();}}
  const a=animate(dialog,[{opacity:1,transform:'translate(0,0) scale(1)'},{opacity:0,transform:'translateY(10px) scale(.985)'}],{duration:160,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
  const done=()=>{if(a&&dismissals.get(dialog)!==a)return;dismissals.delete(dialog);close();dialog.removeAttribute('data-closing');a?.cancel();};
  if(a){dismissals.set(dialog,a);a.finished.then(done,done);}else done();
 }
 window.LemrixMotion={
  get enabled(){return enabled();},animate,scrollTo:scrollToTarget,enterDialog,dismissDialog,
  refresh:queueMeasure
 };
 if(typeof IntersectionObserver==='function'){
  observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)reveal(e.target);}),{threshold:.08,rootMargin:'0px 0px -12px 0px'});
  const scenes=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('motion-scene-idle',!e.isIntersecting)),{rootMargin:'100px'});
  document.querySelectorAll('.hero,.moon-hero,.collab-section,.site-footer,.trade-illustration,.wheel-stage').forEach(el=>scenes.observe(el));
 }
 const candidates='.trade-illustration,.trade-copy';
 document.querySelectorAll(candidates).forEach(el=>{
  if(el.getBoundingClientRect().top<innerHeight*.92){reveal(el);return;}register(el);
 });
 window.addEventListener('lemrix:motion-change',sync);motion.watchMedia(finePointer,queueMeasure);
 window.addEventListener('lemrix:dialog',syncDialogs);
 window.addEventListener('lemrix:shop-ready',queueMeasure);
 // A new interaction owns the viewport immediately, including native focus scrolls.
 const interruptScroll=()=>{
  nativeScroll?.kill();nativeScroll=null;
  if(lenis&&!hasDialog())lenis.scrollTo(scrollY,{immediate:true,force:true});
 };
 document.addEventListener('pointerdown',interruptScroll,{capture:true,passive:true});
 window.addEventListener('wheel',()=>{
  nativeScroll?.kill();nativeScroll=null;
  if(lenis?.isScrolling==='smooth'&&lenis.isLocked)interruptScroll();
 },{passive:true});
 window.addEventListener('touchstart',interruptScroll,{passive:true});
 document.addEventListener('keydown',e=>{if(['Tab','PageDown','PageUp','Home','End','ArrowUp','ArrowDown',' '].includes(e.key)&&!e.target.matches('input,textarea,select,[contenteditable]'))interruptScroll();},{capture:true});
 document.addEventListener('click',e=>{
  const a=e.target.closest('a[href^="#"]');if(!a||a.classList.contains('skip')||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  const href=a.getAttribute('href');
  if(href==='#'){e.preventDefault();scrollToTarget(0);return;}
  let target;try{target=document.getElementById(decodeURIComponent(href.slice(1)));}catch{return;}
  if(!target)return;
  e.preventDefault();
  try{history.replaceState(null,'',href);}catch{}
  scrollToTarget(target,{focus:true});
 });
 document.addEventListener('transitionend',e=>{if(e.propertyName==='translate'&&e.target.classList.contains('motion-reveal'))queueMeasure();});
 window.addEventListener('resize',queueMeasure,{passive:true});window.addEventListener('load',queueMeasure,{once:true});
 document.fonts?.ready.then(queueMeasure);
 if(typeof ResizeObserver==='function')new ResizeObserver(queueMeasure).observe(document.body);
 document.addEventListener('visibilitychange',()=>{
  root.classList.toggle('page-hidden',document.hidden);
  if(document.hidden){for(const a of finite)a.pause();}
  else{for(const a of finite)if(enabled())a.play();measure();}
 });
 window.addEventListener('pageshow',()=>{queueMeasure();syncDialogs();});
 motion.onFrame(paintFrame);
 sync();
 const crossPageSection=root.dataset.homeScroll;
 if(crossPageSection){
  delete root.dataset.homeScroll;
  // Start after the document's own anchor positioning and layout settle.
  window.addEventListener('load',()=>{
   history.replaceState(history.state,'',crossPageSection);
   scrollToTarget(crossPageSection,{focus:true});
  },{once:true});
 }
})();
