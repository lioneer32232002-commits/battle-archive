// 中途島 R5 畫質分級(docs/realism-spec.md §R5)單元測試
// 涵蓋:等級判定順序(?q= → localStorage → UNMASKED_RENDERER)、三級參數表、
//       降級順序、幀時間看門狗(連續 3 秒 > 40 ms 才觸發)、烘焙版艦艇 id。
import { describe, it, expect } from 'vitest';
import {
  TIERS, TIER_LABEL, autoTier, resolveTier, qualityParams, lowerTier, nextTier, FrameWatch,
} from '../src/midway/scene/quality.js';
import { modelIdFor, bakedModelId } from '../src/midway/scene/ships.js';
import { units } from '../src/midway/data/battle.js';

describe('autoTier — UNMASKED_RENDERER 判定(§R5.1)', () => {
  it('內顯／行動 GPU 判為 medium', () => {
    for (const s of [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)',
      'Apple GPU',
      'Mali-G78',
      'Adreno (TM) 650',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
    ]) {
      expect(autoTier(s)).toBe('medium');
    }
  });

  it('獨顯判為 high', () => {
    for (const s of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7800 XT, D3D11)',
    ]) {
      expect(autoTier(s)).toBe('high');
    }
  });

  it('問不到字串時不當作內顯(維持 high)', () => {
    expect(autoTier('')).toBe('high');
    expect(autoTier(null)).toBe('high');
    expect(autoTier(undefined)).toBe('high');
  });
});

describe('resolveTier — 判定順序(§R5.1)', () => {
  const intel = 'ANGLE (Intel, Intel(R) UHD Graphics, D3D11)';

  it('?q= 優先於 localStorage 與自動判定', () => {
    expect(resolveTier({ search: '?q=low', stored: 'high', rendererString: intel })).toBe('low');
    expect(resolveTier({ search: '?debug=1&q=HIGH', stored: 'low', rendererString: intel })).toBe('high');
  });

  it('沒有 ?q= 時吃 localStorage', () => {
    expect(resolveTier({ stored: 'low', rendererString: '' })).toBe('low');
  });

  it('localStorage 的值不合法就忽略,回到自動判定', () => {
    expect(resolveTier({ stored: 'ultra', rendererString: intel })).toBe('medium');
    expect(resolveTier({ stored: '', rendererString: '' })).toBe('high');
  });

  it('手機不在三級之列,一律回 mobile(維持既有行為)', () => {
    expect(resolveTier({ search: '?q=high', stored: 'low', mobile: true })).toBe('mobile');
  });
});

describe('qualityParams — 三級參數表(§R5.2)', () => {
  it('每一級都有完整參數,且 tier 欄位一致', () => {
    for (const t of TIERS) {
      const p = qualityParams(t);
      expect(p.tier).toBe(t);
      expect(TIER_LABEL[t]).toBeTruthy();
    }
  });

  it('GTAO 只有 high 有;low 不建 bloom／景深／SMAA', () => {
    expect(qualityParams('high').gtao).toBe(true);
    expect(qualityParams('medium').gtao).toBe(false);
    expect(qualityParams('low').gtao).toBe(false);
    expect(qualityParams('medium').bloomScale).toBe(0.5);
    expect(qualityParams('low').bloom).toBe(false);
    expect(qualityParams('low').bokeh).toBe(false);
    expect(qualityParams('low').smaa).toBe(false);
  });

  it('陰影:3 層 2048 → 2 層 1536 → 單張正交 1024', () => {
    expect(qualityParams('high')).toMatchObject({ csm: true, cascades: 3, shadowMapSize: 2048 });
    expect(qualityParams('medium')).toMatchObject({ csm: true, cascades: 2, shadowMapSize: 1536 });
    expect(qualityParams('low')).toMatchObject({ csm: false, shadowMapSize: 1024 });
  });

  it('pixelRatio 上限 2 / 1.25 / 1', () => {
    expect(qualityParams('high').pixelRatioCap).toBe(2);
    expect(qualityParams('medium').pixelRatioCap).toBe(1.25);
    expect(qualityParams('low').pixelRatioCap).toBe(1);
  });

  it('幾何量(海面細分、雲、尾流、椰子樹)逐級遞減', () => {
    const keys = ['oceanSegments', 'cloudScale', 'wakePerShip', 'palms'];
    const [h, m, l] = TIERS.map(qualityParams);
    for (const k of keys) {
      expect(h[k]).toBeGreaterThan(m[k]);
      expect(m[k]).toBeGreaterThan(l[k]);
    }
  });

  it('烘焙版艦艇:high／medium 用,low 退回平塗版(§R6)', () => {
    expect(qualityParams('high').bakedShips).toBe(true);
    expect(qualityParams('medium').bakedShips).toBe(true);
    expect(qualityParams('low').bakedShips).toBe(false);
    expect(qualityParams('mobile').bakedShips).toBe(false);
  });

  it('回傳的是複本,呼叫端改了不會汙染參數表', () => {
    const a = qualityParams('high');
    a.oceanSegments = 1;
    expect(qualityParams('high').oceanSegments).toBe(190);
  });

  it('不認識的等級退回 high(不會炸)', () => {
    expect(qualityParams('ultra').tier).toBe('high');
  });
});

describe('lowerTier／nextTier', () => {
  it('降級:high → medium → low → 到底', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe(null);
    expect(lowerTier('mobile')).toBe(null);
  });

  it('HUD 按鈕循環:高 → 中 → 低 → 高', () => {
    expect(nextTier('high')).toBe('medium');
    expect(nextTier('medium')).toBe('low');
    expect(nextTier('low')).toBe('high');
  });
});

describe('FrameWatch — 幀時間看門狗(§R5.1)', () => {
  const run = (w, ms, seconds) => {
    let fired = false;
    const dt = ms / 1000;
    for (let t = 0; t < seconds; t += dt) if (w.sample(dt)) fired = true;
    return fired;
  };

  it('穩定 60 fps 不會觸發', () => {
    expect(run(new FrameWatch(), 16.7, 10)).toBe(false);
  });

  it('穩定 50 ms/幀,約 3 秒後觸發一次', () => {
    const w = new FrameWatch();
    expect(run(w, 50, 2)).toBe(false);   // 還不到 3 秒(平滑上升也要時間)
    expect(run(w, 50, 3)).toBe(true);
  });

  it('單幀尖峰不觸發(超標時間會歸零)', () => {
    const w = new FrameWatch();
    for (let i = 0; i < 200; i++) {
      expect(w.sample(0.016)).toBe(false);
      if (i % 20 === 0) expect(w.sample(0.3)).toBe(false);   // 偶發 300 ms 尖峰
    }
  });

  it('剛好在門檻附近(38 ms)不觸發', () => {
    expect(run(new FrameWatch(), 38, 10)).toBe(false);
  });

  it('reset 後重新計時', () => {
    const w = new FrameWatch();
    run(w, 50, 2.5);
    w.reset();
    expect(run(w, 50, 2)).toBe(false);
  });

  it('dt 非正數直接忽略', () => {
    const w = new FrameWatch();
    expect(w.sample(0)).toBe(false);
    expect(w.sample(-1)).toBe(false);
    expect(w.avgMs).toBe(null);
  });
});

describe('bakedModelId — R2 烘焙版艦艇 id', () => {
  it('就是平塗版 id 加上 _baked', () => {
    expect(bakedModelId({ kind: 'carrier', side: 'red', islandSide: 'left' })).toBe('carrier_ijn_L_baked');
    expect(bakedModelId({ kind: 'carrier', side: 'blue' })).toBe('carrier_usn_baked');
    expect(bakedModelId({ kind: 'destroyer', side: 'blue' })).toBe('destroyer_usn_baked');
    expect(bakedModelId({ kind: 'battleship', side: 'red' })).toBe('cruiser_ijn_baked');
  });

  it('battle.js 內每一艘船都對得到一個已產出的烘焙版', () => {
    const BAKED = new Set([
      'carrier_ijn_L_baked', 'carrier_ijn_R_baked', 'carrier_usn_baked',
      'cruiser_ijn_baked', 'cruiser_usn_baked', 'destroyer_ijn_baked', 'destroyer_usn_baked',
    ]);
    for (const u of units) {
      if (u.kind === 'base') continue;
      expect(BAKED.has(bakedModelId(u))).toBe(true);
      expect(bakedModelId(u)).toBe(`${modelIdFor(u)}_baked`);
    }
  });
});
