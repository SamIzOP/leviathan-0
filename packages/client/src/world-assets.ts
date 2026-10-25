import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Collider } from '@leviathan/shared';
import { grime } from './world-materials';
export interface AssetManifest {
  models: Record<string, string>;
  textures: Record<
    string,
    Partial<Record<'albedo' | 'normal' | 'roughness' | 'ao', string>>
  >;
  hdri: string[];
  audio: Record<string, string>;
  /** CC0 surface sets keyed by material key (see ZONE_MATERIALS). */
  materials?: Record<
    string,
    {
      id?: string;
      tile?: number;
      maps: Partial<Record<'albedo' | 'normal' | 'roughness' | 'ao', string>>;
      low?: Partial<Record<'albedo' | 'normal' | 'roughness' | 'ao', string>>;
    }
  >;
  /** Source, URL, licence and author per external asset. */
  catalog?: Record<string, Record<string, unknown>>;
}
export const emptyManifest: AssetManifest = {
  models: {},
  textures: {},
  hdri: ['/assets/hdri/sky.hdr', '/assets/hdri/sky.exr'],
  audio: {},
};
export async function assetExists(path: string) {
  try {
    const r = await fetch(path, { method: 'HEAD' });
    return r.ok && !r.headers.get('content-type')?.includes('text/html');
  } catch {
    return false;
  }
}
export class WorldAssets {
  manifest: AssetManifest = emptyManifest;
  draco = new DRACOLoader().setDecoderPath('/decoders/draco/');
  ktx: KTX2Loader;
  loader: GLTFLoader;
  objects: T.Object3D[] = [];
  textures: T.Texture[] = [];
  disposed = false;
  existence = new Map<string, Promise<boolean>>();
  status: Record<string, string> = {};
  constructor(renderer: T.WebGLRenderer) {
    this.ktx = new KTX2Loader()
      .setTranscoderPath('/decoders/basis/')
      .detectSupport(renderer);
    this.loader = new GLTFLoader()
      .setDRACOLoader(this.draco)
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(this.ktx);
  }
  async init() {
    try {
      const r = await fetch('/asset-manifest.json');
      if (r.ok) this.manifest = (await r.json()) as AssetManifest;
    } catch {
      /* complete procedural fallback */
    }
  }
  async model(key: string, box: Collider) {
    const path = this.manifest.models[key];
    if (path && !this.existence.has(path))
      this.existence.set(path, assetExists(path));
    if (!path || !(await this.existence.get(path))) {
      this.status[key] = 'procedural';
      return null;
    }
    try {
      const gltf = await this.loader.loadAsync(path),
        root = gltf.scene;
      this.objects.push(root);
      if (this.disposed) {
        this.disposeObject(root);
        return null;
      }
      const bounds = new T.Box3().setFromObject(root),
        size = bounds.getSize(new T.Vector3());
      root.scale.set(
        (box.max.x - box.min.x) / Math.max(size.x, 0.001),
        (box.max.y - box.min.y) / Math.max(size.y, 0.001),
        (box.max.z - box.min.z) / Math.max(size.z, 0.001),
      );
      bounds.setFromObject(root);
      root.position.set(
        (box.max.x + box.min.x) / 2 - (bounds.min.x + bounds.max.x) / 2,
        box.min.y - bounds.min.y,
        (box.max.z + box.min.z) / 2 - (bounds.min.z + bounds.max.z) / 2,
      );
      root.traverse((o) => {
        if (o instanceof T.Mesh) {
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          for (const m of materials)
            if (m instanceof T.MeshStandardMaterial)
              grime(m, 0.018, '#8b989e', false);
        }
      });
      this.status[key] = path;
      return root;
    } catch {
      this.status[key] = 'procedural (load failed)';
      return null;
    }
  }
  async texture(path: string) {
    if (!(await assetExists(path))) return null;
    try {
      const t = await (/\.ktx2$/i.test(path)
        ? this.ktx.loadAsync(path)
        : new T.TextureLoader().loadAsync(path));
      if (this.disposed) {
        t.dispose();
        return null;
      }
      t.wrapS = t.wrapT = T.RepeatWrapping;
      this.textures.push(t);
      return t;
    } catch {
      return null;
    }
  }
  async sky() {
    for (const path of this.manifest.hdri) {
      if (!(await assetExists(path))) continue;
      try {
        const tex = await (/\.exr$/i.test(path)
          ? new EXRLoader().loadAsync(path)
          : new RGBELoader().loadAsync(path));
        if (this.disposed) {
          tex.dispose();
          return null;
        }
        tex.mapping = T.EquirectangularReflectionMapping;
        this.textures.push(tex);
        return tex;
      } catch {
        /* next candidate */
      }
    }
    return null;
  }
  disposeObject(root: T.Object3D) {
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(m))
            if (value instanceof T.Texture) value.dispose();
          m.dispose();
        }
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.draco.dispose();
    this.ktx.dispose();
    this.objects.forEach((o) => this.disposeObject(o));
    this.textures.forEach((t) => t.dispose());
    this.objects = [];
    this.textures = [];
  }
}
/** Grade a downloaded HDRI to the level's overcast look before it lights the
 * world: desaturate, soft-clip the sun, and pull each row most of the way to
 * its azimuthal mean so wet ground mirrors a sky that varies with elevation
 * (as overcast does) rather than one bright side. Returns the environment
 * intensity at which its upper hemisphere matches the procedural sky dome. */
export function gradeOvercast(
  texture: T.Texture,
  sky: { sky: string; horizon: string },
  desaturate = 0.75,
  azimuthal = 0.8,
) {
  const img = texture.image as {
    data: Uint16Array | Float32Array;
    width: number;
    height: number;
  };
  const half = img.data instanceof Uint16Array,
    stride = img.data.length / (img.width * img.height),
    get = (i: number) =>
      half ? T.DataUtils.fromHalfFloat(img.data[i]!) : img.data[i]!,
    set = (i: number, v: number) =>
      (img.data[i] = half ? T.DataUtils.toHalfFloat(v) : v);
  const row = new Float32Array(img.width * 3);
  let upper = 0,
    weight = 0;
  for (let y = 0; y < img.height; y++) {
    const mean = [0, 0, 0];
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * stride,
        r = get(i),
        g = get(i + 1),
        b = get(i + 2),
        l = 0.2126 * r + 0.7152 * g + 0.0722 * b,
        k = 1 / (1 + l / 1.5);
      for (const [c, v] of [r, g, b].entries()) {
        const graded = (v + (l - v) * desaturate) * k;
        row[x * 3 + c] = graded;
        mean[c]! += graded / img.width;
      }
    }
    const lat = Math.cos(((y + 0.5) / img.height - 0.5) * Math.PI);
    for (let x = 0; x < img.width; x++)
      for (let c = 0; c < 3; c++)
        set(
          (y * img.width + x) * stride + c,
          row[x * 3 + c]! + (mean[c]! - row[x * 3 + c]!) * azimuthal,
        );
    if (y < img.height / 2) {
      upper +=
        (0.2126 * mean[0]! + 0.7152 * mean[1]! + 0.0722 * mean[2]!) * lat;
      weight += lat;
    }
  }
  texture.needsUpdate = true;
  const lum = (hex: string) => {
    const c = new T.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const target = (lum(sky.sky) + lum(sky.horizon)) / 2;
  return Math.min(0.75, Math.max(0.1, target / Math.max(1e-4, upper / weight)));
}
