// 中途島戰役資料 — 1942年6月4日(中途島當地時間)
// 史料依據:美國海軍歷史與遺產司令部(NHHC)、Parshall & Tully《Shattered Sword》
// 時間軸:t = 自 6/4 00:00 起算的分鐘數(t>1170 為 6/5–6/7 尾聲,以字卡呈現)
// 座標:1 單位 = 0.1 浬;中途島於原點;北 = -z、東 = +x

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 240; // 04:00
export const TIME_END = 1300; // 尾聲結束
export const EPILOGUE_T = 1170; // 之後為 6/5–6/7 尾聲

export function formatClock(t) {
  if (t >= 1255) return '1942/6/7';
  if (t >= 1230) return '1942/6/6';
  if (t >= EPILOGUE_T) return '1942/6/5';
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `6/4 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 艦隊航跡(編隊中心) ─────────────────────────────────
// 南雲機動部隊:自西北 240 浬接近,09:18 轉向東北迎擊美艦隊
const kidoButaiTrack = [
  { t: 240, x: -1600, z: -1900 },
  { t: 450, x: -1100, z: -1400 },
  { t: 558, x: -900, z: -1150 },
  { t: 700, x: -560, z: -1290 },
  { t: 1300, x: -560, z: -1290 },
];

// TF16(史普魯恩斯):自東北接近,放飛後向西逼近
const tf16Track = [
  { t: 240, x: 1350, z: -1330 },
  { t: 420, x: 1240, z: -1240 },
  { t: 700, x: 850, z: -1320 },
  { t: 930, x: 350, z: -1450 },
  { t: 1300, x: 100, z: -1500 },
];

// TF17(佛萊徹/約克鎮)
const tf17Track = [
  { t: 240, x: 1500, z: -1080 },
  { t: 525, x: 1280, z: -1100 },
  { t: 720, x: 1100, z: -1150 },
  { t: 1300, x: 1080, z: -1140 },
];

// 依編隊中心 + 偏移產生單艦航跡;stopT 之後定住(中彈失去動力)
function offsetTrack(center, dx, dz, stopT) {
  const pts = [];
  for (const p of center) {
    if (stopT != null && p.t > stopT) break;
    pts.push({ t: p.t, x: p.x + dx, z: p.z + dz });
  }
  if (stopT != null) {
    const at = interpolateTrack(center, stopT);
    pts.push({ t: stopT, x: at.x + dx, z: at.z + dz });
  }
  return pts;
}

// ── 單位 ─────────────────────────────────────────────
export const units = [
  // 紅方 — 日本海軍 第一航空艦隊(南雲機動部隊)
  {
    id: 'akagi', side: 'red', kind: 'carrier', name: '赤城', nameEn: 'Akagi',
    deckMark: 'ア', islandSide: 'left', length: 111,
    strength: { aircraft: 60 },
    track: offsetTrack(kidoButaiTrack, 0, 0, 622),
    statusChanges: [
      { t: 622, status: 'burning', strengthDelta: { aircraft: -60 } },
      { t: 1180, status: 'sunk' },
    ],
  },
  {
    id: 'kaga', side: 'red', kind: 'carrier', name: '加賀', nameEn: 'Kaga',
    deckMark: 'カ', islandSide: 'right', length: 106,
    strength: { aircraft: 74 },
    track: offsetTrack(kidoButaiTrack, 110, 60, 622),
    statusChanges: [
      { t: 622, status: 'burning', strengthDelta: { aircraft: -74 } },
      { t: 1165, status: 'sunk' },
    ],
  },
  {
    id: 'soryu', side: 'red', kind: 'carrier', name: '蒼龍', nameEn: 'Sōryū',
    deckMark: 'ソ', islandSide: 'right', length: 97,
    strength: { aircraft: 57 },
    track: offsetTrack(kidoButaiTrack, -60, -110, 625),
    statusChanges: [
      { t: 625, status: 'burning', strengthDelta: { aircraft: -57 } },
      { t: 1153, status: 'sunk' },
    ],
  },
  {
    id: 'hiryu', side: 'red', kind: 'carrier', name: '飛龍', nameEn: 'Hiryū',
    deckMark: 'ヒ', islandSide: 'left', length: 97,
    strength: { aircraft: 57 },
    // 倖存後向北脫離,傍晚被捕捉
    track: [
      ...offsetTrack(kidoButaiTrack, 70, -170).filter((p) => p.t <= 700),
      { t: 750, x: -450, z: -1520 },
      { t: 1023, x: -320, z: -1720 },
    ],
    statusChanges: [
      { t: 658, strengthDelta: { aircraft: -18 } },
      { t: 745, strengthDelta: { aircraft: 5 } },
      { t: 811, strengthDelta: { aircraft: -10 } },
      { t: 900, strengthDelta: { aircraft: 5 } },
      { t: 1023, status: 'burning', strengthDelta: { aircraft: -50 } },
      { t: 1205, status: 'sunk' },
    ],
  },
  { id: 'haruna', side: 'red', kind: 'battleship', name: '榛名', nameEn: 'Haruna', length: 95,
    strength: {}, track: offsetTrack(kidoButaiTrack, -200, 90), statusChanges: [] },
  { id: 'kirishima', side: 'red', kind: 'battleship', name: '霧島', nameEn: 'Kirishima', length: 95,
    strength: {}, track: offsetTrack(kidoButaiTrack, 210, -60), statusChanges: [] },
  { id: 'tone', side: 'red', kind: 'cruiser', name: '利根', nameEn: 'Tone', length: 86,
    strength: {}, track: offsetTrack(kidoButaiTrack, -170, -200), statusChanges: [] },
  { id: 'chikuma', side: 'red', kind: 'cruiser', name: '筑摩', nameEn: 'Chikuma', length: 86,
    strength: {}, track: offsetTrack(kidoButaiTrack, 180, -210), statusChanges: [] },
  { id: 'nagara', side: 'red', kind: 'cruiser', name: '長良', nameEn: 'Nagara', length: 69,
    strength: {}, track: offsetTrack(kidoButaiTrack, 0, 220), statusChanges: [] },
  { id: 'dd-r1', side: 'red', kind: 'destroyer', name: '驅逐隊', nameEn: '', length: 51,
    strength: {}, track: offsetTrack(kidoButaiTrack, -280, -40), statusChanges: [] },
  { id: 'dd-r2', side: 'red', kind: 'destroyer', name: '驅逐隊', nameEn: '', length: 51,
    strength: {}, track: offsetTrack(kidoButaiTrack, 290, 80), statusChanges: [] },

  // 藍方 — 美國海軍
  {
    id: 'enterprise', side: 'blue', kind: 'carrier', name: '企業號', nameEn: 'USS Enterprise',
    deckMark: '6', islandSide: 'right', length: 106,
    strength: { aircraft: 79 },
    track: offsetTrack(tf16Track, 0, 0),
    statusChanges: [
      { t: 585, strengthDelta: { aircraft: -10 } },
      { t: 700, strengthDelta: { aircraft: -18 } },
    ],
  },
  {
    id: 'hornet', side: 'blue', kind: 'carrier', name: '大黃蜂號', nameEn: 'USS Hornet',
    deckMark: '8', islandSide: 'right', length: 106,
    strength: { aircraft: 79 },
    track: offsetTrack(tf16Track, 130, 90),
    statusChanges: [{ t: 562, strengthDelta: { aircraft: -15 } }],
  },
  {
    id: 'yorktown', side: 'blue', kind: 'carrier', name: '約克鎮號', nameEn: 'USS Yorktown',
    deckMark: '5', islandSide: 'right', length: 106,
    strength: { aircraft: 75 },
    track: offsetTrack(tf17Track, 0, 0, 883),
    statusChanges: [
      { t: 690, strengthDelta: { aircraft: -14 } },
      { t: 720, status: 'burning' },
      { t: 800, status: 'normal' },
      { t: 883, status: 'burning' },
      { t: 1255, status: 'sunk' },
    ],
  },
  { id: 'ca-b1', side: 'blue', kind: 'cruiser', name: '巡洋艦隊', nameEn: '', length: 77,
    strength: {}, track: offsetTrack(tf16Track, -160, -120), statusChanges: [] },
  { id: 'ca-b2', side: 'blue', kind: 'cruiser', name: '巡洋艦隊', nameEn: '', length: 77,
    strength: {}, track: offsetTrack(tf16Track, 230, -60), statusChanges: [] },
  { id: 'dd-b1', side: 'blue', kind: 'destroyer', name: '驅逐隊', nameEn: '', length: 51,
    strength: {}, track: offsetTrack(tf16Track, 40, 230), statusChanges: [] },
  { id: 'ca-b3', side: 'blue', kind: 'cruiser', name: '阿斯托里亞', nameEn: 'USS Astoria', length: 77,
    strength: {}, track: offsetTrack(tf17Track, -150, 110), statusChanges: [] },
  { id: 'dd-b2', side: 'blue', kind: 'destroyer', name: '驅逐隊', nameEn: '', length: 51,
    strength: {}, track: offsetTrack(tf17Track, 150, -130), statusChanges: [] },
  {
    id: 'midway-base', side: 'blue', kind: 'base', name: '中途島基地', nameEn: 'Midway Atoll',
    strength: { aircraft: 127 },
    track: [{ t: 0, x: 0, z: 0 }],
    statusChanges: [
      { t: 405, strengthDelta: { aircraft: -17 } },
      { t: 500, strengthDelta: { aircraft: -11 } },
    ],
  },
];

// ── 攻擊波 / 機隊 ────────────────────────────────────
// type: 'strike'(轟炸/雷擊)、'recon'(偵察)
export const airGroups = [
  {
    id: 'tomonaga1', side: 'red', label: '友永隊 第一波 108 機',
    count: 9, spawnT: 270, despawnT: 540,
    track: [
      { t: 270, x: -1560, z: -1860 },
      { t: 386, x: -60, z: -90 },
      { t: 405, x: 60, z: 30 },
      { t: 540, x: -1060, z: -1340 },
    ],
  },
  {
    id: 'pby', side: 'blue', label: 'PBY 偵察機', count: 1, spawnT: 300, despawnT: 420,
    track: [
      { t: 300, x: -300, z: -500 },
      { t: 334, x: -1300, z: -1550 },
      { t: 420, x: -200, z: -300 },
    ],
  },
  {
    id: 'midway-strike', side: 'blue', label: '中途島基地攻擊隊', count: 5,
    spawnT: 365, despawnT: 500,
    track: [
      { t: 365, x: 0, z: -30 },
      { t: 430, x: -1150, z: -1430 },
      { t: 445, x: -1080, z: -1380 },
      { t: 500, x: 0, z: -30 },
    ],
  },
  {
    id: 'b17', side: 'blue', label: 'B-17 轟炸隊', count: 4, spawnT: 380, despawnT: 575,
    track: [
      { t: 380, x: 30, z: -30 },
      { t: 490, x: -1120, z: -1350 },
      { t: 505, x: -1040, z: -1300 },
      { t: 575, x: 30, z: -30 },
    ],
  },
  {
    id: 'tone4', side: 'red', label: '利根四號機（偵察）', count: 1, spawnT: 300, despawnT: 560,
    track: [
      { t: 300, x: -1450, z: -1700 },
      { t: 448, x: 1180, z: -1180 },
      { t: 560, x: -950, z: -1200 },
    ],
  },
  {
    id: 'vt8', side: 'blue', label: 'VT-8 雷擊中隊（沃爾德倫）', count: 5,
    spawnT: 435, despawnT: 563,
    track: [
      { t: 435, x: 1250, z: -1230 },
      { t: 560, x: -880, z: -1180 },
      { t: 563, x: -900, z: -1160 },
    ],
  },
  {
    id: 'vt6', side: 'blue', label: 'VT-6 雷擊中隊', count: 5, spawnT: 440, despawnT: 600,
    track: [
      { t: 440, x: 1255, z: -1245 },
      { t: 580, x: -860, z: -1220 },
      { t: 600, x: -700, z: -1100 },
    ],
  },
  {
    id: 'mcclusky', side: 'blue', label: '企業號俯衝轟炸隊（麥克拉斯基）', count: 8,
    spawnT: 445, despawnT: 700,
    track: [
      { t: 445, x: 1245, z: -1235 },
      { t: 560, x: -700, z: -700 },
      { t: 600, x: -1000, z: -1000 },
      { t: 622, x: -620, z: -1240 },
      { t: 640, x: -500, z: -1200 },
      { t: 700, x: 860, z: -1310 },
    ],
  },
  {
    id: 'yorktown-strike', side: 'blue', label: '約克鎮號攻擊隊（VB-3／VT-3）', count: 7,
    spawnT: 525, despawnT: 690,
    track: [
      { t: 525, x: 1285, z: -1095 },
      { t: 610, x: -800, z: -1260 },
      { t: 625, x: -560, z: -1330 },
      { t: 690, x: 1105, z: -1150 },
    ],
  },
  {
    id: 'kobayashi', side: 'red', label: '飛龍第一次攻擊隊（小林道雄）', count: 5,
    spawnT: 658, despawnT: 745,
    track: [
      { t: 658, x: -560, z: -1450 },
      { t: 718, x: 1080, z: -1170 },
      { t: 728, x: 1130, z: -1120 },
      { t: 745, x: -200, z: -1350 },
    ],
  },
  {
    id: 'tomonaga2', side: 'red', label: '飛龍第二次攻擊隊（友永丈市）', count: 4,
    spawnT: 811, despawnT: 905,
    track: [
      { t: 811, x: -470, z: -1540 },
      { t: 880, x: 1070, z: -1160 },
      { t: 890, x: 1130, z: -1130 },
      { t: 905, x: -100, z: -1400 },
    ],
  },
  {
    id: 'final-strike', side: 'blue', label: '企業號攻擊隊（含約克鎮殘存機）', count: 8,
    spawnT: 930, despawnT: 1080,
    track: [
      { t: 930, x: 360, z: -1440 },
      { t: 1020, x: -380, z: -1700 },
      { t: 1035, x: -250, z: -1650 },
      { t: 1080, x: 150, z: -1480 },
    ],
  },
];

// ── 重大事件 ─────────────────────────────────────────
// camera: { unit | pos, dist } 導演運鏡目標;fx: 特效指令
export const events = [
  {
    t: 245, title: '黎明前的太平洋', cinematic: true,
    desc: '日軍計畫攻佔中途島，誘出美軍艦隊決戰。但美軍已破譯日軍密碼，3 艘航艦在東北海域設伏。山本五十六的主力艦隊遠在後方 300 浬，渾然不知埋伏已成。',
    camera: { pos: { x: 0, z: 0 }, dist: 2600 },
  },
  {
    t: 270, title: '日軍第一波出擊', short: '日軍出擊', cinematic: true,
    desc: '南雲忠一的 4 艘航艦放飛 108 架飛機，由友永丈市大尉率領，航向中途島。同時 7 架偵察機奉命搜索海面，利根四號機因彈射器故障延誤，埋下致命伏筆。',
    camera: { unit: 'akagi', dist: 420 },
    fx: [{ kind: 'launch', unit: 'akagi' }],
  },
  {
    t: 334, title: 'PBY：「發現敵航艦！」', short: '發現日艦', cinematic: true,
    desc: '美軍 PBY 卡特琳娜偵察機發現南雲艦隊，隨後回報「大批飛機飛向中途島」。佛萊徹下令史普魯恩斯的 TF16 立即南下攔截。',
    camera: { unit: 'akagi', dist: 700 },
  },
  {
    t: 380, title: '中途島攔截戰',
    desc: '海軍陸戰隊 VMF-221 中隊 25 架戰鬥機（多為過時的水牛式）攔截來襲機群，遭零式戰鬥機擊潰，損失 17 架。',
    camera: { pos: { x: -60, z: -120 }, dist: 350 },
    fx: [{ kind: 'dogfight', pos: { x: -50, z: -100 } }],
  },
  {
    t: 390, title: '日軍空襲中途島', short: '空襲中途島', cinematic: true,
    desc: '日機轟炸中途島，擊毀發電廠、油槽與設施，但跑道仍可使用。友永發出關鍵電報：「有必要實施第二次攻擊」。',
    camera: { pos: { x: 0, z: 0 }, dist: 300 },
    fx: [{ kind: 'bombing', pos: { x: 0, z: 0 }, until: 403 }],
  },
  {
    t: 420, title: '美軍航艦放飛攻擊隊', short: '美軍出擊', cinematic: true,
    desc: '企業號與大黃蜂號在 175 浬距離上放飛 116 架飛機。史普魯恩斯接受參謀建議，賭上提早出擊，要趕在日軍回收第一波時痛擊。',
    camera: { unit: 'enterprise', dist: 420 },
    fx: [{ kind: 'launch', unit: 'enterprise' }, { kind: 'launch', unit: 'hornet' }],
  },
  {
    t: 430, title: '中途島基地反擊',
    desc: '中途島的 TBF 魚雷機、B-26、海陸 SBD 與 B-17 輪番攻擊南雲艦隊，全數未命中且損失慘重，卻迫使南雲艦隊不斷迴避，打亂作業節奏。',
    camera: { unit: 'akagi', dist: 600 },
    fx: [{ kind: 'flak', unit: 'akagi', until: 510 }],
  },
  {
    t: 435, title: '南雲的第一次抉擇',
    desc: '南雲下令第二波攻擊機卸下魚雷，改掛轟炸中途島用的陸用炸彈。機庫內展開緊張的換裝作業。',
    camera: { unit: 'akagi', dist: 260 },
  },
  {
    t: 448, title: '利根四號機：「發現敵艦 10 艘」', cinematic: true,
    desc: '遲到的利根四號機終於回報：「發現疑似敵艦 10 艘」，卻未說明艦種。南雲陷入兩難：換裝作業要不要停？',
    camera: { unit: 'tone', dist: 400 },
  },
  {
    t: 500, title: '「敵艦隊似有航艦隨行」', short: '航艦現蹤', cinematic: true,
    desc: '利根四號機追加報告：敵艦隊後方似有航空母艦。最壞的消息成真。南雲決定先回收中途島歸來的第一波，再整隊出擊，這個決定將葬送機動部隊。',
    camera: { unit: 'akagi', dist: 500 },
  },
  {
    t: 558, title: '機動部隊轉向東北',
    desc: '回收完畢的南雲艦隊轉向東北，準備與美艦隊決戰。甲板下，加油與掛彈作業全速進行，機庫內堆滿卸下的炸彈與油管。',
    camera: { unit: 'akagi', dist: 700 },
  },
  {
    t: 560, title: 'VT-8 全滅', short: 'VT-8 全滅', cinematic: true,
    desc: '大黃蜂號 VT-8 雷擊中隊（沃爾德倫少校）15 架 TBD 無護航強攻，全數被擊落，30 名機組僅蓋伊少尉一人生還。',
    camera: { unit: 'kaga', dist: 380 },
    fx: [{ kind: 'flak', unit: 'kaga', until: 585 }, { kind: 'torpedo-run', unit: 'kaga', at: 560 }],
  },
  {
    t: 580, title: 'VT-6 雷擊',
    desc: '企業號 VT-6 中隊 14 架雷擊機進攻，10 架被擊落，無一命中。3 波雷擊機的犧牲把日軍零戰全部引到低空，高空此刻門戶大開。',
    camera: { unit: 'akagi', dist: 380 },
    fx: [{ kind: 'flak', unit: 'akagi', until: 600 }, { kind: 'torpedo-run', unit: 'akagi', at: 580 }],
  },
  {
    t: 610, title: 'VT-3 進攻、零戰被引至低空',
    desc: '約克鎮號 VT-3 自東南進攻。幾乎同一時刻，麥克拉斯基的 33 架俯衝轟炸機在燃料見底前發現日軍驅逐艦「嵐」的航跡，循線找到了機動部隊。',
    camera: { unit: 'soryu', dist: 420 },
    fx: [{ kind: 'flak', unit: 'soryu', until: 625 }],
  },
  {
    t: 622, title: '命運的五分鐘：加賀、赤城中彈', short: '命運五分鐘', cinematic: true,
    desc: '企業號俯衝轟炸機自雲層俯衝而下。VB-6 隊長百斯特上尉臨機帶兩名僚機改撲赤城，投下貫入機庫的致命一彈；加賀同時連中 4 彈。機庫內堆滿的炸彈與油管瞬間引發連環爆炸，兩艦頓成火海。',
    camera: { unit: 'kaga', dist: 300 },
    fx: [
      { kind: 'divebomb', unit: 'kaga', at: 622 },
      { kind: 'divebomb', unit: 'akagi', at: 623 },
    ],
  },
  {
    t: 625, title: '蒼龍中彈', cinematic: true,
    desc: '約克鎮號 VB-3（萊斯里少校）17 架俯衝轟炸機命中蒼龍 3 彈。短短五分鐘，日本 3 艘主力航艦化為燃燒的殘骸。太平洋戰爭的天平就此翻轉。',
    camera: { unit: 'soryu', dist: 300 },
    fx: [{ kind: 'divebomb', unit: 'soryu', at: 625 }],
  },
  {
    t: 646, title: '南雲移乘長良',
    desc: '赤城大火失控，南雲含淚移乘輕巡長良。機動部隊僅存的飛龍，在山口多聞少將指揮下決意反擊。',
    camera: { unit: 'nagara', dist: 320 },
  },
  {
    t: 658, title: '飛龍反擊：小林隊出擊', short: '飛龍反擊', cinematic: true,
    desc: '飛龍放飛 18 架九九式艦爆與 6 架零戰，由小林道雄大尉率領，循美軍歸航機隊方向直撲約克鎮號。',
    camera: { unit: 'hiryu', dist: 360 },
    fx: [{ kind: 'launch', unit: 'hiryu' }],
  },
  {
    t: 718, title: '約克鎮號中三彈', short: '約克鎮中彈', cinematic: true,
    desc: '小林隊突破防空網，以 13 架的代價命中約克鎮號 3 彈。鍋爐熄火、艦體冒出濃煙，損管隊伍卻奮力搶修，2 小時後竟恢復 19 節航速。',
    camera: { unit: 'yorktown', dist: 300 },
    fx: [{ kind: 'divebomb', unit: 'yorktown', at: 719 }, { kind: 'flak', unit: 'yorktown', until: 730 }],
  },
  {
    t: 811, title: '友永隊最後的出擊', short: '友永出擊', cinematic: true,
    desc: '飛龍放飛最後 10 架九七式艦攻與 6 架零戰。隊長友永丈市的左油箱在晨襲中受損無法修復，他明知無法歸還，仍率隊出擊。',
    camera: { unit: 'hiryu', dist: 360 },
    fx: [{ kind: 'launch', unit: 'hiryu' }],
  },
  {
    t: 880, title: '約克鎮號中兩枚魚雷', short: '約克鎮棄艦', cinematic: true,
    desc: '友永隊誤認已修復的約克鎮號為另一艘航艦，突防投雷，2 枚命中。約克鎮號嚴重左傾，下令棄艦。友永機被擊落，壯烈戰死。',
    camera: { unit: 'yorktown', dist: 300 },
    fx: [{ kind: 'torpedo-run', unit: 'yorktown', at: 878 }, { kind: 'flak', unit: 'yorktown', until: 890 }],
  },
  {
    t: 930, title: '獵殺飛龍',
    desc: '企業號放飛 24 架俯衝轟炸機（含約克鎮號的孤兒機），目標：日軍最後一艘航艦。約克鎮號偵察機已標定飛龍位置。',
    camera: { unit: 'enterprise', dist: 400 },
    fx: [{ kind: 'launch', unit: 'enterprise' }],
  },
  {
    t: 1023, title: '飛龍中彈：機動部隊覆滅', short: '飛龍覆滅', cinematic: true,
    desc: '俯衝轟炸機自夕陽方向突入，飛龍連中 4 彈，前升降機被炸翻貼上艦橋。晨間擊毀赤城的百斯特再度出擊，成為唯一在一日之內參與擊沉兩艘航艦的飛行員。日本海軍引以為傲的機動部隊，4 艘航艦在一日之內全數被毀。',
    camera: { unit: 'hiryu', dist: 300 },
    fx: [{ kind: 'divebomb', unit: 'hiryu', at: 1023 }],
  },
  {
    t: 1153, title: '蒼龍沉沒',
    desc: '蒼龍沒入海中，艦長柳本柳作拒絕離艦。加賀隨後沉沒。這一夜，山本五十六仍企圖夜戰翻盤，終究徒勞，下令全軍撤退。',
    camera: { unit: 'soryu', dist: 360 },
  },
  {
    t: 1180, title: '六月五日：赤城、飛龍沉沒', cinematic: true,
    desc: '凌晨，山本下令以魚雷處分赤城，這是聯合艦隊旗艦的最後歸宿。山口多聞與飛龍艦長加來止男留艦共沉，飛龍隨後沉沒。',
    camera: { unit: 'hiryu', dist: 400 },
  },
  {
    t: 1230, title: '六月六日：三隈沉沒',
    desc: '撤退中的重巡三隈與最上相撞受損，遭美軍艦載機圍攻，三隈沉沒，這是日本海軍開戰以來損失的第一艘重巡洋艦。',
    camera: { pos: { x: -1500, z: -1000 }, dist: 800 },
  },
  {
    t: 1255, title: '六月七日：約克鎮號沉沒', short: '約克鎮沉沒', cinematic: true,
    desc: '搶救中的約克鎮號遭日軍潛艦伊-168 偷襲，2 枚魚雷命中，護航的驅逐艦哈曼號亦被擊沉。清晨，約克鎮號翻覆沉沒。',
    camera: { unit: 'yorktown', dist: 320 },
  },
  {
    t: 1280, title: '太平洋戰爭的轉捩點', short: '轉捩點', cinematic: true,
    desc: '中途島一役，日本損失 4 艘主力航艦、約 250 架飛機與大批精銳飛行員；美軍損失約克鎮號與 144 架飛機。日本海軍自此失去戰略主動權，太平洋戰爭的攻守易位。',
    camera: { pos: { x: 0, z: -800 }, dist: 3000 },
  },
];

// ── 戰役結算(播放結束戰損比較表) ─────────────────────
export const outcome = {
  headline: '太平洋戰爭的轉捩點',
  sub: '1942/6/4–6/7',
  rows: [
    { key: 'carrier', label: '航空母艦 沉沒' },
    { key: 'cruiser', label: '重巡洋艦 沉沒' },
    { key: 'destroyer', label: '驅逐艦 沉沒' },
    { key: 'aircraft', label: '艦載機 損失' },
    { key: 'killed', label: '陣亡 將士' },
  ],
  red: {
    name: '大日本帝國海軍',
    detail: '赤城、加賀、蒼龍、飛龍、三隈',
    values: { carrier: 4, cruiser: 1, destroyer: 0, aircraft: 248, killed: 3057 },
  },
  blue: {
    name: '美國海軍',
    detail: '約克鎮號、哈曼號',
    values: { carrier: 1, cruiser: 0, destroyer: 1, aircraft: 144, killed: 307 },
  },
};

// ── 關鍵飛行員(王牌個人行動,疊加於攻擊波之上) ──────────
// kind:dive 俯衝轟炸 / torpedo 魚雷;sorties 指向目標艦與時間窗
export const aces = [
  {
    id: 'best', side: 'blue', name: 'Dick Best 百斯特', kind: 'dive',
    sorties: [
      { unit: 'akagi', spawnT: 616, despawnT: 642 },
      { unit: 'hiryu', spawnT: 1015, despawnT: 1038 },
    ],
  },
  {
    id: 'kobayashi', side: 'red', name: '小林道雄 Kobayashi', kind: 'dive',
    sorties: [{ unit: 'yorktown', spawnT: 711, despawnT: 736 }],
  },
  {
    id: 'tomonaga', side: 'red', name: '友永丈市 Tomonaga', kind: 'torpedo',
    sorties: [{ unit: 'yorktown', spawnT: 871, despawnT: 896 }],
  },
];

// ── 陣營與指揮官(面板資料) ───────────────────────────
export const sides = {
  red: {
    name: '大日本帝國海軍',
    color: 0xd9442e,
    commanders: [
      { id: 'yamamoto', name: '山本五十六', nameEn: 'Yamamoto Isoroku', role: '聯合艦隊司令長官（旗艦大和，後方 300 浬）' },
      { id: 'nagumo', name: '南雲忠一', nameEn: 'Nagumo Chūichi', role: '第一航空艦隊司令長官（赤城）' },
      { id: 'yamaguchi', name: '山口多聞', nameEn: 'Yamaguchi Tamon', role: '第二航空戰隊司令官（飛龍）' },
    ],
    formations: [
      {
        name: '第一機動部隊',
        ships: ['赤城', '加賀', '蒼龍', '飛龍'],
        escort: '戰艦 2、巡洋艦 3、驅逐艦 12',
      },
    ],
    unitIds: ['akagi', 'kaga', 'soryu', 'hiryu'],
    baseAircraft: 248,
  },
  blue: {
    name: '美國海軍',
    color: 0x2e7bd9,
    commanders: [
      { id: 'nimitz', name: '切斯特・尼米茲', nameEn: 'Chester W. Nimitz', role: '太平洋艦隊總司令（珍珠港）' },
      { id: 'fletcher', name: '法蘭克・傑克・佛萊徹', nameEn: 'Frank Jack Fletcher', role: 'TF17 司令・戰術總指揮（約克鎮號）' },
      { id: 'spruance', name: '雷蒙・史普魯恩斯', nameEn: 'Raymond A. Spruance', role: 'TF16 司令（企業號）' },
    ],
    formations: [
      {
        name: 'Task Force 16 第16特遣艦隊',
        ships: ['USS Enterprise 企業號', 'USS Hornet 大黃蜂號'],
        escort: '巡洋艦 6、驅逐艦 9',
      },
      {
        name: 'Task Force 17 第17特遣艦隊',
        ships: ['USS Yorktown 約克鎮號'],
        escort: '巡洋艦 2、驅逐艦 6',
      },
      {
        name: 'Midway Naval Air Station 中途島基地航空隊',
        ships: [],
        escort: '各型飛機約 127 架',
      },
    ],
    unitIds: ['enterprise', 'hornet', 'yorktown', 'midway-base'],
    baseAircraft: 360,
  },
};
