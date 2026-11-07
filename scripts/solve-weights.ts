/**
 * solve-weights.ts — offline proof of the analytic skin weights.
 *
 * Builds the standing kitten headlessly, computes per-vertex bone weights for
 * the skin mesh, prints a sanity report, and writes:
 *   .scratch/weights-report.json      — per-bone mass + vertex influence histogram
 *   .scratch/weights-mesh.json        — triangles painted by dominant bone (region hues)
 *
 * Usage: npx tsx scripts/solve-weights.ts [weight=1.0]
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
import { buildAnatomy, ANATOMY_REGIONS } from '../src/animal/anatomy';
import { computeSkinWeights, paintBoneWeightColors } from '../src/animal/skinWeights';
import * as THREE from 'three';

const weight = Number(process.argv[2] ?? '1.0');
const build = buildKitten({ weight, pose: 'standing', coat: 'orangeTabby' });
const internals = build.group.userData.internals as { skinMesh: THREE.Mesh };
const skin = internals.skinMesh;
const geometry = skin.geometry;
const position = geometry.getAttribute('position') as THREE.BufferAttribute;
const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3;

console.log(`Standing @ w=${weight} — ${position.count} vertices, ${triangles} triangles`);

const t0 = Date.now();
const bones = buildAnatomy();
const sw = computeSkinWeights(position, bones);
const ms = Date.now() - t0;
console.log(`Solved ${sw.boneCount} bones in ${ms} ms`);

// --- sanity: row sums
let minRow = Infinity, maxRow = -Infinity;
for (let v = 0; v < sw.vertexCount; v++) {
  const s = sw.weights[v * 4] + sw.weights[v * 4 + 1] + sw.weights[v * 4 + 2] + sw.weights[v * 4 + 3];
  if (s < minRow) minRow = s;
  if (s > maxRow) maxRow = s;
}
console.log(`Row sums: min ${minRow.toFixed(6)}  max ${maxRow.toFixed(6)}`);

// --- influence histogram
const hist = [0, 0, 0, 0];
for (let v = 0; v < sw.vertexCount; v++) {
  let k = 0;
  for (let i = 0; i < 4; i++) if (sw.weights[v * 4 + i] > 0) k += 1;
  hist[k - 1] += 1;
}
console.log(`Influences/vertex — 1: ${hist[0]}, 2: ${hist[1]}, 3: ${hist[2]}, 4: ${hist[3]}`);

// --- per-bone mass
const boneRows = bones.map((bone, i) => ({ id: bone.id, region: bone.region, mass: sw.boneMass[i] }));
const byRegion = new Map<string, number>();
for (const row of boneRows) byRegion.set(row.region, (byRegion.get(row.region) ?? 0) + row.mass);
const totalMass = boneRows.reduce((acc, row) => acc + row.mass, 0);
console.log(`\nMass by region (Σ weights = ${totalMass.toFixed(1)}):`);
for (const region of ANATOMY_REGIONS) {
  const share = ((byRegion.get(region) ?? 0) / totalMass) * 100;
  console.log(`  ${region.padEnd(9)} ${(byRegion.get(region) ?? 0).toFixed(1).padStart(8)}  ${share.toFixed(1)} %`);
}
const top = [...boneRows].sort((a, b) => b.mass - a.mass).slice(0, 14);
console.log('\nHeaviest bones:');
for (const row of top) console.log(`  ${row.id.padEnd(22)} ${row.mass.toFixed(1).padStart(7)}`);

const orphans = boneRows.filter((row) => row.mass === 0);
console.log(`\nOrphan bones: ${orphans.length}${orphans.length ? ' → ' + orphans.map((o) => o.id).join(', ') : ''}`);

mkdirSync('.scratch', { recursive: true });
writeFileSync('.scratch/weights-report.json', JSON.stringify({
  weight, vertices: sw.vertexCount, triangles, solveMs: ms,
  rowSum: [minRow, maxRow], influenceHistogram: hist,
  massByRegion: Object.fromEntries(byRegion),
  boneMass: boneRows,
}, null, 2));

// --- painted dump for the 2D rasteriser (skin only, no accessories)
const colors = new Float32Array(position.count * 3);
paintBoneWeightColors(colors, sw, bones);
const readColor = (i: number): string => {
  const r = Math.round(Math.min(1, Math.max(0, colors[i * 3])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, colors[i * 3 + 1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, colors[i * 3 + 2])) * 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};
const pos = position.array as Float32Array;
const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
const nrm = normal?.array as Float32Array | undefined;
const outTris: Array<Record<string, unknown>> = [];
for (let i = 0; i < position.count; i += 3) {
  const tri: Record<string, unknown> = {
    mesh: 'skin',
    a: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]],
    b: [pos[i * 3 + 3], pos[i * 3 + 4], pos[i * 3 + 5]],
    c: [pos[i * 3 + 6], pos[i * 3 + 7], pos[i * 3 + 8]],
    colors: [readColor(i), readColor(i + 1), readColor(i + 2)],
  };
  if (nrm) {
    tri.na = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    tri.nb = [nrm[i * 3 + 3], nrm[i * 3 + 4], nrm[i * 3 + 5]];
    tri.nc = [nrm[i * 3 + 6], nrm[i * 3 + 7], nrm[i * 3 + 8]];
  }
  outTris.push(tri);
}
writeFileSync('.scratch/weights-mesh.json', JSON.stringify({ pose: 'standing', weight, triangles: outTris }));
console.log(`\nWrote .scratch/weights-report.json and .scratch/weights-mesh.json (${outTris.length} triangles)`);
process.exit(0);
