import { copyFile, link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const project = fileURLToPath(new URL('../', import.meta.url));
const dist = join(project, 'dist');
const client = join(dist, 'client');
const server = join(dist, 'server');
const excluded = new Set(['client', 'server', '.openai']);
const catalogue = 'shop/catalogue.js';
const initial = runInNewContext((await readFile(join(dist, catalogue), 'utf8')) + ';products');
const pages = {};

async function publishAsset(file, path) {
  if (path === catalogue) return;
  const entries = await readdir(file, {withFileTypes:true}).catch(e => {
    if(e.code === 'ENOTDIR') return null;
    throw e;
  });
  if(entries) {
    await mkdir(join(client, path), {recursive:true});
    for(const e of entries) await publishAsset(join(file, e.name), path + '/' + e.name);
    return;
  }
  await link(file, join(client, path)).catch(() => copyFile(file, join(client, path)));
  if (!path.startsWith('shop/ocr/') && ['.html','.js','.css','.svg','.json','.txt'].includes(extname(path))) {
    pages['/' + path] = await readFile(file, 'utf8');
  }
}

await rm(client,{recursive:true,force:true});
await mkdir(client,{recursive:true});
await mkdir(server,{recursive:true});
for(const e of await readdir(dist, {withFileTypes:true})) {
  if(!excluded.has(e.name)) await publishAsset(join(dist,e.name), e.name);
}
// Keep bookmarked stockroom links working on hosts that serve static assets first.
await mkdir(join(client,'admin'),{recursive:true});
await writeFile(join(client,'admin/index.html'),
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Lemrix shop</title><meta http-equiv="refresh" content="0;url=/shop/#account"><a href="/shop/#account">Open shop account</a></html>');
const api = await readFile(join(project,'worker/inventory.mjs'),'utf8');
const customer = await readFile(join(project,'worker/customer.mjs'),'utf8');
const checkout = await readFile(join(project,'worker/checkout.mjs'),'utf8');
const rewards = await readFile(join(project,'worker/rewards.mjs'),'utf8');
const prints = {};
const useTestArt = process.argv.includes('--test-art');
for (const id of ['hill-club', 'last-showing', 'after-hours']) {
  const image = useTestArt ? join(dist, 'assets/lemrix-logo.webp') : join(project, 'rewards/prints', id + '.webp');
  prints[id] = (await readFile(image)).toString('base64');
}
const router = await readFile(join(project,'worker/route.mjs'),'utf8');
await writeFile(join(server,'index.js'),
  [api, customer, rewards, checkout, 'const rewardArtwork = '+JSON.stringify(prints)+';', 'const initialProducts = ' + JSON.stringify(initial) + ';',
   'const fallback = ' + JSON.stringify(pages) + ';',router].join('\n'));
await mkdir(join(dist,'.openai'),{recursive:true});
await copyFile(join(project,'.openai/hosting.json'), join(dist,'.openai/hosting.json'));
await writeFile(join(server,'wrangler.json'), JSON.stringify({
  name:'lemrix-store', main:'index.js', compatibility_date:'2026-06-01',
  assets:{directory:'../client',binding:'ASSETS'},
  r2_buckets:[{binding:'BUCKET',bucket_name:'lemrix-inventory'}],
},null,2) + '\n');
