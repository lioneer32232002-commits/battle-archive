// 卡倫坦 R5 畫質分級（src/carentan/scene/quality.js）的純函式單元測試
// 涵蓋：等級判定順序（?q= → localStorage → GPU 字串）、三級參數表、需重建判定、
//       執行期自動降級（連續 3 秒 > 40 ms 降一級、只降不升、凍結時不動）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TIERS, resolveTier, tierFromRenderer, needsRebuild, nextTier,
  getQuality, createAutoDowngrade, onQualityChange, __resetQuality,
} from '../src/carentan/scene/quality.js';

beforeEach(() => __resetQuality());

describe('等級判定（§R5.1）', () => {
  it('?q= 優先於 localStorage 與自動判定', () => {
    expect(resolveTier({ query: 'low', stored: 'high', renderer: 'NVIDIA RTX 4090' }))
      .toEqual({ tier: 'low', source: 'query' });
  });

  it('沒有 ?q= 時用 localStorage 的記憶（自動降級後的下次載入）', () => {
    expect(resolveTier({ stored: 'medium', renderer: 'NVIDIA RTX 4090' }))
      .toEqual({ tier: 'medium', source: 'storage' });
  });

  it('都沒有就看 UNMASKED_RENDERER', () => {
    expect(resolveTier({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00008A56) Direct3D11)' }))
      .toEqual({ tier: 'medium', source: 'auto' });
    expect(resolveTier({ renderer: 'ANGLE (NVIDIA GeForce RTX 3070 Direct3D11)' }))
      .toEqual({ tier: 'high', source: 'auto' });
  });

  it('亂寫的 ?q= 不採用，退回自動判定', () => {
    expect(resolveTier({ query: 'ultra', renderer: 'Apple GPU' }).source).toBe('auto');
  });

  it('內顯／行動 GPU／軟體渲染一律 medium', () => {
    for (const gpu of ['Intel Iris Xe', 'Apple GPU', 'Mali-G78', 'Adreno (TM) 640', 'SwiftShader', 'llvmpipe']) {
      expect(tierFromRenderer(gpu)).toBe('medium');
    }
    expect(tierFromRenderer('AMD Radeon RX 7900 XTX')).toBe('high');
    expect(tierFromRenderer(null)).toBe('high');   // 拿不到字串就當獨顯，由執行期自動降級兜底
  });
});

describe('三級參數表（§R5.2）', () => {
  it('GTAO 只有 high 開，陰影 3 層 2048 → 2 層 1536 → 單張正交 1024', () => {
    expect([TIERS.high.gtao, TIERS.medium.gtao, TIERS.low.gtao]).toEqual([true, false, false]);
    expect([TIERS.high.cascades, TIERS.medium.cascades]).toEqual([3, 2]);
    expect([TIERS.high.shadowMapSize, TIERS.medium.shadowMapSize, TIERS.low.shadowMapSize])
      .toEqual([2048, 1536, 1024]);
    expect(TIERS.low.shadow).toBe('legacy');
  });

  it('pixelRatio 上限 2 / 1.25 / 1；mixer 每 1 / 2 / 3 幀', () => {
    expect([TIERS.high.pixelRatio, TIERS.medium.pixelRatio, TIERS.low.pixelRatio]).toEqual([2, 1.25, 1]);
    expect([TIERS.high.mixerStride, TIERS.medium.mixerStride, TIERS.low.mixerStride]).toEqual([1, 2, 3]);
  });

  it('植被：high 吃 _hi、medium 一般版半量、low 全程序化；草叢 1 / 0.5 / 0', () => {
    expect([TIERS.high.heroVegetation, TIERS.medium.heroVegetation, TIERS.low.heroVegetation])
      .toEqual(['hi', 'normal', 'none']);
    expect([TIERS.high.grassDetail, TIERS.medium.grassDetail, TIERS.low.grassDetail]).toEqual([1, 0.5, 0]);
  });

  it('烘焙版模型只給桌機 high／medium（§R2.4）', () => {
    expect([TIERS.high.baked, TIERS.medium.baked, TIERS.low.baked]).toEqual([true, true, false]);
  });

  it('low 的後製只剩 OutputPass ＋ 調色（bloom／景深／SMAA 全關）', () => {
    expect(TIERS.low.bloom).toBe(false);
    expect(TIERS.low.bokeh).toBe(false);
    expect(TIERS.low.smaa).toBe(false);
    expect(TIERS.medium.bloomScale).toBe(0.5);   // medium：bloom 半解析度
  });
});

describe('降級路徑', () => {
  it('nextTier 高 → 中 → 低，到底不再往下', () => {
    expect(nextTier('high')).toBe('medium');
    expect(nextTier('medium')).toBe('low');
    expect(nextTier('low')).toBe('low');
  });

  it('三級之間都有「需重建」的差異（cascade 層數、composer 組成、植被）', () => {
    expect(needsRebuild('high', 'medium')).toBe(true);
    expect(needsRebuild('medium', 'low')).toBe(true);
    expect(needsRebuild('high', 'high')).toBe(false);
  });
});

describe('getQuality（無 DOM 環境也要能跑）', () => {
  it('回傳 tier 與整組參數，且是冪等的單例', () => {
    const q = getQuality();
    expect(q.tier).toBe('high');          // node 環境拿不到 GPU 字串 → high
    expect(q.mixerStride).toBe(1);
    expect(getQuality()).toBe(q);
  });

  it('手機一律走 low 的參數（既有 mobile 分支優先，見各模組）', () => {
    const q = getQuality({ mobile: true });
    expect(q.tier).toBe('low');
    expect(q.mobile).toBe(true);
  });
});

describe('執行期自動降級（§R5.1）', () => {
  const feed = (auto, ms, seconds) => {
    const dt = ms / 1000;
    for (let t = 0; t < seconds; t += dt) auto.sample(dt);
  };

  it('連續 3 秒平均幀時間 > 40 ms → 降一級，並通知 listeners', () => {
    getQuality();
    const seen = [];
    onQualityChange((q) => seen.push(q.tier));
    const onInstant = vi.fn();
    const auto = createAutoDowngrade({ onInstant, reload: false });
    feed(auto, 50, 4);
    expect(seen).toEqual(['medium']);
    expect(onInstant).toHaveBeenCalledTimes(1);
    expect(onInstant.mock.calls[0][0].tier).toBe('medium');
  });

  it('只有 2 秒超標不降級（不因為一次卡頓就掉畫質）', () => {
    getQuality();
    const onInstant = vi.fn();
    const auto = createAutoDowngrade({ onInstant, reload: false });
    feed(auto, 50, 2);
    feed(auto, 12, 3);
    expect(onInstant).not.toHaveBeenCalled();
  });

  it('量測／截圖期間（__dbg.freezeQuality）完全不動', () => {
    getQuality();
    const onInstant = vi.fn();
    const auto = createAutoDowngrade({ onInstant, reload: false, paused: () => true });
    feed(auto, 80, 10);
    expect(onInstant).not.toHaveBeenCalled();
  });

  it('掉到 low 之後不再降（也永遠不自動升回去）', () => {
    getQuality();
    const tiers = [];
    onQualityChange((q) => tiers.push(q.tier));
    const auto = createAutoDowngrade({ reload: false });
    feed(auto, 60, 4);
    feed(auto, 60, 4);
    feed(auto, 60, 4);
    expect(tiers).toEqual(['medium', 'low']);
    feed(auto, 8, 6);            // 之後跑很順也不會自己升回去
    expect(tiers).toEqual(['medium', 'low']);
  });

  it('?q= 指定的等級不自動降級（否則 reload 後又被拉回去 → 無限重載）', () => {
    getQuality();
    const onInstant = vi.fn();
    const auto = createAutoDowngrade({ enabled: false, onInstant, reload: false });
    feed(auto, 90, 8);
    expect(onInstant).not.toHaveBeenCalled();
  });
});
