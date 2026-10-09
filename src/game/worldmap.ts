import { RNG } from '../core/rng';
import { attachSdf, type FieldShape } from './shapes';
import type { WorldId } from './themes';

/**
 * One relaxing landmass split into ASMR areas laid out on a grid of cells. A world
 * listed in several cells becomes one bigger area (the long creamy keyboard on the
 * east side). Borders are domain-warped so neighbouring materials meet along soft,
 * wavy seams instead of straight lines.
 */
export const GRID: WorldId[][] = [
  ['snow', 'ice', 'kalimba', 'keyboard'],
  ['leaves', 'bubble', 'popit', 'keyboard'],
  ['grass', 'sand', 'jelly', 'keyboard'],
];

/** Size of one grid cell. */
export const CELL = 8;
const COLS = GRID[0].length;
const ROWS = GRID.length;
const HALF_X = (CELL * COLS) / 2;
const HALF_Z = (CELL * ROWS) / 2;
/** How far a border can wander from its straight grid line. */
const WARP = 1.6;
/** Half-width of the item-free seam between areas. */
const SEAM = 0.22;

/** Unique worlds in reading order; their position in this list is the zone index. */
const WORLDS: WorldId[] = [...new Set(GRID.flat())];
const CELL_ZONE = GRID.map((row) => row.map((w) => WORLDS.indexOf(w)));

export interface ZoneSpec {
  index: number;
  world: WorldId;
  cx: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  seed: number;
}

export interface WorldMap {
  land: FieldShape;
  zones: ZoneSpec[];
  hub: number;
}

const wx = (x: number, z: number) => x + 1.1 * Math.sin(z * 0.46 + 1.3) + 0.5 * Math.sin(z * 1.22 + x * 0.34);
const wz = (x: number, z: number) => z + 1.1 * Math.sin(x * 0.42 + 0.7) + 0.5 * Math.sin(x * 1.14 - z * 0.26);

/** Index of the area under (x, z) – ignores the coastline. */
export function zoneIndex(x: number, z: number): number {
  const c = Math.min(COLS - 1, Math.max(0, Math.floor((wx(x, z) + HALF_X) / CELL)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor((wz(x, z) + HALF_Z) / CELL)));
  return CELL_ZONE[r][c];
}

export function zoneWorld(i: number): WorldId {
  return WORLDS[i];
}

/** True when (x, z) belongs to area `i` and is not on a seam. */
export function inZone(i: number, x: number, z: number): boolean {
  return (
    zoneIndex(x, z) === i &&
    zoneIndex(x + SEAM, z) === i &&
    zoneIndex(x - SEAM, z) === i &&
    zoneIndex(x, z + SEAM) === i &&
    zoneIndex(x, z - SEAM) === i
  );
}

/** Soft rounded-rectangle coastline (superellipse) with a few gentle bays. */
function coastline(rng: RNG): FieldShape {
  const pts: number[] = [];
  const n = 240;
  const rx = HALF_X + 0.8, rz = HALF_Z + 0.8;
  const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28), p3 = rng.range(0, 6.28);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const sq = 1 / Math.pow(Math.pow(Math.abs(c) / rx, 4) + Math.pow(Math.abs(s) / rz, 4), 0.25);
    const r = sq * (1 + 0.03 * Math.sin(5 * a + p1) + 0.02 * Math.sin(9 * a + p2) + 0.012 * Math.sin(14 * a + p3));
    pts.push(c * r, s * r);
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  return attachSdf({ kind: 'blob', pts: new Float32Array(pts), minX, maxX, minZ, maxZ, holes: [] });
}

export function makeWorldMap(): WorldMap {
  const land = coastline(new RNG(2024));
  const zones: ZoneSpec[] = WORLDS.map((world, index) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    GRID.forEach((row, r) =>
      row.forEach((w, c) => {
        if (w !== world) return;
        const x0 = c * CELL - HALF_X, z0 = r * CELL - HALF_Z;
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x0 + CELL);
        minZ = Math.min(minZ, z0);
        maxZ = Math.max(maxZ, z0 + CELL);
      }),
    );
    return {
      index,
      world,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      minX: Math.max(land.minX, minX - WARP),
      maxX: Math.min(land.maxX, maxX + WARP),
      minZ: Math.max(land.minZ, minZ - WARP),
      maxZ: Math.min(land.maxZ, maxZ + WARP),
      seed: 1000 + index * 77,
    };
  });
  return { land, zones, hub: WORLDS.indexOf('bubble') };
}
