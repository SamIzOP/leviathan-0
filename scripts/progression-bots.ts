import { writeFile } from 'node:fs/promises';
import { getLevel, levelWorld } from '../packages/shared/src/level';
import { PHYSICS } from '../packages/shared/src/config';
import { runProbe, type Maneuver } from './escape-search';
import { progressionAudit } from '../packages/shared/src/progression-audit';
const level = getLevel(),
  world = levelWorld(level),
  failures: unknown[] = [],
  modes = new Set<string>();
let probes = 0;
const maneuvers: Maneuver[] = [
  'leap',
  'coyote-leap',
  'hop-chain',
  'climb',
  'wall-chain-left',
  'wall-chain-right',
];
const clear = (x: number, y: number, z: number) =>
  !world.query!(x - 0.4, z - 0.4, x + 0.4, z + 0.4).some(
    (c) =>
      c.min.x < x + 0.4 &&
      c.max.x > x - 0.4 &&
      c.min.z < z + 0.4 &&
      c.max.z > z - 0.4 &&
      c.min.y < y + PHYSICS.height &&
      c.max.y > y + 0.01,
  );
for (let i = 0; i < level.zones.length; i++)
  for (let j = i + 1; j < level.zones.length; j++) {
    const a = level.zones[i]!,
      b = level.zones[j]!,
      ab = a.bounds!,
      bb = b.bounds!;
    for (const axis of ['x', 'z'] as const) {
      const other = axis === 'x' ? 'z' : 'x';
      if (
        Math.abs(ab.max[axis] - bb.min[axis]) > 0.01 &&
        Math.abs(bb.max[axis] - ab.min[axis]) > 0.01
      )
        continue;
      const at =
          Math.abs(ab.max[axis] - bb.min[axis]) < 0.01
            ? ab.max[axis]
            : bb.max[axis],
        lo = Math.max(ab.min[other], bb.min[other]),
        hi = Math.min(ab.max[other], bb.max[other]);
      if (hi - lo < 2) continue;
      const gate = level.gates.find(
        (g) => g.connects?.includes(a.id) && g.connects.includes(b.id),
      );
      for (let t = lo + 6; t < hi - 5; t += 10)
        for (const side of [-1, 1]) {
          const x = axis === 'x' ? at + side * 10 : t,
            z = axis === 'z' ? at + side * 10 : t;
          const heights = [
            0,
            ...level.colliders
              .filter(
                (c) =>
                  c.max.y < 30 &&
                  c.min.x <= x &&
                  c.max.x >= x &&
                  c.min.z <= z &&
                  c.max.z >= z,
              )
              .map((c) => c.max.y),
          ];
          for (const y of [...new Set(heights)]) {
            if (!clear(x, y, z)) continue;
            for (const maneuver of maneuvers) {
              const probe = {
                start: { x, y, z },
                yaw:
                  axis === 'x' ? (side * Math.PI) / 2 : side > 0 ? 0 : Math.PI,
                maneuver,
                runup: 20,
                source: `${a.id}/${b.id}`,
              };
              let last = { ...probe.start };
              const result = runProbe(world, probe, 480, (p) => {
                const crossing = (last[axis] - at) * (p[axis] - at) < 0;
                const throughGate =
                  gate &&
                  Math.abs(p[other] - gate.position[other]) <=
                    gate.width! / 2 + 0.1 &&
                  p.y < 7;
                last = { ...p };
                return (
                  crossing && !throughGate && p[other] > lo && p[other] < hi
                );
              });
              probes++;
              result.modes.forEach((m) => modes.add(m));
              if (result.escaped) failures.push({ probe, result });
            }
          }
        }
    }
  }
const flood = progressionAudit(level),
  report = {
    pass: !failures.length && !flood.errors.length,
    probes,
    modes: [...modes],
    failures,
    flood,
  };
await writeFile(
  'docs/layout/progression-audit.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
