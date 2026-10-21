import {
  moveMode,
  surfaceAt,
  randomSeed,
  type Entity,
  type Level,
  type Surface,
  type Vec3,
} from '@leviathan/shared';
import type { AudioManager } from './audio';
import { assetExists } from './world-assets';
/** Surface colour for synthesized scrapes and steps: centre frequency and ring. */
const TONE: Record<Surface, { hz: number; q: number }> = {
  asphalt: { hz: 620, q: 0.7 },
  concrete: { hz: 900, q: 0.9 },
  brick: { hz: 720, q: 0.8 },
  metal: { hz: 2300, q: 6 },
  wood: { hz: 430, q: 1.4 },
  glass: { hz: 3200, q: 4 },
};
type Loop = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};
/** Traversal sounds: slide scrape loop, wall-run steps, air-jump thrust, wall-jump kick,
 * mantle effort and hand slap, landing impacts, wind rush and crouch rustle.
 * Optional files from asset-manifest.json `movement.*` keys replace synthesis. */
export class MovementAudio {
  manifest: Record<string, string> = {};
  buffers = new Map<string, AudioBuffer | null>();
  counts: Record<string, number> = {};
  private noise?: AudioBuffer;
  private slide?: Loop;
  private wind?: Loop;
  private wallStep = 0;
  private surfaces = new Map<string, Surface>();
  private remoteState = new Map<
    string,
    { motion: number; vy: number; at: number }
  >();
  private remoteWindow = { start: 0, count: 0 };
  private disposed = false;
  private rng: () => number;
  constructor(
    public audio: AudioManager,
    public level: Level,
  ) {
    this.rng = randomSeed(level.seed + 911);
    for (const c of level.colliders) this.surfaces.set(c.id, c.surface);
    void fetch('/asset-manifest.json')
      .then((r) => r.json())
      .then(async (m) => {
        for (const [key, path] of Object.entries(m.audio ?? {}) as [
          string,
          string,
        ][])
          if (key.startsWith('movement.') && (await assetExists(path)))
            this.manifest[key] = path;
      })
      .catch(() => {});
  }
  private get context() {
    return this.disposed ? undefined : this.audio.context;
  }
  private noiseBuffer(c: AudioContext) {
    if (!this.noise) {
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
        data = b.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = this.rng() * 2 - 1;
      this.noise = b;
    }
    return this.noise;
  }
  /** A decoded optional file for the key (or its surface-free base key), if present. */
  private asset(key: string): AudioBuffer | undefined {
    const c = this.context,
      path =
        this.manifest[key] ??
        this.manifest[key.split('.').slice(0, 2).join('.')];
    if (!c || !path) return undefined;
    if (!this.buffers.has(path)) {
      this.buffers.set(path, null);
      void fetch(path)
        .then((r) => r.arrayBuffer())
        .then((data) => c.decodeAudioData(data))
        .then((buffer) => this.buffers.set(path, buffer))
        .catch(() => {});
    }
    return this.buffers.get(path) ?? undefined;
  }
  private output(c: AudioContext, gain: GainNode, position?: Vec3) {
    if (!position) {
      gain.connect(this.audio.gains.sfx!);
      return [] as AudioNode[];
    }
    const pan = c.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 4;
    pan.rolloffFactor = 1.4;
    pan.positionX.value = position.x;
    pan.positionY.value = position.y + 1;
    pan.positionZ.value = position.z;
    gain.connect(pan);
    pan.connect(this.audio.gains.sfx!);
    return [pan];
  }
  /** One-shot: optional asset, else band-passed noise with a decay (and optional thump). */
  private shot(
    key: string,
    options: {
      gain: number;
      hz: number;
      q?: number;
      duration: number;
      sweep?: number;
      thump?: number;
      position?: Vec3;
    },
  ) {
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    this.audio.events['move.' + key.split('.')[0]] =
      (this.audio.events['move.' + key.split('.')[0]] ?? 0) + 1;
    const c = this.context;
    if (!c || !this.audio.gains.sfx) return;
    const t = c.currentTime,
      gain = c.createGain();
    const extra = this.output(c, gain, options.position);
    const nodes: AudioNode[] = [gain, ...extra];
    const buffer = this.asset('movement.' + key);
    if (buffer) {
      const s = c.createBufferSource();
      s.buffer = buffer;
      gain.gain.value = options.gain * 2;
      s.connect(gain);
      s.start();
      this.audio.assetsPlayed++;
      s.onended = () => [s, ...nodes].forEach((n) => n.disconnect());
      return;
    }
    this.audio.fallbacksPlayed++;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer(c);
    s.playbackRate.value = 0.8 + this.rng() * 0.4;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(options.hz, t);
    if (options.sweep)
      filter.frequency.exponentialRampToValueAtTime(
        options.hz * options.sweep,
        t + options.duration,
      );
    filter.Q.value = options.q ?? 1;
    gain.gain.setValueAtTime(options.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + options.duration);
    s.connect(filter);
    filter.connect(gain);
    s.start(t, this.rng() * 1.5);
    s.stop(t + options.duration + 0.02);
    nodes.push(filter);
    if (options.thump) {
      const o = c.createOscillator(),
        og = c.createGain();
      o.frequency.setValueAtTime(options.thump, t);
      o.frequency.exponentialRampToValueAtTime(options.thump * 0.45, t + 0.12);
      og.gain.setValueAtTime(options.gain * 1.6, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(og);
      og.connect(gain);
      o.start(t);
      o.stop(t + 0.18);
      o.onended = () => [o, og].forEach((n) => n.disconnect());
    }
    s.onended = () => [s, ...nodes].forEach((n) => n.disconnect());
  }
  private loop(key: string, hz: number): Loop | undefined {
    const c = this.context;
    if (!c || !this.audio.gains.sfx) return undefined;
    const source = c.createBufferSource();
    const asset = this.asset('movement.' + key);
    source.buffer = asset ?? this.noiseBuffer(c);
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = asset ? 'allpass' : 'bandpass';
    filter.frequency.value = hz;
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.audio.gains.sfx);
    source.start();
    if (asset) this.audio.assetsPlayed++;
    else this.audio.fallbacksPlayed++;
    return { source, filter, gain };
  }
  private stopLoop(loop?: Loop) {
    const c = this.context;
    if (!loop) return;
    if (c) {
      loop.gain.gain.setTargetAtTime(0, c.currentTime, 0.05);
      loop.source.stop(c.currentTime + 0.3);
    } else loop.source.stop();
    loop.source.onended = () =>
      [loop.source, loop.filter, loop.gain].forEach((n) => n.disconnect());
  }
  private surfaceUnder(p: Vec3) {
    return surfaceAt(this.level, p);
  }
  /** Sim-rate local events from one predicted transition. */
  local(before: Entity, after: Entity) {
    const was = before.move?.mode ?? 'GROUND',
      is = after.move?.mode ?? 'GROUND',
      p = after.position;
    if (is === 'SLIDE' && was !== 'SLIDE') {
      const surface = this.surfaceUnder(p);
      this.stopLoop(this.slide);
      this.slide = this.loop('slide.' + surface, TONE[surface].hz);
      this.counts['slide'] = (this.counts['slide'] ?? 0) + 1;
      this.audio.events['move.slide'] =
        (this.audio.events['move.slide'] ?? 0) + 1;
    }
    if (was === 'SLIDE' && is !== 'SLIDE') {
      this.stopLoop(this.slide);
      this.slide = undefined;
    }
    if (is === 'WALLRUN' && after.move?.wall) {
      if (was !== 'WALLRUN') this.wallStep = 0;
      if (this.wallStep++ % 9 === 0) {
        const surface = this.surfaces.get(after.move.wall.id) ?? 'concrete';
        this.shot('wallstep.' + surface, {
          gain: 0.09,
          hz: TONE[surface].hz,
          q: TONE[surface].q,
          duration: surface === 'metal' ? 0.16 : 0.09,
          thump: 95,
        });
      }
    }
    const airJump =
      is === 'AIR' &&
      (before.move?.airJumps ?? 1) > (after.move?.airJumps ?? 1) &&
      after.velocity.y > 4;
    if (airJump)
      this.shot('doublejump', {
        gain: 0.1,
        hz: 260,
        q: 0.8,
        duration: 0.22,
        sweep: 3.2,
      });
    if (was === 'WALLRUN' && is === 'AIR' && after.velocity.y > 5) {
      const surface =
        this.surfaces.get(before.move?.wall?.id ?? '') ?? 'concrete';
      this.shot('walljump.' + surface, {
        gain: 0.12,
        hz: TONE[surface].hz * 0.7,
        q: 1.2,
        duration: 0.14,
        thump: 120,
      });
    }
    if (is === 'MANTLE' && was !== 'MANTLE') {
      const target = after.move?.mantle?.to ?? p;
      const surface = this.surfaceUnder(target);
      this.shot('handslap.' + surface, {
        gain: 0.11,
        hz: TONE[surface].hz * 1.4,
        q: 2,
        duration: 0.06,
      });
      this.shot('mantle', {
        gain: 0.05,
        hz: 340,
        q: 0.6,
        duration: 0.32,
        sweep: 0.7,
      });
    }
    const airborne = was === 'AIR' || was === 'WALLRUN';
    if (airborne && (is === 'GROUND' || is === 'CROUCH' || is === 'SLIDE')) {
      const impact = -before.velocity.y;
      if (impact > 2) {
        const surface = this.surfaceUnder(p);
        this.shot('land.' + surface, {
          gain: Math.min(0.22, 0.04 + impact * 0.012),
          hz: TONE[surface].hz * 0.6,
          q: 0.9,
          duration: 0.12 + Math.min(0.15, impact * 0.01),
          thump: 70 + Math.min(40, impact * 3),
        });
      }
    }
    if (!!before.move?.crouched !== !!after.move?.crouched && is !== 'SLIDE')
      this.shot(after.move?.crouched ? 'crouch' : 'stand', {
        gain: 0.035,
        hz: 1800,
        q: 0.5,
        duration: 0.12,
      });
  }
  /** Frame-rate loop shaping: slide scrape follows speed; wind rises with speed. */
  frame(local: Entity) {
    const c = this.context;
    if (!c) return;
    const speed = Math.hypot(local.velocity.x, local.velocity.z),
      rush = Math.hypot(speed, local.velocity.y);
    if (this.slide) {
      const k = Math.min(1, speed / 11);
      this.slide.gain.gain.setTargetAtTime(
        0.03 + 0.09 * k,
        c.currentTime,
        0.04,
      );
      this.slide.source.playbackRate.setTargetAtTime(
        0.6 + 0.6 * k,
        c.currentTime,
        0.05,
      );
    }
    this.wind ??= this.loop('wind', 380);
    if (this.wind) {
      const k = Math.max(0, Math.min(1, (rush - 6) / 12));
      this.wind.gain.gain.setTargetAtTime(0.09 * k, c.currentTime, 0.2);
      this.wind.filter.frequency.setTargetAtTime(
        300 + 900 * k,
        c.currentTime,
        0.2,
      );
    }
  }
  /** Remote operators: positional, rate-limited events from replicated motion bits. */
  remote(entities: Entity[], localId: string) {
    const now = performance.now();
    if (now - this.remoteWindow.start > 1000)
      this.remoteWindow = { start: now, count: 0 };
    for (const e of entities) {
      if (e.id === localId || e.type !== 'player') continue;
      const motion = e.motion ?? 0,
        prev = this.remoteState.get(e.id);
      this.remoteState.set(e.id, {
        motion,
        vy: e.velocity.y,
        at: prev?.at ?? 0,
      });
      if (!prev || this.remoteWindow.count >= 12 || now - prev.at < 120)
        continue;
      const was = moveMode(prev.motion),
        is = moveMode(motion);
      let fired = true;
      if (is === 'SLIDE' && was !== 'SLIDE')
        this.shot('slide.remote', {
          gain: 0.08,
          hz: 900,
          duration: 0.45,
          sweep: 0.6,
          position: e.position,
        });
      else if (is === 'MANTLE' && was !== 'MANTLE')
        this.shot('handslap.remote', {
          gain: 0.08,
          hz: 1300,
          q: 2,
          duration: 0.06,
          position: e.position,
        });
      else if (was === 'WALLRUN' && is === 'AIR' && e.velocity.y > 4)
        this.shot('walljump.remote', {
          gain: 0.09,
          hz: 700,
          duration: 0.14,
          thump: 120,
          position: e.position,
        });
      else if (is === 'AIR' && prev.vy < 3 && e.velocity.y > 5)
        this.shot('doublejump.remote', {
          gain: 0.08,
          hz: 260,
          duration: 0.2,
          sweep: 3,
          position: e.position,
        });
      else if (is === 'WALLRUN' && now - prev.at > 180)
        this.shot('wallstep.remote', {
          gain: 0.06,
          hz: 900,
          duration: 0.08,
          thump: 95,
          position: e.position,
        });
      else if (
        (was === 'AIR' || was === 'WALLRUN') &&
        is !== 'AIR' &&
        prev.vy < -4
      )
        this.shot('land.remote', {
          gain: 0.1,
          hz: 500,
          duration: 0.14,
          thump: 80,
          position: e.position,
        });
      else fired = false;
      if (fired) {
        this.remoteWindow.count++;
        this.remoteState.set(e.id, { motion, vy: e.velocity.y, at: now });
      }
    }
  }
  stats() {
    return {
      counts: { ...this.counts },
      slideLoop: !!this.slide,
      windGain: this.wind?.gain.gain.value ?? 0,
      assets: Object.keys(this.manifest).length,
    };
  }
  dispose() {
    this.stopLoop(this.slide);
    this.stopLoop(this.wind);
    this.slide = this.wind = undefined;
    this.disposed = true;
  }
}
