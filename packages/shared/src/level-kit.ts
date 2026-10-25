import type { Level, Surface } from './level';
import type { Vec3 } from './types';
export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const boxBounds = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) => ({ min: v(x - w / 2, y, z - d / 2), max: v(x + w / 2, y + h, z + d / 2) });
/** Level-owned visible geometry. The renderer never invents reachable structural parts. */
export class LevelKit {
  zone = 'entrance';
  constructor(public level: Level) {}
  box(
    id: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    surface: Surface = 'metal',
    platform = false,
    run = false,
    color?: string,
  ) {
    if (!color && h > 8) {
      const facades: Record<string, string> = {
        entrance: '#8e8e86',
        tenements: '#817b72',
        rail: '#65747c',
        pumps: '#869795',
        slag: '#535a5f',
        hall: '#788387',
        core: '#696b67',
        boundary: '#737f83',
      };
      color = facades[this.zone];
    }
    const b = {
      id,
      ...boxBounds(x, y, z, w, h, d),
      surface,
      platform,
      wallRunnable: run,
      mantleable: platform,
      climbable: false,
      collision: 'solid' as const,
      visualId: id,
    };
    this.level.colliders.push(b);
    this.level.solids!.push({
      id,
      shape: 'box',
      position: v(x, y + h / 2, z),
      size: v(w, h, d),
      surface,
      color,
      collision: 'solid',
      colliderIds: [id],
      zone: this.zone,
    });
    return b;
  }
  /** Inset strips follow the same 12-sided cylinder used by the actual mesh.
   * All strips are interior; radius error is bounded by the strip pitch. */
  cylinder(
    id: string,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    surface: Surface = 'metal',
    color?: string,
  ) {
    r -= 0.013; // Fabrication clearance from the nominal tank diameter.
    const ids: string[] = [];
    const polygon = Array.from({ length: 12 }, (_, i) =>
      v(Math.sin((i * Math.PI) / 6) * r, 0, Math.cos((i * Math.PI) / 6) * r),
    );
    const halfWidth = (zz: number) => {
      const xs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const a = polygon[i]!,
          b = polygon[(i + 1) % 12]!;
        if (Math.abs(a.z - b.z) < 1e-8) continue;
        if (zz >= Math.min(a.z, b.z) - 1e-8 && zz <= Math.max(a.z, b.z) + 1e-8)
          xs.push(a.x + ((b.x - a.x) * (zz - a.z)) / (b.z - a.z));
      }
      return Math.max(0, ...xs);
    };
    const count = Math.floor((2 * r) / 0.05),
      pitch = (2 * r) / count;
    for (let i = 0; i < count; i++) {
      const lo = -r + i * pitch,
        hi = lo + pitch;
      const half = Math.min(halfWidth(lo), halfWidth(hi));
      if (half < 0.025) continue;
      for (const axis of ['x', 'z'] as const) {
        const cid = `${id}/strip-${axis}-${i}`;
        ids.push(cid);
        this.level.colliders.push({
          id: cid,
          ...boxBounds(
            x + (axis === 'x' ? (lo + hi) / 2 : 0),
            y,
            z + (axis === 'z' ? (lo + hi) / 2 : 0),
            axis === 'x' ? pitch : half * 2,
            h,
            axis === 'z' ? pitch : half * 2,
          ),
          surface,
          platform: false,
          wallRunnable: false,
          mantleable: false,
          climbable: false,
          collision: 'solid',
          visualId: id,
        });
      }
    }
    // Thin inset centre strips retain the tips of the polygon. The crossed
    // decomposition avoids a missing cap on nearly tangent horizontal rays.
    for (const axis of ['x', 'z'] as const) {
      const cid = `${id}/tip-${axis}`;
      ids.push(cid);
      this.level.colliders.push({
        id: cid,
        ...boxBounds(
          x,
          y,
          z,
          axis === 'x' ? 2 * r - 0.001 : 0.001,
          h,
          axis === 'z' ? 2 * r - 0.001 : 0.001,
        ),
        surface,
        platform: false,
        wallRunnable: false,
        mantleable: false,
        climbable: false,
        collision: 'solid',
        visualId: id,
      });
    }
    this.level.solids!.push({
      id,
      shape: 'cylinder',
      position: v(x, y + h / 2, z),
      size: v(r * 2, h, r * 2),
      surface,
      color,
      collision: 'solid',
      colliderIds: ids,
      zone: this.zone,
    });
  }
  decor(
    id: string,
    kind: Level['decor'][number]['kind'],
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    surface: Surface = 'metal',
    reason: NonNullable<Level['decor'][number]['reason']> = 'small',
    prop?: string,
    color?: string,
    rotation?: Vec3,
  ) {
    this.level.decor.push({
      id,
      kind,
      position: v(x, y, z),
      size: v(w, h, d),
      surface,
      reason,
      prop,
      color,
      rotation,
      collision: 'decor',
      zone: this.zone,
    });
  }
  horizontalCylinder(
    id: string,
    x: number,
    y: number,
    z: number,
    r: number,
    length: number,
  ) {
    this.cylinder(id, x, y, z, r, length, 'metal');
    const solid = this.level.solids!.at(-1)!;
    r = solid.size.x / 2;
    solid.shape = 'cylinderZ';
    solid.position = v(x, y + r, z);
    solid.size = v(r * 2, r * 2, length);
    for (const c of this.level.colliders.filter((c) => c.visualId === id)) {
      const min = { ...c.min },
        max = { ...c.max };
      c.min = v(min.x, y + r + (min.z - z), z + (min.y - y - length / 2));
      c.max = v(max.x, y + r + (max.z - z), z + (max.y - y - length / 2));
    }
  }
  sign(id: string, text: string, x: number, y: number, z: number, w = 5) {
    this.level.decor.push({
      id,
      kind: 'box',
      position: v(x, y, z),
      size: v(w, 1.2, 0.025),
      surface: 'metal',
      collision: 'decor',
      reason: 'surface',
      zone: this.zone,
      text,
    });
  }
  stairs(
    id: string,
    x: number,
    y: number,
    z: number,
    rise: number,
    width = 4,
    dir = 1,
  ) {
    const n = Math.ceil(rise / 0.15),
      tread = 0.42;
    for (let i = 0; i < n; i++)
      this.box(
        `${id}/tread-${i}`,
        x,
        y,
        z + dir * (i + 0.5) * tread,
        width,
        ((i + 1) * rise) / n,
        tread,
        'concrete',
        true,
      );
    return v(x, y + rise, z + dir * n * tread);
  }
  stairTower(id: string, x: number, z: number, height: number) {
    for (const xx of [-2.1, 6.6])
      for (const zz of [-2, 10.4])
        this.box(
          `${id}/support-${xx}-${zz}`,
          x + xx,
          0,
          z + zz,
          0.18,
          height,
          0.18,
          'metal',
        );
    for (let i = 0; i < height / 3; i++) {
      const end = this.stairs(
        `${id}/flight-${i}`,
        x + (i % 2) * 4.5,
        i * 3,
        z + (i % 2) * 8.4,
        3,
        4,
        i % 2 ? -1 : 1,
      );
      this.box(
        `${id}/landing-${i}`,
        x + 2.25,
        end.y - 0.3,
        end.z + (i % 2 ? -1 : 1) * 2,
        8.5,
        0.3,
        4,
        'metal',
        true,
      );
    }
  }
  room(
    id: string,
    x: number,
    z: number,
    w: number,
    d: number,
    height: number,
    archetype: number,
    surface: Surface = 'brick',
  ) {
    const y = 0,
      door = 4;
    this.box(`${id}/floor`, x, -0.4, z, w, 0.4, d, 'concrete', true);
    for (const side of [-1, 1]) {
      this.box(
        `${id}/side-${side}`,
        x + (side * w) / 2,
        y,
        z,
        0.6,
        height,
        d,
        surface,
        false,
        true,
      );
      for (let zz = -d / 2 + 2; zz < d / 2 - 1; zz += 3.8)
        for (let yy = 4.8; yy < height - 1; yy += 3.6) {
          this.decor(
            `${id}/side-window-${side}-${zz}-${yy}`,
            'window',
            x + side * (w / 2 + 0.315),
            yy,
            z + zz,
            0.025,
            2,
            1.8,
            'glass',
            'surface',
          );
          this.box(
            `${id}/side-sill-${side}-${zz}-${yy}`,
            x + side * (w / 2 + 0.4),
            yy - 1.1,
            z + zz,
            0.2,
            0.15,
            2,
            surface,
          );
        }
      for (const wing of [-1, 1])
        this.box(
          `${id}/facade-${side}-${wing}`,
          x + (wing * (w + door)) / 4,
          y,
          z + (side * d) / 2,
          (w - door) / 2,
          height,
          0.6,
          surface,
          false,
          true,
        );
      this.box(
        `${id}/lintel-${side}`,
        x,
        3.6,
        z + (side * d) / 2,
        door,
        height - 3.6,
        0.6,
        surface,
      );
      for (let xx = -w / 2 + 2; xx < w / 2 - 1; xx += 3.8)
        for (let yy = 5; yy < height - 1; yy += 3.6) {
          this.decor(
            `${id}/window-${side}-${xx}-${yy}`,
            'window',
            x + xx,
            yy,
            z + side * (d / 2 + 0.315),
            1.8,
            2,
            0.025,
            'glass',
            'surface',
          );
          this.box(
            `${id}/sill-${side}-${xx}-${yy}`,
            x + xx,
            yy - 1.1,
            z + side * (d / 2 + 0.4),
            2,
            0.15,
            0.2,
            surface,
          );
        }
    }
    this.box(`${id}/roof`, x, height, z, w + 1, 0.35, d + 1, 'concrete', true);
    // Parapets and tanks are physical, including on the accessible roof.
    for (const side of [-1, 1])
      this.box(
        `${id}/parapet-${side}`,
        x + (side * w) / 2,
        height + 0.35,
        z,
        0.4,
        1.1,
        d,
        'brick',
        true,
      );
    this.cylinder(
      `${id}/roof-tank`,
      x - w / 4,
      height + 0.35,
      z + d / 4,
      1.1,
      2.4,
      'metal',
    );
    this.box(`${id}/desk`, x + 3, 0, z - 2, 2.4, 0.9, 1, 'wood', true);
    this.box(
      `${id}/locker`,
      x - w / 2 + 1.2,
      0,
      z + 2,
      1.4,
      2.2,
      0.8,
      'metal',
      true,
    );
    this.box(
      `${id}/workbench`,
      x + w / 2 - 1.5,
      0,
      z + 1,
      1.6,
      1,
      4,
      'wood',
      true,
    );
    if (id === 'gate-workshop' || id === 'bracken-tenement') {
      this.stairTower(
        `${id}/mezzanine-access`,
        x - w / 2 + 2.8,
        z - d / 2 + 6,
        6,
      );
      this.box(
        `${id}/mezzanine`,
        x,
        5.65,
        z - d / 2 + 2,
        w - 1,
        0.35,
        4,
        'metal',
        true,
      );
      this.box(
        `${id}/upper-desk`,
        x + 3,
        6,
        z - d / 2 + 2,
        2,
        0.9,
        1,
        'wood',
        true,
      );
    }
    this.decor(
      `${id}/tools`,
      'box',
      x + w / 2 - 1.5,
      1.1,
      z + 1,
      0.2,
      0.2,
      2,
      'metal',
      'small',
      'prop.valve',
    );
    this.level.interiors.push(boxBounds(x, 0, z, w, height, d));
    this.level.rooms!.push({
      id,
      zone: this.zone,
      bounds: boxBounds(x, 0, z, w, height, d),
      openings: [-1, 1].map((s) => ({
        position: v(x, 0, z + (s * d) / 2),
        width: door,
        height: 3.6,
      })),
      roof: height + 0.35,
    });
    this.level.buildings.push({
      id,
      side: x < 0 ? -1 : 1,
      x,
      z,
      width: w,
      depth: d,
      height,
      floors: Math.floor(height / 3.6),
      roof: ['flat', 'pitched', 'sawtooth', 'stepped', 'collapsed'][
        archetype % 5
      ] as Level['buildings'][number]['roof'],
      archetype,
      damage: ((archetype * 17) % 100) / 100,
    });
    this.sign(
      `${id}/sign`,
      id.toUpperCase().replaceAll('-', ' '),
      x,
      4.2,
      z + d / 2 + 0.34,
      w * 0.7,
    );
    return height + 0.35;
  }
}
