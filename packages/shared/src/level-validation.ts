import { levelSchema, type Level } from './level';
import { METRICS } from './metrics';
import { PHYSICS } from './config';
import { confinement } from './confinement';
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
      if (b.max[axis] - b.min[axis] < 0.05 - 1e-8)
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
