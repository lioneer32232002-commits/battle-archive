// 單位工廠 — 程序化模型:步兵班、突擊隊、火力組、德軍守軍、MG 巢
// 比照戰艦做法,模型尺度刻意放大以利辨識(stylized diorama)。
// 模型座標:單兵直立、面朝 +z(武器指 +z),由 rotation.y 決定朝向。
// 美術:分姿態(衝鋒/跪射/站哨)、M1 盔 vs 鋼盔、傘兵背具 vs 國民擲彈兵長大衣、
//   武器種類(Thompson/BAR/Garand/Kar98)、雙層沙包 MG42 巢含射手。
// 重要:材質「每單位一份」(makeMats),班內共用 → 整單位一起淡出;不同單位互不影響(避免炸一門砲四門全淡)。
//
// M-3／L-4 升級:每個小兵記 userData.phase(用檔內 rng 保持可重現);單位工廠把所有小兵 mesh
//   收進 group.userData.troopers 陣列,主迴圈直接走訪做「行進微動作」(起伏＋輕搖)。
//   桌機開 castShadow;手機(無 shadow map)改在單位底下放一張柔邊深色圓 sprite 當接地影。
//
// 資產升級（docs/asset-pipeline-spec.md §3）：MG 巢與單兵改 Blender glb。
//   * 同姿態共用幾何（clone() 只複製 node，geometry 是同一份），但**材質每單位 clone 一份** ——
//     否則 main.js 的 applyDestroyedLook 會一淡全淡（原本「每單位一份材質」的約定要守住）。
//   * `userData.troopers` 仍是「每個小兵一個 Object3D」，M-3 微動作照舊。
//   * 載不到就完全維持程序化小人（createUnit 的對外 API 不變）。
//
// R1 骨架動畫（docs/realism-spec.md §R1.5）：士兵優先換 `soldier_rig_<variant>.glb`
//   （20 骨、七個 clip）。每兵一個 SkeletonUtils.clone ＋ 一個 AnimationMixer，
//   `userData.troopers` 改為指向每個兵的 SkinnedMesh、`userData.animator` 是這個單位的動畫器
//   （main.js 每幀餵「實際移動速度」進去選 clip 與播放倍率），原本的正弦起伏微動作由 clip 取代。
//   rig 載不到才退回上面那套靜態姿態 glb，再載不到才是程序化小人。
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { fitToHeight, fitToWidth, normalizeMaterial } from './assets.js';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const UNIFORM = { blue: 0x6f7049, red: 0x565a4e };   // 美軍橄欖綠 / 德軍灰綠
const HELMET = { blue: 0x4f5236, red: 0x3d4034 };
const METAL = 0x4a4d50;

const _UP = new THREE.Vector3(0, 1, 0);

// ── 小工具 ───────────────────────────────────────────
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, s, m) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
function at(m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
// 兩點之間的圓柱(手臂、駐鋤、三腳架、傘繩通用)
function strut(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 0.001;
  const m = cyl(r, r, len, 6, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(_UP, d.normalize());
  return m;
}

// 每單位一份材質(班內共用)
function makeMats(side) {
  const isUS = side === 'blue';
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  return {
    uni: L(UNIFORM[side]),
    pack: L(isUS ? 0x59593a : 0x4a4d42),
    helm: L(HELMET[side]),
    skin: L(0xb98a63),
    boot: L(0x231e1a),
    web: L(0x423d2c),
    wood: L(0x5a3f27),
    gunmetal: L(0x26241f),
    metal: L(METAL),
    dark: L(0x33352f),
    sand: L(0x9a8c63),
    sand2: L(0x8a7c52),
    brass: L(0xb08a3e),
  };
}

// 可重現偽隨機(各單位佈陣固定)
function rng(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 武器(沿 +z,握把在原點附近) ──────────────────────
function makeWeapon(type, mat) {
  const g = new THREE.Group();
  if (type === 'thompson') {                 // 湯姆森衝鋒槍
    g.add(at(box(0.13, 0.17, 0.95, mat.wood), 0, 0, 0.35));
    g.add(at(cyl(0.05, 0.05, 0.5, 6, mat.gunmetal), 0, 0.02, 0.95, Math.PI / 2));
    g.add(at(box(0.1, 0.34, 0.12, mat.gunmetal), 0, -0.22, 0.5));   // 彈匣
    g.add(at(box(0.11, 0.22, 0.12, mat.wood), 0, -0.16, 0.78));     // 前握把
  } else if (type === 'bar') {               // BAR 自動步槍
    g.add(at(box(0.13, 0.17, 1.25, mat.wood), 0, 0, 0.5));
    g.add(at(cyl(0.05, 0.05, 0.95, 6, mat.gunmetal), 0, 0.03, 1.45, Math.PI / 2));
    g.add(at(box(0.13, 0.32, 0.14, mat.gunmetal), 0, -0.2, 0.62));  // 彈匣
    g.add(strut(new THREE.Vector3(0, 0.02, 1.75), new THREE.Vector3(0.28, -0.55, 1.95), 0.035, mat.gunmetal));
    g.add(strut(new THREE.Vector3(0, 0.02, 1.75), new THREE.Vector3(-0.28, -0.55, 1.95), 0.035, mat.gunmetal));
  } else if (type === 'kar98') {             // 德軍 Kar98 步槍
    g.add(at(box(0.11, 0.15, 1.5, mat.wood), 0, 0, 0.55));
    g.add(at(cyl(0.045, 0.045, 0.7, 6, mat.gunmetal), 0, 0.04, 1.5, Math.PI / 2));
    g.add(at(box(0.07, 0.13, 0.07, mat.gunmetal), 0.11, 0.06, 0.5));// 槍機柄
  } else {                                    // M1 Garand
    g.add(at(box(0.12, 0.16, 1.45, mat.wood), 0, 0, 0.52));
    g.add(at(cyl(0.045, 0.045, 0.8, 6, mat.gunmetal), 0, 0.04, 1.45, Math.PI / 2));
    g.add(at(box(0.1, 0.18, 0.14, mat.gunmetal), 0, -0.12, 0.32));  // 彈倉
  }
  g.rotation.x = -0.1; // 略朝前下
  return g;
}

// ── 單兵(放大的程序化小人,分姿態) ─────────────────────
function makeSoldier(side, pose, weapon, mat, phase = 0) {
  const s = new THREE.Group();
  const core = new THREE.Group();
  s.add(core);
  const HIP = 1.45;

  // 雙腿(臀部樞紐 thigh、膝樞紐 shin)
  function legAt(x, thigh, shin) {
    const hip = new THREE.Group();
    hip.position.set(x, HIP, 0);
    hip.add(at(box(0.4, 0.62, 0.46, mat.uni), 0, -0.31, 0));
    const knee = new THREE.Group(); knee.position.y = -0.62; hip.add(knee);
    knee.add(at(box(0.36, 0.6, 0.4, mat.uni), 0, -0.3, 0));
    knee.add(at(box(0.44, 0.3, 0.66, mat.boot), 0, -0.62, 0.14)); // 靴
    hip.rotation.x = thigh; knee.rotation.x = shin;
    core.add(hip);
  }

  // 軀幹群(臀部樞紐,可前傾)
  const body = new THREE.Group();
  body.position.y = HIP; core.add(body);
  body.add(at(box(1.0, 1.0, 0.6, mat.uni), 0, 0.55, 0));          // 軀幹
  for (const sx of [-0.26, 0.26]) body.add(at(box(0.12, 1.0, 0.05, mat.web), sx, 0.55, 0.31)); // 胸前背帶
  body.add(at(box(1.04, 0.16, 0.64, mat.web), 0, 0.08, 0));       // 腰帶
  if (side === 'blue') body.add(at(box(0.82, 0.9, 0.38, mat.pack), 0, 0.6, -0.44));   // 傘兵背包
  else {
    body.add(at(box(0.5, 0.5, 0.3, mat.pack), 0, 0.62, -0.42));                       // 德軍 A 字背具
    body.add(at(box(0.96, 0.84, 0.66, mat.uni), 0, -0.28, 0));                        // 國民擲彈兵長大衣下襬（溫特斯誤判成「精銳」的關鍵）
  }

  // 頭 + 鋼盔
  body.add(at(cyl(0.16, 0.16, 0.2, 6, mat.skin), 0, 1.12, 0));    // 頸
  body.add(at(box(0.42, 0.46, 0.42, mat.skin), 0, 1.36, 0));      // 頭
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), mat.helm);
  body.add(at(dome, 0, 1.5, 0));
  if (side === 'blue') body.add(at(cyl(0.4, 0.4, 0.06, 12, mat.helm), 0, 1.46, 0)); // M1 盔緣
  else body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.47, 0.24, 12, 1, true), mat.helm), 0, 1.42, 0)); // 鋼盔外擴帽簷

  // 手臂 + 武器
  const grip = new THREE.Vector3(0.18, 0.62, 0.6);   // 右手握把
  const fore = new THREE.Vector3(-0.06, 0.66, 0.96); // 左手前托
  body.add(strut(new THREE.Vector3(0.5, 0.95, 0.05), grip, 0.14, mat.uni));
  body.add(strut(new THREE.Vector3(-0.5, 0.95, 0.05), fore, 0.14, mat.uni));
  body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat.skin), grip.x, grip.y, grip.z)); // 手
  body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat.skin), fore.x, fore.y, fore.z));
  const wpn = makeWeapon(weapon, mat); wpn.position.copy(grip); body.add(wpn);

  // 姿態
  if (pose === 'advance') {            // 衝鋒:前傾、跨步
    legAt(0.28, 0.5, -0.35); legAt(-0.3, -0.45, -0.55);
    body.rotation.x = 0.32;
  } else if (pose === 'kneel') {       // 跪射
    legAt(0.3, 0.55, -1.0); legAt(-0.3, -1.35, -1.5);
    core.position.y = -0.42; body.rotation.x = 0.12;
  } else {                             // 站哨
    legAt(0.28, 0.02, -0.04); legAt(-0.28, -0.02, -0.04);
  }

  s.scale.setScalar(1.15);
  s.userData.phase = phase;            // M-3：行進微動作相位
  s.userData.pose = pose;              // 資產升級：換 glb 姿態時要知道原本是哪一種
  s.userData.side = side;
  s.userData.weapon = weapon;
  return s;
}

// 程序化小人在 group.scale = 1 時的身高（頭盔頂 ≈ HIP 1.45 + 1.5 + 盔半徑 0.34）。
// glb 士兵依這個高度對齊 bounding box，站在同一群裡才不會一高一矮。
const PROC_SOLDIER_H = 3.29;

// ── 班/組:一叢小人(依設定分姿態/武器/朝向) ────────────
function makeSquad(side, count, spread, seed, cfg, mat, troopers) {
  const g = new THREE.Group();
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const pose = cfg.poses[Math.floor(r() * cfg.poses.length)];
    const weapon = cfg.weapons[Math.floor(r() * cfg.weapons.length)];
    const sd = makeSoldier(side, pose, weapon, mat, r() * Math.PI * 2);
    sd.position.set((r() - 0.5) * spread * 2, 0, (r() - 0.5) * spread * 2);
    sd.rotation.y = cfg.face + (r() - 0.5) * 0.6;
    sd.scale.multiplyScalar(0.92 + r() * 0.16);
    sd.userData.baseY = 0;
    troopers.push(sd);
    g.add(sd);
  }
  return g;
}

// ── 105mm 榴彈砲(leFH 18 風格,砲口朝 +x 東) ────────────
function makeHowitzer(mat) {
  const g = new THREE.Group();

  // 砲架軸 + 兩輪(含輪轂與輪輻)
  g.add(at(cyl(0.18, 0.18, 4.2, 8, mat.dark), 0.2, 1.3, 0, Math.PI / 2));
  for (const sz of [-2.1, 2.1]) {
    g.add(at(cyl(1.5, 1.5, 0.45, 16, mat.dark), 0.2, 1.3, sz, Math.PI / 2));
    g.add(at(cyl(0.5, 0.5, 0.52, 10, mat.metal), 0.2, 1.3, sz, Math.PI / 2));
    for (let k = 0; k < 3; k++) g.add(at(box(0.12, 2.7, 0.12, mat.metal), 0.2, 1.3, sz, 0, 0, (k / 3) * Math.PI));
  }

  // 砲盾(斜板,朝 +x)
  g.add(at(box(0.25, 1.7, 3.7, mat.metal), 0.9, 1.55, 0));
  g.add(at(box(0.25, 1.25, 3.7, mat.metal), 0.78, 2.55, 0, 0, 0, 0.3));

  // 砲身:搖架 + 砲管 + 砲口 + 復進機 + 砲閂
  g.add(at(box(1.5, 0.72, 0.72, mat.metal), 1.85, 2.05, 0));        // 搖架
  g.add(at(cyl(0.42, 0.5, 5.2, 12, mat.metal), 4.2, 2.1, 0, 0, 0, Math.PI / 2)); // 砲管
  g.add(at(cyl(0.56, 0.56, 0.5, 12, mat.dark), 6.7, 2.1, 0, 0, 0, Math.PI / 2)); // 砲口制退器
  g.add(at(cyl(0.22, 0.22, 3.6, 8, mat.metal), 3.6, 2.62, 0, 0, 0, Math.PI / 2)); // 復進機
  g.add(at(box(0.95, 0.98, 0.98, mat.dark), 1.5, 2.1, 0));          // 砲閂

  // 分腿砲架 + 駐鋤
  for (const sz of [-1, 1]) {
    g.add(at(box(5.2, 0.45, 0.45, mat.dark), -2.4, 0.6, sz * 1.2, 0, sz * 0.16, 0));
    g.add(at(box(0.5, 0.85, 0.7, mat.metal), -4.8, 0.45, sz * 2.0));
  }

  // 彈藥(木箱 + 三發砲彈)
  g.add(at(box(1.5, 0.9, 1.0, mat.wood), -1.0, 0.45, 3.1));
  for (let k = 0; k < 3; k++) g.add(at(cyl(0.22, 0.22, 1.1, 8, mat.brass), -0.2 + k * 0.5, 0.22, 3.5, Math.PI / 2));

  g.scale.setScalar(0.95);
  return g;
}

// ── MG42 機槍巢(雙層沙包 + 三腳架 MG42 + 射手) ──────────
function makeMGNest(mat, troopers) {
  const outer = new THREE.Group();
  const g = new THREE.Group();   // 沙包＋機槍本體（之後整組換成 mg_nest.glb）
  outer.add(g);

  // 雙層沙包半圈(以 +x 為中心,西側 -x 開口為射界)
  for (let row = 0; row < 2; row++) {
    const n = 7, y = 0.45 + row * 0.62, rad = 3 - row * 0.35;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.62 + (i / (n - 1)) * Math.PI * 1.24 + (row ? 0.22 : 0);
      g.add(at(box(1.5, 0.62, 1.1, row ? mat.sand2 : mat.sand), Math.cos(a) * rad, y, Math.sin(a) * rad, 0, a, 0));
    }
  }

  // 三腳架 + MG42(砲口朝 -x)
  const apex = new THREE.Vector3(0.4, 1.2, 0);
  for (const f of [[-0.9, 0], [1.0, 0.95], [1.0, -0.95]]) {
    g.add(strut(new THREE.Vector3(apex.x + f[0], 0, f[1]), apex, 0.08, mat.gunmetal));
  }
  g.add(at(box(0.32, 0.32, 1.0, mat.gunmetal), apex.x, apex.y, apex.z));              // 機匣
  g.add(at(cyl(0.12, 0.12, 1.5, 8, mat.gunmetal), apex.x - 1.1, apex.y + 0.05, apex.z, 0, 0, Math.PI / 2)); // 槍管套
  g.add(at(box(0.16, 0.2, 0.7, mat.wood), apex.x + 0.65, apex.y - 0.02, apex.z));     // 槍托
  g.add(at(box(0.5, 0.42, 0.42, mat.dark), apex.x + 0.2, apex.y - 0.25, apex.z + 0.45)); // 彈箱

  // 射手(跪姿,面朝 -x 西)
  const gunner = makeSoldier('red', 'kneel', 'kar98', mat, 1.7);
  gunner.position.set(apex.x + 0.9, 0, apex.z); gunner.rotation.y = -Math.PI / 2;
  gunner.scale.multiplyScalar(0.95);
  gunner.userData.baseY = 0; troopers.push(gunner);
  outer.add(gunner);   // 射手掛在外層：換 glb 巢時不會被一起換掉

  outer.userData.hardware = g;
  return outer;
}

// ── 陣營光圈(地面識別環) ─────────────────────────────
function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.4;
  return ring;
}

const SEED = { 'winters-assault': 23, 'base-of-fire': 31, 'fox-platoon': 17, 'gren-1': 47, 'gren-2': 53 };

// 各兵種的姿態/武器/朝向。座標：北 = -z（敵在北、河堤側）、南 = +z（圩田、攻方）。
// 攻方（藍）面北推進 → face = π（模型 +z 對齊行進方向）；守方德軍（紅）面南迎擊 → face = 0。
const SQUAD_CFG = {
  assault:  { poses: ['advance', 'advance', 'kneel'], weapons: ['thompson', 'garand', 'garand'], face: Math.PI },
  support:  { poses: ['kneel', 'kneel', 'stand'],     weapons: ['bar'],                          face: Math.PI },
  infantry: { poses: ['advance', 'stand', 'advance'], weapons: ['garand'],                       face: Math.PI },
  garrison: { poses: ['stand', 'kneel', 'stand'],     weapons: ['kar98'],                        face: 0 },
  default:  { poses: ['stand'],                       weapons: ['garand'],                       face: 0 },
};

// L-4：手機無 shadow map 時的接地影（柔邊深色圓 sprite，貼地）
let _contactTex = null;
function contactShadowTexture() {
  if (_contactTex) return _contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(12,16,10,0.55)');
  grad.addColorStop(0.6, 'rgba(12,16,10,0.26)');
  grad.addColorStop(1, 'rgba(12,16,10,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  _contactTex = new THREE.CanvasTexture(c);
  _contactTex.colorSpace = THREE.SRGBColorSpace;
  return _contactTex;
}
function makeContactShadow(radius) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.2, radius * 2.2),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.18;
  return m;
}

export function createUnit(spec, { shadows = false } = {}) {
  const g = new THREE.Group();
  const mat = makeMats(spec.side);
  const troopers = [];
  let radius = 8;

  if (spec.kind === 'gun') {
    g.add(makeHowitzer(mat));
    g.add(makeRing(7, SIDE_COLOR[spec.side]));
    radius = 7;
  } else if (spec.kind === 'mg') {
    const nest = makeMGNest(mat, troopers);
    g.add(nest);
    g.userData.mgHardware = nest.userData.hardware;
    g.add(makeRing(6, SIDE_COLOR[spec.side]));
    radius = 6;
  } else {
    // 步兵/突擊隊/火力組/守軍 → 一叢小人
    const men = spec.strength?.men ?? 6;
    const count = Math.max(2, Math.min(9, Math.round(men / 4)));
    const spread = Math.max(4, (spec.length ?? 16) * 0.5);
    const cfg = SQUAD_CFG[spec.kind] ?? SQUAD_CFG.default;
    g.add(makeSquad(spec.side, count, spread, SEED[spec.id] ?? 7, cfg, mat, troopers));
    radius = Math.max(8, spread + 3);
    g.add(makeRing(radius, SIDE_COLOR[spec.side]));
  }

  if (shadows) {
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  } else {
    g.add(makeContactShadow(radius * 0.78));   // 手機：柔邊圓 sprite 當接地影
  }

  g.userData.troopers = troopers;   // M-3：主迴圈直接走訪做行進微動作
  return g;
}

// ══ 真實資產替換（asset-pipeline-spec §3）═══════════════════
// 姿態對照：程序化的 advance／kneel／stand → Blender 的 <pose>.glb。
// 「上刺刀衝鋒」的突擊隊用 crouch_run（低姿快跑），其餘推進用 advance_rifle。
const POSE_MODEL = { advance: 'advance_rifle', kneel: 'kneel_fire', stand: 'stand_rifle' };
// 德軍用 coat 變體：國民擲彈兵的長大衣正是溫特斯把他們誤判成「精銳」的關鍵，程序化版本也做了這件事。
const SIDE_TAG = { blue: 'us', red: 'de_coat' };
function poseModelId(side, pose, kind) {
  const p = (kind === 'assault' && pose === 'advance') ? 'crouch_run' : (POSE_MODEL[pose] ?? 'stand_rifle');
  return `soldier_${SIDE_TAG[side] ?? 'us'}_${p}`;
}
// 程序化武器名 → 武器 glb（掛在 glb 士兵的 hand_r 空節點上）
const WEAPON_MODEL = { thompson: 'thompson', bar: 'bar', garand: 'garand', kar98: 'kar98k' };

// ══ R1 骨架動畫（docs/realism-spec.md §R1.5）══════════════════
// 每兵一個 SkeletonUtils.clone 的 SkinnedMesh（幾何與 clip 共用、骨架與材質各自一份）、
// 每兵一個 AnimationMixer；clip 依「單位這一幀的實際移動速度」選，播放倍率 = 速度 ÷ clip 的
// extras.speed（腳不滑）。同班各兵用既有的 userData.phase 當起始相位，避免整班齊步。
const RIG_MODEL = { blue: 'soldier_rig_us', red: 'soldier_rig_de_coat' };

// rig glb 的身高（盔頂，公尺）—— 實際縮放仍由 fitToHeight 量，這裡只用於速度換算的預設值。
const RIG_HEIGHT_M = 1.752;

// 場景尺度 → 士兵自己的公尺。這場 1 場景單位 = 10 公尺，但小人是「放大的立體透視模型」
// （3.29 × 1.15 單位高 ≈ 真人的 20 倍），所以「腳會不會滑」要用小人自己的比例換算：
//   apparent m/s = 群組速度（場景單位／秒） ÷ （場景單位／模型公尺）
const UNITS_PER_METER = (PROC_SOLDIER_H * 1.15) / RIG_HEIGHT_M;   // ≈ 2.16
export function apparentSpeed(unitsPerSecond) {
  return Math.abs(unitsPerSecond || 0) / UNITS_PER_METER;
}

// 上刺刀衝鋒段（戰役分鐘）。這是全役的戲眼，一律 run ——
// diorama 尺度下單位在場上的「實際 m/s」本來就偏低（見 UNITS_PER_METER），
// 光靠 2.2 m/s 的速度門檻，正常播放速度下永遠跨不過去。
export const CHARGE_WINDOW = [320, 340];

const LOCOMOTION = new Set(['walk', 'run', 'crouch_walk']);
const DEFAULT_CLIP_SPEED = { walk: 1.4, run: 3.5, crouch_walk: 1.0 };

/**
 * 依單位狀態選 clip（純函式，單元測試打這支）。
 * @param {{kind?:string, pose?:string, speed?:number, battleT?:number, destroyed?:boolean}} s
 *        speed 是「換算到小人自己尺度」的 m/s（見 apparentSpeed）
 */
export function pickClip({ kind = 'infantry', pose = 'stand', speed = 0, battleT = 0, destroyed = false } = {}) {
  if (destroyed) return 'hit_fall';
  const charging = kind === 'assault' && battleT >= CHARGE_WINDOW[0] && battleT < CHARGE_WINDOW[1];
  if (charging) return 'run';
  if (speed > 2.2) return 'run';
  if (speed > 0.2) {
    // 接敵前的突擊隊是沿溝渠低姿接近（這場的地形邏輯），不是大步走
    return (kind === 'assault' && battleT < CHARGE_WINDOW[0]) ? 'crouch_walk' : 'walk';
  }
  if (pose === 'prone') return 'prone_fire';
  if (pose === 'kneel') return 'kneel_fire';
  if (kind === 'support') return 'prone_fire';   // 基底火力組的 .30 機槍手趴著打
  return 'idle';
}

/** 播放倍率 = 實際速度 ÷ clip 的 extras.speed；夾住上下限免得慢速時像定格 */
export function clipRate(clipName, speed, clipSpeed) {
  if (!LOCOMOTION.has(clipName)) return 1;
  const base = clipSpeed || DEFAULT_CLIP_SPEED[clipName] || 1.4;
  const r = speed / base;
  return Math.min(1.9, Math.max(0.6, r));
}

// 一個小兵的動畫狀態機
function makeTrooperAnim(root, clips, { phase = 0, pose = 'stand' } = {}) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of clips) {
    const a = mixer.clipAction(clip);
    a.setLoop(clip.name === 'hit_fall' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    if (clip.name === 'hit_fall') a.clampWhenFinished = true;
    actions.set(clip.name, a);
  }
  const frac = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
  const rec = {
    root, mixer, actions, pose, phase: frac, current: null,
    clipSpeed(name) { return actions.get(name)?.getClip()?.userData?.speed ?? 0; },
    play(name, rate, snap = false) {
      const next = actions.get(name);
      if (!next) return;
      const prev = rec.current ? actions.get(rec.current) : null;
      if (prev === next) { next.setEffectiveTimeScale(rate); return; }
      next.reset();
      next.setEffectiveTimeScale(rate);
      next.setEffectiveWeight(1);
      // 同班隨機相位（走路不齊步）；倒地是一次性的，一律從頭播
      next.time = name === 'hit_fall' ? 0 : frac * next.getClip().duration;
      next.play();
      if (prev) {
        if (snap) prev.stop();                    // 拖曳跳轉：直接切，不要淡入淡出的殘影
        else next.crossFadeFrom(prev, 0.22, true);
      }
      rec.current = name;
    },
    setRate(rate) {
      const a = rec.current ? actions.get(rec.current) : null;
      if (a) a.setEffectiveTimeScale(rate);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); },
  };
  return rec;
}

/**
 * 一個單位（班／組）的動畫器。main.js 每幀呼叫 update()。
 * mixer 更新頻率依畫質等級（high 每幀、medium 每 2 幀、low／手機 每 3 幀）。
 */
function createUnitAnimator(records, kind) {
  let stride = 1, frames = 0, acc = 0;
  return {
    records,
    kind,
    setStride(n) { stride = Math.max(1, Math.round(n) || 1); },
    /**
     * @param {number} dt 真實秒數
     * @param {{speed?:number, battleT?:number, destroyed?:boolean, snap?:boolean}} ctx
     *        speed：換算後的 m/s；snap：拖曳／跳轉後的第一幀（狀態直接對齊、不做淡入）
     */
    update(dt, { speed = 0, battleT = 0, destroyed = false, snap = false } = {}) {
      for (const r of records) {
        const want = pickClip({ kind, pose: r.pose, speed, battleT, destroyed });
        const rate = clipRate(want, speed, r.clipSpeed(want));
        if (want !== r.current) r.play(want, rate, snap);
        else r.setRate(rate);
      }
      acc += dt; frames++;
      if (snap || frames % stride === 0) {
        for (const r of records) r.mixer.update(acc);
        acc = 0;
      }
    },
    dispose() { for (const r of records) r.dispose(); records.length = 0; },
  };
}

// 每單位一份材質：clone 整棵樹的材質（幾何仍共用），維持「一起淡出、互不影響」的約定
function cloneWithOwnMaterials(root, cache) {
  const inst = root.clone(true);
  inst.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      if (!cache.has(m)) cache.set(m, normalizeMaterial(m.clone()));
      return cache.get(m);
    });
    o.material = next.length === 1 ? next[0] : next;
  });
  return inst;
}

/**
 * 把一個已建好的單位 Group 就地換成 glb 版本。載不到就什麼都不做（畫面維持程序化）。
 * 士兵優先走 R1 骨架動畫版（soldier_rig_*.glb）；rig 載不到才退回既有的靜態姿態 glb。
 * @param {object} opts
 * @param {boolean} opts.shadows
 * @param {object} [opts.quality] R5 參數（只用 mixerStride）
 * @param {(o:THREE.Object3D)=>void} [opts.register] CSM 材質註冊（R6：clone 後的材質一定要註冊）
 * @returns {Promise<{mg:boolean, soldiers:boolean, rig:boolean, missing:string[]}>}
 */
export async function applyUnitAssets(group, spec, assets, { shadows = false, quality = null, register = null } = {}) {
  const out = { mg: false, soldiers: false, rig: false, missing: [] };
  if (!assets) return out;
  const matCache = new Map();   // 這個單位自己的材質副本

  // ── MG 巢 ───────────────────────────────────────────
  if (spec.kind === 'mg' && group.userData.mgHardware) {
    const root = await assets.model('mg_nest');
    if (!root) out.missing.push('mg_nest');
    else {
      const hw = group.userData.mgHardware;
      const inst = cloneWithOwnMaterials(root, matCache);
      // 程序化沙包半圈外徑約 3 單位（直徑 6）；glb 依包圍盒寬度對齊
      const { scale } = fitToWidth(root, 6.4);
      inst.scale.setScalar(scale);
      inst.rotation.y = -Math.PI / 2;    // glb −Z 為正面；巢的射界朝西（-x）
      if (shadows) inst.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      hw.parent.add(inst);
      hw.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
      hw.parent.remove(hw);
      group.userData.mgHardware = inst;
      register?.(inst);
      out.mg = true;
    }
  }

  // ── 單兵 ────────────────────────────────────────────
  const troopers = group.userData.troopers ?? [];
  if (troopers.length) {
    const wpnIds = [...new Set(troopers.map((t) => WEAPON_MODEL[t.userData.weapon]).filter(Boolean))];
    const rigId = RIG_MODEL[spec.side] ?? RIG_MODEL.blue;
    const [rigRoot, ...wpnRoots] = await Promise.all([
      assets.model(rigId), ...wpnIds.map((id) => assets.model(id)),
    ]);
    const weapons = new Map(wpnIds.map((id, i) => [id, wpnRoots[i]]));

    if (rigRoot && (rigRoot.animations?.length ?? 0) > 0) {
      applyRigSoldiers(group, spec, troopers, rigRoot, weapons, matCache, { shadows, quality, register, out });
    } else {
      if (rigRoot) out.missing.push(`${rigId}（無 clip）`); else out.missing.push(rigId);
      await applyStaticSoldiers(group, spec, troopers, assets, weapons, matCache, { shadows, register, out });
    }
  }
  return out;
}

// ── R1：骨架動畫版（每兵一個 SkinnedMesh ＋ 一個 AnimationMixer） ────────
function applyRigSoldiers(group, spec, troopers, rigRoot, weapons, matCache, { shadows, quality, register, out }) {
  const fit = fitToHeight(rigRoot, PROC_SOLDIER_H).scale;
  const clips = rigRoot.animations;
  const records = [];
  const skinned = [];
  for (const tr of troopers) {
    const inst = skeletonClone(rigRoot);   // 骨架與 node 各一份，幾何與 clip 共用
    inst.scale.setScalar(fit);
    inst.rotation.y = Math.PI;             // 程序化小人面朝 +z、glb 慣例 −Z 為正面
    inst.traverse((o) => {
      if (!o.isMesh) return;
      // 材質每單位一份（淡出不外溢）
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const next = mats.map((m) => {
        if (!matCache.has(m)) matCache.set(m, normalizeMaterial(m.clone()));
        return matCache.get(m);
      });
      o.material = next.length === 1 ? next[0] : next;
      // 骨架動畫會走出 bind pose 的包圍盒（趴射、倒地），關掉 frustum culling 免得整具消失
      o.frustumCulled = false;
      if (shadows) o.castShadow = true;
    });
    // userData.troopers 是「每個小兵一個物件」的約定：一具 rig 有五個 SkinnedMesh
    // （制服／皮膚／盔／背具／靴各一個 primitive），只收第一個當這個兵的代表。
    const skin = [];
    inst.traverse((o) => { if (o.isSkinnedMesh) skin.push(o); });
    if (skin.length) skinned.push(skin[0]);
    // 武器掛右手骨頭（rig 的 hand_R 已經對好朝向，local transform 歸零即可）
    const hand = inst.getObjectByName('hand_R') ?? inst.getObjectByName('hand_r');
    const wpnId = WEAPON_MODEL[tr.userData.weapon];
    const wpn = wpnId ? weapons.get(wpnId) : null;
    if (hand && wpn) {
      const w = cloneWithOwnMaterials(wpn, matCache);
      w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); w.scale.setScalar(1);
      if (shadows) w.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      hand.add(w);
    } else if (wpnId && !wpn) out.missing.push(wpnId);

    for (const c of [...tr.children]) {
      c.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
      tr.remove(c);
    }
    // 原本的正弦起伏微動作由 clip 取代：把殘留的位移／傾角歸零
    tr.position.y = tr.userData.baseY ?? 0;
    tr.rotation.z = 0;
    tr.add(inst);
    records.push(makeTrooperAnim(inst, clips, { phase: tr.userData.phase ?? 0, pose: tr.userData.pose }));
  }
  const animator = createUnitAnimator(records, spec.kind);
  animator.setStride(quality?.mixerStride ?? 1);
  group.userData.animator = animator;
  // 規格 §R1.5：userData.troopers 改指向 SkinnedMesh
  group.userData.troopers = skinned;
  group.userData.trooperHosts = troopers;   // 外層 Object3D（位置／朝向仍掛在這一層）
  register?.(group);                        // R6：clone 出來的材質一定要註冊給 CSM
  out.soldiers = true;
  out.rig = true;
}

// ── 後備：既有的靜態姿態 glb（rig 載不到時） ─────────────────
async function applyStaticSoldiers(group, spec, troopers, assets, weapons, matCache, { shadows, register, out }) {
  const poseIds = [...new Set(troopers.map((t) => poseModelId(t.userData.side, t.userData.pose, spec.kind)))];
  const loaded = await Promise.all(poseIds.map((id) => assets.model(id)));
  const byId = new Map(poseIds.map((id, i) => [id, loaded[i]]));
  const missing = poseIds.filter((id) => !byId.get(id));
  if (missing.length) {
    out.missing.push(...missing);      // 有任何一個姿態缺就整單位維持程序化（免得一半 glb 一半積木）
    return;
  }
  const fitCache = new Map();
  for (const tr of troopers) {
    const id = poseModelId(tr.userData.side, tr.userData.pose, spec.kind);
    const root = byId.get(id);
    if (!fitCache.has(id)) fitCache.set(id, fitToHeight(root, PROC_SOLDIER_H).scale);
    const inst = cloneWithOwnMaterials(root, matCache);
    inst.scale.setScalar(fitCache.get(id));
    inst.rotation.y = Math.PI;       // 程序化小人面朝 +z、glb 慣例 −Z 為正面
    // 武器掛右手（hand_r 空節點與武器同為公尺單位，直接當子節點即可）
    const hand = inst.getObjectByName('hand_r');
    const wpnId = WEAPON_MODEL[tr.userData.weapon];
    const wpn = wpnId ? weapons.get(wpnId) : null;
    if (hand && wpn) hand.add(cloneWithOwnMaterials(wpn, matCache));
    else if (wpnId && !wpn) out.missing.push(wpnId);
    if (shadows) inst.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    for (const c of [...tr.children]) {
      c.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
      tr.remove(c);
    }
    tr.add(inst);
  }
  register?.(group);
  out.soldiers = true;
}
