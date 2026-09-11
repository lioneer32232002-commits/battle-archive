// 海面波形的單一真源:environment.js(海面本身)與 wake.js(尾流白沫)共用同一組波與同一個時間,
// 白沫才會真的貼在浪面上,而不是浮在空中或沉進水裡。
//
// 6 波疊加(4 長浪 ＋ 2 高頻碎浪紋);總振幅 ≤ 5.65,環礁 LIFT=7 仍高於浪峰,不會 z-fighting。
// 注意:海面 mesh 旋轉前的平面座標 (x, y) 對應世界的 (x, -z),故由世界座標取樣時要用 vec2(x, -z)。
export const WAVE_GLSL = `
  const vec2 D0 = vec2(0.857, 0.514); const vec2 D1 = vec2(-0.573, 0.819);
  const vec2 D2 = vec2(0.287, -0.958); const vec2 D3 = vec2(0.966, -0.259);
  const vec2 D4 = vec2(-0.196, -0.981); const vec2 D5 = vec2(0.707, 0.707);
  float waveSum(vec2 p, float t) {
    return sin(dot(p, D0) * 0.012 + t * 1.10) * 3.00
         + sin(dot(p, D1) * 0.020 + t * 1.60) * 1.60
         + sin(dot(p, D2) * 0.050 + t * 2.20) * 0.60
         + sin(dot(p, D3) * 0.095 + t * 2.90) * 0.28
         + sin(dot(p, D4) * 0.190 + t * 3.70) * 0.12
         + sin(dot(p, D5) * 0.330 + t * 4.60) * 0.05;
  }`;

// 貼水面的東西(尾流白沫)要跟海面「實際算繪出來的那個面」對齊,而不是跟解析波形對齊:
// 海面 mesh 是有限細分的平面(格距 = 30000 / segments ≈ 158 單位),兩個頂點之間是線性內插,
// 在浪峰/浪谷會比解析值低/高好幾個單位。直接用解析高度,白沫就會沉進海面被深度測試吃掉
// (這就是舊版尾流「明明有畫卻看不見」的原因)。所以改成在同一組格線上做雙線性取樣。
export const WAVE_SURFACE_GLSL = `
  uniform float uCell;   // 海面格距
  float waveSurface(vec2 p, float t) {
    vec2 g = floor(p / uCell) * uCell;
    vec2 f = (p - g) / uCell;
    float h00 = waveSum(g, t);
    float h10 = waveSum(g + vec2(uCell, 0.0), t);
    float h01 = waveSum(g + vec2(0.0, uCell), t);
    float h11 = waveSum(g + vec2(uCell, uCell), t);
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }`;

// 共用的海面時間(秒);由 environment.update() 推進
export const oceanTime = { value: 0 };
// 海面 mesh 的格距(單位);由 createEnvironment() 依實際細分數設定
export const oceanCell = { value: 30000 / 190 };
