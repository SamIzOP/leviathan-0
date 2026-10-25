import { BUTTON, FIRE_BUTTON, WEAPONS } from '@leviathan/shared';
import type { Input } from '@leviathan/shared';
import { movementSettings } from './movement-settings';
import { LookPipeline } from './look-pipeline';
/** One scripted input step for the dev-only browser test hook. */
export interface InjectedInput {
  ticks: number;
  x?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  buttons?: number;
  weapon?: number;
}
const LOCKED_KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyC',
  'Space',
  'ShiftLeft',
  'ControlLeft',
];
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
  crouchToggled = false;
  injected: InjectedInput[] = [];
  onMouse?: (x: number, y: number) => void;
  look = new LookPipeline();
  /** Look scale while aiming down sights (ADS sensitivity × zoom), set per frame. */
  lookScale = 1;
  /** Wanted weapon slot; the shared step switches only to owned tiers. */
  slot = 0;
  owned = 0b11;
  private fireHeld = false;
  private adsHeld = false;
  private latched = 0;
  mouse(x: number, y: number) {
    this.onMouse?.(x, y);
    this.look.add(x, y);
  }
  frameLook() {
    const delta = this.look.flush();
    this.yaw -= delta.x * this.sensitivity * this.lookScale;
    this.pitch = Math.max(
      -1.5,
      Math.min(1.5, this.pitch - delta.y * this.sensitivity * this.lookScale),
    );
  }
  private crouchTap = false;
  private activation = 0;
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };
  get active() {
    return document.pointerLockElement === this.canvas || this.fallback;
  }
  private crouchKey(code: string) {
    return (
      code === 'KeyC' || (movementSettings.ctrlCrouch && code === 'ControlLeft')
    );
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
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyC'].includes(
          e.code,
        ) ||
        this.crouchKey(e.code)
      )
        e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jump = true;
      if (this.crouchKey(e.code) && !e.repeat) {
        this.crouchTap = true;
        this.crouchToggled = !this.crouchToggled;
      }
      if (!e.repeat) {
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (digit && Number(digit[1]) <= WEAPONS.length)
          this.selectSlot(Number(digit[1]) - 1);
        if (e.code === 'KeyR') this.latched |= FIRE_BUTTON.reload;
        if (e.code === 'KeyG') this.latched |= FIRE_BUTTON.oil;
        if (e.code === 'KeyQ') this.latched |= FIRE_BUTTON.fingers;
        if (e.code === 'KeyF') this.latched |= FIRE_BUTTON.fire;
      }
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
    // Combat mouse buttons: left fires and right aims while the pointer is captured.
    // In drag-look fallback the left button looks, so F fires instead.
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) {
        this.fireHeld = true;
        this.latched |= FIRE_BUTTON.fire;
      }
      if (e.button === 2) this.adsHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.adsHeld = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || !e.deltaY) return;
        const n = WEAPONS.length;
        for (let k = 1; k <= n; k++) {
          const next = (this.slot + Math.sign(e.deltaY) * k + n * 4) % n;
          if (this.owned & (1 << next)) {
            this.selectSlot(next);
            break;
          }
        }
      },
      { passive: true },
    );
    canvas.addEventListener('mousedown', (e) => {
      if (!this.fallback || e.button !== 0) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      this.dragging = true;
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
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
      this.mouse(dx, dy);
    });
  }
  /** With Ctrl crouch enabled, capture enters fullscreen and asks for keyboard lock
   * so Ctrl combinations (Ctrl+W) reach the game instead of closing the tab. */
  private async lockKeyboard() {
    if (!movementSettings.ctrlCrouch) return;
    const keyboard = (
      navigator as Navigator & {
        keyboard?: { lock?: (codes?: string[]) => Promise<void> };
      }
    ).keyboard;
    try {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      await keyboard?.lock?.(LOCKED_KEYS);
    } catch {
      /* unsupported or denied: C remains the safe crouch key */
    }
  }
  async activate() {
    const activation = ++this.activation;
    this.canvas.focus({ preventScroll: true });
    await this.lockKeyboard();
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
        Promise.resolve(
          this.canvas.requestPointerLock({ unadjustedMovement: true }),
        ).catch(() => this.canvas.requestPointerLock()),
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
  selectSlot(slot: number) {
    if (this.owned & (1 << slot)) this.slot = slot;
  }
  clear() {
    this.fireHeld = false;
    this.adsHeld = false;
    this.latched = 0;
    this.look.clear();
    this.keys.clear();
    this.jump = false;
    this.crouchTap = false;
    this.crouchToggled = false;
    this.dragging = false;
  }
  /** Held button state, with one-command latches so taps between ticks still register. */
  command(seq: number, tick: number): Input {
    const step = this.injected[0];
    if (step) {
      if (step.yaw !== undefined) this.yaw = step.yaw;
      if (step.pitch !== undefined) this.pitch = step.pitch;
      if (--step.ticks <= 0) this.injected.shift();
      return {
        seq,
        tick,
        x: step.x ?? 0,
        z: step.z ?? 0,
        yaw: this.yaw,
        pitch: this.pitch,
        buttons: step.buttons ?? 0,
        weapon: step.weapon ?? this.slot,
      };
    }
    const crouchHeld =
      this.keys.has('KeyC') ||
      (movementSettings.ctrlCrouch && this.keys.has('ControlLeft'));
    const crouch =
      movementSettings.crouchMode === 'TOGGLE'
        ? this.crouchToggled
        : crouchHeld || this.crouchTap;
    const shift = this.keys.has('ShiftLeft');
    const sprint = movementSettings.sprintMode === 'AUTO' ? !shift : shift;
    const input = {
      seq,
      tick,
      x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      z: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      yaw: this.yaw,
      pitch: this.pitch,
      buttons:
        (this.keys.has('Space') || this.jump ? BUTTON.jump : 0) |
        (sprint ? BUTTON.sprint : 0) |
        (crouch ? BUTTON.crouch : 0) |
        (this.fireHeld || this.keys.has('KeyF') ? FIRE_BUTTON.fire : 0) |
        (this.adsHeld ? FIRE_BUTTON.ads : 0) |
        this.latched,
      weapon: this.slot,
    };
    this.jump = false;
    this.crouchTap = false;
    this.latched = 0;
    return input;
  }
}
