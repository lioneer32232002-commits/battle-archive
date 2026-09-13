"""M4A1 雪曼中戰車（鑄造圓弧車體、75 mm 砲塔）。

  blender -b -P scripts/blender/sherman.py -- --out public/models

輸出 sherman.glb。物件階層：
  sherman (車體，原點在履帶底部中心)
    └ turret  (砲塔，原點在砲塔環中心，繞 Z 轉)
        ├ barrel (砲管，原點在耳軸，繞 X 俯仰)
        └ hatch  (車長艙門，原點在鉸鏈)
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector, Matrix          # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi
HULL = 'olive'
TRACK = 'metal_dark'

# 履帶側面輪廓（y, z），CCW；前後以主動輪／惰輪為圓心作弧
def track_outline(fy=2.36, ry=-2.36, cz=0.47, r=0.415, seg=5):
    bz, tz = cz - r, cz + r
    pts = [(ry, bz), (fy, bz)]
    for i in range(1, seg):
        a = -PI / 2 + PI * i / seg
        pts.append((fy + r * math.cos(a), cz + r * math.sin(a)))
    pts += [(fy, tz), (ry, tz)]
    for i in range(1, seg):
        a = PI / 2 + PI * i / seg
        pts.append((ry + r * math.cos(a), cz + r * math.sin(a)))
    return pts


TRK = track_outline()
TX = 1.06          # 履帶中心 x
TW = 0.46          # 履帶寬
TT = 0.11          # 履帶厚（外緣貼地 z=0）


def build_hull():
    b = C.B()

    # ---- 履帶與行走裝置 -------------------------------------------
    for sg in (1, -1):
        x = sg * TX
        b.band(TRK, x, TW, TT, TRACK)
        xo, xi = sg * (TX + 0.19), sg * (TX - 0.19)
        for y in (1.80, 1.24, 0.38, -0.18, -1.02, -1.58):      # 路輪
            b.tube((xi, y, 0.345), (xo, y, 0.345), 0.235, 0.235, 10, 'rubber')
        b.tube((xi, 2.36, 0.47), (xo, 2.36, 0.47), 0.300, 0.300, 12, 'steel')
        b.tube((xi, -2.36, 0.47), (xo, -2.36, 0.47), 0.280, 0.280, 12, 'steel')
        for y in (1.55, 0.10, -1.30):                          # 上支輪
            b.tube((xi, y, 0.755), (xo, y, 0.755), 0.075, 0.075, 8, 'rubber')
            b.box((0.30, 0.64, 0.40), loc=(sg * 0.95, y, 0.50), m=HULL)

    # ---- 下車體（履帶之間）---------------------------------------
    low = [(-2.62, 0.30), (2.32, 0.30), (2.80, 0.50), (2.94, 0.84),
           (2.94, 1.06), (-2.66, 1.06), (-2.74, 0.68)]
    b.prism(low, 1.64, m=HULL, rot=(PI / 2, 0, PI / 2))

    # ---- 上車體（含側裙板 / 傾斜首上裝甲）-------------------------
    up = [(-2.72, 1.00), (2.94, 1.00), (2.30, 1.78), (-2.62, 1.78), (-2.80, 1.42)]
    b.prism(up, 2.62, m=HULL, rot=(PI / 2, 0, PI / 2))

    # 擋泥板（延伸出車體的前後段）
    for sg in (1, -1):
        b.box((0.44, 0.62, 0.04), loc=(sg * 1.26, 2.62, 1.00), m=HULL)
        b.box((0.44, 0.62, 0.04), loc=(sg * 1.26, -2.42, 1.00), m=HULL)

    # 首上裝甲：兩個圓形艙門 ＋ 機槍球座 ＋ 車燈
    gl = Matrix.Translation(Vector((0, 2.62, 1.39))) @ Matrix.Rotation(math.radians(-47), 4, 'X')
    for sg in (1, -1):
        p = gl @ Vector((sg * 0.62, 0.02, 0))
        n = (gl.to_3x3() @ Vector((0, 0, 1))) * 0.07
        b.tube(tuple(p), tuple(p + n), 0.295, 0.285, 12, HULL)
    # 車首機槍
    bm = gl @ Vector((0.60, -0.30, 0))
    b.sphere(0.21, tuple(bm), 8, 4, 'steel')
    b.tube(tuple(bm), tuple(bm + Vector((0, 0.52, 0.10))), 0.035, 0.030, 6, 'gunmetal')
    for sg in (1, -1):                                   # 車燈與護弓
        p = gl @ Vector((sg * 1.02, 0.36, 0))
        b.tube(tuple(p), tuple(p + Vector((0, 0.10, 0.04))), 0.085, 0.080, 8, 'steel')
    # 備用履帶（貼在首上裝甲）
    for i in range(4):
        p = gl @ Vector((-0.05 + i * 0.16, 0.44, 0.03))
        b.box((0.14, 0.30, 0.05), loc=tuple(p), rot=(math.radians(43), 0, 0), m=TRACK)

    # ---- 後方引擎甲板與排氣 --------------------------------------
    b.box((2.30, 1.05, 0.09), loc=(0, -1.95, 1.80), m='steel')
    for sg in (1, -1):
        b.tube((sg * 0.52, -2.62, 1.35), (sg * 0.52, -2.98, 1.35), 0.085, 0.085, 8, 'steel')
    b.box((1.50, 0.42, 0.34), loc=(0, -2.55, 1.60), m=HULL)     # 後置工具箱
    b.box((0.62, 0.34, 0.30), loc=(0.95, -1.30, 1.93), m=HULL)  # 甲板雜物箱

    # 砲塔環座
    b.tube((0, -0.16, 1.70), (0, -0.16, 1.80), 0.96, 0.96, 16, 'steel')

    ob = b.finish('sherman', uv_scale=1.0)
    return ob


def build_turret():
    """砲塔本體；原點 = 砲塔環中心（世界 (0, -0.16, 1.78)）。"""
    b = C.B()
    secs = [(0.00, 1.74, 1.92), (0.16, 1.82, 2.00), (0.44, 1.74, 1.92),
            (0.62, 1.44, 1.66), (0.72, 1.16, 1.40)]
    rings = [[(q[0], q[1] + 0.06, z) for q in C.superellipse(w, d, 12, 2.6)]
             for (z, w, d) in secs]
    b.loft(rings, HULL, True, True, True)
    # 防盾（M34 砲盾）
    b.box((0.94, 0.34, 0.56), loc=(0, 0.98, 0.30), m=HULL, smooth=True)
    b.tube((0, 0.88, 0.30), (0, 1.16, 0.30), 0.23, 0.21, 10, HULL)
    # 同軸機槍孔
    b.tube((0.26, 1.10, 0.30), (0.26, 1.22, 0.30), 0.045, 0.040, 6, 'gunmetal')
    # 裝填手艙口
    b.tube((-0.36, -0.10, 0.70), (-0.36, -0.10, 0.78), 0.27, 0.26, 10, HULL)
    # 車長指揮塔
    b.tube((0.36, -0.42, 0.70), (0.36, -0.42, 0.90), 0.31, 0.31, 12, HULL)
    # 塔側儲物 / 吊環
    for sg in (1, -1):
        b.box((0.10, 0.46, 0.10), loc=(sg * 0.84, 0.10, 0.50), m=HULL)
    b.box((0.62, 0.30, 0.22), loc=(-0.30, -0.86, 0.60), m=HULL)
    # .50 白朗寧（指揮塔前）
    b.box((0.10, 0.10, 0.22), loc=(0.36, -0.18, 0.98), m='steel')
    b.tube((0.36, -0.20, 1.08), (0.36, 0.52, 1.12), 0.038, 0.032, 6, 'gunmetal')
    b.box((0.09, 0.30, 0.12), loc=(0.36, -0.34, 1.09), m='gunmetal')
    return b.finish('turret', uv_scale=1.0)


def build_barrel():
    """75 mm M3 砲管；原點 = 耳軸（砲塔本地 (0, 0.95, 0.30)）。"""
    b = C.B()
    b.tube((0, -0.18, 0), (0, 0.26, 0), 0.105, 0.098, 10, 'steel')
    b.tube((0, 0.20, 0), (0, 1.80, 0), 0.062, 0.052, 10, 'gunmetal')
    b.tube((0, 1.74, 0), (0, 1.86, 0), 0.070, 0.066, 10, 'gunmetal')
    return b.finish('barrel', uv_scale=0.5)


def build_hatch():
    """車長艙門；原點 = 鉸鏈（砲塔本地 (0.36, -0.70, 0.90)）。"""
    b = C.B()
    b.tube((0, 0.30, 0.00), (0, 0.30, 0.06), 0.30, 0.29, 12, HULL)
    return b.finish('hatch', uv_scale=0.5)


TURRET_AT = Vector((0, -0.16, 1.78))     # 砲塔環中心（世界）
BARREL_AT = Vector((0, 0.95, 0.30))      # 耳軸（砲塔本地）
HATCH_AT = Vector((0.36, -0.70, 0.90))   # 艙門鉸鏈（砲塔本地）


def build():
    """建出 [hull, turret, barrel, hatch]（已設好樞軸與父子關係，不匯出）。"""
    C.reset()
    hull = build_hull()

    turret = build_turret()
    turret.location = TURRET_AT
    bpy.context.view_layer.update()
    C.setparent(turret, hull)

    barrel = build_barrel()
    barrel.location = TURRET_AT + BARREL_AT
    bpy.context.view_layer.update()
    C.setparent(barrel, turret)

    hatch = build_hatch()
    hatch.location = TURRET_AT + HATCH_AT
    bpy.context.view_layer.update()
    C.setparent(hatch, turret)

    objs = [hull, turret, barrel, hatch]
    bpy.context.view_layer.update()
    return objs


def main():
    objs = build()
    _, n = C.export(objs, 'sherman')
    C.render(objs, 'sherman', yaw=42, pitch=20, zoom=1.05)
    C.render(objs, 'sherman_side', yaw=92, pitch=8, zoom=1.04)
    print('sherman tris =', n)


if __name__ == '__main__':
    main()
