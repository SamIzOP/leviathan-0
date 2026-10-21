import type { Vec3 } from '@leviathan/shared';
type Bus = 'master' | 'sfx' | 'music' | 'voice';
interface Entry {
  path: string;
  bus: Exclude<Bus, 'master'>;
  loop?: boolean;
  gain?: number;
}
export class AudioManager {
  context?: AudioContext;
  gains: Partial<Record<Bus, GainNode>> = {};
  manifest: Record<string, Entry> = {};
  buffers = new Map<string, AudioBuffer | null>();
  loops = new Map<string, AudioBufferSourceNode | OscillatorNode>();
  loading: Promise<void>;
  events: Record<string, number> = {};
  assetsPlayed = 0;
  fallbacksPlayed = 0;
  pendingLoops = new Set<string>();
  volumes: Record<Bus, number> = {
    master: 0.6,
    sfx: 0.65,
    music: 0.3,
    voice: 1,
  };
  constructor() {
    try {
      Object.assign(
        this.volumes,
        JSON.parse(localStorage.getItem('volumes') ?? '{}'),
      );
    } catch {
      /* defaults */
    }
    this.loading = fetch('/audio/manifest.json')
      .then((r) => r.json())
      .then((m: Record<string, Entry>) => {
        this.manifest = m;
      })
      .catch(() => {});
    document.addEventListener('click', () => void this.unlock(), {
      once: true,
    });
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      const c = this.context;
      for (const bus of ['master', 'sfx', 'music', 'voice'] as const) {
        const g = c.createGain();
        g.gain.value = this.volumes[bus];
        this.gains[bus] = g;
      }
      this.gains.master!.connect(c.destination);
      for (const bus of ['sfx', 'music', 'voice'] as const)
        this.gains[bus]!.connect(this.gains.master!);
    }
    await this.context.resume();
    await this.loading;
    for (const event of this.pendingLoops) void this.play(event);
    this.pendingLoops.clear();
  }
  volume(bus: Bus, value: number) {
    this.volumes[bus] = Math.max(0, Math.min(1, value));
    if (this.gains[bus]) this.gains[bus]!.gain.value = this.volumes[bus];
    localStorage.setItem('volumes', JSON.stringify(this.volumes));
  }
  async play(event: string, options: { position?: Vec3 } = {}) {
    this.events[event] = (this.events[event] ?? 0) + 1;
    await this.loading;
    const entry = this.manifest[event] ?? { path: '', bus: 'sfx' };
    const c = this.context;
    if (!c) {
      if (entry.loop) this.pendingLoops.add(event);
      return;
    }
    if (entry.loop && this.loops.has(event)) return;
    if (!this.buffers.has(event)) {
      this.buffers.set(event, null);
      try {
        const response = await fetch(entry.path);
        if (response.ok)
          this.buffers.set(
            event,
            await c.decodeAudioData(await response.arrayBuffer()),
          );
      } catch {
        /* Missing assets intentionally fall back to synthesis. */
      }
    }
    const gain = c.createGain();
    gain.gain.value = entry.gain ?? 0.12;
    gain.connect(this.gains[entry.bus]!);
    let destination: AudioNode = gain;
    if (options.position) {
      const p = c.createPanner();
      p.panningModel = 'HRTF';
      p.positionX.value = options.position.x;
      p.positionY.value = options.position.y;
      p.positionZ.value = options.position.z;
      p.connect(gain);
      destination = p;
    }
    let source: AudioBufferSourceNode | OscillatorNode;
    const buffer = this.buffers.get(event);
    if (buffer) {
      this.assetsPlayed++;
      const s = c.createBufferSource();
      s.buffer = buffer;
      s.loop = entry.loop ?? false;
      source = s;
    } else if (event === 'rain_ambient') {
      this.fallbacksPlayed++;
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = b.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * 0.2;
      const s = c.createBufferSource();
      s.buffer = b;
      s.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      filter.connect(destination);
      destination = filter;
      source = s;
    } else {
      this.fallbacksPlayed++;
      const s = c.createOscillator();
      s.type = 'sine';
      s.frequency.value =
        event === 'footstep'
          ? 75
          : event === 'jump'
            ? 260
            : 440 + event.length * 20;
      gain.gain.setValueAtTime(0.1, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
      source = s;
    }
    source.connect(destination);
    source.start();
    if (entry.loop) this.loops.set(event, source);
    else source.stop(c.currentTime + (buffer ? buffer.duration : 0.15));
    source.onended = () => {
      source.disconnect();
      destination.disconnect();
      gain.disconnect();
    };
  }
  stop(event: string) {
    this.pendingLoops.delete(event);
    this.loops.get(event)?.stop();
    this.loops.delete(event);
  }
  listener(position: Vec3, yaw: number) {
    const l = this.context?.listener;
    if (!l) return;
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = -Math.sin(yaw);
    l.forwardY.value = 0;
    l.forwardZ.value = -Math.cos(yaw);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
}
