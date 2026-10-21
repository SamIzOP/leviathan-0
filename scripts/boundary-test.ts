import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { Game, type Peer } from '../packages/server/src/game';
import { getLevel, spawnEntity } from '../packages/shared/src/level';
import { BUTTON, CONFIG } from '../packages/shared/src/config';
import { confinement } from '../packages/shared/src/confinement';
import { INNER, escapeProbes, searchEscapes } from './escape-search';
import type { Entity } from '../packages/shared/src/types';
const game = new Game({ devTools: true }),
  level = getLevel(),
  bots: Peer[] = [];
for (let i = 0; i < 8; i++) {
  const peer: Peer = { id: 'boundary-' + i, send: () => {}, close: () => {} };
  game.handle(peer, {
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: 'Boundary' + i,
  });
  bots.push(peer);
}
const inside = (p: Entity['position']) =>
  p.x > -INNER.x && p.x < INNER.x && p.z > -INNER.z && p.z < INNER.z;
const DIRECTIONS = [
  ['north', 0, -85, 0],
  ['east', 105, 0, -Math.PI / 2],
  ['south', 0, 84, Math.PI],
  ['west', -105, 0, Math.PI / 2],
] as const;
const place = (direction: string, x: number, z: number, spacing: number) =>
  bots.forEach((peer, i) => {
    peer.player!.entity = {
      ...spawnEntity(peer.player!.id, i, level),
      position: {
        x:
          x +
          (direction === 'north' || direction === 'south'
            ? (i - 4) * spacing
            : 0),
        y: 0,
        z:
          z +
          (direction === 'east' || direction === 'west'
            ? (i - 4) * spacing
            : 0),
      },
    };
  });
// 1. Original placeholder-style run: sprint into each wall and jump periodically.
const samples = [];
for (const [direction, x, z, yaw] of DIRECTIONS) {
  place(direction, x, z, 4);
  for (let tick = 1; tick <= 3600; tick++) {
    for (const peer of bots) {
      const seq = peer.player!.received + 1;
      game.handle(peer, {
        type: 'inputs',
        inputs: [
          {
            seq,
            tick,
            x: 0,
            z: 1,
            yaw,
            pitch: 0,
            buttons: 2 | (tick % 48 === 0 ? 1 : 0),
          },
        ],
      });
    }
    game.step();
    for (const peer of bots)
      assert(inside(peer.player!.entity.position), 'escaped ' + direction);
  }
  samples.push({
    direction,
    simulatedSeconds: 60,
    positions: bots.map((p) => p.player!.entity.position),
  });
}
// 2. Full movement set against every wall through the real server: run-ups, slides,
// slide-jumps, air jumps at the apex, climbing/mantle attempts and angled wall-run tries.
const { jump: J, sprint: S, crouch: C } = BUTTON;
const reached = new Set<string>();
const traversal: { direction: string; positions: Entity['position'][] }[] = [];
for (const [direction, x, z, yaw] of DIRECTIONS) {
  place(direction, x + 0, z, 12);
  for (const [i, peer] of bots.entries())
    peer.player!.entity.position[
      direction === 'north' || direction === 'south' ? 'z' : 'x'
    ] +=
      (direction === 'north'
        ? 1
        : direction === 'south'
          ? -1
          : direction === 'east'
            ? -1
            : 1) *
      (6 + (i % 4) * 4);
  for (let tick = 1; tick <= 3600; tick++) {
    bots.forEach((peer, i) => {
      const s = peer.player!.entity,
        mode = s.move?.mode ?? 'GROUND';
      reached.add(mode);
      const t = (tick + i * 37) % 300,
        away = t < 70;
      const heading =
        yaw +
        (away ? Math.PI : 0) +
        (i % 4 === 2 ? 0.5 : i % 4 === 3 ? -0.5 : 0);
      const slide = !away && t >= 95 && t < 104;
      const jump =
        (!away && mode === 'SLIDE' && t >= 104 && t < 106) ||
        (mode === 'AIR' && s.velocity.y < 0 && !!s.move?.airJumps) ||
        (mode === 'WALLRUN' && (s.move?.wall?.ticks ?? 0) > 14) ||
        (!away && t > 160 && t % 30 < 2);
      game.handle(peer, {
        type: 'inputs',
        inputs: [
          {
            seq: peer.player!.received + 1,
            tick,
            x: 0,
            z: 1,
            yaw: heading,
            pitch: 0,
            buttons: S | (slide ? C : 0) | (jump ? J : 0),
          },
        ],
      });
    });
    game.step();
    for (const peer of bots)
      assert(
        inside(peer.player!.entity.position),
        'traversal escaped ' + direction,
      );
  }
  traversal.push({
    direction,
    positions: bots.map((p) => p.player!.entity.position),
  });
}
for (const peer of bots) {
  for (const position of [
    { x: 121, y: 0, z: 0 },
    { x: 0, y: -20, z: 0 },
    { x: 0, y: 0, z: -100 },
  ]) {
    peer.player!.entity.position = position;
    game.step();
    assert(
      level.spawns.some(
        (s) =>
          s.type === 'player' &&
          Math.hypot(
            s.position.x - peer.player!.entity.position.x,
            s.position.z - peer.player!.entity.position.z,
          ) < 0.01,
      ),
    );
  }
}
// 3. Perimeter pieces carry no traversal flags.
const perimeter = level.colliders.filter((c) =>
  /^(compound-|entrance-blast-door|side-seal-)/.test(c.id),
);
assert(perimeter.length >= 9);
assert(perimeter.every((c) => !c.wallRunnable && !c.mantleable));
// 4. Adversarial full-movement search from every elevated platform near the perimeter.
const started = performance.now();
const search = searchEscapes(level, escapeProbes(level));
assert.deepEqual(
  search.escapes.map((e) => `${e.source}/${e.maneuver}`),
  [],
  'full-movement escape found',
);
const flood = confinement(level);
assert(!flood.boundary);
assert.deepEqual(flood.unreachable, []);
assert.deepEqual(flood.elevatedEscapes, []);
await mkdir('docs/perf', { recursive: true });
const report = {
  pass: true,
  bots: 8,
  secondsPerDirection: 60,
  simulationTicks: 14400,
  outOfBoundsRecovered: 24,
  flood,
  samples,
};
await writeFile(
  'docs/perf/revision-boundary.json',
  JSON.stringify(report, null, 2),
);
const movement = {
  pass: true,
  traversalBots: {
    bots: 8,
    secondsPerDirection: 60,
    ticks: 14400,
    statesReached: [...reached],
    positions: traversal,
  },
  perimeterPieces: perimeter.map((c) => ({
    id: c.id,
    wallRunnable: c.wallRunnable,
    mantleable: c.mantleable,
    clip: !!c.clip,
  })),
  adversarial: {
    probes: search.probes,
    simulatedTicks: search.ticks,
    seconds: (performance.now() - started) / 1000,
    escapes: search.escapes.length,
  },
};
await writeFile(
  'docs/perf/movement-boundary.json',
  JSON.stringify(movement, null, 2),
);
console.log(
  JSON.stringify({
    pass: true,
    simulationTicks: 28800,
    statesReached: [...reached],
    adversarial: movement.adversarial,
    flood: { visited: flood.visited, elevatedProbes: flood.elevatedProbes },
  }),
);
