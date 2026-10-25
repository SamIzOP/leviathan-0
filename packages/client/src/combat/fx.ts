import * as THREE from 'three';
import {
  FINGERS,
  OIL,
  STATUS,
  idHash,
  rayBox,
  raycastWorld,
  type CombatEvent,
  type Entity,
  type Shot,
  type Throw,
  type Vec3,
  type WeaponStats,
  type World,
} from '@leviathan/shared';
import { CELL, DECAL } from './atlas';
import {
  Decals,
  MODE,
  Particles,
  Quads,
  Tracers,
  fogUniforms,
  type ParticleSpec,
} from './pools';
export type Quality = 'LOW' | 'MEDIUM' | 'HIGH';
/** Per-quality pool caps. Flames are billboards per fire hazard. */
export const CAPS = {
  LOW: { tracers: 48, decals: 48, particles: 192, flames: 4 },
  MEDIUM: { tracers: 96, decals: 96, particles: 384, flames: 7 },
  HIGH: { tracers: 128, decals: 160, particles: 512, flames: 10 },
} as const;
const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const COLOR = {
  tracer: col('#ffcf8f', 2.2),
  tracerCold: col('#dcecf6', 1.8),
  tracerSlug: col('#ff9b52', 1.2),
  pale: col('#d3d9db'),
  gold: col('#ffe2a6'),
  ember: col('#ff7a2c'),
  fire: col('#ff8c3a'),
  oil: col('#0c0b0a'),
};
const SPEC: Record<string, ParticleSpec> = {
  spark: {
    life: 0.3,
    size: 0.03,
    color: col('#ffc98a', 1.6),
    cover: 0,
    gravity: 9,
    drag: 2.5,
  },
  dust: {
    life: 0.55,
    size: 0.07,
    color: col('#77736c'),
    cover: 1,
    gravity: 3,
    drag: 4,
  },
  robot: {
    life: 0.42,
    size: 0.04,
    color: col('#ffa04a', 1.7),
    cover: 0,
    gravity: 9,
    drag: 2,
  },
  flesh: {
    life: 0.26,
    size: 0.06,
    color: col('#e8f1f5', 1.3),
    cover: 0,
    gravity: 2,
    drag: 6,
  },
  ember: {
    life: 1.2,
    size: 0.045,
    color: col('#ff8a3a', 1.5),
    cover: 0,
    gravity: -1.6,
    drag: 1.4,
  },
  oil: {
    life: 0.9,
    size: 0.075,
    color: col('#0d0c0b'),
    cover: 1,
    gravity: 12,
    drag: 0.8,
  },
  glint: {
    life: 0.22,
    size: 0.03,
    color: col('#e9f1f4', 1.4),
    cover: 0,
    gravity: 5,
    drag: 2,
  },
  debris: {
    life: 1.1,
    size: 0.07,
    color: col('#2b2b2a'),
    cover: 1,
    gravity: 14,
    drag: 0.6,
  },
  holy: {
    life: 0.85,
    size: 0.06,
    color: col('#fff1d0', 1.6),
    cover: 0,
    gravity: 5,
    drag: 1.2,
  },
};
type BlastKind = 'slag' | 'flask' | 'fingers' | 'ignite';
const LIFE: Record<BlastKind, number> = {
  slag: 1.9,
  flask: 0.85,
  fingers: 1.8,
  ignite: 0.5,
};
interface Blast {
  kind: BlastKind;
  x: number;
  y: number;
  z: number;
  ground: number;
  radius: number;
  t0: number;
  seed: number;
}
interface Flash {
  x: number;
  y: number;
  z: number;
  t0: number;
  size: number;
  rot: number;
}
interface Projectile {
  kind: 'slag' | 'flask';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ox: number;
  oy: number;
  oz: number;
  age: number;
  life: number;
  gravity: number;
  alive: boolean;
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const outCubic = (t: number) =>
  1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
/** Deterministic fraction in [0, 1) from a hash and an index. */
const frac = (h: number, i: number) =>
  (Math.imul(h ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0) / 4294967296;
/** Pooled world-space combat FX: tracers, decals, sparks, billboards (flashes,
 * blasts, flames, puddles, telegraphs, projectile glows) and instanced props. */
export class CombatFx {
  group = new THREE.Group();
  tracers = new Tracers();
  decals = new Decals();
  particles = new Particles();
  quads = new Quads();
  crates: THREE.InstancedMesh;
  bottles: THREE.InstancedMesh;
  world?: World;
  quality: Quality = 'MEDIUM';
  private epoch = performance.now();
  private blasts: Blast[] = [];
  private nextBlast = 0;
  private flashes: Flash[] = [];
  private nextFlash = 0;
  private projectiles: Projectile[] = [];
  private from = new Map<string, Entity>();
  private to: Entity[] = [];
  private alpha = 0;
  private localId = '';
  private hashes = new Map<string, number>();
  /** Interpolated robot feet positions (tracer stop tests). */
  private robots: Vec3[] = [];
  private robotCount = 0;
  private counts = { flames: 0, puddles: 0, projectiles: 0, crates: 0 };
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private axis = new THREE.Vector3();
  private bmin = { x: 0, y: 0, z: 0 };
  private bmax = { x: 0, y: 0, z: 0 };
  private floor = 0;
  private dtAcc = 0;
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 8; i++)
      this.blasts.push({
        kind: 'slag',
        x: 0,
        y: 0,
        z: 0,
        ground: 0,
        radius: 0,
        t0: -1e9,
        seed: i,
      });
    for (let i = 0; i < 12; i++)
      this.flashes.push({ x: 0, y: 0, z: 0, t0: -1e9, size: 0, rot: 0 });
    for (let i = 0; i < 8; i++)
      this.projectiles.push({
        kind: 'slag',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        ox: 0,
        oy: 0,
        oz: 0,
        age: 0,
        life: 0,
        gravity: 0,
        alive: false,
      });
    for (let i = 0; i < 48; i++) this.robots.push({ x: 0, y: 0, z: 0 });
    this.crates = this.crateMesh();
    this.bottles = this.bottleMesh();
    this.group.name = 'combat-fx';
    this.group.add(
      this.decals.mesh,
      this.quads.mesh,
      this.tracers.mesh,
      this.particles.points,
      this.crates,
      this.bottles,
    );
    scene.add(this.group);
  }
  /** Seconds on the FX clock for a performance.now() timestamp. */
  time(now: number) {
    return (now - this.epoch) / 1000;
  }
  private crateMesh() {
    const parts: THREE.BufferGeometry[] = [];
    const add = (w: number, h: number, d: number, y: number, hex: string) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
      const c = new THREE.Color(hex),
        n = g.getAttribute('position').count,
        colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    };
    add(0.7, 0.4, 0.46, 0, '#3b4348');
    add(0.72, 0.06, 0.48, 0.2, '#262c30');
    add(0.715, 0.07, 0.475, 0.02, '#d3d9db');
    add(0.08, 0.3, 0.485, -0.02, '#2a3034');
    const geometry = this.merge(parts);
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0.3,
      }),
      48,
    );
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }
  private bottleMesh() {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, hex: string) => {
      const c = new THREE.Color(hex),
        n = g.getAttribute('position').count,
        colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    };
    add(new THREE.CylinderGeometry(0.065, 0.07, 0.18, 10), '#1c1813');
    add(
      new THREE.CylinderGeometry(0.025, 0.04, 0.08, 8).translate(0, 0.12, 0),
      '#1c1813',
    );
    add(
      new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8).translate(0, 0.175, 0),
      '#d3d9db',
    );
    const mesh = new THREE.InstancedMesh(
      this.merge(parts),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.18,
        metalness: 0.1,
      }),
      16,
    );
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }
  private merge(parts: THREE.BufferGeometry[]) {
    const geometry = new THREE.BufferGeometry();
    const position: number[] = [],
      normal: number[] = [],
      color: number[] = [],
      index: number[] = [];
    let base = 0;
    for (const g of parts) {
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal'),
        c = g.getAttribute('color');
      for (let i = 0; i < p.count; i++) {
        position.push(p.getX(i), p.getY(i), p.getZ(i));
        normal.push(n.getX(i), n.getY(i), n.getZ(i));
        color.push(c.getX(i), c.getY(i), c.getZ(i));
      }
      const idx = g.getIndex()!;
      for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + base);
      base += p.count;
      g.dispose();
    }
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(position, 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normal, 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geometry.setIndex(index);
    return geometry;
  }
  private hash(id: string) {
    let h = this.hashes.get(id);
    if (h === undefined) {
      if (this.hashes.size > 512) this.hashes.clear();
      h = idHash(id);
      this.hashes.set(id, h);
    }
    return h;
  }
  // --- Spawners ------------------------------------------------------------------
  burst(
    spec: ParticleSpec,
    count: number,
    at: Vec3,
    dir: Vec3,
    speed: number,
    spread: number,
    up = 0,
  ) {
    for (let i = 0; i < count; i++) {
      const s = speed * (0.45 + Math.random() * 0.75);
      const vx = dir.x * s + (Math.random() - 0.5) * spread,
        vy = dir.y * s + (Math.random() - 0.5) * spread + up * Math.random(),
        vz = dir.z * s + (Math.random() - 0.5) * spread;
      this.particles.spawn(
        at.x,
        at.y,
        at.z,
        vx,
        vy,
        vz,
        spec,
        0.7 + Math.random() * 0.6,
        0.7 + Math.random() * 0.6,
      );
    }
  }
  /** Bullet impact on static geometry: a decal and a few sparks plus dust. */
  impact(now: number, at: Vec3, normal: Vec3, weapon: number) {
    const size = [0.13, 0.11, 0.09, 0.16, 0.12][weapon] ?? 0.11;
    this.decals.add(
      this.time(now),
      at,
      normal,
      size * (0.85 + Math.random() * 0.3),
      DECAL.hole,
      Math.random() * 6.28,
    );
    const sparks = [5, 3, 2, 8, 4][weapon] ?? 4;
    this.burst(SPEC.spark!, sparks, at, normal, 4.5, 3.5, 1);
    this.burst(SPEC.dust!, weapon === 2 ? 1 : 3, at, normal, 1.2, 0.8, 0.4);
  }
  /** Confirmed body hit: hot orange sparks for robots, a cold white puff for operators. */
  flesh(at: Vec3, robot: boolean, from?: Vec3, strength = 1) {
    let dx = 0,
      dy = 0.3,
      dz = 0;
    if (from) {
      dx = from.x - at.x;
      dy = from.y - at.y;
      dz = from.z - at.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const dir = { x: dx, y: dy, z: dz };
    if (robot) {
      this.burst(SPEC.robot!, Math.round(9 * strength), at, dir, 4, 4.5, 1.5);
      this.burst(SPEC.debris!, Math.round(2 * strength), at, dir, 2, 2, 1);
    } else
      this.burst(SPEC.flesh!, Math.round(6 * strength), at, dir, 1.5, 1.8, 0.5);
  }
  private robotAlong(o: Vec3, d: Vec3, reach: number) {
    let best = reach;
    for (let i = 0; i < this.robotCount; i++) {
      const r = this.robots[i]!;
      this.bmin.x = r.x - 0.4;
      this.bmin.y = r.y;
      this.bmin.z = r.z - 0.4;
      this.bmax.x = r.x + 0.4;
      this.bmax.y = r.y + 1.8;
      this.bmax.z = r.z + 0.4;
      const hit = rayBox(o, d, this.bmin, this.bmax, best);
      if (hit && hit.t < best) best = hit.t;
    }
    return best;
  }
  /** A predicted local shot: tracers from the drawn muzzle toward world hits (or the
   * first rendered robot, without sparks until the server confirms), decals at world
   * hits; the projectile weapon gets a predicted slug instead. */
  shotLocal(now: number, shot: Shot, w: WeaponStats, muzzle: THREE.Vector3) {
    const world = this.world;
    if (w.delivery === 'projectile') {
      const d = shot.dirs[0]!;
      this.launch(
        'slag',
        shot.origin,
        {
          x: d.x * w.projectileSpeed,
          y: d.y * w.projectileSpeed,
          z: d.z * w.projectileSpeed,
        },
        w.projectileGravity,
        w.projectileLife,
        muzzle,
      );
      return;
    }
    const t = this.time(now);
    const cold = w.id === 'longline';
    for (const d of shot.dirs) {
      const hit = world ? raycastWorld(world, shot.origin, d, w.range) : null;
      const wall = hit ? hit.distance : w.range;
      const reach = this.robotAlong(shot.origin, d, wall);
      this.v.set(
        shot.origin.x + d.x * reach,
        shot.origin.y + d.y * reach,
        shot.origin.z + d.z * reach,
      );
      this.tracer(t, muzzle, this.v, w, cold);
      if (hit && reach >= wall - 1e-6)
        this.impact(now, hit.point, hit.normal, shot.weapon);
    }
  }
  private tracer(
    t: number,
    from: THREE.Vector3,
    to: THREE.Vector3,
    w: WeaponStats,
    cold: boolean,
  ) {
    if (cold) this.tracers.add(t, from, to, 900, 0.012, COLOR.tracerCold, 0.24);
    else
      this.tracers.add(
        t,
        from,
        to,
        w.pellets > 1 ? 300 : 360,
        w.pellets > 1 ? 0.011 : 0.016,
        COLOR.tracer,
      );
  }
  throwLocal(t: Throw, muzzle: THREE.Vector3) {
    this.launch(
      'flask',
      t.origin,
      t.velocity,
      OIL.gravity,
      OIL.flaskLife,
      muzzle,
    );
  }
  private launch(
    kind: 'slag' | 'flask',
    origin: Vec3,
    v: Vec3,
    gravity: number,
    life: number,
    muzzle: THREE.Vector3,
  ) {
    const p = this.projectiles.find((x) => !x.alive) ?? this.projectiles[0]!;
    p.kind = kind;
    p.x = origin.x;
    p.y = origin.y;
    p.z = origin.z;
    p.vx = v.x;
    p.vy = v.y;
    p.vz = v.z;
    p.ox = muzzle.x - origin.x;
    p.oy = muzzle.y - origin.y;
    p.oz = muzzle.z - origin.z;
    p.age = 0;
    p.life = life;
    p.gravity = gravity;
    p.alive = true;
  }
  /** Remote shot event: muzzle flash near the shooter's eye, tracers to each end,
   * decals + sparks on world ends, body sparks on flesh ends. */
  shotRemote(
    now: number,
    e: Extract<CombatEvent, { t: 'shot' }>,
    w: WeaponStats | undefined,
  ) {
    const t = this.time(now);
    const o = e.origin,
      first = e.ends[0];
    let fx = 0,
      fy = 0,
      fz = -1;
    const shooter = this.find(e.shooter);
    if (first) {
      fx = first.x - o.x;
      fy = first.y - o.y;
      fz = first.z - o.z;
    } else if (shooter) {
      fx = -Math.sin(shooter.yaw) * Math.cos(shooter.pitch);
      fy = Math.sin(shooter.pitch);
      fz = -Math.cos(shooter.yaw) * Math.cos(shooter.pitch);
    }
    const l = Math.hypot(fx, fy, fz) || 1;
    fx /= l;
    fy /= l;
    fz /= l;
    // Right of the aim, slightly low: where a held weapon's muzzle sits.
    const rl = Math.hypot(fz, fx) || 1;
    const rx = -fz / rl,
      rz = fx / rl;
    this.w.set(
      o.x + fx * 0.75 + rx * 0.18,
      o.y + fy * 0.75 - 0.14,
      o.z + fz * 0.75 + rz * 0.18,
    );
    const f = this.flashes[this.nextFlash]!;
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.x = this.w.x;
    f.y = this.w.y;
    f.z = this.w.z;
    f.t0 = t;
    f.size = w && w.pellets > 1 ? 0.75 : w?.id === 'slag' ? 0.9 : 0.5;
    f.rot = Math.random() * 6.28;
    if (!w) return;
    const cold = w.id === 'longline';
    for (let i = 0; i < e.ends.length; i++) {
      const end = e.ends[i]!;
      this.v.set(end.x, end.y, end.z);
      this.tracer(t, this.w, this.v, w, cold);
      const n = e.normals[i];
      if (e.flesh[i])
        this.flesh(end, this.robotNear(end), o, w.pellets > 1 ? 0.5 : 1);
      else if (n) this.impact(now, end, n, e.weapon);
    }
  }
  private robotNear(p: Vec3) {
    for (let i = 0; i < this.robotCount; i++) {
      const r = this.robots[i]!;
      if (
        Math.abs(r.x - p.x) < 1 &&
        Math.abs(r.z - p.z) < 1 &&
        p.y > r.y - 0.2 &&
        p.y < r.y + 2.2
      )
        return true;
    }
    return false;
  }
  find(id: string): Entity | undefined {
    for (const e of this.to) if (e.id === id) return e;
    return this.from.get(id);
  }
  isRobot(id: string) {
    return this.find(id)?.type === 'robot';
  }
  blast(now: number, kind: BlastKind, at: Vec3, radius: number) {
    const b = this.blasts[this.nextBlast]!;
    this.nextBlast = (this.nextBlast + 1) % this.blasts.length;
    b.kind = kind;
    b.x = at.x;
    b.y = at.y;
    b.z = at.z;
    b.radius = radius;
    b.t0 = this.time(now);
    b.seed = (Math.random() * 1e9) >>> 0;
    b.ground = at.y;
    const world = this.world;
    const down = world
      ? raycastWorld(
          world,
          { x: at.x, y: at.y + 0.5, z: at.z },
          { x: 0, y: -1, z: 0 },
          3,
        )
      : null;
    if (down) b.ground = down.point.y;
    const up = { x: 0, y: 1, z: 0 };
    const centre = { x: at.x, y: at.y + 0.2, z: at.z };
    if (kind === 'slag') {
      this.burst(SPEC.spark!, 34, centre, up, 9, 13, 3);
      this.burst(SPEC.debris!, 12, centre, up, 6, 8, 3);
      this.burst(SPEC.ember!, 10, centre, up, 2, 3, 1);
      if (down && down.distance < 1.6)
        this.decals.add(
          this.time(now),
          down.point,
          down.normal,
          radius * 1.15,
          DECAL.scorch,
          Math.random() * 6.28,
        );
    } else if (kind === 'flask') {
      this.burst(SPEC.oil!, 24, centre, up, 3.2, 5, 2);
      this.burst(SPEC.glint!, 10, centre, up, 3, 4, 1);
    } else if (kind === 'fingers') {
      this.burst(SPEC.holy!, 44, centre, up, 11, 9, 4);
      this.burst(SPEC.debris!, 14, centre, up, 7, 7, 3);
      this.burst(SPEC.ember!, 10, centre, up, 2, 4, 1);
      if (down && down.distance < 1.6)
        this.decals.add(
          this.time(now),
          down.point,
          down.normal,
          radius * 1.4,
          DECAL.scorch,
          Math.random() * 6.28,
        );
    } else this.burst(SPEC.ember!, 16, centre, up, 2.5, 3, 2);
  }
  pickup(at: Vec3) {
    this.burst(
      SPEC.glint!,
      10,
      { x: at.x, y: at.y + 0.4, z: at.z },
      { x: 0, y: 1, z: 0 },
      2.5,
      2,
      1,
    );
  }
  entities(from: Entity[], to: Entity[], alpha: number, localId: string) {
    this.from.clear();
    for (const e of from) this.from.set(e.id, e);
    this.to = to;
    this.alpha = alpha;
    this.localId = localId;
  }
  /** Interpolated position of `e` (latest sample) into `out`. */
  private lerp(e: Entity, out: THREE.Vector3) {
    const a = this.from.get(e.id);
    if (!a) return out.set(e.position.x, e.position.y, e.position.z);
    const k = this.alpha;
    return out.set(
      a.position.x + (e.position.x - a.position.x) * k,
      a.position.y + (e.position.y - a.position.y) * k,
      a.position.z + (e.position.z - a.position.z) * k,
    );
  }
  // --- Frame -------------------------------------------------------------------
  update(
    dt: number,
    now: number,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    quality: Quality,
    bufferHeight: number,
  ) {
    const caps = CAPS[quality];
    this.quality = quality;
    this.tracers.setLimit(caps.tracers);
    this.decals.setLimit(caps.decals);
    this.particles.setLimit(caps.particles);
    const t = this.time(now);
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog?.isFogExp2) {
      fogUniforms.uFogColor.value.copy(fog.color);
      fogUniforms.uFogDensity.value = fog.density;
    } else fogUniforms.uFogDensity.value = 0;
    this.particles.uniforms.uScale.value =
      bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.floor = this.world?.floor ?? 0;
    this.stepProjectiles(dt);
    this.robotCount = 0;
    for (const e of this.to)
      if (
        e.type === 'robot' &&
        !((e.status ?? 0) & STATUS.dead) &&
        this.robotCount < this.robots.length
      ) {
        this.lerp(e, this.v);
        const r = this.robots[this.robotCount++]!;
        r.x = this.v.x;
        r.y = this.v.y;
        r.z = this.v.z;
      }
    const q = this.quads;
    q.begin();
    // Covering layers first (oil, scorched ground, smoke), additive light after.
    this.drawHazards(t, true, caps.flames);
    this.drawBlasts(t, true);
    this.drawHazards(t, false, caps.flames);
    this.drawStrikes(t);
    this.drawBlasts(t, false);
    this.drawFlashes(t);
    this.drawProjectiles(t, dt);
    this.drawBurning(t);
    this.drawCrates(t);
    q.end();
    this.tracers.update(t);
    this.decals.update(t);
    this.particles.update(dt, this.floor);
  }
  private stepProjectiles(dt: number) {
    this.dtAcc = Math.min(0.25, this.dtAcc + dt);
    const step = 1 / 60;
    while (this.dtAcc >= step) {
      this.dtAcc -= step;
      for (const p of this.projectiles) {
        if (!p.alive) continue;
        p.age += step;
        p.vy -= p.gravity * step;
        const sx = p.vx * step,
          sy = p.vy * step,
          sz = p.vz * step,
          len = Math.hypot(sx, sy, sz);
        const d = { x: sx / len, y: sy / len, z: sz / len };
        const o = { x: p.x, y: p.y, z: p.z };
        const hit = this.world ? raycastWorld(this.world, o, d, len) : null;
        const reach =
          p.kind === 'slag'
            ? this.robotAlong(o, d, hit ? hit.distance : len)
            : hit
              ? hit.distance
              : len;
        p.x += d.x * reach;
        p.y += d.y * reach;
        p.z += d.z * reach;
        // The authoritative blast/puddle follows from the server; the prediction ends here.
        if (reach < len - 1e-6 || p.age >= p.life) p.alive = false;
      }
    }
  }
  private drawHazards(t: number, covering: boolean, perFire: number) {
    const q = this.quads;
    let flames = 0,
      puddles = 0;
    for (const e of this.to) {
      if (e.type !== 'hazard') continue;
      const h = this.hash(e.id);
      const r = e.radius ?? 2;
      const left = (e.timer ?? -1) < 0 ? 99 : (e.timer ?? 0) / 60;
      const fade = Math.min(1, left / 1.2);
      const p = this.lerp(e, this.v);
      const y = p.y + 0.03;
      if (e.kind === 'oil') {
        if (!covering) continue;
        puddles++;
        const k = 0.95 * fade;
        q.push(
          p.x,
          y,
          p.z,
          r * 2.15,
          r * 2.15,
          frac(h, 1) * 6.28,
          MODE.ground,
          CELL.puddle,
          k,
          k,
          k,
          k,
        );
        continue;
      }
      if (e.kind !== 'fire') continue;
      if (covering) {
        // Charred, still-glossy base under the flames.
        const k = 0.85 * fade;
        q.push(
          p.x,
          y,
          p.z,
          r * 2.1,
          r * 2.1,
          frac(h, 1) * 6.28,
          MODE.ground,
          CELL.puddle,
          k * 0.55,
          k * 0.42,
          k * 0.36,
          k,
        );
        continue;
      }
      const n = Math.max(
        2,
        Math.round(perFire * Math.min(1, Math.max(0.5, r / 3))),
      );
      const size = Math.min(1.8, 0.95 + r * 0.28);
      const pulse = 0.85 + 0.15 * Math.sin(t * 7.1 + h);
      q.push(
        p.x,
        y + 0.02,
        p.z,
        r * 2.5,
        r * 2.5,
        t * 0.2,
        MODE.ground,
        CELL.glow,
        COLOR.fire.r * 0.42 * fade * pulse,
        COLOR.fire.g * 0.42 * fade * pulse,
        COLOR.fire.b * 0.42 * fade * pulse,
        0,
      );
      q.push(
        p.x,
        p.y + 0.7 * size,
        p.z,
        r * 2,
        r * 1.6,
        0,
        MODE.face,
        CELL.glow,
        COLOR.fire.r * 0.26 * fade * pulse,
        COLOR.fire.g * 0.22 * fade * pulse,
        COLOR.fire.b * 0.18 * fade * pulse,
        0,
      );
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + frac(h, i) * 0.7;
        const d = (i === 0 ? 0.1 : Math.sqrt((i + 0.4) / n)) * r * 0.62;
        const fx = p.x + Math.cos(a) * d,
          fz = p.z + Math.sin(a) * d;
        const flicker =
          0.76 +
          0.17 * Math.sin(t * 9.3 + i * 1.7 + h * 1e-3) +
          0.09 * Math.sin(t * 23.7 + i * 3.1);
        const height =
          (0.85 + 0.75 * frac(h, i + 7)) * size * flicker * (0.4 + 0.6 * fade);
        const width = height * 0.85 * (frac(h, i + 13) > 0.5 ? 1 : -1);
        const k = 1.15 * fade;
        q.push(
          fx,
          y - 0.05,
          fz,
          width,
          height,
          0.12 * Math.sin(t * 3.3 + i * 2.1),
          MODE.upright,
          CELL.flame,
          k,
          k,
          k,
          0,
        );
        flames++;
      }
    }
    if (covering) this.counts.puddles = puddles;
    else this.counts.flames = flames;
  }
  private drawStrikes(t: number) {
    const q = this.quads,
      R = FINGERS.radius,
      telegraph = FINGERS.telegraph * 60;
    for (const e of this.to) {
      if (e.type !== 'strike') continue;
      const before = this.from.get(e.id);
      const timer =
        before?.timer !== undefined && e.timer !== undefined
          ? before.timer + (e.timer - before.timer) * this.alpha
          : (e.timer ?? telegraph);
      const k = Math.max(0, Math.min(1, 1 - timer / telegraph));
      const h = this.hash(e.id);
      const p = this.lerp(e, this.v);
      const flick =
        0.72 +
        0.28 * Math.sin(t * 47 + h * 1e-3) * Math.sin(t * 13.3 + h * 2e-3);
      const ring = 0.25 + 0.95 * k;
      q.push(
        p.x,
        p.y + 0.06,
        p.z,
        R * 2.1,
        R * 2.1,
        t * 0.5,
        MODE.ground,
        CELL.ring,
        COLOR.gold.r * ring * 0.55,
        COLOR.gold.g * ring * 0.55,
        COLOR.gold.b * ring * 0.55,
        0,
      );
      // A second ring collapses onto the impact point as the strike nears.
      const s = R * 2 * (1.5 - 1.2 * k);
      q.push(
        p.x,
        p.y + 0.07,
        p.z,
        s,
        s,
        -t,
        MODE.ground,
        CELL.ring,
        COLOR.gold.r * ring,
        COLOR.gold.g * ring,
        COLOR.gold.b * ring,
        0,
      );
      const glow = 0.15 + 0.6 * k * k;
      q.push(
        p.x,
        p.y + 0.05,
        p.z,
        R * 2.6,
        R * 2.6,
        0,
        MODE.ground,
        CELL.glow,
        COLOR.gold.r * glow,
        COLOR.gold.g * glow,
        COLOR.gold.b * glow,
        0,
      );
      const beam = (0.25 + 1.2 * k * k) * flick;
      q.push(
        p.x,
        p.y,
        p.z,
        0.08 + 0.55 * k * k,
        FINGERS.skyHeight + 20,
        0,
        MODE.upright,
        CELL.beam,
        COLOR.pale.r * beam,
        COLOR.pale.g * beam,
        COLOR.pale.b * beam * 1.05,
        0,
      );
    }
  }
  private drawBlasts(t: number, covering: boolean) {
    const q = this.quads;
    for (const b of this.blasts) {
      const a = t - b.t0;
      if (a < 0 || a > LIFE[b.kind]) continue;
      const R = Math.max(1, b.radius);
      if (b.kind === 'slag') {
        if (covering) {
          for (let i = 0; i < 6; i++) {
            const sa = a - 0.06 - i * 0.02;
            if (sa <= 0 || sa > 1.7) continue;
            const ang = frac(b.seed, i) * 6.28;
            const d = R * 0.35 * (0.4 + sa * 0.9);
            const op = 0.62 * smooth(0, 0.18, sa) * Math.pow(1 - sa / 1.7, 1.2);
            const g = 0.11 + 0.03 * frac(b.seed, i + 9);
            q.push(
              b.x + Math.cos(ang) * d,
              b.y + 0.4 + sa * 1.3 + i * 0.12,
              b.z + Math.sin(ang) * d,
              R * (0.65 + sa * 0.85),
              R * (0.65 + sa * 0.85),
              ang + sa * 0.4,
              MODE.face,
              CELL.smoke,
              g * op,
              g * op,
              (g + 0.006) * op,
              op,
            );
          }
          continue;
        }
        if (a < 0.16) {
          const k = 2.4 * Math.pow(1 - a / 0.16, 2);
          const s = R * 1.5 * (0.6 + 2.5 * a);
          q.push(
            b.x,
            b.y + 0.4,
            b.z,
            s,
            s,
            0,
            MODE.face,
            CELL.glow,
            k,
            k * 0.78,
            k * 0.5,
            0,
          );
        }
        if (a < 0.1) {
          const k = 1.8 * (1 - a / 0.1);
          q.push(
            b.x,
            b.y + 0.3,
            b.z,
            R * 1.1,
            R * 1.1,
            b.seed,
            MODE.face,
            CELL.star,
            k,
            k * 0.9,
            k * 0.7,
            0,
          );
        }
        for (let i = 0; i < 7; i++) {
          const fa = a - i * 0.015;
          if (fa < 0 || fa > 0.45) continue;
          const ang = frac(b.seed, i + 3) * 6.28,
            lift = frac(b.seed, i + 5);
          const d = R * 0.3 * (0.2 + outCubic(fa / 0.45));
          const k = 2.1 * Math.pow(1 - fa / 0.45, 1.8);
          const s = R * (0.3 + 0.55 * outCubic(fa / 0.3));
          q.push(
            b.x + Math.cos(ang) * d,
            b.y + 0.25 + lift * R * 0.3 + fa * 1.8,
            b.z + Math.sin(ang) * d,
            s,
            s,
            ang + fa,
            MODE.face,
            CELL.glow,
            k,
            k * 0.5,
            k * 0.16,
            0,
          );
        }
        if (a < 0.4) {
          const k = 1.1 * (1 - a / 0.4),
            s = R * 2 * (0.25 + 1.6 * outCubic(a / 0.4));
          q.push(
            b.x,
            b.ground + 0.08,
            b.z,
            s,
            s,
            b.seed,
            MODE.ground,
            CELL.ring,
            k,
            k * 0.72,
            k * 0.48,
            0,
          );
        }
      } else if (b.kind === 'flask') {
        if (covering) {
          for (let i = 0; i < 5; i++) {
            const ang = frac(b.seed, i) * 6.28;
            const d = 0.15 + a * (1.2 + frac(b.seed, i + 4));
            const op = 0.92 * Math.pow(1 - a / LIFE.flask, 1.3);
            const c = COLOR.oil;
            q.push(
              b.x + Math.cos(ang) * d,
              b.y + 0.25 + a * 1.4 - 4.5 * a * a + frac(b.seed, i + 8) * 0.3,
              b.z + Math.sin(ang) * d,
              0.3 + a * 1.2,
              0.3 + a * 1.2,
              ang,
              MODE.face,
              CELL.splat,
              c.r * op,
              c.g * op,
              c.b * op,
              op,
            );
          }
          continue;
        }
        if (a < 0.1) {
          const k = 1.2 * (1 - a / 0.1);
          q.push(
            b.x,
            b.y + 0.25,
            b.z,
            0.7,
            0.7,
            b.seed,
            MODE.face,
            CELL.star,
            k,
            k,
            k,
            0,
          );
        }
      } else if (b.kind === 'fingers') {
        if (covering) {
          for (let i = 0; i < 4; i++) {
            const sa = a - 0.15 - i * 0.03;
            if (sa <= 0 || sa > 1.5) continue;
            const ang = frac(b.seed, i) * 6.28;
            const d = R * 0.4 * (0.5 + sa);
            const op = 0.45 * smooth(0, 0.2, sa) * Math.pow(1 - sa / 1.5, 1.2);
            const g = 0.2;
            q.push(
              b.x + Math.cos(ang) * d,
              b.y + 0.6 + sa * 1.6,
              b.z + Math.sin(ang) * d,
              R * (0.7 + sa * 0.9),
              R * (0.7 + sa * 0.9),
              ang,
              MODE.face,
              CELL.smoke,
              g * op,
              g * op,
              (g + 0.01) * op,
              op,
            );
          }
          continue;
        }
        const pale = COLOR.pale;
        if (a < 0.55) {
          const k = 1.9 * Math.pow(1 - a / 0.55, 1.6);
          q.push(
            b.x,
            b.y,
            b.z,
            R * 1.9 * (1 - 0.55 * (a / 0.55)),
            FINGERS.skyHeight + 30,
            0,
            MODE.upright,
            CELL.beam,
            pale.r * k,
            pale.g * k,
            pale.b * k * 1.06,
            0,
          );
        }
        if (a < 0.35) {
          const k = 2.6 * (1 - a / 0.35);
          q.push(
            b.x,
            b.y,
            b.z,
            0.75 * (1 - a / 0.35) + 0.05,
            FINGERS.skyHeight + 30,
            0,
            MODE.upright,
            CELL.beam,
            k,
            k,
            k,
            0,
          );
        }
        if (a < 0.3) {
          const k = 2 * Math.pow(1 - a / 0.3, 2);
          q.push(
            b.x,
            b.y + 1.2,
            b.z,
            R * 4 * (0.6 + a),
            R * 4 * (0.6 + a),
            0,
            MODE.face,
            CELL.glow,
            k,
            k * 0.93,
            k * 0.78,
            0,
          );
        }
        for (let r = 0; r < 2; r++) {
          const aa = a - r * 0.1;
          if (aa < 0 || aa > 0.6) continue;
          const k = 0.85 * Math.pow(1 - aa / 0.6, 1.5),
            s = R * 2 * (0.3 + 1.3 * outCubic(aa / 0.6));
          q.push(
            b.x,
            b.ground + 0.1 + r * 0.02,
            b.z,
            s,
            s,
            b.seed + r,
            MODE.ground,
            CELL.ring,
            COLOR.gold.r * k,
            COLOR.gold.g * k,
            COLOR.gold.b * k,
            0,
          );
        }
      } else if (!covering) {
        const k = 1.3 * Math.pow(1 - a / LIFE.ignite, 2);
        const s = 3.2 * (0.6 + a);
        q.push(
          b.x,
          b.y + 0.6,
          b.z,
          s,
          s,
          0,
          MODE.face,
          CELL.glow,
          COLOR.ember.r * k,
          COLOR.ember.g * k,
          COLOR.ember.b * k,
          0,
        );
      }
    }
  }
  private drawFlashes(t: number) {
    const q = this.quads;
    for (const f of this.flashes) {
      const a = t - f.t0;
      if (a < 0 || a > 0.05) continue;
      const k = 1.6 * (1 - a / 0.05);
      const c = COLOR.tracer;
      q.push(
        f.x,
        f.y,
        f.z,
        f.size,
        f.size,
        f.rot,
        MODE.face,
        CELL.star,
        c.r * k,
        c.g * k,
        c.b * k,
        0,
      );
      q.push(
        f.x,
        f.y,
        f.z,
        f.size * 2.6,
        f.size * 2.6,
        0,
        MODE.face,
        CELL.glow,
        c.r * k * 0.3,
        c.g * k * 0.25,
        c.b * k * 0.2,
        0,
      );
    }
  }
  private drawProjectiles(t: number, dt: number) {
    const q = this.quads;
    let bottles = 0,
      count = 0;
    const slug = (
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
    ) => {
      const s = Math.hypot(vx, vy, vz) || 1;
      const k = 1.6;
      q.push(
        x,
        y,
        z,
        0.32,
        0.32,
        0,
        MODE.face,
        CELL.glow,
        k,
        k * 0.82,
        k * 0.6,
        0,
      );
      q.push(
        x,
        y,
        z,
        1.2,
        1.2,
        0,
        MODE.face,
        CELL.glow,
        COLOR.fire.r * 0.55,
        COLOR.fire.g * 0.45,
        COLOR.fire.b * 0.35,
        0,
      );
      for (let i = 1; i <= 4; i++) {
        const back = i * 0.32;
        const f = 1 - i / 5;
        q.push(
          x - (vx / s) * back,
          y - (vy / s) * back,
          z - (vz / s) * back,
          0.55 * f + 0.1,
          0.55 * f + 0.1,
          0,
          MODE.face,
          CELL.glow,
          COLOR.fire.r * 0.6 * f,
          COLOR.fire.g * 0.45 * f,
          COLOR.fire.b * 0.3 * f,
          0,
        );
      }
      if (Math.random() < dt * 45)
        this.particles.spawn(
          x,
          y,
          z,
          (Math.random() - 0.5) * 1.5,
          Math.random() * 1.2,
          (Math.random() - 0.5) * 1.5,
          SPEC.ember!,
          0.5,
        );
    };
    const bottle = (
      x: number,
      y: number,
      z: number,
      vx: number,
      vz: number,
      age: number,
    ) => {
      if (bottles >= 16) return;
      this.axis.set(vz, 0, -vx);
      if (this.axis.lengthSq() < 1e-6) this.axis.set(1, 0, 0);
      this.axis.normalize();
      this.q.setFromAxisAngle(this.axis, age * 11);
      this.w.set(x, y, z);
      this.m.compose(this.w, this.q, this.s);
      this.bottles.setMatrixAt(bottles++, this.m);
    };
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      count++;
      const blend = Math.max(0, 1 - p.age / 0.12);
      const x = p.x + p.ox * blend,
        y = p.y + p.oy * blend,
        z = p.z + p.oz * blend;
      if (p.kind === 'slag') slug(x, y, z, p.vx, p.vy, p.vz);
      else bottle(x, y, z, p.vx, p.vz, p.age);
    }
    for (const e of this.to) {
      if (e.type !== 'projectile' || e.owner === this.localId) continue;
      count++;
      const p = this.lerp(e, this.v);
      if (e.kind === 'flask')
        bottle(
          p.x,
          p.y,
          p.z,
          e.velocity.x,
          e.velocity.z,
          t + (this.hash(e.id) % 100),
        );
      else slug(p.x, p.y, p.z, e.velocity.x, e.velocity.y, e.velocity.z);
    }
    this.bottles.count = bottles;
    this.bottles.visible = bottles > 0;
    if (bottles) this.bottles.instanceMatrix.needsUpdate = true;
    this.counts.projectiles = count;
  }
  private drawBurning(t: number) {
    const q = this.quads;
    for (const e of this.to) {
      if ((e.type !== 'robot' && e.type !== 'player') || e.id === this.localId)
        continue;
      const status = e.status ?? 0;
      if (!(status & STATUS.burning) || status & STATUS.dead) continue;
      const p = this.lerp(e, this.v);
      const h = this.hash(e.id);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + h * 1e-3;
        const flicker =
          0.75 + 0.2 * Math.sin(t * 11 + i * 2.3) + 0.08 * Math.sin(t * 27 + i);
        const height = (0.75 + 0.25 * i) * flicker;
        q.push(
          p.x + Math.cos(a) * 0.22,
          p.y + 0.25 + i * 0.25,
          p.z + Math.sin(a) * 0.22,
          height * 0.62 * (i % 2 ? -1 : 1),
          height,
          0.1 * Math.sin(t * 4 + i),
          MODE.upright,
          CELL.flame,
          1.1,
          1.1,
          1.1,
          0,
        );
      }
      q.push(
        p.x,
        p.y + 1,
        p.z,
        1.8,
        1.8,
        0,
        MODE.face,
        CELL.glow,
        COLOR.fire.r * 0.22,
        COLOR.fire.g * 0.2,
        COLOR.fire.b * 0.18,
        0,
      );
    }
  }
  private drawCrates(t: number) {
    let n = 0;
    const q = this.quads;
    for (const e of this.to) {
      if (e.type !== 'pickup' || n >= 48) continue;
      const h = this.hash(e.id);
      const p = this.lerp(e, this.v);
      const y = p.y + 0.34 + Math.sin(t * 2.1 + h * 1e-3) * 0.05;
      this.q.setFromAxisAngle(
        this.axis.set(0, 1, 0),
        t * 0.7 + (h % 628) / 100,
      );
      this.w.set(p.x, y, p.z);
      this.m.compose(this.w, this.q, this.s);
      this.crates.setMatrixAt(n++, this.m);
      const k = 0.18 * (0.75 + 0.25 * Math.sin(t * 3 + h * 1e-3));
      q.push(
        p.x,
        p.y + 0.04,
        p.z,
        1.35,
        1.35,
        t * 0.3,
        MODE.ground,
        CELL.ring,
        COLOR.pale.r * k,
        COLOR.pale.g * k,
        COLOR.pale.b * k,
        0,
      );
    }
    this.crates.count = n;
    this.crates.visible = n > 0;
    if (n) this.crates.instanceMatrix.needsUpdate = true;
    this.counts.crates = n;
  }
  /** Nearest fire hazard to `p` (distance, position), for the crackle loop. */
  nearestFire(p: Vec3, out: THREE.Vector3) {
    let best = Infinity;
    for (const e of this.to) {
      if (e.type !== 'hazard' || e.kind !== 'fire') continue;
      const d =
        Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) -
        (e.radius ?? 0) * 0.6;
      if (d < best) {
        best = d;
        out.set(e.position.x, e.position.y + 0.5, e.position.z);
      }
    }
    return best;
  }
  liveBlasts(now: number) {
    const t = this.time(now);
    return this.blasts.filter((b) => t - b.t0 >= 0 && t - b.t0 <= LIFE[b.kind])
      .length;
  }
  stats(now: number) {
    const t = this.time(now);
    const draws = [
      this.tracers.mesh,
      this.decals.mesh,
      this.particles.points,
      this.quads.mesh,
      this.crates,
      this.bottles,
    ].filter((m) => m.visible).length;
    return {
      tracers: this.tracers.live(t),
      decals: this.decals.active,
      particles: this.particles.count,
      flames: this.counts.flames,
      puddles: this.counts.puddles,
      projectiles: this.counts.projectiles,
      crates: this.counts.crates,
      blasts: this.liveBlasts(now),
      quads: this.quads.count,
      drawCalls: draws,
    };
  }
  reset() {
    this.tracers.clear();
    this.decals.clear();
    this.particles.clear();
    for (const b of this.blasts) b.t0 = -1e9;
    for (const f of this.flashes) f.t0 = -1e9;
    for (const p of this.projectiles) p.alive = false;
    this.to = [];
    this.from.clear();
    this.quads.begin();
    this.quads.end();
    this.crates.count = 0;
    this.crates.visible = false;
    this.bottles.count = 0;
    this.bottles.visible = false;
    this.counts = { flames: 0, puddles: 0, projectiles: 0, crates: 0 };
  }
}
