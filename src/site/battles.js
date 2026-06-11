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
        date: '1942年6月4日–7日',
        sides: { red: '大日本帝國海軍', blue: '美國海軍' },
        summary:
          '太平洋戰爭的轉捩點。美軍憑藉情報破譯設伏，在一日之內擊沉日本四艘主力航艦，' +
          '終結了日本海軍的攻勢優勢。',
        url: '/battles/midway/',
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
