import {
  COMBAT,
  FINGERS,
  FIRE,
  OIL,
  PICKUPS,
  STATUS,
  aimDirection,
  clearLine,
  cloneCombat,
  combatRules,
  eyeOf,
  falloff,
  fireInterval,
  hitShapes,
  inside,
  initialCombat,
  levelWorld,
  makeEntity,
  rayShapes,
  raycastWorld,
  zoneMultiplier,
  type CombatEvent,
  type CombatRules,
  type DevCombat,
  type Entity,
  type HitCause,
  type HitShape,
  type Level,
  type Shot,
  type Throw,
  type Vec3,
  type World,
  WEAPONS,
  MATCH_MODES,
  type MatchMode,
} from '@leviathan/shared';

export interface Projectile {
  id: string;
  kind: 'slag' | 'flask';
  owner: string;
  weapon: number;
  position: Vec3;
  velocity: Vec3;
  life: number;
}
export interface Hazard {
  id: string;
  kind: 'oil' | 'fire';
  position: Vec3;
  radius: number;
  /** Remaining ticks; Infinity for a level spill until it burns. */
  ttl: number;
  /** A fire with oil under it can spread; a bare fire cannot. */
  fuel: boolean;
  owner: string;
  igniteAt: number;
  spill?: string;
  created: number;
}
export interface Pickup {
  id: string;
  position: Vec3;
  available: boolean;
  respawnAt: number;
  expiresAt: number;
  drop: boolean;
}
export interface Strike {
  id: string;
  owner: string;
  position: Vec3;
  impactTick: number;
}
interface Status {
  burning: number;
  oiled: number;
  burnScale: number;
  attacker: string;
  nextTick: number;
  deadUntil: number;
}
interface Spill {
  id: string;
  position: Vec3;
  respawnAt: number;
}
/** Anything that can be shot: player entities and robots/dummies. */
export interface Combatant {
  entity: Entity;
  player: boolean;
  set: (e: Entity) => void;
}
export interface DummyAnchor {
  position: Vec3;
  right: Vec3;
  phase: number;
}
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Authoritative combat for one room: hits, projectiles, hazards, pickups, strikes. */
export class CombatWorld {
  world: World;
  events: CombatEvent[] = [];
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  pickups: Pickup[] = [];
  strikes: Strike[] = [];
  spills: Spill[] = [];
  anchors = new Map<string, DummyAnchor>();
  status = new Map<string, Status>();
  history: {
    tick: number;
    boxes: Map<string, { position: Vec3; crouched: boolean }>;
  }[] = [];
  /** Counters for tests and the dev panel. */
  stats = {
    shots: 0,
    hits: 0,
    rejected: 0,
    firesCapped: 0,
    puddlesEvicted: 0,
    rewinds: 0,
  };
  /** Wall-clock fire-rate guard per operator: tokens refill at the weapon's own
   * rate (capacity 2 absorbs jitter). Catch-up inputs can never fire faster. */
  shotTokens = new Map<string, { tokens: number; tick: number }>();
  private counter = 0;
  constructor(
    public level: Level,
    public dt: number,
    public dev: () => DevCombat | undefined,
    public mode: MatchMode = 'coop',
  ) {
    this.world = levelWorld(level);
    for (const m of level.markers ?? []) {
      if (m.kind === 'ammo')
        this.pickups.push({
          id: this.nextId('a'),
          position: this.ground({ ...m.position }),
          available: true,
          respawnAt: 0,
          expiresAt: Infinity,
          drop: false,
        });
      if (m.kind === 'oil') {
        const spill = {
          id: m.id,
          position: this.ground({ ...m.position }),
          respawnAt: 0,
        };
        this.spills.push(spill);
        this.addOil(spill.position, '', 0, spill.id);
      }
    }
  }
  nextId(prefix: string) {
    return `${prefix}${++this.counter}`;
  }
  ticks(seconds: number) {
    return Math.max(1, Math.round(seconds / this.dt));
  }
  rules(): CombatRules {
    const d = this.dev();
    return combatRules(d?.weapons, d?.infiniteAmmo ?? false);
  }
  /** Ground height under a point (first surface below, else the world floor). */
  ground(p: Vec3, lift = 1.5): Vec3 {
    const hit = raycastWorld(
      this.world,
      v(p.x, p.y + lift, p.z),
      v(0, -1, 0),
      60,
    );
    return v(p.x, hit ? hit.point.y : this.world.floor, p.z);
  }
  sheltered(p: Vec3) {
    return (this.level.rooms ?? []).some((r) =>
      inside(v(p.x, Math.min(p.y + 0.5, r.bounds.max.y - 0.01), p.z), r.bounds),
    );
  }
  /** Rain shortens outdoor fires; roofed rooms are sheltered. */
  burnTicks(p: Vec3, seconds: number) {
    const rain = this.level.weather?.rain ?? 0;
    const scale = this.sheltered(p) ? 1 : 1 - rain * FIRE.rainFactor;
    return this.ticks(seconds * scale);
  }
  /** Team damage: the match mode decides; a dev room's toggle overrides it. */
  friendlyFire() {
    return this.dev()?.friendlyFire ?? MATCH_MODES[this.mode].friendlyFire;
  }
  hostile(a: Combatant | undefined, b: Combatant) {
    if (!a) return !b.player || this.friendlyFire();
    if (a.entity.id === b.entity.id) return false;
    if (a.player && b.player) return this.friendlyFire();
    return a.player !== b.player;
  }
  alive(c: Combatant) {
    return !((c.entity.status ?? 0) & STATUS.dead);
  }
  // --- History / lag compensation ---------------------------------------------
  record(tick: number, all: Combatant[]) {
    const boxes = new Map<string, { position: Vec3; crouched: boolean }>();
    for (const c of all)
      if (this.alive(c))
        boxes.set(c.entity.id, {
          position: { ...c.entity.position },
          crouched:
            !!c.entity.move?.crouched || c.entity.move?.mode === 'SLIDE',
        });
    this.history.push({ tick, boxes });
    if (this.history.length > COMBAT.historyTicks) this.history.shift();
  }
  /** Target hit shapes as the shooter saw them: interpolated at `tick`. */
  shapesAt(c: Combatant, tick: number, now: number): HitShape[] {
    const current = () =>
      hitShapes(
        c.entity.position,
        !!c.entity.move?.crouched || c.entity.move?.mode === 'SLIDE',
      );
    if (tick >= now) return current();
    const lo = Math.floor(tick),
      hi = Math.ceil(tick),
      a = this.history.find((h) => h.tick === lo)?.boxes.get(c.entity.id),
      b = this.history.find((h) => h.tick === hi)?.boxes.get(c.entity.id);
    if (!a || !b) return current();
    const t = hi === lo ? 0 : tick - lo;
    return hitShapes(
      v(
        a.position.x + (b.position.x - a.position.x) * t,
        a.position.y + (b.position.y - a.position.y) * t,
        a.position.z + (b.position.z - a.position.z) * t,
      ),
      t < 0.5 ? a.crouched : b.crouched,
    );
  }
  rewindTick(view: number | undefined, now: number) {
    const max = Math.round(COMBAT.maxRewindMs / 1000 / this.dt);
    if (this.dev()?.lagCompensation === false || view === undefined) return now;
    return Math.max(now - max, Math.min(now, view));
  }
  // --- Weapons -----------------------------------------------------------------
  fire(
    shooter: Combatant,
    shots: Shot[],
    view: number | undefined,
    now: number,
    all: Combatant[],
  ) {
    const rules = this.rules(),
      dev = this.dev();
    for (const shot of shots) {
      this.stats.shots++;
      const w = rules.table[shot.weapon]!;
      const interval = fireInterval(w, this.dt),
        bucket = this.shotTokens.get(shooter.entity.id) ?? {
          tokens: 2,
          tick: now,
        };
      bucket.tokens = Math.min(
        2,
        bucket.tokens + (now - bucket.tick) / interval,
      );
      bucket.tick = now;
      this.shotTokens.set(shooter.entity.id, bucket);
      if (bucket.tokens < 1 - 1e-9) {
        // Faster than the weapon allows in real time: ammo is spent (as the
        // client predicted) but the shot is rejected.
        this.stats.rejected++;
        continue;
      }
      bucket.tokens -= 1;
      if (w.delivery === 'projectile') {
        const d = shot.dirs[0]!;
        this.projectiles.push({
          id: this.nextId('p'),
          kind: 'slag',
          owner: shooter.entity.id,
          weapon: shot.weapon,
          position: { ...shot.origin },
          velocity: v(
            d.x * w.projectileSpeed,
            d.y * w.projectileSpeed,
            d.z * w.projectileSpeed,
          ),
          life: this.ticks(w.projectileLife),
        });
        this.events.push({
          t: 'shot',
          shooter: shooter.entity.id,
          weapon: shot.weapon,
          origin: shot.origin,
          ends: [],
          flesh: [],
          normals: [],
        });
        continue;
      }
      const rewind = this.rewindTick(view, now);
      if (rewind < now) this.stats.rewinds++;
      const targets = all.filter(
        (t) => this.alive(t) && this.hostile(shooter, t),
      );
      const shapes = targets.map((t) => this.shapesAt(t, rewind, now));
      const ends: Vec3[] = [],
        flesh: boolean[] = [],
        normals: (Vec3 | null)[] = [];
      const damage = new Map<
        number,
        { amount: number; head: boolean; at: Vec3; weak: boolean }
      >();
      for (const d of shot.dirs) {
        const wall = raycastWorld(this.world, shot.origin, d, w.range);
        let reach = wall ? wall.distance : w.range,
          hit = -1,
          zone: HitShape | undefined;
        targets.forEach((_, i) => {
          const r = rayShapes(shot.origin, d, shapes[i]!, reach);
          if (r) {
            reach = r.distance;
            hit = i;
            zone = r.shape;
          }
        });
        const end = v(
          shot.origin.x + d.x * reach,
          shot.origin.y + d.y * reach,
          shot.origin.z + d.z * reach,
        );
        ends.push(end);
        flesh.push(hit >= 0);
        normals.push(
          hit < 0 && wall && reach === wall.distance ? wall.normal : null,
        );
        if (hit >= 0 && zone) {
          const amount =
            w.damage *
            falloff(w, reach) *
            zoneMultiplier(w, zone) *
            (dev?.damageScale ?? 1);
          const prior = damage.get(hit);
          damage.set(hit, {
            amount: (prior?.amount ?? 0) + amount,
            head: !!prior?.head || zone.zone === 'head',
            weak: !!prior?.weak || zone.zone === 'weak',
            at: prior?.at ?? end,
          });
        }
      }
      this.events.push({
        t: 'shot',
        shooter: shooter.entity.id,
        weapon: shot.weapon,
        origin: shot.origin,
        ends,
        flesh,
        normals,
      });
      if (dev?.hitDebug)
        this.events.push({
          t: 'debug',
          shooter: shooter.entity.id,
          origin: shot.origin,
          ends,
          tick: now,
          rewindTick: rewind,
          view,
          boxes: targets.flatMap((t, i) =>
            dist2(t.entity.position, shot.origin) < 120
              ? shapes[i]!.map((s) => ({
                  id: t.entity.id,
                  min: s.min,
                  max: s.max,
                }))
              : [],
          ),
        });
      for (const [i, d] of damage) {
        this.stats.hits++;
        this.damage(
          shooter,
          targets[i]!,
          d.amount,
          d.head ? 'head' : d.weak ? 'weak' : 'body',
          d.at,
          shot.origin,
          shot.weapon,
          all,
        );
      }
    }
  }
  throwFlasks(shooter: Combatant, throws: Throw[]) {
    for (const t of throws)
      this.projectiles.push({
        id: this.nextId('p'),
        kind: 'flask',
        owner: shooter.entity.id,
        weapon: -1,
        position: { ...t.origin },
        velocity: { ...t.velocity },
        life: this.ticks(OIL.flaskLife),
      });
  }
  callFingers(shooter: Combatant, origin: Vec3, dir: Vec3, now: number) {
    const hit = raycastWorld(this.world, origin, dir, FINGERS.range);
    const aim = hit
      ? hit.point
      : this.ground(
          v(
            origin.x + dir.x * FINGERS.range,
            origin.y + dir.y * FINGERS.range,
            origin.z + dir.z * FINGERS.range,
          ),
          FINGERS.skyHeight,
        );
    const yaw = Math.atan2(-dir.x, -dir.z),
      fx = -Math.sin(yaw),
      fz = -Math.cos(yaw);
    for (let i = 0; i < FINGERS.count; i++) {
      // A spread hand: the palm point and fingers fanned in front of it.
      const angle = ((i - (FINGERS.count - 1) / 2) * 35 * Math.PI) / 180,
        reach = i === 0 ? FINGERS.spread * 0.6 : FINGERS.spread;
      const x =
          aim.x + (fx * Math.cos(angle) - fz * Math.sin(angle)) * reach * 0.6,
        z = aim.z + (fz * Math.cos(angle) + fx * Math.sin(angle)) * reach * 0.6;
      // The beam falls from the sky; a roof above the point stops it at the roof.
      const top = v(x, aim.y + FINGERS.skyHeight, z);
      const land = raycastWorld(
        this.world,
        top,
        v(0, -1, 0),
        FINGERS.skyHeight + 40,
      );
      this.strikes.push({
        id: this.nextId('s'),
        owner: shooter.entity.id,
        position: land ? land.point : v(x, this.world.floor, z),
        impactTick: now + this.ticks(FINGERS.telegraph + i * FINGERS.stagger),
      });
    }
  }
  // --- Damage, death, respawn ---------------------------------------------------
  damage(
    source: Combatant | undefined,
    target: Combatant,
    amount: number,
    zone: 'body' | 'head' | 'weak',
    at: Vec3,
    from: Vec3,
    cause: HitCause,
    all: Combatant[],
  ) {
    if (!this.alive(target) || amount <= 0) return;
    const e = {
      ...target.entity,
      health: Math.max(0, target.entity.health - amount),
    };
    const kill = e.health <= 0;
    if (kill) e.status = (e.status ?? 0) | STATUS.dead;
    target.set(e);
    target.entity = e;
    this.events.push({
      t: 'hit',
      source: source?.entity.id ?? '',
      target: e.id,
      amount: Math.round(amount * 10) / 10,
      zone,
      kill,
      at,
      from,
      cause,
    });
    // Fingers of God charges from damage dealt to hostiles.
    if (source?.player && !target.player && source.entity.combat) {
      const c = cloneCombat(source.entity.combat);
      c.fingers = Math.min(FINGERS.charge, c.fingers + amount);
      const next = { ...source.entity, combat: c };
      source.set(next);
      source.entity = next;
    }
    const s = this.statusOf(e.id);
    if (source) s.attacker = source.entity.id;
    if (kill) {
      s.burning = s.oiled = 0;
      s.deadUntil =
        this.tickNow +
        this.ticks(
          target.player ? COMBAT.respawnSeconds : COMBAT.dummyResetSeconds,
        );
      if (!target.player) this.dropPickup(e.position);
    }
    void all;
  }
  tickNow = 0;
  statusOf(id: string) {
    let s = this.status.get(id);
    if (!s)
      this.status.set(
        id,
        (s = {
          burning: 0,
          oiled: 0,
          burnScale: 1,
          attacker: '',
          nextTick: 0,
          deadUntil: 0,
        }),
      );
    return s;
  }
  setBurning(c: Combatant, seconds: number, attacker: string) {
    if (!this.alive(c)) return;
    const s = this.statusOf(c.entity.id);
    const oiled = s.oiled > 0;
    s.burning = Math.max(
      s.burning,
      this.ticks(
        oiled ? Math.max(seconds, FIRE.oiledAfterburnSeconds) : seconds,
      ),
    );
    s.burnScale = oiled ? FIRE.oiledDamageScale : 1;
    if (attacker) s.attacker = attacker;
  }
  dropPickup(at: Vec3) {
    const drops = this.pickups.filter((p) => p.drop);
    if (drops.length >= PICKUPS.maxDrops)
      this.pickups.splice(this.pickups.indexOf(drops[0]!), 1);
    this.pickups.push({
      id: this.nextId('a'),
      position: this.ground(at),
      available: true,
      respawnAt: 0,
      expiresAt: this.tickNow + this.ticks(PICKUPS.dropSeconds),
      drop: true,
    });
  }
  /** Ammo crates: a share of every owned weapon's reserve and one oil flask. */
  collect(player: Combatant, fraction: number) {
    const combat = player.entity.combat;
    if (!combat) return false;
    const table = this.rules().table;
    const c = cloneCombat(combat);
    let gained = false;
    c.ammo.forEach((a, i) => {
      if (!(c.owned & (1 << i))) return;
      const w = table[i]!,
        add = Math.min(
          w.reserveMax - a.reserve,
          Math.ceil(w.reserveMax * fraction),
        );
      if (add > 0) {
        a.reserve += add;
        gained = true;
      }
    });
    if (c.oil < OIL.flaskMax) {
      c.oil++;
      gained = true;
    }
    if (gained) {
      const next = { ...player.entity, combat: c };
      player.set(next);
      player.entity = next;
    }
    return gained;
  }
  // --- Hazards ------------------------------------------------------------------
  addOil(at: Vec3, owner: string, now: number, spill?: string) {
    const puddles = this.hazards.filter((h) => h.kind === 'oil');
    if (puddles.length >= FIRE.maxPuddles) {
      const oldest = puddles.find((h) => !h.spill) ?? puddles[0]!;
      this.hazards.splice(this.hazards.indexOf(oldest), 1);
      this.stats.puddlesEvicted++;
    }
    const h: Hazard = {
      id: this.nextId('h'),
      kind: 'oil',
      position: { ...at },
      radius: OIL.puddleRadius,
      ttl: spill ? Infinity : this.ticks(OIL.puddleSeconds),
      fuel: true,
      owner,
      igniteAt: 0,
      spill,
      created: now,
    };
    this.hazards.push(h);
    // Oil poured into flames catches at once.
    if (
      this.hazards.some(
        (f) =>
          f.kind === 'fire' && dist2(f.position, at) <= f.radius + h.radius,
      )
    )
      h.igniteAt = now + this.ticks(FIRE.spreadDelay);
    return h;
  }
  fires() {
    return this.hazards.filter((h) => h.kind === 'fire').length;
  }
  ignite(h: Hazard, attacker: string) {
    if (h.kind !== 'oil') return false;
    if (this.fires() >= FIRE.maxFires) {
      this.stats.firesCapped++;
      return false;
    }
    h.kind = 'fire';
    h.ttl = this.burnTicks(h.position, FIRE.burnSeconds);
    h.owner = attacker || h.owner;
    h.igniteAt = 0;
    this.events.push({ t: 'ignite', at: h.position });
    return true;
  }
  bareFire(at: Vec3, owner: string, now: number) {
    if (this.fires() >= FIRE.maxFires) {
      this.stats.firesCapped++;
      return;
    }
    this.hazards.push({
      id: this.nextId('h'),
      kind: 'fire',
      position: { ...at },
      radius: FIRE.bareRadius,
      ttl: this.burnTicks(at, FIRE.bareSeconds),
      fuel: false,
      owner,
      igniteAt: 0,
      created: now,
    });
  }
  /** An incendiary event at a point: ignites oil and oiled targets in the radius. */
  incendiary(
    at: Vec3,
    radius: number,
    owner: string,
    now: number,
    all: Combatant[],
    bare: boolean,
  ) {
    let lit = false;
    for (const h of this.hazards)
      if (
        h.kind === 'oil' &&
        dist2(h.position, at) <= h.radius + radius &&
        Math.abs(h.position.y - at.y) < 3
      )
        lit = this.ignite(h, owner) || lit;
    if (bare && !lit) this.bareFire(at, owner, now);
    const ownerC = all.find((c) => c.entity.id === owner);
    // Like blast(): targets behind a wall or under a roof are not set burning.
    const eye = v(at.x, at.y + 0.3, at.z);
    for (const c of all)
      if (
        this.alive(c) &&
        this.hostile(ownerC, c) &&
        dist3(c.entity.position, at) <= radius + 0.5 &&
        clearLine(
          this.world,
          eye,
          v(
            c.entity.position.x,
            c.entity.position.y + 0.9,
            c.entity.position.z,
          ),
        )
      )
        this.setBurning(c, FIRE.afterburnSeconds, owner);
  }
  blast(
    at: Vec3,
    radius: number,
    maxDamage: number,
    minScale: number,
    owner: string,
    cause: HitCause,
    all: Combatant[],
    skip?: string,
  ) {
    const source = all.find((c) => c.entity.id === owner);
    const eye = v(at.x, at.y + 0.3, at.z);
    for (const c of all) {
      if (!this.alive(c) || c.entity.id === skip || !this.hostile(source, c))
        continue;
      const centre = v(
        c.entity.position.x,
        c.entity.position.y + 0.9,
        c.entity.position.z,
      );
      const d = dist3(centre, at);
      if (d > radius + 0.4 || !clearLine(this.world, eye, centre)) continue;
      const scale = 1 - (1 - minScale) * Math.min(1, d / radius);
      this.damage(
        source,
        c,
        maxDamage * scale * (this.dev()?.damageScale ?? 1),
        'body',
        centre,
        at,
        cause,
        all,
      );
    }
  }
  // --- Per-tick simulation ----------------------------------------------------------
  tick(now: number, all: Combatant[], players: Combatant[]) {
    this.tickNow = now;
    const rules = this.rules(),
      dt = this.dt;
    // Projectiles: gravity, swept against the world and current target positions.
    for (const p of [...this.projectiles]) {
      const g =
        p.kind === 'flask'
          ? OIL.gravity
          : rules.table[p.weapon]!.projectileGravity;
      p.velocity.y -= g * dt;
      const step = v(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt),
        len = Math.hypot(step.x, step.y, step.z);
      const dir = v(step.x / len, step.y / len, step.z / len);
      const wall = raycastWorld(this.world, p.position, dir, len);
      let reach = wall ? wall.distance : len,
        target: Combatant | undefined,
        zone: HitShape | undefined;
      const owner = all.find((c) => c.entity.id === p.owner);
      if (p.kind === 'slag')
        for (const c of all) {
          if (!this.alive(c) || !this.hostile(owner, c)) continue;
          const r = rayShapes(
            p.position,
            dir,
            this.shapesAt(c, now, now),
            reach,
          );
          if (r) {
            reach = r.distance;
            target = c;
            zone = r.shape;
          }
        }
      const end = v(
        p.position.x + dir.x * reach,
        p.position.y + dir.y * reach,
        p.position.z + dir.z * reach,
      );
      const impacted =
        !!wall && reach <= len && (target || reach === wall.distance);
      p.position = end;
      if (--p.life <= 0 || impacted || target) {
        this.projectiles.splice(this.projectiles.indexOf(p), 1);
        if (p.kind === 'slag') {
          const w = rules.table[p.weapon]!;
          if (target && zone)
            this.damage(
              owner,
              target,
              w.damage *
                zoneMultiplier(w, zone) *
                (this.dev()?.damageScale ?? 1),
              zone.zone,
              end,
              owner?.entity.position ?? end,
              p.weapon,
              all,
            );
          this.events.push({
            t: 'blast',
            at: end,
            radius: w.splashRadius,
            kind: 'slag',
          });
          // Burst just outside the struck surface (as the flask does below): from the
          // surface itself, the splash line-of-sight and floor probes hit that surface.
          const burst = v(
            end.x - dir.x * 0.05,
            end.y - dir.y * 0.05,
            end.z - dir.z * 0.05,
          );
          this.blast(
            burst,
            w.splashRadius,
            w.splashDamage,
            0.25,
            p.owner,
            'blast',
            all,
            target?.entity.id,
          );
          if (w.incendiary) {
            const floor = this.ground(burst, 0.5);
            this.incendiary(
              burst,
              w.splashRadius,
              p.owner,
              now,
              all,
              Math.abs(floor.y - burst.y) < 0.6,
            );
          }
        } else {
          // The flask bursts into a slick on the surface below and coats nearby targets.
          const puddle = this.ground(
            v(end.x - dir.x * 0.1, end.y + 0.2, end.z - dir.z * 0.1),
            0.4,
          );
          this.addOil(puddle, p.owner, now);
          this.events.push({
            t: 'blast',
            at: end,
            radius: OIL.coatRadius,
            kind: 'flask',
          });
          for (const c of all)
            if (
              this.alive(c) &&
              dist3(c.entity.position, end) <= OIL.coatRadius + 0.5
            )
              this.statusOf(c.entity.id).oiled = this.ticks(OIL.coatSeconds);
        }
      }
    }
    // Fingers of God impacts.
    for (const s of [...this.strikes]) {
      if (now < s.impactTick) continue;
      this.strikes.splice(this.strikes.indexOf(s), 1);
      this.events.push({
        t: 'blast',
        at: s.position,
        radius: FINGERS.radius,
        kind: 'fingers',
      });
      this.blast(
        s.position,
        FINGERS.radius,
        FINGERS.damage,
        FINGERS.minScale,
        s.owner,
        'fingers',
        all,
      );
      this.incendiary(s.position, FINGERS.radius, s.owner, now, all, true);
    }
    // Hazards: scheduled ignition, spread along oil, expiry and fire damage.
    for (const h of this.hazards)
      if (h.kind === 'oil' && h.igniteAt && now >= h.igniteAt)
        this.ignite(h, h.owner);
    for (const f of this.hazards) {
      if (f.kind !== 'fire' || !f.fuel) continue;
      for (const o of this.hazards)
        if (
          o.kind === 'oil' &&
          !o.igniteAt &&
          dist2(o.position, f.position) - o.radius - f.radius <=
            FIRE.spreadGap &&
          Math.abs(o.position.y - f.position.y) < 2
        ) {
          o.igniteAt = now + this.ticks(FIRE.spreadDelay);
          o.owner = f.owner;
        }
    }
    for (const h of [...this.hazards]) {
      if (--h.ttl > 0) continue;
      this.hazards.splice(this.hazards.indexOf(h), 1);
      const spill = h.spill && this.spills.find((s) => s.id === h.spill);
      if (spill) spill.respawnAt = now + this.ticks(OIL.spillRespawn);
    }
    for (const s of this.spills)
      if (s.respawnAt && now >= s.respawnAt) {
        s.respawnAt = 0;
        this.addOil(s.position, '', now, s.id);
      }
    const interval = this.ticks(FIRE.damageInterval);
    for (const c of all) {
      if (!this.alive(c)) continue;
      const s = this.statusOf(c.entity.id);
      if (s.oiled > 0) s.oiled--;
      const p = c.entity.position;
      const inFire = this.hazards.find(
        (h) =>
          h.kind === 'fire' &&
          dist2(h.position, p) <= h.radius + 0.4 &&
          Math.abs(h.position.y - p.y) < 2,
      );
      const firer = inFire
        ? all.find((x) => x.entity.id === inFire.owner)
        : undefined;
      if (inFire && this.hostile(firer, c))
        this.setBurning(c, FIRE.afterburnSeconds, inFire.owner);
      // A burning target ignites the oil it stands in.
      if (s.burning > 0)
        for (const h of this.hazards)
          if (
            h.kind === 'oil' &&
            dist2(h.position, p) <= h.radius &&
            Math.abs(h.position.y - p.y) < 2
          )
            this.ignite(h, s.attacker);
      if (s.burning > 0) {
        s.burning--;
        if (now >= s.nextTick) {
          s.nextTick = now + interval;
          const dps =
            inFire && this.hostile(firer, c) ? FIRE.dps : FIRE.afterburnDps;
          const source = all.find((x) => x.entity.id === s.attacker);
          this.damage(
            source,
            c,
            dps *
              FIRE.damageInterval *
              s.burnScale *
              (this.dev()?.damageScale ?? 1),
            'body',
            v(p.x, p.y + 1, p.z),
            v(p.x, p.y, p.z),
            'fire',
            all,
          );
        }
      }
    }
    // Ammo crates.
    for (const k of [...this.pickups]) {
      if (k.drop && now >= k.expiresAt) {
        this.pickups.splice(this.pickups.indexOf(k), 1);
        continue;
      }
      if (!k.available) {
        if (now >= k.respawnAt) k.available = true;
        continue;
      }
      for (const p of players)
        if (
          this.alive(p) &&
          dist2(p.entity.position, k.position) <= PICKUPS.radius &&
          Math.abs(p.entity.position.y - k.position.y) < 2 &&
          this.collect(
            p,
            k.drop ? PICKUPS.dropFraction : PICKUPS.reserveFraction,
          )
        ) {
          this.events.push({
            t: 'pickup',
            player: p.entity.id,
            at: k.position,
          });
          if (k.drop) this.pickups.splice(this.pickups.indexOf(k), 1);
          else {
            k.available = false;
            k.respawnAt = now + this.ticks(PICKUPS.respawnSeconds);
          }
          break;
        }
    }
    // Public status bits.
    for (const c of all) {
      const s = this.status.get(c.entity.id);
      const bits =
        ((c.entity.status ?? 0) & (STATUS.dead | STATUS.dummy)) |
        (s && s.burning > 0 ? STATUS.burning : 0) |
        (s && s.oiled > 0 ? STATUS.oiled : 0);
      if (bits !== (c.entity.status ?? 0)) {
        const next = { ...c.entity, status: bits };
        c.set(next);
        c.entity = next;
      }
    }
  }
  /** Public snapshot entities for projectiles, hazards, crates and strike telegraphs. */
  entities(now: number): Entity[] {
    const base = (
      id: string,
      type: Entity['type'],
      position: Vec3,
    ): Entity => ({
      id,
      type,
      position,
      velocity: v(0, 0, 0),
      yaw: 0,
      pitch: 0,
      health: 0,
      flags: 0,
      motion: 0,
    });
    return [
      ...this.projectiles.map((p) => ({
        ...base(p.id, 'projectile', p.position),
        velocity: p.velocity,
        kind: p.kind,
        owner: p.owner,
      })),
      ...this.hazards.map((h) => ({
        ...base(h.id, 'hazard', h.position),
        kind: h.kind,
        radius: h.radius,
        timer: Number.isFinite(h.ttl) ? h.ttl : -1,
      })),
      ...this.pickups
        .filter((k) => k.available)
        .map((k) => ({ ...base(k.id, 'pickup', k.position), kind: 'ammo' })),
      ...this.strikes.map((s) => ({
        ...base(s.id, 'strike', s.position),
        kind: 'fingers',
        owner: s.owner,
        timer: s.impactTick - now,
      })),
    ];
  }
}
/** A static (optionally strafing) target dummy for the range. */
export function makeDummy(id: string, position: Vec3, yaw: number): Entity {
  return {
    ...makeEntity(id),
    type: 'robot',
    position: { ...position },
    yaw,
    health: COMBAT.dummyHealth,
    status: STATUS.dummy,
  };
}
/** Fresh loadout on spawn/respawn; owned tiers carry over. */
export function restock(e: Entity, owned: number, rules: CombatRules): Entity {
  const c = initialCombat(owned, rules.table);
  return { ...e, combat: c, slot: c.slot, health: COMBAT.maxHealth, status: 0 };
}
export const ALL_WEAPONS = (1 << WEAPONS.length) - 1;
export { aimDirection, eyeOf };
