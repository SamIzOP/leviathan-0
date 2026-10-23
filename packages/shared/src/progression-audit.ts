import type { Level } from './level';
import type { Vec3 } from './types';
import { PHYSICS } from './config';

/** Half-metre capsule-clearance graph. Closing each progression throat must
 * disconnect every later district, while leaving earlier districts reachable.
 * This complements (does not replace) the multilayer and movement-bot audits. */
export function progressionAudit(level: Level) {
  const cell = 0.5,
    min = level.bounds.min,
    max = level.bounds.max;
  const nx = Math.floor((max.x - min.x) / cell) + 1,
    nz = Math.floor((max.z - min.z) / cell) + 1;
  const base = new Uint8Array(nx * nz);
  const paint = (mask: Uint8Array, a: Vec3, b: Vec3) => {
    const x0 = Math.max(0, Math.ceil((a.x - PHYSICS.radius - min.x) / cell)),
      x1 = Math.min(nx - 1, Math.floor((b.x + PHYSICS.radius - min.x) / cell));
    const z0 = Math.max(0, Math.ceil((a.z - PHYSICS.radius - min.z) / cell)),
      z1 = Math.min(nz - 1, Math.floor((b.z + PHYSICS.radius - min.z) / cell));
    for (let z = z0; z <= z1; z++) mask.fill(1, z * nx + x0, z * nx + x1 + 1);
  };
  for (const c of level.colliders)
    if (c.min.y < PHYSICS.height && c.max.y > 0.18) paint(base, c.min, c.max);
  const index = (p: Vec3) =>
    Math.round((p.z - min.z) / cell) * nx + Math.round((p.x - min.x) / cell);
  const start = index(level.spawns.find((s) => s.type === 'player')!.position);
  const reach = (mask: Uint8Array) => {
    const dist = new Int32Array(nx * nz).fill(-1),
      queue = new Int32Array(nx * nz);
    let head = 0,
      tail = 0;
    if (mask[start]) return dist;
    queue[tail++] = start;
    dist[start] = 0;
    while (head < tail) {
      const i = queue[head++]!,
        x = i % nx,
        z = Math.floor(i / nx);
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < nx - 1 ? i + 1 : -1,
        z > 0 ? i - nx : -1,
        z < nz - 1 ? i + nx : -1,
      ]) {
        if (j < 0 || mask[j] || dist[j] !== -1) continue;
        dist[j] = dist[i]! + 1;
        queue[tail++] = j;
      }
    }
    return dist;
  };
  const open = reach(base),
    errors: string[] = [];
  const endpoints = level.zones.map((z) =>
    level
      .routes!.find((r) => r.zone === z.id && r.kind === 'primary')!
      .points.at(-1)!,
  );
  endpoints.forEach((p, i) => {
    if (open[index(p)]! < 0)
      errors.push(`Unreachable district ${level.zones[i]!.id}`);
  });
  const checks = [];
  for (const gate of level.gates.filter((g) => g.connects)) {
    const from = level.zones.find((z) => z.id === gate.connects![0])!,
      to = level.zones.find((z) => z.id === gate.connects![1])!;
    const alongX =
      Math.abs(from.bounds!.max.x - to.bounds!.min.x) < 0.01 ||
      Math.abs(to.bounds!.max.x - from.bounds!.min.x) < 0.01;
    const mask = base.slice(),
      p = gate.position,
      half = gate.width! / 2;
    paint(
      mask,
      { x: p.x - (alongX ? 2 : half), y: 0, z: p.z - (alongX ? half : 2) },
      { x: p.x + (alongX ? 2 : half), y: 40, z: p.z + (alongX ? half : 2) },
    );
    const reached = reach(mask),
      later = level.zones.indexOf(to),
      bypassed = level.zones
        .slice(later)
        .filter((_, i) => reached[index(endpoints[later + i]!)]! >= 0)
        .map((z) => z.id);
    if (bypassed.length)
      errors.push(`${gate.id}: bypass to ${bypassed.join(', ')}`);
    checks.push({ gate: gate.id, blockedLater: !bypassed.length });
  }
  return {
    errors,
    checks,
    gridMetres: cell,
    shortestGroundManhattan: open[index(endpoints.at(-1)!)]! * cell,
  };
}
