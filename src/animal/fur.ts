/**
 * fur.ts — builds the one continuous skin mesh from the skeleton's field balls.
 *
 * Pipeline:
 *   1. MarchingCubes ingests the balls (reused instance, reset per rebuild).
 *   2. The used vertex range is copied into a compact BufferGeometry.
 *   3. Palette colours are re-normalised per vertex (exact field-weighted mean).
 *   4. Per-vertex tint pass: dark spine saddle, calico blotches, stripe mask
 *      (aStripe attribute — belly/socks/muzzle excluded).
 *   5. Fragment shader: wavy mackerel bands + guard-hair speckle, no textures.
 *
 * One mesh. No seams. The cat is one animal.
 */

import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mulberry32, seedFromString, type CoatSpec } from './coats';
import type { FieldBall } from './skeleton';

export const FIELD = {
  /** World→field mapping: world = CENTER + v * RADIUS, v ∈ [-1, 1]. */
  center: new THREE.Vector3(0, 0.62, 0.03),
  radius: 1.08,
  resolution: 80,
  maxPolyCount: 130_000,
  isolation: 80,
  subtract: 45,
};

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
 * Polygonise the balls into a compact, coloured, smooth-normal skin geometry.
 */
export function buildSkinGeometry(balls: FieldBall[], spec: CoatSpec): BuiltSkin {
  const mc = getMarchingCubes();
  mc.reset();

  const cx = FIELD.center.x, cy = FIELD.center.y, cz = FIELD.center.z, half = FIELD.radius;
  const fieldOf = (p: THREE.Vector3) => ({
    x: (p.x - cx) / (2 * half) + 0.5,
    y: (p.y - cy) / (2 * half) + 0.5,
    z: (p.z - cz) / (2 * half) + 0.5,
  });

  const roleColors = new Map<string, THREE.Color>();
  const roleColor = (role: FieldBall['color']): THREE.Color => {
    let cached = roleColors.get(role);
    if (!cached) {
      const hex =
        role === 'cream'
          ? spec.light
          : role === 'sock'
            ? '#f3eee2'
            : role === 'saddle'
              ? spec.dark
              : role === 'earFur'
                ? spec.base
                : spec.base;
      cached = new THREE.Color(hex);
      roleColors.set(role, cached);
    }
    return cached;
  };

  for (const ball of balls) {
    const f = fieldOf(ball.pos);
    const rNorm = ball.radius / (2 * half);
    // strength = (isolation + subtract) * r²  → ball radius ≈ authored radius
    const strength = (FIELD.isolation + FIELD.subtract) * rNorm * rNorm;
    mc.addBall(f.x, f.y, f.z, strength, FIELD.subtract, roleColor(ball.color));
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
  // MC works in a [-radius, radius] cube; we authored the balls in world units,
  // so scale back up and re-centralise on the field centre.
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

  normalizePaletteColors(geometry, balls, spec);
  paintFacets(geometry, spec);

  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, triangles: count / 3 };
}

/** Exact per-vertex re-normalisation of the accumulated palette weights. */
function normalizePaletteColors(geometry: THREE.BufferGeometry, balls: FieldBall[], spec: CoatSpec): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
  const half = FIELD.radius;
  const fieldBalls = balls.map((ball) => ({
    fx: (ball.pos.x - FIELD.center.x) / (2 * half) + 0.5,
    fy: (ball.pos.y - FIELD.center.y) / (2 * half) + 0.5,
    fz: (ball.pos.z - FIELD.center.z) / (2 * half) + 0.5,
    cut: Math.sqrt(((FIELD.isolation + FIELD.subtract) * ball.radius * ball.radius) / FIELD.subtract) / (2 * half),
    color: roleColorFor(ball.color, spec),
    flow: ball.flow,
  }));

  // Precompute per-ball cut radii in field units.
  const v = new THREE.Vector3();
  const sum = { r: 0, g: 0, b: 0, w: 0, flow: 0 };
  const flowAttr = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const fx = (v.x - FIELD.center.x) / (2 * half) + 0.5;
    const fy = (v.y - FIELD.center.y) / (2 * half) + 0.5;
    const fz = (v.z - FIELD.center.z) / (2 * half) + 0.5;
    sum.r = 0; sum.g = 0; sum.b = 0; sum.w = 0; sum.flow = 0;
    for (const ball of fieldBalls) {
      const dx = fx - ball.fx, dy = fy - ball.fy, dz = fz - ball.fz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= ball.cut) continue;
      const ratio = dist / ball.cut;
      const contrib = 1 - ratio * ratio * ratio * (ratio * (ratio * 6 - 15) + 10);
      sum.r += ball.color.r * contrib;
      sum.g += ball.color.g * contrib;
      sum.b += ball.color.b * contrib;
      sum.w += contrib;
      sum.flow += ball.flow * contrib;
    }
    if (sum.w > 1e-5) {
      colorAttr.setXYZ(i, sum.r / sum.w, sum.g / sum.w, sum.b / sum.w);
      flowAttr[i] = sum.flow / sum.w;
    }
  }
  colorAttr.needsUpdate = true;
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flowAttr, 1));
}

function roleColorFor(role: FieldBall['color'], spec: CoatSpec): THREE.Color {
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

/** Exact field value at a world point (same math as the Marching Cubes). */
export function fieldAtPoint(p: THREE.Vector3, balls: FieldBall[]): number {
  const half = FIELD.radius;
  const res = FIELD.resolution;
  const axis = (v: number, i: number) =>
    ((v - FIELD.center.getComponent(i)) / (2 * half) + 0.5) * res;
  const sub = FIELD.subtract;
  let sum = 0;
  for (const ball of balls) {
    const rField = ball.radius / (2 * half);
    const strength = (FIELD.isolation + sub) * rField * rField * res * res;
    const cutoff = Math.sqrt(strength / sub);
    const dx = axis(p.x, 0) - axis(ball.pos.x, 0);
    const dy = axis(p.y, 1) - axis(ball.pos.y, 1);
    const dz = axis(p.z, 2) - axis(ball.pos.z, 2);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > cutoff * cutoff) continue;
    sum += strength / (1e-6 + d2) - sub;
  }
  return sum;
}

/**
 * Distance from `origin` along `dir` until the field drops through the
 * isosurface (binary-refined). Lets accessories sit exactly on the skin
 * instead of on top of bone guesses. Falls back to maxDist if the ray
 * never leaves the solid (should not happen for face features).
 */
export function surfaceDistance(
  balls: FieldBall[],
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist = 0.9,
): number {
  let prevT = 0;
  let prev = fieldAtPoint(origin, balls);
  // Origins on/near the surface can start outside the solid — walk backwards
  // until inside so the march below always sees prev >= isolation.
  if (prev < FIELD.isolation) {
    const pre = new THREE.Vector3();
    let back = 0;
    for (; back <= 0.45; back += 0.012) {
      pre.copy(origin).addScaledVector(dir, -back);
      const f = fieldAtPoint(pre, balls);
      if (f >= FIELD.isolation) {
        // Re-anchor: distance returned is measured from the ORIGINAL origin,
        // so subtract the negative offset walked back.
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
    const f = fieldAtPoint(new THREE.Vector3(px, py, pz), balls);
    if (prev >= FIELD.isolation && f < FIELD.isolation) {
      let lo = prevT;
      let hi = t;
      for (let j = 0; j < 14; j++) {
        const mid = (lo + hi) / 2;
        const fm = fieldAtPoint(
          new THREE.Vector3(origin.x + dir.x * mid, origin.y + dir.y * mid, origin.z + dir.z * mid),
          balls,
        );
        if (fm >= FIELD.isolation) lo = mid;
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
