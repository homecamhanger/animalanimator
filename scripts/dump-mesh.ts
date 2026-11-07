/**
 * dump-mesh.ts — exports the assembled kitten as plain triangles
 * (world-space positions + indices) so scripts/render-preview.py can
 * rasterise an orthographic preview without a GPU.
 *
 * Usage: npx tsx scripts/dump-mesh.ts <pose> <weight> <out.json>
 */

const gradientStub = { addColorStop: () => undefined };
const contextStub = new Proxy<Record<string | symbol, unknown>>(
  {},
  {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradientStub;
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'canvas') return { width: 512, height: 512 };
      return () => undefined;
    },
    set() {
      return true;
    },
  },
);
(globalThis as Record<string, unknown>).document = {
  createElement: () => ({ width: 512, height: 512, getContext: () => contextStub }),
};

import { writeFileSync } from 'node:fs';
import { buildKitten } from '../src/animal/kitten';
import * as THREE from 'three';

const [, , poseArg = 'standing', weightArg = '1.0', outArg = '/tmp/kitten-mesh.json'] = process.argv;
const weight = Number(weightArg);

const build = buildKitten({ weight, pose: poseArg as never, coat: 'orangeTabby' });
if (process.argv[5] === 'lids-closed') {
  const internals = build.group.userData.internals as { openEyes: THREE.Group };
  for (const eye of internals.openEyes.children) {
    const squash = eye.userData.squash as THREE.Group | undefined;
    if (squash) squash.scale.y = Number(process.env.LIDX ?? 0.07);
  }
} else if (process.argv[5] === 'lids-half') {
  const internals = build.group.userData.internals as { openEyes: THREE.Group };
  for (const eye of internals.openEyes.children) {
    const squash = eye.userData.squash as THREE.Group | undefined;
    if (squash) squash.scale.y = 1 - 0.55 * 0.93;
  }
}
build.group.updateMatrixWorld(true);

const triangles: Array<{ a: number[]; b: number[]; c: number[]; na?: number[]; nb?: number[]; nc?: number[]; color?: string; colors?: string[]; mesh?: string }> = [];
const colorFor = (mesh: THREE.Mesh): string => {
  const material = mesh.material as THREE.MeshStandardMaterial;
  if (material.map) return '#c98a44'; // mapped fur
  const hex = (material.color?.getHex?.() ?? 0xcccccc) as number;
  return `#${hex.toString(16).padStart(6, '0')}`;
};

build.group.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return;
  const colorAttribute = geometry.getAttribute('color'); // MC skin carries vertex colours
  const normalAttribute = geometry.getAttribute('normal');
  const color = colorFor(mesh);
  const matrix = mesh.matrixWorld;
  const vertex = new THREE.Vector3();
  const read = (index: number): number[] => {
    vertex.fromBufferAttribute(position, index).applyMatrix4(matrix);
    return [vertex.x, vertex.y, vertex.z];
  };
  const readNormal = (index: number): number[] | null => {
    if (!normalAttribute) return null;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    vertex.fromBufferAttribute(normalAttribute, index).applyMatrix3(normalMatrix);
    const length = Math.hypot(vertex.x, vertex.y, vertex.z) || 1;
    return [vertex.x / length, vertex.y / length, vertex.z / length];
  };
  const readColor = (index: number): string | null => {
    if (!colorAttribute) return null;
    const r = Math.round(Math.min(1, Math.max(0, colorAttribute.getX(index))) * 255);
    const g = Math.round(Math.min(1, Math.max(0, colorAttribute.getY(index))) * 255);
    const b = Math.round(Math.min(1, Math.max(0, colorAttribute.getZ(index))) * 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };
  const pushTri = (i0: number, i1: number, i2: number) => {
    const tri: { a: number[]; b: number[]; c: number[]; na?: number[]; nb?: number[]; nc?: number[]; color?: string; colors?: string[]; mesh?: string } = {
      mesh: mesh.name,
      a: read(i0),
      b: read(i1),
      c: read(i2),
    };
    const n0 = readNormal(i0), n1 = readNormal(i1), n2 = readNormal(i2);
    if (n0 && n1 && n2) {
      tri.na = n0;
      tri.nb = n1;
      tri.nc = n2;
    }
    if (colorAttribute) {
      tri.colors = [readColor(i0)!, readColor(i1)!, readColor(i2)!];
    } else {
      tri.color = color;
    }
    triangles.push(tri);
  };
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      pushTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i < position.count; i += 3) pushTri(i, i + 1, i + 2);
  }
});

writeFileSync(outArg, JSON.stringify({ pose: poseArg, weight, triangles }));
console.log(`Wrote ${triangles.length} triangles → ${outArg}`);
