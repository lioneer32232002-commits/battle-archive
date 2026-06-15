// 坊之岬沖海戰海域:北為九州・大隅半島(出擊方向),南為沖繩本島(目的地,終未抵達)
// 注意:海面波浪振幅約 5.7 單位,陸塊須抬到浪峰之上並用不透明材質,
//       水下基座填補陸塊與海面之間的縫,避免 z-fighting 破圖。
import * as THREE from 'three';

const LIFT = 7;

function landmass(points, color, depth = 4) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: 6, bevelThickness: 3, bevelSegments: 2,
  });
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.5;
  return mesh;
}

export function createOkinawa(scene) {
  const group = new THREE.Group();
  group.position.y = LIFT;
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x123a30 });

  // ── 沖繩本島(南,目的地)— 細長島嶼 ──
  const okinawa = new THREE.Group();
  okinawa.position.set(-150, 0, 1750);
  const okiBase = new THREE.Mesh(new THREE.CylinderGeometry(260, 300, 30, 40), baseMat);
  okiBase.position.y = -15;
  okinawa.add(okiBase);
  okinawa.add(
    landmass(
      [[-260, -70], [-120, -130], [60, -90], [230, 40], [300, 150], [180, 175], [10, 90], [-160, 60], [-280, 20]],
      0x4f7a3c
    )
  );
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
      0x4a6f3a
    )
  );
  group.add(kyushu);

  scene.add(group);
  return {
    okinawa: { x: -150, z: 1750 },
    kyushu: { x: -300, z: -1880 },
  };
}
