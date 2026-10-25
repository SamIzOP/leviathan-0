import type { Level } from './level';
import { makeEntity, stepPlayer } from './movement';
import { FLAG } from './config';
import { spatialWorld } from './spatial-grid';
import type { Vec3 } from './types';
type Solid = NonNullable<Level['solids']>[number];
function inShape(s: Solid, p: Vec3, margin = 0) {
  const dx = (p.x - s.position.x) / (s.size.x / 2 + margin),
    dy = (p.y - s.position.y) / (s.size.y / 2 + margin),
    dz = (p.z - s.position.z) / (s.size.z / 2 + margin);
  if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) > 1 + 1e-6)
    return false;
  if (!s.shape.startsWith('cylinder')) return true;
  const u = dx,
    w = s.shape === 'cylinderZ' ? dy : dz;
  // Face normals of the rendered regular dodecagon.
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) * Math.PI) / 6;
    if (u * Math.sin(a) + w * Math.cos(a) > Math.cos(Math.PI / 12) + 1e-6)
      return false;
  }
  return true;
}
export function boundsAudit(level: Level) {
  const errors: string[] = [],
    byId = new Map(level.colliders.map((c) => [c.id, c]));
  for (const s of level.solids ?? []) {
    const boxes = s.colliderIds.map((id) => byId.get(id)).filter((c) => !!c);
    if (boxes.length !== s.colliderIds.length || !boxes.length) {
      errors.push(`${s.id}: missing collider at ${JSON.stringify(s.position)}`);
      continue;
    }
    let covered = 0,
      samples = 0;
    for (let ix = 0; ix < 32; ix++)
      for (let iz = 0; iz < 32; iz++)
        for (const yy of [-0.4, -0.2, 0, 0.2, 0.4]) {
          // Equal-area cell centres avoid over-weighting zero-area polygon vertices.
          const p = {
            x: s.position.x + ((ix + 0.5) / 32 - 0.5) * s.size.x,
            y: s.position.y + yy * s.size.y,
            z: s.position.z + ((iz + 0.5) / 32 - 0.5) * s.size.z,
          };
          if (!inShape(s, p)) continue;
          samples++;
          if (
            boxes.some(
              (b) =>
                p.x >= b.min.x - 1e-6 &&
                p.x <= b.max.x + 1e-6 &&
                p.y >= b.min.y - 1e-6 &&
                p.y <= b.max.y + 1e-6 &&
                p.z >= b.min.z - 1e-6 &&
                p.z <= b.max.z + 1e-6,
            )
          )
            covered++;
        }
    if (covered / samples < 0.9)
      errors.push(
        `${s.id}: ${((100 * covered) / samples).toFixed(1)}% coverage at ${JSON.stringify(s.position)}`,
      );
    for (const b of boxes)
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z])
            if (!inShape(s, { x, y, z }, 0.05)) {
              errors.push(`${b.id}: protrudes beyond ${s.id}`);
              break;
            }
  }
  for (const c of level.colliders)
    if (
      c.clip ||
      !c.visualId ||
      !level.solids?.some((s) => s.id === c.visualId)
    )
      errors.push(`${c.id}: collider has no visible solid`);
  for (const d of level.decor) {
    if (d.collision !== 'decor' || !d.reason)
      errors.push(`${d.id}: unclassified decor`);
    if (d.reason === 'small' && Math.min(d.size.x, d.size.z) > 0.3)
      errors.push(`${d.id}: oversized small decor`);
    if (d.reason === 'overhead') {
      const bottom = d.position.y - d.size.y / 2;
      const below = level.colliders.filter(
        (c) =>
          c.min.y < d.position.y + d.size.y / 2 &&
          c.min.x < d.position.x + d.size.x / 2 - 1e-5 &&
          c.max.x > d.position.x - d.size.x / 2 + 1e-5 &&
          c.min.z < d.position.z + d.size.z / 2 - 1e-5 &&
          c.max.z > d.position.z - d.size.z / 2 + 1e-5,
      );
      const top = Math.max(0, ...below.map((c) => c.max.y));
      if (bottom - top < 3 - 1e-5)
        errors.push(
          `${d.id}: overhead clearance ${(bottom - top).toFixed(2)}m`,
        );
    }
  }
  return [...new Set(errors)];
}
/** Isolated-object straight walks prevent adjacent walls hiding a missing collider.
 * Every substantial mesh is approached on all four faces with the real integrator. */
export function wallWalkAudit(level: Level) {
  const errors: string[] = [],
    byId = new Map(level.colliders.map((c) => [c.id, c]));
  let probes = 0;
  for (const s of level.solids ?? []) {
    if (s.size.y < 1.01 || Math.min(s.size.x, s.size.z) < 0.3) continue;
    const boxes = s.colliderIds.map((id) => byId.get(id)!).filter(Boolean),
      floor = s.position.y - s.size.y / 2;
    const world = spatialWorld(floor, boxes);
    for (const axis of ['x', 'z'] as const)
      for (const side of [-1, 1]) {
        let e: ReturnType<typeof makeEntity> = {
          ...makeEntity('wall-audit'),
          position: { ...s.position, y: floor },
          flags: FLAG.grounded,
        };
        e.position[axis] += side * (s.size[axis] / 2 + 1);
        const start = e.position[axis];
        const yaw =
          axis === 'x' ? (side * Math.PI) / 2 : side === 1 ? 0 : Math.PI;
        for (let t = 0; t < 90; t++)
          e = stepPlayer(
            e,
            { seq: t, tick: t, x: 0, z: 1, yaw, pitch: 0, buttons: 2 },
            1 / 60,
            world,
          );
        probes++;
        const opposite = s.position[axis] - (side * s.size[axis]) / 2;
        if (
          side * (e.position[axis] - opposite) < -0.4 &&
          e.position.y < floor + s.size.y - 0.1
        )
          errors.push(
            `${s.id}: ${axis}/${side} crossed (${start} -> ${e.position[axis]})`,
          );
      }
  }
  return { probes, errors };
}
