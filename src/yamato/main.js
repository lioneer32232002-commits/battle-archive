// 天號作戰(坊之岬沖海戰)3D 模擬 — 主程式
//
// 2026-09-12 美術升級:P-1 ACES / P-2 陰影 / P-3 後製 / P-4 動態解析度 /
// M-2 朝向阻尼與轉向側傾 / M-3 隨浪微搖 / M-4 鏡頭手感與衝擊震動 /
// N-2 尾流系統 / N-7 大和大爆炸(含 exposure 瞬間過曝)。
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
import {
  initQuality, getQuality, qualityLabel, cycleQuality, setQuality, onQualityChange, createAutoDowngrade,
} from './scene/quality.js';
import { createEnvironment } from './scene/environment.js';
import { createOkinawa } from './scene/terrain.js';
import { createShip, animateFlags, aimTurrets } from './scene/ships.js';
import {
  createAirGroup, updateAirGroup, createAcePlane, ContrailSystem, CrashPlanePool, spinAceProp,
} from './scene/aircraft.js';
import { configureAssets, assetBytes } from './scene/assets.js';
import { Effects } from './scene/effects.js';
import { ParticlePool } from './scene/particles.js';
import { SurfaceSystem } from './scene/wakes.js';
import { oceanHeightAt } from './scene/gfx.js';
import { createComposer } from './scene/postfx.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({
  antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true,
});
// ── R5 畫質分級(docs/realism-spec.md §R5):建場景之前先定案 ──────────
// 判定順序:?q=high|medium|low → localStorage['battle-quality'] → UNMASKED_RENDERER 自動判定。
// 以下所有建構函式一律吃 QUALITY 的參數,不再各自讀 isMobile。
const QUALITY = initQuality({ mobile: isMobile, renderer });
const SHADOWS = QUALITY.shadows;   // P-2:陰影桌機限定(low 仍有,但是單張正交)
const POSTFX = QUALITY.postfx;     // P-3:後製桌機限定(low 只剩 OutputPass ＋ 調色)

const DPR_CAP = Math.min(window.devicePixelRatio, QUALITY.pixelRatioCap);
renderer.setPixelRatio(DPR_CAP);
renderer.setSize(window.innerWidth, window.innerHeight);
// P-1:ACES 色調映射(調色盤已據此重校)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // three 0.184 已棄用 PCFSoftShadowMap(§9.4)
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

// 資產管線:桌機 1k 貼圖 + 1k .hdr;手機 512 貼圖 + tonemapped JPG(asset-pipeline-spec §3)
configureAssets({ mobile: isMobile, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });

// R4 驗收用:dev server 加 ?legacy=1 就整條回到升級前(單張正交陰影＋舊後製),
// 同機位拍開／關對照。import.meta.env.DEV 在正式 build 是常數 false,整段會被搖掉。
const QA_LEGACY = !!(import.meta.env && import.meta.env.DEV) && location.search.includes('legacy=1');
const environment = createEnvironment(scene, {
  shadows: SHADOWS, mobile: isMobile, renderer, quality: QUALITY,
  camera: QA_LEGACY ? null : camera,
});
const geo = createOkinawa(scene, { shadows: SHADOWS });
const particles = new ParticlePool(scene, {
  addMax: QUALITY.particles.add, normMax: QUALITY.particles.norm,
});
const surface = new SurfaceSystem(scene, { mobile: isMobile, ...QUALITY.wake });
const contrails = new ContrailSystem(scene, { mobile: isMobile, max: QUALITY.contrailMax });
const crashPlanes = new CrashPlanePool(scene, { size: QUALITY.crashPlanes });
const effects = new Effects(scene, {
  particles, surface, mobile: isMobile, reduced: QUALITY.reducedFx, crashPlanes,
});
const director = new Director(camera, controls);

// 後製 composer(桌機);手機直接 renderer.render
// R4-4 調色(§R4.4)＋ R4-1 GTAO ＋ R4-3 導演景深
const post = POSTFX ? createComposer(renderer, scene, camera, {
  grade: {
    lift: [0, 0.004, 0.012],
    gamma: [1, 1, 1.012],
    gain: [0.975, 1, 1.045],
    saturation: 0.94,
    contrast: 0.18,
    shadowTint: [0, 0.5, 0.75],
    highlightTint: [0.85, 0.6, 0.2],
    split: [0.05, 0.035],
  },
  gtao: { radius: 25, distanceExponent: 1, thickness: 1, scale: 1.5, blend: 0.7 },
  bokeh: { aperture: 0.00008, maxblur: 0.006 },
  // R5:哪些 pass 要建、bloom 是不是半解析度,全由畫質分級決定
  passes: QUALITY.passes,
  bloomScale: QUALITY.bloomScale,
  gtaoScale: QUALITY.gtaoScale,
}) : null;
if (QA_LEGACY && post) post.setPipeline('legacy');
function renderFrame(dt) {
  if (post) post.render(dt);
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (post) post.setSize(window.innerWidth, window.innerHeight);
  environment.resizeShadows();   // CSM 的切分是依鏡頭視錐算的
});

// 地名標籤(南:沖繩 目的地;北:九州/大隅 出擊方向)
const okinawaLabel = makeLabel('沖繩本島 Okinawa', { side: 'neutral', big: true });
okinawaLabel.position.set(geo.okinawa.x, 90, geo.okinawa.z);
okinawaLabel.scale.multiplyScalar(LABEL_SCALE);
scene.add(okinawaLabel);
const kyushuLabel = makeLabel('九州・大隅半島', { side: 'neutral', big: true });
kyushuLabel.position.set(geo.kyushu.x, 110, geo.kyushu.z);
kyushuLabel.scale.multiplyScalar(LABEL_SCALE);
scene.add(kyushuLabel);

// ── 船艦 ─────────────────────────────────────────────
// 轉向側傾係數(M-2):船越小甩得越明顯
const ROLL_K = { destroyer: 1.2, cruiser: 0.9, battleship: 0.7, flagship: 1.0, carrier: 0.6 };
// 隨浪微搖幅度(M-3)
const SWAY = { destroyer: 0.012, cruiser: 0.009, battleship: 0.007, flagship: 0.006, carrier: 0.005 };

const shipObjs = new Map(); // id -> { group, spec, sunkT, curRot, ... }
let shipPhase = 0;
for (const u of units) {
  if (u.kind === 'base') continue;
  // §R6:glb 換模後材質整組換過,必須重新註冊給 CSM(沒註冊會被三盞 cascade 燈各照一次)
  const group = createShip(u, { onModelReady: (g) => environment.registerObject(g) });
  scene.add(group);
  const big = u.kind === 'carrier' || u.kind === 'flagship';
  // 美軍英文在前、繁中在後;日軍繁中在前、原文在後
  const labelText =
    u.side === 'blue' && u.nameEn
      ? `${u.nameEn} ${u.name}`
      : u.name + (u.nameEn ? ` ${u.nameEn}` : '');
  const label = makeLabel(labelText, { side: u.side });
  label.position.y = big ? 56 : 38;
  label.scale.multiplyScalar((big ? 1 : 0.72) * LABEL_SCALE);
  group.add(label);
  const sunk = (u.statusChanges ?? []).find((c) => c.status === 'sunk');
  const st0 = unitStateAt(u, TIME_START);
  shipObjs.set(u.id, {
    group, spec: u, sunkT: sunk ? sunk.t : null,
    curRot: -st0.heading, prevRot: -st0.heading, angVel: 0,
    rollK: ROLL_K[u.kind] ?? 0.8, sway: SWAY[u.kind] ?? 0.008,
    heave: u.kind === 'destroyer' ? 0.78 : u.kind === 'cruiser' ? 0.62 : 0.45,
    phase: (shipPhase += 1.37),
    evadeT: -1, evadeAmp: 0,
  });
  surface.register(u.id, group.userData.beam ?? u.length * 0.12, group.userData.length ?? u.length);
}

// 部隊大標籤(跟隨編隊旗艦)
const formationLabels = [
  { unit: 'yamato', label: makeLabel('海上特攻隊', { side: 'red', big: true, sub: '伊藤整一 中將' }), dy: 150 },
  { unit: 'bunkerhill', label: makeLabel('Task Force 58 第58特遣艦隊', { side: 'blue', big: true, sub: 'M.A. Mitscher 米契爾' }), dy: 130 },
];
for (const f of formationLabels) {
  f.label.scale.multiplyScalar(LABEL_SCALE);
  scene.add(f.label);
}

// ── 機隊 ─────────────────────────────────────────────
const airObjs = [];
for (const ag of airGroups) {
  const group = createAirGroup(ag, { density: QUALITY.airDensity, mobile: isMobile });
  scene.add(group);
  const label = makeLabel(ag.label, { side: ag.side });
  label.position.y = 26;
  label.scale.multiplyScalar(0.62 * LABEL_SCALE);
  group.add(label);
  airObjs.push({ group, spec: ag });
}

// ── 王牌飛行員座機(個人行動) ─────────────────────────
const aceObjs = aces.map((ace) => {
  const group = createAcePlane(ace.side, ace.kind);
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
let snapRot = false;    // M-2:拖曳/跳轉後下一幀直接對齊朝向(不做阻尼)
let flashT = -1;        // N-7:大爆炸的 exposure 過曝計時
let oceanT = 0;         // 海浪相位(與 environment / surface 的 uTime 同步遞增)

function resetTransients() {
  effects.clearTransients();
  contrails.clear();
  snapRot = true;
  flashT = -1;
  renderer.toneMappingExposure = 1.0;
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
  // R5:畫質按鈕(手機不給,維持既有行為)。換級要重建海面網格／雲／CSM,寫 localStorage 後重載。
  onQualityCycle: isMobile ? null : () => cycleQuality(),
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
const _fxPos = new THREE.Vector3(); // 重用:震動距離計算
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

// M-4:依鏡頭距離決定震動強度(近的事件才震得明顯)
function shakeAt(x, z, base) {
  _fxPos.set(x, 0, z);
  const d = camera.position.distanceTo(_fxPos);
  director.shake(base * Math.min(1, 700 / Math.max(d, 180)), 0.55);
}

function runFx(fx) {
  const o = fx.unit ? shipObjs.get(fx.unit) : null;
  const obj = o ? o.group : null;
  switch (fx.kind) {
    case 'divebomb':
      if (obj) {
        effects.divebomb(obj, 4);
        shakeAt(obj.position.x, obj.position.z, 7);
      }
      break;
    case 'flak':
      if (obj) effects.flak(obj, 7);
      break;
    case 'torpedo-run':
      if (obj) {
        effects.torpedoRun(obj, new THREE.Vector3(1, 0, 0.4).normalize(), 3);
        shakeAt(obj.position.x, obj.position.z, 6);
        // M-2:被雷擊的艦艇劇烈規避,側傾看得出來(大和是主角,給更大的幅度)
        o.evadeT = 0;
        o.evadeAmp = o.spec.kind === 'flagship' ? 0.085 : 0.06;
      }
      break;
    case 'launch':
      if (obj) effects.launchFlash(obj);
      break;
    case 'bombing':
      effects.dogfight(new THREE.Vector3(fx.pos.x, 10, fx.pos.z), 9);
      effects.explosion(new THREE.Vector3(fx.pos.x + 20, 6, fx.pos.z + 10), 1.6);
      effects.explosion(new THREE.Vector3(fx.pos.x - 25, 6, fx.pos.z + 30), 1.3);
      shakeAt(fx.pos.x, fx.pos.z, 6);
      break;
    case 'dogfight':
      effects.dogfight(new THREE.Vector3(fx.pos.x, 0, fx.pos.z), 8);
      break;
    case 'cataclysm': {
      // 大和彈藥庫引爆:閃光 + 蕈狀煙柱 + 水面衝擊波環 + 全力震動 + 全畫面短暫過曝
      effects.cataclysm(fx.pos.x, fx.pos.z);
      director.shake(55, 2.4);
      flashT = 0;
      break;
    }
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
  // 換模(程序化 → glb)之後材質整組換過,快取必須作廢重掃,
  // 否則淡出的是已經被 dispose 的舊材質,船會「沉不下去」。
  const ver = o.group.userData.matsVersion ?? 0;
  if (o.sinkMats && o.sinkMatsVersion === ver) return;
  o.sinkMatsVersion = ver;
  o.sinkLook = false;
  o.sinkMats = [];
  o.group.traverse((m) => {
    if (m.isMesh && m.material) {
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

// 防空射擊目標:視野內最近的來襲機隊(2600 單位內,約主砲對空彈的有效射程),沒有就回傳 null
const _aaTarget = new THREE.Vector3();
function nearestAirThreat(shipGroup) {
  let best = null;
  let bestD = 2600 * 2600;
  for (const a of airObjs) {
    // 單機的跟蹤偵察機(PBM)不算「來襲」:為了一架水上機把主砲整組轉過去太誇張
    if (!a.group.visible || a.spec.count < 3) continue;
    const dx = a.group.position.x - shipGroup.position.x;
    const dz = a.group.position.z - shipGroup.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = a.group; }
  }
  return best ? _aaTarget.copy(best.position) : null;
}

// M-2:最短角差(處理 ±π 環繞)
function shortestAngleDiff(target, current) {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const clampRoll = (v, m) => (v > m ? m : v < -m ? -m : v);

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  fpsSample(dt);
  autoQuality.sample(dt, canDropTier());
  frame(dt);
}

// 單幀邏輯抽出來,除了 rAF 迴圈以外,美術除錯時也能手動逐幀推進(window.__dbg.frame)
function frame(dt) {
  elapsed += dt;
  oceanT += dt;
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
  const rotK = 1 - Math.pow(0.01, dt); // M-2:海戰阻尼較重,大船不甩頭
  for (const [id, o] of shipObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;

    // M-2:朝向阻尼 + 轉向角速度(供側傾使用)
    const targetRot = -st.heading;
    o.prevRot = o.curRot;
    if (snapRot) o.curRot = targetRot;
    else o.curRot += shortestAngleDiff(targetRot, o.curRot) * rotK;
    o.group.rotation.y = o.curRot;
    const inst = dt > 1e-4 ? shortestAngleDiff(o.curRot, o.prevRot) / dt : 0;
    o.angVel += (inst - o.angVel) * Math.min(1, dt * 3);

    const sunkNow = st.status === 'sunk';
    surface.track(id, st.pos.x, st.pos.z, st.heading, dt, !sunkNow);
    effects.setBurning(id, o.group, st.status === 'burning');

    if (sunkNow) {
      const f = Math.min(1, (battleT - o.sunkT) / SINK_DURATION);
      const ease = f * f; // 加速沉降
      o.group.position.y = -ease * 40; // 沉得更深,沒入水中
      o.group.rotation.z = f * 0.85; // 側翻傾覆
      o.group.rotation.x = f * 0.3; // 艦身前後傾、滑入海面
      applySinkLook(o, f); // 配色變淺 + 淡出
      o.group.visible = f < 1;
      effects.setBurning(id, o.group, false);
      effects.setSinking(id, st.pos.x, st.pos.z, f < 1.4);
    } else {
      // M-3:艦體真的騎在同一片浪上(高度場與海面 shader 共用),縱搖由艦艏艦艉的浪高差算出
      const L = o.group.userData.length ?? 60;
      const hMid = oceanHeightAt(st.pos.x, st.pos.z, oceanT);
      const fwdX = Math.sin(st.heading) * L * 0.45;
      const fwdZ = -Math.cos(st.heading) * L * 0.45;
      const hF = oceanHeightAt(st.pos.x + fwdX, st.pos.z + fwdZ, oceanT);
      const hA = oceanHeightAt(st.pos.x - fwdX, st.pos.z - fwdZ, oceanT);
      const sw = o.sway;
      let roll = Math.sin(time * 0.83 + o.phase) * sw + Math.sin(time * 1.47 + o.phase * 1.7) * sw * 0.45;
      const pitch = Math.atan2(hF - hA, L * 0.9) * 0.8 + Math.sin(time * 1.19 + o.phase) * sw * 0.3;
      roll += clampRoll(-o.angVel * o.rollK * 3.2, 0.065);
      if (o.evadeT >= 0) {
        o.evadeT += dt;
        const decay = Math.exp(-o.evadeT / 2.6);
        roll += Math.sin(o.evadeT * 1.9) * o.evadeAmp * decay;
        if (o.evadeT > 9) o.evadeT = -1;
      }
      o.group.position.y = hMid * o.heave;
      o.group.rotation.z = roll;
      o.group.rotation.x = pitch;
      restoreSinkLook(o); // scrub 回戰役中段時還原艦體
      o.group.visible = true;
      effects.setSinking(id, st.pos.x, st.pos.z, false);
    }
  }
  snapRot = false;

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
      updateAirGroup(a.group, pos, time, contrails, dt);
    } else {
      a.group.visible = false;
    }
  }

  // 大和主砲塔:有機隊在防空圈內就轉向來襲方向、砲管抬到對空仰角,沒有就慢慢歸位。
  // (46 cm 主砲確實裝填過三式對空彈,坊之岬沖海戰當天對第一波開過火)
  const yam = shipObjs.get('yamato');
  if (yam && yam.group.userData.turrets) {
    aimTurrets(yam.group, yam.group.visible ? nearestAirThreat(yam.group) : null, dt);
  }

  // 王牌座機
  for (const a of aceObjs) {
    spinAceProp(a.group, dt);
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
  environment.setShadowFocus(controls.target.x, controls.target.z);
  effects.update(dt);
  particles.update(dt);
  surface.update(dt);
  contrails.update(dt);
  director.update(dt);
  controls.update();

  // N-7:大爆炸的一瞬間全畫面過曝(1.0 → 1.6 → 1.0)
  if (flashT >= 0) {
    flashT += dt;
    const f = flashT / 1.15;
    if (f >= 1) { flashT = -1; renderer.toneMappingExposure = 1.0; }
    else renderer.toneMappingExposure = 1.0 + 0.6 * Math.pow(1 - f, 1.6);
  }

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

  // R4-2／R4-3:鏡頭這一幀已經定案 → 更新 cascade 陰影框、跟拍景深
  environment.updateShadows();
  if (post) {
    const following = director.mode === 'director' && !!director.followFn;
    post.setBokeh(following);
    if (following) post.setFocus(camera.position.distanceTo(controls.target));
  }

  renderFrame(dt);
}

// ── 動態解析度(P-4):滾動平均 FPS,每 2 秒結算 ─────────────
// R4-6:降級順序是「先砍 GTAO 再降解析度」(GTAO 內部要重跑一次幾何,是最貴的一關)。
//   0 = 全開 → 1 = GTAO 降 1/4 解析度 → 2 = GTAO 關 → 之後才動 pixelRatio。
let aoLevel = 0;
let perfLock = false;   // __dbg.dbgPerf／freezeQuality 量測期間凍結畫質
function setAoLevel(n) {
  if (!post || aoLevel === n) return;
  aoLevel = n;
  post.setGtaoScale(n >= 1 ? 0.25 : 0.5);
  post.setGTAO(n < 2);
}
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0, goodStreak = 0;
let curRatio = DPR_CAP;
const FLOOR = isMobile ? 1.0 : DPR_CAP * 0.75;
function fpsSample(dt) {
  fpsAcc += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer < 2) return;
  const fps = fpsFrames / fpsAcc;
  fpsTimer = 0; fpsAcc = 0; fpsFrames = 0;
  if (perfLock) return;   // R4:量測/截圖期間凍結畫質
  const lowT = isMobile ? 27 : 45;
  if (fps < lowT && post && aoLevel < 2) {
    setAoLevel(aoLevel + 1);   // R4-6:先砍 GTAO,再談解析度
    goodStreak = 0;
  } else if (fps < lowT && curRatio > FLOOR) {
    curRatio = Math.max(FLOOR, curRatio - 0.25);
    renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
    goodStreak = 0;
  } else if (fps > (isMobile ? 40 : 55)) {
    goodStreak += 2;
    if (goodStreak >= 4 && aoLevel > 0) {
      setAoLevel(aoLevel - 1);   // R4-6:回升時先把 GTAO 救回來
      goodStreak = 0;
    } else if (goodStreak >= 4 && curRatio < DPR_CAP) {
      curRatio = Math.min(DPR_CAP, curRatio + 0.25);
      renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
      goodStreak = 0;
    }
  } else goodStreak = 0;
}

// ── R5 執行期自動降級 ───────────────────────────────────
// §R5.1 的降級順序是「先動可即時切換的旋鈕,再重建需重建的」:上面的 fpsSample 階梯
// (GTAO 半 → GTAO 關 → pixelRatio 降到下限)先跑完,還是連續 3 秒平均 > 40 ms,
// 才輪到換級 —— 換級要重建海面網格、雲、CSM 層數,所以寫 localStorage 後直接重載。
function canDropTier() {
  if (perfLock || isMobile || !started) return false;        // 量測/截圖中、手機、還沒開戰不動
  const aoDone = !post || !post.hasGTAO || aoLevel >= 2;     // 即時旋鈕用盡了嗎
  return aoDone && curRatio <= FLOOR + 1e-6;
}
const autoQuality = createAutoDowngrade({
  onDrop: (next, avgMs) => {
    console.warn(`[quality] 平均幀時間 ${avgMs.toFixed(1)} ms 連續超標 → 畫質降為「${qualityLabel(next)}」,重新載入`);
    setQuality(next);
  },
});
// HUD 的畫質標籤(換級時 setQuality 會先通知再重載,標籤在重載前就會更新)
hud.setQualityLabel(qualityLabel());
onQualityChange((q) => hud.setQualityLabel(qualityLabel(q.tier)));

// R4-2:程序化場景建好後,把現有材質一次註冊給 CSM(資產載入後 environment 內每 0.5 秒會再掃一次)
environment.refreshShadowMaterials();

hud.setTime(battleT);
tick();

// ── 開發用美術除錯掛勾(正式 build 由 import.meta.env.DEV 移除) ──
if (import.meta.env && import.meta.env.DEV) {
  const dbgSeek = (t) => {
    battleT = t; prevT = t; snapRot = true;
    return t;
  };
  const dbgLook = (tx, ty, tz, px, py, pz) => {
    controls.target.set(tx, ty, tz);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
  };
  // 注意:開了 composer 之後 renderer.info.render.calls 只會反映最後一個 pass(1),
  // 要量真正的 draw call 必須直接 renderer.render 一次再讀。
  const dbgCalls = () => {
    renderer.render(scene, camera);
    const r = renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  };
  // 美術驗收一鍵取景:跳到某時刻 → 等真實資產換好 → 把鏡頭擺到大和的相對位置 → 渲染一幀。
  // (dev server 熱更新會讓分頁整個重載,驗收用的 helper 寫在原始碼裡才不會每次都要重新注入)
  const dbgShot = async (t, cam = [0, 10, 0, 92, 44, 128], { fire = false, frames = 45, wait = 8000 } = {}) => {
    const intro = document.querySelector('.intro-box button');
    if (intro && intro.getBoundingClientRect().width > 0) intro.click();
    const o = shipObjs.get('yamato');
    const t0 = performance.now();
    while (!o.group.userData.modelId && performance.now() - t0 < wait) {
      await new Promise((r) => setTimeout(r, 100));
    }
    playing = false;
    hud.setPlaying(false);
    dbgSeek(t);
    resetTransients();
    if (fire) {
      const e = events.find((ev) => ev.t === t);
      if (e) fireEvent(e);   // 特效要靠事件觸發(大爆炸這種鏡頭 dbgSeek 自己不會放)
    }
    for (let i = 0; i < frames; i++) frame(1 / 30);
    const p = o.group.position;
    // 注意:dbgLook 之後不能再跑 frame() —— director.update() 會把鏡頭拉回上一個事件的運鏡目標
    dbgLook(p.x + cam[0], p.y + cam[1], p.z + cam[2], p.x + cam[3], p.y + cam[4], p.z + cam[5]);
    renderFrame(0.016);
    return { t, swapped: !!o.group.userData.modelId, ...dbgCalls(), bytes: assetBytes() };
  };

  // R4-6 效能量測:固定 1600×1000、dpr 1.5,同步量單幀渲染時間。
  // ⚠ gl.finish() 在 ANGLE/D3D11 上不會真的擋住 CPU(同一幀量得出 5 ms 與 123 ms),
  //   要用 readPixels 讀預設 framebuffer 才會逼出真正的同步點。
  const _px = new Uint8Array(4);
  const dbgPerf = (n = 10) => {
    const gl = renderer.getContext();
    const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _px); };
    const prevRatio = renderer.getPixelRatio();
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevAspect = camera.aspect;
    perfLock = true;
    renderer.setPixelRatio(1.5);
    renderer.setSize(1600, 1000, false);
    if (post) post.setSize(1600, 1000);
    camera.aspect = 1.6; camera.updateProjectionMatrix();
    renderFrame(0.016); sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderFrame(0.016);
    sync();
    const ms = (performance.now() - t0) / n;
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    if (post) post.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevAspect; camera.updateProjectionMatrix();
    perfLock = false;
    return Math.round(ms * 100) / 100;
  };
  window.__dbg = {
    post, dbgPerf,
    // R5:目前這一輪的畫質參數與切換(__dbg.setQuality('low') 會寫 localStorage 後重載)
    quality: getQuality, setQuality,
    // A/B 對照:__dbg.pipeline('legacy') 回到升級前的後製,('modern') 全開
    pipeline: (mode) => { if (post) post.setPipeline(mode); renderFrame(0.016); return mode; },
    // 截圖前凍結畫質(擋掉動態解析度／GTAO 自動降級,否則慢機器上拍到的是降級後的畫面)
    freezeQuality: (on = true) => {
      perfLock = !!on;
      if (on) {   // 回到全畫質:GTAO 全開、pixelRatio 回到上限
        setAoLevel(0);
        curRatio = DPR_CAP;
        renderer.setPixelRatio(curRatio);
        if (post) post.setPixelRatio(curRatio);
      }
      return perfLock;
    },
    dbgShot,
    THREE, scene, camera, controls, renderer, director, effects, particles, surface,
    dbgSeek, dbgLook, dbgCalls, frame, render: () => renderFrame(0.016),
    assetBytes, // 驗收:本場真實資產的實際下載量
    // 手動推進 n 幀(每幀 dt 秒):分頁在背景時 rAF 會停,美術驗收靠這個
    run: (n = 60, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); return battleT; },
    setPlaying: (v) => { playing = v; started = true; hud.setPlaying(v); },
  };
}
