import * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { HATS, hatById, SKINS, skinById } from '../core/catalog';
import { fmt, t, type TextKey } from '../core/i18n';
import { clamp, RNG } from '../core/rng';
import type { SaveData, SaveStore } from '../core/save';
import type { Platform } from '../platform/platform';
import type { ToggleKey, UI, UIHandlers } from '../ui/UI';
import { CameraRig, type FieldBounds } from './CameraRig';
import { Character } from './Character';
import { Input } from './Input';
import { paintGround } from './ground';
import { buildLand, buildProp, Gems } from './Island';
import { Particles, type ParticleKind } from './Particles';
import { inField, type FieldShape, type Hole } from './shapes';
import { createSurface, type HitEvent, type Surface } from './surfaces';
import { THEMES, type Theme, type WorldId } from './themes';
import type { World } from './World';
import { CELL, inZone, makeWorldMap, zoneIndex, zoneWorld } from './worldmap';

/** Radius of the hero's "crunch brush". */
const BRUSH = 0.56;
/** When an area is this crunched, the rest goes in one satisfying cascade. */
const AUTO_FINISH = 0.985;
/** Every N crunches the player earns a few gems. */
const MILESTONE = 1000;
const GEMS_PER_ZONE = 2;
const GEM_RESPAWN = 45;
const PASTELS = [0xff8fb8, 0x8fd8ff, 0xffe17a, 0xa6f0c6, 0xc9a8ff, 0xffb38a];

/** Gentle ambient particles per area: snowfall, falling leaves, pollen, floating bubbles… */
interface Weather {
  kind: ParticleKind;
  /** Particles per second. */
  rate: number;
  colors: number[];
  size: number;
  /** Vertical speed (negative falls from above, positive drifts up from the ground). */
  vy: number;
  life: number;
  drift: number;
}

const WEATHER: Record<WorldId, Weather> = {
  snow: { kind: 'ball', rate: 34, colors: [0xdfeaff, 0xeef4ff, 0xd2e2fb], size: 0.065, vy: -0.7, life: 7, drift: 0.3 },
  ice: { kind: 'ball', rate: 20, colors: [0xffffff, 0xdff4ff], size: 0.05, vy: -0.6, life: 8, drift: 0.25 },
  leaves: { kind: 'flat', rate: 7, colors: [0xf2902f, 0xe5533d, 0xf7c548, 0xc96a2b], size: 0.13, vy: -0.65, life: 7, drift: 0.7 },
  grass: { kind: 'spark', rate: 7, colors: [0xfff3a0, 0xffffff, 0xd9ffb0], size: 0.13, vy: 0.12, life: 5, drift: 0.3 },
  bubble: { kind: 'ball', rate: 5, colors: [0xe3f4ff, 0xffffff], size: 0.07, vy: 0.35, life: 6, drift: 0.2 },
  kalimba: { kind: 'spark', rate: 9, colors: [0xffc2e2, 0xc9b6ff, 0xa8e6ff, 0xfff1a8], size: 0.17, vy: 0.3, life: 4, drift: 0.2 },
  jelly: { kind: 'spark', rate: 6, colors: [0xffd1e6, 0xfff1c2], size: 0.15, vy: 0.2, life: 4, drift: 0.2 },
  popit: { kind: 'spark', rate: 6, colors: [0xffc2d6, 0xc2f0ff, 0xfff0b3], size: 0.15, vy: 0.2, life: 4, drift: 0.2 },
  sand: { kind: 'spark', rate: 4, colors: [0xffe2b0, 0xffffff], size: 0.12, vy: 0.1, life: 5, drift: 0.4 },
  keyboard: { kind: 'spark', rate: 9, colors: [0xff7ad9, 0x7ad7ff, 0xb18cff, 0xffd56b], size: 0.16, vy: 0.3, life: 4, drift: 0.2 },
};

interface Zone {
  index: number;
  world: WorldId;
  theme: Theme;
  surface: Surface;
  root: THREE.Group;
  bounds: FieldBounds;
  /** Fully crunched (reset once it has grown back). */
  cleared: boolean;
}

interface Finale {
  zone: Zone;
  queue: number[];
  idx: number;
  acc: number;
  t: number;
}

type State = 'title' | 'shop' | 'playing';

/**
 * Relaxing open world: one big floating landmass made of nine ASMR areas that
 * flow straight into each other. No levels, no timer – just wander, crunch and
 * listen. Everything grows back.
 */
export class Game {
  private state: State = 'title';
  private menuPaused = false;
  private sysPaused = false;
  private zones: Zone[] = [];
  private land!: FieldShape;
  private hub!: Zone;
  private spawn: [number, number] = [0, 0];
  private lastZone: Zone | null = null;
  private gems!: Gems;
  private gemTimers: { i: number; at: number }[] = [];
  private finale: Finale | null = null;
  private hero = new Character();
  private fx: Particles;
  private rig: CameraRig;
  private input: Input;
  private ui: UI;
  private events: HitEvent[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private time = 0;
  private lastT = 0;
  private raf = 0;
  private lastHit = -1;
  private comboStart = -1;
  private tier = 0;
  private lastHaptic = 0;
  private lastNote = 0;
  private heroPos = new THREE.Vector3();
  private heroVel = new THREE.Vector2();
  private twinkle = 0;
  private weatherAcc = 0;
  private hudTick = 0;
  private mapTick = 0;
  private autosave = 20;
  private rng = new RNG(99);
  private groundMap!: HTMLCanvasElement;

  constructor(
    private world: World,
    private audio: AudioEngine,
    private platform: Platform,
    private store: SaveStore,
    makeUI: (h: UIHandlers) => UI,
  ) {
    this.fx = new Particles(world.camera);
    world.stage.add(this.fx.root, this.hero.root);
    this.rig = new CameraRig(world.camera);
    this.buildWorld();
    this.ui = makeUI(this.handlers());
    this.ui.setMap({ coast: this.land.pts, ground: this.groundMap, minX: this.land.minX, maxX: this.land.maxX, minZ: this.land.minZ, maxZ: this.land.maxZ });
    this.input = new Input(world.canvas, document.getElementById('ui')!);
    const s = this.data;
    this.hero.setSkin(skinById(s.skin));
    this.hero.setHat(hatById(s.hat).id);
    audio.music.setOn(s.music);
    audio.setAmbienceOn(s.ambience);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.escape();
    });
  }

  private get data(): SaveData {
    return this.store.data;
  }

  start(): void {
    const p = this.data.pos;
    const [x, z] = p && this.canStand(p[0], p[1]) ? p : this.spawn;
    this.hero.place(x, z, 0);
    const zone = this.zoneAt(x, z) ?? this.hub;
    this.lastZone = zone;
    this.world.setTheme(zone.theme, true);
    this.audio.setAmbience(zone.theme.ambience);
    this.audio.music.setSuppressed(!zone.theme.music);
    this.toTitle(true);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ world

  private buildWorld(): void {
    const map = makeWorldMap();
    const land = (this.land = map.land);
    const hubSpec = map.zones[map.hub];
    this.spawn = [hubSpec.cx, hubSpec.cz + 1.5];

    // Obstacles are holes in the shared landmass, so place them before any items.
    const props: Hole[][] = map.zones.map(() => []);
    for (const spec of map.zones) {
      const rng = new RNG(spec.seed + 1);
      const count = THEMES[spec.world].props ?? 3;
      for (let k = 0, tries = 0; k < count && tries < 400; tries++) {
        const r = rng.range(0.32, 0.5);
        const x = rng.range(spec.minX, spec.maxX);
        const z = rng.range(spec.minZ, spec.maxZ);
        const pad = r + 0.6;
        if (![[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]].every(([dx, dz]) => inZone(spec.index, x + dx, z + dz))) continue;
        if (!inField(land, x, z, r + 0.9, r + 1.2)) continue;
        if ((x - this.spawn[0]) ** 2 + (z - this.spawn[1]) ** 2 < 2 ** 2) continue;
        const h = { x, z, r };
        land.holes.push(h);
        props[spec.index].push(h);
        k++;
      }
    }

    const groundColor = (x: number, z: number) => THEMES[zoneWorld(zoneIndex(x, z))].top;
    this.world.stage.add(buildLand(land, new THREE.CanvasTexture(paintGround(land, groundColor, 512))));
    this.groundMap = paintGround(land, groundColor, 128);

    for (const spec of map.zones) {
      const theme = THEMES[spec.world];
      const rng = new RNG(spec.seed);
      const root = new THREE.Group();
      for (const h of props[spec.index]) {
        const p = buildProp(theme.prop, h.r, rng);
        p.position.set(h.x, 0, h.z);
        p.rotation.y = rng.range(-0.6, 0.6);
        root.add(p);
      }
      const surface = createSurface(spec.world, {
        shape: land,
        region: (x, z) => inZone(spec.index, x, z),
        bounds: spec,
        fx: this.fx,
        rng,
        theme,
      });
      root.add(surface.root);
      this.world.stage.add(root);
      this.zones.push({
        index: spec.index,
        world: spec.world,
        theme,
        surface,
        root,
        cleared: false,
        // Title / overview shots frame an area together with its neighbours.
        bounds: { cx: spec.cx, cz: spec.cz, radius: CELL * 1.1, minX: spec.minX, maxX: spec.maxX, minZ: spec.minZ, maxZ: spec.maxZ },
      });
    }
    this.hub = this.zones[map.hub];

    const pts: [number, number][] = [];
    for (const z of this.zones) for (let k = 0; k < GEMS_PER_ZONE; k++) pts.push(this.randomSpot(z, pts));
    this.gems = new Gems(pts);
    this.world.stage.add(this.gems.mesh);
    this.fx.floor = (x, z) => land.sdf!(x, z) >= 0;
  }

  private randomSpot(z: Zone, avoid: [number, number][]): [number, number] {
    const b = z.bounds;
    for (let tries = 0; tries < 300; tries++) {
      const x = this.rng.range(b.minX, b.maxX);
      const y = this.rng.range(b.minZ, b.maxZ);
      if (!inZone(z.index, x, y) || !inField(this.land, x, y, 0.6, 0.6)) continue;
      if (avoid.some(([ax, az]) => (ax - x) ** 2 + (az - y) ** 2 < 1.6 ** 2)) continue;
      return [x, y];
    }
    return [b.cx, b.cz];
  }

  private zoneAt(x: number, z: number): Zone | null {
    return this.land.sdf!(x, z) >= 0 ? this.zones[zoneIndex(x, z)] : null;
  }

  private canStand = (x: number, z: number): boolean => inField(this.land, x, z, 0.24, 0.36);

  private zoneName(z: Zone): string {
    return t(`w_${z.world}` as TextKey);
  }

  // ------------------------------------------------------------------ flow

  private toTitle(snap = false): void {
    this.state = 'title';
    this.input.enabled = false;
    this.input.reset();
    this.hero.faceYaw(0);
    this.rig.setMode('orbit', 1.8);
    this.world.setShadowSpan(8);
    const b = (this.lastZone ?? this.hub).bounds;
    if (snap) this.rig.update(0, 0, this.heroPos.set(this.hero.x, 0, this.hero.z), this.heroVel.set(0, 0), b, true);
    this.ui.hideHUD();
    this.ui.tutorial(false);
    this.ui.showTitle(this.data, this.zones.length);
  }

  private play(): void {
    if (this.state !== 'title') return;
    this.ui.hideTitle();
    this.state = 'playing';
    this.rig.setMode('follow', 2.4);
    this.world.setShadowSpan(6);
    this.input.enabled = true;
    this.ui.showHUD(this.data.gems, this.data.crunches);
    this.hero.squish(0.3);
    this.hero.hop(3.5);
    // Re-announce the area we're standing in.
    this.lastZone = null;
    if (!this.data.tutorial) {
      this.ui.tutorial(true);
      this.input.onFirstMove = () =>
        this.after(1.4, () => {
          this.ui.tutorial(false);
          this.data.tutorial = true;
          this.store.save();
        });
    }
  }

  private enterZone(z: Zone): void {
    this.lastZone = z;
    this.world.setTheme(z.theme);
    this.audio.setAmbience(z.theme.ambience);
    this.audio.music.setSuppressed(!z.theme.music);
    if (!this.data.found.includes(z.world)) {
      this.ui.banner(this.zoneName(z));
      this.data.found.push(z.world);
      this.data.gems += 5;
      this.ui.setGems(this.data.gems);
      this.after(1.3, () => this.ui.toast(`${t('newArea')}  +5`));
      this.audio.play('sparkle', { gain: 0.55, reverb: 0.5, delay: 0.2, jitter: 0 });
      this.store.save();
    }
  }

  private checkZone(z: Zone | null): void {
    if (!z) return;
    const p = z.surface.progress;
    if (z.cleared && p < 0.6) z.cleared = false;
    if (!z.cleared && !this.finale && p >= AUTO_FINISH) {
      const s = z.surface;
      const queue: number[] = [];
      for (let i = 0; i < s.n; i++) if (s.state[i] === 0) queue.push(i);
      const hx = this.hero.x, hz = this.hero.z;
      const d = (i: number) => (s.px[i] - hx) ** 2 + (s.pz[i] - hz) ** 2;
      queue.sort((a, b) => d(a) - d(b));
      this.finale = { zone: z, queue, idx: 0, acc: 0, t: 0 };
    }
  }

  /** The last few items of an area crunch themselves in an accelerating cascade. */
  private finaleStep(dt: number, out: HitEvent[]): void {
    const f = this.finale!;
    f.t += dt;
    f.acc += (40 + f.t * 320) * dt;
    const s = f.zone.surface;
    while (f.acc >= 1 && f.idx < f.queue.length) {
      f.acc -= 1;
      const i = f.queue[f.idx++];
      if (s.state[i] === 0) s.hit(i, this.time, this.hero.x, this.hero.z, 0, 0, out);
    }
    if (f.idx >= f.queue.length && f.t > 0.3) {
      this.finale = null;
      this.zoneComplete(f.zone);
    }
  }

  private zoneComplete(z: Zone): void {
    z.cleared = true;
    const s = this.data;
    s.gems += 5;
    this.ui.setGems(s.gems);
    this.ui.toast(`${t('areaDone')}  +5`);
    this.audio.play('win', { gain: 0.85, reverb: 0.3, bus: 'ui', jitter: 0 });
    this.audio.play('sparkle', { gain: 0.6, reverb: 0.5, delay: 0.3, jitter: 0 });
    if (s.haptics) this.platform.haptic('success');
    this.confetti(z.bounds);
    this.hero.happy = true;
    this.hero.hop(5);
    this.after(0.65, () => this.hero.hop(4));
    this.after(2.2, () => (this.hero.happy = false));
    this.submitScore();
  }

  private confetti(b: FieldBounds): void {
    const cx = this.hero.x, cz = this.hero.z;
    const r = Math.min(4, b.radius);
    for (let k = 0; k < 110; k++) {
      this.fx.emit(
        'flat',
        cx + (Math.random() - 0.5) * r * 2,
        3 + Math.random() * 2.5,
        cz + (Math.random() - 0.5) * r * 2,
        (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5,
        0.12 + Math.random() * 0.06, 2.6 + Math.random() * 1.2,
        PASTELS[k % PASTELS.length], 2.2, 1.4,
      );
    }
    this.fx.burst('spark', cx, 0.8, cz, 14, { color: 0xffffff, speed: 2.2, up: 2.5, size: 0.35, life: 0.9, gravity: 1, drag: 2 });
  }

  private home(): void {
    this.ui.hidePause();
    this.menuPaused = false;
    this.data.pos = [this.hero.x, this.hero.z];
    this.store.save();
    this.toTitle();
  }

  private pause(): void {
    if (this.menuPaused || this.state !== 'playing') return;
    this.menuPaused = true;
    this.input.reset();
    this.ui.showPause(this.data);
  }

  private resume(): void {
    if (!this.menuPaused) return;
    this.menuPaused = false;
    this.ui.hidePause();
    this.lastT = performance.now();
  }

  private escape(): void {
    if (this.ui.escape()) return;
    if (this.state === 'playing') this.pause();
  }

  /** Host pause (YouTube onPause / app backgrounded): stop the loop and all audio. */
  pauseSystem(): void {
    if (this.sysPaused) return;
    this.sysPaused = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.setPaused(true);
    this.data.pos = [this.hero.x, this.hero.z];
    this.submitScore();
    if (this.state === 'playing' && !this.menuPaused) this.pause();
  }

  resumeSystem(): void {
    if (!this.sysPaused) return;
    this.sysPaused = false;
    this.audio.setPaused(false);
    this.lastT = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  /** Saves first, then reports the same value, so the YouTube score always matches the save. */
  private submitScore(): void {
    this.store.flush();
    this.platform.sendScore(this.data.crunches);
  }

  private after(sec: number, fn: () => void): void {
    this.timers.push({ at: this.time + sec, fn });
  }

  // ------------------------------------------------------------------ shop & settings

  private openShop(): void {
    if (this.state !== 'title') return;
    this.state = 'shop';
    this.ui.hideTitle();
    this.ui.showShop(this.data);
    this.rig.setMode('closeup', 2.2);
    this.hero.faceYaw(0);
  }

  private closeShop(): void {
    if (this.state !== 'shop') return;
    this.ui.hideShop();
    this.toTitle();
  }

  private buy(kind: 'skin' | 'hat', id: string): void {
    const s = this.data;
    const owned = kind === 'skin' ? s.skins : s.hats;
    const price = kind === 'skin' ? (SKINS.find((k) => k.id === id)?.price ?? 0) : (HATS.find((k) => k.id === id)?.price ?? 0);
    if (!owned.includes(id)) {
      if (s.gems < price) {
        this.ui.shake(id);
        this.ui.toast(t('notEnough'));
        return;
      }
      s.gems -= price;
      owned.push(id);
      this.ui.toast(t('unlocked'));
      this.audio.play('sparkle', { gain: 0.7, reverb: 0.5, bus: 'ui', jitter: 0 });
      this.fx.burst('spark', this.hero.x, 0.9, this.hero.z, 12, { color: 0xffffff, speed: 1.5, up: 1.5, size: 0.3, life: 0.8, gravity: 0, drag: 2 });
      if (s.haptics) this.platform.haptic('success');
    }
    if (kind === 'skin') {
      s.skin = id;
      this.hero.setSkin(skinById(id));
    } else {
      s.hat = id;
      this.hero.setHat(hatById(id).id);
    }
    this.hero.squish(0.35);
    this.hero.hop(3);
    this.store.save();
    this.ui.renderShop(s);
  }

  private toggle(key: ToggleKey, on: boolean): void {
    this.data[key] = on;
    if (key === 'music') this.audio.music.setOn(on);
    if (key === 'ambience') this.audio.setAmbienceOn(on);
    if (key === 'haptics' && on) this.platform.haptic('medium');
    this.store.save();
  }

  private handlers(): UIHandlers {
    return {
      play: () => this.play(),
      openShop: () => this.openShop(),
      closeShop: () => this.closeShop(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      home: () => this.home(),
      toggle: (k, on) => this.toggle(k, on),
      selectSkin: (id) => this.buy('skin', id),
      selectHat: (id) => this.buy('hat', id),
      tap: () => this.audio.play('ui_tap', { bus: 'ui', gain: 0.8, minGap: 0.04 }),
      panel: () => this.audio.play('ui_whoosh', { bus: 'ui', gain: 0.6, minGap: 0.1 }),
    };
  }

  // ------------------------------------------------------------------ main loop

  private frame = (now: number) => {
    if (this.sysPaused) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastT) / 1000));
    this.lastT = now;
    this.world.watchPerformance(dt);
    if (!this.menuPaused) this.step(dt);
    this.world.render();
  };

  private step(dt: number): void {
    this.time += dt;
    const time = this.time;
    const hero = this.hero;

    for (let k = this.timers.length - 1; k >= 0; k--) {
      if (this.timers[k].at <= time) {
        const fn = this.timers[k].fn;
        this.timers.splice(k, 1);
        fn();
      }
    }

    const playing = this.state === 'playing';
    const mv = this.input.read();
    hero.move(dt, mv.x, mv.z, playing ? mv.mag : 0, this.canStand);
    hero.update(dt, time);
    this.heroPos.set(hero.x, 0, hero.z);
    this.heroVel.set(hero.vx, hero.vz);

    const zone = this.zoneAt(hero.x, hero.z);
    if (playing && zone && zone !== this.lastZone) this.enterZone(zone);

    const ev = this.events;
    ev.length = 0;
    if (playing && zone && hero.y <= 0.001) zone.surface.process(hero.x, hero.z, BRUSH, hero.vx, hero.vz, time, ev);
    if (this.finale) this.finaleStep(dt, ev);
    if (ev.length) this.onHits(ev);
    if (playing) {
      this.updateCombo(time);
      this.footsteps(zone);
      this.checkZone(zone);
    }

    for (const z of this.zones) z.surface.update(dt, time, hero.x, hero.z, z !== zone && z !== this.finale?.zone);

    for (const i of this.gems.update(time, hero.x, hero.z, playing)) this.collectGem(i);
    for (let k = this.gemTimers.length - 1; k >= 0; k--) {
      const g = this.gemTimers[k];
      if (time < g.at) continue;
      const others = this.zones.filter((z) => z !== zone);
      const [x, z] = this.randomSpot(others[Math.floor(Math.random() * others.length)], []);
      this.gems.respawn(g.i, x, z);
      this.gemTimers.splice(k, 1);
    }
    this.twinkle -= dt;
    if (this.twinkle <= 0) {
      this.twinkle = 0.12;
      const g = this.gems;
      const i = Math.floor(Math.random() * g.x.length);
      if (g.alive[i] && (g.x[i] - hero.x) ** 2 + (g.z[i] - hero.z) ** 2 < 150) {
        this.fx.emit('spark', g.x[i] + (Math.random() - 0.5) * 0.35, 0.45 + Math.random() * 0.35, g.z[i] + (Math.random() - 0.5) * 0.35, 0, 0.3, 0, 0.2, 0.6, PASTELS[i % PASTELS.length], 0, 1);
      }
    }
    this.weather(dt, zone ?? this.lastZone ?? this.hub);
    this.fx.update(dt);

    const b = (zone ?? this.lastZone ?? this.hub).bounds;
    this.rig.update(dt, time, this.heroPos, this.heroVel, b);
    this.world.update(dt, time, this.rig.look);
    this.audio.music.update(dt);

    if (playing) {
      this.hudTick -= dt;
      if (this.hudTick <= 0) {
        this.hudTick = 0.1;
        const z = zone ?? this.lastZone;
        this.ui.setZone(z ? this.zoneName(z) : '', z ? z.surface.progress : 0);
        this.ui.setCrunches(this.data.crunches);
      }
      this.mapTick -= dt;
      if (this.mapTick <= 0) {
        this.mapTick = 0.12;
        this.ui.drawMap(hero.x, hero.z, hero.yaw, this.gems);
      }
      this.autosave -= dt;
      if (this.autosave <= 0) {
        this.autosave = 20;
        this.data.pos = [hero.x, hero.z];
        this.store.save();
      }
    }
  }

  private weather(dt: number, z: Zone): void {
    const w = WEATHER[z.world];
    this.weatherAcc += w.rate * dt;
    const c = this.rig.look;
    while (this.weatherAcc >= 1) {
      this.weatherAcc -= 1;
      const x = c.x + (Math.random() - 0.5) * 16;
      const zz = c.z + (Math.random() - 0.65) * 18;
      if (w.vy > 0 && this.land.sdf!(x, zz) < 0) continue;
      const y = w.vy < 0 ? 4.5 + Math.random() * 1.5 : 0.15 + Math.random() * 1.2;
      const dx = (Math.random() - 0.5) * w.drift, dz = (Math.random() - 0.5) * w.drift;
      const color = w.colors[Math.floor(Math.random() * w.colors.length)];
      this.fx.emit(w.kind, x, y, zz, dx + 0.15, w.vy * (0.8 + Math.random() * 0.4), dz, w.size * (0.7 + Math.random() * 0.6), w.life, color, 0, 0);
    }
  }

  private onHits(ev: HitEvent[]): void {
    const focusX = this.rig.look.x;
    // Walking slowly sounds soft and delicate, running sounds full and crunchy.
    const dyn = 0.68 + 0.32 * Math.min(1, this.hero.speed / 3);
    let strum = 0;
    let typing = 0;
    for (const e of ev) {
      // Sounds are panned to where the crunch happens – left of the hero is heard on the left.
      const pan = clamp((e.x - focusX) / 3, -0.9, 0.9);
      if (e.stagger) {
        this.audio.play(e.sound, { rate: e.rate * (1 + this.tier * 0.025), gain: e.gain * dyn, pan, minGap: e.minGap, reverb: 0.06, delay: typing });
        typing += e.stagger * (0.7 + Math.random() * 0.6);
      } else if (e.midi !== undefined) {
        if (this.finale && this.time - this.lastNote < 0.06) continue;
        this.lastNote = this.time;
        this.audio.playNote(e.midi, { gain: e.gain * dyn, pan, delay: strum, reverb: 0.4 });
        strum += 0.055;
      } else {
        this.audio.play(e.sound, { rate: e.rate * (1 + this.tier * 0.025), gain: e.gain * dyn, pan, minGap: e.minGap, reverb: 0.08 });
      }
    }
    this.lastHit = this.time;
    if (this.comboStart < 0) this.comboStart = this.time;
    this.hero.squish(Math.min(0.06, 0.014 * ev.length));
    if (this.data.haptics && this.time - this.lastHaptic > 0.085) {
      this.lastHaptic = this.time;
      this.platform.haptic('tick');
    }
    const s = this.data;
    s.crunches += ev.length;
    const m = Math.floor(s.crunches / MILESTONE);
    if (m > s.milestone) {
      s.milestone = m;
      s.gems += 3;
      this.ui.setGems(s.gems);
      this.ui.toast(`${fmt(m * MILESTONE)} ${t('crunches')}!  +3`);
      this.audio.play('sparkle', { gain: 0.5, reverb: 0.5, jitter: 0 });
      this.submitScore();
    }
  }

  /** Something to hear on every step, even on ground that is already crunched. */
  private footsteps(zone: Zone | null): void {
    if (!this.hero.stepped || !zone || this.time - this.lastHit < 0.25) return;
    const pan = (Math.random() - 0.5) * 0.3;
    this.audio.play(zone.surface.stepSound, { gain: 0.34, rate: 0.88 + Math.random() * 0.16, pan, minGap: 0.1 });
  }

  /** "Tingles" combo: keep crunching without stopping to climb tiers. */
  private updateCombo(time: number): void {
    if (this.comboStart >= 0 && time - this.lastHit > 0.6) {
      this.comboStart = -1;
      if (this.tier) {
        this.tier = 0;
        this.ui.setTingle(0);
      }
      return;
    }
    if (this.comboStart < 0) return;
    const tier = Math.min(4, Math.floor((time - this.comboStart) / 3));
    if (tier > this.tier) {
      this.tier = tier;
      this.ui.setTingle(tier + 1);
      this.audio.play('sparkle', { gain: 0.35, reverb: 0.5, jitter: 0 });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        this.fx.emit('spark', this.hero.x + Math.cos(a) * 0.5, 0.3, this.hero.z + Math.sin(a) * 0.5, Math.cos(a) * 1.5, 1.2, Math.sin(a) * 1.5, 0.28, 0.6, PASTELS[k % PASTELS.length], 0, 2);
      }
      if (this.data.haptics) this.platform.haptic('soft');
    }
  }

  private collectGem(i: number): void {
    const x = this.gems.x[i], z = this.gems.z[i];
    this.data.gems++;
    this.ui.setGems(this.data.gems);
    this.audio.play('coin', { gain: 0.9, pan: clamp((x - this.rig.look.x) / 3, -0.9, 0.9), reverb: 0.25, jitter: 0.02 });
    this.fx.burst('spark', x, 0.6, z, 8, { color: 0xffd1e6, speed: 1.6, up: 1.8, size: 0.3, life: 0.6, gravity: 0, drag: 2.5 });
    this.fx.burst('ball', x, 0.6, z, 5, { color: 0xff8fb8, speed: 1.4, up: 2, size: 0.05, life: 0.6, gravity: 6, drag: 1.5 });
    if (this.data.haptics) this.platform.haptic('medium');
    this.gemTimers.push({ i, at: this.time + GEM_RESPAWN });
  }
}
