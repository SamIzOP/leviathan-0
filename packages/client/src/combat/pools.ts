import * as THREE from 'three';
import { decalAtlas, fxAtlas } from './atlas';
/** Premultiplied blending: rgb is added, alpha occludes. A quad with alpha 0 is
 * purely additive (glows, sparks); alpha 1 is an ordinary covering layer (smoke,
 * oil). Every FX pool uses it so one draw call can mix both. */
function premultiplied(material: THREE.ShaderMaterial) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  return material;
}
/** Shared fog uniforms (copied from the world's FogExp2 once per frame). */
export const fogUniforms = {
  uFogColor: { value: new THREE.Color('#8e9aa0') },
  uFogDensity: { value: 0 },
};
const FOG_VERTEX =
  'float fogDepth = -mv.z; vFog = 1.0 - exp(-uFogDensity * uFogDensity * fogDepth * fogDepth);';
// --- Tracers -------------------------------------------------------------------
/** Instanced camera-facing streaks. Each instance is written once at spawn; the
 * shader moves the streak from start to end, so a live tracer costs no CPU. */
export class Tracers {
  readonly max = 128;
  limit = 96;
  mesh: THREE.Mesh;
  private data: Float32Array;
  private buffer: THREE.InstancedInterleavedBuffer;
  private deaths: Float32Array;
  private next = 0;
  private latest = 0;
  uniforms = { uTime: { value: 0 } };
  constructor() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(this.max * 13);
    this.deaths = new Float32Array(this.max);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, 13);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const at = (size: number, offset: number) =>
      new THREE.InterleavedBufferAttribute(this.buffer, size, offset);
    geometry.setAttribute('aStart', at(3, 0));
    geometry.setAttribute('aEnd', at(3, 3));
    geometry.setAttribute('aInfo', at(4, 6));
    geometry.setAttribute('aColor', at(3, 10));
    geometry.instanceCount = this.max;
    const material = premultiplied(
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, ...fogUniforms },
        side: THREE.DoubleSide,
        vertexShader: `
attribute vec3 aStart, aEnd, aColor; attribute vec4 aInfo;
uniform float uTime, uFogDensity;
varying float vAcross, vAlong, vFade, vFog; varying vec3 vColor;
void main() {
  float age = uTime - aInfo.x;
  vec3 d = aEnd - aStart; float len = max(length(d), 1e-3); vec3 dir = d / len;
  float travel = age * aInfo.y;
  float persist = aInfo.w;
  float streak = persist > 0.0 ? len : min(len, 3.5 + len * 0.08);
  float head = min(travel, len);
  float tail = persist > 0.0 ? 0.0 : clamp(travel - streak, 0.0, len);
  float fade = age < 0.0 ? 0.0 : persist > 0.0 ? clamp(1.0 - max(0.0, age - len / aInfo.y) / persist, 0.0, 1.0) : 1.0;
  if (head - tail <= 1e-4) fade = 0.0;
  vec3 p = aStart + dir * mix(tail, head, position.y);
  vec3 toCam = cameraPosition - p; float dist = max(length(toCam), 1e-3);
  vec3 side = normalize(cross(dir, toCam / dist) + vec3(1e-6));
  float w = max(aInfo.z, dist * 0.0019) * (persist > 0.0 ? mix(0.5, 1.0, fade) : 1.0);
  p += side * position.x * w * (fade > 0.0 ? 1.0 : 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAcross = position.x; vAlong = position.y; vFade = fade; vColor = aColor;
  ${FOG_VERTEX}
}`,
        fragmentShader: `
varying float vAcross, vAlong, vFade, vFog; varying vec3 vColor;
void main() {
  float e = 1.0 - vAcross * vAcross;
  float a = e * e * mix(0.18, 1.0, vAlong * vAlong) * vFade * (1.0 - vFog);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor * a, 0.0);
}`,
      }),
    );
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }
  /** `persist` > 0 keeps the whole line and fades it over that many seconds. */
  add(
    now: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
    speed: number,
    width: number,
    color: THREE.Color,
    persist = 0,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    const o = i * 13,
      d = this.data;
    d[o] = start.x;
    d[o + 1] = start.y;
    d[o + 2] = start.z;
    d[o + 3] = end.x;
    d[o + 4] = end.y;
    d[o + 5] = end.z;
    d[o + 6] = now;
    d[o + 7] = speed;
    d[o + 8] = width;
    d[o + 9] = persist;
    d[o + 10] = color.r;
    d[o + 11] = color.g;
    d[o + 12] = color.b;
    const len = start.distanceTo(end);
    const death =
      now + (persist > 0 ? len / speed + persist : (len * 2 + 4) / speed);
    this.deaths[i] = death;
    this.latest = Math.max(this.latest, death);
    this.buffer.addUpdateRange(o, 13);
    this.buffer.needsUpdate = true;
  }
  setLimit(limit: number) {
    if (limit === this.limit) return;
    this.limit = Math.min(this.max, limit);
    for (let i = this.limit; i < this.max; i++) this.kill(i);
    this.next %= this.limit;
  }
  private kill(i: number) {
    this.deaths[i] = 0;
    this.data[i * 13 + 6] = -1e6;
    this.data[i * 13 + 9] = 0;
    this.buffer.addUpdateRange(i * 13, 13);
    this.buffer.needsUpdate = true;
  }
  update(now: number) {
    this.uniforms.uTime.value = now;
    this.mesh.visible = now < this.latest;
  }
  live(now: number) {
    let n = 0;
    for (let i = 0; i < this.limit; i++) if (this.deaths[i]! > now) n++;
    return n;
  }
  clear() {
    for (let i = 0; i < this.max; i++) this.kill(i);
    this.latest = 0;
    this.mesh.visible = false;
  }
}
// --- Decals --------------------------------------------------------------------
/** Impact marks on world surfaces: one InstancedMesh, ring-recycled (oldest first). */
export class Decals {
  readonly max = 160;
  limit = 96;
  mesh: THREE.InstancedMesh;
  private info: THREE.InstancedBufferAttribute;
  private next = 0;
  active = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private spin = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  private n = new THREE.Vector3();
  uniforms = { uTime: { value: 0 } };
  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.info = new THREE.InstancedBufferAttribute(
      new Float32Array(this.max * 2),
      2,
    );
    geometry.setAttribute('aDecal', this.info);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: decalAtlas() },
        ...this.uniforms,
        ...fogUniforms,
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: `
attribute vec2 aDecal;
uniform float uTime, uFogDensity;
varying vec2 vUv; varying float vFog, vAlpha;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = vec2((aDecal.x + uv.x) * 0.5, uv.y);
  vAlpha = clamp((uTime - aDecal.y) * 30.0, 0.0, 1.0);
  ${FOG_VERTEX}
}`,
      fragmentShader: `
uniform sampler2D map; uniform vec3 uFogColor;
varying vec2 vUv; varying float vFog, vAlpha;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(t.rgb, uFogColor, vFog), a);
}`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  add(
    now: number,
    point: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    size: number,
    cell: number,
    roll: number,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    this.active = Math.min(this.limit, this.active + 1);
    this.n.set(normal.x, normal.y, normal.z).normalize();
    this.quat.setFromUnitVectors(this.z, this.n);
    this.spin.setFromAxisAngle(this.z, roll);
    this.quat.multiply(this.spin);
    this.pos
      .set(point.x, point.y, point.z)
      .addScaledVector(this.n, 0.01 + (i % 8) * 0.0015);
    this.scale.set(size, size, 1);
    this.matrix.compose(this.pos, this.quat, this.scale);
    this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.info.setXY(i, cell, now);
    this.info.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }
  setLimit(limit: number) {
    if (limit === this.limit) return;
    this.limit = Math.min(this.max, limit);
    this.mesh.count = Math.min(this.mesh.count, this.limit);
    this.active = Math.min(this.active, this.limit);
    this.next %= this.limit;
  }
  update(now: number) {
    this.uniforms.uTime.value = now;
    this.mesh.visible = this.mesh.count > 0;
  }
  clear() {
    this.mesh.count = 0;
    this.active = 0;
    this.next = 0;
    this.mesh.visible = false;
  }
}
// --- Particles -----------------------------------------------------------------
export interface ParticleSpec {
  life: number;
  size: number;
  color: THREE.Color;
  /** 0 = additive spark, 1 = covering dust/oil droplet. */
  cover: number;
  gravity: number;
  drag: number;
}
/** Sparks and debris: one Points draw over a pooled, compacted buffer. */
export class Particles {
  readonly max = 512;
  limit = 384;
  count = 0;
  points: THREE.Points;
  private sim: Float32Array;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private geometry = new THREE.BufferGeometry();
  uniforms = { uScale: { value: 600 } };
  // Simulation record: px py pz vx vy vz age life size r g b cover gravity drag (15).
  private static S = 15;
  constructor() {
    this.sim = new Float32Array(this.max * Particles.S);
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 4);
    this.sizes = new Float32Array(this.max);
    const attr = (array: Float32Array, size: number) =>
      new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(this.positions, 3));
    this.geometry.setAttribute('aColor', attr(this.colors, 4));
    this.geometry.setAttribute('aSize', attr(this.sizes, 1));
    this.geometry.setDrawRange(0, 0);
    const material = premultiplied(
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, ...fogUniforms },
        vertexShader: `
attribute vec4 aColor; attribute float aSize;
uniform float uScale, uFogDensity;
varying vec4 vColor; varying float vFog;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 1.5, 64.0);
  vColor = aColor;
  ${FOG_VERTEX}
}`,
        fragmentShader: `
uniform vec3 uFogColor;
varying vec4 vColor; varying float vFog;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float m = clamp(1.0 - dot(c, c) * 4.0, 0.0, 1.0);
  m *= m;
  float a = vColor.a * m;
  vec3 rgb = mix(vColor.rgb * m, uFogColor * a, vFog);
  gl_FragColor = vec4(rgb, a);
}`,
      }),
    );
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
  }
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    spec: ParticleSpec,
    lifeScale = 1,
    sizeScale = 1,
  ) {
    let i = this.count;
    if (i >= this.limit) {
      // Full: recycle a random live slot rather than dropping the newest burst.
      i = Math.floor(Math.random() * this.limit);
    } else this.count++;
    const o = i * Particles.S,
      s = this.sim;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = vx;
    s[o + 4] = vy;
    s[o + 5] = vz;
    s[o + 6] = 0;
    s[o + 7] = spec.life * lifeScale;
    s[o + 8] = spec.size * sizeScale;
    s[o + 9] = spec.color.r;
    s[o + 10] = spec.color.g;
    s[o + 11] = spec.color.b;
    s[o + 12] = spec.cover;
    s[o + 13] = spec.gravity;
    s[o + 14] = spec.drag;
  }
  setLimit(limit: number) {
    this.limit = Math.min(this.max, limit);
    this.count = Math.min(this.count, this.limit);
  }
  update(dt: number, floor: number) {
    const S = Particles.S,
      s = this.sim;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * S;
      const age = s[o + 6]! + dt,
        life = s[o + 7]!;
      if (age >= life) continue;
      const drag = Math.exp(-s[o + 14]! * dt);
      let vx = s[o + 3]! * drag,
        vy = s[o + 4]! * drag - s[o + 13]! * dt,
        vz = s[o + 5]! * drag;
      const x = s[o]! + vx * dt,
        z = s[o + 2]! + vz * dt;
      let y = s[o + 1]! + vy * dt;
      if (y < floor && vy < 0) {
        y = floor;
        vy *= -0.3;
        vx *= 0.5;
        vz *= 0.5;
      }
      // Compact in place: survivor i moves to slot n.
      const p = n * S;
      if (p !== o) for (let k = 7; k < S; k++) s[p + k] = s[o + k]!;
      s[p] = x;
      s[p + 1] = y;
      s[p + 2] = z;
      s[p + 3] = vx;
      s[p + 4] = vy;
      s[p + 5] = vz;
      s[p + 6] = age;
      const t = age / life,
        cover = s[p + 12]!;
      const fade = cover > 0.5 ? 1 - t * t : (1 - t) * (1 - t);
      this.positions[n * 3] = x;
      this.positions[n * 3 + 1] = y;
      this.positions[n * 3 + 2] = z;
      this.colors[n * 4] = s[p + 9]! * fade;
      this.colors[n * 4 + 1] = s[p + 10]! * fade;
      this.colors[n * 4 + 2] = s[p + 11]! * fade;
      this.colors[n * 4 + 3] = cover * fade;
      this.sizes[n] = s[p + 8]! * (cover > 0.5 ? 1 : 1 - t * 0.5);
      n++;
    }
    this.count = n;
    this.geometry.setDrawRange(0, n);
    if (n) {
      for (const name of ['position', 'aColor', 'aSize']) {
        const a = this.geometry.getAttribute(name) as THREE.BufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this.points.visible = n > 0;
  }
  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }
}
// --- Quads ---------------------------------------------------------------------
export const MODE = { face: 0, upright: 1, ground: 2 } as const;
/** Every billboard FX (remote muzzle flashes, blasts, flames, puddles, glows, beams,
 * telegraph rings) in one instanced draw, rebuilt each frame from live effects. */
export class Quads {
  readonly max = 640;
  count = 0;
  mesh: THREE.Mesh;
  private data: Float32Array;
  private buffer: THREE.InstancedInterleavedBuffer;
  private geometry: THREE.InstancedBufferGeometry;
  private static S = 12;
  constructor() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(this.max * Quads.S);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, Quads.S);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const at = (size: number, offset: number) =>
      new THREE.InterleavedBufferAttribute(this.buffer, size, offset);
    geometry.setAttribute('iPos', at(3, 0));
    geometry.setAttribute('iShape', at(4, 3));
    geometry.setAttribute('iColor', at(4, 7));
    geometry.setAttribute('iCell', at(1, 11));
    geometry.instanceCount = 0;
    this.geometry = geometry;
    const material = premultiplied(
      new THREE.ShaderMaterial({
        uniforms: { map: { value: fxAtlas() }, ...fogUniforms },
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
        vertexShader: `
attribute vec3 iPos; attribute vec4 iShape; attribute vec4 iColor; attribute float iCell;
uniform float uFogDensity;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  vec2 q = position.xy;
  vec2 qs = q * iShape.xy;
  float c = cos(iShape.z), s = sin(iShape.z);
  vec2 r = vec2(qs.x * c - qs.y * s, qs.x * s + qs.y * c);
  vec4 mv;
  if (iShape.w < 0.5) {
    mv = viewMatrix * vec4(iPos, 1.0);
    mv.xy += r;
  } else if (iShape.w < 1.5) {
    vec3 toCam = cameraPosition - iPos;
    vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    float up = q.y + 0.5;
    vec3 p = iPos + side * (qs.x + iShape.z * up * iShape.y) + vec3(0.0, up * iShape.y, 0.0);
    mv = viewMatrix * vec4(p, 1.0);
  } else {
    mv = viewMatrix * vec4(iPos + vec3(r.x, 0.0, r.y), 1.0);
  }
  gl_Position = projectionMatrix * mv;
  float col = mod(iCell, 4.0), row = floor(iCell / 4.0 + 0.01);
  vUv = vec2((col + q.x + 0.5) * 0.25, (1.0 - row + q.y + 0.5) * 0.5);
  vColor = iColor;
  ${FOG_VERTEX}
}`,
        fragmentShader: `
uniform sampler2D map; uniform vec3 uFogColor;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a;
  vec3 rgb = t.rgb * vColor.rgb * a;
  float alpha = a * vColor.a;
  rgb = mix(rgb, uFogColor * alpha, vFog);
  if (alpha + rgb.r + rgb.g + rgb.b < 0.003) discard;
  gl_FragColor = vec4(rgb, alpha);
}`,
      }),
    );
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }
  begin() {
    this.count = 0;
  }
  /** Colour is premultiplied by the caller: additive → (rgb·k, 0); covering →
   * (rgb·a, a). Negative width mirrors the cell. */
  push(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    rot: number,
    mode: number,
    cell: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ) {
    if (this.count >= this.max) return;
    const o = this.count++ * Quads.S,
      d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = w;
    d[o + 4] = h;
    d[o + 5] = rot;
    d[o + 6] = mode;
    d[o + 7] = r;
    d[o + 8] = g;
    d[o + 9] = b;
    d[o + 10] = a;
    d[o + 11] = cell;
  }
  end() {
    this.geometry.instanceCount = this.count;
    if (this.count) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * Quads.S);
      this.buffer.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
}
