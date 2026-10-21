import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  forgeAsset,
  type Primitive,
  type Recipe,
  type Part,
} from '../../shared/src/forge-data';
export const RECIPES: Record<
  Recipe,
  {
    surface: 'metal' | 'glass' | 'wood' | 'concrete' | 'brick';
    color: string;
    roughness: number;
  }
> = {
  steel: { surface: 'metal', color: '#4b5559', roughness: 0.78 },
  rust: { surface: 'metal', color: '#574b40', roughness: 0.93 },
  galvanized: { surface: 'metal', color: '#727b7d', roughness: 0.6 },
  iron: { surface: 'metal', color: '#293239', roughness: 0.85 },
  rubber: { surface: 'metal', color: '#202628', roughness: 0.98 },
  glass: { surface: 'glass', color: '#344950', roughness: 0.28 },
  concrete: { surface: 'concrete', color: '#737977', roughness: 0.94 },
  brick: { surface: 'brick', color: '#5a5048', roughness: 0.9 },
  wood: { surface: 'wood', color: '#60574a', roughness: 0.91 },
  tarp: { surface: 'wood', color: '#4c5b59', roughness: 0.88 },
  pale: { surface: 'metal', color: '#c6ccca', roughness: 0.67 },
};
/** Unit primitives all have automatic UVs, ready for the existing PBR maps. */
export function primitive(shape: Primitive, lod = 0): T.BufferGeometry {
  if (shape === 'cabin') {
    const geometry = new T.BoxGeometry(),
      positions = geometry.attributes.position!;
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) > 0) {
        positions.setX(i, positions.getX(i) * 0.84);
        positions.setZ(i, positions.getZ(i) * 0.72);
      }
    geometry.computeVertexNormals();
    return geometry;
  }
  if (shape === 'bevel')
    return lod
      ? new T.BoxGeometry()
      : new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
  if (shape === 'cylinder')
    return new T.CylinderGeometry(0.5, 0.5, 1, lod ? 6 : 12);
  if (shape === 'tube') {
    const section = [
      new T.Vector2(0.4, -0.5),
      new T.Vector2(0.5, -0.5),
      new T.Vector2(0.5, 0.5),
      new T.Vector2(0.4, 0.5),
      new T.Vector2(0.4, -0.5),
    ];
    return new T.LatheGeometry(section, lod ? 6 : 12);
  }
  if (shape === 'lathe')
    return new T.LatheGeometry(
      [
        new T.Vector2(0, -0.5),
        new T.Vector2(0.4, -0.5),
        new T.Vector2(0.5, -0.38),
        new T.Vector2(0.5, 0.25),
        new T.Vector2(0.32, 0.48),
        new T.Vector2(0, 0.5),
      ],
      lod ? 6 : 12,
    );
  return new T.BoxGeometry();
}
export function partMatrix(part: Part) {
  const r = part.rotation;
  return new T.Matrix4().compose(
    new T.Vector3(part.position.x, part.position.y, part.position.z),
    new T.Quaternion().setFromEuler(
      new T.Euler(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0),
    ),
    new T.Vector3(part.size.x, part.size.y, part.size.z),
  );
}
export function mirrored(parts: Part[], axis: 'x' | 'z'): Part[] {
  return parts.flatMap((p) => [
    p,
    { ...p, position: { ...p.position, [axis]: -p.position[axis] } },
  ]);
}
export function arrayParts(
  parts: Part[],
  count: number,
  offset: T.Vector3,
): Part[] {
  return Array.from({ length: count }, (_, i) =>
    parts.map((p) => ({
      ...p,
      position: {
        x: p.position.x + offset.x * i,
        y: p.position.y + offset.y * i,
        z: p.position.z + offset.z * i,
      },
    })),
  ).flat();
}
export function extrudePath(points: T.Vector3[], radius = 0.04, segments = 24) {
  return new T.TubeGeometry(
    new T.CatmullRomCurve3(points),
    segments,
    radius,
    6,
    false,
  );
}
export function panelCutout(
  width: number,
  height: number,
  holeWidth: number,
  holeHeight: number,
  depth = 0.1,
) {
  const shape = new T.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const hole = new T.Path();
  hole.moveTo(-holeWidth / 2, 0.1);
  hole.lineTo(-holeWidth / 2, holeHeight);
  hole.lineTo(holeWidth / 2, holeHeight);
  hole.lineTo(holeWidth / 2, 0.1);
  hole.closePath();
  shape.holes.push(hole);
  return new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}
export function forgeModel(key: string, variant = 0, seed = 71017, lod = 0) {
  const data = forgeAsset(key, variant, seed, lod),
    root = new T.Group(),
    byRecipe = new Map<Recipe, T.BufferGeometry[]>();
  for (const part of data.parts) {
    const geometry = primitive(part.shape, lod).applyMatrix4(partMatrix(part));
    const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
    if (normalized !== geometry) geometry.dispose();
    const list = byRecipe.get(part.recipe) ?? [];
    list.push(normalized);
    byRecipe.set(part.recipe, list);
  }
  for (const [recipe, geos] of byRecipe) {
    const geometry = mergeGeometries(geos)!;
    geos.forEach((g) => g.dispose());
    const material = new T.MeshStandardMaterial({
      color: RECIPES[recipe].color,
      roughness: RECIPES[recipe].roughness,
      metalness: recipe === 'glass' ? 0.3 : recipe === 'rubber' ? 0 : 0.35,
    });
    material.userData.recipe = recipe;
    root.add(new T.Mesh(geometry, material));
  }
  root.name = `${key}/${variant}/${data.serial}`;
  root.userData = {
    key,
    variant,
    seed,
    serial: data.serial,
    colliders: data.colliders,
  };
  return root;
}
export function disposeForge(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
}
export function triangleCount(root: T.Object3D) {
  let count = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh)
      count +=
        (o.geometry.index?.count ?? o.geometry.attributes.position!.count) / 3;
  });
  return count;
}
