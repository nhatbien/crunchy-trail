import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, RNG } from '../core/rng';
import type { Theme } from './themes';

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
varying vec3 vWorld;
void main() {
  float h = normalize(vWorld - cameraPosition).y;
  float t = smoothstep(-1.0, 0.55, h);
  vec3 c = mix(bottom, top, t);
  // soft glow near the horizon
  c += (1.0 - abs(h)) * 0.04;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Renderer, sky, lights and the dreamy backdrop. Gameplay objects live in `stage`. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 110);
  readonly stage = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private backdrop = new THREE.Group();
  private fog: THREE.Fog;
  private target = {
    top: new THREE.Color(),
    bottom: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sun: new THREE.Color(),
  };
  private dprCap: number;
  private slowFrames = 0;
  width = 1;
  height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.dprCap = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.dprCap < 2, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(this.dprCap);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.fog = new THREE.Fog(0xffffff, 30, 85);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    const big = Math.min(screen.width, screen.height) * this.dprCap > 900;
    this.sun.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    sc.near = 1;
    sc.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.buildBackdrop();
    this.scene.add(this.backdrop, this.stage);
    this.resize();
  }

  private buildBackdrop(): void {
    const rng = new RNG(42);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35 });
    for (let c = 0; c < 22; c++) {
      const puffs: THREE.BufferGeometry[] = [];
      const n = rng.int(4, 7);
      for (let k = 0; k < n; k++) {
        const r = rng.range(0.6, 1.2);
        puffs.push(new THREE.IcosahedronGeometry(r, 2).translate((k - n / 2) * 0.75 + rng.range(-0.2, 0.2), rng.range(-0.1, 0.4) * r, rng.range(-0.4, 0.4)));
      }
      const cloud = new THREE.Mesh(mergeGeometries(puffs)!, cloudMat);
      const a = (c / 22) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const d = rng.range(22, 42);
      cloud.position.set(Math.cos(a) * d, rng.range(-12, -2.5), Math.sin(a) * d);
      cloud.scale.setScalar(rng.range(1.8, 3.4));
      cloud.scale.y *= 0.7;
      cloud.lookAt(0, cloud.position.y, 0);
      this.backdrop.add(cloud);
    }
    // A few tiny floating islands far away for depth.
    const isleTop = new THREE.MeshStandardMaterial({ color: 0xbfe8a8, roughness: 0.9 });
    const isleRock = new THREE.MeshStandardMaterial({ color: 0xd9c2a8, roughness: 0.9 });
    for (let k = 0; k < 8; k++) {
      const g = new THREE.Group();
      const r = rng.range(1.4, 2.8);
      const topM = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, r * 0.35, 18), isleTop);
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * 1.6, 18), isleRock);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -r * 0.95;
      g.add(topM, bottom);
      const tree = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 12, 10), new THREE.MeshStandardMaterial({ color: 0x8fd16b, roughness: 0.8 }));
      tree.position.set(r * 0.3, r * 0.45, 0);
      g.add(tree);
      const a = (k / 8) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = rng.range(25, 38);
      g.position.set(Math.cos(a) * d, rng.range(-8, 1), Math.sin(a) * d);
      g.userData.bob = rng.range(0, 6);
      this.backdrop.add(g);
    }
  }

  setTheme(t: Theme, instant = false): void {
    this.target.top.set(t.skyTop);
    this.target.bottom.set(t.skyBottom);
    this.target.hemiSky.set(t.hemiSky);
    this.target.hemiGround.set(t.hemiGround);
    this.target.sun.set(t.sun);
    if (instant) this.blendTheme(1);
  }

  private blendTheme(k: number): void {
    const u = this.skyMat.uniforms;
    (u.top.value as THREE.Color).lerp(this.target.top, k);
    (u.bottom.value as THREE.Color).lerp(this.target.bottom, k);
    this.fog.color.copy(u.bottom.value as THREE.Color);
    this.hemi.color.lerp(this.target.hemiSky, k);
    this.hemi.groundColor.lerp(this.target.hemiGround, k);
    this.sun.color.lerp(this.target.sun, k);
  }

  /** Keeps the sun (and its shadow frustum) centred on what the camera is looking at. */
  update(dt: number, time: number, focus: THREE.Vector3): void {
    this.blendTheme(damp(2.5, dt));
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(focus.x - 5, 11, focus.z + 2.5);
    this.sun.target.position.copy(focus);
    this.backdrop.rotation.y = time * 0.006;
    for (const c of this.backdrop.children) {
      if (c.userData.bob !== undefined) c.position.y += Math.sin(time * 0.6 + c.userData.bob) * 0.002;
    }
  }

  /** Shadow frustum size in world units (bigger for overview shots). */
  setShadowSpan(span: number): void {
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -span;
    sc.right = sc.top = span;
    sc.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Simple dynamic resolution: drop pixel ratio if frames are consistently slow. */
  watchPerformance(dt: number): void {
    if (dt > 1 / 40) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 0.5);
    if (this.slowFrames > 90 && this.renderer.getPixelRatio() > 1) {
      this.slowFrames = 0;
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() - 0.25));
      this.resize();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
