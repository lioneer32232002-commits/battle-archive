// 環境：天空、地面、晨霧、雲層、光照 — 依戰役時刻變化（清晨 → 夏日白晝）
// 卡倫坦為諾曼第 6 月：暖綠夏景、清晨薄霧漸散、午後晴間多雲。
import * as THREE from 'three';

const PALETTES = {
  night: { top: 0x05080f, horizon: 0x10161f, sun: 0x5d6f8a, sunInt: 0.26, amb: 0.34, ground: 0x1a2016, fog: 0x0c1016 },
  dawn:  { top: 0x5a6e7e, horizon: 0xd8c39a, sun: 0xf0dcb0, sunInt: 0.82, amb: 0.70, ground: 0x4e6230, fog: 0xcdc9ae },
  day:   { top: 0x7ba2c4, horizon: 0xcdd6cf, sun: 0xfff4e0, sunInt: 1.06, amb: 1.02, ground: 0x5f7536, fog: 0xc6cec0 },
};

// 戰役時刻 → 日相與混合比（6/12 清晨 → 夏日白晝；本役無夜景）
function phaseAt(t) {
  if (t < 350) return ['dawn', 'dawn', 0];
  if (t < 392) return ['dawn', 'day', (t - 350) / 42]; // 清晨漸亮為白晝
  return ['day', 'day', 0];
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}

export function createEnvironment(scene) {
  // ── 天空圓頂 ──────────────────────────────────────────
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.night.top) },
    uHorizon: { value: new THREE.Color(PALETTES.night.horizon) },
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
        uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.55)), 1.0);
        }`,
    })
  );
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
    new THREE.PointsMaterial({ color: 0xcdd6e8, size: 30, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })
  );
  scene.add(stars);

  // ── 地面（島區圩田基底，細部地形由 terrain.js 疊上） ──────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshLambertMaterial({ color: PALETTES.night.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  scene.add(ground);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.night.sunInt);
  sun.position.set(2400, 900, -200); // 拂曉自東方（下萊茵河上游）低斜射入
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xaebac4, 0x2a3320, PALETTES.night.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.night.fog, 350, 5200); // 濃霧：遠景沒入晨霾

  // ── 雲層（陰霾低垂；夜間壓暗） ──────────────────────────
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  for (let i = 0; i < 46; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, color: 0xd8dcd6, transparent: true, opacity: 0.16 + rand() * 0.18, depthWrite: false })
    );
    c.position.set((rand() - 0.5) * 11000, 360 + rand() * 360, (rand() - 0.5) * 11000);
    const s = 480 + rand() * 620;
    c.scale.set(s, s * 0.42, 1);
    c.userData.drift = 6 + rand() * 8;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  // ── 低空圩田晨霧（貼地飄移的軟霧；拂曉最濃，白晝漸散） ──────
  const mistTex = makeCloudTexture();
  const mist = new THREE.Group();
  const rm = mulberry(123);
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: mistTex, color: 0xc4ccc8, transparent: true, opacity: 0, depthWrite: false })
    );
    m.position.set(-260 + rm() * 520, 3 + rm() * 4, -40 + rm() * 150);
    const s = 120 + rm() * 160;
    m.scale.set(s, s * 0.3, 1);
    m.userData.drift = 2 + rm() * 4;
    m.userData.baseOp = 0.10 + rm() * 0.12;
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
      if (m.position.x > 320) m.position.x = -320;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    ground.material.color = lerpColor(pa.ground, pb.ground, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = pa.sunInt + (pb.sunInt - pa.sunInt) * f;
    hemi.intensity = pa.amb + (pb.amb - pa.amb) * f;
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);

    const night = a === 'night' ? 1 - f : 0; // 1=全夜,0=已天亮
    stars.material.opacity = 0.85 * night;
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * (0.45 + 0.55 * (1 - night));
    // 晨霧：拂曉（night→dawn 區段）最濃，進入白晝後漸散
    const dawnPeak = a === 'night' ? f : (a === 'dawn' ? 1 - f * 0.7 : 0.3);
    for (const m of mist.children) m.material.opacity = m.userData.baseOp * dawnPeak;
  }

  return { update };
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
