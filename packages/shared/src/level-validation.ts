import { levelSchema, type Level } from './level';
import { METRICS } from './metrics';
import { MOVE, PLACEHOLDER } from './config';
import { confinement } from './confinement';
/** Informational only: platforms that gain entry routes through mantle or wall-run.
 * The validators above keep their conservative placeholder rules. */
export function advancedTraversal(level: Level) {
  const boxes = level.colliders.filter((b) => !b.decor);
  // Stair treads (0.29 m deep) are step-up surfaces, not traversal destinations.
  const platforms = boxes.filter(
    (b) => b.platform && Math.min(b.max.x - b.min.x, b.max.z - b.min.z) > 0.3,
  );
  const jumpApex = MOVE.jumpHeight,
    airJump = MOVE.doubleJump ** 2 / (2 * MOVE.gravity);
  // Highest feet reach from a standing top: jump plus air jump, then the mantle window.
  const mantleReach = jumpApex + airJump + MOVE.mantleMax;
  // A wall-run adds its rise, then a wall-jump and the restored air jump.
  const wallGain =
    jumpApex +
    (MOVE.wallRunRise * MOVE.wallRunRiseTime) / 2 +
    MOVE.wallJumpUp ** 2 / (2 * MOVE.gravity) +
    airJump;
  const runLength = MOVE.wallRunSpeed * MOVE.wallRunTime;
  const gap = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
    Math.hypot(
      Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x),
      Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z),
    );
  const walls = boxes.filter((b) => b.wallRunnable);
  const mantle: { from: string; to: string; rise: number }[] = [];
  const wallRun: { from: string; to: string; rise: number; wall: string }[] =
    [];
  for (const b of platforms)
    for (const a of platforms) {
      if (a === b) continue;
      const rise = b.max.y - a.max.y,
        apart = gap(a, b);
      if (
        b.mantleable &&
        rise > PLACEHOLDER.jump ** 2 / (2 * PLACEHOLDER.gravity) &&
        rise <= mantleReach &&
        apart <= 1.5
      )
        mantle.push({ from: a.id, to: b.id, rise });
      else if (
        rise > METRICS.stepHeight &&
        rise <= wallGain &&
        apart <= runLength
      ) {
        const wall = walls.find(
          (w) => w !== a && w !== b && gap(w, a) <= 3 && gap(w, b) <= 3,
        );
        if (wall) wallRun.push({ from: a.id, to: b.id, rise, wall: wall.id });
      }
    }
  const zones = level.zones.map((zone) => {
    const near = new Set(
      platforms
        .filter(
          (b) =>
            Math.hypot(
              (b.min.x + b.max.x) / 2 - zone.position.x,
              (b.min.z + b.max.z) / 2 - zone.position.z,
            ) <= 30,
        )
        .map((b) => b.id),
    );
    const viaMantle = mantle.filter((e) => near.has(e.to)),
      viaWallRun = wallRun.filter((e) => near.has(e.to));
    return {
      zone: zone.id,
      mantleRoutes: viaMantle.length,
      wallRunRoutes: viaWallRun.length,
      platformsWithAdvancedEntry: new Set(
        [...viaMantle, ...viaWallRun].map((e) => e.to),
      ).size,
      examples: [...viaMantle, ...viaWallRun]
        .sort((x, y) => y.rise - x.rise)
        .slice(0, 3)
        .map((e) => `${e.from} -> ${e.to} (+${e.rise.toFixed(1)} m)`),
    };
  });
  return {
    reach: { mantle: mantleReach, wallRun: wallGain, runLength },
    mantleRoutes: mantle.length,
    wallRunRoutes: wallRun.length,
    zones,
  };
}
export function validateLevel(level: Level): string[] {
  const parsed = levelSchema.safeParse(level);
  if (!parsed.success) return parsed.error.issues.map((i) => i.message);
  const errors: string[] = [],
    boxes = level.colliders.filter((b) => !b.decor),
    spawns = level.spawns.filter((s) => s.type === 'player');
  if (spawns.length < 12) errors.push('Fewer than 12 player spawns');
  const ids = new Set<string>();
  for (const b of boxes) {
    if (ids.has(b.id)) errors.push('Duplicate collider ' + b.id);
    ids.add(b.id);
    for (const axis of ['x', 'y', 'z'] as const) {
      if (
        b.max[axis] - b.min[axis] <
        (b.visualId && /\/tip-[xz]$/.test(b.id) ? 0.0009 : 0.05 - 1e-8)
      )
        errors.push('Undersized collider ' + b.id);
      if (
        b.min[axis] < level.bounds.min[axis] ||
        b.max[axis] > level.bounds.max[axis]
      )
        errors.push('Outside bounds ' + b.id);
    }
  }
  for (const [i, s] of spawns.entries()) {
    const p = s.position;
    if (
      boxes.some(
        (b) =>
          p.x + METRICS.radius > b.min.x &&
          p.x - METRICS.radius < b.max.x &&
          p.z + METRICS.radius > b.min.z &&
          p.z - METRICS.radius < b.max.z &&
          p.y + METRICS.height > b.min.y + 0.001 &&
          p.y < b.max.y - 0.001,
      )
    )
      errors.push('Spawn obstructed ' + i);
    if (
      spawns.some(
        (t, j) =>
          j !== i &&
          Math.hypot(p.x - t.position.x, p.z - t.position.z) <
            METRICS.radius * 2,
      )
    )
      errors.push('Spawn spacing ' + i);
  }
  // Directed surface graph: full step-height limit and ballistic horizontal reach.
  // Structural chimney/column tops are not walkable platforms. All usable roofs are.
  // These conservative rules intentionally keep the retired placeholder jump.
  const PHYSICS = PLACEHOLDER;
  const platforms = boxes.filter((b) => b.platform),
    seen = new Set(platforms.filter((b) => b.max.y <= 0.001).map((b) => b.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of platforms) {
      if (seen.has(b.id)) continue;
      if (
        platforms.some((a) => {
          if (!seen.has(a.id)) return false;
          const rise = b.max.y - a.max.y;
          if (rise > METRICS.stepHeight + 1e-6) return false;
          const dx = Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x),
            dz = Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z);
          const flight =
            (PHYSICS.jump +
              Math.sqrt(
                PHYSICS.jump ** 2 - 2 * PHYSICS.gravity * Math.max(0, rise),
              )) /
            PHYSICS.gravity;
          return (
            Math.hypot(dx, dz) + METRICS.radius * 2 <=
            PHYSICS.sprint * flight * 0.85
          );
        })
      ) {
        seen.add(b.id);
        changed = true;
      }
    }
  }
  for (const b of platforms)
    if (!seen.has(b.id)) errors.push('Unreachable platform ' + b.id);
  if (errors.length) return [...new Set(errors)];
  const sealed = confinement(level);
  if (sealed.boundary) errors.push('Reachable region touches outer boundary');
  for (const id of sealed.elevatedEscapes)
    errors.push('Elevated escape route ' + id);
  for (const zone of sealed.unreachable)
    errors.push('Unreachable zone ' + zone);
  return [...new Set(errors)];
}
