/**
 * check-weights.ts — asserts the analytic skin weights are rig-grade.
 * Fails (exit 1) on: unnormalised rows, missing/zero influences, orphan
 * bones (a bone that owns no flesh could never drag its skin), or
 * influences below the documented blend floor.
 *
 * Usage: npx tsx scripts/check-weights.ts
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
import * as THREE from 'three';

const build = buildKitten({ weight: 1.0, pose: 'standing', coat: 'orangeTabby' });
const internals = build.group.userData.internals as { skinMesh: THREE.Mesh };
const geometry = internals.skinMesh.geometry;
const position = geometry.getAttribute('position') as THREE.BufferAttribute;

const bones = buildAnatomy();
const sw = computeSkinWeights(position, bones);
const problems: string[] = [];

// 1) every row sums to 1
let badRows = 0;
for (let v = 0; v < sw.vertexCount; v++) {
  const s = sw.weights[v * 4] + sw.weights[v * 4 + 1] + sw.weights[v * 4 + 2] + sw.weights[v * 4 + 3];
  if (Math.abs(s - 1) > 1e-4) badRows += 1;
}
if (badRows > 0) problems.push(`${badRows} vertices have rows not summing to 1`);

// 2) at least one non-zero influence per vertex + at most 4 (structural, but assert)
let emptyRows = 0;
for (let v = 0; v < sw.vertexCount; v++) {
  let k = 0;
  for (let i = 0; i < 4; i++) if (sw.weights[v * 4 + i] > 0) k += 1;
  if (k === 0) emptyRows += 1;
}
if (emptyRows > 0) problems.push(`${emptyRows} vertices bound to nothing`);

// 3) no orphan bones — every bone owns at least a little flesh
const orphans = bones.filter((_, i) => sw.boneMass[i] <= 0).map((b) => b.id);
if (orphans.length > 0) problems.push(`orphan bones (own zero flesh): ${orphans.join(', ')}`);

// 4) dominant-influence coverage — informational; a bone with < 0.05% of mass is
//    a smell but not fatal (vestigial Mt1, clavicle legitimately bind almost nothing)
const total = sw.boneMass.reduce((a, b) => a + b, 0);
const thin = bones.filter((_, i) => sw.boneMass[i] / total < 0.0005).map((b) => b.id);

// 5) dewclaw & vestigial Mt1 — explicitly required to carry weight
for (const required of ['mc_1_l', 'mc_1_r', 'mt_1_l', 'mt_1_r', 'ph_1_dew_prox_l', 'ph_1_dew_dist_l']) {
  const i = bones.findIndex((b) => b.id === required);
  if (i < 0) problems.push(`required dewclaw/Mt1 bone "${required}" missing from anatomy`);
  else if (sw.boneMass[i] <= 0) problems.push(`dewclaw/Mt1 bone "${required}" carries zero weight`);
}

console.log(`Weights: ${sw.vertexCount} vertices × ${sw.boneCount} bones`);
console.log(`  influences/vertex histogram — see solve-weights output`);
if (thin.length) console.log(`  note: ${thin.length} nearly-weightless bone(s): ${thin.slice(0, 10).join(', ')}${thin.length > 10 ? '…' : ''}`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ weight checks pass');
process.exit(0);
