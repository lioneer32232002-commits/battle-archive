// C-47 運輸機群(D 日夜跳)與傘兵 — 取代 midway 的艦載機。
// C-47 帶 D 日識別「入侵條紋」(黑白相間);傘兵為下降的傘花。
import * as THREE from 'three';

const BODY = 0x6b6f63;
const STRIPE_L = 0xe7e2d4;
const STRIPE_D = 0x23262c;
const CHUTE = 0x6f7049; // 101 師迷彩傘(橄欖綠)

// ── C-47 ─────────────────────────────────────────────
function makeC47() {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: BODY });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4d48 });

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 14, 12), body);
  fuse.rotation.x = Math.PI / 2; g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 12), body);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -8.3; g.add(nose);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(25, 0.5, 3.4), body);
  wing.position.z = -0.6; g.add(wing);
  for (const sx of [-5.2, 5.2]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.2, 10), dark);
    eng.rotation.x = Math.PI / 2; eng.position.set(sx, -0.1, -1.6); g.add(eng);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 2.6), body);
  fin.position.set(0, 1.4, 6.2); g.add(fin);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.35, 2.2), body);
  stab.position.set(0, 0, 6.4); g.add(stab);

  // 入侵條紋(機尾段環帶,黑白相間)
  for (let i = 0; i < 5; i++) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.26, 6, 14),
      new THREE.MeshLambertMaterial({ color: i % 2 ? STRIPE_D : STRIPE_L })
    );
    band.position.z = 2.4 + i * 0.55; g.add(band);
  }
  // 夜航編隊燈(夜跳辨識):左翼紅、右翼綠、尾部藍(MeshBasic 不受光,夜裡仍亮)
  const lit = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); g.add(m);
  };
  lit(0xff3b30, -12.4, 0, -0.6);
  lit(0x34c759, 12.4, 0, -0.6);
  lit(0x66b3ff, 0, 1.5, 6.2);

  g.scale.setScalar(1.25);
  return g;
}

export function createAirGroup(spec) {
  const g = new THREE.Group();
  for (let i = 0; i < spec.count; i++) {
    const p = makeC47();
    const row = Math.ceil(i / 2);
    const sideSign = i % 2 === 0 ? 1 : -1;
    p.position.set(sideSign * row * 16, (i % 3) * 2, row * 13);
    p.userData.phase = i * 1.7;
    g.add(p);
  }
  g.userData.spec = spec;
  g.visible = false;
  return g;
}

export function updateAirGroup(group, pos, time, altitude = 95) {
  group.position.set(pos.x, altitude, pos.z);
  group.rotation.y = -pos.heading;
  for (const p of group.children) {
    p.position.y = (p.userData.phase % 3) * 2 + Math.sin(time * 1.5 + p.userData.phase) * 1.2;
  }
}

// ── 傘兵(下降傘花) ───────────────────────────────────
function rng(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function makeChute() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: CHUTE })
  );
  dome.position.y = 6; g.add(dome);
  const trooper = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.6, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x55583c })
  );
  g.add(trooper);
  for (const sx of [-1.6, 1.6]) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 4), new THREE.MeshLambertMaterial({ color: 0xcfc8b4 }));
    line.position.set(sx, 3.2, 0); line.rotation.z = sx * 0.05; g.add(line);
  }
  return g;
}

// 傘兵場:散佈於空降區,於跳傘時間窗自高空下降至地面
export function createParatroopers(count = 26) {
  const g = new THREE.Group();
  const r = rng(99);
  for (let i = 0; i < count; i++) {
    const c = makeChute();
    const x = -360 + r() * 480; // 散落區(西北延伸)
    const z = -320 + r() * 420;
    c.position.set(x, 0, z);
    c.userData = { x, z, topY: 150 + r() * 90, phase: r() * 0.5, sway: r() * Math.PI * 2 };
    g.add(c);
  }
  g.visible = false;
  return g;
}

// f01:跳傘時間窗進度(0..1)
export function updateParatroopers(group, f01, time) {
  for (const c of group.children) {
    const f = Math.min(1, Math.max(0, (f01 - c.userData.phase) / (1 - c.userData.phase)));
    c.position.y = c.userData.topY * (1 - f);
    c.position.x = c.userData.x + Math.sin(time * 0.6 + c.userData.sway) * 3 * (1 - f);
    c.visible = f > 0 && f < 1;
  }
}
