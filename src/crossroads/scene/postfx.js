// 後製特效（桌機限定，P-3）：EffectComposer → RenderPass ＋ UnrealBloomPass（讓槍口焰／曳光／
//   日出時的太陽本體泛光，濃霧與標籤不糊掉）＋ 自寫 ShaderPass（暗角 vignette ＋ 輕微膠片顆粒）。
// 手機不建 composer，由 main.js 以同一個 renderFrame() 分流直接 renderer.render。
// 實作沿用 src/bastogne/scene/postfx.js（規格 §1 P-3：能複製就複製），但**多加一道 OutputPass**：
//   EffectComposer 的中間 render target 是線性色空間，three.js 只在「直接畫到畫布」時才做
//   tone mapping 與 sRGB 輸出編碼；ShaderPass 是自寫 ShaderMaterial，不含 colorspace_fragment，
//   所以照抄的管線最後一道會把「線性值」當成「sRGB 值」直接送上螢幕 —— 整個 3D 畫面暗約 2.3 倍，
//   且 renderer.toneMappingExposure 完全失效（實測 0x808080 的 MeshBasic：直接繪製 141、
//   走 composer 只有 56）。OutputPass 會補上 tone mapping ＋ 輸出色空間轉換。
//   放在 bloom 之後、暗角顆粒之前，讓顆粒與暗角仍作用在顯示空間（沿用巴斯通調好的幅度）。
//   ⚠️ 其他五場戰役若照抄巴斯通版 postfx.js，會有同樣的偏暗問題，建議整合時一併補上。
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
  composer.addPass(new OutputPass());   // tone mapping ＋ sRGB 輸出編碼（見檔頭說明）
  const vg = new ShaderPass(VignetteGrainShader);
  composer.addPass(vg);
  return {
    composer,
    setSize: (w, h) => { composer.setSize(w, h); bloom.setSize(w, h); },
    setPixelRatio: (r) => composer.setPixelRatio(r),
    render: (dt) => { vg.uniforms.uTime.value += dt; composer.render(); },
  };
}
