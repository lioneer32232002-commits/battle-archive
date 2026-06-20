// 產生「卡倫坦」頁圖像。底圖為 Gemini 生成的諾曼第市鎮街戰圖
// （assets-src/carentan-base.png）。仿其他戰役：og 疊上標題文字版面；
// banner / thumb 為無字底圖裁切。底圖右下角有 Gemini 浮水印，先裁掉底部一條再合成。
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const BASE = resolve(ROOT, 'assets-src', 'carentan-base.png');
const FONT = resolve(__dirname, 'BlackOpsOne-Regular.ttf');

if (!existsSync(BASE)) {
  console.error('! 找不到底圖:', BASE);
  console.error('  請先用 Gemini 生成諾曼第市鎮街戰圖,存成 assets-src/carentan-base.png 再執行。');
  process.exit(1);
}

if (!existsSync(FONT)) {
  const url = 'https://github.com/google/fonts/raw/main/ofl/blackopsone/BlackOpsOne-Regular.ttf';
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(FONT, buf);
  console.log('downloaded font:', buf.length, 'bytes');
}

const W = 1200;
const H = 630;
const LX = 54; // 左邊界

// 裁掉底部含浮水印的一條（底圖 2752×1536，右下角 Gemini 星號），保留上方乾淨區域。
const meta = await sharp(BASE).metadata();
const cropH = Math.round(meta.height * 0.86); // 去除底部約 14%
const cleanBase = await sharp(BASE).extract({ left: 0, top: 0, width: meta.width, height: cropH }).toBuffer();

const overlay = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="h" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#06090e" stop-opacity="0.85"/>
      <stop offset="0.5" stop-color="#06090e" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#06090e" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06090e" stop-opacity="0.55"/>
      <stop offset="0.32" stop-color="#06090e" stop-opacity="0"/>
      <stop offset="0.7" stop-color="#06090e" stop-opacity="0"/>
      <stop offset="1" stop-color="#06090e" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4cf"/>
      <stop offset="55%" stop-color="#e9c659"/>
      <stop offset="100%" stop-color="#b88a1e"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#h)"/>
  <rect width="${W}" height="${H}" fill="url(#v)"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="12" fill="none" stroke="url(#gold)" stroke-width="2.5" stroke-opacity="0.55"/>

  <!-- 站名 kicker -->
  <text x="${LX}" y="58" font-family="Arial, sans-serif" font-size="18" font-weight="700"
        letter-spacing="5" fill="#dcc488">WAR HISTORY ARCHIVE   ·   3D BATTLE SIMULATION</text>

  <!-- 主標題(軍事鏤空字體) -->
  <text x="${LX - 2}" y="352" font-family="Black Ops One, Impact, sans-serif" font-size="96"
        fill="#f4f0e6" stroke="#05080c" stroke-width="1.2">CARENTAN</text>

  <!-- 日期 -->
  <text x="${LX}" y="402" font-family="Arial, sans-serif" font-size="31" font-weight="700"
        letter-spacing="2" fill="#edc266">JUNE 12–13, 1944 · NORMANDY</text>

  <!-- 副標 -->
  <text x="${LX}" y="442" font-family="Arial, sans-serif" font-size="22" font-weight="600"
        letter-spacing="3" fill="#d2dbe6">WINTERS' TRILOGY ② · TOWN &amp; BLOODY GULCH</text>

  <!-- 底部陣營 -->
  <rect x="${LX}" y="576" width="17" height="17" fill="#d9442e"/>
  <text x="${LX + 26}" y="590" font-family="Arial, sans-serif" font-size="18" font-weight="600"
        letter-spacing="1" fill="#e7ecf3">WEHRMACHT · SS</text>
  <rect x="270" y="576" width="17" height="17" fill="#2e7bd9"/>
  <text x="296" y="590" font-family="Arial, sans-serif" font-size="18" font-weight="600"
        letter-spacing="1" fill="#e7ecf3">U.S. 101ST AIRBORNE</text>
</svg>`;

const overlayPng = new Resvg(overlay, {
  fitTo: { mode: 'width', value: W },
  font: { fontFiles: [FONT], loadSystemFonts: true, defaultFontFamily: 'Arial' },
  background: 'rgba(0,0,0,0)',
}).render().asPng();

// OG:底圖(裁切到 1200×630)+ 文字疊層
const ogBase = await sharp(cleanBase).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
await sharp(ogBase).composite([{ input: overlayPng, top: 0, left: 0 }]).png().toFile(resolve(PUBLIC, 'og-carentan.png'));
console.log('wrote og-carentan.png 1200x630 (with title overlay)');

// banner(開場背景)/ thumb(卡片)— 無字底圖裁切
await sharp(cleanBase).resize(1600, 900, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toFile(resolve(PUBLIC, 'banner-carentan.jpg'));
console.log('wrote banner-carentan.jpg 1600x900');
await sharp(cleanBase).resize(800, 500, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toFile(resolve(PUBLIC, 'thumb-carentan.jpg'));
console.log('wrote thumb-carentan.jpg 800x500');
console.log('done');
