import { describe, it, expect } from 'vitest';
import { Game, type Peer } from '../packages/server/src/game';
import {
  ALL_WEAPONS,
  CombatWorld,
  makeDummy,
  type Combatant,
} from '../packages/server/src/combat-server';
import {
  COMBAT,
  CONFIG,
  FIRE_BUTTON,
  METRICS,
  STATUS,
  WEAPONS,
  clearLine,
  cloneCombat,
  combatRules,
  decodeClient,
  encode,
  eyeOf,
  falloff,
  fireInterval,
  getLevel,
  hitShapes,
  initialCombat,
  levelWorld,
  makeEntity,
  rayShapes,
  raycastWorld,
  sanitizeCombatInput,
  stepWeapon,
  zoneMultiplier,
  type ClientMessage,
  type CombatEvent,
  type CombatRules,
  type CombatState,
  type Cue,
  type Entity,
  type HitShape,
  type Input,
  type Level,
  type ServerMessage,
  type Vec3,
} from '@leviathan/shared';

const DT = 1 / CONFIG.tickRate;
const FIRE = FIRE_BUTTON.fire;
const RELOAD = FIRE_BUTTON.reload;
/** Mirrors the shared whole-tick rounding used by the weapon step. */
const ticksOf = (seconds: number) => Math.max(0, Math.round(seconds / DT));
const reloadTicks = (seconds: number) => Math.max(1, ticksOf(seconds));
const slotOf = (id: string) => {
  const slot = WEAPONS.findIndex((w) => w.id === id);
  if (slot < 0) throw new Error(`no weapon ${id}`);
  return slot;
};
const weapon = (id: string) => WEAPONS[slotOf(id)]!;
type ShotEvent = Extract<CombatEvent, { t: 'shot' }>;
type HitEvent = Extract<CombatEvent, { t: 'hit' }>;

/** The pure weapon half of a tick, driven one input at a time. */
class Rig {
  c: CombatState;
  e: Entity = makeEntity('rig');
  cues: Cue[] = [];
  constructor(
    public rules: CombatRules = combatRules(),
    slot = 0,
  ) {
    this.c = { ...initialCombat(ALL_WEAPONS, rules.table), slot };
  }
  get w() {
    return this.rules.table[this.c.slot]!;
  }
  get ammo() {
    return this.c.ammo[this.c.slot]!;
  }
  step(buttons = 0, slot?: number) {
    const input: Input = {
      seq: 0,
      tick: 0,
      x: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      buttons,
      ...(slot === undefined ? {} : { weapon: slot }),
    };
    const out = stepWeapon(cloneCombat(this.c), this.e, input, DT, this.rules);
    this.c = out.entity.combat!;
    this.cues.push(...out.cues);
    return out.shots.length;
  }
  run(n: number, buttons = 0) {
    let shots = 0;
    for (let i = 0; i < n; i++) shots += this.step(buttons);
    return shots;
  }
  /** One trigger pull: a press, then released until the fire interval has passed. */
  pull() {
    const shots = this.step(FIRE);
    this.run(fireInterval(this.w, DT));
    return shots;
  }
}

/** A flat, wall-less copy of the mission level (floor at y = 0). */
function flatLevel(id: string): Level {
  const base = getLevel();
  return {
    ...base,
    id,
    colliders: [],
    markers: [],
    rooms: [],
    bounds: { min: { x: -300, y: 0, z: -300 }, max: { x: 300, y: 80, z: 300 } },
    weather: { ...base.weather, rain: 0 },
  };
}
function combatant(entity: Entity, player = false): Combatant {
  const c: Combatant = {
    entity,
    player,
    set: (e) => {
      c.entity = e;
    },
  };
  return c;
}

/** A dev solo room on the real mission level, driven through the server boundary. */
function devRoom() {
  let time = 1000;
  const game = new Game({ devTools: true }, () => time);
  const messages: ServerMessage[] = [];
  const peer: Peer = {
    id: 'combat',
    send: (m) => messages.push(m),
    close: () => {},
  };
  game.handle(peer, {
    type: 'dev-solo',
    protocol: CONFIG.protocol,
    name: 'TESTER',
  });
  const room = peer.room!,
    me = peer.player!;
  let seq = 0;
  const input = (over: Partial<Input> = {}): Input => ({
    seq: ++seq,
    tick: game.tick + 1,
    x: 0,
    z: 0,
    yaw: me.entity.yaw,
    pitch: me.entity.pitch,
    buttons: 0,
    ...over,
  });
  /** Through the real wire codec, exactly as the socket handler would. */
  const deliver = (inputs: Input[]) => {
    const decoded = decodeClient(encode({ type: 'inputs', inputs }));
    expect(decoded).not.toBeNull();
    game.handle(peer, decoded!);
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      time += 1000 / CONFIG.tickRate;
      game.step();
    }
  };
  /** A well-behaved 60 Hz client: one input per server tick. */
  const play = (
    n: number,
    over: Partial<Input> | ((k: number) => Partial<Input>) = {},
  ) => {
    for (let k = 0; k < n; k++) {
      deliver([input(typeof over === 'function' ? over(k) : over)]);
      step();
    }
  };
  const dev = (m: Omit<Extract<ClientMessage, { type: 'dev' }>, 'type'>) =>
    game.handle(peer, { type: 'dev', ...m });
  const aimAt = (p: Vec3) => {
    const eye = eyeOf(me.entity),
      dx = p.x - eye.x,
      dy = p.y - eye.y,
      dz = p.z - eye.z;
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    };
  };
  const combat = () => room.combat!;
  const shots = () =>
    combat().events.filter(
      (e): e is ShotEvent => e.t === 'shot' && e.shooter === me.id,
    );
  const hits = (target: string) =>
    combat().events.filter(
      (e): e is HitEvent => e.t === 'hit' && e.target === target,
    );
  const chest = (e: Entity): Vec3 => ({ ...e.position, y: e.position.y + 1 });
  return {
    game,
    peer,
    room,
    me,
    messages,
    input,
    deliver,
    step,
    play,
    dev,
    aimAt,
    combat,
    shots,
    hits,
    chest,
  };
}

describe('damage falloff', () => {
  const falling = WEAPONS.filter((w) => w.falloffEnd > w.falloffStart);
  it('is full to falloffStart, linear to falloffMin at falloffEnd, flat beyond', () => {
    expect(falling.length).toBeGreaterThanOrEqual(2);
    for (const w of falling) {
      const span = w.falloffEnd - w.falloffStart;
      expect(falloff(w, 0)).toBe(1);
      expect(falloff(w, w.falloffStart)).toBe(1);
      expect(falloff(w, w.falloffStart + span / 4)).toBeCloseTo(
        1 - (1 - w.falloffMin) / 4,
        12,
      );
      expect(falloff(w, w.falloffStart + span / 2)).toBeCloseTo(
        (1 + w.falloffMin) / 2,
        12,
      );
      expect(falloff(w, w.falloffEnd)).toBe(w.falloffMin);
      expect(falloff(w, w.falloffEnd + 50)).toBe(w.falloffMin);
      expect(falloff(w, w.range)).toBe(w.falloffMin);
    }
    // A weapon without a falloff band (the launcher) never scales.
    for (const w of WEAPONS.filter((w) => w.falloffEnd <= w.falloffStart))
      for (const d of [0, 10, 100]) expect(falloff(w, d)).toBe(1);
  });
  it('scales authoritative hitscan damage by the distance to the hit', () => {
    const combat = new CombatWorld(
      flatLevel('combat-falloff'),
      DT,
      () => undefined,
    );
    const shooter = combatant(makeEntity('shooter'), true);
    for (const id of ['rivet', 'spool', 'longline']) {
      const slot = slotOf(id),
        w = WEAPONS[slot]!,
        mid = (w.falloffStart + w.falloffEnd) / 2;
      const cases: [string, number, number][] = [
        ['near', w.falloffStart / 2, 1],
        ['start', w.falloffStart, 1],
        ['mid', mid, (1 + w.falloffMin) / 2],
        ['end', w.falloffEnd, w.falloffMin],
        ['beyond', Math.min(w.range - 1, w.falloffEnd + 20), w.falloffMin],
      ];
      for (const [label, distance, scale] of cases) {
        // The body box's front face sits exactly `distance` down the ray.
        const target = combatant(
          makeDummy(
            `${id}-${label}`,
            { x: 0, y: 0, z: -(distance + METRICS.radius) },
            0,
          ),
        );
        combat.events = [];
        // Damage maths only: a fresh wall-clock fire budget per shot.
        combat.shotTokens.clear();
        combat.fire(
          shooter,
          [
            {
              weapon: slot,
              origin: { x: 0, y: 1, z: 0 },
              dirs: [{ x: 0, y: 0, z: -1 }],
              seq: 0,
            },
          ],
          undefined,
          1,
          [shooter, target],
        );
        expect(
          COMBAT.dummyHealth - target.entity.health,
          `${id} ${label}`,
        ).toBeCloseTo(w.damage * scale, 6);
        const hit = combat.events.find((e): e is HitEvent => e.t === 'hit')!;
        expect(hit).toMatchObject({
          zone: 'body',
          cause: slot,
          target: target.entity.id,
        });
      }
      // Out of range: the ray ends at `range` and nothing is hit.
      const far = combatant(
        makeDummy(`${id}-far`, { x: 0, y: 0, z: -(w.range + 5) }, 0),
      );
      combat.events = [];
      // Damage maths only: a fresh wall-clock fire budget per shot.
      combat.shotTokens.clear();
      combat.fire(
        shooter,
        [
          {
            weapon: slot,
            origin: { x: 0, y: 1, z: 0 },
            dirs: [{ x: 0, y: 0, z: -1 }],
            seq: 0,
          },
        ],
        undefined,
        1,
        [shooter, far],
      );
      expect(far.entity.health).toBe(COMBAT.dummyHealth);
      const shot = combat.events.find((e): e is ShotEvent => e.t === 'shot')!;
      expect(shot.flesh).toEqual([false]);
      expect(shot.ends[0]!.z).toBeCloseTo(-w.range, 6);
    }
  });
});

describe('hit zones', () => {
  const shapes = hitShapes({ x: 0, y: 0, z: 0 }, false);
  const forward = { x: 0, y: 0, z: -1 };
  it('applies the weapon headshot multiplier to the head box only', () => {
    const head = rayShapes(
      { x: 0, y: METRICS.eye, z: 10 },
      forward,
      shapes,
      100,
    )!;
    const body = rayShapes({ x: 0, y: 1, z: 10 }, forward, shapes, 100)!;
    expect(head.shape.zone).toBe('head');
    expect(body.shape.zone).toBe('body');
    expect(
      rayShapes(
        { x: 0, y: METRICS.height + 0.05, z: 10 },
        forward,
        shapes,
        100,
      ),
    ).toBeNull();
    for (const w of WEAPONS) {
      expect(zoneMultiplier(w, head.shape)).toBe(w.headshot);
      expect(zoneMultiplier(w, body.shape)).toBe(1);
    }
    // A crouched hull lowers the head: a standing-height ray passes over it.
    const crouched = hitShapes({ x: 0, y: 0, z: 0 }, true);
    expect(
      rayShapes({ x: 0, y: METRICS.eye, z: 10 }, forward, crouched, 100),
    ).toBeNull();
    expect(
      rayShapes({ x: 0, y: 0.85, z: 10 }, forward, crouched, 100)!.shape.zone,
    ).toBe('head');
  });
  it('lets a weak point carry its own multiplier regardless of weapon', () => {
    const weak: HitShape = {
      zone: 'weak',
      min: { x: -0.15, y: 0.9, z: METRICS.radius },
      max: { x: 0.15, y: 1.2, z: METRICS.radius + 0.1 },
      multiplier: 3,
    };
    const hit = rayShapes(
      { x: 0, y: 1, z: 10 },
      forward,
      [...shapes, weak],
      100,
    )!;
    expect(hit.shape).toBe(weak);
    for (const w of WEAPONS) expect(zoneMultiplier(w, weak)).toBe(3);
    // Without its own multiplier a weak shape is plain damage, not a headshot.
    expect(
      zoneMultiplier(weapon('rivet'), { ...weak, multiplier: undefined }),
    ).toBe(1);
  });
  it('deals headshot damage on the server and reports the zone', () => {
    const combat = new CombatWorld(
      flatLevel('combat-zones'),
      DT,
      () => undefined,
    );
    const shooter = combatant(makeEntity('shooter'), true);
    for (const [slot, w] of WEAPONS.entries()) {
      if (w.delivery !== 'hitscan') continue;
      const target = combatant(
        makeDummy(`head-${w.id}`, { x: 0, y: 0, z: -3 }, 0),
      );
      combat.events = [];
      // Damage maths only: a fresh wall-clock fire budget per shot.
      combat.shotTokens.clear();
      combat.fire(
        shooter,
        [
          {
            weapon: slot,
            origin: { x: 0, y: METRICS.eye, z: 0 },
            dirs: [forward],
            seq: 0,
          },
        ],
        undefined,
        1,
        [shooter, target],
      );
      expect(COMBAT.dummyHealth - target.entity.health).toBeCloseTo(
        w.damage * falloff(w, 3 - 0.22) * w.headshot,
        6,
      );
      expect(
        combat.events.find((e): e is HitEvent => e.t === 'hit')!.zone,
      ).toBe('head');
    }
  });
});

describe('ammo and reload', () => {
  it('decrements the magazine and refills from reserve after exactly the reload time', () => {
    const r = new Rig(combatRules(), slotOf('rivet')),
      w = r.w;
    for (let i = 0; i < 5; i++) expect(r.pull()).toBe(1);
    expect(r.ammo).toEqual({ mag: w.magazine - 5, reserve: w.reserveStart });
    r.cues = [];
    const total = reloadTicks(w.reloadTime);
    r.step(RELOAD); // reload tick 1
    expect(r.cues).toEqual(['reload']);
    r.run(total - 2);
    expect(r.ammo.mag).toBe(w.magazine - 5);
    expect(r.c.reload).toBe(1);
    r.step(); // reload tick `total`
    expect(r.ammo).toEqual({ mag: w.magazine, reserve: w.reserveStart - 5 });
    expect(r.cues).toEqual(['reload', 'reload-done']);
    // A full magazine does not reload again.
    r.cues = [];
    r.step(RELOAD);
    expect(r.cues).toEqual([]);
  });
  it('auto-reloads when the magazine runs dry and cues a dry trigger pull', () => {
    const r = new Rig(combatRules(), slotOf('rivet')),
      w = r.w;
    for (let i = 0; i < w.magazine - 1; i++) expect(r.pull()).toBe(1);
    r.cues = [];
    expect(r.pull()).toBe(1);
    expect(r.ammo.mag).toBe(0);
    expect(r.cues).toEqual(['reload']); // started by the last round itself
    expect(r.c.reload).toBeGreaterThan(0);
    // Pulling during the reload neither fires nor cues 'empty'.
    r.cues = [];
    expect(r.step(FIRE)).toBe(0);
    expect(r.cues).toEqual([]);
    r.run(r.c.reload);
    expect(r.ammo).toEqual({
      mag: w.magazine,
      reserve: w.reserveStart - w.magazine,
    });
    // Empty it again, cancel the auto reload by switching away and back, then pull.
    for (let i = 0; i < w.magazine; i++) r.pull();
    r.step(0, slotOf('spool'));
    r.step(0, slotOf('rivet'));
    r.run(ticksOf(w.drawTime));
    expect(r.ammo.mag).toBe(0);
    r.cues = [];
    expect(r.step(FIRE)).toBe(0);
    expect(r.cues).toEqual(['empty', 'reload']);
  });
  it('cancels a reload on weapon switch without transferring ammo', () => {
    const r = new Rig(combatRules(), slotOf('rivet')),
      w = r.w;
    for (let i = 0; i < 3; i++) r.pull();
    const before = { ...r.ammo };
    r.step(RELOAD);
    r.run(reloadTicks(w.reloadTime) - 5);
    expect(r.c.reload).toBeGreaterThan(0);
    r.cues = [];
    r.step(0, slotOf('spool'));
    expect(r.cues).toContain('switch');
    expect(r.c.reload).toBe(0);
    expect(r.c.ammo[slotOf('rivet')]).toEqual(before);
    r.run(reloadTicks(w.reloadTime) * 2);
    r.step(0, slotOf('rivet'));
    r.run(ticksOf(w.drawTime) + reloadTicks(w.reloadTime) * 2);
    expect(r.c.ammo[slotOf('rivet')]).toEqual(before);
    expect(r.cues).not.toContain('reload-done');
  });
  it('loads shotgun shells one at a time and firing interrupts the reload', () => {
    const r = new Rig(combatRules(), slotOf('breaker')),
      w = r.w;
    expect(w.reloadPerRound).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect(r.pull()).toBe(1);
    expect(r.ammo).toEqual({ mag: w.magazine - 3, reserve: w.reserveStart });
    r.cues = [];
    r.step(RELOAD);
    let elapsed = 1;
    while (!r.cues.includes('reload-round')) {
      r.step();
      elapsed++;
    }
    // The first shell includes the reload start-up; later shells take one round each.
    expect(elapsed).toBe(reloadTicks(w.reloadTime + w.reloadPerRound));
    expect(r.ammo).toEqual({
      mag: w.magazine - 2,
      reserve: w.reserveStart - 1,
    });
    expect(r.c.reload).toBe(reloadTicks(w.reloadPerRound));
    r.run(10);
    // Firing mid-shell cancels it: the shell in progress is not loaded.
    expect(r.step(FIRE)).toBe(1);
    expect(r.c.reload).toBe(0);
    expect(r.ammo).toEqual({
      mag: w.magazine - 3,
      reserve: w.reserveStart - 1,
    });
    r.run(reloadTicks(w.reloadPerRound) * 3);
    expect(r.ammo).toEqual({
      mag: w.magazine - 3,
      reserve: w.reserveStart - 1,
    });
    // An uninterrupted reload tops the tube up shell by shell and finishes.
    r.cues = [];
    r.step(RELOAD);
    r.run(
      reloadTicks(w.reloadTime + w.reloadPerRound) +
        reloadTicks(w.reloadPerRound) * 2,
    );
    expect(r.ammo).toEqual({ mag: w.magazine, reserve: w.reserveStart - 4 });
    expect(r.cues.filter((c) => c === 'reload-round')).toHaveLength(3);
    expect(r.cues.at(-1)).toBe('reload-done');
  });
  it('cannot reload with an empty reserve; a dry pull only cues empty', () => {
    const r = new Rig(combatRules(), slotOf('rivet'));
    r.c.ammo[r.c.slot] = { mag: 5, reserve: 0 };
    r.step(RELOAD);
    expect(r.c.reload).toBe(0);
    r.c.ammo[r.c.slot] = { mag: 0, reserve: 0 };
    r.cues = [];
    r.step();
    r.step(RELOAD);
    expect(r.step(FIRE)).toBe(0);
    expect(r.cues).toEqual(['empty']);
    expect(r.c.reload).toBe(0);
    expect(r.ammo).toEqual({ mag: 0, reserve: 0 });
  });
  it('infinite ammo never spends rounds and reloads without reserve', () => {
    const rules = combatRules(undefined, true);
    const smg = new Rig(rules, slotOf('spool'));
    const held = 300;
    expect(smg.run(held, FIRE)).toBe(Math.ceil(held / fireInterval(smg.w, DT)));
    expect(smg.ammo).toEqual({
      mag: smg.w.magazine,
      reserve: smg.w.reserveStart,
    });
    const pistol = new Rig(rules, slotOf('rivet'));
    pistol.c.ammo[pistol.c.slot] = { mag: 2, reserve: 0 };
    pistol.step(RELOAD);
    pistol.run(reloadTicks(pistol.w.reloadTime));
    expect(pistol.ammo).toEqual({ mag: pistol.w.magazine, reserve: 0 });
  });
});

describe('fire rate', () => {
  const rules = combatRules(undefined, true); // ammo never limits the count here
  it('rounds every RPM to whole ticks within half a tick', () => {
    for (const w of WEAPONS)
      expect(
        Math.abs(fireInterval(w, DT) - 60 / w.rpm / DT),
      ).toBeLessThanOrEqual(0.5);
  });
  for (const [slot, w] of WEAPONS.entries())
    it(`${w.id} (${w.mode}): holding and spamming the trigger never beats ${w.rpm} RPM`, () => {
      const interval = fireInterval(w, DT),
        n = 360;
      const hold = new Rig(rules, slot);
      const held = hold.run(n, FIRE);
      expect(held).toBe(w.mode === 'auto' ? Math.ceil(n / interval) : 1);
      // Semi/pump: a re-press after the interval fires again.
      if (w.mode !== 'auto') {
        hold.step();
        expect(hold.step(FIRE)).toBe(1);
      }
      // Pressing on every other tick buffers the trigger: exactly one shot per interval.
      const spam = new Rig(rules, slot);
      let shots = 0;
      const at: number[] = [];
      for (let t = 0; t < n; t++)
        if (spam.step(t % 2 === 0 ? FIRE : 0)) {
          shots++;
          at.push(t);
        }
      expect(shots).toBe(Math.ceil(n / interval));
      for (let i = 1; i < at.length; i++)
        expect(at[i]! - at[i - 1]!).toBe(interval);
    });
});

describe('server-side validation', () => {
  /** 600 inputs (ten seconds of trigger time) in max-size batches, one batch per
   * server tick, optionally after a silent spell that banks catch-up credit. */
  const flood = (id: string, silentTicks: number) => {
    const r = devRoom(),
      slot = slotOf(id),
      w = WEAPONS[slot]!;
    r.dev({ action: 'infinite-ammo', enabled: true }); // only the RPM limits shots
    r.play(ticksOf(w.drawTime) + 2, { weapon: slot });
    r.combat().events = [];
    const start = r.game.tick,
      before = r.combat().stats.shots,
      rejectedBefore = r.combat().stats.rejected,
      shotTicks: number[] = [];
    const tick = () => {
      r.step();
      shotTicks.push(...r.shots().map(() => r.game.tick));
      r.combat().events = [];
      expect(r.me.queue.length).toBeLessThanOrEqual(CONFIG.maxQueue);
    };
    for (let i = 0; i < silentTicks; i++) tick();
    let sent = 0;
    while (sent < 600) {
      const batch: Input[] = [];
      for (let k = 0; k < CONFIG.maxBatch && sent < 600; k++, sent++)
        batch.push(
          r.input({
            weapon: slot,
            buttons: w.mode === 'auto' || sent % 2 === 0 ? FIRE : 0,
          }),
        );
      r.deliver(batch);
      tick();
    }
    for (let i = 0; i < 60; i++) tick();
    // Every simulated shot is either accepted (a shot event) or rejected by the
    // wall-clock fire-rate guard.
    const rejected = r.combat().stats.rejected - rejectedBefore;
    expect(r.combat().stats.shots - before).toBe(shotTicks.length + rejected);
    const gaps = shotTicks.slice(1).map((t, i) => t - shotTicks[i]!);
    return {
      rejected,
      interval: fireInterval(w, DT),
      start,
      end: r.game.tick,
      shotTicks,
      gaps,
    };
  };
  it('a flood of inputs cannot exceed the weapon RPM on the server', () => {
    for (const id of ['spool', 'rivet']) {
      const { interval, start, end, shotTicks, gaps } = flood(id, 0);
      expect(shotTicks.length).toBeGreaterThan(0);
      expect(shotTicks.length).toBeLessThanOrEqual(
        Math.ceil((end - start) / interval),
      );
      for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(interval);
      // Far fewer than the flood asked for: the server honours one input per tick.
      expect(shotTicks.length).toBeLessThan((600 / interval) * 0.5);
    }
  });
  it('banked catch-up credit never lets a flood beat the RPM over wall-clock ticks', () => {
    for (const id of ['spool', 'rivet']) {
      const { interval, start, shotTicks, gaps, rejected } = flood(
        id,
        CONFIG.maxQueue,
      );
      // Catch-up inputs fire faster than real time; the guard rejects the excess.
      expect(rejected, `${id} rejected`).toBeGreaterThan(0);
      // Input steps never exceed elapsed server ticks, so at every moment the shot
      // count stays within what the RPM allows since the link went quiet.
      shotTicks.forEach((t, i) =>
        expect(
          i + 1,
          `${id} shot ${i + 1} at +${t - start}`,
        ).toBeLessThanOrEqual(Math.ceil((t - start) / interval)),
      );
      // Catch-up runs at most three input steps per tick, which bounds any burst.
      for (const gap of gaps)
        expect(gap).toBeGreaterThanOrEqual(
          Math.max(1, Math.floor(interval / 3)),
        );
      // ...and the catch-up path really ran (the silent spell earned credit).
      expect(Math.min(...gaps)).toBeLessThan(interval);
    }
  });
  it('rejects ammo and slot claims at the codec and ignores forged fields', () => {
    const base = {
      seq: 1,
      tick: 1,
      x: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      buttons: FIRE,
    };
    const decode = (i: object) =>
      decodeClient(JSON.stringify({ type: 'inputs', inputs: [i] }));
    expect(decode(base)).not.toBeNull();
    expect(
      decode({ ...base, weapon: WEAPONS.length - 1, view: 12.5 }),
    ).not.toBeNull();
    for (const slot of [-1, WEAPONS.length, 15, 1.5])
      expect(decode({ ...base, weapon: slot }), `weapon ${slot}`).toBeNull();
    for (const extra of [
      { ammo: 99 },
      { mag: 99 },
      { reserve: 999 },
      { combat: { ammo: [{ mag: 99, reserve: 99 }] } },
      { origin: { x: 0, y: 0, z: 0 } },
      { damage: 1000 },
      { shots: 5 },
    ])
      expect(decode({ ...base, ...extra }), JSON.stringify(extra)).toBeNull();
    expect(decode({ ...base, buttons: 256 })).toBeNull();
    expect(decode({ ...base, view: 'now' })).toBeNull();
    // The receive path keeps only button bits, a clamped slot and a finite view.
    const clean = sanitizeCombatInput({
      ...base,
      buttons: 0x1ff,
      weapon: 99,
      view: Infinity,
    });
    expect(clean.buttons).toBe(0xff);
    expect(clean.weapon).toBe(15);
    expect(clean.view).toBeUndefined();

    // Bypassing the codec entirely (an in-process hostile client) still changes nothing.
    const r = devRoom(),
      w = weapon('rivet');
    r.play(1, { buttons: FIRE });
    r.play(fireInterval(w, DT));
    const ammo = structuredClone(r.me.entity.combat!.ammo);
    expect(ammo[0]).toEqual({ mag: w.magazine - 1, reserve: w.reserveStart });
    const forged = {
      ...r.input(),
      ammo: 999,
      combat: {
        ...initialCombat(ALL_WEAPONS),
        ammo: WEAPONS.map(() => ({ mag: 999, reserve: 999 })),
      },
    } as Input;
    r.game.handle(r.peer, { type: 'inputs', inputs: [forged] });
    r.step();
    r.game.handle(r.peer, { type: 'inputs', inputs: [r.input({ weapon: 9 })] });
    r.step();
    r.game.handle(r.peer, {
      type: 'inputs',
      inputs: [r.input({ weapon: -4 })],
    });
    r.step();
    expect(r.me.entity.combat!.slot).toBe(0);
    expect(r.me.entity.combat!.ammo).toEqual(ammo);
  });
  it('spamming reload never creates ammo', () => {
    const r = devRoom(),
      w = weapon('rivet');
    const total = () =>
      r.me.entity.combat!.ammo.reduce((s, a) => s + a.mag + a.reserve, 0);
    for (let i = 0; i < 3; i++) {
      r.play(1, { buttons: FIRE });
      r.play(fireInterval(w, DT));
    }
    const before = total();
    r.play(600, (k) => ({ buttons: k % 2 ? 0 : RELOAD }));
    expect(total()).toBe(before);
    expect(r.me.entity.combat!.ammo[0]).toEqual({
      mag: w.magazine,
      reserve: w.reserveStart - 3,
    });
  });
  it('an empty magazine with no reserve produces no shot', () => {
    const r = devRoom(),
      w = weapon('rivet');
    const before = r.combat().stats.shots;
    // Pull every 12 ticks for long enough to spend every round, reloads included.
    const reloads = Math.ceil(w.reserveStart / w.magazine);
    const needed =
      (w.magazine + w.reserveStart) * 12 +
      reloads * (reloadTicks(w.reloadTime) + 12) +
      120;
    r.play(needed, (k) => ({ buttons: k % 12 === 0 ? FIRE : 0 }));
    expect(r.me.entity.combat!.ammo[0]).toEqual({ mag: 0, reserve: 0 });
    expect(r.combat().stats.shots - before).toBe(w.magazine + w.reserveStart);
    r.combat().events = [];
    r.play(240, (k) => ({ buttons: k % 12 === 0 ? FIRE : RELOAD }));
    expect(r.combat().stats.shots - before).toBe(w.magazine + w.reserveStart);
    expect(r.shots()).toHaveLength(0);
    expect(r.me.entity.combat!.reload).toBe(0);
  });
  it('does not hit a target behind a wall of the real level', () => {
    const r = devRoom();
    const level = r.game.level(r.room),
      world = levelWorld(level);
    // The brick side wall of the gate workshop: 0.6 m thick, 14.4 m tall, 26 m long.
    const wall = level.colliders.find((c) => c.id === 'gate-workshop/side-1')!;
    expect(wall.max.y - wall.min.y).toBeGreaterThan(10);
    const z = 47; // a clear lane on both sides of the wall
    r.me.entity = {
      ...r.me.entity,
      position: { x: wall.max.x + 6, y: 0, z },
      velocity: { x: 0, y: 0, z: 0 },
    };
    const behind = makeDummy(
      'behind-wall',
      { x: wall.min.x - 1.2, y: 0, z },
      0,
    );
    const front = makeDummy(
      'front-of-wall',
      { x: wall.max.x + 2, y: 0, z: z - 2 },
      0,
    );
    r.room.robots.push(behind, front);
    r.play(10);
    const eye = eyeOf(r.me.entity);
    expect(clearLine(world, eye, r.chest(behind))).toBe(false);
    expect(clearLine(world, eye, r.chest(front))).toBe(true);
    const health = (id: string) =>
      r.room.robots.find((e) => e.id === id)!.health;
    for (const [slot, w] of WEAPONS.entries()) {
      if (w.delivery !== 'hitscan') continue;
      r.play(ticksOf(w.drawTime) + 2, {
        weapon: slot,
        ...r.aimAt(r.chest(behind)),
      });
      r.combat().events = [];
      r.play(1, { weapon: slot, buttons: FIRE, ...r.aimAt(r.chest(behind)) });
      const [shot] = r.shots();
      expect(shot, w.id).toBeDefined();
      expect(shot!.flesh.every((f) => !f)).toBe(true);
      // Every pellet stops at the wall's near face.
      for (const end of shot!.ends)
        expect(end.x).toBeGreaterThanOrEqual(wall.max.x - 1e-6);
      expect(health(behind.id)).toBe(COMBAT.dummyHealth);
      r.play(fireInterval(w, DT) + 2, { weapon: slot });
    }
    // Control: the same weapon hits a target on this side of the wall.
    r.play(ticksOf(weapon('longline').drawTime) + 2, {
      weapon: slotOf('longline'),
    });
    r.play(1, {
      weapon: slotOf('longline'),
      buttons: FIRE,
      ...r.aimAt(r.chest(front)),
    });
    expect(health(front.id)).toBeLessThan(COMBAT.dummyHealth);
    // The launcher's projectile stops at the wall. Its splash reaches the target on
    // this side; neither the splash nor its fire (ignition or a bare fire) reaches
    // the target on the far side. Any damage at all, fire included, fails here.
    const slag = slotOf('slag');
    r.play(ticksOf(WEAPONS[slag]!.drawTime) + 2, { weapon: slag });
    r.combat().events = [];
    r.play(1, { weapon: slag, buttons: FIRE, ...r.aimAt(r.chest(behind)) });
    r.play(60, { weapon: slag });
    expect(r.combat().events.some((e) => e.t === 'blast')).toBe(true);
    expect(r.hits(front.id).some((e) => e.cause === 'blast')).toBe(true);
    r.play(Math.round(8 / DT), { weapon: slag });
    expect(r.hits(behind.id)).toEqual([]);
    expect(health(behind.id)).toBe(COMBAT.dummyHealth);
    const state = r.room.robots.find((e) => e.id === behind.id)!;
    expect((state.status ?? 0) & STATUS.burning).toBe(0);
  });
  it('clamps the lag-compensation view: a 2 s old view cannot hit the target 2 s ago', () => {
    const r = devRoom(),
      w = weapon('rivet');
    r.dev({ action: 'spawn-range', count: 1 });
    r.dev({ action: 'moving-dummies', enabled: true });
    expect(r.room.robots).toHaveLength(1);
    const dummy = () => r.room.robots[0]!;
    const maxRewind = Math.round(COMBAT.maxRewindMs / 1000 / DT);
    const stale = Math.round(2 / DT);
    const positions = new Map<number, Vec3>();
    const idle = (n: number) => {
      for (let i = 0; i < n; i++) {
        r.play(1);
        positions.set(r.game.tick, { ...dummy().position });
      }
    };
    idle(stale + 10);
    /** Finds the next tick whose 2 s old position is far from everywhere the target
     * has been inside the rewind window (and from where it is about to be). */
    const fireTick = () => {
      for (let guard = 0; guard < 600; guard++) {
        const n = r.game.tick + 1,
          old = positions.get(n - stale)!;
        const recent = [...Array(maxRewind).keys()].map((k) =>
          positions.get(n - 1 - k)!,
        );
        const next = 2 * recent[0]!.x - recent[1]!.x;
        if (
          Math.min(
            ...recent.map((p) => Math.abs(p.x - old.x)),
            Math.abs(next - old.x),
          ) > 1.5
        )
          return n;
        idle(1);
      }
      throw new Error('no separated moment found');
    };
    const shoot = (view: number, at: Vec3) => {
      r.combat().events = [];
      const hp = dummy().health;
      r.play(1, { buttons: FIRE, view, ...r.aimAt({ ...at, y: at.y + 1 }) });
      positions.set(r.game.tick, { ...dummy().position });
      const [shot] = r.shots();
      expect(shot).toBeDefined();
      const hit = shot!.flesh[0]!;
      expect(hit).toBe(dummy().health < hp);
      idle(fireInterval(w, DT) + 5);
      return hit;
    };
    let n = fireTick();
    expect(r.combat().rewindTick(n - stale, n)).toBe(n - maxRewind);
    expect(shoot(n - stale, positions.get(n - stale)!)).toBe(false);
    // The same stale claim is resolved at the cap: aiming where the target was
    // 300 ms ago hits, which pins the clamp to exactly maxRewindMs.
    n = r.game.tick + 1;
    expect(shoot(n - stale, positions.get(n - maxRewind)!)).toBe(true);
    // A legitimate recent view lands.
    n = r.game.tick + 1;
    expect(shoot(n - 6, positions.get(n - 6)!)).toBe(true);
    // A view from the future is clamped to now.
    expect(r.combat().rewindTick(n + 50, n)).toBe(n);
    expect(r.combat().rewindTick(undefined, n)).toBe(n);
  });
});

describe('raycast helpers', () => {
  it('stops world rays on real colliders and the floor', () => {
    const world = levelWorld(getLevel());
    const wall = getLevel().colliders.find(
      (c) => c.id === 'gate-workshop/side-1',
    )!;
    const hit = raycastWorld(
      world,
      { x: wall.max.x + 5, y: 1.5, z: 47 },
      { x: -1, y: 0, z: 0 },
      50,
    )!;
    expect(hit.distance).toBeCloseTo(5, 9);
    expect(hit.normal).toEqual({ x: 1, y: 0, z: 0 });
    const floor = raycastWorld(
      world,
      { x: 0, y: 2, z: 40 },
      { x: 0, y: -1, z: 0 },
      50,
    )!;
    expect(floor.point.y).toBeCloseTo(0, 9);
  });
});
