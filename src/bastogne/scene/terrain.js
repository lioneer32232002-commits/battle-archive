// 巴斯通地形 — 阿登冬季森林戰場(傑克森林 Bois Jacques):
//   ①E 連散兵坑線(MLR)沿森林南緣樹線、面北迎向開闊雪原(下坡通往德軍佔領的佛伊)
//   ②傑克森林松林(InstancedMesh,C-1)＝樹頂空爆的舞台;學到教訓後散兵坑加蓋松木頂
//   ③開闊雪原＋程序化雪地貼圖(B-3):髒雪、露土、車轍、彈坑
//   ④南面巴斯通鎮＝七路交會的公路樞紐(靜態幾何合併,C-2);北面佛伊村(德軍)
// 地形邏輯(招牌手法):森林樹冠=空爆的天花板(散兵坑無天然頂蓋)、開闊雪原=無掩蔽殺戮區、
//   公路樞紐=德軍非拿不可卻拿不到的目標。
// 座標:1 單位 = 10 公尺;原點 = E 連散兵坑線中央;北 = -z(雪原、佛伊、諾維爾)、南 = +z(森林縱深、巴斯通)。
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

// ── 程序化雪地貼圖(B-3):底雪偏灰藍,疊髒雪／露土色斑,撒彈坑暈染 ──
function makeSnowTexture() {
  const S = 1024;
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

// ── 松樹幾何(合併成單一帶頂點色的 geometry,供 InstancedMesh) ──
function makePineGeometry(tall) {
  const trunkH = tall ? 3.4 : 2.2;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.34, 0.5, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0); parts.push(paint(trunk, 0x4a3826));
  // 3 層錐狀樹冠(深冬松綠),疊雪帽(白)
  const tiers = tall ? [[2.7, 4.2, trunkH - 0.4], [2.1, 3.6, trunkH + 2.0], [1.4, 3.0, trunkH + 4.0]]
                     : [[2.2, 3.2, trunkH - 0.3], [1.6, 2.6, trunkH + 1.4], [1.0, 2.2, trunkH + 3.0]];
  for (const [rad, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(rad, h, 8);
    cone.translate(0, y + h / 2, 0); parts.push(paint(cone, 0x2c4230));
    const snow = new THREE.ConeGeometry(rad * 0.86, h * 0.5, 8);
    snow.translate(0, y + h * 0.72, 0); parts.push(paint(snow, 0xe7eef4));
  }
  return mergeGeometries(parts, false);
}

export function createBastogneTerrain(scene, { shadows = false } = {}) {
  const g = new THREE.Group();
  const rng = mulberry(777);

  const snowMat = new THREE.MeshLambertMaterial({ color: 0xdfe7ee, map: makeSnowTexture() });
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });   // 壓實的雪／泥路面
  const rutMat = new THREE.MeshLambertMaterial({ color: 0x5b5750 });    // 車轍暗痕
  const earthMat = new THREE.MeshLambertMaterial({ color: 0x5a5142 });  // 散兵坑翻土
  const pitMat = new THREE.MeshLambertMaterial({ color: 0x211d18 });    // 坑心暗
  const logMat = new THREE.MeshLambertMaterial({ color: 0x53412c });    // 松木頂蓋
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xb6b2a8 });  // 阿登石屋牆
  const railMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3e });

  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    if (shadows) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m); return m;
  };

  // ── 雪原大平面(主戰場地表) ──────────────────────────────
  const field = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), snowMat);
  field.rotation.x = -Math.PI / 2; field.position.set(0, 0.02, 40);
  if (shadows) field.receiveShadow = true;
  g.add(field);

  // ── 公路樞紐:數條路自巴斯通鎮(南)向外放射(七路交會的招牌) ──
  // N30 主幹:巴斯通(南 +z)—佛伊(北 -z)—諾維爾,縱貫戰場
  function road(cx, cz, len, wid, rot) {
    const rd = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), roadMat);
    rd.rotation.x = -Math.PI / 2; rd.rotation.z = rot; rd.position.set(cx, 0.06, cz);
    if (shadows) rd.receiveShadow = true; g.add(rd);
    // 兩道車轍
    for (const off of [-wid * 0.22, wid * 0.22]) {
      const rt = new THREE.Mesh(new THREE.PlaneGeometry(wid * 0.14, len), rutMat);
      rt.rotation.x = -Math.PI / 2; rt.rotation.z = rot;
      rt.position.set(cx + Math.cos(rot) * off, 0.08, cz - Math.sin(rot) * off);
      g.add(rt);
    }
  }
  road(18, 40, 620, 12, 0.02);                    // N30 主幹(近縱向)
  const hub = { x: 40, z: 250 };                  // 鎮北緣的路口
  for (const a of [-1.15, -0.5, 0.5, 1.15]) road(hub.x + Math.sin(a) * 120, hub.z - Math.cos(a) * 120, 300, 9, a); // 放射支路

  // ── 傑克森林(InstancedMesh,C-1):散兵坑線後方與兩翼的松林 ──
  const forest = new THREE.Group();
  const variants = [makePineGeometry(true), makePineGeometry(false)];
  const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const dummy = new THREE.Object3D();
  const placements = [[], []];
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
    const v = rng() > 0.4 ? 0 : 1;
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(0.85 + rng() * 0.7);
    dummy.updateMatrix();
    placements[v].push(dummy.matrix.clone());
  }
  // MLR 樹線:散兵坑線正後方(z≈6)一道較密的松樹,空爆就炸在這排樹冠上
  for (let i = 0; i < 60; i++) {
    const x = -280 + (i / 59) * 560 + (rng() - 0.5) * 6;
    dummy.position.set(x, 0, 6 + (rng() - 0.5) * 8);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(1.0 + rng() * 0.5);
    dummy.updateMatrix();
    placements[0].push(dummy.matrix.clone());
  }
  const forestMeshes = [];
  for (let v = 0; v < 2; v++) {
    const im = new THREE.InstancedMesh(variants[v], pineMat, placements[v].length);
    for (let i = 0; i < placements[v].length; i++) im.setMatrixAt(i, placements[v][i]);
    im.instanceMatrix.needsUpdate = true;
    if (shadows) { im.castShadow = true; im.receiveShadow = true; }
    forest.add(im); forestMeshes.push(im);
  }
  g.add(forest);

  // ── E 連散兵坑線(MLR):沿樹線 z≈0、面北 -z ────────────────
  // 西段=開頂坑(挖好但尚無頂蓋);東段=學到樹爆教訓後加蓋松木頂(Paul Rogers 的第二個坑才有頂)
  const holes = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const x = -250 + (i / 10) * 500;
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
  // 阿登石屋:石牆＋陡斜雪頂＋教堂尖塔。合併成兩個網格(牆體、屋頂)以省 draw call。
  const wallParts = [], roofParts = [];
  const townR = mulberry(88);
  function houseAt(x, z, w, d, h, rot) {
    const wall = new THREE.BoxGeometry(w, h, d); wall.translate(0, h / 2, 0);
    const roof = new THREE.ConeGeometry(Math.hypot(w, d) * 0.56, h * 0.7, 4);
    roof.rotateY(Math.PI / 4); roof.translate(0, h + h * 0.35, 0);
    // 就地旋轉平移
    const mW = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
    wall.applyMatrix4(mW); roof.applyMatrix4(mW);
    wallParts.push(paint(wall, 0xb4b0a6)); roofParts.push(paint(roof, 0xdfe6ec));
  }
  for (let i = 0; i < 26; i++) {
    const ang = townR() * Math.PI * 2, rad = 30 + townR() * 150;
    const x = hub.x + Math.cos(ang) * rad, z = hub.z + Math.sin(ang) * rad * 0.7 + 30;
    if (z < 170) continue; // 別長到戰線上
    houseAt(x, z, 9 + townR() * 8, 8 + townR() * 7, 6 + townR() * 5, townR() * Math.PI);
  }
  // 教堂(鎮地標:石塔＋尖頂)
  houseAt(hub.x, hub.z + 40, 12, 20, 9, 0);
  const tower = new THREE.BoxGeometry(6, 20, 6); tower.translate(hub.x - 10, 10, hub.z + 40); wallParts.push(paint(tower, 0xa9a59b));
  const spire = new THREE.ConeGeometry(4.6, 10, 4); spire.rotateY(Math.PI / 4); spire.translate(hub.x - 10, 25, hub.z + 40); roofParts.push(paint(spire, 0x66707a));
  const townWalls = new THREE.Mesh(mergeGeometries(wallParts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const townRoofs = new THREE.Mesh(mergeGeometries(roofParts, false), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  if (shadows) { townWalls.castShadow = townWalls.receiveShadow = true; townRoofs.castShadow = true; }
  g.add(townWalls); g.add(townRoofs);

  // ── 佛伊村(北 -z,德軍佔領):散兵坑線越過雪原望見的小村 ────
  const foyParts = [], foyRoofs = [];
  const foyR = mulberry(51);
  for (let i = 0; i < 8; i++) {
    const x = -70 + foyR() * 150, z = -190 - foyR() * 40;
    const w = 8 + foyR() * 6, d = 7 + foyR() * 5, h = 5 + foyR() * 3;
    const wall = new THREE.BoxGeometry(w, h, d); wall.translate(0, h / 2, 0);
    const roof = new THREE.ConeGeometry(Math.hypot(w, d) * 0.55, h * 0.7, 4); roof.rotateY(Math.PI / 4); roof.translate(0, h + h * 0.35, 0);
    const mW = new THREE.Matrix4().makeRotationY(foyR() * Math.PI).setPosition(x, 0, z);
    wall.applyMatrix4(mW); roof.applyMatrix4(mW);
    foyParts.push(paint(wall, 0x9c988e)); foyRoofs.push(paint(roof, 0xd6dde3));
  }
  const foyWalls = new THREE.Mesh(mergeGeometries(foyParts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const foyRoofM = new THREE.Mesh(mergeGeometries(foyRoofs, false), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  if (shadows) { foyWalls.castShadow = true; foyRoofM.castShadow = true; }
  g.add(foyWalls); g.add(foyRoofM);

  // ── 鐵路路堤(東翼,501 團在鐵路以東的分界) ────────────────
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const cx = 260 - t * 120, cz = -160 + t * 380;
    box(10, 1.4, 8, earthMat, cx, 0.7, cz, Math.PI * 0.28);
    box(9, 0.3, 5.6, railMat, cx, 1.55, cz, Math.PI * 0.28);
  }

  scene.add(g);

  const places = [
    { name: '傑克森林 Bois Jacques', side: 'neutral', pos: { x: -140, y: 16, z: 70 } },
    { name: 'E 連散兵坑線（MLR）', side: 'blue', pos: { x: 40, y: 10, z: 2 } },
    { name: '佛伊 Foy（德軍）', side: 'red', pos: { x: 0, y: 12, z: -200 } },
    { name: '巴斯通鎮・七路樞紐', side: 'neutral', pos: { x: 40, y: 18, z: 250 } },
    { name: '諾維爾 Noville（北）', side: 'red', pos: { x: 20, y: 12, z: -380 } },
    { name: '開闊雪原（無掩蔽殺戮區）', side: 'neutral', pos: { x: -120, y: 6, z: -90 } },
  ];

  return { group: g, places, forestMeshes };
}
