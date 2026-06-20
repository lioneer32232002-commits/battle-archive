// 機隊:以 V 字編隊的小飛機群代表一個攻擊波
import * as THREE from 'three';

const PLANE_COLOR = { red: 0xb9c0a8, blue: 0x6e8aa8 };
const ACCENT = { red: 0xd9442e, blue: 0x2e7bd9 };

function makePlane(side) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 7, 6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  body.rotation.x = -Math.PI / 2; // 機首朝 -z
  g.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.35, 1.8),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  wing.position.z = 0.4;
  g.add(wing);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.3, 1),
    new THREE.MeshLambertMaterial({ color: ACCENT[side] })
  );
  tail.position.z = 3;
  g.add(tail);
  g.scale.setScalar(0.65); // 縮小機體,凸顯戰艦尺度(飛機原本相對偏大)
  return g;
}

export function createAirGroup(spec) {
  const g = new THREE.Group();
  for (let i = 0; i < spec.count; i++) {
    const p = makePlane(spec.side);
    // V 字編隊
    const row = Math.ceil(i / 2);
    const sideSign = i % 2 === 0 ? 1 : -1;
    p.position.set(sideSign * row * 7, (i % 3) * 1.2, row * 6);
    p.userData.phase = i * 1.7;
    g.add(p);
  }
  g.userData.spec = spec;
  g.visible = false;
  return g;
}

export function updateAirGroup(group, pos, time, altitude = 70) {
  group.position.set(pos.x, altitude, pos.z);
  group.rotation.y = -pos.heading;
  for (const p of group.children) {
    p.position.y = (p.userData.phase % 3) * 1.2 + Math.sin(time * 2 + p.userData.phase) * 0.8;
  }
}

// ── 王牌飛行員座機(放大、金色尾翼、金色光暈,易於辨識) ──
let goldGlowTex = null;
function getGoldGlow() {
  if (goldGlowTex) return goldGlowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,228,150,0.95)');
  grad.addColorStop(1, 'rgba(255,200,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  goldGlowTex = new THREE.CanvasTexture(c);
  return goldGlowTex;
}

export function createAcePlane(side) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ'; // 先航向後俯仰
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 10, 6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.5, 2.6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  wing.position.z = 0.6;
  g.add(wing);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.5, 1.4),
    new THREE.MeshLambertMaterial({ color: 0xe9c659 })
  );
  tail.position.z = 4.2;
  g.add(tail);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGoldGlow(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    })
  );
  glow.scale.setScalar(20);
  g.add(glow);
  g.visible = false;
  return g;
}
