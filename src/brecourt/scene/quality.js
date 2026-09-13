// 畫質分級(docs/realism-spec.md §R5)— 布雷庫爾
//
// 為什麼要分級:R4 的新管線(GTAO ＋ 三層 CSM ＋ 景深 ＋ SMAA)在獨顯上只多約 5 ms,
// 但本場的幾何量是六場最大的(核心區高規闊葉樹 ＋ 樹籬灌木,約 8M 三角形),
// 三層 cascade 等於把這些幾何再畫三次 —— 在 Intel 內顯上單幀 50 ms 起跳。
// 所以桌機分三級,啟動時判定一次,執行期再依實測幀時間自動降級。
//
// 判定順序(§R5.1):`?q=high|medium|low` → localStorage['battle-quality'] → UNMASKED_RENDERER 猜測。
// 手機路徑不在此列(維持既有的 isMobile 分流),tier 回 'mobile'。
//
// 本檔刻意寫成「純函式 ＋ 一層薄薄的執行期狀態」:resolveTier／presetFor／FrameWatch
// 都不碰 window/DOM,可以在 vitest(node,無 DOM)裡直接測。

export const TIER_ORDER = ['high', 'medium', 'low'];
export const TIER_LABEL = { high: '高', medium: '中', low: '低', mobile: '手機' };
export const STORAGE_KEY = 'battle-quality';
export const RELOAD_KEY = 'battle-quality-autoreload';

// §R5.1:內顯／行動 GPU／軟體 rasterizer 一律先給 medium
export const SLOW_RENDERER_RE = /Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i;

// §R5.2 三級參數表。所有建構函式吃這裡的欄位,不再各自讀 isMobile。
//   · 「需重建」的欄位(植被層級、草叢數量、CSM 層數、composer 組成)只在載入時讀一次;
//     執行期降級靠寫 localStorage ＋ reload。
//   · 「可即時切換」的欄位(gtao、bokeh、smaa、pixelRatio、mixerEvery)由 onQualityChange
//     的監聽者當場套用,不必 reload。
const HIGH = {
  tier: 'high',
  pixelRatio: 2,          // 上限(實際還要跟 devicePixelRatio 取 min)
  gtao: true, gtaoScale: 0.5,
  bloom: true, bloomScale: 1,
  bokeh: true,
  smaa: true,
  csm: true, cascades: 3, shadowMapSize: 2048, legacyShadowSize: 2048,
  heroVeg: 'hi',          // 'hi' = Poly Haven 高規幾何、'normal' = 一般版 glb、'proc' = 程序化
  heroLeafKeep: 1,
  heroDensify: true,      // hero 位置疊第二株補密
  midVeg: true, midLeafKeep: 0.45,
  bushVeg: true, bushLeafKeep: 0.28,
  grassCount: 2600,
  spriteScale: 1,         // 雲、晨霧、爆炸粒子
  mixerEvery: 1,          // 士兵 AnimationMixer 每幾幀更新一次
  baked: true,            // R2:優先載 <id>_baked.glb
};

const MEDIUM = {
  ...HIGH,
  tier: 'medium',
  pixelRatio: 1.25,
  gtao: false,
  bloom: true, bloomScale: 0.5,
  bokeh: true,
  smaa: true,
  csm: true, cascades: 2, shadowMapSize: 1536,
  // §R5.2 的「_hi 抽稀 50% 或一般版」取後者:實測 _hi 抽稀 50% 仍有 2.8M 三角形
  // (內顯上單幀還是 ~98 ms),換成一般版 glb 只剩約 1/5 的葉片,medium 才真的是可用的一級。
  heroVeg: 'normal', heroLeafKeep: 1, heroDensify: true,
  midVeg: true, midLeafKeep: 0.5,
  bushVeg: true, bushLeafKeep: 0.5,
  grassCount: 1300,
  spriteScale: 0.6,
  mixerEvery: 2,
  baked: true,
};

const LOW = {
  ...HIGH,
  tier: 'low',
  pixelRatio: 1,
  gtao: false,
  bloom: false, bloomScale: 0.5,
  bokeh: false,
  smaa: false,
  csm: false, cascades: 1, shadowMapSize: 1024, legacyShadowSize: 1024,
  heroVeg: 'proc', heroLeafKeep: 0, heroDensify: false,
  midVeg: false, midLeafKeep: 0,
  bushVeg: false, bushLeafKeep: 0,
  grassCount: 0,
  spriteScale: 0.4,
  mixerEvery: 3,
  baked: false,           // 平塗版(貼圖也省下來)
};

// 手機:維持既有分流(postfx/陰影/植被本來就由 mobile 旗標關掉),
// 這裡只提供士兵 mixer 的更新頻率與粒子量(R1 §5:手機 mixer 每兩幀一次)。
const MOBILE = {
  ...LOW,
  tier: 'mobile',
  pixelRatio: 1.5,
  spriteScale: 1,         // 手機的粒子量原本就另有一套(effects.js 的 mobile 分支)
  mixerEvery: 2,
};

export const PRESETS = { high: HIGH, medium: MEDIUM, low: LOW, mobile: MOBILE };

export function presetFor(tier) {
  return PRESETS[tier] ?? HIGH;
}

/** high → medium → low → null(已經最低) */
export function lowerTier(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 || i >= TIER_ORDER.length - 1 ? null : TIER_ORDER[i + 1];
}

/** HUD 按鈕:高 → 中 → 低 → 高 */
export function cycleTier(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[(i + 1) % TIER_ORDER.length];
}

/**
 * §R5.1 等級判定。純函式:呼叫端負責把 location.search／localStorage／
 * UNMASKED_RENDERER 字串餵進來。
 */
export function resolveTier({ search = '', stored = null, renderer = '', mobile = false } = {}) {
  if (mobile) return 'mobile';
  const m = /[?&]q=(high|medium|low)\b/i.exec(String(search));
  if (m) return m[1].toLowerCase();
  if (stored && TIER_ORDER.includes(stored)) return stored;
  if (renderer && SLOW_RENDERER_RE.test(renderer)) return 'medium';
  return 'high';
}

/**
 * 執行期監看:滾動平均幀時間連續 `window` 秒 > `limitMs` 就回 true(該降級了)。
 * 以 EMA 平滑瞬時幀時間(單一長影格不算數),再累計「連續超標」的時間。
 */
export class FrameWatch {
  constructor({ limitMs = 40, window: win = 3, smooth = 0.5 } = {}) {
    this.limitMs = limitMs;
    this.window = win;
    this.smooth = smooth;    // EMA 的時間常數(秒)
    this.ema = 0;
    this.bad = 0;
  }

  reset() { this.ema = 0; this.bad = 0; }

  /** @param {number} dt 秒 → 是否已連續超標滿一個 window */
  sample(dt) {
    if (!(dt > 0)) return false;
    const ms = dt * 1000;
    const k = Math.min(1, dt / this.smooth);
    this.ema = this.ema === 0 ? ms : this.ema + (ms - this.ema) * k;
    if (this.ema > this.limitMs) {
      this.bad += dt;
      if (this.bad >= this.window) { this.bad = 0; return true; }
    } else {
      this.bad = 0;
    }
    return false;
  }
}

// ── 執行期薄層(瀏覽器) ────────────────────────────────────
function safeStorage(kind) {
  try {
    const s = kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
    return s ?? null;
  } catch { return null; }   // Safari 隱私模式會直接丟例外
}

function rendererString(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return String(gl.getParameter(gl.RENDERER) ?? '');
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch { return ''; }
}

let state = null;
const listeners = new Set();

/**
 * 啟動時呼叫一次(建場景之前)。回傳該級的參數物件。
 * @param {{mobile?:boolean, renderer?:any}} opts
 */
export function initQuality({ mobile = false, renderer = null } = {}) {
  const ls = safeStorage('local');
  const search = globalThis.location?.search ?? '';
  const tier = resolveTier({
    search,
    stored: ls?.getItem(STORAGE_KEY) ?? null,
    renderer: mobile ? '' : rendererString(renderer),
    mobile,
  });
  state = {
    tier,
    params: { ...presetFor(tier) },
    watch: new FrameWatch(),
    frozen: false,
    stage: 0,          // 0 = 全額、1 = 已套即時旋鈕、2 = 已 reload 過
    gpu: mobile ? 'mobile' : rendererString(renderer),
    // 網址上明寫 ?q= 就是「我就是要看這一級」(截圖／量測用):
    // 自動降級在這種情況下關掉,否則量到的是降級後的畫面。
    pinned: /[?&]q=(high|medium|low)\b/i.test(search),
  };
  return state.params;
}

/** 任何模組都可以取用(未初始化時給 high,方便測試與獨立載入) */
export function getQuality() {
  if (!state) return { ...HIGH };
  return state.params;
}

export function getTier() { return state?.tier ?? 'high'; }
export function getGpuName() { return state?.gpu ?? ''; }

/** 監聽「即時旋鈕」變動:cb(params, tier) */
export function onQualityChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb(state.params, state.tier); } catch (e) { console.warn('[brecourt/quality] listener 出錯', e); }
  }
}

/** 使用者按 HUD 按鈕:寫入 localStorage 後重新載入(植被與 CSM 層數需重建) */
export function applyTier(tier) {
  const ls = safeStorage('local');
  try { ls?.setItem(STORAGE_KEY, tier); } catch { /* 無痕模式:改不了就算了 */ }
  const loc = globalThis.location;
  // ?q= 會蓋過 localStorage,切換時要把它拿掉,否則按了沒反應
  if (loc && /[?&]q=/i.test(loc.search)) {
    const url = new URL(loc.href);
    url.searchParams.delete('q');
    loc.replace(url.toString());
  } else {
    loc?.reload?.();
  }
}

/** 截圖／量測期間凍結(跟 __dbg.freezeQuality 同步) */
export function setFrozen(on) {
  if (!state) return false;
  state.frozen = !!on;
  state.watch.reset();
  return state.frozen;
}

/**
 * 每幀餵一次 dt(秒)。連續 3 秒平均幀時間 > 40 ms:
 *   第一次 → 把「可即時切換」的旋鈕降到下一級(GTAO、景深、SMAA、pixelRatio、mixer 頻率)
 *   第二次 → 連需重建的項目一起降:寫 localStorage 後 reload(每個分頁最多一次)
 * 不自動升級(避免振盪)。
 */
export function sampleFrame(dt) {
  if (!state || state.frozen || state.pinned) return false;
  const next = lowerTier(state.tier);
  if (!next) return false;
  if (!state.watch.sample(dt)) return false;

  if (state.stage === 0) {
    state.stage = 1;
    const p = presetFor(next);
    Object.assign(state.params, {
      gtao: p.gtao, gtaoScale: p.gtaoScale,
      bokeh: p.bokeh, smaa: p.smaa, bloom: p.bloom,
      pixelRatio: p.pixelRatio,
      mixerEvery: p.mixerEvery,
    });
    emit();
    console.warn(`[brecourt/quality] 幀時間持續 > 40 ms → 先降即時旋鈕(${state.tier} → ${next} 的後製與解析度)`);
    return true;
  }

  const ss = safeStorage('session');
  let done = null;
  try { done = ss?.getItem(RELOAD_KEY); } catch { /* ignore */ }
  if (done) return false;              // 同一個分頁只自動 reload 一次,避免無限重載
  try { ss?.setItem(RELOAD_KEY, '1'); } catch { /* ignore */ }
  state.stage = 2;
  console.warn(`[brecourt/quality] 仍然過慢 → 降到 ${next} 並重新載入(植被與陰影層數需重建)`);
  applyTier(next);
  return true;
}

/** 給 __dbg 用的除錯快照 */
export function qualityInfo() {
  return state
    ? { tier: state.tier, stage: state.stage, frozen: state.frozen, pinned: state.pinned, gpu: state.gpu, params: { ...state.params } }
    : { tier: 'high', stage: 0, frozen: false, gpu: '', params: { ...HIGH } };
}
