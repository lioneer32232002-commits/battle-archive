// 天候:飄雪(B-4.1)＋遠景城鎮火光煙柱(B-4.3)。
// 飄雪:一個 THREE.Points,粒子在相機周圍立方域內下落＋風向漂移,落底回收到頂;
//   域中心跟隨相機水平位置,永遠有雪但粒子數固定。可動態調 draw range(C-3 降級時砍半)。
import * as THREE from 'three';

function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.6, 'rgba(240,246,252,0.5)');
  grad.addColorStop(1, 'rgba(240,246,252,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

const DOM = 620;   // 立方域水平半邊長
const HGT = 380;   // 域高

export function createSnow(scene, { count = 1500, seed = 5 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  const sway = new Float32Array(count);
  let s = seed;
  const r = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let z = Math.imul(s ^ (s >>> 15), 1 | s); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() * 2 - 1) * DOM;
    pos[i * 3 + 1] = r() * HGT;
    pos[i * 3 + 2] = (r() * 2 - 1) * DOM;
    spd[i] = 22 + r() * 26;
    sway[i] = r() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, count);
  const mat = new THREE.PointsMaterial({
    map: flakeTexture(), color: 0xffffff, size: 2.4, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  let tAcc = 0;
  return {
    points,
    setCount: (n) => geo.setDrawRange(0, Math.max(0, Math.min(count, Math.floor(n)))),
    update: (dt, camPos) => {
      tAcc += dt;
      points.position.set(camPos.x, 0, camPos.z);   // 域跟隨相機水平位置
      const arr = geo.attributes.position.array;
      const n = geo.drawRange.count;
      const wind = 9;
      for (let i = 0; i < n; i++) {
        arr[i * 3] += (wind + Math.sin(tAcc * 0.8 + sway[i]) * 5) * dt;
        arr[i * 3 + 1] -= spd[i] * dt;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] += HGT;
        if (arr[i * 3] > DOM) arr[i * 3] -= 2 * DOM;
        else if (arr[i * 3] < -DOM) arr[i * 3] += 2 * DOM;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ── 遠景城鎮火光煙柱:緩慢升騰的煙柱 sprite ＋底部橘色點光暈(sprite,不用真光源) ──
export function createTownFires(scene, spots) {
  const smokeTex = flakeTexture();
  const group = new THREE.Group();
  scene.add(group);
  const cols = [];
  for (const spot of spots) {
    const col = { spot, puffs: [] };
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x4a4640, transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { life: i * 0.85 };
      group.add(s); col.puffs.push(s);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xff8a3a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(spot.x, 4, spot.z); glow.scale.setScalar(22);
    group.add(glow); col.glow = glow;
    cols.push(col);
  }
  return {
    update: (dt) => {
      for (const col of cols) {
        for (const s of col.puffs) {
          s.userData.life += dt * 0.32;
          const f = (s.userData.life % 6) / 6;
          s.position.set(col.spot.x + Math.sin(s.userData.life) * 10, 6 + f * 150, col.spot.z + Math.cos(s.userData.life * 0.7) * 8);
          s.scale.setScalar(24 + f * 90);
          s.material.opacity = 0.42 * (1 - f);
        }
      }
    },
  };
}
