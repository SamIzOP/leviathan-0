import type { Level, Collider, Surface } from './level';
import type { Vec3 } from './types';
import { buildings } from './buildings';
import { stairRun, placeStairs } from './stairs';
import { seeded } from './forge-data';
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export function buildFoundry(): Level {
  const colliders: Collider[] = [],
    decor: Level['decor'] = [],
    lights: Level['lights'] = [];
  const add = (
    id: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    surface: Surface = 'concrete',
    platform = true,
    prop?: string,
  ) => {
    colliders.push({
      id,
      min: v(x - w / 2, y, z - d / 2),
      max: v(x + w / 2, y + h, z + d / 2),
      surface,
      platform,
      wallRunnable: h >= 10 && Math.max(w, d) >= 30,
      mantleable: h <= 1.5,
      climbable: false,
      ...(prop ? { prop } : {}),
    });
  };
  const detail = (
    id: string,
    kind: Level['decor'][number]['kind'],
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    surface: Surface = 'metal',
    color?: string,
    prop?: string,
  ) => {
    decor.push({
      id,
      kind,
      position: v(x, y, z),
      size: v(w, h, d),
      surface,
      ...(color ? { color } : {}),
      ...(prop ? { prop } : {}),
    });
  };
  const stairs = (
    id: string,
    x: number,
    z: number,
    height: number,
    axis: 'x' | 'z' = 'z',
    direction = 1,
    base = 0,
  ) => {
    const steps = placeStairs(
      stairRun(height - base),
      v(x, base, z),
      axis,
      direction,
    );
    for (const [i, b] of steps.entries())
      colliders.push({
        id: `${id}-${i}`,
        ...b,
        surface: 'metal',
        platform: true,
        wallRunnable: false,
        mantleable: true,
        climbable: false,
      });
    // Rail posts and handrails are ornamental; all walking surfaces use shared forge treads.
    const n = steps.length;
    for (let i = 0; i < n; i += 5)
      for (const side of [-1, 1]) {
        const b = steps[i]!;
        detail(
          `${id}-rail-${i}-${side}`,
          'box',
          (b.min.x + b.max.x) / 2 + (axis === 'z' ? side * 1.16 : 0),
          b.max.y + 0.55,
          (b.min.z + b.max.z) / 2 + (axis === 'x' ? side * 1.16 : 0),
          0.06,
          1.1,
          0.06,
        );
      }
    const run = n * 0.29,
      rise = height - base,
      slope = Math.atan2(rise, run),
      length = Math.hypot(run, rise);
    for (const side of [-1, 1])
      decor.push({
        id: id + '-handrail-' + side,
        kind: 'box',
        surface: 'metal',
        position: v(
          x + (axis === 'x' ? (direction * run) / 2 : side * 1.16),
          base + rise / 2 + 1,
          z + (axis === 'z' ? (direction * run) / 2 : side * 1.16),
        ),
        size: v(
          axis === 'x' ? length : 0.06,
          0.06,
          axis === 'z' ? length : 0.06,
        ),
        rotation: v(
          axis === 'z' ? -direction * slope : 0,
          0,
          axis === 'x' ? direction * slope : 0,
        ),
        detail: true,
      });
    return steps.at(-1)!;
  };
  // Switchback service stairs: <=6 m per flight; no future movement required.
  const tower = (id: string, x: number, z: number, height: number) => {
    let base = 0,
      flight = 0,
      top = { x, z, y: height };
    while (base < height - 0.001) {
      const rise = Math.min(3.6, height - base),
        dir = flight % 2 ? -1 : 1;
      const length = Math.round(rise / 0.18) * 0.29;
      const end = stairs(
        `${id}-flight-${flight}`,
        x,
        z + (dir === 1 ? 0 : length),
        base + rise,
        'z',
        dir,
        base,
      );
      const endZ = dir === 1 ? z + length : z;
      top = { x, z: endZ + dir * 1.2, y: base + rise };
      add(
        `${id}-landing-${flight}`,
        x,
        base + rise - 0.12,
        endZ + (dir === 1 ? 0.7 : -0.7),
        3,
        0.12,
        1.4,
        'metal',
      );
      // Alternating parallel runs avoid overhead obstruction on the return flight.
      const nextX = x + (flight % 2 ? -3 : 3);
      add(
        `${id}-cross-${flight}`,
        (x + nextX) / 2,
        base + rise - 0.12,
        endZ + dir * 1.2,
        5.4,
        0.12,
        2.4,
        'metal',
      );
      x = nextX;
      base = end.max.y;
      flight++;
    }
    return top;
  };
  // Ground slabs stop at a real pit; the exterior band is reachable only in inspection mode.
  add('ground-south', 0, -0.5, 33, 220, 0.5, 114, 'asphalt');
  add('ground-north', 0, -0.5, -76, 220, 0.5, 28);
  add('ground-west', -59, -0.5, -43, 102, 0.5, 38);
  add('ground-east', 59, -0.5, -43, 102, 0.5, 38);
  add('ground-middle', 0, -0.5, -36, 16, 0.5, 24);
  add('pit-bottom', 0, -3.5, -55, 16, 0.5, 14);
  // Continuous visible twelve-metre perimeter, plus locked entrance and side-street gates.
  for (const x of [-108, 108])
    add(`compound-wall-x${x}`, x, 0, 0, 2, 12, 178, 'concrete', false);
  for (const z of [-88, 88])
    add(`compound-wall-z${z}`, 0, 0, z, 218, 12, 2, 'concrete', false);
  add(
    'entrance-blast-door',
    0,
    0,
    86,
    14,
    10,
    1,
    'metal',
    false,
    'prop.blast-door',
  );
  for (const side of [-1, 1]) {
    add(
      `side-seal-${side}`,
      side * 53,
      0,
      35,
      1,
      10,
      20,
      'metal',
      false,
      'prop.roller-shutter',
    );
    add(`run-wall-${side}`, side * 45, 0, 18, 1, 10, 34, 'brick', false);
    for (const z of [46, 5]) {
      add(
        `barricade-${side}-${z}`,
        side * 55,
        0,
        z,
        14,
        2,
        2,
        'concrete',
        true,
        'prop.jersey-barrier',
      );
      stairs(`barricade-stair-${side}-${z}`, side * 59, z - 4, 2);
    }
    // Visible sealed urban continuation behind the compound edge.
    for (let i = 0; i < 6; i++)
      detail(
        `outer-city-${side}-${i}`,
        'box',
        side * (120 + (i % 2) * 16),
        12 + i * 2,
        65 - i * 30,
        14,
        24 + i * 4,
        19,
        'brick',
        '#515b60',
      );
  }
  detail('road', 'box', 0, 0.006, 35, 13, 0.012, 100, 'asphalt', '#a3acac');
  for (const side of [-1, 1]) {
    add('sidewalk' + side, side * 8.25, 0, 30, 3.5, 0.18, 100, 'concrete');
    detail('gutter' + side, 'box', side * 6.4, 0.025, 30, 0.25, 0.05, 100);
  }
  const architecture = buildings(71017);
  for (const b of architecture) {
    add(b.id, b.x, 0, b.z, b.depth, b.height, b.width, 'brick', true);
    const accessX = b.side * 31;
    const top = tower(
      b.id + '-fire-escape',
      accessX,
      b.z - b.width / 2,
      b.height,
    );
    add(
      b.id + '-roof-access',
      (top.x + b.x) / 2,
      b.height - 0.15,
      top.z,
      Math.abs(top.x - b.x) + 2.4,
      0.15,
      2.4,
      'metal',
    );
    // Alternate route between neighbouring roofs: ordinary stair towers at both ends.
    detail(b.id + '-roof-box', 'box', b.x, b.height + 1, b.z, 3, 2, 2, 'metal');
  }
  // Street parked vehicles retain exactly one white van.
  for (const [i, x, z, key, w, h, d] of [
    [0, -5, 57, 'sedan', 1.8, 1.5, 4.5],
    [1, 5, 35, 'van', 2.1, 2.6, 5.2],
    [2, -5, 10, 'pickup', 1.8, 1.8, 4.5],
    [3, 5, 68, 'hatchback', 1.8, 1.5, 3.7],
  ] as const) {
    add(
      i === 1 ? 'white-van' : `car-${i}`,
      x,
      0,
      z,
      w,
      h,
      d,
      'metal',
      true,
      'prop.' + key,
    );
    stairs(`vehicle-access-${i}`, x + (x > 0 ? 2.5 : -2.5), z - 2, h);
    add(
      `vehicle-bridge-${i}`,
      x + (x > 0 ? 1.5 : -1.5),
      h - 0.1,
      z - 2 + Math.round(h / 0.18) * 0.29,
      3,
      0.1,
      1,
      'metal',
    );
  }
  // Long container lanes, turning spaces, and independent accesses to every stack.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const x = -94 + col * 12,
        z = 12 - row * 22,
        levels = 1 + ((row + col) % 3);
      for (let k = 0; k < levels; k++)
        add(
          `container-${row}-${col}-${k}`,
          x,
          k * 2.6,
          z,
          2.44,
          2.6,
          12.2,
          'metal',
          true,
          'prop.container',
        );
      stairs(`container-access-${row}-${col}`, x + 3, z - 6, levels * 2.6);
      add(
        `container-landing-${row}-${col}`,
        x + 1.5,
        levels * 2.6 - 0.15,
        z - 6 + Math.round((levels * 2.6) / 0.18) * 0.29,
        5,
        0.15,
        2.5,
        'metal',
      );
    }
  for (const x of [-85, -55])
    add('crane-leg' + x, x, 0, -42, 1, 28, 1, 'metal', false, 'prop.pillar');
  add(
    'crane-gantry',
    -70,
    27.5,
    -42,
    31,
    0.5,
    3,
    'metal',
    true,
    'prop.catwalk',
  );
  const craneTop = tower('gantry-access', -90, -55, 28);
  add(
    'gantry-access-cross',
    (craneTop.x - 83) / 2,
    27.85,
    craneTop.z,
    Math.abs(craneTop.x + 83) + 2.4,
    0.15,
    2.4,
    'metal',
  );
  add(
    'gantry-access-bridge',
    -83,
    27.85,
    (craneTop.z - 42) / 2,
    2.4,
    0.15,
    Math.abs(craneTop.z + 42) + 2.4,
    'metal',
  );
  detail(
    'gantry-hoist',
    'box',
    -70,
    25,
    -42,
    3,
    4,
    3,
    'metal',
    undefined,
    'prop.generator',
  );
  // Tall towers have base collision only; upper chimneys are visual structures.
  for (const [i, x] of [-10, 0, 10].entries()) {
    add('stack-base' + i, x, 0, -12, 5, 3.6, 5, 'brick', true);
    stairs('stack-service' + i, x + 3.8, -10, 3.6);
    add('stack-landing' + i, x + 1.5, 3.45, -7, 6, 0.15, 7, 'metal');
    detail(
      'stack-tower' + i,
      'box',
      x,
      3.6 + (80 + i * 15) / 2,
      -12,
      4.6,
      80 + i * 15,
      4.6,
      'brick',
      undefined,
      'prop.smokestack',
    );
  }
  add('boiler', -78, 0, -62, 28, 21.6, 20, 'brick', true);
  const boilerTop = tower('boiler-access', -59, -70, 21.6);
  add('boiler-bridge', -62, 21.45, boilerTop.z, 12, 0.15, 2.4, 'metal');
  // 100 x 60 x 30 m foundry hall. Four large openings; three catwalk tiers.
  add('hall-west', -50, 0, -52, 1, 30, 60, 'brick', false);
  add('hall-east', 50, 0, -52, 1, 30, 60, 'brick', false);
  add('hall-back', 0, 0, -82, 101, 30, 1, 'brick', false);
  for (const x of [-36, 36])
    add('hall-front' + x, x, 0, -22, 28, 30, 1, 'brick', false);
  add('hall-lintel', 0, 14, -22, 44, 16, 1, 'metal', false);
  add('hall-roof', 0, 30, -52, 101, 0.36, 61, 'metal', true);
  add('hall-roof-north-barrier', 0, 30.36, -82, 101, 3, 0.5, 'concrete', false);
  for (const x of [-50, 50])
    add(
      'hall-roof-edge-barrier' + x,
      x,
      30.36,
      -77,
      0.5,
      3,
      10,
      'concrete',
      false,
    );
  for (const y of [6, 12, 18]) {
    for (const x of [-46, 46])
      add(
        `catwalk-${x}-${y}`,
        x,
        y - 0.18,
        -52,
        6,
        0.18,
        56,
        'metal',
        true,
        'prop.catwalk',
      );
    add(
      'catwalk-back' + y,
      0,
      y - 0.18,
      -78,
      88,
      0.18,
      6,
      'metal',
      true,
      'prop.catwalk',
    );
    for (const side of [-1, 1]) {
      stairs(`hall-stair-${side}-${y}`, side * 42, -27, y, 'z', -1, y - 6);
      add(
        `hall-landing-${side}-${y}`,
        side * 44,
        y - 0.18,
        -37,
        10,
        0.18,
        3,
        'metal',
      );
      if (y > 6)
        add(
          `hall-return-${side}-${y}`,
          side * 46,
          y - 6 - 0.18,
          -31,
          6,
          0.18,
          13,
          'metal',
        );
      detail(
        `hall-ladder-${side}-${y}`,
        'box',
        side * 48,
        y - 3,
        -61,
        0.8,
        6,
        0.4,
        'metal',
        undefined,
        'prop.ladder',
      );
    }
  }
  for (const [i, x, z] of [
    [0, 55, -67],
    [1, 60, -40],
  ] as const) {
    const top = tower('hall-roof-stair-' + i, x, z, 30.36);
    add(
      'hall-roof-bridge' + i,
      (top.x + 48) / 2,
      30.21,
      top.z,
      top.x - 48 + 2.4,
      0.15,
      2.4,
      'metal',
    );
  }
  for (const x of [-28, 28])
    for (const z of [-35, -68])
      add(
        `pillar-${x}-${z}`,
        x,
        0,
        z,
        1.2,
        30,
        1.2,
        'metal',
        false,
        'prop.pillar',
      );
  for (const x of [-20, 20]) {
    add('conveyor' + x, x, 0, -46, 3, 1.08, 20, 'metal', true, 'prop.conveyor');
    stairs('conveyor-access' + x, x + 3, -38, 1.08);
    add('vat' + x, x, 0, -68, 5, 3, 5, 'metal', true, 'prop.vat');
    stairs('vat-access' + x, x + 4, -71, 3);
    add('vat-landing' + x, x + 2, 2.85, -66, 5, 0.15, 2, 'metal');
  }
  for (const x of [-5, 5]) stairs('pit-exit' + x, x, -61, 0, 'z', 1, -3);
  detail(
    'hall-overhead-crane',
    'box',
    0,
    24,
    -57,
    82,
    4,
    5,
    'metal',
    undefined,
    'prop.overhead-crane',
  );
  // Ground machinery, smaller furnishings and utility clutter, all forge models.
  const props = [
    'crate',
    'pallet',
    'barrel',
    'gas-cylinder',
    'dumpster',
    'electrical-cabinet',
    'generator',
    'concrete-block',
    'wheelie-bin',
  ];
  for (let i = 0; i < 27; i++) {
    const key = props[i % props.length]!,
      x = 72 + (i % 3) * 8,
      z = 65 - Math.floor(i / 3) * 12;
    add(
      `utility-${i}`,
      x,
      0,
      z,
      1.6,
      i % 3 === 0 ? 0.45 : 1.2,
      1.6,
      i % 3 === 0 ? 'wood' : 'metal',
      true,
      'prop.' + key,
    );
    if (i % 3 !== 0) stairs(`utility-access-${i}`, x + 2, z - 2, 1.2);
  }
  for (const x of [-7, 7])
    for (const z of [72, 40, 8]) {
      lights.push({ position: v(x, 8, z), intensity: 0.5 });
      detail(
        `lamp-${x}-${z}`,
        'box',
        x,
        4,
        z,
        0.4,
        8,
        0.4,
        'metal',
        undefined,
        'prop.lamp-post',
      );
    }
  detail(
    'water-tower',
    'box',
    -36,
    44,
    -95,
    14,
    88,
    14,
    'metal',
    undefined,
    'prop.water-tower',
  );
  const rng = seeded(71017);
  for (let layer = 0; layer < 3; layer++)
    for (let i = 0; i < 25; i++) {
      const h = 30 + rng() * 70;
      detail(
        `skyline-${layer}-${i}`,
        'box',
        -220 + i * 19,
        h / 2,
        -120 - layer * 72,
        12 + rng() * 12,
        h,
        10,
        'concrete',
        ['#657178', '#859095', '#a2aaae'][layer],
      );
    }
  for (let i = 0; i < 4; i++)
    detail('haze' + i, 'haze', 0, 35, -105 - i * 48, 500, 120, 1, 'glass');
  return {
    id: 'foundry-row',
    name: 'Foundry Row',
    seed: 71017,
    bounds: { min: v(-110, -14, -90), max: v(110, 130, 90) },
    killY: -8,
    colliders,
    decor,
    lights,
    buildings: architecture,
    gates: [
      { id: 'entrance', position: v(0, 0, 86), initiallyClosed: true },
      { id: 'east-city', position: v(53, 0, 35), initiallyClosed: true },
      { id: 'west-city', position: v(-53, 0, 35), initiallyClosed: true },
    ],
    zones: [
      { id: 'entrance', position: v(0, 0, 76) },
      {
        id: 'rooftops',
        position: v(-18, architecture[0]!.height, architecture[0]!.z),
      },
      { id: 'containers', position: v(-80, 0, 0) },
      { id: 'stacks', position: v(0, 0, -5) },
      { id: 'hall', position: v(0, 0, -32) },
    ],
    spawns: Array.from({ length: 12 }, (_, i) => ({
      position: v((i % 4) * 2.6 - 3.9, 0, 81 - Math.floor(i / 4) * 2.6),
      yaw: 0,
      type: 'player' as const,
    })),
    interiors: [{ min: v(-50, 0, -82), max: v(50, 30, -22) }],
    weather: { rain: 0.65, wind: v(3, 0, 0.4), wetness: 0.9 },
    atmosphere: {
      fog: 0.0055,
      heightFog: 0.008,
      exposure: 0.95,
      sky: '#cbd2d4',
      horizon: '#8b989e',
      tint: '#aebdc5',
      smoke: 0.85,
    },
    audio: {
      rain: 0.12,
      wind: 0.035,
      distantInterval: [35, 65],
      emitters: [
        { kind: 'machinery', position: v(0, 6, -12), gain: 0.08 },
        { kind: 'steam', position: v(-60, 1, -63), gain: 0.07 },
        { kind: 'crane', position: v(-80, 22, -42), gain: 0.05 },
      ],
    },
    cameras: {
      composition: { position: v(-1, 12.5, 84), target: v(0, 30, -30) },
      spawn: { position: v(0, 1.65, 80), target: v(0, 5, -12) },
      van: { position: v(0, 2, 43), target: v(5, 1.5, 35) },
      facade: { position: v(-2, 3, 50), target: v(-10, 12, 43) },
      rooftops: { position: v(-42, 24, 52), target: v(-20, 18, 37) },
      containers: { position: v(-54, 14, 20), target: v(-85, 4, -15) },
      stacks: { position: v(4, 9, 15), target: v(0, 48, -12) },
      hall: { position: v(0, 4, -27), target: v(0, 11, -69) },
      stairs: { position: v(38, 2, -25), target: v(42, 3, -32) },
      boundary: { position: v(43, 2, 40), target: v(53, 4, 35) },
      puddle: { position: v(-1, 0.65, 50), target: v(2, 0.02, 45) },
    },
  };
}
