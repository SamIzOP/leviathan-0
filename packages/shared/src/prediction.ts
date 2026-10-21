import { stepPlayer } from './movement';
import type { Entity, Input, MoveState, Vec3, World } from './types';
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
/** Continuous fields tolerate cross-engine trig differences (last-ulp sin/cos of yaw
 * accumulating over a reconcile window); every discrete sub-state field is exact. */
export const RECONCILE_TOLERANCE = { position: 1e-4, velocity: 1e-3 };
const near = (a: Vec3, b: Vec3, t: number) =>
  Math.abs(a.x - b.x) <= t &&
  Math.abs(a.y - b.y) <= t &&
  Math.abs(a.z - b.z) <= t;
function sameMove(a?: MoveState, b?: MoveState) {
  if (!a || !b) return a === b;
  const t = RECONCILE_TOLERANCE.position;
  if (
    a.mode !== b.mode ||
    a.buttons !== b.buttons ||
    a.airJumps !== b.airJumps ||
    a.coyote !== b.coyote ||
    a.buffer !== b.buffer ||
    a.crouched !== b.crouched ||
    a.slideTicks !== b.slideTicks ||
    a.slideCooldown !== b.slideCooldown ||
    a.lockouts.length !== b.lockouts.length ||
    a.lockouts.some(
      (l, i) => l.id !== b.lockouts[i]!.id || l.ticks !== b.lockouts[i]!.ticks,
    )
  )
    return false;
  if (!!a.wall !== !!b.wall || !!a.mantle !== !!b.mantle) return false;
  if (a.wall && b.wall) {
    const w = a.wall,
      x = b.wall;
    if (
      w.id !== x.id ||
      w.axis !== x.axis ||
      w.dir !== x.dir ||
      w.run !== x.run ||
      w.ticks !== x.ticks ||
      Math.abs(w.plane - x.plane) > t ||
      Math.abs(w.rise - x.rise) > RECONCILE_TOLERANCE.velocity
    )
      return false;
  }
  if (a.mantle && b.mantle) {
    const m = a.mantle,
      n = b.mantle;
    if (
      m.ticks !== n.ticks ||
      m.total !== n.total ||
      m.axis !== n.axis ||
      m.dir !== n.dir ||
      !near(m.from, n.from, t) ||
      !near(m.to, n.to, t)
    )
      return false;
  }
  return true;
}
/** True when a predicted state matches the authoritative one in every movement field.
 * Look angles are excluded: they come straight from input and the render loop. */
export function predictionMatches(predicted: Entity, authoritative: Entity) {
  return (
    near(
      predicted.position,
      authoritative.position,
      RECONCILE_TOLERANCE.position,
    ) &&
    near(
      predicted.velocity,
      authoritative.velocity,
      RECONCILE_TOLERANCE.velocity,
    ) &&
    predicted.flags === authoritative.flags &&
    (predicted.motion ?? 0) === (authoritative.motion ?? 0) &&
    sameMove(predicted.move, authoritative.move)
  );
}
