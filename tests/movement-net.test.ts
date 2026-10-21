import { describe, it, expect } from 'vitest';
import { Game, type Peer } from '../packages/server/src/game';
import {
  BUTTON,
  CONFIG,
  LEVELS,
  MISSION_LEVELS,
  MOVE,
  decodeClient,
  hasLevel,
} from '@leviathan/shared';
import {
  registerMovementLab,
  MOVEMENT_LAB_ID,
} from '../packages/shared/src/movement-lab';
import type { ServerMessage, Snapshot } from '@leviathan/shared';
function solo(devTools = true, level?: 'lab') {
  const game = new Game({ devTools });
  const messages: ServerMessage[] = [];
  const peer: Peer = {
    id: 'net',
    send: (m) => messages.push(structuredClone(m)),
    close: () => {},
  };
  game.handle(peer, {
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: 'TESTER',
    ...(level ? { level } : {}),
  });
  return { game, peer, messages };
}
describe('movement replication and dev levels', () => {
  it('rejects the Movement Lab until a dev entry registers it, and never lists it', () => {
    expect(hasLevel(MOVEMENT_LAB_ID)).toBe(false);
    const { peer, messages } = solo(true, 'lab');
    expect(peer.room).toBeUndefined();
    expect(messages.at(-1)).toMatchObject({ type: 'error' });
    expect(Object.keys(LEVELS)).not.toContain(MOVEMENT_LAB_ID);
    expect(MISSION_LEVELS).not.toContain(MOVEMENT_LAB_ID);
    registerMovementLab();
    const lab = solo(true, 'lab');
    expect(lab.peer.room!.phase).toBe('PLAYING');
    expect(lab.game.view(lab.peer.room!).levelId).toBe(MOVEMENT_LAB_ID);
    expect(lab.peer.player!.entity.position.z).toBe(64);
    // A plain solo restart returns the same room to its mission level.
    lab.game.handle(lab.peer, {
      type: 'dev-solo',
      protocol: CONFIG.protocol,
      name: 'TESTER',
    });
    expect(lab.game.view(lab.peer.room!).levelId).toBe('foundry-row');
    // Production rejects dev-solo entirely, so the lab is unreachable there.
    const production = solo(false, 'lab');
    expect(production.peer.room).toBeUndefined();
  });
  it('sends compact motion bits to everyone and the full sub-state only to its owner', () => {
    const { game, peer } = solo();
    game.handle(peer, { type: 'dev', action: 'add-bots', count: 2 });
    const room = peer.room!;
    for (let i = 0; i < 5; i++) game.step();
    const sent = new Map<string, Snapshot>();
    for (const p of room.players)
      if (p.peer)
        p.peer.send = (m) =>
          m.type === 'snapshot' && sent.set(p.id, structuredClone(m));
    game.sendSnapshots(room);
    const mine = sent.get(peer.player!.id)!;
    expect(mine.entities.every((e) => e.move === undefined)).toBe(true);
    expect(mine.entities.every((e) => typeof e.motion === 'number')).toBe(true);
    expect(mine.move).toEqual(peer.player!.entity.move);
    const other = room.players.find((p) => p !== peer.player)!;
    expect(sent.get(other.id)!.move).toEqual(other.entity.move);
    expect(JSON.stringify(mine.entities)).toBe(
      JSON.stringify(sent.get(other.id)!.entities),
    );
  });
  it('keeps held buttons through idle server ticks so no false jump edge appears', () => {
    const { game, peer } = solo();
    const send = (seq: number, buttons: number) =>
      game.handle(peer, {
        type: 'inputs',
        inputs: [{ seq, tick: seq, x: 0, z: 0, yaw: 0, pitch: 0, buttons }],
      });
    send(1, BUTTON.jump);
    game.step();
    for (let i = 0; i < 90; i++) game.step();
    expect(peer.player!.entity.move!.mode).toBe('GROUND');
    // Input resumes with jump still held: no new edge, so no second jump.
    send(2, BUTTON.jump);
    game.step();
    expect(peer.player!.entity.velocity.y).toBe(0);
    expect(peer.player!.entity.move!.mode).toBe('GROUND');
  });
  it('validates partial movement tuning by name and range', () => {
    const tune = (tuning: Record<string, number>) =>
      decodeClient(JSON.stringify({ type: 'dev', action: 'tune', tuning }));
    expect(tune({ wallRunTime: 3, slideDecel: 2 })).not.toBeNull();
    expect(tune({ notAConstant: 1 })).toBeNull();
    expect(tune({ gravity: 400 })).toBeNull();
    expect(Object.keys(MOVE).length).toBeGreaterThan(40);
    expect(
      decodeClient(
        JSON.stringify({
          type: 'dev-solo',
          protocol: CONFIG.protocol,
          name: 'T',
          level: 'secret',
        }),
      ),
    ).toBeNull();
  });
});
