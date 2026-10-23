import { writeFile, mkdir } from 'node:fs/promises';
import {
  initialMove,
  makeEntity,
  stepPlayer,
  wallCandidates,
} from '../packages/shared/src/movement';
import { MOVE, PHYSICS } from '../packages/shared/src/config';
import type { Entity, World } from '../packages/shared/src/types';
const phase = process.argv[2] ?? 'after';
const world: World = {
  floor: 0,
  boxes: [
    {
      id: 'wall',
      wallRunnable: true,
      min: { x: 0, y: 0, z: -100 },
      max: { x: 1, y: 20, z: 100 },
    },
  ],
};
const rows = [];
for (const angle of [15, 30, 45, 60, 75, 85])
  for (const speed of [4.5, 6, 8, 10])
    for (const gap of [0.02, 0.15, 0.25, 0.4])
      for (const kind of [
        'double-used',
        'double-press',
        'same-wall',
        'other-wall',
      ]) {
        const a = (angle * Math.PI) / 180;
        const s: Entity = {
          ...makeEntity('probe'),
          position: { x: -PHYSICS.radius - gap, y: 2, z: 0 },
          velocity: { x: speed * Math.sin(a), y: -1, z: -speed * Math.cos(a) },
          flags: 0,
          move: initialMove(false),
        };
        s.move!.airJumps = kind === 'double-used' ? 0 : 1;
        if (kind.includes('wall'))
          s.move!.lockouts = [
            { id: kind === 'same-wall' ? 'wall' : 'previous-wall', ticks: 36 },
          ];
        const input = {
          seq: 1,
          tick: 1,
          x: 0,
          z: 1,
          yaw: -a,
          pitch: 0,
          buttons: kind === 'double-press' ? 1 : 0,
        };
        let reported = '';
        const after = stepPlayer(s, input, 1 / 60, world, MOVE, (d) => {
          reported = d.reason;
        });
        const probe = wallCandidates(
          world.boxes,
          after.position,
          MOVE.wallRunReach,
        )[0];
        const reason =
          after.move?.mode === 'WALLRUN'
            ? 'ATTACHED'
            : kind === 'same-wall'
              ? 'SAME_WALL_LOCKOUT'
              : !probe
                ? 'TOO_FAR'
                : Math.hypot(after.velocity.x, after.velocity.z) <
                    MOVE.wallRunMinSpeed
                  ? 'TOO_SLOW'
                  : 'BAD_ANGLE';
        rows.push({
          angle,
          speed,
          gap,
          kind,
          attached: after.move?.mode === 'WALLRUN',
          reason: reported || reason,
        });
      }
await mkdir('docs/screens/movement', { recursive: true });
await writeFile(
  `docs/screens/movement/wall-${phase}.json`,
  JSON.stringify(rows, null, 2),
);
console.log(
  JSON.stringify({
    phase,
    total: rows.length,
    attached: rows.filter((r) => r.attached).length,
    failures: rows.filter((r) => !r.attached).length,
    byReason: rows.reduce(
      (a, r) => ({ ...a, [r.reason]: (a[r.reason] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
  }),
);
