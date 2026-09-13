// 布雷庫爾骨架小兵的動作選擇(src/brecourt/scene/soldiers.js,docs/realism-spec.md §R1.5)。
// setUnitMotion 是純狀態機:吃「這一幀螢幕上的速度」,吐出該播哪個 clip、播多快。
// 這裡用假的 mixer／action 餵它,不需要 WebGL,也不需要真的 glb。
import { describe, it, expect } from 'vitest';
import { setUnitMotion } from '../src/brecourt/scene/soldiers.js';

const CLIPS = ['idle', 'walk', 'run', 'crouch_walk', 'kneel_fire', 'prone_fire', 'hit_fall'];
const SPEEDS = { walk: 1.4, run: 3.5, crouch_walk: 1.0 };

function fakeAction(name) {
  const act = {
    name, timeScale: 1, time: 0, weight: 0, played: 0, loop: null, clamp: false,
    _clip: { name },
    setLoop(l) { act.loop = l; return act; },
    reset() { act.time = 0; return act; },
    setEffectiveWeight(w) { act.weight = w; return act; },
    fadeIn() { return act; },
    fadeOut() { act.weight = 0; return act; },
    play() { act.played++; return act; },
  };
  return act;
}

function fakeTrooper(pose, { phase = 0, upm = 2 } = {}) {
  const clips = new Map(CLIPS.map((n) => [n, { name: n, duration: 1, userData: SPEEDS[n] ? { speed: SPEEDS[n] } : {} }]));
  const mixer = { clipAction: (clip) => fakeAction(clip.name) };
  return { userData: { pose, anim: { mixer, clips, actions: new Map(), cur: null, phase, upm } } };
}

const unit = (...troopers) => ({ userData: { troopers } });
const current = (tr) => tr.userData.anim.cur;

describe('setUnitMotion — 依實際速度選 clip(§R1.5)', () => {
  it('靜止時依既有姿態:跪射／臥射／站立待機', () => {
    const k = fakeTrooper('kneel'); const p = fakeTrooper('prone'); const s = fakeTrooper('stand');
    setUnitMotion(unit(k, p, s), { speed: 0, kind: 'garrison' });
    expect(current(k).name).toBe('kneel_fire');
    expect(current(p).name).toBe('prone_fire');
    expect(current(s).name).toBe('idle');
  });

  it('慢速(> 0.2 m/s)走路;upm 把場景單位換算成公尺', () => {
    const tr = fakeTrooper('advance', { upm: 2 });   // 2 場景單位 = 1 公尺
    setUnitMotion(unit(tr), { speed: 2.8, kind: 'infantry' });   // → 1.4 m/s
    expect(current(tr).name).toBe('walk');
    expect(current(tr).timeScale).toBeCloseTo(1, 5);             // 正好等於 extras.speed
  });

  it('快速(> 2.2 m/s)改用跑,倍率 = 實際速度 ÷ extras.speed', () => {
    const tr = fakeTrooper('advance', { upm: 2 });
    setUnitMotion(unit(tr), { speed: 14, kind: 'infantry' });     // → 7 m/s
    expect(current(tr).name).toBe('run');
    expect(current(tr).timeScale).toBeCloseTo(2, 5);              // 7 / 3.5
  });

  it('突擊隊的接近段改成低姿前進', () => {
    const tr = fakeTrooper('advance', { upm: 2 });
    setUnitMotion(unit(tr), { speed: 2, kind: 'assault' });       // 1 m/s
    expect(current(tr).name).toBe('crouch_walk');
    expect(current(tr).timeScale).toBeCloseTo(1, 5);
  });

  it('倍率有上下限(冷場快轉時不會變成快動作默片)', () => {
    const fast = fakeTrooper('advance', { upm: 2 });
    setUnitMotion(unit(fast), { speed: 200, kind: 'infantry' });
    expect(current(fast).timeScale).toBeLessThanOrEqual(3);
    const slow = fakeTrooper('advance', { upm: 2 });
    setUnitMotion(unit(slow), { speed: 0.5, kind: 'infantry' });  // 0.25 m/s
    expect(current(slow).name).toBe('walk');
    expect(current(slow).timeScale).toBeGreaterThanOrEqual(0.35);
  });

  it('摧毀時播中彈倒地,而且不循環、停在最後一格', () => {
    const tr = fakeTrooper('kneel');
    setUnitMotion(unit(tr), { speed: 0, kind: 'garrison' });
    setUnitMotion(unit(tr), { speed: 0, kind: 'garrison', down: true });
    expect(current(tr).name).toBe('hit_fall');
    expect(current(tr).clampWhenFinished).toBe(true);   // 倒下去就不要彈回站姿
    expect(current(tr).loop).not.toBeNull();            // setLoop(LoopOnce)
    expect(current(tr).time).toBe(0);                   // 每次摧毀都從頭播
  });

  it('同一個動作重複下令不會每幀重播(只有切換時才 crossfade)', () => {
    const tr = fakeTrooper('advance', { upm: 2 });
    setUnitMotion(unit(tr), { speed: 2.8 });
    const first = current(tr);
    for (let i = 0; i < 10; i++) setUnitMotion(unit(tr), { speed: 2.8 });
    expect(current(tr)).toBe(first);
    expect(first.played).toBe(1);
  });

  it('同班各兵起始相位不同(不會齊步)', () => {
    const a = fakeTrooper('stand', { phase: 0 });
    const b = fakeTrooper('stand', { phase: Math.PI });
    setUnitMotion(unit(a, b), { speed: 0 });
    expect(current(a).time).toBeCloseTo(0, 6);
    expect(current(b).time).toBeCloseTo(0.5, 6);    // duration 1 的一半
  });

  it('還沒換成骨架的單位(沒有 anim)不會爆', () => {
    const plain = { userData: {} };
    expect(() => setUnitMotion(unit(plain), { speed: 5 })).not.toThrow();
    expect(() => setUnitMotion({ userData: {} }, { speed: 5 })).not.toThrow();
  });
});
