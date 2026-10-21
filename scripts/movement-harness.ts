/** Headless movement harness: scripted input sequences through the shared module.
 * Prints a measured table and fails when a value leaves its MOVE_TARGETS range. */
import { writeFile, mkdir } from 'node:fs/promises';
import {
  BUTTON,
  MOVE_TARGETS,
  PHYSICS,
  makeEntity,
  stepPlayer,
} from '../packages/shared/src/index';
import { stairRun } from '../packages/shared/src/stairs';
import { spatialWorld } from '../packages/shared/src/spatial-grid';
import type { Box, Entity, Input, World } from '../packages/shared/src/types';
const DT = 1 / 60;
const { jump: J, sprint: S, crouch: C } = BUTTON;
type Script = (tick: number, s: Entity) => Partial<Input>;
function run(
  world: World,
  start: Entity,
  ticks: number,
  script: Script,
  stop?: (s: Entity, tick: number) => boolean,
) {
  const states: Entity[] = [];
  let s = start;
  for (let tick = 0; tick < ticks; tick++) {
    s = stepPlayer(
      s,
      {
        seq: tick + 1,
        tick,
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        buttons: 0,
        ...script(tick, s),
      },
      DT,
      world,
    );
    states.push(s);
    if (stop?.(s, tick)) break;
  }
  return states;
}
const at = (x: number, y: number, z: number): Entity => ({
  ...makeEntity('harness'),
  position: { x, y, z },
});
const hspeed = (s: Entity) => Math.hypot(s.velocity.x, s.velocity.z);
const mode = (s: Entity) => s.move?.mode ?? 'GROUND';
const flat: World = spatialWorld(0, [
  { min: { x: -200, y: -1, z: -200 }, max: { x: 200, y: 0, z: 200 } },
]);
const floor: Box = {
  min: { x: -200, y: -1, z: -200 },
  max: { x: 200, y: 0, z: 200 },
};
const results: {
  name: keyof typeof MOVE_TARGETS;
  value: number;
  unit: string;
  note: string;
}[] = [];
const record = (
  name: keyof typeof MOVE_TARGETS,
  value: number,
  unit: string,
  note = '',
) => results.push({ name, value, unit, note });

// Top speeds and sprint acceleration (forward is -z at yaw 0).
{
  const walk = run(flat, at(0, 0, 0), 120, () => ({ z: 1 }));
  record('walkTopSpeed', hspeed(walk.at(-1)!), 'm/s');
  const sprint = run(flat, at(0, 0, 0), 120, () => ({ z: 1, buttons: S }));
  record('sprintTopSpeed', hspeed(sprint.at(-1)!), 'm/s');
  const accel = run(flat, at(0, 0, 0), 180, (t) => ({
    z: 1,
    buttons: t >= 60 ? S : 0,
  }));
  const reached = accel.findIndex((s, t) => t >= 60 && hspeed(s) >= 7.99);
  record('sprintAccelSeconds', (reached - 59) * DT, 's', 'walk → 8 m/s');
}
// Jump apex and air jump apex (pressed at the first descending tick).
{
  const jump = run(flat, at(0, 0, 0), 90, (t) => ({ buttons: t < 2 ? J : 0 }));
  record('jumpApex', Math.max(...jump.map((s) => s.position.y)), 'm');
  let pressed = -1;
  const double = run(flat, at(0, 0, 0), 150, (t, s) => {
    if (pressed < 0 && t > 2 && s.velocity.y <= 0) pressed = t;
    return { buttons: t < 2 || (pressed >= 0 && t < pressed + 2) ? J : 0 };
  });
  record(
    'doubleJumpApex',
    Math.max(...double.map((s) => s.position.y)),
    'm',
    'press at apex',
  );
}
// Sprint jump distance.
{
  const states = run(flat, at(0, 0, 0), 200, (t) => ({
    z: 1,
    buttons: S | (t >= 90 && t < 92 ? J : 0),
  }));
  const takeoff = states[89]!.position.z,
    land = states.findIndex((s, t) => t > 92 && mode(s) !== 'AIR');
  record(
    'sprintJumpDistance',
    Math.abs(states[land]!.position.z - takeoff),
    'm',
  );
}
// Slide: entry, duration, distance and slide-jump speed.
{
  const states = run(flat, at(0, 0, 0), 300, (t) => ({
    z: 1,
    buttons: S | (t >= 60 ? C : 0),
  }));
  const begin = states.findIndex((s) => mode(s) === 'SLIDE');
  const end = states.findIndex((s, t) => t > begin && mode(s) !== 'SLIDE');
  record('slideEntrySpeed', hspeed(states[begin]!), 'm/s', 'from 8 m/s sprint');
  record('slideSeconds', (end - begin) * DT, 's', 'decays to 4 m/s');
  record(
    'slideDistance',
    Math.abs(states[end]!.position.z - states[begin - 1]!.position.z),
    'm',
  );
  const jump = run(flat, at(0, 0, 0), 120, (t) => ({
    z: 1,
    buttons: S | (t >= 60 ? C : 0) | (t >= 75 && t < 77 ? J : 0),
  }));
  record('slideJumpSpeed', hspeed(jump[75]!), 'm/s', 'jump 0.25 s into slide');
}
// Wall-run on a long runnable wall: sprint parallel, jump, steer in, hold.
const wallWorld = spatialWorld(0, [
  floor,
  {
    id: 'wall',
    wallRunnable: true,
    min: { x: 1, y: 0, z: -80 },
    max: { x: 2, y: 8, z: 10 },
  },
]);
// Full run: jump, air jump at the apex, then steer in so the latch happens high.
const wallRun = (jumpAt: number) => {
  let apex = -1,
    latched = false;
  return run(wallWorld, at(0.2, 0, 8), 300, (t, s) => {
    if (apex < 0 && t > 42 && s.velocity.y <= 0) apex = t;
    latched ||= mode(s) === 'WALLRUN';
    const press =
      (t >= 40 && t < 42) ||
      (apex >= 0 && t >= apex && t < apex + 2) ||
      (jumpAt > 0 && t >= jumpAt && t < jumpAt + 2);
    return {
      z: 1,
      x: apex >= 0 && !latched ? 1 : 0,
      buttons: S | (press ? J : 0),
    };
  });
};
{
  const states = wallRun(0);
  const begin = states.findIndex((s) => mode(s) === 'WALLRUN');
  const end = states.findIndex((s, t) => t > begin && mode(s) !== 'WALLRUN');
  if (begin < 0) throw new Error('wall-run never started');
  record('wallRunSeconds', (end - begin) * DT, 's', 'to time limit');
  record('wallRunExitSpeed', hspeed(states[end - 1]!), 'm/s');
  const latchY = states[begin]!.position.y;
  record(
    'wallRunPeakRise',
    Math.max(...states.slice(begin, end).map((s) => s.position.y)) - latchY,
    'm',
  );
  const kick = wallRun(begin + 40);
  const after = kick[begin + 40]!;
  record('wallJumpAway', -after.velocity.x, 'm/s');
  record('wallJumpUp', after.velocity.y, 'm/s');
  record('wallJumpAlong', -after.velocity.z, 'm/s');
}
// Mantle a 1.5 m ledge from a standing jump.
{
  const ledge = spatialWorld(0, [
    floor,
    {
      id: 'ledge',
      mantleable: true,
      min: { x: -2, y: 0, z: -4 },
      max: { x: 2, y: 1.5, z: -2 },
    },
  ]);
  const states = run(ledge, at(0, 0, -1.4), 120, (t) => ({
    z: 1,
    buttons: t < 2 ? J : 0,
  }));
  const begin = states.findIndex((s) => mode(s) === 'MANTLE');
  const end = states.findIndex((s, t) => t > begin && mode(s) !== 'MANTLE');
  if (begin < 0) throw new Error('mantle never started');
  // MANTLE is entered at the end of tick `begin`; the climb occupies the ticks after it.
  record('mantleSeconds', (end - begin) * DT, 's');
  const landed = states[end]!;
  record(
    'mantleInset',
    -2 - landed.position.z,
    'm',
    `top y=${landed.position.y.toFixed(3)}`,
  );
}
// Slide under a 1.2 m ceiling, release crouch inside: stays crouched until clear.
{
  const tunnel = spatialWorld(0, [
    floor,
    { min: { x: -3, y: 1.2, z: -12 }, max: { x: 3, y: 1.6, z: -6 } },
  ]);
  const states = run(tunnel, at(0, 0, 0), 240, (t) => ({
    z: 1,
    buttons: S | (t >= 40 && t < 60 ? C : 0),
  }));
  const inside = states.filter(
    (s) => s.position.z < -6.4 && s.position.z > -11.6,
  );
  const ok = inside.length > 0 && inside.every((s) => s.move?.crouched);
  const out = states.at(-1)!;
  record(
    'lowCeilingCrouched',
    ok && !out.move?.crouched && out.position.z < -12 ? 1 : 0,
    'bool',
    `${inside.length} ticks under`,
  );
}
// Stairs: walk up a 1.8 m flight without jumping.
{
  const states = run(
    spatialWorld(0, [floor, ...stairRun(1.8)]),
    at(0, 0, -1),
    120,
    () => ({ z: -1 }),
    (s) => s.position.y >= 1.8 - 1e-9,
  );
  const grounded = states.every((s) => s.flags & 1);
  record(
    'stairStepUp',
    grounded ? states.at(-1)!.position.y : 0,
    'm',
    'grounded throughout',
  );
}
let failed = 0;
const rows = results.map((r) => {
  const [lo, hi] = MOVE_TARGETS[r.name];
  const pass = r.value >= lo - 1e-9 && r.value <= hi + 1e-9;
  if (!pass) failed++;
  return {
    measure: r.name,
    value: Number(r.value.toFixed(3)),
    unit: r.unit,
    range: `${lo}–${hi}`,
    result: pass ? 'PASS' : 'FAIL',
    note: r.note,
  };
});
console.table(rows);
await mkdir('test-results', { recursive: true });
await writeFile(
  'test-results/movement-harness.json',
  JSON.stringify({ pass: !failed, radius: PHYSICS.radius, rows }, null, 2),
);
if (failed) {
  console.error(`${failed} movement measure(s) outside range`);
  process.exitCode = 1;
}
