// 布雷庫爾地形 — 諾曼第樹籬田(bocage)、犁溝田畝、四門砲塹壕與砲坑、莊園,
// 東側為德軍放水的氾濫低地、猶他灘 2 號堤道與海灘(供「同步時鐘」遠景)。
// 註:樹籬與單位尺度刻意放大,凸顯「每塊田都是一道牆」(可讀性優先)。
import * as THREE from 'three';

// 犁溝田畝貼圖(對角條紋模擬耕作紋理)
function makeFieldTexture(base, stripe, angleDeg) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.save();
  g.translate(64, 64); g.rotate((angleDeg * Math.PI) / 180); g.translate(-180, -180);
  g.strokeStyle = stripe; g.lineWidth = 2.4;
  for (let y = 0; y < 360; y += 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(360, y); g.stroke(); }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = 4;
  return t;
}

export function createBrecourtTerrain(scene) {
  const g = new THREE.Group();

  const earthMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3e });
  const earthLip = new THREE.MeshLambertMaterial({ color: 0x7c6a48 });
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3f5a2c });
  const bushMat2 = new THREE.MeshLambertMaterial({ color: 0x4a663a });
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x463923 });
  const trenchMat = new THREE.MeshLambertMaterial({ color: 0x2c2519 });
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x7a6f55 });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xb3a98e });
  const stoneMat2 = new THREE.MeshLambertMaterial({ color: 0x9c937a });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6e4a39 });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xc9b487 });

  const texGrass = makeFieldTexture('#5f7338', '#516229', 18);
  const texWheat = makeFieldTexture('#9a8f4e', '#867c40', -28);
  const texPlow = makeFieldTexture('#6b5a3c', '#574931', 64);
  const texMeadow = makeFieldTexture('#56713a', '#48602f', -8);

  // ── 田畝(犁溝拼布,鋪在樹籬圍出的田裡) ─────────────────
  function field(cx, cz, w, d, tex, rotY = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rotY;
    m.position.set(cx, 0.12, cz); g.add(m);
  }

  // ── 樹籬(土堤 + 灌木,lush 時加不規則灌木叢) ────────────
  function hedgerow(x1, z1, x2, z2, lush = false) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const bank = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.6, len), earthMat);
    bank.position.set(cx, 0.8, cz); bank.rotation.y = ang; g.add(bank);
    const veg = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, len + 1), bushMat);
    veg.position.set(cx, 2.4, cz); veg.rotation.y = ang; g.add(veg);
    if (lush) {
      const n = Math.max(2, Math.floor(len / 12));
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const px = x1 + dx * f, pz = z1 + dz * f;
        const r = 1.9 + Math.random() * 1.4;
        const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), Math.random() > 0.5 ? bushMat : bushMat2);
        blob.position.set(px + (Math.random() - 0.5) * 1.5, 3.4 + Math.random() * 0.8, pz + (Math.random() - 0.5) * 1.5);
        blob.scale.y = 0.85;
        g.add(blob);
      }
    }
  }

  function trench(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, len), trenchMat);
    t.position.set((x1 + x2) / 2, 0.28, (z1 + z2) / 2);
    t.rotation.y = Math.atan2(dx, dz);
    g.add(t);
  }

  // 砲坑:暗色坑底 + 環形土唇
  function gunPit(x, z) {
    const pit = new THREE.Mesh(new THREE.CircleGeometry(3.2, 18), pitMat);
    pit.rotation.x = -Math.PI / 2; pit.position.set(x, 0.18, z); g.add(pit);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.7, 6, 18), earthLip);
    lip.rotation.x = -Math.PI / 2; lip.position.set(x, 0.45, z); g.add(lip);
  }

  function building(x, z, w, d, h, rot = 0, mat = stoneMat) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    wall.position.set(x, h / 2, z); wall.rotation.y = rot; g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.52, h * 0.75, 4), roofMat);
    roof.position.set(x, h + h * 0.36, z); roof.rotation.y = rot + Math.PI / 4; g.add(roof);
  }

  function water(x, z, w, d, color, y = 0.2, opacity = 0.85) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color, transparent: true, opacity }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m);
  }

  // ── 田畝拼布(先鋪地表,樹籬與單位疊其上) ─────────────────
  field(20, 30, 78, 78, texMeadow, 0.32);   // 主戰場(砲線田)
  field(105, 45, 92, 70, texWheat, 0.0);     // 東鄰(往氾濫低地)
  field(24, -42, 92, 56, texPlow, 0.1);      // 北鄰(翻土)
  field(-55, 42, 70, 96, texWheat, 0.05);    // 西鄰
  field(-150, -150, 130, 120, texGrass, 0.3);// 西北空降散落區
  field(-230, -230, 120, 110, texPlow, -0.2);

  // ── 主戰場:布雷庫爾砲線田 ───────────────────────────
  hedgerow(-16, -14, 54, 20, true);   // 砲線樹籬
  hedgerow(54, 20, 60, 86, true);     // 東緣
  hedgerow(60, 86, -20, 80, true);    // 南緣
  hedgerow(-20, 80, -16, -14, true);  // 西緣(主攻接近路線)
  trench(8, 34, 9, -4);   // L 形縱臂(三門朝東)
  trench(9, -4, 30, -8);  // L 形橫臂(一門朝北)
  for (const p of [[8, 30], [8, 14], [9, -2], [28, -6]]) gunPit(p[0], p[1]);

  // ── 莊園建物群(西北:主屋 + 穀倉 + 矮石牆) ──────────────
  building(-60, -42, 16, 11, 8, 0.3);
  building(-44, -54, 11, 8, 6, -0.2);
  building(-78, -34, 22, 7, 5.5, 0.5, stoneMat2); // 長穀倉
  const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 1.2), stoneMat2);
  wall.position.set(-58, 0.8, -26); wall.rotation.y = 0.3; g.add(wall);

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

  // ── 勒格朗謝曼土路 ───────────────────────────────────
  const road = new THREE.Mesh(new THREE.BoxGeometry(190, 0.4, 5), roadMat);
  road.position.set(-10, 0.22, 96); g.add(road);

  // ── 東側:氾濫低地(德軍放水淹的農田)→ 2 號堤道 → 猶他灘 → 海 ──
  // 淹水的田:淺水面 + 半沒入的田埂格線 + 露出的草叢蘆葦,讀起來像淹掉的田而非水池
  water(235, 0, 230, 320, 0x3c5f6d, 0.25, 0.7);
  const floodBank = new THREE.MeshLambertMaterial({ color: 0x4a5535 });
  const reedMatA = new THREE.MeshLambertMaterial({ color: 0x6a7a44 });
  const reedMatB = new THREE.MeshLambertMaterial({ color: 0x536838 });
  for (let gx = 140; gx <= 340; gx += 50) {           // 半沒入的縱向田埂
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 300), floodBank);
    b.position.set(gx, 0.34, 0); g.add(b);
  }
  for (let gz = -130; gz <= 130; gz += 52) {          // 橫向田埂
    const b = new THREE.Mesh(new THREE.BoxGeometry(220, 0.7, 1.6), floodBank);
    b.position.set(235, 0.34, gz); g.add(b);
  }
  for (let i = 0; i < 40; i++) {                       // 露出水面的草叢/蘆葦
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 1.7, 6, 4), Math.random() > 0.5 ? reedMatA : reedMatB);
    tuft.position.set(130 + Math.random() * 210, 0.38, -150 + Math.random() * 300);
    tuft.scale.y = 0.38; g.add(tuft);
  }
  const causeway = new THREE.Mesh(new THREE.BoxGeometry(240, 0.8, 5.5), roadMat);
  causeway.position.set(245, 0.5, -4); g.add(causeway);
  const beach = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 360), sandMat);
  beach.position.set(440, 0.15, 20); g.add(beach);
  water(900, 20, 900, 600, 0x24516e, 0.15, 1);

  scene.add(g);

  const places = [
    { name: '布雷庫爾莊園 Brécourt', side: 'neutral', pos: { x: -58, y: 16, z: -42 } },
    { name: '勒格朗謝曼 Le Grand-Chemin', side: 'neutral', pos: { x: -72, y: 8, z: 96 } },
    { name: '氾濫低地', side: 'neutral', pos: { x: 235, y: 10, z: 90 } },
    { name: '猶他灘 2 號堤道', side: 'blue', pos: { x: 300, y: 8, z: -4 } },
    { name: '猶他灘 Utah Beach', side: 'blue', pos: { x: 440, y: 10, z: 60 } },
  ];

  return { group: g, places };
}
