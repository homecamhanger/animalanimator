/**
 * skeleton.ts — the rig behind the sculpture.
 *
 * A kitten is a skeleton of named bones, each carrying a radius (its "fat
 * distribution"). Poses solve the joint positions; weight morphs the radii
 * and sag. The skin is then polygonised as one continuous implicit surface
 * wrapped over every bone (see kitten.ts).
 *
 * Everything is solved in world units, floor at y = 0, facing +z.
 * The torso is a pair of side-by-side balls per row — the classic metaball
 * trick for width-without-height.
 */

import * as THREE from 'three';
import {
  BASE_SPINE,
  POSE_PARAMS,
  clamp,
  weightMorph,
  type PoseId,
} from './profiles';

/** Colour roles; resolved to actual shades by the coat at build time. */
export type BallColor =
  | 'fur'      // base coat
  | 'cream'    // chest blaze / muzzle / chin / belly lighten (kitten go-light)
  | 'sock'     // white paws
  | 'saddle'   // darker spine saddle + tail tip
  | 'earFur';  // solid base for ears (as they are thin)

export interface FieldBall {
  name: string;
  pos: THREE.Vector3;
  radius: number;
  color: BallColor;
  /** Arc-length-ish coordinate along the animal (0 = rump → ~1 = face, >1 limbs/tail).
   *  The stripe shader bands on this instead of world axes. */
  flow: number;
}

export interface SkeletonAnchors {
  headPos: THREE.Vector3;
  headMul: number;
  headBaseY: number;
  earDirs: Array<{ base: THREE.Vector3; dir: THREE.Vector3; side: 1 | -1 }>;
  tailTipWorld: THREE.Vector3;
}

export interface SolvedSkeleton {
  balls: FieldBall[];
  anchors: SkeletonAnchors;
  eyesOpen: boolean;
  earPerk: number;
}

export const BODY_SPAN = { rear: -0.545, front: 0.545 } as const;

interface SpineRow {
  /** Parametric position along the spine (0 rear → 1 neck). */
  t: number;
  /** Half spacing of the side balls, as a fraction of the row radius. */
  offsetFrac: number;
  /** Base radius before weight morph. */
  r: number;
  /** Vertical sag applied to both balls (and centre ball) in this row. */
  sag: number;
  /** Extra radius multiplier for the belly zone. */
  belly: boolean;
}

const TORSO_ROWS: SpineRow[] = [
  { t: 0.02, offsetFrac: 0.0, r: 0.148, sag: 0.0, belly: false }, // rump tip
  { t: 0.13, offsetFrac: 0.56, r: 0.205, sag: 0.005, belly: false }, // haunches
  { t: 0.3, offsetFrac: 0.5, r: 0.172, sag: 0.012, belly: false }, // waist
  { t: 0.47, offsetFrac: 0.47, r: 0.178, sag: 0.03, belly: true }, // mid belly
  { t: 0.66, offsetFrac: 0.48, r: 0.185, sag: 0.012, belly: false }, // chest
  { t: 0.87, offsetFrac: 0.27, r: 0.118, sag: 0.0, belly: false }, // shoulder → neck
];

export interface MorphScalars {
  widthMul: number;
  bottomMul: number;
  bellyDroop: number;
  cheekMul: number;
  chinMul: number;
  tailMul: number;
  headMul: number;
  haunchSpread: number;
  legMul: number;
  pawMul: number;
}

/** Solve bones for a pose at a given weight. Pure — unit-checkable. */
export function solveSkeleton(poseId: PoseId, weight: number): SolvedSkeleton {
  const morph = weightMorph(weight);
  const pose = POSE_PARAMS[poseId];
  const c = morph.chonk;
  const zScale = pose.scaleZ;
  const bones: FieldBall[] = [];
  const mz = (z: number) => z * zScale;

  const widthMul = morph.widthMul;
  const radiusMul = 0.8 + 0.2 * widthMul; // fat widens mostly sideways
  const bottomMul = morph.bottomMul;
  const droop = morph.bellyDroop;

  /* ------------------------------ Torso ---------------------------- */

  const spineOffset = (t: number) => pose.spine(t);

  // First pass: compute row centres, then ground the cat exactly.
  const rowData = TORSO_ROWS.map((row) => {
    const zRaw = BODY_SPAN.rear + row.t * (BODY_SPAN.front - BODY_SPAN.rear);
    const z = mz(zRaw);
    const ry = BASE_SPINE + spineOffset(row.t) + row.sag * 0.5 - droop * (row.belly ? 0.55 : 0.15);
    const rowRadius = row.r * radiusMul * (row.belly ? 1 + c * 0.22 : 1) * pose.scaleY;
    const offset = row.offsetFrac * rowRadius * widthMul * pose.scaleX;
    return { row, z, ry, rowRadius, offset };
  });

  // Include the sag (belly) ball in the grounding solve.
  const midRow = rowData[3];
  const sagBallRadius = 0.165 * bottomMul * pose.scaleY;
  const sagBallY = midRow.ry - droop;
  let minBottom = Infinity;
  for (const { ry, rowRadius } of rowData) {
    minBottom = Math.min(minBottom, ry - rowRadius);
  }
  minBottom = Math.min(minBottom, sagBallY - sagBallRadius);
  const shift = minBottom - pose.floorY;
  const groundY = (y: number) => y - shift;

  for (const { row, z, ry, rowRadius, offset } of rowData) {
    const y = groundY(ry);
    if (row.offsetFrac === 0) {
      bones.push({ name: 'spine_rump', pos: new THREE.Vector3(0, y, z), radius: rowRadius, color: 'fur', flow: 0 });
      continue;
    }
    bones.push({ name: `spine_${row.t.toFixed(2)}_l`, pos: new THREE.Vector3(-offset, y, z), radius: rowRadius, color: 'fur', flow: row.t });
    bones.push({ name: `spine_${row.t.toFixed(2)}_r`, pos: new THREE.Vector3(offset, y, z), radius: rowRadius, color: 'fur', flow: row.t });
    // Centre bridge ball — kills the double-sphere crease along the spine.
    bones.push({ name: `spine_${row.t.toFixed(2)}_c`, pos: new THREE.Vector3(0, y, z), radius: rowRadius * 0.82, color: 'fur', flow: row.t });
  }
  // Sagging belly core (the chonk engine) + cream belly lighten.
  bones.push({ name: 'belly_sag', pos: new THREE.Vector3(0, groundY(sagBallY), midRow.z), radius: sagBallRadius, color: 'fur', flow: 0.47 });
  bones.push({ name: 'belly_cream', pos: new THREE.Vector3(0, groundY(sagBallY - 0.02), midRow.z + 0.04), radius: sagBallRadius * 0.9, color: 'cream', flow: 0.47 });

  // Chest blaze — a soft cream ball nestled between the forelegs.
  const chest = rowData[4];
  bones.push({
    name: 'chest_blaze',
    pos: new THREE.Vector3(0, groundY(chest.ry + 0.02), chest.z),
    radius: 0.135 * radiusMul * pose.scaleY,
    color: 'cream',
    flow: 0.66,
  });

  /* ------------------------------ Neck & head ------------------------ */

  const neckY = groundY(BASE_SPINE + spineOffset(1) + 0.075);
  const neckZ = mz(0.565);
  bones.push({ name: 'neck_low', pos: new THREE.Vector3(0, neckY, neckZ), radius: 0.1 * radiusMul * pose.scaleY, color: 'fur', flow: 0.97 });

  const headZ = mz(0.565 + 0.075 + pose.headForward);
  const headBaseY = groundY(BASE_SPINE + spineOffset(1) + 0.27 - pose.headDrop * 0.55);
  const headMul = morph.headMul;
  const headCenter = new THREE.Vector3(0, headBaseY, headZ);
  // Head articulation: ears/muzzle are solved in the head-local frame, then
  // rotated into world. The headGroup in kitten.ts uses the same quaternion,
  // so accessories and implicit skin always agree.
  const headQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.headPitch, pose.headYaw, 0, 'YXZ'),
  );
  const local = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x * headMul, y * headMul, z * headMul).applyQuaternion(headQuat).add(headCenter);

  bones.push({ name: 'head_cranium', pos: headCenter.clone(), radius: 0.272 * headMul, color: 'fur', flow: 1.03 });
  bones.push({
    name: 'head_skull',
    pos: local(0, 0.055, -0.085),
    radius: 0.214 * headMul,
    color: 'fur',
    flow: 1.06,
  });
  // Cheek ruffs — chonk shows up in the face first.
  for (const side of [-1, 1] as const) {
    bones.push({
      name: `cheek_${side}`,
      pos: local(side * 0.124, -0.048, 0.075),
      radius: 0.14 * morph.cheekMul * headMul,
      color: 'fur',
      flow: 1.13,
    });
  }
  // Muzzle + chin (cream). The double chin is earning its keep.
  bones.push({
    name: 'muzzle',
    pos: local(0, -0.118, 0.208),
    radius: 0.13 * headMul,
    color: 'cream',
    flow: 1.17,
  });
  const chinRadius = 0.088 * morph.chinMul;
  if (chinRadius > 0.028) {
    bones.push({
      name: 'chin',
      pos: local(0, -0.185, 0.125),
      radius: chinRadius,
      color: 'cream',
      flow: 1.19,
    });
  }

  /* ------------------------------ Ears -------------------------------- */

  const earPerk = pose.earPerk;
  const earDirs: SkeletonAnchors['earDirs'] = [];
  for (const side of [-1, 1] as const) {
    const outward = 0.28 + (1 - earPerk) * 0.38;
    const back = 0.16 + (1 - earPerk) * 0.4;
    const dirLocal = new THREE.Vector3(side * outward, 1, -back).normalize();
    const baseLocal = new THREE.Vector3(side * 0.128, 0.215, -0.03);
    const base = local(baseLocal.x, baseLocal.y, baseLocal.z);
    const dir = dirLocal.clone().applyQuaternion(headQuat); // direction: ignore translation
    earDirs.push({ base, dir, side });
    const radii = [0.105, 0.072, 0.04];
    for (let k = 0; k < 3; k++) {
      const d = (k / 2) * 0.225 * headMul;
      bones.push({
        name: `ear_${side}_${k}`,
        pos: base.clone().add(dir.clone().multiplyScalar(d)),
        radius: radii[k] * headMul * (1 - (1 - earPerk) * 0.15),
        color: 'fur',
        flow: 1.24 + k * 0.07,
      });
    }
  }

  /* ------------------------------ Legs -------------------------------- */

  const legMul = morph.legMul;
  const pawMul = morph.pawMul;
  const shoulderX = clamp(0.148 * widthMul + 0.012, 0.115, 0.26);
  const hipX = clamp(rowData[1].offset + rowData[1].rowRadius * 0.55, 0.16, 0.38);
  const frontZ = mz(0.4);
  const bellyBottomFront = (() => {
    // approximate underside of the chest row at the foreleg z
    const chestRow = rowData[4];
    return groundY(chestRow.ry) - chestRow.rowRadius;
  })();

  const legSegments: Array<{ x: number; from: THREE.Vector3; to: THREE.Vector3; r1: number; r2: number; flow: [number, number]; tag: string }> = [];

  // Every leg is a TWO-BONE chain — upper bone and lower bone — solved with a
  // knee offset from the bisector in the y-z plane. Cat anatomy: front elbows
  // point back, hind stifles point forward. Ball chains subdivide each bone.
  const twoBone = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    bendZ: number,
    rA: number,
    rB: number,
    rC: number,
    flowA: [number, number],
    flowB: [number, number],
    tag: string,
  ) => {
    const unit = b.clone().sub(a).normalize();
    const perp = new THREE.Vector3(0, unit.z, -unit.y).normalize(); // ⊥ unit in the y–z plane
    const knee = a.clone().add(b).multiplyScalar(0.5).addScaledVector(perp, bendZ);
    legSegments.push({ x: a.x, from: a, to: knee, r1: rA, r2: rB, flow: flowA, tag });
    legSegments.push({ x: a.x, from: knee, to: b, r1: rB, r2: rC, flow: flowB, tag });
    legSegments.push({ x: a.x, from: knee, to: knee, r1: rB * 0.94, r2: rB * 0.94, flow: [(flowA[1] + flowB[0]) / 2, (flowA[1] + flowB[0]) / 2], tag: `${tag}_knee` });
    return knee;
  };

  if (pose.legsVisible) {
    for (const side of [-1, 1]) {
      const frontX = side * shoulderX;
      if (pose.frontLegAngle > 0.05) {
        // Play bow: forelegs reach forward; a soft forward elbow.
        const angle = pose.frontLegAngle;
        const shoulder = new THREE.Vector3(frontX, bellyBottomFront + 0.16, frontZ);
        const len = (shoulder.y - 0.055) / Math.cos(angle);
        const tip = new THREE.Vector3(
          frontX,
          shoulder.y - Math.cos(angle) * len,
          frontZ + Math.sin(angle) * len,
        );
        twoBone(shoulder, tip, 0.05, 0.1 * legMul, 0.074 * legMul, 0.058 * legMul, [1.32, 1.52], [1.52, 1.74], `front_${side}`);
      } else {
        // Standing / sitting: straight-ish column, elbow tucked slightly back.
        const shoulder = new THREE.Vector3(frontX, bellyBottomFront + 0.14, frontZ);
        const ankle = new THREE.Vector3(frontX, 0.065, frontZ + 0.012);
        twoBone(shoulder, ankle, -0.035, 0.1 * legMul, 0.073 * legMul, 0.057 * legMul, [1.32, 1.52], [1.52, 1.74], `front_${side}`);
      }
      // Hindquarter: thigh ball at the hip, then a thigh + shin two-bone chain.
      const hipRow = rowData[1];
      const haunchY = clamp(groundY(hipRow.ry) - hipRow.rowRadius + 0.135, 0.155, 0.4);
      const hip = new THREE.Vector3(side * hipX, haunchY + (poseId === 'sitting' ? -0.02 : 0), mz(-0.27));
      if (poseId === 'sitting') {
        // Classic sitting fold as a real two-bone chain: thigh down-forward,
        // then the shin lies along the floor with the paw pushed forward.
        const stifle = new THREE.Vector3(side * hipX * 1.02, Math.max(0.085, hip.y - 0.035), mz(-0.03));
        const paw = new THREE.Vector3(side * hipX * 0.92, 0.062, mz(0.26));
        legSegments.push({ x: side * hipX, from: hip, to: stifle, r1: 0.095 * legMul, r2: 0.075 * legMul, flow: [1.32, 1.52], tag: `hind_${side}_thigh` });
        legSegments.push({ x: side * hipX, from: stifle, to: paw, r1: 0.072 * legMul, r2: 0.06 * legMul, flow: [1.52, 1.74], tag: `hind_${side}_shin` });
        legSegments.push({ x: side * hipX, from: stifle, to: stifle, r1: 0.073 * legMul, r2: 0.073 * legMul, flow: [1.52, 1.52], tag: `hind_${side}_knee` });
      } else {
        const hock = new THREE.Vector3(side * hipX * 0.78, 0.068, mz(0.02));
        twoBone(hip, hock, 0.085, 0.118 * legMul * morph.haunchSpread, 0.078 * legMul, 0.057 * legMul, [1.3, 1.5], [1.5, 1.74], `hind_${side}`);
      }
      // Haunch muscle ball (the round thigh cats sit on).
      bones.push({
        name: `thigh_${side}`,
        pos: hip.clone().add(new THREE.Vector3(side * 0.01, 0.035, -0.02)),
        radius: 0.145 * legMul * morph.haunchSpread * pose.scaleY,
        color: 'fur',
        flow: 1.28,
      });
    }
  }

  for (const seg of legSegments) {
    const dir = seg.to.clone().sub(seg.from);
    const length = dir.length();
    if (length < 1e-4) {
      // Knee cap ball — a single sphere, no chain needed.
      bones.push({ name: seg.tag, pos: seg.from.clone(), radius: seg.r1, color: 'fur', flow: seg.flow[0] });
      continue;
    }
    const meanR = (seg.r1 + seg.r2) / 2;
    const steps = Math.max(2, Math.ceil(length / (meanR * 0.82)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const radius = seg.r1 + (seg.r2 - seg.r1) * t;
      bones.push({
        name: `leg_${seg.tag}_${i}`,
        pos: seg.from.clone().lerp(seg.to, t),
        radius,
        color: 'fur',
        flow: seg.flow[0] + (seg.flow[1] - seg.flow[0]) * t,
      });
    }
  }

  /* ------------------------------ Paws -------------------------------- */

  const pawBalls: Array<{ x: number; z: number }> = [];
  if (pose.legsVisible) {
    for (const side of [-1, 1]) {
      const x = side * shoulderX;
      if (pose.frontLegAngle > 0.05) {
        const angle = pose.frontLegAngle;
        const shoulder = new THREE.Vector3(x, bellyBottomFront + 0.16, frontZ);
        const len = (shoulder.y - 0.055) / Math.cos(angle);
        pawBalls.push({ x, z: frontZ + Math.sin(angle) * len });
      } else {
        pawBalls.push({ x, z: frontZ + 0.035 });
      }
      pawBalls.push({ x: side * hipX * 0.78, z: mz(poseId === 'sitting' ? 0.29 : 0.085) });
    }
  } else {
    // Loaf / curled: just the white tips peeking out from under the chest.
    for (const side of [-1, 1]) {
      pawBalls.push({ x: side * 0.118, z: mz(0.475) });
    }
  }
  for (const [i, paw] of pawBalls.entries()) {
    const pawRadius = 0.095 * pawMul;
    const sockRadius = 0.071 * pawMul;
    bones.push({ name: `paw_${i}`, pos: new THREE.Vector3(paw.x, pawRadius - 0.004, paw.z), radius: pawRadius, color: 'sock', flow: 1.95 });
    // Sock climbs a little way up the pastern for the classic look.
    bones.push({ name: `sock_${i}`, pos: new THREE.Vector3(paw.x, pawRadius - 0.004 + 0.038, paw.z - 0.008), radius: sockRadius, color: 'sock', flow: 1.9 });
  }

  /* ------------------------------ Tail --------------------------------- */

  const rear = rowData[0];
  const tailBase = new THREE.Vector3(0, groundY(rear.ry + rear.rowRadius * 0.42), mz(-0.5));
  const tailMul = morph.tailMul;
  const tailPointSets: Record<PoseId, Array<[number, number, number]>> = {
    standing: [
      [tailBase.x, tailBase.y, tailBase.z],
      [0.02, tailBase.y + 0.19, mz(-0.7)],
      [0.085, tailBase.y + 0.32, mz(-0.57)],
      [0.165, tailBase.y + 0.35, mz(-0.37)],
    ],
    sitting: [
      [0.07, tailBase.y, tailBase.z],
      [0.34, Math.max(0.1, tailBase.y * 0.62), mz(-0.4)],
      [0.45, 0.095, mz(-0.02)],
      [0.41, 0.093, mz(0.3)],
      [0.19, 0.092, mz(0.47)],
    ],
    loaf: [
      [0.08, tailBase.y, tailBase.z],
      [0.36, 0.105, mz(-0.2)],
      [0.44, 0.095, mz(0.17)],
      [0.26, 0.092, mz(0.44)],
    ],
    stretch: [
      [0, tailBase.y, tailBase.z],
      [0.02, tailBase.y + 0.2, mz(-0.71)],
      [0.055, tailBase.y + 0.36, mz(-0.7)],
      [0.125, tailBase.y + 0.46, mz(-0.55)],
    ],
    curled: [
      [-0.06, tailBase.y, tailBase.z],
      [-0.36, 0.095, mz(-0.26)],
      [-0.44, 0.093, mz(0.1)],
      [-0.27, 0.091, mz(0.4)],
      [0.09, 0.091, mz(0.44)],
      [0.29, 0.1, mz(0.3)],
    ],
  };
  const tailCurve = new THREE.CatmullRomCurve3(
    tailPointSets[poseId].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  const tailSamples = 14;
  for (let i = 0; i <= tailSamples; i++) {
    const t = i / tailSamples;
    const p = tailCurve.getPointAt(t);
    const radius = (0.066 - 0.028 * Math.pow(t, 0.85)) * tailMul;
    bones.push({
      name: `tail_${i}`,
      pos: p,
      radius: Math.max(0.03, radius),
      color: t > 0.82 ? 'saddle' : 'fur',
      flow: 2.15 + t * 0.75,
    });
  }

  /* ------------------------------ Anchors ------------------------------ */

  const anchors: SkeletonAnchors = {
    headPos: headCenter,
    headMul,
    headBaseY,
    earDirs,
    tailTipWorld: tailCurve.getPointAt(1),
  };

  return { balls: bones, anchors, eyesOpen: pose.eyesOpen, earPerk: pose.earPerk };
}
