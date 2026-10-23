// Only implausible isolated events are delayed for one frame of confirmation.
export const MOUSE_SPIKE_FLOOR = 2048;
export const MOUSE_SPIKE_MEDIAN_MULTIPLIER = 32;
export class LookPipeline {
  x = 0;
  y = 0;
  discarded = 0;
  private history = new Float64Array(31);
  private sorted = new Float64Array(31);
  private count = 0;
  private cursor = 0;
  private suspectX = 0;
  private suspectY = 0;
  private pending = false;
  private following = 0;
  private age = 0;
  add(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const size = Math.hypot(x, y);
    this.sorted.set(this.history);
    this.sorted.sort();
    const median = this.sorted[30 - Math.floor(this.count / 2)] ?? 0;
    const limit = Math.max(
      MOUSE_SPIKE_FLOOR,
      median * MOUSE_SPIKE_MEDIAN_MULTIPLIER,
    );
    if (this.pending) this.following = Math.max(this.following, size);
    if (size > limit && !this.pending) {
      this.suspectX = x;
      this.suspectY = y;
      this.pending = true;
      this.age = 0;
    } else {
      this.x += x;
      this.y += y;
    }
    if (size <= limit) {
      this.history[this.cursor] = size;
      this.cursor = (this.cursor + 1) % this.history.length;
      this.count = Math.min(this.history.length, this.count + 1);
    }
  }
  flush(): { x: number; y: number } {
    const result = { x: this.x, y: this.y };
    this.x = this.y = 0;
    if (this.pending) {
      // A sustained flick supplies corroborating large events in this frame.
      if (this.following >= Math.hypot(this.suspectX, this.suspectY) / 8) {
        result.x += this.suspectX;
        result.y += this.suspectY;
        this.pending = false;
      } else if (this.age++ > 0) {
        this.discarded++;
        this.pending = false;
      }
      if (!this.pending) this.following = 0;
    }
    return result;
  }
  clear() {
    this.x = this.y = this.suspectX = this.suspectY = this.following = 0;
    this.pending = false;
  }
}
export function interpolatePosition(
  previous: { x: number; y: number; z: number },
  current: { x: number; y: number; z: number },
  alpha: number,
  out: { x: number; y: number; z: number },
) {
  const t = Math.max(0, Math.min(1, alpha));
  out.x = previous.x + (current.x - previous.x) * t;
  out.y = previous.y + (current.y - previous.y) * t;
  out.z = previous.z + (current.z - previous.z) * t;
  return out;
}
