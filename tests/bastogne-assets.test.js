// 巴斯通 · 真實資產接入的純函式測試(docs/asset-pipeline-spec.md §3)
// 這裡測的是「把 glTF 的多材質子樹壓成少數幾個可 instance 的網格」那條路徑,
// 它是 draw call 從 531 降到 300 的關鍵,也是最容易在換模型時悄悄壞掉的地方。
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectByGroup, geoMetrics, normalizeAttributes } from '../src/bastogne/scene/assets.js';

function meshWith(matName, color, { uv = true, normal = true } = {}) {
  const g = new THREE.BoxGeometry(2, 4, 2);
  if (!uv) g.deleteAttribute('uv');
  if (!normal) g.deleteAttribute('normal');
  const m = new THREE.MeshStandardMaterial({ color });
  m.name = matName;
  return new THREE.Mesh(g, m);
}

describe('bastogne assets · normalizeAttributes', () => {
  it('補齊 uv／normal／color,並刪掉其餘屬性(mergeGeometries 要求完全一致)', () => {
    const g = normalizeAttributes(new THREE.BoxGeometry(1, 1, 1));
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });

  it('缺 uv 的幾何也能補出來(glb 常有沒有 uv 的那一塊)', () => {
    const raw = new THREE.BoxGeometry(1, 1, 1);
    raw.deleteAttribute('uv');
    const g = normalizeAttributes(raw);
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
  });

  it('不覆寫已經烘好的頂點色', () => {
    const raw = new THREE.BoxGeometry(1, 1, 1);
    const n = raw.attributes.position.count;
    raw.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.25), 3));
    const g = normalizeAttributes(raw);
    expect(g.attributes.color.getX(0)).toBeCloseTo(0.25);
  });
});

describe('bastogne assets · collectByGroup', () => {
  it('依材質名分組,並把 baseColor 烘進頂點色', () => {
    const root = new THREE.Group();
    const wall = meshWith('stone', 0x808080);
    const roof = meshWith('roof_slate', 0x202020);
    roof.position.y = 4;
    root.add(wall, roof);

    const groups = collectByGroup(root, (name) => (name === 'roof_slate' ? 'roof' : 'shell'));
    expect([...groups.keys()].sort()).toEqual(['roof', 'shell']);
    const shell = groups.get('shell')[0];
    const c = new THREE.Color(0x808080);
    expect(shell.attributes.color.getX(0)).toBeCloseTo(c.r, 5);
  });

  it('groupOf 回傳 null 的 primitive 會被丟掉', () => {
    const root = new THREE.Group();
    root.add(meshWith('glass', 0x111111), meshWith('stone', 0x888888));
    const groups = collectByGroup(root, (name) => (name === 'glass' ? null : 'shell'));
    expect(groups.has('glass')).toBe(false);
    expect(groups.get('shell')).toHaveLength(1);
  });

  it('套用世界矩陣(子物件的位移要烘進幾何,才能整棟合併成一個 mesh)', () => {
    const root = new THREE.Group();
    const child = meshWith('stone', 0x888888);
    child.position.set(0, 10, 0);
    root.add(child);
    const geo = collectByGroup(root, () => 'all').get('all')[0];
    expect(geoMetrics(geo).minY).toBeCloseTo(8, 5);
  });

  it('屬性組合不同的 primitive 分完組仍可直接 merge(不會因缺 uv 而整批失敗)', async () => {
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const root = new THREE.Group();
    root.add(meshWith('stone', 0x888888));
    root.add(meshWith('timber', 0x442200, { uv: false }));
    root.add(meshWith('wood', 0x553311, { normal: false }));
    const list = collectByGroup(root, () => 'all').get('all');
    expect(list).toHaveLength(3);
    expect(mergeGeometries(list, false)).not.toBeNull();
  });
});

describe('bastogne assets · geoMetrics', () => {
  it('回報高度／寬度／長度與底面,供與程序化模型的 bounding box 對齊', () => {
    const g = new THREE.BoxGeometry(3, 6, 9);
    g.translate(0, 3, 0);
    const m = geoMetrics(g);
    expect(m.height).toBeCloseTo(6);
    expect(m.width).toBeCloseTo(9);
    expect(m.length).toBeCloseTo(9);
    expect(m.minY).toBeCloseTo(0);
  });
});
