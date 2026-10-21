import type { Box, World } from './types';
/** Immutable XZ broadphase. Stable original indices preserve narrowphase ordering. */
export function spatialWorld(
  floor: number,
  boxes: readonly Box[],
  cell = 8,
): World {
  const grid = new Map<string, number[]>();
  boxes.forEach((b, index) => {
    for (
      let x = Math.floor(b.min.x / cell);
      x <= Math.floor(b.max.x / cell);
      x++
    )
      for (
        let z = Math.floor(b.min.z / cell);
        z <= Math.floor(b.max.z / cell);
        z++
      ) {
        const key = `${x},${z}`,
          bucket = grid.get(key) ?? [];
        bucket.push(index);
        grid.set(key, bucket);
      }
  });
  return {
    floor,
    boxes,
    query(minX, minZ, maxX, maxZ) {
      const found = new Set<number>();
      for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++)
        for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++)
          for (const index of grid.get(`${x},${z}`) ?? []) found.add(index);
      return [...found].sort((a, b) => a - b).map((i) => boxes[i]!);
    },
  };
}
