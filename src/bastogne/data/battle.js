// 巴斯通之圍 — 突出部之役(1944 年 12 月 · 阿登)
// 12 月 16 日德軍發動阿登攻勢,101 空降師自穆爾默隆倉促馳援,死守七路交會的公路樞紐巴斯通。
// 本役聚焦「圍城」的 12/18–26:E 連(506 PIR)在傑克森林 Bois Jacques 的散兵坑裡守線、
// 承受阿登招牌的樹頂空爆與嚴寒;諾維爾阻擊、四面合圍、麥考利夫「呸！」拒降、
// 12/23 天氣放晴空投、耶誕強襲(705 TD 獵殺戰車)、12/26 巴頓第 4 裝甲師解圍。
//
// ★ 史實界線(經多源＋對抗式查核):12 月＝守線＋樹爆＋嚴寒。托伊／圭爾尼斷腿、
//   馬克／潘卡拉陣亡、戴克僵住、史皮爾斯接掌 E 連拿佛伊,全是 1945 年 1 月(圍城解除後)的
//   佛伊之役,不屬本役,故本役不呈現,僅於人物卡標明年代以免誤導。
// 史料依據:U.S. Army CMH(Cole《The Ardennes》、S.L.A. Marshall《Bastogne: The First Eight Days》)、
//   army.mil、National WWII Museum、CSI 巴斯通參謀研究、Ambrose《Band of Brothers》、Winters 回憶錄。
// 座標:1 單位 = 10 公尺;原點 = E 連散兵坑線中央;北 = -z(開闊雪原、佛伊、諾維爾、德軍)、
//   南 = +z(森林縱深、巴斯通鎮、南面解圍來向)。

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 0;     // 12/18 夜：自穆爾默隆馳援抵達
export const TIME_END = 1000;    // 12/26 傍晚：解圍、樞紐守住
export const EPILOGUE_T = 1000;

// t 為壓縮的「戰場進度」;時鐘標籤依分段對應真實日期與時間(橫跨 12/18–26)。
const CLOCK_SEGS = [
  [0, 60, '12/18', 1080, 1320],    // 18:00–22:00 馳援夜行軍
  [60, 150, '12/19', 300, 780],    // 05:00–13:00 進傑克森林挖坑、諾維爾
  [150, 260, '12/21', 420, 690],   // 07:00–11:30 合圍
  [260, 300, '12/22', 690, 720],   // 11:30–12:00 「呸！」
  [300, 440, '12/22', 720, 1350],  // 12:00–22:30 繞過、樹爆長夜
  [440, 500, '12/23', 360, 720],   // 06:00–12:00 放晴、空投
  [500, 660, '12/24', 540, 1350],  // 09:00–22:30 耶誕夜攻擊
  [660, 760, '12/25', 0, 720],     // 00:00–12:00 耶誕強襲
  [760, 900, '12/26', 420, 1010],  // 07:00–16:50 解圍推進
  [900, 1000, '12/26', 1010, 1160],// 16:50–19:20 突破、握手
];
export function formatClock(t) {
  let seg = CLOCK_SEGS[CLOCK_SEGS.length - 1];
  for (const s of CLOCK_SEGS) { if (t <= s[1]) { seg = s; break; } }
  const [a, b, date, ra, rb] = seg;
  const real = ra + (rb - ra) * Math.max(0, Math.min(1, (t - a) / (b - a)));
  const h = Math.floor(real / 60) % 24;
  const m = Math.floor(real % 60);
  return `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 主軸:E 連(506 PIR)— 進傑克森林、上樹線守散兵坑 ──
const easyTrack = [
  { t: 0, x: 30, z: 240 },      // 12/18 夜：自巴斯通鎮下車、向北進森林
  { t: 55, x: 6, z: 42 },       // 12/19 穿過傑克森林
  { t: 72, x: 0, z: 4 },        // 上樹線、挖散兵坑(面北迎向開闊雪原)
  { t: 360, x: 0, z: 4 },       // 樹爆長夜：釘在坑裡不動
  { t: 560, x: 5, z: 1 },       // 12/24 擊退攻擊、微調
  { t: 1000, x: 0, z: 4 },      // 守住到解圍
];

// ── 單位 ──────────────────────────────────────────────
// kind: line 守線 / support 火力組 / infantry 步兵 / grenadier 擲彈兵 / garrison 守軍 / armor 裝甲 / gun 火砲
export const units = [
  // 藍方 — 美軍 101 空降師與增援裝甲
  {
    id: 'easy-line', side: 'blue', kind: 'line', name: 'E 連（506 PIR）', nameEn: 'Easy Co. (506th PIR)',
    role: '傑克森林守線 約 120 人', length: 30, labelY: 16, facing: 0,
    strength: { men: 126 },
    track: easyTrack,
    statusChanges: [
      { t: 360, strengthDelta: { men: -8 } },   // 12/22 夜樹頂空爆
      { t: 425, strengthDelta: { men: -4 } },   // 持續砲擊、凍傷後送
      { t: 560, strengthDelta: { men: -6 } },   // 12/24 擊退攻擊的傷亡
    ],
  },
  {
    id: 'easy-support', side: 'blue', kind: 'support', name: 'E 連 火力組', nameEn: 'Easy Co. weapons',
    role: '.30 機槍／迫擊砲', length: 12, labelY: 10, facing: 0,
    strength: { men: 18 },
    track: [
      { t: 0, x: 40, z: 250 },
      { t: 60, x: 26, z: 30 },
      { t: 74, x: 26, z: 12 },     // 線後方架槍，交叉火網封鎖雪原
      { t: 1000, x: 26, z: 12 },
    ],
    statusChanges: [{ t: 640, strengthDelta: { men: -3 } }],
  },
  {
    id: 'flank-co', side: 'blue', kind: 'line', name: '友鄰連（D／F 連）', nameEn: 'Flanking Co. (D/F)',
    role: '傑克森林側翼', length: 24, labelY: 13, facing: 0,
    strength: { men: 108 },
    track: [
      { t: 0, x: 10, z: 250 },
      { t: 60, x: -140, z: 40 },
      { t: 74, x: -150, z: 6 },    // 守 E 連左鄰(史料對孰左孰右有出入)
      { t: 1000, x: -150, z: 6 },
    ],
    statusChanges: [{ t: 560, strengthDelta: { men: -10 } }],
  },
  {
    id: 'noville-team', side: 'blue', kind: 'armor', name: '諾維爾守備隊', nameEn: 'Noville (1st Bn + Team Desobry)',
    role: '第 1 營＋第 10 裝甲德索布里支隊', length: 22, variant: 'sherman', labelY: 16,
    strength: {},
    track: [
      { t: 0, x: 22, z: -380 },     // 諾維爾(北)
      { t: 95, x: 24, z: -352 },    // 12/19–20 阻擊第 2 裝甲師
      { t: 138, x: 12, z: -186 },   // 撤向佛伊
      { t: 165, x: 8, z: -44 },     // 退入主防線後方
      { t: 1000, x: 10, z: 34 },
    ],
    statusChanges: [],
  },
  {
    id: 'td-705', side: 'blue', kind: 'armor', name: '705 戰車殲擊營', nameEn: '705th TD Bn (M18 Hellcat)',
    role: '獵殺耶誕強襲的戰車', length: 20, variant: 'sherman', labelY: 14,
    strength: {},
    track: [
      { t: 0, x: -180, z: 250 },    // 鎮西待命
      { t: 618, x: -222, z: 192 },  // 12/25 迎擊香普方向的強襲
      { t: 662, x: -200, z: 202 },
      { t: 1000, x: -180, z: 248 },
    ],
    statusChanges: [],
  },
  {
    id: 'relief-4ad', side: 'blue', kind: 'armor', name: '第 4 裝甲師「眼鏡蛇王」', nameEn: '4th Armored (Cobra King)',
    role: '巴頓第 3 軍團 · 解圍', length: 24, variant: 'sherman', labelY: 16,
    strength: {},
    track: [
      { t: 0, x: 90, z: 560 },      // 遠在南方(阿隆公路)
      { t: 790, x: 70, z: 452 },    // 12/26 自南打上來(阿布蘭 37 戰車營)
      { t: 892, x: 54, z: 356 },    // 阿瑟努瓦突破
      { t: 945, x: 42, z: 250 },    // 16:50 與 326 工兵接觸
      { t: 1000, x: 40, z: 226 },
    ],
    statusChanges: [],
  },

  // 紅方 — 德軍(圍城主力為第 26 國民擲彈兵師;裝甲多繞過)
  {
    id: 'vg-line', side: 'red', kind: 'garrison', name: '第 26 國民擲彈兵', nameEn: '26th Volksgrenadier', facing: Math.PI,
    role: '自佛伊向南施壓 約 200 人', length: 22, labelY: 22,
    strength: { men: 200 },
    track: [
      { t: 0, x: 0, z: -320 },
      { t: 180, x: 0, z: -192 },    // 進佛伊
      { t: 360, x: -6, z: -122 },   // 12/22 夜：砲擊掩護下逼近
      { t: 540, x: -10, z: -74 },   // 12/24 攻擊 E 連樹線
      { t: 588, x: -8, z: -128 },   // 被擊退
      { t: 1000, x: -4, z: -178 },
    ],
    statusChanges: [{ t: 588, strengthDelta: { men: -42 } }],
  },
  {
    id: 'vg-xmas', side: 'red', kind: 'grenadier', name: '耶誕強襲部隊', nameEn: 'Christmas assault (26 VGD+15 PzGr)', facing: 0.7,
    role: '香普／埃姆胡勒方向 約 240 人', length: 22, labelY: 20,
    strength: { men: 240 },
    track: [
      { t: 0, x: -420, z: 300 },    // 集結(不在場)
      { t: 620, x: -262, z: 182 },  // 12/25 拂曉自西攻香普
      { t: 648, x: -182, z: 152 },  // 突入防線
      { t: 676, x: -300, z: 224 },  // 被 705 TD＋502 團擊潰
      { t: 1000, x: -430, z: 306 },
    ],
    statusChanges: [
      { t: 660, strengthDelta: { men: -90 } },
      { t: 676, strengthDelta: { men: -70 } },
    ],
  },
  {
    id: 'panzer-xmas', side: 'red', kind: 'armor', name: '德軍戰車（耶誕強襲）', nameEn: 'German tanks (Christmas)',
    role: '約 18 輛 · 全遭擊毀', length: 22, variant: 'panzer', labelY: 15,
    strength: {},
    track: [
      { t: 0, x: -410, z: 300 },
      { t: 626, x: -244, z: 176 },
      { t: 650, x: -172, z: 150 },
      { t: 668, x: -232, z: 200 },
    ],
    statusChanges: [{ t: 660, status: 'destroyed' }],   // 705 TD 的地獄貓獵殺
  },
  {
    id: 'bypass-2pz', side: 'red', kind: 'armor', name: '第 2 裝甲師（繞過）', nameEn: '2nd Panzer (bypassing)',
    role: '不打巴斯通 · 直撲繆斯河', length: 24, variant: 'panzer', labelY: 15,
    strength: {},
    track: [
      { t: 0, x: 120, z: -360 },
      { t: 300, x: -140, z: -262 }, // 12/22 自北繞過
      { t: 360, x: -360, z: -120 }, // 向西
      { t: 460, x: -560, z: 40 },
      { t: 1000, x: -720, z: 210 },
    ],
    statusChanges: [],
  },
  {
    id: 'ger-arty', side: 'red', kind: 'gun', name: '德軍砲兵（樹爆）', nameEn: 'German artillery', facing: Math.PI,
    role: '樹頂空爆砲擊', length: 8, labelY: 8,
    strength: {},
    track: [{ t: 0, x: -60, z: -420 }],
    statusChanges: [],
  },
];

export const airGroups = [];

// ── 戰術幾何(供「交叉火網／殺戮區」疊圖) ─────────────────────
// 地形邏輯(招牌手法):散兵坑線的機槍構成交叉火網,把面前的開闊雪原變成無掩蔽的殺戮區。
export const tactics = {
  baseOfFire: [{ x: 26, z: 12 }, { x: -60, z: 8 }, { x: -150, z: 6 }], // 線上機槍位置
  // 每條火道自機槍位置扇向北面雪原(殺戮區)
  fireLanes: [
    [{ x: 26, z: 12 }, { x: -130, z: -150 }],
    [{ x: 26, z: 12 }, { x: 120, z: -150 }],
    [{ x: -60, z: 8 }, { x: -180, z: -160 }],
    [{ x: -150, z: 6 }, { x: -40, z: -160 }],
  ],
  approach: [{ x: 0, z: -192 }, { x: -6, z: -122 }, { x: -10, z: -74 }], // 德軍自佛伊來的攻擊軸
  killZone: { x: -40, z: -80 },
};

// ── 重大事件 ──────────────────────────────────────────
// camera:運鏡;fx:特效;device:招牌手法旗標(geometry/intel/terrain/sync);intel:情報落差
export const events = [
  {
    t: 20, title: '阿登的暴風雪 · 突出部', cinematic: true,
    desc: '1944 年 12 月 16 日，德軍在阿登發動最後一次西線大攻勢，戰線鼓成一個「突出部」。癱瘓德軍時間表的關鍵，是森林中罕見的公路樞紐巴斯通：七條路在此交會。艾森豪把手上唯一的預備隊 101 空降師，自穆爾默隆連夜卡車北送。師長泰勒不在（人在美國），由砲兵指揮官麥考利夫准將代理指揮。',
    camera: { pos: { x: 40, z: 40 }, dist: 900 },
  },
  {
    t: 60, title: '進傑克森林 · 挖散兵坑', short: '進森林挖坑', cinematic: true,
    device: 'sync',
    desc: '12 月 19 日，E 連冒著雨雪進入巴斯通東北的傑克森林 Bois Jacques，在松林南緣的樹線上挖散兵坑，面朝北面下坡的開闊雪原，對岸是德軍佔領的佛伊。他們剛打完荷蘭、倉促北上，缺大衣、缺手套、缺彈藥。這條樹線，就是往後八天要死守的主抵抗線。',
    camera: { unit: 'easy-line', dist: 240, elev: 0.42 },
    fx: [{ kind: 'gunfire', pos: { x: 0, z: -120 }, until: 90 }],
  },
  {
    t: 105, title: '諾維爾的阻擊', short: '諾維爾阻擊', cinematic: true,
    device: 'terrain',
    desc: '巴斯通北面的諾維爾，第 10 裝甲師的德索布里支隊帶著 506 團第 1 營，在濃霧裡頂住第 2 裝甲師的鋼鐵洪流兩天。拉普拉德中校陣亡、德索布里重傷被俘。他們用血換來的時間，讓巴斯通來得及紮起環形防線，再退回森林。',
    camera: { unit: 'noville-team', dist: 260, elev: 0.4 },
    fx: [{ kind: 'barrage', pos: { x: 20, z: -360 }, until: 130 }, { kind: 'gunfire', pos: { x: 24, z: -352 }, until: 130 }],
  },
  {
    t: 135, title: '師醫院被俘 · 沒有外科醫生', short: '醫院被俘', cinematic: true,
    device: 'terrain',
    desc: '12 月 19 日夜，德軍裝甲插入，把 326 空降醫療連整個端掉，約 140 名醫護與全部手術器材被俘。從此圍城圈裡沒有一間像樣的外科醫院。麥考利夫後來說，他真正的危機從不是怕守不住，而是「傷患堆著、卻沒有外科醫生」。',
    camera: { pos: { x: 40, z: 250 }, dist: 320 },
    fx: [{ kind: 'reveal', pos: { x: 40, z: 250 } }],
  },
  {
    t: 200, title: '四面合圍', short: '合圍', cinematic: true,
    device: 'intel',
    intel: {
      believed: '直覺：被包圍＝甕中之鱉、離全軍覆沒不遠',
      actual: '麥考利夫的算盤：被圍反而好，不必守側翼、四面來敵四面都能還擊。他從沒要求被「解救」',
    },
    desc: '12 月 21 日，最後一條路被切斷，巴斯通四面合圍。但守軍並不慌：環形防線讓砲兵能對任何方向集火，內線調度反而靈活。被包圍，對這支傘兵來說，是「終於不必分心守側翼」。',
    camera: { pos: { x: 20, z: 20 }, dist: 1100 },
    fx: [{ kind: 'barrage', pos: { x: 200, z: 60 }, until: 230 }, { kind: 'barrage', pos: { x: -180, z: 200 }, until: 230 }],
  },
  {
    t: 260, title: '「呸！」', short: '「呸！」拒降', cinematic: true,
    device: 'intel',
    intel: {
      believed: '影集印象：麥考利夫瀟灑回一句「Nuts」就沒了',
      actual: '史實：勸降使者是華格納少校與亨克中尉；打字回條「致德軍指揮官：呸！」（署名美軍指揮官）由哈潑上校（327 團）親手送回，還補一句「用白話說，就是滾蛋」',
    },
    desc: '12 月 22 日約 11:30，德軍派使者送來勸降書，限兩小時投降。麥考利夫看了只嘟囔一句「Aw, nuts!」，參謀金納德建議就用這句當回覆。這個俚語連德軍翻譯都聽不懂，是哈潑上校當面解釋：「就是叫你們滾蛋。」',
    camera: { pos: { x: 40, z: 250 }, dist: 300 },
    fx: [{ kind: 'reveal', pos: { x: 40, z: 250 } }],
  },
  {
    t: 305, title: '鋼鐵洪流繞了過去', short: '裝甲繞過', cinematic: true,
    device: 'sync',
    intel: {
      believed: '想像：德軍傾全力猛攻這座小鎮',
      actual: '史實：第 2 裝甲師與裝甲教導師其實繞過巴斯通、直撲繆斯河；圍城主要交給步兵的第 26 國民擲彈兵師，這正是輕裝守軍守得住的原因',
    },
    desc: '德軍的目標從來不是巴斯通本身，而是它後面的繆斯河與安特衛普。裝甲主力繞過小鎮繼續西進，把「拔掉這根釘子」的差事丟給缺乏戰車的第 26 國民擲彈兵師。守軍要對付的，不再是不可擋的裝甲矛頭。',
    camera: { unit: 'bypass-2pz', dist: 420, elev: 0.4 },
    fx: [{ kind: 'gunfire', pos: { x: -140, z: -262 }, until: 330 }],
  },
  {
    t: 360, title: '樹頂空爆 · 嚴寒長夜', short: '樹頂空爆', cinematic: true,
    device: 'terrain',
    desc: '阿登的招牌恐怖：德軍砲彈不落地，而在松樹的樹冠上凌空炸開，把彈片與尖銳的木屑，像雨一樣直直灌進下方的散兵坑，躲在坑裡也沒用，因為死亡是從頭頂上來的。零度以下的長夜，弟兄們縮在坑底，聽著頭頂樹梢一次次爆裂。',
    camera: { unit: 'easy-line', dist: 150, elev: 0.28 },
    fx: [
      { kind: 'treeburst', pos: { x: -20, z: 6 } },
      { kind: 'treeburst', pos: { x: 40, z: 8 } },
      { kind: 'treeburst', pos: { x: 10, z: 4 } },
    ],
  },
  {
    t: 425, title: '學到教訓 · 給坑加蓋', short: '散兵坑加蓋', cinematic: true,
    device: 'geometry',
    desc: '樹爆逼出一個血的教訓：必須給散兵坑加頂蓋。弟兄們砍下松木橫架在坑上、再堆一層土與雪。老兵羅傑斯回憶，他的第一個坑沒有頂，第二個才學乖加了頂。地形的物理（樹冠是空爆的天花板）逼出了因應的工事。',
    camera: { unit: 'easy-line', dist: 120, elev: 0.35 },
    fx: [{ kind: 'treeburst', pos: { x: -40, z: 6 } }],
  },
  {
    t: 500, title: '天氣放晴 · 空投', short: '放晴空投', cinematic: true,
    device: 'sync',
    desc: '12 月 23 日，壓了整整四天的濃雲終於散開。晴空一放，C-47 成群飛臨，先鋒領航兵標定投擲區，傘花漫天落下：紅傘是彈藥、藍傘是醫藥、黃傘是糧食。同一天，雷電戰鬥機把圍城的德軍狠揍一頓。天一晴，巴斯通就活了過來。',
    camera: { pos: { x: 40, z: 120 }, dist: 620, elev: 0.5 },
    fx: [{ kind: 'reveal', pos: { x: 40, z: 120 } }],
  },
  {
    t: 565, title: '耶誕夜的攻擊被擊退', short: '耶誕夜守線', cinematic: true,
    device: 'geometry',
    desc: '12 月 24 日，國民擲彈兵摸黑向 E 連的樹線發起攻擊。守軍不輕易開火：彈藥要省著用，「沒有明確目標不准扣扳機」。等德軍踏進雪原上機槍交叉封鎖的殺戮區，才一次打垮。開闊的雪地，成了守方的幫手。',
    camera: { unit: 'easy-line', dist: 190, elev: 0.4 },
    fx: [{ kind: 'gunfire', pos: { x: -10, z: -60 }, until: 590 }, { kind: 'assault', pos: { x: -14, z: -74 }, until: 590 }],
  },
  {
    t: 640, title: '耶誕強襲 · 獵殺戰車', short: '耶誕獵戰車', cinematic: true,
    device: 'geometry',
    intel: {
      believed: '想像：靠傘兵步兵的血肉之軀擋下戰車',
      actual: '史實：12/25 攻進香普／埃姆胡勒的十餘輛德軍戰車，是被 705 戰車殲擊營的 M18 地獄貓逐一擊毀，再由 502 團與 463 傘兵砲兵收拾步兵',
    },
    desc: '12 月 25 日拂曉，德軍集中步戰協同，朝西面的香普與埃姆胡勒發起圍城中最兇的一擊，約十八輛戰車突入防線。真正把戰車一輛輛點掉的，是 705 戰車殲擊營的地獄貓；殘餘的步兵被 502 團與傘兵砲兵圍殲。到中午，突入的裝甲全數報銷。',
    camera: { unit: 'panzer-xmas', dist: 240, elev: 0.4 },
    fx: [{ kind: 'destroy', unit: 'panzer-xmas' }, { kind: 'barrage', pos: { x: -220, z: 185 }, until: 680 }],
  },
  {
    t: 790, title: '巴頓北上 · 阿布蘭的突擊', short: '巴頓北上', cinematic: true,
    device: 'sync',
    desc: '南面，巴頓把第 3 軍團硬生生轉向 90 度北上救援。第 4 裝甲師的先鋒是阿布蘭中校的第 37 戰車營（就是日後 M1 主力戰車冠上其名的那位）。他們頂著阻擊，一村一村往巴斯通鑿。',
    camera: { unit: 'relief-4ad', dist: 300, elev: 0.42 },
    fx: [{ kind: 'gunfire', pos: { x: 70, z: 452 }, until: 815 }],
  },
  {
    t: 900, title: '阿瑟努瓦突破 · 解圍', short: '解圍', cinematic: true,
    device: 'sync',
    intel: {
      believed: '流傳：被圍的 101 師，是被裝甲兵「解救」出來的',
      actual: '麥考利夫本人不領情：先到巴斯通的其實是第 10 裝甲師 CCB（12/18 就到、比 101 師還早）；死守靠的是聯合兵種：705 TD、969 砲兵、SNAFU 支隊。CCB「從沒得到應有的功勞」',
    },
    desc: '12 月 26 日約 16:50，第 4 裝甲師在阿瑟努瓦強行突破，先頭雪曼「眼鏡蛇王」與 326 工兵接上頭，約 17:10 阿布蘭與麥考利夫握手。走廊打通，傷患終於能後送。巴斯通，守住了。',
    camera: { unit: 'relief-4ad', dist: 260, elev: 0.4 },
    fx: [{ kind: 'barrage', pos: { x: 54, z: 356 }, until: 940 }, { kind: 'reveal', pos: { x: 42, z: 250 } }],
  },
  {
    t: 980, title: '樞紐守住了', short: '樞紐守住', cinematic: true,
    desc: '巴斯通的七條路始終沒落入德軍手裡，德軍的時間表被這根釘子拖垮。E 連在傑克森林的散兵坑，還要在這片森林裡再撐過整個嚴冬，而攻下佛伊、托伊與圭爾尼斷腿、馬克與潘卡拉陣亡，那些最痛的日子，是下一年一月的事了。麥考利夫始終說：我們不是被救的，我們只是需要外科醫生。',
    camera: { pos: { x: 20, z: 60 }, dist: 1000 },
  },
];

// ── 戰役結算 ───────────────────────────────────────────
export const outcome = {
  headline: '守住樞紐 · 巴斯通不陷',
  sub: '1944/12/18–26 · 阿登 · 突出部之役',
  achievement:
    '101 空降師連同第 10 裝甲師 CCB、705 戰車殲擊營與零散支隊（SNAFU），死守七路交會的巴斯通：' +
    '諾維爾阻擊爭取時間、四面合圍仍靈活集火、麥考利夫「呸！」拒降、12/23 放晴後空投續命、' +
    '耶誕強襲由地獄貓獵殺戰車化解，終於在 12/26 由巴頓第 4 裝甲師打通走廊解圍。德軍攻勢的時間表就此拖垮。',
  rows: [
    { key: 'men', label: '投入兵力' },
    { key: 'killed', label: '傷亡' },
    { key: 'captured', label: '被俘' },
  ],
  blue: {
    name: '美軍（101 空降師）',
    detail: '含第 10 裝甲 CCB · 705 TD · 傷亡為圍城期概估',
    values: { men: 22000, killed: 3000, captured: 0 },
  },
  red: {
    name: '德軍（第 5 裝甲軍團）',
    detail: '第 26 國民擲彈兵為圍城主力 · 傷亡為概估',
    values: { men: 45000, killed: 6000, captured: 0 },
  },
};

// ── 關鍵人物(可點選的個人標記) ─────────────────────────
export const aces = [
  { id: 'mcauliffe', side: 'blue', name: 'McAuliffe 麥考利夫', pos: { x: 40, z: 250 }, activeFrom: 200, activeTo: 320 },
  { id: 'dike', side: 'blue', name: 'Dike 戴克', pos: { x: 6, z: 8 }, activeFrom: 60, activeTo: 130 },
  { id: 'lipton', side: 'blue', name: 'Lipton 利普頓', pos: { x: -6, z: 6 }, activeFrom: 360, activeTo: 470 },
  { id: 'roe', side: 'blue', name: 'Roe 羅醫護兵', pos: { x: 14, z: 6 }, activeFrom: 360, activeTo: 440 },
  { id: 'abrams', side: 'blue', name: 'Abrams 阿布蘭', pos: { x: 54, z: 356 }, activeFrom: 790, activeTo: 940 },
];

// ── 陣營與指揮官(面板資料) ────────────────────────────
export const sides = {
  blue: {
    name: '美軍 101 空降師',
    color: 0x2e7bd9,
    commanders: [
      { id: 'mcauliffe', name: '安東尼・麥考利夫', nameEn: 'Anthony McAuliffe', role: '代理師長（准將 · 「呸！」拒降）' },
      { id: 'dike', name: '諾曼・戴克', nameEn: 'Norman Dike', role: 'E 連連長（圍城期間）' },
      { id: 'lipton', name: '卡伍德・利普頓', nameEn: 'Carwood Lipton', role: 'E 連 連士官（實質撐起全連）' },
    ],
    formations: [
      { name: '506 傘兵團 第 2 營 E 連', ships: ['E 連（506 PIR）', 'E 連 火力組', '友鄰連（D／F 連）'], escort: '傑克森林守線 約 120 人' },
      { name: '增援裝甲', ships: ['諾維爾守備隊', '705 戰車殲擊營', '第 4 裝甲師「眼鏡蛇王」'], escort: '第 10 裝甲 CCB · 705 TD · 第 4 裝甲解圍' },
    ],
    unitIds: ['easy-line', 'easy-support', 'flank-co', 'noville-team', 'td-705', 'relief-4ad'],
    baseMen: 252,
  },
  red: {
    name: '德意志國防軍',
    color: 0xd9442e,
    commanders: [
      { name: '馮・呂特維茨 上將', nameEn: 'H. von Lüttwitz', role: '第 47 裝甲軍（勸降者）' },
      { name: '科科特 少將', nameEn: 'Heinz Kokott', role: '第 26 國民擲彈兵師（圍城主力）' },
    ],
    formations: [
      { name: '第 26 國民擲彈兵師', ships: ['第 26 國民擲彈兵', '耶誕強襲部隊'], escort: '圍城主力 · 約 200 人正面' },
      { name: '第 2 裝甲師（繞過）', ships: ['第 2 裝甲師（繞過）', '德軍戰車（耶誕強襲）'], escort: '裝甲直撲繆斯河 · 未攻城' },
    ],
    unitIds: ['vg-line', 'vg-xmas', 'panzer-xmas', 'bypass-2pz'],
    baseMen: 440,
  },
};
