import * as THREE from 'three';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

/** Rainbow silicone pop-it: domes snap inwards with a soft "thock". */
export class PopitSurface extends Surface {
  readonly id = 'popit' as const;
  readonly stepSound = 'step';
  protected readonly spacing = 0.38;
  protected layout = 'grid' as const;
  private domes!: Batch;
  private tiles!: Batch;

  private hue(i: number): number {
    return (((this.row[i] * 0.085) % 1) + 1) % 1;
  }

  protected create(): void {
    const dome = cached('popit.dome', () => new THREE.SphereGeometry(0.14, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2));
    const tile = cached('popit.tile', () => new THREE.BoxGeometry(0.37, 0.06, 0.37));
    const mat = cached('popit.mat', () => new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0 }));
    this.tiles = this.batch(tile, mat);
    this.domes = this.batch(dome, mat);
    for (let i = 0; i < this.n; i++) {
      this.tiles.pose(i, this.px[i], 0, this.pz[i], 0, 0, 0, 1, 1, 1);
      this.tiles.color(i, tmpColor.setHSL(this.hue(i), 0.75, 0.75));
    }
  }

  protected resetLook(i: number): void {
    this.domes.color(i, tmpColor.setHSL(this.hue(i), 0.8, 0.68));
  }

  /** The dome pops back up. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 0.12 + 0.88 * k, 1);
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.domes.pose(i, this.px[i], 0.03, this.pz[i], 0, 0, 0, sxz, 0.8 * sy, sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('spark', x, 0.15, z, 2, { color: tmpColor.setHSL(this.hue(i), 0.9, 0.8), speed: 0.7, up: 1.3, size: 0.2, life: 0.4, gravity: 0, drag: 3 });
    return { x, z, sound: 'popit', rate: 0.92 + this.rnd[i] * 0.2, gain: 1, minGap: 0.03 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.13);
    const sy = t < 0.6 ? 0.8 + (0.02 - 0.8) * easeOutCubic(t / 0.6) : 0.02 + 0.1 * ((t - 0.6) / 0.4);
    const sxz = 1 + 0.12 * Math.sin(t * Math.PI);
    this.domes.pose(i, this.px[i], 0.03, this.pz[i], 0, 0, 0, sxz, sy, sxz);
    if (t < 1) return false;
    this.domes.color(i, tmpColor.setHSL(this.hue(i), 0.7, 0.55));
    return true;
  }
}
