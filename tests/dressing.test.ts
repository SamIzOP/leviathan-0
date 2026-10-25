import { describe, it, expect } from 'vitest';
import { getLevel } from '../packages/shared/src/level';
import { boundsAudit } from '../packages/shared/src/collision-audit';
import { ZONE_MATERIALS } from '../packages/client/src/world-materials';
import { existsSync, readFileSync } from 'node:fs';
const level = getLevel();
const PUBLIC = 'packages/client/public';
const manifest = JSON.parse(
  readFileSync(`${PUBLIC}/asset-manifest.json`, 'utf8'),
) as {
  materials: Record<string, { maps: Record<string, string> }>;
  catalog: Record<
    string,
    {
      kind: 'model' | 'material' | 'hdri';
      license: string;
      source: string;
      sourceUrl: string;
      author?: string;
      fallback?: string;
      prop?: string;
      key?: string;
      path?: string;
      tris?: number;
    }
  >;
};
/** Prompt play areas over the seven layout zones. */
const AREAS: Record<string, { zones: string[]; minimum: number }> = {
  street: { zones: ['entrance'], minimum: 80 },
  rooftops: { zones: ['tenements'], minimum: 60 },
  yard: { zones: ['rail'], minimum: 80 },
  stacks: { zones: ['slag', 'pumps'], minimum: 80 },
  hall: { zones: ['hall', 'core'], minimum: 80 },
};
const props = [
  ...level.solids!.filter((s) => s.prop).map((s) => ({ ...s, solid: true })),
  ...level.decor
    .filter((d) => d.prop)
    .map((d) => ({ ...d, zone: d.zone ?? 'boundary', solid: false })),
];
const CELL = 48;
const cellOf = (p: { position: { x: number; z: number } }) =>
  `${Math.floor(p.position.x / CELL)},${Math.floor(p.position.z / CELL)}`;
function nearRoute(
  points: { x: number; z: number }[],
  x: number,
  z: number,
  clear: number,
) {
  return points.slice(1).some((b, i) => {
    const a = points[i]!,
      dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(
        0,
        Math.min(
          1,
          ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
    return Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < clear;
  });
}
describe('Asset dressing pass', () => {
  it('dresses every play area with enough props and prop types', () => {
    const all = new Set(props.map((p) => p.prop));
    expect(all.size).toBeGreaterThanOrEqual(30);
    for (const [area, { zones, minimum }] of Object.entries(AREAS)) {
      const own = props.filter((p) => zones.includes(p.zone));
      expect(own.length, area).toBeGreaterThanOrEqual(minimum);
      expect(new Set(own.map((p) => p.prop)).size, area).toBeGreaterThanOrEqual(
        15,
      );
    }
    // Rooftops also count the props standing on building roofs.
    expect(
      props.filter((p) => p.id.includes('/roof-prop-')).length,
    ).toBeGreaterThanOrEqual(60);
  });
  it('gives blocking props simple collision and classifies decorative props', () => {
    const colliders = new Map(level.colliders.map((c) => [c.id, c]));
    for (const p of props) {
      if (p.solid) {
        const s = p as NonNullable<typeof level.solids>[number];
        expect(s.colliderIds.length, p.id).toBeGreaterThan(0);
        // Colliders (one box, or slabs for a cylinder) span exactly the solid's
        // own box: no hidden over- or under-reach around the fitted model.
        const boxes = s.colliderIds.map((id) => colliders.get(id)!);
        expect(boxes.every(Boolean), p.id).toBe(true);
        for (const axis of ['x', 'z'] as const) {
          const lo = Math.min(...boxes.map((b) => b.min[axis])),
            hi = Math.max(...boxes.map((b) => b.max[axis]));
          expect(lo, p.id).toBeCloseTo(s.position[axis] - s.size[axis] / 2, 2);
          expect(hi, p.id).toBeCloseTo(s.position[axis] + s.size[axis] / 2, 2);
        }
      } else {
        const d = p as (typeof level.decor)[number];
        expect(d.collision, p.id).toBe('decor');
        expect(d.reason, p.id).toBeDefined();
      }
    }
    expect(boundsAudit(level).filter((e) => /prop/.test(e))).toEqual([]);
  });
  it('keeps new dressing clear of routes, gates and combat markers', () => {
    const keep = [
      ...level.markers!.map((m) => m.position),
      ...level.coverPoints!.map((c) => c.position),
      ...level.spawns.filter((s) => s.type === 'player').map((s) => s.position),
    ];
    const placed = props.filter((p) => /\/(roof-)?prop-\d+$/.test(p.id));
    expect(placed.length).toBeGreaterThan(300);
    for (const p of placed) {
      const r = Math.max(p.size.x, p.size.z) / 2,
        { x, z } = p.position;
      expect(
        level.routes!.some((route) =>
          nearRoute(route.points, x, z, route.width / 2 + r),
        ),
        p.id,
      ).toBe(false);
      if (p.id.includes('/roof-prop-')) continue;
      expect(
        keep.some((k) => Math.hypot(k.x - x, k.z - z) < r + 1.5),
        p.id,
      ).toBe(false);
      expect(
        level.gates.some(
          (g) => Math.hypot(g.position.x - x, g.position.z - z) < r + 8,
        ),
        p.id,
      ).toBe(false);
    }
  });
  it('keeps a tall landmark in every play area', () => {
    for (const [area, { zones }] of Object.entries(AREAS))
      expect(
        level.landmarks!.some((l) => zones.includes(l.zone) && l.height >= 18),
        area,
      ).toBe(true);
  });
  it('enforces per-cell dressing budgets that bound draw calls', () => {
    // Imported models instance per cell and procedural props merge per cell and
    // recipe material, so prop types per 48 m cell bound the prop draw calls.
    const cells = new Map<string, { props: number; types: Set<string> }>();
    for (const p of props) {
      const c = cells.get(cellOf(p)) ?? { props: 0, types: new Set() };
      c.props++;
      c.types.add(p.prop!);
      cells.set(cellOf(p), c);
    }
    for (const [cell, c] of cells) {
      expect(c.props, cell).toBeLessThanOrEqual(PROP_BUDGET.propsPerCell);
      expect(c.types.size, cell).toBeLessThanOrEqual(PROP_BUDGET.typesPerCell);
    }
  });
  it('registers every downloaded asset as CC0 with its source, and uses it', () => {
    const entries = Object.entries(manifest.catalog),
      placed = new Set(props.map((p) => p.prop)),
      zoneKeys = new Set(
        Object.values(ZONE_MATERIALS).flatMap((set) => Object.values(set)),
      );
    expect(
      entries.filter(([, e]) => e.kind === 'model').length,
    ).toBeGreaterThanOrEqual(40);
    expect(
      entries.filter(([, e]) => e.kind === 'material').length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      entries.filter(([, e]) => e.kind === 'hdri').length,
    ).toBeGreaterThanOrEqual(1);
    for (const [id, e] of entries) {
      expect(e.license, id).toBe('CC0');
      expect(e.sourceUrl, id).toMatch(
        /^https:\/\/(polyhaven\.com|ambientcg\.com)\//,
      );
      expect(e.author, id).toBeTruthy();
      expect(e.fallback, id).toBeTruthy();
      if (e.kind === 'model') {
        expect(e.tris, id).toBeLessThanOrEqual(8000);
        expect(existsSync(PUBLIC + e.path), id).toBe(true);
        expect(placed.has(e.prop), `${id} is never placed`).toBe(true);
      } else if (e.kind === 'material') {
        expect(zoneKeys.has(e.key!), `${id} is never used`).toBe(true);
        for (const path of Object.values(manifest.materials[e.key!]!.maps))
          expect(existsSync(PUBLIC + path), path).toBe(true);
      } else expect(existsSync(PUBLIC + e.path), id).toBe(true);
    }
  });
  it('gives every large architectural surface a CC0 material', () => {
    let faces = 0;
    for (const s of level.solids!) {
      if (s.prop) continue;
      const { x, y, z } = s.size;
      if (Math.max(x * y, x * z, y * z) < 50) continue;
      faces++;
      const key = ZONE_MATERIALS[s.zone]?.[s.surface];
      expect(key, `${s.id} (${s.zone} ${s.surface})`).toBeDefined();
      expect(manifest.materials[key!], key).toBeDefined();
    }
    // Ground slabs span zones; the client draws each zone's part with its own set.
    for (const zone of level.zones)
      expect(ZONE_MATERIALS[zone.id]?.asphalt, zone.id).toBeDefined();
    expect(faces).toBeGreaterThan(250);
  });
});
/** Static dressing budget per 48 m cell (see docs/dressing/DRESSING.md). */
const PROP_BUDGET = { propsPerCell: 140, typesPerCell: 40 };
