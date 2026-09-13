// 畫質分級(docs/realism-spec.md §R5)— 巴斯通
//
// 背景:R4 的新渲染層(GTAO／CSM 三層／景深／調色／SMAA)在獨顯上很划算,在 Intel 內顯上
//   單幀約 50 ms —— 而且重的不是後製,是場景幾何本身(2–8M 三角形被三層 cascade 重畫三次)。
//   所以桌機必須分三級,並在執行期自動降級。
//
// 用法(main.js 建場景**之前**):
//   const Q = getQuality({ mobile: isMobile });      // 回傳 tier 與整包參數
//   ...所有建構函式吃 Q 的欄位,不要各自去讀 isMobile
//   每幀:Q.sample(dt)                                // 連續 3 秒平均 > 40 ms → 降一級
//   HUD 按鈕:cycleQuality()                          // 寫 localStorage 後 reload
//
// ⚠ 需重建的項目(植被數量、CSM 層數、composer 組成)不做即時切換:降級寫進 localStorage
//   後直接 location.reload(),簡單可靠(§R5.3)。可即時切的旋鈕(GTAO 開關、GTAO 解析度、
//   pixelRatio、雪粒子數)仍由 main.js 的動態解析度機制在同一級之內先動。
const KEY = 'battle-quality';
export const ORDER = ['high', 'medium', 'low'];
export const TIER_LABEL = { high: '高', medium: '中', low: '低', mobile: '手機' };

// §R5.1:UNMASKED_RENDERER 命中這些字串就是內顯／行動 GPU → medium 起跳
export const SLOW_GPU_RE = /Intel|Iris|UHD|Apple GPU|Mali|Adreno|SwiftShader|llvmpipe/i;

// §R5.2 三級參數表。所有建構函式吃這裡的欄位。
const TIERS = {
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    gtao: true, gtaoScale: 0.5,
    bloom: true, bloomScale: 1,
    bokeh: true, smaa: true, msaa: 4,
    shadows: 'csm', cascades: 3, shadowMapSize: 2048,
    heroTrees: 'hi', heroKeep: 0.34, midKeep: 0.12, midFraction: 1,
    crownShadows: 'all',          // 樹冠投影代理:核心區整片(雪面上看得到樹形)
    particles: 1,
    mixerEvery: 1,
    baked: true,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.25,
    gtao: false, gtaoScale: 0.5,
    bloom: true, bloomScale: 0.5,
    bokeh: true, smaa: true, msaa: 4,
    shadows: 'csm', cascades: 2, shadowMapSize: 1536,
    heroTrees: 'hi', heroKeep: 0.17, midKeep: 0.12, midFraction: 0.5,
    crownShadows: 'hero',         // 只有 hero 那圈(MLR 樹線＋散兵坑線 110 單位內)投影
    particles: 0.6,
    mixerEvery: 2,
    baked: true,
  },
  low: {
    tier: 'low',
    pixelRatioCap: 1,
    gtao: false, gtaoScale: 0.5,
    bloom: false, bloomScale: 1,
    bokeh: false, smaa: false, msaa: 0,
    shadows: 'legacy', cascades: 0, shadowMapSize: 1024,
    heroTrees: 'procedural', heroKeep: 0, midKeep: 0, midFraction: 0,
    crownShadows: false,          // 程序化圓錐本來就自己投影,不需要代理
    particles: 0.4,
    mixerEvery: 3,
    baked: false,
  },
  // 手機:§R5.1 明言「手機路徑不在此列,維持既有」。這一格只是把原本散在各檔的
  // isMobile 分支集中起來,數值與升級前一模一樣(pixelRatio 1.5、雪 500/1500、mixer 每 2 幀)。
  mobile: {
    tier: 'mobile',
    pixelRatioCap: 1.5,
    gtao: false, gtaoScale: 0.5,
    bloom: false, bloomScale: 1,
    bokeh: false, smaa: false, msaa: 0,
    shadows: 'none', cascades: 0, shadowMapSize: 0,
    heroTrees: 'procedural', heroKeep: 0, midKeep: 0, midFraction: 0,
    crownShadows: false,
    particles: 1 / 3,
    mixerEvery: 2,
    baked: false,
  },
};

export function tierParams(tier) {
  return { ...(TIERS[tier] ?? TIERS.medium) };
}

// ── 等級判定(純函式,好測) ─────────────────────────────
// 優先序:?q= → localStorage → UNMASKED_RENDERER 自動判定
export function decideTier({ query = null, stored = null, renderer = '', mobile = false } = {}) {
  if (mobile) return { tier: 'mobile', from: 'mobile' };
  if (ORDER.includes(query)) return { tier: query, from: 'query' };
  if (ORDER.includes(stored)) return { tier: stored, from: 'storage' };
  return { tier: SLOW_GPU_RE.test(renderer || '') ? 'medium' : 'high', from: 'auto' };
}

export function lowerTier(tier) {
  const i = ORDER.indexOf(tier);
  return i < 0 || i >= ORDER.length - 1 ? tier : ORDER[i + 1];
}
export function nextTier(tier) {
  const i = ORDER.indexOf(tier);
  return ORDER[(i < 0 ? 0 : i + 1) % ORDER.length];
}

// ── 執行期降級判定(純函式,好測) ───────────────────────
// 滾動平均:每滿 1 秒結算一次平均幀時間,連續 3 個 > 40 ms 就降一級(§R5.1)。
export function createFrameWatch({ budgetMs = 40, seconds = 3, warmup = 4 } = {}) {
  let acc = 0, frames = 0, slow = 0, age = 0, last = 0;
  return {
    get slowSeconds() { return slow; },
    get lastAvgMs() { return last; },
    reset() { acc = 0; frames = 0; slow = 0; },
    // 回傳 true = 該降級了
    sample(dt) {
      age += dt;
      acc += dt; frames++;
      if (acc < 1) return false;
      last = (acc / frames) * 1000;
      acc = 0; frames = 0;
      if (age < warmup) { slow = 0; return false; }   // 開場載入尖峰不算
      slow = last > budgetMs ? slow + 1 : 0;
      if (slow >= seconds) { slow = 0; return true; }
      return false;
    },
  };
}

// ── 瀏覽器端 ──────────────────────────────────────────
function readStore() {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}
function writeStore(tier) {
  try { window.localStorage.setItem(KEY, tier); } catch { /* 無痕模式:純執行期降級 */ }
}
function gpuRenderer() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();   // 這張是臨時的,別佔著一個 context
    return name ?? '';
  } catch { return ''; }
}

let current = null;
const listeners = [];

export function getQuality({ mobile = false } = {}) {
  if (current) return current;
  const query = new URLSearchParams(location.search).get('q');
  const stored = readStore();
  const { tier, from } = decideTier({ query, stored, renderer: gpuRenderer(), mobile });
  const watch = createFrameWatch();
  let locked = false;

  current = {
    ...tierParams(tier),
    tier,
    from,
    gpu: from === 'auto' ? gpuRenderer() : '',
    label: TIER_LABEL[tier],
    setLock: (on) => { locked = !!on; if (on) watch.reset(); },
    // 每幀呼叫;連續 3 秒平均幀時間 > 40 ms → 降一級(需重建 → 寫 localStorage 後 reload)
    sample(dt) {
      if (locked || tier === 'mobile' || from === 'query') return;
      if (tier === ORDER[ORDER.length - 1]) return;
      if (!watch.sample(dt)) return;
      const next = lowerTier(tier);
      console.info(`[bastogne] 幀時間 ${watch.lastAvgMs.toFixed(1)} ms 連續超標 → 畫質降為「${TIER_LABEL[next]}」`);
      for (const cb of listeners) cb(next, tier);
      applyTier(next);
    },
    avgFrameMs: () => watch.lastAvgMs,
  };
  return current;
}

// 等級要變了(自動降級／HUD 切換)時先通知一聲 —— 重載前想做的事寫在這裡。
export function onQualityChange(cb) {
  if (typeof cb === 'function') listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// 寫 localStorage 後重載(§R5.3:需重建的項目一律走這條,簡單可靠)
export function applyTier(tier) {
  if (!ORDER.includes(tier)) return;
  writeStore(tier);
  const url = new URL(location.href);
  url.searchParams.delete('q');     // 手動／自動切換後不再被 ?q= 綁住
  location.replace(url.toString());
}

export function cycleQuality() {
  const q = current ?? getQuality();
  const next = nextTier(q.tier === 'mobile' ? 'high' : q.tier);
  for (const cb of listeners) cb(next, q.tier);
  applyTier(next);
}

// 測試用:清掉 memo
export function __resetQuality() { current = null; listeners.length = 0; }
