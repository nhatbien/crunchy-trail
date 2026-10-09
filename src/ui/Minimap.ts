export interface MapData {
  /** Coastline polygon [x0, z0, x1, z1, …]. */
  coast: Float32Array;
  /** Painted ground covering [minX, maxX] × [minZ, maxZ]. */
  ground: HTMLCanvasElement;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GemDots {
  x: number[];
  z: number[];
  alive: boolean[];
}

const SIZE = 104;
const PAD = 6;

/** Tiny map of the archipelago: islands, bridges, gems and the hero. */
export class Minimap {
  readonly el = document.createElement('canvas');
  private bg = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(data: MapData) {
    this.el.className = 'minimap';
    for (const c of [this.el, this.bg]) {
      c.width = c.height = Math.round(SIZE * this.dpr);
    }
    this.ctx = this.el.getContext('2d')!;
    const { minX, maxX, minZ, maxZ } = data;
    this.scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.ox = PAD - minX * this.scale + ((SIZE - PAD * 2) - (maxX - minX) * this.scale) / 2;
    this.oz = PAD - minZ * this.scale + ((SIZE - PAD * 2) - (maxZ - minZ) * this.scale) / 2;

    const g = this.bg.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.beginPath();
    for (let i = 0; i < data.coast.length; i += 2) {
      const [u, v] = this.map(data.coast[i], data.coast[i + 1]);
      if (i === 0) g.moveTo(u, v);
      else g.lineTo(u, v);
    }
    g.closePath();
    g.save();
    g.clip();
    const [u0, v0] = this.map(minX, minZ);
    const [u1, v1] = this.map(maxX, maxZ);
    g.drawImage(data.ground, u0, v0, u1 - u0, v1 - v0);
    g.restore();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.stroke();
  }

  private map(x: number, z: number): [number, number] {
    return [this.ox + x * this.scale, this.oz + z * this.scale];
  }

  draw(hx: number, hz: number, yaw: number, gems: GemDots): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.el.width, this.el.height);
    c.drawImage(this.bg, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#ff5c9a';
    for (let i = 0; i < gems.x.length; i++) {
      if (!gems.alive[i]) continue;
      const [u, v] = this.map(gems.x[i], gems.z[i]);
      c.beginPath();
      c.arc(u, v, 1.7, 0, Math.PI * 2);
      c.fill();
    }
    const [u, v] = this.map(hx, hz);
    c.save();
    c.translate(u, v);
    c.rotate(-yaw);
    c.fillStyle = 'rgba(255, 92, 154, 0.25)';
    c.beginPath();
    c.arc(0, 0, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ff4f8f';
    c.lineWidth = 2.2;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0, 7.5);
    c.lineTo(5, -4);
    c.lineTo(0, -1.8);
    c.lineTo(-5, -4);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
  }
}
