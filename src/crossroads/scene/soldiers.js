// 單位工廠 — 程序化模型:步兵班、突擊隊、火力組、德軍守軍、MG 巢
// 比照戰艦做法,模型尺度刻意放大以利辨識(stylized diorama)。
// 模型座標:單兵直立、面朝 +z(武器指 +z),由 rotation.y 決定朝向。
// 美術:分姿態(衝鋒/跪射/站哨)、M1 盔 vs 鋼盔、傘兵背具 vs 國民擲彈兵長大衣、
//   武器種類(Thompson/BAR/Garand/Kar98)、雙層沙包 MG42 巢含射手。
// 重要:材質「每單位一份」(makeMats),班內共用 → 整單位一起淡出;不同單位互不影響(避免炸一門砲四門全淡)。
import * as THREE from 'three';

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
function makeSoldier(side, pose, weapon, mat) {
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
  return s;
}

// ── 班/組:一叢小人(依設定分姿態/武器/朝向) ────────────
function makeSquad(side, count, spread, seed, cfg, mat) {
  const g = new THREE.Group();
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const pose = cfg.poses[Math.floor(r() * cfg.poses.length)];
    const weapon = cfg.weapons[Math.floor(r() * cfg.weapons.length)];
    const sd = makeSoldier(side, pose, weapon, mat);
    sd.position.set((r() - 0.5) * spread * 2, 0, (r() - 0.5) * spread * 2);
    sd.rotation.y = cfg.face + (r() - 0.5) * 0.6;
    sd.scale.multiplyScalar(0.92 + r() * 0.16);
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
function makeMGNest(mat) {
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

  // 射手(跪姿,面朝 -x 西)
  const gunner = makeSoldier('red', 'kneel', 'kar98', mat);
  gunner.position.set(apex.x + 0.9, 0, apex.z); gunner.rotation.y = -Math.PI / 2;
  gunner.scale.multiplyScalar(0.95);
  g.add(gunner);

  return g;
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

export function createUnit(spec) {
  const g = new THREE.Group();
  const mat = makeMats(spec.side);

  if (spec.kind === 'gun') {
    g.add(makeHowitzer(mat));
    g.add(makeRing(7, SIDE_COLOR[spec.side]));
    return g;
  }
  if (spec.kind === 'mg') {
    g.add(makeMGNest(mat));
    g.add(makeRing(6, SIDE_COLOR[spec.side]));
    return g;
  }

  // 步兵/突擊隊/火力組/守軍 → 一叢小人
  const men = spec.strength?.men ?? 6;
  const count = Math.max(2, Math.min(9, Math.round(men / 4)));
  const spread = Math.max(4, (spec.length ?? 16) * 0.5);
  const cfg = SQUAD_CFG[spec.kind] ?? SQUAD_CFG.default;
  g.add(makeSquad(spec.side, count, spread, SEED[spec.id] ?? 7, cfg, mat));
  g.add(makeRing(Math.max(8, spread + 3), SIDE_COLOR[spec.side]));
  return g;
}
