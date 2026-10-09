import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { easeInOutSine, RNG } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const STRIPES = [0xffb7c9, 0xd9bdff, 0xa9d4ff, 0xb5efd3, 0xffe7a6].map((c) => new THREE.Color(c));

/** Fine grain noise so the sand reads as sand up close. */
function grainTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const rng = new RNG(3);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + rng.next() * 55 - (rng.next() < 0.06 ? 50 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Layered rainbow kinetic sand – each slice crumbles and tips over as you cut through. */
export class SandSurface extends Surface {
  readonly id = 'sand' as const;
  readonly stepSound = 'sand';
  protected readonly spacing = 0.28;
  protected layout = 'grid' as const;
  protected inset = 0.16;
  private b!: Batch;
  private base: THREE.Color[] = [];

  protected create(): void {
    const geo = cached('sand.geo', () => new RoundedBoxGeometry(0.276, 0.25, 0.276, 1, 0.04).translate(0, 0.125, 0));
    const mat = cached('sand.mat', () => new THREE.MeshStandardMaterial({ roughness: 1, map: grainTexture() }));
    this.b = this.batch(geo, mat);
    for (let i = 0; i < this.n; i++) {
      const f = ((this.pz[i] / 1.1) % STRIPES.length + STRIPES.length) % STRIPES.length;
      const k = Math.floor(f);
      this.base.push(STRIPES[k].clone().lerp(STRIPES[(k + 1) % STRIPES.length], f - k));
    }
  }

  protected resetLook(i: number): void {
    this.b.color(i, this.base[i]);
  }

  /** The slice rebuilds itself from the smoothed layer. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 0.13 + 0.87 * k, 1);
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, 0, 0, sxz, sy, sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('cube', x, 0.2, z, 4, {
      color: this.base[i], speed: 1.3, up: 1.6, size: 0.045, life: 0.7, gravity: 9.8, drag: 1.5,
      dirX: this.vx[i] * 0.5, dirZ: this.vz[i] * 0.5, colorJitter: 0.2,
    });
    return { x, z, sound: 'sand', rate: 0.9 + this.rnd[i] * 0.2, gain: 0.95, minGap: 0.05 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.17);
    const e = easeInOutSine(t);
    const tip = 0.55 * Math.sin(t * Math.PI);
    this.b.pose(i, this.px[i], 0, this.pz[i], this.vz[i] * tip, 0, -this.vx[i] * tip, 1 - 0.04 * e, 1 - 0.87 * e, 1 - 0.04 * e);
    if (t < 1) return false;
    this.b.color(i, tmpColor.copy(this.base[i]).multiplyScalar(0.86));
    return true;
  }
}
