import { LEVELS } from '@leviathan/shared';
import {
  advancedTraversal,
  validateLevel,
} from '../packages/shared/src/level-validation';
// `npm run level:check -- --advanced` adds the informational traversal report.
const advanced = process.argv.includes('--advanced');
for (const level of Object.values(LEVELS)) {
  const errors = validateLevel(level);
  console.log(
    JSON.stringify(
      {
        level: level.id,
        colliders: level.colliders.length,
        spawns: level.spawns.filter((s) => s.type === 'player').length,
        errors,
        ...(advanced ? { advancedTraversal: advancedTraversal(level) } : {}),
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}
