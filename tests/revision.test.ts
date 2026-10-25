import { describe, it, expect } from 'vitest';
import {
  makeEntity,
  stepPlayer,
  PHYSICS,
  FLAG,
  levelWorld,
  getLevel,
} from '@leviathan/shared';
import { spatialWorld } from '../packages/shared/src/spatial-grid';
import { stairRun } from '../packages/shared/src/stairs';
import { buildings } from '../packages/shared/src/buildings';
import { forgeAsset, FORGE_CATALOG } from '../packages/shared/src/forge-data';
import {
  forgeModel,
  triangleCount,
  disposeForge,
} from '../packages/client/src/forge';
import type { World, Entity } from '@leviathan/shared';
import { Box3, Vector3 } from 'three';
import { confinement } from '../packages/shared/src/confinement';
const input = { seq: 1, tick: 1, x: 0, z: -1, yaw: 0, pitch: 0, buttons: 0 };
function walk(
  world: World,
  entity: Entity,
  ticks: number,
  buttons = 0,
  z = -1,
) {
  const states: Entity[] = [];
  for (let i = 0; i < ticks; i++) {
    entity = stepPlayer(
      entity,
      { ...input, buttons, z, seq: i, tick: i },
      1 / 60,
      world,
    );
    states.push(entity);
  }
  return states;
}
const start = () => ({
  ...makeEntity('test'),
  position: { x: 0, y: 0, z: -1 },
});
describe('Grounded stair motion', () => {
  const world = spatialWorld(0, stairRun(1.8));
  it('walks up 0.18 m risers without jumping and stays grounded', () => {
    // Walking now accelerates (no instant 5 m/s), so allow ten more ticks.
    const states = walk(world, start(), 50);
    expect(states.at(-1)!.position.y).toBeCloseTo(1.8);
    expect(states.every((s) => !!(s.flags & FLAG.grounded))).toBe(true);
  });
  it('blocks a 0.6 m wall', () => {
    const states = walk(
      {
        floor: 0,
        boxes: [{ min: { x: -2, y: 0, z: 0 }, max: { x: 2, y: 0.6, z: 1 } }],
      },
      start(),
      120,
    );
    expect(states.at(-1)!.position.z).toBeLessThanOrEqual(-PHYSICS.radius);
    expect(states.at(-1)!.position.y).toBe(0);
  });
  it('does not step while airborne or through a low ceiling', () => {
    const airborne = {
      ...start(),
      position: { x: 0, y: 0.05, z: -0.4 },
      velocity: { x: 0, y: 0, z: 0 },
      flags: 0,
    };
    const next = stepPlayer(airborne, input, 1 / 60, world);
    expect(next.position.y).toBeLessThan(0.05);
    const blocked = {
      floor: 0,
      boxes: [
        ...stairRun(1.8),
        { min: { x: -2, y: 1.85, z: -1 }, max: { x: 2, y: 2, z: 4 } },
      ],
    };
    expect(walk(blocked, start(), 90).at(-1)!.position.z).toBeLessThan(0);
  });
  it('snaps down successive stairs without airborne frames', () => {
    const top = { ...start(), position: { x: 0, y: 1.8, z: 2.8 } };
    const states = walk(world, top, 50, 0, 1);
    expect(states.every((s) => !!(s.flags & FLAG.grounded))).toBe(true);
    expect(states.at(-1)!.position.y).toBe(0);
  });
  it('does not tunnel through a 5 cm wall at sprint speed', () => {
    const w = spatialWorld(0, [
      { min: { x: -2, y: 0, z: 0 }, max: { x: 2, y: 3, z: 0.05 } },
    ]);
    expect(walk(w, start(), 600, 2).at(-1)!.position.z).toBeLessThanOrEqual(
      -PHYSICS.radius,
    );
  });
  it('is deterministic and broadphase equals the original full scan', () => {
    const a = walk(world, start(), 100),
      b = walk({ floor: 0, boxes: world.boxes }, start(), 100);
    expect(a).toEqual(b);
    const level = levelWorld(getLevel());
    expect(walk(level, start(), 240, 2)).toEqual(
      walk({ floor: level.floor, boxes: level.boxes }, start(), 240, 2),
    );
  });
});
describe('Architecture and forge', () => {
  it('has unequal street sequences, no adjacent signatures and eight archetypes', () => {
    const list = buildings(71017),
      left = list.filter((b) => b.side < 0),
      right = list.filter((b) => b.side > 0);
    for (const field of ['width', 'height', 'roof'] as const)
      expect(left.map((b) => b[field])).not.toEqual(right.map((b) => b[field]));
    expect(new Set(list.map((b) => b.archetype)).size).toBeGreaterThanOrEqual(
      8,
    );
    for (const side of [left, right])
      for (let i = 1; i < side.length; i++)
        expect(side[i]!.archetype).not.toBe(side[i - 1]!.archetype);
    expect(
      list.every(
        (b) =>
          b.width >= 6 && b.width <= 16 && b.height >= 14 && b.height <= 30,
      ),
    ).toBe(true);
  });
  it('defines the large sealed compound, gate markers and entrance-only spawns', () => {
    const l = getLevel();
    expect(l.bounds.max.x - l.bounds.min.x).toBe(420);
    expect(l.bounds.max.z - l.bounds.min.z).toBe(340);
    expect(l.gates.find((g) => g.id === 'entrance-seal')!.initiallyClosed).toBe(
      true,
    );
    expect(l.gates.filter((g) => g.connects)).toHaveLength(6);
    expect(
      l.spawns
        .filter((s) => s.type === 'player')
        .every((s) => s.position.z >= 75 && s.yaw === 0),
    ).toBe(true);
  });
  it('detects an opened perimeter in the flood fill', () => {
    const l = structuredClone(getLevel());
    l.colliders = l.colliders.filter((b) => b.id !== 'perimeter-x208');
    expect(confinement(l).boundary).toBe(true);
  });
  it('keeps stair risers and treads at human scale', () => {
    const stairs = getLevel().colliders.filter((b) => b.id.includes('/tread-'));
    expect(stairs.length).toBeGreaterThan(300);
    expect(
      stairs.every(
        (b) => b.max.z - b.min.z >= 0.4 && b.max.z - b.min.z <= 0.43,
      ),
    ).toBe(true);
  });
  it('generates every catalog entry deterministically with three variants and triangle budgets', () => {
    for (const key of FORGE_CATALOG)
      for (let variant = 0; variant < 3; variant++) {
        const data = forgeAsset(key, variant);
        expect(data).toEqual(forgeAsset(key, variant));
        expect(data.parts.length).toBeGreaterThan(0);
        expect(data.colliders.length).toBeGreaterThan(0);
        const model = forgeModel(key, variant);
        expect(triangleCount(model), key).toBeLessThan(
          key.includes('wreck') ||
            ['sedan', 'hatchback', 'pickup', 'van', 'small-truck'].includes(key)
            ? 8000
            : data.large
              ? 16000
              : 3000,
        );
        const visual = new Box3().setFromObject(model),
          collision = new Box3();
        data.colliders.forEach((b) =>
          collision.union(
            new Box3(
              new Vector3(b.min.x, b.min.y, b.min.z),
              new Vector3(b.max.x, b.max.y, b.max.z),
            ),
          ),
        );
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(
            Math.abs(visual.min[axis] - collision.min[axis]),
            key + ' min ' + axis,
          ).toBeLessThanOrEqual(0.05);
          expect(
            Math.abs(visual.max[axis] - collision.max[axis]),
            key + ' max ' + axis,
          ).toBeLessThanOrEqual(0.05);
        }
        disposeForge(model);
      }
  }, 30000);
});
