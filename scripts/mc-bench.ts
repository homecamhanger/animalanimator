/**
 * mc-bench.ts — time a realistic reset + addBall + update cycle.
 */
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import * as THREE from 'three';

const balls: Array<[number, number, number, number]> = [];
// rough kitten stand-in: torso pairs, head cluster, legs, tail, ears
for (const [x, y, z, r] of [
  [0.36, 0.52, 0.3, 0.24], [0.64, 0.52, 0.3, 0.24],
  [0.34, 0.5, 0.52, 0.245], [0.66, 0.5, 0.52, 0.245],
  [0.35, 0.48, 0.62, 0.235], [0.65, 0.48, 0.62, 0.235],
  [0.36, 0.55, 0.72, 0.225], [0.64, 0.55, 0.72, 0.225],
  [0.42, 0.72, 0.78, 0.16], [0.58, 0.72, 0.78, 0.16],
  [0.5, 0.72, 0.85, 0.235], [0.5, 0.79, 0.78, 0.18],
  [0.38, 0.71, 0.9, 0.12], [0.62, 0.71, 0.9, 0.12],
  [0.5, 0.62, 0.93, 0.125], [0.5, 0.55, 0.9, 0.06],
  [0.36, 0.83, 0.8, 0.1], [0.36, 0.92, 0.77, 0.07], [0.36, 0.99, 0.75, 0.045],
  [0.64, 0.83, 0.8, 0.1], [0.64, 0.92, 0.77, 0.07], [0.64, 0.99, 0.75, 0.045],
  [0.39, 0.28, 0.7, 0.11], [0.39, 0.14, 0.7, 0.088], [0.39, 0.05, 0.72, 0.085],
  [0.61, 0.28, 0.7, 0.11], [0.61, 0.14, 0.7, 0.088], [0.61, 0.05, 0.72, 0.085],
  [0.3, 0.3, 0.3, 0.155], [0.3, 0.12, 0.3, 0.095], [0.3, 0.05, 0.34, 0.08],
  [0.7, 0.3, 0.3, 0.155], [0.7, 0.12, 0.3, 0.095], [0.7, 0.05, 0.34, 0.08],
  [0.5, 0.55, 0.1, 0.09], [0.52, 0.68, 0.06, 0.075], [0.56, 0.82, 0.05, 0.06], [0.62, 0.9, 0.1, 0.05],
] as Array<[number, number, number, number]>) {
  balls.push([x, y, z, r]);
}

for (const resolution of [64, 80, 88, 96]) {
  const material = new THREE.MeshStandardMaterial();
  const mc = new MarchingCubes(resolution, material, false, true, 120_000);
  mc.isolation = 80;
  const t0 = performance.now();
  for (let iter = 0; iter < 5; iter++) {
    mc.reset();
    for (const [x, y, z, r] of balls) {
      const strength = (80 + 12) * r * r;
      mc.addBall(x, y, z, strength, 12);
    }
    mc.update();
  }
  const ms = (performance.now() - t0) / 5;
  const tris = mc.count / 3;
  console.log(`res ${resolution}: ${ms.toFixed(1)} ms per full rebuild, ${tris} triangles`);
}
