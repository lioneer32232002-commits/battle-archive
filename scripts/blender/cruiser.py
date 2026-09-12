"""重巡洋艦（日軍高雄／最上型、美軍紐奧良型）— 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/cruiser.py -- --out public/models

輸出 cruiser_ijn.glb、cruiser_usn.glb，長 200 m。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402
import _naval as N  # noqa: E402

import bpy  # noqa: E402

R = math.radians
LOA = 200.0


def build(nation, args):
    C.reset_scene()
    M = N.palette(nation)
    ijn = nation == "ijn"
    beam = 19.0 if ijn else 18.8
    draft = 6.3 if ijn else 6.9
    fb_mid, fb_bow, fb_stern = (6.6, 10.6, 5.4) if ijn else (7.0, 10.2, 5.8)

    parts = []
    hull = N.build_hull("hull", M, LOA, beam, draft, fb_mid, fb_bow, fb_stern,
                        n=19, boot=0.9, camber=0.3, bow_over=4.0,
                        stern_over=2.4, bow_p=2.3, bow_q=0.42,
                        wood_deck=False)
    C.assign_mat_top(hull, M["deck"], min_dot=0.85, zmin=2.6)
    parts.append(hull)

    def dz(y):
        return N.deck_height(LOA, fb_mid, fb_bow, fb_stern, y)

    # 上層甲板室
    parts.append(C.slab("deckhouse", [
        ( 48.0, 5.4, dz(48.0) - 0.4, dz(48.0) + 3.0),
        ( 30.0, 7.4, dz(30.0) - 0.4, dz(30.0) + 3.4),
        (  0.0, 8.0, dz(0.0) - 0.4, dz(0.0) + 3.6),
        (-34.0, 7.4, dz(-34.0) - 0.4, dz(-34.0) + 3.4),
        (-56.0, 5.6, dz(-56.0) - 0.4, dz(-56.0) + 2.8),
    ], mat=M["grey"]))

    base = dz(30.0) + 3.4
    by = 32.0 if ijn else 26.0

    if ijn:
        # 塔式（違章建築式）艦橋
        stack = [((13.0, 17.0), (12.0, 15.4), 3.4, 0.0),
                 ((11.0, 13.4), (10.2, 12.2), 3.0, 3.4),
                 ((9.0, 10.4), (8.4, 9.4), 2.8, 6.4),
                 ((7.2, 8.0), (6.6, 7.4), 2.6, 9.2),
                 ((5.0, 5.4), (4.4, 4.8), 2.4, 11.8)]
        for i, (b, t, h, z) in enumerate(stack):
            parts.append(C.taper_box("br%d" % i, b, t, h, (0, by, base + z),
                                     mat=M["grey"]))
            parts.append(C.box("brplat%d" % i, (b[0] + 1.4, b[1] + 1.4, 0.28),
                               (0, by, base + z + h * 0.97), mat=M["dark"]))
        parts.append(C.cyl("rf", 0.8, 6.4, (0, by, base + 14.6),
                           rot=(0, R(90), 0), verts=8, mat=M["dark"]))
        parts.append(C.strut("fmast", (0, by - 1.0, base + 15.4),
                             (0, by - 2.6, base + 24.0), 0.3, M["steel"],
                             verts=5))
        parts.append(C.box("fyard", (9.0, 0.24, 0.24), (0, by - 2.2,
                           base + 21.0), mat=M["steel"]))
    else:
        # 箱型艦橋＋三腳前桅
        parts.append(C.taper_box("br0", (13.4, 20.0), (12.4, 18.0), 3.2,
                                 (0, by, base), mat=M["grey"]))
        parts.append(C.taper_box("br1", (11.0, 13.0), (10.0, 11.6), 3.0,
                                 (0, by + 1.0, base + 3.2), mat=M["grey"]))
        parts.append(C.taper_box("br2", (8.2, 9.0), (7.4, 8.0), 2.8,
                                 (0, by + 1.6, base + 6.2), mat=M["grey"]))
        parts.append(C.box("brplat", (10.4, 10.6, 0.3), (0, by + 1.6,
                           base + 8.9), mat=M["dark"]))
        parts.append(C.cyl("rf", 0.8, 6.0, (0, by + 1.6, base + 9.6),
                           rot=(0, R(90), 0), verts=8, mat=M["dark"]))
        parts += N.tripod_mast("fmast", M, (0, by - 3.0, base + 6.4),
                               (0, by - 4.0, base + 24.0), spread=3.6, r=0.34,
                               yard=10.0)

    # 煙囪
    if ijn:
        for fy, fr, fh in ((6.0, 3.2, 12.0), (-12.0, 2.7, 11.0)):
            parts += N.funnel("funnel", M, (0, fy, dz(fy) + 3.4), fh, fr,
                              rake=R(16), oval=1.3, verts=12)
    else:
        for fy, fr, fh in ((4.0, 2.9, 11.0), (-16.0, 2.7, 10.5)):
            parts += N.funnel("funnel", M, (0, fy, dz(fy) + 3.4), fh, fr,
                              rake=R(4), oval=1.15, verts=12)

    # 主砲塔
    if ijn:
        spec = [(64.0, 0.0), (52.0, 0.0), (40.0, 0.0),
                (-44.0, math.pi), (-58.0, math.pi)]
        lifts = {64.0: 0.6, 52.0: 3.0, 40.0: 5.6, -44.0: 3.2, -58.0: 0.6}
        guns, gap, br, bl, hw, ln, hh = 2, 2.0, 0.32, 9.0, 3.2, 6.4, 3.0
    else:
        spec = [(60.0, 0.0), (46.0, 0.0), (-52.0, math.pi)]
        lifts = {60.0: 0.6, 46.0: 3.4, -52.0: 0.6}
        guns, gap, br, bl, hw, ln, hh = 3, 2.2, 0.34, 9.6, 3.9, 7.0, 3.2
    for (ty, trz) in spec:
        tz = dz(ty) + lifts[ty]
        parts.append(C.cyl("barb", hw * 0.92, 8.0, (0, ty, tz - 3.6), verts=12,
                           mat=M["grey"]))
        parts.append(N.gun_turret("turret", M, (0, ty, tz), half_w=hw,
                                  length=ln, height=hh, guns=guns, gun_gap=gap,
                                  barrel_r=br, barrel_len=bl, rot_z=trz))

    # 副砲（高角砲）
    sec_y = (18.0, -2.0, -24.0) if ijn else (14.0, -4.0, -28.0)
    for gy in sec_y:
        for sx in (-1, 1):
            parts.append(N.gun_turret("sec", M,
                                      (sx * (beam * 0.43), gy, dz(gy) + 3.4),
                                      half_w=1.5, length=3.0, height=1.8,
                                      guns=2, gun_gap=1.0, barrel_r=0.2,
                                      barrel_len=5.0, rot_z=R(-42) * sx))

    # 魚雷發射管（日軍：舷側四聯裝）
    if ijn:
        for ty in (-6.0, -22.0):
            for sx in (-1, 1):
                px = sx * (beam * 0.46)
                parts.append(C.box("ttbase", (2.6, 8.2, 1.4),
                                   (px, ty, dz(ty) + 1.4), mat=M["dark"]))
                for oz in (0.0, 1.0):
                    for ox in (-0.6, 0.6):
                        parts.append(C.cyl("tube", 0.34, 8.0,
                                           (px + ox, ty, dz(ty) + 2.4 + oz),
                                           rot=(R(90), 0, 0), verts=6,
                                           mat=M["steel"]))

    # 艦艉航空設施：彈射器、起重機、水上機甲板
    for sx in (-1, 1):
        parts.append(C.box("catapult", (1.6, 19.0, 0.7),
                           (sx * 5.4, -74.0, dz(-74.0) + 1.4), mat=M["dark"]))
    parts.append(C.box("airdeck", (13.0, 26.0, 1.6), (0, -72.0,
                       dz(-72.0) + 0.8), mat=M["grey"]))
    parts.append(C.cyl("cranebase", 1.3, 4.0, (6.2, -88.0, dz(-88.0) + 1.6),
                       verts=8, mat=M["grey"]))
    parts.append(C.strut("craneboom", (6.2, -88.0, dz(-88.0) + 3.4),
                         (5.0, -74.0, dz(-74.0) + 11.0), 0.4, M["steel"],
                         verts=6))

    # 主桅
    parts += N.tripod_mast("mmast", M, (0, -30.0, dz(-30.0) + 3.6),
                           (0, -32.0, dz(-30.0) + 24.0), spread=3.2, r=0.3,
                           yard=8.0)

    # 對空機砲
    aa = []
    for (ax, ay) in ((5.6, 22.0), (-5.6, 22.0), (6.4, -8.0), (-6.4, -8.0),
                     (5.6, -34.0), (-5.6, -34.0), (0.0, -64.0), (0.0, 34.0)):
        aa.append((ax, ay, dz(ay) + 3.8, 0.0 if ay >= 0 else math.pi))
    proto = N.aa_mount("aa_proto", M, tub_r=1.3, guns=2 if ijn else 4,
                       barrel_len=2.4)
    parts += N.scatter(proto, aa, "aa")
    bpy.data.objects.remove(proto, do_unlink=True)

    body = C.join(parts, "cruiser_" + nation)
    return C.finish([body], "cruiser_" + nation, args, tri_budget=5000,
                    water=True,
                    previews=[("side", dict(azimuth=88, elevation=4, water=True,
                                            target=(0, 0, 7)))])


def main():
    args = C.parse_args()
    for nation in ("ijn", "usn"):
        build(nation, args)


if __name__ == "__main__":
    main()
