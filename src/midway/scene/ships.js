// 船艦工廠 — 程序化模型:航艦(甲板識別塗裝、艦島左右舷)、護衛艦、軍旗、陣營光圈
// 模型座標:艦艏朝 -z,長度沿 z 軸
import * as THREE from 'three';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const HULL_COLOR = { red: 0x5e6166, blue: 0x6b7280 };

// ── 軍旗 ─────────────────────────────────────────────
function makeFlagTexture(side) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  if (side === 'red') {
    // 旭日軍艦旗:日章偏向旗桿側,十六條光芒
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, 96, 64);
    const cx = 36, cy = 32, r = 13;
    g.fillStyle = '#c0392b';
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / 32;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * 140, cy + Math.sin(a0) * 140);
      g.lineTo(cx + Math.cos(a1) * 140, cy + Math.sin(a1) * 140);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  } else {
    // 美國國旗(簡化)
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 === 0 ? '#b22234' : '#f4f1e8';
      g.fillRect(0, (i * 64) / 13, 96, 64 / 13 + 1);
    }
    g.fillStyle = '#3c3b6e';
    g.fillRect(0, 0, 40, 34);
    g.fillStyle = '#fff';
    for (let r = 0; r < 5; r++)
      for (let s = 0; s < 6; s++) {
        g.beginPath();
        g.arc(4 + s * 6.5 + (r % 2) * 3, 4 + r * 6, 1.4, 0, Math.PI * 2);
        g.fill();
      }
  }
  return new THREE.CanvasTexture(c);
}

const flagTexCache = {};
function flagTexture(side) {
  if (!flagTexCache[side]) flagTexCache[side] = makeFlagTexture(side);
  return flagTexCache[side];
}

function makeFlag(side, scale = 1) {
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(9 * scale, 6 * scale, 6, 1),
    new THREE.MeshBasicMaterial({ map: flagTexture(side), side: THREE.DoubleSide })
  );
  flag.userData.isFlag = true;
  return flag;
}

// ── 飛行甲板貼圖 ─────────────────────────────────────
function makeDeckTexture(spec) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  const wood = spec.side === 'red';
  g.fillStyle = wood ? '#9a8a62' : '#3d4f63'; // 日軍木甲板 / 美軍深藍灰甲板
  g.fillRect(0, 0, 128, 512);
  // 甲板縱紋
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1;
  for (let x = 8; x < 128; x += 10) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
  }
  // 中線與艦艏線(艦艏在 y=0)
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 3;
  g.setLineDash([18, 12]);
  g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 482); g.stroke();
  g.setLineDash([]);
  if (spec.side === 'red') {
    // 艦艏日之丸
    g.fillStyle = '#c0392b';
    g.beginPath(); g.arc(64, 90, 34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.beginPath(); g.arc(64, 90, 34, 0, Math.PI * 2); g.stroke();
    // 艦尾片假名識別字
    if (spec.deckMark) {
      g.fillStyle = '#fff';
      g.font = 'bold 95px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(spec.deckMark, 64, 420);
    }
  } else if (spec.deckMark) {
    // 美軍艦艏甲板舷號
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 110px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(spec.deckMark, 64, 100);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// ── 共用零件 ─────────────────────────────────────────
function makeHull(length, width, height, color) {
  // 船型剖面:艏尖、艉收
  const half = length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -half); // 艦艏
  shape.bezierCurveTo(width * 0.55, -half * 0.55, width * 0.6, half * 0.4, width * 0.42, half);
  shape.lineTo(-width * 0.42, half);
  shape.bezierCurveTo(-width * 0.6, half * 0.4, -width * 0.55, -half * 0.55, 0, -half);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // shape 的 y → -z(艦艏 -z),depth 沿 y
  geo.translate(0, 0, 0);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}

function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  return ring;
}

function makeWakeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 0);
  g.lineTo(58, 128);
  g.lineTo(6, 128);
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}
let wakeTex = null;

function makeWake(length, width) {
  if (!wakeTex) wakeTex = makeWakeTexture();
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0.55, depthWrite: false })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.rotation.z = Math.PI; // 漸層朝艦艉淡出
  wake.position.set(0, 0.8, length * 0.78);
  return wake;
}

// ── 航空母艦 ─────────────────────────────────────────
export function createCarrier(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * 0.13;

  const hull = makeHull(L, W, L * 0.055, HULL_COLOR[spec.side]);
  hull.position.y = 0;
  g.add(hull);

  // 飛行甲板
  const deckY = L * 0.055 + 1;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(W * 2.1, 1.6, L * 0.96),
    [
      new THREE.MeshLambertMaterial({ color: 0x444a52 }),
      new THREE.MeshLambertMaterial({ color: 0x444a52 }),
      new THREE.MeshLambertMaterial({ map: makeDeckTexture(spec) }),
      new THREE.MeshLambertMaterial({ color: 0x444a52 }),
      new THREE.MeshLambertMaterial({ color: 0x444a52 }),
      new THREE.MeshLambertMaterial({ color: 0x444a52 }),
    ]
  );
  deck.position.y = deckY;
  g.add(deck);

  // 艦島(赤城、飛龍為罕見的左舷艦島)
  const ix = (spec.islandSide === 'left' ? -1 : 1) * (W * 1.05 + 1.2);
  const island = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 6, L * 0.16),
    new THREE.MeshLambertMaterial({ color: 0x787d84 })
  );
  island.position.set(ix, deckY + 3.8, -L * 0.08);
  g.add(island);

  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.4, 4.5, 8),
    new THREE.MeshLambertMaterial({ color: 0x3c3f44 })
  );
  stack.position.set(ix, deckY + 3, L * 0.02);
  stack.rotation.z = (spec.islandSide === 'left' ? 1 : -1) * 0.5;
  g.add(stack);

  // 桅杆與軍旗
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 10, 5),
    new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
  );
  mast.position.set(ix, deckY + 10, -L * 0.08);
  g.add(mast);
  const flag = makeFlag(spec.side, 1.15);
  flag.position.set(ix + 5, deckY + 13.5, -L * 0.08);
  g.add(flag);

  g.add(makeRing(L * 0.78, SIDE_COLOR[spec.side]));
  const wake = makeWake(L * 1.5, W * 2.6);
  g.add(wake);
  g.userData.wake = wake;
  return g;
}

// ── 護衛艦(戰艦/巡洋艦/驅逐艦) ──────────────────────
export function createEscort(spec) {
  const g = new THREE.Group();
  const L = spec.length;
  const W = L * (spec.kind === 'battleship' ? 0.15 : 0.11);
  const hullH = L * 0.05;

  const hull = makeHull(L, W, hullH, HULL_COLOR[spec.side]);
  g.add(hull);

  // 上層結構
  const sup = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.9, hullH * 1.6, L * 0.3),
    new THREE.MeshLambertMaterial({ color: 0x7a7f86 })
  );
  sup.position.set(0, hullH + hullH * 0.8, -L * 0.05);
  g.add(sup);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.55, hullH * 1.8, L * 0.08),
    new THREE.MeshLambertMaterial({ color: 0x84898f })
  );
  bridge.position.set(0, hullH * 2.6 + 1, -L * 0.14);
  g.add(bridge);

  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(W * 0.16, W * 0.2, hullH * 2, 8),
    new THREE.MeshLambertMaterial({ color: 0x3c3f44 })
  );
  stack.position.set(0, hullH * 2.4, L * 0.06);
  g.add(stack);

  // 主炮塔(戰艦/巡洋艦)
  if (spec.kind !== 'destroyer') {
    const n = spec.kind === 'battleship' ? 2 : 2;
    for (let i = 0; i < n; i++) {
      const tur = new THREE.Mesh(
        new THREE.CylinderGeometry(W * 0.3, W * 0.34, 2, 8),
        new THREE.MeshLambertMaterial({ color: 0x6a6f76 })
      );
      tur.position.set(0, hullH + 1.6, -L * (0.28 + i * 0.09));
      g.add(tur);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, W * 0.9, 5),
        new THREE.MeshLambertMaterial({ color: 0x55595f })
      );
      barrel.rotation.x = -Math.PI / 2.25;
      barrel.position.set(0, hullH + 2, -L * (0.32 + i * 0.09));
      g.add(barrel);
    }
  }

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 7, 5),
    new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
  );
  mast.position.set(0, hullH * 2.6 + 4, -L * 0.14);
  g.add(mast);
  const flag = makeFlag(spec.side, 0.7);
  flag.position.set(3, hullH * 2.6 + 7, -L * 0.14);
  g.add(flag);

  g.add(makeRing(L * 0.7, SIDE_COLOR[spec.side]));
  const wake = makeWake(L * 1.4, W * 2.4);
  g.add(wake);
  g.userData.wake = wake;
  return g;
}

export function createShip(spec) {
  if (spec.kind === 'carrier') return createCarrier(spec);
  return createEscort(spec);
}

// 軍旗飄動
export function animateFlags(root, time) {
  root.traverse((o) => {
    if (o.userData.isFlag) {
      o.rotation.y = Math.sin(time * 3 + o.position.x) * 0.18;
      o.scale.x = 0.92 + Math.sin(time * 5 + o.position.z) * 0.08;
    }
  });
}
