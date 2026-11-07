/**
 * skinning.ts — dual-quaternion skinning core.
 *
 * Pure math; no anatomy, no SDF. A bone is described by a world-space
 * delta transform (see skinRig.ts for how those are derived from the solved
 * poses). Vertices blend the per-bone transforms with the top-4 influences
 * from skinWeights.ts using dual quaternions:
 *
 *     q'  = Σ wᵢ qᵢ   (hemisphere-flipped so dot(qᵢ, q₀) ≥ 0)
 *     q'⃗  = Σ wᵢ q⃗ᵢ
 *     p'  = rotate(p, q'/|q'|) + 2·vec(q⃗' · conj(q'/|q'|))
 *
 * Dual quaternions kill the candy-wrapper collapse of linear blend skinning,
 * which matters at the shoulders, hips and the ribcage midline.
 *
 * Everything here is allocation-free in the per-vertex path so the viewer
 * can deform 48k verts on every pose switch without GC pressure.
 */
import * as THREE from 'three';
import type { SkinWeights } from './skinWeights';

/** Rigid delta applied to the skin by one bone. */
export interface BoneDelta {
  /** v' = matrix · v (rotation about the bone's rest pivot, translation to rest pose). */
  matrix: THREE.Matrix4;
  /** The pure-rotation part of the delta as a unit quaternion. */
  rotation: THREE.Quaternion;
}

const IDENTITY_Q = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Build the delta that rotates the rest frame about pivot `o` by `rotation`,
 * carrying the pivot to `posed`:
 *
 *     v' = R · (v − o) + o'
 */
export function makePivotDelta(
  o: THREE.Vector3,
  rotation: THREE.Quaternion,
  posed: THREE.Vector3,
): BoneDelta {
  const moved = new THREE.Matrix4().compose(posed, rotation, ONE);
  const unpivot = new THREE.Matrix4().compose(o.clone().negate(), IDENTITY_Q, ONE);
  return { matrix: moved.multiply(unpivot), rotation: rotation.clone() };
}

/** Identity delta — the pose matches rest. */
export function identityDelta(): BoneDelta {
  return { matrix: new THREE.Matrix4(), rotation: new THREE.Quaternion() };
}

/** Dual quaternion pair (qr; qd), qd = ½ t ⊗ qr, where t is the translational part. */
export interface DualQuat {
  r: THREE.Quaternion;
  d: THREE.Quaternion;
}

/** Convert a delta to (qr; qd). Translation comes from the matrix; rotation is separate. */
export function toDualQuat(delta: BoneDelta): DualQuat {
  const t = new THREE.Vector3().setFromMatrixPosition(delta.matrix);
  const r = delta.rotation.clone();
  const dHalf = new THREE.Quaternion(t.x, t.y, t.z, 0).multiply(r);
  const d = new THREE.Quaternion(dHalf.x * 0.5, dHalf.y * 0.5, dHalf.z * 0.5, dHalf.w * 0.5);
  return { r, d };
}

/** Shortest-arc rotation taking direction `from` onto direction `to` (unit vectors in, unit quaternion out). */
export function shortestArcRotation(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const f = from.clone().normalize();
  const t = to.clone().normalize();
  const dot = f.dot(t);
  if (dot > 0.9999995) return new THREE.Quaternion();
  if (dot < -0.9999995) {
    // Opposite directions — rotate 180° about any axis orthogonal to f.
    const axis = new THREE.Vector3(1, 0, 0);
    if (Math.abs(f.x) > 0.9) axis.set(0, 1, 0);
    const ortho = axis.cross(f).normalize();
    return new THREE.Quaternion().setFromAxisAngle(ortho, Math.PI);
  }
  const axis = new THREE.Vector3().crossVectors(f, t);
  const s = Math.sqrt((1 + dot) * 2);
  const invS = 1 / s;
  return new THREE.Quaternion(axis.x * invS, axis.y * invS, axis.z * invS, s * 0.5);
}

/**
 * Deform a vertex buffer in place from the rest pose.
 *
 * @param restPositions  xyz triples (input, never mutated)
 * @param restNormals    xyz triples (input, never mutated)
 * @param outPositions   xyz triples (output; pass `restPositions` for in-place)
 * @param outNormals     xyz triples (output; pass `restNormals` for in-place)
 * @param skin           top-4 bone indices/weights per vertex (row sums = 1)
 * @param deltas         one BoneDelta per bone, in the same order `skin.indices` references
 */
export function deformSkin(
  restPositions: Float32Array,
  restNormals: Float32Array,
  outPositions: Float32Array,
  outNormals: Float32Array,
  skin: SkinWeights,
  deltas: BoneDelta[],
): void {
  // Pre-flatten deltas into raw arrays — no object churn in the hot loop.
  const nBones = deltas.length;
  const qr = new Float32Array(nBones * 4);
  const qd = new Float32Array(nBones * 4);
  for (let i = 0; i < nBones; i++) {
    const dq = toDualQuat(deltas[i]);
    dq.r.toArray(qr, i * 4);
    dq.d.toArray(qd, i * 4);
  }

  const { indices, weights } = skin;
  const vertexCount = skin.vertexCount;

  for (let v = 0; v < vertexCount; v++) {
    const i4 = v * 4;
    const b0 = indices[i4];
    if (weights[i4] === 0 && weights[i4 + 1] === 0 && weights[i4 + 2] === 0 && weights[i4 + 3] === 0) {
      // No influence — leave the vertex untouched.
      outPositions[v * 3] = restPositions[v * 3];
      outPositions[v * 3 + 1] = restPositions[v * 3 + 1];
      outPositions[v * 3 + 2] = restPositions[v * 3 + 2];
      outNormals[v * 3] = restNormals[v * 3];
      outNormals[v * 3 + 1] = restNormals[v * 3 + 1];
      outNormals[v * 3 + 2] = restNormals[v * 3 + 2];
      continue;
    }

    // Hemisphere fix relative to the first influence.
    const s0 = b0 * 4;
    const r0x = qr[s0], r0y = qr[s0 + 1], r0z = qr[s0 + 2], r0w = qr[s0 + 3];

    let ax = 0, ay = 0, az = 0, aw = 0;
    let bx = 0, by = 0, bz = 0, bw = 0;

    for (let k = 0; k < 4; k++) {
      const w = weights[i4 + k];
      if (w === 0) continue;
      const b = indices[i4 + k] * 4;
      let sign = 1;
      const dot = r0x * qr[b] + r0y * qr[b + 1] + r0z * qr[b + 2] + r0w * qr[b + 3];
      if (dot < 0) sign = -1;
      const ws = w * sign;
      ax += ws * qr[b];
      ay += ws * qr[b + 1];
      az += ws * qr[b + 2];
      aw += ws * qr[b + 3];
      bx += ws * qd[b];
      by += ws * qd[b + 1];
      bz += ws * qd[b + 2];
      bw += ws * qd[b + 3];
    }

    // Normalise the real part; scale the dual part consistently.
    const norm = Math.hypot(ax, ay, az, aw);
    if (norm < 1e-8) {
      ax = 0; ay = 0; az = 0; aw = 1;
      bx = 0; by = 0; bz = 0; bw = 0;
    } else {
      const inv = 1 / norm;
      ax *= inv; ay *= inv; az *= inv; aw *= inv;
      bx *= inv; by *= inv; bz *= inv; bw *= inv;
    }

    // Translation from t = 2 · qd · conj(qr).
    // qd = (bqx, bqy, bqz, bqw), conj(qr) = (−qrx, −qry, −qrz, qrw)
    const tx = 2 * (aw * bx - ax * bw + ay * bz - az * by);
    const ty = 2 * (aw * by - ay * bw + az * bx - ax * bz);
    const tz = 2 * (aw * bz - az * bw + ax * by - ay * bx);

    // Rotate the rest position by qr (unit quaternion rotation).
    const px = restPositions[v * 3], py = restPositions[v * 3 + 1], pz = restPositions[v * 3 + 2];
    const txq = 2 * (ay * pz - az * py);
    const tyq = 2 * (az * px - ax * pz);
    const tzq = 2 * (ax * py - ay * px);
    outPositions[v * 3] = px + aw * txq + (ay * tzq - az * tyq) + tx;
    outPositions[v * 3 + 1] = py + aw * tyq + (az * txq - ax * tzq) + ty;
    outPositions[v * 3 + 2] = pz + aw * tzq + (ax * tyq - ay * txq) + tz;

    // Rotate the rest normal by the same quaternion; no translation.
    const nx = restNormals[v * 3], ny = restNormals[v * 3 + 1], nz = restNormals[v * 3 + 2];
    const tnx = 2 * (ay * nz - az * ny);
    const tny = 2 * (az * nx - ax * nz);
    const tnz = 2 * (ax * ny - ay * nx);
    let rx = nx + aw * tnx + (ay * tnz - az * tny);
    let ry = ny + aw * tny + (az * tnx - ax * tnz);
    let rz = nz + aw * tnz + (ax * tny - ay * tnx);
    const rl = Math.hypot(rx, ry, rz) || 1;
    outNormals[v * 3] = rx / rl;
    outNormals[v * 3 + 1] = ry / rl;
    outNormals[v * 3 + 2] = rz / rl;
  }
}
