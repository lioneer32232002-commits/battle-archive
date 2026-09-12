// scripts/assets/build.mjs
//
// 把 assets-src/polyhaven/ 的原始檔壓成 web 版，輸出到 public/ 並產生 public/assets-manifest.json。
//
//   貼圖  → public/tex/<id>_{diff,nor,arm}_{1k,512}.jpg
//   HDRI  → public/hdri/<id>_1k.hdr（原樣）＋ public/hdri/<id>_tm.jpg（2048×1024 q75）
//   模型  → public/models/<id>.glb（gltf-transform optimize，貼圖 512²、Draco）
//   解碼器 → public/draco/（從 node_modules/three/examples/jsm/libs/draco/gltf/ 複製）
//
// 冪等：輸出比來源新就跳過（--force 可強制重做）。

import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

import {
  ROOT, DIRS, MANIFEST_PATH, BUDGET, TEX_SIZES, HDRI_TM_SIZE,
  TEXTURES, HDRIS, MODELS, ASSETS, LICENSE, SOURCE,
  srcDir, srcMetaPath,
} from './manifest.mjs';
import { glbStats, gltfSceneTriangles } from './glb-stats.mjs';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const ONLY = [...args].find((a) => a.startsWith('--only='))?.slice(7);

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');
const warnings = [];
const overBudget = [];

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function sizeOf(p) { return (await fsp.stat(p)).size; }

/** 輸出存在且比來源新 → 可以跳過 */
async function isFresh(out, ...srcs) {
  if (FORCE) return false;
  if (!await exists(out)) return false;
  const o = await fsp.stat(out);
  for (const s of srcs) {
    if (!await exists(s)) continue;
    if ((await fsp.stat(s)).mtimeMs > o.mtimeMs) return false;
  }
  return true;
}

async function readMeta(asset) {
  const p = srcMetaPath(asset);
  if (!await exists(p)) return null;
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// 貼圖
// ---------------------------------------------------------------------------

/**
 * 在預算內編出 JPG。
 * 先在原尺寸降品質（最多 -12），還是超標就降解析度再試 —— 法線／ARM 這種資料型貼圖
 * 被 JPEG 壓出區塊瑕疵的視覺代價遠大於少幾個像素，所以品質下限守在 base-12。
 * 回傳 { buf, quality, px }。
 */
function encodeLadder(px, baseQuality) {
  const steps = [];
  const qs = (b) => [b, b - 4, b - 8, b - 12];
  for (const q of qs(baseQuality)) steps.push({ px, q });
  for (const f of [0.875, 0.75, 0.625, 0.5]) {
    const p = Math.round((px * f) / 32) * 32;
    if (p < 128) continue;
    for (const q of qs(baseQuality)) steps.push({ px: p, q });
  }
  return steps;
}

async function encodeUnderBudget(makePipeline, px, baseQuality, budget, { chroma = '4:4:4' } = {}) {
  let last = null;
  for (const step of encodeLadder(px, baseQuality)) {
    const buf = await makePipeline(step.px)
      .jpeg({ quality: step.q, mozjpeg: true, chromaSubsampling: chroma })
      .toBuffer();
    last = { buf, quality: step.q, px: step.px };
    if (!budget || buf.length <= budget) return last;
  }
  return last;
}

/** 沒有 arm 時，用 Rough（G）＋ AO（R）合成 ARM，B（metal）填 0 */
async function composeArm(meta, dir, px) {
  const roughPath = path.join(dir, meta.files.rough.file);
  const rough = await sharp(roughPath).resize(px, px, { fit: 'fill' }).greyscale().raw().toBuffer();
  let ao;
  if (meta.files.ao) {
    ao = await sharp(path.join(dir, meta.files.ao.file)).resize(px, px, { fit: 'fill' }).greyscale().raw().toBuffer();
  } else {
    ao = Buffer.alloc(px * px, 255);
  }
  const out = Buffer.alloc(px * px * 3);
  for (let i = 0; i < px * px; i++) {
    out[i * 3] = ao[i];
    out[i * 3 + 1] = rough[i];
    out[i * 3 + 2] = 0;
  }
  return { data: out, width: px, height: px, channels: 3 };
}

async function buildTexture(asset) {
  const meta = await readMeta(asset);
  if (!meta) { warnings.push(`${asset.id}：沒有來源（先跑 fetch）`); return null; }
  const dir = srcDir(asset);
  const out = {};

  // diff 走 sRGB q80；nor／arm 是線性資料，q90 且不做色度次取樣
  const slots = [
    { slot: 'diff', quality: 80, chroma: '4:2:0', colorSpace: 'srgb' },
    { slot: 'nor', quality: 90, chroma: '4:4:4', colorSpace: 'linear' },
    { slot: 'arm', quality: 90, chroma: '4:4:4', colorSpace: 'linear' },
  ];

  for (const { slot, quality, chroma, colorSpace } of slots) {
    const composed = slot === 'arm' && meta.armFrom === 'rough+ao';
    const srcFile = composed ? null : path.join(dir, meta.files[slot]?.file ?? '');
    if (!composed && !(await exists(srcFile))) { warnings.push(`${asset.id}：缺 ${slot} 來源`); continue; }

    out[slot] = { colorSpace, sizes: {} };
    for (const { tag, px } of TEX_SIZES) {
      const dest = path.join(DIRS.tex, `${asset.id}_${slot}_${tag}.jpg`);
      if (await isFresh(dest, srcFile ?? srcMetaPath(asset))) {
        out[slot].sizes[tag] = { path: `/tex/${path.basename(dest)}`, bytes: await sizeOf(dest), px };
        continue;
      }
      // encodeUnderBudget 會重複呼叫 factory，ARM 合成先做一次（在 px 尺寸），之後只重縮放與編碼
      let pipelineFactory;
      if (composed) {
        const raw = await composeArm(meta, dir, px);
        pipelineFactory = (p) => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
          .resize(p, p, { fit: 'fill', kernel: 'lanczos3' });
      } else {
        pipelineFactory = (p) => sharp(srcFile).resize(p, p, { fit: 'fill', kernel: 'lanczos3' });
      }

      const { buf, quality: q, px: outPx } = await encodeUnderBudget(pipelineFactory, px, quality, BUDGET.texture, { chroma });
      await fsp.writeFile(dest, buf);
      if (buf.length > BUDGET.texture) {
        overBudget.push({ file: `/tex/${path.basename(dest)}`, bytes: buf.length, budget: BUDGET.texture, note: `已降到 ${outPx}² q${q}` });
      }
      out[slot].sizes[tag] = { path: `/tex/${path.basename(dest)}`, bytes: buf.length, px: outPx, quality: q };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HDRI
// ---------------------------------------------------------------------------

async function buildHdri(asset) {
  const meta = await readMeta(asset);
  if (!meta) { warnings.push(`${asset.id}：沒有來源（先跑 fetch）`); return null; }
  const dir = srcDir(asset);
  const out = {};

  // .hdr 原樣複製
  const hdrSrc = path.join(dir, meta.files.hdr.file);
  const hdrDest = path.join(DIRS.hdri, `${asset.id}_1k.hdr`);
  if (!await isFresh(hdrDest, hdrSrc)) await fsp.copyFile(hdrSrc, hdrDest);
  const hdrBytes = await sizeOf(hdrDest);
  if (hdrBytes > BUDGET.hdr) {
    overBudget.push({ file: `/hdri/${path.basename(hdrDest)}`, bytes: hdrBytes, budget: BUDGET.hdr, note: 'Poly Haven 1k .hdr 原檔，只能改抓更低解析度或轉 HalfFloat EXR' });
  }
  out.hdr = { path: `/hdri/${path.basename(hdrDest)}`, bytes: hdrBytes };

  // tonemapped JPG → 2048×1024
  const tmSrc = path.join(dir, meta.files.tonemapped.file);
  const tmDest = path.join(DIRS.hdri, `${asset.id}_tm.jpg`);
  if (await isFresh(tmDest, tmSrc)) {
    out.tonemapped = { path: `/hdri/${path.basename(tmDest)}`, bytes: await sizeOf(tmDest), px: [HDRI_TM_SIZE.w, HDRI_TM_SIZE.h] };
  } else {
    let buf = null, quality = HDRI_TM_SIZE.quality;
    for (const q of [HDRI_TM_SIZE.quality, 70, 66, 62, 58]) {
      buf = await sharp(tmSrc).resize(HDRI_TM_SIZE.w, HDRI_TM_SIZE.h, { fit: 'fill' })
        .jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
      quality = q;
      if (buf.length <= BUDGET.hdrTonemapped) break;
    }
    await fsp.writeFile(tmDest, buf);
    if (buf.length > BUDGET.hdrTonemapped) {
      overBudget.push({ file: `/hdri/${path.basename(tmDest)}`, bytes: buf.length, budget: BUDGET.hdrTonemapped, note: `已降到 q${quality}` });
    }
    out.tonemapped = { path: `/hdri/${path.basename(tmDest)}`, bytes: buf.length, px: [HDRI_TM_SIZE.w, HDRI_TM_SIZE.h], quality };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------

const CLI = path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

function runCli(cliArgs, { timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--max-old-space-size=12288', CLI, ...cliArgs], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}

/**
 * 送進 gltf-transform 之前先修兩件來源檔的毛病，寫成一份 .prepared.gltf：
 *
 * 1. **葉片 alpha 不見了**：Poly Haven 的 glTF 匯出給的 baseColor 是 .jpg（沒有 alpha
 *    通道），材質卻標 MASK／BLEND（pine_tree_01 更乾脆標成 OPAQUE）。照用的話樹葉是
 *    一片不透明方塊。把 fetch 抓下來的 *_alpha PNG 合進 baseColor，材質改成 MASK
 *    cutoff 0.5 —— 比 BLEND 好：不用排序、可以投影。
 *
 * 2. **一個檔裡塞了好幾棵樹**：針葉樹系列（fir_tree_01、pine_tree_01、
 *    pine_sapling_medium）的 scene 裡並排放了 _a／_b／_c 三個變體（translation x = 0／6／12）。
 *    整份三角形預算被三棵樹分掉，加上 optimize 的 flatten＋join 會把位移烘進頂點，
 *    結果是一叢 18–21 m 寬、其中兩棵只剩一兩百面的殘骸。manifest 的 `keepNodes`
 *    指定要留哪些（例如 ['_a']），其餘的從 scene 拿掉，讓預算全給一棵完整的樹
 *    （被孤立的 mesh／accessor 由 optimize 的 prune 自己清掉）。
 *
 * 回傳實際要送進 gltf-transform 的檔案路徑。
 */
async function prepareModelSource(asset, meta) {
  const dir = srcDir(asset);
  const orig = path.join(dir, meta.files.gltf.file);
  const alphaMaps = Object.values(meta.files.alpha ?? {});
  const keepNodes = asset.keepNodes ?? null;
  if (!alphaMaps.length && !keepNodes) return { input: orig, alphaFixed: [], droppedNodes: [], recentred: [] };

  const json = JSON.parse(await fsp.readFile(orig, 'utf8'));
  const phLower = asset.ph.toLowerCase();
  const fixed = [];
  const dropped = [];
  const recentred = [];

  // ---- 多變體來源只留指定的 node ----
  if (keepNodes) {
    const match = (name) => keepNodes.some((pat) => String(name ?? '').includes(pat));
    for (const scene of json.scenes ?? []) {
      const before = scene.nodes ?? [];
      const after = before.filter((i) => match(json.nodes?.[i]?.name));
      if (!after.length) {
        warnings.push(`${asset.id}：keepNodes ${JSON.stringify(keepNodes)} 一個 node 都沒對到，保持原樣`);
        continue;
      }
      for (const i of before) {
        if (!after.includes(i)) dropped.push(json.nodes?.[i]?.name ?? `#${i}`);
      }
      scene.nodes = after;

      // 變體是並排擺的（x = 0／6／12），留下來的那個往往不在原點上。
      // 規格 §0.4 要求原點在底部中心，所以把位移歸零 —— 網格本身的區域座標
      // 原點就是樹幹底部，歸零之後 bbox 才會對稱落在 x≈0。
      for (const i of after) {
        const node = json.nodes?.[i];
        if (!node) continue;
        if (node.matrix) {
          warnings.push(`${asset.id}：${node.name} 用 matrix 而不是 translation，沒有自動歸位，請自行確認原點`);
          continue;
        }
        const t = node.translation;
        if (t && (t[0] || t[1] || t[2])) {
          node.translation = [0, 0, 0];
          recentred.push(`${node.name}（原 ${t.map((v) => v.toFixed(1)).join(',')}）`);
        }
      }
    }
  }

  for (const mat of json.materials ?? []) {
    const bcIdx = mat.pbrMetallicRoughness?.baseColorTexture?.index;
    if (bcIdx == null) continue;
    const texture = json.textures?.[bcIdx];
    const img = json.images?.[texture?.source];
    if (!img?.uri || img.mimeType === 'image/png') continue;

    const matName = String(mat.name ?? '').toLowerCase();
    const slot = matName.startsWith(phLower) ? matName.slice(phLower.length).replace(/^_/, '') : matName;
    const map = alphaMaps.find((a) => a.slot === slot);
    if (!map) continue;

    const diffPath = path.join(dir, ...img.uri.split('/'));
    const alphaPath = path.join(dir, ...map.file.split('/'));
    if (!await exists(diffPath) || !await exists(alphaPath)) continue;

    const outRel = `textures/${asset.id}_${slot || 'base'}_diffalpha.png`;
    const outPath = path.join(dir, ...outRel.split('/'));
    if (!await exists(outPath) || FORCE) {
      const { width, height } = await sharp(diffPath).metadata();
      // 手動疊 RGBA：sharp 的 joinChannel 疊出來的第 4 個 band 不會被當成 alpha 寫進 PNG，
      // alpha 圖又常是 16-bit 灰階，所以統一轉成 8-bit 再自己交錯。
      const rgb = await sharp(diffPath).removeAlpha().raw().toBuffer();
      const a = await sharp(alphaPath).resize(width, height, { fit: 'fill' })
        .toColourspace('b-w').raw({ depth: 'uchar' }).toBuffer();
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = rgb[i * 3];
        rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgba[i * 4 + 2] = rgb[i * 3 + 2];
        rgba[i * 4 + 3] = a[i];
      }
      await sharp(rgba, { raw: { width, height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    }

    // 另開一張 image／texture，免得跟共用同一張 diff 的其他材質互相影響
    json.images.push({ name: `${asset.id}_${slot || 'base'}_diffalpha`, uri: outRel, mimeType: 'image/png' });
    json.textures.push({ sampler: texture.sampler, source: json.images.length - 1 });
    mat.pbrMetallicRoughness.baseColorTexture.index = json.textures.length - 1;
    mat.alphaMode = 'MASK';
    mat.alphaCutoff = 0.5;
    mat.doubleSided = true;
    fixed.push(mat.name ?? slot);
  }

  if (!fixed.length && !dropped.length && !recentred.length) return { input: orig, alphaFixed: [], droppedNodes: [], recentred: [] };

  const prepared = path.join(dir, `${asset.id}.prepared.gltf`);
  const text = JSON.stringify(json);
  // 內容沒變就別動檔案，免得 mtime 一直更新害 isFresh 永遠不成立
  let same = false;
  if (await exists(prepared)) same = (await fsp.readFile(prepared, 'utf8')) === text;
  if (!same) await fsp.writeFile(prepared, text);
  return { input: prepared, alphaFixed: fixed, droppedNodes: dropped, recentred };
}

/**
 * 自適應壓縮：每輪看是「三角形超標」還是「貼圖太肥」，只動該動的那個旋鈕，
 * 直到同時進體積與面數預算為止。回傳 { best, simplifyStalled, tried }。
 * 桌機高規版（hiVariant）跟一般版走同一套，只是起始貼圖尺寸與預算不同。
 */
async function compressModel({ asset, input, srcTris, triBudget, allowSimplify, baseRatio, startTexture, maxBytes, tag }) {
  const name = asset.id + tag;
  let ratio = baseRatio;
  let texture = startTexture;
  let error = 0.02;
  let best = null;
  let lastTris = null;
  let lastRatio = null;
  let simplifyStalled = false;
  const tried = [];

  for (let i = 0; i < 6; i++) {
    const raw = path.join(DIRS.tmp, `${name}.raw${i}.glb`);
    const tmp = path.join(DIRS.tmp, `${name}.try${i}.glb`);

    // 兩段式：optimize 先做簡化與貼圖（不壓幾何），再單獨跑 draco，
    // 這樣才能調量化位元 —— 預設 position 14／normal 10 對一棵遠景樹太奢侈，
    // 降到 12／8 幾何大小大約砍半，肉眼看不出來。
    const optArgs = [
      'optimize', input, raw,
      '--texture-size', String(texture),
      '--texture-compress', 'webp', // webp 有 alpha 又比 jpeg 小；three 的 GLTFLoader 支援 EXT_texture_webp
      '--compress', 'false',
      '--simplify-error', String(error),
    ];
    if (ratio < 1) optArgs.push('--simplify-ratio', ratio.toFixed(5));
    else optArgs.push('--simplify', 'false');

    process.stdout.write(`  model   ${name.padEnd(24)} 第 ${i + 1} 輪（來源 ${srcTris.toLocaleString()} 面，ratio ${ratio.toFixed(4)}、tex ${texture}）… `);
    let r = await runCli(optArgs);
    if (r.code === 0 && await exists(raw)) {
      r = await runCli([
        'draco', raw, tmp,
        '--method', 'edgebreaker',
        '--quantize-position', '12',
        '--quantize-normal', '8',
        '--quantize-texcoord', '10',
        '--quantize-generic', '8',
      ]);
      await fsp.rm(raw, { force: true });
    }
    if (r.code !== 0 || !(await exists(tmp))) {
      console.log('失敗');
      warnings.push(`${name}：gltf-transform 第 ${i + 1} 輪失敗（code ${r.code}）${(r.err || r.out).split('\n').filter(Boolean).slice(-2).join(' / ')}`);
      break;
    }
    const bytes = await sizeOf(tmp);
    let stats;
    try { stats = await glbStats(tmp); } catch (e) { stats = { triangles: -1, materials: -1, textures: -1, maxTextureSize: -1, textureSizes: [], error: e.message }; }
    console.log(`${fmt(bytes)} / ${stats.triangles.toLocaleString()} 面`);
    tried.push(tmp);

    const cand = { tmp, bytes, stats, attempt: i + 1, params: { ratio, texture, error } };
    // 取捨：迴圈是由好到差跑的，一旦有候選進了體積預算就守住它，後面就算更小也不換
    //（貼圖白降一級沒有意義）。全都超標時才退而取最小的那個。
    const underSize = bytes <= maxBytes;
    if (!best) best = cand;
    else if (underSize && best.bytes > maxBytes) best = cand;
    else if (!underSize && best.bytes > maxBytes && bytes < best.bytes) best = cand;
    if (underSize && (!allowSimplify || stats.triangles <= triBudget)) break;

    // Poly Haven 的掃描樹是幾萬個互不相連的葉片小塊，meshoptimizer 的 simplify
    // 不會整塊刪掉，所以降 ratio 到某個點之後三角形就不動了。偵測到卡住就別再浪費
    // 一輪（大樹一輪要好幾分鐘），改去動貼圖尺寸。
    // 只有在「這輪真的調低了 ratio」卻幾乎沒少面數時才算卡住；
    // 純粹降貼圖尺寸的那幾輪面數本來就不會動，不能算進去。
    if (lastRatio != null && ratio < lastRatio && stats.triangles > lastTris * 0.95) simplifyStalled = true;
    lastTris = stats.triangles;
    lastRatio = ratio;

    if (!allowSimplify) {
      if (texture > 128) texture /= 2;
      else break;
    } else if (stats.triangles > triBudget && !simplifyStalled) {
      ratio = Math.max(0.0002, ratio * (triBudget / stats.triangles) * 0.85);
      error = Math.min(0.2, error * 2.5);
    } else if (texture > 128) {
      texture /= 2;
    } else if (!simplifyStalled) {
      ratio = Math.max(0.0002, ratio * 0.5);
      error = Math.min(0.2, error * 2);
    } else {
      break; // 兩個旋鈕都轉到底了
    }
  }

  return best ? { best, simplifyStalled, tried } : null;
}

/** keepNodes 之下，來源 scene 裡有哪些 node 會被丟掉（純讀取，沒有副作用） */
async function droppedNodeNames(asset, origGltf) {
  if (!asset.keepNodes) return [];
  try {
    const json = JSON.parse(await fsp.readFile(origGltf, 'utf8'));
    const match = (name) => asset.keepNodes.some((pat) => String(name ?? '').includes(pat));
    const out = [];
    for (const scene of json.scenes ?? []) {
      const kept = (scene.nodes ?? []).filter((i) => match(json.nodes?.[i]?.name));
      if (!kept.length) continue;
      for (const i of scene.nodes ?? []) {
        if (!kept.includes(i)) out.push(json.nodes?.[i]?.name ?? `#${i}`);
      }
    }
    return out;
  } catch { return []; }
}

async function buildModel(asset) {
  const meta = await readMeta(asset);
  if (!meta) { warnings.push(`${asset.id}：沒有來源（先跑 fetch）`); return null; }
  const dir = srcDir(asset);
  const orig = path.join(dir, meta.files.gltf.file);
  const dest = path.join(DIRS.models, `${asset.id}.glb`);

  const hiDestPath = path.join(DIRS.models, `${asset.id}_hi.glb`);
  const hiWanted = !!asset.hiVariant;
  if (await isFresh(dest, orig, srcMetaPath(asset)) && (!hiWanted || await isFresh(hiDestPath, orig, srcMetaPath(asset)))) {
    const stats = await glbStats(dest);
    let hi = null;
    if (hiWanted) {
      const hs = await glbStats(hiDestPath);
      hi = {
        path: `/models/${asset.id}_hi.glb`, bytes: await sizeOf(hiDestPath),
        triangles: hs.triangles, textureSize: hs.maxTextureSize,
        bboxSize: hs.bbox?.size ?? null, alphaMaterials: hs.alpha?.ok ?? [],
      };
    }
    return {
      glb: { path: `/models/${asset.id}.glb`, bytes: await sizeOf(dest) },
      glbHi: hi,
      stats, reused: true,
      alphaMaterials: stats.alpha?.ok ?? [],
      alphaFixed: (stats.alpha?.ok ?? []).map((a) => a.name),
      // 沿用既有檔時也要把當初砍掉哪些 node 算出來，manifest 才不會寫成空陣列
      droppedNodes: await droppedNodeNames(asset, orig),
    };
  }

  const { input, alphaFixed, droppedNodes } = await prepareModelSource(asset, meta);
  if (droppedNodes?.length) {
    console.log(`  model   ${asset.id.padEnd(22)} keepNodes ${JSON.stringify(asset.keepNodes)}：丟掉 ${droppedNodes.join('、')}`);
  }
  if (alphaFixed.length) console.log(`  model   ${asset.id.padEnd(22)} 修好 alpha：${alphaFixed.join('、')}（改 MASK cutoff 0.5）`);

  // 用 prepared（keepNodes 砍完變體之後）的檔算來源面數，simplify ratio 才會對準
  // 真正要壓的那一棵樹，而不是被砍掉的變體一起分走預算
  const json = JSON.parse(await fsp.readFile(input, 'utf8'));
  const srcTris = gltfSceneTriangles(json);
  const triBudget = asset.triBudget ?? 20000;
  // simplify: false → 完全不簡化，只靠貼圖尺寸控體積。給「幾何本來就不大、
  // 或簡化會毀掉外形」的模型用（例如細碎的地被草株）。
  const allowSimplify = asset.simplify !== false;
  const baseRatio = allowSimplify
    ? Math.min(1, Math.max(0.0002, triBudget / Math.max(1, srcTris)))
    : 1;

  await fsp.mkdir(DIRS.tmp, { recursive: true });

  const run = await compressModel({
    asset, input, srcTris, triBudget, allowSimplify, baseRatio,
    startTexture: 512, maxBytes: BUDGET.model, tag: '',
  });
  if (!run) { warnings.push(`${asset.id}：全部嘗試失敗，沒有產出 glb`); return null; }
  const { best, simplifyStalled, tried } = run;

  await fsp.copyFile(best.tmp, dest);
  for (const t of tried) await fsp.rm(t, { force: true });

  const alphaOk = best.stats.alpha ?? { ok: [], broken: [] };
  for (const b of alphaOk.broken) {
    warnings.push(`${asset.id}：材質 ${b.name}（${b.mode}）${b.reason} —— 葉片會變不透明`);
  }

  if (best.bytes > BUDGET.model) {
    overBudget.push({
      file: `/models/${asset.id}.glb`, bytes: best.bytes, budget: BUDGET.model,
      note: `跑到第 ${best.attempt} 輪（ratio ${best.params.ratio.toFixed(4)}、貼圖 ${best.params.texture}²、${best.stats.triangles} 面、${best.stats.textures} 張貼圖）；` +
        `再小只能降 manifest 的 triBudget，或改成只留 baseColor（丟掉 normal／arm）`,
    });
  }
  if (allowSimplify && best.stats.triangles > triBudget) {
    warnings.push(`${asset.id}：三角形 ${best.stats.triangles} > 預算 ${triBudget}；` +
      (simplifyStalled
        ? '簡化已到極限：再降 ratio 也不減面，這就是這個來源的下限'
          + '（掃描模型常見 —— 葉片是幾萬個互不相連的小塊，或頂點分裂到 weld 合不起來，兩種 meshoptimizer 都收不動）'
        : 'meshoptimizer 受 error 上限限制'));
  }

  // 桌機高規版：招牌場景（例如巴斯通的森林）近看時，128² 貼圖＋1.7 萬面的樹
  // 只剩「電線桿加黑點」。hiVariant 給那幾棵單獨放寬預算，手機仍載一般版。
  let hi = null;
  if (asset.hiVariant) {
    const hv = asset.hiVariant;
    const hiDest = path.join(DIRS.models, `${asset.id}_hi.glb`);
    const hiTri = hv.triBudget ?? 50000;
    const hiRun = await compressModel({
      asset, input, srcTris,
      triBudget: hiTri,
      allowSimplify,
      baseRatio: allowSimplify ? Math.min(1, Math.max(0.0002, hiTri / Math.max(1, srcTris))) : 1,
      startTexture: hv.textureSize ?? 512,
      maxBytes: hv.maxBytes ?? 1.2e6,
      tag: '_hi',
    });
    if (!hiRun) {
      warnings.push(`${asset.id}_hi：高規版全部嘗試失敗`);
    } else {
      await fsp.copyFile(hiRun.best.tmp, hiDest);
      for (const t of hiRun.tried) await fsp.rm(t, { force: true });
      const hiAlpha = hiRun.best.stats.alpha ?? { ok: [], broken: [] };
      for (const b of hiAlpha.broken) {
        warnings.push(`${asset.id}_hi：材質 ${b.name}（${b.mode}）${b.reason} —— 葉片會變不透明`);
      }
      if (hiRun.best.bytes > (hv.maxBytes ?? 1.2e6)) {
        overBudget.push({
          file: `/models/${asset.id}_hi.glb`, bytes: hiRun.best.bytes, budget: hv.maxBytes ?? 1.2e6,
          note: `高規版跑到第 ${hiRun.best.attempt} 輪（貼圖 ${hiRun.best.params.texture}²、${hiRun.best.stats.triangles} 面）`,
        });
      }
      hi = {
        path: `/models/${asset.id}_hi.glb`,
        bytes: hiRun.best.bytes,
        triangles: hiRun.best.stats.triangles,
        textureSize: hiRun.best.stats.maxTextureSize,
        bboxSize: hiRun.best.stats.bbox?.size ?? null,
        alphaMaterials: hiAlpha.ok,
      };
    }
  }

  return {
    glb: { path: `/models/${asset.id}.glb`, bytes: best.bytes },
    glbHi: hi,
    stats: best.stats,
    sourceTriangles: srcTris,
    alphaFixed,
    droppedNodes: droppedNodes ?? [],
    alphaMaterials: alphaOk.ok,
  };
}

// ---------------------------------------------------------------------------
// Draco 解碼器
// ---------------------------------------------------------------------------

async function copyDraco() {
  const from = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
  if (!await exists(from)) { warnings.push('找不到 three 的 draco 解碼器目錄'); return []; }
  await fsp.mkdir(DIRS.draco, { recursive: true });
  const copied = [];
  for (const f of await fsp.readdir(from)) {
    const s = path.join(from, f), d = path.join(DIRS.draco, f);
    if (!(await fsp.stat(s)).isFile()) continue;
    if (!await isFresh(d, s)) await fsp.copyFile(s, d);
    copied.push({ path: `/draco/${f}`, bytes: await sizeOf(d) });
  }
  return copied;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function run() {
  for (const d of [DIRS.tex, DIRS.hdri, DIRS.models, DIRS.draco, DIRS.tmp]) {
    await fsp.mkdir(d, { recursive: true });
  }

  const want = (a) => !ONLY || a.id === ONLY || a.ph === ONLY || a.type === ONLY;
  const entries = {};
  const totals = { texture: { n: 0, bytes: 0 }, hdri: { n: 0, bytes: 0 }, model: { n: 0, bytes: 0 } };

  const base = (a) => ({
    id: a.id,
    type: a.type,
    use: a.use,
    battles: a.battles,
    source: SOURCE,
    sourceId: a.ph,
    sourceUrl: `https://polyhaven.com/a/${a.ph}`,
    license: LICENSE,
  });

  console.log('[build] 貼圖');
  for (const a of TEXTURES.filter(want)) {
    const maps = await buildTexture(a);
    if (!maps) continue;
    const desktop = {}, mobile = {};
    let bytes = 0;
    for (const [slot, m] of Object.entries(maps)) {
      if (m.sizes['1k']) { desktop[slot] = { path: m.sizes['1k'].path, bytes: m.sizes['1k'].bytes, px: m.sizes['1k'].px, colorSpace: m.colorSpace }; bytes += m.sizes['1k'].bytes; }
      if (m.sizes['512']) { mobile[slot] = { path: m.sizes['512'].path, bytes: m.sizes['512'].bytes, px: m.sizes['512'].px, colorSpace: m.colorSpace }; bytes += m.sizes['512'].bytes; }
    }
    entries[a.id] = { ...base(a), maps: Object.keys(maps), files: { desktop, mobile } };
    totals.texture.n++; totals.texture.bytes += bytes;
    console.log(`  texture ${a.id.padEnd(24)} ${Object.keys(maps).join('/')}  ${fmt(bytes)}`);
  }

  console.log('[build] HDRI');
  for (const a of HDRIS.filter(want)) {
    const f = await buildHdri(a);
    if (!f) continue;
    entries[a.id] = {
      ...base(a), phase: a.phase,
      files: {
        desktop: { hdr: f.hdr, tonemapped: f.tonemapped },
        mobile: { tonemapped: f.tonemapped },
      },
    };
    const bytes = f.hdr.bytes + f.tonemapped.bytes;
    totals.hdri.n++; totals.hdri.bytes += bytes;
    console.log(`  hdri    ${a.id.padEnd(38)} hdr ${fmt(f.hdr.bytes)} / tm ${fmt(f.tonemapped.bytes)}`);
  }

  console.log('[build] 模型');
  for (const a of MODELS.filter(want)) {
    const m = await buildModel(a);
    if (!m) continue;
    entries[a.id] = {
      ...base(a),
      draco: true,
      triBudget: a.triBudget,
      simplified: a.simplify !== false,
      // 來源檔裡有多個變體時，只留下這些 node（其餘在壓縮前就拿掉）
      keepNodes: a.keepNodes ?? null,
      droppedNodes: m.droppedNodes ?? [],
      sourceTriangles: m.sourceTriangles,
      stats: {
        triangles: m.stats.triangles,
        materials: m.stats.materials,
        textures: m.stats.textures,
        maxTextureSize: m.stats.maxTextureSize,
        // 公尺。整合端據此對齊縮放，也可以一眼看出模型是不是被壓扁了
        bboxSize: m.stats.bbox?.size ?? null,
        bboxMin: m.stats.bbox?.min ?? null,
        bboxMax: m.stats.bbox?.max ?? null,
      },
      // 有葉片 alpha 的材質；整合端請用 alphaTest（MASK）而不是 transparent，桌機可開 castShadow
      alphaMaterials: m.alphaMaterials ?? [],
      alphaFixed: m.alphaFixed ?? [],
      hiVariant: a.hiVariant ?? null,
      // 桌機另有高規版時放在 glb_hi；手機一律用 glb
      files: {
        desktop: m.glbHi ? { glb: m.glb, glb_hi: m.glbHi } : { glb: m.glb },
        mobile: { glb: m.glb },
      },
    };
    totals.model.n++; totals.model.bytes += m.glb.bytes + (m.glbHi?.bytes ?? 0);
    if (m.reused) console.log(`  model   ${a.id.padEnd(22)} 沿用既有 ${fmt(m.glb.bytes)} / ${m.stats.triangles} 三角形`);
  }

  const draco = await copyDraco();

  const byBattle = {};
  for (const e of Object.values(entries)) {
    for (const b of e.battles ?? []) (byBattle[b] ??= []).push(e.id);
  }
  const byType = {};
  for (const e of Object.values(entries)) (byType[e.type] ??= []).push(e.id);

  const manifest = {
    generatedAt: new Date().toISOString(),
    spec: 'docs/asset-pipeline-spec.md §1',
    source: SOURCE,
    license: LICENSE,
    licenseNote: '全部資產為 Poly Haven CC0，可自由使用、修改、商用，不需署名（本專案仍於 manifest 保留來源）。',
    budgets: BUDGET,
    draco: { decoderPath: '/draco/', files: draco },
    totals: {
      texture: { count: totals.texture.n, bytes: totals.texture.bytes },
      hdri: { count: totals.hdri.n, bytes: totals.hdri.bytes },
      model: { count: totals.model.n, bytes: totals.model.bytes },
    },
    byType,
    byBattle,
    assets: entries,
  };

  // 不要把別人登記的東西洗掉：
  //   --only 模式 → 本次沒跑到的一律留著
  //   完整跑     → 留下不屬於本管線 curated 清單的條目（例如 scripts/blender 產出的 glb）
  if (await exists(MANIFEST_PATH)) {
    const prev = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'));
    const mine = new Set(ASSETS.map((a) => a.id));
    const kept = {};
    for (const [id, e] of Object.entries(prev.assets ?? {})) {
      if (entries[id]) continue;
      if (ONLY || !mine.has(id)) kept[id] = e;
    }
    if (Object.keys(kept).length) {
      manifest.assets = { ...kept, ...entries };
      for (const e of Object.values(kept)) {
        for (const b of e.battles ?? []) (manifest.byBattle[b] ??= []).push(e.id);
        (manifest.byType[e.type] ??= []).push(e.id);
      }
      console.log(`[build] 保留 ${Object.keys(kept).length} 筆本次沒重做／非本管線登記的資產`);
    }
  }

  await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  await fsp.rm(DIRS.tmp, { recursive: true, force: true });

  console.log('\n[build] 完成');
  for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(8)} ${v.n} 筆，${fmt(v.bytes)}`);
  console.log(`  draco    ${draco.length} 檔`);
  console.log(`  manifest ${path.relative(ROOT, MANIFEST_PATH)}`);

  if (overBudget.length) {
    console.log(`\n[build] 超出預算 ${overBudget.length} 檔：`);
    for (const o of overBudget) console.log(`  - ${o.file} ${fmt(o.bytes)} > ${fmt(o.budget)}｜${o.note}`);
  }
  if (warnings.length) {
    console.log(`\n[build] 警告 ${warnings.length} 則：`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
