// 畫質分級(docs/realism-spec.md §R5)— 中途島
//
// 為什麼要分級:R4 的渲染層(GTAO ＋ 三層 CSM ＋ 景深 ＋ SMAA)在獨顯上很划算,
// 在 Intel 內顯上單幀會直接破 40 ms。本場最貴的不是後製,而是「場景幾何本身」:
// 190×190 的海面網格(≈ 72k 頂點、每頂點跑 6 波)、200 片雲、19 艘船 × 40 顆尾流白沫,
// 再被三層 cascade 各重畫一次。所以分級要同時砍幾何與後製,只砍後製沒有用。
//
// 判定順序(§R5.1):?q=high|medium|low → localStorage['battle-quality'] → 自動判定。
// 自動判定看 WEBGL_debug_renderer_info 的 UNMASKED_RENDERER:內顯／行動 GPU → medium。
// 執行期滾動平均幀時間連續 3 秒 > 40 ms → 降一級(不自動升,避免振盪)。
//
// 對外介面(§R5.3):
//   getQuality()            → { tier, label, ...參數 }(建場景前就可呼叫)
//   onQualityChange(cb)     → 降級／切換時以新參數呼叫(可即時切的旋鈕)
//   cycleQuality()          → HUD 按鈕:高 → 中 → 低 → 高,寫 localStorage 後 reload
//   sampleFrame(dt)         → 每幀餵幀時間,回傳 true 表示這一幀觸發了降級
//   setAutoDowngrade(on)    → 量測／截圖期間關掉自動降級
//
// 「需重建」的項目(海面細分、雲數、尾流顆數、椰子樹、CSM 層數、composer 組成)
// 一律走「寫 localStorage → location.reload()」(§R5.3 明確允許,簡單可靠);
// 可即時切的旋鈕(GTAO、pixelRatio、景深、SMAA)在 reload 之前就先套用,
// 讓使用者在重載前的那一瞬間就已經比較順。

export const TIERS = ['high', 'medium', 'low'];
export const TIER_LABEL = { high: '高', medium: '中', low: '低' };
export const STORE_KEY = 'battle-quality';

// 內顯／行動 GPU:R5 §1 指定的字串比對
const SOFT_GPU = /Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i;

// ── 三級參數表(§R5.2,對應到中途島實際有的旋鈕) ───────────────────
const PARAMS = {
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    // 後製
    gtao: true, gtaoScale: 0.5,
    bloom: true, bloomScale: 1,
    bokeh: true, smaa: true,
    // 陰影:CSM 3 層 2048
    csm: true, cascades: 3, shadowMapSize: 2048, shadowMaxFar: 3500,
    // 幾何
    oceanSegments: 190,
    cloudScale: 1,
    wakePerShip: 40, wakeFoamSeg: 2,
    palms: 56,
    atollTexture: 2048,
    anisotropy: 8,
    // 資產:烘焙版艦艇(單一材質＋四張貼圖)
    bakedShips: true,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.25,
    gtao: false, gtaoScale: 0.5,
    bloom: true, bloomScale: 0.5,
    bokeh: true, smaa: true,
    csm: true, cascades: 2, shadowMapSize: 1536, shadowMaxFar: 3000,
    oceanSegments: 140,
    cloudScale: 0.6,
    wakePerShip: 26, wakeFoamSeg: 2,
    palms: 34,
    atollTexture: 1024,
    anisotropy: 4,
    bakedShips: true,
  },
  low: {
    tier: 'low',
    pixelRatioCap: 1,
    gtao: false, gtaoScale: 0.25,
    bloom: false, bloomScale: 0.5,
    bokeh: false, smaa: false,
    // low:回到升級前的單張正交陰影(environment.js 的 legacy 路徑)
    csm: false, cascades: 1, shadowMapSize: 1024, shadowMaxFar: 3000,
    oceanSegments: 100,
    cloudScale: 0.4,
    wakePerShip: 16, wakeFoamSeg: 1,
    palms: 22,
    atollTexture: 1024,
    anisotropy: 2,
    // low 與手機維持平塗版艦艇(§R6:烘焙版單檔 ≈ 100 KB,七艘約 +620 KB)
    bakedShips: false,
  },
};

// 手機不在三級之列(§R5.1),維持既有行為:參數以 low 為底,但雲／尾流沿用原本的手機值
const MOBILE_PARAMS = {
  ...PARAMS.low,
  tier: 'mobile',
  pixelRatioCap: 1.5,
  oceanSegments: 110,
  cloudScale: 0.5,
  wakePerShip: 16,
  palms: 30,
  atollTexture: 1024,
  bakedShips: false,
};

/** 參數表查詢(純函式,供測試用)。 */
export function qualityParams(tier) {
  if (tier === 'mobile') return { ...MOBILE_PARAMS };
  return { ...(PARAMS[tier] ?? PARAMS.high) };
}

/** 降一級;已是最低則回傳 null。 */
export function lowerTier(tier) {
  const i = TIERS.indexOf(tier);
  if (i < 0 || i >= TIERS.length - 1) return null;
  return TIERS[i + 1];
}

/** 循環:高 → 中 → 低 → 高。 */
export function nextTier(tier) {
  const i = TIERS.indexOf(tier);
  return TIERS[(i < 0 ? 0 : i + 1) % TIERS.length];
}

/** UNMASKED_RENDERER 字串 → 自動等級(§R5.1)。 */
export function autoTier(rendererString) {
  return SOFT_GPU.test(String(rendererString ?? '')) ? 'medium' : 'high';
}

/**
 * 判定等級(純函式版,便於測試)。
 * @param {object} o
 * @param {string} [o.search]          location.search
 * @param {string|null} [o.stored]     localStorage 值
 * @param {string} [o.rendererString]  UNMASKED_RENDERER
 * @param {boolean} [o.mobile]
 */
export function resolveTier({ search = '', stored = null, rendererString = '', mobile = false } = {}) {
  if (mobile) return 'mobile';
  const m = /[?&]q=(high|medium|low)\b/i.exec(search);
  if (m) return m[1].toLowerCase();
  if (stored && TIERS.includes(stored)) return stored;
  return autoTier(rendererString);
}

/**
 * 幀時間看門狗(§R5.1):滾動平均幀時間連續 holdS 秒 > thresholdMs → 觸發一次降級。
 *
 * ⚠ 這裡刻意用「每 bucketS 秒結算一次平均」而不是指數平滑:指數平滑的權重是
 *   「按時間」算的,一個 300 ms 的 GC 尖峰會一口氣把平均拉到 190 ms,再花 40 幀
 *   才降得回來 —— 明明是 45 fps 的畫面卻被判成該降級。分桶取「總時間 ÷ 幀數」
 *   才是真正的平均幀時間,單幀尖峰只會被攤平。
 */
export class FrameWatch {
  constructor({ thresholdMs = 40, holdS = 3, bucketS = 1 } = {}) {
    this.thresholdMs = thresholdMs;
    this.holdS = holdS;
    this.bucketS = bucketS;
    this.avgMs = null;   // 最近一個結算完的桶
    this.overS = 0;
    this._t = 0;
    this._n = 0;
  }

  reset() {
    this.avgMs = null;
    this.overS = 0;
    this._t = 0;
    this._n = 0;
  }

  /** @param {number} dt 這一幀的秒數 → 回傳 true 表示觸發降級 */
  sample(dt) {
    if (!(dt > 0)) return false;
    this._t += dt;
    this._n++;
    if (this._t < this.bucketS) return false;
    const bucket = this._t;
    this.avgMs = (this._t / this._n) * 1000;
    this._t = 0;
    this._n = 0;
    if (this.avgMs > this.thresholdMs) {
      this.overS += bucket;
      if (this.overS >= this.holdS) {
        this.overS = 0;
        return true;
      }
    } else {
      this.overS = 0;
    }
    return false;
  }
}

// ── 執行期單例 ────────────────────────────────────────────────
function readStore() {
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;   // 私密模式／被擋 cookie:當作沒設定過
  }
}

function writeStore(tier) {
  try {
    window.localStorage.setItem(STORE_KEY, tier);
  } catch {
    /* 寫不進去就只在本次生效 */
  }
}

// 開一個拋棄式 GL context 問 GPU 型號:這一步必須在建 renderer／場景之前就能跑,
// 所以不依賴外面傳進來的 renderer。問完立刻 loseContext,不留第二個 context。
function probeRenderer() {
  if (typeof document === 'undefined') return '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(s ?? '');
  } catch {
    return '';
  }
}

let state = null;
const listeners = new Set();

/** 啟動時呼叫一次(建場景之前)。回傳參數物件。 */
export function initQuality({ mobile = false } = {}) {
  if (state) return state.params;
  const pinned = /[?&]q=(high|medium|low)\b/i.test(typeof location === 'undefined' ? '' : location.search);
  const tier = resolveTier({
    search: typeof location === 'undefined' ? '' : location.search,
    stored: readStore(),
    rendererString: probeRenderer(),
    mobile,
  });
  state = {
    tier,
    params: { ...qualityParams(tier), label: TIER_LABEL[tier] ?? '高' },
    mobile,
    pinned,                 // ?q= 指定過就不自動降級(量測／截圖用)
    auto: !pinned && !mobile,
    watch: new FrameWatch(),
    downgraded: false,
  };
  return state.params;
}

/** 取得目前參數(未 init 時以桌機 high 為底,不會炸)。 */
export function getQuality() {
  if (!state) return { ...qualityParams('high'), label: TIER_LABEL.high };
  return state.params;
}

export function getTier() {
  return state ? state.tier : 'high';
}

export function onQualityChange(cb) {
  if (typeof cb === 'function') listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(params) {
  for (const cb of listeners) {
    try {
      cb(params);
    } catch (e) {
      console.warn('[midway/quality] onQualityChange 回呼失敗', e);
    }
  }
}

/**
 * 切換等級:先把「可即時切」的旋鈕套下去(讓重載前那一瞬間就變順),
 * 寫進 localStorage,再整頁重載讓需重建的項目(海面細分／雲／CSM 層數)生效。
 */
export function applyTier(tier, { reload = true } = {}) {
  if (!state || !TIERS.includes(tier)) return null;
  state.tier = tier;
  state.params = { ...qualityParams(tier), label: TIER_LABEL[tier] };
  writeStore(tier);
  emit(state.params);
  if (reload && typeof location !== 'undefined' && typeof location.reload === 'function') {
    location.reload();
  }
  return state.params;
}

/** HUD 按鈕:高 → 中 → 低 → 高。 */
export function cycleQuality() {
  if (!state) return null;
  return applyTier(nextTier(state.tier));
}

/** 量測／截圖期間關掉自動降級(__dbg.freezeQuality 會呼叫)。 */
export function setAutoDowngrade(on) {
  if (!state) return;
  state.auto = !!on && !state.pinned && !state.mobile;
  state.watch.reset();
}

/**
 * 每幀餵幀時間。連續 3 秒平均 > 40 ms 就降一級(一次載入只降一次,降完就重載)。
 * @returns {boolean} 這一幀是否觸發降級
 */
export function sampleFrame(dt) {
  if (!state || !state.auto || state.downgraded) return false;
  if (!state.watch.sample(dt)) return false;
  const next = lowerTier(state.tier);
  if (!next) {
    state.auto = false;   // 已經最低,不再量
    return false;
  }
  state.downgraded = true;
  console.info(`[midway/quality] 幀時間連續 3 秒 > 40 ms,畫質 ${state.tier} → ${next}`);
  applyTier(next);
  return true;
}

// 測試用:重設單例
export function __resetQuality() {
  state = null;
  listeners.clear();
}
