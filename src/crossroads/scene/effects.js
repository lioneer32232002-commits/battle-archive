// 陸戰特效:爆炸、槍火、衝鋒、火砲摧毀、情報揭示、夜跳高射砲、持續燃燒
// 瞬時特效以真實秒數計時;持續燃燒依單位狀態開關。沿用 midway 的 transient 框架。
//
// L-5 升級(docs/art-upgrade-spec.md §3):對外 API 名稱與參數全部不變,內部升級 ——
//   ・爆炸 = 極短閃光 sprite ＋ 火球(橘→暗) ＋ 會留下來的煙(上升放大、8–12 秒淡出)
//           ＋ 碎屑(InstancedMesh 小方塊,拋物線落地,整批只佔 1 個 draw call)
//   ・砲擊落地留焦痕貼花(InstancedMesh 貼花池,貼地 +0.32,持續到 clearTransients)
//   ・槍火 = 曳光線(沿射向飛約 0.17 秒的細長 Additive 線段)取代單純閃點;
//           節奏化點放(每 0.1 秒一發、五發一串、間歇 0.55 秒),
//           射向沿堤(+x)—— 這場的招牌就是基底火力沿堤縱射(enfilade)
//   ・煙幕更大更慢、隨風漂
// 所有 transient 都掛在 this.transients,拖曳時間軸的 clearTransients() 會一併清乾淨。
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
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 焦痕貼花:柔邊深色圓
function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  grad.addColorStop(0, 'rgba(18,15,12,0.86)');
  grad.addColorStop(0.45, 'rgba(30,25,19,0.55)');
  grad.addColorStop(0.78, 'rgba(48,42,30,0.22)');
  grad.addColorStop(1, 'rgba(48,42,30,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SCORCH_MAX = 28;
const _FWD = new THREE.Vector3(0, 0, 1);

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
    };

    // 主迴圈衛生:曳光線／碎屑共用幾何與材質,不在 tick 內 new 材質
    this._dummy = new THREE.Object3D();
    this._v = new THREE.Vector3();
    this._tracerGeo = new THREE.BoxGeometry(0.34, 0.34, 5.2);
    this._tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this._debrisGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    this._debrisMat = new THREE.MeshLambertMaterial({ color: 0x3b352a });

    // 焦痕貼花池(單一 InstancedMesh = 1 draw call;環形重用)
    const decal = new THREE.PlaneGeometry(1, 1);
    decal.rotateX(-Math.PI / 2);
    this._scorchMesh = new THREE.InstancedMesh(
      decal,
      new THREE.MeshBasicMaterial({
        map: scorchTexture(), transparent: true, opacity: 0.92,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }),
      SCORCH_MAX
    );
    this._scorchMesh.frustumCulled = false;
    this._scorchMesh.renderOrder = 1;
    this._scorchN = 0;
    this._clearScorch();
    scene.add(this._scorchMesh);
  }

  _clearScorch() {
    const d = this._dummy;
    d.position.set(0, -9999, 0); d.rotation.set(0, 0, 0); d.scale.setScalar(0.0001);
    d.updateMatrix();
    for (let i = 0; i < SCORCH_MAX; i++) this._scorchMesh.setMatrixAt(i, d.matrix);
    this._scorchMesh.instanceMatrix.needsUpdate = true;
    this._scorchN = 0;
  }

  // 砲擊落地的焦痕貼花(貼地 +0.32,持續到 clearTransients)
  scorch(pos, radius = 7) {
    const d = this._dummy;
    d.position.set(pos.x, 0.32, pos.z);
    d.rotation.set(0, Math.random() * Math.PI, 0);
    d.scale.set(radius, 1, radius);
    d.updateMatrix();
    this._scorchMesh.setMatrixAt(this._scorchN % SCORCH_MAX, d.matrix);
    this._scorchMesh.instanceMatrix.needsUpdate = true;
    this._scorchN++;
  }

  // 曳光線:自 from 沿方向飛,約 0.17 秒後消失
  _tracer(from, to, spread = 0) {
    const m = new THREE.Mesh(this._tracerGeo, this._tracerMat);
    const dir = this._v.copy(to).sub(from);
    if (spread) { dir.x += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread; }
    const len = dir.length() || 1;
    dir.multiplyScalar(1 / len);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(_FWD, dir);
    this.scene.add(m);
    const vel = dir.clone().multiplyScalar(len / 0.17);
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        m.position.addScaledVector(vel, dt);
        return age < 0.17;
      },
      dispose: () => this.scene.remove(m),
    });
  }

  // 會留下來的煙:上升、放大、8–12 秒淡出
  _lingeringSmoke(pos, n, scale = 1) {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex.smoke, color: 0x6b6356, transparent: true, depthWrite: false,
      }));
      s.userData = {
        life: -i * 0.35,
        x: (Math.random() - 0.5) * 6 * scale,
        z: (Math.random() - 0.5) * 6 * scale,
        rise: 4 + Math.random() * 4,
        dur: 8 + Math.random() * 4,
      };
      group.add(s); puffs.push(s);
    }
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of puffs) {
          const u = s.userData;
          u.life += dt;
          if (u.life < 0) { s.material.opacity = 0; continue; }
          const f = Math.min(1, u.life / u.dur);
          s.position.set(u.x + u.life * 1.6, 2 + u.life * u.rise, u.z + u.life * 0.5);
          s.scale.setScalar((5 + f * 30) * scale);
          s.material.opacity = 0.5 * (1 - f) * (1 - f * 0.3);
        }
        return age < 13;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // 碎屑:小方塊拋物線落地(整批共用一個 InstancedMesh → 1 draw call)
  _debris(pos, n, scale = 1) {
    const im = new THREE.InstancedMesh(this._debrisGeo, this._debrisMat, n);
    im.frustumCulled = false;
    this.scene.add(im);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (6 + Math.random() * 18) * scale;
      parts.push({
        p: new THREE.Vector3(pos.x, pos.y, pos.z),
        v: new THREE.Vector3(Math.cos(a) * sp, 10 + Math.random() * 16, Math.sin(a) * sp),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        s: (0.6 + Math.random() * 1.1) * scale,
      });
    }
    const d = this._dummy;
    let age = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (let i = 0; i < parts.length; i++) {
          const q = parts[i];
          q.v.y -= 30 * dt;
          q.p.addScaledVector(q.v, dt);
          if (q.p.y < 0.3) { q.p.y = 0.3; q.v.set(0, 0, 0); }
          else { q.r.x += dt * 5; q.r.z += dt * 4; }
          d.position.copy(q.p); d.rotation.set(q.r.x, q.r.y, q.r.z);
          d.scale.setScalar(q.s * Math.max(0, 1 - Math.max(0, age - 2.4) / 0.8));
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        return age < 3.2;
      },
      dispose: () => { this.scene.remove(im); im.dispose(); },
    });
  }

  update(dt) {
    // ⚠️ 不能用 this.transients.filter():許多特效會「在自己的 update 裡再 push 新的 transient」
    //   (彈幕逐發生成爆炸、槍火生成槍口焰與曳光、爆炸生成煙與碎屑)。filter 會把回呼期間
    //   push 進舊陣列的新元素連同舊陣列一起丟掉 —— 結果就是這些巢狀特效一個都沒出現。
    //   改成先把陣列換成空的,再逐一 update:回呼期間 push 的新特效直接進到新陣列,活得下來。
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
    this._clearScorch();   // 焦痕貼花也一併清掉(拖曳時間軸不留殘影)
  }

  // ── 爆炸(L-5:閃光＋火球轉暗＋留煙＋碎屑) ──────────────
  explosion(pos, scale = 1, { smoke = true, debris = true } = {}) {
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
    this.scene.add(group);
    const fireCol = fire.material.color;
    let age = 0;
    const dur = 1.5;
    this.transients.push({
      update: (dt) => {
        age += dt;
        const f = age / dur;
        flash.scale.setScalar((4 + f * 26) * scale);
        flash.material.opacity = Math.max(0, 1 - f * 3.4);   // 閃光極短
        fire.scale.setScalar((2 + f * 30) * scale);
        fire.material.opacity = Math.max(0, 1 - f * 1.3);
        fireCol.setRGB(1, Math.max(0.28, 1 - f * 0.9), Math.max(0.1, 1 - f * 1.6)); // 橘 → 暗紅
        return age < dur;
      },
      dispose: () => this.scene.remove(group),
    });
    const half = this.mobile ? 0.5 : 1;
    if (smoke) this._lingeringSmoke(pos, Math.max(2, Math.round((3 + Math.random() * 2) * half)), scale);
    if (debris) this._debris(pos, Math.max(6, Math.round((12 + Math.random() * 8) * half)), scale);
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

  // ── 持續槍火(L-5:節奏化點放＋沿堤縱射的曳光線) ─────────
  // 射向刻意取 +x(沿堤向東)—— 這場的招牌就是基底火力沿堤縱射,
  // 曳光自西側的火力位置掠過堤面打到目標上。
  gunfire(pos, duration = 6) {
    let age = 0, acc = 0, burst = 0;
    const GAP = 0.1, PAUSE = 0.55, BURST = 5;   // 每 0.1 秒一發、五發一串、間歇 0.55 秒
    const to = new THREE.Vector3();
    const from = new THREE.Vector3();
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        const wait = burst >= BURST ? PAUSE : GAP;
        if (acc > wait && age < duration) {
          acc = 0;
          if (burst >= BURST) burst = 0;
          burst++;
          to.set(pos.x + (Math.random() - 0.5) * 9, 2.2 + Math.random() * 1.4, pos.z + (Math.random() - 0.5) * 9);
          from.set(to.x - 26 - Math.random() * 16, to.y + 0.5, to.z + (Math.random() - 0.5) * 5);
          this._flash(from, 0.7 + Math.random() * 0.4, 0.06);   // 槍口焰
          this._tracer(from, to, 1.5);                          // 曳光線
          if (Math.random() > 0.55) this._flash(to, 0.4, 0.05); // 彈著火星
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
        if (acc > 0.12 && age < duration) {
          acc = 0;
          const a = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 16, 2.5 + Math.random() * 2.2, pos.z + (Math.random() - 0.5) * 16);
          this._flash(a, 0.7, 0.08);
          // 近戰亂射:曳光四散
          const ang = Math.random() * Math.PI * 2;
          this._tracer(a, new THREE.Vector3(a.x + Math.cos(ang) * 24, a.y - 0.4, a.z + Math.sin(ang) * 24), 0);
        }
        if (bacc > 1.1 && age < duration) {
          bacc = 0;
          const gp = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 24, 3, pos.z + (Math.random() - 0.5) * 24);
          this.explosion(gp, 0.5, { smoke: false });   // 手榴彈:不留長煙
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 火砲被摧毀:爆炸 + 上升黑煙柱 ───────────────────
  destroy(pos, scale = 1.5) {
    this.explosion(pos.clone().setY(4), scale);
    this.scorch(pos, 8 + scale * 2);
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
    let age = 0, acc = 0, n = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.4 && age < duration) {
          acc = 0;
          const ox = pos.x + (Math.random() - 0.5) * spreadX;
          const oz = pos.z + (Math.random() - 0.5) * spreadZ;
          const sc = 0.7 + Math.random() * 0.5;
          n++;
          this.explosion(new THREE.Vector3(ox, 3, oz), sc, { smoke: n % 3 === 0 });
          this.scorch(new THREE.Vector3(ox, 0, oz), 6 + sc * 5);   // L-5：彈著焦痕貼花
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
          const f = Math.min(1, s.userData.life / duration);
          // L-5：更大更慢，並隨風（+x，沿堤）漂
          s.position.set(s.userData.x * (1 + f * 2.4) + f * 26, 2 + f * 11, s.userData.z * (1 + f * 2.4) + f * 5);
          s.scale.setScalar(9 + f * 40);
          s.material.opacity = 0.62 * (1 - f * 0.85) * Math.min(1, age / 1.2);
        }
        return age < duration;
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
