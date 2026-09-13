// 士兵骨架動畫（docs/realism-spec.md §R1.5）— 卡倫坦
// ─────────────────────────────────────────────────────────────
// 來源模型：public/models/soldier_rig_us.glb／soldier_rig_de.glb
//   20 根骨頭、單一 T-pose 蒙皮網格（5 個 primitive ＝ 5 種材質）、
//   7 個 clip：idle／walk／run／crouch_walk／kneel_fire／prone_fire／hit_fall，
//   walk 1.4、run 3.5、crouch_walk 1.0 m/s 寫在 glTF animation 的 extras.speed。
//   模型座標：公尺、原點腳底中心、**-Z 為正面**（與其他 soldier glb 一致 → rotY = π）。
//
// 本模組做三件事：
//   ① 把 5 個 primitive 合併成「一個 SkinnedMesh」：材質 baseColor 烘進頂點色，
//      共用一顆 vertexColors 的 MeshStandard —— 每個小兵 1 個 draw call
//      （沿用本專案 bakeToVertexColors 的做法；38 具 SkinnedMesh = 38 個 draw call）。
//   ② 武器直接「縫」進蒙皮網格：把武器幾何變換到 hand_R 骨頭的 bind 空間，
//      skinIndex 全指向 hand_R、權重 1.0。這樣武器跟著手動，卻不多一個 draw call
//      （比 hand_R.add(weapon) 省 38 個 draw call，視覺完全一樣）。
//   ③ 每個小兵一個 AnimationMixer、材質每單位一份（淡出不外溢）。
//
// ⚠ SkeletonUtils.clone 之後的材質一定要 environment.registerObject（§R6 CSM 註冊）。
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 蒙皮幾何要留的屬性（uv 一律丟掉：烘頂點色之後用不到，留著只會讓 merge 失敗）
const KEEP = new Set(['position', 'normal', 'skinIndex', 'skinWeight', 'color']);

// 程序化小兵是「站姿 1.75 公尺 → 3.25 場景單位」；骨架模型也是公尺，用同一個倍率。
export const SOLDIER_FIT = 3.25;
export const SOLDIER_METERS = 1.75;
export const SOLDIER_SCALE = SOLDIER_FIT / SOLDIER_METERS;   // ≈ 1.857 單位／公尺

// ── clip 選擇（純函式，可單元測試）────────────────────────────
export const CLIP_SPEED = { walk: 1.4, run: 3.5, crouch_walk: 1.0 };
export const RUN_AT = 2.2;    // m/s 以上 → run
export const WALK_AT = 0.2;   // m/s 以上 → walk
const TS_MIN = 0.55, TS_MAX = 2.2;

const clampTs = (v) => Math.min(TS_MAX, Math.max(TS_MIN, v));

/**
 * 依「實際移動速度（公尺／秒）」與情境選 clip 與播放倍率（倍率 = 實際速度 ÷ extras.speed，腳不滑）。
 * @param {number} speed  公尺／秒
 * @param {object} ctx
 * @param {'stand'|'kneel'|'prone'} [ctx.posture]  靜止時的姿態（由 SQUAD_CFG 的 pose 對應）
 * @param {'clear'|'defend'|null} [ctx.hint]       'clear' 街戰逐屋肅清、'defend' 路堤守軍
 * @param {boolean} [ctx.downed]                   單位被摧毀 → 中彈倒地（不循環）
 * @param {object} [speeds]                        clip 的 extras.speed（預設用 glb 的值）
 */
export function pickClip(speed, { posture = 'stand', hint = null, downed = false } = {}, speeds = CLIP_SPEED) {
  if (downed) return { clip: 'hit_fall', timeScale: 1, once: true };
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  if (v > WALK_AT) {
    if (hint === 'clear') return { clip: 'crouch_walk', timeScale: clampTs(v / (speeds.crouch_walk || 1)), once: false };
    if (v > RUN_AT) return { clip: 'run', timeScale: clampTs(v / (speeds.run || 3.5)), once: false };
    return { clip: 'walk', timeScale: clampTs(v / (speeds.walk || 1.4)), once: false };
  }
  if (hint === 'defend') return { clip: posture === 'prone' ? 'prone_fire' : 'kneel_fire', timeScale: 1, once: false };
  if (posture === 'kneel') return { clip: 'kneel_fire', timeScale: 1, once: false };
  if (posture === 'prone') return { clip: 'prone_fire', timeScale: 1, once: false };
  return { clip: 'idle', timeScale: 1, once: false };
}

// glTF animation 的 extras.speed（GLTFLoader 會放進 clip.userData.extras 或 clip.userData）
export function clipSpeeds(clips) {
  const out = { ...CLIP_SPEED };
  for (const c of clips ?? []) {
    const ex = c.userData?.extras ?? c.userData ?? null;
    const s = ex?.speed;
    if (typeof s === 'number' && s > 0) out[c.name] = s;
  }
  return out;
}

// ── 蒙皮幾何合併（純函式，可單元測試）──────────────────────────
function skinPart(mesh, colorOverride = null) {
  const src = mesh.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP.has(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const c = colorOverride ?? mat?.color ?? new THREE.Color(0xffffff);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.clearGroups();
  return g;
}

/**
 * 把同一副骨架的多個 SkinnedMesh primitive 合併成一份頂點色幾何。
 * 回傳 null 代表合併不成（屬性不相容）—— 呼叫端退回「不合併」。
 */
export function mergeSkinnedParts(meshes) {
  if (!meshes.length) return null;
  try {
    const parts = meshes.map((m) => skinPart(m));
    return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  } catch (e) {
    console.warn('[carentan] 蒙皮 primitive 合併失敗，改用原始多材質版本', e?.message ?? e);
    return null;
  }
}

/**
 * 把武器幾何「縫」到 hand_R 骨頭上：頂點變換到 bind 空間、skinIndex 全指向該骨頭、權重 1。
 * 三角學見 three 的 skinning_vertex chunk：
 *   final = bindMatrixInverse · (bone.matrixWorld · boneInverse) · bindMatrix · v
 *   要讓 final 等於「武器掛在骨頭 local 空間」→ v = bindMatrix⁻¹ · boneInverse⁻¹ · v_local
 */
export function weaponSkinGeometry(weaponRoot, skinnedMesh, boneName = 'hand_R') {
  if (!weaponRoot || !skinnedMesh?.skeleton) return null;
  const skel = skinnedMesh.skeleton;
  const idx = skel.bones.findIndex((b) => b.name === boneName);
  if (idx < 0) return null;
  const ref = skinnedMesh.geometry.attributes;
  if (!ref.skinIndex || !ref.skinWeight) return null;

  const M = new THREE.Matrix4().copy(skel.boneInverses[idx]).invert();
  M.premultiply(new THREE.Matrix4().copy(skinnedMesh.bindMatrix).invert());

  weaponRoot.updateMatrixWorld(true);
  const base = new THREE.Matrix4().copy(weaponRoot.matrixWorld).invert();
  const IndexArray = ref.skinIndex.array.constructor;
  const WeightArray = ref.skinWeight.array.constructor;
  const parts = [];
  weaponRoot.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const mx = new THREE.Matrix4().multiplyMatrices(base, o.matrixWorld).premultiply(M);
    g.applyMatrix4(mx);
    const n = g.attributes.position.count;
    const si = new IndexArray(n * 4);
    const sw = new WeightArray(n * 4);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const c = mat?.color ?? new THREE.Color(0x2a2723);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      si[i * 4] = idx;
      sw[i * 4] = 1;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4, ref.skinIndex.normalized));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, ref.skinWeight.normalized));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    parts.push(g);
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

// ══════════════════════════════════════════════════════════════
// rig hub：載入、合併、快取樣板、複製小兵
// ══════════════════════════════════════════════════════════════
const RIG_ID = { blue: 'soldier_rig_us', red: 'soldier_rig_de' };

export function createRigHub({ assets, shadows = false, register = null } = {}) {
  const sources = new Map();     // side → Promise<{root, clips, speeds}|null>
  const templates = new Map();   // `${side}|${weapon}` → Promise<Object3D|null>
  const live = [];               // 所有已生成的小兵（mixer 更新用）
  let stride = 1;
  let frame = 0;
  let acc = 0;

  function source(side) {
    if (sources.has(side)) return sources.get(side);
    const p = (async () => {
      const id = RIG_ID[side] ?? RIG_ID.blue;
      const root = await assets.model(id);
      if (!root) return null;
      const clips = root.animations ?? root.userData?.gltfAnimations ?? [];
      if (!clips.length) {
        console.warn('[carentan] 骨架 glb 沒有動畫 clip，保留靜態士兵：', id);
        return null;
      }
      return { root, clips, speeds: clipSpeeds(clips) };
    })().catch((e) => {
      console.warn('[carentan] 骨架模型載入失敗，保留靜態士兵：', side, e?.message ?? e);
      return null;
    });
    sources.set(side, p);
    return p;
  }

  // 樣板：骨頭階層 ＋ 一個合併好的 SkinnedMesh（幾何在同 side／同武器的小兵之間共用）
  function template(side, weapon) {
    const key = `${side}|${weapon ?? '-'}`;
    if (templates.has(key)) return templates.get(key);
    const p = (async () => {
      const src = await source(side);
      if (!src) return null;
      const root = skeletonClone(src.root);
      root.updateMatrixWorld(true);
      const skins = [];
      root.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
      if (!skins.length) return null;
      const first = skins[0];
      const parts = [mergeSkinnedParts(skins)].filter(Boolean);
      if (!parts.length) return null;

      // 武器縫進蒙皮（hand_R，local transform 歸零）
      if (weapon) {
        const w = await assets.model(weapon);
        if (w) {
          const wg = weaponSkinGeometry(w, first, 'hand_R');
          if (wg) parts.push(wg);
        }
      }
      let geo = null;
      try {
        geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
      } catch (e) {
        console.warn('[carentan] 武器縫合失敗，只留士兵本體', e?.message ?? e);
        geo = parts[0];
      }
      if (!geo) return null;

      const skeleton = first.skeleton;
      const bindMatrix = first.bindMatrix.clone();
      const parent = first.parent ?? root;
      for (const s of skins) s.parent?.remove(s);

      const mesh = new THREE.SkinnedMesh(geo, placeholderMaterial());
      mesh.name = 'soldier_skin';
      mesh.bind(skeleton, bindMatrix);
      mesh.frustumCulled = false;   // 骨架動畫的 bounding box 不會自己更新
      parent.add(mesh);
      root.userData.clips = src.clips;
      root.userData.speeds = src.speeds;
      return root;
    })().catch((e) => {
      console.warn('[carentan] 骨架樣板建立失敗，保留靜態士兵', e?.message ?? e);
      return null;
    });
    templates.set(key, p);
    return p;
  }

  function placeholderMaterial() {
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06 });
  }

  /**
   * 生一個小兵。material 由呼叫端提供（每單位一份），沒給就自己開一顆。
   * 回傳 { root, mesh, mixer, apply(speed, ctx), dispose() }，失敗回 null。
   */
  async function spawn({ side = 'blue', weapon = null, material = null, phase = 0 } = {}) {
    const tmpl = await template(side, weapon);
    if (!tmpl) return null;
    const root = skeletonClone(tmpl);
    let mesh = null;
    root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (!mesh) return null;
    mesh.material = material ?? placeholderMaterial();
    mesh.frustumCulled = false;
    if (shadows) mesh.castShadow = true;
    register?.(root);

    const clips = tmpl.userData.clips;
    const speeds = tmpl.userData.speeds;
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map();
    for (const c of clips) {
      const a = mixer.clipAction(c);
      if (c.name === 'hit_fall') { a.loop = THREE.LoopOnce; a.clampWhenFinished = true; }
      actions.set(c.name, a);
    }
    let cur = null;
    const unit = {
      root, mesh, mixer, speeds,
      phase,
      // 同班隨機相位：避免整班齊步
      play(name, timeScale, { fade = 0.28, once = false } = {}) {
        const a = actions.get(name);
        if (!a) return;
        a.timeScale = timeScale;
        if (cur === name) return;
        const prev = cur ? actions.get(cur) : null;
        a.reset();
        a.enabled = true;
        a.setEffectiveTimeScale(timeScale);
        a.setEffectiveWeight(1);
        if (once) { a.loop = THREE.LoopOnce; a.clampWhenFinished = true; }
        a.time = once ? 0 : (phase % Math.max(0.01, a.getClip().duration));
        if (prev && prev !== a) a.crossFadeFrom(prev, fade, false);
        a.play();
        cur = name;
      },
      apply(speed, ctx) {
        const { clip, timeScale, once } = pickClip(speed, ctx, speeds);
        unit.play(clip, timeScale, { once });
      },
      snap() {   // 拖曳時間軸後：立刻對齊，不要留著上一段的交叉淡入
        mixer.stopAllAction();
        cur = null;
      },
      current: () => cur,
      dispose() {
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
        const i = live.indexOf(unit);
        if (i >= 0) live.splice(i, 1);
      },
    };
    live.push(unit);
    return unit;
  }

  return {
    spawn,
    setStride: (n) => { stride = Math.max(1, Math.round(n)); },
    count: () => live.length,
    // mixer 更新頻率依畫質等級（§R5.2：high 每幀、medium 每 2 幀、low 每 3 幀）
    update(dt) {
      acc += dt;
      frame++;
      if (frame % stride !== 0) return;
      const step = acc;
      acc = 0;
      for (const u of live) u.mixer.update(step);
    },
    snapAll() { for (const u of live) u.snap(); },
  };
}
