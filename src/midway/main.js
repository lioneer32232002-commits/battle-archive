// 中途島戰役 3D 模擬 — 主程式
// 美術升級(docs/art-upgrade-spec.md):
//   P-1 ACES 色調映射、P-2 桌機陰影、P-3 後製(bloom ＋ 暗角顆粒)、P-4 動態解析度
//   M-1 Catmull-Rom 航跡、M-2 船艦朝向重阻尼＋轉向側傾、M-3 隨浪縱橫搖、M-4 鏡頭手持／震動／跟拍
//   N-2 動態尾流(scene/wake.js)
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
const SHADOWS = !isMobile; // P-2:陰影桌機限定
const POSTFX = !isMobile;  // P-3:後製桌機限定
import { createEnvironment } from './scene/environment.js';
import { createMidwayAtoll } from './scene/terrain.js';
import { createShip, animateFlags } from './scene/ships.js';
import { createAirGroup, updateAirGroup, createAcePlane } from './scene/aircraft.js';
import { Effects } from './scene/effects.js';
import { WakeField } from './scene/wake.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createComposer } from './scene/postfx.js';
import { createHUD } from './ui/hud.js';

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const DPR_CAP = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(DPR_CAP);
renderer.setSize(window.innerWidth, window.innerHeight);
// P-1:ACES 色調映射(手機桌機都開;environment.js 的調色盤已據此重校)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
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

const environment = createEnvironment(scene, { shadows: SHADOWS, mobile: isMobile });
createMidwayAtoll(scene, { shadows: SHADOWS, mobile: isMobile });
const effects = new Effects(scene, { mobile: isMobile });
const director = new Director(camera, controls);
const wake = new WakeField(scene, { mobile: isMobile, ships: units.length });

// 後製 composer(桌機);手機直接 renderer.render
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
const midwayLabel = makeLabel('中途島 Midway', { side: 'neutral', big: true });
midwayLabel.position.set(0, 90, 0);
midwayLabel.scale.multiplyScalar(LABEL_SCALE);
scene.add(midwayLabel);

// ── 船艦 ─────────────────────────────────────────────
// M-2 側傾係數:大船不該像快艇一樣甩頭,航艦最小、驅逐艦最大
const BANK_K = { carrier: 6, battleship: 7, cruiser: 9, destroyer: 12 };
// M-3 隨浪搖晃振幅(rad):驅逐艦大、航艦小
const SEA_AMP = { carrier: 0.0045, battleship: 0.0055, cruiser: 0.0085, destroyer: 0.012 };

const shipObjs = new Map(); // id -> { group, label, spec, sunkT }
let shipIdx = 0;
for (const u of units) {
  if (u.kind === 'base') continue;
  const group = createShip(u);
  group.rotation.order = 'YXZ'; // 先航向、再縱搖、後橫搖(側傾)
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
  const st0 = unitStateAt(u, TIME_START);
  wake.register(u.id);
  shipObjs.set(u.id, {
    group, spec: u, sunkT: sunk ? sunk.t : null,
    curRot: -st0.heading, angVel: 0,
    bankK: BANK_K[u.kind] ?? 8,
    seaAmp: SEA_AMP[u.kind] ?? 0.008,
    phase: shipIdx * 1.37,
    beam: group.userData.beam ?? u.length * 0.2,
    len: group.userData.len ?? u.length,
  });
  group.rotation.y = -st0.heading;
  shipIdx++;
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
  const group = createAirGroup(ag, { mobile: isMobile, scene });
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
let snapRot = false; // M-2:拖曳/跳轉後下一幀直接對齊朝向(不做阻尼)

function resetTransients() {
  effects.clearTransients();
  wake.clear();
  snapRot = true;
}

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
    resetTransients();
    hud.hideEvent();
    hud.hideSummary();
  },
  onJump: (t) => {
    // 點章節按鈕:跳至該時點並重現該事件(字卡 + 運鏡 + 特效)
    battleT = t;
    prevT = t;
    summaryShown = false;
    resetTransients();
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
    resetTransients();
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
  // M-4:鎖定單位的事件改用持續跟拍(含前置量與手持噪聲),其餘沿用一次性飛入
  if (e.camera?.unit && shipObjs.has(e.camera.unit)) {
    const o = shipObjs.get(e.camera.unit);
    director.follow(() => {
      const st = unitStateAt(o.spec, battleT);
      return new THREE.Vector3(st.pos.x, 0, st.pos.z);
    }, e.camera.dist ?? 500, 0.5);
  } else {
    director.clearFollow();
    director.flyTo(eventCameraTarget(e), e.camera?.dist ?? 500);
  }
  for (const fx of e.fx ?? []) runFx(fx);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) fireEvent(e);
}

// M-4:依鏡頭距離觸發震動(遠則弱/不觸發)
const _shakePos = new THREE.Vector3();
function shakeAt(pos, base) {
  const d = camera.position.distanceTo(pos);
  if (d < 1600) director.shake(base * (1 - d / 1600), 0.55);
}

function runFx(fx) {
  const obj = fx.unit ? shipObjs.get(fx.unit)?.group : null;
  switch (fx.kind) {
    case 'divebomb':
      if (obj) { effects.divebomb(obj, 4); shakeAt(obj.position, 26); }
      break;
    case 'flak':
      if (obj) effects.flak(obj, 7);
      break;
    case 'torpedo-run':
      if (obj) { effects.torpedoRun(obj, new THREE.Vector3(1, 0, 0.4).normalize(), 3); shakeAt(obj.position, 20); }
      break;
    case 'launch':
      if (obj) effects.launchFlash(obj);
      break;
    case 'bombing':
      effects.dogfight(new THREE.Vector3(fx.pos.x, 10, fx.pos.z), 9);
      effects.explosion(new THREE.Vector3(fx.pos.x + 20, 6, fx.pos.z + 10), 1.6);
      effects.explosion(new THREE.Vector3(fx.pos.x - 25, 6, fx.pos.z + 30), 1.3);
      shakeAt(_shakePos.set(fx.pos.x, 6, fx.pos.z), 22);
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

// 沉沒退場:逐步「配色變淺 → 淡出」,並深沉、側翻沒入水中。
// (各艦材質為獨立實例,改寫不影響其他艦;scrub 回戰役中段時還原)
const SINK_PALE = new THREE.Color(0x9fb0c0); // 海沫灰白
function prepSinkMats(o) {
  if (o.sinkMats) return;
  o.sinkMats = [];
  o.group.traverse((m) => {
    if ((m.isMesh || m.isLine) && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        o.sinkMats.push({ mat, op: mat.opacity ?? 1, col: mat.color ? mat.color.clone() : null });
        mat.transparent = true;
      }
    }
  });
}
function applySinkLook(o, f) {
  prepSinkMats(o);
  const opacity = Math.max(0, 1 - f * 1.08); // 末段完全淡出
  const tint = Math.min(1, f * 0.85);        // 配色逐漸變淺
  for (const r of o.sinkMats) {
    r.mat.opacity = r.op * opacity;
    if (r.col) r.mat.color.copy(r.col).lerp(SINK_PALE, tint);
  }
  o.sinkLook = true;
}
function restoreSinkLook(o) {
  if (!o.sinkLook) return;
  for (const r of o.sinkMats) {
    r.mat.opacity = r.op;
    if (r.col) r.mat.color.copy(r.col);
  }
  o.sinkLook = false;
}

// M-2:最短角差(處理 ±π 環繞)
function shortestAngleDiff(target, current) {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _camPos = new THREE.Vector3();

renderer.info.autoReset = false; // 後製多 pass:draw call 需累加後自行歸零

let frameCount = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  frame(dt);
}

// 一個影格的全部更新 ＋ 算繪。抽出來是為了讓開發用的 __dbg.step() 能在
// 分頁被隱藏、requestAnimationFrame 暫停時,仍然以固定步長推進畫面做美術驗收。
function frame(dt) {
  frameCount++;
  renderer.info.reset();
  elapsed += dt;
  const time = elapsed;
  fpsSample(dt);

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
  // M-2:海戰朝向阻尼要更重(0.01^dt),大船不該像快艇一樣甩頭
  const rotK = 1 - Math.pow(0.01, dt);
  const invDt = 1 / Math.max(dt, 1e-3);
  for (const [id, o] of shipObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;

    // M-2:朝向阻尼 + 轉向側傾
    const targetRot = -st.heading;
    let step = 0;
    if (snapRot) {
      o.curRot = targetRot;
      o.angVel = 0;
    } else {
      step = shortestAngleDiff(targetRot, o.curRot) * rotK;
      o.curRot += step;
      o.angVel += (step * invDt - o.angVel) * Math.min(1, dt * 1.8);
    }
    o.group.rotation.y = o.curRot;

    effects.setBurning(id, o.group, st.status === 'burning');

    if (st.status === 'sunk') {
      const f = Math.min(1, (battleT - o.sunkT) / SINK_DURATION);
      const ease = f * f; // 加速沉降
      o.group.position.y = -ease * 40; // 沉得更深,沒入水中
      o.group.rotation.z = f * 0.85; // 側翻傾覆
      o.group.rotation.x = f * 0.3; // 艦身前後傾、滑入海面
      applySinkLook(o, f); // 配色變淺 + 淡出
      o.group.visible = f < 1;
      effects.setBurning(id, o.group, false);
      effects.setSinking(id, o.group, f < 1, f); // N-7:油汙貼花 + 水面火光
      wake.hideBow(id);
    } else {
      // M-3:隨浪微幅縱搖／橫搖(兩個不同頻率的 sin 疊加)
      const amp = o.seaAmp;
      const ph = o.phase;
      o.group.position.y = Math.sin(time * 0.62 + ph) * amp * 34;
      o.group.rotation.x = Math.sin(time * 0.71 + ph) * amp + Math.sin(time * 1.13 + ph * 1.7) * amp * 0.55;
      // M-2:轉向側傾(上限 ±0.06 rad)
      const bank = Math.max(-0.06, Math.min(0.06, -o.angVel * o.bankK));
      o.group.rotation.z = bank
        + Math.sin(time * 0.53 + ph * 2.1) * amp * 1.25
        + Math.sin(time * 0.97 + ph) * amp * 0.7;
      restoreSinkLook(o); // scrub 回戰役中段時還原艦體
      o.group.visible = true;
      effects.setSinking(id, o.group, false, 0);
      // N-2:動態尾流(中彈漂流 / 沉沒時不再發射)
      wake.updateShip(id, st.pos.x, st.pos.z, st.heading, o.beam, o.len, st.status === 'normal', dt);
    }
  }
  snapRot = false;
  wake.update(dt);

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
      updateAirGroup(a.group, pos, time, undefined, dt);
    } else {
      if (a.group.visible) updateAirGroup(a.group, null, time, undefined, dt);
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
  environment.setShadowFocus(controls.target); // P-2:陰影框跟著鏡頭焦點
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

  renderFrame(dt);
}

// ── 動態解析度(P-4):滾動平均 FPS,每 2 秒結算 ─────────────
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0, goodStreak = 0;
let curRatio = DPR_CAP;
let lastFps = 60;
const FLOOR = isMobile ? 1.0 : DPR_CAP * 0.75;
function fpsSample(dt) {
  fpsAcc += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer < 2) return;
  const fps = fpsFrames / fpsAcc;
  lastFps = fps;
  fpsTimer = 0; fpsAcc = 0; fpsFrames = 0;
  const lowT = isMobile ? 27 : 45;
  if (fps < lowT && curRatio > FLOOR) {
    curRatio = Math.max(FLOOR, curRatio - 0.25);
    renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
    goodStreak = 0;
  } else if (fps > (isMobile ? 40 : 55)) {
    goodStreak += 2;
    if (goodStreak >= 4 && curRatio < DPR_CAP) {
      curRatio = Math.min(DPR_CAP, curRatio + 0.25);
      renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
      goodStreak = 0;
    }
  } else goodStreak = 0;
}

hud.setTime(battleT);
tick();

// ── 開發用美術除錯掛勾(正式 build 由 import.meta.env.DEV 移除) ──
if (import.meta.env && import.meta.env.DEV) {
  const dbgSeek = (t) => {
    battleT = t; prevT = t; snapRot = true;
    resetTransients();
    hud.setTime(t);
    return t;
  };
  const dbgLook = (tx, ty, tz, px, py, pz) => {
    director.setMode('free');
    controls.target.set(tx, ty, tz);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
  };
  // 美術驗收深連結(dev only):#t=620&run=6&ship=0&off=120,58,150
  //   t   = 戰役時刻;run = 先實際播放幾秒(讓尾流/特效長出來)後暫停
  //   ship= 船艦索引(依 units 順序);off = 相對該艦的鏡頭偏移
  //   cam = tx,ty,tz,px,py,pz(絕對指定,與 ship/off 二擇一)
  //   放在 hash 是為了在 Vite 熱重載/整頁重載後仍然自動復原同一個畫面。
  const shipList = [...shipObjs.values()];
  function applyDbgHash() {
    const h = location.hash;
    if (!h.includes('t=')) return;
    const q = new URLSearchParams(h.slice(1));
    document.getElementById('btn-start')?.click();
    const t = Number(q.get('t'));
    const run = Number(q.get('run') ?? 0);
    const place = () => {
      if (q.has('cam')) {
        const a = q.get('cam').split(',').map(Number);
        dbgLook(a[0], a[1], a[2], a[3], a[4], a[5]);
      } else if (q.has('ship')) {
        const o = shipList[Number(q.get('ship'))];
        const st = unitStateAt(o.spec, battleT); // 由航跡直接取,不依賴 tick 是否跑過
        const off = (q.get('off') ?? '130,62,165').split(',').map(Number);
        dbgLook(st.pos.x, Number(q.get('ly') ?? 8), st.pos.z,
          st.pos.x + off[0], off[1], st.pos.z + off[2]);
      }
    };
    setTimeout(() => {
      dbgSeek(t);
      if (run > 0) {
        // 以「實際算繪出的影格數」計時,分頁在背景 rAF 暫停時不會提早結束(尾流才長得出來)
        playing = true; started = true;
        const start = frameCount;
        const timer = setInterval(() => {
          if (frameCount - start < run * 60) return;
          clearInterval(timer);
          playing = false;
          place();
        }, 100);
      } else {
        place();
      }
    }, 60);
  }
  applyDbgHash();
  window.addEventListener('hashchange', applyDbgHash);

  window.__dbg = {
    THREE, scene, camera, controls, renderer, director, dbgSeek, dbgLook, applyDbgHash,
    // 背景分頁 rAF 會暫停,量測時直接手動渲染一幀再讀數
    measure: () => { renderer.info.reset(); renderFrame(0.016); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    calls: () => renderer.info.render.calls,
    tris: () => renderer.info.render.triangles,
    fps: () => lastFps,
    setPlaying: (v) => { playing = v; started = true; hud.setPlaying(v); },
    // 分頁在背景時 rAF 會暫停,用固定步長手動推進 n 影格(美術驗收用)
    step: (n = 60, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); return frameCount; },
  };
}
