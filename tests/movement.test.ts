import { describe, it, expect } from 'vitest';
import {
  BUTTON,
  FLAG,
  MOTION,
  MOVE,
  PHYSICS,
  makeEntity,
  moveMode,
  predictionMatches,
  reconcile,
  stepPlayer,
} from '@leviathan/shared';
import { spatialWorld } from '../packages/shared/src/spatial-grid';
import { stairRun } from '../packages/shared/src/stairs';
import type { Box, Entity, Input, World } from '@leviathan/shared';
const DT = 1 / 60;
const { jump: J, sprint: S, crouch: C } = BUTTON;
const floor: Box = {
  min: { x: -300, y: -1, z: -300 },
  max: { x: 300, y: 0, z: 300 },
};
const world = (...boxes: Box[]): World => spatialWorld(0, [floor, ...boxes]);
const at = (x: number, y: number, z: number): Entity => ({
  ...makeEntity('m'),
  position: { x, y, z },
});
type Script = (t: number, s: Entity) => Partial<Input>;
function run(
  w: World,
  start: Entity,
  ticks: number,
  script: Script = () => ({}),
) {
  const states: Entity[] = [];
  let s = start;
  for (let t = 0; t < ticks; t++) {
    s = stepPlayer(
      s,
      {
        seq: t + 1,
        tick: t,
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        buttons: 0,
        ...script(t, s),
      },
      DT,
      w,
    );
    states.push(s);
  }
  return states;
}
const mode = (s: Entity) => s.move?.mode ?? 'GROUND';
const speed = (s: Entity) => Math.hypot(s.velocity.x, s.velocity.z);
const first = (states: Entity[], m: string, from = 0) =>
  states.findIndex((s, t) => t >= from && mode(s) === m);
const flat = world();
const runWall = (id = 'wall', flags: Partial<Box> = { wallRunnable: true }) =>
  ({
    id,
    ...flags,
    min: { x: 1, y: 0, z: -80 },
    max: { x: 2, y: 8, z: 10 },
  }) as Box;
/** Sprint along -z beside a wall at x=1, jump, air-jump at the apex, steer in. */
function wallApproach(w: World, extra: Script = () => ({})): Entity[] {
  let apex = -1;
  return run(w, at(0.2, 0, 8), 260, (t, s) => {
    if (apex < 0 && t > 42 && s.velocity.y <= 0) apex = t;
    const press =
      (t >= 40 && t < 42) || (apex >= 0 && t >= apex && t < apex + 2);
    const base = {
      z: 1,
      x: apex >= 0 && mode(s) === 'AIR' ? 1 : 0,
      buttons: S | (press ? J : 0),
    };
    const e = extra(t, s);
    return {
      ...base,
      ...e,
      buttons: (base.buttons | (e.buttons ?? 0)) & ~(e.buttons === 0 ? J : 0),
    };
  });
}
describe('movement state transitions', () => {
  it('ground to slide from a sprint plus crouch press, and slide to slide-jump', () => {
    const states = run(flat, at(0, 0, 0), 120, (t) => ({
      z: 1,
      buttons: S | (t >= 60 ? C : 0) | (t >= 70 && t < 72 ? J : 0),
    }));
    const slide = first(states, 'SLIDE');
    expect(slide).toBe(60);
    expect(speed(states[slide]!)).toBeGreaterThan(MOVE.sprint);
    expect(mode(states[70]!)).toBe('AIR');
    expect(speed(states[70]!)).toBeGreaterThan(speed(states[69]!));
    expect(states[70]!.velocity.y).toBeGreaterThan(7);
  });
  it('does not slide from a walk or while crouch is merely held', () => {
    const walk = run(flat, at(0, 0, 0), 90, (t) => ({
      z: 1,
      buttons: t >= 60 ? C : 0,
    }));
    expect(walk.some((s) => mode(s) === 'SLIDE')).toBe(false);
    expect(mode(walk.at(-1)!)).toBe('CROUCH');
    const held = run(flat, at(0, 0, 0), 90, () => ({ z: 1, buttons: S | C }));
    expect(held.some((s) => mode(s) === 'SLIDE')).toBe(false);
  });
  it('air to double jump on a fresh press only, once per airtime', () => {
    const held = run(flat, at(0, 0, 0), 60, () => ({ buttons: J }));
    const apex = Math.max(...held.map((s) => s.position.y));
    expect(apex).toBeLessThan(1.35);
    const twice = run(flat, at(0, 0, 0), 120, (t) => ({
      buttons: t < 2 || (t >= 20 && t < 22) || (t >= 40 && t < 42) ? J : 0,
    }));
    expect(twice[20]!.move!.airJumps).toBe(0);
    expect(twice[20]!.velocity.y).toBeGreaterThan(6);
    // Third press (no air jump left) does not change vertical speed.
    expect(twice[40]!.velocity.y).toBeCloseTo(
      twice[39]!.velocity.y - MOVE.gravity * DT,
      9,
    );
  });
  it('air to wall-run on a runnable wall, then wall-jump away restoring an air jump', () => {
    const w = world(runWall());
    let latch = -1;
    const states = wallApproach(w, (t, s) => {
      if (latch < 0 && mode(s) === 'WALLRUN') latch = t;
      return latch >= 0 && t >= latch + 20 && t < latch + 22
        ? { buttons: J }
        : {};
    });
    const run0 = first(states, 'WALLRUN');
    expect(run0).toBeGreaterThan(0);
    expect(states[run0]!.move!.wall!.id).toBe('wall');
    expect(states[run0]!.motion! & MOTION.mode).toBe(4);
    const jump = run0 + 21;
    const kick = states[jump]!;
    expect(mode(kick)).toBe('AIR');
    expect(kick.velocity.x).toBeLessThan(-4.5);
    expect(kick.velocity.y).toBeGreaterThan(6.5);
    expect(kick.move!.airJumps).toBe(1);
    expect(kick.move!.lockouts.map((l) => l.id)).toContain('wall');
  });
  it('air to mantle on a flagged ledge, landing on top with forward momentum', () => {
    const w = world({
      id: 'ledge',
      mantleable: true,
      min: { x: -2, y: 0, z: -4 },
      max: { x: 2, y: 1.5, z: -2 },
    });
    const states = run(w, at(0, 0, -1.4), 90, (t) => ({
      z: 1,
      buttons: t < 2 ? J : 0,
    }));
    // The jump press beside the ledge already counts as "jumping": the grab can start at once.
    const m = first(states, 'MANTLE');
    expect(m).toBeGreaterThanOrEqual(0);
    const done = states.findIndex((s, t) => t > m && mode(s) !== 'MANTLE');
    expect(done - m).toBe(Math.round(MOVE.mantleTime / DT));
    expect(states[done]!.position.y).toBe(1.5);
    expect(states[done]!.position.z).toBeLessThan(-2 - PHYSICS.radius);
    expect(-states[done]!.velocity.z).toBeGreaterThan(4);
    // The climb never intersects the ledge.
    for (const s of states.slice(m, done))
      expect(
        s.position.z - PHYSICS.radius >= -2 - 1e-9 ||
          s.position.y >= 1.5 - 1e-9,
      ).toBe(true);
  });
  it('mantle cancels on a crouch press and drops back down', () => {
    const w = world({
      id: 'ledge',
      mantleable: true,
      min: { x: -2, y: 0, z: -4 },
      max: { x: 2, y: 2.2, z: -2 },
    });
    let m = -1;
    const states = run(w, at(0, 0, -1.4), 120, (t, s) => {
      if (m < 0 && mode(s) === 'MANTLE') m = t;
      return {
        z: 1,
        buttons: (t < 2 ? J : 0) | (m >= 0 && t >= m + 5 ? C : 0),
      };
    });
    expect(m).toBeGreaterThan(0);
    expect(mode(states[m + 4]!)).toBe('MANTLE');
    expect(mode(states[m + 5]!)).toBe('AIR');
    expect(states.at(-1)!.position.y).toBe(0);
    expect(states.some((s) => s.position.y >= 2.2)).toBe(false);
  });
});
describe('timers, lockouts and buffering', () => {
  it('enforces the slide cooldown after a slide ends', () => {
    const states = run(flat, at(0, 0, 0), 200, (t) => ({
      z: 1,
      buttons:
        S | ((t >= 60 && t < 70) || (t >= 72 && t < 80) || t >= 110 ? C : 0),
    }));
    expect(mode(states[60]!)).toBe('SLIDE');
    expect(mode(states[72]!)).not.toBe('SLIDE');
    expect(states[70]!.move!.slideCooldown).toBe(
      Math.round(MOVE.slideCooldown / DT),
    );
  });
  it('locks the same wall out for 1.2 s but lets a different wall chain', () => {
    const w = world(runWall());
    let latch = -1;
    const states = wallApproach(w, (t, s) => {
      if (latch < 0 && mode(s) === 'WALLRUN') latch = t;
      // Wall-jump, then steer straight back into the same wall.
      if (latch >= 0 && t >= latch + 10 && t < latch + 12)
        return { buttons: J };
      return latch >= 0 && t > latch + 12 ? { x: 1 } : {};
    });
    const again = states.findIndex(
      (s, t) => t > latch + 12 && mode(s) === 'WALLRUN',
    );
    expect(again).toBe(-1);
    // Two parallel walls: run on one, jump across, latch the other.
    const pair = world(runWall('a'), {
      id: 'b',
      wallRunnable: true,
      min: { x: -4, y: 0, z: -80 },
      max: { x: -3, y: 8, z: 10 },
    });
    latch = -1;
    const chained = wallApproach(pair, (t, s) => {
      if (latch < 0 && mode(s) === 'WALLRUN') latch = t;
      if (latch >= 0 && t >= latch + 10 && t < latch + 12)
        return { buttons: J };
      return latch >= 0 && t > latch + 12 ? { x: -1 } : {};
    });
    const second = chained.findIndex(
      (s, t) => t > latch + 12 && mode(s) === 'WALLRUN',
    );
    expect(second).toBeGreaterThan(0);
    expect(chained[second]!.move!.wall!.id).toBe('b');
  });
  it('clears lockouts on touching the ground', () => {
    const w = world(runWall());
    const states = wallApproach(w, (t, s) =>
      mode(s) === 'WALLRUN' ? { buttons: C } : {},
    );
    const off = states.findIndex(
      (s, t) => t > 0 && s.move!.lockouts.length > 0,
    );
    expect(off).toBeGreaterThan(0);
    const landed = states.findIndex((s, t) => t > off && mode(s) === 'GROUND');
    expect(states[landed]!.move!.lockouts).toEqual([]);
  });
  it('allows a coyote jump for 0.10 s after leaving a ledge, not after', () => {
    const w = spatialWorld(-20, [
      { min: { x: -5, y: -1, z: -10 }, max: { x: 5, y: 0, z: 10 } },
    ]);
    const leave = (delay: number) => {
      let off = -1;
      return run(w, at(0, 0, -8), 120, (t, s) => {
        if (off < 0 && mode(s) === 'AIR') off = t;
        return { z: 1, buttons: off >= 0 && t === off + delay ? J : 0 };
      });
    };
    // A coyote jump is a ground jump; a late press spends the air jump instead.
    const pressed = (states: Entity[]) => states.find((s) => s.velocity.y > 0)!;
    const ok = pressed(leave(4)),
      late = pressed(leave(8));
    expect(ok.move!.airJumps).toBe(1);
    expect(ok.velocity.y).toBeGreaterThan(7.5);
    expect(late.move!.airJumps).toBe(0);
    expect(late.velocity.y).toBeLessThan(7.5);
  });
  it('buffers a jump pressed just before landing, but not too early', () => {
    // Falling with the air jump already spent, so a press can only be buffered.
    const falling = (): Entity => {
      const s = at(0, 3, 0);
      const settled = stepPlayer(
        s,
        { seq: 0, tick: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
        DT,
        flat,
      );
      return {
        ...settled,
        flags: 0,
        move: { ...settled.move!, mode: 'AIR', airJumps: 0, coyote: 0 },
      };
    };
    const drop = (early: number) => {
      const states = run(flat, falling(), 120);
      const land = states.findIndex((s) => mode(s) === 'GROUND');
      const again = run(flat, falling(), 120, (t) => ({
        buttons: t === land - early ? J : 0,
      }));
      return Math.max(...again.slice(land).map((s) => s.position.y));
    };
    expect(drop(5)).toBeGreaterThan(1);
    expect(drop(10)).toBe(0);
  });
});
describe('hull, collision and flags', () => {
  it('stays crouched under a low ceiling and stands once clear', () => {
    const w = world({
      min: { x: -3, y: 1.2, z: -6 },
      max: { x: 3, y: 1.6, z: 6 },
    });
    const crouched = run(w, at(0, 0, 0), 10, () => ({ buttons: C }));
    expect(crouched.at(-1)!.move!.crouched).toBe(true);
    const released = run(w, crouched.at(-1)!, 30, () => ({}));
    expect(released.every((s) => s.move!.crouched)).toBe(true);
    const out = run(w, crouched.at(-1)!, 200, () => ({ z: -1 }));
    expect(out.at(-1)!.move!.crouched).toBe(false);
    expect(out.at(-1)!.position.z).toBeGreaterThan(6.4);
  });
  it('never wall-runs an unflagged wall or mantles an unflagged ledge', () => {
    const plain = world(runWall('plain', {}));
    expect(wallApproach(plain).some((s) => mode(s) === 'WALLRUN')).toBe(false);
    const ledge = world({
      id: 'ledge',
      min: { x: -2, y: 0, z: -4 },
      max: { x: 2, y: 1.5, z: -2 },
    });
    const states = run(ledge, at(0, 0, -1.4), 90, (t) => ({
      z: 1,
      buttons: t < 2 ? J : 0,
    }));
    expect(states.some((s) => mode(s) === 'MANTLE')).toBe(false);
    expect(states.at(-1)!.position.y).toBe(0);
  });
  it('cannot climb an unflagged wall by repeated jumping against it', () => {
    const w = world({
      min: { x: -5, y: 0, z: -3 },
      max: { x: 5, y: 10, z: -2 },
    });
    const states = run(w, at(0, 0, 0), 600, (t) => ({
      z: 1,
      buttons: S | (t % 3 === 0 ? J : 0),
    }));
    expect(Math.max(...states.map((s) => s.position.y))).toBeLessThan(2.3);
    expect(
      states.every((s) => s.position.z >= -2 + PHYSICS.radius - 1e-9),
    ).toBe(true);
  });
  it('leaves a convex corner without snagging and turns a concave corner', () => {
    const convex = world({
      id: 'a',
      wallRunnable: true,
      min: { x: 1, y: 0, z: -10 },
      max: { x: 2, y: 8, z: 10 },
    });
    const c = wallApproach(convex);
    const start = first(c, 'WALLRUN'),
      end = c.findIndex((s, t) => t > start && mode(s) !== 'WALLRUN');
    expect(start).toBeGreaterThan(0);
    expect(c[end - 1]!.position.z).toBeLessThan(-9);
    expect(speed(c[end]!)).toBeGreaterThan(speed(c[end - 1]!) - 0.5);
    expect(Math.abs(c[end]!.velocity.x)).toBeLessThan(0.5);
    const concave = world(
      {
        id: 'a',
        wallRunnable: true,
        min: { x: 1, y: 0, z: -12 },
        max: { x: 2, y: 8, z: 10 },
      },
      {
        id: 'b',
        wallRunnable: true,
        min: { x: -20, y: 0, z: -13 },
        max: { x: 2, y: 8, z: -12 },
      },
    );
    const k = wallApproach(concave);
    const turned = k.findIndex((s) => s.move!.wall?.id === 'b');
    expect(turned).toBeGreaterThan(0);
    expect(k[turned]!.velocity.x).toBeLessThan(-5);
    // No jitter: once turned, the run never flips back to the first wall.
    expect(k.slice(turned).some((s) => s.move!.wall?.id === 'a')).toBe(false);
  });
  it('still steps up stairs while walking and crouching', () => {
    const states = run(
      spatialWorld(0, stairRun(1.8)),
      at(0, 0, -1),
      50,
      () => ({ z: -1 }),
    );
    expect(states.at(-1)!.position.y).toBeCloseTo(1.8);
    expect(states.every((s) => s.flags & FLAG.grounded)).toBe(true);
    const crouch = run(
      spatialWorld(0, stairRun(1.8)),
      at(0, 0, -1),
      120,
      () => ({ z: -1, buttons: C }),
    );
    expect(Math.max(...crouch.map((s) => s.position.y))).toBeCloseTo(1.8);
    const top = crouch.findIndex((s) => s.position.y >= 1.8 - 1e-6);
    expect(crouch.slice(0, top + 1).every((s) => mode(s) === 'CROUCH')).toBe(
      true,
    );
  });
  it('is deterministic for identical inputs', () => {
    const w = world(runWall(), {
      id: 'ledge',
      mantleable: true,
      min: { x: -6, y: 0, z: -40 },
      max: { x: 0, y: 1.8, z: -30 },
    });
    const script: Script = (t) => ({
      x: Math.sin(t / 17),
      z: 1,
      yaw: Math.sin(t / 50) * 0.4,
      buttons: S | (t % 90 > 60 ? C : 0) | (t % 47 < 2 ? J : 0),
    });
    expect(run(w, at(0, 0, 0), 900, script)).toEqual(
      run(w, at(0, 0, 0), 900, script),
    );
    const full = { floor: w.floor, boxes: w.boxes };
    expect(run(w, at(0, 0, 0), 900, script)).toEqual(
      run(full, at(0, 0, 0), 900, script),
    );
  });
  it('does not tunnel through thin geometry at the speed cap', () => {
    const fast = { ...MOVE, maxSpeed: 16 };
    let s: Entity = { ...at(0, 0, 0), velocity: { x: 0, y: 0, z: -16 } };
    s.move = {
      ...stepPlayer(
        s,
        { seq: 0, tick: 0, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
        DT,
        flat,
      ).move!,
      mode: 'AIR',
    };
    const wall = world({
      min: { x: -3, y: 0, z: -2.05 },
      max: { x: 3, y: 4, z: -2 },
    });
    s = {
      ...s,
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 0, y: 0, z: -16 },
    };
    for (let t = 0; t < 30; t++) {
      s = stepPlayer(
        s,
        { seq: t, tick: t, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 },
        DT,
        wall,
        fast,
      );
      expect(s.position.z).toBeGreaterThanOrEqual(-2 + PHYSICS.radius - 1e-9);
    }
    // A fast fall onto a 5 cm plate lands on it.
    let f: Entity = { ...at(0, 30, 0), velocity: { x: 0, y: -40, z: 0 } };
    const plate = spatialWorld(-50, [
      { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 0.05, z: 2 } },
    ]);
    for (let t = 0; t < 120; t++)
      f = stepPlayer(
        f,
        { seq: t, tick: t, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
        DT,
        plate,
      );
    expect(f.position.y).toBe(0.05);
  });
  it('gains no energy from wall contact and caps horizontal speed', () => {
    const w = world({
      min: { x: 1, y: 0, z: -80 },
      max: { x: 2, y: 8, z: 10 },
    });
    const states = run(w, at(0, 0, 0), 300, () => ({ x: 1, z: 1, buttons: S }));
    expect(Math.max(...states.map(speed))).toBeLessThanOrEqual(
      MOVE.sprint + 1e-9,
    );
    const capped = stepPlayer(
      { ...at(0, 5, 0), velocity: { x: 30, y: 0, z: 30 } },
      { seq: 1, tick: 1, x: 0, z: 0, yaw: 0, pitch: 0, buttons: 0 },
      DT,
      flat,
    );
    expect(speed(capped)).toBeCloseTo(MOVE.maxSpeed);
  });
  it('replicates compact motion bits and reconciles every sub-state field', () => {
    const w = world(runWall());
    const states = wallApproach(w);
    const wall = states.find((s) => mode(s) === 'WALLRUN')!;
    expect(moveMode(wall.motion)).toBe('WALLRUN');
    expect(!!(wall.motion! & MOTION.wallRight)).toBe(true);
    const slide = run(flat, at(0, 0, 0), 70, (t) => ({
      z: 1,
      buttons: S | (t >= 60 ? C : 0),
    })).at(-1)!;
    expect(slide.motion! & (MOTION.slide | MOTION.crouch)).toBe(
      MOTION.slide | MOTION.crouch,
    );
    const altered = structuredClone(wall);
    altered.move!.wall!.ticks++;
    expect(predictionMatches(wall, structuredClone(wall))).toBe(true);
    expect(predictionMatches(wall, altered)).toBe(false);
    // Replaying pending inputs from any authoritative mid-traversal state is exact.
    const inputs: Input[] = Array.from({ length: 240 }, (_, t) => ({
      seq: t + 1,
      tick: t,
      x: t > 40 && t < 60 ? 1 : 0,
      z: 1,
      yaw: 0,
      pitch: 0,
      buttons:
        S |
        ((t >= 40 && t < 42) || (t >= 70 && t < 72) || (t >= 120 && t < 122)
          ? J
          : 0),
    }));
    let server = at(0.2, 0, 8);
    const history: Entity[] = [];
    for (const i of inputs)
      history.push((server = stepPlayer(server, i, DT, w)));
    for (const ack of [30, 61, 95, 150]) {
      const result = reconcile(history[ack - 1]!, ack, inputs, DT, w);
      expect(result.state).toEqual(history.at(-1));
    }
  });
});
