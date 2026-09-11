// 卡倫坦地形 — 諾曼第小鎮：市鎮街廓（含 Y 形路口的封街房舍）、
// 北面杜沃氾濫沼澤與 N13 高架堤道（紫心巷，502 團的）、貫穿西南的鐵路路堤（血腥溝 E 連死守處）、
// 西南的樹籬 bocage 圩田與 30 高地、佩里耶／博特公路。
// 地形邏輯（招牌手法）：①市鎮斜街成「死亡漏斗」（MG42 縱射）②堤道是無掩蔽瓶頸（紫心巷）
//   ③鐵路路堤＝天然胸牆（血腥溝 E 連背靠死守）④樹籬土堤每道邊都是射擊掩體。
// 註：尺度為可讀性放大；夏日諾曼第（6 月）偏暖綠。
// 座標：1 單位 = 10 公尺；原點 = 市鎮南緣路口；北 = -z（沼澤／堤道）、西南 = -x／+z（樹籬／血腥溝）。
//
// ── 美術升級（docs/art-upgrade-spec.md）─────────────────────────────
// L-1 地表：廢除「單色大平面＋硬邊多邊形田野」。改成三層一比一對映世界座標的程序化 canvas 貼圖：
//     ①region（1400 單位見方）圩田拼布、樹籬暗帶、沼澤濕地反光斑、道路車轍、鐵路道碴；
//     ②gulch（400 見方，血腥溝／bocage 特寫用）；③town（150 見方，鋪石街道＋瓦礫焦痕）。
//     ②③邊緣以 alpha 淡出疊在 ① 上，無接縫、無硬邊。三層皆非平鋪，故無平鋪接縫問題。
// L-2 植被：樹＝2–3 層錯位扁球（頂點抖動、上冠亮／下冠深）＋樹幹，全部 InstancedMesh；
//     樹籬＝連續土堤（合併幾何）＋沿線灌木 InstancedMesh ＋頂端零星高樹；桌機再撒草叢交叉 quad。
// L-3 建築：牆面／屋頂 canvas 貼圖（石砌／灰泥＋窗格百葉、瓦片橫線），煙囪、戰損缺角焦黑、
//     教堂尖塔十字；靜態建築依材質 mergeGeometries（整個市鎮約 10 個 draw call）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ── 可重現偽隨機（佈局固定，重整畫面不會變） ───────────────────
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// mergeGeometries 要求所有幾何的 index 有無一致：一律轉成非索引後再合併
function ni(geo) { return geo.index ? geo.toNonIndexed() : geo; }

// 在幾何上塗單一頂點色（供合併網格／InstancedMesh 以單一材質呈現多色）
function paint(geo, hex) {
  geo = ni(geo);
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ══════════════════════════════════════════════════════════════════
// 世界資料（貼圖與 3D 幾何共用同一份，兩者必然對齊）
// ══════════════════════════════════════════════════════════════════

// 樹籬 bocage（西南圩田邊界）：x,z 為中心、len 長度、rot 走向（方向向量 = cos rot, -sin rot）
const HEDGES = [
  { x: -70, z: 30, len: 80, rot: 0.10 },
  { x: -110, z: 70, len: 90, rot: 0.30 },
  { x: -50, z: 84, len: 70, rot: -0.20 },
  { x: -150, z: 50, len: 70, rot: 1.30 },
  { x: -30, z: 110, len: 90, rot: 0.05 },
  { x: -95, z: 130, len: 80, rot: 0.20 },
  { x: -172, z: 96, len: 76, rot: 1.18 },   // 補：西側圩田邊
  { x: -8, z: 150, len: 96, rot: 0.12 },    // 補：南側圩田邊
  { x: 62, z: 96, len: 84, rot: 1.42 },     // 補：東鄰麥田邊
];

// 圩田拼布（世界座標矩形，rot 為輕微傾角）；col = [基色, 條紋色]
const FIELDS = [
  { x: -20, z: 50, w: 240, d: 150, rot: 0.04, col: ['#71893f', '#5d7434'] },   // 西南開闊圩田（突入路線＋血腥溝）
  { x: -130, z: 110, w: 180, d: 150, rot: -0.05, col: ['#7c9349', '#657c39'] }, // 30 高地一帶
  { x: 70, z: 40, w: 130, d: 150, rot: 0.05, col: ['#a59a4d', '#8b813c'] },     // 東鄰麥田
  { x: 0, z: -40, w: 180, d: 90, rot: 0.0, col: ['#758842', '#627436'] },       // 市鎮基底
  { x: -210, z: 78, w: 130, d: 120, rot: 0.18, col: ['#849c4e', '#6d843d'] },   // 30 高地草坡
  { x: -60, z: 170, w: 150, d: 110, rot: -0.10, col: ['#a19a52', '#877f3e'] },  // 南面收割地
  { x: 96, z: 150, w: 120, d: 120, rot: 0.12, col: ['#6c823c', '#586b32'] },
  { x: -230, z: -30, w: 140, d: 120, rot: -0.08, col: ['#7f9a4b', '#68803b'] },
  { x: 150, z: -60, w: 130, d: 110, rot: 0.07, col: ['#93a751', '#79893e'] },
];

// 道路（世界座標折線）：土黃路面＋兩道車轍
const ROADS = [
  { pts: [[0, 40], [0, -20], [2, -56]], w: 7 },              // 主街（南緣路口 → 鎮北）
  { pts: [[-25, 6], [9, 6]], w: 7 },                          // 橫街（Y 形路口另一臂）
  { pts: [[26, -56], [26, -226]], w: 5.4 },                   // N13 堤道頂路面
  { pts: [[-140, 168], [-60, 96], [-8, 40], [4, 12]], w: 5 }, // 佩里耶／博特公路（德軍反撲來向）
  { pts: [[14, -30], [64, -46], [120, -40]], w: 4.4 },        // 東出鎮的鄉道
];

// 鐵路（巴黎–瑟堡線）：自市鎮東北向西南斜貫，路堤＝血腥溝的天然胸牆
const RAIL_A = { x: 24, z: -34 };
const RAIL_B = { x: -150, z: 96 };

// 沼澤（杜沃／馬德蓮氾濫地）
const MARSH = { x: 0, z: -180, w: 900, d: 230 };

// ══════════════════════════════════════════════════════════════════
// L-1 程序化地表貼圖
// ══════════════════════════════════════════════════════════════════

// 多倍頻值雜訊層：小格隨機灰階 → 放大平滑 → overlay 疊上（比逐像素快得多）
function noiseOverlay(g, S, cells, alpha, seed, mode = 'overlay') {
  const n = document.createElement('canvas');
  n.width = n.height = cells;
  const nc = n.getContext('2d');
  const img = nc.createImageData(cells, cells);
  const r = mulberry(seed);
  for (let i = 0; i < cells * cells; i++) {
    const v = 128 + (r() - 0.5) * 240;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.drawImage(n, 0, 0, S, S);
  g.restore();
}

// 把世界座標的圩田／樹籬／道路／沼澤／彈坑畫進一張一比一對映的畫布。
// region 與 gulch 兩張共用本函式 → 兩層的田界、路、鐵道必然對齊。
function paintGround(g, S, cx, cz, size, { detail = false } = {}) {
  const k = S / size;
  const X = (x) => (x - (cx - size / 2)) * k;
  const Y = (z) => (z - (cz - size / 2)) * k;
  const r = mulberry(1944);

  // ── 基底草地 ──
  g.fillStyle = '#6d8745';
  g.fillRect(0, 0, S, S);

  // ── 圩田色塊（低頻大色斑：黃綠／深綠／略帶土黃的收割地） ──
  for (const f of FIELDS) {
    g.save();
    g.translate(X(f.x), Y(f.z));
    g.rotate(f.rot);
    const w = f.w * k, d = f.d * k;
    g.fillStyle = f.col[0];
    g.fillRect(-w / 2, -d / 2, w, d);
    // 犁溝條紋（同一塊田方向一致，鄰田不同 → 拼布感）
    g.strokeStyle = f.col[1];
    g.lineWidth = Math.max(1, 2.4 * k);
    g.globalAlpha = 0.5;
    for (let y = -d / 2; y < d / 2; y += 9 * k) {
      g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke();
    }
    // 田塊邊界：略深的一圈
    g.globalAlpha = 0.55;
    g.strokeStyle = 'rgba(46,56,30,0.38)';
    g.lineWidth = Math.max(1.5, 3.2 * k);
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.restore();
    g.globalAlpha = 1;
  }

  // ── 草地明暗斑（多倍頻值雜訊 4 octave） ──
  noiseOverlay(g, S, 6, 0.42, 101);
  noiseOverlay(g, S, 14, 0.30, 202);
  noiseOverlay(g, S, 40, 0.22, 303);
  noiseOverlay(g, S, 120, 0.14, 404);

  // ── 杜沃氾濫沼澤：偏藍綠的濕地＋反光斑＋蘆葦暗塊 ──
  {
    const mx = X(MARSH.x), mz = Y(MARSH.z), mw = MARSH.w * k, md = MARSH.d * k;
    const grad = g.createLinearGradient(0, mz - md / 2, 0, mz + md / 2);
    grad.addColorStop(0, '#3d5145');
    grad.addColorStop(0.55, '#46604f');
    grad.addColorStop(1, '#4c6247');
    g.save();
    g.globalAlpha = 0.95;
    g.fillStyle = grad;
    g.fillRect(mx - mw / 2, mz - md / 2, mw, md);
    // 濕地反光斑（略亮偏藍綠，稀疏、拉長）
    for (let i = 0; i < 260; i++) {
      const px = mx - mw / 2 + r() * mw;
      const py = mz - md / 2 + r() * md;
      const rw = (6 + r() * 26) * k, rh = (1.5 + r() * 4) * k;
      g.globalAlpha = 0.12 + r() * 0.22;
      g.fillStyle = r() > 0.45 ? '#9fc4bd' : '#7fa9a3';
      g.beginPath(); g.ellipse(px, py, rw, rh, (r() - 0.5) * 0.5, 0, Math.PI * 2); g.fill();
    }
    // 蘆葦／草洲暗塊
    for (let i = 0; i < 90; i++) {
      const px = mx - mw / 2 + r() * mw;
      const py = mz - md / 2 + r() * md;
      g.globalAlpha = 0.18 + r() * 0.2;
      g.fillStyle = '#43532c';
      g.beginPath(); g.ellipse(px, py, (5 + r() * 16) * k, (2 + r() * 6) * k, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // ── 樹籬 bocage：土堤兩側的暗帶（樹冠投影感） ──
  for (const h of HEDGES) {
    const dx = Math.cos(h.rot), dz = -Math.sin(h.rot);
    const ax = h.x - dx * h.len / 2, az = h.z - dz * h.len / 2;
    const bx = h.x + dx * h.len / 2, bz = h.z + dz * h.len / 2;
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(30,40,22,0.26)';
    g.lineWidth = 13 * k;
    g.beginPath(); g.moveTo(X(ax), Y(az)); g.lineTo(X(bx), Y(bz)); g.stroke();
    g.strokeStyle = 'rgba(72,60,38,0.8)';   // 土堤本體的土色
    g.lineWidth = 3.4 * k;
    g.beginPath(); g.moveTo(X(ax), Y(az)); g.lineTo(X(bx), Y(bz)); g.stroke();
    g.restore();
  }

  // ── 鐵路道碴帶 ──
  {
    g.save();
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(96,86,66,0.92)';
    g.lineWidth = 12 * k;
    g.beginPath(); g.moveTo(X(RAIL_A.x), Y(RAIL_A.z)); g.lineTo(X(RAIL_B.x), Y(RAIL_B.z)); g.stroke();
    g.strokeStyle = 'rgba(126,116,96,0.85)';
    g.lineWidth = 7 * k;
    g.beginPath(); g.moveTo(X(RAIL_A.x), Y(RAIL_A.z)); g.lineTo(X(RAIL_B.x), Y(RAIL_B.z)); g.stroke();
    // 碎石顆粒
    const len = Math.hypot(RAIL_B.x - RAIL_A.x, RAIL_B.z - RAIL_A.z);
    for (let i = 0; i < 900; i++) {
      const t = r();
      const ox = (r() - 0.5) * 11, oz = (r() - 0.5) * 11;
      const wx = RAIL_A.x + (RAIL_B.x - RAIL_A.x) * t + ox;
      const wz = RAIL_A.z + (RAIL_B.z - RAIL_A.z) * t + oz;
      g.globalAlpha = 0.25 + r() * 0.4;
      g.fillStyle = r() > 0.5 ? '#8d8straight' : '#6b6350';
      g.fillStyle = r() > 0.5 ? '#948b73' : '#6b6350';
      g.fillRect(X(wx), Y(wz), Math.max(1, 1.1 * k), Math.max(1, 1.1 * k));
    }
    g.restore();
    g.globalAlpha = 1;
    void len;
  }

  // ── 道路：土黃路面＋兩道車轍暗線＋路肩漸層 ──
  for (const rd of ROADS) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const draw = (width, style, alpha) => {
      g.globalAlpha = alpha;
      g.strokeStyle = style;
      g.lineWidth = width * k;
      g.beginPath();
      g.moveTo(X(rd.pts[0][0]), Y(rd.pts[0][1]));
      for (let i = 1; i < rd.pts.length; i++) g.lineTo(X(rd.pts[i][0]), Y(rd.pts[i][1]));
      g.stroke();
    };
    draw(rd.w * 2.0, 'rgba(96,92,64,0.35)', 1);   // 路肩（草被壓黃）
    draw(rd.w * 1.35, '#8d8158', 1);              // 路肩內
    draw(rd.w, '#9d9166', 1);                     // 路面
    // 兩道車轍
    const off = rd.w * 0.24;
    for (const sgn of [-1, 1]) {
      g.globalAlpha = 0.5;
      g.strokeStyle = '#6a6144';
      g.lineWidth = rd.w * 0.16 * k;
      g.beginPath();
      for (let i = 0; i < rd.pts.length; i++) {
        const p = rd.pts[i];
        const q = rd.pts[Math.min(i + 1, rd.pts.length - 1)];
        const pv = rd.pts[Math.max(i - 1, 0)];
        const dx = q[0] - pv[0], dz = q[1] - pv[1];
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L * off * sgn, nz = dx / L * off * sgn;
        const fx = X(p[0] + nx), fz = Y(p[1] + nz);
        if (i === 0) g.moveTo(fx, fz); else g.lineTo(fx, fz);
      }
      g.stroke();
    }
    // 碎石顆粒
    g.globalAlpha = 0.22;
    for (let i = 0; i < 260; i++) {
      const seg = Math.floor(r() * (rd.pts.length - 1));
      const t = r();
      const a = rd.pts[seg], b = rd.pts[seg + 1];
      const wx = a[0] + (b[0] - a[0]) * t + (r() - 0.5) * rd.w;
      const wz = a[1] + (b[1] - a[1]) * t + (r() - 0.5) * rd.w;
      g.fillStyle = r() > 0.5 ? '#b6a97c' : '#5f573d';
      g.fillRect(X(wx), Y(wz), Math.max(1, 1.2 * k), Math.max(1, 1.2 * k));
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // ── 戰區：彈坑暈染＋踩踏痕（市鎮街口與血腥溝路堤前） ──
  const CRATER_ZONES = [
    { x: 2, z: 4, rad: 46, n: 16 },       // Y 形路口街戰
    { x: -66, z: 62, rad: 70, n: 22 },    // 血腥溝路堤
    { x: -104, z: 88, rad: 66, n: 18 },   // 德軍鋒頭
    { x: 26, z: -120, rad: 40, n: 10 },   // N13 堤道
  ];
  for (const zone of CRATER_ZONES) {
    for (let i = 0; i < zone.n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * zone.rad;
      const wx = zone.x + Math.cos(a) * d, wz = zone.z + Math.sin(a) * d;
      const rad = (2.2 + r() * 4.4) * k;
      const px = X(wx), py = Y(wz);
      // 淺色濺邊
      let grad = g.createRadialGradient(px, py, rad * 0.5, px, py, rad * 2.1);
      grad.addColorStop(0, 'rgba(150,138,106,0.5)');
      grad.addColorStop(1, 'rgba(150,138,106,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(px, py, rad * 2.1, 0, Math.PI * 2); g.fill();
      // 焦土坑心
      grad = g.createRadialGradient(px, py, 1, px, py, rad);
      grad.addColorStop(0, `rgba(38,32,26,${0.62 + r() * 0.24})`);
      grad.addColorStop(1, 'rgba(38,32,26,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
    }
  }
  // 踩踏痕（部隊行進路線上的踩平草地）
  const TRAMPLE = [
    [[-20, 66], [-8, 30], [2, 12], [8, -8], [2, -20]],       // E 連突入路線
    [[-28, 28], [-56, 56], [-66, 62]],                        // 6/13 出鎮上路堤
    [[-150, 120], [-110, 92], [-86, 78]],                     // 德軍反撲軸
  ];
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const path of TRAMPLE) {
    g.globalAlpha = 0.3;
    g.strokeStyle = '#7a7148';
    g.lineWidth = 5.5 * k;
    g.beginPath();
    g.moveTo(X(path[0][0]), Y(path[0][1]));
    for (let i = 1; i < path.length; i++) g.lineTo(X(path[i][0]), Y(path[i][1]));
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;

  // ── 近景細節（gulch 層專用）：草束顆粒與小石 ──
  if (detail) {
    g.save();
    for (let i = 0; i < 9000; i++) {
      const px = r() * S, py = r() * S;
      g.globalAlpha = 0.06 + r() * 0.1;
      g.fillStyle = r() > 0.55 ? '#8ea856' : '#3f4f27';
      g.fillRect(px, py, 1.5, 1.5 + r() * 2.5);
    }
    g.restore();
    g.globalAlpha = 1;
  }
}

// region／gulch 貼圖（gulch 邊緣以 alpha 淡出，疊在 region 上不留硬邊）
function makeGroundTexture(S, cx, cz, size, { detail = false, feather = 0 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  paintGround(g, S, cx, cz, size, { detail });
  if (feather > 0) {
    g.globalCompositeOperation = 'destination-in';
    const grad = g.createRadialGradient(S / 2, S / 2, S * (0.5 - feather), S / 2, S / 2, S * 0.5);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 市鎮貼圖：鋪石街道＋人行道＋庭院＋瓦礫焦痕（150 單位見方，邊緣淡出）
function makeTownTexture(S) {
  const CX = -4, CZ = -14, SIZE = 150;
  const k = S / SIZE;
  const X = (x) => (x - (CX - SIZE / 2)) * k;
  const Y = (z) => (z - (CZ - SIZE / 2)) * k;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(612);

  // 鎮內地表：踩實的土黃＋草縫
  g.fillStyle = '#7d7d54';
  g.fillRect(0, 0, S, S);
  noiseOverlay(g, S, 10, 0.34, 51);
  noiseOverlay(g, S, 36, 0.24, 52);
  noiseOverlay(g, S, 110, 0.16, 53);

  // 街道區塊（主街＋橫街＋路口廣場）
  const STREETS = [
    { pts: [[0, 26], [0, -20], [2, -52]], w: 8.6 },
    { pts: [[-26, 6], [10, 6]], w: 8.0 },
    { pts: [[2, -26], [-20, -30]], w: 6.4 },   // 通往教堂的小巷
  ];
  const drawStreet = (style, wMul, alpha) => {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalAlpha = alpha; g.strokeStyle = style;
    for (const st of STREETS) {
      g.lineWidth = st.w * wMul * k;
      g.beginPath();
      g.moveTo(X(st.pts[0][0]), Y(st.pts[0][1]));
      for (let i = 1; i < st.pts.length; i++) g.lineTo(X(st.pts[i][0]), Y(st.pts[i][1]));
      g.stroke();
    }
    g.restore();
  };
  drawStreet('#8a8368', 1.28, 1);   // 人行道／路肩
  drawStreet('#767464', 1.0, 1);    // 鋪石路面底色

  // 鋪石：把石塊只畫在街道遮罩內
  const stones = document.createElement('canvas');
  stones.width = stones.height = S;
  const sg = stones.getContext('2d');
  sg.fillStyle = '#7b7867';
  sg.fillRect(0, 0, S, S);
  const cell = 2.0 * k;   // 約 2 單位 = 20 公尺？不：此層 1 單位 = 10 公尺，石塊取 0.9 單位
  const cs = 0.95 * k;
  for (let y = 0; y < S; y += cs) {
    const jitter = ((y / cs) | 0) % 2 ? cs * 0.5 : 0;
    for (let x = -cs; x < S; x += cs) {
      const v = 0.72 + r() * 0.5;
      const base = 122 * v;
      sg.fillStyle = `rgb(${(base * 1.02) | 0},${(base * 1.0) | 0},${(base * 0.9) | 0})`;
      sg.fillRect(x + jitter + 0.6, y + 0.6, cs - 1.2, cs - 1.2);
    }
  }
  void cell;
  // 以街道形狀當遮罩
  sg.globalCompositeOperation = 'destination-in';
  sg.lineCap = 'round'; sg.lineJoin = 'round';
  sg.strokeStyle = '#000';
  for (const st of STREETS) {
    sg.lineWidth = st.w * k;
    sg.beginPath();
    sg.moveTo(X(st.pts[0][0]), Y(st.pts[0][1]));
    for (let i = 1; i < st.pts.length; i++) sg.lineTo(X(st.pts[i][0]), Y(st.pts[i][1]));
    sg.stroke();
  }
  sg.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.9;
  g.drawImage(stones, 0, 0);
  g.globalAlpha = 1;

  // 排水溝（溫特斯把弟兄踢出去的那條路邊溝渠）
  g.save();
  g.lineCap = 'round';
  g.globalAlpha = 0.55;
  g.strokeStyle = '#3f4032';
  g.lineWidth = 1.4 * k;
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.moveTo(X(0 + sgn * 4.6), Y(26));
    g.lineTo(X(0 + sgn * 4.6), Y(-20));
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;

  // 瓦礫、彈痕、焦黑（Y 形路口最重）
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 34;
    const wx = 3 + Math.cos(a) * d, wz = 2 + Math.sin(a) * d * 0.9;
    g.globalAlpha = 0.2 + r() * 0.45;
    g.fillStyle = r() > 0.6 ? '#b8b2a0' : (r() > 0.4 ? '#4d4740' : '#2c2723');
    g.fillRect(X(wx), Y(wz), (0.25 + r() * 0.75) * k, (0.25 + r() * 0.75) * k);
  }
  g.globalAlpha = 1;
  for (const sc of [[4, 6], [-2, -4], [9, -8], [-14, 2], [6, 12]]) {
    const px = X(sc[0]), py = Y(sc[1]);
    const rad = (3 + r() * 5) * k;
    const grad = g.createRadialGradient(px, py, 1, px, py, rad);
    grad.addColorStop(0, 'rgba(26,22,19,0.7)');
    grad.addColorStop(1, 'rgba(26,22,19,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
  }

  // 邊緣淡出
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, cx: CX, cz: CZ, size: SIZE };
}

// ══════════════════════════════════════════════════════════════════
// L-3 建築貼圖：牆面（灰泥／石砌＋窗格百葉＋門）、屋頂（瓦片／石板）
// ══════════════════════════════════════════════════════════════════

// 立面貼圖：一張圖對映一個牆面（BoxGeometry 每面 UV 0–1，故不平鋪）
function makeFacadeTexture(kind) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(kind === 'stone' ? 31 : kind === 'ochre' ? 17 : kind === 'charred' ? 71 : 5);
  const base = { cream: '#bdae8d', ochre: '#a8946e', stone: '#968c74', charred: '#7b7161' }[kind];
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  if (kind === 'stone') {
    // 石砌：不規則橫排石塊＋灰縫
    let y = 0;
    let row = 0;
    while (y < S) {
      const h = 22 + r() * 14;
      let x = row % 2 ? -20 - r() * 20 : 0;
      while (x < S) {
        const w = 34 + r() * 40;
        const v = 0.86 + r() * 0.28;
        g.fillStyle = `rgb(${(168 * v) | 0},${(160 * v) | 0},${(136 * v) | 0})`;
        g.fillRect(x + 2, y + 2, w - 4, h - 4);
        x += w;
      }
      y += h; row++;
    }
  } else {
    // 灰泥：斑駁色塊＋剝落露磚
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.05 + r() * 0.12;
      g.fillStyle = r() > 0.5 ? '#ffffff' : '#7c705a';
      g.beginPath();
      g.ellipse(r() * S, r() * S, 14 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 16; i++) {   // 剝落處露出石／磚
      const px = r() * S, py = r() * S, w = 20 + r() * 46, h = 14 + r() * 30;
      g.globalAlpha = 0.5;
      g.fillStyle = '#96795e';
      g.fillRect(px, py, w, h);
      g.globalAlpha = 1;
    }
  }
  noiseOverlay(g, S, 64, 0.18, 909);
  noiseOverlay(g, S, 180, 0.12, 910);

  // 牆基（諾曼第石腳）
  g.globalAlpha = 0.42;
  g.fillStyle = '#6f6552';
  g.fillRect(0, S * 0.88, S, S * 0.12);
  g.globalAlpha = 1;

  // 窗（上下兩排各兩扇）＋綠百葉＋門
  const win = (cx, cy, w, h) => {
    // 窗洞
    g.fillStyle = '#2a2c28';
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    // 玻璃反光
    const gr = g.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    gr.addColorStop(0, 'rgba(150,170,180,0.55)');
    gr.addColorStop(0.5, 'rgba(40,46,50,0.2)');
    gr.addColorStop(1, 'rgba(110,126,136,0.35)');
    g.fillStyle = gr;
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    // 窗櫺
    g.strokeStyle = '#d8d2c4'; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy - h / 2); g.lineTo(cx, cy + h / 2);
    g.moveTo(cx - w / 2, cy); g.lineTo(cx + w / 2, cy);
    g.stroke();
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    // 綠百葉（兩側）
    g.fillStyle = kind === 'charred' ? '#3a382c' : '#4d6750';
    for (const s of [-1, 1]) {
      const bx = cx + s * (w / 2 + w * 0.22) - w * 0.2;
      g.fillRect(bx, cy - h / 2, w * 0.4, h);
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
      for (let yy = cy - h / 2 + 5; yy < cy + h / 2; yy += 7) {
        g.beginPath(); g.moveTo(bx, yy); g.lineTo(bx + w * 0.4, yy); g.stroke();
      }
    }
    // 窗楣石
    g.fillStyle = 'rgba(228,222,206,0.65)';
    g.fillRect(cx - w * 0.75, cy - h / 2 - 9, w * 1.5, 8);
  };
  win(S * 0.24, S * 0.30, 70, 96);
  win(S * 0.76, S * 0.30, 70, 96);
  win(S * 0.24, S * 0.63, 70, 96);
  win(S * 0.76, S * 0.63, 70, 96);
  // 門
  g.fillStyle = kind === 'charred' ? '#22201b' : '#5a4127';
  g.fillRect(S * 0.44, S * 0.62, S * 0.12, S * 0.28);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  g.strokeRect(S * 0.44, S * 0.62, S * 0.12, S * 0.28);
  g.fillStyle = 'rgba(228,222,206,0.55)';
  g.fillRect(S * 0.42, S * 0.60, S * 0.16, 8);

  if (kind === 'charred') {
    // 戰損：窗上焦黑舌狀煙痕、彈孔
    for (const cx of [S * 0.24, S * 0.76, S * 0.5]) {
      const gr = g.createLinearGradient(cx, S * 0.30, cx, 0);
      gr.addColorStop(0, 'rgba(18,15,13,0.85)');
      gr.addColorStop(1, 'rgba(18,15,13,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(cx - 52, S * 0.32); g.lineTo(cx + 52, S * 0.32);
      g.lineTo(cx + 22, 0); g.lineTo(cx - 22, 0); g.closePath(); g.fill();
    }
    for (let i = 0; i < 120; i++) {
      g.globalAlpha = 0.3 + r() * 0.5;
      g.fillStyle = '#1c1916';
      g.beginPath(); g.arc(r() * S, r() * S, 1.5 + r() * 4, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 屋頂貼圖：瓦片橫線＋逐片色差（平鋪）
function makeRoofTexture(kind) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(kind === 'slate' ? 23 : 13);
  const base = kind === 'slate' ? [74, 77, 84] : [134, 70, 46];
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, S, S);
  const rowH = kind === 'slate' ? 16 : 20;
  for (let y = 0, row = 0; y < S; y += rowH, row++) {
    const off = row % 2 ? rowH * 0.5 : 0;
    for (let x = -rowH; x < S; x += rowH) {
      const v = 0.78 + r() * 0.46;
      g.fillStyle = `rgb(${(base[0] * v) | 0},${(base[1] * v) | 0},${(base[2] * v) | 0})`;
      if (kind === 'slate') g.fillRect(x + off + 1, y + 1, rowH - 2, rowH - 2);
      else {
        g.beginPath();
        g.roundRect ? g.roundRect(x + off + 1, y + 1, rowH - 2, rowH - 2, 4) : g.rect(x + off + 1, y + 1, rowH - 2, rowH - 2);
        g.fill();
      }
    }
    // 橫向陰影線（瓦片搭接）
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, y, S, 2.5);
  }
  noiseOverlay(g, S, 40, 0.2, 777);
  // 苔痕
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = 0.06 + r() * 0.12;
    g.fillStyle = '#5c6b3c';
    g.beginPath(); g.ellipse(r() * S, r() * S, 8 + r() * 26, 5 + r() * 16, 0, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 8;
  return t;
}

// 草叢 alpha 貼圖（交叉雙面 quad 用）
function makeGrassTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(88);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    const x = 6 + r() * (S - 12);
    const h = 22 + r() * 38;
    const w = 2 + r() * 2.6;
    const bend = (r() - 0.5) * 16;
    const v = 0.7 + r() * 0.5;
    g.fillStyle = `rgb(${(104 * v) | 0},${(132 * v) | 0},${(58 * v) | 0})`;
    g.beginPath();
    g.moveTo(x - w / 2, S);
    g.quadraticCurveTo(x - w / 2 + bend * 0.5, S - h * 0.6, x + bend, S - h);
    g.quadraticCurveTo(x + w / 2 + bend * 0.5, S - h * 0.6, x + w / 2, S);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ══════════════════════════════════════════════════════════════════
// L-2 樹木幾何：2–3 層錯位扁球（頂點抖動）＋樹幹，合併成單一帶頂點色 geometry
// ══════════════════════════════════════════════════════════════════
function makeTreeGeometry(kind, seed) {
  const r = mulberry(seed);
  const parts = [];
  const tall = kind === 'tall';
  const trunkH = tall ? 4.2 : 2.8;
  const trunk = new THREE.CylinderGeometry(0.32, 0.62, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, 0x4d3a26));

  const tiers = tall
    ? [[3.5, -0.5, trunkH + 1.0, 0.45, 0x3f5626], [3.0, 0.9, trunkH + 2.9, 0.55, 0x577a2e], [2.2, -0.6, trunkH + 4.4, 0.5, 0x6d9138]]
    : [[2.9, 0.4, trunkH + 0.7, 0.42, 0x3c5124], [2.3, -0.7, trunkH + 2.2, 0.5, 0x60852f]];
  for (const [rad, dx, y, flat, col] of tiers) {
    const ico = new THREE.IcosahedronGeometry(rad, 1);
    const pos = ico.attributes.position;
    for (let i = 0; i < pos.count; i++) {   // 頂點微抖動 → 不規則樹冠
      pos.setXYZ(
        i,
        pos.getX(i) * (0.86 + r() * 0.3),
        pos.getY(i) * (0.86 + r() * 0.3),
        pos.getZ(i) * (0.86 + r() * 0.3)
      );
    }
    ico.scale(1, 1 - flat * 0.5, 1);
    ico.translate(dx, y, (r() - 0.5) * 1.2);
    ico.computeVertexNormals();
    parts.push(paint(ico, col));
  }
  return mergeGeometries(parts, false);
}

// 樹籬灌木：一顆低矮不規則扁球
function makeBushGeometry(seed) {
  const r = mulberry(seed);
  const ico = new THREE.IcosahedronGeometry(2.6, 1);
  const pos = ico.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * (0.8 + r() * 0.44), pos.getY(i) * (0.7 + r() * 0.5), pos.getZ(i) * (0.8 + r() * 0.44));
  }
  ico.scale(1.15, 0.95, 1.15);
  ico.translate(0, 2.2, 0);
  ico.computeVertexNormals();
  return paint(ico, 0x4a6329);
}

// ══════════════════════════════════════════════════════════════════
export function createCarentanTerrain(scene, { shadows = false, mobile = false } = {}) {
  const g = new THREE.Group();
  const rng = mulberry(777);
  const TEX = mobile ? 1024 : 2048;
  const SUB = mobile ? 512 : 1024;

  // ── L-1：三層程序化地表 ───────────────────────────────────
  const regionTex = makeGroundTexture(TEX, -40, -40, 1400);
  const regionMat = new THREE.MeshLambertMaterial({
    map: regionTex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  const region = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), regionMat);
  region.rotation.x = -Math.PI / 2;
  region.position.set(-40, 0.02, -40);
  if (shadows) region.receiveShadow = true;
  g.add(region);

  // 血腥溝／bocage 近景細節層（邊緣淡出疊上）
  const gulchTex = makeGroundTexture(SUB, -90, 70, 400, { detail: true, feather: 0.22 });
  const gulch = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({
      map: gulchTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    })
  );
  gulch.rotation.x = -Math.PI / 2;
  gulch.position.set(-90, 0.06, 70);
  if (shadows) gulch.receiveShadow = true;
  g.add(gulch);

  // 市鎮鋪石街道層
  const town = makeTownTexture(SUB);
  const townPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(town.size, town.size),
    new THREE.MeshLambertMaterial({ map: town.tex, transparent: true, depthWrite: false })
  );
  townPlane.rotation.x = -Math.PI / 2;
  townPlane.position.set(town.cx, 0.10, town.cz);
  if (shadows) townPlane.receiveShadow = true;
  g.add(townPlane);

  // ── 材質（3D 幾何用） ─────────────────────────────────────
  const bankMat = new THREE.MeshLambertMaterial({ color: 0x6a5a3c });    // 樹籬／路堤土堤
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x4a5f52, transparent: true, opacity: 0.55, depthWrite: false });
  const vcMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  const vcFlat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const boxes = [];   // 供最後合併的雜項幾何（頂點色）
  function addBox(w, h, d, hex, x, y, z, ry = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
    boxes.push(paint(geo, hex));
  }

  // ── 北面：杜沃／馬德蓮氾濫沼澤（水面薄層；濕地反光已畫在貼圖裡） ──
  const marsh = new THREE.Mesh(new THREE.PlaneGeometry(MARSH.w, MARSH.d), waterMat);
  marsh.rotation.x = -Math.PI / 2;
  marsh.position.set(MARSH.x, 0.16, MARSH.z);
  g.add(marsh);
  // 沼澤露出的草洲（合併；改用 seeded rng，重整不會變）
  {
    const parts = [];
    for (const p of [[-120, -150], [40, -200], [150, -160], [-30, -230], [-210, -190], [96, -238]]) {
      const geo = new THREE.PlaneGeometry(60 + rng() * 40, 26 + rng() * 16);
      geo.rotateX(-Math.PI / 2);
      geo.translate(p[0], 0.24, p[1]);
      parts.push(paint(geo, 0x54632f));
    }
    const islets = new THREE.Mesh(mergeGeometries(parts, false), vcMat());
    if (shadows) islets.receiveShadow = true;
    g.add(islets);
  }

  // ── N13 堤道（紫心巷，502 團的）：堤體、橋墩、護欄 ──────────
  addBox(6, 2.2, 150, 0x6a5a3c, 26, 1.1, -150);                    // 堤體
  addBox(5, 0.3, 150, 0x8d8158, 26, 2.3, -150);                    // 堤頂路面
  for (let i = 0; i < 4; i++) addBox(7, 1.0, 7, 0xa89c82, 26, 1.0, -90 - i * 34);   // 四座石橋墩
  for (let i = 0; i < 9; i++) addBox(0.5, 2.6, 0.5, 0x5a4127, 23.4, 1.3, -78 - i * 17); // 護欄柱（西側）

  // ── 鐵路路堤（血腥溝 E 連死守處）：路堤、道碴、雙軌、枕木 ─────
  const RAIL_ANG = Math.PI * 0.72;
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const cx = RAIL_A.x + (RAIL_B.x - RAIL_A.x) * t;
    const cz = RAIL_A.z + (RAIL_B.z - RAIL_A.z) * t;
    addBox(12, 1.6, 9, 0x6a5a3c, cx, 0.8, cz, RAIL_ANG);
    addBox(11, 0.3, 6.2, 0x6d6149, cx, 1.65, cz, RAIL_ANG);
  }
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    const cx = RAIL_A.x + (RAIL_B.x - RAIL_A.x) * t;
    const cz = RAIL_A.z + (RAIL_B.z - RAIL_A.z) * t;
    addBox(3.6, 0.22, 0.9, 0x4b3a26, cx, 1.82, cz, RAIL_ANG);       // 枕木
    for (const off of [-1.6, 1.6]) {
      addBox(0.3, 0.3, 5.0, 0x3a3a3e, cx + off * Math.sin(RAIL_ANG), 1.95, cz - off * Math.cos(RAIL_ANG), RAIL_ANG);
    }
  }

  // ── 樹籬 bocage：連續土堤（合併）＋沿線灌木 InstancedMesh ─────
  const bushPlacements = [];
  const treePlacements = [[], []];
  const dummy = new THREE.Object3D();
  for (const h of HEDGES) {
    // 土堤（略高於地面的長條，兩層做出圓角感）
    addBox(h.len, 1.3, 2.4, 0x6a5a3c, h.x, 0.62, h.z, h.rot);
    addBox(h.len, 0.9, 1.5, 0x76653f, h.x, 1.28, h.z, h.rot);
    const dx = Math.cos(h.rot), dz = -Math.sin(h.rot);
    const n = Math.max(4, Math.round(h.len / 4.2));
    for (let i = 0; i < n; i++) {
      const o = (i / (n - 1) - 0.5) * h.len;
      dummy.position.set(h.x + dx * o + (rng() - 0.5) * 1.4, 0.9, h.z + dz * o + (rng() - 0.5) * 1.4);
      dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
      const s = 0.8 + rng() * 0.55;
      dummy.scale.set(s, s * (0.8 + rng() * 0.4), s);
      dummy.updateMatrix();
      bushPlacements.push(dummy.matrix.clone());
    }
    // 樹籬頂端隨機幾棵高樹（諾曼第 bocage 的招牌剪影）
    const tn = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < tn; i++) {
      const o = (rng() - 0.5) * h.len * 0.9;
      dummy.position.set(h.x + dx * o, 1.4, h.z + dz * o);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.9 + rng() * 0.45);
      dummy.updateMatrix();
      treePlacements[0].push(dummy.matrix.clone());
    }
  }

  // ── 零星樹叢（圩田邊、農舍旁、沼澤南岸、鐵道旁） ───────────────
  const SCATTER = [
    [40, 70], [-180, 90], [60, -10], [-40, 140], [100, 50], [-240, 40], [-200, 130],
    [130, 96], [-150, 170], [30, 130], [-120, -20], [-60, -50], [70, -70], [160, 20],
    [-260, 100], [-30, 190], [110, 150], [-190, -60], [180, 80], [-90, -40],
  ];
  for (const p of SCATTER) {
    const cluster = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < cluster; i++) {
      dummy.position.set(p[0] + (rng() - 0.5) * 16, 0, p[1] + (rng() - 0.5) * 16);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.8 + rng() * 0.5);
      dummy.updateMatrix();
      treePlacements[rng() > 0.45 ? 0 : 1].push(dummy.matrix.clone());
    }
  }

  const treeGeos = [makeTreeGeometry('tall', 401), makeTreeGeometry('round', 402)];
  const foliageMat = vcFlat();
  for (let v = 0; v < 2; v++) {
    if (!treePlacements[v].length) continue;
    const im = new THREE.InstancedMesh(treeGeos[v], foliageMat, treePlacements[v].length);
    for (let i = 0; i < treePlacements[v].length; i++) im.setMatrixAt(i, treePlacements[v][i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    g.add(im);
  }
  {
    const bushIM = new THREE.InstancedMesh(makeBushGeometry(403), foliageMat, bushPlacements.length);
    for (let i = 0; i < bushPlacements.length; i++) bushIM.setMatrixAt(i, bushPlacements[i]);
    bushIM.instanceMatrix.needsUpdate = true;
    if (shadows) { bushIM.castShadow = true; bushIM.receiveShadow = true; }
    g.add(bushIM);
  }

  // ── 草叢（桌機限定）：戰鬥核心區的交叉雙面 quad，隨風輕搖 ────────
  let grassIM = null, grassTotal = 0;
  const windUniform = { value: 0 };
  if (!mobile) {
    const quad = [];
    for (const ry of [0, Math.PI / 2]) {
      const p = new THREE.PlaneGeometry(2.6, 2.4);
      p.translate(0, 1.2, 0);
      p.rotateY(ry);
      quad.push(ni(p));
    }
    const grassGeo = mergeGeometries(quad, false);
    const grassMat = new THREE.MeshLambertMaterial({
      map: makeGrassTexture(), transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
    });
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windUniform;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float sway = max(transformed.y - 0.2, 0.0) * 0.20;
           transformed.x += sin(uWind * 1.7 + instanceMatrix[3][0] * 0.4) * sway;
           transformed.z += cos(uWind * 1.3 + instanceMatrix[3][2] * 0.35) * sway * 0.6;`
        );
    };
    const spots = [];
    const inTown = (x, z) => x > -34 && x < 26 && z > -50 && z < 20;
    const inMarsh = (z) => z < -62;
    for (let i = 0; i < 3000; i++) {
      const x = -200 + rng() * 300;
      const z = -70 + rng() * 240;
      if (inTown(x, z) || inMarsh(z)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      const s = 0.7 + rng() * 0.8;
      dummy.scale.set(s, s * (0.75 + rng() * 0.6), s);
      dummy.updateMatrix();
      spots.push(dummy.matrix.clone());
    }
    grassTotal = spots.length;
    grassIM = new THREE.InstancedMesh(grassGeo, grassMat, grassTotal);
    for (let i = 0; i < grassTotal; i++) grassIM.setMatrixAt(i, spots[i]);
    grassIM.instanceMatrix.needsUpdate = true;
    grassIM.frustumCulled = false;
    g.add(grassIM);
  }

  // ══════════════════════════════════════════════════════════
  // L-3 市鎮建築（依材質合併）
  // ══════════════════════════════════════════════════════════
  const facadeParts = { cream: [], ochre: [], stone: [], charred: [] };
  const roofParts = { tile: [], slate: [] };
  const gableParts = [];   // 山牆三角（頂點色）
  const trimParts = [];    // 煙囪、屋脊、門廊、十字（頂點色）

  const M = (x, y, z, ry) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);

  // 諾曼第街屋：牆體（立面貼圖）＋雙坡瓦頂＋山牆＋煙囪；damage 給戰損屋
  function house(x, z, rot, w, d, h, wallKind, roofKind, { damage = 0, chimney = true } = {}) {
    const mat = M(x, 0, z, rot);

    const wall = new THREE.BoxGeometry(w, h, d);
    wall.translate(0, h / 2, 0);
    wall.applyMatrix4(mat);
    facadeParts[wallKind].push(ni(wall));

    const rh = h * 0.5;                     // 屋脊高
    const slope = Math.hypot(w / 2, rh);
    const ang = Math.atan2(rh, w / 2);
    const dd = d * 1.08;
    for (const sgn of [-1, 1]) {
      // 戰損：缺角 → 該側屋頂縮短
      const cut = damage && sgn > 0 ? 0.55 : 1;
      const slab = new THREE.BoxGeometry(slope, 0.36, dd * cut);
      slab.rotateZ(-sgn * ang);
      slab.translate(sgn * w / 4 * 1.05, h + rh / 2 - 0.1, sgn > 0 ? (dd * cut - dd) / 2 : 0);
      slab.applyMatrix4(mat);
      roofParts[roofKind].push(ni(slab));
    }
    // 屋脊壓瓦
    const ridge = new THREE.BoxGeometry(0.55, 0.4, dd * (damage ? 0.7 : 1));
    ridge.translate(0, h + rh, 0);
    ridge.applyMatrix4(mat);
    trimParts.push(paint(ridge, roofKind === 'slate' ? 0x4a4b50 : 0x6a3e2f));

    // 山牆三角（兩端）
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, rh); shape.closePath();
    const gcol = { cream: 0xc4b79a, ochre: 0xb3a07b, stone: 0xa09781, charred: 0x6d6357 }[wallKind];
    for (const sgn of [-1, 1]) {
      const tri = new THREE.ShapeGeometry(shape);
      tri.translate(0, h, sgn * d / 2);
      if (sgn < 0) tri.rotateY(Math.PI);   // 背面朝外
      tri.applyMatrix4(mat);
      gableParts.push(paint(tri, gcol));
    }
    // 戰損：焦黑的椽木露出
    if (damage) {
      for (let i = 0; i < 4; i++) {
        const rafter = new THREE.BoxGeometry(w * 0.9, 0.2, 0.2);
        rafter.rotateZ(0.12 * (i % 2 ? 1 : -1));
        rafter.translate(0, h + rh * 0.55 - i * 0.5, d * 0.24 + i * 0.7);
        rafter.applyMatrix4(mat);
        trimParts.push(paint(rafter, 0x241f19));
      }
    }
    // 煙囪
    if (chimney) {
      const cw = 1.5;
      const ch = new THREE.BoxGeometry(cw, rh + 1.9, cw);
      ch.translate(w * 0.3, h + (rh + 1.9) / 2 - 0.4, -d * 0.22);
      ch.applyMatrix4(mat);
      trimParts.push(paint(ch, 0x8c7b64));
      const cap = new THREE.BoxGeometry(cw * 1.36, 0.36, cw * 1.36);
      cap.translate(w * 0.3, h + rh + 1.6, -d * 0.22);
      cap.applyMatrix4(mat);
      trimParts.push(paint(cap, 0x4a423a));
    }
  }

  // 主街沿 z 軸（南緣路口 → 鎮中心 → 北）；房舍夾街分佈
  // 街東排屋
  house(14, -2, -Math.PI / 2, 12, 9, 6, 'cream', 'tile');
  house(16, -16, -Math.PI / 2, 14, 9, 6.5, 'ochre', 'slate');
  house(15, -30, -Math.PI / 2, 12, 8, 6, 'charred', 'tile', { damage: 1 });   // 戰損：屋頂缺角、牆面焦黑
  // 街西排屋
  house(-14, -6, Math.PI / 2, 12, 9, 6, 'ochre', 'slate');
  house(-15, -20, Math.PI / 2, 13, 9, 6.5, 'cream', 'tile');
  house(-14, -34, Math.PI / 2, 11, 8, 5.5, 'ochre', 'slate');
  // 鎮外圍再補幾棟，讓市鎮不是一條街
  house(30, -12, -Math.PI / 2, 11, 8, 5.5, 'cream', 'tile');
  house(28, -34, -Math.PI / 2, 12, 9, 6, 'stone', 'slate');
  house(-30, -44, 0.2, 13, 9, 6, 'ochre', 'tile');
  house(20, 14, Math.PI, 10, 8, 5.5, 'charred', 'slate', { damage: 1 });      // 路口東側被打爛的屋
  house(-26, 12, Math.PI, 11, 8, 5.5, 'cream', 'tile');
  // Café du Stade — Y 形路口街頭、藏 MG42 的二層街屋（醒目、偏高）
  house(8, 9, Math.PI, 12, 10, 8.5, 'cream', 'tile');
  addBox(2.0, 1.4, 0.3, 0x1d1f1c, 6.8, 6.2, 3.6);   // 二樓窗口（MG 射孔，朝南街）

  // 教堂（諾曼第小鎮地標：石堂 + 鐘塔 + 尖頂 + 十字）
  house(-22, -26, 0, 14, 22, 9, 'stone', 'slate', { chimney: false });
  {
    const tower = new THREE.BoxGeometry(7, 18, 7);
    tower.translate(-22, 9, -38);
    facadeParts.stone.push(ni(tower));
    // 鐘塔百葉窗洞（四面）
    for (const [dx, dz] of [[3.6, 0], [-3.6, 0], [0, 3.6], [0, -3.6]]) {
      const louv = new THREE.BoxGeometry(dz ? 2.6 : 0.3, 3.4, dz ? 0.3 : 2.6);
      louv.translate(-22 + dx, 13.5, -38 + dz);
      trimParts.push(paint(louv, 0x2b2d28));
    }
    const spire = new THREE.ConeGeometry(5.2, 10, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(-22, 23, -38);
    roofParts.slate.push(ni(spire));
    // 十字（尖塔頂）
    const cv = new THREE.BoxGeometry(0.26, 2.4, 0.26); cv.translate(-22, 29.4, -38);
    const chz = new THREE.BoxGeometry(1.4, 0.26, 0.26); chz.translate(-22, 29.9, -38);
    trimParts.push(paint(cv, 0x2f3136), paint(chz, 0x2f3136));
  }

  // 街邊矮石牆／庭院牆（諾曼第市鎮質感）
  for (const w of [
    [22, 4, 14, 0], [-22, 2, 12, 0], [-6, -50, 22, 0.06], [24, -46, 16, 0.1], [-34, -8, 14, Math.PI / 2],
  ]) {
    addBox(w[2], 1.5, 0.7, 0x9b917a, w[0], 0.75, w[1], w[3]);
    addBox(w[2], 0.24, 1.0, 0x7d7461, w[0], 1.6, w[1], w[3]);
  }

  // 合併輸出
  const townMeshes = [];
  const facadeTex = {
    cream: makeFacadeTexture('cream'),
    ochre: makeFacadeTexture('ochre'),
    stone: makeFacadeTexture('stone'),
    charred: makeFacadeTexture('charred'),
  };
  for (const kind of Object.keys(facadeParts)) {
    if (!facadeParts[kind].length) continue;
    const mesh = new THREE.Mesh(
      mergeGeometries(facadeParts[kind], false),
      new THREE.MeshLambertMaterial({ map: facadeTex[kind] })
    );
    townMeshes.push(mesh);
  }
  const roofTex = { tile: makeRoofTexture('tile'), slate: makeRoofTexture('slate') };
  for (const kind of Object.keys(roofParts)) {
    if (!roofParts[kind].length) continue;
    const mesh = new THREE.Mesh(
      mergeGeometries(roofParts[kind], false),
      new THREE.MeshLambertMaterial({ map: roofTex[kind] })
    );
    townMeshes.push(mesh);
  }
  if (gableParts.length) townMeshes.push(new THREE.Mesh(mergeGeometries(gableParts, false), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (trimParts.length) townMeshes.push(new THREE.Mesh(mergeGeometries(trimParts, false), vcMat()));
  if (boxes.length) townMeshes.push(new THREE.Mesh(mergeGeometries(boxes, false), vcMat()));
  for (const m of townMeshes) {
    if (shadows) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m);
  }

  // ── 30 高地（鎮西南的低緩隆起；置於德軍進攻走廊「之外」的西側） ──
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(56, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x6b8340 })
  );
  hill.scale.set(1, 0.1, 1);
  hill.position.set(-210, -0.5, 80);
  if (shadows) { hill.castShadow = true; hill.receiveShadow = true; }
  g.add(hill);

  scene.add(g);

  const places = [
    { name: '卡倫坦市鎮 Carentan', side: 'neutral', pos: { x: -2, y: 12, z: -22 } },
    { name: 'Y 形路口（MG42 封街）', side: 'red', pos: { x: 10, y: 9, z: 12 } },
    { name: 'N13 堤道・紫心巷（502 團）', side: 'neutral', pos: { x: 26, y: 6, z: -120 } },
    { name: '杜沃氾濫沼澤', side: 'neutral', pos: { x: -90, y: 5, z: -170 } },
    { name: '鐵路路堤・血腥溝', side: 'blue', pos: { x: -64, y: 6, z: 60 } },
    { name: '30 高地', side: 'red', pos: { x: -205, y: 9, z: 80 } },
  ];

  return {
    group: g,
    places,
    // 草叢隨風輕搖（主迴圈每幀呼叫）
    update: (dt) => { windUniform.value += dt; },
    // 動態解析度降級時砍半草叢
    setDetail: (f) => { if (grassIM) grassIM.count = Math.max(0, Math.floor(grassTotal * f)); },
  };
}
