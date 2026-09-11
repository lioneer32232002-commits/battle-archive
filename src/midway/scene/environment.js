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
import * as THREE from 'three';
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

export function createEnvironment(scene, opts = {}) {
  const mobile = !!opts.mobile;

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
  const OCEAN_SEG = mobile ? 110 : 190;
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

          // 浪峰白沫:僅在高波峰稀疏出現
          float crest = smoothstep(3.4, 5.0, vH);
          float foamN = hash(floor(vWorld.xz * 0.28) + floor(uTime * 1.6));
          col = mix(col, vec3(0.92, 0.95, 0.97), crest * step(0.55, foamN) * 0.55);

          // 依距離淡出到霧色,與地平線霧帶接上
          float fogF = smoothstep(uFogRange.x, uFogRange.y, dist);
          col = mix(col, uFog, fogF);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.renderOrder = -5;
  scene.add(ocean);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2000, 2600, -1400);
  scene.add(sun);
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;
  if (opts.shadows) {
    // P-2:正交陰影框只罩戰鬥核心區(±900),每幀跟著鏡頭焦點移動(見 setShadowFocus)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -420; c.right = 420; c.top = 420; c.bottom = -420;
    c.near = 200; c.far = 5200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.8;
    c.updateProjectionMatrix();
  }
  const hemi = new THREE.HemisphereLight(0xbfd4de, 0x10456e, 0.55);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.day.fog, FOG_NEAR, FOG_FAR);

  // ── 雲(N-6) ─────────────────────────────────────────
  const clouds = createCloudField({ mobile });
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

  const _sunPos = new THREE.Vector3();
  function update(dt, battleT) {
    oceanTime.value += dt;

    const [a, b, f] = phaseAt(battleT);
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
    sun.intensity = Math.max(0.05, mixNum('sunInt'));
    hemi.intensity = mixNum('amb');
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

  return { update, setShadowFocus, sunDir, sunLight: sun };
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

function createCloudField({ mobile }) {
  const HIGH = mobile ? 26 : 52;   // 高層:小而亮
  const LOW = mobile ? 34 : 68;    // 低層:大而淡
  const BAND = mobile ? 40 : 80;   // 地平線低雲帶:扁長
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
