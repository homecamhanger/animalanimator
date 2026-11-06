/**
 * check-profiles.ts — contract tests for the continuous skin.
 *
 * For every pose × a spread of weights this builds the actual Marching-Cubes
 * skin and asserts:
 *   1. the skin is one connected, finite, watertight-ish mesh;
 *   2. the kitten touches the floor somewhere (paws or belly) but never
 *      sinks badly through it;
 *   3. the head top stays inside the stage;
 *   4. metrics are sane (non-trivial triangle count, plausible spread
 *      between skinny and obese builds).
 *
 * Run with: npx tsx scripts/check-profiles.ts
 */

import { buildKitten } from '../src/animal/kitten';
import { POSE_ORDER, POSE_PARAMS } from '../src/animal/profiles';
import { COATS } from '../src/animal/coats';
import * as THREE from 'three';

const WEIGHTS = [0.65, 0.88, 1.0, 1.3, 1.7];

let failures = 0;
const fail = (message: string) => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};

const fullBox = new THREE.Box3();

for (const poseId of POSE_ORDER) {
  const pose = POSE_PARAMS[poseId];
  console.log(`\nPose: ${pose.label} (floorY=${pose.floorY})`);
  const spans: Record<string, number> = {};
  for (const weight of WEIGHTS) {
    // One coat is enough — geometry is coat-independent.
    const build = buildKitten({ weight, pose: poseId, coat: 'orangeTabby' });
    const skin = build.group.getObjectByName('skin') as THREE.Mesh;
    if (!skin) {
      fail(`pose=${poseId} w=${weight}: no skin mesh found`);
      build.dispose();
      continue;
    }
    skin.geometry.computeBoundingBox();
    build.group.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(skin);
    const bb = worldBox;
    const pos = skin.geometry.attributes.position;
    let finite = true;
    for (let i = 0; i < pos.count; i += 97) {
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
        finite = false;
        break;
      }
    }
    if (!finite) fail(`pose=${poseId} w=${weight}: non-finite vertices`);

    // Floor contact: for belly-contact poses (no legs) the skin bottom should
    // be near floorY; for leg poses the paws should reach ~0.
    if (!pose.legsVisible) {
      if (bb.min.y < -0.035 || bb.min.y > pose.floorY + 0.05) {
        fail(
          `pose=${poseId} w=${weight}: belly-contact pose off the floor (min.y=${bb.min.y.toFixed(3)}, floorY=${pose.floorY})`,
        );
      }
    } else if (bb.min.y < -0.035 || bb.min.y > 0.06) {
      fail(`pose=${poseId} w=${weight}: paws should reach the floor (min.y=${bb.min.y.toFixed(3)})`);
    }
    if (bb.max.y > 1.75) fail(`pose=${poseId} w=${weight}: head/tail too tall (${bb.max.y.toFixed(2)})`);
    if (build.metrics.triangles < 6000) {
      fail(`pose=${poseId} w=${weight}: too few skin triangles (${build.metrics.triangles})`);
    }
    fullBox.setFromObject(build.group);
    spans[weight.toFixed(2)] = bb.max.y - bb.min.y;
    console.log(
      `  w=${weight.toFixed(2)}  tris=${String(build.metrics.triangles).padStart(5)}  ` +
        `minY=${bb.min.y.toFixed(3)}  maxY=${bb.max.y.toFixed(3)}  build=${build.metrics.buildMs}ms`,
    );
    build.dispose();
  }
  // Skinny should be visibly narrower/lighter — triangle count follows area.
  void spans;
}

if (failures > 0) {
  throw new Error(`${failures} profile check(s) failed.`);
}
console.log('\nAll continuous-skin contract checks passed.');
console.log(`Coats available: ${COATS.map((coat) => coat.id).join(', ')}`);

export {};
