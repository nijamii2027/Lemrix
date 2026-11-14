import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const client = new URL('client/', dist);
const server = new URL('server/', dist);
const metadata = new URL('.openai/', dist);
await rm(client, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await mkdir(metadata, { recursive: true });
for (const entry of await readdir(dist)) {
  if (entry === 'client' || entry === 'server' || entry.startsWith('.')) continue;
  await cp(new URL(entry, dist), new URL(entry, client), { recursive: true });
}
await cp(new URL('worker/index.js', root), new URL('index.js', server));
await cp(new URL('.openai/hosting.json', root), new URL('hosting.json', metadata));
const config = {
  name: 'lemrix-tcg',
  main: 'index.js',
  compatibility_date: '2026-06-01',
  assets: { directory: '../client', binding: 'ASSETS' },
  d1_databases: [{ binding: 'DB', database_name: 'lemrix-enquiries', database_id: '00000000-0000-4000-8000-000000000000' }]
};
await writeFile(new URL('wrangler.json', server), JSON.stringify(config, null, 2) + '\n');

const source = await readFile(new URL('index.js', server));
const worker = await import('data:text/javascript;base64,' + source.toString('base64'));
if (typeof worker.default?.fetch !== 'function') throw new Error('Missing Sites worker entry point');
