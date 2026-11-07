/**
 * registry.ts — every animal in the app is an AnimalSpec. The UI and viewer
 * talk only to this interface, which is what lets us add species later
 * without touching the app shell.
 *
 * To add an animal:
 *   1. Create src/animal/<species>.ts exporting a build function.
 *   2. Create (or reuse) a coats module for its palette.
 *   3. Add its AnimalSpec here with `locked: false`.
 * See README.md → "Adding a new animal".
 */

import { buildKitten, type KittenBuild } from './kitten';
import type { CoatId } from './coats';
import { POSE_ORDER, type PoseId } from './profiles';
import type { LegTuning } from './tuning';

export interface AnimalBuildOptions {
  weight: number;
  pose: string;
  coat: string;
  /** Optional leg-tuning overrides (UI sliders). */
  tuning?: Partial<LegTuning>;
}

export interface AnimalSpec {
  id: string;
  name: string;
  tagline: string;
  locked: boolean;
  lockNote?: string;
  poses: readonly string[];
  coats: readonly string[];
  defaultPose: string;
  defaultCoat: string;
  build: (options: AnimalBuildOptions) => KittenBuild;
}

export const KITTEN_SPEC: AnimalSpec = {
  id: 'kitten',
  name: 'Kitten',
  tagline: 'Domestic short-hair, procedural',
  locked: false,
  poses: POSE_ORDER,
  coats: ['orangeTabby', 'silverTabby', 'cream', 'midnight', 'calico'] as CoatId[],
  defaultPose: 'standing',
  defaultCoat: 'orangeTabby',
  build: ({ weight, pose, coat, tuning }) =>
    buildKitten({ weight, pose: pose as PoseId, coat: coat as CoatId, tuning }),
};

export const ANIMALS: readonly AnimalSpec[] = [
  KITTEN_SPEC,
  {
    id: 'puppy',
    name: 'Puppy',
    tagline: 'Floppy ears, tail wag, heart attack',
    locked: true,
    lockNote: 'In the litter',
    poses: POSE_ORDER,
    coats: ['cream'],
    defaultPose: 'standing',
    defaultCoat: 'cream',
    build: KITTEN_SPEC.build, // placeholder until the puppy arrives
  },
  {
    id: 'bunny',
    name: 'Bunny',
    tagline: 'Zoomies contained, barely',
    locked: true,
    lockNote: 'In the litter',
    poses: POSE_ORDER,
    coats: ['cream'],
    defaultPose: 'standing',
    defaultCoat: 'cream',
    build: KITTEN_SPEC.build, // placeholder until the bunny arrives
  },
];
