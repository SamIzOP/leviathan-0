/**
 * Downloads the 1k source files for every asset in a list into
 * tools/assets/.cache/<source>/<id>/ and writes info.json (name, authors,
 * source URL, licence) beside them.
 *
 *   tsx tools/assets/fetch.ts tools/assets/lists/foundry-row.json [--only id,id]
 *
 * Downloads are untrusted data: nothing from them is executed, remote paths are
 * validated, hosts are pinned and Poly Haven files are md5-verified. Files that
 * are already cached (and verify) are skipped. Any non-CC0 asset aborts the run.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import {
  LICENSE_URL,
  assertHost,
  cacheDirFor,
  exists,
  fetchJson,
  fetchWithRetry,
  fmtBytes,
  md5File,
  parseArgs,
  pool,
  readList,
  safeRelativePath,
  safeSegment,
  sourceUrl,
  writeFileAtomic,
  type CachedInfo,
  type Kind,
  type ListEntry,
  type Source,
} from './lib';

const PH_API = 'https://api.polyhaven.com';
const PH_DL_HOSTS = ['dl.polyhaven.org'];
const ACG_API = 'https://ambientcg.com/api/v2/full_json';
const ACG_DL_HOSTS = ['ambientcg.com'];
const MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;

interface PhFile {
  url: string;
  md5?: string;
  size?: number;
  include?: Record<string, PhFile>;
}
type PhFiles = Record<string, Record<string, Record<string, PhFile>>>;
interface PhInfo {
  type: number;
  name: string;
  authors?: Record<string, string>;
  tags?: string[];
  categories?: string[];
  dimensions?: number[];
  polycount?: number;
  license?: string;
}
interface AcgDownload {
  downloadLink: string;
  fileName: string;
  size: number;
  attribute: string;
}
interface AcgAsset {
  assetId: string;
  dataType: string;
  displayName: string;
  tags?: string[];
  dimensionX?: number;
  dimensionY?: number;
  maps?: string[];
  license?: string;
  downloadFolders?: Record<
    string,
    {
      downloadFiletypeCategories?: Record<
        string,
        { downloads?: AcgDownload[] }
      >;
    }
  >;
}

let downloaded = 0;
let skipped = 0;
let bytes = 0;

/** Both supported sites publish their whole catalogue as CC0; anything else is rejected. */
function assertCC0(source: Source, id: string, license: unknown) {
  if (license === undefined || license === null) return;
  if (!/^(cc0|cc-0|cc 0|public domain)/i.test(String(license)))
    throw new Error(
      `NON-CC0 asset rejected: ${source}/${id} declares license "${String(license)}"`,
    );
}

async function download(
  url: string,
  dest: string,
  hosts: string[],
  expect: { md5?: string; size?: number } = {},
) {
  assertHost(url, hosts);
  if (await exists(dest)) {
    const ok = expect.md5
      ? (await md5File(dest)) === expect.md5
      : expect.size
        ? (await stat(dest)).size === expect.size
        : true;
    if (ok) {
      skipped++;
      return;
    }
  }
  const res = await fetchWithRetry(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (expect.size && buf.byteLength !== expect.size)
    throw new Error(
      `Size mismatch for ${url}: ${buf.byteLength} != ${expect.size}`,
    );
  await writeFileAtomic(dest, buf);
  if (expect.md5 && (await md5File(dest)) !== expect.md5)
    throw new Error(`md5 mismatch for ${url}`);
  downloaded++;
  bytes += buf.byteLength;
}

function phKind(type: number): Kind {
  return type === 0 ? 'hdri' : type === 1 ? 'material' : 'model';
}

async function fetchPolyHaven(entry: ListEntry, dir: string) {
  const { id } = entry;
  const apiUrl = `${PH_API}/info/${id}`;
  const info = await fetchJson<PhInfo>(apiUrl);
  assertCC0('polyhaven', id, info.license);
  if (phKind(info.type) !== entry.kind)
    throw new Error(
      `${id}: Poly Haven type ${info.type} is not a ${entry.kind}`,
    );
  const files = await fetchJson<PhFiles>(`${PH_API}/files/${id}`);
  const written: string[] = [];
  const extraMaps: Record<string, string> = {};
  let main: string | undefined;

  if (entry.kind === 'model') {
    const g = files.gltf?.['1k']?.gltf;
    if (!g) throw new Error(`${id}: no 1k glTF listed in /files`);
    main = safeSegment(basename(new URL(g.url).pathname));
    if (!main.endsWith('.gltf')) throw new Error(`${id}: unexpected ${main}`);
    await download(g.url, join(dir, main), PH_DL_HOSTS, g);
    written.push(main);
    for (const [rel, f] of Object.entries(g.include ?? {})) {
      const safe = safeRelativePath(rel);
      if (!/\.(bin|jpe?g|png)$/i.test(safe))
        throw new Error(`${id}: unexpected glTF dependency ${rel}`);
      await download(f.url, join(dir, safe), PH_DL_HOSTS, f);
      written.push(safe);
    }
    // Opacity maps Poly Haven publishes separately (the 1k glTF often points
    // its "diff+opacity" image at a plain JPEG); optimize.ts merges them back.
    for (const [mapKey, res] of Object.entries(files)) {
      if (!/(^|_)(opacity|alpha)$/.test(mapKey)) continue;
      const f = res['1k']?.jpg ?? res['1k']?.png;
      if (!f) continue;
      const ext = f.url.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      const rel = `extra/${safeSegment(mapKey)}.${ext}`;
      await download(f.url, join(dir, rel), PH_DL_HOSTS, f);
      extraMaps[mapKey] = rel;
      written.push(rel);
    }
    // The glTF must only reference the files we just fetched.
    const gltf = JSON.parse(await readFile(join(dir, main), 'utf8')) as {
      buffers?: { uri?: string }[];
      images?: { uri?: string }[];
    };
    for (const r of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!r.uri || r.uri.startsWith('data:')) continue;
      const rel = safeRelativePath(decodeURIComponent(r.uri));
      if (!written.includes(rel))
        throw new Error(`${id}: glTF references unlisted file ${r.uri}`);
    }
  } else if (entry.kind === 'hdri') {
    const h = files.hdri?.['1k']?.hdr;
    if (!h) throw new Error(`${id}: no 1k .hdr listed`);
    main = safeSegment(basename(new URL(h.url).pathname));
    if (!main.endsWith('.hdr')) throw new Error(`${id}: unexpected ${main}`);
    await download(h.url, join(dir, main), PH_DL_HOSTS, h);
    written.push(main);
  } else {
    // Texture set fallback for materials: colour, GL normal, roughness, AO.
    for (const map of ['Diffuse', 'nor_gl', 'Rough', 'AO']) {
      const f = files[map]?.['1k']?.jpg;
      if (!f) {
        if (map === 'AO') continue;
        throw new Error(`${id}: missing 1k ${map} map`);
      }
      const name = safeSegment(basename(new URL(f.url).pathname));
      await download(f.url, join(dir, name), PH_DL_HOSTS, f);
      written.push(name);
    }
  }

  const authors = Object.keys(info.authors ?? {});
  const d = info.dimensions;
  const record: CachedInfo = {
    id,
    source: 'polyhaven',
    kind: entry.kind,
    name: info.name,
    authors,
    author: authors.length ? authors.join(', ') : undefined,
    sourceUrl: sourceUrl('polyhaven', id),
    apiUrl,
    license: 'CC0',
    licenseUrl: LICENSE_URL.polyhaven,
    fetchedAt: new Date().toISOString(),
    files: written,
    main,
    ...(Object.keys(extraMaps).length ? { extraMaps } : {}),
    // Poly Haven dimensions are millimetres in Blender axes (Z-up) -> glTF (Y-up).
    dimensionsMeters:
      d && d.length === 3 && entry.kind === 'model'
        ? [d[0]! / 1000, d[2]! / 1000, d[1]! / 1000]
        : undefined,
    tileMeters:
      d && d.length >= 2 && entry.kind === 'material'
        ? Math.round((d[0]! / 1000) * 100) / 100
        : undefined,
    polycount: info.polycount,
    tags: info.tags,
    categories: info.categories,
    api: info,
  };
  return record;
}

async function fetchAmbientCG(entry: ListEntry, dir: string) {
  const { id } = entry;
  if (entry.kind !== 'material')
    throw new Error(`${id}: only materials are fetched from ambientCG`);
  const apiUrl = `${ACG_API}?id=${encodeURIComponent(id)}&include=downloadData`;
  const res = await fetchJson<{ foundAssets?: AcgAsset[] }>(apiUrl);
  const a = res.foundAssets?.find((x) => x.assetId === id);
  if (!a)
    throw new Error(`${id}: not found on ambientCG (IDs are case-sensitive)`);
  assertCC0('ambientcg', id, a.license);
  if (a.dataType !== 'Material')
    throw new Error(`${id}: ambientCG dataType is ${a.dataType}, not Material`);
  const dl = Object.values(a.downloadFolders ?? {})
    .flatMap((f) => Object.values(f.downloadFiletypeCategories ?? {}))
    .flatMap((c) => c.downloads ?? [])
    .find((x) => x.attribute === '1K-JPG');
  if (!dl) throw new Error(`${id}: no 1K-JPG package`);
  const zipName = safeSegment(dl.fileName);
  const zipPath = join(dir, zipName);
  await download(dl.downloadLink, zipPath, ACG_DL_HOSTS, { size: dl.size });

  const written: string[] = [zipName];
  const entries = unzipSync(new Uint8Array(await readFile(zipPath)), {
    filter: (f) =>
      /^[A-Za-z0-9_.-]+\.(jpe?g|png)$/i.test(f.name) &&
      f.originalSize < MAX_EXTRACTED_BYTES,
  });
  for (const [name, data] of Object.entries(entries)) {
    const safe = safeSegment(name);
    const dest = join(dir, safe);
    if (!(await exists(dest)) || (await stat(dest)).size !== data.byteLength)
      await writeFileAtomic(dest, data);
    written.push(safe);
  }
  if (!written.some((f) => /_Color\.jpe?g$/i.test(f)))
    throw new Error(`${id}: package has no colour map`);

  const record: CachedInfo = {
    id,
    source: 'ambientcg',
    kind: 'material',
    name: a.displayName,
    authors: ['ambientCG (Lennart Demes)'],
    author: 'ambientCG (Lennart Demes)',
    sourceUrl: sourceUrl('ambientcg', id),
    apiUrl,
    license: 'CC0',
    licenseUrl: LICENSE_URL.ambientcg,
    fetchedAt: new Date().toISOString(),
    files: written,
    // ambientCG dimensions are centimetres; 0 means unknown.
    tileMeters: a.dimensionX ? a.dimensionX / 100 : undefined,
    tags: a.tags,
    api: a,
  };
  return record;
}

async function main() {
  const { listFile, only } = parseArgs(process.argv.slice(2));
  const list = await readList(listFile);
  const seen = new Map<string, ListEntry>();
  for (const e of list.assets)
    if (!only || only.has(e.id)) seen.set(`${e.source}/${e.id}`, e);
  const entries = [...seen.values()];
  console.log(`fetch: ${list.name} — ${entries.length} source assets`);

  const errors = await pool(entries, 4, async (entry) => {
    const dir = cacheDirFor(entry.source, entry.id);
    await mkdir(dir, { recursive: true });
    const record =
      entry.source === 'polyhaven'
        ? await fetchPolyHaven(entry, dir)
        : await fetchAmbientCG(entry, dir);
    await writeFile(
      join(dir, 'info.json'),
      JSON.stringify(record, null, 2) + '\n',
    );
    console.log(
      `  ok ${entry.source}/${entry.id} (${record.files.length} files, ${record.license}, ${record.author ?? 'unknown author'})`,
    );
  });

  console.log(
    `fetch: ${downloaded} downloaded (${fmtBytes(bytes)}), ${skipped} already cached`,
  );
  if (errors.length) {
    for (const { item, error } of errors)
      console.error(
        `  FAILED ${item.source}/${item.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    console.error(`fetch: ${errors.length} asset(s) failed`);
    process.exit(1);
  }
}

await main();
