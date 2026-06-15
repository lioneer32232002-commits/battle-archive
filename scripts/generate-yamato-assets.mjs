// 產生天號作戰頁所需圖像:thumb-yamato.jpg(卡片縮圖)、banner-yamato.jpg(開場背景)、og-yamato.png(社群預覽)
// 純插畫(無文字,避免字型問題):陰天鋼灰天空 + 旭日餘暉 + 鉛灰海面 + 傾斜燃燒的戰艦剪影。
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');

// ── 旭日光芒(16 道,低調暗紅) ──
function sunRays(cx, cy, len) {
  let s = '';
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / 32;
    const x0 = cx + Math.cos(a0) * len;
    const y0 = cy + Math.sin(a0) * len;
    const x1 = cx + Math.cos(a1) * len;
    const y1 = cy + Math.sin(a1) * len;
    s += `<polygon points="${cx},${cy} ${x0.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}" fill="#b6442e"/>`;
  }
  return `<g opacity="0.32">${s}</g>`;
}

// ── 戰艦大和剪影(艦艏朝右,寶塔艦橋 + 三主炮塔 + 後傾煙囪) ──
function warship() {
  const dark = '#0e141b';
  return `
  <g transform="translate(470 372) rotate(-5)" fill="${dark}">
    <!-- 艦體 -->
    <path d="M -250 24 L 250 12 L 300 26 L 250 44 L -240 44 L -262 34 Z"/>
    <!-- 艦艉 X 砲塔 -->
    <rect x="-210" y="6" width="46" height="20" rx="3"/>
    <rect x="-200" y="-2" width="6" height="14" transform="rotate(-12 -197 5)"/>
    <rect x="-188" y="-2" width="6" height="14" transform="rotate(-12 -185 5)"/>
    <!-- 後桅 -->
    <rect x="-150" y="-44" width="5" height="56"/>
    <!-- 煙囪(後傾) -->
    <path d="M -120 12 L -104 12 L -96 -34 L -110 -34 Z"/>
    <!-- 寶塔艦橋 -->
    <polygon points="-70,12 -18,12 -26,-22 -62,-22"/>
    <polygon points="-58,-22 -30,-22 -36,-52 -52,-52"/>
    <polygon points="-50,-52 -38,-52 -42,-78 -46,-78"/>
    <rect x="-45" y="-104" width="3" height="28"/>
    <!-- B 主炮塔(背負,墊高) -->
    <rect x="34" y="-2" width="48" height="20" rx="3"/>
    <rect x="78" y="2" width="60" height="6" transform="rotate(-6 78 5)"/>
    <rect x="78" y="9" width="60" height="6" transform="rotate(-6 78 12)"/>
    <!-- A 主炮塔 -->
    <rect x="96" y="14" width="48" height="20" rx="3"/>
    <rect x="140" y="18" width="64" height="6" transform="rotate(-5 140 21)"/>
    <rect x="140" y="26" width="64" height="6" transform="rotate(-5 140 29)"/>
  </g>`;
}

// ── 黑煙柱 ──
function smoke() {
  return `
  <g fill="#1c2026" opacity="0.72">
    <ellipse cx="430" cy="250" rx="60" ry="42"/>
    <ellipse cx="410" cy="200" rx="74" ry="54"/>
    <ellipse cx="445" cy="150" rx="92" ry="66"/>
    <ellipse cx="420" cy="92" rx="116" ry="84"/>
    <ellipse cx="470" cy="40" rx="140" ry="96"/>
  </g>`;
}

const W = 1200;
const H = 630;
const SEA_Y = 392;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#36424f"/>
      <stop offset="0.55" stop-color="#586675"/>
      <stop offset="1" stop-color="#8b97a3"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#33485a"/>
      <stop offset="1" stop-color="#0c1f2b"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e08a52" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#e08a52" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blast" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffe0a0" stop-opacity="0.95"/>
      <stop offset="0.4" stop-color="#ff8c32" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#ff7828" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${SEA_Y}" fill="url(#sky)"/>
  ${sunRays(430, 250, 520)}
  <circle cx="430" cy="250" r="80" fill="url(#sun)"/>

  <rect y="${SEA_Y}" width="${W}" height="${H - SEA_Y}" fill="url(#sea)"/>
  <rect y="${SEA_Y - 6}" width="${W}" height="16" fill="#aab6c0" opacity="0.22"/>

  ${smoke()}
  <ellipse cx="500" cy="${SEA_Y}" rx="220" ry="70" fill="#000" opacity="0.35"/>
  ${warship()}
  <ellipse cx="430" cy="${SEA_Y - 4}" rx="150" ry="96" fill="url(#blast)"/>

  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`;

const png = new Resvg(svg, { background: 'rgba(10,14,20,1)' }).render().asPng();

async function out(name, w, h, fmt) {
  let img = sharp(png).resize(w, h, { fit: 'cover', position: 'centre' });
  img = fmt === 'png' ? img.png() : img.jpeg({ quality: 86 });
  await img.toFile(resolve(PUBLIC, name));
  console.log('wrote', name, `${w}x${h}`);
}

await out('og-yamato.png', 1200, 630, 'png');
await out('banner-yamato.jpg', 1600, 900, 'jpg');
await out('thumb-yamato.jpg', 800, 500, 'jpg');
console.log('done');
