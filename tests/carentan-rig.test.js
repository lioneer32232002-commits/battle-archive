// 卡倫坦 R1 士兵骨架動畫（src/carentan/scene/rig.js）的純函式單元測試
// 涵蓋：clip 依實際速度／情境選擇與播放倍率、extras.speed 讀取、
//       五個 primitive 合併成單一蒙皮幾何（1 draw call）、武器縫進 hand_R 骨頭。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  pickClip, clipSpeeds, mergeSkinnedParts, weaponSkinGeometry,
  SOLDIER_SCALE, CLIP_SPEED, RUN_AT, WALK_AT,
} from '../src/carentan/scene/rig.js';

describe('pickClip — 依實際移動速度選 clip（§R1.5）', () => {
  it('> 2.2 m/s 跑、> 0.2 m/s 走、靜止 idle', () => {
    expect(pickClip(3.5, {}).clip).toBe('run');
    expect(pickClip(RUN_AT + 0.01, {}).clip).toBe('run');
    expect(pickClip(1.4, {}).clip).toBe('walk');
    expect(pickClip(WALK_AT + 0.01, {}).clip).toBe('walk');
    expect(pickClip(0, {}).clip).toBe('idle');
    expect(pickClip(0.05, {}).clip).toBe('idle');
  });

  it('播放倍率 = 實際速度 ÷ extras.speed（腳不滑）', () => {
    expect(pickClip(1.4, {}).timeScale).toBeCloseTo(1, 6);
    expect(pickClip(3.5, {}).timeScale).toBeCloseTo(1, 6);
    expect(pickClip(2.1, {}).timeScale).toBeCloseTo(2.1 / CLIP_SPEED.walk, 6);
    expect(pickClip(5.25, {}).timeScale).toBeCloseTo(1.5, 6);
  });

  it('倍率有上下限（拖曳／快轉時不會變成慢動作或抽筋）', () => {
    expect(pickClip(40, {}).timeScale).toBeLessThanOrEqual(2.2);
    expect(pickClip(0.25, {}).timeScale).toBeGreaterThanOrEqual(0.55);
  });

  it('街戰逐屋肅清段（hint=clear）移動中一律 crouch_walk', () => {
    expect(pickClip(1.0, { hint: 'clear' }).clip).toBe('crouch_walk');
    expect(pickClip(3.0, { hint: 'clear' }).clip).toBe('crouch_walk');
    expect(pickClip(1.0, { hint: 'clear' }).timeScale).toBeCloseTo(1 / CLIP_SPEED.crouch_walk, 6);
    // 站住了就不再 crouch_walk（改吃姿態）
    expect(pickClip(0, { hint: 'clear' }).clip).toBe('idle');
  });

  it('路堤守軍（hint=defend）靜止時跪射／臥射', () => {
    expect(pickClip(0, { hint: 'defend', posture: 'stand' }).clip).toBe('kneel_fire');
    expect(pickClip(0, { hint: 'defend', posture: 'prone' }).clip).toBe('prone_fire');
    // 守軍一旦移動仍然要走路，不能跪著平移
    expect(pickClip(1.2, { hint: 'defend' }).clip).toBe('walk');
  });

  it('程序化姿態 kneel 的小兵靜止時就是跪射', () => {
    expect(pickClip(0, { posture: 'kneel' }).clip).toBe('kneel_fire');
  });

  it('單位被摧毀 → hit_fall（不循環）', () => {
    const r = pickClip(4, { downed: true });
    expect(r.clip).toBe('hit_fall');
    expect(r.once).toBe(true);
  });

  it('速度是 NaN／負數也不會炸（拖曳時間軸的第一幀）', () => {
    expect(pickClip(NaN, {}).clip).toBe('idle');
    expect(pickClip(-3, {}).clip).toBe('run');
  });
});

describe('clipSpeeds — 讀 glTF animation 的 extras.speed', () => {
  it('讀得到就用 glb 的值，讀不到用預設', () => {
    const clips = [
      Object.assign(new THREE.AnimationClip('walk', 1, []), { userData: { extras: { speed: 1.25 } } }),
      Object.assign(new THREE.AnimationClip('run', 1, []), { userData: { extras: { speed: 4 } } }),
      new THREE.AnimationClip('idle', 2, []),
    ];
    const s = clipSpeeds(clips);
    expect(s.walk).toBe(1.25);
    expect(s.run).toBe(4);
    expect(s.crouch_walk).toBe(CLIP_SPEED.crouch_walk);
  });

  it('沒有 clip 就整份用預設', () => {
    expect(clipSpeeds([])).toEqual(CLIP_SPEED);
    expect(clipSpeeds(undefined)).toEqual(CLIP_SPEED);
  });
});

describe('尺度', () => {
  it('站姿 1.75 公尺對到 3.25 場景單位（與程序化小兵同一個倍率）', () => {
    expect(SOLDIER_SCALE).toBeCloseTo(3.25 / 1.75, 6);
  });
});

// ── 測試用：做一個「兩個 primitive、共用一副骨架」的迷你蒙皮網格 ──
function makeSkin(nBones = 2) {
  const bones = [];
  for (let i = 0; i < nBones; i++) {
    const b = new THREE.Bone();
    b.name = i === 0 ? 'root' : 'hand_R';
    b.position.set(0, i, 0);
    if (i > 0) bones[i - 1].add(b);
    bones.push(b);
  }
  bones[0].updateMatrixWorld(true);   // boneInverses 是從 bind 姿勢的 matrixWorld 算出來的
  const skeleton = new THREE.Skeleton(bones);
  const part = (color) => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ color }));
    m.bind(skeleton);
    return m;
  };
  return { skeleton, bones, parts: [part(0xff0000), part(0x00ff00)] };
}

describe('mergeSkinnedParts — 5 個材質 primitive → 1 個 draw call', () => {
  it('合併後頂點數相加，材質顏色烘進頂點色', () => {
    const { parts } = makeSkin();
    const geo = mergeSkinnedParts(parts);
    const a = parts[0].geometry.attributes.position.count;
    const b = parts[1].geometry.attributes.position.count;
    expect(geo.attributes.position.count).toBe(a + b);
    expect(geo.attributes.color).toBeTruthy();
    // 第一段是紅、第二段是綠（linear-sRGB 之後仍然 r=1,g=0 / r=0,g=1）
    const c = geo.attributes.color;
    expect(c.getX(0)).toBeCloseTo(1, 5);
    expect(c.getY(0)).toBeCloseTo(0, 5);
    expect(c.getX(a)).toBeCloseTo(0, 5);
    expect(c.getY(a)).toBeCloseTo(1, 5);
  });

  it('蒙皮屬性保留（不然合併完就不會動了）', () => {
    const geo = mergeSkinnedParts(makeSkin().parts);
    expect(geo.attributes.skinIndex).toBeTruthy();
    expect(geo.attributes.skinWeight).toBeTruthy();
    expect(geo.attributes.uv).toBeUndefined();   // uv 用不到，丟掉才合併得起來
  });

  it('沒有 primitive 就回 null（呼叫端保留靜態版本）', () => {
    expect(mergeSkinnedParts([])).toBeNull();
  });
});

describe('weaponSkinGeometry — 武器縫進 hand_R（不多一個 draw call）', () => {
  it('所有頂點 100% 綁在 hand_R 那根骨頭上', () => {
    const { parts, bones } = makeSkin();
    const skin = parts[0];
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    const geo = weaponSkinGeometry(weapon, skin, 'hand_R');
    const idx = bones.findIndex((b) => b.name === 'hand_R');
    expect(geo).toBeTruthy();
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    for (let i = 0; i < si.count; i++) {
      expect(si.getX(i)).toBe(idx);
      expect(sw.getX(i)).toBe(1);
      expect(sw.getY(i)).toBe(0);
    }
  });

  it('頂點被搬到骨頭的 bind 空間（動畫時才會跟著手走）', () => {
    const { parts } = makeSkin();
    const skin = parts[0];
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
    const geo = weaponSkinGeometry(weapon, skin, 'hand_R');
    // hand_R 的 bind 位置是 (0,1,0) → 武器原點被移到那裡
    const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const c = box.getCenter(new THREE.Vector3());
    expect(c.y).toBeCloseTo(1, 5);
  });

  it('屬性集合與蒙皮幾何一致，兩者可以再合併成一份', () => {
    const { parts } = makeSkin();
    const body = mergeSkinnedParts(parts);
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1), new THREE.MeshStandardMaterial());
    const wg = weaponSkinGeometry(weapon, parts[0], 'hand_R');
    expect(Object.keys(wg.attributes).sort()).toEqual(Object.keys(body.attributes).sort());
  });

  it('找不到那根骨頭就回 null（武器不掛，士兵照樣會動）', () => {
    const { parts } = makeSkin();
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    expect(weaponSkinGeometry(weapon, parts[0], 'hand_LEFT_NOPE')).toBeNull();
    expect(weaponSkinGeometry(null, parts[0])).toBeNull();
  });
});
