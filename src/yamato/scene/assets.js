// 真實資產載入器(asset-pipeline-spec §3)— 貼圖 / HDRI / Blender glTF
//
// 鐵則:
//   1. 只認 `public/assets-manifest.json`,不在程式裡寫死 `/tex/...` 路徑。
//      (例外:Blender 產出的 .glb 目前還沒登記進 manifest —— manifest 由 §1 的 Poly Haven
//       管線產生,§2 的 Blender 模型晚一步進 public/models/。所以模型走「manifest 有就用
//       manifest,沒有就退回 `/models/<id>.glb` 慣例」,manifest 補上之後這裡不用改。)
//   2. **絕不阻塞首屏**:所有東西都是「先給 fallback,資產到了再換」。這個模組不 await 任何
//      東西就回傳,呼叫端拿到的是 Promise,場景照常在第一幀就建好。
//   3. 桌機 / 手機兩條路徑:貼圖 1024 / 512;HDRI 桌機 1k .hdr(PMREM)、手機 tonemapped JPG。
//   4. 一切有快取:同一個 id 只下載一次,多艘驅逐艦共用同一份幾何與貼圖。
//   5. 載入失敗一律 console.warn 後回傳 null,呼叫端保留程序化 fallback。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// three 0.184 起 RGBELoader 已更名 HDRLoader(舊名會洗 console 警告)
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MANIFEST_URL = '/assets-manifest.json';
const MODEL_FALLBACK = (id) => `/models/${id}.glb`;

let cfg = { mobile: false, anisotropy: 4 };

export function configureAssets(opts = {}) {
  Object.assign(cfg, opts);
}

/** glb 自帶的貼圖(烘焙版)不經過 loadTexture,異方向性過濾要由呼叫端自己補 */
export function assetAnisotropy() {
  return cfg.anisotropy;
}

// ── manifest ────────────────────────────────────────
let manifestP = null;
export function loadManifest() {
  if (manifestP) return manifestP;
  manifestP = fetch(MANIFEST_URL)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .catch((e) => {
      console.warn('[assets] manifest 讀取失敗,全部退回程序化 fallback:', e.message);
      return { assets: {} };
    });
  return manifestP;
}

function tierOf(entry, map) {
  const tier = cfg.mobile ? 'mobile' : 'desktop';
  const f = entry?.files?.[tier]?.[map] ?? entry?.files?.desktop?.[map] ?? null;
  return f;
}

// 實際下載量統計(驗收要回報首屏載入量;只算本模組拉下來的資產)
const bytes = { texture: 0, hdri: 0, model: 0 };
export function assetBytes() {
  return { ...bytes, total: bytes.texture + bytes.hdri + bytes.model };
}

// ── 載入器(單例) ────────────────────────────────────
let _gltf = null;
function gltfLoader() {
  if (_gltf) return _gltf;
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  _gltf = new GLTFLoader();
  _gltf.setDRACOLoader(draco);
  return _gltf;
}

let _tex = null;
const texLoader = () => (_tex ??= new THREE.TextureLoader());
let _hdr = null;
const hdrLoader = () => (_hdr ??= new HDRLoader());

// ── 貼圖 ────────────────────────────────────────────
// kind: 'diff' | 'nor' | 'arm'
// asData=true → 不做 sRGB 解碼(當顆粒 / 遮罩 / 資料層用,平均值才會落在 0.5 附近)
const texCache = new Map();
export function loadTexture(id, kind = 'diff', { asData = false, repeat = 1 } = {}) {
  const key = `${id}|${kind}|${asData}|${repeat}`;
  if (texCache.has(key)) return texCache.get(key);
  const p = loadManifest().then((m) => {
    const entry = m.assets?.[id];
    const file = tierOf(entry, kind);
    if (!file) {
      console.warn(`[assets] manifest 沒有貼圖 ${id}/${kind}`);
      return null;
    }
    return new Promise((resolve) => {
      texLoader().load(
        file.path,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(repeat, repeat);
          t.anisotropy = cfg.anisotropy;
          t.colorSpace = asData || kind !== 'diff' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          t.needsUpdate = true;
          t.userData.mean = meanOf(t.image);
          bytes.texture += file.bytes ?? 0;
          resolve(t);
        },
        undefined,
        (e) => {
          console.warn(`[assets] 貼圖載入失敗 ${file.path}`, e);
          resolve(null);
        }
      );
    });
  });
  texCache.set(key, p);
  return p;
}

// 貼圖的平均值:把整張圖畫進 1×1 canvas 讓瀏覽器自己做面積平均。
// 當顆粒層用的時候要除以這個值才會「明度中性」—— metal_plate 的綠通道平均只有 0.196,
// 若照「假設平均 0.5」的老寫法乘 2,整艘船會暗掉六成。自己量就不必為每張圖寫死常數。
function meanOf(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return [0.5, 0.5, 0.5];
  }
}

// ── HDRI ────────────────────────────────────────────
// 桌機:1k .hdr(HalfFloat,PMREM 品質最好);手機:tonemapped JPG(≤ 400 KB)。
// 回傳的是等距長方投影貼圖,PMREM 由呼叫端做(environment.js 持有 renderer)。
const hdriCache = new Map();
export function loadHDRI(id, { forceTonemapped = false } = {}) {
  const key = id + (forceTonemapped ? '|tm' : '');
  if (hdriCache.has(key)) return hdriCache.get(key);
  const p = loadManifest().then((m) => {
    const entry = m.assets?.[id];
    if (!entry) {
      console.warn(`[assets] manifest 沒有 HDRI ${id}`);
      return null;
    }
    const useTM = cfg.mobile || forceTonemapped;
    const file = useTM ? tierOf(entry, 'tonemapped') : tierOf(entry, 'hdr') ?? tierOf(entry, 'tonemapped');
    if (!file) return null;
    const loader = file.path.endsWith('.hdr') ? hdrLoader() : texLoader();
    return new Promise((resolve) => {
      loader.load(
        file.path,
        (t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          if (!file.path.endsWith('.hdr')) t.colorSpace = THREE.SRGBColorSpace;
          bytes.hdri += file.bytes ?? 0;
          resolve(t);
        },
        undefined,
        (e) => {
          console.warn(`[assets] HDRI 載入失敗 ${file.path}`, e);
          resolve(null);
        }
      );
    });
  });
  hdriCache.set(key, p);
  return p;
}

// ── 模型 ────────────────────────────────────────────
// 回傳 gltf.scene(已 updateMatrixWorld)。同一個 id 只下載一次;要多份就自己 clone 或抽幾何。
const modelCache = new Map();
export function loadModel(id) {
  if (modelCache.has(id)) return modelCache.get(id);
  const p = loadManifest().then((m) => {
    const entry = m.assets?.[id];
    const file = tierOf(entry, 'glb') ?? tierOf(entry, 'model');
    const path = file?.path ?? MODEL_FALLBACK(id);
    return new Promise((resolve) => {
      gltfLoader().load(
        path,
        (gltf) => {
          gltf.scene.updateMatrixWorld(true);
          if (file?.bytes) bytes.model += file.bytes;
          else fetchSize(path);
          resolve(gltf.scene);
        },
        undefined,
        (e) => {
          console.warn(`[assets] 模型載入失敗 ${path}(保留程序化 fallback)`, e?.message ?? e);
          resolve(null);
        }
      );
    });
  });
  modelCache.set(id, p);
  return p;
}

// manifest 還沒登記模型大小時,從 performance resource timing 補量(只為驗收報告,失敗無妨)
function fetchSize(path) {
  try {
    const hit = performance
      .getEntriesByType('resource')
      .find((e) => e.name.endsWith(path));
    bytes.model += hit?.transferSize || hit?.encodedBodySize || 0;
  } catch { /* 量不到就算了 */ }
}

// ── 幾何烘焙工具(共用給 ships.js / aircraft.js) ──────
// glb 一個節點常被拆成「每個材質一個 primitive」,直接放進場景 = 每艘船 6+ 個 draw call。
// 這裡把整棵子樹烘成「一份幾何 + 頂點色 + 每頂點粗糙度/金屬度(aRM)」,
// 搭配 makeGlbMaterial() 的 shader 注入,一艘船只要 1 個 draw call 就能保留每個材質的 PBR 參數。
const _m4 = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

function bakeMesh(mesh, matrix, metalClamp = 1) {
  let g = mesh.geometry;
  g = g.index ? g.toNonIndexed() : g.clone();
  // 只留 position / normal,其餘(uv、tangent…)丟掉,merge 才不會因屬性不一致而失敗
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  else g.computeVertexNormals(); // 縮放後法線要重算(非等比時尤其)

  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const rm = new Float32Array(n * 2);
  const c = mat?.color ?? new THREE.Color(0.5, 0.5, 0.5);
  const rough = Math.max(0.35, mat?.roughness ?? 0.6); // 規格:粗糙度下限 0.35,避免塑膠感
  // 塗裝過的鋼板在物理上是介電質(metalness ≈ 0),Blender 端給 0.55–0.85 會讓艦體
  // 在 HDRI 下整片反射天空變成銀色。烘焙時統一壓上限,裸鋼與砲管仍然比塗裝面亮。
  const metal = Math.min(mat?.metalness ?? 0.2, metalClamp);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    rm[i * 2] = rough; rm[i * 2 + 1] = metal;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
  return g;
}

/**
 * 把 root 底下(排除 stop 集合的子樹)所有 mesh 烘成一份幾何,座標為 root 的區域座標 × scale。
 * @param {THREE.Object3D} root
 * @param {number} scale 對齊現有程序化模型尺度用的縮放
 * @param {Set<THREE.Object3D>} stop 不併入的子樹(砲塔、螺旋槳等要獨立轉動的節點)
 */
export function bakeSubtree(root, scale = 1, stop = null, metalClamp = 1) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const parts = [];
  const walk = (node, skipSelf) => {
    if (stop?.has(node) && !skipSelf) return;
    if (node.isMesh && node.geometry) {
      _m4.multiplyMatrices(_inv, node.matrixWorld).premultiply(S);
      parts.push(bakeMesh(node, _m4, metalClamp));
    }
    for (const c of node.children) walk(c, false);
  };
  walk(root, true);
  if (!parts.length) return null;
  return parts;
}

export function mergeBaked(parts) {
  if (!parts || !parts.length) return null;
  const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  return geo;
}

/** bakeSubtree + merge 的一步到位版本 */
export function bakeMerged(root, scale = 1, stop = null, metalClamp = 1) {
  return mergeBaked(bakeSubtree(root, scale, stop, metalClamp));
}

// ── glb 統一材質(asset-pipeline-spec §3「所有 glb 材質統一過一遍」) ──
// MeshStandardMaterial + 頂點色 + 每頂點 roughness/metalness(aRM),一份材質吃下整艘船的
// 6 種塗裝,draw call 維持 1。再用物件空間三平面投影疊「鋼板顆粒 + 水線鏽痕」細節:
// glb 沒有 UV,做 UV 會讓 Blender 端複雜化,三平面在船體這種箱型量體上效果很好且不吃 UV。
//
// ⚠ 貼圖是非同步到的:uniform 先塞 1×1 白色 placeholder,之後直接換 `.value`,
//   不會觸發 shader 重編譯(同一個 sampler)。
let _white = null;
function whiteTex() {
  if (_white) return _white;
  _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  _white.needsUpdate = true;
  return _white;
}

export function makeGlbMaterial({
  detailScale = 0.18,   // 每場景單位幾個貼圖 tile
  detailK = 0.55,       // 顆粒強度
  rust = false,         // 是否疊水線鏽痕
  rustLo = -2,          // 鏽痕最強的高度(場景單位,0 = 水線)
  rustHi = 9,           // 鏽痕消失的高度
  envMapIntensity = 0.9,
  flatShading = false,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,   // 真正的粗糙度來自 aRM.x(見下方注入)
    metalness: 1,   // 同上,aRM.y
    envMapIntensity,
    flatShading,
  });
  const u = {
    uDetail: { value: whiteTex() },
    uRust: { value: whiteTex() },
    uDeck: { value: whiteTex() },
    uDeckMid: { value: 0.5 },
    uDeckK: { value: 0 },
    uDeckScale: { value: detailScale * 2.6 },
    uDetailScale: { value: detailScale },
    uDetailMid: { value: 0.5 },   // 顆粒貼圖的實測平均,見 meanOf()
    uDetailK: { value: 0 },      // 貼圖到位前為 0(等於沒有細節層)
    uRustK: { value: 0 },
    uRustBand: { value: new THREE.Vector2(rustLo, rustHi) },
  };
  mat.userData.u = u;
  mat.userData.wantsRust = rust;
  mat.customProgramCacheKey = () => 'yamato-glb-v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec2 aRM;
         varying vec2 vRM;
         varying vec3 vObj;
         varying vec3 vObjN;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRM = aRM;
         vObj = position;
         vObjN = normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uDetail;
         uniform sampler2D uRust;
         uniform sampler2D uDeck;
         uniform float uDeckMid;
         uniform float uDeckK;
         uniform float uDeckScale;
         uniform float uDetailScale;
         uniform float uDetailMid;
         uniform float uDetailK;
         uniform float uRustK;
         uniform vec2 uRustBand;
         varying vec2 vRM;
         varying vec3 vObj;
         varying vec3 vObjN;
         float gDetail = 1.0;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           vec3 bw = abs(normalize(vObjN));
           float wy = bw.y / max(bw.x + bw.y + bw.z, 1e-4);
           vec2 uvSide = vObj.zy * uDetailScale;
           vec2 uvTop  = vObj.xz * uDetailScale;
           float gS = texture2D(uDetail, uvSide).g;
           float gT = texture2D(uDetail, uvTop).g;
           gDetail = mix(gS, gT, wy) / uDetailMid; // 除以實測平均 → 顆粒層明度中性
           // 柚木甲板:朝上且偏暖色的面(glb 的 deck 材質)改用木紋,鋼板面維持金屬顆粒。
           // 用「頂點色偏暖」當遮罩,不必為了一層甲板多切一個 mesh / 多一個 draw call。
           if (uDeckK > 0.0) {
             float warm = clamp((vColor.r - vColor.b) * 6.0, 0.0, 1.0);
             float up = smoothstep(0.35, 0.8, normalize(vObjN).y);
             float gDeck = texture2D(uDeck, vObj.zx * uDeckScale).g / uDeckMid;
             gDetail = mix(gDetail, gDeck, warm * up * uDeckK);
           }
           diffuseColor.rgb *= mix(1.0, clamp(gDetail, 0.45, 1.8), uDetailK);
           if (uRustK > 0.0) {
             float band = smoothstep(uRustBand.y, uRustBand.x, vObj.y);
             float streak = texture2D(uRust, uvSide * 0.55).g;
             // 鏽是「淡淡的鐵鏽色垂流」,不是整片橘漆:遮罩上限 0.45、色偏也壓下來。
             // (第一版 1.55/0.78/0.46 × 0.85 讓整段乾舷變成橘色,近拍時像沒上漆的貨船)
             float m = clamp(band * streak * uRustK, 0.0, 0.45);
             diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.32, 0.88, 0.70), m);
           }
         }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor *= vRM.x * mix(1.0, 0.72 + 0.28 * gDetail, uDetailK);
         roughnessFactor = clamp(roughnessFactor, 0.35, 1.0);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         metalnessFactor *= vRM.y;`
      );
  };
  return mat;
}

/** 貼圖到位後掛上細節層(呼叫端不用管載入時序) */
export function attachDetailMaps(mat, {
  detail = 'metal_plate', rust = 'rusty_metal_02', deck = null,
  detailK = 0.55, rustK = 0.7, deckK = 0.9,
} = {}) {
  const u = mat.userData?.u;
  if (!u) return;
  loadTexture(detail, 'diff', { asData: true }).then((t) => {
    if (!t) return;
    u.uDetail.value = t;
    u.uDetailMid.value = Math.max(0.05, t.userData.mean?.[1] ?? 0.5);
    u.uDetailK.value = detailK;
  });
  if (deck) {
    loadTexture(deck, 'diff', { asData: true }).then((t) => {
      if (!t) return;
      u.uDeck.value = t;
      u.uDeckMid.value = Math.max(0.05, t.userData.mean?.[1] ?? 0.5);
      u.uDeckK.value = deckK;
    });
  }
  if (mat.userData.wantsRust) {
    loadTexture(rust, 'diff', { asData: true }).then((t) => {
      if (!t) return;
      u.uRust.value = t;
      u.uRustK.value = rustK;
    });
  }
}

export function boxOf(root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

export function findByName(root, name) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}
