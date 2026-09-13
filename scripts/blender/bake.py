"""Cycles 程序化舊化烘焙 — 把既有純色平塗模型烘成有服役痕跡的貼圖版 glb。

規格：docs/realism-spec.md §R2.1–3。

    "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" -b \
        -P scripts/blender/bake.py -- --out public/models --only yamato,sherman

流程（每個模型）
  1. import 對應模型腳本的 build 函式建模（不重寫模型）
  2. 可轉子物件（turret_* / barrels_* / turret / barrel / hatch）保留獨立節點，
     其餘合併成單一物件
  3. 多物件同時 Smart UV Project（66°、島邊距 0.02）攤進同一張 UV 圖
  4. 每個原材質換成程序化舊化材質（保留原 base color）
  5. Cycles CPU 烘 DIFFUSE(color) / ROUGHNESS / NORMAL / AO 四張 1024²
  6. AO/R/M 打包成一張 ORM（R=AO、G=roughness、B=metallic 常數），
     材質的 metallicRoughness 與 occlusion 指向同一張，等同規格要的四個通道，
     但少一張圖、省下約 40 KB
  7. npx gltf-transform optimize --texture-size 512 --texture-compress webp + Draco
     （--flatten/--join/--instance/--simplify/--palette 全關，否則砲塔節點會被合掉）
  8. 渲 3/4 視角預覽 PNG，並用 @gltf-transform/core 驗證輸出

輸出：public/models/<id>_baked.glb、assets-src/previews/<id>_baked.png

與規格的兩處刻意偏離（實測後才定的）
  - UV 島邊距用 0.008 而非 0.02：0.02 在這些模型的島數下會吃掉一半以上的
    圖面，實效解析度直接砍半；0.008（1024² 約 8 px）配 bake margin 6 px
    不會滲色。
  - 只有 AO 這一張是光傳輸，用滿 samples；DIFFUSE／ROUGHNESS／NORMAL 是純程序化，
    噪訊只來自 AO／Bevel 節點取樣，用 0.40／0.20／0.14 倍即可，省一半時間。
"""

import importlib
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import _common as C  # noqa: E402
import _bake_common as K  # noqa: E402

ROOT = C.project_root()

# 可轉動零件：必須保留為獨立節點（節點名與樞軸不能變）
ROTATABLE = ("turret", "barrels", "barrel", "hatch", "sails", "prop")

PREVIEW = dict(
    ship=dict(azimuth=52.0, elevation=16.0, water=True, margin=1.05),
    vehicle=dict(azimuth=40.0, elevation=18.0, margin=1.06),
    building=dict(azimuth=34.0, elevation=16.0, margin=1.06),
)

BUDGET = dict(ship=600, vehicle=400, building=350)   # KB


# --------------------------------------------------------------------------
# 模型清單（順序＝規格 §R2.2 的優先順序）
# --------------------------------------------------------------------------


def _mod(name):
    return importlib.import_module(name)


def _naval(module, *a, **kw):
    def f():
        return _mod(module).build(*a, export=False, **kw)
    return f


def _plain(module):
    def f():
        return _mod(module).build()
    return f


def _building(fn_name):
    def f():
        import _land_common as L
        L.reset()
        return getattr(_mod("buildings"), fn_name)(False)
    return f


MODELS = [
    ("yamato",           _plain("yamato"),                      "ship"),
    ("sherman",          _plain("sherman"),                     "vehicle"),
    ("stug",             _plain("stug"),                        "vehicle"),
    ("carrier_ijn_L",    _naval("carrier_ijn", -1, None),       "ship"),
    ("carrier_ijn_R",    _naval("carrier_ijn", 1, None),        "ship"),
    ("carrier_usn",      _naval("carrier_usn", None),           "ship"),
    ("cruiser_ijn",      _naval("cruiser", "ijn", None),        "ship"),
    ("cruiser_usn",      _naval("cruiser", "usn", None),        "ship"),
    ("destroyer_ijn",    _naval("destroyer", "ijn", None),      "ship"),
    ("destroyer_usn",    _naval("destroyer", "usn", None),      "ship"),
    ("howitzer_105",     _plain("howitzer_105"),                "vehicle"),
    ("house_normandy_s", _building("house_normandy_s"),         "building"),
    ("house_normandy_l", _building("house_normandy_l"),         "building"),
    ("church",           _building("church"),                   "building"),
    ("house_ardennes",   _building("house_ardennes"),           "building"),
    ("barn",             _building("barn"),                     "building"),
    ("farmhouse_dutch",  _building("farmhouse_dutch"),          "building"),
]


# --------------------------------------------------------------------------
# gltf-transform（壓縮＋驗證）
# --------------------------------------------------------------------------

VERIFY_JS = r"""
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

const out = [];
for (const p of process.argv.slice(2)) {
  const doc = await io.read(p);
  const root = doc.getRoot();
  let tris = 0, prims = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      prims++;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
      tris += n / 3;
    }
  const mat = root.listMaterials()[0];
  const slots = mat ? {
    baseColor: !!mat.getBaseColorTexture(),
    metallicRoughness: !!mat.getMetallicRoughnessTexture(),
    normal: !!mat.getNormalTexture(),
    occlusion: !!mat.getOcclusionTexture(),
    metallic: mat.getMetallicFactor(),
    roughness: mat.getRoughnessFactor(),
  } : null;
  out.push({
    path: p,
    kb: +(fs.statSync(p).size / 1024).toFixed(1),
    materials: root.listMaterials().length,
    prims, tris,
    textures: root.listTextures().map((t) => ({
      name: t.getName(),
      mime: t.getMimeType(),
      size: t.getSize(),
      kb: +(t.getImage().byteLength / 1024).toFixed(1),
    })),
    slots,
    nodes: root.listNodes().map((n) => n.getName()),
  });
}
console.log(JSON.stringify(out, null, 1));
"""


def _helper_dir():
    d = os.path.join(ROOT, "node_modules", ".cache", "battle-bake")
    os.makedirs(d, exist_ok=True)
    return d


def _npx(args):
    cmd = "npx --no-install gltf-transform " + " ".join(args)
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        raise RuntimeError("gltf-transform 失敗")
    return r.stdout


def compress(src, dst, texture_size=512):
    _npx([
        "optimize", '"%s"' % src, '"%s"' % dst,
        "--texture-size", str(texture_size),
        "--texture-compress", "webp",
        "--compress", "draco",
        "--flatten", "false",          # 保留可轉子節點
        "--join", "false",
        "--instance", "false",
        "--simplify", "false",
        "--palette", "false",
    ])
    return dst


def verify(paths):
    js = os.path.join(_helper_dir(), "verify.mjs")
    with open(js, "w", encoding="utf-8", newline="\n") as f:
        f.write(VERIFY_JS)
    cmd = ["node", js] + list(paths)
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-3000:])
        return []
    try:
        return json.loads(r.stdout)
    except ValueError:
        print(r.stdout[-2000:])
        return []


# --------------------------------------------------------------------------
# 單一模型
# --------------------------------------------------------------------------


def _is_rotatable(name):
    n = name.lower()
    return any(n == p or n.startswith(p + "_") or n.startswith(p + ".")
               for p in ROTATABLE)


def collect(objs, mid):
    """回傳 (全部 mesh 物件, 靜態主體)。可轉子物件保留獨立。"""
    meshes = [o for o in C.all_children(objs) if o.type == "MESH"]
    keep = [o for o in meshes if _is_rotatable(o.name)]
    rest = [o for o in meshes if o not in keep]
    if len(rest) > 1 and not any(o.children for o in rest):
        body = C.join(rest, rest[0].name)
        rest = [body]
    if len(rest) == 1 and rest[0].name in ("x", "Mesh", ""):
        rest[0].name = rest[0].data.name = mid
    return rest + keep


def bake_one(mid, builder, kind, args):
    t0 = time.time()
    print("\n=== %s (%s) ===" % (mid, kind), flush=True)
    cfg = dict(K.KIND[kind])

    objs = collect(builder(), mid)
    tris = C.tri_count(objs)
    print("  物件 %d 個、%d 三角形：%s"
          % (len(objs), tris, ", ".join(o.name for o in objs)), flush=True)

    K.prepare_uvs(objs)
    nmat = K.weather_all(objs, cfg)
    K.smart_uv(objs, angle_deg=args.uv_angle, margin=args.uv_margin)
    print("  舊化材質 %d 個、UV 攤平完成（%.0fs）" % (nmat, time.time() - t0),
          flush=True)

    # 程序化通道沒有光傳輸，噪訊只來自 AO／Bevel 節點取樣，不必跟 AO pass 同級
    # 程序化通道沒有光傳輸，噪訊只來自 AO／Bevel 節點取樣；AO pass 才是光傳輸
    smp = (max(8, int(args.samples * 0.40)), max(6, int(args.samples * 0.20)),
           max(6, int(args.samples * 0.14)), max(16, int(args.samples * 0.50)))
    imgs = K.bake_maps(objs, size=args.size, samples=smp,
                       ao_dist=cfg["ao_dist"])
    orm = K.pack_orm(imgs, cfg["metallic"], args.size)
    tex_dir = os.path.join(args.tmp, mid)
    K.save_images([(mid + "_basecolor", imgs["diffuse"]),
                   (mid + "_orm", orm),
                   (mid + "_normal", imgs["normal"])], tex_dir)
    print("  烘焙完成（%.0fs）" % (time.time() - t0), flush=True)

    mat = K.final_material(mid + "_baked", imgs["diffuse"], orm, imgs["normal"])
    K.assign_single(objs, mat)
    K.drop_src_uv(objs)

    raw = os.path.join(args.tmp, mid + "_raw.glb")
    C.export_glb(objs, raw, draco=False)
    dst = os.path.join(C.abspath(args.out), mid + "_baked.glb")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    compress(raw, dst, texture_size=args.texture_size)

    if not args.no_preview:
        pk = dict(PREVIEW[kind])
        C.render_preview(os.path.join(C.abspath(args.preview),
                                      mid + "_baked.png"), objs, **pk)

    secs = time.time() - t0
    kb = os.path.getsize(dst) / 1024.0
    flag = "  !! 超過 %d KB 預算" % BUDGET[kind] if kb > BUDGET[kind] else ""
    print("  -> %s  %.1f KB  %d tris  %.0f s%s" % (dst, kb, tris, secs, flag),
          flush=True)
    return dict(id=mid, kind=kind, tris=tris, kb=kb, secs=secs, path=dst)


# --------------------------------------------------------------------------


def parse():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="public/models")
    p.add_argument("--preview", default="assets-src/previews")
    p.add_argument("--only", default=None, help="逗號分隔的模型 id")
    p.add_argument("--skip", default=None)
    p.add_argument("--size", type=int, default=1024, help="烘焙解析度")
    p.add_argument("--texture-size", type=int, default=512, help="輸出貼圖邊長")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--uv-angle", type=float, default=66.0)
    p.add_argument("--uv-margin", type=float, default=0.008)
    p.add_argument("--no-preview", action="store_true")
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--tmp", default=os.path.join(tempfile.gettempdir(),
                                                 "battle_bake"))
    a = p.parse_args(argv)
    os.makedirs(a.tmp, exist_ok=True)
    return a


def main():
    args = parse()
    todo = MODELS
    if args.only:
        want = [s.strip() for s in args.only.split(",") if s.strip()]
        todo = [m for m in MODELS if m[0] in want]
        missing = [w for w in want if w not in [m[0] for m in MODELS]]
        if missing:
            print("!! 未知模型：", missing)
    if args.skip:
        drop = {s.strip() for s in args.skip.split(",")}
        todo = [m for m in todo if m[0] not in drop]

    out_dir = C.abspath(args.out)
    if args.verify_only:
        paths = [os.path.join(out_dir, m[0] + "_baked.glb") for m in todo]
        paths = [p for p in paths if os.path.exists(p)]
        report(verify(paths))
        return

    stats = []
    for (mid, builder, kind) in todo:
        try:
            stats.append(bake_one(mid, builder, kind, args))
        except Exception as e:                                # noqa: BLE001
            import traceback
            traceback.print_exc()
            print("!! %s 失敗：%s" % (mid, e), flush=True)

    print("\n=== 烘焙總結 ===")
    for s in stats:
        print("%-18s %7.1f KB  %6d tris  %5.0f s  (預算 %d KB)"
              % (s["id"], s["kb"], s["tris"], s["secs"], BUDGET[s["kind"]]))
    ok = [s["path"] for s in stats if os.path.exists(s["path"])]
    if ok:
        report(verify(ok))


def report(rows):
    print("\n=== glTF 驗證（@gltf-transform/core）===")
    for r in rows:
        tex = ", ".join("%s %s %dx%d %.1fKB"
                        % (t.get("name") or "?", t["mime"].split("/")[-1],
                           t["size"][0], t["size"][1], t["kb"])
                        for t in r["textures"])
        print("%-28s %7.1f KB  材質 %d  primitive %d  三角形 %d"
              % (os.path.basename(r["path"]), r["kb"], r["materials"],
                 r["prims"], r["tris"]))
        print("    貼圖: %s" % (tex or "（無）"))
        if r["slots"]:
            s = r["slots"]
            print("    slot: baseColor=%s MR=%s normal=%s occlusion=%s "
                  "metallic=%.2f roughness=%.2f"
                  % (s["baseColor"], s["metallicRoughness"], s["normal"],
                     s["occlusion"], s["metallic"], s["roughness"]))
        print("    節點: %s" % ", ".join(r["nodes"]))


if __name__ == "__main__":
    main()
