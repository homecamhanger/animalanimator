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

## Skinning — the next conversation

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

**Order of operations I would propose** (each step independently shippable):

1. `scripts/solve-weights.ts` — offline per-vertex weight solve → `.bin`
   weights asset + report (histogram, min-effective-bone count per vertex).
2. Runtime DQS deformation in the viewer behind a toggle (`Fur SDF | Skinned`).
3. Re-target the 5 poses onto the rig (poses exist as 2-bone chains already —
   they transplant almost verbatim onto femur/tibia, humerus/radius).
4. Corrective pass for sit & stretch (the two poses with the deepest folds).
5. Decide whether SDF morphs retire or stay for idle detail.

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
- `scripts/check-anatomy.ts` — `npm run check:anatomy`
