/**
 * Shared helpers for the CC0 asset pipeline (fetch.ts / optimize.ts).
 *
 * Everything downloaded by this pipeline is treated as untrusted data: files are
 * only ever parsed as JSON / images / glTF / zip archives, never executed, and
 * every relative path that comes from a remote source is validated before it
 * touches the file system.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const CACHE_DIR = join(ROOT, 'tools/assets/.cache');
export const PUBLIC_DIR = join(ROOT, 'packages/client/public');
export const MANIFEST_PATH = join(PUBLIC_DIR, 'asset-manifest.json');
export const CATALOG_TS_PATH = join(
  ROOT,
  'packages/shared/src/asset-catalog.ts',
);
export const MODEL_DIR = join(PUBLIC_DIR, 'assets/models/cc0');
export const TEXTURE_DIR = join(PUBLIC_DIR, 'assets/textures/cc0');
export const HDRI_DIR = join(PUBLIC_DIR, 'assets/hdri');

export const USER_AGENT = 'Leviathan0-cc0-asset-pipeline/1.0';

export const MODEL_CATEGORIES = [
  'barrel',
  'drum',
  'crate',
  'box',
  'pallet',
  'pipe',
  'tank',
  'gas-cylinder',
  'electrical',
  'fence',
  'light',
  'trolley',
  'machinery',
  'barrier',
  'dumpster',
  'tire',
  'ladder',
  'vent',
  'antenna',
  'shelf',
  'toolbox',
  'bucket',
  'cone',
  'sign',
  'cable',
  'workbench',
  'generator',
  'debris',
  'beam',
  'sack',
  'furniture',
  'vehicle',
  'hydrant',
  'container',
  'misc',
] as const;
export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export const MATERIAL_KEYS = [
  'asphalt.wet',
  'concrete.clean',
  'concrete.stained',
  'concrete.floor',
  'brick.red',
  'brick.soot',
  'metal.rusted',
  'metal.painted',
  'metal.plates',
  'metal.corrugated',
  'metal.grating',
  'metal.dark',
  'wood.planks',
  'rock.rubble',
  'plaster.dirty',
] as const;

/** Procedural forge families a model can fall back to (manifest key `prop.<family>`). */
export const FORGE_FAMILIES = [
  'barrel',
  'drum',
  'crate',
  'pallet',
  'gas-cylinder',
  'dumpster',
  'bollard',
  'barrier',
  'concrete-block',
  'jersey-barrier',
  'tire',
  'debris',
  'wheelie-bin',
  'pipe',
  'valve',
  'manifold',
  'tank',
  'vat',
  'boiler',
  'duct',
  'vent',
  'electrical-cabinet',
  'cable-tray',
  'transformer',
  'generator',
  'conveyor',
  'hopper',
  'press',
  'forge',
  'furnace-door',
  'chain',
  'hook',
  'catwalk',
  'railing',
  'ladder',
  'stair-run',
  'gantry',
  'truss',
  'pillar',
  'roller-shutter',
  'gate',
  'chain-link-fence',
  'floodlight',
  'lamp-post',
  'power-pole',
  'sign',
  'sedan-wreck',
  'van-wreck',
  'small-truck-wreck',
  'container',
  'forklift',
  'cart',
  'scaffold',
  'tarpaulin',
  'workstation',
  'locker',
  'rubble',
  'substation',
  'curved-pipe',
] as const;

/** Default fallback family per category; list entries may override with "fallback". */
export const CATEGORY_FALLBACK: Record<ModelCategory, string> = {
  barrel: 'barrel',
  drum: 'drum',
  crate: 'crate',
  box: 'crate',
  pallet: 'pallet',
  pipe: 'pipe',
  tank: 'tank',
  'gas-cylinder': 'gas-cylinder',
  electrical: 'electrical-cabinet',
  fence: 'chain-link-fence',
  light: 'floodlight',
  trolley: 'cart',
  machinery: 'press',
  barrier: 'barrier',
  dumpster: 'dumpster',
  tire: 'tire',
  ladder: 'ladder',
  vent: 'vent',
  antenna: 'power-pole',
  shelf: 'locker',
  toolbox: 'crate',
  bucket: 'drum',
  cone: 'bollard',
  sign: 'sign',
  cable: 'cable-tray',
  workbench: 'workstation',
  generator: 'generator',
  debris: 'debris',
  beam: 'truss',
  sack: 'debris',
  furniture: 'workstation',
  vehicle: 'sedan-wreck',
  hydrant: 'bollard',
  container: 'container',
  misc: 'debris',
};

/** Approximate real-world tile size (metres) when the source has no dimensions. */
export const DEFAULT_TILE: Record<string, number> = {
  asphalt: 3,
  concrete: 2.5,
  brick: 2,
  metal: 2,
  'metal.plates': 2,
  'metal.corrugated': 2,
  'metal.grating': 1,
  wood: 2,
  rock: 2.5,
  plaster: 2.5,
};

export const HARD_TRI_CAP = 8000;
export const DEFAULT_TRI_CAP = 3000;

export type Source = 'polyhaven' | 'ambientcg';
export const SOURCES: readonly Source[] = ['polyhaven', 'ambientcg'];
export type Kind = 'model' | 'material' | 'hdri';

export interface ListEntry {
  id: string;
  source: Source;
  kind: Kind;
  category?: ModelCategory;
  key?: string;
  triCap?: number;
  textureSize?: number;
  /** Keep only these node names (and their subtrees) from a multi-object file. */
  pick?: string[];
  /** Output suffix when one source asset yields several props: `<id>-<variant>`. */
  variant?: string;
  /** Override the procedural fallback family (without the `prop.` prefix). */
  fallback?: string;
  /** Uniform scale fix for sources not authored in metres (auto-detected otherwise). */
  scale?: number;
  /** Override a material's real-world tile size in metres. */
  tile?: number;
  notes?: string;
}

export interface AssetList {
  name: string;
  description?: string;
  assets: ListEntry[];
}

export interface CachedInfo {
  id: string;
  source: Source;
  kind: Kind;
  name: string;
  authors: string[];
  author?: string;
  sourceUrl: string;
  apiUrl: string;
  license: 'CC0';
  licenseUrl: string;
  fetchedAt: string;
  /** Files written to the cache dir, relative to it. */
  files: string[];
  /** Model: entry glTF file name. HDRI: .hdr file name. */
  main?: string;
  /** Model: separately published opacity maps, keyed by source map name. */
  extraMaps?: Record<string, string>;
  /** Material tile size from source metadata (metres), when available. */
  tileMeters?: number;
  /** Source dimensions in metres [x, y, z] (glTF axes, Y-up) when available. */
  dimensionsMeters?: [number, number, number];
  polycount?: number;
  tags?: string[];
  categories?: string[];
  api: unknown;
}

export const SITE_NAME: Record<Source, string> = {
  polyhaven: 'Poly Haven',
  ambientcg: 'ambientCG',
};

export const LICENSE_URL: Record<Source, string> = {
  polyhaven: 'https://polyhaven.com/license',
  ambientcg: 'https://docs.ambientcg.com/license/',
};

export function sourceUrl(source: Source, id: string) {
  return source === 'polyhaven'
    ? `https://polyhaven.com/a/${id}`
    : `https://ambientcg.com/view?id=${id}`;
}

/** Output id for an entry (several props may come from one source asset). */
export function outId(entry: ListEntry) {
  return entry.variant ? `${entry.id}-${entry.variant}` : entry.id;
}

export function cacheDirFor(source: Source, id: string) {
  return join(CACHE_DIR, source, safeSegment(id));
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export function safeSegment(s: string) {
  if (!SAFE_SEGMENT.test(s) || s.includes('..'))
    throw new Error(`Unsafe path segment: ${JSON.stringify(s)}`);
  return s;
}

/** Validates a remote-supplied relative path (e.g. "textures/x_1k.jpg"). */
export function safeRelativePath(p: string) {
  const norm = normalize(p).replace(/\\/g, '/');
  if (
    !p ||
    isAbsolute(p) ||
    norm.startsWith('../') ||
    norm === '..' ||
    norm.split('/').some((seg) => seg === '..' || !SAFE_SEGMENT.test(seg))
  )
    throw new Error(`Unsafe relative path from remote source: ${p}`);
  return norm;
}

export function assertHost(url: string, hosts: string[]) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname))
    throw new Error(`Unexpected download host for ${url}`);
  return u;
}

function validateEntry(e: ListEntry, i: number) {
  const where = `entry #${i} (${e.id ?? '?'})`;
  if (!e.id || typeof e.id !== 'string')
    throw new Error(`${where}: missing id`);
  safeSegment(e.id);
  if (!SOURCES.includes(e.source))
    throw new Error(
      `${where}: unsupported source "${e.source}" (supported: ${SOURCES.join(', ')})`,
    );
  if (e.kind === 'model') {
    if (e.source !== 'polyhaven')
      throw new Error(`${where}: models are only supported from polyhaven`);
    if (!e.category || !MODEL_CATEGORIES.includes(e.category))
      throw new Error(`${where}: invalid category "${e.category}"`);
    const cap = e.triCap ?? DEFAULT_TRI_CAP;
    if (!(cap > 0 && cap <= HARD_TRI_CAP))
      throw new Error(`${where}: triCap must be 1..${HARD_TRI_CAP}`);
    if (
      e.textureSize !== undefined &&
      ![256, 512, 1024].includes(e.textureSize)
    )
      throw new Error(`${where}: textureSize must be 256, 512 or 1024`);
    if (e.variant !== undefined) safeSegment(e.variant);
    if (e.scale !== undefined && !(e.scale > 0 && e.scale < 1000))
      throw new Error(`${where}: scale must be a positive factor`);
    if (e.pick !== undefined && (!Array.isArray(e.pick) || !e.pick.length))
      throw new Error(`${where}: pick must be a non-empty array of node names`);
    const fb = e.fallback ?? CATEGORY_FALLBACK[e.category];
    if (!(FORGE_FAMILIES as readonly string[]).includes(fb))
      throw new Error(`${where}: unknown fallback family "${fb}"`);
  } else if (e.kind === 'material') {
    if (!e.key || !/^[a-z]+(\.[a-z-]+)+$/.test(e.key))
      throw new Error(`${where}: invalid material key "${e.key}"`);
    if (e.tile !== undefined && !(e.tile > 0 && e.tile < 50))
      throw new Error(`${where}: tile must be in metres (0..50)`);
  } else if (e.kind === 'hdri') {
    if (e.source !== 'polyhaven')
      throw new Error(`${where}: HDRIs are only supported from polyhaven`);
  } else throw new Error(`${where}: invalid kind "${String(e.kind)}"`);
}

export async function readList(file: string): Promise<AssetList> {
  const raw = JSON.parse(await readFile(resolve(file), 'utf8')) as
    AssetList | ListEntry[];
  const list: AssetList = Array.isArray(raw)
    ? { name: basename(file).replace(/\.json$/, ''), assets: raw }
    : raw;
  if (!list.name) list.name = basename(file).replace(/\.json$/, '');
  if (!Array.isArray(list.assets)) throw new Error(`${file}: missing "assets"`);
  list.assets.forEach(validateEntry);
  const outIds = new Set<string>();
  const keys = new Set<string>();
  for (const e of list.assets) {
    const o = `${e.kind}:${outId(e)}`;
    if (outIds.has(o)) throw new Error(`Duplicate entry ${o} in ${file}`);
    outIds.add(o);
    if (e.key) {
      if (keys.has(e.key)) throw new Error(`Duplicate material key ${e.key}`);
      keys.add(e.key);
    }
  }
  return list;
}

/** `--only a,b` filter shared by both scripts. */
export function parseArgs(argv: string[]) {
  const rest: string[] = [];
  let only: Set<string> | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--only') only = new Set((argv[++i] ?? '').split(','));
    else if (a.startsWith('--only=')) only = new Set(a.slice(7).split(','));
    else rest.push(a);
  }
  if (!rest[0])
    throw new Error(
      'Usage: tsx tools/assets/<script>.ts <listFile> [--only id,id]',
    );
  return { listFile: rest[0], only };
}

export async function exists(p: string) {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

export async function md5File(p: string) {
  return createHash('md5')
    .update(await readFile(p))
    .digest('hex');
}

export async function fetchWithRetry(
  url: string,
  tries = 4,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(180_000),
        redirect: 'follow',
      });
      if (res.status === 404) throw new Error(`404 Not Found: ${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (String(err).includes('404 Not Found')) break;
      await new Promise((r) => setTimeout(r, 750 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string): Promise<T> {
  return (await (await fetchWithRetry(url)).json()) as T;
}

/** Writes atomically (tmp + rename) so interrupted runs never leave partial files. */
export async function writeFileAtomic(path: string, data: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Runs `fn` over items with bounded concurrency, collecting errors. */
export async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<{ item: T; error: unknown }[]> {
  const errors: { item: T; error: unknown }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (error) {
        errors.push({ item, error });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return errors;
}

export function fmtBytes(n: number) {
  return n >= 1048576
    ? `${(n / 1048576).toFixed(2)} MB`
    : `${(n / 1024).toFixed(1)} KB`;
}
