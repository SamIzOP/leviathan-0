/** Weapon, oil/fire, Fingers of God and pickup data. Balancing edits this file only;
 * the simulation reads every number from here (or from a dev room's live overrides).
 *
 * ASSUMPTION (design notes were blank): five prototype tiers for a co-op shooter
 * against corrupted industrial robots — sidearm, SMG, shotgun, marksman rifle and a
 * heavy incendiary launcher. Names, roles and numbers are placeholders to tune. */
export type FireMode = 'semi' | 'auto' | 'pump';
export type Delivery = 'hitscan' | 'projectile';
export interface WeaponStats {
  id: string;
  name: string;
  tier: number;
  role: string;
  mode: FireMode;
  delivery: Delivery;
  /** Damage per pellet (hitscan) or direct-hit damage (projectile). */
  damage: number;
  pellets: number;
  /** Rounds per minute; the fire interval is rounded to whole simulation ticks. */
  rpm: number;
  magazine: number;
  reserveMax: number;
  reserveStart: number;
  /** Full reload; with `reloadPerRound` > 0 rounds load one at a time instead. */
  reloadTime: number;
  reloadPerRound: number;
  /** Damage falloff: full until `falloffStart`, linear to `falloffMin` × at `falloffEnd`. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  range: number;
  /** Multiplier on a 'head' hit zone; robot weak points carry their own multiplier. */
  headshot: number;
  /** Cone half-angles in degrees. */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  /** View kick per shot, degrees (the client applies it to the real aim). */
  recoilPitch: number;
  recoilYaw: number;
  /** Ground-speed multipliers while held / while aiming down sights. */
  moveSpeed: number;
  adsMoveSpeed: number;
  adsTime: number;
  adsZoom: number;
  /** Raise time after switching, and from a sprint before the first shot. */
  drawTime: number;
  sprintToFire: number;
  projectileSpeed: number;
  projectileGravity: number;
  projectileLife: number;
  splashRadius: number;
  splashDamage: number;
  /** Ignites oil and sets targets burning. */
  incendiary: boolean;
}
export const WEAPONS: readonly WeaponStats[] = [
  {
    id: 'rivet',
    name: 'RIVET P-12',
    tier: 1,
    role: 'Sidearm',
    mode: 'semi',
    delivery: 'hitscan',
    damage: 30,
    pellets: 1,
    rpm: 360,
    magazine: 12,
    reserveMax: 84,
    reserveStart: 48,
    reloadTime: 1.25,
    reloadPerRound: 0,
    falloffStart: 18,
    falloffEnd: 40,
    falloffMin: 0.6,
    range: 120,
    headshot: 2,
    spreadHip: 1.2,
    spreadAds: 0.25,
    spreadMove: 1.5,
    bloomPerShot: 0.6,
    bloomMax: 2.5,
    bloomRecover: 9,
    recoilPitch: 1.4,
    recoilYaw: 0.4,
    moveSpeed: 1,
    adsMoveSpeed: 0.85,
    adsTime: 0.15,
    adsZoom: 1.25,
    drawTime: 0.35,
    sprintToFire: 0.12,
    projectileSpeed: 0,
    projectileGravity: 0,
    projectileLife: 0,
    splashRadius: 0,
    splashDamage: 0,
    incendiary: false,
  },
  {
    id: 'spool',
    name: 'SPOOL SMG',
    tier: 2,
    role: 'Close-range automatic',
    mode: 'auto',
    delivery: 'hitscan',
    damage: 13,
    pellets: 1,
    rpm: 900,
    magazine: 36,
    reserveMax: 216,
    reserveStart: 144,
    reloadTime: 1.6,
    reloadPerRound: 0,
    falloffStart: 10,
    falloffEnd: 28,
    falloffMin: 0.5,
    range: 80,
    headshot: 1.5,
    spreadHip: 2.6,
    spreadAds: 1,
    spreadMove: 1.2,
    bloomPerShot: 0.18,
    bloomMax: 2,
    bloomRecover: 10,
    recoilPitch: 0.55,
    recoilYaw: 0.35,
    moveSpeed: 1,
    adsMoveSpeed: 0.8,
    adsTime: 0.18,
    adsZoom: 1.2,
    drawTime: 0.3,
    sprintToFire: 0.1,
    projectileSpeed: 0,
    projectileGravity: 0,
    projectileLife: 0,
    splashRadius: 0,
    splashDamage: 0,
    incendiary: false,
  },
  {
    id: 'breaker',
    name: 'BREAKER 8-GA',
    tier: 3,
    role: 'Pump shotgun',
    mode: 'pump',
    delivery: 'hitscan',
    damage: 12,
    pellets: 8,
    rpm: 70,
    magazine: 6,
    reserveMax: 36,
    reserveStart: 24,
    reloadTime: 0.3,
    reloadPerRound: 0.48,
    falloffStart: 5,
    falloffEnd: 16,
    falloffMin: 0.25,
    range: 40,
    headshot: 1.25,
    spreadHip: 4.5,
    spreadAds: 3.2,
    spreadMove: 0.5,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 10,
    recoilPitch: 4,
    recoilYaw: 1,
    moveSpeed: 0.97,
    adsMoveSpeed: 0.85,
    adsTime: 0.2,
    adsZoom: 1.15,
    drawTime: 0.45,
    sprintToFire: 0.16,
    projectileSpeed: 0,
    projectileGravity: 0,
    projectileLife: 0,
    splashRadius: 0,
    splashDamage: 0,
    incendiary: false,
  },
  {
    id: 'longline',
    name: 'LONGLINE DMR',
    tier: 4,
    role: 'Marksman rifle',
    mode: 'semi',
    delivery: 'hitscan',
    damage: 52,
    pellets: 1,
    rpm: 150,
    magazine: 8,
    reserveMax: 48,
    reserveStart: 32,
    reloadTime: 2.1,
    reloadPerRound: 0,
    falloffStart: 45,
    falloffEnd: 100,
    falloffMin: 0.75,
    range: 200,
    headshot: 2.25,
    spreadHip: 2,
    spreadAds: 0.05,
    spreadMove: 2.5,
    bloomPerShot: 1,
    bloomMax: 3,
    bloomRecover: 6,
    recoilPitch: 2.8,
    recoilYaw: 0.6,
    moveSpeed: 0.93,
    adsMoveSpeed: 0.7,
    adsTime: 0.28,
    adsZoom: 2.4,
    drawTime: 0.55,
    sprintToFire: 0.22,
    projectileSpeed: 0,
    projectileGravity: 0,
    projectileLife: 0,
    splashRadius: 0,
    splashDamage: 0,
    incendiary: false,
  },
  {
    id: 'slag',
    name: 'SLAG LAUNCHER',
    tier: 5,
    role: 'Heavy incendiary launcher',
    mode: 'semi',
    delivery: 'projectile',
    damage: 85,
    pellets: 1,
    rpm: 60,
    magazine: 4,
    reserveMax: 16,
    reserveStart: 8,
    reloadTime: 2.8,
    reloadPerRound: 0,
    falloffStart: 0,
    falloffEnd: 0,
    falloffMin: 1,
    range: 144,
    headshot: 1,
    spreadHip: 0.6,
    spreadAds: 0.2,
    spreadMove: 0.6,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 10,
    recoilPitch: 5,
    recoilYaw: 0.8,
    moveSpeed: 0.85,
    adsMoveSpeed: 0.75,
    adsTime: 0.3,
    adsZoom: 1.35,
    drawTime: 0.7,
    sprintToFire: 0.3,
    projectileSpeed: 48,
    projectileGravity: 9,
    projectileLife: 3,
    splashRadius: 4,
    splashDamage: 70,
    incendiary: true,
  },
];
export type WeaponStat = {
  [K in keyof WeaponStats]: WeaponStats[K] extends number ? K : never;
}[keyof WeaponStats];
/** Inclusive live-edit bounds for the dev panel; the codec rejects anything outside. */
export const WEAPON_LIMITS: Record<
  Exclude<WeaponStat, 'tier'>,
  readonly [number, number]
> = {
  damage: [1, 300],
  pellets: [1, 16],
  rpm: [20, 1500],
  magazine: [1, 200],
  reserveMax: [0, 999],
  reserveStart: [0, 999],
  reloadTime: [0.05, 6],
  reloadPerRound: [0, 3],
  falloffStart: [0, 300],
  falloffEnd: [0, 300],
  falloffMin: [0, 1],
  range: [5, 400],
  headshot: [1, 5],
  spreadHip: [0, 15],
  spreadAds: [0, 15],
  spreadMove: [0, 15],
  bloomPerShot: [0, 5],
  bloomMax: [0, 15],
  bloomRecover: [0, 60],
  recoilPitch: [0, 15],
  recoilYaw: [0, 10],
  moveSpeed: [0.5, 1.2],
  adsMoveSpeed: [0.3, 1],
  adsTime: [0.02, 1],
  adsZoom: [1, 4],
  drawTime: [0.05, 2],
  sprintToFire: [0, 1],
  projectileSpeed: [0, 200],
  projectileGravity: [0, 40],
  projectileLife: [0, 10],
  splashRadius: [0, 12],
  splashDamage: [0, 300],
};
export type WeaponOverrides = Partial<
  Record<string, Partial<Pick<WeaponStats, keyof typeof WEAPON_LIMITS>>>
>;
/** The effective table: data plus a dev room's live overrides (identical on both ends). */
export function weaponTable(overrides?: WeaponOverrides): WeaponStats[] {
  return WEAPONS.map((w) => ({ ...w, ...overrides?.[w.id] }));
}
/** ASSUMPTION: oil is applied by a thrown flask that bursts into a slick and coats
 * nearby targets. Incendiary hits (Slag Launcher, explosions, Fingers of God, other
 * fire) ignite it; fire burns only where there is fuel, so spread follows oil.
 * Rain shortens outdoor burn times; rooms (roofed interiors) are sheltered. */
export const OIL = {
  flaskStart: 2,
  flaskMax: 3,
  throwSpeed: 18,
  throwUp: 3,
  gravity: 18,
  cooldown: 0.8,
  flaskLife: 4,
  puddleRadius: 3,
  puddleSeconds: 25,
  coatRadius: 2.5,
  coatSeconds: 12,
  /** Pre-placed spills at the level's `oil` markers refill after they burn away. */
  spillRespawn: 30,
} as const;
export const FIRE = {
  burnSeconds: 7,
  dps: 22,
  /** Entities keep burning after leaving the flames; oiled targets burn longer/hotter. */
  afterburnSeconds: 3.5,
  afterburnDps: 10,
  oiledAfterburnSeconds: 7,
  oiledDamageScale: 1.5,
  damageInterval: 0.25,
  spreadDelay: 0.4,
  /** Fire jumps between oil slicks whose edges are at most this far apart. */
  spreadGap: 1,
  /** Fires lit by a strike or blast with no oil under them burn briefly. */
  bareSeconds: 2.5,
  bareRadius: 1.6,
  maxPuddles: 24,
  maxFires: 24,
  /** Outdoor burn time × (1 − rain × rainFactor). */
  rainFactor: 0.45,
} as const;
/** ASSUMPTION: Fingers of God is an ultimate. It charges from damage dealt to
 * hostiles plus a slow trickle; when full, Q calls five beams from the sky in a
 * hand-shaped pattern around the aim point. Each beam lands after a telegraph,
 * damages, ignites oil and leaves a short bare fire. A roof above the point stops
 * the beam at the roof. */
export const FINGERS = {
  charge: 600,
  passivePerSecond: 2,
  range: 150,
  count: 5,
  spread: 4,
  telegraph: 1,
  stagger: 0.12,
  damage: 160,
  radius: 3,
  minScale: 0.4,
  skyHeight: 60,
} as const;
/** ASSUMPTION: an ammo crate refills a share of every owned weapon's reserve and one
 * oil flask. World crates sit on the level's `ammo` markers and respawn; robots and
 * dummies drop a smaller crate on death. */
export const PICKUPS = {
  radius: 1.4,
  respawnSeconds: 20,
  reserveFraction: 0.4,
  dropFraction: 0.25,
  dropSeconds: 30,
  maxDrops: 16,
} as const;
/** Match modes decide team damage. ASSUMPTION: the co-op mission mode is the only
 * mode so far, and operators cannot hurt each other (dev rooms can override). */
export const MATCH_MODES = {
  coop: { friendlyFire: false },
} as const;
export type MatchMode = keyof typeof MATCH_MODES;
export const COMBAT = {
  maxHealth: 100,
  respawnSeconds: 3,
  dummyHealth: 200,
  dummyResetSeconds: 2,
  /** Lag compensation rewinds targets by the shooter's view, capped here. */
  maxRewindMs: 300,
  historyTicks: 40,
  /** Sprint is suppressed this long after a shot (a weapon-related slowdown hook). */
  sprintBlockSeconds: 0.35,
} as const;
