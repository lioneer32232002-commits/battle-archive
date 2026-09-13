// 巴斯通之圍(突出部之役)3D 模擬 — 主程式
// 品質升級(見 docs/quality-upgrade-spec.md):ACES 色調映射、Catmull-Rom 曲線插值＋朝向阻尼、
//   士兵行進微動作、桌機陰影＋後製、飄雪、鏡頭手感、動態解析度。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TIME_START, TIME_END, units, events, sides, outcome, aces, tactics,
} from './data/battle.js';
import { unitStateAt, newEvents } from './engine/timeline.js';
import { createEnvironment } from './scene/environment.js';
import { createBastogneTerrain } from './scene/terrain.js';
import { createUnit, upgradeUnit, animateUnit } from './scene/soldiers.js';
import { getQuality, cycleQuality, TIER_LABEL } from './scene/quality.js';
import { createAssets } from './scene/assets.js';
import { Effects } from './scene/effects.js';
import { makeLabel } from './scene/labels.js';
import { Director } from './camera/director.js';
import { createHUD } from './ui/hud.js';
import { AudioEngine } from './scene/audio.js';
import { createSnow, createTownFires } from './scene/weather.js';
import { createComposer } from './scene/postfx.js';

const isMobile = window.matchMedia('(max-width: 640px)').matches;
const LABEL_SCALE = isMobile ? 0.6 : 1;
// R5 畫質分級:?q=high|medium|low → localStorage → 依 UNMASKED_RENDERER 自動判定。
//   一定要在建場景**之前**問出來:植被數量、CSM 層數、composer 組成都是建構時決定的。
const Q = getQuality({ mobile: isMobile });
const SHADOWS = Q.shadows !== 'none';   // B-2：陰影桌機限定
const POSTFX = !isMobile;               // B-5：後製桌機限定(low 只剩 OutputPass＋調色)

// ── 基本場景 ─────────────────────────────────────────
const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const DPR_CAP = Math.min(window.devicePixelRatio, Q.pixelRatioCap);
renderer.setPixelRatio(DPR_CAP);
renderer.setSize(window.innerWidth, window.innerHeight);
// B-1:ACES 色調映射(手機桌機都開;調色盤已據此重校)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // §9-4:three 0.184 已棄用 PCFSoftShadowMap
}
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);
camera.position.set(-96, 78, 150);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -10);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 20;
controls.maxDistance = 3000;
controls.enableDamping = true;

// R4 驗收用:dev server 加 ?legacy=1 就整條回到升級前(單張正交陰影＋舊後製),
// 同機位拍開／關對照。import.meta.env.DEV 在正式 build 是常數 false,整段會被搖掉。
const QA_LEGACY = !!(import.meta.env && import.meta.env.DEV) && location.search.includes('legacy=1');

// R4-2:CSM 需要鏡頭(cascade 框跟著視錐走);手機不傳 shadows 就完全不建 CSM
const environment = createEnvironment(scene, { shadows: SHADOWS, camera: QA_LEGACY ? null : camera, quality: Q });
const terrain = createBastogneTerrain(scene, { shadows: SHADOWS, mobile: isMobile, quality: Q });
const effects = new Effects(scene, { mobile: isMobile });
const director = new Director(camera, controls);
const audio = new AudioEngine();
const SNOW_FULL = Math.max(300, Math.round(1500 * Q.particles));   // §R5.2 粒子量依畫質
const snow = createSnow(scene, { count: SNOW_FULL });
const townFires = createTownFires(scene, [{ x: 40, z: 300 }, { x: -30, z: 320 }, { x: 110, z: 300 }]);

// 後製 composer(桌機);手機直接 renderer.render
// R4-4 調色:巴斯通＝低飽和冷灰(圍城的陰霾與雪),陰影再壓一點青、亮部只留極淡的暖,
//   對比走 S 曲線讓雪面不死白、林線不糊成一團。
const post = POSTFX ? createComposer(renderer, scene, camera, {
  grade: {
    lift: [0.004, 0.008, 0.016],
    gamma: [1.00, 1.00, 1.015],
    gain: [0.975, 0.99, 1.035],
    saturation: 0.86,
    contrast: 0.20,
    shadowTint: [0.0, 0.5, 0.7],
    highlightTint: [0.8, 0.55, 0.15],
    split: [0.045, 0.03],
  },
  // GTAO:規格寫「陸戰約 6 單位」,但本場 1 單位≈1 個人身寬,實測 6 單位的取樣半徑太散、
  //   接地感反而不見(AO 幾乎恆為 1)。收到 4 並把 scale 拉到 1.5、blend 0.7,
  //   才在士兵腳下、沙包堆、散兵坑緣、彈藥箱底看得到接觸暗部,且無黑邊光暈。
  gtao: { radius: 4, distanceExponent: 1, thickness: 1, scale: 1.5, blend: 0.7 },
  bokeh: { aperture: 0.00008, maxblur: 0.006 },
  // §R5.2:high 全開;medium 關 GTAO、bloom 半解析度;low 只剩 OutputPass ＋ 調色
  features: { gtao: Q.gtao, bloom: Q.bloom, bokeh: Q.bokeh, smaa: Q.smaa },
  bloomScale: Q.bloomScale,
  samples: Q.msaa,
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
  const group = createUnit(u);
  scene.add(group);
  if (u.kind !== 'mg') {
    const label = makeLabel(u.name, { side: u.side });
    label.position.y = u.labelY ?? 13;
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

// R4-2:程序化場景建好後,把現有材質一次註冊給 CSM(之後載入的資產另外再註冊一次)
environment.refreshShadowMaterials();

// ── 真實資產(docs/asset-pipeline-spec.md §3) ────────────────
// 場景已經在上面用程序化版本建好、也已經開始跑;資產是「之後補上去」的,
// 任何一項失敗都只是留著程序化版本,首屏與 HUD 不等它。
const assets = createAssets({
  mobile: isMobile, renderer,
  onMaterial: (m) => environment.registerMaterial(m),   // R4-2:glb 材質一載進來就註冊給 CSM
});
const assetsApplied = assets.ready.then(async () => {
  environment.applyAssets(assets);
  const terrainDone = await terrain.applyAssets(assets);
  const unitDone = [];
  for (const [, o] of unitObjs) {
    const ok = await upgradeUnit(o.group, o.spec, assets, {
      shadows: SHADOWS, quality: Q,
      register: (obj) => environment.registerObject(obj),   // R6:clone 過的材質立刻收編給 CSM
    });
    if (ok) {
      o.mats = null; o.faded = false;
      o.troopers = o.group.userData.troopers ?? [];          // R1:改指向 SkinnedMesh
      o.animated = !!o.group.userData.anim;
      unitDone.push(o.spec.id);
    }
  }
  // 換模／換材質之後一定要重新註冊,否則新材質會被三盞 cascade 燈各照一次(變三倍亮)
  const csmMats = environment.refreshShadowMaterials();
  const report = { terrain: terrainDone, units: unitDone, csmMats, missing: assets.missingModels() };
  if (import.meta.env && import.meta.env.DEV) console.info('[bastogne] 資產替換', report);
  return report;
}).catch((e) => { console.warn('[bastogne] 資產替換失敗,保留程序化場景', e); return null; });

// 部隊大標籤(跟隨)
const formationLabels = [
  { unit: 'easy-line', label: makeLabel('E 連 · 506 PIR', { side: 'blue', big: true, sub: '傑克森林守線 · 約 120 人' }), dy: 30 },
  { unit: 'vg-line', label: makeLabel('第 26 國民擲彈兵', { side: 'red', big: true, sub: '圍城主力 · 自佛伊施壓' }), dy: 28 },
];
for (const f of formationLabels) {
  f.label.scale.multiplyScalar(0.34 * LABEL_SCALE);
  scene.add(f.label);
}

// ── 關鍵人物標記(可點開小卡) ────────────────────────
const aceObjs = aces.map((ace) => {
  const g = new THREE.Group();
  const pin = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 8), new THREE.MeshBasicMaterial({ color: 0xffd97a }));
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

// ── 戰術幾何疊圖:交叉火網／殺戮區(招牌手法) ───────────────
function buildTacticsOverlay() {
  const g = new THREE.Group();
  // 火道:自機槍位置扇向北面開闊雪原
  for (const lane of tactics.fireLanes) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(lane.map((p) => new THREE.Vector3(p.x, 1.6, p.z))),
      new THREE.LineBasicMaterial({ color: 0x5ea8ff, transparent: true, opacity: 0.55 })
    );
    g.add(line);
  }
  // 機槍位置錐標
  for (const b of tactics.baseOfFire) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(1.8, 5, 6), new THREE.MeshBasicMaterial({ color: 0x5ea8ff }));
    m.position.set(b.x, 2.5, b.z); g.add(m);
  }
  // 德軍攻擊軸(自佛伊)
  const app = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(tactics.approach.map((p) => new THREE.Vector3(p.x, 1.6, p.z))),
    new THREE.LineBasicMaterial({ color: 0xff7a5e, transparent: true, opacity: 0.6 })
  );
  g.add(app);
  // 殺戮區圈
  const kz = new THREE.Mesh(
    new THREE.RingGeometry(28, 34, 40),
    new THREE.MeshBasicMaterial({ color: 0x7cd8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  kz.rotation.x = -Math.PI / 2; kz.position.set(tactics.killZone.x, 0.6, tactics.killZone.z); g.add(kz);
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
  // §R5.3:HUD 右上角的「畫質：高／中／低」小按鈕,循環切換(寫 localStorage 後重載)
  quality: isMobile ? null : { label: TIER_LABEL[Q.tier], onCycle: () => cycleQuality() },
});

// 點擊 3D 人物標記 → 開啟小卡
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _fwd = new THREE.Vector3();
const _camPos = new THREE.Vector3();
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
  else if (e.intel) hud.showIntel(e.intel);   // sync 事件也可帶情報落差卡
  else hud.hideIntel();
  for (const fx of e.fx ?? []) runFx(fx);
}

function triggerEventsBetween(a, b) {
  for (const e of newEvents(events, a, b)) fireEvent(e);
}

const _fxPos = new THREE.Vector3();
function runFx(fx) {
  const pos = fx.pos
    ? _fxPos.set(fx.pos.x, 4, fx.pos.z).clone()
    : fx.unit
      ? unitObjs.get(fx.unit)?.group.position.clone().setY(4)
      : null;
  if (!pos) return;
  // A-4:近距離事件觸發鏡頭震動(遠則弱/不觸發)
  const near = camera.position.distanceTo(pos);
  const shakeFor = (base) => { if (near < 500) director.shake(base * (1 - near / 500), 0.5); };
  switch (fx.kind) {
    case 'gunfire': effects.gunfire(pos, 6); audio.sfx('gunfire'); break;
    case 'assault': effects.assault(pos, 5); audio.sfx('assault'); shakeFor(3); break;
    case 'destroy': effects.destroy(pos, 1.5); audio.sfx('destroy'); shakeFor(6); break;
    case 'reveal': effects.reveal(pos); audio.sfx('reveal'); break;
    case 'barrage': effects.barrage(pos, 16); audio.sfx('explosion'); shakeFor(5); break;
    case 'smoke': effects.smoke(pos, 12); break;
    case 'treeburst': effects.treeburst(pos.setY(4)); audio.sfx('explosion'); shakeFor(6); break;
  }
}

// ── 每幀更新 ─────────────────────────────────────────
const DESTROY_DUR = 9;
let lastNow = performance.now();
let elapsed = 0;
let panelAcc = 0;
let mixerAcc = 0, mixerFrames = 0;   // R1：骨架 mixer 的更新節流

const FADE_PALE = new THREE.Color(0x53565c);
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

// A-2:最短角差(處理 ±π 環繞)
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
  Q.sample(dt);      // §R5.1:連續 3 秒平均幀時間 > 40 ms → 降一級(寫 localStorage 後重載)

  if (playing && started) {
    prevT = battleT;
    let adv = speed;
    const nextEv = events.find((ev) => ev.t > battleT + 0.01);
    const gap = nextEv ? nextEv.t - battleT : 999;
    if (gap > 30) adv = speed * Math.min(3.5, 1 + (gap - 30) / 40);   // 冷場自動快轉
    battleT = Math.min(battleT + dt * adv, TIME_END);
    if (battleT >= TIME_END) {
      playing = false;
      hud.setPlaying(false);
      if (!summaryShown) { summaryShown = true; hud.showSummary(); }
    }
    triggerEventsBetween(prevT, battleT);
    hud.setTime(battleT);
  }

  // R1／R5:士兵 mixer 的更新頻率依畫質(high 每幀、medium 每 2 幀、low 每 3 幀)。
  //   略過的那幾幀把 dt 累起來,下次一次補上 —— 動作速度不變,只是更新粗一點。
  mixerAcc += dt;
  mixerFrames++;
  let mixerTick = false, mixerDt = 0;
  if (mixerFrames >= Q.mixerEvery) {
    mixerFrames = 0; mixerTick = true; mixerDt = mixerAcc; mixerAcc = 0;
  }

  // 單位
  const rotK = 1 - Math.pow(0.001, dt); // A-2 阻尼係數
  for (const [id, o] of unitObjs) {
    const st = unitStateAt(o.spec, battleT);
    o.group.position.x = st.pos.x;
    o.group.position.z = st.pos.z;

    // A-2:朝向阻尼(拖曳/跳轉後直接對齊)
    const targetRot = o.spec.facing != null ? o.spec.facing : -st.heading;
    if (snapRot) o.curRot = targetRot;
    else o.curRot += shortestAngleDiff(targetRot, o.curRot) * rotK;
    o.group.rotation.y = o.curRot;

    // R1:骨架動畫。實際移動速度(單位／秒)決定 clip 與播放倍率;
    //   拖曳／跳轉那一幀的位移是假的(整個時間軸跳過去),用 snapRot 當旗標略過。
    const moved = Math.hypot(st.pos.x - o.prevX, st.pos.z - o.prevZ);
    o.prevX = st.pos.x; o.prevZ = st.pos.z;
    const destroyed = st.status === 'destroyed' && o.downT != null;
    const rawSpeed = dt > 1e-4 && !snapRot ? moved / dt : 0;
    o.speed = o.speed == null ? rawSpeed : o.speed + (rawSpeed - o.speed) * 0.25;   // 抖動平滑
    if (o.animated && mixerTick) {
      animateUnit(o.group, {
        dt: mixerDt, speed: o.speed, destroyed,
        snap: snapRot || o.wasSnapped,
      });
      o.wasSnapped = false;
    } else if (o.animated && snapRot) {
      o.wasSnapped = true;    // 這一幀不輪到 mixer,把「要歸位」記著,下次更新時處理
    } else if (!o.animated && !destroyed && o.troopers.length) {
      // A-3 行進微動作(骨架版之前的 fallback:靜態姿態 glb／程序化小兵)
      const movingAmp = moved > 0.03 ? 1 : 0.22;
      for (const tr of o.troopers) {
        const ph = tr.userData.phase ?? 0;
        tr.position.y = (tr.userData.baseY ?? 0) + Math.sin(time * 7 + ph) * 0.14 * movingAmp;
        tr.rotation.z = Math.sin(time * 7 + ph) * 0.03 * movingAmp;
      }
    }

    if (destroyed) {
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

  // 戰術幾何疊圖:耶誕前後的防守期顯示
  tacticsOverlay.visible = battleT >= 520 && battleT <= 690;

  animateScene(time);
  environment.update(dt, battleT);
  terrain.update(dt, environment.night);   // B-3：夜相窗戶橘光、遠景樹線隨相位變暗
  effects.update(dt);
  director.update(dt);
  controls.update();

  camera.getWorldPosition(_camPos);
  snow.update(dt, _camPos);
  townFires.update(dt);

  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-6) {
    const camBearing = (Math.atan2(_fwd.x, -_fwd.z) * 180) / Math.PI;
    hud.setHeading(camBearing);
  }

  // R4-2／R4-3:鏡頭這一幀已經定案 → 更新 cascade 陰影框、跟拍景深
  environment.updateShadows();
  if (post) {
    const following = director.mode === 'director' && !!director.followFn;
    post.setBokeh(following);
    if (following) post.setFocus(camera.position.distanceTo(controls.target));
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

// ── 動態解析度(C-3):滾動平均 FPS,每 2 秒結算 ─────────────
// R4-6:降級順序是「先砍 GTAO 再降解析度」(GTAO 內部要重跑一次幾何,是最貴的一關)。
//   0 = 全開 → 1 = GTAO 降 1/4 解析度 → 2 = GTAO 關 → 之後才動 pixelRatio。
let fpsAcc = 0, fpsFrames = 0, fpsTimer = 0, goodStreak = 0;
let curRatio = DPR_CAP;
let aoLevel = 0;
let perfLock = false;   // __dbg.dbgPerf 量測期間凍結動態解析度
const FLOOR = isMobile ? 1.0 : DPR_CAP * 0.75;
function setAoLevel(n) {
  if (!post || !post.features.gtao || aoLevel === n) return;
  aoLevel = n;
  post.setGtaoScale(n >= 1 ? 0.25 : 0.5);
  post.setGTAO(n < 2);
}
function fpsSample(dt) {
  fpsAcc += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer < 2) return;
  const fps = fpsFrames / fpsAcc;
  fpsTimer = 0; fpsAcc = 0; fpsFrames = 0;
  if (perfLock) return;
  const lowT = isMobile ? 27 : 45;
  if (fps < lowT && post && post.features.gtao && aoLevel < 2) {
    setAoLevel(aoLevel + 1);
    goodStreak = 0;
  } else if (fps < lowT && curRatio > FLOOR) {
    curRatio = Math.max(FLOOR, curRatio - 0.25);
    renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
    snow.setCount(Math.round(SNOW_FULL * 0.52));   // 降級同時砍半雪粒子
    goodStreak = 0;
  } else if (fps > (isMobile ? 40 : 55)) {
    goodStreak += 2;
    if (goodStreak >= 4 && curRatio < DPR_CAP) {
      curRatio = Math.min(DPR_CAP, curRatio + 0.25);
      renderer.setPixelRatio(curRatio); if (post) post.setPixelRatio(curRatio);
      snow.setCount(SNOW_FULL);
      goodStreak = 0;
    } else if (goodStreak >= 4 && aoLevel > 0) {
      setAoLevel(aoLevel - 1);
      goodStreak = 0;
    }
  } else goodStreak = 0;
}

hud.setTime(battleT);
tick();

// ── 開發用美術除錯掛勾(正式 build 由 import.meta.env.DEV 移除) ──
if (import.meta.env && import.meta.env.DEV) {
  const dbgSeek = (t) => {
    battleT = t; prevT = t; snapRot = true;   // 主迴圈的日相也跟著跳,否則每幀又被拉回開場
    for (const [, o] of unitObjs) {
      const st = unitStateAt(o.spec, t);
      o.group.position.set(st.pos.x, 0, st.pos.z);
      o.group.rotation.y = o.spec.facing != null ? o.spec.facing : -st.heading;
      o.group.rotation.z = 0;
      o.group.visible = true;
      restoreLook(o);
    }
    environment.update(0, t);
    environment.updateShadows();
    renderFrame(0.016);
    return t;
  };
  const dbgLook = (tx, ty, tz, px, py, pz) => {
    controls.target.set(tx, ty, tz);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld();
    environment.updateShadows();
    renderFrame(0.016);
  };
  // 美術驗收:凍結運鏡與 HUD,讓截圖只反映場景本身
  const dbgFreeze = () => {
    playing = false;
    director.flyTo = () => {}; director.follow = () => {}; director.update = () => {};
    const st = document.createElement('style');
    st.textContent = 'aside,.side-panel,.event-card,.intel-card,.summary,.figure-card{display:none!important}';
    document.head.appendChild(st);
  };
  // R4-6 效能量測:固定 1600×1000、dpr 1.5,同步量單幀渲染時間。
  // ⚠ gl.finish() 在 ANGLE/D3D11 上不會真的擋住 CPU(實測同一幀量出 5 ms 與 123 ms),
  //   要用 readPixels 讀預設 framebuffer 才會逼出真正的同步點。
  const _px = new Uint8Array(4);
  const dbgPerf = (n = 10) => {
    const gl = renderer.getContext();
    const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _px); };
    const prevRatio = renderer.getPixelRatio();
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevAspect = camera.aspect;
    perfLock = true;
    Q.setLock(true);
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
    dbgFreeze,
    // 美術驗收:dbgFreeze 之後把時間軸放回去跑(運鏡仍然凍結),才拍得到士兵真的在邁步
    setPlaying: (v = true) => { started = true; playing = !!v; return playing; },
    setSpeed: (s) => { speed = s; return speed; },
    THREE, scene, camera, controls, renderer, director, effects, terrain, environment, dbgSeek, dbgLook,
    assets, assetsApplied, post, dbgPerf,
    // A/B 對照:__dbg.pipeline('legacy') 回到升級前的管線,('modern') 全開
    pipeline: (mode) => { if (post) post.setPipeline(mode); renderFrame(0.016); return mode; },
    // 截圖前凍結畫質(擋掉動態解析度／GTAO 自動降級,否則慢機器上拍到的是降級後的畫面)
    quality: Q,
    freezeQuality: (on = true) => {
      perfLock = !!on;
      Q.setLock(!!on);          // 連畫質分級的自動降級(會 reload!)也一起凍結
      if (on) {   // 回到全畫質:GTAO 全開、pixelRatio 回到上限
        setAoLevel(0);
        curRatio = DPR_CAP;
        renderer.setPixelRatio(curRatio);
        if (post) post.setPixelRatio(curRatio);
      }
      return perfLock;
    },
    render: () => renderFrame(0.016),
  };

  // 美術驗收用的一鍵佈景:#qa=t,tx,ty,tz,px,py,pz
  // (dev server 常因其他戰役的檔案變動而整頁重載,靠 hash 才能「重載後自己回到同一格」)
  const qaApply = () => {
    if (!location.hash.startsWith('#qa=')) return;
    const n = location.hash.slice(4).split(',').map(Number);
    dbgFreeze();
    dbgSeek(n[0] ?? 70);
    dbgLook(n[1] ?? 0, n[2] ?? 8, n[3] ?? 0, n[4] ?? 60, n[5] ?? 30, n[6] ?? 120);
  };
  window.addEventListener('hashchange', qaApply);
  if (location.hash.startsWith('#qa=')) {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('進入戰場'));
    btn?.click();
    assetsApplied.then(() => { for (const ms of [400, 1200, 2500, 4000]) setTimeout(qaApply, ms); });
  }
}
