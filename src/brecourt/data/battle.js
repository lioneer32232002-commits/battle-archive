// 布雷庫爾奪砲戰 — E 連(101 空降師 506 傘兵團 第 2 營 E 連)
// 1944 年 6 月 6 日(D 日)晨,溫斯特以約 13 人摧毀威脅猶他灘出口的四門德軍 105mm 榴彈砲
// 史料依據:Stephen Ambrose《Band of Brothers》、506 PIR 團史、
//          美國西點軍校「布雷庫爾莊園攻擊」班排攻擊教案、當地地形(IGN 地圖)
// 時間軸:t = 自 6/6 00:00 起算的分鐘數(全程為 D 日當日上午)
// 座標:1 單位 = 10 公尺;原點 = 布雷庫爾砲線;北 = -z、東 = +x(猶他灘在東)
// 註:傷亡與守備人數為概估,各家記載略有出入。

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 70;   // 6/6 01:10(C-47 機群進場)
export const TIME_END = 640;    // 6/6 10:40(任務達成，鞏固)
export const EPILOGUE_T = 640;

export function formatClock(t) {
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `6/6 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 主軸:E 連自空降散落點 → 集結 → 砲線 ───────────────
const eCompanyTrack = [
  { t: 92, x: -340, z: -300 },  // 溫斯特落地(聖梅爾埃格利斯一帶，失槍)
  { t: 300, x: -55, z: 60 },    // 集結於勒格朗謝曼
  { t: 470, x: -20, z: 46 },    // 進抵砲線外緣的出發線
  { t: 548, x: -14, z: 44 },    // 突擊期間留守出發線當支援/預備(連主力未全壓上)
  { t: 600, x: 4, z: 36 },      // 砲線肅清後才上前
  { t: 640, x: -8, z: 70 },     // 鞏固
];

// ── 單位 ──────────────────────────────────────────────
// kind: infantry 步兵 / assault 突擊隊 / support 火力組 / gun 火砲 / mg 機槍巢 / garrison 守軍
export const units = [
  // 藍方 — 美軍 E 連
  {
    id: 'easy', side: 'blue', kind: 'infantry', name: 'E 連', nameEn: 'Easy Company',
    role: '506 PIR 第 2 營', length: 22,
    strength: { men: 24 },
    track: eCompanyTrack,
    statusChanges: [{ t: 548, strengthDelta: { men: -4 } }],
  },
  {
    id: 'winters-party', side: 'blue', kind: 'assault', name: '溫斯特突擊隊', nameEn: "Winters' assault",
    role: '主攻組 約 13 人', length: 14,
    strength: { men: 13 },
    // 沿樹籬切入,逐砲滾進(縱射),拔砲後撤回
    track: [
      { t: 470, x: -10, z: 46 },
      { t: 500, x: 6, z: 36 },
      { t: 512, x: 8, z: 30 },   // 一號砲
      { t: 524, x: 8, z: 14 },   // 二號砲
      { t: 536, x: 9, z: -2 },   // 三號砲(L 形轉角)
      { t: 548, x: 28, z: -6 },  // 四號砲(橫臂)
      { t: 600, x: 8, z: 22 },
      { t: 640, x: 8, z: 22 },
    ],
    statusChanges: [{ t: 548, strengthDelta: { men: -4 } }],
  },
  {
    id: 'base-of-fire', side: 'blue', kind: 'support', name: '基底火力組', nameEn: 'Base of fire',
    role: '兩挺 .30 機槍', length: 10,
    strength: { men: 4 },
    track: [{ t: 0, x: 2, z: 46 }], // 定點壓制砲線
    statusChanges: [],
  },

  // 紅方 — 德軍砲兵連。L 形砲位:gun-1/2/3 沿縱臂朝東(+x,轟猶他灘),gun-4 在橫臂端朝北(-z,護左翼)
  { id: 'gun-1', side: 'red', kind: 'gun', name: '一號砲', nameEn: '105mm', length: 8, facing: 0,
    strength: {}, track: [{ t: 0, x: 8, z: 30 }],
    statusChanges: [{ t: 512, status: 'destroyed' }] },
  { id: 'gun-2', side: 'red', kind: 'gun', name: '二號砲', nameEn: '105mm', length: 8, facing: 0,
    strength: {}, track: [{ t: 0, x: 8, z: 14 }],
    statusChanges: [{ t: 524, status: 'destroyed' }] },
  { id: 'gun-3', side: 'red', kind: 'gun', name: '三號砲', nameEn: '105mm', length: 8, facing: 0,
    strength: {}, track: [{ t: 0, x: 9, z: -2 }],
    statusChanges: [{ t: 536, status: 'destroyed' }] },
  { id: 'gun-4', side: 'red', kind: 'gun', name: '四號砲', nameEn: '105mm', length: 8, facing: Math.PI / 2,
    strength: {}, track: [{ t: 0, x: 28, z: -6 }],
    statusChanges: [{ t: 548, status: 'destroyed' }] },
  { id: 'mg-nest', side: 'red', kind: 'mg', name: 'MG42 火力點', nameEn: 'MG nest', length: 6,
    strength: {}, track: [{ t: 0, x: 22, z: -12 }],
    statusChanges: [{ t: 536, status: 'destroyed' }] },
  {
    id: 'battery-crew', side: 'red', kind: 'garrison', name: '德軍砲兵連', nameEn: 'Wehrmacht battery',
    role: '約 50 人守備', length: 16,
    strength: { men: 50 },
    track: [{ t: 0, x: 12, z: 8 }],
    statusChanges: [
      { t: 512, strengthDelta: { men: -15 } },
      { t: 548, status: 'destroyed', strengthDelta: { men: -35 } },
    ],
  },
];

// ── C-47 機群與傘兵(D 日夜跳) ─────────────────────────
export const airGroups = [
  {
    id: 'c47-serial', side: 'blue', label: 'C-47 運輸機群（506 團）',
    count: 9, spawnT: 70, despawnT: 150,
    track: [
      { t: 70, x: -1500, z: -250 },
      { t: 92, x: -260, z: -120 },
      { t: 108, x: 120, z: -40 },
      { t: 150, x: 1400, z: 60 },
    ],
  },
  {
    id: 'c47-2nd', side: 'blue', label: 'C-47 第二批',
    count: 7, spawnT: 96, despawnT: 168,
    track: [
      { t: 96, x: -1500, z: -420 },
      { t: 120, x: -180, z: -300 },
      { t: 134, x: 200, z: -240 },
      { t: 168, x: 1400, z: -160 },
    ],
  },
];

// ── 布雷庫爾戰術幾何(供「戰術幾何」疊圖使用) ────────────
export const tactics = {
  baseOfFire: [{ x: 2, z: 46 }, { x: 14, z: 50 }], // 兩挺機槍位置
  flankPath: [
    { x: -10, z: 46 }, { x: 6, z: 36 }, { x: 8, z: 30 },
    { x: 8, z: 14 }, { x: 9, z: -2 }, { x: 28, z: -6 },
  ],
  gunOrder: ['gun-1', 'gun-2', 'gun-3', 'gun-4'],
  beachDir: { x: 1, z: 0.25 }, // 砲口指向猶他灘出口(東)
};

// ── 重大事件 ──────────────────────────────────────────
// camera:運鏡;fx:特效;device:招牌手法旗標(geometry/intel/terrain/sync);intel:情報落差
export const events = [
  {
    t: 75, title: '科唐坦半島上空', cinematic: true,
    desc: '1944 年 6 月 6 日凌晨，逾 800 架 C-47 載著傘兵飛越科唐坦半島。雲層與德軍高射砲火網打散了編隊，跳傘綠燈在猛烈搖晃中亮起。E 連的目標：猶他灘出口後方的空降區。',
    camera: { air: 'c47-serial', dist: 320, elev: -0.1, az: 2.4, lookY: 95 },
    fx: [{ kind: 'flakair', pos: { x: -120, z: -90 } }],
  },
  {
    t: 92, title: '分散的傘降', short: '分散傘降', cinematic: true,
    desc: '高速與低空使傘兵散落各處。溫斯特中尉落在聖梅爾埃格利斯附近，武器袋在跳傘時脫落，只剩一把刺刀。他在黑暗中循聲集合任何找得到的弟兄。',
    camera: { unit: 'easy', dist: 380, elev: 0.22 },
    fx: [{ kind: 'flak', pos: { x: -260, z: -120 }, until: 110 }],
  },
  {
    t: 200, title: '蟋蟀響板的集結',
    desc: '傘兵以金屬蟋蟀響板（一咔回兩咔）在暗夜中相認。天亮前，溫斯特在勒格朗謝曼集結了十餘名弟兄，聽見前方田野傳來規律的德軍砲聲。',
    camera: { unit: 'easy', dist: 320 },
  },
  {
    t: 440, title: '「處理掉那些砲」', short: '接令', cinematic: true,
    device: 'intel',
    intel: { believed: '情報模糊：前方田野「有幾門砲」在開火', actual: '' },
    desc: '營部只給了一句模糊的命令：勒格朗謝曼旁有德軍火砲正轟擊猶他灘出口，「去處理掉」。溫斯特當下以為不過是一兩門落單的砲。他帶著手邊僅有的十餘人摸向樹籬。',
    camera: { pos: { x: 12, z: 18 }, dist: 240 },
    fx: [{ kind: 'gunfire', pos: { x: 12, z: 10 }, until: 470 }],
  },
  {
    t: 475, title: '抵近偵察：真相', short: '情報落差', cinematic: true,
    device: 'intel',
    intel: { believed: '以為：一兩門落單的砲', actual: '實際：第 90 砲兵團第 6 連，四門 105mm 榴彈砲呈 L 形塹壕（三門朝東、一門朝北），MG 火力點、約 50 人' },
    desc: '溫斯特爬上樹籬觀察，真相浮現：不是一兩門，而是德軍第 90 砲兵團第 6 連的四門 105mm 榴彈砲，沿 L 形塹壕構築（三門朝東、一門朝北護住左翼），以機槍火力點與約 50 名守軍掩護。寡不敵眾，他沒有退，而是把劣勢拆成一道可解的題目。',
    camera: { pos: { x: 12, z: 12 }, dist: 230 },
    fx: [{ kind: 'reveal', pos: { x: 12, z: 12 } }],
  },
  {
    t: 500, title: '溫斯特的攻擊', short: '溫斯特攻擊', cinematic: true,
    device: 'geometry',
    desc: '教科書級的解法：留兩挺機槍當「基底火力」把整條砲線釘死，主攻組沿樹籬隱蔽接近敵人側翼，再沿塹壕由側面逐砲縱射，一次只需對付一門。13 人於是能吃掉 50 人。',
    camera: { pos: { x: 10, z: 16 }, dist: 205 },
    fx: [{ kind: 'assault', pos: { x: 8, z: 28 }, until: 515 }, { kind: 'gunfire', pos: { x: 3, z: 46 }, until: 560 }],
  },
  {
    t: 512, title: '一號砲拔除', short: '一號砲',
    device: 'geometry',
    desc: '主攻組躍入第一個砲坑，投彈解決砲組。溫斯特以 TNT 加德製「馬鈴薯搗碎器」手榴彈塞入砲管引爆，徹底炸毀火砲，再把基底火力依序前推，壓制下一個砲位。',
    camera: { unit: 'gun-1', dist: 130 },
    fx: [{ kind: 'destroy', unit: 'gun-1' }],
  },
  {
    t: 524, title: '二號砲拔除', short: '二號砲',
    device: 'geometry',
    desc: '沿塹壕逐段清除。德軍以 MG42 與迫擊砲反撲，洛伊（Joe Toye）等人冒火力前推。E 連付出傷亡，仍持續逼近。',
    camera: { unit: 'gun-2', dist: 130 },
    fx: [{ kind: 'destroy', unit: 'gun-2' }, { kind: 'gunfire', pos: { x: 9, z: 4 }, until: 540 }],
  },
  {
    t: 536, title: '三號砲拔除．奪得灘防圖', short: '奪得灘防圖', cinematic: true,
    device: 'sync',
    desc: '逐砲滾進的過程中，溫斯特在二號砲位搜出一份德軍地圖，標明整段海岸的砲兵陣地與射界。情報價值連城：它經情報官尼克森送抵猶他灘，第 4 步兵師因而回贈兩輛搶灘戰車支援。此刻灘外，登陸部隊正沿這些砲威脅的堤道湧上岸，拔掉一門砲，就為堤道上的人多開一條生路。',
    camera: { unit: 'gun-3', dist: 140 },
    fx: [{ kind: 'destroy', unit: 'gun-3' }, { kind: 'destroy', unit: 'mg-nest' }],
  },
  {
    t: 548, title: '四號砲拔除', short: '四號砲', cinematic: true,
    device: 'geometry',
    desc: 'D 連的史皮爾斯中尉率增援趕到，衝過開闊地拔除最後一門砲。E 連以約 13 人（後增至約 21）擊潰約 50 人的守備，摧毀四門 105mm 榴彈砲。',
    camera: { unit: 'gun-4', dist: 150 },
    fx: [{ kind: 'destroy', unit: 'gun-4' }],
  },
  {
    t: 600, title: '猶他灘的生路', short: '猶他灘生路', cinematic: true,
    device: 'sync',
    desc: '四門砲沉默後，猶他灘 2 號堤道的車流安全湧入內陸。一場約 13 人對 50 人的小規模戰鬥，牽動了整個灘頭的命運。此役後成為西點軍校的班排攻擊範例。',
    camera: { pos: { x: 60, z: 30 }, dist: 900 },
  },
];

// ── 戰役結算(播放結束戰績卡) ───────────────────────────
// 摧毀火砲是 E 連的戰果(德軍並無「拔砲」任務),故不列為雙方對稱欄位,獨立為「戰果」呈現。
export const outcome = {
  headline: '猶他灘的生路',
  sub: '1944/6/6 · 布雷庫爾莊園',
  achievement:
    '摧毀四門 105mm 榴彈砲；並在二號砲位搜獲一份標明整段海岸德軍砲位與射界的地圖，' +
    '經情報官尼克森送抵猶他灘，第 4 步兵師因而回贈兩輛搶灘戰車支援。',
  rows: [
    { key: 'men', label: '投入兵力' },
    { key: 'killed', label: '陣亡' },
    { key: 'captured', label: '被俘' },
  ],
  blue: {
    name: 'E 連（101 空降師）',
    detail: '溫斯特核心約 13 人，含增援共約 21 人（4 陣亡、6 負傷）',
    values: { men: 21, killed: 4, captured: 0 },
  },
  red: {
    name: '德軍砲兵連（第 90 砲兵團 第 6 連）',
    detail: '四門 105mm、約 50 人守備',
    values: { men: 50, killed: 15, captured: 12 },
  },
};

// ── 關鍵人物(可點選的個人標記) ─────────────────────────
export const aces = [
  { id: 'winters', side: 'blue', name: 'Dick Winters 溫斯特', pos: { x: 6, z: 6 }, activeFrom: 470, activeTo: 600 },
  { id: 'compton', side: 'blue', name: 'Buck Compton 康普頓', pos: { x: 20, z: 4 }, activeFrom: 500, activeTo: 560 },
  { id: 'guarnere', side: 'blue', name: 'Bill Guarnere 圭爾尼', pos: { x: 12, z: -4 }, activeFrom: 505, activeTo: 560 },
  { id: 'speirs', side: 'blue', name: 'Ronald Speirs 史皮爾斯', pos: { x: 30, z: -8 }, activeFrom: 540, activeTo: 600 },
];

// ── 陣營與指揮官(面板資料) ────────────────────────────
export const sides = {
  blue: {
    name: '美軍 101 空降師',
    color: 0x2e7bd9,
    commanders: [
      { id: 'sink', name: '羅伯特・辛克', nameEn: 'Robert F. Sink', role: '506 傘兵團團長' },
      { id: 'winters', name: '理查・溫斯特', nameEn: 'Richard D. Winters', role: 'E 連（攻擊指揮）' },
      { id: 'speirs', name: '羅納德・史皮爾斯', nameEn: 'Ronald Speirs', role: 'D 連（增援拔砲）' },
    ],
    formations: [
      { name: '506 傘兵團 第 2 營 E 連', ships: ['溫斯特突擊隊', '基底火力組'], escort: '空降步兵 約 24 人' },
    ],
    unitIds: ['easy', 'winters-party', 'base-of-fire'],
    baseMen: 24,
  },
  red: {
    name: '德意志國防軍',
    color: 0xd9442e,
    commanders: [
      { name: '砲兵連 連長', nameEn: 'Battery commander', role: '布雷庫爾砲兵連（姓名不詳）' },
    ],
    formations: [
      { name: '布雷庫爾砲兵連', ships: [], escort: '四門 105mm 榴彈砲、MG42、約 50 人' },
    ],
    unitIds: ['battery-crew', 'gun-1', 'gun-2', 'gun-3', 'gun-4'],
    baseMen: 50,
  },
};
