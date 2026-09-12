// 船艦工廠 — 程序化模型:航艦(甲板識別塗裝、艦島左右舷)、護衛艦、軍旗、陣營光圈
// 模型座標:艦艏朝 -z,長度沿 z 軸
//
// N-3 艦體質感升級:
//   * 船殼 canvas 貼圖 — 水線以下紅褐防汙漆、水線黑色 boot-topping、上方鋼板分割線與艦艉鏽痕。
//     船殼往下多擠出「殼高的一半」,水線恆落在貼圖 v≈1/3;平時看不到,側翻沉沒時整片紅褐露出來。
//   * 桅杆索具 LineSegments(細灰線)
//   * 防空砲座:沿舷側的小方塊叢集,每艦一個 InstancedMesh(1 個 draw call)
//   * castShadow / receiveShadow:艦島影子落在飛行甲板上是最重要的質感來源
//   * 飛行甲板由 6 材質 BoxGeometry 改為單一材質(每艘航艦省 5 個 draw call)
//   * 舊的三角形貼圖尾流 plane 已移除,改用 scene/wake.js 的動態尾流(N-2)
//
// 資產管線(docs/asset-pipeline-spec.md §3):
//   A-2 createShip() 先回傳程序化艦(首屏不等資產),Blender glb 到了再就地換裝:
//       程序化子樹退場、glb 依 u.length 沿 -Z 對齊縮放,識別環／軍旗／標籤／尾流掛點
//       與沉沒動畫全部沿用。glb 載入失敗時什麼都不做,畫面就是原本的程序化艦。
import * as THREE from 'three';
import { cloneModel, normalizeMaterials, fitLength } from './assets.js';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const HULL_COLOR = { red: 0x5e6166, blue: 0x6b7280 };
const UNDER_RATIO = 0.5; // 水線以下擠出深度 = 船殼高 × 此比例(讓水線恆在貼圖 v=1/3 處)

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

// ── 船殼貼圖(N-3) ────────────────────────────────────
// 縱軸 v:0 = 龍骨(水線下 3 單位)、1 = 甲板緣。橫軸 u 沿艦身長度平鋪。
const hullTexCache = {};
function hullTexture(side) {
  if (hullTexCache[side]) return hullTexCache[side];
  const H = 256, W = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // canvas y=0 在上 → 對應 v=1(甲板緣);y=H 在下 → v=0(龍骨)
  const grey = side === 'red' ? '#5e6166' : '#6b7280';
  const greyHi = side === 'red' ? '#73777d' : '#7f8792';

  // 灰:船殼主體
  g.fillStyle = grey;
  g.fillRect(0, 0, W, H);
  // 上緣稍亮(受光)
  const lit = g.createLinearGradient(0, 0, 0, H * 0.62);
  lit.addColorStop(0, greyHi);
  lit.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lit; g.fillRect(0, 0, W, H * 0.62);

  // 鋼板分割線:水平接縫 + 垂直肋板
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1;
  for (let y = 14; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,0.13)';
  for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * 0.72); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let y = 15; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  // 鏽痕:自接縫垂下的鏽色細條
  let s = 991;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.66;
    const len = 6 + rnd() * 26;
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(126,74,44,0.42)');
    grad.addColorStop(1, 'rgba(126,74,44,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + rnd() * 2.4, len);
  }

  // 水線黑帶(boot-topping):v ≈ 0.30–0.40
  g.fillStyle = '#1b1e23';
  g.fillRect(0, H * 0.60, W, H * 0.10);
  // 水線以下:紅褐防汙漆
  const red = g.createLinearGradient(0, H * 0.70, 0, H);
  red.addColorStop(0, '#7a3c26');
  red.addColorStop(1, '#5d2c1c');
  g.fillStyle = red;
  g.fillRect(0, H * 0.70, W, H * 0.30);
  // 水線附近的海生附著/水漬
  g.fillStyle = 'rgba(40,60,50,0.28)';
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    g.fillRect(x, H * 0.66 + rnd() * H * 0.08, 2 + rnd() * 9, 2 + rnd() * 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  hullTexCache[side] = tex;
  return tex;
}

// ── 共用零件 ─────────────────────────────────────────
function makeHull(length, width, height, side) {
  // 船型剖面:艏尖、艉收。往下多擠出 UNDERWATER,水線以下為紅褐防汙漆。
  const half = length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -half); // 艦艏
  shape.bezierCurveTo(width * 0.55, -half * 0.55, width * 0.6, half * 0.4, width * 0.42, half);
  shape.lineTo(-width * 0.42, half);
  shape.bezierCurveTo(-width * 0.6, half * 0.4, -width * 0.55, -half * 0.55, 0, -half);
  const under = height * UNDER_RATIO;
  const total = height + under;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: total, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // shape 的 y → -z(艦艏 -z),depth 沿 y
  geo.translate(0, -under, 0);

  // ExtrudeGeometry 的側牆 UV:v = 1 - z(z 為擠出深度 0…total)
  // 令 vTex = 0 在龍骨、1 在甲板緣 → repeat.y = -1/total、offset.y = 1/total
  const tex = hullTexture(side).clone();
  tex.needsUpdate = true;
  tex.repeat.set(0.22, -1 / total);
  tex.offset.set(0, 1 / total);

  const capMat = new THREE.MeshStandardMaterial({ color: HULL_COLOR[side], roughness: 0.62, metalness: 0.35 });
  const sideMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.58, metalness: 0.38 });
  const mesh = new THREE.Mesh(geo, [capMat, sideMat]); // group0 = 端蓋、group1 = 側牆
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  ring.userData.isRing = true;
  return ring;
}

// ── 桅杆索具(N-3):自桅頂拉向艦艏／艦艉的細灰線 ──────
const RIG_MAT = new THREE.LineBasicMaterial({ color: 0x9aa2ab, transparent: true, opacity: 0.55 });
function makeRigging(mastTop, forePt, aftPt, extra = []) {
  const pts = [
    mastTop, forePt, mastTop, aftPt,
    mastTop, new THREE.Vector3(forePt.x, forePt.y, (forePt.z + mastTop.z) * 0.5),
    ...extra,
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, RIG_MAT);
}

// ── 防空砲座(N-3):沿舷側的小方塊叢集,一艦一個 InstancedMesh ──
const AA_GEO = new THREE.BoxGeometry(1.5, 1.1, 1.5);
const AA_MAT = new THREE.MeshStandardMaterial({ color: 0x4c5157, roughness: 0.5, metalness: 0.55 });
const _m4 = new THREE.Matrix4();
function makeAA(count, halfBeam, halfLen, y, seed) {
  const im = new THREE.InstancedMesh(AA_GEO, AA_MAT, count * 2);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
  let i = 0;
  for (let k = 0; k < count; k++) {
    const zf = -halfLen * 0.82 + (halfLen * 1.64 * (k + 0.5)) / count + (rnd() - 0.5) * halfLen * 0.1;
    for (const sgn of [1, -1]) {
      _m4.makeTranslation(sgn * halfBeam, y + (rnd() - 0.5) * 0.6, zf);
      im.setMatrixAt(i++, _m4);
    }
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  return im;
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
  // 甲板橫向接縫與使用痕(ACES 後單色大面積會很塑膠,加一點髒)
  let s = 4242;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
  g.strokeStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0; y < 512; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(0,0,0,${(0.03 + rnd() * 0.06).toFixed(3)})`;
    g.fillRect(rnd() * 128, rnd() * 512, 4 + rnd() * 22, 3 + rnd() * 14);
  }
  // 升降機(兩具)與艦艉制動索:glb 甲板改用這張貼圖後,這些細節就是甲板的識別特徵
  g.strokeStyle = 'rgba(236,232,214,0.55)';
  g.lineWidth = 2.5;
  g.strokeRect(38, 120, 52, 34);
  g.strokeRect(38, 300, 52, 34);
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.fillRect(40, 122, 48, 30);
  g.fillRect(40, 302, 48, 30);
  g.strokeStyle = 'rgba(28,26,22,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const y = 380 + i * 13;
    g.beginPath(); g.moveTo(10, y); g.lineTo(118, y); g.stroke();
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
  tex.anisotropy = 8;
  return tex;
}

// ── 航空母艦 ─────────────────────────────────────────
export function createCarrier(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * 0.13;

  const hull = makeHull(L, W, L * 0.055, spec.side);
  g.add(hull);

  // 飛行甲板(單一材質:側面只有 1.6 單位高,貼圖拉伸看不出來,省 5 個 draw call)
  const deckY = L * 0.055 + 1;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(W * 2.1, 1.6, L * 0.96),
    new THREE.MeshStandardMaterial({ map: makeDeckTexture(spec), roughness: 0.85, metalness: 0.05 })
  );
  deck.position.y = deckY;
  deck.castShadow = true;
  deck.receiveShadow = true;   // 艦島影子落在甲板上
  g.add(deck);

  // 艦島(赤城、飛龍為罕見的左舷艦島)
  const ix = (spec.islandSide === 'left' ? -1 : 1) * (W * 1.05 + 1.2);
  const island = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 6, L * 0.16),
    new THREE.MeshStandardMaterial({ color: 0x787d84, roughness: 0.55, metalness: 0.45 })
  );
  island.position.set(ix, deckY + 3.8, -L * 0.08);
  island.castShadow = true;
  g.add(island);

  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.4, 4.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.5, metalness: 0.5 })
  );
  stack.position.set(ix, deckY + 3, L * 0.02);
  stack.rotation.z = (spec.islandSide === 'left' ? 1 : -1) * 0.5;
  stack.castShadow = true;
  g.add(stack);

  // 桅杆與軍旗
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 10, 5),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.6 })
  );
  mast.position.set(ix, deckY + 10, -L * 0.08);
  mast.castShadow = true;
  g.add(mast);
  const flag = makeFlag(spec.side, 1.15);
  flag.position.set(ix + 5, deckY + 13.5, -L * 0.08);
  g.add(flag);

  // 索具:桅頂 → 艦艏、艦艉,再加兩條舷側支索
  g.add(makeRigging(
    new THREE.Vector3(ix, deckY + 14.6, -L * 0.08),
    new THREE.Vector3(0, deckY + 1.2, -L * 0.47),
    new THREE.Vector3(0, deckY + 1.2, L * 0.46),
    [
      new THREE.Vector3(ix, deckY + 14.6, -L * 0.08), new THREE.Vector3(ix, deckY + 1.0, L * 0.06),
      new THREE.Vector3(ix, deckY + 9.0, -L * 0.08), new THREE.Vector3(W * 1.02, deckY + 1.0, -L * 0.2),
    ]
  ));

  // 防空砲座:沿飛行甲板兩側外緣
  g.add(makeAA(6, W * 1.02, L * 0.5, deckY - 0.6, 17));

  g.add(makeRing(L * 0.78, SIDE_COLOR[spec.side]));
  g.userData.beam = W * 2.1;
  g.userData.len = L;
  return g;
}

// ── 護衛艦(戰艦/巡洋艦/驅逐艦) ──────────────────────
export function createEscort(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * (spec.kind === 'battleship' ? 0.15 : 0.11);
  const hullH = L * 0.05;

  const hull = makeHull(L, W, hullH, spec.side);
  g.add(hull);

  // 上層結構
  const sup = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.9, hullH * 1.6, L * 0.3),
    new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.55, metalness: 0.45 })
  );
  sup.position.set(0, hullH + hullH * 0.8, -L * 0.05);
  sup.castShadow = true;
  g.add(sup);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.55, hullH * 1.8, L * 0.08),
    new THREE.MeshStandardMaterial({ color: 0x84898f, roughness: 0.55, metalness: 0.45 })
  );
  bridge.position.set(0, hullH * 2.6 + 1, -L * 0.14);
  bridge.castShadow = true;
  g.add(bridge);

  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(W * 0.16, W * 0.2, hullH * 2, 8),
    new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.5, metalness: 0.5 })
  );
  stack.position.set(0, hullH * 2.4, L * 0.06);
  stack.castShadow = true;
  g.add(stack);

  // 主炮塔(戰艦/巡洋艦)
  if (spec.kind !== 'destroyer') {
    const n = spec.kind === 'battleship' ? 2 : 2;
    for (let i = 0; i < n; i++) {
      const tur = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.3, W * 0.34, 2, 8),
        new THREE.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.5, metalness: 0.55 })
      );
      tur.position.set(0, hullH + 1.6, -L * (0.28 + i * 0.09));
      tur.castShadow = true;
      g.add(tur);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, W * 0.9, 5),
        new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.5, metalness: 0.6 })
      );
      barrel.rotation.x = -Math.PI / 2.25;
      barrel.position.set(0, hullH + 2, -L * (0.32 + i * 0.09));
      barrel.castShadow = true;
      g.add(barrel);
    }
  }

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.6 })
  );
  mast.position.set(0, hullH * 2.6 + 4, -L * 0.14);
  mast.castShadow = true;
  g.add(mast);
  const flag = makeFlag(spec.side, 0.7);
  flag.position.set(3, hullH * 2.6 + 7, -L * 0.14);
  g.add(flag);

  g.add(makeRigging(
    new THREE.Vector3(0, hullH * 2.6 + 7.4, -L * 0.14),
    new THREE.Vector3(0, hullH + 0.6, -L * 0.48),
    new THREE.Vector3(0, hullH + 0.6, L * 0.47),
    [
      new THREE.Vector3(0, hullH * 2.6 + 7.4, -L * 0.14), new THREE.Vector3(W * 0.5, hullH + 0.6, L * 0.1),
      new THREE.Vector3(0, hullH * 2.6 + 7.4, -L * 0.14), new THREE.Vector3(-W * 0.5, hullH + 0.6, L * 0.1),
    ]
  ));

  g.add(makeAA(spec.kind === 'destroyer' ? 3 : 5, W * 0.52, L * 0.5, hullH + 0.9, spec.kind === 'destroyer' ? 5 : 9));

  g.add(makeRing(L * 0.7, SIDE_COLOR[spec.side]));
  g.userData.beam = W * 1.2;
  g.userData.len = L;
  return g;
}

// ── Blender glb 換裝(§3 模型替換) ────────────────────
// 模型為公尺制;場景 1 單位 ≈ 2.35 m,縮放一律由 fitLength(model, spec.length) 決定,
// 不在 glb 內硬編場景尺度(§0 鐵則 4)。
export function modelIdFor(spec) {
  const s = spec.side === 'red' ? 'ijn' : 'usn';
  if (spec.kind === 'carrier') {
    if (spec.side === 'red') return spec.islandSide === 'left' ? 'carrier_ijn_L' : 'carrier_ijn_R';
    return 'carrier_usn';
  }
  if (spec.kind === 'destroyer') return `destroyer_${s}`;
  // battleship(榛名／霧島)沒有專屬模型,沿用重巡艦體並以 length 拉長
  return `cruiser_${s}`;
}

// 艦體細節貼圖:glb 的 UV 是每面 0…1,平鋪倍率拉高即成鋼板紋理。
// metal_plate 的 diff 太暗(sRGB 平均 0.24/0.20/0.11),當 map 會把灰色艦體染成褐色,
// 故只取 nor + arm(法線與粗糙／金屬度),顏色仍由 glb 材質的 baseColor 決定。
// metal_plate ARM 的通道平均:AO 0.872 / roughness 0.589 / metalness 0.386。
// three 的 roughnessMap 是「乘」在 material.roughness 上,直接掛會讓艦體平均粗糙度
// 掉到 0.6 倍(整艘船變成反射天空的鏡子),故掛圖時把基底粗糙度除以該平均補回來;
// metalness 維持 glb 設定(不掛 metalnessMap,免得鋼板紋理把金屬度打散)。
const ARM_ROUGH_MEAN = 0.589;
function applyHullDetail(root, assets) {
  assets.textureSet('metal_plate', { maps: ['nor', 'arm'], repeat: [6, 6] }).then((set) => {
    if (!set.normalMap && !set.roughnessMap) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.userData?.noDetail) continue;
        if (set.normalMap) {
          m.normalMap = set.normalMap;
          m.normalScale = new THREE.Vector2(0.5, 0.5);
        }
        if (set.roughnessMap) {
          m.roughnessMap = set.roughnessMap;
          m.roughness = Math.min(1, m.roughness / ARM_ROUGH_MEAN);
        }
        m.needsUpdate = true;
      }
    });
  });
}

// 飛行甲板:換上本場自己的甲板貼圖(日之丸／片假名識別字／舷號、升降機、制動索)
function applyDeckPaint(root, spec) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !/_fd_mat$/.test(m.name || '')) continue;
      m.map = makeDeckTexture(spec);
      m.color.setRGB(1, 1, 1);
      m.roughness = 0.88;
      m.metalness = 0.02;
      m.userData.noDetail = true; // 甲板不套鋼板法線
      m.needsUpdate = true;
    }
  });
}

function swapInModel(g, spec, opts) {
  const assets = opts.assets;
  return assets.model(modelIdFor(spec)).then((src) => {
    if (!src || !g.userData.proc) return null;
    const model = cloneModel(src);
    const scale = fitLength(model, spec.length);
    // envMapIntensity 0.7:HDRI 全量會把 1942 年的灰色軍艦洗成亮面塑膠
    normalizeMaterials(model, { envMapIntensity: 0.7, roughnessMin: 0.4, shadows: !!opts.shadows });
    applyDeckPaint(model, spec);
    applyHullDetail(model, assets);

    const box = new THREE.Box3().setFromObject(model);
    const halfBeam = Math.max(box.max.x, -box.min.x);

    // 軍旗:掛在艦島／艦橋頂上(不放進 model,免得吃到 model 的縮放)。
    // 尺寸比程序化版小一半 — glb 的上層結構比積木版精細,大旗會整個蓋住艦島。
    const flag = makeFlag(spec.side, spec.kind === 'carrier' ? 0.6 : 0.42);
    const sgn = spec.islandSide === 'left' ? -1 : 1;
    flag.position.set(sgn * halfBeam * 0.34, box.max.y + 1.6, -spec.length * 0.02);
    g.add(flag);

    g.remove(g.userData.proc);
    g.userData.proc = null;
    g.add(model);
    g.userData.model = model;
    g.userData.beam = box.max.x - box.min.x;
    g.userData.len = spec.length;
    g.userData.modelScale = scale;
    g.userData.swapVersion = (g.userData.swapVersion ?? 0) + 1;
    if (typeof g.userData.onSwap === 'function') g.userData.onSwap(g);
    return scale;
  });
}

// 對外 API 不變:同步回傳 Group(程序化 fallback),glb 到了再換。
export function createShip(spec, opts = {}) {
  const proc = spec.kind === 'carrier' ? createCarrier(spec) : createEscort(spec);
  const g = new THREE.Group();
  g.userData.beam = proc.userData.beam;
  g.userData.len = proc.userData.len;
  g.userData.proc = proc;
  g.userData.swapVersion = 0;
  // 識別環與程序化艦體分開掛,換裝時不會被一起移除
  const ring = proc.children.find((c) => c.userData.isRing);
  if (ring) { proc.remove(ring); g.add(ring); }
  g.add(proc);
  if (opts.assets) swapInModel(g, spec, opts);
  return g;
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
