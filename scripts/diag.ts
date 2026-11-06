import { solveSkeleton } from '../src/animal/skeleton';
import { POSE_PARAMS } from '../src/animal/profiles';
import { surfaceDistance, fieldAtPoint } from '../src/animal/fur';
import * as THREE from 'three';
const s = solveSkeleton('curled', 0.75);
const pose = POSE_PARAMS['curled'];
const headMul = s.anchors.headMul;
const headQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.headPitch, pose.headYaw, 0, 'YXZ'));
const headDir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize().applyQuaternion(headQuat);
console.log('headPos', s.anchors.headPos.toArray().map(v => +v.toFixed(3)), 'headMul', headMul.toFixed(3), 'pitch', pose.headPitch, 'yaw', pose.headYaw);
for (const { base, dir, side } of s.anchors.earDirs) {
  const anchor = base.clone().addScaledVector(dir, 0.082 * headMul);
  const normal = headDir(side * 0.22, -0.48, 0.85);
  const inside = fieldAtPoint(anchor, s.balls);
  const t = surfaceDistance(s.balls, anchor, normal);
  const pos = anchor.clone().addScaledVector(normal, t + 0.005);
  console.log(`side=${side} base=(${base.toArray().map(v => +v.toFixed(3))}) anchor=(${anchor.toArray().map(v => +v.toFixed(3))}) f(anchor)=${inside.toFixed(1)} t=${t.toFixed(3)} pos=(${pos.toArray().map(v => +v.toFixed(3))})`);
}
