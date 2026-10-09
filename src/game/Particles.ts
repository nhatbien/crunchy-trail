import * as THREE from 'three';

export type ParticleKind = 'cube' | 'ball' | 'shard' | 'flat' | 'spark';

export interface BurstOpts {
  color: THREE.ColorRepresentation;
  /** Horizontal speed. */
  speed?: number;
  /** Upward speed. */
  up?: number;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** Bias direction on the ground plane (normalized-ish). */
  dirX?: number;
  dirZ?: number;
  /** Random brightness variation 0..1. */
  colorJitter?: number;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private alive = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private max: number,
    private billboard: boolean,
    private sparkle: boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color, gravity: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.rot[k] = Math.random() * 6.28; this.rot[k + 1] = Math.random() * 6.28; this.rot[k + 2] = Math.random() * 6.28;
    this.spin[k] = (Math.random() - 0.5) * 14; this.spin[k + 1] = (Math.random() - 0.5) * 14; this.spin[k + 2] = (Math.random() - 0.5) * 14;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, cam: THREE.Camera, floor: (x: number, z: number) => boolean): void {
    if (this.alive <= 0) return;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        _m.makeScale(0, 0, 0).toArray(arr, i * 16);
        continue;
      }
      alive++;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 2] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02 && this.vel[k + 1] < 0 && floor(this.pos[k], this.pos[k + 2])) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] *= -0.3;
        this.vel[k] *= 0.6;
        this.vel[k + 2] *= 0.6;
        this.spin[k] *= 0.5;
        this.spin[k + 2] *= 0.5;
      }
      const t = this.life[i] / this.maxLife[i];
      let s = this.size[i];
      if (this.sparkle) s *= Math.sin(t * Math.PI) * (0.75 + 0.25 * Math.sin(this.life[i] * 40 + i));
      else s *= t < 0.35 ? t / 0.35 : 1;
      _p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      if (this.billboard) _q.copy(cam.quaternion);
      else {
        this.rot[k] += this.spin[k] * dt;
        this.rot[k + 1] += this.spin[k + 1] * dt;
        this.rot[k + 2] += this.spin[k + 2] * dt;
        _q.setFromEuler(_e.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]));
      }
      _m.compose(_p, _q, _s.set(s, s, s)).toArray(arr, i * 16);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) {
      this.life[i] = 0;
      this.mesh.setMatrixAt(i, _m);
    }
    this.alive = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function sparkTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // four-point star glint
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(32, 2); g.quadraticCurveTo(35, 29, 62, 32); g.quadraticCurveTo(35, 35, 32, 62);
  g.quadraticCurveTo(29, 35, 2, 32); g.quadraticCurveTo(29, 29, 32, 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** All short-lived visual feedback: crumbs, droplets, shards, leaves, confetti and glints. */
export class Particles {
  readonly root = new THREE.Group();
  private pools: Record<ParticleKind, Pool>;
  /** Island floor test (particles bounce only on top of the island). */
  floor: (x: number, z: number) => boolean = () => true;

  constructor(private camera: THREE.Camera) {
    const std = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ roughness: 0.6, ...o });
    const flatGeo = new THREE.PlaneGeometry(1, 1);
    this.pools = {
      cube: new Pool(new THREE.BoxGeometry(1, 1, 1), std({ roughness: 0.9 }), 500, false, false),
      ball: new Pool(new THREE.IcosahedronGeometry(0.5, 1), std({ roughness: 0.25 }), 400, false, false),
      shard: new Pool(
        new THREE.OctahedronGeometry(0.5, 0).scale(0.5, 1.4, 0.5),
        std({ roughness: 0.08, transparent: true, opacity: 0.85, emissive: 0x4aa8ff, emissiveIntensity: 0.25, flatShading: true }),
        300, false, false,
      ),
      flat: new Pool(flatGeo, std({ side: THREE.DoubleSide, roughness: 0.7 }), 700, false, false),
      spark: new Pool(
        flatGeo,
        new THREE.MeshBasicMaterial({ map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        400, true, true,
      ),
    };
    for (const p of Object.values(this.pools)) this.root.add(p.mesh);
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.ColorRepresentation, gravity = 9.8, drag = 1): void {
    this.pools[kind].emit(x, y, z, vx, vy, vz, size, life, _c.set(color), gravity, drag);
  }

  burst(kind: ParticleKind, x: number, y: number, z: number, n: number, o: BurstOpts): void {
    const speed = o.speed ?? 1.5, up = o.up ?? 2, size = o.size ?? 0.06, life = o.life ?? 0.7;
    const g = o.gravity ?? 9.8, drag = o.drag ?? 1.2, cj = o.colorJitter ?? 0.15;
    const base = new THREE.Color(o.color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      const vx = Math.cos(a) * sp + (o.dirX ?? 0) * speed;
      const vz = Math.sin(a) * sp + (o.dirZ ?? 0) * speed;
      const vy = up * (0.6 + Math.random() * 0.6);
      _c.copy(base).multiplyScalar(1 - cj / 2 + Math.random() * cj);
      this.pools[kind].emit(x, y, z, vx, vy, vz, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), _c, g, drag);
    }
  }

  update(dt: number): void {
    for (const p of Object.values(this.pools)) p.update(dt, this.camera, this.floor);
  }

  clear(): void {
    for (const p of Object.values(this.pools)) p.clear();
  }
}
