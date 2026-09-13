// 巴斯通 · 畫質分級(docs/realism-spec.md §R5)與骨架動畫的 clip 選擇(§R1.5)
// 這兩支都是「純函式 ＋ 一張參數表」,但它們決定了整場要不要建 GTAO／CSM 三層／高規植被,
// 也決定了小兵是走還是跑 —— 改錯了在畫面上不一定看得出來,先用測試釘住。
import { describe, it, expect } from 'vitest';
import {
  ORDER, TIER_LABEL, SLOW_GPU_RE, tierParams, decideTier, lowerTier, nextTier, createFrameWatch,
} from '../src/bastogne/scene/quality.js';
import { pickClip, clipRate, RIG_FILE, RIG_CLIPS } from '../src/bastogne/scene/soldier-rig.js';

describe('bastogne quality · 等級判定(§R5.1)', () => {
  it('優先序:?q= 蓋過 localStorage,localStorage 蓋過自動判定', () => {
    expect(decideTier({ query: 'low', stored: 'high', renderer: 'NVIDIA' }).tier).toBe('low');
    expect(decideTier({ stored: 'medium', renderer: 'NVIDIA' }).tier).toBe('medium');
    expect(decideTier({ renderer: 'NVIDIA GeForce RTX 4070' }).tier).toBe('high');
  });

  it('亂填的 ?q= 與 localStorage 一律忽略,回到自動判定', () => {
    expect(decideTier({ query: 'ultra', stored: 'potato', renderer: 'NVIDIA' }).from).toBe('auto');
  });

  it('內顯／行動 GPU(UNMASKED_RENDERER)自動降到 medium', () => {
    const slow = [
      'ANGLE (Intel, Intel(R) UHD Graphics (0x00008A56) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)',
      'Apple GPU', 'Mali-G78', 'Adreno (TM) 730', 'Google SwiftShader', 'llvmpipe (LLVM 15)',
    ];
    for (const r of slow) {
      expect(SLOW_GPU_RE.test(r)).toBe(true);
      expect(decideTier({ renderer: r }).tier).toBe('medium');
    }
  });

  it('手機不進這套分級(§R5.1:維持既有路徑)', () => {
    const d = decideTier({ query: 'high', mobile: true });
    expect(d.tier).toBe('mobile');
    expect(tierParams('mobile').pixelRatioCap).toBe(1.5);   // 與升級前一致
    expect(tierParams('mobile').shadows).toBe('none');
  });
});

describe('bastogne quality · 三級參數表(§R5.2)', () => {
  it('GTAO 只有 high 開,陰影 high 3 層 2048／medium 2 層 1536／low 單張正交', () => {
    expect(tierParams('high').gtao).toBe(true);
    expect(tierParams('medium').gtao).toBe(false);
    expect(tierParams('low').gtao).toBe(false);
    expect([tierParams('high').cascades, tierParams('high').shadowMapSize]).toEqual([3, 2048]);
    expect([tierParams('medium').cascades, tierParams('medium').shadowMapSize]).toEqual([2, 1536]);
    expect(tierParams('low').shadows).toBe('legacy');
  });

  it('pixelRatio 上限、粒子量、mixer 更新頻率逐級遞減', () => {
    const [h, m, l] = ORDER.map(tierParams);
    expect([h.pixelRatioCap, m.pixelRatioCap, l.pixelRatioCap]).toEqual([2, 1.25, 1]);
    expect(h.particles).toBeGreaterThan(m.particles);
    expect(m.particles).toBeGreaterThan(l.particles);
    expect([h.mixerEvery, m.mixerEvery, l.mixerEvery]).toEqual([1, 2, 3]);
  });

  it('low 不吃烘焙模型、不建 glb 森林(維持程序化 fallback)', () => {
    expect(tierParams('low').baked).toBe(false);
    expect(tierParams('low').heroTrees).toBe('procedural');
    expect(tierParams('high').baked).toBe(true);
    expect(tierParams('medium').baked).toBe(true);
  });

  it('每一級都有標籤可以顯示在 HUD 上', () => {
    for (const t of [...ORDER, 'mobile']) expect(TIER_LABEL[t]).toBeTruthy();
  });

  it('降級只往下、循環切換會繞回來', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');          // 最低了就停住,不會掉出表外
    expect(nextTier('low')).toBe('high');
  });
});

describe('bastogne quality · 執行期降級(§R5.1:連續 3 秒 > 40 ms)', () => {
  const run = (watch, ms, seconds) => {
    let fired = false;
    for (let s = 0; s < seconds; s++) {
      for (let i = 0; i < Math.ceil(1000 / ms); i++) fired = watch.sample(ms / 1000) || fired;
    }
    return fired;
  };

  it('開場的載入尖峰不算(warmup)', () => {
    const w = createFrameWatch({ warmup: 4 });
    expect(run(w, 120, 3)).toBe(false);
  });

  it('暖機後連續 3 秒超標才降級', () => {
    const w = createFrameWatch({ warmup: 0 });
    expect(run(w, 60, 2)).toBe(false);   // 兩秒不夠
    expect(run(w, 60, 1)).toBe(true);    // 第三秒才觸發
  });

  it('中間有一秒回到預算內就重新計數', () => {
    const w = createFrameWatch({ warmup: 0 });
    run(w, 60, 2);
    expect(run(w, 16, 1)).toBe(false);   // 這一秒很順 → 歸零
    expect(run(w, 60, 2)).toBe(false);   // 只累積到 2 秒
    expect(w.slowSeconds).toBe(2);
  });

  it('預算內的幀時間永遠不會觸發降級', () => {
    const w = createFrameWatch({ warmup: 0, budgetMs: 40 });
    expect(run(w, 39, 5)).toBe(false);
  });
});

describe('bastogne soldier-rig · clip 選擇與播放倍率(§R1.5)', () => {
  it('依實際移動速度選 clip:> 2.2 run、> 0.2 walk、衝鋒段 crouch_walk', () => {
    expect(pickClip(3.4, 'stand')).toBe('run');
    expect(pickClip(1.2, 'stand')).toBe('walk');
    expect(pickClip(1.2, 'stand', { assault: true })).toBe('crouch_walk');
    expect(pickClip(3.4, 'stand', { assault: true })).toBe('run');   // 衝鋒也是跑
  });

  it('靜止時依現有姿態設定:散兵坑臥射、跪射、站哨待機', () => {
    expect(pickClip(0, 'dig')).toBe('prone_fire');
    expect(pickClip(0, 'kneel')).toBe('kneel_fire');
    expect(pickClip(0, 'stand')).toBe('idle');
    expect(pickClip(0, 'advance')).toBe('idle');
  });

  it('守勢姿態對航線曲線的微漂移不敏感(不會在坑裡踏步行軍)', () => {
    expect(pickClip(0.5, 'dig')).toBe('prone_fire');
    expect(pickClip(0.5, 'kneel')).toBe('kneel_fire');
    expect(pickClip(0.5, 'stand')).toBe('walk');   // 一般姿態仍照 0.2 的門檻
    expect(pickClip(1.6, 'dig')).toBe('walk');     // 真的起身轉進還是走
  });

  it('播放倍率 = 實際速度 ÷ clip 的 extras.speed(腳不滑),並夾住極端值', () => {
    expect(clipRate(1.4, 1.4)).toBeCloseTo(1);
    expect(clipRate(2.8, 1.4)).toBeCloseTo(2);
    expect(clipRate(0.1, 1.4)).toBe(0.55);     // 冷場快轉／微漂移不要變成慢動作
    expect(clipRate(99, 3.5)).toBe(2.2);       // 也不要變成快轉小人
    expect(clipRate(2, 0)).toBe(1);            // 沒有 extras.speed 的 clip(idle 等)
  });

  it('三個變體與七個 clip 的名字與 glb 對得上', () => {
    expect(Object.keys(RIG_FILE).sort()).toEqual(['de', 'de_coat', 'us']);
    expect(RIG_CLIPS).toContain('crouch_walk');
    expect(RIG_CLIPS).toContain('hit_fall');
    expect(RIG_CLIPS).toHaveLength(7);
  });
});
