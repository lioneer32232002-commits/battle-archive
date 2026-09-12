// 布雷庫爾奪砲戰 3D 模擬 — 主程式
// 美術升級(見 docs/art-upgrade-spec.md):P-1 ACES 色調映射、P-2 桌機陰影、P-3 後製(bloom＋暗角顆粒)、
//   P-4 動態解析度、M-1 Catmull-Rom 曲線插值、M-2 朝向阻尼、M-3 士兵行進微動作、M-4 鏡頭手感與震動。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TIME_START, TIME_END, units, airGroups, events, sides, outcome, aces, tactics,
} from './data/battle.js';
import { unitStateAt, interpolateTrack, newEvents } from './engine/timeline.js';
import { createEnvironment } from './scene/environment.js';
import { createBrecourtTerrain } from './scene/terrain.js';
import { createUnit } from './scene/soldiers.js';
import { createAirGroup, updateAirGroup, createParatroopers, updateParatroopers } from './scene/aircraft.js';
import { Effects } from './scene/effects.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';
import { AudioEngine } from './scene/audio.js';
import { createComposer } from './scene/postfx.js';
import { configureAssets, missingAssets } from './scene/assets.js';

// 開發時可用 ?mobile 強制走手機路徑(512 貼圖、tonemapped HDRI、程序化植被)做驗收;
// 正式 build 會把 import.meta.env.DEV 那段整個移除。
const isMobile = window.matchMedia('(max-width: 640px)').matches
  || !!(import.meta.env && import.meta.env.DEV && location.search.includes('mobile'));
const LABEL_SCALE = isMobile ? 0.6 : 1;
const SHADOWS = !isMobile;   // P-2：陰影桌機限定
const POSTFX = !isMobile;    // P-3：後製桌機限定

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const DPR_CAP = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
renderer.setPixelRatio(DPR_CAP);
renderer.setSize(window.innerWidth, window.innerHeight);
// P-1:ACES 色調映射(手機桌機都開;environment.js 調色盤已據此重校)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // 0.184 已棄用 PCFSoft(會退回 PCF 並洗警告)
}
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);
camera.position.set(-70, 80, 150);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(14, 0, 12);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 22;
controls.maxDistance = 3500;
controls.enableDamping = true;

// 真實資產(docs/asset-pipeline-spec.md §3):貼圖／HDRI／模型的桌機與手機路徑在這裡決定,
// 之後 environment／terrain／soldiers／aircraft 各自非同步升級,一律不阻塞首屏。
configureAssets({ mobile: isMobile, renderer, envMapIntensity: 1 });

const environment = createEnvironment(scene, { shadows: SHADOWS, mobile: isMobile, toneMapSky: !POSTFX, renderer });
const terrain = createBrecourtTerrain(scene, { shadows: SHADOWS, mobile: isMobile });
const effects = new Effects(scene, { mobile: isMobile });
const director = new Director(camera, controls);
const audio = new AudioEngine();

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
for (const p of terrain.places) {
  const lab = makeLabel(p.name, { side: p.side });
  lab.position.set(p.pos.x, p.pos.y, p.pos.z);
  lab.scale.multiplyScalar(0.34 * LABEL_SCALE);
  scene.add(lab);
}

// ── 單位 ─────────────────────────────────────────────
const unitObjs = new Map();
for (const u of units) {
  const group = createUnit(u, { shadows: SHADOWS });
  scene.add(group);
  if (u.kind !== 'gun') {
    const label = makeLabel(u.name, { side: u.side });
    label.position.y = u.kind === 'mg' ? 11 : 15;
    label.scale.multiplyScalar(0.26 * LABEL_SCALE);
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
  { unit: 'easy', label: makeLabel('E 連 · 506 PIR', { side: 'blue', big: true, sub: '連主力 · 出發線支援' }), dy: 52 },
  { unit: 'battery-crew', label: makeLabel('德軍砲兵連', { side: 'red', big: true, sub: '四門 105mm 榴彈砲' }), dy: 40 },
];
for (const f of formationLabels) {
  f.label.scale.multiplyScalar(0.34 * LABEL_SCALE);
  scene.add(f.label);
}

// ── 機群與傘兵 ───────────────────────────────────────
const airObjs = [];
for (const ag of airGroups) {
  const group = createAirGroup(ag);
  scene.add(group);
  const label = makeLabel(ag.label, { side: ag.side });
  label.position.y = 18;
  label.scale.multiplyScalar(0.5 * LABEL_SCALE);
  group.add(label);
  airObjs.push({ group, spec: ag });
}
const paratroopers = createParatroopers(28);
scene.add(paratroopers);

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
        new THREE.LineBasicMaterial({ color: 0x9ec9ff, transparent: true, opacity: 0.28 })
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
let snapRot = false;   // 拖曳/跳轉後下一幀直接對齊朝向(不做阻尼)

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
  if (e.camera?.air) {
    // 機群跟拍:追著 C-47 編隊飛越(夜跳開場運鏡),由下往上仰拍對著星空
    const ag = airGroups.find((a) => a.id === e.camera.air);
    if (ag) {
      const lookY = e.camera.lookY ?? 60;
      director.follow(() => {
        const p = interpolateTrack(ag.track, battleT);
        return new THREE.Vector3(p.x, lookY, p.z);
      }, e.camera.dist ?? 320, e.camera.elev ?? 0.1, e.camera.az);
    }
  } else if (e.camera?.unit) {
    // 跟隨鏡頭:持續追著該單位(如 E 連行軍),而非飛到當下位置就停
    const o = unitObjs.get(e.camera.unit);
    if (o) {
      director.follow(() => {
        const st = unitStateAt(o.spec, battleT);
        return new THREE.Vector3(st.pos.x, 0, st.pos.z);
      }, e.camera.dist ?? 300, e.camera.elev ?? 0.6, e.camera.az);
    }
  } else {
    director.clearFollow();
    director.flyTo(eventCameraTarget(e), e.camera?.dist ?? 300);
  }
  if (e.device === 'intel' && e.intel) hud.showIntel(e.intel);
  else hud.hideIntel();
  for (const fx of e.fx ?? []) runFx(fx);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) fireEvent(e);
}

// 曳光線射向:砲線區內的火力朝東(猶他灘方向,德軍砲口指向),區外朝砲線中心
const BATTERY = { x: 10, z: 12 };
function fireDirFor(pos) {
  const inBattery = pos.x > -6 && pos.x < 42 && pos.z > -18 && pos.z < 42;
  if (inBattery) return { x: 1, z: 0.25 };
  return { x: BATTERY.x - pos.x, z: BATTERY.z - pos.z };
}

function runFx(fx) {
  const pos = fx.pos
    ? new THREE.Vector3(fx.pos.x, 4, fx.pos.z)
    : fx.unit
      ? unitObjs.get(fx.unit)?.group.position.clone().setY(4)
      : null;
  if (!pos) return;
  // M-4:近距離事件觸發鏡頭震動(遠則弱/不觸發)
  const near = camera.position.distanceTo(pos);
  const shakeFor = (base) => { if (near < 500) director.shake(base * (1 - near / 500), 0.5); };
  switch (fx.kind) {
    case 'flak': effects.flak(pos, 6); audio.sfx('flak'); break;
    case 'flakair': effects.flakAir(pos, 20); audio.sfx('flak'); break;
    case 'gunfire': effects.gunfire(pos, 6, fireDirFor(pos)); audio.sfx('gunfire'); break;
    case 'assault': effects.assault(pos, 5, { x: 0.35, z: -1 }); audio.sfx('assault'); shakeFor(3); break;
    case 'destroy': effects.destroy(pos, 1.6); audio.sfx('destroy'); shakeFor(7); break;
    case 'reveal': effects.reveal(pos); audio.sfx('reveal'); break;
  }
}

// ── 每幀更新 ─────────────────────────────────────────
const DESTROY_DUR = 9; // 戰役分鐘：火砲退場時長
let lastNow = performance.now();
let elapsed = 0;
let panelAcc = 0;

const FADE_PALE = new THREE.Color(0xd8d8d8);
function prepMats(o) {
  // 資產升級會換掉單位的幾何/材質 → 快取作廢重收(matsDirty 由 soldiers.js 設)
  if (o.group.userData.matsDirty) { o.mats = null; o.group.userData.matsDirty = false; }
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

// M-2:最短角差(處理 ±π 環繞)
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
    // 冷場自動快轉:離下個事件很遠時加速(傘降動畫與戰鬥段維持正常速)
    let adv = speed;
    const nextEv = events.find((ev) => ev.t > battleT + 0.01);
    const gap = nextEv ? nextEv.t - battleT : 999;
    const inDrop = battleT > 82 && battleT < 162;
    if (!inDrop && gap > 30) adv = speed * Math.min(3.5, 1 + (gap - 30) / 40);
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

    // M-2:朝向阻尼(拖曳/跳轉後直接對齊)
    const targetRot = o.spec.facing != null ? o.spec.facing : -st.heading;
    if (snapRot) o.curRot = targetRot;
    else o.curRot += shortestAngleDiff(targetRot, o.curRot) * rotK;
    o.group.rotation.y = o.curRot;

    // M-3:行進微動作
    const moved = Math.hypot(st.pos.x - o.prevX, st.pos.z - o.prevZ);
    o.prevX = st.pos.x; o.prevZ = st.pos.z;
    if (o.troopers.length && !(st.status === 'destroyed' && o.downT != null)) {
      const movingAmp = moved > 0.03 ? 1 : 0.22;   // 靜止單位保留 ~1/4 呼吸感
      for (const tr of o.troopers) {
        const ph = tr.userData.phase;
        tr.position.y = (tr.userData.baseY ?? 0) + Math.sin(time * 7 + ph) * 0.14 * movingAmp;
        tr.rotation.z = Math.sin(time * 7 + ph) * 0.03 * movingAmp;
      }
    }

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
  snapRot = false;

  // 部隊大標籤
  for (const f of formationLabels) {
    const o = unitObjs.get(f.unit);
    if (!o) continue;
    f.label.position.set(o.group.position.x, f.dy, o.group.position.z);
    f.label.visible = o.group.visible;
  }

  // 機群
  for (const a of airObjs) {
    const { spawnT, despawnT } = a.spec;
    if (battleT >= spawnT && battleT <= despawnT) {
      a.group.visible = true;
      updateAirGroup(a.group, interpolateTrack(a.spec.track, battleT), time);
    } else {
      a.group.visible = false;
    }
  }

  // 傘兵(跳傘時間窗)
  if (battleT > 84 && battleT < 158) {
    paratroopers.visible = true;
    updateParatroopers(paratroopers, (battleT - 88) / 70, time);
  } else {
    paratroopers.visible = false;
  }

  // 關鍵人物標記
  for (const a of aceObjs) {
    a.group.visible = battleT >= a.ace.activeFrom && battleT <= a.ace.activeTo;
  }

  // 戰術幾何疊圖:情報揭示後 → 攻擊完成
  tacticsOverlay.visible = battleT >= 476 && battleT <= 616;

  animateScene(time);
  environment.update(dt, battleT);
  terrain.update(dt);
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

// ── 動態解析度(P-4):滾動平均 FPS,每 2 秒結算 ─────────────
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

// 輕微待機動畫(傘花/標記)留待後續美術細修
function animateScene(time) {
  for (const a of aceObjs) {
    if (a.group.visible) a.group.children[0].position.y = 3 + Math.sin(time * 3) * 0.4;
  }
}

hud.setTime(battleT);
tick();

// ── 開發用美術除錯掛勾(正式 build 會被 import.meta.env.DEV 移除) ──
// 預覽分頁為 hidden 時 rAF 會暫停;此掛勾可手動定格到指定戰役時刻、擺放鏡頭並強制渲染,供截圖檢視美術。
if (import.meta.env && import.meta.env.DEV) {
  const dbgSeek = (t) => {
    battleT = t; prevT = t;          // 主迴圈若還在跑,下一幀才不會把時間拉回去
    hud.setTime(t);
    for (const [, o] of unitObjs) {
      const st = unitStateAt(o.spec, t);
      o.group.position.set(st.pos.x, 0, st.pos.z);
      o.curRot = o.spec.facing != null ? o.spec.facing : -st.heading;
      o.group.rotation.y = o.curRot;
      o.group.rotation.z = 0;
      o.group.visible = true;
      restoreLook(o);
    }
    for (const a of airObjs) {
      const { spawnT, despawnT } = a.spec;
      if (t >= spawnT && t <= despawnT) {
        a.group.visible = true;
        updateAirGroup(a.group, interpolateTrack(a.spec.track, t), t);
      } else a.group.visible = false;
    }
    if (t > 84 && t < 158) {
      paratroopers.visible = true;
      updateParatroopers(paratroopers, (t - 88) / 70, t);
    } else paratroopers.visible = false;
    environment.update(1, t);   // dt 給 1 秒:HDRI 的 crossfade 一次到位,定格畫面才代表實際觀感
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
    terrain, environment, missingAssets,
    setPlaying: (v) => { playing = v; hud.setPlaying(v); },
    render: () => renderFrame(0.016),
  };
}
