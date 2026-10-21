import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Level } from '@leviathan/shared';
import { grime } from './world-materials';
import { extrudePath } from './forge';
/** One sign atlas and one merged cable mesh keep street identity inexpensive. */
export function streetDetails(level: Level) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const names = [
    'RAVEL PUMP WORKS',
    'ORIN TOOL REPAIR',
    'BRACKEN IRON',
    'MORROW STORES',
    'NORTH DRAIN CO.',
    'FERRO / UNIT 08',
    'VALE STEAM FITTERS',
    'KAINOS DEPOT',
  ];
  ctx.fillStyle = '#343d40';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  names.forEach((name, i) => {
    const x = (i % 2) * 512,
      y = Math.floor(i / 2) * 128;
    ctx.fillStyle = i % 2 ? '#b8bcb3' : '#9baaa9';
    ctx.fillText(name, x + 256, y + 58);
    ctx.font = '14px monospace';
    ctx.fillText(
      `FOUNDRY ROW // ${String(i + 11).padStart(3, '0')} // CLOSED`,
      x + 256,
      y + 89,
    );
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#222d32';
    for (let n = 0; n < 12; n++)
      ctx.fillRect(x + ((n * 71 + i * 31) % 500), y + ((n * 17) % 120), 2, 30);
  });
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.userData.persistentWorld = true;
  const material = new T.MeshStandardMaterial({
    map: texture,
    roughness: 0.95,
    metalness: 0,
  });
  grime(material, level.atmosphere.heightFog, level.atmosphere.horizon, false);
  const signs: T.BufferGeometry[] = [];
  level.buildings.forEach((b, i) => {
    const geometry = new T.PlaneGeometry(Math.min(5, b.width * 0.7), 1.1);
    const uv = geometry.attributes.uv!,
      index = i % 8;
    for (let n = 0; n < uv.count; n++)
      uv.setXY(
        n,
        (uv.getX(n) + (index % 2)) / 2,
        (uv.getY(n) + (3 - Math.floor(index / 2))) / 4,
      );
    geometry.rotateY((-b.side * Math.PI) / 2);
    geometry.translate(b.side * 9.75, 3.25, b.z);
    signs.push(geometry);
  });
  const signGeo = mergeGeometries(signs)!;
  signs.forEach((g) => g.dispose());
  const cableGeos: T.BufferGeometry[] = [];
  for (const z of [56, 19, -5]) {
    cableGeos.push(
      extrudePath(
        [
          new T.Vector3(-10, 12, z),
          new T.Vector3(-3, 10.7, z + 1),
          new T.Vector3(4, 11, z + 0.4),
          new T.Vector3(10, 14, z),
        ],
        0.025,
        20,
      ),
    );
  }
  const cableGeo = mergeGeometries(cableGeos)!;
  cableGeos.forEach((g) => g.dispose());
  const cableMaterial = new T.MeshStandardMaterial({
    color: '#262d31',
    roughness: 0.95,
  });
  return {
    objects: [
      new T.Mesh(signGeo, material),
      new T.Mesh(cableGeo, cableMaterial),
    ],
    geometries: [signGeo, cableGeo],
    materials: [material, cableMaterial],
    texture,
  };
}
