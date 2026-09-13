// 十字路口地形 — 荷蘭「島區」（de Betuwe）的圩田、下萊茵河河堤、堤路十字路口、
// 渡口磚廠與風車、堤北的萊茵河與德軍踞守的北岸高地。
// 地形邏輯（本役招牌手法）：河堤是主角 —— 南側溝渠可隱蔽接近，登上堤頂瞬間暴露，
//   堤南是一片無遮蔽的開闊圩田（被北岸高地俯瞰），渡河德軍背水而陣。
// 註：河堤高度／尺度刻意放大以利辨識（真實約 6–7 公尺）；圩田開闊度為可讀性優先。
//
// 美術升級（docs/art-upgrade-spec.md §3）：
//   L-1 地表：整片圩田改用程序化 canvas 貼圖（桌機 2048²、手機 1024²）—— 荷蘭圩田的
//        「狹長平行田塊」條紋、田界暗帶與樹籬投影、排水溝亮線、車轍泥濘路面、彈坑暈染。
//        原本四塊硬邊多邊形田野 mesh 一併移除（不得再有塑膠硬邊與單色大平面）。
//   L-2 植被：廢除「球＋棍」。行道樹／柳樹叢改成 2–3 層錯位堆疊冠 ＋ 樹幹，
//        兩個變體各一個 InstancedMesh；桌機另撒交叉 quad 草叢 InstancedMesh。
//   L-3 建築：農舍／磚廠／風車牆面與屋頂改 canvas 貼圖（灰泥、磚砌、瓦片橫線、窗戶暗格）。
//   日出後圩田水溝與河面反光（update(dt, battleT) 由 main.js 每幀呼叫）。
//
// 資產升級（docs/asset-pipeline-spec.md §3）：
//   地表 PBR：圩田／堤坡／堤路／渡船道／北岸高地改 MeshStandardMaterial，Poly Haven 細節貼圖
//        （grass_path_2、leafy_grass、asphalt_02、brown_mud_dry、dirt_floor、aerial_grass_rock）
//        高 repeat 當近景，上面那些程序化 canvas 貼圖**原封不動**保留為 macro 層，用 onBeforeCompile 疊乘。
//   植被：行道樹／北岸樹線／柳叢改 Poly Haven glb 的 InstancedMesh（桌機），遠景剪影仍用程序化低面數樹。
//   建築：農舍、風車、磚廠側屋改 Blender glb（farmhouse_dutch／windmill／barn）＋磚牆瓦頂 PBR。
//   以上全部是「載到才換」：資產沒到、404 或手機低階，畫面維持原本的程序化版本。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeMacroStandardMaterial, ensureUV1, fitToHeight,
  flattenForInstancing, applyMaterialTextures, normalizeMaterial,
} from './assets.js';

// ── 可重現偽隨機（佈局固定） ───────────────────────────────
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// 在幾何上塗上單一頂點色（供 InstancedMesh／合併網格以單一材質呈現多色）
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ── L-1：圩田程序化貼圖 ────────────────────────────────────
// 荷蘭圩田的樣子是「狹長平行田塊」：一條條與堤防垂直（南北向）的地條，
// 中間隔著排水溝。貼圖以「垂直色帶」實現（沿 u 變化、沿 v 不變 → v 方向平鋪無縫），
// 再疊多層雜訊斑、田界暗帶、溝渠亮線、車轍與彈坑。
function makePolderTexture(size) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(1944);

  g.fillStyle = '#7d8f55'; g.fillRect(0, 0, S, S);   // 十月圩田草綠底

  // ① 狹長平行田塊：沿 u 切成寬窄不一的地條，各給一個作物色
  const CROPS = ['#8a9c5c', '#697c45', '#a89b6c', '#95855c', '#7a9052', '#98a662', '#857a52'];
  const edges = [0];
  let x = 0;
  while (x < S) { x += Math.floor(S * (0.07 + r() * 0.09)); edges.push(Math.min(x, S)); }
  edges[edges.length - 1] = S;
  for (let i = 0; i < edges.length - 1; i++) {
    g.fillStyle = CROPS[Math.floor(r() * CROPS.length)];
    g.fillRect(edges[i], 0, edges[i + 1] - edges[i], S);
    // 地條內的犁溝（極淡橫紋，沿 v 方向 → 世界南北向的作物行）
    g.globalAlpha = 0.06;
    g.fillStyle = r() > 0.5 ? '#ffffff' : '#000000';
    const step = 5 + Math.floor(r() * 5);
    for (let px = edges[i]; px < edges[i + 1]; px += step) g.fillRect(px, 0, 1.6, S);
    g.globalAlpha = 1;
  }

  // ② 田界：略深的一圈＋樹籬投影般的暗帶；部分田界是排水溝（暗水線＋亮反光線）
  // 註：田界刻意壓得很淡 —— 太黑會讓整片圩田看起來像線框網格，反而更假。
  for (let i = 1; i < edges.length - 1; i++) {
    const e = edges[i];
    g.fillStyle = 'rgba(44,50,32,0.24)';        // 田界暗線
    g.fillRect(e - 2, 0, 4, S);
    g.fillStyle = 'rgba(40,46,30,0.10)';        // 樹籬投影暗帶（偏東側）
    g.fillRect(e + 2, 0, Math.floor(S * 0.014), S);
    if (i % 2 === 1) {                           // 每隔一條是排水溝
      g.fillStyle = 'rgba(46,60,56,0.36)';       // 溝底暗水
      g.fillRect(e - 3, 0, 6, S);
      g.fillStyle = 'rgba(190,206,198,0.24)';    // 水面亮線（拂曉／日出的反光）
      g.fillRect(e - 1, 0, 2, S);
      g.fillStyle = 'rgba(122,128,84,0.24)';     // 溝岸雜草
      g.fillRect(e - 7, 0, 4, S); g.fillRect(e + 3, 0, 4, S);
    }
  }

  // ③ 低頻明暗斑（沿邊界環繞，消 u 方向接縫）
  const blob = (bx, by, rad, fill) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const gx = bx + dx, gy = by + dy;
      if (gx < -rad || gx > S + rad || gy < -rad || gy > S + rad) continue;
      const grad = g.createRadialGradient(gx, gy, 1, gx, gy, rad);
      grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(gx, gy, rad, 0, Math.PI * 2); g.fill();
    }
  };
  for (let i = 0; i < 110; i++) blob(r() * S, r() * S, S * (0.03 + r() * 0.07), `rgba(38,48,26,${0.06 + r() * 0.12})`);
  for (let i = 0; i < 70; i++) blob(r() * S, r() * S, S * (0.02 + r() * 0.05), `rgba(126,132,86,${0.05 + r() * 0.10})`);
  for (let i = 0; i < 34; i++) blob(r() * S, r() * S, S * (0.015 + r() * 0.035), `rgba(96,80,52,${0.08 + r() * 0.14})`); // 翻出的濕黑泥

  // ④ 踩踏痕／牛道：幾條淡土色的蜿蜒細徑（沿 u 方向 → 世界東西向）
  g.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const y0 = r() * S;
    g.strokeStyle = `rgba(120,108,76,${0.16 + r() * 0.14})`;
    g.lineWidth = 3 + r() * 5;
    g.beginPath(); g.moveTo(0, y0);
    for (let px = 0; px <= S; px += S / 12) g.lineTo(px, y0 + Math.sin(px / S * 6 + k) * S * 0.02);
    g.stroke();
  }

  // ⑤ 彈坑暈染：深色圓斑＋淺色濺邊（環繞版）
  for (let i = 0; i < 26; i++) {
    const bx = r() * S, by = r() * S, rad = S * (0.006 + r() * 0.012);
    blob(bx, by, rad * 1.9, `rgba(122,116,88,0.36)`);
    blob(bx, by, rad, `rgba(38,34,26,${0.5 + r() * 0.25})`);
  }

  // ⑥ 微顆粒
  g.globalAlpha = 0.05;
  for (let i = 0; i < S * 2; i++) { g.fillStyle = r() > 0.5 ? '#c9d0a8' : '#2a3220'; g.fillRect(r() * S, r() * S, 2, 2); }
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// 堤面草坡貼圖（比圩田亮、細密的草，帶被踩出的斜坡小徑）
function makeDikeGrassTexture(size) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(55);
  g.fillStyle = '#7b8e4e'; g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.10;
  for (let i = 0; i < S * 5; i++) {
    g.fillStyle = r() > 0.5 ? '#7d8c52' : '#414d2a';
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 2 + r() * 4);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 26; i++) {            // 枯黃斑（十月）
    const x = r() * S, y = r() * S, rad = S * (0.03 + r() * 0.06);
    const grad = g.createRadialGradient(x, y, 1, x, y, rad);
    grad.addColorStop(0, `rgba(140,132,74,${0.14 + r() * 0.12})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 2);
  t.anisotropy = 8;
  return t;
}

// 濕瀝青堤路貼圖（兩道車轍暗線＋路肩漸層＋碎裂顆粒）
function makeRoadTexture(size, muddy) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(muddy ? 71 : 72);
  g.fillStyle = muddy ? '#6a5c40' : '#4f4d47'; g.fillRect(0, 0, S, S);
  // 路肩漸層（u 兩側較暗、混入泥土）
  const side = g.createLinearGradient(0, 0, S, 0);
  side.addColorStop(0, 'rgba(60,54,36,0.85)');
  side.addColorStop(0.18, 'rgba(60,54,36,0)');
  side.addColorStop(0.82, 'rgba(60,54,36,0)');
  side.addColorStop(1, 'rgba(60,54,36,0.85)');
  g.fillStyle = side; g.fillRect(0, 0, S, S);
  // 兩道車轍
  for (const u of [0.32, 0.68]) {
    g.fillStyle = muddy ? 'rgba(42,34,22,0.55)' : 'rgba(28,28,26,0.45)';
    g.fillRect(u * S - S * 0.045, 0, S * 0.09, S);
    g.fillStyle = muddy ? 'rgba(126,112,80,0.28)' : 'rgba(120,120,116,0.16)';
    g.fillRect(u * S - S * 0.05, 0, S * 0.012, S);
  }
  // 碎石／裂紋顆粒
  g.globalAlpha = 0.16;
  for (let i = 0; i < S * 6; i++) {
    g.fillStyle = r() > 0.5 ? '#8b8781' : '#2b2924';
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalAlpha = 1;
  if (muddy) {   // 泥濘：積水亮斑
    for (let i = 0; i < 22; i++) {
      const x = r() * S, y = r() * S, rad = S * (0.01 + r() * 0.03);
      const grad = g.createRadialGradient(x, y, 1, x, y, rad);
      grad.addColorStop(0, `rgba(150,158,146,${0.22 + r() * 0.18})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// 河面貼圖（冷灰下萊茵河：橫向波紋帶＋稀疏亮紋）
function makeRiverTexture(size) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(313);
  g.fillStyle = '#31404a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const y = r() * S, w = S * (0.05 + r() * 0.35), x = r() * S;
    g.fillStyle = r() > 0.55 ? `rgba(126,148,158,${0.05 + r() * 0.10})` : `rgba(20,30,38,${0.06 + r() * 0.12})`;
    g.fillRect(x, y, w, 1 + r() * 2);
    if (x + w > S) g.fillRect(x - S, y, w, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 2);
  t.anisotropy = 8;
  return t;
}

// ── L-3：建築貼圖 ─────────────────────────────────────────
function makeWallTexture(size, kind) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(kind === 'brick' ? 91 : 92);
  if (kind === 'brick') {
    g.fillStyle = '#7a4636'; g.fillRect(0, 0, S, S);
    const bh = S / 22;
    for (let row = 0; row < 22; row++) {
      const off = (row % 2) * (S / 22);
      for (let col = -1; col < 12; col++) {
        g.fillStyle = `rgb(${106 + r() * 34 | 0},${58 + r() * 22 | 0},${44 + r() * 18 | 0})`;
        g.fillRect(col * (S / 11) + off + 2, row * bh + 2, S / 11 - 4, bh - 4);
      }
    }
  } else {
    g.fillStyle = '#a89c82'; g.fillRect(0, 0, S, S);   // 荷蘭灰泥牆
    g.globalAlpha = 0.12;
    for (let i = 0; i < S * 4; i++) {
      g.fillStyle = r() > 0.5 ? '#c6bda6' : '#7d7563';
      g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 10; i++) {   // 牆腳雨漬
      const x = r() * S, rad = S * (0.06 + r() * 0.1);
      const grad = g.createRadialGradient(x, S, 1, x, S, rad);
      grad.addColorStop(0, 'rgba(72,68,56,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
    }
  }
  // 窗戶暗格（兩排）
  for (const wy of [0.24, 0.62]) {
    for (const wx of [0.18, 0.5, 0.82]) {
      g.fillStyle = '#20241f';
      g.fillRect((wx - 0.075) * S, (wy - 0.09) * S, 0.15 * S, 0.18 * S);
      g.strokeStyle = '#cfc7b2'; g.lineWidth = Math.max(2, S / 128);
      g.strokeRect((wx - 0.075) * S, (wy - 0.09) * S, 0.15 * S, 0.18 * S);
      g.beginPath();                                   // 窗櫺十字
      g.moveTo(wx * S, (wy - 0.09) * S); g.lineTo(wx * S, (wy + 0.09) * S);
      g.moveTo((wx - 0.075) * S, wy * S); g.lineTo((wx + 0.075) * S, wy * S);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeRoofTexture(size) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(93);
  g.fillStyle = '#5b4335'; g.fillRect(0, 0, S, S);
  const rows = 18;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 14; col++) {
      g.fillStyle = `rgb(${86 + r() * 36 | 0},${56 + r() * 22 | 0},${44 + r() * 18 | 0})`;
      g.fillRect(col * (S / 14) + 1, row * (S / rows) + 1, S / 14 - 2, S / rows - 3);
    }
    g.fillStyle = 'rgba(30,22,18,0.45)';               // 瓦片橫線陰影
    g.fillRect(0, (row + 1) * (S / rows) - 3, S, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 草叢 alpha 貼圖（交叉雙面 quad 用）
function makeGrassBladeTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(404);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) {
    const x = 4 + r() * (S - 8);
    const h = S * (0.45 + r() * 0.5);
    g.strokeStyle = `rgba(${96 + r() * 50 | 0},${112 + r() * 44 | 0},${58 + r() * 26 | 0},0.95)`;
    g.lineWidth = 1.4 + r() * 1.8;
    g.beginPath(); g.moveTo(x, S);
    g.quadraticCurveTo(x + (r() - 0.5) * 14, S - h * 0.55, x + (r() - 0.5) * 22, S - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 顏色貼圖必須標 sRGB，否則整張貼圖會亮上數倍、糊成一片
  return t;
}

// ── L-2：層疊冠樹木幾何（合併成帶頂點色的單一 geometry，供 InstancedMesh） ──
// variant 0 = 堤／田界的行道樹（較高、冠瘦）；variant 1 = 圩田柳樹叢（矮、冠寬、偏黃綠）
function makeTreeGeometry(variant, seed) {
  const r = mulberry(seed);
  const tall = variant === 0;
  const trunkH = tall ? 3.2 : 1.6;
  const parts = [];
  // 註：IcosahedronGeometry 是非索引幾何，圓柱是索引幾何 —— mergeGeometries 不接受混用，
  //     所以樹幹／分枝一律先 toNonIndexed()。
  const trunk = new THREE.CylinderGeometry(tall ? 0.24 : 0.34, tall ? 0.42 : 0.62, trunkH, 6).toNonIndexed();
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, tall ? 0x4a3c2a : 0x53452e));
  if (!tall) {   // 柳樹的斜生分枝
    for (let k = 0; k < 3; k++) {
      const br = new THREE.CylinderGeometry(0.14, 0.22, 1.8, 5).toNonIndexed();
      br.translate(0, 0.9, 0);
      br.rotateZ((k - 1) * 0.5);
      br.translate(0, trunkH - 0.2, 0);
      parts.push(paint(br, 0x53452e));
    }
  }
  // 2–3 層錯位堆疊的扁球（低面數 icosahedron，頂點微抖動）
  const tiers = tall
    ? [[2.5, trunkH + 1.0, 0.78], [2.0, trunkH + 2.5, 0.72], [1.35, trunkH + 3.7, 0.66]]
    : [[2.9, trunkH + 0.7, 0.52], [2.2, trunkH + 1.7, 0.50]];
  tiers.forEach(([rad, y, flat], i) => {
    const geo = new THREE.IcosahedronGeometry(rad, 1);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      pos.setXYZ(k,
        pos.getX(k) * (1 + (r() - 0.5) * 0.34),
        pos.getY(k) * flat * (1 + (r() - 0.5) * 0.26),
        pos.getZ(k) * (1 + (r() - 0.5) * 0.34));
    }
    geo.computeVertexNormals();
    geo.translate((r() - 0.5) * 0.9, y, (r() - 0.5) * 0.9);
    // 上冠亮、下冠深（柳樹偏黃綠）
    const up = i === tiers.length - 1;
    const col = tall ? (up ? 0x5c7a3c : 0x38512a) : (up ? 0x74874a : 0x475a2f);
    parts.push(paint(geo, col));
  });
  return mergeGeometries(parts, false);
}

// R5 畫質分級：草叢數量、hero／mid 植被的 glb 換裝與抽稀、建築是否吃烘焙版，
// 全部由 quality.js 的參數表決定（貼圖尺寸仍依 mobile，那是頻寬不是算力）。
const DEFAULT_Q = {
  grassFactor: 1,
  vegetation: { glb: true, heroHi: true, midFactor: 1, willowFactor: 1 },
  baked: true,
};

export function createCrossroadsTerrain(scene, { shadows = false, mobile = false, quality = null } = {}) {
  const Q = { ...DEFAULT_Q, ...(quality ?? {}) };
  const VEG = { ...DEFAULT_Q.vegetation, ...(Q.vegetation ?? {}) };
  const g = new THREE.Group();
  const TEX = mobile ? 1024 : 2048;
  const rng = mulberry(777);

  // ── 材質 ────────────────────────────────────────────────
  const polderTex = makePolderTexture(TEX);
  polderTex.repeat.set(13, 8);
  const polderMat = new THREE.MeshLambertMaterial({ map: polderTex });

  const dikeGrassMat = new THREE.MeshLambertMaterial({ color: 0xe6ecd8, map: makeDikeGrassTexture(mobile ? 512 : 1024) });
  const asphaltTex = makeRoadTexture(mobile ? 512 : 1024, false); asphaltTex.repeat.set(1, 46);
  const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex });
  const mudTex = makeRoadTexture(mobile ? 512 : 1024, true); mudTex.repeat.set(1, 9);
  const mudMat = new THREE.MeshLambertMaterial({ map: mudTex });

  const dikeEarth = new THREE.MeshLambertMaterial({ color: 0x8a7750 });  // 堤腳土帶
  const ditchMat = new THREE.MeshLambertMaterial({ color: 0x5a6448 });   // 排水溝土坎（掩蔽接近）
  const ditchWaterMat = new THREE.MeshLambertMaterial({ color: 0x93a59c });
  const riverMat = new THREE.MeshLambertMaterial({ color: 0x9fb0ba, map: makeRiverTexture(mobile ? 512 : 1024), transparent: true, opacity: 0.95 });
  const bankMat = new THREE.MeshLambertMaterial({ color: 0x596545 });    // 北岸德軍高地
  const plasterMat = new THREE.MeshLambertMaterial({ map: makeWallTexture(mobile ? 256 : 512, 'plaster') });
  const brickMat = new THREE.MeshLambertMaterial({ map: makeWallTexture(mobile ? 256 : 512, 'brick') });
  const brickDark = new THREE.MeshLambertMaterial({ color: 0x8a6250, map: brickMat.map });
  const roofMat = new THREE.MeshLambertMaterial({ map: makeRoofTexture(mobile ? 256 : 512) });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xa89c82 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6a5436 });
  const wireMat = new THREE.MeshLambertMaterial({ color: 0x2a2a26 });

  function box(w, h, d, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    if (shadows) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m); return m;
  }

  // ── L-1：圩田大地表（單一平面＋程序化貼圖，取代原本四塊硬邊田野） ──
  // 平面刻意做得比 fogFar 還大：邊緣落在霧外看不見，才不會在畫面上切出一條硬邊。
  const polder = new THREE.Mesh(ensureUV1(new THREE.PlaneGeometry(2600, 1600)), polderMat);
  polder.rotation.x = -Math.PI / 2;
  polder.position.set(0, 0.04, 200);
  if (shadows) polder.receiveShadow = true;
  g.add(polder);

  // ── 下萊茵河（堤北）＋北岸德軍高地 ───────────────────────
  const river = new THREE.Mesh(new THREE.PlaneGeometry(2600, 150), riverMat);
  river.rotation.x = -Math.PI / 2; river.position.set(0, 0.06, -92); g.add(river);
  // 北岸高地（德軍火砲俯瞰島區的高地）：做成分階斜坡而非一塊方盒，
  // 否則盒子的近緣會在畫面上切出一條刺眼的水平硬線。
  const bankSteps = [
    { h: 1.2, z: -132, d: 26 },
    { h: 2.6, z: -158, d: 30 },
    { h: 4.2, z: -196, d: 52 },
    { h: 5.4, z: -250, d: 70 },
  ];
  for (const st of bankSteps) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2600, st.h, st.d), bankMat);
    m.position.set(0, st.h / 2, st.z);
    if (shadows) m.receiveShadow = true;
    g.add(m);
  }

  // ── 河堤（本役主角：梯形斷面、堤頂有路、南北有坡） ──────────
  // 以梯形斷面沿 X 擠出；rotation.y 把擠出軸轉到世界 X（沿河東西向）。
  const DIKE_LEN = 460, DIKE_Z = -16, DIKE_H = 4.4;
  const sec = new THREE.Shape();
  sec.moveTo(-5.2, 0); sec.lineTo(5.2, 0); sec.lineTo(2.2, DIKE_H); sec.lineTo(-2.2, DIKE_H); sec.closePath();
  const dikeGeo = new THREE.ExtrudeGeometry(sec, { depth: DIKE_LEN, bevelEnabled: false });
  // ExtrudeGeometry 的預設 UV 產生器直接拿頂點座標當 uv（側面 u 會到 460），細節貼圖照那個 uv 貼
  // 會被平鋪到糊成一片。改成沿「擠出方向 × 斷面周長方向」的平面投影，單位 = DIKE_UV_TILE 個場景單位。
  const DIKE_UV_TILE = 3.5;
  (function reuvDike() {
    const pos = dikeGeo.attributes.position;
    const uv = dikeGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getZ(i) / DIKE_UV_TILE, (pos.getX(i) + pos.getY(i) * 0.7) / DIKE_UV_TILE);
    }
    uv.needsUpdate = true;
    ensureUV1(dikeGeo);
  })();
  // macro（既有的堤草 canvas）：⚠️ 兩軸必須等比，否則貼圖裡的草點會被拉成「沿堤方向的長條紋」——
  // 原本的 repeat(26, 2) 配上 ExtrudeGeometry 的原始 uv 是 2.5:1 的拉伸，實機看就是一條條豎紋。
  // 這裡改成「一格 macro ≈ 12 個場景單位」的等比平鋪。
  const DIKE_MACRO_TILE = 12;
  const DIKE_MACRO_REPEAT = [DIKE_UV_TILE / DIKE_MACRO_TILE, DIKE_UV_TILE / DIKE_MACRO_TILE];
  dikeGrassMat.map.repeat.set(DIKE_MACRO_REPEAT[0], DIKE_MACRO_REPEAT[1]);   // fallback 也要跟著新 uv 走
  const dike = new THREE.Mesh(dikeGeo, dikeGrassMat);
  dike.rotation.y = -Math.PI / 2;
  dike.position.set(DIKE_LEN / 2, 0, DIKE_Z); // 擠出軸映射到 -X，置中後沿 X 展開
  if (shadows) { dike.castShadow = true; dike.receiveShadow = true; }
  g.add(dike);
  // 堤腳土帶（南北各一條，界定堤體基線、增加立體感）
  box(DIKE_LEN, 0.7, 1.6, dikeEarth, 0, 0.34, DIKE_Z + 4.6);
  box(DIKE_LEN, 0.7, 1.6, dikeEarth, 0, 0.34, DIKE_Z - 4.6);
  // 堤頂瀝青路
  const topRoad = new THREE.Mesh(new THREE.BoxGeometry(DIKE_LEN, 0.26, 3.8), roadMat);
  topRoad.position.set(0, DIKE_H + 0.12, DIKE_Z);
  if (shadows) topRoad.receiveShadow = true;
  g.add(topRoad);
  // 堤北腳的排水溝（溫特斯的掩蔽接近路線）＋溝底水面
  box(DIKE_LEN, 0.5, 1.7, ditchMat, 0, 0.18, DIKE_Z - 6.0);
  const dikeDitchWater = new THREE.Mesh(new THREE.PlaneGeometry(DIKE_LEN, 1.1), ditchWaterMat);
  dikeDitchWater.rotation.x = -Math.PI / 2;
  dikeDitchWater.position.set(0, 0.3, DIKE_Z - 6.0);
  g.add(dikeDitchWater);

  // ── 渡船道（南北向，跨越河堤的十字路口） ───────────────────
  const ferrySouth = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 84), mudMat);
  ferrySouth.position.set(0, 0.16, 28);
  if (shadows) ferrySouth.receiveShadow = true;
  g.add(ferrySouth);
  box(4, 0.2, 12, mudMat, 0, 0.16, DIKE_Z - 8);            // 堤北段（通往渡口）
  box(7.5, 0.3, 5.5, roadMat, 0, DIKE_H + 0.14, DIKE_Z);   // 堤頂十字路口路面

  // ── 渡口與磚廠（德軍夜渡的登陸點，堤北近河） ────────────────
  box(3.2, 0.4, 14, woodMat, 0, 0.22, -30);    // 渡口棧橋
  box(16, 6, 9, brickMat, 16, 3, -34);         // 磚廠主廠房
  const brickAnnex = box(20, 4.5, 7, brickDark, 16, 2.25, -42, 0.2);   // 側屋（之後換 barn.glb）
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 16, 12), brickDark);
  chimney.position.set(8, 8, -38);
  if (shadows) chimney.castShadow = true;
  g.add(chimney);

  // ── 風車（堤北近河的地標；德軍次波連據此） ─────────────────
  const WINDMILL_POS = [40, -28];
  const windmillGroup = (function windmill(x, z) {
    const wg = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 11, 12), stoneMat);
    tower.position.set(x, 5.5, z);
    if (shadows) tower.castShadow = true;
    wg.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3.2, 12), roofMat);
    cap.position.set(x, 12.4, z);
    if (shadows) cap.castShadow = true;
    wg.add(cap);
    const hub = new THREE.Group(); hub.position.set(x, 11, z + 2.8);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 10, 0.25), woodMat);
      blade.position.y = 5;
      if (shadows) blade.castShadow = true;
      arm.add(blade);
      hub.add(arm);
    }
    wg.add(hub);
    g.add(wg);
    return wg;
  })(WINDMILL_POS[0], WINDMILL_POS[1]);

  // ── 前哨建物（巡邏隊奉命佔領的堤邊房舍） ───────────────────
  const farmhouses = [];
  function farmhouse(x, z, w, d, h, rot = 0) {
    const fg = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plasterMat);
    wall.position.set(x, h / 2, z); wall.rotation.y = rot;
    if (shadows) { wall.castShadow = true; wall.receiveShadow = true; }
    fg.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.5, h * 0.7, 4), roofMat);
    roof.position.set(x, h + h * 0.34, z); roof.rotation.y = rot + Math.PI / 4;
    if (shadows) roof.castShadow = true;
    fg.add(roof);
    // 煙囪
    const ch = new THREE.Mesh(new THREE.BoxGeometry(w * 0.14, h * 0.5, w * 0.14), brickDark);
    ch.position.set(x + Math.cos(rot) * w * 0.22, h * 1.2, z + Math.sin(rot) * w * 0.22);
    if (shadows) ch.castShadow = true;
    fg.add(ch);
    g.add(fg);
    farmhouses.push({ group: fg, x, z, w, d, h, rot });
  }
  farmhouse(30, -9, 7, 6, 4, 0.2);     // 堤南前哨房舍
  farmhouse(-92, 32, 9, 7, 5, 0.3);    // 蘭德韋克方向農舍
  farmhouse(-72, 52, 7, 6, 4.2, -0.2);

  // ── 圩田排水溝（縱橫切割開闊地：地形邏輯的細節）＋溝底水面 ───
  const ditchWaters = [];
  function ditch(w, d, x, z) {
    box(w, 0.4, d, ditchMat, x, 0.16, z);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, d * 0.985), ditchWaterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 0.3, z);
    g.add(water);
    ditchWaters.push({ x, z });
  }
  for (const x of [-46, -14, 22, 58]) ditch(1.3, 76, x, 24);
  for (const z of [6, 40]) {
    box(180, 0.4, 1.3, ditchMat, 6, 0.16, z);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(178, 0.8), ditchWaterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(6, 0.3, z); g.add(water);
    ditchWaters.push({ x: -40, z }, { x: 60, z });
  }

  // ── 低矮鐵絲網（堤前障礙：皮考克左翼即受阻於此） ───────────
  for (let x = -16; x <= 30; x += 6) box(0.18, 1.0, 0.18, wireMat, x, 0.5, -4);
  for (let yk = 0; yk < 2; yk++) {
    const wire = new THREE.Mesh(new THREE.BoxGeometry(48, 0.05, 0.05), wireMat);
    wire.position.set(7, 0.4 + yk * 0.4, -4); g.add(wire);
  }

  // ── L-2：植被（層疊冠 InstancedMesh：行道樹＋柳樹叢） ────────
  // 佈局原則：衝鋒走廊（|x| < 80、-60 < z < 60）保持開闊 —— 這場的地形邏輯就是「無遮蔽」。
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const treeGeos = [makeTreeGeometry(0, 21), makeTreeGeometry(1, 22)];
  const placements = [[], []];
  const dummy = new THREE.Object3D();
  const pushTree = (v, x, z, sMin, sMax) => {
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(sMin + rng() * (sMax - sMin));
    dummy.updateMatrix();
    placements[v].push(dummy.matrix.clone());
  };
  // ⚠️ 擺放順序有意義：每個變體的矩陣陣列是「純程序化的遠景」在前、「之後可換成 glb 的近景」在後。
  //    glb 到位時只要把 InstancedMesh.count 砍回 proceduralBase，尾段就整段消失、不必重建矩陣。
  // ⑤ 南面遠景樹帶（讓圩田盡頭不是直接接天）＋ ① 的更遠一排地平線剪影 → 永遠程序化（在霧裡，換 glb 不划算）
  for (let i = 0; i < (mobile ? 18 : 34); i++) pushTree(0, -640 + rng() * 1280, -300 - rng() * 180, 1.1, 1.8);
  for (let i = 0; i < (mobile ? 24 : 44); i++) pushTree(0, -560 + rng() * 1120, 190 + rng() * 120, 0.9, 1.4);
  // 河岸蘆葦叢（南北兩岸水際；用矮冠變體縮小當蘆葦）→ 永遠程序化
  for (let i = 0; i < (mobile ? 14 : 30); i++) pushTree(1, -420 + rng() * 840, -24 - rng() * 6, 0.30, 0.55);
  for (let i = 0; i < (mobile ? 12 : 26); i++) pushTree(1, -420 + rng() * 840, -126 - rng() * 8, 0.30, 0.55);
  const proceduralBase = [placements[0].length, placements[1].length];

  // ── 以下是「近景」段，桌機會被 Poly Haven glb 取代 ──
  // ① 北岸樹線（河對岸德軍高地前緣）
  const bankTreeFrom = placements[0].length;
  for (let i = 0; i < 22; i++) pushTree(0, -420 + i * 39 + (rng() - 0.5) * 10, -160 + (rng() - 0.5) * 16, 1.0, 1.5);
  const bankTreeTo = placements[0].length;
  // ② 堤防沿線行道樹：只長在戰場兩翼的堤段（|x| > 95），中央十字路口保持淨空
  for (let i = 0; i < 20; i++) {
    const east = i % 2 === 0;
    const x = east ? 100 + rng() * 120 : -100 - rng() * 120;
    pushTree(0, x, DIKE_Z + (rng() > 0.5 ? 7.5 : -7.5), 0.85, 1.25);
  }
  // ④ 農舍旁的高樹
  for (const [hx, hz] of [[-92, 32], [-72, 52], [30, -9]]) {
    for (let k = 0; k < 2; k++) pushTree(0, hx + (rng() - 0.5) * 16, hz + 8 + rng() * 8, 0.8, 1.15);
  }
  const roadTreeTo = placements[0].length;
  // ③ 圩田田界／溝渠邊的柳樹叢（南面縱深與兩翼，不擋衝鋒開闊地）
  const willowSpots = [
    [-150, 30], [-120, 62], [-100, 24], [-80, 44], [-60, 74], [-46, 96],
    [120, 30], [96, 62], [150, 24], [64, 88], [20, 92], [-20, 88],
    [-180, 70], [176, 68], [-140, 100], [140, 100],
  ];
  for (const [wx, wz] of willowSpots) {
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) pushTree(1, wx + (rng() - 0.5) * 14, wz + (rng() - 0.5) * 14, 0.85, 1.35);
  }

  const treeMeshes = [];
  for (let v = 0; v < 2; v++) {
    const im = new THREE.InstancedMesh(treeGeos[v], treeMat, placements[v].length);
    for (let i = 0; i < placements[v].length; i++) im.setMatrixAt(i, placements[v][i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    g.add(im); treeMeshes.push(im);
  }
  // glb 版植被的擺放來源（矩陣本身是「程序化樹」的尺度，換 glb 時再依 bbox 換算）
  const glbSlots = {
    bankTree: placements[0].slice(bankTreeFrom, bankTreeTo),   // 北岸樹線
    roadTree: placements[0].slice(bankTreeTo, roadTreeTo),     // 堤防行道樹＋農舍旁高樹
    willow: placements[1].slice(proceduralBase[1]),            // 圩田柳叢
  };

  // ── L-2：草叢（桌機限定；核心區交叉雙面 quad，隨風輕擺） ──────
  let grassMesh = null;
  const GRASS_BASE = Math.round(2400 * (Q.grassFactor ?? 1));
  if (GRASS_BASE > 0) {
    const blade = new THREE.PlaneGeometry(2.6, 1.7);
    blade.translate(0, 0.85, 0);
    const blade2 = blade.clone(); blade2.rotateY(Math.PI / 2);
    const clump = mergeGeometries([blade, blade2], false);
    const grassMat = new THREE.MeshLambertMaterial({
      map: makeGrassBladeTexture(), transparent: true, alphaTest: 0.42,
      side: THREE.DoubleSide, depthWrite: true, color: 0xa8b880,
    });
    grassMesh = new THREE.InstancedMesh(clump, grassMat, GRASS_BASE);
    const gr = mulberry(606);
    for (let i = 0; i < GRASS_BASE; i++) {
      // 撒在核心區，但避開堤體本身與堤頂路（免得草叢長在瀝青上）
      const x = -190 + gr() * 380;
      let z = -70 + gr() * 200;
      if (Math.abs(z - DIKE_Z) < 7) z += (z > DIKE_Z ? 9 : -9);
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, gr() * Math.PI, 0);
      dummy.scale.set(0.7 + gr() * 0.8, 0.6 + gr() * 0.9, 0.7 + gr() * 0.8);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.frustumCulled = false;
    g.add(grassMesh);
  }

  // ── 日出後的水面反光（圩田水溝＋河面；拂曉不亮、天亮才浮現） ──
  const glintTex = makeGlintTexture();
  const glints = [];
  const gr2 = mulberry(808);
  for (const d of ditchWaters) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glintTex, color: 0xdfe8dc, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(d.x + (gr2() - 0.5) * 12, 0.6, d.z + (gr2() - 0.5) * 30);
    const w = 10 + gr2() * 16;
    s.scale.set(w, w * 0.16, 1);
    s.userData.base = 0.10 + gr2() * 0.08;
    g.add(s); glints.push(s);
  }
  // 河面的一條光路（刻意壓得很淡且散開：Additive sprite 疊在一起會整條爆白成一道假硬帶）
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glintTex, color: 0xf2e6cc, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(-150 + i * 52 + gr2() * 20, 0.9, -50 - gr2() * 100);
    const w = 26 + gr2() * 26;
    s.scale.set(w, w * 0.10, 1);
    s.userData.base = 0.08 + gr2() * 0.09;
    g.add(s); glints.push(s);
  }

  scene.add(g);

  // 日出程度：與 environment.js 的 phaseAt 同節奏（285 起亮、380 全亮）
  function daylight(t) {
    if (t <= 300) return 0;
    if (t >= 380) return 1;
    return (t - 300) / 80;
  }

  let tAcc = 0;
  function update(dt, battleT) {
    tAcc += dt;
    const d = daylight(battleT);
    for (const s of glints) {
      // 水面反光：日出後浮現，並以低頻閃爍模擬水波
      s.material.opacity = s.userData.base * d * (0.62 + 0.38 * Math.sin(tAcc * 1.7 + s.position.x * 0.15));
    }
    if (grassMesh) grassMesh.rotation.z = Math.sin(tAcc * 0.9) * 0.012;   // 隨風輕擺
    if (windmillSails) windmillSails.pivot.rotation[windmillSails.axis] -= dt * 0.16;   // 風車慢轉
  }

  // P-4 降級時砍半草叢
  function setDetail(f) {
    if (grassMesh) grassMesh.count = Math.max(0, Math.floor(GRASS_BASE * f));
  }

  // ══ 真實資產升級（asset-pipeline-spec §3）══════════════════
  // 全部「載到才換」；任何一項沒到就維持上面那套程序化版本。
  const disposables = [];
  function swapMaterial(oldMat, newMat) {
    if (!oldMat || !newMat) return;
    let used = false;
    g.traverse((m) => {
      if (!m.isMesh && !m.isInstancedMesh) return;
      if (Array.isArray(m.material)) {
        m.material = m.material.map((x) => (x === oldMat ? (used = true, newMat) : x));
      } else if (m.material === oldMat) { m.material = newMat; used = true; }
    });
    if (used) disposables.push(oldMat);
  }

  // 程序化樹的高度基準（glb 依 bbox 換算縮放時要對齊的目標）
  const PROC_H = [7.8, 4.4];
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

  // 用既有的程序化擺放矩陣蓋一棵 glb 樹的 InstancedMesh 群（glb 可能多材質 → 每個材質一個）
  function instanceGlb(root, slots, procHeight, { cast = true } = {}) {
    const { scale: fit } = fitToHeight(root, procHeight);
    const parts = flattenForInstancing(root);
    const made = [];
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, normalizeMaterial(part.material), slots.length);
      for (let i = 0; i < slots.length; i++) {
        slots[i].decompose(_p, _q, _s);
        const m = new THREE.Matrix4().compose(_p, _q, _s.clone().multiplyScalar(fit));
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
      if (shadows) { im.castShadow = cast; im.receiveShadow = true; }
      g.add(im); made.push(im);
    }
    return made;
  }

  const glbMeshes = [];
  let windmillSails = null;   // { pivot, axis }：glb 風車的車翼，update() 讓它慢慢轉
  /**
   * @param assets createAssetLoader 的實例
   * @param {{register?:(o:THREE.Object3D)=>void}} [opts]
   *        register：R6 CSM 材質註冊——換上來的 glb 跟新材質一定要註冊，
   *        否則會被三盞 cascade 燈各照一次、亮度變三倍。
   */
  async function applyAssets(assets, { register = null } = {}) {
    if (!assets) return { textures: false, vegetation: false, buildings: [] };
    const report = { textures: false, vegetation: false, buildings: [], missing: [], baked: [] };

    // ── 1. 地表 PBR ─────────────────────────────────────
    const [grassSet, dikeSet, asphaltSet, mudSet, dirtSet, bankSet, brickSet, plasterSet, roofSet] =
      await Promise.all([
        assets.textureSet('grass_path_2', { maps: ['diff', 'nor', 'arm'], repeat: [420, 260], px: 1024 }),
        assets.textureSet('leafy_grass', { maps: ['diff', 'nor'], repeat: [1.5, 1.5], px: 1024 }),
        assets.textureSet('asphalt_02', { maps: ['diff', 'nor', 'arm'], repeat: [60, 2], px: 512 }),
        assets.textureSet('brown_mud_dry', { maps: ['diff', 'arm'], repeat: [2, 28], px: 512 }),
        assets.textureSet('dirt_floor', { maps: ['diff', 'nor'], repeat: [12, 12], px: 512 }),
        assets.textureSet('aerial_grass_rock', { maps: ['diff'], repeat: [160, 4], px: 512 }),
        assets.textureSet('red_brick_03', { maps: ['diff', 'nor'], repeat: [3, 2], px: 512 }),
        assets.textureSet('painted_plaster_wall', { maps: ['diff', 'nor'], repeat: [2, 2], px: 512 }),
        assets.textureSet('roof_09', { maps: ['diff', 'nor'], repeat: [3, 2], px: 512 }),
      ]);

    if (grassSet) {
      swapMaterial(polderMat, makeMacroStandardMaterial({
        macroMap: polderTex, macroRepeat: [13, 8], set: grassSet, detailMix: 0.62, roughness: 0.95,
      }));
      report.textures = true;
    }
    if (dikeSet) {
      swapMaterial(dikeGrassMat, makeMacroStandardMaterial({
        macroMap: dikeGrassMat.map, macroRepeat: DIKE_MACRO_REPEAT, set: dikeSet,
        detailMix: 0.6, color: 0xe6ecd8, roughness: 0.95,
      }));
    }
    if (asphaltSet) {
      swapMaterial(roadMat, makeMacroStandardMaterial({
        macroMap: asphaltTex, macroRepeat: [1, 46], set: asphaltSet, detailMix: 0.5, roughness: 0.82,
      }));
    }
    if (mudSet) {
      swapMaterial(mudMat, makeMacroStandardMaterial({
        macroMap: mudTex, macroRepeat: [1, 9], set: mudSet, detailMix: 0.55, roughness: 0.9,
      }));
    }
    if (dirtSet) {
      // 堤腳土帶：翻出來的濕土，tint 壓到偏灰 —— 純泥土貼圖直接用會亮成一條土黃色塑膠帶。
      swapMaterial(dikeEarth, new THREE.MeshStandardMaterial({
        color: 0x8d8570, map: dirtSet.map, normalMap: dirtSet.normalMap ?? null, roughness: 0.96,
      }));
      // 圩田溝坎：這些是 1.3 單位寬、76 單位長的細條，貼圖一定會被拉爛 ——
      // 所以只做材質升級、不貼泥土圖，維持原本那種「草掩的土坎」的低調感（實測貼了會變一格格褐色木板）。
      swapMaterial(ditchMat, new THREE.MeshStandardMaterial({ color: 0x4c553e, roughness: 0.98 }));
    }
    if (bankSet) {
      swapMaterial(bankMat, new THREE.MeshStandardMaterial({
        color: 0x93a07e, map: bankSet.map, roughness: 0.95,
      }));
    }
    // 建築：磚牆／灰泥牆／瓦頂（既有 canvas 貼圖含窗格與瓦線，留作 macro）
    if (brickSet) {
      swapMaterial(brickMat, makeMacroStandardMaterial({
        macroMap: brickMat.map, macroRepeat: [1, 1], set: brickSet, detailMix: 0.6, roughness: 0.88,
      }));
      swapMaterial(brickDark, makeMacroStandardMaterial({
        macroMap: brickDark.map, macroRepeat: [1, 1], set: brickSet, detailMix: 0.6,
        color: 0x8a6250, roughness: 0.9,
      }));
    }
    if (plasterSet) {
      swapMaterial(plasterMat, makeMacroStandardMaterial({
        macroMap: plasterMat.map, macroRepeat: [1, 1], set: plasterSet, detailMix: 0.5, roughness: 0.9,
      }));
      swapMaterial(stoneMat, new THREE.MeshStandardMaterial({
        color: 0xbdb49a, map: plasterSet.map, normalMap: plasterSet.normalMap ?? null, roughness: 0.9,
      }));
    }
    if (roofSet) {
      swapMaterial(roofMat, makeMacroStandardMaterial({
        macroMap: roofMat.map, macroRepeat: [1, 1], set: roofSet, detailMix: 0.55, roughness: 0.8,
      }));
    }

    // ── 2. 植被：Poly Haven glb InstancedMesh（桌機限定） ──
    if (VEG.glb) {
      // 樹分三級（首屏預算 6 MB 擺不下「每一棵都是 1 MB 的高規版」，所以按鏡頭會不會看到來分）：
      //   hero = 離十字路口 < HERO_R 的行道樹與農舍高樹（齊射／上刺刀／潰敗三段都入鏡）→ _hi 全幾何
      //   mid  = 外側堤段的行道樹、北岸樹線 → 一般版（葉量較稀，但那個距離看不出來）
      //   far  = 遠景剪影帶與蘆葦 → 維持程序化低面數樹
      const HERO_R = 135;
      const heroSlots = [], midSlots = [];
      for (const m4 of glbSlots.roadTree) {
        const x = m4.elements[12], z = m4.elements[14];
        (Math.hypot(x, z) < HERO_R ? heroSlots : midSlots).push(m4);
      }
      // R5：medium 的 hero 樹改一般版（不吃 _hi 的全幾何）、mid 樹與柳叢抽稀到半量
      const thin = (arr, f) => (f >= 1 ? arr : (f <= 0 ? [] : arr.filter((_, i) => i % Math.round(1 / f) === 0)));
      const midThin = thin(midSlots, VEG.midFactor);
      const bankThin = thin(glbSlots.bankTree, VEG.midFactor);
      const willowThin = thin(glbSlots.willow, VEG.willowFactor);
      const [heroTree, midTree, willow] = await Promise.all([
        assets.model('tree_small_02', { hi: !!VEG.heroHi }),
        assets.model('island_tree_02'),
        assets.model('shrub_04'),
      ]);
      if (heroTree && midTree) {
        glbMeshes.push(...instanceGlb(heroTree, heroSlots, PROC_H[0]));
        glbMeshes.push(...instanceGlb(midTree, midThin, PROC_H[0]));
        // 北岸樹線在河對岸，影子落在沒人看的高地上；不投影可省掉一次 alphaTest 葉片的 shadow pass
        glbMeshes.push(...instanceGlb(midTree, bankThin, PROC_H[0], { cast: false }));
        treeMeshes[0].count = proceduralBase[0];          // 程序化近景樹整段退場（遠景剪影留著）
        report.vegetation = { hero: heroSlots.length, mid: midThin.length + bankThin.length, hi: !!VEG.heroHi };
      } else report.missing.push('tree_small_02_hi/island_tree_02');
      if (willow) {
        // 灌木不投影：alphaTest 的葉片在 shadow pass 很吃 fill rate，收益又低
        glbMeshes.push(...instanceGlb(willow, willowThin, PROC_H[1], { cast: false }));
        treeMeshes[1].count = proceduralBase[1];
      } else report.missing.push('shrub_04');
    }

    // ── 3. 建築 glb（Blender 自有模型） ────────────────────
    const buildingTable = {
      brick: { set: brickSet, roughness: 0.88 },
      stone: { set: plasterSet, roughness: 0.9 },
      stone_dark: { set: plasterSet, color: 0x9a927e, roughness: 0.9 },
      roof_tile: { set: roofSet, roughness: 0.8 },
      thatch: { set: roofSet, color: 0xa8935e, roughness: 1 },
    };
    // R2：桌機 high／medium 優先載 Cycles 舊化烘焙版（單一材質＋四張貼圖）。
    // 風車與戰損變體沒有烘焙版，維持現況；low 與手機一律走平塗版。
    const wantBaked = !!Q.baked;
    const [fhBaked, barnBaked] = await Promise.all([
      wantBaked ? assets.model('farmhouse_dutch_baked') : null,
      wantBaked ? assets.model('barn_baked') : null,
    ]);
    const [fhPlain, wmGlb, barnPlain] = await Promise.all([
      fhBaked ? null : assets.model('farmhouse_dutch'),
      assets.model('windmill'),
      barnBaked ? null : assets.model('barn'),
    ]);
    const fhGlb = fhBaked ?? fhPlain;
    const barnGlb = barnBaked ?? barnPlain;
    if (fhBaked) report.baked.push('farmhouse_dutch_baked');
    else if (wantBaked) report.missing.push('farmhouse_dutch_baked');
    if (barnBaked) report.baked.push('barn_baked');
    else if (wantBaked) report.missing.push('barn_baked');
    for (const [glb, name, isBaked] of [
      [fhGlb, 'farmhouse_dutch', !!fhBaked], [wmGlb, 'windmill', false], [barnGlb, 'barn', !!barnBaked],
    ]) {
      if (!glb) { report.missing.push(name); continue; }
      // 烘焙版已經把磨損、鏽跡、接縫、髒汙烘進貼圖：直接用 glb 自己的材質
      // （roughness 下限 0.35 與 envMapIntensity 由 assets.normalizeMaterial 統一處理），
      // **不再疊 Poly Haven 的磚牆／瓦頂貼圖**，否則等於把烘好的細節蓋掉。
      if (isBaked) { if (shadows) glb.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }
      else applyMaterialTextures(glb, buildingTable, { shadows });
    }
    if (fhGlb) {
      for (const fh of farmhouses) {
        const { scale } = fitToHeight(fhGlb, fh.h * 1.7);
        const inst = fhGlb.clone(true);
        inst.scale.setScalar(scale);
        inst.position.set(fh.x, 0, fh.z);
        inst.rotation.y = fh.rot;
        g.add(inst); glbMeshes.push(inst);
        fh.group.visible = false;
        disposeSubtree(fh.group);
      }
      report.buildings.push('farmhouse_dutch ×' + farmhouses.length);
    }
    if (wmGlb) {
      const { scale } = fitToHeight(wmGlb, 16);
      const inst = wmGlb.clone(true);
      inst.scale.setScalar(scale);
      inst.position.set(WINDMILL_POS[0], 0, WINDMILL_POS[1]);
      // glb 的正面（車翼那一面）是 −Z；戰場在堤南（+z），維持 0 讓車翼盤面正對南北，
      // 從圩田這一側看過去才是一整面車翼，而不是側面一條線。
      inst.rotation.y = 0;
      g.add(inst); glbMeshes.push(inst);
      // 車翼：glb 的 sails node 原點不一定在輪轂上，所以另外做一個「以車翼包圍盒中心為原點」的
      // pivot，用 attach() 保世界變換地把 sails 掛過去再轉；轉軸取包圍盒最扁的那一軸。
      const sails = inst.getObjectByName('sails');
      if (sails) {
        inst.updateMatrixWorld(true);
        const sb = new THREE.Box3().setFromObject(sails);
        const sc = sb.getCenter(new THREE.Vector3());
        const ss = sb.getSize(new THREE.Vector3());
        const pivot = new THREE.Group();
        pivot.position.copy(sc);
        g.add(pivot);
        pivot.attach(sails);
        const axis = ss.x <= ss.y && ss.x <= ss.z ? 'x' : (ss.z <= ss.y ? 'z' : 'y');
        windmillSails = { pivot, axis };
      }
      windmillGroup.visible = false;
      disposeSubtree(windmillGroup);
      report.buildings.push('windmill');
    }
    if (barnGlb) {
      const { scale } = fitToHeight(barnGlb, 7.0);
      const inst = barnGlb.clone(true);
      inst.scale.setScalar(scale);
      inst.position.set(16, 0, -42);
      inst.rotation.y = 0.2;
      g.add(inst); glbMeshes.push(inst);
      brickAnnex.visible = false;
      report.buildings.push('barn（磚廠側屋）');
    }
    // 十字路口的路標（這場戰役就叫「十字路口」，堤頂路口立一根很值得）
    const signGlb = await assets.model('signpost');
    if (signGlb) {
      applyMaterialTextures(signGlb, buildingTable, { shadows });
      const { scale } = fitToHeight(signGlb, 3.6);
      const inst = signGlb.clone(true);
      inst.scale.setScalar(scale);
      inst.position.set(-4.4, DIKE_H + 0.2, DIKE_Z + 1.6);
      inst.rotation.y = Math.PI * 0.15;
      g.add(inst); glbMeshes.push(inst);
      report.buildings.push('signpost');
    } else report.missing.push('signpost');

    for (const d of disposables.splice(0)) d.dispose();
    // R6：換上來的 glb 與 swapMaterial 新建的地表材質一次註冊給 CSM（冪等、手機 no-op）
    register?.(g);
    return report;
  }

  function disposeSubtree(root) {
    root.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    root.parent?.remove(root);
  }

  const places = [
    { name: '下萊茵河 Nederrijn', side: 'neutral', pos: { x: -50, y: 9, z: -64 } },
    { name: '河堤・十字路口', side: 'neutral', pos: { x: -34, y: 7, z: -16 } },
    { name: '蘭德韋克（連 CP）Randwijk', side: 'blue', pos: { x: -118, y: 8, z: 22 } },
    { name: '赫特倫 Heteren', side: 'neutral', pos: { x: 118, y: 8, z: 12 } },
    { name: '渡口・磚廠', side: 'red', pos: { x: 14, y: 9, z: -44 } },
    { name: '風車', side: 'neutral', pos: { x: 40, y: 16, z: -28 } },
  ];

  return { group: g, places, update, setDetail, treeMeshes, applyAssets };
}

// 水面反光用的細長柔光
function makeGlintTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 16, 1, 64, 16, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(230,240,235,0.30)');
  grad.addColorStop(1, 'rgba(230,240,235,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
