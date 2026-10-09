import { coarsePointer, webVibrate, type HapticKind, type Platform } from './platform';

const KEY = 'crunchy-trail-save';

export class WebPlatform implements Platform {
  readonly kind = 'web' as const;
  readonly canVibrate = typeof navigator.vibrate === 'function' && coarsePointer();

  firstFrameReady(): void {}
  gameReady(): void {}

  async load(): Promise<string | null> {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  async save(data: string): Promise<void> {
    try {
      localStorage.setItem(KEY, data);
    } catch {
      /* private mode */
    }
  }

  audioEnabled(): boolean {
    return true;
  }
  onAudioChange(): void {}

  onPause(cb: () => void): void {
    document.addEventListener('visibilitychange', () => document.hidden && cb());
  }
  onResume(cb: () => void): void {
    document.addEventListener('visibilitychange', () => !document.hidden && cb());
  }

  async language(): Promise<string> {
    return navigator.language || 'en';
  }

  sendScore(): void {}

  haptic(kind: HapticKind): void {
    if (this.canVibrate) webVibrate(kind);
  }

  logError(err: unknown): void {
    console.error(err);
  }

  splashDone(): void {}
}
