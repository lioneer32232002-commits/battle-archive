// 環境:天空、海面、雲層、太陽、光照 — 1945/4/7 東海午後,破碎低雲(史實:低雲掩護了美機接近)
//
// 2026-09-12 美術升級:
//   P-1 ACES 之後整組調色盤重校(舊值在 ACES 下會塌成一片死灰,sun/amb 約 +25%,
//       天空與海水提高明度並加回一點藍綠彩度,霧色跟著提亮,免得地平線變成髒灰)。
//   P-2 太陽 castShadow(桌機),正交陰影框跟著鏡頭焦點走(±700,格點對齊避免抖動)。
//   P-5 太陽本體 Sprite + 光暈 Sprite;天空 shader 也加了同方向的亮斑當「雲隙光」。
//   P-6 地平線霧帶:h < 0.09 區間混入霧色,地平線不再是一條硬邊。
//   N-1 海面 6 波(含 3 個高頻碎浪)、太陽 glitter、fresnel 天空反射、浪峰白沫、遠距霧化。
//   N-6 雲改成 InstancedBufferGeometry 批次:低層 + 高層 + 地平線雲帶合計約 170 片,
//       但只有 1 個 draw call(舊版 110 個 Sprite = 110 個 draw call)。
import * as THREE from 'three';
import { BillboardField, makeAtlas, mulberry, OCEAN_WAVE_GLSL } from './gfx.js';

// ACES 後重校:4 月東海午後陰晴,偏灰藍、雲隙透光
const PALETTES = {
  overcast: {
    // 第二輪(補上 OutputPass 之後)重校:ACES 與 sRGB 編碼現在真的會作用,
    // 第一輪為了補管線缺口而整組拉亮一階的數值全部調回來。
    top: 0x6a83a3,      // 天頂:灰藍
    horizon: 0xb9c4ce,  // 地平線:銀灰白
    sun: 0xfff3e2,      // 陽光:午後偏暖白
    sunInt: 1.15,
    amb: 0.85,
    water: 0x2f5871,    // 海水:偏藍綠
    fog: 0xaab6c2,
  },
};

// 此役全程 11:00–16:00,恆定使用同一組午後調色盤
function phaseAt() {
  return ['overcast', 'overcast', 0];
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}

// 太陽方向:4 月午後偏西(西略偏北),仰角約 34°
const SUN_DIR = new THREE.Vector3(-0.81, 0.56, -0.16).normalize();

// 六波疊加(含 3 個高頻碎浪紋);合計振幅 ≈ 6.2,仍在陸塊 LIFT=7 之下。
// 高度場與 gfx.js 的 oceanHeight() 共用同一份 GLSL,水面貼花才能精準地跟著浪走。
const WAVE_GLSL = OCEAN_WAVE_GLSL + `
  float waveSum(vec2 p) { return oceanHeight(p, uTime); }`;

export function createEnvironment(scene, { shadows = false, mobile = false } = {}) {
  // ── 天空圓頂 ───────────────────────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.overcast.top) },
    uHorizon: { value: new THREE.Color(PALETTES.overcast.horizon) },
    uFog: { value: new THREE.Color(PALETTES.overcast.fog) },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color(PALETTES.overcast.sun) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(16000, 32, 16),
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
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog;
        uniform vec3 uSunDir; uniform vec3 uSunColor;
        varying vec3 vPos;
        void main() {
          vec3 d = normalize(vPos);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          // P-6:地平線霧帶 — 最低 9° 內混入霧色,不留硬邊
          col = mix(col, uFog, smoothstep(0.09, -0.02, d.y) * 0.85);
          // P-5:雲隙光 — 太陽方向一大片柔和亮斑
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * pow(s, 9.0) * 0.15;
          col += uSunColor * pow(s, 150.0) * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // ── 海面(N-1) ─────────────────────────────────────
  const oceanUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    uWater: { value: new THREE.Color(PALETTES.overcast.water) },
    uSky: { value: new THREE.Color(PALETTES.overcast.horizon) },
    uSunColor: { value: new THREE.Color(PALETTES.overcast.sun) },
    uFog: { value: new THREE.Color(PALETTES.overcast.fog) },
    uFogNear: { value: 3200 },
    uFogFar: { value: 15000 },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000, mobile ? 140 : 220, mobile ? 140 : 220),
    new THREE.ShaderMaterial({
      uniforms: oceanUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorld; varying float vH;
        ${WAVE_GLSL}
        void main() {
          vec3 pos = position;
          vec2 p = vec2(position.x, position.y); // plane 旋轉前座標
          float h = waveSum(p);
          pos.z += h;
          vH = h;
          float e = 6.0;                          // 數值微分求法線
          float hx = waveSum(p + vec2(e, 0.0));
          float hy = waveSum(p + vec2(0.0, e));
          vNormal = normalize(vec3(-(hx - h) / e, 1.0, (hy - h) / e));
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir; uniform vec3 uWater; uniform vec3 uSky; uniform vec3 uSunColor;
        uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorld; varying float vH;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
        ${OCEAN_WAVE_GLSL}
        void main() {
          vec3 n = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          float diff = max(dot(n, uSunDir), 0.0);
          // 俯視時 fresnel 幾乎為 0,只剩底色,所以基底要夠亮,否則高機位一片死藍黑
          vec3 col = uWater * (0.72 + 0.42 * diff);

          // fresnel:近處看水色、遠處看天色(反射色壓暗一點,不然低機位時整片海會被洗白)
          float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.4);
          col = mix(col, uSky * 0.78, clamp(fres * 0.62, 0.0, 0.5));

          // 太陽 glitter:高指數 specular + 稀疏抖動的碎鑽亮點。
          // 第一版強度給太大(spec 1.15 / glint 2.4),整個西南象限直接過曝成一塊白方格。
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, halfDir), 0.0), 420.0);
          vec2 cell = floor(vWorld.xz * 0.9);   // 格子要夠小,否則近景會看到一格格的方塊亮斑
          float sparkle = step(0.82, hash(cell + floor(uTime * 2.0)));
          vec3 jn = normalize(n + vec3(hash(cell) - 0.5, 0.0, hash(cell + 7.3) - 0.5) * 0.1);
          float glint = pow(max(dot(jn, halfDir), 0.0), 1400.0) * sparkle;
          col += uSunColor * (spec * 0.28 + glint * 0.5);

          // 浪峰白沫:只在高浪峰、且稀疏出現。
          // 用平滑的低頻正弦做遮罩,不能用 hash(floor(...)) —— 那會在海面上畫出一格格方塊。
          // 浪高在片元端重算(海面網格 136 單位一格,直接用內插的 vH 會讓白沫變成一塊塊菱形)
          float hF = oceanHeight(vec2(vWorld.x, -vWorld.z), uTime);
          float n2 = 0.5 + 0.5 * sin(vWorld.x * 0.031 + uTime * 0.4) * sin(vWorld.z * 0.043 - uTime * 0.3);
          float capMask = smoothstep(5.0, 6.1, hF) * smoothstep(0.5, 0.95, n2);
          col = mix(col, vec3(0.92, 0.95, 0.97), clamp(capMask * 0.5, 0.0, 0.45));

          // 遠距離淡出到霧色,海天不會有一條硬邊
          col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.renderOrder = 0;
  scene.add(ocean);

  // ── 光照(P-2) ─────────────────────────────────────
  const SUN_DIST = 3000;
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.overcast.sunInt);
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
  scene.add(sun);
  scene.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -700; cam.right = 700; cam.top = 700; cam.bottom = -700;
    cam.near = 800; cam.far = SUN_DIST * 2.2;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.8;
  }
  const hemi = new THREE.HemisphereLight(0xc7dcea, 0x1d4c66, PALETTES.overcast.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.overcast.fog, 4200, 15000);

  // ── 太陽本體與光暈(P-5) ───────────────────────────
  const sunPos = SUN_DIR.clone().multiplyScalar(13000);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeSunTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
  }));
  sunDisc.position.copy(sunPos);
  sunDisc.scale.setScalar(260);
  sunDisc.renderOrder = -8;
  scene.add(sunDisc);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.42,
  }));
  halo.position.copy(sunPos);
  halo.scale.setScalar(2000);
  halo.renderOrder = -9;
  scene.add(halo);

  // ── 雲(N-6) ───────────────────────────────────────
  const LOW = mobile ? 28 : 56;
  const HIGH = mobile ? 22 : 46;
  const BAND = mobile ? 34 : 70;
  const total = LOW + HIGH + BAND;
  const clouds = new BillboardField(makeCloudAtlas(), total, { renderOrder: 1 });
  scene.add(clouds.mesh);

  const rand = mulberry(42);
  const cl = [];
  for (let i = 0; i < total; i++) {
    const kind = i < LOW ? 0 : i < LOW + HIGH ? 1 : 2;
    if (kind === 2) {
      // 地平線遠景雲帶:扁長、貼近海平面、圍成一圈(海戰油畫感的關鍵)
      const a = ((i - LOW - HIGH) / BAND) * Math.PI * 2 + rand() * 0.08;
      const r = 6800 + rand() * 4200;
      cl.push({
        x: Math.cos(a) * r, y: 90 + rand() * 190, z: Math.sin(a) * r,
        w: 1100 + rand() * 1500, h: 90 + rand() * 110,
        a: 0.26 + rand() * 0.2, tile: Math.floor(rand() * 3), drift: 3 + rand() * 4, rot: 0, kind,
      });
    } else if (kind === 0) {
      // 低層:雲底 620 以上。第一版放在 250–510,低機位時整片天被一團團白斑占滿
      // (就是規格要廢除的「巨大白色圓斑」),所以抬高、放淡、攤開。
      const s = 620 + rand() * 760;
      cl.push({
        x: (rand() - 0.5) * 15000, y: 620 + rand() * 340, z: (rand() - 0.5) * 15000,
        w: s, h: s * (0.3 + rand() * 0.12),
        a: 0.2 + rand() * 0.16, tile: Math.floor(rand() * 3), drift: 8 + rand() * 8,
        rot: (rand() - 0.5) * 0.16, kind,
      });
    } else {
      const s = 420 + rand() * 520;
      cl.push({
        x: (rand() - 0.5) * 17000, y: 1350 + rand() * 800, z: (rand() - 0.5) * 17000,
        w: s, h: s * (0.28 + rand() * 0.1),
        a: 0.22 + rand() * 0.16, tile: Math.floor(rand() * 3), drift: 12 + rand() * 10,
        rot: (rand() - 0.5) * 0.2, kind,
      });
    }
  }

  const sunAz = Math.atan2(SUN_DIR.x, SUN_DIR.z);

  function update(dt, battleT) {
    oceanUniforms.uTime.value += dt;

    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    skyUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    skyUniforms.uSunColor.value = lerpColor(pa.sun, pb.sun, f);
    oceanUniforms.uWater.value = lerpColor(pa.water, pb.water, f);
    oceanUniforms.uSky.value = lerpColor(pa.horizon, pb.horizon, f);
    oceanUniforms.uSunColor.value = lerpColor(pa.sun, pb.sun, f);
    oceanUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = pa.sunInt + (pb.sunInt - pa.sunInt) * f;
    hemi.intensity = pa.amb + (pb.amb - pa.amb) * f;
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);

    // 雲:沿風向漂 + 依與太陽的夾角決定亮暖程度(向陽面偏白暖、背陽面偏藍灰)
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      c.x += c.drift * dt;
      if (c.x > 17000) c.x -= 34000;
      const az = Math.atan2(c.x, c.z);
      let d = Math.abs(az - sunAz);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const lit = 1 - d / Math.PI;                     // 0 背陽 → 1 向陽
      // 陰天的雲底本來就比天空暗,給太亮會整片消失在白天空裡
      const base = c.kind === 1 ? 0.5 : 0.36;
      const k = base + lit * 0.3;
      clouds.set(i, c.x, c.y, c.z, c.w, c.h, c.rot, c.a, c.tile,
        k * 1.02, k, k * 1.02 + (1 - lit) * 0.05);
    }
    clouds.flush(cl.length);
  }

  // P-2:陰影框跟著鏡頭焦點移動(格點對齊,避免陰影邊緣抖動)
  function setShadowFocus(x, z) {
    if (!shadows) return;
    const gx = Math.round(x / 25) * 25;
    const gz = Math.round(z / 25) * 25;
    sun.target.position.set(gx, 0, gz);
    sun.position.set(gx + SUN_DIR.x * SUN_DIST, SUN_DIR.y * SUN_DIST, gz + SUN_DIR.z * SUN_DIST);
    sun.target.updateMatrixWorld();
  }

  return { update, setShadowFocus, sunDir: SUN_DIR.clone(), sunLight: sun };
}

// ── 貼圖 ──────────────────────────────────────────────
function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,252,1)');
  grad.addColorStop(0.24, 'rgba(255,247,226,0.98)');
  grad.addColorStop(0.36, 'rgba(255,231,183,0.55)');
  grad.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHaloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,244,220,0.55)');
  grad.addColorStop(0.3, 'rgba(255,238,205,0.22)');
  grad.addColorStop(1, 'rgba(240,238,230,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 三種雲的變體:每一格由 7–10 個大小不一的柔邊圓疊出來 + 輕雜訊,
// 不再是「一顆巨大白色圓斑」(舊版的主要問題)。
function makeCloudAtlas() {
  const rand = mulberry(7717);
  return makeAtlas(256, (g, tile, s) => {
    if (tile === 3) { // 備用格:單純柔邊
      const grad = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.48);
      grad.addColorStop(0, 'rgba(255,255,255,0.75)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      return;
    }
    const blobs = 7 + Math.floor(rand() * 4);
    for (let i = 0; i < blobs; i++) {
      const bx = s * (0.2 + rand() * 0.6);
      const by = s * (0.34 + rand() * 0.32);
      const br = s * (0.1 + rand() * 0.17);
      const grad = g.createRadialGradient(bx, by - br * 0.25, br * 0.05, bx, by, br);
      const top = 1 - (by / s - 0.3);                   // 上緣亮、下腹暗
      const v = Math.round(215 + top * 40);
      grad.addColorStop(0, 'rgba(255,255,255,' + (0.5 + rand() * 0.32).toFixed(3) + ')');
      grad.addColorStop(0.55, 'rgba(' + v + ',' + v + ',' + v + ',0.3)');
      grad.addColorStop(1, 'rgba(200,206,214,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(bx, by, br * (1 + rand() * 0.5), br * (0.6 + rand() * 0.3), rand() * 3.14, 0, Math.PI * 2);
      g.fill();
    }
    // 輕雜訊:打散完美的圓弧邊
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) {
      const px = rand() * s, py = rand() * s;
      const pr = s * (0.01 + rand() * 0.05);
      const grad = g.createRadialGradient(px, py, 0, px, py, pr);
      grad.addColorStop(0, 'rgba(0,0,0,' + (0.1 + rand() * 0.25).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    g.globalCompositeOperation = 'source-over';
  });
}
