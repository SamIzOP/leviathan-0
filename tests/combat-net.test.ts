import { describe, it, expect, vi } from 'vitest';
import { Game, type Peer } from '../packages/server/src/game';
import {
  CONFIG,
  FIRE_BUTTON,
  STATUS,
  decodeClient,
  decodeServer,
  eyeOf,
  randomSeed,
  type ClientMessage,
  type Entity,
  type Input,
  type ServerMessage,
  type Snapshot,
  type Vec3,
} from '@leviathan/shared';

// Entity ids seed the per-shot spread; deterministic ids make every run identical.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  let counter = 0;
  return {
    ...actual,
    randomBytes: (size: number) => {
      const bytes = Buffer.alloc(size);
      bytes.writeUInt32BE(++counter, 0);
      return bytes;
    },
  };
});

const TICK_MS = 1000 / CONFIG.tickRate;
const SNAPSHOT_EVERY = CONFIG.tickRate / CONFIG.snapshotRate;
const ONE_WAY_MS = 50;
const JITTER_MS = 15;
/** Trigger presses are this many client frames apart (the rivet needs 10 ticks). */
const PULL_EVERY = 12;
const SHOTS = 240;

/** One direction of a TCP-like link: 50 ms ± 15 ms, never reordered. */
class Link<T> {
  private queue: { at: number; wire: string }[] = [];
  private last = 0;
  constructor(private rng: () => number) {}
  send(now: number, message: T) {
    const delay = ONE_WAY_MS + (this.rng() * 2 - 1) * JITTER_MS;
    this.last = Math.max(this.last, now + delay);
    this.queue.push({ at: this.last, wire: JSON.stringify(message) });
  }
  next() {
    return this.queue[0]?.at ?? Infinity;
  }
  receive(now: number) {
    const out: string[] = [];
    while (this.queue.length && this.queue[0]!.at <= now)
      out.push(this.queue.shift()!.wire);
    return out;
  }
}

/** The client's view of remote entities, as Renderer.push/render interpolate them. */
class Client {
  snapshots: Snapshot[] = [];
  offset = 0;
  seq = 0;
  frame = 0;
  armed = false;
  pulls = 0;
  shots = 0;
  hits = 0;
  rewinds: number[] = [];
  constructor(
    public id: string,
    public dummyId: string,
  ) {}
  receive(now: number, m: ServerMessage) {
    if (m.type !== 'snapshot') return;
    for (const e of m.events ?? []) {
      if (e.t === 'shot' && e.shooter === this.id) {
        this.shots++;
        if (e.flesh.some(Boolean)) this.hits++;
      }
      if (e.t === 'debug' && e.shooter === this.id)
        this.rewinds.push((e.tick - e.rewindTick) * TICK_MS);
    }
    if (this.snapshots.length && m.tick <= this.snapshots.at(-1)!.tick) return;
    const sample = now - m.time;
    this.offset = this.snapshots.length
      ? this.offset * 0.95 + sample * 0.05
      : sample;
    this.snapshots.push(m);
    if (this.snapshots.length > 60) this.snapshots.shift();
  }
  /** Interpolated remote state at `now - offset - interpolationMs`, and its tick. */
  sample(now: number, id: string): { view: number; position: Vec3 } | null {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const target = now - this.offset - CONFIG.interpolationMs;
    let a = this.snapshots[0]!,
      b = latest;
    for (let i = 1; i < this.snapshots.length; i++)
      if (this.snapshots[i]!.time >= target) {
        a = this.snapshots[i - 1]!;
        b = this.snapshots[i]!;
        break;
      }
    const alpha = Math.max(
      0,
      Math.min(1, (target - a.time) / Math.max(1, b.time - a.time)),
    );
    const from = a.entities.find((e) => e.id === id),
      to = b.entities.find((e) => e.id === id);
    if (!from || !to) return null;
    return {
      view: a.tick + (b.tick - a.tick) * alpha,
      position: {
        x: from.position.x + (to.position.x - from.position.x) * alpha,
        y: from.position.y + (to.position.y - from.position.y) * alpha,
        z: from.position.z + (to.position.z - from.position.z) * alpha,
      },
    };
  }
  /** One 60 Hz frame: aim exactly at the rendered dummy's chest, pull on schedule. */
  input(now: number): Input {
    this.frame++;
    const latest = this.snapshots.at(-1);
    const me: Entity | undefined = latest?.entities.find(
      (e) => e.id === this.id,
    );
    const target = this.sample(now, this.dummyId);
    const input: Input = {
      seq: ++this.seq,
      tick: latest?.tick ?? 0,
      x: 0,
      z: 0,
      yaw: me?.yaw ?? 0,
      pitch: 0,
      buttons: 0,
      weapon: 0,
    };
    if (me && target) {
      const eye = eyeOf(me),
        dx = target.position.x - eye.x,
        dy = target.position.y + 1 - eye.y,
        dz = target.position.z - eye.z;
      input.yaw = Math.atan2(-dx, -dz);
      input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      input.view = target.view;
      if (this.armed && this.pulls < SHOTS && this.frame % PULL_EVERY === 0) {
        input.buttons = FIRE_BUTTON.fire;
        this.pulls++;
      }
    }
    return input;
  }
}

function run(lagCompensation: boolean) {
  let time = 1000;
  const game = new Game({ devTools: true }, () => time);
  const rng = randomSeed(0x1e7a7104);
  const down = new Link<ServerMessage>(rng),
    up = new Link<ClientMessage>(rng);
  const peer: Peer = {
    id: 'net',
    send: (m) => down.send(time, m),
    close: () => {},
  };
  game.handle(peer, {
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: 'NETTEST',
  });
  const room = peer.room!,
    me = peer.player!;
  const dev = (m: Omit<Extract<ClientMessage, { type: 'dev' }>, 'type'>) =>
    game.handle(peer, { type: 'dev', ...m });
  // One rivet dummy 8 m ahead, strafing ±2.5 m on its sine path (~3.5 m/s peak).
  dev({ action: 'spawn-range', count: 1 });
  dev({ action: 'moving-dummies', enabled: true });
  dev({ action: 'infinite-ammo', enabled: true });
  dev({ action: 'hit-debug', enabled: true });
  dev({ action: 'damage-scale', value: 0.01 }); // the dummy never dies mid-run
  dev({ action: 'lag-compensation', enabled: lagCompensation });
  expect(room.robots).toHaveLength(1);
  const client = new Client(me.id, room.robots[0]!.id);
  let deadTicks = 0;
  let nextTick = time + TICK_MS,
    nextFrame = time + 7.3; // client frames are out of phase with server ticks
  const step = () => {
    time = Math.min(nextTick, nextFrame, up.next(), down.next());
    for (const wire of up.receive(time)) {
      const m = decodeClient(wire);
      expect(m).not.toBeNull();
      game.handle(peer, m!);
    }
    for (const wire of down.receive(time))
      client.receive(time, decodeServer(wire));
    if (time === nextTick) {
      game.step();
      // A dead dummy is untargetable for 2 s; those misses would not be latency.
      if ((room.robots[0]!.status ?? 0) & STATUS.dead) deadTicks++;
      if (game.tick % SNAPSHOT_EVERY === 0) game.sendSnapshots(room);
      nextTick += TICK_MS;
    }
    if (time === nextFrame) {
      up.send(time, { type: 'inputs', inputs: [client.input(time)] });
      nextFrame += TICK_MS;
    }
  };
  // Warm up: a full interpolation buffer and a steady clock offset.
  while (time < 3000) step();
  client.armed = true;
  for (let guard = 0; client.pulls < SHOTS && guard < 2_000_000; guard++)
    step();
  // Drain: every pull's shot resolves on the server and its events reach the client.
  const drainUntil = time + 1000;
  while (time < drainUntil) step();
  const hitsAtServer = room.combat!.stats.hits,
    shotsAtServer = room.combat!.stats.shots;
  const mean =
    client.rewinds.reduce((s, x) => s + x, 0) /
    Math.max(1, client.rewinds.length);
  return {
    shots: client.shots,
    hits: client.hits,
    rate: client.hits / client.shots,
    meanRewindMs: mean,
    maxRewindMs: Math.max(0, ...client.rewinds),
    offsetMs: client.offset,
    server: { shots: shotsAtServer, hits: hitsAtServer },
    deadTicks,
  };
}

describe('lag-compensated hits over a jittery 100 ms link', () => {
  it('lands shots on a strafing dummy at least 95% of the time with compensation on', () => {
    const on = run(true),
      off = run(false);
    const line = (label: string, r: ReturnType<typeof run>) =>
      `${label}: shots=${r.shots} hits=${r.hits} rate=${(r.rate * 100).toFixed(1)}% ` +
      `mean rewind=${r.meanRewindMs.toFixed(1)} ms (max ${r.maxRewindMs.toFixed(1)} ms), ` +
      `clock offset=${r.offsetMs.toFixed(1)} ms`;
    console.log(
      `[combat-net] RTT ${ONE_WAY_MS * 2} ms ± ${JITTER_MS} ms each way, ` +
        `interpolation ${CONFIG.interpolationMs} ms\n` +
        `  ${line('lag compensation ON ', on)}\n  ${line('lag compensation OFF', off)}`,
    );
    for (const r of [on, off]) {
      // One shot per trigger pull, and the client heard about exactly what the
      // server resolved.
      expect(r.shots).toBe(SHOTS);
      expect(r.server).toEqual({ shots: r.shots, hits: r.hits });
      expect(r.deadTicks).toBe(0);
    }
    expect(on.rate).toBeGreaterThanOrEqual(0.95);
    expect(on.rate - off.rate).toBeGreaterThanOrEqual(0.3);
    // The rewind covers the real view latency and stays inside the 300 ms cap.
    expect(on.meanRewindMs).toBeGreaterThan(ONE_WAY_MS * 2);
    expect(on.maxRewindMs).toBeLessThanOrEqual(300);
    expect(off.meanRewindMs).toBe(0);
  });
});
