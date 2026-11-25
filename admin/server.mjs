import http from 'node:http';
import { readFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const data=resolve(process.env.LEMRIX_DATA_DIR || '.lemrix-data');
mkdirSync(data,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(data,'inventory.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL)');
const initial=vm.runInNewContext(readFileSync(resolve(root,'shop/catalogue.js'),'utf8')+';products');
const insert=db.prepare('INSERT OR IGNORE INTO items VALUES(?,?,0)');
db.exec('BEGIN');
for(const item of initial)insert.run(item.id,JSON.stringify(item));
db.exec('COMMIT');
const salt=randomBytes(32);
const password=process.env.LEMRIX_ADMIN_PASSWORD;
if(!password)throw Error('Set LEMRIX_ADMIN_PASSWORD before starting.');
const hash=scryptSync(password,salt,32);
const sessions=new Map();
let failures=[];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const validText=(s,max)=>typeof s==='string' && s.trim() && s.length<=max;
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const all=()=>db.prepare('SELECT body,revision FROM items ORDER BY rowid').all().map(r=>({...JSON.parse(r.body),revision:r.revision}));
async function bytes(req,max){
 const chunks=[];let total=0;
 for await(const chunk of req){total+=chunk.length;if(total>max)fail(413,'File or form too large');chunks.push(chunk)}
 return Buffer.concat(chunks);
}
async function form(req){try{return JSON.parse(await bytes(req,32000))}catch(e){if(e.code===413)throw e;fail(400,'Invalid form')}}
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4','.json':'application/json','.gif':'image/gif','.ico':'image/x-icon'};
const port=Number(process.env.PORT||4178);
const server=http.createServer(async(req,res)=>{
 const send=(status,type,value)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value)};
 const json=(value,status=200)=>send(status,'application/json',JSON.stringify(value));
 try{
 const origin='http://'+req.headers.host;
 if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))fail(403,'Local access only');
 const p=new URL(req.url,origin).pathname;
 const token=(req.headers.cookie||'').match(/(?:^|; )lemrix_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 const admin=(sessions.get(token)||0)>Date.now();
 if(req.method!=='GET' && req.headers.origin!==origin)fail(403,'Invalid request origin');
 if(p==='/api/login' && req.method==='POST'){
  failures=failures.filter(t=>t>Date.now()-60000);if(failures.length>=8)fail(429,'Try again in one minute');
  const f=await form(req);
  if(!validText(f.password,256)||!timingSafeEqual(scryptSync(f.password,salt,32),hash)||f.username!=='Lemrix'){failures.push(Date.now());fail(401,'Incorrect login')}
  const key=randomBytes(32).toString('hex');sessions.set(key,Date.now()+8*3600000);
  res.setHeader('Set-Cookie','lemrix_session='+key+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800');return json({ok:true});
 }
 if(p==='/api/logout' && req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie','lemrix_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json({ok:true})}
 if(p==='/shop/catalogue.js' && req.method==='GET')return send(200,'text/javascript','const products = '+JSON.stringify(all())+';');
 if(p.startsWith('/media/') && req.method==='GET'){const img=db.prepare('SELECT * FROM images WHERE id=?').get(p.slice(7));if(!img)fail(404,'Image missing');return send(200,img.mime,Buffer.from(img.bytes))}
 if(p.startsWith('/api/')){
  if(!admin)fail(401,'Sign in required');
  if(p==='/api/account' && req.method==='GET')return json({username:'Lemrix',expires:sessions.get(token)});
  if(p==='/api/logout-all' && req.method==='POST'){sessions.clear();res.setHeader('Set-Cookie','lemrix_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json({ok:true})}
  if(p==='/api/items' && req.method==='GET')return json(all());
  if(p==='/api/images' && req.method==='POST'){
   const b=await bytes(req,5*1024*1024);
   const type=b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'image/webp':null;
   if(!type)fail(415,'Choose a PNG, JPEG or WebP image');
   const id=randomBytes(16).toString('hex');db.prepare('INSERT INTO images VALUES(?,?,?)').run(id,type,b);return json({image:'/media/'+id});
  }
  if(p==='/api/items' && req.method==='POST'){
   const f=await form(req);if(!validText(f.name,100)||!validText(f.description,3000)||!['Singles','Packs','Accessories'].includes(f.category)||!integer(f.quantity,1000000))fail(400,'Check name, description, category and quantity');
   const old=f.id?db.prepare('SELECT body,revision FROM items WHERE id=?').get(f.id):null;
   if(f.id&&!old)fail(404,'Product missing');
   if(old&&old.revision!==f.revision)fail(409,'This listing changed. Reload before editing.');
   const item=old?JSON.parse(old.body):{id:randomBytes(12).toString('hex'),format:f.category==='Singles'?'Trading card':f.category,collection:'recently-added',notes:''};
   if((!old||f.image!==item.image)&&(!/^\/media\/[a-f0-9]{32}$/.test(f.image||'')||!db.prepare('SELECT id FROM images WHERE id=?').get(f.image.slice(7))))fail(400,'Upload a product photo');
   if(!Array.isArray(f.prices)||f.prices.length!==(item.copies?.length||1)||!f.prices.every(n=>integer(n,999999999)))fail(400,'Enter a valid price for each copy');
   if(item.copies)item.copies.forEach((c,i)=>c.cents=f.prices[i]);else item.cents=f.prices[0];
   Object.assign(item,{name:f.name.trim(),description:f.description.trim(),category:f.category,quantity:f.quantity,image:f.image});
   if(old)db.prepare('UPDATE items SET body=?,revision=revision+1 WHERE id=?').run(JSON.stringify(item),item.id);else insert.run(item.id,JSON.stringify(item));
   return json({id:item.id});
  }
  fail(404,'Unknown route');
 }
 if(req.method!=='GET')fail(405,'Method unavailable');
 if(['/admin','/admin/','/admin/app.js'].includes(p))return send(200,p.endsWith('.js')?'text/javascript':'text/html',readFileSync(new URL(p.endsWith('.js')?'./app.js':'./index.html',import.meta.url)));
 let file=resolve(root,'.'+decodeURIComponent(p));if(!file.startsWith(resolve(root)+sep)&&file!==resolve(root))fail(404,'Missing');
 if(statSync(file).isDirectory())file=resolve(file,'index.html');
 if(!realpathSync(file).startsWith(resolve(root)+sep))fail(404,'Missing');
 return send(200,mime[extname(file)]||'application/octet-stream',readFileSync(file));
 }catch(e){const status=Number.isInteger(e.code)?e.code:e.code==='ENOENT'?404:500;json({error:status===500?'Request failed':status===404?'Not found':e.message},status)}
});
server.listen(port,'127.0.0.1',()=>console.log('Store and admin ready at http://localhost:'+port+'/admin/'));
