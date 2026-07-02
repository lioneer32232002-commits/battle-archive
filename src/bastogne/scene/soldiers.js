// 單位工廠 — 程序化模型:步兵班、散兵坑守軍、火力組、MG 巢、火砲、裝甲。
// 冬裝(阿登 1944/12):美軍缺冬衣→橄欖綠 M43 野戰服(少數披毛毯大衣)、鋼盔;
//   德軍(國民擲彈兵)→白色冬季偽裝罩衫＋白盔套(雪原上像幽靈,靠地面識別環辨敵我)。
// 模型座標:單兵直立、面朝 +z(武器指 +z),由 rotation.y 決定朝向。
//
// A-3 升級:每個小兵記 userData.phase(用檔內 rng 保持可重現);單位工廠把所有小兵 mesh
//   收進 group.userData.troopers 陣列,主迴圈直接走訪做「行進微動作」(起伏＋輕搖),
//   不必每幀 traverse 整個 group。靜止單位由主迴圈以 1/4 幅度或不動處理。
import * as THREE from 'three';

const SIDE_COLOR = { red: 0xd9442e, blue: 0x2e7bd9 };
const UNIFORM = { blue: 0x51573a, red: 0xdfe3e4 };   // 美軍橄欖綠 / 德軍白色偽裝罩衫
const COAT = { blue: 0x4a4f36, red: 0xcfd4d4 };
const HELMET = { blue: 0x464a33, red: 0xe2e6e6 };    // 美盔橄欖 / 德盔白套
const METAL = 0x4a4d50;

const _UP = new THREE.Vector3(0, 1, 0);

// ── 小工具 ───────────────────────────────────────────
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt, rb, h, s, m) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
function at(m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function strut(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 0.001;
  const m = cyl(r, r, len, 6, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(_UP, d.normalize());
  return m;
}

// 每單位一份材質(班內共用 → 整單位一起淡出;不同單位互不影響)
function makeMats(side) {
  const isUS = side === 'blue';
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  return {
    uni: L(UNIFORM[side]),
    coat: L(COAT[side]),
    pack: L(isUS ? 0x4c4c33 : 0xc6cccb),
    helm: L(HELMET[side]),
    skin: L(0xc39877),
    boot: L(0x211c18),
    web: L(isUS ? 0x40492f : 0xb9bfbe),
    wood: L(0x5a3f27),
    gunmetal: L(0x26241f),
    metal: L(METAL),
    dark: L(0x33352f),
    snow: L(0xe7eef4),
    sand: L(0x9a8c63),
    sand2: L(0x8a7c52),
    brass: L(0xb08a3e),
  };
}

// 可重現偽隨機
function rng(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 武器 ──────────────────────────────────────────────
function makeWeapon(type, mat) {
  const g = new THREE.Group();
  if (type === 'thompson') {
    g.add(at(box(0.13, 0.17, 0.95, mat.wood), 0, 0, 0.35));
    g.add(at(cyl(0.05, 0.05, 0.5, 6, mat.gunmetal), 0, 0.02, 0.95, Math.PI / 2));
    g.add(at(box(0.1, 0.34, 0.12, mat.gunmetal), 0, -0.22, 0.5));
    g.add(at(box(0.11, 0.22, 0.12, mat.wood), 0, -0.16, 0.78));
  } else if (type === 'bar') {
    g.add(at(box(0.13, 0.17, 1.25, mat.wood), 0, 0, 0.5));
    g.add(at(cyl(0.05, 0.05, 0.95, 6, mat.gunmetal), 0, 0.03, 1.45, Math.PI / 2));
    g.add(at(box(0.13, 0.32, 0.14, mat.gunmetal), 0, -0.2, 0.62));
    g.add(strut(new THREE.Vector3(0, 0.02, 1.75), new THREE.Vector3(0.28, -0.55, 1.95), 0.035, mat.gunmetal));
    g.add(strut(new THREE.Vector3(0, 0.02, 1.75), new THREE.Vector3(-0.28, -0.55, 1.95), 0.035, mat.gunmetal));
  } else if (type === 'kar98') {
    g.add(at(box(0.11, 0.15, 1.5, mat.wood), 0, 0, 0.55));
    g.add(at(cyl(0.045, 0.045, 0.7, 6, mat.gunmetal), 0, 0.04, 1.5, Math.PI / 2));
    g.add(at(box(0.07, 0.13, 0.07, mat.gunmetal), 0.11, 0.06, 0.5));
  } else {                                    // M1 Garand
    g.add(at(box(0.12, 0.16, 1.45, mat.wood), 0, 0, 0.52));
    g.add(at(cyl(0.045, 0.045, 0.8, 6, mat.gunmetal), 0, 0.04, 1.45, Math.PI / 2));
    g.add(at(box(0.1, 0.18, 0.14, mat.gunmetal), 0, -0.12, 0.32));
  }
  g.rotation.x = -0.1;
  return g;
}

// ── 單兵(分姿態;冬裝) ─────────────────────────────────
function makeSoldier(side, pose, weapon, mat, phase = 0) {
  const s = new THREE.Group();
  const core = new THREE.Group();
  s.add(core);
  const HIP = 1.45;

  function legAt(x, thigh, shin) {
    const hip = new THREE.Group();
    hip.position.set(x, HIP, 0);
    hip.add(at(box(0.42, 0.62, 0.48, mat.uni), 0, -0.31, 0));
    const knee = new THREE.Group(); knee.position.y = -0.62; hip.add(knee);
    knee.add(at(box(0.38, 0.6, 0.42, mat.uni), 0, -0.3, 0));
    knee.add(at(box(0.46, 0.3, 0.68, mat.boot), 0, -0.62, 0.14));
    hip.rotation.x = thigh; knee.rotation.x = shin;
    core.add(hip);
  }

  const body = new THREE.Group();
  body.position.y = HIP; core.add(body);
  body.add(at(box(1.04, 1.02, 0.64, mat.uni), 0, 0.55, 0));               // 軀幹(厚冬衣)
  for (const sx of [-0.27, 0.27]) body.add(at(box(0.12, 1.0, 0.05, mat.web), sx, 0.55, 0.32)); // 背帶
  body.add(at(box(1.08, 0.16, 0.68, mat.web), 0, 0.08, 0));               // 腰帶
  if (side === 'blue') {
    body.add(at(box(0.86, 0.9, 0.4, mat.pack), 0, 0.6, -0.46));           // 傘兵背包
    // 少數幸運兒披毛毯／大衣(缺冬衣是史實梗)
    if ((phase * 1000) % 3 < 1) body.add(at(box(1.1, 1.15, 0.78, mat.coat), 0, 0.2, 0));
  } else {
    body.add(at(box(0.52, 0.5, 0.32, mat.pack), 0, 0.62, -0.44));         // 德軍背具
    body.add(at(box(1.02, 0.9, 0.7, mat.coat), 0, 0.18, 0));              // 白色冬季罩衫下襬
  }
  // 雪肩(雙肩積雪)
  for (const sx of [-0.4, 0.4]) body.add(at(box(0.4, 0.1, 0.5, mat.snow), sx, 1.02, 0));

  // 頭 + 盔
  body.add(at(cyl(0.16, 0.16, 0.2, 6, mat.skin), 0, 1.12, 0));
  body.add(at(box(0.42, 0.46, 0.42, mat.skin), 0, 1.36, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), mat.helm);
  body.add(at(dome, 0, 1.5, 0));
  if (side === 'blue') body.add(at(cyl(0.4, 0.4, 0.06, 12, mat.helm), 0, 1.46, 0));
  else body.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.47, 0.24, 12, 1, true), mat.helm), 0, 1.42, 0));

  // 手臂 + 武器
  const grip = new THREE.Vector3(0.18, 0.62, 0.6);
  const fore = new THREE.Vector3(-0.06, 0.66, 0.96);
  body.add(strut(new THREE.Vector3(0.5, 0.95, 0.05), grip, 0.15, mat.uni));
  body.add(strut(new THREE.Vector3(-0.5, 0.95, 0.05), fore, 0.15, mat.uni));
  body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat.skin), grip.x, grip.y, grip.z));
  body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat.skin), fore.x, fore.y, fore.z));
  const wpn = makeWeapon(weapon, mat); wpn.position.copy(grip); body.add(wpn);

  // 姿態
  if (pose === 'advance') {            // 行進：前傾、跨步
    legAt(0.28, 0.5, -0.35); legAt(-0.3, -0.45, -0.55);
    body.rotation.x = 0.3;
  } else if (pose === 'kneel') {       // 跪射
    legAt(0.3, 0.55, -1.0); legAt(-0.3, -1.35, -1.5);
    core.position.y = -0.42; body.rotation.x = 0.12;
  } else if (pose === 'dig') {         // 蜷伏散兵坑(半沒入、縮著)
    legAt(0.26, 1.2, -1.6); legAt(-0.26, 1.2, -1.6);
    core.position.y = -0.9; body.rotation.x = 0.28;
  } else {                             // 站哨
    legAt(0.28, 0.02, -0.04); legAt(-0.28, -0.02, -0.04);
  }

  s.scale.setScalar(1.15);
  s.userData.phase = phase;            // A-3：行進微動作相位
  return s;
}

// ── 班/組 ──────────────────────────────────────────────
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

// ── 105mm 榴彈砲(leFH／M2 風格,砲口朝 +x) ────────────────
function makeHowitzer(mat) {
  const g = new THREE.Group();
  g.add(at(cyl(0.18, 0.18, 4.2, 8, mat.dark), 0.2, 1.3, 0, Math.PI / 2));
  for (const sz of [-2.1, 2.1]) {
    g.add(at(cyl(1.5, 1.5, 0.45, 16, mat.dark), 0.2, 1.3, sz, Math.PI / 2));
    g.add(at(cyl(0.5, 0.5, 0.52, 10, mat.metal), 0.2, 1.3, sz, Math.PI / 2));
    for (let k = 0; k < 3; k++) g.add(at(box(0.12, 2.7, 0.12, mat.metal), 0.2, 1.3, sz, 0, 0, (k / 3) * Math.PI));
  }
  g.add(at(box(0.25, 1.7, 3.7, mat.metal), 0.9, 1.55, 0));
  g.add(at(box(0.25, 1.25, 3.7, mat.metal), 0.78, 2.55, 0, 0, 0, 0.3));
  g.add(at(box(1.5, 0.72, 0.72, mat.metal), 1.85, 2.05, 0));
  g.add(at(cyl(0.42, 0.5, 5.2, 12, mat.metal), 4.2, 2.1, 0, 0, 0, Math.PI / 2));
  g.add(at(cyl(0.56, 0.56, 0.5, 12, mat.dark), 6.7, 2.1, 0, 0, 0, Math.PI / 2));
  g.add(at(cyl(0.22, 0.22, 3.6, 8, mat.metal), 3.6, 2.62, 0, 0, 0, Math.PI / 2));
  g.add(at(box(0.95, 0.98, 0.98, mat.dark), 1.5, 2.1, 0));
  for (const sz of [-1, 1]) {
    g.add(at(box(5.2, 0.45, 0.45, mat.dark), -2.4, 0.6, sz * 1.2, 0, sz * 0.16, 0));
    g.add(at(box(0.5, 0.85, 0.7, mat.metal), -4.8, 0.45, sz * 2.0));
  }
  g.scale.setScalar(0.95);
  return g;
}

// ── MG 機槍巢(雙層沙包 + 三腳架 + 射手) ────────────────────
function makeMGNest(mat, troopers) {
  const g = new THREE.Group();
  for (let row = 0; row < 2; row++) {
    const n = 7, y = 0.45 + row * 0.62, rad = 3 - row * 0.35;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.62 + (i / (n - 1)) * Math.PI * 1.24 + (row ? 0.22 : 0);
      g.add(at(box(1.5, 0.62, 1.1, row ? mat.sand2 : mat.sand), Math.cos(a) * rad, y, Math.sin(a) * rad, 0, a, 0));
    }
  }
  const apex = new THREE.Vector3(0.4, 1.2, 0);
  for (const f of [[-0.9, 0], [1.0, 0.95], [1.0, -0.95]]) {
    g.add(strut(new THREE.Vector3(apex.x + f[0], 0, f[1]), apex, 0.08, mat.gunmetal));
  }
  g.add(at(box(0.32, 0.32, 1.0, mat.gunmetal), apex.x, apex.y, apex.z));
  g.add(at(cyl(0.12, 0.12, 1.5, 8, mat.gunmetal), apex.x - 1.1, apex.y + 0.05, apex.z, 0, 0, Math.PI / 2));
  g.add(at(box(0.16, 0.2, 0.7, mat.wood), apex.x + 0.65, apex.y - 0.02, apex.z));
  g.add(at(box(0.5, 0.42, 0.42, mat.dark), apex.x + 0.2, apex.y - 0.25, apex.z + 0.45));
  const gunner = makeSoldier('red', 'kneel', 'kar98', mat, 1.7);
  gunner.position.set(apex.x + 0.9, 0, apex.z); gunner.rotation.y = -Math.PI / 2;
  gunner.scale.multiplyScalar(0.95);
  gunner.userData.baseY = 0; troopers.push(gunner);
  g.add(gunner);
  return g;
}

// ── 裝甲(美軍雪曼 / 德軍四號戰車;車頭與砲口朝 +z) ─────────
function makeArmor(side, variant, mat) {
  const g = new THREE.Group();
  const body = side === 'blue' ? new THREE.MeshLambertMaterial({ color: 0x4b5140 }) : new THREE.MeshLambertMaterial({ color: 0xc9cfce });
  const track = mat.dark, steel = mat.gunmetal;
  for (const sx of [-1.7, 1.7]) {
    g.add(at(box(0.85, 1.5, 6.8, track), sx, 0.95, 0));
    for (let i = 0; i < 6; i++) g.add(at(cyl(0.58, 0.58, 0.92, 10, steel), sx, 0.8, -2.6 + i * 1.05, 0, 0, Math.PI / 2));
  }
  if (variant === 'panzer') {
    // 德軍四號戰車:白色冬季塗裝、方正砲塔、長 75mm
    g.add(at(box(3.4, 1.6, 6.2, body), 0, 1.8, 0));
    g.add(at(box(3.0, 1.0, 3.4, body), 0, 2.7, -0.2));                     // 砲塔(方正)
    g.add(at(box(1.1, 0.85, 1.0, steel), 0, 2.75, 1.3));
    g.add(at(cyl(0.2, 0.24, 5.2, 10, steel), 0, 2.75, 3.6, Math.PI / 2));  // 長 75mm
    g.add(at(cyl(0.28, 0.28, 0.5, 10, track), 0, 2.75, 6.1, Math.PI / 2));
  } else {
    // 雪曼:圓砲塔、75mm、車長塔
    g.add(at(box(3.4, 1.7, 6.2, body), 0, 1.85, 0));
    g.add(at(box(3.2, 0.7, 2.2, body), 0, 2.55, 2.0, -0.6));
    g.add(at(cyl(1.5, 1.7, 1.4, 14, body), 0, 3.2, -0.3));
    g.add(at(box(1.2, 0.9, 1.0, steel), 0, 3.3, 1.3));
    g.add(at(cyl(0.22, 0.26, 4.6, 10, steel), 0, 3.3, 3.6, Math.PI / 2));
    g.add(at(cyl(0.32, 0.32, 0.45, 10, track), 0, 3.3, 5.9, Math.PI / 2));
    g.add(at(cyl(0.7, 0.7, 0.45, 12, body), 0.5, 3.95, -0.8));
  }
  g.scale.setScalar(1.05);
  return g;
}

// ── 陣營光圈(地面識別環;畫於地形之上不被遮蓋) ──────────────
function makeRing(radius, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.5;
  ring.renderOrder = 5;
  return ring;
}

const SEED = { 'easy-line': 23, 'easy-2plt': 31, 'easy-mortars': 17, 'noville-team': 41, 'vg-assault': 47, 'vg-north': 53, 'patrol': 29 };

// 各兵種的姿態/武器/朝向。座標:北 = -z(敵在北、佛伊側)、南 = +z(森林縱深)。
// 守方美軍(藍)面北迎敵 → face = 0(模型 +z 對齊 -z? 見 main.js facing 覆寫);攻方德軍(紅)面南 → face = π。
const SQUAD_CFG = {
  line:     { poses: ['dig', 'kneel', 'dig'],          weapons: ['garand', 'garand', 'thompson'], face: 0 },
  assault:  { poses: ['advance', 'advance', 'kneel'],  weapons: ['thompson', 'garand', 'garand'], face: Math.PI },
  support:  { poses: ['kneel', 'kneel', 'dig'],        weapons: ['bar'],                          face: 0 },
  infantry: { poses: ['advance', 'stand', 'advance'],  weapons: ['garand'],                       face: Math.PI },
  garrison: { poses: ['stand', 'kneel', 'stand'],      weapons: ['kar98'],                        face: Math.PI },
  grenadier:{ poses: ['advance', 'advance', 'kneel'],  weapons: ['kar98'],                        face: Math.PI },
  default:  { poses: ['stand'],                        weapons: ['garand'],                       face: 0 },
};

export function createUnit(spec) {
  const g = new THREE.Group();
  const mat = makeMats(spec.side);
  const troopers = [];

  if (spec.kind === 'gun') {
    g.add(makeHowitzer(mat));
    g.add(makeRing(7, SIDE_COLOR[spec.side]));
  } else if (spec.kind === 'mg') {
    g.add(makeMGNest(mat, troopers));
    g.add(makeRing(6, SIDE_COLOR[spec.side]));
  } else if (spec.kind === 'armor') {
    g.add(makeArmor(spec.side, spec.variant, mat));
    g.add(makeRing(10, SIDE_COLOR[spec.side]));
  } else {
    const men = spec.strength?.men ?? 6;
    const count = Math.max(2, Math.min(9, Math.round(men / 4)));
    const spread = Math.max(4, (spec.length ?? 16) * 0.5);
    const cfg = SQUAD_CFG[spec.kind] ?? SQUAD_CFG.default;
    g.add(makeSquad(spec.side, count, spread, SEED[spec.id] ?? 7, cfg, mat, troopers));
    g.add(makeRing(Math.max(8, spread + 3), SIDE_COLOR[spec.side]));
  }

  g.userData.troopers = troopers;   // A-3：主迴圈直接走訪做行進微動作
  return g;
}
