// 產生布雷庫爾奪砲戰頁圖像。底圖為 Gemini 生成的諾曼第 D 日寫實戰場圖(assets-src/brecourt-base.png),
// 仿中途島/天號做法:og 疊上標題文字版面;banner / thumb 為無字底圖裁切。
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const BASE = resolve(ROOT, 'assets-src', 'brecourt-base.png');
const FONT = resolve(__dirname, 'BlackOpsOne-Regular.ttf');

if (!existsSync(BASE)) {
  console.error('! 找不到底圖:', BASE);
  console.error('  請先用 Gemini 生成諾曼第 D 日布雷庫爾電影感戰場圖,存成 assets-src/brecourt-base.png 再執行。');
  process.exit(1);
}

// 標題用的軍事鏤空字體(同其他戰役 OG);缺檔則自 Google Fonts 下載
if (!existsSync(FONT)) {
  const url = 'https://github.com/google/fonts/raw/main/ofl/blackopsone/BlackOpsOne-Regular.ttf';
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(FONT, buf);
  console.log('downloaded font:', buf.length, 'bytes');
}

const W = 1200;
const H = 630;
const LX = 54; // 左邊界

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
        fill="#f4f0e6" stroke="#05080c" stroke-width="1.2">BRÉCOURT MANOR</text>

  <!-- 日期 -->
  <text x="${LX}" y="402" font-family="Arial, sans-serif" font-size="31" font-weight="700"
        letter-spacing="2" fill="#edc266">JUNE 6, 1944 · D-DAY</text>

  <!-- 副標 -->
  <text x="${LX}" y="442" font-family="Arial, sans-serif" font-size="23" font-weight="600"
        letter-spacing="3" fill="#d2dbe6">WEST POINT'S TEXTBOOK ASSAULT</text>

  <!-- 底部陣營 -->
  <rect x="${LX}" y="576" width="17" height="17" fill="#d9442e"/>
  <text x="${LX + 26}" y="590" font-family="Arial, sans-serif" font-size="18" font-weight="600"
        letter-spacing="1" fill="#e7ecf3">WEHRMACHT</text>
  <rect x="240" y="576" width="17" height="17" fill="#2e7bd9"/>
  <text x="266" y="590" font-family="Arial, sans-serif" font-size="18" font-weight="600"
        letter-spacing="1" fill="#e7ecf3">U.S. 101ST AIRBORNE</text>
</svg>`;

const overlayPng = new Resvg(overlay, {
  fitTo: { mode: 'width', value: W },
  font: { fontFiles: [FONT], loadSystemFonts: true, defaultFontFamily: 'Arial' },
  background: 'rgba(0,0,0,0)',
}).render().asPng();

// OG:Gemini 底圖(裁切到 1200×630)+ 文字疊層
const ogBase = await sharp(BASE).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
await sharp(ogBase).composite([{ input: overlayPng, top: 0, left: 0 }]).png().toFile(resolve(PUBLIC, 'og-brecourt.png'));
console.log('wrote og-brecourt.png 1200x630 (with title overlay)');

// banner(開場背景)/ thumb(卡片)— 無字底圖裁切
await sharp(BASE).resize(1600, 900, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toFile(resolve(PUBLIC, 'banner-brecourt.jpg'));
console.log('wrote banner-brecourt.jpg 1600x900');
await sharp(BASE).resize(800, 500, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88 }).toFile(resolve(PUBLIC, 'thumb-brecourt.jpg'));
console.log('wrote thumb-brecourt.jpg 800x500');
console.log('done');
