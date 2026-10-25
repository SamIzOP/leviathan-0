import * as THREE from 'three';
/** Cells of the shared 4 × 2 FX atlas (128 px each). */
export const CELL = {
  glow: 0,
  star: 1,
  flame: 2,
  smoke: 3,
  ring: 4,
  beam: 5,
  puddle: 6,
  splat: 7,
} as const;
/** Cells of the 2 × 1 decal atlas. */
export const DECAL = { hole: 0, scorch: 1 } as const;
const SIZE = 128;
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(columns: number, rows: number) {
  const c = document.createElement('canvas');
  c.width = SIZE * columns;
  c.height = SIZE * rows;
  return { c, g: c.getContext('2d')! };
}
function inCell(
  g: CanvasRenderingContext2D,
  index: number,
  columns: number,
  draw: () => void,
) {
  g.save();
  const x = (index % columns) * SIZE,
    y = Math.floor(index / columns) * SIZE;
  g.beginPath();
  g.rect(x, y, SIZE, SIZE);
  g.clip();
  g.translate(x, y);
  draw();
  g.restore();
}
function radial(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: [number, string][],
) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, color] of stops) grd.addColorStop(at, color);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
/** An irregular closed blob around (64, 64). */
function blob(
  g: CanvasRenderingContext2D,
  rand: () => number,
  radius: number,
  wobble: number,
) {
  const points = 28,
    phase = rand() * 6;
  g.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r =
      radius *
      (1 +
        wobble *
          (0.55 * Math.sin(a * 3 + phase) +
            0.3 * Math.sin(a * 7 + phase * 2) +
            0.15 * (rand() - 0.5)));
    const x = 64 + Math.cos(a) * r,
      y = 64 + Math.sin(a) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}
let atlas: THREE.CanvasTexture | undefined;
/** Procedural FX atlas: soft glow, muzzle star, flame (colour baked), smoke puff,
 * shock ring, vertical beam, oil puddle (shaded) and splat. RGB is emission or
 * albedo, alpha is coverage; shaders premultiply. */
export function fxAtlas() {
  if (atlas) return atlas;
  const { c, g } = canvas(4, 2),
    rand = seeded(91);
  inCell(g, CELL.glow, 4, () =>
    radial(g, 64, 64, 63, [
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,255,255,0.7)'],
      [0.45, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  inCell(g, CELL.star, 4, () => {
    g.translate(64, 64);
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      g.save();
      g.rotate((i / spikes) * Math.PI * 2 + (rand() - 0.5) * 0.5);
      const len = 34 + rand() * 28,
        w = 4 + rand() * 4;
      const grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, -w);
      g.lineTo(len, 0);
      g.lineTo(0, w);
      g.closePath();
      g.fill();
      g.restore();
    }
    radial(g, 0, 0, 30, [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.75)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  });
  inCell(g, CELL.flame, 4, () => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 34; i++) {
      const t = i / 33;
      const y = 122 - t * 104 - rand() * 6,
        x =
          64 +
          Math.sin(t * 6.5 + rand() * 0.8) * 7 * t +
          (rand() - 0.5) * 10 * t;
      const r = (1 - t) * 30 + 7 + rand() * 4;
      const green = Math.round(225 - t * 150),
        blue = Math.round(150 - t * 140);
      radial(g, x, y, r, [
        [0, `rgba(255,${green},${blue},${0.2 * (1 - t * 0.55)})`],
        [0.6, `rgba(255,${Math.round(green * 0.55)},20,${0.08 * (1 - t)})`],
        [1, 'rgba(255,60,10,0)'],
      ]);
    }
    // White-hot core near the base.
    radial(g, 64, 104, 18, [
      [0, 'rgba(255,245,220,0.55)'],
      [1, 'rgba(255,200,120,0)'],
    ]);
  });
  inCell(g, CELL.smoke, 4, () => {
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        d = rand() * 26;
      radial(g, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 26 + rand() * 18, [
        [0, 'rgba(255,255,255,0.32)'],
        [0.6, 'rgba(255,255,255,0.14)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
    }
  });
  inCell(g, CELL.ring, 4, () => {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.shadowColor = 'rgba(255,255,255,1)';
    g.shadowBlur = 10;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.arc(64, 64, 46, 0, Math.PI * 2);
    g.stroke();
  });
  inCell(g, CELL.beam, 4, () => {
    const across = g.createLinearGradient(0, 0, SIZE, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.3, 'rgba(255,255,255,0.25)');
    across.addColorStop(0.47, 'rgba(255,255,255,1)');
    across.addColorStop(0.53, 'rgba(255,255,255,1)');
    across.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, SIZE, SIZE);
    // Fade toward the top of the cell (the sky end of a beam).
    g.globalCompositeOperation = 'destination-in';
    const up = g.createLinearGradient(0, 0, 0, SIZE);
    up.addColorStop(0, 'rgba(255,255,255,0)');
    up.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    up.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = up;
    g.fillRect(0, 0, SIZE, SIZE);
  });
  inCell(g, CELL.puddle, 4, () => {
    g.shadowColor = 'rgba(6,7,8,0.9)';
    g.shadowBlur = 8;
    blob(g, rand, 50, 0.16);
    const body = g.createRadialGradient(58, 58, 4, 64, 64, 60);
    body.addColorStop(0, 'rgba(14,15,17,0.97)');
    body.addColorStop(0.75, 'rgba(10,11,12,0.93)');
    body.addColorStop(1, 'rgba(26,24,22,0.7)');
    g.fillStyle = body;
    g.fill();
    g.shadowBlur = 0;
    // Glossy sheen: a soft elongated highlight and a faint cold rim.
    g.save();
    g.translate(50, 46);
    g.rotate(-0.5);
    g.scale(1.9, 0.55);
    radial(g, 0, 0, 16, [
      [0, 'rgba(190,205,215,0.42)'],
      [1, 'rgba(190,205,215,0)'],
    ]);
    g.restore();
    radial(g, 80, 82, 10, [
      [0, 'rgba(150,165,175,0.18)'],
      [1, 'rgba(150,165,175,0)'],
    ]);
  });
  inCell(g, CELL.splat, 4, () => {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    blob(g, rand, 30, 0.35);
    g.fill();
    for (let i = 0; i < 11; i++) {
      const a = rand() * Math.PI * 2,
        d = 34 + rand() * 22;
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + rand() * 6, 0, 7);
      g.fill();
    }
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 2;
  return atlas;
}
let decals: THREE.CanvasTexture | undefined;
/** Bullet hole (dark core, chipped rim) and blast scorch, on a 2 × 1 atlas. */
export function decalAtlas() {
  if (decals) return decals;
  const { c, g } = canvas(2, 1),
    rand = seeded(17);
  inCell(g, DECAL.hole, 2, () => {
    // Pale scuffed ring of crushed surface, so marks read on dark asphalt too.
    radial(g, 64, 64, 46, [
      [0, 'rgba(150,150,146,0.5)'],
      [0.45, 'rgba(130,130,126,0.32)'],
      [1, 'rgba(120,120,116,0)'],
    ]);
    // Chipped rim fragments.
    for (let i = 0; i < 11; i++) {
      const a = rand() * Math.PI * 2,
        d = 14 + rand() * 12;
      g.fillStyle = `rgba(${rand() > 0.4 ? '160,160,156' : '22,22,22'},${0.3 + rand() * 0.35})`;
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + rand() * 4, 0, 7);
      g.fill();
    }
    radial(g, 64, 64, 15, [
      [0, 'rgba(4,4,4,1)'],
      [0.6, 'rgba(8,8,8,0.95)'],
      [1, 'rgba(14,14,14,0)'],
    ]);
  });
  inCell(g, DECAL.scorch, 2, () => {
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2,
        d = rand() * 22;
      radial(g, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 30 + rand() * 20, [
        [0, 'rgba(8,8,8,0.5)'],
        [0.7, 'rgba(12,11,10,0.22)'],
        [1, 'rgba(12,11,10,0)'],
      ]);
    }
    radial(g, 64, 64, 30, [
      [0, 'rgba(4,4,4,0.6)'],
      [1, 'rgba(4,4,4,0)'],
    ]);
  });
  decals = new THREE.CanvasTexture(c);
  decals.colorSpace = THREE.SRGBColorSpace;
  decals.anisotropy = 4;
  return decals;
}
