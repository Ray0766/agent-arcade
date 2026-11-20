"""Generate the two local, texture-free Ju and Doubao desktop figures with Blender.

blender --background --factory-startup --python-exit-code 1 --python \
  scripts/desktop-pet-models/ju-doubao.py -- [ju|doubao|all] [preview-directory]

The portraits are art direction only. All visible faces, hair and textiles
below are original geometry and solid materials. Blender -Y exports as glTF +Z.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

SIN, COS, PI = math.sin, math.cos, math.pi
ROOT = Path(__file__).resolve().parents[2]


def material(name, color, *, metal=0, roughness=.63):
    def linear(component):
        return component / 12.92 if component <= .04045 else ((component + .055) / 1.055) ** 2.4

    rgba = (*[linear(int(color[i:i + 2], 16) / 255) for i in (0, 2, 4)], 1)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = rgba
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    return mat


def mesh(name, vertices, faces, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def ellipsoid(name, xyz, radius, mat, *, tilt=0, slices=18, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=slices, ring_count=rings, radius=1, location=xyz)
    obj = bpy.context.object
    obj.name = name
    obj.scale = radius
    obj.rotation_euler.y = tilt
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def stitch(rows, count, closed=True):
    width = count if closed else count - 1
    return [
        (row * count + i, row * count + (i + 1) % count,
         (row + 1) * count + (i + 1) % count, (row + 1) * count + i)
        for row in range(rows - 1) for i in range(width)
    ]


def tailored_rings(name, rings, mat, *, count=48, pleat=0):
    vertices = [
        ((rx + pleat * COS(a * 12)) * SIN(a), cy - (ry + pleat * COS(a * 12)) * COS(a), z)
        for z, rx, ry, cy in rings
        for a in (i * 2 * PI / count for i in range(count))
    ]
    faces = stitch(len(rings), count)
    faces += [tuple(reversed(range(count))), tuple(range(len(vertices) - count, len(vertices)))]
    return mesh(name, vertices, faces, mat)


def spline(path, subdivisions=4):
    samples = []
    nodes = [Vector(item) for item in path]
    for i, (p1, p2) in enumerate(zip(nodes, nodes[1:])):
        p0, p3 = nodes[max(0, i - 1)], nodes[min(len(nodes) - 1, i + 2)]
        for step in range(subdivisions):
            t = step / subdivisions
            samples.append(.5 * (2 * p1 + (-p0 + p2) * t +
                                 (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                                 (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return [*samples, nodes[-1]]


def sweep(name, path, mat, *, sides=10, subdivisions=4, depth_hint=(0, -1, 0)):
    """Sweep a solid tapered elliptical section along a hand drawn 3D spline."""
    samples = spline(path, subdivisions)
    vertices = []
    depth = Vector(depth_hint)
    for i, point in enumerate(samples):
        loc = Vector(point[:3])
        tangent = (Vector(samples[min(i + 1, len(samples) - 1)][:3]) -
                   Vector(samples[max(0, i - 1)][:3])).normalized()
        width_axis = tangent.cross(depth)
        if width_axis.length < .01:
            width_axis = tangent.cross(Vector((0, 0, 1)))
        width_axis.normalize()
        depth_axis = width_axis.cross(tangent).normalized()
        for j in range(sides):
            a = j * 2 * PI / sides
            vertices.append(loc + width_axis * COS(a) * max(.001, point[3]) +
                            depth_axis * SIN(a) * max(.001, point[4]))
    faces = stitch(len(samples), sides)
    faces += [tuple(reversed(range(sides))), tuple(range(len(vertices) - sides, len(vertices)))]
    return mesh(name, vertices, faces, mat)


def line(name, points, radius, mat, *, sides=6):
    return sweep(name, [(x, y, z, radius, radius) for x, y, z in points], mat,
                 sides=sides, subdivisions=2)


# Individual chin-to-crown profiles anchor features on the face surface.
# Doubao has a rounder cheek and higher chin. Ju's is narrower and tapered.
JU_HEAD = [
    (1.462, .016, .025, -.108), (1.488, .106, .111, -.069),
    (1.536, .179, .169, -.051), (1.607, .249, .210, -.018),
    (1.695, .299, .238, .000), (1.784, .324, .251, .008),
    (1.866, .325, .256, .016), (1.954, .317, .246, .025),
    (2.036, .287, .225, .025), (2.109, .223, .185, .025),
    (2.173, .138, .122, .024), (2.211, .010, .018, .021),
]
DOU_HEAD = [
    (1.488, .014, .028, -.104), (1.506, .105, .117, -.067),
    (1.544, .184, .176, -.043), (1.604, .252, .217, -.012),
    (1.674, .301, .237, .003), (1.764, .332, .247, .005),
    (1.842, .341, .255, .012), (1.934, .336, .246, .023),
    (2.013, .300, .223, .032), (2.084, .246, .195, .027),
    (2.151, .144, .131, .023), (2.183, .009, .016, .021),
]


def face_depth(profile, x, z):
    a, b = next(((a, b) for a, b in zip(profile, profile[1:]) if a[0] <= z <= b[0]),
                (profile[0], profile[1]) if z < profile[0][0] else (profile[-2], profile[-1]))
    t = max(0, min(1, (z - a[0]) / (b[0] - a[0])))
    rx, ry, cy = [u + t * (v - u) for u, v in zip(a[1:], b[1:])]
    return cy - ry * math.sqrt(max(.05, 1 - (x / rx) ** 2))


def on_face_curve(name, profile, contour, mat, offset, radius):
    points = [(x, face_depth(profile, x, z) - offset, z) for x, z in contour]
    return line(name, points, radius, mat)


def face_patch(name, profile, center, outline, mat, offset=.01):
    outline = [point for point in spline([(*point, 0) for point in [*outline, outline[0]]], 4)[:-1]]
    vertices = [(center[0], face_depth(profile, *center) - offset - .005, center[1])]
    vertices += [(x, face_depth(profile, x, z) - offset, z) for x, z, _ in outline]
    faces = [(0, i + 1, (i + 1) % len(outline) + 1) for i in range(len(outline))]
    return mesh(name, vertices, faces, mat)


def eye(name, profile, x, z, sign, m, wide=False):
    width = .103 if wide else .095
    # An asymmetric almond. Lower edge is flatter with lifted outside corners.
    outline = [
        (-width, -.014), (-.075, .035), (-.030, .059), (.028, .064),
        (.074, .049), (width, .023), (.080, -.019),
        (.037, -.043), (-.026, -.047), (-.073, -.036),
    ]
    shape = [(x + sign * dx, z + dz) for dx, dz in outline]
    face_patch(name + ' ivory sclera', profile, (x, z), shape, m['white'], .010)
    iris_x = x - sign * .009
    def tint(label, dx, dz, rx, rz, offset, surface):
        center = (iris_x + dx, z + dz)
        border = [(center[0] + rx * SIN(a), center[1] + rz * COS(a))
                  for a in (i * 2 * PI / 18 for i in range(18))]
        face_patch(name + ' ' + label, profile, center, border, m[surface], offset)

    tint('iris dark edge', 0, .005, .050, .048, .028, 'iris_edge')
    tint('amber iris', 0, .000, .041, .042, .037, 'iris')
    tint('lower iris gold', .004, -.018, .027, .016, .044, 'amber')
    tint('pupil', 0, .010, .019, .025, .049, 'ink')
    tint('primary catchlight', -.014, .027, .011, .012, .057, 'white')
    tint('secondary catchlight', .021, -.014, .006, .006, .055, 'white')
    on_face_curve(name + ' dark upper lash', profile, shape[:6], m['ink'], .020, .010)
    on_face_curve(name + ' soft lower edge', profile, shape[5:] + [shape[0]], m['warm_edge'], .014, .004)
    # A tapered outer tuft with a small hook, visible at desktop scale.
    on_face_curve(name + ' lifted outside corner', profile, [shape[4], shape[5], (x + sign * (width + .019), z + .045)], m['ink'], .024, .007)
    on_face_curve(name + ' eyebrow', profile, [(x - sign * .073, z + .097),
                  (x - sign * .018, z + .111), (x + sign * .034, z + .120),
                  (x + sign * .075, z + .107)], m['brow'], .012, .007)


def head(profile, m, *, doubao):
    tailored_rings('Sculpted head', profile, m['skin'], count=64)
    for sign in (-1, 1):
        ellipsoid('Ear', (sign * .309, .003, 1.69), (.059, .081, .100), m['skin'], tilt=sign * -.23)
        ellipsoid('Ear concha', (sign * .335, -.047, 1.695), (.024, .032, .053), m['ear'], tilt=sign * -.23)
        eye('Left eye' if sign < 0 else 'Right eye', profile, sign * .144, 1.793 if doubao else 1.774, sign, m, doubao)
        # Tiny blush strokes, modeled directly along the cheeks.
        for j in range(3):
            x = sign * (.168 + j * .019)
            on_face_curve('Cheek blush', profile, [(x, 1.689), (x + .007, 1.676)], m['blush'], .003, .003)
    bridge_y = face_depth(profile, 0, 1.704)
    ellipsoid('Nose tip and bridge', (0, bridge_y + .004, 1.703), (.036, .051, .042), m['skin'])
    ellipsoid('Nose underside', (.014, bridge_y - .029, 1.681), (.013, .013, .009), m['ear'], slices=12)
    if doubao:
        face_patch('Open cheerful mouth', profile, (0, 1.592),
                   [(-.087, 1.634), (0, 1.655), (.082, 1.645), (.068, 1.581),
                    (.02, 1.553), (-.021, 1.552), (-.066, 1.583)], m['mouth'], .012)
        face_patch('Upper teeth', profile, (0, 1.639),
                   [(-.061, 1.634), (0, 1.651), (.060, 1.644), (.036, 1.630),
                    (-.028, 1.624)], m['white'], .022)
        face_patch('Tongue', profile, (0, 1.582),
                   [(-.058, 1.588), (-.013, 1.604), (.046, 1.603), (.064, 1.588),
                    (.026, 1.557), (-.02, 1.558)], m['lip'], .024)
    else:
        on_face_curve('Closed sideways smile', profile,
                      [(-.066, 1.603), (-.022, 1.589), (.028, 1.593), (.074, 1.610)], m['mouth'], .015, .007)
        on_face_curve('Warm lower lip', profile,
                      [(-.040, 1.584), (0, 1.579), (.039, 1.585)], m['lip'], .006, .004)
        x, z = -.229, 1.691
        ellipsoid('Ju beauty mark', (x, face_depth(profile, x, z) - .005, z), (.008, .004, .008), m['ink'], slices=10)


def scalp(mat, *, doubao):
    count, levels = 64, 15
    vertices = []
    for i in range(levels):
        for j in range(count):
            a = j * 2 * PI / count
            back = (1 - COS(a)) / 2
            length = 1.10 + (1.49 if doubao else 1.13) * back ** .63
            t = .026 + (length - .026) * i / (levels - 1)
            flare = 1 + (0.035 * SIN(12 * a) + .025 * COS(6 * a)) * (i / (levels - 1)) ** 2
            vertices.append((.365 * SIN(t) * SIN(a) * flare,
                             .036 - .291 * SIN(t) * COS(a) * flare,
                             1.862 + .413 * COS(t)))
    faces = stitch(levels, count) + [tuple(reversed(range(count)))]
    return mesh('Sculpted scalp with raised crown', vertices, faces, mat)


def hair_sections(m, *, doubao):
    scalp(m['hair'], doubao=doubao)
    if doubao:
        # The short bob follows the jaw and kicks out at the nape. Each tuft
        # bends around the volume instead of using a repeated face-facing card.
        for j in range(11):
            a = .97 + j * (2 * PI - 1.94) / 10
            end = 1.498 + .054 * COS(a) + .021 * SIN(j * 2.1)
            sx, sy = SIN(a), -COS(a)
            sweep(f'Layered bob section {j}', [
                (.10 * sx, .022 + .09 * sy, 2.233, .072, .030),
                (.291 * sx, .034 + .226 * sy, 2.112, .110, .061),
                (.353 * sx, .065 + .272 * sy, 1.867, .117, .045),
                (.328 * sx, .066 + .257 * sy, end + .13, .094, .043),
                (.371 * sx + .025 * COS(a), .063 + .222 * sy, end + .022, .038, .020),
                (.329 * sx + .047 * COS(a), .019 + .21 * sy, end, .003, .003),
            ], m['hair'] if j % 3 else m['hair_mid'], depth_hint=(sx, sy, 0))
        front = [
            [(-.137, -.098, 2.227, .057, .035), (-.105, -.231, 2.100, .084, .051), (-.067, -.277, 1.979, .075, .033), (-.003, -.270, 1.883, .045, .018), (.068, -.264, 1.874, .003, .003)],
            [(-.172, -.093, 2.211, .063, .042), (-.204, -.233, 2.089, .074, .041), (-.232, -.266, 1.976, .058, .026), (-.268, -.227, 1.886, .033, .017), (-.294, -.195, 1.834, .003, .003)],
            [(-.043, -.081, 2.250, .061, .035), (.046, -.222, 2.137, .095, .051), (.128, -.266, 2.028, .071, .035), (.217, -.228, 1.954, .055, .026), (.300, -.181, 1.909, .009, .008)],
            [(-.013, -.039, 2.258, .086, .042), (.142, -.156, 2.173, .099, .057), (.261, -.211, 2.079, .083, .052), (.333, -.175, 1.973, .053, .034), (.373, -.101, 1.883, .003, .003)],
        ]
    else:
        # Waist-length curled locks and brighter overlapping orange ribbons.
        for j in range(9):
            a = .74 + j * (2 * PI - 1.48) / 8
            sx, sy = SIN(a), -COS(a)
            end = .84 + .16 * COS(a) + .06 * SIN(j * 2.7)
            sweep(f'Long curled auburn section {j}', [
                (.089 * sx, .045 + .078 * sy, 2.224, .077, .037),
                (.282 * sx, .05 + .232 * sy, 2.104, .117, .060),
                (.371 * sx, .05 + .288 * sy, 1.842, .116, .071),
                (.331 * sx, .069 + .242 * sy, 1.533, .117, .066),
                (.330 * sx, .092 + .228 * sy, 1.237, .106, .060),
                (.396 * sx + .031 * COS(a), .045 + .258 * sy, end + .19, .069, .041),
                (.354 * sx + .060 * COS(a), .043 + .197 * sy, end + .04, .041, .028),
                (.284 * sx + .08 * COS(a), .026 + .173 * sy, end, .003, .003),
            ], m['hair'] if j % 3 else m['hair_mid'], depth_hint=(sx, sy, 0))
        front = [
            [(.031, -.069, 2.235, .057, .041), (.018, -.227, 2.104, .094, .049), (-.035, -.270, 1.998, .089, .043), (-.064, -.268, 1.909, .054, .021), (-.030, -.271, 1.825, .005, .004)],
            [(-.036, -.081, 2.241, .059, .048), (-.114, -.207, 2.133, .075, .047), (-.189, -.241, 2.024, .068, .030), (-.252, -.219, 1.941, .058, .024), (-.315, -.153, 1.891, .005, .004)],
            [(.092, -.068, 2.220, .051, .037), (.164, -.207, 2.141, .094, .054), (.244, -.226, 2.052, .086, .040), (.302, -.193, 1.944, .081, .038), (.355, -.112, 1.815, .008, .006)],
            [(.048, -.096, 2.222, .043, .030), (.092, -.245, 2.114, .049, .025), (.123, -.255, 2.034, .039, .024), (.144, -.257, 1.951, .023, .014), (.173, -.239, 1.903, .003, .003)],
        ]
        # Loose curled locks in front of both shoulders.
        for sign in (-1, 1):
            sweep('Front curling lock', [
                (sign * .262, -.124, 2.056, .070, .053),
                (sign * .336, -.066, 1.829, .087, .049),
                (sign * .345, -.128, 1.611, .067, .042),
                (sign * .289, -.219, 1.399, .058, .039),
                (sign * .329, -.261, 1.187, .060, .039),
                (sign * .409, -.200, 1.083, .033, .020),
                (sign * .412, -.182, 1.135, .003, .003),
            ], m['hair_mid'])
    for i, section in enumerate(front):
        sweep(f'Asymmetric fringe strand {i}', section, m['hair_mid'] if i % 2 == 0 else m['hair'])
        # Highlights are narrow curved volumes driven by the same section's
        # path, so the side profile still reads as shaped hair.
        highlighted = [(x - .20 * w, y - d * .76, z, w * .13, d * .19)
                       for x, y, z, w, d in section]
        sweep(f'Painted fringe glint {i}', highlighted[1:], m['hair_light'], sides=7)
    flick = [(-.113, .053, 2.232, .045, .027), (-.020, -.008, 2.339, .030, .015),
             (.109, -.010, 2.355 if not doubao else 2.307, .020, .011),
             (.173, -.045, 2.282, .003, .003)]
    sweep('Loose crown curl', flick, m['hair_mid'])


def flower(name, x, y, z, scale, petal, center, *, pointed=False):
    for i in range(5):
        a = i * 2 * PI / 5
        radius = scale * .46
        ellipsoid(f'{name} petal {i}', (x + radius * SIN(a), y, z + radius * COS(a)),
                  (scale * .28, scale * .18, scale * (.47 if pointed else .39)),
                  petal, tilt=a, slices=12, rings=8)
    ellipsoid(name + ' center', (x, y - scale * .15, z), (scale * .24, scale * .15, scale * .24),
              center, slices=12, rings=8)


def ribbon(name, center, scale, mat, trim):
    x, y, z = center
    for sign in (-1, 1):
        path = [(x, y, z, .022 * scale, .015 * scale),
                (x + sign * .069 * scale, y - .005, z + .057 * scale, .063 * scale, .024 * scale),
                (x + sign * .139 * scale, y + .027 * scale, z + .050 * scale, .066 * scale, .025 * scale),
                (x + sign * .165 * scale, y + .010, z - .001, .025 * scale, .014 * scale),
                (x + sign * .080 * scale, y - .005, z - .026 * scale, .044 * scale, .022 * scale),
                (x, y, z, .011 * scale, .009 * scale)]
        sweep(name + ' loop', path, mat, sides=9)
        line(name + ' metal thread', [(a, b - d * .85, c - w * .22) for a, b, c, w, d in path], .004 * scale, trim)
        sweep(name + ' drape', [(x + sign * .026 * scale, y, z, .031 * scale, .011),
                               (x + sign * .055 * scale, y + .013, z - .111 * scale, .051 * scale, .014),
                               (x + sign * .094 * scale, y + .035, z - .218 * scale, .035 * scale, .013),
                               (x + sign * .089 * scale, y + .041, z - .251 * scale, .011 * scale, .004)], mat, sides=8)


def hair_jewels(m, *, doubao):
    if doubao:
        # Coral open clover cord and independent tassel, on the right.
        x, y, z = .272, -.269, 2.084
        for i in range(4):
            a = i * PI / 2 + .12
            loop = []
            for j in range(21):
                t = j * 2 * PI / 20
                r, q = .046 + .044 * COS(t), .036 * SIN(t)
                loop.append((x + r * SIN(a) + q * COS(a), y - .032,
                             z + r * COS(a) - q * SIN(a)))
            line('Coral open clover knot', loop, .015, m['red_light'], sides=8)
        ellipsoid('Knot brass center', (x, y - .056, z), (.028, .018, .028), m['gold'])
        line('Tassel hanging cord', [(x + .021, y - .053, z - .018),
                                    (x + .055, y - .019, z - .112)], .009, m['red_light'])
        ellipsoid('Tassel bead', (x + .055, y - .019, z - .111), (.022, .016, .021), m['gold'])
        for i in range(5):
            sweep('Coral silk tassel', [(x + .055, y - .022, z - .130, .009, .005),
                                       (x + .070 + .005 * i, y - .026, z - .180, .012, .007),
                                       (x + .091 + .008 * i, y - .011, z - .240, .009, .005)], m['red_light'])
        sweep('Coral knot side petal', [(x + .063, y - .014, z - .102, .013, .008),
                                        (x + .118, y - .003, z - .122, .040, .013),
                                        (x + .161, y + .012, z - .156, .003, .003)], m['coral'])
    else:
        x, y, z = -.300, -.206, 2.064
        ribbon('Black satin hair bow', (x - .022, y + .034, z - .041), .74, m['ink'], m['gold'])
        for turn in (-.65, .2, .68):
            ellipsoid('Olive flower leaf', (x + .061 * SIN(turn), y + .024, z + .075),
                      (.036, .018, .078), m['leaf'], tilt=turn)
        flower('Orange blossom', x, y - .051, z, .100, m['petal'], m['gold'], pointed=True)
        for i in range(4):
            a = i * PI / 2 + .3
            line('Pollen filament', [(x, y - .075, z), (x + SIN(a) * .028, y - .080, z + COS(a) * .028)],
                 .0035, m['gold'])
        for i in range(2):
            x0 = x - .052 - i * .034
            z0 = z - .181 - i * .036
            line('Hair ornament pendant chain', [(x0, y - .042, z - .05),
                                                  (x0 - .012, y - .026, z0)], .005, m['gold'])
            ellipsoid('Amber bead', (x0 - .012, y - .028, z0 - .018), (.021, .016, .030), m['amber'])


def cape(m, *, doubao):
    points = []
    bands, count = 7, 57
    start = .36 if doubao else .60
    for i in range(bands):
        t = i / (bands - 1)
        for j in range(count):
            a = start + (2 * PI - 2 * start) * j / (count - 1)
            waviness = (.030 if doubao else .010) * COS(a * 8)
            shoulder = SIN(t * PI * .73)
            x = (.125 + .275 * shoulder + .050 * t) * SIN(a)
            y = -(.127 + .100 * shoulder + .041 * t) * COS(a) + .019
            z = 1.365 - (.286 if doubao else .348) * t + waviness * t * t
            points.append((x, y, z))
    mesh('Scalloped coral shoulder cape' if doubao else 'Rust tailored shoulder cape', points,
         stitch(bands, count, False), m['red'])
    hem = points[-count:]
    line('Gold edge of cape', hem, .012, m['gold'])
    line('Left front gold edge', points[0::count], .011, m['gold'])
    line('Right front gold edge', points[count - 1::count], .011, m['gold'])
    if doubao:
        for sign in (-1, 1):
            for dx, dz, size in [(0, 0, .037), (.070, -.039, .023), (.043, .020, .018)]:
                x, z = sign * (.205 + dx), 1.154 + dz
                y = -.185 + dx * .20
                flower('Cape blossom embroidery', x, y, z, size, m['white'], m['gold'])
                ellipsoid('Cape embroidery leaf', (x + sign * .025, y + .003, z + .025),
                          (.009, .004, .022), m['foliage'], tilt=sign * .7, slices=10, rings=7)
    else:
        for sign in (-1, 1):
            line('Ju cape stem embroidery', [(sign * .264, -.164, 1.063), (sign * .227, -.176, 1.104),
                 (sign * .219, -.182, 1.154)], .006, m['gold'])
            for i in range(3):
                ellipsoid('Ju cape leaf embroidery',
                          (sign * (.233 + i * .015), -.185 + i * .006, 1.113 + i * .013),
                          (.008, .005, .026), m['gold'], tilt=sign * (.6 + i * .3),
                          slices=12, rings=8)


def garment(m, *, doubao):
    # Slim arms and two distinct lower silhouettes are extrapolated from the
    # chest-up portraits. Ju has a short layered skirt and boots, Doubao a
    # longer rounded coat skirt and gold-trimmed shoes.
    for s in (-1, 1):
        x = s * .113
        tailored = [(x, .004, .110 if doubao else .276, .049, .052),
                    (x, .003, .289 if doubao else .315, .050, .055),
                    (s * .097, .005, .514, .063, .064), (s * .092, .008, .641, .073, .071)]
        sweep('Cream stocking', tailored, m['cream'])
        if doubao:
            ellipsoid('Coral embroidered slipper', (x, -.050, .062), (.074, .115, .061), m['red'])
            ellipsoid('Slipper sole', (x, -.058, .028), (.077, .115, .027), m['ink'])
            ellipsoid('Toe ornament', (x, -.141, .073), (.041, .027, .013), m['gold'])
        else:
            sweep('High fitted boot', [(x, .006, .070, .068, .068),
                                       (x, .006, .178, .063, .062),
                                       (x, .009, .297, .060, .061)], m['ink'])
            ellipsoid('Polished boot toe', (x, -.054, .063), (.075, .122, .062), m['ink'])
            ellipsoid('Boot sole', (x, -.052, .026), (.077, .123, .025), m['mouth'])
            ellipsoid('Boot strap brass button', (x, -.051, .230), (.016, .014, .017), m['gold'], slices=12)
        sleeve = [(s * .204, .010, 1.228, .086, .083), (s * .295, .012, 1.094, .099, .080),
                  (s * .345, -.006, .929, .087, .076), (s * .381, -.038, .777, .065, .064)]
        sweep('Ivory puff sleeve', sleeve, m['cream'])
        ellipsoid('Woven sleeve cuff', (s * .384, -.038, .774), (.070, .069, .048), m['white'])
        ellipsoid('Gold cuff button', (s * .394, -.090, .775), (.016, .013, .018), m['gold'], slices=12)
        ellipsoid('Mitten-shaped hand', (s * .396, -.050, .693), (.061, .056, .086), m['skin'], tilt=s * -.25)
        ellipsoid('Separate thumb', (s * .354, -.076, .720), (.026, .035, .049), m['skin'], tilt=s * -.45)
    if doubao:
        skirt = [(.341, .286, .190, .025), (.414, .312, .192, .024), (.545, .295, .187, .019),
                 (.692, .250, .164, .013), (.803, .205, .132, .010)]
        tailored_rings('Rounded red coat skirt', skirt, m['red'], pleat=.014)
        for z, rx, ry in [(.347, .29, .193), (.374, .304, .198)]:
            line('Skirt border gold stitch', [(rx * SIN(a), .024 - ry * COS(a), z)
                 for a in (i * 2 * PI / 64 for i in range(65))], .006, m['gold'])
        sweep('Coat ivory split front', [(0, -.12, .807, .035, .014), (0, -.17, .607, .072, .016),
                                        (0, -.194, .405, .083, .012), (0, -.173, .340, .074, .010)], m['cream'])
    else:
        skirt = [(.495, .327, .195, .026), (.546, .316, .197, .026), (.644, .273, .178, .020),
                 (.759, .214, .152, .010), (.861, .186, .129, .007)]
        tailored_rings('Rust box-pleat skirt', skirt, m['red'], pleat=.019)
        tailored_rings('Ivory petticoat hem', [(.450, .300, .178, .021), (.485, .325, .195, .025),
                       (.525, .305, .187, .023)], m['cream'], pleat=.019)
        line('Skirt antique gold piping', [((.326 + .019 * COS(a * 12)) * SIN(a),
                  .025 - (.198 + .019 * COS(a * 12)) * COS(a), .507)
                  for a in (i * 2 * PI / 96 for i in range(97))], .008, m['gold'])
    tailored_rings('Ivory fitted blouse', [(.743, .199, .131, .009), (.849, .186, .131, .009),
                   (1.021, .231, .147, .014), (1.203, .254, .170, .011),
                   (1.300, .188, .132, .018), (1.388, .102, .096, .016)], m['cream'], pleat=.009)
    waist = ([(.747, .247, .179, .013), (.783, .228, .167, .012), (.825, .209, .154, .009)]
             if doubao else
             [(.743, .257, .186, .013), (.816, .229, .174, .012), (.864, .211, .150, .009)])
    tailored_rings('Woven waist band', waist, m['red_light'] if doubao else m['ink'])
    z, rx, ry, y = waist[-1]
    line('Gold top edge of waist band', [(rx * SIN(a), y - ry * COS(a), z + .001)
         for a in (i * 2 * PI / 64 for i in range(65))], .006, m['gold'])
    if not doubao:
        ellipsoid('Oval front belt buckle', (0, -.175, .804), (.042, .013, .026), m['gold'], slices=16)
        ellipsoid('Belt buckle center', (0, -.187, .804), (.027, .008, .014), m['ink'], slices=12)
    ellipsoid('Neck', (0, .006, 1.429), (.118, .103, .119), m['skin'])
    cape(m, doubao=doubao)
    if doubao:
        # Upright split collar with gilt edge and frog closures.
        for side in (-1, 1):
            sweep('Mandarin collar wing', [(side * .028, -.144, 1.286, .032, .017),
                  (side * .074, -.137, 1.359, .049, .020),
                  (side * .099, -.099, 1.431, .041, .016),
                  (side * .071, -.039, 1.456, .022, .017)], m['white'])
            line('Gilt collar roll', [(side * .01, -.167, 1.300), (side * .057, -.157, 1.378),
                                     (side * .101, -.125, 1.435), (side * .092, -.058, 1.469)],
                 .008, m['gold'])
        ribbon('Coral collar ties', (0, -.201, 1.245), .63, m['red_light'], m['red_light'])
        jade = [(SIN(a) * .043, -.235, 1.254 + COS(a) * .043)
                for a in (i * 2 * PI / 40 for i in range(41))]
        line('Jade ring brooch', jade, .016, m['jade'], sides=10)
        ellipsoid('Brooch clasp', (0, -.251, 1.213), (.018, .009, .015), m['gold'], slices=12)
        for z in (1.138, 1.038, .945, .844):
            for sign in (-1, 1):
                line('Satin frog closure', [(0, -.161, z), (sign * .042, -.164, z + .008),
                    (sign * .054, -.156, z), (sign * .036, -.169, z - .008), (0, -.165, z)],
                     .006, m['gold'])
    else:
        # Layered white ruff and bib seen underneath the darker sun-brooch bow.
        for i in range(14):
            a = i * 2 * PI / 14
            ellipsoid('Pleated white ruff', (.108 * SIN(a), -.104 * COS(a), 1.381 + .018 * SIN(3 * a)),
                      (.047, .048, .073), m['white'], slices=12, rings=7)
        for i, z in enumerate((1.197, 1.123, 1.052)):
            ellipsoid('Tiered ivory ruffle bib', (0, -.154 - i * .008, z),
                      (.151 - i * .014, .041, .053), m['white'])
            line('Gold stitched ruffle', [(-.136, -.170, z), (-.072, -.188, z - .032),
                 (0, -.195, z - .044), (.072, -.188, z - .032), (.136, -.170, z)], .0045, m['gold'])
        ribbon('Dark chest bow', (0, -.203, 1.252), .82, m['ink'], m['gold'])
        for i in range(12):
            a = i * PI / 6
            points = [(.034 * SIN(a - .24), -.242, 1.253 + .034 * COS(a - .24)),
                      (.064 * SIN(a), -.235, 1.253 + .064 * COS(a)),
                      (.034 * SIN(a + .24), -.242, 1.253 + .034 * COS(a + .24))]
            mesh('Sun brooch ray', points, [(0, 1, 2)], m['gold'], False)
        ellipsoid('Sun brooch rim', (0, -.243, 1.253), (.040, .019, .043), m['gold'])
        ellipsoid('Amber sun brooch', (0, -.260, 1.253), (.028, .015, .033), m['amber'])
        for z in (1.078, .983, .898):
            ellipsoid('Ju brass blouse button', (0, -.172, z), (.020, .014, .020), m['gold'], slices=12)


def palette(doubao):
    shade = {
        'skin': 'FFCEB4' if doubao else 'FBC7AA', 'ear': 'E99E86', 'blush': 'D98071',
        'ink': '29212A', 'brow': '47303A' if doubao else '904D36',
        'white': 'FFF5EA', 'cream': 'EFE0CD', 'mouth': '793639', 'lip': 'F58E83',
        'iris_edge': '683E32', 'iris': 'B97034' if doubao else 'C98027', 'amber': 'F9AD37',
        'gold': 'E9BC68', 'jade': '78B9A5', 'leaf': '6B733C', 'petal': 'F89131',
        'hair': '30272A' if doubao else 'A3421B', 'hair_mid': '443333' if doubao else 'DA6327',
        'hair_light': '6E514B' if doubao else 'F69848', 'warm_edge': '9A6253',
        'red': 'C84B47' if doubao else 'AF4E36', 'red_light': 'EA6558',
        'coral': 'F88A67', 'foliage': 'D8BD80',
    }
    return {name: material(name, color, metal=.17 if name == 'gold' else 0,
                           roughness=.37 if name in {'gold', 'jade', 'iris', 'amber'} else .65)
            for name, color in shade.items()}


def merge_material_surfaces():
    """Batch meshes per material so a transparent pet uses few draw calls."""
    surfaces = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH':
            surfaces.setdefault(obj.data.materials[0], []).append(obj)
    for mat, objects in surfaces.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.context.object.name = mat.name


def render_previews(directory, role):
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 420
    scene.render.resolution_y = 500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.world = bpy.data.worlds.new("Preview world")
    scene.world.color = (.22, .22, .22)

    def aim(obj, point):
        obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()

    for xyz, power, size in [((-.9, -3, 4), 330, 3), ((2.4, -2.0, 2.0), 190, 3),
                             ((.8, 2.0, 3.5), 270, 2)]:
        data = bpy.data.lights.new('Preview softbox', 'AREA')
        data.energy, data.shape, data.size = power, 'DISK', size
        light = bpy.data.objects.new('Preview softbox', data)
        bpy.context.collection.objects.link(light)
        light.location = xyz
        aim(light, (0, 0, 1.3))
    camera_data = bpy.data.cameras.new('Turnaround')
    camera_data.type, camera_data.ortho_scale = 'ORTHO', 2.62
    camera = bpy.data.objects.new('Turnaround', camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    for label, angle in [('front', 0), ('three-quarter', PI / 5), ('side', PI / 2), ('rear', PI)]:
        camera.location = (4.7 * SIN(angle), -4.7 * COS(angle), 1.42)
        aim(camera, (0, 0, 1.185))
        scene.render.filepath = str(directory / f'{role}-{label}.png')
        bpy.ops.render.render(write_still=True)


def build(role, preview_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    doubao = role == 'doubao-girl'
    m = palette(doubao)
    garment(m, doubao=doubao)
    head(DOU_HEAD if doubao else JU_HEAD, m, doubao=doubao)
    hair_sections(m, doubao=doubao)
    hair_jewels(m, doubao=doubao)
    merge_material_surfaces()
    file = ROOT / 'src/assets/pets' / (role + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(file),
                              export_format='GLB', export_apply=True, export_yup=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_texcoords=False)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in meshes)
    print(f'MODEL {role}: {len(meshes)} material batches, {triangles} triangles', flush=True)
    if preview_dir:
        # Render the exported bytes rather than the pre-export Blender scene.
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(file))
        render_previews(preview_dir, role)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    which = args[0] if args else 'all'
    roles = {'ju': ('claude-ju',), 'doubao': ('doubao-girl',), 'all': ('claude-ju', 'doubao-girl')}
    if which not in roles or len(args) > 2:
        raise SystemExit('Usage: Blender … -- [ju|doubao|all] [preview-directory]')
    for character in roles[which]:
        build(character, Path(args[1]).resolve() if len(args) == 2 else None)
