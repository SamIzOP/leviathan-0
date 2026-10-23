import { getLevel } from '../packages/shared/src/level';
import { writeFile } from 'node:fs/promises';
const level = getLevel(),
  errors = [];
for (const d of level.decor.filter((d) => d.reason === 'overhead')) {
  const bottom = d.position.y - d.size.y / 2;
  const below = level.colliders.filter(
    (c) =>
      c.max.y <= bottom + 0.01 &&
      d.position.x >= c.min.x &&
      d.position.x <= c.max.x &&
      d.position.z >= c.min.z &&
      d.position.z <= c.max.z,
  );
  const highest = below.sort((a, b) => b.max.y - a.max.y)[0];
  if (highest && bottom - highest.max.y < 3)
    errors.push({ id: d.id, bottom, top: highest.max.y, surface: highest.id });
}
await writeFile(
  'docs/layout/overhead-audit.json',
  JSON.stringify(errors, null, 2),
);
console.log(JSON.stringify(errors, null, 2));
