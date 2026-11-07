import { buildKitten } from '../src/animal/kitten';
import * as THREE from 'three';
for (const squash of [1, 0.55, 0.07]) {
  const build = buildKitten({ weight: 1.0, pose: 'standing' as never, coat: 'orangeTabby' });
  const internals = build.group.userData.internals as { openEyes: THREE.Group };
  for (const eyeGroup of internals.openEyes.children) {
    const sq = eyeGroup.userData.squash as THREE.Group;
    sq.scale.y = squash;
  }
  build.group.updateMatrixWorld(true);
  const eyeGroup = internals.openEyes.children[0];
  const eyePos = eyeGroup.getWorldPosition(new THREE.Vector3());
  console.log(`squashY=${squash.toFixed(2)}  eye=(${eyePos.toArray().map(v => v.toFixed(2))})`);
}
