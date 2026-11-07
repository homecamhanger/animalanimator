#!/usr/bin/env python3
"""
compare-poses.py — overlay the SDF pose (cyan) and the DQS-skinned pose (orange)
to eyeball re-target fidelity. Both meshes are floor-aligned (min-y → 0) and
projected with the same camera. Overlap reads brown; cyan-only = SDF bulges
beyond skinned; orange-only = skinned bulges beyond SDF.

Usage: python3 scripts/compare-poses.py <sdf.json> <skinned.json> <out.png>
         [--azimuth 90] [--elevation 8] [--size 900]
"""
import json, math, sys, argparse
from PIL import Image

def normalize(v):
    length = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / length for c in v)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('sdf')
    parser.add_argument('skinned')
    parser.add_argument('out')
    parser.add_argument('--azimuth', type=float, default=90.0)
    parser.add_argument('--elevation', type=float, default=8.0)
    parser.add_argument('--size', type=int, default=900)
    args = parser.parse_args()

    def load(path):
        data = json.load(open(path))
        tris = data['triangles']
        dy = min(min(t[k][1] for k in ('a', 'b', 'c') for t in [t_upper]) for t_upper in [tris]) if False else None
        return tris

    sdf = json.load(open(args.sdf))['triangles']
    skinned = json.load(open(args.skinned))['triangles']

    # Both dumps are grounded to the same contact target already (the skinned
    # pipeline re-applies the floorLift exactly like kitten.ts) — compare raw.

    az = math.radians(args.azimuth)
    el = math.radians(args.elevation)
    view_dir = (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))
    right = (math.cos(az), 0.0, -math.sin(az))
    up = (-math.sin(el) * math.sin(az), math.cos(el), -math.sin(el) * math.cos(az))

    light = normalize((0.45, 0.8, 0.55))

    # camera framing from the union of both meshes
    xs, ys = [], []
    for tris in (sdf, skinned):
        for tri in tris:
            for key in ('a', 'b', 'c'):
                p = tri[key]
                xs.append(sum(p[i] * right[i] for i in range(3)))
                ys.append(sum(p[i] * up[i] for i in range(3)))
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span = max(max_x - min_x, max_y - min_y) * 1.08
    cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2
    size = args.size

    def project(p):
        x = sum(p[i] * right[i] for i in range(3))
        y = sum(p[i] * up[i] for i in range(3))
        depth = sum(p[i] * view_dir[i] for i in range(3))
        sx = (x - cx) / span * size + size / 2
        sy = size / 2 - (y - cy) / span * size
        return sx, sy, depth

    def rasterize(tris, base_rgb, alpha):
        zbuffer = [float('inf')] * (size * size)
        layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        pixels = layer.load()
        face_data = []
        for tri in tris:
            a, b, c = tri['a'], tri['b'], tri['c']
            ux, uy, uz = b[0]-a[0], b[1]-a[1], b[2]-a[2]
            vx, vy, vz = c[0]-a[0], c[1]-a[1], c[2]-a[2]
            n = normalize((uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx))
            depth = sum(sum(tri[k][i] * view_dir[i] for i in range(3)) for k in ('a', 'b', 'c')) / 3
            face_data.append((tri, n, depth))
        face_data.sort(key=lambda fd: fd[2])
        for tri, n, _ in face_data:
            ndotl = n[0]*light[0] + n[1]*light[1] + n[2]*light[2]
            diffuse = min(1.0, max(0.0, (ndotl + 0.42) / 1.42))
            shade = 0.42 + 0.58 * diffuse
            rgb = tuple(min(255, int(ch * shade)) for ch in base_rgb) + (alpha,)
            pa, pb, pc = project(tri['a']), project(tri['b']), project(tri['c'])
            ax, ay = pa[0], pa[1]
            bx, by = pb[0], pb[1]
            tx_, ty_ = pc[0], pc[1]
            az_, bz_, cz_ = pa[2], pb[2], pc[2]
            min_px = max(0, int(min(ax, bx, tx_)))
            max_px = min(size - 1, int(max(ax, bx, tx_)))
            min_py = max(0, int(min(ay, by, ty_)))
            max_py = min(size - 1, int(max(ay, by, ty_)))
            if min_px > max_px or min_py > max_py:
                continue
            v0x, v0y = bx - ax, by - ay
            v1x, v1y = tx_ - ax, ty_ - ay
            denom = v0x * v1y - v1x * v0y
            if abs(denom) < 1e-9:
                continue
            inv = 1.0 / denom
            for py in range(min_py, max_py + 1):
                py_c = py + 0.5
                row = py * size
                for px in range(min_px, max_px + 1):
                    px_c = px + 0.5
                    v2x, v2y = px_c - ax, py_c - ay
                    w1 = (v2x * v1y - v1x * v2y) * inv
                    w2 = (v0x * v2y - v2x * v0y) * inv
                    w0 = 1.0 - w1 - w2
                    if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                        if w0 > 0.0 or w1 > 0.0 or w2 > 0.0:
                            continue
                        w0, w1, w2 = -w0, -w1, -w2
                    depth = w0 * az_ + w1 * bz_ + w2 * cz_
                    idx = row + px
                    if depth < zbuffer[idx]:
                        zbuffer[idx] = depth
                        pixels[px, py] = rgb
        return layer

    background = Image.new('RGB', (size, size), (24, 20, 17))
    sdf_layer = rasterize(sdf, (64, 220, 235), 255)      # cyan, opaque
    skin_layer = rasterize(skinned, (255, 132, 40), 165)  # orange, translucent
    composed = background.convert('RGBA')
    composed.alpha_composite(sdf_layer)
    composed.alpha_composite(skin_layer)
    composed.convert('RGB').save(args.out)

    # rough extent comparison
    def extent(tris):
        pts = [t[k] for t in tris for k in ('a', 'b', 'c')]
        return tuple((min(p[i] for p in pts), max(p[i] for p in pts)) for i in range(3))
    es, ek = extent(sdf), extent(skinned)
    print(f'SDF     extent: ' + '  '.join(f'{a:+.3f}..{b:+.3f}' for a, b in es))
    print(f'SKINNED extent: ' + '  '.join(f'{a:+.3f}..{b:+.3f}' for a, b in ek))
    print(f'Wrote {args.out}')

if __name__ == '__main__':
    main()
