import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'dist');
const output = join(root, 'public');
const generated = new Set(['client', 'server']);
const catalogue = join(source, 'shop', 'catalogue.js');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (generated.has(name)) continue;
  await cp(join(source, name), join(output, name), {
    recursive: true,
    // This URL must always use the live inventory API, never a stale seed file.
    filter: file => file !== catalogue,
  });
}
