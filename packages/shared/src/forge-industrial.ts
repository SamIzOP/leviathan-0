import type { Part, Primitive, Recipe } from './forge-data';
export const INDUSTRIAL_FAMILIES = [
  'cooling-tower',
  'gas-holder',
  'signal-tower',
  'ore-bridge',
  'furnace',
  'vault-roof',
  'sawtooth-roof',
  'sag-cable',
  'curved-pipe',
  'arched-tunnel',
  'freight-car',
  'collapsed-overpass',
  'silo',
  'ladle',
  'slag-pot',
  'pump-house',
  'forklift',
  'cart',
  'scaffold',
  'tarpaulin',
  'workstation',
  'locker',
  'broken-container',
  'open-container',
  'substation',
  'rubble',
] as const;
/** Human-scale authored assemblies; variants alter structure, not just a colour. */
export function industrialParts(
  key: string,
  variant: number,
  seed: number,
  lod: number,
): Part[] | undefined {
  if (!(INDUSTRIAL_FAMILIES as readonly string[]).includes(key)) return;
  const p: Part[] = [],
    w = 1 + (variant - 1) * 0.13;
  const a = (
    shape: Primitive,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    recipe: Recipe = 'steel',
    detail = false,
    rotation?: { x: number; y: number; z: number },
  ) => {
    if (detail && lod) return;
    p.push({
      shape,
      position: { x, y, z },
      size: { x: sx, y: sy, z: sz },
      recipe,
      detail,
      rotation,
      collision: detail ? 'decor' : 'solid',
    });
  };
  const beam = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => a('box', x, y, z, sx, sy, sz, 'iron');
  const ring = (y: number, r: number) =>
    a('tube', 0, y, 0, r, 0.14, r, 'galvanized');
  if (
    [
      'cooling-tower',
      'silo',
      'gas-holder',
      'furnace',
      'slag-pot',
      'ladle',
    ].includes(key)
  ) {
    const h =
        key === 'cooling-tower'
          ? 24
          : key === 'gas-holder'
            ? 18
            : key === 'silo'
              ? 14
              : key === 'furnace'
                ? 12
                : 2.5,
      r =
        key === 'gas-holder'
          ? 14
          : key === 'cooling-tower'
            ? 16
            : key === 'silo'
              ? 6
              : key === 'furnace'
                ? 7
                : 3;
    a(
      key === 'cooling-tower'
        ? 'cooling'
        : key === 'slag-pot' || key === 'ladle'
          ? 'lathe'
          : 'cylinder',
      0,
      h / 2,
      0,
      r * w,
      h,
      r * w,
      key === 'cooling-tower' ? 'concrete' : variant === 2 ? 'rust' : 'steel',
    );
    for (let y = 1; y < h; y += h / 5) {
      ring(y, r * w + 0.15);
      if (key === 'gas-holder')
        for (let i = 0; i < 12; i++) {
          const t = (i * Math.PI) / 6;
          beam(
            Math.sin(t) * (r / 2 + 0.4),
            h / 2,
            Math.cos(t) * (r / 2 + 0.4),
            0.18,
            h,
            0.18,
          );
        }
    }
    for (let y = 0.4; y < h; y += 0.6) {
      beam(0, y, (r * w) / 2 + 0.2, 0.8, 0.05, 0.1);
      if (lod && y % 2 > 0.6) continue;
    }
    for (const x of [-0.45, 0.45])
      beam(x, h / 2, (r * w) / 2 + 0.2, 0.08, h, 0.12);
    if (key === 'furnace') {
      a('arch', 0, 3, r / 2 + 0.05, 4, 5, 0.3, 'iron');
      a('box', 0, 2, r / 2 + 0.1, 2, 2, 0.08, 'rust');
      a('cylinder', 1, h + 6, 0, 2, 12, 2, 'iron');
    }
  } else if (['ore-bridge', 'collapsed-overpass', 'scaffold'].includes(key)) {
    const length = key === 'scaffold' ? 8 : 30,
      height = key === 'scaffold' ? 9 : 12;
    for (const x of [-length / 2 + 1, length / 2 - 1])
      for (const z of [-2, 2]) beam(x, height / 2, z, 0.5, height, 0.5);
    for (const y of [height - 3, height]) {
      beam(0, y, 0, length, 0.3, 5);
      for (const z of [-2.4, 2.4]) {
        beam(0, y + 2, z, length, 0.2, 0.2);
        for (let x = -length / 2; x < length / 2; x += 3)
          a('box', x, y + 1, z, 0.15, 3, 0.15, 'rust', false, {
            x: 0,
            y: 0,
            z: 0.75,
          });
      }
    }
    if (key === 'collapsed-overpass')
      a('box', 3, height + 1, 0, 9, 0.4, 5, 'concrete', false, {
        x: 0.06,
        y: 0.08,
        z: 0.24,
      });
  } else if (key === 'signal-tower') {
    for (const x of [-2, 2])
      for (const z of [-2, 2]) beam(x, 10, z, 0.35, 20, 0.35);
    for (let y = 2; y < 20; y += 4)
      for (const z of [-2, 2])
        a('box', 0, y, z, 0.18, 5.5, 0.18, 'rust', false, {
          x: 0,
          y: 0,
          z: 0.7,
        });
    a('cabin', 0, 21, 0, 6, 4, 5, 'concrete');
    a('box', 0, 22, 2.53, 4, 1.8, 0.06, 'glass');
    a('gable', 0, 24, 0, 7, 2, 6, 'iron');
    a('cylinder', 0, 22, -2.6, 2, 0.15, 2, 'pale', false, {
      x: Math.PI / 2,
      y: 0,
      z: 0,
    });
  } else if (['vault-roof', 'sawtooth-roof', 'arched-tunnel'].includes(key)) {
    a(
      key === 'vault-roof' || key === 'arched-tunnel' ? 'arch' : 'gable',
      0,
      3,
      0,
      12,
      6,
      8,
      'steel',
    );
    for (let z = -3.9; z <= 3.9; z += 1)
      a('arch', 0, 3, z, 12.08, 6.08, 0.12, 'rust', true);
  } else if (key === 'sag-cable' || key === 'curved-pipe') {
    a(
      'sag',
      0,
      0.5,
      0,
      5,
      key === 'sag-cable' ? 1 : 2,
      0.12,
      key === 'sag-cable' ? 'rubber' : 'steel',
    );
    if (key === 'curved-pipe')
      for (const x of [-2.4, 2.4])
        a('cylinder', x, 1, 0, 0.3, 0.12, 0.3, 'rust', false, {
          x: 0,
          y: 0,
          z: Math.PI / 2,
        });
  } else if (
    key === 'freight-car' ||
    key === 'open-container' ||
    key === 'broken-container'
  ) {
    const len = key === 'freight-car' ? 14 : 12;
    beam(0, 0.5, 0, len, 0.3, 3);
    for (const z of [-1.5, 1.5])
      a('box', 0, 2, z, len, 3, 0.15, variant === 2 ? 'rust' : 'steel');
    for (let x = -len / 2; x < len / 2; x += 1.3)
      for (const z of [-1.6, 1.6])
        a('box', x, 2, z, 0.07, 3, 0.08, 'iron', false);
    if (key !== 'open-container')
      a(
        'box',
        0,
        3.6,
        0,
        len,
        0.12,
        3,
        'rust',
        false,
        key === 'broken-container' ? { x: 0, y: 0.04, z: 0.09 } : undefined,
      );
    if (key === 'freight-car')
      for (const x of [-5, 5])
        for (const z of [-1.5, 1.5])
          a('cylinder', x, 0.45, z, 0.9, 0.3, 0.9, 'iron', false, {
            x: Math.PI / 2,
            y: 0,
            z: 0,
          });
  } else if (key === 'rubble') {
    for (let i = 0; i < 12; i++) {
      const r = ((seed + i * 131) % 997) / 997;
      a(
        'cabin',
        Math.sin(i * 2.4) * r,
        Math.max(0.1, 0.8 - i * 0.05),
        Math.cos(i * 2.4) * r,
        0.3 + r,
        0.3 + r * 0.4,
        0.4 + r,
        'concrete',
        false,
        { x: r * 0.3, y: r, z: r * 0.4 },
      );
    }
  } else {
    const h =
      key === 'locker'
        ? 2.1
        : key === 'pump-house'
          ? 4
          : key === 'substation'
            ? 3
            : 1;
    a(
      'bevel',
      0,
      h / 2,
      0,
      key === 'pump-house' ? 6 : 1.8 * w,
      h,
      key === 'pump-house' ? 5 : 1.2,
      'steel',
    );
    if (key === 'pump-house') a('gable', 0, h + 1, 0, 6.4, 2, 5.4, 'rust');
    else if (key === 'forklift') {
      beam(0.5, 2, 0.5, 0.2, 4, 0.2);
      beam(0.5, 0.2, 1.7, 0.2, 0.2, 2.5);
      a('cabin', -0.4, 1.3, 0, 1.1, 1, 1, 'iron');
    } else if (key === 'tarpaulin') a('gable', 0, 1.2, 0, 2.3, 1, 1.8, 'tarp');
    else if (key === 'workstation')
      a('box', 0, 1.4, -0.4, 0.7, 0.6, 0.1, 'glass');
    else if (key === 'substation')
      for (const x of [-0.6, 0, 0.6])
        a('lathe', x, 2.9, 0, 0.25, 1, 0.25, 'pale');
    for (let i = 0; i < 5; i++)
      a('box', -0.6 + i * 0.3, h * 0.7, 0.62, 0.06, 0.2, 0.03, 'iron', true);
  }
  return p;
}
