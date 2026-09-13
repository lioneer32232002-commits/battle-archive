// 單位工廠 — 程序化模型:步兵班、突擊隊、火力組、德軍守軍、MG 巢
// 比照戰艦做法,模型尺度刻意放大以利辨識(stylized diorama)。
// 模型座標:單兵直立、面朝 +z(武器指 +z),由 rotation.y 決定朝向。
// 美術:分姿態(衝鋒/跪射/站哨)、M1 盔 vs 鋼盔、傘兵背具 vs 國民擲彈兵長大衣、
//   武器種類(Thompson/BAR/Garand/Kar98)、雙層沙包 MG42 巢含射手。
// 重要:材質「每單位一份」(makeMats),班內共用 → 整單位一起淡出;不同單位互不影響(避免炸一門砲四門全淡)。
//
// L-4 升級:①每個小兵記 userData.phase(用檔內 rng 保持可重現),單位工廠把小兵收進
//   group.userData.troopers 供主迴圈做行進微動作(M-3);②所有實體 mesh castShadow
//   (雪曼／StuG／MG 巢／榴彈砲一併投影);③無陰影(手機)時在單位底下放一張柔邊深色
//   圓 sprite 當接地影,避免小人「浮在草皮上」。
//   ④效能:每個小兵／車輛／機槍巢/火砲在建好之後「烘焙」成單一帶頂點色的 mesh
//     (bake(): 把各部件的世界矩陣壓進幾何、材質顏色寫成頂點色後 mergeGeometries)。
//     模型外觀完全不變,但 draw call 從每人約 22 個降到 1 個 —— 這是本場 fps 的關鍵,
//     陰影 pass 也跟著便宜非常多。小兵仍是獨立物件,M-3 行進微動作照常運作。
//
// ── 資產管線升級（docs/asset-pipeline-spec.md §3）─────────────────
// 雪曼／StuG／MG 巢／士兵改用 Blender glb：載入後把 glb 「烘焙成單一頂點色幾何」
// （bakeToVertexColors）再換掉原本那顆程序化 mesh 的 geometry。這樣做的三個理由：
//   ① draw call 不變（每個單位仍是 1 個）；② 材質仍是「每單位一份」，
//   destroyed 淡出改 color/opacity 不會波及其他單位；③ userData.troopers 與
//   M-3 行進微動作完全不用改（trooper 物件本身沒有被替換，只換了幾何）。
// glb 缺席（例如士兵還在建模）時什麼都不做 —— 程序化版本就是 fallback。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeToVertexColors, fitScale, collectByMaterial } from './assets.js';
import { SOLDIER_SCALE } from './rig.js';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const UNIFORM = { blue: 0x6f7049, red: 0x565a4e };   // 美軍橄欖綠 / 德軍灰綠
const HELMET = { blue: 0x4f5236, red: 0x3d4034 };
const METAL = 0x4a4d50;

const _UP = new THREE.Vector3(0, 1, 0);
const _M = new THREE.Matrix4();

// 把整棵子樹烘焙成單一 mesh:各部件材質顏色 → 頂點色,幾何 → 根物件的區域座標系
function bake(root, material) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(_M.multiplyMatrices(inv, m.matrixWorld));
    const c = m.material.color;
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(geo);
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), material);
  mesh.position.copy(root.position);
  mesh.quaternion.copy(root.quaternion);
  mesh.scale.copy(root.scale);
  mesh.userData = root.userData;
  return mesh;
}

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
    // 烘焙後全單位共用這一份(頂點色);淡出時整個單位一起變,行為與原本「班內共用材質」相同
    merged: new THREE.MeshLambertMaterial({ vertexColors: true }),
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

// 姿態 → Blender 士兵 glb 的檔名尾段（soldier.py 的 pose 名）
const POSE_MODEL = { advance: 'advance_rifle', kneel: 'kneel_fire', stand: 'stand_rifle' };
// 程序化武器種類 → 武器 glb（原點在握把）
const WEAPON_MODEL = { garand: 'garand', thompson: 'thompson', bar: 'bar', kar98: 'kar98k' };
// 程序化姿態 → 骨架動畫的「靜止姿態」（R1：靜止守軍 kneel_fire／prone_fire／idle）
const RIG_POSTURE = { advance: 'stand', kneel: 'kneel', stand: 'stand' };

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
  s.userData.phase = phase;            // 同班隨機相位（骨架動畫用，避免齊步）
  // R1 骨架動畫換件用：side／姿態／武器 → soldier_rig_<us|de>.glb ＋ hand_R 掛的武器
  s.userData.rig = { side, pose, weapon: WEAPON_MODEL[weapon] ?? null, posture: RIG_POSTURE[pose] ?? 'stand' };
  // glb 換件用：姿態 → Blender 士兵模型 ＋ 掛在 hand_r 的武器。
  // refMeters：所有姿態共用「站姿 1.75 公尺」換算出來的同一個縮放倍率。
  //   不可以逐姿態用 bounding box 對齊 —— 跪射的 glb 只有 1.36 公尺高，
  //   照 bbox 拉到同樣高度的話跪著的人會比站著的人還壯一圈。
  s.userData.modelSlot = {
    id: `soldier_${side === 'blue' ? 'us' : 'de'}_${POSE_MODEL[pose] ?? 'stand_rifle'}`,
    weapon: WEAPON_MODEL[weapon] ?? null,
    fit: 3.25, refMeters: 1.75, axis: 'y', rotY: Math.PI,
  };
  return bake(s, mat.merged);          // 烘焙成單一 mesh（外觀不變、draw call 從 ~22 降到 1）
}

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
    g.add(sd);
    troopers.push(sd);
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
  return bake(g, mat.merged);
}

// ── MG42 機槍巢(雙層沙包 + 三腳架 MG42 + 射手) ──────────
function makeMGNest(mat, troopers) {
  const g = new THREE.Group();

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

  const nest = bake(g, mat.merged);   // 沙包＋三腳架＋MG42 烘焙成單一 mesh
  nest.userData.modelSlot = { id: 'mg_nest', fit: 6.6, axis: 'x', rotY: Math.PI / 2 };   // glb 換件用

  // 射手(跪姿,面朝 -x 西) — 另外一個 mesh，要能做行進微動作
  const gunner = makeSoldier('red', 'kneel', 'kar98', mat, 1.7);
  gunner.position.set(apex.x + 0.9, 0, apex.z); gunner.rotation.y = -Math.PI / 2;
  gunner.scale.multiplyScalar(0.95);
  gunner.userData.baseY = 0;
  gunner.userData.phase = 1.7;
  const out = new THREE.Group();
  out.add(nest); out.add(gunner);
  troopers.push(gunner);
  return out;
}

// ── 裝甲車輛(雪曼戰車 / StuG 突擊砲;車頭與砲口朝 +z) ─────
function makeArmor(side, variant, mat) {
  const g = new THREE.Group();
  const body = mat.uni;                       // 美軍橄欖綠 / 德軍灰綠
  const track = mat.dark, steel = mat.gunmetal;

  // 履帶(兩側長條 + 路輪)
  for (const sx of [-1.7, 1.7]) {
    g.add(at(box(0.85, 1.5, 6.8, track), sx, 0.95, 0));
    for (let i = 0; i < 6; i++) g.add(at(cyl(0.58, 0.58, 0.92, 10, steel), sx, 0.8, -2.6 + i * 1.05, 0, 0, Math.PI / 2));
  }

  if (variant === 'stug') {
    // StuG:低矮車身、無砲塔、斜面戰鬥室、長砲低伸
    g.add(at(box(3.0, 1.3, 6.0, body), 0, 1.7, 0));                        // 車身
    g.add(at(box(2.8, 0.95, 3.6, body), 0, 2.6, -0.2));                    // 戰鬥室
    g.add(at(box(2.9, 0.7, 1.1, body), 0, 2.5, 1.9, -0.5));                // 前傾斜甲
    g.add(at(cyl(0.2, 0.24, 5.0, 10, steel), 0, 2.2, 3.4, Math.PI / 2));   // 75mm 長砲
    g.add(at(cyl(0.28, 0.28, 0.5, 10, track), 0, 2.2, 5.9, Math.PI / 2));  // 砲口
  } else {
    // 雪曼:較高車身、圓砲塔、75mm 砲、車長指揮塔
    g.add(at(box(3.4, 1.7, 6.2, body), 0, 1.85, 0));                       // 車身
    g.add(at(box(3.2, 0.7, 2.2, body), 0, 2.55, 2.0, -0.6));               // 前上斜甲
    g.add(at(cyl(1.5, 1.7, 1.4, 14, body), 0, 3.2, -0.3));                 // 砲塔
    g.add(at(box(1.2, 0.9, 1.0, steel), 0, 3.3, 1.3));                     // 防盾
    g.add(at(cyl(0.22, 0.26, 4.6, 10, steel), 0, 3.3, 3.6, Math.PI / 2));  // 75mm 砲
    g.add(at(cyl(0.32, 0.32, 0.45, 10, track), 0, 3.3, 5.9, Math.PI / 2)); // 砲口
    g.add(at(cyl(0.7, 0.7, 0.45, 12, body), 0.5, 3.95, -0.8));             // 車長指揮塔
  }
  g.scale.setScalar(1.05);
  const baked = bake(g, mat.merged);
  // glb 換件用：車身沿 +z 前進，Blender 模型正面是 −Z → 轉 180°；長度對齊程序化車身 6.8 單位
  baked.userData.modelSlot = { id: variant === 'stug' ? 'stug' : 'sherman', fit: 6.8, axis: 'z', rotY: Math.PI };
  return baked;
}

// ── 陣營光圈(地面識別環) ─────────────────────────────
function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 36),
    // depthTest:false → 識別環永遠畫在建築／地形之上,不被遮蓋(避免單位「躲在房子或高地下」)
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.5;
  ring.renderOrder = 5;
  ring.userData.noShadow = true;
  return ring;
}

// ── 接地影(手機無 shadow map 時的替代):柔邊深色圓 sprite 貼地 ──
let _contactTex = null;
function contactShadowTexture() {
  if (_contactTex) return _contactTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2 - 1);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  _contactTex = new THREE.CanvasTexture(c);
  _contactTex.colorSpace = THREE.SRGBColorSpace;   // 當 map 用的 CanvasTexture 一律標 sRGB
  return _contactTex;
}
function makeContactShadow(radius) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.22;
  m.userData.noShadow = true;
  return m;
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

export function createUnit(spec, { shadows = false } = {}) {
  const g = new THREE.Group();
  const mat = makeMats(spec.side);
  const troopers = [];
  let footprint = 8;

  if (spec.kind === 'gun') {
    g.add(makeHowitzer(mat));
    g.add(makeRing(7, SIDE_COLOR[spec.side]));
    footprint = 6;
  } else if (spec.kind === 'mg') {
    g.add(makeMGNest(mat, troopers));
    g.add(makeRing(6, SIDE_COLOR[spec.side]));
    footprint = 5;
  } else if (spec.kind === 'armor') {
    g.add(makeArmor(spec.side, spec.variant, mat));
    g.add(makeRing(10, SIDE_COLOR[spec.side]));
    footprint = 5.5;
  } else {
    // 步兵/突擊隊/火力組/守軍 → 一叢小人
    const men = spec.strength?.men ?? 6;
    const count = Math.max(2, Math.min(9, Math.round(men / 4)));
    const spread = Math.max(4, (spec.length ?? 16) * 0.5);
    const cfg = SQUAD_CFG[spec.kind] ?? SQUAD_CFG.default;
    g.add(makeSquad(spec.side, count, spread, SEED[spec.id] ?? 7, cfg, mat, troopers));
    g.add(makeRing(Math.max(8, spread + 3), SIDE_COLOR[spec.side]));
    footprint = spread + 2;
  }

  if (shadows) {
    // L-4：單位一律投影（雪曼／StuG 的長影是市鎮／圩田質感的關鍵）
    g.traverse((m) => { if (m.isMesh && !m.userData.noShadow) m.castShadow = true; });
  } else {
    g.add(makeContactShadow(footprint));   // 手機：柔邊接地影
  }

  g.userData.troopers = troopers;   // M-3：主迴圈直接走訪做行進微動作
  return g;
}

// ══════════════════════════════════════════════════════════════
// glb 換件（docs/asset-pipeline-spec.md §3）
// 走訪單位底下所有帶 userData.modelSlot 的 mesh，把 Blender glb 烘焙成頂點色幾何後
// 換掉 geometry；缺模型（還在建模／載入失敗）就原樣不動，程序化版本即 fallback。
// 幾何依 slot 快取：同姿態的士兵、同型號的車輛共用一份幾何（§3「同姿態共用幾何」）。
// ══════════════════════════════════════════════════════════════
const GEO_CACHE = new Map();

function bakedGeometry(assets, slot) {
  // 快取鍵含武器：同姿態同武器的小兵共用一份幾何（38 名小兵實際只烘出個位數份）
  const key = `${slot.id}|${slot.weapon ?? '-'}|${slot.fit}|${slot.axis}|${slot.rotY}`;
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const p = (async () => {
    const src = await assets.model(slot.id);
    if (!src) return null;
    let root = src;
    if (slot.weapon) {
      const wpn = await assets.model(slot.weapon);
      const hand = wpn ? src.getObjectByName('hand_r') : null;
      if (hand) {
        // 不動共用的 gltf.scene：整棵 clone 之後才把武器掛上去
        root = src.clone(true);
        const slot2 = root.getObjectByName('hand_r');
        const w = wpn.clone(true);
        w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); w.scale.set(1, 1, 1);
        slot2.add(w);
      }
    }
    const s = slot.refMeters ? slot.fit / slot.refMeters : fitScale(root, slot.fit, slot.axis);
    const mx = new THREE.Matrix4().makeRotationY(slot.rotY).multiply(new THREE.Matrix4().makeScale(s, s, s));
    return bakeToVertexColors(root, { matrix: mx });
  })().catch((e) => {
    console.warn('[carentan] 單位模型載入失敗，保留程序化版本：', slot.id, e?.message ?? e);
    return null;
  });
  GEO_CACHE.set(key, p);
  return p;
}

// ── R2 烘焙版（`<id>_baked.glb`）：單一材質＋貼圖，**不烘頂點色** ──────────────
// 幾何依 slot 快取（同型號的車輛共用）；材質每單位一份（clone），淡出才不會外溢。
const BAKED_CACHE = new Map();
function bakedModelGeometry(assets, slot) {
  const key = `baked|${slot.id}|${slot.fit}|${slot.axis}|${slot.rotY}`;
  if (BAKED_CACHE.has(key)) return BAKED_CACHE.get(key);
  const p = (async () => {
    const got = await assets.modelBaked(slot.id);
    if (!got || !got.baked) return null;
    const s = fitScale(got.src, slot.fit, slot.axis);
    const mx = new THREE.Matrix4().makeRotationY(slot.rotY).multiply(new THREE.Matrix4().makeScale(s, s, s));
    const groups = collectByMaterial(got.src, { matrix: mx });
    // 烘焙版整模一顆材質 → 所有 prim 併成一份幾何（1 draw call），uv 保留（貼圖要用）
    const geos = [];
    let material = null;
    for (const [, item] of groups) {
      geos.push(...item.geos);
      material = material ?? item.material;
    }
    if (!geos.length || !material) return null;
    return { geo: geos.length === 1 ? geos[0] : mergeGeometries(geos, false), material, id: got.id };
  })().catch((e) => {
    console.warn('[carentan] 烘焙版模型載入失敗，退回平塗版：', slot.id, e?.message ?? e);
    return null;
  });
  BAKED_CACHE.set(key, p);
  return p;
}

/**
 * @param {THREE.Group} group          createUnit 產出的單位
 * @param {object} assets              createAssetHub
 * @param {object} [o]
 * @param {object} [o.rigs]            createRigHub（R1 骨架士兵）；沒給就維持靜態 glb
 * @param {boolean} [o.baked]          桌機 high／medium：優先用 `<id>_baked.glb`
 * @param {(obj) => void} [o.register] CSM 材質註冊（environment.registerObject）
 * @param {boolean} [o.shadows]
 */
export async function applyUnitModels(group, assets, {
  toStandard = true, rigs = null, baked = false, register = null, shadows = false,
} = {}) {
  const slots = [];
  group.traverse((o) => { if (o.isMesh && o.userData?.modelSlot) slots.push(o); });
  if (!slots.length) return 0;
  let swapped = 0;

  // R1：士兵先換成 SkinnedMesh（材質每單位一份）
  const troopers = group.userData.troopers ?? [];
  if (rigs && troopers.length) {
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06 });
    const next = [];
    for (const mesh of troopers) {
      const info = mesh.userData?.rig;
      if (!info) { next.push(mesh); continue; }
      const unit = await rigs.spawn({
        side: info.side, weapon: info.weapon, material: skinMat, phase: mesh.userData.phase ?? 0,
      });
      if (!unit) { next.push(mesh); continue; }
      const root = unit.root;
      root.position.copy(mesh.position);
      root.rotation.set(0, mesh.rotation.y + Math.PI, 0);   // 骨架 glb 正面是 −Z
      root.scale.copy(mesh.scale).multiplyScalar(SOLDIER_SCALE);
      root.userData.phase = mesh.userData.phase ?? 0;
      unit.mesh.userData.phase = mesh.userData.phase ?? 0;
      unit.mesh.userData.posture = info.posture ?? 'stand';
      unit.mesh.userData.rigUnit = unit;
      if (shadows) unit.mesh.castShadow = true;
      const parent = mesh.parent ?? group;
      parent.add(root);
      parent.remove(mesh);
      mesh.geometry.dispose();
      next.push(unit.mesh);          // userData.troopers 改指向 SkinnedMesh
      swapped++;
    }
    group.userData.troopers = next;
    group.userData.rigged = next.some((m) => m.isSkinnedMesh);
    register?.(group);
  }

  for (const mesh of slots) {
    // 已經被骨架版換掉的小兵：parent 被拔掉了；沒換成功的仍然走靜態 glb（fallback）
    if (!mesh.parent) continue;
    // ① 烘焙版（單一材質＋貼圖）優先
    if (baked && !mesh.userData.rig) {
      const hit = await bakedModelGeometry(assets, mesh.userData.modelSlot);
      if (hit) {
        const old = mesh.geometry;
        mesh.geometry = hit.geo;
        mesh.material = hit.material.clone();      // 材質每單位一份（淡出不外溢）
        if (mesh.material.roughness != null) mesh.material.roughness = Math.max(0.35, mesh.material.roughness);
        mesh.material.envMapIntensity = 0.9;
        mesh.material.vertexColors = false;
        old.dispose();
        mesh.userData.modelApplied = hit.id;
        swapped++;
        continue;
      }
    }
    // ② 平塗版：烘成頂點色幾何後換掉（原有路徑）
    const geo = await bakedGeometry(assets, mesh.userData.modelSlot);
    if (!geo) continue;
    const old = mesh.geometry;
    mesh.geometry = geo;           // 幾何共用：只 dispose 被換掉的那份程序化幾何
    old.dispose();
    mesh.userData.modelApplied = mesh.userData.modelSlot.id;
    swapped++;
  }
  if (swapped && toStandard) {
    // 換上 glb 之後材質升級成 Standard（§3：roughness 下限 0.35、吃得到 HDRI 環境光）。
    // 仍舊「每單位一份」：用 Map 對映舊材質 → 新材質，同單位共用同一顆。
    const remap = new Map();
    group.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.vertexColors || !o.material.isMeshLambertMaterial) return;
      let m = remap.get(o.material.uuid);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
        remap.set(o.material.uuid, m);
      }
      o.material = m;
    });
  }
  return swapped;
}
