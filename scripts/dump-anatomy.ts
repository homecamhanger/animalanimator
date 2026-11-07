/** dump-anatomy.ts — exports the anatomical bone list as JSON for previews.
 *  Usage: npx tsx scripts/dump-anatomy.ts [out.json]
 */
import { writeFileSync } from 'node:fs';
import { buildAnatomy } from '../src/animal/anatomy';

const out = process.argv[2] ?? '/tmp/anatomy.json';
const bones = buildAnatomy();
writeFileSync(out, JSON.stringify(bones));
const counts: Record<string, number> = {};
for (const b of bones) counts[b.region] = (counts[b.region] ?? 0) + 1;
console.log(`Wrote ${bones.length} bones → ${out}`);
console.log(counts);
