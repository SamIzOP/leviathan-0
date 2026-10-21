import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { Game, type Peer } from '../packages/server/src/game';
import { getLevel, spawnEntity } from '../packages/shared/src/level';
import { confinement } from '../packages/shared/src/confinement';
const game = new Game({ devTools: true }),
  level = getLevel(),
  bots: Peer[] = [];
for (let i = 0; i < 8; i++) {
  const peer: Peer = { id: 'boundary-' + i, send: () => {}, close: () => {} };
  game.handle(peer, { type: 'dev-solo', protocol: 1, name: 'Boundary' + i });
  bots.push(peer);
}
const samples = [];
for (const [direction, x, z, yaw] of [
  ['north', 0, -85, 0],
  ['east', 105, 0, -Math.PI / 2],
  ['south', 0, 84, Math.PI],
  ['west', -105, 0, Math.PI / 2],
] as const) {
  bots.forEach((peer, i) => {
    peer.player!.entity = {
      ...spawnEntity(peer.player!.id, i, level),
      position: {
        x:
          x +
          (direction === 'north' || direction === 'south' ? (i - 4) * 4 : 0),
        y: 0,
        z: z + (direction === 'east' || direction === 'west' ? (i - 4) * 4 : 0),
      },
    };
  });
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
    for (const peer of bots) {
      const p = peer.player!.entity.position;
      assert(
        p.x > -107 && p.x < 107 && p.z > -87 && p.z < 87,
        'escaped ' + direction,
      );
    }
  }
  samples.push({
    direction,
    simulatedSeconds: 60,
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
console.log(JSON.stringify({ pass: true, simulationTicks: 14400, flood }));
