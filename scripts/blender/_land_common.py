"""陸戰資產共用工具（Blender 4.5 / bpy + bmesh）。

慣例（依 docs/asset-pipeline-spec.md §0.4）：
  * Blender 內以 Z 為上、**+Y 為模型正面**；glTF 匯出 (export_yup) 會把
    Blender +Z -> glTF +Y、Blender +Y -> glTF -Z，故成品即「Y 上、-Z 前」。
  * 單位公尺，原點在底部中心（z=0 為地面）。

本檔由 blender-land 代理建立，與海戰代理的 `_common.py` 互不干擾。
"""

import bpy
import bmesh
import math
import os
import sys

from mathutils import Vector, Matrix, Euler

TAU = math.pi * 2.0
R = math.radians


# ---------------------------------------------------------------- 參數 / 路徑

def _argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def arg(flag, default=None):
    a = _argv()
    if flag in a:
        i = a.index(flag)
        if i + 1 < len(a):
            return a[i + 1]
    return default


def out_dir():
    d = os.path.abspath(arg('--out', 'public/models'))
    os.makedirs(d, exist_ok=True)
    return d


def prev_dir():
    d = os.path.abspath(arg('--prev', 'assets-src/previews'))
    os.makedirs(d, exist_ok=True)
    return d


# ---------------------------------------------------------------- 顏色 / 材質

def srgb(h):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (f(r), f(g), f(b))


MATDEF = {}


def defmat(name, hexc, rough=0.85, metal=0.0):
    MATDEF[name] = (hexc, rough, metal)


def defmats(d):
    for k, v in d.items():
        defmat(k, *v) if isinstance(v, (list, tuple)) else defmat(k, v)


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexc, rough, metal = MATDEF.get(name, ('#8a8a8a', 0.85, 0.0))
    col = srgb(hexc)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (col[0], col[1], col[2], 1.0)
    m.roughness = rough
    m.metallic = metal
    return m


# 陸戰共用色盤
defmats({
    # 美軍傘兵
    'us_uniform':  ('#57583a', 0.92),   # M42 跳傘服 橄欖褐
    'us_helmet':   ('#4a4f3c', 0.85),   # M1 鋼盔 OD
    'us_webbing':  ('#80764f', 0.92),   # 帆布背具 卡其
    'us_boots':    ('#4b3527', 0.80),   # 跳傘靴 皮革
    # 德軍
    'de_uniform':  ('#6b6f5d', 0.92),   # 野戰灰
    'de_helmet':   ('#565b4d', 0.82),   # M35
    'de_webbing':  ('#2b2723', 0.65),   # 黑皮裝具
    'de_boots':    ('#241f1c', 0.62),
    'snow':        ('#e2e6e9', 0.92),   # 雪地偽裝 / 雪蓋
    # 共用
    'skin':        ('#b98a66', 0.72),
    'gunmetal':    ('#2e2f31', 0.42, 0.85),
    'wood':        ('#6b4a2c', 0.80),
    'wood_pale':   ('#9c7a4e', 0.85),
    'steel':       ('#4a4d50', 0.45, 0.80),
    'rubber':      ('#1e1e20', 0.92),
    'olive':       ('#4e5535', 0.88),   # 美軍載具
    'panzer_grey': ('#5c6158', 0.88),   # 德軍載具
    'canvas':      ('#7a7358', 0.95),
    'stone':       ('#a89b86', 0.94),
    'stone_dark':  ('#8a7f6d', 0.94),
    'plaster':     ('#c8bda6', 0.94),
    'roof_tile':   ('#8a4a34', 0.90),
    'roof_slate':  ('#4e5258', 0.86),
    'timber':      ('#54402c', 0.88),
    'charred':     ('#242220', 0.95),
    'sandbag':     ('#7b7148', 0.96),
    'dirt':        ('#6a5740', 0.97),
    'metal_dark':  ('#33352f', 0.70, 0.60),
    'glass':       ('#2b3338', 0.20, 0.30),
    'white':       ('#dfe2e4', 0.90),
    'red':         ('#7a2622', 0.88),
    'gold':        ('#8a7530', 0.40, 0.70),
})


# ---------------------------------------------------------------- 場景

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0


# ---------------------------------------------------------------- 幾何小工具

def circle(r, n=8, phase=0.0, rz=None):
    """半徑 r 的 n 邊形（XY 平面、CCW、z=0）。rz 可給橢圓的 y 半徑。"""
    ry = rz if rz is not None else r
    return [(r * math.cos(phase + TAU * i / n), ry * math.sin(phase + TAU * i / n), 0.0)
            for i in range(n)]


def superellipse(w, d, n=12, e=4.0, phase=0.0):
    """圓角矩形斷面（寬 w、深 d）。e=2 為橢圓，越大越方。"""
    pts = []
    for i in range(n):
        t = phase + TAU * i / n
        c, s = math.cos(t), math.sin(t)
        x = (w / 2) * math.copysign(abs(c) ** (2.0 / e), c)
        y = (d / 2) * math.copysign(abs(s) ** (2.0 / e), s)
        pts.append((x, y, 0.0))
    return pts


def at(ring, z=0.0, dx=0.0, dy=0.0, sx=1.0, sy=1.0):
    """把斷面擺到高度 z、平移、縮放。"""
    return [(p[0] * sx + dx, p[1] * sy + dy, z) for p in ring]


def lerp(a, b, t):
    return a + (b - a) * t


def vlerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ---------------------------------------------------------------- Builder

class B:
    """把許多零件堆進同一個 bmesh，最後產出一個物件。"""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []
        self._mi = {}

    # -- 內部 --------------------------------------------------------
    def mi(self, name):
        if name not in self._mi:
            self._mi[name] = len(self.mats)
            self.mats.append(name)
        return self._mi[name]

    def add(self, vlist, flist, m='steel', smooth=False,
            loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), pivot=(0, 0, 0)):
        mtx = (Matrix.Translation(Vector(loc))
               @ Euler(rot, 'XYZ').to_matrix().to_4x4()
               @ Matrix.Diagonal(Vector(scale)).to_4x4())
        pv = Vector(pivot)
        mi = self.mi(m)
        bv = [self.bm.verts.new(mtx @ (Vector(v) - pv)) for v in vlist]
        out = []
        for f in flist:
            try:
                face = self.bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            face.material_index = mi
            face.smooth = smooth
            out.append(face)
        return out

    # -- 基本形 ------------------------------------------------------
    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), m='steel',
            anchor='center', pivot=(0, 0, 0), smooth=False):
        sx, sy, sz = size
        dz = sz / 2.0 if anchor == 'bottom' else (-sz / 2.0 if anchor == 'top' else 0.0)
        v = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
             (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
        v = [(x * sx / 2, y * sy / 2, z * sz / 2 + dz) for (x, y, z) in v]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        return self.add(v, f, m, smooth, loc, rot, (1, 1, 1), pivot)

    def wedge(self, size, loc=(0, 0, 0), rot=(0, 0, 0), m='steel',
              anchor='bottom', top_front=0.0, top_back=0.0, smooth=False):
        """楔形：上緣沿 Y 方向內縮（top_front 縮前緣 +Y、top_back 縮後緣 -Y）。"""
        sx, sy, sz = size
        dz = sz / 2.0 if anchor == 'bottom' else 0.0
        y0, y1 = -sy / 2, sy / 2
        ty0, ty1 = y0 + top_back, y1 - top_front
        v = [(-sx / 2, y0, -sz / 2 + dz), (sx / 2, y0, -sz / 2 + dz),
             (sx / 2, y1, -sz / 2 + dz), (-sx / 2, y1, -sz / 2 + dz),
             (-sx / 2, ty0, sz / 2 + dz), (sx / 2, ty0, sz / 2 + dz),
             (sx / 2, ty1, sz / 2 + dz), (-sx / 2, ty1, sz / 2 + dz)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        return self.add(v, f, m, smooth, loc, rot)

    def loft(self, rings, m='steel', smooth=False, cap_start=True, cap_end=True,
             loc=(0, 0, 0), rot=(0, 0, 0), pivot=(0, 0, 0), closed=True):
        """rings：由「前進方向」看去為 CCW 的等長斷面串列。"""
        n = len(rings[0])
        verts = []
        for rg in rings:
            verts.extend(rg)
        faces = []
        for i in range(len(rings) - 1):
            a = i * n
            b = (i + 1) * n
            lim = n if closed else n - 1
            for j in range(lim):
                k = (j + 1) % n
                faces.append((a + j, a + k, b + k, b + j))
        if cap_start:
            faces.append(tuple(range(n - 1, -1, -1)))
        if cap_end:
            o = (len(rings) - 1) * n
            faces.append(tuple(range(o, o + n)))
        return self.add(verts, faces, m, smooth, loc, rot, (1, 1, 1), pivot)

    def tube(self, p0, p1, r0, r1, n=8, m='steel', smooth=True,
             caps=True, oval=1.0, phase=0.0):
        """兩點之間的錐柱（肢體、砲管、柱子）。oval 為次軸比例。"""
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0)
        L = ax.length
        if L < 1e-6:
            return []
        ax = ax / L
        up = Vector((0, 0, 1)) if abs(ax.z) < 0.95 else Vector((0, 1, 0))
        t = up.cross(ax).normalized()
        b = ax.cross(t)
        rings = []
        for (p, r) in ((p0, r0), (p1, r1)):
            rg = []
            for i in range(n):
                a = phase + TAU * i / n
                rg.append(tuple(p + t * (r * math.cos(a)) + b * (r * oval * math.sin(a))))
            rings.append(rg)
        return self.loft(rings, m, smooth, caps, caps)

    def lathe(self, profile, n=12, m='steel', smooth=True, loc=(0, 0, 0),
              rot=(0, 0, 0), rfun=None, zfun=None, cap_bottom=True, oval=1.0):
        """profile：由上到下的 (r, z)。rfun(theta,i)/zfun(theta,i) 可做非軸對稱。"""
        rings = []
        pole_top = profile[0][0] < 1e-6
        pole_bot = profile[-1][0] < 1e-6
        body = profile[1:] if pole_top else profile
        body = body[:-1] if pole_bot else body
        for i, (r, z) in enumerate(body):
            rg = []
            for j in range(n):
                th = TAU * j / n
                rr = r * (rfun(th, i, len(body)) if rfun else 1.0)
                zz = z + (zfun(th, i, len(body)) if zfun else 0.0)
                rg.append((rr * math.cos(th), rr * oval * math.sin(th), zz))
            rings.append(rg)
        # 由下往上排（前進方向 +Z）
        rings = rings[::-1]
        verts = []
        for rg in rings:
            verts.extend(rg)
        faces = []
        for i in range(len(rings) - 1):
            a, b = i * n, (i + 1) * n
            for j in range(n):
                k = (j + 1) % n
                faces.append((a + j, a + k, b + k, b + j))
        if pole_bot:
            idx = len(verts)
            verts.append((0, 0, profile[-1][1]))
            for j in range(n):
                faces.append((j, (j + 1) % n, idx))
        elif cap_bottom:
            faces.append(tuple(range(n - 1, -1, -1)))
        if pole_top:
            idx = len(verts)
            verts.append((0, 0, profile[0][1]))
            o = (len(rings) - 1) * n
            for j in range(n):
                faces.append((o + (j + 1) % n, o + j, idx))
        else:
            o = (len(rings) - 1) * n
            faces.append(tuple(range(o, o + n)))
        return self.add(verts, faces, m, smooth, loc, rot)

    def beam(self, p0, p1, w, h, m='steel', up=(0, 0, 1), smooth=False,
             ext=(0.0, 0.0), w1=None, h1=None, roll=0.0):
        """兩點之間的矩形樑（皮帶、支架、槍托）。w 沿側向、h 沿 up。"""
        p0, p1 = Vector(p0), Vector(p1)
        ax = p1 - p0
        L = ax.length
        if L < 1e-6:
            return []
        ax = ax / L
        upv = Vector(up)
        t = upv.cross(ax)
        if t.length < 1e-5:
            t = Vector((1, 0, 0)).cross(ax)
        t.normalize()
        u = ax.cross(t)
        if roll:
            ca, sa = math.cos(roll), math.sin(roll)
            t, u = t * ca + u * sa, u * ca - t * sa
        a = p0 - ax * ext[0]
        bb = p1 + ax * ext[1]
        w1 = w if w1 is None else w1
        h1 = h if h1 is None else h1
        rings = []
        for (p, ww, hh) in ((a, w, h), (bb, w1, h1)):
            rings.append([tuple(p + t * (sx * ww / 2) + u * (sy * hh / 2))
                          for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        return self.loft(rings, m, smooth, True, True)

    def sphere(self, r, loc=(0, 0, 0), n=10, rows=5, m='steel', smooth=True,
               scale=(1, 1, 1), rot=(0, 0, 0)):
        prof = [(0.0, r)]
        for i in range(1, rows):
            a = math.pi * i / rows
            prof.append((r * math.sin(a), r * math.cos(a)))
        prof.append((0.0, -r))
        return self.lathe(prof, n, m, smooth, loc, rot, oval=1.0) if scale == (1, 1, 1) \
            else self._scaled_lathe(prof, n, m, smooth, loc, rot, scale)

    def _scaled_lathe(self, prof, n, m, smooth, loc, rot, scale):
        prof2 = [(r * scale[0], z * scale[2]) for (r, z) in prof]
        return self.lathe(prof2, n, m, smooth, loc, rot, oval=scale[1] / scale[0])

    def prism(self, pts2d, thickness, m='steel', smooth=False,
              loc=(0, 0, 0), rot=(0, 0, 0), center=True):
        """把 XY 平面的 CCW 多邊形沿 +Z 擠出 thickness。"""
        dz = -thickness / 2.0 if center else 0.0
        a = [(p[0], p[1], dz) for p in pts2d]
        b = [(p[0], p[1], dz + thickness) for p in pts2d]
        return self.loft([a, b], m, smooth, True, True, loc, rot)

    def band(self, outline, x=0.0, width=0.4, thick=0.10, m='steel', smooth=False):
        """履帶：outline 為 (y, z) 的 CCW 封閉折線，沿 X 擠成有厚度的環帶。"""
        n = len(outline)
        rings = []
        Xv = Vector((1, 0, 0)) * (width / 2)
        for i in range(n + 1):
            j = i % n
            p0, p1, p2 = outline[(j - 1) % n], outline[j], outline[(j + 1) % n]
            ty, tz = (p2[0] - p0[0]), (p2[1] - p0[1])
            L = math.hypot(ty, tz) or 1.0
            ty, tz = ty / L, tz / L
            Nv = Vector((0, tz, -ty)) * (thick / 2)
            P = Vector((x, p1[0], p1[1]))
            rings.append([tuple(P + Nv + Xv), tuple(P + Nv - Xv),
                          tuple(P - Nv - Xv), tuple(P - Nv + Xv)])
        return self.loft(rings, m, smooth, False, False)

    def plane(self, size, loc=(0, 0, 0), rot=(0, 0, 0), m='steel', smooth=False):
        sx, sy = size
        v = [(-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0),
             (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0)]
        return self.add(v, [(0, 1, 2, 3)], m, smooth, loc, rot)

    # -- 完成 --------------------------------------------------------
    def finish(self, name, uv_scale=1.0, sharp_angle=38.0, weld=1e-4):
        bm = self.bm
        if weld:
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=weld)
        bm.normal_update()
        # 自動平滑：相鄰面夾角大於閾值的邊標記銳邊
        thr = math.radians(sharp_angle)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                f1, f2 = e.link_faces
                if f1.smooth and f2.smooth:
                    try:
                        e.smooth = f1.normal.angle(f2.normal) < thr
                    except ValueError:
                        e.smooth = True
                else:
                    e.smooth = False
        # 平面 UV（以公尺為單位平鋪；牆面沿水平、屋頂沿斜面）
        uvl = bm.loops.layers.uv.verify()
        up = Vector((0, 0, 1))
        for f in bm.faces:
            nrm = f.normal
            if nrm.length < 1e-8:
                continue
            if abs(nrm.z) > 0.94:
                tx = Vector((1, 0, 0))
            else:
                tx = up.cross(nrm).normalized()
            ty = nrm.cross(tx).normalized()
            for l in f.loops:
                co = l.vert.co
                l[uvl].uv = (co.dot(tx) / uv_scale, co.dot(ty) / uv_scale)

        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for mn in self.mats:
            me.materials.append(material(mn))
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- 物件工具

def tris(ob):
    if ob.type != 'MESH':
        return 0
    return sum(max(0, len(p.vertices) - 2) for p in ob.data.polygons)


def total_tris(objs):
    return sum(tris(o) for o in objs)


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), size=0.08, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = size
    e.location = loc
    e.rotation_euler = Euler(rot, 'XYZ')
    bpy.context.collection.objects.link(e)
    if parent:
        setparent(e, parent)
    return e


def setparent(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    if lo.x > 1e8:
        return Vector((0, 0, 0)), Vector((1, 1, 1))
    return lo, hi


# ---------------------------------------------------------------- 匯出

def export(objs, name, out=None, verbose=True):
    out = out or out_dir()
    path = os.path.join(out, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    meshes = [o for o in objs if o.type == 'MESH']
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True,
              export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False,
              export_extras=False, export_animations=False,
              export_draco_mesh_compression_enable=True,
              export_draco_mesh_compression_level=6)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop('export_draco_mesh_compression_level', None)
        bpy.ops.export_scene.gltf(**kw)
    n = total_tris(meshes)
    if verbose:
        kb = os.path.getsize(path) / 1024.0
        print('[GLB] %-28s %6.1f KB  %5d tris' % (name + '.glb', kb, n))
    return path, n


# ---------------------------------------------------------------- 預覽渲染

def _aim(cam, target):
    d = Vector(cam.location) - Vector(target)
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()


def render(objs, name, prev=None, size=(768, 512), yaw=38.0, pitch=20.0,
           zoom=1.12, bg='#3b4048', lens=52.0, ortho=False, center=None,
           engine=None):
    """3/4 前方視角預覽。模型正面為 Blender +Y，相機放在 +Y/+X 上方。"""
    prev = prev or prev_dir()
    bpy.context.view_layer.update()
    sc = bpy.context.scene
    eng = engine or arg('--engine', 'WORKBENCH')

    lo, hi = bbox(objs)
    ctr = Vector(center) if center else (lo + hi) / 2.0
    rad = max((hi - lo).length / 2.0, 0.25)

    y, p = math.radians(yaw), math.radians(pitch)
    dirv = Vector((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)))
    fwd = -dirv
    rgt = fwd.cross(Vector((0, 0, 1)))
    rgt = rgt.normalized() if rgt.length > 1e-6 else Vector((1, 0, 0))
    upv = rgt.cross(fwd).normalized()

    cam_data = bpy.data.cameras.new('prev_cam')
    cam = bpy.data.objects.new('prev_cam', cam_data)
    bpy.context.collection.objects.link(cam)
    corners = [Vector((x, yy, z)) for x in (lo.x, hi.x)
               for yy in (lo.y, hi.y) for z in (lo.z, hi.z)]
    if ortho:
        cam_data.type = 'ORTHO'
        ex = max(abs((c - ctr).dot(rgt)) for c in corners)
        ey = max(abs((c - ctr).dot(upv)) for c in corners)
        cam_data.ortho_scale = max(ex * 2, ey * 2 * size[0] / size[1]) * zoom
        dist = rad * 6
    else:
        cam_data.lens = lens
        cam_data.sensor_width = 36.0
        th = math.atan(36.0 / 2.0 / lens)
        tv = math.atan((36.0 * size[1] / size[0]) / 2.0 / lens)
        dist = rad
        for c in corners:
            v = c - ctr
            d0 = v.dot(dirv)
            dist = max(dist,
                       d0 + abs(v.dot(rgt)) / math.tan(th),
                       d0 + abs(v.dot(upv)) / math.tan(tv))
        dist *= zoom
    cam.location = ctr + dirv * dist
    _aim(cam, ctr)
    sc.camera = cam

    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    path = os.path.join(prev, name + '.png')
    sc.render.filepath = path

    if eng == 'WORKBENCH':
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.studio_light = 'Default'
        sh.color_type = 'MATERIAL'
        sh.show_shadows = True
        sh.shadow_intensity = 0.45
        sh.show_cavity = True
        sh.cavity_type = 'BOTH'
        sh.curvature_ridge_factor = 1.4
        sh.curvature_valley_factor = 1.2
        sh.show_specular_highlight = True
        c = srgb(bg)
        w = bpy.data.worlds.new('prev_world')
        w.use_nodes = True
        bgn = w.node_tree.nodes.get('Background')
        if bgn:
            bgn.inputs[0].default_value = (c[0], c[1], c[2], 1)
        w.color = c
        sc.world = w
        try:
            sh.background_type = 'WORLD'
        except Exception:
            pass
        sc.display.render_aa = '16'
    else:
        sc.render.engine = 'BLENDER_EEVEE_NEXT' if eng == 'EEVEE' else 'CYCLES'
        if eng != 'EEVEE':
            sc.cycles.samples = 24
        w = bpy.data.worlds.new('prev_world')
        w.use_nodes = True
        bgn = w.node_tree.nodes.get('Background')
        if bgn:
            c = srgb(bg)
            bgn.inputs[0].default_value = (c[0], c[1], c[2], 1)
            bgn.inputs[1].default_value = 1.6
        sc.world = w
        sun = bpy.data.lights.new('sun', 'SUN')
        sun.energy = 4.0
        sun.angle = math.radians(6)
        so = bpy.data.objects.new('sun', sun)
        bpy.context.collection.objects.link(so)
        so.rotation_euler = Euler((math.radians(52), 0, math.radians(-135 + yaw)), 'XYZ')
        fill = bpy.data.lights.new('fill', 'SUN')
        fill.energy = 1.2
        fo = bpy.data.objects.new('fill', fill)
        bpy.context.collection.objects.link(fo)
        fo.rotation_euler = Euler((math.radians(70), 0, math.radians(70 + yaw)), 'XYZ')

    bpy.ops.render.render(write_still=True)
    print('[PNG] %s' % path)
    return path


def ground(size=40.0, z=0.0, m='dirt'):
    """預覽用地面（不匯出）。"""
    b = B()
    b.plane((size, size), loc=(0, 0, z), m=m)
    return b.finish('prev_ground', uv_scale=1.0)
