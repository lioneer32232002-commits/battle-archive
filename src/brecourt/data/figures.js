// 布雷庫爾奪砲戰 — 參戰人物小傳(溫特斯突擊隊＋兩個 .30 機槍組＋增援)
// 史料查證:Stephen Ambrose《Band of Brothers》、506 PIR 團史、Warfare History Network、
//          各人物 wiki／Find a Grave 訃聞、National WWII Museum。各家名單略有出入,存疑處已註明。
// group = 面板名冊分組;kia = 當日陣亡;age = 1944 年 6 月概略年齡。
export const figures = [
  // ── 指揮官 ──
  {
    id: 'sink', side: 'blue', type: 'commander', group: '指揮官', name: '羅伯特・辛克', nameEn: 'Robert F. Sink', avatar: '辛',
    rank: '上校', affil: '506 傘兵團 團長', born: '1905', died: '1965', age: '38',
    bio: '綽號「Five-Oh-Sink」，自托科亞訓練起一路帶領 506 團。他在 D 日隨團空降諾曼第，以嚴格與帶兵在前著稱，506 團在他手下打完歐洲全程。',
    battle: '率 506 傘兵團空降諾曼第，奪取灘頭出口與卡倫坦。',
    career: '戰後續任軍職，晉升中將，1965 年逝世。',
  },
  {
    id: 'winters', side: 'blue', type: 'commander', group: '指揮官', name: '理查・溫特斯', nameEn: 'Richard D. Winters', avatar: '溫',
    rank: '中尉', affil: 'E 連 · 布雷庫爾攻擊指揮', born: '1918', died: '2011', age: '26',
    bio: 'D 日跳傘時武器袋脫落，他只憑一把刺刀在黑暗中集結散兵。隨即奉命攻擊布雷庫爾莊園的四門德軍榴彈砲，以約 13 人擊潰約 50 名守軍，教科書級的火力與機動分進讓他獲頒傑出服役十字勳章，此役至今仍是西點軍校的攻擊教案。',
    battle: '指揮布雷庫爾拔砲，摧毀四門 105mm 砲，奪得猶他灘德軍防禦圖。',
    career: '此役獲頒傑出服役十字勳章（原獲推薦榮譽勳章，因空降師「每師一枚」的不成文限制降等，1944 年 7 月 2 日由布萊德雷上將親授）。後升任 E 連連長、第 2 營副營長，帶領弟兄打到鷹巢。戰後深居簡出，2011 年逝世。',
  },

  // ── 突擊隊 ──
  {
    id: 'compton', side: 'blue', type: 'officer', group: '突擊隊', name: '林恩・康普頓', nameEn: 'Lynn "Buck" Compton', avatar: '康',
    rank: '少尉', affil: 'E 連 排長', born: '1921', died: '2012', age: '23',
    bio: '加州大學橄欖球與棒球好手出身。布雷庫爾一役，他匍匐逼近砲位，以投擲棒球的臂力把手榴彈準確扔進德軍砲坑，是攻擊得手的關鍵之一。',
    battle: '布雷庫爾攻擊主力，投彈肅清砲位。',
    career: '市場花園中臀部中彈。戰後任洛杉磯檢察官，起訴刺殺羅伯・甘迺迪的兇手，後任加州上訴法院法官。',
  },
  {
    id: 'guarnere', side: 'blue', type: 'nco', group: '突擊隊', name: '比爾・圭爾尼', nameEn: 'Bill "Wild Bill" Guarnere', avatar: '圭',
    rank: '士官', affil: 'E 連 班長', born: '1923', died: '2014', age: '20',
    bio: '費城出身，綽號「狂野比爾」。跳傘前夕得知兄長在義大利陣亡，化悲憤為戰意，布雷庫爾一役奮勇當先。性情火爆卻極護弟兄。',
    battle: '布雷庫爾攻擊主力之一，作戰勇猛。',
    career: '突出部戰役為救戰友洛伊失去一條腿。戰後與好友共同口述歷史，2014 年逝世。',
  },
  {
    id: 'malarkey', side: 'blue', type: 'nco', group: '突擊隊', name: '唐・馬拉其', nameEn: 'Don Malarkey', avatar: '馬',
    rank: '士官', affil: 'E 連 · 突擊隊機槍', born: '1921', died: '2017', age: '22',
    bio: '奧勒岡出身，E 連連續在線作戰天數最長的士兵之一。布雷庫爾一役在第一、二門砲間操作機槍，撤退時以迫擊砲掩護；當天還曾冒火力衝向一名他誤以為同鄉的德軍屍體搜尋紀念品，在槍林彈雨中折返。',
    battle: '操作突擊機槍、迫擊砲掩護撤離。',
    career: '打完歐洲全程，戰後寫下回憶錄，2017 年高齡逝世。',
  },
  {
    id: 'lipton', side: 'blue', type: 'nco', group: '突擊隊', name: '卡伍德・利普頓', nameEn: 'Carwood Lipton', avatar: '利',
    rank: '士官長', affil: 'E 連 連士官長', born: '1920', died: '2001', age: '23',
    bio: '沉穩可靠的精神支柱。布雷庫爾一役與蘭尼攀上樹籬觀測、引導火力。日後在突出部巴斯通，他在軍官傷亡時穩住全連士氣，被視為 E 連的脊梁。',
    battle: '攀樹籬觀測引導，穩定全連。',
    career: '戰場上獲拔擢為軍官。戰後從商任職跨國企業主管，2001 年逝世。',
  },
  {
    id: 'toye', side: 'blue', type: 'nco', group: '突擊隊', name: '喬・洛伊', nameEn: 'Joe Toye', avatar: '洛',
    rank: '下士', affil: 'E 連 · 突擊隊', born: '1919', died: '1995', age: '25',
    bio: '賓州礦工之子，珍珠港事變後從軍、志願跳傘。布雷庫爾一役一枚德軍手榴彈落在他兩腿之間，靠步槍槍托擋下大半爆風而倖免，隨後與圭爾尼以機槍火力掩護全隊撤離。',
    battle: '近迫突擊清除砲位，並以火力掩護脫離。',
    career: '全戰役獲四枚紫心；1945 年 1 月在巴斯通失去右腿。1995 年因癌症過世。',
  },
  {
    id: 'ranney', side: 'blue', type: 'nco', group: '突擊隊', name: '麥克・蘭尼', nameEn: 'Mike Ranney', avatar: '蘭',
    rank: '中士', affil: 'E 連 · 側翼火力', born: '1922', died: '1988', age: '21',
    bio: '北達科他人，入伍前讀大學、登記職業為「演員」。布雷庫爾時與利普頓在側翼樹上射擊，吸引並壓制德軍火力。',
    battle: '提供側翼壓制火力，因功獲銅星。',
    career: '戰後當記者與公關。名言「我和英雄們一起服役」常被引用；1988 年因心臟病過世。',
  },
  {
    id: 'wynn', side: 'blue', type: 'soldier', group: '突擊隊', name: '派派・溫', nameEn: 'Robert "Popeye" Wynn', avatar: '派',
    rank: '二等兵', affil: 'E 連 · 突擊隊', born: '1921', died: '2000', age: '22',
    bio: '維吉尼亞人，綽號取自卡通大力水手。布雷庫爾推進第一門砲時，一枚手榴彈在其戰壕炸開、臀部中彈；負傷時還向同袍道歉「給大家添麻煩」。',
    battle: '參與第一門砲突擊，為當日傷者之一。',
    career: '獲銅星、紫心；傷癒後續打市場花園與巴斯通。2000 年過世。',
  },
  {
    id: 'lorraine', side: 'blue', type: 'soldier', group: '突擊隊', name: '傑拉德・羅蘭', nameEn: 'Gerald "Frenchy" Loraine', avatar: '羅',
    rank: '一等兵', affil: '非 E 連 · 志願加入', born: '1913', died: '1976', age: '31',
    bio: '加州人，並非 E 連（多數記載屬 506 團勤務連）。誤降後在聖瑪麗杜蒙一帶會合，志願加入溫特斯攻擊。攻下第一門砲後以衝鋒槍擊倒一名逃跑德兵，並把德軍丟來的手榴彈回擲。',
    battle: '射倒逃逸德兵、回擲手榴彈支援突擊。',
    career: '因功獲銀星（獎章等級各家略有出入）。戰後返加州，1976 年逝世。',
  },
  {
    id: 'halls', side: 'blue', type: 'soldier', group: '突擊隊', kia: true, name: '約翰・霍爾斯', nameEn: 'John D. Halls', avatar: '霍',
    rank: '一等兵', affil: '第 2 營本部連 · 志願加入', born: '1922', died: '1944', age: '22',
    bio: '科羅拉多人，屬第 2 營本部連迫擊砲排（常被誤認為勤務連的另一位 John Hall，實為不同人）。落地後向溫特斯自報是失去無線電的通信兵，遂加入攻擊並提供 TNT。',
    battle: '衝向第三門砲時陣亡，是當日確認陣亡者之一。',
    career: '1944 年 6 月 6 日陣亡，葬於諾曼第美軍公墓。',
  },
  {
    id: 'hicks', side: 'blue', type: 'soldier', group: '突擊隊', name: '華特・希克斯', nameEn: 'Walter Hicks', avatar: '希',
    rank: '二等兵', affil: 'F 連 · 志願加入', born: '', died: '', age: '',
    bio: '來自 F 連，落地後主動找上溫特斯表示願意幫忙，並奉命回去帶來霍克。攻擊中以手榴彈協助癱瘓第二、三門砲，小腿被跳彈擊中負傷。（戰後生平資料有限）',
    battle: '以手榴彈破壞砲位，作戰中負傷。',
    career: '資料有限，生平不詳。',
  },
  {
    id: 'houck', side: 'blue', type: 'nco', group: '突擊隊', kia: true, name: '朱利斯・霍克', nameEn: 'Julius "Rusty" Houck', avatar: '克',
    rank: '中士', affil: 'F 連 · 志願加入', born: '1921', died: '1944', age: '23',
    bio: '威斯康辛人，1942 年於托科亞受訓。經希克斯引介加入溫特斯攻擊隊，攻擊第四門砲時遭機槍掃中陣亡。',
    battle: '參與第四門砲突擊時陣亡，當日確認陣亡者之一。',
    career: '1944 年陣亡。',
  },
  {
    id: 'kimberling', side: 'blue', type: 'soldier', group: '突擊隊', name: '紅毛・金博林', nameEn: 'Virgil "Red" Kimberling', avatar: '金',
    rank: '二等兵', affil: '本部連 · 志願加入', born: '', died: '', age: '',
    bio: '本部連士兵，與霍爾斯、羅蘭同批誤降後志願加入攻擊。布雷庫爾時把手榴彈丟進砲管內以破壞火砲。（生平資料有限）',
    battle: '以手榴彈投入砲管癱瘓德軍榴彈砲。',
    career: '資料有限，生平不詳。',
  },

  // ── 機槍組(兩挺 .30 機槍:利布戈特＋佩提、普雷沙＋亨德里克斯) ──
  {
    id: 'liebgott', side: 'blue', type: 'soldier', group: '機槍組', name: '喬・利布戈特', nameEn: 'Joe Liebgott', avatar: '布',
    rank: '技五級', affil: 'E 連 · 機槍組', born: '1915', died: '1992', age: '29',
    bio: '密西根出身、奧地利移民之子，戰前在加州當理髮師，個性火爆。布雷庫爾當天與佩提操作一挺 .30 機槍，封鎖第一門砲側翼。',
    battle: '以機槍火力壓制砲位，與佩提同獲銅星。',
    career: '戰後返加州，1992 年因癌症過世。',
  },
  {
    id: 'petty', side: 'blue', type: 'soldier', group: '機槍組', name: '克里夫蘭・佩提', nameEn: 'Cleveland Petty', avatar: '佩',
    rank: '二等兵', affil: 'E 連 · 機槍組', born: '1924', died: '1961', age: '20',
    bio: '於布拉格堡加入 E 連第 2 排。D 日操作掩護溫特斯、康普頓推進的兩挺機槍之一，當天頸部被破片擊傷仍留隊。',
    battle: '機槍壓制砲位掩護突擊，與利布戈特同獲銅星。',
    career: '後於卡倫坦外再度負傷；1961 年早逝。',
  },
  {
    id: 'plesha', side: 'blue', type: 'soldier', group: '機槍組', name: '約翰・普雷沙', nameEn: 'John Plesha', avatar: '普',
    rank: '下士', affil: 'E 連 · 機槍組', born: '1918', died: '1989', age: '26',
    bio: '華盛頓州羅斯林人，機槍手。D 日與亨德里克斯沿樹籬架設一挺 .30 機槍，正面壓制第一門 105mm 榴彈砲。（生年另有 1912 一說）',
    battle: '以機槍火力封鎖砲位，掩護突擊隊近迫。',
    career: '戰後返華盛頓州，1989 年過世。',
  },
  {
    id: 'hendrix', side: 'blue', type: 'soldier', group: '機槍組', name: '華特・亨德里克斯', nameEn: 'Walter Hendrix', avatar: '亨',
    rank: '二等兵', affil: 'E 連 · 機槍組', born: '1924', died: '2000', age: '19',
    bio: '喬治亞人，1943 年志願跳傘，於布拉格堡加入 E 連任機槍手。是參與布雷庫爾的最初一批人之一，與普雷沙操作一挺 .30 機槍。',
    battle: '機槍壓制砲位，因功獲銅星。',
    career: '戰後返鄉，2000 年過世。',
  },

  // ── 增援(D 連) ──
  {
    id: 'speirs', side: 'blue', type: 'officer', group: '增援', name: '羅納德・史皮爾斯', nameEn: 'Ronald Speirs', avatar: '史',
    rank: '中尉', affil: 'D 連（增援）', born: '1920', died: '2007', age: '24',
    bio: '布雷庫爾攻擊後段，他率 D 連增援趕到，衝過開闊地拔除最後一門砲。作風剽悍、膽識過人，圍繞他的傳聞甚多。日後在突出部戰役佛伊之役臨危接掌 E 連，一人衝過全村再衝回來，成為傳奇。',
    battle: '率 D 連增援，拔除布雷庫爾最後一門砲。',
    career: '後任 E 連連長帶隊至戰爭結束，續服役至韓戰與冷戰，2007 年逝世。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 單位 → 領導人物 figure id(點單位列開啟人物小卡)。
// E 連不再連到溫特斯本人(避免與「溫特斯突擊隊」重複);全員生平改由面板「人物名冊」呈現。
export const leaderOf = {
  'winters-party': 'winters',
  'base-of-fire': 'lipton',
};
