// 卡倫坦資產整合層（docs/asset-pipeline-spec.md §0、§3）
// ─────────────────────────────────────────────────────────────
// 職責：讀 public/assets-manifest.json、載入 Poly Haven 貼圖／HDRI 與 glTF 模型、
//   快取、桌機／手機分流、統計下載量。所有路徑一律走 manifest（§0 鐵則 3），
//   manifest 沒登記的（Blender 腳本產出的自有模型）走 BLENDER_MODELS 註冊表。
//
// 鐵則：
//   1. 首屏不阻塞 —— 本模組只回 Promise，場景先用程序化 fallback 畫出來，
//      資產到了才 swap（terrain.applyAssets／environment.applyAssets／applyUnitModels）。
//   2. 任何一項失敗都只影響那一項：全部 catch，回 null，呼叫端保留程序化版本。
//   3. 不預先 fetch 不確定存在的檔案（404 會髒 console）—— 還沒建好的模型在
//      BLENDER_MODELS 裡標 pending:false，建好後把旗標打開即可，程式其他部分不用改。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// three r184 起 RGBELoader 已更名 HDRLoader（用舊名會噴 deprecation 警告）
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MANIFEST_URL = '/assets-manifest.json';
const DRACO_PATH = '/draco/';

// ── 貼圖解析度分級（§0 鐵則 2 的體積預算）────────────────────────
// 本場首屏預算：桌機 ≤ 6 MB、手機 ≤ 2.5 MB。
// 1k 只給「近看的主角」：市鎮鋪石街與房舍灰泥牆；其餘一律 512（地表是高 repeat 平鋪，
// 512 在 11 單位／格的密度下已看不出差別，省下來的頻寬留給 HDRI 與模型）。
const TIER = {
  desktop: { cobblestone_floor_04: '1k', painted_plaster_wall: '1k' },
  mobile: {},
};
const DEFAULT_TIER = '512';

// 手機不載的（省頻寬，對應層退回程序化或共用其他貼圖）
const DESKTOP_ONLY_TEX = new Set([
  'brown_mud_leaves_01', 'gravelly_sand', 'rustic_stone_wall_02', 'ceramic_roof_01', 'metal_plate',
]);

// ── Blender 自有模型註冊表（不在 Poly Haven manifest 內）──────────
// available：2026-09-12 實際存在於 public/models/ 的檔案。
// pending：blender-land 代理還在建模，檔案到位後把值改成 true 即可自動接上，
//   程式其他部分不需要改（載入失敗也會自己退回程序化）。
export const BLENDER_MODELS = {
  // 載具與工事
  sherman: true, stug: true, mg_nest: true,
  // 建築（含戰損變體）
  house_normandy_s: true, house_normandy_l: true,
  house_normandy_s_damaged: true, house_normandy_l_damaged: true,
  barn: true, barn_damaged: true, church: true, church_damaged: true,
  // 道具
  sandbag_wall: true, hedgehog: true, fence_wood: true, signpost: true, ammo_crate: true,
  // 士兵（2026-09-12 第二批到位）：本場用 soldier_de_*（野戰服），
  //   不用 soldier_de_coat_*（國民擲彈兵長大衣）—— 血腥溝反撲的是第 17 SS 裝甲擲彈兵。
  soldier_us_stand_rifle: true, soldier_us_advance_rifle: true, soldier_us_kneel_fire: true,
  soldier_us_crouch_run: true, soldier_us_prone_mg: true,
  soldier_de_stand_rifle: true, soldier_de_advance_rifle: true, soldier_de_kneel_fire: true,
  soldier_de_crouch_run: true, soldier_de_prone_mg: true,
  // 武器（原點在握把，掛到士兵的 hand_r 底下、local transform 歸零）
  garand: true, thompson: true, bar: true, kar98k: true, mp40: true, mg42: true,
};

export function hasBlenderModel(id) {
  return BLENDER_MODELS[id] === true;
}

// ══════════════════════════════════════════════════════════════
export function createAssetHub({ mobile = false, renderer = null } = {}) {
  const profile = mobile ? 'mobile' : 'desktop';
  const texCache = new Map();     // `${id}:${map}:${tier}` → Texture
  const modelCache = new Map();   // id → Promise<Object3D|null>
  const envCache = new Map();     // id → Promise<Texture|null>
  const requested = new Map();    // path → bytes（下載量統計）
  let manifestPromise = null;
  let gltfLoader = null;
  let pmrem = null;

  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new HDRLoader();

  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(MANIFEST_URL)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
        .catch((e) => { console.warn('[assets] manifest 讀取失敗，全場保留程序化資產', e); return null; });
    }
    return manifestPromise;
  }

  function note(path, bytes) {
    if (path && !requested.has(path)) requested.set(path, bytes || 0);
  }
  // Blender 自有模型沒登記在 manifest（沒有 bytes 欄），用 XHR 的 progress 回報實際大小，
  // 否則 stats() 會少算 ~350 KB，首屏載入量的驗收數字就不準。
  function noteBytes(path, bytes) {
    if (path && bytes) requested.set(path, bytes);
  }

  function tierFor(id) {
    return TIER[profile][id] ?? DEFAULT_TIER;
  }

  function entry(mf, id) {
    return mf?.assets?.[id] ?? null;
  }

  // ── 單張貼圖 ────────────────────────────────────────────────
  // map: 'diff' | 'nor' | 'arm'
  async function texture(id, map) {
    if (mobile && DESKTOP_ONLY_TEX.has(id)) return null;
    const tier = tierFor(id);
    const key = `${id}:${map}:${tier}`;
    if (texCache.has(key)) return texCache.get(key);
    const mf = await manifest();
    const e = entry(mf, id);
    // manifest 的 desktop 節點是 1k、mobile 節點是 512；tier 決定取哪一組
    const files = e?.files?.[tier === '1k' ? 'desktop' : 'mobile'];
    const file = files?.[map];
    if (!file) return null;
    note(file.path, file.bytes);
    const tex = await new Promise((res) => {
      texLoader.load(file.path, res, undefined, () => { console.warn('[assets] 貼圖載入失敗', file.path); res(null); });
    });
    if (!tex) return null;
    tex.colorSpace = file.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = mobile ? 4 : 8;
    texCache.set(key, tex);
    return tex;
  }

  // ── 一整組 PBR（diff + nor + arm）────────────────────────────
  // repeat 以「世界單位／格」給：本場 1 單位 ≈ 1.3 公尺（可讀性放大的 diorama 尺度）。
  // 回傳可直接展開進 MeshStandardMaterial 的欄位；clone 過的貼圖共用同一個 Source，
  // 不會重複上傳 GPU，但 repeat／offset 各自獨立。
  async function pbr(id, { repeat = [1, 1], normalScale = 1, aoIntensity = 1 } = {}) {
    const [diff, nor, arm] = await Promise.all([texture(id, 'diff'), texture(id, 'nor'), texture(id, 'arm')]);
    if (!diff) return null;
    const out = {};
    const fit = (t) => {
      const c = t.clone();
      c.needsUpdate = true;
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      return c;
    };
    out.map = fit(diff);
    if (nor) { out.normalMap = fit(nor); out.normalScale = new THREE.Vector2(normalScale, normalScale); }
    if (arm) {
      const a = fit(arm);
      out.aoMap = a; out.roughnessMap = a; out.metalnessMap = a;
      out.aoMapIntensity = aoIntensity;
    }
    return out;
  }

  // ── glTF 模型 ───────────────────────────────────────────────
  function loader() {
    if (!gltfLoader) {
      gltfLoader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_PATH);
      gltfLoader.setDRACOLoader(draco);
    }
    return gltfLoader;
  }

  // 回傳 gltf.scene（共用實例，呼叫端請自行 clone 或抽 geometry）
  function model(id) {
    if (modelCache.has(id)) return modelCache.get(id);
    const p = (async () => {
      const mf = await manifest();
      const e = entry(mf, id);
      let path = e?.files?.[profile]?.glb?.path ?? e?.files?.desktop?.glb?.path ?? null;
      if (!path) {
        if (!hasBlenderModel(id)) return null;   // 還沒建好 → 不發請求，保持 console 乾淨
        path = `/models/${id}.glb`;
      }
      note(path, e?.files?.[profile]?.glb?.bytes ?? e?.files?.desktop?.glb?.bytes ?? 0);
      try {
        let seen = 0;
        const gltf = await loader().loadAsync(path, (ev) => { if (ev?.total) seen = ev.total; });
        noteBytes(path, seen);
        prepareModel(gltf.scene);
        return gltf.scene;
      } catch (err) {
        console.warn('[assets] 模型載入失敗，保留程序化版本：', id, err?.message ?? err);
        return null;
      }
    })();
    modelCache.set(id, p);
    return p;
  }

  async function models(ids) {
    const list = await Promise.all(ids.map((id) => model(id)));
    const out = {};
    ids.forEach((id, i) => { if (list[i]) out[id] = list[i]; });
    return out;
  }

  // ── HDRI 環境光 ─────────────────────────────────────────────
  // 桌機：1k .hdr → PMREMGenerator；手機：tonemapped JPG → PMREM（省 1.2 MB）。
  function envMap(id, { forceTonemapped = false } = {}) {
    const key = `${id}:${forceTonemapped || mobile ? 'tm' : 'hdr'}`;
    if (envCache.has(key)) return envCache.get(key);
    const p = (async () => {
      if (!renderer) return null;
      const mf = await manifest();
      const e = entry(mf, id);
      const files = e?.files?.[profile] ?? e?.files?.desktop;
      const useTm = mobile || forceTonemapped || !files?.hdr;
      const file = useTm ? (files?.tonemapped ?? e?.files?.desktop?.tonemapped) : files.hdr;
      if (!file) return null;
      note(file.path, file.bytes);
      try {
        const tex = useTm
          ? await texLoader.loadAsync(file.path)
          : await hdrLoader.loadAsync(file.path);
        if (useTm) tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
        const rt = pmrem.fromEquirectangular(tex);
        tex.dispose();
        return rt.texture;
      } catch (err) {
        console.warn('[assets] HDRI 載入失敗，保留程序化天光：', id, err?.message ?? err);
        return null;
      }
    })();
    envCache.set(key, p);
    return p;
  }

  function stats() {
    let bytes = 0;
    for (const b of requested.values()) bytes += b;
    return { files: requested.size, bytes, mb: +(bytes / 1048576).toFixed(2), list: [...requested.entries()] };
  }

  return { profile, mobile, manifest, texture, pbr, model, models, envMap, stats, hasModel: hasBlenderModel };
}

// ══════════════════════════════════════════════════════════════
// 共用工具（純函式，可單元測試）
// ══════════════════════════════════════════════════════════════

// glb 載入後統一整過一遍：roughness 下限 0.35（避免塑膠感）、葉片 alphaTest、
// Lambert/Basic 舊材質換 Standard（Poly Haven glb 本來就是 Standard）。
export function prepareModel(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;   // 由使用端決定
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.roughness != null) m.roughness = Math.max(0.35, m.roughness);
      if (m.transparent && m.alphaTest === 0) m.alphaTest = 0.5;   // MASK 葉片
      // 葉片 alphaTest 調低到 0.33：Poly Haven 的葉片是薄卡片，遠處 mipmap 會把 alpha
      // 平均掉，維持 0.5 的話整棵樹在十幾單位外就「掉葉子」只剩枝幹。
      if (m.alphaTest > 0) { m.alphaTest = Math.min(m.alphaTest, 0.33); m.side = THREE.DoubleSide; }
    }
  });
  return root;
}

// 依 bounding box 把模型縮放到指定的世界尺寸（§0 鐵則 4：對齊現有程序化模型的 bbox）
// axis: 'x' | 'y' | 'z' | 'max'；回傳縮放倍率（不改動 root，交由呼叫端套用）
export function fitScale(root, target, axis = 'y') {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const cur = axis === 'max' ? Math.max(size.x, size.y, size.z) : size[axis];
  if (!Number.isFinite(cur) || cur <= 1e-6) return 1;
  return target / cur;
}

// 幾何屬性統一成 position/normal/uv，否則 mergeGeometries 會因屬性不一致而失敗
export function trimGeometry(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  g.clearGroups();
  return g;
}

// 把 glb 子樹的每個 prim 依「材質名稱」分桶，幾何壓成世界座標（相對 root）
// 回傳 Map<materialName, {geos: [], material}>
export function collectByMaterial(root, { matrix = null, into = new Map() } = {}) {
  root.updateMatrixWorld(true);
  const base = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m = mats[0];
    const name = m?.name || 'default';
    const g = trimGeometry(o.geometry);
    const mx = new THREE.Matrix4().multiplyMatrices(base, o.matrixWorld);
    if (matrix) mx.premultiply(matrix);
    g.applyMatrix4(mx);
    if (!into.has(name)) into.set(name, { geos: [], material: m });
    into.get(name).geos.push(g);
  });
  return into;
}

// 把 glb 子樹烘焙成「單一頂點色幾何」：材質 baseColor → 頂點色。
// 用途：士兵／載具／機槍巢 —— 每個單位一個 draw call，且淡出邏輯（改材質 color／opacity）
// 仍舊只影響該單位（材質是每單位一份，不會 A 單位炸掉 B 單位跟著淡）。
export function bakeToVertexColors(root, { matrix = null } = {}) {
  root.updateMatrixWorld(true);
  const base = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  const _c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m = mats[0];
    const g = trimGeometry(o.geometry);
    const mx = new THREE.Matrix4().multiplyMatrices(base, o.matrixWorld);
    if (matrix) mx.premultiply(matrix);
    g.applyMatrix4(mx);
    _c.copy(m?.color ?? new THREE.Color(0xffffff));
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(g);
  });
  if (!parts.length) return null;
  return mergeGeometries(parts, false);
}
