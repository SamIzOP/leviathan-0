import { describe, it, expect } from 'vitest';
import {
  LookPipeline,
  interpolatePosition,
} from '../packages/client/src/look-pipeline';
import { AutoQuality } from '../packages/client/src/auto-quality';
import {
  initialMove,
  makeEntity,
  stepPlayer,
} from '../packages/shared/src/movement';
import { MOVE } from '../packages/shared/src/config';
import { reconcile } from '../packages/shared/src/prediction';
import { CameraFeel } from '../packages/client/src/camera-feel';
import { PerspectiveCamera } from 'three';
import type { Entity, Input, World } from '../packages/shared/src/types';
const world: World = {
  floor: 0,
  boxes: [
    {
      id: 'wall',
      wallRunnable: true,
      min: { x: 0, y: 0, z: -30 },
      max: { x: 1, y: 20, z: 30 },
    },
  ],
};
const command: Input = {
  seq: 1,
  tick: 1,
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
};
const player = (): Entity => ({
  ...makeEntity('test'),
  flags: 0,
  position: { x: -0.6, y: 2, z: 0 },
  velocity: { x: 1, y: 2, z: -8 },
  move: initialMove(false),
});
describe('mouse and presentation regression', () => {
  it('camera effects cannot change yaw or pitch during mantle, wall-run or landing', () => {
    const feel = new CameraFeel(),
      camera = new PerspectiveCamera(),
      s = player();
    s.yaw = 0.4;
    s.pitch = -0.2;
    for (const mode of ['MANTLE', 'WALLRUN', 'GROUND'] as const) {
      s.move!.mode = mode;
      for (let i = 0; i < 60; i++) {
        feel.apply(camera, s, s.position, 1 / 144);
        expect(camera.rotation.y).toBe(s.yaw);
        expect(camera.rotation.x).toBe(s.pitch);
      }
    }
  });
  it('accumulates losslessly once per render frame without smoothing', () => {
    const p = new LookPipeline();
    for (let i = 0; i < 1000; i++) p.add(0.25, -0.125);
    expect(p.flush()).toEqual({ x: 250, y: -125 });
    expect(p.flush()).toEqual({ x: 0, y: 0 });
  });
  it('discards isolated huge spikes but preserves normal and sustained fast flicks', () => {
    const p = new LookPipeline();
    for (let i = 0; i < 40; i++) {
      p.add(2, 0);
      p.flush();
    }
    p.add(10000, 0);
    expect(p.flush().x).toBe(0);
    p.add(2, 0);
    expect(p.flush().x).toBe(2);
    expect(p.discarded).toBe(1);
    p.add(1800, -900);
    expect(p.flush()).toEqual({ x: 1800, y: -900 });
    p.add(5000, 0);
    expect(p.flush().x).toBe(0);
    p.add(5000, 0);
    expect(p.flush().x).toBe(10000);
  });
  it('interpolates previous/current positions at 144Hz and clamps alpha', () => {
    const out = { x: 0, y: 0, z: 0 };
    const a = { x: 0, y: 1, z: 2 },
      b = { x: 1, y: 3, z: 4 };
    expect(interpolatePosition(a, b, 0.5, out)).toEqual({ x: 0.5, y: 2, z: 3 });
    expect(interpolatePosition(a, b, -1, out)).toEqual(a);
    expect(interpolatePosition(a, b, 2, out)).toEqual(b);
    for (let i = 0; i < 144; i++) {
      const time = i / 144,
        tick = Math.floor(time * 60);
      expect(
        interpolatePosition(
          { x: tick / 60, y: 0, z: 0 },
          { x: (tick + 1) / 60, y: 0, z: 0 },
          time * 60 - tick,
          out,
        ).x,
      ).toBeCloseTo(time, 12);
    }
  });
  it('reconciliation does not mutate the local input-owned look', () => {
    const local = { yaw: 2, pitch: 0.3 };
    const s = player();
    s.yaw = -1;
    reconcile(
      s,
      0,
      [{ ...command, yaw: local.yaw, pitch: local.pitch }],
      1 / 60,
      world,
    );
    expect(local).toEqual({ yaw: 2, pitch: 0.3 });
  });
  it('AUTO requires ten slow seconds and thirty seconds between changes, blocks active traversal', () => {
    const a = new AutoQuality();
    expect(a.sample(0, 30)).toBe(false);
    expect(a.sample(9999, 30)).toBe(false);
    expect(a.sample(10000, 30, 'SLIDE')).toBe(false);
    expect(a.sample(10001, 30, 'WALLRUN')).toBe(false);
    expect(a.sample(10002, 30, 'MANTLE')).toBe(false);
    expect(a.sample(10003, 30)).toBe(true);
    expect(a.sample(30000, 30)).toBe(false);
    expect(a.sample(40003, 30)).toBe(true);
  });
});
describe('wall latch rules', () => {
  it.each([0, 1])(
    'latches with %s air jumps left before consuming Space',
    (airJumps) => {
      const s = player();
      s.move!.airJumps = airJumps;
      const r = stepPlayer(s, { ...command, buttons: 1 }, 1 / 60, world);
      expect(r.move!.mode).toBe('WALLRUN');
      expect(r.move!.airJumps).toBe(airJumps);
    },
  );
  it.each([-5, 5])('accepts ascending/descending entry vy=%s', (y) => {
    const s = player();
    s.velocity.y = y;
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('WALLRUN');
  });
  it('only locks the same wall for 0.6 seconds, and restores on grounding', () => {
    const s = player();
    s.move!.lockouts = [{ id: 'other', ticks: 36 }];
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('WALLRUN');
    s.move!.lockouts = [{ id: 'wall', ticks: 36 }];
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('AIR');
    s.move!.lockouts[0]!.ticks = 1;
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('WALLRUN');
    expect(MOVE.wallRunLockout).toBe(0.6);
    s.position.y = 0;
    s.velocity = { x: 0, y: -1, z: 0 };
    s.move!.lockouts = [{ id: 'wall', ticks: 36 }];
    expect(stepPlayer(s, command, 1 / 60, world).move!.lockouts).toEqual([]);
  });
  it('requires tangential 4.5m/s, accepts 80 degrees, rejects 85 even on collision', () => {
    for (const angle of [0, 75, 80, 85]) {
      const s = player();
      s.velocity.x = Math.tan((angle * Math.PI) / 180) * 4.5;
      s.velocity.z = -4.5;
      const r = stepPlayer(s, command, 1 / 60, world);
      expect(r.move!.mode === 'WALLRUN').toBe(angle <= 80);
    }
    const s = player();
    s.velocity.z = -4.4;
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('AIR');
  });
  it('accepts .25m reach and swept approaches, requires .4m floor clearance', () => {
    for (const gap of [0.25, 0.5]) {
      const s = player();
      s.position.x = -0.4 - gap;
      s.velocity.x = 15;
      expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('WALLRUN');
    }
    const s = player();
    s.position.y = 0.2;
    s.velocity.y = 0;
    expect(stepPlayer(s, command, 1 / 60, world).move!.mode).toBe('AIR');
  });
  it('rejects crouch, clear away input, unflagged faces and low head clearance', () => {
    const s = player();
    expect(
      stepPlayer(s, { ...command, buttons: 4 }, 1 / 60, world).move!.mode,
    ).toBe('AIR');
    expect(stepPlayer(s, { ...command, x: -1 }, 1 / 60, world).move!.mode).toBe(
      'AIR',
    );
    expect(
      stepPlayer(s, command, 1 / 60, {
        ...world,
        boxes: world.boxes.map((b) => ({ ...b, wallRunnable: false })),
      }).move!.mode,
    ).toBe('AIR');
    const roof = { min: { x: -2, y: 3, z: -5 }, max: { x: 0, y: 4, z: 5 } };
    expect(
      stepPlayer(s, command, 1 / 60, {
        ...world,
        boxes: [...world.boxes, roof],
      }).move!.mode,
    ).toBe('AIR');
  });
  it('retains a near-edge contact for about .08s without changing telemetry outcomes', () => {
    const s = player();
    s.position.z = -29.99;
    s.velocity.z = -4.4;
    const first = stepPlayer(s, command, 1 / 60, world);
    expect(first.move!.latchGrace?.ticks).toBe(5);
    first.velocity.z = -5;
    let diagnostic = '';
    const next = stepPlayer(first, command, 1 / 60, world, MOVE, (d) => {
      diagnostic = d.reason;
    });
    expect(next.move!.mode).toBe('WALLRUN');
    expect(diagnostic).toBe('ATTACHED');
    expect(stepPlayer(first, command, 1 / 60, world)).toEqual(next);
  });
});
