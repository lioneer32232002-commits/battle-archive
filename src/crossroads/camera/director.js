// 攝影機導演:自由模式(OrbitControls)/ 導演模式(事件自動運鏡)
// flyTo:一次性緩動飛到定點;follow:持續跟隨移動中的單位(如 E 連行軍),避免鏡頭停在原地。
import * as THREE from 'three';

export class Director {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'director';
    this.tween = null;
    this.followFn = null; // () => THREE.Vector3 | null,回傳要跟隨的世界座標
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'free') { this.tween = null; this.followFn = null; }
  }

  flyTo(target, dist, duration = 2.6) {
    if (this.mode !== 'director') return;
    this.followFn = null; // 一次性運鏡時停止跟隨
    const offset = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    const elev = 0.55;
    const end = new THREE.Vector3(
      target.x + Math.sin(azimuth) * Math.cos(elev) * dist,
      Math.sin(elev) * dist,
      target.z + Math.cos(azimuth) * Math.cos(elev) * dist
    );
    this.tween = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      toPos: end,
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  // 持續跟隨目標:鏡頭以固定方位角/仰角/距離平滑追著目標座標(elev 可為負=由下往上仰拍)
  follow(fn, dist = 300, elev = 0.6, az = null) {
    if (this.mode !== 'director') return;
    this.tween = null;
    this.followFn = fn;
    this.followDist = dist;
    this.followElev = elev;
    if (az == null) {
      const off = this.camera.position.clone().sub(this.controls.target);
      this.followAz = Math.atan2(off.x, off.z); // 沿用目前方位,過渡自然
    } else {
      this.followAz = az;
    }
  }

  clearFollow() { this.followFn = null; }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const f = Math.min(1, tw.t / tw.duration);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (f >= 1) this.tween = null;
      return;
    }
    if (this.followFn && this.mode === 'director') {
      const tgt = this.followFn();
      if (!tgt) return;
      const k = 1 - Math.pow(0.02, Math.min(dt, 0.1)); // 平滑追蹤係數
      this.controls.target.lerp(tgt, k);
      const off = new THREE.Vector3(
        Math.sin(this.followAz) * Math.cos(this.followElev) * this.followDist,
        Math.sin(this.followElev) * this.followDist,
        Math.cos(this.followAz) * Math.cos(this.followElev) * this.followDist
      );
      this.camera.position.lerp(tgt.clone().add(off), k);
    }
  }
}
