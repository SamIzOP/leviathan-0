import type * as THREE from 'three';
import { METRICS, MOVE, type Entity } from '@leviathan/shared';
import { effect, movementSettings } from './movement-settings';
/** Local-only camera presentation. Offsets roll, FOV and eye position; the aim
 * direction always remains the input yaw/pitch, so nothing here affects play. */
export class CameraFeel {
  private eye: number = METRICS.eye;
  private kick = 0;
  private roll = 0;
  private pull = 0;
  private dip = 0;
  private dipVelocity = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private fov = 0;
  /** ADS zoom factor (1 = hip), eased by the weapon presentation. */
  zoom = 1;
  /** Sim-rate events: landing impacts and stride phase. */
  tick(before: Entity, after: Entity) {
    const was = before.move?.mode ?? 'GROUND',
      is = after.move?.mode ?? 'GROUND';
    const airborne = was === 'AIR' || was === 'WALLRUN';
    if (airborne && (is === 'GROUND' || is === 'CROUCH' || is === 'SLIDE')) {
      const impact = Math.max(0, -before.velocity.y);
      if (impact > 3)
        this.dipVelocity -= Math.min(1.6, (impact - 3) * 0.16) * effect('dip');
    }
  }
  /** Horizontal FOV at a 4:3 reference (Hor+), converted to Three's vertical FOV. */
  private verticalFov(horizontal: number) {
    const v = 2 * Math.atan(Math.tan((horizontal * Math.PI) / 360) * 0.75);
    return Math.min(120, (v * 180) / Math.PI);
  }
  apply(
    camera: THREE.PerspectiveCamera,
    local: Entity,
    position: { x: number; y: number; z: number },
    dt: number,
  ) {
    const ease = (current: number, target: number, tau: number) =>
      current + (target - current) * (1 - Math.exp(-dt / tau));
    const m = local.move,
      mode = m?.mode ?? 'GROUND',
      speed = Math.hypot(local.velocity.x, local.velocity.z);
    // Eye height: standing 1.65, crouched 1.1, sliding 0.9, smoothed both ways.
    const eyeTarget =
      mode === 'SLIDE'
        ? METRICS.slideEye
        : m?.crouched
          ? METRICS.crouchEye
          : METRICS.eye;
    this.eye = ease(this.eye, eyeTarget, eyeTarget < this.eye ? 0.08 : 0.12);
    // FOV widens up to +8° with horizontal speed above a run.
    const kickTarget =
      Math.max(0, Math.min(1, (speed - 5.5) / 7)) * 8 * effect('fovKick');
    this.kick = ease(this.kick, kickTarget, 0.25);
    // Aiming down sights narrows the view by the weapon zoom (tangent-space).
    const base = this.verticalFov(movementSettings.fov + this.kick);
    const fov =
      this.zoom === 1
        ? base
        : (2 * Math.atan(Math.tan((base * Math.PI) / 360) / this.zoom) * 180) /
          Math.PI;
    this.fov = fov;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Wall-run roll away from the wall, eased in and out.
    const wall = m?.wall;
    let rollTarget = 0;
    if (mode === 'WALLRUN' && wall) {
      const right =
        Math.cos(local.yaw) * (wall.axis === 'x' ? 1 : 0) -
        Math.sin(local.yaw) * (wall.axis === 'z' ? 1 : 0);
      rollTarget = (right * wall.dir > 0 ? 1 : -1) * 0.21 * effect('roll');
    }
    this.roll = ease(this.roll, rollTarget, 0.14);
    // Mantle: subtle forward pitch pull, then a short settle.
    this.pull = ease(
      this.pull,
      mode === 'MANTLE' ? -0.09 * effect('pull') : 0,
      mode === 'MANTLE' ? 0.09 : 0.16,
    );
    // Landing dip: critically damped spring scaled by fall speed. Fixed 4 ms
    // substeps keep it stable through long or throttled frames.
    const k = 180,
      c = 2 * Math.sqrt(k),
      steps = Math.ceil(dt / 0.004),
      h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.dipVelocity += (-k * this.dip - c * this.dipVelocity) * h;
      this.dip += this.dipVelocity * h;
    }
    if (this.dip < -0.35) {
      this.dip = -0.35;
      this.dipVelocity = Math.max(0, this.dipVelocity);
    }
    // Very light head bob while walking or sprinting on the ground.
    const walking = (mode === 'GROUND' || mode === 'CROUCH') && speed > 0.5;
    this.bobAmount = ease(
      this.bobAmount,
      walking
        ? (0.012 + 0.003 * Math.min(speed, MOVE.sprint)) * effect('bob')
        : 0,
      0.1,
    );
    this.bobPhase += dt * speed * 2.2;
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * this.bobAmount,
      bobX = Math.sin(this.bobPhase) * this.bobAmount * 0.5;
    camera.position.set(
      position.x + Math.cos(local.yaw) * bobX,
      position.y + this.eye + this.dip + bobY + this.pull,
      position.z - Math.sin(local.yaw) * bobX,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.set(local.pitch, local.yaw, this.roll);
  }
  stats() {
    return {
      fovVertical: this.fov,
      eye: this.eye,
      fovKick: this.kick,
      rollDegrees: (this.roll * 180) / Math.PI,
      pull: this.pull,
      dip: this.dip,
      bob: this.bobAmount,
    };
  }
}
