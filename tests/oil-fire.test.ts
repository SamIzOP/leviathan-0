import { describe, it, expect } from 'vitest';
import {
  ALL_WEAPONS,
  CombatWorld,
  makeDummy,
  type Combatant,
  type Hazard,
} from '../packages/server/src/combat-server';
import {
  COMBAT,
  CONFIG,
  FINGERS,
  FIRE,
  FIRE_BUTTON,
  OIL,
  STATUS,
  WEAPONS,
  cloneCombat,
  combatRules,
  eyeOf,
  getLevel,
  initialCombat,
  makeEntity,
  randomSeed,
  stepWeapon,
  type CombatEvent,
  type DevCombat,
  type Entity,
  type Level,
  type Throw,
  type Vec3,
} from '@leviathan/shared';

const DT = 1 / CONFIG.tickRate;
/** CombatWorld's own whole-tick rounding (never below one tick). */
const ticksOf = (seconds: number) => Math.max(1, Math.round(seconds / DT));
const SLAG = WEAPONS.findIndex((w) => w.id === 'slag');
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
type HitEvent = Extract<CombatEvent, { t: 'hit' }>;

/** A flat, wall-less copy of the mission level (floor at y = 0, no spills or crates). */
function flatLevel(id: string, rain = 0): Level {
  const base = getLevel();
  return {
    ...base,
    id,
    colliders: [],
    markers: [],
    rooms: [],
    bounds: { min: { x: -300, y: 0, z: -300 }, max: { x: 300, y: 80, z: 300 } },
    weather: { ...base.weather, rain },
  };
}

/** A CombatWorld driven directly with hand-built combatants. */
class Scene {
  combat: CombatWorld;
  now = 0;
  all: Combatant[] = [];
  constructor(
    level: Level,
    public devCombat?: DevCombat,
  ) {
    this.combat = new CombatWorld(level, DT, () => this.devCombat);
  }
  add(entity: Entity, player: boolean) {
    const c: Combatant = {
      entity,
      player,
      set: (e) => {
        c.entity = e;
      },
    };
    this.all.push(c);
    return c;
  }
  dummy(id: string, at: Vec3) {
    return this.add(makeDummy(id, at, 0), false);
  }
  player(id: string, at: Vec3) {
    return this.add(
      {
        ...makeEntity(id),
        position: { ...at },
        combat: initialCombat(ALL_WEAPONS),
      },
      true,
    );
  }
  tick(n = 1, each?: (now: number) => void) {
    for (let i = 0; i < n; i++) {
      this.combat.tick(
        ++this.now,
        this.all,
        this.all.filter((c) => c.player),
      );
      each?.(this.now);
    }
  }
  oil() {
    return this.combat.hazards.filter((h) => h.kind === 'oil');
  }
  fires() {
    return this.combat.hazards.filter((h) => h.kind === 'fire');
  }
  state(h: Hazard) {
    return this.combat.hazards.includes(h) ? h.kind : 'gone';
  }
  hits(target: Combatant) {
    return this.combat.events.filter(
      (e): e is HitEvent => e.t === 'hit' && e.target === target.entity.id,
    );
  }
  /** A Slag Launcher round from the shooter's eye at a point, ticked until it bursts. */
  launch(shooter: Combatant, at: Vec3) {
    const origin = eyeOf(shooter.entity),
      d = v(at.x - origin.x, at.y - origin.y, at.z - origin.z),
      l = Math.hypot(d.x, d.y, d.z);
    this.combat.fire(
      shooter,
      [{ weapon: SLAG, origin, dirs: [v(d.x / l, d.y / l, d.z / l)], seq: 0 }],
      undefined,
      this.now,
      this.all,
    );
    expect(this.combat.projectiles).toHaveLength(1);
    for (let i = 0; i < 300 && this.combat.projectiles.length; i++) this.tick();
    expect(this.combat.projectiles).toHaveLength(0);
  }
  /** Throws flasks and ticks until every one has burst. */
  throw(thrower: Combatant, throws: Throw[]) {
    this.combat.throwFlasks(thrower, throws);
    for (let i = 0; i < 300 && this.combat.projectiles.length; i++) this.tick();
    expect(this.combat.projectiles).toHaveLength(0);
  }
}
const burning = (c: Combatant) => !!((c.entity.status ?? 0) & STATUS.burning);
const health = (c: Combatant) => c.entity.health;

describe('ignition', () => {
  it('a thrown flask leaves a slick and coats nearby targets; a slag round ignites it', () => {
    // The throw itself comes from the shared weapon step (the oil button).
    const thrower0 = makeEntity('thrower');
    const step = stepWeapon(
      cloneCombat(initialCombat(ALL_WEAPONS)),
      thrower0,
      {
        seq: 1,
        tick: 1,
        x: 0,
        z: 0,
        yaw: 0,
        pitch: -0.25,
        buttons: FIRE_BUTTON.oil,
      },
      DT,
      combatRules(),
    );
    expect(step.throws).toHaveLength(1);
    expect(step.entity.combat!.oil).toBe(OIL.flaskStart - 1);
    // Where does it land? (A dry run on its own; the simulation is deterministic.)
    const dry = new Scene(flatLevel('oil-flask'));
    dry.throw(dry.player('thrower', thrower0.position), step.throws);
    const landing = dry.oil()[0]!.position;
    expect(landing.y).toBe(0);
    expect(landing.z).toBeLessThan(-3); // thrown forward (-z)

    const s = new Scene(flatLevel('oil-flask'));
    const thrower = s.player('thrower', thrower0.position);
    const near = s.dummy('near', v(landing.x + 1, 0, landing.z));
    const far = s.dummy('far', v(landing.x + OIL.coatRadius + 3, 0, landing.z));
    s.throw(thrower, step.throws);
    const [slick] = s.oil();
    expect(s.oil()).toHaveLength(1);
    expect(slick!.position).toEqual(landing);
    expect(slick!.radius).toBe(OIL.puddleRadius);
    expect(slick!.ttl).toBeGreaterThan(ticksOf(OIL.puddleSeconds) - 5);
    expect(s.combat.events).toContainEqual(
      expect.objectContaining({ t: 'blast', kind: 'flask' }),
    );
    expect((near.entity.status ?? 0) & STATUS.oiled).toBe(STATUS.oiled);
    expect((far.entity.status ?? 0) & STATUS.oiled).toBe(0);
    // An incendiary hit on the slick sets it alight.
    s.combat.events = [];
    s.launch(thrower, slick!.position);
    expect(slick!.kind).toBe('fire');
    expect(slick!.fuel).toBe(true);
    expect(slick!.ttl).toBeGreaterThan(ticksOf(FIRE.burnSeconds) - 3);
    expect(s.combat.events).toContainEqual({
      t: 'ignite',
      at: slick!.position,
    });
    s.tick();
    expect(burning(near)).toBe(true);
  });
  it('a slag round on bare ground leaves a short bare fire that cannot spread', () => {
    const s = new Scene(flatLevel('oil-bare'));
    const shooter = s.player('shooter', v(0, 0, 0));
    s.launch(shooter, v(0, 0, -12));
    expect(s.fires()).toHaveLength(1);
    const [fire] = s.fires();
    expect(fire!.fuel).toBe(false);
    expect(fire!.radius).toBe(FIRE.bareRadius);
    expect(fire!.ttl).toBeLessThanOrEqual(ticksOf(FIRE.bareSeconds));
    expect(fire!.ttl).toBeGreaterThan(ticksOf(FIRE.bareSeconds) - 3);
    // A slick whose edge is within the spread gap is not reached by a bare fire.
    const gap = FIRE.bareRadius + OIL.puddleRadius + FIRE.spreadGap / 2;
    const slick = s.combat.addOil(
      v(fire!.position.x + gap, 0, fire!.position.z),
      '',
      s.now,
    );
    s.tick(fire!.ttl + 5);
    expect(s.state(fire!)).toBe('gone');
    expect(slick.kind).toBe('oil');
    expect(slick.igniteAt).toBe(0);
  });
  it('Fingers of God strikes ignite oil when the first beam lands', () => {
    const s = new Scene(flatLevel('oil-fingers'));
    const caller = s.player('caller', v(0, 0, 0));
    const slick = s.combat.addOil(v(0, 0, -12), '', 0);
    const eye = eyeOf(caller.entity),
      d = v(0 - eye.x, 0 - eye.y, -12 - eye.z),
      l = Math.hypot(d.x, d.y, d.z);
    s.combat.callFingers(caller, eye, v(d.x / l, d.y / l, d.z / l), s.now);
    expect(s.combat.strikes).toHaveLength(FINGERS.count);
    const first = ticksOf(FINGERS.telegraph);
    s.tick(first - 1);
    expect(slick.kind).toBe('oil');
    s.tick();
    expect(slick.kind).toBe('fire');
    s.tick(ticksOf(FINGERS.telegraph + FINGERS.count * FINGERS.stagger));
    expect(s.combat.strikes).toHaveLength(0);
    expect(
      s.combat.events.filter((e) => e.t === 'blast' && e.kind === 'fingers'),
    ).toHaveLength(FINGERS.count);
  });
  it('a burning target ignites the oil it walks into', () => {
    const s = new Scene(flatLevel('oil-carry'));
    const owner = s.player('owner', v(-40, 0, 0));
    const fire = s.combat.addOil(v(0, 0, 0), owner.entity.id, 0);
    s.combat.ignite(fire, owner.entity.id);
    const slick = s.combat.addOil(v(30, 0, 0), '', 0);
    const runner = s.dummy('runner', v(0, 0, 0));
    s.tick(10);
    expect(burning(runner)).toBe(true);
    runner.entity = { ...runner.entity, position: v(30, 0, 0) };
    s.tick();
    expect(slick.kind).toBe('fire');
  });
});

describe('fire damage', () => {
  it('burns a target standing in fire at FIRE.dps, then afterburns once it leaves', () => {
    const s = new Scene(flatLevel('fire-dot'));
    const owner = s.player('owner', v(40, 0, 40));
    const fire = s.combat.addOil(v(0, 0, 0), owner.entity.id, 0);
    expect(s.combat.ignite(fire, owner.entity.id)).toBe(true);
    const target = s.dummy('target', v(1, 0, 0));
    const perInterval = FIRE.dps * FIRE.damageInterval;
    const standing = 120;
    s.tick(standing);
    const inFire = COMBAT.dummyHealth - health(target);
    expect(Math.abs(inFire - FIRE.dps * standing * DT)).toBeLessThanOrEqual(
      perInterval + 1e-9,
    );
    const ticksHits = s.hits(target);
    expect(ticksHits.length).toBeGreaterThan(0);
    for (const hit of ticksHits)
      expect(hit).toMatchObject({
        cause: 'fire',
        source: owner.entity.id,
        amount: perInterval,
      });
    expect(burning(target)).toBe(true);
    // Step out: the afterburn keeps going at the lower rate for afterburnSeconds.
    target.entity = { ...target.entity, position: v(20, 0, 0) };
    const before = health(target);
    let burnTicks = 0;
    s.tick(ticksOf(FIRE.afterburnSeconds) + 60, () => {
      if (burning(target)) burnTicks++;
    });
    const after = before - health(target);
    expect(
      Math.abs(after - FIRE.afterburnDps * FIRE.afterburnSeconds),
    ).toBeLessThanOrEqual(FIRE.afterburnDps * FIRE.damageInterval + 1e-9);
    expect(burnTicks).toBeLessThanOrEqual(ticksOf(FIRE.afterburnSeconds));
    expect(burnTicks).toBeGreaterThanOrEqual(
      ticksOf(FIRE.afterburnSeconds) - 2,
    );
    expect(burning(target)).toBe(false);
    const settled = health(target);
    s.tick(120);
    expect(health(target)).toBe(settled);
  });
  it('oiled targets burn hotter and longer', () => {
    const run = (oiled: boolean) => {
      const s = new Scene(flatLevel('fire-oiled'));
      const owner = s.player('owner', v(-40, 0, 0));
      const target = s.dummy('target', v(30, 0, 0));
      // A flask bursting at the target's feet coats it (its slick stays out there).
      if (oiled)
        s.throw(owner, [{ origin: v(30, 1, 0), velocity: v(0, -2, 0) }]);
      else s.tick(20);
      expect(!!((target.entity.status ?? 0) & STATUS.oiled)).toBe(oiled);
      const fire = s.combat.addOil(v(0, 0, 0), owner.entity.id, s.now);
      s.combat.ignite(fire, owner.entity.id);
      target.entity = { ...target.entity, position: v(0.5, 0, 0) };
      const start = health(target);
      s.tick(60);
      const inFire = start - health(target);
      target.entity = { ...target.entity, position: v(-20, 0, 0) };
      const out = health(target);
      let burnTicks = 0;
      s.tick(ticksOf(FIRE.oiledAfterburnSeconds) + 60, () => {
        if (burning(target)) burnTicks++;
      });
      return { inFire, after: out - health(target), burnTicks };
    };
    const plain = run(false),
      oiled = run(true);
    expect(oiled.inFire).toBeCloseTo(plain.inFire * FIRE.oiledDamageScale, 9);
    for (const [r, seconds] of [
      [plain, FIRE.afterburnSeconds],
      [oiled, FIRE.oiledAfterburnSeconds],
    ] as const) {
      expect(r.burnTicks).toBeLessThanOrEqual(ticksOf(seconds));
      expect(r.burnTicks).toBeGreaterThanOrEqual(ticksOf(seconds) - 2);
    }
    expect(oiled.burnTicks).toBeGreaterThan(plain.burnTicks);
    const oiledRate = FIRE.afterburnDps * FIRE.oiledDamageScale;
    expect(
      Math.abs(oiled.after - oiledRate * FIRE.oiledAfterburnSeconds),
    ).toBeLessThanOrEqual(oiledRate * FIRE.damageInterval + 1e-9);
    expect(oiled.after).toBeGreaterThan(plain.after);
  });
  it('ownerless fires burn robots but not operators', () => {
    const s = new Scene(flatLevel('fire-friendly'));
    const fire = s.combat.addOil(v(0, 0, 0), '', 0);
    s.combat.ignite(fire, '');
    const operator = s.player('operator', v(0.5, 0, 0));
    const robot = s.dummy('robot', v(-0.5, 0, 0));
    s.tick(60);
    expect(health(operator)).toBe(COMBAT.maxHealth);
    expect(health(robot)).toBeLessThan(COMBAT.dummyHealth);
    // Friendly fire makes the flames hurt everyone.
    s.devCombat = {
      infiniteAmmo: false,
      damageScale: 1,
      friendlyFire: true,
      hitDebug: false,
      botsFire: false,
      lagCompensation: true,
      movingDummies: false,
      weapons: {},
    };
    s.tick(60);
    expect(health(operator)).toBeLessThan(COMBAT.maxHealth);
  });
});

describe('expiry and weather', () => {
  it('fires burn out after their burn time and slicks dry after puddleSeconds', () => {
    const s = new Scene(flatLevel('fire-expiry'));
    const fire = s.combat.addOil(v(0, 0, 0), '', 0);
    const slick = s.combat.addOil(v(40, 0, 0), '', 0);
    s.combat.ignite(fire, '');
    const burn = ticksOf(FIRE.burnSeconds); // dry level: unscaled
    expect(fire.ttl).toBe(burn);
    s.tick(burn - 1);
    expect(s.state(fire)).toBe('fire');
    expect(s.combat.entities(s.now).some((e) => e.id === fire.id)).toBe(true);
    s.tick();
    expect(s.state(fire)).toBe('gone');
    expect(s.combat.entities(s.now).some((e) => e.id === fire.id)).toBe(false);
    s.tick(ticksOf(OIL.puddleSeconds) - burn - 1);
    expect(s.state(slick)).toBe('oil');
    s.tick();
    expect(s.state(slick)).toBe('gone');
  });
  it('rain shortens outdoor burns; a roofed room of the real level shelters them', () => {
    const level = getLevel(),
      rain = level.weather.rain;
    expect(rain).toBeGreaterThan(0);
    const combat = new CombatWorld(level, DT, () => undefined);
    const room = level.rooms![0]!.bounds;
    const indoors = combat.ground(
      v((room.min.x + room.max.x) / 2, 0, (room.min.z + room.max.z) / 2),
    );
    const outdoors = combat.ground(v(0, 0, 40));
    expect(combat.sheltered(indoors)).toBe(true);
    expect(combat.sheltered(outdoors)).toBe(false);
    const inside = combat.addOil(indoors, '', 0),
      outside = combat.addOil(outdoors, '', 0);
    combat.ignite(inside, '');
    combat.ignite(outside, '');
    expect(inside.ttl).toBe(ticksOf(FIRE.burnSeconds));
    expect(outside.ttl).toBe(
      ticksOf(FIRE.burnSeconds * (1 - rain * FIRE.rainFactor)),
    );
    expect(outside.ttl).toBeLessThan(inside.ttl);
    const outdoorTicks = outside.ttl,
      indoorTicks = inside.ttl;
    let now = 0;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) combat.tick(++now, [], []);
    };
    tick(outdoorTicks);
    expect(combat.hazards).not.toContain(outside);
    expect(inside.kind).toBe('fire');
    tick(indoorTicks - outdoorTicks);
    expect(combat.hazards).not.toContain(inside);
    // Heavier rain (the overcast mission) burns shorter still; no rain, no change.
    const storm = new CombatWorld(
      getLevel('foundry-row-overcast'),
      DT,
      () => undefined,
    );
    expect(storm.level.weather.rain).toBeGreaterThan(rain);
    expect(storm.burnTicks(outdoors, FIRE.burnSeconds)).toBeLessThan(
      outdoorTicks,
    );
    expect(storm.burnTicks(indoors, FIRE.burnSeconds)).toBe(indoorTicks);
    const dry = new CombatWorld(flatLevel('fire-dry'), DT, () => undefined);
    expect(dry.burnTicks(outdoors, FIRE.burnSeconds)).toBe(
      ticksOf(FIRE.burnSeconds),
    );
  });
});

describe('spread', () => {
  it('jumps to slicks within the spread gap after the spread delay, and no further', () => {
    const s = new Scene(flatLevel('fire-spread'));
    const R = OIL.puddleRadius,
      reach = 2 * R + FIRE.spreadGap; // centre distance at which edges are spreadGap apart
    const a = s.combat.addOil(v(0, 0, 0), '', 0);
    const b = s.combat.addOil(v(reach - 0.05, 0, 0), '', 0);
    const c = s.combat.addOil(v(2 * (reach - 0.05), 0, 0), '', 0);
    const beyond = s.combat.addOil(v(-(reach + 0.5), 0, 0), '', 0);
    const lit = new Map<Hazard, number>([[a, 0]]);
    s.combat.ignite(a, 'arsonist');
    s.tick(ticksOf(FIRE.burnSeconds) * 2, (now) => {
      for (const h of [b, c, beyond])
        if (!lit.has(h) && h.kind === 'fire') lit.set(h, now);
    });
    const delay = ticksOf(FIRE.spreadDelay);
    const ab = lit.get(b)! - lit.get(a)!,
      bc = lit.get(c)! - lit.get(b)!;
    for (const gap of [ab, bc]) {
      expect(gap).toBeGreaterThanOrEqual(delay);
      expect(gap).toBeLessThanOrEqual(delay + 1);
    }
    expect(b.owner).toBe('arsonist');
    // 0.5 m beyond the gap: never scheduled, still oil after everything burnt out.
    expect(lit.has(beyond)).toBe(false);
    expect(beyond.kind).toBe('oil');
    expect(beyond.igniteAt).toBe(0);
    expect(s.fires()).toHaveLength(0);
  });
});

describe('performance caps', () => {
  const grid = (i: number) => v((i % 8) * 12, 0, Math.floor(i / 8) * 12); // never touching
  it('evicts the oldest slick at maxPuddles and refuses fires past maxFires', () => {
    const s = new Scene(flatLevel('fire-caps'));
    const extra = 6;
    const slicks = Array.from({ length: FIRE.maxPuddles + extra }, (_, i) =>
      s.combat.addOil(grid(i), '', 0),
    );
    expect(s.oil()).toHaveLength(FIRE.maxPuddles);
    expect(s.combat.stats.puddlesEvicted).toBe(extra);
    for (const h of slicks.slice(0, extra))
      expect(s.combat.hazards).not.toContain(h);
    for (const h of slicks.slice(extra)) expect(s.combat.hazards).toContain(h);
    for (const h of s.oil()) s.combat.ignite(h, '');
    const lit = Math.min(FIRE.maxFires, FIRE.maxPuddles);
    expect(s.fires()).toHaveLength(lit);
    expect(s.combat.stats.firesCapped).toBe(FIRE.maxPuddles - lit);
    // Fires do not count as slicks, so oil can still be poured; it cannot catch.
    if (s.fires().length === FIRE.maxFires) {
      const capped = s.combat.stats.firesCapped;
      const more = Array.from({ length: extra }, (_, i) =>
        s.combat.addOil(grid(40 + i), '', 0),
      );
      for (const h of more) expect(s.combat.ignite(h, '')).toBe(false);
      s.combat.bareFire(v(-60, 0, -60), '', 0);
      expect(s.combat.stats.firesCapped).toBe(capped + extra + 1);
      expect(s.fires()).toHaveLength(FIRE.maxFires);
    }
  });
  it('never exceeds either cap under a sustained barrage', () => {
    const s = new Scene(flatLevel('fire-barrage'));
    const owner = s.player('owner', v(0, 0, 80));
    for (let i = 0; i < 6; i++) s.dummy(`robot-${i}`, v(i * 8 - 20, 0, 5));
    const rng = randomSeed(0xf12e);
    const at = () => v(rng() * 60 - 30, 0, rng() * 60 - 30);
    let fires = 0,
      slicks = 0;
    s.tick(900, (now) => {
      s.combat.addOil(at(), owner.entity.id, now);
      if (now % 3 === 0)
        s.combat.incendiary(at(), 4, owner.entity.id, now, s.all, true);
      expect(s.fires().length).toBeLessThanOrEqual(FIRE.maxFires);
      expect(s.oil().length).toBeLessThanOrEqual(FIRE.maxPuddles);
      expect(
        s.combat.entities(now).filter((e) => e.type === 'hazard').length,
      ).toBeLessThanOrEqual(FIRE.maxFires + FIRE.maxPuddles);
      fires = Math.max(fires, s.fires().length);
      slicks = Math.max(slicks, s.oil().length);
    });
    expect(fires).toBe(FIRE.maxFires);
    expect(slicks).toBe(FIRE.maxPuddles);
    expect(s.combat.stats.firesCapped).toBeGreaterThan(0);
    expect(s.combat.stats.puddlesEvicted).toBeGreaterThan(0);
  });
  it('keeps the real level spills when evicting, and refills a spill after it burns', () => {
    const level = getLevel();
    const spillCount = (level.markers ?? []).filter(
      (m) => m.kind === 'oil',
    ).length;
    expect(spillCount).toBeGreaterThan(0);
    const combat = new CombatWorld(level, DT, () => undefined);
    const spills = combat.hazards.filter((h) => h.spill);
    expect(spills).toHaveLength(spillCount);
    for (const h of spills) expect(h.ttl).toBe(Infinity);
    for (let i = 0; i < FIRE.maxPuddles + 10; i++)
      combat.addOil(v(i * 7 - 100, 0, 40), 'p', 0);
    expect(combat.hazards.filter((h) => h.kind === 'oil')).toHaveLength(
      FIRE.maxPuddles,
    );
    for (const h of spills) expect(combat.hazards).toContain(h);

    const fresh = new CombatWorld(level, DT, () => undefined);
    const spill = fresh.hazards.find((h) => h.spill)!;
    expect(fresh.ignite(spill, '')).toBe(true);
    const burn = spill.ttl;
    let now = 0;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) fresh.tick(++now, [], []);
    };
    tick(burn);
    expect(fresh.hazards).not.toContain(spill);
    expect(fresh.hazards.some((h) => h.spill === spill.spill)).toBe(false);
    tick(ticksOf(OIL.spillRespawn) - 1);
    expect(fresh.hazards.some((h) => h.spill === spill.spill)).toBe(false);
    tick(1);
    const refilled = fresh.hazards.find((h) => h.spill === spill.spill)!;
    expect(refilled).toMatchObject({
      kind: 'oil',
      position: spill.position,
      ttl: Infinity,
    });
  });
});
