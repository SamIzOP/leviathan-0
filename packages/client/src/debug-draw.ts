import * as THREE from 'three';
import { getLevel, levelWorld } from '@leviathan/shared';
import type { Entity } from '@leviathan/shared';
import type { DrawFlags } from './dev-panel';
export class DebugDraw {
  levelId = 'foundry-row';
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  constructor() {
    this.canvas.id = 'debug-draw';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }
  render(
    camera: THREE.Camera,
    entities: Entity[],
    localId: string,
    flags: DrawFlags,
    enabled: boolean,
    predicted?: Entity,
  ) {
    const c = this.ctx;
    if (!enabled || !Object.values(flags).some(Boolean)) {
      this.canvas.hidden = true;
      return;
    }
    this.canvas.hidden = false;
    if (
      this.canvas.width !== innerWidth ||
      this.canvas.height !== innerHeight
    ) {
      this.canvas.width = innerWidth;
      this.canvas.height = innerHeight;
    }
    c.clearRect(0, 0, innerWidth, innerHeight);
    camera.updateMatrixWorld();
    const project = (x: number, y: number, z: number) => {
      const p = new THREE.Vector3(x, y, z).project(camera);
      return {
        x: ((p.x + 1) * innerWidth) / 2,
        y: ((1 - p.y) * innerHeight) / 2,
        visible: p.z >= -1 && p.z <= 1,
      };
    };
    const line = (
      a: ReturnType<typeof project>,
      b: ReturnType<typeof project>,
    ) => {
      if (!a.visible || !b.visible) return;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    };
    c.lineWidth = 2;
    c.strokeStyle = '#d3d9db';
    c.fillStyle = '#d3d9db';
    c.font = '12px monospace';
    if (flags.colliders)
      for (const box of levelWorld(getLevel(this.levelId)).boxes) {
        const corners = Array.from({ length: 8 }, (_, i) =>
          project(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ),
        );
        for (let i = 0; i < 8; i++)
          for (const bit of [1, 2, 4])
            if (!(i & bit)) line(corners[i]!, corners[i | bit]!);
      }
    for (const e of entities) {
      const p = e.position;
      if (
        (e.id === localId && flags.ghost) ||
        (e.id !== localId && flags.raw)
      ) {
        c.strokeStyle = e.id === localId ? '#d3d9db' : '#8a98a1';
        const a = project(p.x - 0.35, p.y, p.z),
          b = project(p.x + 0.35, p.y + 1.8, p.z);
        if (a.visible && b.visible) {
          c.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
          c.fillText(
            e.id === localId ? 'SERVER / SELF' : 'RAW SNAPSHOT',
            a.x,
            b.y - 8,
          );
        }
      }
      if (flags.velocity) {
        c.strokeStyle = '#d3d9db';
        line(
          project(p.x, p.y + 0.8, p.z),
          project(
            p.x + e.velocity.x * 0.3,
            p.y + 0.8 + e.velocity.y * 0.3,
            p.z + e.velocity.z * 0.3,
          ),
        );
      }
    }
    // The first-person camera sits inside the player's capsule. A top-down inset
    // keeps the authoritative ghost visible even when it lies behind the camera.
    const self = entities.find((e) => e.id === localId);
    if (flags.ghost && self && predicted) {
      const left = 24,
        top = innerHeight - 224,
        size = 192;
      const dx = self.position.x - predicted.position.x;
      const dz = self.position.z - predicted.position.z;
      const scale = Math.min(24, 64 / Math.max(1, Math.abs(dx), Math.abs(dz)));
      const x = left + size / 2,
        y = top + 104;
      c.fillStyle = '#0a0e11';
      c.fillRect(left, top, size, 192);
      c.strokeStyle = '#d3d9db';
      c.strokeRect(left, top, size, 192);
      c.fillStyle = '#d3d9db';
      c.font = '10px "IBM Plex Mono", monospace';
      c.fillText('SELF / TOP VIEW', left + 12, top + 20);
      c.fillText('SOLID: CLIENT', left + 12, top + 40);
      c.fillText('OUTLINE: SERVER', left + 12, top + 56);
      c.fillRect(x - 3, y - 3, 6, 6);
      c.strokeRect(x + dx * scale - 8, y + dz * scale - 8, 16, 16);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + dx * scale, y + dz * scale);
      c.stroke();
      const delta = Math.hypot(dx, dz, self.position.y - predicted.position.y);
      c.fillText(`DELTA ${delta.toFixed(3)}m`, left + 12, top + 174);
    }
  }
}
