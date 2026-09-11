import { describe, it, expect } from 'vitest';
import {
  interpolateTrack,
  activeEvents,
  newEvents,
  unitStateAt,
} from '../src/midway/engine/timeline.js';

describe('interpolateTrack', () => {
  const track = [
    { t: 0, x: 0, z: 0 },
    { t: 10, x: 100, z: 0 },
    { t: 20, x: 100, z: 50 },
  ];

  // M-1(2026-09-12)起改為非均勻 Catmull-Rom 曲線插值,第一段另有起步緩動,
  // 故中點不再等於線性中點。曲線契約(對齊航點、有界、確定性、緩動)由
  // tests/midway-timeline.test.js 完整涵蓋;此處只確認仍在第一段內單調前進。
  it('中點落在第一段航點之間並單調前進', () => {
    const p = interpolateTrack(track, 5);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(100);
    expect(interpolateTrack(track, 7).x).toBeGreaterThan(p.x);
    expect(Math.abs(p.z)).toBeLessThan(6); // 曲線為了接下一個轉彎會略微外凸
  });

  it('在時間範圍之前回傳第一個點', () => {
    const p = interpolateTrack(track, -5);
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
  });

  it('在時間範圍之後回傳最後一個點', () => {
    const p = interpolateTrack(track, 99);
    expect(p.x).toBe(100);
    expect(p.z).toBe(50);
  });

  it('回傳目前航向(朝 +x 移動時 heading 為 90 度,以北 -z 為 0 順時針)', () => {
    const p = interpolateTrack(track, 5);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 0.8); // 曲線切線,容許轉彎預備的些微偏差
  });

  it('單一點航跡視為固定位置', () => {
    const p = interpolateTrack([{ t: 0, x: 7, z: 8 }], 50);
    expect(p.x).toBe(7);
    expect(p.z).toBe(8);
  });
});

describe('events', () => {
  const events = [
    { t: 10, title: 'A' },
    { t: 20, title: 'B' },
    { t: 30, title: 'C' },
  ];

  it('activeEvents 回傳 t 之前(含)的所有事件', () => {
    expect(activeEvents(events, 20).map((e) => e.title)).toEqual(['A', 'B']);
  });

  it('newEvents 回傳 (prevT, t] 區間內新觸發的事件', () => {
    expect(newEvents(events, 10, 30).map((e) => e.title)).toEqual(['B', 'C']);
  });

  it('newEvents 在無新事件時回傳空陣列', () => {
    expect(newEvents(events, 30, 35)).toEqual([]);
  });
});

describe('unitStateAt', () => {
  const unit = {
    id: 'kaga',
    strength: { aircraft: 74 },
    track: [
      { t: 0, x: 0, z: 0 },
      { t: 100, x: 100, z: 0 },
    ],
    statusChanges: [
      { t: 50, status: 'burning' },
      { t: 80, status: 'sunk', strengthDelta: { aircraft: -74 } },
    ],
  };

  it('初始狀態為 normal 且戰力為初始值', () => {
    const s = unitStateAt(unit, 10);
    expect(s.status).toBe('normal');
    expect(s.strength.aircraft).toBe(74);
  });

  it('狀態變化後回傳新狀態', () => {
    expect(unitStateAt(unit, 60).status).toBe('burning');
  });

  it('strengthDelta 累計到戰力', () => {
    expect(unitStateAt(unit, 90).strength.aircraft).toBe(0);
  });

  it('沉沒後位置固定在沉沒時刻的位置', () => {
    const s = unitStateAt(unit, 95);
    expect(s.status).toBe('sunk');
    expect(s.pos.x).toBeCloseTo(80);
  });

  it('沉沒前正常依航跡移動', () => {
    expect(unitStateAt(unit, 50).pos.x).toBeCloseTo(50);
  });
});
