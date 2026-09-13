"""骨架士兵共用工具：T-pose 網格、19+1 根骨架、直接指派權重、FK/IK 姿勢解算、
   關鍵影格寫入、GLB extras 修補、預覽合成。

座標：Blender +Z 上、+Y 前、公尺，原點腳底中心；匯出 export_yup 後為 Y 上、-Z 前。

hand_R 軸向約定（見 docs/realism-spec.md §R1）：
  骨頭 +Y = 骨頭方向（rest 時指向手指外側 +X）；骨頭局部 -Z = 槍口方向。
  匯出後 glTF 節點 +Y = 武器「照門朝上」軸、-Z = 槍口，武器 glb 以 identity
  local transform 掛在 hand_R 底下即可（武器原點 = hand_R 骨頭 head = 拳心）。
"""

import math
import os
import struct
import json

import bpy
import bmesh
from mathutils import Vector, Matrix

import _land_common as C
import soldier as S

D = math.radians
V = Vector
TAU = math.tau


# ============================================================ 骨架定義
# (name, parent, head, tail, z_hint)   ※ 右 = +X（與 soldier.py 一致）

HIP_Z = 0.900
NECK_Z = 1.518

_B = [
    ('root',     None,    (0, 0, 0.000),      (0, 0, 0.120),      (0, -1, 0)),
    ('hips',     'root',  (0, 0, HIP_Z),      (0, 0, 1.010),      (0, -1, 0)),
    ('spine',    'hips',  (0, 0, 1.010),      (0, 0, 1.190),      (0, -1, 0)),
    ('chest',    'spine', (0, 0, 1.190),      (0, 0, 1.430),      (0, -1, 0)),
    ('neck',     'chest', (0, 0, 1.430),      (0, 0, NECK_Z),     (0, -1, 0)),
    ('head',     'neck',  (0, 0, NECK_Z),     (0, 0, 1.700),      (0, -1, 0)),
]

for _s, _g in (('R', 1), ('L', -1)):
    _B += [
        ('shoulder_' + _s, 'chest',
         (_g * 0.045, 0, 1.400), (_g * 0.175, 0, 1.392), (0, 0, 1)),
        ('upperarm_' + _s, 'shoulder_' + _s,
         (_g * 0.175, 0, 1.392), (_g * 0.455, 0, 1.386), (0, -1, 0)),
        ('forearm_' + _s, 'upperarm_' + _s,
         (_g * 0.455, 0, 1.386), (_g * 0.745, 0, 1.382), (0, -1, 0)),
        ('hand_' + _s, 'forearm_' + _s,
         (_g * 0.745, 0, 1.382), (_g * 0.845, 0, 1.382), (0, -1, 0)),
        ('thigh_' + _s, 'hips',
         (_g * 0.095, 0, HIP_Z), (_g * 0.100, 0, 0.475), (0, 1, 0)),
        ('shin_' + _s, 'thigh_' + _s,
         (_g * 0.100, 0, 0.475), (_g * 0.104, 0, 0.090), (0, 1, 0)),
        ('foot_' + _s, 'shin_' + _s,
         (_g * 0.104, 0, 0.090), (_g * 0.112, 0.205, 0.020), (0, 0, 1)),
    ]

BONES = {b[0]: b for b in _B}
ORDER = [b[0] for b in _B]
PARENT = {b[0]: b[1] for b in _B}
RHEAD = {b[0]: V(b[2]) for b in _B}
RTAIL = {b[0]: V(b[3]) for b in _B}

L_THIGH = (RHEAD['shin_R'] - RHEAD['thigh_R']).length
L_SHIN = (RHEAD['foot_R'] - RHEAD['shin_R']).length
L_UARM = (RHEAD['forearm_R'] - RHEAD['upperarm_R']).length
L_FARM = (RHEAD['hand_R'] - RHEAD['forearm_R']).length

GROUPS = [n for n in ORDER]


# ============================================================ 建骨架

def build_armature(name='rig'):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for (n, par, head, tail, zh) in _B:
        eb = arm.edit_bones.new(n)
        eb.head = V(head)
        eb.tail = V(tail)
        eb.use_connect = False
        if par:
            eb.parent = arm.edit_bones[par]
        eb.align_roll(V(zh))
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def rest_basis(arm_ob, name):
    return arm_ob.data.bones[name].matrix_local.to_3x3()


# ============================================================ 帶頂點群的 Builder

class RigB(C.B):
    """C.B 的子類：add() 時把新增的頂點標上目前的 vertex group。"""

    def __init__(self):
        super().__init__()
        self.lay = self.bm.verts.layers.int.new('grp')
        self.gnames = ['hips']
        self.gid = {'hips': 0}
        self.cur = 0

    def g(self, name):
        if name not in self.gid:
            self.gid[name] = len(self.gnames)
            self.gnames.append(name)
        self.cur = self.gid[name]
        return self

    def add(self, *a, **kw):
        n0 = len(self.bm.verts)
        out = super().add(*a, **kw)
        self.bm.verts.ensure_lookup_table()
        for i in range(n0, len(self.bm.verts)):
            self.bm.verts[i][self.lay] = self.cur
        return out

    def finish(self, name, uv_scale=1.0, sharp_angle=38.0, weld=1e-4):
        bmesh.ops.remove_doubles(self.bm, verts=list(self.bm.verts), dist=weld)
        self.bm.verts.ensure_lookup_table()
        tags = [v[self.lay] for v in self.bm.verts]
        ob = super().finish(name, uv_scale, sharp_angle, weld=weld)
        assert len(tags) == len(ob.data.vertices), \
            'vertex order changed: %d vs %d' % (len(tags), len(ob.data.vertices))
        self.tags = [self.gnames[t] for t in tags]
        return ob


# ============================================================ T-pose 網格

TP = dict(
    pelvis=(0, 0, 0.920),
    hip=(0.095, 0.0, HIP_Z),
    knee=(0.100, 0.0, 0.475),
    ankle=(0.104, 0.0, 0.090),
    toe=(0.112, 0.205, 0.0),
    sho=(0.180, 0.0, 1.382),
    elbow=(0.455, 0.0, 1.386),
    wrist=(0.700, 0.0, 1.382),
    fist=(0.752, 0.0, 1.382),
)


def build_tpose(b, side):
    """soldier.py 的零件建法，改成 T-pose 單一網格並標 vertex group。"""
    cfg = S.SIDES[side]
    uni, hel, web, bts = cfg['uniform'], cfg['helmet'], cfg['web'], cfg['boots']
    M = Matrix.Translation(V(TP['pelvis']))

    def L(v):
        return tuple(M @ V(v))

    # ---- 軀幹（標 torso，之後依高度分給 hips/spine/chest） --------------
    b.g('torso')
    rings = [[tuple(M @ V((q[0], q[1], z)))
              for q in C.superellipse(w, d, S.NT, 3.2)] for (z, w, d) in S.TORSO]
    b.loft(rings, uni, True, True, True)

    if cfg['coat']:
        b.g('coat')
        cr = [[tuple(M @ V((q[0], q[1], z)))
               for q in C.superellipse(w, d, S.NT, 3.0)]
              for (z, w, d) in [(0.085, 0.352, 0.232), (-0.050, 0.398, 0.266),
                                (-0.300, 0.448, 0.306), (-0.560, 0.466, 0.318)]]
        b.loft(cr[::-1], uni, True, True, True)
        b.g('torso')
        b.box((0.330, 0.196, 0.068), loc=L((0, 0.008, 0.512)), m=uni, smooth=True)

    # ---- 頸 / 頭 / 盔 ---------------------------------------------------
    HM = M @ Matrix.Translation(V((0, 0, 0.598)))

    def H(v):
        return tuple(HM @ V(v))

    b.g('neck')
    b.tube(H((0, 0.004, -0.052)), H((0, 0.008, 0.046)), 0.051, 0.047, 6, uni)
    b.g('head')
    prof = [(0.000, 0.210), (0.052, 0.194), (0.083, 0.148),
            (0.090, 0.098), (0.080, 0.050), (0.050, 0.024)]
    b.loft([[tuple(HM @ V((r * math.cos(TAU * i / 8),
                           r * 1.14 * math.sin(TAU * i / 8) + 0.006, z)))
             for i in range(8)] for (r, z) in prof[1:]][::-1],
           'skin', True, True, True)
    b.box((0.076, 0.062, 0.046), loc=H((0, 0.036, 0.050)), m='skin', smooth=True)

    if cfg['helmet_kind'] == 'm1':
        hprof = [(0.000, 0.128), (0.056, 0.121), (0.100, 0.090),
                 (0.124, 0.042), (0.134, 0.006), (0.150, -0.016)]
        hrf = None

        def hzf(th, i, n):
            return (0.007 * math.sin(th)) if i >= n - 2 else 0.0
    else:
        hprof = [(0.000, 0.124), (0.058, 0.117), (0.101, 0.084),
                 (0.123, 0.036), (0.134, -0.006), (0.145, -0.056)]

        def hrf(th, i, n):
            return 1.0 + (0.050 * abs(math.cos(th)) if i >= n - 2 else 0.0)

        def hzf(th, i, n):
            if i >= n - 2:
                return 0.032 * math.sin(th) - 0.006
            if i == n - 3:
                return 0.014 * math.sin(th)
            return 0.0

    S.helmet_mesh(b, HM, hprof, 12, hrf, hzf, 0.106, hel)
    b.beam(H((0.100, 0.008, 0.072)), H((0.034, 0.050, 0.008)), 0.011, 0.026, web)
    b.beam(H((-0.100, 0.008, 0.072)), H((-0.034, 0.050, 0.008)), 0.011, 0.026, web)

    # ---- 四肢 -----------------------------------------------------------
    for s, sg in (('R', 1), ('L', -1)):
        def P(k):
            v = TP[k]
            return V((sg * v[0], v[1], v[2]))

        sh, el, wr, fi = P('sho'), P('elbow'), P('wrist'), P('fist')
        b.g('shoulder_' + s)
        b.sphere(0.068, tuple(sh), 8, 4, uni)
        b.g('upperarm_' + s)
        b.tube(tuple(sh), tuple(el), 0.058, 0.046, 6, uni)
        b.g('forearm_' + s)
        b.sphere(0.050, tuple(el), 6, 3, uni)
        b.tube(tuple(el), tuple(wr), 0.047, 0.042, 6, uni)
        fw = (wr - el).normalized()
        b.tube(tuple(wr - fw * 0.040), tuple(wr + fw * 0.010), 0.049, 0.047, 6, uni)
        b.g('hand_' + s)
        # 拳頭做成近球體、中心＝hand 骨頭 head，這樣手腕如何轉都看不出破綻
        b.sphere(0.047, tuple(fi), 6, 3, 'skin', scale=(0.92, 1.18, 1.0))

        hp, kn, an, te = P('hip'), P('knee'), P('ankle'), P('toe')
        b.g('thigh_' + s)
        b.tube(tuple(hp), tuple(kn), 0.099, 0.073, 8, uni)
        b.g('shin_' + s)
        b.sphere(0.074, tuple(kn), 6, 3, uni)
        b.tube(tuple(kn), tuple(an), 0.071, 0.050, 8, uni)
        up = (kn - an).normalized()
        b.tube(tuple(an - up * 0.030), tuple(an + up * cfg['boot_h']),
               0.064, cfg['boot_r1'], 8, bts)
        b.g('foot_' + s)
        td = V((te.x - an.x, te.y - an.y, 0.0))
        td = td.normalized() if td.length > 1e-4 else V((0, 1, 0))
        heel = V((an.x, an.y, 0)) - td * 0.062
        b.beam((heel.x, heel.y, an.z - 0.047), (te.x, te.y, te.z + 0.039),
               0.098, 0.078, bts)

        if side == 'us' and not cfg['coat']:
            b.g('thigh_' + s)
            t0 = hp + (kn - hp) * 0.34
            t1 = hp + (kn - hp) * 0.78
            ow = V((sg * 0.074, 0, 0))
            b.beam(tuple(t0 + ow), tuple(t1 + ow), 0.138, 0.044, uni, up=(sg, 0, 0))

    # ---- 裝具 -----------------------------------------------------------
    belt_z = 0.055 if cfg['coat'] else 0.048
    b.g('hips')
    br = []
    for z in (belt_z - 0.034, belt_z + 0.034):
        w = C.lerp(S.TORSO[1][1], S.TORSO[2][1], 0.12) + 0.018
        d = C.lerp(S.TORSO[1][2], S.TORSO[2][2], 0.12) + 0.018
        br.append([tuple(M @ V((q[0], q[1], z))) for q in C.superellipse(w, d, S.NT, 3.2)])
    b.loft(br, web, False, True, True)
    b.box((0.058, 0.028, 0.048), loc=L((0, 0.106, belt_z)), m=web)

    for sg in (1, -1):
        b.g('chest')
        b.beam(L((sg * 0.072, 0.098, 0.452)), L((sg * 0.098, 0.100, belt_z + 0.030)),
               0.040, 0.013, web)
        b.beam(L((sg * 0.080, 0.076, 0.470)), L((sg * 0.088, -0.076, 0.452)),
               0.046, 0.015, web)
        b.g('spine')
        b.beam(L((sg * 0.088, -0.082, 0.440)), L((sg * 0.072, -0.100, belt_z + 0.038)),
               0.040, 0.013, web)

    if side == 'us':
        b.g('chest')
        for sg in (1, -1):
            b.box((0.098, 0.020, 0.118), loc=L((sg * 0.080, 0.104, 0.300)), m=uni)
        b.g('hips')
        for x in (-0.112, -0.038, 0.046, 0.118):
            b.box((0.066, 0.044, 0.084), loc=L((x, 0.096, belt_z + 0.010)), m=web)
        b.g('spine')
        b.box((0.240, 0.108, 0.215), loc=L((0, -0.158, 0.205)), m=web)
        b.g('hips')
        b.tube(L((0.142, -0.070, belt_z - 0.024)), L((0.146, -0.070, belt_z - 0.170)),
               0.050, 0.048, 8, web)
        b.box((0.108, 0.028, 0.165), loc=L((-0.138, -0.128, belt_z - 0.110)), m=web)
    else:
        b.g('hips')
        for sg in (1, -1):
            for i in range(3):
                b.box((0.045, 0.048, 0.092),
                      loc=L((sg * (0.052 + i * 0.047), 0.100, belt_z + 0.008)), m=web)
        b.box((0.195, 0.090, 0.150), loc=L((0.036, -0.148, belt_z - 0.050)), m=web)
        gm = (Matrix.Translation(V(L((-0.152, -0.104, belt_z - 0.060))))
              @ Matrix.Rotation(D(-18), 4, 'Y'))
        b.tube(tuple(gm @ V((0, 0, -0.115))), tuple(gm @ V((0, 0, 0.115))),
               0.058, 0.058, 10, web)
        b.box((0.100, 0.026, 0.175), loc=L((-0.148, -0.068, belt_z - 0.125)), m=web)
        b.g('chest')
        b.box((0.176, 0.166, 0.036), loc=L((0, 0.004, 0.556)), m=uni, smooth=True)


# ============================================================ 蒙皮

def _ramp(x, a, b):
    return 0.0 if x <= a else (1.0 if x >= b else (x - a) / (b - a))


# (parent, child, 關節點, 指向 child 的軸, 半徑)
def joint_list():
    j = []
    for s in ('R', 'L'):
        sg = 1 if s == 'R' else -1
        j += [
            ('hips', 'thigh_' + s, RHEAD['thigh_' + s], V((0, 0, -1)), 0.055),
            ('thigh_' + s, 'shin_' + s, RHEAD['shin_' + s], V((0, 0, -1)), 0.062),
            ('shin_' + s, 'foot_' + s, RHEAD['foot_' + s], V((0, 0, -1)), 0.045),
            ('chest', 'shoulder_' + s, RHEAD['shoulder_' + s], V((sg, 0, 0)), 0.045),
            ('shoulder_' + s, 'upperarm_' + s, RHEAD['upperarm_' + s],
             V((sg, 0, 0)), 0.045),
            ('upperarm_' + s, 'forearm_' + s, RHEAD['forearm_' + s],
             V((sg, 0, 0)), 0.055),
            ('forearm_' + s, 'hand_' + s, V((sg * 0.700, 0, 1.382)),
             V((sg, 0, 0)), 0.038),
        ]
    j += [('chest', 'neck', RHEAD['neck'], V((0, 0, 1)), 0.030),
          ('neck', 'head', RHEAD['head'], V((0, 0, 1)), 0.032)]
    return j


def skin(ob, tags):
    """依零件標籤直接指派權重 1.0，再對關節環兩側做 0.5 過渡。"""
    vg = {n: ob.vertex_groups.new(name=n) for n in GROUPS}
    me = ob.data
    W = [dict() for _ in me.vertices]

    for i, v in enumerate(me.vertices):
        z = v.co.z
        t = tags[i]
        if t == 'torso':
            if z < 1.005:
                a = _ramp(z, 0.955, 1.055)
                W[i] = {'hips': 1 - a, 'spine': a}
            elif z < 1.19:
                a = _ramp(z, 1.140, 1.240)
                W[i] = {'spine': 1 - a, 'chest': a}
            else:
                a = _ramp(z, 1.140, 1.240)
                W[i] = {'spine': 1 - a, 'chest': a}
        elif t == 'coat':
            a = min(0.55, max(0.0, (0.80 - z) / 0.34) * 0.55)
            th = 'thigh_R' if v.co.x >= 0 else 'thigh_L'
            W[i] = {'hips': 1 - a, th: a}
        else:
            W[i] = {t: 1.0}

    for (par, ch, pt, ax, r) in joint_list():
        ax = V(ax).normalized()
        for i, v in enumerate(me.vertices):
            w = W[i]
            if par not in w and ch not in w:
                continue
            if len(w) > 1 and par not in w:
                continue
            t = (v.co - V(pt)).dot(ax)
            if abs(t) >= r:
                continue
            f = 0.5 + 0.5 * t / r          # 關節平面正好 0.5
            base = dict(w)
            keep = {k: val for k, val in base.items() if k not in (par, ch)}
            amt = sum(val for k, val in base.items() if k in (par, ch))
            keep[par] = keep.get(par, 0.0) + amt * (1 - f)
            keep[ch] = keep.get(ch, 0.0) + amt * f
            W[i] = keep

    for i, w in enumerate(W):
        tot = sum(w.values()) or 1.0
        for k, val in w.items():
            if val > 1e-4:
                vg[k].add([i], val / tot, 'REPLACE')
    return vg


# ============================================================ 姿勢解算

def Rx(a):
    return Matrix.Rotation(a, 3, 'X')


def Ry(a):
    return Matrix.Rotation(a, 3, 'Y')


def Rz(a):
    return Matrix.Rotation(a, 3, 'Z')


def rot3(pitch=0.0, yaw=0.0, roll=0.0):
    """世界軸小旋轉：pitch>0 前傾（朝上的骨頭）、yaw>0 左轉、roll>0 右傾。"""
    return Rz(D(yaw)) @ Ry(D(roll)) @ Rx(D(-pitch))


def basis(ydir, zhint):
    y = V(ydir).normalized()
    z = V(zhint)
    z = z - y * z.dot(y)
    if z.length < 1e-5:
        z = V((0, 0, 1)) - y * y.z
        if z.length < 1e-5:
            z = V((0, 1, 0)) - y * y.y
    z.normalize()
    x = y.cross(z)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))


def ik2(root, target, l1, l2, hint):
    """兩段 IK：回傳 (dir1, dir2, joint_pos)。hint = 關節彎向。"""
    d = V(target) - V(root)
    dist = d.length
    lim = (l1 + l2) * 0.998
    if dist > lim:
        d = d * (lim / dist)
        dist = lim
    dist = max(dist, abs(l1 - l2) + 1e-4)
    ax = d / dist
    c = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    a1 = math.acos(max(-1.0, min(1.0, c)))
    h = V(hint)
    h = h - ax * h.dot(ax)
    if h.length < 1e-5:
        h = V((0, 1, 0)) - ax * ax.y
    h.normalize()
    d1 = (ax * math.cos(a1) + h * math.sin(a1)).normalized()
    jp = V(root) + d1 * l1
    d2 = (V(root) + d - jp).normalized()
    return d1, d2, jp


def defaults():
    return dict(
        hips=(0.0, 0.0, 0.900), pelvis=(0, 0, 0), spine=(0, 0, 0),
        chest=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0),
        # 腿：ankle 世界目標 + 腳尖角度（正 = 腳尖下壓）+ 腳掌左右偏航
        legR=((0.104, 0.0, 0.090), 0.0, 0.0),
        legL=((-0.104, 0.0, 0.090), 0.0, 0.0),
        # 手臂：('ang', down, fwd, elbow) 或 ('ik', (x,y,z), (hx,hy,hz))
        armR=('ang', 86, 4, 18),
        armL=('ang', 86, 4, 18),
        muzzle=(0.0, 1.0, 0.0),        # 世界槍口方向（決定 hand_R 朝向）
        cant=0.0,                      # 槍身側傾（度）
        handL=None,                    # 左手 z-hint；None = 沿用前臂
    )


def _arm_dirs(p, key, sg, sho_pos, chestR):
    mode = p[key][0]
    if mode == 'ik':
        tgt = V(p[key][1])
        hint = V(p[key][2])
        d1, d2, _ = ik2(sho_pos, tgt, L_UARM, L_FARM, chestR @ hint)
        return d1, d2
    down, fwd, elb = p[key][1], p[key][2], p[key][3]
    d0 = V((sg * math.cos(D(down)), 0, -math.sin(D(down))))
    d1 = chestR @ (Rx(D(fwd)) @ d0)
    d2 = chestR @ (Rx(D(fwd + elb)) @ d0)
    return d1.normalized(), d2.normalized()


def solve(p):
    """回傳 {bone: (head:Vector, basis:Matrix3)}。"""
    out = {}
    heads = {}
    rot = {}

    def put(name, b3, head=None):
        if head is None:
            par = PARENT[name]
            head = heads[par] + rot[par] @ (RHEAD[name] - RHEAD[par])
        heads[name] = head
        b0 = REST3[name]
        rot[name] = b3 @ b0.inverted()
        out[name] = (head, b3)

    Rpel = rot3(*p['pelvis'])
    Rspi = Rpel @ rot3(*p['spine'])
    Rche = Rspi @ rot3(*p['chest'])
    Rnec = Rche @ rot3(*p['neck'])
    Rhea = Rnec @ rot3(*p['head'])

    put('root', REST3['root'], V((0, 0, 0)))
    put('hips', Rpel @ REST3['hips'], V(p['hips']))
    put('spine', Rspi @ REST3['spine'])
    put('chest', Rche @ REST3['chest'])
    put('neck', Rnec @ REST3['neck'])
    put('head', Rhea @ REST3['head'])

    fwd = Rche @ V((0, 1, 0))
    for s, sg in (('R', 1), ('L', -1)):
        put('shoulder_' + s, Rche @ REST3['shoulder_' + s])
        ua = 'upperarm_' + s
        heads[ua] = heads['shoulder_' + s] + rot['shoulder_' + s] @ (
            RHEAD[ua] - RHEAD['shoulder_' + s])
        d1, d2 = _arm_dirs(p, 'arm' + s, sg, heads[ua], Rche)
        zh = -fwd
        put(ua, basis(d1, zh), heads[ua])
        put('forearm_' + s, basis(d2, zh))
        if s == 'R':
            mz = V(p['muzzle']).normalized()
            up = V((0, 0, 1))
            up = up - mz * up.dot(mz)
            if up.length < 1e-5:
                up = V((0, 1, 0))
            up.normalize()
            if p['cant']:
                up = Matrix.Rotation(D(p['cant']), 3, mz) @ up
            put('hand_R', basis(up, -mz))
        else:
            zh2 = V(p['handL']) if p['handL'] else zh
            put('hand_L', basis(d2, zh2))

    for s, sg in (('R', 1), ('L', -1)):
        th = 'thigh_' + s
        heads[th] = heads['hips'] + rot['hips'] @ (RHEAD[th] - RHEAD['hips'])
        tgt, toe, fyaw = p['leg' + s]
        d1, d2, _ = ik2(heads[th], V(tgt), L_THIGH, L_SHIN, Rpel @ V((0, 1, 0)))
        put(th, basis(d1, Rpel @ V((0, 1, 0))), heads[th])
        put('shin_' + s, basis(d2, Rpel @ V((0, 1, 0))))
        fd = RTAIL['foot_' + s] - RHEAD['foot_' + s]
        fm = Rz(D(fyaw)) @ Rx(D(-toe))
        put('foot_' + s, basis(fm @ fd, fm @ V((0, 0, 1))))
    return out


REST3 = {}


def cache_rest(arm_ob):
    REST3.clear()
    for n in ORDER:
        REST3[n] = rest_basis(arm_ob, n)


# ============================================================ 關鍵影格

def apply_pose(arm_ob, sol):
    for n in ORDER:
        head, b3 = sol[n]
        pb = arm_ob.pose.bones[n]
        bone = arm_ob.data.bones[n]
        want = Matrix.Translation(head) @ b3.to_4x4()
        par = PARENT[n]
        if par is None:
            local_rest = bone.matrix_local
            pw = Matrix.Identity(4)
        else:
            local_rest = arm_ob.data.bones[par].matrix_local.inverted() @ bone.matrix_local
            ph, pb3 = sol[par]
            pw = Matrix.Translation(ph) @ pb3.to_4x4()
        pb.matrix_basis = local_rest.inverted() @ (pw.inverted() @ want)


def bake_action(arm_ob, name, frames, posefn, step=2, loc_bones=('hips',)):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    fs = list(range(0, frames + 1, step))
    if fs[-1] != frames:
        fs.append(frames)
    for f in fs:
        apply_pose(arm_ob, solve(posefn(f / float(frames))))
        for n in ORDER:
            pb = arm_ob.pose.bones[n]
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if n in loc_bones:
                pb.keyframe_insert('location', frame=f)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = frames
    return act


# ============================================================ GLB extras 修補

def patch_glb(path, extras_by_anim, rename=None):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, total = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67
    off = 12
    chunks = []
    while off < len(data):
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunks.append([ctype, data[off + 8:off + 8 + clen]])
        off += 8 + clen
    js = json.loads(chunks[0][1].decode('utf-8'))
    names = []
    for i, an in enumerate(js.get('animations', [])):
        if rename and i < len(rename):
            an['name'] = rename[i]
        nm = an.get('name', '')
        names.append(nm)
        if nm in extras_by_anim:
            ex = an.setdefault('extras', {})
            ex.update(extras_by_anim[nm])
    raw = json.dumps(js, separators=(',', ':')).encode('utf-8')
    raw += b' ' * ((4 - len(raw) % 4) % 4)
    chunks[0][1] = raw
    out = b''
    for ctype, blob in chunks:
        pad = (4 - len(blob) % 4) % 4
        blob = blob + (b'\x00' if ctype != 0x4E4F534A else b' ') * pad
        out += struct.pack('<II', len(blob), ctype) + blob
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(out)) + out)
    return names


# ============================================================ 預覽

def shot(path, frame, size=(430, 560), yaw=62.0, pitch=7.0,
         scale=2.45, center=(0, -0.22, 0.80), bg='#3b4048'):
    sc = bpy.context.scene
    sc.frame_set(frame)
    cam = bpy.data.objects.get('prev_cam')
    if cam is None:
        cd = bpy.data.cameras.new('prev_cam')
        cam = bpy.data.objects.new('prev_cam', cd)
        bpy.context.collection.objects.link(cam)
        cd.type = 'ORTHO'
        cd.ortho_scale = scale
        y, p = D(yaw), D(pitch)
        dirv = V((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)))
        cam.location = V(center) + dirv * 6.0
        cam.rotation_euler = dirv.to_track_quat('Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'MATERIAL'
        sh.show_shadows = True
        sh.shadow_intensity = 0.42
        sh.show_cavity = True
        sh.cavity_type = 'BOTH'
        sh.curvature_ridge_factor = 1.4
        sh.curvature_valley_factor = 1.2
        c = C.srgb(bg)
        w = bpy.data.worlds.new('prev_world')
        w.use_nodes = True
        bgn = w.node_tree.nodes.get('Background')
        if bgn:
            bgn.inputs[0].default_value = (c[0], c[1], c[2], 1)
        sc.world = w
        try:
            sh.background_type = 'WORLD'
        except Exception:
            pass
        sc.display.render_aa = '16'
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def hstack(paths, out, labels=None):
    import numpy as np
    arrs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        arrs.append(a)
        bpy.data.images.remove(im)
    H = max(a.shape[0] for a in arrs)
    W = sum(a.shape[1] for a in arrs)
    big = np.zeros((H, W, 4), dtype=np.float32)
    big[:, :, 3] = 1.0
    x = 0
    for a in arrs:
        big[0:a.shape[0], x:x + a.shape[1]] = a
        x += a.shape[1]
    img = bpy.data.images.new('strip', W, H, alpha=False)
    img.pixels[:] = big.reshape(-1)
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return out
