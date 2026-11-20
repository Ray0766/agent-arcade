"""Build Agent Arcade's Rainbow Cat and Sprout desk figures.

Usage: blender --background --factory-startup --disable-autoexec --python   scripts/desktop-pet-models/cat-sprout.py -- --output src/assets/pets   --render-dir /path/to/scratch
Source portraits are design references only. All surfaces are generated meshes.
"""

import argparse
from math import cos, pi, radians, sin, sqrt
from pathlib import Path
import sys

import bpy
from mathutils import Vector

TAU = 2 * pi
MESHES = []
MATERIALS = {}


def linear(rgb):
    rgb = rgb.removeprefix("#")
    channels = [int(rgb[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v < 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels)


def blend(a, b, t):
    return tuple(x * (1 - t) + y * t for x, y in zip(a, b))


def material(name, color="ffffff", *, roughness=0.48, metallic=0, vertex=False):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*linear(color), 1)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if vertex:
        tone = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        tone.layer_name = "Palette"
        mat.node_tree.links.new(tone.outputs["Color"], bsdf.inputs["Base Color"])
    MATERIALS[name] = mat
    return mat


def mesh(name, vertices, faces, mat, colors=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for poly in data.polygons:
        poly.use_smooth = smooth
    if colors is not None:
        paint = data.color_attributes.new(name="Palette", domain="POINT", type="FLOAT_COLOR")
        paint.data.foreach_set("color", [c for rgb in colors for c in (*rgb, 1)])
    MESHES.append(obj)
    return obj


def uv(name, at, scale, mat, rotation=None, detail=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=detail, ring_count=max(8, detail // 2), location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    if rotation:
        obj.rotation_euler = tuple(radians(a) for a in rotation)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    MESHES.append(obj)
    return obj


def rounded_box(name, at, scale, mat, rotation=None, bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Soft sewn edge", "BEVEL")
    modifier.width, modifier.segments = bevel, 3
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if rotation:
        obj.rotation_euler = tuple(radians(a) for a in rotation)
    obj.data.materials.append(mat)
    MESHES.append(obj)
    return obj


def catmull(values, t):
    index = min(int(t), len(values) - 2)
    r = t - index
    a, b, c, d = (values[min(max(index + i, 0), len(values) - 1)] for i in (-1, 0, 1, 2))
    return (2 * b + (-a + c) * r + (2 * a - 5 * b + 4 * c - d) * r ** 2 +
            (-a + 3 * b - 3 * c + d) * r ** 3) * 0.5


def sweep(name, points, mat, colors=None, front=(0, -1, 0), cuts=4, sides=10):
    """Elliptical tube with independent width and depth, tinted at its tips."""
    center = [Vector(row[:3]) for row in points]
    width, depth = [row[3] for row in points], [row[4] for row in points]
    front = Vector(front)
    length = (len(points) - 1) * cuts
    verts, faces, paint = [], [], []
    for i in range(length + 1):
        t = i / cuts
        p = catmull(center, t)
        tangent = (catmull(center, min(t + 0.001, len(points) - 1)) -
                   catmull(center, max(0, t - 0.001))).normalized()
        axis = front.cross(tangent)
        if axis.length_squared < 0.0001:
            axis = Vector((1, 0, 0)).cross(tangent)
        axis.normalize()
        cross = tangent.cross(axis).normalized()
        a, b = max(0.003, catmull(width, t)), max(0.003, catmull(depth, t))
        for j in range(sides):
            angle = TAU * j / sides
            verts.append(p + a * cos(angle) * axis + b * sin(angle) * cross)
            if colors:
                start, end = colors
                fade = min(1, max(0, (i / length - 0.22) / 0.78)) ** 1.25
                tint = blend(start, end, fade)
                paint.append(blend(tint, (0.95, 0.95, 0.95), 0.17 * max(0, sin(angle)) ** 5))
            if i < length:
                nxt = (j + 1) % sides
                faces.append((i * sides + j, i * sides + nxt, (i + 1) * sides + nxt, (i + 1) * sides + j))
    faces.extend((tuple(reversed(range(sides))), tuple(range(length * sides, (length + 1) * sides))))
    return mesh(name, verts, faces, mat, paint or None)


def line(name, points, radius, mat, cuts=3):
    return sweep(name, [(*point, radius, radius) for point in points], mat, cuts=cuts, sides=7)


def rings(name, profile, mat, sides=48, art=None):
    vertices, faces = [], []
    for z, rx, ry, y in profile:
        for j in range(sides):
            theta = TAU * j / sides
            shape = 1 if art is None else art(theta)
            vertices.append((rx * cos(theta) * shape, y + ry * sin(theta) * shape, z))
    for i in range(len(profile) - 1):
        for j in range(sides):
            nxt = (j + 1) % sides
            faces.append((i * sides + j, i * sides + nxt, (i + 1) * sides + nxt, (i + 1) * sides + j))
    faces.extend((tuple(reversed(range(sides))), tuple(range((len(profile) - 1) * sides, len(profile) * sides))))
    return mesh(name, vertices, faces, mat)


def hem(name, z, rx, ry, mat, *, amplitude=0.018, waves=16):
    points = []
    for j in range(97):
        theta = TAU * j / 96
        points.append((rx * cos(theta), ry * sin(theta), z + amplitude * cos(waves * theta)))
    return line(name, points, 0.009, mat, cuts=1)


def brooch(name, contour, center, depth, mat, bevel=0.006):
    """Give ornaments front/back faces, thickness, and chamfered edges."""
    xx, yy, zz = center
    verts = [(xx + x, yy - y, zz + z) for y in (0, depth) for x, z in contour]
    n = len(contour)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    obj = mesh(name, verts, faces, mat, smooth=False)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Chamfer", "BEVEL")
    modifier.width, modifier.segments = bevel, 2
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def star(cx, cy, cz, radius, metal, jewel, angle=0):
    contour = [(cos(radians(angle) + pi / 2 + i * pi / 5) * radius * (1 if i % 2 == 0 else 0.49),
                sin(radians(angle) + pi / 2 + i * pi / 5) * radius * (1 if i % 2 == 0 else 0.49)) for i in range(10)]
    brooch("Pierced gold star frame", contour, (cx, cy, cz), 0.028, metal)
    brooch("Inset star glass", [(x * 0.73, z * 0.73) for x, z in contour],
           (cx, cy - 0.024, cz), 0.014, jewel, 0.003)


def leaf(name, p, q, radius, mat, vein=None):
    a, b = Vector(p), Vector(q)
    knots = []
    for t, w in ((0, 0.10), (0.23, 0.63), (0.48, 1), (0.74, 0.73), (1, 0.03)):
        pos = a.lerp(b, t) + Vector((0, -0.035 * sin(t * pi), 0))
        knots.append((*pos, radius * w, 0.020 * w))
    sweep(name, knots, mat)
    if vein:
        line(name + " vein", [tuple(Vector(knot[:3]) + Vector((0, -0.020, 0))) for knot in knots[:4]], 0.004, vein)


HEAD_PROFILE = [
    (1.338, 0.037, 0.090, -0.077),
    (1.355, 0.125, 0.137, -0.082),
    (1.399, 0.227, 0.216, -0.071),
    (1.472, 0.325, 0.259, -0.016),
    (1.551, 0.429, 0.310, 0.002),
    (1.654, 0.467, 0.339, 0.018),
    (1.775, 0.468, 0.343, 0.024),
    (1.894, 0.456, 0.336, 0.031),
    (2.009, 0.424, 0.316, 0.044),
    (2.107, 0.354, 0.265, 0.054),
    (2.197, 0.244, 0.180, 0.052),
    (2.239, 0.016, 0.025, 0.051),
]


def head_profile():
    rows = []
    for i in range(len(HEAD_PROFILE) - 1):
        for j in range(4):
            t = i + j / 4
            depth = tuple(max(0.003, catmull([row[k] for row in HEAD_PROFILE], t))
                          if k in (1, 2) else catmull([row[k] for row in HEAD_PROFILE], t)
                          for k in range(4))
            rows.append(depth)
    return rows + [HEAD_PROFILE[-1]]


SKIN_RINGS = head_profile()


def projected_y(x, z):
    for row, nxt in zip(SKIN_RINGS, SKIN_RINGS[1:]):
        if row[0] <= z <= nxt[0]:
            t = (z - row[0]) / (nxt[0] - row[0])
            _, width, depth, y = blend(row, nxt, t)
            return y - depth * sqrt(max(0.01, 1 - (x / width) ** 2))
    return -0.28


def face_line(name, coordinates, radius, mat, offset=0.018):
    line(name, [(x, projected_y(x, z) - offset, z) for x, z in coordinates], radius, mat)


def face_patch(name, center, outline, mat, offset, colors=None):
    """Curved layer projected onto the real cheek/forehead surface."""
    cx, cz = center
    vertices, faces, paint = [(cx, projected_y(cx, cz) - offset, cz)], [], []
    if colors:
        paint.append(colors(0, 0))
    bands = 3
    count = len(outline)
    for k in range(1, bands + 1):
        f = k / bands
        for j, (x, z) in enumerate(outline):
            x, z = blend((cx, cz), (x, z), f)
            vertices.append((x, projected_y(x, z) - offset + 0.008 * f, z))
            if colors:
                paint.append(colors(f, j))
            current = (k - 1) * count + 1 + j
            following = (k - 1) * count + 1 + (j + 1) % count
            faces.append((0, current, following) if k == 1 else
                         (current - count, current, following, following - count))
    mesh(name, vertices, faces, mat, paint or None)


def ellipse(cx, cz, rx, rz, steps=28, slant=0):
    return [(cx + rx * cos(TAU * i / steps), cz + rz * sin(TAU * i / steps) + slant * cos(TAU * i / steps))
            for i in range(steps)]


def head(skin, rosy, brow, iris_pair, *, grin):
    rings("Soft tapered cheeks and jaw", SKIN_RINGS, skin)
    uv("Neck", (0, 0.018, 1.302), (0.147, 0.117, 0.177), skin)
    for s in (-1, 1):
        uv("Ear", (s * 0.437, 0.004, 1.665), (0.088, 0.067, 0.132), skin, rotation=(0, s * 8, 0))
        uv("Inner ear", (s * 0.473, -0.047, 1.669), (0.034, 0.025, 0.079), rosy)
    lash = material("Espresso lashes", "352331", roughness=0.55)
    cream = material("Eye porcelain", "fff4ed", roughness=0.28)
    gloss = material("Eye glints", "ffffff", roughness=0.24)
    iris_mat = material("Iris pigment", vertex=True, roughness=0.31)
    blush = material("Cheek tint", vertex=True, roughness=0.67)
    for side, (bright, dark) in zip((-1, 1), iris_pair):
        x = side * 0.204
        z = 1.764 + 0.013 * side
        outline = ellipse(x, z, 0.142, 0.090, 40, slant=0.024 * side)
        face_patch("Curved eye white", (x, z), outline, cream, 0.018)
        pupil = (x - side * 0.012, z - 0.001)
        lens = ellipse(*pupil, 0.081, 0.085, 40)
        def tint(fraction, angle):
            g = (1 - sin(TAU * angle / 40)) * 0.5
            return blend(linear(dark), linear(bright), min(1, (0.25 + 0.74 * g) * (1 - 0.35 * fraction)))
        face_patch("Colored iris", pupil, lens, iris_mat, 0.026, tint)
        face_patch("Dark pupil", (pupil[0], pupil[1] + 0.021),
                   ellipse(pupil[0], pupil[1] + 0.021, 0.031, 0.050), lash, 0.031)
        for dx, dz, size in ((-0.030, 0.041, 0.017), (0.028, -0.037, 0.010)):
            center = (pupil[0] + dx, pupil[1] + dz)
            face_patch("Iris highlight", center, ellipse(*center, size, size * 0.87, 16), gloss, 0.045)
        face_line("Bold upper eyelid", outline[:21], 0.014, lash, offset=0.022)
        face_line("Warm lower eye contour", outline[22:39], 0.006, rosy, offset=0.014)
        outer = x + side * 0.128
        for dy, dx in ((0.015, 0.047), (0.044, 0.030)):
            face_line("Tapered lash flick", [(outer - side * 0.018, z + dy),
                      (outer + side * 0.009, z + dy + 0.004), (outer + side * dx, z + dy + 0.027)],
                      0.008, lash, offset=0.021)
        face_line("Soft lifted brow", [(x - 0.109, z + 0.131), (x - 0.035, z + 0.154),
                  (x + 0.038, z + 0.157), (x + 0.097, z + 0.134)], 0.010, brow, offset=0.013)
        bx, bz = side * 0.292, 1.612 + side * 0.008
        face_patch("Warm cheek", (bx, bz), ellipse(bx, bz, 0.105, 0.047, 32, 0.007 * side), blush, 0.011,
                   lambda f, _: blend(linear("ea9aa4"), tuple(skin.diffuse_color[:3]), min(1, 0.20 + f ** 1.45 * 0.80)))
    uv("Small nose", (0, -0.317, 1.646), (0.046, 0.035, 0.044), skin)
    face_patch("Nose tip", (-0.018, 1.664), ellipse(-0.018, 1.664, 0.017, 0.013), gloss, 0.043)
    if grin:
        cx, cz = 0.007, 1.529
        mouth = [(-0.106, 1.566), (-0.047, 1.576), (0.017, 1.575), (0.127, 1.595),
                 (0.112, 1.543), (0.081, 1.493), (0.045, 1.463), (0.008, 1.459), (-0.043, 1.478), (-0.083, 1.515)]
        face_patch("Open laughing mouth", (cx, cz), list(reversed(mouth)), material("Mouth shadow", "683144"), 0.015)
        face_patch("Tongue", (0.025, 1.491),
                   ellipse(0.025, 1.491, 0.060, 0.026, 20), material("Tongue coral", "ed9290"), 0.025)
        face_line("Upper smile highlight", [(-0.081, 1.565), (-0.040, 1.574), (0.008, 1.571), (0.052, 1.575)],
                  0.009, cream, 0.027)
    else:
        face_line("Quiet smile", [(-0.094, 1.525), (-0.045, 1.508), (0.017, 1.506),
                                   (0.072, 1.522), (0.106, 1.545)], 0.008, material("Smile contour", "a45d56"))
        face_line("Lower lip", [(-0.039, 1.492), (0.008, 1.486), (0.044, 1.498)], 0.007, rosy)


def hair_cap(name, mat, shades, *, cat=False):
    vertices, colors, faces = [], [], []
    segments, layers = 56, 18
    sizes = (0.578, 0.410, 0.567) if cat else (0.548, 0.387, 0.536)
    for i in range(layers + 1):
        for j in range(segments):
            t, angle = i / layers, j / segments * TAU
            limit = radians(54 + 82 * ((1 - cos(angle)) * 0.5) ** 0.63 + (5 if not cat else 10) * sin(3 * angle) ** 2)
            phi = 0.004 + (limit - 0.004) * t
            ripple = 1 + 0.018 * cos(14 * angle)
            vertices.append((sizes[0] * ripple * sin(phi) * sin(angle),
                             0.095 - sizes[1] * ripple * sin(phi) * cos(angle),
                             1.808 + sizes[2] * cos(phi)))
            colors.append(blend(linear(shades[0]), linear(shades[1]), 0.64 * t))
            if i < layers:
                n = (j + 1) % segments
                faces.append((i * segments + n, i * segments + j, (i + 1) * segments + j, (i + 1) * segments + n))
    return mesh(name, vertices, faces, mat, colors)


def locks(rows, mat):
    for name, palette, points in rows:
        sweep(name, points, mat, colors=tuple(linear(s) for s in palette), cuts=5, sides=12)


def ribbon(name, x, y, z, primary, secondary, spread, metal=None, gemstone=None):
    for s in (-1, 1):
        sweep(name + " bowed loop", [(x, y, z, 0.028, 0.020),
              (x + s * spread * 0.55, y - 0.022, z + spread * 0.34, spread * 0.28, 0.029),
              (x + s * spread, y + 0.012, z + spread * 0.14, spread * 0.20, 0.028),
              (x + s * spread * 0.67, y + 0.006, z - spread * 0.11, 0.035, 0.020)],
              primary if s > 0 else secondary)
        sweep(name + " ribbon tail", [(x, y + 0.013, z, 0.035, 0.016),
              (x + s * spread * 0.42, y - 0.005, z - spread * 0.59, spread * 0.27, 0.018),
              (x + s * spread * 0.68, y + 0.017, z - spread * 1.25, spread * 0.15, 0.012),
              (x + s * spread * 0.82, y + 0.034, z - spread * 1.48, 0.008, 0.008)],
              secondary if s > 0 else primary)
    if metal:
        star(x, y - 0.031, z, spread * 0.40, metal, gemstone)
    else:
        uv(name + " clasp", (x, y - 0.031, z), (0.036, 0.029, 0.034), primary)


def cat_ears(fur, rose, tuft):
    for s in (-1, 1):
        sweep("Cat ear pinna", [
            (s * 0.35, 0.016, 2.105, 0.225, 0.130),
            (s * 0.441, -0.003, 2.309, 0.195, 0.108),
            (s * 0.508, -0.044, 2.474, 0.106, 0.065),
            (s * 0.594, -0.039, 2.650, 0.003, 0.003),
        ], fur, cuts=6)
        sweep("Petal pink inner pinna", [
            (s * 0.384, -0.098, 2.157, 0.125, 0.029),
            (s * 0.449, -0.113, 2.310, 0.127, 0.028),
            (s * 0.520, -0.117, 2.474, 0.066, 0.024),
            (s * 0.585, -0.055, 2.619, 0.005, 0.009),
        ], rose)
        for j in range(4):
            p = (s * (0.394 + 0.038 * j), -0.127, 2.193 + j * 0.034)
            sweep("Silky inner ear tuft", [(*p, 0.043, 0.027),
                  (s * (0.422 + 0.044 * j), -0.155, 2.263 + j * 0.038, 0.043, 0.016),
                  (s * (0.367 + 0.054 * j), -0.147, 2.313 + j * 0.039, 0.006, 0.005)], tuft)


def cat_hair(hair, gold, glass, pink, mint):
    hair_cap("Lavender crown with raised side sections", hair, ("e4bcf4", "9765bb"), cat=True)
    locks([
        ("Central forelock", ("efd0f7", "ba90db"), [
            (-0.028, -0.160, 2.314, 0.068, 0.042), (0.062, -0.269, 2.199, 0.125, 0.066),
            (0.032, -0.361, 2.030, 0.109, 0.057), (-0.026, -0.400, 1.895, 0.066, 0.038),
            (0.005, -0.377, 1.867, 0.004, 0.004)]),
        ("Parted sweeping fringe", ("e9c4f6", "c096e4"), [
            (0.012, -0.163, 2.321, 0.048, 0.045), (-0.175, -0.282, 2.222, 0.112, 0.053),
            (-0.259, -0.377, 2.043, 0.119, 0.049), (-0.311, -0.335, 1.887, 0.056, 0.027),
            (-0.361, -0.255, 1.842, 0.004, 0.004)]),
        ("Fringe under the star", ("d9b1ec", "ad7ece"), [
            (0.069, -0.168, 2.299, 0.047, 0.040), (0.252, -0.239, 2.202, 0.126, 0.066),
            (0.341, -0.299, 2.026, 0.104, 0.060), (0.370, -0.287, 1.863, 0.069, 0.043),
            (0.338, -0.285, 1.749, 0.004, 0.004)]),
        ("Curled flyaway over crown", ("e7bbfb", "c99ae8"), [
            (0.023, -0.092, 2.293, 0.044, 0.037), (0.145, -0.091, 2.450, 0.032, 0.025),
            (0.101, -0.086, 2.547, 0.024, 0.019), (-0.031, -0.071, 2.551, 0.021, 0.015),
            (-0.121, -0.055, 2.485, 0.016, 0.012), (-0.083, -0.047, 2.446, 0.004, 0.004)]),
    ], hair)
    for s in (-1, 1):
        locks([
            ("Cheek framing curl", ("e2b6f0", "bb92da"), [
                (s * 0.375, -0.178, 2.152, 0.082, 0.045), (s * 0.485, -0.236, 1.902, 0.100, 0.060),
                (s * 0.442, -0.268, 1.656, 0.083, 0.045), (s * 0.325, -0.299, 1.562, 0.054, 0.028),
                (s * 0.250, -0.287, 1.596, 0.005, 0.005)]),
            ("Long milk violet coil", ("a470c7", "92cdf1"), [
                (s * 0.490, 0.079, 1.969, 0.136, 0.080), (s * 0.509, -0.033, 1.630, 0.111, 0.084),
                (s * 0.425, -0.152, 1.335, 0.120, 0.072), (s * 0.487, -0.212, 1.123, 0.082, 0.041),
                (s * 0.609, -0.155, 1.169, 0.043, 0.025), (s * 0.629, -0.098, 1.264, 0.004, 0.003)]),
            ("Rainbow shoulder ribbon lock", ("c694e1", "eda6d6"), [
                (s * 0.522, 0.154, 1.834, 0.111, 0.075), (s * 0.605, 0.078, 1.520, 0.086, 0.060),
                (s * 0.698, 0.020, 1.345, 0.081, 0.047), (s * 0.688, 0.065, 1.207, 0.053, 0.029),
                (s * 0.558, 0.126, 1.235, 0.007, 0.006)]),
            ("Sea glass long wave", ("b28ad1", "a5e6d4"), [
                (s * 0.463, 0.299, 1.710, 0.153, 0.111), (s * 0.508, 0.220, 1.450, 0.145, 0.098),
                (s * 0.642, 0.160, 1.204, 0.126, 0.058), (s * 0.615, 0.201, 1.089, 0.084, 0.046),
                (s * 0.448, 0.257, 1.084, 0.009, 0.006)]),
        ], hair)
        for j, color in enumerate(("9bcde8", "f6b6d8", "b9e6cd")):
            x = s * (0.13 + 0.13 * j)
            locks([("Layered cascade down the back", ("b489d6", color), [
                (x * 0.83, 0.234 + 0.014 * j, 2.200 - 0.106 * j, 0.035, 0.026),
                (x * 1.16, 0.467 - j * 0.01, 1.840, 0.129, 0.086),
                (x * 1.13, 0.486 - j * 0.02, 1.521, 0.131, 0.092),
                (x * 1.29 + s * 0.04, 0.404 - j * 0.045, 1.160 + j * 0.03, 0.096, 0.058),
                (x * 1.52 + s * 0.06, 0.341 - j * 0.041, 1.050 + j * 0.06, 0.005, 0.005),
            ])], hair)
    for j in range(7):
        uv("Crossed braid links", (-0.515 + 0.018 * (-1) ** j, -0.123 + j * 0.017, 1.999 - j * 0.065),
           (0.074, 0.057, 0.072), material("Braid violet", "b787d7"), rotation=(0, (-1) ** j * 35, 0))
    ribbon("Mint braid bow", -0.524, -0.098, 1.579, mint, mint, 0.104)
    ribbon("Pink and mint temple ribbons", 0.492, -0.288, 2.008, pink, mint, 0.143)
    star(0.452, -0.373, 2.039, 0.129, gold, glass, 14)
    for j in range(6):
        a = j / 5
        uv("Fine chain bead", (0.391 + a * 0.084, -0.387, 1.973 - 0.088 * sin(pi * a)),
           (0.011, 0.009, 0.011), gold, detail=10)
    brooch("Gold temple drop", [(0, 0.047), (-0.024, 0), (0, -0.048), (0.022, 0)],
           (0.476, -0.389, 1.871), 0.014, gold, 0.003)


def cat():
    skin = material("Apricot porcelain", "ffcfb7", roughness=0.61)
    rose = material("Pink inner velour", "ec9eb6")
    fur = material("Lilac outer ears", "d9a9eb")
    cream = material("Scalloped ivory", "fff3f8")
    lavender = material("Lavender dress", "ad87d3")
    shadow = material("Folded lavender satin", "8864af")
    gold = material("Polished warm brass", "e7ac54", metallic=0.47, roughness=0.30)
    glass = material("Star cut aurora glass", "b5d6f6", metallic=0.14, roughness=0.27)
    pink = material("Blush ribbon satin", "ef99c1", roughness=0.43)
    mint = material("Mint ribbon satin", "a4decc", roughness=0.42)
    hair = material("Painted lavender and rainbow fibers", vertex=True, roughness=0.41)
    head(skin, rose, material("Lavender brows", "8962a1"), [
        ("f37eb6", "8b2559"), ("f1ae39", "834811")
    ], grin=True)
    cat_ears(fur, rose, cream)
    cat_hair(hair, gold, glass, pink, mint)
    rings("Structured princess bodice", [
        (0.627, 0.249, 0.177, 0), (0.700, 0.257, 0.181, 0), (0.853, 0.200, 0.151, 0),
        (0.989, 0.252, 0.181, 0), (1.115, 0.291, 0.178, 0.013), (1.20, 0.261, 0.142, 0.016),
        (1.286, 0.137, 0.111, 0.016),
    ], lavender)
    def pleat(angle):
        return 1 + 0.067 * cos(16 * angle)
    rings("Pleated flared skirt", [
        (0.422, 0.376, 0.269, 0), (0.457, 0.374, 0.270, 0), (0.548, 0.343, 0.243, 0),
        (0.661, 0.283, 0.197, 0), (0.813, 0.221, 0.163, 0),
    ], shadow, sides=96, art=pleat)
    rings("Sculpted pale petticoat", [
        (0.385, 0.355, 0.256, 0), (0.418, 0.375, 0.268, 0), (0.472, 0.360, 0.252, 0),
    ], cream, sides=96, art=pleat)
    for j in range(16):
        t = TAU * j / 16
        points = [(cos(t)*rx, sin(t)*ry, z) for z, rx, ry in [(0.438, 0.403, 0.29), (0.550, 0.365, 0.259), (0.714, 0.284, 0.211)]]
        line("Skirt seam braid", points, 0.008, lavender)
    hem("Petticoat piping", 0.411, 0.376, 0.273, gold)
    rings("Standing ivory collar", [
        (1.171, 0.162, 0.137, 0.013), (1.217, 0.159, 0.130, 0.008),
        (1.286, 0.154, 0.120, 0.006), (1.306, 0.155, 0.124, 0.006),
    ], cream)
    hem("Scalloped neck stitching", 1.302, 0.157, 0.128, gold, amplitude=0.009, waves=12)
    for s in (-1, 1):
        sweep("Wide triangular sailor cape", [
            (s * 0.037, -0.148, 1.142, 0.054, 0.037), (s * 0.159, -0.188, 1.138, 0.080, 0.038),
            (s * 0.275, -0.144, 1.123, 0.111, 0.048), (s * 0.372, -0.045, 1.109, 0.094, 0.034),
            (s * 0.317, 0.090, 1.173, 0.054, 0.029), (s * 0.225, 0.157, 1.199, 0.018, 0.017),
        ], cream, cuts=5)
        line("Gold cape edge braid", [
            (s * 0.051, -0.176, 1.094), (s * 0.144, -0.217, 1.070),
            (s * 0.255, -0.176, 1.042), (s * 0.337, -0.083, 1.028),
        ], 0.008, gold)
        uv("Puff short sleeve", (s * 0.290, 0.005, 1.030), (0.136, 0.139, 0.141), cream, rotation=(0, -s*28, 0))
        sweep("Arm in lavender glove", [
            (s * 0.311, -0.007, 1.000, 0.073, 0.066), (s * 0.354, -0.020, 0.851, 0.058, 0.058),
            (s * 0.342, -0.119, 0.743, 0.047, 0.045),
        ], lavender)
        uv("Hand", (s * 0.344, -0.128, 0.702), (0.056, 0.050, 0.076), skin)
        uv("Wrist scallop", (s * 0.343, -0.097, 0.760), (0.059, 0.053, 0.034), cream)
        uv("Thigh in tights", (s * 0.141, 0.021, 0.362), (0.108, 0.105, 0.192), cream)
        uv("Pale violet ankle stocking", (s * 0.148, 0.018, 0.222), (0.085, 0.084, 0.123), lavender)
        rounded_box("Ivory Mary Jane sole", (s*0.150, -0.072, 0.042), (0.190, 0.293, 0.084), cream, bevel=0.037)
        uv("Violet Mary Jane", (s*0.150, -0.078, 0.087), (0.098, 0.147, 0.068), shadow)
        rounded_box("Decorated ankle band", (s*0.151, -0.070, 0.140), (0.174, 0.061, 0.033), lavender, bevel=0.011)
        uv("Shoe clasp", (s*0.182, -0.114, 0.148), (0.015, 0.013, 0.015), gold)
    ribbon("Collar bow", 0, -0.222, 1.118, pink, mint, 0.212, gold, glass)
    for z in (0.846, 0.934, 1.009):
        uv("Engraved waist button", (0, -0.190, z), (0.021, 0.015, 0.022), gold, detail=12)
    locks([("Soft rainbow tail", ("b996d6", "ace4ce"), [
        (0.042, 0.167, 0.617, 0.075, 0.071), (0.268, 0.287, 0.541, 0.106, 0.101),
        (0.445, 0.486, 0.654, 0.116, 0.103), (0.590, 0.494, 0.901, 0.119, 0.107),
        (0.596, 0.425, 1.099, 0.133, 0.104), (0.670, 0.324, 1.227, 0.093, 0.065),
        (0.775, 0.241, 1.243, 0.014, 0.009),
    ])], hair)


def sprout_hair(hair, amber):
    hair_cap("Sage rounded bob cap", hair, ("c6d5a9", "748a67"))
    locks([
        ("Central swept bang with soft bevel", ("d5dfb6", "98af8c"), [
            (0.093, -0.121, 2.327, 0.061, 0.062), (0.025, -0.247, 2.230, 0.101, 0.062),
            (-0.001, -0.354, 2.077, 0.102, 0.065), (-0.086, -0.371, 1.913, 0.078, 0.043),
            (-0.178, -0.357, 1.826, 0.028, 0.021), (-0.228, -0.324, 1.807, 0.003, 0.003)]),
        ("Left shell layer folding across temple", ("c6d7ac", "8da982"), [
            (0.088, -0.109, 2.328, 0.048, 0.043), (-0.130, -0.184, 2.296, 0.097, 0.070),
            (-0.305, -0.281, 2.182, 0.141, 0.062), (-0.423, -0.280, 1.985, 0.107, 0.056),
            (-0.470, -0.220, 1.808, 0.055, 0.038), (-0.559, -0.129, 1.757, 0.005, 0.004)]),
        ("Face framing left curl", ("b6cbab", "78936d"), [
            (-0.363, -0.205, 2.080, 0.096, 0.064), (-0.464, -0.216, 1.869, 0.104, 0.063),
            (-0.430, -0.252, 1.649, 0.093, 0.054), (-0.339, -0.272, 1.552, 0.044, 0.026),
            (-0.262, -0.264, 1.593, 0.004, 0.005)]),
        ("Right curved sweep under the sprout clip", ("b5c8a2", "9bb290"), [
            (0.120, -0.102, 2.323, 0.072, 0.050), (0.303, -0.173, 2.251, 0.134, 0.064),
            (0.404, -0.260, 2.087, 0.127, 0.056), (0.436, -0.239, 1.915, 0.077, 0.053),
            (0.493, -0.188, 1.846, 0.010, 0.009)]),
        ("Thin right cheek tendril", ("afc49f", "819e7c"), [
            (0.421, -0.171, 1.953, 0.059, 0.042), (0.419, -0.228, 1.832, 0.056, 0.040),
            (0.401, -0.243, 1.662, 0.042, 0.035), (0.343, -0.258, 1.536, 0.027, 0.021),
            (0.281, -0.247, 1.510, 0.004, 0.004)]),
    ], hair)
    for s in (-1, 1):
        for j in range(4):
            y = 0.48 - j * 0.104
            x = s * (0.12 + j * 0.114)
            locks([("Distinct feathered bob layers", ("a6bb95", "789274"), [
                (x * 0.56, y * 0.54, 2.239 - j * 0.037, 0.034, 0.025),
                (x, y, 1.932, 0.127, 0.087),
                (x * 1.06 + s * 0.015, y + 0.028, 1.698, 0.108, 0.077),
                (x * 0.99, y, 1.483 - j * 0.016, 0.071, 0.052),
                (x * 0.80 - s * 0.026, y - 0.095, 1.432 - j * 0.019, 0.005, 0.004),
            ])], hair)
    foliage = material("Chartreuse sprout clip", "b4cd5b", roughness=0.40)
    vein = material("Leaf veins", "9eb046")
    rounded_box("Amber metal barrette", (0.322, -0.328, 2.103), (0.171, 0.036, 0.039),
                amber, rotation=(0, -19, 0), bevel=0.012)
    line("Green barrette stalk", [(0.342, -0.352, 2.110), (0.331, -0.359, 2.156), (0.315, -0.368, 2.202)],
         0.014, foliage)
    leaf("Left clip leaf", (0.322, -0.362, 2.166), (0.182, -0.314, 2.220), 0.056, foliage, vein)
    leaf("Right clip leaf", (0.327, -0.363, 2.168), (0.412, -0.309, 2.302), 0.055, foliage, vein)


def sprout():
    skin = material("Warm peach porcelain", "f8cbaa", roughness=0.64)
    rose = material("Warm peach shadow", "d98b80")
    amber = material("Brushed honey hardware", "edb74f", metallic=0.36, roughness=0.32)
    wool = material("Dark olive wool", "555a3a")
    olive = material("Olive structural twill", "707656")
    sage = material("Lighter moss trim", "84946b")
    ivory = material("Ivory workwear canvas", "e7dcc4", roughness=0.70)
    lining = material("Warm amber lining", "ddb360")
    umber = material("Tread vulcanized rubber", "494b37")
    stitches = material("Shaded ivory seams", "b8ae95")
    hair = material("Painted mint green strands", vertex=True, roughness=0.48)
    head(skin, rose, material("Sage brows", "7c8868"), [
        ("e4a741", "79521c"), ("edb143", "80511b")
    ], grin=False)
    sprout_hair(hair, amber)
    rings("Utility jacket tailored body", [
        (0.611, 0.294, 0.179, 0.016), (0.657, 0.310, 0.184, 0.008),
        (0.826, 0.279, 0.173, 0.007), (0.985, 0.287, 0.193, 0.012),
        (1.140, 0.334, 0.172, 0.020), (1.207, 0.287, 0.156, 0.018),
        (1.266, 0.143, 0.133, 0.014),
    ], ivory)
    rings("Olive wool mock-neck", [
        (1.151, 0.153, 0.151, -0.014), (1.201, 0.158, 0.146, -0.012),
        (1.281, 0.163, 0.134, 0.005), (1.345, 0.161, 0.121, 0.011),
    ], wool)
    for j in range(24):
        a = TAU * j / 24
        points = [(cos(a) * rx, y + sin(a) * ry, z) for z, rx, ry, y in [
          (1.207, 0.158, 0.148, -0.012), (1.284, 0.165, 0.137, 0.004), (1.340, 0.164, 0.123, 0.011)]]
        line("Knitted rib", points, 0.0055, olive)
    brooch("Exposed knit beneath diagonal jacket opening", [
        (-0.045, 0.183), (0.132, 0.151), (0.092, -0.153), (0.054, -0.263), (-0.085, 0.022)
    ], (0, -0.151, 1.016), 0.052, wool, bevel=0.008)
    for s in (-1, 1):
        sweep("Thick flared stand collar", [
             (s * 0.054, -0.184, 1.041, 0.029, 0.020),
             (s * 0.118, -0.173, 1.179, 0.056, 0.032),
             (s * 0.230, -0.124, 1.249, 0.065, 0.044), (s * 0.239, 0.021, 1.287, 0.076, 0.030),
             (s * 0.182, 0.145, 1.267, 0.054, 0.025), (s * 0.021, 0.173, 1.263, 0.040, 0.017),
        ], lining, cuts=5)
        line("Ivory collar stitched edge", [
             (s * 0.057, -0.196, 1.060), (s * 0.128, -0.203, 1.218),
             (s * 0.241, -0.131, 1.304), (s * 0.252, 0.022, 1.343), (s * 0.163, 0.157, 1.300),
        ], 0.018, ivory)
        uv("Padded shoulder", (s * 0.311, 0.009, 1.112), (0.136, 0.143, 0.148), olive,
           rotation=(0, -s * 25, 0))
        sweep("Utility jacket sleeve", [
            (s * 0.319, 0.006, 1.091, 0.112, 0.102), (s * 0.376, 0.000, 0.982, 0.103, 0.101),
            (s * 0.397, -0.045, 0.825, 0.079, 0.079), (s * 0.376, -0.088, 0.716, 0.066, 0.061),
        ], ivory, cuts=5)
        uv("Olive cuffs", (s * 0.376, -0.085, 0.714), (0.068, 0.063, 0.038), olive)
        uv("Resting hands", (s * 0.372, -0.098, 0.661), (0.057, 0.049, 0.079), skin)
        rounded_box("Amber cuff stud", (s * 0.389, -0.143, 0.720), (0.025, 0.024, 0.032), amber, bevel=0.006)
        sweep("Olive side inserts", [
            (s * 0.285, -0.015, 1.175, 0.083, 0.034), (s * 0.297, -0.100, 1.093, 0.049, 0.027),
            (s * 0.267, -0.141, 0.752, 0.033, 0.024), (s * 0.263, -0.123, 0.623, 0.034, 0.017),
        ], olive)
        line("Golden shoulder strap detail", [
            (s * 0.328, -0.110, 1.141), (s * 0.338, -0.034, 1.236), (s * 0.337, 0.085, 1.218)], 0.020, amber)
        sweep("Tapered moss work pants", [
            (s * 0.142, 0.006, 0.668, 0.126, 0.132), (s * 0.160, 0.014, 0.507, 0.118, 0.109),
            (s * 0.165, 0.018, 0.322, 0.090, 0.095), (s * 0.177, 0.022, 0.172, 0.079, 0.083),
        ], olive)
        rounded_box("Thigh utility pocket", (s * 0.173, -0.094, 0.426), (0.142, 0.054, 0.135), sage,
                    rotation=(0, -s * 7, 0), bevel=0.023)
        rounded_box("Work boot sole", (s * 0.178, -0.078, 0.045), (0.231, 0.341, 0.090), umber, bevel=0.046)
        uv("Work boot toe", (s * 0.178, -0.111, 0.100), (0.115, 0.153, 0.078), ivory)
        uv("Dark lace boot shaft", (s * 0.178, -0.002, 0.156), (0.105, 0.110, 0.101), wool)
        for j in range(3):
            rounded_box("Amber lace tab", (s * 0.178, -0.143 - j * 0.008, 0.201 - j * 0.021),
                        (0.087, 0.029, 0.015), amber, bevel=0.006)
    line("Jagged diagonal zipper braid", [
         (0.110, -0.204, 1.133), (0.119, -0.216, 1.059), (0.092, -0.207, 0.963),
         (0.060, -0.190, 0.840), (0.032, -0.181, 0.647)], 0.013, wool)
    sweep("Diagonal olive carry strap", [
         (-0.272, -0.090, 1.199, 0.051, 0.028), (-0.196, -0.197, 1.050, 0.045, 0.022),
         (-0.094, -0.218, 0.964, 0.046, 0.022), (0.080, -0.220, 0.821, 0.044, 0.019),
         (0.222, -0.149, 0.704, 0.051, 0.024), (0.279, 0.008, 0.649, 0.044, 0.022),
    ], olive)
    rounded_box("Brass strap keeper", (-0.144, -0.233, 0.997), (0.096, 0.038, 0.092), amber,
                rotation=(0, 34, 0), bevel=0.015)
    rounded_box("Inset strap keeper", (-0.144, -0.257, 0.997), (0.062, 0.022, 0.054), sage,
                rotation=(0, 34, 0), bevel=0.011)
    rounded_box("Ivory chest pocket", (0.220, -0.139, 1.017), (0.154, 0.046, 0.121),
                ivory, rotation=(0, -7, -14), bevel=0.022)
    rounded_box("Chest pocket flap", (0.215, -0.172, 1.051), (0.155, 0.039, 0.040),
                stitches, rotation=(0, -7, -14), bevel=0.013)
    rounded_box("Pouch fastener", (0.228, -0.184, 1.023), (0.031, 0.027, 0.040), amber, bevel=0.007)
    rounded_box("Inferred compact moss belt pouch", (0.259, 0.136, 0.666), (0.194, 0.155, 0.168), olive,
                rotation=(0, -9, 33), bevel=0.044)
    rounded_box("Ivory pouch flap", (0.259, 0.205, 0.723), (0.196, 0.057, 0.069), ivory,
                rotation=(0, -9, 33), bevel=0.024)
    rounded_box("Honey rear belt clasp", (0.243, 0.238, 0.680), (0.031, 0.024, 0.057), amber,
                rotation=(0, -9, 33), bevel=0.007)
    line("Rear centre stitching", [(0, 0.192, 0.648), (0, 0.199, 0.84),
         (0, 0.214, 1.059), (0, 0.183, 1.189)], 0.006, stitches)


def assemble(name):
    bpy.ops.object.select_all(action="DESELECT")
    for item in MESHES:
        # glTF may propagate a mesh-wide COLOR_0 stream to every primitive.
        # Supply white for untinted surfaces so it multiplies the material by 1.
        if item.data.color_attributes.get("Palette") is None:
            paint = item.data.color_attributes.new(name="Palette", domain="POINT", type="FLOAT_COLOR")
            paint.data.foreach_set("color", [1.0] * (4 * len(item.data.vertices)))
        item.select_set(True)
    obj = MESHES[0]
    bpy.context.view_layer.objects.active = obj
    # Input objects include both generated native-coordinate meshes and
    # transformed primitives. Bake transforms, then combine vertex and
    # material data to minimize Electron draw calls.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj.name = name
    obj.data.name = name + " sculpture"
    obj["asset_origin"] = "Original mesh derived from the Agent Arcade portrait design"
    obj["front_axis"] = "glTF +Z"
    return obj


def aim(obj, at):
    obj.rotation_euler = (Vector(at) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_views(name, directory, height, size):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Neutral studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.24, 0.25, 0.29, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42
    scene.view_settings.view_transform = "Standard"
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.008))
    bpy.context.object.data.materials.append(material("Studio backdrop", "56475f" if name == "gemini-cat" else "374944"))
    for label, at, power, span, color in [
        ("Key", (-3, -5, 6), 440, 5, (1.0, 0.92, 0.96)),
        ("Fill", (4, -2, 4), 210, 5, (0.81, 0.89, 1.0)),
        ("Rim", (1, 3, 5), 360, 3, (1.0, 0.95, 0.86)),
    ]:
        light = bpy.data.lights.new(label, "AREA")
        light.energy, light.shape, light.size, light.color = power, "DISK", span, color
        obj = bpy.data.objects.new(label, light)
        bpy.context.collection.objects.link(obj)
        obj.location = at
        aim(obj, (0, 0, 1.2))
    camera = bpy.data.objects.new("Review camera", bpy.data.cameras.new("Review camera"))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = height * 1.21
    for label, angle in [("front", 0), ("side", 90), ("rear", 180)]:
        a = radians(angle)
        camera.location = (4.8 * sin(a), -4.8 * cos(a), height * 0.56)
        aim(camera, (0.015, 0, height * 0.5))
        scene.render.filepath = str(directory / (name + "-" + label + ".png"))
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--render-dir", type=Path)
    parser.add_argument("--render-size", type=int, default=512)
    parser.add_argument("--only", choices=("gemini-cat", "sprout"))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    if args.render_dir:
        args.render_dir.mkdir(parents=True, exist_ok=True)
    for name, factory in (("gemini-cat", cat), ("sprout", sprout)):
        if args.only and name != args.only:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        MESHES.clear()
        MATERIALS.clear()
        factory()
        obj = assemble(name)
        height = max(v[2] for v in obj.bound_box)
        model = args.output / (name + ".glb")
        bpy.ops.export_scene.gltf(
            filepath=str(model), export_format="GLB", use_selection=True, export_yup=True,
            export_vertex_color="MATERIAL", export_all_vertex_colors=False,
        )
        obj.data.calc_loop_triangles()
        print(f"FIGURE {name}: {len(obj.data.vertices)} vertices, {len(obj.data.loop_triangles)} triangles, height {height:.3f}")
        if args.render_dir:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            MATERIALS.clear()
            bpy.ops.import_scene.gltf(filepath=str(model))
            render_views(name, args.render_dir, height, args.render_size)


if __name__ == "__main__":
    main()
