import { RNG } from '../core/rng';
import type { FieldShape } from './shapes';

/**
 * Paints the landmass ground: every area gets its own base color (lawn under the
 * leaves, wood tray under the sand…) softly blended across the seams.
 * Canvas row 0 is the land's minZ edge, column 0 its minX edge.
 */
export function paintGround(land: FieldShape, colorAt: (x: number, z: number) => number, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const W = land.maxX - land.minX, H = land.maxZ - land.minZ;
  const rng = new RNG(5);
  const o = 0.45;
  const taps = [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o], [o, o], [-o, -o], [o, -o], [-o, o]];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = land.minX + ((px + 0.5) / size) * W;
      const z = land.minZ + ((py + 0.5) / size) * H;
      let r = 0, gg = 0, b = 0;
      for (const [dx, dz] of taps) {
        const col = colorAt(x + dx, z + dz);
        r += (col >> 16) & 255;
        gg += (col >> 8) & 255;
        b += col & 255;
      }
      const n = 1 + (rng.next() - 0.5) * 0.06;
      const k = (py * size + px) * 4;
      img.data[k] = Math.min(255, (r / taps.length) * n);
      img.data[k + 1] = Math.min(255, (gg / taps.length) * n);
      img.data[k + 2] = Math.min(255, (b / taps.length) * n);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
