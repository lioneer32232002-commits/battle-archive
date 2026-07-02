// 巴斯通 — 參戰人物小傳(指揮、守線、醫護、解圍、德軍)
// 史料查證:U.S. Army CMH、army.mil、National WWII Museum、CSI 巴斯通參謀研究、
//   Ambrose《Band of Brothers》、Winters《Beyond Band of Brothers》、各人物條目與 Find a Grave。
//   經多源＋對抗式查核;影集失真與 1 月事件已明確標注,避免把佛伊之役(1945/1)誤植進 12 月圍城。
// group = 面板名冊分組;age = 1944 年 12 月概略年齡。
export const figures = [
  // ── 指揮官 ──
  {
    id: 'mcauliffe', side: 'blue', type: 'commander', group: '指揮官', name: '安東尼・麥考利夫', nameEn: 'Anthony McAuliffe', avatar: '麥',
    rank: '准將', affil: '101 空降師 代理師長', born: '1898', died: '1975', age: '46',
    bio: '師長泰勒人在美國，由砲兵指揮官麥考利夫代理指揮整場圍城。12 月 22 日德軍送來勸降書，他只嘟囔一句「Aw, nuts!」，參謀建議就用這句回覆。他把被包圍看成優勢：環形防線讓砲兵能對任何方向集火。他始終否認 101 師是被「解救」的：「我們從沒要求救援，我們需要的是外科醫生。」',
    battle: '代理師長，坐鎮圍城全程；以一字「呸！」拒絕德軍勸降。',
    career: '戰後續役至上將、任美國陸軍歐洲司令，1975 年逝世。',
  },
  {
    id: 'winters', side: 'blue', type: 'officer', group: '指揮官', name: '理查・溫特斯', nameEn: 'Richard D. Winters', avatar: '溫',
    rank: '上尉', affil: '506 團 第 2 營 副營長', born: '1918', died: '2011', age: '26',
    bio: '到了巴斯通，溫特斯已不是 E 連連長，而是第 2 營副營長（10 月起），在營級照看包含 E 連在內的全營防線。E 連當面的連長是戴克。三部曲（布雷庫爾、卡倫坦、十字路口）是他以連長身分的前線故事；巴斯通，他已在更高一層。',
    battle: '以第 2 營副營長身分，統籌含 E 連的營防線。',
    career: '後升少校帶隊至戰爭結束；溫特斯前線三部曲的主角，2011 年逝世。',
  },
  {
    id: 'dike', side: 'blue', type: 'officer', group: '指揮官', name: '諾曼・戴克', nameEn: 'Norman Dike', avatar: '戴',
    rank: '中尉', affil: 'E 連連長（圍城期間）', born: '1918', died: '1989', age: '26',
    bio: '11 月初接掌 E 連，整個 12 月圍城都是他當連長。★影集把他塑造成臨陣退縮的膽小鬼，並不公平：他在圍城期間表現稱職、獲頒兩枚銅星勳章（含 1945/1/3 在巴斯通）；他最為人詬病的「僵住」發生在 1945 年 1 月 13 日攻打佛伊時，且可能是負傷所致，那是圍城解除後的另一場仗。',
    battle: '圍城期間的 E 連連長，守傑克森林樹線；獲兩枚銅星。',
    career: '★佛伊僵住是 1945/1 的事、非本役；戰後從商，1989 年逝世。',
  },
  {
    id: 'harper', side: 'blue', type: 'officer', group: '指揮官', name: '約瑟夫・哈潑', nameEn: 'Joseph "Bud" Harper', avatar: '哈',
    rank: '上校', affil: '327 滑翔機步兵團 團長', born: '1901', died: '2009', age: '43',
    bio: '麥考利夫「呸！」的回條，是他親手送到德軍使者手裡的。德軍翻譯聽不懂這句俚語，是哈潑當面補了一句解釋：「用白話說，就是叫你們滾蛋（go to hell）。」勸降使者則是德方的華格納少校與亨克中尉。',
    battle: '親自把「呸！」回條交還德軍，並附上「滾蛋」的白話註解。',
    career: '長壽的老兵，2009 年以 108 歲高齡逝世。',
  },

  // ── 守線(傑克森林) ──
  {
    id: 'lipton', side: 'blue', type: 'nco', group: '守線', name: '卡伍德・利普頓', nameEn: 'Carwood Lipton', avatar: '普',
    rank: '連士官', affil: 'E 連 · 實質撐起全連', born: '1920', died: '2001', age: '24',
    bio: '沉穩可靠、深得弟兄與長官信任。圍城期間，他實質上把整個 E 連撐了起來：巡走每個散兵坑、穩定軍心、串起各排。他的正式軍官任命，是在佛伊之後（1945 年 2 月於阿格諾）才下來的。',
    battle: '圍城期間走遍散兵坑、穩住全連，是連隊的定海神針。',
    career: '巴斯通後獲軍官任命、升連士官長；戰後從商，2001 年逝世。',
  },
  {
    id: 'malarkey', side: 'blue', type: 'soldier', group: '守線', name: '唐・馬拉其', nameEn: 'Don Malarkey', avatar: '馬',
    rank: '技四級', affil: 'E 連 · 迫擊砲', born: '1921', died: '2017', age: '23',
    bio: '奧勒岡人，服役最久的 E 連原始成員之一。在傑克森林的散兵坑裡熬過樹爆與嚴寒。他最沉重的日子其實在一月：好友馬克與潘卡拉的散兵坑被直接命中（1945/1/9–10），對他打擊極大，那已是圍城之後的事。',
    battle: '傑克森林守線，承受樹頂空爆與冰雪。',
    career: '打完諾曼第、荷蘭、巴斯通全程，2017 年逝世。',
  },

  // ── 醫護 ──
  {
    id: 'roe', side: 'blue', type: 'medic', group: '醫護', name: '尤金・羅', nameEn: 'Eugene "Doc" Roe', avatar: '羅',
    rank: '技四級', affil: 'E 連 醫護兵', born: '1922', died: '1998', age: '22',
    bio: '路易斯安那人，E 連的醫護兵。師醫院被端掉後，圍城圈裡幾乎沒有醫藥，他四處張羅嗎啡、繃帶、紗布，在零度以下替傷患止血保命。★影集裡他與比利時護士「蕾妮」的情誼是戲劇加工：蕾妮・勒梅爾實有其人、死於 12/24 救護站遭炸，但沒有證據顯示羅與她相識。',
    battle: '在缺醫少藥的圍城裡，靠張羅來的補給替傷患保命。',
    career: '★與護士的情誼為影集虛構；戰後返路易斯安那，1998 年逝世。',
  },

  // ── 解圍 ──
  {
    id: 'abrams', side: 'blue', type: 'officer', group: '解圍', name: '克瑞頓・阿布蘭', nameEn: 'Creighton Abrams', avatar: '布',
    rank: '中校', affil: '第 4 裝甲師 第 37 戰車營', born: '1914', died: '1974', age: '30',
    bio: '巴頓麾下的猛將，第 4 裝甲師解圍先鋒。12 月 26 日，他的第 37 戰車營在阿瑟努瓦強行突破，打通通往巴斯通的走廊。巴頓曾說他是全軍最好的戰車指揮官。',
    battle: '率第 37 戰車營在阿瑟努瓦突破，打通巴斯通走廊（12/26）。',
    career: '後任越戰美軍司令、陸軍參謀長；M1「艾布蘭」主力戰車即以其命名，1974 年於任內逝世。',
  },

  // ── 德軍 ──
  {
    id: 'luttwitz', side: 'red', type: 'commander', group: '德軍', name: '馮・呂特維茨', nameEn: 'Heinrich von Lüttwitz', avatar: '呂',
    rank: '裝甲兵上將', affil: '第 47 裝甲軍 軍長', born: '1896', died: '1969', age: '48',
    bio: '負責攻取巴斯通的德軍軍長，勸降書即由他署名發出。他的裝甲主力（第 2 裝甲師、裝甲教導師）其實奉命繞過巴斯通、直撲繆斯河，留下步兵去啃這座小鎮。',
    battle: '下達勸降最後通牒，得到的回覆是一字「呸！」。',
    career: '戰後獲釋，1969 年逝世。',
  },
  {
    id: 'kokott', side: 'red', type: 'commander', group: '德軍', name: '海因茨・科科特', nameEn: 'Heinz Kokott', avatar: '科',
    rank: '少將', affil: '第 26 國民擲彈兵師 師長', born: '1900', died: '1976', age: '44',
    bio: '第 26 國民擲彈兵師師長，圍城的實際主力。裝甲繞過後，把巴斯通「拔釘子」的差事落到他這支缺乏戰車的步兵師身上；耶誕強襲是他傾力的一擊，卻在 705 戰車殲擊營面前折損殆盡。',
    battle: '以缺戰車的國民擲彈兵師主導圍城，耶誕強襲功敗垂成。',
    career: '戰後撰寫巴斯通作戰研究，成為重要史料，1976 年逝世。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 單位 → 領導人物 figure id(點單位列開啟人物小卡)。
export const leaderOf = {
  'easy-line': 'dike',
  'relief-4ad': 'abrams',
  'vg-line': 'kokott',
};
