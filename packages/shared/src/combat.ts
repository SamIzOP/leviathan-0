import { BUTTON, MOVE, type MoveTuning } from './config';
import { METRICS } from './metrics';
import { sanitizeInput, stepPlayer } from './movement';
import type { Box, Entity, Input, Vec3, World } from './types';
import {
  COMBAT,
  FINGERS,
  OIL,
  weaponTable,
  type WeaponOverrides,
  type WeaponStats,
} from './weapons';

/** Combat input bits, after the movement bits (jump 1, sprint 2, crouch 4). */
export const FIRE_BUTTON = {
  fire: 8,
  ads: 16,
  reload: 32,
  oil: 64,
  fingers: 128,
} as const;
/** Public status bits on snapshot entities (never compared by movement prediction). */
export const STATUS = { dead: 1, burning: 2, oiled: 4, dummy: 8 } as const;
export interface WeaponAmmo {
  mag: number;
  reserve: number;
}
/** Owner-only predicted weapon state. Timers are whole ticks so the server and the
 * client prediction stay bit-identical. */
export interface CombatState {
  slot: number;
  /** Bitmask of owned tiers (bit n = WEAPONS[n]). */
  owned: number;
  ammo: WeaponAmmo[];
  cooldown: number;
  reload: number;
  draw: number;
  ready: number;
  ads: number;
  bloom: number;
  shots: number;
  buttons: number;
  /** Semi/pump trigger buffer: a press shortly before the weapon is ready still fires. */
  trigger: number;
  sprintBlock: number;
  lowered: boolean;
  oil: number;
  oilCooldown: number;
  fingers: number;
}
export interface CombatRules {
  table: WeaponStats[];
  infiniteAmmo: boolean;
}
export interface Shot {
  weapon: number;
  origin: Vec3;
  dirs: Vec3[];
  seq: number;
}
export interface Throw {
  origin: Vec3;
  velocity: Vec3;
}
/** Local presentation cues (audio/animation); the server ignores them. */
export type Cue =
  'empty' | 'reload' | 'reload-round' | 'reload-done' | 'switch' | 'raise';
export interface CombatStep {
  entity: Entity;
  shots: Shot[];
  throws: Throw[];
  fingers?: { origin: Vec3; dir: Vec3 };
  cues: Cue[];
}
export const DEFAULT_RULES: CombatRules = {
  table: weaponTable(),
  infiniteAmmo: false,
};
export function combatRules(
  overrides?: WeaponOverrides,
  infiniteAmmo = false,
): CombatRules {
  return { table: weaponTable(overrides), infiniteAmmo };
}
const ticks = (seconds: number, dt: number) =>
  Math.max(0, Math.round(seconds / dt));
export const fireInterval = (w: WeaponStats, dt: number) =>
  Math.max(1, Math.round(60 / w.rpm / dt));
/** ASSUMPTION: production loadouts start with tiers 1–2; dev/solo rooms own all five
 * (tier unlocks belong to the later progression prompt). */
export function initialCombat(
  owned = 0b11,
  table: WeaponStats[] = DEFAULT_RULES.table,
): CombatState {
  return {
    slot: 0,
    owned,
    ammo: table.map((w) => ({ mag: w.magazine, reserve: w.reserveStart })),
    cooldown: 0,
    reload: 0,
    draw: 0,
    ready: 0,
    ads: 0,
    bloom: 0,
    shots: 0,
    buttons: 0,
    trigger: 0,
    sprintBlock: 0,
    lowered: false,
    oil: OIL.flaskStart,
    oilCooldown: 0,
    fingers: 0,
  };
}
export function cloneCombat(c: CombatState): CombatState {
  return { ...c, ammo: c.ammo.map((a) => ({ ...a })) };
}
export function combatMatches(a?: CombatState, b?: CombatState) {
  if (!a || !b) return a === b;
  return (
    a.slot === b.slot &&
    a.owned === b.owned &&
    a.cooldown === b.cooldown &&
    a.reload === b.reload &&
    a.draw === b.draw &&
    a.ready === b.ready &&
    a.ads === b.ads &&
    a.bloom === b.bloom &&
    a.shots === b.shots &&
    a.buttons === b.buttons &&
    a.trigger === b.trigger &&
    a.sprintBlock === b.sprintBlock &&
    a.lowered === b.lowered &&
    a.oil === b.oil &&
    a.oilCooldown === b.oilCooldown &&
    a.fingers === b.fingers &&
    a.ammo.length === b.ammo.length &&
    a.ammo.every(
      (x, i) => x.mag === b.ammo[i]!.mag && x.reserve === b.ammo[i]!.reserve,
    )
  );
}
/** Eye height used for every authoritative shot: standing, crouched or sliding. */
export function eyeHeight(e: Entity) {
  return e.move?.mode === 'SLIDE'
    ? METRICS.slideEye
    : e.move?.crouched
      ? METRICS.crouchEye
      : METRICS.eye;
}
export const eyeOf = (e: Entity): Vec3 => ({
  x: e.position.x,
  y: e.position.y + eyeHeight(e),
  z: e.position.z,
});
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
/** Deterministic per-shot randomness (same seed on server and client). */
export function shotRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function idHash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** Uniform direction inside a cone of `degrees` half-angle around `dir`. */
export function spreadDirection(
  dir: Vec3,
  degrees: number,
  u: number,
  v: number,
): Vec3 {
  if (degrees <= 0) return { ...dir };
  const up =
    Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let rx = up.y * dir.z - up.z * dir.y,
    ry = up.z * dir.x - up.x * dir.z,
    rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = dir.y * rz - dir.z * ry,
    uy = dir.z * rx - dir.x * rz,
    uz = dir.x * ry - dir.y * rx;
  const r = Math.tan((degrees * Math.PI) / 180) * Math.sqrt(u),
    theta = 2 * Math.PI * v;
  const a = r * Math.cos(theta),
    b = r * Math.sin(theta);
  const x = dir.x + rx * a + ux * b,
    y = dir.y + ry * a + uy * b,
    z = dir.z + rz * a + uz * b,
    l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}
export function falloff(w: WeaponStats, distance: number) {
  if (w.falloffEnd <= w.falloffStart || distance <= w.falloffStart) return 1;
  if (distance >= w.falloffEnd) return w.falloffMin;
  const t = (distance - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}
const hspeed = (e: Entity) => Math.hypot(e.velocity.x, e.velocity.z);
/** Speed-scaled tunings are cached so the slowdown hook allocates nothing per tick. */
const scaledTunes = new WeakMap<MoveTuning, Map<number, MoveTuning>>();
export function weaponTuning(tune: MoveTuning, factor: number): MoveTuning {
  if (factor === 1) return tune;
  let byFactor = scaledTunes.get(tune);
  if (!byFactor) scaledTunes.set(tune, (byFactor = new Map()));
  let scaled = byFactor.get(factor);
  if (!scaled) {
    scaled = {
      ...tune,
      walk: tune.walk * factor,
      sprint: tune.sprint * factor,
      crouch: tune.crouch * factor,
    };
    byFactor.set(factor, scaled);
  }
  return scaled;
}
const MOVE_BITS = BUTTON.jump | BUTTON.sprint | BUTTON.crouch;
/** One authoritative/predicted tick: weapon hooks on the input, the unchanged
 * movement step, then the weapon step. Dead entities are not stepped. */
export function stepCombatant(
  state: Entity,
  input: Input,
  dt: number,
  world: World,
  tune: MoveTuning = MOVE,
  rules: CombatRules = DEFAULT_RULES,
  diagnose?: Parameters<typeof stepPlayer>[5],
): CombatStep {
  const c = cloneCombat(state.combat ?? initialCombat(0b11, rules.table));
  const w = rules.table[c.slot]!;
  const held = input.buttons,
    fire = !!(held & FIRE_BUTTON.fire),
    ads = !!(held & FIRE_BUTTON.ads);
  const sprinting =
    state.move?.mode === 'GROUND' &&
    !!(held & BUTTON.sprint) &&
    hspeed(state) > tune.walk + 0.25;
  // Weapon slowdown hook: firing, aiming or a fresh shot stops the sprint; the
  // movement module itself is untouched and simply sees sprint released.
  const blocked = fire || ads || c.sprintBlock > 0;
  if (sprinting && !blocked) c.lowered = true;
  else if (c.lowered && blocked) {
    c.lowered = false;
    c.ready = Math.max(c.ready, ticks(w.sprintToFire, dt));
  }
  if (!sprinting) c.lowered = false;
  // Only ground sprinting is suppressed; slides, wall-runs and air control are
  // untouched so firing works in every traversal state.
  const grounded =
    state.move?.mode === 'GROUND' || state.move?.mode === 'CROUCH';
  const moveInput: Input =
    blocked && grounded
      ? { ...input, buttons: held & ~BUTTON.sprint & 0xff }
      : input;
  const adsTicks = Math.max(1, ticks(w.adsTime, dt));
  const factor = w.moveSpeed * (c.ads * 2 >= adsTicks ? w.adsMoveSpeed : 1);
  const moved = stepPlayer(
    state,
    moveInput,
    dt,
    world,
    weaponTuning(tune, Math.round(factor * 1000) / 1000),
    diagnose,
  );
  return stepWeapon(c, moved, input, dt, rules);
}
/** Server receive path: the movement sanitiser masks to movement bits, so combat
 * bits, the wanted slot and the lag-compensation view tick are restored here. */
export function sanitizeCombatInput(i: Input): Input {
  const clean: Input = { ...sanitizeInput(i), buttons: i.buttons & 0xff };
  if (i.weapon !== undefined)
    clean.weapon = Math.max(0, Math.min(15, Math.floor(i.weapon)));
  if (i.view !== undefined && Number.isFinite(i.view)) clean.view = i.view;
  else delete clean.view;
  return clean;
}
/** The weapon half of a tick, on the post-movement entity. */
export function stepWeapon(
  c: CombatState,
  e: Entity,
  input: Input,
  dt: number,
  rules: CombatRules,
): CombatStep {
  const out: CombatStep = {
    entity: e,
    shots: [],
    throws: [],
    cues: [],
  };
  const prev = c.buttons,
    held = input.buttons;
  const pressed = (bit: number) => !!(held & bit) && !(prev & bit);
  c.buttons = held & ~MOVE_BITS & 0xff;
  // Timers.
  if (c.cooldown > 0) c.cooldown--;
  if (c.draw > 0) {
    c.draw--;
    if (!c.draw) out.cues.push('raise');
  }
  if (c.ready > 0) c.ready--;
  if (c.sprintBlock > 0) c.sprintBlock--;
  if (c.oilCooldown > 0) c.oilCooldown--;
  if (c.trigger > 0) c.trigger--;
  c.fingers = Math.min(
    FINGERS.charge,
    c.fingers + FINGERS.passivePerSecond * dt,
  );
  // Switching: the input names the wanted slot; switching cancels a reload.
  const want = input.weapon;
  if (
    want !== undefined &&
    want !== c.slot &&
    want >= 0 &&
    want < rules.table.length &&
    c.owned & (1 << want)
  ) {
    c.slot = want;
    c.reload = 0;
    c.ads = 0;
    c.trigger = 0;
    c.draw = ticks(rules.table[want]!.drawTime, dt);
    c.cooldown = 0;
    out.cues.push('switch');
  }
  const w = rules.table[c.slot]!,
    ammo = c.ammo[c.slot]!;
  const adsTicks = Math.max(1, ticks(w.adsTime, dt));
  c.ads =
    held & FIRE_BUTTON.ads
      ? Math.min(adsTicks, c.ads + 1)
      : Math.max(0, c.ads - 1);
  const adsFrac = c.ads / adsTicks;
  c.bloom = Math.max(0, c.bloom - w.bloomRecover * dt);
  // Reload: R starts it; an empty trigger pull starts it automatically.
  const reloadTicks = (first: boolean) =>
    Math.max(
      1,
      ticks(
        w.reloadPerRound > 0
          ? (first ? w.reloadTime : 0) + w.reloadPerRound
          : w.reloadTime,
        dt,
      ),
    );
  const canReload = () =>
    !c.reload &&
    ammo.mag < w.magazine &&
    (ammo.reserve > 0 || rules.infiniteAmmo);
  if (pressed(FIRE_BUTTON.reload) && canReload()) {
    c.reload = reloadTicks(true);
    out.cues.push('reload');
  }
  if (c.reload > 0 && --c.reload === 0) {
    if (w.reloadPerRound > 0) {
      ammo.mag++;
      if (!rules.infiniteAmmo) ammo.reserve--;
      out.cues.push('reload-round');
      if (ammo.mag < w.magazine && (ammo.reserve > 0 || rules.infiniteAmmo))
        c.reload = reloadTicks(false);
      else out.cues.push('reload-done');
    } else {
      const take = rules.infiniteAmmo
        ? w.magazine - ammo.mag
        : Math.min(w.magazine - ammo.mag, ammo.reserve);
      ammo.mag += take;
      if (!rules.infiniteAmmo) ammo.reserve -= take;
      out.cues.push('reload-done');
    }
  }
  // Trigger.
  const fireHeld = !!(held & FIRE_BUTTON.fire);
  if (pressed(FIRE_BUTTON.fire)) c.trigger = ticks(0.12, dt);
  const wantsShot = w.mode === 'auto' ? fireHeld : c.trigger > 0;
  if (wantsShot && w.reloadPerRound > 0 && c.reload > 0 && ammo.mag > 0)
    c.reload = 0; // a shell-by-shell reload is interrupted by firing
  const able = !c.cooldown && !c.draw && !c.ready && !c.reload;
  if (wantsShot && able) {
    if (ammo.mag <= 0) {
      if (pressed(FIRE_BUTTON.fire)) out.cues.push('empty');
      c.trigger = 0;
      if (canReload()) {
        c.reload = reloadTicks(true);
        out.cues.push('reload');
      }
    } else {
      if (!rules.infiniteAmmo) ammo.mag--;
      c.trigger = 0;
      c.cooldown = fireInterval(w, dt);
      c.sprintBlock = ticks(COMBAT.sprintBlockSeconds, dt);
      const origin = eyeOf(e),
        aim = aimDirection(input.yaw, input.pitch);
      const moving =
        Math.min(1, hspeed(e) / 8) + (e.move?.mode === 'AIR' ? 0.5 : 0);
      const spread =
        w.spreadHip +
        (w.spreadAds - w.spreadHip) * adsFrac +
        c.bloom +
        w.spreadMove * Math.min(1, moving);
      const rand = shotRandom(
        idHash(e.id) ^ Math.imul(c.shots + 1, 0x9e3779b1),
      );
      const dirs: Vec3[] = [];
      for (let i = 0; i < Math.max(1, w.pellets); i++)
        dirs.push(spreadDirection(aim, spread, rand(), rand()));
      out.shots.push({ weapon: c.slot, origin, dirs, seq: c.shots });
      c.shots++;
      c.bloom = Math.min(w.bloomMax, c.bloom + w.bloomPerShot);
      if (!ammo.mag && canReload()) {
        // Automatic reload once the magazine runs dry.
        c.reload = reloadTicks(true);
        out.cues.push('reload');
      }
    }
  }
  if (pressed(FIRE_BUTTON.oil) && c.oil > 0 && !c.oilCooldown) {
    c.oil--;
    c.oilCooldown = ticks(OIL.cooldown, dt);
    const d = aimDirection(input.yaw, input.pitch),
      o = eyeOf(e);
    out.throws.push({
      origin: o,
      velocity: {
        x: d.x * OIL.throwSpeed + e.velocity.x * 0.5,
        y: d.y * OIL.throwSpeed + OIL.throwUp,
        z: d.z * OIL.throwSpeed + e.velocity.z * 0.5,
      },
    });
  }
  if (pressed(FIRE_BUTTON.fingers) && c.fingers >= FINGERS.charge) {
    c.fingers = 0;
    out.fingers = {
      origin: eyeOf(e),
      dir: aimDirection(input.yaw, input.pitch),
    };
  }
  out.entity = { ...e, combat: c, slot: c.slot };
  return out;
}
// --- Rays against the static world and entity hit shapes ---------------------
export type HitZone = 'body' | 'head' | 'weak';
export interface HitShape {
  zone: HitZone;
  min: Vec3;
  max: Vec3;
  /** Weak points (Prompt 5 robots) carry their own multiplier. */
  multiplier?: number;
}
export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
}
/** Slab test; returns entry distance and the entry face normal, or null. */
export function rayBox(
  o: Vec3,
  d: Vec3,
  min: Vec3,
  max: Vec3,
  maxDistance: number,
): { t: number; normal: Vec3 } | null {
  let t0 = 0,
    t1 = maxDistance,
    axis = -1,
    sign = 0;
  for (let a = 0; a < 3; a++) {
    const k = a === 0 ? 'x' : a === 1 ? 'y' : 'z';
    const dir = d[k],
      lo = min[k],
      hi = max[k],
      p = o[k];
    if (Math.abs(dir) < 1e-12) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let near = (lo - p) / dir,
      far = (hi - p) / dir,
      s = -1;
    if (near > far) {
      [near, far] = [far, near];
      s = 1;
    }
    if (near > t0) {
      t0 = near;
      axis = a;
      sign = s;
    }
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  const normal = { x: 0, y: 0, z: 0 };
  if (axis === 0) normal.x = sign;
  else if (axis === 1) normal.y = sign;
  else if (axis === 2) normal.z = sign;
  return { t: t0, normal };
}
/** First static-world hit along a ray, walking the broadphase in short segments. */
export function raycastWorld(
  world: World,
  o: Vec3,
  d: Vec3,
  maxDistance: number,
): RayHit | null {
  let best: { t: number; normal: Vec3 } | null = null;
  // The ground plane (world.floor) also stops rays.
  if (d.y < -1e-9) {
    const t = (world.floor - o.y) / d.y;
    if (t >= 0 && t <= maxDistance) best = { t, normal: { x: 0, y: 1, z: 0 } };
  }
  const seen = new Set<Box>(),
    STEP = 6;
  for (let s = 0; s < maxDistance; s += STEP) {
    const e = Math.min(maxDistance, s + STEP);
    if (best && best.t <= s) break;
    const ax = o.x + d.x * s,
      az = o.z + d.z * s,
      bx = o.x + d.x * e,
      bz = o.z + d.z * e;
    const boxes = world.query
      ? world.query(
          Math.min(ax, bx) - 0.01,
          Math.min(az, bz) - 0.01,
          Math.max(ax, bx) + 0.01,
          Math.max(az, bz) + 0.01,
        )
      : world.boxes;
    for (const b of boxes) {
      if (seen.has(b)) continue;
      seen.add(b);
      const hit = rayBox(o, d, b.min, b.max, best ? best.t : maxDistance);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    if (!world.query) break;
  }
  return best
    ? {
        distance: best.t,
        point: {
          x: o.x + d.x * best.t,
          y: o.y + d.y * best.t,
          z: o.z + d.z * best.t,
        },
        normal: best.normal,
      }
    : null;
}
/** Line of sight between two points against static geometry. */
export function clearLine(world: World, a: Vec3, b: Vec3) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) return true;
  const hit = raycastWorld(world, a, { x: dx / l, y: dy / l, z: dz / l }, l);
  return !hit || hit.distance >= l - 0.05;
}
/** Capsule-sized hit shapes: a body box and a head box (player or robot). */
export function hitShapes(position: Vec3, crouched: boolean): HitShape[] {
  const h = crouched ? 1 : METRICS.height,
    r = METRICS.radius,
    head = 0.34,
    hr = 0.22;
  return [
    {
      zone: 'body',
      min: { x: position.x - r, y: position.y, z: position.z - r },
      max: { x: position.x + r, y: position.y + h - head, z: position.z + r },
    },
    {
      zone: 'head',
      min: { x: position.x - hr, y: position.y + h - head, z: position.z - hr },
      max: { x: position.x + hr, y: position.y + h, z: position.z + hr },
    },
  ];
}
export function rayShapes(
  o: Vec3,
  d: Vec3,
  shapes: HitShape[],
  maxDistance: number,
): { shape: HitShape; distance: number } | null {
  let best: { shape: HitShape; distance: number } | null = null;
  for (const shape of shapes) {
    const hit = rayBox(
      o,
      d,
      shape.min,
      shape.max,
      best ? best.distance : maxDistance,
    );
    // Head wins ties at the shared boundary (the ray enters both at once).
    if (
      hit &&
      (!best ||
        hit.t < best.distance - 1e-6 ||
        (Math.abs(hit.t - best.distance) <= 1e-6 && shape.zone !== 'body'))
    )
      best = { shape, distance: hit.t };
  }
  return best;
}
export function zoneMultiplier(w: WeaponStats, shape: HitShape) {
  return shape.multiplier ?? (shape.zone === 'head' ? w.headshot : 1);
}
