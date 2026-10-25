/**
 * Turns cached CC0 downloads into optimized, registered runtime assets.
 *
 *   tsx tools/assets/optimize.ts tools/assets/lists/foundry-row.json [--only id,id]
 *
 * Models    -> packages/client/public/assets/models/cc0/<id>.glb
 * Materials -> packages/client/public/assets/textures/cc0/<key>/<map>_<size>.jpg
 * HDRIs     -> packages/client/public/assets/hdri/<id>_1k.hdr
 * Then merges packages/client/public/asset-manifest.json (existing keys are
 * kept) and regenerates packages/shared/src/asset-catalog.ts.
 */
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Accessor,
  Document,
  Logger,
  Material,
  Mesh,
  Node,
  NodeIO,
  Primitive,
  PrimitiveTarget,
  getBounds,
  type mat4,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS, type Transmission } from '@gltf-transform/extensions';
import {
  cloneDocument,
  compactPrimitive,
  dedup,
  dequantize,
  join as joinPrimitives,
  listTextureSlots,
  prune,
  transformPrimitive,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, type SimplifierFlags } from 'meshoptimizer';
import * as prettier from 'prettier';
import sharp from 'sharp';
import {
  CACHE_DIR,
  CATALOG_TS_PATH,
  CATEGORY_FALLBACK,
  DEFAULT_TILE,
  DEFAULT_TRI_CAP,
  HARD_TRI_CAP,
  HDRI_DIR,
  MANIFEST_PATH,
  MODEL_DIR,
  PUBLIC_DIR,
  SITE_NAME,
  TEXTURE_DIR,
  cacheDirFor,
  exists,
  fmtBytes,
  outId,
  parseArgs,
  pool,
  readList,
  safeRelativePath,
  safeSegment,
  writeFileAtomic,
  type CachedInfo,
  type Kind,
  type ListEntry,
} from './lib';

type SimplifierFlag = SimplifierFlags;

interface CatalogEntry {
  id: string;
  kind: Kind;
  source: string;
  sourceId?: string;
  sourceUrl: string;
  license: 'CC0';
  author?: string;
  tris?: number;
  textureSize: number;
  category?: string;
  key?: string;
  prop?: string;
  path?: string;
  size?: [number, number, number];
  tile?: number;
  bytes: number;
  fallback: string;
  lists: string[];
}

interface ManifestMaterial {
  id: string;
  size: number;
  tile: number;
  maps: Record<string, string>;
  low: Record<string, string>;
}

interface Manifest {
  models: Record<string, string>;
  textures: Record<string, unknown>;
  hdri: string[];
  audio: Record<string, string>;
  materials?: Record<string, ManifestMaterial>;
  catalog?: Record<string, CatalogEntry>;
  [extra: string]: unknown;
}

interface Result {
  entry: ListEntry;
  catalog: CatalogEntry;
  files: string[];
  notes: string[];
}

const IDENTITY: mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Extensions kept in output GLBs; everything else is stripped. */
const KEEP_EXTENSIONS = new Set([
  'KHR_texture_transform',
  'KHR_materials_emissive_strength',
]);
const LOW_SIZE = 512;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .setLogger(new Logger(Logger.Verbosity.WARN));

function round(n: number, digits = 3) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function webPath(abs: string) {
  return '/' + abs.slice(PUBLIC_DIR.length + 1).replace(/\\/g, '/');
}

async function readInfo(entry: ListEntry) {
  const dir = cacheDirFor(entry.source, entry.id);
  const file = join(dir, 'info.json');
  if (!(await exists(file)))
    throw new Error(
      `${entry.source}/${entry.id} is not cached; run fetch.ts on this list first`,
    );
  const info = JSON.parse(await readFile(file, 'utf8')) as CachedInfo;
  if (info.license !== 'CC0')
    throw new Error(`NON-CC0 asset in cache: ${entry.source}/${entry.id}`);
  return { dir, info };
}

// ---------------------------------------------------------------- models ---

function globToRegExp(glob: string) {
  return new RegExp(
    '^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
}

function countTris(doc: Document) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const n =
        prim.getIndices()?.getCount() ??
        prim.getAttribute('POSITION')?.getCount() ??
        0;
      t += n / 3;
    }
  return Math.round(t);
}

/** Converts glass-like transmission to cheap alpha blending, then strips extensions. */
function stripExtensions(doc: Document) {
  for (const mat of doc.getRoot().listMaterials()) {
    const tr = mat.getExtension<Transmission>('KHR_materials_transmission');
    const t = tr?.getTransmissionFactor() ?? 0;
    if (t > 0) {
      const [r, g, b, a] = mat.getBaseColorFactor();
      mat
        .setAlphaMode('BLEND')
        .setBaseColorFactor([r, g, b, Math.min(a, 1 - 0.7 * t)]);
    }
  }
  for (const ext of doc.getRoot().listExtensionsUsed())
    if (!KEEP_EXTENSIONS.has(ext.extensionName)) ext.dispose();
}

/**
 * Merges separately published opacity maps into the base colour of
 * non-opaque materials whose base colour image has no alpha channel.
 */
async function applyOpacityMaps(doc: Document, info: CachedInfo, dir: string) {
  const extra = Object.entries(info.extraMaps ?? {});
  const notes: string[] = [];
  if (!extra.length) return notes;
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    const img = tex?.getImage();
    if (mat.getAlphaMode() === 'OPAQUE' || !tex || !img) continue;
    if ((await sharp(img).metadata()).hasAlpha) continue;
    const name = mat.getName();
    const match = (suffix: string) =>
      extra.find(([key]) => {
        if (!key.endsWith(suffix)) return false;
        const prefix = key.slice(0, -suffix.length).replace(/_$/, '');
        return prefix === '' || name === prefix || name.endsWith(`_${prefix}`);
      });
    const found = match('opacity') ?? match('alpha');
    if (!found) continue;
    const { width, height } = await sharp(img).metadata();
    const alpha = await sharp(join(dir, safeRelativePath(found[1])))
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    // (no removeAlpha(): sharp applies it after joinChannel and would drop the merge)
    const rgba = await sharp(img)
      .joinChannel(alpha, {
        raw: { width: width!, height: height!, channels: 1 },
      })
      .png()
      .toBuffer();
    tex.setImage(new Uint8Array(rgba)).setMimeType('image/png');
    // The authored alpha mode is kept: alpha-testing fine wire makes it vanish
    // at distance once mipmapped, while blending fades it into a haze.
    notes.push(`opacity '${found[0]}' -> ${name} (${mat.getAlphaMode()})`);
  }
  return notes;
}

/** Keeps only nodes matching `patterns` (and their subtrees). */
function applyPick(doc: Document, patterns: string[]) {
  const nodes = doc.getRoot().listNodes();
  const regs = patterns.map(globToRegExp);
  const keep = new Set<Node>();
  const hit = new Set<number>();
  for (const n of nodes) {
    const i = regs.findIndex((r) => r.test(n.getName()));
    if (i < 0) continue;
    hit.add(i);
    n.traverse((c) => keep.add(c));
  }
  const missing = patterns.filter((_, i) => !hit.has(i));
  if (missing.length)
    throw new Error(
      `pick: no node matches ${missing.join(', ')}; available: ${nodes
        .map((n) => n.getName())
        .join(', ')}`,
    );
  for (const n of nodes) if (!keep.has(n)) n.setMesh(null);
}

/**
 * Bakes every node transform into its geometry so the result is a flat list
 * of identity-transform mesh nodes under the scene (shared data is cloned).
 */
function bakeTransforms(doc: Document) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('glTF has no scene');
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  root.setDefaultScene(scene);
  const meshNodes: { node: Node; world: mat4 }[] = [];
  scene.traverse((node) => {
    if (node.getMesh()) meshNodes.push({ node, world: node.getWorldMatrix() });
  });
  const isPrimParent = (p: unknown) =>
    p instanceof Primitive || p instanceof PrimitiveTarget;
  for (const { node, world } of meshNodes) {
    let mesh = node.getMesh()!;
    if (mesh.listParents().filter((p) => p instanceof Node).length > 1) {
      mesh = mesh.clone();
      node.setMesh(mesh);
    }
    for (const src of mesh.listPrimitives()) {
      let prim = src;
      if (src.listParents().some((p) => p instanceof Mesh && p !== mesh)) {
        prim = src.clone();
        mesh.removePrimitive(src).addPrimitive(prim);
      }
      for (const semantic of prim.listSemantics()) {
        const acc = prim.getAttribute(semantic)!;
        if (acc.listParents().filter(isPrimParent).length > 1)
          prim.setAttribute(semantic, acc.clone());
      }
      const indices = prim.getIndices();
      if (indices && indices.listParents().filter(isPrimParent).length > 1)
        prim.setIndices(indices.clone());
      for (const target of prim.listTargets()) prim.removeTarget(target);
      transformPrimitive(prim, world);
    }
  }
  for (const { node } of meshNodes) {
    node.getParentNode()?.removeChild(node);
    node.setMatrix(IDENTITY).setSkin(null).setCamera(null);
    for (const child of node.listChildren()) node.removeChild(child);
    scene.addChild(node);
  }
  const keep = new Set(meshNodes.map((m) => m.node));
  for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const a of root.listAnimations()) a.dispose();
}

function dropAttributes(doc: Document) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const semantic of prim.listSemantics())
        // Tangents are derived in-shader by three.js; joints/weights are unused.
        if (/^(TANGENT|JOINTS_\d+|WEIGHTS_\d+|_.*)$/.test(semantic))
          prim.setAttribute(semantic, null);
}

function simplifyDoc(
  doc: Document,
  ratio: number,
  error: number,
  flags: SimplifierFlag[],
  sloppy: boolean,
  pruneError: number,
) {
  const buffer = doc.getRoot().listBuffers()[0];
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx || prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const positions = pos.getArray();
      if (!(positions instanceof Float32Array)) continue;
      let indices = new Uint32Array(idx.getArray()!);
      const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
      // Remove only small disconnected parts (bolts, rivets, wire ends) first.
      if (pruneError > 0)
        indices = MeshoptSimplifier.simplifyPrune(
          indices,
          positions,
          3,
          pruneError,
        );
      const [out] = sloppy
        ? MeshoptSimplifier.simplifySloppy(
            indices,
            positions,
            3,
            null,
            target,
            error,
          )
        : MeshoptSimplifier.simplify(
            indices,
            positions,
            3,
            target,
            error,
            flags,
          );
      if (out.length === 0) {
        prim.dispose();
        continue;
      }
      prim.setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(out)
          .setBuffer(buffer ?? null),
      );
      if (idx.listParents().length <= 1) idx.dispose();
      compactPrimitive(prim);
    }
  for (const mesh of doc.getRoot().listMeshes())
    if (mesh.listPrimitives().length === 0) mesh.dispose();
}

/**
 * Simplifies until triangles <= cap, starting with the gentlest settings and
 * escalating: larger error budgets, then removing ever larger (but still small)
 * disconnected parts before simplifying, then collapsing across UV seams, and
 * finally sloppy clustering. Returns the first result under the cap. Errors
 * are fractions of each primitive's extent.
 */
function simplifyToCap(doc: Document, cap: number) {
  const tris = countTris(doc);
  if (tris <= cap) return { doc, method: 'none' };
  const ratio = (cap * 0.97) / tris;
  type Step = [flags: SimplifierFlag[], error: number, prune: number];
  const steps = (flags: SimplifierFlag[], prune: number, errors: number[]) =>
    errors.map((e): Step => [flags, e, prune]);
  const ladder: Step[] = [
    ...steps([], 0, [0.002, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04]),
    ...steps([], 0.005, [0.01, 0.02, 0.03, 0.05]),
    ...steps([], 0.01, [0.02, 0.03, 0.05, 0.07]),
    ...steps([], 0.02, [0.03, 0.05, 0.07, 0.1]),
    ...steps([], 0.035, [0.05, 0.07, 0.1, 0.15]),
    ...steps([], 0.05, [0.1, 0.15, 0.2]),
    // Last resort before sloppy: allow collapses across UV seams.
    ...steps(['Permissive'], 0.05, [0.1, 0.25, 0.5, 1]),
  ];
  for (const [flags, error, prune] of ladder) {
    const trial = cloneDocument(doc);
    simplifyDoc(trial, ratio, error, flags, false, prune);
    if (countTris(trial) <= cap)
      return {
        doc: trial,
        method:
          `meshopt${flags.length ? '[' + flags.join('+') + ']' : ''} err<=${error}` +
          (prune ? ` prune<=${prune}` : ''),
      };
  }
  for (const error of [0.02, 0.1, 0.5, 1]) {
    const trial = cloneDocument(doc);
    simplifyDoc(trial, ratio, error, [], true, 0);
    if (countTris(trial) <= cap)
      return { doc: trial, method: `sloppy err<=${error}` };
  }
  throw new Error(
    `cannot simplify ${tris} triangles to <= ${cap} (hard cap ${HARD_TRI_CAP})`,
  );
}

/** Scales by `s` and moves so the AABB is centred in X/Z with min Y = 0. */
function normalizePositions(doc: Document, s: number) {
  const scene = doc.getRoot().getDefaultScene()!;
  const seen = new Set<Accessor>();
  const each = (fn: (a: Float32Array) => void) => {
    seen.clear();
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos || seen.has(pos)) continue;
        seen.add(pos);
        const arr = pos.getArray() as Float32Array;
        fn(arr);
        pos.setArray(arr);
      }
  };
  if (s !== 1)
    each((a) => {
      for (let i = 0; i < a.length; i++) a[i]! *= s;
    });
  const b = getBounds(scene);
  const off = [
    -(b.min[0] + b.max[0]) / 2,
    -b.min[1],
    -(b.min[2] + b.max[2]) / 2,
  ] as const;
  each((a) => {
    for (let i = 0; i < a.length; i += 3) {
      a[i]! += off[0];
      a[i + 1]! += off[1];
      a[i + 2]! += off[2];
    }
  });
  const nb = getBounds(scene);
  return [0, 1, 2].map((i) => round(nb.max[i]! - nb.min[i]!)) as [
    number,
    number,
    number,
  ];
}

async function processTextures(doc: Document, size: number, name: string) {
  let maxDim = 0;
  let i = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const slots = listTextureSlots(tex);
    const isNormal = slots.includes('normalTexture');
    const isColor = slots.some((s) => /baseColor|emissive/i.test(s));
    const alphaUser = tex
      .listParents()
      .some(
        (p) =>
          p instanceof Material &&
          p.getAlphaMode() !== 'OPAQUE' &&
          p.getBaseColorTexture() === tex,
      );
    const meta = await sharp(img).metadata();
    const keepAlpha = alphaUser && !!meta.hasAlpha;
    // RGBA PNGs are large; alpha-cutout textures (wire, grilles) are capped at 512.
    const limit = keepAlpha ? Math.min(size, 512) : size;
    const pipeline = sharp(img).resize(limit, limit, {
      fit: 'inside',
      withoutEnlargement: true,
    });
    const { data, info } = keepAlpha
      ? await pipeline
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer({ resolveWithObject: true })
      : await pipeline
          .removeAlpha()
          .jpeg({
            quality: isNormal ? 88 : isColor ? 80 : 82,
            mozjpeg: true,
            // Packed data (normal / ORM) must not be chroma-subsampled.
            chromaSubsampling: isColor ? '4:2:0' : '4:4:4',
          })
          .toBuffer({ resolveWithObject: true });
    maxDim = Math.max(maxDim, info.width, info.height);
    const slot = (slots[0] ?? 'texture').replace(/Texture$/, '');
    tex
      .setImage(new Uint8Array(data))
      .setMimeType(keepAlpha ? 'image/png' : 'image/jpeg')
      .setURI(`${name}_${slot}_${i++}.${keepAlpha ? 'png' : 'jpg'}`)
      .setName(`${name}_${slot}`);
  }
  return maxDim;
}

async function optimizeModel(
  entry: ListEntry,
  listName: string,
): Promise<Result> {
  const { dir, info } = await readInfo(entry);
  if (!info.main) throw new Error(`${entry.id}: cached info has no glTF`);
  const id = outId(entry);
  const notes: string[] = [];
  let doc = await io.read(join(dir, safeSegment(info.main)));
  const srcTris = countTris(doc);

  stripExtensions(doc);
  if (entry.pick?.length) applyPick(doc, entry.pick);
  await doc.transform(prune());
  notes.push(...(await applyOpacityMaps(doc, info, dir)));
  await doc.transform(dequantize(), dedup(), prune());
  bakeTransforms(doc);
  dropAttributes(doc);
  await doc.transform(
    joinPrimitives({ keepNamed: false, keepMeshes: false }),
    weld(),
    prune({ keepAttributes: false, keepLeaves: false }),
  );

  const cap = Math.min(entry.triCap ?? DEFAULT_TRI_CAP, HARD_TRI_CAP);
  const pre = countTris(doc);
  const simplified = simplifyToCap(doc, cap);
  doc = simplified.doc;
  await doc.transform(prune({ keepAttributes: false, keepLeaves: false }));
  const tris = countTris(doc);
  if (tris > HARD_TRI_CAP) throw new Error(`${id}: ${tris} tris > hard cap`);
  if (simplified.method !== 'none')
    notes.push(`${pre}->${tris} tris (${simplified.method})`);
  if (pre / Math.max(tris, 1) >= 8)
    notes.push(`heavy reduction x${(pre / tris).toFixed(1)}`);

  // Real-world scale check against the source's published dimensions.
  let scale = entry.scale ?? 1;
  const scene = doc.getRoot().getDefaultScene()!;
  if (entry.scale === undefined && info.dimensionsMeters && !entry.pick) {
    // Published dimensions use inconsistent axis order, so compare sorted extents.
    const b = getBounds(scene);
    const measured = [0, 1, 2]
      .map((i) => b.max[i]! - b.min[i]!)
      .sort((x, y) => x - y);
    const expected = [...info.dimensionsMeters].sort((x, y) => x - y);
    const r = measured
      .map((m, i) => m / expected[i]!)
      .filter((x) => Number.isFinite(x) && x > 0);
    const mean = r.reduce((a, c) => a + c, 0) / (r.length || 1);
    if (r.length === 3 && Math.max(...r) / Math.min(...r) < 1.15) {
      if (Math.abs(mean - 1) > 0.2) {
        scale = 1 / mean;
        notes.push(`rescaled x${round(scale, 4)} to match source dimensions`);
      }
    } else if (
      r.length === 3 &&
      Math.max(...r.map((x) => Math.abs(x - 1))) > 0.25
    )
      notes.push(
        `size differs from source dims (${r.map((x) => x.toFixed(2)).join('/')})`,
      );
  }
  const size = normalizePositions(doc, scale);

  const texSize = entry.textureSize ?? 512;
  const maxTex = await processTextures(doc, texSize, id);
  await doc.transform(prune({ keepAttributes: false, keepLeaves: false }));

  doc.getRoot().getAsset().generator = 'Leviathan0 tools/assets/optimize.ts';
  doc.getRoot().setExtras({
    source: SITE_NAME[info.source],
    sourceUrl: info.sourceUrl,
    license: 'CC0',
    author: info.author,
  });
  const glb = await io.writeBinary(doc);
  await mkdir(MODEL_DIR, { recursive: true });
  const out = join(MODEL_DIR, `${safeSegment(id)}.glb`);
  await writeFileAtomic(out, glb);

  const prop = `cc0.${entry.category}.${id.toLowerCase()}`;
  const catalog: CatalogEntry = {
    id,
    kind: 'model',
    source: SITE_NAME[info.source],
    ...(id !== entry.id ? { sourceId: entry.id } : {}),
    sourceUrl: info.sourceUrl,
    license: 'CC0',
    ...(info.author ? { author: info.author } : {}),
    tris,
    textureSize: maxTex,
    category: entry.category!,
    prop,
    path: webPath(out),
    size,
    bytes: glb.byteLength,
    fallback: `prop.${entry.fallback ?? CATEGORY_FALLBACK[entry.category!]}`,
    lists: [listName],
  };
  if (srcTris !== pre && !entry.pick) notes.unshift(`source ${srcTris} tris`);
  return { entry, catalog, files: [out], notes };
}

// ------------------------------------------------------------- materials ---

const MAP_PATTERNS: Record<string, RegExp[]> = {
  albedo: [/_Color\.jpe?g$/i, /_diff_\d+k\.jpe?g$/i],
  normal: [/_NormalGL\.jpe?g$/i, /_nor_gl_\d+k\.jpe?g$/i],
  roughness: [/_Roughness\.jpe?g$/i, /_rough_\d+k\.jpe?g$/i],
  ao: [/_AmbientOcclusion\.jpe?g$/i, /_ao_\d+k\.jpe?g$/i],
  metalness: [/_Metalness\.jpe?g$/i],
  opacity: [/_Opacity\.jpe?g$/i],
};
const REQUIRED_MAPS = ['albedo', 'normal', 'roughness'];

function defaultTile(key: string) {
  return DEFAULT_TILE[key] ?? DEFAULT_TILE[key.split('.')[0]!] ?? 2;
}

async function optimizeMaterial(
  entry: ListEntry,
  listName: string,
): Promise<Result> {
  const { dir, info } = await readInfo(entry);
  const key = entry.key!;
  const outDir = join(TEXTURE_DIR, safeSegment(key));
  await mkdir(outDir, { recursive: true });
  const size = entry.textureSize ?? 1024;
  const maps: Record<string, string> = {};
  const low: Record<string, string> = {};
  const written: string[] = [];
  let bytes = 0;
  let maxDim = 0;
  for (const [map, patterns] of Object.entries(MAP_PATTERNS)) {
    const file = info.files.find((f) => patterns.some((p) => p.test(f)));
    if (!file) {
      if (REQUIRED_MAPS.includes(map))
        throw new Error(`${entry.id}: missing ${map} map`);
      continue;
    }
    const src = join(dir, file);
    for (const s of [size, LOW_SIZE]) {
      let img = sharp(src).resize(s, s, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (map !== 'albedo' && map !== 'normal') img = img.toColourspace('b-w');
      const { data, info: meta } = await img
        .jpeg({
          quality: map === 'normal' ? 88 : map === 'albedo' ? 82 : 80,
          mozjpeg: true,
          chromaSubsampling: map === 'albedo' ? '4:2:0' : '4:4:4',
        })
        .toBuffer({ resolveWithObject: true });
      const out = join(outDir, `${map}_${s}.jpg`);
      await writeFileAtomic(out, data);
      written.push(out);
      bytes += data.byteLength;
      if (s === size) maxDim = Math.max(maxDim, meta.width, meta.height);
      (s === size ? maps : low)[map] = webPath(out);
    }
  }
  // Remove maps a previous material for this key produced but this one lacks.
  for (const f of await readdir(outDir))
    if (!written.includes(join(outDir, f))) await rm(join(outDir, f));

  const tile = round(entry.tile ?? info.tileMeters ?? defaultTile(key), 2);
  const catalog: CatalogEntry = {
    id: entry.id,
    kind: 'material',
    source: SITE_NAME[info.source],
    sourceUrl: info.sourceUrl,
    license: 'CC0',
    ...(info.author ? { author: info.author } : {}),
    textureSize: maxDim,
    key,
    tile,
    bytes,
    fallback: 'procedural',
    lists: [listName],
  };
  const notes = [
    `tile ${tile} m (${entry.tile ? 'list' : info.tileMeters ? 'source metadata' : 'default'})`,
  ];
  const material: ManifestMaterial = {
    id: entry.id,
    size: maxDim,
    tile,
    maps,
    low,
  };
  materialsOut.set(key, material);
  return { entry, catalog, files: written, notes };
}

// ----------------------------------------------------------------- hdris ---

async function optimizeHdri(
  entry: ListEntry,
  listName: string,
): Promise<Result> {
  const { dir, info } = await readInfo(entry);
  if (!info.main) throw new Error(`${entry.id}: cached info has no .hdr`);
  const src = join(dir, safeSegment(info.main));
  const head = (await readFile(src)).subarray(0, 10).toString('latin1');
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE'))
    throw new Error(`${entry.id}: not a Radiance .hdr file`);
  await mkdir(HDRI_DIR, { recursive: true });
  const out = join(HDRI_DIR, `${safeSegment(entry.id)}_1k.hdr`);
  await copyFile(src, out);
  const bytes = (await stat(out)).size;
  return {
    entry,
    files: [out],
    notes: [],
    catalog: {
      id: entry.id,
      kind: 'hdri',
      source: SITE_NAME[info.source],
      sourceUrl: info.sourceUrl,
      license: 'CC0',
      ...(info.author ? { author: info.author } : {}),
      textureSize: 1024,
      path: webPath(out),
      bytes,
      fallback: 'procedural',
      lists: [listName],
    },
  };
}

// -------------------------------------------------------------- manifest ---

const materialsOut = new Map<string, ManifestMaterial>();

function sortObject<T>(obj: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

async function format(text: string, filepath: string) {
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...config, filepath });
}

async function writeManifest(
  results: Result[],
  listName: string,
  listHdris: string[],
  removeStale: boolean,
  currentIds: Set<string>,
) {
  const manifest: Manifest = (await exists(MANIFEST_PATH))
    ? (JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest)
    : { models: {}, textures: {}, hdri: [], audio: {} };
  manifest.models ??= {};
  manifest.textures ??= {};
  manifest.hdri ??= [];
  manifest.audio ??= {};
  const materials = (manifest.materials ??= {});
  const catalog = (manifest.catalog ??= {});

  if (removeStale)
    for (const [id, e] of Object.entries(catalog)) {
      if (!e.lists?.includes(listName) || currentIds.has(id)) continue;
      e.lists = e.lists.filter((l) => l !== listName);
      if (e.lists.length) continue;
      delete catalog[id];
      if (e.prop && manifest.models[e.prop] === e.path)
        delete manifest.models[e.prop];
      if (e.key && materials[e.key]?.id === id) {
        delete materials[e.key];
        await rm(join(TEXTURE_DIR, safeSegment(e.key)), {
          recursive: true,
          force: true,
        });
      }
      if (e.kind === 'hdri' && e.path)
        manifest.hdri = manifest.hdri.filter((p) => p !== e.path);
      if (e.path && e.kind !== 'material')
        await rm(join(PUBLIC_DIR, e.path), { force: true });
      console.log(`  removed stale ${e.kind} ${id}`);
    }

  for (const r of results) {
    const prev = catalog[r.catalog.id];
    const lists = new Set([...(prev?.lists ?? []), ...r.catalog.lists]);
    catalog[r.catalog.id] = { ...r.catalog, lists: [...lists].sort() };
    if (r.catalog.prop && r.catalog.path)
      manifest.models[r.catalog.prop] = r.catalog.path;
  }
  // Hand-authored keys keep their order; generated cc0.* keys follow, sorted.
  const models = Object.entries(manifest.models);
  manifest.models = Object.fromEntries([
    ...models.filter(([k]) => !k.startsWith('cc0.')),
    ...Object.entries(
      sortObject(
        Object.fromEntries(models.filter(([k]) => k.startsWith('cc0.'))),
      ),
    ),
  ]);
  for (const [key, m] of materialsOut) materials[key] = m;
  manifest.hdri = [
    ...listHdris,
    ...manifest.hdri.filter((p) => !listHdris.includes(p)),
  ];
  manifest.materials = sortObject(materials);
  manifest.catalog = sortObject(catalog);

  const text = await format(JSON.stringify(manifest), MANIFEST_PATH);
  await writeFileAtomic(MANIFEST_PATH, text);
  return manifest;
}

async function writeCatalogTs(manifest: Manifest) {
  const all = Object.values(manifest.catalog ?? {}).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const author = (e: CatalogEntry) => (e.author ? { author: e.author } : {});
  const models = all
    .filter((e) => e.kind === 'model')
    .map((e) => ({
      id: e.id,
      prop: e.prop,
      category: e.category,
      size: { x: e.size![0], y: e.size![1], z: e.size![2] },
      tris: e.tris,
      textureSize: e.textureSize,
      fallback: e.fallback,
      source: e.source,
      sourceUrl: e.sourceUrl,
      license: 'CC0',
      ...author(e),
    }));
  const materials = all
    .filter((e) => e.kind === 'material')
    .map((e) => ({
      id: e.id,
      key: e.key,
      tile: e.tile,
      source: e.source,
      sourceUrl: e.sourceUrl,
      license: 'CC0',
      ...author(e),
    }));
  const hdris = all
    .filter((e) => e.kind === 'hdri')
    .map((e) => ({
      id: e.id,
      path: e.path,
      source: e.source,
      sourceUrl: e.sourceUrl,
      license: 'CC0',
      ...author(e),
    }));
  const src = `// Generated by tools/assets/optimize.ts from packages/client/public/asset-manifest.json.
// Do not edit by hand: change a list in tools/assets/lists/ and run \`npm run assets:optimize\`.
// Every entry is CC0 (public domain); author and source page are kept for credit.

export interface CatalogModel {
  id: string;
  prop: string;
  category: string;
  size: { x: number; y: number; z: number };
  tris: number;
  textureSize: number;
  fallback: string;
  source: string;
  sourceUrl: string;
  license: 'CC0';
  author?: string;
}

export interface CatalogMaterial {
  id: string;
  key: string;
  tile: number;
  source: string;
  sourceUrl: string;
  license: 'CC0';
  author?: string;
}

export interface CatalogHdri {
  id: string;
  path: string;
  source: string;
  sourceUrl: string;
  license: 'CC0';
  author?: string;
}

export const ASSET_MODELS: readonly CatalogModel[] = ${JSON.stringify(models)};

export const ASSET_MATERIALS: readonly CatalogMaterial[] = ${JSON.stringify(materials)};

export const ASSET_HDRIS: readonly CatalogHdri[] = ${JSON.stringify(hdris)};
`;
  await writeFileAtomic(CATALOG_TS_PATH, await format(src, CATALOG_TS_PATH));
}

// ------------------------------------------------------------------ main ---

async function main() {
  const { listFile, only } = parseArgs(process.argv.slice(2));
  const list = await readList(listFile);
  const entries = list.assets.filter((e) => !only || only.has(e.id));
  console.log(`optimize: ${list.name} — ${entries.length} entries`);
  await MeshoptSimplifier.ready;

  const results: Result[] = [];
  const order = new Map(entries.map((e, i) => [e, i]));
  const errors = await pool(entries, 3, async (entry) => {
    const r =
      entry.kind === 'model'
        ? await optimizeModel(entry, list.name)
        : entry.kind === 'material'
          ? await optimizeMaterial(entry, list.name)
          : await optimizeHdri(entry, list.name);
    results.push(r);
    const c = r.catalog;
    console.log(
      `  ok ${c.kind} ${c.id}` +
        (c.tris !== undefined ? ` ${c.tris} tris` : '') +
        (c.size ? ` ${c.size.join('x')} m` : '') +
        ` tex ${c.textureSize} ${fmtBytes(c.bytes)}` +
        (r.notes.length ? ` — ${r.notes.join('; ')}` : ''),
    );
  });
  if (errors.length) {
    for (const { item, error } of errors)
      console.error(
        `  FAILED ${item.kind} ${outId(item)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    console.error(
      `optimize: ${errors.length} entr${errors.length === 1 ? 'y' : 'ies'} failed; manifest not updated`,
    );
    process.exit(1);
  }
  results.sort((a, b) => order.get(a.entry)! - order.get(b.entry)!);

  const listHdris = results
    .filter((r) => r.catalog.kind === 'hdri')
    .map((r) => r.catalog.path!);
  const currentIds = new Set(list.assets.map((e) => outId(e)));
  const manifest = await writeManifest(
    results,
    list.name,
    listHdris,
    !only,
    currentIds,
  );
  await writeCatalogTs(manifest);

  // Summary + machine-readable report (kept in the ignored cache dir).
  const byKind = (k: Kind) => results.filter((r) => r.catalog.kind === k);
  const sum = (rs: Result[], f: (c: CatalogEntry) => number) =>
    rs.reduce((a, r) => a + f(r.catalog), 0);
  const models = byKind('model');
  const perCategory: Record<string, number> = {};
  for (const r of models)
    perCategory[r.catalog.category!] =
      (perCategory[r.catalog.category!] ?? 0) + 1;
  const totals = {
    models: models.length,
    materials: byKind('material').length,
    hdris: byKind('hdri').length,
    modelBytes: sum(models, (c) => c.bytes),
    materialBytes: sum(byKind('material'), (c) => c.bytes),
    hdriBytes: sum(byKind('hdri'), (c) => c.bytes),
    triangles: sum(models, (c) => c.tris ?? 0),
    perCategory: sortObject(perCategory),
  };
  const totalBytes =
    totals.modelBytes + totals.materialBytes + totals.hdriBytes;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFileAtomic(
    join(CACHE_DIR, `report-${safeSegment(list.name)}.json`),
    JSON.stringify(
      {
        list: list.name,
        totals: { ...totals, totalBytes },
        entries: results.map((r) => ({ ...r.catalog, notes: r.notes })),
      },
      null,
      2,
    ),
  );
  console.log(
    `optimize: ${totals.models} models (${totals.triangles} tris, ${fmtBytes(totals.modelBytes)}), ` +
      `${totals.materials} materials (${fmtBytes(totals.materialBytes)}), ` +
      `${totals.hdris} HDRIs (${fmtBytes(totals.hdriBytes)}) — total ${fmtBytes(totalBytes)}`,
  );
  console.log(
    `optimize: wrote ${webPath(MANIFEST_PATH)} and ${CATALOG_TS_PATH.slice(CATALOG_TS_PATH.indexOf('packages'))}`,
  );
}

await main();
