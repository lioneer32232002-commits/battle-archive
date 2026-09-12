// scripts/assets/fetch.mjs
//
// 依 manifest.mjs 到 Poly Haven 抓原始檔，落在 assets-src/polyhaven/<type>/<id>/。
// 這個目錄已 gitignore，可隨時整個刪掉重抓。
//
//   貼圖：1k 的 Diffuse / nor_gl / arm（jpg）；沒有 arm 就抓 Rough ＋ AO，交給 build 合成
//   HDRI：1k .hdr ＋ tonemapped JPG
//   模型：1k gltf ＋ include 內全部檔案（textures/ 子資料夾，維持相對路徑）
//
// 已存在且 md5 相符的檔直接跳過；並行下載上限 CONCURRENCY。
// 冪等，可重跑。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import {
  ASSETS, API_BASE, CONCURRENCY, LICENSE, SOURCE,
  srcDir, srcMetaPath,
} from './manifest.mjs';

const args = new Set(process.argv.slice(2));
const ONLY = [...args].find((a) => a.startsWith('--only='))?.slice(7);
const FORCE = args.has('--force');

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function md5File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function withRetry(label, fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < tries - 1) {
        const wait = 800 * 2 ** i;
        console.warn(`  ! ${label} 失敗（${e.message}），${wait} ms 後重試 ${i + 2}/${tries}`);
        await sleep(wait);
      }
    }
  }
  throw last;
}

async function apiFiles(ph) {
  return withRetry(`API ${ph}`, async () => {
    const res = await fetch(API_BASE + encodeURIComponent(ph), {
      headers: { 'User-Agent': 'battle-archive-asset-pipeline/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

/** 下載一個檔；md5 相符就跳過。回傳 'skip' | 'get' */
async function download(job) {
  const { url, dest, md5, size } = job;
  if (!FORCE && await exists(dest)) {
    if (!md5) return 'skip';
    const have = await md5File(dest);
    if (have === md5) return 'skip';
    console.warn(`  ! ${path.basename(dest)} md5 不符，重抓`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await withRetry(path.basename(dest), async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'battle-archive-asset-pipeline/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    if (md5) {
      const got = await md5File(tmp);
      if (got !== md5) throw new Error(`md5 不符（期望 ${md5.slice(0, 8)} 得到 ${got.slice(0, 8)}）`);
    }
    const st = await fsp.stat(tmp);
    if (size && Math.abs(st.size - size) > 0 && !md5) throw new Error(`大小不符 ${st.size} != ${size}`);
    await fsp.rename(tmp, dest);
  });
  return 'get';
}

/** 並行上限 n 的工作池 */
async function pool(items, n, worker) {
  const queue = [...items];
  const running = [];
  const results = [];
  async function next() {
    const item = queue.shift();
    if (item === undefined) return;
    results.push(await worker(item));
    return next();
  }
  for (let i = 0; i < Math.min(n, items.length); i++) running.push(next());
  await Promise.all(running);
  return results;
}

// ---------------------------------------------------------------------------
// 依型別決定要抓哪些檔
// ---------------------------------------------------------------------------

function pickTex(files, key, res) {
  const node = files?.[key];
  if (!node) return null;
  const r = node[res] ?? node['1k'];
  return r?.jpg ?? null;
}

function planTexture(asset, files) {
  const dir = srcDir(asset);
  const jobs = [];
  const meta = {};
  let armFrom = 'arm';

  const diff = pickTex(files, 'Diffuse', asset.res) ?? pickTex(files, 'diff', asset.res);
  if (!diff) throw new Error(`${asset.ph}：找不到 Diffuse 1k jpg`);
  const nor = pickTex(files, 'nor_gl', asset.res);
  if (!nor) throw new Error(`${asset.ph}：找不到 nor_gl 1k jpg`);
  const arm = pickTex(files, 'arm', asset.res);

  const add = (slot, entry) => {
    const file = `${asset.id}_${slot}_${asset.res}.jpg`;
    jobs.push({ url: entry.url, dest: path.join(dir, file), md5: entry.md5, size: entry.size });
    meta[slot] = { file, url: entry.url, md5: entry.md5, size: entry.size };
  };

  add('diff', diff);
  add('nor', nor);
  if (arm) {
    add('arm', arm);
  } else {
    armFrom = 'rough+ao';
    const rough = pickTex(files, 'Rough', asset.res) ?? pickTex(files, 'rough', asset.res);
    if (!rough) throw new Error(`${asset.ph}：既沒有 arm 也沒有 Rough`);
    add('rough', rough);
    const ao = pickTex(files, 'AO', asset.res) ?? pickTex(files, 'ao', asset.res);
    if (ao) add('ao', ao);
  }
  return { jobs, meta, extra: { armFrom } };
}

function planHdri(asset, files) {
  const dir = srcDir(asset);
  const jobs = [];
  const meta = {};
  const hdr = files?.hdri?.[asset.res]?.hdr;
  if (!hdr) throw new Error(`${asset.ph}：找不到 ${asset.res} .hdr`);
  const hdrFile = `${asset.id}_${asset.res}.hdr`;
  jobs.push({ url: hdr.url, dest: path.join(dir, hdrFile), md5: hdr.md5, size: hdr.size });
  meta.hdr = { file: hdrFile, url: hdr.url, md5: hdr.md5, size: hdr.size };

  const tm = files?.tonemapped;
  if (!tm) throw new Error(`${asset.ph}：找不到 tonemapped JPG`);
  const tmFile = `${asset.id}_tonemapped.jpg`;
  jobs.push({ url: tm.url, dest: path.join(dir, tmFile), md5: tm.md5, size: tm.size });
  meta.tonemapped = { file: tmFile, url: tm.url, md5: tm.md5, size: tm.size };

  return { jobs, meta, extra: {} };
}

function planModel(asset, files) {
  const dir = srcDir(asset);
  const node = files?.gltf?.[asset.res]?.gltf;
  if (!node) throw new Error(`${asset.ph}：找不到 ${asset.res} gltf`);

  const gltfFile = path.posix.basename(new URL(node.url).pathname);
  const jobs = [{ url: node.url, dest: path.join(dir, gltfFile), md5: node.md5, size: node.size }];
  const meta = { gltf: { file: gltfFile, url: node.url, md5: node.md5, size: node.size }, include: {} };

  // include 的 key 就是相對 gltf 的路徑（textures/xxx.jpg、xxx.bin），照原樣落盤
  for (const [rel, entry] of Object.entries(node.include ?? {})) {
    const safe = rel.split('/').filter((s) => s && s !== '..').join('/');
    jobs.push({ url: entry.url, dest: path.join(dir, ...safe.split('/')), md5: entry.md5, size: entry.size });
    meta.include[safe] = { url: entry.url, md5: entry.md5, size: entry.size };
  }

  // Poly Haven 的 glTF 匯出會把葉片 alpha 弄丟：baseColor 給的是 .jpg（沒有 alpha 通道），
  // 材質卻標 MASK/BLEND，直接用的話樹葉會變成不透明的方塊。
  // 這裡把 API 上獨立的 *_alpha PNG 一起抓下來，build.mjs 再合回 baseColor 的 alpha 通道。
  meta.alpha = {};
  for (const key of Object.keys(files)) {
    if (!/(^|_)alpha$/i.test(key)) continue;
    const n = files[key]?.[asset.res] ?? files[key];
    const entry = n?.png ?? n?.jpg;
    if (!entry?.url) continue;
    const ext = path.posix.extname(new URL(entry.url).pathname) || '.png';
    const rel = `textures/${asset.id}_${key.toLowerCase()}_${asset.res}${ext}`;
    jobs.push({ url: entry.url, dest: path.join(dir, ...rel.split('/')), md5: entry.md5, size: entry.size });
    meta.alpha[key] = {
      file: rel,
      slot: key.replace(/_?alpha$/i, '').toLowerCase(),
      url: entry.url, md5: entry.md5, size: entry.size,
    };
  }

  return { jobs, meta, extra: {} };
}

const PLANNERS = { texture: planTexture, hdri: planHdri, model: planModel };

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function run() {
  const list = ONLY
    ? ASSETS.filter((a) => a.id === ONLY || a.ph === ONLY || a.type === ONLY)
    : ASSETS;
  if (!list.length) {
    console.error(`找不到符合 --only=${ONLY} 的資產`);
    process.exit(1);
  }

  console.log(`[fetch] ${list.length} 個資產（texture ${list.filter((a) => a.type === 'texture').length}、` +
    `hdri ${list.filter((a) => a.type === 'hdri').length}、model ${list.filter((a) => a.type === 'model').length}）`);

  const failures = [];
  let totalGot = 0, totalSkip = 0, totalBytes = 0;

  for (const asset of list) {
    try {
      const files = await apiFiles(asset.ph);
      const { jobs, meta, extra } = PLANNERS[asset.type](asset, files);
      await fsp.mkdir(srcDir(asset), { recursive: true });

      let got = 0, skip = 0, bytes = 0;
      await pool(jobs, CONCURRENCY, async (job) => {
        const r = await download(job);
        if (r === 'get') got++; else skip++;
        bytes += (await fsp.stat(job.dest)).size;
      });
      totalGot += got; totalSkip += skip; totalBytes += bytes;

      // 內容沒變就別重寫 —— 這個檔的 mtime 是 build.mjs 判斷「要不要重做」的依據之一，
      // 每次跑都動它的話 npm run assets 會變成每次都從頭壓一遍，就不冪等了。
      const metaPath = srcMetaPath(asset);
      const record = {
        id: asset.id,
        ph: asset.ph,
        type: asset.type,
        res: asset.res,
        use: asset.use,
        battles: asset.battles,
        source: SOURCE,
        license: LICENSE,
        page: `https://polyhaven.com/a/${asset.ph}`,
        ...extra,
        files: meta,
      };
      let changed = true;
      if (await exists(metaPath)) {
        try {
          const prev = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
          const { fetchedAt, ...rest } = prev;
          changed = JSON.stringify(rest) !== JSON.stringify(record);
        } catch { changed = true; }
      }
      if (changed) {
        await fsp.writeFile(metaPath, JSON.stringify(
          { ...record, fetchedAt: new Date().toISOString() }, null, 2) + '\n');
      }

      console.log(`  ${asset.type.padEnd(7)} ${asset.id.padEnd(36)} ${String(got).padStart(2)} 抓 / ${String(skip).padStart(2)} 跳過  ${fmt(bytes)}`);
    } catch (e) {
      failures.push({ id: asset.id, error: e.message });
      console.error(`  ✗ ${asset.id}：${e.message}`);
    }
  }

  console.log(`\n[fetch] 完成：新下載 ${totalGot} 檔、跳過 ${totalSkip} 檔、來源總計 ${fmt(totalBytes)}`);
  if (failures.length) {
    console.error(`[fetch] ${failures.length} 個資產失敗：`);
    for (const f of failures) console.error(`  - ${f.id}: ${f.error}`);
    process.exit(1);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
