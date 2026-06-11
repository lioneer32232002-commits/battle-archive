// 中途島環礁:礁盤、潟湖、沙島(西)與東島(機場)
import * as THREE from 'three';

export function createMidwayAtoll(scene) {
  const atoll = new THREE.Group();

  // 礁盤(環)與潟湖
  const reef = new THREE.Mesh(
    new THREE.RingGeometry(78, 132, 64),
    new THREE.MeshLambertMaterial({ color: 0x57d6c4, transparent: true, opacity: 0.55 })
  );
  reef.rotation.x = -Math.PI / 2;
  reef.position.y = 0.6;
  atoll.add(reef);

  const lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshLambertMaterial({ color: 0x2fa8c9, transparent: true, opacity: 0.6 })
  );
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.position.y = 0.4;
  atoll.add(lagoon);

  // 沙島(Sand Island,西側,水上機基地)
  atoll.add(island([
    [-72, 18], [-42, 2], [-18, 8], [-14, 30], [-34, 46], [-66, 42],
  ], 0xd9cfa8));

  // 東島(Eastern Island,機場)
  const eastern = island([
    [18, 38], [58, 28], [72, 46], [52, 66], [22, 60],
  ], 0xcfc59c);
  atoll.add(eastern);

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
  mesh.position.y = 0.5;
  return mesh;
}
