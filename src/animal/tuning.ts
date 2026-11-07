/**
 * tuning.ts — user-adjustable limb articulation.
 *
 * Angles are expressed in DEGREES (UI-friendly) and converted at build
 * time. Every angle is the INTERIOR angle at a joint — the angle
 * between a bone and the bone it is attached to — except `femurAngle`,
 * which is the femur's angle below the horizontal.
 *
 * Lengths are in metres (the same unit system as the rest of the cat).
 * Defaults are the measured production poses — tweaking nothing yields
 * exactly the built-in cat.
 */

import type { PoseId } from './profiles';

export interface HindTuning {
  /** hip → stifle (femur) */
  femurLen: number;
  /** stifle → hock */
  tibiaLen: number;
  /** hock → MTP (main toe joint) */
  metatarsusLen: number;
  /** MTP → toe tip */
  toeLen: number;
  /** degrees below the horizontal (0 = pointing forward flat, 90 = straight down) */
  femurAngle: number;
  /** interior degrees between femur and tibia (90 = right angle) */
  stifleAngle: number;
  /** interior degrees between tibia and metatarsus (90 = right angle) */
  hockAngle: number;
  /** interior degrees between metatarsus and phalanx */
  toeAngle: number;
}

export interface FrontTuning {
  /** shoulder → elbow */
  upperLen: number;
  /** degrees below the horizontal (90 = straight down) */
  upperAngle: number;
  /** elbow → wrist */
  lowerLen: number;
  /** interior degrees between upper and lower bone (180 = straight column) */
  elbowAngle: number;
}

export interface LegTuning {
  hind: HindTuning;
  front: FrontTuning;
}

const HIND_DEFAULTS: Record<PoseId, HindTuning> = {
  standing: {
    femurLen: 0.364,
    tibiaLen: 0.27,
    metatarsusLen: 0.142,
    toeLen: 0.058,
    femurAngle: 28.9,
    stifleAngle: 90.0,
    hockAngle: 90.0,
    toeAngle: 166.7,
  },
  sitting: {
    femurLen: 0.373,
    tibiaLen: 0.159,
    metatarsusLen: 0.081,
    toeLen: 0.1,
    femurAngle: 7.7,
    stifleAngle: 168.3,
    hockAngle: 169.4,
    toeAngle: 175.6,
  },
  stretch: {
    femurLen: 0.245,
    tibiaLen: 0.27,
    metatarsusLen: 0.095,
    toeLen: 0.058,
    femurAngle: 28.9,
    stifleAngle: 90.0,
    hockAngle: 90.0,
    toeAngle: 166.7,
  },
  loaf: {
    femurLen: 0.313,
    tibiaLen: 0.086,
    metatarsusLen: 0.145,
    toeLen: 0.078,
    femurAngle: 13.9,
    stifleAngle: 35.3,
    hockAngle: 26.7,
    toeAngle: 172.4,
  },
  curled: {
    femurLen: 0.26,
    tibiaLen: 0.073,
    metatarsusLen: 0.119,
    toeLen: 0.065,
    femurAngle: 15.6,
    stifleAngle: 41.0,
    hockAngle: 31.6,
    toeAngle: 170.9,
  },
};

const FRONT_DEFAULTS: Record<PoseId, FrontTuning> = {
  standing: { upperLen: 0.205, upperAngle: 84, lowerLen: 0.215, elbowAngle: 166 },
  sitting: { upperLen: 0.17, upperAngle: 80, lowerLen: 0.185, elbowAngle: 160 },
  stretch: { upperLen: 0.245, upperAngle: 60, lowerLen: 0.235, elbowAngle: 172 },
  loaf: { upperLen: 0.19, upperAngle: 82, lowerLen: 0.2, elbowAngle: 160 },
  curled: { upperLen: 0.19, upperAngle: 82, lowerLen: 0.2, elbowAngle: 160 },
};

export const hindDefaultsFor = (pose: PoseId): HindTuning => ({ ...HIND_DEFAULTS[pose] });
export const frontDefaultsFor = (pose: PoseId): FrontTuning => ({ ...FRONT_DEFAULTS[pose] });
export const legTuningDefaults = (pose: PoseId): LegTuning => ({
  hind: hindDefaultsFor(pose),
  front: frontDefaultsFor(pose),
});
export const mergeLegTuning = (pose: PoseId, override?: Partial<LegTuning>): LegTuning => {
  const base = legTuningDefaults(pose);
  if (!override) return base;
  return {
    hind: { ...base.hind, ...(override.hind ?? {}) },
    front: { ...base.front, ...(override.front ?? {}) },
  };
};

/* ------------------------------------------------------------------ */
/* Slider metadata for the UI (single source of truth)                 */
/* ------------------------------------------------------------------ */

export interface TuningSliderSpec {
  key: string; // dotted path into LegTuning, e.g. 'hind.femurLen'
  label: string;
  min: number;
  max: number;
  step: number;
  unit: 'cm' | '°';
}

export const HIND_SLIDERS: TuningSliderSpec[] = [
  { key: 'hind.femurLen', label: 'Femur length', min: 0.12, max: 0.55, step: 0.002, unit: 'cm' },
  { key: 'hind.tibiaLen', label: 'Tibia length', min: 0.06, max: 0.42, step: 0.002, unit: 'cm' },
  { key: 'hind.metatarsusLen', label: 'Metatarsus length', min: 0.04, max: 0.3, step: 0.002, unit: 'cm' },
  { key: 'hind.toeLen', label: 'Toe length', min: 0.02, max: 0.16, step: 0.002, unit: 'cm' },
  { key: 'hind.femurAngle', label: 'Femur angle', min: 0, max: 75, step: 0.5, unit: '°' },
  { key: 'hind.stifleAngle', label: 'Stifle angle', min: 15, max: 178, step: 0.5, unit: '°' },
  { key: 'hind.hockAngle', label: 'Hock angle', min: 15, max: 178, step: 0.5, unit: '°' },
  { key: 'hind.toeAngle', label: 'Toe angle', min: 90, max: 178, step: 0.5, unit: '°' },
];

export const FRONT_SLIDERS: TuningSliderSpec[] = [
  { key: 'front.upperLen', label: 'Upper leg length', min: 0.08, max: 0.4, step: 0.002, unit: 'cm' },
  { key: 'front.upperAngle', label: 'Upper leg angle', min: 30, max: 90, step: 0.5, unit: '°' },
  { key: 'front.lowerLen', label: 'Foreleg length', min: 0.08, max: 0.4, step: 0.002, unit: 'cm' },
  { key: 'front.elbowAngle', label: 'Elbow angle', min: 120, max: 178, step: 0.5, unit: '°' },
];
