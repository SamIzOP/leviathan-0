import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { getLevel } from '../packages/shared/src/level';
import { LevelKit } from '../packages/shared/src/level-kit';
import {
  boundsAudit,
  wallWalkAudit,
} from '../packages/shared/src/collision-audit';
import {
  pathLength,
  routeAudit,
  criticalPathRun,
} from '../packages/shared/src/layout-audit';
import { progressionAudit } from '../packages/shared/src/progression-audit';
import { collisionSweep } from '../packages/client/src/collision-sweep';
import { primitive } from '../packages/client/src/forge';
import type { Primitive } from '../packages/shared/src/forge-data';
const level = getLevel();
function visualWorld(data: typeof level) {
  const root = new T.Group(),
    material = new T.MeshBasicMaterial();
  for (const s of data.solids ?? []) {
    const mesh = new T.InstancedMesh(
      primitive(s.shape as Primitive),
      material,
      1,
    );
    mesh.setMatrixAt(
      0,
      new T.Matrix4().compose(
        new T.Vector3(s.position.x, s.position.y, s.position.z),
        new T.Quaternion(),
        new T.Vector3(s.size.x, s.size.y, s.size.z),
      ),
    );
    mesh.userData.solidIds = [s.id];
    root.add(mesh);
  }
  return { root, level: data };
}
describe('Seven-beat foundry redesign', () => {
  it('enforces playable scale, ordered gates and a long actual sprint run', () => {
    expect(level.zones.map((z) => z.id)).toEqual([
      'entrance',
      'tenements',
      'rail',
      'pumps',
      'slag',
      'hall',
      'core',
    ]);
    expect(pathLength(level)).toBeGreaterThanOrEqual(1300);
    expect(pathLength(level) / 16).toBeGreaterThanOrEqual(80);
    expect(pathLength(level) / 8).toBeGreaterThanOrEqual(165);
    const run = criticalPathRun(level);
    expect(run.passed, run.stalls.join('\n')).toBe(true);
    expect(run.reached).toBe(level.criticalPath!.length - 1);
  });
  it('keeps reserved lanes clear and flanks connected at both ends', () => {
    expect(routeAudit(level)).toEqual([]);
    for (const z of level.zones) {
      const main = level.routes!.find(
          (r) => r.zone === z.id && r.kind === 'primary',
        )!,
        flank = level.routes!.find(
          (r) => r.zone === z.id && r.kind === 'flank',
        )!;
      expect(main.width).toBeGreaterThanOrEqual(6);
      expect(flank.width).toBeGreaterThanOrEqual(4);
      for (const p of [flank.points[0]!, flank.points.at(-1)!]) {
        const connected = main.points.slice(1).some((b, i) => {
          const a = main.points[i]!,
            dx = b.x - a.x,
            dz = b.z - a.z,
            t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz);
          return (
            t >= 0 &&
            t <= 1 &&
            Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) < 0.1
          );
        });
        expect(connected, z.id).toBe(true);
      }
    }
    const damaged = structuredClone(level);
    new LevelKit(damaged).box('obstruction', 0, 0, 50, 4, 4, 2);
    expect(routeAudit(damaged).length).toBeGreaterThan(0);
  });
  it('cannot reach a later zone around a closed progression throat', () => {
    const report = progressionAudit(level);
    expect(report.errors).toEqual([]);
    expect(report.checks).toHaveLength(6);
    const breached = structuredClone(level);
    breached.colliders = breached.colliders.filter(
      (c) => c.id !== 'partition-entrance-core',
    );
    expect(progressionAudit(breached).errors.length).toBeGreaterThan(0);
  });
  it('provides multiple doorways, mezzanines and the authored vertical levels', () => {
    expect(level.rooms!.length).toBeGreaterThanOrEqual(6);
    for (const room of level.rooms!) {
      expect(room.openings.length).toBeGreaterThanOrEqual(2);
      for (const door of room.openings) {
        expect(door.width).toBeGreaterThanOrEqual(2.4);
        expect(door.height).toBeGreaterThanOrEqual(3);
      }
    }
    for (const y of [-3, 0, 4, 6, 12, 18])
      expect(level.colliders.some((c) => Math.abs(c.max.y - y) < 0.01)).toBe(
        true,
      );
    expect(
      level.colliders.filter((c) => c.id.endsWith('/mezzanine')).length,
    ).toBeGreaterThanOrEqual(2);
    const flights = new Map<string, typeof level.colliders>();
    for (const c of level.colliders.filter((c) => c.id.includes('/tread-'))) {
      const key = c.id.split('/tread-')[0]!;
      flights.set(key, [...(flights.get(key) ?? []), c]);
    }
    for (const flight of flights.values())
      for (let i = 1; i < flight.length; i++) {
        const rise = flight[i]!.max.y - flight[i - 1]!.max.y;
        expect(rise).toBeGreaterThanOrEqual(0.1 - 1e-5);
        expect(rise).toBeLessThanOrEqual(0.18 + 1e-5);
      }
  });
  it('authors complete combat metadata and varied building signatures', () => {
    expect(
      level.markers!.filter((m) => m.kind === 'enemySpawn').length,
    ).toBeGreaterThanOrEqual(60);
    expect(level.coverPoints!.length).toBeGreaterThanOrEqual(120);
    expect(level.encounters).toHaveLength(7);
    for (const kind of ['ground', 'interior', 'elevated'])
      expect(level.markers!.some((m) => m.hint === kind)).toBe(true);
    for (const kind of ['ammo', 'salvage', 'oil', 'burn', 'exit', 'checkpoint'])
      expect(level.markers!.some((m) => m.kind === kind)).toBe(true);
    expect(
      new Set(level.buildings.map((b) => b.archetype)).size,
    ).toBeGreaterThanOrEqual(24);
    for (const b of level.buildings) {
      const near = level.buildings
        .filter((c) => c !== b)
        .sort(
          (a, c) =>
            Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z),
        )[0]!;
      expect(`${b.archetype}/${b.roof}/${b.height}`).not.toBe(
        `${near.archetype}/${near.roof}/${near.height}`,
      );
    }
    for (const z of level.zones)
      expect(
        level.solids!.filter((s) => s.zone === z.id).length,
      ).toBeGreaterThanOrEqual(z.dressingMinimum!);
  });
  it('covers solid bounds and blocks all isolated facade approaches', () => {
    expect(boundsAudit(level)).toEqual([]);
    const walk = wallWalkAudit(level);
    expect(walk.probes).toBeGreaterThan(4000);
    expect(walk.errors).toEqual([]);
    const broken = structuredClone(level);
    broken.colliders = broken.colliders.filter(
      (c) => c.visualId !== 'gate-workshop/side-1',
    );
    expect(
      boundsAudit(broken).some((e) => e.includes('gate-workshop/side-1')),
    ).toBe(true);
    expect(
      wallWalkAudit(broken).errors.some((e) =>
        e.includes('gate-workshop/side-1'),
      ),
    ).toBe(true);
  }, 30000);
  it('sweeps actual primitive meshes and detects a deliberately missing collider', async () => {
    const fixture = structuredClone(level);
    fixture.bounds = {
      min: { x: -5, y: -4, z: -5 },
      max: { x: 5, y: 8, z: 5 },
    };
    fixture.colliders = [];
    fixture.solids = [];
    fixture.decor = [];
    const kit = new LevelKit(fixture);
    kit.box('test-wall', 2, 0, 0, 1, 4, 6);
    kit.cylinder('test-tank', -2, 0, 0, 1, 3);
    const world = visualWorld(fixture);
    expect((await collisionSweep(world)).mismatches).toEqual([]);
    fixture.colliders = fixture.colliders.filter(
      (c) => c.visualId !== 'test-wall',
    );
    expect((await collisionSweep(world)).mismatches.length).toBeGreaterThan(0);
    world.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
  });
});
