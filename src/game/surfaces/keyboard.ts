import * as THREE from 'three';
import { easeOutCubic } from '../../core/rng';
import { cached, Surface, tmpColor, type Batch, type HitEvent } from './Surface';

const CAPS = [0xa98bff, 0x6fb4ff, 0xff9a5c, 0xff86c2, 0x7fe0d0, 0xffd36b, 0xb4f08a].map((c) => new THREE.Color(c));
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PRESS = 0.075;

/** 6 × 6 atlas of keycap legends on white (white = plain keycap color). */
function legendAtlas(): THREE.CanvasTexture {
  const size = 512, n = 6, cell = size / n;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#2e2838';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(cell * 0.46)}px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Baloo 2", system-ui, sans-serif`;
  [...GLYPHS].forEach((ch, i) => {
    const col = i % n, row = Math.floor(i / n);
    g.fillText(ch, col * cell + cell / 2, row * cell + cell / 2 + cell * 0.03);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A sculpted keycap: wide base, smaller top, flat-topped – ten triangles. */
function keycapGeometry(): THREE.BufferGeometry {
  const b = 0.175, t = 0.13, h = 0.17, back = -0.012;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (a: number[], bb: number[], cc: number[], d: number[], uvs: number[][]) => {
    const v = pos.length / 3;
    pos.push(...a, ...bb, ...cc, ...d);
    for (const u of uvs) uv.push(...u);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  const corner = [0.03, 0.03];
  const side = [corner, corner, corner, corner];
  // top face carries the legend (v grows away from the camera so letters read upright)
  quad([-t, h, -t + back], [-t, h, t + back], [t, h, t + back], [t, h, -t + back], [[0.16, 0.84], [0.16, 0.16], [0.84, 0.16], [0.84, 0.84]]);
  quad([-b, 0, b], [b, 0, b], [t, h, t + back], [-t, h, t + back], side); // front
  quad([b, 0, -b], [-b, 0, -b], [-t, h, -t + back], [t, h, -t + back], side); // back
  quad([-b, 0, -b], [-b, 0, b], [-t, h, t + back], [-t, h, -t + back], side); // left
  quad([b, 0, b], [b, 0, -b], [t, h, -t + back], [t, h, t + back], side); // right
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Faces don't share vertices, so this gives crisp per-face normals.
  g.computeVertexNormals();
  return g;
}

function keycapMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: legendAtlas(), roughness: 0.42, metalness: 0 });
  // Every key picks its own legend from its position, so no per-instance attribute is needed.
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #if defined( USE_MAP ) && defined( USE_INSTANCING )
        vec2 kp = floor(vec2(instanceMatrix[3][0], instanceMatrix[3][2]) * 2.5 + 0.5);
        float gi = floor(fract(sin(dot(kp, vec2(12.9898, 78.233))) * 43758.5453) * 36.0);
        vMapUv = (vMapUv + vec2(mod(gi, 6.0), floor(gi / 6.0))) / 6.0;
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'keycap';
  return m;
}

/** A giant creamy mechanical keyboard: keys sink with a "thock" and glow with RGB backlight. */
export class KeyboardSurface extends Surface {
  readonly id = 'keyboard' as const;
  readonly stepSound = 'keys';
  protected readonly spacing = 0.4;
  protected layout = 'keys' as const;
  protected inset = 0.22;
  private b!: Batch;

  protected create(): void {
    this.b = this.batch(cached('keyboard.geo', keycapGeometry), cached('keyboard.mat', keycapMaterial));
  }

  private cap(i: number): THREE.Color {
    // Rows of the same color like a themed keycap set, with a few accent keys.
    const accent = this.rnd[i] > 0.86;
    const k = accent ? Math.floor(this.rnd[i] * 97) % CAPS.length : (((this.row[i] >> 1) % CAPS.length) + CAPS.length) % CAPS.length;
    return CAPS[k];
  }

  protected resetLook(i: number): void {
    this.b.color(i, this.cap(i));
  }

  protected rest(i: number, sy: number, sxz: number): void {
    this.b.pose(i, this.px[i], (sy - 1) * 0.1, this.pz[i], 0, 0, 0, sxz, 1, sxz);
  }

  /** The key springs back up and its backlight fades. */
  protected regrow(i: number, k: number): void {
    this.b.pose(i, this.px[i], -PRESS * (1 - Math.min(1, k)), this.pz[i], 0, 0, 0, 1, 1, 1);
  }

  protected onHit(i: number): HitEvent {
    const x = this.px[i], z = this.pz[i];
    if (this.rnd[i] < 0.35) {
      this.ctx.fx.burst('spark', x, 0.22, z, 1, { color: tmpColor.copy(this.cap(i)).lerp(new THREE.Color(1, 1, 1), 0.4), speed: 0.4, up: 1.2, size: 0.2, life: 0.5, gravity: -0.4, drag: 2 });
    }
    return { x, z, sound: 'keys', rate: 0.9 + this.rnd[i] * 0.22, gain: 1, minGap: 0.028, stagger: 0.032 };
  }

  protected pose(i: number, age: number): boolean {
    const t = Math.min(1, age / 0.09);
    const dip = easeOutCubic(t);
    this.b.pose(i, this.px[i], -PRESS * dip, this.pz[i], 0, 0, 0, 1 - 0.04 * Math.sin(t * Math.PI), 1, 1 - 0.04 * Math.sin(t * Math.PI));
    if (t < 1) return false;
    // Backlight: colors above 1.0 read as light glowing through the keycap.
    this.b.color(i, tmpColor.copy(this.cap(i)).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(1.45));
    return true;
  }
}
