import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('packages/client/public');
const manifest = JSON.parse(
  await readFile(resolve(root, 'asset-manifest.json'), 'utf8'),
) as Record<string, unknown>;
let real = 0,
  fallback = 0;
async function scan(value: unknown, key: string) {
  // Only same-origin paths are assets; other strings (catalog ids, licences,
  // source URLs written by tools/assets/optimize.ts) are metadata.
  if (typeof value === 'string' && value.startsWith('/')) {
    const path = resolve(root, '.' + value);
    if (!path.startsWith(root)) throw new Error('Asset outside public root');
    const exists = await stat(path)
      .then((s) => s.isFile())
      .catch(() => false);
    console.log(`${exists ? 'FILE' : 'FALLBACK'} ${key}: ${value}`);
    if (exists) real++;
    else fallback++;
  } else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value))
      await scan(v, key ? key + '.' + k : k);
}
await scan(manifest, '');
console.log(
  JSON.stringify({ real, fallback, fullyPlayableWithFallbacks: true }),
);
