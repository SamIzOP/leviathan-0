import { PHYSICS } from './config';
export const METRICS = {
  height: 1.8,
  eye: 1.65,
  radius: 0.4,
  jumpHeight: PHYSICS.jump ** 2 / (2 * PHYSICS.gravity),
  stepHeight: (0.8 * PHYSICS.jump ** 2) / (2 * PHYSICS.gravity),
  extent: 110,
  depth: 180,
  streetWidth: 20,
  sidewalk: 3.5,
  floorHeight: 3.6,
  stairRiser: 0.18,
  stairTread: 0.29,
  walkStep: PHYSICS.stepHeight,
  containerHeight: 2.6,
} as const;
