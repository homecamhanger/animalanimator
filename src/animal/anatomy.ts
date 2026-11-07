/**
 * anatomy.ts — the full feline skeleton as data.
 *
 * Every bone in Felis catus worth articulating, in anatomical order, with
 * rest-pose positions in our world frame (floor at y = 0, facing +z).
 *
 * The bone SET and articulation order are textbook feline osteology
 * (C7/T13/L7/S3/Ca21, 13 rib pairs, 8 sternebrae, 7 carpals, 7 tarsals).
 *
 * REGISTRATION: the rest pose is laid against the mesh's own solved standing
 * rig (solveSkeleton('standing', 1.0)) — the dorsal ridge balls, the solved
 * leg chains, the head and the tail anchors the fur is grown from — so the
 * skeleton sits INSIDE the cat instead of in an idealised meter frame.
 * Re-print the landmarks with `npx tsx scripts/probe-skeleton.ts standing 1.0`.
 *
 * Output: flat list of bones; `parent` links give the articulation tree.
 * See docs/anatomy.md for the inventory, omissions and caveats.
 */

import * as THREE from 'three';
import { solveSkeleton } from './skeleton';
import { POSE_PARAMS } from './profiles';

export type AnatomyRegion = 'skull' | 'spine' | 'ribcage' | 'forelimb' | 'hindlimb' | 'tail';
export const ANATOMY_REGIONS: readonly AnatomyRegion[] = ['skull', 'spine', 'ribcage', 'forelimb', 'hindlimb', 'tail'];
export type AnatomySide = 'left' | 'right' | 'midline';
export type AnatomyJoint =
  | 'suture'          // skull — immovable
  | 'condyloid'       // atlanto-occipital, wrist, hock
  | 'pivot'           // atlanto-axial (C1/C2)
  | 'gliding'         // inter-vertebral, costovertebral, sternal
  | 'ball-and-socket' // shoulder, hip
  | 'hinge'           // elbow, stifle, digits
  | 'fixed';          // fused (sacrum)
export type AnatomyShape = 'capsule' | 'ellipsoid' | 'plate';

export interface AnatomicalBone {
  id: string;
  label: string;
  region: AnatomyRegion;
  side: AnatomySide;
  joint: AnatomyJoint;
  /** Parent bone id — bones one step closer to the sacrum (articulation order). */
  parent: string | null;
  shape: AnatomyShape;
  /** Capsule axis endpoints / ellipsoid long-axis endpoints / plate corner 1. Rest pose. */
  from: [number, number, number];
  to: [number, number, number];
  /** Capsule radius; unused for ellipsoid (see radii) / plate. */
  girth: number;
  /** Ellipsoid radii (short axes). */
  radii?: [number, number, number];
  /** Third corner for `plate` shapes / quadratic-bezier apex for curved capsules (ribs, jaw). */
  via?: [number, number, number];
}

/** Atlanto-occipital joint — shared with skinRig for head-frame derivation. */
export const SKULL_BASE: readonly [number, number, number] = [0, 0.788, 0.526];

/* ------------------------------------------------------------------ */
/* Builder helpers                                                     */
/* ------------------------------------------------------------------ */

type V3 = [number, number, number];

interface SegOptions {
  via?: V3;
  side?: AnatomySide;
  joint?: AnatomyJoint;
  parent: string | null;
  girth: number;
}
const seg = (
  out: AnatomicalBone[],
  id: string,
  label: string,
  region: AnatomyRegion,
  from: V3,
  to: V3,
  o: SegOptions,
): void => {
  out.push({
    id,
    label,
    region,
    side: o.side ?? 'midline',
    joint: o.joint ?? 'gliding',
    parent: o.parent,
    shape: 'capsule',
    from,
    to,
    girth: o.girth,
    via: o.via,
  });
};

const plate = (
  out: AnatomicalBone[],
  id: string,
  label: string,
  region: AnatomyRegion,
  side: AnatomySide,
  a: V3,
  b: V3,
  c: V3,
  o: { joint?: AnatomyJoint; parent: string | null },
): void => {
  out.push({
    id, label, region, side,
    joint: o.joint ?? 'fixed',
    parent: o.parent,
    shape: 'plate',
    from: a, to: b, via: c, girth: 0.004,
  });
};

const ellipsoid = (
  out: AnatomicalBone[],
  id: string,
  label: string,
  region: AnatomyRegion,
  centerFrom: V3,
  centerTo: V3,
  radii: [number, number],
  o: { joint?: AnatomyJoint; parent: string | null },
): void => {
  out.push({
    id, label, region, side: 'midline',
    joint: o.joint ?? 'suture',
    parent: o.parent,
    shape: 'ellipsoid',
    from: centerFrom, to: centerTo,
    girth: 0,
    radii: [radii[0], radii[0], radii[1]],
  });
};

/* ------------------------------------------------------------------ */
/* The skeleton                                                        */
/* ------------------------------------------------------------------ */

export function buildAnatomy(): AnatomicalBone[] {
  const B: AnatomicalBone[] = [];

    /* Registration: the mesh's own solved standing rig, weight 1.0. */
  const { balls, anchors } = solveSkeleton('standing', 1.0);
  const ballPos = (name: string): THREE.Vector3 => {
    const b = balls.find((candidate) => candidate.name === name);
    if (!b) throw new Error(`anatomy: mesh primitive "${name}" not found`);
    return b.pos.clone();
  };
  const segA = (name: string): THREE.Vector3 => {
    const b = balls.find((candidate) => candidate.name === name);
    if (!b) throw new Error(`anatomy: mesh segment "${name}" not found`);
    return b.a.clone();
  };
  const zScale = POSE_PARAMS.standing.scaleZ;

  /* ---------------- Vertebral column (sacrum → atlas) ------------------ */
  // The mesh's own dorsal ridge balls (scripts/probe-skeleton.ts), dropped by
  // ~0.052 to the vertebral column — the spinous processes are what pokes up,
  // the bodies sit below. Level topline: cat, not a camel.
  const ridge = {
    rump: ballPos('spine_rump'),
    haunch: ballPos('spine_0.13_c'),
    waist: ballPos('spine_0.30_c'),
    mid: ballPos('spine_0.47_c'),
    chest: ballPos('spine_0.66_c'),
    neckBase: ballPos('spine_0.87_c'),
  };
  const DROP = 0.008; // ridge balls are centred on the column — skin rides above them
  const spinePts: THREE.Vector3[] = [
    new THREE.Vector3(0, ridge.rump.y - DROP, ridge.rump.z),            //  0 sacrum centre
    new THREE.Vector3(0, ridge.haunch.y - DROP, -0.397),                //  1 L7
    new THREE.Vector3(0, ridge.haunch.y - DROP, -0.338),                //  2 L6
    new THREE.Vector3(0, ridge.waist.y - DROP, -0.275),                 //  3 L5
    new THREE.Vector3(0, ridge.waist.y - DROP, -0.212),                 //  4 L4
    new THREE.Vector3(0, ridge.mid.y - DROP, -0.150),                   //  5 L3
    new THREE.Vector3(0, ridge.mid.y - DROP, -0.098),                   //  6 L2
    new THREE.Vector3(0, ridge.mid.y - DROP, -0.048),                   //  7 L1
    new THREE.Vector3(0, ridge.mid.y - DROP, -0.010),                   //  8 T13
    new THREE.Vector3(0, ridge.mid.y - DROP, 0.032),                    //  9 T12
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.071),                  // 10 T11
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.110),                  // 11 T10
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.147),                  // 12 T9
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.182),                  // 13 T8
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.216),                  // 14 T7
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.248),                  // 15 T6
    new THREE.Vector3(0, ridge.chest.y - DROP, 0.279),                  // 16 T5
    new THREE.Vector3(0, ridge.neckBase.y - DROP, 0.306),               // 17 T4
    new THREE.Vector3(0, ridge.neckBase.y - DROP, 0.332),               // 18 T3
    new THREE.Vector3(0, ridge.neckBase.y - DROP, 0.355),               // 19 T2
    new THREE.Vector3(0, ridge.neckBase.y - DROP, 0.382),               // 20 T1
    new THREE.Vector3(0, 0.624, 0.424),                                 // 21 C7
    // Cervical column — rises through the neck fur (neck_low anchor 0.704 @ 0.565)
    new THREE.Vector3(0, 0.628, 0.448),                                 // 22 C6
    new THREE.Vector3(0, 0.644, 0.471),                                 // 23 C5
    new THREE.Vector3(0, 0.668, 0.489),                                 // 24 C4
    new THREE.Vector3(0, 0.698, 0.502),                                 // 25 C3
    new THREE.Vector3(0, 0.730, 0.511),                                 // 26 C2 (axis)
    new THREE.Vector3(0, 0.768, 0.517),                                 // 27 C1 (atlas)
  ];
  const skullBase: V3 = [...SKULL_BASE] as V3;
  const SP = (i: number): V3 => [spinePts[i].x, spinePts[i].y, spinePts[i].z];

  const sacrumId = 'sacrum';
  ellipsoid(B, sacrumId, 'Sacrum (S1–S3 fused)', 'spine', SP(0), SP(0), [0.027, 0.046], { joint: 'fixed', parent: null });

  for (let i = 7; i >= 1; i--) {
    const ptIdx = 8 - i; // L7 → 1 … L1 → 7
    seg(B, `l_${i}`, `L${i}`, 'spine', SP(ptIdx), SP(ptIdx + 1), {
      parent: i === 7 ? sacrumId : `l_${i + 1}`,
      girth: 0.0165,
    });
  }

  for (let i = 13; i >= 1; i--) {
    const ptIdx = 7 + (14 - i); // T13 → 8 … T1 → 20
    seg(B, `t_${i}`, `T${i}`, 'spine', SP(ptIdx), SP(ptIdx + 1), {
      parent: i === 13 ? 'l_1' : `t_${i + 1}`,
      girth: 0.0145,
    });
  }

  const cid = (n: number): string => (n === 2 ? 'axis' : n === 1 ? 'atlas' : `c_${n}`);
  for (let i = 7; i >= 1; i--) {
    const ptIdx = 20 + (8 - i); // C7 → 21 … C1 → 27
    const id = cid(i);
    const label = i === 2 ? 'Axis (C2)' : i === 1 ? 'Atlas (C1)' : `C${i}`;
    const joint: AnatomyJoint = i === 1 ? 'condyloid' : i === 2 ? 'pivot' : 'gliding';
    const to: V3 = i === 1 ? skullBase : SP(ptIdx + 1);
    seg(B, id, label, 'spine', SP(ptIdx), to, {
      parent: i === 7 ? 't_1' : cid(i + 1),
      girth: i <= 2 ? 0.014 : 0.0125,
      joint,
    });
  }

  /* ---------------- Skull ---------------- */
  const head = anchors.headPos as unknown as THREE.Vector3; // (0, 0.899, 0.640) @ w1.0
  const craniumFrom: V3 = [0, head.y + 0.016, head.z - 0.135]; // occiput
  const craniumTo: V3 = [0, head.y + 0.103, head.z + 0.072];   // forehead
  ellipsoid(B, 'cranium', 'Cranium (frontal·parietal·occipital·temporal·interparietal)', 'skull',
    craniumFrom, craniumTo, [0.092, 0.118], { parent: 'atlas' });
  seg(B, 'maxilla', 'Maxilla & nasal & incisive', 'skull',
    [0, head.y + 0.016, head.z + 0.080], [0, head.y - 0.087, head.z + 0.280],
    { parent: 'cranium', girth: 0.021, joint: 'suture' });
  // Zygomatic arches — cheekbones, bowing outside the cranium
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? -1 : 1;
    seg(B, `zygomatic_${side[0]}`, `Zygomatic arch (${side})`, 'skull',
      [s * 0.095, head.y + 0.051, head.z - 0.120],
      [s * 0.066, head.y - 0.039, head.z + 0.130],
      { parent: 'cranium', girth: 0.006, joint: 'suture', via: [s * 0.132, head.y - 0.021, head.z + 0.000], side });
    // Mandible — one ramus per side, joined at the symphysis
    seg(B, `mandible_${side[0]}`, `Mandible ramus (${side})`, 'skull',
      [0, head.y - 0.096, head.z + 0.250],
      [s * 0.102, head.y - 0.047, head.z - 0.092],
      { parent: 'cranium', girth: 0.0075, joint: 'hinge', via: [s * 0.058, head.y - 0.141, head.z + 0.075], side });
  }

  /* ---------------- Ribs — 13 pairs ---------------- */
  const thoracicPt = (tIdx1to13: number): THREE.Vector3 => spinePts[8 + (13 - tIdx1to13)];
  const ribHalfWidth = (i: number): number => {
    const t = (i - 1) / 12;
    return 0.082 + 0.052 * Math.sin(Math.PI * Math.pow(t * 1.12, 0.92));
  };
  const sternumAt = (t: number): V3 => [0, 0.478 + t * 0.022, 0.300 - t * 0.290];
  for (let i = 1; i <= 13; i++) {
    const attach = thoracicPt(i);
    const hw = ribHalfWidth(i);
    const end = sternumAt((i - 1) / 12);
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? -1 : 1;
      const start: V3 = [0, attach.y - 0.004, attach.z];
      const endPt: V3 = [s * 0.016, end[1], end[2]];
      const via: V3 = [s * hw, (attach.y + end[1]) / 2 - 0.046, attach.z * 0.52 + end[2] * 0.48 - 0.004];
      seg(B, `rib_${i}_${side[0]}`, `Rib ${i}${i === 13 ? ' (floating)' : ''} (${side})`, 'ribcage',
        start, endPt, { parent: `t_${i}`, girth: 0.0052, joint: 'gliding', via, side });
    }
  }

  /* ---------------- Sternum — manubrium + 6 sternebrae + xiphoid -------- */
  const sternumLabels = ['Manubrium', 'Sternebra 2', 'Sternebra 3', 'Sternebra 4', 'Sternebra 5', 'Sternebra 6', 'Sternebra 7', 'Xiphoid process'];
  const sternumPts: V3[] = [];
  for (let i = 0; i <= 8; i++) sternumPts.push(sternumAt(i / 8));
  // Slightly deepen the caudal sternum (xiphoid dips toward the belly)
  sternumPts[8] = [0, 0.502, 0.010];
  for (let i = 0; i < 8; i++) {
    seg(B, `sternum_${i}`, sternumLabels[i], 'ribcage', sternumPts[i], sternumPts[i + 1], {
      parent: i === 0 ? 't_1' : `sternum_${i - 1}`,
      girth: 0.013,
      joint: 'gliding',
    });
  }

  /* ---------------- Girdles ---------------- */
  const frontRig = balls.find((b) => b.name === 'leg_front_1_upper')!;
  const glenoidR = frontRig.b.clone(); // chest-bottom of the foreleg chain (0.342 @ 0.429)
  const shoulderX = glenoidR.x;
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? -1 : 1;
    // Scapula — blade flat against the lateral chest wall, glenoid low-forward
    plate(B, `scapula_${side[0]}`, `Scapula (${side})`, 'forelimb', side,
      [s * (shoulderX - 0.004), 0.345, 0.425],   // glenoid
      [s * 0.100, 0.588, 0.278],                 // dorsal tip
      [s * 0.132, 0.470, 0.262],                 // caudal corner
      { joint: 'ball-and-socket', parent: 't_1' });
    seg(B, `scapular_spine_${side[0]}`, `Scapular spine (${side})`, 'forelimb',
      [s * (shoulderX - 0.006), 0.360, 0.415], [s * 0.098, 0.595, 0.295],
      { parent: `scapula_${side[0]}`, girth: 0.005, joint: 'fixed', side });
    // Clavicle — rudimentary, free-floating, embedded in the shoulder muscle
    seg(B, `clavicle_${side[0]}`, `Clavicle (rudimentary) (${side})`, 'forelimb',
      [s * (shoulderX - 0.006), 0.352, 0.425], [s * 0.128, 0.342, 0.448],
      { parent: `scapula_${side[0]}`, girth: 0.0032, joint: 'gliding', side });
    // Pelvis — ilium/ischium/pubis (fused into os coxae in the adult)
    const hip = balls.find((b) => b.name === `leg_hind_${side === 'left' ? '-1' : '1'}_femur`)!.a;
    const acetabulum: V3 = [hip.x, hip.y, hip.z];
    plate(B, `ilium_${side[0]}`, `Ilium — hip bone wing (${side})`, 'hindlimb', side,
      [s * 0.045, 0.575, -0.435],   // sacral articulation
      acetabulum,                   // acetabulum
      [s * 0.115, 0.612, -0.412],   // wing tip
      { joint: 'fixed', parent: 'sacrum' });
    seg(B, `ischium_${side[0]}`, `Ischium (${side})`, 'hindlimb',
      acetabulum, [s * 0.070, 0.425, -0.500],
      { parent: `ilium_${side[0]}`, girth: 0.009, joint: 'fixed', side });
    seg(B, `pubis_${side[0]}`, `Pubis (${side})`, 'hindlimb',
      acetabulum, [s * 0.024, 0.440, -0.443],
      { parent: `ilium_${side[0]}`, girth: 0.008, joint: 'fixed', side });
  }

  /* ---------------- Forelimbs — humerus → claw ---------------- */
  // Shoulder joint sits mid-chest-depth on the leg's vertical column — the
  // mesh's own column passes from withers to elbow along x = ±shoulderX.
  const elbow = balls.find((b) => b.name === 'leg_front_1_lowerB')!.a; // (±0.176, 0.2092, 0.410)
  const wristR = balls.find((b) => b.name === 'leg_front_1_lowerB')!.b; // (±0.176, 0.0650, 0.390)
  const carpalLabels = ['Os carpi radiale', 'Os carpi intermedium', 'Os carpi ulnare', 'Os carpi accessorium', 'Os carpale I', 'Os carpale II', 'Os carpale III+IV'];
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? -1 : 1;
    const sh: V3 = [s * shoulderX, 0.462, 0.410];
    const el: V3 = [s * elbow.x, elbow.y, elbow.z];
    const wr: V3 = [s * wristR.x, wristR.y, wristR.z];
    seg(B, `humerus_${side[0]}`, `Humerus (${side})`, 'forelimb', sh, el, {
      parent: `scapula_${side[0]}`, girth: 0.0140, joint: 'ball-and-socket', side,
    });
    // Ulna — olecranon hook projects above the elbow joint, behind it
    seg(B, `ulna_${side[0]}`, `Ulna (${side})`, 'forelimb',
      [s * shoulderX, 0.247, 0.430], [s * shoulderX, wr[1] + 0.006, wr[2] + 0.008],
      { parent: `humerus_${side[0]}`, girth: 0.0078, joint: 'hinge', side });
    seg(B, `radius_${side[0]}`, `Radius (${side})`, 'forelimb',
      [s * (shoulderX - 0.004), 0.198, 0.407], [s * (shoulderX - 0.004), wr[1], wr[2] - 0.004],
      { parent: `humerus_${side[0]}`, girth: 0.0088, joint: 'hinge', side });
    // Carpus — two small-bone rows under the wrist
    carpalLabels.forEach((label, i) => {
      const proximal = i < 4;
      const cz: V3 = proximal
        ? [[0.158, 0.054, 0.396], [0.176, 0.050, 0.387], [0.194, 0.054, 0.379], [0.202, 0.070, 0.360]][i] as V3
        : [[0.160, 0.034, 0.401], [0.176, 0.032, 0.403], [0.192, 0.034, 0.399]][i - 4] as V3;
      const start: V3 = [s * Math.abs(cz[0]), cz[1], cz[2]];
      const toward: V3 = [s * Math.abs(cz[0]), cz[1] - 0.010, cz[2] + (proximal ? 0.006 : 0.004)];
      seg(B, `carpal_${i + 1}_${side[0]}`, `${label} (${side})`, 'forelimb', start, toward, {
        parent: proximal ? (i === 3 ? `ulna_${side[0]}` : `radius_${side[0]}`) : `carpal_2_${side[0]}`,
        girth: proximal ? 0.0062 : 0.0054,
        joint: 'gliding',
        side,
      });
    });
    // Metacarpals — MC1 (dewclaw, high, medial) + MC2..MC5
    seg(B, `mc_1_${side[0]}`, `Metacarpal I (dewclaw) (${side})`, 'forelimb',
      [s * 0.160, 0.078, 0.374], [s * 0.148, 0.097, 0.354],
      { parent: `carpal_4_${side[0]}`, girth: 0.0042, joint: 'hinge', side });
    seg(B, `ph_1_dew_prox_${side[0]}`, `Proximal phalanx (dewclaw) (${side})`, 'forelimb',
      [s * 0.148, 0.097, 0.354], [s * 0.141, 0.112, 0.335],
      { parent: `mc_1_${side[0]}`, girth: 0.0036, joint: 'hinge', side });
    seg(B, `ph_1_dew_dist_${side[0]}`, `Distal phalanx + claw (dewclaw) (${side})`, 'forelimb',
      [s * 0.141, 0.112, 0.335], [s * 0.136, 0.122, 0.352],
      { parent: `ph_1_dew_prox_${side[0]}`, girth: 0.0031, joint: 'hinge', side });
    const mcEnds: V3[] = [];
    const mcBases: V3[] = [
      [0.158, 0.028, 0.399],
      [0.172, 0.026, 0.403],
      [0.187, 0.028, 0.400],
      [0.200, 0.031, 0.392],
    ];
    const mcTips: V3[] = [
      [0.148, 0.008, 0.425],
      [0.170, 0.005, 0.437],
      [0.196, 0.008, 0.431],
      [0.214, 0.010, 0.415],
    ];
    for (let d = 2; d <= 5; d++) {
      const x0 = mcBases[d - 2][0], x1 = mcTips[d - 2][0];
      const from: V3 = [s * x0, mcBases[d - 2][1], mcBases[d - 2][2]];
      const to: V3 = [s * x1, mcTips[d - 2][1], mcTips[d - 2][2]];
      mcEnds.push(to);
      seg(B, `mc_${d}_${side[0]}`, `Metacarpal ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'forelimb', from, to, {
        parent: `carpal_${d + 2}_${side[0]}`, girth: 0.0042, joint: 'hinge', side,
      });
    }
    for (let d = 2; d <= 5; d++) {
      const base = mcEnds[d - 2];
      const spread = Math.sign(base[0] || 1) * 0.0012 * (d - 3.5);
      const p1: V3 = base;
      const p2: V3 = [base[0] + spread, 0.0055, base[2] + 0.010];
      const p3: V3 = [p2[0] + spread, 0.0048, p2[2] + 0.008];
      const p4: V3 = [p3[0] + spread, 0.0040, p3[2] + 0.007];
      seg(B, `ph_${d}_prox_${side[0]}`, `Proximal phalanx ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'forelimb', p1, p2, { parent: `mc_${d}_${side[0]}`, girth: 0.0038, joint: 'hinge', side });
      seg(B, `ph_${d}_mid_${side[0]}`, `Middle phalanx ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'forelimb', p2, p3, { parent: `ph_${d}_prox_${side[0]}`, girth: 0.0033, joint: 'hinge', side });
      seg(B, `ph_${d}_dist_${side[0]}`, `Distal phalanx + claw ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'forelimb', p3, p4, { parent: `ph_${d}_mid_${side[0]}`, girth: 0.003, joint: 'hinge', side });
    }
  }

  /* ---------------- Hindlimbs — femur → claw ---------------- */
  const femurSeg = balls.find((b) => b.name === 'leg_hind_1_femur')!;
  const tibiaSeg = balls.find((b) => b.name === 'leg_hind_1_tibia')!;
  const acetabulumW = femurSeg.a.clone(); // (±0.1088, 0.5200, -0.4400)
  const stifleW = femurSeg.b.clone();     // (±0.1088, 0.3441, -0.1213)
  const hockW = tibiaSeg.b.clone();       // (±0.1088, 0.1077, -0.2518)
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? -1 : 1;
    const hip: V3 = [s * acetabulumW.x, acetabulumW.y, acetabulumW.z];
    const stifle: V3 = [s * stifleW.x, stifleW.y, stifleW.z];
    const hock: V3 = [s * hockW.x, hockW.y, hockW.z];
    seg(B, `femur_${side[0]}`, `Femur (${side})`, 'hindlimb', hip, stifle, {
      parent: `ilium_${side[0]}`, girth: 0.0160, joint: 'ball-and-socket', side,
    });
    // Patella — the one big sesamoid worth naming
    seg(B, `patella_${side[0]}`, `Patella (${side})`, 'hindlimb',
      [s * stifleW.x, stifle[1] + 0.008, stifle[2] + 0.037], [s * stifleW.x, stifle[1] - 0.006, stifle[2] + 0.041],
      { parent: `femur_${side[0]}`, girth: 0.0070, joint: 'gliding', side });
    seg(B, `tibia_${side[0]}`, `Tibia (${side})`, 'hindlimb', [s * stifleW.x, stifle[1] - 0.008, stifle[2] - 0.004], hock, {
      parent: `femur_${side[0]}`, girth: 0.0120, joint: 'hinge', side,
    });
    // Fibula — thin, lateral to the tibia
    seg(B, `fibula_${side[0]}`, `Fibula (${side})`, 'hindlimb',
      [s * (stifleW.x + 0.013), stifle[1] - 0.012, stifle[2] - 0.006], [s * (stifleW.x + 0.013), hock[1] + 0.004, hock[2] + 0.006],
      { parent: `tibia_${side[0]}`, girth: 0.0042, joint: 'gliding', side });
    // Calcaneus — the heel; projects up-BACK from the hock joint
    seg(B, `tarsal_2_${side[0]}`, `Calcaneus (heel) (${side})`, 'hindlimb', hock,
      [s * hockW.x, hock[1] + 0.023, hock[2] - 0.040],
      { parent: `tibia_${side[0]}`, girth: 0.0085, joint: 'hinge', side });
    // Remaining tarsals — small bones across the hock
    const tarsalSpots: Array<[number, number, number]> = [
      [0.1088, 0.096, -0.240], // talus
      [0.1088, 0.066, -0.213], // centrale
      [0.0960, 0.058, -0.206], // T1
      [0.1088, 0.055, -0.202], // T2
      [0.1210, 0.057, -0.204], // T3
      [0.1315, 0.060, -0.201], // T4
    ];
    const tarsalIds = ['tarsal_1', 'tarsal_3', 'tarsal_4', 'tarsal_5', 'tarsal_6', 'tarsal_7'];
    const tarsalNames = ['Talus', 'Os tarsi centrale', 'Os tarsale I', 'Os tarsale II', 'Os tarsale III', 'Os tarsale IV'];
    tarsalSpots.forEach(([x, y, z], i) => {
      seg(B, `${tarsalIds[i]}_${side[0]}`, `${tarsalNames[i]} (${side})`, 'hindlimb',
        [s * x, y, z], [s * x, y - 0.009, z + 0.005],
        { parent: `tibia_${side[0]}`, girth: 0.0055, joint: 'gliding', side });
    });
    // Metatarsals MT2..MT5 — the long "cannon" the cat stands on (Mt1 vestigial)
    const mtBases: V3[] = [
      [0.094, 0.050, -0.198],
      [0.1088, 0.048, -0.200],
      [0.123, 0.050, -0.197],
      [0.136, 0.053, -0.188],
    ];
    const mtTips: V3[] = [
      [0.086, 0.032, -0.138],
      [0.1088, 0.030, -0.130],
      [0.131, 0.032, -0.138],
      [0.151, 0.035, -0.148],
    ];
    const mtEnds: V3[] = [];
    for (let d = 2; d <= 5; d++) {
      const from: V3 = [s * mtBases[d - 2][0], mtBases[d - 2][1], mtBases[d - 2][2]];
      const to: V3 = [s * mtTips[d - 2][0], mtTips[d - 2][1], mtTips[d - 2][2]];
      mtEnds.push(to);
      seg(B, `mt_${d}_${side[0]}`, `Metatarsal ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'hindlimb', from, to, {
        parent: d === 2 ? `tarsal_4_${side[0]}` : d === 3 ? `tarsal_5_${side[0]}` : d === 4 ? `tarsal_6_${side[0]}` : `tarsal_7_${side[0]}`,
        girth: 0.0046, joint: 'hinge', side,
      });
    }
    for (let d = 2; d <= 5; d++) {
      const base = mtEnds[d - 2];
      const spread = (d - 3.5) * 0.002;
      const p1: V3 = base;
      const p2: V3 = [base[0] + Math.sign(base[0]) * spread, 0.018, base[2] + 0.041];
      const p3: V3 = [p2[0] + Math.sign(base[0]) * spread, 0.010, p2[2] + 0.039];
      const p4: V3 = [p3[0] + Math.sign(base[0]) * spread, 0.005, p3[2] + 0.034];
      seg(B, `iph_${d}_prox_${side[0]}`, `Proximal phalanx ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'hindlimb', p1, p2, { parent: `mt_${d}_${side[0]}`, girth: 0.0039, joint: 'hinge', side });
      seg(B, `iph_${d}_mid_${side[0]}`, `Middle phalanx ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'hindlimb', p2, p3, { parent: `iph_${d}_prox_${side[0]}`, girth: 0.0034, joint: 'hinge', side });
      seg(B, `iph_${d}_dist_${side[0]}`, `Distal phalanx + claw ${['II', 'III', 'IV', 'V'][d - 2]} (${side})`, 'hindlimb', p3, p4, { parent: `iph_${d}_mid_${side[0]}`, girth: 0.003, joint: 'hinge', side });
    }
    // MT1 — vestigial, medial
    seg(B, `mt_1_${side[0]}`, `Metatarsal I (vestigial) (${side})`, 'hindlimb',
      [s * 0.086, 0.056, -0.203], [s * 0.077, 0.047, -0.172],
      { parent: `tarsal_4_${side[0]}`, girth: 0.0032, joint: 'hinge', side });
  }

  /* ---------------- Tail — Cd1..Cd21 ---------------- */
  const tailBase = segA('tail_0'); // (0, 0.6912, -0.5000)
  const tailCurve: V3[] = [
    [tailBase.x, tailBase.y, tailBase.z],
    [0.020, tailBase.y + 0.190, -0.700 * zScale],
    [0.085, tailBase.y + 0.320, -0.570 * zScale],
    [0.165, tailBase.y + 0.350, -0.370 * zScale],
    [0.235, tailBase.y + 0.345, -0.160 * zScale],
  ];
  const tailPts = sampleCatmullRom(tailCurve, 22);
  for (let i = 0; i < 21; i++) {
    const t = i / 21;
    seg(B, `cd_${i + 1}`, `Caudal ${i + 1}`, 'tail', tailPts[i], tailPts[i + 1], {
      parent: i === 0 ? 'sacrum' : `cd_${i}`,
      girth: 0.0135 - t * 0.0085,
      joint: 'gliding',
    });
  }

  return B;
}

/* Cubic-free Catmull-Rom sampler (no dependencies). */
function sampleCatmullRom(points: V3[], count: number): V3[] {
  const out: V3[] = [];
  const get = (i: number): V3 => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let s = 0; s < count; s++) {
    const t = (s / (count - 1)) * (points.length - 1);
    const i = Math.floor(t);
    const u = t - i;
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const cr = (a: number, b: number, c: number, d: number): number => {
      const v0 = (c - a) * 0.5, v1 = (d - b) * 0.5;
      const u2 = u * u, u3 = u2 * u;
      return (2 * b - 2 * c + v0 + v1) * u3 + (-3 * b + 3 * c - 2 * v0 - v1) * u2 + v0 * u + b;
    };
    out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}
