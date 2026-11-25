import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'dist');
const output = join(root, 'public');
const generated = new Set(['client', 'server', '.openai']);
const catalogue = join(source, 'shop', 'catalogue.js');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (generated.has(name)) continue;
  await cp(join(source, name), join(output, name), {
    recursive: true,
    // This URL must always use the inventory gateway, never a stale seed file.
    filter: file => file !== catalogue,
  });
}

// Keep the original Sites sign-in route in source. The Vercel gateway starts
// owner verification and returns the verified owner to this storefront.
const shopPath = join(output, 'shop', 'index.html');
const shop = await readFile(shopPath, 'utf8');
const ownerSignIn = 'href="/signin-with-chatgpt?return_to=%2Fshop%2F%23account"';
if (shop.split(ownerSignIn).length !== 2) {
  throw new Error('Expected one owner verification link in the shop page.');
}
await writeFile(shopPath, shop.replace(ownerSignIn, 'href="/api/owner/connect"'));
