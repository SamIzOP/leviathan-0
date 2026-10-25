import * as THREE from 'three';
import {
  STATUS,
  eyeOf,
  type CombatEvent,
  type CombatRules,
  type CombatStep,
  type Entity,
  type HitCause,
  type World,
} from '@leviathan/shared';
import type { AudioManager } from '../audio';
import { CombatAudio } from './audio';
import { CombatFx, type Quality } from './fx';
import { CombatHud } from './hud';
import { Viewmodel } from './viewmodel';
/** Everything the presentation needs once per rendered frame. */
export interface CombatFrame {
  dt: number;
  now: number;
  camera: THREE.PerspectiveCamera;
  /** Predicted local entity (its `combat` is the predicted weapon state). */
  local?: Entity;
  /** Latest authoritative local entity (health and status bits). */
  authoritative?: Entity;
  rules: CombatRules;
  /** Look change this frame in radians, for viewmodel sway. */
  look: { yaw: number; pitch: number };
  playing: boolean;
  quality: Quality;
  names: Map<string, string>;
}
/** Combat entities from the renderer's interpolation pair. */
export interface CombatEntities {
  from: Entity[];
  to: Entity[];
  alpha: number;
  localId: string;
}
const DEG = Math.PI / 180;
/** Deterministic left/right recoil drift, indexed by the shot counter. */
const YAW_PATTERN = [0.55, -0.4, 0.85, -0.7, 0.3, -0.9, 0.75, -0.2];
const smoothstep = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
/** Client combat presentation: first-person viewmodel, pooled FX, procedural audio
 * and the combat HUD. Simulation and authority live in the shared/server modules. */
export class CombatClient {
  private fx: CombatFx;
  private vm = new Viewmodel();
  private sound: CombatAudio;
  private hud = new CombatHud();
  private camera?: THREE.PerspectiveCamera;
  private rules?: CombatRules;
  private wasPlaying = false;
  private adsTarget = 0;
  private bufferHeight = innerHeight * Math.min(devicePixelRatio, 1.5);
  private size = new THREE.Vector2();
  private muzzle = new THREE.Vector3();
  private fire = new THREE.Vector3();
  private strikes = new Set<string>();
  private lastThud = 0;
  private lastFireArc = 0;
  private vmState: 'cold' | 'compiling' | 'ready' = 'cold';
  constructor(
    public scene: THREE.Scene,
    public audio: AudioManager,
  ) {
    this.fx = new CombatFx(scene);
    this.sound = new CombatAudio(audio);
  }
  private useWorld(world: World) {
    // levelWorld() is cached per level, so a new object means a new level.
    if (this.fx.world && this.fx.world !== world) this.clearWorld();
    this.fx.world = world;
  }
  private clearWorld() {
    this.fx.reset();
    this.hud.reset();
    this.strikes.clear();
  }
  /** A predicted local tick (shots, throws, cues). Returns the recoil kick to add to
   * the player's real aim, in radians. */
  local(
    step: CombatStep,
    before: Entity,
    rules: CombatRules,
    world: World,
  ): { yaw: number; pitch: number } {
    this.useWorld(world);
    this.rules = rules;
    const now = performance.now();
    const kick = { yaw: 0, pitch: 0 };
    const c = step.entity.combat;
    const needMuzzle = step.shots.length > 0 || step.throws.length > 0;
    if (needMuzzle) {
      if (this.camera && this.vm.visible)
        this.vm.muzzleWorld(this.camera, this.muzzle);
      else {
        const eye = eyeOf(before);
        this.muzzle.set(eye.x, eye.y - 0.1, eye.z);
      }
    }
    for (const shot of step.shots) {
      const w = rules.table[shot.weapon];
      if (!w) continue;
      const adsTicks = Math.max(1, Math.round(w.adsTime * 60));
      const aimed = smoothstep((c?.ads ?? 0) / adsTicks);
      this.fx.shotLocal(now, shot, w, this.muzzle);
      this.vm.fire(shot.weapon, this.ads, shot.seq, now);
      this.sound.fire(shot.weapon);
      kick.pitch += w.recoilPitch * DEG * (1 - 0.35 * aimed);
      kick.yaw +=
        w.recoilYaw * DEG * YAW_PATTERN[shot.seq % YAW_PATTERN.length]!;
    }
    for (const t of step.throws) {
      this.fx.throwLocal(t, this.muzzle);
      this.sound.cue('raise');
    }
    if (step.fingers) this.sound.call();
    for (const cue of step.cues) {
      this.vm.cue(cue, now);
      this.sound.cue(cue);
    }
    return kick;
  }
  private label(id: string, names: Map<string, string>) {
    if (!id) return '';
    const name = names.get(id);
    if (name) return name;
    const e = this.fx.find(id);
    if (e?.type === 'robot')
      return (e.status ?? 0) & STATUS.dummy ? 'DUMMY' : 'ROBOT';
    return 'UNKNOWN';
  }
  private cause(cause: HitCause) {
    if (typeof cause === 'number')
      return this.rules?.table[cause]?.name ?? `T${cause + 1}`;
    return cause === 'fire'
      ? 'FIRE'
      : cause === 'fingers'
        ? 'FINGERS'
        : 'BLAST';
  }
  /** Authoritative events from a snapshot. */
  events(
    events: CombatEvent[],
    localId: string,
    names: Map<string, string>,
    world: World,
  ) {
    this.useWorld(world);
    const now = performance.now();
    for (const e of events) {
      switch (e.t) {
        case 'shot':
          if (e.shooter === localId) break;
          this.fx.shotRemote(now, e, this.rules?.table[e.weapon]);
          this.sound.fire(e.weapon, e.origin);
          break;
        case 'hit': {
          const weapon = typeof e.cause === 'number';
          if (e.source === localId && e.target !== localId) {
            const kind = e.kill ? 'kill' : e.zone === 'head' ? 'head' : 'body';
            this.hud.damageNumber(
              now,
              e.at,
              e.amount,
              e.target,
              e.zone === 'head',
              e.kill,
            );
            // Burn ticks stay quiet; a kill always confirms.
            if (e.cause !== 'fire' || e.kill) {
              this.hud.hitMarker(kind);
              this.sound.hit(kind);
            }
            if (weapon) this.fx.flesh(e.at, this.fx.isRobot(e.target), e.from);
          }
          if (e.target === localId) {
            const tick = e.cause === 'fire';
            if (!tick || now - this.lastFireArc > 600) {
              this.lastFireArc = now;
              this.hud.damageTaken(
                now,
                e.from,
                e.amount,
                e.amount >= 20 || e.kill,
              );
            }
            if (!tick || now - this.lastThud > 450) {
              this.lastThud = now;
              this.sound.damage(e.amount);
            }
          }
          if (e.kill) {
            const attacker = this.label(e.source, names),
              victim = this.label(e.target, names) || 'UNKNOWN';
            const cause = this.cause(e.cause);
            this.hud.killFeed(
              now,
              attacker,
              cause,
              victim,
              e.source === localId,
              e.target === localId,
            );
            if (e.target === localId)
              this.hud.killedBy(
                attacker
                  ? `TERMINATED BY ${attacker} [${cause}]`
                  : `TERMINATED [${cause}]`,
              );
          }
          break;
        }
        case 'blast':
          this.fx.blast(now, e.kind, e.at, e.radius);
          this.sound.blast(e.kind, e.at);
          break;
        case 'ignite':
          this.fx.blast(now, 'ignite', e.at, 1.5);
          this.sound.ignite(e.at);
          break;
        case 'pickup':
          this.fx.pickup(e.at);
          if (e.player === localId) {
            this.hud.toast('+AMMO');
            this.sound.pickup(true);
          } else this.sound.pickup(false, e.at);
          break;
        case 'respawn':
          if (e.player === localId) this.vm.raise(now);
          break;
      }
    }
  }
  entities(e: CombatEntities) {
    this.fx.entities(e.from, e.to, e.alpha, e.localId);
    let present = false;
    for (const x of e.to) {
      if (x.type !== 'strike') continue;
      present = true;
      if (this.strikes.has(x.id)) continue;
      this.strikes.add(x.id);
      this.sound.hum(x.position, (x.timer ?? 60) / 60, performance.now());
    }
    if (!present && this.strikes.size) this.strikes.clear();
  }
  frame(f: CombatFrame) {
    this.camera = f.camera;
    this.rules = f.rules;
    if (!f.playing) {
      if (this.wasPlaying) this.reset();
      this.wasPlaying = false;
      this.hud.update({
        now: f.now,
        playing: false,
        camera: f.camera,
        rules: f.rules,
        ads: 0,
        scoped: false,
      });
      return;
    }
    this.wasPlaying = true;
    const dt = Math.min(0.1, Math.max(0, f.dt));
    const local = f.local,
      c = local?.combat;
    const dead = !!(
      (f.authoritative?.status ?? local?.status ?? 0) & STATUS.dead
    );
    // Eased ADS: smoothstep of the predicted tick fraction, filtered to display rate.
    let zoomTo = 1;
    if (c && !dead) {
      const w = f.rules.table[c.slot]!;
      const raw = smoothstep(c.ads / Math.max(1, Math.round(w.adsTime * 60)));
      this.adsTarget = raw;
      zoomTo = w.adsZoom;
    } else this.adsTarget = 0;
    this.ads += (this.adsTarget - this.ads) * (1 - Math.exp(-dt / 0.03));
    if (Math.abs(this.ads - this.adsTarget) < 1e-3) this.ads = this.adsTarget;
    this.zoom = 1 + (zoomTo - 1) * this.ads;
    this.vm.update({
      dt,
      now: f.now,
      local,
      rules: f.rules,
      ads: this.ads,
      look: f.look,
      dead,
    });
    this.fx.update(
      dt,
      f.now,
      f.camera,
      this.scene,
      f.quality,
      this.bufferHeight,
    );
    if (local) {
      const d = this.fx.nearestFire(local.position, this.fire);
      this.sound.fires(d, this.fire, f.now);
    }
    this.hud.update({
      now: f.now,
      playing: true,
      camera: f.camera,
      local,
      authoritative: f.authoritative,
      rules: f.rules,
      ads: this.ads,
      scoped: this.vm.scoped,
    });
  }
  /** Viewmodel pass, drawn after the world. */
  overlay(renderer: THREE.WebGLRenderer) {
    this.bufferHeight = renderer.getDrawingBufferSize(this.size).y;
    if (this.vmState !== 'ready') {
      // Compile the viewmodel programs off the main path once, then draw.
      if (this.vmState === 'cold') {
        this.vmState = 'compiling';
        this.vm.scene.environment = this.scene.environment;
        const done = () => (this.vmState = 'ready');
        renderer.compileAsync(this.vm.scene, this.vm.camera).then(done, done);
      }
      return;
    }
    this.vm.render(renderer, this.scene.environment);
  }
  /** Eased ADS zoom (1 = hip) for the camera; ADS fraction for look scaling. */
  zoom = 1;
  ads = 0;
  reset() {
    this.fx.reset();
    this.hud.reset();
    this.sound.reset();
    this.vm.reset();
    this.strikes.clear();
    this.zoom = 1;
    this.ads = 0;
    this.adsTarget = 0;
  }
  stats(): Record<string, number> {
    const now = performance.now();
    const fx = this.fx.stats(now);
    const viewmodel = this.vm.drawCalls();
    const hud = this.hud.active();
    return {
      ...fx,
      voices: this.sound.active,
      hudNodes: this.hud.nodes,
      damageNumbers: hud.numbers,
      damageArcs: hud.indicators,
      killFeed: hud.feed,
      viewmodelCalls: viewmodel,
      totalCalls: fx.drawCalls + viewmodel,
      ads: this.ads,
      zoom: this.zoom,
      scoped: Number(this.vm.scoped),
    };
  }
}
