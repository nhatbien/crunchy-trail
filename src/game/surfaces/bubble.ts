import * as THREE from 'three';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const POPPED = new THREE.Color(0.7, 0.78, 0.9);

/** Glossy bubble wrap: every bubble inflates for a split second, then pops flat. */
export class BubbleSurface extends Surface {
  readonly id = 'bubble' as const;
  readonly stepSound = 'step';
  protected readonly spacing = 0.29;
  private b!: Batch;

  protected create(): void {
    const geo = cached('bubble.geo', () => new THREE.SphereGeometry(0.13, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2));
    const mat = cached(
      'bubble.mat',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.03,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          transparent: true,
          opacity: 0.58,
          envMapIntensity: 2.4,
          depthWrite: false,
        }),
    );
    this.b = this.batch(geo, mat);
  }

  protected resetLook(i: number): void {
    this.b.color(i, tmpColor.setHSL(0.55 + this.rnd[i] * 0.06, 0.8, 0.9));
  }

  /** Re-inflates from the popped film. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 0.14 + 0.86 * k, 1 + 0.1 * (1 - k));
  }

  private size(i: number): number {
    return 0.9 + this.rnd[i] * 0.18;
  }

  protected rest(i: number, sy: number, sxz: number): void {
    const s = this.size(i);
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, this.rnd[i] * 6, 0, s * sxz, s * 0.95 * sy, s * sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('spark', x, 0.14, z, 2, { color: 0xffffff, speed: 0.8, up: 1.2, size: 0.2, life: 0.35, gravity: 0, drag: 4 });
    this.ctx.fx.burst('ball', x, 0.1, z, 3, { color: 0xeaf6ff, speed: 1.2, up: 1.6, size: 0.035, life: 0.4, gravity: 6, drag: 3 });
    return { x, z, sound: 'pop', rate: 0.9 + this.rnd[i] * 0.25, gain: 1, minGap: 0.03 };
  }

  protected pose(i: number, age: number): boolean {
    const s = this.size(i);
    const x = this.px[i], z = this.pz[i], ry = this.rnd[i] * 6;
    const inflate = 0.035, dur = 0.15;
    if (age < inflate) {
      const k = 1 + (age / inflate) * 0.2;
      this.b.pose(i, x, 0, z, 0, ry, 0, s * k, s * 0.95 * k, s * k);
      return false;
    }
    const t = Math.min(1, (age - inflate) / (dur - inflate));
    const e = easeOutCubic(t);
    const sy = 1.14 + (0.14 - 1.14) * e;
    const sxz = 1.2 - 0.1 * e;
    const crumple = (this.rnd[i] - 0.5) * 0.5 * e;
    this.b.pose(i, x, 0, z, crumple, ry, -crumple, s * sxz, s * sy, s * sxz);
    if (t < 1) return false;
    this.b.color(i, POPPED);
    return true;
  }
}
