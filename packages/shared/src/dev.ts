import { BUTTON, MOVE, type MoveTuning } from './config';
import { stepPlayer } from './movement';
import type { Entity, Input, World } from './types';

/** Every movement constant is tunable by name in a dev room. */
export type DevTuning = MoveTuning;
export const DEFAULT_TUNING: Readonly<DevTuning> = Object.freeze({ ...MOVE });
/** Starting presets for the live tuning panel; RESET returns to DEFAULT. */
export const TUNING_PRESETS: Record<
  'DEFAULT' | 'FLOATY' | 'HEAVY',
  Partial<DevTuning>
> = {
  DEFAULT: {},
  FLOATY: {
    gravity: 17,
    jumpHeight: 1.45,
    doubleJump: 6.2,
    airAccel: 22,
    airSpeed: 7.5,
    wallRunGravity: 0.08,
    wallRunTime: 2.8,
    slideDecel: 2.6,
  },
  HEAVY: {
    gravity: 32,
    jumpHeight: 1.15,
    doubleJump: 7.6,
    airAccel: 8,
    sprintAccel: 9,
    slideDecel: 5.2,
    wallRunGravity: 0.25,
    wallRunTime: 1.6,
  },
};
export interface DevState {
  solo: boolean;
  timerEnabled: boolean;
  frozen: boolean;
  remainingMs: number;
  tuning: DevTuning;
}
export const DEV_ACTIONS = [
  'end',
  'restart',
  'freeze',
  'timer',
  'lobby',
  'add-bots',
  'remove-bot',
  'spawn-dummies',
  'clear-dummies',
  'teleport',
  'reset-player',
  'tune',
  'reset-tuning',
] as const;
/** Deterministic six-second traversal routine for synthetic and harness bots:
 * sprint, slide, slide-jump, air jump, then a wandering walk; heading changes per cycle. */
export function traversalInput(tick: number, phase = 0): Input {
  const t = ((tick % 360) + 360) % 360,
    cycle = Math.floor(tick / 360);
  const held = (from: number, to: number) => t >= from && t < to;
  return {
    seq: 0,
    tick,
    x: held(200, 360) ? Math.sin(tick / 40 + phase) * 0.6 : 0,
    z: 1,
    yaw: phase * Math.PI * 2 + cycle * 1.1,
    pitch: 0,
    buttons:
      (held(0, 200) ? BUTTON.sprint : 0) |
      (held(90, 140) ? BUTTON.crouch : 0) |
      (held(130, 134) || held(160, 164) || held(300, 304) ? BUTTON.jump : 0),
  };
}
/** Dev rooms pass their tuning straight into the shared step; production uses MOVE.
 * Partial tunings resolve over the defaults identically on server and client. */
export function resolveTuning(tuning?: Partial<DevTuning>): MoveTuning {
  return tuning ? { ...MOVE, ...tuning } : MOVE;
}
export function stepDev(
  state: Entity,
  input: Input,
  dt: number,
  world: World,
  tuning?: Partial<DevTuning>,
): Entity {
  return stepPlayer(state, input, dt, world, resolveTuning(tuning));
}
export function reconcileDev(
  state: Entity,
  ack: number,
  pending: Input[],
  dt: number,
  world: World,
  tuning: Partial<DevTuning>,
) {
  const tune = resolveTuning(tuning);
  const remaining = pending.filter((i) => i.seq > ack);
  return {
    state: remaining.reduce((s, i) => stepPlayer(s, i, dt, world, tune), state),
    pending: remaining,
  };
}
