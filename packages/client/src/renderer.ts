import * as THREE from 'three';
import { CONFIG, FLAG, METRICS } from '@leviathan/shared';
import { WorldView } from './world';
import { graphics } from './graphics';
import type { Entity, Snapshot, Vec3 } from '@leviathan/shared';
interface Avatar {
  group: THREE.Group;
  body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite;
  name: string;
}
export class Renderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
  renderer: THREE.WebGLRenderer;
  avatars = new Map<string, Avatar>();
  snapshots: Snapshot[] = [];
  offset = 0;
  world?: WorldView;
  private loadVersion = 0;
  private loading = document.createElement('section');
  private cameraY = NaN;
  private cameraAt = performance.now();
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
      '<div class="eyebrow">KAINOS // ENVIRONMENT UPLINK</div><h2>FOUNDRY ROW</h2><p>PREPARING DISTRICT</p><progress max="1" value="0.05"></progress>';
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
  render(
    local: Entity | undefined,
    localId: string,
    names: Map<string, string>,
    correction: Vec3,
  ) {
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
          v = { group, body, label, name };
          this.avatars.set(e.id, v);
        }
        const from = a.entities.find((x) => x.id === e.id) ?? e;
        const to = b.entities.find((x) => x.id === e.id) ?? e;
        v.group.position.set(
          from.position.x + (to.position.x - from.position.x) * alpha,
          from.position.y + (to.position.y - from.position.y) * alpha,
          from.position.z + (to.position.z - from.position.z) * alpha,
        );
        v.body.material.opacity = e.flags & FLAG.disconnected ? 0.25 : 1;
      }
    }
    if (local && (!this.world || this.world.mode === 'player')) {
      const now = performance.now(),
        targetY = local.position.y + correction.y;
      const stair =
        !!(local.flags & FLAG.grounded) &&
        Number.isFinite(this.cameraY) &&
        Math.abs(targetY - this.cameraY) < 0.8;
      this.cameraY = stair
        ? this.cameraY +
          (targetY - this.cameraY) * (1 - Math.exp(-(now - this.cameraAt) / 95))
        : targetY;
      this.cameraAt = now;
      this.camera.position.set(
        local.position.x + correction.x,
        this.cameraY + METRICS.eye,
        local.position.z + correction.z,
      );
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(local.pitch, local.yaw, 0);
    }
    if (this.world?.ready) this.world.render(this.camera);
  }
}
