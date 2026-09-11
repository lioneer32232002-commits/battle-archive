// 船艦工廠 — 程序化模型:大和(三聯裝主砲、寶塔艦橋)、美軍航艦、護衛艦、軍旗、陣營光圈
// 模型座標:艦艏朝 -z,長度沿 z 軸
//
// 2026-09-12 美術升級(N-3):
//   1. 全艦的 Lambert 零件在建構時就用 mergeGeometries 併成「一個 mesh + 頂點色」,
//      一艘船從 10–13 個 draw call 降到 4–5 個。省下來的預算才有辦法加防空砲座、索具、砲管。
//   2. 船殼分三層:水線上灰、水線黑(boot-topping)、水線下紅褐,側傾與沉沒時看得到船底紅漆。
//   3. 全艦共用一張細鋼板貼圖(RepeatWrapping)當灰階顆粒,消掉「一整片塑膠灰」。
//   4. 桅杆索具(LineSegments)、防空砲座叢集、艦島／寶塔投影(靠 P-2 陰影)。
//   5. 舊的三角形貼圖尾流 plane 移除,改由 scene/wakes.js 的 SurfaceSystem 負責(N-2)。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const HULL_COLOR = { red: 0x696e75, blue: 0x737a84 };  // 補上 OutputPass 後 ACES 真的會作用,數值調回接近實際塗裝
const BOOT = 0x202328;      // 水線黑帶
const BOTTOM = 0x763726;    // 水線下紅褐(船底漆)

// ── 鋼板灰階貼圖(全艦共用一張,只當顆粒與板縫) ──────────
let steelTex = null;
function steel() {
  if (steelTex) return steelTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  // 細噪點
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 236 + Math.floor(Math.random() * 20);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  // 鋼板分割線
  g.strokeStyle = 'rgba(120,124,130,0.35)';
  g.lineWidth = 1;
  for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let x = 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  // 鏽痕:幾道自上而下的暖色淡痕
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 200;
    const grad = g.createLinearGradient(x, y, x, y + 40 + Math.random() * 40);
    grad.addColorStop(0, 'rgba(150,96,58,0.24)');
    grad.addColorStop(1, 'rgba(150,96,58,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 2 + Math.random() * 3, 80);
  }
  steelTex = new THREE.CanvasTexture(c);
  steelTex.colorSpace = THREE.SRGBColorSpace;
  steelTex.wrapS = steelTex.wrapT = THREE.RepeatWrapping;
  steelTex.repeat.set(6, 6);
  steelTex.anisotropy = 4;
  return steelTex;
}

// ── 頂點色合併輔助 ───────────────────────────────────
function tint(geo, hex) {
  // ExtrudeGeometry 是 non-indexed、Box/Cylinder 是 indexed,mergeGeometries 不接受混用 → 全部轉 non-indexed
  if (geo.index) { const ng = geo.toNonIndexed(); geo.dispose(); geo = ng; }
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

class Builder {
  constructor() { this.parts = []; }
  add(geo, hex, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    this.parts.push(tint(geo, hex));
    return this;
  }
  build() {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshLambertMaterial({ vertexColors: true, map: steel() })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

// ── 軍旗 ─────────────────────────────────────────────
function makeFlagTexture(side) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  if (side === 'red') {
    // 旭日軍艦旗:日章偏向旗桿側,十六條光芒
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, 96, 64);
    const cx = 36, cy = 32, r = 13;
    g.fillStyle = '#c0392b';
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / 32;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * 140, cy + Math.sin(a0) * 140);
      g.lineTo(cx + Math.cos(a1) * 140, cy + Math.sin(a1) * 140);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  } else {
    // 美國國旗(簡化)
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 === 0 ? '#b22234' : '#f4f1e8';
      g.fillRect(0, (i * 64) / 13, 96, 64 / 13 + 1);
    }
    g.fillStyle = '#3c3b6e';
    g.fillRect(0, 0, 40, 34);
    g.fillStyle = '#fff';
    for (let r = 0; r < 5; r++)
      for (let s = 0; s < 6; s++) {
        g.beginPath();
        g.arc(4 + s * 6.5 + (r % 2) * 3, 4 + r * 6, 1.4, 0, Math.PI * 2);
        g.fill();
      }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const flagTexCache = {};
function flagTexture(side) {
  if (!flagTexCache[side]) flagTexCache[side] = makeFlagTexture(side);
  return flagTexCache[side];
}

function makeFlag(side, scale = 1) {
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(9 * scale, 6 * scale, 6, 1),
    new THREE.MeshBasicMaterial({ map: flagTexture(side), side: THREE.DoubleSide })
  );
  flag.userData.isFlag = true;
  return flag;
}

// ── 飛行甲板貼圖 ─────────────────────────────────────
function makeDeckTexture(spec) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  const wood = spec.side === 'red';
  g.fillStyle = wood ? '#9a8a62' : '#3d4f63'; // 日軍木甲板 / 美軍深藍灰甲板
  g.fillRect(0, 0, 128, 512);
  // 甲板縱紋
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1;
  for (let x = 8; x < 128; x += 10) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
  }
  // 中線與艦艏線(艦艏在 y=0)
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 3;
  g.setLineDash([18, 12]);
  g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 482); g.stroke();
  g.setLineDash([]);
  if (spec.side === 'red') {
    // 艦艏日之丸
    g.fillStyle = '#c0392b';
    g.beginPath(); g.arc(64, 90, 34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.beginPath(); g.arc(64, 90, 34, 0, Math.PI * 2); g.stroke();
    // 艦尾片假名識別字
    if (spec.deckMark) {
      g.fillStyle = '#fff';
      g.font = 'bold 95px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(spec.deckMark, 64, 420);
    }
  } else if (spec.deckMark) {
    // 美軍艦艏甲板舷號
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 110px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(spec.deckMark, 64, 100);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 大和的柚木主甲板:木紋 + 砲塔座圈 + 幾道戰損焦痕
let yamatoDeckTex = null;
function makeYamatoDeckTexture() {
  if (yamatoDeckTex) return yamatoDeckTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8d7f5f';
  g.fillRect(0, 0, 128, 512);
  for (let x = 0; x < 128; x += 6) {
    g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.09})`;
    g.fillRect(x, 0, 3, 512);
  }
  for (let y = 0; y < 512; y += 34) {
    g.strokeStyle = 'rgba(0,0,0,0.14)';
    g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
  }
  // 砲塔座圈(鋼灰)
  g.fillStyle = '#5f646b';
  for (const y of [88, 145, 430]) {
    g.beginPath(); g.arc(64, y, 30, 0, Math.PI * 2); g.fill();
  }
  // 中段上層結構的深色區
  g.fillStyle = 'rgba(70,72,76,0.85)';
  g.fillRect(20, 190, 88, 190);
  yamatoDeckTex = new THREE.CanvasTexture(c);
  yamatoDeckTex.colorSpace = THREE.SRGBColorSpace;
  yamatoDeckTex.anisotropy = 4;
  return yamatoDeckTex;
}

// ── 共用零件 ─────────────────────────────────────────
function hullShape(length, width) {
  const half = length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -half); // 艦艏
  shape.bezierCurveTo(width * 0.55, -half * 0.55, width * 0.6, half * 0.4, width * 0.42, half);
  shape.lineTo(-width * 0.42, half);
  shape.bezierCurveTo(-width * 0.6, half * 0.4, -width * 0.55, -half * 0.55, 0, -half);
  return shape;
}

function hullSlab(length, width, y0, y1) {
  const geo = new THREE.ExtrudeGeometry(hullShape(length, width), { depth: y1 - y0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // shape 的 y → -z(艦艏 -z),depth 沿 y
  geo.translate(0, y0, 0);
  return geo;
}

// 三層船殼:水線下紅褐、水線黑帶、水線上艦體灰
function addHull(b, length, width, height, color) {
  b.add(hullSlab(length * 0.97, width * 0.93, -13, -3.2), BOTTOM);
  b.add(hullSlab(length * 0.995, width * 0.985, -3.2, 1.6), BOOT);
  b.add(hullSlab(length, width, 1.6, height), color);
}

// 防空砲座叢集(小方塊,merge 後不增加 draw call)
function addAAGuns(b, count, L, W, y, rng) {
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1 || 1)) * 2 - 1;
    const side = i % 2 === 0 ? 1 : -1;
    const g = new THREE.BoxGeometry(W * 0.09, 1.5, W * 0.09);
    b.add(g, 0x585d64, { x: side * W * 0.44, y, z: t * L * 0.34 });
    const barrel = new THREE.CylinderGeometry(0.16, 0.16, W * 0.16, 4);
    b.add(barrel, 0x43484f, { rx: -Math.PI / 3, x: side * W * 0.44, y: y + 1.1, z: t * L * 0.34 - W * 0.06 });
  }
}

// 桅杆索具:自桅頂拉向艦艏、艦艉的細灰線
function makeRigging(points) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x9aa2ab, transparent: true, opacity: 0.55 })
  );
}

function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  ring.renderOrder = 1;
  return ring;
}

// ── 航空母艦 ─────────────────────────────────────────
export function createCarrier(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * 0.13;
  const b = new Builder();

  addHull(b, L, W, L * 0.055, HULL_COLOR[spec.side]);
  const deckY = L * 0.055 + 1;
  // 甲板本體(灰色板身)
  b.add(new THREE.BoxGeometry(W * 2.1, 1.6, L * 0.96), 0x535960, { y: deckY });

  // 艦島
  const ix = (spec.islandSide === 'left' ? -1 : 1) * (W * 1.05 + 1.2);
  b.add(new THREE.BoxGeometry(3.4, 6, L * 0.16), 0x82878e, { x: ix, y: deckY + 3.8, z: -L * 0.08 });
  b.add(new THREE.BoxGeometry(2.4, 2.4, L * 0.07), 0x8d9297, { x: ix, y: deckY + 7.6, z: -L * 0.09 });
  b.add(new THREE.CylinderGeometry(1.1, 1.4, 4.5, 8), 0x464a50, {
    rz: (spec.islandSide === 'left' ? 1 : -1) * 0.5, x: ix, y: deckY + 3, z: L * 0.02,
  });
  b.add(new THREE.CylinderGeometry(0.25, 0.25, 10, 5), 0x383d42, { x: ix, y: deckY + 10, z: -L * 0.08 });
  addAAGuns(b, 10, L, W * 2.1, deckY + 1.2, null);

  const body = b.build();
  g.add(body);

  // 飛行甲板貼圖(單獨一片,1 個 draw call)
  const deckTop = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2.1, L * 0.96),
    new THREE.MeshLambertMaterial({ map: makeDeckTexture(spec) })
  );
  deckTop.rotation.x = -Math.PI / 2;
  deckTop.position.y = deckY + 0.85;
  deckTop.receiveShadow = true;
  g.add(deckTop);

  g.add(makeRigging([
    new THREE.Vector3(ix, deckY + 15, -L * 0.08), new THREE.Vector3(ix, deckY + 1, -L * 0.4),
    new THREE.Vector3(ix, deckY + 15, -L * 0.08), new THREE.Vector3(ix, deckY + 1, L * 0.4),
    new THREE.Vector3(ix, deckY + 15, -L * 0.08), new THREE.Vector3(ix - 4, deckY + 6.5, L * 0.02),
  ]));

  const flag = makeFlag(spec.side, 1.15);
  flag.position.set(ix + 5, deckY + 13.5, -L * 0.08);
  g.add(flag);

  g.add(makeRing(L * 0.78, SIDE_COLOR[spec.side]));
  g.userData.beam = W * 2.1;
  g.userData.length = L;
  return g;
}

// ── 護衛艦(戰艦/巡洋艦/驅逐艦) ──────────────────────
export function createEscort(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * (spec.kind === 'battleship' ? 0.15 : 0.11);
  const hullH = L * 0.05;
  const b = new Builder();

  addHull(b, L, W, hullH, HULL_COLOR[spec.side]);
  b.add(new THREE.BoxGeometry(W * 0.9, hullH * 1.6, L * 0.3), 0x80858b, { y: hullH + hullH * 0.8, z: -L * 0.05 });
  b.add(new THREE.BoxGeometry(W * 0.55, hullH * 1.8, L * 0.08), 0x888d92, { y: hullH * 2.6 + 1, z: -L * 0.14 });
  b.add(new THREE.CylinderGeometry(W * 0.16, W * 0.2, hullH * 2, 8), 0x464a50, { y: hullH * 2.4, z: L * 0.06 });

  // 主砲塔
  if (spec.kind !== 'destroyer') {
    for (let i = 0; i < 2; i++) {
      b.add(new THREE.CylinderGeometry(W * 0.3, W * 0.34, 2, 8), 0x71767c, { y: hullH + 1.6, z: -L * (0.28 + i * 0.09) });
      b.add(new THREE.CylinderGeometry(0.22, 0.22, W * 0.9, 5), 0x595e64, {
        rx: -Math.PI / 2.25, y: hullH + 2, z: -L * (0.32 + i * 0.09),
      });
    }
  } else {
    // 驅逐艦:艦艏艦艉各一座單裝砲
    for (const z of [-L * 0.3, L * 0.3]) {
      b.add(new THREE.CylinderGeometry(W * 0.22, W * 0.26, 1.6, 8), 0x71767c, { y: hullH + 1.3, z });
      b.add(new THREE.CylinderGeometry(0.18, 0.18, W * 0.7, 5), 0x595e64, {
        rx: -Math.PI / 2.2, y: hullH + 1.8, z: z + (z < 0 ? -W * 0.3 : W * 0.3),
      });
    }
  }
  b.add(new THREE.CylinderGeometry(0.18, 0.18, 7, 5), 0x383d42, { y: hullH * 2.6 + 4, z: -L * 0.14 });
  addAAGuns(b, 6, L, W, hullH + 1.4, null);

  g.add(b.build());

  const mastTop = new THREE.Vector3(0, hullH * 2.6 + 7.5, -L * 0.14);
  g.add(makeRigging([
    mastTop.clone(), new THREE.Vector3(0, hullH + 0.5, -L * 0.46),
    mastTop.clone(), new THREE.Vector3(0, hullH + 0.5, L * 0.46),
    mastTop.clone(), new THREE.Vector3(0, hullH * 2.4 + 2, L * 0.06),
  ]));

  const flag = makeFlag(spec.side, 0.7);
  flag.position.set(3, hullH * 2.6 + 7, -L * 0.14);
  g.add(flag);

  g.add(makeRing(L * 0.7, SIDE_COLOR[spec.side]));
  g.userData.beam = W;
  g.userData.length = L;
  return g;
}

// ── 戰艦大和(本場主角:三聯裝 46cm 主砲 + 寶塔艦橋) ──────────
export function createYamato(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * 0.165; // 大和以艦寬著稱
  const hullH = L * 0.06;
  const grey = 0x656a71;
  const b = new Builder();

  addHull(b, L, W, hullH, grey);
  const deckY = hullH + 1.2;
  b.add(new THREE.BoxGeometry(W * 0.92, 1.2, L * 0.96), 0x776f5f, { y: hullH + 0.6 });

  // 46cm 三聯裝主砲塔:艦艏 2 座(背負式)、艦艉 1 座 — 砲管三根,清楚可辨
  function mainTurret(z, aim, lift = 0) {
    const y = deckY + lift;
    b.add(new THREE.CylinderGeometry(W * 0.26, W * 0.3, 2.6, 10), 0x686d74, { y, z });
    b.add(new THREE.BoxGeometry(W * 0.42, 2.2, L * 0.075), 0x6b7078, { y: y + 1.6, z });
    b.add(new THREE.BoxGeometry(W * 0.36, 1.4, L * 0.03), 0x5e636a, { y: y + 2.9, z: z + L * 0.012 });
    for (let i = -1; i <= 1; i++) {
      b.add(new THREE.CylinderGeometry(0.34, 0.38, L * 0.18, 8), 0x51555b, {
        rx: -Math.PI / 2, x: i * W * 0.13, y: y + 1.9, z: z - L * 0.1 * aim,
      });
    }
  }
  mainTurret(-L * 0.34, 1, 0);    // A 砲塔
  mainTurret(-L * 0.23, 1, 1.7);  // B 砲塔(背負式,墊高)
  mainTurret(L * 0.36, -1, 0);    // 艦艉 X 砲塔(朝後)

  // 15.5cm 副砲
  for (const z of [-L * 0.11, L * 0.2]) {
    b.add(new THREE.CylinderGeometry(W * 0.13, W * 0.15, 1.8, 8), 0x6b7078, { y: deckY + 3.4, z });
    b.add(new THREE.CylinderGeometry(0.2, 0.2, L * 0.08, 5), 0x51555b, { rx: -Math.PI / 2, y: deckY + 4, z: z - L * 0.05 });
  }

  // 寶塔狀艦橋:層層收束疊高(大和最具辨識度的剪影)
  const tiers = [
    [W * 0.5, 4, L * 0.12, 4],
    [W * 0.38, 4, L * 0.09, 8],
    [W * 0.28, 3.5, L * 0.07, 11.5],
    [W * 0.18, 3, L * 0.05, 15],
  ];
  for (const [w, h, d, y] of tiers) {
    b.add(new THREE.BoxGeometry(w, h, d), 0x7a8086, { y: deckY + y, z: -L * 0.05 });
  }
  b.add(new THREE.CylinderGeometry(W * 0.07, W * 0.1, 2.2, 8), 0x7a8086, { y: deckY + 18, z: -L * 0.05 });
  // 主砲測距儀(頂端橫桿)
  b.add(new THREE.BoxGeometry(W * 0.5, 1.1, 1.6), 0x84898f, { y: deckY + 17.2, z: -L * 0.05 });

  // 單一大型後傾煙囪
  b.add(new THREE.CylinderGeometry(W * 0.16, W * 0.2, 7, 12), 0x585e66, { rx: 0.18, y: deckY + 5, z: L * 0.07 });
  // 後桅
  b.add(new THREE.CylinderGeometry(0.22, 0.22, 12, 5), 0x383d42, { y: deckY + 8, z: L * 0.17 });
  // 密集的 25mm 三聯裝機槍座(1945 年的大和佈滿防空砲)
  addAAGuns(b, 16, L, W, deckY + 2.4, null);

  g.add(b.build());

  // 柚木主甲板(單獨貼圖,1 個 draw call)
  const deckTop = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.92, L * 0.96),
    new THREE.MeshLambertMaterial({ map: makeYamatoDeckTexture() })
  );
  deckTop.rotation.x = -Math.PI / 2;
  deckTop.position.y = hullH + 1.25;
  deckTop.receiveShadow = true;
  g.add(deckTop);

  const towerTop = new THREE.Vector3(0, deckY + 19, -L * 0.05);
  g.add(makeRigging([
    towerTop.clone(), new THREE.Vector3(0, hullH + 1, -L * 0.48),
    towerTop.clone(), new THREE.Vector3(0, deckY + 14, L * 0.17),
    new THREE.Vector3(0, deckY + 14, L * 0.17), new THREE.Vector3(0, hullH + 1, L * 0.47),
    towerTop.clone(), new THREE.Vector3(W * 0.45, deckY + 6, -L * 0.05),
    towerTop.clone(), new THREE.Vector3(-W * 0.45, deckY + 6, -L * 0.05),
  ]));

  const flag = makeFlag(spec.side, 1.1);
  flag.position.set(4, deckY + 20, -L * 0.05);
  g.add(flag);

  g.add(makeRing(L * 0.62, SIDE_COLOR[spec.side]));
  g.userData.beam = W;
  g.userData.length = L;
  return g;
}

export function createShip(spec) {
  if (spec.kind === 'carrier') return createCarrier(spec);
  if (spec.kind === 'flagship') return createYamato(spec);
  return createEscort(spec);
}

// 軍旗飄動
export function animateFlags(root, time) {
  root.traverse((o) => {
    if (o.userData.isFlag) {
      o.rotation.y = Math.sin(time * 3 + o.position.x) * 0.18;
      o.scale.x = 0.92 + Math.sin(time * 5 + o.position.z) * 0.08;
    }
  });
}
