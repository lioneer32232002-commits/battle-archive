// 畫質分級（docs/realism-spec.md §R5）— 卡倫坦
// ─────────────────────────────────────────────────────────────
// 背景：R4 渲染層（GTAO＋CSM 三層＋景深＋調色＋SMAA）在獨顯上很好看，在 Intel 內顯上
//   單幀會到 50 ms。重的不是後製本身，而是場景幾何（hero 植被上萬面 ×N、三層 cascade
//   把整個核心區重畫三次）。所以分三級，並在執行期自動降級。
//
// 判定順序（§R5.1）：?q=high|medium|low → localStorage['battle-quality'] → 自動判定
//   （UNMASKED_RENDERER 命中 Intel／Iris／UHD／Apple GPU／Mali／Adreno／SwiftShader／
//   llvmpipe → medium，其餘 high）。手機不在此列：手機一律走 low 的參數，但各模組原本
//   的 mobile 分支優先（例如 pixelRatio 上限仍是 1.5、植被本來就是程序化）。
//
// 用法：
//   const quality = getQuality({ mobile });      // 建場景「之前」呼叫一次
//   createXxx(scene, { quality });               // 所有建構函式吃參數，不要各自讀 isMobile
//   onQualityChange((q) => { ... });             // 即時旋鈕（不需重建的）
//   const auto = createAutoDowngrade({ ... });   // 每幀 auto.sample(dt)
//
// ⚠ 需重建的項目（CSM 層數、composer 組成、植被數量）降級時直接寫 localStorage 後
//   location.reload() —— 簡單可靠，且下次載入就記住了（§R5.3）。

const STORAGE_KEY = 'battle-quality';
const ORDER = ['high', 'medium', 'low'];

// ── 三級參數表（§R5.2）────────────────────────────────────────
export const TIERS = {
  high: {
    tier: 'high',
    label: '高',
    // 後製
    gtao: true, gtaoScale: 0.5,
    bloom: true, bloomScale: 1,
    bokeh: true, smaa: true,
    // 陰影
    shadow: 'csm', cascades: 3, shadowMapSize: 2048,
    // 解析度
    pixelRatio: 2,
    // 植被
    heroVegetation: 'hi',    // 'hi' = glb_hi 全幾何｜'normal' = 一般 glb｜'none' = 程序化
    vegetationDetail: 1,     // far 植被的抽稀比例
    grassDetail: 1,          // 草叢比例（0 = 不建）
    // 粒子與雲
    particleDensity: 1,
    cloudDensity: 1,
    // 士兵骨架動畫：mixer 更新間隔（幀）
    mixerStride: 1,
    // 模型：桌機 high／medium 優先載 <id>_baked.glb（Cycles 舊化烘焙版）
    baked: true,
    // 市鎮建築：Poly Haven 牆面／屋頂 PBR（法線＋AO＋粗糙度）
    buildingPBR: true,
  },
  medium: {
    tier: 'medium',
    label: '中',
    gtao: false, gtaoScale: 0.5,
    bloom: true, bloomScale: 0.5,
    bokeh: true, smaa: true,
    shadow: 'csm', cascades: 2, shadowMapSize: 1536,
    pixelRatio: 1.25,
    heroVegetation: 'normal',
    vegetationDetail: 0.5,
    grassDetail: 0.5,
    particleDensity: 0.6,
    cloudDensity: 0.6,
    mixerStride: 2,
    baked: true,
    buildingPBR: true,
  },
  low: {
    tier: 'low',
    label: '低',
    gtao: false, gtaoScale: 0.25,
    bloom: false, bloomScale: 0.5,
    bokeh: false, smaa: false,
    shadow: 'legacy', cascades: 0, shadowMapSize: 1024,
    pixelRatio: 1,
    heroVegetation: 'none',
    vegetationDetail: 0,
    grassDetail: 0,
    particleDensity: 0.4,
    cloudDensity: 0.4,
    mixerStride: 3,
    baked: false,
    buildingPBR: false,
  },
};

// 「需要重建場景」的欄位：這些變了就只能 reload（§R5.3）
const REBUILD_KEYS = [
  'shadow', 'cascades', 'shadowMapSize',
  'gtao', 'bloom', 'bokeh', 'smaa',
  'heroVegetation', 'vegetationDetail', 'grassDetail',
  'cloudDensity', 'baked', 'buildingPBR',
];

export function needsRebuild(a, b) {
  if (!a || !b) return true;
  return REBUILD_KEYS.some((k) => TIERS[a]?.[k] !== TIERS[b]?.[k]);
}

export function nextTier(tier, delta = 1) {
  const i = ORDER.indexOf(tier);
  if (i < 0) return tier;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + delta))];
}

// 顯示卡黑名單（§R5.1）：內顯／行動 GPU／軟體渲染 → medium
export const WEAK_GPU = /Intel|Iris|UHD|HD Graphics|Apple GPU|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Microsoft Basic/i;

export function tierFromRenderer(renderer) {
  if (!renderer) return 'high';
  return WEAK_GPU.test(renderer) ? 'medium' : 'high';
}

// 純函式版判定（可單元測試）：query > localStorage > GPU 字串
export function resolveTier({ query = null, stored = null, renderer = null } = {}) {
  if (query && TIERS[query]) return { tier: query, source: 'query' };
  if (stored && TIERS[stored]) return { tier: stored, source: 'storage' };
  return { tier: tierFromRenderer(renderer), source: 'auto' };
}

// ── 瀏覽器端偵測 ──────────────────────────────────────────────
function readQuery() {
  try { return new URLSearchParams(location.search).get('q'); } catch { return null; }
}
function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(tier) {
  try { localStorage.setItem(STORAGE_KEY, tier); } catch { /* 無痕模式：記不住就算了 */ }
}

// UNMASKED_RENDERER 要開一個一次性的 WebGL context（建 renderer 之前也能用）
export function detectRendererString() {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

let current = null;
let currentSource = null;
let rendererString = null;
const listeners = new Set();

/** 建場景之前呼叫一次；之後任何地方再呼叫都回同一份（冪等）。 */
export function getQuality({ mobile = false, force = null } = {}) {
  if (current && !force) return current;
  const tier = force
    ?? (mobile
      ? (TIERS[readQuery()] ? readQuery() : 'low')   // 手機：一律低，除非 QA 用 ?q= 指定
      : resolveTier({
        query: readQuery(),
        stored: readStored(),
        renderer: (rendererString = detectRendererString()),
      }).tier);
  currentSource = force ? 'forced' : (readQuery() && TIERS[readQuery()] ? 'query' : (readStored() && TIERS[readStored()] ? 'storage' : 'auto'));
  current = { ...TIERS[tier], mobile, gpu: rendererString, source: currentSource };
  return current;
}

export function qualityTier() { return current?.tier ?? null; }
export function qualitySource() { return currentSource; }

export function onQualityChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb(current); } catch (e) { console.warn('[carentan] 畫質切換回呼失敗', e); }
  }
}

/**
 * 切到指定等級。需重建的欄位有差 → 寫 localStorage 後 reload；
 * 只有即時旋鈕有差 → 直接改參數並通知 listeners。
 */
export function setQuality(tier, { reload = true } = {}) {
  if (!TIERS[tier] || tier === current?.tier) return false;
  const from = current?.tier;
  writeStored(tier);
  if (reload && needsRebuild(from, tier) && typeof location !== 'undefined') {
    location.reload();
    return true;
  }
  current = { ...TIERS[tier], mobile: current?.mobile ?? false, gpu: rendererString, source: 'forced' };
  emit();
  return true;
}

/** HUD 的「畫質：高／中／低」小按鈕：高 → 中 → 低 → 高 */
export function cycleQuality() {
  const i = ORDER.indexOf(current?.tier ?? 'high');
  const tier = ORDER[(i + 1) % ORDER.length];
  setQuality(tier);
  return tier;
}

/**
 * 執行期自動降級（§R5.1）：滾動平均幀時間連續 window 秒 > 40 ms → 降一級。
 * 只降不升（避免振盪），下次載入由 localStorage 記憶。
 * @param {object} o
 * @param {() => boolean} [o.paused]   量測／截圖期間凍結（__dbg.freezeQuality）
 * @param {(q) => void} [o.onInstant]  降級瞬間先動「可即時切換」的旋鈕
 */
export function createAutoDowngrade({
  paused = () => false, onInstant = null, thresholdMs = 40, window: win = 3, reload = true,
  // ?q= 是 QA 的明示覆寫：不自動降級（否則「降級 → reload → ?q= 又拉回去」會無限重載）
  enabled = currentSource !== 'query',
} = {}) {
  let acc = 0, frames = 0, badFor = 0, done = !enabled;
  return {
    sample(dt) {
      if (done || paused()) { acc = 0; frames = 0; badFor = 0; return; }
      acc += dt; frames++;
      if (acc < 0.5) return;                 // 每 0.5 秒結算一次滾動平均
      const avgMs = (acc / frames) * 1000;
      badFor = avgMs > thresholdMs ? badFor + acc : 0;
      acc = 0; frames = 0;
      if (badFor < win) return;
      badFor = 0;
      const to = nextTier(current?.tier ?? 'high', 1);
      if (to === current?.tier) { done = true; return; }   // 已經是 low
      console.info(`[carentan] 幀時間連續 ${win} 秒 > ${thresholdMs} ms → 畫質降到「${TIERS[to].label}」`);
      // 先動即時旋鈕（reload 之前畫面就會先變順）
      const instant = { ...TIERS[to], mobile: current?.mobile ?? false, gpu: rendererString, source: 'auto-down' };
      const rebuild = needsRebuild(current?.tier, to);
      current = instant;
      onInstant?.(current);
      emit();
      writeStored(to);
      if (rebuild && reload && typeof location !== 'undefined') { done = true; location.reload(); }
    },
    reset() { acc = 0; frames = 0; badFor = 0; },
  };
}

// 測試用：清掉模組內的單例狀態
export function __resetQuality() { current = null; currentSource = null; rendererString = null; listeners.clear(); }
