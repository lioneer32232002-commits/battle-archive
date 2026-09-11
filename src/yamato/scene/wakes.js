// N-2 尾流系統(本場最重要的美術項目)
//
// 舊做法:每艘船掛一片三角形貼圖 plane,轉彎時整片跟著轉,看起來像貼紙。
// 新做法:沿航跡「留」下一串貼水面的白沫四邊形(環形緩衝重用),船轉彎時舊的白沫留在原地,
//         尾跡自然彎曲;另外艦艏兩側各一片艦艏浪、艦艉一片推進器攪動的濃白沫。
// 全部走 FlatField(一個 draw call),同一批也順便畫沉沒油汙與大爆炸的水面衝擊波環。
import * as THREE from 'three';
import { FlatField, makeAtlas, radial } from './gfx.js';

const TILE = { PUFF: 0, STREAK: 1, OIL: 2, RING: 3 };
const Y = 2.5;      // 貼水面高度(FlatField 的頂點著色器會再加上該點的海浪高度)
const Y_BIG = 7.6;  // 大片貼花不跟浪走(見 gfx.js FLAT_VS),固定抬到浪峰之上

function makeSurfaceAtlas() {
  return makeAtlas(256, (g, i, s) => {
    const r = s * 0.5;
    if (i === TILE.PUFF) {
      radial(g, s, [[0, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(233,244,250,0.45)'], [1, 'rgba(220,238,248,0)']]);
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 20; k++) {
        const a = k * 2.399;
        const rad = r * 0.85 * Math.sqrt((k + 1) / 21);
        const gx = r + Math.cos(a) * rad, gy = r + Math.sin(a) * rad;
        const grad = g.createRadialGradient(gx, gy, 0, gx, gy, s * 0.06);
        grad.addColorStop(0, 'rgba(0,0,0,0.45)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      g.globalCompositeOperation = 'source-over';
    } else if (i === TILE.STREAK) {
      // 艦艏浪:沿 x 拉長的楔形白沫(左側寬、右側收尖)
      // 兩端都要淡出:只在 x=1 淡出的話,x=0 那側會在海面上留下一道硬邊,
      // 遠看就是一塊白色長方形(第一版的問題)。
      const grad = g.createLinearGradient(0, 0, s, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.18, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.55, 'rgba(245,252,255,0.42)');
      grad.addColorStop(1, 'rgba(235,248,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, s * 0.34);
      g.quadraticCurveTo(s * 0.55, s * 0.2, s, s * 0.46);
      g.lineTo(s, s * 0.54);
      g.quadraticCurveTo(s * 0.55, s * 0.8, 0, s * 0.66);
      g.closePath();
      g.fill();
    } else if (i === TILE.OIL) {
      radial(g, s, [[0, 'rgba(18,16,14,0.85)'], [0.55, 'rgba(30,26,20,0.55)'], [1, 'rgba(40,36,28,0)']]);
    } else {
      // 衝擊波環:白色細環,內外柔邊
      const grad = g.createRadialGradient(r, r, r * 0.62, r, r, r * 0.98);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export class SurfaceSystem {
  constructor(scene, { mobile = false } = {}) {
    this.perShip = mobile ? 16 : 40;
    this.maxDecals = mobile ? 90 : 260;
    const max = mobile ? 380 : 900;
    this.field = new FlatField(makeSurfaceAtlas(), max, { renderOrder: 2 });
    scene.add(this.field.mesh);
    this.ships = new Map();
    this.decals = [];
    for (let i = 0; i < this.maxDecals; i++) {
      this.decals.push({ on: false, x: 0, z: 0, age: 0, life: 1, r0: 1, r1: 1, alpha: 1, tile: 0, rot: 0, fadeK: 1 });
    }
    this.nextDecal = 0;
    this._spacing = 7.5;
  }

  register(id, beam, length) {
    const puffs = [];
    for (let i = 0; i < this.perShip; i++) puffs.push({ on: false, x: 0, z: 0, age: 0, rot: 0, w0: 1 });
    this.ships.set(id, {
      beam, length, puffs, head: 0, lastX: null, lastZ: null, acc: 0,
      speed: 0, moving: false, active: true, bowRot: 0, bowX: 0, bowZ: 0,
    });
  }

  // 每幀由主迴圈呼叫:x/z 為艦體中心、heading 為航向(北 0 順時針)
  track(id, x, z, heading, dt, alive) {
    const s = this.ships.get(id);
    if (!s) return 0;
    let moved = 0;
    if (s.lastX != null) moved = Math.hypot(x - s.lastX, z - s.lastZ);
    s.lastX = x; s.lastZ = z;
    const inst = dt > 1e-4 ? moved / dt : 0;
    s.speed += (inst - s.speed) * Math.min(1, dt * 2.2);
    s.moving = alive && s.speed > 1.2;
    s.active = alive;
    s.bowRot = heading;
    s.bowX = x; s.bowZ = z;
    if (!s.moving) return s.speed;

    // 依「走過的距離」而非時間發射,轉彎急時密度自然一致
    s.acc += moved;
    while (s.acc > this._spacing) {
      s.acc -= this._spacing;
      const p = s.puffs[s.head];
      s.head = (s.head + 1) % s.puffs.length;
      p.on = true; p.age = 0;
      // 發射點落在艦艉
      p.x = x + Math.sin(heading) * s.length * 0.42;
      p.z = z - Math.cos(heading) * s.length * 0.42;
      p.rot = heading + (Math.random() - 0.5) * 0.25;
      p.w0 = s.beam * (1.7 + Math.random() * 0.4);
    }
    return s.speed;
  }

  stop(id) {
    const s = this.ships.get(id);
    if (s) { s.moving = false; s.active = false; }
  }

  addDecal(x, z, tile, r0, r1, life, alpha, fadeK = 1) {
    const d = this.decals[this.nextDecal];
    this.nextDecal = (this.nextDecal + 1) % this.decals.length;
    d.on = true; d.x = x; d.z = z; d.age = 0; d.life = life;
    d.r0 = r0; d.r1 = r1; d.alpha = alpha; d.tile = tile; d.fadeK = fadeK;
    d.rot = Math.random() * Math.PI;
    return d;
  }

  oil(x, z, size = 60, life = 90) { this.addDecal(x, z, TILE.OIL, size * 0.4, size, life, 0.55, 0.6); }
  ring(x, z, maxR = 900, life = 4.5) { this.addDecal(x, z, TILE.RING, 20, maxR, life, 0.72, 1.6); }

  clear() {
    for (const s of this.ships.values()) {
      for (const p of s.puffs) p.on = false;
      s.acc = 0; s.lastX = null; s.lastZ = null; s.speed = 0;
    }
    for (const d of this.decals) d.on = false;
    this.field.flush(0);
  }

  update(dt) {
    const f = this.field;
    f.uniforms.uTime.value += dt;
    let n = 0;
    const life = 16;
    for (const s of this.ships.values()) {
      for (const p of s.puffs) {
        if (!p.on) continue;
        p.age += dt;
        if (p.age > life) { p.on = false; continue; }
        const t = p.age / life;
        const w = p.w0 * (1 + t * 2.6);
        const a = 0.62 * Math.pow(1 - t, 1.25);
        const y = Math.max(w * 1.5, w) >= 110 ? Y_BIG : Y;
        if (n < f.max) { f.set(n, p.x, y, p.z, w * 1.5, w, p.rot, a, TILE.PUFF, 1, 1, 1); n++; }
      }
      if (s.moving && s.active) {
        const spd = Math.min(1, s.speed / 26);
        const bl = s.length * 0.36;
        const bw = s.beam * (0.5 + spd * 0.5);
        // 艦艏浪:左右各一,楔形沿艦身向後拉
        for (const side of [-1, 1]) {
          const ox = Math.cos(s.bowRot) * side * s.beam * 0.5 - Math.sin(s.bowRot) * bl;
          const oz = Math.sin(s.bowRot) * side * s.beam * 0.5 + Math.cos(s.bowRot) * bl;
          if (n < f.max) {
            const byy = Math.max(s.length * 0.5, bw * 1.5) >= 110 ? Y_BIG : Y;
            f.set(n, s.bowX + ox, byy, s.bowZ + oz, s.length * 0.5, bw * 1.5,
              s.bowRot + Math.PI / 2 + side * 0.16, 0.28 + spd * 0.45, TILE.STREAK, 1, 1, 1);
            n++;
          }
        }
        // 艦艉推進器攪動
        const sx = s.bowX + Math.sin(s.bowRot) * s.length * 0.46;
        const sz = s.bowZ - Math.cos(s.bowRot) * s.length * 0.46;
        if (n < f.max) { f.set(n, sx, Y, sz, s.beam * 1.5, s.beam * 2.2, s.bowRot, 0.3 + spd * 0.4, TILE.PUFF, 1, 1, 1); n++; }
      }
    }
    for (const d of this.decals) {
      if (!d.on) continue;
      d.age += dt;
      if (d.age > d.life) { d.on = false; continue; }
      const t = d.age / d.life;
      const r = d.r0 + (d.r1 - d.r0) * (d.tile === TILE.RING ? Math.pow(t, 0.55) : t);
      const a = d.alpha * Math.pow(1 - t, d.fadeK);
      const big = r * 2 >= 110;
      const dy = big ? Y_BIG : Y + (d.tile === TILE.OIL ? -0.4 : 0.5);
      if (n < f.max) { f.set(n, d.x, dy, d.z, r * 2, r * 2, d.rot, a, d.tile, 1, 1, 1); n++; }
    }
    f.flush(n);
  }
}
