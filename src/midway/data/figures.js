// 中途島戰役 — 雙方重要人物小傳(將領、航艦艦長、王牌飛行員)
// 史料查證:Wikipedia、NHHC、Find a Grave、ww2db、Parshall & Tully《Shattered Sword》
// age = 1942 年 6 月戰役當時年齡;battle = 中途島戰果;career = 生涯/退役戰果
// 註:百斯特、小林、友永為俯衝/雷擊轟炸機飛行員,戰果以擊沉/命中軍艦計,非空戰擊墜數。
export const figures = [
  // ── 日軍 指揮官 ──
  {
    id: 'yamamoto', side: 'red', type: 'commander', name: '山本五十六', nameEn: 'Isoroku Yamamoto', avatar: '山',
    rank: '海軍大將', affil: '聯合艦隊司令長官 · 旗艦大和', born: '1884', died: '1943', age: '58',
    bio: '策劃珍珠港奇襲與中途島作戰的日本海軍靈魂人物。他想以中途島為餌逼出美軍航艦決戰，卻因密碼被破譯而中伏。當天他率主力戰艦遠在後方 300 浬，無法及時介入。',
    battle: '主導中途島作戰卻遭設伏慘敗，機動部隊 4 艘航艦全軍覆沒。',
    career: '1943 年赴前線視察途中，座機遭美軍 P-38 攔截擊落身亡。',
  },
  {
    id: 'nagumo', side: 'red', type: 'commander', name: '南雲忠一', nameEn: 'Chūichi Nagumo', avatar: '南',
    rank: '海軍中將', affil: '第一航空艦隊司令長官 · 旗艦赤城', born: '1887', died: '1944', age: '55',
    bio: '統率四艘航艦的機動部隊司令。面對偵察延誤與美機輪番來襲，他在換裝魚雷或炸彈之間反覆猶豫，錯失先機，最終三艦在五分鐘內被毀。其決策至今仍是史家爭論焦點。',
    battle: '機動部隊司令，旗下 4 艘航艦於一日內全數被毀。',
    career: '後調守中太平洋，1944 年塞班島失陷時自盡。',
  },
  {
    id: 'yamaguchi', side: 'red', type: 'commander', name: '山口多聞', nameEn: 'Tamon Yamaguchi', avatar: '山',
    rank: '海軍少將', affil: '第二航空戰隊司令官 · 旗艦飛龍', born: '1892', died: '1942', age: '49',
    bio: '日本海軍最受推崇的航空戰將之一，作風果敢。三艦中彈後，他指揮僅存的飛龍連續反擊，重創約克鎮號。飛龍被擊毀後，他選擇與愛艦共存亡，留艦沉沒。',
    battle: '指揮飛龍連續反擊，重創並協助逼沉約克鎮號。',
    career: '飛龍被擊毀後選擇與艦共沉，殉職追晉海軍中將。',
  },
  // ── 美軍 指揮官 ──
  {
    id: 'nimitz', side: 'blue', type: 'commander', name: '切斯特·尼米茲', nameEn: 'Chester W. Nimitz', avatar: '尼',
    rank: '海軍上將', affil: '太平洋艦隊總司令 · 珍珠港', born: '1885', died: '1966', age: '57',
    bio: '太平洋戰區美軍最高指揮官。他信任情報單位破譯的日軍計畫，大膽下令三艘航艦在中途島東北設伏。這個決定扭轉了整個太平洋戰局。',
    battle: '憑情報設伏，以寡擊眾贏得決定性勝利。',
    career: '1944 年晉升海軍五星上將，統籌太平洋反攻直到日本投降。',
  },
  {
    id: 'fletcher', side: 'blue', type: 'commander', name: '法蘭克·傑克·佛萊徹', nameEn: 'Frank Jack Fletcher', avatar: '佛',
    rank: '海軍少將', affil: '第 17 特遣艦隊司令 · 戰術總指揮', born: '1885', died: '1973', age: '57',
    bio: '中途島海戰的現場戰術總指揮，坐鎮約克鎮號。該艦遭飛龍攻擊重創後，他將機動指揮權交給史普魯恩斯，繼續統籌全局。',
    battle: '現場戰術總指揮，旗艦約克鎮號中彈後移交指揮權。',
    career: '後轉調北太平洋戰區，1947 年以海軍中將退役。',
  },
  {
    id: 'spruance', side: 'blue', type: 'commander', name: '雷蒙·史普魯恩斯', nameEn: 'Raymond A. Spruance', avatar: '史',
    rank: '海軍少將', affil: '第 16 特遣艦隊司令 · 旗艦企業號', born: '1886', died: '1969', age: '55',
    bio: '原為巡洋艦指揮官，臨危受命接掌航艦特遣艦隊。他採納參謀建議提早放飛攻擊隊，搶在日軍回收第一波時痛擊，以冷靜果決著稱，中途島一役奠定其名將地位。',
    battle: 'TF16 擊毀日軍多艘航艦，以冷靜果決一戰成名。',
    career: '後任第五艦隊司令，指揮馬里亞納、硫磺島、沖繩等大戰。',
  },
  // ── 王牌飛行員 ──
  {
    id: 'best', side: 'blue', type: 'ace', name: 'Dick Best 百斯特', nameEn: 'Richard H. Best', avatar: '百',
    rank: '海軍上尉', affil: 'VB-6 轟炸中隊長 · 企業號', born: '1910', died: '2001', age: '32',
    bio: '史上唯一在同一天內親手參與擊沉兩艘航艦的飛行員。上午他臨機帶隊改撲赤城投下致命一彈，下午再度出擊參與擊沉飛龍。當天因氧氣系統故障吸入腐蝕性氣體，誘發肺結核，從此告別飛行。',
    battle: '一日內參與擊沉赤城與飛龍 2 艘航艦。',
    career: '獲頒海軍十字勳章；因吸入腐蝕氣體傷肺，數月後因病提前退役，戰後享耆壽 91。',
  },
  {
    id: 'kobayashi', side: 'red', type: 'ace', name: '小林道雄', nameEn: 'Michio Kobayashi', avatar: '小',
    rank: '海軍大尉', affil: '飛龍俯衝轟炸隊長', born: '1914', died: '1942', age: '27',
    bio: '率領飛龍第一波反擊隊，循美軍歸航機隊找到約克鎮號，以重大損失命中三彈使其一度癱瘓。他在這次攻擊中被擊落殉職。',
    battle: '率 18 架俯衝轟炸機重創約克鎮號，機隊損失過半。',
    career: '攻擊約克鎮號時被擊落殉職，享年 27。',
  },
  {
    id: 'tomonaga', side: 'red', type: 'ace', name: '友永丈市', nameEn: 'Joichi Tomonaga', avatar: '友',
    rank: '海軍大尉', affil: '飛龍艦攻隊長', born: '1911', died: '1942', age: '約 31',
    bio: '上午率隊空襲中途島。下午飛龍最後一擊，他的座機左油箱在晨襲中受損無法加滿，明知無法返航仍率隊出擊，投出命中約克鎮號的魚雷後戰死。',
    battle: '上午空襲中途島，下午投下命中約克鎮號的魚雷。',
    career: '投雷瞬間座機中彈爆炸，壯烈殉職。',
  },
  // ── 日軍 航艦艦長 ──
  {
    id: 'aoki', side: 'red', type: 'captain', name: '青木泰二郎', nameEn: 'Taijiro Aoki', avatar: '青',
    rank: '海軍大佐', affil: '赤城艦長', born: '約 1890', died: '1962', age: '約 52',
    bio: '赤城中彈後大火失控，他下令棄艦並一度決意與旗艦共存亡，後被部下強行帶離。赤城於翌日由日軍以魚雷自行處分。',
    battle: '徹夜指揮損管，仍無法挽救烈火中的赤城。',
    career: '唯一生還的日本正規航艦艦長，戰後 1962 年逝世。',
  },
  {
    id: 'okada', side: 'red', type: 'captain', name: '岡田次作', nameEn: 'Jisaku Okada', avatar: '岡',
    rank: '海軍大佐', affil: '加賀艦長', born: '1897', died: '1942', age: '約 45',
    bio: '加賀連中四彈，其中一彈命中艦橋，岡田艦長與多名幹部當場陣亡。加賀於當晚沉沒。',
    battle: '加賀連中 4 彈，1 彈命中艦橋當場陣亡。',
    career: '殉職追晉海軍少將。',
  },
  {
    id: 'yanagimoto', side: 'red', type: 'captain', name: '柳本柳作', nameEn: 'Ryusaku Yanagimoto', avatar: '柳',
    rank: '海軍大佐', affil: '蒼龍艦長', born: '1894', died: '1942', age: '48',
    bio: '蒼龍中彈後迅速成為火海。部下含淚請他逃生，他卻獨自佇立艦橋，堅持與愛艦共存亡，最終隨艦沉入海中。',
    battle: '蒼龍中彈後迅速成為火海。',
    career: '拒絕離艦，與蒼龍一同沉沒，追晉海軍少將。',
  },
  {
    id: 'kaku', side: 'red', type: 'captain', name: '加来止男', nameEn: 'Tomeo Kaku', avatar: '加',
    rank: '海軍大佐', affil: '飛龍艦長', born: '1893', died: '1942', age: '48',
    bio: '飛龍被擊毀後，他與第二航空戰隊司令山口多聞並肩，婉拒部下勸離，選擇與飛龍一同沉入海中。',
    battle: '飛龍被俯衝轟炸機擊毀。',
    career: '與山口多聞並肩與飛龍共沉，追晉海軍少將。',
  },
  // ── 美軍 航艦艦長 ──
  {
    id: 'murray', side: 'blue', type: 'captain', name: '喬治·莫瑞', nameEn: 'George D. Murray', avatar: '莫',
    rank: '海軍上校', affil: '企業號艦長', born: '1889', died: '1956', age: '52',
    bio: '指揮企業號全程未中一彈。其艦載機隊在麥克拉斯基率領下擊毀加賀、赤城，並於傍晚擊沉飛龍，是美軍致勝的關鍵戰力。',
    battle: '企業號全程未中一彈，所屬機隊擊毀 3 艘航艦。',
    career: '戰後晉升海軍上將。',
  },
  {
    id: 'mitscher', side: 'blue', type: 'captain', name: '馬克·米切爾', nameEn: 'Marc A. Mitscher', avatar: '米',
    rank: '海軍上校', affil: '大黃蜂號艦長', born: '1887', died: '1947', age: '55',
    bio: '大黃蜂號的俯衝轟炸隊在中途島出擊中迷航未能命中，雷擊中隊 VT-8 則幾乎全滅。米切爾日後晉升，成為太平洋快速航艦特遣艦隊的傳奇指揮官。',
    battle: '大黃蜂號攻擊隊表現不佳：俯衝隊迷航、VT-8 全滅。',
    career: '日後成為太平洋快速航艦特遣艦隊傳奇司令，1947 年逝世。',
  },
  {
    id: 'buckmaster', side: 'blue', type: 'captain', name: '巴克馬斯特', nameEn: 'Elliott Buckmaster', avatar: '巴',
    rank: '海軍上校', affil: '約克鎮號艦長', born: '1889', died: '1976', age: '52',
    bio: '約克鎮號兩度遭重創，他指揮損管隊奮力搶修，一度讓中彈的航艦恢復航行。直到中雷嚴重左傾才下令棄艦，並組織登艦隊試圖拖救，終究不敵潛艦伏擊。',
    battle: '兩度搶救約克鎮號，終不敵潛艦伏擊。',
    career: '戰後晉升海軍少將，任海軍航空初級訓練首長。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 航艦 → 艦長 figure id(點艦艇列即可開啟)
export const captainOf = {
  akagi: 'aoki', kaga: 'okada', soryu: 'yanagimoto', hiryu: 'kaku',
  enterprise: 'murray', hornet: 'mitscher', yorktown: 'buckmaster',
};
