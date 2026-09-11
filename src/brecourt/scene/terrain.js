// 布雷庫爾地形 — 諾曼第六月牧草地與樹籬田(bocage)、四門砲的 L 形塹壕與砲坑、布雷庫爾莊園,
// 東側為德軍放水的氾濫低地、猶他灘 2 號堤道與海灘(供「同步時鐘」遠景)。
// 註:樹籬與單位尺度刻意放大,凸顯「每塊田都是一道牆」(可讀性優先)。
//
// 美術升級(docs/art-upgrade-spec.md §3):
//   L-1 地表程序化貼圖:多倍頻雜訊牧草斑 ＋ 低頻田塊色差 ＋ 田塊邊界(畫進貼圖,邊緣 wrap 消接縫);
//       原本的硬邊多邊形田野 mesh 全數移除;道路改用專屬土路貼圖(車轍＋路肩);
//       戰區彈坑／踩踏痕改為單張非平鋪的柔邊貼花,疊在砲線田上。
//   L-2 植被:樹改「層疊冠 ＋ 樹幹」低面數幾何、頂點抖動、兩色;樹籬 = 土堤 ＋ 沿線灌木叢 ＋ 零星高樹;
//       全部 InstancedMesh(每變體一個);桌機另撒草叢交叉 quad(vertex shader 隨風輕搖)。
//   L-3 建築:莊園牆面石砌貼圖、屋頂瓦片貼圖、煙囪。
//   全檔佈局改用檔內 mulberry(seed),重新整理不會變(原本部分用 Math.random)。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ── 可重現偽隨機(佈局固定) ───────────────────────────────
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// 在幾何上塗單一頂點色(供 InstancedMesh／合併網格以單一材質呈現多色)
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// 頂點抖動(讓樹冠不是完美球)
function jitter(geo, r, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (r() - 0.5) * amt;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ── L-1 地表貼圖:諾曼第六月牧草地 ＋ 樹籬田塊 ─────────────
function makeGroundTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(1944);

  g.fillStyle = '#6a7d42';
  g.fillRect(0, 0, S, S);

  // 邊緣環繞版色斑:近邊界的斑也畫在對側,平鋪無接縫
  const blob = (x, y, rad, fill) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const gx = x + dx, gy = y + dy;
      if (gx < -rad || gx > S + rad || gy < -rad || gy > S + rad) continue;
      const grad = g.createRadialGradient(gx, gy, 1, gx, gy, rad);
      grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(gx, gy, rad, 0, Math.PI * 2); g.fill();
    }
  };

  // 多倍頻牧草明暗斑(3 octave)
  const tones = [[123, 143, 76], [88, 108, 53], [142, 148, 85], [104, 126, 62], [78, 96, 47]];
  for (let i = 0; i < 40; i++) {
    const t = tones[Math.floor(r() * tones.length)];
    blob(r() * S, r() * S, S * (0.06 + r() * 0.13), `rgba(${t[0]},${t[1]},${t[2]},${0.14 + r() * 0.14})`);
  }
  for (let i = 0; i < 170; i++) {
    const t = tones[Math.floor(r() * tones.length)];
    blob(r() * S, r() * S, S * (0.012 + r() * 0.04), `rgba(${t[0]},${t[1]},${t[2]},${0.10 + r() * 0.16})`);
  }
  g.globalAlpha = 0.055;
  for (let i = 0; i < Math.floor(S * 2.6); i++) {
    g.fillStyle = r() > 0.5 ? '#93a05c' : '#4e6030';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  g.globalAlpha = 1;

  // ── 田塊(bocage 拼布):N×N 抖動網格,邊界頂點釘在畫布邊緣以利平鋪 ──
  const N = 5, step = S / N;
  const vx = [], vy = [];
  for (let i = 0; i <= N; i++) {
    vx.push([]); vy.push([]);
    for (let j = 0; j <= N; j++) {
      const edgeI = i === 0 || i === N, edgeJ = j === 0 || j === N;
      vx[i].push(i * step + (edgeI ? 0 : (r() - 0.5) * step * 0.30));
      vy[i].push(j * step + (edgeJ ? 0 : (r() - 0.5) * step * 0.30));
    }
  }
  const fieldCols = [
    'rgba(112,132,66,0.30)',  // 牧草
    'rgba(86,105,47,0.30)',   // 深草
    'rgba(151,147,78,0.26)',  // 抽穗的麥
    'rgba(156,138,85,0.24)',  // 收割地
    'rgba(109,91,60,0.22)',   // 翻土
    'rgba(126,142,74,0.26)',
  ];
  const cellPath = (i, j) => {
    g.beginPath();
    g.moveTo(vx[i][j], vy[i][j]);
    g.lineTo(vx[i + 1][j], vy[i + 1][j]);
    g.lineTo(vx[i + 1][j + 1], vy[i + 1][j + 1]);
    g.lineTo(vx[i][j + 1], vy[i][j + 1]);
    g.closePath();
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    g.fillStyle = fieldCols[Math.floor(r() * fieldCols.length)];
    cellPath(i, j); g.fill();
    // 田內犁溝/割痕(淡)
    if (r() > 0.45) {
      g.save(); cellPath(i, j); g.clip();
      const ang = r() * Math.PI;
      g.translate(vx[i][j], vy[i][j]); g.rotate(ang);
      g.strokeStyle = 'rgba(60,72,36,0.10)'; g.lineWidth = Math.max(1, step * 0.012);
      for (let y = -step * 1.6; y < step * 1.6; y += step * 0.055) {
        g.beginPath(); g.moveTo(-step * 1.6, y); g.lineTo(step * 1.6, y); g.stroke();
      }
      g.restore();
    }
  }
  // 田塊邊界:多層漸窄的暗帶(樹籬與其投影)
  g.lineJoin = 'round';
  for (const [w, a] of [[0.115, 0.07], [0.062, 0.10], [0.030, 0.16], [0.014, 0.18]]) {
    g.strokeStyle = `rgba(38,48,26,${a})`;
    g.lineWidth = step * w;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { cellPath(i, j); g.stroke(); }
  }
  // 邊界外緣一絲亮草(樹籬腳邊的長草)
  g.strokeStyle = 'rgba(158,168,96,0.13)';
  g.lineWidth = step * 0.006;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { cellPath(i, j); g.stroke(); }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 低頻大範圍遮罩:整張地圖一張(repeat 1、不平鋪),用來打散主貼圖的 5×5 田塊規律 ──
// 內容是灰階 0.5 附近的超低頻雜訊 ＋ 微色偏;在片元裡與主貼圖相乘,遠景就看不出格紋週期。
function makeMacroTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(60606);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  const soft = (x, y, rad, fill) => {
    const grad = g.createRadialGradient(x, y, rad * 0.05, x, y, rad);
    grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  // 超低頻:整片田野的明暗起伏(雲影／地勢)
  for (let i = 0; i < 10; i++) {
    const lift = r() > 0.5;
    soft(r() * S, r() * S, S * (0.30 + r() * 0.35),
      lift ? `rgba(178,176,158,${0.30 + r() * 0.22})` : `rgba(84,90,78,${0.26 + r() * 0.20})`);
  }
  // 中低頻:田塊之間的色相／明度差(黃綠 vs 冷綠)
  for (let i = 0; i < 34; i++) {
    const warm = r() > 0.5;
    soft(r() * S, r() * S, S * (0.08 + r() * 0.16),
      warm ? `rgba(158,148,112,${0.16 + r() * 0.18})` : `rgba(104,124,112,${0.16 + r() * 0.18})`);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;   // 資料型貼圖:不設 SRGBColorSpace,取樣值直接當乘數用
  return t;
}

// ── 土路貼圖(路面 ＋ 兩道車轍 ＋ 路肩漸層 ＋ 碎石顆粒) ──────
function makeRoadTexture() {
  const W = 256, H = 128;   // U = 路長方向、V = 路寬方向
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry(606);
  g.fillStyle = '#8e805f'; g.fillRect(0, 0, W, H);
  // 路肩:兩側漸暗並帶草色
  const edge = g.createLinearGradient(0, 0, 0, H);
  edge.addColorStop(0, 'rgba(78,90,48,0.9)');
  edge.addColorStop(0.18, 'rgba(120,118,74,0.15)');
  edge.addColorStop(0.82, 'rgba(120,118,74,0.15)');
  edge.addColorStop(1, 'rgba(78,90,48,0.9)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);
  // 兩道車轍(沿路長方向)
  for (const cy of [H * 0.33, H * 0.67]) {
    for (let x = 0; x < W; x += 2) {
      const wob = Math.sin(x * 0.05) * 2.0 + (r() - 0.5) * 1.2;
      g.fillStyle = `rgba(84,72,50,${0.30 + r() * 0.2})`;
      g.fillRect(x, cy + wob - H * 0.055, 2, H * 0.11);
    }
  }
  // 碎石顆粒
  for (let i = 0; i < 2600; i++) {
    const x = r() * W, y = r() * H;
    g.fillStyle = r() > 0.5 ? `rgba(190,180,152,${0.10 + r() * 0.2})` : `rgba(88,78,58,${0.10 + r() * 0.2})`;
    g.fillRect(x, y, 1.6, 1.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 1);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 戰區貼花:彈坑暈染 ＋ 踩踏痕(單張、不平鋪、邊緣淡出) ─────
function makeScarTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(1961);
  const soft = (x, y, rad, fill) => {
    const grad = g.createRadialGradient(x, y, rad * 0.05, x, y, rad);
    grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  // 踩踏／車輾出的裸土帶(沿 L 形塹壕方向)
  g.lineCap = 'round';
  for (const [x1, y1, x2, y2, w] of [
    [0.44, 0.10, 0.46, 0.62, 0.055],
    [0.46, 0.62, 0.78, 0.68, 0.05],
    [0.30, 0.16, 0.45, 0.34, 0.035],
  ]) {
    for (let k = 3; k >= 1; k--) {
      g.strokeStyle = `rgba(96,80,54,${0.05 * k})`;
      g.lineWidth = S * w * k * 0.9;
      g.beginPath(); g.moveTo(x1 * S, y1 * S); g.lineTo(x2 * S, y2 * S); g.stroke();
    }
  }
  // 彈坑:淺色濺邊 ＋ 深色坑心
  for (let i = 0; i < 34; i++) {
    const x = S * (0.16 + r() * 0.7), y = S * (0.08 + r() * 0.78);
    const rad = S * (0.012 + r() * 0.028);
    soft(x, y, rad * 2.1, `rgba(150,136,100,${0.24 + r() * 0.16})`);
    soft(x, y, rad, `rgba(50,42,30,${0.42 + r() * 0.26})`);
  }
  // 邊緣淡出(避免貼花出現硬邊方框)
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(S / 2, S / 2, S * 0.16, S / 2, S / 2, S * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.72, 'rgba(0,0,0,0.85)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── L-3 建築貼圖:諾曼第石砌牆 ＋ 瓦頂 ──────────────────────
function makeWallTexture(seed, base, mortar) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(seed);
  g.fillStyle = mortar; g.fillRect(0, 0, S, S);
  const rows = 13, bh = S / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * bh * 0.9;
    for (let x = -bh * 2; x < S + bh * 2; x += bh * 1.9) {
      const w = bh * (1.5 + r() * 0.5), h = bh * 0.78;
      const sh = Math.floor((r() - 0.5) * 26);
      g.fillStyle = shade(base, sh);
      g.fillRect(x + off, j * bh + bh * 0.11, w, h);
    }
  }
  // 髒污與苔痕
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 26;
    const grad = g.createRadialGradient(x, y, 1, x, y, rad);
    grad.addColorStop(0, `rgba(70,74,52,${0.05 + r() * 0.1})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRoofTexture(seed, base) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(seed);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const rows = 16, bh = S / rows;
  for (let j = 0; j < rows; j++) {
    g.fillStyle = `rgba(0,0,0,${0.10 + r() * 0.06})`;
    g.fillRect(0, j * bh + bh * 0.78, S, bh * 0.22);
    for (let x = 0; x < S; x += bh * 1.1) {
      g.fillStyle = shade(base, Math.floor((r() - 0.5) * 30));
      g.fillRect(x + (j % 2) * bh * 0.55, j * bh, bh * 1.0, bh * 0.76);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hexStr, d) {
  const n = parseInt(hexStr.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v + d));
  return `rgb(${cl((n >> 16) & 255)},${cl((n >> 8) & 255)},${cl(n & 255)})`;
}

// ── L-2 樹:2–3 層錯位堆疊的扁球樹冠 ＋ 樹幹(合併成單一帶頂點色 geometry) ──
function makeTreeGeometry(seed, tall) {
  const r = mulberry(seed);
  const parts = [];
  const trunkH = tall ? 7.0 : 4.4;
  // 樹幹轉非索引,才能與非索引的 icosahedron 樹冠合併
  const trunk = new THREE.CylinderGeometry(tall ? 0.55 : 0.4, tall ? 1.0 : 0.75, trunkH, 6).toNonIndexed();
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, 0x4b3a26));
  const tiers = tall
    ? [[4.6, trunkH + 1.6, 0x3f5b28], [3.9, trunkH + 4.2, 0x557331], [2.9, trunkH + 6.2, 0x6d8b3c]]
    : [[3.4, trunkH + 1.1, 0x3d5726], [2.7, trunkH + 3.0, 0x5a7833]];
  for (const [rad, y, col] of tiers) {
    const blob = new THREE.IcosahedronGeometry(rad, 1);
    jitter(blob, r, 0.34);
    blob.scale(1, 0.74, 1);
    blob.translate((r() - 0.5) * rad * 0.5, y, (r() - 0.5) * rad * 0.5);
    parts.push(paint(blob, col));
  }
  return mergeGeometries(parts, false);
}

// 灌木叢(樹籬沿線)
function makeBushGeometry(seed) {
  const r = mulberry(seed);
  const parts = [];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rad = 1.5 + r() * 1.2;
    const b = new THREE.IcosahedronGeometry(rad, 0);
    jitter(b, r, 0.42);
    b.scale(1, 0.78, 1);
    b.translate((r() - 0.5) * 2.2, rad * 0.55 + r() * 0.8, (r() - 0.5) * 2.2);
    parts.push(paint(b, r() > 0.5 ? 0x3f5a2c : 0x4d6a33));
  }
  return mergeGeometries(parts, false);
}

// 草叢:交叉雙面 quad ＋ alpha 貼圖
function makeGrassTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(404);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    const x = 4 + r() * (S - 8);
    const h = S * (0.45 + r() * 0.5);
    const w = 1.4 + r() * 2.2;
    const lean = (r() - 0.5) * 14;
    const grad = g.createLinearGradient(0, S, 0, S - h);
    grad.addColorStop(0, 'rgba(104,124,58,0.9)');
    grad.addColorStop(1, 'rgba(176,190,110,0.85)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, S);
    g.quadraticCurveTo(x - w * 0.4 + lean * 0.5, S - h * 0.6, x + lean, S - h);
    g.quadraticCurveTo(x + w * 0.6 + lean * 0.5, S - h * 0.6, x + w, S);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBrecourtTerrain(scene, { shadows = false, mobile = false } = {}) {
  const g = new THREE.Group();
  const R = mulberry(20240612);

  const earthMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3e });
  const earthLip = new THREE.MeshLambertMaterial({ color: 0x7c6a48 });
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x40331f });
  const trenchMat = new THREE.MeshLambertMaterial({ color: 0x2c2519 });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xc9b487 });

  // ── L-1 主地表:程序化牧草地／樹籬田塊貼圖 ────────────────
  const groundTex = makeGroundTexture(mobile ? 1024 : 2048);
  const GROUND_REPEAT = groundTex.repeat.x;   // vMapUv 已含 repeat,除回去就是整張地圖的 0..1
  const macroTex = makeMacroTexture(mobile ? 256 : 512);
  const pastureMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex });
  pastureMat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macroTex };
    sh.fragmentShader = 'uniform sampler2D uMacro;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec3 macroM = texture2D( uMacro, vMapUv * ${(1 / GROUND_REPEAT).toFixed(5)} ).rgb;
       diffuseColor.rgb *= (0.45 + 1.10 * macroM);`
    );
  };
  const pasture = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), pastureMat);
  pasture.rotation.x = -Math.PI / 2;
  pasture.position.set(0, 0.02, 0);
  if (shadows) pasture.receiveShadow = true;
  g.add(pasture);

  // 戰區貼花(彈坑暈染／踩踏痕),疊在砲線田上
  const scar = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 150),
    new THREE.MeshLambertMaterial({ map: makeScarTexture(mobile ? 512 : 1024), transparent: true, depthWrite: false })
  );
  scar.rotation.x = -Math.PI / 2;
  scar.position.set(15, 0.16, 14);
  if (shadows) scar.receiveShadow = true;
  g.add(scar);

  // ── 樹籬(bocage):土堤合併成單一網格,灌木／高樹收集後做 InstancedMesh ──
  const bankParts = [];
  const bushM = [], treeM = [[], []];
  const dummy = new THREE.Object3D();

  function pushInstance(list, x, y, z, s, ry, rz = 0) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, rz);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  }

  // 土堤:六角柱壓扁後沿線鋪設(比方塊有機、無塑膠硬邊)
  function hedgerow(x1, z1, x2, z2, lush = false) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;

    const bank = new THREE.CylinderGeometry(2.1, 2.1, len, 6, 1);
    bank.rotateX(Math.PI / 2);
    bank.scale(1, 0.62, 1);
    const m = new THREE.Matrix4().makeRotationY(ang).setPosition(cx, 1.0, cz);
    bank.applyMatrix4(m);
    bankParts.push(paint(bank, 0x5d4d33));

    // 沿線灌木叢(密),lush 的更密更高
    const stepB = lush ? 2.6 : 3.6;
    const n = Math.max(2, Math.round(len / stepB));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const px = x1 + dx * f + (R() - 0.5) * 1.6;
      const pz = z1 + dz * f + (R() - 0.5) * 1.6;
      pushInstance(bushM, px, 1.5 + R() * 0.5, pz, (lush ? 0.95 : 0.8) * (0.8 + R() * 0.6), R() * Math.PI * 2, (R() - 0.5) * 0.14);
    }
    // 樹籬頂端零星高樹
    const tn = Math.max(1, Math.round(len / (lush ? 17 : 26)));
    for (let i = 0; i < tn; i++) {
      const f = (i + 0.4 + R() * 0.3) / tn;
      const px = x1 + dx * f + (R() - 0.5) * 2.2;
      const pz = z1 + dz * f + (R() - 0.5) * 2.2;
      pushInstance(treeM[R() > 0.42 ? 0 : 1], px, 1.2, pz, 0.8 + R() * 0.5, R() * Math.PI * 2);
    }
  }

  function trench(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, len), trenchMat);
    t.position.set((x1 + x2) / 2, 0.28, (z1 + z2) / 2);
    t.rotation.y = Math.atan2(dx, dz);
    if (shadows) t.receiveShadow = true;
    g.add(t);
  }

  // 砲坑:暗色坑底 + 環形土唇
  function gunPit(x, z) {
    const pit = new THREE.Mesh(new THREE.CircleGeometry(3.2, 18), pitMat);
    pit.rotation.x = -Math.PI / 2; pit.position.set(x, 0.2, z);
    if (shadows) pit.receiveShadow = true;
    g.add(pit);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.7, 6, 18), earthLip);
    lip.rotation.x = -Math.PI / 2; lip.position.set(x, 0.45, z);
    if (shadows) { lip.castShadow = true; lip.receiveShadow = true; }
    g.add(lip);
  }

  // ── 主戰場:布雷庫爾砲線田 ───────────────────────────
  hedgerow(-16, -14, 54, 20, true);   // 砲線樹籬
  hedgerow(54, 20, 60, 86, true);     // 東緣
  hedgerow(60, 86, -20, 80, true);    // 南緣
  hedgerow(-20, 80, -16, -14, true);  // 西緣(主攻接近路線)
  trench(8, 34, 9, -4);   // L 形縱臂(三門朝東)
  trench(9, -4, 30, -8);  // L 形橫臂(一門朝北)
  for (const p of [[8, 30], [8, 14], [9, -2], [28, -6]]) gunPit(p[0], p[1]);

  // ── 鄰接樹籬田(bocage 方格網) ──────────────────────────
  hedgerow(-16, -14, -90, -10);
  hedgerow(-90, -10, -86, 96);
  hedgerow(-86, 96, -20, 80);
  hedgerow(60, 86, 150, 80);
  hedgerow(54, 20, 150, 16);
  hedgerow(150, 16, 150, 80);
  hedgerow(-16, -14, 8, -78);
  hedgerow(8, -78, 90, -70);
  hedgerow(90, -70, 54, 20);
  hedgerow(-200, -120, -120, -110);
  hedgerow(-150, -200, -150, -90);
  hedgerow(-280, -240, -200, -250);
  // 遠景樹籬網(讓「這是諾曼第」延伸到地平線,不再是空曠平面)
  for (let i = 0; i < 14; i++) {
    const x = -560 + R() * 1000, z = -520 + R() * 1000;
    if (Math.abs(x) < 170 && Math.abs(z) < 130) continue;   // 別擋住核心戰場
    if (x > 110 && Math.abs(z) < 190) continue;             // 別長進氾濫低地
    const len = 70 + R() * 110;
    const horiz = R() > 0.5;
    hedgerow(x, z, x + (horiz ? len : R() * 16 - 8), z + (horiz ? R() * 16 - 8 : len));
  }

  // ── 莊園建物群(西北:主屋 + 穀倉 + 矮石牆) ──────────────
  const wallTexA = makeWallTexture(31, '#b3a98e', '#8c8470');
  const wallTexB = makeWallTexture(57, '#9c937a', '#7d765f');
  const roofTexA = makeRoofTexture(73, '#6e4a39');
  const roofTexB = makeRoofTexture(91, '#5d4232');
  const chimneyMat = new THREE.MeshLambertMaterial({ map: wallTexB, color: 0xd8d0bb });
  const manorMats = [
    new THREE.MeshLambertMaterial({ map: wallTexA, color: 0xffffff }),
    new THREE.MeshLambertMaterial({ map: wallTexB, color: 0xffffff }),
  ];
  const roofMats = [
    new THREE.MeshLambertMaterial({ map: roofTexA, color: 0xffffff }),
    new THREE.MeshLambertMaterial({ map: roofTexB, color: 0xffffff }),
  ];

  function building(x, z, w, d, h, rot = 0, matIdx = 0, chimney = true) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), manorMats[matIdx]);
    wall.position.set(x, h / 2, z); wall.rotation.y = rot;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.52, h * 0.75, 4), roofMats[matIdx]);
    roof.position.set(x, h + h * 0.36, z); roof.rotation.y = rot + Math.PI / 4;
    if (shadows) { wall.castShadow = wall.receiveShadow = true; roof.castShadow = true; }
    g.add(wall); g.add(roof);
    if (chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(1.5, h * 0.9, 1.5), chimneyMat);
      ch.position.set(x + Math.cos(rot) * w * 0.3, h + h * 0.4, z - Math.sin(rot) * w * 0.3);
      if (shadows) ch.castShadow = true;
      g.add(ch);
    }
  }

  building(-60, -42, 16, 11, 8, 0.3, 0);
  building(-44, -54, 11, 8, 6, -0.2, 0);
  building(-78, -34, 22, 7, 5.5, 0.5, 1, false); // 長穀倉
  const stoneWall = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 1.2), manorMats[1]);
  stoneWall.position.set(-58, 0.8, -26); stoneWall.rotation.y = 0.3;
  if (shadows) { stoneWall.castShadow = stoneWall.receiveShadow = true; }
  g.add(stoneWall);
  // 莊園旁的果樹叢
  for (let i = 0; i < 10; i++) {
    pushInstance(treeM[i % 2], -96 + R() * 60, 1.2, -70 + R() * 40, 0.85 + R() * 0.5, R() * Math.PI * 2);
  }

  // ── 勒格朗謝曼土路(專屬土路貼圖) ─────────────────────
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 6.4),
    new THREE.MeshLambertMaterial({ map: makeRoadTexture(), color: 0xffffff })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(-10, 0.14, 96);
  if (shadows) road.receiveShadow = true;
  g.add(road);

  // ── 東側:氾濫低地(德軍放水淹的農田)→ 2 號堤道 → 猶他灘 → 海 ──
  function water(x, z, w, d, color, y = 0.2, opacity = 0.85) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m);
    return m;
  }
  water(235, 0, 230, 320, 0x3c5f6d, 0.28, 0.72);
  // 半沒入的田埂格線(合併成單一網格)
  const floodParts = [];
  for (let gx = 140; gx <= 340; gx += 50) {
    const b = new THREE.BoxGeometry(1.6, 0.7, 300); b.translate(gx, 0.34, 0); floodParts.push(b);
  }
  for (let gz = -130; gz <= 130; gz += 52) {
    const b = new THREE.BoxGeometry(220, 0.7, 1.6); b.translate(235, 0.34, gz); floodParts.push(b);
  }
  const floodBanks = new THREE.Mesh(mergeGeometries(floodParts, false), new THREE.MeshLambertMaterial({ color: 0x4a5535 }));
  g.add(floodBanks);
  // 露出水面的蘆葦叢(InstancedMesh)
  const reedGeo = paint(new THREE.IcosahedronGeometry(1.6, 0), 0x62753f);
  reedGeo.scale(1, 0.34, 1);
  const reeds = new THREE.InstancedMesh(reedGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 44);
  for (let i = 0; i < 44; i++) {
    dummy.position.set(130 + R() * 210, 0.4, -150 + R() * 300);
    dummy.rotation.set(0, R() * Math.PI, 0);
    dummy.scale.setScalar(0.7 + R() * 0.9);
    dummy.updateMatrix();
    reeds.setMatrixAt(i, dummy.matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  g.add(reeds);

  const causeway = new THREE.Mesh(new THREE.BoxGeometry(240, 0.8, 5.5), new THREE.MeshLambertMaterial({ color: 0x8a7c5c }));
  causeway.position.set(245, 0.5, -4);
  if (shadows) causeway.receiveShadow = true;
  g.add(causeway);
  const beach = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 360), sandMat);
  beach.position.set(440, 0.15, 20); g.add(beach);
  water(900, 20, 900, 600, 0x24516e, 0.15, 1);

  // ── 樹籬土堤合併 ＋ 灌木／樹 InstancedMesh ────────────────
  const vegMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const banks = new THREE.Mesh(mergeGeometries(bankParts, false), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  if (shadows) { banks.castShadow = true; banks.receiveShadow = true; }
  g.add(banks);

  const bushGeos = [makeBushGeometry(5), makeBushGeometry(19)];
  const bushHalf = Math.ceil(bushM.length / 2);
  for (let v = 0; v < 2; v++) {
    const list = v === 0 ? bushM.slice(0, bushHalf) : bushM.slice(bushHalf);
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(bushGeos[v], vegMat, list.length);
    for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    g.add(im);
  }

  const treeGeos = [makeTreeGeometry(101, true), makeTreeGeometry(202, false)];
  for (let v = 0; v < 2; v++) {
    if (!treeM[v].length) continue;
    const im = new THREE.InstancedMesh(treeGeos[v], vegMat, treeM[v].length);
    for (let i = 0; i < treeM[v].length; i++) im.setMatrixAt(i, treeM[v][i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    g.add(im);
  }

  // ── 草叢(桌機限定,核心區 ±160):交叉雙面 quad,vertex shader 隨風輕搖 ──
  const wind = { value: 0 };
  let grassMesh = null;
  if (!mobile) {
    const qa = new THREE.PlaneGeometry(1.7, 1.15); qa.translate(0, 0.575, 0);
    const qb = qa.clone(); qb.rotateY(Math.PI / 2);
    const grassGeo = mergeGeometries([qa, qb], false);
    // 法線一律朝上:草叢跟著地面一起受光,不會變成一叢黑刺
    const gn = grassGeo.attributes.normal;
    for (let i = 0; i < gn.count; i++) gn.setXYZ(i, 0, 1, 0);
    gn.needsUpdate = true;
    const grassMat = new THREE.MeshLambertMaterial({
      map: makeGrassTexture(), alphaTest: 0.42, side: THREE.DoubleSide, color: 0xffffff,
    });
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float swayH = max(transformed.y, 0.0);
           vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           transformed.x += sin(uWind * 1.7 + iOrigin.x * 0.13 + iOrigin.z * 0.09) * 0.20 * swayH;
           transformed.z += cos(uWind * 1.3 + iOrigin.x * 0.10) * 0.14 * swayH;
         #endif`
      );
    };
    const N = 2600;
    grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, N);
    for (let i = 0; i < N; i++) {
      const x = -160 + R() * 320, z = -140 + R() * 300;
      dummy.position.set(x, 0.05, z);
      dummy.rotation.set(0, R() * Math.PI, 0);
      dummy.scale.set(0.7 + R() * 0.6, 0.65 + R() * 0.7, 0.7 + R() * 0.6);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.frustumCulled = true;
    g.add(grassMesh);
  }

  scene.add(g);

  const places = [
    { name: '布雷庫爾莊園 Brécourt', side: 'neutral', pos: { x: -58, y: 16, z: -42 } },
    { name: '勒格朗謝曼 Le Grand-Chemin', side: 'neutral', pos: { x: -72, y: 8, z: 96 } },
    { name: '氾濫低地', side: 'neutral', pos: { x: 235, y: 10, z: 90 } },
    { name: '猶他灘 2 號堤道', side: 'blue', pos: { x: 300, y: 8, z: -4 } },
    { name: '猶他灘 Utah Beach', side: 'blue', pos: { x: 440, y: 10, z: 60 } },
  ];

  return {
    group: g,
    places,
    update(dt) { wind.value += dt; },
  };
}
