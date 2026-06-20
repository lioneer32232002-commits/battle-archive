// 十字路口地形 — 荷蘭「島區」（de Betuwe）的圩田、下萊茵河河堤、堤路十字路口、
// 渡口磚廠與風車、堤北的萊茵河與德軍踞守的北岸高地。
// 地形邏輯（本役招牌手法）：河堤是主角 —— 南側溝渠可隱蔽接近，登上堤頂瞬間暴露，
//   堤南是一片無遮蔽的開闊圩田（被北岸高地俯瞰），渡河德軍背水而陣。
// 註：河堤高度／尺度刻意放大以利辨識（真實約 6–7 公尺）；圩田開闊度為可讀性優先。
import * as THREE from 'three';

// 田畝貼圖（圩田作物：胡蘿蔔／甜菜／甘藍的條紋拼布，秋季偏暗）
function makeFieldTexture(base, stripe, angleDeg) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.save();
  g.translate(64, 64); g.rotate((angleDeg * Math.PI) / 180); g.translate(-180, -180);
  g.strokeStyle = stripe; g.lineWidth = 2.2;
  for (let y = 0; y < 360; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(360, y); g.stroke(); }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = 4;
  return t;
}

export function createCrossroadsTerrain(scene) {
  const g = new THREE.Group();

  const grassMat = new THREE.MeshLambertMaterial({ color: 0x5d6f3c });   // 堤面草坡（秋）— 比圩田亮，凸顯堤體
  const grassDark = new THREE.MeshLambertMaterial({ color: 0x3d4a2b });
  const dikeEarth = new THREE.MeshLambertMaterial({ color: 0x6a5a3c });  // 堤腳土帶（界定堤體基線）
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x53504a });    // 濕瀝青堤路
  const ditchMat = new THREE.MeshLambertMaterial({ color: 0x2b3220 });   // 排水溝（掩蔽接近）
  const earthMat = new THREE.MeshLambertMaterial({ color: 0x5e5236 });
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x36434c, transparent: true, opacity: 0.92 }); // 冷灰下萊茵河
  const bankMat = new THREE.MeshLambertMaterial({ color: 0x404a30 });    // 北岸德軍高地
  const brick = new THREE.MeshLambertMaterial({ color: 0x7c4838 });
  const brickDark = new THREE.MeshLambertMaterial({ color: 0x633a2c });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xa89c82 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a4436 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6a5436 });
  const wireMat = new THREE.MeshLambertMaterial({ color: 0x2a2a26 });

  const texCrop = makeFieldTexture('#586a3a', '#495a30', 16);   // 作物田
  const texBeet = makeFieldTexture('#635d3c', '#514c34', -24);  // 翻土／甜菜
  const texMeadow = makeFieldTexture('#516238', '#43522e', -6); // 草地

  // ── 圩田（鋪地表，堤防與單位疊其上） ──────────────────────
  function field(cx, cz, w, d, tex, rotY = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rotY;
    m.position.set(cx, 0.1, cz); g.add(m);
  }

  function box(w, h, d, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
  }

  // 圩田拼布（堤南為主戰場開闊地；西為連 CP 方向；零星翻土）
  field(0, 24, 260, 78, texCrop, 0.04);     // 主戰場：堤南開闊圩田（衝鋒越過處）
  field(-150, 30, 150, 96, texMeadow, 0.05);// 西鄰（蘭德韋克方向）
  field(150, 24, 140, 80, texBeet, -0.06);  // 東鄰（赫特倫方向）
  field(0, 70, 280, 60, texMeadow, 0.0);    // 南側縱深

  // ── 下萊茵河（堤北）＋北岸德軍高地 ───────────────────────
  const river = new THREE.Mesh(new THREE.PlaneGeometry(1100, 150), waterMat);
  river.rotation.x = -Math.PI / 2; river.position.set(0, 0.06, -92); g.add(river);
  // 北岸高地（德軍火砲俯瞰島區的高地）
  const farBank = new THREE.Mesh(new THREE.BoxGeometry(1100, 4, 120), bankMat);
  farBank.position.set(0, 2, -188); g.add(farBank);
  for (let i = 0; i < 14; i++) {                     // 北岸樹線
    const t = new THREE.Mesh(new THREE.SphereGeometry(5 + (i % 3) * 2, 7, 6), grassDark);
    t.position.set(-360 + i * 56, 5, -150 + (i % 2) * 10); t.scale.y = 1.4; g.add(t);
  }

  // ── 河堤（本役主角：梯形斷面、堤頂有路、南北有坡） ──────────
  // 以梯形斷面沿 X 擠出；rotation.y 把擠出軸轉到世界 X（沿河東西向）。
  const DIKE_LEN = 460, DIKE_Z = -16, DIKE_H = 4.4;
  const sec = new THREE.Shape();
  sec.moveTo(-5.2, 0); sec.lineTo(5.2, 0); sec.lineTo(2.2, DIKE_H); sec.lineTo(-2.2, DIKE_H); sec.closePath();
  const dikeGeo = new THREE.ExtrudeGeometry(sec, { depth: DIKE_LEN, bevelEnabled: false });
  const dike = new THREE.Mesh(dikeGeo, grassMat);
  dike.rotation.y = -Math.PI / 2;
  dike.position.set(DIKE_LEN / 2, 0, DIKE_Z); // 擠出軸映射到 -X，置中後沿 X 展開
  g.add(dike);
  // 堤腳土帶（南北各一條，界定堤體基線、增加立體感）
  box(DIKE_LEN, 0.7, 1.6, dikeEarth, 0, 0.34, DIKE_Z + 4.6);
  box(DIKE_LEN, 0.7, 1.6, dikeEarth, 0, 0.34, DIKE_Z - 4.6);
  // 堤頂瀝青路
  box(DIKE_LEN, 0.26, 3.8, roadMat, 0, DIKE_H + 0.12, DIKE_Z);
  // 堤北腳的排水溝（溫特斯的掩蔽接近路線）
  box(DIKE_LEN, 0.5, 1.7, ditchMat, 0, 0.18, DIKE_Z - 6.0);

  // ── 渡船道（南北向，跨越河堤的十字路口） ───────────────────
  box(4, 0.2, 84, roadMat, 0, 0.16, 28);       // 堤南段（深入圩田）
  box(4, 0.2, 12, roadMat, 0, 0.16, DIKE_Z - 8); // 堤北段（通往渡口）
  box(7.5, 0.3, 5.5, roadMat, 0, DIKE_H + 0.14, DIKE_Z); // 堤頂十字路口路面

  // ── 渡口與磚廠（德軍夜渡的登陸點，堤北近河） ────────────────
  box(3.2, 0.4, 14, woodMat, 0, 0.22, -30);    // 渡口棧橋
  box(16, 6, 9, brick, 16, 3, -34);            // 磚廠主廠房
  box(20, 4.5, 7, brickDark, 16, 2.25, -42, 0.2);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 16, 12), brickDark);
  chimney.position.set(8, 8, -38); g.add(chimney);

  // ── 風車（堤北近河的地標；德軍次波連據此） ─────────────────
  (function windmill(x, z) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 11, 12), stoneMat);
    tower.position.set(x, 5.5, z); g.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3.2, 12), roofMat);
    cap.position.set(x, 12.4, z); g.add(cap);
    const hub = new THREE.Group(); hub.position.set(x, 11, z + 2.8);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 10, 0.25), woodMat);
      blade.position.y = 5; arm.add(blade);
      hub.add(arm);
    }
    g.add(hub);
  })(40, -28);

  // ── 前哨建物（巡邏隊奉命佔領的堤邊房舍） ───────────────────
  function farmhouse(x, z, w, d, h, rot = 0) {
    box(w, h, d, stoneMat, x, h / 2, z, rot);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.5, h * 0.7, 4), roofMat);
    roof.position.set(x, h + h * 0.34, z); roof.rotation.y = rot + Math.PI / 4; g.add(roof);
  }
  farmhouse(30, -9, 7, 6, 4, 0.2);     // 堤南前哨房舍
  farmhouse(-92, 32, 9, 7, 5, 0.3);    // 蘭德韋克方向農舍
  farmhouse(-72, 52, 7, 6, 4.2, -0.2);

  // ── 圩田排水溝（縱橫切割開闊地：地形邏輯的細節） ───────────
  for (const x of [-46, -14, 22, 58]) box(1.3, 0.4, 76, ditchMat, x, 0.16, 24);
  for (const z of [6, 40]) box(180, 0.4, 1.3, ditchMat, 6, 0.16, z);

  // ── 低矮鐵絲網（堤前障礙：皮考克左翼即受阻於此） ───────────
  for (let x = -16; x <= 30; x += 6) box(0.18, 1.0, 0.18, wireMat, x, 0.5, -4);
  for (let yk = 0; yk < 2; yk++) {
    const wire = new THREE.Mesh(new THREE.BoxGeometry(48, 0.05, 0.05), wireMat);
    wire.position.set(7, 0.4 + yk * 0.4, -4); g.add(wire);
  }

  // ── 零星樹叢（圩田邊、農舍旁；非衝鋒開闊地） ───────────────
  for (const p of [[-100, 24], [-80, 44], [-60, 60], [120, 30], [96, 12]]) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 1.6, 7, 6), Math.random() > 0.5 ? grassDark : grassMat);
    t.position.set(p[0], 3.4, p[1]); t.scale.y = 1.3; g.add(t);
  }

  scene.add(g);

  const places = [
    { name: '下萊茵河 Nederrijn', side: 'neutral', pos: { x: -50, y: 9, z: -64 } },
    { name: '河堤・十字路口', side: 'neutral', pos: { x: -34, y: 7, z: -16 } },
    { name: '蘭德韋克（連 CP）Randwijk', side: 'blue', pos: { x: -118, y: 8, z: 22 } },
    { name: '赫特倫 Heteren', side: 'neutral', pos: { x: 118, y: 8, z: 12 } },
    { name: '渡口・磚廠', side: 'red', pos: { x: 14, y: 9, z: -44 } },
    { name: '風車', side: 'neutral', pos: { x: 40, y: 16, z: -28 } },
  ];

  return { group: g, places };
}
