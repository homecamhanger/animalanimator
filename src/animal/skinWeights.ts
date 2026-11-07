/**
 * skinWeights.ts — analytic per-vertex bone weights for the standing skin.
 *
 * This is the seed of the skinning pipeline (docs/anatomy.md). For every mesh
 * vertex, an influence field is evaluated against every bone:
 *
 *     field(vertex, bone) = exp(-(d / σ)²)
 *
 * where `d` is the signed distance from the vertex to the bone's surface
 * (negative inside). The top-4 fields per vertex are kept and renormalised to
 * sum to 1. Because weights are a pure function of position, coincident
 * vertices (the marching-cubes shell is unindexed) receive identical weights
 * and therefore identical displacement — seams can never crack.
 *
 * Distances:
 *   capsule   — point-to-segment minus radius (the common case)
 *   via       — quadratic Bézier (ribs, jaw, zygomatic arches): sampled into a
 *               9-segment polyline once per solve, min distance minus radius
 *   ellipsoid — capsule from→to with the minor radius (cranium, sacrum)
 *   plate     — shallow capsule along their long axis, influence scaled ×0.55
 *
 * Dewclaw and vestigial metatarsal I bones are weighted like everything else
 * (they get real weights, per the design decision in docs/anatomy.md).
 */
import * as THREE from 'three';
import {
  buildAnatomy,
  ANATOMY_REGIONS,
  type AnatomicalBone,
  type AnatomyRegion,
} from './anatomy';

/** Debug palette for the weights view — saturated region hues on the dark scene. */
export const REGION_DEBUG_HEX: Record<AnatomyRegion, string> = {
  skull: '#ffd166',
  spine: '#ef476f',
  ribcage: '#8ecae6',
  forelimb: '#06d6a0',
  hindlimb: '#fb8500',
  tail: '#c77dff',
};

export interface SkinWeights {
  /** n × 4 bone indices into the bone list passed to computeSkinWeights(). */
  indices: Uint16Array;
  /** n × 4 influences, every row sums to 1. */
  weights: Float32Array;
  boneCount: number;
  vertexCount: number;
  /** Σ weights per bone — 0 means the bone owns no flesh and was force-bound. */
  boneMass: Float64Array;
}

/** Field falloff, world units. Fur half-widths are ~0.08–0.19; σ ≈ 60 % of that. */
const SIGMA = 0.058;
/** Spine bones get a wider field — the bare fur topline rides ~0.22 above the
 *  vertebral column, far beyond the cutoff of a midline capsule; without the
 *  widening the topline falls into the rigid dead-zone bind and tears in
 *  extreme poses (play-bow stretch). */
const SIGMA_SPINE = 0.1;
/** Skip bone fields weaker than this outright. */
const FIELD_FLOOR = 1e-4; // ≈0.176 units cutoff — influences weaker than this are noise, not skin
const INFLUENCES = 4;
const PLATE_RADIUS = 0.021;
const PLATE_GAIN = 0.55;

interface BoneField {
  bone: AnatomicalBone;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  radius: number;
  sigma: number;
  /** Sampled polyline for curved (`via`) bones: 2×(segments+1) coords ×3. */
  arc: Float32Array | null;
  gain: number;
  /** AABB expanded by the cutoff — cheap reject before any distance math. */
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

const CUTOFF = Math.sqrt(-Math.log(FIELD_FLOOR)) * SIGMA_SPINE; // max field reach (spine is widest)

function sampleArc(bone: AnatomicalBone, segments: number): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  const [ax, ay, az] = bone.from;
  const [cx, cy, cz] = bone.via!;
  const [bx, by, bz] = bone.to;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out[i * 3] = u * u * ax + 2 * u * t * cx + t * t * bx;
    out[i * 3 + 1] = u * u * ay + 2 * u * t * cy + t * t * by;
    out[i * 3 + 2] = u * u * az + 2 * u * t * cz + t * t * bz;
  }
  return out;
}

function makeField(bone: AnatomicalBone): BoneField {
  const arc = bone.via && bone.shape !== 'plate' ? sampleArc(bone, 8) : null;
  const radius = bone.shape === 'plate'
    ? PLATE_RADIUS
    : bone.shape === 'ellipsoid'
      ? bone.radii?.[0] ?? 0.02
      : bone.girth;
  const gain = bone.shape === 'plate' ? PLATE_GAIN : 1;
  const isSpine = bone.region === 'spine' && bone.shape !== 'plate';
  const sigma = isSpine ? SIGMA_SPINE : SIGMA;

  // bounds over from/to (+ the arc when present), expanded by the cutoff + radius
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const eat = (x: number, y: number, z: number): void => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };
  eat(bone.from[0], bone.from[1], bone.from[2]);
  eat(bone.to[0], bone.to[1], bone.to[2]);
  if (arc) {
    for (let i = 0; i < arc.length; i += 3) eat(arc[i], arc[i + 1], arc[i + 2]);
  }
  const margin = CUTOFF + radius + 0.01;
  return {
    bone,
    ax: bone.from[0], ay: bone.from[1], az: bone.from[2],
    bx: bone.to[0], by: bone.to[1], bz: bone.to[2],
    radius, arc, gain,
    sigma,
    minX: minX - margin, maxX: maxX + margin,
    minY: minY - margin, maxY: maxY + margin,
    minZ: minZ - margin, maxZ: maxZ + margin,
  };
}

/** Squared distance point→segment. */
function distSeg2(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-12) {
    const dx = px - ax, dy = py - ay, dz = pz - az;
    return dx * dx + dy * dy + dz * dz;
  }
  let t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * abx), dy = py - (ay + t * aby), dz = pz - (az + t * abz);
  return dx * dx + dy * dy + dz * dz;
}

/** Signed distance from p to the bone surface (negative inside). */
function boneDistance(field: BoneField, px: number, py: number, pz: number): number {
  let best = Infinity;
  if (field.arc) {
    const arc = field.arc;
    for (let i = 0; i + 3 < arc.length + 0; i += 3) {
      // pairwise segments of the sampled polyline
      const j = i + 3;
      if (j >= arc.length) break;
      const d2 = distSeg2(px, py, pz, arc[i], arc[i + 1], arc[i + 2], arc[j], arc[j + 1], arc[j + 2]);
      if (d2 < best) best = d2;
    }
  } else {
    best = distSeg2(px, py, pz, field.ax, field.ay, field.az, field.bx, field.by, field.bz);
  }
  return Math.sqrt(best) - field.radius;
}

/**
 * Compute weights for every vertex in `position` (a flat xyz Float32Array, or
 * a `position` BufferAttribute — world space in the rest/standing pose).
 */
export function computeSkinWeights(
  position: Float32Array | THREE.BufferAttribute,
  bones: AnatomicalBone[] = buildAnatomy(),
): SkinWeights {
  const pos = position instanceof Float32Array ? position : (position.array as Float32Array);
  const vertexCount = Math.floor(pos.length / 3);
  const n = vertexCount;
  const fields = bones.map(makeField);

  const indices = new Uint16Array(n * INFLUENCES);
  const weights = new Float32Array(n * INFLUENCES);
  const boneMass = new Float64Array(bones.length);

  const topField = new Float32Array(INFLUENCES);
  const topBone = new Uint16Array(INFLUENCES);

  for (let vi = 0; vi < n; vi++) {
    const px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2];
    let filled = 0;
    let nearestD = Infinity;
    let nearestBone = -1;

    for (let bi = 0; bi < fields.length; bi++) {
      const field = fields[bi];
      if (px < field.minX || px > field.maxX || py < field.minY || py > field.maxY || pz < field.minZ || pz > field.maxZ) {
        continue;
      }
      const d = boneDistance(field, px, py, pz);
      if (d < nearestD) { nearestD = d; nearestBone = bi; }
      const f = Math.exp(-((d / field.sigma) * (d / field.sigma))) * field.gain;
      if (f < FIELD_FLOOR) continue;
      // insert into the top-K (sorted descending)
      let i = filled < INFLUENCES ? filled : INFLUENCES;
      if (filled < INFLUENCES) filled += 1;
      while (i > 0 && topField[i - 1] < f) {
        if (i < INFLUENCES) { topField[i] = topField[i - 1]; topBone[i] = topBone[i - 1]; }
        i -= 1;
      }
      if (i < INFLUENCES) { topField[i] = f; topBone[i] = bi; }
    }

    if (filled === 0 || nearestBone < 0) {
      // Dead zone — no bone's field reaches this vertex (e.g. the bare fur
      // topline, which rides ~0.22 above the vertebral column while the
      // cutoff is ≈0.176). The AABB-culled `nearestBone` is meaningless
      // here, so do a full scan for the TRUE nearest bone and bind rigidly.
      // Adjacent spine bones differ by only ~1–2° per pose, so a rigid bind
      // along the topline is visually indistinguishable from a blend.
      let trueD = Infinity;
      let trueBone = -1;
      for (let bi = 0; bi < fields.length; bi++) {
        const d = boneDistance(fields[bi], px, py, pz);
        if (d < trueD) { trueD = d; trueBone = bi; }
      }
      const target = trueBone < 0 ? 0 : trueBone;
      indices.set([target, 0, 0, 0], vi * INFLUENCES);
      weights.set([1, 0, 0, 0], vi * INFLUENCES);
      boneMass[target] += 1;
      continue;
    }

    let sum = 0;
    for (let i = 0; i < filled; i++) sum += topField[i];
    for (let i = 0; i < INFLUENCES; i++) {
      if (i < filled) {
        const w = topField[i] / sum;
        indices[vi * INFLUENCES + i] = topBone[i];
        weights[vi * INFLUENCES + i] = w;
        boneMass[topBone[i]] += w;
      } else {
        indices[vi * INFLUENCES + i] = 0;
        weights[vi * INFLUENCES + i] = 0;
      }
    }
  }

  // Orphan pass: a bone that owns no flesh can never drag its skin along.
  // Force-bind its nearest vertex to it (rigid) so the rig is total.
  // CRITICAL: the shell is unindexed — every seam vertex exists in several
  // rows at identical coordinates, and ALL of them must receive the same
  // rebind or the mesh cracks (a vertex glued to one bone while its twins
  // follow another tears a hole in the skin).
  const positionRows = new Map<string, number[]>();
  for (let vi = 0; vi < n; vi++) {
    // Exact string key of the raw coordinates — identical shell duplicates
    // produce identical strings, so every twin row is found.
    const key = `${pos[vi * 3]},${pos[vi * 3 + 1]},${pos[vi * 3 + 2]}`;
    const rows = positionRows.get(key);
    if (rows) rows.push(vi); else positionRows.set(key, [vi]);
  }
  for (let bi = 0; bi < bones.length; bi++) {
    if (boneMass[bi] > 0) continue;
    const field = fields[bi];
    const cx = (field.ax + field.bx) / 2, cy = (field.ay + field.by) / 2, cz = (field.az + field.bz) / 2;
    let bestD = Infinity;
    let bestRows: number[] | null = null;
    for (const rows of positionRows.values()) {
      const vi = rows[0];
      const dx = pos[vi * 3] - cx, dy = pos[vi * 3 + 1] - cy, dz = pos[vi * 3 + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestRows = rows; }
    }
    if (!bestRows) continue;
    for (const vi of bestRows) {
      const base = vi * INFLUENCES;
      const displacedBone = indices[base];
      const displacedWeight = weights[base];
      boneMass[displacedBone] -= displacedWeight;
      for (let i = 0; i < INFLUENCES; i++) { indices[base + i] = 0; weights[base + i] = 0; }
      indices[base] = bi;
      weights[base] = 1;
      boneMass[bi] += 1;
    }
  }

  return { indices, weights, boneCount: bones.length, vertexCount: n, boneMass };
}

/** Write a flat per-vertex RGB palette of dominant-bone region hues, shaded by dominance. */
export function paintBoneWeightColors(
  out: Float32Array,
  sw: SkinWeights,
  bones: AnatomicalBone[] = buildAnatomy(),
): void {
  const regionOf = bones.map((b) => ANATOMY_REGIONS.indexOf(b.region));
  const hexes = ANATOMY_REGIONS.map((r) => REGION_DEBUG_HEX[r]);
  const rgb = hexes.map((hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
  });
  for (let vi = 0; vi < sw.vertexCount; vi++) {
    let best = -1, bestW = 0;
    for (let i = 0; i < INFLUENCES; i++) {
      const w = sw.weights[vi * INFLUENCES + i];
      if (w > bestW) { bestW = w; best = i; }
    }
    if (best < 0 || bestW <= 0) continue;
    const bone = sw.indices[vi * INFLUENCES + best];
    const shade = 0.45 + 0.55 * Math.min(1, bestW); // low-confidence verts read dimmer
    const [r, g, b] = rgb[regionOf[bone]];
    out[vi * 3] = (r / 255) * shade;
    out[vi * 3 + 1] = (g / 255) * shade;
    out[vi * 3 + 2] = (b / 255) * shade;
  }
}
