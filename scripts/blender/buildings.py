"""歐洲村落建築（諾曼第石屋、穀倉、教堂、阿登木石屋、堤防農舍、風車）。

  blender -b -P scripts/blender/buildings.py -- --out public/models

輸出（每種另有 _damaged 變體）：
  house_normandy_s / house_normandy_l / barn / church /
  house_ardennes / farmhouse_dutch / windmill

慣例：原點在地面中心、正面朝 +Y、公尺。
UV 為每面平面投影、1 UV = 1 m（牆面沿水平／垂直、屋頂沿斜面），
整合端直接套 Poly Haven 石牆／瓦片貼圖並自行設定 repeat。

子物件：
  house_ardennes.snow_cap  屋頂雪蓋（略大一圈，可顯示／隱藏）
  windmill.sails           風車葉片（繞本地 Y 轉）
"""

import os
import sys
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
from mathutils import Vector                  # noqa: E402
import _land_common as C                      # noqa: E402

PI = math.pi

C.defmat('brick', '#8a5a46', 0.93)
C.defmat('thatch', '#8a7446', 0.96)
C.defmat('rubble', '#6f6455', 0.96)


# ------------------------------------------------------------------ 通用零件

def shell(b, lx, dy, h, rh, m='stone', gable_m=None, plinth=True):
    """山牆形主體：屋脊沿 X，山牆面在 x = ±lx/2。"""
    prof = [(-dy / 2, 0), (dy / 2, 0), (dy / 2, h), (0, rh), (-dy / 2, h)]
    b.prism(prof, lx, m=m, rot=(PI / 2, 0, PI / 2))
    if gable_m and gable_m != m:                 # 山牆上半換材質（木構造）
        for sg in (1, -1):
            b.prism([(-dy / 2, h), (dy / 2, h), (0, rh)], 0.10, m=gable_m,
                    rot=(PI / 2, 0, PI / 2), loc=(sg * (lx / 2 + 0.05), 0, 0))
    if plinth:
        b.box((lx + 0.24, dy + 0.24, 0.34), loc=(0, 0, 0), m='stone_dark',
              anchor='bottom')


def roof(b, lx, dy, h, rh, m='roof_tile', oh=0.42, th=0.12,
         cut=None, ridge=True, ox=0.0, oy=0.0):
    """雙斜屋頂。cut=(sign, frac) 表示該側屋頂沿 X 少鋪 frac（破損用）。"""
    ang = math.atan2(rh - h, dy / 2)
    ca, sa = math.cos(ang), math.sin(ang)
    slope = math.hypot(dy / 2, rh - h) + oh
    for sg in (1, -1):
        length = lx + oh * 2
        offx = 0.0
        if cut and cut[0] == sg:
            length = (lx + oh * 2) * (1 - cut[1])
            offx = -sg * (lx + oh * 2 - length) / 2
        cy = sg * (dy / 4 + (oh / 2) * ca + sa * th / 2)
        cz = (h + rh) / 2 - (oh / 2) * sa + ca * th / 2
        b.box((length, slope, th), loc=(ox + offx, oy + cy, cz),
              rot=(-sg * ang, 0, 0), m=m)
    if ridge:
        b.box((lx + oh * 1.2, 0.30, 0.16), loc=(ox, oy, rh + 0.04), m=m)


def rafters(b, lx, dy, h, rh, sg, frac, m='timber'):
    """破損屋頂露出的桁條。"""
    ang = math.atan2(rh - h, dy / 2)
    x0 = lx / 2 - (lx + 0.84) * frac
    n = max(2, int((lx / 2 - x0) / 0.55))
    for i in range(n + 1):
        x = x0 + (lx / 2 - x0) * i / n
        b.beam((x, 0, rh), (x, sg * dy / 2, h), 0.09, 0.11, m)
    for t in (0.35, 0.75):
        z = rh + (h - rh) * t
        y = sg * (dy / 2) * t
        b.beam((x0, y, z), (lx / 2, y, z), 0.08, 0.07, m)
    del ang


def window(b, x, y, z, w=0.85, hgt=1.25, face='y', frame='timber',
           glass='glass', sill=True, broken=False):
    d = 0.16
    if face == 'y':
        sgn = 1 if y > 0 else -1
        b.box((w + 0.22, d, hgt + 0.22), loc=(x, y - sgn * 0.05, z), m='stone_dark')
        b.box((w, d, hgt), loc=(x, y + sgn * 0.02, z),
              m='charred' if broken else glass)
        b.box((0.07, d * 0.9, hgt), loc=(x, y + sgn * 0.05, z), m=frame)
        b.box((w, d * 0.9, 0.07), loc=(x, y + sgn * 0.05, z), m=frame)
        if sill:
            b.box((w + 0.32, 0.20, 0.09), loc=(x, y + sgn * 0.06, z - hgt / 2 - 0.07),
                  m='stone_dark')
    else:
        sgn = 1 if x > 0 else -1
        b.box((d, w + 0.22, hgt + 0.22), loc=(x - sgn * 0.05, y, z), m='stone_dark')
        b.box((d, w, hgt), loc=(x + sgn * 0.02, y, z),
              m='charred' if broken else glass)
        b.box((d * 0.9, 0.07, hgt), loc=(x + sgn * 0.05, y, z), m=frame)
        if sill:
            b.box((0.20, w + 0.32, 0.09), loc=(x + sgn * 0.06, y, z - hgt / 2 - 0.07),
                  m='stone_dark')


def door(b, x, y, w=1.05, hgt=2.10, m='timber'):
    sgn = 1 if y > 0 else -1
    b.box((w + 0.28, 0.18, hgt + 0.18), loc=(x, y - sgn * 0.04, hgt / 2), m='stone_dark')
    b.box((w, 0.16, hgt), loc=(x, y + sgn * 0.03, hgt / 2), m=m)
    b.box((0.06, 0.10, hgt), loc=(x, y + sgn * 0.09, hgt / 2), m='steel')
    b.box((0.10, 0.10, 0.06), loc=(x + w * 0.32, y + sgn * 0.10, hgt * 0.48), m='steel')


def chimney(b, x, y, top, w=0.72, m='stone_dark', broken=False):
    h = top * (0.68 if broken else 1.0)
    b.box((w, w, h), loc=(x, y, 0), m=m, anchor='bottom')
    if broken:
        b.box((w * 0.9, w * 0.9, 0.12), loc=(x, y, h), m='charred')
    else:
        b.box((w + 0.18, w + 0.18, 0.14), loc=(x, y, h), m=m)
        b.box((w * 0.55, w * 0.55, 0.16), loc=(x, y, h + 0.14), m='charred')


def rubble(b, cx, cy, n=6, r=2.2, seed=1, m='rubble'):
    rnd = random.Random(seed)
    for _ in range(n):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(r * 0.45, r)
        s = rnd.uniform(0.22, 0.52)
        b.box((s * rnd.uniform(0.8, 1.6), s * rnd.uniform(0.8, 1.6), s * 0.6),
              loc=(cx + math.cos(a) * d, cy + math.sin(a) * d, s * 0.3),
              rot=(0, 0, rnd.uniform(0, 3)), m=m, anchor='bottom')


def scorch(b, lx, dy, h, sg=1, m='charred'):
    """外牆火燒痕（薄片貼在牆上）。"""
    b.box((lx * 0.42, 0.06, h * 0.5), loc=(lx * 0.18, sg * (dy / 2 + 0.02), h * 0.72), m=m)
    b.box((lx * 0.20, 0.06, h * 0.34), loc=(-lx * 0.28, sg * (dy / 2 + 0.02), h * 0.80), m=m)


# ------------------------------------------------------------------ 各建築

def house_normandy_s(dmg=False):
    lx, dy, h, rh = 7.0, 5.6, 5.6, 8.3
    b = C.B()
    shell(b, lx, dy, h, rh, 'stone')
    roof(b, lx, dy, h, rh, 'roof_tile', cut=(1, 0.38) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, 1, 0.38)
        rubble(b, 2.4, 3.4, 7, 2.4, 3)
        scorch(b, lx, dy, h, 1)
    chimney(b, -lx / 2 + 0.55, 0, rh + 0.95, 0.72, broken=dmg)
    door(b, -0.4, dy / 2)
    for x in (1.5, 2.9):
        window(b, x, dy / 2, 1.85, broken=dmg)
    for x in (-2.2, -0.4, 1.5, 2.9):
        window(b, x, dy / 2, 4.15, 0.78, 1.10, broken=dmg and x > 0)
        window(b, x, -dy / 2, 4.15, 0.78, 1.10)
    for x in (-2.0, 0.6, 2.6):
        window(b, x, -dy / 2, 1.85, broken=False)
    b.box((0.14, 0.14, h), loc=(lx / 2 - 0.07, dy / 2 - 0.07, 0), m='stone_dark',
          anchor='bottom')
    b.box((0.14, 0.14, h), loc=(-lx / 2 + 0.07, dy / 2 - 0.07, 0), m='stone_dark',
          anchor='bottom')
    return [b.finish('x', uv_scale=1.0)]


def house_normandy_l(dmg=False):
    lx, dy, h, rh = 11.0, 6.4, 6.6, 10.2
    b = C.B()
    shell(b, lx, dy, h, rh, 'stone')
    roof(b, lx, dy, h, rh, 'roof_tile', cut=(-1, 0.42) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, -1, 0.42)
        rubble(b, -3.2, -4.0, 9, 3.0, 7)
        scorch(b, lx, dy, h, -1)
    chimney(b, -lx / 2 + 0.6, 0, rh + 1.1, 0.80, broken=dmg)
    chimney(b, lx / 2 - 0.6, 0, rh + 1.1, 0.80)
    door(b, -1.0, dy / 2, 1.25, 2.35)
    for x in (-3.6, -2.2, 0.9, 2.6, 4.3):
        window(b, x, dy / 2, 1.95, 0.90, 1.40, broken=dmg)
    for x in (-4.2, -2.6, -1.0, 0.9, 2.6, 4.3):
        window(b, x, dy / 2, 4.60, 0.85, 1.30, broken=dmg and x < 0)
        window(b, x, -dy / 2, 4.60, 0.85, 1.30)
    for x in (-4.0, -1.6, 1.4, 3.8):
        window(b, x, -dy / 2, 1.95, 0.90, 1.40)
    # 附屬矮屋
    b.box((3.2, 3.0, 2.6), loc=(lx / 2 + 1.4, -1.0, 0), m='stone', anchor='bottom')
    b.box((3.5, 3.3, 0.14), loc=(lx / 2 + 1.4, -1.0, 2.72), rot=(0.22, 0, 0),
          m='roof_tile')
    return [b.finish('x', uv_scale=1.0)]


def barn(dmg=False):
    lx, dy, h, rh = 14.0, 8.6, 4.9, 8.8
    b = C.B()
    shell(b, lx, dy, h, rh, 'stone', gable_m='timber')
    roof(b, lx, dy, h, rh, 'roof_tile', oh=0.55, cut=(1, 0.34) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, 1, 0.34)
        rubble(b, 3.6, 5.0, 10, 3.4, 11)
        scorch(b, lx, dy, h, 1)
    # 大門
    b.box((3.6, 0.22, 4.2), loc=(0, dy / 2 + 0.02, 2.1), m='timber')
    b.box((0.14, 0.26, 4.2), loc=(0, dy / 2 + 0.06, 2.1), m='wood')
    b.box((3.8, 0.26, 0.22), loc=(0, dy / 2 + 0.04, 4.25), m='wood')
    for x in (-4.8, -3.2, 3.2, 4.8):
        window(b, x, dy / 2, 3.2, 0.70, 0.95, broken=dmg)
    for x in (-5.4, -2.4, 2.4, 5.4):
        window(b, x, -dy / 2, 3.0, 0.70, 0.95)
    # 木構樑柱（外露）
    for x in (-5.6, -2.8, 2.8, 5.6):
        for sg in (1, -1):
            b.box((0.26, 0.16, h), loc=(x, sg * (dy / 2 + 0.05), 0),
                  m='timber', anchor='bottom')
    b.box((lx, 0.18, 0.26), loc=(0, dy / 2 + 0.05, h - 0.2), m='timber')
    # 側邊披屋
    b.box((5.0, 2.6, 2.4), loc=(-3.5, -dy / 2 - 1.3, 0), m='timber', anchor='bottom')
    b.box((5.2, 2.9, 0.12), loc=(-3.5, -dy / 2 - 1.3, 2.55), rot=(-0.30, 0, 0),
          m='roof_tile')
    return [b.finish('x', uv_scale=1.0)]


def church(dmg=False):
    lx, dy, h, rh = 16.0, 8.4, 7.2, 11.0
    b = C.B()
    shell(b, lx, dy, h, rh, 'stone')
    roof(b, lx, dy, h, rh, 'roof_slate', oh=0.45, cut=(1, 0.30) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, 1, 0.30)
        rubble(b, 4.0, 5.2, 11, 3.6, 21)
        scorch(b, lx, dy, h, 1)
    # 鐘塔（西端）
    tx, tw, th_ = -lx / 2 - 2.2, 5.0, 16.5
    b.box((tw, tw, th_), loc=(tx, 0, 0), m='stone', anchor='bottom')
    b.box((tw + 0.30, tw + 0.30, 0.42), loc=(tx, 0, th_), m='stone_dark')
    # 尖塔
    b.lathe([(0.0, 7.4), (0.30, 6.6), (tw * 0.72, 0.10), (tw * 0.74, 0.0)],
            4, 'roof_slate', False, loc=(tx, 0, th_ + 0.42),
            rot=(0, 0, math.radians(45)))
    b.box((0.18, 0.18, 1.30), loc=(tx, 0, th_ + 7.80), m='gold', anchor='bottom')
    b.box((0.82, 0.14, 0.16), loc=(tx, 0, th_ + 8.55), m='gold')
    # 鐘樓百葉窗
    for (dx, dyy) in ((tw / 2, 0), (-tw / 2, 0), (0, tw / 2), (0, -tw / 2)):
        loc = (tx + dx * 0.99, dyy * 0.99, th_ - 2.6)
        if dx:
            b.box((0.18, 1.05, 2.30), loc=loc, m='charred')
            b.box((0.22, 1.25, 0.18), loc=(loc[0], loc[1], loc[2] + 1.25), m='stone_dark')
        else:
            b.box((1.05, 0.18, 2.30), loc=loc, m='charred')
            b.box((1.25, 0.22, 0.18), loc=(loc[0], loc[1], loc[2] + 1.25), m='stone_dark')
    # 大門與扶壁
    door(b, tx, tw / 2, 1.8, 3.2, 'timber')
    for sg in (1, -1):
        for x in (-4.5, 0.5, 5.5):
            b.box((0.9, 0.7, h * 0.80), loc=(x, sg * (dy / 2 + 0.30), 0),
                  m='stone_dark', anchor='bottom')
            b.box((0.9, 0.9, 0.7), loc=(x, sg * (dy / 2 + 0.25), h * 0.80),
                  rot=(-sg * 0.7, 0, 0), m='stone_dark')
        for x in (-2.2, 3.0, 7.0):
            window(b, x, sg * dy / 2, 4.3, 1.00, 2.90, broken=dmg and sg > 0)
    # 東端半圓後殿
    b.lathe([(4.2, 5.6), (4.2, 0.0)], 10, 'stone', False, loc=(lx / 2, 0, 0))
    b.lathe([(0.0, 2.2), (4.5, 0.10), (4.5, 0.0)], 10, 'roof_slate', False,
            loc=(lx / 2, 0, 5.6))
    return [b.finish('x', uv_scale=1.0)]


def house_ardennes(dmg=False):
    lx, dy, h, rh = 8.2, 6.6, 5.7, 9.6
    b = C.B()
    shell(b, lx, dy, h, rh, 'stone', gable_m='timber')
    roof(b, lx, dy, h, rh, 'roof_slate', oh=0.50, cut=(-1, 0.36) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, -1, 0.36)
        rubble(b, -2.6, -4.2, 8, 2.8, 31)
        scorch(b, lx, dy, h, -1)
    chimney(b, lx / 2 - 0.7, 0, rh + 1.1, 0.76, broken=dmg)
    door(b, -0.6, dy / 2, 1.0, 2.05)
    for x in (1.3, 3.0):
        window(b, x, dy / 2, 2.05, 0.85, 1.20, broken=dmg)
    for x in (-2.6, -0.6, 1.3, 3.0):
        window(b, x, dy / 2, 4.25, 0.74, 1.00, broken=dmg and x < 0)
    for x in (-2.4, 0.6, 2.8):
        window(b, x, -dy / 2, 2.05, 0.85, 1.20)
    # 木構外露（半木造）
    for x in (-3.0, -1.2, 1.0, 2.8):
        b.box((0.20, 0.14, h - 0.34), loc=(x, dy / 2 + 0.06, 0.34),
              m='timber', anchor='bottom')
    b.box((lx, 0.16, 0.24), loc=(0, dy / 2 + 0.06, h - 0.14), m='timber')
    b.box((lx, 0.16, 0.24), loc=(0, dy / 2 + 0.06, 0.30), m='timber')
    # 柴堆
    for i in range(4):
        b.tube((-lx / 2 - 0.8, -1.4, 0.18 + i * 0.20), (-lx / 2 - 0.8, 0.8, 0.18 + i * 0.20),
               0.10, 0.10, 6, 'wood')
    main = b.finish('x', uv_scale=1.0)

    # ---- 雪蓋（獨立物件 snow_cap）--------------------------------
    s = C.B()
    roof(s, lx, dy, h + 0.09, rh + 0.11, 'snow', oh=0.60, th=0.13,
         cut=(-1, 0.36) if dmg else None, ridge=False)
    s.box((0.96, 0.96, 0.14), loc=(lx / 2 - 0.7, 0, (rh + 1.1) * (0.68 if dmg else 1.0)),
          m='snow')
    for x in (-2.6, -0.6, 1.3, 3.0):                 # 窗台積雪
        s.box((1.06, 0.26, 0.09), loc=(x, dy / 2 + 0.12, 3.68), m='snow')
    cap = s.finish('snow_cap', uv_scale=1.0)
    bpy.context.view_layer.update()
    C.setparent(cap, main)
    return [main, cap]


def farmhouse_dutch(dmg=False):
    lx, dy, h, rh = 12.5, 8.2, 3.2, 9.0
    b = C.B()
    shell(b, lx, dy, h, rh, 'brick', gable_m='brick')
    roof(b, lx, dy, h, rh, 'thatch', oh=0.60, th=0.26,
         cut=(1, 0.30) if dmg else None)
    if dmg:
        rafters(b, lx, dy, h, rh, 1, 0.30)
        rubble(b, 3.4, 4.6, 9, 3.2, 41)
        scorch(b, lx, dy, h, 1)
    chimney(b, -lx / 2 + 0.8, 0, rh + 0.8, 0.86, 'brick', broken=dmg)
    # 住居端的橫向翼（磚牆 ＋ 自己的瓦屋頂）
    wx, wy, wh, wrh = 4.2, 3.6, 3.3, 5.8
    cx, cy = -lx / 2 + 2.4, dy / 2 - 0.4
    b.prism([(-wy / 2, 0), (wy / 2, 0), (wy / 2, wh), (0, wrh), (-wy / 2, wh)],
            wx, m='brick', rot=(PI / 2, 0, PI / 2), loc=(cx, cy, 0))
    roof(b, wx, wy, wh, wrh, 'roof_tile', oh=0.34, th=0.11, ox=cx, oy=cy)
    door(b, cx, cy + wy / 2, 1.15, 2.20)
    for x in (cx - 1.4, cx + 1.4):
        window(b, x, cy + wy / 2, 2.60, 0.90, 1.30, broken=dmg)
    for sg in (1, -1):
        window(b, cx + sg * wx / 2, cy, 2.30, 0.85, 1.25, face='x')
    for x in (0.4, 2.6, 4.8):
        window(b, x, dy / 2, 2.10, 0.80, 1.10, broken=dmg)
    # 穀倉大門
    b.box((3.0, 0.22, 3.0), loc=(lx / 2 - 2.4, dy / 2 + 0.02, 1.5), m='timber')
    b.box((0.12, 0.26, 3.0), loc=(lx / 2 - 2.4, dy / 2 + 0.06, 1.5), m='wood')
    return [b.finish('x', uv_scale=1.0)]


def windmill(dmg=False):
    b = C.B()
    H = 12.6
    prof = [(2.05, H), (2.30, H - 2.0), (2.95, H * 0.45), (3.55, 0.35), (3.62, 0.0)]
    b.lathe(prof, 8, 'brick', False, rot=(0, 0, math.radians(22.5)))
    b.lathe([(3.05, 5.05), (3.05, 4.85)], 8, 'timber', False,
            rot=(0, 0, math.radians(22.5)))                 # 陽台
    for i in range(8):
        a = math.tau * i / 8 + math.radians(22.5)
        b.box((0.10, 0.10, 0.95), loc=(3.0 * math.cos(a), 3.0 * math.sin(a), 5.05),
              m='timber', anchor='bottom')
    b.lathe([(3.06, 5.95), (3.06, 5.80)], 8, 'timber', False,
            rot=(0, 0, math.radians(22.5)))
    # 帽（可轉的圓頂）
    b.lathe([(0.0, 3.30), (0.85, 2.85), (1.75, 1.35), (2.20, 0.25), (2.28, 0.0)],
            10, 'timber' if not dmg else 'charred', True, loc=(0, 0, H))
    b.box((0.34, 5.2, 0.34), loc=(0, -1.2, H + 1.4), m='timber')   # 尾桿
    b.beam((-0.9, -3.6, H - 1.2), (0.9, -3.6, H - 1.2), 0.16, 0.16, 'timber')
    # 門窗
    door(b, 0, 3.45, 1.1, 2.3)
    for (a, z) in ((0.9, 3.2), (2.4, 6.9), (4.1, 9.4), (5.5, 6.9)):
        r = 3.2 - z * 0.09
        window(b, r * math.cos(a) * 0.99, r * math.sin(a) * 0.99, z, 0.70, 0.95,
               face='y' if abs(math.sin(a)) > 0.5 else 'x', broken=dmg)
    if dmg:
        rubble(b, 0, -4.4, 10, 3.6, 51)
        b.box((2.2, 0.10, 3.4), loc=(0.8, 3.0, 8.0), m='charred')
    body = b.finish('x', uv_scale=1.0)

    # ---- 葉片（獨立物件 sails，繞本地 Y 轉）----------------------
    s = C.B()
    s.lathe([(0.0, 0.55), (0.42, 0.18), (0.46, -0.20)], 10, 'steel', True,
            rot=(math.radians(-90), 0, 0))
    nb = 3 if dmg else 4
    for i in range(4):
        if i >= nb:
            break
        a = math.tau * i / 4
        d = Vector((math.cos(a), 0, math.sin(a)))
        p = Vector((math.sin(a), 0, -math.cos(a)))            # 葉片橫向
        s.beam(tuple(d * 0.55), tuple(d * 9.2), 0.22, 0.22, 'timber',
               up=(0, 1, 0), w1=0.14, h1=0.14)
        for t in (0.20, 0.36, 0.52, 0.68, 0.84, 0.97):
            c = d * (0.55 + 8.6 * t)
            wdt = 1.55 * (1.0 - 0.35 * t)
            s.beam(tuple(c - p * 0.10), tuple(c + p * wdt), 0.10, 0.06, 'timber',
                   up=(0, 1, 0))
        s.beam(tuple(d * 1.2 + p * 1.50), tuple(d * 9.2 + p * 1.00),
               0.09, 0.07, 'timber', up=(0, 1, 0))
    sails = s.finish('sails', uv_scale=0.5)
    sails.location = (0, 2.55, H + 2.05)
    bpy.context.view_layer.update()
    C.setparent(sails, body)
    return [body, sails]


BUILDINGS = [
    ('house_normandy_s', house_normandy_s, 26, 20),
    ('house_normandy_l', house_normandy_l, 30, 18),
    ('barn', barn, 30, 16),
    ('church', church, 34, 14),
    ('house_ardennes', house_ardennes, 28, 18),
    ('farmhouse_dutch', farmhouse_dutch, 30, 16),
    ('windmill', windmill, 24, 14),
]


def main():
    stats = []
    for (name, fn, yaw, pitch) in BUILDINGS:
        for dmg in (False, True):
            full = name + ('_damaged' if dmg else '')
            C.reset()
            objs = fn(dmg)
            objs[0].name = full
            objs[0].data.name = full
            _, n = C.export(objs, full)
            stats.append((full, n))
            C.render(objs, full, yaw=yaw, pitch=pitch, zoom=1.05, size=(768, 560))
    print('\n=== 建築三角形數 ===')
    for (n, t) in stats:
        print('%-28s %5d' % (n, t))


if __name__ == '__main__':
    main()
