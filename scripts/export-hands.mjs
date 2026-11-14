import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const output=process.argv[2];
if(!output)throw new Error('Pass the hero export directory.');
const root=path.resolve(import.meta.dirname,'..');
const characterURL=pathToFileURL(path.join(output,'characters.mjs')).href;
const source=fs.readFileSync(path.join(root,'dist/mascots/hands.js'),'utf8')
 .replace("'/play/characters.js'",`'${characterURL}'`);
fs.writeFileSync(path.join(output,'hands.mjs'),source);
const {THREE,M}=await import(characterURL);
const {makeHand,poseHand}=await import(pathToFileURL(path.join(output,'hands.mjs')).href);
const scene=new THREE.Group();
const rigs=[makeHand(scene,M.blue,-1),makeHand(scene,M.tan,1)];
const geos=[],mats=[],objects=[],geoMap=new Map(),matMap=new Map();
scene.traverse(object=>{
 if(!object.isMesh)return;
 let geo=geoMap.get(object.geometry);
 if(geo===undefined){
  geo=geos.length;geoMap.set(object.geometry,geo);
  geos.push({positions:Array.from(object.geometry.attributes.position.array),
   indices:Array.from(object.geometry.index.array),uv:null});
 }
 let mat=matMap.get(object.material);
 if(mat===undefined){
  mat=mats.length;matMap.set(object.material,mat);
  mats.push({color:object.material.color.toArray(),roughness:object.material.roughness,
   metalness:0,opacity:1});
 }
 objects.push({object,geo,mat,kind:rigs[0].root.getObjectById(object.id)?'lemrix':'cookd'});
});
const deformations=[];
const vertex=new THREE.Vector3();
const frames=Array.from({length:32},(_,i)=>{
 for(const rig of rigs){
  Object.assign(rig,{opening:(i%16)/15,visible:1,rotation:0,scale:1});
  poseHand(rig);
  rig.root.scale.y=-1;
 }
 scene.updateMatrixWorld(true);
 for(const rig of rigs)rig.mesh.skeleton.update();
 deformations.push(objects.map(({object})=>{
  if(!object.isSkinnedMesh)return null;
  const positions=[];
  for(let i=0;i<object.geometry.attributes.position.count;i++){
   object.getVertexPosition(i,vertex);
   positions.push(+vertex.x.toFixed(5),+vertex.y.toFixed(5),+vertex.z.toFixed(5));
  }
  return positions;
 }));
 return objects.map(({object})=>object.matrixWorld.elements.slice());
});
fs.writeFileSync(path.join(output,'hands.json'),JSON.stringify({geos,mats,
 objects:objects.map(({object,...entry})=>entry),frames,deformations,width:800,height:248,
 camera:{position:[-5.1,-.134,10],target:[-5.1,-.134,0],scale:12}}));
console.log(`${objects.length} hand meshes, ${frames.length} poses.`);
