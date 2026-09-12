// 後製特效(桌機限定,B-5):EffectComposer → RenderPass ＋ UnrealBloomPass(只讓爆炸／火光泛光,
//   白雪不糊掉)＋ OutputPass(色調映射＋輸出色彩空間)＋ 自寫 ShaderPass(暗角 vignette ＋ 輕微膠片顆粒)。
// 手機不建 composer,由 main.js 以同一個 renderFrame() 分流直接 renderer.render。
//
// ⚠ OutputPass 不可省(2026-09-12 第二輪實測):three 在「渲染到 render target」時會把材質的
//   tonemapping 與 colorspace 兩個 chunk 關掉,交給最後一關處理。原本的 composer 少了這一關,
//   桌機等於整條管線既沒 ACES 也沒 sRGB 編碼 → 畫面比手機暗一大截、發灰綠,toneMappingExposure
//   也完全無效,而且天空(自寫 ShaderMaterial)同樣不會被色調映射。
//   實測同一幀:直接 render (10,29,7) vs composer (5,8,3)。
//   補上 OutputPass 後桌機與手機的響應曲線一致,environment.js 的調色盤才有意義。
//   顆粒與暗角刻意放在 OutputPass 之後 → 作用在顯示空間,才是底片的行為。
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
  // MSAA:開了 composer 之後 renderer 的 antialias 就沒作用了(畫的是 render target)。
  // 針葉樹的葉片是一根針一個三角形,遠一點就是次像素寬度 —— 沒有 MSAA ＋ alphaToCoverage
  // 的話,alphaTest 會把整片樹冠判掉,森林在 50 公尺外就變成一排電線桿。
  composer.renderTarget1.samples = 4;
  composer.renderTarget2.samples = 4;
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.6, 0.85); // strength/radius/threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());     // ACES ＋ sRGB(見檔頭註)
  const vg = new ShaderPass(VignetteGrainShader);
  composer.addPass(vg);
  return {
    composer,
    setSize: (w, h) => {
      composer.setSize(w, h); bloom.setSize(w, h);
      composer.renderTarget1.samples = 4; composer.renderTarget2.samples = 4;
    },
    setPixelRatio: (r) => composer.setPixelRatio(r),
    render: (dt) => { vg.uniforms.uTime.value += dt; composer.render(); },
  };
}
