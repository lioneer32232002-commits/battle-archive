"""中途島艦載機六型 — 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/aircraft.py -- --out public/models

sbd（無畏）、tbd（毀滅者）、f4f（野貓）、a6m（零戰）、d3a（九九艦爆）、b5n（九七艦攻）
Blender 內 +Y 機首、+Z 上；原點在機身中心。螺旋槳是獨立子物件 `prop`。
各 ≤ 1.2k 三角形。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

R = math.radians


# --------------------------------------------------------------------------
# 塗裝
# --------------------------------------------------------------------------

SCHEMES = {
    "usn":       (C.srgb(88, 100, 114), C.srgb(176, 176, 168)),
    "ijn_grey":  (C.srgb(196, 192, 170), C.srgb(204, 202, 186)),
    "ijn_green": (C.srgb(102, 112, 84), C.srgb(188, 188, 172)),
}


def materials(scheme):
    up, lo = SCHEMES[scheme]
    return dict(
        up=C.new_mat("skin_up", up, 0.55, 0.1),
        lo=C.new_mat("skin_lo", lo, 0.55, 0.1),
        cowl=C.new_mat("cowl", C.srgb(40, 40, 42), 0.45, 0.4),
        glass=C.new_mat("glass", C.srgb(74, 92, 104), 0.18, 0.2),
        steel=C.new_mat("prop_steel", C.srgb(36, 36, 38), 0.35, 0.7),
        red=C.new_mat("hinomaru", C.srgb(178, 36, 32), 0.6, 0.0),
        blue=C.new_mat("roundel_blue", C.srgb(30, 46, 102), 0.6, 0.0),
        white=C.new_mat("roundel_white", C.srgb(230, 230, 224), 0.6, 0.0),
    )


def two_tone(obj, M, split=-0.25):
    """法線朝下的面改成下表面淺色。"""
    C.assign_mat_where(obj, M["lo"], lambda c, n: n.z < split)


# --------------------------------------------------------------------------
# 幾何工具
# --------------------------------------------------------------------------

def fuselage(name, sections, mat, n=8):
    """sections: (y, half_w, half_h, z_center)，由機首往機尾。"""
    rings = []
    for (y, hw, hh, zc) in sections:
        rings.append([(hw * math.cos(2 * math.pi * i / n), y,
                       zc + hh * math.sin(2 * math.pi * i / n))
                      for i in range(n)])
    return C.loft(name, rings, mat=mat)


def panel(name, sections, mat):
    """機翼／水平尾翼。sections: (x, y_le, y_te, z, half_thick)，由左翼尖到右翼尖。"""
    rings = []
    for (x, yle, yte, z, ht) in sections:
        ym = (yle + yte) * 0.5
        rings.append([(x, yle, z), (x, ym, z + ht), (x, yte, z), (x, ym, z - ht)])
    return C.loft(name, rings, mat=mat)


def fin(name, sections, mat):
    """垂直尾翼。sections: (z, y_le, y_te, half_thick)。"""
    rings = []
    for (z, yle, yte, ht) in sections:
        ym = (yle + yte) * 0.5
        rings.append([(0.0, yle, z), (ht, ym, z), (0.0, yte, z), (-ht, ym, z)])
    return C.loft(name, rings, mat=mat)


def build_prop(r, M, blades=3, pitch=20.0):
    parts = [C.cyl("hub", r * 0.14, r * 0.42, (0, r * 0.1, 0), rot=(R(90), 0, 0),
                   verts=8, mat=M["cowl"], r2=r * 0.05)]
    for i in range(blades):
        a = 2 * math.pi * i / blades
        parts.append(C.box("blade", (r, 0.045, r * 0.15),
                           (math.cos(a) * r * 0.5, 0.0, math.sin(a) * r * 0.5),
                           rot=(R(pitch), -a, 0), mat=M["steel"]))
    o = C.join(parts, "prop")
    C.auto_smooth(o, 45)
    return o


def hinomaru(parts, M, r, spots):
    for (loc, rot) in spots:
        parts.append(C.disc("hinomaru", r, loc, rot, verts=10, mat=M["red"]))


def us_star(parts, M, r, spots):
    for (loc, rot) in spots:
        parts.append(C.disc("roundel", r, loc, rot, verts=10, mat=M["blue"]))
        off = (0.012 if rot[1] == 0 else 0.0)
        lz = (loc[0] + (0.012 if rot[1] > 0 else (-0.012 if rot[1] < 0 else 0.0)),
              loc[1], loc[2] + (0.012 if abs(rot[0]) < 0.1 else -0.012))
        parts.append(C.star("star", r * 0.86, lz, rot, points=5, inner=0.40,
                            mat=M["white"]))
        del off


# --------------------------------------------------------------------------

PLANES = [
    dict(id="sbd", name="SBD Dauntless", L=10.09, S=12.66, scheme="usn",
         cowl_r=0.70, cowl_len=1.05, prop_r=1.60, wing_z=-0.42, wing_y=0.55,
         root_c=2.45, tip_c=1.20, canopy=(0.34, 1.55, 0.34), canopy_y=0.10,
         tail_span=4.30, fin_h=1.45, gear=False, dihedral=6.0),
    dict(id="tbd", name="TBD Devastator", L=10.67, S=15.24, scheme="usn",
         cowl_r=0.66, cowl_len=1.00, prop_r=1.55, wing_z=-0.46, wing_y=0.35,
         root_c=2.55, tip_c=1.15, canopy=(0.36, 2.20, 0.36), canopy_y=-0.20,
         tail_span=4.40, fin_h=1.30, gear=False, dihedral=4.0),
    dict(id="f4f", name="F4F Wildcat", L=8.76, S=11.58, scheme="usn",
         cowl_r=0.78, cowl_len=1.10, prop_r=1.50, wing_z=0.02, wing_y=0.30,
         root_c=2.10, tip_c=1.35, canopy=(0.32, 0.95, 0.32), canopy_y=0.45,
         tail_span=4.10, fin_h=1.40, gear=False, dihedral=2.0, fat=1.16),
    dict(id="a6m", name="A6M Zero", L=9.06, S=12.00, scheme="ijn_grey",
         cowl_r=0.64, cowl_len=0.95, prop_r=1.50, wing_z=-0.40, wing_y=0.25,
         root_c=2.20, tip_c=1.00, canopy=(0.30, 1.05, 0.30), canopy_y=0.35,
         tail_span=3.90, fin_h=1.25, gear=False, dihedral=6.0),
    dict(id="d3a", name="D3A Val", L=10.20, S=14.37, scheme="ijn_green",
         cowl_r=0.70, cowl_len=1.00, prop_r=1.60, wing_z=-0.42, wing_y=0.35,
         root_c=2.45, tip_c=1.05, canopy=(0.34, 1.95, 0.34), canopy_y=-0.05,
         tail_span=4.10, fin_h=1.25, gear=True, dihedral=7.0),
    dict(id="b5n", name="B5N Kate", L=10.30, S=15.52, scheme="ijn_green",
         cowl_r=0.66, cowl_len=0.95, prop_r=1.60, wing_z=-0.44, wing_y=0.20,
         root_c=2.60, tip_c=1.05, canopy=(0.34, 2.35, 0.34), canopy_y=-0.25,
         tail_span=4.30, fin_h=1.20, gear=False, dihedral=5.0),
]


def build(cfg, args):
    C.reset_scene()
    M = materials(cfg["scheme"])
    L, S = cfg["L"], cfg["S"]
    fat = cfg.get("fat", 1.0)
    parts = []

    # 機身
    nose = L * 0.44
    tail = -L * 0.56
    prof = [(0.44, 0.052, 0.052, 0.000),
            (0.38, 0.062, 0.068, 0.004),
            (0.28, 0.066, 0.078, 0.010),
            (0.14, 0.064, 0.078, 0.014),
            (0.00, 0.056, 0.070, 0.016),
            (-0.16, 0.044, 0.056, 0.018),
            (-0.32, 0.030, 0.040, 0.022),
            (-0.46, 0.018, 0.028, 0.028),
            (-0.56, 0.008, 0.016, 0.034)]
    body = fuselage("fus", [(f * L, hw * L * fat, hh * L * fat, zc * L)
                            for (f, hw, hh, zc) in prof], M["up"])
    C.auto_smooth(body, 44)
    parts.append(body)

    # 發動機罩（星型引擎）
    cowl = C.cyl("cowl", cfg["cowl_r"], cfg["cowl_len"],
                 (0, nose - cfg["cowl_len"] * 0.35, L * 0.004),
                 rot=(R(90), 0, 0), verts=12, mat=M["cowl"],
                 r2=cfg["cowl_r"] * 0.86)
    C.auto_smooth(cowl, 50)
    parts.append(cowl)

    # 主翼
    wz = cfg["wing_z"]
    wy = cfg["wing_y"]
    dih = math.tan(R(cfg["dihedral"]))
    rc, tc = cfg["root_c"], cfg["tip_c"]
    wing_sec = []
    for f in (-1.0, -0.90, -0.62, -0.30, 0.0, 0.30, 0.62, 0.90, 1.0):
        af = abs(f)
        x = f * S * 0.5
        # 弦長：翼根到翼尖漸縮，翼端圓角
        taper = rc + (tc - rc) * (af ** 1.15)
        if af > 0.9:
            taper *= 1.0 - (af - 0.9) * 4.4
        cy = wy - af * rc * 0.10          # 前緣微後掠
        yle = cy + taper * 0.62
        yte = cy - taper * 0.38
        z = wz + af * S * 0.5 * dih
        ht = (0.115 * taper) * (1.0 - af * 0.45)
        wing_sec.append((x, yle, yte, z, max(0.02, ht)))
    wing = panel("wing", wing_sec, M["up"])
    C.auto_smooth(wing, 40)
    parts.append(wing)

    # 水平尾翼
    ts = cfg["tail_span"]
    tail_sec = []
    for f in (-1.0, -0.85, 0.0, 0.85, 1.0):
        af = abs(f)
        x = f * ts * 0.5
        tch = 1.15 + (0.55 - 1.15) * af
        if af > 0.85:
            tch *= 1.0 - (af - 0.85) * 4.0
        cy = tail + L * 0.10
        tail_sec.append((x, cy + tch * 0.55, cy - tch * 0.45,
                         L * 0.024, max(0.015, 0.085 * tch)))
    tp = panel("tailplane", tail_sec, M["up"])
    C.auto_smooth(tp, 40)
    parts.append(tp)

    # 垂直尾翼
    fh = cfg["fin_h"]
    fy = tail + L * 0.10
    ftop = L * 0.045 + fh
    fin_sec = [(L * 0.02, fy + 1.35, fy - 0.65, 0.090),
               (L * 0.02 + fh * 0.40, fy + 0.95, fy - 0.66, 0.075),
               (L * 0.02 + fh * 0.76, fy + 0.55, fy - 0.62, 0.058),
               (ftop, fy + 0.12, fy - 0.44, 0.032)]
    vf = fin("fin", fin_sec, M["up"])
    C.auto_smooth(vf, 40)
    parts.append(vf)

    # 座艙罩：底部埋進機背、上緣凸出約 0.22 m
    cw, cl, ch = cfg["canopy"]
    back_z = L * (0.014 + 0.078 * fat)
    cz = back_z + 0.24 - ch
    canopy = C.sphere("canopy", 1.0, (0, cfg["canopy_y"], cz),
                      segments=10, rings=5, scale=(cw, cl, ch), mat=M["glass"])
    C.auto_smooth(canopy, 60)
    parts.append(canopy)
    # 座艙前後的整流罩（把玻璃跟機背銜接起來）
    parts.append(C.taper_box("coaming", (cw * 2.3, cl * 2.15), (cw * 1.9, cl * 1.9),
                             0.22, (0, cfg["canopy_y"], back_z - 0.16),
                             mat=M["up"]))

    # 固定起落架＋輪褲（九九艦爆）
    if cfg["gear"]:
        for sx in (-1, 1):
            gx = sx * S * 0.19
            parts.append(C.strut("gearleg", (gx * 0.8, wy - 0.1, wz - 0.05),
                                 (gx, wy + 0.15, wz - 0.95), 0.09, M["up"],
                                 verts=6))
            spat = C.sphere("spat", 1.0, (gx, wy + 0.2, wz - 1.05),
                            segments=8, rings=5, scale=(0.22, 0.72, 0.46),
                            mat=M["up"])
            C.auto_smooth(spat, 50)
            parts.append(spat)
        parts.append(C.strut("tailwheel", (0, tail + 0.5, L * 0.01),
                             (0, tail + 0.35, -L * 0.03), 0.07, M["cowl"],
                             verts=5))

    # 國籍標誌
    mr = S * 0.046
    wing_x = S * 0.30
    wing_top = wz + wing_x * dih + 0.115 * rc * 0.7
    wing_bot = wz + wing_x * dih - 0.115 * rc * 0.7
    if cfg["scheme"].startswith("ijn"):
        spots = [((wing_x, wy, wing_top + 0.02), (0, 0, 0)),
                 ((-wing_x, wy, wing_top + 0.02), (0, 0, 0)),
                 ((wing_x, wy, wing_bot - 0.02), (math.pi, 0, 0)),
                 ((-wing_x, wy, wing_bot - 0.02), (math.pi, 0, 0)),
                 ((0.068 * L * fat + 0.02, -L * 0.20, L * 0.018),
                  (0, R(90), 0)),
                 ((-0.068 * L * fat - 0.02, -L * 0.20, L * 0.018),
                  (0, R(-90), 0))]
        hinomaru(parts, M, mr * 0.92, spots)
        # 尾翼識別帶
        parts.append(C.box("tailband", (0.10, 0.9, 0.16),
                           (0, fy - 0.12, L * 0.02 + fh * 0.50), mat=M["red"]))
    else:
        spots = [((-wing_x, wy, wing_top + 0.02), (0, 0, 0)),
                 ((wing_x, wy, wing_bot - 0.02), (math.pi, 0, 0)),
                 ((0.068 * L * fat + 0.02, -L * 0.18, L * 0.018), (0, R(90), 0)),
                 ((-0.068 * L * fat - 0.02, -L * 0.18, L * 0.018),
                  (0, R(-90), 0))]
        us_star(parts, M, mr, spots)

    obj = C.join(parts, cfg["id"])
    two_tone(obj, M)

    prop = build_prop(cfg["prop_r"], M, blades=3)
    prop.location = (0, nose + 0.18, L * 0.004)
    C.parent_to(prop, obj)

    return C.finish([obj, prop], cfg["id"], args, tri_budget=1200,
                    preview_kw=dict(bg=(0.030, 0.036, 0.050), margin=1.12),
                    previews=[("top", dict(azimuth=25, elevation=62)),
                              ("side", dict(azimuth=90, elevation=6))])


def main():
    args = C.parse_args()
    only = args.only
    for cfg in PLANES:
        if only and cfg["id"] != only:
            continue
        build(cfg, args)


if __name__ == "__main__":
    main()
