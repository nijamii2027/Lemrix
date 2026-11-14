import { THREE, M, makeCharacters, poseCharacters } from '/play/characters.js';
import { makeStorefront } from '/mascots/storefront.js';
import { makeHand,poseHand } from '/mascots/hands.js?v=paws-22';
import { RoomEnvironment } from '/mascots/vendor/RoomEnvironment.js';

const hero=document.querySelector('.moon-hero');
const canvas=hero.querySelector('#hero-scene');
const figure=hero.querySelector('.moon-diorama');
const handsCanvas=hero.querySelector('#hero-hands');
const motion=window.LemrixMotionState;
let renderer,handRenderer,scene,camera,pair,storefront,handScene,handCamera;
let clock=0,elapsed=0,last=0,visible=motion.isOnScreen(hero),contextLost=false,handsReleased=false;
const handRigs=[];

function createRenderer(target){
 const gl=target.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power'});
 if(!gl)return null;
 const result=new THREE.WebGLRenderer({canvas:target,context:gl,alpha:true,antialias:true});
 result.setClearColor(0,0);
 result.setPixelRatio(Math.min(devicePixelRatio||1,2));
 result.outputColorSpace=THREE.SRGBColorSpace;
 result.toneMapping=THREE.ACESFilmicToneMapping;
 result.toneMappingExposure=1.04;
 return result;
}

function light(target){
 target.add(new THREE.HemisphereLight('#d7e6f7','#6e6678',2.0));
 const key=new THREE.DirectionalLight('#fff0d4',3.5);
 key.position.set(-4,7,7);
 target.add(key);
 const rim=new THREE.DirectionalLight('#b7dced',1.7);
 rim.position.set(5,4,-4);
 target.add(rim);
 return key;
}

function renderHands(){
 if(!handRenderer||contextLost||handsReleased)return;
 let any=false;
 for(const hand of handRigs){
  hand.root.visible=hand.visible>.01;
  if(!hand.root.visible)continue;
  any=true;
  poseHand(hand);
 }
 handsCanvas.hidden=!any;
 if(any)handRenderer.render(handScene,handCamera);
}

function resize(){
 if(!renderer)return;
 const width=figure.clientWidth;
 const height=figure.clientHeight;
 if(!width||!height)return;
 renderer.setSize(width,height,false);
 const span=6.9;
 const aspect=width/height;
 camera.left=-span*aspect/2;
 camera.right=span*aspect/2;
 camera.top=span/2;
 camera.bottom=-span/2;
 camera.updateProjectionMatrix();
 renderer.render(scene,camera);
 if(handRenderer&&!handsReleased){
  const stage=hero.querySelector('.moon-stage');
  const width=stage.clientWidth,height=stage.clientHeight;
  handRenderer.setSize(width,height,false);
  handCamera.right=width;
  handCamera.bottom=height;
  handCamera.updateProjectionMatrix();
  renderHands();
 }
}

function paint(now){
 if(!renderer||contextLost)return;
 const dt=Math.min((now-last)/1000,.08);
 last=now;
 if(motion.enabled)elapsed+=dt;
 const phase=elapsed*Math.PI*2/8;
 // Every rig property repeats over the same continuous eight-second cycle.
 poseCharacters(pair,phase/1.7,{facing:Math.PI});
 [pair.cookd,pair.lemrix].forEach((character,index)=>{
  const offset=index*.65;
  character.root.position.y=.09+Math.sin(phase+offset)*.016;
  character.torso.rotation.z=Math.sin(phase+offset)*.012;
  character.torso.scale.y=1+Math.sin(phase+offset)*.006;
  character.tail.rotation.y=Math.sin(phase+offset)*.07;
  character.tail.rotation.z=Math.cos(phase+offset)*.025;
  character.arms.forEach(arm=>arm.rotation.x=Math.sin(phase+offset)*.012);
  const blink=1-Math.pow(Math.max(0,Math.cos(phase*2-1.4+offset)),42)*.88;
  character.eyes.forEach(eye=>eye.scale.y=.055*blink);
 });
 const wave=Math.pow(Math.max(0,Math.sin(phase)),4);
 pair.cookd.arms[0].rotation.z=-wave*.45;
 pair.cookd.arms[0].rotation.x=Math.sin(phase*4)*wave*.16;
 pair.lemrix.arms[1].rotation.z=wave*.46;
 pair.lemrix.arms[1].rotation.x=-Math.sin(phase*4+.4)*wave*.13;
 pair.cookd.ears.forEach((ear,index)=>ear.rotation.z=Math.sin(phase+index)*.018);
 pair.cookd.bone.rotation.z=.33+Math.sin(phase)*.008;
 storefront.stars.forEach((star,index)=>star.scale.setScalar(star.userData.baseScale*(1+Math.sin(phase+index)*.07)));
 renderer.render(scene,camera);
 canvas.dataset.frame=String(Math.floor(elapsed*30)%240);
}

function sync(){
 const active=visible&&motion.enabled&&!document.hidden
  &&!document.querySelector('dialog[open]')&&!contextLost;
 if(active&&!clock&&renderer){
  last=performance.now();
  clock=setInterval(()=>paint(performance.now()),1000/30);
 }else if(!active&&clock){
  clearInterval(clock);
  clock=0;
 }
}

async function init(){
 renderer=createRenderer(canvas);
 if(!renderer)throw new Error('The hero needs WebGL2.');
 scene=new THREE.Scene();
 camera=new THREE.OrthographicCamera(-6,6,4.5,-4.5,.1,80);
 camera.position.set(7.4,6.5,13);
 camera.lookAt(0,2.0,-.15);
 const key=light(scene);
 renderer.shadowMap.enabled=true;
 renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 key.castShadow=true;
 key.shadow.mapSize.set(1024,1024);
 Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:28});
 key.shadow.camera.updateProjectionMatrix();
 key.shadow.normalBias=.035;
 key.shadow.bias=-.0003;
 const pmrem=new THREE.PMREMGenerator(renderer);
 const room=new RoomEnvironment();
 const environment=pmrem.fromScene(room,.04);
 scene.environment=environment.texture;
 scene.environmentIntensity=.32;
 room.dispose();
 pmrem.dispose();
 storefront=makeStorefront(renderer);
 scene.add(storefront.root);
 pair=makeCharacters(storefront.root);
 storefront.contact(storefront.root,pair.cookd.home.x,pair.cookd.home.z,1.8,1.35,.5);
 storefront.contact(storefront.root,pair.lemrix.home.x,pair.lemrix.home.z,1.8,1.4,.48);
 await storefront.ready;
 last=performance.now();
 resize();
 paint(last);
 renderer.shadowMap.autoUpdate=false;
 figure.classList.add('has-live-scene');
 canvas.hidden=false;
 try{
  handRenderer=createRenderer(handsCanvas);
  if(handRenderer){
   handScene=new THREE.Scene();
   handCamera=new THREE.OrthographicCamera(0,hero.clientWidth,0,hero.clientHeight,.1,3000);
   handCamera.position.z=1000;
   light(handScene);
   handRigs.push(makeHand(handScene,M.blue,-1),makeHand(handScene,M.tan,1));
   resize();
   window.LemrixHeroHands={rigs:handRigs,render:renderHands,dispose:()=>{
    handsReleased=true;
    handsCanvas.hidden=true;
    for(const rig of handRigs)rig.mesh.skeleton.dispose();
    handRenderer.dispose();
   }};
   hero.classList.add('has-live-hands');
  }
 }catch(error){console.warn('The hand illustration is being used.',error);}
 hero.dataset.render='live';
 sync();
 new ResizeObserver(resize).observe(figure);
 new ResizeObserver(resize).observe(hero.querySelector('.moon-stage'));
 canvas.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  contextLost=true;
  figure.classList.remove('has-live-scene');
  canvas.hidden=true;
  sync();
 });
}

new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();},{rootMargin:'60px'}).observe(hero);
window.addEventListener('lemrix:motion-change',sync);
window.addEventListener('lemrix:dialog',sync);
document.addEventListener('visibilitychange',sync);
window.addEventListener('pagehide',()=>{clearInterval(clock);clock=0;});
window.addEventListener('pageshow',sync);
init().catch(async error=>{
 try{
  const {startRenderedHero}=await import('/hero-rendered.js?v=paws-22');
  await startRenderedHero(hero);
 }catch(fallbackError){
  hero.dataset.render='illustrated';
  console.warn('The hero illustration is being used.',error,fallbackError);
 }
}).finally(()=>window.dispatchEvent(new Event('lemrix:hero-ready')));
