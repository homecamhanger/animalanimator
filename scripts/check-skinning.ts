/**
 * check-skinning.ts — invariants for the DQS binding.
 *
 * Asserts, for every pose, on the real fur mesh (standing Rest → posed):
 *   1. standing is the identity — max displacement below 1e-6
 *   2. all displaced positions and normals are finite; normals stay unit length
 *   3. coincident (duplicated shell) vertices displace IDENTICALLY — the
 *      no-crack guarantee for the unindexed isosurface
 *   4. displacement magnitude is sane per pose (no self-intersection runaway)
 *
 * Usage: npx tsx scripts/check-skinning.ts
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

import { buildKitten } from '../src/animal/kitten';
import { buildAnatomy } from '../src/animal/anatomy';
import { computeSkinWeights } from '../src/animal/skinWeights';
import { getPoseDeformation } from '../src/animal/skinRig';
import { deformSkin } from '../src/animal/skinning';
import { POSE_PARAMS, type PoseId } from '../src/animal/profiles';
import * as THREE from 'three';

let failures = 0;
const fail = (message: string): void => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};
const ok = (message: string): void => console.log(`  ✓ ${message}`);

const build = buildKitten({ weight: 1, pose: 'standing', coat: 'orangeTabby' });
const internals = build.group.userData.internals as { skinMesh: THREE.Mesh };
const geometry = internals.skinMesh.geometry;
const position = geometry.getAttribute('position') as THREE.BufferAttribute;
const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
const restPos = new Float32Array(position.array as Float32Array);
const restNrm = new Float32Array(normal.array as Float32Array);
const bones = buildAnatomy();
const sw = computeSkinWeights(position, bones);

// Pre-index coincident rest vertices so the no-crack check is O(n).
const twinGroups = new Map<string, number[]>();
for (let v = 0; v < sw.vertexCount; v++) {
  const key = `${restPos[v * 3]},${restPos[v * 3 + 1]},${restPos[v * 3 + 2]}`;
  const rows = twinGroups.get(key);
  if (rows) rows.push(v);
  else twinGroups.set(key, [v]);
}
const duplicated = [...twinGroups.values()].filter((rows) => rows.length > 1);
console.log(`Coincident rest vertices: ${twinGroups.size} unique, ${duplicated.length} with twins (${duplicated.reduce((a, r) => a + r.length, 0)} rows)`);
console.log();

for (const pose of Object.keys(POSE_PARAMS) as PoseId[]) {
  console.log(`Pose: ${pose}`);
  const { deltas } = getPoseDeformation(pose, 1);
  const outPos = new Float32Array(restPos.length);
  const outNrm = new Float32Array(restNrm.length);
  deformSkin(restPos, restNrm, outPos, outNrm, sw, deltas);

  // 1 — standing identity
  if (pose === 'standing') {
    let maxD = 0;
    for (let i = 0; i < outPos.length; i++) maxD = Math.max(maxD, Math.abs(outPos[i] - restPos[i]));
    maxD > 1e-6 ? fail(`standing displaced by ${maxD} (expected identity)`) : ok(`standing is identity (max |Δ| ${maxD.toExponential(2)})`);
  }

  // 2 — finite + unit normals
  let finite = true;
  let maxNormalErr = 0;
  for (let i = 0; i < outNrm.length; i += 3) {
    const x = outPos[i], y = outPos[i + 1], z = outPos[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
    const nx = outNrm[i], ny = outNrm[i + 1], nz = outNrm[i + 2];
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) finite = false;
    const len = Math.hypot(nx, ny, nz);
    const err = Math.abs(len - 1);
    if (err > maxNormalErr) maxNormalErr = err;
  }
  finite ? ok('positions and normals all finite') : fail('non-finite vertex detected');
  maxNormalErr <= 1e-3 ? ok(`normals unit length (max err ${maxNormalErr.toExponential(2)})`) : fail(`normal length drift ${maxNormalErr}`);

  // 3 — coincident rows displace identically (no-crack)
  let worstTwin = 0;
  for (const rows of twinGroups.values()) {
    if (rows.length < 2) continue;
    const a = rows[0];
    for (let r = 1; r < rows.length; r++) {
      const b = rows[r];
      const d = Math.hypot(
        outPos[a * 3] - outPos[b * 3],
        outPos[a * 3 + 1] - outPos[b * 3 + 1],
        outPos[a * 3 + 2] - outPos[b * 3 + 2],
      );
      if (d > worstTwin) worstTwin = d;
    }
  }
  worstTwin <= 1e-6 ? ok(`coincident vertices displace identically (max twin Δ ${worstTwin.toExponential(2)})`) : fail(`cracked shell: twin Δ ${worstTwin}`);

  // 4 — displacement magnitude sanity (self-intersection runaway detector)
  let maxD = 0, sumD = 0;
  for (let i = 0; i < outPos.length; i += 3) {
    const d = Math.hypot(outPos[i] - restPos[i], outPos[i + 1] - restPos[i + 1], outPos[i + 2] - restPos[i + 2]);
    if (d > maxD) maxD = d;
    sumD += d;
  }
  const meanD = sumD / sw.vertexCount;
  maxD < 1.6 && meanD < 0.9 ? ok(`displacement sane (max ${maxD.toFixed(3)}, mean ${meanD.toFixed(3)})`) : fail(`runaway displacement max ${maxD.toFixed(3)} mean ${meanD.toFixed(3)}`);
  console.log();
}

if (failures > 0) {
  console.error(`check-skinning FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log('check-skinning OK');
process.exit(0);
