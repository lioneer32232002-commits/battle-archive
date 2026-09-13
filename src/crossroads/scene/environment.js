// 環境：天空、地面、貼地濃霧、雲層、星空、太陽本體、光照 — 依戰役時刻變化（拂曉前 → 日出）
// 情緒主軸（規格 §6）：1944 年 10 月荷蘭島區的「濃霧拂曉」——
//   霧近、地平線灰白、日出前後最濃，之後漸散、圩田水溝開始反光。霧是這場的招牌，
//   但刻意壓在人的胸線以下＋fogNear 拉開，讓單位與 3D 標籤全程可讀。
//
// P-1 升級：renderer 端已開 ACES 色調映射（見 main.js）；ACES 會使整體變暗、對比變高，
//   本調色盤已據此把 sunInt／amb 較原值提高約 25–40%、天空與霧色重校，避免死暗或過曝。
// P-2：太陽 castShadow，正交範圍只罩堤防戰鬥核心區（±300）。
// P-5：沿 sun 方向的太陽本體 Sprite ＋ 更大更淡的光暈；拂曉橘紅低日、白晝縮小變白。
// P-6：sky shader 地平線再混一層霧帶，讓地平線不是一條硬線（濃霧日尤其重要）。
import * as THREE from 'three';//
// ── R4-2 階層式陰影 CSM(docs/realism-spec.md §R4.2,2026-09-13) ──────────────
// 原本是「一張正交陰影只罩核心區」:出了框就完全沒有影子,框內 2048² 攤在幾百單位上
// 也不夠銳利。改成 CSM(3 層、practical 切分、2048²)後,近層 texel 密度大幅提高,
// 遠層仍有影子。
//
// ⚠ 給整合代理:CSM 會改寫每一個「會被光照的材質」的 shader,**沒有註冊到 CSM 的
//   MeshStandard／Lambert／Phong 材質會被三盞 cascade 燈各照一次 → 亮度變成三倍**。
//   所以任何在資產載入後才新建/替換的材質,一定要註冊:
//       environment.registerObject(group)    // 最常用:traverse 整棵子樹,自動撿出材質
//       environment.registerMaterial(mat)    // 只有單一材質時
//       environment.refreshShadowMaterials() // 懶人版:重掃整個 scene(冪等,可重複呼叫)
//   三個都是冪等的,手機(無 CSM)時是 no-op,回傳新註冊的材質數。
//   保險起見 update() 內每 0.2 秒會自動重掃一次 scene,漏接的材質最多亮 0.2 秒就會被收編。
//   自寫 ShaderMaterial(天空、海面)本來就不吃 three 的燈光系統,不會被註冊也不受影響。
import { CSM } from 'three/addons/csm/CSM.js';

// 日相調色盤（皆已為 ACES 補償後的值；fogNear/fogFar 是這場的主要情緒旋鈕）
const PALETTES = {
  // 03:25–04:45 拂曉前：無月的濃霧夜，地平線被霧反照成微亮灰。
  //   夜相刻意不壓到全黑（規格：無死暗）——霧把微光散回地面，堤體輪廓與單位仍讀得出來。
  night: {
    top: 0x080e18, horizon: 0x212a35, sun: 0x8195b2, sunInt: 0.52, amb: 0.78,
    ground: 0x333d26, fog: 0x161d27, fogNear: 70, fogFar: 1300,
    sunY: 430, sunCol: 0x9fb4d2, sunOp: 0.0, sunSize: 420,
  },
  // 05:30 前後第一道光：濃霧最厚，地平線一片暖灰白，太陽是一顆糊掉的橘盤
  dawn: {
    top: 0x3e4b58, horizon: 0xc0ac8a, sun: 0xffd9a6, sunInt: 1.48, amb: 1.18,
    ground: 0x57633a, fog: 0xa8a691, fogNear: 45, fogFar: 1050,
    sunY: 640, sunCol: 0xffa257, sunOp: 0.95, sunSize: 900,
  },
  // 06:20 之後：十月陰晴的白晝，霧散開、遠景重新拉出來
  day: {
    top: 0x66798a, horizon: 0xb2bcb6, sun: 0xf6f0e0, sunInt: 1.86, amb: 1.44,
    ground: 0x6d7c45, fog: 0xa6b0a8, fogNear: 260, fogFar: 5000,
    sunY: 1250, sunCol: 0xffeecf, sunOp: 0.5, sunSize: 520,
  },
};

// 戰役時刻 → 日相與混合比（拂曉前夜色 → 0500–0540 拂曉 → 陰霾白晝）
function phaseAt(t) {
  if (t < 285) return ['night', 'night', 0];
  if (t < 330) return ['night', 'dawn', (t - 285) / 45];
  if (t < 380) return ['dawn', 'day', (t - 330) / 50];
  return ['day', 'day', 0];
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}
function lerpNum(a, b, f) { return a + (b - a) * f; }

export function createEnvironment(scene, { shadows = false, mobile = false, camera = null } = {}) {
  // ── 天空圓頂（P-6：地平線再疊一層霧帶） ─────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.night.top) },
    uHorizon: { value: new THREE.Color(PALETTES.night.horizon) },
    uFog: { value: new THREE.Color(PALETTES.night.fog) },
    uHaze: { value: 1.0 },   // 霧帶強度：拂曉 1、白晝約 0.45
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(16000, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; uniform float uHaze;
        varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          // P-6：h < 0.08 的一條薄霧帶，把地平線硬線化開（濃霧拂曉的關鍵）
          float band = smoothstep(0.085, 0.0, h);
          col = mix(col, uFog, band * uHaze * 0.9);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.userData.noAO = true;   // R4-1:天空圓頂不進 GTAO 的 G-buffer(見 postfx.js 註)
  scene.add(sky);

  // ── 星空（拂曉前的天幕，天亮淡出） ────────────────────────
  const starGeo = new THREE.BufferGeometry();
  const starN = 700;
  const sp = new Float32Array(starN * 3);
  const rs = mulberry(7);
  for (let i = 0; i < starN; i++) {
    const u = rs() * Math.PI * 2;
    const v = rs() * 0.5 * Math.PI;
    const r = 14000;
    sp[i * 3] = r * Math.cos(v) * Math.cos(u);
    sp[i * 3 + 1] = r * Math.sin(v) * 0.9 + 200;
    sp[i * 3 + 2] = r * Math.cos(v) * Math.sin(u);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xcdd6e8, size: 30, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false })
  );
  scene.add(stars);

  // ── 地面（島區圩田基底，細部地形由 terrain.js 疊上） ──────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshLambertMaterial({ color: PALETTES.night.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  if (shadows) ground.receiveShadow = true;
  scene.add(ground);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.night.sunInt);
  sun.position.set(2400, PALETTES.night.sunY, -320); // 拂曉自東方（下萊茵河上游）低斜射入
  scene.add(sun);
  scene.add(sun.target);

  // ── R4-2:階層式陰影(桌機) ─────────────────────────────
  // sun 本身在開 CSM 時不發光也不投影(intensity 0),只當「日照方向」的單一真源;
  // 光與影由 CSM 的三盞 cascade 燈負責。刻意留在 scene 裡而不移除:three 會把
  // castShadow 的燈排在前面,一盞 intensity 0 的非投影平行光排在後面,對 cascade
  // 索引與亮度都沒有影響。
  const useCSM = shadows && !!camera;
  const _lightDir = new THREE.Vector3();
  let csm = null;
  if (useCSM) {
    _lightDir.copy(sun.position).sub(sun.target.position).normalize().negate();
    csm = new CSM({
      parent: scene,
      camera,
      cascades: 3,
      maxFar: 900,
      mode: 'practical',
      shadowMapSize: 2048,
      shadowBias: -0.0006,
      lightDirection: _lightDir.clone(),
      lightIntensity: PALETTES.night.sunInt,
      lightNear: 1,
      lightFar: 4000,
      lightMargin: 300,
    });
    for (const l of csm.lights) {
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.15;
    }
    sun.intensity = 0;
    sun.castShadow = false;
  } else if (shadows) {
    // 後備:沒有傳 camera 進來就退回原本的單張正交陰影(手機不會走到這裡)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -300; cam.right = 300; cam.top = 300; cam.bottom = -300;
    cam.near = 200; cam.far = 4200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.15;
    cam.updateProjectionMatrix();
  }

  // ── CSM 材質註冊(給整合代理的入口,見檔頭註) ────────────────
  const csmMats = new Set();
  const LIT = (m) => !!(m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial
    || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial));
  function registerMaterial(mat) {
    if (!csm || !LIT(mat) || csmMats.has(mat)) return 0;
    csmMats.add(mat);
    // ⚠ csm.setupMaterial 會直接覆寫 onBeforeCompile。地表／植被那些自己接了
    //   onBeforeCompile 的材質必須串接,不能被吃掉。
    const prev = mat.onBeforeCompile;
    csm.setupMaterial(mat);
    const hook = mat.onBeforeCompile;
    if (typeof prev === 'function' && prev !== hook) {
      mat.onBeforeCompile = function (shader, renderer) {
        prev.call(this, shader, renderer);
        hook.call(this, shader, renderer);
      };
    }
    mat.needsUpdate = true;   // 已經編譯過的材質要重編(defines 變了)
    return 1;
  }
  function registerObject(obj) {
    if (!csm || !obj) return 0;
    let n = 0;
    obj.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) { for (const x of m) n += registerMaterial(x); }
      else n += registerMaterial(m);
    });
    return n;
  }
  const refreshShadowMaterials = () => registerObject(scene);
  let csmScan = 0;
  // 每幀在 controls／director 更新完、renderFrame 之前呼叫(main.js):
  // cascade 框是跟著鏡頭視錐走的,必須拿到「這一幀最終的」camera 矩陣。
  function updateShadows() {
    if (!csm) return;
    camera.updateMatrixWorld();
    csm.update();
  }
  function resizeShadows() {   // 鏡頭 aspect／near／far 變了(resize)要重算切分
    if (!csm) return;
    csm.updateFrustums();
  }
  // 日相會動太陽方向的場次,每幀同步 cascade 燈的方向與顏色強度
  function syncCSM(dt, color, intensity) {
    if (!csm) return;
    for (const l of csm.lights) { l.color.copy(color); l.intensity = intensity; }
    _lightDir.copy(sun.position).sub(sun.target.position).normalize().negate();
    if (!csm.lightDirection.equals(_lightDir)) csm.lightDirection.copy(_lightDir);
    csmScan += dt;
    if (csmScan > 0.2) { csmScan = 0; refreshShadowMaterials(); }   // 收編漏網材質
  }

  const hemi = new THREE.HemisphereLight(0xbfcbd0, 0x35402c, PALETTES.night.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.night.fog, PALETTES.night.fogNear, PALETTES.night.fogFar);

  // ── P-5：太陽本體＋光暈（沿 sun.position 方向、掛在天空圓頂內側） ──
  const sunTex = makeGlowTexture(0.30);
  const haloTex = makeGlowTexture(0.02);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, color: 0xffb069, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
  }));
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: 0xffc98e, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
  }));
  sunDisc.renderOrder = -1; sunHalo.renderOrder = -2;
  scene.add(sunHalo); scene.add(sunDisc);
  const _sunDir = new THREE.Vector3();

  // ── 雲層（十月低垂陰霾；濃霧期壓到幾乎看不見） ──────────────
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  const CLOUD_N = mobile ? 36 : 72;
  for (let i = 0; i < CLOUD_N; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, color: 0x9aa3a0, transparent: true, opacity: 0.28 + rand() * 0.22, depthWrite: false, fog: false })
    );
    c.position.set((rand() - 0.5) * 11000, 360 + rand() * 360, (rand() - 0.5) * 11000);
    const s = 480 + rand() * 620;
    c.scale.set(s, s * 0.42, 1);
    c.userData.drift = 6 + rand() * 8;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  // ── 貼地圩田濃霧（這場的招牌）：壓在胸線以下的軟霧毯，拂曉最濃 ──
  // 刻意做兩層：低而寬的霧毯（y 1–4）＋零星較高的霧柱（y 5–9），
  // 高度都低於 3D 標籤（y ≥ 13），單位頭部露在霧上，可讀性不受影響。
  const mistTex = makeCloudTexture();
  const mist = new THREE.Group();
  const rm = mulberry(123);
  // ⚠️ 單片不透明度刻意壓得很低：這些 sprite 會互相重疊，若每片 0.3 以上，
  //    幾十片疊起來會整片飽和成一道近白色的硬帶（實測像素可到 224,224,222），
  //    看起來不是霧、是一塊白板，還會擋住單位。要的是「薄紗疊出的深度」。
  const MIST_N = mobile ? 14 : 28;
  for (let i = 0; i < MIST_N; i++) {
    const tall = i % 5 === 0;
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mistTex, color: 0xd4d8cc, transparent: true, opacity: 0, depthWrite: false })
    );
    m.position.set(-360 + rm() * 720, tall ? 4.5 + rm() * 4 : 1.0 + rm() * 2.6, -110 + rm() * 270);
    const s = tall ? 130 + rm() * 130 : 180 + rm() * 220;
    m.scale.set(s, s * (tall ? 0.32 : 0.22), 1);
    m.userData.drift = 2 + rm() * 4;
    m.userData.baseOp = (tall ? 0.085 : 0.125) + rm() * 0.06;
    mist.add(m);
  }
  scene.add(mist);

  function update(dt, battleT) {
    for (const c of clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 9000) c.position.x = -9000;
    }
    for (const m of mist.children) {
      m.position.x += m.userData.drift * dt;
      if (m.position.x > 470) m.position.x = -470;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    skyUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    ground.material.color = lerpColor(pa.ground, pb.ground, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    const sunInt = lerpNum(pa.sunInt, pb.sunInt, f);
    sun.position.y = lerpNum(pa.sunY, pb.sunY, f);   // 太陽方向隨日相變 → cascade 方向要跟著
    if (csm) syncCSM(dt, sun.color, sunInt); else sun.intensity = sunInt;
    hemi.intensity = lerpNum(pa.amb, pb.amb, f);
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);
    scene.fog.near = lerpNum(pa.fogNear, pb.fogNear, f);
    scene.fog.far = lerpNum(pa.fogFar, pb.fogFar, f);

    // P-5：太陽本體沿光源方向擺到天空圓頂內；晨昏大而橘、白晝小而白
    _sunDir.copy(sun.position).normalize().multiplyScalar(9000);
    sunDisc.position.copy(_sunDir);
    sunHalo.position.copy(_sunDir);
    const sunSize = lerpNum(pa.sunSize, pb.sunSize, f);
    const sunOp = lerpNum(pa.sunOp, pb.sunOp, f);
    sunDisc.scale.set(sunSize, sunSize, 1);
    sunHalo.scale.set(sunSize * 3.4, sunSize * 3.4, 1);
    sunDisc.material.color = lerpColor(pa.sunCol, pb.sunCol, f);
    sunHalo.material.color = lerpColor(pa.sunCol, pb.sunCol, f);
    sunDisc.material.opacity = sunOp;
    sunHalo.material.opacity = sunOp * 0.42;

    const night = a === 'night' ? 1 - f : 0; // 1=全夜,0=已天亮
    stars.material.opacity = 0.8 * night;

    // 濃霧程度：拂曉（night→dawn 區段末）最濃，進入白晝後漸散
    const dawnPeak = a === 'night' ? 0.45 + f * 0.55 : (a === 'dawn' ? 1 - f * 0.72 : 0.28);
    for (const m of mist.children) m.material.opacity = m.userData.baseOp * dawnPeak;
    // 霧越濃，天空霧帶越厚、雲越看不見（濃霧下不該看到清楚的雲團）
    skyUniforms.uHaze.value = 0.42 + dawnPeak * 0.58;
    const cloudVis = (0.45 + 0.55 * (1 - night)) * (1.05 - dawnPeak * 0.62);
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * cloudVis;

    updateEnvironment(battleT);
  }

  // 供 terrain 判斷「日出後水溝反光」強度（0=夜、1=完全天亮）
  function daylightAt(battleT) {
    const [a, b, f] = phaseAt(battleT);
    const w = (p) => (p === 'night' ? 0 : p === 'dawn' ? 0.55 : 1);
    return lerpNum(w(a), w(b), f);
  }

  // ══ HDRI 環境光（asset-pipeline-spec §3）═══════════════════
  // 桌機用 1k .hdr 過 PMREM、手機用 tonemapped JPG 同樣過 PMREM（assets.js 已分流）。
  // 兩張：kiara_1_dawn（拂曉暖低角）與 overcast_soil_puresky（霧散後的十月陰空）。
  // 天幕維持既有的程序化 sky dome（規格明寫），HDRI 只當 scene.environment 用。
  // ⚠️ scene.environment 只影響 MeshStandardMaterial（地表、建築、樹），
  //    程序化小人還是 Lambert，所以 environmentIntensity 壓得保守，免得地表比人亮一截。
  let envDawn = null, envDay = null, envCurrent = null;
  const ENV_MAX = mobile ? 0.30 : 0.42;
  async function applyAssets(assets) {
    if (!assets) return { hdri: [] };
    const got = [];
    const [dawn, day] = await Promise.all([
      // 拂曉那張是本役的招牌（低角暖光），桌機吃完整 1k .hdr
      assets.environment('kiara_1_dawn'),
      // 霧散後的十月陰空幾乎是平光，用 tonemapped JPG 就夠 —— 少載 1.1 MB，首屏預算差這一張
      assets.environment('overcast_soil_puresky', { tonemapped: true }),
    ]);
    envDawn = dawn; envDay = day;
    if (dawn) got.push('kiara_1_dawn');
    if (day) got.push('overcast_soil_puresky');
    if (envDawn || envDay) {
      scene.environment = envCurrent = envDawn ?? envDay;
      scene.environmentIntensity = 0;
    }
    return { hdri: got };
  }

  // 日相切換：不逐幀混兩張（會要兩組 PMREM），改成在霧散那一刻換圖＋淡入淡出強度
  function updateEnvironment(battleT) {
    if (!envDawn && !envDay) return;
    const d = daylightAt(battleT);
    const wantDay = d > 0.62 && envDay;
    const want = wantDay ? envDay : (envDawn ?? envDay);
    if (want !== envCurrent) { scene.environment = envCurrent = want; }
    // 夜裡幾乎不給環境光（濃霧夜本來就沒有天光），拂曉起漸強
    scene.environmentIntensity = ENV_MAX * (0.12 + 0.88 * Math.min(1, d * 1.25));
  }

  return {
    update, sun, daylightAt, applyAssets,
    updateShadows, resizeShadows,
    registerMaterial, registerObject, refreshShadowMaterials,
    csm: () => csm,
  };
}

// 中心實、外緣柔的圓（太陽本體用 stop 靠外、光暈用 stop 靠內）
function makeGlowTexture(core) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(core, 'rgba(255,246,224,0.85)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 可重現的偽隨機（雲層/星空/晨霧佈局固定）
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
