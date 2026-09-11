// 陸戰特效:爆炸、槍火、衝鋒、火砲摧毀、情報揭示、夜跳高射砲、持續燃燒
// 瞬時特效以真實秒數計時;持續燃燒依單位狀態開關。沿用 midway 的 transient 框架。
//
// L-5 特效升級(docs/art-upgrade-spec.md §3):
//   ・爆炸 = 閃光 ＋ 火球 ＋ 會留下來的煙(上升放大、8–12 秒淡出) ＋ 拋物線碎屑(InstancedMesh,1 draw call)
//   ・砲擊落地留焦痕貼花(雪地黑斑):共用一個 InstancedMesh 環形緩衝,總成本 1 draw call,
//     持續到 clearTransients() 才清乾淨(拖曳時間軸不會留殘影)
//   ・槍火改曳光線:細長 Additive 柱體沿射向飛 0.15 秒;MG 有節奏(每 0.1 秒一發、間歇 0.6 秒)
//   ・煙幕更大更慢、隨風漂
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
  return new THREE.CanvasTexture(c);
}

// 焦痕貼花:柔邊不規則黑斑(雪地上的爆點特別明顯)
function scarTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let s = 9182;
  const r = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let z = Math.imul(s ^ (s >>> 15), 1 | s); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const blob = (x, y, rad, a) => {
    const grad = g.createRadialGradient(x, y, rad * 0.1, x, y, rad);
    grad.addColorStop(0, `rgba(18,15,12,${a})`);
    grad.addColorStop(0.6, `rgba(30,26,22,${a * 0.55})`);
    grad.addColorStop(1, 'rgba(30,26,22,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  };
  blob(S / 2, S / 2, S * 0.44, 0.92);
  for (let i = 0; i < 14; i++) {                       // 濺出的不規則邊
    const a = r() * Math.PI * 2, d = S * (0.16 + r() * 0.24);
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.06 + r() * 0.12), 0.5);
  }
  return new THREE.CanvasTexture(c);
}

const _Z = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();

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
      splinter: radialTexture('rgba(126,92,54,1)', 'rgba(84,60,34,0)'),   // 樹爆木屑
      snow: radialTexture('rgba(232,240,248,0.95)', 'rgba(232,240,248,0)'), // 灑落雪塵
      scar: scarTexture(),
    };

    // ── 焦痕貼花池(環形緩衝,1 draw call) ──────────────
    const scarGeo = new THREE.PlaneGeometry(1, 1);
    scarGeo.rotateX(-Math.PI / 2);
    this._scarMax = mobile ? 24 : 56;
    this._scars = new THREE.InstancedMesh(
      scarGeo,
      new THREE.MeshBasicMaterial({ map: this.tex.scar, transparent: true, depthWrite: false, opacity: 0.78 }),
      this._scarMax
    );
    this._scars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._scars.frustumCulled = false;
    this._scars.renderOrder = 1;
    this._scarIdx = 0;
    this._dummy = new THREE.Object3D();
    this._clearScars();
    scene.add(this._scars);

    // ── 曳光線池(預先配置,主迴圈不 new) ────────────────
    const trGeo = new THREE.CylinderGeometry(0.17, 0.17, 1, 4, 1, true);
    trGeo.rotateX(Math.PI / 2);                       // 讓柱體沿 +z
    this._trPool = [];
    this._trIdx = 0;
    for (let i = 0; i < (mobile ? 10 : 20); i++) {
      const m = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this._trPool.push(m);
    }

    // 碎屑共用幾何／材質(每次爆炸一個 InstancedMesh = 1 draw call)
    this._debGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this._debMat = new THREE.MeshLambertMaterial({ color: 0x3b342b });
  }

  update(dt) {
    // 注意:許多特效(gunfire 的槍口閃光／曳光線、barrage 的落點爆炸、assault 的手榴彈)
    // 會在自己的 update 裡再 push 新的 transient。若用 filter 就地過濾,這些「更新中新增」的
    // 項目會被 filter 的長度快照略過、再被回寫的新陣列丟掉 → 物件留在場上永遠不被回收
    // (曳光線池會因此卡在 visible)。改成先換上空陣列,新增自然落進新陣列。
    const list = this.transients;
    this.transients = [];
    for (const t of list) {
      if (t.update(dt)) this.transients.push(t);
      else t.dispose();
    }
    for (const f of this.fires.values()) f.update(dt);
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    for (const m of this._trPool) m.visible = false;   // 曳光線池一律收乾淨
    this._clearScars();
  }

  _clearScars() {
    const d = this._dummy;
    d.position.set(0, -999, 0); d.rotation.set(0, 0, 0); d.scale.set(0, 0, 0); d.updateMatrix();
    for (let i = 0; i < this._scarMax; i++) this._scars.setMatrixAt(i, d.matrix);
    this._scars.instanceMatrix.needsUpdate = true;
    this._scarIdx = 0;
  }

  // 砲擊落地的焦痕（貼地 +0.3，持續到 clearTransients）
  _scar(x, z, size) {
    const d = this._dummy;
    d.position.set(x, 0.3, z);
    d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.set(size, 1, size);
    d.updateMatrix();
    this._scars.setMatrixAt(this._scarIdx, d.matrix);
    this._scars.instanceMatrix.needsUpdate = true;
    this._scarIdx = (this._scarIdx + 1) % this._scarMax;
  }

  // 曳光線:沿 dir 飛出去的細長 Additive 柱體
  _tracer(origin, dir, { len = 10, speed = 460, life = 0.15, color = 0xffd27a } = {}) {
    const m = this._trPool[this._trIdx];
    this._trIdx = (this._trIdx + 1) % this._trPool.length;
    // 池子繞回時,舊的那發若還活著,不能讓它把新的這發關掉 → 用 token 認領
    const token = (m.userData.token = (m.userData.token || 0) + 1);
    m.visible = true;
    m.position.copy(origin);
    m.quaternion.setFromUnitVectors(_Z, dir);
    m.scale.set(1, 1, len);
    m.material.color.setHex(color);
    m.material.opacity = 1;
    let age = 0;
    const d = dir.clone();
    const release = () => { if (m.userData.token === token) m.visible = false; };
    this.transients.push({
      update: (dt) => {
        if (m.userData.token !== token) return false;   // 已被新的一發接手
        age += dt;
        m.position.addScaledVector(d, speed * dt);
        m.material.opacity = Math.max(0, 1 - age / life);
        if (age >= life) { release(); return false; }
        return true;
      },
      dispose: release,
    });
  }

  // 射向啟發式:守線(z 大於 -60)朝北打、佛伊方向的德軍朝南打
  _fireDir(pos, out) {
    const s = pos.z > -60 ? -1 : 1;
    return out.set((Math.random() - 0.5) * 0.55, 0.015 + Math.random() * 0.05, s * (0.86 + Math.random() * 0.2)).normalize();
  }

  // ── 爆炸:閃光＋火球＋留下來的煙＋碎屑＋焦痕 ─────────
  explosion(pos, scale = 1, opts = {}) {
    const nSmoke = opts.smoke ?? (this.mobile ? 2 : 4);
    const nDeb = opts.debris ?? (this.mobile ? 0 : 14);
    const smokeLife = opts.smokeLife ?? (8 + Math.random() * 4);
    const group = new THREE.Group();
    group.position.copy(pos);
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flash.scale.setScalar(4 * scale);
    group.add(flash);
    const fire = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex.fire, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    fire.scale.setScalar(2 * scale);
    group.add(fire);

    // 會留下來的煙:上升、放大、8–12 秒淡出
    const puffs = [];
    for (let i = 0; i < nSmoke; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex.smoke, color: 0x6e6c66, transparent: true, opacity: 0, depthWrite: false,
      }));
      s.userData = {
        delay: i * 0.22,
        x: (Math.random() - 0.5) * 5 * scale, z: (Math.random() - 0.5) * 5 * scale,
        rise: 5 + Math.random() * 5, spin: (Math.random() - 0.5) * 3,
      };
      group.add(s); puffs.push(s);
    }

    // 碎屑:拋物線落地的小方塊(整組一個 InstancedMesh)
    let deb = null, debState = null;
    if (nDeb > 0) {
      deb = new THREE.InstancedMesh(this._debGeo, this._debMat, nDeb);
      deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      deb.frustumCulled = false;
      debState = [];
      for (let i = 0; i < nDeb; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (7 + Math.random() * 22) * scale;
        debState.push({
          p: new THREE.Vector3(0, 0, 0),
          v: new THREE.Vector3(Math.cos(a) * sp, (14 + Math.random() * 20) * scale, Math.sin(a) * sp),
          r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
          w: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
          s: 0.6 + Math.random() * 0.9,
        });
      }
      group.add(deb);
    }

    this.scene.add(group);
    // 焦痕:落地爆炸才留(空爆不留)
    if (opts.scar !== false && pos.y < 8) this._scar(pos.x, pos.z, (5 + Math.random() * 3) * scale);

    const dur = 1.5;
    const total = Math.max(dur, nSmoke ? smokeLife + 0.5 : 0);
    const dummy = this._dummy;
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        if (age < dur) {
          const f = age / dur;
          flash.scale.setScalar((4 + f * 22) * scale);
          flash.material.opacity = Math.max(0, 1 - f * 2.2);
          fire.scale.setScalar((2 + f * 30) * scale);
          fire.material.opacity = Math.max(0, 1 - f * 1.3);
        } else if (flash.visible) { flash.visible = false; fire.visible = false; }
        for (const s of puffs) {
          const u = s.userData;
          const la = age - u.delay;
          if (la < 0) continue;
          const f = Math.min(1, la / smokeLife);
          s.position.set(u.x + u.spin * la, 1.5 + la * u.rise * (1 - f * 0.55), u.z + la * 1.6);
          s.scale.setScalar((5 + f * 30) * scale);
          s.material.opacity = 0.38 * Math.min(1, la * 2) * (1 - f) * (1 - f);
        }
        if (deb) {
          for (let i = 0; i < debState.length; i++) {
            const d = debState[i];
            if (d.p.y > 0 || d.v.y > 0) {
              d.v.y -= 34 * dt;
              d.p.addScaledVector(d.v, dt);
              d.r.addScaledVector(d.w, dt);
              if (d.p.y < 0) { d.p.y = 0; d.v.set(0, 0, 0); d.w.set(0, 0, 0); }
            }
            dummy.position.copy(d.p);
            dummy.rotation.set(d.r.x, d.r.y, d.r.z);
            dummy.scale.setScalar(d.s * scale);
            dummy.updateMatrix();
            deb.setMatrixAt(i, dummy.matrix);
          }
          deb.instanceMatrix.needsUpdate = true;
        }
        return age < total;
      },
      dispose: () => { this.scene.remove(group); if (deb) deb.dispose(); },
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

  // ── 持續槍火(機槍/步槍對射) ─────────────────────────
  // MG 節奏:一個 5 發點放(每 0.1 秒一發)後停 0.6 秒,再來一次。每發＝槍口閃光＋曳光線。
  gunfire(pos, duration = 6) {
    let age = 0, acc = 0, inBurst = true, shots = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        const gate = inBurst ? 0.1 : 0.6;
        if (acc > gate && age < duration) {
          acc = 0;
          if (!inBurst) { inBurst = true; shots = 0; }
          const ox = pos.x + (Math.random() - 0.5) * 10;
          const oy = 2.4 + Math.random() * 1.6;
          const oz = pos.z + (Math.random() - 0.5) * 10;
          _tmpPos.set(ox, oy, oz);
          this._flash(_tmpPos, 0.5 + Math.random() * 0.35, 0.07);
          this._tracer(_tmpPos, this._fireDir(pos, _dir), { len: 9 + Math.random() * 5 });
          if (++shots >= 5) inBurst = false;
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 衝鋒:密集槍火 + 零星手榴彈爆炸 ─────────────────
  assault(pos, duration = 5) {
    let age = 0, acc = 0, bacc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt; bacc += dt;
        if (acc > 0.15 && age < duration) {
          acc = 0;
          _tmpPos.set(pos.x + (Math.random() - 0.5) * 16, 2.5 + Math.random() * 2.2, pos.z + (Math.random() - 0.5) * 16);
          this._flash(_tmpPos, 0.7, 0.08);
          if (Math.random() > 0.35) this._tracer(_tmpPos, this._fireDir(pos, _dir), { len: 8 + Math.random() * 6 });
        }
        if (bacc > 1.1 && age < duration) {
          bacc = 0;
          this.explosion(
            new THREE.Vector3(pos.x + (Math.random() - 0.5) * 24, 3, pos.z + (Math.random() - 0.5) * 24),
            0.5, { smoke: 1, debris: this.mobile ? 0 : 6, smokeLife: 6 }
          );
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 火砲被摧毀:爆炸 + 上升黑煙柱 ───────────────────
  destroy(pos, scale = 1.5) {
    this.explosion(pos.clone().setY(4), scale);
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    for (let i = 0; i < 10; i++) {
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
          s.position.set(Math.sin(s.userData.life) * 4, 3 + f * 34, Math.cos(s.userData.life * 1.3) * 4);
          s.scale.setScalar(8 + f * 30);
          s.material.opacity = 0.5 * (1 - f) * Math.min(1, age / 1.5);
        }
        return age < 6;
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

  // ── 砲兵彈幕：beaten zone 內連續爆炸＋揚塵（英聯邦砲兵／德軍反砲擊） ──
  barrage(pos, duration = 16, spreadX = 34, spreadZ = 22) {
    let age = 0, acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.4 && age < duration) {
          acc = 0;
          const ox = pos.x + (Math.random() - 0.5) * spreadX;
          const oz = pos.z + (Math.random() - 0.5) * spreadZ;
          // 彈幕落點很密,每發只留 1 團煙、少量碎屑,避免 sprite 爆量
          this.explosion(new THREE.Vector3(ox, 3, oz), 0.7 + Math.random() * 0.5,
            { smoke: 1, debris: this.mobile ? 0 : 6, smokeLife: 7 });
          // 揚塵柱
          const dust = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, transparent: true, depthWrite: false }));
          dust.position.set(ox, 3, oz); dust.scale.setScalar(7); dust.userData = { age: 0 };
          this.scene.add(dust);
          let da = 0;
          this.transients.push({
            update: (d2) => { da += d2; dust.position.y += d2 * 9; dust.scale.setScalar(7 + da * 11); dust.material.opacity = Math.max(0, 0.55 - da * 0.18); return da < 3; },
            dispose: () => this.scene.remove(dust),
          });
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 煙幕（溫特斯的煙幕彈：灰白煙幕升起、擴散） ─────────────
  smoke(pos, duration = 12) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.smoke, color: 0xcfd2cc, transparent: true, depthWrite: false }));
      s.userData = { life: -i * 0.5, x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
      group.add(s); puffs.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of puffs) {
          s.userData.life += dt;
          if (s.userData.life < 0) { s.material.opacity = 0; continue; }
          // 更大更慢、隨風(＋x)漂
          const f = Math.min(1, s.userData.life / duration);
          s.position.set(
            s.userData.x * (1 + f * 2.4) + s.userData.life * 3.4,
            2 + f * 17,
            s.userData.z * (1 + f * 2.4) + s.userData.life * 0.9
          );
          s.scale.setScalar(9 + f * 38);
          s.material.opacity = 0.55 * (1 - f) * Math.min(1, age / 1.2);
        }
        return age < duration;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 樹頂空爆(阿登招牌):樹冠高度空炸,閃光＋放射狀木屑線條＋向下灑落的雪塵 ──
  treeburst(pos, burstY = 20) {
    const center = new THREE.Vector3(pos.x, burstY, pos.z);
    // 樹冠處的空爆閃光火球(空爆不留焦痕;碎屑由下方木屑接手)
    this.explosion(center, 1.15, { debris: 0, smoke: 3, smokeLife: 7 });
    this._scar(pos.x, pos.z, 7 + Math.random() * 4);   // 樹下雪面被燻黑／灑滿木屑
    const group = new THREE.Group();
    this.scene.add(group);
    const parts = [];
    // 放射狀木屑:向外＋向下拋灑的細長碎片
    const n = 22;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.splinter, transparent: true, depthWrite: false }));
      s.position.copy(center);
      s.scale.set(2.6, 0.42, 1);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 16 + Math.random() * 26;
      s.userData = { v: new THREE.Vector3(Math.cos(a) * speed, -5 - Math.random() * 12, Math.sin(a) * speed), age: 0, splinter: true };
      group.add(s); parts.push(s);
    }
    // 自樹冠向下灑落的雪塵團
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.snow, transparent: true, depthWrite: false }));
      s.position.set(center.x + (Math.random() - 0.5) * 8, center.y - Math.random() * 4, center.z + (Math.random() - 0.5) * 8);
      s.scale.setScalar(4 + Math.random() * 4);
      s.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 4, -9 - Math.random() * 8, (Math.random() - 0.5) * 4), age: 0, snow: true };
      group.add(s); parts.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of parts) {
          const u = s.userData; u.age += dt;
          s.position.addScaledVector(u.v, dt);
          u.v.y -= 26 * dt; // 重力
          if (s.position.y < 0.4) { s.position.y = 0.4; u.v.set(0, 0, 0); }
          if (u.splinter) {
            s.material.rotation = Math.atan2(u.v.y, Math.hypot(u.v.x, u.v.z) || 0.001);
            s.material.opacity = Math.max(0, 1 - u.age * 0.7);
          } else {
            s.scale.setScalar(4 + u.age * 6);
            s.material.opacity = Math.max(0, 0.7 - u.age * 0.42);
          }
        }
        return age < 2.4;
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
    for (let i = 0; i < 18; i++) {
      const isSmoke = i >= 8;
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
