import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/800.css';
import './ui/styles.css';
import { AudioEngine } from './audio/AudioEngine';
import { setLanguage } from './core/i18n';
import { parseSave, SaveStore } from './core/save';
import { Game } from './game/Game';
import { World } from './game/World';
import { createPlatform, type Platform } from './platform/platform';
import { UI } from './ui/UI';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function boot(): Promise<void> {
  const loading = document.getElementById('loading')!;
  const bar = loading.querySelector<HTMLElement>('.ld-fill')!;
  const progress = (p: number) => (bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, p))})`);

  let platform: Platform | null = null;
  try {
    platform = await createPlatform();
    // The loading screen is on screen: tell the host frames are rendering.
    await nextFrame();
    platform.firstFrameReady();
    platform.splashDone();
    progress(0.1);

    setLanguage(await platform.language());
    // Always await the cloud save before anything could write one.
    const store = new SaveStore(parseSave(await platform.load()), platform);

    const audio = new AudioEngine();
    audio.setEnabled(platform.audioEnabled());
    platform.onAudioChange((on) => audio.setEnabled(on));

    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const world = new World(canvas);
    const logo = new Image();
    logo.src = 'img/logo.webp';
    await Promise.all([audio.load('audio/', (p) => progress(0.1 + p * 0.8)), logo.decode().catch(() => {})]);

    const uiRoot = document.getElementById('ui')!;
    const p = platform;
    const game = new Game(world, audio, p, store, (h) => new UI(uiRoot, h, p.canVibrate));
    game.start();
    if (import.meta.env.DEV) Object.assign(window, { game, audio, world });

    const unlock = () => audio.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { passive: true });
    platform.onPause(() => game.pauseSystem());
    platform.onResume(() => game.resumeSystem());
    window.addEventListener('resize', () => world.resize());
    new ResizeObserver(() => world.resize()).observe(canvas);

    progress(1);
    await nextFrame();
    await nextFrame();
    loading.classList.add('hide');
    await wait(320);
    loading.remove();
    // Title screen is interactive now.
    platform.gameReady();
  } catch (err) {
    platform?.logError(err);
    console.error(err);
    loading.classList.add('error');
  }
}

boot();
