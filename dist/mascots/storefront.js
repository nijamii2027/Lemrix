// The original miniature shop, shared by its standalone scene and landing.
import { THREE, M, mesh, box, ellipsoid, tube } from '/play/characters.js';

export function makeStorefront(renderer) {
 const world = new THREE.Group();
 let stars = [];
 const V = (x,y,z) => new THREE.Vector3(x,y,z);
 function radialTexture() {
   const c = document.createElement('canvas'); c.width=c.height=128;
   const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,0,64,64,64);
   g.addColorStop(0,'rgba(0,0,0,.5)');g.addColorStop(.35,'rgba(0,0,0,.3)');g.addColorStop(1,'rgba(0,0,0,0)');
   ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
   return new THREE.CanvasTexture(c);
 }
 const contactTexture=radialTexture();
 function contact(parent,x,z,sx,sz,opacity=.5) {
   const o=mesh(new THREE.PlaneGeometry(sx,sz),new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false,opacity}),parent,[x,.102,z],null,false);
   o.rotation.x=-Math.PI/2;return o;
 }
 
 function makeCup(parent,x,y,z) {
   mesh(new THREE.CylinderGeometry(.075,.06,.13,20),M.ivory,parent,[x,y+.065,z]);
   mesh(new THREE.CylinderGeometry(.061,.061,.004,20),M.wood,parent,[x,y+.133,z]);
   const h=mesh(new THREE.TorusGeometry(.047,.013,8,18),M.ivory,parent,[x+.085,y+.075,z]); h.rotation.y=Math.PI/2;
   mesh(new THREE.CylinderGeometry(.11,.11,.014,24),M.ivory,parent,[x,y,z]);
 }
 function makePendant(parent,x,z) {
   tube(parent,[[x,2.76,z],[x,2.29,z]],.012,M.ink);
   const shape=new THREE.ConeGeometry(.27,.18,32,1,true);
   mesh(shape,M.ink,parent,[x,2.23,z]);
   ellipsoid(parent,[x,2.17,z],[.095,.07,.095],M.luminous,false);
 }
 
 function makeShop() {
   const shop = new THREE.Group(); world.add(shop); shop.position.set(.25,0,-1.75);
   box(shop,[5.25,3.75,1.62],[0,1.875,-.4],M.plaster,.065);
   box(shop,[.045,3.36,1.43],[2.637,1.76,-.4],M.plasterSide,.025);
   box(shop,[5.52,.22,1.94],[0,3.82,-.4],M.roof,.055);
   box(shop,[5.48,.045,1.93],[0,3.70,-.4],M.ink,.018);
   box(shop,[5.48,.07,1.91],[0,3.95,-.4],M.paper,.025);
   // Recessed panes with small physical objects behind the glass.
   const facadeZ=.455;
   const panes=[{x:-1.56,w:1.47},{x:0,w:1.08},{x:1.56,w:1.47}];
   for (const {x,w} of panes) {
     box(shop,[w+.15,2.31,.09],[x,1.33,facadeZ],M.ink,.018);
     box(shop,[w,2.16,.06],[x,1.34,facadeZ+.058],M.window,.014,false);
     box(shop,[w,.055,.16],[x,2.11,facadeZ+.12],M.wood,.01);
     box(shop,[w+.04,.07,.24],[x,.22,facadeZ+.14],M.wood,.018);
     box(shop,[.025,2.17,.025],[x-w/2+.025,1.34,facadeZ+.098],M.gold,.008,false);
     const reflection=mesh(new THREE.PlaneGeometry(.08,1.9),new THREE.MeshBasicMaterial({color:'#fff6df',opacity:.12,transparent:true,depthWrite:false}),shop,[x-w*.26,1.4,facadeZ+.13],null,false);
     reflection.rotation.z=-.2;
   }
   box(shop,[.055,.24,.09],[.39,1.22,facadeZ+.14],M.gold,.022);
   makePendant(shop,-1.56,.59);makePendant(shop,1.56,.59);
   // Café and collector details remain understated at this miniature scale.
   for (const x of [-1.56,1.56]) {
     box(shop,[.91,.08,.32],[x,.87,.65],M.wood,.025);
     for(const dx of [-.34,.34]) box(shop,[.045,.62,.04],[x+dx,.54,.63],M.ink,.012);
   }
   makeCup(shop,1.4,.92,.67);makeCup(shop,1.73,.92,.67);
   for(let i=0;i<3;i++) {
     const card=box(shop,[.22,.32,.025],[-1.91+i*.34,1.08,.69],i===1?M.blueLight:M.apron,.018);
     card.rotation.z=(i-1)*-.09;
     ellipsoid(shop,[-1.91+i*.34,1.09,.71],[.058,.058,.005],M.paper,false);
   }
   const sign=box(shop,[5.02,1.12,.18],[0,3.08,.57],M.ink,.055);
   box(shop,[4.84,1.04,.06],[0,3.08,.683],M.gold,.03);
   const surface=mesh(new THREE.PlaneGeometry(4.73,.985),new THREE.MeshStandardMaterial({color:'#f9e6b5',emissive:'#efc780',emissiveIntensity:.35,roughness:.8}),shop,[0,3.08,.722],null,false);
   // Affine sampling preserves the actual paired wordmarks from panel one.
   const image=new Image();image.src='/assets/cookd-story/chapter-01.jpg';
   const signLoaded=new Promise(resolve=>{
     image.onload=()=>{
       const c=document.createElement('canvas');c.width=1536;c.height=320;
       const ctx=c.getContext('2d');
       const x=808,y=512,ax=1053,ay=-96,bx=5,by=225,det=ax*by-ay*bx;
       const a=c.width*by/det,b=-c.height*ay/det,cc=-c.width*bx/det,d=c.height*ax/det;
       ctx.setTransform(a,b,cc,d,-a*x-cc*y,-b*x-d*y);ctx.drawImage(image,0,0);
       const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
       surface.material.map=texture;surface.material.color.set('#ffffff');surface.material.needsUpdate=true;resolve();
     };
     image.onerror=()=>resolve();
   });
   // A brass, hanging "soon" plaque in the door.
   const c=document.createElement('canvas');c.width=256;c.height=160;const ctx=c.getContext('2d');
   ctx.fillStyle='#f5e4bf';ctx.fillRect(0,0,256,160);ctx.strokeStyle='#786448';ctx.lineWidth=4;ctx.strokeRect(10,10,236,140);
   ctx.font='500 20px Ranade, sans-serif';ctx.textAlign='center';ctx.fillStyle='#24304e';ctx.fillText('THE NEXT CHAPTER',128,57);ctx.font='40px Caprasimo, serif';ctx.fillText('Soon.',128,111);
   const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
   mesh(new THREE.PlaneGeometry(.51,.32),new THREE.MeshStandardMaterial({map:tex,roughness:.9}),shop,[0,1.7,.61],null,false);
   tube(shop,[[-.2,1.85,.6],[0,2.02,.59],[.2,1.85,.6]],.007,M.wood);
   // Roof drain and quiet architectural details on the visible side.
   tube(shop,[[2.68,3.70,-.34],[2.68,3.44,-.34],[2.69,3.38,-.57],[2.69,.35,-.57],[2.69,.2,-.4]],.043,M.ink);
   box(shop,[.055,.55,.67],[2.672,1.67,-.57],M.roof,.025);
   for(let i=0;i<4;i++)box(shop,[.009,.018,.5],[2.708,1.5+i*.11,-.57],M.ink,.005,false);
   contact(world,.25,-1.55,6.4,3.2,.55);
   return signLoaded;
 }
 
 function makeTree() {
   const g=new THREE.Group();g.position.set(-3.08,0,-1.1);world.add(g);
   box(g,[.88,.42,1.12],[0,.21,0],M.roof,.12);
   box(g,[.81,.055,1.05],[0,.43,0],M.ink,.06);
   tube(g,[[0,.4,0],[.02,1.23,0],[-.06,2.01,-.04]],.085,M.wood);
   const leaves=[[-.27,1.33,.1,.43],[.24,1.54,.13,.43],[-.25,1.83,-.06,.5],[.22,2.08,-.04,.52],[-.21,2.35,.03,.48],[.08,2.65,-.02,.37],[.05,2.9,0,.23],[-.4,1.65,.2,.27],[.38,1.93,.05,.3]];
   for(let i=0;i<leaves.length;i++){const [x,y,z,r]=leaves[i];ellipsoid(g,[x,y,z],[r,r*.95,r*.76],i%3===0?M.leafDark:M.leaf);}
   contact(world,-3.05,-1.1,1.7,1.5,.42);
   // Two small terracotta pots on the other side of the entrance.
   for(const [x,z,s] of [[3,-1.5,1],[3.27,-.86,.68]]){
     const p=new THREE.Group();p.position.set(x,0,z);p.scale.setScalar(s);world.add(p);
     mesh(new THREE.CylinderGeometry(.26,.2,.44,32),M.wood,p,[0,.22,0]);
     mesh(new THREE.TorusGeometry(.257,.025,8,32),M.plaster,p,[0,.43,0]).rotation.x=Math.PI/2;
     for(let i=0;i<7;i++){const a=i*2.39996;const l=ellipsoid(p,[Math.cos(a)*.13,.62+(i%2)*.09,Math.sin(a)*.13],[.1,.3,.075],i%2?M.leaf:M.leafDark);l.rotation.z=Math.sin(a)*.45;l.rotation.x=Math.cos(a)*.4;}
   }
 }
 
 function makeBase() {
   box(world,[8.05,.28,6.15],[0,-.21,-.1],M.baseLower,.18);
   box(world,[8.15,.18,6.24],[0,-.04,-.1],M.base,.14);
   box(world,[7.88,.04,6.03],[0,.065,-.1],M.tile,.1);
   // Large paving slabs and narrow recessed joints.
   for(const x of [-2.66,-1.33,0,1.33,2.66])box(world,[.012,.004,5.8],[x,.088,-.12],M.base,.001,false);
   for(const z of [-2.1,-.8,.5,1.8])box(world,[7.75,.004,.012],[0,.089,z],M.base,.001,false);
   box(world,[7.9,.11,.14],[0,.065,2.95],M.roof,.025);
   // Light spilling onto the pavement: feathered, transparent, not an opaque decal.
   const c=document.createElement('canvas');c.width=128;c.height=256;const ctx=c.getContext('2d');
   const gradient=ctx.createLinearGradient(0,0,0,256);gradient.addColorStop(0,'rgba(255,214,133,.33)');gradient.addColorStop(.45,'rgba(255,214,133,.18)');gradient.addColorStop(1,'rgba(255,214,133,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,256);
   const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
   for(const x of [-1.3,.25,1.8]) {
     const g=new THREE.PlaneGeometry(1.4,3.5);const a=g.attributes.position;
     for(let i=0;i<a.count;i++)if(a.getY(i)<0)a.setX(i,a.getX(i)*1.6);
     const o=mesh(g,new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,opacity:.8,side:THREE.DoubleSide}),world,[x,.095,.75],null,false);o.rotation.x=-Math.PI/2;
   }
   const plaque=box(world,[1.7,.16,.018],[0,-.16,3.042],M.gold,.025);
   const label=document.createElement('canvas');label.width=680;label.height=80;const lc=label.getContext('2d');lc.fillStyle='#d9b975';lc.fillRect(0,0,680,80);lc.font='500 27px Ranade, sans-serif';lc.textAlign='center';lc.fillStyle='#354160';lc.fillText('COOK’D  ×  LEMRIX',340,51);const lt=new THREE.CanvasTexture(label);lt.colorSpace=THREE.SRGBColorSpace;
   mesh(new THREE.PlaneGeometry(1.58,.13),new THREE.MeshStandardMaterial({map:lt,roughness:.7,metalness:.2}),world,[0,-.16,3.054],null,false);
 }
 
 function makeSky() {
   // A continuous crescent outline with a soft, rounded edge.
   const moonShape=new THREE.Shape();moonShape.moveTo(.23,.46);
   moonShape.bezierCurveTo(-.39,.69,-.69,-.17,-.13,-.44);
   moonShape.bezierCurveTo(.14,-.57,.46,-.39,.53,-.19);
   moonShape.bezierCurveTo(-.04,-.44,-.36,.17,.23,.46);
   const moon=mesh(new THREE.ExtrudeGeometry(moonShape,{depth:.1,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.025,bevelThickness:.025,curveSegments:32}),M.luminous,world,[2.62,5,-1.78]);moon.rotation.y=.22;moon.rotation.z=-.12;
   const starShape=new THREE.Shape();starShape.moveTo(0,.12);starShape.quadraticCurveTo(.02,.02,.1,0);starShape.quadraticCurveTo(.02,-.02,0,-.12);starShape.quadraticCurveTo(-.02,-.02,-.1,0);starShape.quadraticCurveTo(-.02,.02,0,.12);
   const geo=new THREE.ExtrudeGeometry(starShape,{depth:.025,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.008,bevelThickness:.008,curveSegments:8});
   stars=[];
   const positions=[[-2.8,3.85,-1.9],[-1.75,4.65,-2.05],[-.76,4.2,-2.4],[.15,4.9,-1.85],[1.25,4.23,-1.8],[3.45,3.72,-1.6],[-3.45,3.1,-1.5],[3.8,2.68,-1.8],[-.7,5.08,-2.2]];
   positions.forEach((p,i)=>{const m=mesh(geo,M.luminous.clone(),world,p,null,false);const s=i%3===0?.75:.38;m.scale.setScalar(s);m.rotation.z=i*.71;m.userData.baseScale=s;stars.push(m);});
 }
 
 makeBase();
 const ready=makeShop();
 makeTree();
 makeSky();
 return {root:world,stars,ready,contact};
}
