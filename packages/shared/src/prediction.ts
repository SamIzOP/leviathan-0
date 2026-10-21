import { stepPlayer } from './movement';
import type { Entity, Input, World } from './types';
export function reconcile(
  authoritative: Entity,
  ack: number,
  pending: Input[],
  dt: number,
  world: World,
): { state: Entity; pending: Input[] } {
  const remaining = pending.filter((i) => i.seq > ack);
  return {
    state: remaining.reduce(
      (s, i) => stepPlayer(s, i, dt, world),
      authoritative,
    ),
    pending: remaining,
  };
}
