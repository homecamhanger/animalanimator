/**
 * profiles.ts — pure math describing the animal's body silhouette.
 *
 * Kept free of Three.js so it can be sanity-checked from the command line
 * (see scripts/check-profiles.ts). The kitten builder consumes these curves.
 *
 * t runs from 0 (tail base / rear) to 1 (neck / front).
 */

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Gaussian bump helper used by the pose spine curves. */
export const gauss = (t: number, mu: number, sigma: number): number =>
  Math.exp(-((t - mu) * (t - mu)) / (2 * sigma * sigma));

/** Weight morph factors derived from the scalar body weight. */
export interface WeightMorph {
  /** Slider-normalised weight, 1 = adult average. */
  weight: number;
  /** Signed distance from 1 (e.g. -0.35 .. +0.7). */
  chonk: number;
  widthMul: number;
  bottomMul: number;
  /** Extra absolute drop of the belly centre-line, in world units. */
  bellyDroop: number;
  cheekMul: number;
  headMul: number;
  legMul: number;
  pawMul: number;
  tailMul: number;
  chinMul: number;
  /** Width of the hips relative to the chest — chonky cats spread sideways. */
  haunchSpread: number;
}

export function weightMorph(weightInput: number): WeightMorph {
  const weight = clamp(weightInput, 0.65, 1.7);
  const c = weight - 1;
  return {
    weight,
    chonk: c,
    widthMul: 1 + c * 0.42,
    bottomMul: 1 + c * 0.38,
    bellyDroop: Math.max(0, c) * 0.075,
    cheekMul: 1 + c * 0.55,
    headMul: 1 + c * 0.13,
    legMul: 1 + c * 0.3,
    pawMul: 1 + c * 0.2,
    tailMul: 1 + c * 0.4,
    // A "double chin" appears once a kitten crosses into chunky territory.
    chinMul: 0.55 + Math.max(0, c) * 1.75,
    haunchSpread: 1 + c * 0.35,
  };
}

/** Body Condition Score (1–9, like a vet chart) + friendly label. */
export function bodyCondition(weightInput: number): { bcs: number; label: string; ideal: boolean } {
  const weight = clamp(weightInput, 0.65, 1.7);
  const bcs = clamp(Math.round(1 + ((weight - 0.65) / (1.7 - 0.65)) * 8), 1, 9);
  let label: string;
  let ideal = false;
  if (bcs <= 2) label = 'very underweight';
  else if (bcs === 3) label = 'underweight';
  else if (bcs <= 5) {
    label = 'ideal';
    ideal = true;
  } else if (bcs <= 7) label = 'overweight';
  else label = 'obese';
  return { bcs, label, ideal };
}

/** Cute fake scale reading for the UI. */
export function fakeKilograms(weightInput: number): number {
  const weight = clamp(weightInput, 0.65, 1.7);
  return 1.6 + ((weight - 0.65) / (1.7 - 0.65)) * (7.2 - 1.6);
}

export type PoseId = 'standing' | 'sitting' | 'loaf' | 'stretch' | 'curled';

/** Per-pose spine shaping & body post changes. */
export interface PoseParams {
  id: PoseId;
  label: string;
  tagline: string;
  /** Vertical offset of the spine at t (added to the base spine height). */
  spine: (t: number) => number;
  /** Lateral squash of the whole torso cross-section. */
  scaleX: number;
  /** Vertical squash of the torso cross-section. */
  scaleY: number;
  /** Lengthwise squash of the torso (1 = full length). */
  scaleZ: number;
  /**
   * Target height of the lowest point of the belly above the floor, in world
   * units. The builder shifts the whole body so this lands exactly — that is
   * what keeps every weight from floating or sinking through the floor.
   */
  floorY: number;
  headPitch: number;
  headYaw: number;
  headDrop: number;
  headForward: number;
  earPerk: number;
  eyesOpen: boolean;
  legsVisible: boolean;
  pawTipsOnly: boolean;
  frontLegAngle: number; // radians, + leans the paw forward
}
export const BASE_SPINE = 0.47;

export const POSE_PARAMS: Record<PoseId, PoseParams> = {
  standing: {
    id: 'standing',
    label: 'Standing',
    tagline: 'Tail up, all paws down, ready to sprint',
    spine: () => 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    floorY: 0.335,
    headPitch: 0,
    headYaw: 0,
    headDrop: 0,
    headForward: 0,
    earPerk: 1,
    eyesOpen: true,
    legsVisible: true,
    pawTipsOnly: false,
    frontLegAngle: 0,
  },
  sitting: {
    id: 'sitting',
    label: 'Sitting',
    tagline: 'Haunches down, chest up, judging you',
    spine: (t) => 0.1 * t * t - 0.24 * gauss(t, 0.02, 0.28),
    scaleX: 1.04,
    scaleY: 0.96,
    scaleZ: 1,
    floorY: 0.03,
    headPitch: -0.14,
    headYaw: 0,
    headDrop: 0.05,
    headForward: 0.02,
    earPerk: 1,
    eyesOpen: true,
    legsVisible: true,
    pawTipsOnly: false,
    frontLegAngle: 0,
  },
  loaf: {
    id: 'loaf',
    label: 'Loaf',
    tagline: 'Fully settled, paws tucked, do not disturb',
    spine: () => 0,
    scaleX: 1.08,
    scaleY: 0.8,
    scaleZ: 0.8,
    floorY: 0.025,
    headPitch: -0.06,
    headYaw: 0,
    headDrop: 0.02,
    headForward: 0.04,
    earPerk: 0.8,
    eyesOpen: true,
    legsVisible: false,
    pawTipsOnly: true,
    frontLegAngle: 0,
  },
  stretch: {
    id: 'stretch',
    label: 'Play bow',
    tagline: 'Bum up, chest down, the universal "come play"',
    spine: (t) => 0.17 - 0.4 * t + 0.05 * Math.sin(Math.PI * t),
    scaleX: 0.98,
    scaleY: 0.92,
    scaleZ: 1,
    floorY: 0.04,
    headPitch: 0.42,
    headYaw: 0,
    headDrop: 0.02,
    headForward: 0.13,
    earPerk: 1,
    eyesOpen: true,
    legsVisible: true,
    pawTipsOnly: false,
    frontLegAngle: 1.05,
  },
  curled: {
    id: 'curled',
    label: 'Curled up',
    tagline: 'A furry comma asleep on the warm laundry',
    spine: () => 0,
    scaleX: 1.28,
    scaleY: 0.7,
    scaleZ: 0.66,
    floorY: 0.02,
    headPitch: 0.55,
    headYaw: -0.5,
    headDrop: 0.14,
    headForward: 0.02,
    earPerk: 0.55,
    eyesOpen: false,
    legsVisible: false,
    pawTipsOnly: true,
    frontLegAngle: 0,
  },
};

export const POSE_ORDER: PoseId[] = ['standing', 'sitting', 'loaf', 'stretch', 'curled'];
