import * as THREE from 'three';
import { CONFIG, FLAG, MOTION, moveMode } from '@leviathan/shared';
import { WorldView } from './world';
import { graphics } from './graphics';
import { CameraFeel } from './camera-feel';
import type { Entity, Snapshot, Vec3 } from '@leviathan/shared';
/** Placeholder pose parameters, eased per avatar from the compact motion bits. */
interface Pose {
  height: number;
  lean: number;
  side: number;
  stretch: number;
  heading: number;
}
interface Avatar {
  group: THREE.Group;
  body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite;
  name: string;
  pose: Pose;
}
export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
  renderer: THREE.WebGLRenderer;
  avatars = new Map<string, Avatar>();
  snapshots: Snapshot[] = [];
  offset = 0;
  world?: WorldView;
  feel = new CameraFeel();
  private loadVersion = 0;
  private loading = document.createElement('section');
  private cameraY = NaN;
  private cameraAt = performance.now();
  private poseAt = performance.now();
  setLevel(id?: string, seed?: number) {
    if (id && this.world?.level.id === id && this.world.level.seed === seed)
      return;
    ++this.loadVersion;
    const version = this.loadVersion;
    this.world?.dispose();
    this.world = undefined;
    if (!id) {
      this.loading.hidden = true;
      return;
    }
    this.loading.className = 'world-loading slab';
    this.loading.innerHTML =
      '<div class="eyebrow">KAINOS // ENVIRONMENT UPLINK</div><h2></h2><p>PREPARING DISTRICT</p><progress max="1" value="0.05"></progress>';
    this.loading.querySelector('h2')!.textContent =
      id === 'movement-lab' ? 'MOVEMENT LAB' : 'FOUNDRY ROW';
    this.loading.hidden = false;
    if (!this.loading.isConnected) document.body.append(this.loading);
    setTimeout(() => {
      if (version !== this.loadVersion) return;
      const world = new WorldView(this.renderer, this.scene, id, seed);
      this.world = world;
      void world
        .prepare((v) => {
          if (version === this.loadVersion)
            this.loading.querySelector('progress')!.value = v;
        })
        .then(() => {
          if (version === this.loadVersion) this.loading.hidden = true;
        });
    }, 0);
  }
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.position.set(14, 12, 18);
    this.camera.lookAt(0, 0, 0);
    addEventListener('resize', () => this.resize());
    this.resize();
    addEventListener('graphicschange', () => {
      if (this.world && graphics.quality !== 'AUTO')
        this.world.changePreset(graphics.quality);
    });
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.world?.resize();
  }
  push(s: Snapshot) {
    if (this.snapshots.length && s.tick <= this.snapshots.at(-1)!.tick) return;
    const sample = Date.now() - s.time;
    this.offset = this.snapshots.length
      ? this.offset * 0.95 + sample * 0.05
      : sample;
    this.snapshots.push(s);
    if (this.snapshots.length > 60) this.snapshots.shift();
  }
  label(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#0A0E11';
    c.fillRect(0, 0, 512, 64);
    c.strokeStyle = '#D3D9DB';
    c.lineWidth = 3;
    c.strokeRect(2, 2, 508, 60);
    c.fillStyle = '#D3D9DB';
    c.font = '24px "IBM Plex Mono", monospace';
    c.textAlign = 'center';
    c.fillText(name, 256, 40);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true }),
    );
    sprite.scale.set(3, 0.375, 1);
    sprite.position.y = 2.2;
    return sprite;
  }
  /** Lower hull when crouched/sliding, lean back in a slide, lean toward a wall,
   * quick vertical stretch while mantling. Name tags ride above the hull. */
  private pose(v: Avatar, e: Entity, dt: number) {
    const bits = e.motion ?? 0,
      mode = moveMode(bits);
    const speed = Math.hypot(e.velocity.x, e.velocity.z);
    const target: Pose = {
      height: bits & MOTION.crouch ? 1 / 1.8 : 1,
      lean: bits & MOTION.slide ? 0.45 : 0,
      side: mode === 'WALLRUN' ? (bits & MOTION.wallRight ? -0.28 : 0.28) : 0,
      stretch: mode === 'MANTLE' ? 1 : 0,
      heading:
        bits & MOTION.slide && speed > 0.5
          ? Math.atan2(-e.velocity.x, -e.velocity.z)
          : e.yaw,
    };
    const k = 1 - Math.exp(-dt / 0.08);
    const p = v.pose;
    p.height += (target.height - p.height) * k;
    p.lean += (target.lean - p.lean) * k;
    p.side += (target.side - p.side) * k;
    p.stretch += (target.stretch - p.stretch) * (1 - Math.exp(-dt / 0.05));
    let turn = target.heading - p.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    p.heading += turn * k;
    const height = 1.8 * p.height * (1 + 0.12 * p.stretch);
    v.body.scale.set(
      1 - 0.1 * p.stretch,
      p.height * (1 + 0.12 * p.stretch),
      1 - 0.1 * p.stretch,
    );
    v.body.position.y = height / 2;
    v.body.rotation.set(p.lean, p.heading, p.side, 'YXZ');
    v.label.position.y = height + 0.4;
  }
  poses() {
    return [...this.avatars].map(([id, a]) => ({
      id,
      height: a.pose.height,
      lean: a.pose.lean,
      side: a.pose.side,
      stretch: a.pose.stretch,
    }));
  }
  render(
    local: Entity | undefined,
    localId: string,
    names: Map<string, string>,
    correction: Vec3,
  ) {
    const now = performance.now(),
      poseDt = Math.min(0.1, (now - this.poseAt) / 1000);
    this.poseAt = now;
    const latest = this.snapshots.at(-1);
    if (latest) {
      const target = Date.now() - this.offset - CONFIG.interpolationMs;
      let a = this.snapshots[0]!,
        b = latest;
      for (let i = 1; i < this.snapshots.length; i++) {
        if (this.snapshots[i]!.time >= target) {
          a = this.snapshots[i - 1]!;
          b = this.snapshots[i]!;
          break;
        }
      }
      const alpha = Math.max(
        0,
        Math.min(1, (target - a.time) / Math.max(1, b.time - a.time)),
      );
      const ids = new Set(latest.entities.map((e) => e.id));
      for (const [id, v] of this.avatars)
        if (!ids.has(id)) {
          this.scene.remove(v.group);
          v.body.geometry.dispose();
          v.body.material.dispose();
          v.label.material.map?.dispose();
          v.label.material.dispose();
          this.avatars.delete(id);
        }
      for (const e of latest.entities) {
        if (e.id === localId) continue;
        let v = this.avatars.get(e.id);
        const name = names.get(e.id) ?? 'DIAGNOSTIC UNIT';
        if (!v) {
          const group = new THREE.Group();
          const body = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.35, 1.1, 4, 8),
            new THREE.MeshStandardMaterial({
              color: e.type === 'robot' ? '#987c62' : '#a1b4be',
              transparent: true,
            }),
          );
          body.position.y = 0.9;
          const label = this.label(name);
          group.add(body, label);
          this.scene.add(group);
          v = {
            group,
            body,
            label,
            name,
            pose: { height: 1, lean: 0, side: 0, stretch: 0, heading: e.yaw },
          };
          this.avatars.set(e.id, v);
        }
        const from = a.entities.find((x) => x.id === e.id) ?? e;
        const to = b.entities.find((x) => x.id === e.id) ?? e;
        v.group.position.set(
          from.position.x + (to.position.x - from.position.x) * alpha,
          from.position.y + (to.position.y - from.position.y) * alpha,
          from.position.z + (to.position.z - from.position.z) * alpha,
        );
        // Interpolation is unchanged; the pose follows the interpolated sample's bits.
        this.pose(v, alpha < 0.5 ? from : to, poseDt);
        v.body.material.opacity = e.flags & FLAG.disconnected ? 0.25 : 1;
      }
    }
    if (local && (!this.world || this.world.mode === 'player')) {
      const targetY = local.position.y + correction.y;
      const stair =
        !!(local.flags & FLAG.grounded) &&
        Number.isFinite(this.cameraY) &&
        Math.abs(targetY - this.cameraY) < 0.8;
      this.cameraY = stair
        ? this.cameraY +
          (targetY - this.cameraY) * (1 - Math.exp(-(now - this.cameraAt) / 95))
        : targetY;
      this.cameraAt = now;
      this.feel.apply(this.camera, local, {
        x: local.position.x + correction.x,
        y: this.cameraY,
        z: local.position.z + correction.z,
      });
    }
    if (this.world?.ready) this.world.render(this.camera);
  }
}
