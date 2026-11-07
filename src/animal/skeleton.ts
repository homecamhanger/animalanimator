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
import { sdPrimitive, sminPoly } from './fur';

/** Colour roles; resolved to actual shades by the coat at build time. */
export type BallColor =
  | 'fur'      // base coat
  | 'cream'    // chest blaze / muzzle / chin / belly lighten (kitten go-light)
  | 'sock'     // white paws
  | 'saddle'   // darker spine saddle + tail tip
  | 'earFur';  // solid base for ears (as they are thin)

/**
 * FieldPrimitive — an exact signed-distance primitive polygonised by a
 * smooth-min union (see fur.ts). A sphere is a segment of zero length with
 * equal radii; a capsule has equal radii; a cone tapers. The signed distance
 * never "adds up" the way additive metaballs did, so limbs keep their slim
 * shafts and only blend inside a small, deliberate radius at each joint.
 */
export interface FieldPrimitive {
  name: string;
  /** Centroid — sphere: the centre; segment: the midpoint. */
  pos: THREE.Vector3;
  /** Segment endpoints (spheres: both equal `pos`). */
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Radius at `a` / at `b`. */
  r1: number;
  r2: number;
  /** Smooth-min blend radius into the union (world units). Dents: smax smoothing. */
  blend: number;
  color: BallColor;
  /** Arc-length-ish coordinate along the animal (0 = rump → ~1 = face, >1 limbs/tail).
   *  Interpolated along the segment; the stripe shader bands on it. */
  flowA: number;
  flowB: number;
  /** True for negative-strength primitives that CARVE the field (eye sockets, pinna scoops). */
  dent?: boolean;
}

export interface SkeletonAnchors {
  headPos: THREE.Vector3;
  headMul: number;
  /** Weight-driven jowl growth — used for the whisker fan reach. */
  cheekMul: number;
  headBaseY: number;
  earDirs: Array<{ base: THREE.Vector3; dir: THREE.Vector3; side: 1 | -1 }>;
  tailTipWorld: THREE.Vector3;
}

export interface SolvedSkeleton {
  balls: FieldPrimitive[];
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
  { t: 0.02, offsetFrac: 0.0, r: 0.141, sag: 0.006, belly: false }, // rump tip
  { t: 0.13, offsetFrac: 0.40, r: 0.152, sag: 0.005, belly: false }, // haunches
  { t: 0.3, offsetFrac: 0.5, r: 0.162, sag: 0.012, belly: false }, // waist
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

/** Tail control points for a pose — world space, given the solved tail base.
 *  Shared by solveSkeleton (fur prims) and skinRig (bone deltas). */
export function tailControlPoints(poseId: PoseId, tailBase: THREE.Vector3, zScale: number): Array<[number, number, number]> {
  const mz = (z: number) => z * zScale;
  const sets: Record<PoseId, Array<[number, number, number]>> = {
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
  return sets[poseId];
}

/** Solve bones for a pose at a given weight. Pure — unit-checkable. */
export function solveSkeleton(poseId: PoseId, weight: number, tuningOverride?: Partial<LegTuning>): SolvedSkeleton {
  const morph = weightMorph(weight);
  const pose = POSE_PARAMS[poseId];
  const c = morph.chonk;
  const zScale = pose.scaleZ;
  const bones: FieldPrimitive[] = [];
  const mz = (z: number) => z * zScale;

  /* Primitive emission helpers */
  const addSphere = (
    name: string, x: number, y: number, z: number, r: number,
    color: BallColor, flow: number, blend = 0.055,
  ): void => {
    const p = new THREE.Vector3(x, y, z);
    bones.push({ name, pos: p.clone(), a: p.clone(), b: p.clone(), r1: r, r2: r, blend, color, flowA: flow, flowB: flow });
  };
  const addSeg = (
    name: string, a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number,
    color: BallColor, flowA: number, flowB: number, blend: number,
  ): void => {
    bones.push({
      name,
      pos: a.clone().add(b).multiplyScalar(0.5),
      a: a.clone(),
      b: b.clone(),
      r1, r2, blend, color, flowA, flowB,
    });
  };
  const addDent = (name: string, x: number, y: number, z: number, r: number, blend = 0.02, flow = 1.0): void => {
    const p = new THREE.Vector3(x, y, z);
    bones.push({ name, pos: p.clone(), a: p.clone(), b: p.clone(), r1: r, r2: r, blend, color: 'fur', flowA: flow, flowB: flow, dent: true });
  };

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
      addSphere('spine_rump', 0, y, z, rowRadius, 'fur', 0, 0.14);
      continue;
    }
    addSphere(`spine_${row.t.toFixed(2)}_l`, -offset, y, z, rowRadius, 'fur', row.t, 0.14);
    addSphere(`spine_${row.t.toFixed(2)}_r`, offset, y, z, rowRadius, 'fur', row.t, 0.14);
    // Centre bridge sphere — kills the double-bump crease along the spine.
    addSphere(`spine_${row.t.toFixed(2)}_c`, 0, y, z, rowRadius * 0.82, 'fur', row.t, 0.14);
  }
  // Sagging belly core (the chonk engine) + cream belly lighten.
  addSphere('belly_sag', 0, groundY(sagBallY), midRow.z, sagBallRadius, 'fur', 0.47, 0.14);
  addSphere('belly_cream', 0, groundY(sagBallY - 0.02), midRow.z + 0.04, sagBallRadius * 0.9, 'cream', 0.47, 0.06);

  // Chest blaze — a soft cream ball nestled between the forelegs.
  const chest = rowData[4];
  addSphere('chest_blaze', 0, groundY(chest.ry + 0.02), chest.z, 0.135 * radiusMul * pose.scaleY, 'cream', 0.66, 0.07);

  /* ------------------------------ Neck & head ------------------------ */

  const neckY = groundY(BASE_SPINE + spineOffset(1) + 0.075);
  const neckZ = mz(0.565);
  addSphere('neck_low', 0, neckY, neckZ, 0.095 * (1 + morph.chonk * 0.38) * pose.scaleY, 'fur', 0.97, 0.085);

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

  addSphere('head_cranium', headCenter.x, headCenter.y, headCenter.z, 0.228 * headMul, 'fur', 1.03, 0.06);
  const skullPos = local(0, 0.055, -0.085);
  addSphere('head_skull', skullPos.x, skullPos.y, skullPos.z, 0.184 * headMul, 'fur', 1.06, 0.055);
  // Cheek ruffs — chonk shows up in the face first.
  for (const side of [-1, 1] as const) {
    const p = local(side * 0.124, -0.048, 0.075);
    addSphere(`cheek_${side}`, p.x, p.y, p.z, 0.122 * morph.cheekMul * headMul, 'fur', 1.13, 0.05);
  }
  // Muzzle + chin (cream). The double chin is earning its keep.
  const muzzlePos = local(0, -0.118, 0.208);
  addSphere('muzzle', muzzlePos.x, muzzlePos.y, muzzlePos.z, 0.118 * headMul, 'cream', 1.17, 0.05);
  const chinRadius = 0.082 * morph.chinMul;
  if (chinRadius > 0.028) {
    const p = local(0, -0.185, 0.125);
    addSphere('chin', p.x, p.y, p.z, chinRadius, 'cream', 1.19, 0.04);
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
      const p = base
        .clone()
        .addScaledVector(dirN, d * headMul)
        .addScaledVector(plateSide, w * headMul);
      addSphere(`ear_${side}_${d.toFixed(3)}_${w >= 0 ? 'a' : 'b'}${w === 0 ? 'c' : ''}`, p.x, p.y, p.z, r * headMul * perkThin, 'fur', 1.24 + d * 2.0, 0.045);
    }
  }

  /* ---------------- Head dents — carved after the ears are known ------- */
  // Eye sockets: anti-balls sitting just proud of the cranium surface, so the
  // MC field dips into a dish around each eye. The eyes themselves are placed
  // against the socketless surface, so they nestle into the dishes.
  for (const side of [-1, 1]) {
    const p = local(side * 0.135, 0.06, 0.235);
    addDent(`eye_socket_${side}`, p.x, p.y, p.z, 0.07 * headMul, 0.014, 1.05);
  }
  // Pinna scoops: one anti-ball per ear, on the ear's front face (face-forward
  // normal with the ear-axis component removed), so each ear grows a concave
  // dish the inner-ear lozenge can sit in.
  const faceForward = new THREE.Vector3(0, 0.15, 1).applyQuaternion(headQuat).normalize();
  for (const { base, dir } of earDirs) {
    const along = dir.clone().normalize();
    const pinnaNormal = faceForward.clone().addScaledVector(along, -faceForward.dot(along)).normalize();
    const mid = base.clone().addScaledVector(along, 0.075 * headMul);
    mid.addScaledVector(pinnaNormal, 0.02);
    addDent('ear_scoop', mid.x, mid.y, mid.z, 0.052 * headMul, 0.014, 1.3);
  }

  /* ------------------------------ Legs -------------------------------- */

  const legMul = morph.legMul;
  const shoulderX = clamp(0.16 * widthMul + 0.016, 0.125, 0.27);
  const hipX = clamp(rowData[1].offset + rowData[1].rowRadius * 0.55, 0.16, 0.38);
  // Wide-set femurs — two cones closer than their own radius simply fuse
  // into one column, so the hip joint sits well off the midline and the
  // haunch mass spreads around it.
  const hipJointX = clamp(hipX * 0.68, 0.085, 0.21);
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
      const haunchMass = new THREE.Vector3(side * hipX * 0.9, hipY, mz(-0.44));
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
        { to: stifle, r1: 0.108 * legMul * morph.haunchSpread, r2: 0.072 * legMul, flow: [1.3, 1.46] as [number, number], tag: 'femur' },
        { to: hock, r1: 0.068 * legMul, r2: 0.05 * legMul, flow: [1.46, 1.58] as [number, number], tag: 'tibia' },
        { to: metSplit, r1: 0.045 * legMul, r2: 0.043 * legMul, flow: [1.58, 1.66] as [number, number], tag: 'metatarsus' },
        { to: mtp, r1: 0.043 * legMul, r2: 0.041 * legMul, flow: [1.66, 1.7] as [number, number], tag: 'metatarsusB', color: 'sock' as BallColor },
        { to: toe, r1: 0.04 * legMul, r2: 0.046 * legMul, flow: [1.7, 1.8] as [number, number], tag: 'phalanx', color: 'sock' as BallColor },
      ];
      let prevJoint = hindOrigin;
      for (const seg of chain) {
        legSegments.push({ x: side * hipJointX, from: prevJoint, to: seg.to, r1: seg.r1, r2: seg.r2, flow: seg.flow, tag: `hind_${side}_${seg.tag}`, color: seg.color });
        prevJoint = seg.to;
      }
      // Haunch muscle ball (the round thigh cats sit on) — every pose.
      const thighPos = haunchMass.clone().add(new THREE.Vector3(side * 0.01, 0.035, -0.02));
      addSphere(`thigh_${side}`, thighPos.x, thighPos.y - 0.018, thighPos.z, 0.094 * legMul * morph.haunchSpread * pose.scaleY, 'fur', 1.28, 0.055);
    }
  }

  // One exact cone primitive per bone — the smooth-min union fillets the
  // joints, so chains stay slim shafts instead of fusing into a blob.
  const LEG_BLEND: Record<string, number> = {
    upper: 0.062, lowerA: 0.04, lowerB: 0.034,
    femur: 0.022, tibia: 0.042, metatarsus: 0.034, metatarsusB: 0.034, phalanx: 0.032,
  };
  for (const seg of legSegments) {
    const dir = seg.to.clone().sub(seg.from);
    const length = dir.length();
    if (length < 1e-4) continue; // zero-length joints are folded into the cones
    const blend = LEG_BLEND[seg.tag.split('_').slice(2).join('_')] ?? 0.04;
    addSeg(
      `leg_${seg.tag}`,
      seg.from,
      seg.to,
      seg.r1,
      seg.r2,
      seg.color ?? 'fur',
      seg.flow[0],
      seg.flow[1],
      blend,
    );
    // Knee/hock fillet — a small sphere at each joint so the bend reads as a
    // joint and never as a crease.
    addSphere(`leg_${seg.tag}_cap`, seg.to.x, seg.to.y, seg.to.z, seg.r2 * 1.08, seg.color ?? 'fur', seg.flow[1], 0.036);
  }

  /* ------------------------------ Tail --------------------------------- */

  const rear = rowData[0];
  const tailBase = new THREE.Vector3(0, groundY(rear.ry + rear.rowRadius * 0.42), mz(-0.5));
  const tailMul = morph.tailMul;
  const tailPointSets = tailControlPoints(poseId, tailBase, zScale);
  const tailCurve = new THREE.CatmullRomCurve3(
    tailPointSets.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  // One tapered cone per span between sparse curve samples — the smooth-min
  // union fillets the joints into a smooth tail. Base stays thick to merge
  // into the rump; the tip tapers but never vanishes.
  const tailLength = tailCurve.getLength();
  const tailSpans = Math.max(7, Math.ceil(tailLength / 0.055));
  const tailThickness = Math.max(tailMul, 0.82);
  const tailRadius = (t: number) => Math.max(0.034, (0.074 - 0.03 * Math.pow(t, 0.8)) * tailThickness);
  for (let i = 0; i < tailSpans; i++) {
    const t0 = i / tailSpans;
    const t1 = (i + 1) / tailSpans;
    const p0 = tailCurve.getPointAt(t0);
    const p1 = tailCurve.getPointAt(t1);
    const midT = (t0 + t1) / 2;
    const color = midT > 0.82 ? 'saddle' : 'fur';
    addSeg(
      `tail_${i}`,
      p0,
      p1,
      tailRadius(t0),
      tailRadius(t1),
      color,
      2.15 + t0 * 0.75,
      2.15 + t1 * 0.75,
      0.075,
    );
  }
  const tailTip = tailCurve.getPointAt(1);
  addSphere('tail_tip', tailTip.x, tailTip.y, tailTip.z, tailRadius(1) * 0.96, 'saddle', 2.9, 0.04);

  /* ----------------- Stifle crotch dimple (auto-placed) ----------------- */
  // One compact anti-ball per side, dropped at the deepest "throat" along the
  // out-and-up ray from the femur — the corner where the belly wall meets the
  // leg. Carving exactly one focused dish (eye-socket style) separates the
  // knee from the abdomen in the silhouette without slicing the folded limb
  // mass in poses where it legitimately melts into the body (sitting/loaf/
  // curled). The proximal femur stays fused to the hip by construction.
  if (poseId === 'standing') {
    const baseField = (p: THREE.Vector3): number => {
      let acc = 1e3;
      for (const prim of bones) {
        if (prim.dent) continue;
        acc = sminPoly(acc, sdPrimitive(p.x, p.y, p.z, prim), prim.blend);
      }
      return acc;
    };
    const placeCrotch = (side: 1 | -1): void => {
      const femur = bones.find(b => b.name === `leg_hind_${side}_femur`);
      if (!femur) return;
      const dir = new THREE.Vector3(side * 0.72, 0.7, 0).normalize();
      const t = 0.7; // throat station — the deepest point of the belly/leg neck
      const axis = femur.a.clone().lerp(femur.b, t);
      let hit = -1;
      let prevF = baseField(axis), prevD = 0;
      for (let d = 0.008; d <= 0.34; d += 0.008) {
        const f = baseField(axis.clone().addScaledVector(dir, d));
        if (f >= 0) {
          hit = prevD + ((0 - prevF) * (d - prevD)) / (f - prevF);
          break;
        }
        prevF = f; prevD = d;
      }
      if (hit >= 0) {
        const p = axis.clone().addScaledVector(dir, hit);
        addDent(`crotch_${side}`, p.x, p.y, p.z, 0.06, 0.018, 1.38);
      }
    };
    placeCrotch(1);
    placeCrotch(-1);
  }

  /* ------------------------------ Anchors ------------------------------ */

  const anchors: SkeletonAnchors = {
    headPos: headCenter,
    headMul,
    cheekMul: morph.cheekMul,
    headBaseY,
    earDirs,
    tailTipWorld: tailCurve.getPointAt(1),
  };

  return { balls: bones, anchors, eyesOpen: pose.eyesOpen, earPerk: pose.earPerk };
}
