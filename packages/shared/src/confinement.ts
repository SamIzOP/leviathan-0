import type { Level } from './level';
import { spatialWorld } from './spatial-grid';
import { METRICS } from './metrics';
import { makeEntity, stepPlayer } from './movement';
import { BUTTON, FLAG } from './config';
/** One-metre multilayer flood graph, capsule clearance at every sampled surface.
 * Adjacent cells permit the existing <=80%-jump ascent and ordinary stair steps.
 * Narrow barriers are tested along the connecting segment as well as at endpoints.
 */
export function confinement(level: Level) {
  const world = spatialWorld(
    level.bounds.min.y,
    level.colliders.filter((b) => !b.decor),
  );
  const xmin = Math.ceil(level.bounds.min.x),
    xmax = Math.floor(level.bounds.max.x);
  const zmin = Math.ceil(level.bounds.min.z),
    zmax = Math.floor(level.bounds.max.z);
  const nodes = new Map<string, { x: number; y: number; z: number }[]>();
  const radius = METRICS.radius;
  for (let x = xmin; x <= xmax; x++)
    for (let z = zmin; z <= zmax; z++) {
      const boxes = world.query!(
        x - radius,
        z - radius,
        x + radius,
        z + radius,
      );
      const heights = [
        ...new Set(
          boxes
            .filter(
              (b) =>
                x + radius > b.min.x &&
                x - radius < b.max.x &&
                z + radius > b.min.z &&
                z - radius < b.max.z,
            )
            .map((b) => b.max.y),
        ),
      ];
      const valid = heights.filter(
        (y) =>
          y >= level.killY &&
          !boxes.some(
            (b) =>
              y < b.max.y - 1e-5 &&
              y + METRICS.height > b.min.y + 1e-5 &&
              x + radius > b.min.x &&
              x - radius < b.max.x &&
              z + radius > b.min.z &&
              z - radius < b.max.z,
          ),
      );
      nodes.set(
        `${x},${z}`,
        valid.map((y) => ({ x, y, z })),
      );
    }
  const key = (p: { x: number; y: number; z: number }) =>
    `${p.x},${p.y.toFixed(4)},${p.z}`;
  const seen = new Set<string>(),
    queue: { x: number; y: number; z: number }[] = [];
  for (const spawn of level.spawns.filter((s) => s.type === 'player')) {
    const near =
      nodes.get(
        `${Math.round(spawn.position.x)},${Math.round(spawn.position.z)}`,
      ) ?? [];
    const node = near.find((p) => Math.abs(p.y - spawn.position.y) < 0.5);
    if (node && !seen.has(key(node))) {
      seen.add(key(node));
      queue.push(node);
    }
  }
  let boundary = false;
  for (let index = 0; index < queue.length; index++) {
    const p = queue[index]!;
    if (
      p.x <= xmin + 1 ||
      p.x >= xmax - 1 ||
      p.z <= zmin + 1 ||
      p.z >= zmax - 1
    )
      boundary = true;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (const next of nodes.get(`${p.x + dx!},${p.z + dz!}`) ?? []) {
        if (
          seen.has(key(next)) ||
          next.y - p.y > METRICS.stepHeight + 1e-5 ||
          p.y - next.y > METRICS.stepHeight + 1e-5
        )
          continue;
        const mx = (p.x + next.x) / 2,
          mz = (p.z + next.z) / 2,
          y = Math.max(p.y, next.y);
        const blocked = world.query!(
          mx - radius,
          mz - radius,
          mx + radius,
          mz + radius,
        ).some(
          (b) =>
            b.min.x < mx + radius &&
            b.max.x > mx - radius &&
            b.min.z < mz + radius &&
            b.max.z > mz - radius &&
            b.min.y < y + METRICS.height - 1e-5 &&
            b.max.y > y + 1e-5,
        );
        if (blocked) continue;
        seen.add(key(next));
        queue.push(next);
      }
    }
  }
  const unreachable = level.zones
    .filter(
      (zone) =>
        !queue.some(
          (p) =>
            Math.hypot(p.x - zone.position.x, p.z - zone.position.z) < 3 &&
            Math.abs(p.y - zone.position.y) < 1,
        ),
    )
    .map((z) => z.id);
  // A floor-only flood cannot see a long descending jump over a shorter wall.
  // Probe exposed elevated edges near the perimeter using the real integrator.
  const elevatedEscapes: string[] = [];
  let elevatedProbes = 0;
  for (const b of level.colliders.filter(
    (b) =>
      b.platform &&
      b.max.y > 12 &&
      Math.min(b.max.x - b.min.x, b.max.z - b.min.z) >= 1.4 &&
      Math.min(b.min.x + 107, 107 - b.max.x, b.min.z + 87, 87 - b.max.z) < 22,
  )) {
    for (const x of [b.min.x + 0.5, (b.min.x + b.max.x) / 2, b.max.x - 0.5])
      for (const z of [b.min.z + 0.5, (b.min.z + b.max.z) / 2, b.max.z - 0.5]) {
        const y = b.max.y;
        if (
          world.query!(x - radius, z - radius, x + radius, z + radius).some(
            (c) =>
              x + radius > c.min.x &&
              x - radius < c.max.x &&
              z + radius > c.min.z &&
              z - radius < c.max.z &&
              y < c.max.y - 1e-6 &&
              y + METRICS.height > c.min.y + 1e-6,
          )
        )
          continue;
        for (let direction = 0; direction < 8; direction++) {
          let entity = { ...makeEntity('escape'), position: { x, y, z } };
          elevatedProbes++;
          for (let tick = 0; tick < 240; tick++) {
            entity = stepPlayer(
              entity,
              {
                seq: tick,
                tick,
                x: 0,
                z: 1,
                yaw: (direction * Math.PI) / 4,
                pitch: 0,
                // Placeholder rule: sprint and jump again on every landing (no air jump).
                buttons:
                  BUTTON.sprint |
                  (entity.flags & FLAG.grounded ? BUTTON.jump : 0),
              },
              1 / 60,
              world,
            );
            if (
              Math.abs(entity.position.x) >= 107 ||
              Math.abs(entity.position.z) >= 87
            ) {
              elevatedEscapes.push(b.id);
              break;
            }
          }
        }
      }
  }
  return {
    boundary,
    unreachable,
    visited: seen.size,
    highest: Math.max(...queue.map((p) => p.y)),
    elevatedProbes,
    elevatedEscapes: [...new Set(elevatedEscapes)],
    entranceRoofAccess: queue
      .filter((p) => p.x >= -34 && p.x <= -26 && p.z >= 62 && p.z <= 70)
      .reduce((top, p) => (p.y > top.y ? p : top), { x: 0, y: 0, z: 0 }),
  };
}
