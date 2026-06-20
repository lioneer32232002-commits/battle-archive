// 卡倫坦 — 參戰人物小傳（指揮、突擊、逐屋肅清、考據還原）
// 史料查證：Stephen Ambrose《Band of Brothers》、Dick Winters《Beyond Band of Brothers》、
//          506 PIR 團史、Warfare History Network、Wikipedia（各人物條目）、Find a Grave。
//          經多源＋對抗式查核（見 carentan-facts）；各家略有出入，存疑處已註明。
// group = 面板名冊分組；age = 1944 年 6 月概略年齡。
export const figures = [
  // ── 指揮官 ──
  {
    id: 'winters', side: 'blue', type: 'commander', group: '指揮官', name: '理查・溫特斯', nameEn: 'Richard D. Winters', avatar: '溫',
    rank: '中尉', affil: 'E 連連長 · 攻擊指揮', born: '1918', died: '2011', age: '26',
    bio: '卡倫坦這天他是 E 連連長、軍階中尉。E 連打 506 團第 2 營先鋒，自西南突入市鎮；在 MG42 封街的 Y 形路口，一向溫和的他反覆衝進彈雨、邊罵邊把弟兄趕出溝渠向前。市鎮肅清時，他在街上多暴露了一會，被跳彈擦傷小腿脛骨（這是他整場大戰唯一的負傷）。他後來形容卡倫坦一帶的反撲是「整場戰爭最艱苦的一仗」。',
    battle: '指揮 E 連突入卡倫坦、街口督陣，受其整場大戰唯一的傷（小腿跳彈）。',
    career: '兩天後（布雷庫爾在前、十字路口在後）續寫三部曲；10 月升第 2 營副營長，後升少校帶隊至戰爭結束，2011 年逝世。',
  },
  {
    id: 'welsh', side: 'blue', type: 'officer', group: '指揮官', name: '哈利・威爾許', nameEn: 'Harry Welsh', avatar: '威',
    rank: '中尉', affil: 'E 連 第 1 排排長', born: '1918', died: '1995', age: '26',
    bio: '率第 1 排越過土坡、衝下約一百碼長的斜街突入市鎮，正撞上 MG42 封街。是他帶著約六個人趁隙越街、把手榴彈丟進那挺機槍的位置，解決掉機槍組、解開了全連的僵局。性情爽朗、作戰可靠，是溫特斯倚重的軍官。',
    battle: '率第 1 排突入、越街投彈炸掉封街的 MG42。',
    career: '打完歐洲全程，戰後返賓州任教，1995 年逝世。',
  },
  {
    id: 'compton', side: 'blue', type: 'officer', group: '指揮官', name: '林恩・康普頓', nameEn: 'Lynn "Buck" Compton', avatar: '康',
    rank: '中尉', affil: 'E 連 第 2 排排長', born: '1921', died: '1990', age: '22',
    bio: 'UCLA 運動健將出身（曾打進玫瑰盃、與傑基・羅賓森同隊），個性直爽、與弟兄打成一片。卡倫坦街戰中協助把被壓制的弟兄從溝渠裡帶起、推動攻勢。',
    battle: '第 2 排排長，協助鼓動、帶動受壓制的弟兄前進。',
    career: '戰後當上洛杉磯檢察官，起訴刺殺羅伯・甘迺迪的兇手，後任加州上訴法院法官，1990 年逝世。',
  },

  // ── 突擊（街口衝鋒） ──
  {
    id: 'guarnere', side: 'blue', type: 'nco', group: '突擊', name: '比爾・圭爾尼', nameEn: 'Bill "Wild Bill" Guarnere', avatar: '圭',
    rank: '士官', affil: 'E 連 第 2 排', born: '1923', died: '2014', age: '20',
    bio: '費城人、綽號「狂野比爾」，E 連最悍勇的士官之一。D 日得知兄長陣亡後作戰格外凶狠，街口衝鋒時鼓動弟兄不顧火網向前。',
    battle: '街口衝鋒，帶頭鼓動弟兄突過火網。',
    career: '後在巴斯通失去一條腿；戰後與海夫倫合著回憶錄，是 E 連老兵的精神象徵，2014 年逝世。',
  },
  {
    id: 'malarkey', side: 'blue', type: 'soldier', group: '突擊', name: '唐・馬拉其', nameEn: 'Don Malarkey', avatar: '馬',
    rank: '技四級', affil: 'E 連 第 2 排 · 迫擊砲', born: '1921', died: '2017', age: '23',
    bio: '奧勒岡人，E 連故事裡的常客。他說卡倫坦街口那陣火力，是他這輩子遇過最猛的。市鎮肅清後，他目睹了傷重弟兄的臨終祝禱，那一幕成了影集裡令人難忘的片段。',
    battle: '街口衝鋒（自評遇過最猛火力）；目睹傷者臨終祝禱。',
    career: '打完諾曼第、荷蘭、巴斯通全程，是服役最久的 E 連原始成員之一，2017 年逝世。',
  },

  // ── 逐屋肅清（市鎮街戰負傷） ──
  {
    id: 'tipper', side: 'blue', type: 'soldier', group: '逐屋肅清', name: '愛德華・蒂珀', nameEn: 'Edward "Tip" Tipper', avatar: '蒂',
    rank: '二等兵', affil: 'E 連 · 托科亞老兵', born: '1921', died: '2017', age: '22',
    bio: '與利布戈特一同清查一棟房子，他剛喊「清空」、站在門口，一發德軍迫擊砲彈在門邊炸開：右眼被毀（後摘除）、雙腿骨折、肩背中破片。利布戈特把他抬下火線。這是 E 連 6 月 12 日傷得最重的一人，從此沒再上戰場。',
    battle: '逐屋肅清時於門口遭迫擊砲彈重創（失右眼、雙腿骨折）。',
    career: '傷癒退役，後成為教師；長壽見證 E 連歷史，2017 年逝世。',
  },
  {
    id: 'liebgott', side: 'blue', type: 'soldier', group: '逐屋肅清', name: '喬・利布戈特', nameEn: 'Joe Liebgott', avatar: '布',
    rank: '技五級', affil: 'E 連 · 逐屋肅清', born: '1915', died: '1992', age: '29',
    bio: '加州理髮師、會德語、個性火爆。卡倫坦與蒂珀一同清屋；蒂珀被炸傷後，是他把人抬下火線送往救護站。常被誤以為他也在卡倫坦負傷，其實他的傷是同年 10 月在荷蘭才受的。',
    battle: '與蒂珀逐屋肅清，並把負傷的蒂珀抬離火線（本役未負傷）。',
    career: '隨 E 連轉戰全程；戰後返加州，1992 年因癌症過世。',
  },
  {
    id: 'lipton', side: 'blue', type: 'nco', group: '逐屋肅清', name: '卡伍德・利普頓', nameEn: 'Carwood Lipton', avatar: '普',
    rank: '士官', affil: 'E 連 · 班長', born: '1920', died: '2001', age: '24',
    bio: '沉穩可靠、深得弟兄與長官信任的士官。卡倫坦街戰中被迫擊砲破片擊傷臉、手腕、腿與鼠蹊，所幸傷勢不致命、痊癒歸隊。後在巴斯通成為 E 連在連長失能時的中流砥柱。',
    battle: '市鎮街戰中遭迫擊砲破片多處負傷，痊癒歸隊。',
    career: '巴斯通時實質撐起全連，升任連士官長、再獲軍官任命；戰後從商，2001 年逝世。',
  },

  // ── 考據還原（影集神話糾正） ──
  {
    id: 'blithe', side: 'blue', type: 'soldier', group: '考據', name: '亞伯特・布萊斯', nameEn: 'Albert Blithe', avatar: '萊',
    rank: '二等兵', affil: 'E 連 · 第 1 排', born: '1923', died: '1967', age: '20',
    bio: '影集第三集的主角：卡倫坦一帶他一度心因性失明，數日後巡邏時鎖骨（非頸部）中彈。★影集片尾字卡稱他「1948 年死於這道傷」，這是錯的。真相：他痊癒康復，韓戰隨 187 空降團作戰（獲銀星與銅星勳章）、升至士官長、終身未退役，1967 年 12 月 17 日在西德服役期間因穿孔性潰瘍併發症過世，葬於阿靈頓國家公墓。誤傳源於老兵失聯、以為他 1948 年已故；Ambrose 後版已更正，影集 DVD 未改。',
    battle: '卡倫坦一帶短暫心因性失明，數日後巡邏中鎖骨中彈。',
    career: '★並未死於戰傷：痊癒後續役、打韓戰（銀星＋銅星）、升士官長，1967 年因潰瘍併發症於西德過世，葬阿靈頓。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 單位 → 領導人物 figure id（點單位列開啟人物小卡）。
export const leaderOf = {
  'easy-assault': 'winters',
  'welsh-platoon': 'welsh',
  'base-mg': 'guarnere',
};
