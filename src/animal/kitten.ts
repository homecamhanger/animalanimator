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
import { buildSkinGeometry, makeFurMaterial } from './fur';
import { solveSkeleton } from './skeleton';
import { POSE_PARAMS, type PoseId } from './profiles';

export interface KittenOptions {
  /** 0.65 (skinny) .. 1.7 (mega-chonk). 1.0 = average adult. */
  weight: number;
  pose: PoseId;
  coat: CoatId;
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
  headBaseY: number;
}

export function buildKitten(options: KittenOptions): KittenBuild {
  const started = performance.now();
  const pose = POSE_PARAMS[options.pose];
  const spec = coatById(options.coat);
  const skeleton = solveSkeleton(options.pose, options.weight);

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

  /* ---------------- Head frame for non-fur accessories -------------- */

  const { headPos, headMul, headBaseY } = skeleton.anchors;
  const headGroup = new THREE.Group();
  headGroup.name = 'head';
  headGroup.position.copy(headPos);
  headGroup.rotation.order = 'YXZ';
  headGroup.rotation.x = pose.headPitch;
  headGroup.rotation.y = pose.headYaw;
  headGroup.scale.setScalar(headMul);
  root.add(headGroup);

  const addLocal = (mesh: THREE.Mesh): THREE.Mesh => {
    mark(mesh);
    headGroup.add(mesh);
    return mesh;
  };

  // Nose + philtrum — sits proud of the muzzle ball.
  const nose = addLocal(new THREE.Mesh(new THREE.SphereGeometry(0.033, 14, 12), sharedMats.nose));
  nose.scale.set(1.3, 0.78, 0.58);
  nose.position.set(0, -0.082, 0.285);
  addLocal(
    new THREE.Mesh(
      limbBetween(0.006, 0.006, new THREE.Vector3(0, -0.099, 0.28), new THREE.Vector3(0, -0.151, 0.262), 8),
      sharedMats.nose,
    ),
  );

  // Eyes — open group (pupils + glints) or a closed happy arc.
  const openEyes = new THREE.Group();
  const closedEyes = new THREE.Group();
  const eyeY = 0.032;
  const eyeZ = 0.196;
  for (const side of [-1, 1]) {
    const ex = side * 0.141;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0575, 20, 16), eyeMaterial(options.coat));
    eye.scale.set(1, 1.14, 0.68);
    eye.position.set(ex, eyeY, eyeZ);
    openEyes.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0295, 12, 10), sharedMats.pupil);
    pupil.scale.set(0.52, 1.05, 0.52);
    pupil.position.set(ex, eyeY + 0.002, eyeZ + 0.0335);
    openEyes.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 8), sharedMats.glint);
    glint.position.set(ex - 0.017, eyeY + 0.023, eyeZ + 0.0525);
    openEyes.add(glint);

    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.051, 0.011, 8, 20, Math.PI),
      sharedMats.closedEye,
    );
    arc.position.set(ex, eyeY + 0.012, eyeZ + 0.042);
    closedEyes.add(arc);
  }
  openEyes.visible = pose.eyesOpen;
  closedEyes.visible = !pose.eyesOpen;
  headGroup.add(openEyes, closedEyes);

  // Inner-ear pink lozenges, lying on the marching-cubes ear chain.
  for (const { base, dir, side } of skeleton.anchors.earDirs) {
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), sharedMats.innerEar);
    inner.scale.set(0.042 * headMul, 0.068 * headMul, 0.016 * headMul);
    const mid = base.clone().add(dir.clone().multiplyScalar(0.062 * headMul));
    inner.position.copy(mid);
    // Orient the lozenge's short axis along the ear direction.
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    // Shift to the front face of the ear chain.
    inner.position.add(dir.clone().multiplyScalar(0.028));
    mark(inner);
    bodyGroup.add(inner);
    void side;
  }

  // Whiskers — thin swept tubes arcing out from the muzzle.
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const base = new THREE.Vector3(side * 0.1, -0.104 + k * 0.017, 0.235);
      const mid = new THREE.Vector3(side * 0.27, -0.092 + k * 0.028, 0.31);
      const tip = new THREE.Vector3(side * 0.425, -0.07 + k * 0.052, 0.215 - Math.abs(k) * 0.05);
      const curve = new THREE.QuadraticBezierCurve3(base, mid, tip);
      const whisker = new THREE.Mesh(
        buildTaperedTube(curve, 8, 5, () => 0.0031),
        sharedMats.whisker,
      );
      headGroup.add(whisker);
    }
  }

  const builtMs = performance.now() - started;
  const internals: KittenInternals = { skinMesh, openEyes, headBaseY };
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
