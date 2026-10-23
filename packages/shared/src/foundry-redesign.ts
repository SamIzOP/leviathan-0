import type { Level } from './level';
import { LevelKit, v } from './level-kit';
import { seeded } from './forge-data';
import { ARCHETYPES } from './buildings';
import { dressArchitecture } from './foundry-dressing';

/** Seven connected industrial districts; all reachable structure is shared data. */
export function buildFoundry(): Level {
  const level: Level = {
    id: 'foundry-row',
    name: 'Foundry Row',
    seed: 71017,
    layoutVersion: 2,
    bounds: { min: v(-210, -14, -250), max: v(210, 140, 90) },
    killY: -12,
    colliders: [],
    decor: [],
    solids: [],
    gates: [],
    zones: [],
    buildings: [],
    spawns: [],
    lights: [],
    interiors: [],
    criticalPath: [],
    landmarks: [],
    coverPoints: [],
    markers: [],
    encounters: [],
    routes: [],
    rooms: [],
    weather: { rain: 0.55, wind: v(2, 0, 0.4), wetness: 0.88 },
    atmosphere: {
      fog: 0.0038,
      heightFog: 0.005,
      exposure: 1.05,
      sky: '#98a9b4',
      horizon: '#778b96',
      tint: '#b6c5cd',
      smoke: 0.8,
    },
    audio: { rain: 0.2, wind: 0.17, distantInterval: [25, 55], emitters: [] },
    cameras: {},
  };
  const k = new LevelKit(level),
    rng = seeded(level.seed);
  const definitions = [
    ['entrance', '01 / RAVEL GATE', -60, 0, 60, 90, 'brick', '#82939d', 0, 40],
    [
      'tenements',
      '02 / BRACKEN COURTS',
      -210,
      -70,
      -60,
      90,
      'brick',
      '#7f8b91',
      0,
      100,
    ],
    [
      'rail',
      '03 / KAINOS FREIGHT',
      -210,
      -250,
      -60,
      -70,
      'metal',
      '#748b96',
      0,
      130,
    ],
    [
      'pumps',
      '04 / VALE CONDENSERS',
      -60,
      -250,
      60,
      -110,
      'concrete',
      '#7d9696',
      0,
      110,
    ],
    ['slag', '05 / ASH TRANSFER', -60, -110, 60, 0, 'metal', '#81858c', 0, 100],
    [
      'hall',
      '06 / NARROW IRON',
      60,
      -250,
      210,
      -70,
      'concrete',
      '#76838c',
      0,
      160,
    ],
    ['core', '07 / VESPER CORE', 60, -70, 210, 90, 'metal', '#8b8985', 0, 120],
  ] as const;
  for (const [
    id,
    code,
    x0,
    z0,
    x1,
    z1,
    material,
    fogTint,
    y,
    minimum,
  ] of definitions) {
    level.zones.push({
      id,
      code,
      bounds: { min: v(x0, -4, z0), max: v(x1, 45, z1) },
      position: v((x0 + x1) / 2, y, (z0 + z1) / 2),
      material,
      fogTint,
      ambient: 1.9,
      dressingMinimum: minimum,
      dressingPer1000: 12,
    });
  }
  // Ground slabs are partitioned around two genuine lowered yards (not overlays).
  const holes = [
    { x0: -180, x1: -150, z0: -210, z1: -180 },
    { x0: -20, x1: 20, z0: -75, z1: -45 },
  ];
  const zs = [-250, -210, -180, -75, -45, 90];
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i]!,
      z1 = zs[i + 1]!,
      active = holes.filter((h) => h.z0 <= z0 && h.z1 >= z1);
    const xs = [-210, ...active.flatMap((h) => [h.x0, h.x1]), 210].sort(
      (a, b) => a - b,
    );
    for (let j = 0; j < xs.length - 1; j++) {
      const x0 = xs[j]!,
        x1 = xs[j + 1]!;
      if (active.some((h) => x0 >= h.x0 && x1 <= h.x1)) continue;
      k.box(
        `ground-${i}-${j}`,
        (x0 + x1) / 2,
        -4,
        (z0 + z1) / 2,
        x1 - x0,
        4,
        z1 - z0,
        'asphalt',
        true,
      );
    }
  }
  holes.forEach((h, i) => {
    k.zone = i ? 'slag' : 'rail';
    k.box(
      `sunken-${i}`,
      (h.x0 + h.x1) / 2,
      -4,
      (h.z0 + h.z1) / 2,
      h.x1 - h.x0,
      1,
      h.z1 - h.z0,
      'concrete',
      true,
    );
    for (const x of [h.x0 + 4, h.x1 - 4])
      k.stairs(`pit-${i}-${x}`, x, -3, h.z0 + 2, 3, 4, 1);
    k.decor(
      `flood-${i}`,
      'box',
      (h.x0 + h.x1) / 2,
      -2.98,
      (h.z0 + h.z1) / 2,
      h.x1 - h.x0,
      0.02,
      h.z1 - h.z0,
      'glass',
      'surface',
      undefined,
      '#30464d',
    );
  });
  k.zone = 'boundary';
  for (const x of [-208, 208])
    k.box(`perimeter-x${x}`, x, -4, -80, 4, 40, 340, 'concrete');
  for (const z of [-248, 88])
    k.box(`perimeter-z${z}`, 0, -4, z, 420, 40, 4, 'concrete');
  // Break the retaining megastructure into buttresses, pilasters and pipe galleries.
  for (let x = -196; x < 210; x += 16)
    for (const z of [-245.8, 85.8]) {
      k.box(`seal-buttress-${x}-${z}`, x, 0, z, 2, 32, 1, 'brick');
      k.decor(
        `seal-rib-${x}-${z}`,
        'box',
        x,
        40,
        z,
        0.18,
        16,
        0.18,
        'metal',
        'small',
      );
    }
  // Open data gates carry progression metadata only. Permanent physical partitions
  // enforce the sequence even while future encounter shutters remain unimplemented.
  const partition = (
    id: string,
    axis: 'x' | 'z',
    at: number,
    lo: number,
    hi: number,
    gate: number,
    from: string,
    to: string,
  ) => {
    k.zone = from;
    const half = 5;
    for (const [a, b] of [
      [lo, gate - half],
      [gate + half, hi],
    ]) {
      if (b! <= a!) continue;
      k.box(
        `${id}/${a}`,
        axis === 'x' ? at : (a! + b!) / 2,
        0,
        axis === 'z' ? at : (a! + b!) / 2,
        axis === 'x' ? 3 : b! - a!,
        40,
        axis === 'z' ? 3 : b! - a!,
        'concrete',
      );
    }
    k.box(
      `${id}/overpass`,
      axis === 'x' ? at : gate,
      7,
      axis === 'z' ? at : gate,
      axis === 'x' ? 3 : 10,
      33,
      axis === 'z' ? 3 : 10,
      'brick',
    );
    const position = axis === 'x' ? v(at, 0, gate) : v(gate, 0, at);
    level.gates.push({
      id,
      position,
      initiallyClosed: false,
      connects: [from, to],
      width: 10,
    });
    k.sign(
      `${id}/wayfinding`,
      `${to.toUpperCase()} →`,
      position.x,
      5.3,
      position.z + 1.52,
      8,
    );
  };
  partition('gate-01', 'x', -60, 0, 90, 10, 'entrance', 'tenements');
  partition('gate-02', 'z', -70, -210, -60, -190, 'tenements', 'rail');
  partition('gate-03', 'x', -60, -250, -110, -220, 'rail', 'pumps');
  partition('gate-04', 'z', -110, -60, 60, 40, 'pumps', 'slag');
  partition('gate-05', 'x', 60, -110, -70, -85, 'slag', 'hall');
  partition('gate-06', 'z', -70, 60, 210, 185, 'hall', 'core');
  // Remaining district edges are solid backing buildings, never invisible clips.
  k.box('partition-tenement-slag', -60, 0, -55, 3, 40, 110, 'brick');
  k.box('partition-entrance-slag', 0, 0, 0, 120, 40, 3, 'brick');
  k.box('partition-entrance-core', 60, 0, 45, 3, 40, 90, 'concrete');
  k.box('partition-pumps-hall', 60, 0, -180, 3, 40, 140, 'brick');
  k.box('partition-slag-core', 60, 0, -35, 3, 40, 70, 'brick');
  // Retained entrance position/yaw and occupancy spacing.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++)
      level.spawns.push({
        position: v(-3.9 + col * 2.6, 0, 81 - row * 2.6),
        yaw: 0,
        type: 'player',
      });
  level.gates.push({
    id: 'entrance-seal',
    position: v(0, 0, 86),
    initiallyClosed: true,
    width: 10,
  });
  const paths: Record<string, number[][]> = {
    entrance: [
      [0, 81],
      [0, 10],
      [-60, 10],
    ],
    tenements: [
      [-60, 10],
      [-76, 10],
      [-76, 65],
      [-190, 65],
      [-190, -70],
    ],
    rail: [
      [-190, -70],
      [-190, -100],
      [-85, -100],
      [-85, -155],
      [-190, -155],
      [-190, -220],
      [-60, -220],
    ],
    pumps: [
      [-60, -220],
      [-40, -220],
      [-40, -135],
      [40, -135],
      [40, -110],
    ],
    slag: [
      [40, -110],
      [40, -90],
      [-35, -90],
      [-35, -30],
      [35, -30],
      [35, -85],
      [60, -85],
    ],
    hall: [
      [60, -85],
      [85, -85],
      [85, -220],
      [185, -220],
      [185, -70],
    ],
    core: [
      [185, -70],
      [185, 60],
      [85, 60],
      [85, -20],
      [115, -20],
      [115, 25],
    ],
  };
  for (const zone of level.zones) {
    const points = paths[zone.id]!.map(([x, z]) => v(x!, 0, z!));
    level.criticalPath!.push(
      ...points.slice(level.criticalPath!.length ? 1 : 0),
    );
    level.routes!.push({
      id: `${zone.id}/main`,
      zone: zone.id,
      width: 8,
      ceiling: 7,
      kind: 'primary',
      points,
    });
    zone.position = { ...points[Math.floor(points.length / 2)]! };
  }
  // Tall firebreaks make the authored bends meaningful. Their two sides host
  // routes and equipment; the far ends have broad circulation around them.
  k.zone = 'tenements';
  k.box('court-firebreak', -135, 0, 30, 74, 26, 7, 'brick');
  k.zone = 'rail';
  k.box('rail-cut-1', -150, 0, -125, 116, 28, 6, 'metal');
  k.box('rail-cut-2', -120, 0, -185, 116, 28, 6, 'concrete');
  k.zone = 'pumps';
  k.box('pump-boiler-divider', 0, 0, -196, 7, 34, 108, 'brick');
  k.zone = 'slag';
  k.box('slag-screen-west', -12, 0, -53, 7, 36, 70, 'metal');
  k.box('slag-screen-east', 12, 0, -53, 7, 36, 70, 'brick');
  // Central slag screens terminate below the north route; the south/main turn
  // uses a wide opening, with the lower yard visible through its own culvert.
  for (const b of level.colliders.filter((b) =>
    b.id.startsWith('slag-screen'),
  )) {
    b.min.z = -82;
    b.max.z = -42;
  }
  for (const s of level.solids!.filter((s) => s.id.startsWith('slag-screen'))) {
    s.position.z = -62;
    s.size.z = 40;
  }
  k.zone = 'hall';
  k.box('hall-furnace-spine', 135, 0, -143, 14, 32, 142, 'brick');
  k.zone = 'core';
  k.box('core-divider', 140, 0, -10, 12, 32, 120, 'concrete');

  // Two broad alternatives per beat, linked at both ends. All routes are data
  // for map/debug/clearance tests; only optional slide/jump branches need tricks.
  const flanks: Record<string, number[][]> = {
    entrance: [
      [0, 72],
      [8, 72],
      [8, 20],
      [0, 20],
    ],
    tenements: [
      [-76, 50],
      [-90, 50],
      [-170, 50],
      [-190, 50],
    ],
    rail: [
      [-180, -100],
      [-180, -108],
      [-100, -108],
      [-100, -100],
    ],
    pumps: [
      [-40, -210],
      [-25, -210],
      [-25, -145],
      [-40, -145],
    ],
    slag: [
      [-35, -80],
      [-45, -80],
      [-45, -35],
      [-35, -35],
    ],
    hall: [
      [85, -200],
      [93, -200],
      [93, -100],
      [85, -100],
    ],
    core: [
      [185, -50],
      [198, -50],
      [198, 45],
      [185, 45],
    ],
  };
  for (const [zone, p] of Object.entries(flanks))
    level.routes!.push({
      id: `${zone}/loop`,
      zone,
      width: 4,
      ceiling: 7,
      kind: 'flank',
      points: p.map(([x, z]) => v(x!, 0, z!)),
    });

  // Enterable buildings: structural openings are 4 × 3.6 m; no facade skins
  // cover the doors. Their roofs, furniture, parapets and tanks all collide.
  const rooms: [
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
  ][] = [
    ['entrance', 'gate-workshop', -34, 57, 20, 26, 14.4, 0],
    ['entrance', 'dispatch-office', 34, 43, 20, 24, 18, 24],
    ['tenements', 'bracken-tenement', -128, 5, 28, 28, 18, 10],
    ['tenements', 'communal-workshop', -155, -40, 28, 24, 14.4, 18],
    ['rail', 'freight-depot', -125, -235, 26, 18, 12, 12],
    ['rail', 'signal-control', -122, -83, 24, 12, 12, 16],
    ['pumps', 'vale-pump-house', 27, -184, 28, 30, 12, 13],
    ['pumps', 'compressor-house', 28, -230, 26, 22, 14.4, 15],
    ['slag', 'ash-control', -40, -17, 16, 12, 12, 14],
    ['hall', 'north-light-warehouse', 108, -164, 22, 60, 24, 19],
    ['core', 'vesper-control', 107, -43, 26, 22, 14.4, 20],
  ];
  for (const [zone, id, x, z, w, d, h, a] of rooms) {
    k.zone = zone;
    k.room(
      id,
      x,
      z,
      w,
      d,
      h,
      a,
      zone === 'rail' ? 'metal' : zone === 'pumps' ? 'concrete' : 'brick',
    );
  }
  // Stair access and linked roof landings stay well away from the sealed edge.
  k.zone = 'tenements';
  k.stairTower('court-roof-access', -112, -9, 18);
  k.box('court-roof-link', -111, 17.7, -10, 8, 0.65, 7, 'metal', true);
  k.zone = 'entrance';
  k.stairTower('gate-roof-access', -22, 28, 15);
  // Raised rail embankment and ordinary shallow stairs at both ends.
  k.zone = 'rail';
  k.box('rail-embankment', -130, 0, -204, 46, 4, 8, 'concrete', true);
  k.stairs('rail-ramp-west', -146, 0, -188.66, 4, 5, -1);
  k.stairs('rail-ramp-east', -110, 0, -188.66, 4, 5, -1);
  for (let x = -151; x < -108; x += 1.8)
    k.box(`sleeper-${x}`, x, 4, -204, 0.3, 0.12, 6, 'wood', true);
  for (const z of [-205.1, -202.9])
    k.box(`track-${z}`, -130, 4.12, z, 46, 0.12, 0.12, 'metal', true);
  // Hall circulation at three heights; the west gallery is separate from the
  // primary ground route, preserving the complete conservative route.
  k.zone = 'hall';
  for (const y of [6, 12, 18]) {
    k.box(
      `gallery-west-${y}`,
      105,
      y - 0.35,
      -160,
      6,
      0.35,
      110,
      'metal',
      true,
    );
    k.box(
      `gallery-east-${y}`,
      163,
      y - 0.35,
      -160,
      6,
      0.35,
      110,
      'metal',
      true,
    );
    k.box(`gallery-link-${y}`, 134, y - 0.35, -214, 64, 0.35, 6, 'metal', true);
  }
  k.stairTower('hall-gallery-access', 153, -205, 18);
  for (let z = -215; z <= -100; z += 24)
    for (const x of [73, 200])
      k.box(`hall-column-${x}-${z}`, x, 0, z, 1.6, 30, 1.6, 'metal');
  // Broken roof has real support beams; the skin is overhead and inaccessible.
  for (let z = -225; z < -90; z += 18) {
    k.box(`hall-roof-beam-${z}`, 135, 29, z, 128, 1.2, 0.8, 'metal');
    k.decor(
      `hall-roof-vault-${z}`,
      'box',
      135,
      33,
      z,
      126,
      5,
      15,
      'metal',
      'overhead',
      'prop.vault-roof',
    );
  }
  // Explicit optional slide tunnel, with two mouths and a walk-around loop.
  k.zone = 'pumps';
  k.box('steam-tunnel-left', -52, 0, -167, 1, 3, 20, 'concrete');
  k.box('steam-tunnel-right', -46, 0, -167, 1, 3, 20, 'concrete');
  k.box('steam-tunnel-cap', -49, 1.3, -167, 7, 1.7, 20, 'concrete');
  level.routes!.push({
    id: 'steam-slide',
    zone: 'pumps',
    width: 5,
    ceiling: 1.3,
    kind: 'slide',
    points: [v(-49, 0, -178), v(-49, 0, -156)],
    shortcut: true,
  });
  for (const [zone, x, z] of [
    ['tenements', -200, -15],
    ['rail', -72, -143],
    ['hall', 76, -155],
  ] as const) {
    k.zone = zone;
    k.box(`${zone}/run-line`, x, 0, z, 0.7, 6, 48, 'brick', false, true);
    level.routes!.push({
      id: `${zone}/wallrun`,
      zone,
      width: 4,
      ceiling: 20,
      kind: 'wallrun',
      points: [v(x + 2, 0, z - 24), v(x + 2, 0, z + 24)],
      shortcut: true,
    });
  }
  // Raised jump landing pairs and mantle-height approach cover are optional.
  for (let i = 0; i < 3; i++) {
    k.zone = 'rail';
    const x = -180 + i * 24;
    for (const z of [-141, -147])
      k.box(`jump-${i}-${z}`, x, 0, z, 8, 1.2, 2, 'metal', true);
    level.routes!.push({
      id: `rail/jump-${i}`,
      zone: 'rail',
      width: 8,
      ceiling: 20,
      kind: 'jump',
      points: [v(x, 1.2, -141), v(x, 1.2, -147)],
      shortcut: true,
    });
  }
  // Distinct large forms. Curved base volumes use inset collision strips;
  // inaccessible upper machinery is explicit overhead ornament, not a fake wall.
  const landmark = (
    id: string,
    zone: string,
    x: number,
    z: number,
    h: number,
    prop: string,
    w: number,
    d = w,
  ) => {
    k.zone = zone;
    level.landmarks!.push({ id, zone, position: v(x, 0, z), height: h });
    if (prop === 'gantry-crane' || prop === 'ore-bridge') {
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          k.box(
            `${id}/leg-${sx}-${sz}`,
            x + sx * w * 0.48,
            0,
            z + sz * d * 0.48,
            0.8,
            5,
            0.8,
            'metal',
          );
    } else k.cylinder(`${id}/pedestal`, x, 0, z, w * 0.32, 5, 'concrete');
    k.decor(
      `${id}/crown`,
      'box',
      x,
      5 + (h - 5) / 2,
      z,
      w,
      h - 5,
      d,
      'metal',
      'overhead',
      `prop.${prop}`,
    );
  };
  landmark('water-tower', 'entrance', -47, 22, 62, 'water-tower', 13);
  landmark('bracken-signal', 'tenements', -165, 14, 58, 'signal-tower', 12);
  landmark('freight-gantry', 'rail', -130, -140, 42, 'gantry-crane', 55, 18);
  landmark('vale-gasholder', 'pumps', 27, -155, 52, 'gas-holder', 24);
  for (let i = 0; i < 3; i++)
    landmark(
      `stack-${i}`,
      'slag',
      -22 + i * 22,
      -12,
      80 + i * 15,
      'smokestack',
      7,
    );
  landmark('ore-bridge', 'hall', 160, -235, 48, 'ore-bridge', 64, 10);
  landmark('vesper-furnace', 'core', 115, 45, 65, 'furnace', 20, 18);
  k.zone = 'pumps';
  for (const [x, z] of [
    [20, -200],
    [44, -200],
    [20, -212],
    [44, -212],
  ]) {
    k.cylinder(`tank-${x}-${z}`, x!, 0, z!, 4, 7, 'metal', '#687b7c');
    k.decor(
      `tank-crown-${x}-${z}`,
      'box',
      x!,
      10,
      z!,
      8,
      6,
      8,
      'metal',
      'overhead',
      'prop.cooling-tower',
    );
  }
  k.zone = 'rail';
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const x = -170 + col * 22,
        z = -114 - row * 38;
      // Rows are staggered; leave every authored route's reservation free.
      if (nearRoutes(x, z, 7, level)) continue;
      for (let tier = 0; tier < 1 + ((row + col) % 3); tier++) {
        k.box(
          `container-${row}-${col}-${tier}`,
          x,
          tier * 2.6,
          z,
          12,
          2.6,
          5.6,
          'metal',
          true,
          true,
          ['#4b5559', '#536665', '#4d5863'][col % 3],
        );
        for (let n = 0; n < 10; n++)
          k.decor(
            `container-rib-${row}-${col}-${tier}-${n}`,
            'box',
            x - 5 + n * 1.1,
            tier * 2.6 + 1.3,
            z + 2.82,
            0.06,
            2.5,
            0.04,
            'metal',
            'surface',
          );
      }
    }
  // Building silhouettes around the district edges: 28 distinct archetype
  // signatures, setbacks and alternating heights, never a cloned neighbour.
  for (let i = 0; i < ARCHETYPES.length; i++) {
    const side = i % 2 ? -1 : 1,
      x = side * (82 + (i % 7) * 17),
      z = i < 14 ? 80 : -239,
      h = 14 + ((i * 7) % 9);
    k.zone =
      i < 14 ? (side < 0 ? 'tenements' : 'core') : side < 0 ? 'rail' : 'hall';
    if (nearRoutes(x, z, 7, level)) continue;
    k.box(
      `backing-building-${i}`,
      x,
      0,
      z,
      12,
      h,
      12,
      i % 3 ? 'brick' : 'concrete',
    );
    k.box(
      `backing-setback-${i}`,
      x + ((i % 3) - 1) * 2,
      h,
      z,
      7,
      3 + (i % 5),
      8,
      'metal',
    );
    k.decor(
      `backing-roof-${i}`,
      'box',
      x,
      h + 6,
      z,
      12,
      4,
      12,
      'metal',
      'overhead',
      i % 2 ? 'prop.vault-roof' : 'prop.sawtooth-roof',
    );
    level.buildings.push({
      id: `backing-building-${i}`,
      side,
      x,
      z,
      width: 12,
      depth: 12,
      height: h,
      floors: Math.floor(h / 3.6),
      roof: ['flat', 'pitched', 'sawtooth', 'stepped', 'collapsed'][
        i % 5
      ] as Level['buildings'][number]['roof'],
      archetype: i,
      damage: ((i * 19) % 100) / 100,
    });
  }

  // Deterministic clustering around safe route margins. Large objects always
  // use solid primitives; flat stains/loose cables stay deliberately nonblocking.
  for (const zone of level.zones) {
    k.zone = zone.id;
    const b = zone.bounds!,
      minimum = zone.dressingMinimum!;
    let placed = 0;
    for (let attempt = 0; attempt < 6000 && placed < minimum; attempt++) {
      const x = b.min.x + 8 + rng() * (b.max.x - b.min.x - 16),
        z = b.min.z + 8 + rng() * (b.max.z - b.min.z - 16);
      if (
        nearRoutes(x, z, 6, level) ||
        !free(x, z, 2, level) ||
        holes.some(
          (h) => x > h.x0 - 2 && x < h.x1 + 2 && z > h.z0 - 2 && z < h.z1 + 2,
        )
      )
        continue;
      const id = `${zone.id}/dress-${placed}`,
        r = rng();
      if (placed % 5 === 0) {
        k.cylinder(id, x, 0, z, 0.45, 1.2, 'metal');
      } else if (placed % 5 === 1) {
        k.box(id, x, 0, z, 2.4, 0.8, 1.4, 'wood', true);
      } else if (placed % 5 === 2) {
        k.box(id, x, 0, z, 1.4, 1.5, 1.4, zone.material!, true);
      } else if (placed % 5 === 3) {
        k.box(id, x, 0, z, 2.6, 2.1, 1.1, 'metal', true);
      } else {
        k.box(id, x, 0, z, 2, 0.35, 2, 'concrete', true);
      }
      const height =
        placed % 5 === 3 ? 'high' : placed % 5 === 2 ? 'medium' : 'low';
      const cid = level.solids!.at(-1)!.colliderIds[0]!;
      if (placed < 24)
        level.coverPoints!.push({
          id: `${id}/cover`,
          zone: zone.id,
          position: v(x, z === 0 ? 0 : 0, z + 2.2),
          heightClass: height,
          colliderId: cid,
        });
      k.decor(
        `${id}/oil`,
        'box',
        x + 0.3,
        0.015,
        z,
        3 + r * 3,
        0.02,
        2 + r,
        'asphalt',
        'surface',
        undefined,
        '#26353a',
      );
      k.decor(
        `${id}/scrap`,
        'box',
        x + 0.6,
        0.12,
        z + 0.5,
        0.18,
        0.2,
        1.5,
        'metal',
        'small',
        'prop.debris',
      );
      k.decor(
        `${id}/cable`,
        'box',
        x - 0.6,
        0.035,
        z + 0.8,
        2.8,
        0.04,
        0.15,
        'metal',
        'cable',
        'prop.sag-cable',
      );
      placed++;
    }
    level.audio.emitters.push({
      kind:
        zone.id === 'pumps'
          ? 'steam'
          : zone.id === 'rail'
            ? 'crane'
            : 'machinery',
      position: zone.position,
      gain: 0.04 + level.zones.indexOf(zone) * 0.009,
    });
    const route = level.routes!.find(
      (r) => r.zone === zone.id && r.kind === 'primary',
    )!;
    for (let i = 0; i < 10; i++) {
      const a = route.points[i % (route.points.length - 1)]!,
        b = route.points[(i % (route.points.length - 1)) + 1]!,
        t = 0.2 + (i % 3) * 0.25;
      const position = v(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
      const marker = {
        id: `${zone.id}/enemy-${i}`,
        zone: zone.id,
        position,
        kind: 'enemySpawn' as const,
        hint: 'ground' as const,
      };
      level.markers!.push(marker);
      level.spawns.push({ position, yaw: 0, type: 'enemySpawn' });
    }
    const room = level.rooms!.find((r) => r.zone === zone.id);
    if (room)
      level.markers!.push({
        id: `${zone.id}/interior-enemy`,
        zone: zone.id,
        position: v(
          (room.bounds.min.x + room.bounds.max.x) / 2,
          0,
          (room.bounds.min.z + room.bounds.max.z) / 2,
        ),
        kind: 'enemySpawn',
        hint: 'interior',
      });
    for (const [i, kind] of (
      ['ammo', 'salvage', 'oil', 'checkpoint'] as const
    ).entries())
      level.markers!.push({
        id: `${zone.id}/${kind}`,
        zone: zone.id,
        position: {
          ...route.points[Math.min(i + 1, route.points.length - 1)]!,
        },
        kind,
      });
    level.encounters!.push({
      id: `encounter-${zone.id}`,
      zone: zone.id,
      bounds: b,
      entryGate:
        level.gates.find((g) => g.connects?.[1] === zone.id)?.id ??
        'entrance-seal',
      waveSize: 8 + level.zones.indexOf(zone) * 3,
      intensity: 0.3 + level.zones.indexOf(zone) * 0.1,
    });
    const point = route.points[Math.min(1, route.points.length - 1)]!,
      next = route.points[Math.min(2, route.points.length - 1)]!;
    level.cameras[`${zone.id}-player`] = {
      position: v(point.x, 1.65, point.z),
      target: v(next.x, 4, next.z),
    };
    level.cameras[`${zone.id}-high`] = {
      position: v(point.x + 8, 22, point.z + 8),
      target: v(next.x, 5, next.z),
    };
    for (let i = 0; i < route.points.length - 1; i++) {
      const p = route.points[i]!,
        q = route.points[i + 1]!,
        dx = q.x - p.x,
        dz = q.z - p.z,
        len = Math.hypot(dx, dz);
      const x = (p.x + q.x) / 2 - (dz / len) * 6,
        z = (p.z + q.z) / 2 + (dx / len) * 6;
      if (!free(x, z, 0.5, level)) continue;
      k.box(`${zone.id}/lamp-${i}`, x, 0, z, 0.18, 6, 0.18, 'metal');
      k.decor(
        `${zone.id}/lamp-head-${i}`,
        'lamp',
        x,
        5.8,
        z,
        1,
        0.15,
        0.3,
        'metal',
        'overhead',
      );
      level.lights.push({ position: v(x, 5.6, z), intensity: 0.5 });
    }
  }
  for (const y of [6, 12, 18])
    level.markers!.push({
      id: `hall/elevated-${y}`,
      zone: 'hall',
      position: v(105, y, -160),
      kind: 'enemySpawn',
      hint: 'elevated',
    });
  level.markers!.push(
    { id: 'burn-point', zone: 'core', position: v(115, 0, 25), kind: 'burn' },
    { id: 'exit-machine', zone: 'core', position: v(85, 0, 35), kind: 'exit' },
  );
  level.cameras.composition = { position: v(0, 9, 82), target: v(0, 26, -12) };
  level.cameras.spawn = { position: v(0, 1.65, 81), target: v(0, 4, 10) };
  level.cameras.stacks = { position: v(-35, 1.65, -50), target: v(0, 65, -12) };
  level.cameras.hall = level.cameras['hall-player']!;
  level.cameras.containers = level.cameras['rail-high']!;
  level.cameras.van = level.cameras['entrance-player']!;
  level.cameras.puddle = level.cameras['pumps-player']!;
  level.cameras.stairs = {
    position: v(-149, 1.65, -174),
    target: v(-149, 4, -199),
  };
  level.cameras.wallrun = {
    position: v(-197, 1.65, 8),
    target: v(-197, 2, -38),
  };
  level.cameras.tunnel = {
    position: v(-49, 0.9, -183),
    target: v(-49, 0.8, -156),
  };
  level.cameras.boundary = {
    position: v(-193, 1.65, 55),
    target: v(-208, 25, 55),
  };
  for (const room of level.rooms!.slice(0, 3))
    level.cameras[`inside-${room.id}`] = {
      position: v(
        (room.bounds.min.x + room.bounds.max.x) / 2,
        1.65,
        room.bounds.max.z - 2,
      ),
      target: v(room.bounds.max.x - 2, 1.6, room.bounds.min.z + 2),
    };
  for (const lm of level.landmarks!)
    level.cameras[`landmark-${lm.id}`] = {
      position: v(lm.position.x, 10, lm.position.z + 170),
      target: v(lm.position.x, lm.height * 0.6, lm.position.z),
    };
  dressArchitecture(k);
  // Check the whole footprint against physical tops, including optional roofs
  // and equipment. "platform" is navigation metadata, not a collision exemption.
  for (const d of [...level.decor].filter((d) => d.reason === 'overhead')) {
    const bottom = d.position.y - d.size.y / 2;
    const below = level.colliders.filter(
      (c) =>
        c.max.y >= 0 &&
        c.min.x < d.position.x + d.size.x / 2 - 1e-5 &&
        c.max.x > d.position.x - d.size.x / 2 + 1e-5 &&
        c.min.z < d.position.z + d.size.z / 2 - 1e-5 &&
        c.max.z > d.position.z - d.size.z / 2 + 1e-5,
    );
    const top = below.reduce((highest, c) => Math.max(highest, c.max.y), 0),
      lift = Math.max(0, top + 3.2 - bottom);
    if (!lift) continue;
    d.position.y += lift;
    k.zone = d.zone ?? 'boundary';
    for (const side of [-1, 1])
      k.decor(
        `${d.id}/stand-off-${side}`,
        'box',
        d.position.x + side * d.size.x * 0.3,
        top + 1.6,
        d.position.z,
        0.16,
        3.2,
        0.16,
        'metal',
        'small',
      );
    const lm = level.landmarks!.find((l) => d.id === `${l.id}/crown`);
    if (lm) lm.height = d.position.y + d.size.y / 2;
  }
  // Review viewpoints face each district's actual equipment and circulation.
  const review: Record<
    string,
    [number, number, number, number, number, number]
  > = {
    'entrance-player': [0, 1.65, 76, 0, 14, 15],
    'tenements-player': [-190, 1.65, 60, -138, 15, 0],
    'rail-player': [-190, 1.65, -155, -130, 18, -140],
    'pumps-player': [40, 1.65, -135, 27, 25, -180],
    'slag-player': [-35, 1.65, -30, 0, 35, -12],
    'hall-player': [185, 1.65, -220, 153, 12, -170],
    'core-player': [185, 1.65, 60, 115, 25, 45],
    'rail-high': [-178, 26, -175, -145, 0, -198],
    'pumps-high': [45, 26, -140, 10, 2, -204],
    'slag-high': [-36, 26, -90, 0, 0, -56],
    'hall-high': [175, 22, -212, 145, 10, -150],
    'core-high': [185, 22, 65, 115, 16, 25],
    stairs: [-146, 1.65, -184, -146, 4, -201],
  };
  for (const [name, p] of Object.entries(review))
    level.cameras[name] = {
      position: v(p[0], p[1], p[2]),
      target: v(p[3], p[4], p[5]),
    };
  level.cameras.containers = level.cameras['rail-high']!;
  level.cameras.hall = level.cameras['hall-player']!;
  level.cameras.puddle = level.cameras['pumps-player']!;
  // Stations verified against rendered mesh occlusion, at 165 m. Four are
  // elevated review views; they are not represented as ground-level sightlines.
  const stations: Record<string, [number, number, number]> = {
    'water-tower': [-199.44012286436234, 1.65, -41.142766340239795],
    'bracken-signal': [0, 42, 14],
    'freight-gantry': [35, 42, -140],
    'vale-gasholder': [192, 42, -155],
    'stack-0': [-183.829571266533, 1.65, 20.18990313266122],
    'stack-1': [-152.4401228643623, 1.65, 51.14276634023983],
    'stack-2': [54.18990313266117, 1.65, -173.829571266533],
    'ore-bridge': [192.1899031326612, 1.65, -73.17042873346699],
    'vesper-furnace': [-46.82957126653301, 28, 77.18990313266121],
  };
  for (const lm of level.landmarks!) {
    const p = stations[lm.id]!;
    level.cameras[`landmark-${lm.id}`] = {
      position: v(...p),
      target: v(lm.position.x, lm.height * 0.7, lm.position.z),
    };
  }
  // platform denotes a required conservative navigation destination. Cover,
  // equipment and optional advanced tops retain mantle flags without becoming
  // mandatory nodes in the basic-route graph.
  for (const c of level.colliders) {
    if (
      /\/dress-|\/locker|\/workbench|\/parapet|\/assembly-|^container-|^jump-/.test(
        c.id,
      )
    )
      c.platform = false;
    if (
      c.id.endsWith('/roof') &&
      !['gate-workshop/roof', 'bracken-tenement/roof'].includes(c.id)
    )
      c.platform = false;
  }
  return level;
}
function nearRoutes(x: number, z: number, clear: number, level: Level) {
  return level.routes!.some((r) =>
    r.points.slice(1).some((b, i) => {
      const a = r.points[i]!,
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = Math.max(
          0,
          Math.min(
            1,
            ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1),
          ),
        );
      return Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < clear;
    }),
  );
}
function free(x: number, z: number, r: number, level: Level) {
  return !level.colliders.some(
    (b) =>
      b.max.y > 0.1 &&
      b.min.y < 3 &&
      x + r > b.min.x &&
      x - r < b.max.x &&
      z + r > b.min.z &&
      z - r < b.max.z,
  );
}
