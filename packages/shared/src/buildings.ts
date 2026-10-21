export const ARCHETYPES = [
  'BRICK / SHUTTER',
  'RENDER / STOOP',
  'PANEL / RIBBON',
  'DARK BRICK / BOARDED',
  'CLADDING / GARAGE',
  'BRICK / SHOP',
  'RENDER / IRREGULAR',
  'PANEL / BRICKED',
  'DARK BRICK / BALCONY',
  'CLADDING / WORKSHOP',
] as const;
export const ROOFS = [
  'flat',
  'pitched',
  'sawtooth',
  'stepped',
  'collapsed',
] as const;
export interface Building {
  id: string;
  side: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  floors: number;
  roof: (typeof ROOFS)[number];
  archetype: number;
  damage: number;
}
export function buildings(seed: number): Building[] {
  // Separate permutations guarantee asymmetry; seed changes texture/detail damage.
  return [-1, 1].flatMap((side) => {
    let z = 70;
    return Array.from({ length: 6 }, (_, i) => {
      const archetype = (i + (side === 1 ? 3 : 0)) % 10;
      const width = [8, 11, 6, 14, 9, 16, 7, 12][
        (i + (side === 1 ? 3 : 0)) % 8
      ]!;
      const floors = 4 + ((i * 3 + (side === 1 ? 2 : 0)) % 5);
      const b: Building = {
        id: `row-${side}-${i}`,
        side,
        x: side * (10 + 8),
        z: z - width / 2,
        width,
        depth: 16,
        height: floors * 3.6,
        floors,
        roof: ROOFS[(i + (side === 1 ? 2 : 0)) % 5]!,
        archetype,
        damage: ((seed + i * 73 + (side + 1) * 19) % 100) / 100,
      };
      z -= width + 2.5;
      return b;
    });
  });
}
