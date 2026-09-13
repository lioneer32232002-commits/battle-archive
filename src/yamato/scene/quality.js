// 畫質分級(docs/realism-spec.md §R5)— 天號作戰
//
// 為什麼要有這一層:R4 的新管線(GTAO ＋ CSM 三層 ＋ 景深 ＋ SMAA)在獨顯上很划算,
// 在 Intel 內顯上卻會把單幀推到 50 ms 以上。重的其實不是後製,是場景本身
// (海面 220×220 網格、上百片雲、三層 cascade 要把整個場景重畫三次)。
// 所以「桌機 = 一套參數」行不通,必須依顯示卡等級分三級,並在執行期自動降級。
//
// 本模組是**全場唯一的畫質真源**:所有建構函式改吃 `getQuality()` 的參數,
// 不再各自讀 `isMobile`。手機維持既有行為(自成一個 preset,不參與自動降級)。
//
// 判定順序(§R5.1):`?q=high|medium|low` → localStorage['battle-quality'] → 依 GPU 自動判定。
// 執行期:滾動平均幀時間連續 3 秒 > 40 ms → 降一級(不自動升級,避免振盪)。
// 降級順序(§R5.1、§R4.6):先動「可即時切換的旋鈕」(GTAO 解析度 → 關 GTAO → pixelRatio,
// 這一段由 main.js 的動態解析度階梯負責),那一段用盡了才換級 —— 換級要重建海面網格、雲、
// CSM 層數,所以寫進 localStorage 後直接 `location.reload()`(規格允許,簡單可靠)。

const KEY = 'battle-quality';
const TIERS = ['high', 'medium', 'low'];
const LABELS = { high: '高', medium: '中', low: '低' };

// 自動降級門檻:滾動平均幀時間連續 SLOW_HOLD 秒超過 SLOW_MS 就降一級
const SLOW_MS = 40;
const SLOW_HOLD = 3;

// ── 三級參數表(§R5.2,海戰版) ───────────────────────────
// 「hero／mid 植被、草叢、士兵 mixer」是陸戰的旋鈕,海戰換成等價的量體:
// 海面網格密度與浪峰白沫、雲片數、粒子池容量、尾流片數、機隊密度。
const PRESETS = {
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    shadows: true,
    csm: { cascades: 3, shadowMapSize: 2048, maxFar: 3500 },
    legacyShadowMapSize: 2048,
    postfx: true,
    passes: { gtao: true, bokeh: true, bloom: true, smaa: true },
    gtaoScale: 0.5,
    bloomScale: 1,
    ocean: { segments: 220, foam: true },
    clouds: { low: 56, high: 46, band: 70 },
    particles: { add: 760, norm: 900 },
    wake: { perShip: 40, decals: 260, max: 900 },
    contrailMax: 260,
    crashPlanes: 4,
    airDensity: 3,
    bakedModels: true,
    reducedFx: false,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.25,
    shadows: true,
    csm: { cascades: 2, shadowMapSize: 1536, maxFar: 3500 },
    legacyShadowMapSize: 2048,
    postfx: true,
    // §R5.2:medium 關 GTAO(最貴的一關:G-buffer 要把場景重畫一次),bloom 降半解析度
    passes: { gtao: false, bokeh: true, bloom: true, smaa: true },
    gtaoScale: 0.5,
    bloomScale: 0.5,
    ocean: { segments: 160, foam: true },
    clouds: { low: 34, high: 28, band: 42 },
    particles: { add: 456, norm: 540 },
    wake: { perShip: 24, decals: 156, max: 540 },
    contrailMax: 156,
    crashPlanes: 3,
    airDensity: 2.2,
    bakedModels: true,
    reducedFx: false,
  },
  low: {
    tier: 'low',
    pixelRatioCap: 1,
    shadows: true,
    csm: null,                    // 退回既有的單張正交陰影 legacy 路徑
    legacyShadowMapSize: 1024,
    postfx: true,                 // 只留 OutputPass ＋ 調色(暗角顆粒是本場的視覺簽名,不能拿掉)
    passes: { gtao: false, bokeh: false, bloom: false, smaa: false },
    gtaoScale: 0.5,
    bloomScale: 0.5,
    ocean: { segments: 110, foam: false },
    clouds: { low: 22, high: 18, band: 28 },
    particles: { add: 304, norm: 360 },
    wake: { perShip: 16, decals: 104, max: 360 },
    contrailMax: 104,
    crashPlanes: 2,
    airDensity: 1.6,
    bakedModels: false,           // §R6:low 與手機用平塗版
    reducedFx: true,
  },
  // 手機:維持 2026-09-12 既有數值,不參與自動降級,也不顯示畫質按鈕
  mobile: {
    tier: 'mobile',
    pixelRatioCap: 1.5,
    shadows: false,
    csm: null,
    legacyShadowMapSize: 1024,
    postfx: false,
    passes: { gtao: false, bokeh: false, bloom: false, smaa: false },
    gtaoScale: 0.5,
    bloomScale: 0.5,
    ocean: { segments: 140, foam: true },
    clouds: { low: 28, high: 22, band: 34 },
    particles: { add: 260, norm: 320 },
    wake: { perShip: 16, decals: 90, max: 380 },
    contrailMax: 90,
    crashPlanes: 2,
    airDensity: 1.6,
    bakedModels: false,
    reducedFx: true,
  },
};

// ── 判定 ────────────────────────────────────────────────
const SLOW_GPU = /Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i;

/** UNMASKED_RENDERER 命中內顯／行動 GPU → medium,其餘 → high(§R5.1) */
export function tierFromGPU(rendererName) {
  if (!rendererName) return 'high';
  return SLOW_GPU.test(rendererName) ? 'medium' : 'high';
}

function gpuName(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    return '';
  }
}

function readStore() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;   // 隱私模式／第三方 cookie 封鎖:當作沒設過
  }
}

function writeStore(tier) {
  try {
    localStorage.setItem(KEY, tier);
  } catch { /* 寫不進去就算了,下次載入重新自動判定 */ }
}

/** 解析 `?q=` 覆寫(刻意不寫進 localStorage:QA 用完就恢復原本的記憶值) */
export function tierFromQuery(search = '') {
  const m = /[?&]q=(high|medium|low)\b/i.exec(search);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 依 §R5.1 的順序決定等級:query → localStorage → GPU 自動判定。
 * 手機不在此列(直接回 'mobile')。
 */
export function resolveTier({ mobile = false, search = '', stored = null, renderer = '' } = {}) {
  if (mobile) return 'mobile';
  const q = tierFromQuery(search);
  if (q) return q;
  if (stored && TIERS.includes(stored)) return stored;
  return tierFromGPU(renderer);
}

// ── 單例 ────────────────────────────────────────────────
let current = null;
const listeners = new Set();

/** 建場景之前呼叫一次(main.js);renderer 只用來讀 UNMASKED_RENDERER */
export function initQuality({ mobile = false, renderer = null } = {}) {
  const tier = resolveTier({
    mobile,
    search: typeof location !== 'undefined' ? location.search : '',
    stored: readStore(),
    renderer: gpuName(renderer),
  });
  current = { ...PRESETS[tier] ?? PRESETS.high, mobile };
  return current;
}

/** 目前這一輪的畫質參數(未 init 過就給 high,單元測試不必先 init) */
export function getQuality() {
  return current ?? PRESETS.high;
}

export function qualityLabel(tier = getQuality().tier) {
  return LABELS[tier] ?? '';
}

/** 等級換了會被叫到(HUD 標籤、可即時切換的旋鈕);重建型的項目由 reload 負責 */
export function onQualityChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 換級:寫 localStorage → 通知監聽者 → reload。
 * 海面網格密度、雲片數、CSM 層數都是「需重建」的項目,規格允許直接重載(§R5.3)。
 */
export function setQuality(tier, { reload = true } = {}) {
  if (!TIERS.includes(tier) || tier === getQuality().tier) return false;
  writeStore(tier);
  const next = { ...PRESETS[tier], mobile: getQuality().mobile };
  for (const cb of listeners) {
    try { cb(next, current); } catch (e) { console.warn('[quality] 監聽者拋錯', e); }
  }
  current = next;
  if (reload && typeof location !== 'undefined') {
    // ?q= 覆寫會蓋掉剛寫進去的記憶值,換級時要把它拿掉
    const url = new URL(location.href);
    url.searchParams.delete('q');
    location.replace(url.toString());
  }
  return true;
}

/** HUD 按鈕:高 → 中 → 低 → 高 */
export function cycleQuality() {
  const i = TIERS.indexOf(getQuality().tier);
  return setQuality(TIERS[(i + 1) % TIERS.length]);
}

// ── 執行期自動降級(§R5.1) ───────────────────────────────
// 「連續 3 秒平均幀時間 > 40 ms」。用 0.5 秒一桶的滾動平均,避免單幀尖峰誤判。
const BUCKET = 0.5;

export function createAutoDowngrade({
  slowMs = SLOW_MS, hold = SLOW_HOLD, onDrop = null,
} = {}) {
  let acc = 0;
  let frames = 0;
  let slow = 0;
  let done = false;
  return {
    /**
     * @param {number} dt 這一幀的秒數
     * @param {boolean} ready 是否允許降級(量測凍結中、即時旋鈕還沒用盡時傳 false)
     * @returns {string|null} 真的降級時回傳新等級
     */
    sample(dt, ready = true) {
      if (done) return null;
      acc += dt;
      frames++;
      if (acc < BUCKET) return null;
      const avgMs = (acc / frames) * 1000;
      acc = 0;
      frames = 0;
      if (!ready) { slow = 0; return null; }
      slow = avgMs > slowMs ? slow + BUCKET : 0;
      if (slow < hold) return null;
      slow = 0;
      const i = TIERS.indexOf(getQuality().tier);
      if (i < 0 || i >= TIERS.length - 1) { done = true; return null; }   // 已是 low(或手機)
      const next = TIERS[i + 1];
      done = true;   // 一次載入只降一級,降完就 reload
      onDrop?.(next, avgMs);
      return next;
    },
    reset() { acc = 0; frames = 0; slow = 0; },
  };
}

export { TIERS, PRESETS, KEY as QUALITY_KEY };
