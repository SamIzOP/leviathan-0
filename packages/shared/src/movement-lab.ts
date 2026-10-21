import { levelSchema, registerLevel, type Collider, type Level } from './level';
import { stairRun, placeStairs } from './stairs';
import type { Vec3 } from './types';
/** Development-only traversal test arena. Imported only by dev entry points, never by
 * the shared index, the production server entry or the production client bundle. */
export const MOVEMENT_LAB_ID = 'movement-lab';
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** Ledge row heights (m): step-up, mantle window, beyond standing reach, out of reach. */
export const LAB_LEDGES = [0.5, 0.75, 1.0, 1.5, 2.0, 2.3, 2.6, 4.0];
/** Gap course: platform tops at 2 m, gaps along +x. */
export const LAB_GAPS = [2, 4, 6, 8];
export function buildMovementLab(): Level {
  const colliders: Collider[] = [],
    decor: Level['decor'] = [];
  const box = (
    id: string,
    min: Vec3,
    max: Vec3,
    surface: Collider['surface'],
    flags: { run?: boolean; mantle?: boolean; platform?: boolean } = {},
  ) =>
    colliders.push({
      id,
      min,
      max,
      surface,
      platform: flags.platform ?? true,
      wallRunnable: !!flags.run,
      mantleable: !!flags.mantle,
      climbable: false,
    });
  box('lab-ground', v(-72, -0.5, -72), v(72, 0, 72), 'concrete');
  // Enclosure: plain, unflagged 8 m walls.
  box('lab-wall-n', v(-72, 0, -72), v(72, 8, -70), 'concrete', {
    platform: false,
  });
  box('lab-wall-s', v(-72, 0, 70), v(72, 8, 72), 'concrete', {
    platform: false,
  });
  box('lab-wall-w', v(-72, 0, -70), v(-70, 8, 70), 'concrete', {
    platform: false,
  });
  box('lab-wall-e', v(70, 0, -70), v(72, 8, 70), 'concrete', {
    platform: false,
  });
  // Ledge row facing the spawn: step-up, mantle and no-mantle cases.
  LAB_LEDGES.forEach((h, k) => {
    const x = -35 + k * 5;
    box(
      `lab-ledge-${String(Math.round(h * 100)).padStart(3, '0')}`,
      v(x - 1.5, 0, 48),
      v(x + 1.5, h, 52),
      'concrete',
      { mantle: true },
    );
  });
  box('lab-ledge-150-unflagged', v(8.5, 0, 48), v(11.5, 1.5, 52), 'brick');
  // Stair run to a 3.6 m landing.
  for (const [i, b] of placeStairs(
    stairRun(3.6),
    v(20, 0, 52),
    'z',
    -1,
  ).entries())
    box(`lab-stair-${i}`, b.min, b.max, 'metal');
  box('lab-stair-landing', v(18.8, 0, 42.2), v(21.2, 3.6, 46.2), 'metal', {
    mantle: true,
  });
  // Low tunnel: 1.2 m ceiling for crouch and slide-under.
  box('lab-tunnel-west', v(-51, 0, -10), v(-50, 1.6, 10), 'concrete', {
    platform: false,
  });
  box('lab-tunnel-east', v(-46, 0, -10), v(-45, 1.6, 10), 'concrete', {
    platform: false,
  });
  box('lab-tunnel-roof', v(-51, 1.2, -10), v(-45, 1.6, 10), 'concrete');
  // Long straight wall-run wall (40 m).
  box('lab-run-long', v(-38, 0, -20), v(-37, 6, 20), 'brick', { run: true });
  // Chain finish: a mantle block on the long wall's exit line.
  box('lab-chain-ledge', v(-46, 0, -34), v(-40, 1.5, -30), 'concrete', {
    mantle: true,
  });
  // L-shaped convex corner.
  box('lab-run-l-a', v(-26, 0, -11), v(-25, 6, 15), 'concrete', { run: true });
  box('lab-run-l-b', v(-25, 0, -11), v(-12, 6, -10), 'concrete', { run: true });
  // Concave corner.
  box('lab-run-concave-a', v(9, 0, -10), v(10, 6, 15), 'metal', { run: true });
  box('lab-run-concave-b', v(-3, 0, -11), v(10, 6, -10), 'metal', {
    run: true,
  });
  // Interrupted wall: 6 m segments with 2 m gaps.
  for (let k = 0; k < 5; k++)
    box(
      `lab-run-gap-${k}`,
      v(22, 0, 12 - k * 8),
      v(23, 5, 18 - k * 8),
      'brick',
      { run: true },
    );
  // Same size as the long wall but deliberately not flagged.
  box('lab-run-unflagged', v(34, 0, -20), v(35, 6, 20), 'concrete', {
    platform: false,
  });
  // Gap course along +x: 20 m runway, then 2/4/6/8 m gaps between 2 m platforms.
  const top = 2,
    z0 = -56,
    z1 = -50;
  let x = -45;
  box('lab-gap-runway', v(x, 0, z0), v(x + 20, top, z1), 'metal', {
    mantle: true,
  });
  for (const [i, b] of placeStairs(
    stairRun(top),
    v(x - 3.19, 0, -53),
    'x',
    1,
  ).entries())
    box(`lab-gap-stair-${i}`, b.min, b.max, 'metal');
  x += 20;
  LAB_GAPS.forEach((gap, k) => {
    x += gap;
    const length = k === LAB_GAPS.length - 1 ? 15 : 5;
    box(`lab-gap-${gap}m`, v(x, 0, z0), v(x + length, top, z1), 'metal', {
      mantle: true,
    });
    x += length;
  });
  // Floor rulers every 5 m and taller markers every 10 m.
  for (let n = -65; n <= 65; n += 5) {
    decor.push(
      {
        id: `lab-ruler-z${n}`,
        kind: 'box',
        position: v(0, 0.006, n),
        size: v(138, 0.012, n % 10 === 0 ? 0.1 : 0.05),
        surface: 'concrete',
        color: '#8a98a1',
      },
      {
        id: `lab-ruler-x${n}`,
        kind: 'box',
        position: v(n, 0.006, 0),
        size: v(n % 10 === 0 ? 0.1 : 0.05, 0.012, 138),
        surface: 'concrete',
        color: '#8a98a1',
      },
      {
        id: `lab-marker-${n}`,
        kind: 'box',
        position: v(-68, n % 10 === 0 ? 0.5 : 0.25, n),
        size: v(0.3, n % 10 === 0 ? 1 : 0.5, 0.3),
        surface: 'metal',
        color: '#c9b458',
      },
    );
  }
  const level: Level = {
    id: MOVEMENT_LAB_ID,
    name: 'Movement Lab',
    seed: 4401,
    bounds: { min: v(-72, -14, -72), max: v(72, 60, 72) },
    killY: -8,
    colliders,
    gates: [],
    zones: [],
    buildings: [],
    spawns: [-3, -1, 1, 3].map((sx) => ({
      position: v(sx, 0, 64),
      yaw: 0,
      type: 'player' as const,
    })),
    decor,
    lights: [
      { position: v(-30, 9, 30), intensity: 0.5 },
      { position: v(30, 9, 30), intensity: 0.5 },
      { position: v(-30, 9, -30), intensity: 0.5 },
      { position: v(30, 9, -30), intensity: 0.5 },
    ],
    interiors: [{ min: v(-50, 0, -10), max: v(-46, 1.2, 10) }],
    weather: { rain: 0.25, wind: v(1, 0, 0.2), wetness: 0.4 },
    atmosphere: {
      fog: 0.0035,
      heightFog: 0.005,
      exposure: 0.95,
      sky: '#cbd2d4',
      horizon: '#8b989e',
      tint: '#aebdc5',
      smoke: 0,
    },
    audio: { rain: 0.06, wind: 0.03, distantInterval: [60, 90], emitters: [] },
    cameras: {
      spawn: { position: v(0, 1.65, 64), target: v(0, 2, 40) },
      overview: { position: v(0, 30, 75), target: v(0, 0, 0) },
    },
  };
  return levelSchema.parse(level);
}
let registered = false;
export function registerMovementLab() {
  if (!registered) registerLevel(buildMovementLab());
  registered = true;
}
