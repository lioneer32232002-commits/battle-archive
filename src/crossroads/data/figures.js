// 十字路口 — 參戰人物小傳（指揮、巡邏隊、火力組、突擊、通信）
// 史料查證：Dick Winters《Beyond Band of Brothers》、Stephen Ambrose《Band of Brothers》、
//          506 PIR 團史、Warfare History Network、Find a Grave／honorstates 官方陣亡記錄。各家略有出入，存疑處已註明。
// group = 面板名冊分組；kia = 當日陣亡；age = 1944 年 10 月概略年齡。
export const figures = [
  // ── 指揮官 ──
  {
    id: 'winters', side: 'blue', type: 'commander', group: '指揮官', name: '理查・溫斯特', nameEn: 'Richard D. Winters', avatar: '溫',
    rank: '上尉', affil: 'E 連連長 · 攻擊指揮', born: '1918', died: '2011', age: '26',
    bio: '十字路口這天，他仍是 E 連連長（這是他以連長身分的最後一戰，四天後的 10 月 9 日才調任第 2 營副營長；當時軍階為上尉，並非常被誤稱的「少校」）。凌晨巡邏遇襲後，他親自前出偵察、布置基底火力，一聲「預備、瞄準、放」殲滅德軍機槍組，再率不到 40 人上刺刀衝過開闊圩田，擊潰近 300 名德軍。他自評這是 E 連與他個人生涯打得最好的一仗。',
    battle: '指揮十字路口反擊，以約 35 人擊潰約兩個連德軍，獲傑出服役十字勳章。',
    career: '10 月 9 日調任第 2 營副營長（以上尉暫代少校職），後升少校帶隊至戰爭結束；2011 年逝世。',
  },
  {
    id: 'welsh', side: 'blue', type: 'officer', group: '指揮官', name: '哈利・威爾許', nameEn: 'Harry Welsh', avatar: '威',
    rank: '中尉', affil: 'E 連 第 1 排排長', born: '1918', died: '1995', age: '26',
    bio: '第 1 排排長，當天在連 CP，奉溫斯特無線電令把第 1 排其餘兵力與一個輕機槍班壓上增援。性情爽朗、作戰可靠，是溫斯特倚重的軍官，兩人情誼深厚。',
    battle: '依令派遣並協調第 1 排投入衝鋒。',
    career: '打完歐洲全程，戰後返賓州任教，1995 年逝世。',
  },
  {
    id: 'nixon', side: 'blue', type: 'officer', group: '指揮官', name: '路易斯・尼克森', nameEn: 'Lewis Nixon', avatar: '尼',
    rank: '上尉', affil: '第 2 營 情報官', born: '1918', died: '1995', age: '26',
    bio: '第 2 營情報官、溫斯特最親近的摯友，耶魯出身。戰鬥後與溫斯特一同清點戰場，估出德軍損失（約 50 死、約 100 傷、11 被俘，皆美方估計）。聰明而豪飲，是 E 連故事裡的另一個主角。',
    battle: '戰後勘查戰場、統計德軍損失。',
    career: '隨第 2 營轉戰至戰爭結束；戰後人生起伏，1995 年逝世。',
  },

  // ── 巡邏隊（凌晨前哨巡邏，遭伏負傷） ──
  {
    id: 'youman', side: 'blue', type: 'nco', group: '巡邏隊', name: '亞瑟・尤曼', nameEn: 'Arthur Youman', avatar: '尤',
    rank: '中士', affil: 'E 連 · 前哨巡邏隊長', born: '', died: '', age: '',
    bio: '凌晨率五人前哨巡邏前出，約 0400 摸上河堤時迎面撞進德軍火網，五人中四人負傷。撤回後回報堤上有大批德軍，揭開了整場戰鬥的序幕。（生平資料有限）',
    battle: '率初始前哨巡邏遇襲、回報敵情。',
    career: '資料有限，生平不詳。',
  },
  {
    id: 'alley', side: 'blue', type: 'soldier', group: '巡邏隊', name: '詹姆斯・艾利', nameEn: 'James Alley', avatar: '艾',
    rank: '士官', affil: 'E 連 · 巡邏隊', born: '1922', died: '2008', age: '22',
    bio: '巡邏遇襲時，一枚德軍手榴彈在近處炸開，他身中約 32 處破片仍生還，是當天傷得最重者之一，傷癒後歸隊。',
    battle: '巡邏遇襲，身中約 32 處破片負傷。',
    career: '傷癒後續打到戰爭結束，2008 年逝世。',
  },
  {
    id: 'liebgott', side: 'blue', type: 'soldier', group: '巡邏隊', name: '喬・利布戈特', nameEn: 'Joe Liebgott', avatar: '布',
    rank: '技五級', affil: 'E 連 · 巡邏／押俘', born: '1915', died: '1992', age: '29',
    bio: '密西根出身、奧地利移民之子，戰前在加州當理髮師，個性火爆、會德語。十字路口戰鬥後奉命押送 11 名德軍戰俘（這群人被韋伯斯特喝令投降時，曾一度假冒波蘭人）。',
    battle: '參與巡邏；戰後押送 11 名德軍戰俘。',
    career: '戰後返加州，1992 年因癌症過世。',
  },

  // ── 火力組（基底火力與兩翼） ──
  {
    id: 'cobb', side: 'blue', type: 'soldier', group: '火力組', name: '羅伊・柯布', nameEn: 'Roy W. Cobb', avatar: '柯',
    rank: '一等兵', affil: 'E 連 · 機槍手', born: '', died: '', age: '',
    bio: '正規軍出身、個性強硬的機槍手。十字路口由他架設 .30 機槍，與敵正面垂直構成基底火力，封鎖堤線、掩護衝鋒。（生平資料有限）',
    battle: '架設 .30 機槍提供基底火力，沿堤縱射壓制。',
    career: '資料有限，生平不詳。',
  },
  {
    id: 'talbert', side: 'blue', type: 'nco', group: '火力組', name: '佛洛德・塔伯特', nameEn: 'Floyd Talbert', avatar: '塔',
    rank: '士官', affil: 'E 連 · 右翼班', born: '1923', died: '1982', age: '21',
    bio: 'E 連悍將之一，作戰勇猛、深得弟兄信賴。衝鋒時率右翼，於德軍潰退時架起機槍向逃兵追擊。',
    battle: '率右翼衝鋒，架機槍追擊潰退德軍。',
    career: '打完歐洲全程；戰後深居簡出，1982 年逝世。',
  },
  {
    id: 'peacock', side: 'blue', type: 'officer', group: '火力組', name: '湯瑪斯・皮考克', nameEn: 'Thomas Peacock', avatar: '皮',
    rank: '中尉', affil: 'E 連 · 第 1 排', born: '', died: '', age: '',
    bio: '第 1 排軍官，衝鋒時率左翼，途中被一道低矮的鐵絲網阻住。堤防開闊地裡藏著看不見的障礙，是這種地形的另一個陷阱。（生平資料有限）',
    battle: '率左翼衝鋒，受堤前鐵絲網阻滯。',
    career: '資料有限，生平不詳。',
  },

  // ── 突擊（含當日唯一陣亡者） ──
  {
    id: 'dukeman', side: 'blue', type: 'soldier', group: '突擊隊', kia: true, name: '威廉・杜克曼', nameEn: 'William H. Dukeman Jr.', avatar: '杜',
    rank: '下士', affil: 'E 連 · 托科亞老兵', born: '1921', died: '1944', age: '23',
    bio: '科羅拉多人、托科亞老兵，弟兄敬重。撤回溝渠時，堤路下的涵洞射出一枚德製槍榴彈，破片自肩胛骨穿入、貫穿心臟，當場陣亡。他是十字路口這一整場戰鬥裡，E 連唯一的陣亡者。（官方記錄為下士，部分書籍誤作中士。）',
    battle: '十字路口唯一陣亡者，被涵洞射出的槍榴彈擊中。',
    career: '1944 年 10 月 5 日陣亡，葬於荷蘭馬格拉滕美軍公墓（G 區 2 排 11 號）。',
  },
  {
    id: 'webster', side: 'blue', type: 'soldier', group: '突擊隊', name: '大衛・韋伯斯特', nameEn: 'David Kenyon Webster', avatar: '韋',
    rank: '二等兵', affil: 'E 連 · 突擊', born: '1922', died: '1961', age: '22',
    bio: '哈佛英文系出身，後來寫下著名的傘兵回憶錄《Parachute Infantry》。衝鋒中腿部中彈負傷；他曾以德語向堤後德軍喊話招降（對方一度假冒波蘭人）。',
    battle: '參與衝鋒，腿部中彈；喊話招降德軍。',
    career: '戰後當作家與記者，1961 年出海捕鯊失蹤、推定身亡。',
  },

  // ── 通信 ──
  {
    id: 'boyle', side: 'blue', type: 'nco', group: '通信', name: '里歐・博伊爾', nameEn: 'Leo Boyle', avatar: '博',
    rank: '中士', affil: 'E 連 連部 · 無線電', born: '', died: '', age: '',
    bio: '連部士官，背 SCR-300 無線電緊跟在溫斯特身邊，是呼叫增援與砲火支援的關鍵一環。本役致勝的英聯邦砲火，正是透過這條無線電引來。撤退遭德軍反砲擊時負傷。（生平資料有限）',
    battle: '操作 SCR-300 無線電、傳遞火力與增援呼叫，撤退中負傷。',
    career: '資料有限，生平不詳。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 單位 → 領導人物 figure id（點單位列開啟人物小卡）。
// 突擊隊主體連到溫斯特本人由面板「人物名冊」呈現；單位列指向各自代表人物。
export const leaderOf = {
  'winters-assault': 'winters',
  'base-of-fire': 'cobb',
  'fox-platoon': 'webster',
};
