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
import { mergeLegTuning, type LegTuning } from './tuning';

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
  /** True for negative-strength balls that CARVE the field (eye sockets, pinna scoops). */
  dent?: boolean;
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
export function solveSkeleton(poseId: PoseId, weight: number, tuningOverride?: Partial<LegTuning>): SolvedSkeleton {
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
    // Triangular pinna: a flat plate of overlapping balls, broad at the base
    // and tapering to the tip, thin along the face-forward axis. The ball
    // union reads as a wedge — not a string of beads — and the plate plane
    // always contains the ear axis and the side axis.
    const dirN = dir.clone().normalize();
    const faceAxis = new THREE.Vector3(0, 0.15, 1).applyQuaternion(headQuat).normalize();
    const plateSide = new THREE.Vector3().crossVectors(dirN, faceAxis).normalize();
    const perkThin = 1 - (1 - earPerk) * 0.18;
    const earPlate: Array<{ d: number; w: number; r: number }> = [
      { d: 0.0, w: 0.088, r: 0.055 },
      { d: 0.0, w: -0.088, r: 0.055 },
      { d: 0.0, w: 0.0, r: 0.064 },
      { d: 0.048, w: 0.062, r: 0.051 },
      { d: 0.048, w: -0.062, r: 0.051 },
      { d: 0.048, w: 0.0, r: 0.054 },
      { d: 0.096, w: 0.032, r: 0.046 },
      { d: 0.096, w: -0.032, r: 0.046 },
      { d: 0.096, w: 0.0, r: 0.046 },
      { d: 0.15, w: 0.0, r: 0.038 },
    ];
    for (const { d, w, r } of earPlate) {
      bones.push({
        name: `ear_${side}_${d.toFixed(3)}_${w >= 0 ? 'a' : 'b'}${w === 0 ? 'c' : ''}`,
        pos: base
          .clone()
          .addScaledVector(dirN, d * headMul)
          .addScaledVector(plateSide, w * headMul),
        radius: r * headMul * perkThin,
        color: 'fur',
        flow: 1.24 + d * 2.0,
      });
    }
  }

  /* ---------------- Head dents — carved after the ears are known ------- */
  // Eye sockets: anti-balls sitting just proud of the cranium surface, so the
  // MC field dips into a dish around each eye. The eyes themselves are placed
  // against the socketless surface, so they nestle into the dishes.
  for (const side of [-1, 1]) {
    bones.push({
      name: `eye_socket_${side}`,
      pos: local(side * 0.135, 0.06, 0.235),
      radius: 0.088 * headMul,
      color: 'fur',
      flow: 1.05,
      dent: true,
    });
  }
  // Pinna scoops: one anti-ball per ear, on the ear's front face (face-forward
  // normal with the ear-axis component removed), so each ear grows a concave
  // dish the inner-ear lozenge can sit in.
  const faceForward = new THREE.Vector3(0, 0.15, 1).applyQuaternion(headQuat).normalize();
  for (const { base, dir } of earDirs) {
    const along = dir.clone().normalize();
    const pinnaNormal = faceForward.clone().addScaledVector(along, -faceForward.dot(along)).normalize();
    const mid = base.clone().addScaledVector(along, 0.075 * headMul);
    bones.push({
      name: 'ear_scoop',
      pos: mid.addScaledVector(pinnaNormal, 0.02),
      radius: 0.075 * headMul,
      color: 'fur',
      flow: 1.3,
      dent: true,
    });
  }

  /* ------------------------------ Legs -------------------------------- */

  const legMul = morph.legMul;
  const shoulderX = clamp(0.148 * widthMul + 0.012, 0.115, 0.26);
  const hipX = clamp(rowData[1].offset + rowData[1].rowRadius * 0.55, 0.16, 0.38);
  // The hip JOINT attaches close to the midline — a cat's pelvis is only
  // ~6 cm across, so the femur heads ride nearly on the spine while the
  // haunch mass spreads laterally around them.
  const hipJointX = clamp(hipX * 0.34, 0.048, 0.13);
  const frontZ = mz(0.4);
  const bellyBottomFront = (() => {
    // approximate underside of the chest row at the foreleg z
    const chestRow = rowData[4];
    return groundY(chestRow.ry) - chestRow.rowRadius;
  })();

  const legSegments: Array<{ x: number; from: THREE.Vector3; to: THREE.Vector3; r1: number; r2: number; flow: [number, number]; tag: string; color?: BallColor }> = [];

  // Every leg is a TWO-BONE chain — upper bone and lower bone — solved with a
  // knee offset from the bisector in the y-z plane. Cat anatomy: front elbows
  // point back, hind stifles point forward. Ball chains subdivide each bone.
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const tuning = mergeLegTuning(poseId, tuningOverride);
  // Chains are pinned vertically to their built-in endpoint heights (the
  // poses were art-directed around these contacts) so slider tweaks keep
  // BOTH paw pairs working for the floor instead of jack-knifing the cat.
  // floorLift in kitten.ts remains the absolute no-penetration backstop.
  // Shifts are clamped — past ±14 cm the pose genuinely can't stay planted.
  const MAX_CHAIN_SHIFT = 0.14;
  const HIND_PLANT_Y: Record<PoseId, number> = {
    standing: 0.0235,
    sitting: 0.0221,
    stretch: -0.0228,
    loaf: 0.0226,
    curled: 0.0238,
  };
  const FRONT_PLANT_Y: Record<PoseId, number> = {
    standing: 0.065,
    sitting: 0.065,
    stretch: -0.1777,
    loaf: -0.1993,
    curled: -0.2063,
  };
  // The MTP (toe) joint's fold direction varies by anatomy: weight-bearing
  // poses bend it upward (negative), the tucked poses wrap it downward.
  const TOE_TURN_SIGN: Record<PoseId, 1 | -1> = {
    standing: -1,
    sitting: -1,
    stretch: -1,
    loaf: 1,
    curled: 1,
  };
  const toeTurnSign = TOE_TURN_SIGN[poseId];
  // Legs exist in EVERY pose — loaf/curled fold them under the body instead
  // of deleting them, so the haunches keep their volume.
  for (const side of [-1, 1]) {
    {
      const frontX = side * shoulderX;
      // FRONT — free two-bone chain from the shoulder anchor. floorLift
      // grounds the build on the lowest point, so extreme slider values
      // can't push the cat through the floor.
      const front = tuning.front;
      const shoulder = new THREE.Vector3(frontX, bellyBottomFront + (pose.frontLegAngle > 0.05 ? 0.16 : 0.14), frontZ);
      const upperDir = new THREE.Vector3(0, -Math.sin(rad(front.upperAngle)), Math.cos(rad(front.upperAngle)));
      const lowerDir = upperDir.clone().applyAxisAngle(X_AXIS, rad(180 - front.elbowAngle));
      const composeFront = (origin: THREE.Vector3) => {
        const elbow = origin.clone().addScaledVector(upperDir, front.upperLen);
        const wrist = elbow.clone().addScaledVector(lowerDir, front.lowerLen);
        return { elbow, wrist };
      };
      const frontDy = clamp(FRONT_PLANT_Y[poseId] - composeFront(shoulder).wrist.y, -MAX_CHAIN_SHIFT, MAX_CHAIN_SHIFT);
      const frontOrigin = shoulder.clone().add(new THREE.Vector3(0, frontDy, 0));
      const { elbow, wrist } = composeFront(frontOrigin);
      // Cats carry their socks on the lower foreleg — split the forearm so
      // the toe/pastern zone goes white, following the limb exactly.
      const frontSplit = elbow.clone().lerp(wrist, 0.48);
      const frontChain = [
        { to: elbow, r1: 0.1 * legMul, r2: 0.074 * legMul, flow: [1.32, 1.52] as [number, number], tag: 'upper' },
        { to: frontSplit, r1: 0.074 * legMul, r2: 0.066 * legMul, flow: [1.52, 1.64] as [number, number], tag: 'lowerA' },
        { to: wrist, r1: 0.066 * legMul, r2: 0.058 * legMul, flow: [1.64, 1.74] as [number, number], tag: 'lowerB', color: 'sock' as BallColor },
      ];
      let prevFront = frontOrigin;
      for (const seg of frontChain) {
        legSegments.push({ x: frontX, from: prevFront, to: seg.to, r1: seg.r1, r2: seg.r2, flow: seg.flow, tag: `front_${side}_${seg.tag}`, color: seg.color });
        legSegments.push({ x: frontX, from: seg.to, to: seg.to, r1: seg.r2 * 1.1, r2: seg.r2 * 1.1, flow: [seg.flow[1], seg.flow[1]], tag: `front_${side}_joint` });
        prevFront = seg.to;
      }
      // Hindquarter: the femur attaches at almost the complete rear of the
      // body (not counting the tail base), the tibia folds at a near-right
      // angle, and the metatarsus folds back the other way so it runs nearly
      // parallel to the femur — the classic digitigrade Z.
      const hipRow = rowData[1];
      const haunchY = clamp(groundY(hipRow.ry) - hipRow.rowRadius + 0.135, 0.155, 0.52);
      const hipY = haunchY + (poseId === 'sitting' ? -0.02 : 0);
      const hip = new THREE.Vector3(side * hipJointX, hipY, mz(-0.44));
      const haunchMass = new THREE.Vector3(side * hipX, hipY, mz(-0.44));
      const hind = tuning.hind;
      const femurDir = new THREE.Vector3(0, -Math.sin(rad(hind.femurAngle)), Math.cos(rad(hind.femurAngle)));
      const tibiaDir = femurDir.clone().applyAxisAngle(X_AXIS, rad(180 - hind.stifleAngle));
      const metDir = tibiaDir.clone().applyAxisAngle(X_AXIS, -rad(180 - hind.hockAngle));
      const toeDir = metDir.clone().applyAxisAngle(X_AXIS, toeTurnSign * rad(180 - hind.toeAngle));
      const composeHind = (origin: THREE.Vector3) => {
        const stifle = origin.clone().addScaledVector(femurDir, hind.femurLen);
        const hock = stifle.clone().addScaledVector(tibiaDir, hind.tibiaLen);
        const mtp = hock.clone().addScaledVector(metDir, hind.metatarsusLen);
        const toe = mtp.clone().addScaledVector(toeDir, hind.toeLen);
        return { stifle, hock, mtp, toe };
      };
      const hindDy = clamp(HIND_PLANT_Y[poseId] - composeHind(hip).toe.y, -MAX_CHAIN_SHIFT, MAX_CHAIN_SHIFT);
      const hindOrigin = hip.clone().add(new THREE.Vector3(0, hindDy, 0));
      const { stifle, hock, mtp, toe } = composeHind(hindOrigin);
      const metSplit = hock.clone().lerp(mtp, 0.5);
      const chain = [
        { to: stifle, r1: 0.125 * legMul * morph.haunchSpread, r2: 0.072 * legMul, flow: [1.3, 1.46] as [number, number], tag: 'femur' },
        { to: hock, r1: 0.068 * legMul, r2: 0.05 * legMul, flow: [1.46, 1.58] as [number, number], tag: 'tibia' },
        { to: metSplit, r1: 0.045 * legMul, r2: 0.043 * legMul, flow: [1.58, 1.66] as [number, number], tag: 'metatarsus' },
        { to: mtp, r1: 0.043 * legMul, r2: 0.041 * legMul, flow: [1.66, 1.7] as [number, number], tag: 'metatarsusB', color: 'sock' as BallColor },
        { to: toe, r1: 0.04 * legMul, r2: 0.046 * legMul, flow: [1.7, 1.8] as [number, number], tag: 'phalanx', color: 'sock' as BallColor },
      ];
      let prevJoint = hindOrigin;
      for (const seg of chain) {
        legSegments.push({ x: side * hipJointX, from: prevJoint, to: seg.to, r1: seg.r1, r2: seg.r2, flow: seg.flow, tag: `hind_${side}_${seg.tag}`, color: seg.color });
        legSegments.push({ x: side * hipJointX, from: seg.to, to: seg.to, r1: seg.r2 * 1.1, r2: seg.r2 * 1.1, flow: [seg.flow[1], seg.flow[1]], tag: `hind_${side}_joint` });
        prevJoint = seg.to;
      }
      // Haunch muscle ball (the round thigh cats sit on) — every pose.
      bones.push({
        name: `thigh_${side}`,
        pos: haunchMass.clone().add(new THREE.Vector3(side * 0.01, 0.035, -0.02)),
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
        color: seg.color ?? 'fur',
        flow: seg.flow[0] + (seg.flow[1] - seg.flow[0]) * t,
      });
    }
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
      [0.235, tailBase.y + 0.345, mz(-0.16)],
    ],
    sitting: [
      [0.07, tailBase.y, tailBase.z],
      [0.34, Math.max(0.1, tailBase.y * 0.62), mz(-0.4)],
      [0.45, 0.095, mz(-0.02)],
      [0.41, 0.093, mz(0.3)],
      [0.19, 0.092, mz(0.47)],
      [0.1, 0.091, mz(0.56)],
    ],
    loaf: [
      [0.08, tailBase.y, tailBase.z],
      [0.36, 0.105, mz(-0.2)],
      [0.44, 0.095, mz(0.17)],
      [0.26, 0.092, mz(0.44)],
      [0.12, 0.091, mz(0.5)],
    ],
    stretch: [
      [0, tailBase.y, tailBase.z],
      [0.02, tailBase.y + 0.2, mz(-0.71)],
      [0.055, tailBase.y + 0.36, mz(-0.7)],
      [0.125, tailBase.y + 0.46, mz(-0.55)],
      [0.185, tailBase.y + 0.485, mz(-0.36)],
    ],
    curled: [
      [-0.06, tailBase.y, tailBase.z],
      [-0.36, 0.095, mz(-0.26)],
      [-0.44, 0.093, mz(0.1)],
      [-0.27, 0.091, mz(0.4)],
      [0.09, 0.091, mz(0.44)],
      [0.29, 0.1, mz(0.3)],
      [0.34, 0.094, mz(0.1)],
    ],
  };
  const tailCurve = new THREE.CatmullRomCurve3(
    tailPointSets[poseId].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  // Adaptive sampling: one ball every ~0.038 world units, so the tail never
  // reads as a string of beads at low weights. Base stays thick to merge
  // into the rump; the tip tapers but never vanishes.
  const tailLength = tailCurve.getLength();
  const tailSamples = Math.max(18, Math.ceil(tailLength / 0.038));
  const tailThickness = Math.max(tailMul, 0.82);
  for (let i = 0; i <= tailSamples; i++) {
    const t = i / tailSamples;
    const p = tailCurve.getPointAt(t);
    const radius = (0.074 - 0.03 * Math.pow(t, 0.8)) * tailThickness;
    bones.push({
      name: `tail_${i}`,
      pos: p,
      radius: Math.max(0.034, radius),
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
