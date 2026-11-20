"""Build the Dragon Girl and Whale Girl desktop pets in Blender 5.

Example, from the repository root:
    blender --background --factory-startup \
      --python scripts/desktop-pet-models/dragon-whale.py -- \
      --character all --preview-dir /private/tmp/arcade-character-check

Blender -Y is the front. The glTF export maps that direction to +Z.
The authored mesh, trims and face relief are local geometry and materials.
"""
from argparse import ArgumentParser
from math import cos, pi, sin, sqrt
from pathlib import Path
import json
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
TAU = 2 * pi
FRONT = Vector((0, -1, 0))
DRAGON = 'codex-dragon'
WHALE = 'deepseek-whale'


def srgb(hex_color):
    code = hex_color.removeprefix('#')
    channels = [int(code[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in channels)


def material(name, color, rough=.63, metallic=0, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*srgb(color), 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metallic
    if glow:
        shader.inputs['Emission Color'].default_value = mat.diffuse_color
        shader.inputs['Emission Strength'].default_value = glow
    return mat


def add_mesh(name, vertices, faces, materials, color_index=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for mat in materials:
        data.materials.append(mat)
    for i, polygon in enumerate(data.polygons):
        polygon.use_smooth = smooth
        if color_index is not None:
            polygon.material_index = color_index(i)
    return obj


def ellipsoid(name, center, radii, mat, segments=20, rings=12, tilt=0):
    """Low-density body for rounded volumes. Tilt is in the front plane."""
    c, s = cos(tilt), sin(tilt)
    vertices = []
    for k in range(rings + 1):
        phi = .0002 + (pi - .0004) * k / rings
        for n in range(segments):
            theta = TAU * n / segments
            x = radii[0] * sin(phi) * cos(theta)
            y = radii[1] * sin(phi) * sin(theta)
            z = radii[2] * cos(phi)
            vertices.append((center[0] + c*x + s*z, center[1] + y, center[2] - s*x + c*z))
    faces = [(k*segments+n, (k+1)*segments+n, (k+1)*segments+(n+1)%segments,
              k*segments+(n+1)%segments) for k in range(rings) for n in range(segments)]
    faces += [tuple(range(segments)), tuple(reversed(range(rings*segments, (rings+1)*segments)))]
    return add_mesh(name, vertices, faces, [mat])


def catmull(values, steps):
    """Centrally interpolated control points with fixed endpoints."""
    for k in range(len(values) - 1):
        a, b = values[max(k-1, 0)], values[k]
        c, d = values[k+1], values[min(k+2, len(values)-1)]
        for j in range(steps):
            t = j / steps
            yield .5 * ((2*b) + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t)
    yield values[-1]


def sweep(name, controls, mats, sides=10, steps=4, faceted=False, fluted=0):
    """Sweep an elliptical cross-section through the volume of a strand."""
    rows = [Vector(row) for row in controls]
    path = list(catmull(rows, steps))
    vertices = []
    for k, row in enumerate(path):
        point = Vector(row[:3])
        tangent = Vector(path[min(k+1,len(path)-1)][:3]) - Vector(path[max(k-1,0)][:3])
        tangent.normalize()
        normal = FRONT.cross(tangent)
        if normal.length < .01:
            normal = Vector((0, 0, 1)).cross(tangent)
        normal.normalize()
        depth = tangent.cross(normal).normalized()
        for n in range(sides):
            theta = TAU * n / sides
            flare = 1 + fluted * cos(3*theta)
            vertices.append(point + flare*(normal * (max(.001, row[3])*cos(theta)) +
                                            depth * (max(.001,row[4])*sin(theta))))
    faces = []
    for k in range(len(path)-1):
        for n in range(sides):
            faces.append((k*sides+n,k*sides+(n+1)%sides,(k+1)*sides+(n+1)%sides,(k+1)*sides+n))
    faces += [tuple(reversed(range(sides))), tuple(range((len(path)-1)*sides, len(path)*sides))]
    # Vary the narrow reflections down the ridge of a strand. Broad reflections
    # are modeled surfaces, not an image pasted onto the whole head.
    def palette(i):
        if len(mats) == 1:
            return 0
        if faceted:
            return (i % sides + i // (sides * 7)) % len(mats)
        return 1 if i % sides == sides//4 else (2 if len(mats) == 3 and i % sides == 3*sides//4 else 0)
    return add_mesh(name, vertices, faces, mats, palette, smooth=not faceted)


def line(name, path, width, mat, sides=6):
    return sweep(name, [(*pos, width, width) for pos in path], [mat], sides=sides, steps=3)


def loft(name, rings, mat, pleats=0, phase=0, sides=48, tilts=0, cut=None):
    """Radial garment made from connected volume rings, with optional pleats."""
    vertices, faces = [], []
    for height, rx, ry, fluting in rings:
        for i in range(sides):
            t = TAU*i/sides + phase
            pleat = fluting * cos(pleats*t) if pleats else 0
            z = height + tilts * sin(t)
            if cut:
                z += cut(t, height)
            vertices.append(((rx+pleat)*cos(t),(ry+pleat)*sin(t),z))
    for k in range(len(rings)-1):
        for n in range(sides):
            faces.append((k*sides+n,k*sides+(n+1)%sides,(k+1)*sides+(n+1)%sides,(k+1)*sides+n))
    faces += [tuple(reversed(range(sides))), tuple(range((len(rings)-1)*sides,len(rings)*sides))]
    return add_mesh(name, vertices, faces, [mat])


def ring(name, z, rx, ry, width, mat, waves=0, amplitude=0):
    points = [(rx*cos(t),ry*sin(t),z+amplitude*cos(waves*t))
              for t in (TAU*n/48 for n in range(49))]
    return sweep(name, [(*v,width,width) for v in points], [mat], sides=6,steps=1)


def solid_shape(name, path, y, depth, mat):
    """Thick closed solid from a front-view contour."""
    vertices = [(x,y+dy,z) for dy in [-depth/2,depth/2] for x,z in path]
    count = len(path)
    faces = [tuple(range(count)),tuple(reversed(range(count,count*2)))]
    faces += [(n,(n+1)%count,(n+1)%count+count,n+count) for n in range(count)]
    result = add_mesh(name,vertices,faces,[mat],smooth=False)
    bevel = result.modifiers.new('Shaped edges','BEVEL')
    bevel.width = min(depth * .2, .010)
    bevel.segments = 2
    return result


def ornament(name, x, y, z, dx, dz, color, frame):
    outer = [(x-dx,z),(x,z-dz),(x+dx,z),(x,z+dz)]
    solid_shape(name+' filigree setting', outer, y, .028, frame)
    inner = [(x+(a-x)*.76,z+(b-z)*.77) for a,b in outer]
    vertices = [(a,y-.022,b) for a,b in inner] + [(x,y-.055,z+.006)]
    faces = [(i,(i+1)%4,4) for i in range(4)]
    add_mesh(name+' inset stone',vertices,faces,[color],smooth=False)


def ribbon(name, x, y, z, width, height, fabric, edge, jewel, doubled=False):
    for sign in (-1,1):
        path = [(x,z), (x+sign*width*.63,z+height*.72), (x+sign*width,z+height*.46),
                (x+sign*width*.94,z-height*.45), (x+sign*width*.72,z-height*.57),
                (x+sign*width*.28,z-height*.13)]
        solid_shape(name+' bow loop',path,y,.045,fabric)
        line(name+' woven edge',[(a,y-.026,b) for a,b in path[:4]],.005,edge)
        path = [(x+sign*.01,z-.01),(x+sign*.056,z-.045),
                (x+sign*width*.63,z-height*(2.2 if doubled else 1.52)),
                (x+sign*width*.36,z-height*1.9),(x+sign*width*.22,z-height*2.12)]
        solid_shape(name+' split fabric tail',path,y+.005,.027,fabric)
        line(name+' ribbon piping',[(a,y-.013,b) for a,b in path[1:4]],.005,edge)
    ornament(name,x,y-.035,z,.025,.032,jewel,edge)


class Face:
    """The surface of the head and its sculpted relief, in model coordinates."""
    def __init__(self, center, height, width, depth, taper):
        self.center = center
        self.height = height
        self.width = width
        self.depth = depth
        self.taper = taper

    def radius(self, t):
        return self.width*(.98 + self.taper*t)

    def surface(self, x, z):
        t = (z-self.center)/self.height
        u = x/self.radius(t)
        return -self.depth * sqrt(max(.001,1-t*t-u*u)) - .041

    def head(self, skin):
        sides = 48
        rings = 30
        vertices = []
        for i in range(rings+1):
            phi = .0003+(pi-.0006)*i/rings
            for j in range(sides):
                theta = TAU*j/sides
                vertices.append((self.radius(cos(phi))*sin(phi)*cos(theta),
                                 -.041+self.depth*sin(phi)*sin(theta),
                                 self.center+self.height*cos(phi)))
        faces = [(i*sides+n,(i+1)*sides+n,(i+1)*sides+(n+1)%sides,i*sides+(n+1)%sides)
                 for i in range(rings) for n in range(sides)]
        faces += [tuple(range(sides)),tuple(reversed(range(rings*sides,(rings+1)*sides)))]
        add_mesh('Sculpted face',vertices,faces,[skin])

    def panel(self, name, x, z, w, h, mat, offset=.006, tilt=0, profile=1, points=40):
        coords = []
        for scale in (.34,.68,1):
            for j in range(points):
                theta = TAU*j/points
                horizontal = cos(theta)
                a = x+w*scale*horizontal
                b = z+h*scale*sin(theta)*(1-.17*abs(horizontal))*profile+tilt*(a-x)
                coords.append((a,self.surface(a,b)-offset,b))
        coords.append((x,self.surface(x,z)-offset,z))
        faces = [(3*points,j,(j+1)%points) for j in range(points)]
        faces += [(j+n*points,j+(n+1)*points,(j+1)%points+(n+1)*points,(j+1)%points+n*points)
                  for n in range(2) for j in range(points)]
        add_mesh(name,coords,faces,[mat])

    def detail(self, key, skin, blush, eyeliner, brows, white, iris, iris_lit, pupil, lip, lip_light, glitter):
        whale = key == WHALE
        for side in (-1,1):
            x = side*(.157 if whale else .160)
            z = self.center+.004
            tilt = side*(.13 if whale else .10)
            self.panel('Warm cheeks',side*.223,z-.083,.052,.019,blush,.004,tilt*.40)
            self.panel('Almond eyelid',x,z,.119,.055,eyeliner,.010,tilt)
            self.panel('Eye porcelain',x,z-.008,.108,.043,white,.013,tilt)
            ix = x - side*.010
            self.panel('Iris shadow',ix,z-.005,.047,.045,iris,.018)
            self.panel('Iris color',ix,z-.013,.042,.033,iris_lit,.022)
            self.panel('Centered vertical pupil',ix,z-.007,.021,.028,pupil,.025)
            self.panel('Soft eye reflection',ix-.014,z+.010,.011,.009,glitter,.028)
            self.panel('Tiny eye reflection',ix+.018,z-.025,.006,.006,glitter,.029)
            eyelash = [(x+side*.054,z+.036),(x+side*.092,z+.021),
                      (x+side*.114,z+.026),(x+side*.138,z+.050)]
            sweep('Tapered outer lash',
                  [(a,self.surface(a,b)-.015,b,w,w*.44)
                   for (a,b),w in zip(eyelash,[.006,.010,.008,.001])],[eyeliner],sides=7)
            brow = [(x-side*.106,z+.101),(x-side*.020,z+.123),(x+side*.050,z+.113),
                    (x+side*.091,z+.088)]
            sweep('Shaped brow',[(a,self.surface(a,b)-.007,b,w,w*.45)
                                 for (a,b),w in zip(brow,[.008,.012,.009,.001])],[brows],sides=7)
        nose_z = self.center-.088
        ellipsoid('Sculpted nose bridge',(0,self.surface(0,nose_z)+.009,nose_z),
                  (.027,.014,.027),skin,segments=16,rings=8)
        mouth_z = self.center-(.185 if whale else .174)
        self.panel('Curved smiling mouth',.011,mouth_z,.076,.032 if whale else .023,lip,.008,.095)
        self.panel('Lip interior',.011,mouth_z-.007,.059,.021 if whale else .012,lip_light,.011,.09)
        self.panel('Upper smile reflection',.004,mouth_z+.010,.044,.005,white,.015,.08)


def crown_hair(face, mat, whale):
    rows, sides = 18, 56
    vertices, faces = [], []
    for k in range(rows+1):
        for j in range(sides):
            theta = TAU*j/sides
            frontness = max(0,-sin(theta))
            bottom = 2.34-(1.29 if whale else 1.34)*frontness**1.1
            phi = .002+(bottom-.002)*k/rows
            ruffle = 1+.025*sin(theta*7)
            vertices.append((face.radius(cos(phi))*1.13*ruffle*sin(phi)*cos(theta),
                             -.018+face.depth*1.18*ruffle*sin(phi)*sin(theta),
                             face.center+(face.height+.040)*cos(phi)))
    for i in range(rows):
        for j in range(sides):
            faces.append((i*sides+j,(i+1)*sides+j,(i+1)*sides+(j+1)%sides,i*sides+(j+1)%sides))
    add_mesh('Sculpted crown hair',vertices,faces,[mat])


def stylized_hair(face, dark, base, mid, shine, whale):
    crown_hair(face, dark, whale)
    # Model the reflected streaks on the rounded top too. Their start is close
    # to the part and their ends splay toward the separate back locks.
    for i in range(10):
        theta = .08+pi*i/9
        x = .46*cos(theta)
        y = .34*sin(theta)
        sweep('Crown hair strand',[(.07,-.11,face.center+.468,.028,.016),
                                  (x*.42,y*.49,face.center+.442,.087,.035),
                                  (x*.86,y*.89,face.center+.305,.109,.047),
                                  (x,y,face.center+.105,.085,.035)],
              [mid if i%3==2 else base,shine,dark],sides=10,steps=4)
    for i in range(9):
        t = i/8
        x = -.43+.86*t
        y = .16+.18*(1-abs(t*2-1))
        drift = .08*sin(.65+i*1.63)
        tip = .76 if whale else .95
        sweep('Layered waterfall back lock',[(x*.7,y*.62,face.center+.27,.080,.035),
               (x*1.02,y,face.center+.00,.111,.072),(x*1.07,y+.06,1.51,.123,.089),
               (x+drift,y+.13,1.13,.130,.075),(x*1.15-drift,y+.20,tip+.06*cos(i),.096,.050),
               (x*1.25+drift,y+.25,tip-.16+.07*sin(i),.004,.005)],
              [base,mid],fluted=.06,sides=10)
    left = [
        [(.083,-.107,2.384,.017,.015),(-.055,-.246,2.328,.107,.041),(-.204,-.339,2.210,.110,.041),(-.296,-.332,2.130,.075,.028),(-.355,-.288,2.029,.043,.023),(-.366,-.281,1.961,.002,.002)],
        [(.076,-.129,2.380,.017,.018),(-.006,-.309,2.303,.094,.033),(-.104,-.403,2.202,.091,.032),(-.154,-.411,2.119,.051,.022),(-.217,-.372,2.075,.003,.003)],
        [(.086,-.128,2.374,.016,.015),(.061,-.310,2.290,.063,.024),(.017,-.408,2.199,.055,.024),(.014,-.432,2.143,.032,.016),(.053,-.430,2.109,.002,.002)],
        [(.113,-.132,2.372,.016,.017),(.207,-.271,2.315,.079,.033),(.290,-.313,2.223,.086,.036),(.351,-.298,2.139,.061,.027),(.411,-.263,2.064,.003,.003)],
    ]
    if whale:
        # Navy central curtain. It runs lower and throws a different silhouette
        # than the lighter, split and outward curling dragon fringe.
        left[2] = [(.105,-.130,2.391,.026,.021),(.054,-.295,2.301,.108,.049),(.011,-.398,2.207,.088,.034),
                   (-.018,-.445,2.117,.060,.028),(-.059,-.442,2.050,.023,.014),(-.100,-.414,2.032,.002,.003)]
    for i, points in enumerate(left):
        sweep('Sculpted fringe',points,[base if i%2 else mid,shine,dark],sides=12,fluted=.08)
    for side in (-1,1):
        for index in range(3):
            twist = (.036 if whale else .018)*index
            sweep('Graduated side ringlet',
                  [(side*(.329+.043*index),-.242+index*.073,2.217-.026*index,.069,.047),
                   (side*(.420+.031*index),-.293+index*.076,1.980,.108,.059),
                   (side*(.440+.035*index),-.170+index*.026,1.730,.098,.057),
                   (side*(.337+.012*index),-.254+twist,1.440-.041*index,.112,.065),
                   (side*(.437+.045*index),-.284+index*.065,1.170-.039*index,.088,.036),
                   (side*(.384-.055*index),-.330+index*.048,1.080-.070*index,.004,.006)],
                  [base if index!=1 else mid,shine,dark],sides=11,fluted=.12)
    # A grounded low-intensity glint on each fringe edge for the small window.
    for side in (-1,1):
        sweep('Fine loose forelock',[(side*.30,-.378,2.201,.012,.009),(side*.39,-.375,2.058,.018,.010),
                                    (side*.417,-.396,1.934,.014,.011),(side*.362,-.420,1.858,.002,.002)],
              [shine],sides=7)


def lower_body(skin, white, accent, suede, soles, metal, whale):
    for side in (-1,1):
        x = side*.145
        ellipsoid('Leg', (x,.005,.40),(.095,.107,.372),skin)
        ellipsoid('Calf stocking', (x,.009,.266),(.104,.114,.245),white)
        ellipsoid('Ankle boot', (x,-.004,.161),(.122,.132,.157),suede)
        ellipsoid('Rounded toe', (x,-.082,.089),(.133,.231 if whale else .197,.085),suede)
        ellipsoid('Outsole', (x,-.068,.035),(.138,.235 if whale else .203,.035),soles)
        ellipsoid('Toe cap', (x,-.201,.080),(.124,.085,.040),accent)
        line('Boot edge piping',[(x-.108,-.048,.258),(x-.061,-.108,.278),(x,-.125,.280),
                                  (x+.061,-.108,.278),(x+.108,-.048,.258)],.007,metal)
        ornament('Boot button',x,-.147,.189,.027,.038,accent,metal)


def arms(skin, fabric, white, trim, whale):
    for side in (-1,1):
        x = side*(.489 if whale else .476)
        y = -.039 if side == -1 else -.065
        sweep('Tailored sleeve',[(side*.241,.002,1.500,.080,.096),
                                 (side*.335,y+.028,1.417,.140,.128),
                                 (side*.423,y+.002,1.269,.104,.100),
                                 (x,y-.018,1.025,.071,.079)], [fabric],sides=14)
        ellipsoid('Folded sleeve cuff',(x,y-.01,1.052),(.085,.090,.058),white, tilt=side*.18)
        ellipsoid('Visible mitten hand',(x+side*.020,y-.038,.964),(.071,.072,.107),skin,tilt=-side*.28)
        ellipsoid('Thumb',(x-side*.021,y-.090,.992),(.035,.039,.052),skin,tilt=side*.47)
        line('Cuff braid',[(x-.074,y-.049,1.018),(x-.033,y-.094,1.032),(x+.044,y-.085,1.036),
                         (x+.069,y-.054,1.050)],.006,trim)


def dress_dragon(skin, cream, lavender, lilac, silvertone, gold, amethyst, skin_shade):
    ellipsoid('Neck',(0,-.019,1.521),(.141,.132,.216),skin_shade)
    loft('Tailored ivory bodice',[(.82,.255,.179,0),(1.008,.279,.178,0),(1.16,.263,.194,0),
                                 (1.34,.312,.223,0),(1.473,.316,.213,0),(1.56,.171,.145,0)],cream)
    loft('Pleated lavender dress',[(.521,.505,.301,.025),(.55,.499,.301,.029),(.68,.416,.259,.024),
                                  (.86,.325,.213,.016),(1.012,.263,.183,.005)],lavender,pleats=9)
    loft('Inner violet petticoat',[(.482,.479,.297,.012),(.517,.523,.314,.025),(.562,.490,.295,.024),
                                  (.619,.442,.270,.010)],lilac,pleats=9)
    ring('Thin embroidered skirt edge',.552,.512,.315,.012,gold,9,.014)
    ring('Hip sash',1.003,.270,.188,.032,lilac)
    ring('Sash piping',1.021,.276,.195,.008,gold)
    loft('White formal stand collar',[(1.411,.155,.150,0),(1.499,.162,.156,0),
                                      (1.565,.150,.145,0),(1.582,.156,.148,0)],cream,
         cut=lambda theta,z: .028*min(0,sin(theta)))
    ring('Stand collar base',1.505,.153,.150,.012,lavender,4,.016)
    ring('Silver high collar lace',1.578,.155,.146,.008,silvertone,4,.018)
    for side in (-1,1):
        line('High collar shaped ridgeline',[(side*.111,-.131,1.575),
             (side*.084,-.148,1.533),(side*.049,-.156,1.483)],.007,gold)
    arms(skin, lavender, cream, silvertone,False)
    lower_body(skin,cream,lilac,lavender,lilac,gold,False)
    for side in (-1,1):
        sweep('Ornate shoulder cape plate',[(side*.144,-.021,1.535,.065,.111),(side*.277,-.016,1.470,.154,.169),
                    (side*.379,-.018,1.371,.146,.134),(side*.430,-.018,1.332,.043,.046)],
              [cream],sides=14)
        line('Capelet front metal embroidery',[(side*.092,-.153,1.50),(side*.201,-.203,1.424),
                   (side*.336,-.177,1.359),(side*.421,-.095,1.326)],.011,silvertone)
        sweep('Capelet back hem',[(side*.079,.173,1.477,.089,.071),(side*.158,.188,1.372,.152,.063),
                    (side*.262,.188,1.271,.097,.039),(side*.301,.199,1.248,.005,.005)],
              [lavender,cream],sides=12)
        line('Bodice embroidered vine',[(side*.024,-.207,1.055),(side*.095,-.226,1.17),
                   (side*.149,-.226,1.279),(side*.191,-.201,1.377)],.008,lilac)
        for i in range(4):
            x=side*(.060+.035*i)
            z=1.083+.061*i
            sweep('Embroidery spray',[(x,-.223,z,.005,.005),(x+side*.040,-.232,z+.024,.013,.006),
                                      (x+side*.061,-.225,z+.061,.003,.002)],[lavender],sides=6)
    ornament('Amethyst breast brooch',0,-.240,1.409,.070,.083,amethyst,silvertone)
    line('Pendant chain',[(0,-.270,1.368),(.003,-.250,1.308),(.008,-.246,1.258)],.007,silvertone)
    ornament('Hanging amethyst',.008,-.251,1.271,.022,.030,amethyst,silvertone)


def dragon():
    skin = material('Ivory skin','#ffdecf')
    skin_shade = material('Warm neck study','#efbfb6')
    blush = material('Dragon cheek watercolor','#f3b4ba',.85)
    eyelash = material('Aubergine lashes','#36233f')
    brow = material('Lavender brows','#8e749f')
    white = material('Pearl eye','#fff9f3',.48)
    iris = material('Amethyst outer iris','#532878',.38)
    iris_light = material('Lilac prism iris','#b45ce5',.33)
    pupil = material('Deep plum pupil','#291534',.40)
    highlight = material('Eye glints','#fff5ff',.42,glow=.24)
    plum = material('Rose lip shadow','#8e3a4b')
    pink = material('Warm smile','#e98481')
    dark = material('Shaded silver hair','#8d769e',.55)
    base = material('Silver lavender hair','#dcd0e9',.51)
    mid = material('Silver hair crown','#f1e9f8',.50)
    shine = material('Frosted hair reflection','#f7f0ff',.51)
    horn = material('Dragon horn purple','#8050ab',.45)
    horn_ridge = material('Dragon horn ridge','#a66fce',.44)
    horn_dark = material('Dragon horn shadow','#553274',.52)
    cream = material('Pearl embroidered cloth','#ece4fa')
    lavender = material('Pale lilac silk','#c3a8de')
    lilac = material('Purple cloth piping','#8662b2')
    silver = material('Silvery antique filigree','#c7bdca',.33,.24)
    gold = material('Subtle warm braid','#d9c3ac',.39,.15)
    amethyst = material('Amethyst faceted stones','#8334cd',.27,.05)
    dress_dragon(skin,cream,lavender,lilac,silver,gold,amethyst,skin_shade)
    face = Face(1.933,.449,.409,.321,.12)
    face.head(skin)
    for s in (-1,1):
        outer = [(s*.299,1.824),(s*.418,1.814),(s*.686,2.025),(s*.421,1.976)]
        solid_shape('Dragon pointed ear outer',outer,-.254,.068,skin)
        solid_shape('Dragon pointed ear inner',[(s*.353,1.849),(s*.424,1.850),(s*.634,2.000),(s*.415,1.947)],-.294,.023,blush)
    face.detail(DRAGON,skin,blush,eyelash,brow,white,iris,iris_light,pupil,plum,pink,highlight)
    stylized_hair(face,dark,base,mid,shine,False)
    for s in (-1,1):
        controls = [(s*.349,.047,2.178,.120,.114),(s*.461,.073,2.278,.144,.134),
                    (s*.492,.093,2.368,.136,.125),(s*.448,.101,2.468,.117,.103),
                    (s*.402,.115,2.569,.083,.075),(s*.415,.125,2.666,.062,.049),
                    (s*.474,.131,2.736,.035,.027),(s*.561,.141,2.775,.003,.003)]
        sweep('Bent segmented amethyst horn',controls,[horn,horn_ridge,horn_dark],
              sides=9,steps=3,faceted=True,fluted=.13)
        for i in (1,2,3,4,5):
            x,y,z,r,d = controls[i]
            line('Faceted horn bands',[(x-r*.85,y-d*.35,z+.015),(x-r*.35,y-d*.89,z-.020),
                    (x+r*.35,y-d*.91,z+.020),(x+r*.75,y-d*.49,z+.032)],.007,horn_ridge)
    for i in range(7):
        t=i/6
        ellipsoid('Side braid',(-.265-t*.178,-.260+t*.047,2.329-t*.352),
                   (.061,.061,.075),base if i%2 else mid,segments=14,rings=9,tilt=-.66 if i%2 else -.2)
    ribbon('Side violet ribbon',-.459,-.259,2.049,.115,.059,lilac,silver,amethyst,True)
    ornament('Crown setting',-.459,-.290,2.098,.051,.062,amethyst,silver)
    for side in (-1,1):
        line('Four-prong amethyst filigree',[(side*.034-.459,-.309,2.101),(side*.065-.459,-.290,2.143),
                                           (side*.080-.459,-.276,2.119)],.010,silver)
    line('Side crystal chain',[(-.459,-.309,2.052),(-.486,-.296,1.999),(-.481,-.307,1.944)],.007,silver)
    ornament('Dropping side crystal',-.481,-.313,1.923,.023,.047,amethyst,silver)


def scalloped_apron(cream, pearl, gold):
    rows = [(1.139,.141,.223),(.996,.200,.211),(.850,.256,.257),
            (.675,.324,.320),(.553,.407,.369),(.503,.379,.370)]
    vertices, faces = [], []
    steps = 24
    for i, (z, width, depth) in enumerate(rows):
        for j in range(steps+1):
            angle = (2*j/steps-1)*1.025
            scallop = (-.017+.017*cos(j*pi/4)) if i == len(rows)-1 else 0
            vertices.append((sin(angle)*width,-cos(angle)*depth,z+scallop))
    for i in range(len(rows)-1):
        for j in range(steps):
            a = i*(steps+1)+j
            faces.append((a,a+steps+1,a+steps+2,a+1))
    obj = add_mesh('Contoured forward apron',vertices,faces,[cream])
    modifier = obj.modifiers.new('Rolled apron thickness','SOLIDIFY')
    modifier.thickness = .026
    line('Scalloped embroidered hem',vertices[-steps-1:],.009,pearl)
    for side in (-1,1):
        edge = [vertices[i*(steps+1)+(0 if side==-1 else steps)] for i in range(len(rows))]
        line('Edge stitch on the apron',[(x,y-.008,z) for x,y,z in edge],.008,gold)
    for i in range(1,8):
        x, y, z = vertices[-steps-1+i*3]
        ellipsoid('Apron pearl stitch',(x,y-.008,z+.023),(.010,.006,.010),pearl,segments=8,rings=6)


def wave_ruff(name, z, rx, ry, depth, width, waves, white, pale):
    vertices, faces = [], []
    steps = 72
    for radius in (.52,.75,1.0):
        for j in range(steps):
            t=TAU*j/steps
            folds=depth*(.7+.3*radius)*sin(waves*t)
            vertices.append((radius*rx*cos(t),radius*ry*sin(t),z+radius*width+folds))
    for k in range(2):
        for n in range(steps):
            faces.append((k*steps+n,k*steps+(n+1)%steps,(k+1)*steps+(n+1)%steps,(k+1)*steps+n))
    obj=add_mesh(name,vertices,faces,[white,pale],lambda i: 1 if i%6<2 else 0)
    thickness=obj.modifiers.new('Woven ruffle thickness','SOLIDIFY')
    thickness.thickness=.016
    ring(name+' front lace line',z+width,rx,ry,.005,pale,waves,depth)


def fluke(s, blue, aqua, ice, gold):
    x, z = s*.469, 2.160
    contour = [(-.011,-.066),(-.039,.004),(-.106,.029),(-.150,.077),
               (-.163,.139),(-.157,.172),(-.109,.138),(-.047,.141),
               (.006,.112),(.045,.170),(.113,.190),(.157,.244),
               (.166,.184),(.151,.122),(.115,.065),(.067,.023),(.021,-.056)]
    path = [(x+s*u,z+v) for u,v in contour]
    solid_shape('Sculpted gold edge whale fluke',path,-.295,.060,gold)
    patch = [(x+s*u*.892,z+.006+v*.90) for u,v in contour]
    solid_shape('Cobalt whale fluke silhouette',patch,-.332,.043,blue)
    near = [(-.011,-.056),(-.034,-.012),(-.113,.043),(-.142,.109),(-.111,.080),
            (-.061,.080),(-.016,.036),(.032,.063),(.104,.114),(.144,.169),
            (.122,.091),(.070,.041),(.017,-.054)]
    patch = [(x+s*u,z+v) for u,v in near]
    solid_shape('Aqua enamel tide motif',patch,-.357,.014,aqua)
    line('Glossy tide curves',[(x+s*u,-.370,z+v) for u,v in [(-.092,.062),(-.047,.065),
            (-.013,.038),(.003,.009),(.048,.067),(.099,.088),(.130,.123)]],.009,ice)
    for u,v,r in [(-.088,.105,.009),(-.055,.105,.006),(-.124,.117,.008),
                  (.079,.136,.006),(.120,.159,.009),(.043,.107,.007)]:
        ellipsoid('Moon stars on fluke',(x+s*u,-.366,z+v),(r,.005,r),ice,segments=8,rings=6)


def dress_whale(skin, warm_skin, navy, blue, cream, pale, gold, gem):
    ellipsoid('Neck',(0,-.034,1.535),(.139,.128,.219),warm_skin)
    loft('Cobalt fitted dress',[(.783,.264,.199,0),(.974,.269,.193,0),(1.115,.280,.198,0),
           (1.301,.333,.230,0),(1.451,.307,.210,0),(1.565,.151,.142,0)],navy)
    loft('Navy petal skirt',[(.394,.491,.333,.036),(.464,.531,.366,.036),
                            (.590,.461,.307,.024),(.756,.359,.245,.023),
                            (.982,.268,.187,.0)],navy,pleats=10,phase=.21,tilts=.025)
    loft('White underlayer',[(.389,.470,.317,.024),(.427,.534,.353,.034),
                            (.465,.506,.348,.021),(.575,.426,.298,.005)],
         cream,pleats=12,tilts=.019)
    ring('Gold skirt perimeter',.465,.552,.379,.009,gold,10,.012)
    ring('Dress waistband',.977,.283,.210,.024,blue)
    ring('Gilt waist lining',.992,.288,.215,.006,gold)
    scalloped_apron(cream,pale,gold)
    wave_ruff('Vertical collar lace',1.527,.165,.164,.024,.052,9,cream,pale)
    wave_ruff('Collar gathered cuff',1.497,.178,.179,.016,.023,11,cream,pale)
    arms(skin,navy,cream,gold,True)
    lower_body(skin,cream,blue,navy,navy,gold,True)
    for side in (-1,1):
        shoulder = [(side*.138,-.083,1.541),(side*.231,-.123,1.451),
                    (side*.282,-.176,1.329),(side*.287,-.215,1.214),
                    (side*.214,-.225,1.107)]
        sweep('Rolled ivory shoulder bib',
              [(*v,.070+.012*sin(i*2),.036+.009*cos(i*2)) for i,v in enumerate(shoulder)],
              [cream,pale],sides=12,fluted=.24)
        line('Bib lace piping',[(x+side*.025,y-.035,z+.011) for x,y,z in shoulder],.009,gold)
        for i in range(4):
            x = side*(.244+.023*i)
            z=1.450-.061*i
            ellipsoid('Raised scalloped shoulder frill',(x,-.119-.020*i,z),(.101,.052,.043),
                      cream,segments=16,rings=10,tilt=-side*.95)
        for z in (1.184,1.265):
            ellipsoid('Antique-gold nautical button',(side*.110,-.233,z),(.026,.022,.026),
                      gold,segments=12,rings=8)
        line('Gold seam on bodice',[(side*.083,-.211,.995),(side*.159,-.221,1.147),
                                    (side*.166,-.221,1.301),(side*.215,-.198,1.435)],.007,gold)
    # Scalloped layered jabot and stone crest distinguish this costume from
    # Dragon's tall collar and angular cape plates.
    for i,(z,w) in enumerate([(1.457,.161),(1.389,.141),(1.318,.108)]):
        sweep('Triple-layer chest jabot', [(-w,-.224,z+.051,.019,.020),(-w*.59,-.253,z+.010,.041,.024),
               (0,-.268,z-.027,.043,.025),(w*.63,-.249,z+.004,.044,.025),(w,-.225,z+.045,.017,.017)],
              [cream,pale],sides=8,fluted=.22)
    ribbon('Cobalt cravat',0,-.293,1.454,.120,.050,blue,gold,gem,True)
    ellipsoid('Oval antique-gold sapphire setting',(0,-.321,1.466),(.037,.031,.048),
              gold,segments=20,rings=10)
    ellipsoid('Oval sapphire cabochon',(0,-.348,1.468),(.027,.013,.038),
              gem,segments=18,rings=9)
    ornament('Small sapphire pendant',.005,-.314,1.348,.020,.032,gem,gold)
    ribbon('Ivory back apron sash',0,.243,.981,.235,.091,cream,gold,gem,True)


def whale():
    skin = material('Porcelain skin','#ffdace')
    warm = material('Warm porcelain neck','#eebdb3')
    blush = material('Peach flushed cheeks','#f1aba8',.80)
    eye_dark = material('Ink lashes','#192234')
    brow = material('Indigo brows','#4a4970')
    pearl = material('Pearl reflection','#fff9f3',.45)
    iris = material('Ocean eye outline','#194e91',.39)
    iris_light = material('Turquoise iris facets','#3ebdf5',.30)
    pupil = material('Midnight blue pupil','#0a1d44')
    glint = material('Tide reflection','#fff7eb',.38,glow=.23)
    lip = material('Rosewood mouth','#9c414d')
    lip_light = material('Coral smile','#f9938f')
    dark = material('Indigo hair shadow','#14254f',.53)
    navy = material('Layered cobalt hair','#263f82',.46)
    mid = material('Blue hair lights','#3a569d',.45)
    shine = material('Blue streak light','#7cacdf',.45)
    fabric = material('Midnight navy dress','#172c5d')
    blue = material('Pleated smalt ribbon','#234b9a',.55)
    cream = material('Ivory lace fabric','#f5f2f7')
    pale = material('Lace satin shadow','#b4b6cf')
    rust_gold = material('Champagne gold trims','#d9af61',.40,.25)
    gem = material('Aqua sapphire','#1c88dd',.23,.19)
    electric = material('Blue fluke enamel','#1554a6',.32,.08)
    cyan = material('Light tide enamel','#6acef2',.44)
    dress_whale(skin,warm,fabric,blue,cream,pale,rust_gold,gem)
    face = Face(1.934,.446,.397,.319,.09)
    face.head(skin)
    for s in (-1,1):
        ellipsoid('Round visible ear',(s*.372,-.055,1.883),(.082,.058,.095),skin,tilt=-s*.24)
        ellipsoid('Inner ear blush',(s*.405,-.100,1.881),(.039,.023,.067),blush,tilt=-s*.29)
    face.detail(WHALE,skin,blush,eye_dark,brow,pearl,iris,iris_light,pupil,lip,lip_light,glint)
    stylized_hair(face,dark,navy,mid,shine,True)
    # Puffed pleats on a half wreath, with a solid thickness visible from rear.
    arcs = []
    for i in range(13):
        t = .12*pi+.76*pi*i/12
        x, z = .473*cos(t),2.115+.431*sin(t)
        ellipsoid('Raised crown lace pleat',(x,-.011,z),(.072,.072,.090),
                  cream if i%3 else pale,segments=16,rings=10,tilt=-(t-pi/2)*.88)
        ellipsoid('Raised pearl along lace',(x,-.081,z+.032),(.023,.016,.019),
                  pearl,segments=12,rings=7)
        arcs.append((x,-.086,z-.044))
    line('Rounded scalloped lace band',arcs,.027,cream)
    line('Navy contrast beneath lace',[(x,y+.021,z-.030) for x,y,z in arcs],.010,dark)
    for s in (-1,1):
        fluke(s,electric,cyan,pearl,rust_gold)
        ribbon('Side nautical bow',s*.483,-.347,2.102,.097,.083,blue,rust_gold,gem,True)
        # Longer light-blue polished tips remain readable behind the shoulders.
        sweep('Ocean-blue floating shoulder curl',
              [(s*.444,-.050,1.970,.059,.045),(s*.466,-.087,1.673,.078,.045),
               (s*.398,-.251,1.365,.086,.037),(s*.470,-.298,1.197,.072,.041),
               (s*.550,-.246,.997,.057,.022),(s*.483,-.247,.887,.004,.005)],
              [mid,shine,navy],sides=11,fluted=.10)


def finish_mesh(key):
    components = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in components:
        if obj.modifiers:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)
    for obj in components:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = components[0]
    bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    mesh.name = key
    mesh.data.name = key + ' desktop figure'
    mesh.data.calc_loop_triangles()
    return mesh, len(mesh.data.loop_triangles), len(components)


def export_model(key, output):
    mesh, triangles, parts = finish_mesh(key)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
                              use_selection=True, export_texcoords=False,
                              export_tangents=False, export_extras=False, export_yup=True)
    return {'character': key, 'bytes': output.stat().st_size, 'triangles': triangles,
            'parts': parts, 'bounds': [list(mesh.dimensions), list(mesh.location)]}


def look_at(obj, location):
    obj.rotation_euler = (Vector(location)-obj.location).to_track_quat('-Z','Y').to_euler()


def area(name, position, energy, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = energy, 'DISK', size, color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    look_at(obj, (0, 0, 1.55))


def render_turntable(key, folder):
    scene = bpy.context.scene
    data = bpy.data.cameras.new('Orthographic proof')
    data.type, data.ortho_scale = 'ORTHO', 3.17
    camera = bpy.data.objects.new('Orthographic proof', data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    area('Warm key',(-3.2,-4.8,5.1),530,4.0,(1.0,.92,.86))
    area('Soft fill',(3.6,-2.2,3.2),365,3.2,(.86,.92,1.0))
    area('Cool rim',(.6,3.1,3.9),425,3.0,(.73,.84,1.0))
    lighter = bpy.data.worlds.new('Graphite showcase')
    scene.world = lighter
    lighter.use_nodes = True
    lighter.node_tree.nodes['Background'].inputs['Color'].default_value = (.062,.070,.086,1)
    lighter.node_tree.nodes['Background'].inputs['Strength'].default_value = .56
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x, scene.render.resolution_y = 430, 430
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = True
    for name, position in [('front',(0,-5,1.52)),('quarter',(3.1,-4.3,1.56)),
                           ('side',(5,0,1.52)),('rear',(0,5,1.52)),
                           ('desktop-front',(0,-5,1.52)),('desktop-quarter',(3.1,-4.3,1.56))]:
        pixels = 208 if name.startswith('desktop') else 430
        scene.render.resolution_x, scene.render.resolution_y = pixels, pixels
        camera.location = position
        look_at(camera, (0,0,1.38))
        scene.render.filepath = str(folder / f'{key}-{name}.png')
        bpy.ops.render.render(write_still=True)


def main():
    parser = ArgumentParser()
    parser.add_argument('--character', choices=(DRAGON,WHALE,'all'), default='all')
    parser.add_argument('--preview-dir', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    models = ROOT / 'src' / 'assets' / 'pets'
    models.mkdir(parents=True, exist_ok=True)
    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
    result = []
    for key in ((DRAGON,WHALE) if args.character=='all' else (args.character,)):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        if key == DRAGON:
            dragon()
        else:
            whale()
        result.append(export_model(key,models/(key+'.glb')))
        if args.preview_dir:
            render_turntable(key,args.preview_dir)
    print('DESKTOP_PET_EXPORT ' + json.dumps(result, sort_keys=True))
    if args.preview_dir:
        label='dragon-whale' if args.character=='all' else args.character
        (args.preview_dir / (label+'-mesh.json')).write_text(json.dumps(result,indent=2)+'\n')


if __name__ == '__main__':
    main()
