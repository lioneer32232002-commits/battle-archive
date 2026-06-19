import { eras } from './battles.js';

const app = document.getElementById('app');

for (const era of eras) {
  const section = document.createElement('section');
  section.className = 'era';
  const nameHtml = era.name
    .split(' · ')
    .map((seg) => `<span class="era-seg">${seg}</span>`)
    .join('');
  section.innerHTML = `
    <div class="era-head">
      <h2>${nameHtml}</h2>
      <span class="era-period">${era.period}</span>
    </div>
  `;
  const grid = document.createElement('div');
  grid.className = 'battle-grid';

  if (era.battles.length === 0) {
    grid.innerHTML = `<p class="coming-soon">戰雲集結中 · 即將開戰</p>`;
  }

  for (const b of era.battles) {
    const card = document.createElement(b.available ? 'a' : 'div');
    card.className = 'battle-card' + (b.available ? '' : ' disabled');
    if (b.available) card.href = b.url;
    const thumb = b.thumb
      ? `<div class="card-thumb"><img src="${b.thumb}" alt="" loading="lazy" decoding="async" /></div>`
      : '';
    card.innerHTML = `
      ${thumb}
      <div class="card-body">
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
        <p class="card-cta">${b.available ? '▶ 進入戰場 · 3D 戰役重現' : '備戰中'}</p>
      </div>
    `;
    grid.appendChild(card);
  }
  section.appendChild(grid);
  app.appendChild(section);
}
