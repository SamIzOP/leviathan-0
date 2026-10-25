import { z } from 'zod';
import { METRICS } from './metrics';
import { buildFoundry } from './foundry-redesign';
import { spatialWorld } from './spatial-grid';
import { makeEntity } from './movement';
import type { Entity, Vec3, World } from './types';
const vec = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
const box = z.object({ min: vec, max: vec });
export const surfaceSchema = z.enum([
  'asphalt',
  'concrete',
  'brick',
  'metal',
  'wood',
  'glass',
]);
export type Surface = z.infer<typeof surfaceSchema>;
const colliderSchema = box.extend({
  id: z.string(),
  surface: surfaceSchema,
  wallRunnable: z.boolean(),
  runFaces: z.array(z.enum(['+x', '-x', '+z', '-z'])).optional(),
  mantleable: z.boolean(),
  climbable: z.boolean(),
  decor: z.boolean().optional(),
  /** Collision-only volume: blocks movement, never rendered (debug wireframes only). */
  clip: z.boolean().optional(),
  platform: z.boolean(),
  prop: z.string().optional(),
  visualId: z.string().optional(),
  collision: z.literal('solid').optional(),
});
const decorSchema = z.object({
  id: z.string(),
  kind: z.enum(['box', 'cylinder', 'window', 'lamp', 'haze']),
  position: vec,
  size: vec,
  surface: surfaceSchema,
  color: z.string().optional(),
  detail: z.boolean().optional(),
  prop: z.string().optional(),
  rotation: vec.optional(),
  collision: z.enum(['solid', 'decor']).optional(),
  reason: z
    .enum(['small', 'overhead', 'surface', 'cable', 'effect'])
    .optional(),
  zone: z.string().optional(),
  text: z.string().optional(),
  /** Dressing prop: procedural forge fallback when the model file is missing. */
  fallback: z.string().optional(),
  tint: z.number().optional(),
});
export const levelSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number().int(),
  layoutVersion: z.number().optional(),
  solids: z
    .array(
      z.object({
        id: z.string(),
        shape: z.string(),
        position: vec,
        size: vec,
        surface: surfaceSchema,
        color: z.string().optional(),
        collision: z.literal('solid'),
        colliderIds: z.array(z.string()),
        zone: z.string(),
        /** Blocking dressing prop rendered as a model fitted to this box footprint. */
        prop: z.string().optional(),
        fallback: z.string().optional(),
        yaw: z.number().optional(),
        tint: z.number().optional(),
      }),
    )
    .optional(),
  criticalPath: z.array(vec).optional(),
  landmarks: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        position: vec,
        height: z.number(),
      }),
    )
    .optional(),
  coverPoints: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        position: vec,
        heightClass: z.enum(['low', 'medium', 'high']),
        colliderId: z.string(),
      }),
    )
    .optional(),
  markers: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        position: vec,
        kind: z.enum([
          'enemySpawn',
          'ammo',
          'salvage',
          'oil',
          'burn',
          'exit',
          'checkpoint',
        ]),
        hint: z.enum(['ground', 'elevated', 'interior']).optional(),
      }),
    )
    .optional(),
  encounters: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        bounds: box,
        entryGate: z.string(),
        waveSize: z.number(),
        intensity: z.number(),
      }),
    )
    .optional(),
  routes: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        width: z.number(),
        ceiling: z.number(),
        kind: z.enum([
          'primary',
          'flank',
          'slide',
          'stairs',
          'wallrun',
          'jump',
        ]),
        points: z.array(vec),
        shortcut: z.boolean().optional(),
      }),
    )
    .optional(),
  rooms: z
    .array(
      z.object({
        id: z.string(),
        zone: z.string(),
        bounds: box,
        openings: z.array(
          z.object({ position: vec, width: z.number(), height: z.number() }),
        ),
        roof: z.number(),
      }),
    )
    .optional(),
  bounds: box,
  killY: z.number(),
  colliders: z.array(colliderSchema),
  gates: z.array(
    z.object({
      id: z.string(),
      position: vec,
      initiallyClosed: z.boolean(),
      connects: z.tuple([z.string(), z.string()]).optional(),
      width: z.number().optional(),
    }),
  ),
  zones: z.array(
    z.object({
      id: z.string(),
      position: vec,
      bounds: box.optional(),
      code: z.string().optional(),
      material: surfaceSchema.optional(),
      fogTint: z.string().optional(),
      ambient: z.number().optional(),
      dressingMinimum: z.number().optional(),
      dressingPer1000: z.number().optional(),
    }),
  ),
  buildings: z.array(
    z.object({
      id: z.string(),
      side: z.number(),
      x: z.number(),
      z: z.number(),
      width: z.number(),
      depth: z.number(),
      height: z.number(),
      floors: z.number(),
      roof: z.enum(['flat', 'pitched', 'sawtooth', 'stepped', 'collapsed']),
      archetype: z.number(),
      damage: z.number(),
    }),
  ),
  spawns: z.array(
    z.object({
      position: vec,
      yaw: z.number(),
      type: z.enum(['player', 'enemySpawn', 'pickup', 'objective']),
    }),
  ),
  decor: z.array(decorSchema),
  lights: z.array(z.object({ position: vec, intensity: z.number() })),
  interiors: z.array(box),
  weather: z.object({
    rain: z.number().min(0).max(1),
    wind: vec,
    wetness: z.number().min(0).max(1),
  }),
  atmosphere: z.object({
    fog: z.number(),
    heightFog: z.number(),
    exposure: z.number(),
    sky: z.string(),
    horizon: z.string(),
    tint: z.string(),
    smoke: z.number(),
  }),
  audio: z.object({
    rain: z.number(),
    wind: z.number(),
    distantInterval: z.tuple([z.number(), z.number()]),
    emitters: z.array(
      z.object({
        kind: z.enum(['machinery', 'steam', 'crane']),
        position: vec,
        gain: z.number(),
      }),
    ),
  }),
  cameras: z.record(z.string(), z.object({ position: vec, target: vec })),
});
export type Level = z.infer<typeof levelSchema>;
export type Collider = Level['colliders'][number];
export function randomSeed(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const first = levelSchema.parse(buildFoundry());

const second: Level = {
  ...first,
  id: 'foundry-row-overcast',
  name: 'Foundry Row / Cold Front',
  weather: { ...first.weather, rain: 0.95, wind: v(4, 0, 1) },
  atmosphere: {
    ...first.atmosphere,
    fog: 0.009,
    heightFog: 0.014,
    exposure: 0.75,
    tint: '#9caebd',
    horizon: '#76858f',
    sky: '#aebdc7',
  },
};
export const LEVELS: Readonly<Record<string, Level>> = {
  'foundry-row': first,
  'foundry-row-overcast': second,
};
export const MISSION_LEVELS = [
  'foundry-row',
  'foundry-row-overcast',
  'foundry-row',
  'foundry-row',
  'foundry-row',
  'foundry-row',
  'foundry-row',
];
// Development-only levels (the Movement Lab) register at runtime from dev entry
// points, so production bundles and mission lists never contain them.
const devLevels = new Map<string, Level>();
export function registerLevel(level: Level) {
  devLevels.set(level.id, levelSchema.parse(level));
}
export const getLevel = (id = 'foundry-row') =>
  LEVELS[id] ?? devLevels.get(id) ?? first;
export const hasLevel = (id: string) => !!LEVELS[id] || devLevels.has(id);
export const missionLevel = (mission: number) =>
  getLevel(MISSION_LEVELS[mission]);
const worlds = new Map<string, World>();
export function levelWorld(level: Level): World {
  let world = worlds.get(level.id);
  if (!world) {
    world = spatialWorld(
      level.bounds.min.y,
      level.colliders.filter((c) => !c.decor),
    );
    worlds.set(level.id, world);
  }
  return world;
}
export function spawnEntity(
  id: string,
  index: number,
  level: Level,
  occupied: Entity[] = [],
): Entity {
  const spawns = level.spawns.filter((s) => s.type === 'player');
  const spawn =
    Array.from(
      { length: spawns.length },
      (_, n) => spawns[(index + n) % spawns.length]!,
    ).find((s) =>
      occupied.every(
        (e) =>
          Math.hypot(e.position.x - s.position.x, e.position.z - s.position.z) >
          METRICS.radius * 2 + 0.5,
      ),
    ) ?? spawns[index % spawns.length]!;
  return {
    ...makeEntity(id, index),
    position: { ...spawn.position },
    yaw: spawn.yaw,
  };
}
export function surfaceAt(level: Level, p: Vec3): Surface {
  return (
    level.colliders
      .filter(
        (c) =>
          !c.decor &&
          Math.abs(c.max.y - p.y) < 0.15 &&
          p.x >= c.min.x &&
          p.x <= c.max.x &&
          p.z >= c.min.z &&
          p.z <= c.max.z,
      )
      .sort((a, b) => b.max.y - a.max.y)[0]?.surface ?? 'asphalt'
  );
}
export function inside(p: Vec3, b: { min: Vec3; max: Vec3 }) {
  return (
    p.x >= b.min.x &&
    p.x <= b.max.x &&
    p.y >= b.min.y &&
    p.y <= b.max.y &&
    p.z >= b.min.z &&
    p.z <= b.max.z
  );
}
