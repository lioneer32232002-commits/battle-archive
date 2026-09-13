// 真實資產載入器（docs/asset-pipeline-spec.md §3）— 十字路口專用。
//
// 原則：
//   1. 只認 `public/assets-manifest.json`，不寫死 Poly Haven 的路徑。
//      ⚠️ 例外：Blender 腳本建模的自有 glb（mg_nest、farmhouse_dutch、windmill、barn、soldier_*）
//      目前**沒有**登記進 manifest（該檔由 scripts/assets 產生，只涵蓋 Poly Haven 抓下來的東西）。
//      這裡用 LOCAL_MODELS 這張小登記表補上；manifest 之後補登了就自動以 manifest 為準。
//   2. 首屏不阻塞：所有載入都是 Promise，場景先用程序化 fallback 建好、跑起來，資產到了才換。
//      任何一項失敗（404、解碼錯誤）都只是 resolve(null)，畫面維持 fallback，不丟例外、不擋其他資產。
//   3. 快取：同一組貼圖／模型只抓一次；貼圖依 repeat 分別快取（clone 會多一份 GPU upload）。
//   4. 桌機 1024²／手機 512²；HDRI 桌機用 .hdr 過 PMREM，手機用 tonemapped JPG 同樣過 PMREM。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const MANIFEST_URL = '/assets-manifest.json';
const DRACO_PATH = '/draco/';

// manifest 尚未涵蓋的自有模型（Blender 腳本產出，一律在 /models/<id>.glb）。
// 這是一張白名單而不是「什麼都去試載」：打錯字要當場看得出來，不要靜靜 404。
const LOCAL_MODEL_IDS = [
  // 陣地與建築
  'mg_nest', 'farmhouse_dutch', 'farmhouse_dutch_damaged', 'windmill', 'windmill_damaged', 'barn',
  // R2 Cycles 舊化烘焙版（單一材質＋四張貼圖；桌機 high／medium 優先載這個）
  'farmhouse_dutch_baked', 'barn_baked',
  // 道具
  'signpost', 'fence_wood', 'sandbag_wall', 'foxhole', 'ammo_crate',
  // R1 骨架動畫士兵（20 骨、七個 clip；德軍這場用長大衣版）
  'soldier_rig_us', 'soldier_rig_de', 'soldier_rig_de_coat',
  // 士兵（美軍傘兵／德軍國民擲彈兵長大衣版）
  'soldier_us_stand_rifle', 'soldier_us_advance_rifle', 'soldier_us_kneel_fire',
  'soldier_us_crouch_run', 'soldier_us_prone_mg',
  'soldier_de_stand_rifle', 'soldier_de_advance_rifle', 'soldier_de_kneel_fire',
  'soldier_de_crouch_run', 'soldier_de_prone_mg',
  'soldier_de_coat_stand_rifle', 'soldier_de_coat_advance_rifle', 'soldier_de_coat_kneel_fire',
  'soldier_de_coat_crouch_run', 'soldier_de_coat_prone_mg',
  // 武器（掛在士兵的 hand_r 空節點上）
  'garand', 'thompson', 'bar', 'kar98k', 'mp40', 'mg42',
];
const LOCAL_MODELS = Object.fromEntries(LOCAL_MODEL_IDS.map((id) => [id, `/models/${id}.glb`]));

export function createAssetLoader({ mobile = false, renderer = null } = {}) {
  const quality = mobile ? 'mobile' : 'desktop';
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  const aniso = Math.min(mobile ? 4 : 16, maxAniso);

  // ── 載入器（共用單例） ───────────────────────────────────
  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new HDRLoader();   // three 0.184 起 RGBELoader 已棄用（會洗 console 警告）
  const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);

  let pmrem = null;
  function getPMREM() {
    if (!pmrem && renderer) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
    return pmrem;
  }

  // ── manifest ──────────────────────────────────────────
  let manifestP = null;
  function manifest() {
    if (!manifestP) {
      manifestP = fetch(MANIFEST_URL)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return manifestP;
  }

  // ── 貼圖組 ────────────────────────────────────────────
  const texCache = new Map();

  // 貼圖的平均線性亮度：macro 疊乘時用來正規化細節層，才不會整片被壓暗／提亮。
  function averageLinearLuminance(image) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(image, 0, 0, 4, 4);
      const d = g.getImageData(0, 0, 4, 4).data;
      let sum = 0;
      for (let i = 0; i < 16; i++) {
        const toLin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        sum += 0.2126 * toLin(d[i * 4]) + 0.7152 * toLin(d[i * 4 + 1]) + 0.0722 * toLin(d[i * 4 + 2]);
      }
      const v = sum / 16;
      return v > 0.005 ? v : 0.2;
    } catch { return 0.2; }
  }

  function loadOne(path, srgb) {
    return new Promise((resolve) => {
      texLoader.load(path, (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        resolve(t);
      }, undefined, () => resolve(null));
    });
  }

  /**
   * 取一組 PBR 貼圖。
   * @param id manifest 的 texture id
   * @param maps 要哪幾張：['diff','nor','arm'] 的子集
   * @param repeat [u, v]
   * @param px 1024 或 512（手機一律 512）
   * @returns {Promise<{map,normalMap,aoMap,roughnessMap,metalnessMap,avgLum}|null>}
   */
  async function textureSet(id, { maps = ['diff', 'nor', 'arm'], repeat = [1, 1], px = 1024 } = {}) {
    const wantPx = mobile ? 512 : px;
    const key = `${id}|${maps.join('')}|${repeat[0]}x${repeat[1]}|${wantPx}`;
    if (texCache.has(key)) return texCache.get(key);
    const p = (async () => {
      const m = await manifest();
      const a = m?.assets?.[id];
      if (!a || a.type !== 'texture') return null;
      const bucket = a.files[wantPx <= 512 ? 'mobile' : 'desktop'] ?? a.files.desktop;
      if (!bucket) return null;
      const out = {};
      const jobs = [];
      for (const mp of maps) {
        const f = bucket[mp];
        if (!f) continue;
        jobs.push(loadOne(f.path, mp === 'diff').then((t) => {
          if (!t) return;
          t.repeat.set(repeat[0], repeat[1]);
          if (mp === 'diff') { out.map = t; out.avgLum = averageLinearLuminance(t.image); }
          else if (mp === 'nor') out.normalMap = t;
          else if (mp === 'arm') { out.aoMap = t; out.roughnessMap = t; out.metalnessMap = t; }
        }));
      }
      await Promise.all(jobs);
      return out.map || out.normalMap ? out : null;
    })();
    texCache.set(key, p);
    return p;
  }

  // ── HDRI → PMREM environment ─────────────────────────
  const envCache = new Map();
  /**
   * @param id manifest 的 hdri id
   * @param tonemapped 桌機也改用 tonemapped JPG（省 1 MB 以上；只當環境光、不當背景時夠用）
   * @returns {Promise<THREE.Texture|null>} PMREM 過的 environment map
   */
  function environment(id, { tonemapped = false } = {}) {
    const key = id + (tonemapped ? '|tm' : '');
    if (envCache.has(key)) return envCache.get(key);
    const p = (async () => {
      const m = await manifest();
      const a = m?.assets?.[id];
      const gen = getPMREM();
      if (!a || a.type !== 'hdri' || !gen) return null;
      const bucket = a.files[quality] ?? a.files.desktop;
      const src = (!mobile && !tonemapped && bucket.hdr) ? bucket.hdr : bucket.tonemapped;
      if (!src) return null;
      const isHDR = src === bucket.hdr;
      const raw = await new Promise((resolve) => {
        const L = isHDR ? hdrLoader : texLoader;
        L.load(src.path, (t) => resolve(t), undefined, () => resolve(null));
      });
      if (!raw) return null;
      if (!isHDR) raw.colorSpace = THREE.SRGBColorSpace;
      raw.mapping = THREE.EquirectangularReflectionMapping;
      const env = gen.fromEquirectangular(raw).texture;
      raw.dispose();
      return env;
    })();
    envCache.set(key, p);
    return p;
  }

  // ── 模型 ──────────────────────────────────────────────
  const modelCache = new Map();
  /**
   * @param id manifest 的 model id，或 LOCAL_MODEL_IDS 裡的自有模型
   * @param hi 取高規版（manifest 的 files.desktop.glb_hi）—— 闊葉樹的 300 KB 版葉量只有 1/5，
   *           近景會看得出稀疏；核心區的 hero 樹才值得吃這個（約 1 MB／棵，手機一律不吃）
   * @returns {Promise<THREE.Object3D|null>} glb 的 scene（共用，呼叫端自己 clone）
   */
  function model(id, { hi = false } = {}) {
    const cacheKey = id + (hi ? '|hi' : '');
    if (modelCache.has(cacheKey)) return modelCache.get(cacheKey);
    const p = (async () => {
      const m = await manifest();
      const a = m?.assets?.[id];
      const bucket = a?.type === 'model' ? (a.files[quality] ?? a.files.desktop) : null;
      const path = (hi && !mobile && bucket?.glb_hi?.path)
        || bucket?.glb?.path
        || LOCAL_MODELS[id];
      if (!path) return null;
      const gltf = await new Promise((resolve) => {
        gltfLoader.load(path, resolve, undefined, () => resolve(null));
      });
      if (!gltf) return null;
      const root = gltf.scene;
      // R1：骨架動畫的 clip 掛在 gltf.animations 上（GLTFLoader 不會塞進 scene），
      // 呼叫端只拿得到 scene，所以在這裡掛一份上去。glTF 的 animation extras
      // （walk／run 的 speed）由 GLTFLoader 放在 clip.userData。
      root.animations = gltf.animations ?? [];
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = true;
        const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(normalizeMaterial);
        o.material = mats.length === 1 ? mats[0] : mats;
      });
      return root;
    })();
    modelCache.set(cacheKey, p);
    return p;
  }

  function dispose() {
    if (pmrem) { pmrem.dispose(); pmrem = null; }
    draco.dispose();
  }

  return { manifest, textureSet, environment, model, dispose, quality, mobile, anisotropy: aniso };
}

// glb 材質統一（規格 §3）：舊 Lambert 換 Standard、roughness 下限 0.35（避免塑膠感）、
// alphaTest 依 glTF 的 MASK cutoff（GLTFLoader 已設 alphaTest，這裡只補保險）。
export function normalizeMaterial(mat, { envMapIntensity = 1 } = {}) {
  if (!mat) return mat;
  // Poly Haven 的樹帶 KHR_materials_ior／specular → GLTFLoader 會給 MeshPhysicalMaterial。
  // 葉子根本用不到那組運算，換回 Standard：shader 便宜一截，也不會再噴
  // 「THREE.WebGLProgram: warning X4122: sum of 1 and -1.49e-17…」那串 D3D 精度警告。
  if (mat.isMeshPhysicalMaterial
    && !mat.transmission && !mat.clearcoat && !mat.sheen && !mat.iridescence) {
    const std = new THREE.MeshStandardMaterial();
    THREE.Material.prototype.copy.call(std, mat);
    for (const k of ['color', 'map', 'normalMap', 'normalScale', 'roughness', 'roughnessMap',
      'metalness', 'metalnessMap', 'aoMap', 'aoMapIntensity', 'emissive', 'emissiveMap',
      'emissiveIntensity', 'alphaMap', 'flatShading', 'wireframe', 'vertexColors']) {
      const v = mat[k];
      if (v === undefined) continue;
      // ⚠️ 貼圖一律直接接過來，不能 clone —— Texture.clone() 會多一份 GPU upload
      std[k] = (v && v.isTexture) ? v : (v && v.clone ? v.clone() : v);
    }
    std.name = mat.name;
    mat.dispose();
    mat = std;
  }
  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    mat.roughness = Math.max(0.35, mat.roughness ?? 1);
    mat.envMapIntensity = envMapIntensity;
  }
  if (mat.transparent && mat.alphaTest > 0) {
    // 葉片：MASK 模式應該走 alphaTest（不透明佇列）而不是 transparent，否則排序會閃爍
    mat.transparent = false;
    mat.depthWrite = true;
  }
  if (mat.alphaTest > 0) mat.side = THREE.DoubleSide;   // 葉片單面會有半邊不見
  return mat;
}

// ── 幾何工具 ───────────────────────────────────────────
/** aoMap 讀的是 uv1；程序化幾何只有 uv，這裡補一份。 */
export function ensureUV1(geometry) {
  if (geometry.attributes.uv && !geometry.attributes.uv1) {
    geometry.setAttribute('uv1', geometry.attributes.uv);
  }
  return geometry;
}

/**
 * macro × detail 地表材質（規格 §3「地表 PBR」）。
 * map／normalMap／armMap 是高 repeat 的 Poly Haven 細節層（近看的草葉與土粒），
 * 既有的程序化 canvas 貼圖當 macro 層（遠看的田塊格局、車轍、彈坑），
 * 在 map_fragment 之後疊乘。細節層先用它自己的平均亮度正規化，
 * 所以疊上去之後整體亮度跟原本的 macro 幾乎一樣（只多了紋理起伏），不會整片變暗。
 */
export function makeMacroStandardMaterial({
  macroMap, macroRepeat = [1, 1], set = null, detailMix = 0.55,
  color = 0xffffff, roughness = 0.92, metalness = 0,
}) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness, metalness,
    map: set?.map ?? macroMap ?? null,
    normalMap: set?.normalMap ?? null,
    roughnessMap: set?.roughnessMap ?? null,
    aoMap: set?.aoMap ?? null,
    metalnessMap: set?.metalnessMap ?? null,
  });
  if (set?.normalMap) mat.normalScale = new THREE.Vector2(0.8, 0.8);
  if (!set?.map || !macroMap) return mat;   // 沒有細節層就直接用 macro，不進 shader

  mat.userData.macro = {
    uMacroMap: { value: macroMap },
    uMacroRepeat: { value: new THREE.Vector2(macroRepeat[0], macroRepeat[1]) },
    uDetailMix: { value: detailMix },
    uDetailRef: { value: set.avgLum ?? 0.2 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.macro);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uMacroRepeat;\nvarying vec2 vMacroUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMacroUv = uv * uMacroRepeat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMacroMap; uniform float uDetailMix; uniform float uDetailRef;
        varying vec2 vMacroUv;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 macroTexel = texture2D( uMacroMap, vMacroUv );
          float detailLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float k = clamp( detailLum / max( uDetailRef, 0.001 ), 0.0, 2.2 );
          diffuseColor.rgb = macroTexel.rgb * mix( 1.0, k, uDetailMix );
        }`);
  };
  mat.customProgramCacheKey = () => 'crossroads-macro';
  return mat;
}

/**
 * 把 glb 依 bounding box 對齊到既有程序化模型的尺度（規格 §0-4：不在 glTF 內硬編場景尺度）。
 * @returns {{scale:number, size:THREE.Vector3, box:THREE.Box3}}
 */
export function fitToHeight(object, targetHeight) {
  object.updateWorldMatrix(false, true);   // 沒更新子節點的 matrixWorld，包圍盒會漏掉巢狀 node（例如風車的 sails）
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 1e-4 ? targetHeight / size.y : 1;
  return { scale, size, box };
}
export function fitToWidth(object, targetWidth) {
  object.updateWorldMatrix(false, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const w = Math.max(size.x, size.z);
  const scale = w > 1e-4 ? targetWidth / w : 1;
  return { scale, size, box };
}

/** 把 glb（可能多層 node）攤平成 [{geometry, material}]，供 InstancedMesh 使用。 */
export function flattenForInstancing(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);     // 烘進 node transform，InstancedMesh 才對得上
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    out.push({ geometry: geo, material: mats[0] });
  });
  return out;
}

/** 依材質名稱套 PBR 貼圖（Blender 建築模型的材質名是 brick／roof_tile／stone… ）。 */
export function applyMaterialTextures(root, table, { shadows = false } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (shadows) { o.castShadow = true; o.receiveShadow = true; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const entry = table[m.name];
      if (!entry?.set?.map) return normalizeMaterial(m);
      const next = new THREE.MeshStandardMaterial({
        color: entry.color ?? m.color?.clone() ?? 0xffffff,
        map: entry.set.map,
        normalMap: entry.set.normalMap ?? null,
        roughnessMap: entry.set.roughnessMap ?? null,
        metalnessMap: entry.set.metalnessMap ?? null,
        roughness: entry.roughness ?? 0.85,
        metalness: entry.metalness ?? 0,
      });
      next.name = m.name;
      return next;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return root;
}
