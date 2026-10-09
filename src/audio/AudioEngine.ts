import { impulse, synthGroup } from './synth';

interface ManifestGroup {
  files: string[];
  gain?: number;
  midi?: number[];
  loop?: boolean;
}
interface Manifest {
  version: number;
  groups: Record<string, ManifestGroup>;
}

interface Bank {
  buffers: AudioBuffer[];
  /** Seconds of leading silence to skip so triggers feel instant. */
  offsets: number[];
  /** Loop points that skip MP3 encoder padding (only for looping banks). */
  loops: [number, number][];
  gain: number;
  midi: number[];
  loop: boolean;
  order: number[];
  pos: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  group: string;
}

export interface PlayOpts {
  /** Playback-rate multiplier (pitch). */
  rate?: number;
  /** Random pitch spread, ± fraction (default 0.05). */
  jitter?: number;
  gain?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Minimum seconds between two triggers of the same group. */
  minGap?: number;
  /** Reverb send 0..1. */
  reverb?: number;
  bus?: 'sfx' | 'ui' | 'music';
}

/** Groups the game expects; any group missing from the manifest gets a synthesized stand-in. */
const REQUIRED = [
  'pop', 'popit', 'grass', 'snow', 'leaves', 'sand', 'slime', 'ice', 'kalimba',
  'coin', 'ui_tap', 'ui_whoosh', 'win', 'sparkle', 'amb_meadow', 'amb_winter', 'amb_cozy', 'wood', 'step', 'keys',
];

/**
 * Mix levels applied on top of the manifest gains (those balance groups of the same
 * kind against each other). The crunches lead; music and nature beds sit ~8 dB under
 * them, and a limiter at the end keeps dense moments from ever clipping.
 */
const MIX = { sfx: 1.8, ambience: 1.75, music: 0.9 };

const MAX_VOICES = 34;
const MAX_PER_GROUP = 7;

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private sfx: GainNode;
  private ui: GainNode;
  private amb: GainNode;
  private mus: GainNode;
  private verbIn: GainNode;
  private banks = new Map<string, Bank>();
  private last = new Map<string, number>();
  private voices: Voice[] = [];
  private enabled = true;
  private paused = false;
  private unlocked = false;
  private ambLoop: { src: AudioBufferSourceNode; gain: GainNode; group: string } | null = null;
  readonly music: Music;

  constructor() {
    const AC = window.AudioContext ?? window.webkitAudioContext!;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.sfx = c.createGain();
    this.sfx.gain.value = MIX.sfx;
    this.ui = c.createGain();
    this.ui.gain.value = 0.75;
    this.amb = c.createGain();
    this.mus = c.createGain();
    const verb = c.createConvolver();
    verb.buffer = impulse(c, 2.6, 3);
    this.verbIn = c.createGain();
    const verbOut = c.createGain();
    verbOut.gain.value = 0.5;
    this.verbIn.connect(verb).connect(verbOut).connect(comp);
    this.sfx.connect(comp);
    this.ui.connect(comp);
    this.mus.connect(comp);
    this.amb.connect(this.master);
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    comp.connect(this.master).connect(limiter).connect(c.destination);
    this.music = new Music(this, this.mus);
  }

  get running(): boolean {
    return this.ctx.state === 'running' && this.enabled && !this.paused;
  }

  /** Loads public/audio/manifest.json and decodes every sound, filling gaps with synthesized ones. */
  async load(base: string, onProgress: (p: number) => void): Promise<void> {
    let manifest: Manifest = { version: 1, groups: {} };
    try {
      const res = await fetch(base + 'manifest.json');
      if (res.ok) manifest = await res.json();
    } catch {
      /* fall back to synth */
    }
    const groups = Object.entries(manifest.groups ?? {});
    const total = groups.reduce((n, [, g]) => n + (g.files?.length ?? 0), 0) || 1;
    let done = 0;
    await Promise.all(
      groups.map(async ([name, g]) => {
        const items = await Promise.all(
          (g.files ?? []).map(async (file, k) => {
            try {
              const ab = await (await fetch(base + file)).arrayBuffer();
              const buf = await new Promise<AudioBuffer>((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
              return { buf, midi: g.midi?.[k] ?? 72 };
            } catch {
              return null;
            } finally {
              onProgress(++done / total);
            }
          }),
        );
        const ok = items.filter((x): x is { buf: AudioBuffer; midi: number } => !!x);
        if (ok.length) this.addBank(name, ok.map((x) => x.buf), g.gain ?? 1, ok.map((x) => x.midi), !!g.loop);
      }),
    );
    for (const name of REQUIRED) {
      if (this.banks.has(name)) continue;
      const s = synthGroup(this.ctx, name);
      if (s) this.addBank(name, s.buffers, s.gain, s.midi ?? [], !!s.loop);
    }
    onProgress(1);
  }

  has(group: string): boolean {
    return this.banks.has(group);
  }

  private addBank(name: string, buffers: AudioBuffer[], gain: number, midi: number[], loop: boolean): void {
    const offsets = buffers.map((b) => (loop ? 0 : leadingSilence(b)));
    const loops = buffers.map((b) => (loop ? loopPoints(b) : ([0, b.duration] as [number, number])));
    this.banks.set(name, { buffers, offsets, gain, midi, loop, loops, order: buffers.map((_, i) => i), pos: buffers.length });
  }

  /** Shuffle-bag selection: never repeats the same take twice in a row. */
  private pick(b: Bank): number {
    const n = b.buffers.length;
    if (n === 1) return 0;
    if (b.pos >= n) {
      const lastIdx = b.order[n - 1];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b.order[i], b.order[j]] = [b.order[j], b.order[i]];
      }
      if (b.order[0] === lastIdx) [b.order[0], b.order[n - 1]] = [b.order[n - 1], b.order[0]];
      b.pos = 0;
    }
    return b.order[b.pos++];
  }

  play(group: string, o: PlayOpts = {}): boolean {
    const b = this.banks.get(group);
    if (!b || !this.running) return false;
    return this.start(group, b, this.pick(b), o.rate ?? 1, o);
  }

  /** Plays a pitched note from the kalimba bank (nearest sample, re-pitched). */
  playNote(midi: number, o: PlayOpts = {}): boolean {
    const b = this.banks.get('kalimba');
    if (!b || !this.running) return false;
    let best = 0;
    for (let i = 1; i < b.buffers.length; i++) if (Math.abs(b.midi[i] - midi) < Math.abs(b.midi[best] - midi)) best = i;
    const rate = Math.pow(2, (midi - (b.midi[best] ?? 72)) / 12);
    return this.start('kalimba', b, best, rate, { jitter: 0, ...o });
  }

  private start(group: string, b: Bank, idx: number, rate: number, o: PlayOpts): boolean {
    const c = this.ctx;
    const when = c.currentTime + (o.delay ?? 0);
    const gap = o.minGap ?? 0;
    if (gap > 0) {
      if (when - (this.last.get(group) ?? -9) < gap) return false;
      this.last.set(group, when);
    }
    const src = c.createBufferSource();
    src.buffer = b.buffers[idx];
    const j = o.jitter ?? 0.05;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * j);
    const gain = c.createGain();
    gain.gain.value = b.gain * (o.gain ?? 1) * (0.84 + Math.random() * 0.16);
    src.connect(gain);
    const nodes: AudioNode[] = [gain];
    let tail: AudioNode = gain;
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail.connect(p);
      tail = p;
      nodes.push(p);
    }
    tail.connect(o.bus === 'ui' ? this.ui : o.bus === 'music' ? this.mus : this.sfx);
    if (o.reverb) {
      const send = c.createGain();
      send.gain.value = o.reverb;
      tail.connect(send).connect(this.verbIn);
      nodes.push(send);
    }
    src.start(when, b.offsets[idx]);
    const v: Voice = { src, gain, nodes, group };
    this.voices.push(v);
    src.onended = () => {
      src.disconnect();
      for (const n of nodes) n.disconnect();
      const k = this.voices.indexOf(v);
      if (k >= 0) this.voices.splice(k, 1);
    };
    this.cull(group);
    return true;
  }

  private cull(group: string): void {
    let count = 0;
    for (const v of this.voices) if (v.group === group) count++;
    if (count > MAX_PER_GROUP) this.fadeOut(this.voices.find((v) => v.group === group)!);
    if (this.voices.length > MAX_VOICES) this.fadeOut(this.voices[0]);
  }

  private fadeOut(v: Voice): void {
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + 0.03);
    try {
      v.src.stop(t + 0.035);
    } catch {
      /* already stopped */
    }
    const k = this.voices.indexOf(v);
    if (k >= 0) this.voices.splice(k, 1);
  }

  /** Crossfades to a looping ambience bed (null = silence). */
  setAmbience(group: string | null): void {
    if (this.ambLoop?.group === group) return;
    const t = this.ctx.currentTime;
    if (this.ambLoop) {
      const old = this.ambLoop;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, 0.5);
      try {
        old.src.stop(t + 3);
      } catch {
        /* ignore */
      }
      this.ambLoop = null;
    }
    const b = group ? this.banks.get(group) : undefined;
    if (!b || !group) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b.buffers[0];
    src.loop = true;
    [src.loopStart, src.loopEnd] = b.loops[0];
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(b.gain * MIX.ambience, t, 0.8);
    src.connect(gain).connect(this.amb);
    src.start(t, src.loopStart + Math.random() * (src.loopEnd - src.loopStart) * 0.8);
    this.ambLoop = { src, gain, group };
  }

  setAmbienceOn(on: boolean): void {
    this.amb.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.25);
  }

  /** Host audio setting (YouTube mute). When off, nothing is output at all. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.apply();
  }

  /** Host pause (app backgrounded / YouTube onPause). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.apply();
  }

  private apply(): void {
    const on = this.enabled && !this.paused;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(on ? 0.9 : 0, t);
    if (on) {
      if (this.unlocked) this.ctx.resume().catch(() => {});
    } else {
      this.ctx.suspend().catch(() => {});
    }
  }

  /** Must be called from a user gesture (iOS / autoplay policies). */
  unlock(): void {
    if (this.unlocked && this.ctx.state === 'running') return;
    if (!this.enabled || this.paused) {
      this.unlocked = true;
      return;
    }
    this.ctx.resume().catch(() => {});
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start();
    this.unlocked = true;
  }

  buffer(group: string, i = 0): AudioBuffer | undefined {
    return this.banks.get(group)?.buffers[i];
  }

  gainOf(group: string): number {
    return this.banks.get(group)?.gain ?? 1;
  }

  reverbBus(): GainNode {
    return this.verbIn;
  }
}

/** Loop between the first and last non-zero samples, so decoder padding never leaves a gap. */
function loopPoints(b: AudioBuffer): [number, number] {
  const d = b.getChannelData(0);
  let s = 0, e = d.length - 1;
  while (s < e && Math.abs(d[s]) < 1e-4) s++;
  while (e > s && Math.abs(d[e]) < 1e-4) e--;
  return [s / b.sampleRate, (e + 1) / b.sampleRate];
}

function leadingSilence(b: AudioBuffer): number {
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.03;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > th) return Math.max(0, i - 16) / b.sampleRate;
  return 0;
}

/**
 * Gentle background music. Uses the `music` loop from the manifest when present,
 * otherwise generates a soft lo-fi pad with kalimba sparkles (zero bytes of assets).
 * Driven by the game loop so it naturally stops while the game is paused.
 */
export class Music {
  private on = true;
  private suppressed = false;
  private chordTimer = 0;
  private sparkleTimer = 2;
  private chord = 0;
  private track: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private level: GainNode;

  private static CHORDS = [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59], // Cmaj7
  ];
  private static SPARKLE = [72, 74, 76, 79, 81, 84, 86, 88];

  constructor(
    private eng: AudioEngine,
    bus: GainNode,
  ) {
    this.level = eng.ctx.createGain();
    this.level.gain.value = 1;
    this.level.connect(bus);
  }

  setOn(on: boolean): void {
    this.on = on;
    this.applyLevel();
  }

  /** Temporarily mute (e.g. in the kalimba world where the player makes the music). */
  setSuppressed(s: boolean): void {
    this.suppressed = s;
    this.applyLevel();
  }

  private get audible(): boolean {
    return this.on && !this.suppressed;
  }

  private applyLevel(): void {
    this.level.gain.setTargetAtTime(this.audible ? 1 : 0, this.eng.ctx.currentTime, 0.6);
  }

  update(dt: number): void {
    if (!this.eng.running || !this.audible) return;
    if (this.eng.has('music')) {
      if (!this.track) this.startTrack();
      return;
    }
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = 7.5;
      this.playChord(Music.CHORDS[this.chord++ % Music.CHORDS.length]);
    }
    this.sparkleTimer -= dt;
    if (this.sparkleTimer <= 0) {
      this.sparkleTimer = 1.8 + Math.random() * 3.2;
      const m = Music.SPARKLE[Math.floor(Math.random() * Music.SPARKLE.length)];
      this.eng.playNote(m, { gain: 0.12, reverb: 0.7, bus: 'music', pan: Math.random() * 1.2 - 0.6 });
    }
  }

  private startTrack(): void {
    const c = this.eng.ctx;
    const src = c.createBufferSource();
    src.buffer = this.eng.buffer('music')!;
    src.loop = true;
    [src.loopStart, src.loopEnd] = loopPoints(src.buffer);
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(this.eng.gainOf('music') * MIX.music, c.currentTime, 1.5);
    src.connect(gain).connect(this.level);
    src.start();
    this.track = { src, gain };
  }

  private playChord(notes: number[]): void {
    const c = this.eng.ctx;
    const t = c.currentTime + 0.05;
    const dur = 9.5;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 850;
    lp.Q.value = 0.4;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 2.4);
    env.gain.setValueAtTime(0.05, t + dur - 3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(env);
    env.connect(this.level);
    const send = c.createGain();
    send.gain.value = 0.5;
    env.connect(send).connect(this.eng.reverbBus());
    const oscs: OscillatorNode[] = [];
    for (const m of notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      for (const [type, det] of [['sine', -6], ['triangle', 7]] as const) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
        oscs.push(o);
      }
    }
    oscs[0].onended = () => {
      lp.disconnect();
      env.disconnect();
      send.disconnect();
    };
  }
}
