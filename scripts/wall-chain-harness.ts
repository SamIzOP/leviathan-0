import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  initialMove,
  makeEntity,
  stepPlayer,
} from '../packages/shared/src/movement';
import { reconcile } from '../packages/shared/src/prediction';
import { buildMovementLab } from '../packages/shared/src/movement-lab';
import type { Entity, Input, World } from '../packages/shared/src/types';
const dt = 1 / 60;
let seed = 12613;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};
const lab = buildMovementLab();
function course(width: number, flagged = true): World {
  const left = lab.colliders.find((b) => b.id === `lab-chain-${width}-left`)!;
  return {
    floor: 0,
    boxes: lab.colliders
      .filter((b) => b.id.startsWith(`lab-chain-${width}-`))
      .map((b) => ({
        ...b,
        id: b.id.endsWith('left') ? 'left' : 'right',
        wallRunnable: flagged,
        min: { x: b.min.x - left.max.x, y: b.min.y, z: b.min.z - 35 },
        max: { x: b.max.x - left.max.x, y: b.max.y, z: b.max.z - 35 },
      })),
  };
}
export function chain(
  width: number,
  noise = 0,
  flagged = true,
  steer = width === 10 ? 0.55 : 0.9,
  jumpAt = width === 10 ? 30 : 44,
  runFor = 30,
) {
  const world = course(width, flagged);
  let s: Entity = {
    ...makeEntity('chain'),
    flags: 0,
    position: { x: 0.55, y: 2, z: noise },
    velocity: { x: -1, y: 2, z: -8 },
    move: initialMove(false),
  };
  let flight = 0,
    runTicks = 0,
    target = 1,
    last = '',
    airJump = false;
  const contacts: string[] = [],
    inputs: Input[] = [],
    states: Entity[] = [s];
  for (let tick = 0; tick < 600; tick++) {
    const mode = s.move!.mode;
    let buttons = 0,
      z = 0,
      yaw = 0;
    const x = 0;
    if (mode === 'WALLRUN') {
      const wall = s.move!.wall!.id;
      if (wall !== last) {
        contacts.push(wall);
        last = wall;
        runTicks = 0;
        flight = 0;
        airJump = false;
        target = wall === 'left' ? 1 : -1;
      }
      if (contacts.length >= 4) break;
      if (++runTicks >= runFor) buttons = 1;
    } else if (contacts.length) {
      flight++;
      z = 1;
      yaw = Math.atan2(-target, steer) + (noise * Math.PI) / 180;
      if (flight >= jumpAt && !airJump) {
        buttons = 1;
        airJump = true;
      }
    }
    const input = { seq: tick + 1, tick, x, z, yaw, pitch: 0, buttons };
    inputs.push(input);
    s = stepPlayer(s, input, dt, world);
    states.push(s);
    if (s.position.y <= 0 && contacts.length > 0) break;
  }
  return { contacts, inputs, states, world };
}
const courses = [6, 8, 10].map((width) => {
  const best = chain(width);
  return {
    width,
    contacts: best.contacts,
    ticks: best.inputs.length,
    policy: {
      steer: width === 10 ? 0.55 : 0.9,
      jumpAt: width === 10 ? 30 : 44,
      runFor: 30,
    },
  };
});
let success = 0,
  unflagged = 0;
for (let i = 0; i < 200; i++) {
  const width = [6, 8, 10][i % 3]!,
    yaw = random() * 20 - 10,
    offset = random() - 0.5;
  const world = course(width);
  let s: Entity = {
    ...makeEntity('random'),
    flags: 0,
    position: { x: 1 + offset, y: 4, z: offset },
    velocity: { x: -2, y: i % 2 ? 3 : -3, z: -8 },
    move: initialMove(false),
  };
  s.move!.airJumps = 0;
  // Approach for at most .25s; includes starts outside probe and yaw/position noise.
  for (let t = 0; t < 30; t++) {
    s = stepPlayer(
      s,
      {
        seq: t + 1,
        tick: t,
        x: 0,
        z: 1,
        yaw: ((14 + yaw) * Math.PI) / 180,
        pitch: 0,
        buttons: t === 0 ? 1 : 0,
      },
      dt,
      world,
    );
    if (s.move!.mode === 'WALLRUN') {
      success++;
      break;
    }
  }
  const plain = course(width, false);
  s = {
    ...makeEntity('plain'),
    flags: 0,
    position: { x: 0.5, y: 2, z: offset },
    velocity: { x: -2, y: 0, z: -8 },
    move: initialMove(false),
  };
  for (let t = 0; t < 15; t++) {
    s = stepPlayer(
      s,
      {
        seq: t + 1,
        tick: t,
        x: 0,
        z: 1,
        yaw: (yaw * Math.PI) / 180,
        pitch: 0,
        buttons: 0,
      },
      dt,
      plain,
    );
    if (s.move!.mode === 'WALLRUN') {
      unflagged++;
      break;
    }
  }
}
// Rewind/replay every delayed snapshot of exactly the generated chain. Seeded 3% snapshot loss.
const prediction = [0, 150, 300].map((lag) => {
  const run = chain(8),
    delay = Math.ceil(lag / 1000 / dt);
  let max = 0,
    checks = 0;
  for (let t = delay; t < run.inputs.length; t++) {
    if (random() < 0.03) continue;
    const ack = Math.max(0, t - delay);
    const result = reconcile(
      run.states[ack]!,
      ack,
      run.inputs.slice(ack, t + 1),
      dt,
      run.world,
    ).state;
    const expected = run.states[t + 1]!;
    max = Math.max(
      max,
      Math.hypot(
        result.position.x - expected.position.x,
        result.position.y - expected.position.y,
        result.position.z - expected.position.z,
      ),
    );
    checks++;
  }
  return { lag, loss: 3, maxPredictionError: max, checks };
});
const sameWorld = course(8);
let same: Entity = {
  ...makeEntity('same'),
  flags: 0,
  position: { x: 0.5, y: 3, z: 0 },
  velocity: { x: -1, y: 1, z: -8 },
  move: initialMove(false),
};
let leftAt = -1,
  returnedAt = -1,
  usedDouble = false;
for (let t = 0; t < 240; t++) {
  let yaw = 0,
    buttons = 0,
    z = 0;
  if (t === 12) {
    buttons = 1;
    leftAt = t;
  }
  if (t > 12) {
    z = 1;
    yaw = t < 30 ? -Math.PI / 4 : Math.PI / 4;
  }
  if (t === 42) {
    buttons = 1;
    usedDouble = true;
  }
  same = stepPlayer(
    same,
    { seq: t + 1, tick: t, x: 0, z, yaw, pitch: 0, buttons },
    dt,
    sameWorld,
  );
  if (
    t > 12 &&
    same.move!.mode === 'WALLRUN' &&
    same.move!.wall!.id === 'left'
  ) {
    returnedAt = t;
    break;
  }
}
const report = {
  courses,
  randomized: { attempts: 200, success, rate: success / 200, unflagged },
  sameWall: {
    leftAt,
    returnedAt,
    seconds: (returnedAt - leftAt) * dt,
    usedDouble,
    airJumps: same.move!.airJumps,
  },
  prediction,
};
await mkdir('docs/screens/movement', { recursive: true });
await writeFile(
  'docs/screens/movement/chains.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
assert(
  courses.every((c) => c.contacts.length >= 4),
  'at least three alternating transitions',
);
assert(success >= 180);
assert.equal(unflagged, 0);
assert(prediction.every((p) => p.maxPredictionError < 1e-6));
assert(
  returnedAt - leftAt >= 36 && usedDouble && same.move!.airJumps === 0,
  'same-wall re-latch after lockout and double jump',
);
