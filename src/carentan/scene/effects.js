// 陸戰特效：爆炸、槍火、衝鋒、火砲摧毀、情報揭示、砲兵彈幕、煙幕、持續燃燒
// 瞬時特效以真實秒數計時；持續燃燒依單位狀態開關。沿用 midway 的 transient 框架。
//
// ── L-5 升級（docs/art-upgrade-spec.md）──────────────────────────────
//   爆炸 = 極短閃光 sprite（Additive）＋火球由橘轉暗 ＋ 會留下來的煙（上升、放大、8–12 秒淡出）
//          ＋ 碎屑小方塊拋物線落地。
//   砲擊落地留「焦痕貼花」（深色柔邊圓 plane，貼地 +0.3，持續到 clearTransients）。
//   槍火改成曳光線（細長 Additive 段，沿射向飛 0.15 秒）＋ MG 節奏（0.1 秒一發、6 發後歇 0.6 秒）。
//   煙幕更大更慢、隨風漂。
// 效能：曳光／碎屑／留煙／焦痕全部用「預先建好的物件池」重用，
//   主迴圈內不 new 物件，draw call 也有上限（見 POOL 常數）。
import * as THREE from 'three';

const POOL = { tracer: 28, debris: 56, smoke: 40, decal: 26 };
const WIND = new THREE.Vector3(2.4, 0, -1.2);   // 6 月諾曼第：西南風，煙往東北飄

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
  t.colorSpace = THREE.SRGBColorSpace;   // 當 map 用的 CanvasTexture 一律標 sRGB，否則會過亮糊掉
  return t;
}

// 焦痕貼花：柔邊深色圓，邊緣帶一圈濺土
function scorchTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let grad = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2 - 2);
  grad.addColorStop(0, 'rgba(20,16,13,0.92)');
  grad.addColorStop(0.45, 'rgba(32,26,20,0.62)');
  grad.addColorStop(0.78, 'rgba(74,64,46,0.28)');
  grad.addColorStop(1, 'rgba(74,64,46,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, { mobile = false } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.transients = [];
    this.fires = new Map();
    this.tex = {
      glow: radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)'),
      fire: radialTexture('rgba(255,200,80,1)', 'rgba(255,60,10,0)'),
      smoke: radialTexture('rgba(40,38,36,0.85)', 'rgba(40,38,36,0)'),
      tracer: radialTexture('rgba(255,220,120,1)', 'rgba(255,120,30,0)'),
      flash: radialTexture('rgba(255,206,120,0.95)', 'rgba(255,140,40,0)'),
      reveal: radialTexture('rgba(120,220,255,0.9)', 'rgba(120,220,255,0)'),
      scorch: scorchTexture(),
    };

    const scale = mobile ? 0.5 : 1;
    this.pools = {};
    const root = new THREE.Group();
    root.frustumCulled = false;
    scene.add(root);
    this.root = root;

    // ── 曳光彈：細長 Additive 方條，沿射向飛 ──
    {
      const geo = new THREE.BoxGeometry(0.16, 0.16, 3.4);
      const items = [];
      const n = Math.max(8, Math.round(POOL.tracer * scale));
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        m.visible = false; m.userData = { age: 0, life: 0, v: new THREE.Vector3() };
        root.add(m); items.push(m);
      }
      this.pools.tracer = { items, next: 0 };
    }
    // ── 碎屑：小方塊拋物線落地 ──
    {
      const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const mat = new THREE.MeshLambertMaterial({ color: 0x574c3e });
      const items = [];
      const n = Math.max(16, Math.round(POOL.debris * scale));
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.visible = false; m.userData = { age: 0, life: 0, v: new THREE.Vector3(), spin: new THREE.Vector3() };
        root.add(m); items.push(m);
      }
      this.pools.debris = { items, next: 0 };
    }
    // ── 留煙：上升、放大、8–12 秒淡出 ──
    {
      const items = [];
      const n = Math.max(12, Math.round(POOL.smoke * scale));
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.tex.smoke, color: 0x4a453e, transparent: true, depthWrite: false, opacity: 0,
        }));
        s.visible = false; s.userData = { age: 0, life: 0, r0: 6, rise: 6, op: 0.5 };
        root.add(s); items.push(s);
      }
      this.pools.smoke = { items, next: 0 };
    }
    // ── 焦痕貼花：貼地，持續到 clearTransients ──
    {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const items = [];
      const n = Math.max(10, Math.round(POOL.decal * scale));
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: this.tex.scorch, transparent: true, depthWrite: false, opacity: 0,
        }));
        m.visible = false; m.renderOrder = 2;
        root.add(m); items.push(m);
      }
      this.pools.decal = { items, next: 0 };
    }
  }

  #take(name) {
    const p = this.pools[name];
    const item = p.items[p.next];
    p.next = (p.next + 1) % p.items.length;
    return item;
  }

  // ── 池物件的每幀更新 ────────────────────────────────
  #stepPools(dt) {
    for (const m of this.pools.tracer.items) {
      if (!m.visible) continue;
      const u = m.userData;
      u.age += dt;
      m.position.addScaledVector(u.v, dt);
      m.material.opacity = Math.max(0, 1 - u.age / u.life);
      if (u.age >= u.life) m.visible = false;
    }
    for (const m of this.pools.debris.items) {
      if (!m.visible) continue;
      const u = m.userData;
      u.age += dt;
      u.v.y -= 34 * dt;
      m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;
      if (m.position.y < 0.25) { m.position.y = 0.25; u.v.set(0, 0, 0); }
      if (u.age >= u.life) m.visible = false;
    }
    for (const s of this.pools.smoke.items) {
      if (!s.visible) continue;
      const u = s.userData;
      u.age += dt;
      const f = u.age / u.life;
      s.position.y += u.rise * dt * (1 - f * 0.6);
      s.position.addScaledVector(WIND, dt * (0.5 + f));
      s.scale.setScalar(u.r0 * (1 + f * 3.2));
      s.material.opacity = u.op * Math.min(1, u.age * 3) * Math.max(0, 1 - f) ** 1.4;
      if (u.age >= u.life) s.visible = false;
    }
  }

  update(dt) {
    // ⚠️ 不能用 this.transients.filter()：許多特效會「在自己的 update 裡再 push 新的 transient」
    //   （彈幕逐發生成爆炸、槍火生成槍口焰、爆炸生成火球）。filter 的回呼期間 push 進舊陣列的
    //   新元素，會連同舊陣列一起被指派丟掉 —— 結果就是彈幕整段沒有爆炸。
    //   改成先把陣列換成空的，再逐一 update：回呼期間 push 的新特效直接進到新陣列，活得下來。
    const list = this.transients;
    this.transients = [];
    for (const t of list) {
      if (t.update(dt)) this.transients.push(t);
      else t.dispose();
    }
    this.#stepPools(dt);
    for (const f of this.fires.values()) f.update(dt);
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    for (const key of Object.keys(this.pools)) {
      for (const m of this.pools[key].items) { m.visible = false; if (m.material) m.material.opacity = 0; }
      this.pools[key].next = 0;
    }
  }

  // ── 焦痕貼花（砲擊落地） ─────────────────────────────
  scorch(pos, radius = 7) {
    const m = this.#take('decal');
    m.position.set(pos.x, 0.3, pos.z);
    m.scale.setScalar(radius * (0.85 + Math.random() * 0.4));
    m.rotation.y = Math.random() * Math.PI * 2;
    m.material.opacity = 0.42;   // 彈幕會疊很多層，單張要淡，疊起來才像被犁過的土
    m.visible = true;
  }

  // ── 留煙（爆炸後 8–12 秒才散的煙） ────────────────────
  lingerSmoke(pos, r0 = 6, life = 9) {
    const s = this.#take('smoke');
    s.position.set(pos.x + (Math.random() - 0.5) * 4, pos.y + 1.5, pos.z + (Math.random() - 0.5) * 4);
    s.userData.age = 0;
    s.userData.life = life * (0.8 + Math.random() * 0.5);
    s.userData.r0 = r0 * (0.8 + Math.random() * 0.5);
    s.userData.rise = 4 + Math.random() * 5;
    s.userData.op = 0.38 + Math.random() * 0.2;
    s.scale.setScalar(s.userData.r0);
    s.material.opacity = 0;
    s.visible = true;
  }

  // ── 曳光線（沿射向飛 0.15 秒） ────────────────────────
  tracer(from, dir, speed = 110, life = 0.16) {
    const m = this.#take('tracer');
    m.position.copy(from);
    m.userData.age = 0;
    m.userData.life = life;
    m.userData.v.copy(dir).multiplyScalar(speed);
    m.lookAt(from.x + dir.x, from.y + dir.y, from.z + dir.z);
    m.material.opacity = 1;
    m.visible = true;
  }

  // ── 碎屑（爆炸拋出的小方塊） ──────────────────────────
  debris(pos, n = 12, power = 1) {
    for (let i = 0; i < n; i++) {
      const m = this.#take('debris');
      m.position.set(pos.x, Math.max(pos.y, 1), pos.z);
      const a = Math.random() * Math.PI * 2;
      const sp = (10 + Math.random() * 22) * power;
      m.userData.v.set(Math.cos(a) * sp * 0.7, 14 + Math.random() * 20 * power, Math.sin(a) * sp * 0.7);
      m.userData.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      m.userData.age = 0;
      m.userData.life = 2.6 + Math.random() * 1.6;
      const s = 0.5 + Math.random() * 1.1;
      m.scale.setScalar(s);
      m.visible = true;
    }
  }

  // ── 爆炸：閃光 → 火球 → 留煙 ＋ 碎屑 ─────────────────
  explosion(pos, scale = 1, { linger = true, ground = false } = {}) {
    const group = new THREE.Group();
    group.position.copy(pos);
    // 極短閃光
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flash.scale.setScalar(4 * scale);
    group.add(flash);
    // 火球（橘 → 暗）
    const fire = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.fire, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    fire.scale.setScalar(2 * scale);
    group.add(fire);
    this.scene.add(group);

    if (linger) {
      const n = this.mobile ? 2 : (scale > 1 ? 5 : 3);
      for (let i = 0; i < n; i++) this.lingerSmoke(pos, 5 * scale, 8 + Math.random() * 4);
    }
    this.debris(pos, Math.round((this.mobile ? 6 : 12) * Math.min(2, scale)), Math.min(1.6, scale));
    if (ground && Math.random() > 0.42) this.scorch(pos, 4.6 * scale);

    let age = 0;
    const dur = 1.5;
    this.transients.push({
      update: (dt) => {
        age += dt;
        const f = age / dur;
        flash.scale.setScalar((4 + f * 22) * scale);
        flash.material.opacity = Math.max(0, 1 - f * 7);          // 閃光極短
        fire.scale.setScalar((2 + f * 26) * scale);
        fire.material.opacity = Math.max(0, 1 - f * 1.5);
        fire.material.color.setRGB(1, Math.max(0.25, 1 - f * 1.1), Math.max(0.08, 0.55 - f));  // 橘 → 暗
        return age < dur;
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

  // ── 持續槍火：MG 節奏（0.1 秒一發、6 發後歇 0.6 秒）＋曳光線 ──
  //   dir 可選：射向（由 main.js 依雙方單位相對位置推得）；未給則沿 +x／-x 對射。
  gunfire(pos, duration = 6, dir = null) {
    const axis = (dir ? dir.clone() : new THREE.Vector3(1, 0, 0.35)).setY(0);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const from = new THREE.Vector3();
    const shot = new THREE.Vector3();
    let age = 0, acc = 0, burst = 0, pause = 0, side = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        if (age >= duration) return false;
        if (pause > 0) { pause -= dt; return true; }
        acc += dt;
        if (acc > 0.1) {
          acc = 0;
          side ^= 1;                                   // 兩邊對射
          const sgn = side ? 1 : -1;
          const spread = 0.16;
          shot.set(
            axis.x * sgn + (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * 0.05,
            axis.z * sgn + (Math.random() - 0.5) * spread
          ).normalize();
          from.set(
            pos.x - shot.x * 7 + (Math.random() - 0.5) * 5,
            2.2 + Math.random() * 1.4,
            pos.z - shot.z * 7 + (Math.random() - 0.5) * 5
          );
          this._flash(from, 0.55 + Math.random() * 0.3, 0.06);
          this.tracer(from, shot, 100 + Math.random() * 40, 0.15);
          burst++;
          if (burst >= 6) { burst = 0; pause = 0.45 + Math.random() * 0.3; }
        }
        return true;
      },
      dispose: () => {},
    });
  }

  // ── 衝鋒：密集曳光 + 零星手榴彈爆炸 ─────────────────
  assault(pos, duration = 5, dir = null) {
    const axis = (dir ? dir.clone() : new THREE.Vector3(0, 0, -1)).setY(0);
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, -1);
    axis.normalize();
    const from = new THREE.Vector3();
    const shot = new THREE.Vector3();
    let age = 0, acc = 0, bacc = 0, side = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt; bacc += dt;
        if (acc > 0.09 && age < duration) {
          acc = 0;
          side ^= 1;
          const sgn = side ? 1 : -1;
          shot.set(axis.x * sgn + (Math.random() - 0.5) * 0.4, 0, axis.z * sgn + (Math.random() - 0.5) * 0.4).normalize();
          from.set(
            pos.x - shot.x * 9 + (Math.random() - 0.5) * 14,
            2.3 + Math.random() * 1.8,
            pos.z - shot.z * 9 + (Math.random() - 0.5) * 14
          );
          this._flash(from, 0.7, 0.07);
          this.tracer(from, shot, 95 + Math.random() * 40, 0.15);
        }
        if (bacc > 1.1 && age < duration) {
          bacc = 0;
          this.explosion(
            new THREE.Vector3(pos.x + (Math.random() - 0.5) * 24, 3, pos.z + (Math.random() - 0.5) * 24),
            0.5, { linger: !this.mobile, ground: true }
          );
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 火砲／車輛被摧毀：爆炸 + 上升黑煙柱 ───────────────
  destroy(pos, scale = 1.5) {
    this.explosion(pos.clone().setY(4), scale, { ground: true });
    this.debris(pos, this.mobile ? 8 : 18, 1.4);
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    for (let i = 0; i < (this.mobile ? 6 : 10); i++) {
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
          const f = (s.userData.life % 3) / 3;
          s.position.set(Math.sin(s.userData.life) * 4 + WIND.x * f * 3, 3 + f * 34, Math.cos(s.userData.life * 1.3) * 4 + WIND.z * f * 3);
          s.scale.setScalar(8 + f * 30);
          s.material.opacity = 0.5 * (1 - f) * Math.min(1, age / 1.5);
        }
        return age < 6;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 情報揭示：地面藍環脈衝（情報落差） ────────────────
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

  // ── 夜跳高射砲：曳光彈自地面竄升 ────────────────────
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

  // ── 高空高射砲：沿機群航路的空爆閃光＋黑煙毬＋偶發地面曳光 ──
  flakAir(pos, duration = 20) {
    const group = new THREE.Group();
    this.scene.add(group);
    const parts = [];
    let age = 0, acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.45 && age < duration) {
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
          if (Math.random() > 0.4) {
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

  // ── 砲兵彈幕：beaten zone 內連續爆炸＋揚塵＋焦痕 ──────
  barrage(pos, duration = 16, spreadX = 34, spreadZ = 22) {
    let age = 0, acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.4 && age < duration) {
          acc = 0;
          const ox = pos.x + (Math.random() - 0.5) * spreadX;
          const oz = pos.z + (Math.random() - 0.5) * spreadZ;
          this.explosion(new THREE.Vector3(ox, 3, oz), 0.7 + Math.random() * 0.5, {
            linger: !this.mobile && Math.random() > 0.45, ground: true,
          });
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 煙幕（溫特斯的煙幕彈）：更大更慢、隨風漂 ────────────
  smoke(pos, duration = 12) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    for (let i = 0; i < (this.mobile ? 5 : 10); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, color: 0xcfd2cc, transparent: true, depthWrite: false }));
      s.userData = { life: -i * 0.55, x: (Math.random() - 0.5) * 9, z: (Math.random() - 0.5) * 9 };
      group.add(s); puffs.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of puffs) {
          s.userData.life += dt;
          if (s.userData.life < 0) { s.material.opacity = 0; continue; }
          const f = Math.min(1, s.userData.life / duration);
          s.position.set(
            s.userData.x * (1 + f * 2.4) + WIND.x * s.userData.life * 0.7,
            2 + f * 17,
            s.userData.z * (1 + f * 2.4) + WIND.z * s.userData.life * 0.7
          );
          s.scale.setScalar(8 + f * 34);
          s.material.opacity = 0.6 * (1 - f) * Math.min(1, age / 1.2);
        }
        return age < duration;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 持續燃燒（被摧毀的載具冒火） ──────────────────────
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
    const n = this.mobile ? 10 : 18;
    for (let i = 0; i < n; i++) {
      const isSmoke = i >= Math.round(n * 0.45);
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
            s.position.x += WIND.x * dt * f * 1.4;
            s.position.z += WIND.z * dt * f * 1.4;
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
