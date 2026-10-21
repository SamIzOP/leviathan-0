import { randomBytes } from 'node:crypto';
import {
  CONFIG,
  DEFAULT_TUNING,
  makeEntity,
  spawnEntity,
  traversalInput,
} from '@leviathan/shared';
import type { ClientMessage, DevState } from '@leviathan/shared';
import type { Game, Peer, Player, Room } from './game';
export function devState(room: Room): DevState {
  return (room.dev ??= {
    solo: false,
    timerEnabled: true,
    frozen: false,
    remainingMs: CONFIG.matchMs,
    tuning: { ...DEFAULT_TUNING },
  });
}
export function sendDev(game: Game, room: Room, reset = false) {
  game.broadcast(room, {
    type: 'dev-state',
    state: devState(room),
    ...(reset
      ? { reset: room.players.map((p) => ({ entity: p.entity, ack: p.ack })) }
      : {}),
  });
}
export function instantStart(game: Game, room: Room) {
  game.begin(room);
  room.phase = 'PLAYING';
  room.started = game.now();
  room.deadline = game.now() + game.settings.matchMs;
  const state = devState(room);
  state.remainingMs = game.settings.matchMs;
  game.update(room);
  sendDev(game, room, true);
}
export function handleDev(
  game: Game,
  peer: Peer,
  message: Extract<ClientMessage, { type: 'dev' }>,
) {
  const room = peer.room!,
    player = peer.player!;
  if (room.hostId !== player.id)
    throw new Error('Developer controls require the room host.');
  const state = devState(room),
    now = game.now();
  switch (message.action) {
    case 'end':
      game.end(room);
      break;
    case 'restart':
      instantStart(game, room);
      break;
    case 'timer':
    case 'freeze': {
      if (state.timerEnabled && !state.frozen)
        state.remainingMs = Math.max(0, room.deadline - now);
      if (message.action === 'timer')
        state.timerEnabled = message.enabled ?? !state.timerEnabled;
      else state.frozen = message.enabled ?? !state.frozen;
      if (state.timerEnabled && !state.frozen)
        room.deadline = now + state.remainingMs;
      break;
    }
    case 'lobby':
      room.phase = 'LOBBY';
      room.deadline = 0;
      for (const p of room.players) {
        p.ready = !!p.bot;
        p.vote = null;
        p.queue = [];
      }
      break;
    case 'add-bots': {
      for (
        let i = 0;
        i < (message.count ?? 1) && room.players.length < CONFIG.maxPlayers;
        i++
      ) {
        const id = randomBytes(8).toString('hex');
        let number = 1;
        while (
          room.players.some(
            (p) => p.name === `BOT ${String(number).padStart(2, '0')}`,
          )
        )
          number++;
        const p: Player = {
          id,
          name: `BOT ${String(number).padStart(2, '0')}`,
          token: randomBytes(32).toString('hex'),
          ready: true,
          ping: 0,
          vote: null,
          expires: 0,
          entity: spawnEntity(
            id,
            room.players.length,
            game.level(room),
            room.players.map((p) => p.entity),
          ),
          queue: [],
          ack: 0,
          received: 0,
          bot: true,
        };
        p.peer = {
          id: `synthetic-${id}`,
          send: () => {},
          close: () => {},
          room,
          player: p,
        };
        room.players.push(p);
        game.broadcast(room, { type: 'event', event: 'join', name: p.name });
      }
      break;
    }
    case 'remove-bot': {
      const p = [...room.players].reverse().find((p) => p.bot);
      if (p) game.remove(room, p);
      break;
    }
    case 'spawn-dummies':
      for (
        let i = 0;
        i < (message.count ?? 1) && room.robots.length < 16;
        i++
      ) {
        const entity = makeEntity(randomBytes(8).toString('hex'));
        entity.type = 'robot';
        entity.position = { ...player.entity.position };
        room.robots.push(entity);
      }
      break;
    case 'clear-dummies':
      room.robots = [];
      break;
    case 'teleport':
    case 'reset-player': {
      const spawn = spawnEntity(
        player.id,
        room.players.indexOf(player),
        game.level(room),
      );
      player.entity =
        message.action === 'reset-player'
          ? spawn
          : {
              ...player.entity,
              position: spawn.position,
              velocity: spawn.velocity,
            };
      player.queue = [];
      player.received = player.ack;
      sendDev(game, room, true);
      break;
    }
    case 'tune':
      if (!message.tuning) throw new Error('Missing tuning values.');
      state.tuning = { ...state.tuning, ...message.tuning };
      sendDev(game, room, true);
      break;
    case 'reset-tuning':
      state.tuning = { ...DEFAULT_TUNING };
      sendDev(game, room, true);
      break;
  }
  game.update(room);
  sendDev(game, room);
}
export function devTick(game: Game, room: Room) {
  if (room.phase !== 'PLAYING') return;
  const state = room.dev;
  if (state) {
    if (!state.timerEnabled || state.frozen)
      room.deadline = game.now() + state.remainingMs;
    else state.remainingMs = Math.max(0, room.deadline - game.now());
  }
  room.players.forEach((p, index) => {
    if (!p.bot) return;
    const phase = parseInt(p.id.slice(0, 4), 16) / 1024;
    // Alternate bots run the traversal routine; the rest keep the original wander.
    const input =
      index % 2
        ? {
            ...traversalInput(game.tick + Math.floor(phase * 97), phase),
            seq: p.ack + 1,
          }
        : {
            seq: p.ack + 1,
            tick: game.tick,
            x: Math.sin(game.tick / 60 + phase),
            z: Math.cos(game.tick / 87 + phase),
            yaw: Math.sin(game.tick / 180 + phase),
            pitch: 0,
            buttons: game.tick % 240 === 0 ? 1 : 0,
          };
    p.queue = [input];
    p.received = input.seq;
  });
}
