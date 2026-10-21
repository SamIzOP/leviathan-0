// Menu-only procedural artwork; independent of the gameplay renderer.
export class MenuBackground {
  canvas = document.createElement('canvas');
  base = document.createElement('canvas');
  grain = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  active = false;
  raf = 0;
  last = 0;
  frames = 0;
  totalMs = 0;
  maxMs = 0;
  image?: HTMLImageElement;
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  constructor() {
    this.canvas.id = 'menu-background';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    addEventListener('resize', () => {
      if (this.active) this.resize();
    });
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.raf);
      if (this.active && !document.hidden) this.loop(0);
    });
    this.reduced.addEventListener('change', () => {
      cancelAnimationFrame(this.raf);
      if (this.active) this.loop(0);
    });
    void this.loadArt();
  }
  async loadArt() {
    for (const path of ['/assets/menu-bg.webp', '/assets/menu-bg.jpg']) {
      const img = new Image();
      const loaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = path;
      });
      if (loaded) {
        this.image = img;
        if (this.active) this.resize();
        break;
      }
    }
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.canvas.hidden = false;
    this.resize();
    this.loop(0);
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.canvas.hidden = true;
    this.canvas.width =
      this.canvas.height =
      this.base.width =
      this.base.height =
      this.grain.width =
      this.grain.height =
        1;
  }
  resize() {
    const scale = Math.min(
      devicePixelRatio,
      1.5,
      1600 / innerWidth,
      1000 / innerHeight,
    );
    this.canvas.width = this.base.width = Math.round(innerWidth * scale);
    this.canvas.height = this.base.height = Math.round(innerHeight * scale);
    this.build();
    this.paint(0);
  }
  build() {
    const c = this.base.getContext('2d')!,
      w = this.base.width,
      h = this.base.height;
    let seed = 921;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const poly = (points: number[][], color: string) => {
      c.fillStyle = color;
      c.beginPath();
      points.forEach(([x, y], i) =>
        i ? c.lineTo(x! * w, y! * h) : c.moveTo(x! * w, y! * h),
      );
      c.closePath();
      c.fill();
    };
    const sky = c.createLinearGradient(0, 0, 0, h * 0.64);
    sky.addColorStop(0, '#d3d9db');
    sky.addColorStop(0.4, '#8a989f');
    sky.addColorStop(1, '#44545f');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 3; layer++) {
      c.fillStyle = ['#829198', '#6e7e88', '#536672'][layer]!;
      for (let i = 0; i < 40; i++) {
        const x = (0.25 + i * 0.018) * w,
          height = (0.025 + rand() * 0.12) * (1 + layer * 0.15) * h;
        c.fillRect(
          x,
          h * (0.46 + layer * 0.018) - height,
          w * (0.012 + rand() * 0.018),
          height,
        );
      }
      c.fillStyle = `rgba(197,207,211,${0.12 - layer * 0.025})`;
      c.fillRect(w * 0.2, h * 0.25, w * 0.65, h * 0.32);
    }
    for (let i = 0; i < 3; i++) {
      const x = w * (0.53 + i * 0.045),
        top = h * (0.17 + i * 0.035);
      c.fillStyle = '#657780';
      c.fillRect(x, top, w * 0.012, h * 0.5 - top);
      c.fillStyle = '#89989e';
      c.fillRect(x - w * 0.002, top, w * 0.016, h * 0.008);
    }
    c.strokeStyle = '#657680';
    c.lineWidth = Math.max(1, w * 0.002);
    c.beginPath();
    c.moveTo(w * 0.457, h * 0.26);
    c.lineTo(w * 0.447, h * 0.42);
    c.moveTo(w * 0.497, h * 0.26);
    c.lineTo(w * 0.507, h * 0.42);
    c.moveTo(w * 0.452, h * 0.32);
    c.lineTo(w * 0.502, h * 0.4);
    c.moveTo(w * 0.502, h * 0.32);
    c.lineTo(w * 0.452, h * 0.4);
    c.stroke();
    c.fillStyle = '#71818a';
    c.fillRect(w * 0.447, h * 0.206, w * 0.06, h * 0.055);
    c.beginPath();
    c.ellipse(w * 0.477, h * 0.206, w * 0.03, h * 0.012, 0, 0, Math.PI * 2);
    c.fill();
    poly(
      [
        [0.575, 0.47],
        [1, 1],
        [0, 1],
      ],
      '#667983',
    );
    const road = c.createLinearGradient(0, h * 0.46, 0, h);
    road.addColorStop(0, '#aebcc2');
    road.addColorStop(0.5, '#929fa6');
    road.addColorStop(1, '#647782');
    c.fillStyle = road;
    c.beginPath();
    c.moveTo(w * 0.575, h * 0.47);
    c.lineTo(w * 0.94, h);
    c.lineTo(w * 0.2, h);
    c.fill();
    for (const side of [-1, 1])
      for (let k = 7; k >= 0; k--) {
        const near = k / 9,
          far = (k + 1) / 9;
        const edge = (t: number) =>
          side < 0 ? 0.02 + (0.54 - 0.02) * t : 0.99 - (0.99 - 0.62) * t;
        const xa = edge(near),
          xb = edge(far);
        const bottomA = 0.97 - 0.48 * near,
          bottomB = 0.97 - 0.48 * far;
        const topA = 0.04 + 0.32 * near - rand() * 0.05,
          topB = 0.04 + 0.32 * far;
        const shade = side < 0 ? 42 + k * 5 : 17 + k * 5;
        poly(
          [
            [xa, topA],
            [xb, topB],
            [xb, bottomB],
            [xa, bottomA],
          ],
          `rgb(${shade},${shade + 9},${shade + 14})`,
        );
        c.strokeStyle = 'rgba(151,161,166,.12)';
        c.lineWidth = 1;
        for (let row = 1; row < 19; row++) {
          const f = row / 19;
          c.beginPath();
          c.moveTo(xa * w, (topA + (bottomA - topA) * f) * h);
          c.lineTo(xb * w, (topB + (bottomB - topB) * f) * h);
          c.stroke();
          for (let brick = 0; brick < 8; brick++) {
            const t = (brick + (row % 2) * 0.5) / 8;
            const x = xa + (xb - xa) * t;
            const top = topA + (topB - topA) * t;
            const bottom = bottomA + (bottomB - bottomA) * t;
            c.beginPath();
            c.moveTo(x * w, (top + (bottom - top) * f) * h);
            c.lineTo(x * w, (top + (bottom - top) * (f - 1 / 19)) * h);
            c.stroke();
            c.fillStyle = `rgba(75,65,55,${rand() * 0.12})`;
            c.fillRect(
              x * w,
              (top + (bottom - top) * f) * h,
              (Math.abs(xb - xa) * w) / 9,
              ((bottom - top) * h) / 20,
            );
          }
        }
        for (let row = 0; row < 4; row++)
          for (let col = 0; col < 3; col++) {
            const t = (col + 0.25) / 3,
              x = xa + (xb - xa) * t,
              b = topA + (topB - topA) * t,
              height = (bottomA - topA) * (1 - near * 0.1);
            const y = b + 0.05 + row * height * 0.19,
              ww = Math.abs(xb - xa) * 0.19,
              hh = height * 0.105;
            c.fillStyle = rand() > 0.92 ? '#83918f' : '#111b22';
            c.fillRect(x * w, y * h, ww * w, hh * h);
            c.fillStyle = '#42515b';
            c.fillRect(x * w, (y + hh) * h, ww * w, Math.max(1, h * 0.002));
          }
        c.fillStyle = '#111a20';
        poly(
          [
            [xa, topA],
            [xb, topB],
            [xb, topB + 0.007],
            [xa, topA + 0.012],
          ],
          '#111a20',
        );
      }
    c.strokeStyle = '#a0adb1';
    c.lineWidth = w * 0.002;
    for (const end of [0.2, 0.94]) {
      c.beginPath();
      c.moveTo(w * 0.575, h * 0.47);
      c.lineTo(w * end, h);
      c.stroke();
    }
    for (let i = 0; i < 150; i++) {
      const y = 0.51 + rand() * 0.49,
        spread = (y - 0.47) * 0.7,
        x = 0.575 + (rand() - 0.5) * spread;
      c.fillStyle = `rgba(205,215,217,${rand() * 0.13})`;
      c.fillRect(
        x * w,
        y * h,
        (0.003 + rand() * 0.05) * (y - 0.4) * w,
        Math.max(1, h * 0.001),
      );
    }
    const car = (x: number, y: number, s: number, white = false) => {
      poly(
        [
          [x, y],
          [x + s, y - s * 0.05],
          [x + s * 0.9, y - s * 0.3],
          [x + s * 0.2, y - s * 0.38],
        ],
        white ? '#bfc9cb' : '#26353f',
      );
      poly(
        [
          [x + s * 0.2, y - s * 0.38],
          [x + s * 0.3, y - s * 0.58],
          [x + s * 0.75, y - s * 0.58],
          [x + s * 0.9, y - s * 0.3],
        ],
        white ? '#d3d9db' : '#34454f',
      );
      c.fillStyle = '#354650';
      c.fillRect(
        (x + s * 0.35) * w,
        (y - s * 0.52) * h,
        s * 0.32 * w,
        s * 0.18 * h,
      );
      c.fillStyle = '#10191e';
      c.fillRect((x + s * 0.15) * w, y * h, s * 0.12 * w, s * 0.08 * h);
      c.fillRect(
        (x + s * 0.78) * w,
        (y - s * 0.025) * h,
        s * 0.12 * w,
        s * 0.08 * h,
      );
      c.fillStyle = white ? 'rgba(211,217,219,.12)' : 'rgba(17,23,27,.12)';
      c.fillRect(x * w, (y + s * 0.03) * h, s * w, s * 0.35 * h);
    };
    car(0.51, 0.58, 0.038);
    car(0.68, 0.72, 0.075);
    car(0.37, 0.84, 0.11);
    car(0.615, 0.625, 0.058, true);
    const haze = c.createLinearGradient(0, h * 0.34, 0, h * 0.64);
    haze.addColorStop(0, 'rgba(190,204,210,0)');
    haze.addColorStop(0.45, 'rgba(190,204,210,.25)');
    haze.addColorStop(1, 'rgba(190,204,210,0)');
    c.fillStyle = haze;
    c.fillRect(0, h * 0.32, w, h * 0.35);
    if (this.image) {
      const scale = Math.max(w / this.image.width, h / this.image.height);
      c.drawImage(
        this.image,
        (w - this.image.width * scale) / 2,
        (h - this.image.height * scale) / 2,
        this.image.width * scale,
        this.image.height * scale,
      );
    }
    this.grain.width = 128;
    this.grain.height = 128;
    const gc = this.grain.getContext('2d')!,
      data = gc.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = rand() * 255;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
      data.data[i + 3] = 12;
    }
    gc.putImageData(data, 0, 0);
  }
  paint(now: number) {
    const start = performance.now(),
      c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height,
      t = this.reduced.matches ? 0 : now / 1000;
    c.drawImage(this.base, 0, 0);
    if (!this.image) {
      for (let layer = 0; layer < 3; layer++) {
        const y =
          h * (0.36 + layer * 0.065 + Math.sin(t * 0.04 + layer) * 0.006);
        const fog = c.createLinearGradient(0, y - h * 0.06, 0, y + h * 0.06);
        fog.addColorStop(0, 'rgba(190,204,210,0)');
        fog.addColorStop(0.5, 'rgba(190,204,210,.035)');
        fog.addColorStop(1, 'rgba(190,204,210,0)');
        c.fillStyle = fog;
        c.fillRect(w * 0.3, y - h * 0.06, w * 0.5, h * 0.12);
      }
      for (let i = 0; i < 7; i++) {
        c.fillStyle = 'rgba(45,60,70,.045)';
        c.beginPath();
        c.ellipse(
          w * (0.63 + i * 0.055 + Math.sin(t * 0.07 + i) * 0.015),
          h * (0.12 + i * 0.018),
          w * 0.12,
          h * 0.055,
          0,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    }
    c.strokeStyle = 'rgba(216,228,232,.18)';
    c.lineWidth = 0.65;
    c.beginPath();
    for (let i = 0; i < 100; i++) {
      const x = (i * 173.3 + t * 13) % w,
        y = (i * 97.3 + t * 180) % h;
      c.moveTo(x, y);
      c.lineTo(x - 2, y + 10);
    }
    c.stroke();
    c.save();
    c.globalAlpha = 0.35;
    c.translate((Math.floor(t * 10) % 3) * 31, (Math.floor(t * 10) % 5) * 19);
    c.fillStyle = c.createPattern(this.grain, 'repeat')!;
    c.fillRect(-128, -128, w + 256, h + 256);
    c.restore();
    const vignette = c.createRadialGradient(
      w * 0.57,
      h * 0.4,
      w * 0.12,
      w * 0.6,
      h * 0.4,
      w * 0.8,
    );
    vignette.addColorStop(0, 'rgba(10,14,17,0)');
    vignette.addColorStop(1, 'rgba(10,14,17,.6)');
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, h);
    const ms = performance.now() - start;
    this.frames++;
    this.totalMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
  }
  loop = (now: number) => {
    if (!this.active || document.hidden) return;
    if (now - this.last >= 1000 / 30 || !now) {
      this.last = now;
      this.paint(now);
    }
    if (!this.reduced.matches) this.raf = requestAnimationFrame(this.loop);
  };
  get stats() {
    return {
      active: this.active,
      frames: this.frames,
      averageMs: this.totalMs / Math.max(1, this.frames),
      maxMs: this.maxMs,
      width: this.canvas.width,
      height: this.canvas.height,
      reducedMotion: this.reduced.matches,
      art: this.image ? 'asset' : 'procedural',
    };
  }
}
