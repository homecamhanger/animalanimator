/**
 * skinRig.ts — binds the anatomy skeleton to the SDF-solved poses.
 *
 * The SDF stays the thing that guarantees the fur grows correctly (ground
 * contact, planting, art-directed silhouettes), but its joint positions are
 * already exact — so instead of authoring bone rotations by hand, each bone
 * is RE-TARGETED by registering it to the solved chains:
 *
 *   solved bones (spine ridge, limb chains, head, tail)
 *     → endpoints/frames taken from `solveSkeleton(pose, weight)`
 *   unsolved bones (ribs, sternum, girdles, phalanges, tarsals…)
 *     → inherit their anatomical parent's delta verbatim (rigid frame copy)
 *
 * Every bone ends up with a world-space delta transform D mapping its rest
 * pose onto the posed body:  v' = D · v  (rotation about the rest pivot,
 * translation included). Skin vertices blend the per-bone deltas with the
 * top-4 influences from skinWeights.ts via dual quaternions (see
 * skinning.ts) — coincident verts are summed identically, so the unindexed
 * shell never cracks.
 *
 * Frame discipline: the fur mesh the viewer deforms is always built at the
 * CURRENT weight in the standing pose; deltas therefore map standing@w →
 * pose@w and are cached per (pose, weight). The anatomy's own rest positions
 * (weight 1.0 registered) are used only to pick curve parameters and parent
 * frames — never mixed into posed translations at w ≠ 1 in a way that would
 * compound; any residual is sub-centimetre (the wave-1 weight registration
 * carries the same caveat).
 */
import * as THREE from 'three';
import { buildAnatomy, SKULL_BASE, type AnatomicalBone } from './anatomy';
import { solveSkeleton, tailControlPoints, type FieldPrimitive } from './skeleton';
import { POSE_PARAMS, type PoseId } from './profiles';
import {
  makePivotDelta,
  shortestArcRotation,
  type BoneDelta,
} from './skinning';

interface Landmarks {
  /** Sacrum → … → neck_low → skullBase. Both weight-matched solves. */
  spineCurve: THREE.CatmullRomCurve3;
  /** Tail base → tip. */
  tailCurve: THREE.CatmullRomCurve3;
  headCenter: THREE.Vector3;
  /** Head articulation in the pose frame (identity for standing). */
  headQuat: THREE.Quaternion;
  /** Solved limb-chain segments, keyed by primitive name (`leg_front_1_upper`, …). */
  segments: Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>;
}

const REST_POSE: PoseId = 'standing';

const LEG_SEGMENT_NAMES = [
  'leg_front_1_upper', 'leg_front_1_lowerA', 'leg_front_1_lowerB',
  'leg_front_-1_upper', 'leg_front_-1_lowerA', 'leg_front_-1_lowerB',
  'leg_hind_1_femur', 'leg_hind_1_tibia', 'leg_hind_1_metatarsus', 'leg_hind_1_metatarsusB', 'leg_hind_1_phalanx',
  'leg_hind_-1_femur', 'leg_hind_-1_tibia', 'leg_hind_-1_metatarsus', 'leg_hind_-1_metatarsusB', 'leg_hind_-1_phalanx',
] as const;

function solveLandmarks(poseId: PoseId, weight: number, rest: Landmarks): Landmarks {
  const solved = solveSkeleton(poseId, weight);
  const pose = POSE_PARAMS[poseId];
  const ball = (name: string): FieldPrimitive => {
    const found = solved.balls.find((entry) => entry.name === name);
    if (!found) throw new Error(`skinRig: missing primitive '${name}' in pose '${poseId}'`);
    return found;
  };

  const ridge = [
    ball('spine_rump').pos,
    ball('spine_0.13_c').pos,
    ball('spine_0.30_c').pos,
    ball('spine_0.47_c').pos,
    ball('spine_0.66_c').pos,
    ball('spine_0.87_c').pos,
  ].map((p) => p.clone());
  const neckLow = ball('neck_low').pos.clone();

  // Head frame — same construction as kitten.ts / skeleton.ts.
  const headQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.headPitch, pose.headYaw, 0, 'YXZ'),
  );
  const headCenter = solved.anchors.headPos.clone();

  // The atlanto-occipital joint rides the head rigidly — rebuild it in the
  // pose frame from the rest offset and the relative head rotation.
  const restOffset = new THREE.Vector3(...SKULL_BASE).sub(rest.headCenter);
  const rel = headQuat.clone().multiply(rest.headQuat.clone().invert());
  const skullBase = restOffset.applyQuaternion(rel).add(headCenter);

  const spineCurve = new THREE.CatmullRomCurve3([...ridge, neckLow, skullBase], false, 'centripetal');

  const tailBase = ball('tail_0').a.clone();
  const tailCurve = new THREE.CatmullRomCurve3(
    tailControlPoints(poseId, tailBase, pose.scaleZ).map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );

  const segments = new Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>();
  for (const name of LEG_SEGMENT_NAMES) {
    const seg = ball(name);
    segments.set(name, { a: seg.a.clone(), b: seg.b.clone() });
  }

  return { spineCurve, tailCurve, headCenter, headQuat, segments };
}

const restCache = new Map<number, Landmarks>();

/** Rest = the standing solve at the given weight. Cached. */
export function getRestLandmarks(weight: number): Landmarks {
  const key = Math.round(weight * 10000) / 10000;
  const hit = restCache.get(key);
  if (hit) return hit;
  const standIn = solveSkeleton(REST_POSE, weight);
  const ridge = [
    ballPos(standIn, 'spine_rump'),
    ballPos(standIn, 'spine_0.13_c'),
    ballPos(standIn, 'spine_0.30_c'),
    ballPos(standIn, 'spine_0.47_c'),
    ballPos(standIn, 'spine_0.66_c'),
    ballPos(standIn, 'spine_0.87_c'),
  ];
  const headQuat = new THREE.Quaternion(); // standing = headPitch 0, yaw 0
  const headCenter = standIn.anchors.headPos.clone();
  const skullBase = new THREE.Vector3(...SKULL_BASE);
  const neckLow = ballPos(standIn, 'neck_low');
  const spineCurve = new THREE.CatmullRomCurve3([...ridge, neckLow, skullBase], false, 'centripetal');
  const tailBase = ballPos(standIn, 'tail_0', true);
  const pose = POSE_PARAMS[REST_POSE];
  const tailCurve = new THREE.CatmullRomCurve3(
    tailControlPoints(REST_POSE, tailBase, pose.scaleZ).map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  const segments = new Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>();
  for (const name of LEG_SEGMENT_NAMES) {
    const seg = standIn.balls.find((b) => b.name === name);
    if (!seg) throw new Error(`skinRig: missing primitive '${name}' in rest solve`);
    segments.set(name, { a: seg.a.clone(), b: seg.b.clone() });
  }
  const rest: Landmarks = { spineCurve, tailCurve, headCenter, headQuat, segments };
  restCache.set(key, rest);
  return rest;
}

function ballPos(solved: ReturnType<typeof solveSkeleton>, name: string, useA = false): THREE.Vector3 {
  const found = solved.balls.find((b) => b.name === name);
  if (!found) throw new Error(`skinRig: missing primitive '${name}'`);
  return (useA ? found.a : found.pos).clone();
}

/** Ternary-search the arc-length parameter t on `curve` closest to `target`. */
function closestCurveT(curve: THREE.CatmullRomCurve3, target: THREE.Vector3, samples = 96): number {
  const p = new THREE.Vector3();
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, p);
    const d = p.distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // Refine within the bracketing neighbours.
  const step = 1 / samples;
  let lo = Math.max(0, bestT - step);
  let hi = Math.min(1, bestT + step);
  for (let iter = 0; iter < 24; iter++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    curve.getPointAt(m1, p);
    const d1 = p.distanceToSquared(target);
    curve.getPointAt(m2, p);
    const d2 = p.distanceToSquared(target);
    if (d1 < d2) hi = m2; else lo = m1;
  }
  return (lo + hi) / 2;
}

type Channel =
  | { kind: 'spine'; t: number }
  | { kind: 'head' }
  | { kind: 'tail'; t: number }
  | { kind: 'segment'; name: string };

/** Assign the direct (non-inherited) deformation channel for a bone id, or null for parent-inherit. */
function channelForBone(bone: AnatomicalBone, rest: Landmarks): Channel | null {
  const id = bone.id;
  if (bone.region === 'skull') return { kind: 'head' };
  if (id === 'sacrum' || /^[ltc]_\d+$/.test(id)) {
    const mid = midPoint(bone);
    return { kind: 'spine', t: closestCurveT(rest.spineCurve, mid) };
  }
  if (/^cd_\d+$/.test(id)) {
    const mid = midPoint(bone);
    return { kind: 'tail', t: closestCurveT(rest.tailCurve, mid) };
  }
  const side = id.endsWith('_l') ? '1' : id.endsWith('_r') ? '-1' : null;
  if (side) {
    if (id.startsWith('humerus_')) return { kind: 'segment', name: `leg_front_${side}_upper` };
    if (/^(radius|ulna)_/.test(id)) return { kind: 'segment', name: `leg_front_${side}_lowerB` };
    // Paw rides the wrist segment — the SDF has no toe articulation (yet).
    if (/^(carpal_|mc_|ph_)/.test(id)) return { kind: 'segment', name: `leg_front_${side}_lowerB` };
    if (id.startsWith('femur_')) return { kind: 'segment', name: `leg_hind_${side}_femur` };
    if (/^(tibia|fibula|patella)_/.test(id)) return { kind: 'segment', name: `leg_hind_${side}_tibia` };
    if (/^iph_/.test(id)) return { kind: 'segment', name: `leg_hind_${side}_phalanx` };
    if (/^(calcaneus_|tarsal_|mt_)/.test(id)) return { kind: 'segment', name: `leg_hind_${side}_metatarsus` };
  }
  return null; // ribs, sternum, girdle, scapula — parent-inherit
}

function midPoint(bone: AnatomicalBone): THREE.Vector3 {
  return new THREE.Vector3(
    (bone.from[0] + bone.to[0]) / 2,
    (bone.from[1] + bone.to[1]) / 2,
    (bone.from[2] + bone.to[2]) / 2,
  );
}

export interface PoseDeformation {
  /** One delta per bone, in buildAnatomy() order (matches computeSkinWeights(bones)). */
  deltas: BoneDelta[];
  /** Head-frame delta — used by the viewer to re-anchor eyes/ears accessories. */
  head: BoneDelta;
}

const poseCache = new Map<string, PoseDeformation>();

/**
 * Solve every bone's world-space delta for (poseId, weight) — cached.
 * standing is the identity for the pose axis (deltas ≈ 0 by construction).
 */
export function getPoseDeformation(poseId: PoseId, weight: number): PoseDeformation {
  const key = `${poseId}:${Math.round(weight * 10000) / 10000}`;
  const hit = poseCache.get(key);
  if (hit) return hit;

  const rest = getRestLandmarks(weight);
  const pose = solveLandmarks(poseId, weight, rest);
  const bones = buildAnatomy();

  const deltas: BoneDelta[] = new Array(bones.length);
  const channels = bones.map((bone) => channelForBone(bone, rest));

  const tVec = new THREE.Vector3();
  const pRest = new THREE.Vector3();
  const pPose = new THREE.Vector3();
  const tangentRest = new THREE.Vector3();
  const tangentPose = new THREE.Vector3();

  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const channel = channels[i];
    let delta: BoneDelta;

    if (channel?.kind === 'spine' || channel?.kind === 'tail') {
      const restCurve = channel.kind === 'spine' ? rest.spineCurve : rest.tailCurve;
      const poseCurve = channel.kind === 'spine' ? pose.spineCurve : pose.tailCurve;
      const t = channel.t;
      restCurve.getPointAt(t, pRest);
      poseCurve.getPointAt(t, pPose);
      restCurve.getTangentAt(t, tangentRest);
      poseCurve.getTangentAt(t, tangentPose);
      const rotation = shortestArcRotation(tangentRest, tangentPose);
      delta = makePivotDelta(pRest, rotation, pPose);
    } else if (channel?.kind === 'segment') {
      const aRest = rest.segments.get(channel.name);
      const aPose = pose.segments.get(channel.name);
      if (!aRest || !aPose) {
        throw new Error(`skinRig: segment '${channel.name}' missing for pose '${poseId}'`);
      }
      const dirRest = tVec.copy(aRest.b).sub(aRest.a);
      const dirPose = new THREE.Vector3().copy(aPose.b).sub(aPose.a);
      const rotation = shortestArcRotation(dirRest, dirPose);
      delta = makePivotDelta(aRest.a, rotation, aPose.a);
    } else if (channel?.kind === 'head') {
      const rel = pose.headQuat.clone().multiply(rest.headQuat.clone().invert());
      delta = makePivotDelta(rest.headCenter, rel, pose.headCenter);
    } else {
      // Parent-inherit: rigid frame copy of the already-resolved parent.
      const parentId = bone.parent;
      const parentIndex = parentId ? bones.findIndex((b) => b.id === parentId) : -1;
      if (parentIndex < 0 || !deltas[parentIndex]) {
        throw new Error(`skinRig: bone '${bone.id}' resolved before its parent '${parentId ?? '∅'}' — anatomy order must stay topological`);
      }
      delta = deltas[parentIndex];
    }

    deltas[i] = delta;
  }

  const rel = pose.headQuat.clone().multiply(rest.headQuat.clone().invert());
  const head = makePivotDelta(rest.headCenter, rel, pose.headCenter);

  const result: PoseDeformation = { deltas, head };
  poseCache.set(key, result);
  return result;
}
