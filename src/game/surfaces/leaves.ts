import * as THREE from 'three';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const PALETTE = [0xf2902f, 0xe5533d, 0xf7c548, 0xc96a2b, 0xe9a23b, 0xd9472b, 0xf4b13e];

function leafGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.quadraticCurveTo(0.44, -0.18, 0, 0.5);
  s.quadraticCurveTo(-0.44, -0.18, 0, -0.5);
  const g = new THREE.ShapeGeometry(s, 5);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) ** 2 * 0.7 + 0.04 * Math.abs(p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** A crunchy pile of autumn leaves – they get kicked into the air and reveal the lawn. */
export class LeavesSurface extends Surface {
  readonly id = 'leaves' as const;
  readonly stepSound = 'leaves';
  protected cullPad = 2.5;
  protected readonly spacing = 0.18;
  protected layout = 'grid' as const;
  protected jitter = 0.95;
  private b!: Batch;

  protected create(): void {
    const mat = cached('leaves.mat', () => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75 }));
    this.b = this.batch(cached('leaves.geo', leafGeometry), mat);
  }

  protected resetLook(i: number): void {
    this.b.color(i, this.leafColor(i));
  }

  /** New leaves flutter down from above. */
  protected regrow(i: number, k: number): void {
    const s = this.size(i);
    const t = this.tilt(i);
    const fall = Math.max(0, 1 - k);
    const sway = Math.sin(fall * 7 + this.rnd[i] * 6) * 0.3 * fall;
    this.b.pose(i, this.px[i] + sway, this.y0(i) + fall * 2.4, this.pz[i], t + fall * 2.5, this.rnd[i] * 6.28 + fall * 4, -t * 0.7, s, s, s);
  }

  private leafColor(i: number): THREE.Color {
    const r = this.rnd[i];
    return tmpColor.set(PALETTE[Math.floor(r * PALETTE.length)]).multiplyScalar(0.9 + ((r * 31) % 1) * 0.2);
  }
  private size(i: number): number {
    return 0.24 + this.rnd[i] * 0.12;
  }
  private y0(i: number): number {
    return 0.012 + ((this.rnd[i] * 17) % 1) * 0.05;
  }
  private tilt(i: number): number {
    return (((this.rnd[i] * 7.3) % 1) - 0.5) * 0.45;
  }

  protected rest(i: number, sy: number, sxz: number): void {
    const s = this.size(i) * sxz;
    const t = this.tilt(i);
    this.b.pose(i, this.px[i], this.y0(i) + (sy - 1) * 0.12, this.pz[i], t, this.rnd[i] * 6.28, -t * 0.7, s, s, s);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    if (this.rnd[i] < 0.5) {
      this.ctx.fx.burst('flat', x, 0.08, z, 1, { color: this.leafColor(i).multiplyScalar(0.8), speed: 1, up: 1.8, size: 0.05, life: 0.6, gravity: 5, drag: 2 });
    }
    return { x, z, sound: 'leaves', rate: 0.92 + this.rnd[i] * 0.16, gain: 0.9, minGap: 0.05 };
  }

  protected pose(i: number, t: number): boolean {
    const dur = 0.8;
    const s = this.size(i);
    if (t >= dur) {
      this.b.pose(i, this.px[i], -1, this.pz[i], 0, 0, 0, 0, 0, 0);
      return true;
    }
    let dx = this.hx[i] * 0.6 + this.vx[i] * 0.8;
    let dz = this.hz[i] * 0.6 + this.vz[i] * 0.8;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const sp = 1.3 + this.rnd[i] * 1.3;
    const dist = sp * t * (1 - t * 0.45);
    const y = Math.max(0.01, this.y0(i) + 2.5 * t - 4.2 * t * t);
    const spin = (this.rnd[i] - 0.5) * 16 * t;
    const k = t > 0.6 ? 1 - (t - 0.6) / 0.2 : 1;
    this.b.pose(i, this.px[i] + dx * dist, y, this.pz[i] + dz * dist, this.tilt(i) + t * 7, this.rnd[i] * 6.28 + spin, t * 3, s * k, s * k, s * k);
    return false;
  }
}
