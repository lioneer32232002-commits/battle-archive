// 天號作戰(天一號作戰)— 坊之岬沖海戰，1945年4月7日(日本標準時間)
// 史料依據:美國海軍歷史與遺產司令部(NHHC H-044-3)、Wikipedia〈Operation Ten-Go〉、
//           原為一《日本驅逐艦艦長》、各艦戰鬥詳報。
// 時間軸:t = 自 4/7 00:00 起算的分鐘數(出擊在 4/6,以開場字卡敘述)
// 座標:1 單位 = 0.1 浬;沉沒海域(約 30°22'N 128°04'E)設為原點;北 = -z、東 = +x
//        艦隊由北(九州外海)向南(沖繩方向)航行;美軍 TF58 在東南方放飛艦載機。

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 660; // 11:00
export const TIME_END = 960; // 16:00(尾聲結束)
export const EPILOGUE_T = 875; // 之後為大爆炸後的收尾

export function formatClock(t) {
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `4/7 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 艦隊航跡(編隊中心) ─────────────────────────────────
// 海上特攻隊自北向南突進,12:32 遭空襲後加速至 24 節並開始迴避,14:23 大和沉沒於原點
const forceTrack = [
  { t: 660, x: -150, z: -760 },
  { t: 752, x: -50, z: -380 },
  { t: 760, x: -30, z: -310 },
  { t: 800, x: 50, z: -150 },
  { t: 842, x: 15, z: -30 },
  { t: 863, x: 0, z: 0 },
  { t: 960, x: 0, z: 0 },
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

// 倖存驅逐艦:隨隊南下,大和沉沒後轉向北方退避、搜救
function survivorTrack(dx, dz, north) {
  return [
    ...offsetTrack(forceTrack, dx, dz).filter((p) => p.t <= 850),
    { t: 900, x: north.x1, z: north.z1 },
    { t: 960, x: north.x2, z: north.z2 },
  ];
}

// ── 單位 ─────────────────────────────────────────────
export const units = [
  // 紅方 — 海上特攻隊(第二艦隊)
  {
    id: 'yamato', side: 'red', kind: 'flagship', name: '大和', nameEn: 'Yamato',
    classLabel: '戰艦', weight: 6, length: 94,
    strength: { hull: 100 },
    track: offsetTrack(forceTrack, 0, 0),
    statusChanges: [
      { t: 758, status: 'burning', strengthDelta: { hull: -15 } }, // 第一波:2 炸彈 + 1 魚雷
      { t: 772, strengthDelta: { hull: -12 } },
      { t: 800, strengthDelta: { hull: -22 } }, // 第二波:魚雷集中左舷
      { t: 815, strengthDelta: { hull: -16 } },
      { t: 830, strengthDelta: { hull: -15 } },
      { t: 850, strengthDelta: { hull: -12 } },
      { t: 860, strengthDelta: { hull: -8 } }, // 傾覆
      { t: 863, status: 'sunk' }, // 14:23 彈藥庫大爆炸
    ],
  },
  {
    id: 'yahagi', side: 'red', kind: 'cruiser', name: '矢矧', nameEn: 'Yahagi',
    classLabel: '輕巡', weight: 3, length: 50,
    strength: {},
    track: offsetTrack(forceTrack, 150, 130, 766), // 12:46 輪機室中雷,停俥
    statusChanges: [
      { t: 766, status: 'burning' },
      { t: 845, status: 'sunk' }, // 14:05 傾覆沉沒
    ],
  },
  {
    id: 'asashimo', side: 'red', kind: 'destroyer', name: '朝霜', nameEn: 'Asashimo',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    // 機械故障掉隊,落在艦隊後方(北),最先被擊沉
    track: [
      { t: 660, x: -240, z: -830 },
      { t: 705, x: -185, z: -660 },
      { t: 730, x: -195, z: -695 },
      { t: 748, x: -195, z: -695 },
    ],
    statusChanges: [
      { t: 740, status: 'burning' },
      { t: 748, status: 'sunk' }, // 全艦官兵陣亡,無人生還
    ],
  },
  {
    id: 'hamakaze', side: 'red', kind: 'destroyer', name: '濱風', nameEn: 'Hamakaze',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    track: offsetTrack(forceTrack, -210, 70, 756),
    statusChanges: [
      { t: 754, status: 'burning' },
      { t: 760, status: 'sunk' }, // 第一波即被擊沉
    ],
  },
  {
    id: 'isokaze', side: 'red', kind: 'destroyer', name: '磯風', nameEn: 'Isokaze',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    track: offsetTrack(forceTrack, 250, -70, 822),
    statusChanges: [
      { t: 820, status: 'burning' },
      { t: 875, status: 'sunk' }, // 喪失動力,由友艦自沉處分
    ],
  },
  {
    id: 'kasumi', side: 'red', kind: 'destroyer', name: '霞', nameEn: 'Kasumi',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    track: offsetTrack(forceTrack, -270, -150, 832),
    statusChanges: [
      { t: 830, status: 'burning' },
      { t: 878, status: 'sunk' }, // 重創後自沉
    ],
  },
  {
    id: 'suzutsuki', side: 'red', kind: 'destroyer', name: '涼月', nameEn: 'Suzutsuki',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    // 艦艏被炸飛,以倒航(後退)獨力返抵佐世保
    track: survivorTrack(-130, -40, { x1: -210, z1: -260, x2: -300, z2: -640 }),
    statusChanges: [{ t: 785, status: 'burning' }],
  },
  {
    id: 'yukikaze', side: 'red', kind: 'destroyer', name: '雪風', nameEn: 'Yukikaze',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    // 全戰爭幾乎毫髮無傷的「奇蹟之艦」
    track: survivorTrack(210, 200, { x1: 290, z1: -160, x2: 360, z2: -540 }),
    statusChanges: [],
  },
  {
    id: 'hatsushimo', side: 'red', kind: 'destroyer', name: '初霜', nameEn: 'Hatsushimo',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    track: survivorTrack(-180, 210, { x1: -260, z1: -150, x2: -340, z2: -520 }),
    statusChanges: [],
  },
  {
    id: 'fuyuzuki', side: 'red', kind: 'destroyer', name: '冬月', nameEn: 'Fuyuzuki',
    classLabel: '驅逐', weight: 1, length: 32,
    strength: {},
    track: survivorTrack(130, 290, { x1: 200, z1: -120, x2: 280, z2: -500 }),
    statusChanges: [],
  },

  // 藍方 — 美國海軍 第58特遣艦隊(在東南方海域,放飛艦載機;全程未受攻擊)
  {
    id: 'bunkerhill', side: 'blue', kind: 'carrier', name: '邦克山號', nameEn: 'USS Bunker Hill',
    deckMark: '17', islandSide: 'right', weight: 2, length: 72,
    strength: { aircraft: 100 },
    track: [{ t: 0, x: 1550, z: 1250 }],
    statusChanges: [{ t: 760, strengthDelta: { aircraft: -3 } }],
  },
  {
    id: 'hornet', side: 'blue', kind: 'carrier', name: '大黃蜂號', nameEn: 'USS Hornet',
    deckMark: '12', islandSide: 'right', weight: 2, length: 72,
    strength: { aircraft: 96 },
    track: [{ t: 0, x: 1760, z: 1150 }],
    statusChanges: [{ t: 805, strengthDelta: { aircraft: -3 } }],
  },
  {
    id: 'essex', side: 'blue', kind: 'carrier', name: '艾塞克斯號', nameEn: 'USS Essex',
    deckMark: '9', islandSide: 'right', weight: 2, length: 72,
    strength: { aircraft: 95 },
    track: [{ t: 0, x: 1650, z: 1430 }],
    statusChanges: [{ t: 825, strengthDelta: { aircraft: -2 } }],
  },
  {
    id: 'yorktown', side: 'blue', kind: 'carrier', name: '約克鎮號', nameEn: 'USS Yorktown',
    deckMark: '10', islandSide: 'right', weight: 2, length: 72,
    strength: { aircraft: 95 },
    track: [{ t: 0, x: 1930, z: 1330 }],
    statusChanges: [{ t: 852, strengthDelta: { aircraft: -2 } }],
  },
];

// ── 攻擊波 / 機隊 ────────────────────────────────────
export const airGroups = [
  {
    id: 'recon', side: 'blue', label: 'PBM 水上偵察機(跟蹤)', count: 1, spawnT: 638, despawnT: 745,
    track: [
      { t: 638, x: 1500, z: 1000 },
      { t: 690, x: -120, z: -600 },
      { t: 745, x: 1400, z: 950 },
    ],
  },
  {
    id: 'wave1', side: 'blue', label: '第一波攻擊隊 約280機', count: 11, spawnT: 745, despawnT: 800,
    track: [
      { t: 745, x: 1600, z: 1050 },
      { t: 758, x: -40, z: -360 },
      { t: 772, x: 0, z: -290 },
      { t: 800, x: 1520, z: 1000 },
    ],
  },
  {
    id: 'wave2', side: 'blue', label: '第二波攻擊隊(TG58.4 約106機)', count: 8, spawnT: 793, despawnT: 838,
    track: [
      { t: 793, x: 1720, z: 1180 },
      { t: 808, x: 35, z: -120 },
      { t: 822, x: 55, z: -80 },
      { t: 838, x: 1600, z: 1050 },
    ],
  },
  {
    id: 'wave3', side: 'blue', label: '第三波攻擊隊 致命一擊', count: 10, spawnT: 834, despawnT: 872,
    track: [
      { t: 834, x: 1650, z: 1100 },
      { t: 850, x: 10, z: -20 },
      { t: 863, x: 0, z: 0 },
      { t: 872, x: 1500, z: 1000 },
    ],
  },
];

// ── 重大事件 ─────────────────────────────────────────
// camera: { unit | pos, dist } 導演運鏡目標;fx: 特效指令
export const events = [
  {
    t: 662, title: '海上特攻:大和號最後的出擊', short: '海上特攻', cinematic: true,
    desc: '1945年4月6日,沖繩戰況危急。聯合艦隊孤注一擲,命戰艦大和率輕巡矢矧與 8 艘驅逐艦組成「海上特攻隊」,只攜帶單程燃料,衝向沖繩衝灘充當固定砲台,與登陸美軍同歸於盡。司令長官伊藤整一一度反對這道有去無回的死命令,最終含淚從命。',
    camera: { unit: 'yamato', dist: 520 },
  },
  {
    t: 700, title: '潛艦的通報', cinematic: true,
    desc: '艦隊穿越豐後水道時,被美軍潛艦「絲鰭號(Threadfin)」與「哈克貝克號(Hackleback)」發現。兩艦以明碼連續回報大和艦隊的航向與速度。美軍第五艦隊司令史普魯恩斯掌握了全部行蹤——這支艦隊從一開始就毫無奇襲可言。',
    camera: { unit: 'yamato', dist: 800 },
  },
  {
    t: 730, title: '沒有空中掩護的艦隊',
    desc: '與此同時,九州基地放出近 700 架飛機(多為神風特攻機)撲向美軍艦隊,即「菊水一號作戰」。但這些飛機無一掩護大和——艦隊頭頂的天空空無一機。在制空權盡失的海上,鋼鐵巨艦只能任由敵機宰割。',
    camera: { unit: 'yamato', dist: 1100 },
  },
  {
    t: 745, title: '朝霜掉隊',
    desc: '驅逐艦「朝霜」機械故障,航速漸減,被迫脫離編隊落在後方。失去隊伍掩護的它,成為美軍機群的第一個目標。',
    camera: { unit: 'asashimo', dist: 360 },
    fx: [{ kind: 'flak', unit: 'asashimo', until: 752 }],
  },
  {
    t: 748, title: '朝霜被擊沉', short: '朝霜沉沒', cinematic: true,
    desc: '孤立的朝霜遭俯衝轟炸機圍攻,迅速沉入東海,全艦官兵無一生還。海上特攻隊首艦沉沒。',
    camera: { unit: 'asashimo', dist: 300 },
    fx: [{ kind: 'divebomb', unit: 'asashimo', at: 748 }],
  },
  {
    t: 752, title: '12:32 發現大批敵機', short: '敵機來襲', cinematic: true,
    desc: '瞭望哨發出警報:西南方大批美機湧現。第58特遣艦隊(米契爾中將)出動約 386 架艦載機,分三波撲向艦隊。決戰時刻來臨。',
    camera: { unit: 'yamato', dist: 700 },
  },
  {
    t: 754, title: '大和開火:三式彈',
    desc: '大和以 460 公釐主砲發射對空「三式燒霰彈」企圖驅散來襲機群,全艦防空炮火齊射,艦隊加速至 24 節展開迴避運動。然而漫天彈幕仍擋不住蜂擁而至的美機。',
    camera: { unit: 'yamato', dist: 360 },
    fx: [{ kind: 'flak', unit: 'yamato', until: 772 }],
  },
  {
    t: 758, title: '第一波空襲:大和中彈', short: '大和中彈', cinematic: true,
    desc: '美機自雲層俯衝而下。大和左舷中 1 枚魚雷、艦體後段連中 2 枚炸彈,上層建築起火。濱風、涼月同時受重創。對單艦集中攻擊的屠殺,就此展開。',
    camera: { unit: 'yamato', dist: 320 },
    fx: [
      { kind: 'divebomb', unit: 'yamato', at: 758 },
      { kind: 'torpedo-run', unit: 'yamato', at: 759 },
    ],
  },
  {
    t: 760, title: '濱風沉沒',
    desc: '驅逐艦濱風艦體被攔腰炸斷,迅速沉沒。護衛圈出現缺口,大和愈發孤立。',
    camera: { unit: 'hamakaze', dist: 300 },
    fx: [{ kind: 'divebomb', unit: 'hamakaze', at: 760 }],
  },
  {
    t: 766, title: '矢矧中雷,停俥', short: '矢矧停俥', cinematic: true,
    desc: '輕巡洋艦矢矧輪機室直接中雷,動力全失,在海面停俥漂流。艦長原為一——以《日本驅逐艦艦長》回憶錄聞名的老練指揮官——眼看愛艦淪為活靶。',
    camera: { unit: 'yahagi', dist: 320 },
    fx: [{ kind: 'torpedo-run', unit: 'yahagi', at: 765 }, { kind: 'flak', unit: 'yahagi', until: 780 }],
  },
  {
    t: 800, title: '第二波:魚雷集中左舷', short: '魚雷左舷', cinematic: true,
    desc: '美軍刻意把魚雷集中打向大和左舷,意圖使這艘世界最大的戰艦失衡傾覆。短時間內又有多枚魚雷命中,艦體開始向左傾斜。',
    camera: { unit: 'yamato', dist: 320 },
    fx: [
      { kind: 'torpedo-run', unit: 'yamato', at: 800 },
      { kind: 'divebomb', unit: 'yamato', at: 802 },
      { kind: 'flak', unit: 'yamato', until: 820 },
    ],
  },
  {
    t: 815, title: '注水反傾:輪機員的犧牲',
    desc: '為扶正左傾,損管下令對右舷機艙、鍋爐艙緊急注水。來不及撤離的數百名輪機兵,就此被封死在艙內隨海水沒頂。大和的航速因此驟降。',
    camera: { unit: 'yamato', dist: 280 },
  },
  {
    t: 825, title: '磯風、霞失去戰力',
    desc: '迴避中的磯風與霞相繼中彈,動力盡失,在海面停俥燃燒。十艘出擊的軍艦,已有過半喪失戰鬥力。',
    camera: { unit: 'isokaze', dist: 340 },
    fx: [{ kind: 'divebomb', unit: 'isokaze', at: 825 }, { kind: 'flak', unit: 'kasumi', until: 838 }],
  },
  {
    t: 842, title: '14:02 中止作戰、總員退去', short: '中止作戰', cinematic: true,
    desc: '大和已無法操舵、注定沉沒。伊藤整一下令中止作戰、全員退艦,與幕僚一一握手後,獨自走進長官室,反鎖艙門,選擇與艦共沉。電報設備全毀,命令只能以信號旗傳達。',
    camera: { unit: 'yamato', dist: 300 },
  },
  {
    t: 845, title: '矢矧沉沒',
    desc: '矢矧在連中 6 枚以上魚雷、12 枚炸彈後傾覆沉沒。艦長原為一被捲入海中又奇蹟浮起,終獲救生還,成為這場死戰中極少數倖存的指揮官。',
    camera: { unit: 'yahagi', dist: 300 },
    fx: [{ kind: 'torpedo-run', unit: 'yahagi', at: 843 }],
  },
  {
    t: 860, title: '14:20 大和傾覆', short: '大和傾覆', cinematic: true,
    desc: '承受約 11 枚魚雷、6 枚炸彈後,大和向左完全傾覆,艦底朝天。艦長有賀幸作把自己綁在羅經儀座上,隨艦沉入海中。',
    camera: { unit: 'yamato', dist: 280 },
    fx: [{ kind: 'flak', unit: 'yamato', until: 863 }],
  },
  {
    t: 863, title: '14:23 大爆炸', short: '大爆炸', cinematic: true,
    desc: '傾覆的大和後部彈藥庫驟然引爆。火柱與蕈狀雲衝上近 6,000 公尺高空,200 公里外的鹿兒島都能看見、聽見。世界最大的戰艦就此化為烏有。全艦約 3,000 餘名官兵,生還者僅約 270 人。',
    camera: { unit: 'yamato', dist: 340 },
    fx: [{ kind: 'cataclysm', pos: { x: 0, z: 0 } }],
  },
  {
    t: 875, title: '磯風、霞自沉',
    desc: '倖存的驅逐艦冒死駛近燃燒的海面搶救落海官兵,再以魚雷、炮火將無法航行的磯風、霞自沉處分,避免落入敵手。',
    camera: { pos: { x: 100, z: -120 }, dist: 600 },
  },
  {
    t: 885, title: '生還者的歸途',
    desc: '冬月、雪風、初霜載著大和、矢矧及各艦的生還者北返。艦艏被炸飛的涼月,竟以倒航(全程後退)獨力駛回佐世保。而雪風再次毫髮無傷地返航,坐實了「奇蹟之艦」之名。',
    camera: { unit: 'suzutsuki', dist: 360 },
  },
  {
    t: 905, title: '巨艦大砲時代的終結', short: '時代終結', cinematic: true,
    desc: '此役日軍折損大和、矢矧及 4 艘驅逐艦,陣亡約 3,700 人,含司令長官伊藤整一與大和艦長有賀幸作;美軍僅損失約 10 架飛機。沒有制空權的鋼鐵巨艦,連敵艦的影子都沒見著便葬身海底。大和的覆滅,為「巨艦大砲」的時代劃下了悲壯的句點。',
    camera: { pos: { x: 0, z: -200 }, dist: 2600 },
  },
];

// ── 戰役結算(播放結束戰損比較表) ─────────────────────
export const outcome = {
  headline: '巨艦大砲時代的終結',
  sub: '1945/4/7 · 坊之岬沖海戰',
  rows: [
    { key: 'battleship', label: '戰艦 沉沒' },
    { key: 'cruiser', label: '輕巡洋艦 沉沒' },
    { key: 'destroyer', label: '驅逐艦 沉沒' },
    { key: 'aircraft', label: '飛機 損失' },
    { key: 'killed', label: '陣亡 將士' },
  ],
  red: {
    name: '大日本帝國海軍',
    detail: '大和、矢矧、朝霜、濱風、磯風、霞',
    values: { battleship: 1, cruiser: 1, destroyer: 4, aircraft: 0, killed: 3700 },
  },
  blue: {
    name: '美國海軍 第58特遣艦隊',
    detail: '艦載機約 386 架',
    values: { battleship: 0, cruiser: 0, destroyer: 0, aircraft: 10, killed: 12 },
  },
};

// 此役無個別王牌空戰(大規模集中空襲),重要人物以指揮官/艦長小傳呈現
export const aces = [];

// ── 陣營與指揮官(面板資料) ───────────────────────────
export const sides = {
  red: {
    name: '大日本帝國海軍',
    color: 0xd9442e,
    flagshipId: 'yamato',
    bars: [
      { key: 'flagship', label: '旗艦 大和', icon: '和' },
      { key: 'fleet', label: '艦隊戰力', icon: '艦' },
    ],
    totalKind: 'ships',
    totalLabel: '存活艦艇',
    commanders: [
      { id: 'toyoda', name: '豐田副武', nameEn: 'Soemu Toyoda', role: '聯合艦隊司令長官（下令出擊）' },
      { id: 'ito', name: '伊藤整一', nameEn: 'Seiichi Itō', role: '第二艦隊司令長官・海上特攻隊指揮官（旗艦大和）' },
      { id: 'komura', name: '古村啟藏', nameEn: 'Keizō Komura', role: '第二水雷戰隊司令官（旗艦矢矧）' },
    ],
    formations: [
      {
        name: '海上特攻隊（第二艦隊）',
        ships: ['戰艦 大和', '輕巡洋艦 矢矧'],
        escort: '驅逐艦 8 艘(朝霜、濱風、磯風、霞、涼月、雪風、初霜、冬月)',
      },
    ],
    unitIds: ['yamato', 'yahagi', 'asashimo', 'hamakaze', 'isokaze', 'kasumi', 'suzutsuki', 'yukikaze', 'hatsushimo', 'fuyuzuki'],
    baseAircraft: 0,
  },
  blue: {
    name: '美國海軍',
    color: 0x2e7bd9,
    flagshipId: null,
    bars: [
      { key: 'air', label: '航空戰力', icon: '空' },
      { key: 'fleet', label: '航艦戰隊', icon: '艦' },
    ],
    totalKind: 'aircraft',
    totalLabel: '航空戰力合計',
    commanders: [
      { id: 'spruance', name: '雷蒙・史普魯恩斯', nameEn: 'Raymond A. Spruance', role: '第五艦隊司令（總指揮）' },
      { id: 'mitscher', name: '馬克・米契爾', nameEn: 'Marc A. Mitscher', role: '第58特遣艦隊司令（旗艦邦克山號）' },
      { id: 'sherman', name: '弗雷德里克・薛曼', nameEn: 'Frederick C. Sherman', role: 'TG 58.3 航艦戰隊司令' },
    ],
    formations: [
      {
        name: 'Task Force 58 第58特遣艦隊',
        ships: ['USS Bunker Hill 邦克山號', 'USS Hornet 大黃蜂號', 'USS Essex 艾塞克斯號', 'USS Yorktown 約克鎮號'],
        escort: '共約 11 艘航艦・艦載機約 386 架',
      },
    ],
    unitIds: ['bunkerhill', 'hornet', 'essex', 'yorktown'],
    baseAircraft: 386,
  },
};
