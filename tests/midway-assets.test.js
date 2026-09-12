// 中途島資產管線(docs/asset-pipeline-spec.md §3)單元測試
// 涵蓋:艦艇／機種的 glb 對照表、公尺→場景單位的對齊縮放、glb 幾何合併(頂點色烘焙)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { modelIdFor } from '../src/midway/scene/ships.js';
import { planeModelId } from '../src/midway/scene/aircraft.js';
import { fitLength, bakeToSingleGeometry } from '../src/midway/scene/assets.js';
import { units, airGroups } from '../src/midway/data/battle.js';

const SHIP_MODELS = new Set([
  'carrier_ijn_L', 'carrier_ijn_R', 'carrier_usn',
  'cruiser_ijn', 'cruiser_usn', 'destroyer_ijn', 'destroyer_usn',
]);
const PLANE_MODELS = new Set(['sbd', 'tbd', 'f4f', 'a6m', 'd3a', 'b5n']);

describe('modelIdFor — 艦艇 glb 對照', () => {
  it('日軍航艦依艦島舷別選左／右舷變體', () => {
    expect(modelIdFor({ kind: 'carrier', side: 'red', islandSide: 'left' })).toBe('carrier_ijn_L');
    expect(modelIdFor({ kind: 'carrier', side: 'red', islandSide: 'right' })).toBe('carrier_ijn_R');
  });

  it('美軍航艦一律右舷艦島', () => {
    expect(modelIdFor({ kind: 'carrier', side: 'blue', islandSide: 'right' })).toBe('carrier_usn');
  });

  it('戰艦沒有專屬模型,沿用同陣營重巡艦體', () => {
    expect(modelIdFor({ kind: 'battleship', side: 'red' })).toBe('cruiser_ijn');
    expect(modelIdFor({ kind: 'cruiser', side: 'blue' })).toBe('cruiser_usn');
    expect(modelIdFor({ kind: 'destroyer', side: 'red' })).toBe('destroyer_ijn');
  });

  it('battle.js 內每一艘船都對得到一個存在的模型 id', () => {
    for (const u of units) {
      if (u.kind === 'base') continue;
      expect(SHIP_MODELS.has(modelIdFor(u))).toBe(true);
    }
  });
});

describe('planeModelId — 機隊 glb 對照', () => {
  it('battle.js 內每一個機隊都對得到一個存在的機種', () => {
    for (const ag of airGroups) {
      expect(PLANE_MODELS.has(planeModelId(ag))).toBe(true);
    }
  });

  it('未列表的機隊退回該陣營的預設機種', () => {
    expect(planeModelId({ id: 'nope', side: 'red' })).toBe('a6m');
    expect(planeModelId({ id: 'nope', side: 'blue' })).toBe('f4f');
  });
});

describe('fitLength — 公尺模型對齊場景尺度', () => {
  it('把 260.2 m 的艦體縮到 111 場景單位(1 單位 ≈ 2.35 m)', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 260.2));
    const root = new THREE.Group();
    root.add(mesh);
    const s = fitLength(root, 111);
    expect(s).toBeCloseTo(111 / 260.2, 5);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    expect(box.max.z - box.min.z).toBeCloseTo(111, 3);
  });

  it('長度為 0 的幾何不會把縮放變成 0 或 NaN', () => {
    const root = new THREE.Group();
    expect(fitLength(root, 111)).toBe(1);
    expect(root.scale.x).toBe(1);
  });
});

describe('bakeToSingleGeometry — 合併 glb 幾何並烘焙頂點色', () => {
  function twoPartModel() {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x0000ff }));
    b.name = 'prop';
    b.position.set(0, 0, -2);
    root.add(a, b);
    return { root, b };
  }

  it('合併後有 position/normal/color,頂點數為各部件總和', () => {
    const { root } = twoPartModel();
    const geo = bakeToSingleGeometry(root);
    expect(geo.attributes.position.count).toBe(24 * 2);
    expect(geo.attributes.color.count).toBe(24 * 2);
    expect(geo.attributes.normal).toBeTruthy();
    expect(geo.index.count).toBe(36 * 2);
  });

  it('skip 可排除螺旋槳子物件(prop 另外用圓盤代替)', () => {
    const { root, b } = twoPartModel();
    const geo = bakeToSingleGeometry(root, { skip: (o) => o === b });
    expect(geo.attributes.position.count).toBe(24);
  });

  it('各部件的 baseColor 烘進頂點色(紅色部件的頂點色為紅)', () => {
    const { root, b } = twoPartModel();
    const geo = bakeToSingleGeometry(root, { skip: (o) => o === b });
    const c = geo.attributes.color;
    expect(c.getX(0)).toBeCloseTo(1, 5);
    expect(c.getY(0)).toBeCloseTo(0, 5);
    expect(c.getZ(0)).toBeCloseTo(0, 5);
  });

  it('沒有任何 mesh 時回傳 null(呼叫端就地退回程序化幾何)', () => {
    expect(bakeToSingleGeometry(new THREE.Group())).toBe(null);
  });
});
