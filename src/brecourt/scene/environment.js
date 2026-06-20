// 環境:天空、地面、雲層、星空、光照 — 依戰役時刻變化(夜→拂曉→白晝)
// 與 midway 共用天空圓頂 shader;海面改為諾曼第田野地面,並加夜跳星空。
import * as THREE from 'three';

const PALETTES = {
  night: { top: 0x05080f, horizon: 0x141d30, sun: 0x6c7fa6, sunInt: 0.30, amb: 0.30, ground: 0x1b241a, fog: 0x0f141c },
  dawn:  { top: 0x274069, horizon: 0xe09868, sun: 0xffb88a, sunInt: 0.95, amb: 0.62, ground: 0x46582f, fog: 0x98927e },
  day:   { top: 0x539bd6, horizon: 0xd6e6ea, sun: 0xfff6e6, sunInt: 1.40, amb: 0.94, ground: 0x6c8044, fog: 0xc2d2c6 },
};

// 戰役時刻 → 日相與混合比(D 日 01:30 夜跳 → 約 07:00 拂曉 → 白晝)
function phaseAt(t) {
  if (t < 270) return ['night', 'night', 0];
  if (t < 360) return ['night', 'dawn', (t - 270) / 90];
  if (t < 480) return ['dawn', 'day', (t - 360) / 120];
  return ['day', 'day', 0];
}

function lerpColor(a, b, f) {
  return new THREE.Color(a).lerp(new THREE.Color(b), f);
}

export function createEnvironment(scene) {
  // ── 天空圓頂(與 midway 同一 shader) ──────────────────
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

  // ── 星空(夜跳時的天幕,白晝淡出) ──────────────────────
  const starGeo = new THREE.BufferGeometry();
  const starN = 900;
  const sp = new Float32Array(starN * 3);
  const rs = mulberry(7);
  for (let i = 0; i < starN; i++) {
    // 散佈於半球天幕(只取上半)
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
    new THREE.PointsMaterial({ color: 0xdfe6f5, size: 34, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })
  );
  scene.add(stars);

  // ── 地面(諾曼第田野基底,細部地形由 terrain.js 疊上) ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 1, 1),
    new THREE.MeshLambertMaterial({ color: PALETTES.night.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  scene.add(ground);

  // ── 光照 ─────────────────────────────────────────────
  const sun = new THREE.DirectionalLight(0xffffff, PALETTES.night.sunInt);
  sun.position.set(-1800, 1600, 2400); // 拂曉自東方(+x 偏南)斜射
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4de, 0x2a331f, PALETTES.night.amb);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.night.fog, 1600, 13000);

  // ── 雲層(D 日破曉多雲;夜間壓暗) ──────────────────────
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  for (let i = 0; i < 56; i++) {
    const c = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.22 + rand() * 0.2, depthWrite: false })
    );
    c.position.set((rand() - 0.5) * 11000, 520 + rand() * 420, (rand() - 0.5) * 11000);
    const s = 420 + rand() * 560;
    c.scale.set(s, s * 0.4, 1);
    c.userData.drift = 5 + rand() * 7;
    c.userData.baseOp = c.material.opacity;
    clouds.add(c);
  }
  scene.add(clouds);

  function update(dt, battleT) {
    for (const c of clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 9000) c.position.x = -9000;
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

    // 夜→拂曉:星空與雲層的可見度
    const night = a === 'night' ? 1 - f : 0; // 1=全夜,0=已天亮
    stars.material.opacity = 0.9 * night;
    for (const c of clouds.children) c.material.opacity = c.userData.baseOp * (0.35 + 0.65 * (1 - night));
  }

  return { update };
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 可重現的偽隨機(雲層/星空佈局固定)
function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
