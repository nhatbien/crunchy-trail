import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const ICE = [0xc9f1ff, 0xa8e2ff, 0xd9d2ff, 0xe8fbff, 0xb3f0f0].map((c) => new THREE.Color(c));
const STUB = new THREE.Color(0.55, 0.72, 0.9);

function crystalGeometry(): THREE.BufferGeometry {
  const rng = new RNG(9);
  const parts: THREE.BufferGeometry[] = [];
  const specs = [
    [0, 0, 0.3, 0],
    [0.07, 0.04, 0.22, 0.35],
    [-0.06, 0.05, 0.18, -0.4],
    [0.01, -0.07, 0.15, 0.3],
  ];
  for (const [x, z, h, tilt] of specs) {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.055 + rng.next() * 0.02, h, 0.055 + rng.next() * 0.02);
    g.translate(0, h * 0.75, 0);
    g.rotateZ(tilt);
    g.rotateX(tilt * 0.6);
    g.rotateY(rng.next() * 6.28);
    g.translate(x, 0, z);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

/** Iridescent ice crystals that shatter into glittering shards. */
export class IceSurface extends Surface {
  readonly id = 'ice' as const;
  readonly stepSound = 'ice';
  protected readonly spacing = 0.32;
  protected jitter = 0.3;
  private b!: Batch;

  protected create(): void {
    const mat = cached(
      'ice.mat',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.04,
          metalness: 0,
          transparent: true,
          opacity: 0.8,
          clearcoat: 1,
          iridescence: 0.5,
          iridescenceIOR: 1.4,
          emissive: 0x6cc4ff,
          emissiveIntensity: 0.18,
          envMapIntensity: 1.8,
          flatShading: true,
        }),
    );
    this.b = this.batch(cached('ice.geo', crystalGeometry), mat);
  }

  protected resetLook(i: number): void {
    this.b.color(i, ICE[Math.floor(this.rnd[i] * ICE.length)]);
  }

  private size(i: number): number {
    return 0.85 + this.rnd[i] * 0.4;
  }

  protected rest(i: number, sy: number, sxz: number): void {
    const s = this.size(i);
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, this.rnd[i] * 6.28, 0, s * sxz, s * sy, s * sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('shard', x, 0.18, z, 5, { color: 0xbfeaff, speed: 2, up: 2.4, size: 0.075, life: 0.75, gravity: 9.8, drag: 1, colorJitter: 0.2 });
    this.ctx.fx.burst('spark', x, 0.25, z, 2, { color: 0xffffff, speed: 0.6, up: 1, size: 0.22, life: 0.4, gravity: 0, drag: 3 });
    return { x, z, sound: 'ice', rate: 0.95 + this.rnd[i] * 0.2, gain: 0.95, minGap: 0.055 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.09);
    const s = this.size(i);
    const ry = this.rnd[i] * 6.28;
    if (t < 0.35) {
      const k = 1 + (t / 0.35) * 0.15;
      this.b.pose(i, this.px[i], 0, this.pz[i], 0, ry, 0, s * k, s * k, s * k);
      return false;
    }
    const k = (t - 0.35) / 0.65;
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, ry, 0, s * (1.15 - 0.35 * k), s * (1.15 - 1.01 * k), s * (1.15 - 0.35 * k));
    if (t < 1) return false;
    this.b.color(i, tmpColor.copy(STUB));
    return true;
  }
}
