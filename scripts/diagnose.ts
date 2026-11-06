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
import * as THREE from 'three';

for (const pose of ['stretch', 'curled'] as const) {
  for (const weight of [1.0]) {
    const build = buildKitten({ weight, pose, coat: 'orangeTabby' });
    build.group.updateMatrixWorld(true);
    console.log(`\n${pose} w=${weight}`);
    const rows: Array<{ name: string; minY: number; maxY: number }> = [];
    build.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const box = new THREE.Box3().setFromObject(mesh);
      const parentName = mesh.parent?.name ?? mesh.parent?.type ?? '';
      rows.push({
        name: `${mesh.geometry.type} pos=(${mesh.position.toArray().map((n) => n.toFixed(2)).join(',')}) scale=(${mesh.scale.toArray().map((n) => n.toFixed(2)).join(',')}) parent=${parentName}`,
        minY: box.min.y,
        maxY: box.max.y,
      });
    });
    rows.sort((a, b) => a.minY - b.minY);
    for (const row of rows.slice(0, 6)) {
      console.log(`  ${row.minY.toFixed(3)} → ${row.maxY.toFixed(3)}  ${row.name}`);
    }
    build.dispose();
  }
}

export {};
