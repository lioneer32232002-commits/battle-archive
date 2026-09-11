// 後製特效(桌機限定,P-3):EffectComposer → RenderPass ＋ UnrealBloomPass(只讓爆炸／火光／海面反光泛光,
//   海面不糊掉)＋ OutputPass(色調映射＋輸出色彩空間)＋ 自寫 ShaderPass(暗角 vignette ＋ 輕微膠片顆粒)。
//
// ⚠ OutputPass 不可省(2026-09-12 實測):three 在「渲染到 render target」時會把材質的 tonemapping 與
//   colorspace 兩個 chunk 關掉,交給最後一關處理。少了這一關,桌機等於整條管線既沒 ACES 也沒 sRGB
//   編碼、toneMappingExposure 也無效 → 比手機暗一大截、發灰,自寫 ShaderMaterial 的天空與海面更是
//   完全沒被色調映射。補上之後桌機與手機的響應曲線才一致,調色盤才有意義。
//   顆粒與暗角刻意放在 OutputPass 之後 → 作用在顯示空間,才是底片的行為。
// 海戰把 bloom threshold 由 0.85 降到 0.80,讓太陽反光與爆炸更亮。
// 手機不建 composer,由 main.js 以同一個 renderFrame() 分流直接 renderer.render。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.03 },    // ≤ 0.04
    uFloor: { value: 0.84 },    // 暗角最暗只到 84%,不吃掉整個中景
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uFloor;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;                                   // 暗角
      float vig = smoothstep(0.86, 0.28, length(d) * uVignette);
      col.rgb *= mix(uFloor, 1.0, vig);
      float g = (rand(vUv + fract(uTime)) - 0.5) * uGrain;  // 膠片顆粒
      col.rgb += g;
      gl_FragColor = col;
    }`,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.62, 0.80); // strength/radius/threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());     // ACES ＋ sRGB(見檔頭註)
  const vg = new ShaderPass(VignetteGrainShader);
  composer.addPass(vg);
  return {
    composer,
    setSize: (w, h) => { composer.setSize(w, h); bloom.setSize(w, h); },
    setPixelRatio: (r) => composer.setPixelRatio(r),
    render: (dt) => { vg.uniforms.uTime.value += dt; composer.render(); },
  };
}
