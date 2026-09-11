// 後製特效（桌機限定，P-3）：EffectComposer → RenderPass ＋ UnrealBloomPass（只讓爆炸／火光泛光）
//   ＋ OutputPass ＋ 自寫 ShaderPass（暗角 vignette ＋ 輕微膠片顆粒）。
// 手機不建 composer，由 main.js 以同一個 renderFrame() 分流直接 renderer.render。
//
// ⚠️ OutputPass 不可省：three.js 在「渲染到 render target」時不會套 renderer.toneMapping
//   也不會做 sRGB 編碼（那兩步只在直接畫到 canvas 時發生）。少了它，composer 會把線性值
//   原封不動寫到 canvas → 整個畫面又暗又平，而且桌機（有 composer）與手機（無 composer）
//   亮度差一大截。放在 bloom 之後、暗角顆粒之前：bloom 在線性空間算（正確），
//   暗角與顆粒在顯示空間算（看得準）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.035 },   // ≤ 0.04
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;                                   // 暗角
      float vig = smoothstep(0.86, 0.28, length(d) * uVignette);
      col.rgb *= mix(0.74, 1.0, vig);
      float g = (rand(vUv + fract(uTime)) - 0.5) * uGrain;  // 膠片顆粒
      col.rgb += g;
      gl_FragColor = col;
    }`,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.6, 0.85); // strength/radius/threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());   // ACES 色調映射 ＋ sRGB 輸出
  const vg = new ShaderPass(VignetteGrainShader);
  composer.addPass(vg);
  return {
    composer,
    setSize: (w, h) => { composer.setSize(w, h); bloom.setSize(w, h); },
    setPixelRatio: (r) => composer.setPixelRatio(r),
    render: (dt) => { vg.uniforms.uTime.value += dt; composer.render(); },
  };
}
