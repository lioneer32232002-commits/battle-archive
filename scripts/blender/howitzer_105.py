"""10.5 cm leFH 18 輕型野戰榴彈砲（開腳大架、防盾、可俯仰砲管）。

  blender -b -P scripts/blender/howitzer_105.py -- --out public/models

輸出 howitzer_105.glb。物件階層：
  howitzer_105 (砲架，原點在輪子接地點中心)
    └ barrel (砲管，原點在耳軸，繞 X 俯仰)
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector                  # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi
GUN = 'panzer_grey'

TRUNNION = Vector((0, 0.28, 1.02))     # 耳軸（世界）
WHEEL_R = 0.65


def build_carriage():
    b = C.B()

    # ---- 車輪（鋼輻條輪）-----------------------------------------
    for sg in (1, -1):
        x = sg * 0.86
        b.tube((x - 0.075, 0, WHEEL_R), (x + 0.075, 0, WHEEL_R),
               WHEEL_R, WHEEL_R, 16, 'rubber')
        b.tube((x - 0.085, 0, WHEEL_R), (x + 0.085, 0, WHEEL_R),
               WHEEL_R - 0.09, WHEEL_R - 0.09, 16, GUN)
        b.tube((x - 0.10, 0, WHEEL_R), (x + 0.10, 0, WHEEL_R), 0.14, 0.14, 10, GUN)
        for i in range(6):                       # 輻條
            a = PI * i / 6
            p = Vector((x, math.cos(a) * (WHEEL_R - 0.12), WHEEL_R + math.sin(a) * (WHEEL_R - 0.12)))
            q = Vector((x, -math.cos(a) * (WHEEL_R - 0.12), WHEEL_R - math.sin(a) * (WHEEL_R - 0.12)))
            b.beam(tuple(p), tuple(q), 0.055, 0.035, GUN)

    # ---- 軸與搖架座 ----------------------------------------------
    b.tube((-0.86, 0, WHEEL_R), (0.86, 0, WHEEL_R), 0.075, 0.075, 8, GUN)
    b.box((0.70, 0.58, 0.46), loc=(0, 0.10, 0.86), m=GUN)
    for sg in (1, -1):                           # 耳軸托架
        b.box((0.12, 0.34, 0.46), loc=(sg * 0.30, 0.28, 1.00), m=GUN)
    b.box((0.46, 0.52, 0.26), loc=(0, 0.06, 1.22), m=GUN)   # 搖架

    # ---- 防盾 -----------------------------------------------------
    sh = [(-0.86, -0.10), (0.86, -0.10), (0.86, 0.58), (0.62, 0.86),
          (-0.62, 0.86), (-0.86, 0.58)]
    b.prism(sh, 0.035, m=GUN, loc=(0, 0.60, 0.86), rot=(math.radians(76), 0, 0))
    # 防盾下擺（可掀下的一片）
    b.prism([(-0.80, -0.44), (0.80, -0.44), (0.80, 0.0), (-0.80, 0.0)], 0.03,
            m=GUN, loc=(0, 0.576, 0.766), rot=(math.radians(96), 0, 0))
    # 砲口開孔兩側的加強肋
    for sg in (1, -1):
        b.box((0.05, 0.06, 0.52), loc=(sg * 0.34, 0.62, 1.10), m=GUN)

    # ---- 開腳大架（兩根箱形托架）---------------------------------
    for sg in (1, -1):
        a = Vector((sg * 0.26, -0.20, 0.78))
        c = Vector((sg * 0.58, -3.05, 0.22))
        b.beam(tuple(a), tuple(c), 0.20, 0.26, GUN, w1=0.14, h1=0.17)
        b.box((0.22, 0.34, 0.40), loc=(sg * 0.58, -3.14, 0.20),
              rot=(math.radians(-12), 0, 0), m='steel')      # 駐鋤
        b.tube((sg * 0.58, -2.86, 0.34), (sg * 0.58, -2.86, 0.62), 0.03, 0.03, 6, GUN)
        b.beam((sg * 0.50, -2.60, 0.60), (sg * 0.66, -2.60, 0.60), 0.05, 0.05, 'wood')
    b.beam((-0.30, -0.62, 0.72), (0.30, -0.62, 0.72), 0.09, 0.09, GUN)  # 大架連桿

    # ---- 瞄準具與手輪 --------------------------------------------
    b.box((0.14, 0.16, 0.30), loc=(-0.44, 0.20, 1.30), m=GUN)
    b.tube((-0.56, 0.22, 1.42), (-0.56, 0.34, 1.44), 0.055, 0.05, 8, 'gunmetal')
    for sg in (1, -1):
        b.tube((sg * 0.52, -0.26, 1.02), (sg * 0.58, -0.26, 1.02), 0.15, 0.15, 10, GUN)

    return b.finish('howitzer_105', uv_scale=0.6)


def build_barrel():
    """10.5 cm 砲管；原點 = 耳軸，砲口朝 +Y。"""
    b = C.B()
    b.tube((0, -0.86, 0), (0, -0.30, 0), 0.155, 0.150, 10, GUN)      # 砲閂
    b.tube((0, -0.34, 0), (0, 0.52, 0), 0.128, 0.112, 10, GUN)       # 套筒
    b.tube((0, 0.46, 0), (0, 2.28, 0), 0.078, 0.062, 10, 'gunmetal')
    b.tube((0, 2.24, 0), (0, 2.36, 0), 0.082, 0.078, 10, 'gunmetal')
    for sg in (1, -1):                                               # 復進筒
        b.tube((sg * 0.11, -0.24, 0.10), (sg * 0.11, 0.72, 0.10), 0.048, 0.044, 8, GUN)
    b.box((0.30, 0.22, 0.16), loc=(0, -0.92, 0.02), m='steel')
    return b.finish('barrel', uv_scale=0.4)


def build():
    """建出 [carriage, barrel]（已設好樞軸與父子關係，不匯出）。"""
    C.reset()
    car = build_carriage()
    bar = build_barrel()
    bar.location = TRUNNION
    bpy.context.view_layer.update()
    C.setparent(bar, car)
    objs = [car, bar]
    bpy.context.view_layer.update()
    return objs


def main():
    objs = build()
    _, n = C.export(objs, 'howitzer_105')
    C.render(objs, 'howitzer_105', yaw=44, pitch=18, zoom=1.05)
    print('howitzer_105 tris =', n)


if __name__ == '__main__':
    main()
