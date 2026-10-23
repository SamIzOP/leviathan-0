import { describe, it, expect } from 'vitest';
import {
  LEVELS,
  levelWorld,
  missionLevel,
  spawnEntity,
  stepPlayer,
  reconcile,
  PLACEHOLDER,
  MOVE,
  basePlaceholderJumpHeight,
  CONFIG,
  METRICS,
  levelSchema,
  inside,
} from '@leviathan/shared';
import { validateLevel } from '../packages/shared/src/level-validation';
import { Game, type Peer } from '../packages/server/src/game';
describe('Foundry Row level contract', () => {
  for (const level of Object.values(LEVELS)) {
    it(
      level.id + ' validates geometry, spawns and jump-chain reachability',
      () => {
        expect(validateLevel(level)).toEqual([]);
        expect(levelSchema.safeParse(level).success).toBe(true);
      },
    );
    it(
      level.id + ' produces identical authoritative and predicted movement',
      () => {
        const world = levelWorld(level);
        let server = spawnEntity('a', 0, level),
          client = structuredClone(server);
        let pending: Parameters<typeof reconcile>[2] = [];
        const states = new Map<number, typeof server>();
        for (let tick = 1; tick <= 3600; tick++) {
          const input = {
            seq: tick,
            tick,
            x: Math.sin(tick / 100),
            z: Math.cos(tick / 120),
            yaw: Math.sin(tick / 80),
            pitch: 0,
            buttons: tick % 43 === 0 ? 1 : 2,
          };
          server = stepPlayer(server, input, 1 / 60, world);
          client = stepPlayer(client, input, 1 / 60, world);
          states.set(tick, server);
          pending.push(input);
          const ack = tick - 9;
          if (ack > 0 && tick % 13 !== 0) {
            const result = reconcile(
              states.get(ack)!,
              ack,
              pending,
              1 / 60,
              world,
            );
            expect(result.state).toEqual(client);
            pending = result.pending;
            client = result.state;
          }
          expect(inside(server.position, level.bounds)).toBe(true);
        }
      },
    );
  }
  it('rejects obstructed spawns and inaccessible platforms', () => {
    const level = structuredClone(missionLevel(0));
    level.spawns[0]!.position = {
      ...level.colliders.find((b) => b.id === 'gate-workshop/side-1')!.min,
    };
    level.spawns[0]!.position.y = 1;
    expect(
      validateLevel(level).some((e) => e.startsWith('Spawn obstructed')),
    ).toBe(true);
    level.colliders.push({
      id: 'isolated',
      min: { x: 0, y: 40, z: 50 },
      max: { x: 3, y: 41, z: 53 },
      surface: 'metal',
      platform: true,
      wallRunnable: false,
      mantleable: false,
      climbable: false,
    });
    expect(validateLevel(level)).toContain('Unreachable platform isolated');
  });
  it('keeps step heights below 80 percent of the existing jump', () => {
    // Validators keep the retired placeholder jump; the new jump may not be lower.
    expect(METRICS.stepHeight).toBeCloseTo(0.98);
    expect(PLACEHOLDER.jump).toBe(7);
    expect(PLACEHOLDER.gravity).toBe(20);
    expect(basePlaceholderJumpHeight).toBeCloseTo(1.225);
    expect(MOVE.jumpHeight).toBeGreaterThanOrEqual(basePlaceholderJumpHeight);
  });
  it('uses free spawns and recovers below-map and out-of-bounds players', () => {
    const game = new Game({ devTools: true }),
      peer: Peer = { id: 'test', send: () => {}, close: () => {} };
    game.handle(peer, {
      type: 'dev-solo',
      protocol: CONFIG.protocol,
      name: 'Tester',
    });
    const level = missionLevel(0);
    for (const position of [
      { x: 0, y: level.killY - 1, z: 0 },
      { x: level.bounds.max.x + 1, y: 0, z: 0 },
    ]) {
      peer.player!.entity.position = position;
      game.step();
      expect(inside(peer.player!.entity.position, level.bounds)).toBe(true);
      expect(peer.player!.entity.position.y).toBe(0);
    }
    const occupied = level.spawns
      .filter((s) => s.type === 'player')
      .slice(0, 8)
      .map((_, i) => spawnEntity(String(i), i, level));
    const spawn = spawnEntity('new', 0, level, occupied);
    expect(
      occupied.every(
        (p) =>
          Math.hypot(
            p.position.x - spawn.position.x,
            p.position.z - spawn.position.z,
          ) > 1,
      ),
    ).toBe(true);
  });
  it('maps Factory 2 to identical collision data and different weather', () => {
    expect(missionLevel(0).colliders).toEqual(missionLevel(1).colliders);
    expect(missionLevel(0).weather).not.toEqual(missionLevel(1).weather);
    expect(
      missionLevel(0).spawns.filter((s) => s.type === 'player'),
    ).toHaveLength(12);
    expect(
      missionLevel(0).colliders.filter(
        (c) => c.id === 'entrance/assembly-truck-18-66/chassis',
      ),
    ).toHaveLength(1);
  });
});
