import { THREE } from '/play/characters.js';

const clamp=THREE.MathUtils.clamp;
const mix=THREE.MathUtils.lerp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const join=(a,b,k=.13)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const indexBase=[-.65,-.25,.03],thumbBase=[-.49,.27,.15];
const middleBase=[-.67,-.035,.06];
const end=(p,length,angle)=>[p[0]+Math.cos(angle)*length,p[1]+Math.sin(angle)*length,p[2]];
const indexJoint=end(indexBase,.40,-.42),indexTip=end(indexJoint,.30,-.27);
const thumbJoint=end(thumbBase,.32,.85),thumbTip=end(thumbJoint,.20,.60);
const middleJoint=end(middleBase,.35,-.10),middleTip=end(middleJoint,.25,.10);
let sharedGeometry;

function capsule(x,y,z,a,b,ra,rb){
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
 const u=clamp(((x-a[0])*dx+(y-a[1])*dy+(z-a[2])*dz)/(dx*dx+dy*dy+dz*dz),0,1);
 return Math.hypot(x-a[0]-dx*u,y-a[1]-dy*u,z-a[2]-dz*u)-mix(ra,rb,u);
}
function ellipsoid(x,y,z,c,r){
 const a=(x-c[0])/r[0],b=(y-c[1])/r[1],d=(z-c[2])/r[2];
 const k0=Math.hypot(a,b,d),k1=Math.hypot(a/r[0],b/r[1],d/r[2]);
 return k1?k0*(k0-1)/k1:-Math.min(...r);
}
function distances(x,y,z){
 const armX=clamp(x,-16.2,-1.32);
 const reach=(-1.32-armX)/14.88;
 const armY=.55*reach*(.85+.15*reach);
 const radius=.29+.05*reach+.035*Math.sin(Math.PI*reach);
 const arm=Math.hypot(x-armX,y-armY,z+.16*reach)-radius;
 if(x<-2)return [arm,10,10,10];
 const body=join(arm,ellipsoid(x,y,z,[-.98,.015,0],[.54,.43,.31]),.20);
 const index=join(capsule(x,y,z,indexBase,indexJoint,.195,.17),capsule(x,y,z,indexJoint,indexTip,.17,.135),.09);
 const thumb=join(capsule(x,y,z,thumbBase,thumbJoint,.19,.16),capsule(x,y,z,thumbJoint,thumbTip,.16,.14),.10);
 const middle=join(capsule(x,y,z,middleBase,middleJoint,.17,.145),capsule(x,y,z,middleJoint,middleTip,.145,.125),.085);
 return [body,index,thumb,middle];
}
function field(x,y,z){return distances(x,y,z).reduce((shape,part)=>join(shape,part,.11));}
function along(x,y,z,a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
 return clamp(((x-a[0])*dx+(y-a[1])*dy+(z-a[2])*dz)/(dx*dx+dy*dy+dz*dz),0,1);
}
function weights(x,y,z){
 const ds=distances(x,y,z),minimum=Math.min(...ds);
 const [wb,wi,wt,wm]=ds.map(d=>Math.exp(-22*(d-minimum)));
 const wrist=smooth(-1.75,-.91,x);
 const indexDistal=smooth(.14,.84,along(x,y,z,indexJoint,indexTip));
 const thumbDistal=smooth(.12,.82,along(x,y,z,thumbJoint,thumbTip));
 const middleDistal=smooth(.10,.85,along(x,y,z,middleJoint,middleTip));
 const values=[wb*(1-wrist),wb*wrist,wi*(1-indexDistal),wi*indexDistal,wt*(1-thumbDistal),wt*thumbDistal,
  wm*(1-middleDistal),wm*middleDistal]
  .map((weight,bone)=>({weight,bone})).sort((a,b)=>b.weight-a.weight).slice(0,4);
 const total=values.reduce((sum,v)=>sum+v.weight,0);
 return {indices:values.map(v=>v.bone),weights:values.map(v=>v.weight/total)};
}
function makeGeometry(){
 if(sharedGeometry)return sharedGeometry;
 // One watertight skin blends arm, palm and fingers. Shared vertices and
 // analytic normals remove the seams of the previous overlapping ellipsoids.
 const minimum=[-16.65,-1.04,-.61],maximum=[.65,1.04,.61],step=.04;
 const xs=[];
 for(let x=minimum[0];x< -2.10001;x+=.15)xs.push(x);
 for(let x=-2.1;x<=maximum[0]+step;x+=step)xs.push(x);
 const nx=xs.length,ny=Math.ceil((maximum[1]-minimum[1])/step)+1,nz=Math.ceil((maximum[2]-minimum[2])/step)+1;
 const count=nx*ny*nz;
 const samples=new Float32Array(count),coordinates=new Float32Array(count*3);
 const id=(x,y,z)=>x+nx*(y+ny*z);
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=id(x,y,z),px=xs[x],py=minimum[1]+y*step,pz=minimum[2]+z*step;
  coordinates.set([px,py,pz],i*3);samples[i]=field(px,py,pz);
 }
 const positions=[],indices=[],edgeVertices=new Map();
 function vertex(a,b){
  const key=Math.min(a,b)*count+Math.max(a,b);
  if(edgeVertices.has(key))return edgeVertices.get(key);
  const t=samples[a]/(samples[a]-samples[b]),index=positions.length/3;
  for(let k=0;k<3;k++)positions.push(mix(coordinates[a*3+k],coordinates[b*3+k],t));
  edgeVertices.set(key,index);return index;
 }
 function triangle(a,b,c,towards){
  const ab=[0,1,2].map(k=>positions[b*3+k]-positions[a*3+k]);
  const ac=[0,1,2].map(k=>positions[c*3+k]-positions[a*3+k]);
  const dot=(ab[1]*ac[2]-ab[2]*ac[1])*towards[0]
   +(ab[2]*ac[0]-ab[0]*ac[2])*towards[1]+(ab[0]*ac[1]-ab[1]*ac[0])*towards[2];
  indices.push(a,...(dot>0?[b,c]:[c,b]));
 }
 const tetrahedra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const cube=[id(x,y,z),id(x+1,y,z),id(x+1,y+1,z),id(x,y+1,z),
   id(x,y,z+1),id(x+1,y,z+1),id(x+1,y+1,z+1),id(x,y+1,z+1)];
  const signs=cube.map(i=>samples[i]<0);
  if(signs.every(Boolean)||signs.every(v=>!v))continue;
  for(const tetra of tetrahedra){
   const inside=tetra.filter(i=>signs[i]).map(i=>cube[i]);
   const outside=tetra.filter(i=>!signs[i]).map(i=>cube[i]);
   if(!inside.length||!outside.length)continue;
   const towards=[0,1,2].map(k=>outside.reduce((s,i)=>s+coordinates[i*3+k],0)/outside.length
    -inside.reduce((s,i)=>s+coordinates[i*3+k],0)/inside.length);
   if(inside.length===1){
    triangle(...outside.map(v=>vertex(inside[0],v)),towards);
   }else if(outside.length===1){
    triangle(...inside.map(v=>vertex(v,outside[0])),towards);
   }else{
    const [a,b]=inside,[c,d]=outside;
    const ac=vertex(a,c),ad=vertex(a,d),bc=vertex(b,c),bd=vertex(b,d);
    triangle(ac,ad,bc,towards);triangle(ad,bd,bc,towards);
   }
  }
 }
 const normals=[],skinIndices=[],skinWeights=[],epsilon=.003;
 for(let i=0;i<positions.length;i+=3){
  const [x,y,z]=positions.slice(i,i+3);
  const normal=new THREE.Vector3(field(x+epsilon,y,z)-field(x-epsilon,y,z),
   field(x,y+epsilon,z)-field(x,y-epsilon,z),field(x,y,z+epsilon)-field(x,y,z-epsilon)).normalize();
  normals.push(normal.x,normal.y,normal.z);
  const skin=weights(x,y,z);skinIndices.push(...skin.indices);skinWeights.push(...skin.weights);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
 geometry.setIndex(indices);geometry.computeBoundingSphere();
 sharedGeometry=geometry;return geometry;
}
export function makeHand(parent,skin,direction){
 const root=new THREE.Group();parent.add(root);
 const mesh=new THREE.SkinnedMesh(makeGeometry(),skin);
 root.add(mesh);mesh.frustumCulled=false;
 const bones=Array.from({length:8},()=>new THREE.Bone());
 bones[0].name='forearm';bones[1].name='wrist';
 bones[2].name='index';bones[3].name='index_tip';bones[4].name='thumb';bones[5].name='thumb_tip';
 bones[6].name='middle';bones[7].name='middle_tip';
 mesh.add(bones[0]);bones[0].add(bones[1]);bones[1].position.x=-1.32;
 bones[1].add(bones[2],bones[4],bones[6]);
 bones[2].position.set(indexBase[0]+1.32,indexBase[1],indexBase[2]);
 bones[4].position.set(thumbBase[0]+1.32,thumbBase[1],thumbBase[2]);
 bones[6].position.set(middleBase[0]+1.32,middleBase[1],middleBase[2]);
 bones[2].add(bones[3]);bones[3].position.x=.40;
 bones[4].add(bones[5]);bones[5].position.x=.32;
 bones[6].add(bones[7]);bones[7].position.x=.35;
 bones[2].rotation.z=-.42;bones[3].rotation.z=.15;
 bones[4].rotation.z=.85;bones[5].rotation.z=-.25;
 bones[6].rotation.z=-.10;bones[7].rotation.z=.20;
 root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton(bones));
 return {root,mesh,bones,x:0,y:0,opening:0,rotation:direction<0?.25:Math.PI+.25,visible:0,scale:1};
}
export function poseHand(hand){
 const open=clamp(hand.opening,0,1),bones=hand.bones;
 const index=smooth(0,.82,open),thumb=smooth(0,.65,open);
 const middle=smooth(.12,1,open);
 hand.root.position.set(hand.x,hand.y,0);
 hand.root.scale.setScalar(hand.scale);
 hand.root.rotation.set(-.09+open*.05,-.10+open*.07,hand.rotation);
 bones[1].rotation.z=-open*.10;
 bones[1].rotation.y=open*.07;
 bones[2].rotation.z=mix(.02,-.42,index);
 bones[3].rotation.z=mix(.22,.15,index);
 bones[4].rotation.z=mix(.05,.85,thumb);
 bones[5].rotation.z=mix(-.32,-.25,thumb);
 bones[6].rotation.z=mix(.20,-.10,middle);
 bones[7].rotation.z=mix(.65,.20,middle);
 bones[6].rotation.y=-.10*(1-middle);
}
