// 真實資產載入器(docs/asset-pipeline-spec.md §0、§3)— 布雷庫爾專用
//
// 原則:
//  1. 只認 `public/assets-manifest.json`,不在程式裡寫死貼圖／HDRI 路徑。
//     (例外:Blender 腳本產出的 glb 目前還沒登記進 manifest,退回 `/models/<id>.glb`,
//      載不到就當作沒有 → 呼叫端保留程序化 fallback。)
//  2. 桌機／手機各一條路徑:貼圖 1k/512、HDRI .hdr/tonemapped JPG。
//  3. 一律非同步、一律不阻塞首屏:場景先用程序化版本建好,資產到了再換。
//     任何載入失敗只在 console 留一行 warn,不丟例外、不擋畫面。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MANIFEST_URL = '/assets-manifest.json';
const DRACO_PATH = '/draco/';

const cfg = { mobile: false, renderer: null, anisotropy: 8, envMapIntensity: 1 };

export function configureAssets(opts = {}) {
  Object.assign(cfg, opts);
  if (cfg.mobile) cfg.anisotropy = 4;
}
export const assetTier = () => (cfg.mobile ? 'mobile' : 'desktop');

// 缺件只報一次(避免每幀洗版)
const warned = new Set();
export const missingAssets = [];
function warnMissing(what, err) {
  if (warned.has(what)) return;
  warned.add(what);
  missingAssets.push(what);
  console.warn(`[brecourt/assets] 取不到 ${what}，保留程序化版本`, err?.message ?? '');
}

// ── manifest ────────────────────────────────────────────
let manifestPromise = null;
export function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => { warnMissing('assets-manifest.json', e); return { assets: {} }; });
  }
  return manifestPromise;
}

function manifestEntry(m, id) { return m?.assets?.[id] ?? null; }

// manifest 的 files 分 desktop／mobile;手機缺項時退回桌機那份。
// tier 可以個別指定:桌機也有東西該用 512(建物牆面、屋頂、路面在畫面上都不大),
// 一場戰役的首屏預算才守得住。
function manifestPath(m, id, kind, tier = assetTier()) {
  const e = manifestEntry(m, id);
  if (!e) return null;
  return e.files?.[tier]?.[kind]?.path ?? e.files?.desktop?.[kind]?.path ?? null;
}

// 首屏之後再開始抓(等兩幀,確保第一張畫面已經送出去了)。
// 分頁在背景時 rAF 會被凍住 → 另外掛一個 400ms 的保險絲,誰先到算誰(只跑一次)。
export function afterFirstFrame(fn) {
  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    try { fn(); } catch (e) { console.warn('[brecourt/assets] 升級流程出錯', e); }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 400);
}

// ── 貼圖 ────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const texCache = new Map();   // path → Promise<Texture|null>

function loadRaw(path) {
  let p = texCache.get(path);
  if (!p) {
    p = new Promise((resolve) => {
      texLoader.load(path, resolve, undefined, (e) => { warnMissing(path, e); resolve(null); });
    });
    texCache.set(path, p);
  }
  return p;
}

/**
 * 依 manifest 取一張貼圖。map: 'diff' | 'nor' | 'arm'。
 * 回傳的是 clone(共用 GPU source、各自可設 repeat),取不到回 null。
 */
export async function loadTexture(id, map = 'diff', { repeat = [1, 1], wrap = THREE.RepeatWrapping, tier } = {}) {
  const m = await getManifest();
  const path = manifestPath(m, id, map, tier ?? assetTier());
  if (!path) { warnMissing(`tex:${id}/${map}`); return null; }
  const base = await loadRaw(path);
  if (!base) return null;
  const t = base.clone();
  t.colorSpace = map === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;   // nor／arm 是資料,不是顏色
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = cfg.anisotropy;
  t.needsUpdate = true;
  return t;
}

/**
 * 一組 PBR 貼圖。arm = AO(R)／Roughness(G)／Metalness(B),三個通道共用同一張。
 * 回傳 { map, normalMap, roughnessMap, aoMap, metalnessMap },缺的就是 null。
 */
export async function loadPBR(id, { repeat = [1, 1], maps = ['diff', 'nor', 'arm'], tier } = {}) {
  const [diff, nor, arm] = await Promise.all([
    maps.includes('diff') ? loadTexture(id, 'diff', { repeat, tier }) : null,
    maps.includes('nor') ? loadTexture(id, 'nor', { repeat, tier }) : null,
    maps.includes('arm') ? loadTexture(id, 'arm', { repeat, tier }) : null,
  ]);
  return {
    map: diff,
    normalMap: nor,
    roughnessMap: arm,
    metalnessMap: arm,
    aoMap: arm,
  };
}

/** 把一組 PBR 貼圖套到 MeshStandardMaterial 上(null 的略過) */
export function applyPBR(mat, set, { aoIntensity = 0.8, normalScale = 1 } = {}) {
  if (!set) return mat;
  if (set.map) mat.map = set.map;
  if (set.normalMap) { mat.normalMap = set.normalMap; mat.normalScale.set(normalScale, normalScale); }
  if (set.roughnessMap) mat.roughnessMap = set.roughnessMap;
  if (set.aoMap) { mat.aoMap = set.aoMap; mat.aoMapIntensity = aoIntensity; }
  mat.needsUpdate = true;
  return mat;
}

/**
 * 一張貼圖的平均線性亮度。地表把細節貼圖當「明暗層」、程序化田塊貼圖當「顏色層」時,
 * 必須先除掉細節層自己的平均亮度,整體調色盤才不會被平移(諾曼第牧草地的色彩校準
 * 在 art-upgrade-spec 花了兩輪,不能因為換貼圖就重來)。
 */
const lumCache = new Map();
export function textureMeanLuminance(tex, fallback = 0.15) {
  if (!tex?.image) return fallback;
  const key = tex.image.currentSrc || tex.image.src || tex.uuid;
  if (lumCache.has(key)) return lumCache.get(key);
  let out = fallback;
  try {
    const N = 32;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(tex.image, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const toLin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * toLin(d[i]) + 0.7152 * toLin(d[i + 1]) + 0.0722 * toLin(d[i + 2]);
    }
    out = sum / (N * N);
  } catch { out = fallback; }
  lumCache.set(key, out);
  return out;
}

/** aoMap 吃第二組 UV(three 的 uv1);程序化幾何多半只有 uv,補一份 */
export function ensureUV1(geometry) {
  if (geometry.attributes.uv && !geometry.attributes.uv1) {
    geometry.setAttribute('uv1', geometry.attributes.uv);
  }
  return geometry;
}

// ── HDRI 環境光 ─────────────────────────────────────────
const envCache = new Map();   // id → Promise<Texture|null>
let pmrem = null;

export function loadEnvMap(id, { tonemapped = false } = {}) {
  const cacheKey = `${id}|${tonemapped ? 'tm' : 'auto'}`;
  let p = envCache.get(cacheKey);
  if (p) return p;
  p = (async () => {
    if (!cfg.renderer) { warnMissing(`hdri:${id}(no renderer)`); return null; }
    const m = await getManifest();
    const tier = assetTier();
    const e = manifestEntry(m, id);
    const hdr = (tier === 'desktop' && !tonemapped) ? e?.files?.desktop?.hdr?.path : null;
    const jpg = e?.files?.[tier]?.tonemapped?.path ?? e?.files?.desktop?.tonemapped?.path;
    const path = hdr ?? jpg;
    if (!path) { warnMissing(`hdri:${id}`); return null; }
    try {
      const src = hdr
        ? await new HDRLoader().loadAsync(path)
        : await new THREE.TextureLoader().loadAsync(path);
      if (!hdr) src.colorSpace = THREE.SRGBColorSpace;
      src.mapping = THREE.EquirectangularReflectionMapping;
      if (!pmrem) { pmrem = new THREE.PMREMGenerator(cfg.renderer); pmrem.compileEquirectangularShader(); }
      const env = pmrem.fromEquirectangular(src).texture;
      src.dispose();
      return env;
    } catch (err) {
      warnMissing(`hdri:${id}`, err);
      return null;
    }
  })();
  envCache.set(cacheKey, p);
  return p;
}

// ── 模型(glTF ＋ Draco) ─────────────────────────────────
let gltfLoader = null;
function loader() {
  if (!gltfLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
  }
  return gltfLoader;
}

const modelCache = new Map();   // id → Promise<Object3D|null>

/**
 * 載入 glb,回傳「範本」場景(不要直接加進場景;用 instantiate／collectPrimitives)。
 * kind: 'glb'(預設)或 'glb_hi'(高規版:葉量完整、512² 貼圖,manifest 另外登記)。
 */
export function loadModel(id, { kind = 'glb' } = {}) {
  const cacheKey = `${id}|${kind}`;
  let p = modelCache.get(cacheKey);
  if (p) return p;
  p = (async () => {
    const m = await getManifest();
    const path = manifestPath(m, id, kind)
      ?? (kind === 'glb' ? `/models/${id}.glb` : `/models/${id}_hi.glb`);
    try {
      const gltf = await loader().loadAsync(path);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!mat) continue;
          // §3:roughness 下限 0.35(避免塑膠感)、envMapIntensity 依場次
          if (mat.roughness != null) mat.roughness = Math.max(mat.roughness, 0.35);
          mat.envMapIntensity = cfg.envMapIntensity;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (mat[k]) mat[k].anisotropy = cfg.anisotropy;
          }
          // 葉片是 alphaMode MASK → GLTFLoader 已轉成 alphaTest;確保沒被當半透明排序
          if (mat.alphaTest > 0) mat.transparent = false;
        }
      });
      return root;
    } catch (err) {
      warnMissing(`model:${id}/${kind}`, err);
      return null;
    }
  })();
  modelCache.set(cacheKey, p);
  return p;
}

/**
 * 以「整張 quad(2 個三角形)」為單位抽稀 alpha 卡片幾何 —— 葉片是一片片的卡片,
 * 逐三角形丟會留下半片葉子。位置／法線／UV 直接沿用原幾何的 buffer(GPU 上不複製),
 * 只重建 index → mid 層可以吃同一份高規幾何但只付一部分面數。
 */
export function thinGeometry(geo, keep) {
  if (!(keep > 0) || keep >= 0.999 || !geo.index) return geo;
  const src = geo.index.array;
  const QUAD = 6;
  const quads = Math.floor(src.length / QUAD);
  const out = [];
  let acc = 0;
  for (let q = 0; q < quads; q++) {
    acc += keep;
    if (acc >= 1) { acc -= 1; for (let k = 0; k < QUAD; k++) out.push(src[q * QUAD + k]); }
  }
  for (let i = quads * QUAD; i < src.length; i++) out.push(src[i]);   // 收尾不足一組的照舊
  if (!out.length) return geo;
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) g.setAttribute(name, geo.attributes[name]);
  const Arr = geo.attributes.position.count > 65535 ? Uint32Array : Uint16Array;
  g.setIndex(new THREE.BufferAttribute(new Arr(out), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** 一次載一批,回傳 { id: Object3D|null }(缺件不影響其他) */
export async function loadModels(ids) {
  const out = {};
  await Promise.all(ids.map(async (id) => { out[id] = await loadModel(id); }));
  return out;
}

// ── 幾何工具 ────────────────────────────────────────────
const _box = new THREE.Box3();
const _v = new THREE.Vector3();

/** 範本的包圍盒(世界座標;範本本身 transform 為單位) */
export function modelBox(root) {
  root.updateMatrixWorld(true);
  return _box.setFromObject(root).clone();
}

/** 依「高度對齊」算出縮放係數(與現有程序化模型的 bounding box 對齊,見 §0-4) */
export function scaleForHeight(root, targetHeight) {
  const b = modelBox(root);
  b.getSize(_v);
  return _v.y > 1e-6 ? targetHeight / _v.y : 1;
}

/** 依「水平最長邊」算出縮放係數 */
export function scaleForSpan(root, targetSpan) {
  const b = modelBox(root);
  b.getSize(_v);
  const span = Math.max(_v.x, _v.z);
  return span > 1e-6 ? targetSpan / span : 1;
}

const ATTRS = ['position', 'normal', 'uv'];
function trim(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!ATTRS.includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function paintGeo(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * 把 glb 底下(可排除某些節點)所有 mesh 烘成「單一帶頂點色的幾何」。
 * Blender 產出的模型全部是純色材質(沒有貼圖),所以顏色可以無損搬進頂點色
 * → 一個單位仍然只有一個 draw call,而且材質是每單位一份 → 主迴圈的淡出／變色照舊。
 * matrix:額外的對位矩陣(縮放、轉向)。
 */
export function bakeModel(root, { exclude = [], matrix = null } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p && p !== root; p = p.parent) {
      if (exclude.includes(p.name)) return;
    }
    const g = trim(o.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    paintGeo(g, o.material?.color ?? new THREE.Color(0xffffff));
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  if (!merged) return null;
  if (matrix) merged.applyMatrix4(matrix);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** 只烘某一個具名節點(C-47 的螺旋槳要獨立轉動) */
export function bakeNode(root, name, { matrix = null } = {}) {
  const node = root.getObjectByName(name);
  if (!node) return null;
  root.updateMatrixWorld(true);
  const geos = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const g = trim(o.geometry);
    // 以「節點自身原點」為基準(螺旋槳要繞自己轉)
    const local = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(o.matrixWorld);
    g.applyMatrix4(local);
    paintGeo(g, o.material?.color ?? new THREE.Color(0xffffff));
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  if (!merged) return null;
  if (matrix) merged.applyMatrix4(matrix);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  node.getWorldPosition(_v);
  merged.userData.nodeOrigin = _v.clone();
  return merged;
}

/**
 * 取出 glb 的所有 primitive(幾何已烘進世界 transform、材質沿用)。
 * 給 InstancedMesh 用:植被有葉片 alphaTest 貼圖,不能像上面那樣烘成頂點色。
 */
export function collectPrimitives(root, { matrix = null } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (matrix) g.applyMatrix4(matrix);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

/** 對位矩陣:先縮放到指定高度,再繞 Y 轉(把 glb 的 −Z 正面轉到場景要的方向) */
export function alignMatrix({ scale = 1, rotY = 0, offsetY = 0 } = {}) {
  return new THREE.Matrix4()
    .makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .setPosition(0, offsetY, 0);
}

export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.geometry?.dispose?.();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose?.();
    }
  });
  obj.parent?.remove(obj);
}
