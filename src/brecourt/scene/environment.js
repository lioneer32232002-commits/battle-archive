// 環境:天空、地面、雲層、星空、太陽本體、貼地晨霧、光照 — 依戰役時刻變化(夜→拂曉→清晨)
// 座標:北 = -z、東 = +x(猶他灘在東)。戰役時間 t = 當日分鐘數(TIME_START 70 = 01:10)。
//
// 美術升級(docs/art-upgrade-spec.md):
//   P-1 ACES:renderer 端已開 ACESFilmicToneMapping(見 main.js)。ACES 會壓暗中間調、提高對比,
//     本調色盤已據此把 sunInt／amb 提高約 20–30%,天空/霧/地面色重校,避免死暗或過曝。
//   P-2 太陽 castShadow,正交範圍只罩戰鬥核心區(±380)。
//   P-5 太陽本體 Sprite ＋ 光暈:沿真實太陽方位放置,拂曉低垂橘紅、清晨升高轉白。
//   P-6 地平線霧帶:天空 shader 在 h < 0.09 混入霧色,地平線不再是一條硬線。
//   D 日清晨:太陽自東北東升起(低斜暖光 → 長影),薄晨霧貼地,天亮後漸散。
//
// 真實資產(docs/asset-pipeline-spec.md §3,2026-09-12):
//   A-7 HDRI 環境光:桌機用 PMREM 把 1k .hdr 做成 scene.environment(金屬、水面的反射與間接光),
//       手機用 tonemapped JPG 走同一條 PMREM。依日相在兩張之間切換(清晨 kiara_1_dawn →
//       上午 noon_grass),切換時把 environmentIntensity 壓到 0 再拉回來(crossfade,不每幀混)。
//       天幕維持現有程序化 sky dome ＋ 雲(時間變化較細),HDRI 只當光源不當背景。
//       環境光進來之後 hemisphere 補光相應降低,總亮度維持在原調色盤校準過的水準。
import * as THREE from 'three';
import { loadEnvMap, afterFirstFrame } from './assets.js';

// 註(調色的兩個關鍵,第二輪實測後重寫):
//  ① three 自 r155 起用物理光照(輻照度不乘 π、Lambert BRDF 除以 π),諾曼第牧草地反照率只有
//     雪地的 1/5,強度得比巴斯通那組高。
//  ② 桌機管線補上 OutputPass 之後(見 postfx.js 檔頭),ACES＋sRGB 才真的生效,整體亮度大幅提高,
//     第一輪那組 5.2/3.2 會過曝 → 全面下修,並改以「六月上午十點的亮綠草地」為目標校準。
const PALETTES = {
  night:   { top: 0x060a14, horizon: 0x17203a, sun: 0x8296bf, sunInt: 0.72, amb: 0.82, envInt: 0.15, ground: 0x2b3524, fog: 0x101725, fogNear: 320, fogFar: 9000 },
  dawn:    { top: 0x2e4a78, horizon: 0xefa268, sun: 0xffc189, sunInt: 2.55, amb: 1.42, envInt: 0.40, ground: 0x53652f, fog: 0xb59a7c, fogNear: 240, fogFar: 7200 },
  morning: { top: 0x59a0dc, horizon: 0xdeeaec, sun: 0xfff1d8, sunInt: 3.30, amb: 1.95, envInt: 0.45, ground: 0x7c9041, fog: 0xc7d5c7, fogNear: 700, fogFar: 15000 },
  midday:  { top: 0x6fb2e6, horizon: 0xe9f2f1, sun: 0xfff6e4, sunInt: 4.15, amb: 2.50, envInt: 0.48, ground: 0x8a9c4c, fog: 0xd3ded1, fogNear: 900, fogFar: 17000 },
};

// HDRI 依日相切換:清晨(含夜與拂曉)→ 上午。t 是戰役時刻(當日分鐘)。
const ENV_DAWN = 'kiara_1_dawn';
const ENV_MORNING = 'noon_grass';
const ENV_SWITCH_T = 430;
// 環境光進來之後,hemisphere 補光要讓出這個比例(避免加總過曝)
const HEMI_GIVEBACK = 0.62;

// 戰役時刻 → 日相與混合比
// D 日 01:10 夜跳 → 05:30 天光 → 06:00 日出 → 08:00 清晨 → 08:30 拔砲後日頭升高 → 10:00 明亮上午
function phaseAt(t) {
  if (t < 285) return ['night', 'night', 0];
  if (t < 372) return ['night', 'dawn', (t - 285) / 87];
  if (t < 470) return ['dawn', 'morning', (t - 372) / 98];
  if (t < 570) return ['morning', 'midday', (t - 470) / 100];
  return ['midday', 'midday', 0];
}

// 太陽方位(羅盤度,北 0 東 90)與仰角(弧度)隨時刻變化:日出東北東、清晨升高偏東南
const SUN_KEYS = [
  { t: 280, az: 52, el: -0.06 },
  { t: 345, az: 58, el: 0.02 },
  { t: 400, az: 70, el: 0.13 },
  { t: 500, az: 92, el: 0.30 },
  { t: 640, az: 116, el: 0.47 },
];

function sunAngles(t) {
  if (t <= SUN_KEYS[0].t) return SUN_KEYS[0];
  const last = SUN_KEYS[SUN_KEYS.length - 1];
  if (t >= last.t) return last;
  for (let i = 0; i < SUN_KEYS.length - 1; i++) {
    const a = SUN_KEYS[i], b = SUN_KEYS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return { az: a.az + (b.az - a.az) * f, el: a.el + (b.el - a.el) * f };
    }
  }
  return last;
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}
function lerpNum(a, b, f) { return a + (b - a) * f; }

// toneMapSky:天空是自寫 ShaderMaterial,不吃 three 的 tonemapping/colorspace chunk。
//   桌機走 composer,最後有 OutputPass 統一處理,天空不必自己來;手機直接 renderer.render,
//   受光材質會自己 ACES＋sRGB,天空就得在片元裡補同一條曲線,否則天地兩套響應曲線對不齊。
export function createEnvironment(scene, { shadows = false, mobile = false, toneMapSky = false, renderer = null } = {}) {
  // ── 天空圓頂(P-6:地平線霧帶) ─────────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.night.top) },
    uHorizon: { value: new THREE.Color(PALETTES.night.horizon) },
    uFogC: { value: new THREE.Color(PALETTES.night.fog) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(16000, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      defines: toneMapSky ? { SKY_TONEMAP: '' } : {},
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFogC; varying vec3 vPos;
        // Narkowicz 的 ACES 近似 fit(與 three 的 ACESFilmicToneMapping 同一條曲線)
        vec3 acesFit(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
        }
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(h, 0.55));    // uniforms 已是線性(ColorManagement)
          float band = 1.0 - smoothstep(0.0, 0.09, h);   // P-6：貼著地平線的薄霧帶
          c = mix(c, uFogC, band * 0.78);
          #ifdef SKY_TONEMAP
            c = toSRGB(acesFit(c));                      // 手機路徑:天空自己補上與地面同一條曲線
          #endif
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // ── 星空(夜跳時的天幕,白晝淡出) ──────────────────────
  const starGeo = new THREE.BufferGeometry();
  const starN = 900;
  const sp = new Float32Array(starN * 3);
  const rs = mulberry(7);
  for (let i = 0; i < starN; i++) {
    const u = rs() * Math.PI * 2;
    const v = rs() * 0.5 * Math.PI; // 0..90度仰角
    const r = 14000;
    sp[i * 3] = r * Math.cos(v) * Math.cos(u);
    sp[i * 3 + 1] = r * Math.sin(v) * 0.9 + 200;
    sp[i * 3 + 2] = r * Math.cos(v) * Math.sin(u);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    starGeo,
    // 星點在 14000 單位外,開 sizeAttenuation 會小於一像素等於看不見 → 改用固定像素尺寸
    new THREE.PointsMaterial({ color: 0xdfe6f5, size: 2.0, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false })
  );
  scene.add(stars);

  // ── 遠景地面(諾曼第田野基底;戰場地表由 terrain.js 疊上) ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshStandardMaterial({ color: PALETTES.night.ground, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  scene.add(ground);

  // ── 光照(P-2) ────────────────────────────────────────
  const SUN_R = 2600;
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.night.sunInt);
  sun.position.set(0, 900, -SUN_R);
  scene.add(sun);
  scene.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -380; cam.right = 380; cam.top = 380; cam.bottom = -380;
    cam.near = 400; cam.far = 5600;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.15;   // 1 單位≈10 公尺,0.8 會把採樣點推出 8 公尺(卡倫坦實測 0.15 即可)
    cam.updateProjectionMatrix();   // 改完正交範圍必須重算投影矩陣,否則仍是預設 ±5
  }
  const hemi = new THREE.HemisphereLight(0xbfd4de, 0x2f3a22, PALETTES.night.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.night.fog, PALETTES.night.fogNear, PALETTES.night.fogFar);

  // ── P-5 太陽本體 ＋ 光暈(Additive Sprite,沿 sun 方向掛在天幕內側) ──
  const discTex = makeDiscTexture('rgba(255,250,236,1)', 0.30);
  const haloTex = makeDiscTexture('rgba(255,214,150,0.55)', 0.02);
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
  sunDisc.renderOrder = -1; sunHalo.renderOrder = -2;
  scene.add(sunHalo); scene.add(sunDisc);

  // ── 雲層(D 日破曉多雲;夜間壓暗) ──────────────────────
  const cloudTex = makeCloudTexture(3);
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  const cloudN = mobile ? 34 : 62;
  for (let i = 0; i < cloudN; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.2 + rand() * 0.18, depthWrite: false })
    );
    c.position.set((rand() - 0.5) * 11000, 520 + rand() * 460, (rand() - 0.5) * 11000);
    const s = 420 + rand() * 620;
    c.scale.set(s, s * 0.4, 1);
    c.userData.drift = 5 + rand() * 7;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  // ── 貼地晨霧(D 日清晨的招牌;日出後漸散) ─────────────────
  const mistTex = makeCloudTexture(4);
  const mist = new THREE.Group();
  const rm = mulberry(311);
  const mistN = mobile ? 12 : 26;
  for (let i = 0; i < mistN; i++) {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mistTex, color: 0xdcd7c6, transparent: true, opacity: 0, depthWrite: false })
    );
    m.position.set(-320 + rm() * 700, 2.5 + rm() * 6, -220 + rm() * 480);
    const s = 150 + rm() * 220;
    m.scale.set(s, s * 0.3, 1);
    m.userData.drift = 2 + rm() * 5;
    m.userData.baseOp = 0.13 + rm() * 0.15;
    mist.add(m);
  }
  scene.add(mist);

  // ── A-7 HDRI 環境光 ──────────────────────────────────
  // 首屏不等 HDRI:先照原本的 hemisphere ＋ 方向光跑,.hdr 到了再淡入。
  // 上午那張(1.5 MB)更晚才抓 —— 時間軸推進到天亮前 100 分鐘、或閒置 8 秒後,
  // 兩者先到先算 → 首屏下載量只含清晨那張。
  const envTex = { dawn: null, morning: null };
  let envFade = 0;          // 0..1:淡入／切換時的 crossfade
  let morningRequested = false;
  if (renderer) {
    afterFirstFrame(() => {
      loadEnvMap(ENV_DAWN).then((t) => { envTex.dawn = t; });
      setTimeout(requestMorning, 8000);
    });
  }
  function requestMorning() {
    // 手機整場沿用清晨那張:tonemapped JPG 也要 280 KB,而手機首屏預算只有 2.5 MB,
    // 換來的環境光差異在小螢幕上看不出來。
    if (morningRequested || !renderer || mobile) return;
    morningRequested = true;
    loadEnvMap(ENV_MORNING).then((t) => { envTex.morning = t; });
  }

  function updateEnvironment(dt, battleT) {
    if (battleT > ENV_SWITCH_T - 100) requestMorning();
    const want = battleT >= ENV_SWITCH_T ? (envTex.morning ?? envTex.dawn) : (envTex.dawn ?? envTex.morning);
    if (!want) return;
    if (scene.environment !== want) {
      // 切換:先把環境光壓到 0 再換,避免上午那張直接砸在拂曉的畫面上
      envFade = Math.max(0, envFade - dt * 2.2);
      if (envFade <= 0.02 || !scene.environment) scene.environment = want;
    } else {
      envFade = Math.min(1, envFade + dt * 1.4);
    }
  }

  function update(dt, battleT) {
    for (const c of clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 9000) c.position.x = -9000;
    }
    for (const m of mist.children) {
      m.position.x += m.userData.drift * dt;
      if (m.position.x > 400) m.position.x = -400;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    ground.material.color = lerpColor(pa.ground, pb.ground, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = lerpNum(pa.sunInt, pb.sunInt, f);

    // A-7:HDRI 淡入多少,hemisphere 就讓出多少(總量維持在原調色盤校準過的水準)
    updateEnvironment(dt, battleT);
    scene.environmentIntensity = lerpNum(pa.envInt, pb.envInt, f) * envFade;
    hemi.intensity = lerpNum(pa.amb, pb.amb, f) * (1 - HEMI_GIVEBACK * envFade);
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);
    scene.fog.near = lerpNum(pa.fogNear, pb.fogNear, f);
    scene.fog.far = lerpNum(pa.fogFar, pb.fogFar, f);
    skyUniforms.uFogC.value = scene.fog.color;

    // 太陽方位:D 日清晨自東北東低斜升起 → 長影
    const ang = sunAngles(battleT);
    const azr = (ang.az * Math.PI) / 180;
    const ce = Math.cos(ang.el), se = Math.sin(ang.el);
    sun.position.set(Math.sin(azr) * ce * SUN_R, Math.max(se, 0.06) * SUN_R, -Math.cos(azr) * ce * SUN_R);

    // 夜→拂曉:星空與雲層的可見度
    const night = a === 'night' ? 1 - f : 0; // 1=全夜,0=已天亮
    stars.material.opacity = 0.9 * night;
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * (0.35 + 0.65 * (1 - night));

    // 晨霧:拂曉最濃,日頭升高後散去
    const mistPeak = battleT < 250 ? 0.35
      : battleT < 400 ? 0.35 + 0.65 * ((battleT - 250) / 150)
        : Math.max(0.12, 1 - (battleT - 400) / 210);
    for (const m of mist.children) m.material.opacity = m.userData.baseOp * mistPeak;

    // P-5 太陽本體:低垂時大而橘、升高後小而白;夜裡不畫
    const dayness = 1 - night;
    const lowness = 1 - Math.min(1, Math.max(0, ang.el / 0.45));   // 1=貼地平線
    const dist = 13000;
    sunDisc.position.set(
      Math.sin(azr) * ce * dist,
      Math.max(se, -0.01) * dist + 120,
      -Math.cos(azr) * ce * dist
    );
    sunHalo.position.copy(sunDisc.position);
    const size = 620 + lowness * 900;
    sunDisc.scale.set(size, size, 1);
    sunHalo.scale.set(size * 3.4, size * 3.4, 1);
    sunDisc.material.color.setHex(lowness > 0.5 ? 0xffb070 : 0xfff0d8);
    sunHalo.material.color.setHex(lowness > 0.5 ? 0xff8a3c : 0xffd9a0);
    sunDisc.material.opacity = 0.9 * dayness;
    sunHalo.material.opacity = (0.20 + 0.30 * lowness) * dayness;
    sunDisc.visible = sunHalo.visible = dayness > 0.02;
  }

  return { update, sun, envTex };
}

// 柔邊圓盤(太陽本體/光暈)。core = 實心比例;邊緣一定收到全透明,否則 sprite 會露出方形。
function makeDiscTexture(inner, core) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  grad.addColorStop(0, inner);
  grad.addColorStop(core, inner);
  grad.addColorStop(Math.min(0.98, core + 0.25), 'rgba(255,190,120,0.18)');
  grad.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 當 map 用:畫布內容是 sRGB
  return t;
}

// 雲:數顆大小不一的柔邊圓疊加(取代單一圓斑)
function makeCloudTexture(seed) {
  const S = 160;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry(seed * 977 + 13);
  const puff = (x, y, rad, a) => {
    const grad = g.createRadialGradient(x, y, rad * 0.1, x, y, rad);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  puff(S / 2, S / 2, S * 0.42, 0.7);
  for (let i = 0; i < 8; i++) {
    puff(S * (0.24 + r() * 0.52), S * (0.34 + r() * 0.32), S * (0.10 + r() * 0.20), 0.30 + r() * 0.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 可重現的偽隨機(雲層/星空/晨霧佈局固定)
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
