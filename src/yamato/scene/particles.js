// 粒子池(2026-09-12 美術升級):全場的煙、火、閃光、水花、凝結尾共用兩個
// InstancedBufferGeometry 批次 —— 加算混合一個、正常混合一個,合計 2 個 draw call。
// 之前每顆粒子都是 THREE.Sprite(一顆一個 draw call),大爆炸的蕈狀煙柱根本畫不起。
//
// 粒子物件在建構時就全部配置好(free list 重用),主迴圈內不 new(§0-4)。
import * as THREE from 'three';
import { BillboardField, makeAtlas, radial } from './gfx.js';

export const TILE = { GLOW: 0, FIRE: 1, SMOKE: 2, FOAM: 3 };

function makeParticleAtlas() {
  return makeAtlas(256, (g, i, s) => {
    if (i === TILE.GLOW) {
      radial(g, s, [[0, 'rgba(255,248,225,1)'], [0.35, 'rgba(255,214,140,0.75)'], [1, 'rgba(255,150,40,0)']]);
    } else if (i === TILE.FIRE) {
      radial(g, s, [[0, 'rgba(255,236,180,1)'], [0.3, 'rgba(255,176,60,0.9)'], [0.7, 'rgba(214,74,18,0.45)'], [1, 'rgba(120,30,6,0)']]);
    } else if (i === TILE.SMOKE) {
      // 煙:柔邊圓 + 幾團偏心的濃淡,避免看起來像完美圓斑
      radial(g, s, [[0, 'rgba(255,255,255,0.92)'], [0.55, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
      g.globalCompositeOperation = 'destination-out';
      const r = s * 0.5;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.7;
        const gx = r + Math.cos(a) * r * 0.42;
        const gy = r + Math.sin(a) * r * 0.42;
        const gr = r * (0.16 + (k % 3) * 0.05);
        const grad = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grad.addColorStop(0, 'rgba(0,0,0,0.35)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      g.globalCompositeOperation = 'source-over';
    } else {
      // 水沫:白色柔邊 + 顆粒感
      radial(g, s, [[0, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
      const r = s * 0.5;
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 26; k++) {
        const a = k * 2.399;
        const rad = r * 0.9 * Math.sqrt((k + 1) / 27);
        const grad = g.createRadialGradient(r + Math.cos(a) * rad, r + Math.sin(a) * rad, 0, r + Math.cos(a) * rad, r + Math.sin(a) * rad, s * 0.05);
        grad.addColorStop(0, 'rgba(0,0,0,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      g.globalCompositeOperation = 'source-over';
    }
  });
}

let atlas = null;
export function particleAtlas() {
  if (!atlas) atlas = makeParticleAtlas();
  return atlas;
}

function makeSlots(n) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    arr[i] = {
      on: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      drag: 0, grav: 0, wind: 0, size: 1, grow: 0, rot: 0, rotV: 0,
      tile: 0, r: 1, g: 1, b: 1, alpha: 1, fadeIn: 0.05, fadeK: 1.4, floor: null,
    };
  }
  return arr;
}

export class ParticlePool {
  constructor(scene, { addMax = 700, normMax = 900, wind = [7, 0, 2.5] } = {}) {
    const tex = particleAtlas();
    this.add = new BillboardField(tex, addMax, { blending: THREE.AdditiveBlending, renderOrder: 5 });
    this.norm = new BillboardField(tex, normMax, { blending: THREE.NormalBlending, renderOrder: 4 });
    scene.add(this.add.mesh);
    scene.add(this.norm.mesh);
    this.slotsAdd = makeSlots(addMax);
    this.slotsNorm = makeSlots(normMax);
    this.wind = wind;
    this.nextAdd = 0;
    this.nextNorm = 0;
  }

  // additive: true → 加算池(火光、閃光、曳光);false → 正常池(煙、水沫)
  spawn(additive, o) {
    const slots = additive ? this.slotsAdd : this.slotsNorm;
    const n = slots.length;
    let start = additive ? this.nextAdd : this.nextNorm;
    let p = null;
    for (let k = 0; k < n; k++) {
      const s = slots[(start + k) % n];
      if (!s.on) { p = s; start = (start + k + 1) % n; break; }
    }
    if (!p) { p = slots[start % n]; start = (start + 1) % n; } // 池滿:覆蓋最舊的
    if (additive) this.nextAdd = start; else this.nextNorm = start;
    p.on = true; p.age = 0;
    p.life = o.life ?? 1.5;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.drag = o.drag ?? 0.4; p.grav = o.grav ?? 0; p.wind = o.wind ?? 0;
    p.size = o.size ?? 10; p.grow = o.grow ?? 0;
    p.rot = o.rot ?? 0; p.rotV = o.rotV ?? 0;
    p.tile = o.tile ?? TILE.SMOKE;
    const c = o.color;
    if (c) { p.r = c[0]; p.g = c[1]; p.b = c[2]; } else { p.r = 1; p.g = 1; p.b = 1; }
    p.alpha = o.alpha ?? 1;
    p.fadeIn = o.fadeIn ?? 0.06;
    p.fadeK = o.fadeK ?? 1.4;
    p.floor = o.floor ?? null; // 落到此高度即消失(水面濺落)
    return p;
  }

  #step(slots, field, dt) {
    let n = 0;
    const [wx, , wz] = this.wind;
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i];
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; continue; }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx = p.vx * d + wx * p.wind * dt;
      p.vz = p.vz * d + wz * p.wind * dt;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.rotV * dt;
      if (p.floor != null && p.y < p.floor) { p.on = false; continue; }
      const f = p.age / p.life;
      const fin = p.fadeIn > 0 ? Math.min(1, p.age / p.fadeIn) : 1;
      const a = p.alpha * fin * Math.pow(1 - f, p.fadeK);
      const s = p.size + p.grow * p.age;
      field.set(n, p.x, p.y, p.z, s, s, p.rot, a, p.tile, p.r, p.g, p.b);
      n++;
      if (n >= field.max) break;
    }
    field.flush(n);
  }

  update(dt) {
    this.#step(this.slotsAdd, this.add, dt);
    this.#step(this.slotsNorm, this.norm, dt);
  }

  clear() {
    for (const s of this.slotsAdd) s.on = false;
    for (const s of this.slotsNorm) s.on = false;
    this.add.flush(0);
    this.norm.flush(0);
  }
}
