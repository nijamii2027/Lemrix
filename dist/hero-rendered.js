const directory='/assets/opening/hero/';

function image(source){
 return new Promise((resolve,reject)=>{
  const result=new Image();
  result.onload=()=>resolve(result);
  result.onerror=reject;
  result.src=directory+source;
 });
}

export async function startRenderedHero(hero){
 const motion=window.LemrixMotionState;
 const figure=hero.querySelector('.moon-diorama');
 const old=figure.querySelector('canvas');
 const canvas=old.cloneNode();
 old.replaceWith(canvas);
 const context=canvas.getContext('2d');
 if(!context)return;
 const metadata=await fetch(directory+'animation.json').then(response=>response.json());
 const sheets=new Map();
 let index=0,elapsed=0,clock=0,last=0,lastFrame=-1,visible=motion.isOnScreen(hero);
 function loadSheet(number){
  if(!sheets.has(number))sheets.set(number,image(`mascots-${number}.webp`));
  return sheets.get(number);
 }
 const [backdrop,first]=await Promise.all([image('backdrop.webp'),loadSheet(0)]);
 let atlas=first;
 canvas.width=metadata.frameWidth;
 canvas.height=metadata.frameHeight;
 Object.assign(canvas.style,{inset:'auto',left:metadata.left/metadata.width*100+'%',
  top:metadata.top/metadata.height*100+'%',width:metadata.frameWidth/metadata.width*100+'%',
  height:metadata.frameHeight/metadata.height*100+'%'});
 function paint(now){
  elapsed+=Math.min(Math.max(now-last,0),100);
  last=now;
  const frame=Math.floor(elapsed*metadata.fps/1000)%metadata.frameCount;
  if(frame===lastFrame)return;
  const sheet=Math.floor(frame/metadata.framesPerSheet);
  if(sheet!==index){
   loadSheet(sheet).then(next=>{
    atlas=next;index=sheet;lastFrame=-1;
    for(const key of sheets.keys())if(key!==sheet&&key!==(sheet+1)%4)sheets.delete(key);
   });
   return;
  }
  const position=frame%metadata.framesPerSheet;
  context.clearRect(0,0,canvas.width,canvas.height);
  context.drawImage(atlas,(position%metadata.columns)*canvas.width,
   Math.floor(position/metadata.columns)*canvas.height,canvas.width,canvas.height,
   0,0,canvas.width,canvas.height);
  lastFrame=frame;
  canvas.dataset.frame=String(frame);
  if(position>metadata.framesPerSheet-8)loadSheet((sheet+1)%4);
 }
 function sync(){
  const active=motion.enabled&&visible&&!document.hidden
   &&!document.querySelector('dialog[open]');
  if(active&&!clock){last=performance.now();clock=setInterval(()=>paint(performance.now()),1000/24);}
  else if(!active&&clock){clearInterval(clock);clock=0;}
 }
 figure.querySelector('img').src=backdrop.src;
 figure.classList.remove('has-live-scene');
 figure.classList.add('has-rendered-scene');
 canvas.hidden=false;
 last=performance.now();
 paint(last);
 sync();
 new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();},{rootMargin:'60px'}).observe(hero);
 window.addEventListener('lemrix:motion-change',sync);
 window.addEventListener('lemrix:dialog',sync);
 document.addEventListener('visibilitychange',sync);
 window.addEventListener('pagehide',()=>{clearInterval(clock);clock=0;});
 window.addEventListener('pageshow',sync);

 const handImages=await Promise.all([image('hand-lemrix.webp?v=paws-22'),image('hand-cookd.webp?v=paws-22')]);
 const hands=hero.querySelector('#hero-hands');
 const handContext=hands.getContext('2d');
 if(!handContext)return;
 const rigs=handImages.map(()=>({x:0,y:0,scale:1,rotation:0,opening:0,visible:0}));
 function renderHands(){
  const stage=hero.querySelector('.moon-stage');
  const ratio=Math.min(devicePixelRatio||1,2);
  const width=Math.round(stage.clientWidth*ratio),height=Math.round(stage.clientHeight*ratio);
  if(hands.width!==width||hands.height!==height){hands.width=width;hands.height=height;}
  handContext.setTransform(ratio,0,0,ratio,0,0);
  handContext.clearRect(0,0,stage.clientWidth,stage.clientHeight);
  let any=false;
  rigs.forEach((rig,number)=>{
   if(rig.visible<.01)return;
   any=true;
   const frame=Math.max(0,Math.min(15,Math.round(rig.opening*15)));
   const width=rig.scale*12,height=width*248/800;
   handContext.save();
   handContext.translate(rig.x,rig.y);
   handContext.rotate(rig.rotation);
   handContext.drawImage(handImages[number],(frame%4)*800,Math.floor(frame/4)*248,800,248,
    -width*.925,-height*.536,width,height);
   handContext.restore();
  });
  hands.hidden=!any;
 }
 window.LemrixHeroHands={rigs,render:renderHands,dispose:()=>{
  hands.hidden=true;
  hands.width=hands.height=1;
  handImages.length=0;
 }};
 hero.classList.add('has-live-hands');
 hero.dataset.render='rendered';
}
