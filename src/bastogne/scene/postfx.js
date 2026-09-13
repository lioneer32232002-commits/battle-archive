// 後製特效(桌機限定)— R4 渲染層升級(docs/realism-spec.md §R4)
//
// 固定順序:
//   RenderPass → GTAOPass(半解析度) → BokehPass(導演跟拍才開) → UnrealBloomPass
//   → OutputPass(ACES ＋ sRGB) → 調色 ShaderPass(lift/gamma/gain、飽和度、
//     teal-orange 分離色調、S 曲線、暗角、顆粒) → SMAAPass
//
// ⚠ OutputPass 不可省(2026-09-12 第二輪實測):three 在「渲染到 render target」時會把材質的
//   tonemapping 與 colorspace 兩個 chunk 關掉,交給最後一關處理。原本的 composer 少了這一關,
//   桌機等於整條管線既沒 ACES 也沒 sRGB 編碼 → 畫面比手機暗一大截、發灰綠,toneMappingExposure
//   也完全無效,而且天空(自寫 ShaderMaterial)同樣不會被色調映射。
//   實測同一幀:直接 render (10,29,7) vs composer (5,8,3)。
//   ⇒ 調色與暗角顆粒一律放在 OutputPass **之後**(作用在顯示空間,才是底片的行為);
//     GTAO 與 Bloom 一律放在 OutputPass **之前**(作用在線性空間,才是光學的行為)。
//
// ⚠ MSAA 與 SMAA 並存:針葉樹葉片是「一根針一個三角形」,terrain-upgrade.js 的
//   needle 材質靠 alphaToCoverage 活下來,那需要 render target 的 MSAA;SMAA 只處理幾何邊緣,
//   取代不了覆蓋率。所以兩個都留(§R4.5 允許「並存看效能」)。
//
// ⚠ GTAO 半解析度:GTAOPass 內部會**再跑一次幾何**(normal/depth G-buffer),
//   是這條管線最貴的一關。setSize 之後一定要把 GTAO 的尺寸再壓回半解析度
//   (EffectComposer.setSize／setPixelRatio 會把全解析度塞回每一個 pass)。
//   降級順序(§R4.6):先 setGtaoScale(0.25) → 再 setGTAO(false) → 最後才降 pixelRatio。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// 調色參數(§R4.4)。各戰役由 main.js 傳 grade 覆寫;這裡是「中性 ＋ 原本的暗角顆粒」。
export const NEUTRAL_GRADE = {
  lift: [0, 0, 0],          // 陰影抬升(加法)
  gamma: [1, 1, 1],         // 中間調
  gain: [1, 1, 1],          // 亮部(乘法)
  saturation: 1,
  contrast: 0,              // S 曲線強度 0–1
  shadowTint: [0.0, 0.55, 0.65],   // 陰影偏青(teal)
  highlightTint: [0.75, 0.5, 0.0], // 亮部偏暖(orange)
  split: [0, 0],            // 分離色調強度:[陰影, 亮部]
  vignette: 1.15,
  grain: 0.03,              // ≤ 0.04
  floor: 0.84,              // 暗角最暗只到 84%,不吃掉整個中景
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 },
    uContrast: { value: 0 },
    uShadowTint: { value: new THREE.Vector3(0, 0.55, 0.65) },
    uHighTint: { value: new THREE.Vector3(0.75, 0.5, 0) },
    uSplit: { value: new THREE.Vector2(0, 0) },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.03 },
    uFloor: { value: 0.84 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime;
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain;
    uniform float uSat; uniform float uContrast;
    uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform vec2 uSplit;
    uniform float uVignette; uniform float uGrain; uniform float uFloor;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb;

      // ① lift / gamma / gain(ASC-CDL 風,顯示空間三段)
      col = clamp(col * uGain + uLift, 0.0, 4.0);
      col = pow(col, 1.0 / max(uGamma, vec3(0.01)));

      // ② 對比 S 曲線(以 0.5 為樞紐的 smoothstep,不夾死兩端)
      col = mix(col, smoothstep(0.0, 1.0, clamp(col, 0.0, 1.0)), uContrast);

      // ③ 飽和度(Rec.709 亮度)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);

      // ④ teal-orange 分離色調:陰影偏青、亮部偏暖(各 0.04 級,不能看得出來是濾鏡)
      float l = clamp(luma, 0.0, 1.0);
      col += uShadowTint * pow(1.0 - l, 2.0) * uSplit.x;
      col += uHighTint * pow(l, 2.0) * uSplit.y;

      // ⑤ 暗角
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.86, 0.28, length(d) * uVignette);
      col *= mix(uFloor, 1.0, vig);

      // ⑥ 膠片顆粒
      col += (rand(vUv + fract(uTime)) - 0.5) * uGrain;

      gl_FragColor = vec4(col, src.a);
    }`,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} [opts]
 * @param {object} [opts.grade]  調色參數(覆寫 NEUTRAL_GRADE)
 * @param {object} [opts.gtao]   { radius, distanceExponent, thickness, scale, samples, blend }
 * @param {object} [opts.bokeh]  { aperture, maxblur }
 * @param {object} [opts.bloom]  { strength, radius, threshold }
 * @param {number} [opts.samples] render target MSAA(預設 4)
 */
export function createComposer(renderer, scene, camera, opts = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const MSAA = opts.samples ?? 4;
  // §R5.2 畫質分級:關掉的 pass **完全不建**(GTAO 的 G-buffer、SMAA 的兩張查表都是實打實的
  //   VRAM 與頻寬,enabled=false 只是不畫)。low 這一級最後只剩 RenderPass → OutputPass → 調色。
  const feat = { gtao: true, bloom: true, bokeh: true, smaa: true, ...(opts.features ?? {}) };
  const bloomScale = opts.bloomScale ?? 1;
  const gtaoCfg = {
    radius: 6, distanceExponent: 1, thickness: 1, scale: 1, samples: 16,
    screenSpaceRadius: false, blend: 0.6, ...(opts.gtao ?? {}),
  };
  const bloomCfg = { strength: 0.25, radius: 0.6, threshold: 0.85, ...(opts.bloom ?? {}) };
  const bokehCfg = { aperture: 0.00008, maxblur: 0.006, ...(opts.bokeh ?? {}) };
  const grade = { ...NEUTRAL_GRADE, ...(opts.grade ?? {}) };

  const composer = new EffectComposer(renderer);
  // MSAA:開了 composer 之後 renderer 的 antialias 就沒作用了(畫的是 render target)。
  composer.renderTarget1.samples = MSAA;
  composer.renderTarget2.samples = MSAA;

  composer.addPass(new RenderPass(scene, camera));

  // ── GTAO(半解析度):接地感的關鍵 — 士兵腳下、牆腳、艦島根部 ──
  const gtao = feat.gtao
    ? new GTAOPass(scene, camera, Math.round(size.x * 0.5), Math.round(size.y * 0.5))
    : null;
  if (gtao) {
  // ⚠ 深度精度:GTAOPass 的 G-buffer 是 DEPTH24_STENCIL8,而本專案的 camera 是
  //   near 0.5 / far 40000(天空圓頂半徑 16000,far 收不了)。實測把深度換成
  //   DEPTH_COMPONENT32F 反而讓 GTAO 整片變成「無遮蔽」(AO 恆為 1),所以維持 24_8;
  //   代價是 AO 的有效距離有限,遠景幾乎沒有 AO —— 這正好也是我們要的(接地感只需要近景)。
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = gtaoCfg.blend;
  gtao.updateGtaoMaterial({
    radius: gtaoCfg.radius,
    distanceExponent: gtaoCfg.distanceExponent,
    thickness: gtaoCfg.thickness,
    scale: gtaoCfg.scale,
    samples: gtaoCfg.samples,
    screenSpaceRadius: gtaoCfg.screenSpaceRadius,
  });
  // 去噪半徑跟著 AO 半徑走,否則半解析度的 AO 會在邊緣結塊、出現黑邊光暈
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
  // ⚠ GTAO 的 G-buffer 是用 scene.overrideMaterial 重畫一次場景 —— **override 材質的
  //   depthWrite 是 true**,所以原本 depthWrite:false 的東西(天空圓頂、雲、寒霧、太陽、
  //   所有 Sprite 標籤)全都會把深度寫進去,變成「天上有幾塊幾百公尺寬的板子擋著」,
  //   AO 算出來就是滿天的黑色方塊。內建的 _overrideVisibility 只擋 Points／Line,
  //   這裡擴充成也擋 Sprite 與 userData.noAO(environment.js 幫天空掛的旗標)。
  gtao._overrideVisibility = function () {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || o.userData.noAO) {
        o.visible = false;
        cache.push(o);
      }
    });
  };
  composer.addPass(gtao);
  }

  // ── 景深:只在導演模式跟拍時開(§R4.3),目標是「遠景略柔」 ──
  const bokeh = feat.bokeh
    ? new BokehPass(scene, camera, { focus: 200, aperture: bokehCfg.aperture, maxblur: bokehCfg.maxblur })
    : null;
  if (bokeh) { bokeh.enabled = false; composer.addPass(bokeh); }

  const bloom = feat.bloom
    ? new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloomCfg.strength, bloomCfg.radius, bloomCfg.threshold)
    : null;
  if (bloom) composer.addPass(bloom);

  composer.addPass(new OutputPass());     // ACES ＋ sRGB(見檔頭註)

  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

  const smaa = feat.smaa ? new SMAAPass() : null;
  if (smaa) composer.addPass(smaa);

  // ── 尺寸管理 ──────────────────────────────────────────
  let curW = size.x, curH = size.y, curRatio = renderer.getPixelRatio();
  let gtaoScale = 0.5;
  function applySizes() {
    composer.renderTarget1.samples = MSAA;
    composer.renderTarget2.samples = MSAA;
    const ew = Math.max(1, Math.round(curW * curRatio));
    const eh = Math.max(1, Math.round(curH * curRatio));
    // medium 的 bloom 走半解析度(§R5.2):UnrealBloomPass 內部是五層降採樣,少一半就省一半
    if (bloom) bloom.setSize(Math.max(1, Math.round(ew * bloomScale)), Math.max(1, Math.round(eh * bloomScale)));
    // EffectComposer 已經把全解析度塞給每個 pass,GTAO 要再壓回來
    if (gtao) gtao.setSize(Math.max(1, Math.round(ew * gtaoScale)), Math.max(1, Math.round(eh * gtaoScale)));
  }
  applySizes();

  // ── 調色參數套用 ───────────────────────────────────────
  const u = gradePass.uniforms;
  function applyGrade(g) {
    u.uLift.value.fromArray(g.lift);
    u.uGamma.value.fromArray(g.gamma);
    u.uGain.value.fromArray(g.gain);
    u.uSat.value = g.saturation;
    u.uContrast.value = g.contrast;
    u.uShadowTint.value.fromArray(g.shadowTint);
    u.uHighTint.value.fromArray(g.highlightTint);
    u.uSplit.value.fromArray(g.split);
    u.uVignette.value = g.vignette;
    u.uGrain.value = g.grain;
    u.uFloor.value = g.floor;
  }
  applyGrade(grade);

  // 舊管線對照用(截圖 A/B):關掉 GTAO／景深／SMAA,調色回到「只有暗角顆粒」
  const legacyGrade = { ...NEUTRAL_GRADE, vignette: grade.vignette, grain: grade.grain, floor: grade.floor };
  let modern = true;

  return {
    composer,
    passes: { gtao, bokeh, bloom, gradePass, smaa },
    grade,
    setSize: (w, h) => {
      curW = w; curH = h;
      composer.setSize(w, h);
      applySizes();
    },
    setPixelRatio: (r) => {
      curRatio = r;
      composer.setPixelRatio(r);
      applySizes();
    },
    features: feat,
    // §R4.6 降級:先降 GTAO 解析度 → 再關 GTAO → 最後才由 main.js 降 pixelRatio
    setGtaoScale: (s) => { gtaoScale = s; applySizes(); },
    setGTAO: (on) => { if (gtao) gtao.enabled = !!on && modern; },
    gtaoEnabled: () => !!gtao?.enabled,
    // 景深:導演跟拍時開,每幀把 focus 設為跟拍目標距離
    setBokeh: (on) => { if (bokeh) bokeh.enabled = !!on && modern; },
    setFocus: (dist) => { if (bokeh) bokeh.uniforms.focus.value = Math.max(1, dist); },
    bokehEnabled: () => !!bokeh?.enabled,
    // A/B 對照:'modern' = 全開,'legacy' = 升級前的管線
    setPipeline: (mode) => {
      modern = mode !== 'legacy';
      if (gtao) gtao.enabled = modern;
      if (smaa) smaa.enabled = modern;
      if (bokeh) bokeh.enabled = false;
      applyGrade(modern ? grade : legacyGrade);
    },
    render: (dt) => { u.uTime.value += dt; composer.render(); },
  };
}
