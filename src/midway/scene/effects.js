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
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.transients = []; // { update(dt) -> false 表結束, dispose() }
    this.fires = new Map(); // unitId -> fire emitter
    this.tex = {
      glow: radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)'),
      fire: radialTexture('rgba(255,200,80,1)', 'rgba(255,60,10,0)'),
      smoke: radialTexture('rgba(40,38,36,0.85)', 'rgba(40,38,36,0)'),
      puff: radialTexture('rgba(60,60,60,0.9)', 'rgba(60,60,60,0)'),
      tracer: radialTexture('rgba(255,220,120,1)', 'rgba(255,120,30,0)'),
      foam: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
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
    const light = new THREE.PointLight(0xffaa44, 30 * scale, 220 * scale, 1.6);
    group.add(light);
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
        light.intensity = Math.max(0, 30 * scale * (1 - f * 1.8));
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
    for (let i = 0; i < 26; i++) {
      const isSmoke = i >= 10;
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: isSmoke ? this.tex.smoke : this.tex.fire,
          transparent: true,
          blending: isSmoke ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      s.userData = { isSmoke, life: Math.random() * (isSmoke ? 6 : 1.5) };
      group.add(s);
      parts.push(s);
    }
    const light = new THREE.PointLight(0xff7722, 18, 180, 1.8);
    group.add(light);

    const fire = {
      update: (dt) => {
        group.position.copy(obj.position);
        light.position.set(0, 14, 0);
        light.intensity = 14 + Math.sin(performance.now() * 0.02) * 5;
        for (const s of parts) {
          const d = s.userData;
          d.life += dt;
          const maxLife = d.isSmoke ? 6 : 1.5;
          if (d.life > maxLife) {
            d.life = 0;
            s.position.set((Math.random() - 0.5) * 22, 8, (Math.random() - 0.5) * 36);
          }
          const f = d.life / maxLife;
          if (d.isSmoke) {
            s.position.y += dt * 16;
            s.position.x += dt * 7;
            s.scale.setScalar(10 + f * 46);
            s.material.opacity = 0.55 * (1 - f);
          } else {
            s.position.y += dt * 10;
            s.scale.setScalar(6 + f * 10);
            s.material.opacity = 0.9 * (1 - f);
          }
        }
      },
      dispose: () => this.scene.remove(group),
    };
    return fire;
  }
}
