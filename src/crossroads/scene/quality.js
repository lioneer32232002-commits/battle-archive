// R5 畫質分級（docs/realism-spec.md §R5）— 十字路口專用
//
// 為什麼要分級：R4 那條管線（GTAO ＋ 三層 CSM ＋ 景深 ＋ 調色 ＋ SMAA）在獨顯上很便宜，
// 但本機 Intel UHD 內顯量到的是「場景幾何本身」在拖（幾百萬三角形被三層 cascade 重畫三次）。
// 所以不是把後製關掉就好，連植被密度、草叢、陰影層數、pixelRatio 都要一起降 —— 這張表就是那份對照。
//
// 判定順序（啟動時、建場景之前）：
//   ?q=high|medium|low  →  localStorage['battle-quality']  →  UNMASKED_RENDERER 自動判定
// 手機（isMobile）不在此列：維持既有的手機分流參數（tier 回報為 'mobile'）。
//
// 執行期：滾動 3 秒平均幀時間 > 40 ms → 降一級。植被數量與 CSM 層數屬「需重建」，
// 所以降級的作法是「寫 localStorage ＋ 立刻套用可即時切的旋鈕 ＋ location.reload()」。
// 不自動升級（避免振盪）；?q= 明確指定時完全不自動降級（量測與截圖驗收要的是固定畫質）。

export const TIERS = ['high', 'medium', 'low'];
export const TIER_LABEL = { high: '高', medium: '中', low: '低', mobile: '手機' };
export const STORAGE_KEY = 'battle-quality';
export const AUTO_FLAG_KEY = 'battle-quality-auto';

// 內顯／行動 GPU／軟體 renderer → medium 起跳
export const LOW_GPU_RE = /Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i;

/** UNMASKED_RENDERER 字串 → 自動等級（只回 high／medium，low 一律要人工或自動降級才會到） */
export function tierFromRenderer(rendererName) {
  return LOW_GPU_RE.test(String(rendererName || '')) ? 'medium' : 'high';
}

const isTier = (t) => TIERS.includes(t);

/**
 * 純函式版的等級判定（單元測試打這支）。
 * @param {{query?:string, stored?:string, renderer?:string}} src
 * @returns {{tier:string, forced:boolean, source:string}}
 */
export function resolveTier({ query = '', stored = '', renderer = '' } = {}) {
  if (isTier(query)) return { tier: query, forced: true, source: 'query' };
  if (isTier(stored)) return { tier: stored, forced: false, source: 'storage' };
  return { tier: tierFromRenderer(renderer), forced: false, source: 'renderer' };
}

/** 下一級（循環用：高 → 中 → 低 → 高） */
export function cycleTier(tier) {
  const i = TIERS.indexOf(tier);
  return TIERS[(i + 1) % TIERS.length];
}
/** 降一級（已經在 low 就停在 low，回傳 null 表示不能再降） */
export function lowerTier(tier) {
  const i = TIERS.indexOf(tier);
  return i < 0 || i >= TIERS.length - 1 ? null : TIERS[i + 1];
}

/**
 * 三級參數表（R5 §2）。所有建構函式吃這裡的值，不再各自讀 isMobile。
 * @param {string} tier 'high'|'medium'|'low'
 * @param {{mobile?:boolean}} opts
 */
export function qualityParams(tier, { mobile = false } = {}) {
  if (mobile) {
    // 手機：維持既有分流（無陰影、無後製、植被不換 glb、無草叢、雲霧半量）
    return {
      tier: 'mobile', mobile: true,
      pixelRatioCap: 1.5,
      shadows: false, shadowMode: 'none', csm: null, shadowMapSize: 0,
      postfx: false,
      passes: { gtao: false, bloom: false, smaa: false, bokeh: false },
      gtaoScale: 0.5, bloomScale: 1,
      vegetation: { glb: false, heroHi: false, midFactor: 0, willowFactor: 0, farFactor: 0.5 },
      grassFactor: 0,
      particleFactor: 0.5,
      cloudFactor: 0.5, mistFactor: 0.5,
      mixerStride: 2,
      baked: false,
      textureScale: 0.5,
    };
  }
  const t = isTier(tier) ? tier : 'high';
  const base = {
    tier: t, mobile: false,
    textureScale: 1,
    vegetation: { glb: true, heroHi: true, midFactor: 1, willowFactor: 1, farFactor: 1 },
  };
  if (t === 'high') {
    return {
      ...base,
      pixelRatioCap: 2,
      shadows: true, shadowMode: 'csm', csm: { cascades: 3, mapSize: 2048 }, shadowMapSize: 2048,
      postfx: true,
      passes: { gtao: true, bloom: true, smaa: true, bokeh: true },
      gtaoScale: 0.5, bloomScale: 1,
      grassFactor: 1,
      particleFactor: 1,
      cloudFactor: 1, mistFactor: 1,
      mixerStride: 1,
      baked: true,
    };
  }
  if (t === 'medium') {
    return {
      ...base,
      pixelRatioCap: 1.25,
      shadows: true, shadowMode: 'csm', csm: { cascades: 2, mapSize: 1536 }, shadowMapSize: 1536,
      postfx: true,
      passes: { gtao: false, bloom: true, smaa: true, bokeh: true },
      gtaoScale: 0.5, bloomScale: 0.5,
      // hero 樹改一般版（不吃 _hi 的全幾何）、mid 樹與草叢半量
      vegetation: { glb: true, heroHi: false, midFactor: 0.5, willowFactor: 0.5, farFactor: 1 },
      grassFactor: 0.5,
      particleFactor: 0.6,
      cloudFactor: 0.6, mistFactor: 0.6,
      mixerStride: 2,
      baked: true,
    };
  }
  return {
    ...base,
    pixelRatioCap: 1,
    // 單張正交 1024（既有 legacy 路徑）
    shadows: true, shadowMode: 'ortho', csm: null, shadowMapSize: 1024,
    postfx: true,   // 只留 OutputPass ＋ 調色（沒有 composer 的話連 ACES 都吃不到，見 postfx.js 檔頭）
    passes: { gtao: false, bloom: false, smaa: false, bokeh: false },
    gtaoScale: 0.5, bloomScale: 0.5,
    // hero 植被回到程序化（完全不載 glb 樹）、mid 與草叢無
    vegetation: { glb: false, heroHi: false, midFactor: 0, willowFactor: 0, farFactor: 1 },
    grassFactor: 0,
    particleFactor: 0.4,
    cloudFactor: 0.4, mistFactor: 0.4,
    mixerStride: 3,
    baked: false,
  };
}

// ── 瀏覽器端環境存取（node/vitest 下全部安全 no-op） ──────────────
function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}
export function readStoredTier() {
  const s = safeStorage();
  try { return s?.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}
export function writeStoredTier(tier) {
  const s = safeStorage();
  try { s?.setItem(STORAGE_KEY, tier); } catch { /* 私密模式：記不住就算了 */ }
}
function queryTier() {
  try {
    if (typeof location === 'undefined') return '';
    return new URLSearchParams(location.search).get('q') ?? '';
  } catch { return ''; }
}

/** 從 WebGL context 問出顯示卡名稱（拿不到就回空字串，判定會落到 high） */
export function rendererName(gl) {
  try {
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
    return String(gl.getParameter(gl.RENDERER) ?? '');
  } catch { return ''; }
}

const listeners = new Set();
let current = null;

/**
 * 取得（並在第一次呼叫時決定）本次載入的畫質等級。
 * ⚠ 必須在建場景之前呼叫：CSM 層數、植被數量這些是建構期參數。
 * @param {{gl?:WebGLRenderingContext, mobile?:boolean}} opts
 */
export function getQuality({ gl = null, mobile = false } = {}) {
  if (current) return current;
  const resolved = resolveTier({
    query: queryTier(), stored: readStoredTier(), renderer: rendererName(gl),
  });
  const params = qualityParams(resolved.tier, { mobile });
  current = {
    ...params,
    // 手機不進分級表，但仍記得「桌機會是哪一級」，切回桌機寬度時才有東西可循環
    desktopTier: resolved.tier,
    forced: resolved.forced,
    source: mobile ? 'mobile' : resolved.source,
    // ?q= 指定或手機 → 不自動降級
    autoDowngrade: !resolved.forced && !mobile,
  };
  return current;
}

/** 測試／熱更新用：清掉記住的判定 */
export function resetQuality() { current = null; listeners.clear(); }

export function onQualityChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(tier, reason) {
  for (const cb of listeners) {
    try { cb(tier, reason); } catch (err) { console.warn('[quality] listener 失敗', err); }
  }
}

/**
 * 切換等級：寫 localStorage 後重載（植被數量／CSM 層數是建構期參數，重建不如重載乾淨）。
 * @param {string} tier
 * @param {{reload?:boolean, reason?:string}} opts
 */
export function setQuality(tier, { reload = true, reason = 'user' } = {}) {
  if (!isTier(tier)) return false;
  writeStoredTier(tier);
  emit(tier, reason);
  if (reload && typeof location !== 'undefined' && typeof location.reload === 'function') {
    // ?q= 會蓋過 localStorage，切換後要把它拿掉，否則按了沒反應
    try {
      const url = new URL(location.href);
      if (url.searchParams.has('q')) {
        url.searchParams.set('q', tier);
        location.replace(url.toString());
        return true;
      }
    } catch { /* 退回單純 reload */ }
    location.reload();
  }
  return true;
}

/**
 * 幀時間監看：連續 3 秒平均 > 40 ms → 降一級。
 * 呼叫端每幀給 dt（秒）；量測期間（__dbg.dbgPerf／freezeQuality）要自己 pause。
 * @param {{tier:string, enabled?:boolean, window?:number, budgetMs?:number, warmup?:number,
 *          onDowngrade?:(next:string)=>void}} opts
 */
export function createFrameWatcher({
  tier, enabled = true, window: win = 3, budgetMs = 40, warmup = 3, onDowngrade = null,
} = {}) {
  let acc = 0, frames = 0, warm = 0, paused = false, done = false;
  return {
    /** @returns {string|null} 觸發降級時回傳新等級 */
    sample(dt) {
      if (!enabled || paused || done || !(dt > 0)) return null;
      if (warm < warmup) { warm += dt; return null; }   // 開場的 shader 編譯尖峰不算
      acc += dt; frames++;
      if (acc < win) return null;
      const avgMs = (acc / frames) * 1000;
      acc = 0; frames = 0;
      if (avgMs <= budgetMs) return null;
      const next = lowerTier(tier);
      if (!next) { done = true; return null; }          // 已經在 low，不再測
      done = true;
      if (onDowngrade) onDowngrade(next, avgMs);
      return next;
    },
    setPaused(v) { paused = !!v; if (v) { acc = 0; frames = 0; } },
    isDone: () => done,
  };
}

/** 這次載入是不是「自動降級後的重載」（HUD 想提示時可用） */
export function consumeAutoDowngradeFlag() {
  try {
    if (typeof sessionStorage === 'undefined') return '';
    const v = sessionStorage.getItem(AUTO_FLAG_KEY) ?? '';
    if (v) sessionStorage.removeItem(AUTO_FLAG_KEY);
    return v;
  } catch { return ''; }
}
export function markAutoDowngrade(tier) {
  // 連環重載不可能發生：low 已經是最低級，watcher 到 low 就 done。
  try { sessionStorage?.setItem(AUTO_FLAG_KEY, tier); } catch { /* ignore */ }
}
