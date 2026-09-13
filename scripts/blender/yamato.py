"""大和級戰艦 — 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/yamato.py -- --out public/models

長 263 m、寬 38.9 m。Blender 內 +Y 為艦艏、+Z 上、水線 z=0；
匯出 glTF 後自動變成 Y 上、-Z 艦艏（export_yup）。

可轉動物件：turret_A / turret_B / turret_C（樞軸在砲塔中心底部，繞上軸旋轉）
            barrels_A / B / C（砲塔子物件，樞軸在耳軸，繞左右軸俯仰）
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

import bpy  # noqa: E402

R = math.radians
LOA = 263.0
BEAM = 38.9

# --------------------------------------------------------------------------
# 材質
# --------------------------------------------------------------------------

def materials():
    return dict(
        grey=C.new_mat("yamato_grey", C.srgb(96, 101, 105), 0.62, 0.55),
        dark=C.new_mat("yamato_dark", C.srgb(58, 62, 66), 0.55, 0.7),
        red=C.new_mat("yamato_antifoul", C.srgb(112, 58, 44), 0.72, 0.15),
        black=C.new_mat("yamato_boot", C.srgb(26, 26, 28), 0.6, 0.4),
        wood=C.new_mat("yamato_deck", C.srgb(118, 110, 96), 0.80, 0.0),
        steel=C.new_mat("yamato_steel", C.srgb(44, 46, 50), 0.45, 0.85),
    )


# --------------------------------------------------------------------------
# 船體剖面（y, 水線半寬, 吃水, 乾舷, 甲板半寬, 甲板前後偏移）
# --------------------------------------------------------------------------

STATIONS = [
    (-128.5,  1.4,  2.2,  6.6,  2.2, -3.0),
    (-125.0,  4.2,  4.4,  6.6,  5.0, -2.2),
    (-118.0,  7.6,  6.6,  6.7,  8.4, -1.2),
    (-109.0, 10.8,  8.5,  6.8, 11.4, -0.5),
    ( -99.0, 13.6,  9.8,  6.9, 14.0,  0.0),
    ( -86.0, 16.0, 10.3,  7.0, 16.3,  0.0),
    ( -68.0, 18.0, 10.4,  7.1, 18.2,  0.0),
    ( -48.0, 19.1, 10.4,  7.3, 19.2,  0.0),
    ( -26.0, 19.45, 10.4, 7.6, 19.45, 0.0),
    (  -4.0, 19.45, 10.4, 7.9, 19.45, 0.0),
    (  16.0, 19.30, 10.4, 8.3, 19.40, 0.0),
    (  36.0, 18.80, 10.4, 8.8, 19.00, 0.0),
    (  54.0, 17.70, 10.4, 9.4, 18.10, 0.4),
    (  70.0, 16.00, 10.3, 10.2, 16.60, 0.9),
    (  84.0, 13.90, 10.1, 11.0, 14.70, 1.5),
    (  96.0, 11.70,  9.8, 11.7, 12.70, 2.0),
    ( 106.0,  9.40,  9.4, 12.4, 10.60, 2.4),
    ( 114.0,  7.10,  8.8, 13.0,  8.40, 2.8),
    ( 120.0,  4.80,  8.0, 13.5,  6.00, 3.4),
    ( 124.0,  2.80,  6.9, 13.9,  3.60, 4.4),
    ( 126.5,  1.30,  5.4, 14.1,  1.80, 4.9),
    ( 127.5,  0.45,  3.6, 14.2,  0.60, 4.0),
]


def deck_z(y):
    """甲板高度（水線以上），線性內插 STATIONS 的乾舷。"""
    for i in range(len(STATIONS) - 1):
        y0, y1 = STATIONS[i][0], STATIONS[i + 1][0]
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            return STATIONS[i][3] + t * (STATIONS[i + 1][3] - STATIONS[i][3])
    return STATIONS[0][3] if y < STATIONS[0][0] else STATIONS[-1][3]


def build_hull(M):
    st = [dict(y=s[0], half_beam=s[1], draft=s[2], freeboard=s[3],
               deck_half=s[4], rake=s[5]) for s in STATIONS]
    h = C.hull("hull", st, mat=M["grey"], camber=0.45, fullness=0.62,
               bottom=0.72, boot=1.6, n_under=5, n_side=2)
    C.assign_mat_by_height(h, M["red"], zmax=-1.5)
    C.assign_mat_by_height(h, M["black"], zmin=-1.5, zmax=0.05)
    C.assign_mat_top(h, M["wood"], min_dot=0.86, zmin=4.0)
    C.auto_smooth(h, 38)
    # 球狀艦艏
    bulb = C.sphere("bulb", 1.0, (0, 124.5, -6.6), segments=12, rings=6,
                    scale=(3.0, 6.6, 3.4), mat=M["red"])
    C.auto_smooth(bulb, 50)
    return [h, bulb]


# --------------------------------------------------------------------------
# 主砲塔（三聯裝 46 cm）
# --------------------------------------------------------------------------

def main_turret(letter, y, pivot_z, M, aft=False):
    hw = 6.3
    house = C.slab("gh", [
        (-6.6, 5.9, 0.10, 4.10),
        (-5.6, hw, -0.05, 4.45),
        (  1.8, hw, -0.05, 4.45),
        (  4.8, 5.6, 0.05, 3.60),
        (  6.3, 4.7, 0.60, 2.50),
    ], mat=M["grey"])
    roof = C.slab("gr", [(-5.2, 5.4, 4.40, 4.62), (1.6, 5.4, 4.40, 4.62)],
                  mat=M["dark"])
    rf = C.cyl("rf", 1.0, 13.6, (0, -4.6, 3.3), rot=(0, R(90), 0), verts=8,
               mat=M["dark"])  # 測距儀突出兩側
    side = []
    for sx in (-1, 1):
        side.append(C.box("blist", (0.5, 4.0, 1.4), (sx * 6.4, -1.0, 2.2),
                          mat=M["grey"]))
    turret = C.join([house, roof, rf] + side, "turret_" + letter)
    C.auto_smooth(turret, 40)

    # 砲管：耳軸（俯仰樞軸）在局部 (0, 4.2, 1.9)
    bar = []
    for bx in (-3.15, 0.0, 3.15):
        bar.append(C.cyl("b", 0.66, 17.0, (bx, 10.4, 1.9), rot=(R(90), 0, 0),
                         verts=10, mat=M["steel"], r2=0.55))
        bar.append(C.cyl("bs", 0.98, 3.4, (bx, 2.4, 1.9), rot=(R(90), 0, 0),
                         verts=8, mat=M["dark"]))
    barrels = C.join(bar, "barrels_" + letter)
    C.auto_smooth(barrels, 40)

    if aft:
        for o in (turret, barrels):
            o.rotation_euler = (0, 0, math.pi)
            C.apply_transforms(o)
    trunnion = (0.0, -4.2 if aft else 4.2, 1.9)
    C.set_origin(barrels, trunnion)
    turret.location = (0, y, pivot_z)
    barrels.location = (trunnion[0], y + trunnion[1], pivot_z + trunnion[2])
    C.parent_to(barrels, turret)
    return turret, barrels


def barbette(y, top_z, r, M):
    b = C.cyl("barb", r, 24.0, (0, y, top_z - 12.0), verts=16, mat=M["grey"])
    return b


# --------------------------------------------------------------------------
# 副砲塔（三聯裝 15.5 cm）
# --------------------------------------------------------------------------

def secondary(name, loc, M, rot_z=0.0, scale=1.0):
    s = scale
    house = C.slab("sh", [
        (-3.6 * s, 3.1 * s, 0.0, 2.5 * s),
        ( 1.6 * s, 3.1 * s, 0.0, 2.6 * s),
        ( 3.4 * s, 2.6 * s, 0.1, 2.0 * s),
    ], mat=M["grey"])
    bars = []
    for bx in (-1.5 * s, 0.0, 1.5 * s):
        bars.append(C.cyl("sb", 0.30 * s, 9.0 * s, (bx, 5.0 * s, 1.15 * s),
                          rot=(R(90), 0, 0), verts=8, mat=M["steel"]))
    o = C.join([house] + bars, name)
    C.auto_smooth(o, 40)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    return o


# --------------------------------------------------------------------------
# 25 mm 三聯裝機砲（含砲座圍壁）
# --------------------------------------------------------------------------

def aa_mount(name, M):
    tub = C.cyl("tub", 2.0, 1.2, (0, 0, 0.5), verts=8, mat=M["grey"])
    body = C.taper_box("aab", (1.9, 1.9), (1.4, 1.4), 1.2, (0, 0, 0.9),
                       mat=M["dark"])
    bars = [C.box("aag", (0.15, 3.2, 0.15), (bx, 1.9, 1.85), mat=M["steel"])
            for bx in (-0.42, 0.0, 0.42)]
    o = C.join([tub, body] + bars, name)
    C.auto_smooth(o, 45)
    return o


# --------------------------------------------------------------------------
# 上層建築
# --------------------------------------------------------------------------

def build_superstructure(M):
    parts = []

    # 上甲板（舷側外板之上的長條甲板室）
    ss = C.slab("ss", [
        ( 58.0,  9.0, 8.0, 12.6),
        ( 46.0, 12.2, 8.0, 12.8),
        ( 30.0, 14.2, 8.0, 12.8),
        ( 10.0, 15.2, 8.0, 12.8),
        (-12.0, 15.2, 8.0, 12.8),
        (-32.0, 14.2, 8.0, 12.8),
        (-52.0, 12.0, 8.0, 12.6),
        (-70.0,  8.6, 8.0, 12.2),
    ], mat=M["grey"])
    C.assign_mat_top(ss, M["dark"], min_dot=0.9, zmin=11.0)
    parts.append(ss)

    # 艦橋塔（層層縮小）
    tower = [
        ((22.0, 26.0), (21.0, 25.0), 4.2, 12.8, 20.0),
        ((19.2, 22.0), (18.4, 21.0), 4.0, 17.0, 20.4),
        ((15.4, 17.0), (14.8, 16.2), 4.0, 21.0, 20.8),
        ((13.2, 14.0), (12.6, 13.4), 3.5, 25.0, 21.2),   # 羅經艦橋，外伸
        (( 8.6,  9.2), (8.2, 8.8), 4.5, 28.5, 21.6),
        (( 6.6,  6.6), (6.2, 6.2), 4.5, 33.0, 22.0),
        (( 5.0,  5.0), (4.6, 4.6), 2.6, 37.5, 22.0),
    ]
    for i, (b, t, h, z, yy) in enumerate(tower):
        parts.append(C.taper_box("tw%d" % i, b, t, h, (0, yy, z), mat=M["grey"]))
    # 主測距儀（15.5 m 基線）＋方位盤
    parts.append(C.cyl("rangefinder", 1.25, 15.6, (0, 22.0, 41.2),
                       rot=(0, R(90), 0), verts=10, mat=M["dark"]))
    parts.append(C.sphere("director", 2.1, (0, 22.0, 42.6), segments=12, rings=6,
                          scale=(1.0, 1.0, 0.75), mat=M["dark"]))
    parts.append(C.strut("foremast", (0, 22.0, 43.6), (0, 20.0, 50.0), 0.35,
                         M["steel"], verts=6))
    parts.append(C.box("foreyard", (9.0, 0.28, 0.28), (0, 20.6, 48.0),
                       mat=M["steel"]))
    # 各層外伸平台：把直線錐體打斷成階梯狀的塔
    for zz, yy, wx, wy in ((16.9, 20.2, 21.8, 25.4), (20.9, 20.6, 17.6, 20.0),
                           (24.9, 21.0, 15.4, 16.6), (28.4, 21.4, 14.0, 14.6),
                           (32.9, 21.8, 9.8, 10.2), (37.4, 22.0, 7.4, 7.4),
                           (40.1, 22.0, 6.0, 6.0)):
        parts.append(C.box("plat", (wx, wy, 0.34), (0, yy, zz), mat=M["dark"]))

    # 煙囪（後傾 26°，橫剖面橢圓）
    rake = R(26.0)
    axis = (0.0, -math.sin(rake), math.cos(rake))
    base = (0.0, -8.0, 12.4)
    ctr = (base[0] + axis[0] * 9.2, base[1] + axis[1] * 9.2, base[2] + axis[2] * 9.2)
    fun = C.cyl("funnel", 4.3, 18.4, ctr, rot=(rake, 0, 0), verts=14,
                mat=M["grey"], r2=4.0)
    fun.scale = (1.38, 1.0, 1.0)
    C.apply_transforms(fun)
    C.auto_smooth(fun, 45)
    parts.append(fun)
    top = (base[0] + axis[0] * 18.2, base[1] + axis[1] * 18.2,
           base[2] + axis[2] * 18.2)
    cap = C.cyl("funcap", 4.6, 0.7, top, rot=(rake, 0, 0), verts=14,
                mat=M["dark"])
    cap.scale = (1.38, 1.0, 1.0)
    C.apply_transforms(cap)
    parts.append(cap)
    parts.append(C.box("funbase", (12.0, 11.0, 2.2), (0, -8.0, 13.4),
                       mat=M["grey"]))

    # 主桅（三腳）
    parts.append(C.strut("mm1", (0, -23.0, 12.6), (0, -26.5, 34.0), 0.5,
                         M["steel"]))
    parts.append(C.strut("mm2", (4.6, -32.0, 12.6), (1.1, -27.0, 31.0), 0.42,
                         M["steel"]))
    parts.append(C.strut("mm3", (-4.6, -32.0, 12.6), (-1.1, -27.0, 31.0), 0.42,
                         M["steel"]))
    parts.append(C.box("mainyard", (11.0, 0.3, 0.3), (0, -26.2, 32.4),
                       mat=M["steel"]))

    # 艦體中段舷側砲座甲板
    for sx in (-1, 1):
        parts.append(C.slab("spons%d" % sx, [
            (-64.0, 17.4, 8.4, 9.2),
            (-30.0, 18.6, 8.6, 9.4),
            ( 20.0, 18.6, 9.2, 10.0),
            ( 48.0, 17.4, 9.8, 10.6),
        ], mat=M["grey"]) if sx > 0 else None)
    parts = [p for p in parts if p]

    # 舷側防空砲座凸出平台
    for yy in (-72, -58, -44, -30, 24, 38, 50):
        hwv = 17.2 if abs(yy) < 60 else 15.4
        for sx in (-1, 1):
            parts.append(C.box("tubdeck", (4.6, 5.4, 0.5),
                               (sx * hwv, yy, deck_z(yy) + 1.2), mat=M["grey"]))

    # 中段甲板室、通風筒、艦載艇
    parts.append(C.slab("boatdeck", [
        (-52.0, 11.0, 12.8, 15.2),
        (-36.0, 12.4, 12.8, 15.6),
        (-20.0, 12.4, 12.8, 15.6),
        ( -6.0, 11.0, 12.8, 15.2),
    ], mat=M["grey"]))
    for yy in (-42, -30, -18):
        for sx in (-1, 1):
            parts.append(C.box("boat", (2.2, 9.0, 1.6),
                               (sx * 9.6, yy, 16.4), mat=M["dark"]))
    parts.append(C.cyl("vent1", 1.3, 3.4, (5.0, -2.0, 15.0), verts=8,
                       mat=M["grey"]))
    parts.append(C.cyl("vent2", 1.3, 3.4, (-5.0, -2.0, 15.0), verts=8,
                       mat=M["grey"]))

    # 艦艉飛機甲板：彈射器兩座、起重機、軌道
    for sx in (-1, 1):
        parts.append(C.box("catapult", (2.0, 22.0, 0.8),
                           (sx * 7.2, -104.0, deck_z(-104.0) + 0.6),
                           mat=M["dark"]))
    parts.append(C.cyl("cranebase", 2.2, 7.0, (9.5, -88.0, deck_z(-88) + 2.6),
                       verts=8, mat=M["grey"]))
    parts.append(C.strut("craneboom", (9.5, -88.0, deck_z(-88) + 5.6),
                         (7.0, -114.0, 19.0), 0.75, M["steel"], verts=6))
    parts.append(C.strut("cranestay", (9.5, -88.0, deck_z(-88) + 9.0),
                         (8.2, -102.0, 13.2), 0.25, M["steel"], verts=4))
    parts.append(C.box("hangar", (17.0, 16.0, 3.0), (0, -84.0, deck_z(-84) + 1.5),
                       mat=M["grey"]))
    parts.append(C.box("planehoist", (13.0, 1.0, 0.9), (0, -120.0,
                       deck_z(-120) + 0.5), mat=M["dark"]))
    for sx in (-1, 1):
        parts.append(C.box("aftrail", (0.4, 34.0, 0.35),
                           (sx * 12.0, -110.0, deck_z(-110) + 0.4),
                           mat=M["steel"]))

    # 艦艏防浪板與錨甲板構造
    parts.append(C.box("breakwater", (11.0, 0.5, 1.5), (0, 92.0, deck_z(92) + 0.9),
                       rot=(0, 0, 0), mat=M["grey"]))
    for sx in (-1, 1):
        parts.append(C.box("bw2", (0.5, 9.0, 1.5),
                           (sx * 5.2, 87.6, deck_z(87.6) + 0.9),
                           rot=(0, 0, R(-18) * sx), mat=M["grey"]))
    parts.append(C.cyl("capstan", 1.0, 1.2, (0, 118.0, deck_z(118) + 0.5),
                       verts=8, mat=M["dark"]))

    return parts


# --------------------------------------------------------------------------

AA_POSITIONS = [
    # (x, y, z)
] + [(sx * 17.2, yy, deck_z(yy) + 1.75)
     for yy in (-72, -58, -44, -30) for sx in (-1, 1)] \
  + [(sx * 17.2, yy, deck_z(yy) + 1.75) for yy in (24, 38, 50) for sx in (-1, 1)] \
  + [(sx * 11.6, yy, 12.9) for yy in (-24, -12, 4, 14) for sx in (-1, 1)] \
  + [(sx * 7.6, yy, 15.8) for yy in (-46, -20) for sx in (-1, 1)] \
  + [(sx * 7.2, yy, 29.9) for yy in (26.0, 17.0) for sx in (-1, 1)] \
  + [(sx * 6.6, -88.0, deck_z(-88) + 0.6) for sx in (-1, 1)]


def build():
    """建出全部物件並回傳 [hull, turret_A, barrels_A, ...]（不匯出，供烘焙用）。"""
    C.reset_scene()
    M = materials()

    static = []
    static += build_hull(M)
    static += build_superstructure(M)

    # 主砲塔座圈
    static.append(barbette(66.0, 12.2, 7.2, M))
    static.append(barbette(46.0, 17.2, 7.2, M))
    static.append(barbette(-62.0, 11.8, 7.2, M))
    # 副砲座圈
    static.append(C.cyl("sb1", 3.6, 14.0, (0, 36.0, 12.6), verts=12, mat=M["grey"]))
    static.append(C.cyl("sb2", 3.6, 10.0, (0, -46.0, 11.0), verts=12, mat=M["grey"]))

    # 副砲塔：艦艏中線、艦艉中線、兩舷
    static.append(secondary("sec_fwd", (0, 36.0, 19.6), M))
    static.append(secondary("sec_aft", (0, -46.0, 16.0), M, rot_z=math.pi))
    static.append(C.cyl("sbw_r", 3.4, 3.0, (15.4, 0.0, 12.0), verts=10,
                        mat=M["grey"]))
    static.append(C.cyl("sbw_l", 3.4, 3.0, (-15.4, 0.0, 12.0), verts=10,
                        mat=M["grey"]))
    static.append(secondary("sec_stbd", (15.4, 0.0, 13.4), M, rot_z=R(-38)))
    static.append(secondary("sec_port", (-15.4, 0.0, 13.4), M, rot_z=R(38)))

    # 對空機砲群：一個 mesh 複製擺放，最後併入艦體以省 draw call
    proto = aa_mount("aa_proto", M)
    for i, (x, y, z) in enumerate(AA_POSITIONS):
        static.append(C.dup(proto, "aa_%02d" % i, loc=(x, y, z)))
    bpy.data.objects.remove(proto, do_unlink=True)

    body = C.join(static, "yamato_hull")

    turrets = []
    for letter, y, pz, aft in (("A", 66.0, 12.2, False),
                               ("B", 46.0, 17.2, False),
                               ("C", -62.0, 11.8, True)):
        t, b = main_turret(letter, y, pz, M, aft=aft)
        turrets += [t, b]

    return [body] + turrets


def main():
    args = C.parse_args()
    objs = build()
    res = C.finish(objs, "yamato", args, tri_budget=12000, water=True,
                   previews=[("side", dict(azimuth=88, elevation=3, water=True,
                                                     target=(0, 0, 8))),
                             ("bow", dict(azimuth=18, elevation=12, water=True)),
                             ("aft", dict(azimuth=200, elevation=22, water=True))])
    print("AA mounts:", len(AA_POSITIONS))
    return res


if __name__ == "__main__":
    main()
