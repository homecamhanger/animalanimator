# The Anatomical Skeleton

`src/animal/anatomy.ts` draws the **complete feline skeleton** — every named
bone worth articulating — as data, registered inside the fur mesh, and renders
it in the viewer behind an **Anatomy** toggle in the sidebar:

| Mode      | What you see |
|-----------|--------------|
| Fur       | the normal kitten (default) |
| Overlay   | ghosted fur (16 % opacity) + solid bones — fit check |
| Skeleton  | bones only |

The skeleton **rest pose is standing** (weight 1.0, the production default).
It is deliberately static — weight/pose sliders drive the fur SDF as before;
the bones are a separate rest-pose read of the anatomy.

## Registration

The bone set and articulation are textbook feline osteology, but the *pose* is
not an idealised meter frame: `buildAnatomy()` literally reads the mesh's own
solved rig via `solveSkeleton('standing', 1.0)` — the dorsal ridge balls, the
solved two-bone leg chains, the head anchors and the tail curve the fur is
grown from — and lays the bones against those landmarks. Change the mesh rig,
and the skeleton follows. Re-print the landmarks with:

```sh
npx tsx scripts/probe-skeleton.ts standing 1.0
npx tsx scripts/dump-anatomy.ts /tmp/anatomy.json
python3 scripts/render-overlay.py .scratch/mesh-standing.json .scratch/anatomy.json overlay.png --azimuth 90
```

`npm run check` validates the data (`scripts/check-anatomy.ts`): unique ids,
resolvable parents, finite/above-floor coordinates, no zero-length capsules,
13 rib pairs, no parent cycles, and a required-keystone-bone list.

## Inventory (215 drawn segments)

| Region      | Bones | Contents |
|-------------|-------|----------|
| Skull       | 6     | cranium (frontal·parietal·occipital·temporal fused), maxilla & nasal, zygomatic arch ×2, mandible ramus ×2 |
| Spine       | 28    | 7 cervical (atlas + axis), 13 thoracic, 7 lumbar, 1 sacrum (S1–S3 fused) |
| Tail        | 21    | Cd1–Cd21 (centripetal Catmull-Rom through the mesh tail curve) |
| Ribcage     | 34    | 13 rib pairs (T1→manubrium … T13↔xiphoid, 3rd widest, 13th floating) + sternum: manubrium, 6 sternebrae, xiphoid (8 pieces drawn as 8 capsules) |
| Forelimbs   | 64    | + scapulae: scapula ×2, scapular spine ×2, rudimentary free clavicle ×2; per leg: humerus, ulna (olecranon), radius, 7 carpals, MC1 dewclaw (high, medial) + MC2–5, dewclaw 2 phalanges, 4 digits × 3 phalanges |
| Hindlimbs   | 62    | pelvis: ilium wing ×2, ischium ×2, pubis ×2; per leg: femur, patella, tibia, fibula, calcaneus, talus, centrale, T1–T4, Mt2–5 + vestigial Mt1, 4 digits × 3 phalanges |
| **Total**   | **215** | |

Parents form the articulation tree (sacrum → L7→L1 → T13→T1 → C7→C1 → atlas →
cranium; ribs parent to their vertebra; sternum to T1; limbs via scapula/
ilium → humerus/femur → zeugopodia → autopodia). `check-anatomy` walks every
chain to the sacrum.

## What is *drawn* vs what *exists*

The literature total for a cat is **~230–250 bones** (~242 without the ear
ossicles). We draw 215 *segments*. Omitted, deliberately:

- **30 teeth** — they carry no skinning weight; add later if we ever do dental anatomy
- **6 ear ossicles** (malleus/incus/stapes ×2) — inside the petrous temporal
- **Hyoid apparatus** (~9 pieces) — needs a lingual rig; out of scope
- **Costal cartilages** — drawn implicitly by the rib→sternum arc, not as bones
- **Most sesamoids** — patella is kept; fabellae (2/hindlimb), the navicular,
  and metacarpal/metatarsal sesamoid pairs are omitted
- **Interparietal** — folded into the cranium bone rather than drawn separately
- **Sutural bones** (wormian) — variable; omitted
- **Digit counts**: forelimbs model all 4 weight-bearing digits + the dewclaw
  digit (high, medial, usually without ground contact); hindlimbs model 4
  digits with a vestigial Mt1. The first (pollex) rarely ossifies in cats
  beyond the dewclaw itself.

## Caveats — read before trusting it

1. **Proportions are veterinary ballparks fitted to a stylized chonky cat** —
   they are not CT-scan measurements of *this* mesh, and the fur head is much
   rounder than a real skull. The skeleton reads as "anatomically organised
   inside the cat", not as a forensic reconstruction.
2. **Standing rest pose only.** Other poses (sit, loaf, stretch, curled)
   currently morph the *fur SDF*; the bones do not follow them yet.
3. **Side asymmetry is not modelled** beyond left/right mirroring — no yaw.
4. Coordinates are world units in the mesh frame (floor y = 0, facing +z).
   Unit scale ≈ decimetre-ish artist units, not metres.
5. The mesh it registers to is itself ~20 332 triangles of implicit-field
   geometry — the *fit* is as good as that solve (verified visually against
   `.scratch/mesh-standing.json`).

## Skinning — status

**Step 2 shipped: the DQS runtime bind + pose re-target.** (step 1: weights —
see below.)

- `src/animal/skinning.ts` — the dual-quaternion core: pivot deltas
  (`v' = R·(v − o) + o'`), dual-quaternion accumulation with hemisphere flip,
  blend normalisation, translation extraction `t = 2·vec(q̄q̄*·q̄ᵣ*)`, normal
  re-rotation. Allocation-free per-vertex loop; pure math, no anatomy.
- `src/animal/skinRig.ts` — the bind. The SDF solve already knows every joint
  in world space, so bones are re-targeted by registering them to the solved
  chains instead of authored rotations: spine/sacrum/cervicals ride a
  closest-arc-length t on an extended ridge curve (rump→…→neck_low→skullBase,
  tangent shortest-arc rotation), tail caudals ride the per-pose Catmull-Rom
  the same way, limb bones take their solved segment (`upper/lowerA/lowerB`,
  `femur/tibia/metatarsus/phalanx`) with a direction-arc rotation about the
  segment origin, skull bones take the head frame directly
  (`Euler(pitch, yaw, 0, 'YXZ')`), and everything else — ribs, sternum,
  girdles, phalanges, tarsals — inherits its anatomical parent's delta
  (rigid frame copy). Deltas are cached per (pose, weight).
- **No cracks, ever:** weights are a pure function of position, so duplicated
  shell vertices (the isosurface is unindexed) displace identically —
  verified exactly, max twin deviation 0.0 in every pose.
- **Floor reference:** like the SDF builds, the skinned path re-measures the
  lowest deformed skin point and re-grounds the group on the pose's contact
  target (paws 0.002, loaf/curled their floorY) — the cat never sinks or
  floats when poses switch.
- **Head-locked accessories** (eyes, nose, philtrum, inner-ear lozenges,
  whiskers) are grouped under `headAccessories` and re-anchored rigidly by
  the head delta; eye open/closed state flips with the pose (you can't build
  "curled" from a standing build — the build itself is standing, now
  followed by the deformation).
- **Try it:** sidebar → Anatomy → **Skinned**. The fur you see is the bone
  rig posing the standing mesh — pose chips switch instantly (no SDF rebuild,
  ~40 ms deform), breathing rides as before. Back to Fur/Overlay/Skeleton →
  a real SDF rebuild restores that artifact. Weight slider stays live.
- `npm run check:skinning` (in `npm run check`) — per pose: standing is an
  exact identity, all vertices finite, normals unit (err < 1e-7), coincident
  rows displace identically (no cracks), displacement magnitudes sane.
- Verified headlessly against the SDF ground truth (`scripts/render-skinned.ts`
  + `scripts/compare-poses.py`, cyan = SDF, orange = skinned): sitting,
  stretch, loaf and curled all agree within ~1–3 cm over the torso, limbs
  overlapping near-perfectly. Residuals are expected, documented below.

**What the re-target does NOT (yet) reproduce:**

- Ear pose is procedural per build (SDF `earPerk`), not bone-driven — in
  Skinned mode the ears ride the head frame in their standing shape (ears
  read tall in loaf/curled).
- No toe/dewclaw articulation — the paw rides the wrist/metatarsus segment
  rigidly (dewclaws carry real weight, but no independent motion yet).
- SDF art-direction is global (belly sag, row scaling, socket carving); a
  pure bone solve can't recreate it. Residuals: topline rides ~1–3 cm high
  in loaf/curled, foreleg in play-bow slightly under-extended, deep folds
  cramp in curled (overlapping facets, not tears). Correctives are roadmap.
- Deltas map standing@w → pose@w; the anatomy is weight-1.0-registered, so
  at extreme slider weights a small skew remains (sub-centimetre — same
  caveat as the wave-1 weights).

**Known weakness & the lever to pull (unchanged).** Deep axial bones (mid
thoracics) each bind a whisper of mass — adjacent-vertebrae blending keeps
deformation correct. If the sit/stretch spine ever reads stiff, the lever is
a per-bone reach multiplier (deep bones get a wider σ) or a Bone-Heat
Laplacian diffusion pass. In the DQS wave the *topline* was the actual hole —
closed by widening spine σ to 0.10 (`SIGMA_SPINE`) so the bare fur above the
column (~0.22 clear of any bone, past the 0.176 cutoff) binds to the spine
instead of falling into the dead-zone fallback. The dead-zone path now scans
for the TRUE nearest bone rather than the AABB-culled one.

**Remaining roadmap:**

3. ~~Re-target the 5 poses onto the rig~~ — shipped as the Skinned toggle.
4. Corrective pass for sit & stretch (and ear/toe articulation if wanted).
5. Retire the SDF pose path (keep SDF only for construction + idle detail).

**Step 1 shipped: the analytic weight solver.**

- `src/animal/skinWeights.ts` — per-vertex weights: distance to every bone
  (capsule / sampled Bézier for curved bones / ellipsoid / weakened plate),
  `exp(-(d/σ)²)` fields, top-4 influences renormalised. Pure function of
  position → the unindexed marching-cubes shell never seams.
- Verified on the standing mesh (w=1.0, orange tabby): **48 756 vertices,
  215 bones, solve ≈ 230 ms, row sums exactly 1, zero orphan bones**, mass
  by region — hindlimb 26.6 %, skull 25.6 %, forelimb 18.3 %, tail 13.9 %,
  spine 10.1 %, ribcage 5.6 %. Dewclaw (MC1) and vestigial Mt1 carry weight
  like everything else.
- **Try it:** sidebar → Anatomy → **Weights** — the fur is repainted by
  dominant bone (skull gold, spine magenta, forelimb teal, hindlimb orange,
  ribcage blue, tail purple), shaded by dominance.
- `npm run check:weights` (in `npm run check`) — rows normalise to 1, no
  vertex bound to nothing, no orphan bones, dewclaw/Mt1 explicitly asserted.
  `npx tsx scripts/solve-weights.ts` prints the full report and writes
  `.scratch/weights-mesh.json` (+ `weights-mesh.json` renders via
  `scripts/render-preview.py`).

## Skinning — the options we weighed

You said it: there are many ways to bind skin to bones. Here is the honest
map, with a recommendation, so the next wave starts with a decision.

**Our situation is unusual in a useful way.** The fur mesh is not a hand-built
model — it is the isosurface of a smooth-min union of *tagged* analytic
primitives (`leg_front_1_upper`, `spine_0.47_c`, head balls, tail spans …).
Every primitive knows which anatomical chain it belongs to. That means we can
derive **analytic skin weights** instead of painting them:

```
w_bone(p) = softmax over bones of  exp(-d²_bone(p) / σ²)
```

i.e. evaluate each bone's capsule/ellipsoid SDF at every mesh vertex,
temperature-normalize, done. No UV painting, no manual weighting sessions,
fully reproducible, and it degrades gracefully (softmax handles fused joints
like balls-meet-cones at the shoulder/hip).

The options, ranked by fit to this project:

1. **DQS (dual quaternion skinning) + analytic SDF weights** — *recommended.*
   LBS (plain linear blend) is cheapest but collapses the elbow/stifle/neck
   at big bends ("candy-wrapper"). DQS fixes volume loss at ~2× the cost —
   nothing for 20 k triangles. SkinnedMesh deformation can be CPU (fine at
   this size) or `onBeforeCompile` GPU.
2. **LBS + PSD (pose-space deformation) correctives** — LBS plus delta-shapes
   for the extreme poses (sit, stretch, curled). Cheapest runtime; corrective
   authoring cost lives in tooling. A good fallback if DQS looks off at the hock.
3. **Pure PSD on top of current SDF morphs** — keeps the SDF rig for everything
   and adds deltas only where it breaks. Not really skinning; listed for
   completeness because it's the smallest change.
4. **Belly/face stay SDF** — regardless of choice, the face (ears, cheeks,
   muzzle, jowls) costs more to rig than it returns; keep it procedural like
   today. Bones should own: spine, tail, both limb chains, scapulae, pelvis, head.
5. **Heat diffusion weights** (Bone Heat-style Laplacian solve on the watertight
   mesh) — the fallback if analytic weights artifact at fused joints (sacrum/
   pelvis, shoulder). Robust, more code, still no painting.

**Practical notes for the decision**

- The fabellae region: the hock sits in a tight fur pocket — keep its weights
  rigid-ish or the sok/pants effect.
- Claws / distal phalanges: rigid two-bone weights (P3 ↔ its metatarsal/
  metacarpal); blending toes across bones looks like spread toes.
- Tail tip: Cd17–Cd21 are basically rigid; Cd1–Cd5 blend into the sacrum.
- The **vestigial Mt1 and the dewclaw** are invisible under fur — mark them
  `weights: rigid parent` and be done.
- "Skinning" here does not mean deleting the SDF pipeline overnight — the
  breathing/idle micro-motion should probably stay procedural.

**Order of operations** (each step independently shippable):

1. ~~`scripts/solve-weights.ts`~~ — **done** (see "status" above). Runtime
   DQS bind will consume `computeSkinWeights()` directly.
2. ~~Runtime DQS deformation in the viewer behind a toggle (`Fur SDF | Skinned`).~~
   **Done** — sidebar → Anatomy → Skinned.
3. ~~Re-target the 5 poses onto the rig~~ **Done** — deltas register against
   the solved chains/frames (see "status" above).
4. Corrective pass for sit & stretch (the two poses with the deepest folds).
5. Retire the SDF pose path (keep SDF only for construction + idle detail).

**Open questions for you**

- Replace the SDF pose system wholesale, or run skinning alongside it?
- Should the follow-up also *simplify* the mesh (20 k tris is plenty) or keep it?
- Dewclaw/Mt1: keep them in the data like now, or drop from weights entirely?
- Do you want the skinning **code** written now, or just this decision first?

## Files

- `src/animal/anatomy.ts` — the bone data + `buildAnatomy()`
- `src/viewer/skeletonScene.ts` — THREE rendering of the bones (region-coloured)
- `scripts/probe-skeleton.ts` — print the registered mesh landmarks
- `scripts/dump-anatomy.ts` / `render-anatomy.py` — JSON dump + 2D preview
- `scripts/render-overlay.py` — x-ray composite (fur ghost + bones)
- `src/animal/skinWeights.ts` — the analytic weight solver + region debug palette
- `src/animal/skinning.ts` — DQS core (pivot deltas, dual quaternions, normal re-rotation)
- `src/animal/skinRig.ts` — pose→bone deltas registered to the solved chains
- `scripts/solve-weights.ts` — offline solve + report + painted dump
- `scripts/render-skinned.ts` — headless deform → `.scratch/skinned-<pose>.json`
- `scripts/compare-poses.py` — SDF vs skinned overlay (cyan/orange)
- `scripts/check-skinning.ts` — `npm run check:skinning` (DQS invariants)
- `scripts/check-weights.ts` — `npm run check:weights`
- `scripts/check-anatomy.ts` — `npm run check:anatomy`
