import * as THREE from 'three';
import {
  MOTION,
  MOVE,
  PHYSICS,
  getLevel,
  hitShapes,
  levelWorld,
  mantleCandidates,
  moveMode,
  wallCandidates,
} from '@leviathan/shared';
import type { CombatEvent, Entity, MoveTuning } from '@leviathan/shared';
import type { DrawFlags } from './dev-panel';
export class DebugDraw {
  levelId = 'foundry-row';
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  tuning: MoveTuning = MOVE;
  private speeds: { at: number; speed: number }[] = [];
  /** Server hit-debug events (rays and lag-compensation rewind boxes), kept 2 s. */
  private shots: { at: number; e: Extract<CombatEvent, { t: 'debug' }> }[] = [];
  hitDebug(events: CombatEvent[]) {
    const now = performance.now();
    for (const e of events)
      if (e.t === 'debug') this.shots.push({ at: now, e });
    while (this.shots.length && now - this.shots[0]!.at > 2000)
      this.shots.shift();
    if (this.shots.length > 64) this.shots.splice(0, this.shots.length - 64);
  }
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
    const c = this.ctx,
      now = performance.now();
    if (predicted) {
      this.speeds.push({
        at: now,
        speed: Math.hypot(predicted.velocity.x, predicted.velocity.z),
      });
      while (this.speeds.length && now - this.speeds[0]!.at > 10000)
        this.speeds.shift();
    }
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
    const box = (min: THREE.Vector3Like, max: THREE.Vector3Like) => {
      const corners = Array.from({ length: 8 }, (_, i) =>
        project(
          i & 1 ? max.x : min.x,
          i & 2 ? max.y : min.y,
          i & 4 ? max.z : min.z,
        ),
      );
      for (let i = 0; i < 8; i++)
        for (const bit of [1, 2, 4])
          if (!(i & bit)) line(corners[i]!, corners[i | bit]!);
    };
    c.lineWidth = 2;
    c.strokeStyle = '#d3d9db';
    c.fillStyle = '#d3d9db';
    c.font = '12px monospace';
    if (flags.colliders)
      for (const b of levelWorld(getLevel(this.levelId)).boxes)
        box(b.min, b.max);
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
    if (flags.hitboxes) {
      // Current hit shapes from the latest snapshot (body grey, head pale).
      for (const e of entities) {
        if (e.type !== 'player' && e.type !== 'robot') continue;
        const crouched =
          !!((e.motion ?? 0) & MOTION.crouch) || moveMode(e.motion) === 'SLIDE';
        for (const shape of hitShapes(e.position, crouched)) {
          c.strokeStyle = shape.zone === 'head' ? '#e8e2c8' : '#7d8b92';
          box(shape.min, shape.max);
        }
      }
    }
    if (flags.hitRays) {
      const age = (at: number) => 1 - (now - at) / 2000;
      for (const { at, e } of this.shots) {
        c.globalAlpha = Math.max(0.15, age(at));
        c.strokeStyle = '#d9c27a';
        for (const end of e.ends)
          line(
            project(e.origin.x, e.origin.y, e.origin.z),
            project(end.x, end.y, end.z),
          );
        // Where the server rewound each target for this shot.
        c.strokeStyle = '#d97a5a';
        for (const b of e.boxes) box(b.min, b.max);
        const o = project(e.origin.x, e.origin.y, e.origin.z);
        if (o.visible)
          c.fillText(
            `REWIND ${((e.tick - e.rewindTick) * (1000 / 60)).toFixed(0)} MS`,
            o.x + 6,
            o.y - 6,
          );
      }
      c.globalAlpha = 1;
    }
    if (flags.movement && predicted)
      this.movement(camera, predicted, project, line, box);
    if (flags.speedGraph) this.graph();
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
  /** State label, velocity arrow, wall/mantle probes and ground contact for the local operator. */
  private movement(
    camera: THREE.Camera,
    e: Entity,
    project: (
      x: number,
      y: number,
      z: number,
    ) => { x: number; y: number; visible: boolean },
    line: (
      a: ReturnType<typeof project>,
      b: ReturnType<typeof project>,
    ) => void,
    box: (min: THREE.Vector3Like, max: THREE.Vector3Like) => void,
  ) {
    const c = this.ctx,
      m = e.move,
      p = e.position,
      r = PHYSICS.radius;
    const world = levelWorld(getLevel(this.levelId));
    const near =
      world.query?.(p.x - 2.5, p.z - 2.5, p.x + 2.5, p.z + 2.5) ?? world.boxes;
    // Velocity arrow anchored two metres ahead of the eye so it is always in view.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const anchor = camera.position
      .clone()
      .addScaledVector(forward, 2)
      .add(new THREE.Vector3(0, -0.45, 0));
    c.strokeStyle = '#d3d9db';
    c.lineWidth = 2;
    const tip = anchor
      .clone()
      .addScaledVector(
        new THREE.Vector3(e.velocity.x, e.velocity.y, e.velocity.z),
        0.08,
      );
    line(project(anchor.x, anchor.y, anchor.z), project(tip.x, tip.y, tip.z));
    // Wall probe rays at chest height and the contact normal.
    c.strokeStyle = '#8a98a1';
    c.lineWidth = 1;
    const chest = p.y + 1;
    for (const w of wallCandidates(near, p, 1.2)) {
      const hit = { x: p.x, z: p.z };
      hit[w.axis] = w.plane;
      line(project(p.x, chest, p.z), project(hit.x, chest, hit.z));
      const n = { x: 0, z: 0 };
      n[w.axis] = -w.dir * 0.6;
      c.strokeStyle = m?.wall?.id === w.box.id ? '#d3d9db' : '#8a98a1';
      c.lineWidth = m?.wall?.id === w.box.id ? 3 : 1;
      line(
        project(hit.x, chest, hit.z),
        project(hit.x + n.x, chest, hit.z + n.z),
      );
    }
    // Mantle probe rays along the facing cone and candidate targets.
    const facing = { x: -Math.sin(e.yaw), z: -Math.cos(e.yaw) };
    c.strokeStyle = '#8a98a1';
    c.lineWidth = 1;
    for (const h of [0.6, 1.45, 2.3])
      line(
        project(p.x, p.y + h, p.z),
        project(
          p.x + facing.x * (r + this.tuning.mantleReach),
          p.y + h,
          p.z + facing.z * (r + this.tuning.mantleReach),
        ),
      );
    const target = m?.mantle?.to;
    const candidates = target
      ? []
      : mantleCandidates(near, p, facing, this.tuning);
    c.strokeStyle = '#c9b458';
    c.lineWidth = 2;
    for (const t of target
      ? [target]
      : candidates.slice(0, 1).map((m) => m.target))
      box(
        { x: t.x - r, y: t.y, z: t.z - r },
        { x: t.x + r, y: t.y + 0.05, z: t.z + r },
      );
    // Ground contact cross under the feet.
    const grounded = m ? ['GROUND', 'CROUCH', 'SLIDE'].includes(m.mode) : true;
    c.strokeStyle = grounded ? '#d3d9db' : '#4b4137';
    c.lineWidth = 2;
    line(project(p.x - r, p.y + 0.01, p.z), project(p.x + r, p.y + 0.01, p.z));
    line(project(p.x, p.y + 0.01, p.z - r), project(p.x, p.y + 0.01, p.z + r));
    // State label.
    const rows = [
      `STATE ${m?.mode ?? 'GROUND'}${m?.crouched ? ' / CROUCHED' : ''}`,
      `SPEED ${Math.hypot(e.velocity.x, e.velocity.z).toFixed(2)} m/s  VY ${e.velocity.y.toFixed(2)}`,
      `CONTACT ${grounded ? 'GROUND' : 'AIR'}  AIR JUMPS ${m?.airJumps ?? 1}`,
      `COYOTE ${m?.coyote ?? 0}  BUFFER ${m?.buffer ?? 0}`,
      `SLIDE ${m?.slideTicks ?? 0}t  COOLDOWN ${m?.slideCooldown ?? 0}t`,
      m?.wall
        ? `WALL ${m.wall.id} ${m.wall.axis}${m.wall.dir > 0 ? '+' : '-'} ${m.wall.ticks}t`
        : `WALL — LOCKOUTS ${m?.lockouts.length ?? 0}`,
      m?.mantle
        ? `MANTLE ${m.mantle.ticks}/${m.mantle.total}t`
        : `MANTLE TARGETS ${candidates.length}`,
    ];
    const left = 24,
      top = innerHeight - 224 - rows.length * 16 - 24;
    c.fillStyle = '#0a0e11';
    c.fillRect(left, top, 320, rows.length * 16 + 16);
    c.strokeStyle = '#d3d9db';
    c.lineWidth = 2;
    c.strokeRect(left, top, 320, rows.length * 16 + 16);
    c.fillStyle = '#d3d9db';
    c.font = '11px "IBM Plex Mono", monospace';
    rows.forEach((row, i) => c.fillText(row, left + 10, top + 20 + i * 16));
  }
  /** Horizontal speed over the last ten seconds, with walk/sprint/slide-cap guides. */
  private graph() {
    const c = this.ctx,
      w = 280,
      h = 96,
      left = innerWidth - w - 24,
      top = innerHeight - h - 24,
      now = performance.now(),
      max = 16;
    c.fillStyle = '#0a0e11';
    c.fillRect(left, top, w, h);
    c.strokeStyle = '#3a4a56';
    c.lineWidth = 1;
    for (const v of [5, 8, 11]) {
      const y = top + h - (v / max) * h;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(left + w, y);
      c.stroke();
    }
    c.strokeStyle = '#d3d9db';
    c.lineWidth = 2;
    c.beginPath();
    this.speeds.forEach((s, i) => {
      const x = left + w - ((now - s.at) / 10000) * w,
        y = top + h - (Math.min(max, s.speed) / max) * h;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
    c.strokeRect(left, top, w, h);
    c.fillStyle = '#8a98a1';
    c.font = '10px "IBM Plex Mono", monospace';
    c.fillText('SPEED / 10 S  (5 · 8 · 11 M/S)', left + 8, top + 14);
  }
}
