"""Cycles 程序化舊化烘焙 — 共用工具（規格 docs/realism-spec.md §R2.1）

只給 bake.py 用。不改任何既有模型腳本的行為。

流程：
    weather_all()   把每個原材質就地換成程序化舊化材質（保留原 base color）
    unwrap()        多物件同時 Smart UV Project，攤進同一張 UV 圖
    bake_maps()     Cycles CPU 烘 DIFFUSE / ROUGHNESS / NORMAL / AO
    finalize()      ORM 打包 ＋ 單一材質（baseColor / MR / normal / occlusion）
"""

import math
import os
import time

import bpy
import numpy as np

# --------------------------------------------------------------------------
# 色彩
# --------------------------------------------------------------------------


def srgb(r, g, b):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


WEAR_COL = srgb(158, 160, 163)          # 磨掉漆之後的淺灰鋼
RUST_COL = (0.35, 0.15, 0.08, 1.0)      # 規格指定
DIRT_COL = (0.035, 0.032, 0.027, 1.0)   # AO 髒汙
MUD_COL = srgb(86, 70, 50)
GRIME_COL = srgb(46, 42, 36)      # 雨痕／油汙流跡
DUST_COL = srgb(150, 140, 120)    # 水平面積塵

# Blender Wave 節點：n = p * scale * 20，SAW 再除 2π -> 週期 = 0.31416/scale
WAVE_K = 0.31416
SOOT_COL = srgb(52, 47, 43)


# 每一類模型的舊化參數（單位：公尺；scale 是「每公尺幾個特徵」）
KIND = {
    "ship": dict(
        bevel=0.16, bevel_samples=3, ao_dist=3.0, ao_samples=4,
        plate=3.5, plate_v=9.0, seam=True, seam_w=0.14, bump_dist=0.9,
        wear=0.55, rust=0.72, dirt=0.58, grime=0.52, mud=0.0, panel=0.055,
        dust=0.08, blotch=0.11, blotch_scale=0.13,
        streak_w=0.90, streak_l=12.0, wear_noise=0.9, micro=1.4,
        mud_top=0.0, waterline=True, metallic=0.15,
    ),
    "vehicle": dict(
        bevel=0.055, bevel_samples=3, ao_dist=0.45, ao_samples=4,
        plate=0.60, plate_v=1.2, seam=True, seam_w=0.10, bump_dist=0.16,
        wear=0.62, rust=0.20, dirt=0.58, grime=0.50, mud=0.85, panel=0.05,
        dust=0.30, blotch=0.22, blotch_scale=0.8,
        streak_w=0.07, streak_l=0.9, wear_noise=13.0, micro=24.0,
        mud_top=0.85, waterline=False, metallic=0.10,
    ),
    "building": dict(
        bevel=0.090, bevel_samples=3, ao_dist=0.9, ao_samples=4,
        plate=0.0, plate_v=0.0, seam=False, seam_w=0.0, bump_dist=0.22,
        wear=0.34, rust=0.0, dirt=0.55, grime=0.55, mud=0.65, panel=0.0,
        dust=0.22, blotch=0.22, blotch_scale=0.55,
        streak_w=0.16, streak_l=2.2, wear_noise=7.0, micro=12.0,
        mud_top=1.05, waterline=False, metallic=0.0,
    ),
}

# 材質名稱關鍵字 -> 是否當金屬處理（鏽痕只長在金屬上）
_METAL_HINT = ("steel", "gunmetal", "metal", "hull", "grey", "dark", "boot",
               "antifoul", "panzer", "olive", "track", "barrel")
_NO_RUST_HINT = ("wood", "deck", "glass", "rubber", "snow", "white", "canvas",
                 "stone", "plaster", "roof", "timber", "sandbag", "dirt",
                 "skin", "uniform", "fd_mat", "flightdeck")


# --------------------------------------------------------------------------
# 節點小工具
# --------------------------------------------------------------------------


def _n(nt, kind, **kw):
    node = nt.nodes.new(kind)
    for k, v in kw.items():
        setattr(node, k, v)
    return node


def _set(node, key, val):
    try:
        node.inputs[key].default_value = val
    except (KeyError, TypeError):
        pass


def _math(nt, op, a=None, b=None, clamp=False):
    m = _n(nt, "ShaderNodeMath", operation=op, use_clamp=clamp)
    for i, v in ((0, a), (1, b)):
        if v is None:
            continue
        if hasattr(v, "bl_idname") or hasattr(v, "is_linked"):
            nt.links.new(v, m.inputs[i])
        else:
            m.inputs[i].default_value = v
    return m.outputs[0]


def _link_or_set(nt, sock, v):
    if v is None:
        return
    if hasattr(v, "is_linked") or hasattr(v, "node"):
        nt.links.new(v, sock)
    else:
        sock.default_value = v


def _mix(nt, fac, a, b, color=True):
    """回傳 mix 輸出。color=True 走 RGBA，False 用 Math 做 a+(b-a)*fac。"""
    if not color:
        d = _math(nt, "SUBTRACT", b, a)
        return _math(nt, "ADD", a, _math(nt, "MULTIPLY", d, fac), clamp=True)
    m = _n(nt, "ShaderNodeMixRGB")
    _link_or_set(nt, m.inputs["Fac"], fac)
    _link_or_set(nt, m.inputs["Color1"], a)
    _link_or_set(nt, m.inputs["Color2"], b)
    return m.outputs[0]


def _range(nt, val, f0, f1, t0=0.0, t1=1.0):
    r = _n(nt, "ShaderNodeMapRange", clamp=True)
    nt.links.new(val, r.inputs["Value"])
    r.inputs["From Min"].default_value = f0
    r.inputs["From Max"].default_value = f1
    r.inputs["To Min"].default_value = t0
    r.inputs["To Max"].default_value = t1
    return r.outputs[0]


def _noise(nt, vec, scale, detail=6.0, rough=0.55, distortion=0.0):
    t = _n(nt, "ShaderNodeTexNoise")
    if vec is not None:
        nt.links.new(vec, t.inputs["Vector"])
    _set(t, "Scale", scale)
    _set(t, "Detail", detail)
    _set(t, "Roughness", rough)
    _set(t, "Distortion", distortion)
    return t.outputs["Fac"]


def _scale_vec(nt, vec, sx, sy, sz):
    v = _n(nt, "ShaderNodeVectorMath", operation="MULTIPLY")
    nt.links.new(vec, v.inputs[0])
    v.inputs[1].default_value = (sx, sy, sz)
    return v.outputs[0]


# --------------------------------------------------------------------------
# 原材質參數
# --------------------------------------------------------------------------


def _orig(mat):
    col = (0.5, 0.5, 0.5, 1.0)
    rough, metal, img, interp = 0.7, 0.0, None, "Linear"
    if mat.use_nodes and mat.node_tree:
        bsdf = next((x for x in mat.node_tree.nodes
                     if x.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            col = tuple(bsdf.inputs["Base Color"].default_value)
            rough = float(bsdf.inputs["Roughness"].default_value)
            metal = float(bsdf.inputs["Metallic"].default_value)
            lk = bsdf.inputs["Base Color"].links
            if lk and lk[0].from_node.type == "TEX_IMAGE":
                img = lk[0].from_node.image
                interp = lk[0].from_node.interpolation
    if img is None and not mat.use_nodes:
        col = tuple(mat.diffuse_color)
        rough, metal = float(mat.roughness), float(mat.metallic)
    return col, rough, metal, img, interp


def _is_metal(mat, metal):
    n = mat.name.lower()
    if any(k in n for k in _NO_RUST_HINT):
        return False
    if metal >= 0.25:
        return True
    return any(k in n for k in _METAL_HINT)


# --------------------------------------------------------------------------
# 舊化材質
# --------------------------------------------------------------------------


def _streak(nt, pos, width, length, detail=8.0, lo=0.48, hi=0.72,
            distortion=0.4):
    """往下拉長的條紋遮罩：寬 width m、長 length m。"""
    stretch = max(1e-3, width / max(width, length))
    v = _scale_vec(nt, pos, 1.0, 1.0, stretch)
    n = _noise(nt, v, 1.0 / width, detail=detail, rough=0.7,
               distortion=distortion)
    return _range(nt, n, lo, hi)


def weather_material(mat, cfg, uv_src="uv_src"):
    """就地把 mat 換成程序化舊化材質（保留原 base color）。"""
    col, rough, metal, img, interp = _orig(mat)
    metalish = _is_metal(mat, metal)

    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = _n(nt, "ShaderNodeOutputMaterial", location=(900, 0))
    bsdf = _n(nt, "ShaderNodeBsdfPrincipled", location=(600, 0))
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    # 烘 DIFFUSE(color) 時金屬的 diffuse color 會變黑 -> 一律當介電質烘
    _set(bsdf, "Metallic", 0.0)
    _set(bsdf, "Specular IOR Level", 0.5)

    geo = _n(nt, "ShaderNodeNewGeometry", location=(-1400, 300))
    pos = geo.outputs["Position"]
    nrm = geo.outputs["Normal"]
    pnt = geo.outputs["Pointiness"]
    sep = _n(nt, "ShaderNodeSeparateXYZ", location=(-1200, 200))
    nt.links.new(pos, sep.inputs[0])
    oz = sep.outputs["Z"]
    snrm = _n(nt, "ShaderNodeSeparateXYZ", location=(-1200, 60))
    nt.links.new(nrm, snrm.inputs[0])
    nz = snrm.outputs["Z"]
    # 垂直面遮罩：1 = 立面，0 = 水平面
    vert = _range(nt, _math(nt, "ABSOLUTE", nz), 0.70, 0.15)

    # ---- base color 來源 -------------------------------------------------
    if img is not None:
        tex = _n(nt, "ShaderNodeTexImage", location=(-1200, 520))
        tex.image = img
        tex.interpolation = interp
        uvn = _n(nt, "ShaderNodeUVMap", location=(-1400, 520))
        uvn.uv_map = uv_src
        nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
        base = tex.outputs["Color"]
    else:
        rgb = _n(nt, "ShaderNodeRGB", location=(-1200, 520))
        rgb.outputs[0].default_value = col
        base = rgb.outputs[0]

    # ---- 邊角磨損：Bevel 法線 vs 著色法線（解析度無關）-------------------
    bev = _n(nt, "ShaderNodeBevel", location=(-1400, 120))
    bev.samples = int(cfg.get("bevel_samples", 4))
    _set(bev, "Radius", cfg["bevel"])
    dot = _n(nt, "ShaderNodeVectorMath", operation="DOT_PRODUCT",
             location=(-1200, 120))
    nt.links.new(nrm, dot.inputs[0])
    nt.links.new(bev.outputs["Normal"], dot.inputs[1])
    edge = _range(nt, dot.outputs["Value"], 0.9995, 0.84)   # 0 平面 -> 1 稜線
    convex = _range(nt, pnt, 0.492, 0.540)                  # 只留凸邊
    wn = _noise(nt, pos, cfg["wear_noise"], detail=8.0, rough=0.65)
    wear = _math(nt, "MULTIPLY", edge, convex)
    wear = _math(nt, "MULTIPLY", wear, _range(nt, wn, 0.28, 0.70, 0.18, 1.0))
    wear = _math(nt, "MULTIPLY", wear, cfg["wear"] * 1.35, clamp=True)

    # ---- AO 髒汙（只進真正的凹角）----------------------------------------
    ao = _n(nt, "ShaderNodeAmbientOcclusion", location=(-1200, -120))
    ao.samples = int(cfg.get("ao_samples", 8))
    ao.only_local = False
    _set(ao, "Distance", cfg["ao_dist"])
    aof = ao.outputs["AO"]
    crev = _range(nt, aof, 0.86, 0.22, 0.0, 1.0)
    dn = _noise(nt, pos, cfg["micro"] * 0.3, detail=5.0)
    dirt = _math(nt, "MULTIPLY", crev, _range(nt, dn, 0.25, 0.8, 0.6, 1.0))
    dirt = _math(nt, "MULTIPLY", dirt, cfg["dirt"] * 1.35, clamp=True)

    # ---- 鋼板接縫（bump 用，也是鏽與汙痕的起點）--------------------------
    seam = None
    flow = None
    if cfg["seam"] and cfg["plate"] > 0:
        wv = _n(nt, "ShaderNodeTexWave", location=(-1200, -320))
        wv.wave_type = "BANDS"
        wv.bands_direction = "Z"
        wv.wave_profile = "SAW"
        nt.links.new(pos, wv.inputs["Vector"])
        _set(wv, "Scale", WAVE_K / cfg["plate"])
        _set(wv, "Distortion", 0.5)
        _set(wv, "Detail", 1.0)
        saw = wv.outputs["Fac"]
        line_z = _range(nt, saw, 1.0 - cfg["seam_w"], 1.0)
        wy = _n(nt, "ShaderNodeTexWave", location=(-1200, -460))
        wy.wave_type = "BANDS"
        wy.bands_direction = "Y"
        wy.wave_profile = "SAW"
        nt.links.new(pos, wy.inputs["Vector"])
        _set(wy, "Scale", WAVE_K / max(0.2, cfg["plate_v"]))
        _set(wy, "Distortion", 0.4)
        line_y = _range(nt, wy.outputs["Fac"], 1.0 - cfg["seam_w"] * 0.7, 1.0)
        seam = _math(nt, "MAXIMUM", line_z,
                     _math(nt, "MULTIPLY", line_y, 0.75))
        # saw 接近 1 = 剛好在接縫下緣 -> 流痕從這裡往下淡出
        flow = _math(nt, "POWER", _range(nt, saw, 0.15, 1.0), 2.0)

    # 汙痕／鏽痕的「來源」：稜邊突出處與凹角
    src = _math(nt, "MAXIMUM", edge, _range(nt, aof, 0.86, 0.34, 0.0, 1.0))
    if flow is not None:
        src = _math(nt, "MAXIMUM", src, _math(nt, "MULTIPLY", flow, 0.85))
    src = _range(nt, src, 0.05, 0.55, 0.45, 1.0)

    # ---- 雨痕／油汙流跡（所有材質）---------------------------------------
    grime = None
    if cfg.get("grime", 0) > 0:
        st = _streak(nt, pos, cfg["streak_w"], cfg["streak_l"], lo=0.43,
                     hi=0.66)
        patch = _noise(nt, pos, 0.7 / cfg["streak_l"], detail=4.0)
        grime = _math(nt, "MULTIPLY", st, vert)
        grime = _math(nt, "MULTIPLY", grime, src)
        grime = _math(nt, "MULTIPLY", grime,
                      _range(nt, patch, 0.34, 0.66, 0.40, 1.0))
        grime = _math(nt, "MULTIPLY", grime, cfg["grime"] * 2.0, clamp=True)

    # ---- 鏽痕流跡（只在金屬、垂直面）------------------------------------
    rust = None
    if metalish and cfg["rust"] > 0:
        st = _streak(nt, pos, cfg["streak_w"] * 0.55, cfg["streak_l"] * 0.8,
                     lo=0.48, hi=0.70, distortion=0.6)
        patch = _noise(nt, pos, 0.5 / cfg["streak_l"], detail=4.0)
        rust = _math(nt, "MULTIPLY", st, vert)
        rust = _math(nt, "MULTIPLY", rust, src)
        rust = _math(nt, "MULTIPLY", rust,
                     _range(nt, patch, 0.46, 0.66, 0.0, 1.0))
        rust = _math(nt, "MULTIPLY", rust, cfg["rust"] * 2.2, clamp=True)

    # ---- 水平面積塵（很好讀的一層）---------------------------------------
    dust = None
    if cfg.get("dust", 0) > 0:
        up = _range(nt, nz, 0.30, 0.82)
        un = _noise(nt, pos, cfg["micro"] * 0.22, detail=5.0, rough=0.6)
        dust = _math(nt, "MULTIPLY", up, _range(nt, un, 0.32, 0.70, 0.25, 1.0))
        dust = _math(nt, "MULTIPLY", dust, cfg["dust"], clamp=True)

    # ---- 下緣泥汙 / 水線汙痕 ---------------------------------------------
    grit = None
    grit_col = MUD_COL
    if cfg["mud_top"] > 0:
        g = _range(nt, oz, cfg["mud_top"], cfg["mud_top"] * 0.10, 0.0, 1.0)
        gn = _noise(nt, pos, cfg["micro"] * 0.45, detail=6.0)
        g = _math(nt, "ADD", g, _range(nt, gn, 0.3, 0.75, -0.40, 0.30))
        grit = _math(nt, "MULTIPLY", _math(nt, "MAXIMUM", g, 0.0),
                     cfg.get("mud", 0.9), clamp=True)
    elif cfg["waterline"]:
        band = _range(nt, _math(nt, "ABSOLUTE", oz), 2.6, 0.10, 0.0, 1.0)
        bn = _noise(nt, pos, 0.6, detail=6.0)
        band = _math(nt, "MULTIPLY", band, _range(nt, bn, 0.3, 0.75, 0.35, 1.0))
        grit = _math(nt, "MULTIPLY", band, 0.80, clamp=True)
        grit_col = SOOT_COL

    # ---- 板面明度差（一塊一塊的鋼板看得出來）-----------------------------
    if cfg["panel"] > 0 and cfg["plate"] > 0:
        cell = _scale_vec(nt, pos, 1.0 / cfg["plate_v"], 1.0 / cfg["plate_v"],
                          1.0 / cfg["plate"])
        fl = _n(nt, "ShaderNodeVectorMath", operation="FLOOR")
        nt.links.new(cell, fl.inputs[0])
        wnz = _n(nt, "ShaderNodeTexWhiteNoise", noise_dimensions="3D")
        nt.links.new(fl.outputs[0], wnz.inputs["Vector"])
        pv = _range(nt, wnz.outputs["Value"], 0.0, 1.0,
                    1.0 - cfg["panel"], 1.0 + cfg["panel"])
        bc = _n(nt, "ShaderNodeVectorMath", operation="SCALE")
        nt.links.new(base, bc.inputs[0])
        nt.links.new(pv, bc.inputs["Scale"])
        base = bc.outputs[0]

    # ---- 大面積色調不均（褪色的漆）---------------------------------------
    if cfg.get("blotch", 0) > 0:
        bn2 = _noise(nt, pos, cfg["blotch_scale"], detail=4.0, rough=0.5)
        fade = _range(nt, bn2, 0.30, 0.70,
                      1.0 - cfg["blotch"], 1.0 + cfg["blotch"] * 0.45)
        bs = _n(nt, "ShaderNodeVectorMath", operation="SCALE")
        nt.links.new(base, bs.inputs[0])
        nt.links.new(fade, bs.inputs["Scale"])
        base = bs.outputs[0]

    # ---- 疊色（順序：底漆 -> 接縫 -> 流痕 -> 凹角髒 -> 鏽 -> 磨損 -> 泥）--
    colr = base
    if seam is not None:
        colr = _mix(nt, _math(nt, "MULTIPLY", seam, 0.55), colr, DIRT_COL)
    if grime is not None:
        colr = _mix(nt, grime, colr, GRIME_COL)
    if dust is not None:
        colr = _mix(nt, dust, colr, DUST_COL)
    colr = _mix(nt, dirt, colr, DIRT_COL)
    if rust is not None:
        colr = _mix(nt, rust, colr, RUST_COL)
    colr = _mix(nt, wear, colr, WEAR_COL)
    if grit is not None:
        colr = _mix(nt, grit, colr, grit_col)
    nt.links.new(colr, bsdf.inputs["Base Color"])

    # ---- roughness --------------------------------------------------------
    rgh = _math(nt, "ADD", rough, 0.0)
    rgh = _mix(nt, wear, rgh, 0.33, color=False)
    if grime is not None:
        rgh = _mix(nt, grime, rgh, 0.88, color=False)
    if dust is not None:
        rgh = _mix(nt, dust, rgh, 0.96, color=False)
    if rust is not None:
        rgh = _mix(nt, rust, rgh, 0.95, color=False)
    if grit is not None:
        rgh = _mix(nt, grit, rgh, 0.94, color=False)
    mn = _noise(nt, pos, cfg["micro"], detail=4.0)
    rgh = _math(nt, "ADD", rgh, _range(nt, mn, 0.2, 0.8, -0.07, 0.07),
                clamp=True)
    nt.links.new(rgh, bsdf.inputs["Roughness"])

    # ---- bump（接縫凹槽、磨損凸起、微表面）-------------------------------
    h = _math(nt, "MULTIPLY", mn, 0.18)
    if seam is not None:
        h = _math(nt, "SUBTRACT", h, seam)
    h = _math(nt, "ADD", h, _math(nt, "MULTIPLY", wear, 0.30))
    if grit is not None:
        h = _math(nt, "ADD", h, _math(nt, "MULTIPLY", grit, 0.25))
    bump = _n(nt, "ShaderNodeBump", location=(350, -300))
    _set(bump, "Strength", 0.15)
    _set(bump, "Distance", cfg["bump_dist"])
    nt.links.new(h, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def weather_all(objs, cfg, uv_src="uv_src"):
    done = set()
    n = 0
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in done:
                continue
            done.add(m.name)
            weather_material(m, cfg, uv_src)
            n += 1
    return n


# --------------------------------------------------------------------------
# UV
# --------------------------------------------------------------------------


def prepare_uvs(objs, uv_src="uv_src", uv_bake="uv_bake"):
    """把既有 UV 改名 uv_src（給貼圖材質用），另開 uv_bake 當烘焙目標。"""
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.data
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name=uv_src)
        else:
            act = me.uv_layers.active or me.uv_layers[0]
            if act.name != uv_src:
                if uv_src in me.uv_layers:
                    me.uv_layers.remove(me.uv_layers[uv_src])
                act.name = uv_src
        while len(me.uv_layers) > 1:
            for lay in me.uv_layers:
                if lay.name != uv_src:
                    me.uv_layers.remove(lay)
                    break
        lay = me.uv_layers.new(name=uv_bake)
        me.uv_layers.active = lay
        for l2 in me.uv_layers:
            l2.active_render = (l2.name == uv_bake)


def smart_uv(objs, angle_deg=66.0, margin=0.02):
    """多物件同時 Smart UV Project，全部島打包進同一個 0-1 空間。"""
    meshes = [o for o in objs if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg),
                             island_margin=margin,
                             area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


# --------------------------------------------------------------------------
# 烘焙
# --------------------------------------------------------------------------


def _img(name, size, non_color, color=(0.0, 0.0, 0.0, 1.0)):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    im.generated_color = color
    if non_color:
        im.colorspace_settings.name = "Non-Color"
    return im


def _target(objs, img):
    """讓每個材質的 active 節點是指向 img 的 Image Texture。"""
    seen = set()
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in seen:
                continue
            seen.add(m.name)
            nt = m.node_tree
            tgt = nt.nodes.get("_BAKE_TARGET")
            if tgt is None:
                tgt = nt.nodes.new("ShaderNodeTexImage")
                tgt.name = "_BAKE_TARGET"
                tgt.label = "_BAKE_TARGET"
                tgt.location = (-200, -700)
            tgt.image = img
            for nd in nt.nodes:
                nd.select = False
            tgt.select = True
            nt.nodes.active = tgt


def setup_cycles(scene, ao_dist=2.0):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.max_bounces = 2
    cy.diffuse_bounces = 1
    cy.glossy_bounces = 1
    cy.transmission_bounces = 1
    cy.transparent_max_bounces = 2
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    bk = scene.render.bake
    bk.use_selected_to_active = False
    bk.use_clear = True
    bk.margin = 6
    try:
        bk.margin_type = "ADJACENT_FACES"
    except TypeError:
        pass
    if scene.world is None:
        scene.world = bpy.data.worlds.new("_bake_world")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
        bg.inputs[1].default_value = 1.0
    scene.world.light_settings.distance = ao_dist


def bake_maps(objs, size=1024, samples=(96, 24, 16, 64), ao_dist=2.0):
    """回傳 dict(diffuse=, roughness=, normal=, ao=) 四張 image。"""
    scene = bpy.context.scene
    setup_cycles(scene, ao_dist=ao_dist)
    meshes = [o for o in objs if o.type == "MESH"]

    imgs = dict(
        diffuse=_img("_bake_diffuse", size, False, (0.5, 0.5, 0.5, 1.0)),
        roughness=_img("_bake_rough", size, True, (0.5, 0.5, 0.5, 1.0)),
        normal=_img("_bake_normal", size, True, (0.5, 0.5, 1.0, 1.0)),
        ao=_img("_bake_ao", size, True, (1.0, 1.0, 1.0, 1.0)),
    )

    bk = scene.render.bake
    plan = [
        ("diffuse", "DIFFUSE", samples[0], True),
        ("roughness", "ROUGHNESS", samples[1], True),
        ("normal", "NORMAL", samples[2], False),
        ("ao", "AO", samples[3], True),
    ]
    for key, btype, smp, denoise in plan:
        _target(meshes, imgs[key])
        scene.cycles.samples = smp
        scene.cycles.use_denoising = denoise
        if btype == "DIFFUSE":
            bk.use_pass_direct = False
            bk.use_pass_indirect = False
            bk.use_pass_color = True
        if btype == "NORMAL":
            bk.normal_space = "TANGENT"
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        tb = time.time()
        bpy.ops.object.bake(type=btype)
        print("    [bake] %-9s samples=%-4d %.0f s"
              % (key, smp, time.time() - tb), flush=True)
    return imgs


# --------------------------------------------------------------------------
# ORM 打包與最終材質
# --------------------------------------------------------------------------


def _px(img):
    a = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def pack_orm(imgs, metallic, size):
    """R=AO、G=roughness、B=metallic（常數），符合 glTF ORM 慣例。"""
    ao = _px(imgs["ao"])
    rg = _px(imgs["roughness"])
    orm = np.ones((size * size, 4), dtype=np.float32)
    orm[:, 0] = ao[:, 0]
    orm[:, 1] = rg[:, 1] if rg.shape[0] == ao.shape[0] else 0.6
    orm[:, 1] = rg[:, 0]
    orm[:, 2] = metallic
    im = _img("_bake_orm", size, True)
    im.pixels.foreach_set(orm.reshape(-1))
    im.update()
    return im


def save_images(pairs, folder):
    os.makedirs(folder, exist_ok=True)
    for name, im in pairs:
        p = os.path.join(folder, name + ".png")
        im.filepath_raw = p
        im.file_format = "PNG"
        im.save()
        im.pack()
    return folder


def _gltf_settings_group():
    name = "glTF Material Output"
    g = bpy.data.node_groups.get(name)
    if g is not None:
        return g
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    try:
        g.interface.new_socket("Occlusion", in_out="INPUT",
                               socket_type="NodeSocketFloat")
    except Exception:
        try:
            g.inputs.new("NodeSocketFloat", "Occlusion")
        except Exception:
            pass
    g.nodes.new("NodeGroupInput")
    return g


def final_material(name, base_img, orm_img, nrm_img, uv_bake="uv_bake"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _n(nt, "ShaderNodeOutputMaterial", location=(600, 0))
    bsdf = _n(nt, "ShaderNodeBsdfPrincipled", location=(300, 0))
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    uvn = _n(nt, "ShaderNodeUVMap", location=(-900, 0))
    uvn.uv_map = uv_bake

    def tex(img, y, non_color):
        t = _n(nt, "ShaderNodeTexImage", location=(-700, y))
        t.image = img
        if non_color:
            t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(uvn.outputs[0], t.inputs["Vector"])
        return t

    tb = tex(base_img, 300, False)
    to = tex(orm_img, 0, True)
    tn = tex(nrm_img, -300, True)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])

    sc = _n(nt, "ShaderNodeSeparateColor", location=(-400, 0))
    nt.links.new(to.outputs["Color"], sc.inputs[0])
    nt.links.new(sc.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sc.outputs["Blue"], bsdf.inputs["Metallic"])

    nm = _n(nt, "ShaderNodeNormalMap", location=(-400, -300))
    nm.uv_map = uv_bake
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])

    grp = _n(nt, "ShaderNodeGroup", location=(0, -500))
    grp.node_tree = _gltf_settings_group()
    if len(grp.inputs):
        nt.links.new(sc.outputs["Red"], grp.inputs[0])
    return m


def assign_single(objs, mat):
    for o in objs:
        if o.type != "MESH":
            continue
        for p in o.data.polygons:
            p.material_index = 0
        o.data.materials.clear()
        o.data.materials.append(mat)


def drop_src_uv(objs, uv_src="uv_src", uv_bake="uv_bake"):
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.data
        if uv_src in me.uv_layers and len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[uv_src])
        if uv_bake in me.uv_layers:
            me.uv_layers.active = me.uv_layers[uv_bake]
            me.uv_layers[uv_bake].active_render = True
