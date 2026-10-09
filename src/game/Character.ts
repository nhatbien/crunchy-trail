import * as THREE from 'three';
import type { HatDef, SkinDef } from '../core/catalog';
import { damp } from '../core/rng';

const R = 0.42;
const MAX_SPEED = 3.3;

const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(70,30,90,0.42)');
  grd.addColorStop(0.55, 'rgba(70,30,90,0.22)');
  grd.addColorStop(1, 'rgba(70,30,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** "Mochi" – the squishy hero. Pure procedural geometry, no model files. */
export class Character {
  readonly root = new THREE.Group();
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  yaw = 0;
  /** Vertical offset (drop-in / hops). */
  y = 0;
  happy = false;
  /** Set for one frame whenever a foot touches the ground while walking. */
  stepped = false;

  private lean = new THREE.Group();
  private body: THREE.Mesh;
  private bodyMat: THREE.MeshPhysicalMaterial;
  private footMat: THREE.MeshPhysicalMaterial;
  private eyes: THREE.Group[] = [];
  private happyEyes: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  private hat = new THREE.Group();
  private blob: THREE.Mesh;
  private targetYaw = 0;
  private phase = 0;
  private squash = 0;
  private squashV = 0;
  private vy = 0;
  private blink = 2.5;
  private stepIndex = 0;
  private onLand: (() => void) | null = null;

  constructor() {
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff4e8,
      roughness: 0.5,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: 0xffffff,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    });
    this.footMat = this.bodyMat.clone();
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), this.bodyMat);
    this.body.castShadow = true;
    this.root.add(this.lean);
    this.lean.add(this.body);

    // Eyes: glossy beads with highlights.
    const eyeGeo = new THREE.SphereGeometry(0.052, 20, 14);
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x1d1a22, roughness: 0.15, clearcoat: 1 });
    const hiGeo = new THREE.SphereGeometry(0.016, 10, 8);
    const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const arcGeo = new THREE.TorusGeometry(0.045, 0.012, 8, 18, Math.PI);
    for (const s of [-1, 1]) {
      const n = dir(s * 0.34, 0.22, 0.92);
      const eye = new THREE.Group();
      eye.position.copy(n).multiplyScalar(R * 0.985);
      eye.lookAt(n.clone().multiplyScalar(2));
      const ball = new THREE.Mesh(eyeGeo, eyeMat);
      ball.scale.set(1, 1.18, 0.55);
      const hi = new THREE.Mesh(hiGeo, hiMat);
      hi.position.set(0.016 * s, 0.022, 0.03);
      eye.add(ball, hi);
      this.body.add(eye);
      this.eyes.push(eye);

      const arc = new THREE.Mesh(arcGeo, eyeMat);
      arc.position.copy(eye.position);
      arc.quaternion.copy(eye.quaternion);
      arc.visible = false;
      this.body.add(arc);
      this.happyEyes.push(arc);

      const blush = new THREE.Mesh(
        new THREE.CircleGeometry(0.058, 24),
        new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      const bn = dir(s * 0.6, 0.02, 0.8);
      blush.position.copy(bn).multiplyScalar(R * 1.004);
      blush.lookAt(bn.clone().multiplyScalar(2));
      blush.scale.set(1.25, 0.8, 1);
      this.body.add(blush);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), eyeMat);
    const mn = dir(0, 0.02, 1);
    mouth.position.copy(mn).multiplyScalar(R * 1.0);
    mouth.lookAt(mn.clone().multiplyScalar(2));
    mouth.rotateZ(Math.PI);
    this.body.add(mouth);

    const footGeo = new THREE.SphereGeometry(0.11, 18, 12);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, this.footMat);
      f.scale.set(1, 0.55, 1.35);
      f.position.set(s * 0.17, 0.04, 0.1);
      f.castShadow = true;
      this.lean.add(f);
      this.feet.push(f);
    }
    this.body.add(this.hat);

    // Soft contact shadow keeps the hero grounded on every surface.
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    this.blob.position.y = 0.025;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
  }

  setSkin(skin: SkinDef): void {
    const c = new THREE.Color(skin.color);
    for (const m of [this.bodyMat, this.footMat]) {
      m.color.copy(c);
      m.iridescence = skin.pearl ? 1 : 0;
      m.iridescenceIOR = 1.3;
      m.iridescenceThicknessRange = [120, 420];
      m.emissive.copy(c).multiplyScalar(0.06);
    }
    this.footMat.color.multiplyScalar(0.92);
  }

  setHat(hat: HatDef['id']): void {
    this.hat.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.hat.clear();
    const add = (geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], opts: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts }));
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.castShadow = true;
      this.hat.add(m);
      return m;
    };
    switch (hat) {
      case 'sprout': {
        add(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 8), 0x67c23a, [0, R + 0.06, 0]);
        for (const s of [-1, 1]) {
          const leaf = add(new THREE.SphereGeometry(0.065, 16, 10), 0x86dc5a, [s * 0.055, R + 0.13, 0], [0, 0, s * -0.5]);
          leaf.scale.set(1, 0.28, 0.6);
        }
        break;
      }
      case 'headphones': {
        add(new THREE.TorusGeometry(R + 0.035, 0.028, 10, 32, Math.PI), 0xffffff, [0, 0.04, 0], [0, 0, 0], { roughness: 0.35 });
        for (const s of [-1, 1]) {
          add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), 0xff9ec0, [s * (R + 0.02), 0.04, 0], [0, 0, Math.PI / 2], { roughness: 0.4 });
          add(new THREE.CylinderGeometry(0.075, 0.075, 0.085, 20), 0xffe3ee, [s * (R + 0.035), 0.04, 0], [0, 0, Math.PI / 2]);
        }
        break;
      }
      case 'beanie': {
        add(new THREE.SphereGeometry(R * 1.05, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.4), 0xff8a8a, [0, 0, 0], [0, 0, 0], { roughness: 0.85 });
        add(new THREE.TorusGeometry(R * 0.97, 0.05, 10, 36), 0xfff1ea, [0, R * 0.31, 0], [Math.PI / 2, 0, 0], { roughness: 0.9 });
        add(new THREE.SphereGeometry(0.08, 16, 12), 0xfff1ea, [0, R * 1.06 + 0.04, 0], [0, 0, 0], { roughness: 1 });
        break;
      }
      case 'flower': {
        const g = new THREE.Group();
        g.position.set(0.2, R * 0.86, 0.1);
        g.rotation.set(0.3, 0, -0.5);
        this.hat.add(g);
        const petal = new THREE.SphereGeometry(0.05, 14, 10);
        const pm = new THREE.MeshStandardMaterial({ color: 0xffb3d1, roughness: 0.5 });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          const p = new THREE.Mesh(petal, pm);
          p.position.set(Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055);
          p.scale.set(1, 0.35, 0.75);
          p.rotation.y = -a;
          g.add(p);
        }
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffd84d, roughness: 0.6 }));
        c.position.y = 0.012;
        g.add(c);
        break;
      }
      case 'bow': {
        const g = new THREE.Group();
        g.position.set(0.16, R * 0.92, 0.04);
        g.rotation.set(0, 0, -0.35);
        this.hat.add(g);
        const m = new THREE.MeshStandardMaterial({ color: 0xff6f9f, roughness: 0.45 });
        for (const s of [-1, 1]) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.13, 16), m);
          c.rotation.z = (s * Math.PI) / 2;
          c.position.x = s * 0.065;
          c.scale.set(1, 1, 0.55);
          g.add(c);
        }
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), m));
        break;
      }
      case 'crown': {
        const gold = { metalness: 0.85, roughness: 0.25 };
        add(new THREE.CylinderGeometry(0.15, 0.17, 0.09, 24, 1, true), 0xffd35a, [0, R * 0.98, 0], [0, 0, 0], { ...gold, side: THREE.DoubleSide });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          add(new THREE.ConeGeometry(0.035, 0.08, 8), 0xffd35a, [Math.cos(a) * 0.15, R * 0.98 + 0.08, Math.sin(a) * 0.15], [0, 0, 0], gold);
          add(new THREE.SphereGeometry(0.018, 8, 6), [0xff6f91, 0x6fc3ff, 0x9be564][k % 3], [Math.cos(a) * 0.162, R * 0.98, Math.sin(a) * 0.162], [0, 0, 0], { roughness: 0.1 });
        }
        break;
      }
      default:
        break;
    }
  }

  place(x: number, z: number, yaw = 0): void {
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.yaw = this.targetYaw = yaw;
    this.root.position.set(x, this.y, z);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Steers with the joystick (ix, iz unit vector, mag 0..1) and slides along walls. */
  move(dt: number, ix: number, iz: number, mag: number, canStand: (x: number, z: number) => boolean): void {
    const k = damp(mag > 0.01 ? 11 : 9, dt);
    this.vx += (ix * mag * MAX_SPEED - this.vx) * k;
    this.vz += (iz * mag * MAX_SPEED - this.vz) * k;
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    if (canStand(nx, nz)) {
      this.x = nx;
      this.z = nz;
    } else if (canStand(nx, this.z)) {
      this.x = nx;
      this.vz *= 0.5;
    } else if (canStand(this.x, nz)) {
      this.z = nz;
      this.vx *= 0.5;
    } else {
      this.vx = this.vz = 0;
    }
    if (this.speed > 0.25) this.targetYaw = Math.atan2(this.vx, this.vz);
  }

  stop(): void {
    this.vx = this.vz = 0;
  }

  faceYaw(yaw: number): void {
    this.targetYaw = yaw;
  }

  /** Jelly squish (positive = squash down). */
  squish(amount: number): void {
    this.squashV += amount * 9;
  }

  dropIn(height: number, onLand?: () => void): void {
    this.y = height;
    this.vy = 0;
    this.onLand = onLand ?? null;
  }

  hop(power = 4.5): void {
    if (this.y <= 0.001) this.vy = power;
  }

  update(dt: number, time: number): void {
    // Vertical motion (drop-in / hops).
    if (this.y > 0 || this.vy > 0) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        const impact = Math.min(0.45, -this.vy * 0.045);
        this.vy = 0;
        this.squish(impact);
        this.onLand?.();
        this.onLand = null;
      }
    }

    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * damp(14, dt);

    const sp = Math.min(1, this.speed / MAX_SPEED);
    this.phase += dt * (4 + this.speed * 5.5);
    const step = Math.floor(this.phase / Math.PI);
    this.stepped = step !== this.stepIndex && sp > 0.25 && this.y <= 0;
    this.stepIndex = step;

    // Spring-damper squash for that jelly feel.
    this.squashV += (-230 * this.squash - 13 * this.squashV) * dt;
    this.squash += this.squashV * dt;

    const walkBob = Math.abs(Math.sin(this.phase)) * 0.055 * sp;
    const breathe = Math.sin(time * 2.4) * 0.018 * (1 - sp);
    const s = this.squash - walkBob * 0.6 + breathe;
    const sy = 0.88 * (1 - s);
    const sxz = 1 + s * 0.55;
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = R * sy + walkBob * 0.6;

    this.lean.rotation.x = sp * 0.2;
    const lift = Math.min(1, this.y * 0.25);
    this.blob.position.y = 0.025 - this.y;
    this.blob.scale.setScalar(1 - lift * 0.45);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 1 - lift * 0.6;
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;

    for (let k = 0; k < 2; k++) {
      const ph = this.phase + k * Math.PI;
      const f = this.feet[k];
      f.position.y = 0.04 + Math.max(0, Math.sin(ph)) * 0.07 * sp;
      f.position.z = 0.1 + Math.cos(ph) * 0.09 * sp;
    }

    this.blink -= dt;
    const closing = this.blink < 0.12;
    if (this.blink < 0) this.blink = 2 + Math.random() * 3.5;
    for (const e of this.eyes) {
      e.visible = !this.happy;
      e.scale.y = closing ? 0.12 : 1;
    }
    for (const a of this.happyEyes) a.visible = this.happy;
  }
}
