import type { Box, Vec3 } from './types';
import { stairRun } from './stairs';
import { INDUSTRIAL_FAMILIES, industrialParts } from './forge-industrial';
export type Recipe =
  | 'steel'
  | 'rust'
  | 'galvanized'
  | 'iron'
  | 'rubber'
  | 'glass'
  | 'concrete'
  | 'brick'
  | 'wood'
  | 'tarp'
  | 'pale';
export type Primitive =
  | 'box'
  | 'bevel'
  | 'cylinder'
  | 'cylinderZ'
  | 'tube'
  | 'lathe'
  | 'cabin'
  | 'cooling'
  | 'arch'
  | 'gable'
  | 'sag';
export interface Part {
  shape: Primitive;
  position: Vec3;
  size: Vec3;
  recipe: Recipe;
  rotation?: Vec3;
  detail?: boolean;
  collision?: 'solid' | 'decor';
}
export interface ForgeAsset {
  key: string;
  seed: number;
  variant: number;
  parts: Part[];
  colliders: Box[];
  serial: string;
  large: boolean;
}
export const FORGE_CATALOG = [
  ...INDUSTRIAL_FAMILIES,
  'container',
  'crate',
  'pallet',
  'barrel',
  'drum',
  'gas-cylinder',
  'dumpster',
  'bollard',
  'barrier',
  'concrete-block',
  'jersey-barrier',
  'tire',
  'debris',
  'wheelie-bin',
  'pipe',
  'valve',
  'manifold',
  'tank',
  'vat',
  'boiler',
  'duct',
  'vent',
  'electrical-cabinet',
  'cable-tray',
  'transformer',
  'generator',
  'conveyor',
  'hopper',
  'press',
  'forge',
  'furnace-door',
  'chain',
  'hook',
  'catwalk',
  'railing',
  'ladder',
  'stair-run',
  'gantry',
  'overhead-crane',
  'gantry-crane',
  'truss',
  'pillar',
  'blast-door',
  'roller-shutter',
  'gate',
  'chain-link-fence',
  'floodlight',
  'lamp-post',
  'power-pole',
  'sign',
  'sedan',
  'hatchback',
  'pickup',
  'small-truck',
  'van',
  'sedan-wreck',
  'hatchback-wreck',
  'pickup-wreck',
  'small-truck-wreck',
  'van-wreck',
  'water-tower',
  'smokestack',
  'chimney',
] as const;
export type ForgeKey = (typeof FORGE_CATALOG)[number];
export function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
export function forgeAsset(
  key: string,
  variant = 0,
  seed = 71017,
  lod = 0,
): ForgeAsset {
  key = key.replace('prop.', '');
  if (key === 'car') key = 'sedan';
  if (!FORGE_CATALOG.includes(key as ForgeKey))
    throw new Error('Unknown forge asset: ' + key);
  const random = seeded(seed + variant * 107),
    parts: Part[] = [];
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const add = (
    shape: Primitive,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    recipe: Recipe = 'steel',
    detail = false,
    rotation?: Vec3,
  ) => {
    if (detail && lod > 0) return;
    parts.push({
      shape,
      position: v(x, y, z),
      size: v(w, h, d),
      recipe,
      detail,
      collision: detail ? 'decor' : 'solid',
      ...(rotation ? { rotation } : {}),
    });
  };
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    recipe: Recipe = 'steel',
    detail = false,
  ) => add('box', x, y, z, w, h, d, recipe, detail);
  const cylinder = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    recipe: Recipe = 'iron',
  ) => add('cylinder', x, y, z, w, h, w, recipe);
  const rail = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => box(x, y, z, w, h, d, 'galvanized');
  const ribs = (
    w: number,
    h: number,
    d: number,
    count: number,
    recipe: Recipe = 'rust',
  ) => {
    for (let i = 0; i < count; i++)
      for (const side of [-1, 1])
        box(
          (side * w) / 2,
          h / 2,
          -d / 2 + ((i + 0.5) * d) / count,
          0.05,
          h,
          0.05,
          recipe,
          true,
        );
  };
  const panel = (w: number, h: number, d: number, recipe: Recipe = 'steel') => {
    add('bevel', 0, h / 2, 0, w, h, d, recipe);
    for (const x of [-1, 1])
      for (const y of [0.12, h - 0.12])
        cylinder(x * (w / 2 - 0.1), y, d / 2, 0.06, 0.045, 'rust');
    for (let i = 0; i < 5; i++)
      box(
        -w * 0.25 + i * w * 0.125,
        h * 0.68,
        d / 2 + 0.012,
        0.035,
        h * 0.22,
        0.025,
        'iron',
        true,
      );
    box(0, h * 0.35, d / 2 + 0.02, w * 0.7, 0.025, 0.025, 'iron', true);
  };
  const legs = (w: number, h: number, d: number) => {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        rail((x * w) / 2, h / 2, (z * d) / 2, 0.15, h, 0.15);
  };
  const ladder = (height: number, x = 0, z = 0) => {
    for (const side of [-1, 1])
      rail(x + side * 0.35, height / 2, z, 0.07, height, 0.08);
    for (let y = 0.3; y < height; y += 0.3) rail(x, y, z, 0.7, 0.05, 0.07);
  };
  const vehicle = /^(sedan|hatchback|pickup|small-truck|van)(-wreck)?$/.test(
    key,
  );
  const large =
    (INDUSTRIAL_FAMILIES as readonly string[]).includes(key) ||
    [
      'tank',
      'vat',
      'boiler',
      'gantry',
      'overhead-crane',
      'gantry-crane',
      'water-tower',
      'smokestack',
      'stair-run',
    ].includes(key);
  const industrial = industrialParts(key, variant, seed, lod);
  if (industrial) parts.push(...industrial);
  else if (vehicle) {
    const base = key.replace('-wreck', ''),
      wreck = key.endsWith('-wreck');
    const width = base === 'small-truck' ? 2.3 : base === 'van' ? 2.1 : 1.8;
    const length =
      base === 'hatchback'
        ? 3.7
        : base === 'small-truck'
          ? 6.2
          : base === 'van'
            ? 5.2
            : 4.5;
    const height =
      base === 'van'
        ? 2.6
        : base === 'small-truck'
          ? 2.8
          : base === 'pickup'
            ? 1.8
            : 1.5;
    const paint: Recipe =
      base === 'van' && !wreck ? 'pale' : variant === 1 ? 'rust' : 'steel';
    add('bevel', 0, 0.65, 0, width, 0.65, length, paint);
    const cabZ =
      base === 'pickup' || base === 'small-truck' ? -length * 0.22 : 0;
    const cabLength =
      base === 'van'
        ? length * 0.9
        : base === 'hatchback'
          ? length * 0.65
          : length * 0.43;
    add(
      base === 'van' ? 'bevel' : 'cabin',
      wreck ? 0.12 : 0,
      (height + 0.95) / 2,
      cabZ,
      width * 0.88,
      height - 0.95,
      cabLength,
      paint,
    );
    for (const side of [-1, 1]) {
      add(
        'box',
        side * width * (base === 'van' ? 0.446 : 0.415),
        height * 0.76,
        base === 'van' ? -cabLength * 0.32 : cabZ,
        0.025,
        height * 0.22,
        cabLength * (base === 'van' ? 0.2 : 0.65),
        wreck ? 'iron' : 'glass',
        false,
        v(0, 0, base === 'van' ? 0 : -side * 0.12),
      );
      for (const end of [-1, 1]) {
        add(
          'cylinder',
          side * (width / 2 - 0.1),
          0.34,
          end * length * 0.32,
          0.68,
          0.23,
          0.68,
          'rubber',
          false,
          v(0, 0, Math.PI / 2),
        );
        add(
          'cylinder',
          side * (width / 2 + 0.02),
          0.34,
          end * length * 0.32,
          0.38,
          0.03,
          0.38,
          'galvanized',
          true,
          v(0, 0, Math.PI / 2),
        );
        box(
          side * width * 0.3,
          0.7,
          end * (length / 2 + 0.01),
          0.3,
          0.13,
          0.035,
          end < 0 ? 'glass' : 'rust',
          true,
        );
      }
      for (let i = 0; i < 2; i++) {
        box(
          side * (width / 2 + 0.01),
          0.85,
          -0.4 + i * 0.8,
          0.025,
          0.03,
          0.2,
          'iron',
          true,
        );
        box(
          side * (width / 2 + 0.015),
          0.72,
          -0.7 + i * 1.3,
          0.02,
          0.55,
          0.015,
          'iron',
          true,
        );
      }
    }
    for (const end of [-1, 1]) {
      add(
        'box',
        0,
        height * 0.76,
        cabZ + end * cabLength * (base === 'van' ? 0.505 : 0.44),
        width * 0.73,
        height * 0.22,
        0.025,
        wreck ? 'iron' : 'glass',
        false,
        v(base === 'van' ? 0 : end * 0.22, 0, 0),
      );
      box(0, 0.4, (end * length) / 2, width, 0.16, 0.08, 'rubber');
    }
    if (base === 'van') {
      // Split rear doors and exposed glazing prevent a blank cargo-box silhouette.
      box(
        0,
        height * 0.66,
        cabLength * 0.505,
        0.025,
        height * 0.62,
        0.025,
        'iron',
        true,
      );
      for (const side of [-1, 1]) {
        box(
          side * 0.16,
          height * 0.55,
          cabLength * 0.51,
          0.19,
          0.04,
          0.035,
          'iron',
          true,
        );
        for (const y of [1.15, height - 0.22])
          box(
            side * width * 0.4,
            y,
            cabLength * 0.51,
            0.14,
            0.065,
            0.035,
            'galvanized',
            true,
          );
      }
    }
    if (base === 'pickup' || base === 'small-truck') {
      box(0, 1, length * 0.3, width * 0.9, 0.12, length * 0.32, 'wood');
      for (const side of [-1, 1])
        box(
          side * width * 0.47,
          1.25,
          length * 0.3,
          0.08,
          0.6,
          length * 0.35,
          paint,
        );
    }
    if (wreck)
      for (let i = 0; i < 6; i++)
        add(
          'bevel',
          (random() - 0.5) * width,
          0.15,
          (random() - 0.5) * length,
          0.35,
          0.18,
          0.4,
          'rust',
          false,
          v(0, random() * 3, 0),
        );
  } else if (key === 'container') {
    box(0, 1.3, 0, 2.44, 2.6, 12.2, variant === 1 ? 'rust' : 'steel');
    ribs(2.46, 2.48, 12, 32);
    for (const z of [-6.11, 6.11])
      for (const x of [-0.8, -0.35, 0.35, 0.8]) {
        rail(x, 1.3, z, 0.055, 2.35, 0.055);
        box(x, 1.2, z + 0.03, 0.22, 0.06, 0.06, 'iron', true);
      }
    for (const y of [0.06, 2.54])
      for (const x of [-1.2, 1.2]) rail(x, y, 0, 0.1, 0.12, 12.2);
  } else if (key === 'crate' || key === 'pallet') {
    const h = key === 'pallet' ? 0.16 : 1.2;
    for (let i = 0; i < 6; i++)
      box(-0.5 + i * 0.2, h, 0, 0.18, 0.08, 1.2, 'wood');
    for (const x of [-0.45, 0.45]) box(x, h / 2, 0, 0.12, h, 1.2, 'wood');
    if (key === 'crate') {
      box(0, 0.55, 0, 1.2, 1.1, 1.2, 'wood');
      for (const side of [-1, 1])
        for (const y of [0.15, 1])
          box(0, y, side * 0.62, 1.3, 0.12, 0.06, 'wood');
      ribs(1.24, 1.2, 1.2, 4, 'wood');
    }
  } else if (
    [
      'barrel',
      'drum',
      'gas-cylinder',
      'tank',
      'vat',
      'boiler',
      'water-tower',
      'smokestack',
      'chimney',
    ].includes(key)
  ) {
    const dims: Record<string, [number, number]> = {
      barrel: [0.6, 0.9],
      drum: [0.65, 1],
      'gas-cylinder': [0.3, 1.5],
      tank: [4, 6],
      vat: [5, 3],
      boiler: [5, 9],
      'water-tower': [10, 32],
      smokestack: [5, 95],
      chimney: [1, 3],
    };
    const [w, h] = dims[key]!;
    if (key === 'water-tower') {
      legs(7, 25, 7);
      cylinder(0, 28.5, 0, 10, 7, 'rust');
      for (let y = 4; y < 24; y += 5)
        for (const side of [-1, 1])
          add(
            'box',
            side * 3.5,
            y,
            0,
            0.1,
            0.12,
            8,
            'steel',
            false,
            v(0.6, 0, 0),
          );
      ladder(31, -3.6, 3.5);
    } else {
      add(
        key === 'gas-cylinder' ? 'lathe' : 'cylinder',
        0,
        h / 2,
        0,
        w,
        h,
        w,
        key === 'smokestack' || key === 'chimney' ? 'brick' : 'rust',
      );
      const count = key === 'smokestack' ? 9 : 2;
      for (let i = 0; i < count; i++)
        add(
          'tube',
          0,
          (h * (i + 0.5)) / count,
          0,
          w * 1.04,
          0.08,
          w * 1.04,
          'iron',
        );
      if (key === 'smokestack') ladder(h, 0, w / 2 + 0.12);
      if (['boiler', 'tank', 'vat'].includes(key)) {
        cylinder(w * 0.6, 0.8, 0, 0.5, 1.6);
        box(0, 1, w / 2 + 0.08, 1, 1, 0.15, 'iron');
      }
      if (key === 'gas-cylinder') {
        cylinder(0, h + 0.08, 0, 0.08, 0.16);
        add('tube', 0, h + 0.16, 0, 0.24, 0.1, 0.24, 'steel');
      }
    }
  } else if (
    ['pipe', 'valve', 'manifold', 'duct', 'vent', 'cable-tray'].includes(key)
  ) {
    if (key === 'pipe' || key === 'manifold' || key === 'valve') {
      add('tube', 0, 1, 0, 0.4, 2, 0.4, 'rust', false, v(Math.PI / 2, 0, 0));
      for (const z of [-0.95, 0.95])
        add(
          'tube',
          0,
          1,
          z,
          0.55,
          0.08,
          0.55,
          'iron',
          false,
          v(Math.PI / 2, 0, 0),
        );
      if (key !== 'pipe') {
        cylinder(0, 1.3, 0, 0.1, 0.6);
        add('tube', 0, 1.65, 0, 0.7, 0.06, 0.7, 'rust');
      }
      if (key === 'manifold')
        for (const x of [-0.6, 0.6]) {
          box(x, 1, 0, 1.2, 0.14, 0.14);
          cylinder(x, 1.35, 0, 0.18, 0.6);
        }
    } else {
      panel(1, 0.8, 2, 'galvanized');
      for (let i = 0; i < 10; i++)
        box(0, 0.82, -0.9 + i * 0.2, 0.9, 0.04, 0.04, 'iron', true);
    }
  } else if (
    [
      'dumpster',
      'wheelie-bin',
      'electrical-cabinet',
      'transformer',
      'generator',
      'press',
      'forge',
      'hopper',
    ].includes(key)
  ) {
    const w = key === 'wheelie-bin' ? 0.6 : key === 'dumpster' ? 2 : 1.7,
      h = key === 'press' ? 4 : key === 'wheelie-bin' ? 1 : 2;
    panel(w, h, 1.2, variant === 2 ? 'rust' : 'steel');
    box(0, h + 0.06, 0, w * 1.04, 0.12, 1.28, 'iron');
    if (key === 'transformer')
      for (const x of [-0.5, 0, 0.5]) {
        cylinder(x, h + 0.35, 0, 0.22, 0.6, 'rubber');
        add('tube', x, h + 0.5, 0, 0.32, 0.08, 0.32, 'iron');
      }
    if (key === 'generator') cylinder(0, h / 2, 0.85, 0.8, 0.8);
    if (key === 'press' || key === 'forge') {
      legs(w + 1, h, 1.2);
      box(0, 0.25, 0.9, w, 0.3, 1.4, 'iron');
    }
    if (key === 'hopper') add('lathe', 0, h + 0.5, 0, w, 1, w, 'rust');
    if (key === 'dumpster' || key === 'wheelie-bin')
      for (const x of [-w * 0.4, w * 0.4])
        add(
          'cylinder',
          x,
          0.12,
          0.5,
          0.24,
          0.08,
          0.24,
          'rubber',
          false,
          v(0, 0, Math.PI / 2),
        );
  } else if (
    [
      'bollard',
      'barrier',
      'concrete-block',
      'jersey-barrier',
      'tire',
      'debris',
    ].includes(key)
  ) {
    if (key === 'tire')
      add(
        'tube',
        0,
        0.32,
        0,
        0.64,
        0.24,
        0.64,
        'rubber',
        false,
        v(Math.PI / 2, 0, 0),
      );
    else if (key === 'bollard') {
      cylinder(0, 0.5, 0, 0.2, 1);
      cylinder(0, 0.05, 0, 0.4, 0.1);
    } else if (key === 'debris')
      for (let i = 0; i < 5; i++)
        add(
          'bevel',
          (random() - 0.5) * 1.5,
          0.1 + random() * 0.2,
          (random() - 0.5) * 1.5,
          0.3 + random() * 0.4,
          0.2,
          0.4,
          'concrete',
        );
    else {
      add('bevel', 0, 0.5, 0, 3, 1, 0.7, 'concrete');
      box(0, 0.12, 0, 3.2, 0.24, 1, 'concrete');
    }
  } else if (key === 'stair-run') {
    for (const b of stairRun(3.6))
      box(
        0,
        (b.min.y + b.max.y) / 2,
        (b.min.z + b.max.z) / 2,
        b.max.x - b.min.x,
        b.max.y - b.min.y,
        b.max.z - b.min.z,
        'steel',
      );
    for (let i = 0; i < 7; i++)
      for (const x of [-1.15, 1.15])
        rail(x, i * 0.54 + 0.55, i * 0.87, 0.06, 1.1, 0.06);
    for (const x of [-1.15, 1.15])
      add(
        'box',
        x,
        2.8,
        2.9,
        0.06,
        0.06,
        Math.hypot(3.6, 5.8),
        'galvanized',
        false,
        v(-Math.atan2(3.6, 5.8), 0, 0),
      );
  } else if (
    [
      'catwalk',
      'railing',
      'ladder',
      'truss',
      'pillar',
      'gantry',
      'overhead-crane',
      'gantry-crane',
      'conveyor',
    ].includes(key)
  ) {
    if (key === 'ladder') ladder(6);
    else if (key === 'pillar') {
      box(0, 5, 0, 0.35, 10, 0.35);
      for (const y of [0.08, 9.92]) box(0, y, 0, 0.7, 0.16, 0.7);
    } else {
      const crane = key.includes('crane') || key === 'gantry',
        h = crane
          ? key === 'gantry-crane'
            ? 28
            : 12
          : key === 'conveyor'
            ? 1
            : 1.2;
      const w = crane ? 24 : key === 'railing' ? 4 : 2.4,
        d = crane ? 3 : 6;
      if (crane) legs(w, h, d);
      box(0, h - 0.15, 0, w, 0.3, d, 'steel');
      for (let i = 0; i < 8; i++)
        for (const side of [-1, 1]) {
          if (key === 'conveyor')
            add(
              'cylinder',
              0,
              h,
              -d / 2 + ((i + 0.5) * d) / 8,
              0.2,
              w,
              0.2,
              'iron',
              false,
              v(0, 0, Math.PI / 2),
            );
          else
            rail((side * w) / 2, h + 0.5, -d / 2 + (i * d) / 7, 0.06, 1, 0.06);
        }
      for (const x of [-w / 2, w / 2]) rail(x, h + 1, 0, 0.07, 0.07, d);
      if (crane) {
        panel(1.5, 1.5, 1.5);
        box(0, h - 3, 0, 0.08, 6, 0.08, 'iron');
        add(
          'tube',
          0,
          h - 6,
          0,
          0.7,
          0.12,
          0.7,
          'rust',
          false,
          v(Math.PI / 2, 0, 0),
        );
      }
    }
  } else if (
    [
      'blast-door',
      'furnace-door',
      'roller-shutter',
      'gate',
      'chain-link-fence',
    ].includes(key)
  ) {
    const w = key === 'blast-door' ? 8 : 6,
      h = key === 'blast-door' ? 8 : 3;
    for (const x of [-w / 2, w / 2]) rail(x, h / 2, 0, 0.2, h, 0.2);
    if (key === 'chain-link-fence' || key === 'gate') {
      for (let i = 0; i < 16; i++)
        rail(-w / 2 + (i * w) / 15, h / 2, 0, 0.025, h, 0.025);
      for (let i = 0; i < 8; i++) rail(0, (i * h) / 7, 0, w, 0.025, 0.025);
    } else {
      panel(w, h, 0.4, 'iron');
      for (let i = 0; i < 16; i++)
        box(0, ((i + 0.5) * h) / 16, 0.22, w, 0.04, 0.04, 'rust', true);
    }
  } else if (['floodlight', 'lamp-post', 'power-pole', 'sign'].includes(key)) {
    const h = key === 'sign' ? 2.5 : key === 'floodlight' ? 7 : 10;
    cylinder(0, h / 2, 0, 0.18, h, 'iron');
    if (key === 'sign') panel(2, 1, 0.1, 'rust');
    else {
      box(0, h, 0, 3, 0.18, 0.18);
      for (const x of [-1, 1])
        box(
          x,
          h - 0.15,
          0,
          0.6,
          0.35,
          0.3,
          key === 'power-pole' ? 'rubber' : 'glass',
        );
    }
  } else if (key === 'chain' || key === 'hook') {
    for (let i = 0; i < (key === 'chain' ? 12 : 1); i++)
      add(
        'tube',
        0,
        0.2 + i * 0.24,
        0,
        0.32,
        0.07,
        0.32,
        'iron',
        false,
        v(i % 2 ? Math.PI / 2 : 0, 0, 0),
      );
  }
  // Seeded patched panel / tape; mesh-only, so Node export needs no canvas.
  if (lod === 0 && parts.length && !parts[0]!.rotation) {
    const p = parts[0]!;
    box(
      p.position.x,
      p.position.y,
      p.position.z + p.size.z / 2 + 0.012,
      Math.min(0.25, p.size.x * 0.2),
      0.035,
      0.02,
      variant === 2 ? 'tarp' : 'rust',
      true,
    );
  }
  if (
    lod === 0 &&
    ['container', 'crate', 'electrical-cabinet', 'generator', 'van'].includes(
      key,
    )
  ) {
    const p = parts[0]!,
      digits = String((seed + variant * 137) % 1000).padStart(3, '0');
    const patterns = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
    const segments = [
      [-0.025, 0.08, 0.045, 0.01],
      [0, 0.04, 0.01, 0.07],
      [0, -0.04, 0.01, 0.07],
      [-0.025, -0.08, 0.045, 0.01],
      [-0.05, -0.04, 0.01, 0.07],
      [-0.05, 0.04, 0.01, 0.07],
      [-0.025, 0, 0.045, 0.01],
    ];
    [...digits].forEach((digit, i) =>
      segments.forEach(([x, y, w, h], j) => {
        if (patterns[Number(digit)]! & (1 << j))
          box(
            p.position.x + (i - 1) * 0.09 + x!,
            p.position.y + y!,
            p.position.z + p.size.z / 2 + 0.018,
            w!,
            h!,
            0.015,
            'pale',
            true,
          );
      }),
    );
  }
  // Conservative boxes are derived from non-ornamental primitives, not hand-maintained dimensions.
  const colliders: Box[] = parts
    .filter((p) => !p.detail)
    .map((p) => {
      const points: Vec3[] = [];
      const r = p.rotation ?? v(0, 0, 0);
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            let x = (sx * p.size.x) / 2,
              y = (sy * p.size.y) / 2,
              z = (sz * p.size.z) / 2;
            if (p.shape === 'cabin' && sy > 0) {
              x *= 0.84;
              z *= 0.72;
            }
            [x, y] = [
              x * Math.cos(r.z) - y * Math.sin(r.z),
              x * Math.sin(r.z) + y * Math.cos(r.z),
            ];
            [x, z] = [
              x * Math.cos(r.y) + z * Math.sin(r.y),
              -x * Math.sin(r.y) + z * Math.cos(r.y),
            ];
            [y, z] = [
              y * Math.cos(r.x) - z * Math.sin(r.x),
              y * Math.sin(r.x) + z * Math.cos(r.x),
            ];
            points.push(
              v(x + p.position.x, y + p.position.y, z + p.position.z),
            );
          }
      return {
        min: v(
          ...(['x', 'y', 'z'].map((a) =>
            Math.min(...points.map((p) => p[a as keyof Vec3])),
          ) as [number, number, number]),
        ),
        max: v(
          ...(['x', 'y', 'z'].map((a) =>
            Math.max(...points.map((p) => p[a as keyof Vec3])),
          ) as [number, number, number]),
        ),
      };
    })
    .filter(
      (b) =>
        Math.min(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) >=
        0.05 - 1e-8,
    );
  return {
    key,
    variant,
    seed,
    parts,
    colliders,
    large,
    serial: `KR-${String(seed % 997).padStart(3, '0')}-${variant + 1}`,
  };
}
