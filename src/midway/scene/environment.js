// 環境:天空、海面、雲層、光照 — 依戰役時刻變化(黎明→白晝→黃昏)
import * as THREE from 'three';

const PALETTES = {
  dawn: { top: 0x1a2a55, horizon: 0xe8956b, sun: 0xffb27a, sunInt: 0.9, amb: 0.5, water: 0x1a3a58, fog: 0x9a8a82 },
  day: { top: 0x3577c9, horizon: 0xcfe3ee, sun: 0xfff3df, sunInt: 1.25, amb: 0.7, water: 0x10456e, fog: 0xbfd4de },
  dusk: { top: 0x2a2150, horizon: 0xe07a4e, sun: 0xff9a55, sunInt: 0.8, amb: 0.4, water: 0x122840, fog: 0xc08a6a },
  night: { top: 0x060a18, horizon: 0x1c2a45, sun: 0x8aa3cc, sunInt: 0.25, amb: 0.22, water: 0x081625, fog: 0x16202f },
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

export function createEnvironment(scene) {
  // 天空圓頂
  const skyUniforms = {
    uTop: { value: new THREE.Color(PALETTES.day.top) },
    uHorizon: { value: new THREE.Color(PALETTES.day.horizon) },
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

  // 海面
  const oceanUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.3).normalize() },
    uWater: { value: new THREE.Color(PALETTES.day.water) },
    uSky: { value: new THREE.Color(PALETTES.day.horizon) },
    uSunColor: { value: new THREE.Color(PALETTES.day.sun) },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000, 160, 160),
    new THREE.ShaderMaterial({
      uniforms: oceanUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorld;
        float wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
          return sin(dot(p, dir) * freq + uTime * speed) * amp;
        }
        void main() {
          vec3 pos = position;
          vec2 p = vec2(position.x, position.y); // plane 旋轉前座標
          float h = wave(p, vec2(1.0, 0.6), 0.012, 1.1, 3.2)
                  + wave(p, vec2(-0.7, 1.0), 0.02, 1.6, 1.8)
                  + wave(p, vec2(0.3, -1.0), 0.05, 2.2, 0.7);
          pos.z += h;
          // 數值微分求法線
          float e = 8.0;
          float hx = wave(p + vec2(e, 0.0), vec2(1.0, 0.6), 0.012, 1.1, 3.2)
                   + wave(p + vec2(e, 0.0), vec2(-0.7, 1.0), 0.02, 1.6, 1.8)
                   + wave(p + vec2(e, 0.0), vec2(0.3, -1.0), 0.05, 2.2, 0.7);
          float hy = wave(p + vec2(0.0, e), vec2(1.0, 0.6), 0.012, 1.1, 3.2)
                   + wave(p + vec2(0.0, e), vec2(-0.7, 1.0), 0.02, 1.6, 1.8)
                   + wave(p + vec2(0.0, e), vec2(0.3, -1.0), 0.05, 2.2, 0.7);
          vNormal = normalize(vec3(-(hx - h) / e, 1.0, (hy - h) / e));
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir; uniform vec3 uWater; uniform vec3 uSky; uniform vec3 uSunColor;
        varying vec3 vNormal; varying vec3 vWorld;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float diff = max(dot(n, uSunDir), 0.0);
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, halfDir), 0.0), 220.0);
          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
          vec3 col = uWater * (0.55 + 0.45 * diff);
          col = mix(col, uSky, fresnel * 0.55);
          col += uSunColor * spec * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  // 光照
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(2000, 2600, -1400);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4de, 0x10456e, 0.7);
  scene.add(hemi);

  scene.fog = new THREE.Fog(PALETTES.day.fog, 4500, 14000);

  // 雲層(6/4 多雲 — 東北海域雲帶曾掩護美軍俯衝轟炸機)
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Group();
  const rand = mulberry(42);
  for (let i = 0; i < 60; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.28 + rand() * 0.22, depthWrite: false })
    );
    // 部分集中在西北(機動部隊上空雲帶)
    const cluster = i < 24;
    const cx = cluster ? -900 + (rand() - 0.5) * 2200 : (rand() - 0.5) * 9000;
    const cz = cluster ? -1300 + (rand() - 0.5) * 1800 : (rand() - 0.5) * 9000;
    sp.position.set(cx, 480 + rand() * 380, cz);
    const s = 380 + rand() * 520;
    sp.scale.set(s, s * 0.38, 1);
    sp.userData.drift = 6 + rand() * 8;
    clouds.add(sp);
  }
  scene.add(clouds);

  function update(dt, battleT) {
    oceanUniforms.uTime.value += dt;
    for (const c of clouds.children) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 8000) c.position.x = -8000;
    }
    const [a, b, f] = phaseAt(battleT);
    const pa = PALETTES[a];
    const pb = PALETTES[b];
    skyUniforms.uTop.value = lerpColor(pa.top, pb.top, f);
    skyUniforms.uHorizon.value = lerpColor(pa.horizon, pb.horizon, f);
    oceanUniforms.uWater.value = lerpColor(pa.water, pb.water, f);
    oceanUniforms.uSky.value = lerpColor(pa.horizon, pb.horizon, f);
    oceanUniforms.uSunColor.value = lerpColor(pa.sun, pb.sun, f);
    sun.color = lerpColor(pa.sun, pb.sun, f);
    sun.intensity = pa.sunInt + (pb.sunInt - pa.sunInt) * f;
    hemi.intensity = pa.amb + (pb.amb - pa.amb) * f;
    scene.fog.color = lerpColor(pa.fog, pb.fog, f);
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
