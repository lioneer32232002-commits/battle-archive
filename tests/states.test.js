// 關鍵時刻狀態驗證:面板數字與沉沒/燃燒狀態
import { describe, it, expect } from 'vitest';
import { units } from '../src/midway/data/battle.js';
import { unitStateAt } from '../src/midway/engine/timeline.js';

const at = (id, t) => unitStateAt(units.find((u) => u.id === id), t);

describe('關鍵時刻單位狀態', () => {
  it('10:40 三艦燃燒、戰力歸零', () => {
    for (const id of ['akagi', 'kaga', 'soryu']) {
      const s = at(id, 640);
      expect(s.status).toBe('burning');
      expect(s.strength.aircraft).toBe(0);
    }
  });

  it('17:20 飛龍燃燒戰力歸零、約克鎮燃燒 61 機', () => {
    expect(at('hiryu', 1040).status).toBe('burning');
    expect(at('hiryu', 1040).strength.aircraft).toBe(0);
    expect(at('yorktown', 1040).status).toBe('burning');
    expect(at('yorktown', 1040).strength.aircraft).toBe(61);
  });

  it('尾聲:四艦與約克鎮沉沒', () => {
    expect(at('soryu', 1160).status).toBe('sunk');
    expect(at('kaga', 1170).status).toBe('sunk');
    expect(at('akagi', 1190).status).toBe('sunk');
    expect(at('hiryu', 1210).status).toBe('sunk');
    expect(at('yorktown', 1265).status).toBe('sunk');
  });

  it('飛龍最終位置在編隊北方', () => {
    const hiryu = at('hiryu', 1100);
    const akagi = at('akagi', 1100);
    expect(hiryu.pos.z).toBeLessThan(akagi.pos.z); // -z 為北
  });
});
