"""C-47 Skytrain 傘降運輸機（長 19.4 m、翼展 29.4 m、侵入條紋）。

  blender -b -P scripts/blender/c47.py -- --out public/models

輸出 c47.glb。物件階層：
  c47 (機身，原點在主輪接地點中心；機頭朝 +Y)
    ├ prop_l (左螺旋槳，繞本地 Y 轉)
    └ prop_r (右螺旋槳)

侵入條紋（invasion stripes）以白／黑材質分段做在機身後段與主翼外段，
不需貼圖；材質名 `white` / `charred`。
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector                  # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi
SKIN = 'olive'
W, K = 'white', 'charred'

# 機身斷面：(y, 寬, 高, 中心 z)
FUS = [(9.68, 0.72, 0.82, 1.72), (9.25, 1.30, 1.42, 1.72),
       (8.50, 2.05, 2.20, 1.72), (7.10, 2.52, 2.72, 1.72),
       (4.00, 2.66, 2.86, 1.70), (0.00, 2.66, 2.88, 1.70),
       (-3.00, 2.56, 2.78, 1.72), (-5.60, 2.20, 2.42, 1.84),
       (-7.60, 1.50, 1.72, 2.08), (-9.20, 0.70, 0.95, 2.38),
       (-9.74, 0.20, 0.32, 2.54)]

# 翼型（弦長比例, 厚度比例），沿上表面前緣 -> 後緣 -> 下表面回前緣
AIRFOIL = [(0.00, 0.000), (0.10, 0.062), (0.30, 0.078), (0.60, 0.052),
           (1.00, 0.004), (0.60, -0.028), (0.30, -0.036), (0.10, -0.028)]

PROP_AT = [Vector((-3.55, 3.55, 1.26)), Vector((3.55, 3.55, 1.26))]


def fus_at(y):
    for i in range(len(FUS) - 1):
        y0, y1 = FUS[i][0], FUS[i + 1][0]
        if y1 <= y <= y0:
            t = (y0 - y) / (y0 - y1)
            return tuple(C.lerp(FUS[i][k], FUS[i + 1][k], t) for k in (1, 2, 3))
    return FUS[-1][1:]


def fus_ring(y, n=10):
    w, h, zc = fus_at(y)
    return [(q[0], y, zc + q[1] * h / w) for q in C.superellipse(w, w, n, 2.2)]


def wing_section(x, le_y, chord, zc, dih):
    return [(x, le_y - chord * f, zc + dih + chord * t) for (f, t) in AIRFOIL]


def build_fuselage(b):
    # 條紋站位（機身後段五道：白黑白黑白）
    stripes = [-3.00, -3.52, -4.04, -4.56, -5.08, -5.60]
    ys = sorted({f[0] for f in FUS} | set(stripes), reverse=True)
    smat = {(-3.00, -3.52): W, (-3.52, -4.04): K, (-4.04, -4.56): W,
            (-4.56, -5.08): K, (-5.08, -5.60): W}
    rings = [fus_ring(y) for y in ys]
    for i in range(len(ys) - 1):
        m = smat.get((round(ys[i], 2), round(ys[i + 1], 2)), SKIN)
        b.loft([rings[i], rings[i + 1]], m, True, i == 0, i == len(ys) - 2)
    # 駕駛艙窗與艙門
    b.box((2.20, 1.45, 0.50), loc=(0, 7.55, 2.42), m='glass', smooth=True)
    b.box((0.06, 1.70, 1.55), loc=(-1.32, -3.30, 1.60), m=K)     # 左側跳傘門
    b.box((2.00, 0.10, 0.40), loc=(0, 9.10, 1.72), m=K)


def build_wing(b, sg):
    """主翼：根部弦 3.7 m、翼尖 1.55 m、上反 5°，外段做侵入條紋。"""
    st = [1.30, 2.60, 3.55, 4.60, 5.30, 5.86, 6.42, 6.98, 7.54,
          9.60, 12.20, 14.70]
    smat = {(5.30, 5.86): W, (5.86, 6.42): K, (6.42, 6.98): W,
            (6.98, 7.54): K}

    def sec(x):
        t = (x - 1.30) / (14.70 - 1.30)
        chord = C.lerp(3.70, 1.55, t ** 0.85)
        le = C.lerp(2.30, 0.45, t ** 1.25)
        return wing_section(sg * x, le, chord, 1.26, t * 1.20)

    rings = [sec(x) for x in st]
    if sg < 0:                                   # 左翼由翼尖往內排，維持 +X 前進
        rings = rings[::-1]
        keys = [(st[i + 1], st[i]) for i in range(len(st) - 1)][::-1]
    else:
        keys = [(st[i], st[i + 1]) for i in range(len(st) - 1)]
    for i in range(len(rings) - 1):
        k = tuple(round(v, 2) for v in keys[i])
        m = smat.get(k, smat.get((k[1], k[0]), SKIN))
        b.loft([rings[i], rings[i + 1]], m, True, i == 0, i == len(rings) - 2)


def build_nacelle(b, sg):
    x = sg * 3.55
    secs = [(3.50, 0.30), (3.30, 0.56), (2.60, 0.62), (0.60, 0.60),
            (-1.20, 0.42), (-2.70, 0.22)]
    rings = [[(x + q[0], y, 1.26 + q[1]) for q in C.circle(r, 10)]
             for (y, r) in secs]
    if sg < 0:
        pass
    b.loft(rings[::-1], SKIN, True, True, True)
    # 主輪（半收於發動機艙下方）
    b.tube((x - 0.13, 2.45, 0.56), (x + 0.13, 2.45, 0.56), 0.56, 0.56, 12, 'rubber')
    b.tube((x - 0.15, 2.45, 0.56), (x + 0.15, 2.45, 0.56), 0.20, 0.20, 8, 'steel')
    b.beam((x, 2.45, 0.56), (x, 2.30, 1.30), 0.10, 0.12, 'steel')
    b.box((0.55, 0.70, 0.30), loc=(x, 2.42, 1.10), m=SKIN)


def build_tail(b):
    # 垂直尾翼（DC-3 圓弧大垂尾）
    fin = [(-6.05, 2.90), (-7.15, 3.62), (-7.95, 4.34), (-8.62, 4.88),
           (-9.14, 5.12), (-9.56, 5.02), (-9.86, 4.20), (-9.90, 3.20),
           (-9.82, 2.66), (-7.55, 2.56)]
    b.prism(fin, 0.17, m=SKIN, rot=(PI / 2, 0, PI / 2))
    b.prism([(-9.20, 4.86), (-9.56, 5.02), (-9.86, 4.20), (-9.90, 3.20),
             (-9.82, 2.66), (-9.40, 2.62)], 0.13, m=SKIN, rot=(PI / 2, 0, PI / 2))
    # 水平尾翼
    for sg in (1, -1):
        st = [0.35, 2.20, 4.20, 6.60]
        rings = []
        for x in st:
            t = (x - 0.35) / (6.60 - 0.35)
            chord = C.lerp(2.35, 1.05, t ** 0.8)
            le = C.lerp(-7.25, -8.10, t)
            rings.append(wing_section(sg * x, le, chord, 2.62, t * 0.12))
        if sg < 0:
            rings = rings[::-1]
        b.loft(rings, SKIN, True, True, True)
    # 尾輪
    b.tube((-0.09, -8.05, 1.28), (0.09, -8.05, 1.28), 0.22, 0.22, 8, 'rubber')
    b.beam((0, -8.05, 1.28), (0, -8.10, 1.78), 0.09, 0.09, 'steel')


def build_prop(name):
    b = C.B()
    b.lathe([(0.00, 0.62), (0.14, 0.42), (0.20, 0.10), (0.19, -0.06)],
            10, 'steel', True, rot=(math.radians(-90), 0, 0))
    for i in range(3):
        a = C.TAU * i / 3
        d = Vector((math.cos(a), 0, math.sin(a)))
        b.beam(tuple(d * 0.18), tuple(d * 1.70), 0.30, 0.075, 'metal_dark',
               up=(0, 1, 0), w1=0.16, h1=0.040, roll=math.radians(22))
        b.beam(tuple(d * 1.55), tuple(d * 1.72), 0.13, 0.030, 'gold', up=(0, 1, 0))
    return b.finish(name, uv_scale=0.4)


def main():
    C.reset()
    b = C.B()
    build_fuselage(b)
    for sg in (1, -1):
        build_wing(b, sg)
        build_nacelle(b, sg)
    build_tail(b)
    body = b.finish('c47', uv_scale=1.5)

    props = []
    for name, at in (('prop_l', PROP_AT[0]), ('prop_r', PROP_AT[1])):
        p = build_prop(name)
        p.location = at
        bpy.context.view_layer.update()
        C.setparent(p, body)
        props.append(p)

    objs = [body] + props
    bpy.context.view_layer.update()
    _, n = C.export(objs, 'c47')
    C.render(objs, 'c47', yaw=40, pitch=22, zoom=1.04, size=(1024, 640))
    C.render(objs, 'c47_side', yaw=90, pitch=6, zoom=1.03, size=(1024, 480))
    print('c47 tris =', n)


if __name__ == '__main__':
    main()
