"""陣地雜物：沙包牆、鹿砦、木柵、電線桿、散兵坑、彈藥箱、路標。

  blender -b -P scripts/blender/props.py -- --out public/models

輸出 sandbag_wall / hedgehog / fence_wood / pole / foxhole /
     ammo_crate / signpost（各 ≤ 600 三角形）。
慣例：原點在地面中心、正面朝 +Y、公尺。
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector, Matrix          # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi

C.defmat('paper', '#cfc6ae', 0.95)
C.defmat('iron', '#6b6358', 0.68, 0.30)   # 生鏽角鋼


# ------------------------------------------------------------------ 沙包牆

def _bag(b, loc, yaw, w=0.54, d=0.30, h=0.24, m='sandbag'):
    secs = [(0.00, w * 0.82, d * 0.78), (h * 0.5, w, d), (h, w * 0.82, d * 0.78)]
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(yaw, 4, 'Z')
    rings = [[tuple(M @ Vector((q[0], q[1], z)))
              for q in C.superellipse(ww, dd, 6, 3.2)] for (z, ww, dd) in secs]
    b.loft(rings, m, True, True, True)


def sandbag_wall():
    b = C.B()
    L = 2.70
    for row, (n, ph) in enumerate(((5, 0.0), (5, 0.5), (4, 0.0))):
        for i in range(n):
            t = (i + 0.5 + ph * 0.0) / n
            x = -L / 2 + L * t + (0.27 if row == 1 else 0.0)
            if abs(x) > L / 2 + 0.15:
                continue
            _bag(b, (x, 0.02 * math.sin(i * 1.7), row * 0.24),
                 math.radians(3 * math.sin(i * 2.1 + row)))
    # 後排（加厚）
    for i in range(2):
        x = -L / 2 + L * (i + 0.5) / 2
        _bag(b, (x, -0.30, 0.0), 0.0)
        _bag(b, (x + 0.15, -0.30, 0.24), 0.0)
    return b.finish('sandbag_wall', uv_scale=0.5)


# ------------------------------------------------------------------ 鹿砦

def hedgehog():
    """捷克刺蝟：三根角鋼互相交叉。"""
    b = C.B()
    L = 0.78
    dirs = [Vector((1, 1, 1)), Vector((-1, 1, 1)), Vector((1, -1, 1))]
    dirs = [d.normalized() for d in dirs]
    for d in dirs:
        b.beam(tuple(-d * L), tuple(d * L), 0.115, 0.115, 'iron')
        b.beam(tuple(-d * L - Vector((0, 0, 0.058))),
               tuple(d * L - Vector((0, 0, 0.058))), 0.135, 0.030, 'iron')
    b.sphere(0.15, (0, 0, 0), 6, 3, 'iron', smooth=False)
    for d in dirs:                                     # 鉚接板
        b.box((0.22, 0.22, 0.045), loc=tuple(d * 0.34), m='steel')
    ob = b.finish('hedgehog', uv_scale=0.4)
    ob.location = (0, 0, L * 0.66)
    return ob


# ------------------------------------------------------------------ 木柵

def fence_wood():
    b = C.B()
    L, H = 4.00, 1.15
    for i in range(4):
        x = -L / 2 + L * i / 3
        b.box((0.12, 0.12, H + 0.18), loc=(x, 0, 0), m='timber', anchor='bottom')
        b.box((0.16, 0.16, 0.07), loc=(x, 0, H + 0.18), m='timber')
    for z in (0.38, 0.76, 1.10):
        b.box((L + 0.10, 0.07, 0.14), loc=(0, 0.05, z), m='wood')
    b.beam((-L / 2, 0.06, 0.30), (L / 2 * 0.55, 0.06, 1.06), 0.10, 0.05, 'wood')
    return b.finish('fence_wood', uv_scale=0.5)


# ------------------------------------------------------------------ 電線桿

def pole():
    b = C.B()
    H = 7.6
    b.tube((0, 0, 0), (0, 0, H), 0.145, 0.095, 8, 'timber')
    b.box((2.00, 0.11, 0.13), loc=(0, 0, H - 0.55), m='timber')
    b.box((1.40, 0.11, 0.13), loc=(0, 0, H - 1.25), m='timber')
    for (x, z) in ((-0.86, H - 0.42), (-0.30, H - 0.42), (0.30, H - 0.42),
                   (0.86, H - 0.42), (-0.58, H - 1.12), (0.58, H - 1.12)):
        b.lathe([(0.055, 0.20), (0.085, 0.13), (0.060, 0.06), (0.085, 0.0)],
                6, 'glass', True, loc=(x, 0, z))
    for sg in (1, -1):                                  # 斜撐
        b.beam((sg * 0.42, 0.06, H - 1.30), (0, 0.06, H - 0.62), 0.06, 0.06, 'timber')
    b.box((0.34, 0.04, 0.26), loc=(0.18, 0.10, 2.10), m='paper')
    return b.finish('pole', uv_scale=0.6)


# ------------------------------------------------------------------ 散兵坑

def foxhole():
    b = C.B()

    def rf(th, i, n):
        return 1.0 + 0.07 * math.sin(th * 3.0) + 0.04 * math.cos(th * 5.0)

    def zf(th, i, n):
        return 0.05 * math.sin(th * 2.0 + 1.1) if i <= 2 else 0.0

    prof = [(0.78, -0.62), (0.80, -0.10), (0.88, 0.30), (1.12, 0.46),
            (1.50, 0.16), (1.72, 0.0)]
    # 由外往內：先造土堤與坑壁
    b.lathe(prof[::-1], 14, 'dirt', True, rfun=rf, zfun=zf, cap_bottom=False)
    b.lathe([(0.78, -0.62), (0.0, -0.68)], 14, 'dirt', False)
    return b.finish('foxhole', uv_scale=0.8)


# ------------------------------------------------------------------ 彈藥箱

def ammo_crate():
    b = C.B()
    w, d, h = 0.78, 0.36, 0.30
    b.box((w, d, h), loc=(0, 0, 0), m='wood_pale', anchor='bottom')
    b.box((w + 0.04, d + 0.04, 0.05), loc=(0, 0, h - 0.025), m='wood')
    for sg in (1, -1):                                   # 端板與繩把手
        b.box((0.05, d + 0.05, h * 0.92), loc=(sg * w / 2, 0, h * 0.46), m='wood')
        b.beam((sg * (w / 2 + 0.03), -0.08, h * 0.72), (sg * (w / 2 + 0.03), 0.08, h * 0.72),
               0.035, 0.035, 'timber')
    for x in (-0.18, 0.18):                              # 金屬扣件
        b.box((0.06, d + 0.03, 0.05), loc=(x, 0, h * 0.62), m='steel')
    b.box((0.30, 0.02, 0.10), loc=(0.05, d / 2 + 0.01, h * 0.42), m='charred')
    return b.finish('ammo_crate', uv_scale=0.3)


# ------------------------------------------------------------------ 路標

def signpost():
    b = C.B()
    H = 2.15
    b.box((0.11, 0.11, H), loc=(0, 0, 0), m='timber', anchor='bottom')
    b.box((0.16, 0.16, 0.06), loc=(0, 0, H), m='timber')
    b.box((0.30, 0.30, 0.16), loc=(0, 0, 0.08), m='dirt')
    # 三塊箭頭指示牌
    for (z, sg, w) in ((H - 0.22, 1, 1.05), (H - 0.52, -1, 0.92), (H - 0.82, 1, 0.80)):
        pts = [(0, -0.09), (w - 0.16, -0.09), (w, 0.0), (w - 0.16, 0.09), (0, 0.09)]
        pts = [(sg * p[0], p[1]) for p in pts]
        if sg < 0:
            pts = pts[::-1]
        b.prism(pts, 0.035, m='wood_pale', loc=(0, 0, z), rot=(PI / 2, 0, 0))
        b.box((w * 0.62, 0.05, 0.035), loc=(sg * w * 0.42, 0.0, z + 0.005), m='charred')
    return b.finish('signpost', uv_scale=0.3)


PROPS = [('sandbag_wall', sandbag_wall, 32, 22),
         ('hedgehog', hedgehog, 36, 20),
         ('fence_wood', fence_wood, 30, 18),
         ('pole', pole, 26, 14),
         ('foxhole', foxhole, 32, 32),
         ('ammo_crate', ammo_crate, 40, 26),
         ('signpost', signpost, 34, 16)]


def main():
    stats = []
    objs_all = []
    for (name, fn, yaw, pitch) in PROPS:
        C.reset()
        ob = fn()
        ob.name = name
        ob.data.name = name
        bpy.context.view_layer.update()
        _, n = C.export([ob], name)
        stats.append((name, n))
        C.render([ob], name, yaw=yaw, pitch=pitch, zoom=1.06, size=(640, 480))

    # 總覽圖
    C.reset()
    xs = [-4.2, -2.6, -0.6, 1.6, 3.4, 4.8, 6.2]
    for (x, (name, fn, _, _)) in zip(xs, PROPS):
        ob = fn()
        ob.location = (x, 0, ob.location.z)
        objs_all.append(ob)
    bpy.context.view_layer.update()
    C.render(objs_all, 'props', yaw=30, pitch=18, zoom=1.05, size=(1280, 520))

    print('\n=== 雜物三角形數 ===')
    for (n, t) in stats:
        print('%-20s %5d' % (n, t))


if __name__ == '__main__':
    main()
