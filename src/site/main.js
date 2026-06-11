import { eras } from './battles.js';

const app = document.getElementById('app');

for (const era of eras) {
  const section = document.createElement('section');
  section.className = 'era';
  section.innerHTML = `
    <div class="era-head">
      <h2>${era.name}</h2>
      <span class="era-period">${era.period}</span>
    </div>
  `;
  const grid = document.createElement('div');
  grid.className = 'battle-grid';

  if (era.battles.length === 0) {
    grid.innerHTML = `<p class="coming-soon">戰役製作中，敬請期待</p>`;
  }

  for (const b of era.battles) {
    const card = document.createElement(b.available ? 'a' : 'div');
    card.className = 'battle-card' + (b.available ? '' : ' disabled');
    if (b.available) card.href = b.url;
    card.innerHTML = `
      <div class="card-top">
        <h3>${b.name}</h3>
        <span class="card-en">${b.nameEn}</span>
      </div>
      <p class="card-date">${b.date}</p>
      <p class="card-sides">
        <span class="side red">${b.sides.red}</span>
        <span class="vs">VS</span>
        <span class="side blue">${b.sides.blue}</span>
      </p>
      <p class="card-summary">${b.summary}</p>
      <p class="card-cta">${b.available ? '▶ 進入 3D 戰役模擬' : '製作中'}</p>
    `;
    grid.appendChild(card);
  }
  section.appendChild(grid);
  app.appendChild(section);
}
