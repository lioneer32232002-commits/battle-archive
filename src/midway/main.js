// 中途島戰役 3D 模擬 — 主程式
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TIME_START,
  TIME_END,
  units,
  airGroups,
  events,
  sides,
} from './data/battle.js';
import { unitStateAt, interpolateTrack, newEvents } from './engine/timeline.js';
import { createEnvironment } from './scene/environment.js';
import { createMidwayAtoll } from './scene/terrain.js';
import { createShip, animateFlags } from './scene/ships.js';
import { createAirGroup, updateAirGroup } from './scene/aircraft.js';
import { Effects } from './scene/effects.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 40000);
camera.position.set(600, 900, 1400);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -600);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 60;
controls.maxDistance = 9000;
controls.enableDamping = true;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const environment = createEnvironment(scene);
createMidwayAtoll(scene);
const effects = new Effects(scene);
const director = new Director(camera, controls);

// 地名標籤
const midwayLabel = makeLabel('中途島 Midway', { side: 'neutral', big: true });
midwayLabel.position.set(0, 90, 0);
scene.add(midwayLabel);

// ── 船艦 ─────────────────────────────────────────────
const shipObjs = new Map(); // id -> { group, label, spec, sunkT }
for (const u of units) {
  if (u.kind === 'base') continue;
  const group = createShip(u);
  scene.add(group);
  const isCarrier = u.kind === 'carrier';
  const label = makeLabel(u.name + (u.nameEn ? ` ${u.nameEn}` : ''), { side: u.side });
  label.position.y = isCarrier ? 56 : 38;
  if (!isCarrier) label.scale.multiplyScalar(0.72);
  group.add(label);
  const sunk = (u.statusChanges ?? []).find((c) => c.status === 'sunk');
  shipObjs.set(u.id, { group, spec: u, sunkT: sunk ? sunk.t : null });
}

// 部隊大標籤(跟隨編隊旗艦)
const formationLabels = [
  { unit: 'akagi', label: makeLabel('南雲機動部隊', { side: 'red', big: true, sub: '南雲忠一 中將' }), dy: 130 },
  { unit: 'enterprise', label: makeLabel('第16特遣艦隊 TF16', { side: 'blue', big: true, sub: '史普魯恩斯 少將' }), dy: 130 },
  { unit: 'yorktown', label: makeLabel('第17特遣艦隊 TF17', { side: 'blue', big: true, sub: '佛萊徹 少將' }), dy: 130 },
];
for (const f of formationLabels) scene.add(f.label);

// ── 機隊 ─────────────────────────────────────────────
const airObjs = [];
for (const ag of airGroups) {
  const group = createAirGroup(ag);
  scene.add(group);
  const label = makeLabel(ag.label, { side: ag.side });
  label.position.y = 26;
  label.scale.multiplyScalar(0.62);
  group.add(label);
  airObjs.push({ group, spec: ag });
}

// ── 播放狀態 ─────────────────────────────────────────
let battleT = TIME_START;
let prevT = TIME_START;
let playing = false;
let speed = 2; // 戰役分鐘 / 真實秒
let started = false;

const hud = createHUD({
  onStart: () => {
    started = true;
    playing = true;
    hud.setPlaying(true);
    triggerEventsBetween(TIME_START - 1, battleT); // 開場字卡
  },
  onPlayToggle: () => {
    if (!started) return;
    playing = !playing;
    hud.setPlaying(playing);
  },
  onSpeedChange: (s) => (speed = s),
  onScrub: (t) => {
    battleT = t;
    prevT = t;
    effects.clearTransients();
    hud.hideEvent();
  },
  onModeToggle: (mode) => director.setMode(mode),
});

function unitObjPos(id) {
  const o = shipObjs.get(id);
  if (o) return o.group.position;
  if (id === 'midway-base') return new THREE.Vector3(0, 0, 0);
  return new THREE.Vector3(0, 0, 0);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) {
    hud.showEvent(e);
    const target = e.camera?.unit
      ? unitObjPos(e.camera.unit).clone()
      : new THREE.Vector3(e.camera?.pos?.x ?? 0, 0, e.camera?.pos?.z ?? 0);
    director.flyTo(target, e.camera?.dist ?? 500);
    for (const fx of e.fx ?? []) runFx(fx);
  }
}

function runFx(fx) {
  const obj = fx.unit ? shipObjs.get(fx.unit)?.group : null;
  switch (fx.kind) {
    case 'divebomb':
      if (obj) effects.divebomb(obj, 4);
      break;
    case 'flak':
      if (obj) effects.flak(obj, 7);
      break;
    case 'torpedo-run':
      if (obj) effects.torpedoRun(obj, new THREE.Vector3(1, 0, 0.4).normalize(), 3);
      break;
    case 'launch':
      if (obj) effects.launchFlash(obj);
      break;
    case 'bombing':
      effects.dogfight(new THREE.Vector3(fx.pos.x, 10, fx.pos.z), 9);
      effects.explosion(new THREE.Vector3(fx.pos.x + 20, 6, fx.pos.z + 10), 1.6);
      effects.explosion(new THREE.Vector3(fx.pos.x - 25, 6, fx.pos.z + 30), 1.3);
      break;
    case 'dogfight':
      effects.dogfight(new THREE.Vector3(fx.pos.x, 0, fx.pos.z), 8);
      break;
  }
}

// ── 每幀更新 ─────────────────────────────────────────
const SINK_DURATION = 14; // 戰役分鐘:沉沒動畫時長
const clock = new THREE.Clock();
let panelAcc = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;

  if (playing && started) {
    prevT = battleT;
    battleT = Math.min(battleT + dt * speed, TIME_END);
    if (battleT >= TIME_END) {
      playing = false;
      hud.setPlaying(false);
    }
    triggerEventsBetween(prevT, battleT);
    hud.setTime(battleT);
  }

  // 船艦狀態
  for (const [id, o] of shipObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;
    o.group.rotation.y = -st.heading;
    effects.setBurning(id, o.group, st.status === 'burning');

    if (st.status === 'sunk') {
      const f = Math.min(1, (battleT - o.sunkT) / SINK_DURATION);
      o.group.position.y = -f * 26;
      o.group.rotation.z = f * 0.55;
      o.group.visible = f < 1;
      effects.setBurning(id, o.group, false);
      if (o.group.userData.wake) o.group.userData.wake.visible = false;
    } else {
      o.group.position.y = 0;
      o.group.rotation.z = 0;
      o.group.visible = true;
      // 停止移動(中彈漂流)時隱藏艦艏波
      if (o.group.userData.wake) o.group.userData.wake.visible = st.status === 'normal';
    }
  }

  // 部隊大標籤
  for (const f of formationLabels) {
    const o = shipObjs.get(f.unit);
    f.label.position.set(o.group.position.x, f.dy, o.group.position.z);
    f.label.visible = o.group.visible;
  }

  // 機隊
  for (const a of airObjs) {
    const { spawnT, despawnT } = a.spec;
    if (battleT >= spawnT && battleT <= despawnT) {
      a.group.visible = true;
      const pos = interpolateTrack(a.spec.track, battleT);
      updateAirGroup(a.group, pos, time);
    } else {
      a.group.visible = false;
    }
  }

  animateFlags(scene, time);
  environment.update(dt, battleT);
  effects.update(dt);
  director.update(dt);
  controls.update();

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

hud.setTime(battleT);
tick();
