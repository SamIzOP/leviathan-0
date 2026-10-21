import {
  inside,
  surfaceAt,
  randomSeed,
  type Level,
  type Vec3,
} from '@leviathan/shared';
import type { AudioManager } from './audio';
import { assetExists } from './world-assets';
export class WorldAudio {
  loading: Promise<void>;
  nodes: AudioNode[] = [];
  sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
  filter?: BiquadFilterNode;
  roof?: GainNode;
  initialized = false;
  disposed = false;
  interior = false;
  nextDistant = 0;
  buffers = new Map<string, AudioBuffer>();
  manifest: Record<string, string> = {};
  rng: () => number;
  constructor(
    public audio: AudioManager,
    public level: Level,
  ) {
    this.rng = randomSeed(level.seed + 520);
    this.loading = fetch('/asset-manifest.json')
      .then((r) => r.json())
      .then(async (m) => {
        for (const [key, path] of Object.entries(m.audio ?? {}) as [
          string,
          string,
        ][])
          if (await assetExists(path)) this.manifest[key] = path;
      })
      .catch(() => {});
  }
  noise(c: AudioContext, seconds: number, stereo = false) {
    const b = c.createBuffer(
      stereo ? 2 : 1,
      c.sampleRate * seconds,
      c.sampleRate,
    );
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const data = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + this.rng() * 2 - 1) * 0.65;
        data[i] = last * 0.45;
      }
    }
    return b;
  }
  async start() {
    const c = this.audio.context;
    if (!c || this.initialized || this.disposed) return;
    this.initialized = true;
    await this.loading;
    if (this.disposed) return;
    const noise = this.noise(c, 4, true);
    this.buffers.set('noise', noise);
    const loop = (
      key: string,
      gain: number,
      frequency: number,
      position?: Vec3,
    ) => {
      const source = c.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = key === 'machinery' ? 'bandpass' : 'lowpass';
      filter.frequency.value = frequency;
      const volume = c.createGain();
      volume.gain.value = gain;
      source.connect(filter);
      filter.connect(volume);
      if (position) {
        const pan = c.createPanner();
        pan.panningModel = 'HRTF';
        pan.distanceModel = 'inverse';
        pan.refDistance = 16;
        pan.rolloffFactor = 1.3;
        pan.positionX.value = position.x;
        pan.positionY.value = position.y;
        pan.positionZ.value = position.z;
        volume.connect(pan);
        pan.connect(this.audio.gains.sfx!);
        this.nodes.push(pan);
      } else volume.connect(this.audio.gains.sfx!);
      this.sources.push(source);
      this.nodes.push(source, filter, volume);
      source.start();
      this.audio.fallbacksPlayed++;
      const path = this.manifest['ambience.' + key];
      if (path)
        void assetExists(path).then(async (exists) => {
          if (!exists || this.disposed) return;
          try {
            const response = await fetch(path),
              buffer = await c.decodeAudioData(await response.arrayBuffer());
            if (this.disposed) return;
            source.stop();
            const real = c.createBufferSource();
            real.buffer = buffer;
            real.loop = true;
            real.connect(filter);
            real.start();
            this.sources.push(real);
            this.nodes.push(real);
            this.audio.assetsPlayed++;
          } catch {
            /* retain synthesis */
          }
        });
      return { filter, volume };
    };
    this.filter = loop('rain', this.level.audio.rain, 3500).filter;
    this.roof = loop('roof', 0, 800).volume;
    loop('wind', this.level.audio.wind, 240);
    for (const emitter of this.level.audio.emitters) {
      const result = loop(
        emitter.kind,
        emitter.gain,
        emitter.kind === 'steam' ? 4500 : emitter.kind === 'crane' ? 180 : 75,
        emitter.position,
      );
      if (emitter.kind === 'crane') {
        const lfo = c.createOscillator(),
          amount = c.createGain();
        lfo.frequency.value = 0.07;
        amount.gain.value = 90;
        lfo.connect(amount);
        amount.connect(result.filter.frequency);
        lfo.start();
        this.sources.push(lfo);
        this.nodes.push(lfo, amount);
      }
    }
    this.nextDistant =
      c.currentTime + this.level.audio.distantInterval[0] + this.rng() * 30;
  }
  update(position: Vec3) {
    void this.start();
    const c = this.audio.context;
    if (!c || !this.filter) return;
    this.interior = this.level.interiors.some((b) => inside(position, b));
    this.filter.frequency.setTargetAtTime(
      this.interior ? 550 : 3500,
      c.currentTime,
      0.4,
    );
    this.roof?.gain.setTargetAtTime(
      this.interior ? 0.055 : 0,
      c.currentTime,
      0.4,
    );
    if (c.currentTime > this.nextDistant) {
      this.pulse('boom', 0.025, 2.7, 65);
      this.nextDistant =
        c.currentTime +
        this.level.audio.distantInterval[0] +
        this.rng() *
          (this.level.audio.distantInterval[1] -
            this.level.audio.distantInterval[0]);
    }
  }
  pulse(key: string, gain: number, duration: number, frequency: number) {
    const c = this.audio.context;
    if (!c) return;
    const source = c.createBufferSource();
    source.buffer = this.buffers.get('noise') ?? this.noise(c, 1);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const volume = c.createGain();
    volume.gain.setValueAtTime(gain, c.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(this.audio.gains.sfx!);
    source.start();
    source.stop(c.currentTime + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      volume.disconnect();
    };
    this.audio.events[key] = (this.audio.events[key] ?? 0) + 1;
  }
  footstep(position: Vec3) {
    const surface = surfaceAt(this.level, position);
    this.audio.events.footstep = (this.audio.events.footstep ?? 0) + 1;
    const path = this.manifest['footstep.' + surface];
    if (path) {
      this.audio.manifest['footstep.' + surface] = {
        path,
        bus: 'sfx',
        gain: 0.07,
      };
      void this.audio.play('footstep.' + surface, { position });
    } else
      this.pulse(
        'footstep.' + surface,
        0.18,
        0.12,
        surface === 'metal' ? 1500 : surface === 'wood' ? 350 : 650,
      );
    if (this.level.weather.wetness > 0.5 && !this.interior)
      this.pulse('splash', 0.06, 0.18, 3500);
  }
  dispose() {
    this.disposed = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.nodes.forEach((n) => n.disconnect());
    this.sources = [];
    this.nodes = [];
    this.buffers.clear();
  }
}
