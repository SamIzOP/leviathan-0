/** Bounded dev-only frame recorder. No gameplay decisions depend on it. */
export class InputDiagnostics {
  enabled = false;
  recording = false;
  rawX = 0;
  rawY = 0;
  ticks = 0;
  lastEvent = { x: 0, y: 0 };
  corrections: { time: number; magnitude: number }[] = [];
  changes: string[] = [];
  private quality = '';
  private lastDraw = 0;
  private previousYaw = 0;
  private previousPitch = 0;
  private deltaYaw = 0;
  private deltaPitch = 0;
  private panel?: HTMLDivElement;
  private text?: HTMLPreElement;
  private graph?: HTMLCanvasElement;
  summary = '';
  events: { time: number; x: number; y: number }[] = [];
  frames: {
    time: number;
    ms: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    ticks: number;
  }[] = [];
  mouse(x: number, y: number) {
    this.lastEvent.x = x;
    this.lastEvent.y = y;
    this.rawX += x;
    this.rawY += y;
    if (this.recording && this.events.length < 100000)
      this.events.push({ time: performance.now(), x, y });
  }
  correction(magnitude: number) {
    this.corrections.push({ time: performance.now(), magnitude });
    if (this.corrections.length > 1000) this.corrections.shift();
  }
  update(
    time: number,
    preset: string,
    width: number,
    height: number,
    discarded: number,
    wall: string,
  ) {
    const quality = `${preset} ${width}×${height}`;
    if (quality !== this.quality) {
      this.quality = quality;
      this.changes.push(`${(time / 1000).toFixed(1)}s ${quality}`);
      if (this.changes.length > 12) this.changes.shift();
    }
    if (time - this.lastDraw < 100) return;
    this.lastDraw = time;
    const recent = this.frames.filter((f) => time - f.time <= 5000),
      f = recent.at(-1);
    const corrections = this.corrections.filter((c) => time - c.time <= 1000);
    if (f)
      this.summary = `INPUT ${f.ms.toFixed(1)} ms / TICKS ${f.ticks}\n5 S >20 / >33 MS ${recent.filter((f) => f.ms > 20).length} / ${recent.filter((f) => f.ms > 33).length}\nRAW EVENT ${this.lastEvent.x}, ${this.lastEvent.y} / FRAME ${f.x}, ${f.y}\nLOOK Δ ${this.deltaYaw.toFixed(5)}, ${this.deltaPitch.toFixed(5)}\nCORRECTIONS/S ${corrections.length} / MAX ${Math.max(0, ...corrections.map((c) => c.magnitude)).toFixed(4)} m\nSPIKES DISCARDED ${discarded} / ${quality}\n${wall}`;
    if (!this.enabled) {
      if (this.panel) this.panel.hidden = true;
      return;
    }
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.style.cssText =
        'position:fixed;right:16px;bottom:20px;z-index:40;background:#071014f5;color:#e7eded;padding:12px;pointer-events:none;font:12px monospace';
      this.text = document.createElement('pre');
      this.graph = document.createElement('canvas');
      this.graph.width = 420;
      this.graph.height = 80;
      this.panel.append(this.text, this.graph);
      document.body.append(this.panel);
    }
    this.panel.hidden = false;
    this.text!.textContent =
      'INPUT DIAGNOSTICS\n' +
      this.summary +
      '\n' +
      this.changes.slice(-3).join('\n');
    const c = this.graph!.getContext('2d')!;
    c.clearRect(0, 0, 420, 80);
    c.strokeStyle = '#d8c464';
    c.beginPath();
    recent.forEach((f, i) => {
      const x = 420 - ((time - f.time) / 5000) * 420,
        y = 80 - Math.min(80, f.ms);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.stroke();
  }
  frame(time: number, ms: number, yaw: number, pitch: number) {
    this.deltaYaw = yaw - this.previousYaw;
    this.deltaPitch = pitch - this.previousPitch;
    this.previousYaw = yaw;
    this.previousPitch = pitch;
    {
      this.frames.push({
        time,
        ms,
        x: this.rawX,
        y: this.rawY,
        yaw,
        pitch,
        ticks: this.ticks,
      });
      if (this.frames.length > 4096) this.frames.shift();
    }
    this.rawX = this.rawY = this.ticks = 0;
  }
  reset() {
    this.frames = [];
    this.events = [];
    this.rawX = this.rawY = 0;
    this.recording = true;
  }
}
