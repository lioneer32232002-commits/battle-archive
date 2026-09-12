"""機槍巢：半圓雙層沙包掩體 ＋ MG42 三腳架（Lafette 42）。

  blender -b -P scripts/blender/mg_nest.py -- --out public/models

輸出 mg_nest.glb。射向為 +Y（匯出後 glTF -Z），原點在地面中心。
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector, Matrix          # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi
TAU = math.tau

BAG_W, BAG_D, BAG_H = 0.54, 0.30, 0.26        # 單個沙包尺寸


def sandbag(b, loc, yaw, m='sandbag', w=BAG_W, d=BAG_D, h=BAG_H, jitter=0.0):
    """枕形沙包：三環 superellipse loft。"""
    w *= 1.0 + jitter
    secs = [(0.00, w * 0.84, d * 0.80),
            (h * 0.50, w, d),
            (h * 1.00, w * 0.84, d * 0.80)]
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(yaw, 4, 'Z')
    rings = [[tuple(M @ Vector((q[0], q[1], z)))
              for q in C.superellipse(ww, dd, 8, 3.4)] for (z, ww, dd) in secs]
    b.loft(rings, m, True, True, True)


def wall(b, r, z0, count, a0, a1, phase=0.0, m='sandbag', skip=()):
    """沿半徑 r 的圓弧排一列沙包。"""
    for i in range(count):
        if i in skip:
            continue
        t = (i + 0.5 + phase) / count
        a = a0 + (a1 - a0) * t
        p = (r * math.cos(a), r * math.sin(a), z0)
        sandbag(b, p, a - PI / 2, m, jitter=0.04 * math.sin(i * 2.3))


def build():
    b = C.B()
    A0, A1 = math.radians(-28), math.radians(208)

    # 雙層牆（外、內各兩階），上階中央留射孔
    wall(b, 1.46, 0.00, 11, A0, A1, 0.0)
    wall(b, 1.46, BAG_H, 11, A0, A1, 0.5, skip=(5,))
    wall(b, 1.15, 0.00, 9, A0 + 0.12, A1 - 0.12, 0.0)
    wall(b, 1.15, BAG_H, 9, A0 + 0.12, A1 - 0.12, 0.5, skip=(4,))

    # 射孔兩側的加高沙包（形成槍眼）
    for sg in (1, -1):
        a = PI / 2 + sg * math.radians(17)
        sandbag(b, (1.46 * math.cos(a), 1.46 * math.sin(a), BAG_H * 2), a - PI / 2,
                w=BAG_W * 0.8, h=BAG_H * 0.85)

    # 地面（踩踏過的土）
    b.lathe([(1.62, 0.015), (1.62, -0.02)], 20, 'dirt', False, loc=(0, 0, 0))

    # ---- MG42 ＋ Lafette 42 三腳架 --------------------------------
    gz = 0.30
    mount = Vector((0, 0.30, gz))
    for (dx, dy) in ((-0.62, -0.58), (0.62, -0.58), (0.0, 0.66)):
        foot = Vector((dx, 0.30 + dy, 0.0))
        b.tube(tuple(mount + Vector((dx * 0.10, dy * 0.10, -0.06))), tuple(foot),
               0.026, 0.020, 6, 'metal_dark')
        b.box((0.13, 0.16, 0.035), loc=(foot.x, foot.y, 0.02), m='metal_dark')
    b.box((0.20, 0.30, 0.14), loc=tuple(mount), m='metal_dark')
    b.tube(tuple(mount + Vector((0, 0, 0.05))), tuple(mount + Vector((0, 0, 0.16))),
           0.05, 0.045, 8, 'metal_dark')

    gun = Vector((0, 0.30, gz + 0.20))
    m = 'gunmetal'
    b.tube(tuple(gun + Vector((0, 0.045, 0.012))), tuple(gun + Vector((0, 0.575, 0.012))),
           0.034, 0.032, 10, m)                                   # 槍管護筒
    b.tube(tuple(gun + Vector((0, 0.575, 0.012))), tuple(gun + Vector((0, 0.760, 0.012))),
           0.014, 0.012, 8, m)
    b.box((0.062, 0.300, 0.092), loc=tuple(gun + Vector((0, -0.095, 0.012))), m=m)
    b.beam(tuple(gun + Vector((0, -0.230, 0.004))), tuple(gun + Vector((0, -0.455, -0.016))),
           0.052, 0.080, 'timber', h1=0.062)
    b.beam(tuple(gun + Vector((0, 0.005, -0.034))), tuple(gun + Vector((0, -0.036, -0.148))),
           0.036, 0.050, 'rubber')
    b.tube(tuple(gun + Vector((-0.052, -0.060, -0.036))),
           tuple(gun + Vector((-0.118, -0.060, -0.036))), 0.072, 0.072, 10, 'metal_dark')
    b.box((0.016, 0.022, 0.034), loc=tuple(gun + Vector((0, 0.742, 0.038))), m=m)
    b.box((0.030, 0.026, 0.038), loc=tuple(gun + Vector((0, 0.020, 0.068))), m=m)

    # ---- 彈藥箱與彈鏈 --------------------------------------------
    for i, (x, y, a) in enumerate(((-0.62, 0.02, 0.2), (-0.50, -0.32, -0.4),
                                   (0.70, -0.10, 0.1))):
        b.box((0.32, 0.16, 0.20), loc=(x, y, 0.10), rot=(0, 0, a), m='metal_dark')
        b.beam((x - 0.10, y, 0.20), (x + 0.10, y, 0.21), 0.03, 0.02, 'steel')

    return b.finish('mg_nest', uv_scale=0.5)


def main():
    C.reset()
    ob = build()
    _, n = C.export([ob], 'mg_nest')
    C.render([ob], 'mg_nest', yaw=34, pitch=26, zoom=1.06)
    print('mg_nest tris =', n)


if __name__ == '__main__':
    main()
