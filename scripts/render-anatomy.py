#!/usr/bin/env python3
"""
render-anatomy.py — orthographic preview of the anatomical skeleton JSON
(scripts/dump-anatomy.ts). Painter's algorithm, round-cap bonemites.

Usage: python3 scripts/render-anatomy.py anatomy.json out.png --azimuth 90 --elevation 12
Same azimuth convention as render-preview.py: 0=rear, 90/270=side, 180=front.
"""

import argparse
import json
import math

from PIL import Image, ImageDraw

REGION_RGB = {
    'skull': (239, 230, 210),
    'spine': (226, 211, 179),
    'ribcage': (207, 195, 171),
    'forelimb': (232, 207, 168),
    'hindlimb': (224, 191, 160),
    'tail': (213, 200, 173),
}
JOINT_RGB = (122, 96, 68)
BG = (26, 22, 19, 255)

def project(p, az, el, half, center):
    ax = math.radians(az); elr = math.radians(el)
    v = (math.cos(elr) * math.sin(ax), math.sin(elr), math.cos(elr) * math.cos(ax))
    right = (math.cos(ax), 0.0, -math.sin(ax))
    up = (-math.sin(elr) * math.sin(ax), math.cos(elr), -math.sin(elr) * math.cos(ax))
    x, y, z = p
    depth = (x - center[0]) * v[0] + (y - center[1]) * v[1] + (z - center[2]) * v[2]
    sx = (x - center[0]) * right[0] + (y - center[1]) * right[1] + (z - center[2]) * right[2]
    sy = (x - center[0]) * up[0] + (y - center[1]) * up[1] + (z - center[2]) * up[2]
    return sx, sy, depth

def draw_ellipsoid(draw, a, c, minor_r, fill):
    import math as _math
    mx, my = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
    dx, dy = c[0] - a[0], c[1] - a[1]
    major = _math.hypot(dx, dy) / 2
    if major < 1e-3:
        major = minor_r
        ux, uy = 1.0, 0.0
    else:
        ux, uy = dx / (2 * major), dy / (2 * major)
    nx, ny = -uy, ux
    pts = []
    for i in range(36):
        t = 2 * _math.pi * i / 36
        ct, st = _math.cos(t), _math.sin(t)
        pts.append((mx + ux * major * ct + nx * minor_r * st,
                    my + uy * major * ct + ny * minor_r * st))
    draw.polygon(pts, fill=fill)


def quad_bezier(a, b, c, steps=14):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append((u*u*a[0] + 2*u*t*b[0] + t*t*c[0],
                    u*u*a[1] + 2*u*t*b[1] + t*t*c[1],
                    u*u*a[2] + 2*u*t*b[2] + t*t*c[2]))
    return pts

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('anatomy')
    ap.add_argument('out')
    ap.add_argument('--azimuth', type=float, default=90.0)
    ap.add_argument('--elevation', type=float, default=10.0)
    ap.add_argument('--size', type=int, default=1000)
    ap.add_argument('--joints', type=int, default=1, help='draw joint dots (default on)')
    args = ap.parse_args()

    bones = json.load(open(args.anatomy))

    # bounds for framing
    allpts = []
    for b in bones:
        allpts.append(b['from']); allpts.append(b['to'])
        if b.get('via'): allpts.append(b['via'])
    xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]; zs = [p[2] for p in allpts]
    center = ((min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2)
    half = max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)) / 2 + 0.04

    img = Image.new('RGBA', (args.size, args.size), BG)
    draw = ImageDraw.Draw(img)
    scale = args.size / (2 * half * 1.12)
    ox = args.size / 2; oy = args.size / 2

    def T(p):
        sx, sy, depth = project(p, args.azimuth, args.elevation, half, center)
        return (ox + sx * scale, oy - sy * scale, depth)

    def draw_bone(b):
        col = REGION_RGB.get(b['region'], (220, 210, 190))
        a = T(b['from']); c = T(b['to'])
        depth = (a[2] + c[2]) / 2
        if b['shape'] == 'plate':
            pts = [a, c, T(b['via'])]
            draw.polygon([(p[0], p[1]) for p in pts], fill=col + (150,), outline=(60, 50, 40, 220))
            return depth, a, c
        if b['shape'] == 'ellipsoid':
            # true silhouette: ellipse along the projected major axis, minor = radii[0]
            draw_ellipsoid(draw, a, c, b.get('radii', [0.02, 0.02, 0.02])[0] * scale, col + (255,))
            return depth, a, c
        w = max(2, int(b['girth'] * 2 * scale))
        if b.get('via'):
            pts3 = quad_bezier(b['from'], b['via'], b['to'])
            pts = [T(p)[:2] for p in pts3]
            draw.line(pts, fill=col + (255,), width=w, joint='curve')
        else:
            draw.line([(a[0], a[1]), (c[0], c[1])], fill=col + (255,), width=w)
        return depth, a, c

    order = []
    for b in bones:
        a = T(b['from']); c = T(b['to'])
        order.append(((a[2] + c[2]) / 2, b))
    order.sort(key=lambda t: t[0])  # far → near
    for _, b in order:
        draw_bone(b)

    if args.joints:
        for b in bones:
            for key in ('from', 'to'):
                p = T(b[key])
                r = max(1.5, min(3.2, b['girth'] * scale * 0.5))
                draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=JOINT_RGB + (235,))

    img.save(args.out)
    print(f"Wrote {args.out}")

if __name__ == '__main__':
    main()
