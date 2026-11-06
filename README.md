# animalanimator

**Procedural 3D animal sculptures that rebuild themselves live in your browser.**
Start with a kitten: drag it from skinny to mega-chonk, strike five reclining poses, swap coats, and export stills or a full **weight × pose study sheet** — all without a single mesh file.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production bundle → dist/
npm run preview    # serve the production build
npm run check      # numeric sanity checks (profiles + headless builds)
```

## What it does

- **Procedural sculpture, one continuous skin** — the kitten is *one* implicit
  surface: a field of metaballs positioned by a real bone skeleton, polygonised
  on the fly with marching cubes. Legs, haunches, ears, muzzle, tail and chin
  are not separate objects nudged into place — they are denser bone rows inside
  the same field, so fur flows seamlessly from skull to cheek to chest to leg.
  Nothing is loaded from disk; every rebuild is ~15–30k triangles in 30–60 ms.
- **Bone skeleton + fat distribution** — every feature is a named bone carrying
  its own radius: spine row *pairs* (widens without lengthening the back),
  shoulder/waist/belly rows, a sagging belly-core bone, neck, cranium + skull,
  cheek ruffs, muzzle and chin, 3-ball ear chains, upper/lower leg chains,
  white-sock paw bones, a multi-ball tail chain and a darker tail-tip saddle.
  One scalar (`0.65`–`1.7`) scales the radii — cheeks and tail grow first,
  the belly sags last, and the double chin appears only past "chonk".
  Floor contact is **exact-grounded** by measuring the built skin's bounds.
- **Vet-calibrated feedback** — live kilogram readout, 9-segment Body Condition
  Score bar (blue → green → amber → red) and a friendly label (`Skinny` … `Mega-chonk`).
- **Five poses** — Standing, Sitting, Loaf, Play bow, Curled up. Each pose ships
  its own spine curve, leg articulation (vertical → folded → hidden), ear perk,
  tail route, and open/closed eyes. Curled up even closes them into happy arcs.
- **Five coats, zero assets, zero UV seams** — colour is layered straight onto the
  implicit surface: marching-cubes palette regions for socks / muzzle / belly /
  saddle, a per-vertex pass for saddle shading and seeded calico blotches, and a
  fragment shader for wavy mackerel bands + guard-hair speckle. Seeded, so every
  reload paints the identical cat.
- **Idle life** — whole-body breathing and random blinking (disable with the wave toggle).
- **Export** —
  - `Save PNG` — current camera, 2048 × 2048, studio backdrop or transparent alpha
  - `Contact sheet` — every pose × five weights rendered to one labelled study sheet
  - `Turntable` — one orbit recorded to WebM
- **View presets** — ¾, front, side, top · auto-rotate · orbit/zoom controls.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`5` | Switch pose (Standing, Sitting, Loaf, Play bow, Curled up) |
| `Q` / `E` | Weight down / up |
| `S` | Save PNG |
| `A` | Toggle auto-rotate |
| `I` | Toggle idle motion |

## How it works

```
src/animal/profiles.ts   pure math: pose table, weight morph, BCS (unit-checkable)
src/animal/skeleton.ts   the rig: solves named bones + per-bone fat for a pose/weight
src/animal/fur.ts        marching-cubes field → one skin mesh; palette + saddle/calico/stripe passes
src/animal/coats.ts      coat colour specs + seeded RNG (no texture assets)
src/animal/geometry.ts   buildTaperedTube / limbBetween (whiskers, philtrum)
src/animal/kitten.ts     assembly: skin mesh + head frame (eyes, nose, inner ears, whiskers)
src/animal/registry.ts   AnimalSpec interface + species registry
src/viewer/              scene, lights, exports (PNG / sheet / WebM), backdrops
src/main.ts              UI wiring
scripts/                 skin contract checker, headless build smoke test, mesh dumper + previewer
```

Design rules baked into the code:

1. **No mesh assets, ever.** Everything is generated from parameters; the only
   raster is the WebGL renderer itself.
2. **One skin, always.** Body, head, legs, ears and tail are one marching-cubes
   isosurface over the skeleton — seams between "parts" cannot exist.
   Only non-fur features (eyes, pupils, nose, inner-ear lozenges, whiskers)
   are separate meshes, parented to the head frame which shares the skeleton's
   articulation exactly.
3. **Grounding is measured, not eyeballed.** The builder measures the built
   skin's bounding box and places the lowest skin point on the floor contact
   (`scripts/check-profiles.ts` asserts paws/belly contact for all 25 builds).
4. **Rebuild, don't rig.** Poses are parameter values, not skeletal animation —
   rebuilding a fresh skin per edit costs 30–60 ms.
5. **Headless-verifiable.** `npm run check` rebuilds every pose × weight × coat
   without a GPU and validates finite geometry, skin triangle counts, floor
   contact, head clearance and stage bounds.

## Adding a new animal

The app talks to species only through `AnimalSpec` (`src/animal/registry.ts`). Puppy and Bunny are already stubbed as "In the litter". To land one:

1. **Rig it** — create `src/animal/<species>.ts` exporting `build<Name>(options): KittenBuild`.
   Copy `skeleton.ts` and re-solve its bone layout (spine rows, head cluster, limbs, tail)
   for the species, then mirror `kitten.ts` (it consumes the skeleton generically).
   Add a double chin (the crowd will demand it).
2. **Coat it** — extend `coats.ts` with the species palette; stripes/blotches are
   shader + vertex passes, no painting required.
3. **Pose it** — add a `PoseParams` row per pose to `profiles.ts` (spine curve,
   `scaleX/Y/Z`, `floorY`, head/ear/leg params, tail route).
4. **Register it** — add its `AnimalSpec` to `ANIMALS` in `registry.ts` with `locked: false`.
5. **Verify** — `npm run check` (extend the weight list if the species morphs further).

The UI (species cards, pose grid, coat swatches, exports, contact sheet) adapts automatically.

## Roadmap

- Puppy (floppy ears, wagging tail) and Bunny (zoomies, thump)
- Rigged tail/ear secondary motion (spring bones)
- Breed archetypes (Maine Coon, Scottish Fold) as morph presets
- glTF export of the procedural model
- Breed-accurate BCS growth curves per species

## Notes

- Exports are produced by the same WebGL scene you see — transparent-PNG exports
  use the "Transparent" backdrop mode.
- The contact sheet is rendered at 512² per cell downscaled into a ~2000px sheet;
  crank `cellSize` in `KittenViewer.renderContactSheet()` for print.
- The fur colour lives in three layers (marching-cubes palette → vertex saddle/calico
  → fragment mackerel bands + speckle), so what you see is resolution-independent and
  needs no UV unwrap.
