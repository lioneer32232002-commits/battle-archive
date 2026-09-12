// macro × detail 疊層(docs/asset-pipeline-spec.md §3「地表 PBR」)
//
// 作法:保留現有的程序化 canvas 貼圖當 macro 層(礁盤漸層、跑道、彈坑、田塊之類的
// 「格局」),再用 onBeforeCompile 在 <map_fragment> 之後乘上一張真實 PBR 的 diffuse
// 當 detail 層。detail 先「除以自己的平均色」再乘回去,等於只取它的明暗顆粒、不帶自身
// 色偏 — 近看有沙粒與鏽斑,遠看仍是 macro 排好的顏色計畫,兩邊都不平鋪露餡。
//
// 用自帶 varying(vDetailUv = uv)而不是 vMapUv:macro 貼圖各自有不同的 repeat/offset
// (礁盤圓盤是 0…1、島嶼端蓋直接是場景單位),用原始 uv 才能讓 detail 的平鋪倍率
// 以「每幾個場景單位一張」的方式各自指定。
import * as THREE from 'three';

/**
 * @param {THREE.Material} mat 目標材質(需已有 map,否則 detail 會直接乘在純色上,也可用)
 * @param {THREE.Texture} tex detail 貼圖(sRGB;取樣時由硬體解碼成線性)
 * @param {[number, number]} repeat detail 的平鋪倍率(乘在原始 uv 上)
 * @param {[number, number, number]} mean detail 貼圖的線性平均色(用來正規化)
 * @param {number} strength 0 = 不疊、1 = 全量
 */
export function createDetailUv(mat, tex, repeat, mean, strength = 0.85) {
  const uDetail = { value: tex };
  const uDetailRep = { value: new THREE.Vector2(repeat[0], repeat[1]) };
  const uDetailMean = { value: new THREE.Vector3(mean[0], mean[1], mean[2]) };
  const uDetailStrength = { value: strength };
  mat.userData.detail = { uDetail, uDetailRep, uDetailMean, uDetailStrength };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = uDetail;
    shader.uniforms.uDetailRep = uDetailRep;
    shader.uniforms.uDetailMean = uDetailMean;
    shader.uniforms.uDetailStrength = uDetailStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvDetailUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vDetailUv;
        uniform sampler2D uDetail;
        uniform vec2 uDetailRep;
        uniform vec3 uDetailMean;
        uniform float uDetailStrength;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 det = texture2D(uDetail, vDetailUv * uDetailRep).rgb / uDetailMean;
          det = clamp(mix(vec3(1.0), det, uDetailStrength), vec3(0.45), vec3(1.7));
          diffuseColor.rgb *= det;
        }`
      );
  };
  // 同一份 shader 但 uniform 不同 → 讓 three 依 repeat/strength 分開快取程式
  mat.customProgramCacheKey = () => `detail|${repeat[0]}|${repeat[1]}|${strength}`;
  mat.needsUpdate = true;
  return mat;
}
