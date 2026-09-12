// 環境：天空、地面、晨霧、雲層、太陽本體、光照 — 諾曼第 1944 年 6 月 12–13 日。
// 情緒主軸：6/12 清晨低斜金光打在市鎮屋牆上（街戰）→ 上午轉亮 → 6/13 拂曉前的藍調微光
//   → 6/13 正午白亮多煙塵（血腥溝）→ 午後西斜（雪曼解圍）。
//
// P-1 升級：renderer 端已開 ACES 色調映射（見 main.js）。ACES 會壓暗中間調、拉高對比，
//   本調色盤已據此把 sunInt／amb 較原值提高約 20–30%，天空、霧色、地色一併重校，
//   避免「死暗」（陰影處全黑）或「過曝」（天空與灰泥牆糊成一片白）。
// P-2：太陽 castShadow，正交範圍只罩市鎮＋西南圩田的戰鬥核心區。
// P-5：沿 sun 方向在天幕上放太陽本體 Sprite ＋ 更大更淡的光暈；低仰角時放大轉橘。
// P-6：sky shader 地平線再混一層薄霧帶，地平線不是一條硬線。
import * as THREE from 'three';

// 日相調色盤（皆已為 ACES 補償後的值）
// dir = 太陽方向單位向量（x 東、y 上、z 南）；lowSun 用於太陽本體放大轉橘與地平霧帶加厚。
const PALETTES = {
  dawn: {   // 6/12 05:50 日出後不久：低斜金光、薄晨霧貼地
    top: 0x5c7a9b, horizon: 0xd8b789, sun: 0xffdca4, sunInt: 2.30, amb: 0.92,
    ground: 0x4d6231, fog: 0xc6bb99, fogNear: 240, fogFar: 3000,
    dir: [0.918, 0.300, -0.260], sunSize: 1.45, sunCol: 0xffcf86, haze: 1.0, env: 0.34, hdri: 'sunrise',
    hemiSky: 0xdbcdb2, hemiGnd: 0x60663e,
  },
  morning: { // 6/12 07:00–07:50：市鎮肅清，晨光轉白、影子仍長
    top: 0x5387bd, horizon: 0xc6d1c4, sun: 0xffefd2, sunInt: 2.10, amb: 1.00,
    ground: 0x566c36, fog: 0xbcc7b2, fogNear: 320, fogFar: 4200,
    dir: [0.760, 0.560, -0.330], sunSize: 1.0, sunCol: 0xffe9bd, haze: 0.62, env: 0.46, hdri: 'sunrise',
    hemiSky: 0xcdd4cd, hemiGnd: 0x606c3e,
  },
  twilight: { // 6/13 04:20 前的藍調微光：德軍在西南集結（不做全黑夜，避免死暗）
    top: 0x16233a, horizon: 0x3d4a5c, sun: 0x88a0c2, sunInt: 0.58, amb: 0.62,
    ground: 0x222c1f, fog: 0x1e2938, fogNear: 180, fogFar: 2200,
    dir: [0.880, 0.040, -0.470], sunSize: 0.0, sunCol: 0x9fb0cc, haze: 1.0, env: 0.10, hdri: 'sunrise',
    hemiSky: 0x35425c, hemiGnd: 0x252d22,
  },
  daybreak: { // 6/13 06:00 拂曉反撲：低日再起、圩田水氣重
    top: 0x62819c, horizon: 0xd2bb92, sun: 0xffdfae, sunInt: 2.15, amb: 0.92,
    ground: 0x4a5f2e, fog: 0xc0b89c, fogNear: 230, fogFar: 2900,
    dir: [0.898, 0.290, -0.332], sunSize: 1.4, sunCol: 0xffcf90, haze: 1.0, env: 0.34, hdri: 'sunrise',
    hemiSky: 0xd6c9ae, hemiGnd: 0x5c6440,
  },
  noon: {   // 6/13 正午：白亮、短硬影、煙塵多（血腥溝）
    top: 0x3b78bd, horizon: 0xc9d5d2, sun: 0xfff8ea, sunInt: 1.88, amb: 1.06,
    ground: 0x5e7539, fog: 0xbcc7bc, fogNear: 400, fogFar: 5400,
    dir: [0.230, 0.945, 0.232], sunSize: 0.7, sunCol: 0xfff4dd, haze: 0.45, env: 0.62, hdri: 'day',
    hemiSky: 0xc4d6e4, hemiGnd: 0x667340,
  },
  afternoon: { // 6/13 16:30 解圍後：西斜暖光、揚塵未散
    top: 0x4a80b4, horizon: 0xd5c7a6, sun: 0xffe8c4, sunInt: 2.00, amb: 1.00,
    ground: 0x596e35, fog: 0xc2bba4, fogNear: 360, fogFar: 4800,
    dir: [-0.560, 0.640, 0.526], sunSize: 1.05, sunCol: 0xffd9a0, haze: 0.7, env: 0.46, hdri: 'day',
    hemiSky: 0xd8ccb0, hemiGnd: 0x64723e,
  },
};

// 日相關鍵格（t 對齊 battle.js 事件；相鄰關鍵格之間線性混合）
const KEYS = [
  { t: 340, p: 'dawn' },      // 6/12 05:50 突入前
  { t: 400, p: 'dawn' },      // 6/12 06:10 Y 形路口 MG42 封街（晨光斜射屋牆）
  { t: 452, p: 'morning' },   // 6/12 07:30 市鎮陷落
  { t: 476, p: 'morning' },
  { t: 505, p: 'twilight' },  // 入夜／6/13 04:40 反撲集結
  { t: 545, p: 'twilight' },
  { t: 578, p: 'daybreak' },  // 6/13 拂曉血腥溝
  { t: 612, p: 'noon' },      // 6/13 正午死守
  { t: 668, p: 'noon' },
  { t: 700, p: 'afternoon' }, // 6/13 16:30 解圍
];

function phaseAt(t) {
  if (t <= KEYS[0].t) return [KEYS[0].p, KEYS[0].p, 0];
  const last = KEYS[KEYS.length - 1];
  if (t >= last.t) return [last.p, last.p, 0];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return [a.p, b.p, f];
    }
  }
  return [last.p, last.p, 0];
}

function lerpColor(a, b, f) { return new THREE.Color(a).lerp(new THREE.Color(b), f); }
function lerpNum(a, b, f) { return a + (b - a) * f; }

export function createEnvironment(scene, { shadows = false, mobile = false } = {}) {
  const P0 = PALETTES.dawn;

  // ── 天空圓頂（P-6：地平線再疊一層薄霧帶） ───────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(P0.top) },
    uHorizon: { value: new THREE.Color(P0.horizon) },
    uFog: { value: new THREE.Color(P0.fog) },
    uHaze: { value: P0.haze },
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
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; uniform float uHaze;
        varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          // P-6：h < 0.08 的窄帶混入霧色，讓地平線化開、不是一條硬線
          float band = smoothstep(0.085, 0.0, h) * uHaze;
          col = mix(col, uFog, band * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // ── 星空（藍調微光時段的天幕；天亮淡出） ────────────────────
  const starGeo = new THREE.BufferGeometry();
  const starN = mobile ? 380 : 700;
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
    new THREE.PointsMaterial({ color: 0xcdd6e8, size: 30, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })
  );
  scene.add(stars);

  // ── 遠景地面（terrain.js 的程序化地表疊在上面；此層只填地平線外） ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshLambertMaterial({ color: P0.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  if (shadows) ground.receiveShadow = true;
  scene.add(ground);

  // ── 光照 ─────────────────────────────────────────────
  const SUN_DIST = 2600;
  const sun = new THREE.DirectionalLight(0xffffff, P0.sunInt);
  sun.position.set(P0.dir[0] * SUN_DIST, P0.dir[1] * SUN_DIST, P0.dir[2] * SUN_DIST);
  scene.add(sun);
  // P-2：陰影只罩「市鎮＋西南圩田」的戰鬥核心區（範圍越緊越銳利）
  sun.target.position.set(-40, 0, 20);
  scene.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -320; cam.right = 320; cam.top = 320; cam.bottom = -320;
    cam.near = 400; cam.far = 5200;
    sun.shadow.bias = -0.0004;
    // 本場 1 單位 = 10 公尺、小兵僅約 2 單位高：normalBias 沿用巴斯通的 0.8 會把接地影整個推掉，
    // 2048 map 罩 640 單位 → 每 texel 0.31 單位，取 0.15（約半個 texel）剛好去掉痤瘡又留得住影子。
    sun.shadow.normalBias = 0.15;
    // ⚠️ 改了正交範圍／near／far 之後一定要 updateProjectionMatrix()：
    //    three 的 LightShadow.updateMatrices() 只更新位置與朝向，不會重算投影矩陣，
    //    少這一行的話陰影相機仍是預設的 ±5、far 500，光源在 2600 外 → 整場完全沒有影子。
    sun.shadow.camera.updateProjectionMatrix();
  }
  const hemi = new THREE.HemisphereLight(P0.hemiSky, P0.hemiGnd, P0.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(P0.fog, P0.fogNear, P0.fogFar);

  // ── P-5：太陽本體＋光暈（Additive Sprite，貼在天幕內側） ──────
  const discTex = makeDiscTexture(0.35);
  const haloTex = makeDiscTexture(0.02);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTex, color: P0.sunCol, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0,   // depthTest 保持開啟：太陽被建築／地形擋住時要看不到
  }));
  sunDisc.renderOrder = -1;
  scene.add(sunDisc);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: P0.sunCol, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0,
  }));
  sunHalo.renderOrder = -1;
  scene.add(sunHalo);

  // ── 雲層（諾曼第 6 月：晴間多雲，午後積雲白亮） ────────────────
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  const cloudN = mobile ? 26 : 52;
  for (let i = 0; i < cloudN; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, color: 0xdde1da, transparent: true, opacity: 0.16 + rand() * 0.18, depthWrite: false })
    );
    c.position.set((rand() - 0.5) * 11000, 380 + rand() * 420, (rand() - 0.5) * 11000);
    const s = 480 + rand() * 680;
    c.scale.set(s, s * 0.42, 1);
    c.userData.drift = 6 + rand() * 8;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  // ── 低空圩田晨霧（貼地飄移的軟霧；拂曉最濃，正午近乎散盡） ──────
  const mistTex = makeCloudTexture();
  const mist = new THREE.Group();
  const rm = mulberry(123);
  const mistN = mobile ? 10 : 18;
  for (let i = 0; i < mistN; i++) {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mistTex, color: 0xc9d1cb, transparent: true, opacity: 0, depthWrite: false })
    );
    // 沼澤（北）與圩田（西南）兩處各撒一半：低窪處霧最重
    const north = i % 2 === 0;
    m.position.set(
      north ? -300 + rm() * 600 : -220 + rm() * 300,
      3 + rm() * 5,
      north ? -230 + rm() * 130 : 20 + rm() * 130
    );
    const s = 70 + rm() * 110;
    m.scale.set(s, s * 0.28, 1);
    m.userData.drift = 2 + rm() * 4;
    m.userData.baseOp = 0.05 + rm() * 0.07;
    mist.add(m);
  }
  scene.add(mist);

  const _dir = new THREE.Vector3();

  // ── HDRI 環境光（docs/asset-pipeline-spec.md §3）─────────────────
  // 桌機：spruit_sunrise 1k .hdr 過 PMREM 當 scene.environment（金屬、玻璃、濕地的反射與間接光）；
  //   白晝那張用 tonemapped JPG（省 1.2 MB，PMREM 之後差別看不出來）。
  // 手機：兩張都用 tonemapped JPG。
  // 日相切換不逐幀混兩張 cubemap（太貴）：換圖 ＋ 以 scene.environmentIntensity 做淡入淡出。
  const envMaps = { sunrise: null, day: null };
  let envKey = null;
  let envOn = false;
  let envFade = 0;            // 0–1，換圖時先壓到 0 再拉回，避免硬切
  let envTarget = 0;

  function pickEnv(key) {
    const tex = envMaps[key] ?? envMaps.sunrise ?? envMaps.day;
    if (!tex || envKey === key) return;
    scene.environment = tex;
    envKey = key;
  }

  async function applyAssets(assets) {
    try {
      const sunrise = await assets.envMap('spruit_sunrise');
      if (sunrise) {
        envMaps.sunrise = sunrise;
        envOn = true;
        scene.environmentIntensity = 0;
        pickEnv('sunrise');
      }
      // 白晝那張晚一步載，不擋首屏
      const day = await assets.envMap('noon_grass', { forceTonemapped: true });
      if (day) { envMaps.day = day; envOn = true; }
      return envOn;
    } catch (e) {
      console.warn('[carentan] HDRI 環境光載入失敗，保留程序化天光', e);
      return false;
    }
  }

  function update(dt, battleT) {
    for (const c of clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 9000) c.position.x = -9000;
    }
    for (const m of mist.children) {
      m.position.x += m.userData.drift * dt;
      if (m.position.x > 320) m.position.x = -320;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    skyUniforms.uFog.value = lerpColor(pa.fog, pb.fog, f);
    skyUniforms.uHaze.value = lerpNum(pa.haze, pb.haze, f);
    ground.material.color = lerpColor(pa.ground, pb.ground, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = lerpNum(pa.sunInt, pb.sunInt, f);
    // HDRI 上場後半球光要讓位（否則等於天光算兩次，中間調整片發灰）
    hemi.intensity = lerpNum(pa.amb, pb.amb, f) * (envOn ? 0.72 : 1);
    hemi.color = lerpColor(pa.hemiSky, pb.hemiSky, f);
    hemi.groundColor = lerpColor(pa.hemiGnd, pb.hemiGnd, f);
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);
    scene.fog.near = lerpNum(pa.fogNear, pb.fogNear, f);
    scene.fog.far = lerpNum(pa.fogFar, pb.fogFar, f);

    // 太陽方向（隨日相在天空劃弧）
    _dir.set(
      lerpNum(pa.dir[0], pb.dir[0], f),
      lerpNum(pa.dir[1], pb.dir[1], f),
      lerpNum(pa.dir[2], pb.dir[2], f)
    ).normalize();
    sun.position.copy(_dir).multiplyScalar(SUN_DIST).add(sun.target.position);

    // P-5：太陽本體貼天幕；低仰角放大、偏橘（bloom 會自然讓它泛光）
    const size = lerpNum(pa.sunSize, pb.sunSize, f);
    const col = lerpColor(pa.sunCol, pb.sunCol, f);
    sunDisc.position.copy(_dir).multiplyScalar(13000);
    sunHalo.position.copy(sunDisc.position);
    const s = 340 * size;
    sunDisc.scale.set(s, s, 1);
    sunHalo.scale.set(s * 4.6, s * 4.6, 1);
    sunDisc.material.color.copy(col);
    sunHalo.material.color.copy(col);
    sunDisc.material.opacity = Math.min(1, size) * 0.95;
    sunHalo.material.opacity = Math.min(1, size) * 0.24;

    // 夜間程度（星空、雲亮度）：以兩端調色盤是否為藍調微光相估計
    const nightW = (p) => (p === 'twilight' ? 1 : 0);
    const night = lerpNum(nightW(a), nightW(b), f);
    stars.material.opacity = 0.8 * night;
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * (0.4 + 0.6 * (1 - night));
    // 晨霧：拂曉／藍調微光最濃，正午近乎散盡
    const mistW = (p) => (p === 'noon' ? 0.22 : p === 'morning' ? 0.5 : p === 'afternoon' ? 0.4 : 1);
    const mistPeak = lerpNum(mistW(a), mistW(b), f);
    for (const m of mist.children) m.material.opacity = m.userData.baseOp * mistPeak;

    // HDRI：依日相換圖（f > 0.5 就算換到後一個相），強度以 envFade 淡入淡出
    if (envOn) {
      const wantKey = (f > 0.5 ? pb.hdri : pa.hdri) ?? 'sunrise';
      envTarget = lerpNum(pa.env ?? 0.4, pb.env ?? 0.4, f);
      if (dt <= 0) {                      // 拖曳／除錯跳轉（dt=0）直接對齊，不做淡入
        if (envMaps[wantKey]) pickEnv(wantKey);
        envFade = 1;
      } else if (wantKey !== envKey && envMaps[wantKey]) {
        // 先把強度壓下去再換圖：換的那一幀不會亮度跳動
        envFade = Math.max(0, envFade - dt * 3);
        if (envFade <= 0.02) pickEnv(wantKey);
      } else {
        envFade = Math.min(1, envFade + dt * 1.5);
      }
      scene.environmentIntensity = envTarget * envFade;
    }
  }

  return { update, sun, applyAssets, envActive: () => envOn };
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
  t.colorSpace = THREE.SRGBColorSpace;   // 當 map 用的 CanvasTexture 一律標 sRGB
  return t;
}

// 太陽本體／光暈用：core 為實心核心半徑比例（0.35 = 有明顯圓盤；0.02 = 幾乎純漸層光暈）
function makeDiscTexture(core) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2 - 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(core, 'rgba(255,255,255,0.92)');
  grad.addColorStop(Math.min(0.98, core + 0.25), 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
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
