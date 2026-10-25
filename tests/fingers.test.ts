import { describe, it, expect } from 'vitest';
import { Game, type Peer } from '../packages/server/src/game';
import {
  CONFIG,
  FINGERS,
  FIRE,
  FIRE_BUTTON,
  STATUS,
  getLevel,
  type CombatEvent,
  type Input,
  type ServerMessage,
} from '@leviathan/shared';
/** A dev solo room driven one input per tick on a fake clock. */
function solo() {
  let time = 1000;
  const game = new Game({ devTools: true }, () => time);
  const messages: ServerMessage[] = [];
  const peer: Peer = {
    id: 'host',
    send: (m) => messages.push(m),
    close: () => {},
  };
  game.handle(peer, {
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: 'TESTER',
  });
  let seq = 0;
  const events: CombatEvent[] = [];
  const tick = (
    buttons = 0,
    aim?: { x: number; y: number; z: number },
    weapon = 0,
  ) => {
    const me = peer.player!.entity;
    let yaw = me.yaw,
      pitch = 0;
    if (aim) {
      const dx = aim.x - me.position.x,
        dz = aim.z - me.position.z,
        dy = aim.y - (me.position.y + 1.65);
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    const input: Input = {
      seq: ++seq,
      tick: game.tick + 1,
      x: 0,
      z: 0,
      yaw,
      pitch,
      buttons,
      weapon,
      view: game.tick,
    };
    game.handle(peer, { type: 'inputs', inputs: [input] });
    time += 1000 / 60;
    game.step();
    events.push(...(peer.room!.combat?.events ?? []));
    peer.room!.combat!.events = [];
  };
  return { game, peer, tick, events };
}
describe('Fingers of God', () => {
  it('charges from damage dealt to hostiles and activates only when full', () => {
    const { game, peer, tick } = solo();
    game.handle(peer, { type: 'dev', action: 'spawn-range', count: 1 });
    const dummy = peer.room!.robots[0]!;
    const chest = { ...dummy.position, y: dummy.position.y + 1 };
    for (let i = 0; i < 5; i++) tick();
    const before = peer.player!.entity.combat!.fingers;
    tick(FIRE_BUTTON.fire, chest);
    const after = peer.player!.entity.combat!.fingers;
    // One rivet hit (30 at 8 m, no falloff) plus one tick of passive charge.
    expect(after - before).toBeCloseTo(30 + FINGERS.passivePerSecond / 60, 6);
    // Not full: Q does nothing.
    for (let i = 0; i < 3; i++) tick();
    tick(FIRE_BUTTON.fingers, chest);
    expect(peer.room!.combat!.strikes).toHaveLength(0);
  });
  it('calls five staggered beams that damage, ignite and stay capped', () => {
    const { game, peer, tick, events } = solo();
    game.handle(peer, { type: 'dev', action: 'spawn-range', count: 1 });
    game.handle(peer, { type: 'dev', action: 'fill-fingers' });
    const dummy = peer.room!.robots[0]!;
    const feet = { ...dummy.position };
    tick();
    tick(FIRE_BUTTON.fingers, feet);
    const combat = peer.room!.combat!;
    expect(combat.strikes).toHaveLength(FINGERS.count);
    expect(peer.player!.entity.combat!.fingers).toBeLessThan(1);
    const impacts = combat.strikes.map((s) => s.impactTick);
    expect(Math.min(...impacts) - game.tick).toBeCloseTo(
      FINGERS.telegraph * 60,
      -1,
    );
    expect(Math.max(...impacts) - Math.min(...impacts)).toBe(
      Math.round((FINGERS.count - 1) * FINGERS.stagger * 60),
    );
    // Strike entities are public (telegraph markers) until impact.
    peer.room!.players[0]!.peer!.send = () => {};
    const snap = game.snapshot(peer.room!);
    expect(snap.entities.filter((e) => e.type === 'strike')).toHaveLength(
      FINGERS.count,
    );
    for (let i = 0; i < 100; i++) tick();
    expect(combat.strikes).toHaveLength(0);
    const blasts = events.filter(
      (e) => e.t === 'blast' && e.kind === 'fingers',
    );
    expect(blasts).toHaveLength(FINGERS.count);
    const hits = events.filter(
      (e) => e.t === 'hit' && e.cause === 'fingers' && e.target === dummy.id,
    );
    expect(hits.length).toBeGreaterThan(0);
    const target = peer.room!.robots.find((r) => r.id === dummy.id)!;
    expect(target.health < 200 || !!((target.status ?? 0) & STATUS.dead)).toBe(
      true,
    );
    const fires = combat.hazards.filter((h) => h.kind === 'fire');
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.length).toBeLessThanOrEqual(FIRE.maxFires);
  });
  it('stops a beam on a roof above the aim point', () => {
    const { game, peer } = solo();
    game.handle(peer, { type: 'dev', action: 'fill-fingers' });
    const combat = peer.room!.combat!;
    const room = getLevel().rooms!.find((r) => r.roof > 10)!;
    const cx = (room.bounds.min.x + room.bounds.max.x) / 2,
      cz = (room.bounds.min.z + room.bounds.max.z) / 2;
    // Aim straight down at the room from above: the beams land on its roof.
    combat.callFingers(
      {
        entity: peer.player!.entity,
        player: true,
        set: () => {},
      },
      { x: cx, y: room.roof + 30, z: cz },
      { x: 0, y: -1, z: 0 },
      game.tick,
    );
    const landed = combat.strikes.filter(
      (s) =>
        s.position.x > room.bounds.min.x &&
        s.position.x < room.bounds.max.x &&
        s.position.z > room.bounds.min.z &&
        s.position.z < room.bounds.max.z,
    );
    expect(landed.length).toBeGreaterThan(0);
    for (const s of landed) expect(s.position.y).toBeGreaterThan(room.roof - 1);
  });
});
