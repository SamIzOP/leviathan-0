import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3 } from '@leviathan/shared';
import { forgeAsset, type Recipe } from '../../shared/src/forge-data';
import { primitive, partMatrix, RECIPES } from './forge';
import { grime, type WorldMaterials } from './world-materials';
import type { WorldAssets } from './world-assets';
/** One dressing prop: the shared level fixes its footprint; the client picks the look. */
export interface PropPlacement {
  id: string;
  key: string;
  fallback?: string;
  min: Vec3;
  max: Vec3;
  yaw: number;
  zone: string;
  solid: boolean;
  tint: number;
}
interface Prototype {
  parts: { geometry: T.BufferGeometry; material: T.Material }[];
  bounds: T.Box3;
  source: string;
  triangles: number;
}
/** CC0 material sets for procedural prop recipes; glass, rubber and tarp stay procedural. */
const RECIPE_MATERIALS: Partial<Record<Recipe, string>> = {
  steel: 'metal.painted',
  rust: 'metal.rusted',
  galvanized: 'metal.plates',
  iron: 'metal.dark',
  pale: 'metal.painted',
  concrete: 'concrete.stained',
  brick: 'brick.red',
  wood: 'wood.planks',
};
interface Bucket {
  key: string;
  zone: string;
  items: PropPlacement[];
}
const CELL = 48;
/** Distance culling per preset; big silhouettes (tanks, containers) stay longer. */
const RANGE = { LOW: 55, MEDIUM: 100, HIGH: 140 } as const;
const triangles = (g: T.BufferGeometry) =>
  (g.index ? g.index.count : g.attributes.position!.count) / 3;
const count = (m: T.Mesh) => (m instanceof T.InstancedMesh ? m.count : 1);
/** Dressing props: each prototype loads once (imported GLB, else the procedural
 * forge family). Imported models are instanced per 48 m cell; procedural props
 * share eleven recipe materials, so they are merged per cell and material, which
 * bounds draw calls however many families a cell mixes. Frustum and distance
 * culling work per cell. Yaw, fitted scale and grey tint vary repeats. Collision
 * stays the shared solid's nominal primitive. */
export class PropLayer {
  placements: PropPlacement[] = [];
  meshes: T.Mesh[] = [];
  status: Record<string, string> = {};
  /** Imported texture tier, set before build: LOW caps maps at 512 px (256 px
   * below 1 m) and drops normal maps (props are small at 720p in fog); 0 keeps
   * the shipped maps. */
  textureCap = 0;
  normals = true;
  private prototypes = new Map<string, Prototype>();
  private geometries: T.BufferGeometry[] = [];
  private ownedMaterials: T.Material[] = [];
  private textures = new Set<T.Texture>();
  private recipeMaterials = new Map<Recipe, T.MeshStandardMaterial>();
  constructor(
    private root: T.Group,
    private materials: WorldMaterials,
    private seed: number,
    private haze: { heightFog: number; horizon: string },
  ) {}
  add(p: PropPlacement) {
    this.placements.push(p);
  }
  private async assetPrototype(assets: WorldAssets, key: string) {
    const path = assets.manifest.models[key];
    if (!path || !(await assetExists(assets, path))) return null;
    try {
      const gltf = await assets.loader.loadAsync(path);
      gltf.scene.updateMatrixWorld(true);
      const size = new T.Box3()
        .setFromObject(gltf.scene)
        .getSize(new T.Vector3())
        .length();
      const byMaterial = new Map<T.Material, T.BufferGeometry[]>();
      gltf.scene.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const g = (o.geometry as T.BufferGeometry).clone();
        g.applyMatrix4(o.matrixWorld);
        const material = Array.isArray(o.material)
          ? o.material[0]!
          : o.material;
        byMaterial.set(material, [...(byMaterial.get(material) ?? []), g]);
      });
      const parts: Prototype['parts'] = [];
      for (const [material, list] of byMaterial) {
        const merged =
          list.length > 1
            ? (mergeGeometries(list, false) ?? list[0]!)
            : list[0]!;
        list.forEach((g) => g !== merged && g.dispose());
        if (material instanceof T.MeshStandardMaterial) {
          this.tier(material, size);
          // Blended double-sided glass/wire would draw in two passes whose
          // programs the loading warm-up never compiles (a mid-run hitch).
          if (material.transparent && material.side === T.DoubleSide)
            material.forceSinglePass = true;
          grime(material, this.haze.heightFog, this.haze.horizon, false, 0.8);
          for (const value of Object.values(material))
            if (value instanceof T.Texture) this.textures.add(value);
        }
        this.ownedMaterials.push(material);
        parts.push({ geometry: merged, material });
      }
      return this.finish(parts, path);
    } catch {
      this.status[key] = 'procedural (load failed)';
      return null;
    }
  }
  /** Vertex-coloured copy of the recipe's world material, so merged props keep
   * their per-prop tint without touching the shared architecture materials. */
  private recipeMaterial(recipe: Recipe) {
    let m = this.recipeMaterials.get(recipe);
    if (!m) {
      const r = RECIPES[recipe];
      m = this.materials.get(r.surface, r.color).clone();
      m.vertexColors = true;
      m.userData = {
        worldSurface: r.surface,
        worldColor: r.color,
        materialKey: RECIPE_MATERIALS[recipe],
      };
      grime(m, this.haze.heightFog, this.haze.horizon, true, 0.35);
      this.recipeMaterials.set(recipe, m);
      this.ownedMaterials.push(m);
    }
    return m;
  }
  /** Imported prop textures, uploaded during loading rather than on first sight. */
  get uploads() {
    return [...this.textures];
  }
  /** Recipe materials, for CC0 map assignment and preset texture swaps. */
  get forgeMaterials() {
    return [...this.recipeMaterials.values()];
  }
  /** Follow a preset's procedural maps; imported CC0 maps are preset independent. */
  retexture(next: WorldMaterials) {
    for (const m of this.recipeMaterials.values()) {
      if (m.userData.realMaps) continue;
      const base = next.get(m.userData.worldSurface, m.userData.worldColor);
      m.map = base.map;
      m.bumpMap = base.bumpMap;
      m.roughnessMap = base.roughnessMap;
      m.needsUpdate = true;
    }
  }
  private shrunk = new Map<T.Texture, T.Texture>();
  private tier(material: T.MeshStandardMaterial, size: number) {
    if (!this.normals && material.normalMap) {
      material.normalMap.dispose();
      material.normalMap = null;
    }
    if (!this.textureCap) return;
    // Sub-metre props never cover more than ~100 px at 720p: half the cap.
    const cap = size < 1 ? this.textureCap / 2 : this.textureCap;
    for (const slot of [
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
      'alphaMap',
    ] as const) {
      const t = material[slot],
        img = t?.image as ImageBitmap | HTMLImageElement | undefined;
      if (!t || !img || Math.max(img.width, img.height) <= cap) continue;
      let small = this.shrunk.get(t);
      if (!small) {
        const k = cap / Math.max(img.width, img.height),
          canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas
          .getContext('2d')!
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        small = new T.CanvasTexture(canvas);
        small.colorSpace = t.colorSpace;
        small.flipY = t.flipY;
        small.wrapS = t.wrapS;
        small.wrapT = t.wrapT;
        small.channel = t.channel;
        this.shrunk.set(t, small);
        t.dispose();
      }
      material[slot] = small;
    }
    material.needsUpdate = true;
  }
  private forgePrototype(key: string, variant: number) {
    const asset = forgeAsset(key, variant, this.seed, 0);
    const byMaterial = new Map<T.Material, T.BufferGeometry[]>();
    for (const part of asset.parts) {
      const material = this.recipeMaterial(part.recipe);
      const g = primitive(part.shape).applyMatrix4(partMatrix(part));
      for (const name of Object.keys(g.attributes))
        if (!['position', 'normal', 'uv'].includes(name))
          g.deleteAttribute(name);
      const n = g.attributes.position!.count;
      if (!g.attributes.uv)
        g.setAttribute(
          'uv',
          new T.Float32BufferAttribute(new Float32Array(n * 2), 2),
        );
      if (!g.index) g.setIndex([...Array(n).keys()]);
      byMaterial.set(material, [...(byMaterial.get(material) ?? []), g]);
    }
    const parts: Prototype['parts'] = [];
    for (const [material, list] of byMaterial) {
      const merged = mergeGeometries(list, false) ?? list[0]!;
      list.forEach((g) => g !== merged && g.dispose());
      parts.push({ geometry: merged, material });
    }
    return this.finish(parts, 'procedural');
  }
  private finish(parts: Prototype['parts'], source: string): Prototype {
    const bounds = new T.Box3();
    let tris = 0;
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      bounds.union(p.geometry.boundingBox!);
      tris += triangles(p.geometry);
      this.geometries.push(p.geometry);
    }
    return { parts, bounds, source, triangles: tris };
  }
  private async prototype(assets: WorldAssets, p: PropPlacement) {
    const procedural = p.key.startsWith('prop.') ? p.key : p.fallback;
    const variant = [...p.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
    const id = assets.manifest.models[p.key]
      ? p.key
      : `${procedural}#${variant}`;
    let proto = this.prototypes.get(id);
    if (proto) return { id, proto };
    proto = (await this.assetPrototype(assets, p.key)) ?? undefined;
    if (proto) this.status[p.key] = proto.source;
    else {
      const fallbackId = `${procedural}#${variant}`;
      proto = this.prototypes.get(fallbackId);
      if (!proto) {
        proto = this.forgePrototype(procedural ?? 'prop.crate', variant);
        this.prototypes.set(fallbackId, proto);
      }
      this.status[p.key] ??= 'procedural';
      return { id: fallbackId, proto };
    }
    this.prototypes.set(id, proto);
    return { id, proto };
  }
  /** Fit the prototype's local bounds into the authored footprint after yaw. */
  private matrix(p: PropPlacement, b: T.Box3) {
    const s = b.getSize(new T.Vector3()),
      c = Math.abs(Math.cos(p.yaw)),
      n = Math.abs(Math.sin(p.yaw));
    const rx = c * s.x + n * s.z,
      rz = n * s.x + c * s.z;
    const kx = (p.max.x - p.min.x) / Math.max(rx, 1e-3),
      ky = (p.max.y - p.min.y) / Math.max(s.y, 1e-3),
      kz = (p.max.z - p.min.z) / Math.max(rz, 1e-3);
    const scale = new T.Vector3(c * kx + n * kz, ky, n * kx + c * kz),
      center = b.getCenter(new T.Vector3());
    return new T.Matrix4()
      .makeTranslation(
        (p.min.x + p.max.x) / 2,
        p.min.y,
        (p.min.z + p.max.z) / 2,
      )
      .multiply(new T.Matrix4().makeRotationY(p.yaw))
      .multiply(new T.Matrix4().makeScale(scale.x, scale.y, scale.z))
      .multiply(
        new T.Matrix4().makeTranslation(-center.x, -b.min.y, -center.z),
      );
  }
  async build(assets: WorldAssets, yieldEvery: () => Promise<boolean>) {
    const buckets = new Map<string, Bucket & { protoId: string }>();
    for (const p of this.placements) {
      const { id } = await this.prototype(assets, p);
      const cell = `${Math.floor((p.min.x + p.max.x) / 2 / CELL)},${Math.floor((p.min.z + p.max.z) / 2 / CELL)}`;
      const key = `${id}|${cell}`;
      let b = buckets.get(key);
      if (!b)
        buckets.set(
          key,
          (b = { key: cell, protoId: id, zone: p.zone, items: [] }),
        );
      b.items.push(p);
      if (await yieldEvery()) return;
    }
    const color = new T.Color(),
      merged = new Map<
        string,
        {
          zone: string;
          material: T.Material;
          large: boolean;
          parts: T.BufferGeometry[];
          ids: string[];
        }
      >();
    // Seeded grey-scale tint with a faint rust or cold cast, never saturated.
    const tint = (p: PropPlacement) => {
      const g = 0.74 + 0.3 * p.tint,
        w = Math.sin(p.tint * 41.7) * 0.05;
      return color.setRGB(g * (1 + w), g, g * (1 - w * 0.8));
    };
    for (const b of buckets.values()) {
      const proto = this.prototypes.get(b.protoId)!,
        large = proto.bounds.getSize(new T.Vector3()).length() > 6;
      const matrices = b.items.map((p) => this.matrix(p, proto.bounds));
      if (proto.source === 'procedural') {
        b.items.forEach((p, i) => {
          const c = tint(p);
          for (const part of proto.parts) {
            const key = `${p.zone}|${b.key}|${part.material.uuid}|${large}`;
            let group = merged.get(key);
            if (!group)
              merged.set(
                key,
                (group = {
                  zone: p.zone,
                  material: part.material,
                  large,
                  parts: [],
                  ids: [],
                }),
              );
            const g = part.geometry.clone().applyMatrix4(matrices[i]!),
              n = g.attributes.position!.count,
              rgb = new Uint8Array(n * 3);
            for (let v = 0; v < n; v++)
              rgb.set([c.r * 255, c.g * 255, c.b * 255], v * 3);
            g.setAttribute('color', new T.Uint8BufferAttribute(rgb, 3, true));
            group.parts.push(g);
            group.ids.push(p.id);
          }
        });
        continue;
      }
      for (const part of proto.parts) {
        const mesh = new T.InstancedMesh(
          part.geometry,
          part.material,
          b.items.length,
        );
        b.items.forEach((p, i) => {
          mesh.setMatrixAt(i, matrices[i]!);
          mesh.setColorAt(i, tint(p));
        });
        mesh.computeBoundingSphere();
        this.place(
          mesh,
          b.zone,
          b.protoId,
          b.items.map((p) => p.id),
          large,
        );
      }
    }
    for (const group of merged.values()) {
      const geometry = mergeGeometries(group.parts, false)!;
      group.parts.forEach((g) => g.dispose());
      geometry.computeBoundingSphere();
      this.geometries.push(geometry);
      this.place(
        new T.Mesh(geometry, group.material),
        group.zone,
        'procedural',
        [...new Set(group.ids)],
        group.large,
      );
      if (await yieldEvery()) return;
    }
  }
  private place(
    mesh: T.Mesh,
    zone: string,
    prop: string,
    sources: string[],
    large: boolean,
  ) {
    mesh.userData = { zone, prop, sources, large };
    this.root.add(mesh);
    this.meshes.push(mesh);
  }
  cull(camera: T.Camera, preset: keyof typeof RANGE) {
    const range = RANGE[preset];
    for (const mesh of this.meshes) {
      const s =
        mesh instanceof T.InstancedMesh
          ? mesh.boundingSphere
          : mesh.geometry.boundingSphere;
      mesh.visible =
        !s ||
        camera.position.distanceTo(s.center) - s.radius <
          range * (mesh.userData.large ? 1.8 : 1);
    }
  }
  /** Per-zone dressing statistics for reports and budget checks. */
  stats() {
    const zones: Record<
      string,
      { props: number; types: number; drawCalls: number; triangles: number }
    > = {};
    const types = new Map<string, Set<string>>();
    for (const p of this.placements) {
      const z = (zones[p.zone] ??= {
        props: 0,
        types: 0,
        drawCalls: 0,
        triangles: 0,
      });
      z.props++;
      types.set(p.zone, (types.get(p.zone) ?? new Set()).add(p.key));
    }
    for (const mesh of this.meshes) {
      const z = zones[mesh.userData.zone as string];
      if (!z) continue;
      z.drawCalls++;
      z.triangles += triangles(mesh.geometry) * count(mesh);
    }
    for (const [zone, set] of types) zones[zone]!.types = set.size;
    let textureBytes = 0;
    for (const t of this.textures) {
      const img = t.image as { width?: number; height?: number } | undefined;
      textureBytes += (img?.width ?? 0) * (img?.height ?? 0) * 4 * 1.33;
    }
    return {
      zones,
      prototypes: this.prototypes.size,
      meshes: this.meshes.length,
      textureMiB: Math.round((textureBytes / 1048576) * 10) / 10,
      assets: Object.values(this.status).filter((s) => s !== 'procedural')
        .length,
    };
  }
  dispose() {
    for (const mesh of this.meshes) {
      this.root.remove(mesh);
      if (mesh instanceof T.InstancedMesh) mesh.dispose();
    }
    this.geometries.forEach((g) => g.dispose());
    for (const m of this.ownedMaterials) m.dispose();
    this.textures.forEach((t) => t.dispose());
    this.meshes = [];
    this.geometries = [];
    this.ownedMaterials = [];
    this.textures.clear();
    this.prototypes.clear();
    this.recipeMaterials.clear();
    this.shrunk.clear();
  }
}
const existence = new WeakMap<WorldAssets, Map<string, Promise<boolean>>>();
function assetExists(assets: WorldAssets, path: string) {
  let cache = existence.get(assets);
  if (!cache) existence.set(assets, (cache = new Map()));
  let found = cache.get(path);
  if (!found) {
    found = fetch(path, { method: 'HEAD' })
      .then(
        (r) => r.ok && !r.headers.get('content-type')?.includes('text/html'),
      )
      .catch(() => false);
    cache.set(path, found);
  }
  return found;
}
