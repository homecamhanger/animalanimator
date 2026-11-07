#!/usr/bin/env python3
"""
render-overlay.py — x-ray composite: the furry mesh (dump-mesh.ts JSON) rendered
ghosted, with the anatomical skeleton (dump-anatomy.ts JSON) drawn on top.
Bones are always visible regardless of depth, so this is a fit check, not a
photoreal render.

Usage: python3 scripts/render-overlay.py mesh.json anatomy.json out.png --azimuth 90 --elevation 8
"""

import argparse
import json
import math

from PIL import Image, ImageDraw

REGION_RGB = {
    'skull': (243, 233, 210),
    'spine': (232, 210, 166),
    'ribcage': (208, 192, 160),
    'forelimb': (238, 208, 160),
    'hindlimb': (227, 190, 162),
    'tail': (217, 204, 178),
}
JOINT_RGB = (190, 160, 130)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mesh')
    parser.add_argument('anatomy')
    parser.add_argument('out')
    parser.add_argument('--azimuth', type=float, default=90.0)
    parser.add_argument('--elevation', type=float, default=10.0)
    parser.add_argument('--size', type=int, default=900)
    args = parser.parse_args()

    mesh = json.load(open(args.mesh))
    bones = json.load(open(args.anatomy))
    triangles = mesh['triangles']

    az = math.radians(args.azimuth)
    el = math.radians(args.elevation)
    view_dir = (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))
    right = (math.cos(az), 0.0, -math.sin(az))
    up = (-math.sin(el) * math.sin(az), math.cos(el), -math.sin(el) * math.cos(az))

    def project(p):
        x = sum(p[i] * right[i] for i in range(3))
        y = sum(p[i] * up[i] for i in range(3))
        depth = sum(p[i] * view_dir[i] for i in range(3))
        return x, y, depth

    xs, ys = [], []
    for tri in triangles:
        for key in ('a', 'b', 'c'):
            x, y, _ = project(tri[key])
            xs.append(x); ys.append(y)
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span = max(max_x - min_x, max_y - min_y) * 1.10
    size = args.size
    cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2

    def to_screen(p):
        x, y, depth = project(p)
        sx = (x - cx) / span * size + size / 2
        sy = size / 2 - (y - cy) / span * size
        return sx, sy, depth

    scale = size / span

    # ---------- ghost mesh pass ----------
    def normalize(v):
        length = math.sqrt(sum(c * c for c in v)) or 1.0
        return tuple(c / length for c in v)
    light = normalize((0.45, 0.8, 0.55))

    def hex_to_rgb(value):
        value = value.lstrip('#')
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))

    vertex_ids = {}
    vertex_normals = []

    def vid(p):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        if key not in vertex_ids:
            vertex_ids[key] = len(vertex_normals)
            vertex_normals.append([0.0, 0.0, 0.0])
        return vertex_ids[key]

    face_data = []
    for tri in triangles:
        base_rgb = hex_to_rgb(tri.get('color', '#b9a98f'))
        a, b, c = tri['a'], tri['b'], tri['c']
        ids = (vid(a), vid(b), vid(c))
        if 'na' in tri:
            for key, i in (('na', ids[0]), ('nb', ids[1]), ('nc', ids[2])):
                n = tri[key]
                vertex_normals[i][0] = n[0]; vertex_normals[i][1] = n[1]; vertex_normals[i][2] = n[2]
            face_data.append((tri, ids, base_rgb))
            continue
        ux, uy, uz = b[0]-a[0], b[1]-a[1], b[2]-a[2]
        vx, vy, vz = c[0]-a[0], c[1]-a[1], c[2]-a[2]
        nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        for i in ids:
            vertex_normals[i][0] += nx; vertex_normals[i][1] += ny; vertex_normals[i][2] += nz
        face_data.append((tri, ids, base_rgb))
    for n in vertex_normals:
        length = math.sqrt(sum(c*c for c in n)) or 1.0
        n[0] /= length; n[1] /= length; n[2] /= length

    def tri_depth(tri):
        return sum(sum(tri[key][i] * view_dir[i] for i in range(3)) for key in ('a', 'b', 'c')) / 3

    face_data.sort(key=lambda fd: tri_depth(fd[0]))

    image = Image.new('RGB', (size, size), (24, 20, 17))
    pixels = image.load()
    zbuffer = [float('inf')] * (size * size)

    for tri, ids, base in face_data:
        a, b, c = tri['a'], tri['b'], tri['c']
        pa, pb, pc = to_screen(a), to_screen(b), to_screen(c)
        nx = sum(vertex_normals[i][0] for i in ids) / 3
        ny = sum(vertex_normals[i][1] for i in ids) / 3
        nz = sum(vertex_normals[i][2] for i in ids) / 3
        ndotl = nx * light[0] + ny * light[1] + nz * light[2]
        diffuse = min(1.0, max(0.0, (ndotl + 0.42) / 1.42))
        # ghost: dim, cool-tinted — the bones get the saturation
        shade = 0.16 + 0.16 * diffuse
        rgb = tuple(min(255, int(channel * shade) + 12) for channel in base)
        ax, ay = pa[0], pa[1]; bx, by = pb[0], pb[1]; tx, ty = pc[0], pc[1]
        az_, bz_, cz_ = pa[2], pb[2], pc[2]
        min_px = max(0, int(min(ax, bx, tx))); max_px = min(size - 1, int(max(ax, bx, tx)))
        min_py = max(0, int(min(ay, by, ty))); max_py = min(size - 1, int(max(ay, by, ty)))
        if min_px > max_px or min_py > max_py: continue
        v0x, v0y = bx-ax, by-ay; v1x, v1y = tx-ax, ty-ay
        denom = v0x*v1y - v1x*v0y
        if abs(denom) < 1e-9: continue
        inv = 1.0 / denom
        for py in range(min_py, max_py + 1):
            py_c = py + 0.5
            row = py * size
            for px in range(min_px, max_px + 1):
                px_c = px + 0.5
                v2x, v2y = px_c-ax, py_c-ay
                w1 = (v2x*v1y - v1x*v2y)*inv; w2 = (v0x*v2y - v2x*v0y)*inv; w0 = 1.0-w1-w2
                if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                    if w0 > 0.0 or w1 > 0.0 or w2 > 0.0: continue
                    w0, w1, w2 = -w0, -w1, -w2
                depth = w0*az_ + w1*bz_ + w2*cz_
                idx = row + px
                if depth < zbuffer[idx]:
                    zbuffer[idx] = depth
                    pixels[px, py] = rgb

    # ---------- bones on top (x-ray) ----------
    draw = ImageDraw.Draw(image, 'RGBA')

    def draw_ellipsoid(draw, a, c, minor_r, fill):
        mx, my = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        dx, dy = c[0] - a[0], c[1] - a[1]
        major = math.hypot(dx, dy) / 2
        if major < 1e-3:
            major = minor_r
            ux, uy = 1.0, 0.0
        else:
            ux, uy = dx / (2 * major), dy / (2 * major)
        nx, ny = -uy, ux
        pts = []
        for i in range(36):
            t = 2 * math.pi * i / 36
            ct, st = math.cos(t), math.sin(t)
            pts.append((mx + ux * major * ct + nx * minor_r * st,
                        my + uy * major * ct + ny * minor_r * st))
        draw.polygon(pts, fill=fill)

    def quad(a, b, c, steps=16):
        pts = []
        for i in range(steps + 1):
            t = i / steps; u = 1 - t
            pts.append((u*u*a[0] + 2*u*t*b[0] + t*t*c[0],
                        u*u*a[1] + 2*u*t*b[1] + t*t*c[1],
                        u*u*a[2] + 2*u*t*b[2] + t*t*c[2]))
        return pts

    def depth_of(b):
        pa, pb = project(b['from']), project(b['to'])
        return (pa[2] + pb[2]) / 2

    for bone in sorted(bones, key=depth_of):
        col = REGION_RGB.get(bone['region'], (220, 210, 190)) + (235,)
        a = to_screen(bone['from']); c = to_screen(bone['to'])
        w = max(2, int(bone['girth'] * 2 * scale))
        if bone['shape'] == 'plate':
            via = to_screen(bone['via'])
            draw.polygon([(a[0], a[1]), (c[0], c[1]), (via[0], via[1])],
                         fill=tuple(col[:3]) + (150,), outline=(70, 58, 44, 220))
            continue
        if bone['shape'] == 'ellipsoid':
            minor = (bone.get('radii') or [0.02, 0.02, 0.02])[0] * scale
            draw_ellipsoid(draw, a, c, minor, col)
            continue
        if bone.get('via'):
            pts = [to_screen(p) for p in quad(bone['from'], bone['via'], bone['to'])]
            draw.line([(p[0], p[1]) for p in pts], fill=col, width=w, joint='curve')
        else:
            draw.line([(a[0], a[1]), (c[0], c[1])], fill=col, width=w)

    image.save(args.out)
    print(f'Wrote {args.out}')

if __name__ == '__main__':
    main()
