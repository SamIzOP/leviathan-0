import { PHYSICS } from './config';
import { stepPlayer } from './movement';
import type { Entity, Input, World } from './types';

export interface DevTuning {
  walk: number;
  sprint: number;
  jumpHeight: number;
  gravity: number;
}
export const DEFAULT_TUNING: Readonly<DevTuning> = Object.freeze({
  walk: PHYSICS.walk,
  sprint: PHYSICS.sprint,
  jumpHeight: PHYSICS.jump ** 2 / (2 * PHYSICS.gravity),
  gravity: PHYSICS.gravity,
});
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
// Dev-only synchronous adapter around the shared deterministic movement module.
// Restore constants in finally so tuning cannot leak across rooms or into production.
export function stepDev(
  state: Entity,
  input: Input,
  dt: number,
  world: World,
  tuning?: DevTuning,
): Entity {
  if (!tuning) return stepPlayer(state, input, dt, world);
  const original = { ...PHYSICS };
  try {
    Object.assign(PHYSICS, {
      walk: tuning.walk,
      sprint: tuning.sprint,
      gravity: tuning.gravity,
      jump: Math.sqrt(2 * tuning.gravity * tuning.jumpHeight),
    });
    return stepPlayer(state, input, dt, world);
  } finally {
    Object.assign(PHYSICS, original);
  }
}
export function reconcileDev(
  state: Entity,
  ack: number,
  pending: Input[],
  dt: number,
  world: World,
  tuning: DevTuning,
) {
  const remaining = pending.filter((i) => i.seq > ack);
  return {
    state: remaining.reduce((s, i) => stepDev(s, i, dt, world, tuning), state),
    pending: remaining,
  };
}
