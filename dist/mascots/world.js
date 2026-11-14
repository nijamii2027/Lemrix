import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { makeStorefront } from './storefront.js';

// A fully procedural scene. Character meshes, rig, set, lighting and animation
// are code; the shop sign is sampled from the original announcement artwork.
const $ = (s) => document.querySelector(s);
const host = $('#world');
const canvas = $('#scene');
const replayButton = $('#replay');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let usingRenderedFallback = false;
let contextLost = false;
let view = 'scene';
let viewBlend = 0;
let elapsed = 0;
let lastTime = 0;
let frame = 0;
let replayBlend = 0;
let replayStart = 0;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const n = clamp((x - a) / (b - a), 0, 1); return n * n * (3 - 2 * n); };
const pulse = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));
const damping = (a, b, dt, speed = 4) => lerp(a, b, 1 - Math.exp(-dt * speed));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const reference = $('#reference-dialog');
const filmDialog = $('#film-dialog');

function fallback() {
  cancelAnimationFrame(frame);
  usingRenderedFallback = true;
  window.LemrixWorld.showRendered();
}

let renderer, scene, camera;
let cookd, lemrix, world, stars;
let width = 0, height = 0;
const pointer = { x: 0, y: 0, yaw: 0, currentYaw: 0, pitch: 0, down: false, startX: 0, startY: 0, originYaw: 0 };
const cameraTarget = V(0, 1.8, 0);
const cameraPosition = V(6, 5, 11);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: 0, ...options });
}

const M = {
  blue: material('#78c7d7', { roughness: .48 }),
  blueLight: material('#9cdae2', { roughness: .55 }),
  tan: material('#dbb97d', { roughness: .65 }),
  ear: material('#c49e64', { roughness: .74 }),
  ivory: material('#faf0d9', { roughness: .54 }),
  apron: material('#7d859f', { roughness: .96 }),
  apronSeam: material('#a8b0c4', { roughness: .9 }),
  ink: material('#19264a', { roughness: .63 }),
  eyes: material('#182440', { roughness: .24 }),
  gold: material('#d9ab5f', { roughness: .45, metalness: .5 }),
  plaster: material('#dac7a3', { roughness: .94 }),
  plasterSide: material('#b1acaf', { roughness: .95 }),
  roof: material('#a5a8bd', { roughness: .75 }),
  wood: material('#92745a', { roughness: .75 }),
  leaf: material('#4d7464', { roughness: .9 }),
  leafDark: material('#345c56', { roughness: .9 }),
  tile: material('#9aa5b8', { roughness: .95 }),
  base: material('#7985a2', { roughness: .82 }),
  baseLower: material('#46577c', { roughness: .78 }),
  paper: material('#efe2c6', { roughness: .9 }),
  luminous: material('#f5d58d', { emissive: '#f5bd5e', emissiveIntensity: .9, roughness: .6 }),
  window: material('#f5ce88', { emissive: '#f4b44f', emissiveIntensity: .5, roughness: .7 }),
};

function mesh(geo, mat, parent, position = [0, 0, 0], scale = null, cast = true) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(...position);
  if (scale) o.scale.set(...scale);
  o.castShadow = cast;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
const sphereGeometry = new THREE.SphereGeometry(1, 40, 28);
function ellipsoid(parent, pos, size, mat, cast = true) { return mesh(sphereGeometry, mat, parent, pos, size, cast); }
function box(parent, size, pos, mat, radius = .045, cast = true) {
  return mesh(new RoundedBoxGeometry(...size, 3, radius), mat, parent, pos, null, cast);
}
function tube(parent, points, radius, mat, closed = false) {
  const path = new THREE.CatmullRomCurve3(points.map(p => V(...p)), closed, 'centripetal');
  return mesh(new THREE.TubeGeometry(path, Math.max(24, points.length * 9), radius, 10, closed), mat, parent);
}
function tapered(parent, points, radii, mat, flatten = 1) {
  const path = new THREE.CatmullRomCurve3(points.map(p => V(...p)), false, 'centripetal');
  const n = 64, sides = 20, frames = path.computeFrenetFrames(n, false);
  const positions = [], uv = [], indices = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, c = path.getPointAt(u), k = u * (radii.length - 1);
    const r = lerp(radii[Math.floor(k)], radii[Math.min(Math.floor(k) + 1, radii.length - 1)], k % 1);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const p = c.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r * flatten);
      positions.push(p.x, p.y, p.z); uv.push(j / sides, u);
      if (i < n && j < sides) { const x = i * (sides + 1) + j; indices.push(x, x + sides + 1, x + 1, x + 1, x + sides + 1, x + sides + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return mesh(g, mat, parent);
}

// A continuous, softly asymmetric silhouette rather than a stack of spheres.
function bodyGeometry(profile, depth) {
  const curve = new THREE.CatmullRomCurve3(profile.map(([r, y]) => V(r, y, 0)), false, 'centripetal');
  const points = curve.getPoints(100).map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
  const g = new THREE.LatheGeometry(points, 64);
  g.scale(1, 1, depth);
  return g;
}

function makeFoot(root, x, skin) {
  const p = new THREE.Group(); root.add(p); p.position.set(x, .4, 0);
  ellipsoid(p, [0, -.23, -.07], [.22, .24, .33], skin);
  return p;
}

function makeArm(root, x, y, skin) {
  const g = new THREE.Group(); g.position.set(x-Math.sign(x)*.045, y, 0); root.add(g);
  const sign = Math.sign(x);
  ellipsoid(g,[0,.01,0],[.151,.166,.15],skin);
  tapered(g, [[0, .02, 0], [sign * .11, -.19, -.02], [sign * .13, -.43, -.05], [sign * .08, -.57, -.12]], [.15, .145, .12, .085], skin);
  ellipsoid(g, [sign * .08, -.56, -.12], [.14, .14, .105], skin);
  for (let i = 0; i < 3; i++) ellipsoid(g, [sign * (.015 + i * .063), -.64 - (i === 1 ? .015 : 0), -.14], [.046, .075, .055], skin);
  return g;
}

function makeLemrix() {
  const root = new THREE.Group(); world.add(root);
  const torso = new THREE.Group(); root.add(torso);
  mesh(bodyGeometry([[0,.32],[.3,.32],[.48,.48],[.56,.77],[.53,1.07],[.44,1.35],[.5,1.57],[.63,1.83],[.66,2.06],[.54,2.32],[.28,2.48],[0,2.52]], .79), M.blue, torso);
  const arms = [makeArm(torso, -.49, 1.3, M.blue), makeArm(torso, .49, 1.3, M.blue)];
  const feet = [makeFoot(root, -.3, M.blue), makeFoot(root, .3, M.blue)];
  const tail = new THREE.Group(); tail.position.set(.28, .58, .34); torso.add(tail);
  tapered(tail, [[0,0,0],[.32,-.11,.19],[.66,-.07,.48],[.97,.24,.63],[1.09,.67,.66],[1.04,1,.58]], [.29,.27,.23,.18,.115,.008], M.blue, .7);
  // The spare features follow the face visible in the original carousel.
  const eyes = [];
  for (const x of [-.28,.28]) {
    const eye = ellipsoid(torso, [x,2.02,-.47], [.045,.055,.022], M.eyes, false);
    eye.rotation.y = -Math.sign(x) * .33;
    eyes.push(eye);
    ellipsoid(torso, [x-.009,2.038,-.494], [.011,.012,.006], M.ivory, false);
  }
  for (const x of [-.065,.065]) ellipsoid(torso, [x,1.875,-.519], [.015,.01,.008], M.ink, false);
  tube(torso, [[-.21,1.77,-.49],[-.1,1.735,-.515],[.06,1.73,-.52],[.19,1.77,-.5]], .009, M.ink);
  root.position.set(.66,0,1.15);
  root.rotation.y = -.07;
  return {root, torso, arms, feet, tail, eyes, home: root.position.clone(), baseYaw: -.07};
}

function makeCookd() {
  const root = new THREE.Group(); world.add(root);
  const torso = new THREE.Group(); root.add(torso);
  mesh(bodyGeometry([[0,.35],[.34,.36],[.53,.53],[.56,.82],[.51,1.12],[.6,1.37],[.64,1.62],[.58,1.86],[.37,2.02],[0,2.07]], .82), M.tan, torso);
  const ears = [];
  for (const side of [-1,1]) {
    const ear = new THREE.Group(); ear.position.set(side*.47,1.8,0); torso.add(ear);
    tapered(ear, [[0,0,0],[side*.13,-.15,-.04],[side*.17,-.4,-.05],[side*.11,-.61,-.04]], [.2,.21,.17,.025], M.ear, .48);
    ellipsoid(ear,[side*.11,-.34,-.11],[.07,.21,.023],M.tan);
    ears.push(ear);
  }
  const arms = [makeArm(torso,-.51,1.18,M.tan), makeArm(torso,.51,1.18,M.tan)];
  const feet = [makeFoot(root,-.29,M.tan),makeFoot(root,.29,M.tan)];
  // Cloth skirt, a front bib, continuous belt and the bow visible from behind.
  mesh(bodyGeometry([[.59,.45],[.6,.5],[.58,.7],[.54,.93]],.86), M.apron, torso);
  const clothPositions=[],clothIndices=[];
  const clothZ=(x,y)=>{const v=(y-.87)/.5;return -lerp(.47,.5,v)*Math.sqrt(1-(x/lerp(.55,.6,v))**2)-.022;};
  for(let row=0;row<=24;row++){
    const v=row/24,y=.87+v*.5,edge=Math.min(.07,v*.5,(1-v)*.5);
    const halfWidth=.23+Math.sqrt(.07**2-(.07-edge)**2);
    for(let col=0;col<=24;col++){
      const x=(col/24-.5)*2*halfWidth;clothPositions.push(x,y,clothZ(x,y));
      if(row<24&&col<24){const n=row*25+col;clothIndices.push(n,n+1,n+25,n+1,n+26,n+25);}
    }
  }
  const clothGeometry=new THREE.BufferGeometry();clothGeometry.setAttribute('position',new THREE.Float32BufferAttribute(clothPositions,3));clothGeometry.setIndex(clothIndices);clothGeometry.computeVertexNormals();
  const clothMaterial=M.apron.clone();clothMaterial.side=THREE.DoubleSide;
  mesh(clothGeometry,clothMaterial,torso);
  tube(torso,[[-.27,1.43,-.4],[-.27,1.7,-.17],[-.24,1.72,.16],[-.25,1.29,.43]],.027,M.apron);
  tube(torso,[[.27,1.43,-.4],[.27,1.7,-.17],[.24,1.72,.16],[.25,1.29,.43]],.027,M.apron);
  const belt = mesh(new THREE.TorusGeometry(.545,.032,8,80),M.apronSeam,torso,[0,.94,0]); belt.rotation.x=Math.PI/2; belt.scale.y=.84;
  const bow = new THREE.Group(); bow.position.set(0,.93,.485); torso.add(bow);
  ellipsoid(bow,[0,0,0],[.06,.065,.045],M.apronSeam);
  tube(bow,[[0,0,0],[-.13,.09,.025],[-.24,-.04,.035],[-.18,-.13,.02],[0,-.015,0]],.024,M.apronSeam);
  tube(bow,[[0,0,0],[.13,.09,.025],[.24,-.04,.035],[.18,-.13,.02],[0,-.015,0]],.024,M.apronSeam);
  tube(bow,[[-.025,-.02,0],[-.075,-.2,.05],[-.11,-.34,.04]],.025,M.apronSeam);
  tube(bow,[[.025,-.02,0],[.07,-.16,.06],[.13,-.29,.03]],.025,M.apronSeam);
  // A tiny stitched pocket on the apron; no invented wordmark.
  tube(torso,[[-.15,1.14,clothZ(-.15,1.14)-.009],[-.15,1.01,clothZ(-.15,1.01)-.009],[0,.99,clothZ(0,.99)-.009],[.15,1.01,clothZ(.15,1.01)-.009],[.15,1.14,clothZ(.15,1.14)-.009]],.006,M.apronSeam);
  const tail = new THREE.Group(); tail.position.set(-.25,.51,.35); torso.add(tail);
  tapered(tail,[[0,0,0],[-.3,-.08,.2],[-.63,-.05,.4],[-.9,.13,.44],[-.94,.39,.41]], [.105,.1,.087,.069,.012],M.tan);
  const bone = new THREE.Group(); bone.position.set(-.24,2,.015); bone.rotation.z=.33; torso.add(bone);
  tube(bone,[[0,-.05,0],[0,.2,0],[0,.43,0]],.065,M.ivory);
  ellipsoid(bone,[-.073,.44,0],[.105,.1,.085],M.ivory);
  ellipsoid(bone,[.073,.44,0],[.105,.1,.085],M.ivory);
  // A small tuft breaks the head silhouette just as in the illustration.
  for (const [x,s] of [[.12,.08],[.23,.06]]) { const tuft=ellipsoid(torso,[x,2,.015],[.06,s,.07],M.tan);tuft.rotation.z=-.5; }
  const eyes = [];
  for (const x of [-.23,.23]) {
    const e=ellipsoid(torso,[x,1.76,-.464],[.039,.048,.022],M.eyes,false);eyes.push(e);
    ellipsoid(torso,[x-.009,1.779,-.485],[.009,.011,.006],M.ivory,false);
  }
  ellipsoid(torso,[0,1.615,-.51],[.071,.045,.035],M.eyes,false);
  tube(torso,[[-.13,1.52,-.505],[-.07,1.48,-.516],[0,1.5,-.52],[.07,1.48,-.516],[.13,1.52,-.505]],.008,M.ink);
  root.position.set(-.98,0,1.16);root.rotation.y=.08;
  return {root,torso,arms,feet,tail,ears,bow,bone,eyes,home:root.position.clone(),baseYaw:.08};
}

function applyPose(t, blend, dt) {
  const move=pulse(3.5,5.4,13,15.5,t);
  const look=pulse(1.6,3.1,6,7.7,t);
  const hello=pulse(7.2,8.1,10.4,11.5,t);
  const step=pulse(4.2,4.65,6.2,6.7,t);
  const walkPhase=(t-4.2)*6.4;
  const idleTime=t;
  const sway=Math.sin(idleTime*1.4)*.017;
  [cookd,lemrix].forEach((c,i)=>{
    const phase=i*1.1;
    c.root.position.z=c.home.z-move*.2;
    c.root.position.y=.09+Math.sin(idleTime*2+phase)*.013+Math.abs(Math.sin(walkPhase))*step*.045;
    c.root.rotation.y=c.baseYaw+(i===0?-.21:.2)*look+blend*Math.PI;
    c.torso.rotation.z=sway*(i===0?1:-.8)+(i===0?-.045:.045)*look;
    c.torso.scale.y=1+Math.sin(idleTime*2+phase)*.007;
    c.torso.scale.x=1-Math.sin(idleTime*2+phase)*.002;
    c.feet.forEach((f,k)=>{f.rotation.x=Math.sin(walkPhase+k*Math.PI+phase)*step*.22;f.position.y=.4+Math.max(0,Math.sin(walkPhase+k*Math.PI+phase))*step*.055;});
    c.arms.forEach((a,k)=>{a.rotation.x=Math.sin(walkPhase+k*Math.PI+phase)*step*.09;a.rotation.z=0;});
    c.tail.rotation.y=Math.sin(idleTime*1.9+phase)*.09;
    c.tail.rotation.z=Math.sin(idleTime*1.8+phase)*.035;
    const blink=pulse(3.6+i*.37,3.68+i*.37,3.78+i*.37,3.87+i*.37,idleTime%5.7);
    c.eyes.forEach(e=>e.scale.y=.055*(1-blink*.88));
  });
  cookd.ears.forEach((e,i)=>{e.rotation.z=Math.sin(idleTime*1.4+i)*.022+look*(i===0?.015:-.04);});
  cookd.bow.rotation.z=Math.sin(idleTime*1.4)*.025;
  cookd.bone.rotation.z=.33+Math.sin(idleTime*1.4)*.012;
  // An understated little wave, followed by a glance towards the shop.
  // Inside hands meet as in the original drawing; the opposite hands take
  // over smoothly when the pair turn to face the viewer.
  cookd.arms[1].rotation.z=.24*(1-blend)+hello*.5*blend;
  cookd.arms[0].rotation.z=-.24*blend-hello*.5*(1-blend);
  lemrix.arms[0].rotation.z=-.24*(1-blend)-hello*.45*blend;
  lemrix.arms[1].rotation.z=.24*blend+hello*.45*(1-blend);
  cookd.arms[0].rotation.x=hello*.13*(1-blend);
  lemrix.arms[1].rotation.x=Math.sin(t*6)*hello*.09*(1-blend);
  stars.forEach((s,i)=>{s.scale.setScalar(s.userData.baseScale*(1+Math.sin(idleTime*.8+i*1.3)*.1));});
}

function resize() {
  const rect=host.getBoundingClientRect();width=rect.width;height=rect.height;
  if(!renderer||!width||!height)return;
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.6:1.8));
  renderer.setSize(width,height,false);
  const aspect=width/height,span=innerWidth<700?10.6:8.6;
  camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();
}

function updateCamera(dt,t) {
  const target=view==='duo'?1:0;
  viewBlend=damping(viewBlend,target,dt,reducedMotion.matches?25:3.2);
  pointer.currentYaw=damping(pointer.currentYaw,pointer.yaw,dt,6);
  const angle=.36+pointer.currentYaw+Math.sin(t*.14)*.023*(1-viewBlend);
  const distance=lerp(13,10.3,viewBlend);
  cameraPosition.set(Math.sin(angle)*distance,lerp(6.0,3.6,viewBlend)+pointer.pitch,Math.cos(angle)*distance);
  cameraTarget.set(lerp(.0,-.12,viewBlend),lerp(2.15,1.4,viewBlend),lerp(-.35,.9,viewBlend));
  camera.position.copy(cameraPosition);camera.lookAt(cameraTarget);
  camera.zoom=lerp(1,1.6,viewBlend);camera.updateProjectionMatrix();
}

function animate(now) {
  frame=requestAnimationFrame(animate);
  const dt=Math.min((now-lastTime)/1000||0,.045);lastTime=now;
  if(document.hidden||contextLost||reference.open||filmDialog.open)return;
  elapsed+=dt;
  if(replayBlend>0){replayBlend=Math.max(0,replayBlend-dt*1.8);elapsed=lerp(0,replayStart,smooth(0,1,replayBlend));}
  const t=elapsed;
  updateCamera(dt,t);
  applyPose(t,viewBlend,dt);
  renderer.render(scene,camera);
}

window.addEventListener('lemrix:scene-replay', () => {
  replayStart = Math.min(elapsed, 16);
  replayBlend = 1;
  $('#caption').textContent = 'Cook’d × Lemrix storefront';
});
viewButtons.forEach(button=>button.addEventListener('click',()=>{
  view=button.dataset.view;
  for(const b of viewButtons){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}
  pointer.yaw=0;pointer.pitch=0;
  $('#caption').textContent=view==='duo'?'Cook’d and Lemrix':'Cook’d × Lemrix storefront';
}));

canvas.addEventListener('pointerdown',e=>{pointer.down=true;pointer.startX=e.clientX;pointer.startY=e.clientY;pointer.originYaw=pointer.yaw;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!pointer.down)return;
  const dx=e.clientX-pointer.startX;
  pointer.yaw=clamp(pointer.originYaw-dx*.003,-.58,.58);
  pointer.pitch=clamp((e.clientY-pointer.startY)*.003,-.4,.4);
  if(Math.abs(dx)>8)document.body.classList.add('has-dragged');
});
const endDrag=()=>{pointer.down=false;pointer.pitch=0;};
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
canvas.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pointer.yaw=clamp(pointer.yaw+(e.key==='ArrowLeft'?-.1:.1),-.58,.58);document.body.classList.add('has-dragged');}
  if(e.key==='Home'){e.preventDefault();pointer.yaw=0;pointer.pitch=0;}
});

async function init() {
  for(const b of [...viewButtons,replayButton])b.disabled=true;
  const context=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'high-performance'});
  if(!context){fallback();return;}
  renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setClearColor(0,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();
  camera=new THREE.OrthographicCamera(-6,6,4.5,-4.5,.1,70);
  const environment=new RoomEnvironment();
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(environment,.05).texture;scene.environmentIntensity=.36;
  environment.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#b2cef3','#7f738a',2.4));
  const key=new THREE.DirectionalLight('#ffe4b5',4.2);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-7;key.shadow.camera.right=7;key.shadow.camera.top=7;key.shadow.camera.bottom=-7;key.shadow.camera.near=.5;key.shadow.camera.far=22;key.shadow.normalBias=.035;key.shadow.bias=-.0002;key.shadow.radius=4;scene.add(key);
  const rim=new THREE.DirectionalLight('#a0cbe9',2.7);rim.position.set(4,4,-4);scene.add(rim);
  const warm=new THREE.PointLight('#ffcf7e',10,6,2);warm.position.set(.5,2.3,-.5);scene.add(warm);
  await document.fonts.ready;
  const storefront=makeStorefront(renderer);
  world=storefront.root;stars=storefront.stars;scene.add(world);
  // The object is suspended in the page; a soft shadow gives it a quiet anchor.
  const floor=mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.12}),scene,[0,-.45,0],null,false);floor.rotation.x=-Math.PI/2;
  cookd=makeCookd();lemrix=makeLemrix();
  storefront.contact(world,cookd.home.x,cookd.home.z,1.8,1.35,.5);storefront.contact(world,lemrix.home.x,lemrix.home.z,1.8,1.4,.48);
  await storefront.ready;
  resize();new ResizeObserver(resize).observe(host);
  applyPose(0,0,0);updateCamera(.1,0);renderer.render(scene,camera);
  document.body.dataset.state='ready';
  for(const b of [...viewButtons,replayButton])b.disabled=false;
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;fallback(new Error('WebGL context lost'));});
  frame=requestAnimationFrame(animate);
}
document.addEventListener('visibilitychange',()=>{lastTime=performance.now();});
window.addEventListener('pagehide',e=>{cancelAnimationFrame(frame);if(!e.persisted)renderer?.dispose();});
window.addEventListener('pageshow',e=>{if(e.persisted&&renderer&&!usingRenderedFallback){lastTime=performance.now();frame=requestAnimationFrame(animate);}});
init().catch(fallback);
