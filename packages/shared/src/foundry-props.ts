import type { Level, Surface } from './level';
import { LevelKit } from './level-kit';
import { forgeAsset, seeded } from './forge-data';
import { ASSET_MODELS } from './asset-catalog';
type Vec = { x: number; y: number; z: number };
/** A placeable dressing kind: a CC0 catalog model (procedural forge fallback) or a
 * forge family. `size` is the model's natural footprint in metres. */
export interface PropKind {
  key: string;
  fallback: string;
  category: string;
  size: Vec;
  surface: Surface;
}
const SURFACE: Record<string, Surface> = {
  crate: 'wood',
  pallet: 'wood',
  furniture: 'wood',
  shelf: 'metal',
  barrier: 'concrete',
  debris: 'concrete',
  sack: 'wood',
};
/** Forge families standing in for (or supplementing) each catalog category. */
const FORGE: Record<string, string[]> = {
  barrel: ['barrel'],
  drum: ['drum'],
  crate: ['crate'],
  box: ['crate'],
  pallet: ['pallet'],
  pipe: ['pipe', 'curved-pipe', 'manifold', 'valve'],
  tank: ['tank', 'vat'],
  'gas-cylinder': ['gas-cylinder'],
  electrical: ['electrical-cabinet', 'transformer', 'substation'],
  fence: ['chain-link-fence', 'railing'],
  light: ['floodlight', 'lamp-post'],
  trolley: ['cart'],
  machinery: ['press', 'generator', 'workstation', 'conveyor', 'forklift'],
  barrier: ['jersey-barrier', 'barrier', 'concrete-block', 'bollard'],
  dumpster: ['dumpster', 'wheelie-bin'],
  tire: ['tire'],
  ladder: ['ladder'],
  vent: ['vent', 'duct'],
  antenna: ['power-pole'],
  shelf: ['locker'],
  toolbox: ['workstation'],
  sign: ['sign'],
  cable: ['cable-tray'],
  workbench: ['workstation'],
  generator: ['generator'],
  debris: ['debris', 'rubble'],
  beam: ['truss'],
  vehicle: ['sedan-wreck', 'van-wreck', 'small-truck-wreck'],
  container: ['open-container', 'broken-container'],
  furniture: ['locker'],
  sack: ['tarpaulin'],
  hydrant: ['bollard'],
  cone: ['bollard'],
  bucket: ['drum'],
  misc: ['crate'],
};
const forgeSize = (family: string): Vec => {
  const a = forgeAsset(family, 0);
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (const p of a.parts) {
    x0 = Math.min(x0, p.position.x - p.size.x / 2);
    x1 = Math.max(x1, p.position.x + p.size.x / 2);
    y0 = Math.min(y0, p.position.y - p.size.y / 2);
    y1 = Math.max(y1, p.position.y + p.size.y / 2);
    z0 = Math.min(z0, p.position.z - p.size.z / 2);
    z1 = Math.max(z1, p.position.z + p.size.z / 2);
  }
  return { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
};
/** Real-world sizes for forge families whose recipe is unit-scaled. */
const FORGE_SIZE: Record<string, Vec> = {
  barrel: { x: 0.6, y: 0.9, z: 0.6 },
  drum: { x: 0.58, y: 0.88, z: 0.58 },
  crate: { x: 1.1, y: 0.9, z: 1.1 },
  pallet: { x: 1.2, y: 0.15, z: 1.0 },
  pipe: { x: 0.6, y: 0.6, z: 4 },
  'curved-pipe': { x: 2.4, y: 2.4, z: 0.6 },
  manifold: { x: 1.8, y: 1.4, z: 0.8 },
  valve: { x: 0.6, y: 0.9, z: 0.6 },
  tank: { x: 2.2, y: 2.6, z: 2.2 },
  vat: { x: 3, y: 2.4, z: 3 },
  'gas-cylinder': { x: 0.32, y: 1.5, z: 0.32 },
  'electrical-cabinet': { x: 1.2, y: 1.9, z: 0.6 },
  transformer: { x: 2, y: 2.2, z: 1.6 },
  substation: { x: 3.2, y: 2.6, z: 2.4 },
  'chain-link-fence': { x: 4, y: 2.2, z: 0.2 },
  railing: { x: 3, y: 1.1, z: 0.12 },
  floodlight: { x: 0.8, y: 5.5, z: 0.8 },
  'lamp-post': { x: 0.4, y: 6, z: 0.4 },
  cart: { x: 1.4, y: 1, z: 0.8 },
  press: { x: 2.4, y: 3, z: 2 },
  generator: { x: 2.2, y: 1.6, z: 1.2 },
  workstation: { x: 2, y: 1.2, z: 0.9 },
  conveyor: { x: 5, y: 1.1, z: 1.2 },
  forklift: { x: 1.3, y: 2.2, z: 2.6 },
  'jersey-barrier': { x: 3, y: 0.8, z: 0.6 },
  barrier: { x: 2, y: 1, z: 0.4 },
  'concrete-block': { x: 1.6, y: 0.8, z: 0.8 },
  bollard: { x: 0.3, y: 1, z: 0.3 },
  dumpster: { x: 2, y: 1.4, z: 1.2 },
  'wheelie-bin': { x: 0.6, y: 1.05, z: 0.7 },
  tire: { x: 0.9, y: 0.35, z: 0.9 },
  ladder: { x: 0.5, y: 3.6, z: 0.15 },
  vent: { x: 1, y: 1.2, z: 1 },
  duct: { x: 0.8, y: 0.8, z: 3.5 },
  'power-pole': { x: 0.5, y: 6.5, z: 0.5 },
  locker: { x: 1, y: 2, z: 0.6 },
  sign: { x: 1.6, y: 2.2, z: 0.12 },
  'cable-tray': { x: 3, y: 0.3, z: 0.5 },
  debris: { x: 1.4, y: 0.35, z: 1 },
  rubble: { x: 2.4, y: 0.9, z: 2 },
  truss: { x: 5, y: 0.6, z: 0.6 },
  'sedan-wreck': { x: 1.9, y: 1.4, z: 4.5 },
  'van-wreck': { x: 2.1, y: 2.3, z: 5.2 },
  'small-truck-wreck': { x: 2.3, y: 2.6, z: 6 },
  'open-container': { x: 2.44, y: 2.6, z: 6.1 },
  'broken-container': { x: 2.44, y: 2.6, z: 6.1 },
  tarpaulin: { x: 1.8, y: 0.9, z: 1.4 },
};
export function propKinds(): Record<string, PropKind[]> {
  const kinds: Record<string, PropKind[]> = {};
  // Near-zero footprints (a 4 cm conduit piece) would only pad prop counts.
  for (const m of ASSET_MODELS.filter((m) => m.size.x * m.size.z >= 0.01))
    (kinds[m.category] ??= []).push({
      key: m.prop,
      fallback: m.fallback,
      category: m.category,
      size: { ...m.size },
      surface: SURFACE[m.category] ?? 'metal',
    });
  for (const [category, families] of Object.entries(FORGE))
    for (const family of families)
      (kinds[category] ??= []).push({
        key: `prop.${family}`,
        fallback: `prop.${family}`,
        category,
        size: FORGE_SIZE[family] ?? forgeSize(family),
        surface: SURFACE[category] ?? 'metal',
      });
  return kinds;
}
/** Zone identities as weighted category palettes (ground clusters). */
export const ZONE_PALETTES: Record<string, [string, number][]> = {
  entrance: [
    ['dumpster', 3],
    ['barrier', 4],
    ['sign', 2],
    ['light', 2],
    ['cone', 2],
    ['tire', 2],
    ['debris', 3],
    ['crate', 2],
    ['pallet', 2],
    ['fence', 2],
    ['bucket', 1],
    ['hydrant', 1],
    ['vehicle', 2],
    ['barrel', 2],
    ['box', 2],
    ['electrical', 1],
    ['sack', 1],
    ['misc', 1],
  ],
  tenements: [
    ['dumpster', 3],
    ['crate', 2],
    ['furniture', 2],
    ['debris', 3],
    ['tire', 2],
    ['bucket', 2],
    ['ladder', 1],
    ['fence', 2],
    ['light', 1],
    ['sack', 2],
    ['barrel', 2],
    ['box', 3],
    ['pallet', 2],
    ['cable', 1],
    ['shelf', 1],
    ['sign', 1],
    ['misc', 2],
  ],
  rail: [
    ['pallet', 4],
    ['crate', 4],
    ['container', 3],
    ['trolley', 2],
    ['fence', 2],
    ['light', 2],
    ['barrel', 3],
    ['drum', 2],
    ['tire', 2],
    ['cable', 2],
    ['toolbox', 1],
    ['generator', 1],
    ['sack', 2],
    ['machinery', 1],
    ['box', 2],
    ['barrier', 1],
  ],
  pumps: [
    ['pipe', 4],
    ['tank', 3],
    ['gas-cylinder', 3],
    ['machinery', 2],
    ['electrical', 3],
    ['generator', 2],
    ['vent', 2],
    ['barrel', 2],
    ['drum', 2],
    ['pallet', 1],
    ['light', 1],
    ['fence', 1],
    ['cable', 1],
    ['toolbox', 1],
    ['crate', 1],
  ],
  slag: [
    ['debris', 5],
    ['pipe', 2],
    ['tank', 2],
    ['drum', 3],
    ['barrel', 2],
    ['machinery', 2],
    ['beam', 2],
    ['tire', 2],
    ['sack', 2],
    ['trolley', 1],
    ['barrier', 2],
    ['container', 1],
    ['gas-cylinder', 1],
    ['fence', 1],
    ['light', 1],
    ['crate', 1],
  ],
  hall: [
    ['machinery', 4],
    ['crate', 3],
    ['pallet', 2],
    ['shelf', 2],
    ['workbench', 2],
    ['toolbox', 2],
    ['gas-cylinder', 2],
    ['drum', 2],
    ['trolley', 2],
    ['cable', 2],
    ['beam', 1],
    ['tank', 1],
    ['electrical', 1],
    ['ladder', 1],
    ['box', 1],
    ['generator', 1],
  ],
  core: [
    ['machinery', 3],
    ['electrical', 4],
    ['generator', 2],
    ['pipe', 3],
    ['tank', 2],
    ['crate', 2],
    ['toolbox', 1],
    ['cable', 2],
    ['light', 1],
    ['shelf', 1],
    ['gas-cylinder', 2],
    ['drum', 1],
    ['vent', 1],
    ['workbench', 1],
    ['barrel', 1],
  ],
};
export const ROOF_PALETTE: [string, number][] = [
  ['vent', 5],
  ['antenna', 2],
  ['tank', 2],
  ['electrical', 3],
  ['pipe', 3],
  ['machinery', 1],
  ['box', 2],
  ['cable', 1],
  ['light', 1],
  ['generator', 1],
  ['ladder', 1],
];
/** Existing primitive cover blocks become real props of matching class. */
const DRESS_CLASSES: Record<string, string[]> = {
  cylinder: ['barrel', 'drum', 'gas-cylinder', 'tank', 'bucket'],
  low: ['pallet', 'crate', 'box', 'barrier', 'debris', 'sack', 'tire'],
  cube: ['crate', 'box', 'electrical', 'generator', 'dumpster', 'machinery'],
  tall: [
    'electrical',
    'machinery',
    'shelf',
    'generator',
    'container',
    'dumpster',
  ],
  slab: ['pallet', 'debris', 'cable'],
};
interface Placement {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}
export interface DressContext {
  /** True when a footprint is clear of routes, markers, gates, holes and rooms. */
  clear: (x: number, z: number, radius: number) => boolean;
  /** Roof surfaces only need to stay off routes that cross them. */
  roofClear: (x: number, z: number, radius: number) => boolean;
}
const pickWeighted = (palette: [string, number][], r: number) => {
  const total = palette.reduce((s, [, w]) => s + w, 0);
  let t = r * total;
  for (const [c, w] of palette) if ((t -= w) <= 0) return c;
  return palette.at(-1)![0];
};
/** Dressing pass: real props on every district floor and roof, collision as simple
 * boxes (the shared solid's footprint), decorative-only items classified. */
export function dressProps(k: LevelKit, ctx: DressContext) {
  const level = k.level,
    rng = seeded(level.seed + 3_701),
    kinds = propKinds();
  const pool = (category: string) => kinds[category] ?? kinds.crate!;
  const solids = level.solids!;
  // 1. Upgrade the seeded primitive cover blocks in place: same colliders and cover
  // points; the chosen model is the closest-proportioned kind of the zone's class.
  for (const s of solids) {
    if (!/\/dress-\d+$/.test(s.id)) continue;
    const cls =
      s.shape === 'cylinder'
        ? 'cylinder'
        : s.size.y < 0.5
          ? 'slab'
          : s.size.y < 1
            ? 'low'
            : s.size.y < 1.8
              ? 'cube'
              : 'tall';
    const palette = ZONE_PALETTES[s.zone] ?? ZONE_PALETTES.entrance!;
    const allowed = DRESS_CLASSES[cls]!.filter(
      (c) => cls === 'cylinder' || palette.some(([p]) => p === c),
    );
    const candidates = (allowed.length ? allowed : DRESS_CLASSES[cls]!)
      .flatMap((c) => pool(c))
      .map((kind) => {
        const flip = kind.size.x < kind.size.z !== s.size.x < s.size.z;
        const kx = (flip ? kind.size.z : kind.size.x) / s.size.x,
          ky = kind.size.y / s.size.y,
          kz = (flip ? kind.size.x : kind.size.z) / s.size.z;
        // Cost = anisotropic stretch x overall scale-up or -down, so a sack never
        // stands in for a 2.4 m cover block however well its proportions match.
        // Imported models may stretch at most 1.6x per axis, forge boxes 2.5x.
        const scale = Math.cbrt(kx * ky * kz),
          cost =
            (Math.max(kx, ky, kz) / Math.min(kx, ky, kz)) *
            Math.max(scale, 1 / scale),
          worst = Math.max(kx, ky, kz, 1 / kx, 1 / ky, 1 / kz),
          fits = worst <= (kind.key.startsWith('cc0.') ? 1.6 : 2.5);
        return { kind, flip, cost, fits };
      })
      .sort((a, b) => Number(b.fits) - Number(a.fits) || a.cost - b.cost);
    const best = candidates[0]!,
      cut = candidates.findIndex(
        (c) => c.fits !== best.fits || c.cost > best.cost * 1.35,
      );
    if (cut > 0) candidates.splice(cut);
    candidates.splice(4);
    const pick = candidates[Math.floor(rng() * candidates.length)]!;
    s.prop = pick.kind.key;
    s.fallback = pick.kind.fallback;
    s.yaw = (pick.flip ? Math.PI / 2 : 0) + (rng() < 0.5 ? Math.PI : 0);
    s.tint = rng();
  }
  // 2. New themed clusters beside the routes, and 3. roof dressing.
  const footprint = (kind: PropKind, scale: number, quarter: number) => {
    const swap = quarter % 2 === 1;
    return {
      w: (swap ? kind.size.z : kind.size.x) * scale,
      h: kind.size.y * scale,
      d: (swap ? kind.size.x : kind.size.z) * scale,
    };
  };
  // Local 8 m grid over colliders (including props as they are added).
  type Box = Level['colliders'][number];
  const grid = new Map<string, Box[]>(),
    CELL = 8;
  const cells = (x0: number, z0: number, x1: number, z1: number) => {
    const out: string[] = [];
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++)
        out.push(`${i},${j}`);
    return out;
  };
  const insert = (c: Box) => {
    for (const key of cells(c.min.x, c.min.z, c.max.x, c.max.z))
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(c);
  };
  level.colliders.forEach(insert);
  const overlaps = (p: Placement, pad: number) =>
    cells(
      p.x - p.w / 2 - pad,
      p.z - p.d / 2 - pad,
      p.x + p.w / 2 + pad,
      p.z + p.d / 2 + pad,
    ).some((key) =>
      (grid.get(key) ?? []).some(
        (b) =>
          b.max.y > p.y + 0.05 &&
          b.min.y < p.y + p.h + 0.5 &&
          p.x + p.w / 2 + pad > b.min.x &&
          p.x - p.w / 2 - pad < b.max.x &&
          p.z + p.d / 2 + pad > b.min.z &&
          p.z - p.d / 2 - pad < b.max.z,
      ),
    );
  // Least-used kind first (seeded tie-break), so every catalog model and forge
  // family in a category gets placed before any repeats.
  const usage = new Map<string, number>();
  const choose = (list: PropKind[]) => {
    const least = Math.min(...list.map((k) => usage.get(k.key) ?? 0)),
      open = list.filter((k) => (usage.get(k.key) ?? 0) === least);
    return open[Math.floor(rng() * open.length)]!;
  };
  const place = (
    id: string,
    kind: PropKind,
    x: number,
    y: number,
    z: number,
    quarter: number,
    scale: number,
    zone: string,
    supported?: (p: Placement) => boolean,
  ) => {
    const f = footprint(kind, scale, quarter);
    // Thin panels (chain-link) still need a valid collider: at least 12 cm deep.
    f.w = Math.max(f.w, 0.12);
    f.d = Math.max(f.d, 0.12);
    const p = { x, y, z, ...f };
    if (overlaps(p, 0.12)) return false;
    if (
      !(y === 0 ? ctx.clear : ctx.roofClear)(
        x,
        z,
        Math.hypot(f.w, f.d) / 2 + 0.4,
      )
    )
      return false;
    if (supported && !supported(p)) return false;
    usage.set(kind.key, (usage.get(kind.key) ?? 0) + 1);
    k.zone = zone;
    // Tiny loose items are decorative only; everything else blocks with a box.
    if (Math.min(f.w, f.d) <= 0.3 && f.h <= 0.6) {
      k.decor(
        id,
        'box',
        x,
        y + f.h / 2,
        z,
        f.w,
        f.h,
        f.d,
        kind.surface,
        'small',
        kind.key,
      );
      const d = level.decor.at(-1)!;
      d.fallback = kind.fallback;
      d.rotation = { x: 0, y: (quarter * Math.PI) / 2, z: 0 };
      d.tint = rng();
      return true;
    }
    const c = k.box(id, x, y, z, f.w, f.h, f.d, kind.surface, false);
    insert(c);
    c.mantleable = f.h >= 0.5 && f.h <= 2.6 && Math.min(f.w, f.d) >= 0.6;
    const s = solids.at(-1)!;
    s.prop = kind.key;
    s.fallback = kind.fallback;
    s.yaw = (quarter * Math.PI) / 2;
    s.tint = rng();
    return true;
  };
  const targets: Record<string, number> = {
    entrance: 70,
    tenements: 40,
    rail: 40,
    pumps: 40,
    slag: 45,
    hall: 30,
    core: 40,
  };
  const placedIn = new Map<string, number>();
  for (const zone of level.zones) {
    const palette = ZONE_PALETTES[zone.id];
    if (!palette || !zone.bounds) continue;
    const b = zone.bounds;
    let placed = 0;
    for (
      let attempt = 0;
      attempt < 4000 && placed < targets[zone.id]!;
      attempt++
    ) {
      const ax = b.min.x + 4 + rng() * (b.max.x - b.min.x - 8),
        az = b.min.z + 4 + rng() * (b.max.z - b.min.z - 8);
      const category = pickWeighted(palette, rng());
      const members = 2 + Math.floor(rng() * 4);
      const quarter = Math.floor(rng() * 4);
      for (let m = 0; m < members && placed < targets[zone.id]!; m++) {
        const kindList = pool(
          m === 0
            ? category
            : rng() < 0.65
              ? category
              : pickWeighted(palette, rng()),
        );
        const kind = choose(kindList);
        const scale = 0.92 + rng() * 0.16;
        const step = Math.max(kind.size.x, kind.size.z) * scale + 0.35;
        const x =
            ax + (m % 3) * step * (quarter % 2 ? 0 : 1) + (rng() - 0.5) * 0.4,
          z =
            az +
            (m % 3) * step * (quarter % 2 ? 1 : 0) +
            Math.floor(m / 3) * step;
        if (
          place(
            `${zone.id}/prop-${placed}`,
            kind,
            x,
            0,
            z,
            (quarter + (rng() < 0.3 ? 1 : 0)) % 4,
            scale,
            zone.id,
          )
        )
          placed++;
      }
    }
    placedIn.set(zone.id, placed);
  }
  // Coverage: every catalog model the clusters missed is tried, alone, in the
  // zones whose palette carries its category (same clearance rules).
  for (const [category, list] of Object.entries(kinds)) {
    const zones = level.zones.filter(
      (z) => z.bounds && ZONE_PALETTES[z.id]?.some(([c]) => c === category),
    );
    for (const kind of list)
      for (
        let attempt = 0;
        zones.length && attempt < 800 && !usage.get(kind.key);
        attempt++
      ) {
        const zone = zones[attempt % zones.length]!,
          b = zone.bounds!,
          n = placedIn.get(zone.id) ?? 0;
        if (
          kind.key.startsWith('cc0.') &&
          place(
            `${zone.id}/prop-${n}`,
            kind,
            b.min.x + 4 + rng() * (b.max.x - b.min.x - 8),
            0,
            b.min.z + 4 + rng() * (b.max.z - b.min.z - 8),
            Math.floor(rng() * 4),
            1,
            zone.id,
          )
        )
          placedIn.set(zone.id, n + 1);
      }
  }
  // Roofs: vents, ducts, tanks, antennas, pipe runs and plant on every room roof.
  let roofPlaced = 0;
  for (const room of level.rooms ?? []) {
    const roof = solids.find((s) => s.id === `${room.id}/roof`);
    if (!roof) continue;
    const top = roof.position.y + roof.size.y / 2,
      hw = roof.size.x / 2 - 2.2,
      hd = roof.size.z / 2 - 2.2;
    const supported = (p: Placement) =>
      Math.abs(p.x - roof.position.x) + p.w / 2 <= hw + 1.5 &&
      Math.abs(p.z - roof.position.z) + p.d / 2 <= hd + 1.5;
    const want = Math.max(5, Math.round((roof.size.x * roof.size.z) / 90));
    let here = 0;
    for (let attempt = 0; attempt < 400 && here < want; attempt++) {
      const kindList = pool(pickWeighted(ROOF_PALETTE, rng()));
      const kind = choose(kindList);
      if (
        kind.size.y > 7 ||
        Math.max(kind.size.x, kind.size.z) > Math.min(hw, hd)
      )
        continue;
      const x = roof.position.x + (rng() * 2 - 1) * hw,
        z = roof.position.z + (rng() * 2 - 1) * hd;
      if (
        place(
          `${room.id}/roof-prop-${here}`,
          kind,
          x,
          top,
          z,
          Math.floor(rng() * 4),
          0.92 + rng() * 0.16,
          room.zone,
          supported,
        )
      ) {
        here++;
        roofPlaced++;
      }
    }
  }
  return { roofPlaced };
}
