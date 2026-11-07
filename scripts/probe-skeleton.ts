/**
 * probe-skeleton.ts — prints the solved mesh-rig landmarks for a pose/weight,
 * in WORLD (grounded) coordinates. This is the registration source for the
 * anatomical skeleton: the anatomy rest pose is laid out against THESE numbers,
 * not against idealised meters.
 *
 * Usage: npx tsx scripts/probe-skeleton.ts standing 1.0
 */
import { solveSkeleton } from '../src/animal/skeleton';
import * as THREE from 'three';

const pose = (process.argv[2] ?? 'standing') as 'standing';
const weight = Number(process.argv[3] ?? '1.0');
const { balls, anchors } = solveSkeleton(pose, weight);

const p = (v: THREE.Vector3) => `[${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`;
console.log('headPos   ', p(anchors.headPos as unknown as THREE.Vector3), 'mul', anchors.headMul.toFixed(3));

const named: Record<string, THREE.Vector3 & { r?: number }> = {};
for (const b of balls) named[b.name] = b as never;

for (const b of balls) {
  if (/^spine_.*_c$/.test(b.name)) {
    console.log('SPINE', b.name.padEnd(16), p(b.pos), 'r', b.r1.toFixed(4));
  }
}
for (const b of balls) {
  if (/^leg_.*_cap$/.test(b.name)) {
    console.log('CAP   ', b.name.padEnd(22), p(b.pos), 'r', b.r1.toFixed(4));
  }
}
for (const want of ['neck_low', 'head_cranium', 'head_skull', 'belly_sag']) {
  const b = balls.find((x) => x.name === want);
  if (b) console.log('BALL  ', want.padEnd(16), p(b.pos), 'r', b.r1.toFixed(4));
}

for (const b of balls) {
  if (/^leg_/.test(b.name) && !/_cap$/.test(b.name)) {
    console.log('SEG   ', b.name.padEnd(22), 'a', p(b.a), 'b', p(b.b));
  }
}
for (const b of balls) {
  if (/^tail_0$|^tail_1$|^tail_2$|^tail_3$/.test(b.name)) {
    console.log('TAILSEG', b.name.padEnd(22), 'a', p(b.a), 'b', p(b.b));
  }
}
