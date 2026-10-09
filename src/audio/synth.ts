import { RNG } from '../core/rng';

/**
 * Procedural fallback sounds. They are only used when a group is missing from
 * public/audio/manifest.json, so the game never goes silent.
 */
export interface SynthBank {
  buffers: AudioBuffer[];
  gain: number;
  midi?: number[];
  loop?: boolean;
}

type Fill = (d: Float32Array, sr: number, r: () => number) => void;

function make(ctx: BaseAudioContext, dur: number, seed: number, fill: Fill, peak = 0.9, fade = 0.012): AudioBuffer {
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, Math.ceil(dur * sr), sr);
  const d = b.getChannelData(0);
  const rng = new RNG(seed);
  fill(d, sr, () => rng.next());
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const g = m > 0 ? peak / m : 1;
  const fo = Math.min(d.length, Math.floor(sr * fade));
  for (let i = 0; i < d.length; i++) d[i] *= g;
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return b;
}

function lowpass(d: Float32Array, sr: number, fc: number): void {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < d.length; i++) d[i] = y = (1 - a) * d[i] + a * y;
}

function highpass(d: Float32Array, sr: number, fc: number): void {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  let px = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    y = a * (y + x - px);
    px = x;
    d[i] = y;
  }
}

interface CrunchOpts {
  count: number;
  dur: number;
  hp: number;
  lp: number;
  decay: number;
  bed: number;
}

function crunch(d: Float32Array, sr: number, r: () => number, o: CrunchOpts): void {
  const n = d.length;
  for (let c = 0; c < o.count; c++) {
    const t0 = Math.pow(r(), 1.4) * o.dur;
    const s0 = Math.floor(t0 * sr);
    const len = Math.floor(sr * (0.0006 + r() * 0.0035));
    const amp = (0.25 + r() * 0.75) * Math.exp(-t0 * o.decay);
    for (let i = 0; i < len && s0 + i < n; i++) d[s0 + i] += (r() * 2 - 1) * amp * (1 - i / len);
  }
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] += (r() * 2 - 1) * o.bed * Math.exp(-t * o.decay) * Math.min(1, t * 300);
  }
  highpass(d, sr, o.hp);
  lowpass(d, sr, o.lp);
  highpass(d, sr, o.hp);
}

function tine(d: Float32Array, sr: number, f: number, start: number, amp: number, decay = 2.6): void {
  const s0 = Math.floor(start * sr);
  for (let i = s0; i < d.length; i++) {
    const t = (i - s0) / sr;
    const w = 2 * Math.PI * f * t;
    d[i] +=
      amp *
      (Math.sin(w) * Math.exp(-t * decay) +
        0.14 * Math.sin(2.01 * w) * Math.exp(-t * decay * 2.2) +
        0.2 * Math.sin(5.5 * w) * Math.exp(-t * 16) +
        (t < 0.002 ? 0.3 * (1 - t / 0.002) : 0));
  }
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function loopify(d: Float32Array, sr: number, xfade = 1): void {
  const n = Math.floor(xfade * sr);
  const len = d.length;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] = d[i] * k + d[len - n + i] * (1 - k);
  }
}

const times = <T>(n: number, f: (k: number) => T) => Array.from({ length: n }, (_, k) => f(k));

export function synthGroup(ctx: BaseAudioContext, name: string): SynthBank | null {
  switch (name) {
    case 'pop':
      return {
        gain: 0.8,
        buffers: times(5, (k) =>
          make(ctx, 0.1, 11 + k, (d, sr, r) => {
            const f = 1100 + k * 230 + r() * 200;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const click = t < 0.0025 ? (r() * 2 - 1) * (1 - t / 0.0025) : 0;
              d[i] =
                click * 1.3 +
                Math.sin(2 * Math.PI * f * t * (1 - t * 2)) * Math.exp(-t * 70) * 0.6 +
                Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 45) * 0.5;
            }
            highpass(d, sr, 120);
          }),
        ),
      };
    case 'popit':
      return {
        gain: 0.8,
        buffers: times(4, (k) =>
          make(ctx, 0.14, 21 + k, (d, sr, r) => {
            const f0 = 300 + k * 45;
            let ph = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              ph += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t * 60))) / sr;
              d[i] = Math.sin(ph) * Math.exp(-t * 28) * 0.8 + (t < 0.002 ? (r() * 2 - 1) * 0.6 : 0);
            }
            lowpass(d, sr, 3200);
          }),
        ),
      };
    case 'snow':
      return { gain: 0.8, buffers: times(5, (k) => make(ctx, 0.3, 31 + k, (d, sr, r) => crunch(d, sr, r, { count: 45, dur: 0.22, hp: 900, lp: 6500, decay: 9, bed: 0.12 }))) };
    case 'leaves':
      return { gain: 0.75, buffers: times(5, (k) => make(ctx, 0.34, 41 + k, (d, sr, r) => crunch(d, sr, r, { count: 60, dur: 0.28, hp: 2200, lp: 11000, decay: 7, bed: 0.15 }))) };
    case 'sand':
      return { gain: 0.8, buffers: times(5, (k) => make(ctx, 0.26, 51 + k, (d, sr, r) => crunch(d, sr, r, { count: 80, dur: 0.2, hp: 500, lp: 3800, decay: 10, bed: 0.25 }))) };
    case 'grass':
      return { gain: 0.6, buffers: times(5, (k) => make(ctx, 0.2, 61 + k, (d, sr, r) => crunch(d, sr, r, { count: 35, dur: 0.16, hp: 1800, lp: 9000, decay: 12, bed: 0.3 }))) };
    case 'ice':
      return {
        gain: 0.75,
        buffers: times(5, (k) =>
          make(ctx, 0.4, 71 + k, (d, sr, r) => {
            crunch(d, sr, r, { count: 30, dur: 0.16, hp: 1500, lp: 12000, decay: 14, bed: 0.05 });
            const fs = [2600 + k * 170, 3900 + k * 90, 5300 - k * 120];
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              for (const f of fs) d[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 20) * 0.12;
            }
          }),
        ),
      };
    case 'slime':
      return {
        gain: 0.8,
        buffers: times(5, (k) =>
          make(ctx, 0.3, 81 + k, (d, sr, r) => {
            let ph = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const f = 160 + k * 25 + 480 * (1 - Math.exp(-t * 18)) + 60 * Math.sin(t * 90);
              ph += (2 * Math.PI * f) / sr;
              const env = Math.pow(Math.sin(Math.min(1, t / 0.28) * Math.PI), 1.5);
              d[i] = (Math.sin(ph) * 0.35 + (r() * 2 - 1) * 0.5) * env;
            }
            lowpass(d, sr, 1400);
            lowpass(d, sr, 2200);
          }),
        ),
      };
    case 'wood':
      return {
        gain: 0.6,
        buffers: times(5, (k) =>
          make(ctx, 0.16, 161 + k, (d, sr, r) => {
            const f = 170 + k * 22 + r() * 20;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              d[i] =
                Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 38) * 0.8 +
                Math.sin(2 * Math.PI * f * 2.7 * t) * Math.exp(-t * 60) * 0.25 +
                (t < 0.003 ? (r() * 2 - 1) * 0.7 : 0);
            }
            lowpass(d, sr, 2600);
          }),
        ),
      };
    case 'keys':
      return {
        gain: 0.7,
        buffers: times(6, (k) =>
          make(ctx, 0.12, 181 + k, (d, sr, r) => {
            const f = 900 + k * 90 + r() * 80;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const click = t < 0.0018 ? (r() * 2 - 1) * (1 - t / 0.0018) : 0;
              const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 95) * 0.45;
              const thock = Math.sin(2 * Math.PI * (210 + k * 12) * t) * Math.exp(-t * 55) * 0.8;
              const bottom = t > 0.012 ? Math.sin(2 * Math.PI * 320 * (t - 0.012)) * Math.exp(-(t - 0.012) * 70) * 0.35 : 0;
              d[i] = click + body + thock + bottom;
            }
            lowpass(d, sr, 4200);
          }),
        ),
      };
    case 'step':
      return {
        gain: 0.35,
        buffers: times(4, (k) =>
          make(ctx, 0.1, 171 + k, (d, sr, r) => {
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              d[i] = (r() * 2 - 1) * Math.exp(-t * 45) * Math.min(1, t * 400);
            }
            lowpass(d, sr, 900 + k * 120);
            lowpass(d, sr, 1400);
          }),
        ),
      };
    case 'kalimba':
      return { gain: 0.8, midi: [72], buffers: [make(ctx, 1.8, 91, (d, sr) => tine(d, sr, midiHz(72), 0, 1), 0.9, 0.05)] };
    case 'coin':
      return {
        gain: 0.55,
        buffers: [
          make(ctx, 0.5, 101, (d, sr) => {
            tine(d, sr, midiHz(88), 0, 0.7, 9);
            tine(d, sr, midiHz(95), 0.07, 0.8, 7);
          }),
        ],
      };
    case 'ui_tap':
      return {
        gain: 0.45,
        buffers: [
          make(ctx, 0.08, 111, (d, sr) => {
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              d[i] = (Math.sin(2 * Math.PI * 1050 * t) + 0.3 * Math.sin(2 * Math.PI * 2100 * t)) * Math.exp(-t * 55);
            }
          }),
        ],
      };
    case 'ui_whoosh':
      return {
        gain: 0.35,
        buffers: [
          make(ctx, 0.42, 121, (d, sr, r) => {
            let y = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const k = t / 0.42;
              const a = Math.exp((-2 * Math.PI * (400 + 3000 * Math.sin(k * Math.PI))) / sr);
              y = (1 - a) * (r() * 2 - 1) + a * y;
              d[i] = y * Math.pow(Math.sin(k * Math.PI), 2);
            }
          }),
        ],
      };
    case 'win':
      return {
        gain: 0.7,
        buffers: [
          make(ctx, 2.2, 131, (d, sr) => {
            [72, 76, 79, 84, 88].forEach((m, k) => tine(d, sr, midiHz(m), k * 0.11, 0.8, 2.2));
          }, 0.9, 0.2),
        ],
      };
    case 'sparkle':
      return {
        gain: 0.4,
        buffers: [
          make(ctx, 1.1, 141, (d, sr, r) => {
            for (let p = 0; p < 9; p++) tine(d, sr, 2200 + r() * 3000, r() * 0.6, 0.3 + r() * 0.3, 9);
          }, 0.9, 0.2),
        ],
      };
    case 'amb_meadow':
    case 'amb_winter':
    case 'amb_cozy':
      return {
        gain: 0.22,
        loop: true,
        buffers: [
          make(ctx, 10, 151, (d, sr, r) => {
            const winter = name === 'amb_winter';
            let y = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const fc = winter ? 500 + 300 * Math.sin(t * 0.7) : 900;
              const a = Math.exp((-2 * Math.PI * fc) / sr);
              y = (1 - a) * (r() * 2 - 1) + a * y;
              d[i] = y * (0.6 + 0.4 * Math.sin((t / 10) * Math.PI * 2 * 2));
            }
            if (name === 'amb_meadow') {
              for (let c = 0; c < 7; c++) {
                const s = 0.5 + r() * 8.5;
                const f0 = 2600 + r() * 1400;
                for (let i = Math.floor(s * sr); i < Math.min(d.length, Math.floor((s + 0.18) * sr)); i++) {
                  const t = i / sr - s;
                  d[i] += Math.sin(2 * Math.PI * (f0 + 900 * Math.sin(t * 60)) * t) * Math.sin((t / 0.18) * Math.PI) * 0.08;
                }
              }
            }
            loopify(d, sr, 1);
          }, 0.5, 0),
        ],
      };
    default:
      return null;
  }
}

/** Soft, wide reverb impulse response (exponentially decaying stereo noise). */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const b = ctx.createBuffer(2, len, sr);
  const rng = new RNG(7);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      y = 0.6 * y + 0.4 * (rng.next() * 2 - 1);
      d[i] = y * Math.pow(1 - t, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
    }
  }
  return b;
}
