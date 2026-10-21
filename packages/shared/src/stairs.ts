import type { Box, Vec3 } from './types';
/** Shared forge stair recipe. Exact treads are the authoritative collision too. */
export function stairRun(
  height: number,
  width = 2.4,
  base = 0,
  tread = 0.29,
): Box[] {
  const count = Math.max(1, Math.round(height / 0.18)),
    rise = height / count;
  return Array.from({ length: count }, (_, i) => ({
    min: { x: -width / 2, y: base + i * rise, z: i * tread },
    max: { x: width / 2, y: base + (i + 1) * rise, z: (i + 1) * tread },
  }));
}
export function placeStairs(
  boxes: Box[],
  origin: Vec3,
  axis: 'x' | 'z' = 'z',
  direction = 1,
): Box[] {
  return boxes.map((b) => {
    const a = axis === 'z' ? b.min : { x: b.min.z, y: b.min.y, z: b.min.x };
    const c = axis === 'z' ? b.max : { x: b.max.z, y: b.max.y, z: b.max.x };
    const first = { ...a },
      last = { ...c };
    first[axis] *= direction;
    last[axis] *= direction;
    return {
      min: {
        x: origin.x + Math.min(first.x, last.x),
        y: origin.y + a.y,
        z: origin.z + Math.min(first.z, last.z),
      },
      max: {
        x: origin.x + Math.max(first.x, last.x),
        y: origin.y + c.y,
        z: origin.z + Math.max(first.z, last.z),
      },
    };
  });
}
