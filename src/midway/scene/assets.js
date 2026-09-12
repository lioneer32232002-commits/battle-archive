// 資產載入器(docs/asset-pipeline-spec.md §0、§3)
//
// 原則:
//   1. 只認 `public/assets-manifest.json` 的路徑,程式不寫死貼圖／HDRI 檔名。
//      例外:Blender 產出的艦艇／飛機 glb 目前尚未登記進 manifest(manifest 的 model
//      區只有 Poly Haven 模型),故本檔保留一張 BLENDER_MODELS 對照表;等 manifest
//      補登後把這張表刪掉即可,呼叫端的 API 不用改。
//   2. 一切非阻塞:場景先用程序化 fallback 開場,資產到了再換。任何載入失敗都
//      resolve 成 null(不 reject),呼叫端就地退回程序化版本。
//   3. 桌機／手機走不同解析度;首屏預算(桌機 ≤ 6 MB、手機 ≤ 2.5 MB)靠
//      TEX_QUALITY 與「HDRI 只載目前日相那一張」控制。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'; // three 0.184:RGBELoader 已更名

const MANIFEST_URL = '/assets-manifest.json';

// Blender 建模產出(公尺、Y 上、-Z 艦艏、原點水線中心);manifest 尚未登記
const BLENDER_MODELS = {
  carrier_ijn_L: '/models/carrier_ijn_L.glb',
  carrier_ijn_R: '/models/carrier_ijn_R.glb',
  carrier_usn: '/models/carrier_usn.glb',
  destroyer_ijn: '/models/destroyer_ijn.glb',
  destroyer_usn: '/models/destroyer_usn.glb',
  cruiser_ijn: '/models/cruiser_ijn.glb',
  cruiser_usn: '/models/cruiser_usn.glb',
  sbd: '/models/sbd.glb',
  tbd: '/models/tbd.glb',
  f4f: '/models/f4f.glb',
  a6m: '/models/a6m.glb',
  d3a: '/models/d3a.glb',
  b5n: '/models/b5n.glb',
};

// 日相 → HDRI id(manifest 的 phase 欄位可對照;寫在這裡是為了選「哪一張」)
export const PHASE_HDRI = {
  dawn: 'kiara_1_dawn',
  day: 'kloofendal_48d_partly_cloudy_puresky',
  dusk: 'belfast_sunset_puresky',
  night: 'moonless_golf',
};

// 首屏預算(§0 鐵則 2:桌機 ≤ 6 MB):中途島這場同時要扛 1.44 MB 的 1k HDRI ＋ 19 艘 glb,
// 貼圖全部改用 512 版 — 這裡的貼圖都是「平鋪 6–120 次的細節層」,512 與 1024 在畫面上
// 分不出來,但每張差 100–270 KB。要放寬時把 desktop 的值改回 'desktop' 即可。
const TEX_QUALITY = {
  desktop: { diff: 'mobile', nor: 'mobile', arm: 'mobile' },
  mobile: { diff: 'mobile', nor: 'mobile', arm: 'mobile' },
};

let warned = new Set();
function warnOnce(key, ...msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[midway/assets]', ...msg);
}

export function createAssets({ renderer, mobile = false } = {}) {
  const profile = mobile ? 'mobile' : 'desktop';
  const quality = TEX_QUALITY[profile];

  const manifestP = fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .catch((e) => {
      warnOnce('manifest', 'manifest 載入失敗,全部退回程序化:', e.message);
      return null;
    });

  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new HDRLoader();
  let gltfLoader = null;
  let pmrem = null;

  const texCache = new Map();   // `${id}|${map}|${rx}x${ry}` -> Promise<Texture|null>
  const modelCache = new Map(); // id -> Promise<Object3D|null>
  const envCache = new Map();   // phase -> Promise<Texture|null>

  function getGltfLoader(manifest) {
    if (gltfLoader) return gltfLoader;
    gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(manifest?.draco?.decoderPath ?? '/draco/');
    // 不指定 type:讓 DRACOLoader 挑 wasm(192 KB + 58 KB wrapper),比 js 解碼器(512 KB)省一半
    gltfLoader.setDRACOLoader(draco);
    return gltfLoader;
  }

  // ── 貼圖 ───────────────────────────────────────────
  // repeat 一併吃進快取鍵:同一張圖不同平鋪倍率各自一份(three 的 uv transform 是 per-texture)
  function texture(id, map, { repeat = [1, 1], aniso = mobile ? 4 : 8 } = {}) {
    const key = `${id}|${map}|${repeat[0]}x${repeat[1]}`;
    if (texCache.has(key)) return texCache.get(key);
    const p = manifestP.then((manifest) => {
      const entry = manifest?.assets?.[id];
      const file = entry?.files?.[quality[map] ?? profile]?.[map] ?? entry?.files?.[profile]?.[map];
      if (!file) {
        warnOnce('tex:' + id + map, `manifest 查無貼圖 ${id}.${map}`);
        return null;
      }
      return new Promise((resolve) => {
        texLoader.load(
          file.path,
          (t) => {
            t.colorSpace = file.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeat[0], repeat[1]);
            t.anisotropy = aniso;
            resolve(t);
          },
          undefined,
          () => {
            warnOnce('tex:' + file.path, '貼圖載入失敗', file.path);
            resolve(null);
          }
        );
      });
    });
    texCache.set(key, p);
    return p;
  }

  // 回傳 { map, normalMap, roughnessMap, metalnessMap }(ARM:G=roughness、B=metalness)
  function textureSet(id, { maps = ['diff', 'nor', 'arm'], repeat = [1, 1] } = {}) {
    return Promise.all(maps.map((m) => texture(id, m, { repeat }))).then((list) => {
      const out = {};
      maps.forEach((m, i) => {
        const t = list[i];
        if (!t) return;
        if (m === 'diff') out.map = t;
        else if (m === 'nor') out.normalMap = t;
        else if (m === 'arm') { out.roughnessMap = t; out.metalnessMap = t; }
      });
      return out;
    });
  }

  // ── 模型 ───────────────────────────────────────────
  function model(id) {
    if (modelCache.has(id)) return modelCache.get(id);
    const p = manifestP.then((manifest) => {
      const entry = manifest?.assets?.[id];
      const path = entry?.files?.[profile]?.glb?.path ?? BLENDER_MODELS[id] ?? null;
      if (!path) {
        warnOnce('model:' + id, `查無模型 ${id}`);
        return null;
      }
      return new Promise((resolve) => {
        getGltfLoader(manifest).load(
          path,
          (gltf) => {
            gltf.scene.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = true;
              o.receiveShadow = true;
            });
            resolve(gltf.scene);
          },
          undefined,
          (e) => {
            warnOnce('model:' + path, '模型載入失敗', path, e?.message ?? e);
            resolve(null);
          }
        );
      });
    });
    modelCache.set(id, p);
    return p;
  }

  // ── HDRI 環境光 ────────────────────────────────────
  // 桌機:1k .hdr → PMREM;手機:tonemapped JPG(EquirectangularReflectionMapping)
  function env(phase) {
    if (envCache.has(phase)) return envCache.get(phase);
    const p = manifestP.then((manifest) => {
      const id = PHASE_HDRI[phase];
      const entry = manifest?.assets?.[id];
      if (!entry) {
        warnOnce('env:' + phase, `manifest 查無 HDRI ${id}`);
        return null;
      }
      const files = entry.files[profile] ?? {};
      if (!mobile && files.hdr && renderer) {
        return new Promise((resolve) => {
          hdrLoader.load(
            files.hdr.path,
            (hdr) => {
              if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
              const rt = pmrem.fromEquirectangular(hdr);
              hdr.dispose();
              resolve(rt.texture);
            },
            undefined,
            () => { warnOnce('env:' + id, 'HDRI 載入失敗', files.hdr.path); resolve(null); }
          );
        });
      }
      const tm = files.tonemapped;
      if (!tm) return null;
      return new Promise((resolve) => {
        texLoader.load(
          tm.path,
          (t) => {
            t.mapping = THREE.EquirectangularReflectionMapping;
            t.colorSpace = THREE.SRGBColorSpace;
            resolve(t);
          },
          undefined,
          () => { warnOnce('env:' + id, 'HDRI(tm)載入失敗', tm.path); resolve(null); }
        );
      });
    });
    envCache.set(phase, p);
    return p;
  }

  return { manifest: () => manifestP, texture, textureSet, model, env, mobile, profile };
}

// ── 共用小工具 ───────────────────────────────────────

// 複製 glb 場景;材質一律複製一份(沉沒淡出／變色是逐艦改材質,不能共用)
export function cloneModel(src, { cloneMaterials = true } = {}) {
  const out = src.clone(true);
  if (cloneMaterials) {
    out.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    });
  }
  return out;
}

// glb 材質統一:roughness 下限 0.35(避免塑膠感)、envMapIntensity、陰影旗標
export function normalizeMaterials(root, { envMapIntensity = 1, roughnessMin = 0.35, shadows = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadows;
    o.receiveShadow = shadows;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.roughness !== undefined) m.roughness = Math.max(roughnessMin, m.roughness);
      if (m.envMapIntensity !== undefined) m.envMapIntensity = envMapIntensity;
    }
  });
}

// 把整棵樹的 mesh 幾何合併成一顆(供 InstancedMesh 用)。
// 每個 primitive 的 baseColor 烘進頂點色 → 單一材質也保留塗裝與識別標誌。
export function bakeToSingleGeometry(root, { skip = () => false } = {}) {
  const chunks = [];
  const mat = new THREE.Matrix4();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || skip(o)) return;
    const geo = o.geometry.clone();
    mat.copy(o.matrixWorld);
    geo.applyMatrix4(mat);
    const col = o.material?.color ?? new THREE.Color(0xffffff);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    // 只留 position/normal/color,確保 merge 時屬性一致
    for (const k of Object.keys(geo.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    chunks.push(geo);
  });
  if (!chunks.length) return null;
  return mergeSimpleGeometries(chunks);
}

// 極簡合併(不依賴 BufferGeometryUtils 的屬性檢查,屬性固定為 position/normal/color)
function mergeSimpleGeometries(geos) {
  let vc = 0;
  let ic = 0;
  for (const g of geos) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// 沿 -Z 對齊縮放:模型是公尺,場景 1 單位 ≈ 2.35 m,以 targetLength(場景單位)對齊
export function fitLength(root, targetLength) {
  const box = new THREE.Box3().setFromObject(root);
  const len = box.max.z - box.min.z;
  if (!(len > 0)) return 1;
  const s = targetLength / len;
  root.scale.setScalar(s);
  return s;
}
