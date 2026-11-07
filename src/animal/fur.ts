/**
 * fur.ts — builds the one continuous skin mesh from the skeleton's SDFs.
 *
 * Pipeline:
 *   1. A true signed-distance field is accumulated on a coarse grid — one
 *      exact SDF per skeleton primitive (sphere / tapered cone), combined with
 *      a polynomial smooth-min union. Dent primitives subtract via smooth-max.
 *      Smooth-min never "adds up" the way additive metaballs did, so limbs
 *      keep slim shafts and blend only inside a small, deliberate radius at
 *      each joint.
 *   2. The grid is injected into a reused MarchingCubes instance (values are
 *      written straight into its field array; the zero crossing is the
 *      isosurface). No seams — always exactly one shell.
 *   3. The used vertex range is copied into a compact BufferGeometry.
 *   4. Palette colours are re-normalised per vertex (nearest-primitive weights).
 *   5. Per-vertex tint pass: dark spine saddle, calico blotches, stripe mask
 *      (aStripe attribute — belly/socks/muzzle excluded).
 *   6. Fragment shader: wavy mackerel bands + guard-hair speckle, no textures.
 *
 * One mesh. No seams. The cat is one animal.
 */

import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mulberry32, seedFromString, type CoatSpec } from './coats';
import type { FieldPrimitive } from './skeleton';

export const FIELD = {
  /** World→field mapping: world = CENTER + v * RADIUS, v ∈ [-1, 1]. */
  center: new THREE.Vector3(0, 0.62, 0.03),
  radius: 1.08,
  resolution: 80,
  maxPolyCount: 130_000,
  isolation: 80,
};

const FAR = 1e3; // grid sentinel for "no primitive reaches this cell"

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Polynomial smooth-min (IQ). Commutative pairwise; order-independent enough. */
export const sminPoly = (a: number, b: number, k: number): number => {
  if (k <= 1e-6) return Math.min(a, b);
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
};

/** Polynomial smooth-max (dual of smin). */
export const smaxPoly = (a: number, b: number, k: number): number => -sminPoly(-a, -b, k);

/** Exact SDF of a (possibly tapered) cone segment a→b with end radii r1→r2.
 *  Degenerates to a sphere when a == b. Negative inside. */
export function sdPrimitive(px: number, py: number, pz: number, prim: FieldPrimitive): number {
  const ax = prim.a.x, ay = prim.a.y, az = prim.a.z;
  const abx = prim.b.x - ax, aby = prim.b.y - ay, abz = prim.b.z - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const mx = (ax + prim.b.x) * 0.5, my = (ay + prim.b.y) * 0.5, mz = (az + prim.b.z) * 0.5;
  const qx = px - mx, qy = py - my, qz = pz - mz;
  if (len2 < 1e-10) {
    return Math.sqrt(qx * qx + qy * qy + qz * qz) - prim.r1;
  }
  const invLen = 1 / Math.sqrt(len2);
  const ux = abx * invLen, uy = aby * invLen, uz = abz * invLen;
  const h = 0.5 * Math.sqrt(len2);
  const y = qx * ux + qy * uy + qz * uz;
  const rx = qx - ux * y, ry = qy - uy * y, rz = qz - uz * y;
  const rad = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const r1 = prim.r1, r2 = prim.r2;
  // Inigo Quilez sdCappedCone — exact cone frustum SDF (flat caps).
  const k1x = r2, k1y = h;
  const k2x = r2 - r1, k2y = 2 * h;
  const cax = rad - Math.min(rad, y < 0 ? r1 : r2);
  const cay = Math.abs(y) - h;
  const t = clamp01(((k1x - rad) * k2x + (k1y - y) * k2y) / (k2x * k2x + k2y * k2y));
  const cbx = rad - k1x + k2x * t;
  const cby = y - k1y + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

/** World-space signed distance at a point (negative inside the skin). */
export function fieldAtPoint(p: THREE.Vector3, primitives: FieldPrimitive[]): number {
  let acc = FAR;
  for (const prim of primitives) {
    const d = sdPrimitive(p.x, p.y, p.z, prim);
    acc = prim.dent ? smaxPoly(acc, -d, prim.blend) : sminPoly(acc, d, prim.blend);
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* Small JS twin of the GLSL value noise (for the blotch/saddle pass)  */
/* ------------------------------------------------------------------ */

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi), c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1), c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/* ------------------------------------------------------------------ */
/* Marching Cubes (reused instance)                                    */
/* ------------------------------------------------------------------ */

let marchingCubes: MarchingCubes | null = null;

function getMarchingCubes(): MarchingCubes {
  if (!marchingCubes) {
    // enableColors = true; UVs are useless here (we shade in world space).
    marchingCubes = new MarchingCubes(
      FIELD.resolution,
      new THREE.MeshStandardMaterial(),
      false,
      true,
      FIELD.maxPolyCount,
    );
    marchingCubes.isolation = FIELD.isolation;
  }
  return marchingCubes;
}

export interface BuiltSkin {
  geometry: THREE.BufferGeometry;
  /** Number of real triangles (MC preallocates a much larger buffer). */
  triangles: number;
}

/**
 * Accumulate the smooth-min union of every primitive onto a world-aligned
 * grid. Returns the raw SDF grid (negative inside); cells no primitive
 * touches keep FAR.
 */
function buildFieldGrid(primitives: FieldPrimitive[]): Float32Array {
  const res = FIELD.resolution;
  const half = FIELD.radius;
  const cellWorld = (2 * half) / res;
  const invCell = 1 / cellWorld;
  const C = FIELD.center;
  const acc = new Float32Array(res * res * res);
  acc.fill(FAR);
  for (const prim of primitives) {
    const maxR = Math.max(prim.r1, prim.r2);
    const margin = maxR + prim.blend + 2.5 * cellWorld;
    const minX = Math.min(prim.a.x, prim.b.x) - margin;
    const maxX = Math.max(prim.a.x, prim.b.x) + margin;
    const minY = Math.min(prim.a.y, prim.b.y) - margin;
    const maxY = Math.max(prim.a.y, prim.b.y) + margin;
    const minZ = Math.min(prim.a.z, prim.b.z) - margin;
    const maxZ = Math.max(prim.a.z, prim.b.z) + margin;
    const ix0 = Math.max(0, Math.floor((minX - C.x) * invCell + res / 2));
    const ix1 = Math.min(res - 1, Math.ceil((maxX - C.x) * invCell + res / 2));
    const iy0 = Math.max(0, Math.floor((minY - C.y) * invCell + res / 2));
    const iy1 = Math.min(res - 1, Math.ceil((maxY - C.y) * invCell + res / 2));
    const iz0 = Math.max(0, Math.floor((minZ - C.z) * invCell + res / 2));
    const iz1 = Math.min(res - 1, Math.ceil((maxZ - C.z) * invCell + res / 2));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = (iz - res / 2) * cellWorld + C.z;
      const zOff = iz * res * res;
      for (let iy = iy0; iy <= iy1; iy++) {
        const py = (iy - res / 2) * cellWorld + C.y;
        const yOff = zOff + iy * res;
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = (ix - res / 2) * cellWorld + C.x;
          const i = yOff + ix;
          const d = sdPrimitive(px, py, pz, prim);
          acc[i] = prim.dent ? smaxPoly(acc[i], -d, prim.blend) : sminPoly(acc[i], d, prim.blend);
        }
      }
    }
  }
  return acc;
}

/**
 * Polygonise the primitives into a compact, coloured, smooth-normal skin geometry.
 */
export function buildSkinGeometry(primitives: FieldPrimitive[], spec: CoatSpec): BuiltSkin {
  const mc = getMarchingCubes();
  mc.reset();

  // Inject the SDF straight into the MarchingCubes field array. The zero
  // crossing IS the isosurface — one shell, always. Field scale is arbitrary
  // (the interpolation ratio is scale-invariant); 60 keeps fp32 margins large.
  const grid = buildFieldGrid(primitives);
  const field = mc.field as Float32Array;
  const SCALE = 60;
  for (let i = 0; i < grid.length; i++) {
    field[i] = FIELD.isolation - grid[i] * SCALE;
  }
  mc.update();

  const count = mc.count; // vertices written (unindexed triangles)
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  positions.set(mc.positionArray.subarray(0, count * 3));
  normals.set(mc.normalArray.subarray(0, count * 3));
  colors.set(mc.colorArray.subarray(0, count * 3));
  // MC works in a [-radius, radius] cube; we authored the primitives in world units,
  // so scale back up and re-centralise on the field centre.
  const cx = FIELD.center.x, cy = FIELD.center.y, cz = FIELD.center.z, half = FIELD.radius;
  for (let i = 0; i < count * 3; i += 3) {
    positions[i] = positions[i] * half + cx;
    positions[i + 1] = positions[i + 1] * half + cy;
    positions[i + 2] = positions[i + 2] * half + cz;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Normalise normals (MC gradients are unnormalised).
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < normalAttr.count; i++) {
    n.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i)).normalize();
    normalAttr.setXYZ(i, n.x, n.y, n.z);
  }

  normalizePaletteColors(geometry, primitives, spec);
  paintFacets(geometry, spec);

  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, triangles: count / 3 };
}

/**
 * Per-vertex palette: each vertex is tinted by the primitives nearest to it,
 * with a sharp inverse-distance falloff, so socks/cream boundaries stay crisp
 * while colours blend smoothly across joints. `aFlow` comes out as the
 * weight-matched mean of the endpoint flows (interpolated along each cone).
 */
function normalizePaletteColors(geometry: THREE.BufferGeometry, primitives: FieldPrimitive[], spec: CoatSpec): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;

  const prims = primitives
    .filter((prim) => !prim.dent)
    .map((prim) => {
      const maxR = Math.max(prim.r1, prim.r2);
      const minX = Math.min(prim.a.x, prim.b.x) - maxR - 0.06;
      const maxX = Math.max(prim.a.x, prim.b.x) + maxR + 0.06;
      const minY = Math.min(prim.a.y, prim.b.y) - maxR - 0.06;
      const maxY = Math.max(prim.a.y, prim.b.y) + maxR + 0.06;
      const minZ = Math.min(prim.a.z, prim.b.z) - maxR - 0.06;
      const maxZ = Math.max(prim.a.z, prim.b.z) + maxR + 0.06;
      const abx = prim.b.x - prim.a.x, aby = prim.b.y - prim.a.y, abz = prim.b.z - prim.a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      return {
        prim,
        color: roleColorFor(prim.color, spec),
        weight: prim.color === 'sock' ? 1.9 : 1,
        minX, maxX, minY, maxY, minZ, maxZ,
        abx, aby, abz, len2,
      };
    });

  const flowAttr = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
    let sumR = 0, sumG = 0, sumB = 0, sumW = 0, sumFlow = 0;
    for (const entry of prims) {
      if (vx < entry.minX || vx > entry.maxX || vy < entry.minY || vy > entry.maxY || vz < entry.minZ || vz > entry.maxZ) continue;
      const d = Math.max(sdPrimitive(vx, vy, vz, entry.prim), 0);
      const w = entry.weight / Math.pow(d + 0.03, 4);
      let t = 0;
      if (entry.len2 > 1e-10) {
        t = clamp01(((vx - entry.prim.a.x) * entry.abx + (vy - entry.prim.a.y) * entry.aby + (vz - entry.prim.a.z) * entry.abz) / entry.len2);
      }
      const flow = entry.prim.flowA + (entry.prim.flowB - entry.prim.flowA) * t;
      sumR += entry.color.r * w;
      sumG += entry.color.g * w;
      sumB += entry.color.b * w;
      sumFlow += flow * w;
      sumW += w;
    }
    if (sumW > 1e-6) {
      colorAttr.setXYZ(i, sumR / sumW, sumG / sumW, sumB / sumW);
      flowAttr[i] = sumFlow / sumW;
    }
  }
  colorAttr.needsUpdate = true;
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flowAttr, 1));
}

function roleColorFor(role: FieldPrimitive['color'], spec: CoatSpec): THREE.Color {
  const hex =
    role === 'cream'
      ? spec.light
      : role === 'sock'
        ? '#f3eee2'
        : role === 'saddle'
          ? spec.dark
          : spec.base;
  return new THREE.Color(hex);
}

const SOCK = new THREE.Color('#f3eee2');

/**
 * Per-vertex artistic passes: saddle along the spine, calico blotches,
 * and the aStripe mask consumed by the fragment shader.
 */
function paintFacets(geometry: THREE.BufferGeometry, spec: CoatSpec): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
  const stripeMask = new Float32Array(posAttr.count);

  const rand = mulberry32(seedFromString(`animalanimator:blotch:${spec.id}`));
  const blotchSeed = rand() * 100;
  const blotchSeed2 = rand() * 100;
  const saddle = new THREE.Color(spec.dark);
  const isCalico = spec.id === 'calico';
  const tabbyOrange = new THREE.Color('#c56f2f');
  const tabbyDark = new THREE.Color('#33302b');

  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    p.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    c.set(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i));

    const sockAmount = 1 - smoothstepColor(c, SOCK, 0.28);
    const creamAmount = 1 - smoothstepColor(c, new THREE.Color(spec.light), 0.32);

    // --- saddle: darken along the spine line, top of the torso + head crest
    const saddleFalloff = Math.exp(-(p.x * p.x) / (2 * 0.16 * 0.16));
    const saddleMask = saddleFalloff * smoothstepRange(0.36, 0.52, p.y) * (1 - sockAmount);
    c.lerp(saddle, saddleMask * 0.42);

    // --- calico blotches: two seeded value-noise channels
    if (isCalico) {
      const n1 = valueNoise3(p.x * 2.35 + blotchSeed, p.y * 2.35, p.z * 2.35);
      const n2 = valueNoise3(p.x * 3.1, p.y * 3.1 + blotchSeed2, p.z * 3.1);
      if (n1 > 0.6 && sockAmount < 0.4) c.lerp(tabbyOrange, smoothstepRange(0.6, 0.72, n1) * 0.9);
      if (n2 > 0.62 && sockAmount < 0.4) c.lerp(tabbyDark, smoothstepRange(0.62, 0.74, n2) * 0.88);
    }

    colorAttr.setXYZ(i, c.r, c.g, c.b);

    // --- stripe mask: full on the torso flanks, fade at belly and socks
    const bellyFade = smoothstepRange(0.17, 0.3, p.y); // legs fade out
    const lowerFaceFade = 1 - smoothstepRange(0.75, 0.9, p.y) * 0; // head keeps stripes
    void lowerFaceFade;
    stripeMask[i] = bellyFade * (1 - sockAmount * 0.95) * (1 - creamAmount * 0.55);
  }

  colorAttr.needsUpdate = true;
  geometry.setAttribute('aStripe', new THREE.BufferAttribute(stripeMask, 1));
}

function smoothstepRange(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothstepColor(a: THREE.Color, b: THREE.Color, radius: number): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  const d = Math.sqrt(dr * dr + dg * dg + db * db);
  return smoothstepRange(radius * 0.35, radius, d); // 0 = identical to b
}

/* ------------------------------------------------------------------ */
/* Field query — used to lock non-fur features onto the isosurface     */
/* ------------------------------------------------------------------ */

/**
 * March from `origin` along `dir` until the skin field rises through the
 * isosurface (binary-refined). Lets accessories sit exactly on the skin
 * instead of on top of primitive guesses. Falls back to maxDist if the ray
 * never leaves the solid.
 */
export function surfaceDistance(
  primitives: FieldPrimitive[],
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist = 0.9,
): number {
  let prevT = 0;
  let prev = fieldAtPoint(origin, primitives);
  // Origins on/near the surface can start inside the solid — the march below
  // always needs prev < 0, so if the origin is already OUTSIDE, walk backwards
  // until it is inside.
  if (prev >= 0) {
    const pre = new THREE.Vector3();
    let back = 0;
    for (; back <= 0.45; back += 0.012) {
      pre.copy(origin).addScaledVector(dir, -back);
      const f = fieldAtPoint(pre, primitives);
      if (f < 0) {
        // Re-anchor: distance returned is measured from the ORIGINAL origin,
        // so add the offset walked back.
        origin = pre.clone();
        maxDist += back;
        prevT = 0;
        prev = f;
        break;
      }
    }
    if (back > 0.45) return 0; // completely lost — give up gracefully
  }
  const steps = 72;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * maxDist;
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const pz = origin.z + dir.z * t;
    const f = fieldAtPoint(new THREE.Vector3(px, py, pz), primitives);
    if (prev < 0 && f >= 0) {
      let lo = prevT;
      let hi = t;
      for (let j = 0; j < 14; j++) {
        const mid = (lo + hi) / 2;
        const fm = fieldAtPoint(
          new THREE.Vector3(origin.x + dir.x * mid, origin.y + dir.y * mid, origin.z + dir.z * mid),
          primitives,
        );
        if (fm < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prevT = t;
    prev = f;
  }
  return maxDist;
}

/* ------------------------------------------------------------------ */
/* Fur material (vertex colours + procedural mackerel bands)           */
/* ------------------------------------------------------------------ */

export function makeFurMaterial(spec: CoatSpec): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  // Distinct program per coat — onBeforeCompile bakes stripe uniforms in.
  material.customProgramCacheKey = () => `fur:${spec.id}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStripeColor = { value: new THREE.Color(spec.stripe) };
    shader.uniforms.uStripeStrength = { value: spec.stripeStrength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStripe;\nattribute float aFlow;\nvarying vec3 vFurPos;\nvarying float vStripeMask;\nvarying float vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStripeMask = aStripe;\nvFlow = aFlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uStripeColor;
        uniform float uStripeStrength;
        varying vec3 vFurPos;
        varying float vStripeMask;
        varying float vFlow;
        float furHash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        float furNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = furHash(i);
          float n100 = furHash(i + vec3(1.0, 0.0, 0.0));
          float n010 = furHash(i + vec3(0.0, 1.0, 0.0));
          float n110 = furHash(i + vec3(1.0, 1.0, 0.0));
          float n001 = furHash(i + vec3(0.0, 0.0, 1.0));
          float n101 = furHash(i + vec3(1.0, 0.0, 1.0));
          float n011 = furHash(i + vec3(0.0, 1.0, 1.0));
          float n111 = furHash(i + vec3(1.0, 1.0, 1.0));
          return mix(
            mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
            mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
            f.z
          );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 fp = vFurPos;
          float wobble = furNoise(fp * 3.2) * 2.6;
          // mackerel bars run PERPENDICULAR to the animal's own axis
          // (spine → neck → head → limbs/tail), wobbling organically
          float band = sin(vFlow * 44.0 + wobble);
          float stripe = smoothstep(0.38, 0.96, band) * vStripeMask * uStripeStrength;
          diffuseColor.rgb = mix(diffuseColor.rgb, uStripeColor, stripe * 0.9);
          // guard-hair speckle kills the plastic look
          float guard = furNoise(fp * 51.0);
          diffuseColor.rgb *= 0.93 + 0.14 * smoothstep(0.45, 0.9, guard);
        }`,
      );
  };
  return material;
}
