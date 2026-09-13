// 天號作戰 R5 畫質分級(docs/realism-spec.md §R5)＋ R2 烘焙版模型對照 單元測試
// 涵蓋:GPU 判定、?q= 與 localStorage 的優先序、三級參數表的不變量、
//       執行期自動降級的「連續 3 秒平均 > 40 ms」條件、烘焙版 glb 的選用規則。
import { describe, it, expect } from 'vitest';
import {
  TIERS, PRESETS, tierFromGPU, tierFromQuery, resolveTier, createAutoDowngrade, getQuality,
} from '../src/yamato/scene/quality.js';
import { modelIdFor, bakedIdFor, BAKED_SHIPS } from '../src/yamato/scene/ships.js';
import { units } from '../src/yamato/data/battle.js';

describe('tierFromGPU — 依 UNMASKED_RENDERER 自動判定(§R5.1)', () => {
  it('內顯與行動 GPU 一律 medium', () => {
    for (const name of [
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)',
      'Apple GPU',
      'Mali-G78',
      'Adreno (TM) 640',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
    ]) {
      expect(tierFromGPU(name)).toBe('medium');
    }
  });

  it('獨顯給 high', () => {
    expect(tierFromGPU('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)')).toBe('high');
    expect(tierFromGPU('AMD Radeon RX 7900 XT')).toBe('high');
  });

  it('讀不到顯示卡名稱(擴充被擋)時不降級', () => {
    expect(tierFromGPU('')).toBe('high');
    expect(tierFromGPU(null)).toBe('high');
  });
});

describe('tierFromQuery — ?q= 覆寫', () => {
  it('只認三個等級', () => {
    expect(tierFromQuery('?q=low')).toBe('low');
    expect(tierFromQuery('?debug=1&q=medium')).toBe('medium');
    expect(tierFromQuery('?q=HIGH')).toBe('high');
    expect(tierFromQuery('?q=ultra')).toBe(null);
    expect(tierFromQuery('')).toBe(null);
  });

  it('不會誤中其他參數(例如 ?seq=low)', () => {
    expect(tierFromQuery('?seq=low')).toBe(null);
  });
});

describe('resolveTier — 判定順序:query → localStorage → GPU', () => {
  const intel = 'Intel(R) UHD Graphics';

  it('?q= 優先於記憶值與 GPU', () => {
    expect(resolveTier({ search: '?q=high', stored: 'low', renderer: intel })).toBe('high');
  });

  it('沒有 ?q= 時用 localStorage 的記憶值', () => {
    expect(resolveTier({ search: '', stored: 'low', renderer: 'NVIDIA RTX 4070' })).toBe('low');
  });

  it('記憶值不合法就忽略,退回 GPU 自動判定', () => {
    expect(resolveTier({ stored: 'ultra', renderer: intel })).toBe('medium');
    expect(resolveTier({ stored: null, renderer: 'NVIDIA RTX 4070' })).toBe('high');
  });

  it('手機不參與分級(§R5.1:維持既有路徑)', () => {
    expect(resolveTier({ mobile: true, search: '?q=high', stored: 'low' })).toBe('mobile');
  });
});

describe('三級參數表(§R5.2)', () => {
  it('等級順序是 高 → 中 → 低', () => {
    expect(TIERS).toEqual(['high', 'medium', 'low']);
  });

  it('pixelRatio 上限逐級遞減,且與規格數值一致', () => {
    expect(PRESETS.high.pixelRatioCap).toBe(2);
    expect(PRESETS.medium.pixelRatioCap).toBe(1.25);
    expect(PRESETS.low.pixelRatioCap).toBe(1);
  });

  it('GTAO 只有 high 開,景深／SMAA／bloom 到 low 才全關', () => {
    expect(PRESETS.high.passes.gtao).toBe(true);
    expect(PRESETS.medium.passes.gtao).toBe(false);
    expect(PRESETS.low.passes.gtao).toBe(false);
    expect(PRESETS.medium.passes.bloom).toBe(true);
    expect(PRESETS.medium.bloomScale).toBe(0.5);   // bloom 半解析度
    for (const k of ['gtao', 'bokeh', 'bloom', 'smaa']) expect(PRESETS.low.passes[k]).toBe(false);
    expect(PRESETS.low.postfx).toBe(true);         // 只留 OutputPass ＋ 調色
  });

  it('陰影:3 層 2048 → 2 層 1536 → 單張正交 1024', () => {
    expect(PRESETS.high.csm).toMatchObject({ cascades: 3, shadowMapSize: 2048 });
    expect(PRESETS.medium.csm).toMatchObject({ cascades: 2, shadowMapSize: 1536 });
    expect(PRESETS.low.csm).toBe(null);
    expect(PRESETS.low.legacyShadowMapSize).toBe(1024);
    expect(PRESETS.low.shadows).toBe(true);
  });

  it('幾何／粒子量逐級遞減', () => {
    const seg = (t) => PRESETS[t].ocean.segments;
    expect(seg('high')).toBeGreaterThan(seg('medium'));
    expect(seg('medium')).toBeGreaterThan(seg('low'));
    for (const key of ['add', 'norm']) {
      expect(PRESETS.high.particles[key]).toBeGreaterThan(PRESETS.medium.particles[key]);
      expect(PRESETS.medium.particles[key]).toBeGreaterThan(PRESETS.low.particles[key]);
    }
    expect(PRESETS.high.clouds.low + PRESETS.high.clouds.high + PRESETS.high.clouds.band)
      .toBeGreaterThan(PRESETS.low.clouds.low + PRESETS.low.clouds.high + PRESETS.low.clouds.band);
    expect(PRESETS.low.ocean.foam).toBe(false);    // 白沫片元在 low 拿掉
  });

  it('手機 preset 維持 2026-09-12 的既有數值,且不吃後製與陰影', () => {
    expect(PRESETS.mobile.postfx).toBe(false);
    expect(PRESETS.mobile.shadows).toBe(false);
    expect(PRESETS.mobile.pixelRatioCap).toBe(1.5);
    expect(PRESETS.mobile.ocean.segments).toBe(140);
    expect(PRESETS.mobile.particles).toEqual({ add: 260, norm: 320 });
    expect(PRESETS.mobile.bakedModels).toBe(false);
  });

  it('每一級都有完整的欄位(建構函式全部吃得到參數)', () => {
    const keys = Object.keys(PRESETS.high);
    for (const t of [...TIERS, 'mobile']) {
      expect(Object.keys(PRESETS[t]).sort()).toEqual(keys.sort());
    }
  });
});

describe('createAutoDowngrade — 執行期降級(§R5.1:連續 3 秒平均 > 40 ms)', () => {
  const feed = (auto, frameMs, seconds, ready = true) => {
    let drop = null;
    const dt = frameMs / 1000;
    for (let t = 0; t < seconds; t += dt) drop = auto.sample(dt, ready) ?? drop;
    return drop;
  };

  it('連續 3 秒 50 ms → 降一級', () => {
    const auto = createAutoDowngrade();
    expect(feed(auto, 50, 2)).toBe(null);          // 還不到 3 秒
    expect(feed(auto, 50, 1.5)).toBe('medium');
  });

  it('20 ms 的正常幀不降級', () => {
    expect(feed(createAutoDowngrade(), 20, 10)).toBe(null);
  });

  it('中途恢復就重新計時(不是累計)', () => {
    const auto = createAutoDowngrade();
    feed(auto, 50, 2);
    feed(auto, 16, 1);                              // 恢復 → 歸零
    expect(feed(auto, 50, 2)).toBe(null);
  });

  it('即時旋鈕還沒用盡(ready=false)時不換級', () => {
    expect(feed(createAutoDowngrade(), 60, 10, false)).toBe(null);
  });

  it('一次載入只降一級(降完就要重載)', () => {
    const auto = createAutoDowngrade();
    expect(feed(auto, 60, 5)).toBe('medium');
    expect(feed(auto, 60, 10)).toBe(null);
  });

  it('onDrop 會拿到新等級與實測平均幀時間', () => {
    const seen = [];
    const auto = createAutoDowngrade({ onDrop: (tier, ms) => seen.push([tier, ms]) });
    feed(auto, 50, 4);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('medium');
    expect(seen[0][1]).toBeCloseTo(50, 0);
  });
});

describe('bakedIdFor — R2 烘焙版模型的選用(§R5.2、§R6)', () => {
  it('high／medium 載 _baked,low 與手機載平塗版', () => {
    expect(bakedIdFor('yamato', PRESETS.high)).toBe('yamato_baked');
    expect(bakedIdFor('cruiser_ijn', PRESETS.medium)).toBe('cruiser_ijn_baked');
    expect(bakedIdFor('destroyer_ijn', PRESETS.low)).toBe(null);
    expect(bakedIdFor('yamato', PRESETS.mobile)).toBe(null);
  });

  it('沒有烘焙版的模型(航艦刻意留程序化)回 null', () => {
    expect(bakedIdFor('carrier_usn', PRESETS.high)).toBe(null);
    expect(bakedIdFor(null, PRESETS.high)).toBe(null);
  });

  it('battle.js 裡每一艘有 glb 的船,對到的 id 都在烘焙清單內', () => {
    for (const u of units) {
      if (u.kind === 'base') continue;
      const id = modelIdFor(u);
      if (!id) continue;                 // 航艦:刻意沒有 glb 對照
      expect(BAKED_SHIPS.has(id)).toBe(true);
      expect(bakedIdFor(id, PRESETS.high)).toBe(`${id}_baked`);
    }
  });

  it('未初始化時 getQuality() 給 high(單元測試不必先 init)', () => {
    expect(getQuality().tier).toBe('high');
    expect(bakedIdFor('yamato')).toBe('yamato_baked');
  });
});
