// scripts/assets/verify.mjs
//
// 最小驗證：
//   1. public/assets-manifest.json 裡登記的每個檔案都存在
//   2. 大小在 docs/asset-pipeline-spec.md §0.2 的預算內（貼圖 350 KB、hdr 1.6 MB、glb 300 KB）
//   3. 每個 .glb 用 @gltf-transform/core 讀出來，印三角形數、材質數、貼圖尺寸
//
// 超預算會列出並建議該調哪個參數。有問題時 exit code 1。

import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT, MANIFEST_PATH, BUDGET } from './manifest.mjs';
import { glbStats } from './glb-stats.mjs';

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');
const abs = (webPath) => path.join(ROOT, 'public', webPath.replace(/^\//, ''));

function budgetFor(webPath) {
  if (webPath.endsWith('.hdr')) return { limit: BUDGET.hdr, kind: 'hdr', hint: '改抓更低解析度的 .hdr，或桌機也改用 tonemapped JPG 當 env' };
  if (webPath.startsWith('/hdri/')) return { limit: BUDGET.hdrTonemapped, kind: 'hdri-tm', hint: '調低 HDRI_TM_SIZE.quality，或縮到 1024×512' };
  if (webPath.startsWith('/tex/')) return { limit: BUDGET.texture, kind: 'texture', hint: 'build.mjs 的 slots 調低起始 quality（encodeLadder 已會自動降解析度）' };
  if (webPath.endsWith('.glb')) return { limit: BUDGET.model, kind: 'model', hint: 'manifest.mjs 該筆調低 triBudget；貼圖已降到 128² 還是超標，就把該模型的 normal／arm 貼圖拿掉只留 baseColor' };
  return null;
}

function collectFiles(entry) {
  const out = [];
  for (const [profile, slots] of Object.entries(entry.files ?? {})) {
    for (const [slot, f] of Object.entries(slots ?? {})) {
      if (f?.path) out.push({ profile, slot, path: f.path, bytes: f.bytes });
    }
  }
  return out;
}

async function run() {
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    console.error(`[verify] 讀不到 ${path.relative(ROOT, MANIFEST_PATH)}：${e.message}（先跑 npm run assets）`);
    process.exit(1);
  }

  const missing = [];
  const over = [];
  const mismatched = [];
  const seen = new Set();
  let totalBytes = 0;
  const byType = {};

  for (const entry of Object.values(manifest.assets ?? {})) {
    for (const f of collectFiles(entry)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const p = abs(f.path);
      let st;
      try { st = await fsp.stat(p); } catch { missing.push({ id: entry.id, path: f.path }); continue; }
      totalBytes += st.size;
      (byType[entry.type] ??= { count: 0, bytes: 0 });
      byType[entry.type].count++; byType[entry.type].bytes += st.size;

      if (f.bytes != null && f.bytes !== st.size) mismatched.push({ path: f.path, manifest: f.bytes, disk: st.size });
      // 桌機高規版有自己的上限（manifest 的 hiVariant.maxBytes），不適用 300 KB
      const b = f.slot === 'glb_hi'
        ? {
            limit: entry.hiVariant?.maxBytes ?? 1.2e6, kind: 'model-hi',
            hint: 'manifest.mjs 該筆調低 hiVariant.triBudget 或 hiVariant.textureSize',
          }
        : budgetFor(f.path);
      if (b && st.size > b.limit) over.push({ id: entry.id, path: f.path, bytes: st.size, ...b });
    }
  }

  // draco 解碼器
  for (const f of manifest.draco?.files ?? []) {
    try { await fsp.stat(abs(f.path)); } catch { missing.push({ id: 'draco', path: f.path }); }
  }
  if (!(manifest.draco?.files ?? []).some((f) => f.path.endsWith('draco_decoder.wasm'))) {
    console.warn('[verify] 警告：public/draco/ 沒有 draco_decoder.wasm，DRACOLoader 會退回較慢的 JS 解碼');
  }

  console.log(`[verify] manifest 產生於 ${manifest.generatedAt}`);
  console.log(`[verify] ${Object.keys(manifest.assets ?? {}).length} 個資產、${seen.size} 個檔案、合計 ${fmt(totalBytes)}`);
  for (const [t, v] of Object.entries(byType)) console.log(`  ${t.padEnd(8)} ${String(v.count).padStart(3)} 檔  ${fmt(v.bytes)}`);

  // ---- glb 統計 ----
  const models = Object.values(manifest.assets ?? {}).filter((e) => e.type === 'model');
  const alphaBroken = [];
  if (models.length) {
    console.log('\n[verify] 模型統計');
    console.log('  ' + 'id'.padEnd(22) + 'bytes'.padStart(10) + 'tris'.padStart(10) + 'mat'.padStart(5) + 'tex'.padStart(5) + '  貼圖尺寸 / alpha 材質');
    for (const e of models) {
      const p = abs(e.files.desktop.glb.path);
      try {
        const st = await fsp.stat(p);
        const s = await glbStats(p);
        const sizes = [...new Set(s.textureSizes.map((t) => `${t.w}×${t.h}`))].join(' ');
        const flag = st.size > BUDGET.model ? ' ⚠ 超預算' : '';
        // simplified === false 的模型是刻意不簡化的，面數上限對它沒有意義
        const triFlag = e.simplified !== false && e.triBudget && s.triangles > e.triBudget
          ? ` ⚠ >${e.triBudget}` : '';
        const a = s.alpha ?? { ok: [], broken: [] };
        const alphaNote = a.ok.length ? `｜alpha ok: ${a.ok.map((x) => `${x.name}(${x.mode})`).join(' ')}` : '';
        const bbox = s.bbox ? `｜bbox ${s.bbox.size.map((v) => v.toFixed(2)).join('×')} m` : '';
        console.log('  ' + e.id.padEnd(22) + fmt(st.size).padStart(10) + s.triangles.toLocaleString().padStart(10) +
          String(s.materials).padStart(5) + String(s.textures).padStart(5) + '  ' + sizes + flag + triFlag + bbox + alphaNote);
        for (const b of a.broken) alphaBroken.push({ id: e.id, ...b });

        // 桌機高規版
        const hiRef = e.files?.desktop?.glb_hi;
        if (hiRef?.path) {
          const hp = abs(hiRef.path);
          const hst = await fsp.stat(hp);
          const hs = await glbStats(hp);
          const hsizes = [...new Set(hs.textureSizes.map((t) => `${t.w}×${t.h}`))].join(' ');
          const hlimit = e.hiVariant?.maxBytes ?? 1.2e6;
          const ha = hs.alpha ?? { ok: [], broken: [] };
          console.log('  ' + (e.id + '_hi').padEnd(22) + fmt(hst.size).padStart(10) + hs.triangles.toLocaleString().padStart(10) +
            String(hs.materials).padStart(5) + String(hs.textures).padStart(5) + '  ' + hsizes +
            (hst.size > hlimit ? ' ⚠ 超預算' : '') +
            (hs.bbox ? `｜bbox ${hs.bbox.size.map((v) => v.toFixed(2)).join('×')} m` : '') +
            (ha.ok.length ? `｜alpha ok: ${ha.ok.map((x) => `${x.name}(${x.mode})`).join(' ')}` : ''));
          for (const b of ha.broken) alphaBroken.push({ id: e.id + '_hi', ...b });
        }
      } catch (err) {
        console.log('  ' + e.id.padEnd(22) + '讀取失敗：' + err.message);
        missing.push({ id: e.id, path: e.files.desktop.glb.path, error: err.message });
      }
    }
  }
  if (alphaBroken.length) {
    console.error(`\n[verify] alpha 有問題 ${alphaBroken.length} 個（葉片會變不透明方塊）：`);
    for (const b of alphaBroken) console.error(`  - ${b.id} / ${b.name}（${b.mode}）：${b.reason}`);
  }

  let bad = false;
  if (missing.length) {
    bad = true;
    console.error(`\n[verify] 缺檔 ${missing.length} 個：`);
    for (const m of missing) console.error(`  - ${m.id}: ${m.path}${m.error ? '（' + m.error + '）' : ''}`);
  }
  if (mismatched.length) {
    bad = true;
    console.error(`\n[verify] manifest 大小與實際不符 ${mismatched.length} 個（重跑 build）：`);
    for (const m of mismatched) console.error(`  - ${m.path}: manifest ${m.manifest} / 實際 ${m.disk}`);
  }
  if (over.length) {
    console.error(`\n[verify] 超出預算 ${over.length} 個：`);
    for (const o of over) {
      console.error(`  - ${o.path}  ${fmt(o.bytes)} > ${fmt(o.limit)}（${o.kind}）`);
      console.error(`      建議：${o.hint}`);
    }
  } else {
    console.log('\n[verify] 所有檔案都在預算內');
  }

  if (bad) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
