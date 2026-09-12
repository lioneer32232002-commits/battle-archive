// scripts/assets/glb-stats.mjs
//
// 讀 .glb（含 Draco 壓縮）並回報三角形數、材質數、貼圖尺寸。
// build.mjs 與 verify.mjs 共用。

import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

let ioPromise = null;

export async function getIO() {
  if (!ioPromise) {
    ioPromise = (async () => {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      io.registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
      });
      return io;
    })();
  }
  return ioPromise;
}

/** 回傳 { triangles, meshes, primitives, materials, textures, maxTextureSize, textureSizes } */
export async function glbStats(file) {
  const io = await getIO();
  const doc = await io.read(file);
  const root = doc.getRoot();

  let triangles = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const mode = prim.getMode();
      // 4 = TRIANGLES
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      if (mode === 4) triangles += count / 3;
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }

  const textureSizes = [];
  for (const tex of root.listTextures()) {
    const size = tex.getSize();
    textureSizes.push({ name: tex.getName() || tex.getURI() || '(inline)', w: size?.[0] ?? 0, h: size?.[1] ?? 0, mime: tex.getMimeType() });
  }

  // alpha 保命檢查：MASK／BLEND 材質的 baseColor 若沒有 alpha 通道，葉片會變成不透明方塊
  const alpha = { ok: [], broken: [] };
  for (const mat of root.listMaterials()) {
    const mode = mat.getAlphaMode();
    if (mode === 'OPAQUE') continue;
    const name = mat.getName() || '(unnamed)';
    const tex = mat.getBaseColorTexture();
    if (!tex) { alpha.broken.push({ name, mode, reason: '沒有 baseColorTexture' }); continue; }
    try {
      const md = await sharp(Buffer.from(tex.getImage())).metadata();
      if (md.hasAlpha || md.channels === 4) alpha.ok.push({ name, mode, cutoff: mat.getAlphaCutoff() });
      else alpha.broken.push({ name, mode, reason: `baseColor 是 ${md.channels} 通道，沒有 alpha` });
    } catch (e) {
      alpha.broken.push({ name, mode, reason: '讀不到 baseColor 影像：' + e.message });
    }
  }

  // 場景 bounding box（公尺）。壓完要拿來對照原檔，確認簡化沒有把模型壓扁。
  let bbox = null;
  try {
    const scene = root.listScenes()[0];
    if (scene) {
      const b = getBounds(scene);
      bbox = {
        min: b.min.map((v) => +v.toFixed(4)),
        max: b.max.map((v) => +v.toFixed(4)),
        size: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(4)),
      };
    }
  } catch { /* 沒有 scene 就算了 */ }

  return {
    triangles: Math.round(triangles),
    bbox,
    meshes: root.listMeshes().length,
    primitives,
    materials: root.listMaterials().length,
    textures: textureSizes.length,
    maxTextureSize: textureSizes.reduce((m, t) => Math.max(m, t.w, t.h), 0),
    textureSizes,
    alpha,
  };
}

/**
 * 只靠 .gltf 的 JSON 估算三角形數（不載入 .bin）。
 * 有 scene 就沿著 scene → node → mesh 走，只算「真的會被輸出」的部分 ——
 * keepNodes 砍掉變體之後，這個數字才會反映實際要壓的那一棵樹。
 */
export function gltfSceneTriangles(json) {
  const scene = json.scenes?.[json.scene ?? 0];
  if (!scene?.nodes?.length) return gltfTrianglesFromJson(json);
  let tris = 0;
  const seen = new Set();
  const walk = (idx) => {
    if (seen.has(idx)) return;
    seen.add(idx);
    const node = json.nodes?.[idx];
    if (!node) return;
    if (node.mesh != null) tris += meshTriangles(json, json.meshes?.[node.mesh]);
    for (const c of node.children ?? []) walk(c);
  };
  for (const n of scene.nodes) walk(n);
  return Math.round(tris);
}

function meshTriangles(json, mesh) {
  let tris = 0;
  for (const prim of mesh?.primitives ?? []) {
    const mode = prim.mode ?? 4;
    let count = 0;
    if (prim.indices != null) count = json.accessors?.[prim.indices]?.count ?? 0;
    else if (prim.attributes?.POSITION != null) count = json.accessors?.[prim.attributes.POSITION]?.count ?? 0;
    if (mode === 4) tris += count / 3;
    else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
  }
  return tris;
}

/** 加總 json.meshes 全部的三角形（不管 scene 有沒有引用） */
export function gltfTrianglesFromJson(json) {
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      let count = 0;
      if (prim.indices != null) count = json.accessors?.[prim.indices]?.count ?? 0;
      else if (prim.attributes?.POSITION != null) count = json.accessors?.[prim.attributes.POSITION]?.count ?? 0;
      if (mode === 4) tris += count / 3;
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  return Math.round(tris);
}
