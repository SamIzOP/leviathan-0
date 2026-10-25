import { randomBytes } from 'node:crypto';
import {
  CONFIG,
  DEFAULT_DEV_COMBAT,
  DEFAULT_TUNING,
  FINGERS,
  FIRE_BUTTON,
  OIL,
  STATUS,
  WEAPONS,
  clearLine,
  cloneCombat,
  eyeOf,
  makeEntity,
  spawnEntity,
  traversalInput,
  type Entity,
  type Input,
  type Vec3,
} from '@leviathan/shared';
import { ALL_WEAPONS, makeDummy } from './combat-server';
import type { ClientMessage, DevState } from '@leviathan/shared';
import type { Game, Peer, Player, Room } from './game';
export function devState(room: Room): DevState {
  return (room.dev ??= {
    solo: false,
    timerEnabled: true,
    frozen: false,
    remainingMs: CONFIG.matchMs,
    tuning: { ...DEFAULT_TUNING },
    combat: { ...DEFAULT_DEV_COMBAT, weapons: {} },
  });
}
/** Server-side weapon state edit for the host (reconciled by client prediction). */
function editCombat(
  player: Player,
  edit: (c: NonNullable<Entity['combat']>) => void,
) {
  if (!player.entity.combat) return;
  const c = cloneCombat(player.entity.combat);
  edit(c);
  player.entity = { ...player.entity, combat: c, slot: c.slot };
}
/** Static range dummies along the host facing, pulled in until in clear sight. */
function spawnRange(room: Room, player: Player, count: number) {
  const combat = room.combat;
  if (!combat) return;
  const yaw = player.entity.yaw,
    fx = -Math.sin(yaw),
    fz = -Math.cos(yaw),
    right = { x: -fz, y: 0, z: fx };
  const distances = count === 1 ? [8] : [8, 15, 25, 40, 60].slice(0, count);
  const eye = eyeOf(player.entity);
  distances.forEach((distance, i) => {
    if (room.robots.length >= 16) return;
    const side = count === 1 ? 0 : (i - (distances.length - 1) / 2) * 1.6;
    for (let d = distance; d >= 4; d -= 2) {
      const p: Vec3 = combat.ground({
        x: player.entity.position.x + fx * d + right.x * side,
        y: player.entity.position.y + 1,
        z: player.entity.position.z + fz * d + right.z * side,
      });
      if (!clearLine(combat.world, eye, { x: p.x, y: p.y + 1.2, z: p.z }))
        continue;
      const id = randomBytes(8).toString('hex');
      room.robots.push(makeDummy(id, p, yaw + Math.PI));
      combat.anchors.set(id, { position: p, right, phase: i * 1.3 });
      break;
    }
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
    case 'give-weapon': {
      const slot = message.weapon ?? 0,
        w = WEAPONS[slot]!;
      editCombat(player, (c) => {
        c.owned |= 1 << slot;
        c.ammo[slot] = { mag: w.magazine, reserve: w.reserveMax };
      });
      break;
    }
    case 'give-all-weapons':
      editCombat(player, (c) => {
        c.owned = ALL_WEAPONS;
      });
      break;
    case 'refill-ammo':
      editCombat(player, (c) => {
        const table = room.combat?.rules().table ?? [...WEAPONS];
        c.ammo = table.map((w) => ({ mag: w.magazine, reserve: w.reserveMax }));
        c.oil = OIL.flaskMax;
        c.reload = 0;
      });
      break;
    case 'fill-fingers':
      editCombat(player, (c) => {
        c.fingers = FINGERS.charge;
      });
      break;
    case 'infinite-ammo':
      state.combat.infiniteAmmo = message.enabled ?? !state.combat.infiniteAmmo;
      break;
    case 'friendly-fire':
      state.combat.friendlyFire = message.enabled ?? !state.combat.friendlyFire;
      break;
    case 'hit-debug':
      state.combat.hitDebug = message.enabled ?? !state.combat.hitDebug;
      break;
    case 'bots-fire':
      state.combat.botsFire = message.enabled ?? !state.combat.botsFire;
      break;
    case 'lag-compensation':
      state.combat.lagCompensation =
        message.enabled ?? !state.combat.lagCompensation;
      break;
    case 'moving-dummies':
      state.combat.movingDummies =
        message.enabled ?? !state.combat.movingDummies;
      break;
    case 'damage-scale':
      state.combat.damageScale = Math.max(0, Math.min(10, message.value ?? 1));
      break;
    case 'spawn-range':
      spawnRange(room, player, message.count ?? 5);
      break;
    case 'weapon-tune': {
      const id = message.weaponId;
      if (!id || !WEAPONS.some((w) => w.id === id) || !message.stats)
        throw new Error('Unknown weapon or missing stats.');
      state.combat.weapons = {
        ...state.combat.weapons,
        [id]: { ...state.combat.weapons[id], ...message.stats },
      };
      break;
    }
    case 'reset-weapons':
      state.combat.weapons = {};
      break;
    case 'hurt-self': {
      // Damage-direction test: a hit from 6 m ahead-left of the host.
      const combat = room.combat,
        e = player.entity;
      if (!combat) break;
      const from = {
        x: e.position.x - Math.sin(e.yaw + 0.8) * 6,
        y: e.position.y + 1.2,
        z: e.position.z - Math.cos(e.yaw + 0.8) * 6,
      };
      const target = {
        entity: e,
        player: true,
        set: (n: Entity) => (player.entity = n),
      };
      combat.damage(
        undefined,
        target,
        25 * (message.value ?? 1),
        'body',
        { ...e.position, y: e.position.y + 1 },
        from,
        'blast',
        [],
      );
      break;
    }
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
  // Strafing range dummies (fixed sine path, not AI) exercise lag compensation.
  const combat = room.combat;
  if (combat && state?.combat.movingDummies)
    room.robots = room.robots.map((e) => {
      const a = combat.anchors.get(e.id);
      if (!a || (e.status ?? 0) & STATUS.dead) return e;
      const t = game.tick / CONFIG.tickRate,
        off = Math.sin(t * 1.4 + a.phase) * 2.5,
        speed = Math.cos(t * 1.4 + a.phase) * 2.5 * 1.4;
      return {
        ...e,
        position: {
          x: a.position.x + a.right.x * off,
          y: a.position.y,
          z: a.position.z + a.right.z * off,
        },
        velocity: { x: a.right.x * speed, y: 0, z: a.right.z * speed },
      };
    });
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
    if (state?.combat.botsFire) aimBot(game, room, p, input, index);
    p.queue = [input];
    p.received = input.seq;
  });
}
const botTargets = new Map<string, string | undefined>();
/** Firefight test load: bots fire in bursts at the nearest robot/dummy in sight,
 * else straight ahead, each with its own weapon tier. A dev harness, not robot AI. */
function aimBot(
  game: Game,
  room: Room,
  p: Player,
  input: Input,
  index: number,
) {
  const combat = room.combat;
  const eye = eyeOf(p.entity);
  if (combat && game.tick % 15 === index % 15) {
    let best: Entity | undefined,
      bestD = 70;
    for (const r of room.robots) {
      if ((r.status ?? 0) & STATUS.dead) continue;
      const d = Math.hypot(r.position.x - eye.x, r.position.z - eye.z);
      if (
        d < bestD &&
        clearLine(combat.world, eye, { ...r.position, y: r.position.y + 1.2 })
      ) {
        best = r;
        bestD = d;
      }
    }
    botTargets.set(p.id, best?.id);
  }
  const target = room.robots.find((r) => r.id === botTargets.get(p.id));
  if (target && !((target.status ?? 0) & STATUS.dead)) {
    const dx = target.position.x - eye.x,
      dy = target.position.y + 1.1 - eye.y,
      dz = target.position.z - eye.z;
    input.yaw = Math.atan2(-dx, -dz);
    input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  } else input.pitch = -0.04;
  input.weapon = (index + Math.floor(game.tick / 600)) % WEAPONS.length;
  const cycle = (game.tick + index * 37) % 120;
  if (cycle < 80) input.buttons |= FIRE_BUTTON.fire;
  else if (cycle === 100) input.buttons |= FIRE_BUTTON.reload;
}
