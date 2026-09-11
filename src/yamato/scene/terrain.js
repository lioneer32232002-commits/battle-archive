// 坊之岬沖海戰海域:北為九州・大隅半島(出擊方向),南為沖繩本島(目的地,終未抵達)
// 注意:海面波浪振幅約 6.2 單位,陸塊須抬到浪峰之上並用不透明材質,
//       水下基座填補陸塊與海面之間的縫,避免 z-fighting 破圖。
//
// 2026-09-12 美術升級:陸塊不再是一片單色綠 —— 改用程序化地表貼圖(丘陵明暗斑 +
// 低頻大色塊 + 沿岸沙色帶),外圍再加一圈白沫礁線,遠看才有「島」的量體感。
import * as THREE from 'three';

const LIFT = 7;

// 程序化地表貼圖:多倍頻值雜訊做丘陵明暗,低頻色斑做林地／耕地色差
let landTex = null;
function landTexture(size = 512) {
  if (landTex) return landTex;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#4c7340';
  g.fillRect(0, 0, size, size);
  // 低頻色斑:林地深綠 ↔ 耕地黃綠
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = size * (0.05 + Math.random() * 0.16);
    const dark = Math.random() < 0.55;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, dark ? 'rgba(44,80,42,0.5)' : 'rgba(126,140,68,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 高頻顆粒:丘陵的明暗
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.7));
  }
  g.putImageData(img, 0, 0);
  landTex = new THREE.CanvasTexture(c);
  landTex.colorSpace = THREE.SRGBColorSpace;
  landTex.wrapS = landTex.wrapT = THREE.RepeatWrapping;
  landTex.repeat.set(0.004, 0.004); // ExtrudeGeometry 的 UV ≈ 模型座標,故取很小的 repeat
  landTex.anisotropy = 4;
  return landTex;
}

// 沿岸白沫環
let foamTex = null;
function foamRingTexture() {
  if (foamTex) return foamTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 84, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.42, 'rgba(236,246,250,0.55)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  // 打散成斷續的浪花
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 84 + Math.random() * 44;
    const s = 6 + Math.random() * 16;
    const gg = g.createRadialGradient(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 0, 128 + Math.cos(a) * r, 128 + Math.sin(a) * r, s);
    gg.addColorStop(0, 'rgba(0,0,0,0.6)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.fillRect(0, 0, 256, 256);
  }
  g.globalCompositeOperation = 'source-over';
  foamTex = new THREE.CanvasTexture(c);
  foamTex.colorSpace = THREE.SRGBColorSpace;
  return foamTex;
}

function landmass(points, depth = 4, shadows = false) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: 6, bevelThickness: 3, bevelSegments: 2,
  });
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: landTexture() }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.5;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

function foamRing(radius) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.5, radius * 2.5),
    new THREE.MeshBasicMaterial({ map: foamRingTexture(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.25; // 落在礁盤頂面上緣(群組已抬升 LIFT,礁盤頂面約在世界 y=7)
  m.renderOrder = 2;
  return m;
}

export function createOkinawa(scene, { shadows = false } = {}) {
  const group = new THREE.Group();
  group.position.y = LIFT;
  // 水下基座:改成淺水礁盤的青綠色。原本的深綠在島的四周看起來像一圈黑影。
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x275350 });

  // ── 沖繩本島(南,目的地)— 細長島嶼 ──
  const okinawa = new THREE.Group();
  okinawa.position.set(-150, 0, 1750);
  const okiBase = new THREE.Mesh(new THREE.CylinderGeometry(260, 300, 30, 40), baseMat);
  okiBase.position.y = -15;
  okinawa.add(okiBase);
  okinawa.add(
    landmass(
      [[-260, -70], [-120, -130], [60, -90], [230, 40], [300, 150], [180, 175], [10, 90], [-160, 60], [-280, 20]],
      4, shadows
    )
  );
  okinawa.add(foamRing(330));
  group.add(okinawa);

  // ── 九州・大隅半島(北,出擊方向)— 較大陸塊 ──
  const kyushu = new THREE.Group();
  kyushu.position.set(-300, 0, -1880);
  const kyuBase = new THREE.Mesh(new THREE.CylinderGeometry(520, 580, 30, 44), baseMat);
  kyuBase.position.y = -15;
  kyushu.add(kyuBase);
  kyushu.add(
    landmass(
      [[-520, 40], [-300, -240], [40, -300], [360, -180], [520, 80], [360, 260], [40, 300], [-260, 240], [-480, 180]],
      4, shadows
    )
  );
  kyushu.add(foamRing(630));
  group.add(kyushu);

  scene.add(group);
  return {
    okinawa: { x: -150, z: 1750 },
    kyushu: { x: -300, z: -1880 },
  };
}
