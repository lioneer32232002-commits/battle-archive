// 中途島環礁:礁盤、潟湖、沙島(西)與東島(機場)
// 注意:海面波浪振幅約 5.7 單位,環礁須抬到浪峰之上並用不透明材質,
//       否則礁盤圈會與海面 z-fighting 產生破圖閃爍;水下基座填補島與海面的縫。
//
// N-8 升級:礁盤／潟湖／沙島／跑道全部畫進一張 canvas 俯視貼圖(外礁白沫線、礁盤淺綠到潟湖
//   深綠藍漸層、沙島沙色帶植被斑、跑道深灰帶＋白色虛線中線),礁盤圓盤與兩座島的頂面共用
//   這張貼圖(以世界座標對位),再撒一小叢 InstancedMesh 椰子樹。
//
// 座標換算備忘:島嶼用 Shape 擠出後 rotation.x = -π/2,故 shape 的 (a, b) 落在世界 (a, ·, -b)。
//   貼圖一律以「世界座標」作圖,島嶼輪廓畫在 (a, -b)。
//
// 資產管線(docs/asset-pipeline-spec.md §3):
//   A-4 沙島與礁盤改 MeshStandardMaterial,套 Poly Haven sand_01／coast_sand_01 的
//       PBR:程序化俯視貼圖(礁盤漸層、跑道、彈坑、植被斑)留著當 macro 層,
//       細節層用 onBeforeCompile 在 map_fragment 之後「除以自身平均值再相乘」疊上去
//       — 只加顆粒與明暗,不改 macro 的顏色計畫。沙岸側壁直接用 sand 的 diff。
import * as THREE from 'three';
import { createDetailUv } from './detail-shader.js';

const LIFT = 7;     // 抬升量(高於浪峰)
const DISC_R = 150; // 礁盤貼圖圓盤半徑(場景單位)

// 島嶼輪廓(Shape 座標);世界座標為 (x, -y)
const SAND_PTS = [[-72, 18], [-42, 2], [-18, 8], [-14, 30], [-34, 46], [-66, 42]];
const EAST_PTS = [[18, 38], [58, 28], [72, 46], [52, 66], [22, 60]];
// 東島三條交叉跑道(世界座標中心與 y 軸旋轉角)
const RUNWAYS = [
  { cx: 45, cz: -46, len: 44, w: 5, rot: 0.35 },
  { cx: 45, cz: -46, len: 38, w: 5, rot: -0.6 },
  { cx: 45, cz: -46, len: 32, w: 5, rot: 1.45 },
];

// 可重現的偽隨機
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 礁盤俯視貼圖 ─────────────────────────────────────
// 涵蓋世界座標 ±DISC_R 的方形;canvas x = 世界 x、canvas y = 世界 z(皆經 px() 換算)
function makeAtollTexture(size, anisotropy = 8) {
  const S = size;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = mulberry(2942);
  const px = (u) => (u / DISC_R) * (S / 2) + S / 2;
  const pr = (r) => (r / DISC_R) * (S / 2);

  g.fillStyle = '#0b2c40';
  g.fillRect(0, 0, S, S);

  // 外礁斜坡:青綠 → 深藍
  const slope = g.createRadialGradient(S / 2, S / 2, pr(112), S / 2, S / 2, pr(150));
  slope.addColorStop(0, '#3fb9a6');
  slope.addColorStop(0.35, '#1c7f96');
  slope.addColorStop(1, '#0b2c40');
  g.fillStyle = slope;
  g.beginPath(); g.arc(S / 2, S / 2, pr(150), 0, Math.PI * 2); g.fill();

  // 礁盤:淺綠松石
  const reef = g.createRadialGradient(S / 2, S / 2, pr(74), S / 2, S / 2, pr(126));
  reef.addColorStop(0, '#63d6bd');
  reef.addColorStop(0.7, '#45c4ac');
  reef.addColorStop(1, '#2fa899');
  g.fillStyle = reef;
  g.beginPath(); g.arc(S / 2, S / 2, pr(126), 0, Math.PI * 2); g.fill();

  // 礁盤上的珊瑚斑駁
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const r = 76 + rand() * 48;
    g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(10,60,70,0.13)';
    g.beginPath();
    g.arc(px(Math.cos(a) * r), px(Math.sin(a) * r), pr(0.7 + rand() * 3.4), 0, Math.PI * 2);
    g.fill();
  }

  // 外礁白沫線(碎浪帶)
  g.lineWidth = pr(4.0);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  for (let i = 0; i <= 240; i++) {
    const a = (i / 240) * Math.PI * 2;
    const r = 124 + Math.sin(a * 7.3) * 2.4 + Math.sin(a * 17.1) * 1.3 + (rand() - 0.5) * 1.6;
    const x = px(Math.cos(a) * r), y = px(Math.sin(a) * r);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.lineWidth = pr(9);
  g.strokeStyle = 'rgba(255,255,255,0.20)';
  g.stroke();

  // 潟湖:外圈淺綠藍 → 中央深綠藍
  const lag = g.createRadialGradient(S / 2, S / 2, pr(4), S / 2, S / 2, pr(80));
  lag.addColorStop(0, '#0f6f92');
  lag.addColorStop(0.55, '#1b8ba8');
  lag.addColorStop(1, '#37b3b6');
  g.fillStyle = lag;
  g.beginPath(); g.arc(S / 2, S / 2, pr(80), 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 220; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 78;
    g.fillStyle = `rgba(120,220,215,${(0.05 + rand() * 0.12).toFixed(3)})`;
    g.beginPath();
    g.ellipse(px(Math.cos(a) * r), px(Math.sin(a) * r), pr(2 + rand() * 9), pr(1.5 + rand() * 5), rand() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // 沙島與東島:白沙灘外框 ＋ 沙色底 ＋ 植被斑
  const drawIsland = (pts) => {
    let cx = 0, cz = 0;
    g.beginPath();
    pts.forEach((p, i) => {
      const x = px(p[0]), y = px(-p[1]);
      cx += p[0]; cz += -p[1];
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    cx /= pts.length; cz /= pts.length;
    g.closePath();
    g.lineWidth = pr(6);
    g.strokeStyle = 'rgba(255,252,238,0.92)';
    g.stroke();
    g.fillStyle = '#ded2ab';
    g.fill();
    g.save();
    g.clip();
    for (let i = 0; i < 420; i++) {
      const x = px(cx + (rand() - 0.5) * 90);
      const y = px(cz + (rand() - 0.5) * 90);
      g.fillStyle = rand() > 0.45
        ? `rgba(74,104,52,${(0.20 + rand() * 0.42).toFixed(3)})`
        : `rgba(196,183,140,${(0.25 + rand() * 0.35).toFixed(3)})`;
      g.beginPath();
      g.ellipse(x, y, pr(1.6 + rand() * 6), pr(1.2 + rand() * 4), rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };
  drawIsland(SAND_PTS);
  drawIsland(EAST_PTS);

  // 東島機場:停機坪 → 跑道深灰帶 ＋ 白色虛線中線
  g.fillStyle = 'rgba(92,90,84,0.9)';
  g.fillRect(px(28), px(-56), pr(15), pr(6));
  for (const r of RUNWAYS) {
    g.save();
    g.translate(px(r.cx), px(r.cz));
    g.rotate(-r.rot); // 3D 繞 +y 轉 rot,俯視圖為反向
    g.fillStyle = '#4a4a48';
    g.fillRect(-pr(r.len / 2), -pr(r.w / 2), pr(r.len), pr(r.w));
    g.fillStyle = 'rgba(0,0,0,0.20)';
    g.fillRect(-pr(r.len / 2), -pr(r.w / 2), pr(r.len), pr(0.9));
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(-pr(r.len / 2), pr(r.w / 2 - 0.7), pr(r.len), pr(0.7));
    g.strokeStyle = 'rgba(242,242,236,0.9)';
    g.lineWidth = Math.max(1, pr(0.55));
    g.setLineDash([pr(2.6), pr(2.2)]);
    g.beginPath(); g.moveTo(-pr(r.len / 2 - 2.5), 0); g.lineTo(pr(r.len / 2 - 2.5), 0); g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  // 彈坑(6/4 上午友永隊轟炸中途島)
  for (let i = 0; i < 26; i++) {
    const x = px(20 + rand() * 56);
    const y = px(-62 + rand() * 32);
    g.fillStyle = `rgba(48,40,30,${(0.18 + rand() * 0.26).toFixed(3)})`;
    g.beginPath(); g.arc(x, y, pr(0.9 + rand() * 2.4), 0, Math.PI * 2); g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// ── 椰子樹(N-8):樹幹 ＋ 幾片下垂扁葉,兩個 InstancedMesh ──
function mergeSimple(geos) {
  let vc = 0;
  for (const g of geos) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const idx = [];
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < n; i++) idx.push(i + off);
    off += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

const _yAxis = new THREE.Vector3(0, 1, 0);
function makePalms(count, shadows) {
  const rand = mulberry(88);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.32, 4.4, 5);
  trunkGeo.translate(0, 2.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d5a3f, roughness: 0.9, metalness: 0.0 });

  const fronds = [];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.ConeGeometry(0.95, 3.6, 3);
    f.rotateX(Math.PI / 2);
    f.rotateZ(0.6);
    f.rotateY((i / 6) * Math.PI * 2);
    f.translate(0, 4.5, 0);
    fronds.push(f);
  }
  const crownGeo = mergeSimple(fronds);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f7a34, roughness: 0.85, metalness: 0.0 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  trunks.castShadow = shadows;
  crowns.castShadow = shadows;

  // 世界座標:沙島中心約 (-44, -26)、東島中心約 (44, -46)
  const spots = [
    { cx: -44, cz: -26, rx: 23, rz: 14 },
    { cx: 46, cz: -44, rx: 21, rz: 12 },
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const sp = spots[i % spots.length];
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    p.set(sp.cx + Math.cos(a) * sp.rx * r, 3.5, sp.cz + Math.sin(a) * sp.rz * r);
    q.setFromAxisAngle(_yAxis, rand() * Math.PI * 2);
    const sc = 0.8 + rand() * 0.6;
    s.set(sc, sc * (0.85 + rand() * 0.4), sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  return [trunks, crowns];
}

export function createMidwayAtoll(scene, opts = {}) {
  const shadows = !!opts.shadows;
  // R5 畫質分級:俯視貼圖解析度與椰子樹棵數吃參數,不再各自讀 isMobile
  const q = {
    atollTexture: opts.mobile ? 1024 : 2048,
    palms: opts.mobile ? 30 : 56,
    anisotropy: opts.mobile ? 4 : 8,
    ...(opts.quality ?? {}),
  };
  const atoll = new THREE.Group();
  atoll.position.y = LIFT;

  const tex = makeAtollTexture(q.atollTexture, q.anisotropy);

  // 水下基座:不透明,自礁盤往下延伸沒入海中,遮住島與海面之間的縫
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(138, 162, 34, 56),
    new THREE.MeshStandardMaterial({ color: 0x0e2c3e, roughness: 0.9, metalness: 0.0 })
  );
  base.position.y = -17;
  atoll.add(base);

  // 礁盤圓盤:CircleGeometry 的 uv 已是 (x/2R+0.5, y/2R+0.5),旋轉後恰好對上世界座標貼圖
  const discMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 });
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(DISC_R, 96),
    discMat
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.35;
  disc.receiveShadow = shadows;
  atoll.add(disc);

  // 兩座島的立體量體:頂面共用同一張貼圖(擠出 cap 的 uv = shape 座標,以 repeat/offset 對位)
  const isleA = island(SAND_PTS, tex, 0xe4d9b4, shadows);
  const isleB = island(EAST_PTS, tex, 0xdccfa6, shadows);
  atoll.add(isleA);
  atoll.add(isleB);

  // 椰子樹叢
  for (const m of makePalms(Math.max(0, Math.round(q.palms)), shadows)) atoll.add(m);

  // A-4:真實沙地 PBR(非阻塞;沒到就是原本的程序化貼圖)
  if (opts.assets) applySandPBR(opts.assets, [isleA, isleB], discMat);

  scene.add(atoll);
  return atoll;
}

function island(points, tex, sideColor, shadows) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: true, bevelSize: 3, bevelThickness: 1.5, bevelSegments: 2 });

  // cap 的 uv = shape 的 (x, y);世界 z = -y → u = x/2R+0.5、v = y/2R+0.5
  const top = tex.clone();
  top.needsUpdate = true;
  top.repeat.set(1 / (2 * DISC_R), 1 / (2 * DISC_R));
  top.offset.set(0.5, 0.5);

  // cap 的 uv 單位就是場景單位(shape 座標),故細節層 repeat 用「每 2.6 單位一張」
  const topMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.95, metalness: 0.0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.96, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
  mesh.userData.sandMats = { top: topMat, side: sideMat, detailRep: 1 / 2.6 };
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.4;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}


// ── A-4:沙地 PBR ─────────────────────────────────────
// sand_01 diff 的 sRGB 平均為 (0.647, 0.586, 0.436) → 線性約 (0.387, 0.312, 0.165);
// 細節層先除以這組平均再乘回 macro,等於「只取明暗與顆粒、不帶自身色偏」。
const SAND_MEAN = [0.387, 0.312, 0.165];
const COAST_MEAN = [0.224, 0.169, 0.104]; // coast_sand_01 512 diff:sRGB (0.510, 0.448, 0.358)
// 註:SAND_MEAN 用的是 sand_01 512 diff 的線性平均(與 1k 版差異可忽略)

function applySandPBR(assets, isles, discMat) {
  // 島嶼:uv 單位 = 場景單位
  const isleRep = 1 / 2.6;
  // 只取 diff:sand_01 的 512 法線圖 170 KB,是整場首屏預算裡 CP 值最低的一項
  // (島嶼在常用鏡頭下佔比小),細節改由「macro × detail 相乘」提供顆粒。
  assets.textureSet('sand_01', { maps: ['diff'], repeat: [1, 1] }).then((set) => {
    if (!set.map) return;
    for (const isle of isles) {
      const { top, side } = isle.userData.sandMats;
      createDetailUv(top, set.map, [isleRep, isleRep], SAND_MEAN, 0.85);
      top.needsUpdate = true;
      // 沙岸側壁沒有 macro 層,直接用 sand 的 diff 當 map(uv 單位=場景單位,repeat 1 即每單位一張)
      side.map = set.map;
      side.color.setRGB(1.25, 1.2, 1.05); // 補回 diff 偏暗的部分,維持白沙灘調子
      side.needsUpdate = true;
    }
  });
  // 礁盤圓盤:uv 0…1 對應 300 場景單位 → 每 2.5 單位一張
  assets.textureSet('coast_sand_01', { maps: ['diff'], repeat: [1, 1] }).then((set) => {
    if (!set.map || !discMat) return;
    createDetailUv(discMat, set.map, [120, 120], COAST_MEAN, 0.55);
    discMat.needsUpdate = true;
  });
}
