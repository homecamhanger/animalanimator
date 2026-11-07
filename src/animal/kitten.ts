/**
 * kitten.ts — procedural kitten built as ONE continuous fur mesh.
 *
 * The body is an implicit field over a solved bone skeleton (see
 * skeleton.ts), polygonised by Marching Cubes (see fur.ts). Legs, haunches,
 * ears, muzzle and tail are not objects glued to the body — they are denser
 * bone rows inside the same field, so the skin flows over them with no seams.
 *
 * What is NOT fur (and lives outside the skin mesh): eyes, pupils, glints,
 * the nose + philtrum, inner-ear pink lozenges, whisker tubes.
 *
 * Coordinate system: y-up, floor at y = 0, kitten faces +z.
 */

import * as THREE from 'three';
import { buildTaperedTube, limbBetween, countVertices, countTriangles, disposeGeometries } from './geometry';
import { coatById, type CoatId } from './coats';
import { buildSkinGeometry, makeFurMaterial, surfaceDistance } from './fur';
import { solveSkeleton } from './skeleton';
import type { LegTuning } from './tuning';
import { POSE_PARAMS, type PoseId } from './profiles';

export interface KittenOptions {
  /** 0.65 (skinny) .. 1.7 (mega-chonk). 1.0 = average adult. */
  weight: number;
  pose: PoseId;
  coat: CoatId;
  /** Optional leg-tuning overrides (UI sliders). Missing fields fall back to the pose defaults. */
  tuning?: Partial<LegTuning>;
}

export interface KittenMetrics {
  vertices: number;
  triangles: number;
  buildMs: number;
}

export interface KittenBuild {
  group: THREE.Group;
  dispose: () => void;
  metrics: KittenMetrics;
}

/* ------------------------------------------------------------------ */
/* Materials shared across rebuilds (geometries are disposed per build) */
/* ------------------------------------------------------------------ */

const sharedMats = {
  nose: new THREE.MeshStandardMaterial({ color: '#e3879a', roughness: 0.42, envMapIntensity: 0.8 }),
  innerEar: new THREE.MeshStandardMaterial({ color: '#eda3ae', roughness: 0.75, envMapIntensity: 0.4 }),
  pupil: new THREE.MeshStandardMaterial({ color: '#171210', roughness: 0.3 }),
  closedEye: new THREE.MeshStandardMaterial({ color: '#2b211b', roughness: 0.6 }),
  glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  whisker: new THREE.MeshStandardMaterial({
    color: '#f5f1e6',
    roughness: 0.55,
    transparent: true,
    opacity: 0.85,
  }),
};

const eyeMaterials = new Map<CoatId, THREE.MeshStandardMaterial>();
function eyeMaterial(id: CoatId): THREE.MeshStandardMaterial {
  let cached = eyeMaterials.get(id);
  if (!cached) {
    const spec = coatById(id);
    cached = new THREE.MeshStandardMaterial({
      color: spec.eye,
      roughness: 0.16,
      metalness: 0.05,
      emissive: spec.eye,
      emissiveIntensity: 0.28,
      envMapIntensity: 1.15,
    });
    eyeMaterials.set(id, cached);
  }
  return cached;
}

const furMaterials = new Map<CoatId, THREE.MeshStandardMaterial>();
function furMaterial(id: CoatId): THREE.MeshStandardMaterial {
  let cached = furMaterials.get(id);
  if (!cached) {
    cached = makeFurMaterial(coatById(id));
    furMaterials.set(id, cached);
  }
  return cached;
}

export interface KittenInternals {
  skinMesh: THREE.Mesh;
  openEyes: THREE.Group;
  /** Common parent of skin and every accessory — idle motion scales this so
   *  features never detach from the fur as it swells. */
  breathRoot: THREE.Group;
}

export function buildKitten(options: KittenOptions): KittenBuild {
  const started = performance.now();
  const pose = POSE_PARAMS[options.pose];
  const spec = coatById(options.coat);
  const skeleton = solveSkeleton(options.pose, options.weight, options.tuning);

  const root = new THREE.Group();
  root.name = 'kitten';

  const mark = (mesh: THREE.Mesh): THREE.Mesh => {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  };

  /* ------------------- The one and only fur mesh ------------------- */

  const skin = buildSkinGeometry(skeleton.balls, spec);
  const skinMesh = mark(new THREE.Mesh(skin.geometry, furMaterial(options.coat)));
  skinMesh.name = 'skin';

  // The isosurface bulges well past the analytic bone radii, so the only
  // reliable grounding is measured on the built skin: shift the whole
  // build up so the lowest skin point lands on the contact target
  // (paws for leg poses, belly for loaf/curled).
  skin.geometry.computeBoundingBox();
  const measuredMinY = skin.geometry.boundingBox!.min.y;
  const contactTarget = pose.legsVisible ? 0.002 : pose.floorY;
  const floorLift = contactTarget - measuredMinY;

  // Everything is assembled inside bodyGroup so the correction applies
  // to skin and accessories alike (alignment preserved).
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = floorLift;
  bodyGroup.add(skinMesh);
  root.add(bodyGroup);

  /* --------- Non-fur features, snapped onto the isosurface ----------- */
  // Every accessory is raymarched against the actual field so it sits on the
  // fur at ANY weight/pose — never swallowed by the isosurface, never floating.
  const { headPos, headMul, cheekMul } = skeleton.anchors;
  const headQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.headPitch, pose.headYaw, 0, 'YXZ'),
  );
  // Feature offsets live in head-local units and scale with the skull.
  const localWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x * headMul, y * headMul, z * headMul).applyQuaternion(headQuat).add(headPos);
  const headDir = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).normalize().applyQuaternion(headQuat);
  // Socketless field for eye placement — eyes nest into the carved sockets,
  // so they anchor to the skull surface without the dent contribution.
  const socketless = skeleton.balls.filter((ball) => !ball.dent);
  /** March from a head-local offset point along a world direction; return the surface hit. */
  const snapFromLocal = (lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, embed: number, ignoreDents = false) => {
    const origin = localWorld(lx, ly, lz);
    const dir = headDir(dx, dy, dz);
    const t = surfaceDistance(ignoreDents ? socketless : skeleton.balls, origin, dir);
    return { point: origin.clone().addScaledVector(dir, t + embed), dir };
  };
  const faceQuat = (dir: THREE.Vector3): THREE.Quaternion =>
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

  // Eyes — one group per eye so blinking squashes each eye about its own frame.
  const openEyes = new THREE.Group();
  openEyes.name = 'openEyes';
  const closedEyes = new THREE.Group();
  closedEyes.name = 'closedEyes';
  const eyeMaterialFor = eyeMaterial(options.coat);
  // No separate eyelid objects — a cat's eyelid is a monolid fold. The blink
  // is a top-down wipe: an inner "squash" group pivots at the eye's lower
  // rim, so scaling its Y collapses the eye (and pupil, and glint) onto that
  // rim line — the upper lid sweeping down, as one motion. The eyeball
  // itself never translates out through the skull.
  const EYE_PIVOT = 0.055; // just inside the lower rim of the eyeball
  for (const side of [-1, 1]) {
    // Snap onto the SOCKETLESS skull surface — the carved socket dish wraps
    // the eyeball like a rim, instead of the eyeball sinking into the dish
    // bottom (which read as "eyes set too far back").
    const { point, dir } = snapFromLocal(side * 0.135, 0.058, 0.02, side * 0.1, 0.06, 1, -0.008, true);
    const eyeGroup = new THREE.Group();
    eyeGroup.position.copy(point);
    eyeGroup.quaternion.copy(faceQuat(dir));

    // Everything shifts up by the pivot offset; squashing collapses to the
    // lower rim.
    const squash = new THREE.Group();
    squash.position.y = -EYE_PIVOT;
    eyeGroup.add(squash);
    const lift = (obj: THREE.Object3D): void => {
      obj.position.y += EYE_PIVOT;
      squash.add(obj);
    };

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 20, 16), eyeMaterialFor);
    eye.scale.set(0.92, 1.18, 0.55);
    lift(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0295, 12, 10), sharedMats.pupil);
    pupil.scale.set(0.52, 1.05, 0.52);
    pupil.position.set(0, 0.002, 0.0282);
    lift(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 8), sharedMats.glint);
    glint.position.set(-0.016, 0.022, 0.044);
    lift(glint);

    mark(eye);
    eyeGroup.userData.squash = squash;
    openEyes.add(eyeGroup);

    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.051, 0.011, 8, 20, Math.PI),
      sharedMats.closedEye,
    );
    const arcSnap = snapFromLocal(side * 0.135, 0.058, 0.02, side * 0.1, 0.06, 1, 0.004, true);
    arc.position.copy(arcSnap.point);
    arc.quaternion.copy(faceQuat(arcSnap.dir));
    closedEyes.add(arc);
  }
  openEyes.visible = pose.eyesOpen;
  closedEyes.visible = !pose.eyesOpen;
  bodyGroup.add(openEyes, closedEyes);

  // Nose + philtrum, proud of the muzzle surface.
  {
    const noseSnap = snapFromLocal(0, -0.082, 0.05, 0, -0.12, 1, 0.002);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.033, 14, 12), sharedMats.nose);
    nose.scale.set(1.3, 0.78, 0.58);
    nose.position.copy(noseSnap.point);
    nose.quaternion.copy(faceQuat(noseSnap.dir));
    mark(nose);
    bodyGroup.add(nose);
    const upper = snapFromLocal(0, -0.125, 0.03, 0, -0.16, 1, 0.004).point;
    const lower = snapFromLocal(0, -0.17, 0.015, 0, -0.2, 1, 0.004).point;
    const philtrum = new THREE.Mesh(
      limbBetween(0.006, 0.006, upper, lower, 8),
      sharedMats.nose,
    );
    mark(philtrum);
    bodyGroup.add(philtrum);
  }

  // Inner-ear pink lozenges — raymarch out along each ear's direction and lie
  // them on the ear surface.
  for (const { base, dir } of skeleton.anchors.earDirs) {
    // Lozenge lies on the FORWARD face of the ear's middle segment (like a
    // real pinna). Its outward normal is face-forward with the ear-axis
    // component removed — a ray along it can only exit through the ear.
    const anchor = base.clone().addScaledVector(dir, 0.1125 * headMul);
    const forward = headDir(0, 0.15, 1);
    const along = dir.clone().normalize();
    const normal = forward.clone().addScaledVector(along, -forward.dot(along)).normalize();
    const t = surfaceDistance(skeleton.balls, anchor, normal);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sharedMats.innerEar);
    inner.scale.set(0.043 * headMul, 0.055 * headMul, 0.015 * headMul);
    inner.position.copy(anchor).addScaledVector(normal, t + 0.005);
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mark(inner);
    bodyGroup.add(inner);
  }

  // Whiskers — bases locked to the muzzle/cheek surface; reach extends with
  // jowl growth so they never vanish into a big-cheeked face.
  const whiskerReach = 1 + (cheekMul - 1) * 0.75;
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const snapDir = headDir(side * 0.72, -0.34 + k * 0.1, 0.66);
      const baseT = surfaceDistance(skeleton.balls, localWorld(side * 0.06, -0.115 + k * 0.017, 0.04), snapDir);
      const base = localWorld(side * 0.06, -0.115 + k * 0.017, 0.04).addScaledVector(snapDir, baseT - 0.004);
      // Arc: out, slightly up/back — extra length at high weights.
      const spread = 0.155 * whiskerReach;
      const mid = base.clone().add(new THREE.Vector3(side * spread, 0.028 + k * 0.03, 0.055));
      const tip = base.clone().add(new THREE.Vector3(side * spread * 1.95, 0.062 + k * 0.052, -0.055 - Math.abs(k) * 0.03));
      const curve = new THREE.QuadraticBezierCurve3(base, mid, tip);
      const whisker = new THREE.Mesh(
        buildTaperedTube(curve, 8, 5, () => 0.0031),
        sharedMats.whisker,
      );
      bodyGroup.add(whisker);
    }
  }

  const builtMs = performance.now() - started;
  const internals: KittenInternals = { skinMesh, openEyes, breathRoot: bodyGroup };
  root.userData.internals = internals;

  return {
    group: root,
    dispose: () => disposeGeometries(root),
    metrics: {
      vertices: countVertices(root),
      triangles: countTriangles(root),
      buildMs: Math.round(builtMs * 10) / 10,
    },
  };
}
