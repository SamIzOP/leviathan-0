import * as T from 'three';
import type { WorldView } from './world';
type Interval = [number, number];
const union = (parts: Interval[]) => {
  parts.sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (last && p[0] <= last[1] + 1e-5) last[1] = Math.max(last[1], p[1]);
    else out.push([...p]);
  }
  return out;
};
function distances(t: number, spans: Interval[]): [number, number] {
  let backward = Infinity;
  for (const [a, b] of spans) {
    if (t >= a - 1e-5 && t <= b + 1e-5) return [0, 0];
    if (a > t) return [a - t, backward];
    backward = t - b;
  }
  return [Infinity, backward];
}
/** Exact real-mesh intersections along complete grid lines are reused for each
 * 1 m origin and both directions. This is the same 8-direction sweep without
 * issuing millions of redundant triangle raycasts on identical lines. */
export async function collisionSweep(world: Pick<WorldView, 'root' | 'level'>) {
  const meshes: T.Mesh[] = [],
    material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
    matrix = new T.Matrix4();
  world.root.updateMatrixWorld(true);
  world.root.traverse((object) => {
    if (!(object instanceof T.InstancedMesh)) return;
    const ids = object.userData.solidIds as (string | null)[] | undefined;
    if (!ids) return;
    ids.forEach((id, i) => {
      if (!id) return;
      object.getMatrixAt(i, matrix);
      const mesh = new T.Mesh(object.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorld.multiplyMatrices(object.matrixWorld, matrix);
      mesh.name = id;
      meshes.push(mesh);
    });
  });
  // Instanced GPU transforms use float32. A 50 micrometre edge tolerance makes
  // coplanar/tangent box rays stable at compound coordinates without concealing
  // any meaningful gap (the disagreement budget is 100 millimetres).
  const boxes = world.level.colliders.map((c) => ({
    id: c.id,
    box: new T.Box3(
      new T.Vector3(c.min.x, c.min.y, c.min.z),
      new T.Vector3(c.max.x, c.max.y, c.max.z),
    ).expandByScalar(0.00005),
  }));
  const min = world.level.bounds.min,
    max = world.level.bounds.max,
    raycaster = new T.Raycaster(),
    point = new T.Vector3(),
    ray = new T.Ray(),
    end = new T.Vector3();
  const mismatches: {
    x: number;
    y: number;
    z: number;
    direction: number[];
    visual: number;
    collision: number;
    visualId?: string;
    colliderId?: string;
  }[] = [];
  let rays = 0,
    lines = 0;
  for (const y of [0.3, 1, 1.7])
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as [number, number][]) {
      const starts: [number, number][] = [];
      if (dx) for (let z = min.z; z <= max.z; z++) starts.push([min.x, z]);
      if (dz)
        for (let x = dx ? min.x + 1 : min.x; x <= max.x; x++)
          starts.push([x, dz > 0 ? min.z : max.z]);
      const direction = new T.Vector3(dx, 0, dz).normalize();
      for (const [x, z] of starts) {
        const origin = new T.Vector3(x, y, z).addScaledVector(direction, -2);
        raycaster.set(origin, direction);
        raycaster.far = 1000;
        ray.set(origin, direction);
        const visual: Interval[] = [],
          collision: Interval[] = [];
        const visualHits: { span: Interval; id: string }[] = [],
          collisionHits: { span: Interval; id: string }[] = [];
        for (const mesh of meshes) {
          if (mesh.geometry.type === 'BoxGeometry') {
            mesh.geometry.computeBoundingBox();
            const bounds = mesh.geometry
              .boundingBox!.clone()
              .applyMatrix4(mesh.matrixWorld)
              .expandByScalar(0.00005);
            if (ray.intersectBox(bounds, point)) {
              const near = point.distanceTo(origin);
              end.copy(origin).addScaledVector(direction, 1000);
              if (
                new T.Ray(end, direction.clone().negate()).intersectBox(
                  bounds,
                  point,
                )
              ) {
                const span: Interval = [near, 1000 - point.distanceTo(end)];
                visual.push(span);
                visualHits.push({ span, id: mesh.name });
              }
            }
            continue;
          }
          const hits: T.Intersection[] = [];
          mesh.raycast(raycaster, hits);
          if (hits.length > 1) {
            hits.sort((a, b) => a.distance - b.distance);
            const span: Interval = [hits[0]!.distance, hits.at(-1)!.distance];
            visual.push(span);
            visualHits.push({ span, id: mesh.name });
          }
        }
        for (const b of boxes) {
          if (!ray.intersectBox(b.box, point)) continue;
          // Opposite ray supplies the far face, including rays starting inside.
          const near = point.distanceTo(origin);
          end.copy(origin).addScaledVector(direction, 1000);
          const reverse = new T.Ray(end, direction.clone().negate());
          if (reverse.intersectBox(b.box, point)) {
            const span: Interval = [near, 1000 - point.distanceTo(end)];
            collision.push(span);
            collisionHits.push({ span, id: b.id });
          }
        }
        const a = union(visual),
          b = union(collision),
          stride = Math.hypot(dx, dz);
        for (let n = 0; ; n++) {
          const xx = x + dx * n,
            zz = z + dz * n;
          if (xx > max.x || zz > max.z || zz < min.z) break;
          const va = distances(2 + n * stride, a),
            co = distances(2 + n * stride, b);
          // An origin in the permitted inset skin is on the same surface. Compare
          // its nearest boundary in either direction before measuring outward rays.
          if (va[0] === 0 && Math.min(...co) <= 0.1) co[0] = co[1] = 0;
          if (co[0] === 0 && Math.min(...va) <= 0.1) va[0] = va[1] = 0;
          for (let side = 0; side < 2; side++) {
            rays++;
            const vv = va[side]!,
              cc = co[side]!;
            if (vv !== cc && Math.abs(vv - cc) > 0.10001)
              mismatches.push({
                x: xx,
                y,
                z: zz,
                direction: [dx * (side ? -1 : 1), dz * (side ? -1 : 1)],
                visual: Number.isFinite(vv) ? vv : -1,
                collision: Number.isFinite(cc) ? cc : -1,
                visualId: visualHits.find(
                  (h) =>
                    Math.abs(distances(2 + n * stride, [h.span])[side]! - vv) <
                    1e-4,
                )?.id,
                colliderId: collisionHits.find(
                  (h) =>
                    Math.abs(distances(2 + n * stride, [h.span])[side]! - cc) <
                    1e-4,
                )?.id,
              });
          }
        }
        if (++lines % 40 === 0)
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  material.dispose();
  return { rays, lines, meshCount: meshes.length, mismatches };
}
