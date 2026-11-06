/**
 * smoke-build.ts — runs the full kitten builder headlessly (stubbing the 2D
 * canvas the fur textures are painted on) and validates the resulting scene.
 *
 * Catches NaN vertices, degenerate bounds and three.js runtime crashes
 * without needing a GPU. Run with: npx tsx scripts/smoke-build.ts
 */

/* Minimal 2D canvas stub — records nothing, satisfies the paint calls. */
const gradientStub = { addColorStop: () => undefined };
const contextStub = new Proxy<Record<string | symbol, unknown>>(
  {},
  {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => gradientStub;
      }
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
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
    return {
      width: 512,
      height: 512,
      getContext: () => contextStub,
      toBlob: () => undefined,
    };
  },
};

import { buildKitten } from '../src/animal/kitten';
import { POSE_ORDER } from '../src/animal/profiles';
import { COATS } from '../src/animal/coats';
import * as THREE from 'three';

const WEIGHTS = [0.65, 0.72, 0.88, 1.0, 1.05, 1.3, 1.58, 1.7];

let failures = 0;
const fail = (message: string) => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};

for (const coat of COATS) {
  for (const pose of POSE_ORDER) {
    for (const weight of WEIGHTS) {
      const label = `${pose} @ w=${weight} (${coat.id})`;
      let build;
      try {
        build = buildKitten({ weight, pose, coat: coat.id });
      } catch (error) {
        fail(`${label}: build threw → ${(error as Error).message}`);
        continue;
      }

      // Every position and normal must be finite.
      let positions = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      let maxAbsX = 0;
      let minZ = Infinity;
      let maxZ = -Infinity;
      build.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.attributes.position;
        const normal = mesh.geometry.attributes.normal;
        if (!pos || !normal) {
          fail(`${label}: mesh "${mesh.name}" missing attributes`);
          return;
        }
        positions += pos.count;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            fail(`${label}: non-finite position in "${mesh.name}" at index ${i}`);
            return;
          }
          // World-space y is what matters for the floor check (meshes in the
          // head group are offset, so only trust the global bbox below).
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          maxAbsX = Math.max(maxAbsX, Math.abs(x));
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        for (let i = 0; i < normal.count; i++) {
          if (!Number.isFinite(normal.getX(i))) {
            fail(`${label}: non-finite normal in "${mesh.name}" at index ${i}`);
            return;
          }
        }
      });

      // Global bounding box must stay inside a sane stage and above the floor.
      build.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(build.group);
      if (box.min.y < -0.02) fail(`${label}: kitten sinks below floor (y=${box.min.y.toFixed(3)})`);
      if (box.max.y > 1.9) fail(`${label}: kitten exceeds stage height (y=${box.max.y.toFixed(3)})`);
      if (box.max.x - box.min.x > 1.6) fail(`${label}: kitten wider than stage`);
      if (positions < 3000) fail(`${label}: suspiciously few vertices (${positions})`);

      build.dispose();
    }
  }
}

if (failures > 0) {
  throw new Error(`${failures} smoke-build failure(s).`);
}
console.log('All smoke builds passed.');

export {};
