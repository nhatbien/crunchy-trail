export interface SkinDef {
  id: string;
  color: string;
  price: number;
  /** Pearlescent (iridescent) finish. */
  pearl?: boolean;
}

export interface HatDef {
  id: 'none' | 'sprout' | 'headphones' | 'beanie' | 'flower' | 'bow' | 'crown';
  price: number;
}

export const SKINS: SkinDef[] = [
  { id: 'mochi', color: '#FFF4E8', price: 0 },
  { id: 'peach', color: '#FFC9B5', price: 30 },
  { id: 'matcha', color: '#C4E8B2', price: 40 },
  { id: 'taro', color: '#DACBFF', price: 50 },
  { id: 'soda', color: '#BFE4FF', price: 60 },
  { id: 'lemon', color: '#FFF0A3', price: 70 },
  { id: 'sakura', color: '#FFCCE0', price: 80 },
  { id: 'mint', color: '#B7F0DD', price: 90 },
  { id: 'sesame', color: '#9A928C', price: 120 },
  { id: 'pearl', color: '#F6F2FF', price: 200, pearl: true },
];

export const HATS: HatDef[] = [
  { id: 'none', price: 0 },
  { id: 'sprout', price: 25 },
  { id: 'flower', price: 35 },
  { id: 'beanie', price: 45 },
  { id: 'bow', price: 50 },
  { id: 'headphones', price: 60 },
  { id: 'crown', price: 150 },
];

export const skinById = (id: string) => SKINS.find((s) => s.id === id) ?? SKINS[0];
export const hatById = (id: string) => HATS.find((h) => h.id === id) ?? HATS[0];
