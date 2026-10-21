import { BUTTON, BUTTON_MASK, FLAG, MOTION, MOVE, PHYSICS } from './config';
import type { MoveTuning } from './config';
import type {
  Box,
  Entity,
  Input,
  MantleState,
  MoveMode,
  MoveState,
  Vec3,
  WallContact,
  World,
} from './types';
export const ARENA: World = {
  floor: 0,
  boxes: [
    { min: { x: 3, y: 0, z: 3 }, max: { x: 6, y: 2, z: 6 } },
    { min: { x: -7, y: 0, z: -4 }, max: { x: -4, y: 3, z: 0 } },
  ],
};
export const MODES: readonly MoveMode[] = [
  'GROUND',
  'CROUCH',
  'SLIDE',
  'AIR',
  'WALLRUN',
  'MANTLE',
];
const GROUNDED: ReadonlySet<MoveMode> = new Set(['GROUND', 'CROUCH', 'SLIDE']);
// Vertical and horizontal contact tolerances: clamped faces may differ by an ulp.
const EPS = 1e-7,
  SIDE = 1e-9;
type Axis = 'x' | 'z';
const other = (a: Axis): Axis => (a === 'x' ? 'z' : 'x');
export function initialMove(grounded = true): MoveState {
  return {
    mode: grounded ? 'GROUND' : 'AIR',
    buttons: 0,
    airJumps: 1,
    coyote: 0,
    buffer: 0,
    crouched: false,
    slideTicks: 0,
    slideCooldown: 0,
    wall: null,
    lockouts: [],
    mantle: null,
  };
}
export function cloneMove(m: MoveState): MoveState {
  return {
    ...m,
    wall: m.wall && { ...m.wall },
    lockouts: m.lockouts.map((l) => ({ ...l })),
    mantle: m.mantle && {
      ...m.mantle,
      from: { ...m.mantle.from },
      to: { ...m.mantle.to },
    },
  };
}
export function makeEntity(id: string, index = 0): Entity {
  return {
    id,
    type: 'player',
    position: { x: (index % 4) * 2 - 3, y: 0, z: Math.floor(index / 4) * 2 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    flags: FLAG.grounded,
    motion: 0,
  };
}
export function sanitizeInput(i: Input): Input {
  return {
    ...i,
    x: Math.max(-1, Math.min(1, i.x)),
    z: Math.max(-1, Math.min(1, i.z)),
    yaw: ((i.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    pitch: Math.max(-1.5, Math.min(1.5, i.pitch)),
    buttons: i.buttons & BUTTON_MASK,
  };
}
export const moveMode = (motion = 0): MoveMode =>
  MODES[motion & MOTION.mode] ?? 'GROUND';
export function motionBits(m: MoveState, yaw: number): number {
  let bits = MODES.indexOf(m.mode) & MOTION.mode;
  if (m.crouched) bits |= MOTION.crouch;
  if (m.mode === 'SLIDE') bits |= MOTION.slide;
  if (m.wall) {
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    if (right[m.wall.axis] * m.wall.dir > 0) bits |= MOTION.wallRight;
  }
  return bits;
}
/** Strict AABB overlap: touching faces never collide. */
function overlapsRange(
  b: Box,
  x: number,
  z: number,
  r: number,
  y0: number,
  y1: number,
) {
  return (
    x + r > b.min.x + SIDE &&
    x - r < b.max.x - SIDE &&
    z + r > b.min.z + SIDE &&
    z - r < b.max.z - SIDE &&
    y1 > b.min.y + EPS &&
    y0 < b.max.y - EPS
  );
}
function clearAt(
  boxes: readonly Box[],
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
) {
  for (const b of boxes) if (overlapsRange(b, x, z, r, y, y + h)) return false;
  return true;
}
/** Highest supporting top (or world floor) under the footprint within [minY, y]. */
function supportBelow(
  boxes: readonly Box[],
  floor: number,
  x: number,
  y: number,
  z: number,
  r: number,
  minY: number,
) {
  let top = floor <= y + EPS && floor >= minY - EPS ? floor : -Infinity;
  for (const b of boxes)
    if (
      x + r > b.min.x + SIDE &&
      x - r < b.max.x - SIDE &&
      z + r > b.min.z + SIDE &&
      z - r < b.max.z - SIDE &&
      b.max.y <= y + EPS &&
      b.max.y >= minY - EPS &&
      b.max.y > top
    )
      top = b.max.y;
  return top;
}
/** Swept axis test: the nearest face ahead of the leading side, or none.
 * Boxes already overlapping the hull never block, so embedded states can escape. */
function sweep(
  boxes: readonly Box[],
  p: Vec3,
  a: Axis,
  delta: number,
  r: number,
  h: number,
): { travel: number; hit: Box | null } {
  const o = other(a),
    sign = delta > 0 ? 1 : -1,
    lead = p[a] + sign * r;
  let best = Math.abs(delta),
    hit: Box | null = null;
  for (const b of boxes) {
    if (!(p[o] + r > b.min[o] + SIDE && p[o] - r < b.max[o] - SIDE)) continue;
    if (!(p.y + h > b.min.y + EPS && p.y < b.max.y - EPS)) continue;
    const gap = ((sign > 0 ? b.min[a] : b.max[a]) - lead) * sign;
    if (gap < -1e-9 || gap >= best) continue;
    best = Math.max(0, gap);
    hit = b;
  }
  return { travel: best * sign, hit };
}
const faceOf = (b: Box, a: Axis, dir: number) =>
  dir > 0 ? b.min[a] : b.max[a];
/** The face met when moving along `dir`; its outward normal points against `dir`. */
const runnable = (b: Box, a: Axis, dir: number) =>
  !!b.wallRunnable &&
  (!b.runFaces ||
    (b.runFaces as readonly string[]).includes(`${dir > 0 ? '-' : '+'}${a}`));
/** Wall-run continuation: a coplanar runnable face still beside the torso. */
function wallBeside(
  boxes: readonly Box[],
  w: WallContact,
  p: Vec3,
  locked: (id: string) => boolean,
): Box | null {
  const o = other(w.axis);
  for (const b of boxes) {
    if (!runnable(b, w.axis, w.dir) || (b.id !== w.id && locked(b.id ?? '')))
      continue;
    if (Math.abs(faceOf(b, w.axis, w.dir) - w.plane) > 1e-6) continue;
    if (!(p[o] > b.min[o] && p[o] < b.max[o])) continue;
    if (!(b.min.y < p.y + 1.3 && b.max.y > p.y + 0.5)) continue;
    return b;
  }
  return null;
}
export interface WallProbe {
  box: Box;
  axis: Axis;
  dir: 1 | -1;
  plane: number;
  gap: number;
}
export interface MantleProbe {
  box: Box;
  axis: Axis;
  dir: 1 | -1;
  top: number;
  target: Vec3;
}
/** Runnable faces within reach of the hull side, nearest first. */
export function wallCandidates(
  boxes: readonly Box[],
  p: Vec3,
  reach: number,
  locked: (id: string) => boolean = () => false,
): WallProbe[] {
  const r = PHYSICS.radius,
    found: WallProbe[] = [];
  for (const b of boxes) {
    if (!b.wallRunnable || locked(b.id ?? '')) continue;
    if (!(b.min.y < p.y + 1.3 && b.max.y > p.y + 0.5)) continue;
    for (const axis of ['x', 'z'] as const) {
      const o = other(axis);
      if (!(p[o] > b.min[o] && p[o] < b.max[o])) continue;
      for (const dir of [1, -1] as const) {
        if (!runnable(b, axis, dir)) continue;
        const plane = faceOf(b, axis, dir),
          gap = (plane - (p[axis] + dir * r)) * dir;
        if (gap >= -1e-6 && gap <= reach)
          found.push({ box: b, axis, dir, plane, gap });
      }
    }
  }
  return found.sort((a, b) => a.gap - b.gap);
}
/** Valid mantle targets in front of the operator, best (highest) first. */
export function mantleCandidates(
  boxes: readonly Box[],
  p: Vec3,
  facing: { x: number; z: number },
  tune: MoveTuning,
): MantleProbe[] {
  const r = PHYSICS.radius,
    h = PHYSICS.height,
    cone = Math.cos((tune.mantleFacing * Math.PI) / 180);
  const found: (MantleProbe & { gap: number })[] = [];
  for (const b of boxes) {
    if (!b.mantleable) continue;
    const rel = b.max.y - p.y;
    if (rel < tune.mantleMin - EPS || rel > tune.mantleMax + EPS) continue;
    for (const axis of ['x', 'z'] as const) {
      const o = other(axis);
      if (!(p[o] > b.min[o] && p[o] < b.max[o])) continue;
      for (const dir of [1, -1] as const) {
        if (facing[axis] * dir < cone) continue;
        const plane = faceOf(b, axis, dir),
          gap = (plane - (p[axis] + dir * r)) * dir;
        if (gap < -1e-6 || gap > tune.mantleReach) continue;
        const target = { ...p, y: b.max.y };
        target[axis] = plane + dir * (r + 0.05);
        found.push({ box: b, axis, dir, top: b.max.y, target, gap });
      }
    }
  }
  found.sort((a, b) => b.top - a.top || a.gap - b.gap);
  return found.filter((c) => {
    const lo = Math.min(p[c.axis], c.target[c.axis]),
      hi = Math.max(p[c.axis], c.target[c.axis]);
    const span = (b: Box, y0: number, y1: number) =>
      overlapsRange(b, p.x, p.z, r, y0, y1);
    const path = (b: Box) => {
      const o = other(c.axis);
      return (
        hi + r > b.min[c.axis] + SIDE &&
        lo - r < b.max[c.axis] - SIDE &&
        p[o] + r > b.min[o] + SIDE &&
        p[o] - r < b.max[o] - SIDE &&
        c.top + h > b.min.y + EPS &&
        c.top < b.max.y - EPS
      );
    };
    // Rising column beside the face, then the standing hull across the edge.
    if (boxes.some((b) => span(b, p.y, c.top + h) || path(b))) return false;
    return boxes.some(
      (b) =>
        Math.abs(b.max.y - c.top) <= 1e-6 &&
        c.target.x + r > b.min.x + SIDE &&
        c.target.x - r < b.max.x - SIDE &&
        c.target.z + r > b.min.z + SIDE &&
        c.target.z - r < b.max.z - SIDE,
    );
  });
}
/** Deterministic eased climb: rise beside the face first, then step over the edge. */
export function mantlePoint(m: MantleState, frac: number): Vec3 {
  const up = Math.min(1, frac / 0.55),
    fw = Math.max(0, Math.min(1, (frac - 0.55) / 0.45));
  const ey = 1 - (1 - up) ** 3,
    ef = fw * fw * (3 - 2 * fw);
  return {
    x: m.from.x + (m.to.x - m.from.x) * ef,
    y: m.from.y + (m.to.y - m.from.y) * ey,
    z: m.from.z + (m.to.z - m.from.z) * ef,
  };
}
/** Pure, fixed-step movement state machine. The authoritative sim and client
 * prediction call exactly this function; all state lives in `state.move`.
 * Tick order is documented in ARCHITECTURE.md. */
export function stepPlayer(
  state: Entity,
  raw: Input,
  dt: number,
  world: World,
  tune: MoveTuning = MOVE,
): Entity {
  const s: Entity = {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
  };
  const m = state.move
    ? cloneMove(state.move)
    : initialMove(!!(state.flags & FLAG.grounded));
  s.move = m;
  if (s.flags & FLAG.disconnected) {
    s.motion = motionBits(m, s.yaw);
    return s;
  }
  // 1. Input: sanitize, facing vectors once per tick, held bits and derived edges.
  const i = sanitizeInput(raw);
  s.yaw = i.yaw;
  s.pitch = i.pitch;
  const p = s.position,
    v = s.velocity,
    r = PHYSICS.radius;
  const ticks = (seconds: number) => Math.max(0, Math.round(seconds / dt));
  const sin = Math.sin(i.yaw),
    cos = Math.cos(i.yaw);
  const forward = { x: -sin, z: -cos },
    right = { x: cos, z: -sin };
  const norm = Math.max(1, Math.hypot(i.x, i.z));
  const wish = {
    x: (i.x * right.x + i.z * forward.x) / norm,
    z: (i.x * right.z + i.z * forward.z) / norm,
  };
  const wishLen = Math.hypot(wish.x, wish.z);
  const wishDir =
    wishLen > 1e-9
      ? { x: wish.x / wishLen, z: wish.z / wishLen }
      : { x: 0, z: 0 };
  const jumpHeld = !!(i.buttons & BUTTON.jump),
    crouchHeld = !!(i.buttons & BUTTON.crouch),
    sprintHeld = !!(i.buttons & BUTTON.sprint);
  const jumpPressed = jumpHeld && !(m.buttons & BUTTON.jump),
    crouchPressed = crouchHeld && !(m.buttons & BUTTON.crouch);
  m.buttons = i.buttons;
  // 2. Tick counters: coyote, buffer, cooldown, per-wall lockouts.
  if (m.coyote > 0) m.coyote--;
  if (m.buffer > 0) m.buffer--;
  if (m.slideCooldown > 0) m.slideCooldown--;
  if (m.lockouts.length) {
    for (const l of m.lockouts) l.ticks--;
    m.lockouts = m.lockouts.filter((l) => l.ticks > 0);
  }
  if (jumpPressed) m.buffer = Math.max(1, ticks(tune.jumpBuffer));
  // 3. One broadphase query covers the sweep plus every probe this tick.
  const reach = Math.hypot(v.x, v.z) * dt + r + 1.8;
  const boxes =
    world.query?.(p.x - reach, p.z - reach, p.x + reach, p.z + reach) ??
    world.boxes;
  const locked = (id: string) => m.lockouts.some((l) => l.id === id);
  const lockout = (id: string) => {
    m.lockouts = m.lockouts.filter((l) => l.id !== id);
    const t = ticks(tune.wallRunLockout);
    if (t > 0) m.lockouts.push({ id, ticks: t });
  };
  const canStand = () => clearAt(boxes, p.x, p.y, p.z, r, PHYSICS.height);
  // Impulses add half a step of gravity so the fixed-step apex equals the analytic one
  // (jumpHeight is the measured apex, never below the placeholder's 1.225 m).
  const kick = (speed: number) => speed + (tune.gravity * dt) / 2;
  const jumpVelocity = kick(Math.sqrt(2 * tune.gravity * tune.jumpHeight));
  // One jump per tick: a ground, slide, wall or air jump consumes the press.
  let jumped = false,
    jumpUsed = false;
  const groundJump = () => {
    if (m.crouched && canStand()) m.crouched = false;
    v.y = jumpVelocity;
    m.mode = 'AIR';
    m.buffer = 0;
    m.coyote = 0;
    jumped = jumpUsed = true;
  };
  const endSlide = () => {
    m.slideTicks = 0;
    m.slideCooldown = Math.max(m.slideCooldown, ticks(tune.slideCooldown));
  };
  const startSlide = () => {
    const speed = Math.hypot(v.x, v.z),
      entry = Math.min(
        tune.slideMaxEntry,
        Math.max(speed, tune.slideBase) * tune.slideBoost,
      );
    const dir = speed > 1e-6 ? { x: v.x / speed, z: v.z / speed } : forward;
    v.x = dir.x * entry;
    v.z = dir.z * entry;
    m.mode = 'SLIDE';
    m.crouched = true;
    m.slideTicks = 0;
  };
  const leaveWall = (push: number) => {
    const w = m.wall!;
    lockout(w.id);
    v[w.axis] = -w.dir * push;
    m.wall = null;
    m.mode = 'AIR';
  };
  // 4. State logic: transitions and velocity for the current state.
  let integrate = true;
  if (m.mode === 'MANTLE' && m.mantle) {
    const mt = m.mantle;
    integrate = false;
    if (crouchPressed) {
      m.mantle = null;
      m.mode = 'AIR';
      v.x = v.y = v.z = 0;
      integrate = true;
    } else {
      mt.ticks++;
      const prev = { ...p };
      if (mt.ticks >= mt.total) {
        Object.assign(p, mt.to);
        v.x = v.z = 0;
        v[mt.axis] = mt.dir * tune.mantleExit;
        v.y = 0;
        m.mantle = null;
        m.mode = 'GROUND';
        m.airJumps = 1;
        m.lockouts = [];
      } else {
        Object.assign(p, mantlePoint(mt, mt.ticks / mt.total));
        v.x = (p.x - prev.x) / dt;
        v.y = (p.y - prev.y) / dt;
        v.z = (p.z - prev.z) / dt;
      }
    }
  } else if (m.mode === 'MANTLE') m.mode = 'AIR';
  if (m.mode === 'GROUND' || m.mode === 'CROUCH') {
    const speed = Math.hypot(v.x, v.z);
    if (
      crouchPressed &&
      sprintHeld &&
      m.mode === 'GROUND' &&
      speed >= tune.slideMinStart &&
      m.slideCooldown === 0
    )
      startSlide();
    else if (crouchHeld) {
      m.mode = 'CROUCH';
      m.crouched = true;
    } else if (m.crouched) {
      if (canStand()) {
        m.crouched = false;
        m.mode = 'GROUND';
      } else m.mode = 'CROUCH';
    } else m.mode = 'GROUND';
  }
  if (m.mode === 'GROUND' || m.mode === 'CROUCH') {
    const sprinting = sprintHeld && i.z > 0.1 && m.mode === 'GROUND';
    const target =
      (m.mode === 'CROUCH'
        ? tune.crouch
        : sprinting
          ? tune.sprint
          : tune.walk) * wishLen;
    if (wishLen < 1e-9) {
      const speed = Math.hypot(v.x, v.z);
      const keep =
        speed > 1e-9 ? Math.max(0, speed - tune.groundDecel * dt) / speed : 0;
      v.x *= keep;
      v.z *= keep;
    } else {
      const par = v.x * wishDir.x + v.z * wishDir.z;
      let px = v.x - par * wishDir.x,
        pz = v.z - par * wishDir.z;
      const perp = Math.hypot(px, pz),
        keep =
          perp > 1e-9 ? Math.max(0, perp - tune.groundDecel * dt) / perp : 0;
      px *= keep;
      pz *= keep;
      const next =
        par < target
          ? Math.min(
              target,
              par +
                (par < tune.walk ? tune.groundAccel : tune.sprintAccel) * dt,
            )
          : Math.max(
              target,
              par -
                (par > tune.sprint + 0.25
                  ? tune.overspeedDecel
                  : tune.groundDecel) *
                  dt,
            );
      v.x = next * wishDir.x + px;
      v.z = next * wishDir.z + pz;
    }
    if (m.buffer > 0) groundJump();
  } else if (m.mode === 'SLIDE') {
    if (m.buffer > 0) {
      // Slide-jump keeps the slide momentum and adds a small forward boost.
      const speed = Math.hypot(v.x, v.z);
      if (speed > 1e-6) {
        const boost = (speed + tune.slideJumpBoost) / speed;
        v.x *= boost;
        v.z *= boost;
      }
      endSlide();
      groundJump();
    } else if (!crouchHeld) {
      endSlide();
      if (canStand()) {
        m.crouched = false;
        m.mode = 'GROUND';
      } else m.mode = 'CROUCH';
    } else {
      m.slideTicks++;
      let speed = Math.hypot(v.x, v.z);
      if (speed > 1e-6) {
        let dx = v.x / speed,
          dz = v.z / speed;
        if (wishLen > 1e-9) {
          // Limited steering: rotate toward the wish direction by a small angle.
          const dot = dx * wishDir.x + dz * wishDir.z;
          const ux = wishDir.x - dot * dx,
            uz = wishDir.z - dot * dz,
            ul = Math.hypot(ux, uz);
          if (ul > 1e-9 && dot > -0.2) {
            const turn = tune.slideSteer * dt * Math.min(1, ul);
            dx += (ux / ul) * turn;
            dz += (uz / ul) * turn;
            const dl = Math.hypot(dx, dz);
            dx /= dl;
            dz /= dl;
          }
        }
        speed = Math.max(0, speed - tune.slideDecel * dt);
        v.x = dx * speed;
        v.z = dz * speed;
      }
      if (speed <= tune.slideEnd) {
        endSlide();
        m.mode = 'CROUCH';
      }
    }
  } else if (m.mode === 'WALLRUN' && m.wall) {
    const w = m.wall,
      o = other(w.axis);
    if (jumpPressed) {
      // Wall-jump: away from the wall, keep along-wall speed, restore an air jump.
      const along = v[o];
      lockout(w.id);
      v[w.axis] = -w.dir * tune.wallJumpAway;
      v[o] = along;
      v.y = kick(tune.wallJumpUp);
      m.airJumps = Math.max(m.airJumps, 1);
      m.wall = null;
      m.mode = 'AIR';
      m.buffer = 0;
      jumpUsed = true;
    } else if (crouchPressed) leaveWall(1);
    else {
      w.ticks++;
      const t = w.ticks * dt;
      let along = Math.abs(v[o]);
      if (along < tune.wallRunSpeed)
        along = Math.min(tune.wallRunSpeed, along + tune.wallRunAccel * dt);
      v[o] = w.run * along;
      v[w.axis] = 0;
      v.y =
        t < tune.wallRunRiseTime
          ? w.rise * (1 - t / tune.wallRunRiseTime)
          : Math.max(
              -tune.wallRunSink,
              v.y - tune.gravity * tune.wallRunGravity * dt,
            );
      if (t >= tune.wallRunTime - 1e-9 || along < tune.wallRunEndSpeed)
        leaveWall(0);
    }
  } else if (m.mode === 'WALLRUN') m.mode = 'AIR';
  if (m.mode === 'AIR' && integrate) {
    if (m.crouched && canStand()) m.crouched = false;
    if (jumpUsed) {
      /* this tick's press already launched the operator */
    } else if (m.buffer > 0 && m.coyote > 0) groundJump();
    else if (jumpPressed && m.airJumps > 0) {
      jumpUsed = true;
      // Air jump: fixed vertical speed plus a partial steer toward the input.
      v.y = kick(tune.doubleJump);
      m.airJumps--;
      m.buffer = 0;
      if (wishLen > 1e-9) {
        const speed = Math.hypot(v.x, v.z),
          goal = Math.max(speed, tune.airSpeed * wishLen);
        v.x += (wishDir.x * goal - v.x) * tune.doubleJumpSteer;
        v.z += (wishDir.z * goal - v.z) * tune.doubleJumpSteer;
        const after = Math.hypot(v.x, v.z),
          limit = Math.max(speed, tune.airSpeed);
        if (after > limit) {
          v.x *= limit / after;
          v.z *= limit / after;
        }
      }
    }
    if (!jumped && wishLen > 1e-9) {
      // Modest steering; speed can never rise above max(current, airSpeed).
      const before = Math.hypot(v.x, v.z);
      v.x += wishDir.x * tune.airAccel * wishLen * dt;
      v.z += wishDir.z * tune.airAccel * wishLen * dt;
      const after = Math.hypot(v.x, v.z),
        limit = Math.max(before, tune.airSpeed);
      if (after > limit) {
        v.x *= limit / after;
        v.z *= limit / after;
      }
    }
  }
  if (integrate && m.mode !== 'WALLRUN') v.y -= tune.gravity * dt;
  // 5–6. Swept horizontal (x then z, with step-up in grounded states) and vertical motion.
  let landed = false,
    blockedAlongWall: Box | null = null;
  const runSpeed = m.wall ? Math.abs(v[other(m.wall.axis)]) : 0;
  if (integrate) {
    const stepping = GROUNDED.has(m.mode),
      startY = p.y;
    const h = () => (m.crouched ? PHYSICS.crouchHeight : PHYSICS.height);
    for (const a of ['x', 'z'] as const) {
      let remaining = v[a] * dt;
      for (let iter = 0; iter < 4 && remaining !== 0; iter++) {
        const { hit } = sweep(boxes, p, a, remaining, r, h());
        if (!hit) {
          p[a] += remaining;
          break;
        }
        const sign = remaining > 0 ? 1 : -1;
        const clamped = faceOf(hit, a, sign) - sign * r;
        remaining -= clamped - p[a];
        p[a] = clamped;
        const ahead = { ...p };
        ahead[a] += remaining;
        if (
          stepping &&
          hit.max.y > p.y &&
          hit.max.y - startY <= PHYSICS.stepHeight + EPS &&
          clearAt(boxes, ahead.x, hit.max.y, ahead.z, r, h())
        ) {
          p.y = hit.max.y;
          continue;
        }
        v[a] = 0;
        if (m.mode === 'WALLRUN' && m.wall && a !== m.wall.axis)
          blockedAlongWall = hit;
        break;
      }
      p[a] = Math.max(-PHYSICS.arena, Math.min(PHYSICS.arena, p[a]));
    }
    const y0 = p.y,
      y1 = y0 + v.y * dt,
      hh = h();
    if (v.y <= 0) {
      const top = supportBelow(boxes, world.floor, p.x, y0, p.z, r, y1);
      if (top > -Infinity) {
        p.y = top;
        v.y = 0;
        landed = true;
      } else p.y = y1;
    } else {
      let ceiling = Infinity;
      for (const b of boxes)
        if (
          p.x + r > b.min.x &&
          p.x - r < b.max.x &&
          p.z + r > b.min.z &&
          p.z - r < b.max.z &&
          b.min.y >= y0 + hh - EPS &&
          b.min.y <= y1 + hh &&
          b.min.y < ceiling
        )
          ceiling = b.min.y;
      if (ceiling < Infinity) {
        p.y = ceiling - hh;
        v.y = 0;
      } else p.y = y1;
    }
    // Ground snap: grounded states follow descending steps up to the step height.
    if (stepping && !landed) {
      const top = supportBelow(
        boxes,
        world.floor,
        p.x,
        p.y,
        p.z,
        r,
        p.y - PHYSICS.stepHeight,
      );
      if (top > -Infinity) {
        p.y = top;
        v.y = 0;
        landed = true;
      }
    }
  }
  // 7. Post-move transitions: leave ground, land, wall-run continuation, mantle and latch.
  if (integrate && GROUNDED.has(m.mode) && !landed) {
    if (m.mode === 'SLIDE') endSlide();
    m.mode = 'AIR';
    m.coyote = ticks(tune.coyoteTime);
  } else if (
    integrate &&
    (m.mode === 'AIR' || m.mode === 'WALLRUN') &&
    landed
  ) {
    m.wall = null;
    const speed = Math.hypot(v.x, v.z);
    if (crouchHeld && speed >= tune.slideMinStart && m.slideCooldown === 0)
      startSlide();
    else if (crouchHeld || (m.crouched && !canStand())) {
      m.mode = 'CROUCH';
      m.crouched = true;
    } else {
      m.mode = 'GROUND';
      m.crouched = false;
    }
  }
  if (GROUNDED.has(m.mode)) {
    m.airJumps = 1;
    m.lockouts = [];
    m.wall = null;
  }
  if (m.mode === 'WALLRUN' && m.wall) {
    const w = m.wall,
      o = other(w.axis);
    const corner = blockedAlongWall as Box | null;
    if (corner) {
      // Concave corner: turn onto the blocking runnable face, never snag.
      if (
        runnable(corner, o, w.run) &&
        !locked(corner.id ?? '') &&
        corner.min.y < p.y + 1.3 &&
        corner.max.y > p.y + 0.5
      ) {
        const along = Math.max(runSpeed, tune.wallRunMinSpeed);
        lockout(w.id);
        m.wall = {
          id: corner.id ?? '',
          axis: o,
          dir: w.run,
          plane: faceOf(corner, o, w.run),
          run: -w.dir as 1 | -1,
          ticks: w.ticks,
          rise: w.rise,
        };
        v[o] = 0;
        v[w.axis] = -w.dir * along;
      } else leaveWall(0);
    } else {
      const beside = wallBeside(boxes, w, p, locked);
      if (beside) w.id = beside.id ?? w.id;
      else leaveWall(0);
    }
  }
  if (m.mode === 'AIR' && integrate && !crouchHeld) {
    // Holding crouch means "drop": no ledge grab and no wall latch (also after a cancel).
    const mantle = mantleCandidates(boxes, p, forward, tune).find((c) => {
      const toward =
        (wishLen > 0.1 && wishDir[c.axis] * c.dir > 0.5) ||
        v[c.axis] * c.dir > 0.5;
      return toward;
    });
    if (mantle) {
      m.mode = 'MANTLE';
      m.crouched = false;
      m.buffer = 0;
      m.mantle = {
        ticks: 0,
        total: Math.max(1, ticks(tune.mantleTime)),
        from: { ...p },
        to: mantle.target,
        axis: mantle.axis,
        dir: mantle.dir,
      };
      v.x = v.y = v.z = 0;
    } else {
      const speed = Math.hypot(v.x, v.z);
      const floorTop = supportBelow(
        boxes,
        world.floor,
        p.x,
        p.y,
        p.z,
        r,
        -Infinity,
      );
      if (
        speed >= tune.wallRunMinSpeed &&
        p.y - floorTop >= tune.wallRunMinHeight
      ) {
        const steep = Math.tan((tune.wallRunMaxAngle * Math.PI) / 180);
        const wall = wallCandidates(boxes, p, tune.wallRunReach, locked).find(
          (c) => {
            const into = v[c.axis] * c.dir,
              along = Math.abs(v[other(c.axis)]);
            return into > -0.5 && Math.abs(into) <= steep * along;
          },
        );
        if (wall) {
          const o = other(wall.axis);
          // Settle flush against the face with a swept move (never into other geometry).
          const flush = wall.gap * wall.dir;
          if (flush !== 0) {
            const { travel } = sweep(
              boxes,
              p,
              wall.axis,
              flush,
              r,
              PHYSICS.height,
            );
            p[wall.axis] += travel;
          }
          const rise =
            v.y < tune.wallRunRise
              ? tune.wallRunRise
              : Math.min(v.y, tune.wallRunRise * 1.5);
          m.mode = 'WALLRUN';
          m.buffer = 0;
          m.wall = {
            id: wall.box.id ?? '',
            axis: wall.axis,
            dir: wall.dir,
            plane: wall.plane,
            run: v[o] >= 0 ? 1 : -1,
            ticks: 0,
            rise,
          };
          v[wall.axis] = 0;
          v.y = rise;
        }
      }
    }
  }
  if (m.mode === 'SLIDE' && Math.hypot(v.x, v.z) < tune.slideEnd) {
    // An obstacle stopped the slide.
    endSlide();
    m.mode = 'CROUCH';
  }
  // 8. Hard horizontal cap, flags and compact replication bits.
  const speed = Math.hypot(v.x, v.z);
  if (speed > tune.maxSpeed) {
    v.x *= tune.maxSpeed / speed;
    v.z *= tune.maxSpeed / speed;
  }
  s.flags = GROUNDED.has(m.mode)
    ? s.flags | FLAG.grounded
    : s.flags & ~FLAG.grounded;
  s.motion = motionBits(m, s.yaw);
  return s;
}
