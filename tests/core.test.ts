import { describe, it, expect } from 'vitest';
import { Game, generateCode, resolveVote } from '../packages/server/src/game';
import type { Peer } from '../packages/server/src/game';
import { cleanName, uniqueName } from '../packages/server/src/names';
import {
  ARENA,
  CONFIG,
  FLAG,
  decodeClient,
  makeEntity,
  reconcile,
  stepPlayer,
} from '@leviathan/shared';
import type { Input, ServerMessage } from '@leviathan/shared';
function setup(options = {}) {
  let time = 1000;
  const game = new Game(options, () => time);
  let id = 0;
  const peer = () => {
    const messages: ServerMessage[] = [];
    const p: Peer = {
      id: String(id++),
      send: (m) => messages.push(structuredClone(m)),
      close: () => {},
    };
    return Object.assign(p, { messages });
  };
  const host = peer();
  game.handle(host, {
    type: 'create',
    protocol: CONFIG.protocol,
    name: 'Alpha',
  });
  return {
    game,
    host,
    peer,
    advance: (ms: number) => {
      time += ms;
      game.step();
    },
  };
}
describe('rooms and identity', () => {
  it('generates safe codes and retries collisions', () => {
    const map = new Map([['AAAA', true]]);
    let calls = 0;
    expect(generateCode(map, () => (calls++ < 4 ? 0 : 1))).toBe('BBBB');
    for (let i = 0; i < 100; i++)
      expect(generateCode(new Map())).toMatch(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
      );
    expect(() => generateCode(map, () => 0)).toThrow();
  });
  it('rejects unknown, full, version mismatch and late joins', () => {
    const { game, host, peer } = setup();
    const r = host.room!;
    const unknown = peer();
    game.handle(unknown, {
      type: 'join',
      protocol: 1,
      name: 'Beta',
      code: 'ZZZZ',
    });
    expect(unknown.messages.at(-1)).toMatchObject({
      type: 'error',
      message: 'Unknown room code.',
    });
    for (let i = 0; i < 7; i++)
      game.handle(peer(), {
        type: 'join',
        protocol: 1,
        name: 'Alpha',
        code: r.code.toLowerCase(),
      });
    expect(r.players).toHaveLength(8);
    expect(new Set(r.players.map((p) => p.name)).size).toBe(8);
    const extra = peer();
    game.handle(extra, {
      type: 'join',
      protocol: 1,
      name: 'Extra',
      code: r.code,
    });
    expect(extra.messages.at(-1)).toMatchObject({ message: 'Room is full.' });
    r.phase = 'PLAYING';
    game.handle(extra, {
      type: 'join',
      protocol: 1,
      name: 'Extra',
      code: r.code,
    });
    expect(extra.messages.at(-1)).toMatchObject({ type: 'error' });
    game.handle(extra, { type: 'create', protocol: 99, name: 'Extra' });
    expect(extra.messages.at(-1)).toMatchObject({ code: 'VERSION' });
  });
  it('filters names and suffixes case-insensitive duplicates within length cap', () => {
    expect(cleanName('  Pilot  ')).toBe('Pilot');
    for (const name of ['a', 'abcdefghijklmnopq', '<script>', 'FUCK', 'sh1t'])
      expect(() => cleanName(name)).toThrow();
    expect(uniqueName('Pilot', ['pilot', 'Pilot 2'])).toBe('Pilot 3');
    expect(uniqueName('abcdefghijklmnop', ['abcdefghijklmnop'])).toHaveLength(
      16,
    );
  });
  it('migrates host to oldest and cleans empty rooms after grace', () => {
    const { game, host, peer, advance } = setup();
    const r = host.room!;
    const second = peer();
    game.handle(second, {
      type: 'join',
      protocol: 1,
      name: 'Beta',
      code: r.code,
    });
    game.handle(host, { type: 'leave' });
    expect(r.hostId).toBe(second.player!.id);
    game.handle(second, { type: 'leave' });
    advance(59999);
    expect(game.rooms.size).toBe(1);
    advance(1);
    expect(game.rooms.size).toBe(0);
  });
});
describe('reconnect and voting', () => {
  it('allows the host to reopen the lobby between missions for late joiners', () => {
    const { game, host, peer } = setup();
    const room = host.room!;
    game.end(room);
    game.handle(host, { type: 'lobby' });
    expect(room.phase).toBe('LOBBY');
    const late = peer();
    game.handle(late, {
      type: 'join',
      protocol: 1,
      code: room.code,
      name: 'Late operator',
    });
    expect(late.room).toBe(room);
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });
  it('holds frozen state for 45 seconds and reclaims the same entity; newest tab wins', () => {
    const { game, host, peer, advance } = setup();
    const p = host.player!,
      r = host.room!,
      token = p.token;
    const position = { ...p.entity.position };
    game.disconnect(host);
    advance(20000);
    expect(p.entity.flags & FLAG.disconnected).toBeTruthy();
    expect(p.entity.position).toEqual(position);
    const resume = peer();
    game.handle(resume, { type: 'resume', protocol: 1, code: r.code, token });
    expect(resume.player).toBe(p);
    expect(resume.messages.some((m) => m.type === 'snapshot')).toBe(true);
    const newest = peer();
    game.handle(newest, { type: 'resume', protocol: 1, code: r.code, token });
    expect(resume.messages.at(-1)?.type).toBe('replaced');
    game.disconnect(resume);
    expect(p.peer).toBe(newest);
    game.disconnect(newest);
    advance(45001);
    expect(r.players).toHaveLength(0);
    const expired = peer();
    game.handle(expired, { type: 'resume', protocol: 1, code: r.code, token });
    expect(expired.messages.at(-1)).toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('never exposes tokens in room views or snapshots and rejects stolen guesses', () => {
    const { game, host, peer } = setup();
    expect(JSON.stringify(game.view(host.room!))).not.toContain(
      host.player!.token,
    );
    expect(JSON.stringify(game.snapshot(host.room!))).not.toContain(
      host.player!.token,
    );
    const p = peer();
    game.handle(p, {
      type: 'resume',
      protocol: 1,
      code: host.room!.code,
      token: 'x'.repeat(64),
    });
    expect(p.player).toBeUndefined();
  });
  it('majority, host tie, no votes, and both rematch routes', () => {
    expect(
      resolveVote(
        [
          { id: 'a', vote: 'NEXT' },
          { id: 'b', vote: 'REPLAY' },
        ],
        'a',
      ),
    ).toBe('NEXT');
    expect(
      resolveVote(
        [
          { id: 'a', vote: null },
          { id: 'b', vote: null },
        ],
        'a',
      ),
    ).toBe('REPLAY');
    expect(
      resolveVote(
        [
          { id: 'a', vote: 'NEXT' },
          { id: 'b', vote: 'REPLAY' },
          { id: 'c', vote: 'REPLAY' },
        ],
        'a',
      ),
    ).toBe('REPLAY');
    const { game, host, advance } = setup({
      devTools: true,
      countdownMs: 5,
      matchMs: 10,
      voteMs: 5,
    });
    game.handle(host, { type: 'ready', ready: true });
    game.handle(host, { type: 'start' });
    advance(5);
    expect(host.room!.phase).toBe('PLAYING');
    advance(10);
    expect(host.room!.phase).toBe('ENDED');
    game.handle(host, { type: 'vote', vote: 'NEXT' });
    advance(5);
    expect(host.room!.phase).toBe('COUNTDOWN');
    expect(host.room!.mission).toBe(1);
    advance(5);
    advance(10);
    advance(5);
    expect(host.room!.mission).toBe(1);
    expect(host.room!.lastVote?.choice).toBe('REPLAY');
  });
  it('restores current vote state during ENDED', () => {
    const { game, host, peer } = setup();
    const r = host.room!,
      p = host.player!;
    game.end(r);
    game.handle(host, { type: 'vote', vote: 'NEXT' });
    game.disconnect(host);
    const returned = peer();
    game.handle(returned, {
      type: 'resume',
      protocol: 1,
      code: r.code,
      token: p.token,
    });
    expect(returned.messages.find((m) => m.type === 'welcome')).toMatchObject({
      room: { phase: 'ENDED', players: [{ vote: 'NEXT' }] },
    });
  });
});
describe('simulation and security', () => {
  it('is deterministic, lands on the floor and collides with boxes', () => {
    const commands: Input[] = Array.from({ length: 300 }, (_, i) => ({
      seq: i + 1,
      tick: i,
      x: Math.sin(i),
      z: 1,
      yaw: 0,
      pitch: 0,
      buttons: i === 1 ? 1 : 0,
    }));
    const run = () =>
      commands.reduce(
        (s, i) => stepPlayer(s, i, 1 / 60, ARENA),
        makeEntity('a'),
      );
    expect(run()).toEqual(run());
    expect(run().position.y).toBe(0);
    const s = makeEntity('b');
    s.position = { x: 4, y: 0, z: 8 };
    let current = s;
    for (let i = 0; i < 100; i++)
      current = stepPlayer(
        current,
        { seq: i, tick: i, x: 0, z: 1, yaw: 0, pitch: 0, buttons: 0 },
        1 / 60,
        ARENA,
      );
    expect(current.position.z).toBeGreaterThanOrEqual(6.35);
  });
  it('reconciles with delayed acknowledgements and simulated packet loss', () => {
    let server = makeEntity('a'),
      client = makeEntity('a');
    let pending: Input[] = [];
    const states = new Map<number, typeof server>();
    for (let tick = 1; tick < 600; tick++) {
      const command = {
        seq: tick,
        tick,
        x: Math.sin(tick / 30),
        z: Math.cos(tick / 40),
        yaw: 0.5,
        pitch: 0.1,
        buttons: tick === 20 ? 1 : 0,
      };
      server = stepPlayer(server, command, 1 / 60, ARENA);
      client = stepPlayer(client, command, 1 / 60, ARENA);
      pending.push(command);
      states.set(tick, server);
      const ack = tick - 9;
      if (ack > 0 && tick % 13 !== 0) {
        const result = reconcile(states.get(ack)!, ack, pending, 1 / 60, ARENA);
        expect(
          Math.hypot(
            client.position.x - result.state.position.x,
            client.position.y - result.state.position.y,
            client.position.z - result.state.position.z,
          ),
        ).toBeLessThan(1e-9);
        client = result.state;
        pending = result.pending;
      }
    }
  });
  it('rejects malformed state and bounds flooding to one movement step per tick', () => {
    expect(decodeClient('{broken')).toBeNull();
    expect(
      decodeClient(
        JSON.stringify({ type: 'inputs', inputs: [], position: { x: 100 } }),
      ),
    ).toBeNull();
    expect(
      decodeClient(
        JSON.stringify({
          type: 'inputs',
          inputs: [{ seq: 1, tick: 1, x: 'bad' }],
        }),
      ),
    ).toBeNull();
    const { game, host } = setup();
    const r = host.room!;
    r.phase = 'PLAYING';
    r.deadline = Infinity;
    const before = host.player!.entity.position.x;
    for (let batch = 0; batch < 50; batch++)
      game.handle(host, {
        type: 'inputs',
        inputs: Array.from({ length: 12 }, (_, i) => ({
          seq: batch * 12 + i + 1,
          tick: 0,
          x: 999,
          z: 0,
          yaw: 0,
          pitch: 999,
          buttons: 0,
        })),
      });
    game.step();
    expect(host.player!.queue.length).toBeLessThanOrEqual(CONFIG.maxQueue);
    expect(host.player!.entity.position.x - before).toBeCloseTo(5 / 60);
    expect(host.player!.entity.pitch).toBe(1.5);
  });
});
