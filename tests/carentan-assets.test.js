// 卡倫坦資產整合層（src/carentan/scene/assets.js）的純函式單元測試
// 涵蓋：bbox 對齊縮放、幾何屬性統一、頂點色烘焙（含矩陣）、材質分桶、
//       Blender 模型註冊表、細節貼圖平均亮度的無 DOM fallback。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  fitScale, trimGeometry, bakeToVertexColors, collectByMaterial, hasBlenderModel, BLENDER_MODELS,
} from '../src/carentan/scene/assets.js';
import { textureMeanLuminance } from '../src/carentan/scene/terrain.js';

function boxMesh(w, h, d, color = 0xff0000, name = 'mat') {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, name });
  return new THREE.Mesh(geo, mat);
}

describe('fitScale — 依 bounding box 對齊現有程序化模型', () => {
  it('以高度對齊：2 公尺的模型要放到 3.25 單位高 → 1.625 倍', () => {
    const m = boxMesh(1, 2, 1);
    expect(fitScale(m, 3.25, 'y')).toBeCloseTo(1.625, 6);
  });

  it('以長度對齊：6 公尺車身放到 6.8 單位 → 約 1.133 倍', () => {
    const m = boxMesh(3, 3, 6);
    expect(fitScale(m, 6.8, 'z')).toBeCloseTo(6.8 / 6, 6);
  });

  it("axis 'max' 取最長邊", () => {
    const m = boxMesh(2, 8, 4);
    expect(fitScale(m, 4, 'max')).toBeCloseTo(0.5, 6);
  });

  it('退化情形（沒有幾何）回 1，不會回 NaN 或 Infinity', () => {
    expect(fitScale(new THREE.Group(), 5, 'y')).toBe(1);
  });
});

describe('trimGeometry — mergeGeometries 前的屬性統一', () => {
  it('只留 position/normal/uv，其餘屬性（tangent、第二組 uv…）丟掉', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const n = geo.attributes.position.count;
    geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geo.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    const out = trimGeometry(geo);
    expect(Object.keys(out.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  it('沒有 uv 的幾何會補一組零 uv（否則合併會失敗）', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const out = trimGeometry(geo);
    expect(out.attributes.uv).toBeTruthy();
    expect(out.attributes.uv.count).toBe(3);
  });

  it('索引幾何會轉成非索引（index 有無一致才能合併）', () => {
    const out = trimGeometry(new THREE.BoxGeometry(1, 1, 1));
    expect(out.index).toBeNull();
  });
});

describe('bakeToVertexColors — glb 烘焙成單一頂點色幾何', () => {
  it('多個 mesh 合併成一份幾何，材質顏色寫進頂點色', () => {
    const root = new THREE.Group();
    const a = boxMesh(1, 1, 1, 0xff0000);
    const b = boxMesh(1, 1, 1, 0x00ff00);
    b.position.set(3, 0, 0);
    root.add(a, b);
    const geo = bakeToVertexColors(root);
    expect(geo).toBeTruthy();
    expect(geo.attributes.color).toBeTruthy();
    expect(geo.attributes.color.count).toBe(geo.attributes.position.count);
    // 兩種顏色都要出現（線性空間；紅色的 r 通道為 1）
    const col = geo.attributes.color.array;
    const reds = [];
    for (let i = 0; i < col.length; i += 3) reds.push(col[i]);
    expect(Math.max(...reds)).toBeCloseTo(1, 5);
    expect(Math.min(...reds)).toBeCloseTo(0, 5);
  });

  it('matrix 參數會套用到幾何（縮放與位移壓進頂點）', () => {
    const root = new THREE.Group();
    root.add(boxMesh(2, 2, 2));
    const mx = new THREE.Matrix4().makeScale(0.5, 0.5, 0.5).premultiply(new THREE.Matrix4().makeTranslation(10, 0, 0));
    const geo = bakeToVertexColors(root, { matrix: mx });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    expect(bb.min.x).toBeCloseTo(9.5, 5);
    expect(bb.max.x).toBeCloseTo(10.5, 5);
    expect(bb.max.y).toBeCloseTo(0.5, 5);
  });

  it('空的子樹回 null（呼叫端據此保留程序化版本）', () => {
    expect(bakeToVertexColors(new THREE.Group())).toBeNull();
  });
});

describe('collectByMaterial — 建築依材質分桶（合併後才是 ~10 個 draw call）', () => {
  it('同名材質歸同一桶，材質實例一併帶出', () => {
    const root = new THREE.Group();
    const wallA = boxMesh(1, 1, 1, 0xffffff, 'stone');
    const wallB = boxMesh(1, 1, 1, 0xffffff, 'stone');
    const roof = boxMesh(1, 1, 1, 0x884422, 'roof_tile');
    root.add(wallA, wallB, roof);
    const buckets = collectByMaterial(root);
    expect([...buckets.keys()].sort()).toEqual(['roof_tile', 'stone']);
    expect(buckets.get('stone').geos).toHaveLength(2);
    expect(buckets.get('roof_tile').material.name).toBe('roof_tile');
  });

  it('into 參數可以把多棟房子累積進同一組桶', () => {
    const into = new Map();
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      root.add(boxMesh(1, 1, 1, 0xffffff, 'stone'));
      collectByMaterial(root, { into });
    }
    expect(into.get('stone').geos).toHaveLength(3);
  });
});

describe('Blender 模型註冊表', () => {
  it('已建好的模型回 true', () => {
    for (const id of ['sherman', 'stug', 'mg_nest', 'church', 'house_normandy_l']) {
      expect(hasBlenderModel(id)).toBe(true);
    }
  });

  it('還在建模的士兵回 false（不發請求，保持 console 乾淨）', () => {
    expect(hasBlenderModel('soldier_us_stand_rifle')).toBe(false);
    expect(hasBlenderModel('does_not_exist')).toBe(false);
  });

  it('註冊表涵蓋 soldier.py 的五種姿態命名', () => {
    const poses = Object.keys(BLENDER_MODELS).filter((k) => k.startsWith('soldier_'));
    expect(poses.length).toBeGreaterThanOrEqual(6);
    expect(poses).toContain('soldier_us_advance_rifle');
    expect(poses).toContain('soldier_de_kneel_fire');
  });
});

describe('textureMeanLuminance — 地表細節層的亮度正規化', () => {
  it('沒有貼圖／沒有 DOM 時回 fallback，不會丟例外', () => {
    expect(textureMeanLuminance(null)).toBeCloseTo(0.18, 6);
    expect(textureMeanLuminance({ image: null }, 0.25)).toBeCloseTo(0.25, 6);
  });
});
