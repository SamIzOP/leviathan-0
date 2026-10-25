import type { Level } from './level';
import { spatialWorld } from './spatial-grid';
import { stepPlayer, makeEntity } from './movement';
import { BUTTON, FLAG } from './config';
export function pathLength(level: Level) {
  return (level.criticalPath ?? []).slice(1).reduce((sum, p, i) => {
    const a = level.criticalPath![i]!;
    return sum + Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
  }, 0);
}
export function routeAudit(level: Level) {
  const errors: string[] = [],
    world = spatialWorld(level.bounds.min.y, level.colliders);
  for (const route of level.routes ?? []) {
    if (!['primary', 'flank'].includes(route.kind)) continue;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!,
        length = Math.hypot(b.x - a.x, b.z - a.z),
        dx = (b.x - a.x) / length,
        dz = (b.z - a.z) / length;
      for (let t = 0; t <= length; t += 1) {
        const x = a.x + dx * t,
          z = a.z + dz * t,
          y = a.y + ((b.y - a.y) * t) / length;
        // Width is perpendicular to travel; 0.4 m longitudinal hull.
        const rx = (Math.abs(dz) * route.width) / 2 + Math.abs(dx) * 0.4,
          rz = (Math.abs(dx) * route.width) / 2 + Math.abs(dz) * 0.4;
        const blocked = world.query!(x - rx, z - rz, x + rx, z + rz).find(
          (c) =>
            c.max.y > y + 0.05 &&
            c.min.y < y + 3.2 &&
            c.min.x < x + rx - 1e-5 &&
            c.max.x > x - rx + 1e-5 &&
            c.min.z < z + rz - 1e-5 &&
            c.max.z > z - rz + 1e-5,
        );
        if (blocked) {
          errors.push(
            `${route.id} segment ${i} at (${x.toFixed(1)},${z.toFixed(1)}): ${blocked.id}`,
          );
          break;
        }
      }
    }
  }
  return errors;
}
/** Follows the waypoint list with actual shared acceleration/collision, never teleports. */
export function criticalPathRun(level: Level) {
  const world = spatialWorld(level.bounds.min.y, level.colliders),
    path = level.criticalPath!;
  let entity: ReturnType<typeof makeEntity> = {
      ...makeEntity('route-bot'),
      position: { ...path[0]! },
      flags: FLAG.grounded,
    },
    tick = 0;
  const reached: number[] = [],
    stalls: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!,
      start = tick;
    while (
      Math.hypot(p.x - entity.position.x, p.z - entity.position.z) > 0.16 &&
      tick - start < 6000
    ) {
      const dx = p.x - entity.position.x,
        dz = p.z - entity.position.z;
      entity = stepPlayer(
        entity,
        {
          seq: tick,
          tick,
          x: 0,
          z: 1,
          yaw: Math.atan2(-dx, -dz),
          pitch: 0,
          buttons: BUTTON.sprint,
        },
        1 / 60,
        world,
      );
      tick++;
    }
    if (tick - start >= 6000) {
      stalls.push(
        `waypoint ${i}: ${JSON.stringify(entity.position)} -> ${JSON.stringify(p)}`,
      );
      break;
    }
    reached.push(i);
  }
  return {
    passed: !stalls.length,
    elapsed: tick / 60,
    reached: reached.length,
    waypoints: path.length,
    length: pathLength(level),
    capSeconds: pathLength(level) / 16,
    sprintSeconds: pathLength(level) / 8,
    stalls,
  };
}
