import { randomBytes, randomInt } from 'node:crypto';
import {
  missionLevel,
  levelWorld,
  spawnEntity,
  inside,
  CODE_ALPHABET,
  CONFIG,
  FLAG,
  MISSIONS,
  makeEntity,
  sanitizeInput,
  stepPlayer,
  stepDev,
} from '@leviathan/shared';
import type {
  ClientMessage,
  Entity,
  Input,
  Phase,
  RoomView,
  ServerMessage,
  Vote,
  DevState,
} from '@leviathan/shared';
import { cleanName, uniqueName } from './names';
import { devState, instantStart, handleDev, devTick } from './dev-tools';
export interface Peer {
  id: string;
  send: (message: ServerMessage) => void;
  close: () => void;
  player?: Player;
  room?: Room;
}
export interface Player {
  bot?: boolean;
  id: string;
  name: string;
  token: string;
  ready: boolean;
  ping: number;
  vote: Vote | null;
  peer?: Peer;
  expires: number;
  entity: Entity;
  queue: Input[];
  ack: number;
  received: number;
}
export interface Room {
  dev?: DevState;
  code: string;
  players: Player[];
  hostId: string;
  phase: Phase;
  mission: number;
  deadline: number;
  emptySince: number | null;
  robots: Entity[];
  result: RoomView['result'];
  lastVote: RoomView['lastVote'];
  started: number;
}
export interface Settings {
  tickRate: number;
  snapshotRate: number;
  devTools: boolean;
  countdownMs: number;
  matchMs: number;
  voteMs: number;
  reconnectMs: number;
  emptyRoomMs: number;
}
export const defaults: Settings = {
  tickRate: CONFIG.tickRate,
  snapshotRate: CONFIG.snapshotRate,
  devTools: false,
  countdownMs: CONFIG.countdownMs,
  matchMs: CONFIG.matchMs,
  voteMs: CONFIG.voteMs,
  reconnectMs: CONFIG.reconnectMs,
  emptyRoomMs: CONFIG.emptyRoomMs,
};
export function generateCode(
  existing: ReadonlyMap<string, unknown>,
  pick = () => randomInt(CODE_ALPHABET.length),
): string {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[pick()];
    if (!existing.has(code)) return code;
  }
  throw new Error('Room capacity exhausted. Try again.');
}
export function resolveVote(
  players: Pick<Player, 'id' | 'vote'>[],
  hostId: string,
): Vote {
  const replay = players.filter((p) => p.vote === 'REPLAY').length;
  const next = players.filter((p) => p.vote === 'NEXT').length;
  if (!replay && !next) return 'REPLAY';
  if (replay === next)
    return players.find((p) => p.id === hostId)?.vote ?? 'REPLAY';
  return next > replay ? 'NEXT' : 'REPLAY';
}
export class Game {
  rooms = new Map<string, Room>();
  tick = 0;
  settings: Settings;
  constructor(
    settings: Partial<Settings> = {},
    public now = () => Date.now(),
  ) {
    this.settings = { ...defaults, ...settings };
  }
  view(r: Room): RoomView {
    return {
      code: r.code,
      hostId: r.hostId,
      phase: r.phase,
      mission: r.mission,
      levelId: missionLevel(r.mission).id,
      levelSeed: missionLevel(r.mission).seed,
      deadline: r.deadline,
      players: r.players.map((p) => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        connected: !!p.peer,
        ping: p.ping,
        vote: p.vote,
      })),
      result: r.result,
      lastVote: r.lastVote,
    };
  }
  broadcast(r: Room, m: ServerMessage) {
    for (const p of r.players) p.peer?.send(m);
  }
  update(r: Room) {
    this.broadcast(r, { type: 'room', room: this.view(r) });
  }
  snapshot(r: Room) {
    return {
      type: 'snapshot' as const,
      tick: this.tick,
      time: this.now(),
      entities: [...r.players.map((p) => p.entity), ...r.robots],
      acks: Object.fromEntries(r.players.map((p) => [p.id, p.ack])),
    };
  }
  handle(peer: Peer, m: ClientMessage) {
    try {
      if (
        (m.type === 'dev' || m.type === 'dev-solo' || m.type === 'debug') &&
        !this.settings.devTools
      )
        throw new Error('Developer tools are disabled on this server.');
      if ('protocol' in m && m.protocol !== CONFIG.protocol) {
        peer.send({
          type: 'error',
          code: 'VERSION',
          message: 'Please refresh the page. Protocol version changed.',
        });
        return;
      }
      if (m.type === 'resume') {
        this.resume(peer, m.code.toUpperCase(), m.token);
        return;
      }
      if (m.type === 'dev-solo') {
        if (peer.room && peer.player && peer.room.hostId !== peer.player.id)
          throw new Error('Solo restart requires the host.');
        if (!peer.room)
          this.handle(peer, {
            type: 'create',
            protocol: m.protocol,
            name: m.name || 'TESTER',
          });
        if (peer.room && peer.player) {
          const state = devState(peer.room);
          state.solo = true;
          state.timerEnabled = false;
          peer.player.ready = true;
          instantStart(this, peer.room);
        }
        return;
      }
      if (m.type === 'create' || m.type === 'join') {
        if (peer.player) throw new Error('Already connected to a room.');
        const name = cleanName(m.name);
        let r: Room | undefined;
        if (m.type === 'create') {
          if (this.rooms.size >= 1000)
            throw new Error('Server room capacity reached.');
          const code = generateCode(this.rooms);
          r = {
            code,
            players: [],
            hostId: '',
            phase: 'LOBBY',
            mission: 0,
            deadline: 0,
            emptySince: null,
            robots: [],
            result: null,
            lastVote: null,
            started: 0,
          };
          this.rooms.set(code, r);
        } else r = this.rooms.get(m.code.trim().toUpperCase());
        if (!r) throw new Error('Unknown room code.');
        if (r.phase !== 'LOBBY')
          throw new Error('Mission in progress. Join when the lobby opens.');
        if (r.players.length >= CONFIG.maxPlayers)
          throw new Error('Room is full.');
        const id = randomBytes(8).toString('hex');
        const p: Player = {
          id,
          name: uniqueName(
            name,
            r.players.map((p) => p.name),
          ),
          token: randomBytes(32).toString('hex'),
          ready: false,
          ping: 0,
          vote: null,
          expires: 0,
          entity: spawnEntity(
            id,
            r.players.length,
            missionLevel(r.mission),
            r.players.map((p) => p.entity),
          ),
          queue: [],
          ack: 0,
          received: 0,
        };
        r.players.push(p);
        r.emptySince = null;
        if (!r.hostId) r.hostId = p.id;
        this.attach(peer, r, p);
        this.broadcast(r, { type: 'event', event: 'join', name: p.name });
        this.update(r);
        return;
      }
      const p = peer.player,
        r = peer.room;
      if (!p || !r || p.peer !== peer) throw new Error('Join a room first.');
      switch (m.type) {
        case 'dev':
          handleDev(this, peer, m);
          break;
        case 'ready':
          if (r.phase === 'LOBBY') {
            p.ready = m.ready;
            this.update(r);
          }
          break;
        case 'start':
          if (p.id !== r.hostId) throw new Error('Only the host can start.');
          if (r.phase !== 'LOBBY') throw new Error('Mission already started.');
          if (
            r.players.filter((p) => p.peer).length <
              (this.settings.devTools ? 1 : 2) ||
            r.players.some((p) => !p.ready || !p.peer)
          )
            throw new Error(
              'All operators must be connected and ready; at least two are required.',
            );
          this.begin(r);
          break;
        case 'leave':
          this.remove(r, p);
          peer.room = undefined;
          peer.player = undefined;
          break;
        case 'lobby':
          if (p.id !== r.hostId || r.phase !== 'ENDED')
            throw new Error(
              'Only the host can reopen the lobby after a mission.',
            );
          r.phase = 'LOBBY';
          r.deadline = 0;
          for (const operator of r.players) {
            operator.ready = false;
            operator.vote = null;
          }
          this.update(r);
          break;
        case 'vote':
          if (r.phase !== 'ENDED') throw new Error('Voting is closed.');
          p.vote = m.vote;
          this.update(r);
          break;
        case 'inputs':
          if (r.phase === 'PLAYING')
            for (const raw of m.inputs) {
              if (raw.seq <= p.received) continue;
              if (p.queue.length >= CONFIG.maxQueue) break;
              const i = sanitizeInput(raw);
              p.queue.push(i);
              p.received = i.seq;
            }
          break;
        case 'debug':
          if (!this.settings.devTools || p.id !== r.hostId)
            throw new Error('Debug commands require a development host.');
          if (m.action === 'end' && r.phase === 'PLAYING') this.end(r);
          else if (m.action === 'robot') {
            const e = makeEntity(randomBytes(8).toString('hex'));
            e.type = 'robot';
            if (r.robots.length < 16) r.robots.push(e);
          }
          break;
        case 'pong':
          break;
      }
    } catch (error) {
      peer.send({
        type: 'error',
        code: 'REQUEST',
        message: error instanceof Error ? error.message : 'Invalid request.',
      });
    }
  }
  attach(peer: Peer, r: Room, p: Player) {
    peer.player = p;
    peer.room = r;
    p.peer = peer;
    p.expires = 0;
    p.entity.flags &= ~FLAG.disconnected;
    p.queue = [];
    p.received = p.ack;
    peer.send({
      type: 'welcome',
      token: p.token,
      playerId: p.id,
      room: this.view(r),
      seq: p.ack,
      devTools: this.settings.devTools,
    });
    if (this.settings.devTools)
      peer.send({ type: 'dev-state', state: devState(r) });
    peer.send(this.snapshot(r));
  }
  resume(peer: Peer, code: string, token: string) {
    if (peer.player) throw new Error('Already connected.');
    const r = this.rooms.get(code);
    const p = r?.players.find((p) => p.token === token);
    if (!r || !p || (!p.peer && p.expires <= this.now())) {
      peer.send({
        type: 'error',
        code: 'SESSION_EXPIRED',
        message: 'Session expired. Join the room again.',
      });
      return;
    }
    if (p.peer) {
      const old = p.peer;
      old.player = undefined;
      old.room = undefined;
      old.send({ type: 'replaced' });
      old.close();
    }
    this.attach(peer, r, p);
    this.broadcast(r, { type: 'event', event: 'reconnect', name: p.name });
    this.update(r);
  }
  disconnect(peer: Peer) {
    const p = peer.player,
      r = peer.room;
    if (!p || !r || p.peer !== peer) return;
    p.peer = undefined;
    p.expires = this.now() + this.settings.reconnectMs;
    p.entity.flags |= FLAG.disconnected;
    p.queue = [];
    this.broadcast(r, { type: 'event', event: 'disconnect', name: p.name });
    this.update(r);
  }
  remove(r: Room, p: Player) {
    r.players = r.players.filter((q) => q !== p);
    if (this.settings.devTools && !r.players.some((p) => !p.bot))
      r.players = [];
    if (r.hostId === p.id)
      r.hostId = r.players.find((candidate) => !candidate.bot)?.id ?? '';
    if (!r.players.length) r.emptySince = this.now();
    this.broadcast(r, { type: 'event', event: 'leave', name: p.name });
    this.update(r);
  }
  begin(r: Room) {
    r.phase = 'COUNTDOWN';
    r.deadline = this.now() + this.settings.countdownMs;
    r.robots = [];
    r.result = null;
    for (const [i, p] of r.players.entries()) {
      p.entity = spawnEntity(p.id, i, missionLevel(r.mission));
      if (!p.peer) p.entity.flags |= FLAG.disconnected;
      p.queue = [];
      p.received = p.ack;
      p.vote = null;
    }
    this.update(r);
  }
  end(r: Room) {
    r.phase = 'ENDED';
    r.deadline = this.now() + this.settings.voteMs;
    r.result = {
      survived: Math.round((this.now() - r.started) / 1000),
      present: r.players.filter((p) => p.peer).length,
    };
    for (const p of r.players) p.queue = [];
    this.update(r);
  }
  step() {
    this.tick++;
    const now = this.now();
    for (const r of this.rooms.values()) {
      for (const p of [...r.players])
        if (!p.peer && p.expires <= now) this.remove(r, p);
      if (
        !r.players.length &&
        r.emptySince !== null &&
        now - r.emptySince >= this.settings.emptyRoomMs
      ) {
        this.rooms.delete(r.code);
        continue;
      }
      if (r.phase === 'COUNTDOWN' && now >= r.deadline) {
        r.phase = 'PLAYING';
        r.started = now;
        r.deadline = now + this.settings.matchMs;
        this.update(r);
      }
      if (r.phase === 'PLAYING') {
        if (this.settings.devTools) devTick(this, r);
        for (const p of r.players) {
          if (!p.peer) continue;
          const level = missionLevel(r.mission);
          if (
            p.entity.position.y < level.killY ||
            !inside(p.entity.position, level.bounds)
          ) {
            p.entity = spawnEntity(
              p.id,
              r.players.indexOf(p),
              level,
              r.players.filter((q) => q !== p).map((q) => q.entity),
            );
            p.queue = [];
          }
          const i = p.queue.shift();
          if (i) {
            p.entity = stepDev(
              p.entity,
              i,
              1 / this.settings.tickRate,
              levelWorld(missionLevel(r.mission)),
              this.settings.devTools ? r.dev?.tuning : undefined,
            );
            p.ack = i.seq;
          } else {
            const idle: Input = {
              seq: p.ack,
              tick: this.tick,
              x: 0,
              z: 0,
              yaw: p.entity.yaw,
              pitch: p.entity.pitch,
              buttons: 0,
            };
            p.entity = stepDev(
              p.entity,
              idle,
              1 / this.settings.tickRate,
              levelWorld(missionLevel(r.mission)),
              this.settings.devTools ? r.dev?.tuning : undefined,
            );
          }
        }
        for (const p of r.players) {
          const level = missionLevel(r.mission);
          if (
            p.peer &&
            (p.entity.position.y < level.killY ||
              !inside(p.entity.position, level.bounds))
          ) {
            p.entity = spawnEntity(
              p.id,
              r.players.indexOf(p),
              level,
              r.players.filter((q) => q !== p).map((q) => q.entity),
            );
            p.queue = [];
          }
        }
        // Debug-only wandering proves generic entities; combat AI is deliberately absent.
        for (let j = 0; j < r.robots.length; j++) {
          const e = r.robots[j]!;
          r.robots[j] = stepPlayer(
            e,
            {
              seq: 0,
              tick: this.tick,
              x: Math.sin(this.tick / 90 + j),
              z: Math.cos(this.tick / 113 + j),
              yaw: e.yaw + (Math.random() - 0.5) * 0.1,
              pitch: 0,
              buttons: 0,
            },
            1 / this.settings.tickRate,
            levelWorld(missionLevel(r.mission)),
          );
        }
        if (
          now >= r.deadline &&
          (!this.settings.devTools ||
            !r.dev ||
            (r.dev.timerEnabled && !r.dev.frozen))
        )
          this.end(r);
      }
      if (r.phase === 'ENDED' && now >= r.deadline) {
        const choice = resolveVote(r.players, r.hostId);
        if (choice === 'NEXT') r.mission = (r.mission + 1) % MISSIONS.length;
        r.lastVote = { choice, mission: r.mission };
        for (const p of r.players) {
          p.ready = false;
          p.vote = null;
        }
        if (
          r.players.filter((p) => p.peer).length >=
          (this.settings.devTools ? 1 : 2)
        ) {
          this.begin(r);
        } else {
          r.phase = 'LOBBY';
          r.deadline = 0;
          this.update(r);
        }
      }
    }
  }
}
