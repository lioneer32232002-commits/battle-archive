"""StuG III Ausf. G 突擊砲（低矮無砲塔、豬頭砲盾、側裙板）。

  blender -b -P scripts/blender/stug.py -- --out public/models

輸出 stug.glb。物件階層：
  stug (車體，原點在履帶底部中心)
    └ barrel (7.5 cm StuK 40 砲管，原點在耳軸，繞 X 俯仰)
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector                  # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi
HULL = 'panzer_grey'
TRACK = 'metal_dark'

TX, TW, TT = 1.27, 0.38, 0.09


def track_outline(fy=2.22, ry=-2.22, cz=0.445, r=0.40, seg=6):
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

BARREL_AT = Vector((0.14, 2.30, 1.32))     # 耳軸（世界）


def build_hull():
    b = C.B()

    # ---- 履帶與行走裝置（三號戰車底盤：六負重輪、三上支輪）--------
    for sg in (1, -1):
        b.band(TRK, sg * TX, TW, TT, TRACK)
        xo, xi = sg * (TX + 0.16), sg * (TX - 0.16)
        for y in (1.62, 1.00, 0.38, -0.24, -0.86, -1.48):
            b.tube((xi, y, 0.32), (xo, y, 0.32), 0.235, 0.235, 10, 'rubber')
            b.tube((xi, y, 0.32), (xo * 0.995, y, 0.32), 0.085, 0.085, 6, 'steel')
        b.tube((xi, 2.22, 0.445), (xo, 2.22, 0.445), 0.290, 0.290, 12, 'steel')
        b.tube((xi, -2.22, 0.445), (xo, -2.22, 0.445), 0.265, 0.265, 12, 'steel')
        for y in (1.35, 0.10, -1.25):
            b.tube((xi, y, 0.76), (xo, y, 0.76), 0.075, 0.075, 8, 'rubber')

    # ---- 下車體 ---------------------------------------------------
    low = [(-2.62, 0.26), (2.38, 0.26), (2.66, 0.46), (2.72, 0.78),
           (2.72, 1.04), (-2.70, 1.04), (-2.76, 0.62)]
    b.prism(low, 2.16, m=HULL, rot=(PI / 2, 0, PI / 2))

    # ---- 戰鬥室（低矮casemate，前傾斜甲）--------------------------
    up = [(-1.86, 1.02), (2.72, 1.02), (2.72, 1.16), (1.52, 1.70),
          (-1.86, 1.70)]
    b.prism(up, 2.86, m=HULL, rot=(PI / 2, 0, PI / 2))
    # 戰鬥室兩側下緣的延伸板（蓋住履帶上方）
    for sg in (1, -1):
        b.box((0.36, 4.58, 0.16), loc=(sg * 1.25, 0.43, 0.96), m=HULL)

    # ---- 引擎甲板 -------------------------------------------------
    b.prism([(-2.70, 1.02), (-1.82, 1.02), (-1.82, 1.22), (-2.64, 1.22)],
            2.16, m=HULL, rot=(PI / 2, 0, PI / 2))
    for sg in (1, -1):
        b.box((0.70, 0.62, 0.10), loc=(sg * 0.52, -2.16, 1.27), m='steel')
    b.tube((0.92, -2.70, 0.72), (0.92, -2.96, 0.72), 0.10, 0.10, 8, 'steel')

    # ---- 豬頭砲盾（Saukopf）--------------------------------------
    mb = Vector((0.14, 2.58, 1.32))
    b.sphere(0.46, tuple(mb), 10, 5, HULL, smooth=True,
             scale=(0.92, 1.25, 0.86))
    b.box((0.92, 0.30, 0.78), loc=(0.14, 2.30, 1.32), m=HULL, smooth=True)

    # ---- 車頂：指揮塔、機槍盾、艙門 ------------------------------
    b.tube((-0.62, -1.02, 1.70), (-0.62, -1.02, 1.92), 0.34, 0.33, 12, HULL)
    b.tube((-0.62, -1.02, 1.92), (-0.62, -1.02, 1.97), 0.32, 0.30, 12, HULL)
    b.box((0.62, 0.58, 0.06), loc=(0.58, -0.92, 1.72), m=HULL)       # 裝填手艙門
    # MG34 防盾與槍
    b.prism([(-0.34, 0), (0.34, 0), (0.34, 0.34), (-0.34, 0.42)], 0.04,
            m='steel', loc=(0.62, -0.18, 1.70), rot=(PI / 2, 0, 0))
    b.tube((0.62, -0.32, 1.86), (0.62, 0.24, 1.90), 0.035, 0.030, 6, 'gunmetal')

    # ---- 側裙板（Schürzen）---------------------------------------
    for sg in (1, -1):
        for i, y in enumerate((-1.70, -0.55, 0.60, 1.75)):
            b.box((0.025, 1.12, 0.74), loc=(sg * 1.50, y, 0.99), m=HULL)
        b.box((0.05, 4.60, 0.06), loc=(sg * 1.50, 0.02, 1.38), m='steel')

    # ---- 雜物：備用負重輪、工具箱 --------------------------------
    for i in (-1, 1):
        b.tube((i * 0.50, -2.30, 1.22), (i * 0.50, -2.30, 1.31), 0.235, 0.235, 10, 'steel')
    b.box((0.16, 0.90, 0.16), loc=(-1.32, -0.60, 1.02), m='steel')   # 側掛工具
    b.box((0.80, 0.42, 0.24), loc=(0, -1.55, 1.34), m=HULL)          # 引擎甲板工具箱

    return b.finish('stug', uv_scale=1.0)


def build_barrel():
    """7.5 cm StuK 40 L/48；原點 = 耳軸，砲口朝 +Y。"""
    b = C.B()
    b.tube((0, -0.55, 0), (0, 0.18, 0), 0.115, 0.105, 10, 'steel')
    b.tube((0, 0.10, 0), (0, 1.92, 0), 0.070, 0.056, 10, 'gunmetal')
    b.tube((0, 1.90, 0), (0, 2.18, 0), 0.098, 0.094, 10, 'gunmetal')  # 制退器
    b.box((0.22, 0.05, 0.21), loc=(0, 1.99, 0), m='gunmetal')
    b.box((0.22, 0.05, 0.21), loc=(0, 2.12, 0), m='gunmetal')
    return b.finish('barrel', uv_scale=0.5)


def build():
    """建出 [hull, barrel]（已設好樞軸與父子關係，不匯出）。"""
    C.reset()
    hull = build_hull()
    barrel = build_barrel()
    barrel.location = BARREL_AT
    bpy.context.view_layer.update()
    C.setparent(barrel, hull)
    objs = [hull, barrel]
    bpy.context.view_layer.update()
    return objs


def main():
    objs = build()
    _, n = C.export(objs, 'stug')
    C.render(objs, 'stug', yaw=42, pitch=18, zoom=1.05)
    C.render(objs, 'stug_side', yaw=92, pitch=8, zoom=1.04)
    print('stug tris =', n)


if __name__ == '__main__':
    main()
