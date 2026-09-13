// 巴斯通 · 真實資產載入器(docs/asset-pipeline-spec.md §0／§3)
//
// 職責:讀 `public/assets-manifest.json`(程式不寫死 Poly Haven 路徑)、建立 GLTFLoader＋DRACOLoader、
//   TextureLoader、HDRLoader,依桌機／手機選 1k 或 512 的檔案,並且**一律非阻塞**:
//   main.js 先用既有的程序化場景開場,資產到了再由各模組的 applyAssets() 換上去。
//
// 鐵則(§0):
//   1. 只認 manifest 的 id 與 files.{desktop|mobile}.<map>.path;Poly Haven 資產全部登記在那裡。
//   2. Blender 自製模型(sherman、mg_nest、house_ardennes…)不在 Poly Haven manifest 裡,
//      另備 LOCAL_MODELS 一份本地登記表,仍然集中一處,不散落到各場景檔。
//   3. 模型可能還在建模中 → model() 找不到檔案時回 null(不拋例外),呼叫端保留程序化 fallback。
//   4. 手機與桌機走不同的貼圖尺寸與 HDRI 形式(桌機 PMREM .hdr、手機 tonemapped JPG)。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';   // three 0.184 起 RGBELoader 已棄用

const MANIFEST_URL = '/assets-manifest.json';

// Blender 腳本建模產出(§2)。manifest 只收 Poly Haven,故自製模型在此登記。
// 值為路徑;載入失敗(還沒建模完成)即視為 null,呼叫端退回程序化。
const LOCAL_MODELS = {
  sherman: '/models/sherman.glb',
  stug: '/models/stug.glb',
  mg_nest: '/models/mg_nest.glb',
  howitzer_105: '/models/howitzer_105.glb',
  house_ardennes: '/models/house_ardennes.glb',
  house_ardennes_damaged: '/models/house_ardennes_damaged.glb',
  barn: '/models/barn.glb',
  church: '/models/church.glb',
  foxhole: '/models/foxhole.glb',
  sandbag_wall: '/models/sandbag_wall.glb',
  ammo_crate: '/models/ammo_crate.glb',
  hedgehog: '/models/hedgehog.glb',
  // 士兵(§2.2):每個姿態一個 glb,可能尚未產出 → 全部走「有就用、沒有就程序化」。
  soldier_us_stand_rifle: '/models/soldier_us_stand_rifle.glb',
  soldier_us_advance_rifle: '/models/soldier_us_advance_rifle.glb',
  soldier_us_kneel_fire: '/models/soldier_us_kneel_fire.glb',
  soldier_us_prone_mg: '/models/soldier_us_prone_mg.glb',
  soldier_us_crouch_run: '/models/soldier_us_crouch_run.glb',
  soldier_de_coat_stand_rifle: '/models/soldier_de_coat_stand_rifle.glb',
  soldier_de_coat_advance_rifle: '/models/soldier_de_coat_advance_rifle.glb',
  soldier_de_coat_kneel_fire: '/models/soldier_de_coat_kneel_fire.glb',
  soldier_de_coat_prone_mg: '/models/soldier_de_coat_prone_mg.glb',
  soldier_de_coat_crouch_run: '/models/soldier_de_coat_crouch_run.glb',
  // 武器:掛在單兵的 hand_r 節點上(合併進同一份幾何,不多一個 draw call)
  garand: '/models/garand.glb',
  thompson: '/models/thompson.glb',
  bar: '/models/bar.glb',
  kar98k: '/models/kar98k.glb',
  mp40: '/models/mp40.glb',
  mg42: '/models/mg42.glb',
};

// 本場用到的 HDRI:日相 → manifest id。桌機吃 .hdr(PMREM),手機吃 tonemapped JPG。
export const ENV_BY_PHASE = {
  night: 'moonless_golf',
  overcast: 'cannon',
  clear: 'kloofendal_48d_partly_cloudy_puresky',
};

// onMaterial:R4-2 的 CSM 材質註冊掛勾(main.js 傳 environment.registerMaterial 進來)。
//   glb 一載進來就先收編一次,之後被 clone／換材質的,由呼叫端自己
//   `environment.registerObject(group)`(environment.js 檔頭有說明)。
export function createAssets({ mobile = false, renderer = null, onMaterial = null } = {}) {
  const tier = mobile ? 'mobile' : 'desktop';
  const anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;

  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');              // §1:解碼器已複製到 public/draco/
  gltfLoader.setDRACOLoader(draco);
  const hdrLoader = new HDRLoader();

  let pmrem = null;
  let hdrUsed = false;                            // 桌機只抓一張真 .hdr(見 env())
  const texCache = new Map();
  const modelCache = new Map();
  const envCache = new Map();
  let manifest = null;
  const missing = [];                            // 回報用:缺哪些模型

  const ready = fetch(MANIFEST_URL)
    .then((r) => r.json())
    .then((m) => { manifest = m; return api; })
    .catch((e) => { console.warn('[assets] manifest 載入失敗,全場保留程序化', e); return api; });

  function entry(id) {
    return manifest?.assets?.[id] ?? null;
  }

  // 依 tier 取檔案路徑;手機沒有該 map 時退回桌機版(例如 HDRI 只有 tonemapped)
  function filePath(id, map) {
    const a = entry(id);
    if (!a) return null;
    const f = a.files?.[tier]?.[map] ?? a.files?.desktop?.[map];
    return f?.path ?? null;
  }

  // 單張貼圖(立即回傳 Texture,內容稍後填入 → 不阻塞首屏)
  // size:強制取某一階的檔案。法線圖 1k 一張 333 KB、512 只要 159 KB,而地表 repeat 已經到 120,
  //   512 的法線在畫面上分不出來 —— 省下來的預算拿去換高規的樹。
  function texture(id, map, { repeat = 1, repeatY = null, srgb = null, size = null } = {}) {
    const path = size ? (entry(id)?.files?.[size]?.[map]?.path ?? filePath(id, map)) : filePath(id, map);
    if (!path) return null;
    const key = `${path}|${repeat}|${repeatY ?? repeat}`;
    if (texCache.has(key)) return texCache.get(key);
    const t = texLoader.load(path);
    const isColor = srgb ?? (map === 'diff');
    t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeatY ?? repeat);
    t.anisotropy = anisotropy;
    texCache.set(key, t);
    return t;
  }

  // 一組 PBR 貼圖 → 直接可展開進 MeshStandardMaterial
  // arm = AO(r)／Roughness(g)／Metalness(b),與 three 的取樣通道正好對應。
  function pbr(id, { repeat = 1, repeatY = null, maps = ['diff', 'nor', 'arm'], norSize = null } = {}) {
    const out = {};
    if (maps.includes('diff')) { const m = texture(id, 'diff', { repeat, repeatY }); if (m) out.map = m; }
    if (maps.includes('nor')) { const n = texture(id, 'nor', { repeat, repeatY, size: norSize }); if (n) out.normalMap = n; }
    if (maps.includes('arm')) {
      const a = texture(id, 'arm', { repeat, repeatY });
      if (a) { out.roughnessMap = a; out.metalnessMap = a; out.aoMap = a; }
    }
    return out;
  }

  // 模型:回傳 Promise<GLTF|null>。找不到／載入失敗一律 null(呼叫端保留程序化)。
  // R4-2:把一棵 glb 子樹內的材質交給 onMaterial(通常是 environment.registerMaterial)
  function registerMaterials(root) {
    if (!onMaterial || !root) return;
    root.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) onMaterial(x);
      else onMaterial(m);
    });
  }

  // hi:桌機高規版(manifest 的 files.desktop.glb_hi,512² 貼圖、面數放寬);手機或沒有高規版時
  //    自動退回一般版,呼叫端不必分支。
  function model(id, { hi = false } = {}) {
    const key = hi && !mobile ? `${id}@hi` : id;
    if (modelCache.has(key)) return modelCache.get(key);
    const path = (hi && !mobile ? filePath(id, 'glb_hi') : null)
      ?? filePath(id, 'glb') ?? LOCAL_MODELS[id] ?? null;
    if (!path) {
      missing.push(id);
      const p = Promise.resolve(null);
      modelCache.set(key, p);
      return p;
    }
    const p = new Promise((resolve) => {
      gltfLoader.load(path, (gltf) => { registerMaterials(gltf?.scene); resolve(gltf); }, undefined, () => {
        missing.push(id);
        console.info(`[assets] 模型尚未產出,保留程序化:${id}`);
        resolve(null);
      });
    });
    modelCache.set(key, p);
    return p;
  }

  // 環境貼圖(§3 HDRI):桌機 1k .hdr → PMREM;手機 tonemapped JPG → 等距投影。
  // 依日相分別載入,不是開場一次抓三張(首屏預算 6 MB／2.5 MB)。
  function env(phase) {
    const id = ENV_BY_PHASE[phase];
    if (!id) return Promise.resolve(null);
    if (envCache.has(id)) return envCache.get(id);
    let p;
    if (mobile || !renderer) {
      const path = filePath(id, 'tonemapped');
      p = path
        ? new Promise((resolve) => texLoader.load(path, (t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          t.colorSpace = THREE.SRGBColorSpace;
          resolve(t);
        }, undefined, () => resolve(null)))
        : Promise.resolve(null);
    } else {
      // 桌機只讓「開場那一相」吃真正的 1k .hdr(1.6 MB);後面切過去的日相改用 tonemapped JPG
      // 走同一條 PMREM(約 80–200 KB)。env 強度只有 0.16–0.42,純粹當補光與反射,肉眼分不出來,
      // 但三張 .hdr 全抓會讓整場下載量多出 3 MB —— 那是首屏預算的一半。
      const path = hdrUsed ? null : filePath(id, 'hdr');
      if (path) hdrUsed = true;
      p = path
        ? new Promise((resolve) => hdrLoader.load(path, (hdr) => {
          if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
          const rt = pmrem.fromEquirectangular(hdr);
          hdr.dispose();
          resolve(rt.texture);
        }, undefined, () => resolve(null)))
        : new Promise((resolve) => {
          const tm = filePath(id, 'tonemapped');
          if (!tm) return resolve(null);
          texLoader.load(tm, (t) => {
            t.mapping = THREE.EquirectangularReflectionMapping;
            t.colorSpace = THREE.SRGBColorSpace;
            if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
            const rt = pmrem.fromEquirectangular(t);
            t.dispose();
            resolve(rt.texture);
          }, undefined, () => resolve(null));
        });
    }
    envCache.set(id, p);
    return p;
  }

  const api = {
    tier, mobile, anisotropy, ready,
    get manifest() { return manifest; },
    entry, filePath, texture, pbr, model, env,
    missingModels: () => [...new Set(missing)],
    dispose() { if (pmrem) pmrem.dispose(); draco.dispose(); },
  };
  return api;
}

// ── glTF → 場景可用幾何的共用工具 ───────────────────────────
// Blender 產出的模型材質多半是「無貼圖、只有 baseColorFactor 的色塊」。把顏色烘進頂點色,
// 就能把一棟房子／一輛戰車併成極少數網格(甚至 1 個),draw call 大降而外觀不變。

const _c = new THREE.Color();

// mergeGeometries 要求所有幾何的屬性完全一致(缺一個就整批失敗,而且只印一行錯)。
// glb 裡常有「沒有 uv 的那一塊」或「沒有 normal 的那一塊」,所以統一補齊、刪掉其餘屬性。
export function normalizeAttributes(geo) {
  for (const k of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  }
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) {
    const c = new Float32Array(n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (geo.morphAttributes) geo.morphAttributes = {};
  if (geo.groups?.length) geo.clearGroups();
  return geo;
}

// 把一個 Object3D 子樹的幾何依「材質分組函式」收集起來(套用世界矩陣、烘頂點色)
// groupOf(materialName) 回傳組名;回傳 null 表示丟棄該 primitive。
export function collectByGroup(root, groupOf) {
  root.updateWorldMatrix(true, true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const name = mats[0]?.name ?? '';
    const key = groupOf(name, o);
    if (key == null) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    // 烘頂點色:材質的 baseColor(three 已轉成 linear-sRGB 的 material.color)
    const col = mats[0]?.color ? _c.copy(mats[0].color) : _c.setRGB(1, 1, 1);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    normalizeAttributes(geo);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(geo);
  });
  return groups;
}

// 幾何的 XZ 中心與高度(用來把 glb 對齊到現有程序化模型的 bounding box)
export function geoMetrics(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return {
    height: b.max.y - b.min.y,
    width: Math.max(b.max.x - b.min.x, b.max.z - b.min.z),
    length: b.max.z - b.min.z,
    minY: b.min.y,
    cx: (b.max.x + b.min.x) / 2,
    cz: (b.max.z + b.min.z) / 2,
  };
}
