// GPU 批次繪製小工具(2026-09-12 美術升級)
//
// 為什麼要有這一層:海戰的雲、尾流、煙、火、水花動輒上千片,若每片都用 THREE.Sprite,
// 一片就是一個 draw call,規格 §0-8 的「draw call 不得增加 40%」根本守不住。
// 這裡提供兩種 InstancedBufferGeometry 批次:
//   BillboardField — 永遠面向鏡頭的四邊形(雲、煙、火、爆炸閃光)
//   FlatField      — 平貼水面的四邊形(尾流白沫、油汙、衝擊波環)
// 兩者都是「一整片 = 一個 draw call」,並支援每個實例各自的位置／尺寸／旋轉／透明度／
// 顏色／貼圖分格(atlas tile)。
//
// 用法:每幀由上層系統寫入 CPU 端 Float32Array,再 flush(n) 一次上傳。
// 主迴圈內不 new 物件(§0-4)。
import * as THREE from 'three';

// ── 可重現的偽隨機(§0-5) ─────────────────────────────
export function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// 由 2×2 分格的畫布做圖集(不產 mipmap,避免分格互相滲色)
export function makeAtlas(size, drawTile) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.save();
    // canvas 的 y 向下、貼圖的 v 向上(CanvasTexture 預設 flipY),故 row 反著畫,
    // 讓 shader 的 tile 0/1 落在下半、2/3 落在上半,與 iTile 的編號一致。
    g.translate((i % 2) * size, (1 - Math.floor(i / 2)) * size);
    g.beginPath();
    g.rect(0, 0, size, size);
    g.clip();
    drawTile(g, i, size);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; // 當顏色貼圖用,必須宣告色彩空間
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// 徑向柔邊圓(圖集分格常用)
export function radial(g, size, stops) {
  const r = size * 0.5;
  const grad = g.createRadialGradient(r, r, size * 0.02, r, r, r * 0.94);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

// 海浪高度場(與 environment.js 的海面 shader 同一組參數)。
// 平貼水面的東西(尾流白沫、油汙、衝擊波環)必須跟著浪起伏,否則固定高度的四邊形
// 會被浪峰擋掉一半 —— 第一版就是這樣,尾流幾乎看不到。
// plane 旋轉 -90° 後:local(x, y) = world(x, -z)。
export const OCEAN_WAVE_GLSL = `
  float _wave(vec2 p, vec2 dir, float freq, float speed, float amp, float t) {
    return sin(dot(p, dir) * freq + t * speed) * amp;
  }
  float oceanHeight(vec2 p, float t) {
    return _wave(p, vec2(1.0, 0.6), 0.012, 1.1, 3.2, t)
         + _wave(p, vec2(-0.7, 1.0), 0.02, 1.6, 1.8, t)
         + _wave(p, vec2(0.3, -1.0), 0.05, 2.2, 0.7, t)
         + _wave(p, vec2(0.85, -0.5), 0.09, 2.9, 0.28, t)
         + _wave(p, vec2(-0.4, -0.9), 0.16, 3.6, 0.14, t)
         + _wave(p, vec2(1.0, 0.15), 0.28, 4.4, 0.07, t);
  }`;

// 同一組波在 JS 端的實作(船艦要跟著同一片浪起伏,不能各算各的)
const WAVES = [
  [1, 0.6, 0.012, 1.1, 3.2], [-0.7, 1, 0.02, 1.6, 1.8], [0.3, -1, 0.05, 2.2, 0.7],
  [0.85, -0.5, 0.09, 2.9, 0.28], [-0.4, -0.9, 0.16, 3.6, 0.14], [1, 0.15, 0.28, 4.4, 0.07],
];
export function oceanHeightAt(x, z, t) {
  const px = x, py = -z;
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += Math.sin((px * w[0] + py * w[1]) * w[2] + t * w[3]) * w[4];
  }
  return h;
}

const QUAD_POS = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_IDX = [0, 1, 2, 0, 2, 3];

function baseGeometry(max) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD_POS, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(QUAD_UV, 2));
  geo.setIndex(QUAD_IDX);
  const attrs = {
    iPos: new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3),
    iScale: new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2),
    iRot: new THREE.InstancedBufferAttribute(new Float32Array(max), 1),
    iAlpha: new THREE.InstancedBufferAttribute(new Float32Array(max), 1),
    iTile: new THREE.InstancedBufferAttribute(new Float32Array(max), 1),
    iColor: new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3),
  };
  for (const [k, v] of Object.entries(attrs)) {
    v.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(k, v);
  }
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { geo, attrs };
}

const COMMON_VARY = `
  varying vec2 vUv; varying float vAlpha; varying vec3 vColor;`;

const FRAG = `
  uniform sampler2D uMap;
  ${COMMON_VARY}
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(t.rgb * vColor, a);
  }`;

class Field {
  constructor(texture, max, vertexShader, opts = {}) {
    const { geo, attrs } = baseGeometry(max);
    this.max = max;
    this.geo = geo;
    this.a = attrs;
    this.count = 0;
    this.uniforms = { uMap: { value: texture }, uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest !== false,
      blending: opts.blending ?? THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 3;
  }

  // 寫入第 i 個實例(不觸發上傳)
  set(i, x, y, z, sx, sy, rot, alpha, tile, r, g, b) {
    const a = this.a;
    a.iPos.array[i * 3] = x; a.iPos.array[i * 3 + 1] = y; a.iPos.array[i * 3 + 2] = z;
    a.iScale.array[i * 2] = sx; a.iScale.array[i * 2 + 1] = sy;
    a.iRot.array[i] = rot;
    a.iAlpha.array[i] = alpha;
    a.iTile.array[i] = tile;
    a.iColor.array[i * 3] = r; a.iColor.array[i * 3 + 1] = g; a.iColor.array[i * 3 + 2] = b;
  }

  // 一次上傳前 n 個實例
  flush(n) {
    this.count = Math.min(n, this.max);
    this.geo.instanceCount = this.count;
    for (const k in this.a) this.a[k].needsUpdate = true; // r184 已無 updateRange,整批上傳
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

// 面向鏡頭的四邊形(view space 位移)
const BILLBOARD_VS = `
  attribute vec3 iPos; attribute vec2 iScale; attribute float iRot;
  attribute float iAlpha; attribute float iTile; attribute vec3 iColor;
  ${COMMON_VARY}
  void main() {
    vAlpha = iAlpha; vColor = iColor;
    float col = mod(iTile, 2.0);
    float row = floor(iTile * 0.5);
    vUv = (uv + vec2(col, row)) * 0.5;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot), s = sin(iRot);
    vec2 q = position.xy * iScale;
    mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    gl_Position = projectionMatrix * mv;
  }`;

// 平貼水面的四邊形(世界座標 XZ 平面,繞 Y 旋轉,並跟著海浪高度起伏)
const FLAT_VS = `
  uniform float uTime;
  attribute vec3 iPos; attribute vec2 iScale; attribute float iRot;
  attribute float iAlpha; attribute float iTile; attribute vec3 iColor;
  ${COMMON_VARY}
  ${OCEAN_WAVE_GLSL}
  void main() {
    vAlpha = iAlpha; vColor = iColor;
    float col = mod(iTile, 2.0);
    float row = floor(iTile * 0.5);
    vUv = (uv + vec2(col, row)) * 0.5;
    float c = cos(iRot), s = sin(iRot);
    vec2 q = position.xy * iScale;
    vec3 local = iPos + vec3(q.x * c - q.y * s, 0.0, q.x * s + q.y * c);
    // 只有「小於一個浪長」的貼花才跟著浪走。大片的(衝擊波環、油汙)四個角各取一次浪高、
    // 中間線性內插,會嚴重偏離真正的海面而被水面剪掉一半 —— 那就是畫面上那幾塊硬邊黑色多邊形。
    // 大片的一律用固定高度(呼叫端給的 iPos.y 已抬到浪峰之上)。
    float ride = 1.0 - step(110.0, max(iScale.x, iScale.y));
    local.y += oceanHeight(vec2(local.x, -local.z), uTime) * ride;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }`;

export class BillboardField extends Field {
  constructor(texture, max, opts) { super(texture, max, BILLBOARD_VS, opts); }
}

export class FlatField extends Field {
  constructor(texture, max, opts) { super(texture, max, FLAT_VS, opts); }
}
