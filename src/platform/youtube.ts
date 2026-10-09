import { coarsePointer, webVibrate, type HapticKind, type Platform } from './platform';

const LOCAL_KEY = 'crunchy-trail-save';

/**
 * YouTube Playables host. Follows the certification rules:
 * - cloud save only (saveData / loadData), loadData is awaited before any save,
 * - audio follows isAudioEnabled / onAudioEnabledChange,
 * - pause / resume come only from the SDK (no Page Visibility API).
 * Outside the Playables environment (local testing) it falls back to localStorage.
 */
export class YouTubePlatform implements Platform {
  readonly kind = 'youtube' as const;
  readonly canVibrate = typeof navigator.vibrate === 'function' && coarsePointer();
  private yt = window.ytgame;
  private inEnv = !!window.ytgame?.IN_PLAYABLES_ENV;

  firstFrameReady(): void {
    this.yt?.game.firstFrameReady();
  }

  gameReady(): void {
    this.yt?.game.gameReady();
  }

  async load(): Promise<string | null> {
    if (!this.inEnv) {
      try {
        return localStorage.getItem(LOCAL_KEY);
      } catch {
        return null;
      }
    }
    try {
      return (await this.yt!.game.loadData()) || null;
    } catch (e) {
      this.logError(e);
      return null;
    }
  }

  async save(data: string): Promise<void> {
    if (!this.inEnv) {
      try {
        localStorage.setItem(LOCAL_KEY, data);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await this.yt!.game.saveData(data);
    } catch {
      try {
        this.yt?.health.logWarning();
      } catch {
        /* ignore */
      }
    }
  }

  audioEnabled(): boolean {
    try {
      return this.yt ? this.yt.system.isAudioEnabled() : true;
    } catch {
      return true;
    }
  }

  onAudioChange(cb: (enabled: boolean) => void): void {
    this.yt?.system.onAudioEnabledChange(cb);
  }

  onPause(cb: () => void): void {
    this.yt?.system.onPause(cb);
  }

  onResume(cb: () => void): void {
    this.yt?.system.onResume(cb);
  }

  async language(): Promise<string> {
    try {
      return this.yt ? await this.yt.system.getLanguage() : navigator.language;
    } catch {
      return 'en';
    }
  }

  sendScore(value: number): void {
    if (!this.inEnv) return;
    const v = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
    this.yt!.engagement.sendScore({ value: v }).catch(() => {});
  }

  haptic(kind: HapticKind): void {
    if (this.canVibrate) webVibrate(kind);
  }

  logError(err: unknown): void {
    console.error(err);
    try {
      this.yt?.health.logError();
    } catch {
      /* ignore */
    }
  }

  splashDone(): void {}
}
