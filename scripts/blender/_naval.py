"""海戰資產共用零件（只有 scripts/blender/*.py 的海戰腳本用，陸戰不碰）。

_common.py 是跨組共用；這裡放船專用的：參數化船體剖面、砲塔、煙囪、桅杆、機砲。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

R = math.radians


# --------------------------------------------------------------------------
# 配色
# --------------------------------------------------------------------------

def palette(nation):
    """nation: 'ijn' | 'usn'"""
    if nation == "ijn":
        grey = C.srgb(98, 103, 106)      # 吳海軍工廠灰
        dark = C.srgb(60, 64, 68)
        deck = C.srgb(112, 104, 88)      # 木甲板
    else:
        grey = C.srgb(102, 110, 120)     # Measure 12 海軍藍灰
        dark = C.srgb(66, 72, 82)
        deck = C.srgb(74, 80, 90)        # 深藍灰甲板
    suffix = "_" + nation
    return dict(
        grey=C.new_mat("hull" + suffix, grey, 0.62, 0.5),
        dark=C.new_mat("dark" + suffix, dark, 0.55, 0.65),
        deck=C.new_mat("deck" + suffix, deck, 0.8, 0.0),
        red=C.new_mat("antifoul" + suffix, C.srgb(110, 56, 42), 0.72, 0.15),
        black=C.new_mat("boot" + suffix, C.srgb(24, 24, 26), 0.6, 0.35),
        steel=C.new_mat("steel" + suffix, C.srgb(42, 44, 48), 0.45, 0.85),
        white=C.new_mat("white" + suffix, C.srgb(210, 208, 200), 0.7, 0.0),
    )


# --------------------------------------------------------------------------
# 參數化船體
# --------------------------------------------------------------------------

def make_stations(loa, beam, draft, fb_mid, fb_bow, fb_stern, n=18,
                  bow_over=4.0, stern_over=3.0, bow_p=2.6, bow_q=0.42,
                  stern_p=3.2, stern_q=0.36, flare=1.06):
    """回傳 C.hull() 用的剖面清單。原點在水線中心，+Y 艦艏，總長剛好 loa。"""
    half = loa / 2.0
    y0, y1 = -half + stern_over, half - bow_over
    st = []
    for i in range(n):
        t = i / (n - 1.0)
        y = y0 + (y1 - y0) * t
        u = max(-1.0, min(1.0, y / half))
        au = abs(u)
        p, q = (bow_p, bow_q) if u >= 0 else (stern_p, stern_q)
        f = max(0.02, (1.0 - au ** p) ** q)
        hb = beam / 2.0 * f
        dr = draft * min(1.0, max(0.40, 1.0 - max(0.0, au - 0.76) / 0.5))
        fb = (fb_mid
              + (fb_bow - fb_mid) * max(0.0, u) ** 1.9
              + (fb_stern - fb_mid) * max(0.0, -u) ** 1.9)
        if y >= 0:
            rake = bow_over * (y / max(1e-6, y1)) ** 3.2
        else:
            rake = -stern_over * (y / min(-1e-6, y0)) ** 3.2
        st.append(dict(y=y, half_beam=max(0.25, hb), draft=max(1.2, dr),
                       freeboard=fb, deck_half=max(0.35, hb * flare),
                       rake=rake))
    return st


def build_hull(name, M, loa, beam, draft, fb_mid, fb_bow, fb_stern, n=18,
               boot=1.0, camber=0.35, fullness=0.66, bottom=0.75,
               wood_deck=True, smooth=36, **kw):
    st = make_stations(loa, beam, draft, fb_mid, fb_bow, fb_stern, n=n, **kw)
    h = C.hull(name, st, mat=M["grey"], camber=camber, fullness=fullness,
               bottom=bottom, boot=boot, n_under=4, n_side=2)
    C.assign_mat_by_height(h, M["red"], zmax=-boot * 1.05)
    C.assign_mat_by_height(h, M["black"], zmin=-boot * 1.05, zmax=0.05)
    if wood_deck:
        C.assign_mat_top(h, M["deck"], min_dot=0.85, zmin=fb_mid * 0.45)
    C.auto_smooth(h, smooth)
    return h


def deck_height(loa, fb_mid, fb_bow, fb_stern, y):
    u = max(-1.0, min(1.0, y / (loa / 2.0)))
    return (fb_mid + (fb_bow - fb_mid) * max(0.0, u) ** 1.9
            + (fb_stern - fb_mid) * max(0.0, -u) ** 1.9)


# --------------------------------------------------------------------------
# 零件
# --------------------------------------------------------------------------

def gun_turret(name, M, loc, half_w=2.6, length=5.0, height=2.4, guns=2,
               gun_gap=1.3, barrel_r=0.24, barrel_len=7.0, rot_z=0.0,
               shielded=True):
    """小口徑砲塔／砲盾。原點在砲塔底部中心（可直接繞 Z 轉）。"""
    parts = []
    if shielded:
        parts.append(C.slab("gh", [
            (-length * 0.5, half_w, 0.0, height),
            ( length * 0.2, half_w, 0.0, height),
            ( length * 0.5, half_w * 0.82, 0.15, height * 0.82),
        ], mat=M["grey"]))
    else:
        parts.append(C.cyl("gb", half_w, height, (0, 0, height * 0.5), verts=8,
                           mat=M["grey"]))
    xs = [(i - (guns - 1) / 2.0) * gun_gap for i in range(guns)]
    for bx in xs:
        parts.append(C.cyl("bl", barrel_r, barrel_len,
                           (bx, length * 0.4 + barrel_len * 0.45, height * 0.52),
                           rot=(R(90), 0, 0), verts=8, mat=M["steel"],
                           r2=barrel_r * 0.85))
    o = C.join(parts, name)
    C.auto_smooth(o, 42)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    return o


def funnel(name, M, base, height, r, rake=0.0, oval=1.0, cap=True, verts=12,
           taper=0.92):
    """後傾煙囪。base 是底面中心。"""
    axis = (0.0, -math.sin(rake), math.cos(rake))
    ctr = tuple(base[i] + axis[i] * height * 0.5 for i in range(3))
    f = C.cyl(name, r, height, ctr, rot=(rake, 0, 0), verts=verts,
              mat=M["grey"], r2=r * taper)
    if abs(oval - 1.0) > 1e-6:
        f.scale = (oval, 1.0, 1.0)
    C.apply_transforms(f)
    C.auto_smooth(f, 45)
    out = [f]
    if cap:
        top = tuple(base[i] + axis[i] * (height + 0.2) for i in range(3))
        c = C.cyl(name + "_cap", r * taper * 1.12, 0.5, top, rot=(rake, 0, 0),
                  verts=verts, mat=M["dark"])
        if abs(oval - 1.0) > 1e-6:
            c.scale = (oval, 1.0, 1.0)
        C.apply_transforms(c)
        out.append(c)
    return out


def tripod_mast(name, M, foot, top, spread=3.0, r=0.3, yard=None):
    """三腳桅。foot/top 為 (x, y, z)。"""
    out = [C.strut(name, foot, top, r, M["steel"], verts=6)]
    for dy, dx in ((-spread, 0.0), (spread * 0.5, spread * 0.8),
                   (spread * 0.5, -spread * 0.8)):
        p0 = (foot[0] + dx, foot[1] + dy, foot[2])
        p1 = (top[0] + dx * 0.15, top[1] + dy * 0.15, top[2] * 0.82 + foot[2] * 0.18)
        out.append(C.strut(name + "_leg", p0, p1, r * 0.8, M["steel"], verts=5))
    if yard:
        out.append(C.box(name + "_yard", (yard, 0.24, 0.24),
                         (top[0], top[1], top[2] * 0.88 + foot[2] * 0.12),
                         mat=M["steel"]))
    return out


def aa_mount(name, M, tub_r=1.6, guns=2, barrel_len=2.6, tub=True):
    parts = []
    if tub:
        parts.append(C.cyl("tub", tub_r, 1.0, (0, 0, 0.4), verts=8,
                           mat=M["grey"]))
    parts.append(C.taper_box("body", (1.5, 1.5), (1.1, 1.1), 1.0, (0, 0, 0.75),
                             mat=M["dark"]))
    xs = [(i - (guns - 1) / 2.0) * 0.42 for i in range(guns)]
    for bx in xs:
        parts.append(C.box("g", (0.14, barrel_len, 0.14),
                           (bx, barrel_len * 0.5, 1.6), mat=M["steel"]))
    o = C.join(parts, name)
    C.auto_smooth(o, 45)
    return o


def scatter(proto, positions, prefix):
    """把同一個 mesh 複製到多個位置（之後 join 進艦體省 draw call）。"""
    out = []
    for i, pos in enumerate(positions):
        loc = pos[:3]
        rz = pos[3] if len(pos) > 3 else 0.0
        d = C.dup(proto, "%s_%02d" % (prefix, i), loc=loc, rot=(0, 0, rz))
        out.append(d)
    return out


# --------------------------------------------------------------------------
# 飛行甲板貼圖
# --------------------------------------------------------------------------

def flight_deck_image(name, base_rgb, stripe_rgb, w=96, h=384, edge=True,
                      bands=(), rects=(), wires=(), centre=True,
                      dark_rgb=None, grain=0.055):
    """飛行甲板貼圖。u 橫向（0 左舷 1 右舷）、v 縱向（0 艦艉 1 艦艏）。

    bands : [(v0, v1)]                  橫向白帶
    rects : [(u0, u1, v0, v1)]          升降機：暗色塊＋白框
    wires : [v, ...]                    制動索／橫向細線
    """
    br, bg, bb = base_rgb
    sr, sg, sb = stripe_rgb
    dr, dg, db = dark_rgb or (br * 0.45, bg * 0.45, bb * 0.45)
    tw, th = 1.0 / w, 1.0 / h

    def fn(u, v):
        n = math.sin(u * 137.0) * 0.5 + math.sin(u * 311.0 + 1.7) * 0.5
        k = 1.0 + n * grain
        r, g, b = br * k, bg * k, bb * k
        for wv in wires:
            if abs(v - wv) < th * 1.2:
                r, g, b = dr, dg, db
        for (u0, u1, v0, v1) in rects:
            if u0 <= u <= u1 and v0 <= v <= v1:
                edgehit = (u - u0 < tw * 2 or u1 - u < tw * 2
                           or v - v0 < th * 2 or v1 - v < th * 2)
                r, g, b = (sr, sg, sb) if edgehit else (dr, dg, db)
        if centre and abs(u - 0.5) < 0.014:
            r, g, b = sr, sg, sb
        if edge and (u < 0.030 or u > 0.970):
            r, g, b = sr, sg, sb
        for (v0, v1) in bands:
            if v0 <= v <= v1:
                r, g, b = sr, sg, sb
        return (r, g, b)

    return C.new_image(name, w, h, fn)
