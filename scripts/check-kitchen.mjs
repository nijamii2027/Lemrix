import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const attrs=new Map();
const classes=new Set();
const frames=[];
const events=new Map();
let click, observe, image, interval;
let time=0, flips=0;
const hub={open:true};
const panel={hidden:false};
const scene={
 classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
 addEventListener:(_,callback)=>{click=callback;},
 setAttribute:(key,value)=>attrs.set(key,value),
 removeAttribute:key=>attrs.delete(key),
 closest:selector=>selector==='dialog'?hub:panel
};
const sprite={
 style:{set backgroundPosition(value){frames.push(value);}},
 dataset:{atlas:'/play/assets/kitchen-frames.webp'},
 hidden:true
};
const poster={hidden:false};
const status={textContent:''};
const nodes={
 '#flip-pancake':scene,'#kitchen-frames':sprite,'#kitchen-poster':poster,
 '#kitchen-hint':{},'#kitchen-status':status
};
const motion={enabled:true,systemReduced:true};
const document={
 hidden:false,
 querySelector:selector=>nodes[selector]??null,
 querySelectorAll:()=>hub.open?[hub]:[],
 addEventListener:(name,callback)=>events.set(name,callback)
};
runInNewContext(readFileSync(new URL('../dist/play/kitchen.js',import.meta.url),'utf8'),{
 window:{
  LemrixMotionState:motion,
  addEventListener:(name,callback)=>events.set(name,callback),
  dispatchEvent:event=>{if(event.type==='lemrix:kitchen-flipped')flips++;}
 },
 document,
 Image:class{constructor(){image=this;}},
 IntersectionObserver:class{constructor(callback){observe=callback;} observe(){}},
 Event:class{constructor(type){this.type=type;}},
 performance:{now:()=>time},
 setInterval:callback=>{interval=callback;return 1;},
 clearInterval:()=>{interval=null;},
 setTimeout:()=>1,
 clearTimeout:()=>{}
});
function advance(milliseconds){
 const end=time+milliseconds;
 while(time<end){time+=42;interval?.();}
}

observe([{isIntersecting:true}]);
click();
assert.equal(attrs.get('aria-busy'),'true');
assert.equal(flips,0);
assert.equal(frames.length,0);
image.onload();
advance(1150);
assert.ok(frames.length>=15);
assert.ok(frames.some(position=>position.endsWith('20%')));
assert.equal(frames.at(-1),'0% 60%');
assert.equal(poster.hidden,true);
assert.equal(sprite.hidden,false);
assert.equal(attrs.has('aria-busy'),false);
assert.equal(classes.has('is-flipping'),false);
assert.equal(status.textContent,'Nice flip!');
assert.equal(flips,1);
assert.equal(interval,null);

motion.enabled=false;
click();
advance(1150);
assert.equal(flips,2,'An explicit tap still flips with ambient motion paused.');
assert.equal(frames.at(-1),'0% 60%');
assert.equal(interval,null);

click();
advance(250);
document.hidden=true;
events.get('visibilitychange')();
assert.equal(interval,null);
advance(2000);
document.hidden=false;
events.get('visibilitychange')();
advance(1150);
assert.equal(flips,3,'A toss resumes from the same pose when the page returns.');

motion.enabled=true;
motion.systemReduced=false;
frames.length=0;
events.get('lemrix:motion-change')();
advance(2200);
assert.ok(frames.length>15);
assert.ok(frames.every(position=>Number(position.split(' ')[1].replace('%',''))>=60),'Ambient stirring uses only resting frames.');
assert.equal(flips,3);
panel.hidden=true;
events.get('lemrix:hub-panel')();
assert.equal(interval,null,'The clock stops when another search tab opens.');
panel.hidden=false;
events.get('lemrix:hub-panel')();
assert.ok(interval,'The clock starts when the kitchen tab returns.');
hub.open=false;
events.get('lemrix:dialog')();
assert.equal(interval,null,'Closing Card search also stops the kitchen.');
console.log('Kitchen tap, landing, visibility, reduced motion, idle and dialog lifecycle pass.');
