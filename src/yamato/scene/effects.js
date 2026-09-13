// 特效系統:爆炸、火災煙柱、防空曳光、魚雷航跡、俯衝轟炸、墜海水花、大和大爆炸
// 瞬時特效以真實秒數計時;持續狀態(燃燒、沉沒油汙)依單位狀態開關。
//
// 2026-09-12 美術升級(N-7):所有粒子改走共用 ParticlePool(加算池 + 正常池,共 2 個 draw call),
// 水面白沫／油汙／衝擊波環走共用 SurfaceSystem(再 1 個)。舊版每顆火花都是一個 THREE.Sprite,
// 大和大爆炸的蕈狀煙柱在那個架構下畫不出來。
// 對外 API(explosion / divebomb / flak / torpedoRun / launchFlash / dogfight / setBurning /
// update / clearTransients)維持不變,main.js 不需要改呼叫方式。
import * as THREE from 'three';
import { TILE } from './particles.js';

const SMOKE_DARK = [0.05, 0.047, 0.044];   // 線性值:經 ACES + sRGB 後約等於深灰黑
const SMOKE_GREY = [0.155, 0.16, 0.17];
const FOAM_COL = [0.95, 0.97, 1.0];
// 加算池的火光刻意給「超過 1」的線性值:ACES 會把 1.0 壓到約 0.8,不給 HDR 值爆炸就只是橘色貼紙。
// 這些值同時決定 bloom(threshold 0.8)吃不吃得到。
const HOT_FLASH = [3.2, 3.0, 2.6];
const HOT_FIRE = [2.0, 1.05, 0.4];
const HOT_TRACER = [2.4, 2.0, 1.2];
const BLAST_FLASH = [7.0, 6.2, 5.0];
const BLAST_FIRE = [3.2, 1.6, 0.55];

export class Effects {
  // reduced:R5 的 low 也走「手機的粒子量」(this.mobile 在本檔的語意就是「少發一點」)
  constructor(scene, { particles, surface, mobile = false, reduced = false, crashPlanes = null } = {}) {
    this.scene = scene;
    this.p = particles;
    this.surface = surface;
    this.mobile = mobile || reduced;
    this.crashPlanes = crashPlanes; // CrashPlanePool:墜海機的完整 glb 機體(可為 null)
    this.transients = []; // { update(dt) -> false 表結束, dispose() }
    this.fires = new Map(); // unitId -> { obj, acc, age }
    this.sinking = new Map(); // unitId -> { x, z, acc }
    this._v = new THREE.Vector3();
  }

  update(dt) {
    // ⚠️ 不能用 this.transients.filter():許多特效會「在自己的 update 裡再 push 新的 transient」
    //   (俯衝彈道命中後生成爆炸與水柱、空戰週期性生成爆炸與墜機)。filter 的回呼期間 push 進
    //   舊陣列的新元素會連同舊陣列一起被丟掉 —— 那些巢狀特效一個都不會出現。
    //   改成先把陣列換成空的,再逐一 update:回呼期間 push 的新特效直接進新陣列,活得下來。
    const list = this.transients;
    this.transients = [];
    for (const t of list) {
      if (t.update(dt)) this.transients.push(t);
      else t.dispose();
    }
    for (const f of this.fires.values()) this.#updateFire(f, dt);
    for (const s of this.sinking.values()) this.#updateSinking(s, dt);
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    this.p.clear();
    this.surface.clear();
    this.sinking.clear();
    this.crashPlanes?.clear();
  }

  #push(update, dispose) {
    this.transients.push({ update, dispose: dispose || (() => {}) });
  }

  // ── 爆炸 ───────────────────────────────────────────
  explosion(pos, scale = 1) {
    const p = this.p;
    // 閃光:極短、極亮
    p.spawn(true, {
      x: pos.x, y: pos.y, z: pos.z, tile: TILE.GLOW,
      size: 10 * scale, grow: 150 * scale, life: 0.32, alpha: 1, fadeK: 2.2, drag: 0, color: HOT_FLASH,
    });
    // 火球:數顆錯位的火,由橘轉暗
    const n = this.mobile ? 3 : 5;
    for (let i = 0; i < n; i++) {
      p.spawn(true, {
        x: pos.x + (Math.random() - 0.5) * 9 * scale,
        y: pos.y + Math.random() * 7 * scale,
        z: pos.z + (Math.random() - 0.5) * 9 * scale,
        vx: (Math.random() - 0.5) * 14 * scale, vy: 6 + Math.random() * 12 * scale, vz: (Math.random() - 0.5) * 14 * scale,
        tile: TILE.FIRE, size: 7 * scale, grow: 26 * scale, life: 0.7 + Math.random() * 0.7,
        alpha: 0.95, drag: 1.6, fadeK: 1.5, color: HOT_FIRE,
      });
    }
    // 留得下來的煙
    const sn = this.mobile ? 2 : 4;
    for (let i = 0; i < sn; i++) {
      p.spawn(false, {
        x: pos.x + (Math.random() - 0.5) * 12 * scale,
        y: pos.y + 6 * scale + Math.random() * 10 * scale,
        z: pos.z + (Math.random() - 0.5) * 12 * scale,
        vy: 8 + Math.random() * 9, vx: (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6,
        tile: TILE.SMOKE, size: 10 * scale, grow: 4.5 * scale, life: 8 + Math.random() * 4,
        alpha: 0.5, drag: 0.5, wind: 0.7, rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 0.3,
        color: SMOKE_DARK, fadeK: 1.1, fadeIn: 0.4,
      });
    }
  }

  // 落水水柱:白色水花 + 短暫水面漣漪
  splash(x, z, scale = 1) {
    const p = this.p;
    const n = this.mobile ? 5 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (6 + Math.random() * 22) * scale;
      p.spawn(false, {
        x, y: 3, z, vx: Math.cos(a) * sp, vy: (26 + Math.random() * 34) * scale, vz: Math.sin(a) * sp,
        tile: TILE.FOAM, size: 5 * scale, grow: 9 * scale, life: 1.6 + Math.random() * 0.8,
        alpha: 0.85, drag: 0.5, grav: -46, color: FOAM_COL, fadeK: 1.3, floor: 0.5,
      });
    }
    this.surface.addDecal(x, z, 0, 6 * scale, 34 * scale, 3.2, 0.6, 1.2);
  }

  // ── 俯衝轟炸:高空斜落的彈道 + 命中爆炸 / 近失彈水柱 ────
  divebomb(targetObj, count = 3) {
    const tx = targetObj.position.x;
    const tz = targetObj.position.z;
    for (let i = 0; i < count; i++) {
      const hit = i % 3 !== 2; // 三發裡有一發是近失彈,炸起水柱
      const end = new THREE.Vector3(
        tx + (Math.random() - 0.5) * (hit ? 20 : 70),
        hit ? 8 : 1,
        tz + (Math.random() - 0.5) * (hit ? 34 : 80)
      );
      const start = end.clone().add(new THREE.Vector3((Math.random() - 0.5) * 90, 250, (Math.random() - 0.5) * 90));
      let age = -i * 0.55;
      const fall = 0.95;
      let acc = 0;
      let done = false;
      this.#push((dt) => {
        age += dt;
        if (age < 0) return true;
        const f = Math.min(1, age / fall);
        acc += dt;
        if (acc > 0.02 && f < 1) {
          acc = 0;
          const x = start.x + (end.x - start.x) * f;
          const y = start.y + (end.y - start.y) * f;
          const z = start.z + (end.z - start.z) * f;
          this.p.spawn(true, {
            x, y, z, tile: TILE.GLOW, size: 3.2, grow: -1.4, life: 0.32, alpha: 0.75, drag: 0, fadeK: 1.6, color: HOT_TRACER,
          });
        }
        if (f >= 1 && !done) {
          done = true;
          if (hit) this.explosion(end, 1.5);
          else { this.splash(end.x, end.z, 1.5); this.explosion(new THREE.Vector3(end.x, 4, end.z), 0.5); }
        }
        return age < fall + 0.4;
      });
    }
  }

  // ── 防空炮火:曳光彈 + 高空黑色彈幕 ───────────────────
  flak(originObj, duration = 6) {
    let age = 0;
    let acc = 0;
    let burstAcc = 0;
    this.#push((dt) => {
      age += dt;
      if (age >= duration) return age < duration + 0.1;
      acc += dt;
      burstAcc += dt;
      const rate = this.mobile ? 0.09 : 0.045;
      while (acc > rate) {
        acc -= rate;
        const ox = originObj.position.x + (Math.random() - 0.5) * 36;
        const oz = originObj.position.z + (Math.random() - 0.5) * 46;
        this.p.spawn(true, {
          x: ox, y: 12, z: oz,
          vx: (Math.random() - 0.5) * 62, vy: 150 + Math.random() * 90, vz: (Math.random() - 0.5) * 62,
          tile: TILE.GLOW, size: 2.6, grow: 1.2, life: 1.1 + Math.random() * 0.5,
          alpha: 0.95, drag: 0.25, grav: -18, fadeK: 0.9, color: HOT_TRACER,
        });
      }
      if (burstAcc > 0.22) {
        burstAcc = 0;
        const bx = originObj.position.x + (Math.random() - 0.5) * 260;
        const bz = originObj.position.z + (Math.random() - 0.5) * 260;
        const by = 110 + Math.random() * 150;
        this.p.spawn(true, { x: bx, y: by, z: bz, tile: TILE.GLOW, size: 5, grow: 26, life: 0.22, alpha: 1, fadeK: 2, color: HOT_FLASH });
        this.p.spawn(false, {
          x: bx, y: by, z: bz, tile: TILE.SMOKE, size: 8, grow: 3.5, life: 4 + Math.random() * 2.5,
          alpha: 0.6, drag: 0.9, wind: 0.5, color: SMOKE_DARK, rot: Math.random() * 6.28, fadeK: 1.2,
        });
      }
      return true;
    });
  }

  // ── 魚雷航跡:貼水面的白沫直線逼近 ────────────────────
  torpedoRun(targetObj, fromDir, count = 3) {
    for (let i = 0; i < count; i++) {
      const sx = targetObj.position.x + fromDir.x * (300 + Math.random() * 90) + (Math.random() - 0.5) * 60;
      const sz = targetObj.position.z + fromDir.z * (300 + Math.random() * 90) + (Math.random() - 0.5) * 60;
      const ex = targetObj.position.x + (Math.random() - 0.5) * 22;
      const ez = targetObj.position.z + (Math.random() - 0.5) * 22;
      let age = 0;
      const dur = 7;
      let acc = 0;
      let done = false;
      const first = i === 0;
      this.#push((dt) => {
        age += dt;
        const f = Math.min(1, age / dur);
        acc += dt;
        if (acc > 0.14 && f < 1) {
          acc = 0;
          const x = sx + (ex - sx) * f;
          const z = sz + (ez - sz) * f;
          this.surface.addDecal(x, z, 0, 5, 15, 9, 0.7, 1.1);
        }
        if (f >= 1 && !done) {
          done = true;
          if (first) {
            this.explosion(new THREE.Vector3(ex, 5, ez), 1.5);
            this.splash(ex, ez, 2.2);
          }
        }
        return age < dur + 1.2;
      });
    }
  }

  // ── 起飛:甲板上滑出的光點 ────────────────────────────
  launchFlash(originObj) {
    const dirX = -Math.sin(originObj.rotation.y);
    const dirZ = -Math.cos(originObj.rotation.y);
    for (let i = 0; i < 6; i++) {
      let age = -i * 0.45;
      this.#push((dt) => {
        age += dt;
        if (age < 0) return true;
        if (age < 0.05) {
          this.p.spawn(true, {
            x: originObj.position.x, y: 12, z: originObj.position.z,
            vx: dirX * 70, vy: 16, vz: dirZ * 70,
            tile: TILE.GLOW, size: 4, grow: 5, life: 1.8, alpha: 0.9, drag: 0.2, fadeK: 1.3, color: HOT_TRACER,
          });
        }
        return age < 0.1;
      });
    }
  }

  // ── 空戰:高空閃光群 + 偶爾一架拖煙墜海 ─────────────────
  dogfight(pos, duration = 8) {
    let age = 0;
    let acc = 0;
    let crashAcc = 0;
    this.#push((dt) => {
      age += dt;
      acc += dt;
      crashAcc += dt;
      if (age >= duration) return false;
      if (acc > 0.45) {
        acc = 0;
        this.explosion(
          new THREE.Vector3(pos.x + (Math.random() - 0.5) * 150, 70 + Math.random() * 70, pos.z + (Math.random() - 0.5) * 150),
          0.4
        );
      }
      if (crashAcc > 2.4) {
        crashAcc = 0;
        this.planeCrash(
          pos.x + (Math.random() - 0.5) * 260,
          150 + Math.random() * 90,
          pos.z + (Math.random() - 0.5) * 260
        );
      }
      return true;
    });
  }

  // 中彈的飛機:拖黑煙下墜,落水白濺(N-4)
  // 資產接入後多了真正的機體(CrashPlanePool 的完整 glb):翻滾著掉下去,落水即收回池子。
  planeCrash(x, y, z) {
    const vx = (Math.random() - 0.5) * 55;
    const vz = (Math.random() - 0.5) * 55;
    let cy = y;
    let cx = x;
    let cz = z;
    let vy = -18;
    let acc = 0;
    let done = false;
    const plane = this.crashPlanes?.acquire() ?? null;
    const spinX = 1.6 + Math.random() * 2.4;
    const spinZ = (Math.random() - 0.5) * 5;
    const yaw = Math.atan2(vx, -vz);
    let age = 0;
    const releasePlane = () => {
      if (plane) this.crashPlanes?.release(plane);
    };
    this.#push((dt) => {
      if (done) return false;
      vy -= 52 * dt;
      cx += vx * dt; cz += vz * dt; cy += vy * dt;
      acc += dt;
      if (plane) {
        age += dt;
        plane.position.set(cx, cy, cz);
        plane.rotation.y = yaw;
        plane.rotation.x = -age * spinX;
        plane.rotation.z = age * spinZ;
      }
      if (acc > 0.05) {
        acc = 0;
        this.p.spawn(false, {
          x: cx, y: cy, z: cz, tile: TILE.SMOKE, size: 5, grow: 5, life: 4.5,
          alpha: 0.75, drag: 0.7, wind: 0.6, color: SMOKE_DARK, rot: Math.random() * 6.28, fadeK: 1.2,
        });
        this.p.spawn(true, { x: cx, y: cy, z: cz, tile: TILE.FIRE, size: 4, grow: 3, life: 0.5, alpha: 0.8, color: HOT_FIRE });
      }
      if (cy <= 2) {
        done = true;
        this.splash(cx, cz, 1.4);
        this.explosion(new THREE.Vector3(cx, 4, cz), 0.7);
        releasePlane();
        return false;
      }
      return true;
    }, releasePlane);
  }

  // ── 大和大爆炸(全站最重要的單一鏡頭,N-7) ───────────────
  // 閃光 + 直上 400+ 單位的蕈狀煙柱 + 水面衝擊波環 + 四散水柱與碎片
  cataclysm(x, z) {
    const p = this.p;
    // 1) 極亮閃光(配合 main.js 把 exposure 瞬間拉到 1.6)
    p.spawn(true, { x, y: 30, z, tile: TILE.GLOW, size: 40, grow: 1500, life: 0.55, alpha: 1, fadeK: 2.4, color: BLAST_FLASH });
    p.spawn(true, { x, y: 30, z, tile: TILE.GLOW, size: 20, grow: 520, life: 1.1, alpha: 0.9, fadeK: 1.6, color: BLAST_FLASH });
    // 2) 貼海面的巨大火球
    for (let i = 0; i < (this.mobile ? 8 : 18); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 60;
      p.spawn(true, {
        x: x + Math.cos(a) * r, y: 8 + Math.random() * 40, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (20 + Math.random() * 45), vy: 25 + Math.random() * 55, vz: Math.sin(a) * (20 + Math.random() * 45),
        tile: TILE.FIRE, size: 26, grow: 46, life: 1.6 + Math.random() * 1.4, alpha: 1, drag: 1.1, fadeK: 1.3, color: BLAST_FIRE,
      });
    }
    // 3) 水面衝擊波環 + 一圈水柱
    this.surface.ring(x, z, 1250, 5);
    for (let i = 0; i < (this.mobile ? 6 : 14); i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const r = 70 + Math.random() * 80;
      this.splash(x + Math.cos(a) * r, z + Math.sin(a) * r, 1.6);
    }
    this.surface.oil(x, z, 190, 120);
    // 4) 蕈狀煙柱:2.6 秒內持續向上噴,drag 讓煙柱在 400+ 高度堆成傘蓋
    let age = 0;
    let acc = 0;
    this.#push((dt) => {
      age += dt;
      acc += dt;
      const rate = this.mobile ? 0.06 : 0.022;
      while (acc > rate && age < 2.8) {
        acc -= rate;
        const f = age / 2.8;
        const a = Math.random() * Math.PI * 2;
        const r = (8 + Math.random() * 26) * (1 + f * 1.6);   // 柱腳細、越晚越粗
        const up = 190 - f * 55;
        p.spawn(false, {
          x: x + Math.cos(a) * r, y: 14 + Math.random() * 24, z: z + Math.sin(a) * r,
          vx: Math.cos(a) * (5 + f * 26), vy: up, vz: Math.sin(a) * (5 + f * 26),
          tile: TILE.SMOKE, size: 44 + f * 40, grow: 12, life: 15 + Math.random() * 6,
          alpha: 0.72, drag: 0.42, wind: 0.35, color: f < 0.45 ? SMOKE_DARK : SMOKE_GREY,
          rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 0.22, fadeK: 1.05, fadeIn: 0.3,
        });
        if (Math.random() < 0.25) {
          p.spawn(true, {
            x: x + Math.cos(a) * r, y: 14, z: z + Math.sin(a) * r,
            vy: 150, tile: TILE.FIRE, size: 22, grow: 16, life: 1.4, alpha: 0.9, drag: 0.6, color: BLAST_FIRE,
          });
        }
      }
      // 傘蓋:2.8 秒後在頂端補一圈向外攤開的濃煙
      if (age > 1.8 && age < 4.6 && Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        p.spawn(false, {
          x: x + Math.cos(a) * 30, y: 330 + Math.random() * 130, z: z + Math.sin(a) * 30,
          vx: Math.cos(a) * (58 + Math.random() * 40), vy: 14, vz: Math.sin(a) * (58 + Math.random() * 40),
          tile: TILE.SMOKE, size: 115, grow: 10, life: 20, alpha: 0.55, drag: 0.5, wind: 0.4,
          color: SMOKE_GREY, rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 0.15, fadeK: 1.0, fadeIn: 0.6,
        });
      }
      return age < 5;
    });
    // 5) 碎片:拋物線落海
    for (let i = 0; i < (this.mobile ? 8 : 20); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 150;
      p.spawn(true, {
        x, y: 22, z, vx: Math.cos(a) * sp, vy: 120 + Math.random() * 150, vz: Math.sin(a) * sp,
        tile: TILE.FIRE, size: 4, grow: 1.5, life: 4.5, alpha: 0.9, drag: 0.12, grav: -62, fadeK: 0.7, floor: 0, color: HOT_FIRE,
      });
    }
  }

  // ── 持續燃燒(依狀態開關) ────────────────────────────
  setBurning(unitId, obj, burning) {
    if (burning && !this.fires.has(unitId)) {
      this.fires.set(unitId, { obj, acc: 0, glowAcc: 0, age: 0 });
    } else if (!burning && this.fires.has(unitId)) {
      this.fires.delete(unitId);
    }
  }

  #updateFire(f, dt) {
    const o = f.obj;
    f.age += dt;
    f.acc += dt;
    f.glowAcc += dt;
    const rate = this.mobile ? 0.13 : 0.06;
    while (f.acc > rate) {
      f.acc -= rate;
      const ox = o.position.x + (Math.random() - 0.5) * 24;
      const oz = o.position.z + (Math.random() - 0.5) * 44;
      // 火舌
      this.p.spawn(true, {
        x: ox, y: 10 + Math.random() * 6, z: oz, vy: 20 + Math.random() * 18,
        tile: TILE.FIRE, size: 9, grow: 7, life: 0.9 + Math.random() * 0.5, alpha: 0.85, drag: 1.0, fadeK: 1.4, color: [1.6, 0.85, 0.32],
      });
      // 煙柱:黑 → 灰,越高越淡,被風吹斜
      this.p.spawn(false, {
        x: ox, y: 16, z: oz, vy: 26 + Math.random() * 12, vx: (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6,
        tile: TILE.SMOKE, size: 11, grow: 4.2, life: 9 + Math.random() * 5,
        alpha: 0.42, drag: 0.35, wind: 0.85, color: Math.random() < 0.55 ? SMOKE_DARK : SMOKE_GREY,
        rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 0.25, fadeK: 1.05, fadeIn: 0.5,
      });
    }
    // 水面反射的火光
    if (f.glowAcc > 0.4) {
      f.glowAcc = 0;
      this.p.spawn(true, {
        x: o.position.x, y: 3, z: o.position.z, tile: TILE.FIRE,
        size: 56, grow: 6, life: 0.9, alpha: 0.3, drag: 0, fadeK: 1.2, color: [1.4, 0.75, 0.32],
      });
    }
  }

  // ── 沉沒:油汙擴散 + 殘餘火光(N-7) ─────────────────────
  setSinking(unitId, x, z, on) {
    if (on && !this.sinking.has(unitId)) {
      this.sinking.set(unitId, { x, z, acc: 3, age: 0 });
      this.surface.oil(x, z, 70, 100);
    } else if (!on && this.sinking.has(unitId)) {
      this.sinking.delete(unitId);
    }
    const s = this.sinking.get(unitId);
    if (s) { s.x = x; s.z = z; }
  }

  #updateSinking(s, dt) {
    s.age += dt;
    s.acc += dt;
    if (s.acc > 3.5) {
      s.acc = 0;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 45;
      this.surface.oil(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 45 + Math.random() * 55, 80);
      this.p.spawn(false, {
        x: s.x + Math.cos(a) * r, y: 6, z: s.z + Math.sin(a) * r, vy: 14,
        tile: TILE.SMOKE, size: 14, grow: 5, life: 9, alpha: 0.4, drag: 0.4, wind: 0.9,
        color: SMOKE_DARK, rot: Math.random() * 6.28, fadeK: 1.1, fadeIn: 0.5,
      });
    }
  }
}
