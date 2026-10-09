/// <reference types="vite/client" />

/** Build target, injected by vite.config.ts. */
declare const __PLATFORM__: 'youtube' | 'native' | 'web';

/** Minimal typings for the YouTube Playables SDK (https://www.youtube.com/game_api/v1). */
interface YtGame {
  IN_PLAYABLES_ENV: boolean;
  SDK_VERSION: string;
  game: {
    firstFrameReady(): void;
    gameReady(): void;
    saveData(data: string): Promise<void>;
    loadData(): Promise<string>;
  };
  system: {
    isAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (enabled: boolean) => void): () => void;
    onPause(cb: () => void): () => void;
    onResume(cb: () => void): () => void;
    getLanguage(): Promise<string>;
  };
  engagement: { sendScore(score: { value: number }): Promise<void> };
  health: { logError(): void; logWarning(): void };
}

interface Window {
  ytgame?: YtGame;
  webkitAudioContext?: typeof AudioContext;
}
