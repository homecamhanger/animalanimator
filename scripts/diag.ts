import { solveSkeleton } from '../src/animal/skeleton';
const pose = (process.argv[2] ?? 'standing') as never;
const weight = Number(process.argv[3] ?? '1.0');
void weight;
const s = solveSkeleton(pose, Number(process.argv[3] ?? '1.0'));
const wanted = /^(spine_|neck|head|chest)/;
for (const b of s.balls.filter(b => wanted.test(b.name))) {
  console.log(`${b.name.padEnd(16)} pos=(${b.pos.x.toFixed(3)}, ${b.pos.y.toFixed(3)}, ${b.pos.z.toFixed(3)})  r=${b.radius.toFixed(3)}`);
}
console.log('headPos anchor:', s.anchors.headPos.toArray().map(v => v.toFixed(3)).join(', '));
