/**
 * coats.ts — coat colour specs. Colour is applied in three layers, no paint
 * maps anywhere:
 *   1. Marching-cubes palette  → soft regions (muzzle/chin/belly cream, socks)
 *   2. Vertex colour pass      → saddle, calico blotches (seeded 3D noise)
 *   3. Fragment shader         → mackerel bands + guard-hair speckle
 */

export type CoatId = 'orangeTabby' | 'silverTabby' | 'cream' | 'midnight' | 'calico';

export interface CoatSpec {
  id: CoatId;
  name: string;
  /** Base fur colour (torso). */
  base: string;
  /** Lighter fur — chest blaze / muzzle / chin. */
  light: string;
  /** Deep fur — saddle + stripe tint reference. */
  dark: string;
  /** Stripe band colour used by the fragment shader. */
  stripe: string;
  /** How strongly the mackerel bands read (0 = solid coat). */
  stripeStrength: number;
  eye: string;
  /** CSS radial-gradient thumbnail for the swatch button. */
  swatch: string;
}

export const COATS: CoatSpec[] = [
  {
    id: 'orangeTabby',
    name: 'Orange Tabby',
    base: '#d8904a',
    light: '#f0c898',
    dark: '#8a4f24',
    stripe: '#6f3d18',
    stripeStrength: 0.62,
    eye: '#6fa054',
    swatch: 'radial-gradient(circle at 35% 35%, #f0c08a 0%, #d8904a 55%, #a96a33 100%)',
  },
  {
    id: 'silverTabby',
    name: 'Silver Tabby',
    base: '#a9a59c',
    light: '#e3e0d6',
    dark: '#57544d',
    stripe: '#3f3d36',
    stripeStrength: 0.55,
    eye: '#d8a83e',
    swatch: 'radial-gradient(circle at 35% 35%, #e3e0d6 0%, #a9a59c 55%, #5c5950 100%)',
  },
  {
    id: 'cream',
    name: 'Cream',
    base: '#e7d3a8',
    light: '#faf0d4',
    dark: '#a68d5f',
    stripe: '#8a7350',
    stripeStrength: 0.35,
    eye: '#58a08c',
    swatch: 'radial-gradient(circle at 35% 35%, #faf0d4 0%, #e7d3a8 55%, #b3a077 100%)',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    base: '#2b2830',
    light: '#4a4654',
    dark: '#131118',
    stripe: '#16141b',
    stripeStrength: 0.3,
    eye: '#d8a83e',
    swatch: 'radial-gradient(circle at 35% 35%, #4a4654 0%, #2b2830 55%, #0d0b10 100%)',
  },
  {
    id: 'calico',
    name: 'Calico',
    base: '#f2e9da',
    light: '#fdf8ee',
    dark: '#33302b',
    stripe: '#c56f2f',
    stripeStrength: 0.25,
    eye: '#d8a83e',
    swatch:
      'radial-gradient(circle at 30% 30%, #c56f2f 0%, #c56f2f 24%, transparent 26%), radial-gradient(circle at 68% 55%, #f2e9da 0%, #f2e9da 30%, transparent 32%), radial-gradient(circle at 42% 74%, #33302b 0%, #33302b 22%, transparent 24%), radial-gradient(circle at 72% 22%, #33302b 0%, #33302b 15%, transparent 17%), radial-gradient(circle at 22% 55%, #f2e9da 0%, #f2e9da 28%, transparent 30%), #c56f2f',
  },
];

export function coatById(id: CoatId): CoatSpec {
  return COATS.find((coat) => coat.id === id) ?? COATS[0];
}

/** Deterministic PRNG so every reload and every sheet cell paints the identical cat. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
