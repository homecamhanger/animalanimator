/**
 * render-skinned.ts — headless proof of the DQS bind.
 *
 * Builds the standing kitten, deforms its skin into a pose with the skinRig
 * deltas + dual-quaternion blend, and writes .scratch/skinned-<pose>.json for
 * scripts/render-preview.py.
 *
 * Usage: npx tsx scripts/render-skinned.ts <pose=sitting|loaf|stretch|curled|standing> [weight=1.0]
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

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildKitten } from '../src/animal/kitten';
import { buildAnatomy } from '../src/animal/anatomy';
import { computeSkinWeights } from '../src/animal/skinWeights';
import { getPoseDeformation } from '../src/animal/skinRig';
import { deformSkin } from '../src/animal/skinning';
import { POSE_PARAMS, type PoseId } from '../src/animal/profiles';
import * as THREE from 'three';

const pose = (process.argv[2] ?? 'sitting') as PoseId;
if (!POSE_PARAMS[pose]) {
  console.error(`Unknown pose '${pose}'. Expected one of: ${Object.keys(POSE_PARAMS).join(', ')}`);
  process.exit(1);
}
const weight = Number(process.argv[3] ?? '1.0');

const build = buildKitten({ weight, pose: 'standing', coat: 'orangeTabby' });
const internals = build.group.userData.internals as { skinMesh: THREE.Mesh };
const skin = internals.skinMesh;
const geometry = skin.geometry;
const position = geometry.getAttribute('position') as THREE.BufferAttribute;
const restPos = new Float32Array(position.array as Float32Array);
const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
const restNrm = new Float32Array(normalAttr.array as Float32Array);
const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
const restCol = new Float32Array(colorAttr.array as Float32Array);
console.log(`Standing @ w=${weight} — ${position.count} vertices`);

const t0 = Date.now();
const bones = buildAnatomy();
const sw = computeSkinWeights(position, bones);
const t1 = Date.now();
const { deltas } = getPoseDeformation(pose, weight);
const t2 = Date.now();
const outPos = new Float32Array(restPos.length);
const outNrm = new Float32Array(restNrm.length);
deformSkin(restPos, restNrm, outPos, outNrm, sw, deltas);
const t3 = Date.now();
console.log(`weights ${t1 - t0} ms · deltas ${t2 - t1} ms · deform ${t3 - t2} ms`);

// Re-apply the grounding correction exactly like kitten.ts: shift the whole
// pose so the lowest skin point lands on the contact target (paws for leg
// poses, belly for loaf/curled). The standing geometry lives in the raw
// solve frame, so the deformed pose must be re-referenced to the floor.
const poseParams = POSE_PARAMS[pose] as { legsVisible: boolean; floorY: number };
let minY = Infinity;
for (let i = 1; i < outPos.length; i += 3) if (outPos[i] < minY) minY = outPos[i];
const contactTarget = poseParams.legsVisible ? 0.002 : poseParams.floorY;
const floorLift = contactTarget - minY;
for (let i = 1; i < outPos.length; i += 3) outPos[i] += floorLift;
console.log(`floorLift ${floorLift.toFixed(4)} (minY ${minY.toFixed(4)} → ${contactTarget})`);

// Displacement stats vs the standing build.
let maxD = 0, sumD = 0;
for (let i = 0; i < outPos.length; i += 3) {
  const d = Math.hypot(outPos[i] - restPos[i], outPos[i + 1] - restPos[i + 1], outPos[i + 2] - restPos[i + 2]);
  if (d > maxD) maxD = d;
  sumD += d;
}
console.log(`displacement — max ${maxD.toFixed(4)}  mean ${(sumD / (outPos.length / 3)).toFixed(4)}`);

const hex = (c: Float32Array, i: number): string => {
  const r = Math.round(Math.min(1, Math.max(0, c[i * 3])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[i * 3 + 1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[i * 3 + 2])) * 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};
const outTris: Array<Record<string, unknown>> = [];
for (let i = 0; i < outPos.length; i += 9) {
  const v = i / 3;
  outTris.push({
    mesh: 'skin',
    a: [outPos[i], outPos[i + 1], outPos[i + 2]],
    b: [outPos[i + 3], outPos[i + 4], outPos[i + 5]],
    c: [outPos[i + 6], outPos[i + 7], outPos[i + 8]],
    na: [outNrm[i], outNrm[i + 1], outNrm[i + 2]],
    nb: [outNrm[i + 3], outNrm[i + 4], outNrm[i + 5]],
    nc: [outNrm[i + 6], outNrm[i + 7], outNrm[i + 8]],
    colors: [hex(restCol, v), hex(restCol, v + 1), hex(restCol, v + 2)],
  });
}
mkdirSync('.scratch', { recursive: true });
const out = `.scratch/skinned-${pose}.json`;
writeFileSync(out, JSON.stringify({ pose, weight, triangles: outTris }));
console.log(`Wrote ${out} (${outTris.length} triangles)`);
process.exit(0);
