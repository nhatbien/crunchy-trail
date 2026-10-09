import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

/** Major pentatonic around C5 – any path you walk sounds like a melody. */
const SCALE = [-5, -3, 0, 2, 4, 7, 9, 12];
const ROOT = 72;

/** Pastel musical tiles: each one plays a kalimba note and lights up. */
export class KalimbaSurface extends Surface {
  readonly id = 'kalimba' as const;
  readonly stepSound = 'wood';
  protected readonly spacing = 0.44;
  protected layout = 'grid' as const;
  protected inset = 0.2;
  private b!: Batch;

  protected create(): void {
    const geo = cached('kalimba.geo', () => new RoundedBoxGeometry(0.4, 0.1, 0.4, 1, 0.04).translate(0, 0.05, 0));
    const mat = cached('kalimba.mat', () => new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 }));
    this.b = this.batch(geo, mat);
  }

  protected resetLook(i: number): void {
    this.b.color(i, this.base(i));
  }

  /** The key rises back and its glow fades. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 1 - 0.3 * (1 - Math.min(1, k)), 1);
  }

  private base(i: number): THREE.Color {
    return tmpColor.setHSL((((this.col[i] * 0.065) % 1) + 1) % 1, 0.6, 0.64);
  }

  private note(i: number): number {
    const k = (((this.col[i] + this.row[i] * 3) % SCALE.length) + SCALE.length) % SCALE.length;
    return ROOT + SCALE[k];
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.b.pose(i, this.px[i], (sy - 1) * 0.08, this.pz[i], 0, 0, 0, sxz, 1, sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    const c = this.base(i).clone().lerp(new THREE.Color(1, 1, 1), 0.4);
    this.ctx.fx.burst('spark', x, 0.2, z, 3, { color: c, speed: 0.5, up: 1.6, size: 0.24, life: 0.7, gravity: -0.6, drag: 2 });
    return { x, z, sound: 'kalimba', midi: this.note(i), rate: 1, gain: 0.9, minGap: 0 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.38);
    const y = t < 0.2 ? -0.045 * easeOutCubic(t / 0.2) : -0.045 * (1 - 0.45 * easeOutCubic((t - 0.2) / 0.8));
    this.b.pose(i, this.px[i], y, this.pz[i], 0, 0, 0, 1, 1, 1);
    // Colors above 1.0 make the tile look lit from within.
    const glow = t < 0.2 ? 1 + 0.9 * (t / 0.2) : 1.9 - 0.5 * ((t - 0.2) / 0.8);
    this.b.color(i, this.base(i).multiplyScalar(glow));
    return t >= 1;
  }
}
