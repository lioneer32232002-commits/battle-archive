"""日軍航艦（赤城／加賀型）— 程序化建模（規格 §2.1）

    blender -b -P scripts/blender/carrier_ijn.py -- --out public/models

輸出 carrier_ijn_L.glb（島式艦橋在左舷＝赤城）與 carrier_ijn_R.glb（右舷＝加賀）。
長 260 m。飛行甲板木色、甲板中線與邊線用小貼圖；煙囪橫向外伸下彎（日軍航艦特徵）。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402
import _naval as N  # noqa: E402

R = math.radians

LOA = 260.0
BEAM = 31.3
DRAFT = 8.7
FB_MID, FB_BOW, FB_STERN = 8.6, 11.6, 7.6
FD_BOT, FD_TOP = 19.2, 20.5      # 飛行甲板上下緣
FD_HALF = 15.2


def build(side, args, export=True):
    """side: -1 左舷島（赤城）／ +1 右舷島（加賀）。export=False 只回傳物件。"""
    C.reset_scene()
    M = N.palette("ijn")
    # 飛行甲板貼圖：v=0 艦艉、v=1 艦艏（甲板 y 從 -119 到 126）
    def vof(y):
        return (y + 119.0) / 245.0

    def uof(halfw):
        return (0.5 - halfw / 30.4, 0.5 + halfw / 30.4)

    e1 = uof(6.3) + (vof(54.5), vof(69.5))
    e2 = uof(6.3) + (vof(-41.5), vof(-26.5))
    tex = N.flight_deck_image(
        "ijn_flightdeck", C.srgb(158, 138, 108), C.srgb(222, 218, 206),
        bands=((vof(118.0), vof(124.0)), (vof(-116.5), vof(-112.0))),
        rects=(e1, e2),
        wires=[vof(y) for y in (-92, -84, -76, -68, -60)],
        dark_rgb=C.srgb(84, 74, 60))
    M["fd"] = C.image_mat("ijn_fd_mat", tex, roughness=0.82,
                          viewport_color=C.srgb(158, 138, 108))

    parts = []
    hull = N.build_hull("hull", M, LOA, BEAM, DRAFT, FB_MID, FB_BOW, FB_STERN,
                        n=20, boot=1.2, wood_deck=False, bow_over=5.0,
                        stern_over=3.5, bow_p=2.4, bow_q=0.40)
    C.assign_mat_top(hull, M["dark"], min_dot=0.85, zmin=4.0)
    parts.append(hull)

    def dz(y):
        return N.deck_height(LOA, FB_MID, FB_BOW, FB_STERN, y)

    # 機庫／甲板下艦體（撐起飛行甲板）
    hangar = C.slab("hangar", [
        ( 106.0,  5.5, 8.0, FD_BOT),
        (  98.0,  9.5, 8.0, FD_BOT),
        (  84.0, 12.4, 8.0, FD_BOT),
        (  60.0, 13.6, 8.0, FD_BOT),
        ( -50.0, 13.6, 8.0, FD_BOT),
        ( -80.0, 12.6, 8.0, FD_BOT),
        ( -96.0,  9.5, 8.0, FD_BOT),
        (-104.0,  5.5, 8.0, FD_BOT),
    ], mat=M["grey"])
    parts.append(hangar)

    # 飛行甲板（艦艏艦艉圓弧）
    deck = C.slab("flightdeck", [
        ( 126.0,  5.4, FD_BOT, FD_TOP),
        ( 122.0, 10.4, FD_BOT, FD_TOP),
        ( 116.0, 13.6, FD_BOT, FD_TOP),
        ( 104.0, 15.0, FD_BOT, FD_TOP),
        (  60.0, FD_HALF, FD_BOT, FD_TOP),
        ( -60.0, FD_HALF, FD_BOT, FD_TOP),
        (-104.0, 14.8, FD_BOT, FD_TOP),
        (-113.0, 12.4, FD_BOT, FD_TOP),
        (-117.0,  8.0, FD_BOT, FD_TOP),
        (-119.0,  4.0, FD_BOT, FD_TOP),
    ], mat=M["dark"])
    C.planar_uv(deck, "Z")
    C.assign_mat_top(deck, M["fd"], min_dot=0.9)
    parts.append(deck)

    # 飛行甲板支柱（艦艏艦艉外伸段）
    for py, px in ((114.0, 8.0), (114.0, -8.0), (-100.0, 8.0), (-100.0, -8.0),
                   (120.0, 3.0), (120.0, -3.0), (-110.0, 3.0), (-110.0, -3.0)):
        parts.append(C.strut("pillar", (px, py, dz(py) - 0.5), (px * 0.8, py, FD_BOT),
                             0.42, M["steel"], verts=5))

    # 島式艦橋（小型，側舷）
    ix = side * (FD_HALF - 3.0)
    parts.append(C.taper_box("island1", (6.6, 19.0), (6.0, 17.0), 4.6,
                             (ix, 26.0, FD_TOP), mat=M["grey"]))
    parts.append(C.taper_box("island2", (7.6, 12.6), (6.6, 11.0), 3.0,
                             (ix, 26.0, FD_TOP + 4.6), mat=M["grey"]))
    parts.append(C.taper_box("island3", (4.8, 7.0), (4.0, 6.0), 2.8,
                             (ix, 26.0, FD_TOP + 7.6), mat=M["grey"]))
    parts.append(C.strut("islandmast", (ix, 26.0, FD_TOP + 10.4),
                         (ix, 24.5, FD_TOP + 17.0), 0.28, M["steel"], verts=5))
    parts.append(C.box("islandyard", (6.0, 0.22, 0.22),
                       (ix, 24.8, FD_TOP + 14.2), mat=M["steel"]))
    parts.append(C.cyl("islandrf", 0.7, 5.2, (ix, 26.0, FD_TOP + 8.8),
                       rot=(0, R(90), 0), verts=8, mat=M["dark"]))

    # 煙囪：右舷橫向外伸再下彎（日軍航艦特徵）
    parts.append(C.strut("funnel_main", (12.0, -6.0, 12.6), (20.5, -8.0, 3.6),
                         3.5, M["dark"], verts=12))
    parts.append(C.cyl("funnel_mouth", 3.6, 1.2, (20.8, -8.2, 3.2),
                       rot=(R(-56), 0, R(-22)), verts=12, mat=M["steel"]))
    parts.append(C.strut("funnel_aux", (12.4, -20.0, 12.4), (17.6, -21.0, 8.6),
                         1.7, M["dark"], verts=8))
    parts.append(C.box("funnel_fair", (5.0, 16.0, 5.0), (12.6, -12.0, 12.0),
                       mat=M["grey"]))

    # 舷側防空砲座平台
    sponsons = []
    for sy in (86.0, 62.0, 34.0, -6.0, -40.0, -70.0, -92.0):
        for sx in (-1, 1):
            px = sx * (FD_HALF - 0.6)
            parts.append(C.box("sponson", (5.0, 9.0, 0.7), (px, sy, 14.6),
                               mat=M["grey"]))
            parts.append(C.strut("sponsonleg", (px * 0.82, sy, dz(sy) + 0.5),
                                 (px, sy, 14.4), 0.3, M["steel"], verts=4))
            sponsons.append((px, sy, 15.0, 0.0 if sx > 0 else math.pi))

    # 甲板邊走道
    for sx in (-1, 1):
        parts.append(C.box("catwalk", (0.9, 190.0, 0.35),
                           (sx * (FD_HALF + 0.3), 0.0, FD_BOT - 0.4),
                           mat=M["steel"]))

    # 對空機砲
    proto = N.aa_mount("aa_proto", M, tub_r=1.9, guns=2, barrel_len=3.0)
    parts += N.scatter(proto, sponsons, "aa")
    import bpy
    bpy.data.objects.remove(proto, do_unlink=True)

    # 20 cm 砲（赤城／加賀早期的舷側砲廓）
    for gy in (-58.0, -76.0):
        for sx in (-1, 1):
            parts.append(N.gun_turret("casemate", M,
                                      (sx * 13.4, gy, dz(gy) + 0.4),
                                      half_w=1.9, length=4.0, height=2.0,
                                      guns=1, barrel_r=0.28, barrel_len=5.0,
                                      rot_z=R(-48) * sx))

    body = C.join(parts, "carrier_ijn")
    name = "carrier_ijn_" + ("L" if side < 0 else "R")
    if not export:
        body.name = body.data.name = name
        return [body]
    return C.finish([body], name, args, tri_budget=10000, water=True,
                    previews=[("side", dict(azimuth=88, elevation=4, water=True,
                                            target=(0, 0, 10))),
                              ("top", dict(azimuth=30, elevation=52,
                                           water=True))])


def main():
    args = C.parse_args()
    for side in (-1, 1):
        build(side, args)


if __name__ == "__main__":
    main()
