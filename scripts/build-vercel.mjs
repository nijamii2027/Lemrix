import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'dist');
const output = join(root, 'public');
const generated = new Set(['client', 'server', '.openai']);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (generated.has(name) || name === 'shop') continue;
  await cp(join(source, name), join(output, name), { recursive: true });
}

// The After Hours section loads the shop's display font from this relative path.
await mkdir(join(output, 'shop'));
for (const name of ['barlow-display.woff2', 'barlow-OFL.txt']) {
  await cp(join(source, 'shop', name), join(output, 'shop', name));
}
