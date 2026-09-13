"""帶骨架與循環動畫的二戰步兵（docs/realism-spec.md §R1）。

  "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" -b \
      -P scripts/blender/soldier_rig.py -- --out public/models

產出：public/models/soldier_rig_{us,de,de_coat}.glb
      assets-src/previews/soldier_rig_{us,de,de_coat}.png

每個 glb：單一 T-pose 蒙皮網格（≤ 2k 三角形）、20 根骨頭、7 個 action
（idle／walk／run／crouch_walk／kneel_fire／prone_fire／hit_fall），
walk／run／crouch_walk 的 glTF animation extras 帶 speed（m/s）。

武器不含在內：掛點是骨頭 hand_R，骨頭 head 在拳心；
glTF 節點局部 -Z = 槍口、+Y = 照門朝上，武器 glb 掛上去 local transform 歸零即可。
"""

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy                                    # noqa: E402
import _land_common as C                      # noqa: E402
import _rig_common as R                       # noqa: E402

TAU = math.tau
FPS = 30


# ============================================================ 曲線工具

def curve(t, pts, cyclic=True):
    if not cyclic:
        if t <= pts[0][0]:
            return pts[0][1]
        if t >= pts[-1][0]:
            return pts[-1][1]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if a[0] <= t <= b[0]:
                f = (t - a[0]) / max(1e-9, b[0] - a[0])
                return a[1] + (b[1] - a[1]) * f
        return pts[-1][1]
    t %= 1.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        x0, x1 = a[0], b[0]
        if x1 <= x0:
            x1 += 1.0
        tt = t if t >= x0 else t + 1.0
        if x0 <= tt <= x1:
            f = (tt - x0) / max(1e-9, x1 - x0)
            return a[1] + (b[1] - a[1]) * f
    return pts[0][1]


def cs(t, amp=1.0, phase=0.0):
    return amp * math.cos(TAU * (t + phase))


def sn(t, amp=1.0, phase=0.0):
    return amp * math.sin(TAU * (t + phase))


# ============================================================ 步態

def gait(t, ytab, ztab, toetab, x, sg):
    """回傳 (ankle 目標, 腳尖角, 腳掌偏航)。"""
    return ((x * sg, curve(t, ytab), curve(t, ztab)), curve(t, toetab), sg * 5.0)


WALK_Y = [(0.00, 0.40), (0.60, -0.44), (0.72, -0.20), (0.84, 0.16), (0.94, 0.36)]
WALK_Z = [(0.00, 0.098), (0.10, 0.086), (0.45, 0.086), (0.55, 0.110),
          (0.64, 0.185), (0.76, 0.212), (0.88, 0.150), (0.96, 0.108)]
WALK_T = [(0.00, -12), (0.10, 2), (0.42, 4), (0.58, 32), (0.70, 6), (0.84, -8),
          (0.94, -12)]

RUN_Y = [(0.00, 0.34), (0.34, -0.38), (0.48, -0.30), (0.62, 0.02), (0.78, 0.30),
         (0.92, 0.40)]
RUN_Z = [(0.00, 0.100), (0.08, 0.088), (0.26, 0.100), (0.36, 0.230),
         (0.50, 0.420), (0.66, 0.400), (0.80, 0.230), (0.92, 0.125)]
RUN_T = [(0.00, -6), (0.08, 8), (0.30, 40), (0.42, 18), (0.60, -12), (0.85, -8)]

CW_Y = [(0.00, 0.30), (0.62, -0.38), (0.74, -0.16), (0.86, 0.12), (0.95, 0.26)]
CW_Z = [(0.00, 0.095), (0.10, 0.088), (0.50, 0.088), (0.60, 0.120),
        (0.70, 0.190), (0.82, 0.170), (0.94, 0.110)]
CW_T = [(0.00, -6), (0.12, 2), (0.50, 6), (0.62, 26), (0.74, 2), (0.88, -6)]


# ============================================================ 七個 clip

def p_idle(t):
    p = R.defaults()
    br = sn(t, 1.0)                     # 呼吸
    p['hips'] = (0.0, 0.004 * br, 0.893 + 0.006 * br)
    p['pelvis'] = (2.0, sn(t, 0.8, 0.12), 0.0)
    p['spine'] = (2.0 + 0.9 * br, -7.0, 0.0)
    p['chest'] = (1.0 - 1.6 * br, -9.0 + sn(t, 1.6, 0.25), 0.0)
    p['neck'] = (-1.0 + 0.6 * br, 0.0, 0.0)
    p['head'] = (-2.0, sn(t, 2.2, 0.4), 0.0)
    p['legR'] = ((0.105, 0.010, 0.090), 0.0, 6.0)
    p['legL'] = ((-0.105, -0.010, 0.090), 0.0, -6.0)
    sway = sn(t, 0.012, 0.25)
    p['armR'] = ('ik', (0.170, 0.345 + sway, 1.180), (0.72, -0.30, -0.62))
    p['armL'] = ('ik', (0.155, 0.535 + sway, 1.130), (-0.35, -0.30, -0.88))
    p['muzzle'] = (0.06 + 0.02 * br, 0.955, -0.29 + 0.03 * br)
    return p


def p_walk(t):
    p = R.defaults()
    p['legR'] = gait(t, WALK_Y, WALK_Z, WALK_T, 0.100, 1)
    p['legL'] = gait(t + 0.5, WALK_Y, WALK_Z, WALK_T, 0.100, -1)
    p['hips'] = (0.0, 0.0, 0.856 - 0.013 * math.cos(2 * TAU * t))
    p['pelvis'] = (2.0, cs(t, 4.0), cs(t, 3.0, 0.25))
    p['spine'] = (3.0, cs(t, -2.0), 0.0)
    p['chest'] = (3.0, cs(t, -4.5), cs(t, -2.0, 0.25))
    p['neck'] = (-1.5, 0.0, 0.0)
    p['head'] = (-1.5, cs(t, 2.0), 0.0)
    p['armR'] = ('ang', 80, 12 - 8 * math.cos(TAU * t), 58)
    p['armL'] = ('ang', 82, 10 + 22 * math.cos(TAU * t), 34)
    p['muzzle'] = (0.10, 0.955, 0.28)
    return p


def p_run(t):
    p = R.defaults()
    p['legR'] = gait(t, RUN_Y, RUN_Z, RUN_T, 0.096, 1)
    p['legL'] = gait(t + 0.5, RUN_Y, RUN_Z, RUN_T, 0.096, -1)
    p['hips'] = (0.0, 0.0, 0.850 + 0.045 * math.cos(2 * TAU * t))
    p['pelvis'] = (5.0, cs(t, 6.0), cs(t, 4.0, 0.25))
    p['spine'] = (4.0, cs(t, -3.0), 0.0)
    p['chest'] = (4.0, cs(t, -7.0), cs(t, -3.0, 0.25))
    p['neck'] = (-6.0, 0.0, 0.0)
    p['head'] = (-6.0, cs(t, 3.0), 0.0)
    p['armR'] = ('ang', 76, 18 - 26 * math.cos(TAU * t), 82)
    p['armL'] = ('ang', 78, 18 + 34 * math.cos(TAU * t), 76)
    p['muzzle'] = (0.16, 0.930, 0.33)
    return p


def p_crouch(t):
    p = R.defaults()
    p['legR'] = gait(t, CW_Y, CW_Z, CW_T, 0.108, 1)
    p['legL'] = gait(t + 0.5, CW_Y, CW_Z, CW_T, 0.108, -1)
    p['hips'] = (0.0, -0.020, 0.700 - 0.012 * math.cos(2 * TAU * t))
    p['pelvis'] = (8.0, cs(t, 3.0), cs(t, 2.0, 0.25))
    p['spine'] = (10.0, -8.0 + cs(t, -1.5), 0.0)
    p['chest'] = (8.0, -10.0 + cs(t, -2.5), 0.0)
    p['neck'] = (-14.0, 0.0, 0.0)
    p['head'] = (-8.0, 0.0, 0.0)
    bob = 0.010 * math.cos(2 * TAU * t)
    p['armR'] = ('ik', (0.168, 0.430, 1.090 + bob), (0.76, -0.26, -0.60))
    p['armL'] = ('ik', (0.160, 0.620, 1.038 + bob), (-0.34, -0.28, -0.90))
    p['muzzle'] = (0.05, 0.985, -0.16)
    return p


def p_kneel(t):
    p = R.defaults()
    rec = curve(t, [(0.00, 0.0), (0.26, 0.0), (0.30, 1.0), (0.40, 0.35),
                    (0.52, 0.0), (0.90, 0.0)])
    br = sn(t, 1.0)
    p['hips'] = (0.0, -0.050, 0.500 + 0.004 * br - 0.010 * rec)
    p['pelvis'] = (10.0 - 2.0 * rec, -4.0, 0.0)
    p['spine'] = (9.0 - 1.5 * rec, -9.0, 0.0)
    p['chest'] = (7.0 + 0.8 * br - 2.5 * rec, -12.0, 0.0)
    p['neck'] = (-6.0, 3.0, 0.0)
    p['head'] = (-4.0, 3.0, 0.0)
    p['legR'] = ((0.112, -0.470, 0.105), 62.0, 6.0)
    p['legL'] = ((-0.112, 0.360, 0.090), 0.0, -4.0)
    p['armR'] = ('ik', (0.172, 0.400, 0.952 - 0.012 * rec), (0.78, -0.22, -0.58))
    p['armL'] = ('ik', (0.150, 0.580, 0.906), (-0.30, -0.30, -0.90))
    p['muzzle'] = (0.045, 0.996, -0.055 + 0.052 * rec)
    return p


def p_prone(t):
    p = R.defaults()
    rec = curve(t, [(0.00, 0.0), (0.30, 0.0), (0.34, 1.0), (0.44, 0.30),
                    (0.56, 0.0), (0.92, 0.0)])
    br = sn(t, 1.0)
    p['hips'] = (0.0, -0.300, 0.150 + 0.006 * br)
    p['pelvis'] = (76.0, 0.0, 0.0)
    p['spine'] = (6.0 - 1.5 * rec, -6.0, 0.0)
    p['chest'] = (4.0 + 0.8 * br - 2.0 * rec, -9.0, 0.0)
    p['neck'] = (-20.0, 0.0, 0.0)
    p['head'] = (-16.0 + 2.0 * rec, 0.0, 0.0)
    p['legR'] = ((0.300, -1.020, 0.065), 70.0, 14.0)
    p['legL'] = ((-0.300, -1.020, 0.065), 70.0, -14.0)
    p['armR'] = ('ik', (0.198, 0.470, 0.250 - 0.010 * rec), (0.80, -0.30, -0.52))
    p['armL'] = ('ik', (0.120, 0.640, 0.200), (-0.55, -0.30, -0.78))
    p['muzzle'] = (0.02, 0.998, -0.02 + 0.055 * rec)
    return p


def p_hit(t):
    """中彈倒地（不循環）。"""
    p = R.defaults()
    nc = False
    p['hips'] = (0.0,
                 curve(t, [(0.0, 0.0), (0.12, -0.03), (0.45, -0.12),
                           (0.70, -0.20), (1.0, -0.24)], nc),
                 curve(t, [(0.0, 0.893), (0.10, 0.905), (0.30, 0.790),
                           (0.52, 0.460), (0.72, 0.215), (0.88, 0.145),
                           (1.0, 0.132)], nc))
    pit = curve(t, [(0.0, 2.0), (0.10, -14.0), (0.32, -22.0), (0.55, -44.0),
                    (0.75, -72.0), (0.90, -84.0), (1.0, -88.0)], nc)
    p['pelvis'] = (pit, curve(t, [(0.0, 0), (0.3, 6), (1.0, 12)], nc), 0.0)
    p['spine'] = (curve(t, [(0.0, 2), (0.12, -10), (0.5, -6), (1.0, 3)], nc), 0, 0)
    p['chest'] = (curve(t, [(0.0, 1), (0.12, -12), (0.5, -4), (1.0, 6)], nc),
                  curve(t, [(0.0, 0), (0.3, -6), (1.0, -10)], nc), 0)
    p['neck'] = (curve(t, [(0.0, -1), (0.12, -16), (0.6, 4), (1.0, 14)], nc), 0, 0)
    p['head'] = (curve(t, [(0.0, -2), (0.12, -14), (0.6, 6), (1.0, 16)], nc),
                 curve(t, [(0.0, 0), (0.4, 8), (1.0, 12)], nc), 0)
    ay = curve(t, [(0.0, 0.01), (0.3, 0.03), (0.6, 0.20), (1.0, 0.44)], nc)
    az = curve(t, [(0.0, 0.090), (0.55, 0.090), (0.75, 0.130), (1.0, 0.092)], nc)
    toe = curve(t, [(0.0, 0), (0.5, -6), (1.0, 24)], nc)
    p['legR'] = ((0.108, ay, az), toe, 8.0)
    p['legL'] = ((-0.112, ay - 0.06, az * 0.92), toe, -10.0)
    dn = curve(t, [(0.0, 80), (0.14, 44), (0.45, 52), (1.0, 64)], nc)
    fw = curve(t, [(0.0, 10), (0.14, -34), (0.5, -18), (1.0, -6)], nc)
    p['armR'] = ('ang', dn, fw, curve(t, [(0.0, 50), (0.14, 16), (1.0, 40)], nc))
    p['armL'] = ('ang', dn - 4, fw + 6, curve(t, [(0.0, 46), (0.14, 14), (1.0, 36)], nc))
    p['muzzle'] = (0.35, 0.70, curve(t, [(0.0, 0.1), (0.2, 0.6), (1.0, 0.35)], nc))
    return p


CLIPS = [
    ('idle',        60, p_idle,   3, None),
    ('walk',        30, p_walk,   2, 1.4),
    ('run',         18, p_run,    2, 3.5),
    ('crouch_walk', 33, p_crouch, 2, 1.0),
    ('kneel_fire',  48, p_kneel,  2, None),
    ('prone_fire',  60, p_prone,  3, None),
    ('hit_fall',    36, p_hit,    2, None),
]


# ============================================================ 組裝

def set_action(arm, act):
    ad = arm.animation_data
    ad.action = act
    try:
        if ad.action_slot is None and len(act.slots):
            ad.action_slot = act.slots[0]
    except AttributeError:
        pass


def build(variant, out_dir, prev_dir):
    C.reset()
    sc = bpy.context.scene
    sc.render.fps = FPS

    b = R.RigB()
    R.build_tpose(b, variant)
    ob = b.finish('soldier_rig_' + variant, uv_scale=0.5)
    tris = C.tris(ob)

    arm = R.build_armature('rig')
    R.cache_rest(arm)
    R.skin(ob, b.tags)
    ob.parent = arm
    md = ob.modifiers.new('Armature', 'ARMATURE')
    md.object = arm

    acts = []
    for (name, frames, fn, step, spd) in CLIPS:
        acts.append(R.bake_action(arm, name, frames, fn, step=step))

    name = 'soldier_rig_' + variant
    path = os.path.join(out_dir, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=False, export_yup=True,
        export_cameras=False, export_lights=False, export_extras=True,
        export_skins=True, export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_bake_animation=False,
        export_draco_mesh_compression_enable=False,
        export_rest_position_armature=True,
    )

    extras = {n: {'speed': s} for (n, _f, _fn, _st, s) in CLIPS if s}
    names = R.patch_glb(path, extras)
    kb = os.path.getsize(path) / 1024.0
    print('[GLB] %-26s %7.1f KB  %5d tris  anims=%s' % (name + '.glb', kb, tris, names))

    # ---- 預覽：七個 clip 各取中段一格並排 ----
    tmp = os.path.join(prev_dir, '_tmp')
    os.makedirs(tmp, exist_ok=True)
    shots = []
    for i, (cn, frames, fn, step, spd) in enumerate(CLIPS):
        set_action(arm, acts[i])
        sc.frame_start, sc.frame_end = 0, frames
        shots.append(R.shot(os.path.join(tmp, '%s_%s.png' % (variant, cn)),
                            frames // 2))
    out_png = os.path.join(prev_dir, name + '.png')
    R.hstack(shots, out_png)
    print('[PNG] %s' % out_png)
    return dict(name=name, tris=tris, kb=kb, anims=names)


def main():
    out = C.out_dir()
    prev = C.prev_dir()
    rows = []
    only = C.arg('--only')
    for v in ('us', 'de', 'de_coat'):
        if only and v != only:
            continue
        rows.append(build(v, out, prev))
    print('\n=== soldier_rig ===')
    for r in rows:
        print('%-22s %5d tris  %7.1f KB' % (r['name'], r['tris'], r['kb']))


if __name__ == '__main__':
    main()
