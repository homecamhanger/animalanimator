#!/usr/bin/env python3
"""
render-preview.py — rasterise the triangle dump (scripts/dump-mesh.ts) into
an orthographic preview with painter's algorithm shading. No GPU required.

Usage: python3 scripts/render-preview.py mesh.json out.png --azimuth 25 --elevation 18 [--view right|front]
"""

import argparse
import json
import math

from PIL import Image, ImageDraw


def hex_to_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mesh')
    parser.add_argument('out')
    parser.add_argument('--azimuth', type=float, default=28.0, help='degrees, 0 = side view (+z right)')
    parser.add_argument('--elevation', type=float, default=16.0, help='degrees above horizon')
    parser.add_argument('--size', type=int, default=900)
    args = parser.parse_args()

    data = json.load(open(args.mesh))
    triangles = data['triangles']

    az = math.radians(args.azimuth)
    el = math.radians(args.elevation)

    # Camera looks from direction: azimuth rotates around Y (0 → looking from +x side... we choose
    # 0 = pure side view along x axis, i.e. we see the z-y plane), positive azimuth orbits toward front (+z).
    view_dir = (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))  # from object toward camera
    # right vector on screen
    right = (math.cos(az + math.pi / 2), 0.0, -math.sin(az + math.pi / 2))
    up = (
        -math.sin(el) * math.sin(az),
        math.cos(el),
        -math.sin(el) * math.cos(az),
    )

    def project(p):
        x = sum(p[i] * right[i] for i in range(3))
        y = sum(p[i] * up[i] for i in range(3))
        depth = sum(p[i] * view_dir[i] for i in range(3))
        return x, y, depth

    # Bounds
    xs, ys = [], []
    for tri in triangles:
        for key in ('a', 'b', 'c'):
            x, y, _ = project(tri[key])
            xs.append(x)
            ys.append(y)
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span = max(max_x - min_x, max_y - min_y) * 1.12
    size = args.size
    cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2

    def to_screen(p):
        x, y, depth = project(p)
        sx = (x - cx) / span * size + size / 2
        sy = size / 2 - (y - cy) / span * size
        return sx, sy, depth

    def normalize(v):
        length = math.sqrt(sum(c * c for c in v)) or 1.0
        return tuple(c / length for c in v)

    light = normalize((0.45, 0.8, 0.55))

    # Smooth normals: weld coincident vertices, average face normals onto them,
    # then shade each face by its vertex-normal average (facet boundaries vanish).
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
        if 'colors' in tri and tri['colors']:
            # Vertex colours: average them for the face tint.
            base_rgb = tuple(
                sum(hex_to_rgb(col)[i] for col in tri['colors']) / 3 for i in range(3)
            )
        else:
            base_rgb = hex_to_rgb(tri.get('color', '#cccccc'))
        a, b, c = tri['a'], tri['b'], tri['c']
        ids = (vid(a), vid(b), vid(c))
        if 'na' in tri:
            # Real vertex normals from the builder (smooth shading).
            for key, i in (('na', ids[0]), ('nb', ids[1]), ('nc', ids[2])):
                n = tri[key]
                vertex_normals[i][0] = n[0]
                vertex_normals[i][1] = n[1]
                vertex_normals[i][2] = n[2]
            face_data.append((tri, ids, base_rgb))
            continue
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        for i in ids:
            vertex_normals[i][0] += nx
            vertex_normals[i][1] += ny
            vertex_normals[i][2] += nz
        face_data.append((tri, ids, base_rgb))
    for n in vertex_normals:
        length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
        n[0] /= length
        n[1] /= length
        n[2] /= length

    # Painter's algorithm: sort far → near
    def tri_depth(tri):
        return sum(sum(tri[key][i] * view_dir[i] for i in range(3)) for key in ('a', 'b', 'c')) / 3

    face_data.sort(key=lambda fd: tri_depth(fd[0]))

    image = Image.new('RGB', (size, size), (24, 20, 17))
    draw = ImageDraw.Draw(image)

    # floor line hint
    for tri, ids, base in face_data:
        a, b, c = tri['a'], tri['b'], tri['c']
        pa, pb, pc = to_screen(a), to_screen(b), to_screen(c)
        nx = sum(vertex_normals[i][0] for i in ids) / 3
        ny = sum(vertex_normals[i][1] for i in ids) / 3
        nz = sum(vertex_normals[i][2] for i in ids) / 3
        # wrap lighting (mimics env-lit matte fur): soft terminator, hides faceting
        ndotl = nx * light[0] + ny * light[1] + nz * light[2]
        diffuse = min(1.0, max(0.0, (ndotl + 0.42) / 1.42))
        shade = 0.42 + 0.58 * diffuse
        rgb = tuple(min(255, int(channel * shade)) for channel in base)
        draw.polygon(
            [(pa[0], pa[1]), (pb[0], pb[1]), (pc[0], pc[1])],
            fill=rgb,
            outline=rgb,
        )

    image.save(args.out)
    print(f'Wrote {args.out}')


if __name__ == '__main__':
    main()
