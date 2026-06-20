// 卡倫坦之役 — 溫特斯三部曲 · 二部曲（E 連，101 空降師 506 傘兵團 第 2 營）
// 1944 年 6 月 12 日晨，E 連（溫特斯中尉）打 2 營先鋒、自西南突入卡倫坦，
// 在 Y 形路口被 MG42 封街，溫特斯衝進彈雨督陣，逐屋肅清拿下市鎮；
// 6 月 13 日，第 17 SS 裝甲擲彈兵師反撲（血腥溝），E 連背靠鐵路路堤死守，
// 直到第 2 裝甲師 CCA 的雪曼戰車馳援解圍。卡倫坦守住，猶他與奧馬哈兩灘頭連成一線。
// 史料依據：Stephen Ambrose《Band of Brothers》、Dick Winters《Beyond Band of Brothers》、
//          506 PIR 團史（airborne506.org）、National WWII Museum、Warfare History Network、
//          Wikipedia（Battle of Carentan / Bloody Gulch）。經多源＋對抗式查核（見 carentan-facts）。
// 註：「紫心巷」堤道苦戰與柯爾上刺刀衝鋒屬第 502 團（6/10–11），非 E 連；本役聚焦 6/12–13 的 506 團 E 連。
// 座標：1 單位 = 10 公尺；原點 = 卡倫坦市鎮南緣路口；北 = -z（杜沃沼澤與 N13 堤道）、
//      西南 = -x／+z（樹籬圩田、30 高地、鐵路路堤＝血腥溝）。

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 350;  // 6/12 05:50（突入前）
export const TIME_END = 700;    // 6/13 16:30（CCA 解圍、鞏固）
export const EPILOGUE_T = 700;

// t 為壓縮的「戰場進度」分鐘；時鐘標籤依分段對應真實日期與時間（橫跨 6/12–13 兩日）。
const CLOCK_SEGS = [
  [350, 470, '6/12', 350, 470],   // 6/12 05:50–07:50（市鎮突擊，即時）
  [470, 560, '6/13', 240, 360],   // 6/13 04:00–06:00（夜間撤防 → 反撲集結）
  [560, 700, '6/13', 360, 990],   // 6/13 06:00–16:30（血腥溝反撲 → 解圍）
];
export function formatClock(t) {
  let seg = CLOCK_SEGS[CLOCK_SEGS.length - 1];
  for (const s of CLOCK_SEGS) { if (t <= s[1]) { seg = s; break; } }
  const [a, b, date, ra, rb] = seg;
  const real = ra + (rb - ra) * Math.max(0, Math.min(1, (t - a) / (b - a)));
  const h = Math.floor(real / 60);
  const m = Math.floor(real % 60);
  return `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 主軸：E 連（溫特斯）— 6/12 自西南突入市鎮 → 6/13 出鎮西南守鐵路路堤 ──
const easyTrack = [
  { t: 350, x: -20, z: 66 },    // 6/12 自西南集結出發
  { t: 380, x: -8, z: 30 },     // 沿斜街向市鎮推進
  { t: 396, x: 2, z: 12 },      // Y 形路口遭 MG42 封街、被切斷
  { t: 412, x: 3, z: 5 },       // 溫特斯衝進街心督陣
  { t: 432, x: 8, z: -8 },      // 逐屋肅清、向鎮中心推進
  { t: 452, x: 2, z: -20 },     // 鎮中心會合（市鎮陷落）
  { t: 540, x: -28, z: 28 },    // 6/13 出鎮、移往西南前哨線
  { t: 565, x: -56, z: 56 },    // 上鐵路路堤布防（血腥溝右翼）
  { t: 640, x: -50, z: 54 },    // 頂住反撲、死守不退
  { t: 700, x: -66, z: 62 },    // CCA 解圍後鞏固
];

// ── 單位 ──────────────────────────────────────────────
// kind: assault 突擊 / infantry 步兵 / support 火力組 / mg 機槍巢 / garrison 守軍 / armor 裝甲
export const units = [
  // 藍方 — 美軍 E 連與增援裝甲
  {
    id: 'easy-assault', side: 'blue', kind: 'assault', name: 'E 連（溫特斯）', nameEn: "Easy Co. (Winters)",
    role: '506 PIR 2 營先鋒', length: 20,
    strength: { men: 90 },
    track: easyTrack,
    statusChanges: [
      { t: 432, strengthDelta: { men: -8 } },    // 6/12 市鎮街戰負傷（含蒂珀、利普頓）
      { t: 640, strengthDelta: { men: -7 } },     // 6/13 血腥溝防守傷亡
    ],
  },
  {
    id: 'welsh-platoon', side: 'blue', kind: 'assault', name: '威爾許 第 1 排', nameEn: 'Welsh 1st Platoon',
    role: '率衝・炸機槍組 約 30 人', length: 16,
    strength: { men: 30 },
    track: [
      { t: 350, x: -28, z: 74 },
      { t: 396, x: -4, z: 14 },     // 隨主攻衝下斜街
      { t: 418, x: 6, z: 8 },       // 越街投彈炸掉 MG42
      { t: 452, x: -4, z: -16 },
      { t: 565, x: -64, z: 50 },    // 6/13 同守西南路堤
      { t: 700, x: -72, z: 56 },
    ],
    statusChanges: [{ t: 640, strengthDelta: { men: -3 } }],
  },
  {
    id: 'base-mg', side: 'blue', kind: 'support', name: '基底火力組', nameEn: 'Base of fire',
    role: '.30 機槍掩護', length: 10,
    strength: {},
    track: [
      { t: 350, x: -34, z: 70 },
      { t: 400, x: -16, z: 22 },    // 街口側方架槍，壓制窗口
      { t: 565, x: -48, z: 62 },    // 6/13 隨隊上路堤
      { t: 700, x: -58, z: 66 },
    ],
    statusChanges: [],
  },
  {
    id: 'cca-shermans', side: 'blue', kind: 'armor', name: 'CCA 雪曼戰車', nameEn: 'CCA Shermans (2nd Armored)',
    role: '第 2 裝甲師 · 解圍', length: 24, variant: 'sherman',
    strength: {},
    track: [
      { t: 0, x: 60, z: -120 },     // 開戰前在鎮後待命（遠、霧中不顯）
      { t: 600, x: 10, z: -18 },    // 6/13 午後自鎮內出動
      { t: 678, x: -48, z: 40 },    // 沿路向西南反衝
      { t: 700, x: -84, z: 64 },    // 衝入血腥溝、擊潰德軍
    ],
    statusChanges: [],
  },

  // 紅方 — 德軍（6/12 第 6 傘兵團後衛；6/13 第 17 SS 裝甲擲彈兵師反撲）
  {
    id: 'fjr6-town', side: 'red', kind: 'garrison', name: '第 6 傘兵團後衛', nameEn: 'FJR 6 rearguard', facing: 2.4,
    role: '據守市鎮 約 80 人', length: 18,
    strength: { men: 80 },
    track: [{ t: 0, x: 6, z: -6 }],
    statusChanges: [
      { t: 420, strengthDelta: { men: -25 } },   // 機槍組被肅清
      { t: 452, strengthDelta: { men: -45 } },    // 市鎮失守、後衛撤離
    ],
  },
  {
    id: 'mg42-cafe', side: 'red', kind: 'mg', name: 'MG42 封街火力點', nameEn: 'MG42 (Café du Stade)', length: 6,
    strength: {}, track: [{ t: 0, x: 4, z: 7 }],
    statusChanges: [{ t: 420, status: 'destroyed' }],   // 威爾許投彈肅清
  },
  {
    id: 'ss-pzgren', side: 'red', kind: 'garrison', name: '第 17 SS 裝甲擲彈兵', nameEn: '17th SS Panzergrenadiers',
    role: '血腥溝反撲 約 200 人', length: 20, facing: -0.7,
    strength: { men: 200 },
    track: [
      { t: 0, x: -360, z: 320 },    // 6/12 不在場（遠在西南，霧中不顯）
      { t: 560, x: -150, z: 120 },  // 6/13 拂曉沿佩里耶路反撲集結
      { t: 600, x: -110, z: 92 },   // 向東北壓進
      { t: 640, x: -86, z: 78 },    // 鋒抵鎮外約 500 碼
      { t: 685, x: -120, z: 100 },  // 遭 CCA 反衝、潰退
      { t: 700, x: -180, z: 140 },
    ],
    statusChanges: [
      { t: 685, strengthDelta: { men: -60 } },   // CCA 雪曼的致命一擊
      { t: 700, strengthDelta: { men: -50 } },
    ],
  },
  {
    id: 'stug-17ss', side: 'red', kind: 'armor', name: 'StuG 突擊砲', nameEn: 'StuG assault guns (17th SS)',
    role: '反撲裝甲 · 無戰車', length: 22, variant: 'stug',
    strength: {},
    track: [
      { t: 0, x: -380, z: 300 },
      { t: 565, x: -160, z: 116 },
      { t: 620, x: -118, z: 90 },
      { t: 660, x: -96, z: 80 },    // 逼近鎮緣
      { t: 690, x: -150, z: 116 },  // 被擊退
    ],
    statusChanges: [{ t: 692, status: 'destroyed' }],   // 雪曼擊毀其一
  },
];

// 本役無空中單位（地面市鎮／樹籬戰）
export const airGroups = [];

// ── 戰術幾何（供「戰術幾何」疊圖使用） ─────────────────────
export const tactics = {
  baseOfFire: [{ x: -16, z: 22 }, { x: -8, z: 18 }], // 街口側方壓制窗口火力點
  flankPath: [
    { x: -20, z: 66 }, { x: -8, z: 30 }, { x: 2, z: 12 },
    { x: 6, z: 8 }, { x: 8, z: -8 }, { x: 2, z: -20 },
  ],
  gunOrder: ['mg42-cafe', 'fjr6-town'], // 縱射／突擊目標序
  beachDir: { x: -0.6, z: 0.8 }, // 6/13 德軍反撲來向（自西南）
};

// ── 重大事件 ──────────────────────────────────────────
// camera:運鏡;fx:特效;device:招牌手法旗標(geometry/intel/terrain/sync);intel:情報落差
export const events = [
  {
    t: 356, title: '卡倫坦 · 兩灘之間', cinematic: true,
    desc: '卡倫坦是連結猶他灘與奧馬哈灘的樞紐：扼 N13 公路與巴黎–瑟堡鐵路，卡在杜沃河氾濫沼澤之中。合攏兩處灘頭是 D 日沒能達成的目標，布萊德雷將奪取卡倫坦列為首要，交給 101 空降師。6 月 12 日拂曉，溫特斯中尉的 E 連，奉命打 506 團第 2 營的先鋒。',
    camera: { pos: { x: -10, z: 10 }, dist: 540 },
  },
  {
    t: 368, title: '紫心巷不是 E 連的', short: '紫心巷', cinematic: true,
    device: 'intel',
    intel: {
      believed: '影集印象：傘兵沿堤道血戰、上刺刀衝鋒進城',
      actual: '史實：堤道「紫心巷」與柯爾的刺刀衝鋒是第 502 團（6/10–11）；E 連 6/12 才上場，接收的是一條已打開的路',
    },
    desc: '一個常被混淆的真相：北面那條跨越杜沃沼澤、四座石橋、單列無掩蔽的堤道「紫心巷」，以及柯爾中校的上刺刀衝鋒，是第 502 團 6 月 10 至 11 日的血戰（3 營約 67% 傷亡）。E 連與溫特斯 6 月 12 日凌晨才通過耗盡的 502 團、繞向西南投入。真正最血腥的是那條堤道，而那一段不是 E 連打的。',
    camera: { pos: { x: 0, z: -120 }, dist: 420 },
    fx: [{ kind: 'reveal', pos: { x: 0, z: -110 } }],
  },
  {
    t: 380, title: '自西南突入', short: '突入市鎮', cinematic: true,
    device: 'sync',
    desc: '清晨約 0600，E 連打頭，自市鎮西南方殺入；北面由 327／401 滑翔機步兵同步壓上，計畫在鎮中心會師。溫特斯的第 2 營（史崔耶中校）攻西南、滑翔機團攻北面，是泰勒師長設計的鉗形攻勢。',
    camera: { unit: 'easy-assault', dist: 240, elev: 0.5 },
    fx: [{ kind: 'assault', pos: { x: -6, z: 28 }, until: 396 }],
  },
  {
    t: 396, title: 'Y 形路口・MG42 封街', short: 'MG42 封街', cinematic: true,
    device: 'terrain',
    desc: '威爾許中尉率第 1 排越過一道土坡，衝下約一百碼長的斜街。街頭一棟房子（Café du Stade）二樓窗口架著一挺 MG42，沿街筆直掃射，打倒前排弟兄，把全連切成前出小組與卡在路邊溝渠、動彈不得的主體。街道的幾何，成了死亡的漏斗。',
    camera: { pos: { x: 3, z: 10 }, dist: 170 },
    fx: [{ kind: 'gunfire', pos: { x: 4, z: 7 }, until: 418 }],
  },
  {
    t: 412, title: '「給我動！不然就死在這！」', short: '溫特斯督陣', cinematic: true,
    device: 'geometry',
    desc: '全連被切斷、壓制在溝渠裡。一向溫和、極少咆哮的溫特斯，反覆衝進被子彈掃過的街心，邊罵邊踢，把弟兄一個個趕出溝渠向前。馬拉其說，那是他這輩子遇過最猛的火力。指揮官以身犯險，把凍住的連隊重新推動起來。',
    camera: { unit: 'easy-assault', dist: 130, elev: 0.4 },
    fx: [{ kind: 'assault', pos: { x: 3, z: 6 }, until: 424 }],
  },
  {
    t: 420, title: '炸掉機槍組', short: '炸機槍', cinematic: true,
    device: 'geometry',
    desc: '威爾許帶著約六個人，趁隙衝過街道，繞到那棟房子，把手榴彈丟進機槍位置，把整組德軍機槍手解決掉。封死全連的那道火舌一斷，攻勢立刻重新流動起來。',
    camera: { unit: 'mg42-cafe', dist: 120 },
    fx: [{ kind: 'destroy', unit: 'mg42-cafe' }, { kind: 'gunfire', pos: { x: 6, z: 8 }, until: 432 }],
  },
  {
    t: 432, title: '蒂珀重傷', short: '蒂珀重傷', cinematic: true,
    device: 'terrain',
    desc: '逐屋肅清時，二等兵蒂珀與利布戈特一同清查一棟房子。蒂珀剛喊「清空」、站在門口，一發德軍迫擊砲彈在門邊炸開：他右眼被毀（後摘除）、雙腿骨折、肩背中破片，從此沒再上戰場。利布戈特把他抬下火線送往救護站。市鎮街戰，這一天 E 連約有八到十人負傷。',
    camera: { pos: { x: 10, z: -6 }, dist: 150 },
    fx: [{ kind: 'gunfire', pos: { x: 10, z: -8 }, until: 444 }],
  },
  {
    t: 452, title: '市鎮陷落・溫特斯負傷', short: '市鎮陷落', cinematic: true,
    desc: '逐屋肅清到火車站一帶，約 0730 與北面的滑翔機步兵在鎮中心會師，上午卡倫坦落入美軍之手。溫特斯本人在街上多暴露了一會，被一發跳彈擦傷小腿脛骨（這是他整場大戰唯一的一次負傷），軍醫尼夫斯把彈片取了出來。',
    camera: { pos: { x: 2, z: -18 }, dist: 240 },
    fx: [{ kind: 'reveal', pos: { x: 2, z: -20 } }],
  },
  {
    t: 500, title: '入夜・反撲在集結', short: '反撲集結', cinematic: true,
    device: 'sync',
    desc: '入夜，德軍後衛悄悄撤離市鎮；但這不是結束。鎮西南方，第 17 SS 裝甲擲彈兵師「Götz von Berlichingen」正連同馮德海特的傘兵團殘部集結。這是支新編、缺幹部的部隊，沒有戰車，靠的是 StuG 突擊砲。他們要在天亮後沿佩里耶公路向卡倫坦反撲，把美軍重新趕回沼澤。',
    camera: { pos: { x: -120, z: 110 }, dist: 360 },
    fx: [{ kind: 'gunfire', pos: { x: -150, z: 120 }, until: 520 }],
  },
  {
    t: 565, title: '血腥溝・拂曉反撲', short: '血腥溝', cinematic: true,
    device: 'sync',
    desc: '6 月 13 日拂曉，德軍反撲撞上正向西南推進的美軍傘兵，雙方迎頭對撞。第 17 SS 的 StuG 突擊砲伴著裝甲擲彈兵沿佩里耶／博特公路湧來，地點在鎮西南約一哩的 30 高地一帶。輕裝、缺反戰車武器的傘兵節節後退。',
    camera: { unit: 'ss-pzgren', dist: 280, elev: 0.4 },
    fx: [{ kind: 'gunfire', pos: { x: -120, z: 96 }, until: 588 }],
  },
  {
    t: 640, title: '背靠鐵路路堤死守', short: '路堤死守', cinematic: true,
    device: 'geometry',
    desc: '德軍鋒頭逼到離鎮約五百碼，午間幾乎要突破。E 連被分在右翼，背靠一道鐵路路堤布防：左、中的 D 連與 F 連被壓得後退，溫特斯這一翼卻釘在路堤上死不退讓。路堤成了他的胸牆，撐住了瀕臨崩潰的防線。',
    camera: { unit: 'easy-assault', dist: 200, elev: 0.5 },
    fx: [{ kind: 'gunfire', pos: { x: -64, z: 64 }, until: 660 }, { kind: 'assault', pos: { x: -78, z: 74 }, until: 662 }],
  },
  {
    t: 685, title: '雪曼馳援・解圍', short: '雪曼解圍', cinematic: true,
    device: 'sync',
    desc: '決勝的不是傘兵，而是裝甲。午後，第 2 裝甲師戰鬥指揮 A（CCA，羅斯准將）約六十輛雪曼戰車，帶著伴隨步兵，自卡倫坦向西南反衝。缺乏戰車的德軍當面崩潰、被迫撤退。卡倫坦徹底守住，猶他與奧馬哈兩處灘頭就此連成一片。',
    camera: { unit: 'cca-shermans', dist: 240, elev: 0.4 },
    fx: [{ kind: 'barrage', pos: { x: -110, z: 96 }, until: 700 }, { kind: 'destroy', unit: 'stug-17ss' }],
  },
  {
    t: 698, title: '兩灘連線', short: '兩灘連線', cinematic: true,
    desc: '卡倫坦守住了。猶他灘的 VII 軍與奧馬哈灘的 V 軍連成一條連續的灘頭，德軍再也無法分頭擊破。溫特斯後來說，卡倫坦一帶的反撲是「整場戰爭中最艱苦的一仗」。市鎮街口的督陣、鐵路路堤的死守，這是他三部曲的第二章。',
    camera: { pos: { x: -30, z: 20 }, dist: 760 },
  },
];

// ── 戰役結算（播放結束戰績卡） ───────────────────────────
export const outcome = {
  headline: '拿下卡倫坦・連通兩灘',
  sub: '1944/6/12–13 · 卡倫坦市鎮與血腥溝',
  achievement:
    'E 連打 506 團第 2 營先鋒，自西南突入卡倫坦：溫特斯在 MG42 封街的 Y 形路口衝進街心督陣，' +
    '逐屋肅清拿下市鎮（他在此受了整場大戰唯一的傷）。翌日血腥溝，E 連背靠鐵路路堤頂住第 17 SS 的反撲，' +
    '待第 2 裝甲師 CCA 的雪曼戰車馳援，徹底守住卡倫坦，連通猶他與奧馬哈兩灘頭。',
  rows: [
    { key: 'men', label: '投入兵力' },
    { key: 'killed', label: '傷亡' },
    { key: 'captured', label: '被俘' },
  ],
  blue: {
    name: 'E 連（101 空降師）',
    detail: 'E 連約 120 人；6/12 約 10 人、6/13 約 9 人傷亡（概估，Ambrose）。整場卡倫坦 101 師陣亡逾 400',
    values: { men: 120, killed: 19, captured: 0 },
  },
  red: {
    name: '德軍（第 6 傘兵團・第 17 SS 裝甲擲彈兵師）',
    detail: '市鎮守軍＝馮德海特第 6 傘兵團後衛；6/13 反撲＝第 17 SS（傷亡為概估，各家出入大）',
    values: { men: 280, killed: 130, captured: 0 },
  },
};

// ── 關鍵人物（可點選的個人標記） ─────────────────────────
export const aces = [
  { id: 'winters', side: 'blue', name: 'Dick Winters 溫特斯', pos: { x: 3, z: 6 }, activeFrom: 396, activeTo: 452 },
  { id: 'welsh', side: 'blue', name: 'Harry Welsh 威爾許', pos: { x: 6, z: 8 }, activeFrom: 412, activeTo: 430 },
  { id: 'tipper', side: 'blue', name: 'Edward Tipper 蒂珀', pos: { x: 10, z: -7 }, activeFrom: 428, activeTo: 448 },
  { id: 'blithe', side: 'blue', name: 'Albert Blithe 布萊斯', pos: { x: -6, z: -14 }, activeFrom: 452, activeTo: 470 },
];

// ── 陣營與指揮官（面板資料） ────────────────────────────
export const sides = {
  blue: {
    name: '美軍 101 空降師',
    color: 0x2e7bd9,
    commanders: [
      { id: 'winters', name: '理查・溫特斯', nameEn: 'Richard D. Winters', role: 'E 連連長（攻擊指揮，當天中尉）' },
      { id: 'welsh', name: '哈利・威爾許', nameEn: 'Harry Welsh', role: 'E 連 第 1 排排長' },
      { id: 'compton', name: '林恩・康普頓', nameEn: 'Lynn "Buck" Compton', role: 'E 連 第 2 排排長' },
    ],
    formations: [
      { name: '506 傘兵團 第 2 營 E 連', ships: ['E 連（溫特斯）', '威爾許 第 1 排', '基底火力組'], escort: '空降步兵 約 120 人' },
      { name: '第 2 裝甲師 戰鬥指揮 A（CCA）', ships: ['CCA 雪曼戰車'], escort: '約 60 輛雪曼＋第 29 步兵師' },
    ],
    unitIds: ['easy-assault', 'welsh-platoon', 'base-mg', 'cca-shermans'],
    baseMen: 120,
  },
  red: {
    name: '德意志國防軍・武裝黨衛軍',
    color: 0xd9442e,
    commanders: [
      { name: '馮德海特 上校', nameEn: 'F. von der Heydte', role: '第 6 傘兵團（市鎮守備）' },
      { name: '奧斯滕多夫 旅隊長', nameEn: 'Werner Ostendorff', role: '第 17 SS 裝甲擲彈兵師（反撲）' },
    ],
    formations: [
      { name: '第 6 傘兵團（FJR 6）', ships: [], escort: '「卡倫坦之獅」· 後衛兵力耗弱' },
      { name: '第 17 SS 裝甲擲彈兵師', ships: ['StuG 突擊砲'], escort: '裝甲擲彈兵 約 200 人 · StuG 約 12 輛 · 無戰車' },
    ],
    unitIds: ['fjr6-town', 'mg42-cafe', 'ss-pzgren', 'stug-17ss'],
    baseMen: 280,
  },
};
