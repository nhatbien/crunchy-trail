import * as THREE from 'three';
import { easeOutBack, type RNG } from '../../core/rng';
import type { Particles } from '../Particles';
import { inField, type FieldShape } from '../shapes';
import type { Theme, WorldId } from '../themes';

/** A crunch that just happened – the game turns it into sound, haptics and score. */
export interface HitEvent {
  x: number;
  z: number;
  sound: string;
  rate: number;
  gain: number;
  minGap: number;
  /** Pitched note (kalimba) instead of a sample group. */
  midi?: number;
  /** Spread several hits of one frame over time (fast typing / strumming), seconds apart. */
  stagger?: number;
}

export interface SurfaceCtx {
  /** The landmass (coastline + obstacles). */
  shape: FieldShape;
  /** Which part of the landmass belongs to this area. */
  region: (x: number, z: number) => boolean;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  fx: Particles;
  rng: RNG;
  theme: Theme;
}

/** Items are split into square chunks so the camera only draws what is near it. */
interface Chunking {
  chunkOf: Uint16Array;
  local: Int32Array;
  sizes: number[];
}
const CHUNK = 4;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * A set of InstancedMeshes (one per chunk) addressed by the surface's global item
 * index. Only the instance ranges that changed are re-uploaded each frame.
 */
export class Batch {
  readonly meshes: THREE.InstancedMesh[];
  private dirty: Int32Array;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private ch: Chunking) {
    this.meshes = ch.sizes.map((n) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.count = n;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return m;
    });
    // [lo, hi, colorLo, colorHi] per chunk
    this.dirty = new Int32Array(ch.sizes.length * 4);
    this.resetDirty();
  }

  private resetDirty(): void {
    for (let c = 0; c < this.meshes.length; c++) {
      this.dirty[c * 4] = this.dirty[c * 4 + 2] = 0x7fffffff;
      this.dirty[c * 4 + 1] = this.dirty[c * 4 + 3] = -1;
    }
  }

  pose(i: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void {
    const c = this.ch.chunkOf[i], li = this.ch.local[i];
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p, _q, _s.set(sx, sy, sz)).toArray(this.meshes[c].instanceMatrix.array, li * 16);
    const d = this.dirty;
    if (li < d[c * 4]) d[c * 4] = li;
    if (li > d[c * 4 + 1]) d[c * 4 + 1] = li;
  }

  color(i: number, col: THREE.Color): void {
    const c = this.ch.chunkOf[i], li = this.ch.local[i];
    this.meshes[c].setColorAt(li, col);
    const d = this.dirty;
    if (li < d[c * 4 + 2]) d[c * 4 + 2] = li;
    if (li > d[c * 4 + 3]) d[c * 4 + 3] = li;
  }

  /** Per-chunk frustum culling: only chunks near the camera are drawn. */
  enableCulling(pad: number): void {
    for (const m of this.meshes) {
      m.computeBoundingSphere();
      if (m.boundingSphere) m.boundingSphere.radius += pad;
      m.frustumCulled = true;
    }
  }

  flush(): void {
    const d = this.dirty;
    for (let c = 0; c < this.meshes.length; c++) {
      const m = this.meshes[c];
      const lo = d[c * 4], hi = d[c * 4 + 1], clo = d[c * 4 + 2], chi = d[c * 4 + 3];
      if (hi >= lo) {
        const a = m.instanceMatrix;
        a.clearUpdateRanges();
        a.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
        a.needsUpdate = true;
        d[c * 4] = 0x7fffffff;
        d[c * 4 + 1] = -1;
      }
      if (chi >= clo && m.instanceColor) {
        const a = m.instanceColor;
        a.clearUpdateRanges();
        a.addUpdateRange(clo * 3, (chi - clo + 1) * 3);
        a.needsUpdate = true;
        d[c * 4 + 2] = 0x7fffffff;
        d[c * 4 + 3] = -1;
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
  }
}

const shared = new Map<string, unknown>();
/** Geometries / materials are shared between zones of the same kind. */
export function cached<T>(key: string, make: () => T): T {
  let v = shared.get(key) as T | undefined;
  if (v === undefined) shared.set(key, (v = make()));
  return v;
}

const REST = 0, CRUNCHING = 1, CRUSHED = 2, REGROWING = 3;
const REGROW_TIME = 0.6;
const SWEEP_BUDGET = 350;

/**
 * A field of satisfying items laid out on an island. Subclasses define how an
 * item looks at rest, what happens when it is crunched, how it animates and how
 * it grows back once the player has wandered off to another area.
 */
export abstract class Surface {
  abstract readonly id: WorldId;
  /** Soft footstep sound on already crunched ground. */
  abstract readonly stepSound: string;
  readonly root = new THREE.Group();
  n = 0;
  done = 0;
  px = new Float32Array(0);
  pz = new Float32Array(0);
  rnd = new Float32Array(0);
  state = new Uint8Array(0);
  t0 = new Float32Array(0);
  regrowAt = new Float32Array(0);
  /** Direction from the character to the item at hit time. */
  hx = new Float32Array(0);
  hz = new Float32Array(0);
  /** Character velocity direction at hit time. */
  vx = new Float32Array(0);
  vz = new Float32Array(0);
  col = new Int16Array(0);
  row = new Int16Array(0);

  protected abstract readonly spacing: number;
  /** hex = honeycomb, grid = square, keys = rows shifted like a keyboard. */
  protected layout: 'hex' | 'grid' | 'keys' = 'hex';
  protected jitter = 0;
  protected inset = 0.14;
  protected holePad = 0.1;
  /** How far animations can push items outside their spot (culling padding). */
  protected cullPad = 1;
  protected batches: Batch[] = [];
  private active: number[] = [];
  private growing: number[] = [];
  private sweep = 0;

  private chunking: Chunking = { chunkOf: new Uint16Array(0), local: new Int32Array(0), sizes: [] };
  private cs = 0.5;
  private gx0 = 0;
  private gz0 = 0;
  private gw = 0;
  private gh = 0;
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);

  constructor(protected ctx: SurfaceCtx) {}

  init(): this {
    this.layoutItems();
    this.buildGrid();
    this.buildChunks();
    this.create();
    for (let i = 0; i < this.n; i++) {
      this.rest(i, 1, 1);
      this.resetLook(i);
    }
    for (const b of this.batches) {
      this.root.add(...b.meshes);
      b.flush();
      b.enableCulling(this.cullPad);
    }
    return this;
  }

  /** Creates a chunked batch for this surface's items. */
  protected batch(geo: THREE.BufferGeometry, mat: THREE.Material): Batch {
    const b = new Batch(geo, mat, this.chunking);
    this.batches.push(b);
    return b;
  }

  private buildChunks(): void {
    const { minX, minZ } = this.ctx.bounds;
    const ids = new Map<number, number>();
    const sizes: number[] = [];
    const chunkOf = new Uint16Array(this.n);
    const local = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor((this.px[i] - minX) / CHUNK) * 1000 + Math.floor((this.pz[i] - minZ) / CHUNK);
      let c = ids.get(key);
      if (c === undefined) {
        c = sizes.length;
        ids.set(key, c);
        sizes.push(0);
      }
      chunkOf[i] = c;
      local[i] = sizes[c]++;
    }
    this.chunking = { chunkOf, local, sizes };
  }

  get progress(): number {
    return this.n ? this.done / this.n : 1;
  }

  /** Builds the meshes (batches). Poses and colors are written afterwards via rest() / resetLook(). */
  protected abstract create(): void;
  /** Writes the untouched pose, optionally squashed (sy) / widened (sxz) for wobble. */
  protected abstract rest(i: number, sy: number, sxz: number): void;
  /** Writes the untouched colors. */
  protected abstract resetLook(i: number): void;
  /** Called once when crunched: spawn particles, return the sound to play. */
  protected abstract onHit(i: number): HitEvent | null;
  /** Writes the crunch animation pose at `age` seconds; returns true when finished. */
  protected abstract pose(i: number, age: number): boolean;
  /** Grow-back animation, k goes 0 → 1 (with overshoot). */
  protected regrow(i: number, k: number): void {
    this.rest(i, k, k);
  }
  /** Optional per-frame behaviour (wind, wobble…). */
  protected ambient(_dt: number, _now: number, _cx: number, _cz: number): void {}

  private layoutItems(): void {
    const s = this.spacing;
    const sh = this.ctx.shape;
    const bb = this.ctx.bounds;
    const region = this.ctx.region;
    const rng = this.ctx.rng;
    const hex = this.layout === 'hex';
    const dz = hex ? s * 0.866 : s;
    const xs: number[] = [], zs: number[] = [], cs: number[] = [], rs: number[] = [];
    const z0 = Math.ceil((bb.minZ + this.inset) / dz) * dz;
    for (let z = z0; z <= bb.maxZ - this.inset + 1e-6; z += dz) {
      const row = Math.round(z / dz);
      const off = hex && row & 1 ? s / 2 : this.layout === 'keys' ? (((row % 4) + 4) % 4) * 0.25 * s : 0;
      const x0 = Math.ceil((bb.minX + this.inset - off) / s) * s + off;
      for (let x = x0; x <= bb.maxX - this.inset + 1e-6; x += s) {
        const jx = x + (rng.next() - 0.5) * this.jitter * s;
        const jz = z + (rng.next() - 0.5) * this.jitter * s;
        if (!region(jx, jz) || !inField(sh, jx, jz, this.inset, this.holePad)) continue;
        xs.push(jx);
        zs.push(jz);
        cs.push(Math.round((x - off) / s));
        rs.push(row);
      }
    }
    const n = (this.n = xs.length);
    this.px = new Float32Array(xs);
    this.pz = new Float32Array(zs);
    this.col = new Int16Array(cs);
    this.row = new Int16Array(rs);
    this.rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) this.rnd[i] = rng.next();
    this.state = new Uint8Array(n);
    this.t0 = new Float32Array(n);
    this.regrowAt = new Float32Array(n);
    this.hx = new Float32Array(n);
    this.hz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
  }

  private buildGrid(): void {
    const sh = this.ctx.bounds;
    this.gx0 = sh.minX - 1;
    this.gz0 = sh.minZ - 1;
    this.gw = Math.ceil((sh.maxX - sh.minX + 2) / this.cs);
    this.gh = Math.ceil((sh.maxZ - sh.minZ + 2) / this.cs);
    const cells = this.gw * this.gh;
    const count = new Int32Array(cells + 1);
    const cellOf = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const c = this.cellIndex(this.px[i], this.pz[i]);
      cellOf[i] = c;
      count[c + 1]++;
    }
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    this.cellStart = count.slice();
    this.cellItems = new Int32Array(this.n);
    const fill = count.slice();
    for (let i = 0; i < this.n; i++) this.cellItems[fill[cellOf[i]]++] = i;
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.gx0) / this.cs)));
    const cz = Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.gz0) / this.cs)));
    return cz * this.gw + cx;
  }

  /** Calls fn for every item within radius r of (x, z). */
  protected near(x: number, z: number, r: number, fn: (i: number, d2: number) => void): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor((x - r - this.gx0) / this.cs));
    const x1 = Math.min(this.gw - 1, Math.floor((x + r - this.gx0) / this.cs));
    const z0 = Math.max(0, Math.floor((z - r - this.gz0) / this.cs));
    const z1 = Math.min(this.gh - 1, Math.floor((z + r - this.gz0) / this.cs));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.gw + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const i = this.cellItems[k];
          const dx = this.px[i] - x, dz = this.pz[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(i, d2);
        }
      }
    }
  }

  /** Crunches every untouched item under the character's brush. */
  process(cx: number, cz: number, r: number, vx: number, vz: number, now: number, out: HitEvent[]): void {
    this.near(cx, cz, r, (i) => {
      if (this.state[i] === REST) this.hit(i, now, cx, cz, vx, vz, out);
    });
  }

  hit(i: number, now: number, cx: number, cz: number, vx: number, vz: number, out: HitEvent[]): void {
    this.state[i] = CRUNCHING;
    this.t0[i] = now;
    this.done++;
    const dx = this.px[i] - cx, dz = this.pz[i] - cz;
    const l = Math.hypot(dx, dz) || 1;
    this.hx[i] = dx / l;
    this.hz[i] = dz / l;
    const vl = Math.hypot(vx, vz);
    this.vx[i] = vl > 0.01 ? vx / vl : this.hx[i];
    this.vz[i] = vl > 0.01 ? vz / vl : this.hz[i];
    this.active.push(i);
    const e = this.onHit(i);
    if (e) out.push(e);
  }

  /**
   * @param canRegrow true while the player is in another area – crushed items
   *   then grow back after a while so the world never runs out of crunch.
   */
  update(dt: number, now: number, cx: number, cz: number, canRegrow: boolean): void {
    const a = this.active;
    for (let k = a.length - 1; k >= 0; k--) {
      const i = a[k];
      if (this.pose(i, now - this.t0[i])) {
        this.state[i] = CRUSHED;
        this.regrowAt[i] = now + 10 + this.rnd[i] * 14;
        a[k] = a[a.length - 1];
        a.pop();
      }
    }

    const g = this.growing;
    for (let k = g.length - 1; k >= 0; k--) {
      const i = g[k];
      const t = Math.min(1, (now - this.t0[i]) / REGROW_TIME);
      if (t >= 1) {
        this.state[i] = REST;
        this.rest(i, 1, 1);
        g[k] = g[g.length - 1];
        g.pop();
      } else {
        this.regrow(i, Math.max(0.001, easeOutBack(t)));
      }
    }

    if (canRegrow && this.done > 0 && this.n > 0) {
      for (let b = 0; b < SWEEP_BUDGET; b++) {
        const i = this.sweep;
        this.sweep = (this.sweep + 1) % this.n;
        if (this.state[i] !== CRUSHED || now < this.regrowAt[i]) continue;
        this.state[i] = REGROWING;
        this.t0[i] = now;
        this.done--;
        this.resetLook(i);
        this.regrow(i, 0.001);
        g.push(i);
      }
    }

    this.ambient(dt, now, cx, cz);
    for (const b of this.batches) b.flush();
  }

  dispose(): void {
    for (const b of this.batches) b.dispose();
    this.batches = [];
    this.root.removeFromParent();
  }
}

/** Shared color scratch object for subclasses. */
export const tmpColor = new THREE.Color();
