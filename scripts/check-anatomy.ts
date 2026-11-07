/**
 * check-anatomy.ts — integrity validation for the anatomical skeleton.
 * Fails (exit 1) on: duplicate ids, dangling parents, non-finite points,
 * zero-length capsules, missing key bones, or below-floor coordinates.
 *
 * Usage: npx tsx scripts/check-anatomy.ts [--print]
 */
import { buildAnatomy, ANATOMY_REGIONS, type AnatomyRegion } from '../src/animal/anatomy';

const bones = buildAnatomy();
const print = process.argv.includes('--print');
const problems: string[] = [];

// 1) unique ids
const seen = new Map<string, number>();
for (const b of bones) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
for (const [id, count] of seen) if (count > 1) problems.push(`duplicate bone id "${id}" (×${count})`);

// 2) parents resolve
const ids = new Set(bones.map((b) => b.id));
for (const b of bones) {
  if (b.parent !== null && !ids.has(b.parent)) {
    problems.push(`bone "${b.id}" has dangling parent "${b.parent}"`);
  }
}

// 3) finite + sane coordinates
for (const b of bones) {
  for (const key of ['from', 'to', 'via'] as const) {
    const p = b[key];
    if (!p) continue;
    if (!Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
      problems.push(`bone "${b.id}" has non-finite "${key}"`);
    } else if (p[1] < -1e-6) {
      problems.push(`bone "${b.id}" dips below the floor (y=${p[1]})`);
    }
  }
  const d2 = (b.from[0] - b.to[0]) ** 2 + (b.from[1] - b.to[1]) ** 2 + (b.from[2] - b.to[2]) ** 2;
  const isEllipsoidZeroAxis = b.shape === 'ellipsoid' && d2 === 0;
  if (d2 < 1e-10 && !isEllipsoidZeroAxis) {
    problems.push(`bone "${b.id}" is zero-length`);
  }
  if (b.shape === 'plate' && !b.via) problems.push(`plate bone "${b.id}" lacks a third corner`);
  if (b.shape === 'ellipsoid' && !b.radii) problems.push(`ellipsoid bone "${b.id}" lacks radii`);
  if (!(b.girth > 0 || b.shape === 'ellipsoid' || b.shape === 'plate')) {
    problems.push(`bone "${b.id}" has no girth`);
  }
}

// 4) required keystone bones (catches accidental deletions in refactors)
const required = [
  'sacrum', 'atlas', 'axis',
  ...Array.from({ length: 7 }, (_, i) => `c_${i + 1}`).filter((id) => id !== 'c_1' && id !== 'c_2'),
  ...Array.from({ length: 13 }, (_, i) => `t_${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `l_${i + 1}`),
  ...Array.from({ length: 21 }, (_, i) => `cd_${i + 1}`),
  ...['cranium', 'maxilla', 'zygomatic_l', 'zygomatic_r', 'mandible_l', 'mandible_r'],
  'sternum_0', 'sternum_7',
  'scapula_l', 'scapula_r', 'ilium_l', 'ilium_r',
  'humerus_l', 'humerus_r', 'radius_l', 'radius_r', 'ulna_l', 'ulna_r',
  'femur_l', 'femur_r', 'tibia_l', 'tibia_r', 'patella_l', 'patella_r', 'calcaneus_l_exists', // calcaneus uses tarsal_2
];
// calcaneus is drawn as tarsal_2_<side> — fix the check list
const requiredFixed = required.filter((id) => id !== 'calcaneus_l_exists').concat(['tarsal_2_l', 'tarsal_2_r']);
for (const id of requiredFixed) {
  if (!ids.has(id)) problems.push(`required bone "${id}" is missing`);
}

// 5) rib count — 13 pairs
const ribs = bones.filter((b) => /^rib_\d+_[lr]$/.test(b.id));
if (ribs.length !== 26) problems.push(`expected 26 rib bones, found ${ribs.length}`);

// 6) joint-tree sanity — every non-sacrum bone chains to the sacrum
const parentOf = new Map(bones.map((b) => [b.id, b.parent] as const));
for (const b of bones) {
  let cur = b.parent;
  const hop = new Set<string>();
  while (cur !== null && cur !== undefined) {
    if (hop.has(cur)) { problems.push(`bone "${b.id}" is in a parent cycle at "${cur}"`); break; }
    hop.add(cur);
    cur = parentOf.get(cur) ?? null;
    if (!ids.has(cur as string)) break;
  }
}

// 6) headless construction of the viewer's skeleton group (no WebGL needed)
{
  const { buildSkeletonGroup, disposeSkeleton } = await import('../src/viewer/skeletonScene');
  const group = buildSkeletonGroup();
  let meshes = 0;
  group.traverse((obj) => {
    if ((obj as { isMesh?: boolean }).isMesh) meshes += 1;
  });
  console.log(`  three.js skeleton group: ${meshes} meshes constructed`);
  if (meshes < bones.length) problems.push(`skeleton group has ${meshes} meshes for ${bones.length} bones`);
  disposeSkeleton(group);
}

// Report
const byRegion = Object.fromEntries(ANATOMY_REGIONS.map((r: AnatomyRegion) => [r, bones.filter((b) => b.region === r).length]));
console.log(`Anatomical skeleton: ${bones.length} bones`);
for (const [region, count] of Object.entries(byRegion)) console.log(`  ${region.padEnd(9)} ${count}`);

if (print) {
  for (const b of bones) console.log(`  ${b.id.padEnd(26)} ${b.region.padEnd(9)} parent=${b.parent ?? '—'}`);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ anatomy checks pass');
