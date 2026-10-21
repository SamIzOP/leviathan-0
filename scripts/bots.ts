import { WebSocket } from 'ws';
import {
  CONFIG,
  decodeServer,
  encode,
  makeEntity,
  reconcile,
  stepPlayer,
  getLevel,
  levelWorld,
} from '@leviathan/shared';
import type { ClientMessage, Entity, Input, RoomView } from '@leviathan/shared';
import { writeFile, mkdir } from 'node:fs/promises';
const args = process.argv.slice(2);
function option(key: string, fallback: string) {
  const index = args.indexOf(`--${key}`);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
}
const count = Number(option('count', '8')),
  duration = Number(option('duration', '600')),
  url = option('url', 'ws://localhost:3000/ws'),
  chaos = args.includes('--chaos'),
  lag = Number(option('lag', '150')),
  loss = Number(option('loss', '3'));
let roomCode = option('room', ''),
  failure = '',
  reconnects = 0;
const bots: Bot[] = [];
const memories: number[] = [];
const started = Date.now();
const snapshotDigests = new Map<number, string>();
let syncComparisons = 0;
class Bot {
  ws?: WebSocket;
  token = '';
  id = '';
  room?: RoomView;
  seq = 0;
  tick = 0;
  tickRate: number = 60;
  snapshotRate: number = 30;
  pending: Input[] = [];
  state: Entity = makeEntity('pending');
  snapshots = 0;
  first = 0;
  last = 0;
  errors: number[] = [];
  wasDisconnected = false;
  timer?: ReturnType<typeof setInterval>;
  stopped = false;
  firstSnapshot = true;
  previousStep = performance.now();
  accumulator = 0;
  constructor(public index: number) {}
  send(m: ClientMessage) {
    const ws = this.ws;
    const wire = encode(m);
    if (m.type === 'inputs' && Math.random() * 100 < loss) return;
    setTimeout(
      () => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(wire);
      },
      m.type === 'inputs' ? lag / 2 : 0,
    );
  }
  connect() {
    if (this.stopped) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('open', () =>
      this.send(
        this.token
          ? { type: 'resume', protocol: 1, code: roomCode, token: this.token }
          : roomCode
            ? {
                type: 'join',
                protocol: 1,
                code: roomCode,
                name: `Bot ${this.index + 1}`,
              }
            : { type: 'create', protocol: 1, name: `Bot ${this.index + 1}` },
      ),
    );
    ws.on('message', (raw) => {
      const message = decodeServer(raw.toString());
      if (message.type === 'ping') {
        this.send({ type: 'pong', time: message.time });
        return;
      }
      if (message.type === 'snapshot' && Math.random() * 100 < loss) return;
      setTimeout(
        () => {
          if (ws !== this.ws) return;
          const m = message;
          if (m.type === 'hello') {
            this.tickRate = m.tickRate;
            this.snapshotRate = m.snapshotRate;
          }
          if (m.type === 'welcome') {
            if (this.id && this.id !== m.playerId)
              failure = 'Reconnect changed entity ID';
            if (this.wasDisconnected) {
              reconnects++;
              this.wasDisconnected = false;
            }
            this.id = m.playerId;
            this.token = m.token;
            roomCode = m.room.code;
            this.seq = m.seq;
            this.pending = [];
            this.firstSnapshot = true;
            this.room = m.room;
            if (m.room.phase === 'LOBBY')
              this.send({ type: 'ready', ready: true });
          }
          if (m.type === 'room') {
            this.room = m.room;
            if (
              m.room.phase === 'LOBBY' &&
              !m.room.players.find((p) => p.id === this.id)?.ready
            )
              this.send({ type: 'ready', ready: true });
            if (
              this.index === 0 &&
              m.room.hostId === this.id &&
              m.room.phase === 'LOBBY' &&
              m.room.players.length === count &&
              m.room.players.every((p) => p.ready && p.connected)
            )
              this.send({ type: 'start' });
            if (
              m.room.phase === 'ENDED' &&
              !m.room.players.find((p) => p.id === this.id)?.vote
            )
              this.send({ type: 'vote', vote: 'REPLAY' });
          }
          if (m.type === 'snapshot') {
            // Immediate resume snapshots can land between ticks; compare broadcasts only.
            if (!this.firstSnapshot) {
              const digest = JSON.stringify(m.entities);
              const previous = snapshotDigests.get(m.tick);
              if (previous) {
                syncComparisons++;
                if (previous !== digest)
                  failure = 'Clients received divergent world snapshots';
              } else snapshotDigests.set(m.tick, digest);
              if (snapshotDigests.size > 300)
                snapshotDigests.delete(snapshotDigests.keys().next().value!);
            }
            this.firstSnapshot = false;
            this.tick = m.tick;
            this.snapshots++;
            this.first ||= Date.now();
            this.last = Date.now();
            const authoritative = m.entities.find((e) => e.id === this.id);
            if (authoritative) {
              const result = reconcile(
                authoritative,
                m.acks[this.id] ?? 0,
                this.pending,
                1 / this.tickRate,
                levelWorld(getLevel(this.room?.levelId)),
              );
              if (this.room?.phase === 'PLAYING')
                this.errors.push(
                  Math.hypot(
                    result.state.position.x - this.state.position.x,
                    result.state.position.y - this.state.position.y,
                    result.state.position.z - this.state.position.z,
                  ),
                );
              if (this.errors.length > 20000) this.errors.shift();
              this.state = result.state;
              this.pending = result.pending;
            }
          }
          if (m.type === 'error' && !m.message.includes('already started'))
            failure = m.message;
        },
        message.type === 'snapshot' ? lag / 2 : 0,
      );
    });
    ws.on('close', () => {
      if (!this.stopped) {
        this.wasDisconnected = true;
        setTimeout(() => this.connect(), 350);
      }
    });
    ws.on('error', (e) => {
      failure = e.message;
    });
    if (!this.timer)
      this.timer = setInterval(() => {
        const now = performance.now();
        this.accumulator += Math.min(now - this.previousStep, 250);
        this.previousStep = now;
        if (this.accumulator < 1000 / this.tickRate) return;
        this.accumulator %= 1000 / this.tickRate;
        if (
          this.ws?.readyState !== WebSocket.OPEN ||
          this.room?.phase !== 'PLAYING'
        )
          return;
        const i: Input = {
          seq: ++this.seq,
          tick: this.tick,
          x: Math.sin(this.seq / 75 + this.index),
          z: Math.cos(this.seq / 90),
          yaw: this.index,
          pitch: 0,
          buttons: this.seq % 240 === 0 ? 1 : 0,
        };
        this.pending.push(i);
        this.pending = this.pending.slice(-240);
        this.state = stepPlayer(
          this.state,
          i,
          1 / this.tickRate,
          levelWorld(getLevel(this.room?.levelId)),
        );
        this.send({
          type: 'inputs',
          inputs: this.pending.slice(-CONFIG.maxBatch),
        });
      }, 4);
  }
}
for (let i = 0; i < count; i++) {
  const bot = new Bot(i);
  bots.push(bot);
  bot.connect();
  for (let wait = 0; !bot.token && wait < 100; wait++)
    await new Promise((r) => setTimeout(r, 100));
  if (!bot.token) throw new Error(failure || 'Connection timeout');
}
console.log(
  `Room ${roomCode}: ${count} bots, ${duration}s, ${lag}ms RTT / ${loss}% loss, chaos=${chaos}`,
);
const chaosTimer = chaos
  ? setInterval(
      () => bots[Math.floor(Math.random() * bots.length)]?.ws?.terminate(),
      7000,
    )
  : undefined;
while (Date.now() - started < duration * 1000) {
  await new Promise((r) => setTimeout(r, 10000));
  try {
    const health = (await fetch(
      url
        .replace('ws:', 'http:')
        .replace('wss:', 'https:')
        .replace('/ws', '/health'),
    ).then((r) => r.json())) as { memory: number };
    memories.push(health.memory);
  } catch {
    failure = 'Health endpoint unavailable';
  }
  console.log(
    JSON.stringify({
      seconds: Math.round((Date.now() - started) / 1000),
      players: bots[0]?.room?.players.length,
      reconnects,
      memoryMiB: Math.round((memories.at(-1) ?? 0) / 1048576),
      snapshots: bots.map((b) => b.snapshots),
    }),
  );
}
if (chaosTimer) clearInterval(chaosTimer);
for (const b of bots) {
  b.stopped = true;
  clearInterval(b.timer);
  b.ws?.close();
}
const rates = bots.map(
  (b) => b.snapshots / Math.max(1, (b.last - b.first) / 1000),
);
const errors = bots.flatMap((b) => b.errors).sort((a, b) => a - b);
const memoryGrowth = (memories.at(-1) ?? 0) - (memories[0] ?? 0);
const report = {
  durationSeconds: (Date.now() - started) / 1000,
  room: roomCode,
  count,
  reconnects,
  syncComparisons,
  rates,
  memoryMiB: memories.map((x) => x / 1048576),
  memoryGrowthMiB: memoryGrowth / 1048576,
  predictionErrorP95: errors[Math.floor(errors.length * 0.95)],
  failure,
  pass:
    !failure &&
    rates.every(
      (r) =>
        r > bots[0]!.snapshotRate * (1 - loss / 100) * 0.8 &&
        r < bots[0]!.snapshotRate * 1.1,
    ) &&
    syncComparisons > 0 &&
    (errors[Math.floor(errors.length * 0.95)] ?? 0) < 0.25 &&
    memoryGrowth < 100 * 1048576 &&
    (!chaos || reconnects > 0),
};
await mkdir('test-results', { recursive: true });
await writeFile(
  `test-results/${option('report', 'bots')}.json`,
  JSON.stringify(report, null, 2),
);
console.log(report);
process.exitCode = report.pass ? 0 : 1;
