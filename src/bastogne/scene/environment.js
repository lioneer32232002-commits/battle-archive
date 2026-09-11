// 環境:天空、雪地、寒霧、低雲、光照 — 阿登冬季(1944 年 12 月)。
// 情緒主軸:灰藍陰霾＋濃霧＋冰雪的圍城,間以嚴寒長夜(樹爆),於 12/23 天氣放晴、陽光破雲(空投)。
//
// B-1 升級:renderer 端已開 ACES 色調映射(見 main.js);ACES 會使整體變暗、對比變高,
//   本調色盤已據此把 sunInt／amb 較常態提高約 20–30%、天空與霧色重校,避免死暗或過曝。
import * as THREE from 'three';

// 冬季日相調色盤(皆已為 ACES 補償後的值)
// disc/halo/discCol：P-5 太陽本體與光暈。阿登 12 月＝低斜冬陽,陰霾相位只剩一團模糊亮斑,
//   放晴(clear)才露出真正的日輪,解圍(relief)午後偏西、放大轉暖。夜相全關。
const PALETTES = {
  nightArrival: { top: 0x070b16, horizon: 0x1b2432, sun: 0x9fb4d0, sunInt: 0.55, amb: 0.66, ground: 0x3a4557, fog: 0x141d2a, fogNear: 260, fogFar: 3600, disc: 0,    halo: 0,    discSize: 300, haloSize: 900,  discCol: 0xbcd0ea },
  overcast:     { top: 0x9aa9bb, horizon: 0xc6d0d8, sun: 0xdfe4ea, sunInt: 1.02, amb: 1.34, ground: 0xaeb9c6, fog: 0xc3ccd4, fogNear: 220, fogFar: 3000, disc: 0.18, halo: 0.34, discSize: 640, haloSize: 3200, discCol: 0xf2f6fa },
  nightCold:    { top: 0x05080f, horizon: 0x131b27, sun: 0x9db4d2, sunInt: 0.60, amb: 0.60, ground: 0x333d4b, fog: 0x0c131f, fogNear: 180, fogFar: 2600, disc: 0,    halo: 0,    discSize: 300, haloSize: 900,  discCol: 0xbcd0ea },
  clear:        { top: 0x4f7fbe, horizon: 0xdae6ef, sun: 0xfff4da, sunInt: 1.72, amb: 1.30, ground: 0xe2ebf2, fog: 0xd2dee8, fogNear: 520, fogFar: 8200, disc: 0.95, halo: 0.50, discSize: 460, haloSize: 3200, discCol: 0xfff6e2 },
  relief:       { top: 0x6d93c2, horizon: 0xe6ddc9, sun: 0xffedcc, sunInt: 1.52, amb: 1.30, ground: 0xdfe6ec, fog: 0xd8dccf, fogNear: 620, fogFar: 9000, disc: 0.9,  halo: 0.58, discSize: 620, haloSize: 3800, discCol: 0xffe6b4 },
};

// 日相關鍵格(t 與 battle.js 事件對齊;keep in sync)。phaseAt 於相鄰關鍵格之間線性混合。
const KEYS = [
  { t: 0,    p: 'nightArrival' }, // 12/18–19 夜：倉促馳援、進入傑克森林挖散兵坑
  { t: 150,  p: 'overcast' },     // 12/19–21 灰霾：諾維爾、合圍
  { t: 300,  p: 'overcast' },     // 12/22「呸！」
  { t: 360,  p: 'nightCold' },    // 12/22 夜：樹頂空爆、嚴寒
  { t: 440,  p: 'nightCold' },
  { t: 500,  p: 'clear' },        // 12/23 天氣放晴、陽光破雲、空投
  { t: 660,  p: 'clear' },        // 12/24–25 晴冷：耶誕反撲
  { t: 760,  p: 'overcast' },
  { t: 900,  p: 'relief' },       // 12/26 解圍
  { t: 1000, p: 'relief' },
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

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}
function lerpNum(a, b, f) { return a + (b - a) * f; }

export function createEnvironment(scene, { shadows = false } = {}) {
  // ── 天空圓頂 ──────────────────────────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.nightArrival.top) },
    uHorizon: { value: new THREE.Color(PALETTES.nightArrival.horizon) },
    uFog: { value: new THREE.Color(PALETTES.nightArrival.fog) },   // P-6 地平線霧帶
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
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          // P-6:地平線再壓一層薄霧帶,讓雪原盡頭不是一條硬線
          float band = 1.0 - smoothstep(0.0, 0.085, h);
          col = mix(col, uFog, band * 0.88);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // ── 星空(嚴寒冬夜的天幕,天亮/放晴淡出) ────────────────────
  const starGeo = new THREE.BufferGeometry();
  const starN = 760;
  const sp = new Float32Array(starN * 3);
  const rs = mulberry(11);
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
    new THREE.PointsMaterial({ color: 0xdfe6f2, size: 26, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })
  );
  scene.add(stars);

  // ── 遠景雪原基底(細部地形由 terrain.js 疊上) ───────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshLambertMaterial({ color: PALETTES.nightArrival.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  if (shadows) ground.receiveShadow = true;
  scene.add(ground);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.nightArrival.sunInt);
  sun.position.set(-1800, 1100, 1400); // 冬季低斜日，自東南方低角射入
  scene.add(sun);
  scene.add(sun.target);
  if (shadows) {
    // B-2:陰影只罩戰鬥核心區(收緊的正交範圍),範圍越緊越銳利
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -400; cam.right = 400; cam.top = 400; cam.bottom = -400;
    cam.near = 200; cam.far = 4200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.8;
  }
  const hemi = new THREE.HemisphereLight(0xc4cfdb, 0x4a5162, PALETTES.nightArrival.amb);
  scene.add(hemi);

  // ── P-5 太陽本體與光暈:沿 sun.position 方向貼在天空圓頂內側 ──
  // 兩顆 Additive sprite:小而亮的日輪 ＋ 大而淡的光暈。陰霾相位只剩光暈(雲後的模糊亮斑),
  // 放晴相位日輪現形;bloom 會自然讓它泛光。
  const SUN_DIST = 13000;
  const sunDir = sun.position.clone().normalize();
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeSunTexture(0.30), color: 0xfff4da, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false,
  }));
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeSunTexture(0.02), color: 0xffeccc, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false,
  }));
  sunDisc.position.copy(sunDir).multiplyScalar(SUN_DIST);
  sunHalo.position.copy(sunDir).multiplyScalar(SUN_DIST * 0.99);
  sunDisc.renderOrder = -3; sunHalo.renderOrder = -4;
  scene.add(sunHalo); scene.add(sunDisc);

  scene.fog = new THREE.Fog(PALETTES.nightArrival.fog, PALETTES.nightArrival.fogNear, PALETTES.nightArrival.fogFar);

  // ── 低雲(阿登冬季陰霾低垂;放晴時上抬淡出) ───────────────────
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  for (let i = 0; i < 46; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, color: 0xccd3dc, transparent: true, opacity: 0.2 + rand() * 0.22, depthWrite: false })
    );
    c.position.set((rand() - 0.5) * 11000, 380 + rand() * 380, (rand() - 0.5) * 11000);
    const s = 520 + rand() * 680;
    c.scale.set(s, s * 0.42, 1);
    c.userData.drift = 7 + rand() * 9;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  // ── 貼地寒霧(森林間漂移的軟霧;放晴後漸散) ───────────────────
  const mistTex = makeCloudTexture();
  const mist = new THREE.Group();
  const rm = mulberry(123);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mistTex, color: 0xcfd6de, transparent: true, opacity: 0, depthWrite: false })
    );
    m.position.set(-300 + rm() * 600, 3 + rm() * 5, -60 + rm() * 200);
    const s = 150 + rm() * 190;
    m.scale.set(s, s * 0.32, 1);
    m.userData.drift = 2 + rm() * 5;
    m.userData.baseOp = 0.12 + rm() * 0.14;
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
      if (m.position.x > 340) m.position.x = -340;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    ground.material.color = lerpColor(pa.ground, pb.ground, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = lerpNum(pa.sunInt, pb.sunInt, f);
    hemi.intensity = lerpNum(pa.amb, pb.amb, f);
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);
    scene.fog.near = lerpNum(pa.fogNear, pb.fogNear, f);
    scene.fog.far = lerpNum(pa.fogFar, pb.fogFar, f);
    skyUniforms.uFog.value = scene.fog.color;   // P-6:霧帶跟著相位走

    // 夜間程度(星空、雲亮度):以兩端調色盤是否為夜相估計
    const nightW = (p) => ((p === 'nightArrival' || p === 'nightCold') ? 1 : 0);
    const night = lerpNum(nightW(a), nightW(b), f);
    stars.material.opacity = 0.85 * night;
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * (0.5 + 0.5 * (1 - night));
    // 寒霧:陰霾／夜相最濃,放晴(clear/relief)漸散
    const mistW = (p) => ((p === 'clear' || p === 'relief') ? 0.25 : 1);
    const mistPeak = lerpNum(mistW(a), mistW(b), f);
    for (const m of mist.children) m.material.opacity = m.userData.baseOp * mistPeak;

    // P-5:太陽本體與光暈隨相位開合
    const ds = lerpNum(pa.discSize, pb.discSize, f);
    const hs = lerpNum(pa.haloSize, pb.haloSize, f);
    sunDisc.scale.set(ds, ds, 1);
    sunHalo.scale.set(hs, hs, 1);
    sunDisc.material.opacity = lerpNum(pa.disc, pb.disc, f);
    sunHalo.material.opacity = lerpNum(pa.halo, pb.halo, f);
    sunDisc.material.color = lerpColor(pa.discCol, pb.discCol, f);
    sunHalo.material.color = sunDisc.material.color;

    api.night = night;   // 供 terrain.js 的夜相窗光(B-3)使用
  }

  const api = { update, sun, night: 1 };
  return api;
}

// 太陽貼圖:core 為實心日輪佔比(0.30=有邊界的日輪、0.02=幾乎純光暈)
function makeSunTexture(core) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(Math.max(0.02, core), 'rgba(255,246,224,0.92)');
  grad.addColorStop(Math.min(0.98, core + 0.28), 'rgba(255,214,150,0.20)');
  grad.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
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
  return new THREE.CanvasTexture(c);
}

// 可重現的偽隨機(雲層/星空/寒霧佈局固定)
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
