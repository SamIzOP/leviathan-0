import * as T from 'three';
import { randomSeed, type Surface } from '@leviathan/shared';
import { worldPalette } from './theme';
/** Zone material sets: surface class -> CC0 material key in asset-manifest.json.
 * A missing key or file keeps the procedural canvas maps. */
export const ZONE_MATERIALS: Record<
  string,
  Partial<Record<Surface, string>>
> = {
  entrance: {
    asphalt: 'asphalt.wet',
    concrete: 'concrete.stained',
    brick: 'brick.red',
    metal: 'metal.painted',
    wood: 'wood.planks',
  },
  tenements: {
    asphalt: 'asphalt.wet',
    concrete: 'concrete.stained',
    brick: 'brick.soot',
    metal: 'metal.rusted',
    wood: 'wood.planks',
  },
  rail: {
    asphalt: 'asphalt.wet',
    concrete: 'concrete.stained',
    brick: 'brick.red',
    metal: 'metal.corrugated',
    wood: 'wood.planks',
  },
  pumps: {
    asphalt: 'concrete.floor',
    concrete: 'concrete.clean',
    brick: 'brick.red',
    metal: 'metal.painted',
    wood: 'wood.planks',
  },
  slag: {
    asphalt: 'rock.rubble',
    concrete: 'concrete.stained',
    brick: 'brick.soot',
    metal: 'metal.dark',
    wood: 'wood.planks',
  },
  hall: {
    asphalt: 'concrete.floor',
    concrete: 'concrete.floor',
    brick: 'brick.soot',
    metal: 'metal.plates',
    wood: 'wood.planks',
  },
  core: {
    asphalt: 'concrete.floor',
    concrete: 'concrete.stained',
    brick: 'brick.soot',
    metal: 'metal.dark',
    wood: 'wood.planks',
  },
  boundary: {
    asphalt: 'asphalt.wet',
    concrete: 'concrete.stained',
    brick: 'brick.soot',
    metal: 'metal.rusted',
  },
};
/** World haze, wet grime and world-projected maps. Real CC0 maps (userData.realMaps)
 * sample at their physical tile size (userData.worldTile = 1 / metres);
 * `desaturate` grades imported props toward the monochrome palette. */
export function grime(
  material: T.MeshStandardMaterial,
  heightFog = 0.018,
  horizon = '#8b989e',
  worldProjection = true,
  desaturate = 0,
) {
  material.onBeforeCompile = (s) => {
    const real = !!material.userData.realMaps;
    s.uniforms.worldHaze = { value: new T.Color(horizon) };
    s.uniforms.heightDensity = { value: heightFog };
    s.uniforms.worldTile = { value: material.userData.worldTile ?? 0.45 };
    material.userData.heightDensity = s.uniforms.heightDensity;
    s.vertexShader =
      'varying vec3 worldPos; varying vec3 worldNormal;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 wp=vec4(transformed,1.0); vec3 wn=normal;
      #ifdef USE_INSTANCING
        wp=instanceMatrix*wp; wn=mat3(instanceMatrix)*wn;
      #endif
      worldPos=(modelMatrix*wp).xyz; worldNormal=normalize(mat3(modelMatrix)*wn);`,
    );
    s.fragmentShader =
      'varying vec3 worldPos; varying vec3 worldNormal; uniform vec3 worldHaze; uniform float heightDensity; uniform float worldTile;\n' +
      s.fragmentShader;
    if (worldProjection)
      s.fragmentShader = s.fragmentShader.replace(
        '#include <bumpmap_pars_fragment>',
        T.ShaderChunk.bumpmap_pars_fragment
          .replace(
            'vec2 dHdxy_fwd() {',
            'vec2 dHdxy_fwd() { vec3 bn=abs(worldNormal);vec2 worldBumpUv=(bn.y>.6?worldPos.xz:bn.x>.6?worldPos.zy:worldPos.xy)*worldTile;',
          )
          .replaceAll('vBumpMapUv', 'worldBumpUv'),
      );
    if (worldProjection)
      s.fragmentShader = s.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor=roughness;
      #ifdef USE_ROUGHNESSMAP
      vec3 rn=abs(worldNormal);vec2 ruv=rn.y>.6?worldPos.xz:rn.x>.6?worldPos.zy:worldPos.xy;
      ${
        real
          ? 'roughnessFactor*=texture2D(roughnessMap,ruv*worldTile).g*(rn.y>.6?.62:1.);'
          : 'float wet=texture2D(roughnessMap,ruv*.18).g;roughnessFactor*=rn.y>.6?max(.08,wet):(.8+.2*wet);'
      }
      #endif`,
      );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <map_fragment>',
      (worldProjection
        ? `#ifdef USE_MAP
      vec3 an=abs(worldNormal); vec2 uvw=an.y>0.6?worldPos.xz:an.x>0.6?worldPos.zy:worldPos.xy;
      diffuseColor*=texture2D(map,uvw*worldTile);${
        // Macro breakup: the same map at ~11x scale stains large real surfaces.
        real
          ? 'diffuseColor.rgb*=.8+.45*texture2D(map,uvw*worldTile*.087+.37).g;'
          : ''
      }
      #endif`
        : '#include <map_fragment>') +
        (desaturate
          ? `
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.299,.587,.114))),${desaturate.toFixed(2)});`
          : '') +
        `
      float streak=sin(worldPos.x*31.0+worldPos.z*29.0)*sin(worldPos.x*7.0+worldPos.z*11.0);
      float damp=exp(-max(0.0,worldPos.y)*0.7);
      diffuseColor.rgb*=0.78+0.22*(1.0-damp)-0.055*streak*damp;`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <fog_fragment>',
      `#include <fog_fragment>
      float hf=1.0-exp(-heightDensity*length(vViewPosition)*exp(-max(worldPos.y,0.0)*0.14)*0.25);
      gl_FragColor.rgb=mix(gl_FragColor.rgb,worldHaze,clamp(hf,0.0,0.65));`,
    );
  };
  material.customProgramCacheKey = () =>
    `world-grime-${heightFog}-${horizon}-${worldProjection}-${desaturate}-${!!material.userData.realMaps}`;
}
export class WorldMaterials {
  materials = new Map<string, T.MeshStandardMaterial>();
  textures: T.Texture[] = [];
  constructor(
    public size: number,
    public seed: number,
    public heightFog: number,
    public horizon: string,
  ) {}
  get(surface: Surface, color?: string): T.MeshStandardMaterial {
    const key = surface + (color ?? '');
    const existing = this.materials.get(key);
    if (existing) return existing;
    if (color) {
      // Colour variants share the surface maps; a district must not duplicate
      // megabytes of identical procedural textures for every facade/paint shade.
      const m = this.get(surface).clone();
      m.color.set(color);
      if (
        surface === 'metal' &&
        ['#4b5559', '#574b40', '#727b7d', '#293239', '#202628'].includes(color)
      ) {
        m.map = this.get('concrete').map;
        m.bumpMap = null;
      }
      grime(m, this.heightFog, this.horizon);
      if (color === worldPalette.van || color === '#c6ccca') {
        m.map = null;
        m.bumpMap = null;
        m.emissive.set('#8a98a1');
        m.emissiveIntensity = 0.08;
      }
      m.userData.worldSurface = surface;
      m.userData.worldColor = color;
      this.materials.set(key, m);
      return m;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(this.size, 1024);
    const c = canvas.getContext('2d')!,
      n = canvas.width,
      rng = randomSeed(this.seed + surface.length * 17);
    c.fillStyle = '#c1c1c1';
    c.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 4)
      for (let x = 0; x < n; x += 4) {
        const q =
          surface === 'asphalt'
            ? 174 + Math.floor(rng() * 24)
            : 150 + Math.floor(rng() * 60);
        c.fillStyle = `rgb(${q},${q},${q})`;
        c.fillRect(x, y, 4, 4);
      }
    if (surface === 'brick')
      for (let y = 0; y < 12; y++)
        for (let x = -1; x < 5; x++) {
          c.fillStyle = `rgb(${130 + rng() * 40},${130 + rng() * 30},${128 + rng() * 30})`;
          c.fillRect(
            ((x + (y % 2) * 0.5) * n) / 4 + 2,
            (y * n) / 12 + 2,
            n / 4 - 4,
            n / 12 - 4,
          );
        }
    if (surface === 'metal')
      for (let x = 0; x < n; x += n / 24) {
        c.fillStyle = 'rgba(30,32,34,.35)';
        c.fillRect(x, 0, n / 90, n);
        c.fillStyle = 'rgba(235,235,235,.14)';
        c.fillRect(x + n / 90, 0, n / 100, n);
      }
    if (surface === 'wood')
      for (let x = 0; x < n; x += n / 7) {
        c.fillStyle = 'rgba(20,20,20,.5)';
        c.fillRect(x, 0, 3, n);
      }
    if (surface === 'metal')
      for (let i = 0; i < 55; i++) {
        c.fillStyle = 'rgba(91,77,62,.24)';
        c.fillRect(rng() * n, rng() * n, 2 + rng() * 8, 10 + rng() * 90);
      }
    const tex = new T.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = roughCanvas.height = 256;
    const rc = roughCanvas.getContext('2d')!;
    rc.fillStyle = '#b9b9b9';
    rc.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      rc.fillStyle = `rgba(12,12,12,${0.1 + rng() * 0.6})`;
      rc.beginPath();
      rc.ellipse(
        rng() * 256,
        rng() * 256,
        8 + rng() * 38,
        3 + rng() * 18,
        0,
        0,
        Math.PI * 2,
      );
      rc.fill();
    }
    const rough = new T.CanvasTexture(roughCanvas);
    rough.wrapS = rough.wrapT = T.RepeatWrapping;
    this.textures.push(tex, rough);
    const m = new T.MeshStandardMaterial({
      color: color ?? worldPalette[surface],
      map: tex,
      bumpMap: surface === 'asphalt' || surface === 'concrete' ? null : tex,
      bumpScale: 0.003,
      roughnessMap: rough,
      roughness:
        surface === 'glass' ? 0.15 : surface === 'asphalt' ? 0.48 : 0.82,
      metalness:
        surface === 'metal' ? 0.4 : surface === 'asphalt' ? 0.18 : 0.02,
    });
    grime(m, this.heightFog, this.horizon);
    if (color === worldPalette.van) {
      m.map = null;
      m.bumpScale = 0.005;
      m.emissive.set('#8a98a1');
      m.emissiveIntensity = 0.12;
    }
    m.userData.worldSurface = surface;
    m.userData.worldColor = color;
    this.materials.set(key, m);
    return m;
  }
  /** A zone's variant of a surface: the same procedural maps until prepare()
   * swaps in the zone's CC0 set (userData.materialKey). */
  getZoned(surface: Surface, zone: string | undefined, color?: string) {
    const materialKey = zone ? ZONE_MATERIALS[zone]?.[surface] : undefined;
    if (!materialKey) return this.get(surface, color);
    const key = `${surface}|${zone}|${color ?? ''}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const base = this.get(surface, color),
      m = base.clone();
    m.userData = { ...base.userData, materialKey, zone };
    // Imported CC0 colour is graded toward the monochrome palette.
    grime(m, this.heightFog, this.horizon, true, 0.35);
    this.materials.set(key, m);
    return m;
  }
  dispose() {
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.materials.clear();
    this.textures = [];
  }
}
