import type { RNG } from '../core/rng';

export type ShapeKind = 'roundRect' | 'circle' | 'ellipse' | 'blob' | 'heart' | 'flower' | 'hexagon' | 'star' | 'capsule';

export interface Hole {
  x: number;
  z: number;
  r: number;
}

/** Playfield outline in the XZ plane (x → right, z → towards the camera). */
export interface FieldShape {
  kind: ShapeKind;
  /** Flat [x0, z0, x1, z1, …] polygon. */
  pts: Float32Array;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  holes: Hole[];
  /** Optional precomputed signed distance to the rim (positive inside) – O(1) lookups for big shapes. */
  sdf?: (x: number, z: number) => number;
}

function chaikin(p: number[], iterations: number): number[] {
  let pts = p;
  for (let it = 0; it < iterations; it++) {
    const out: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1];
      const bx = pts[j * 2], bz = pts[j * 2 + 1];
      out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
    }
    pts = out;
  }
  return pts;
}

function roundRect(w: number, h: number, r: number): number[] {
  const pts: number[] = [];
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  const corners: [number, number, number][] = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, Math.PI * 1.5],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= 10; k++) {
      const a = a0 + (k / 10) * (Math.PI / 2);
      pts.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
  }
  return pts;
}

function polar(fn: (a: number) => number, sx: number, sz: number, n = 128): number[] {
  const pts: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = fn(a);
    pts.push(Math.cos(a) * r * sx, Math.sin(a) * r * sz);
  }
  return pts;
}

export function makeShape(kind: ShapeKind, w: number, h: number, rng: RNG): FieldShape {
  const hw = w / 2, hh = h / 2;
  let pts: number[];
  switch (kind) {
    case 'circle': {
      const r = Math.sqrt(hw * hh) * 1.06;
      pts = polar(() => 1, r, r);
      break;
    }
    case 'ellipse':
      pts = polar(() => 1, hw * 1.05, hh * 1.05);
      break;
    case 'blob': {
      const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28);
      pts = polar((a) => 1 + 0.1 * Math.sin(3 * a + p1) + 0.06 * Math.sin(5 * a + p2), hw * 1.02, hh * 1.02);
      break;
    }
    case 'flower': {
      const r = Math.sqrt(hw * hh) * 1.12;
      pts = polar((a) => 0.86 + 0.14 * Math.cos(6 * a), r, r);
      break;
    }
    case 'star': {
      const r = Math.sqrt(hw * hh) * 1.25;
      pts = polar((a) => 0.72 + 0.28 * Math.cos(5 * (a + Math.PI / 2)), r, r);
      break;
    }
    case 'hexagon': {
      const r = Math.sqrt(hw * hh) * 1.12;
      const raw: number[] = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        raw.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      pts = chaikin(raw, 4);
      break;
    }
    case 'heart': {
      pts = [];
      const n = 140;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push((x / 16) * hw * 1.18, (-(y + 2.5) / 14.5) * hh * 1.08);
      }
      break;
    }
    case 'capsule':
      pts = roundRect(w * 0.82, h * 1.12, w * 0.41);
      break;
    case 'roundRect':
    default:
      pts = roundRect(w, h, Math.min(w, h) * 0.24);
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  return { kind, pts: new Float32Array(pts), minX, maxX, minZ, maxZ, holes: [] };
}

export function insidePoly(pts: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1];
    const xj = pts[j * 2], zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function edgeDistance(pts: Float32Array, x: number, z: number): number {
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[j * 2], az = pts[j * 2 + 1];
    const bx = pts[i * 2], bz = pts[i * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** True when (x, z) is inside the field, at least `margin` from the rim and `holePad` from obstacles. */
export function inField(s: FieldShape, x: number, z: number, margin: number, holePad = margin): boolean {
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
  if (s.sdf) {
    if (s.sdf(x, z) < margin) return false;
  } else {
    if (!insidePoly(s.pts, x, z)) return false;
    if (margin > 0 && edgeDistance(s.pts, x, z) < margin) return false;
  }
  for (const h of s.holes) {
    const dx = x - h.x, dz = z - h.z, r = h.r + holePad;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/** Uniformly scales a shape (about its origin) so no point is farther than rmax. */
export function fitShape(s: FieldShape, rmax: number): FieldShape {
  let far = 0;
  for (let i = 0; i < s.pts.length; i += 2) far = Math.max(far, Math.hypot(s.pts[i], s.pts[i + 1]));
  const k = far > rmax ? rmax / far : 1;
  return transformShape(s, k, 0, 0);
}

/** Scales by k then moves by (dx, dz). */
export function transformShape(s: FieldShape, k: number, dx: number, dz: number): FieldShape {
  const pts = new Float32Array(s.pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] = s.pts[i] * k + dx;
    pts[i + 1] = s.pts[i + 1] * k + dz;
  }
  return {
    kind: s.kind,
    pts,
    minX: s.minX * k + dx,
    maxX: s.maxX * k + dx,
    minZ: s.minZ * k + dz,
    maxZ: s.maxZ * k + dz,
    holes: s.holes.map((h) => ({ x: h.x * k + dx, z: h.z * k + dz, r: h.r * k })),
  };
}

/** Rasterises the signed rim distance (positive inside) so large shapes get O(1) inside/margin tests. */
export function attachSdf(s: FieldShape, cell = 0.25): FieldShape {
  const x0 = s.minX - 1, z0 = s.minZ - 1;
  const w = Math.ceil((s.maxX - s.minX + 2) / cell) + 1;
  const h = Math.ceil((s.maxZ - s.minZ + 2) / cell) + 1;
  const d = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      const e = edgeDistance(s.pts, x, z);
      d[j * w + i] = insidePoly(s.pts, x, z) ? e : -e;
    }
  }
  s.sdf = (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= w - 1 || j >= h - 1) return -1;
    const tx = fx - i, tz = fz - j, k = j * w + i;
    const a = d[k] + (d[k + 1] - d[k]) * tx;
    const b = d[k + w] + (d[k + w + 1] - d[k + w]) * tx;
    return a + (b - a) * tz;
  };
  return s;
}
