// 中途島環礁:礁盤、潟湖、沙島(西)與東島(機場)
// 注意:海面波浪振幅約 5.7 單位,環礁須抬到浪峰之上並用不透明材質,
//       否則礁盤圈會與海面 z-fighting 產生破圖閃爍;水下基座填補島與海面的縫。
import * as THREE from 'three';

const LIFT = 7; // 抬升量(高於浪峰)

export function createMidwayAtoll(scene) {
  const atoll = new THREE.Group();
  atoll.position.y = LIFT;

  // 水下基座:不透明,自礁盤往下延伸沒入海中,遮住島與海面之間的縫
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x0e2c3e });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(138, 162, 34, 56), baseMat);
  base.position.y = -17; // 頂端在環礁局部 0,底部深入水下
  atoll.add(base);

  // 礁盤(環):不透明珊瑚淺水色
  const reef = new THREE.Mesh(
    new THREE.RingGeometry(80, 134, 72),
    new THREE.MeshLambertMaterial({ color: 0x3fc3ac })
  );
  reef.rotation.x = -Math.PI / 2;
  reef.position.y = 0.3;
  atoll.add(reef);

  // 潟湖:不透明
  const lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(80, 56),
    new THREE.MeshLambertMaterial({ color: 0x1f93b3 })
  );
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.position.y = 0.35;
  atoll.add(lagoon);

  // 沙島(Sand Island,西側,水上機基地)
  atoll.add(island([
    [-72, 18], [-42, 2], [-18, 8], [-14, 30], [-34, 46], [-66, 42],
  ], 0xd9cfa8));

  // 東島(Eastern Island,機場)
  atoll.add(island([
    [18, 38], [58, 28], [72, 46], [52, 66], [22, 60],
  ], 0xcfc59c));

  // 東島三條交叉跑道
  const runwayMat = new THREE.MeshLambertMaterial({ color: 0x4a4a48 });
  const specs = [
    { len: 42, w: 5, rot: 0.35 },
    { len: 38, w: 5, rot: -0.6 },
    { len: 34, w: 5, rot: 1.45 },
  ];
  for (const s of specs) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.8, s.w), runwayMat);
    r.position.set(44, 3.6, 48);
    r.rotation.y = s.rot;
    atoll.add(r);
  }

  scene.add(atoll);
  return atoll;
}

function island(points, color) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: true, bevelSize: 3, bevelThickness: 1.5, bevelSegments: 2 });
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.4;
  return mesh;
}
