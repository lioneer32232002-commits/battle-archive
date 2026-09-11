// 機隊:以 V 字編隊的小飛機群代表一個攻擊波
//
// N-4 升級:
//   * 每架機的機身/主翼/尾翼合併成一個幾何(頂點著色),整個編隊改用 InstancedMesh
//     → 一個編隊 2 個 draw call(機體 ＋ 螺旋槳圓盤),舊版是每架 3 個
//   * 螺旋槳半透明圓盤
//   * 編隊內微動作(M-3):每架相位不同的上下起伏 ±1.5 單位、±0.05 rad 滾轉
//   * 凝結尾:高空編隊每架後方拉一條由白沫團串成的 ribbon(自寫 billboard shader,整隊 1 個 draw call)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PLANE_COLOR = { red: 0xb9c0a8, blue: 0x6e8aa8 };
const ACCENT = { red: 0xd9442e, blue: 0x2e7bd9 };
const PLANE_SCALE = 0.65; // 縮小機體,凸顯戰艦尺度
const CONTRAIL_MIN_COUNT = 3; // 單機偵察任務(PBY、利根四號機)低空飛行,不拉凝結尾

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const planeGeoCache = {};
function planeGeometry(side) {
  if (planeGeoCache[side]) return planeGeoCache[side];
  const body = new THREE.ConeGeometry(1.1, 7, 6);
  body.rotateX(-Math.PI / 2); // 機首朝 -z
  paint(body, PLANE_COLOR[side]);
  const wing = new THREE.BoxGeometry(9, 0.35, 1.8);
  wing.translate(0, 0, 0.4);
  paint(wing, PLANE_COLOR[side]);
  const tail = new THREE.BoxGeometry(3.2, 0.3, 1);
  tail.translate(0, 0, 3);
  paint(tail, ACCENT[side]);
  const fin = new THREE.BoxGeometry(0.28, 1.5, 1.1);
  fin.translate(0, 0.8, 3);
  paint(fin, ACCENT[side]);
  const geo = mergeGeometries([body, wing, tail, fin], false);
  geo.scale(PLANE_SCALE, PLANE_SCALE, PLANE_SCALE);
  planeGeoCache[side] = geo;
  return geo;
}

const planeMatCache = {};
function planeMaterial(side) {
  if (!planeMatCache[side]) planeMatCache[side] = new THREE.MeshLambertMaterial({ vertexColors: true });
  return planeMatCache[side];
}

// 螺旋槳半透明圓盤(共用幾何/材質)
let propGeo = null;
let propMat = null;
function propParts() {
  if (!propGeo) {
    propGeo = new THREE.CircleGeometry(1.35 * PLANE_SCALE, 14);
    propGeo.translate(0, 0, -3.45 * PLANE_SCALE);
    propMat = new THREE.MeshBasicMaterial({
      color: 0xdfe6ee, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
    });
  }
  return [propGeo, propMat];
}

// ── 凝結尾(N-4) ─────────────────────────────────────
function makeTrailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(248,252,255,0.42)');
  grad.addColorStop(1, 'rgba(244,250,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let trailTex = null;

class Contrail {
  constructor(planes, segs) {
    this.per = segs;
    this.count = planes * segs;
    this.pos = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    this.alpha = new Float32Array(this.count);
    this.age = new Float32Array(this.count);
    this.cursor = new Uint16Array(planes);
    this.acc = 0;

    if (!trailTex) trailTex = makeTrailTexture();
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    geo.instanceCount = this.count;
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(this.alpha, 1);
    for (const a of [this.aPos, this.aSize, this.aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iAlpha', this.aAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20000);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: trailTex } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        attribute vec3 iPos; attribute float iSize; attribute float iAlpha;
        varying vec2 vUv; varying float vA;
        void main() {
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 w = iPos + r * position.x * iSize + u * position.y * iSize;
          vUv = uv; vA = iAlpha;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec2 vUv; varying float vA;
        void main() {
          if (vA < 0.004) discard;
          float a = texture2D(uMap, vUv).a * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  emit(planeIdx, x, y, z) {
    const i = planeIdx * this.per + this.cursor[planeIdx];
    this.cursor[planeIdx] = (this.cursor[planeIdx] + 1) % this.per;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.age[i] = 0;
    this.alpha[i] = 0.0001;
    this.size[i] = 3;
  }

  update(dt) {
    const LIFE = 6.5;
    for (let i = 0; i < this.count; i++) {
      if (this.alpha[i] <= 0) continue;
      this.age[i] += dt;
      const f = this.age[i] / LIFE;
      if (f >= 1) { this.alpha[i] = 0; continue; }
      this.size[i] = 3 + f * 10;
      this.alpha[i] = Math.min(1, f / 0.1) * (1 - f) * 0.5;
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    this.age.fill(0);
    this.aAlpha.needsUpdate = true;
  }
}

// ── 編隊 ─────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function createAirGroup(spec, opts = {}) {
  const mobile = !!opts.mobile;
  const g = new THREE.Group();
  const n = spec.count;

  const body = new THREE.InstancedMesh(planeGeometry(spec.side), planeMaterial(spec.side), n);
  body.frustumCulled = false;
  g.add(body);
  const [pg, pm] = propParts();
  const prop = new THREE.InstancedMesh(pg, pm, n);
  prop.frustumCulled = false;
  g.add(prop);

  // V 字編隊基準位置(與舊版一致)
  const slots = [];
  for (let i = 0; i < n; i++) {
    const row = Math.ceil(i / 2);
    const sideSign = i % 2 === 0 ? 1 : -1;
    slots.push({ x: sideSign * row * 7, y: (i % 3) * 1.2, z: row * 6, phase: i * 1.7 });
  }

  g.userData.spec = spec;
  g.userData.body = body;
  g.userData.prop = prop;
  g.userData.slots = slots;
  g.visible = false;

  if (n >= CONTRAIL_MIN_COUNT && opts.scene) {
    const trail = new Contrail(n, mobile ? 7 : 16);
    opts.scene.add(trail.mesh);
    g.userData.contrail = trail;
  }
  return g;
}

// pos = null 表示編隊即將隱藏:清掉凝結尾殘留
export function updateAirGroup(group, pos, time, altitude = 70, dt = 0.016) {
  const trail = group.userData.contrail;
  if (!pos) {
    if (trail) { trail.clear(); trail.mesh.visible = false; }
    return;
  }
  group.position.set(pos.x, altitude, pos.z);
  group.rotation.y = -pos.heading;
  group.updateWorldMatrix(false, false);

  const { body, prop, slots } = group.userData;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    // M-3:編隊內微動作(相位差的上下起伏 ±1.5 單位、±0.05 rad 滾轉)
    const bob = Math.sin(time * 1.35 + s.phase) * 1.5;
    const roll = Math.sin(time * 0.9 + s.phase * 1.4) * 0.05;
    _p.set(s.x, s.y + bob, s.z);
    _e.set(0, 0, roll);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    body.setMatrixAt(i, _m);
    prop.setMatrixAt(i, _m);
  }
  body.instanceMatrix.needsUpdate = true;
  prop.instanceMatrix.needsUpdate = true;

  if (trail) {
    trail.mesh.visible = true;
    // 高空才拉凝結尾
    if (altitude > 60) {
      trail.acc += dt;
      while (trail.acc >= 0.22) {
        trail.acc -= 0.22;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          _p.set(s.x, s.y, s.z + 4.5).applyMatrix4(group.matrixWorld);
          trail.emit(i, _p.x, _p.y, _p.z);
        }
      }
    }
    trail.update(dt);
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
  const [pg, pm] = propParts();
  const propDisc = new THREE.Mesh(pg, pm);
  propDisc.scale.setScalar(1.6);
  g.add(propDisc);
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
