// 十字路口 — 島區堤防之役（E 連，101 空降師 506 傘兵團 第 2 營）
// 1944 年 10 月 5 日拂曉，荷蘭「島區」（de Betuwe）。溫特斯上尉以約 35 人反擊
// 夜渡萊茵河的德軍約兩個連（約 300 人），以基底火力＋刺刀衝鋒＋砲兵協同擊潰之。
// 史料依據：Dick Winters《Beyond Band of Brothers》回憶錄、Stephen Ambrose《Band of Brothers》、
//          506 PIR 團史（airborne506.org）、army.mil、荷蘭在地戰場研究（strijdbewijs.nl、theisland44-45.nl）。
//          經多源＋對抗式查核（見 crossroads-facts）。
// 時間軸：t = 自 10/5 00:00 起算的分鐘數（拂曉前 → 日出）。
// 座標：1 單位 = 10 公尺；原點 = 河堤十字路口；北 = -z（下萊茵河在北）、東 = +x（德軍向東潰退、渡口側）。
// 註：德軍長期被誤稱「SS」，最站得住腳的考證為國防軍國民擲彈兵；德軍傷亡為美方估計，數字各家略有出入。

import { interpolateTrack } from '../engine/timeline.js';

export const TIME_START = 205;  // 10/5 03:25（巡邏前出前）
export const TIME_END = 405;    // 10/5 06:45（撤退、鞏固）
export const EPILOGUE_T = 405;

export function formatClock(t) {
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `10/5 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── 主軸：溫特斯突擊隊（自連 CP 出發線 → 越堤 → 沿堤東掃） ──────
const wintersTrack = [
  { t: 240, x: -60, z: 16 },   // 巡邏遇襲後，自連 CP 一帶前出
  { t: 285, x: -20, z: 8 },    // 沿堤南側溝渠隱蔽接近
  { t: 300, x: -6, z: -6 },    // 基底火力齊射位置（堤肩）
  { t: 320, x: 4, z: -13 },    // 上刺刀，衝過開闊地登堤頂
  { t: 335, x: 18, z: -15 },   // 沿堤頂向東席捲潰敵
  { t: 360, x: 30, z: -16 },   // 向渡口方向躍進
  { t: 375, x: 6, z: 6 },      // 撤回堤南
  { t: 405, x: -10, z: 14 },   // 鞏固
];

// ── 單位 ──────────────────────────────────────────────
// kind: infantry 步兵 / assault 突擊隊 / support 火力組 / mg 機槍巢 / garrison 守軍
export const units = [
  // 藍方 — 美軍 E 連
  {
    id: 'winters-assault', side: 'blue', kind: 'assault', name: '溫特斯突擊隊', nameEn: "Winters' assault",
    role: 'E 連 · 約 35 人', length: 18,
    strength: { men: 35 },
    track: wintersTrack,
    statusChanges: [
      { t: 308, strengthDelta: { men: -1 } },   // 杜克曼陣亡
      { t: 375, strengthDelta: { men: -3 } },    // 撤退反砲擊負傷
    ],
  },
  {
    id: 'base-of-fire', side: 'blue', kind: 'support', name: '基底火力組', nameEn: 'Base of fire',
    role: '.30 機槍 · 60 迫砲', length: 10,
    strength: {},
    track: [{ t: 0, x: -24, z: -8 }],   // 堤肩定點，沿堤縱射（enfilade）
    statusChanges: [],
  },
  {
    id: 'fox-platoon', side: 'blue', kind: 'infantry', name: 'F 連增援排', nameEn: 'Fox Co. platoon',
    role: '後續增援 約 12 人', length: 14,
    strength: { men: 12 },
    track: [
      { t: 0, x: -70, z: 40 },
      { t: 350, x: -16, z: 10 },
      { t: 375, x: 0, z: 4 },
    ],
    statusChanges: [],
  },

  // 紅方 — 德軍（國防軍，長期被誤稱「SS」）。夜渡萊茵河、據堤反撲。
  {
    id: 'gren-1', side: 'red', kind: 'garrison', name: '德軍首波連', nameEn: 'German 1st company',
    role: '據十字路口 約 150 人', length: 18, facing: 0,  // 面南（+z）迎擊堤南上來的攻勢
    strength: { men: 150 },
    track: [{ t: 0, x: 8, z: -12 }],
    statusChanges: [
      { t: 320, strengthDelta: { men: -45 } },   // 衝鋒
      { t: 335, strengthDelta: { men: -55 } },    // 開闊地潰敗
    ],
  },
  {
    id: 'gren-2', side: 'red', kind: 'garrison', name: '德軍次波連', nameEn: 'German 2nd company',
    role: '近風車增援 約 140 人', length: 18, facing: 0,
    strength: { men: 140 },
    track: [{ t: 0, x: 42, z: -15 }],
    statusChanges: [
      { t: 335, strengthDelta: { men: -30 } },
      { t: 348, strengthDelta: { men: -55 } },    // 英聯邦砲兵的致命一擊
    ],
  },
  {
    id: 'mg-crew', side: 'red', kind: 'mg', name: 'MG42 機槍組', nameEn: 'MG42 crew', length: 6,
    strength: {}, track: [{ t: 0, x: -2, z: -15 }],
    statusChanges: [{ t: 300, status: 'destroyed' }],   // 齊射殲滅
  },
  {
    id: 'culvert-mg', side: 'red', kind: 'mg', name: '涵洞火力點', nameEn: 'Culvert position', length: 5,
    strength: {}, track: [{ t: 0, x: 13, z: -12.5 }],
    statusChanges: [{ t: 322, status: 'destroyed' }],   // 衝鋒肅清（杜克曼即陣亡於此火力）
  },
];

// 本役無空中單位（地面步兵戰）
export const airGroups = [];

// ── 戰術幾何（供「戰術幾何」疊圖使用） ─────────────────────
export const tactics = {
  baseOfFire: [{ x: -24, z: -8 }, { x: -16, z: -6 }], // 基底火力（堤肩，沿堤縱射）
  flankPath: [
    { x: -60, z: 16 }, { x: -20, z: 8 }, { x: -6, z: -6 },
    { x: 4, z: -13 }, { x: 18, z: -15 }, { x: 30, z: -16 },
  ],
  gunOrder: ['mg-crew', 'culvert-mg', 'gren-1', 'gren-2'], // 縱射目標序（基底火力指向）
  beachDir: { x: 1, z: -0.2 }, // 德軍潰退方向（沿堤向東、渡口側）
};

// ── 重大事件 ──────────────────────────────────────────
// camera:運鏡;fx:特效;device:招牌手法旗標(geometry/intel/terrain/sync);intel:情報落差
export const events = [
  {
    t: 210, title: '島區・拂曉前', cinematic: true,
    desc: '市場花園作戰未能拿下阿納姆大橋，盟軍攻勢停在下萊茵河南岸。夾在萊茵河與瓦爾河之間的低地圩田「島區」成了前線；101 空降師被留下當步兵守堤，過著一次大戰式的塹壕生活。10 月 5 日拂曉前，E 連在蘭德韋克一帶守著約一點五哩寬的稀疏前哨線。',
    camera: { pos: { x: 0, z: -6 }, dist: 520 },
  },
  {
    t: 225, title: '德軍夜渡萊茵河', short: '德軍夜渡', cinematic: true,
    device: 'sync',
    desc: '這一仗其實是德軍先動手：4 至 5 日夜裡，約兩個連的德軍搭渡船偷渡下萊茵河，潛伏到堤防南側，意在配合天亮後對歐普赫斯登方向的主攻，從側翼威脅營部與團部。E 連並非主動出擊，而是撞上了這股摸過河的敵人。',
    camera: { pos: { x: 10, z: -34 }, dist: 300 },
    fx: [{ kind: 'gunfire', pos: { x: 14, z: -28 }, until: 245 }],
  },
  {
    t: 240, title: '堤頂巡邏遇襲', short: '巡邏遇襲', cinematic: true,
    device: 'intel',
    intel: { believed: '前哨回報：堤上「有些德軍」', actual: '' },
    desc: '凌晨約 0400，尤曼中士率五人前哨巡邏摸上堤頂，迎面撞進德軍火網。一枚「馬鈴薯搗碎器」手榴彈炸傷四人（艾利身中約 32 處破片仍生還）。巡邏隊撤回，只報得出一句模糊的話：堤上有德軍。',
    camera: { pos: { x: -6, z: -14 }, dist: 200 },
    fx: [{ kind: 'assault', pos: { x: -4, z: -15 }, until: 256 }],
  },
  {
    t: 262, title: '真相：寡不敵眾', short: '情報落差', cinematic: true,
    device: 'intel',
    intel: {
      believed: '以為：堤上少數德軍前哨',
      actual: '實際：約兩個連、近 300 人渡河據堤（長期被誤稱「SS」，考證實為國防軍國民擲彈兵）',
    },
    desc: '溫特斯上尉爬近觀察，真相浮現：不是少數前哨，而是夜渡過河、近 300 人的兩個德軍連，火力點完整。寡不敵眾，他沒有退；和布雷庫爾一樣，他把劣勢拆成一道可解的題目。（附帶一個常被誤傳的真相：影集與書裡稱他們是「SS」，但當時島區一帶對美軍 101 師的並非武裝黨衛軍，最站得住腳的是國防軍國民擲彈兵。溫特斯看到的是長大衣與晚期裝具，誤判成精銳。）',
    camera: { pos: { x: 8, z: -16 }, dist: 240 },
    fx: [{ kind: 'reveal', pos: { x: 8, z: -16 } }],
  },
  {
    t: 285, title: '無聲接敵', short: '接敵', cinematic: true,
    device: 'geometry',
    desc: '溫特斯只帶一個班與背 SCR-300 無線電的博伊爾中士前出，沿堤防北側、與堤路平行的排水溝隱蔽接近（堤防成了天然掩體）。他摸到約二十五碼處，看清堤上一個七人德軍機槍組的剪影。',
    camera: { unit: 'winters-assault', dist: 220, elev: 0.5 },
  },
  {
    t: 300, title: '「預備、瞄準、放」', short: '齊射殲滅', cinematic: true,
    device: 'geometry',
    desc: '他把基底火力布置在與敵正面垂直的側方，給每個人指定一個目標，一聲「預備、瞄準、放」，七名德軍應聲全數倒下。教科書級的開場：先用紀律與火力分配，無聲無息地拔掉敵人的眼睛與牙齒。',
    camera: { unit: 'mg-crew', dist: 130 },
    fx: [{ kind: 'destroy', unit: 'mg-crew' }, { kind: 'gunfire', pos: { x: -10, z: -8 }, until: 318 }],
  },
  {
    t: 308, title: '杜克曼陣亡', short: '杜克曼陣亡', cinematic: true,
    device: 'terrain',
    desc: '撤回溝渠時，堤路下的涵洞射出一枚德製槍榴彈。下士威廉・杜克曼被破片擊中，自肩胛骨穿入、貫穿心臟，當場陣亡。他是這一整場戰鬥裡，E 連唯一的陣亡者。',
    camera: { unit: 'culvert-mg', dist: 120 },
    fx: [{ kind: 'gunfire', pos: { x: 8, z: -12 }, until: 320 }],
  },
  {
    t: 320, title: '上刺刀・衝鋒', short: '上刺刀', cinematic: true,
    device: 'geometry',
    desc: '天色漸亮。溫特斯要威爾許中尉把第 1 排其餘弟兄與一個輕機槍班全壓上，丟出煙幕，下令上刺刀。三路縱隊衝過約一百七十五到兩百碼的開闊圩田。他率先衝上堤路，迎面一個對著他微笑的德軍哨兵。他開了槍。',
    camera: { pos: { x: 0, z: -8 }, dist: 175 },
    fx: [{ kind: 'smoke', pos: { x: 2, z: -6 } }, { kind: 'assault', pos: { x: 6, z: -13 }, until: 336 }],
  },
  {
    t: 335, title: '開闊地的潰敗', short: '潰敗', cinematic: true,
    device: 'terrain',
    desc: '堤防的致命幾何在此翻轉：渡河而來的德軍背靠萊茵河、擠在堤下開闊地，被居高的側射火力逮個正著。近百碼外的次波連同樣陷入交叉火網。德軍崩潰，沿堤腳向東奪路而逃。',
    camera: { unit: 'winters-assault', dist: 230, elev: 0.55 },
    fx: [{ kind: 'gunfire', pos: { x: 18, z: -16 }, until: 350 }, { kind: 'assault', pos: { x: 28, z: -18 }, until: 348 }],
  },
  {
    t: 348, title: '英聯邦砲兵的致命一擊', short: '砲兵收尾', cinematic: true,
    device: 'sync',
    desc: '真正的致命一擊不是刺刀，而是火砲。101 師沒有重砲，島區上卻有成團的英聯邦砲兵；溫特斯透過一名加拿大前進觀測官（一度呼叫不到，他索性自己抓起無線電爬上堤頂）把砲火引到開闊地上的潰兵頭上。德軍約五十人陣亡，多數正是死於這頓砲擊。這是一場步砲協同的屠戮。',
    camera: { pos: { x: 42, z: -20 }, dist: 320 },
    fx: [{ kind: 'barrage', pos: { x: 44, z: -19 }, until: 366 }],
  },
  {
    t: 375, title: '撤退・反砲擊', short: '撤退反砲', cinematic: true,
    device: 'terrain',
    desc: '肅清後 E 連撤回堤南。德軍早把這個十字路口的座標算得死死的，反砲擊隨即落下。當天 22 名負傷者裡，約 18 人是在這場撤退砲擊中受傷，而非衝鋒。傷亡的真相，與一般想像相反：衝鋒幾乎沒流血，撤退才是付代價的時候。',
    camera: { pos: { x: 2, z: -10 }, dist: 240 },
    fx: [{ kind: 'barrage', pos: { x: 2, z: -12 }, until: 392 }],
  },
  {
    t: 395, title: '溫特斯的最佳一役', short: '最佳一役', cinematic: true,
    desc: '以約 35 人擊潰近 300 人：德軍約 50 死、約 100 傷、11 人被俘（利布戈特押送的這 11 人曾假冒波蘭人求降），E 連僅 1 人陣亡。溫特斯一生自評，這場仗打得比 D 日、比布雷庫爾都好。步兵戰術每一個環節都做到了位。這也是他以 E 連連長身分的最後一戰。',
    camera: { pos: { x: 6, z: -14 }, dist: 760 },
  },
];

// ── 戰役結算（播放結束戰績卡） ───────────────────────────
export const outcome = {
  headline: '溫特斯的最佳一役',
  sub: '1944/10/5 · 島區堤防（蘭德韋克–赫特倫）',
  achievement:
    '以約 35 人擊潰夜渡萊茵河、近 300 人的兩個德軍連，化解對營部與團部的側翼威脅。' +
    '致命一擊來自英聯邦砲兵（經加拿大前進觀測官管制、溫特斯親自呼叫），而非刺刀。' +
    '溫特斯自評為其生涯與 E 連打得最好的一仗，也是他以連長身分的最後一戰。',
  rows: [
    { key: 'men', label: '投入兵力' },
    { key: 'killed', label: '陣亡' },
    { key: 'captured', label: '被俘' },
  ],
  blue: {
    name: 'E 連（101 空降師）',
    detail: '溫特斯先鋒 · 含 F 連一排增援',
    values: { men: 35, killed: 1, captured: 0 },
  },
  red: {
    name: '德軍（國防軍・國民擲彈兵）',
    detail: '夜渡萊茵河的兩個德軍連 · 傷亡為美方估計',
    values: { men: 300, killed: 50, captured: 11 },
  },
};

// ── 關鍵人物（可點選的個人標記） ─────────────────────────
export const aces = [
  { id: 'winters', side: 'blue', name: 'Dick Winters 溫特斯', pos: { x: 2, z: -10 }, activeFrom: 285, activeTo: 375 },
  { id: 'dukeman', side: 'blue', name: 'William Dukeman 杜克曼', pos: { x: 8, z: -11 }, activeFrom: 300, activeTo: 335 },
  { id: 'cobb', side: 'blue', name: 'Roy Cobb 柯布', pos: { x: -24, z: -8 }, activeFrom: 296, activeTo: 360 },
  { id: 'talbert', side: 'blue', name: 'Floyd Talbert 塔伯特', pos: { x: 22, z: -15 }, activeFrom: 320, activeTo: 366 },
];

// ── 陣營與指揮官（面板資料） ────────────────────────────
export const sides = {
  blue: {
    name: '美軍 101 空降師',
    color: 0x2e7bd9,
    commanders: [
      { id: 'winters', name: '理查・溫特斯', nameEn: 'Richard D. Winters', role: 'E 連連長（攻擊指揮，當天上尉）' },
      { id: 'welsh', name: '哈利・威爾許', nameEn: 'Harry Welsh', role: 'E 連 第 1 排排長' },
      { id: 'nixon', name: '路易斯・尼克森', nameEn: 'Lewis Nixon', role: '第 2 營 情報官' },
    ],
    formations: [
      { name: '506 傘兵團 第 2 營 E 連', ships: ['溫特斯突擊隊', '基底火力組'], escort: '空降步兵 約 35 人（含 F 連一排）' },
    ],
    unitIds: ['winters-assault', 'base-of-fire', 'fox-platoon'],
    baseMen: 47,
  },
  red: {
    name: '德意志國防軍',
    color: 0xd9442e,
    commanders: [
      { name: '渡河支隊 指揮官', nameEn: 'Crossing detachment CO', role: '國民擲彈兵（姓名不詳）' },
    ],
    formations: [
      { name: '夜渡萊茵河的兩個連', ships: [], escort: '國民擲彈兵 約 300 人、MG42、槍榴彈' },
    ],
    unitIds: ['gren-1', 'gren-2', 'mg-crew', 'culvert-mg'],
    baseMen: 290,
  },
};
