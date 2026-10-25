import type { Vec3 } from '@leviathan/shared';
import type { AudioManager } from '../audio';
interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  ended: boolean;
  pending: number;
}
interface NoiseOptions {
  type: BiquadFilterType;
  hz: number;
  to?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
  rate?: number;
}
interface ToneOptions {
  type: OscillatorType;
  hz: number;
  to?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
}
const MAX_VOICES = 24;
/** Procedural combat sounds (no files): per-weapon fire, reload clicks, UI ticks,
 * explosions, flask shatter, fire crackle loop, Fingers of God hum and thunder.
 * World sounds are spatialised; local weapon sounds are not. Every path is a no-op
 * until the AudioManager has a context (first click). */
export class CombatAudio {
  voices: Voice[] = [];
  private noise?: AudioBuffer;
  private crackleBuffer?: AudioBuffer;
  private bufferContext?: AudioContext;
  private crackle?: {
    source: AudioBufferSourceNode;
    gain: GainNode;
    pan: PannerNode;
    silentSince: number;
  };
  private lastHum = -1e9;
  constructor(public audio: AudioManager) {}
  private get context() {
    const c = this.audio.context;
    return c && this.audio.gains.sfx && c.state !== 'closed' ? c : undefined;
  }
  private count(name: string) {
    const key = 'combat.' + name;
    this.audio.events[key] = (this.audio.events[key] ?? 0) + 1;
  }
  private buffers(c: AudioContext) {
    if (this.bufferContext !== c || !this.noise || !this.crackleBuffer) {
      this.bufferContext = c;
      const n = c.createBuffer(1, c.sampleRate, c.sampleRate),
        d = n.getChannelData(0);
      let seed = 1234567;
      const rand = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      this.noise = n;
      // Crackle: low rumble plus sparse decaying pops (2 s loop).
      const k = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
        e = k.getChannelData(0);
      let low = 0,
        pop = 0,
        popGain = 0;
      for (let i = 0; i < e.length; i++) {
        low += (rand() * 2 - 1 - low) * 0.02;
        if (rand() < 34 / c.sampleRate) popGain = 0.3 + rand() * 0.7;
        pop = (rand() * 2 - 1) * popGain;
        popGain *= 0.993;
        e[i] = low * 1.6 + pop * 0.55;
      }
      this.crackleBuffer = k;
    }
    return { noise: this.noise, crackle: this.crackleBuffer };
  }
  /** One voice: output gain (optionally through a panner) into the sfx bus. Over
   * the cap, the oldest voice is stopped. */
  private voice(c: AudioContext, gain: number, position?: Vec3) {
    while (this.voices.length >= MAX_VOICES) this.kill(this.voices[0]!);
    const out = c.createGain();
    out.gain.value = gain;
    const v: Voice = { sources: [], nodes: [out], ended: false, pending: 0 };
    if (position) {
      const pan = c.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 5;
      pan.rolloffFactor = 1.1;
      pan.maxDistance = 400;
      pan.positionX.value = position.x;
      pan.positionY.value = position.y;
      pan.positionZ.value = position.z;
      out.connect(pan);
      pan.connect(this.audio.gains.sfx!);
      v.nodes.push(pan);
    } else out.connect(this.audio.gains.sfx!);
    this.voices.push(v);
    return { v, out };
  }
  private kill(v: Voice) {
    if (v.ended) return;
    v.ended = true;
    for (const s of v.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of v.nodes) n.disconnect();
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }
  private track(
    v: Voice,
    source: AudioScheduledSourceNode,
    end: number,
    c: AudioContext,
  ) {
    v.sources.push(source);
    v.pending++;
    source.stop(c.currentTime + end);
    source.onended = () => {
      if (--v.pending <= 0) this.kill(v);
    };
  }
  private noiseBurst(
    c: AudioContext,
    v: Voice,
    out: AudioNode,
    o: NoiseOptions,
  ) {
    const t = c.currentTime + (o.delay ?? 0);
    const s = c.createBufferSource();
    s.buffer = this.buffers(c).noise;
    s.loop = true;
    s.playbackRate.value = o.rate ?? 0.9 + Math.random() * 0.2;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.hz, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    const attack = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    v.nodes.push(f, g);
    s.start(t, Math.random() * 0.8);
    this.track(v, s, (o.delay ?? 0) + attack + o.decay + 0.03, c);
  }
  private tone(c: AudioContext, v: Voice, out: AudioNode, o: ToneOptions) {
    const t = c.currentTime + (o.delay ?? 0);
    const s = c.createOscillator();
    s.type = o.type;
    s.frequency.setValueAtTime(o.hz, t);
    if (o.to) s.frequency.exponentialRampToValueAtTime(o.to, t + o.decay);
    const g = c.createGain();
    const attack = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
    s.connect(g);
    g.connect(out);
    v.nodes.push(g);
    s.start(t);
    this.track(v, s, (o.delay ?? 0) + attack + o.decay + 0.03, c);
  }
  /** Weapon fire. Local shots are non-spatial; remote ones sit at the shooter. */
  fire(weapon: number, position?: Vec3) {
    this.count('fire.' + weapon);
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, position ? 0.75 : 1, position);
    const n = (o: NoiseOptions) => this.noiseBurst(c, v, out, o);
    const tn = (o: ToneOptions) => this.tone(c, v, out, o);
    const pitch = 0.94 + Math.random() * 0.12;
    switch (weapon) {
      case 0: // RIVET: tight crack
        n({ type: 'highpass', hz: 2600, gain: 0.32, decay: 0.03 });
        n({
          type: 'bandpass',
          hz: 1500 * pitch,
          q: 1.1,
          gain: 0.5,
          decay: 0.11,
        });
        tn({
          type: 'triangle',
          hz: 170 * pitch,
          to: 60,
          gain: 0.35,
          decay: 0.09,
        });
        break;
      case 1: // SPOOL: short rapid snap
        n({ type: 'highpass', hz: 3000, gain: 0.22, decay: 0.022 });
        n({
          type: 'bandpass',
          hz: 1900 * pitch,
          q: 1.4,
          gain: 0.32,
          decay: 0.06,
        });
        tn({
          type: 'square',
          hz: 120 * pitch,
          to: 55,
          gain: 0.12,
          decay: 0.05,
        });
        break;
      case 2: // BREAKER: boom plus a pump rack
        n({ type: 'highpass', hz: 1800, gain: 0.3, decay: 0.05 });
        n({
          type: 'lowpass',
          hz: 1400 * pitch,
          to: 260,
          gain: 0.75,
          decay: 0.38,
        });
        tn({ type: 'sine', hz: 88 * pitch, to: 38, gain: 0.7, decay: 0.3 });
        n({
          type: 'bandpass',
          hz: 2300,
          q: 3,
          gain: 0.16,
          decay: 0.03,
          delay: 0.32,
        });
        n({
          type: 'bandpass',
          hz: 1700,
          q: 3,
          gain: 0.2,
          decay: 0.04,
          delay: 0.46,
        });
        break;
      case 3: // LONGLINE: hard crack with a long tail
        n({ type: 'highpass', hz: 3400, gain: 0.45, decay: 0.035 });
        n({
          type: 'bandpass',
          hz: 1150 * pitch,
          q: 0.9,
          gain: 0.55,
          decay: 0.16,
        });
        tn({
          type: 'triangle',
          hz: 110 * pitch,
          to: 45,
          gain: 0.45,
          decay: 0.16,
        });
        n({
          type: 'lowpass',
          hz: 700,
          to: 240,
          gain: 0.16,
          attack: 0.04,
          decay: 0.95,
        });
        break;
      default: // SLAG: hollow thump and whoosh
        tn({ type: 'sine', hz: 92 * pitch, to: 34, gain: 0.85, decay: 0.32 });
        n({ type: 'lowpass', hz: 520, to: 140, gain: 0.5, decay: 0.3 });
        n({
          type: 'bandpass',
          hz: 500,
          to: 1700,
          q: 1.2,
          gain: 0.18,
          attack: 0.02,
          decay: 0.28,
        });
    }
  }
  /** Weapon handling cues (local only). */
  cue(
    kind:
      'empty' | 'reload' | 'reload-round' | 'reload-done' | 'switch' | 'raise',
  ) {
    this.count(kind);
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, 0.6);
    const click = (hz: number, gain: number, delay = 0, decay = 0.025) =>
      this.noiseBurst(c, v, out, {
        type: 'bandpass',
        hz,
        q: 4,
        gain,
        decay,
        delay,
      });
    switch (kind) {
      case 'empty':
        click(4200, 0.35, 0, 0.015);
        break;
      case 'reload':
        click(2400, 0.3);
        click(1500, 0.22, 0.07, 0.05);
        break;
      case 'reload-round':
        click(2800, 0.28, 0, 0.02);
        this.tone(c, v, out, {
          type: 'triangle',
          hz: 300,
          to: 180,
          gain: 0.12,
          decay: 0.05,
        });
        break;
      case 'reload-done':
        click(1900, 0.36);
        click(2600, 0.3, 0.09);
        break;
      case 'switch':
        for (let i = 0; i < 4; i++)
          click(1800 + i * 500, 0.18, i * 0.035, 0.02);
        break;
      case 'raise':
        click(3200, 0.16, 0, 0.018);
    }
  }
  /** Hit feedback: tick (body), ping (head) or a two-tone kill confirm. */
  hit(kind: 'body' | 'head' | 'kill') {
    this.count('hit.' + kind);
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, 0.5);
    const tn = (o: ToneOptions) => this.tone(c, v, out, o);
    if (kind === 'body')
      tn({ type: 'sine', hz: 1850, gain: 0.25, decay: 0.035 });
    else if (kind === 'head') {
      tn({ type: 'sine', hz: 2650, to: 2500, gain: 0.3, decay: 0.12 });
      tn({ type: 'triangle', hz: 5300, gain: 0.08, decay: 0.06 });
    } else {
      tn({ type: 'triangle', hz: 880, gain: 0.32, decay: 0.09 });
      tn({ type: 'triangle', hz: 1320, gain: 0.32, decay: 0.16, delay: 0.07 });
      this.noiseBurst(c, v, out, {
        type: 'highpass',
        hz: 5000,
        gain: 0.06,
        decay: 0.08,
      });
    }
  }
  damage(amount: number) {
    this.count('damage');
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, Math.min(1, 0.45 + amount / 60));
    this.tone(c, v, out, {
      type: 'sine',
      hz: 95,
      to: 48,
      gain: 0.7,
      decay: 0.16,
    });
    this.noiseBurst(c, v, out, {
      type: 'lowpass',
      hz: 420,
      gain: 0.35,
      decay: 0.12,
    });
  }
  pickup(local: boolean, position?: Vec3) {
    this.count('pickup');
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(
      c,
      local ? 0.4 : 0.25,
      local ? undefined : position,
    );
    this.tone(c, v, out, { type: 'sine', hz: 880, gain: 0.3, decay: 0.12 });
    this.tone(c, v, out, {
      type: 'sine',
      hz: 1320,
      gain: 0.26,
      decay: 0.2,
      delay: 0.08,
    });
  }
  /** Spatial world events. */
  blast(kind: 'slag' | 'flask' | 'fingers', at: Vec3) {
    this.count('blast.' + kind);
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, 1, at);
    const n = (o: NoiseOptions) => this.noiseBurst(c, v, out, o);
    const tn = (o: ToneOptions) => this.tone(c, v, out, o);
    if (kind === 'slag') {
      n({ type: 'highpass', hz: 1500, gain: 0.35, decay: 0.06 });
      n({
        type: 'lowpass',
        hz: 1100,
        to: 160,
        gain: 0.95,
        attack: 0.004,
        decay: 1.1,
      });
      tn({ type: 'sine', hz: 62, to: 30, gain: 0.9, decay: 0.55 });
    } else if (kind === 'flask') {
      n({ type: 'highpass', hz: 2600, gain: 0.4, decay: 0.12 });
      n({ type: 'bandpass', hz: 420, q: 1, gain: 0.35, decay: 0.2 });
      for (let i = 0; i < 4; i++)
        tn({
          type: 'sine',
          hz: 2600 + Math.random() * 2600,
          gain: 0.08,
          decay: 0.05 + Math.random() * 0.07,
          delay: 0.02 + i * 0.035,
        });
    } else {
      n({ type: 'highpass', hz: 2200, gain: 0.5, decay: 0.08 });
      n({
        type: 'lowpass',
        hz: 700,
        to: 110,
        gain: 1,
        attack: 0.01,
        decay: 1.7,
      });
      tn({ type: 'sine', hz: 46, to: 26, gain: 0.9, decay: 0.9 });
      n({
        type: 'bandpass',
        hz: 300,
        to: 90,
        q: 0.7,
        gain: 0.3,
        attack: 0.15,
        decay: 1.4,
        delay: 0.1,
      });
    }
  }
  ignite(at: Vec3) {
    this.count('ignite');
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, 0.8, at);
    this.noiseBurst(c, v, out, {
      type: 'bandpass',
      hz: 240,
      to: 1600,
      q: 0.9,
      gain: 0.6,
      attack: 0.06,
      decay: 0.45,
    });
    this.noiseBurst(c, v, out, {
      type: 'lowpass',
      hz: 300,
      gain: 0.3,
      attack: 0.03,
      decay: 0.5,
    });
  }
  /** Fingers of God telegraph hum, once per strike volley. */
  hum(at: Vec3, seconds: number, now: number) {
    if (now - this.lastHum < 600) return;
    this.lastHum = now;
    this.count('hum');
    const c = this.context;
    if (!c) return;
    const d = Math.max(0.3, Math.min(2.5, seconds));
    const { v, out } = this.voice(c, 0.6, at);
    const t = c.currentTime;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + d);
    f.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + d * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
    f.connect(g);
    g.connect(out);
    v.nodes.push(f, g);
    for (const hz of [49, 98.5, 147]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz, t);
      o.frequency.linearRampToValueAtTime(hz * 1.06, t + d);
      o.connect(f);
      o.start(t);
      this.track(v, o, d + 0.15, c);
    }
  }
  /** Calling the strike (local): a rising shimmer. */
  call() {
    this.count('call');
    const c = this.context;
    if (!c) return;
    const { v, out } = this.voice(c, 0.4);
    this.tone(c, v, out, {
      type: 'triangle',
      hz: 660,
      to: 1320,
      gain: 0.25,
      attack: 0.05,
      decay: 0.4,
    });
    this.tone(c, v, out, {
      type: 'sine',
      hz: 990,
      to: 1980,
      gain: 0.15,
      attack: 0.05,
      decay: 0.45,
      delay: 0.05,
    });
  }
  /** One crackle loop; its gain follows the nearest fire. */
  fires(distance: number, at: Vec3, now: number) {
    const c = this.context;
    if (!c) return;
    const target = Number.isFinite(distance)
      ? 0.22 * Math.pow(Math.max(0, 1 - Math.max(0, distance) / 26), 1.5)
      : 0;
    if (!this.crackle && target > 0.001) {
      const source = c.createBufferSource();
      source.buffer = this.buffers(c).crackle;
      source.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 90;
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 8;
      pan.rolloffFactor = 0.6;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(this.audio.gains.sfx!);
      source.start();
      this.crackle = { source, gain, pan, silentSince: 0 };
      this.count('crackle');
    }
    const k = this.crackle;
    if (!k) return;
    k.gain.gain.setTargetAtTime(target, c.currentTime, 0.25);
    if (Number.isFinite(distance)) {
      k.pan.positionX.value = at.x;
      k.pan.positionY.value = at.y;
      k.pan.positionZ.value = at.z;
    }
    if (target > 0.001) k.silentSince = 0;
    else if (!k.silentSince) k.silentSince = now;
    else if (now - k.silentSince > 2000) this.stopCrackle();
  }
  private stopCrackle() {
    const k = this.crackle;
    if (!k) return;
    this.crackle = undefined;
    try {
      k.source.stop();
    } catch {
      /* not started */
    }
    k.source.disconnect();
    k.gain.disconnect();
    k.pan.disconnect();
  }
  get active() {
    return this.voices.length + (this.crackle ? 1 : 0);
  }
  reset() {
    for (const v of [...this.voices]) this.kill(v);
    this.stopCrackle();
  }
}
