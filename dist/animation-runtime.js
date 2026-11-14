'use strict';

// Embedded browsers can stall their native animation clocks. Recover only the
// animations that have stopped advancing on the visible page.
(() => {
 const motion=window.LemrixMotionState;
 const {gsap}=window;
 if(!motion)return;
 const root=document.documentElement;
 const samples=new WeakMap();
 let previousFrame=gsap?.ticker.frame,lastBrowserTick,lastSample=0;

 function recoverNativeAnimations(now,delta){
  for(const animation of document.getAnimations?.()||[]){
   if(animation.playState!=='running')continue;
   const time=Number(animation.currentTime);
   if(!Number.isFinite(time))continue;
   const previous=samples.get(animation);
   // Do not accelerate animations which already have a working browser clock.
   if(previous&&Math.abs(time-previous.time)<.1&&now-previous.changed>100){
    animation.currentTime=time+delta*(animation.playbackRate||1);
   }
   samples.set(animation,{time:Number(animation.currentTime),
    changed:previous&&Math.abs(time-previous.time)<.1?previous.changed:now});
  }
 }

 motion.onFrame(time=>{
  if(lastBrowserTick===undefined||gsap?.ticker.frame!==previousFrame)lastBrowserTick=time;
  const missed=time-lastBrowserTick>=48;
  if(missed)gsap?.ticker.tick();
  if(time-lastSample>=32){
   recoverNativeAnimations(time,Math.min(100,time-lastSample));
   lastSample=time;
  }
  previousFrame=gsap?.ticker.frame;
  const driver=missed?'timer':'browser';
  if(root.dataset.animationClock!==driver)root.dataset.animationClock=driver;
 });
})();
