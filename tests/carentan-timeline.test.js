// 卡倫坦 A-1／M-1:非均勻 Catmull-Rom 曲線插值單元測試
// 涵蓋:單點/兩點/多點、t 超出頭尾、與航點時間精確對齊時位置=航點位置、切線 heading、確定性與有界(不飛點)
import { describe, it, expect } from 'vitest';
import { interpolateTrack, unitStateAt } from '../src/carentan/engine/timeline.js';

describe('interpolateTrack — 退化情形', () => {
  it('單一點航跡視為固定位置(沿用 heading 欄或 0)', () => {
    const p = interpolateTrack([{ t: 0, x: 7, z: 8, heading: 1.2 }], 50);
    expect(p.x).toBe(7);
    expect(p.z).toBe(8);
    expect(p.heading).toBeCloseTo(1.2);
  });

  it('兩點航跡退回直線插值(中點=線性中點)', () => {
    const track = [{ t: 0, x: 0, z: 0 }, { t: 10, x: 100, z: 40 }];
    const p = interpolateTrack(track, 5);
    expect(p.x).toBeCloseTo(50);
    expect(p.z).toBeCloseTo(20);
  });

  it('朝 +x 移動時 heading 約為 +90 度(北 -z 為 0、順時針)', () => {
    const track = [{ t: 0, x: 0, z: 0 }, { t: 10, x: 100, z: 0 }];
    expect(interpolateTrack(track, 5).heading).toBeCloseTo(Math.PI / 2);
  });
});

describe('interpolateTrack — 多點 Catmull-Rom', () => {
  const track = [
    { t: 0, x: 0, z: 0 },
    { t: 10, x: 100, z: 0 },
    { t: 20, x: 100, z: 80 },
    { t: 30, x: 40, z: 120 },
  ];

  it('與航點時間精確對齊時,位置=該航點位置(Barry–Goldman 內插性)', () => {
    for (const wp of track) {
      const p = interpolateTrack(track, wp.t);
      expect(p.x).toBeCloseTo(wp.x, 6);
      expect(p.z).toBeCloseTo(wp.z, 6);
    }
  });

  it('t 在範圍之前 → 第一點;之後 → 最後一點', () => {
    const a = interpolateTrack(track, -100);
    expect(a.x).toBe(0); expect(a.z).toBe(0);
    const b = interpolateTrack(track, 999);
    expect(b.x).toBe(40); expect(b.z).toBe(120);
  });

  it('曲線不飛點:任意 t 的位置落在所有航點包圍盒略微擴張的範圍內', () => {
    const xs = track.map((p) => p.x), zs = track.map((p) => p.z);
    const pad = 40; // 允許曲線輕微外凸,但不得爆走
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minZ = Math.min(...zs) - pad, maxZ = Math.max(...zs) + pad;
    for (let t = 0; t <= 30; t += 0.37) {
      const p = interpolateTrack(track, t);
      expect(p.x).toBeGreaterThanOrEqual(minX);
      expect(p.x).toBeLessThanOrEqual(maxX);
      expect(p.z).toBeGreaterThanOrEqual(minZ);
      expect(p.z).toBeLessThanOrEqual(maxZ);
      expect(Number.isFinite(p.heading)).toBe(true);
    }
  });

  it('確定性:相同 t 兩次呼叫結果一致(冷場快轉/拖曳跳轉可信賴)', () => {
    const p1 = interpolateTrack(track, 17.3);
    const p2 = interpolateTrack(track, 17.3);
    expect(p1).toEqual(p2);
  });

  it('起步緩動:第一段極早期位移量小於等時間的中段位移量(ease-in)', () => {
    const d = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
    const start = d(interpolateTrack(track, 0), interpolateTrack(track, 0.5));   // 第一段起步
    const mid = d(interpolateTrack(track, 15), interpolateTrack(track, 15.5));   // 中段
    expect(start).toBeLessThan(mid);
  });
});

describe('unitStateAt — 沿用曲線插值', () => {
  const unit = {
    id: 'e-co',
    strength: { men: 120 },
    track: [
      { t: 0, x: 0, z: 0 },
      { t: 50, x: 60, z: 0 },
      { t: 100, x: 60, z: 60 },
    ],
    statusChanges: [{ t: 60, status: 'destroyed', strengthDelta: { men: -120 } }],
  };

  it('摧毀後位置凍結在摧毀時刻', () => {
    const s = unitStateAt(unit, 95);
    const frozen = interpolateTrack(unit.track, 60);
    expect(s.status).toBe('destroyed');
    expect(s.pos.x).toBeCloseTo(frozen.x, 6);
    expect(s.pos.z).toBeCloseTo(frozen.z, 6);
  });

  it('摧毀前依航跡移動、戰力遞減', () => {
    expect(unitStateAt(unit, 40).status).toBe('normal');
    expect(unitStateAt(unit, 65).strength.men).toBe(0);
  });
});
