import { describe, it, expect } from 'vitest';
import { Game } from '../packages/server/src/game';
import type { Peer } from '../packages/server/src/game';
import {
  CONFIG,
  DEFAULT_TUNING,
  DEV_ACTIONS,
  PHYSICS,
  ARENA,
  levelWorld,
  missionLevel,
  spawnEntity,
  stepDev,
  makeEntity,
  decodeClient,
} from '@leviathan/shared';
import type { ServerMessage, ClientMessage } from '@leviathan/shared';
function setup(devTools: boolean) {
  let now = 1000;
  const game = new Game({ devTools, matchMs: 1000 }, () => now);
  const messages: ServerMessage[] = [];
  const peer: Peer = {
    id: 'test',
    send: (m) => messages.push(structuredClone(m)),
    close: () => {},
  };
  game.handle(peer, { type: 'create', protocol: 1, name: 'TESTER' });
  return {
    game,
    peer,
    messages,
    advance: (ms: number) => {
      now += ms;
      game.step();
    },
    send: (m: ClientMessage) => game.handle(peer, m),
  };
}
describe('dev authorization', () => {
  for (const action of DEV_ACTIONS)
    it(`rejects ${action} in production`, () => {
      const { send, peer, messages, game } = setup(false);
      const before = JSON.stringify({
        view: game.view(peer.room!),
        snapshot: game.snapshot(peer.room!),
      });
      send({ type: 'dev', action });
      expect(messages.at(-1)).toMatchObject({
        type: 'error',
        message: 'Developer tools are disabled on this server.',
      });
      expect(
        JSON.stringify({
          view: game.view(peer.room!),
          snapshot: game.snapshot(peer.room!),
        }),
      ).toBe(before);
    });
  it('refuses solo and legacy debug with DEV_TOOLS off', () => {
    const { send, messages, peer } = setup(false);
    send({ type: 'dev-solo', protocol: 1, name: 'TESTER' });
    expect(messages.at(-1)?.type).toBe('error');
    send({ type: 'debug', action: 'robot' });
    expect(peer.room!.robots).toHaveLength(0);
  });
  it('rejects one-player start off, accepts it on, and skips countdown for dev solo', () => {
    for (const enabled of [false, true]) {
      const { send, peer } = setup(enabled);
      send({ type: 'ready', ready: true });
      send({ type: 'start' });
      expect(peer.room!.phase).toBe(enabled ? 'COUNTDOWN' : 'LOBBY');
    }
    const { send, peer } = setup(true);
    send({ type: 'dev-solo', protocol: CONFIG.protocol, name: 'TESTER' });
    expect(peer.room!.phase).toBe('PLAYING');
    expect(peer.room!.dev?.timerEnabled).toBe(false);
  });
  it('rejects malformed tuning and client authority claims', () => {
    expect(
      decodeClient(
        JSON.stringify({
          type: 'dev',
          action: 'tune',
          tuning: { walk: 1000, sprint: 8, jumpHeight: 1, gravity: 20 },
        }),
      ),
    ).toBeNull();
    expect(
      decodeClient(
        JSON.stringify({
          type: 'create',
          protocol: 1,
          name: 'TESTER',
          devTools: true,
        }),
      ),
    ).toBeNull();
  });
});
describe('dev-only room controls', () => {
  it('keeps host ownership with a human when synthetic players were added first', () => {
    const { send, peer, game } = setup(true);
    send({ type: 'dev', action: 'add-bots', count: 3 });
    const second: Peer = { id: 'second', send: () => {}, close: () => {} };
    game.handle(second, {
      type: 'join',
      protocol: 1,
      name: 'SECOND',
      code: peer.room!.code,
    });
    send({ type: 'leave' });
    expect(second.room!.hostId).toBe(second.player!.id);
  });
  it('counts synthetic players toward eight slots and removes them correctly', () => {
    const { send, peer, game } = setup(true);
    send({ type: 'dev', action: 'add-bots', count: 7 });
    expect(peer.room!.players).toHaveLength(8);
    send({ type: 'dev', action: 'add-bots', count: 7 });
    expect(peer.room!.players).toHaveLength(8);
    expect(game.view(peer.room!).players.every((p) => p.connected)).toBe(true);
    send({ type: 'dev', action: 'remove-bot' });
    expect(peer.room!.players).toHaveLength(7);
    send({ type: 'dev', action: 'restart' });
    game.step();
    expect(
      peer.room!.players.filter((p) => p.bot).every((p) => p.ack > 0),
    ).toBe(true);
    const room = peer.room!;
    send({ type: 'leave' });
    expect(room.players).toHaveLength(0);
  });
  it('disables, freezes, resumes and expires the timer', () => {
    const { send, peer, advance } = setup(true);
    send({ type: 'dev-solo', protocol: 1, name: 'TESTER' });
    advance(10000);
    expect(peer.room!.phase).toBe('PLAYING');
    send({ type: 'dev', action: 'timer', enabled: true });
    advance(400);
    send({ type: 'dev', action: 'freeze', enabled: true });
    const remaining = peer.room!.dev!.remainingMs;
    advance(5000);
    expect(peer.room!.phase).toBe('PLAYING');
    expect(peer.room!.dev!.remainingMs).toBe(remaining);
    send({ type: 'dev', action: 'freeze', enabled: false });
    advance(remaining + 1);
    expect(peer.room!.phase).toBe('ENDED');
  });
  it('applies room tuning identically to server and client without changing production defaults', () => {
    const { send, peer, game } = setup(true);
    send({ type: 'dev-solo', protocol: 1, name: 'TESTER' });
    const tuning = { walk: 9, sprint: 12, jumpHeight: 2.5, gravity: 15 };
    const original = { ...PHYSICS };
    send({ type: 'dev', action: 'tune', tuning });
    let client = structuredClone(peer.player!.entity);
    for (let seq = 1; seq <= 100; seq++) {
      const command = {
        seq,
        tick: seq,
        x: 1,
        z: 0.2,
        yaw: 0.2,
        pitch: 0,
        buttons: seq === 1 ? 1 : 0,
      };
      client = stepDev(
        client,
        command,
        1 / 60,
        levelWorld(missionLevel(peer.room!.mission)),
        tuning,
      );
      send({ type: 'inputs', inputs: [command] });
      game.step();
      expect(peer.player!.entity).toEqual(client);
    }
    expect(PHYSICS).toEqual(original);
    send({ type: 'dev', action: 'reset-tuning' });
    expect(peer.room!.dev!.tuning).toEqual(DEFAULT_TUNING);
  });
  it('keeps tuning room-local and restores original constants even around other rooms', () => {
    const e = makeEntity('a'),
      i = { seq: 1, tick: 1, x: 1, z: 0, yaw: 0, pitch: 0, buttons: 0 };
    const baseline = stepDev(e, i, 1 / 60, ARENA);
    stepDev(e, i, 1 / 60, ARENA, { ...DEFAULT_TUNING, walk: 15 });
    expect(stepDev(e, i, 1 / 60, ARENA)).toEqual(baseline);
  });
  it('spawns at the operator, clears dummies, resets player and returns to lobby', () => {
    const { send, peer } = setup(true);
    send({ type: 'dev-solo', protocol: 1, name: 'TESTER' });
    peer.player!.entity.position = { x: 5, y: 3, z: 2 };
    send({ type: 'dev', action: 'spawn-dummies', count: 10 });
    expect(peer.room!.robots).toHaveLength(10);
    expect(peer.room!.robots[0]!.position).toEqual(
      peer.player!.entity.position,
    );
    send({ type: 'dev', action: 'clear-dummies' });
    expect(peer.room!.robots).toHaveLength(0);
    send({ type: 'dev', action: 'reset-player' });
    expect(peer.player!.entity.position).toEqual(
      spawnEntity(peer.player!.id, 0, missionLevel(peer.room!.mission))
        .position,
    );
    send({ type: 'dev', action: 'lobby' });
    expect(peer.room!.phase).toBe('LOBBY');
  });
});
