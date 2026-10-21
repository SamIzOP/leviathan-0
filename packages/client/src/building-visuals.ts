import type { Level } from '@leviathan/shared';
import { seeded } from '../../shared/src/forge-data';
/** Seeded facade ornaments; the opaque shell is the shared level collider. */
export function facadeDetails(level: Level): Level['decor'] {
  const out: Level['decor'] = [];
  for (const b of level.buildings) {
    const random = seeded(level.seed + b.archetype * 77 + b.width * 13);
    const face = b.side * 9.96;
    const add = (
      name: string,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      surface: Level['decor'][number]['surface'] = 'metal',
      color?: string,
      kind: Level['decor'][number]['kind'] = 'box',
    ) =>
      out.push({
        id: b.id + '-' + name,
        kind,
        position: { x, y, z },
        size: { x: w, y: h, z: d },
        surface,
        color,
      });
    const cols = Math.max(2, Math.floor(b.width / 2.7));
    for (let floor = 0; floor < b.floors; floor++)
      for (let col = 0; col < cols; col++) {
        const z = b.z - b.width / 2 + ((col + 0.5) * b.width) / cols;
        const y = 1.9 + floor * 3.6;
        const boarded =
          b.archetype === 3 || b.archetype === 7 || random() < b.damage * 0.18;
        const irregular = b.archetype === 6 ? (random() - 0.5) * 0.45 : 0;
        const ribbon = b.archetype === 2;
        add(
          `window-${floor}-${col}`,
          face,
          y + irregular,
          z,
          0.045,
          1.7,
          ribbon ? b.width / cols - 0.25 : 1.05,
          boarded ? 'wood' : 'glass',
          boarded ? '#4d4940' : undefined,
          boarded ? 'box' : 'window',
        );
        add(
          `lintel-${floor}-${col}`,
          face - b.side * 0.08,
          y + 0.95,
          z,
          0.16,
          0.14,
          ribbon ? b.width / cols : 1.35,
          'concrete',
        );
        add(
          `sill-${floor}-${col}`,
          face - b.side * 0.13,
          y - 0.92,
          z,
          0.28,
          0.12,
          1.4,
          'concrete',
        );
        if (boarded)
          for (let n = 0; n < 3; n++)
            add(
              `board-${floor}-${col}-${n}`,
              face - b.side * 0.05,
              y - 0.55 + n * 0.5,
              z,
              0.08,
              0.13,
              1.2,
              'wood',
            );
        if (floor > 0 && col === 0 && b.archetype % 3 === 0) {
          add(
            `balcony-${floor}`,
            face - b.side * 0.65,
            y - 1,
            z,
            1.3,
            0.15,
            2.1,
            'metal',
            '#4b4137',
          );
          add(
            `balcony-rail-${floor}`,
            face - b.side * 1.2,
            y - 0.45,
            z,
            0.07,
            1,
            2.1,
            'metal',
          );
        }
      }
    // Different storefront treatments, unequal pipes and repair patches.
    add(
      'door',
      face - 0.01 * b.side,
      1.4,
      b.z - b.width * 0.2,
      0.07,
      2.8,
      1.6,
      'metal',
      '#30383c',
    );
    if (b.archetype % 3 === 0)
      for (let i = 0; i < 12; i++)
        add(
          'shutter' + i,
          face - b.side * 0.06,
          0.2 + i * 0.23,
          b.z + b.width * 0.22,
          0.08,
          0.06,
          b.width * 0.32,
          'metal',
        );
    if (b.archetype === 5 || b.archetype === 9)
      add(
        'signboard',
        face - b.side * 0.1,
        3.2,
        b.z,
        0.15,
        0.6,
        b.width * 0.75,
        'wood',
        '#60615a',
      );
    add(
      'drain',
      face - b.side * 0.18,
      b.height / 2,
      b.z + b.width / 2 - 0.4,
      0.14,
      b.height,
      0.14,
      'metal',
      '#454a48',
      'cylinder',
    );
    for (let i = 0; i < 4; i++)
      add(
        'patch' + i,
        face - b.side * 0.025,
        0.4 + random() * 3,
        b.z + (random() - 0.5) * b.width,
        0.06,
        0.25 + random() * 0.7,
        0.4 + random(),
        'brick',
        '#65625a',
      );
    add(
      'flood-mark',
      face - b.side * 0.03,
      0.72,
      b.z,
      0.06,
      0.12,
      b.width,
      'brick',
      '#414a4c',
    );
    add(
      'ac',
      face - b.side * 0.35,
      4.7,
      b.z - b.width * 0.3,
      0.7,
      0.65,
      0.9,
      'metal',
      '#717877',
    );
    add(
      'cornice',
      b.x,
      b.height - 0.15,
      b.z,
      b.depth + 0.15,
      0.3,
      b.width + 0.15,
      'concrete',
    );
    const roofY = b.height;
    if (b.roof === 'pitched' || b.roof === 'sawtooth') {
      // Stepped sloped silhouettes built from panels, entirely decorative above the roof.
      for (let i = 0; i < 6; i++)
        add(
          'roof-profile' + i,
          b.x,
          roofY + 0.2 + i * 0.23,
          b.z + ((i - 2.5) * b.width) / 6,
          b.depth,
          0.18,
          b.width / 6,
          'metal',
        );
    } else {
      for (const side of [-1, 1])
        add(
          'parapet' + side,
          b.x + (side * b.depth) / 2,
          roofY + 0.35,
          b.z,
          0.15,
          0.7,
          b.width,
          'brick',
        );
    }
    add('chimney', b.x + 2, roofY + 1.4, b.z + 1, 0.8, 2.8, 0.8, 'brick');
    add('aerial', b.x - 3, roofY + 2, b.z - 1, 0.05, 4, 0.05, 'metal');
    add('aerial-cross', b.x - 3, roofY + 3, b.z - 1, 1.8, 0.05, 0.05, 'metal');
    if (b.archetype % 2 === 0)
      add(
        'roof-tank',
        b.x - 3,
        roofY + 1.2,
        b.z,
        2.1,
        2.4,
        2.1,
        'metal',
        undefined,
        'cylinder',
      );
  }
  return out;
}
