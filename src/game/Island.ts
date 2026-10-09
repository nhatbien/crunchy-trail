import * as THREE from 'three';
import type { RNG } from '../core/rng';
import type { FieldShape } from './shapes';
import type { PropKind } from './themes';

function outline(shape: FieldShape, scale: number): THREE.Shape {
  const s = new THREE.Shape();
  const p = shape.pts;
  // Shape space (x, y) maps to world (x, -z) after rotateX(-PI/2).
  s.moveTo(p[0] * scale, -p[1] * scale);
  for (let i = 2; i < p.length; i += 2) s.lineTo(p[i] * scale, -p[i + 1] * scale);
  s.closePath();
  return s;
}

function slab(shape: FieldShape, scale: number, depth: number, bevel: number, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(outline(shape, scale), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -(depth + bevel), 0);
  return new THREE.Mesh(geo, mat);
}

/**
 * The one big floating landmass: a painted top layer (each area has its own
 * ground color) on top of soft pastel cake layers.
 */
export function buildLand(shape: FieldShape, ground: THREE.CanvasTexture): THREE.Group {
  const W = shape.maxX - shape.minX, H = shape.maxZ - shape.minZ;
  // Extrude cap UVs are (x, -z) in world units: map them onto the painted canvas.
  ground.colorSpace = THREE.SRGBColorSpace;
  ground.anisotropy = 4;
  ground.repeat.set(1 / W, 1 / H);
  ground.offset.set(-shape.minX / W, 1 + shape.minZ / H);
  const side = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const g = new THREE.Group();
  const top = slab(shape, 1, 0.3, 0.12, [new THREE.MeshStandardMaterial({ map: ground, roughness: 0.92 }), side(0xf6dccb)]);
  top.receiveShadow = true;
  const mid = slab(shape, 0.99, 1.2, 0.16, side(0xeec3b3));
  mid.position.y = -0.42;
  const deep = slab(shape, 0.93, 0.9, 0.22, side(0xdba79c));
  deep.position.y = -1.78;
  g.add(top, mid, deep);
  return g;
}

const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Cute obstacle that matches the world (a hole in the field the hero walks around). */
export function buildProp(kind: PropKind, r: number, rng: RNG): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'mushroom': {
      g.add(mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.42, r * 0.9, 16), mat(0xfff3e0), 0, r * 0.45, 0));
      const cap = mesh(new THREE.SphereGeometry(r * 0.95, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff6b6b, { roughness: 0.4 }), 0, r * 0.8, 0);
      cap.scale.y = 0.75;
      g.add(cap);
      for (let k = 0; k < 6; k++) {
        const a = rng.range(0, 6.28), e = rng.range(0.35, 1.1);
        const d = new THREE.Vector3(Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e));
        const dot = mesh(new THREE.SphereGeometry(r * 0.12, 10, 8), mat(0xffffff), d.x * r * 0.95, r * 0.8 + d.y * r * 0.71, d.z * r * 0.95);
        dot.scale.y = 0.5;
        dot.lookAt(dot.position.clone().add(d));
        g.add(dot);
      }
      break;
    }
    case 'snowman': {
      const snow = mat(0xffffff, { roughness: 0.9 });
      g.add(mesh(new THREE.SphereGeometry(r * 0.75, 24, 16), snow, 0, r * 0.62, 0));
      g.add(mesh(new THREE.SphereGeometry(r * 0.52, 24, 16), snow, 0, r * 1.5, 0));
      const nose = mesh(new THREE.ConeGeometry(r * 0.08, r * 0.38, 10), mat(0xff8a3d), 0, r * 1.52, r * 0.6);
      nose.rotation.x = Math.PI / 2;
      g.add(nose);
      for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(r * 0.06, 8, 6), mat(0x222222), s * r * 0.18, r * 1.66, r * 0.46));
      const scarf = mesh(new THREE.TorusGeometry(r * 0.5, r * 0.1, 8, 24), mat(0xff7aa2, { roughness: 0.8 }), 0, r * 1.15, 0);
      scarf.rotation.x = Math.PI / 2;
      g.add(scarf);
      break;
    }
    case 'pumpkin': {
      const geo = new THREE.SphereGeometry(r * 0.8, 32, 20);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 4)), 3);
        p.setXYZ(i, x * k, p.getY(i) * 0.78, z * k);
      }
      geo.computeVertexNormals();
      g.add(mesh(geo, mat(0xff9a3c, { roughness: 0.55 }), 0, r * 0.62, 0));
      const stem = mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.1, r * 0.3, 8), mat(0x6b8e3a), 0, r * 1.3, 0);
      stem.rotation.z = 0.25;
      g.add(stem);
      break;
    }
    case 'castle': {
      const sand = mat(0xf2cf95, { roughness: 1 });
      g.add(mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.85, r * 0.7, 20), sand, 0, r * 0.35, 0));
      g.add(mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.5, r * 0.6, 16), sand, 0, r * 1.0, 0));
      g.add(mesh(new THREE.ConeGeometry(r * 0.5, r * 0.5, 16), sand, 0, r * 1.55, 0));
      const flag = mesh(new THREE.PlaneGeometry(r * 0.3, r * 0.2), mat(0xff6f91, { side: THREE.DoubleSide }), r * 0.15, r * 2.0, 0);
      g.add(flag);
      g.add(mesh(new THREE.CylinderGeometry(r * 0.015, r * 0.015, r * 0.5, 6), mat(0x8b6b4a), 0, r * 1.85, 0));
      break;
    }
    case 'candy': {
      g.add(mesh(new THREE.CylinderGeometry(r * 0.06, r * 0.06, r * 1.4, 8), mat(0xffffff), 0, r * 0.7, 0));
      const pop = mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, r * 0.22, 32), mat(0xff8ec2, { roughness: 0.25 }), 0, r * 1.55, 0);
      pop.rotation.x = Math.PI / 2;
      g.add(pop);
      const swirl = mesh(new THREE.TorusGeometry(r * 0.42, r * 0.08, 8, 32), mat(0xffffff, { roughness: 0.25 }), 0, r * 1.55, r * 0.11);
      g.add(swirl);
      break;
    }
    case 'block': {
      const colors = [0xff8fab, 0x8fd3ff, 0xffd166, 0x9be564];
      const b1 = mesh(new THREE.BoxGeometry(r * 1.1, r * 1.1, r * 1.1), mat(rng.pick(colors), { roughness: 0.35 }), 0, r * 0.55, 0);
      b1.rotation.y = rng.range(0, 1.5);
      g.add(b1);
      const b2 = mesh(new THREE.BoxGeometry(r * 0.7, r * 0.7, r * 0.7), mat(rng.pick(colors), { roughness: 0.35 }), r * 0.1, r * 1.45, 0);
      b2.rotation.y = rng.range(0, 1.5);
      g.add(b2);
      break;
    }
    case 'rock':
    default: {
      const geo = new THREE.IcosahedronGeometry(r * 0.85, 2);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        const n = 1 + 0.08 * Math.sin(v.x * 9) * Math.cos(v.z * 7);
        p.setXYZ(i, v.x * n, v.y * n * 0.7, v.z * n);
      }
      geo.computeVertexNormals();
      g.add(mesh(geo, mat(0xc9bfe8, { roughness: 0.8 }), 0, r * 0.45, 0));
      g.add(mesh(new THREE.SphereGeometry(r * 0.3, 16, 12), mat(0xd9d0f2, { roughness: 0.8 }), r * 0.7, r * 0.15, r * 0.3));
    }
  }
  return g;
}

/** Collectible gems: spin, bob and sparkle. */
export class Gems {
  readonly mesh: THREE.InstancedMesh;
  readonly x: number[] = [];
  readonly z: number[] = [];
  readonly alive: boolean[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(points: [number, number][]) {
    const geo = (cachedGemGeo ??= new THREE.OctahedronGeometry(0.17, 0).scale(1, 1.3, 1));
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1,
      iridescence: 1,
      iridescenceIOR: 1.6,
      emissive: 0xff5c9a,
      emissiveIntensity: 0.25,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, m, Math.max(1, points.length));
    this.mesh.count = points.length;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    const colors = [0xff8fb8, 0x8fd8ff, 0xffe17a, 0xa6f0c6, 0xc9a8ff];
    points.forEach(([x, z], i) => {
      this.x.push(x);
      this.z.push(z);
      this.alive.push(true);
      this.mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    });
  }

  /** Brings a collected gem back somewhere else. */
  respawn(i: number, x: number, z: number): void {
    this.x[i] = x;
    this.z[i] = z;
    this.alive[i] = true;
  }

  /** Animates gems and returns indices collected by the hero this frame. */
  update(time: number, cx: number, cz: number, collect: boolean): number[] {
    const got: number[] = [];
    for (let i = 0; i < this.x.length; i++) {
      if (!this.alive[i]) continue;
      if (collect && (this.x[i] - cx) ** 2 + (this.z[i] - cz) ** 2 < 0.5 * 0.5) {
        this.alive[i] = false;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        got.push(i);
        continue;
      }
      this.q.setFromEuler(this.e.set(0, time * 2 + i, 0));
      this.v.set(this.x[i], 0.55 + Math.sin(time * 2.5 + i * 1.7) * 0.08, this.z[i]);
      this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.set(1, 1, 1)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return got;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

let cachedGemGeo: THREE.BufferGeometry | undefined;
