// 布雷庫爾畫質分級(src/brecourt/scene/quality.js,docs/realism-spec.md §R5)的純函式測試。
// 這一層刻意不碰 window／DOM,所以可以在 node 環境直接測:等級判定、三級參數表的
// 單調性、降級／循環順序、執行期的幀時間監看。
import { describe, it, expect } from 'vitest';
import {
  TIER_ORDER, PRESETS, presetFor, resolveTier, lowerTier, cycleTier, FrameWatch, TIER_LABEL,
} from '../src/brecourt/scene/quality.js';

describe('resolveTier — §R5.1 等級判定順序', () => {
  it('?q= 的優先序最高(蓋過 localStorage 與顯示卡判定)', () => {
    expect(resolveTier({ search: '?q=low', stored: 'high', renderer: 'NVIDIA RTX 4090' })).toBe('low');
    expect(resolveTier({ search: '?mobile&q=HIGH', stored: 'low' })).toBe('high');
  });

  it('沒有 ?q= 時看 localStorage', () => {
    expect(resolveTier({ stored: 'medium', renderer: 'NVIDIA RTX 4090' })).toBe('medium');
  });

  it('localStorage 是垃圾值就忽略', () => {
    expect(resolveTier({ stored: 'ultra', renderer: 'NVIDIA RTX 4090' })).toBe('high');
  });

  it('UNMASKED_RENDERER 命中內顯／行動 GPU → medium', () => {
    for (const gpu of [
      'ANGLE (Intel, Intel(R) UHD Graphics (0x00008A56) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple GPU', 'Mali-G78', 'Adreno (TM) 640', 'Intel(R) Iris(R) Xe Graphics', 'SwiftShader', 'llvmpipe',
    ]) {
      expect(resolveTier({ renderer: gpu })).toBe('medium');
    }
  });

  it('獨顯 → high', () => {
    expect(resolveTier({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('high');
    expect(resolveTier({ renderer: 'AMD Radeon RX 6800 XT' })).toBe('high');
  });

  it('手機不在分級之列,一律回 mobile(維持既有分流)', () => {
    expect(resolveTier({ mobile: true, search: '?q=high', stored: 'high' })).toBe('mobile');
  });

  it('查詢字串裡的其他參數不會被誤認(?quality=、?qq=)', () => {
    expect(resolveTier({ search: '?quality=low' })).toBe('high');
    expect(resolveTier({ search: '?legacy=1&q=medium' })).toBe('medium');
  });
});

describe('三級參數表 — §R5.2', () => {
  it('每一級都有標籤與完整欄位', () => {
    for (const t of TIER_ORDER) {
      expect(TIER_LABEL[t]).toBeTruthy();
      const p = PRESETS[t];
      for (const k of ['pixelRatio', 'gtao', 'csm', 'cascades', 'shadowMapSize', 'grassCount', 'mixerEvery', 'baked']) {
        expect(p[k], `${t}.${k}`).toBeDefined();
      }
    }
  });

  it('越低階越省:pixelRatio、cascade、草叢、粒子單調遞減,mixer 間隔遞增', () => {
    const [h, m, l] = TIER_ORDER.map(presetFor);
    expect(h.pixelRatio).toBeGreaterThan(m.pixelRatio);
    expect(m.pixelRatio).toBeGreaterThan(l.pixelRatio);
    expect(h.cascades).toBeGreaterThan(m.cascades);
    expect(h.grassCount).toBeGreaterThan(m.grassCount);
    expect(m.grassCount).toBeGreaterThan(l.grassCount);
    expect(l.grassCount).toBe(0);
    expect(h.spriteScale).toBeGreaterThan(m.spriteScale);
    expect(m.spriteScale).toBeGreaterThan(l.spriteScale);
    expect(h.mixerEvery).toBeLessThan(m.mixerEvery);
    expect(m.mixerEvery).toBeLessThan(l.mixerEvery);
  });

  it('GTAO 只有 high 有;low 只留 OutputPass ＋ 調色(bloom／景深／SMAA 全關)', () => {
    expect(presetFor('high').gtao).toBe(true);
    expect(presetFor('medium').gtao).toBe(false);
    expect(presetFor('low').gtao).toBe(false);
    for (const k of ['bloom', 'bokeh', 'smaa']) expect(presetFor('low')[k], k).toBe(false);
    expect(presetFor('medium').bloomScale).toBeLessThan(presetFor('high').bloomScale);
  });

  it('low 退回單張正交陰影、核心區植被回到程序化、不載烘焙版', () => {
    const l = presetFor('low');
    expect(l.csm).toBe(false);
    expect(l.heroVeg).toBe('proc');
    expect(l.midVeg).toBe(false);
    expect(l.baked).toBe(false);
  });

  it('手機沿用 low 的省法,但 mixer 每兩幀一次(§R1.5)', () => {
    expect(presetFor('mobile').mixerEvery).toBe(2);
  });

  it('未知等級回 high(壞掉也不會是黑畫面)', () => {
    expect(presetFor('ultra').tier).toBe('high');
  });
});

describe('降級與循環順序', () => {
  it('lowerTier 一次降一級,到 low 為止', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
    expect(lowerTier('mobile')).toBeNull();
  });

  it('HUD 按鈕是 高 → 中 → 低 → 高', () => {
    expect(cycleTier('high')).toBe('medium');
    expect(cycleTier('medium')).toBe('low');
    expect(cycleTier('low')).toBe('high');
  });
});

describe('FrameWatch — 連續 3 秒平均幀時間 > 40 ms', () => {
  const feed = (w, ms, seconds) => {
    let hit = false;
    const dt = ms / 1000;
    for (let t = 0; t < seconds; t += dt) hit = w.sample(dt) || hit;
    return hit;
  };

  it('順順跑(16 ms)永遠不觸發', () => {
    expect(feed(new FrameWatch(), 16, 30)).toBe(false);
  });

  it('持續 50 ms 會在約 3 秒後觸發一次', () => {
    const w = new FrameWatch();
    expect(feed(w, 50, 2)).toBe(false);      // 還不滿 3 秒
    expect(feed(w, 50, 2)).toBe(true);       // 累計超過 3 秒
  });

  it('偶發的單張長影格不算數(EMA 平滑)', () => {
    const w = new FrameWatch();
    for (let i = 0; i < 300; i++) {
      const dt = i % 60 === 0 ? 0.25 : 0.016;   // 每秒一張 250 ms 的卡頓
      expect(w.sample(dt)).toBe(false);
    }
  });

  it('觸發後歸零,要再累計滿 3 秒才會再觸發(降級不會一次跳兩級)', () => {
    const w = new FrameWatch();
    feed(w, 60, 4);
    expect(feed(w, 60, 1)).toBe(false);
    expect(feed(w, 60, 3)).toBe(true);
  });

  it('dt 非正數不會汙染狀態', () => {
    const w = new FrameWatch();
    expect(w.sample(0)).toBe(false);
    expect(w.sample(-1)).toBe(false);
    expect(w.ema).toBe(0);
  });
});
