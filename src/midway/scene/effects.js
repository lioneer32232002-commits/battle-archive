// 特效系統:爆炸、火焰黑煙、防空曳光彈、魚雷航跡、俯衝轟炸彈道
// 瞬時特效以真實秒數計時;持續狀態(燃燒)依單位狀態開關
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
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;   // 當 map 用的 CanvasTexture 一律標 sRGB
  return tex;
}

export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.mobile = !!opts.mobile;
    this.transients = []; // { update(dt) -> false 表結束, dispose() }
    this.fires = new Map(); // unitId -> fire emitter
    this.sinks = new Map(); // unitId -> 沉沒油汙/火光(N-7)
    this.tex = {
      glow: radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)'),
      fire: radialTexture('rgba(255,200,80,1)', 'rgba(255,60,10,0)'),
      smoke: radialTexture('rgba(40,38,36,0.85)', 'rgba(40,38,36,0)'),
      puff: radialTexture('rgba(60,60,60,0.9)', 'rgba(60,60,60,0)'),
      tracer: radialTexture('rgba(255,220,120,1)', 'rgba(255,120,30,0)'),
      foam: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
      oil: radialTexture('rgba(18,16,14,0.72)', 'rgba(24,22,18,0)'),
      darkSmoke: radialTexture('rgba(22,20,19,0.92)', 'rgba(30,28,26,0)'),
    };
    // N-7 油汙貼花共用幾何(圓 plane,貼水面)
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
  }

  update(dt) {
    // ⚠️ 不能用 this.transients.filter():許多特效會「在自己的 update 裡再 push 新的 transient」
    //   (俯衝轟炸落地生爆炸、魚雷命中生爆炸、空戰持續生小爆炸)。filter 會把回呼期間
    //   push 進舊陣列的新元素連同舊陣列一起丟掉 —— 結果就是這些巢狀特效一個都沒出現。
    //   改成先把陣列換成空的,再逐一 update:回呼期間 push 的新特效直接進到新陣列,活得下來。
    const list = this.transients;
    this.transients = [];
    for (const t of list) {
      if (t.update(dt)) this.transients.push(t);
      else t.dispose();
    }
    for (const f of this.fires.values()) f.update(dt);
    for (const s of this.sinks.values()) s.update(dt);
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    for (const s of this.sinks.values()) s.dispose();
    this.sinks.clear();
  }

  // ── 爆炸 ───────────────────────────────────────────
  explosion(pos, scale = 1) {
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

    let age = 0;
    const dur = 1.6;
    this.transients.push({
      update: (dt) => {
        age += dt;
        const f = age / dur;
        flash.scale.setScalar((4 + f * 30) * scale);
        flash.material.opacity = Math.max(0, 1 - f * 2.2);
        fire.scale.setScalar((2 + f * 42) * scale);
        fire.material.opacity = Math.max(0, 1 - f * 1.3);
        return age < dur;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 俯衝轟炸:自高空斜射的彈道線 + 連續爆炸 ────────────
  divebomb(targetObj, count = 3) {
    for (let i = 0; i < count; i++) {
      const delay = i * 0.7;
      const target = targetObj.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 18, 6, (Math.random() - 0.5) * 30));
      const start = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 80, 230, (Math.random() - 0.5) * 80));
      const geo = new THREE.BufferGeometry().setFromPoints([start, start.clone()]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.9 })
      );
      this.scene.add(line);
      let age = 0;
      const fall = 0.9;
      let exploded = false;
      this.transients.push({
        update: (dt) => {
          age += dt;
          if (age < delay) return true;
          const f = Math.min(1, (age - delay) / fall);
          const head = start.clone().lerp(target, f);
          const tail = start.clone().lerp(target, Math.max(0, f - 0.25));
          geo.setFromPoints([tail, head]);
          if (f >= 1 && !exploded) {
            exploded = true;
            this.explosion(target, 1.4);
          }
          return age < delay + fall + 0.1;
        },
        dispose: () => {
          this.scene.remove(line);
          geo.dispose();
        },
      });
    }
  }

  // ── 防空炮火:曳光彈 + 高空黑色彈幕 ───────────────────
  flak(originObj, duration = 6) {
    const sprites = [];
    const group = new THREE.Group();
    this.scene.add(group);
    let age = 0;
    let spawnAcc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        spawnAcc += dt;
        if (age < duration && spawnAcc > 0.08) {
          spawnAcc = 0;
          const s = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: this.tex.tracer, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          s.position.copy(originObj.position).add(new THREE.Vector3((Math.random() - 0.5) * 30, 8, (Math.random() - 0.5) * 30));
          s.scale.setScalar(2.5);
          s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 70, 90 + Math.random() * 60, (Math.random() - 0.5) * 70);
          s.userData.age = 0;
          group.add(s);
          sprites.push(s);
        }
        for (const s of sprites) {
          s.userData.age += dt;
          s.position.addScaledVector(s.userData.v, dt);
          if (s.userData.age > 1.6 && s.material.map !== this.tex.puff) {
            s.material = new THREE.SpriteMaterial({ map: this.tex.puff, transparent: true, opacity: 0.7, depthWrite: false });
            s.scale.setScalar(6);
            s.userData.v.set(0, 2, 0);
          }
          if (s.userData.age > 3.2) s.material.opacity = Math.max(0, s.material.opacity - dt);
        }
        return age < duration + 4;
      },
      dispose: () => this.scene.remove(group),
    });
  }

  // ── 魚雷航跡:白色尾跡直線逼近 ────────────────────────
  torpedoRun(targetObj, fromDir, count = 3) {
    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 50);
      const start = targetObj.position
        .clone()
        .addScaledVector(fromDir, 320 + Math.random() * 80)
        .add(offset);
      start.y = 1;
      const end = targetObj.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20));
      const trail = [];
      const group = new THREE.Group();
      this.scene.add(group);
      let age = 0;
      const dur = 7;
      let exploded = false;
      this.transients.push({
        update: (dt) => {
          age += dt;
          const f = Math.min(1, age / dur);
          const head = start.clone().lerp(end, f);
          if (trail.length === 0 || trail[trail.length - 1].position.distanceTo(head) > 9) {
            const s = new THREE.Sprite(
              new THREE.SpriteMaterial({ map: this.tex.foam, transparent: true, opacity: 0.8, depthWrite: false })
            );
            s.position.copy(head);
            s.scale.set(7, 7, 1);
            group.add(s);
            trail.push(s);
          }
          for (const s of trail) s.material.opacity = Math.max(0, s.material.opacity - dt * 0.12);
          if (f >= 1 && !exploded) {
            exploded = true;
            if (i === 0) this.explosion(end.clone().setY(4), 1.2);
          }
          return age < dur + 3;
        },
        dispose: () => this.scene.remove(group),
      });
    }
  }

  // ── 起飛:甲板上滑出的光點 ────────────────────────────
  launchFlash(originObj) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.tex.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      s.position.copy(originObj.position).add(new THREE.Vector3(0, 10, 0));
      s.scale.setScalar(3);
      const dir = new THREE.Vector3(Math.sin(originObj.rotation.y), 0.3, Math.cos(originObj.rotation.y)).multiplyScalar(-1);
      this.scene.add(s);
      let age = -i * 0.5;
      this.transients.push({
        update: (dt) => {
          age += dt;
          if (age < 0) return true;
          s.position.addScaledVector(dir, dt * 60);
          s.position.y += dt * 14;
          s.material.opacity = Math.max(0, 1 - age / 2);
          return age < 2;
        },
        dispose: () => this.scene.remove(s),
      });
    }
  }

  // ── 空戰:小型閃光群 ─────────────────────────────────
  dogfight(pos, duration = 8) {
    let age = 0;
    let acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt;
        acc += dt;
        if (acc > 0.5 && age < duration) {
          acc = 0;
          this.explosion(
            new THREE.Vector3(pos.x + (Math.random() - 0.5) * 120, 60 + Math.random() * 50, pos.z + (Math.random() - 0.5) * 120),
            0.35
          );
        }
        return age < duration;
      },
      dispose: () => {},
    });
  }

  // ── 持續燃燒(依狀態開關) ────────────────────────────
  // N-7:火災煙柱改成持續上升的煙 sprite 串(黑 → 灰、越高越淡、被風吹斜),
  //      底部一顆貼水面的橘色 Additive 光斑當作水面反射火光。
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
    const nFire = this.mobile ? 6 : 10;
    const nSmoke = this.mobile ? 9 : 16;
    const parts = [];
    for (let i = 0; i < nFire + nSmoke; i++) {
      const isSmoke = i >= nFire;
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: isSmoke ? this.tex.darkSmoke : this.tex.fire,
          transparent: true,
          blending: isSmoke ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const maxLife = isSmoke ? 9 : 1.5;
      s.userData = { isSmoke, life: Math.random() * maxLife, maxLife, sway: Math.random() * 6.28 };
      group.add(s);
      parts.push(s);
    }
    // 水面反射火光
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex.glow, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff8a2e,
      })
    );
    glow.scale.setScalar(70);
    group.add(glow);

    let t = 0;
    return {
      update: (dt) => {
        t += dt;
        group.position.copy(obj.position);
        glow.position.set(0, 1.6, 0);
        glow.material.opacity = 0.42 + Math.sin(t * 3.1) * 0.12;
        for (const s of parts) {
          const d = s.userData;
          d.life += dt;
          if (d.life > d.maxLife) {
            d.life = 0;
            s.position.set((Math.random() - 0.5) * 22, 8, (Math.random() - 0.5) * 36);
            s.userData.sway = Math.random() * 6.28;
          }
          const f = d.life / d.maxLife;
          if (d.isSmoke) {
            // 越高越淡、被風吹斜(+x),並隨高度左右擺
            s.position.y += dt * 26;
            s.position.x += dt * (14 + f * 26) + Math.sin(t * 0.7 + d.sway) * dt * 6;
            s.position.z += Math.cos(t * 0.5 + d.sway) * dt * 4;
            s.scale.setScalar(14 + f * 92);
            s.material.opacity = 0.78 * (1 - f) * (1 - f * 0.30);
            // 黑 → 灰
            s.material.color.setRGB(0.18 + f * 0.52, 0.17 + f * 0.51, 0.17 + f * 0.53);
          } else {
            s.position.y += dt * 11;
            s.scale.setScalar(7 + f * 12);
            s.material.opacity = 0.95 * (1 - f);
          }
        }
      },
      dispose: () => this.scene.remove(group),
    };
  }

  // ── 沉沒:油汙貼花 + 水面火光(N-7) ─────────────────────
  // f 為沉沒進度 0→1:油汙圓斑隨時間擴大並轉濃,末段火光熄滅。
  setSinking(unitId, obj, active, f) {
    if (active && !this.sinks.has(unitId)) {
      this.sinks.set(unitId, this.#makeSink(obj));
    } else if (!active && this.sinks.has(unitId)) {
      this.sinks.get(unitId).dispose();
      this.sinks.delete(unitId);
    }
    if (active) this.sinks.get(unitId).setProgress(f);
  }

  #makeSink(obj) {
    const group = new THREE.Group();
    group.position.set(obj.position.x, 0, obj.position.z); // 沉沒點固定,不跟著船下沉
    this.scene.add(group);

    const slicks = [];
    const n = this.mobile ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        this.decalGeo,
        new THREE.MeshBasicMaterial({
          map: this.tex.oil, transparent: true, opacity: 0, depthWrite: false, color: 0x1a1714,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI;
      m.position.set((Math.random() - 0.5) * 90, 1.05 + i * 0.05, (Math.random() - 0.5) * 130);
      m.userData.base = 90 + Math.random() * 110;
      m.userData.noAO = true;   // R4-1:貼水面的油汙貼花不進 GTAO 的 G-buffer(見 postfx.js 註)
      group.add(m);
      slicks.push(m);
    }
    // 水面殘火
    const fire = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex.fire, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    fire.position.set(0, 3, 0);
    group.add(fire);

    let prog = 0;
    let t = 0;
    return {
      setProgress: (f) => { prog = f; },
      update: (dt) => {
        t += dt;
        const grow = 0.35 + prog * 1.5;
        for (const m of slicks) {
          const s = m.userData.base * grow;
          m.scale.set(s, s * 1.3, 1);
          m.material.opacity = Math.min(0.55, prog * 1.6) * 0.7;
        }
        fire.scale.setScalar(34 + Math.sin(t * 4) * 5);
        fire.material.opacity = Math.max(0, 0.85 - prog * 1.2);
      },
      dispose: () => this.scene.remove(group),
    };
  }

  // ── 落水白濺(飛機/彈著) ─────────────────────────────
  splash(pos, scale = 1) {
    const group = new THREE.Group();
    group.position.set(pos.x, 1.5, pos.z);
    this.scene.add(group);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.tex.foam, transparent: true, opacity: 0.9, depthWrite: false })
      );
      s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 16, 26 + Math.random() * 18, (Math.random() - 0.5) * 16);
      s.scale.setScalar(6 * scale);
      group.add(s);
      parts.push(s);
    }
    let age = 0;
    const dur = 1.8;
    this.transients.push({
      update: (dt) => {
        age += dt;
        for (const s of parts) {
          s.userData.v.y -= 46 * dt;
          s.position.addScaledVector(s.userData.v, dt);
          s.scale.setScalar((6 + age * 12) * scale);
          s.material.opacity = Math.max(0, 0.9 - age / dur);
        }
        return age < dur;
      },
      dispose: () => this.scene.remove(group),
    });
  }
}
