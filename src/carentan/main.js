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
import { createUnit, applyUnitModels } from './scene/soldiers.js';
import { createAssetHub } from './scene/assets.js';
import { Effects } from './scene/effects.js';
import { makeLabel, LABEL_LAYER } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';
import { AudioEngine } from './scene/audio.js';
import { createComposer } from './scene/postfx.js';
import { getQuality, setQuality, cycleQuality, createAutoDowngrade } from './scene/quality.js';
import { createRigHub, SOLDIER_SCALE } from './scene/rig.js';

const isMobile = window.matchMedia('(max-width: 640px)').matches;
const LABEL_SCALE = isMobile ? 0.6 : 1;
const SHADOWS = !isMobile;   // P-2：陰影桌機限定
const POSTFX = !isMobile;    // P-3：後製桌機限定

// ── R5 畫質分級：建場景「之前」定案（?q= → localStorage → UNMASKED_RENDERER）──
const quality = getQuality({ mobile: isMobile });

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const DPR_CAP = Math.min(window.devicePixelRatio, isMobile ? 1.5 : quality.pixelRatio);
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

// R4 驗收用:dev server 加 ?legacy=1 就整條回到升級前(單張正交陰影＋舊後製),
// 同機位拍開／關對照。import.meta.env.DEV 在正式 build 是常數 false,整段會被搖掉。
const QA_LEGACY = !!(import.meta.env && import.meta.env.DEV) && location.search.includes('legacy=1');
const environment = createEnvironment(scene, {
  shadows: SHADOWS, mobile: isMobile, camera: QA_LEGACY ? null : camera, quality,
});
const terrain = createCarentanTerrain(scene, { shadows: SHADOWS, mobile: isMobile, quality });
const effects = new Effects(scene, { mobile: isMobile, density: quality.particleDensity });
const director = new Director(camera, controls);
const audio = new AudioEngine();

// P-3：後製 composer（桌機）；手機直接 renderer.render
// R4-4 調色(§R4.4)＋ R4-1 GTAO ＋ R4-3 導演景深
const post = POSTFX ? createComposer(renderer, scene, camera, {
  grade: {
    lift: [0.006, 0.008, 0.004],
    gamma: [1, 1.005, 1],
    gain: [1.02, 1.01, 0.965],
    saturation: 1.04,
    contrast: 0.16,
    shadowTint: [0, 0.5, 0.55],
    highlightTint: [0.85, 0.62, 0.15],
    split: [0.03, 0.05],
  },
  gtao: { radius: 4, distanceExponent: 1, thickness: 1, scale: 1.5, blend: 0.7 },
  bokeh: { aperture: 0.00008, maxblur: 0.006 },
  // §R5.2：high 全開／medium 關 GTAO＋bloom 半解析度／low 只留 OutputPass＋調色
  features: {
    gtao: quality.gtao, gtaoScale: quality.gtaoScale,
    bloom: quality.bloom, bloomScale: quality.bloomScale,
    bokeh: quality.bokeh, smaa: quality.smaa,
  },
}) : null;
if (QA_LEGACY && post) post.setPipeline('legacy');
function renderFrame(dt) {
  if (post) {
    // 主場景走後製(相機只看第 0 層);標籤(LABEL_LAYER)在後製之後獨立疊上去,
    // 不吃 bloom／景深／SMAA／顆粒,鏡頭拉近文字仍銳利。
    camera.layers.set(0);
    post.render(dt);
    camera.layers.set(LABEL_LAYER);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;
    camera.layers.set(0);
  } else {
    camera.layers.enable(LABEL_LAYER);
    renderer.render(scene, camera);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (post) post.setSize(window.innerWidth, window.innerHeight);
  environment.resizeShadows();   // CSM 的切分是依鏡頭視錐算的
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
    spd: 0,   // R1：平滑過的移動速度（公尺／秒），拿來選 walk／run
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
    rigs.snapAll();   // R1：拖曳後動畫狀態重選，不要留著上一段的交叉淡入
    effects.clearTransients(); hud.hideEvent(); hud.hideSummary(); hud.hideIntel();
  },
  onJump: (t) => {
    battleT = t; prevT = t; summaryShown = false; snapRot = true;
    rigs.snapAll();
    effects.clearTransients(); hud.hideSummary();
    const e = events.find((ev) => ev.t === t);
    if (e) fireEvent(e);
    hud.setTime(t);
  },
  onModeToggle: (mode) => director.setMode(mode),
  onReplay: () => {
    battleT = TIME_START; prevT = TIME_START; summaryShown = false; playing = true; snapRot = true;
    rigs.snapAll();
    effects.clearTransients(); hud.hideSummary(); hud.hideIntel(); hud.setPlaying(true);
    triggerEventsBetween(TIME_START - 1, battleT);
  },
  onVolume: (v) => audio.setVolume(v),
  onAudioToggle: (on) => audio.setEnabled(on),
  // §R5.3 HUD 右上「畫質：高／中／低」小按鈕（寫 localStorage 後 reload）
  quality,
  onQuality: () => cycleQuality(),
});

// 點擊 3D 中的人物標記 → 開啟小卡
const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll();
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

// ── R1 骨架動畫的情境提示（§R1.5：街戰逐屋肅清 crouch_walk、路堤守軍 kneel／prone_fire）──
//   'clear'  6/12 突入市鎮到市鎮陷落之間，E 連壓低身形逐屋推進
//   'defend' 6/13 背靠鐵路路堤死守（靜止時跪射／臥射）；德軍市鎮守軍與 MG42 火力點恆為守勢
const CLEAR_UNITS = new Set(['easy-assault', 'welsh-platoon']);
const GULCH_UNITS = new Set(['easy-assault', 'welsh-platoon', 'base-mg']);
const HOLD_UNITS = new Set(['fjr6-town', 'mg42-cafe']);
function clipHint(id, t) {
  if (CLEAR_UNITS.has(id) && t >= 396 && t <= 455) return 'clear';
  if (GULCH_UNITS.has(id) && t >= 600) return 'defend';
  if (HOLD_UNITS.has(id)) return 'defend';
  return null;
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

    // R1：士兵骨架動畫 —— clip 依「實際移動速度」選，倍率 = 速度 ÷ extras.speed（腳不滑）
    const moved = Math.hypot(st.pos.x - o.prevX, st.pos.z - o.prevZ);
    o.prevX = st.pos.x; o.prevZ = st.pos.z;
    const isDown = st.status === 'destroyed' && o.downT != null;
    // 場景單位 → 公尺（士兵是「1.75 公尺 = 3.25 單位」的 diorama 尺度）
    const rawSpd = snapRot || dt <= 0 ? 0 : (moved / dt) / SOLDIER_SCALE;
    o.spd = snapRot ? 0 : o.spd + (rawSpd - o.spd) * Math.min(1, dt * 8);
    if (o.troopers.length) {
      const hint = clipHint(id, battleT);
      for (const tr of o.troopers) {
        const rig = tr.userData.rigUnit;
        if (rig) {
          const ph = tr.userData.phase ?? 0;
          // 守勢段：原本就跪姿的（MG42 射手、火力組）維持跪射，站姿的依相位分一部分去臥射
          const base = tr.userData.posture ?? 'stand';
          const posture = hint === 'defend' && base === 'stand' && (ph % 1) > 0.62 ? 'prone' : base;
          rig.apply(isDown ? 0 : o.spd, { posture, hint, downed: isDown });
        } else if (!isDown) {
          // fallback（骨架 glb 還沒到／載入失敗）：維持原本的行進微動作
          const ph = tr.userData.phase ?? 0;
          const movingAmp = moved > 0.03 ? 1 : 0.22;
          tr.position.y = (tr.userData.baseY ?? 0) + Math.sin(time * 7 + ph) * 0.14 * movingAmp;
          tr.rotation.z = Math.sin(time * 7 + ph) * 0.03 * movingAmp;
        }
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
  rigs.update(dt);            // R1：38 具 SkinnedMesh 的 mixer（頻率依畫質等級）
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

  // R4-2／R4-3:鏡頭這一幀已經定案 → 更新 cascade 陰影框、跟拍景深
  environment.updateShadows();
  if (post) {
    const following = director.mode === 'director' && !!director.followFn;
    post.setBokeh(following);
    if (following) post.setFocus(camera.position.distanceTo(controls.target));
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

// ── R5-1 執行期自動降級：滾動平均幀時間連續 3 秒 > 40 ms → 降一級 ────────────
// 先動可即時切換的旋鈕（pixelRatio、GTAO、mixer 頻率、草叢），需重建的（cascade 層數、
// composer 組成、植被等級）寫 localStorage 後 reload。不自動升級，避免振盪。
const autoQuality = createAutoDowngrade({
  paused: () => perfLock || !started,
  onInstant: (q) => {
    curRatio = Math.min(DPR_CAP, q.pixelRatio);
    renderer.setPixelRatio(curRatio);
    if (post) { post.setPixelRatio(curRatio); post.setGTAO(q.gtao); }
    rigs.setStride(q.mixerStride);
    terrain.setDetail?.(q.grassDetail);
  },
});

function fpsSample(dt) {
  autoQuality.sample(dt);
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
    terrain.setDetail?.(0.5);   // 降級同時砍半草叢
    goodStreak = 0;
  } else if (fps > (isMobile ? 40 : 55)) {
    goodStreak += 2;
    if (goodStreak >= 4 && aoLevel > 0) {
      setAoLevel(aoLevel - 1);   // R4-6:回升時先把 GTAO 救回來
      goodStreak = 0;
    } else if (goodStreak >= 4 && curRatio < DPR_CAP) {
      curRatio = Math.min(DPR_CAP, curRatio + 0.25);
      renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
      terrain.setDetail?.(1);
      goodStreak = 0;
    }
  } else goodStreak = 0;
}

// R4-2:程序化場景建好後,把現有材質一次註冊給 CSM(資產載入後 environment 內每 0.5 秒會再掃一次)
environment.refreshShadowMaterials();

// ── 資產 hub 與 R1 骨架士兵 hub（tick() 之前要先存在：每幀會呼叫 rigs.update）──
const assets = createAssetHub({ mobile: isMobile, renderer, baked: quality.baked });
const rigs = createRigHub({
  assets,
  // low 走單張正交 1024 陰影：38 具蒙皮小兵在那張圖上只有兩三個 texel，投影看不見卻要多跑
  // 一次蒙皮頂點著色（本場 low 最大的一筆）→ low 不讓士兵投影。
  shadows: SHADOWS && quality.shadow !== 'legacy',
  // §R6：SkeletonUtils.clone／材質 clone 之後一定要註冊給 CSM，否則被三盞 cascade 燈各照一次
  register: (obj) => environment.registerObject(obj),
});
rigs.setStride(quality.mixerStride);

hud.setTime(battleT);
tick();

// ── 真實資產（docs/asset-pipeline-spec.md §3）────────────────────
// 首屏不等資產：上面 tick() 已經開始畫程序化版本、HUD 與時間軸照常運作，
// 這裡在第一幀之後才開始載，分兩批：
//   core  —— 地表 PBR、市鎮 glb、HDRI 環境光（畫面觀感的主體）
//   extra —— 陣地道具、Poly Haven 植被、單位模型（晚一點到不影響閱讀）
// 任何一項失敗都只是那一項留在程序化版本（見各 applyAssets 的 try/catch）。
// ?noassets=1 → 完全不載真實資產，整場停在程序化版本（QA 用的 A／B 開關，也是最後一道 fallback）
const ASSETS_OFF = new URLSearchParams(location.search).has('noassets');
function afterFirstFrame(fn) {
  let fired = false;
  const go = () => { if (!fired) { fired = true; fn(); } };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 0)));
  setTimeout(go, 300);   // 背景分頁不跑 rAF：最多等 300 ms 也要開始載
}
if (!ASSETS_OFF) afterFirstFrame(async () => {
  const t0 = performance.now();
  await Promise.allSettled([
    terrain.applyAssets(assets, { stage: 'core' }),
    environment.applyAssets(assets),
  ]);
  const coreStats = assets.stats();
  await Promise.allSettled([
    terrain.applyAssets(assets, { stage: 'extra' }),
    (async () => {
      let swapped = 0;
      for (const [, o] of unitObjs) {
        swapped += await applyUnitModels(o.group, assets, {
          rigs, baked: quality.baked, shadows: SHADOWS && quality.shadow !== 'legacy',
          register: (obj) => environment.registerObject(obj),
        });
        o.troopers = o.group.userData.troopers ?? o.troopers;   // 已換成 SkinnedMesh
        // 單位材質可能被換成 Standard：先把舊材質的淡出還原掉（避免資產到位前
        // 已經拖到某單位陣亡、材質停在半透明／褪色），再清掉快取讓下次淡出重抓。
        restoreLook(o);
        o.mats = null; o.faded = false;
      }
      return swapped;
    })(),
  ]);
  const all = assets.stats();
  if (import.meta.env && import.meta.env.DEV) window.__assets = {
    hub: assets,
    core: coreStats,
    all,
    terrain: terrain.assetState(),
    env: environment.envActive(),
    ms: Math.round(performance.now() - t0),
  };
  if (import.meta.env && import.meta.env.DEV) {
    console.info(`[carentan] 資產就緒：核心 ${coreStats.mb} MB／全部 ${all.mb} MB（${all.files} 個檔案，${Math.round(performance.now() - t0)} ms）`);
  }
});

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
    // R5:目前畫質等級與判定來源;__dbg.setQuality('low') 會寫 localStorage 後 reload
    quality: () => ({
      tier: quality.tier, source: quality.source, gpu: quality.gpu,
      pixelRatio: renderer.getPixelRatio(), gtao: !!post?.gtaoEnabled(),
      cascades: quality.cascades, mixerStride: quality.mixerStride, baked: quality.baked,
      rigs: rigs.count(),
    }),
    setQuality: (t) => setQuality(t),
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
    THREE, scene, camera, controls, renderer, director, dbgSeek, dbgLook,
    render: () => renderFrame(0.016),
  };
}
