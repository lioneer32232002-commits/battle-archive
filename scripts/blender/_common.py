"""戰史檔案館 — Blender 程序化建模共用工具（Blender 4.5 LTS）

海戰與陸戰腳本共用。API 求簡單穩定，不要隨意改既有函式簽名。

座標約定
  Blender 內：+Z 上、+Y 為「前」（艦艏／車頭／人臉朝向）、公尺。
  glTF 匯出時 exporter 會轉成 Y 上、-Z 前（export_yup=True），
  所以在 Blender 裡照 +Y 前面建即可，輸出自動符合規格 §0.4。
  船艦原點放在水線中心（Z=0 為水線）；陸戰物件原點放底部中心。

典型用法
    import sys, os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import _common as C

    args = C.parse_args()
    C.reset_scene()
    ...建模...
    C.finish([obj], "yamato", args)
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# --------------------------------------------------------------------------
# 路徑與參數
# --------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))


def project_root():
    """<root>/scripts/blender/_common.py -> <root>"""
    return os.path.abspath(os.path.join(_HERE, "..", ".."))


def abspath(p):
    return p if os.path.isabs(p) else os.path.join(project_root(), p)


def parse_args(default_out="public/models", default_preview="assets-src/previews"):
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=default_out, help="glb 輸出目錄")
    p.add_argument("--preview", default=default_preview, help="預覽 PNG 目錄")
    p.add_argument("--no-preview", action="store_true")
    p.add_argument("--no-draco", action="store_true")
    p.add_argument("--only", default=None, help="只做這個變體（腳本自行解讀）")
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    return sc


# --------------------------------------------------------------------------
# 顏色與材質
# --------------------------------------------------------------------------

def srgb(r, g, b):
    """0-255 的 sRGB 轉線性 float，讓填的顏色跟眼睛看到的一致。"""
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


def hexcol(h):
    h = h.lstrip("#")
    return srgb(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def new_mat(name, color, roughness=0.6, metallic=0.0, emission=None,
            emission_strength=1.0, alpha=1.0):
    """Principled BSDF 材質。color 是線性 RGB（用 srgb()/hexcol() 產生）。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], alpha)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission is not None:
            ec = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            if ec:
                ec.default_value = (emission[0], emission[1], emission[2], 1.0)
            es = bsdf.inputs.get("Emission Strength")
            if es:
                es.default_value = emission_strength
    # Workbench 預覽用
    m.diffuse_color = (color[0], color[1], color[2], alpha)
    m.roughness = roughness
    m.metallic = metallic
    return m


def new_image(name, w, h, fn):
    """以 fn(u, v) -> (r,g,b) 線性色 產生一張小貼圖並存檔（GLB 會內嵌）。"""
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = [0.0] * (w * h * 4)
    for yy in range(h):
        v = yy / max(1, h - 1)
        for xx in range(w):
            u = xx / max(1, w - 1)
            r, g, b = fn(u, v)
            i = (yy * w + xx) * 4
            px[i] = r
            px[i + 1] = g
            px[i + 2] = b
            px[i + 3] = 1.0
    img.pixels[:] = px
    tmp = os.path.join(project_root(), "assets-src", "blender-tex")
    os.makedirs(tmp, exist_ok=True)
    img.filepath_raw = os.path.join(tmp, name + ".png")
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def image_mat(name, img, roughness=0.7, metallic=0.0, viewport_color=(0.5, 0.5, 0.5),
              interpolation="Linear"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = interpolation
    tex.location = (-400, 0)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    m.diffuse_color = (viewport_color[0], viewport_color[1], viewport_color[2], 1.0)
    m.roughness = roughness
    m.metallic = metallic
    return m


def set_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def add_mat(obj, mat):
    """附加材質槽，回傳索引（已存在就回傳既有索引）。"""
    for i, m in enumerate(obj.data.materials):
        if m == mat:
            return i
    obj.data.materials.append(mat)
    return len(obj.data.materials) - 1


def assign_mat_where(obj, mat, pred):
    """pred(center: Vector, normal: Vector) -> bool，對符合的面指派材質。"""
    idx = add_mat(obj, mat)
    for p in obj.data.polygons:
        if pred(p.center, p.normal):
            p.material_index = idx
    return idx


def assign_mat_by_height(obj, mat, zmin=-1e9, zmax=1e9):
    return assign_mat_where(obj, mat, lambda c, n: zmin <= c.z <= zmax)


def assign_mat_top(obj, mat, min_dot=0.8, zmin=-1e9):
    return assign_mat_where(obj, mat, lambda c, n: n.z >= min_dot and c.z >= zmin)


# --------------------------------------------------------------------------
# 基本量體
# --------------------------------------------------------------------------

def _link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def _from_bmesh(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    o = _link(bpy.data.objects.new(name, me))
    if mat is not None:
        o.data.materials.append(mat)
    return o


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    """原點在中心的長方體。size=(x,y,z) 是總尺寸。"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = _from_bmesh(name, bm, mat)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


def taper_box(name, bottom, top, h, loc=(0, 0, 0), rot=(0, 0, 0), mat=None,
              top_offset=(0.0, 0.0)):
    """上下不同寬的四方錐台。**原點在底面中心**。bottom/top=(x,y) 總尺寸。"""
    bx, by = bottom[0] / 2.0, bottom[1] / 2.0
    tx, ty = top[0] / 2.0, top[1] / 2.0
    ox, oy = top_offset
    bm = bmesh.new()
    b = [bm.verts.new((-bx, -by, 0)), bm.verts.new((bx, -by, 0)),
         bm.verts.new((bx, by, 0)), bm.verts.new((-bx, by, 0))]
    t = [bm.verts.new((-tx + ox, -ty + oy, h)), bm.verts.new((tx + ox, -ty + oy, h)),
         bm.verts.new((tx + ox, ty + oy, h)), bm.verts.new((-tx + ox, ty + oy, h))]
    bm.faces.new(list(reversed(b)))
    bm.faces.new(t)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([b[i], b[j], t[j], t[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = _from_bmesh(name, bm, mat)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), verts=12, mat=None, r2=None,
        caps=True):
    """沿 Z 軸的圓柱／錐台，原點在中心。"""
    fill = "NGON" if caps else "NOTHING"
    if r2 is None or abs(r2 - r) < 1e-9:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h,
                                            location=loc, rotation=rot,
                                            end_fill_type=fill)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2,
                                        depth=h, location=loc, rotation=rot,
                                        end_fill_type=fill)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    if mat is not None:
        o.data.materials.append(mat)
    return o


def sphere(name, r, loc=(0, 0, 0), segments=16, rings=8, scale=(1, 1, 1), mat=None,
           rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings,
                                         radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    o.scale = Vector(scale)
    if mat is not None:
        o.data.materials.append(mat)
    return o


def strut(name, p0, p1, r, mat=None, verts=6, caps=True):
    """兩點之間的細桿（桅杆、支柱、索具）。"""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    h = max(1e-4, d.length)
    o = cyl(name, r, h, loc=tuple(p0 + d * 0.5), verts=verts, mat=mat, caps=caps)
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return o


def slab(name, sections, mat=None, axis="Y"):
    """沿 Y 排列的矩形剖面錐台（甲板室、上層建築、砲塔外殼都用這個）。

    sections: [(y, half_width, z_bottom, z_top), ...]
    """
    rings = []
    for (y, hw, zb, zt) in sections:
        rings.append([(-hw, y, zb), (hw, y, zb), (hw, y, zt), (-hw, y, zt)])
    return loft(name, rings, mat=mat)


def disc(name, r, loc=(0, 0, 0), rot=(0, 0, 0), verts=10, mat=None):
    """平面圓盤（貼徽章用）。"""
    bm = bmesh.new()
    vs = [bm.verts.new((r * math.cos(2 * math.pi * i / verts),
                        r * math.sin(2 * math.pi * i / verts), 0.0))
          for i in range(verts)]
    bm.faces.new(vs)
    o = _from_bmesh(name, bm, mat)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


def star(name, r, loc=(0, 0, 0), rot=(0, 0, 0), points=5, inner=0.42, mat=None):
    bm = bmesh.new()
    vs = []
    for i in range(points * 2):
        a = math.pi / 2 + math.pi * i / points
        rr = r if i % 2 == 0 else r * inner
        vs.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), 0.0)))
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    o = _from_bmesh(name, bm, mat)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


def poly_prism(name, profile, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    """把 XZ 平面的多邊形剖面（list of (x,z)）沿 Y 擠出 depth（原點在中心）。"""
    bm = bmesh.new()
    a = [bm.verts.new((p[0], -depth / 2.0, p[1])) for p in profile]
    b = [bm.verts.new((p[0], depth / 2.0, p[1])) for p in profile]
    n = len(profile)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    o = _from_bmesh(name, bm, mat)
    o.location = Vector(loc)
    o.rotation_euler = Euler(rot)
    return o


# --------------------------------------------------------------------------
# Loft（剖面橋接）與船體
# --------------------------------------------------------------------------

def loft(name, rings, cap_start=True, cap_end=True, mat=None, merge_dist=1e-4):
    """rings: [[(x,y,z), ...], ...]，每圈點數相同，依序橋接成筒身並封蓋。"""
    bm = bmesh.new()
    layers = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = layers[i], layers[i + 1]
        for j in range(n):
            k = (j + 1) % n
            vs = [a[j], a[k], b[k], b[j]]
            uniq = []
            for v in vs:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) < 3:
                continue
            try:
                bm.faces.new(uniq)
            except ValueError:
                pass
    if cap_start:
        try:
            bm.faces.new(list(reversed(layers[0])))
        except ValueError:
            pass
    if cap_end:
        try:
            bm.faces.new(layers[-1])
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=merge_dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return _from_bmesh(name, bm, mat)


def hull_ring(y, half_beam, draft, freeboard, deck_half=None, keel_half=0.0,
              camber=0.0, n_under=5, n_side=2, rake=0.0, fullness=0.72,
              bottom=0.85, boot=0.0):
    """一圈船體剖面（封閉環，Blender 座標）。

    half_beam 水線半寬、draft 吃水、freeboard 乾舷、deck_half 甲板半寬、
    keel_half 龍骨平底半寬、camber 甲板中央拱起、rake 甲板相對龍骨的前後偏移。
    fullness 越小水線越飽滿；bottom 越小船底越平。
    """
    if deck_half is None:
        deck_half = half_beam
    side = []
    # 水下：由龍骨到水線
    for k in range(n_under + 1):
        th = (math.pi / 2.0) * (k / n_under)
        x = keel_half + (half_beam - keel_half) * (math.sin(th) ** fullness)
        z = -draft * (math.cos(th) ** bottom)
        side.append((x, z))
    # 水線帶：插一圈點讓黑色吃水線帶有固定厚度
    if boot and boot > 0.0 and draft > boot:
        side.insert(len(side) - 1, (half_beam * 0.997, -boot))
    # 舷側：水線到甲板邊
    for k in range(1, n_side + 1):
        f = k / n_side
        side.append((half_beam + (deck_half - half_beam) * f, freeboard * f))
    # 甲板：邊緣與中線之間一點
    side.append((deck_half * 0.5, freeboard + camber * 0.75))

    total = max(1e-6, draft + freeboard)

    def to3(x, z):
        return (x, y + rake * ((z + draft) / total), z)

    ring = [to3(side[0][0], side[0][1])]
    ring += [to3(x, z) for (x, z) in side[1:]]
    ring.append(to3(0.0, freeboard + camber))
    ring += [to3(-x, z) for (x, z) in reversed(side[1:])]
    return ring


def hull(name, stations, mat=None, **kw):
    """stations: [dict(y=..., half_beam=..., draft=..., freeboard=..., ...), ...]
    由艦艉往艦艏排序。dict 內的鍵直接餵給 hull_ring。"""
    rings = []
    for s in stations:
        p = dict(kw)
        p.update(s)
        rings.append(hull_ring(**p))
    return loft(name, rings, mat=mat)


# --------------------------------------------------------------------------
# 物件操作
# --------------------------------------------------------------------------

def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    objs = [o for o in objs if o is not None]
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = active or objs[0]
    return objs


def apply_transforms(obj):
    """套用位移／旋轉／縮放；套用後 obj.location 歸零、mesh 座標即世界座標。"""
    select([obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def join(objs, name=None, mat=None, bake=True):
    """合併成一個物件。bake=True 會套用變換，讓合併後 mesh 座標＝世界座標
    （原點回到世界原點），之後再用 set_origin／location 擺位才不會錯位。"""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        o = objs[0]
    else:
        select(objs)
        bpy.ops.object.join()
        o = bpy.context.active_object
    if bake:
        apply_transforms(o)
    if name:
        o.name = name
        o.data.name = name
    if mat is not None:
        set_mat(o, mat)
    return o


def dup(obj, name=None, loc=None, rot=None, scale=None, linked=False):
    o = obj.copy()
    o.data = obj.data if linked else obj.data.copy()
    if name:
        o.name = name
        if not linked:
            o.data.name = name
    _link(o)
    if loc is not None:
        o.location = Vector(loc)
    if rot is not None:
        o.rotation_euler = Euler(rot)
    if scale is not None:
        o.scale = Vector(scale)
    return o


def mirror_x(obj, name=None):
    """沿世界 X=0 鏡射複製（左右舷對稱件）。"""
    o = dup(obj, name or (obj.name + "_mx"))
    apply_transforms(o)
    o.data.transform(Matrix.Scale(-1.0, 4, (1.0, 0.0, 0.0)))
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def set_origin(obj, point):
    """把原點移到世界座標 point（外觀不變）。轉向樞軸就靠這個。"""
    apply_transforms(obj)
    obj.data.transform(Matrix.Translation(-Vector(point)))
    obj.location = Vector(point)
    return obj


def parent_to(child, parent):
    bpy.context.view_layer.update()  # matrix_world 可能還是舊的
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    return child


def auto_smooth(obj, angle_deg=35.0):
    """夾角大於 angle 的邊實際切開（不靠 modifier，匯出後法線才正確）。"""
    me = obj.data
    for p in me.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(angle_deg)
    sharp = [e for e in bm.edges
             if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr]
    if sharp:
        bmesh.ops.split_edges(bm, edges=sharp)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return obj


def shade_flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def planar_uv(obj, axis="Z", bounds=None):
    """以物件 bbox 做平面投影 UV。axis 是投影方向。"""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uvl = me.uv_layers.active.data
    co = [v.co for v in me.vertices]
    if not co:
        return obj
    ai, bi = {"Z": (0, 1), "Y": (0, 2), "X": (1, 2)}[axis]
    if bounds is None:
        amin = min(c[ai] for c in co)
        amax = max(c[ai] for c in co)
        bmin = min(c[bi] for c in co)
        bmax = max(c[bi] for c in co)
    else:
        amin, amax, bmin, bmax = bounds
    aw = max(1e-6, amax - amin)
    bw = max(1e-6, bmax - bmin)
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            uvl[li].uv = ((c[ai] - amin) / aw, (c[bi] - bmin) / bw)
    return obj


# --------------------------------------------------------------------------
# 統計、匯出、預覽
# --------------------------------------------------------------------------

def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def tri_count(objs=None):
    objs = objs if objs is not None else mesh_objects()
    n = 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def all_children(objs):
    out = []
    stack = list(objs)
    while stack:
        o = stack.pop()
        if o not in out:
            out.append(o)
            stack.extend(list(o.children))
    return out


def export_glb(objs, filepath, draco=True):
    filepath = abspath(filepath)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    objs = all_children(objs)
    select(objs)
    kw = dict(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_image_format="AUTO",
    )
    if draco:
        kw.update(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=12,
            export_draco_normal_quantization=8,
            export_draco_texcoord_quantization=10,
        )
    bpy.ops.export_scene.gltf(**kw)
    return filepath


def _bounds(objs):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def render_preview(filepath, objs=None, size=(768, 512), azimuth=38.0,
                   elevation=20.0, margin=1.06, bg=(0.16, 0.19, 0.24),
                   focal=70.0, target=None, water=False):
    """Workbench 3/4 前方視角預覽。azimuth 0 = 正前方（+Y），90 = 右舷（+X）。"""
    filepath = abspath(filepath)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    objs = objs if objs is not None else mesh_objects()
    objs = [o for o in all_children(objs) if o.type == "MESH"]
    lo, hi = _bounds(objs)
    ctr = (lo + hi) * 0.5 if target is None else Vector(target)
    radius = max(1e-3, (hi - lo).length * 0.5)

    water_obj = None
    if water:
        water_obj = box("_preview_water", (radius * 30, radius * 30, 0.02),
                        (ctr.x, ctr.y, -0.02),
                        mat=new_mat("_preview_water_mat", srgb(30, 52, 74), 0.5))

    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("_preview_cam")
    cam_data.lens = focal
    cam_data.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new("_preview_cam", cam_data)
    bpy.context.collection.objects.link(cam)
    az = math.radians(azimuth)
    el = math.radians(elevation)
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    fwd = -d
    up_hint = Vector((0.0, 0.0, 1.0))
    right = fwd.cross(up_hint)
    right = right.normalized() if right.length > 1e-6 else Vector((1.0, 0.0, 0.0))
    up = right.cross(fwd).normalized()
    tx = 18.0 / focal
    ty = tx * (size[1] / float(size[0]))
    dist = radius
    for qx in (lo.x, hi.x):
        for qy in (lo.y, hi.y):
            for qz in (lo.z, hi.z):
                q = Vector((qx, qy, qz)) - ctr
                depth = q.dot(fwd)
                dist = max(dist, abs(q.dot(right)) / tx - depth,
                           abs(q.dot(up)) / ty - depth)
    dist *= margin
    cam.location = ctr + d * dist
    cam.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam

    for attr, val in (("view_transform", "Standard"), ("look", "None")):
        try:
            setattr(sc.view_settings, attr, val)
        except Exception:
            pass

    # 燈光：主光從鏡頭左上、補光從右後、微弱底光
    lamps = []
    key_dir = (fwd * 0.55 + right * -0.55 + up * -0.62).normalized()
    fill_dir = (fwd * 0.4 + right * 0.75 + up * -0.5).normalized()
    for nm, dirv, energy, col in (
        ("_prev_key", key_dir, 3.1, (1.0, 0.97, 0.92)),
        ("_prev_fill", fill_dir, 1.1, (0.72, 0.8, 0.95)),
        ("_prev_rim", Vector((0.2, -0.4, -0.9)).normalized(), 0.55, (0.9, 0.93, 1.0)),
    ):
        ld = bpy.data.lights.new(nm, "SUN")
        ld.energy = energy
        ld.color = col
        ld.angle = math.radians(6.0)
        lo_ = bpy.data.objects.new(nm, ld)
        bpy.context.collection.objects.link(lo_)
        lo_.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
        lamps.append(lo_)

    world = bpy.data.worlds.new("_prev_world")
    world.use_nodes = True
    bgn = world.node_tree.nodes.get("Background")
    if bgn:
        bgn.inputs[0].default_value = (bg[0], bg[1], bg[2], 1.0)
        bgn.inputs[1].default_value = 1.0
    old_world = sc.world
    sc.world = world

    ok = False
    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
        sc.eevee.taa_render_samples = 16
        ok = True
    except Exception:
        try:
            sc.render.engine = "BLENDER_EEVEE"
            sc.eevee.taa_render_samples = 16
            ok = True
        except Exception:
            ok = False
    if not ok:
        sc.render.engine = "BLENDER_WORKBENCH"
        sh = sc.display.shading
        sh.light = "FLAT"
        sh.color_type = "MATERIAL"
        sh.show_cavity = True
        sh.cavity_type = "BOTH"
        sh.background_type = "VIEWPORT"
        sh.background_color = bg
        sc.display.render_aa = "16"

    sc.render.resolution_x = size[0]
    sc.render.resolution_y = size[1]
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = filepath
    bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam, do_unlink=True)
    for l in lamps:
        bpy.data.objects.remove(l, do_unlink=True)
    sc.world = old_world
    if water_obj:
        bpy.data.objects.remove(water_obj, do_unlink=True)
    return filepath


def finish(objs, name, args, previews=(), tri_budget=None, water=False,
           preview_kw=None):
    """匯出 glb ＋ 渲染預覽 ＋ 印統計。previews 是額外的 (suffix, kwargs) 清單。"""
    objs = [o for o in all_children(objs) if o.type == "MESH"]
    tris = tri_count(objs)
    glb = export_glb(objs, os.path.join(abspath(args.out), name + ".glb"),
                     draco=not args.no_draco)
    size = os.path.getsize(glb)
    base_kw = dict(preview_kw or {})
    if not args.no_preview:
        render_preview(os.path.join(abspath(args.preview), name + ".png"),
                       objs, water=water, **base_kw)
        for suffix, kw in previews:
            merged = dict(base_kw)
            merged.update(kw)
            render_preview(
                os.path.join(abspath(args.preview), name + "_" + suffix + ".png"),
                objs, **merged)
    flag = ""
    if tri_budget and tris > tri_budget:
        flag += "  !! 超過 %d 三角形預算" % tri_budget
    if size > 300 * 1024:
        flag += "  !! 超過 300 KB"
    print("[asset] %-18s tris=%-7d glb=%7.1f KB%s" % (name, tris, size / 1024.0, flag))
    return {"name": name, "tris": tris, "bytes": size, "path": glb}
