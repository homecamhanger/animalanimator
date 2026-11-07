/**
 * skeletonScene.ts — renders the anatomical skeleton (animal/anatomy.ts) as a
 * THREE.Group of bones. Pure presentation: no geometry off the buildAnatomy()
 * data model, so the 3D skeleton and the JSON preview can never drift apart.
 *
 * Coordinate frame: floor y=0, facing +z, standing rest pose — the same frame
 * the furry mesh lives in, so the two can be overlaid.
 */
import * as THREE from 'three';
import {
  buildAnatomy,
  ANATOMY_REGIONS,
  type AnatomicalBone,
  type AnatomyRegion,
} from '../animal/anatomy';

export type SkeletonMode = 'off' | 'overlay' | 'bones-only';

export const REGION_COLORS: Record<AnatomyRegion, number> = {
  skull: 0xf2e9d4,
  spine: 0xe6d2a6,
  ribcage: 0xcfc0a0,
  forelimb: 0xeed0a0,
  hindlimb: 0xe2bda1,
  tail: 0xd9cbb0,
};

const JOINT_COLOR = 0x84684a;

/** Reusable bone-material set, one per region + one shared joint material. */
function regionMaterials(): Record<AnatomyRegion, THREE.MeshStandardMaterial> {
  const out = {} as Record<AnatomyRegion, THREE.MeshStandardMaterial>;
  for (const region of ANATOMY_REGIONS) {
    out[region] = new THREE.MeshStandardMaterial({
      color: REGION_COLORS[region],
      roughness: 0.42,
      metalness: 0.08,
      emissive: REGION_COLORS[region],
      emissiveIntensity: 0.08,
      // plates are single-sided triangles; DoubleSide keeps them solid from any angle
      side: THREE.DoubleSide,
    });
  }
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);

function orient(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return;
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

/** Capsule (or capsule-like) bone between two points. */
function addCapsule(
  group: THREE.Group,
  bone: AnatomicalBone,
  mat: THREE.Material,
  jointMat: THREE.Material,
): void {
  const from = new THREE.Vector3(...bone.from);
  const to = new THREE.Vector3(...bone.to);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const radius = bone.girth;
  // Snapshot before the first `if (bone.via)` narrows the type away.
  const viaPt = bone.via ? new THREE.Vector3(...bone.via) : null;

  if (viaPt) {
    // Curved bone (ribs, mandible, zygomatic arches, caudals): tube along a
    // quadratic Bézier through `via`.
    const mid = viaPt;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const tubularSegments = Math.max(10, Math.floor(len / 0.014));
    const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, 7, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.bone = bone.id;
    group.add(mesh);
    return;
  }

  if (bone.shape === 'ellipsoid' && bone.radii) {
    // Cranium / sacrum: sphere scaled along the from→to (major) axis.
    const [semiMinor, semiMajor] = bone.radii; // [minor, major]; third slot unused
    const axis = len > 1e-6 ? len : semiMajor * 2;
    const geo = new THREE.SphereGeometry(semiMinor, 18, 14);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(1, axis / 2 / semiMinor, 1);
    mesh.castShadow = true;
    mesh.userData.bone = bone.id;
    orient(mesh, from, len > 1e-6 ? to : from.clone().add(new THREE.Vector3(0, 1, 0)));
    if (len <= 1e-6) mesh.position.copy(from);
    group.add(mesh);
    return;
  }

  if (bone.shape === 'plate' && viaPt) {
    // Flat bone (scapula, ilium): an arbitrary triangle — light but true to
    // "this is a slab, not a stick". Double-sided so it reads from behind.
    const via = viaPt;
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints([from, to, via]);
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.bone = bone.id;
    group.add(mesh);
    return;
  }

  const length = Math.max(0.001, len - radius * 2);
  const geo = new THREE.CapsuleGeometry(radius, length, 3, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.userData.bone = bone.id;
  orient(mesh, from, to);
  group.add(mesh);

  // Joint dots at each end — articulation markers. Fixed/suture joints get a
  // smaller peg so the ball-and-socket/condyloid joints read bigger.
  for (const p of [from, to]) {
    const r = bone.joint === 'fixed' || bone.joint === 'suture' ? radius * 0.62 : radius * 1.02;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.0016, r), 8, 6), jointMat);
    joint.position.copy(p);
    group.add(joint);
  }
}

/** Build the skeleton group. Fresh each call — dispose with disposeSkeleton(). */
export function buildSkeletonGroup(): THREE.Group {
  const bones = buildAnatomy();
  const group = new THREE.Group();
  group.name = 'anatomy-skeleton';

  const mats = regionMaterials();
  const jointMat = new THREE.MeshStandardMaterial({
    color: JOINT_COLOR,
    roughness: 0.35,
    metalness: 0.12,
  });

  for (const bone of bones) {
    const mat = mats[bone.region];
    addCapsule(group, bone, mat, jointMat);
  }

  return group;
}

export function disposeSkeleton(group: THREE.Group): void {
  const seen = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => seen.add(x));
      else seen.add(m);
    }
  });
  for (const m of seen) m.dispose();
}
