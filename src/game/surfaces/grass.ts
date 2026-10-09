import * as THREE from 'three';
import { easeOutCubic, RNG } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const windTime = { value: 0 };

/** One tuft = six tapered blades, dark at the root and sunlit at the tip. */
function tuftGeometry(): THREE.BufferGeometry {
  const rng = new RNG(5);
  const pos: number[] = [], col: number[] = [], nrm: number[] = [], idx: number[] = [];
  const root = new THREE.Color(0x2f7a32), tip = new THREE.Color(0xc4ee74);
  let v = 0;
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(0.01, 0.05);
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = rng.range(0.24, 0.38);
    const w = rng.range(0.028, 0.04);
    const lean = rng.range(0.05, 0.13);
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const pts: [number, number, number, number][] = [
      [ox - px, 0, oz - pz, 0],
      [ox + px, 0, oz + pz, 0],
      [ox + lx * 0.4 - px * 0.6, h * 0.5, oz + lz * 0.4 - pz * 0.6, 0.55],
      [ox + lx * 0.4 + px * 0.6, h * 0.5, oz + lz * 0.4 + pz * 0.6, 0.55],
      [ox + lx, h, oz + lz, 1],
    ];
    for (const [x, y, z, t] of pts) {
      pos.push(x, y, z);
      nrm.push(0, 1, 0);
      const c = root.clone().lerp(tip, t);
      col.push(c.r, c.g, c.b);
    }
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2, v + 2, v + 3, v + 4);
    v += 5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function grassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float hgt = max(position.y, 0.0);
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float tall = length(instanceMatrix[1].xyz);
      #else
        vec2 ip = vec2(0.0); float tall = 1.0;
      #endif
      float sway = sin(uTime * 1.7 + ip.x * 0.8 + ip.y * 0.55) * 0.6 + sin(uTime * 2.9 + ip.x * 1.9 - ip.y) * 0.25;
      transformed.x += sway * hgt * hgt * 1.2 * tall;
      transformed.z += sway * hgt * hgt * 0.5 * tall;`,
    );
  };
  return m;
}

/** Fresh lawn: tufts sway in the wind; mowing leaves light/dark stripes like a real lawn. */
export class GrassSurface extends Surface {
  readonly id = 'grass' as const;
  readonly stepSound = 'grass';
  protected readonly spacing = 0.17;
  protected layout = 'grid' as const;
  protected jitter = 0.8;
  private b!: Batch;

  protected create(): void {
    this.b = this.batch(cached('grass.geo', tuftGeometry), cached('grass.mat', grassMaterial));
  }

  protected resetLook(i: number): void {
    const r = this.rnd[i];
    this.b.color(i, tmpColor.setRGB(0.88 + r * 0.2, 0.92 + r * 0.14, 0.85 + ((r * 7) % 1) * 0.2));
  }

  /** Grows back up from the cut stubs. */
  protected regrow(i: number, k: number): void {
    this.rest(i, 0.2 + 0.8 * k, 1);
  }

  private height(i: number): number {
    return 0.85 + this.rnd[i] * 0.4;
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, this.rnd[i] * 6.28, 0, sxz, this.height(i) * sy, sxz);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    this.ctx.fx.burst('flat', x, 0.22, z, 2, {
      color: 0x86cc52, speed: 0.9, up: 2.6, size: 0.055, life: 0.85, gravity: 7, drag: 2,
      dirX: this.vx[i] * 0.9, dirZ: this.vz[i] * 0.9, colorJitter: 0.4,
    });
    return { x, z, sound: 'grass', rate: 0.92 + this.rnd[i] * 0.18, gain: 0.85, minGap: 0.045 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.08);
    const h = this.height(i);
    this.b.pose(i, this.px[i], 0, this.pz[i], 0, this.rnd[i] * 6.28, 0, 1, h + (0.2 - h) * easeOutCubic(t), 1);
    if (t < 1) return false;
    const vx = this.vx[i], vz = this.vz[i];
    const light = (Math.abs(vz) >= Math.abs(vx) ? vz : vx) > 0;
    const k = light ? 1.25 : 0.82;
    tmpColor.setRGB(0.95 * k, 1.0 * k, 0.9 * k);
    this.b.color(i, tmpColor);
    return true;
  }

  protected ambient(_dt: number, now: number): void {
    windTime.value = now;
  }
}
