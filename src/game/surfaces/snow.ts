import * as THREE from 'three';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const PACKED = new THREE.Color(0.8, 0.86, 0.97);

/** Thick, fluffy fresh snow that packs down into blue-ish footprints. */
export class SnowSurface extends Surface {
  readonly id = 'snow' as const;
  readonly stepSound = 'snow';
  protected readonly spacing = 0.25;
  protected jitter = 0.25;
  private b!: Batch;

  protected create(): void {
    const geo = cached('snow.geo', () => new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2));
    const mat = cached('snow.mat', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }));
    this.b = this.batch(geo, mat);
  }

  protected resetLook(i: number): void {
    const r = this.rnd[i];
    this.b.color(i, tmpColor.setRGB(0.9 + r * 0.06, 0.94 + r * 0.04, 1));
  }

  /** Fresh snowfall piles back up. */
  protected regrow(i: number, k: number): void {
    this.rest(i, k, 0.9 + 0.1 * k);
  }

  private size(i: number): number {
    return 1.05 + this.rnd[i] * 0.35;
  }
  private height(i: number): number {
    return 0.55 + ((this.rnd[i] * 13) % 1) * 0.25;
  }

  protected rest(i: number, sy: number, sxz: number): void {
    const s = this.size(i);
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, this.rnd[i] * 6, 0, s * sxz, s * this.height(i) * sy, s * sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('ball', x, 0.12, z, 3, { color: 0xffffff, speed: 0.9, up: 1.3, size: 0.07, life: 0.55, gravity: 1.5, drag: 3.5, colorJitter: 0.04 });
    if (this.rnd[i] < 0.3) this.ctx.fx.burst('spark', x, 0.15, z, 1, { color: 0xdff1ff, speed: 0.4, up: 0.8, size: 0.16, life: 0.4, gravity: 0, drag: 3 });
    return { x, z, sound: 'snow', rate: 0.92 + this.rnd[i] * 0.16, gain: 0.95, minGap: 0.07 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.12);
    const e = easeOutCubic(t);
    const s = this.size(i), h = this.height(i);
    const sy = h - (h - 0.16) * e;
    const sxz = 1 + 0.14 * e;
    this.b.pose(i, this.px[i], -0.01 * e, this.pz[i], 0, this.rnd[i] * 6, 0, s * sxz, s * sy, s * sxz);
    if (t < 1) return false;
    this.b.color(i, PACKED);
    return true;
  }
}
