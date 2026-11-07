import { buildKitten } from '../src/animal/kitten';
import * as THREE from 'three';
for (const rx of [-1.32, Math.PI / 2, 1.08, 2.6]) {
  const build = buildKitten({ weight: 1.0, pose: 'standing' as never, coat: 'orangeTabby' });
  const internals = build.group.userData.internals as { openEyes: THREE.Group };
  for (const eyeGroup of internals.openEyes.children) {
    const lid = eyeGroup.userData.lid as THREE.Mesh;
    lid.rotation.x = rx;
  }
  build.group.updateMatrixWorld(true);
  const eyeGroup = internals.openEyes.children[0];
  const lid = eyeGroup.userData.lid as THREE.Mesh;
  const q = lid.getWorldQuaternion(new THREE.Quaternion());
  const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const eyePos = eyeGroup.getWorldPosition(new THREE.Vector3());
  console.log(`rx=${rx.toFixed(2)}  lid pole world=(${pole.toArray().map(v => v.toFixed(2))})  eye=(${eyePos.toArray().map(v => v.toFixed(2))})`);
}
