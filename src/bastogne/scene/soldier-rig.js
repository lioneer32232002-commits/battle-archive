// 士兵骨架動畫(docs/realism-spec.md §R1.5)— 巴斯通
//
// 資產:public/models/soldier_rig_{us,de,de_coat}.glb
//   · 單一 T-pose 蒙皮網格(五個 primitive:制服／皮膚／鋼盔／裝具／靴)、20 根骨頭
//   · clips:idle／walk／run／crouch_walk／kneel_fire／prone_fire／hit_fall
//     walk 1.4、run 3.5、crouch_walk 1.0 m/s 寫在 glTF animation extras.speed(→ clip.userData.speed)
//   · 武器掛點是骨頭 hand_R:局部 -Z = 槍口、+Y = 照門朝上,武器 glb 以 identity 掛上即可
//   · 模型 -Z 朝前(Blender +Y 前、export_yup);程序化小兵 +Z 朝前 → 整棵 rig 轉 180°
//
// ── 兩件「看起來只是細節、其實是整場效能」的事 ──────────────────
// ① **五個 primitive 併成一個蒙皮網格**:glb 的五個材質在 three 裡就是五個 SkinnedMesh,
//    41 個小兵 × 5 = 205 個 draw call。把 baseColorFactor 烘進頂點色再合併(既有 glb 路徑
//    一直是這樣做的),整個小兵剩 1 個 draw call —— 與升級前的靜態姿態 glb 打平。
// ② **武器烘進同一份蒙皮幾何**:把武器幾何乘上 hand_R 的 bind 世界矩陣(= inverse bind matrix
//    的逆),再指派 skinIndex = hand_R、weight 1。蒙皮算出來就是 bone.matrixWorld * v_local,
//    效果與「把武器掛在骨頭下」完全一樣,但不多一個 draw call、也不多一個 Object3D。
//
// ⚠ SkeletonUtils.clone 之後材質／骨架都是新的,呼叫端**必須** environment.registerObject(),
//   否則沒註冊到 CSM 的 Standard 材質會被三盞 cascade 燈各照一次(亮度三倍)。見 environment.js 檔頭。
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { collectByGroup } from './assets.js';

export const RIG_FILE = { us: 'soldier_rig_us', de: 'soldier_rig_de', de_coat: 'soldier_rig_de_coat' };
export const RIG_CLIPS = ['idle', 'walk', 'run', 'crouch_walk', 'kneel_fire', 'prone_fire', 'hit_fall'];

const TARGET_H = 2.25;        // 陸戰單兵的目標高度(單位),與既有靜態 glb 一致
const HAND_BONE = 'hand_R';
// 德軍在雪原上穿白色冬季偽裝罩衫／盔套:只刷制服與鋼盔,裝具、靴、臉不動。
const WHITE_CAMO = /uniform|helmet/i;
const CAMO_RGB = [0.60, 0.62, 0.65];

// ── clip 選擇(純函式,有測試) ─────────────────────────────
// speed 為「rig 自身尺度的公尺／秒」(呼叫端已把世界單位換算過)。
// 門檻依 §R1.5:> 2.2 run、> 0.2 walk(衝鋒段 crouch_walk)、其餘依姿態站／跪／臥。
// ⚠ 但守軍的「靜止」不是真的 0:航線用的是非均勻 Catmull-Rom,最後一段(守到解圍)
//   的切線來自前一個航點,曲線會微微鼓出去 —— 實測散兵坑裡的守軍仍以約 0.3–0.5 m/s 漂移,
//   照 0.2 的門檻會讓整條 MLR 的人「在坑裡踏步行軍」。所以蹲／跪／臥的守勢姿態給比較寬的
//   靜止判定(0.6–0.8 m/s),真的起身移動時速度遠高於此,不影響衝鋒與轉進。
const STILL_SPEED = { dig: 0.8, prone: 0.8, kneel: 0.6 };
export function pickClip(speed, pose = 'stand', { assault = false } = {}) {
  if (speed > 2.2) return 'run';
  if (speed > (STILL_SPEED[pose] ?? 0.2)) return assault ? 'crouch_walk' : 'walk';
  if (pose === 'dig' || pose === 'prone') return 'prone_fire';
  if (pose === 'kneel') return 'kneel_fire';
  return 'idle';
}

// 播放倍率 = 實際速度 ÷ clip 的 extras.speed(腳才不會滑)。
// 冷場自動快轉時單位速度會飆到不合理的值,夾在 0.55–2.2 之間,免得變成快轉小人。
export function clipRate(speed, clipSpeed) {
  if (!clipSpeed) return 1;
  return Math.max(0.55, Math.min(2.2, speed / clipSpeed));
}

// ── 幾何:五個 primitive → 一份帶頂點色的蒙皮幾何 ─────────────
const KEEP_ATTR = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
const _c = new THREE.Color();

function skinnedGeometry(mesh, camo) {
  const geo = mesh.geometry.clone();
  for (const k of Object.keys(geo.attributes)) {
    if (!KEEP_ATTR.includes(k)) geo.deleteAttribute(k);
  }
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const name = mat?.name ?? '';
  const white = camo && WHITE_CAMO.test(name);
  if (mat?.color && !white) _c.copy(mat.color); else _c.setRGB(1, 1, 1);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = white ? CAMO_RGB[0] : _c.r;
    col[i * 3 + 1] = white ? CAMO_RGB[1] : _c.g;
    col[i * 3 + 2] = white ? CAMO_RGB[2] : _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.groups?.length) geo.clearGroups();
  geo.morphAttributes = {};
  return geo;
}

// 武器幾何 → 與蒙皮幾何同規格(補 skinIndex／skinWeight,全部綁 hand_R,權重 1)
function weaponGeometry(gltf, bindWorld, handIndex, ref) {
  const list = collectByGroup(gltf.scene, () => 'w').get('w');
  if (!list || !list.length) return null;
  const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (!geo) return null;
  geo.applyMatrix4(bindWorld);
  const n = geo.attributes.position.count;
  const IdxArray = ref.skinIndex.array.constructor;
  const WArray = ref.skinWeight.array.constructor;
  const si = new IdxArray(n * 4);
  const sw = new WArray(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = handIndex; sw[i * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4, ref.skinIndex.normalized));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, ref.skinWeight.normalized));
  // 屬性順序／型別要與蒙皮幾何完全一致,否則 mergeGeometries 整批失敗
  for (const k of Object.keys(geo.attributes)) {
    if (!KEEP_ATTR.includes(k)) geo.deleteAttribute(k);
  }
  return geo;
}

// ── 一個 (變體, 武器) 組合 → 可重複 clone 的模板 ─────────────
// 模板本身是「骨架 ＋ 一個合併好的 SkinnedMesh」,幾何與材質由所有 clone 共用
// (材質之後由呼叫端每單位 clone 一份,才能整單位一起淡出而不外溢)。
const _cache = new Map();

export function rigTemplate(variant, weapon, assets, { camo = false } = {}) {
  const key = `${variant}|${weapon}|${camo ? 'camo' : 'plain'}`;
  if (_cache.has(key)) return _cache.get(key);
  const p = buildTemplate(variant, weapon, assets, camo).catch((e) => {
    console.warn('[bastogne] 骨架士兵建置失敗,保留既有模型', e);
    return null;
  });
  _cache.set(key, p);
  return p;
}

async function buildTemplate(variant, weapon, assets, camo) {
  const file = RIG_FILE[variant];
  if (!file) return null;
  const [gltf, wpn] = await Promise.all([assets.model(file), weapon ? assets.model(weapon) : null]);
  if (!gltf) return null;

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) return null;

  const parts = skinned.map((m) => skinnedGeometry(m, camo));
  const ref = skinned[0].geometry.attributes;
  // 身高要在「加進武器之前」量:槍托／槍管會把包圍盒撐出去,拿它算縮放會讓小兵忽大忽小
  let bodyH = 0;
  for (const g of parts) { g.computeBoundingBox(); bodyH = Math.max(bodyH, g.boundingBox.max.y); }

  // 武器:烘進同一份幾何(見檔頭 ②)
  const skeleton = skinned[0].skeleton;
  const handIndex = skeleton.bones.findIndex((b) => b.name === HAND_BONE);
  if (wpn && handIndex >= 0 && ref.skinIndex && ref.skinWeight) {
    const bindWorld = skeleton.boneInverses[handIndex].clone().invert();
    const wg = weaponGeometry(wpn, bindWorld, handIndex, ref);
    if (wg) parts.push(wg);
  }

  const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!geo) return null;
  const h = Math.max(1e-3, bodyH);

  // glb 的 baseColorFactor 偏暗(制服 0.10 linear),提亮到看得出布料 —— 與既有靜態版同一手法
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0.04, envMapIntensity: 0.8,
  });
  mat.color.setScalar(1.9);

  // 模板:拿原始 gltf.scene 的骨架,把五個原始 SkinnedMesh 換成合併版
  const template = cloneSkinned(root);
  const drop = [];
  template.traverse((o) => { if (o.isSkinnedMesh) drop.push(o); });
  const host = drop[0]?.parent ?? template;
  const bindMatrix = drop[0]?.bindMatrix?.clone() ?? new THREE.Matrix4();
  const templateSkeleton = drop[0]?.skeleton ?? skeleton;
  for (const o of drop) o.parent?.remove(o);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'trooper';
  mesh.frustumCulled = false;            // 動畫會把包圍球撐出去,culling 會讓人憑空消失
  mesh.bind(templateSkeleton, bindMatrix);
  host.add(mesh);

  const clips = new Map();
  for (const c of gltf.animations ?? []) clips.set(c.name, c);

  return {
    template, mesh, geo, mat, clips,
    scale: TARGET_H / h,
    yaw: Math.PI,                        // 模型 -Z 朝前 → 轉 180° 對齊程序化小兵的 +Z
  };
}

// ── 一個小兵 ─────────────────────────────────────────
// group:既有的 trooper Group(位置／朝向／縮放由 soldiers.js 決定,不動)
export function spawnTrooper(pack, group, material, { phase = 0 } = {}) {
  const root = cloneSkinned(pack.template);
  root.rotation.y = pack.yaw;
  root.scale.setScalar(pack.scale);
  let mesh = null;
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.material = material;
    o.castShadow = true;
    mesh = o;
  });
  group.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  const seen = new Set();
  const actionFor = (name) => {
    if (actions.has(name)) return actions.get(name);
    const clip = pack.clips.get(name);
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    if (name === 'hit_fall') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions.set(name, a);
    return a;
  };

  const state = {
    root, mesh, mixer, phase,
    cur: null, action: null,
    clipSpeed: (name) => pack.clips.get(name)?.userData?.speed ?? 0,
    // 同班各兵加隨機相位,避免齊步
    play(name, rate = 1, fade = 0.25) {
      if (name === this.cur) { if (this.action) this.action.timeScale = rate; return; }
      const next = actionFor(name);
      if (!next) return;
      const started = seen.has(name);
      seen.add(name);
      if (this.action && this.action !== next) this.action.fadeOut(fade);
      next.reset();
      next.timeScale = rate;
      if (!started || name === 'hit_fall') next.time = name === 'hit_fall' ? 0 : phase * (next.getClip().duration || 1);
      if (fade > 0) next.fadeIn(fade); else next.setEffectiveWeight(1);
      next.play();
      this.action = next;
      this.cur = name;
    },
    // 拖曳時間軸／跳章節之後:動畫狀態直接歸位,不要留著上一段的淡入淡出
    snap(name, rate = 1) {
      for (const a of actions.values()) { a.stop(); a.enabled = false; }
      seen.delete(name);
      this.action = null; this.cur = null;
      this.play(name, rate, 0);
      mixer.update(0);
    },
  };
  return state;
}
