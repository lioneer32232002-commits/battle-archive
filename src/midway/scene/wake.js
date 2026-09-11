// N-2 尾流:艦艏浪 ＋ 沿航跡動態發射的白沫尾跡帶
//
// 舊版每艘船掛一張三角形貼圖 plane,轉彎時尾跡不會跟著彎、停俥也還在,很假。
// 新版:每艘移動中的船艦
//   * 艦艏浪 — 艦艏兩側各一片白沫,大小隨速度縮放,停俥消失
//   * 尾流帶 — 每 0.4 秒自艦艉發射一顆白沫,貼水面,逐漸放大並在 12–20 秒內淡出,
//              形成一條真正跟著轉彎的尾跡;桌機每艘上限 40 顆、手機 16 顆(環形緩衝重用)
//   * 沉沒中的船不再發射,殘留尾跡自然淡出
//
// 效能:所有船的所有白沫合併成「一個 InstancedBufferGeometry ＋ 自寫貼水面 shader」,
//   全場尾流只花 1 個 draw call(舊版是每艘 1 個 plane)。tick 內不 new 物件,全部寫入預配置陣列。
import * as THREE from 'three';
import { WAVE_GLSL, WAVE_SURFACE_GLSL, oceanTime, oceanCell } from './ocean-waves.js';

// 依「行進距離」而非時間發射,尾跡密度才不會隨播放速度改變(2x/4x 都一樣好看)。
// 間距 = 艦長 × SPACING,環形緩衝滿載時尾跡長度 ≈ perShip × SPACING 個艦長(桌機約 3.6 倍艦長)。
const SPACING = 0.09;
const TELEPORT = 240;        // 位移超過此值視為拖曳/跳轉 → 重置,不留假尾跡
const WATER_Y = 0.9; // 相對浪面的抬升量(白沫跟著浪起伏,見下方頂點著色器)

function makeFoamTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.42, 'rgba(246,251,255,0.62)');
  grad.addColorStop(0.78, 'rgba(232,244,252,0.20)');
  grad.addColorStop(1, 'rgba(226,240,250,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // 泡沫顆粒:打散完美圓形
  const img = g.getImageData(0, 0, 128, 128);
  const d = img.data;
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 3) continue;
    d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + (rnd() - 0.5) * 70));
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class WakeField {
  constructor(scene, { mobile = false, ships = 20 } = {}) {
    this.perShip = mobile ? 16 : 40;
    this.shipCap = ships;
    this.bowBase = 0;
    this.trailBase = ships * 2;                      // 前 2N 格是艦艏浪(常駐)
    this.count = ships * 2 + ships * this.perShip;

    const N = this.count;
    this.iPos = new Float32Array(N * 3);
    this.iSize = new Float32Array(N * 2);
    this.iRot = new Float32Array(N);
    this.iAlpha = new Float32Array(N);
    // 尾跡粒子狀態(不進 GPU)
    this.alive = new Uint8Array(N);
    this.w0 = new Float32Array(N);
    this.w1 = new Float32Array(N);

    const base = new THREE.PlaneGeometry(1, 1, 2, 2); // 細分:大片白沫才跟得上浪面起伏
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    geo.instanceCount = N;
    this.aPos = new THREE.InstancedBufferAttribute(this.iPos, 3);
    this.aSize = new THREE.InstancedBufferAttribute(this.iSize, 2);
    this.aRot = new THREE.InstancedBufferAttribute(this.iRot, 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(this.iAlpha, 1);
    for (const a of [this.aPos, this.aSize, this.aRot, this.aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iRot', this.aRot);
    geo.setAttribute('iAlpha', this.aAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12000);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeFoamTexture() }, uTime: oceanTime, uCell: oceanCell },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iSize; attribute float iRot; attribute float iAlpha;
        uniform float uTime;
        varying vec2 vUv; varying float vAlpha;
        ${WAVE_GLSL}
        ${WAVE_SURFACE_GLSL}
        void main() {
          // 貼水面的水平四邊形,繞 y 軸旋轉 iRot
          float s = sin(iRot), c = cos(iRot);
          vec2 p = vec2(position.x * iSize.x, position.y * iSize.y);
          vec3 world = iPos + vec3(p.x * c - p.y * s, 0.0, p.x * s + p.y * c);
          // 逐頂點取同一組浪高,白沫才真的貼在浪面上(不會沉進水裡或浮在空中)
          world.y = waveSurface(vec2(world.x, -world.z), uTime) + iPos.y;
          vUv = uv; vAlpha = iAlpha;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec2 vUv; varying float vAlpha;
        void main() {
          if (vAlpha < 0.004) discard;
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.96, 0.985, 1.0), a);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this.ships = new Map();   // id -> { idx, emitAcc, cursor, lastX, lastZ, speed }
    this.nextIdx = 0;
  }

  register(id) {
    if (this.ships.has(id)) return this.ships.get(id);
    const idx = this.nextIdx++;
    const s = { idx, distAcc: 0, cursor: 0, lastX: null, lastZ: null, speed: 0, strength: 0 };
    this.ships.set(id, s);
    return s;
  }

  // 每幀由 main.js 呼叫:更新艦艏浪、按里程發射尾跡
  updateShip(id, x, z, heading, beam, len, moving, dt) {
    const s = this.ships.get(id) ?? this.register(id);
    if (s.lastX == null) { s.lastX = x; s.lastZ = z; }
    const d = Math.hypot(x - s.lastX, z - s.lastZ);
    if (d > TELEPORT) { s.lastX = x; s.lastZ = z; s.speed = 0; return; } // 拖曳/跳轉:不留假尾跡
    const inst = dt > 1e-4 ? d / dt : 0;
    s.speed += (inst - s.speed) * Math.min(1, dt * 3.5);
    s.lastX = x; s.lastZ = z;

    const fx = Math.sin(heading), fz = -Math.cos(heading);   // 艦艏方向
    const rx = Math.cos(heading), rz = Math.sin(heading);    // 右舷方向
    const running = moving && s.speed > 0.25;
    const spd = running ? Math.min(1, s.speed / 4.5) : 0;
    // 停俥後尾跡不是瞬間消失,而是在約 10 秒內淡掉
    s.strength += ((running ? 1 : 0) - s.strength) * Math.min(1, dt * (running ? 1.2 : 0.1));

    // ── 艦艏浪(兩側各一片,常駐格) ──
    for (let k = 0; k < 2; k++) {
      const i = this.bowBase + s.idx * 2 + k;
      const sgn = k === 0 ? 1 : -1;
      const px = x + fx * len * 0.34 + rx * sgn * beam * 0.34;
      const pz = z + fz * len * 0.34 + rz * sgn * beam * 0.34;
      this.iPos[i * 3] = px; this.iPos[i * 3 + 1] = WATER_Y + 0.25; this.iPos[i * 3 + 2] = pz;
      this.iSize[i * 2] = beam * (0.40 + spd * 0.30);
      this.iSize[i * 2 + 1] = len * (0.16 + spd * 0.14);
      this.iRot[i] = -heading + sgn * 0.30;
      this.iAlpha[i] = spd * 0.85;
    }

    // ── 尾流帶:每走 len×SPACING 就自艦艉發射一顆 ──
    if (!running) return;
    s.distAcc += d;
    const step = Math.max(2, len * SPACING);
    let guard = 0;
    while (s.distAcc >= step && guard++ < 4) {
      s.distAcc -= step;
      const i = this.trailBase + s.idx * this.perShip + s.cursor;
      s.cursor = (s.cursor + 1) % this.perShip;
      const sx = x - fx * len * 0.5;
      const sz = z - fz * len * 0.5;
      this.iPos[i * 3] = sx; this.iPos[i * 3 + 1] = WATER_Y; this.iPos[i * 3 + 2] = sz;
      this.iRot[i] = -heading;
      this.alive[i] = 1;
      this.w0[i] = beam * 0.55;
      this.w1[i] = beam * 2.7;
    }
  }

  // 沉沒/隱藏時把艦艏浪關掉(殘留尾跡照樣自然淡出)
  hideBow(id) {
    const s = this.ships.get(id);
    if (!s) return;
    this.iAlpha[this.bowBase + s.idx * 2] = 0;
    this.iAlpha[this.bowBase + s.idx * 2 + 1] = 0;
  }

  update(dt) {
    // 以「在環形緩衝中的新舊排名」決定寬度與濃度:與播放速度無關,尾跡永遠是一條
    // 由窄到寬、由濃到淡、真正跟著航跡轉彎的帶子。
    const per = this.perShip;
    const denom = per - 1 || 1;
    for (const s of this.ships.values()) {
      const base = this.trailBase + s.idx * per;
      for (let k = 0; k < per; k++) {
        const i = base + k;
        if (!this.alive[i]) continue;
        const rank = (s.cursor - 1 - k + per) % per;   // 0 = 最新
        const f = rank / denom;
        const w = this.w0[i] + (this.w1[i] - this.w0[i]) * f;
        this.iSize[i * 2] = w;
        this.iSize[i * 2 + 1] = w * 1.15;
        // 每顆濃度要壓很低:沿航跡重疊約 (寬度 / 間距) 倍,疊起來才是合理的白沫帶
        this.iAlpha[i] = Math.min(1, (1 - f) * 1.25) * (1 - f * f) * 0.30 * s.strength;
      }
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  // 拖曳時間軸/跳轉:清光殘留尾跡
  clear() {
    this.iAlpha.fill(0);
    this.alive.fill(0);
    for (const s of this.ships.values()) {
      s.lastX = null; s.lastZ = null; s.speed = 0; s.cursor = 0; s.distAcc = 0; s.strength = 0;
    }
    this.aAlpha.needsUpdate = true;
  }
}
