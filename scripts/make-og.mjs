// 生成 OG 分享圖與 favicon(原創電玩勳章風格)
// 以 SVG 描述 → resvg 光柵化為 PNG;中文字型自系統載入
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');
mkdirSync(PUBLIC, { recursive: true });

const FONT = {
  fontFiles: ['C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/msjhbd.ttc', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  loadSystemFonts: true,
  defaultFontFamily: 'Microsoft JhengHei',
};

// ── 共用漸層 / 濾鏡定義 ──────────────────────────────
function defs() {
  return `
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="80%">
      <stop offset="0%" stop-color="#1a2a44"/>
      <stop offset="55%" stop-color="#0c1422"/>
      <stop offset="100%" stop-color="#05080f"/>
    </radialGradient>
    <radialGradient id="redGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d9442e" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#d9442e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2e7bd9" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#2e7bd9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="45%" r="72%">
      <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>
    </radialGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fff4cf"/>
      <stop offset="35%" stop-color="#e9c659"/>
      <stop offset="62%" stop-color="#c9a227"/>
      <stop offset="100%" stop-color="#7d5e14"/>
    </linearGradient>
    <linearGradient id="goldRay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f4dd8e"/>
      <stop offset="100%" stop-color="#9a7a1d"/>
    </linearGradient>
    <radialGradient id="roundel" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#243650"/>
      <stop offset="100%" stop-color="#0c1626"/>
    </radialGradient>
    <linearGradient id="ribbon" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="100%" stop-color="#7d1f16"/>
    </linearGradient>
  </defs>`;
}

// ── 勳章徽章(可重用,以平移/縮放置入) ──────────────
function medal(cx, cy, scale = 1, ribbonText = '') {
  const rays = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const long = 168;
    const wBase = 0.10;
    const p0x = cx + Math.cos(a) * 96;
    const p0y = cy + Math.sin(a) * 96;
    const tipx = cx + Math.cos(a) * long;
    const tipy = cy + Math.sin(a) * long;
    const lx = cx + Math.cos(a - wBase) * 100;
    const ly = cy + Math.sin(a - wBase) * 100;
    const rx = cx + Math.cos(a + wBase) * 100;
    const ry = cy + Math.sin(a + wBase) * 100;
    rays.push(`<polygon points="${lx},${ly} ${tipx},${tipy} ${rx},${ry}" fill="url(#goldRay)"/>`);
  }
  // 五角星
  const star = [];
  for (let i = 0; i < 5; i++) {
    const ao = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const ai = ao + Math.PI / 5;
    star.push(`${cx + Math.cos(ao) * 56},${cy + Math.sin(ao) * 56}`);
    star.push(`${cx + Math.cos(ai) * 23},${cy + Math.sin(ai) * 23}`);
  }
  const ribbon = ribbonText
    ? `<g>
        <path d="M ${cx - 150} ${cy + 120} L ${cx + 150} ${cy + 120} L ${cx + 122} ${cy + 168} L ${cx - 122} ${cy + 168} Z" fill="url(#ribbon)" stroke="#5e1810" stroke-width="2"/>
        <path d="M ${cx - 150} ${cy + 120} L ${cx - 186} ${cy + 130} L ${cx - 168} ${cy + 168} L ${cx - 122} ${cy + 168} Z" fill="#8f2a1e"/>
        <path d="M ${cx + 150} ${cy + 120} L ${cx + 186} ${cy + 130} L ${cx + 168} ${cy + 168} L ${cx + 122} ${cy + 168} Z" fill="#8f2a1e"/>
        <text x="${cx}" y="${cy + 152}" text-anchor="middle" font-family="Arial, 'Microsoft JhengHei'" font-weight="bold" font-size="30" fill="#ffe9b0" letter-spacing="4">${ribbonText}</text>
      </g>`
    : '';
  return `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
    ${ribbon}
    <g>${rays.join('')}</g>
    <circle cx="${cx}" cy="${cy}" r="102" fill="none" stroke="url(#gold)" stroke-width="9"/>
    <circle cx="${cx}" cy="${cy}" r="92" fill="url(#roundel)" stroke="#3a4d6b" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="88" fill="none" stroke="#e9c659" stroke-width="1.5" stroke-opacity="0.5"/>
    <polygon points="${star.join(' ')}" fill="url(#gold)" stroke="#7d5e14" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="9" fill="#fff4cf"/>
  </g>`;
}

// 小旗(紅:旭日;藍:星條)用於陣營標示
function tag(x, y, color, text) {
  return `<g>
    <rect x="${x}" y="${y}" width="22" height="22" rx="3" fill="${color}"/>
    <text x="${x + 32}" y="${y + 17}" font-family="'Microsoft JhengHei'" font-size="23" fill="#cdd7e6">${text}</text>
  </g>`;
}

function frame() {
  // 外金邊框
  return `<rect x="18" y="18" width="1164" height="594" rx="14" fill="none" stroke="url(#gold)" stroke-width="3" stroke-opacity="0.6"/>
  <rect x="26" y="26" width="1148" height="578" rx="10" fill="none" stroke="#c9a227" stroke-width="1" stroke-opacity="0.25"/>`;
}

function background() {
  return `
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="640" height="630" fill="url(#redGlow)"/>
  <rect x="560" y="0" width="640" height="630" fill="url(#blueGlow)"/>
  <line x1="0" y1="430" x2="1200" y2="430" stroke="#2a3c56" stroke-width="1" stroke-opacity="0.5"/>
  <rect width="1200" height="630" fill="url(#vignette)"/>`;
}

// ── OG:中途島頁 ─────────────────────────────────────
function ogMidway() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${defs()}
  ${background()}
  ${frame()}
  ${medal(312, 300, 1, '1942')}
  <g>
    <text x="560" y="150" font-family="'Microsoft JhengHei'" font-size="26" fill="#e9c659" letter-spacing="8">戰史檔案館 · 3D 戰役模擬</text>
    <text x="558" y="268" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="118" fill="#f5f1e6" letter-spacing="4">中途島戰役</text>
    <text x="562" y="324" font-family="Arial, 'Microsoft JhengHei'" font-weight="bold" font-size="40" fill="#e9c659" letter-spacing="11">BATTLE OF MIDWAY</text>
    <line x1="562" y1="360" x2="1140" y2="360" stroke="#c9a227" stroke-width="2" stroke-opacity="0.55"/>
    <text x="560" y="412" font-family="'Microsoft JhengHei'" font-size="30" fill="#cdd7e6">1942年6月4日 — 太平洋戰爭的轉捩點</text>
    ${tag(562, 470, '#d9442e', '大日本帝國海軍')}
    ${tag(862, 470, '#2e7bd9', '美國海軍')}
  </g>
</svg>`;
}

// ── OG:主站 ────────────────────────────────────────
function ogHome() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${defs()}
  ${background()}
  ${frame()}
  ${medal(312, 300, 1, 'EST.')}
  <g>
    <text x="560" y="158" font-family="Arial, 'Microsoft JhengHei'" font-size="26" fill="#e9c659" letter-spacing="7">WAR HISTORY ARCHIVE</text>
    <text x="558" y="290" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="130" fill="#f5f1e6" letter-spacing="6">戰史檔案館</text>
    <line x1="562" y1="330" x2="1140" y2="330" stroke="#c9a227" stroke-width="2" stroke-opacity="0.55"/>
    <text x="560" y="388" font-family="'Microsoft JhengHei'" font-weight="bold" font-size="40" fill="#cdd7e6" letter-spacing="2">歷史戰役 3D 模擬</text>
    <text x="560" y="446" font-family="'Microsoft JhengHei'" font-size="27" fill="#9fb0c8">以電視特別節目式 3D 運鏡,重現歷史上的關鍵戰役</text>
    ${tag(562, 494, '#d9442e', '紅方')}
    ${tag(712, 494, '#2e7bd9', '藍方')}
  </g>
</svg>`;
}

// ── Favicon(深色圓底 + 金色勳章星) ───────────────────
function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  ${defs()}
  <rect width="64" height="64" rx="14" fill="url(#bg)"/>
  <rect width="64" height="64" rx="14" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
  ${(() => {
    const cx = 32, cy = 32, rays = [], n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const lx = cx + Math.cos(a - 0.13) * 16, ly = cy + Math.sin(a - 0.13) * 16;
      const rx = cx + Math.cos(a + 0.13) * 16, ry = cy + Math.sin(a + 0.13) * 16;
      const tx = cx + Math.cos(a) * 27, ty = cy + Math.sin(a) * 27;
      rays.push(`<polygon points="${lx},${ly} ${tx},${ty} ${rx},${ry}" fill="url(#goldRay)"/>`);
    }
    const star = [];
    for (let i = 0; i < 5; i++) {
      const ao = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      const ai = ao + Math.PI / 5;
      star.push(`${cx + Math.cos(ao) * 15},${cy + Math.sin(ao) * 15}`);
      star.push(`${cx + Math.cos(ai) * 6.2},${cy + Math.sin(ai) * 6.2}`);
    }
    return rays.join('') +
      `<circle cx="32" cy="32" r="17" fill="url(#roundel)" stroke="url(#gold)" stroke-width="2.5"/>` +
      `<polygon points="${star.join(' ')}" fill="url(#gold)"/>`;
  })()}
</svg>`;
}

// ── 輸出 ─────────────────────────────────────────────
function render(svg, w) {
  const r = new Resvg(svg, { font: FONT, fitTo: { mode: 'width', value: w } });
  return r.render().asPng();
}

writeFileSync(resolve(PUBLIC, 'og-midway.png'), render(ogMidway(), 1200));
writeFileSync(resolve(PUBLIC, 'og-home.png'), render(ogHome(), 1200));
const fav = faviconSvg();
writeFileSync(resolve(PUBLIC, 'favicon.svg'), fav);
writeFileSync(resolve(PUBLIC, 'favicon-32.png'), render(fav, 32));
writeFileSync(resolve(PUBLIC, 'favicon-180.png'), render(fav, 180));
writeFileSync(resolve(PUBLIC, 'apple-touch-icon.png'), render(fav, 180));
console.log('OG / favicon assets written to public/');
