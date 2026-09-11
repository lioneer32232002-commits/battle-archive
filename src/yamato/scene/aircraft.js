// 機隊:以編隊的小飛機群代表一個攻擊波(史實:美軍共出動 386 架圍攻)
//
// 2026-09-12 美術升級(N-4、M-3):
//   1. 一個機隊改用 InstancedMesh(機體 1 個 + 螺旋槳圓盤 1 個 = 2 個 draw call),
//      舊版每架飛機 3 個 mesh、11 架就 33 個 draw call。省下來的預算用來把機群密度
//      拉到資料層 count 的 3 倍(桌機),遠看才像「數百架圍攻」。
//   2. 高空拉凝結尾(ContrailSystem,獨立的 InstancedBufferGeometry,1 個 draw call),
//      只在巡航高度出現,俯衝下降後自然消失。
//   3. 編隊內每架有相位差的上下起伏(±1.5)與 ±0.05 rad 滾轉(M-3)。
//   4. 機隊高度依「離戰場中心的距離」變化:遠方巡航 320、進入攻擊圈降到 70,
//      俯衝的層次感來自這個高度變化(不動資料層的航跡)。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BillboardField, makeAtlas, radial } from './gfx.js';

const PLANE_COLOR = { red: 0xb9c0a8, blue: 0x6e8aa8 };
const ACCENT = { red: 0xd9442e, blue: 0x2e7bd9 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function tint(geo, hex) {
  if (geo.index) { const ng = geo.toNonIndexed(); geo.dispose(); geo = ng; }
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

// 單機幾何(機首朝 -z),已併成一份
const planeGeoCache = {};
function planeGeometry(side) {
  if (planeGeoCache[side]) return planeGeoCache[side];
  const body = new THREE.ConeGeometry(1.1, 7, 6);
  body.rotateX(-Math.PI / 2);
  const wing = new THREE.BoxGeometry(9, 0.35, 1.8);
  wing.translate(0, 0, 0.4);
  const tail = new THREE.BoxGeometry(3.2, 0.3, 1);
  tail.translate(0, 0, 3);
  const fin = new THREE.BoxGeometry(0.3, 1.6, 1.2);
  fin.translate(0, 0.8, 3.1);
  const ps = [tint(body, PLANE_COLOR[side]), tint(wing, PLANE_COLOR[side]), tint(tail, ACCENT[side]), tint(fin, ACCENT[side])];
  const geo = mergeGeometries(ps, false);
  geo.scale(0.65, 0.65, 0.65); // 縮小機體,凸顯戰艦尺度
  planeGeoCache[side] = geo;
  return geo;
}

let propTex = null;
function propTexture() {
  if (propTex) return propTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 6, 32, 32, 31);
  grad.addColorStop(0, 'rgba(230,235,240,0.05)');
  grad.addColorStop(0.72, 'rgba(220,228,236,0.18)');
  grad.addColorStop(0.94, 'rgba(235,240,246,0.34)');
  grad.addColorStop(1, 'rgba(235,240,246,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  propTex = new THREE.CanvasTexture(c);
  propTex.colorSpace = THREE.SRGBColorSpace;
  return propTex;
}

export function createAirGroup(spec, { density = 3, mobile = false } = {}) {
  const g = new THREE.Group();
  const n = Math.max(1, Math.round(spec.count * (mobile ? 1.6 : density)));

  const mesh = new THREE.InstancedMesh(
    planeGeometry(spec.side),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    n
  );
  mesh.frustumCulled = false;
  mesh.castShadow = false; // 高空機群投影落在海面上看不到,省一趟 shadow pass
  g.add(mesh);

  const prop = new THREE.InstancedMesh(
    new THREE.CircleGeometry(2.1, 12),
    new THREE.MeshBasicMaterial({ map: propTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    n
  );
  prop.frustumCulled = false;
  g.add(prop);

  // 分成數個小編隊(每隊 V 字),整體看起來像一大群而不是一條線
  const slots = [];
  for (let i = 0; i < n; i++) {
    const flight = Math.floor(i / 3);
    const inFlight = i % 3;
    const row = Math.ceil(inFlight / 2);
    const sideSign = inFlight % 2 === 0 ? 1 : -1;
    const fx = ((flight % 5) - 2) * 26 + (Math.floor(flight / 5) % 2) * 13;
    const fz = Math.floor(flight / 5) * 30;
    slots.push({
      x: fx + sideSign * row * 7,
      y: (i % 4) * 2.6 - 3,
      z: fz + row * 6,
      phase: i * 1.7,
      bob: 1.1 + (i % 3) * 0.2,
    });
  }

  g.userData.spec = spec;
  g.userData.mesh = mesh;
  g.userData.prop = prop;
  g.userData.slots = slots;
  g.userData.trailAcc = 0;
  g.visible = false;
  return g;
}

// 依離戰場中心的距離決定巡航高度(遠方高、進入攻擊圈低)
function altitudeFor(x, z) {
  const d = Math.hypot(x, z);
  const f = Math.min(1, Math.max(0, (d - 260) / 700));
  return 70 + f * f * 250;
}

export function updateAirGroup(group, pos, time, trails = null, dt = 0) {
  const alt = altitudeFor(pos.x, pos.z);
  group.position.set(pos.x, alt, pos.z);
  group.rotation.y = -pos.heading;
  const { mesh, prop, slots } = group.userData;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const bob = Math.sin(time * 1.7 + s.phase) * s.bob;
    const roll = Math.sin(time * 1.15 + s.phase * 0.7) * 0.05;
    _p.set(s.x, s.y + bob, s.z);
    _e.set(0, 0, roll);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    _p.z -= 2.4;
    _m.compose(_p, _q, _s);
    prop.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  prop.instanceMatrix.needsUpdate = true;

  // 凝結尾:只在巡航高度拉,俯衝下降後停止
  if (trails && alt > 200 && dt > 0) {
    group.userData.trailAcc += dt;
    if (group.userData.trailAcc > 0.055) {
      group.userData.trailAcc = 0;
      const cos = Math.cos(-pos.heading), sin = Math.sin(-pos.heading);
      const step = Math.max(1, Math.floor(slots.length / 3));
      for (let i = 0; i < slots.length; i += step) {
        const s = slots[i];
        const lx = s.x, lz = s.z + 3;
        trails.emit(pos.x + lx * cos + lz * sin, alt + s.y, pos.z - lx * sin + lz * cos);
      }
    }
  }
}

// ── 凝結尾:獨立的 InstancedBufferGeometry(1 個 draw call) ──
export class ContrailSystem {
  constructor(scene, { mobile = false } = {}) {
    const max = mobile ? 90 : 260;
    const tex = makeAtlas(128, (g, i, s) => {
      radial(g, s, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(248,250,255,0.4)'], [1, 'rgba(240,246,255,0)']]);
    });
    this.field = new BillboardField(tex, max, { renderOrder: 2 });
    scene.add(this.field.mesh);
    this.max = max;
    this.slots = [];
    for (let i = 0; i < max; i++) this.slots.push({ on: false, x: 0, y: 0, z: 0, age: 0 });
    this.next = 0;
    this.life = 3.6;
  }

  emit(x, y, z) {
    const s = this.slots[this.next];
    this.next = (this.next + 1) % this.slots.length;
    s.on = true; s.x = x; s.y = y; s.z = z; s.age = 0;
  }

  clear() {
    for (const s of this.slots) s.on = false;
    this.field.flush(0);
  }

  update(dt) {
    let n = 0;
    for (const s of this.slots) {
      if (!s.on) continue;
      s.age += dt;
      if (s.age > this.life) { s.on = false; continue; }
      const f = s.age / this.life;
      const size = 7 + f * 26;
      const a = 0.42 * Math.min(1, s.age * 8) * Math.pow(1 - f, 1.1);
      this.field.set(n, s.x, s.y, s.z, size, size, 0, a, 0, 1, 1, 1);
      n++;
    }
    this.field.flush(n);
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
  goldGlowTex.colorSpace = THREE.SRGBColorSpace;
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
  body.castShadow = true;
  g.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.5, 2.6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  wing.position.z = 0.6;
  wing.castShadow = true;
  g.add(wing);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.5, 1.4),
    new THREE.MeshLambertMaterial({ color: 0xe9c659 })
  );
  tail.position.z = 4.2;
  g.add(tail);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.1, 14),
    new THREE.MeshBasicMaterial({ map: propTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  disc.position.z = -4.6;
  g.add(disc);
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
