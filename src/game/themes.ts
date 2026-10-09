export type WorldId = 'bubble' | 'grass' | 'snow' | 'leaves' | 'sand' | 'jelly' | 'popit' | 'ice' | 'kalimba' | 'keyboard';

export type PropKind = 'rock' | 'mushroom' | 'snowman' | 'pumpkin' | 'castle' | 'candy' | 'block';

export interface Theme {
  skyTop: number;
  skyBottom: number;
  /** Island layers: top surface, cake side, deep base. */
  top: number;
  side: number;
  deep: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  ambience: 'amb_meadow' | 'amb_winter' | 'amb_cozy' | null;
  /** Whether background music plays in this world. */
  music: boolean;
  prop: PropKind;
  /** Obstacles placed in the area (default 3). */
  props?: number;
}

export const THEMES: Record<WorldId, Theme> = {
  bubble: {
    skyTop: 0xa9c8ff, skyBottom: 0xffe3f1, top: 0xb7d8ff, side: 0x9cc4ec, deep: 0x7fa6d6,
    hemiSky: 0xeaf3ff, hemiGround: 0xf3d9e8, sun: 0xfff3e6, ambience: 'amb_cozy', music: true, prop: 'block',
  },
  grass: {
    skyTop: 0x8fd3ff, skyBottom: 0xe2fff1, top: 0x86bf5a, side: 0xb5865f, deep: 0x8f6748,
    hemiSky: 0xe3f6ff, hemiGround: 0xc9e3a8, sun: 0xfff1d6, ambience: 'amb_meadow', music: true, prop: 'mushroom',
  },
  snow: {
    skyTop: 0x9fc3ee, skyBottom: 0xf1f7ff, top: 0xc4d7ee, side: 0x9fb9d8, deep: 0x7f98ba,
    hemiSky: 0xf0f6ff, hemiGround: 0xd8e4f4, sun: 0xfff6ee, ambience: 'amb_winter', music: true, prop: 'snowman',
  },
  leaves: {
    skyTop: 0xffc59e, skyBottom: 0xfff2d9, top: 0x9ccb67, side: 0xb17d55, deep: 0x8b5f3f,
    hemiSky: 0xfff0dc, hemiGround: 0xe7cf9e, sun: 0xffe2bf, ambience: 'amb_meadow', music: true, prop: 'pumpkin',
  },
  sand: {
    skyTop: 0xffd39b, skyBottom: 0xfff5e3, top: 0xf0d2a8, side: 0xd5a877, deep: 0xb88a5e,
    hemiSky: 0xfff5e6, hemiGround: 0xf2dcc0, sun: 0xfff0d9, ambience: 'amb_cozy', music: true, prop: 'castle',
  },
  jelly: {
    skyTop: 0xffb3d4, skyBottom: 0xfff0f7, top: 0xfff4f8, side: 0xf5c6db, deep: 0xe5a6c4,
    hemiSky: 0xfff0f7, hemiGround: 0xf6d9e8, sun: 0xfff3f3, ambience: 'amb_cozy', music: true, prop: 'candy',
  },
  popit: {
    skyTop: 0xc4b2ff, skyBottom: 0xfff4dc, top: 0xfaf6ff, side: 0xd8c9f6, deep: 0xb9a6e6,
    hemiSky: 0xf5f0ff, hemiGround: 0xf1e3d6, sun: 0xfff6ea, ambience: 'amb_meadow', music: true, prop: 'block',
  },
  ice: {
    skyTop: 0x7cc4e6, skyBottom: 0xe8fbff, top: 0xb7e2f5, side: 0x8cbfe0, deep: 0x6d9fc8,
    hemiSky: 0xeefcff, hemiGround: 0xcfe9f5, sun: 0xf3fbff, ambience: 'amb_winter', music: true, prop: 'snowman',
  },
  kalimba: {
    skyTop: 0x9f9cf5, skyBottom: 0xffdcea, top: 0xf6e3cc, side: 0xdcb48c, deep: 0xbf916b,
    hemiSky: 0xf4ecff, hemiGround: 0xf3dcc8, sun: 0xffeedd, ambience: 'amb_meadow', music: false, prop: 'rock',
  },
  keyboard: {
    skyTop: 0x8c84ff, skyBottom: 0xffd2ee, top: 0x4b4766, side: 0xd9d0f5, deep: 0xb9addf,
    hemiSky: 0xf2eeff, hemiGround: 0xe4daf6, sun: 0xfff2fa, ambience: 'amb_cozy', music: true, prop: 'block', props: 0,
  },
};
