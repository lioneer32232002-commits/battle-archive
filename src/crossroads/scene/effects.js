// 陸戰特效:爆炸、槍火、衝鋒、火砲摧毀、情報揭示、夜跳高射砲、持續燃燒
// 瞬時特效以真實秒數計時;持續燃燒依單位狀態開關。沿用 midway 的 transient 框架。
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

export class Effects {
  constructor(scene) {
    this.scene = scene;
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
  }

  update(dt) {
    this.transients = this.transients.filter((t) => {
      const alive = t.update(dt);
      if (!alive) t.dispose();
      return alive;
    });
    for (const f of this.fires.values()) f.update(dt);
  }

  clearTransients() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
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
    const dur = 1.5;
    this.transients.push({
      update: (dt) => {
        age += dt;
        const f = age / dur;
        flash.scale.setScalar((4 + f * 22) * scale);
        flash.material.opacity = Math.max(0, 1 - f * 2.2);
        fire.scale.setScalar((2 + f * 30) * scale);
        fire.material.opacity = Math.max(0, 1 - f * 1.3);
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

  // ── 持續槍火(機槍/步槍對射) ─────────────────────────
  gunfire(pos, duration = 6) {
    let age = 0, acc = 0;
    this.transients.push({
      update: (dt) => {
        age += dt; acc += dt;
        if (acc > 0.17 && age < duration) {
          acc = 0;
          this._flash(
            new THREE.Vector3(pos.x + (Math.random() - 0.5) * 10, 2.4 + Math.random() * 1.6, pos.z + (Math.random() - 0.5) * 10),
            0.5 + Math.random() * 0.35, 0.07
          );
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
          this._flash(
            new THREE.Vector3(pos.x + (Math.random() - 0.5) * 16, 2.5 + Math.random() * 2.2, pos.z + (Math.random() - 0.5) * 16),
            0.7, 0.08
          );
        }
        if (bacc > 1.1 && age < duration) {
          bacc = 0;
          this.explosion(new THREE.Vector3(pos.x + (Math.random() - 0.5) * 24, 3, pos.z + (Math.random() - 0.5) * 24), 0.5);
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
          this.explosion(new THREE.Vector3(ox, 3, oz), 0.7 + Math.random() * 0.5);
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

  // ── 煙幕（溫斯特的煙幕彈：灰白煙幕升起、擴散） ─────────────
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
          s.position.set(s.userData.x * (1 + f * 2), 2 + f * 14, s.userData.z * (1 + f * 2));
          s.scale.setScalar(6 + f * 26);
          s.material.opacity = 0.6 * (1 - f) * Math.min(1, age / 1.2);
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
