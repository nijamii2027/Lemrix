'use strict';

(() => {
 const scene=document.querySelector('#flip-pancake');
 if(!scene)return;
 const sprite=document.querySelector('#kitchen-frames');
 const poster=document.querySelector('#kitchen-poster');
 const pancake=document.querySelector('.comic-pancake');
 const hint=document.querySelector('#kitchen-hint');
 const status=document.querySelector('#kitchen-status');
 const motion=window.LemrixMotionState;
 const hub=scene.closest('dialog');
 const panel=scene.closest('[role="tabpanel"]');
 const columns=8,rows=6,restFrame=24,idleSpan=23,tossDuration=1050;
 let image=null,ready=Boolean(pancake),near=false;
 let frame=-1,idleTime=0,tossTime=null,clock=0,lastTime=0,hintTimer=0;

 function draw(index){
  if(index===frame)return;
  frame=index;
  if(pancake){
   const progress=index<restFrame?index/(restFrame-1):0;
   const rise=Math.sin(progress*Math.PI);
   const idle=(index>=restFrame?(index-restFrame)/idleSpan:0);
   pancake.style.setProperty('--cake-x',`${Math.sin(progress*Math.PI*2)*18}%`);
   pancake.style.setProperty('--cake-y',`${-165*rise}%`);
   pancake.style.setProperty('--cake-turn',`${-16+360*progress}deg`);
   pancake.style.setProperty('--cake-face',String(.30+.70*Math.abs(Math.cos(progress*Math.PI*2))));
   scene.style.setProperty('--pan-tilt',`${-4.5*rise+1.5*idle}deg`);
   return;
  }
  const x=index%columns/(columns-1)*100;
  const y=Math.floor(index/columns)/(rows-1)*100;
  sprite.style.backgroundPosition=`${x}% ${y}%`;
  sprite.hidden=false;
  poster.hidden=true;
 }

 function report(message){
  hint.textContent=message;
  status.textContent=message;
  clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>{hint.textContent='Flip the pancake';},1900);
 }

 function clearToss(){
  tossTime=null;
  scene.classList.remove('is-flipping');
  scene.removeAttribute('aria-busy');
 }

 function finishToss(){
  draw(restFrame);
  idleTime=0;
  clearToss();
  report('Nice flip!');
  window.dispatchEvent(new Event('lemrix:kitchen-flipped'));
  sync();
 }

 const ambient=()=>near&&motion.enabled&&!motion.systemReduced;
 const playing=()=>ready&&(tossTime!==null||ambient())&&!document.hidden&&
  (!hub||(hub.open&&!panel?.hidden))&&
  ![...document.querySelectorAll('dialog[open]')].some(dialog=>dialog!==hub);

 function tick(now=performance.now()){
  if(!playing()){sync();return;}
  const delta=Math.max(0,Math.min(now-lastTime,92));
  lastTime=now;
  if(tossTime!==null){
   scene.classList.add('is-flipping');
   if(hint.textContent!=='Flipping…')hint.textContent='Flipping…';
   tossTime+=delta;
   if(tossTime>=tossDuration)finishToss();
   else draw(Math.floor(tossTime*restFrame/tossDuration));
   return;
  }
  // Frames 24–47 show the stirring loop with the pancake resting in the pan.
  idleTime+=delta;
  const step=Math.floor(idleTime*12/1000)%(idleSpan*2);
  draw(restFrame+Math.min(step,idleSpan*2-step));
 }

 function loadAtlas(){
  if(image||pancake)return;
  image=new Image();
  image.onload=()=>{
   sprite.style.backgroundImage=`url("${image.src}")`;
   ready=true;
   sync();
  };
  image.onerror=()=>{
   image=null;
   if(tossTime!==null){clearToss();report('Tap to retry the flip.');}
  };
  image.src=sprite.dataset.atlas;
 }

 function sync(){
  if(!playing()){
   if(clock)clearInterval(clock);
   clock=0;
  }else if(!clock){
   lastTime=performance.now();
   clock=setInterval(tick,1000/24);
   tick(lastTime);
  }
 }

 function setNear(visible){
  near=visible;
  if(near)loadAtlas();
  sync();
 }

 // A deliberate tap has its own short clock. Reduced motion and the
 // site's pause control stop the idle loop without swallowing the toss.
 scene.addEventListener('click',()=>{
  if(tossTime!==null)return;
  clearTimeout(hintTimer);
  hint.textContent=ready?'Flip the pancake':'Warming the pan…';
  status.textContent='';
  tossTime=0;
  scene.setAttribute('aria-busy','true');
  loadAtlas();
  sync();
 });

 if(typeof IntersectionObserver==='function'){
  new IntersectionObserver(([entry])=>setNear(entry.isIntersecting),{rootMargin:'180px 0px'}).observe(scene);
 }else{
  const measure=()=>setNear(motion.isOnScreen(scene));
  window.addEventListener('scroll',measure,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  measure();
 }
 window.addEventListener('lemrix:motion-change',sync);
 window.addEventListener('lemrix:dialog',sync);
 window.addEventListener('lemrix:hub-panel',sync);
 document.addEventListener('visibilitychange',sync);
 window.addEventListener('pagehide',()=>{
  if(clock)clearInterval(clock);
  clock=0;
 });
 window.addEventListener('pageshow',sync);
})();
