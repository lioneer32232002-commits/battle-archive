// 天號作戰(坊之岬沖海戰)— 雙方重要人物小傳(將領、艦長)
// 史料查證:Wikipedia、NHHC、原為一《日本驅逐艦艦長》、ww2db
// age = 1945 年 4 月當時年齡;battle = 此役相關事蹟;career = 生涯/結局
export const figures = [
  // ── 日軍 指揮官 ──
  {
    id: 'toyoda', side: 'red', type: 'commander', name: '豐田副武', nameEn: 'Soemu Toyoda', avatar: '豐',
    rank: '海軍大將', affil: '聯合艦隊司令長官', born: '1885', died: '1957', age: '59',
    bio: '下達天號作戰命令的最高指揮官。在沖繩告急、燃料與飛行員都已枯竭之際，他批准了大和的單程出擊，主張即使無望也要讓帝國海軍「死得其所」、保住顏面。許多幕僚私下認為這是純粹的浪費。',
    battle: '下令大和艦隊實施有去無回的海上特攻。',
    career: '戰後以戰犯受審，獲判無罪；1957 年病逝。',
  },
  {
    id: 'ito', side: 'red', type: 'commander', name: '伊藤整一', nameEn: 'Seiichi Itō', avatar: '伊',
    rank: '海軍中將', affil: '第二艦隊司令長官 · 旗艦大和', born: '1890', died: '1945', age: '54',
    bio: '海上特攻隊的指揮官。接到命令時，他一度當場拒絕，直言這是毫無勝算的送死。在「請以一億總特攻之先驅」的勸說下，他最終接受了任務。大和注定沉沒時，他下令全員退艦，自己卻走進長官室反鎖艙門，與艦同沉。',
    battle: '率艦隊出擊，大和傾覆前下令中止作戰、全員退艦。',
    career: '與大和一同沉沒，殉職後追晉海軍大將。',
  },
  {
    id: 'komura', side: 'red', type: 'commander', name: '古村啟藏', nameEn: 'Keizō Komura', avatar: '古',
    rank: '海軍少將', affil: '第二水雷戰隊司令官 · 旗艦矢矧', born: '1896', died: '1978', age: '49',
    bio: '率領護衛驅逐艦隊的水雷戰隊司令，將旗艦設於輕巡矢矧。矢矧最早中雷停俥、淪為活靶，最終傾覆。他落海後被驅逐艦救起，是少數生還的高階指揮官之一。',
    battle: '旗艦矢矧中雷沉沒，本人落海獲救生還。',
    career: '戰後曾任海上自衛隊要職，1978 年逝世。',
  },
  // ── 美軍 指揮官 ──
  {
    id: 'spruance', side: 'blue', type: 'commander', name: '雷蒙・史普魯恩斯', nameEn: 'Raymond A. Spruance', avatar: '史',
    rank: '海軍上將', affil: '第五艦隊司令', born: '1886', died: '1969', age: '58',
    bio: '三年前在中途島一戰成名的名將，此時已是統率第五艦隊的上將，坐鎮指揮沖繩戰役。他原打算讓戰艦群迎戰大和，最終仍由米契爾的艦載機解決了這個對手。',
    battle: '掌握大和行蹤，統籌全局，放手讓 TF58 發動空襲。',
    career: '戰後任海軍戰爭學院院長、駐菲律賓大使，1969 年逝世。',
  },
  {
    id: 'mitscher', side: 'blue', type: 'commander', name: '馬克・米契爾', nameEn: 'Marc A. Mitscher', avatar: '米',
    rank: '海軍中將', affil: '第58特遣艦隊司令 · 旗艦邦克山號', born: '1887', died: '1947', age: '57',
    bio: '快速航艦特遣艦隊的傳奇司令。得知大和出擊，他不顧戰艦派的異議，搶先放飛近 400 架艦載機，要親手了結這艘巨艦。「我會處理掉它」，他果然做到了，而且代價極小。',
    battle: '指揮 TF58 出動約 386 架艦載機，以三波空襲擊沉大和。',
    career: '戰後任大西洋艦隊總司令，1947 年因勞瘁病逝。',
  },
  {
    id: 'sherman', side: 'blue', type: 'commander', name: '弗雷德里克・薛曼', nameEn: 'Frederick C. Sherman', avatar: '薛',
    rank: '海軍少將', affil: 'TG 58.3 航艦戰隊司令', born: '1888', died: '1957', age: '56',
    bio: '經驗豐富的航艦戰隊指揮官，曾任列星頓號艦長。坊之岬一役，他麾下的航艦戰隊放出大批俯衝轟炸機與魚雷機，是擊沉大和的主力之一。',
    battle: '所屬航艦戰隊投入擊沉大和的攻擊波。',
    career: '戰後晉升海軍上將，1957 年逝世。',
  },
  // ── 艦長 ──
  {
    id: 'aruga', side: 'red', type: 'captain', name: '有賀幸作', nameEn: 'Kōsaku Aruga', avatar: '有',
    rank: '海軍大佐', affil: '大和艦長', born: '1897', died: '1945', age: '47',
    bio: '魚雷戰專家出身的大和末任艦長。最後時刻，他婉拒部下勸離，把自己綁在艦橋的羅經儀座上，從容嚼著餅乾，隨傾覆的大和沉入海底，與愛艦共存亡。',
    battle: '指揮大和抗擊三波空襲，傾覆時自縛於艦橋共沉。',
    career: '與大和一同殉職，追晉海軍中將。',
  },
  {
    id: 'hara', side: 'red', type: 'captain', name: '原為一', nameEn: 'Tameichi Hara', avatar: '原', side2: 'red',
    rank: '海軍大佐', affil: '矢矧艦長', born: '1900', died: '1980', age: '45',
    bio: '身經百戰的「不沉艦長」，以戰後回憶錄《日本驅逐艦艦長》聞名於世。矢矧中雷停俥後被美機反覆痛擊，他指揮到最後一刻；艦沉時被吸入海中又奇蹟浮起，終獲救生還。',
    battle: '矢矧傾覆沉沒，本人落海後奇蹟生還。',
    career: '戰後著《日本驅逐艦艦長》，成為珍貴一手史料，1980 年逝世。',
  },
];

export const figureById = Object.fromEntries(figures.map((f) => [f.id, f]));

// 艦艇 → 艦長 figure id(點艦艇列即可開啟)
export const captainOf = {
  yamato: 'aruga',
  yahagi: 'hara',
};
