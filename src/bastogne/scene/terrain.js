// 巴斯通地形 — 阿登冬季森林戰場(傑克森林 Bois Jacques):
//   ①E 連散兵坑線(MLR)沿森林南緣樹線、面北迎向開闊雪原(下坡通往德軍佔領的佛伊)
//   ②傑克森林松林(InstancedMesh,C-1)＝樹頂空爆的舞台;學到教訓後散兵坑加蓋松木頂
//   ③開闊雪原＋程序化雪地貼圖(B-3):髒雪、露土、車轍、彈坑
//   ④南面巴斯通鎮＝七路交會的公路樞紐(靜態幾何合併,C-2);北面佛伊村(德軍)
// 地形邏輯(招牌手法):森林樹冠=空爆的天花板(散兵坑無天然頂蓋)、開闊雪原=無掩蔽殺戮區、
//   公路樞紐=德軍非拿不可卻拿不到的目標。
// 座標:1 單位 = 10 公尺;原點 = E 連散兵坑線中央;北 = -z(雪原、佛伊、諾維爾)、南 = +z(森林縱深、巴斯通)。
//
// 美術精緻化(docs/art-upgrade-spec.md §5):
//   B-1 針葉樹＝三層錯位圓錐＋每層積雪白裙＋樹幹(三變體,仍為 InstancedMesh);森林地面暗斑與踩踏小徑
//   B-2 雪地細節疊層(車轍、散兵坑線、風吹雪紋、彈坑)畫進一張「細節貼花」大平面,只多 1 個 draw call
//   B-3 房舍:石牆貼圖＋夜相窗戶橘光(emissiveMap)、屋頂積雪白蓋
//   B-4 遠景地平線森林剪影帶(一圈鋸齒 ring,靠霧色淡出)
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

// 在幾何上塗上單一頂點色(供 InstancedMesh／合併網格以單一材質呈現多色)
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// 依牆面尺寸縮放 uv,讓不同大小的房子石砌尺度一致(合併後共用同一張貼圖)
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

// ── 程序化雪地貼圖(B-3):底雪偏灰藍,疊髒雪／露土色斑,撒彈坑暈染 ──
function makeSnowTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#dbe3ec'; g.fillRect(0, 0, S, S);   // 底雪(灰藍白)
  const r = mulberry(2024);

  // 邊緣環繞版:近邊界的色斑也畫在對側,消接縫
  const blob = (x, y, rad, fill) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const gx = x + dx, gy = y + dy;
      if (gx < -rad || gx > S + rad || gy < -rad || gy > S + rad) continue;
      const grad = g.createRadialGradient(gx, gy, 1, gx, gy, rad);
      grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(gx, gy, rad, 0, Math.PI * 2); g.fill();
    }
  };

  // 低頻色斑:髒雪(較暗冷灰)與露出的凍土(褐)
  for (let i = 0; i < 90; i++) blob(r() * S, r() * S, 60 + r() * 130, `rgba(176,186,198,${0.10 + r() * 0.14})`);
  for (let i = 0; i < 46; i++) blob(r() * S, r() * S, 30 + r() * 70, `rgba(120,110,92,${0.08 + r() * 0.12})`);
  // 微顆粒(踏亂的雪面)
  g.globalAlpha = 0.05;
  for (let i = 0; i < 4200; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#9aa4b0'; g.fillRect(r() * S, r() * S, 2, 2); }
  g.globalAlpha = 1;
  // 彈坑暈染:深色圓斑＋淺色濺邊
  for (let i = 0; i < 30; i++) {
    const x = r() * S, y = r() * S, rad = 10 + r() * 22;
    blob(x, y, rad * 1.7, `rgba(214,224,232,${0.5})`);          // 濺出的淺雪唇
    blob(x, y, rad, `rgba(58,52,46,${0.55 + r() * 0.25})`);      // 焦土坑心
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.anisotropy = 8;
  return t;
}

// ── 雪原細節貼花層(B-1 森林地面／B-2 雪地細節) ─────────────
// 一張與雪原平面 1:1 對位的透明貼圖(不平鋪),把「位置對得上」的細節畫進去:
//   樹下暗斑與踩踏小徑、車轍、E 連散兵坑線的翻土帶、風吹雪紋、戰線彈坑。
// 這些細節無法靠平鋪貼圖表現(會到處重複),故獨立一層;成本 = 1 個 draw call。
const FIELD_W = 1400;          // 雪原平面邊長
const FIELD_CZ = 40;           // 平面中心 z
// ── 松樹幾何(合併成單一帶頂點色的 geometry,供 InstancedMesh) ──
// B-1:三層錯位圓錐(下大上小、由深到略淺的松綠)＋每層底緣一圈白色積雪裙＋樹梢雪帽＋樹幹。
// 「錯位」= 每層各自繞 y 轉一個角、並側偏一點點,避免三個同軸圓錐看起來像一根塑膠聖誕樹。
function makePineGeometry(kind) {
  // kind: 0 高瘦、1 矮胖、2 中等偏歪(被砲彈削過的樣子)
  const cfg = [
    { trunkH: 3.4, tiers: [[2.70, 4.2, 3.0], [2.05, 3.6, 5.4], [1.30, 3.2, 7.6]], lean: 0.0 },
    { trunkH: 2.2, tiers: [[2.35, 3.2, 1.9], [1.75, 2.7, 3.5], [1.05, 2.3, 5.0]], lean: 0.0 },
    { trunkH: 2.8, tiers: [[2.50, 3.6, 2.4], [1.80, 3.0, 4.4], [1.05, 2.6, 6.2]], lean: 0.045 },
  ][kind];
  const greens = [0x33492f, 0x3c5638, 0x476542];
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.3, 0.52, cfg.trunkH + 0.6, 6);
  trunk.translate(0, (cfg.trunkH + 0.6) / 2, 0);
  parts.push(paint(trunk, 0x40301f));

  cfg.tiers.forEach(([rad, h, y], i) => {
    const yaw = 0.4 + i * 0.83;                    // 每層錯開一個角
    const dx = (i - 1) * 0.16 + cfg.lean * y;      // 側偏／整棵略歪
    const dz = (i % 2 ? 0.14 : -0.12);
    // 針葉層
    const cone = new THREE.ConeGeometry(rad, h, 7, 1);
    cone.rotateY(yaw); cone.translate(dx, y + h * 0.5, dz);
    parts.push(paint(cone, greens[i]));
    // 積雪裙:比針葉層略寬、很矮的白錐,只在該層底緣露出一圈白邊
    const skirt = new THREE.ConeGeometry(rad * 1.07, h * 0.30, 7, 1);
    skirt.rotateY(yaw + 0.22); skirt.translate(dx, y + h * 0.15 + 0.04, dz);
    parts.push(paint(skirt, 0xeef4f9));
  });
  // 樹梢雪帽
  const top = cfg.tiers[2];
  const cap = new THREE.ConeGeometry(top[0] * 0.42, top[1] * 0.42, 6, 1);
  cap.translate((2 - 1) * 0.16 + cfg.lean * top[2], top[2] + top[1] * 0.80, 0.14);
  parts.push(paint(cap, 0xf4f8fc));
  return mergeGeometries(parts, false);
}

// ── 阿登石屋牆面貼圖(石砌＋灰泥＋窗洞) ─────────────────────
function makeStoneTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(313);
  g.fillStyle = '#b9b5ab'; g.fillRect(0, 0, S, S);
  // 不規則石塊
  const rows = 14, rh = S / rows;
  for (let y = 0; y < rows; y++) {
    let x = (y % 2) * -rh * 0.6;
    while (x < S) {
      const w = rh * (1.1 + r() * 1.3);
      const v = 168 + Math.floor(r() * 44);
      g.fillStyle = `rgb(${v},${v - 3},${v - 12})`;
      g.fillRect(x + 1, y * rh + 1, w - 2, rh - 2);
      x += w;
    }
  }
  // 灰泥髒污與雪痕
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = 8 + r() * 40;
    const grad = g.createRadialGradient(x, y, 1, x, y, rad);
    const dark = r() > 0.5;
    grad.addColorStop(0, dark ? 'rgba(92,86,76,0.22)' : 'rgba(240,246,250,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  // 窗洞(兩個,與 emissive 圖對位)
  for (const [wx, wy] of WINDOWS) {
    g.fillStyle = '#2b2b2d';
    g.fillRect(wx * S, wy * S, 0.14 * S, 0.20 * S);
    g.strokeStyle = '#8d8880'; g.lineWidth = Math.max(1, S * 0.012);
    g.strokeRect(wx * S, wy * S, 0.14 * S, 0.20 * S);
    g.beginPath();                                    // 窗櫺
    g.moveTo((wx + 0.07) * S, wy * S); g.lineTo((wx + 0.07) * S, (wy + 0.20) * S);
    g.moveTo(wx * S, (wy + 0.10) * S); g.lineTo((wx + 0.14) * S, (wy + 0.10) * S);
    g.lineWidth = Math.max(1, S * 0.006); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const WINDOWS = [[0.18, 0.30], [0.62, 0.30], [0.40, 0.66]];

// 窗戶自發光遮罩:黑底,只有少數窗格透出燈火(夜相以 emissiveIntensity 開關)。
// 圍城中的小鎮是燈火管制的:三扇窗只有一扇真的透光、一扇微透,其餘全黑。
function makeWindowEmissive(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const lit = [0.9, 0.28, 0];
  WINDOWS.forEach(([wx, wy], i) => {
    const k = lit[i];
    if (!k) return;
    const grad = g.createRadialGradient(
      (wx + 0.07) * S, (wy + 0.10) * S, 1,
      (wx + 0.07) * S, (wy + 0.10) * S, 0.13 * S
    );
    grad.addColorStop(0, `rgba(255,206,140,${k})`);
    grad.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = grad;
    g.fillRect((wx - 0.05) * S, (wy - 0.05) * S, 0.24 * S, 0.30 * S);
    g.fillStyle = `rgba(255,214,160,${k})`;
    g.fillRect((wx + 0.02) * S, (wy + 0.03) * S, 0.10 * S, 0.15 * S);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 屋瓦貼圖(積雪蓋不到的簷口／背風面露出的石板瓦)
function makeRoofTexture(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(97);
  g.fillStyle = '#5d626a'; g.fillRect(0, 0, S, S);
  const rows = 16, rh = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = -1; x * rh * 1.6 < S; x++) {
      const v = 84 + Math.floor(r() * 34);
      g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      g.fillRect(x * rh * 1.6 + (y % 2) * rh * 0.8, y * rh, rh * 1.6 - 2, rh - 1.5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

// ── B-4 地平線森林剪影帶 ────────────────────────────────
function makeTreelineTexture(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = mulberry(606);
  g.clearRect(0, 0, W, H);
  // 兩層鋸齒:後層淡、前層深,做出縱深
  const layer = (baseY, amp, fill, step) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(0, H);
    let x = 0;
    while (x < W + step) {
      const h = baseY + r() * amp;
      g.lineTo(x, H - h * 0.35);
      g.lineTo(x + step * 0.5, H - h);        // 樹尖
      g.lineTo(x + step, H - h * 0.35);
      x += step;
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  layer(H * 0.40, H * 0.30, 'rgba(44,54,62,0.72)', W / 150);
  layer(H * 0.30, H * 0.34, 'rgba(24,32,38,0.94)', W / 110);
  // 底部一條實地平線,避免樹幹之間漏空
  g.fillStyle = 'rgba(22,30,36,0.96)';
  g.fillRect(0, H * 0.82, W, H * 0.18);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

export function createBastogneTerrain(scene, { shadows = false, mobile = false } = {}) {
  const g = new THREE.Group();
  const rng = mulberry(777);
  const TS = mobile ? 512 : 1024;          // 平鋪雪地貼圖
  const DS = mobile ? 1024 : 2048;         // 細節貼花層

  const snowMat = new THREE.MeshLambertMaterial({ color: 0xdfe7ee, map: makeSnowTexture(TS) });
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });   // 壓實的雪／泥路面
  const rutMat = new THREE.MeshLambertMaterial({ color: 0x5b5750 });    // 車轍暗痕
  const earthMat = new THREE.MeshLambertMaterial({ color: 0x5a5142 });  // 散兵坑翻土
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x211d18 });    // 坑心暗
  const logMat = new THREE.MeshLambertMaterial({ color: 0x53412c });    // 松木頂蓋
  const railMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3e });

  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    if (shadows) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m); return m;
  };

  // ── 雪原大平面(主戰場地表) ──────────────────────────────
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_W), snowMat);
  field.rotation.x = -Math.PI / 2; field.position.set(0, 0.02, FIELD_CZ);
  if (shadows) field.receiveShadow = true;
  g.add(field);

  // ── 公路樞紐:數條路自巴斯通鎮(南)向外放射(七路交會的招牌) ──
  // N30 主幹:巴斯通(南 +z)—佛伊(北 -z)—諾維爾,縱貫戰場
  const hub = { x: 40, z: 250 };                  // 鎮北緣的路口
  const roads = [{ cx: 18, cz: 40, len: 620, wid: 12, rot: 0.02 }];
  for (const a of [-1.15, -0.5, 0.5, 1.15]) {
    roads.push({ cx: hub.x + Math.sin(a) * 120, cz: hub.z - Math.cos(a) * 120, len: 300, wid: 9, rot: a });
  }
  for (const rd of roads) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(rd.wid, rd.len), roadMat);
    road.rotation.x = -Math.PI / 2; road.rotation.z = rd.rot; road.position.set(rd.cx, 0.06, rd.cz);
    if (shadows) road.receiveShadow = true; g.add(road);
    for (const off of [-rd.wid * 0.22, rd.wid * 0.22]) {   // 兩道車轍
      const rt = new THREE.Mesh(new THREE.PlaneGeometry(rd.wid * 0.14, rd.len), rutMat);
      rt.rotation.x = -Math.PI / 2; rt.rotation.z = rd.rot;
      rt.position.set(rd.cx + Math.cos(rd.rot) * off, 0.08, rd.cz - Math.sin(rd.rot) * off);
      g.add(rt);
    }
  }

  // ── 傑克森林(InstancedMesh,C-1):散兵坑線後方與兩翼的松林 ──
  const forest = new THREE.Group();
  const variants = [makePineGeometry(0), makePineGeometry(1), makePineGeometry(2)];
  const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const dummy = new THREE.Object3D();
  const placements = [[], [], []];
  const treeSpots = [];                          // 供細節貼花畫樹下暗斑
  const inClearing = (x, z) => (Math.abs(x - hub.x) < 90 && z > 150); // 鎮／路口空地不長樹
  for (let i = 0; i < 460; i++) {
    // 森林覆蓋南面縱深(z>8)與兩翼(|x|>150);北面雪原(z<0)保持開闊
    let x, z, tries = 0;
    do {
      const zone = rng();
      if (zone < 0.62) { x = -300 + rng() * 600; z = 12 + rng() * 240; }      // 南面森林縱深
      else if (zone < 0.81) { x = -420 + rng() * 150; z = -120 + rng() * 360; } // 西翼林
      else { x = 270 + rng() * 150; z = -120 + rng() * 360; }                   // 東翼林
    } while (inClearing(x, z) && tries++ < 6);
    const q = rng();
    const v = q > 0.55 ? 0 : q > 0.22 ? 1 : 2;
    const s = 0.85 + rng() * 0.7;
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    placements[v].push(dummy.matrix.clone());
    treeSpots.push({ x, z, s });
  }
  // MLR 樹線:散兵坑線正後方(z≈6)一道較密的松樹,空爆就炸在這排樹冠上
  for (let i = 0; i < 60; i++) {
    const x = -280 + (i / 59) * 560 + (rng() - 0.5) * 6;
    const z = 6 + (rng() - 0.5) * 8;
    const s = 1.0 + rng() * 0.5;
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    placements[rng() > 0.3 ? 0 : 2].push(dummy.matrix.clone());
    treeSpots.push({ x, z, s });
  }
  const forestMeshes = [];
  for (let v = 0; v < variants.length; v++) {
    const im = new THREE.InstancedMesh(variants[v], pineMat, placements[v].length);
    for (let i = 0; i < placements[v].length; i++) im.setMatrixAt(i, placements[v][i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    forest.add(im); forestMeshes.push(im);
  }
  g.add(forest);

  // ── 雪原細節貼花層(B-1／B-2):與雪原 1:1 對位的透明疊層 ─────
  const holeXs = [];
  for (let i = 0; i < 11; i++) holeXs.push(-250 + (i / 10) * 500);
  const detailTex = buildDetailTexture(DS, treeSpots, roads, holeXs);
  const detail = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_W, FIELD_W),
    new THREE.MeshLambertMaterial({ map: detailTex, transparent: true, depthWrite: false })
  );
  detail.rotation.x = -Math.PI / 2;
  detail.position.set(0, 0.04, FIELD_CZ);
  detail.renderOrder = -1;
  g.add(detail);

  // ── E 連散兵坑線(MLR):沿樹線 z≈0、面北 -z ────────────────
  // 西段=開頂坑(挖好但尚無頂蓋);東段=學到樹爆教訓後加蓋松木頂(Paul Rogers 的第二個坑才有頂)
  const holes = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const x = holeXs[i];
    const z = 1 + (rng() - 0.5) * 5;
    const hg = new THREE.Group(); hg.position.set(x, 0, z);
    // 翻土／雪唇(面北那側較高,當胸牆)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.7, 6, 12), earthMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.3; hg.add(rim);
    const pit = new THREE.Mesh(new THREE.CircleGeometry(2.0, 14), pitMat);
    pit.rotation.x = -Math.PI / 2; pit.position.y = 0.12; hg.add(pit);
    box2(hg, 5, 0.5, 1.1, earthMat, 0, 0.25, -2.4); // 面北胸牆(較高)
    if (i >= 6) { // 東段：加蓋松木頂
      for (let k = 0; k < 4; k++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 5, 6), logMat);
        log.rotation.z = Math.PI / 2; log.position.set(0, 1.15, -1.4 + k * 0.95); hg.add(log);
      }
      const snowRoof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.3, 4.2), new THREE.MeshLambertMaterial({ color: 0xe4ebf1 }));
      snowRoof.position.set(0, 1.4, 0); hg.add(snowRoof);
    }
    if (shadows) hg.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    holes.add(hg);
  }
  g.add(holes);
  function box2(parent, w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); parent.add(m); return m;
  }

  // ── 巴斯通鎮(南 +z):七路交會的樞紐城鎮(靜態幾何合併,C-2) ──
  // B-3:石牆貼圖(含窗)＋屋瓦＋屋頂積雪白蓋。合併成三個網格(牆、瓦頂、雪蓋)。
  const stoneTex = makeStoneTexture(mobile ? 256 : 512);
  const winTex = makeWindowEmissive(mobile ? 256 : 512);
  const roofTex = makeRoofTexture(mobile ? 128 : 256);
  const wallParts = [], roofParts = [], snowParts = [];
  const townR = mulberry(88);
  function houseAt(parts, roofs, snows, x, z, w, d, h, rot, wallHex, roofHex, snowHex) {
    const wall = new THREE.BoxGeometry(w, h, d); wall.translate(0, h / 2, 0);
    scaleUV(wall, Math.max(w, d) / 15, h / 11);
    const rad = Math.hypot(w, d) * 0.56, rh = h * 0.7;
    const roof = new THREE.ConeGeometry(rad, rh, 4);
    roof.rotateY(Math.PI / 4); roof.translate(0, h + rh * 0.5, 0);
    // 屋頂積雪:略大、略往上抬的白錐,只在簷口露出一圈深色瓦邊
    const snow = new THREE.ConeGeometry(rad * 1.035, rh, 4);
    snow.rotateY(Math.PI / 4); snow.translate(0, h + rh * 0.5 + rh * 0.07, 0);
    const mW = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
    wall.applyMatrix4(mW); roof.applyMatrix4(mW); snow.applyMatrix4(mW);
    parts.push(paint(wall, wallHex)); roofs.push(paint(roof, roofHex)); snows.push(paint(snow, snowHex));
  }
  for (let i = 0; i < 26; i++) {
    const ang = townR() * Math.PI * 2, rad = 30 + townR() * 150;
    const x = hub.x + Math.cos(ang) * rad, z = hub.z + Math.sin(ang) * rad * 0.7 + 30;
    if (z < 170) continue; // 別長到戰線上
    houseAt(wallParts, roofParts, snowParts, x, z, 9 + townR() * 8, 8 + townR() * 7, 6 + townR() * 5, townR() * Math.PI,
      0xb4b0a6, 0x767c85, 0xe8eff5);
  }
  // 教堂(鎮地標:石塔＋尖頂)
  houseAt(wallParts, roofParts, snowParts, hub.x, hub.z + 40, 12, 20, 9, 0, 0xb4b0a6, 0x767c85, 0xe8eff5);
  const tower = new THREE.BoxGeometry(6, 20, 6); tower.translate(hub.x - 10, 10, hub.z + 40);
  scaleUV(tower, 0.45, 1.8); wallParts.push(paint(tower, 0xa9a59b));
  const spire = new THREE.ConeGeometry(4.6, 10, 4); spire.rotateY(Math.PI / 4); spire.translate(hub.x - 10, 25, hub.z + 40);
  roofParts.push(paint(spire, 0x5c646d));
  const spireSnow = new THREE.ConeGeometry(4.76, 10, 4); spireSnow.rotateY(Math.PI / 4); spireSnow.translate(hub.x - 10, 25.7, hub.z + 40);
  snowParts.push(paint(spireSnow, 0xe8eff5));

  const wallMat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: stoneTex, emissiveMap: winTex, emissive: 0xffb066, emissiveIntensity: 0,
  });
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex, flatShading: true });
  const snowRoofMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const townWalls = new THREE.Mesh(mergeGeometries(wallParts, false), wallMat);
  const townRoofs = new THREE.Mesh(mergeGeometries(roofParts, false), roofMat);
  const townSnow = new THREE.Mesh(mergeGeometries(snowParts, false), snowRoofMat);
  if (shadows) { townWalls.castShadow = townWalls.receiveShadow = true; townSnow.castShadow = true; }
  g.add(townWalls); g.add(townRoofs); g.add(townSnow);

  // ── 佛伊村(北 -z,德軍佔領):散兵坑線越過雪原望見的小村 ────
  const foyParts = [], foyRoofs = [], foySnows = [];
  const foyR = mulberry(51);
  for (let i = 0; i < 8; i++) {
    const x = -70 + foyR() * 150, z = -190 - foyR() * 40;
    houseAt(foyParts, foyRoofs, foySnows, x, z, 8 + foyR() * 6, 7 + foyR() * 5, 5 + foyR() * 3, foyR() * Math.PI,
      0x9c988e, 0x6b7078, 0xe0e7ee);
  }
  const foyWallMat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: stoneTex, emissiveMap: winTex, emissive: 0xff9a4a, emissiveIntensity: 0,
  });
  const foyWalls = new THREE.Mesh(mergeGeometries(foyParts, false), foyWallMat);
  const foyRoofM = new THREE.Mesh(mergeGeometries(foyRoofs, false), roofMat);
  const foySnowM = new THREE.Mesh(mergeGeometries(foySnows, false), snowRoofMat);
  if (shadows) { foyWalls.castShadow = true; foySnowM.castShadow = true; }
  g.add(foyWalls); g.add(foyRoofM); g.add(foySnowM);

  // ── 鐵路路堤(東翼,501 團在鐵路以東的分界) ────────────────
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const cx = 260 - t * 120, cz = -160 + t * 380;
    box(10, 1.4, 8, earthMat, cx, 0.7, cz, Math.PI * 0.28);
    box(9, 0.3, 5.6, railMat, cx, 1.55, cz, Math.PI * 0.28);
  }

  // ── B-4 地平線森林剪影帶:雪原盡頭不直接接天 ────────────────
  const TL_R = 2100, TL_H = 78;
  const treeline = new THREE.Mesh(
    new THREE.CylinderGeometry(TL_R, TL_R, TL_H, mobile ? 48 : 96, 1, true),
    new THREE.MeshBasicMaterial({
      map: makeTreelineTexture(mobile ? 1024 : 2048, mobile ? 128 : 256),
      transparent: true, depthWrite: false, side: THREE.BackSide, color: 0x2a3540,
    })
  );
  treeline.position.set(0, TL_H * 0.5 - 6, 40);
  treeline.renderOrder = -2;
  g.add(treeline);

  scene.add(g);

  const places = [
    { name: '傑克森林 Bois Jacques', side: 'neutral', pos: { x: -140, y: 16, z: 70 } },
    { name: 'E 連散兵坑線（MLR）', side: 'blue', pos: { x: 40, y: 10, z: 2 } },
    { name: '佛伊 Foy（德軍）', side: 'red', pos: { x: 0, y: 12, z: -200 } },
    { name: '巴斯通鎮・七路樞紐', side: 'neutral', pos: { x: 40, y: 18, z: 250 } },
    { name: '諾維爾 Noville（北）', side: 'red', pos: { x: 20, y: 12, z: -380 } },
    { name: '開闊雪原（無掩蔽殺戮區）', side: 'neutral', pos: { x: -120, y: 6, z: -90 } },
  ];

  // 夜相窗戶橘光(B-3):由 main.js 每幀傳入 environment 的夜間權重 0–1
  const TREELINE_DAY = new THREE.Color(0x33404c);
  const TREELINE_NIGHT = new THREE.Color(0x10161f);
  function update(dt, night = 0) {
    const k = Math.max(0, Math.min(1, night));
    wallMat.emissiveIntensity = k * 0.30;
    foyWallMat.emissiveIntensity = k * 0.22;
    treeline.material.color.copy(TREELINE_DAY).lerp(TREELINE_NIGHT, k);
  }

  return { group: g, places, forestMeshes, update };
}

// 細節貼花層的實際繪製(拆成函式,讓 createBastogneTerrain 讀起來仍是「地形清單」)
function buildDetailTexture(S, treeSpots, roads, holeXs) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(4242);
  const PX = S / FIELD_W;
  const CX = (x) => (x + FIELD_W / 2) * PX;
  const CY = (z) => (z - FIELD_CZ + FIELD_W / 2) * PX;

  const soft = (x, z, radW, fill) => {
    const px = CX(x), py = CY(z), rad = Math.max(1.2, radW * PX);
    const grad = g.createRadialGradient(px, py, rad * 0.12, px, py, rad);
    grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
  };
  const stroke = (pts, widW, style, blur = 0) => {
    g.save();
    g.lineWidth = Math.max(1, widW * PX);
    g.strokeStyle = style; g.lineCap = 'round'; g.lineJoin = 'round';
    if (blur) g.filter = `blur(${blur}px)`;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(CX(p.x), CY(p.z)) : g.moveTo(CX(p.x), CY(p.z))));
    g.stroke();
    g.restore();
  };

  // ① 風吹雪紋:沿盛行風(東西向)的低頻長條微亮／微暗帶
  for (let i = 0; i < 130; i++) {
    const x = -700 + r() * FIELD_W;
    const z = FIELD_CZ - FIELD_W / 2 + r() * FIELD_W;
    const len = 100 + r() * 280, wid = 3 + r() * 9;
    g.save();
    g.translate(CX(x), CY(z));
    g.rotate((r() - 0.5) * 0.3);
    const bright = r() > 0.45;
    const col = bright ? '255,255,255' : '146,157,172';
    const grad = g.createLinearGradient(-len * PX / 2, 0, len * PX / 2, 0);
    grad.addColorStop(0, `rgba(${col},0)`);
    grad.addColorStop(0.5, `rgba(${col},${bright ? 0.22 : 0.15})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.fillRect(-len * PX / 2, -wid * PX / 2, len * PX, wid * PX);
    g.restore();
  }

  // ② 樹下暗斑(森林地面):每棵樹腳一團暗影,朝背光側偏一點
  for (const t of treeSpots) {
    soft(t.x + 2.4, t.z - 1.6, 4.2 + t.s * 3.4, `rgba(26,36,32,${0.20 + r() * 0.13})`);
    if (r() > 0.7) soft(t.x - 1.5, t.z + 1.2, 2.4 + t.s, 'rgba(74,64,48,0.18)');   // 露出的針葉層／凍土
  }

  // ③ 森林裡的踩踏小徑:蜿蜒的踏實亮雪徑＋兩側髒邊
  const trail = (x0, z0, x1, z1, seed) => {
    const rr = mulberry(seed);
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const f = i / 14;
      pts.push({ x: x0 + (x1 - x0) * f + (rr() - 0.5) * 32, z: z0 + (z1 - z0) * f + (rr() - 0.5) * 28 });
    }
    stroke(pts, 10, 'rgba(92,84,70,0.20)', 5);
    stroke(pts, 4.2, 'rgba(246,250,255,0.34)', 2);
  };
  trail(24, 246, 8, 16, 71);       // 巴斯通鎮 ←→ 散兵坑線(補給／後送)
  trail(-208, 206, -158, 12, 72);  // 西段連絡路
  trail(224, 214, 152, 18, 73);    // 東段連絡路
  trail(-150, 8, 240, 14, 74);     // 沿散兵坑線的橫向交通壕

  // ④ 車轍:沿每條公路兩道深轍,溢出路肩的髒雪
  for (const rd of roads) {
    // road plane 以 rotation.z = rot 旋轉;縱向 = (sin rot, cos rot),橫向 = (cos rot, -sin rot)
    const hx = Math.sin(rd.rot), hz = Math.cos(rd.rot);
    const nx = Math.cos(rd.rot), nz = -Math.sin(rd.rot);
    for (const off of [-rd.wid * 0.26, rd.wid * 0.26, 0]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const f = (i / 12 - 0.5) * rd.len;
        const j = (r() - 0.5) * 1.6;
        pts.push({ x: rd.cx + nx * (off + j) + hx * f, z: rd.cz + nz * (off + j) + hz * f });
      }
      stroke(pts, off === 0 ? 9 : 2.4, off === 0 ? 'rgba(88,80,66,0.16)' : 'rgba(58,52,44,0.42)', off === 0 ? 6 : 1);
    }
  }

  // ⑤ E 連散兵坑線:一排翻土暗斑＋濺出的雪唇(位置與實際散兵坑對齊)
  for (const hx of holeXs) {
    const z = 1 + (r() - 0.5) * 5;
    soft(hx, z, 9, 'rgba(226,234,242,0.42)');       // 濺出的淺雪唇
    soft(hx, z, 4.6, 'rgba(62,54,44,0.5)');          // 翻土
    soft(hx, z - 3.2, 3.0, 'rgba(48,42,34,0.34)');   // 面北胸牆前的踏平區
    for (let k = 0; k < 5; k++) {                     // 坑周圍的踩踏
      soft(hx + (r() - 0.5) * 22, z + (r() - 0.5) * 16, 2 + r() * 3, 'rgba(120,112,96,0.16)');
    }
  }

  // ⑥ 戰線前緣的彈坑(北面開闊雪原,德軍砲擊的 beaten zone)
  for (let i = 0; i < 54; i++) {
    const x = -320 + r() * 640;
    const z = -140 + r() * 150;
    const rad = 2.4 + r() * 5;
    soft(x, z, rad * 2.3, 'rgba(222,232,240,0.42)');
    soft(x, z, rad, `rgba(46,40,34,${0.45 + r() * 0.3})`);
  }
  // 森林裡的空爆落點(樹爆:雪面上一圈木屑與髒雪)
  for (let i = 0; i < 30; i++) {
    const x = -280 + r() * 560;
    const z = 4 + r() * 90;
    soft(x, z, 6 + r() * 7, `rgba(84,66,44,${0.16 + r() * 0.14})`);
  }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}
