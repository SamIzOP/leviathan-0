import { mkdir, writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
import {
  routeAudit,
  criticalPathRun,
} from '../packages/shared/src/layout-audit';
const level = getLevel();
const report = {
  routeErrors: routeAudit(level),
  run: criticalPathRun(level),
  rooms: level.rooms?.length,
  archetypes: new Set(level.buildings.map((b) => b.archetype)).size,
  cover: level.coverPoints?.length,
  markers: level.markers?.length,
  dressing: level.zones.map((z) => ({
    id: z.id,
    solid: level.solids?.filter((s) => s.zone === z.id).length,
    decor: level.decor.filter((s) => s.zone === z.id).length,
  })),
};
await mkdir('docs/layout', { recursive: true });
await writeFile('docs/layout/check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.routeErrors.length || !report.run.passed) process.exitCode = 1;
