// 攝影機導演:自由模式(OrbitControls)/ 導演模式(事件自動運鏡)
// flyTo:一次性緩動飛到定點;follow:持續跟隨移動中的單位。
//
// M-4 升級(鏡頭手感,自巴斯通移植):
//   1. 手持噪聲 — follow 期間於最終 position/target 疊加微小偽 Perlin 偏移(數個不同頻率 sin 疊加),
//      幅度約跟拍距離的 0.3%;自由模式不加。
//   2. 衝擊震動 — shake(intensity, duration):衰減式隨機偏移,barrage／destroy／explosion 觸發。
//   3. 跟拍前置量(look-ahead) — follow 目標點沿單位行進方向前移約跟拍距離的 8%,
//      畫面重心落在部隊「要去的地方」,更像紀錄片運鏡。
import * as THREE from 'three';

export class Director {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'director';
    this.tween = null;
    this.followFn = null;
    this.t = 0;               // 手持噪聲時間累加
    this.shakeState = null;   // { amp, t, dur }
    this._lastTgt = null;     // 上一幀跟隨點(推導行進方向)
    this._vel = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'free') { this.tween = null; this.followFn = null; this.shakeState = null; }
  }

  flyTo(target, dist, duration = 2.6) {
    if (this.mode !== 'director') return;
    this.followFn = null;
    this._lastTgt = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    const elev = 0.55;
    const end = new THREE.Vector3(
      target.x + Math.sin(azimuth) * Math.cos(elev) * dist,
      Math.sin(elev) * dist,
      target.z + Math.cos(azimuth) * Math.cos(elev) * dist
    );
    this.tween = {
      t: 0, duration,
      fromPos: this.camera.position.clone(), toPos: end,
      fromTarget: this.controls.target.clone(), toTarget: target.clone(),
    };
  }

  follow(fn, dist = 300, elev = 0.6, az = null) {
    if (this.mode !== 'director') return;
    this.tween = null;
    this.followFn = fn;
    this.followDist = dist;
    this.followElev = elev;
    this._lastTgt = null;
    this._vel.set(0, 0, 0);
    if (az == null) {
      const off = this.camera.position.clone().sub(this.controls.target);
      this.followAz = Math.atan2(off.x, off.z);
    } else {
      this.followAz = az;
    }
  }

  clearFollow() { this.followFn = null; this._lastTgt = null; }

  // 衝擊震動:近距離事件強、遠距離弱(由呼叫端決定 intensity)
  shake(intensity = 4, duration = 0.5) {
    if (this.mode !== 'director') return;
    // 疊加:取較強者,避免連續事件互相抵銷
    if (!this.shakeState || intensity >= this.shakeState.amp) this.shakeState = { amp: intensity, t: 0, dur: duration };
  }

  // 手持偽 Perlin(數個不同頻率 sin 疊加)
  _handheld(amp, out) {
    const t = this.t;
    out.set(
      (Math.sin(t * 1.3) + 0.6 * Math.sin(t * 2.7 + 1.1)) * amp,
      (Math.sin(t * 1.1 + 2.0) + 0.5 * Math.sin(t * 3.1)) * amp * 0.6,
      (Math.sin(t * 1.7 + 0.5) + 0.6 * Math.sin(t * 2.3 + 2.2)) * amp
    );
    return out;
  }

  update(dt) {
    this.t += dt;

    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const f = Math.min(1, tw.t / tw.duration);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (f >= 1) this.tween = null;
    } else if (this.followFn && this.mode === 'director') {
      const tgt = this.followFn();
      if (tgt) {
        // 推導行進方向(平滑),做 look-ahead
        if (this._lastTgt) {
          this._tmp.copy(tgt).sub(this._lastTgt).multiplyScalar(1 / Math.max(dt, 1e-3));
          this._vel.lerp(this._tmp, 1 - Math.pow(0.02, Math.min(dt, 0.1)));
        } else {
          this._lastTgt = new THREE.Vector3();
        }
        this._lastTgt.copy(tgt);
        // 前置量:沿行進方向前移約跟拍距離的 8%
        const lead = this._tmp2.copy(this._vel); lead.y = 0;
        const spd = lead.length();
        const aim = this._tmp.copy(tgt);
        if (spd > 1e-3) aim.addScaledVector(lead.multiplyScalar(1 / spd), this.followDist * 0.08);

        const k = 1 - Math.pow(0.02, Math.min(dt, 0.1));
        this.controls.target.lerp(aim, k);
        const off = new THREE.Vector3(
          Math.sin(this.followAz) * Math.cos(this.followElev) * this.followDist,
          Math.sin(this.followElev) * this.followDist,
          Math.cos(this.followAz) * Math.cos(this.followElev) * this.followDist
        );
        this.camera.position.lerp(aim.clone().add(off), k);

        // 手持噪聲(幅度約跟拍距離 0.3%)
        const n = this._handheld(this.followDist * 0.003, new THREE.Vector3());
        this.camera.position.add(n);
        this.controls.target.add(n.multiplyScalar(0.5));
      }
    }

    // 衝擊震動(衰減隨機偏移;疊在最終 position 上)
    if (this.shakeState) {
      const s = this.shakeState; s.t += dt;
      const f = 1 - s.t / s.dur;
      if (f <= 0) { this.shakeState = null; }
      else {
        const a = s.amp * f * f;
        this.camera.position.x += (Math.random() - 0.5) * a;
        this.camera.position.y += (Math.random() - 0.5) * a;
        this.camera.position.z += (Math.random() - 0.5) * a;
      }
    }
  }
}
