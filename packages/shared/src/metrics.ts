import { PHYSICS, basePlaceholderJumpHeight } from './config';
// Authored clearances keep the conservative placeholder jump chain, not the new
// traversal set, so every route stays reachable without advanced moves.
export const METRICS = {
  height: 1.8,
  eye: 1.65,
  crouchEye: 1.1,
  slideEye: 0.9,
  radius: 0.4,
  jumpHeight: basePlaceholderJumpHeight,
  stepHeight: 0.8 * basePlaceholderJumpHeight,
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
