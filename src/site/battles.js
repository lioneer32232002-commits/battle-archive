// 戰役清單資料 — 新增戰役:在對應時期的 battles 加一筆,並建立 battles/<id>/ 頁面
export const eras = [
  {
    id: 'ww2-pacific',
    name: '第二次世界大戰 · 太平洋戰場',
    period: '1941–1945',
    battles: [
      {
        id: 'midway',
        name: '中途島戰役',
        nameEn: 'Battle of Midway',
        date: '1942/6/4–6/7',
        sides: { red: '大日本帝國海軍', blue: '美國海軍' },
        thumb: '/thumb-midway.jpg',
        summary:
          '太平洋戰爭的命運轉捩點。美軍破譯密電、設伏待敵，一日之內連沉日軍四艘主力航艦，' +
          '自此奪回戰場主動，終結帝國海軍的攻勢。',
        url: '/battles/midway/',
        available: true,
      },
      {
        id: 'yamato',
        name: '天號作戰',
        nameEn: 'Operation Ten-Gō',
        date: '1945/4/7',
        sides: { red: '大日本帝國海軍', blue: '美國海軍' },
        thumb: '/thumb-yamato.jpg',
        summary:
          '戰艦大和的最後一戰。沖繩告急，聯合艦隊命世界最大的戰艦攜單程燃料衝向沖繩，組成「海上特攻隊」。' +
          '在毫無空中掩護的東海，大和遭美軍 386 架艦載機圍攻，連敵艦都未見著便傾覆爆沉，巨艦大砲的時代就此終結。',
        url: '/battles/yamato/',
        available: true,
      },
    ],
  },
  {
    id: 'ww2-europe',
    name: '第二次世界大戰 · 歐洲戰場',
    period: '1939–1945',
    battles: [
      {
        id: 'brecourt',
        name: '布雷庫爾奪砲戰',
        nameEn: 'Brécourt Manor Assault',
        date: '1944/6/6',
        sides: { red: '德意志國防軍', blue: '美軍 101 空降師' },
        thumb: '/thumb-brecourt.jpg',
        summary:
          'D 日清晨，溫斯特中尉以約 13 名空降兵，攻擊轟擊猶他灘出口的四門德軍 105mm 榴彈砲。' +
          '基底火力、側翼接近、逐砲縱射，13 對 50 的勝利，至今仍是西點軍校的班排攻擊教案。',
        url: '/battles/brecourt/',
        available: true,
      },
    ],
  },
  {
    id: 'sengoku',
    name: '日本戰國時代',
    period: '1467–1615',
    battles: [],
  },
];
