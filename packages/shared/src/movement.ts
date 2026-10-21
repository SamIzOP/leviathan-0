import { BUTTON, FLAG, PHYSICS } from './config';
import type { Entity, Input, World } from './types';
export const ARENA: World = {
  floor: 0,
  boxes: [
    { min: { x: 3, y: 0, z: 3 }, max: { x: 6, y: 2, z: 6 } },
    { min: { x: -7, y: 0, z: -4 }, max: { x: -4, y: 3, z: 0 } },
  ],
};
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
  };
}
export function sanitizeInput(i: Input): Input {
  return {
    ...i,
    x: Math.max(-1, Math.min(1, i.x)),
    z: Math.max(-1, Math.min(1, i.z)),
    yaw: ((i.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    pitch: Math.max(-1.5, Math.min(1.5, i.pitch)),
    buttons: i.buttons & 3,
  };
}
// Pure and fixed-step: the authoritative sim and prediction call exactly this function.
export function stepPlayer(
  state: Entity,
  raw: Input,
  dt: number,
  world: World,
): Entity {
  const s: Entity = {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
  };
  if (s.flags & FLAG.disconnected) return s;
  const i = sanitizeInput(raw);
  s.yaw = i.yaw;
  s.pitch = i.pitch;
  const length = Math.max(1, Math.hypot(i.x, i.z));
  const speed = i.buttons & BUTTON.sprint ? PHYSICS.sprint : PHYSICS.walk;
  s.velocity.x =
    ((i.x * Math.cos(i.yaw) - i.z * Math.sin(i.yaw)) / length) * speed;
  s.velocity.z =
    ((-i.x * Math.sin(i.yaw) - i.z * Math.cos(i.yaw)) / length) * speed;
  if (s.flags & FLAG.grounded && i.buttons & BUTTON.jump) {
    s.velocity.y = PHYSICS.jump;
    s.flags &= ~FLAG.grounded;
  }
  s.velocity.y -= PHYSICS.gravity * dt;
  const walking = !!(s.flags & FLAG.grounded) && !(i.buttons & BUTTON.jump);
  const startY = s.position.y;
  const radius = PHYSICS.radius;
  const reach = speed * dt + radius;
  let boxes =
    world.query?.(
      s.position.x - reach,
      s.position.z - reach,
      s.position.x + reach,
      s.position.z + reach,
    ) ?? world.boxes;
  const overlaps = (box: World['boxes'][number], y: number) =>
    y + PHYSICS.height > box.min.y + 1e-7 &&
    y < box.max.y - 1e-7 &&
    s.position.x + radius > box.min.x &&
    s.position.x - radius < box.max.x &&
    s.position.z + radius > box.min.z &&
    s.position.z - radius < box.max.z;
  // Malformed/embedded starting states retain the full-scan escape ordering.
  if (boxes.some((box) => overlaps(box, s.position.y))) boxes = world.boxes;
  for (const axis of ['x', 'z'] as const) {
    s.position[axis] = Math.max(
      -PHYSICS.arena,
      Math.min(PHYSICS.arena, s.position[axis] + s.velocity[axis] * dt),
    );
    for (const box of boxes) {
      if (
        s.position.y + PHYSICS.height > box.min.y &&
        s.position.y < box.max.y &&
        s.position.x + PHYSICS.radius > box.min.x &&
        s.position.x - PHYSICS.radius < box.max.x &&
        s.position.z + PHYSICS.radius > box.min.z &&
        s.position.z - PHYSICS.radius < box.max.z
      ) {
        // Only grounded walking may climb, and never more than one step per tick.
        if (
          walking &&
          s.velocity[axis] !== 0 &&
          box.max.y > s.position.y &&
          box.max.y - startY <= PHYSICS.stepHeight + 1e-7 &&
          !boxes.some((other) => overlaps(other, box.max.y))
        ) {
          s.position.y = box.max.y;
          s.velocity.y = 0;
          continue;
        }
        s.position[axis] =
          s.velocity[axis] > 0
            ? box.min[axis] - PHYSICS.radius
            : box.max[axis] + PHYSICS.radius;
        s.velocity[axis] = 0;
      }
    }
  }
  const oldY = s.position.y;
  s.position.y += s.velocity.y * dt;
  let floor = world.floor;
  for (const box of boxes) {
    if (
      s.position.x + PHYSICS.radius > box.min.x &&
      s.position.x - PHYSICS.radius < box.max.x &&
      s.position.z + PHYSICS.radius > box.min.z &&
      s.position.z - PHYSICS.radius < box.max.z
    ) {
      if (
        oldY >= box.max.y - 1e-7 &&
        (s.position.y <= box.max.y ||
          (walking && oldY - box.max.y <= PHYSICS.stepHeight + 1e-7))
      )
        floor = Math.max(floor, box.max.y);
      else if (
        oldY + PHYSICS.height <= box.min.y &&
        s.position.y + PHYSICS.height >= box.min.y
      ) {
        s.position.y = box.min.y - PHYSICS.height;
        s.velocity.y = 0;
      }
    }
  }
  s.flags &= ~FLAG.grounded;
  if (walking && oldY >= floor && oldY - floor <= PHYSICS.stepHeight + 1e-7)
    s.position.y = floor;
  if (s.position.y <= floor) {
    s.position.y = floor;
    s.velocity.y = 0;
    s.flags |= FLAG.grounded;
  }
  return s;
}
