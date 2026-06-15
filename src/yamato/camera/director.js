// 攝影機導演:自由模式(OrbitControls)/ 導演模式(事件自動運鏡)
import * as THREE from 'three';

export class Director {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'director';
    this.tween = null;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'free') this.tween = null;
  }

  // target: Vector3;dist: 攝影機距離
  flyTo(target, dist, duration = 2.6) {
    if (this.mode !== 'director') return;
    // 保持目前方位角,取電影感仰角
    const offset = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    const elev = 0.55; // 約 31°
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

  update(dt) {
    if (!this.tween) return;
    const tw = this.tween;
    tw.t += dt;
    const f = Math.min(1, tw.t / tw.duration);
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // easeInOutQuad
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (f >= 1) this.tween = null;
  }
}
