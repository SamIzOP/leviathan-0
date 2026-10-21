import { BUTTON } from '@leviathan/shared';
import type { Input } from '@leviathan/shared';
export class InputReader {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  sensitivity = Number(localStorage.getItem('sensitivity') ?? 0.002);
  jump = false;
  debug = false;
  fallback = false;
  captureUnavailable = false;
  noticeDismissed = false;
  private activation = 0;
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };
  get active() {
    return document.pointerLockElement === this.canvas || this.fallback;
  }
  constructor(
    public canvas: HTMLCanvasElement,
    public onDebugCommand: (command: 'end' | 'robot') => void,
    public onOverlay: (kind: 'dev' | 'controls') => void = () => {},
    public onStateChange: () => void = () => {},
  ) {
    canvas.tabIndex = -1;
    document.addEventListener('keydown', (e) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);
      if (e.code === 'Escape' && this.active) {
        e.preventDefault();
        this.pause();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        return;
      }
      if (
        e.code === 'F4' ||
        (!typing && (e.code === 'Backquote' || e.code === 'KeyH'))
      ) {
        e.preventDefault();
        if (!e.repeat) onOverlay(e.code === 'KeyH' ? 'controls' : 'dev');
        return;
      }
      if (e.code === 'F3') {
        e.preventDefault();
        if (!e.repeat) this.debug = !this.debug;
        return;
      }
      if (!this.active || typing) return;
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)
      )
        e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jump = true;
      if (e.code === 'F8' && !e.repeat) onDebugCommand('end');
      if (e.code === 'F9' && !e.repeat) onDebugCommand('robot');
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        this.fallback = false;
        this.captureUnavailable = false;
        this.noticeDismissed = false;
        this.onStateChange();
      }
      if (!document.pointerLockElement) this.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.fallback || e.button !== 0) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      this.dragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    document.addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && !(this.fallback && this.dragging && e.buttons & 1)) return;
      const dx = locked ? e.movementX : e.clientX - this.lastMouse.x;
      const dy = locked ? e.movementY : e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * this.sensitivity;
      this.pitch = Math.max(
        -1.5,
        Math.min(1.5, this.pitch - dy * this.sensitivity),
      );
    });
  }
  async activate() {
    const activation = ++this.activation;
    this.canvas.focus({ preventScroll: true });
    // Embedded browsers can deny pointer lock. Keep play usable without it.
    const fallback = () => {
      if (
        activation !== this.activation ||
        document.pointerLockElement === this.canvas
      )
        return;
      this.fallback = true;
      this.captureUnavailable = true;
      this.onStateChange();
    };
    const timeout = window.setTimeout(fallback, 1000);
    document.addEventListener('pointerlockerror', fallback, { once: true });
    try {
      await Promise.race([
        this.canvas.requestPointerLock(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1050)),
      ]);
    } catch {
      fallback();
    } finally {
      if (document.pointerLockElement === this.canvas) clearTimeout(timeout);
      document.removeEventListener('pointerlockerror', fallback);
    }
  }
  pause() {
    ++this.activation;
    const changed = this.fallback;
    this.fallback = false;
    this.clear();
    if (changed) this.onStateChange();
  }
  clear() {
    this.keys.clear();
    this.jump = false;
    this.dragging = false;
  }
  command(seq: number, tick: number): Input {
    const input = {
      seq,
      tick,
      x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      z: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      yaw: this.yaw,
      pitch: this.pitch,
      buttons:
        (this.jump ? BUTTON.jump : 0) |
        (this.keys.has('ShiftLeft') ? BUTTON.sprint : 0),
    };
    this.jump = false;
    return input;
  }
}
