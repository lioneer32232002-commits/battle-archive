// 環境:天空、海面、雲層、太陽、光照 — 依戰役時刻變化(黎明→白晝→黃昏→夜)
//
// 美術升級(docs/art-upgrade-spec.md):
//   P-1 調色盤已依 ACES 色調映射重校(sun／amb 約 +25%,天空、霧色、水色重調到不死暗不過曝)
//   P-5 天空圓頂上放太陽本體 Sprite ＋ 光暈 Sprite,晨昏放大變橘、白晝縮小變白、夜間隱藏
//   P-6 地平線再疊一層薄霧帶,地平線不再是一條硬線
//   N-1 海面 6 波疊加、太陽 glitter 光路、fresnel 天空反射、遠距霧化、浪峰白沫
//   N-5 太陽方位／仰角隨相位移動,glitter 沿太陽方向拉出光路
//   N-6 廢除巨大白圓斑:3 種柔邊團塊貼圖變體、120 朵雲分兩層 ＋ 80 朵地平線低雲帶,
//       全部合併成「一個 InstancedBufferGeometry ＋ 自寫 billboard shader」= 1 個 draw call
//
// 資產管線(docs/asset-pipeline-spec.md §3):
//   A-1 HDRI 環境光 — 桌機 PMREM(1k .hdr)、手機 tonemapped JPG,依日相在
//       黎明／白晝／黃昏／夜 4 張之間切換,切換時以 environmentIntensity crossfade。
//       天幕仍是既有的程序化 sky dome ＋ 雲(HDRI 只當光源與反射,不當背景)。
//       只在「進入該日相時」才下載對應 HDRI,首屏不扛 4 張 1.4 MB。
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
import { WAVE_GLSL, oceanTime, oceanCell } from './ocean-waves.js';

// sunAz:自北(-z)順時針的方位角(弧度);sunElev:仰角(弧度,負值=沒入海平面)
const PALETTES = {
  // 黎明:橘紅低日壓在海平面上,天頂仍是夜藍。暖色靠 skyGlow 集中在太陽那一側,不是整圈天空都橘。
  dawn: {
    top: 0x1c3260, horizon: 0xc4785c, sun: 0xffb478, sunInt: 0.85, amb: 0.40,
    water: 0x14364f, fog: 0x7f7885, cloudLit: 0xe8ab86, cloudDark: 0x4e4658,
    sunAz: 1.10, sunElev: 0.10, sunSize: 1.9, glitter: 1.35, skyGlow: 1.10,
  },
  // 白晝:亮藍海、白積雲
  day: {
    top: 0x2f6fbe, horizon: 0xb2d0e4, sun: 0xfff7e8, sunInt: 1.15, amb: 0.55,
    water: 0x0e5580, fog: 0x9bbcd1, cloudLit: 0xf2f7fb, cloudDark: 0x87a0b3,
    sunAz: 2.60, sunElev: 1.12, sunSize: 0.8, glitter: 1.0, skyGlow: 0.35,
  },
  // 黃昏:金橘光路
  dusk: {
    top: 0x281f52, horizon: 0xbf6a3e, sun: 0xffa85e, sunInt: 0.75, amb: 0.34,
    water: 0x122b42, fog: 0x8a6c60, cloudLit: 0xe89468, cloudDark: 0x453750,
    sunAz: 4.95, sunElev: 0.09, sunSize: 2.0, glitter: 1.45, skyGlow: 1.20,
  },
  // 夜:星空前的深藍,月光般的冷光
  night: {
    top: 0x070e22, horizon: 0x1f2c48, sun: 0xa3badc, sunInt: 0.34, amb: 0.32,
    water: 0x0c2338, fog: 0x162031, cloudLit: 0x55647c, cloudDark: 0x1f273b,
    sunAz: 5.60, sunElev: -0.18, sunSize: 1.0, glitter: 0.35, skyGlow: 0.15,
  },
};

// 戰役時刻 → 日相(0 dawn, 1 day, 2 dusk, 3 night),回傳兩調色盤與混合比
function phaseAt(t) {
  if (t < 1170) {
    if (t < 300) return ['dawn', 'dawn', 0];
    if (t < 420) return ['dawn', 'day', (t - 300) / 120];
    if (t < 960) return ['day', 'day', 0];
    if (t < 1080) return ['day', 'dusk', (t - 960) / 120];
    return ['dusk', 'night', Math.min(1, (t - 1080) / 80)];
  }
  return ['day', 'day', 0]; // 尾聲(6/5–6/7)以白晝呈現
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}

const SKY_R = 16000;
const FOG_NEAR = 4500;
const FOG_FAR = 14000;

// A-1:各日相的 HDRI 強度(moonless_golf 本身極暗,夜間略拉高才看得出金屬反射)
const ENV_INTENSITY = { dawn: 0.85, day: 1.0, dusk: 0.8, night: 0.55 };
const ENV_FADE = 2.2; // 每秒的 intensity 變化量(切換時先淡出再淡入)

// 日相主導者:混合比 < 0.5 算前一相,否則算後一相
function dominantPhase(a, b, f) {
  return f < 0.5 ? a : b;
}

export function createEnvironment(scene, opts = {}) {
  const shadows = !!opts.shadows;        // R4-2
  const camera = opts.camera ?? null;    // R4-2:CSM 的 cascade 框跟著鏡頭視錐走
  const mobile = !!opts.mobile;
  const assets = opts.assets ?? null;
  // R5:畫質分級參數(海面細分、雲數、CSM 層數／解析度)。沒傳就用最高級的預設值,
  // 這個模組本身不去讀 localStorage/?q=,只吃參數(§R5.3)。
  const q = {
    oceanSegments: mobile ? 110 : 190,
    cloudScale: 1,
    csm: true,
    cascades: 3,
    shadowMapSize: 2048,
    shadowMaxFar: 3500,
    ...(opts.quality ?? {}),
  };

  // ── 天空圓頂(P-6:地平線霧帶) ─────────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.day.top) },
    uHorizon: { value: new THREE.Color(PALETTES.day.horizon) },
    uFog: { value: new THREE.Color(PALETTES.day.fog) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.3).normalize() },
    uSunCol: { value: new THREE.Color(PALETTES.day.sun) },
    uGlow: { value: 1.0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_R, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog;
        uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow;
        varying vec3 vPos;
        void main() {
          vec3 d = normalize(vPos);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.42));
          // N-5:暖色集中在太陽那一側,不是整圈天空都橘
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunCol * uGlow * (pow(sd, 5.0) * 0.55 + pow(sd, 1.6) * 0.10);
          // P-6:地平線薄霧帶 — h < 0.09 逐漸混入霧色,地平線不是硬線
          float band = 1.0 - smoothstep(0.0, 0.09, h);
          col = mix(col, uFog, band * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  sky.userData.noAO = true;   // R4-1:天空圓頂不進 GTAO 的 G-buffer(見 postfx.js 註)
  scene.add(sky);

  // ── 太陽本體與光暈(P-5 / N-5) ───────────────────────
  const sunDir = new THREE.Vector3(0.4, 0.5, -0.3).normalize();
  const sunCore = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSunTexture(0.30, 0.62),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    })
  );
  sunCore.renderOrder = -9;
  scene.add(sunCore);
  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSunTexture(0.02, 1.0),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    })
  );
  sunHalo.renderOrder = -9;
  scene.add(sunHalo);

  // ── 海面(N-1);波形與 wake.js 共用 ocean-waves.js 的 WAVE_GLSL
  const oceanUniforms = {
    uTime: oceanTime,
    uSunDir: { value: sunDir },
    uWater: { value: new THREE.Color(PALETTES.day.water) },
    uSky: { value: new THREE.Color(PALETTES.day.horizon) },
    uTopSky: { value: new THREE.Color(PALETTES.day.top) },
    uSunColor: { value: new THREE.Color(PALETTES.day.sun) },
    uFog: { value: new THREE.Color(PALETTES.day.fog) },
    uGlitter: { value: 1.0 },
    uFogRange: { value: new THREE.Vector2(FOG_NEAR * 1.4, FOG_FAR * 1.15) },
  };
  const OCEAN_SEG = Math.max(40, Math.round(q.oceanSegments));
  oceanCell.value = 30000 / OCEAN_SEG; // 尾流要靠這個值對齊實際算繪出的海面
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000, OCEAN_SEG, OCEAN_SEG),
    new THREE.ShaderMaterial({
      uniforms: oceanUniforms,
      fog: false,
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorld; varying float vH;
        ${WAVE_GLSL}
        void main() {
          vec3 pos = position;
          vec2 p = vec2(position.x, position.y); // plane 旋轉前座標
          float h = waveSum(p, uTime);
          pos.z += h;
          vH = h;
          float e = 6.0;                          // 數值微分求法線(同一組波)
          float hx = waveSum(p + vec2(e, 0.0), uTime);
          float hy = waveSum(p + vec2(0.0, e), uTime);
          vNormal = normalize(vec3(-(hx - h) / e, 1.0, (hy - h) / e));
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir; uniform vec3 uWater; uniform vec3 uSky; uniform vec3 uTopSky;
        uniform vec3 uSunColor; uniform vec3 uFog; uniform float uGlitter; uniform vec2 uFogRange;
        uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorld; varying float vH;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // 浪峰白沫的遮罩用「雙線性內插的 value noise」而不是 hash(floor(p)):
        // ⚠ 直接 hash(floor(p)) 每格是常數,白沫會變成一片邊緣筆直的棋盤格方塊 —— 白晝
        //   水色亮看不太出來,黎明／黃昏水色一暗就整片穿幫(2026-09-13 黎明驗收截圖)。
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        // 細碎漣漪:只擾動法線,不動高度(動高度會讓環礁與尾流對不上)
        vec2 ripple(vec2 p, float t) {
          vec2 r = vec2(0.0);
          r += vec2(cos(p.x * 0.070 + t * 1.5), cos(p.y * 0.063 - t * 1.3)) * 0.110;
          r += vec2(cos(p.y * 0.155 - t * 2.1), cos(p.x * 0.141 + t * 2.4)) * 0.070;
          r += vec2(cos(p.x * 0.400 + t * 3.3), cos(p.y * 0.360 + t * 3.0)) * 0.038;
          r += vec2(cos(p.y * 0.910 - t * 4.4), cos(p.x * 0.870 + t * 4.9)) * 0.018;
          return r;
        }
        void main() {
          vec3 n = normalize(vNormal);
          float dist = length(cameraPosition - vWorld);
          // 近處才加細節(遠處加會變成雜訊閃爍)
          float near = 1.0 - smoothstep(260.0, 5200.0, dist);
          if (near > 0.001) {
            vec2 r = ripple(vWorld.xz, uTime) * near;
            n = normalize(n + vec3(r.x, 0.0, r.y));
          }
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float diff = max(dot(n, uSunDir), 0.0);

          // 基礎水色:近處為水色,遠處往天色靠(fresnel + 距離)
          float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
          float distSky = smoothstep(1200.0, 11000.0, dist);
          vec3 skyRefl = mix(uSky, uTopSky, 0.45);
          vec3 col = uWater * (0.55 + 0.45 * diff);
          col = mix(col, skyRefl, clamp(fres * 0.34 + distSky * 0.22, 0.0, 0.60));

          // 太陽 glitter:高指數 specular ＋ 沿太陽方向的稀疏亮點(光路)
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, halfDir), 0.0), 260.0);
          float broad = pow(max(dot(n, halfDir), 0.0), 26.0);
          vec2 cell = vWorld.xz * 1.6;
          float sparkle = smoothstep(0.80, 0.97, hash(floor(cell) + floor(uTime * 3.0)));
          col += uSunColor * uGlitter * (spec * 1.1 + broad * 0.17 + sparkle * broad * 0.7);

          // 浪峰白沫:僅在高波峰稀疏出現(遮罩用 value noise,邊緣才不是直角)
          float crest = smoothstep(3.4, 5.0, vH);
          float foamN = vnoise(vWorld.xz * 0.28 + floor(uTime * 1.6));
          col = mix(col, vec3(0.92, 0.95, 0.97), crest * smoothstep(0.46, 0.78, foamN) * 0.55);

          // 依距離淡出到霧色,與地平線霧帶接上
          float fogF = smoothstep(uFogRange.x, uFogRange.y, dist);
          col = mix(col, uFog, fogF);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.renderOrder = -5;
  ocean.userData.noAO = true;   // R4-1:海面波形是 vertex shader 做的,override 材質畫出來會對不上
  scene.add(ocean);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2000, 2600, -1400);
  scene.add(sun);
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

  // ── R4-2:階層式陰影(桌機) ─────────────────────────────
  // sun 本身在開 CSM 時不發光也不投影(intensity 0),只當「日照方向」的單一真源;
  // 光與影由 CSM 的三盞 cascade 燈負責。刻意留在 scene 裡而不移除:three 會把
  // castShadow 的燈排在前面,一盞 intensity 0 的非投影平行光排在後面,對 cascade
  // 索引與亮度都沒有影響。
  // R5:low 級把 csm 關掉,退回下面的單張正交陰影(legacy 路徑)
  const useCSM = shadows && !!camera && q.csm !== false;
  const _lightDir = new THREE.Vector3();
  let csm = null;
  if (useCSM) {
    _lightDir.copy(sun.position).sub(sun.target.position).normalize().negate();
    csm = new CSM({
      parent: scene,
      camera,
      cascades: Math.max(1, Math.round(q.cascades)),
      maxFar: q.shadowMaxFar,
      mode: 'practical',
      shadowMapSize: q.shadowMapSize,
      shadowBias: -0.0006,
      lightDirection: _lightDir.clone(),
      lightIntensity: 1.6,
      lightNear: 1,
      lightFar: 12000,
      lightMargin: 1200,
    });
    for (const l of csm.lights) {
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.8;
    }
    sun.intensity = 0;
    sun.castShadow = false;
  } else if (shadows) {
    // 後備:沒有傳 camera 進來就退回原本的單張正交陰影(手機不會走到這裡)
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const c = sun.shadow.camera;
    c.left = -420; c.right = 420; c.top = 420; c.bottom = -420;
    c.near = 200; c.far = 5200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.8;
    c.updateProjectionMatrix();
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

  const hemi = new THREE.HemisphereLight(0xbfd4de, 0x10456e, 0.55);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.day.fog, FOG_NEAR, FOG_FAR);

  // ── 雲(N-6) ─────────────────────────────────────────
  const clouds = createCloudField({ mobile, scale: q.cloudScale });
  clouds.mesh.userData.noAO = true;   // R4-1:instanced billboard,override 材質畫出來是垃圾
  scene.add(clouds.mesh);

  // 陰影框跟隨鏡頭焦點:太陽方向不變,只平移光源與 target(以 60 單位對齊避免陰影抖動)
  const _focus = new THREE.Vector3();
  function setShadowFocus(v) {
    if (!opts.shadows) return;
    _focus.set(Math.round(v.x / 24) * 24, 0, Math.round(v.z / 24) * 24);
    sunTarget.position.copy(_focus);
    sun.position.copy(_focus).addScaledVector(sunDir, 3000);
    sunTarget.updateMatrixWorld();
  }

  // ── A-1:HDRI 環境光(非阻塞;沒到就維持現況,到了再 crossfade) ──
  const envTex = new Map();   // phase -> Texture
  let envPhase = null;        // 目前掛在 scene.environment 上的日相
  let envWant = null;         // 想切到的日相
  let envLevel = 0;           // 目前 environmentIntensity(0 = 尚未有任何 HDRI)
  scene.environmentIntensity = 0;

  function requestEnv(phase) {
    if (!assets || envTex.has(phase)) return;
    envTex.set(phase, null); // 佔位,避免重複請求
    assets.env(phase).then((t) => {
      if (t) envTex.set(phase, t);
    });
  }

  function updateEnv(dt, phase) {
    if (!assets) return;
    envWant = phase;
    requestEnv(phase);
    const ready = envTex.get(phase);
    const target = ENV_INTENSITY[phase] ?? 1;
    if (envPhase === phase) {
      // 同一相:直接逼近目標強度
      envLevel += THREE.MathUtils.clamp(target - envLevel, -ENV_FADE * dt, ENV_FADE * dt);
    } else if (ready) {
      // 換相:先把現有的淡到 0,再換貼圖淡回去
      if (envPhase && envLevel > 0.02) {
        envLevel = Math.max(0, envLevel - ENV_FADE * dt);
      } else {
        scene.environment = ready;
        envPhase = phase;
        envLevel = Math.max(envLevel, 0.001);
      }
    }
    scene.environmentIntensity = envLevel;
  }

  const _sunPos = new THREE.Vector3();
  function update(dt, battleT) {
    oceanTime.value += dt;

    const [a, b, f] = phaseAt(battleT);
    updateEnv(dt, dominantPhase(a, b, f));
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    const mixNum = (k) => pa[k] + (pb[k] - pa[k]) * f;

    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    skyUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    skyUniforms.uGlow.value = mixNum('skyGlow');
    oceanUniforms.uWater.value = lerpColor(pa.water, pb.water, f);
    oceanUniforms.uSky.value = lerpColor(pa.horizon, pb.horizon, f);
    oceanUniforms.uTopSky.value = lerpColor(pa.top, pb.top, f);
    oceanUniforms.uSunColor.value = lerpColor(pa.sun, pb.sun, f);
    oceanUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    oceanUniforms.uGlitter.value = mixNum('glitter');

    // 太陽方位/仰角
    const az = mixNum('sunAz');
    const el = mixNum('sunElev');
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    // 光源方向(陰影框未啟用時仍需一個合理的位置)
    if (!opts.shadows) sun.position.copy(sunDir).multiplyScalar(3000);

    const sunCol = lerpColor(pa.sun, pb.sun, f);
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uSunCol.value = sunCol;
    sun.color = sunCol;
    const sunInt = Math.max(0.05, mixNum('sunInt'));
    // R4-2:太陽方向隨日相變(sunDir 上面剛算過)→ cascade 燈方向／顏色／強度同步
    if (csm) syncCSM(dt, sun.color, sunInt); else sun.intensity = sunInt;
    // HDRI 進來之後半球光要退讓,否則環境光疊兩份會整體過曝、失去方向感
    hemi.intensity = mixNum('amb') * (1 - 0.45 * Math.min(1, envLevel));
    hemi.color = lerpColor(pa.horizon, pb.horizon, f);
    hemi.groundColor = lerpColor(pa.water, pb.water, f);
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);

    // 太陽本體:貼在天空圓頂內側,晨昏放大變橘、白晝縮小變白、沒入海平面後隱藏
    _sunPos.copy(sunDir).multiplyScalar(SKY_R * 0.82);
    const size = mixNum('sunSize');
    const above = THREE.MathUtils.clamp((el + 0.16) / 0.22, 0, 1); // 仰角 -0.16 以下完全隱藏
    sunCore.position.copy(_sunPos);
    sunCore.scale.setScalar(760 * size);
    sunCore.material.color = sunCol;
    sunCore.material.opacity = above;
    sunCore.visible = above > 0.01;
    sunHalo.position.copy(_sunPos);
    sunHalo.scale.setScalar(2600 * size);
    sunHalo.material.color = sunCol;
    sunHalo.material.opacity = above * 0.34;
    sunHalo.visible = sunCore.visible;

    clouds.update(dt, lerpColor(pa.cloudLit, pb.cloudLit, f), lerpColor(pa.cloudDark, pb.cloudDark, f));
  }

  return {
    update,
    setShadowFocus,
    sunDir,
    sunLight: sun,
    updateShadows, resizeShadows,
    registerMaterial, registerObject, refreshShadowMaterials,
    csm: () => csm,
    // 驗收用:目前掛上的 HDRI 日相與強度
    envInfo: () => ({ phase: envPhase, want: envWant, level: envLevel }),
    // R5 驗收用:這一次建出來的陰影／幾何規格
    shadowInfo: () => ({ csm: !!csm, cascades: csm ? csm.cascades : 0, mapSize: q.shadowMapSize, oceanSeg: OCEAN_SEG }),
  };
}

// ── 太陽貼圖:核心實心 + 柔邊 ─────────────────────────
function makeSunTexture(coreStop, edgeStop) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(coreStop, 'rgba(255,244,220,0.92)');
  grad.addColorStop(edgeStop, 'rgba(255,200,140,0.18)');
  grad.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── N-6 雲場 ─────────────────────────────────────────
// 3 種變體畫在一張 2×2 atlas(第 4 格留給扁長低雲帶)。全部雲以
// InstancedBufferGeometry ＋ 自寫 billboard 頂點著色器繪製 → 整個天空只花 1 個 draw call。
function makeCloudAtlas() {
  const S = 256; // 每格
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S * 2, S * 2);
  const rand = mulberry(1337);

  const blob = (ox, oy, count, spreadX, spreadY, rBase, flat) => {
    for (let i = 0; i < count; i++) {
      const x = ox + S * 0.5 + (rand() - 0.5) * S * spreadX;
      const y = oy + S * 0.52 + (rand() - 0.5) * S * spreadY;
      const r = S * rBase * (0.55 + rand() * 0.85);
      const grad = g.createRadialGradient(x, y - r * 0.12, r * 0.05, x, y, r);
      const a = 0.34 + rand() * 0.30;
      grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      grad.addColorStop(0.5, `rgba(252,253,255,${(a * 0.55).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(250,252,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, r, r * (flat ? 0.42 : 0.78), 0, 0, Math.PI * 2);
      g.fill();
    }
  };
  // 三種積雲變體
  blob(0, 0, 9, 0.62, 0.30, 0.19, false);
  blob(S, 0, 7, 0.70, 0.24, 0.22, false);
  blob(0, S, 10, 0.58, 0.34, 0.16, false);
  // 第四格:扁長低雲帶
  blob(S, S, 8, 0.78, 0.14, 0.20, true);

  // 輕雜訊:打破圓斑的完美漸層
  const img = g.getImageData(0, 0, S * 2, S * 2);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 4) continue;
    const n = (rand() - 0.5) * 42;
    d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + n));
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function createCloudField({ mobile, scale = 1 }) {
  // R5:scale 是「雲 sprite 數」的分級係數(high 1 / medium 0.6 / low 0.4)。
  // 佈局用的亂數序列固定,抽稀只是把每一層的張數按比例縮小,雲的分佈樣貌不變。
  const k = (n) => Math.max(6, Math.round(n * scale));
  const HIGH = k(mobile ? 26 : 52);   // 高層:小而亮
  const LOW = k(mobile ? 34 : 68);    // 低層:大而淡
  const BAND = k(mobile ? 40 : 80);   // 地平線低雲帶:扁長
  const N = HIGH + LOW + BAND;

  const rand = mulberry(42);
  const center = new Float32Array(N * 3);
  const size = new Float32Array(N * 2);
  const uvOff = new Float32Array(N * 2);
  const alpha = new Float32Array(N);
  const litF = new Float32Array(N);
  const drift = new Float32Array(N);

  const put = (i, x, y, z, w, h, op, lit, dr, cell) => {
    center[i * 3] = x; center[i * 3 + 1] = y; center[i * 3 + 2] = z;
    size[i * 2] = w; size[i * 2 + 1] = h;
    uvOff[i * 2] = (cell % 2) * 0.5; uvOff[i * 2 + 1] = (cell < 2 ? 1 : 0) * 0.5;
    alpha[i] = op; litF[i] = lit; drift[i] = dr;
  };

  let i = 0;
  // 低層:大而淡(6/4 東北海域雲帶曾掩護美軍俯衝轟炸機 → 西北側較密)
  for (let k = 0; k < LOW; k++, i++) {
    const cluster = k < LOW * 0.42;
    const x = cluster ? -900 + (rand() - 0.5) * 3000 : (rand() - 0.5) * 15000;
    const z = cluster ? -1300 + (rand() - 0.5) * 2600 : (rand() - 0.5) * 15000;
    const w = 700 + rand() * 900;
    put(i, x, 460 + rand() * 260, z, w, w * (0.30 + rand() * 0.14),
      0.20 + rand() * 0.18, 0.25 + rand() * 0.3, 5 + rand() * 6, Math.floor(rand() * 3));
  }
  // 高層:小而亮
  for (let k = 0; k < HIGH; k++, i++) {
    const w = 380 + rand() * 520;
    put(i, (rand() - 0.5) * 16000, 1250 + rand() * 900, (rand() - 0.5) * 16000,
      w, w * (0.24 + rand() * 0.12),
      0.22 + rand() * 0.20, 0.75 + rand() * 0.25, 9 + rand() * 9, Math.floor(rand() * 3));
  }
  // 地平線低雲帶:遠、扁、長(海戰油畫感的關鍵)
  for (let k = 0; k < BAND; k++, i++) {
    const ang = rand() * Math.PI * 2;
    const rad = 9000 + rand() * 4500;
    const w = 1700 + rand() * 2300;
    put(i, Math.sin(ang) * rad, 150 + rand() * 210, Math.cos(ang) * rad,
      w, w * (0.075 + rand() * 0.055),
      0.20 + rand() * 0.18, 0.30 + rand() * 0.35, 3 + rand() * 4, 3);
  }

  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = N;
  geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.setAttribute('iUv', new THREE.InstancedBufferAttribute(uvOff, 2));
  geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
  geo.setAttribute('iLit', new THREE.InstancedBufferAttribute(litF, 1));
  geo.setAttribute('iDrift', new THREE.InstancedBufferAttribute(drift, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 800, 0), 20000);

  const uniforms = {
    uMap: { value: makeCloudAtlas() },
    uTime: { value: 0 },
    uLit: { value: new THREE.Color(0xffffff) },
    uDark: { value: new THREE.Color(0xa8bccb) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec3 iCenter; attribute vec2 iSize; attribute vec2 iUv;
      attribute float iAlpha; attribute float iLit; attribute float iDrift;
      uniform float uTime;
      varying vec2 vUv; varying float vAlpha; varying float vLit;
      void main() {
        // 沿風向(+x)慢慢漂,出界環繞
        float x = mod(iCenter.x + uTime * iDrift + 17000.0, 34000.0) - 17000.0;
        vec3 c = vec3(x, iCenter.y, iCenter.z);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = c + camRight * position.x * iSize.x + camUp * position.y * iSize.y;
        vUv = uv * 0.5 + iUv;
        vAlpha = iAlpha; vLit = iLit;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uLit; uniform vec3 uDark;
      varying vec2 vUv; varying float vAlpha; varying float vLit;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uDark, uLit, vLit) * t.rgb, a);
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -6;

  return {
    mesh,
    update(dt, lit, dark) {
      uniforms.uTime.value += dt;
      uniforms.uLit.value = lit;
      uniforms.uDark.value = dark;
    },
  };
}

// 可重現的偽隨機(雲層佈局固定)
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
