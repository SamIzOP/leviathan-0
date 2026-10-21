import { LEVELS } from '@leviathan/shared';
import { validateLevel } from '../packages/shared/src/level-validation';
for (const level of Object.values(LEVELS)) {
  const errors = validateLevel(level);
  console.log(
    JSON.stringify(
      {
        level: level.id,
        colliders: level.colliders.length,
        spawns: level.spawns.filter((s) => s.type === 'player').length,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}
