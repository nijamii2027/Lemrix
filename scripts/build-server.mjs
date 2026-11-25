import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const pieces = await Promise.all(['public-origin', 'admin-auth', 'inventory', 'customer', 'rewards', 'checkout', 'offers', 'tracking'].map(name => readFile(join(root, 'worker', name + '.mjs'), 'utf8')));
const initial = runInNewContext((await readFile(join(root, 'dist/shop/catalogue.js'), 'utf8')) + ';products', {}, {timeout:1000});
const artwork = {};
if (process.argv.includes('--test-art')) {
  const fixture = (await readFile(join(root, 'dist/assets/lemrix-logo.webp'))).toString('base64');
  for (const id of ['hill-club', 'last-showing', 'after-hours']) artwork[id] = fixture;
}
const entry = `\nconst initialProducts = ${JSON.stringify(initial)};\nconst rewardArtwork = ${JSON.stringify(artwork)};\nexport default {\n  async fetch(request, env) {\n    return await handleInventory(request, env, initialProducts) || new Response('Not found', {status:404});\n  }\n};\n`;
await mkdir(join(root, 'dist/server'), {recursive:true});
await writeFile(join(root, 'dist/server/index.js'), pieces.join('\n') + entry);
