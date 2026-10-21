/** Adversarial confinement search with the full traversal set (sprint, slide, slide-jump,
 * air jump, wall-run/wall-jump chains, mantle). Sampled verification, not a proof:
 * every elevated platform near the perimeter and a ring of ground points along it. */
import {
  BUTTON,
  MOVE,
  PHYSICS,
  levelWorld,
  makeEntity,
  stepPlayer,
} from '../packages/shared/src/index';
import type {
  Entity,
  Input,
  Level,
  Vec3,
  World,
} from '../packages/shared/src/index';
const { jump: J, sprint: S, crouch: C } = BUTTON;
const DT = 1 / 60;
/** Inner faces of the perimeter walls: crossing them is an escape. */
export const INNER = { x: 107, z: 87 };
export type Maneuver =
  | 'leap'
  | 'coyote-leap'
  | 'hop-chain'
  | 'climb'
  | 'wall-chain-left'
  | 'wall-chain-right';
export interface Probe {
  start: Vec3;
  yaw: number;
  maneuver: Maneuver;
  runup: number;
  source: string;
}
type Script = (
  t: number,
  s: Entity,
  memory: Record<string, number>,
) => Partial<Input>;
const mode = (s: Entity) => s.move?.mode ?? 'GROUND';
const SCRIPTS: Record<Maneuver, (runup: number, yaw: number) => Script> = {
  // Sprint, slide, slide-jump, air jump at the apex, hold forward.
  leap: (runup, yaw) => (t, s, mem) => {
    if (mem.jump === undefined && mode(s) === 'SLIDE' && t >= runup + 8)
      mem.jump = t;
    if (
      mem.jump !== undefined &&
      mem.apex === undefined &&
      t > mem.jump + 2 &&
      s.velocity.y <= 0
    )
      mem.apex = t;
    const press = (k?: number) => k !== undefined && t >= k && t < k + 2;
    return {
      z: 1,
      yaw,
      buttons:
        S |
        (t >= runup && t < runup + 6 ? C : 0) |
        (press(mem.jump) || press(mem.apex) ? J : 0),
    };
  },
  // Sprint off an edge, coyote jump on leaving it, air jump at the apex.
  'coyote-leap': (_runup, yaw) => (t, s, mem) => {
    if (mem.off === undefined && mode(s) === 'AIR' && t > 2) mem.off = t;
    if (
      mem.off !== undefined &&
      mem.apex === undefined &&
      t > mem.off + 3 &&
      s.velocity.y <= 0
    )
      mem.apex = t;
    const press = (k?: number) => k !== undefined && t >= k && t < k + 2;
    return {
      z: 1,
      yaw,
      buttons: S | (press(mem.off) || press(mem.apex) ? J : 0),
    };
  },
  // Repeated slide-jumps landing straight into slides to build speed, then a final leap.
  'hop-chain': (runup, yaw) => (t, s) => {
    const m = mode(s);
    const cycle = t < runup ? 0 : ((t - runup) % 42) + 1;
    return {
      z: 1,
      yaw,
      buttons:
        S |
        (t >= runup ? C : 0) |
        (m === 'SLIDE' && cycle > 6 && cycle < 9 ? J : 0) |
        (m === 'AIR' && s.velocity.y < -1 && s.move?.airJumps ? J : 0),
    };
  },
  // Run at the wall, jump, air jump, keep pushing forward and jumping (mantle/climb attempts).
  climb: (runup, yaw) => (t) => ({
    z: 1,
    yaw,
    buttons:
      S |
      (t >= runup && (t - runup) % 30 < 2 ? J : 0) |
      (t >= runup && (t - runup) % 30 === 14 ? 0 : 0),
  }),
  // Angled into walls: latch, wall-jump after a short run, steer back, air jump.
  'wall-chain-left': (runup, yaw) => wallChain(runup, yaw + 0.55),
  'wall-chain-right': (runup, yaw) => wallChain(runup, yaw - 0.55),
};
function wallChain(runup: number, yaw: number): Script {
  return (t, s, mem) => {
    const m = mode(s);
    if (m === 'WALLRUN') {
      mem.ran = (mem.ran ?? 0) + 1;
      if (mem.ran === 12 || mem.ran === 13)
        return { z: 1, yaw, buttons: S | J };
    } else mem.ran = 0;
    const press = t >= runup && t < runup + 2;
    const air = m === 'AIR' && s.velocity.y < 0 && s.move?.airJumps ? J : 0;
    return { z: 1, yaw, buttons: S | (press ? J : 0) | air };
  };
}
export function runProbe(world: World, probe: Probe, ticks = 330) {
  let s: Entity = {
    ...makeEntity('escape'),
    position: { ...probe.start },
    yaw: probe.yaw,
  };
  const script = SCRIPTS[probe.maneuver](probe.runup, probe.yaw),
    memory: Record<string, number> = {};
  let maxY = s.position.y;
  const modes = new Set<string>();
  for (let t = 0; t < ticks; t++) {
    s = stepPlayer(
      s,
      {
        seq: t + 1,
        tick: t,
        x: 0,
        z: 0,
        yaw: probe.yaw,
        pitch: 0,
        buttons: 0,
        ...script(t, s, memory),
      },
      DT,
      world,
      MOVE,
    );
    maxY = Math.max(maxY, s.position.y);
    modes.add(mode(s));
    if (Math.abs(s.position.x) >= INNER.x || Math.abs(s.position.z) >= INNER.z)
      return {
        escaped: true,
        at: s.position,
        maxY,
        tick: t,
        modes: [...modes],
      };
    if (s.position.y < -6) break;
  }
  return {
    escaped: false,
    at: s.position,
    maxY,
    tick: ticks,
    modes: [...modes],
  };
}
const distanceToPerimeter = (x: number, z: number) =>
  Math.min(INNER.x - Math.abs(x), INNER.z - Math.abs(z));
/** Headings toward the nearest perimeter walls, plus diagonals. */
function headings(x: number, z: number) {
  const out = new Set<number>();
  const toward = [
    { d: INNER.x - x, yaw: -Math.PI / 2 },
    { d: INNER.x + x, yaw: Math.PI / 2 },
    { d: INNER.z - z, yaw: Math.PI },
    { d: INNER.z + z, yaw: 0 },
  ].sort((a, b) => a.d - b.d);
  for (const t of toward.slice(0, 2))
    for (const offset of [0, 0.6, -0.6]) out.add(t.yaw + offset);
  return [...out];
}
export function escapeProbes(
  level: Level,
  options: {
    reach?: number;
    minTop?: number;
    ground?: boolean;
    maneuvers?: Maneuver[];
  } = {},
): Probe[] {
  const reach = options.reach ?? 34,
    minTop = options.minTop ?? 3,
    r = PHYSICS.radius;
  const world = levelWorld(level);
  const clear = (x: number, y: number, z: number) =>
    !(world.query?.(x - r, z - r, x + r, z + r) ?? world.boxes).some(
      (b) =>
        x + r > b.min.x &&
        x - r < b.max.x &&
        z + r > b.min.z &&
        z - r < b.max.z &&
        y + PHYSICS.height > b.min.y + 1e-6 &&
        y < b.max.y - 1e-6,
    );
  const probes: Probe[] = [];
  const maneuvers = options.maneuvers ?? [
    'leap',
    'coyote-leap',
    'hop-chain',
    'climb',
    'wall-chain-left',
    'wall-chain-right',
  ];
  for (const b of level.colliders) {
    // Walkable surfaces only: walls, doors, shutters and barriers are not platforms.
    if (b.decor || !b.platform || b.max.y < minTop) continue;
    const near = distanceToPerimeter(
      Math.min(Math.abs(b.min.x), Math.abs(b.max.x)) === Math.abs(b.min.x)
        ? b.max.x
        : b.min.x,
      b.max.z,
    );
    const nearest = Math.min(
      distanceToPerimeter(b.min.x, b.min.z),
      distanceToPerimeter(b.max.x, b.max.z),
      distanceToPerimeter(b.min.x, b.max.z),
      distanceToPerimeter(b.max.x, b.min.z),
      near,
    );
    if (nearest > reach) continue;
    const xs = [b.min.x + 0.5, (b.min.x + b.max.x) / 2, b.max.x - 0.5],
      zs = [b.min.z + 0.5, (b.min.z + b.max.z) / 2, b.max.z - 0.5];
    for (const x of xs)
      for (const z of zs) {
        if (
          x < b.min.x + r ||
          x > b.max.x - r ||
          z < b.min.z + r ||
          z > b.max.z - r
        )
          continue;
        if (!clear(x, b.max.y, z)) continue;
        for (const yaw of headings(x, z))
          for (const maneuver of maneuvers)
            for (const runup of maneuver === 'coyote-leap' ? [0] : [0, 20])
              probes.push({
                start: { x, y: b.max.y, z },
                yaw,
                maneuver,
                runup,
                source: b.id,
              });
      }
  }
  if (options.ground !== false)
    // Ground ring along the inside of the perimeter: climb, mantle and wall-run attempts.
    for (const inset of [2, 6])
      for (let k = -100; k <= 100; k += 5)
        for (const [x, z] of [
          [k, INNER.z - inset],
          [k, -INNER.z + inset],
          [INNER.x - inset, (k * 85) / 100],
          [-INNER.x + inset, (k * 85) / 100],
        ] as const) {
          if (!clear(x, 0, z)) continue;
          for (const yaw of headings(x, z).slice(0, 1))
            for (const maneuver of [
              'climb',
              'wall-chain-left',
              'wall-chain-right',
              'leap',
            ] as const)
              probes.push({
                start: { x, y: 0, z },
                yaw,
                maneuver,
                runup: 0,
                source: 'ground-ring',
              });
        }
  return probes;
}
export function searchEscapes(level: Level, probes = escapeProbes(level)) {
  const world = levelWorld(level);
  const escapes: (Probe & { at: Vec3; tick: number; modes: string[] })[] = [];
  let ticks = 0;
  for (const probe of probes) {
    const result = runProbe(world, probe);
    ticks += result.tick;
    if (result.escaped)
      escapes.push({
        ...probe,
        at: result.at,
        tick: result.tick,
        modes: result.modes,
      });
  }
  return { probes: probes.length, ticks, escapes };
}
