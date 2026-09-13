// 十字路口 R5 畫質分級與 R1 骨架動畫的純邏輯單元測試。
// WebGL／glTF 載入那半部靠實機截圖驗收；這裡只鎖住容易悄悄壞掉的規則：
//   ① 等級判定的優先序（?q= → localStorage → UNMASKED_RENDERER）
//   ② 三級參數表的單調性（越低不能反而越貴）
//   ③ clip 選擇與播放倍率（腳不滑、衝鋒段一定是 run、拖曳跳轉不會誤判成衝刺）
import { describe, it, expect } from 'vitest';
import {
  resolveTier, tierFromRenderer, qualityParams, cycleTier, lowerTier,
  createFrameWatcher, TIERS,
} from '../src/crossroads/scene/quality.js';
import { pickClip, clipRate, apparentSpeed, CHARGE_WINDOW } from '../src/crossroads/scene/soldiers.js';

describe('等級判定（R5 §1）', () => {
  it('?q= 蓋過 localStorage 與自動判定，且標記為 forced', () => {
    const r = resolveTier({ query: 'low', stored: 'high', renderer: 'NVIDIA GeForce RTX 4090' });
    expect(r.tier).toBe('low');
    expect(r.forced).toBe(true);
  });

  it('沒有 ?q= 時用 localStorage', () => {
    const r = resolveTier({ stored: 'medium', renderer: 'NVIDIA GeForce RTX 4090' });
    expect(r.tier).toBe('medium');
    expect(r.forced).toBe(false);
  });

  it('亂寫的值不算數，落回自動判定', () => {
    expect(resolveTier({ query: 'ultra', stored: 'potato', renderer: 'NVIDIA' }).tier).toBe('high');
  });

  it('內顯／行動 GPU／軟體 renderer 一律 medium 起跳', () => {
    for (const name of [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple GPU', 'Mali-G78', 'Adreno (TM) 640', 'SwiftShader', 'llvmpipe', 'Intel Iris Xe',
    ]) expect(tierFromRenderer(name)).toBe('medium');
  });

  it('獨顯 → high；問不到名字也當 high（寧可先給好的再自動降）', () => {
    expect(tierFromRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, D3D11)')).toBe('high');
    expect(tierFromRenderer('AMD Radeon RX 6800')).toBe('high');
    expect(tierFromRenderer('')).toBe('high');
  });
});

describe('三級參數表（R5 §2）', () => {
  const H = qualityParams('high');
  const M = qualityParams('medium');
  const L = qualityParams('low');

  it('GTAO 只有 high 有；低兩級一律關', () => {
    expect(H.passes.gtao).toBe(true);
    expect(M.passes.gtao).toBe(false);
    expect(L.passes.gtao).toBe(false);
  });

  it('陰影：CSM 3 層 2048 → 2 層 1536 → 單張正交 1024', () => {
    expect(H.shadowMode).toBe('csm');
    expect(H.csm).toEqual({ cascades: 3, mapSize: 2048 });
    expect(M.csm).toEqual({ cascades: 2, mapSize: 1536 });
    expect(L.shadowMode).toBe('ortho');
    expect(L.shadowMapSize).toBe(1024);
  });

  it('low 只留 OutputPass ＋ 調色（bloom／SMAA／景深全關）', () => {
    expect(L.postfx).toBe(true);
    expect(L.passes).toEqual({ gtao: false, bloom: false, smaa: false, bokeh: false });
    expect(M.passes.bloom).toBe(true);
    expect(M.bloomScale).toBe(0.5);   // medium 的 bloom 是半解析度
  });

  it('pixelRatio 上限 2 / 1.25 / 1', () => {
    expect([H.pixelRatioCap, M.pixelRatioCap, L.pixelRatioCap]).toEqual([2, 1.25, 1]);
  });

  it('植被：high 吃 _hi 全幾何、medium 一般版半量、low 完全回程序化', () => {
    expect(H.vegetation).toMatchObject({ glb: true, heroHi: true, midFactor: 1 });
    expect(M.vegetation).toMatchObject({ glb: true, heroHi: false, midFactor: 0.5 });
    expect(L.vegetation.glb).toBe(false);
    expect(L.grassFactor).toBe(0);
  });

  it('mixer 更新頻率 1 / 2 / 3 幀', () => {
    expect([H.mixerStride, M.mixerStride, L.mixerStride]).toEqual([1, 2, 3]);
  });

  it('每一項旋鈕都是單調遞減（低一級不可以反而更貴）', () => {
    const levels = [H, M, L];
    for (const key of ['pixelRatioCap', 'grassFactor', 'particleFactor', 'cloudFactor', 'mistFactor']) {
      expect(levels[0][key]).toBeGreaterThanOrEqual(levels[1][key]);
      expect(levels[1][key]).toBeGreaterThanOrEqual(levels[2][key]);
    }
    expect(H.mixerStride).toBeLessThanOrEqual(M.mixerStride);
    expect(M.mixerStride).toBeLessThanOrEqual(L.mixerStride);
  });

  it('烘焙模型：high／medium 吃 _baked，low 用平塗版', () => {
    expect([H.baked, M.baked, L.baked]).toEqual([true, true, false]);
  });

  it('手機維持既有分流（無陰影、無後製、不換 glb 植被、mixer 每 2 幀）', () => {
    const mob = qualityParams('high', { mobile: true });
    expect(mob.tier).toBe('mobile');
    expect(mob.shadows).toBe(false);
    expect(mob.postfx).toBe(false);
    expect(mob.vegetation.glb).toBe(false);
    expect(mob.grassFactor).toBe(0);
    expect(mob.mixerStride).toBe(2);
    expect(mob.baked).toBe(false);
  });

  it('高 → 中 → 低 循環；low 不能再降', () => {
    expect(TIERS).toEqual(['high', 'medium', 'low']);
    expect(cycleTier('high')).toBe('medium');
    expect(cycleTier('low')).toBe('high');
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('low')).toBe(null);
  });
});

describe('執行期自動降級（R5 §1）', () => {
  const run = (watcher, ms, seconds) => {
    let out = null;
    for (let t = 0; t < seconds; t += ms / 1000) out = watcher.sample(ms / 1000) ?? out;
    return out;
  };

  it('連續 3 秒平均 > 40 ms 才降一級（暖機 3 秒不算）', () => {
    let got = null;
    const w = createFrameWatcher({ tier: 'high', warmup: 3, onDowngrade: (t) => { got = t; } });
    expect(run(w, 50, 2.9)).toBe(null);      // 還在暖機
    expect(got).toBe(null);
    run(w, 50, 3.2);                          // 暖機過後滿 3 秒
    expect(got).toBe('medium');
  });

  it('幀時間在預算內就不降', () => {
    const w = createFrameWatcher({ tier: 'high', warmup: 0 });
    expect(run(w, 20, 12)).toBe(null);
  });

  it('已經是 low 就不再降（不會連環重載）', () => {
    const w = createFrameWatcher({ tier: 'low', warmup: 0 });
    expect(run(w, 120, 12)).toBe(null);
  });

  it('量測期間（freezeQuality／dbgPerf）暫停取樣', () => {
    const w = createFrameWatcher({ tier: 'high', warmup: 0 });
    w.setPaused(true);
    expect(run(w, 120, 12)).toBe(null);
    w.setPaused(false);
    expect(run(w, 120, 4)).toBe('medium');
  });
});

describe('R1 clip 選擇（soldiers.pickClip）', () => {
  it('靜止守軍依姿態：跪射／趴射／待機', () => {
    expect(pickClip({ kind: 'garrison', pose: 'kneel', speed: 0, battleT: 250 })).toBe('kneel_fire');
    expect(pickClip({ kind: 'garrison', pose: 'stand', speed: 0, battleT: 250 })).toBe('idle');
    expect(pickClip({ kind: 'support', pose: 'stand', speed: 0, battleT: 300 })).toBe('prone_fire');
    expect(pickClip({ kind: 'support', pose: 'kneel', speed: 0, battleT: 300 })).toBe('kneel_fire');
  });

  it('接敵前的突擊隊低姿前進（crouch_walk），其他單位走 walk', () => {
    expect(pickClip({ kind: 'assault', pose: 'advance', speed: 1.2, battleT: 290 })).toBe('crouch_walk');
    expect(pickClip({ kind: 'infantry', pose: 'advance', speed: 1.2, battleT: 290 })).toBe('walk');
  });

  it('上刺刀衝鋒段一律 run（diorama 尺度下光靠速度門檻跨不過去）', () => {
    const [a, b] = CHARGE_WINDOW;
    expect(pickClip({ kind: 'assault', pose: 'advance', speed: 0.5, battleT: a })).toBe('run');
    expect(pickClip({ kind: 'assault', pose: 'advance', speed: 0.5, battleT: b - 1 })).toBe('run');
    expect(pickClip({ kind: 'assault', pose: 'advance', speed: 0.5, battleT: b })).not.toBe('run');
  });

  it('速度超過 2.2 m/s 一律 run；低於 0.2 視為靜止', () => {
    expect(pickClip({ kind: 'infantry', pose: 'stand', speed: 3, battleT: 250 })).toBe('run');
    expect(pickClip({ kind: 'infantry', pose: 'stand', speed: 0.1, battleT: 250 })).toBe('idle');
  });

  it('摧毀時播 hit_fall（蓋過所有其他狀態）', () => {
    expect(pickClip({ kind: 'mg', pose: 'kneel', speed: 5, battleT: 330, destroyed: true })).toBe('hit_fall');
  });
});

describe('R1 播放倍率（腳不滑）', () => {
  it('速度等於 clip 的 extras.speed 時倍率為 1', () => {
    expect(clipRate('walk', 1.4, 1.4)).toBeCloseTo(1, 6);
    expect(clipRate('run', 3.5, 3.5)).toBeCloseTo(1, 6);
  });

  it('倍率 = 實際速度 ÷ extras.speed', () => {
    expect(clipRate('walk', 2.1, 1.4)).toBeCloseTo(1.5, 6);
  });

  it('沒有 extras.speed 時退回各 clip 的規格值', () => {
    expect(clipRate('walk', 1.4, 0)).toBeCloseTo(1, 6);
    expect(clipRate('run', 3.5, undefined)).toBeCloseTo(1, 6);
  });

  it('夾住上下限：慢速不會變成定格、快速不會變成快轉', () => {
    expect(clipRate('run', 0.1, 3.5)).toBe(0.6);
    expect(clipRate('run', 99, 3.5)).toBe(1.9);
  });

  it('原地射擊／待機／倒地的 clip 一律原速', () => {
    for (const c of ['idle', 'kneel_fire', 'prone_fire', 'hit_fall']) {
      expect(clipRate(c, 5, 1.4)).toBe(1);
    }
  });
});

describe('場景尺度 → 小人自己的 m/s', () => {
  it('單調、非負、0 對 0', () => {
    expect(apparentSpeed(0)).toBe(0);
    expect(apparentSpeed(-3)).toBeCloseTo(apparentSpeed(3), 9);
    expect(apparentSpeed(4)).toBeGreaterThan(apparentSpeed(2));
  });

  it('沿用「3.29 × 1.15 場景單位 = 1.752 公尺身高」的換算（1 單位 ≈ 0.46 m）', () => {
    expect(apparentSpeed(1)).toBeCloseTo(1.752 / (3.29 * 1.15), 4);
  });
});
