/**
 * backdrop.ts — shared backdrop palettes. The same gradients drive the live
 * CSS background behind the canvas, single-PNG exports and the contact sheet,
 * so what you see is what you download.
 */

export type BackdropId = 'studio' | 'ember' | 'midnight' | 'transparent';

export interface Backdrop {
  id: BackdropId;
  name: string;
  /** CSS gradient for the page background behind the canvas. */
  css: string;
  /** Radial gradient stops [center, mid, edge] used when painting exports. */
  stops: [string, string, string];
  /** Whether to paint the gradient into exported PNGs (false = alpha). */
  painted: boolean;
  /** Whether to show the visible studio floor disc in the 3D scene. */
  floorDisc: boolean;
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'studio',
    name: 'Studio',
    css: 'radial-gradient(120% 90% at 50% 32%, #332b25 0%, #221c17 52%, #14100d 100%)',
    stops: ['#332b25', '#221c17', '#14100d'],
    painted: true,
    floorDisc: true,
  },
  {
    id: 'ember',
    name: 'Ember',
    css: 'radial-gradient(120% 90% at 50% 32%, #3d241b 0%, #281612 52%, #160c0a 100%)',
    stops: ['#3d241b', '#281612', '#160c0a'],
    painted: true,
    floorDisc: true,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    css: 'radial-gradient(120% 90% at 50% 32%, #222734 0%, #171b25 52%, #0e1017 100%)',
    stops: ['#222734', '#171b25', '#0e1017'],
    painted: true,
    floorDisc: true,
  },
  {
    id: 'transparent',
    name: 'Transparent',
    css: 'linear-gradient(45deg, #262019 25%, transparent 25%) 0 0 / 28px 28px, linear-gradient(-45deg, #262019 25%, transparent 25%) 0 14px / 28px 28px, linear-gradient(45deg, transparent 75%, #262019 75%) 14px -14px / 28px 28px, linear-gradient(-45deg, transparent 75%, #262019 75%) -14px 0 / 28px 28px, #1b1712',
    stops: ['#000000', '#000000', '#000000'],
    painted: false,
    floorDisc: false,
  },
];

export function backdropById(id: BackdropId): Backdrop {
  return BACKDROPS.find((backdrop) => backdrop.id === id) ?? BACKDROPS[0];
}

/** Paint a radial studio gradient onto a 2D canvas (for PNG exports). */
export function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, backdrop: Backdrop): void {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height * 0.36,
    Math.min(width, height) * 0.08,
    width / 2,
    height * 0.46,
    Math.max(width, height) * 0.78,
  );
  gradient.addColorStop(0, backdrop.stops[0]);
  gradient.addColorStop(0.52, backdrop.stops[1]);
  gradient.addColorStop(1, backdrop.stops[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // Gentle vignette to seat the subject.
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.42,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
