import type { HapticKind, Platform } from './platform';

const KEY = 'crunchy-trail-save';

type HapticsModule = typeof import('@capacitor/haptics');
type PrefsModule = typeof import('@capacitor/preferences');

/** iOS / Android app built with Capacitor. */
export class NativePlatform implements Platform {
  readonly kind = 'native' as const;
  readonly canVibrate = true;
  private haptics?: HapticsModule;
  private prefs?: PrefsModule;
  private pauseCbs: (() => void)[] = [];
  private resumeCbs: (() => void)[] = [];

  async init(): Promise<this> {
    const [haptics, prefs, app, statusBar] = await Promise.all([
      import('@capacitor/haptics'),
      import('@capacitor/preferences'),
      import('@capacitor/app'),
      import('@capacitor/status-bar'),
    ]);
    this.haptics = haptics;
    this.prefs = prefs;
    app.App.addListener('appStateChange', ({ isActive }) => {
      for (const cb of isActive ? this.resumeCbs : this.pauseCbs) cb();
    });
    statusBar.StatusBar.hide().catch(() => {});
    return this;
  }

  firstFrameReady(): void {}
  gameReady(): void {}

  async load(): Promise<string | null> {
    try {
      return (await this.prefs!.Preferences.get({ key: KEY })).value;
    } catch {
      return null;
    }
  }

  async save(data: string): Promise<void> {
    await this.prefs?.Preferences.set({ key: KEY, value: data });
  }

  audioEnabled(): boolean {
    return true;
  }
  onAudioChange(): void {}

  onPause(cb: () => void): void {
    this.pauseCbs.push(cb);
  }
  onResume(cb: () => void): void {
    this.resumeCbs.push(cb);
  }

  async language(): Promise<string> {
    return navigator.language || 'en';
  }

  sendScore(): void {}

  haptic(kind: HapticKind): void {
    const h = this.haptics;
    if (!h) return;
    const p =
      kind === 'success'
        ? h.Haptics.notification({ type: h.NotificationType.Success })
        : h.Haptics.impact({ style: kind === 'medium' ? h.ImpactStyle.Medium : h.ImpactStyle.Light });
    p.catch(() => {});
  }

  logError(err: unknown): void {
    console.error(err);
  }

  splashDone(): void {
    import('@capacitor/splash-screen').then((m) => m.SplashScreen.hide({ fadeOutDuration: 250 })).catch(() => {});
  }
}
