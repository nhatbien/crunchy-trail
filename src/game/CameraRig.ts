import * as THREE from 'three';
import { damp } from '../core/rng';

export type CamMode = 'orbit' | 'follow' | 'overview' | 'closeup';

export interface FieldBounds {
  cx: number;
  cz: number;
  radius: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Smooth, aspect-aware camera: works from 9:16 phones to 32:9 desktop windows. */
export class CameraRig {
  mode: CamMode = 'orbit';
  readonly look = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private tLook = new THREE.Vector3();
  private tPos = new THREE.Vector3();
  private orbit = 0.4;
  private shakeAmt = 0;
  private stiffness = 4;

  constructor(private cam: THREE.PerspectiveCamera) {}

  setMode(mode: CamMode, stiffness = 2.6): void {
    this.mode = mode;
    this.stiffness = stiffness;
  }

  shake(a: number): void {
    this.shakeAmt = Math.min(0.25, this.shakeAmt + a);
  }

  /**
   * Distance needed to fit a sphere of `r` in view, taking aspect into account.
   * Capped so tall phone screens crop the sides instead of backing off into the fog.
   */
  private fitDistance(r: number, cap = Infinity): number {
    const vfov = THREE.MathUtils.degToRad(this.cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.cam.aspect);
    return Math.min(r / Math.sin(Math.min(vfov, hfov) / 2), cap);
  }

  update(dt: number, time: number, hero: THREE.Vector3, heroVel: THREE.Vector2, b: FieldBounds, snap = false): void {
    const aspect = this.cam.aspect;
    switch (this.mode) {
      case 'follow': {
        // Portrait screens see less sideways, so pull back a bit more.
        const d = this.fitDistance(aspect < 1 ? 2.45 : 2.9) * 1.05;
        const lx = hero.x + heroVel.x * 0.18;
        const lz = hero.z + heroVel.y * 0.18;
        this.tLook.set(lx, 0, lz - 0.2);
        this.tPos.set(lx, d * 0.76, lz - 0.2 + d * 0.65);
        break;
      }
      case 'overview': {
        const d = this.fitDistance(b.radius * 1.02, b.radius * 2.6);
        this.tLook.set(b.cx, -0.3, b.cz);
        this.tPos.set(b.cx, d * 0.84, b.cz + d * 0.54);
        break;
      }
      case 'orbit': {
        this.orbit += dt * 0.07;
        const d = this.fitDistance(b.radius * 1.05, b.radius * 2.5);
        const a = Math.sin(this.orbit) * 0.5;
        this.tLook.set(b.cx, -0.2, b.cz + (aspect < 1 ? 0.6 : 0.3));
        this.tPos.set(b.cx + Math.sin(a) * d * 0.6, d * 0.68, b.cz + Math.cos(a) * d * 0.6 + 0.6);
        break;
      }
      case 'closeup': {
        // Portrait: the shop sheet covers the lower half, so frame the hero high.
        const portrait = aspect < 1;
        const d = portrait ? 5.6 : 3.4;
        this.tLook.set(hero.x, portrait ? -0.75 : 0.45, hero.z);
        this.tPos.set(hero.x + Math.sin(time * 0.3) * 0.4, portrait ? 1.7 : 1.4, hero.z + d);
        break;
      }
    }
    if (snap) {
      this.pos.copy(this.tPos);
      this.look.copy(this.tLook);
    } else {
      const k = damp(this.stiffness, dt);
      this.pos.lerp(this.tPos, k);
      this.look.lerp(this.tLook, k);
    }
    this.cam.position.copy(this.pos);
    if (this.shakeAmt > 0.001) {
      this.cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.cam.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 10);
    }
    this.cam.lookAt(this.look);
  }
}
