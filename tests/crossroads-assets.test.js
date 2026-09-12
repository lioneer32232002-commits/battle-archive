// 十字路口資產整合（docs/asset-pipeline-spec.md §3）：純數學／純資料部分的單元測試。
// 貼圖、HDRI、glTF 載入本身要 WebGL 與網路，那部分靠實機截圖驗收；這裡只鎖住
// 「glb 依 bounding box 對齊既有程序化模型尺度」與 uv1 補齊這兩條容易悄悄壞掉的規則。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitToHeight, fitToWidth, ensureUV1 } from '../src/crossroads/scene/assets.js';

function boxObject(w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.geometry.translate(0, h / 2, 0);   // 模型慣例：原點在底部中心
  return m;
}

describe('fitToHeight — 依高度對齊場景尺度', () => {
  it('把 1.8 公尺的人形縮放到程序化小人的 3.29 單位', () => {
    const { scale, size } = fitToHeight(boxObject(0.5, 1.8, 0.3), 3.29);
    expect(size.y).toBeCloseTo(1.8, 5);
    expect(scale).toBeCloseTo(3.29 / 1.8, 5);
  });

  it('縮放後的實際高度就是目標高度', () => {
    const o = boxObject(2, 5, 2);
    const { scale } = fitToHeight(o, 16);
    o.scale.setScalar(scale);
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(16, 4);
  });

  it('零高度的退化物件不會產生 Infinity/NaN', () => {
    const flat = new THREE.Mesh(new THREE.PlaneGeometry(4, 4));
    flat.rotation.x = -Math.PI / 2;       // 攤平在 XZ 平面 → 高度 0
    const { scale } = fitToHeight(flat, 10);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBe(1);
  });

  it('巢狀子物件的 transform 要算進包圍盒（風車的 sails 是獨立 node）', () => {
    const root = new THREE.Group();
    const child = boxObject(1, 2, 1);       // 本身佔 y 0–2
    child.position.y = 3;                   // 被抬到 y 3–5
    root.add(child);
    const { box, size } = fitToHeight(root, 1);
    expect(box.max.y).toBeCloseTo(5, 5);    // 沒更新子節點 matrixWorld 的話這裡會是 2
    expect(size.y).toBeCloseTo(2, 5);       // 縮放依據是「跨度」而不是離原點多遠
  });
});

describe('fitToWidth — 依寬度對齊（MG 巢那種「高度不是特徵」的東西）', () => {
  it('取 x／z 較大的一邊當寬度', () => {
    const { scale } = fitToWidth(boxObject(2, 9, 4), 6.4);
    expect(scale).toBeCloseTo(6.4 / 4, 5);
  });

  it('零寬度不會炸', () => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5, 0),
    ]));
    const { scale } = fitToWidth(line, 3);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

describe('ensureUV1 — aoMap 讀 uv1，程序化幾何只有 uv', () => {
  it('沒有 uv1 時補一份（與 uv 同一組資料）', () => {
    const geo = new THREE.PlaneGeometry(10, 10);
    expect(geo.attributes.uv1).toBeUndefined();
    ensureUV1(geo);
    expect(geo.attributes.uv1).toBe(geo.attributes.uv);
  });

  it('已經有 uv1 就不覆蓋', () => {
    const geo = new THREE.PlaneGeometry(10, 10);
    const own = new THREE.BufferAttribute(new Float32Array(geo.attributes.uv.count * 2), 2);
    geo.setAttribute('uv1', own);
    ensureUV1(geo);
    expect(geo.attributes.uv1).toBe(own);
  });

  it('完全沒有 uv 的幾何不會被硬塞（不丟例外）', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    expect(() => ensureUV1(geo)).not.toThrow();
    expect(geo.attributes.uv1).toBeUndefined();
  });
});
