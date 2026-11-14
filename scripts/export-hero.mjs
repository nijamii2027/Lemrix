import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {createCanvas,Image,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');

const root=path.resolve(import.meta.dirname,'..');
const output=process.argv[2];
if(!output)throw new Error('Pass an output directory.');
fs.mkdirSync(output,{recursive:true});
const site=path.join(root,'dist');
const url=file=>pathToFileURL(path.join(site,file)).href;
const rounded=fs.readFileSync(path.join(site,'mascots/vendor/RoundedBoxGeometry.js'),'utf8')
 .replace("from 'three'",`from '${url('mascots/vendor/three.module.min.js')}'`);
fs.writeFileSync(path.join(output,'rounded.mjs'),rounded);
const characters=fs.readFileSync(path.join(site,'play/characters.js'),'utf8')
 .replace("'/mascots/vendor/three.module.min.js'",`'${url('mascots/vendor/three.module.min.js')}'`)
 .replace("'/mascots/vendor/RoundedBoxGeometry.js'",`'${pathToFileURL(path.join(output,'rounded.mjs')).href}'`);
fs.writeFileSync(path.join(output,'characters.mjs'),characters);
const characterURL=pathToFileURL(path.join(output,'characters.mjs')).href;
const shop=fs.readFileSync(path.join(site,'mascots/storefront.js'),'utf8')
 .replace("'/play/characters.js'",`'${characterURL}'`);
fs.writeFileSync(path.join(output,'storefront.mjs'),shop);
globalThis.document={createElement:()=>createCanvas(300,150)};
globalThis.Image=class extends Image{
 set src(value){setTimeout(()=>{super.src=fs.readFileSync(path.join(site,value.replace(/^\//,'')));},0);}
};
GlobalFonts.registerFromPath(path.join(site,'assets/Caprasimo-Regular.ttf'),'Caprasimo');
const {THREE,makeCharacters,poseCharacters}=await import(characterURL);
const {makeStorefront}=await import(pathToFileURL(path.join(output,'storefront.mjs')).href);
const storefront=makeStorefront({capabilities:{getMaxAnisotropy:()=>8}});
await storefront.ready;
const pair=makeCharacters(storefront.root);
const geos=[],mats=[],objects=[],geoMap=new Map(),matMap=new Map();
storefront.root.traverse(object=>{
 if(!object.isMesh)return;
 let geo=geoMap.get(object.geometry);
 if(geo===undefined){
  geo=geos.length;
  geoMap.set(object.geometry,geo);
  const g=object.geometry;
  geos.push({positions:Array.from(g.attributes.position.array),
   indices:g.index?Array.from(g.index.array):null,uv:g.attributes.uv?Array.from(g.attributes.uv.array):null});
 }
 const material=Array.isArray(object.material)?object.material[0]:object.material;
 let mat=matMap.get(material);
 if(mat===undefined){
  mat=mats.length;
  matMap.set(material,mat);
  let texture;
  if(material.map?.image?.toBuffer){
   texture=`texture-${mat}.png`;
   fs.writeFileSync(path.join(output,texture),material.map.image.toBuffer('image/png'));
  }
  mats.push({color:material.color.toArray(),roughness:material.roughness??.6,
   metalness:material.metalness??0,opacity:material.opacity,texture,
   emissive:material.emissive?.toArray(),emissiveIntensity:material.emissiveIntensity??0});
 }
 const character=pair.cookd.root.getObjectById(object.id)||pair.lemrix.root.getObjectById(object.id);
 objects.push({object,geo,mat,character:Boolean(character)});
});
const camera=new THREE.OrthographicCamera(-6.9*1600/1136/2,6.9*1600/1136/2,3.45,-3.45,.1,80);
camera.position.set(7.4,6.5,13);
camera.lookAt(0,2,-.15);
camera.updateMatrixWorld();
const bounds={left:1600,top:1136,right:0,bottom:0};
const vertex=new THREE.Vector3();
const frames=Array.from({length:128},(_,frame)=>{
 const phase=frame/128*Math.PI*2;
 poseCharacters(pair,phase/1.7,{facing:Math.PI});
 [pair.cookd,pair.lemrix].forEach((c,i)=>{
  const offset=i*.65;
  c.root.position.y=.09+Math.sin(phase+offset)*.016;
  c.torso.rotation.z=Math.sin(phase+offset)*.012;
  c.torso.scale.y=1+Math.sin(phase+offset)*.006;
  c.tail.rotation.y=Math.sin(phase+offset)*.07;
  c.tail.rotation.z=Math.cos(phase+offset)*.025;
  c.arms.forEach(arm=>arm.rotation.x=Math.sin(phase+offset)*.012);
  const blink=1-Math.pow(Math.max(0,Math.cos(phase*2-1.4+offset)),42)*.88;
  c.eyes.forEach(eye=>eye.scale.y=.055*blink);
 });
 const wave=Math.pow(Math.max(0,Math.sin(phase)),4);
 pair.cookd.arms[0].rotation.z=-wave*.45;
 pair.cookd.arms[0].rotation.x=Math.sin(phase*4)*wave*.16;
 pair.lemrix.arms[1].rotation.z=wave*.46;
 pair.lemrix.arms[1].rotation.x=-Math.sin(phase*4+.4)*wave*.13;
 pair.cookd.ears.forEach((ear,i)=>ear.rotation.z=Math.sin(phase+i)*.018);
 pair.cookd.bone.rotation.z=.33+Math.sin(phase)*.008;
 storefront.root.updateMatrixWorld(true);
 if(frame%4===0)for(const item of objects.filter(item=>item.character)){
  item.object.geometry.computeBoundingBox();
  const box=item.object.geometry.boundingBox;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
   vertex.set(x,y,z).applyMatrix4(item.object.matrixWorld).project(camera);
   const px=(vertex.x+1)*800,py=(1-vertex.y)*1136/2;
   bounds.left=Math.min(bounds.left,px);bounds.right=Math.max(bounds.right,px);
   bounds.top=Math.min(bounds.top,py);bounds.bottom=Math.max(bounds.bottom,py);
  }
 }
 return objects.map(({object})=>object.matrixWorld.elements.slice());
});
const crop={
 left:Math.max(0,Math.floor(bounds.left-14)),top:Math.max(0,Math.floor(bounds.top-14)),
 right:Math.min(1600,Math.ceil(bounds.right+14)),bottom:Math.min(1136,Math.ceil(bounds.bottom+14))
};
fs.writeFileSync(path.join(output,'hero.json'),JSON.stringify({geos,mats,
 objects:objects.map(({object,...item})=>item),frames,crop,width:1600,height:1136}));
console.log(JSON.stringify({meshes:objects.length,crop,frames:frames.length}));
