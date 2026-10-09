import type { Platform } from '../platform/platform';
import { HATS, SKINS } from './catalog';

export interface SaveData {
  v: 1;
  gems: number;
  /** Lifetime number of crunched items – this is also the score sent to YouTube. */
  crunches: number;
  skin: string;
  hat: string;
  skins: string[];
  hats: string[];
  music: boolean;
  ambience: boolean;
  haptics: boolean;
  tutorial: boolean;
  /** Worlds the player has walked into at least once. */
  found: string[];
  /** Crunch milestones already rewarded. */
  milestone: number;
  /** Where the hero was standing (resume spot). */
  pos: [number, number] | null;
}

export const defaultSave = (): SaveData => ({
  v: 1,
  gems: 0,
  crunches: 0,
  skin: 'mochi',
  hat: 'none',
  skins: ['mochi'],
  hats: ['none'],
  music: true,
  ambience: true,
  haptics: true,
  tutorial: false,
  found: [],
  milestone: 0,
  pos: null,
});

const int = (v: unknown, d: number, min = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const ids = (v: unknown, valid: string[], d: string[]) =>
  Array.isArray(v) ? [...new Set([...d, ...v.filter((x): x is string => typeof x === 'string' && valid.includes(x))])] : d;

/** Tolerant parser: unknown / older / corrupted saves never crash the game. */
export function parseSave(raw: string | null): SaveData {
  const d = defaultSave();
  if (!raw) return d;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return d;
  } catch {
    return d;
  }
  const skinIds = SKINS.map((s) => s.id);
  const hatIds = HATS.map((h) => h.id);
  const s: SaveData = {
    v: 1,
    gems: int(o.gems, d.gems),
    crunches: int(o.crunches, d.crunches),
    skins: ids(o.skins, skinIds, d.skins),
    hats: ids(o.hats, hatIds, d.hats),
    skin: d.skin,
    hat: d.hat,
    music: bool(o.music, d.music),
    ambience: bool(o.ambience, d.ambience),
    haptics: bool(o.haptics, d.haptics),
    tutorial: bool(o.tutorial, d.tutorial),
    found: Array.isArray(o.found) ? o.found.filter((x): x is string => typeof x === 'string').slice(0, 32) : [],
    milestone: int(o.milestone, d.milestone),
    pos: Array.isArray(o.pos) && o.pos.length === 2 && o.pos.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [o.pos[0], o.pos[1]] : null,
  };
  if (typeof o.skin === 'string' && s.skins.includes(o.skin)) s.skin = o.skin;
  if (typeof o.hat === 'string' && s.hats.includes(o.hat)) s.hat = o.hat;
  return s;
}

/** Owns the save data and persists it through the platform (YouTube cloud save / Preferences / localStorage). */
export class SaveStore {
  private timer = 0;

  constructor(
    readonly data: SaveData,
    private platform: Platform,
  ) {}

  /** Debounced save – batches rapid changes (e.g. toggles) into one write. */
  save(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 250);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.platform.save(JSON.stringify(this.data)).catch(() => {});
  }
}
