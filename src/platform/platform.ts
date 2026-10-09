export type HapticKind = 'tick' | 'soft' | 'medium' | 'success';

/** Everything the game needs from the host (YouTube Playables, Capacitor native app, or a plain browser). */
export interface Platform {
  readonly kind: 'youtube' | 'native' | 'web';
  readonly canVibrate: boolean;
  firstFrameReady(): void;
  gameReady(): void;
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
  audioEnabled(): boolean;
  onAudioChange(cb: (enabled: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  language(): Promise<string>;
  sendScore(value: number): void;
  haptic(kind: HapticKind): void;
  logError(err: unknown): void;
  /** Hide the native launch splash once the web loading screen is on screen. */
  splashDone(): void;
}

export async function createPlatform(): Promise<Platform> {
  if (__PLATFORM__ === 'youtube') {
    const { YouTubePlatform } = await import('./youtube');
    return new YouTubePlatform();
  }
  if (__PLATFORM__ === 'native') {
    const { NativePlatform } = await import('./native');
    return new NativePlatform().init();
  }
  const { WebPlatform } = await import('./web');
  return new WebPlatform();
}

/** Short vibration via the Vibration API (Android browsers); silently ignored elsewhere. */
export function webVibrate(kind: HapticKind): void {
  try {
    navigator.vibrate?.(kind === 'success' ? [14, 50, 22] : kind === 'medium' ? 16 : kind === 'soft' ? 10 : 7);
  } catch {
    /* blocked by permissions policy */
  }
}

export const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
