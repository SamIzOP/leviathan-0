/** Server CPU per tick for eight traversing players on Foundry Row (real Game.step),
 * plus the isolated shared movement step. Writes docs/perf/movement-server.json. */
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { Game, type Peer } from '../packages/server/src/game';
import {
  CONFIG,
  levelWorld,
  missionLevel,
  spawnEntity,
  stepPlayer,
  traversalInput,
} from '../packages/shared/src/index';
import type { Entity } from '../packages/shared/src/types';
const game = new Game({ devTools: true });
const host: Peer = { id: 'perf', send: () => {}, close: () => {} };
game.handle(host, {
  type: 'dev-solo',
  protocol: CONFIG.protocol,
  name: 'PERF',
});
game.handle(host, { type: 'dev', action: 'add-bots', count: 7 });
const room = host.room!;
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1)!,
  };
};
const modes = new Set<string>();
const tickTimes: number[] = [];
// The host follows the traversal routine; inside step the dev tick replaces bot
// queues with its own inputs (odd bots traverse, even bots wander).
for (let tick = 1; tick <= 4200; tick++) {
  room.players.forEach((p, i) => {
    const input = { ...traversalInput(tick + i * 45, i / 8), seq: p.ack + 1 };
    p.queue = [input];
    p.received = input.seq;
  });
  const start = performance.now();
  game.step();
  const ms = performance.now() - start;
  for (const p of room.players) modes.add(p.entity.move?.mode ?? 'GROUND');
  if (tick > 600) tickTimes.push(ms);
}
// Isolated shared step: eight entities, same routine, same world.
const world = levelWorld(missionLevel(0));
let entities: Entity[] = Array.from({ length: 8 }, (_, i) =>
  spawnEntity(String(i), i, missionLevel(0)),
);
const isolated: number[] = [];
for (let tick = 1; tick <= 4200; tick++) {
  const start = performance.now();
  entities = entities.map((e, i) =>
    stepPlayer(
      e,
      { ...traversalInput(tick + i * 45, i / 8), seq: tick },
      1 / 60,
      world,
    ),
  );
  if (tick > 600) isolated.push(performance.now() - start);
}
const report = {
  machine: {
    cpu: cpus()[0]?.model,
    threads: cpus().length,
    node: process.version,
  },
  players: room.players.length,
  ticksMeasured: tickTimes.length,
  statesReached: [...modes],
  serverStep: stats(tickTimes),
  movementOnly: stats(isolated),
  budgetMs: 1,
  pass: stats(tickTimes).meanMs < 1 && stats(isolated).p99Ms < 1,
};
await mkdir('docs/perf', { recursive: true });
await writeFile(
  'docs/perf/movement-server.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
