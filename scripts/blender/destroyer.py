"""驅逐艦（日軍陽炎型／美軍佛萊契型）— 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/destroyer.py -- --out public/models

輸出 destroyer_ijn.glb、destroyer_usn.glb，長 118 m。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402
import _naval as N  # noqa: E402

import bpy  # noqa: E402

R = math.radians
LOA = 118.0


def build(nation, args, export=True):
    C.reset_scene()
    M = N.palette(nation)
    ijn = nation == "ijn"
    beam = 10.8 if ijn else 12.0
    draft = 3.8 if ijn else 4.2
    fb_mid, fb_bow, fb_stern = (4.0, 6.9, 3.4) if ijn else (4.4, 6.6, 3.8)

    parts = []
    hull = N.build_hull("hull", M, LOA, beam, draft, fb_mid, fb_bow, fb_stern,
                        n=17, boot=0.7, camber=0.25, bow_over=2.6,
                        stern_over=1.6, bow_p=2.2, bow_q=0.44,
                        wood_deck=False)
    C.assign_mat_top(hull, M["deck"], min_dot=0.85, zmin=1.6)
    parts.append(hull)

    def dz(y):
        return N.deck_height(LOA, fb_mid, fb_bow, fb_stern, y)

    # 艏樓（日軍驅逐艦特徵：前甲板抬高、後方有斷差）
    if ijn:
        parts.append(C.slab("forecastle", [
            ( 46.0, 3.4, dz(46.0) - 0.4, dz(46.0) + 1.8),
            ( 30.0, 4.6, dz(30.0) - 0.4, dz(30.0) + 2.0),
            ( 12.0, 4.8, dz(12.0) - 0.4, dz(12.0) + 2.0),
            ( 10.0, 4.6, dz(10.0) - 0.4, dz(10.0) + 2.0),
        ], mat=M["grey"]))

    base = dz(16.0) + (2.0 if ijn else 0.4)

    # 上層甲板室
    parts.append(C.slab("deckhouse", [
        ( 26.0, 3.6, base - 0.4, base + 2.4),
        (  6.0, 4.4, dz(6.0), dz(6.0) + 2.6),
        (-20.0, 4.4, dz(-20.0), dz(-20.0) + 2.6),
        (-34.0, 3.6, dz(-34.0), dz(-34.0) + 2.2),
    ], mat=M["grey"]))

    # 艦橋
    by = 20.0
    parts.append(C.taper_box("br1", (7.2, 11.0), (6.6, 9.6), 2.6,
                             (0, by, base), mat=M["grey"]))
    parts.append(C.taper_box("br2", (6.0, 7.6), (5.4, 6.6), 2.4,
                             (0, by + 0.6, base + 2.6), mat=M["grey"]))
    parts.append(C.taper_box("br3", (4.4, 5.0), (3.8, 4.4), 2.0,
                             (0, by + 1.0, base + 5.0), mat=M["grey"]))
    parts.append(C.cyl("dir", 1.1, 1.4, (0, by + 1.0, base + 7.6), verts=8,
                       mat=M["dark"]))
    parts.append(C.strut("mast", (0, by - 1.6, base + 5.2),
                         (0, by - 3.0, base + 12.0), 0.25, M["steel"], verts=5))
    parts.append(C.box("yard", (7.0, 0.2, 0.2), (0, by - 2.6, base + 9.6),
                       mat=M["steel"]))

    # 煙囪：日軍兩座後傾、美軍兩座直立
    rake = R(12) if ijn else R(2)
    fh = 7.4 if ijn else 7.0
    for fy, fr in ((4.0, 1.75), (-13.0, 1.6)):
        parts += N.funnel("funnel", M, (0, fy, dz(fy) + 2.4), fh, fr,
                          rake=rake, oval=1.25, verts=10)

    # 主砲塔
    if ijn:
        turret_spec = [(40.0, dz(40.0) + 2.0, 0.0),
                       (-30.0, dz(-30.0) + 2.4, math.pi),
                       (-44.0, dz(-44.0) + 0.4, math.pi)]
        guns, gw, blen = 2, 1.1, 5.6
    else:
        turret_spec = [(42.0, dz(42.0) + 0.4, 0.0),
                       (30.0, dz(30.0) + 2.6, 0.0),
                       (-22.0, dz(-22.0) + 2.6, math.pi),
                       (-34.0, dz(-34.0) + 1.2, math.pi),
                       (-46.0, dz(-46.0) + 0.4, math.pi)]
        guns, gw, blen = 1, 0.0, 5.4
    for (ty, tz, trz) in turret_spec:
        parts.append(C.cyl("barb", 1.9, 4.0, (0, ty, tz - 1.8), verts=10,
                           mat=M["grey"]))
        parts.append(N.gun_turret("turret", M, (0, ty, tz), half_w=2.0,
                                  length=4.2, height=2.1, guns=guns,
                                  gun_gap=gw, barrel_r=0.21, barrel_len=blen,
                                  rot_z=trz))

    # 魚雷發射管（日軍）
    if ijn:
        for ty in (-2.0, -19.0):
            tt = []
            tt.append(C.cyl("ttbase", 1.5, 1.2, (0, ty, dz(ty) + 3.2), verts=8,
                            mat=M["dark"]))
            for i, ox in enumerate((-0.75, 0.75)):
                for oz in (0.0, 1.1):
                    tt.append(C.cyl("tube", 0.36, 7.4,
                                    (ox, ty + 1.0, dz(ty) + 4.2 + oz),
                                    rot=(R(90), 0, 0), verts=8, mat=M["steel"]))
            parts += tt
        parts.append(C.box("reload", (2.6, 7.0, 1.6), (0, -10.0, dz(-10) + 3.4),
                           mat=M["grey"]))

    # 深水炸彈投射軌與艦艉構造
    for sx in (-1, 1):
        parts.append(C.box("dcrack", (0.8, 9.0, 0.7),
                           (sx * 2.2, -52.0, dz(-52.0) + 0.5), mat=M["dark"]))

    # 對空機砲
    aa = []
    if ijn:
        spots = [(2.6, 8.0), (-2.6, 8.0), (3.0, -26.0), (-3.0, -26.0),
                 (0.0, 14.0)]
    else:
        spots = [(3.2, 12.0), (-3.2, 12.0), (3.4, -6.0), (-3.4, -6.0),
                 (0.0, -40.0), (0.0, 24.0)]
    for (ax, ay) in spots:
        aa.append((ax, ay, dz(ay) + (2.8 if abs(ax) > 1 else 3.2),
                   0.0 if ay >= 0 else math.pi))
    proto = N.aa_mount("aa_proto", M, tub_r=1.0, guns=2, barrel_len=1.9)
    parts += N.scatter(proto, aa, "aa")
    bpy.data.objects.remove(proto, do_unlink=True)

    body = C.join(parts, "destroyer_" + nation)
    if not export:
        return [body]
    return C.finish([body], "destroyer_" + nation, args, tri_budget=5000,
                    water=True,
                    previews=[("side", dict(azimuth=88, elevation=4, water=True,
                                            target=(0, 0, 5)))])


def main():
    args = C.parse_args()
    for nation in ("ijn", "usn"):
        build(nation, args)


if __name__ == "__main__":
    main()
