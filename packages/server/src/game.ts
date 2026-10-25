import { randomBytes, randomInt } from 'node:crypto';
import {
  missionLevel,
  getLevel,
  hasLevel,
  levelWorld,
  spawnEntity,
  inside,
  CODE_ALPHABET,
  CONFIG,
  DEV_LEVELS,
  FLAG,
  MISSIONS,
  makeEntity,
  sanitizeCombatInput,
  stepPlayer,
  stepCombatant,
  resolveTuning,
  STATUS,
  COMBAT,
  DEFAULT_RULES,
  type Shot,
  type Throw,
  type Vec3,
} from '@leviathan/shared';
import type {
  ClientMessage,
  Entity,
  Input,
  Phase,
  RoomView,
  ServerMessage,
  Snapshot,
  Vote,
  DevState,
} from '@leviathan/shared';
import { cleanName, uniqueName } from './names';
import { devState, instantStart, handleDev, devTick } from './dev-tools';
import {
  ALL_WEAPONS,
  CombatWorld,
  restock,
  type Combatant,
} from './combat-server';
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
  /** Catch-up credit: one per tick with no input queued (capped). A later backlog
   * may spend it to process extra inputs, so input steps never exceed real ticks
   * but a client hitch no longer leaves a permanent input delay. */
  credit?: number;
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
  /** Dev-only level override (the Movement Lab); missions select levels otherwise. */
  levelId?: string;
  /** Authoritative combat (hits, projectiles, hazards, crates), reset per mission. */
  combat?: CombatWorld;
}
/** Snapshot entities carry compact motion bits; the full sub-state goes to its owner. */
const publicEntity = (e: Entity): Entity => ({
  id: e.id,
  type: e.type,
  position: e.position,
  velocity: e.velocity,
  yaw: e.yaw,
  pitch: e.pitch,
  health: e.health,
  flags: e.flags,
  motion: e.motion ?? 0,
  slot: e.slot ?? 0,
  status: e.status ?? 0,
});
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
  level(r: Room) {
    return r.levelId ? getLevel(r.levelId) : missionLevel(r.mission);
  }
  view(r: Room): RoomView {
    return {
      code: r.code,
      hostId: r.hostId,
      phase: r.phase,
      mission: r.mission,
      levelId: this.level(r).id,
      levelSeed: this.level(r).seed,
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
  snapshot(r: Room, recipient?: Player): Snapshot {
    return {
      type: 'snapshot' as const,
      tick: this.tick,
      time: this.now(),
      entities: [
        ...[...r.players.map((p) => p.entity), ...r.robots].map(publicEntity),
        ...(r.phase === 'PLAYING' ? (r.combat?.entities(this.tick) ?? []) : []),
      ],
      acks: Object.fromEntries(r.players.map((p) => [p.id, p.ack])),
      ...(recipient?.entity.move ? { move: recipient.entity.move } : {}),
      ...(recipient?.entity.combat ? { combat: recipient.entity.combat } : {}),
    };
  }
  sendSnapshots(r: Room) {
    const base = this.snapshot(r);
    if (r.combat?.events.length) {
      base.events = r.combat.events;
      r.combat.events = [];
    }
    for (const p of r.players)
      p.peer?.send({
        ...base,
        ...(p.entity.move ? { move: p.entity.move } : {}),
        ...(p.entity.combat ? { combat: p.entity.combat } : {}),
      });
  }
  /** Loadout owned by every operator in this room (all tiers on dev servers). */
  owned() {
    return this.settings.devTools ? ALL_WEAPONS : 0b11;
  }
  /** Spawn with a fresh loadout; `keep` carries weapon state over (out-of-bounds). */
  spawn(r: Room, p: Player, keep = false) {
    const e = spawnEntity(
      p.id,
      r.players.indexOf(p),
      this.level(r),
      r.players.filter((q) => q !== p).map((q) => q.entity),
    );
    return keep && p.entity.combat
      ? {
          ...e,
          combat: p.entity.combat,
          slot: p.entity.slot,
          health: p.entity.health,
          status: p.entity.status,
        }
      : restock(
          e,
          p.entity.combat?.owned ?? this.owned(),
          r.combat?.rules() ?? DEFAULT_RULES,
        );
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
        const levelId = m.level ? DEV_LEVELS[m.level] : undefined;
        if (levelId && !hasLevel(levelId))
          throw new Error('That test level is not available on this server.');
        if (!peer.room)
          this.handle(peer, {
            type: 'create',
            protocol: m.protocol,
            name: m.name || 'TESTER',
          });
        if (peer.room && peer.player) {
          peer.room.levelId = levelId;
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
            this.level(r),
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
              const i = sanitizeCombatInput(raw);
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
    peer.send(this.snapshot(r, p));
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
    r.combat = new CombatWorld(this.level(r), 1 / this.settings.tickRate, () =>
      this.settings.devTools ? r.dev?.combat : undefined,
    );
    for (const [i, p] of r.players.entries()) {
      p.entity = restock(
        spawnEntity(p.id, i, this.level(r)),
        this.owned(),
        r.combat.rules(),
      );
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
  /** One PLAYING tick: inputs through the shared combat step (movement unchanged),
   * then shots resolve against the lag-compensation history, then hazards, crates,
   * strikes, deaths and respawns. */
  stepCombat(r: Room) {
    const level = this.level(r),
      world = levelWorld(level),
      dt = 1 / this.settings.tickRate,
      combat = (r.combat ??= new CombatWorld(level, dt, () =>
        this.settings.devTools ? r.dev?.combat : undefined,
      )),
      rules = combat.rules(),
      tune = this.settings.devTools ? resolveTuning(r.dev?.tuning) : undefined;
    const fired: {
      player: Player;
      shots: Shot[];
      throws: Throw[];
      fingers?: { origin: Vec3; dir: Vec3 };
      view?: number;
    }[] = [];
    for (const p of r.players) {
      if (!p.peer) continue;
      if (
        p.entity.position.y < level.killY ||
        !inside(p.entity.position, level.bounds)
      ) {
        p.entity = this.spawn(r, p, true);
        p.queue = [];
      }
      let i = p.queue.shift();
      if (!i) p.credit = Math.min(CONFIG.maxQueue, (p.credit ?? 0) + 1);
      const extra = () => {
        if (p.queue.length > 2 && (p.credit ?? 0) > 0) {
          p.credit = (p.credit ?? 0) - 1;
          return p.queue.shift();
        }
        return undefined;
      };
      if ((p.entity.status ?? 0) & STATUS.dead) {
        // Dead operators keep acknowledging input but do not move or fire.
        if (i) p.ack = i.seq;
        for (let k = 0, x = extra(); x && k < 2; k++, x = extra())
          p.ack = x.seq;
        continue;
      }
      if (!i) {
        // Missing input: zero axes and held movement buttons (no false edges). The
        // weapon is clocked by real inputs only, exactly as the client predicts it,
        // so a starved link neither fires nor advances weapon timers.
        p.entity = stepPlayer(
          p.entity,
          {
            seq: p.ack,
            tick: this.tick,
            x: 0,
            z: 0,
            yaw: p.entity.yaw,
            pitch: p.entity.pitch,
            buttons: p.entity.move?.buttons ?? 0,
          },
          dt,
          world,
          tune,
        );
        continue;
      }
      for (let k = 0; i && k < 3; k++, i = extra()) {
        const out = stepCombatant(p.entity, i, dt, world, tune, rules);
        p.entity = out.entity;
        p.ack = i.seq;
        if (out.shots.length || out.throws.length || out.fingers)
          fired.push({
            player: p,
            shots: out.shots,
            throws: out.throws,
            fingers: out.fingers,
            view: i.view,
          });
      }
      if (
        p.entity.position.y < level.killY ||
        !inside(p.entity.position, level.bounds)
      ) {
        p.entity = this.spawn(r, p, true);
        p.queue = [];
      }
    }
    // Debug-only wandering robots prove generic entities; dummies stand still or
    // strafe on a fixed path (dev-tools). Combat AI is deliberately absent.
    for (let j = 0; j < r.robots.length; j++) {
      const e = r.robots[j]!;
      if (((e.status ?? 0) & (STATUS.dummy | STATUS.dead)) !== 0) continue;
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
        dt,
        world,
      );
    }
    const players: Combatant[] = r.players
      .filter((p) => p.peer)
      .map((p) => ({
        entity: p.entity,
        player: true,
        set: (e) => {
          p.entity = e;
        },
      }));
    const robots: Combatant[] = r.robots.map((e, j) => ({
      entity: e,
      player: false,
      set: (next) => {
        r.robots[j] = next;
      },
    }));
    const all = [...players, ...robots];
    for (const f of fired) {
      const shooter = all.find((c) => c.entity.id === f.player.entity.id);
      if (!shooter) continue;
      combat.fire(shooter, f.shots, f.view, this.tick, all);
      combat.throwFlasks(shooter, f.throws);
      if (f.fingers)
        combat.callFingers(shooter, f.fingers.origin, f.fingers.dir, this.tick);
    }
    combat.tick(this.tick, all, players);
    // Deaths: operators respawn after a delay with a fresh loadout; dummies reset;
    // wandering robots are removed (their crate was dropped on death).
    for (const p of r.players) {
      if (!((p.entity.status ?? 0) & STATUS.dead)) continue;
      const s = combat.status.get(p.id);
      if (s && this.tick >= s.deadUntil) {
        p.entity = this.spawn(r, p);
        p.queue = [];
        combat.status.delete(p.id);
        combat.events.push({ t: 'respawn', player: p.id });
      }
    }
    r.robots = r.robots.filter(
      (e) =>
        !((e.status ?? 0) & STATUS.dead) || !!((e.status ?? 0) & STATUS.dummy),
    );
    for (let j = 0; j < r.robots.length; j++) {
      const e = r.robots[j]!,
        s = combat.status.get(e.id);
      if ((e.status ?? 0) & STATUS.dead && s && this.tick >= s.deadUntil) {
        r.robots[j] = {
          ...e,
          health: COMBAT.dummyHealth,
          status: STATUS.dummy,
        };
        combat.status.delete(e.id);
      }
    }
    combat.record(this.tick, [
      ...r.players
        .filter((p) => p.peer)
        .map((p) => ({ entity: p.entity, player: true, set: () => {} })),
      ...r.robots.map((e) => ({ entity: e, player: false, set: () => {} })),
    ]);
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
        this.stepCombat(r);
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
