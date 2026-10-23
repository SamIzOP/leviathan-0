import { LevelKit, v } from './level-kit';
/** Face-local skins remain thin and flush; all large equipment is structural. */
export function dressArchitecture(k: LevelKit) {
  const level = k.level;
  for (const room of level.rooms ?? []) {
    k.zone = room.zone;
    const b = room.bounds,
      x = (b.min.x + b.max.x) / 2,
      z = (b.min.z + b.max.z) / 2;
    k.sign(
      `${room.id}/notice`,
      `${room.zone.toUpperCase()} // SHIFT 04`,
      x + 5,
      2.2,
      b.min.z + 0.34,
      3.4,
    );
    for (const yy of [0.6, 1.4, 2.2]) {
      k.box(
        `${room.id}/shelf-${yy}`,
        b.max.x - 1.1,
        yy,
        z - 6,
        1.5,
        0.12,
        3,
        'wood',
      );
      for (let i = 0; i < 3; i++)
        k.box(
          `${room.id}/stored-${yy}-${i}`,
          b.max.x - 1.1,
          yy + 0.12,
          z - 7 + i,
          0.6,
          0.45,
          0.65,
          'metal',
        );
    }
    for (let i = 0; i < 4; i++) {
      k.decor(
        `${room.id}/locker-seam-${i}`,
        'box',
        x - (b.max.x - b.min.x) / 2 + 1.2 + (i - 1.5) * 0.3,
        1.1,
        z + 2.415,
        0.025,
        1.9,
        0.025,
        'metal',
        'surface',
        undefined,
        '#88908c',
      );
      k.decor(
        `${room.id}/worktop-tools-${i}`,
        'box',
        b.max.x - 1.5,
        1.12,
        z - 0.4 + i * 0.7,
        0.18,
        0.2,
        0.35,
        'metal',
        'small',
      );
    }
    k.decor(
      `${room.id}/ceiling-light`,
      'lamp',
      x,
      4.5,
      z,
      2,
      0.12,
      0.2,
      'metal',
      'overhead',
    );
    level.lights.push({ position: v(x, 4.4, z), intensity: 0.3 });
  }
  const walls = level.solids!.filter(
    (s) =>
      s.shape === 'box' && s.size.y >= 24 && Math.max(s.size.x, s.size.z) > 20,
  );
  for (const [index, wall] of walls.entries()) {
    k.zone = wall.zone;
    const alongX = wall.size.x > wall.size.z,
      length = alongX ? wall.size.x : wall.size.z;
    const skin = alongX ? wall.size.z : wall.size.x,
      base = wall.position.y - wall.size.y / 2;
    const bay = wall.zone === 'tenements' ? 4 : 8;
    for (const side of [-1, 1])
      for (let t = -length / 2 + 4; t < length / 2 - 3; t += bay) {
        const x = wall.position.x + (alongX ? t : side * (skin / 2 + 0.02)),
          z = wall.position.z + (alongX ? side * (skin / 2 + 0.02) : t);
        for (let y = base + 7; y < base + wall.size.y - 2; y += 5.5) {
          const win =
            ['entrance', 'tenements'].includes(wall.zone) ||
            (wall.zone === 'hall' && y > 18);
          const width = wall.zone === 'tenements' ? 2.3 : win ? 4.6 : 5.8,
            height = win ? 2.6 : wall.zone === 'pumps' ? 1.8 : 4.8;
          const panels: Record<string, string> = {
            boundary: '#646e70',
            rail: '#4e636d',
            pumps: '#6f8581',
            slag: '#343d43',
            hall: '#566168',
            core: '#474943',
          };
          k.decor(
            `${wall.id}/skin-${side}-${t}-${y}`,
            win ? 'window' : 'box',
            x,
            y,
            z,
            alongX ? width : 0.035,
            height,
            alongX ? 0.035 : width,
            win ? 'glass' : 'metal',
            'surface',
            undefined,
            win ? undefined : panels[wall.zone],
          );
          // Narrow mullions, panel seams and weather streaks break up huge masses.
          for (const j of [-1, 0, 1])
            k.decor(
              `${wall.id}/mullion-${side}-${t}-${y}-${j}`,
              'box',
              x + (alongX ? j * 1.8 : side * 0.025),
              y,
              z + (alongX ? side * 0.025 : j * 1.8),
              alongX ? 0.06 : 0.06,
              3.5,
              0.06,
              'metal',
              'small',
            );
        }
        k.decor(
          `${wall.id}/pilaster-${side}-${t}`,
          'box',
          x + (alongX ? 3.6 : side * 0.07),
          base + 12,
          z + (alongX ? side * 0.07 : 3.6),
          alongX ? 0.3 : 0.15,
          24,
          alongX ? 0.15 : 0.3,
          'concrete',
          'small',
        );
        if (alongX && side === 1 && Math.round(t) % 24 === 0)
          k.sign(
            `${wall.id}/code-${t}`,
            `${String(index + 1).padStart(2, '0')} // ${wall.zone.toUpperCase()}`,
            x,
            5,
            z + 0.03,
            6,
          );
      }
  }
  // Person-scale seams, handles, pallet slats, barrel bands and hatches.
  for (const s of [...level.solids!].filter((s) => s.id.includes('/dress-'))) {
    k.zone = s.zone;
    const { x, y, z } = s.position;
    if (s.shape === 'box') {
      for (let n = 0; n < 4; n++)
        k.decor(
          `${s.id}/slat-${n}`,
          'box',
          x - s.size.x * 0.4 + n * s.size.x * 0.26,
          y,
          z + s.size.z / 2 + 0.012,
          0.045,
          s.size.y * 0.9,
          0.025,
          s.surface === 'wood' ? 'wood' : 'metal',
          'surface',
        );
      k.decor(
        `${s.id}/handle`,
        'box',
        x,
        y + 0.1,
        z + s.size.z / 2 + 0.035,
        0.3,
        0.06,
        0.04,
        'metal',
        'small',
        undefined,
        '#73817e',
      );
      k.decor(
        `${s.id}/patch`,
        'box',
        x - 0.3,
        y,
        z + s.size.z / 2 + 0.014,
        0.4,
        0.18,
        0.025,
        'metal',
        'surface',
        undefined,
        '#455558',
      );
    } else {
      for (const yy of [y - s.size.y * 0.3, y + s.size.y * 0.3])
        k.decor(
          `${s.id}/band-${yy}`,
          'cylinder',
          x,
          yy,
          z,
          s.size.x + 0.02,
          0.06,
          s.size.z + 0.02,
          'metal',
          'surface',
          undefined,
          '#303e43',
        );
    }
  }
  // Purposeful industrial assemblies beside reserved lanes.
  const assemblies: [string, number, number, string][] = [
    ['entrance', 18, 66, 'truck'],
    ['entrance', -17, 26, 'cart'],
    ['tenements', -172, 3, 'truck'],
    ['tenements', -92, -32, 'workstation'],
    ['rail', -166, -233, 'freight'],
    ['rail', -125, -144, 'freight'],
    ['pumps', -15, -173, 'pipes'],
    ['pumps', -15, -205, 'pipes'],
    ['slag', 42, -52, 'hopper'],
    ['slag', -26, -53, 'hopper'],
    ['hall', 170, -138, 'vat'],
    ['hall', 169, -184, 'vat'],
    ['core', 100, 29, 'workstation'],
    ['core', 165, -7, 'pipes'],
  ];
  for (const [zone, x, z, type] of assemblies) {
    k.zone = zone;
    const id = `${zone}/assembly-${type}-${x}-${z}`;
    if (type === 'truck' || type === 'freight' || type === 'cart') {
      const len = type === 'freight' ? 12 : type === 'cart' ? 2 : 6,
        w = type === 'freight' ? 3 : 2;
      k.box(`${id}/chassis`, x, 0.55, z, len, 0.6, w, 'metal', true);
      k.box(
        `${id}/cab`,
        x - len * 0.3,
        1.15,
        z,
        len * 0.28,
        1.5,
        w,
        'metal',
        true,
      );
      k.decor(
        `${id}/glass`,
        'window',
        x - len * 0.3,
        2.1,
        z + w / 2 + 0.015,
        len * 0.22,
        0.6,
        0.025,
        'glass',
        'surface',
      );
      for (const zz of [-w / 2, w / 2])
        k.box(
          `${id}/bed-${zz}`,
          x + len * 0.15,
          1.15,
          z + zz,
          len * 0.62,
          0.75,
          0.12,
          'metal',
          true,
        );
      for (const xx of [-len * 0.35, len * 0.35])
        for (const zz of [-w / 2 - 0.1, w / 2 + 0.1])
          k.horizontalCylinder(
            `${id}/wheel-${xx}-${zz}`,
            x + xx,
            0,
            z + zz,
            0.5,
            0.35,
          );
    } else if (type === 'pipes') {
      for (let i = 0; i < 3; i++) {
        k.horizontalCylinder(`${id}/pipe-${i}`, x + i * 1.3, 0, z, 0.48, 8);
        k.decor(
          `${id}/bend-${i}`,
          'box',
          x + i * 1.3,
          6,
          z,
          1,
          4,
          8,
          'metal',
          'overhead',
          'prop.curved-pipe',
        );
      }
      for (const zz of [-3, 3])
        k.box(
          `${id}/rack-${zz}`,
          x + 1.3,
          0,
          z + zz,
          4,
          0.3,
          0.3,
          'metal',
          true,
        );
    } else if (type === 'vat' || type === 'hopper') {
      k.cylinder(`${id}/body`, x, 0, z, type === 'vat' ? 4 : 2, 4, 'metal');
      k.decor(
        `${id}/crown`,
        'box',
        x,
        6,
        z,
        8,
        4,
        8,
        'metal',
        'overhead',
        type === 'vat' ? 'prop.ladle' : 'prop.hopper',
      );
      for (const xx of type === 'vat' ? [-5, 5] : [-2.8, 2.8])
        k.box(`${id}/brace-${xx}`, x + xx, 0, z, 0.3, 8, 0.3, 'metal');
    } else {
      for (let i = 0; i < 3; i++) {
        k.box(`${id}/desk-${i}`, x + i * 2.5, 0, z, 2, 1, 1, 'wood', true);
        k.box(
          `${id}/screen-${i}`,
          x + i * 2.5,
          1,
          z + 0.3,
          0.6,
          0.5,
          0.12,
          'metal',
          true,
        );
        k.decor(
          `${id}/tools-${i}`,
          'box',
          x + i * 2.5,
          1.1,
          z,
          0.2,
          0.2,
          0.7,
          'metal',
          'small',
          'prop.valve',
        );
      }
    }
  }
  // Overhead utility links provide diagonal/sagging shapes without occupying lanes.
  for (const route of level.routes!.filter((r) => r.kind === 'primary')) {
    k.zone = route.zone;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!,
        length = Math.hypot(a.x - b.x, a.z - b.z);
      if (length < 30) continue;
      for (let t = 15; t < length; t += 24) {
        const x = a.x + ((b.x - a.x) * t) / length,
          z = a.z + ((b.z - a.z) * t) / length;
        const turn =
          Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? Math.PI / 2 : 0;
        k.decor(
          `${route.id}/sag-${i}-${t}`,
          'box',
          x,
          8,
          z,
          14,
          2,
          0.12,
          'metal',
          'cable',
          'prop.sag-cable',
          undefined,
          v(0, turn, 0),
        );
        k.decor(
          `${route.id}/steam-header-${i}-${t}`,
          'box',
          x,
          10,
          z,
          14,
          1,
          0.35,
          'metal',
          'overhead',
          'prop.curved-pipe',
          undefined,
          v(0, turn, 0),
        );
        // Thin service hangers attach the overhead runs to physical uprights.
        for (const side of [-1, 1]) {
          const offset = [7, 12, 18, 24].find((offset) => {
            const xx = x + (turn ? 0 : side * offset),
              zz = z + (turn ? side * offset : 0);
            if (xx < -204 || xx > 204 || zz < -244 || zz > 84) return false;
            return !level.routes!.some((r) =>
              r.points.slice(1).some((b, j) => {
                const a = r.points[j]!,
                  dx = b.x - a.x,
                  dz = b.z - a.z,
                  t = Math.max(
                    0,
                    Math.min(
                      1,
                      ((xx - a.x) * dx + (zz - a.z) * dz) /
                        (dx * dx + dz * dz || 1),
                    ),
                  );
                return (
                  Math.hypot(xx - a.x - t * dx, zz - a.z - t * dz) <
                  r.width / 2 + 0.7
                );
              }),
            );
          });
          if (offset) {
            k.box(
              `${route.id}/utility-post-${i}-${t}-${side}`,
              x + (turn ? 0 : side * offset),
              0,
              z + (turn ? side * offset : 0),
              0.18,
              10,
              0.18,
              'metal',
            );
            k.decor(
              `${route.id}/utility-arm-${i}-${t}-${side}`,
              'box',
              x + (turn ? 0 : (side * offset) / 2),
              10,
              z + (turn ? (side * offset) / 2 : 0),
              turn ? 0.15 : offset,
              0.15,
              turn ? offset : 0.15,
              'metal',
              'small',
            );
          }
        }
        for (const side of [-1, 1])
          k.decor(
            `${route.id}/lane-mark-${i}-${t}-${side}`,
            'box',
            x + (turn ? 0 : side * 4.4),
            0.012,
            z + (turn ? side * 4.4 : 0),
            turn ? 9 : 0.12,
            0.015,
            turn ? 0.12 : 9,
            'concrete',
            'surface',
            undefined,
            '#89918b',
          );
      }
    }
  }
  // Broken boards, rebar and notices stay below the decorative size threshold.
  for (const zone of level.zones) {
    k.zone = zone.id;
    const p = zone.position;
    for (let i = 0; i < 24; i++) {
      const x = p.x + Math.sin(i * 2.399) * (0.8 + i * 0.22),
        z = p.z + Math.cos(i * 2.399) * (0.8 + i * 0.22);
      k.decor(
        `${zone.id}/litter-${i}`,
        'box',
        x,
        0.03,
        z,
        0.25,
        0.04,
        0.13,
        'wood',
        'small',
        undefined,
        i % 3 ? '#4c595b' : '#7d8581',
        v(0, i * 0.17, 0),
      );
    }
  }
}
