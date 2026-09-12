"""參數化二戰步兵（頭身比 7.5、身高 1.75 m）＋ 六種輕兵器。

  blender -b -P scripts/blender/soldier.py -- --out public/models

產出：
  soldier_{us,de,de_coat}_{stand_rifle,advance_rifle,kneel_fire,prone_mg,crouch_run}.glb
  garand.glb thompson.glb bar.glb kar98k.glb mp40.glb mg42.glb

慣例：Blender +Y = 正面（匯出後為 glTF -Z）、Z 上、公尺、原點在腳底中心。
武器 glb 的原點在「握把」（右手扶握處），槍口朝 +Y、照門朝 +Z；
士兵 glb 內的空物件 `hand_r` 已擺好位置與朝向（為士兵網格的子節點），
程式端把武器場景圖掛到 hand_r 底下、local transform 歸零即可。

雪地偽裝：德軍制服材質名為 `de_uniform`，整合端把 base color 換白即可。
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402  (blender 執行環境)
from mathutils import Vector, Matrix          # noqa: E402
import _land_common as C                      # noqa: E402

D = math.radians
V = Vector


# ============================================================ 陣營設定

SIDES = {
    'us': dict(uniform='us_uniform', helmet='us_helmet', web='us_webbing',
               boots='us_boots', coat=False, boot_h=0.180, boot_r1=0.082,
               helmet_kind='m1'),
    'de': dict(uniform='de_uniform', helmet='de_helmet', web='de_webbing',
               boots='de_boots', coat=False, boot_h=0.300, boot_r1=0.086,
               helmet_kind='m35'),
    'de_coat': dict(uniform='de_uniform', helmet='de_helmet', web='de_webbing',
                    boots='de_boots', coat=True, boot_h=0.300, boot_r1=0.086,
                    helmet_kind='m35'),
}

POSES = ['stand_rifle', 'advance_rifle', 'kneel_fire', 'prone_mg', 'crouch_run']

POSE_WEAPON = {
    'stand_rifle':   ('garand', 'kar98k'),
    'advance_rifle': ('garand', 'kar98k'),
    'kneel_fire':    ('garand', 'kar98k'),
    'prone_mg':      ('bar', 'mg42'),
    'crouch_run':    ('thompson', 'mp40'),
}


# ============================================================ 姿態表
# 全部世界座標（公尺）；pitch = 軀幹前傾角（度）、yaw = 軀幹左右轉。
# toe 的 z = 0 表示腳尖著地。

P = {}

P['stand_rifle'] = dict(
    pelvis=(0, 0.0, 0.920), pitch=3, yaw=0, head_pitch=0, head_yaw=8,
    legs=dict(
        r=dict(knee=(0.100, 0.015, 0.475), ankle=(0.104, -0.005, 0.088), toe=(0.112, 0.205, 0.0)),
        l=dict(knee=(-0.100, 0.010, 0.475), ankle=(-0.104, -0.010, 0.088), toe=(-0.126, 0.198, 0.0)),
    ),
    arms=dict(
        r=dict(elbow=(0.215, 0.050, 1.160), wrist=(0.132, 0.245, 1.035)),
        l=dict(elbow=(-0.185, 0.165, 1.145), wrist=(-0.020, 0.360, 1.268)),
    ),
    grip=((0.125, 0.250, 1.030), (-0.42, 0.40, 0.82), 0),
)

P['advance_rifle'] = dict(
    pelvis=(0, 0.020, 0.905), pitch=11, yaw=-5, head_pitch=-3, head_yaw=6,
    legs=dict(
        r=dict(knee=(0.105, 0.265, 0.495), ankle=(0.100, 0.410, 0.090), toe=(0.106, 0.612, 0.0)),
        l=dict(knee=(-0.105, -0.115, 0.455), ankle=(-0.110, -0.325, 0.150), toe=(-0.118, -0.492, 0.0)),
    ),
    arms=dict(
        r=dict(elbow=(0.222, -0.015, 1.130), wrist=(0.150, 0.195, 1.045)),
        l=dict(elbow=(-0.115, 0.255, 1.060), wrist=(0.075, 0.470, 1.010)),
    ),
    grip=((0.145, 0.205, 1.040), (-0.16, 0.97, -0.14), 0),
)

P['kneel_fire'] = dict(
    pelvis=(0, -0.050, 0.545), pitch=14, yaw=-5, head_pitch=-6, head_yaw=3,
    legs=dict(
        r=dict(knee=(0.110, 0.010, 0.088), ankle=(0.115, -0.385, 0.078), toe=(0.118, -0.520, 0.0)),
        l=dict(knee=(-0.128, 0.395, 0.455), ankle=(-0.135, 0.285, 0.088), toe=(-0.140, 0.482, 0.0)),
    ),
    arms=dict(
        r=dict(elbow=(0.362, 0.058, 0.884), wrist=(0.156, 0.256, 0.952)),
        l=dict(elbow=(-0.060, 0.300, 0.830), wrist=(0.102, 0.484, 0.937)),
    ),
    grip=((0.150, 0.270, 0.955), (-0.22, 0.972, -0.08), 0),
)

P['prone_mg'] = dict(
    pelvis=(0, -0.340, 0.150), pitch=76, yaw=0, head_pitch=-56, head_yaw=0,
    legs=dict(
        r=dict(knee=(0.245, -0.725, 0.118), ankle=(0.292, -1.092, 0.100), toe=(0.330, -1.205, 0.058)),
        l=dict(knee=(-0.245, -0.725, 0.118), ankle=(-0.292, -1.092, 0.100), toe=(-0.330, -1.205, 0.058)),
    ),
    arms=dict(
        r=dict(elbow=(0.360, 0.240, 0.090), wrist=(0.215, 0.430, 0.200)),
        l=dict(elbow=(-0.365, 0.250, 0.085), wrist=(-0.185, 0.440, 0.178)),
    ),
    grip=((0.205, 0.425, 0.205), (-0.08, 0.995, 0.055), 0),
)

P['crouch_run'] = dict(
    pelvis=(0, 0.020, 0.745), pitch=27, yaw=-7, head_pitch=-14, head_yaw=6,
    legs=dict(
        r=dict(knee=(0.115, 0.355, 0.520), ankle=(0.105, 0.300, 0.158), toe=(0.110, 0.478, 0.075)),
        l=dict(knee=(-0.115, -0.230, 0.430), ankle=(-0.130, -0.520, 0.188), toe=(-0.136, -0.668, 0.0)),
    ),
    arms=dict(
        r=dict(elbow=(0.285, 0.225, 0.910), wrist=(0.175, 0.455, 0.845)),
        l=dict(elbow=(-0.222, 0.100, 0.990), wrist=(-0.200, -0.140, 0.930)),
    ),
    grip=((0.178, 0.462, 0.848), (-0.18, 0.94, -0.29), 0),
)


# ============================================================ 小工具

def aim(fwd, roll=0.0):
    """讓本地 +Y 指向 fwd、+Z 朝上的旋轉矩陣。"""
    q = V(fwd).normalized().to_track_quat('Y', 'Z')
    m = q.to_matrix().to_4x4()
    if roll:
        m = m @ Matrix.Rotation(roll, 4, 'Y')
    return m


def torso_matrix(p):
    return (Matrix.Translation(V(p['pelvis']))
            @ Matrix.Rotation(D(p['yaw']), 4, 'Z')
            @ Matrix.Rotation(D(-p['pitch']), 4, 'X'))


# 軀幹斷面（局部 z、寬、深）
TORSO = [(-0.062, 0.302, 0.206),
         (0.060, 0.288, 0.190),
         (0.190, 0.334, 0.214),
         (0.330, 0.378, 0.230),
         (0.462, 0.408, 0.220),
         (0.520, 0.358, 0.208),
         (0.566, 0.212, 0.178),
         (0.598, 0.142, 0.146)]
NT = 10

SHO = 0.180      # 肩關節局部 x
SHO_Z = 0.462
HIP_X = 0.095
HIP_Z = -0.020
NECK_Z = 0.598


def helmet_mesh(b, HM, prof, n, rfun, zfun, base, mat, oval=1.06):
    rings = []
    body = prof[1:]
    for i, (r, z) in enumerate(body):
        rg = []
        for j in range(n):
            th = math.tau * j / n
            rr = r * (rfun(th, i, len(body)) if rfun else 1.0)
            zz = z + base + (zfun(th, i, len(body)) if zfun else 0.0)
            rg.append(tuple(HM @ V((rr * math.cos(th),
                                    rr * oval * math.sin(th) + 0.006, zz))))
        rings.append(rg)
    rings = rings[::-1]
    verts = []
    for rg in rings:
        verts.extend(rg)
    faces = []
    for i in range(len(rings) - 1):
        a, bb = i * n, (i + 1) * n
        for j in range(n):
            k = (j + 1) % n
            faces.append((a + j, a + k, bb + k, bb + j))
    faces.append(tuple(range(n - 1, -1, -1)))          # 盔緣底面
    o = (len(rings) - 1) * n
    ai = len(verts)
    verts.append(tuple(HM @ V((0, 0.006, prof[0][1] + base))))
    for j in range(n):
        faces.append((o + (j + 1) % n, o + j, ai))
    b.add(verts, faces, mat, True)


# ============================================================ 身體

def build_body(b, side, pose_name, offset=(0, 0, 0)):
    cfg = SIDES[side]
    p = P[pose_name]
    uni, hel, web, bts = cfg['uniform'], cfg['helmet'], cfg['web'], cfg['boots']
    off = V(offset)
    M = Matrix.Translation(off) @ torso_matrix(p)

    def L(v):
        return tuple(M @ V(v))

    def W(v):
        return tuple(off + V(v))

    # ---- 軀幹 -------------------------------------------------------
    rings = [[tuple(M @ V((q[0], q[1], z)))
              for q in C.superellipse(w, d, NT, 3.2)] for (z, w, d) in TORSO]
    b.loft(rings, uni, True, True, True)

    if cfg['coat']:                                    # 長大衣下襬
        clen = -0.56 if pose_name != 'prone_mg' else -0.44
        cr = [[tuple(M @ V((q[0], q[1], z)))
               for q in C.superellipse(w, d, NT, 3.0)]
              for (z, w, d) in [(0.085, 0.352, 0.232), (-0.050, 0.398, 0.266),
                                (-0.300, 0.448, 0.306), (clen, 0.466, 0.318)]]
        b.loft(cr[::-1], uni, True, True, True)
        b.box((0.330, 0.196, 0.068), loc=L((0, 0.008, 0.512)), m=uni, smooth=True)

    # ---- 頭 ---------------------------------------------------------
    HM = (M @ Matrix.Translation(V((0, 0, NECK_Z)))
          @ Matrix.Rotation(D(p['head_yaw']), 4, 'Z')
          @ Matrix.Rotation(D(-p['head_pitch']), 4, 'X'))

    def H(v):
        return tuple(HM @ V(v))

    b.tube(H((0, 0.004, -0.052)), H((0, 0.008, 0.046)), 0.051, 0.047, 6, uni)
    prof = [(0.000, 0.210), (0.052, 0.194), (0.083, 0.148),
            (0.090, 0.098), (0.080, 0.050), (0.050, 0.024)]
    b.loft([[tuple(HM @ V((r * math.cos(math.tau * i / 8),
                           r * 1.14 * math.sin(math.tau * i / 8) + 0.006, z)))
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

    helmet_mesh(b, HM, hprof, 14, hrf, hzf, 0.106, hel)
    b.beam(H((0.100, 0.008, 0.072)), H((0.034, 0.050, 0.008)), 0.011, 0.026, web)
    b.beam(H((-0.100, 0.008, 0.072)), H((-0.034, 0.050, 0.008)), 0.011, 0.026, web)

    # ---- 四肢 -------------------------------------------------------
    for s, sg in (('r', 1), ('l', -1)):
        a = p['arms'][s]
        sh = V(L((sg * SHO, 0.0, SHO_Z)))
        el, wr = V(W(a['elbow'])), V(W(a['wrist']))
        b.sphere(0.068, tuple(sh), 8, 4, uni)
        b.tube(tuple(sh), tuple(el), 0.058, 0.046, 6, uni)
        b.sphere(0.050, tuple(el), 6, 3, uni)
        b.tube(tuple(el), tuple(wr), 0.047, 0.042, 6, uni)
        fw = (wr - el).normalized()
        b.tube(tuple(wr - fw * 0.040), tuple(wr + fw * 0.010), 0.049, 0.047, 6, uni)
        b.beam(tuple(wr + fw * 0.008), tuple(wr + fw * 0.094), 0.050, 0.076, 'skin')

        # 腿
        g = p['legs'][s]
        hp = V(L((sg * HIP_X, 0.0, HIP_Z)))
        kn, an, te = V(W(g['knee'])), V(W(g['ankle'])), V(W(g['toe']))
        b.tube(tuple(hp), tuple(kn), 0.099, 0.073, 8, uni)
        b.sphere(0.074, tuple(kn), 6, 3, uni)
        b.tube(tuple(kn), tuple(an), 0.071, 0.050, 8, uni)
        # 靴筒
        up = (kn - an).normalized()
        b.tube(tuple(an - up * 0.030), tuple(an + up * cfg['boot_h']),
               0.064, cfg['boot_r1'], 8, bts)
        # 靴身（腳跟→腳尖，貼地）
        td = V((te.x - an.x, te.y - an.y, 0.0))
        td = td.normalized() if td.length > 1e-4 else V((0, 1, 0))
        heel = V((an.x, an.y, 0)) - td * 0.062
        b.beam((heel.x, heel.y, an.z - 0.047), (te.x, te.y, te.z + 0.039),
               0.098, 0.078, bts)

        # 美軍傘兵大腿口袋
        if side == 'us' and not cfg['coat']:
            t0 = hp + (kn - hp) * 0.34
            t1 = hp + (kn - hp) * 0.78
            ow = V((sg * 0.074, 0, 0))
            b.beam(tuple(t0 + ow), tuple(t1 + ow), 0.138, 0.044, uni, up=(sg, 0, 0))

    # ---- 裝具 -------------------------------------------------------
    belt_z = 0.055 if cfg['coat'] else 0.048
    br = []
    for z in (belt_z - 0.034, belt_z + 0.034):
        w = C.lerp(TORSO[1][1], TORSO[2][1], 0.12) + 0.018
        d = C.lerp(TORSO[1][2], TORSO[2][2], 0.12) + 0.018
        br.append([tuple(M @ V((q[0], q[1], z))) for q in C.superellipse(w, d, NT, 3.2)])
    b.loft(br, web, False, True, True)
    b.box((0.058, 0.028, 0.048), loc=L((0, 0.106, belt_z)), m=web)

    # Y 型背帶
    for sg in (1, -1):
        b.beam(L((sg * 0.072, 0.098, 0.452)), L((sg * 0.098, 0.100, belt_z + 0.030)),
               0.040, 0.013, web)
        b.beam(L((sg * 0.080, 0.076, 0.470)), L((sg * 0.088, -0.076, 0.452)),
               0.046, 0.015, web)
        b.beam(L((sg * 0.088, -0.082, 0.440)), L((sg * 0.072, -0.100, belt_z + 0.038)),
               0.040, 0.013, web)

    if side == 'us':
        for sg in (1, -1):                                   # M42 胸前大口袋
            b.box((0.098, 0.020, 0.118), loc=L((sg * 0.080, 0.104, 0.300)), m=uni)
        for x in (-0.112, -0.038, 0.046, 0.118):             # 彈藥帶盒
            b.box((0.066, 0.044, 0.084), loc=L((x, 0.096, belt_z + 0.010)), m=web)
        b.box((0.240, 0.108, 0.215), loc=L((0, -0.158, 0.205)), m=web)   # musette
        b.tube(L((0.142, -0.070, belt_z - 0.024)), L((0.146, -0.070, belt_z - 0.170)),
               0.050, 0.048, 8, web)                          # 水壺
        b.box((0.108, 0.028, 0.165), loc=L((-0.138, -0.128, belt_z - 0.110)), m=web)
    else:
        for sg in (1, -1):                                   # 三聯彈匣袋
            for i in range(3):
                b.box((0.045, 0.048, 0.092),
                      loc=L((sg * (0.052 + i * 0.047), 0.100, belt_z + 0.008)), m=web)
        b.box((0.195, 0.090, 0.150), loc=L((0.036, -0.148, belt_z - 0.050)), m=web)
        gm = (Matrix.Translation(V(L((-0.152, -0.104, belt_z - 0.060))))
              @ Matrix.Rotation(D(-18), 4, 'Y'))
        b.tube(tuple(gm @ V((0, 0, -0.115))), tuple(gm @ V((0, 0, 0.115))),
               0.058, 0.058, 10, web)                         # 防毒面具罐
        b.box((0.100, 0.026, 0.175), loc=L((-0.148, -0.068, belt_z - 0.125)), m=web)
        b.box((0.176, 0.166, 0.036), loc=L((0, 0.004, 0.556)), m=uni, smooth=True)

    gp, gf, gr = p['grip']
    return Matrix.Translation(off + V(gp)) @ aim(gf, D(gr))


# ============================================================ 武器
# 原點 = 握把；槍口 +Y；照門 +Z

def w_garand(b, m='wood'):
    b.beam((0, -0.300, 0.010), (0, -0.040, 0.006), 0.046, 0.118, m, h1=0.078)
    b.beam((0, -0.060, -0.008), (0, 0.055, 0.004), 0.040, 0.058, m)
    b.beam((0, 0.030, 0.000), (0, 0.395, 0.002), 0.048, 0.066, m)
    b.beam((0, 0.300, 0.026), (0, 0.560, 0.026), 0.042, 0.034, m)
    b.box((0.048, 0.215, 0.062), loc=(0, 0.060, 0.026), m='gunmetal')
    b.tube((0, 0.100, 0.030), (0, 0.820, 0.030), 0.0115, 0.0090, 8, 'gunmetal')
    b.tube((0, 0.440, 0.011), (0, 0.800, 0.011), 0.0095, 0.0095, 6, 'gunmetal')
    b.box((0.030, 0.070, 0.024), loc=(0, -0.015, -0.030), m='gunmetal')
    b.box((0.013, 0.020, 0.032), loc=(0, 0.795, 0.052), m='gunmetal')
    b.box((0.032, 0.024, 0.028), loc=(0, 0.140, 0.062), m='gunmetal')
    b.beam((0.020, 0.075, 0.030), (0.060, 0.055, 0.012), 0.012, 0.012, 'gunmetal')


def w_thompson(b, m='wood'):
    b.beam((0, -0.275, 0.020), (0, -0.030, 0.028), 0.046, 0.098, m, h1=0.070)
    b.box((0.050, 0.300, 0.076), loc=(0, 0.125, 0.036), m='gunmetal')
    b.tube((0, 0.255, 0.042), (0, 0.520, 0.042), 0.0120, 0.0105, 8, 'gunmetal')
    b.beam((0, 0.195, -0.002), (0, 0.340, 0.000), 0.052, 0.056, m)
    b.beam((0, 0.005, -0.010), (0, -0.030, -0.135), 0.036, 0.052, m)
    b.box((0.026, 0.052, 0.185), loc=(0, 0.150, -0.070), m='gunmetal')
    b.box((0.013, 0.018, 0.028), loc=(0, 0.505, 0.062), m='gunmetal')
    b.box((0.030, 0.022, 0.026), loc=(0, 0.185, 0.080), m='gunmetal')


def w_bar(b, m='wood'):
    b.beam((0, -0.340, 0.012), (0, -0.060, 0.022), 0.050, 0.112, m, h1=0.080)
    b.beam((0, -0.070, -0.006), (0, 0.040, 0.006), 0.042, 0.060, m)
    b.box((0.056, 0.330, 0.086), loc=(0, 0.115, 0.032), m='gunmetal')
    b.beam((0, 0.230, 0.006), (0, 0.430, 0.006), 0.050, 0.058, m)
    b.tube((0, 0.290, 0.036), (0, 0.730, 0.036), 0.0135, 0.0110, 8, 'gunmetal')
    b.box((0.030, 0.082, 0.165), loc=(0, 0.095, -0.095), m='gunmetal')
    b.beam((0, 0.010, -0.012), (0, -0.020, -0.125), 0.034, 0.050, m)
    b.box((0.032, 0.075, 0.024), loc=(0, -0.010, -0.036), m='gunmetal')
    for sg in (1, -1):
        b.tube((sg * 0.018, 0.640, 0.020), (sg * 0.112, 0.700, -0.190),
               0.008, 0.007, 5, 'gunmetal')
        b.box((0.038, 0.068, 0.014), loc=(sg * 0.114, 0.702, -0.194), m='gunmetal')
    b.box((0.013, 0.020, 0.030), loc=(0, 0.712, 0.058), m='gunmetal')


def w_kar98k(b, m='wood'):
    b.beam((0, -0.310, 0.000), (0, -0.030, 0.010), 0.046, 0.118, m, h1=0.076)
    b.beam((0, -0.055, -0.006), (0, 0.060, 0.004), 0.040, 0.058, m)
    b.beam((0, 0.030, 0.000), (0, 0.530, -0.004), 0.046, 0.062, m, h1=0.046)
    b.beam((0, 0.120, 0.030), (0, 0.430, 0.030), 0.038, 0.024, m)
    b.box((0.042, 0.190, 0.054), loc=(0, 0.030, 0.026), m='gunmetal')
    b.tube((0, 0.120, 0.028), (0, 0.720, 0.028), 0.0100, 0.0088, 8, 'gunmetal')
    b.tube((0.017, 0.020, 0.030), (0.062, 0.002, 0.008), 0.0072, 0.0068, 6, 'gunmetal')
    b.sphere(0.0135, (0.068, -0.001, 0.004), 6, 3, 'gunmetal')
    b.box((0.030, 0.026, 0.026), loc=(0, 0.155, 0.050), m='gunmetal')
    b.box((0.018, 0.030, 0.034), loc=(0, 0.705, 0.050), m='gunmetal')
    b.box((0.028, 0.060, 0.022), loc=(0, -0.005, -0.028), m='gunmetal')
    b.box((0.044, 0.052, 0.044), loc=(0, 0.545, 0.012), m='gunmetal')


def w_mp40(b, m='gunmetal'):
    b.tube((0, -0.010, 0.022), (0, 0.300, 0.022), 0.024, 0.022, 10, m)
    b.tube((0, 0.300, 0.022), (0, 0.505, 0.022), 0.0115, 0.0105, 8, m)
    b.tube((0, 0.430, 0.001), (0, 0.470, 0.001), 0.019, 0.019, 8, m)
    b.box((0.038, 0.230, 0.048), loc=(0, -0.020, -0.012), m=m)
    b.box((0.036, 0.062, 0.060), loc=(0, 0.100, -0.030), m=m)
    b.box((0.026, 0.046, 0.215), loc=(0, 0.100, -0.145), m=m)
    b.beam((0, 0.005, -0.012), (0, -0.032, -0.130), 0.034, 0.046, 'rubber')
    b.box((0.030, 0.058, 0.022), loc=(0, -0.012, -0.036), m=m)
    for sg in (1, -1):
        b.tube((sg * 0.026, -0.095, -0.020), (sg * 0.026, -0.300, 0.016),
               0.0075, 0.0075, 5, m)
    b.beam((-0.045, -0.322, 0.020), (0.045, -0.322, 0.020), 0.030, 0.036, m)
    b.box((0.014, 0.018, 0.026), loc=(0, 0.492, 0.046), m=m)


def w_mg42(b, m='gunmetal'):
    b.tube((0, 0.045, 0.032), (0, 0.575, 0.032), 0.034, 0.032, 10, m)
    b.tube((0, 0.575, 0.032), (0, 0.760, 0.032), 0.014, 0.012, 8, m)
    b.box((0.062, 0.300, 0.092), loc=(0, -0.095, 0.032), m=m)
    b.beam((0, -0.230, 0.024), (0, -0.455, 0.004), 0.052, 0.080, 'timber', h1=0.062)
    b.beam((0, 0.005, -0.014), (0, -0.036, -0.128), 0.036, 0.050, 'rubber')
    b.box((0.032, 0.062, 0.024), loc=(0, -0.014, -0.038), m=m)
    b.tube((-0.052, -0.060, -0.016), (-0.118, -0.060, -0.016), 0.072, 0.072, 10,
           'metal_dark')                                        # 彈鼓
    for sg in (1, -1):                                          # 兩腳架
        b.tube((sg * 0.014, 0.500, 0.014), (sg * 0.170, 0.578, -0.195),
               0.0085, 0.0075, 5, m)
        b.box((0.044, 0.076, 0.014), loc=(sg * 0.172, 0.580, -0.199), m=m)
    b.box((0.016, 0.022, 0.034), loc=(0, 0.742, 0.058), m=m)
    b.box((0.030, 0.026, 0.038), loc=(0, 0.020, 0.088), m=m)
    b.beam((0.031, -0.050, 0.070), (0.031, -0.180, 0.070), 0.010, 0.010, m)


WEAPONS = {
    'garand': w_garand, 'thompson': w_thompson, 'bar': w_bar,
    'kar98k': w_kar98k, 'mp40': w_mp40, 'mg42': w_mg42,
}


# ============================================================ 組裝

def make_soldier(side, pose, do_export=True, offset=(0, 0, 0), weapon=False):
    b = C.B()
    GM = build_body(b, side, pose, offset=offset)
    name = 'soldier_%s_%s' % (side, pose)
    ob = b.finish(name, uv_scale=0.5)
    objs = [ob]
    hand = C.empty('hand_r', size=0.09)
    hand.matrix_world = GM
    C.setparent(hand, ob)
    objs.append(hand)
    n = 0
    if do_export:
        _, n = C.export(objs, name)
    if weapon:
        wb = C.B()
        WEAPONS[POSE_WEAPON[pose][0 if side == 'us' else 1]](wb)
        wo = wb.finish('wp_%s_%s' % (side, pose), uv_scale=0.25)
        wo.matrix_world = GM
        objs.append(wo)
    return objs, n


def make_weapon(name, do_export=True, offset=(0, 0, 0)):
    b = C.B()
    WEAPONS[name](b)
    ob = b.finish(name if do_export else name + '_p', uv_scale=0.25)
    ob.location = offset
    n = 0
    if do_export:
        _, n = C.export([ob], name)
    return ob, n


def main():
    stats = []

    for wn in WEAPONS:
        C.reset()
        _, n = make_weapon(wn)
        stats.append((wn, n))

    C.reset()                                   # 武器側視總覽（由上到下）
    objs = [make_weapon(wn, False, (0, 0, -i * 0.30))[0]
            for i, wn in enumerate(WEAPONS)]
    C.render(objs, 'weapons', yaw=90, pitch=7, zoom=1.03, size=(1024, 860))

    for side in SIDES:
        for pose in POSES:
            C.reset()
            _, n = make_soldier(side, pose)
            stats.append(('soldier_%s_%s' % (side, pose), n))

    for side in SIDES:                          # 五姿態並排
        C.reset()
        objs = []
        for i, pose in enumerate(POSES):
            o, _ = make_soldier(side, pose, False, (2.5 - i * 1.25, 0, 0), weapon=True)
            objs.extend(o)
        C.render([o for o in objs if o.type == 'MESH'], 'soldier_%s' % side,
                 yaw=24, pitch=13, zoom=1.04, size=(1500, 560))

    for side, pose, yaw, pitch in (('us', 'stand_rifle', 38, 10),
                                   ('de', 'stand_rifle', 38, 10),
                                   ('us', 'kneel_fire', 48, 12),
                                   ('us', 'crouch_run', 42, 12),
                                   ('de', 'prone_mg', 54, 16),
                                   ('de_coat', 'advance_rifle', 38, 10)):
        C.reset()
        o, _ = make_soldier(side, pose, False, weapon=True)
        C.render([x for x in o if x.type == 'MESH'],
                 'soldier_%s_%s' % (side, pose), yaw=yaw, pitch=pitch, zoom=1.04)

    print('\n=== 三角形數 ===')
    for (n, t) in stats:
        print('%-34s %5d' % (n, t))


if __name__ == '__main__':
    main()
