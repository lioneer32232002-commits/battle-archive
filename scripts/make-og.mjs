// 生成 OG 分享圖與 favicon
// OG:以 Gemini 生成的二戰電玩風格戰場主視覺(assets-src/<name>-base.png)為底,
//     裁成 1200×630 並疊上標題文字層(resvg 渲染透明 PNG,sharp 合成)。
// favicon:程式生成的金色勳章星。
// 底圖為中間素材,不進 git;最終 public/og-*.png 才是產出物。
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const SRC = resolve(ROOT, 'assets-src');
mkdirSync(PUBLIC, { recursive: true });

const FONT = {
  fontFiles: ['C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/msjhbd.ttc', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  loadSystemFonts: true,
  defaultFontFamily: 'Microsoft JhengHei',
};

function svgToPng(svg, width) {
  return new Resvg(svg, { font: FONT, fitTo: { mode: 'width', value: width } }).render().asPng();
}

// ── OG 文字疊層(透明背景) ───────────────────────────
const W = 1200, H = 630;

function tag(x, y, color, text) {
  return `<rect x="${x}" y="${y}" width="22" height="22" rx="3" fill="${color}"/>
    <text x="${x + 32}" y="${y + 18}" font-family="'Microsoft JhengHei'" font-size="24" fill="#eef2f8">${text}</text>`;
}

function overlaySvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#04070d" stop-opacity="0"/>
      <stop offset="48%" stop-color="#04070d" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#04070d" stop-opacity="0.93"/>
    </linearGradient>
    <linearGradient id="leftScrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#04070d" stop-opacity="0.80"/>
      <stop offset="100%" stop-color="#04070d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#04070d" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#04070d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4cf"/>
      <stop offset="55%" stop-color="#e9c659"/>
      <stop offset="100%" stop-color="#b88a1e"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="160" fill="url(#topScrim)"/>
  <rect x="0" y="250" width="${W}" height="380" fill="url(#bottomScrim)"/>
  <rect x="0" y="0" width="680" height="${H}" fill="url(#leftScrim)"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="12" fill="none" stroke="url(#gold)" stroke-width="2.5" stroke-opacity="0.55"/>
  ${body}
</svg>`;
}

function midwayOverlay() {
  return overlaySvg(`
    <text x="74" y="78" font-family="'Microsoft JhengHei'" font-size="24" fill="#f0d27a" letter-spacing="7">戰史檔案館 · 3D 戰役模擬</text>
    <text x="70" y="476" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="118" fill="#ffffff" letter-spacing="3">中途島戰役</text>
    <text x="74" y="528" font-family="Arial, 'Microsoft JhengHei'" font-weight="bold" font-size="33" fill="#f0d27a" letter-spacing="10">BATTLE OF MIDWAY</text>
    <line x1="76" y1="556" x2="600" y2="556" stroke="#e9c659" stroke-width="2" stroke-opacity="0.5"/>
    <text x="74" y="592" font-family="'Microsoft JhengHei'" font-size="25" fill="#dbe3ee">1942年6月4日 — 太平洋戰爭的轉捩點</text>
    ${tag(760, 568, '#e0503a', '大日本帝國海軍')}
    ${tag(1010, 568, '#3f8ae6', '美國海軍')}
  `);
}

function homeOverlay() {
  return overlaySvg(`
    <text x="74" y="78" font-family="Arial, 'Microsoft JhengHei'" font-size="24" fill="#f0d27a" letter-spacing="7">WAR HISTORY ARCHIVE</text>
    <text x="70" y="474" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="124" fill="#ffffff" letter-spacing="5">戰史檔案館</text>
    <line x1="76" y1="506" x2="600" y2="506" stroke="#e9c659" stroke-width="2" stroke-opacity="0.5"/>
    <text x="74" y="552" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="38" fill="#f0d27a">歷史戰役 3D 模擬</text>
    <text x="74" y="596" font-family="'Microsoft JhengHei'" font-size="24" fill="#dbe3ee">以電視特別節目式 3D 運鏡,重現歷史上的關鍵戰役</text>
  `);
}

async function buildOg(baseName, overlaySvgStr, outName) {
  const basePath = resolve(SRC, baseName);
  if (!existsSync(basePath)) {
    console.warn(`! 略過 ${outName}:找不到底圖 ${basePath}`);
    return;
  }
  const overlay = svgToPng(overlaySvgStr, W);
  const out = await sharp(basePath)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png({ quality: 90 })
    .toBuffer();
  writeFileSync(resolve(PUBLIC, outName), out);
  console.log(`✓ ${outName}`);
}

// ── favicon(金色勳章星) ─────────────────────────────
function faviconSvg() {
  const cx = 32, cy = 32, rays = [], n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lx = cx + Math.cos(a - 0.13) * 16, ly = cy + Math.sin(a - 0.13) * 16;
    const rx = cx + Math.cos(a + 0.13) * 16, ry = cy + Math.sin(a + 0.13) * 16;
    const tx = cx + Math.cos(a) * 27, ty = cy + Math.sin(a) * 27;
    rays.push(`<polygon points="${lx},${ly} ${tx},${ty} ${rx},${ry}" fill="url(#gr)"/>`);
  }
  const star = [];
  for (let i = 0; i < 5; i++) {
    const ao = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const ai = ao + Math.PI / 5;
    star.push(`${cx + Math.cos(ao) * 15},${cy + Math.sin(ao) * 15}`);
    star.push(`${cx + Math.cos(ai) * 6.2},${cy + Math.sin(ai) * 6.2}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="80%">
      <stop offset="0%" stop-color="#1a2a44"/><stop offset="100%" stop-color="#05080f"/>
    </radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4cf"/><stop offset="55%" stop-color="#e9c659"/><stop offset="100%" stop-color="#7d5e14"/>
    </linearGradient>
    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f4dd8e"/><stop offset="100%" stop-color="#9a7a1d"/>
    </linearGradient>
    <radialGradient id="ro" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#243650"/><stop offset="100%" stop-color="#0c1626"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#bg)"/>
  <rect width="64" height="64" rx="14" fill="none" stroke="url(#g)" stroke-width="2.5"/>
  ${rays.join('')}
  <circle cx="32" cy="32" r="17" fill="url(#ro)" stroke="url(#g)" stroke-width="2.5"/>
  <polygon points="${star.join(' ')}" fill="url(#g)"/>
</svg>`;
}

// ── 執行 ─────────────────────────────────────────────
await buildOg('midway-base.png', midwayOverlay(), 'og-midway.png');
await buildOg('home-base.png', homeOverlay(), 'og-home.png');

const fav = faviconSvg();
writeFileSync(resolve(PUBLIC, 'favicon.svg'), fav);
writeFileSync(resolve(PUBLIC, 'favicon-32.png'), svgToPng(fav, 32));
writeFileSync(resolve(PUBLIC, 'favicon-180.png'), svgToPng(fav, 180));
writeFileSync(resolve(PUBLIC, 'apple-touch-icon.png'), svgToPng(fav, 180));
console.log('完成。');
