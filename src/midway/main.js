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
  outcome,
  aces,
} from './data/battle.js';
import { unitStateAt, interpolateTrack, newEvents } from './engine/timeline.js';

// 行動裝置:縮小標籤、降低 pixelRatio,改善重疊與卡頓
const isMobile = window.matchMedia('(max-width: 640px)').matches;
const LABEL_SCALE = isMobile ? 0.6 : 1;
import { createEnvironment } from './scene/environment.js';
import { createMidwayAtoll } from './scene/terrain.js';
import { createShip, animateFlags } from './scene/ships.js';
import { createAirGroup, updateAirGroup, createAcePlane } from './scene/aircraft.js';
import { Effects } from './scene/effects.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
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
midwayLabel.scale.multiplyScalar(LABEL_SCALE);
scene.add(midwayLabel);

// ── 船艦 ─────────────────────────────────────────────
const shipObjs = new Map(); // id -> { group, label, spec, sunkT }
for (const u of units) {
  if (u.kind === 'base') continue;
  const group = createShip(u);
  scene.add(group);
  const isCarrier = u.kind === 'carrier';
  // 美軍英文在前、繁中在後;日軍繁中在前、原文在後
  const labelText =
    u.side === 'blue' && u.nameEn
      ? `${u.nameEn} ${u.name}`
      : u.name + (u.nameEn ? ` ${u.nameEn}` : '');
  const label = makeLabel(labelText, { side: u.side });
  label.position.y = isCarrier ? 56 : 38;
  label.scale.multiplyScalar((isCarrier ? 1 : 0.72) * LABEL_SCALE);
  group.add(label);
  const sunk = (u.statusChanges ?? []).find((c) => c.status === 'sunk');
  shipObjs.set(u.id, { group, spec: u, sunkT: sunk ? sunk.t : null });
}

// 部隊大標籤(跟隨編隊旗艦)
const formationLabels = [
  { unit: 'akagi', label: makeLabel('南雲機動部隊', { side: 'red', big: true, sub: '南雲忠一 中將' }), dy: 130 },
  { unit: 'enterprise', label: makeLabel('Task Force 16 第16特遣艦隊', { side: 'blue', big: true, sub: 'R.A. Spruance 史普魯恩斯' }), dy: 130 },
  { unit: 'yorktown', label: makeLabel('Task Force 17 第17特遣艦隊', { side: 'blue', big: true, sub: 'F.J. Fletcher 佛萊徹' }), dy: 130 },
];
for (const f of formationLabels) {
  f.label.scale.multiplyScalar(LABEL_SCALE);
  scene.add(f.label);
}

// ── 機隊 ─────────────────────────────────────────────
const airObjs = [];
for (const ag of airGroups) {
  const group = createAirGroup(ag);
  scene.add(group);
  const label = makeLabel(ag.label, { side: ag.side });
  label.position.y = 26;
  label.scale.multiplyScalar(0.62 * LABEL_SCALE);
  group.add(label);
  airObjs.push({ group, spec: ag });
}

// ── 王牌飛行員座機(個人行動) ─────────────────────────
const aceObjs = aces.map((ace) => {
  const group = createAcePlane(ace.side);
  group.userData.figureId = ace.id;
  scene.add(group);
  const label = makeLabel('★ ' + ace.name, { side: ace.side });
  label.position.y = 20;
  label.scale.multiplyScalar(0.7 * LABEL_SCALE);
  group.add(label);
  return { ace, group };
});

// 王牌座機航跡:dive 自高空俯衝後拉起;torpedo 低空突防後爬升
function aceTransform(kind, target, f) {
  const wp =
    kind === 'dive'
      ? [
          [0, target.x + 110, 250, target.z + 150],
          [0.45, target.x + 12, 26, target.z + 22],
          [0.64, target.x - 55, 52, target.z - 28],
          [1, target.x - 210, 175, target.z - 150],
        ]
      : [
          [0, target.x + 320, 16, target.z + 150],
          [0.5, target.x + 40, 11, target.z + 22],
          [0.64, target.x - 60, 18, target.z - 30],
          [1, target.x - 240, 85, target.z - 140],
        ];
  let a = wp[0];
  let b = wp[1];
  for (let i = 0; i < wp.length - 1; i++) {
    if (f >= wp[i][0]) {
      a = wp[i];
      b = wp[i + 1];
    }
  }
  const span = b[0] - a[0] || 1;
  const t = Math.min(1, Math.max(0, (f - a[0]) / span));
  const x = a[1] + (b[1] - a[1]) * t;
  const y = a[2] + (b[2] - a[2]) * t;
  const z = a[3] + (b[3] - a[3]) * t;
  const heading = Math.atan2(b[1] - a[1], -(b[3] - a[3]));
  const dh = Math.hypot(b[1] - a[1], b[3] - a[3]) || 1;
  const pitch = Math.atan2(b[2] - a[2], dh); // 上升為正
  return { x, y, z, heading, pitch };
}

// ── 播放狀態 ─────────────────────────────────────────
let battleT = TIME_START;
let prevT = TIME_START;
let playing = false;
let speed = 2; // 戰役分鐘 / 真實秒
let started = false;
let summaryShown = false;

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
    summaryShown = false;
    effects.clearTransients();
    hud.hideEvent();
    hud.hideSummary();
  },
  onJump: (t) => {
    // 點章節按鈕:跳至該時點並重現該事件(字卡 + 運鏡 + 特效)
    battleT = t;
    prevT = t;
    summaryShown = false;
    effects.clearTransients();
    hud.hideSummary();
    const e = events.find((ev) => ev.t === t);
    if (e) fireEvent(e);
    hud.setTime(t);
  },
  onModeToggle: (mode) => director.setMode(mode),
  onReplay: () => {
    battleT = TIME_START;
    prevT = TIME_START;
    summaryShown = false;
    playing = true;
    effects.clearTransients();
    hud.hideSummary();
    hud.setPlaying(true);
    triggerEventsBetween(TIME_START - 1, battleT);
  },
});

// 點擊 3D 中可見的王牌座機/標籤 → 開啟人物小卡(以拖曳門檻區分旋轉)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _fwd = new THREE.Vector3(); // 重用:鏡頭視向(方位羅盤)
let downX = 0;
let downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // 視為旋轉/平移
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

// 事件運鏡目標:依事件時刻 e.t 由航跡推算單位位置(跳轉時船艦尚未移動,故不取即時座標)
function eventCameraTarget(e) {
  if (e.camera?.unit) {
    const o = shipObjs.get(e.camera.unit);
    if (o) {
      const st = unitStateAt(o.spec, e.t);
      return new THREE.Vector3(st.pos.x, 0, st.pos.z);
    }
  }
  return new THREE.Vector3(e.camera?.pos?.x ?? 0, 0, e.camera?.pos?.z ?? 0);
}

// 觸發單一事件:字卡 + 運鏡 + 特效
function fireEvent(e) {
  hud.showEvent(e);
  director.flyTo(eventCameraTarget(e), e.camera?.dist ?? 500);
  for (const fx of e.fx ?? []) runFx(fx);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) fireEvent(e);
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
let lastNow = performance.now();
let elapsed = 0;
let panelAcc = 0;

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  elapsed += dt;
  const time = elapsed;

  if (playing && started) {
    prevT = battleT;
    battleT = Math.min(battleT + dt * speed, TIME_END);
    if (battleT >= TIME_END) {
      playing = false;
      hud.setPlaying(false);
      if (!summaryShown) {
        summaryShown = true;
        hud.showSummary();
      }
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

  // 王牌座機
  for (const a of aceObjs) {
    const sortie = a.ace.sorties.find((s) => battleT >= s.spawnT && battleT <= s.despawnT);
    const target = sortie ? shipObjs.get(sortie.unit)?.group.position : null;
    if (sortie && target) {
      const f = (battleT - sortie.spawnT) / (sortie.despawnT - sortie.spawnT);
      const tr = aceTransform(a.ace.kind, target, f);
      a.group.position.set(tr.x, tr.y, tr.z);
      a.group.rotation.y = -tr.heading;
      a.group.rotation.x = -tr.pitch; // 俯衝時機首朝下
      a.group.visible = true;
    } else {
      a.group.visible = false;
    }
  }

  animateFlags(scene, time);
  environment.update(dt, battleT);
  effects.update(dt);
  director.update(dt);
  controls.update();

  // 方位羅盤:依鏡頭實際視向轉動羅經卡(場景正北 = -z)
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

hud.setTime(battleT);
tick();
