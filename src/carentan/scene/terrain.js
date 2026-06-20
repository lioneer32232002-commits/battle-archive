// 卡倫坦地形 — 諾曼第小鎮：市鎮街廓（含 Y 形路口的封街房舍）、
// 北面杜沃氾濫沼澤與 N13 高架堤道（紫心巷，502 團的）、貫穿西南的鐵路路堤（血腥溝 E 連死守處）、
// 西南的樹籬 bocage 圩田與 30 高地、佩里耶／博特公路。
// 地形邏輯（招牌手法）：①市鎮斜街成「死亡漏斗」（MG42 縱射）②堤道是無掩蔽瓶頸（紫心巷）
//   ③鐵路路堤＝天然胸牆（血腥溝 E 連背靠死守）④樹籬土堤每道邊都是射擊掩體。
// 註：尺度為可讀性放大；夏日諾曼第（6 月）偏暖綠。
// 座標：1 單位 = 10 公尺；原點 = 市鎮南緣路口；北 = -z（沼澤／堤道）、西南 = -x／+z（樹籬／血腥溝）。
import * as THREE from 'three';

// 田畝貼圖（夏季諾曼第：青綠／麥黃／翻土的條紋拼布）
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

export function createCarentanTerrain(scene) {
  const g = new THREE.Group();

  const grassMat = new THREE.MeshLambertMaterial({ color: 0x5f7536 });   // 夏草
  const grassDark = new THREE.MeshLambertMaterial({ color: 0x46582e });
  const bankMat = new THREE.MeshLambertMaterial({ color: 0x6a5a3c });    // 樹籬／路堤土堤
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x6b6253 });    // 土路／鋪石街
  const ditchMat = new THREE.MeshLambertMaterial({ color: 0x33402a });
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x47574c, transparent: true, opacity: 0.9 }); // 杜沃沼澤
  const plaster = new THREE.MeshLambertMaterial({ color: 0xccbd9c });    // 諾曼第灰泥牆
  const plaster2 = new THREE.MeshLambertMaterial({ color: 0xb8a982 });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xa89c82 });
  const roofTile = new THREE.MeshLambertMaterial({ color: 0x7a4736 });   // 紅瓦
  const roofSlate = new THREE.MeshLambertMaterial({ color: 0x55565a });  // 石板
  const shutter = new THREE.MeshLambertMaterial({ color: 0x4d6750 });    // 綠百葉
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5a4127 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3e });
  const ballast = new THREE.MeshLambertMaterial({ color: 0x5a4f3c });

  const texCrop = makeFieldTexture('#5f7536', '#4e6230', 16);
  const texWheat = makeFieldTexture('#8a8340', '#736b30', -22);
  const texMeadow = makeFieldTexture('#566a32', '#46582a', -6);

  function box(w, h, d, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
  }
  function field(cx, cz, w, d, tex, rotY = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rotY;
    m.position.set(cx, 0.1, cz); g.add(m);
  }

  // ── 地表拼布（市鎮南／西南圩田＝主戰場；夏季暖綠） ──────────
  field(-20, 50, 240, 150, texMeadow, 0.04);    // 西南開闊圩田（突入路線＋血腥溝）
  field(-130, 110, 180, 150, texCrop, -0.05);   // 30 高地一帶
  field(70, 40, 130, 150, texWheat, 0.05);      // 東鄰麥田
  field(0, -40, 180, 90, texCrop, 0.0);         // 市鎮基底

  // ── 北面：杜沃／馬德蓮氾濫沼澤 + N13 高架堤道（紫心巷，502 團的） ──
  const marsh = new THREE.Mesh(new THREE.PlaneGeometry(900, 230), waterMat);
  marsh.rotation.x = -Math.PI / 2; marsh.position.set(0, 0.06, -180); g.add(marsh);
  for (const p of [[-120, -150], [40, -200], [150, -160], [-30, -230]]) { // 沼澤露出的草洲
    const r = new THREE.Mesh(new THREE.PlaneGeometry(60 + Math.random() * 40, 30), new THREE.MeshLambertMaterial({ color: 0x4f5e34 }));
    r.rotation.x = -Math.PI / 2; r.position.set(p[0], 0.12, p[1]); g.add(r);
  }
  // N13 堤道：自市鎮北緣（z≈-55）筆直北伸，高出水面，四座小橋
  box(6, 2.2, 150, bankMat, 26, 1.1, -150);     // 堤體
  box(5, 0.3, 150, roadMat, 26, 2.3, -150);     // 堤頂路面
  for (let i = 0; i < 4; i++) box(7, 1.0, 7, stoneMat, 26, 1.0, -90 - i * 34); // 四座石橋墩
  for (let i = 0; i < 9; i++) box(0.5, 2.6, 0.5, woodMat, 23.4, 1.3, -78 - i * 17); // 護欄柱（西側）

  // ── 市鎮（諾曼第小鎮街廓） ────────────────────────────
  // 諾曼第農舍／街屋：灰泥牆 + 山牆瓦頂 + 臨街百葉窗
  function house(w, d, h, wall, roof, shutters) {
    const grp = new THREE.Group();
    grp.add(setpos(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall), 0, h / 2, 0));
    // 山牆屋頂（三角斷面，沿 +z 擠出）
    const s = new THREE.Shape(); const rh = h * 0.5;
    s.moveTo(-w / 2 * 1.05, 0); s.lineTo(w / 2 * 1.05, 0); s.lineTo(0, rh); s.closePath();
    const roofMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: d * 1.02, bevelEnabled: false }), roof);
    roofMesh.position.set(0, h, -d * 0.51); grp.add(roofMesh);
    if (shutters) {
      for (const sx of [-w * 0.28, w * 0.28]) {
        for (const sy of [h * 0.62, h * 0.3]) {
          grp.add(setpos(new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, h * 0.2, 0.2), shutter), sx, sy, d / 2 + 0.02));
        }
      }
      grp.add(setpos(new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h * 0.42, 0.2), woodMat), 0, h * 0.21, d / 2 + 0.02)); // 門
    }
    return grp;
  }
  function setpos(m, x, y, z) { m.position.set(x, y, z); return m; }
  function placeHouse(x, z, rot, w, d, h, wall, roof, shutters = true) {
    const hh = house(w, d, h, wall, roof, shutters);
    hh.position.set(x, 0, z); hh.rotation.y = rot; g.add(hh); return hh;
  }

  // 主街沿 z 軸（南緣路口 → 鎮中心 → 北）；房舍夾街分佈
  box(7, 0.2, 70, roadMat, 0, 0.16, -20);        // 主街
  box(34, 0.2, 7, roadMat, -8, 0.16, 6);         // 橫街（Y 形路口的另一臂）
  // 街東排屋
  placeHouse(14, -2, -Math.PI / 2, 12, 9, 6, plaster, roofTile);
  placeHouse(16, -16, -Math.PI / 2, 14, 9, 6.5, plaster2, roofSlate);
  placeHouse(15, -30, -Math.PI / 2, 12, 8, 6, plaster, roofTile);
  // 街西排屋
  placeHouse(-14, -6, Math.PI / 2, 12, 9, 6, plaster2, roofSlate);
  placeHouse(-15, -20, Math.PI / 2, 13, 9, 6.5, plaster, roofTile);
  placeHouse(-14, -34, Math.PI / 2, 11, 8, 5.5, plaster2, roofSlate);
  // Café du Stade — Y 形路口街頭、藏 MG42 的二層街屋（醒目、偏高）
  const cafe = placeHouse(8, 9, Math.PI, 12, 10, 8.5, plaster, roofTile);
  box(2.0, 1.4, 0.3, ditchMat, 6.8, 6.2, 3.6);   // 二樓窗口（MG 射孔，朝南街）

  // 教堂（諾曼第小鎮地標：石塔 + 尖頂）
  placeHouse(-22, -26, 0, 14, 22, 9, stoneMat, roofSlate, false);
  box(7, 18, 7, stoneMat, -22, 9, -38);          // 鐘塔
  const spire = new THREE.Mesh(new THREE.ConeGeometry(5.2, 9, 4), roofSlate);
  spire.position.set(-22, 22.5, -38); spire.rotation.y = Math.PI / 4; g.add(spire);

  // ── 鐵路（巴黎–瑟堡線）：貫穿西南的路堤＝血腥溝 E 連死守處 ──
  // 自市鎮東北向西南斜貫；路堤抬高、頂上鋪枕木與雙軌。
  const RAIL_ANG = Math.PI * 0.72;               // 西南–東北走向
  function railSeg(cx, cz) {
    box(12, 1.6, 9, bankMat, cx, 0.8, cz, RAIL_ANG);   // 路堤段
    box(11, 0.3, 6.2, ballast, cx, 1.65, cz, RAIL_ANG); // 道碴
  }
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const cx = 24 + (-150 - 24) * t;             // (24,-34) → (-150,96)
    const cz = -34 + (96 - -34) * t;
    railSeg(cx, cz);
  }
  // 雙軌（兩條細鋼條沿線）
  for (const off of [-1.6, 1.6]) {
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const cx = 24 + (-150 - 24) * t + Math.cos(RAIL_ANG) * 0; // 軌沿線
      const cz = -34 + (96 - -34) * t;
      box(0.3, 0.3, 5.0, railMat, cx + off * Math.sin(RAIL_ANG), 1.85, cz - off * Math.cos(RAIL_ANG), RAIL_ANG);
    }
  }

  // ── 樹籬 bocage（西南圩田邊界：土堤 + 樹叢；每道邊都是掩體） ──
  function hedge(x, z, len, rot) {
    box(len, 1.2, 1.8, bankMat, x, 0.6, z, rot);   // 土堤
    const n = Math.max(3, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const o = (i / (n - 1) - 0.5) * len;
      const bush = new THREE.Mesh(new THREE.SphereGeometry(2.4 + Math.random() * 1.2, 7, 6), Math.random() > 0.5 ? grassDark : grassMat);
      bush.position.set(x + Math.cos(rot) * o, 2.2, z - Math.sin(rot) * o); bush.scale.y = 1.5; g.add(bush);
    }
  }
  hedge(-70, 30, 80, 0.1);
  hedge(-110, 70, 90, 0.3);
  hedge(-50, 84, 70, -0.2);
  hedge(-150, 50, 70, 1.3);
  hedge(-30, 110, 90, 0.05);
  hedge(-95, 130, 80, 0.2);

  // ── 30 高地（鎮西南的低緩隆起；置於德軍進攻走廊「之外」的西側，作背景高地，
  //    避免單位行經時被山體擋住、像躲進地洞） ─────────────────────
  const hill = new THREE.Mesh(new THREE.SphereGeometry(56, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), grassMat);
  hill.scale.set(1, 0.1, 1); hill.position.set(-210, -0.5, 80); g.add(hill);

  // ── 佩里耶／博特公路（自西南通入市鎮；德軍反撲來向） ──────────
  box(5, 0.2, 200, roadMat, 0, 0.15, 0, -0.72);   // 斜貫西南–市鎮的土路

  // ── 零星樹叢（圩田邊、農舍旁） ───────────────────────────
  for (const p of [[40, 70], [-180, 90], [60, -10], [-40, 140], [100, 50]]) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(3.2 + Math.random() * 1.6, 7, 6), Math.random() > 0.5 ? grassDark : grassMat);
    t.position.set(p[0], 3.4, p[1]); t.scale.y = 1.4; g.add(t);
  }

  scene.add(g);

  const places = [
    { name: '卡倫坦市鎮 Carentan', side: 'neutral', pos: { x: -2, y: 12, z: -22 } },
    { name: 'Y 形路口（MG42 封街）', side: 'red', pos: { x: 10, y: 9, z: 12 } },
    { name: 'N13 堤道・紫心巷（502 團）', side: 'neutral', pos: { x: 26, y: 6, z: -120 } },
    { name: '杜沃氾濫沼澤', side: 'neutral', pos: { x: -90, y: 5, z: -170 } },
    { name: '鐵路路堤・血腥溝', side: 'blue', pos: { x: -64, y: 6, z: 60 } },
    { name: '30 高地', side: 'red', pos: { x: -205, y: 9, z: 80 } },
  ];

  return { group: g, places };
}
