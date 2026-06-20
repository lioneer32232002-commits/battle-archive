// 卡倫坦之役（溫特斯三部曲 · 二部曲）3D 模擬 — 主程式
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

const isMobile = window.matchMedia('(max-width: 640px)').matches;
const LABEL_SCALE = isMobile ? 0.6 : 1;

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const environment = createEnvironment(scene);
const terrain = createCarentanTerrain(scene);
const effects = new Effects(scene);
const director = new Director(camera, controls);
const audio = new AudioEngine();

// 地名標籤
for (const p of terrain.places) {
  const lab = makeLabel(p.name, { side: p.side });
  lab.position.set(p.pos.x, p.pos.y, p.pos.z);
  lab.scale.multiplyScalar(0.34 * LABEL_SCALE);
  scene.add(lab);
}

// ── 單位 ─────────────────────────────────────────────
const unitObjs = new Map();
for (const u of units) {
  const group = createUnit(u);
  scene.add(group);
  if (u.kind !== 'mg') {   // 機槍火力點不掛 3D 標籤（避免十字路口處標籤打架）
    const label = makeLabel(u.name, { side: u.side });
    label.position.y = 13;
    label.scale.multiplyScalar(0.26 * LABEL_SCALE);
    group.add(label);
  }
  const destroyed = (u.statusChanges ?? []).find((c) => c.status === 'destroyed');
  unitObjs.set(u.id, { group, spec: u, downT: destroyed ? destroyed.t : null });
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
    battleT = t; prevT = t; summaryShown = false;
    effects.clearTransients(); hud.hideEvent(); hud.hideSummary(); hud.hideIntel();
  },
  onJump: (t) => {
    battleT = t; prevT = t; summaryShown = false;
    effects.clearTransients(); hud.hideSummary();
    const e = events.find((ev) => ev.t === t);
    if (e) fireEvent(e);
    hud.setTime(t);
  },
  onModeToggle: (mode) => director.setMode(mode),
  onReplay: () => {
    battleT = TIME_START; prevT = TIME_START; summaryShown = false; playing = true;
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

function runFx(fx) {
  const pos = fx.pos
    ? new THREE.Vector3(fx.pos.x, 4, fx.pos.z)
    : fx.unit
      ? unitObjs.get(fx.unit)?.group.position.clone().setY(4)
      : null;
  if (!pos) return;
  switch (fx.kind) {
    case 'gunfire': effects.gunfire(pos, 6); audio.sfx('gunfire'); break;
    case 'assault': effects.assault(pos, 5); audio.sfx('assault'); break;
    case 'destroy': effects.destroy(pos, 1.4); audio.sfx('destroy'); break;
    case 'reveal': effects.reveal(pos); audio.sfx('reveal'); break;
    case 'barrage': effects.barrage(pos, 16); audio.sfx('explosion'); break;
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

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  elapsed += dt;
  const time = elapsed;

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
  for (const [id, o] of unitObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;
    o.group.rotation.y = o.spec.facing != null ? o.spec.facing : -st.heading;
    if (st.status === 'destroyed' && o.downT != null) {
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

  renderer.render(scene, camera);
}

// 輕微待機動畫(人物標記)
function animateScene(time) {
  for (const a of aceObjs) {
    if (a.group.visible) a.group.children[0].position.y = 3 + Math.sin(time * 3) * 0.4;
  }
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
    renderer.render(scene, camera);
    return t;
  };
  const dbgLook = (tx, ty, tz, px, py, pz) => {
    controls.target.set(tx, ty, tz);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
  };
  window.__dbg = {
    THREE, scene, camera, controls, renderer, director, dbgSeek, dbgLook,
    render: () => renderer.render(scene, camera),
  };
}
