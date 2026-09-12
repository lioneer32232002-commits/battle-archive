// 機隊:以 V 字編隊的小飛機群代表一個攻擊波
//
// N-4 升級:
//   * 每架機的機身/主翼/尾翼合併成一個幾何(頂點著色),整個編隊改用 InstancedMesh
//     → 一個編隊 2 個 draw call(機體 ＋ 螺旋槳圓盤),舊版是每架 3 個
//   * 螺旋槳半透明圓盤
//   * 編隊內微動作(M-3):每架相位不同的上下起伏 ±1.5 單位、±0.05 rad 滾轉
//   * 凝結尾:高空編隊每架後方拉一條由白沫團串成的 ribbon(自寫 billboard shader,整隊 1 個 draw call)
//
// 資產管線(docs/asset-pipeline-spec.md §3):
//   A-3 機隊的 InstancedMesh 改吃 Blender glb 幾何 — 把 glb 的各 primitive 合併成單一
//       幾何,並把每個 primitive 的 baseColor 烘進頂點色(單一材質也保留日之丸／
//       美軍星徽與座艙塗裝),再依 0.46 單位/公尺縮到場景尺度(1 單位 ≈ 2.35 m,
//       機體略放大以維持既有可辨識度)。螺旋槳仍用半透明圓盤(旋轉葉片在 60fps 會頻閃),
//       但半徑與位置改由 glb 的 prop 子物件決定。王牌座機用完整 glb。
//       資產沒到或載入失敗時,畫面維持既有的程序化機體。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeToSingleGeometry, cloneModel } from './assets.js';

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
  if (!planeMatCache[side]) {
    planeMatCache[side] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.25 });
  }
  return planeMatCache[side];
}

// ── glb 機體(A-3) ───────────────────────────────────
const AIR_UNITS_PER_METER = 0.46; // 1 單位 ≈ 2.35 m;機體略放大,與舊版程序化機同尺寸
const GROUP_MODEL = {
  tomonaga1: 'b5n',          // 友永隊第一波(九七艦攻為主)
  pby: 'f4f',                // PBY 無專屬模型,以單機代表
  'midway-strike': 'sbd',
  b17: 'sbd',                // B-17 無專屬模型
  tone4: 'd3a',              // 利根四號機(水偵)
  vt8: 'tbd',
  vt6: 'tbd',
  mcclusky: 'sbd',
  'yorktown-strike': 'sbd',
  kobayashi: 'd3a',
  tomonaga2: 'b5n',
  'final-strike': 'sbd',
};
const SIDE_DEFAULT_MODEL = { red: 'a6m', blue: 'f4f' };

export function planeModelId(spec) {
  return GROUP_MODEL[spec.id] ?? SIDE_DEFAULT_MODEL[spec.side] ?? 'f4f';
}

function isUnder(o, ancestor) {
  for (let p = o; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

const bakedCache = new Map(); // modelId -> Promise<{ geo, propR, propZ } | null>
function bakedPlane(assets, id) {
  if (bakedCache.has(id)) return bakedCache.get(id);
  const p = assets.model(id).then((src) => {
    if (!src) return null;
    const root = cloneModel(src, { cloneMaterials: false });
    root.updateWorldMatrix(true, true);
    const propNode = root.getObjectByName('prop');
    const geo = bakeToSingleGeometry(root, { skip: (o) => !!propNode && isUnder(o, propNode) });
    if (!geo) return null;
    const K = AIR_UNITS_PER_METER;
    geo.scale(K, K, K);
    geo.computeBoundingSphere();
    let propR = 1.4 * K;
    let propZ = -4.6 * K;
    if (propNode) {
      const b = new THREE.Box3().setFromObject(propNode);
      propR = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 0.5 * K;
      propZ = ((b.max.z + b.min.z) * 0.5 - 0.12) * K;
    }
    return { geo, propR, propZ };
  });
  bakedCache.set(id, p);
  return p;
}

const propDiscCache = new Map();
function propDisc(r, z) {
  const key = r.toFixed(3) + '|' + z.toFixed(3);
  if (propDiscCache.has(key)) return propDiscCache.get(key);
  const g = new THREE.CircleGeometry(r, 16);
  g.translate(0, 0, z);
  propDiscCache.set(key, g);
  return g;
}

// 機隊換裝:InstancedMesh 的幾何直接抽換(材質與 instanceMatrix 都沿用)
function swapAirGeometry(group, assets, spec) {
  bakedPlane(assets, planeModelId(spec)).then((res) => {
    if (!res) return;
    const { body, prop } = group.userData;
    body.geometry = res.geo;
    body.computeBoundingSphere?.();
    prop.geometry = propDisc(res.propR, res.propZ);
    group.userData.swapped = true;
  });
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

  if (opts.assets) swapAirGeometry(g, opts.assets, spec);

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

// 王牌座機用完整 glb(不合併、保留各自材質),金色光暈與尾翼標記沿用
const ACE_MODEL = { 'blue|dive': 'sbd', 'blue|torpedo': 'tbd', 'red|dive': 'd3a', 'red|torpedo': 'b5n' };

function swapAcePlane(g, assets, modelId, shadows) {
  assets.model(modelId).then((src) => {
    if (!src || !g.userData.proc) return;
    const model = cloneModel(src);
    const K = AIR_UNITS_PER_METER * 1.5; // 王牌座機放大,易於在混戰中辨識
    model.scale.setScalar(K);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !!shadows;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.roughness !== undefined) m.roughness = Math.max(0.35, m.roughness);
        // 尾翼金色識別:機身上半材質加一點暖色 emissive,遠看仍是「那架金尾巴的」
        if (/^skin_up$/.test(m.name || '')) {
          m.emissive = new THREE.Color(0x6a4a10);
          m.emissiveIntensity = 0.5;
        }
        m.needsUpdate = true;
      }
    });
    g.remove(g.userData.proc);
    g.userData.proc = null;
    g.add(model);
    g.userData.model = model;
  });
}

export function createAcePlane(side, opts = {}) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ'; // 先航向後俯仰
  const proc = new THREE.Group();
  g.userData.proc = proc;
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 10, 6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  body.rotation.x = -Math.PI / 2;
  body.castShadow = true;
  proc.add(body);
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.5, 2.6),
    new THREE.MeshLambertMaterial({ color: PLANE_COLOR[side] })
  );
  wing.position.z = 0.6;
  wing.castShadow = true;
  proc.add(wing);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.5, 1.4),
    new THREE.MeshLambertMaterial({ color: 0xe9c659 })
  );
  tail.position.z = 4.2;
  g.add(tail);
  const [pg, pm] = propParts();
  const disc = new THREE.Mesh(pg, pm);
  disc.scale.setScalar(1.6);
  proc.add(disc);
  g.add(proc);
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
  if (opts.assets) {
    const id = ACE_MODEL[`${side}|${opts.kind ?? 'dive'}`] ?? (side === 'red' ? 'a6m' : 'f4f');
    swapAcePlane(g, opts.assets, id, opts.shadows);
  }
  return g;
}
