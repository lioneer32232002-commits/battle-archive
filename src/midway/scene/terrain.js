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
import * as THREE from 'three';

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
function makeAtollTexture(size) {
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
  tex.anisotropy = 8;
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
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6d5a3f });

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
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f7a34 });

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
  const atoll = new THREE.Group();
  atoll.position.y = LIFT;

  const tex = makeAtollTexture(opts.mobile ? 1024 : 2048);

  // 水下基座:不透明,自礁盤往下延伸沒入海中,遮住島與海面之間的縫
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(138, 162, 34, 56),
    new THREE.MeshLambertMaterial({ color: 0x0e2c3e })
  );
  base.position.y = -17;
  atoll.add(base);

  // 礁盤圓盤:CircleGeometry 的 uv 已是 (x/2R+0.5, y/2R+0.5),旋轉後恰好對上世界座標貼圖
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(DISC_R, 96),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.35;
  disc.receiveShadow = shadows;
  atoll.add(disc);

  // 兩座島的立體量體:頂面共用同一張貼圖(擠出 cap 的 uv = shape 座標,以 repeat/offset 對位)
  atoll.add(island(SAND_PTS, tex, 0xe4d9b4, shadows));
  atoll.add(island(EAST_PTS, tex, 0xdccfa6, shadows));

  // 椰子樹叢
  for (const m of makePalms(opts.mobile ? 30 : 56, shadows)) atoll.add(m);

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

  const mesh = new THREE.Mesh(geo, [
    new THREE.MeshLambertMaterial({ map: top }),          // group 0:上下端蓋
    new THREE.MeshLambertMaterial({ color: sideColor }),  // group 1:側壁(沙岸)
  ]);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.4;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}
