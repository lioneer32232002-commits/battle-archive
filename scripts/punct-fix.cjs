// 全形標點轉換(僅 CJK 相鄰的半形 , : ; ! ? 轉全形;數字間分隔保留;註解行略過)。
// 括弧另行「只報告」,交人工檢查(避免動到程式呼叫括弧)。
// 用法:node scripts/punct-fix.cjs        → 乾跑,只印出會改什麼
//       node scripts/punct-fix.cjs --write → 實際寫回
const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const ROOT = path.join(__dirname, '..');

const FILES = [
  'src/brecourt/data/battle.js',
  'src/brecourt/data/figures.js',
  'src/brecourt/ui/hud.js',
  'src/brecourt/main.js',
  'src/brecourt/scene/terrain.js',
  'src/brecourt/scene/labels.js',
  'battles/brecourt/index.html',
  'src/crossroads/data/battle.js',
  'src/crossroads/data/figures.js',
  'src/crossroads/ui/hud.js',
  'src/crossroads/main.js',
  'src/crossroads/scene/terrain.js',
  'src/crossroads/scene/environment.js',
  'src/crossroads/scene/effects.js',
  'src/crossroads/scene/soldiers.js',
  'battles/crossroads/index.html',
  'src/site/battles.js',
];

const MAP = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？' };
const isJS = (f) => f.endsWith('.js');
const isCommentLine = (line) => {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

// CJK 相鄰(左或右)的半形 , : ; ! ? → 全形;數字-數字之間因無 CJK 相鄰而自動保留
const CONV = /(?<=\p{Script=Han})[,:;!?]|[,:;!?](?=\p{Script=Han})/gu;
// 報告用:CJK 相鄰的半形括弧
const PARENS = /(?<=\p{Script=Han})[()]|[()](?=\p{Script=Han})/gu;

let totalChanges = 0;
const parenReports = [];

for (const rel of FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { console.log('  (略過,不存在)', rel); continue; }
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
  let fileChanges = 0;
  const out = lines.map((line, i) => {
    if (isJS(rel) && isCommentLine(line)) return line;
    // 括弧報告
    const pm = line.match(PARENS);
    if (pm) parenReports.push(`  ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    if (!CONV.test(line)) return line;
    CONV.lastIndex = 0;
    const next = line.replace(CONV, (m) => MAP[m]);
    if (next !== line) {
      fileChanges++; totalChanges++;
      console.log(`  ${rel}:${i + 1}`);
      console.log(`    -  ${line.trim().slice(0, 110)}`);
      console.log(`    +  ${next.trim().slice(0, 110)}`);
    }
    return next;
  });
  if (fileChanges && WRITE) fs.writeFileSync(fp, out.join('\n'));
  if (fileChanges) console.log(`  ↑ ${rel}: ${fileChanges} 行\n`);
}

console.log('====================================');
console.log(`半形→全形 , : ; ! ? 共 ${totalChanges} 行` + (WRITE ? ' 已寫回' : ' (乾跑,未寫)'));
if (parenReports.length) {
  console.log(`\n⚠ CJK 相鄰的半形括弧 ${parenReports.length} 處(需人工檢查):`);
  for (const r of parenReports) console.log(r);
}
