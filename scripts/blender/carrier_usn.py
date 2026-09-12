"""美軍航艦（約克鎮級）— 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/carrier_usn.py -- --out public/models

長 247 m。深藍灰飛行甲板、右舷大型島＋三腳桅＋煙囪一體、甲板邊緣走道與砲座。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402
import _naval as N  # noqa: E402

import bpy  # noqa: E402

R = math.radians

LOA = 247.0
BEAM = 25.3
DRAFT = 7.9
FB_MID, FB_BOW, FB_STERN = 8.4, 11.2, 7.4
FD_BOT, FD_TOP = 16.6, 17.8
FD_HALF = 13.0
FD_Y0, FD_Y1 = -119.0, 122.0


def main():
    args = C.parse_args()
    C.reset_scene()
    M = N.palette("usn")

    span = FD_Y1 - FD_Y0

    def vof(y):
        return (y - FD_Y0) / span

    def uof(halfw):
        return (0.5 - halfw / (FD_HALF * 2.0), 0.5 + halfw / (FD_HALF * 2.0))

    elevators = [uof(6.0) + (vof(66.0), vof(80.0)),
                 uof(6.0) + (vof(-10.0), vof(4.0)),
                 uof(6.0) + (vof(-74.0), vof(-60.0))]
    tex = N.flight_deck_image(
        "usn_flightdeck", C.srgb(86, 94, 104), C.srgb(220, 218, 210),
        bands=((vof(114.0), vof(120.0)),),
        rects=tuple(elevators),
        wires=[vof(y) for y in (-104, -96, -88, -80, -72, -64)],
        dark_rgb=C.srgb(48, 54, 62), grain=0.035)
    M["fd"] = C.image_mat("usn_fd_mat", tex, roughness=0.86,
                          viewport_color=C.srgb(86, 94, 104))

    parts = []
    hull = N.build_hull("hull", M, LOA, BEAM, DRAFT, FB_MID, FB_BOW, FB_STERN,
                        n=20, boot=1.1, wood_deck=False, bow_over=5.0,
                        stern_over=3.0, bow_p=2.3, bow_q=0.40)
    C.assign_mat_top(hull, M["dark"], min_dot=0.85, zmin=4.0)
    parts.append(hull)

    def dz(y):
        return N.deck_height(LOA, FB_MID, FB_BOW, FB_STERN, y)

    # 機庫（開放式側舷：上緣退縮、下緣外張）
    parts.append(C.slab("hangar", [
        (  98.0,  5.0, 8.0, FD_BOT),
        (  88.0,  8.6, 8.0, FD_BOT),
        (  72.0, 11.2, 8.0, FD_BOT),
        (  40.0, 11.8, 8.0, FD_BOT),
        ( -56.0, 11.8, 8.0, FD_BOT),
        ( -84.0, 10.4, 8.0, FD_BOT),
        ( -98.0,  7.0, 8.0, FD_BOT),
        (-106.0,  4.0, 8.0, FD_BOT),
    ], mat=M["grey"]))

    # 飛行甲板
    deck = C.slab("flightdeck", [
        (FD_Y1,        4.6, FD_BOT, FD_TOP),
        (FD_Y1 - 4.0,  9.0, FD_BOT, FD_TOP),
        (FD_Y1 - 9.0, 11.8, FD_BOT, FD_TOP),
        (  96.0, 12.8, FD_BOT, FD_TOP),
        (  40.0, FD_HALF, FD_BOT, FD_TOP),
        ( -40.0, FD_HALF, FD_BOT, FD_TOP),
        (-100.0, 12.6, FD_BOT, FD_TOP),
        (-112.0, 10.4, FD_BOT, FD_TOP),
        (-116.5,  6.8, FD_BOT, FD_TOP),
        (FD_Y0,        3.4, FD_BOT, FD_TOP),
    ], mat=M["dark"])
    C.planar_uv(deck, "Z")
    C.assign_mat_top(deck, M["fd"], min_dot=0.9)
    parts.append(deck)

    # 甲板邊緣走道（兩舷連續）＋支撐
    for sx in (-1, 1):
        parts.append(C.box("catwalk", (1.3, 196.0, 0.4),
                           (sx * (FD_HALF + 0.6), 2.0, FD_BOT - 0.5),
                           mat=M["steel"]))
        for py in (108.0, 92.0, 60.0, 20.0, -20.0, -60.0, -92.0, -108.0):
            parts.append(C.strut("pillar", (sx * 5.0, py, dz(py) - 0.4),
                                 (sx * (FD_HALF - 0.8), py, FD_BOT), 0.36,
                                 M["steel"], verts=5))

    # 右舷島：艦橋＋煙囪一體＋三腳桅
    ix = FD_HALF - 2.6
    parts.append(C.taper_box("isl1", (6.4, 32.0), (5.8, 30.0), 4.6,
                             (ix, 16.0, FD_TOP), mat=M["grey"]))
    parts.append(C.taper_box("isl2", (7.2, 18.0), (6.2, 16.0), 3.4,
                             (ix, 24.0, FD_TOP + 4.6), mat=M["grey"]))
    parts.append(C.taper_box("isl3", (5.6, 11.0), (4.8, 9.4), 3.0,
                             (ix, 26.0, FD_TOP + 8.0), mat=M["grey"]))
    parts.append(C.box("isl_rf", (7.6, 1.4, 1.1), (ix, 27.0, FD_TOP + 11.6),
                       mat=M["dark"]))
    # 煙囪與艦橋整合（後半段、微後傾）
    parts.append(C.taper_box("stack", (5.6, 12.0), (5.0, 10.0), 10.0,
                             (ix, 6.0, FD_TOP + 4.6), mat=M["grey"],
                             top_offset=(0.0, -1.4)))
    parts.append(C.box("stackcap", (4.9, 9.8, 0.6), (ix, 4.6, FD_TOP + 14.8),
                       mat=M["dark"]))
    # 三腳桅
    parts += N.tripod_mast("mast", M, (ix, 12.0, FD_TOP + 4.0),
                           (ix, 13.0, FD_TOP + 27.0), spread=3.4, r=0.34,
                           yard=9.0)
    parts.append(C.box("radar", (5.2, 0.6, 1.6), (ix, 13.4, FD_TOP + 27.6),
                       mat=M["steel"]))

    # 5 吋砲座（島前後各兩座、左舷四座）與 20/40 mm 砲廊
    gun_pos = []
    for gy in (70.0, 46.0, -18.0, -44.0):
        gun_pos.append((FD_HALF - 0.4, gy))
    for gy in (74.0, 40.0, -24.0, -58.0):
        gun_pos.append((-(FD_HALF - 0.4), gy))
    for (gx, gy) in gun_pos:
        parts.append(C.box("guntub", (5.0, 7.0, 0.8), (gx, gy, FD_BOT - 1.6),
                           mat=M["grey"]))
        parts.append(N.gun_turret("mount5in", M, (gx, gy, FD_BOT - 1.2),
                                  half_w=1.5, length=3.2, height=1.8, guns=1,
                                  barrel_r=0.24, barrel_len=5.4,
                                  rot_z=R(-40) if gx > 0 else R(40)))

    aa_pos = []
    for sy in (104.0, 88.0, 26.0, 6.0, -34.0, -78.0, -98.0):
        for sx in (-1, 1):
            px = sx * (FD_HALF + 0.4)
            parts.append(C.box("aatub", (3.4, 5.2, 0.6), (px, sy, FD_BOT - 1.0),
                               mat=M["grey"]))
            aa_pos.append((px, sy, FD_BOT - 0.7, 0.0 if sx > 0 else math.pi))
    proto = N.aa_mount("aa_proto", M, tub_r=1.5, guns=4, barrel_len=2.4)
    parts += N.scatter(proto, aa_pos, "aa")
    bpy.data.objects.remove(proto, do_unlink=True)

    body = C.join(parts, "carrier_usn")
    return C.finish([body], "carrier_usn", args, tri_budget=10000, water=True,
                    previews=[("side", dict(azimuth=88, elevation=4, water=True,
                                            target=(0, 0, 9))),
                              ("top", dict(azimuth=30, elevation=52,
                                           water=True))])


if __name__ == "__main__":
    main()
