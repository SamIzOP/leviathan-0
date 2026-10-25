import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  MOVE,
  type CombatRules,
  type Cue,
  type Entity,
} from '@leviathan/shared';
import { CELL, fxAtlas } from './atlas';
const TICK = 1 / 60;
const ticks = (seconds: number) => Math.max(1, Math.round(seconds / TICK));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ease = (current: number, target: number, dt: number, tau: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));
type Material = THREE.MeshStandardMaterial;
/** Merges boxes and cylinders per material into one mesh each. */
class Builder {
  private parts = new Map<Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private add(
    material: Material,
    g: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
  ) {
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.m.compose(
      new THREE.Vector3(x, y, z),
      this.q,
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(this.m);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material)!.push(g);
    return this;
  }
  box(
    material: Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    return this.add(
      material,
      new THREE.BoxGeometry(w, h, d),
      x,
      y,
      z,
      rx,
      ry,
      rz,
    );
  }
  /** Cylinder along −Z (front radius first). */
  cyl(
    material: Material,
    front: number,
    back: number,
    length: number,
    x: number,
    y: number,
    z: number,
    segments = 14,
  ) {
    const g = new THREE.CylinderGeometry(front, back, length, segments);
    g.rotateX(-Math.PI / 2);
    return this.add(material, g, x, y, z, 0, 0, 0);
  }
  /** Cylinder along X (a side drum or turret). */
  side(
    material: Material,
    r: number,
    length: number,
    x: number,
    y: number,
    z: number,
  ) {
    const g = new THREE.CylinderGeometry(r, r, length, 14);
    g.rotateZ(Math.PI / 2);
    return this.add(material, g, x, y, z, 0, 0, 0);
  }
  /** Cylinder along Y. */
  post(
    material: Material,
    r: number,
    length: number,
    x: number,
    y: number,
    z: number,
  ) {
    return this.add(
      material,
      new THREE.CylinderGeometry(r, r, length, 12),
      x,
      y,
      z,
      0,
      0,
      0,
    );
  }
  build() {
    const group = new THREE.Group();
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false)!;
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}
interface Model {
  root: THREE.Group;
  muzzle: THREE.Vector3;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** Reload style: a magazine/canister swap, or shell-by-shell into the port. */
  reload: 'mag' | 'shell';
  mag?: THREE.Group;
  magHome?: THREE.Vector3;
  slide?: THREE.Group;
  pump?: THREE.Group;
  shell?: THREE.Group;
  flash: number;
  /** Kick: metres back and radians up per shot at the hip. */
  back: number;
  climb: number;
}
/** Damped spring channel driven by impulses (shot kick, landings, seat bumps). */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private damping: number,
  ) {}
  step(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / 0.004)),
      h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v += (-this.k * this.x - this.damping * this.v) * h;
      this.x += this.v * h;
    }
  }
  reset() {
    this.x = this.v = 0;
  }
}
const spring = (k: number, zeta: number) =>
  new Spring(k, 2 * Math.sqrt(k) * zeta);
export interface ViewmodelFrame {
  dt: number;
  now: number;
  local?: Entity;
  rules: CombatRules;
  ads: number;
  look: { yaw: number; pitch: number };
  dead: boolean;
}
/** First-person weapon pass: its own scene, camera and lights, drawn over the
 * world after a depth clear. Placeholder silhouettes per tier from merged boxes
 * and cylinders with three shared materials. */
export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
  materials = {
    gunmetal: new THREE.MeshStandardMaterial({
      color: '#1f2529',
      metalness: 0.5,
      roughness: 0.52,
      envMapIntensity: 0.45,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: '#56616a',
      metalness: 0.75,
      roughness: 0.4,
      envMapIntensity: 0.5,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: '#aeb6ba',
      metalness: 0.05,
      roughness: 0.65,
      envMapIntensity: 0.25,
    }),
  };
  models: Model[] = [];
  visible = false;
  /** True while the marksman scope overlay replaces the weapon. */
  scoped = false;
  private flashGroup = new THREE.Group();
  private flashMaterial: THREE.MeshBasicMaterial;
  private flashUntil = 0;
  private slot = -1;
  private previous = -1;
  private drawFrom = 0;
  private raiseAt = -1e9;
  private segment = 1;
  private lastReload = 0;
  private reloadP = 1;
  private reloadPose = 0;
  private rackAt = -1e9;
  private lastShotAt = -1e9;
  private lastShotSlot = -1;
  private seated = false;
  private lower = 0;
  private slideTilt = 0;
  private wallTilt = 0;
  private air = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private swayX = 0;
  private swayY = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private lastMode = 'GROUND';
  private lastVy = 0;
  private kickBack = spring(260, 0.62);
  private kickUp = spring(240, 0.7);
  private kickPitch = spring(220, 0.6);
  private kickRoll = spring(200, 0.55);
  private kickYaw = spring(220, 0.6);
  private slideKick = spring(900, 0.9);
  private tmp = new THREE.Vector3();
  private active?: Model;
  constructor() {
    for (const m of Object.values(this.materials)) m.toneMapped = false;
    this.scene.add(new THREE.HemisphereLight('#aab6bc', '#22282b', 1.3));
    const key = new THREE.DirectionalLight('#e4ebee', 1.35);
    key.position.set(-0.6, 1, 0.7);
    const rim = new THREE.DirectionalLight('#9fb0ba', 0.45);
    rim.position.set(0.8, 0.2, -1);
    this.scene.add(key, rim);
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: fxAtlas(),
      color: '#ffd9a8',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.buildFlash();
    this.models = [
      this.pistol(),
      this.smg(),
      this.shotgun(),
      this.marksman(),
      this.launcher(),
    ];
    for (const m of this.models) {
      m.root.visible = false;
      this.scene.add(m.root);
    }
  }
  private buildFlash() {
    const quad = (w: number, h: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const col = CELL.star % 4,
        row = Math.floor(CELL.star / 4);
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, (col + uv.getX(i)) / 4, (1 - row + uv.getY(i)) / 2);
      return g;
    };
    // A star facing the eye plus two crossed petals reaching forward.
    const front = quad(1, 1);
    const flat = quad(0.7, 1.6)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, -0.6);
    const upright = quad(0.7, 1.6)
      .rotateX(-Math.PI / 2)
      .rotateZ(Math.PI / 2)
      .translate(0, 0, -0.6);
    for (const g of [front, flat, upright]) {
      const mesh = new THREE.Mesh(g, this.flashMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.flashGroup.add(mesh);
    }
    this.flashGroup.visible = false;
  }
  private pistol(): Model {
    const { gunmetal: G, steel: S, accent: A } = this.materials;
    const body = new Builder()
      .box(G, 0.028, 0.022, 0.15, 0, 0.006, -0.055)
      .cyl(S, 0.0065, 0.0065, 0.012, 0, 0.032, -0.162)
      .box(G, 0.022, 0.005, 0.042, 0, -0.022, -0.03)
      .box(G, 0.022, 0.026, 0.005, 0, -0.01, -0.052)
      .box(S, 0.005, 0.014, 0.004, 0, -0.01, -0.022)
      .box(G, 0.03, 0.105, 0.046, 0, -0.05, 0.012, -0.28)
      .box(A, 0.031, 0.01, 0.03, 0, -0.07, 0.019, -0.28)
      .build();
    const slide = new Builder()
      .box(S, 0.03, 0.032, 0.186, 0, 0.032, -0.065)
      .box(A, 0.005, 0.008, 0.008, 0, 0.052, -0.15)
      .box(G, 0.024, 0.008, 0.009, 0, 0.052, 0.018)
      .box(A, 0.004, 0.004, 0.002, -0.007, 0.0535, 0.0228)
      .box(A, 0.004, 0.004, 0.002, 0.007, 0.0535, 0.0228)
      .box(G, 0.031, 0.02, 0.003, 0, 0.03, 0.004)
      .box(G, 0.031, 0.02, 0.003, 0, 0.03, 0.012)
      .build();
    const mag = new Builder()
      .box(S, 0.022, 0.1, 0.036, 0, 0, 0)
      .box(A, 0.027, 0.008, 0.043, 0, -0.052, 0.002)
      .build();
    const magHome = new THREE.Vector3(0, -0.052, 0.013);
    mag.position.copy(magHome);
    mag.rotation.x = -0.28;
    const root = new THREE.Group();
    root.add(body, slide, mag);
    return {
      root,
      muzzle: new THREE.Vector3(0, 0.032, -0.17),
      hip: new THREE.Vector3(0.15, -0.15, -0.43),
      ads: new THREE.Vector3(0, -0.0545, -0.36),
      reload: 'mag',
      mag,
      magHome,
      slide,
      flash: 0.1,
      back: 0.03,
      climb: 0.09,
    };
  }
  private smg(): Model {
    const { gunmetal: G, steel: S, accent: A } = this.materials;
    const body = new Builder()
      .box(G, 0.042, 0.058, 0.24, 0, 0.02, -0.07)
      .box(S, 0.022, 0.008, 0.2, 0, 0.053, -0.07)
      .box(G, 0.02, 0.012, 0.014, 0, 0.058, -0.168)
      .box(A, 0.004, 0.017, 0.005, 0, 0.068, -0.168)
      .box(G, 0.026, 0.006, 0.009, 0, 0.057, 0.03)
      .box(G, 0.006, 0.02, 0.009, -0.01, 0.066, 0.03)
      .box(G, 0.006, 0.02, 0.009, 0.01, 0.066, 0.03)
      .box(A, 0.004, 0.004, 0.002, -0.01, 0.0715, 0.0346)
      .box(A, 0.004, 0.004, 0.002, 0.01, 0.0715, 0.0346)
      .cyl(S, 0.017, 0.017, 0.1, 0, 0.022, -0.235)
      .cyl(G, 0.012, 0.012, 0.035, 0, 0.022, -0.3)
      .side(S, 0.025, 0.014, 0.027, 0.012, -0.04)
      .side(A, 0.012, 0.016, 0.028, 0.012, -0.04)
      .box(G, 0.03, 0.09, 0.04, 0, -0.04, 0.03, -0.3)
      .box(G, 0.02, 0.005, 0.05, 0, -0.012, -0.01)
      .box(G, 0.03, 0.034, 0.12, 0, 0.022, 0.11)
      .box(G, 0.032, 0.056, 0.012, 0, 0.012, 0.172)
      .box(A, 0.031, 0.004, 0.018, 0, 0.04, 0.1)
      .build();
    const mag = new Builder()
      .box(S, 0.024, 0.2, 0.036, 0, 0, 0)
      .box(A, 0.026, 0.012, 0.038, 0, -0.07, 0)
      .box(G, 0.027, 0.008, 0.04, 0, -0.1, 0)
      .build();
    const magHome = new THREE.Vector3(0, -0.085, -0.085);
    mag.position.copy(magHome);
    mag.rotation.x = 0.12;
    const root = new THREE.Group();
    root.add(body, mag);
    return {
      root,
      muzzle: new THREE.Vector3(0, 0.022, -0.322),
      hip: new THREE.Vector3(0.16, -0.17, -0.47),
      ads: new THREE.Vector3(0, -0.07, -0.36),
      reload: 'mag',
      mag,
      magHome,
      flash: 0.11,
      back: 0.016,
      climb: 0.035,
    };
  }
  private shotgun(): Model {
    const { gunmetal: G, steel: S, accent: A } = this.materials;
    const body = new Builder()
      .box(G, 0.046, 0.064, 0.2, 0, 0.012, -0.02)
      .cyl(S, 0.0135, 0.0135, 0.52, 0, 0.03, -0.38)
      .box(S, 0.008, 0.004, 0.5, 0, 0.0455, -0.38)
      .box(A, 0.005, 0.006, 0.006, 0, 0.0495, -0.63)
      .cyl(G, 0.0115, 0.0115, 0.42, 0, -0.002, -0.33)
      .cyl(S, 0.013, 0.013, 0.016, 0, -0.002, -0.545)
      .box(G, 0.036, 0.06, 0.07, 0, -0.03, 0.075, -0.5)
      .box(G, 0.04, 0.075, 0.24, 0, -0.035, 0.2, 0.15)
      .box(A, 0.042, 0.086, 0.014, 0, -0.054, 0.322, 0.15)
      .box(G, 0.02, 0.006, 0.05, 0, -0.026, -0.02)
      .box(S, 0.03, 0.012, 0.06, 0, -0.02, -0.06)
      .build();
    const pump = new Builder()
      .box(G, 0.05, 0.042, 0.15, 0, 0, 0)
      .box(A, 0.051, 0.006, 0.012, 0, 0.006, -0.045)
      .box(A, 0.051, 0.006, 0.012, 0, 0.006, 0.045)
      .build();
    pump.position.set(0, -0.004, -0.29);
    const shell = new Builder()
      .cyl(A, 0.0105, 0.0105, 0.055, 0, 0, -0.006)
      .cyl(S, 0.011, 0.011, 0.012, 0, 0, 0.027)
      .build();
    shell.visible = false;
    const root = new THREE.Group();
    root.add(body, pump, shell);
    return {
      root,
      muzzle: new THREE.Vector3(0, 0.03, -0.65),
      hip: new THREE.Vector3(0.17, -0.175, -0.5),
      ads: new THREE.Vector3(0, -0.0525, -0.42),
      reload: 'shell',
      pump,
      shell,
      flash: 0.17,
      back: 0.06,
      climb: 0.2,
    };
  }
  private marksman(): Model {
    const { gunmetal: G, steel: S, accent: A } = this.materials;
    const body = new Builder()
      .box(G, 0.044, 0.06, 0.28, 0, 0.005, -0.05)
      .box(G, 0.048, 0.05, 0.24, 0, 0.008, -0.3)
      .box(A, 0.05, 0.052, 0.006, 0, 0.008, -0.415)
      .cyl(S, 0.0105, 0.0105, 0.2, 0, 0.01, -0.52)
      .box(G, 0.028, 0.024, 0.05, 0, 0.01, -0.64)
      .cyl(G, 0.0165, 0.0165, 0.22, 0, 0.075, -0.06)
      .cyl(S, 0.026, 0.0165, 0.06, 0, 0.075, -0.2)
      .cyl(S, 0.02, 0.02, 0.045, 0, 0.075, 0.07)
      .cyl(A, 0.0175, 0.0175, 0.008, 0, 0.075, -0.14)
      .post(G, 0.011, 0.022, 0, 0.098, -0.06)
      .side(G, 0.01, 0.02, 0.022, 0.075, -0.06)
      .box(G, 0.018, 0.03, 0.02, 0, 0.045, -0.12)
      .box(G, 0.018, 0.03, 0.02, 0, 0.045, 0.0)
      .box(G, 0.03, 0.09, 0.042, 0, -0.045, 0.04, -0.3)
      .box(G, 0.02, 0.005, 0.05, 0, -0.026, -0.0)
      .box(G, 0.04, 0.07, 0.22, 0, -0.005, 0.2)
      .box(G, 0.036, 0.02, 0.1, 0, 0.04, 0.2)
      .box(A, 0.042, 0.08, 0.012, 0, -0.005, 0.316)
      .build();
    const mag = new Builder()
      .box(S, 0.026, 0.085, 0.06, 0, 0, 0)
      .box(A, 0.03, 0.008, 0.064, 0, -0.045, 0)
      .build();
    const magHome = new THREE.Vector3(0, -0.06, -0.07);
    mag.position.copy(magHome);
    mag.rotation.x = 0.08;
    const root = new THREE.Group();
    root.add(body, mag);
    return {
      root,
      muzzle: new THREE.Vector3(0, 0.01, -0.675),
      hip: new THREE.Vector3(0.165, -0.175, -0.48),
      ads: new THREE.Vector3(0, -0.075, -0.26),
      reload: 'mag',
      mag,
      magHome,
      flash: 0.13,
      back: 0.045,
      climb: 0.13,
    };
  }
  private launcher(): Model {
    const { gunmetal: G, steel: S, accent: A } = this.materials;
    const body = new Builder()
      .cyl(G, 0.052, 0.052, 0.46, 0, 0.02, -0.14, 18)
      .cyl(S, 0.06, 0.06, 0.045, 0, 0.02, -0.38, 18)
      .cyl(A, 0.0535, 0.0535, 0.012, 0, 0.02, -0.26, 18)
      .cyl(A, 0.0535, 0.0535, 0.012, 0, 0.02, 0.03, 18)
      .cyl(S, 0.048, 0.048, 0.05, 0, 0.02, 0.115, 18)
      .box(S, 0.05, 0.006, 0.012, 0, 0.074, -0.05)
      .box(S, 0.05, 0.006, 0.012, 0, 0.074, -0.08)
      .box(S, 0.05, 0.006, 0.012, 0, 0.074, -0.11)
      .box(G, 0.034, 0.095, 0.045, 0, -0.07, 0.0, -0.25)
      .box(G, 0.022, 0.006, 0.05, 0, -0.04, -0.03)
      .box(G, 0.03, 0.08, 0.035, 0, -0.07, -0.22)
      .box(G, 0.045, 0.012, 0.03, -0.038, 0.066, -0.2)
      .box(A, 0.003, 0.034, 0.003, -0.074, 0.092, -0.2)
      .box(A, 0.003, 0.034, 0.003, -0.046, 0.092, -0.2)
      .box(A, 0.031, 0.003, 0.003, -0.06, 0.109, -0.2)
      .box(G, 0.045, 0.012, 0.03, -0.038, 0.066, 0.06)
      .box(G, 0.016, 0.022, 0.006, -0.06, 0.08, 0.06)
      .box(A, 0.006, 0.006, 0.002, -0.06, 0.088, 0.0635)
      .build();
    const mag = new Builder()
      .post(S, 0.034, 0.1, 0, 0, 0)
      .post(A, 0.0345, 0.016, 0, -0.02, 0)
      .post(G, 0.036, 0.012, 0, -0.054, 0)
      .build();
    const magHome = new THREE.Vector3(0, -0.06, -0.1);
    mag.position.copy(magHome);
    const root = new THREE.Group();
    root.add(body, mag);
    return {
      root,
      muzzle: new THREE.Vector3(0, 0.02, -0.41),
      hip: new THREE.Vector3(0.18, -0.2, -0.54),
      ads: new THREE.Vector3(0.06, -0.093, -0.44),
      reload: 'mag',
      mag,
      magHome,
      flash: 0.2,
      back: 0.075,
      climb: 0.22,
    };
  }
  /** A predicted shot: kick, slide and muzzle flash. `ads` is the eased fraction. */
  fire(slot: number, ads: number, seq: number, now: number) {
    const m = this.models[slot];
    if (!m) return;
    const scale = 1 - 0.65 * ads;
    const side = (seq * 0.618034) % 1 > 0.5 ? 1 : -1;
    this.kickBack.v += (m.back * 40 * scale) / 0.6;
    this.kickBack.x += m.back * 0.35 * scale;
    this.kickUp.v += m.back * 6 * scale;
    this.kickPitch.v += m.climb * 22 * scale;
    this.kickRoll.v += side * m.climb * 6 * scale;
    this.kickYaw.v += side * m.climb * 3 * scale;
    this.slideKick.x = 1;
    this.slideKick.v = 0;
    this.lastShotAt = now;
    this.lastShotSlot = slot;
    this.flashUntil = now + 34;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    const s = m.flash * (0.85 + Math.random() * 0.35);
    this.flashGroup.scale.setScalar(s);
    this.flashGroup.removeFromParent();
    m.root.add(this.flashGroup);
    this.flashGroup.position.copy(m.muzzle);
    this.flashMaterial.color.set(slot === 4 ? '#ff9a4a' : '#ffd9a8');
  }
  cue(cue: Cue, now: number) {
    if (cue === 'reload-done' && this.models[this.slot]?.reload === 'shell')
      this.rackAt = now;
    if (cue === 'reload-round') {
      this.kickUp.v += 0.25;
      this.kickPitch.v -= 0.6;
    }
  }
  /** Respawn: raise from below. */
  raise(now: number) {
    this.raiseAt = now;
  }
  land(impact: number) {
    this.kickUp.v -= Math.min(0.9, impact * 0.08);
  }
  update(f: ViewmodelFrame) {
    const c = f.local?.combat;
    if (!f.local || !c || f.dead) {
      this.visible = false;
      this.scoped = false;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, f.dt)),
      now = f.now;
    const w = f.rules.table[c.slot]!;
    if (c.slot !== this.slot) {
      this.previous = this.slot;
      this.slot = c.slot;
      this.drawFrom = now;
      this.lastReload = 0;
      this.reloadP = 1;
      this.reloadPose = 0;
    }
    // Switch: the old weapon drops for the first third of the draw, the new one raises.
    const drawTicks = ticks(w.drawTime);
    const drawP = c.draw > 0 ? 1 - c.draw / drawTicks : 1;
    let model = this.models[this.slot]!;
    let hidden: number;
    const prev = this.models[this.previous];
    if (drawP < 0.35 && prev && now - this.drawFrom < w.drawTime * 1000) {
      model = prev;
      hidden = smooth(0, 0.35, drawP);
    } else {
      const t =
        drawP < 1
          ? clamp01((drawP - (prev ? 0.35 : 0)) / (prev ? 0.65 : 1))
          : 1;
      hidden = 1 - (1 - Math.pow(1 - t, 3));
    }
    hidden = Math.max(hidden, 1 - smooth(0, 450, now - this.raiseAt));
    for (const m of this.models) m.root.visible = m === model;
    const ads = f.ads;
    // Reload progress: a rising timer marks a new reload or the next shell.
    if (c.reload > this.lastReload) this.segment = c.reload;
    this.lastReload = c.reload;
    const rawP = c.reload > 0 ? 1 - c.reload / Math.max(1, this.segment) : 1;
    this.reloadP =
      rawP < this.reloadP - 0.5 ? rawP : ease(this.reloadP, rawP, dt, 0.02);
    const rp = this.reloadP;
    if (model.reload === 'mag') {
      const target =
        c.reload > 0 ? smooth(0, 0.12, rp) * (1 - smooth(0.84, 1, rp)) : 0;
      this.reloadPose = ease(this.reloadPose, target, dt, 0.05);
      const seated = c.reload <= 0 || rp >= 0.72;
      if (seated && !this.seated && c.reload > 0) {
        this.kickUp.v += 0.5;
        this.kickRoll.v -= 1.2;
      }
      this.seated = seated;
    } else {
      this.reloadPose = ease(this.reloadPose, c.reload > 0 ? 1 : 0, dt, 0.09);
    }
    const e = this.reloadPose;
    // Locomotion.
    const v = f.local.velocity,
      mode = f.local.move?.mode ?? 'GROUND',
      hs = Math.hypot(v.x, v.z);
    const grounded = mode === 'GROUND' || mode === 'CROUCH';
    if (
      (this.lastMode === 'AIR' || this.lastMode === 'WALLRUN') &&
      mode !== 'AIR' &&
      mode !== 'WALLRUN'
    )
      this.land(Math.max(0, -this.lastVy));
    this.lastMode = mode;
    this.lastVy = v.y;
    this.lower = ease(this.lower, c.lowered ? 1 : 0, dt, 0.09);
    this.bobAmp = ease(
      this.bobAmp,
      grounded ? Math.min(1.3, hs / MOVE.sprint) : 0,
      dt,
      0.12,
    );
    if (grounded) this.bobPhase += dt * hs * 1.2;
    this.slideTilt = ease(this.slideTilt, mode === 'SLIDE' ? 1 : 0, dt, 0.1);
    let wallSide = 0;
    const wall = f.local.move?.wall;
    if (mode === 'WALLRUN' && wall) {
      const right =
        Math.cos(f.local.yaw) * (wall.axis === 'x' ? 1 : 0) -
        Math.sin(f.local.yaw) * (wall.axis === 'z' ? 1 : 0);
      wallSide = right * wall.dir > 0 ? 1 : -1;
    }
    this.wallTilt = ease(this.wallTilt, wallSide, dt, 0.14);
    this.air = ease(
      this.air,
      mode === 'AIR' ? Math.max(-0.03, Math.min(0.03, -v.y * 0.0025)) : 0,
      dt,
      0.1,
    );
    // Sway: the weapon lags the look direction.
    const rate = 1 / Math.max(dt, 1 / 240);
    const yawRate = Math.max(-8, Math.min(8, f.look.yaw * rate)),
      pitchRate = Math.max(-8, Math.min(8, f.look.pitch * rate));
    const swayScale = 1 - 0.7 * ads;
    this.swayX = ease(this.swayX, yawRate * 0.0055 * swayScale, dt, 0.08);
    this.swayY = ease(this.swayY, -pitchRate * 0.004 * swayScale, dt, 0.08);
    this.swayYaw = ease(this.swayYaw, -yawRate * 0.018 * swayScale, dt, 0.07);
    this.swayPitch = ease(
      this.swayPitch,
      -pitchRate * 0.014 * swayScale,
      dt,
      0.07,
    );
    for (const s of [
      this.kickBack,
      this.kickUp,
      this.kickPitch,
      this.kickRoll,
      this.kickYaw,
      this.slideKick,
    ])
      s.step(dt);
    // Compose.
    const root = model.root;
    const bob = this.bobAmp * (1 - 0.85 * ads) * (1 + 0.5 * this.lower);
    const breathe = (1 - 0.6 * ads) * (1 - this.bobAmp);
    const t = now / 1000;
    const p = this.tmp.copy(model.hip).lerp(model.ads, ads);
    let px = p.x,
      py = p.y,
      pz = p.z,
      rx = 0,
      ry = 0,
      rz = 0;
    px += Math.sin(this.bobPhase) * 0.011 * bob + this.swayX;
    py +=
      -Math.abs(Math.cos(this.bobPhase)) * 0.009 * bob +
      Math.sin(t * 1.7) * 0.0016 * breathe +
      this.swayY +
      this.air;
    rz += Math.sin(this.bobPhase) * 0.014 * bob;
    rx += Math.sin(t * 1.1) * 0.004 * breathe + this.swayPitch;
    ry += this.swayYaw + 0.035 * (1 - ads);
    // Sprint lowered pose.
    const low = this.lower * (1 - ads);
    px += 0.035 * low;
    py -= 0.06 * low;
    pz += 0.03 * low;
    rx -= 0.42 * low;
    ry += 0.6 * low;
    rz += 0.22 * low;
    // Slide cant and wall-run lean away from the wall.
    const tilt = this.slideTilt * (1 - 0.7 * ads);
    px -= 0.03 * tilt;
    py -= 0.022 * tilt;
    rz += 0.34 * tilt;
    px -= 0.02 * this.wallTilt * (1 - ads);
    rz += 0.16 * this.wallTilt * (1 - 0.6 * ads);
    // Reload pose.
    if (model.reload === 'mag') {
      px -= 0.05 * e;
      py -= 0.02 * e;
      pz += 0.03 * e;
      rx += 0.16 * e;
      ry += 0.05 * e;
      rz += 0.42 * e;
    } else {
      px -= 0.03 * e;
      py += 0.035 * e;
      pz += 0.03 * e;
      rx += 0.18 * e;
      ry -= 0.06 * e;
      rz -= 0.38 * e;
    }
    // Shotgun pump: rack during the fire interval and after the last shell.
    let pump = 0;
    if (model.pump) {
      const interval = Math.round(60 / w.rpm / TICK) * TICK * 1000;
      if (this.lastShotSlot === this.slot) {
        const q = (now - this.lastShotAt) / interval;
        pump = Math.max(
          pump,
          smooth(0.22, 0.42, q) * (1 - smooth(0.55, 0.78, q)),
        );
      }
      const r = (now - this.rackAt) / 380;
      pump = Math.max(pump, smooth(0, 0.35, r) * (1 - smooth(0.55, 1, r)));
      model.pump.position.z = -0.29 + 0.075 * pump;
      rx += 0.05 * pump;
      pz += 0.01 * pump;
    }
    // Switch / respawn raise.
    py -= 0.3 * hidden;
    rx -= 0.9 * hidden;
    rz += 0.25 * hidden;
    // Shot kick.
    pz += this.kickBack.x;
    py += this.kickUp.x * 0.02;
    rx += this.kickPitch.x;
    rz += this.kickRoll.x * 0.25;
    ry += this.kickYaw.x * 0.2;
    root.position.set(px, py, pz);
    root.rotation.set(rx, ry, rz);
    // Moving parts.
    if (model.slide) {
      const ammo = c.ammo[this.slot];
      const locked = !!ammo && ammo.mag === 0 && (c.reload === 0 || rp < 0.8);
      model.slide.position.z = Math.max(
        locked ? 0.03 : 0,
        Math.max(0, this.slideKick.x) * 0.03,
      );
    }
    if (model.mag && model.magHome) {
      let drop = 0;
      let visible = true;
      if (c.reload > 0 && model.reload === 'mag') {
        if (rp < 0.3) drop = Math.pow(smooth(0.1, 0.3, rp), 1.6) * 0.32;
        else if (rp < 0.5) visible = false;
        else drop = (1 - smooth(0.5, 0.72, rp)) * 0.24;
      }
      model.mag.visible = visible;
      model.mag.position.set(
        model.magHome.x,
        model.magHome.y - drop,
        model.magHome.z + drop * 0.25,
      );
    }
    if (model.shell) {
      const show = c.reload > 0 && rp > 0.08 && rp < 0.86;
      model.shell.visible = show;
      if (show) {
        const k = smooth(0.15, 0.78, rp);
        model.shell.position.set(
          0.05 * (1 - k),
          -0.13 + 0.1 * k,
          0.04 - 0.09 * k,
        );
        model.shell.rotation.set(0.9 * (1 - k), 0, 0.5 * (1 - k));
      }
    }
    // Flash: visible for one or two frames.
    this.flashGroup.visible =
      now < this.flashUntil && this.flashGroup.parent === root;
    // DMR: the scope overlay replaces the weapon when fully aimed.
    this.scoped =
      this.slot === 3 && ads > 0.92 && c.reload === 0 && hidden < 0.05;
    this.visible = !this.scoped;
    this.camera.fov = 62 - 6 * ads;
    root.updateMatrixWorld(true);
    this.active = model;
  }
  /** The muzzle as a world-space point that appears where the viewmodel muzzle is
   * drawn: projected by the viewmodel camera, unprojected by the world camera. */
  muzzleWorld(camera: THREE.PerspectiveCamera, out: THREE.Vector3) {
    const model = this.models[this.slot];
    if (!model) return out.setFromMatrixPosition(camera.matrixWorld);
    out.copy(model.muzzle);
    model.root.localToWorld(out);
    const distance = Math.max(0.3, out.length());
    out.project(this.camera);
    out.z = 0.5;
    out.unproject(camera);
    const origin = this.tmp.setFromMatrixPosition(camera.matrixWorld);
    return out.sub(origin).normalize().multiplyScalar(distance).add(origin);
  }
  render(renderer: THREE.WebGLRenderer, environment: THREE.Texture | null) {
    if (!this.visible) return;
    const size = renderer.getSize(this.size);
    const aspect = size.x / Math.max(1, size.y);
    if (
      Math.abs(this.camera.aspect - aspect) > 1e-4 ||
      this.lastFov !== this.camera.fov
    ) {
      this.camera.aspect = aspect;
      this.lastFov = this.camera.fov;
      this.camera.updateProjectionMatrix();
    }
    this.scene.environment = environment;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
  private size = new THREE.Vector2();
  private lastFov = 0;
  /** Visible viewmodel meshes (for perf reports; not called per frame). */
  drawCalls() {
    let calls = 0;
    if (this.visible && this.active)
      this.active.root.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) calls++;
      });
    return calls;
  }
  reset() {
    this.slot = -1;
    this.previous = -1;
    this.visible = false;
    this.scoped = false;
    this.lastReload = 0;
    this.reloadPose = 0;
    this.flashUntil = 0;
    for (const s of [
      this.kickBack,
      this.kickUp,
      this.kickPitch,
      this.kickRoll,
      this.kickYaw,
      this.slideKick,
    ])
      s.reset();
  }
}
