// 卡倫坦之役（溫特斯三部曲 · 二部曲）3D 模擬 — 主程式
// 美術升級（見 docs/art-upgrade-spec.md）：ACES 色調映射、桌機陰影＋後製、動態解析度、
//   Catmull-Rom 曲線插值＋朝向阻尼、士兵行進微動作、鏡頭手感（手持／震動／前置量）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TIME_START, TIME_END, units, events, sides, outcome, aces, tactics,
} from './data/battle.js';
import { unitStateAt, newEvents } from './engine/timeline.js';
import { createEnvironment } from './scene/environment.js';
import { createCarentanTerrain } from './scene/terrain.js';
import { createUnit } from './scene/soldiers.js';
import { Effects } from './scene/effects.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';
import { AudioEngine } from './scene/audio.js';
import { createComposer } from './scene/postfx.js';

const isMobile = window.matchMedia('(max-width: 640px)').matches;
const LABEL_SCALE = isMobile ? 0.6 : 1;
const SHADOWS = !isMobile;   // P-2：陰影桌機限定
const POSTFX = !isMobile;    // P-3：後製桌機限定

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const DPR_CAP = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(DPR_CAP);
renderer.setSize(window.innerWidth, window.innerHeight);
// P-1：ACES 色調映射（手機桌機都開；environment.js 調色盤已據此重校）
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  // three r184 已棄用 PCFSoftShadowMap（會每次載入噴 deprecation 警告，且內部本來就退回 PCF），
  // 直接用 PCFShadowMap：畫面等價，console 乾淨。
  renderer.shadowMap.type = THREE.PCFShadowMap;
}
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);
camera.position.set(-92, 80, 116);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-8, 0, 2);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 20;
controls.maxDistance = 3000;
controls.enableDamping = true;

const environment = createEnvironment(scene, { shadows: SHADOWS, mobile: isMobile });
const terrain = createCarentanTerrain(scene, { shadows: SHADOWS, mobile: isMobile });
const effects = new Effects(scene, { mobile: isMobile });
const director = new Director(camera, controls);
const audio = new AudioEngine();

// P-3：後製 composer（桌機）；手機直接 renderer.render
const post = POSTFX ? createComposer(renderer, scene, camera) : null;
function renderFrame(dt) {
  if (post) post.render(dt);
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (post) post.setSize(window.innerWidth, window.innerHeight);
});

// 地名標籤
for (const p of terrain.places) {
  const lab = makeLabel(p.name, { side: p.side });
  lab.position.set(p.pos.x, p.pos.y, p.pos.z);
  lab.scale.multiplyScalar(0.29 * LABEL_SCALE);
  scene.add(lab);
}

// ── 單位 ─────────────────────────────────────────────
const unitObjs = new Map();
for (const u of units) {
  const group = createUnit(u, { shadows: SHADOWS });
  scene.add(group);
  if (u.kind !== 'mg') {   // 機槍火力點不掛 3D 標籤（避免路口處標籤打架）
    const label = makeLabel(u.name, { side: u.side });
    label.position.y = u.labelY ?? 13;   // 市鎮密集區各單位錯開高度,減少重疊
    label.scale.multiplyScalar(0.23 * LABEL_SCALE);
    group.add(label);
  }
  const destroyed = (u.statusChanges ?? []).find((c) => c.status === 'destroyed');
  unitObjs.set(u.id, {
    group, spec: u, downT: destroyed ? destroyed.t : null,
    troopers: group.userData.troopers ?? [],
    curRot: u.facing != null ? u.facing : 0,
    prevX: u.track[0].x, prevZ: u.track[0].z,
  });
  group.rotation.y = u.facing != null ? u.facing : 0;
}

// 部隊大標籤(跟隨)
const formationLabels = [
  { unit: 'easy-assault', label: makeLabel('E 連 · 506 PIR', { side: 'blue', big: true, sub: '溫特斯 · 約 120 人' }), dy: 34 },
  { unit: 'ss-pzgren', label: makeLabel('第 17 SS 裝甲擲彈兵', { side: 'red', big: true, sub: '血腥溝反撲 · 約 200 人' }), dy: 30 },
];
for (const f of formationLabels) {
  f.label.scale.multiplyScalar(0.34 * LABEL_SCALE);
  scene.add(f.label);
}

// ── 關鍵人物標記(可點開小卡) ────────────────────────
const aceObjs = aces.map((ace) => {
  const g = new THREE.Group();
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd97a })
  );
  pin.position.y = 3; pin.rotation.x = Math.PI; g.add(pin);
  const label = makeLabel('★ ' + ace.name, { side: ace.side });
  label.position.y = 10; label.scale.multiplyScalar(0.3 * LABEL_SCALE);
  g.add(label);
  g.position.set(ace.pos.x, 0, ace.pos.z);
  g.userData.figureId = ace.id;
  g.visible = false;
  scene.add(g);
  return { ace, group: g };
});

// ── 戰術幾何疊圖(招牌手法 1) ─────────────────────────
function buildTacticsOverlay() {
  const g = new THREE.Group();
  const pts = tactics.flankPath.map((p) => new THREE.Vector3(p.x, 1.6, p.z));
  const flank = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x5ea8ff })
  );
  g.add(flank);
  for (const b of tactics.baseOfFire) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(1.8, 5, 6), new THREE.MeshBasicMaterial({ color: 0x5ea8ff }));
    m.position.set(b.x, 2.5, b.z); g.add(m);
    for (const gid of tactics.gunOrder) {
      const go = unitObjs.get(gid);
      if (!go) continue;
      const gp = go.spec.track[0];
      const sl = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.x, 2.5, b.z), new THREE.Vector3(gp.x, 2.5, gp.z)]),
        new THREE.LineBasicMaterial({ color: 0x9ec9ff, transparent: true, opacity: 0.26 })
      );
      g.add(sl);
    }
  }
  g.visible = false;
  scene.add(g);
  return g;
}
const tacticsOverlay = buildTacticsOverlay();

// ── 播放狀態 ─────────────────────────────────────────
let battleT = TIME_START;
let prevT = TIME_START;
let playing = false;
let speed = 2;
let started = false;
let summaryShown = false;
let snapRot = false;   // 拖曳／跳轉後下一幀直接對齊朝向（不做阻尼）

const hud = createHUD({
  onStart: () => {
    started = true; playing = true;
    hud.setPlaying(true);
    audio.init();
    triggerEventsBetween(TIME_START - 1, battleT);
  },
  onPlayToggle: () => { if (!started) return; playing = !playing; hud.setPlaying(playing); },
  onSpeedChange: (s) => (speed = s),
  onScrub: (t) => {
    battleT = t; prevT = t; summaryShown = false; snapRot = true;
    effects.clearTransients(); hud.hideEvent(); hud.hideSummary(); hud.hideIntel();
  },
  onJump: (t) => {
    battleT = t; prevT = t; summaryShown = false; snapRot = true;
    effects.clearTransients(); hud.hideSummary();
    const e = events.find((ev) => ev.t === t);
    if (e) fireEvent(e);
    hud.setTime(t);
  },
  onModeToggle: (mode) => director.setMode(mode),
  onReplay: () => {
    battleT = TIME_START; prevT = TIME_START; summaryShown = false; playing = true; snapRot = true;
    effects.clearTransients(); hud.hideSummary(); hud.hideIntel(); hud.setPlaying(true);
    triggerEventsBetween(TIME_START - 1, battleT);
  },
  onVolume: (v) => audio.setVolume(v),
  onAudioToggle: (on) => audio.setEnabled(on),
});

// 點擊 3D 中的人物標記 → 開啟小卡
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _fwd = new THREE.Vector3();
let downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const targets = aceObjs.filter((a) => a.group.visible).map((a) => a.group);
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && !o.userData.figureId) o = o.parent;
  if (o && o.userData.figureId) hud.openFigure(o.userData.figureId);
});

// ── 事件 ─────────────────────────────────────────────
function eventCameraTarget(e) {
  if (e.camera?.unit) {
    const o = unitObjs.get(e.camera.unit);
    if (o) {
      const st = unitStateAt(o.spec, e.t);
      return new THREE.Vector3(st.pos.x, 0, st.pos.z);
    }
  }
  return new THREE.Vector3(e.camera?.pos?.x ?? 0, 0, e.camera?.pos?.z ?? 0);
}

function fireEvent(e) {
  hud.showEvent(e);
  if (e.camera?.unit) {
    // 跟隨鏡頭:持續追著該單位
    const o = unitObjs.get(e.camera.unit);
    if (o) {
      director.follow(() => {
        const st = unitStateAt(o.spec, battleT);
        return new THREE.Vector3(st.pos.x, 0, st.pos.z);
      }, e.camera.dist ?? 220, e.camera.elev ?? 0.5, e.camera.az);
    }
  } else {
    director.clearFollow();
    director.flyTo(eventCameraTarget(e), e.camera?.dist ?? 260);
  }
  if (e.device === 'intel' && e.intel) hud.showIntel(e.intel);
  else hud.hideIntel();
  for (const fx of e.fx ?? []) runFx(fx);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) fireEvent(e);
}

const _fxPos = new THREE.Vector3();
const _axis = new THREE.Vector3();
// L-5：曳光線的射向 — 取該點附近最近的藍方與紅方單位，沿兩者連線對射（不改任何事件資料）
function fireAxis(pos) {
  let bx = null, bd = Infinity, rx = null, rd = Infinity;
  for (const [, o] of unitObjs) {
    if (!o.group.visible) continue;
    const d = (o.group.position.x - pos.x) ** 2 + (o.group.position.z - pos.z) ** 2;
    if (o.spec.side === 'blue') { if (d < bd) { bd = d; bx = o.group.position; } }
    else if (d < rd) { rd = d; rx = o.group.position; }
  }
  if (!bx || !rx) return null;
  _axis.set(rx.x - bx.x, 0, rx.z - bx.z);
  return _axis.lengthSq() > 1e-6 ? _axis : null;
}

function runFx(fx) {
  const pos = fx.pos
    ? _fxPos.set(fx.pos.x, 4, fx.pos.z).clone()
    : fx.unit
      ? unitObjs.get(fx.unit)?.group.position.clone().setY(4)
      : null;
  if (!pos) return;
  // M-4：近距離事件觸發鏡頭震動（遠則弱／不觸發）
  const near = camera.position.distanceTo(pos);
  const shakeFor = (base) => { if (near < 500) director.shake(base * (1 - near / 500), 0.5); };
  switch (fx.kind) {
    case 'gunfire': effects.gunfire(pos, 6, fireAxis(pos)); audio.sfx('gunfire'); break;
    case 'assault': effects.assault(pos, 5, fireAxis(pos)); audio.sfx('assault'); shakeFor(3); break;
    case 'destroy': effects.destroy(pos, 1.4); audio.sfx('destroy'); shakeFor(6); break;
    case 'reveal': effects.reveal(pos); audio.sfx('reveal'); break;
    case 'barrage': effects.barrage(pos, 16); audio.sfx('explosion'); shakeFor(5); break;
    case 'smoke': effects.smoke(pos, 12); break;
  }
}

// ── 每幀更新 ─────────────────────────────────────────
const DESTROY_DUR = 9; // 戰役分鐘：火力點退場時長
let lastNow = performance.now();
let elapsed = 0;
let panelAcc = 0;

const FADE_PALE = new THREE.Color(0x4a4d44);
function prepMats(o) {
  if (o.mats) return;
  o.mats = [];
  o.group.traverse((m) => {
    if (m.isMesh && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        o.mats.push({ mat, op: mat.opacity ?? 1, col: mat.color ? mat.color.clone() : null });
        mat.transparent = true;
      }
    }
  });
}
function applyDestroyedLook(o, f) {
  prepMats(o);
  const opacity = Math.max(0, 1 - f * 1.1);
  const tint = Math.min(1, f * 0.9);
  for (const r of o.mats) {
    r.mat.opacity = r.op * opacity;
    if (r.col) r.mat.color.copy(r.col).lerp(FADE_PALE, tint);
  }
  o.faded = true;
}
function restoreLook(o) {
  if (!o.faded) return;
  for (const r of o.mats) {
    r.mat.opacity = r.op;
    if (r.col) r.mat.color.copy(r.col);
  }
  o.faded = false;
}

// M-2：最短角差（處理 ±π 環繞）
function shortestAngleDiff(target, current) {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  elapsed += dt;
  const time = elapsed;
  fpsSample(dt);

  if (playing && started) {
    prevT = battleT;
    // 冷場自動快轉:離下個事件很遠時加速
    let adv = speed;
    const nextEv = events.find((ev) => ev.t > battleT + 0.01);
    const gap = nextEv ? nextEv.t - battleT : 999;
    if (gap > 30) adv = speed * Math.min(3.5, 1 + (gap - 30) / 40);
    battleT = Math.min(battleT + dt * adv, TIME_END);
    if (battleT >= TIME_END) {
      playing = false;
      hud.setPlaying(false);
      if (!summaryShown) { summaryShown = true; hud.showSummary(); }
    }
    triggerEventsBetween(prevT, battleT);
    hud.setTime(battleT);
  }

  // 單位
  const rotK = 1 - Math.pow(0.001, dt); // M-2 阻尼係數
  for (const [id, o] of unitObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;

    // M-2：朝向阻尼（拖曳／跳轉後直接對齊）
    const targetRot = o.spec.facing != null ? o.spec.facing : -st.heading;
    if (snapRot) o.curRot = targetRot;
    else o.curRot += shortestAngleDiff(targetRot, o.curRot) * rotK;
    o.group.rotation.y = o.curRot;

    // M-3：行進微動作（士兵起伏＋輕搖；靜止時保留呼吸感）
    const moved = Math.hypot(st.pos.x - o.prevX, st.pos.z - o.prevZ);
    o.prevX = st.pos.x; o.prevZ = st.pos.z;
    const isDown = st.status === 'destroyed' && o.downT != null;
    if (o.troopers.length && !isDown) {
      const movingAmp = moved > 0.03 ? 1 : 0.22;
      for (const tr of o.troopers) {
        const ph = tr.userData.phase;
        tr.position.y = (tr.userData.baseY ?? 0) + Math.sin(time * 7 + ph) * 0.14 * movingAmp;
        tr.rotation.z = Math.sin(time * 7 + ph) * 0.03 * movingAmp;
      }
    }

    if (isDown) {
      const f = Math.min(1, (battleT - o.downT) / DESTROY_DUR);
      o.group.position.y = -f * 2.5;
      o.group.rotation.z = f * 0.4;
      applyDestroyedLook(o, f);
      effects.setBurning(id, o.group, f < 0.7);
      o.group.visible = f < 1.02;
    } else {
      o.group.position.y = 0;
      o.group.rotation.z = 0;
      restoreLook(o);
      o.group.visible = true;
      effects.setBurning(id, o.group, false);
    }
  }
  snapRot = false;

  // 部隊大標籤
  for (const f of formationLabels) {
    const o = unitObjs.get(f.unit);
    if (!o) continue;
    f.label.position.set(o.group.position.x, f.dy, o.group.position.z);
    f.label.visible = o.group.visible;
  }

  // 關鍵人物標記
  for (const a of aceObjs) {
    a.group.visible = battleT >= a.ace.activeFrom && battleT <= a.ace.activeTo;
  }

  // 戰術幾何疊圖:市鎮突入（基底火力＋衝鋒路線）期間顯示
  tacticsOverlay.visible = battleT >= 380 && battleT <= 455;

  animateScene(time);
  terrain.update?.(dt);
  environment.update(dt, battleT);
  effects.update(dt);
  director.update(dt);
  controls.update();

  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-6) {
    const camBearing = (Math.atan2(_fwd.x, -_fwd.z) * 180) / Math.PI;
    hud.setHeading(camBearing);
  }

  panelAcc += dt;
  if (panelAcc > 0.5) {
    panelAcc = 0;
    const states = new Map();
    for (const u of units) states.set(u.id, unitStateAt(u, battleT));
    hud.updatePanels(states);
    if (!playing) hud.setTime(battleT);
  }

  renderFrame(dt);
}

// 輕微待機動畫(人物標記)
function animateScene(time) {
  for (const a of aceObjs) {
    if (a.group.visible) a.group.children[0].position.y = 3 + Math.sin(time * 3) * 0.4;
  }
}

// ── 動態解析度（P-4）：滾動平均 FPS，每 2 秒結算 ─────────────
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0, goodStreak = 0;
let curRatio = DPR_CAP;
const FLOOR = isMobile ? 1.0 : DPR_CAP * 0.75;
function fpsSample(dt) {
  fpsAcc += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer < 2) return;
  const fps = fpsFrames / fpsAcc;
  fpsTimer = 0; fpsAcc = 0; fpsFrames = 0;
  const lowT = isMobile ? 27 : 45;
  if (fps < lowT && curRatio > FLOOR) {
    curRatio = Math.max(FLOOR, curRatio - 0.25);
    renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
    terrain.setDetail?.(0.5);   // 降級同時砍半草叢
    goodStreak = 0;
  } else if (fps > (isMobile ? 40 : 55)) {
    goodStreak += 2;
    if (goodStreak >= 4 && curRatio < DPR_CAP) {
      curRatio = Math.min(DPR_CAP, curRatio + 0.25);
      renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
      terrain.setDetail?.(1);
      goodStreak = 0;
    }
  } else goodStreak = 0;
}

hud.setTime(battleT);
tick();

// ── 開發用美術除錯掛勾(正式 build 會被 import.meta.env.DEV 移除) ──
if (import.meta.env && import.meta.env.DEV) {
  const dbgSeek = (t) => {
    for (const [, o] of unitObjs) {
      const st = unitStateAt(o.spec, t);
      o.group.position.set(st.pos.x, 0, st.pos.z);
      o.group.rotation.y = o.spec.facing != null ? o.spec.facing : -st.heading;
      o.group.rotation.z = 0;
      o.group.visible = true;
      restoreLook(o);
    }
    environment.update(0, t);
    renderFrame(0.016);
    return t;
  };
  const dbgLook = (tx, ty, tz, px, py, pz) => {
    controls.target.set(tx, ty, tz);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
    renderFrame(0.016);
  };
  window.__dbg = {
    THREE, scene, camera, controls, renderer, director, dbgSeek, dbgLook,
    render: () => renderFrame(0.016),
  };
}
