import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const JELLY = [0xff8fab, 0xb2e88a, 0xbca0ff, 0xffbb7c, 0x8ebfff, 0xffe07e].map((c) => new THREE.Color(c));
const WOBBLE_R = 1.25;

/** Glossy jelly cubes that jiggle when you walk close and splat into puddles. */
export class JellySurface extends Surface {
  readonly id = 'jelly' as const;
  readonly stepSound = 'slime';
  protected readonly spacing = 0.36;
  protected layout = 'grid' as const;
  protected jitter = 0.06;
  private b!: Batch;
  private energy = new Float32Array(0);
  private wobbling: number[] = [];
  private inWob = new Uint8Array(0);

  protected create(): void {
    const geo = cached('jelly.geo', () => new RoundedBoxGeometry(0.3, 0.3, 0.3, 1, 0.085).translate(0, 0.15, 0));
    const mat = cached(
      'jelly.mat',
      () =>
        new THREE.MeshPhysicalMaterial({
          roughness: 0.12,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          transparent: true,
          opacity: 0.88,
          sheen: 0.6,
          sheenRoughness: 0.3,
          sheenColor: 0xffffff,
          envMapIntensity: 1.3,
        }),
    );
    this.b = this.batch(geo, mat);
    this.energy = new Float32Array(this.n);
    this.inWob = new Uint8Array(this.n);
  }

  protected resetLook(i: number): void {
    this.b.color(i, this.color(i));
  }

  /** The puddle wobbles back into a cube. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 0.17 + 0.83 * k, 1.38 - 0.38 * k);
  }

  private color(i: number): THREE.Color {
    return JELLY[Math.floor(this.rnd[i] * JELLY.length)];
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, (this.rnd[i] - 0.5) * 0.3, 0, sxz, sy, sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('ball', x, 0.2, z, 4, { color: this.color(i), speed: 1.6, up: 2.2, size: 0.065, life: 0.7, gravity: 9.8, drag: 1, colorJitter: 0.1 });
    return { x, z, sound: 'slime', rate: 0.9 + this.rnd[i] * 0.2, gain: 1, minGap: 0.06 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.32);
    let sy: number, sxz: number;
    if (t < 0.25) {
      const k = easeOutCubic(t / 0.25);
      sy = 1 - 0.6 * k;
      sxz = 1 + 0.3 * k;
    } else {
      const k = (t - 0.25) / 0.75;
      const wob = Math.exp(-k * 5) * Math.cos(k * 14);
      sy = 0.17 + 0.23 * wob;
      sxz = 1.38 - 0.08 * wob;
    }
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, (this.rnd[i] - 0.5) * 0.3, 0, sxz, sy, sxz);
    if (t < 1) return false;
    this.b.color(i, tmpColor.copy(this.color(i)).lerp(new THREE.Color(1, 1, 1), 0.25));
    return true;
  }

  protected ambient(dt: number, now: number, cx: number, cz: number): void {
    this.near(cx, cz, WOBBLE_R, (i, d2) => {
      if (this.state[i] !== 0) return;
      const e = 1 - Math.sqrt(d2) / WOBBLE_R;
      if (e > this.energy[i]) {
        this.energy[i] = e;
        if (!this.inWob[i]) {
          this.inWob[i] = 1;
          this.wobbling.push(i);
        }
      }
    });
    const w = this.wobbling;
    const decay = Math.exp(-dt * 2.2);
    for (let k = w.length - 1; k >= 0; k--) {
      const i = w[k];
      this.energy[i] *= decay;
      if (this.state[i] !== 0 || this.energy[i] < 0.02) {
        if (this.state[i] === 0) this.rest(i, 1, 1);
        this.inWob[i] = 0;
        this.energy[i] = 0;
        w[k] = w[w.length - 1];
        w.pop();
        continue;
      }
      const s = Math.sin(now * 19 + this.rnd[i] * 6.28) * 0.11 * this.energy[i];
      this.rest(i, 1 + s, 1 - s * 0.5);
    }
  }
}
