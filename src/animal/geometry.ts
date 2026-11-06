import * as THREE from 'three';

/**
 * geometry.ts — what remains of the hand-rolled mesh builders after the skin
 * went implicit (Marching Cubes over the skeleton in kitten.ts).
 *
 *   buildTaperedTube — swept, radius-varying tube along a curve (whiskers).
 *   limbBetween      — tapered limb segment between two points.
 */
export function buildTaperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments = 40,
  radialSegments = 12,
  radiusFn: (t: number) => number = () => 0.05,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const vertsPerRing = radialSegments + 1;
  const ringVerts = (tubularSegments + 1) * vertsPerRing;
  const capStart = ringVerts;
  const capEnd = ringVerts + 1;
  const positions = new Float32Array((ringVerts + 2) * 3);
  const uvs = new Float32Array((ringVerts + 2) * 2);

  let p = 0;
  let u = 0;
  const point = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, point);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const radius = radiusFn(t);
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      positions[p++] = point.x + radius * (cos * normal.x + sin * binormal.x);
      positions[p++] = point.y + radius * (cos * normal.y + sin * binormal.y);
      positions[p++] = point.z + radius * (cos * normal.z + sin * binormal.z);
      uvs[u++] = j / radialSegments;
      uvs[u++] = t;
    }
  }
  const p0 = curve.getPointAt(0, new THREE.Vector3());
  const p1 = curve.getPointAt(1, new THREE.Vector3());
  positions[p++] = p0.x;
  positions[p++] = p0.y;
  positions[p++] = p0.z;
  positions[p++] = p1.x;
  positions[p++] = p1.y;
  positions[p++] = p1.z;
  uvs[u++] = 0.5;
  uvs[u++] = 0;
  uvs[u++] = 0.5;
  uvs[u++] = 1;

  const indices: number[] = [];
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * vertsPerRing + j;
      const b = a + 1;
      const c = a + vertsPerRing;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const lastRingStart = tubularSegments * vertsPerRing;
  for (let j = 0; j < radialSegments; j++) {
    indices.push(capStart, j + 1, j);
    indices.push(capEnd, lastRingStart + j, lastRingStart + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Convenience: limb segment (tapered cylinder) between two points. */
export function limbBetween(
  radiusBottom: number,
  radiusTop: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radialSegments = 18,
): THREE.BufferGeometry {
  const height = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geometry.applyQuaternion(quaternion);
  geometry.translate(mid.x, mid.y, mid.z);
  return geometry;
}

export function countVertices(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) count += mesh.geometry.attributes.position?.count ?? 0;
  });
  return count;
}

export function countTriangles(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const index = mesh.geometry.index;
      count += index ? index.count / 3 : (mesh.geometry.attributes.position?.count ?? 0) / 3;
    }
  });
  return Math.round(count);
}

/** Dispose every geometry in a subtree (materials are cached/shared, keep them). */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Line).type === 'LineSegments') {
      (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose();
    }
  });
}
