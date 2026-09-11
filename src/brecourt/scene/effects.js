// 陸戰特效:爆炸、槍火、衝鋒、火砲摧毀、情報揭示、夜跳高射砲、持續燃燒
// 瞬時特效以真實秒數計時;持續燃燒依單位狀態開關。沿用 midway 的 transient 框架。
//
// L-5 升級(docs/art-upgrade-spec.md §3):
//   爆炸 = 極短閃光 sprite ＋ 火球(橘轉暗) ＋ 會留下來的煙(上升、放大、8–12 秒淡出) ＋ 碎屑拋物線;
//   砲擊落地留焦痕貼花(貼地 +0.3,持續到 clearTransients);
//   槍火改曳光線(環形緩衝重用的細長 Additive 線段,飛 0.15 秒),MG 巢有節奏(0.1 秒一發、0.6 秒間歇);
//   煙幕更大更慢、隨風漂。
// 效能:曳光線與碎屑用共用幾何;手機粒子數減半。
import * as THREE from 'three';

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;   // 當 map 用:畫布內容是 sRGB
  return t;
}

// 煙:柔邊圓 ＋ 幾顆偏移小圓,不是完美圓斑
function smokeTexture() {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let s = 9137;
  const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const puff = (x, y, rad, a) => {
    const grad = g.createRadialGradient(x, y, rad * 0.1, x, y, rad);
    grad.addColorStop(0, `rgba(52,49,45,${a})`);
    grad.addColorStop(0.6, `rgba(52,49,45,${a * 0.45})`);
    grad.addColorStop(1, 'rgba(52,49,45,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  puff(S / 2, S / 2, S * 0.44, 0.8);
  for (let i = 0; i < 7; i++) puff(S * (0.26 + r() * 0.48), S * (0.26 + r() * 0.48), S * (0.10 + r() * 0.18), 0.35 + r() * 0.35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 焦痕貼花:深色柔邊圓 ＋ 不規則濺邊
function scorchTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let s = 4211;
  const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const grad = g.createRadialGradient(S / 2, S / 2, 3, S / 2, S / 2, S * 0.48);
  grad.addColorStop(0, 'rgba(22,18,14,0.92)');
  grad.addColorStop(0.42, 'rgba(38,31,23,0.7)');
  grad.addColorStop(0.75, 'rgba(64,53,38,0.32)');
  grad.addColorStop(1, 'rgba(64,53,38,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {   // 濺出的土
    const a = r() * Math.PI * 2, d = S * (0.24 + r() * 0.24);
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rad = 3 + r() * 8;
    const gg = g.createRadialGradient(x, y, 0.5, x, y, rad);
    gg.addColorStop(0, `rgba(30,25,18,${0.25 + r() * 0.3})`);
    gg.addColorStop(1, 'rgba(30,25,18,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TRACER_POOL = 28;
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const _from = new THREE.Vector3();   // 主迴圈內不 new:射擊起點暫存(呼叫端都會 copy)

export class Effects {
  constructor(scene, { mobile = false } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.transients = [];
    this.fires = new Map();
    this.decals = [];
    this.tex = {
      glow: radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)'),
      fire: radialTexture('rgba(255,200,80,1)', 'rgba(255,60,10,0)'),
      smoke: smokeTexture(),
      tracer: radialTexture('rgba(255,220,120,1)', 'rgba(255,120,30,0)'),
      flash: radialTexture('rgba(255,206,120,0.95)', 'rgba(255,140,40,0)'),
      reveal: radialTexture('rgba(120,220,255,0.9)', 'rgba(120,220,255,0)'),
      scorch: scorchTexture(),
    };

    // ── 曳光線環形緩衝(不在 tick 內 new) ──────────────────
    this.tracerGroup = new THREE.Group();
    this.scene.add(this.tracerGroup);
    const tgeo = new THREE.BoxGeometry(0.22, 0.22, 1);
    this.tracers = [];
    for (let i = 0; i < TRACER_POOL; i++) {
      const m = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      }));
      m.visible = false;
      m.userData = { age: 0, life: 0, v: new THREE.Vector3() };
      this.tracerGroup.add(m);
      this.tracers.push(m);
    }
    this.tracerIdx = 0;

    // 碎屑共用幾何
    this.debrisGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    this.debrisMat = new THREE.MeshLambertMaterial({ color: 0x5b5146 });
  }

  update(dt) {
    // ⚠️ 不能用 this.transients.filter():許多特效會「在自己的 update 裡再 push 新的 transient」
    //   (衝鋒逐發生成手榴彈爆炸、槍火生成槍口焰、MG 節奏、爆炸生成煙與碎屑)。filter 走的是
    //   舊陣列的快照,回呼期間 push 進去的新元素會連同舊陣列一起被丟掉 —— 巢狀特效一個都不會出現。
    //   改成先把陣列換成空的再逐一 update:回呼期間 push 的新特效直接進到新陣列,活得下來。
    const list = this.transients;
    this.transients = [];
    for (const t of list) {
      if (t.update(dt)) this.transients.push(t);
      else t.dispose();
    }
    for (const f of this.fires.values()) f.update(dt);
    // 曳光線
    for (const t of this.tracers) {
      if (!t.visible) continue;
      const u = t.userData;
      u.age += dt;
      if (u.age >= u.life) { t.visible = false; continue; }
      t.position.addScaledVector(u.v, dt);
      t.material.opacity = 1 - u.age / u.life;
    }
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    for (const d of this.decals) { this.scene.remove(d); d.geometry.dispose(); d.material.dispose(); }
    this.decals = [];
    for (const t of this.tracers) { t.visible = false; t.userData.age = t.userData.life; }
  }

  // ── 曳光線(自 from 沿 dir 飛出) ───────────────────────
  _tracer(from, dir, len = 7, speed = 260, life = 0.15) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_POOL;
    t.position.copy(from);
    _look.copy(from).add(dir);
    t.lookAt(_look);                    // Mesh 的 +z 對準飛行方向
    t.scale.set(1, 1, len);
    t.userData.age = 0;
    t.userData.life = life;
    t.userData.v.copy(dir).multiplyScalar(speed);
    t.material.opacity = 1;
    t.visible = true;
  }

  // ── 焦痕貼花(持續到 clearTransients) ─────────────────
  scorch(pos, radius = 7) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: this.tex.scorch, transparent: true, depthWrite: false, opacity: 0.9 })
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    m.position.set(pos.x, 0.3, pos.z);
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 40) {   // 上限,避免長時間播放累積
      const old = this.decals.shift();
      this.scene.remove(old); old.geometry.dispose(); old.material.dispose();
    }
  }

  // ── 爆炸:閃光 ＋ 火球 ＋ 留煙 ＋ 碎屑 ───────────────────
  explosion(pos, scale = 1, { smoke = true, debris = true } = {}) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flash.scale.setScalar(4 * scale);
    group.add(flash);
    const fire = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.fire, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff })
    );
    fire.scale.setScalar(2 * scale);
    group.add(fire);

    // 留下來的煙(3–5 顆,上升放大,8–12 秒淡出)
    const puffs = [];
    if (smoke) {
      const n = this.mobile ? 3 : 5;
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, transparent: true, depthWrite: false, opacity: 0 }));
        s.position.set((Math.random() - 0.5) * 4 * scale, 1 + Math.random() * 2, (Math.random() - 0.5) * 4 * scale);
        s.userData = {
          delay: i * 0.12 + Math.random() * 0.2,
          life: 8 + Math.random() * 4,
          rise: 3 + Math.random() * 4,
          drift: 1.5 + Math.random() * 2.5,
          s0: 5 * scale, s1: (26 + Math.random() * 16) * scale,
        };
        group.add(s); puffs.push(s);
      }
    }

    // 碎屑(拋物線落地)
    const bits = [];
    if (debris) {
      const n = this.mobile ? 8 : 16;
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(this.debrisGeo, this.debrisMat);
        const ks = Math.sqrt(scale);
        b.scale.setScalar((0.5 + Math.random() * 1.3) * ks);
        b.position.set(0, 1, 0);
        const a = Math.random() * Math.PI * 2;
        const sp = (9 + Math.random() * 20) * ks;
        b.userData = {
          v: new THREE.Vector3(Math.cos(a) * sp, (10 + Math.random() * 13) * ks, Math.sin(a) * sp),
          spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
          rest: false,
        };
        group.add(b); bits.push(b);
      }
    }

    let age = 0;
    const flashDur = 0.22 * Math.sqrt(scale);
    const fireDur = 1.5;
    const total = smoke ? 13 : 2;
    this.transients.push({
      update: (dt) => {
        age += dt;
        // 閃光:極短
        const ff = age / flashDur;
        flash.visible = ff < 1;
        if (flash.visible) {
          flash.scale.setScalar((4 + ff * 26) * scale);
          flash.material.opacity = Math.max(0, 1 - ff);
        }
        // 火球:橘轉暗
        const gf = age / fireDur;
        fire.visible = gf < 1;
        if (fire.visible) {
          fire.scale.setScalar((2 + gf * 30) * scale);
          fire.material.opacity = Math.max(0, 1 - gf * 1.15);
          fire.material.color.setRGB(1, 0.72 - gf * 0.45, 0.30 - gf * 0.28);
        }
        // 煙
        for (const s of puffs) {
          const u = s.userData;
          const t = age - u.delay;
          if (t < 0) { s.visible = false; continue; }
          s.visible = true;
          const f = Math.min(1, t / u.life);
          s.position.y += u.rise * dt * (1 - f * 0.6);
          s.position.x += u.drift * dt;
          s.scale.setScalar(u.s0 + (u.s1 - u.s0) * Math.sqrt(f));
          s.material.opacity = 0.62 * Math.min(1, t / 0.5) * (1 - f) * (1 - f);
        }
        // 碎屑
        for (const b of bits) {
          const u = b.userData;
          if (u.rest) continue;
          u.v.y -= 60 * dt;
          b.position.addScaledVector(u.v, dt);
          b.rotation.x += u.spin.x * dt; b.rotation.y += u.spin.y * dt; b.rotation.z += u.spin.z * dt;
          if (b.position.y <= 0.3) { b.position.y = 0.3; u.rest = true; }
        }
        return age < total;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 單發槍口閃光 ───────────────────────────────────
  _flash(pos, scale, life) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    s.position.copy(pos);
    s.scale.setScalar(scale);
    this.scene.add(s);
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        s.material.opacity = Math.max(0, 1 - age / life);
        return age < life;
      },
      dispose: () => this.scene.remove(s),
    });
  }

  // ── 持續槍火(MG 節奏:0.1 秒一發、0.6 秒間歇 ＋ 曳光線) ──
  gunfire(pos, duration = 6, dir = null) {
    const d = _dir.set(dir?.x ?? 1, 0, dir?.z ?? 0);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    d.normalize();
    const dx = d.x, dz = d.z;
    let age = 0, acc = 0;
    const CYCLE = 0.95, BURST = 0.35;   // 0.35 秒點放、其餘間歇
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        const inBurst = (age % CYCLE) < BURST;
        if (inBurst && acc > 0.1 && age < duration) {
          acc = 0;
          const ox = (Math.random() - 0.5) * 10, oz = (Math.random() - 0.5) * 10;
          const from = _from.set(pos.x + ox, 2.4 + Math.random() * 1.2, pos.z + oz);
          this._flash(from, 0.55 + Math.random() * 0.3, 0.06);
          _dir.set(dx + (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.05, dz + (Math.random() - 0.5) * 0.22).normalize();
          this._tracer(from, _dir, 6 + Math.random() * 4);
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 衝鋒:密集槍火 ＋ 零星手榴彈爆炸 ─────────────────
  assault(pos, duration = 5, dir = null) {
    const d = _dir.set(dir?.x ?? 1, 0, dir?.z ?? 0);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    d.normalize();
    const dx = d.x, dz = d.z;
    let age = 0, acc = 0, bacc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt; bacc += dt;
        if (acc > 0.12 && age < duration) {
          acc = 0;
          const from = _from.set(pos.x + (Math.random() - 0.5) * 16, 2.5 + Math.random() * 1.8, pos.z + (Math.random() - 0.5) * 16);
          this._flash(from, 0.7, 0.07);
          _dir.set(dx + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.06, dz + (Math.random() - 0.5) * 0.5).normalize();
          this._tracer(from, _dir, 5 + Math.random() * 4);
        }
        if (bacc > 1.1 && age < duration) {
          bacc = 0;
          const p = _from.set(pos.x + (Math.random() - 0.5) * 24, 2.5, pos.z + (Math.random() - 0.5) * 24);
          this.explosion(p, 0.55, { smoke: !this.mobile, debris: true });
          if (Math.random() > 0.55) this.scorch(p, 4.5);
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 火砲被摧毀:大爆炸 ＋ 焦痕 ＋ 上升黑煙柱 ───────────
  destroy(pos, scale = 1.5) {
    this.explosion(pos.clone().setY(4), scale * 1.35);
    this.scorch(pos, 8 + scale * 2);
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    const n = this.mobile ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.tex.smoke, transparent: true, depthWrite: false })
      );
      s.userData.life = -i * 0.18;
      group.add(s); puffs.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of puffs) {
          s.userData.life += dt;
          if (s.userData.life < 0) { s.material.opacity = 0; continue; }
          const f = (s.userData.life % 3.4) / 3.4;
          s.position.set(Math.sin(s.userData.life) * 4 + f * 6, 3 + f * 38, Math.cos(s.userData.life * 1.3) * 4);
          s.scale.setScalar(9 + f * 34);
          s.material.opacity = 0.55 * (1 - f) * Math.min(1, age / 1.5) * Math.max(0, 1 - age / 9);
        }
        return age < 9;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 煙幕:更大更慢、隨風漂 ─────────────────────────
  smoke(pos, duration = 12) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const parts = [];
    const n = this.mobile ? 7 : 14;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, color: 0xb9b6ae, transparent: true, depthWrite: false, opacity: 0 }));
      s.position.set((Math.random() - 0.5) * 22, 1 + Math.random() * 4, (Math.random() - 0.5) * 22);
      s.userData = { delay: i * 0.22, drift: 2 + Math.random() * 3, rise: 1.6 + Math.random() * 2 };
      group.add(s); parts.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of parts) {
          const t = age - s.userData.delay;
          if (t < 0) { s.visible = false; continue; }
          s.visible = true;
          s.position.x += s.userData.drift * dt;
          s.position.y += s.userData.rise * dt;
          s.scale.setScalar(14 + t * 3.4);
          s.material.opacity = 0.5 * Math.min(1, t / 1.5) * Math.max(0, 1 - t / duration);
        }
        return age < duration + 3;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 情報揭示:地面藍環脈衝(情報落差) ────────────────
  reveal(pos) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2, 4, 40),
      new THREE.MeshBasicMaterial({ map: this.tex.reveal, color: 0x7cd8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(0.6);
    this.scene.add(ring);
    let age = 0;
    const dur = 1.8;
    this.transients.push({
      update: (dt) => {
        age += dt;
        const f = age / dur;
        const r = 4 + f * 70;
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(r - 4, r, 48);
        ring.material.opacity = Math.max(0, 0.9 * (1 - f));
        return age < dur;
      },
      dispose: () => { this.scene.remove(ring); ring.geometry.dispose(); },
    });
  }

  // ── 夜跳高射砲:曳光彈自地面竄升 ────────────────────
  flak(pos, duration = 6) {
    const group = new THREE.Group();
    this.scene.add(group);
    const sprites = [];
    let age = 0, acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.1 && age < duration) {
          acc = 0;
          const s = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: this.tex.tracer, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          s.position.set(pos.x + (Math.random() - 0.5) * 60, 2, pos.z + (Math.random() - 0.5) * 60);
          s.scale.setScalar(2.5);
          s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 40, 120 + Math.random() * 80, (Math.random() - 0.5) * 40);
          s.userData.age = 0;
          group.add(s); sprites.push(s);
        }
        for (const s of sprites) {
          s.userData.age += dt;
          s.position.addScaledVector(s.userData.v, dt);
          if (s.userData.age > 2) s.material.opacity = Math.max(0, s.material.opacity - dt);
        }
        return age < duration + 3;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 夜跳高空高射砲:沿機群航路的空爆閃光＋黑煙毬＋偶發地面曳光 ──
  flakAir(pos, duration = 20) {
    const group = new THREE.Group();
    this.scene.add(group);
    const parts = [];
    let age = 0, acc = 0;
    const period = this.mobile ? 0.75 : 0.45;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > period && age < duration) {
          acc = 0;
          const x = pos.x + (Math.random() - 0.5) * 760;
          const z = pos.z + (Math.random() - 0.5) * 280;
          const y = 70 + Math.random() * 48;
          const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          flash.position.set(x, y, z); flash.scale.setScalar(9); flash.userData = { age: 0 };
          group.add(flash); parts.push(flash);
          const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, transparent: true, depthWrite: false }));
          smoke.position.set(x, y, z); smoke.scale.setScalar(6); smoke.userData = { age: 0, smoke: true };
          group.add(smoke); parts.push(smoke);
          if (Math.random() > 0.4) { // 地面曳光彈竄升
            const tr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.tracer, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            tr.position.set(x + (Math.random() - 0.5) * 140, 2, z + (Math.random() - 0.5) * 90);
            tr.scale.setScalar(3); tr.userData = { age: 0, v: new THREE.Vector3((Math.random() - 0.5) * 24, 150, (Math.random() - 0.5) * 24) };
            group.add(tr); parts.push(tr);
          }
        }
        for (const s of parts) {
          const u = s.userData; u.age += dt;
          if (u.v) { s.position.addScaledVector(u.v, dt); if (u.age > 1.2) s.material.opacity = Math.max(0, s.material.opacity - dt * 1.5); }
          else if (u.smoke) { s.position.y += dt * 4; s.scale.setScalar(6 + u.age * 13); s.material.opacity = Math.max(0, 0.5 - u.age * 0.16); }
          else { s.scale.setScalar(9 + u.age * 9); s.material.opacity = Math.max(0, 1 - u.age * 3); }
        }
        return age < duration + 2;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 持續燃燒(被摧毀的火砲冒火) ──────────────────────
  setBurning(unitId, obj, burning) {
    if (burning && !this.fires.has(unitId)) {
      this.fires.set(unitId, this.#makeFire(obj));
    } else if (!burning && this.fires.has(unitId)) {
      this.fires.get(unitId).dispose();
      this.fires.delete(unitId);
    }
  }

  #makeFire(obj) {
    const group = new THREE.Group();
    this.scene.add(group);
    const parts = [];
    const total = this.mobile ? 10 : 18;
    const fireCount = Math.round(total * 0.45);
    for (let i = 0; i < total; i++) {
      const isSmoke = i >= fireCount;
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: isSmoke ? this.tex.smoke : this.tex.fire,
          transparent: true,
          blending: isSmoke ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      s.userData = { isSmoke, life: Math.random() * (isSmoke ? 5 : 1.2) };
      group.add(s); parts.push(s);
    }
    return {
      update: (dt) => {
        group.position.copy(obj.position);
        for (const s of parts) {
          const d = s.userData;
          d.life += dt;
          const maxLife = d.isSmoke ? 5 : 1.2;
          if (d.life > maxLife) {
            d.life = 0;
            s.position.set((Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6);
          }
          const f = d.life / maxLife;
          if (d.isSmoke) {
            s.position.y += dt * 12;
            s.position.x += dt * 2.5;
            s.scale.setScalar(6 + f * 26);
            s.material.opacity = 0.5 * (1 - f);
          } else {
            s.position.y += dt * 7;
            s.scale.setScalar(4 + f * 7);
            s.material.opacity = 0.9 * (1 - f);
          }
        }
      },
      dispose: () => this.scene.remove(group),
    };
  }
}
