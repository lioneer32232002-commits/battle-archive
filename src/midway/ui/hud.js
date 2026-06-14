// HUD:標題列、時間軸控制、部隊面板、事件字卡、圖例、開場畫面
import { TIME_START, TIME_END, formatClock, sides, units, events, outcome, aces } from '../data/battle.js';
import { figures, figureById, captainOf } from '../data/figures.js';

const STATUS_ICON = { normal: '', burning: ' 🔥', sunk: ' ✚沉沒' };

export function createHUD(callbacks) {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="topbar">
      <div class="tb-left">
        <a href="/" class="home-link">◀ 戰史檔案館</a>
        <span class="battle-title">中途島戰役 <small>Battle of Midway</small></span>
      </div>
      <div class="tb-instruments">
        <div class="compass-wrap">
          <div class="compass" id="compass" title="方位羅盤(紅針指向正北;下方數字為目前視向)">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="cmp-bezel" cx="50" cy="50" r="47" />
            <circle class="cmp-face" cx="50" cy="50" r="42" />
            <polygon class="cmp-lubber" points="50,1 44,12 56,12" />
            <g id="compass-rose">
              <g class="cmp-ticks">
                <line x1="50" y1="6" x2="50" y2="13" />
                <line x1="94" y1="50" x2="87" y2="50" />
                <line x1="50" y1="94" x2="50" y2="87" />
                <line x1="6" y1="50" x2="13" y2="50" />
              </g>
              <polygon class="cmp-needle-n" points="50,25 45,50 55,50" />
              <polygon class="cmp-needle-s" points="50,75 45,50 55,50" />
              <circle class="cmp-hub" cx="50" cy="50" r="3" />
              <text class="cmp-lab cmp-n" x="50" y="20">N</text>
              <text class="cmp-lab" x="77" y="50">E</text>
              <text class="cmp-lab" x="50" y="80">S</text>
              <text class="cmp-lab" x="23" y="50">W</text>
            </g>
          </svg>
          </div>
          <span class="cmp-hdg" id="compass-hdg" aria-hidden="true">000°</span>
        </div>
        <div class="tb-clock-frame">
          <span class="tbc-tag" aria-hidden="true">ZONE TIME · 1942</span>
          <div class="tb-clock" id="clock">—</div>
        </div>
      </div>
      <div class="tb-right">
        <button id="btn-panel-red" class="hud-btn panel-toggle"><i class="dot red"></i>日軍</button>
        <button id="btn-panel-blue" class="hud-btn panel-toggle"><i class="dot blue"></i>美軍</button>
        <button id="btn-mode" class="hud-btn active">🎬 導演模式</button>
      </div>
    </div>

    <div id="panel-backdrop"></div>
    <aside id="panel-red" class="side-panel red"></aside>
    <aside id="panel-blue" class="side-panel blue"></aside>

    <div id="event-card" class="hidden">
      <div class="ec-time" id="ec-time"></div>
      <div class="ec-title" id="ec-title"></div>
      <div class="ec-desc" id="ec-desc"></div>
    </div>

    <div id="legend">
      <span><i class="dot red"></i>日本海軍</span>
      <span><i class="dot blue"></i>美國海軍</span>
      <span class="hint">拖曳旋轉 · 滾輪縮放 · 右鍵平移</span>
    </div>

    <div id="bottombar">
      <div id="chapters" role="group" aria-label="重要事件導覽"></div>
      <div class="bb-controls">
        <button id="btn-play" class="hud-btn big">▶</button>
        <button id="btn-speed" class="hud-btn">2×</button>
        <div id="timeline-wrap">
          <div id="timeline-ticks"></div>
          <input type="range" id="timeline" min="${TIME_START}" max="${TIME_END}" step="0.5" value="${TIME_START}" />
        </div>
      </div>
    </div>

    <div id="intro">
      <div class="intro-box">
        <p class="intro-kicker">戰史檔案館 · 3D 戰役模擬</p>
        <h1>中途島戰役</h1>
        <p class="intro-sub">Battle of Midway · 1942/6/4–6/7</p>
        <p class="intro-desc">
          日本海軍企圖攻佔中途島、殲滅美軍太平洋艦隊殘部；
          但美軍已破譯密碼，3 艘航空母艦在東北海域靜候伏擊。
          一日之內，太平洋戰爭的天平就此翻轉。
        </p>
        <button id="btn-start" class="hud-btn start">▶ 進入戰場</button>
        <p class="intro-src">戰役資料依據：美國海軍歷史與遺產司令部（NHHC）、Parshall &amp; Tully《Shattered Sword》</p>
      </div>
    </div>

    <div id="summary" class="hidden">
      <div class="summary-box">
        <p class="sum-kicker">戰役結束 · BATTLE CONCLUDED</p>
        <h2 class="sum-title">${outcome.headline}</h2>
        <p class="sum-sub">${outcome.sub} · 戰損比較</p>
        <div class="sum-table"></div>
        <div class="sum-actions">
          <button id="btn-replay" class="hud-btn start">↻ 重播戰役</button>
          <a href="/" class="hud-btn">◀ 返回戰史檔案館</a>
        </div>
      </div>
    </div>

    <div id="figure-card" class="hidden">
      <div class="figure-box">
        <button class="fig-close" id="fig-close" aria-label="關閉">✕</button>
        <div class="fig-head">
          <div class="fig-avatar" id="fig-avatar"></div>
          <div class="fig-headtext">
            <div class="fig-name" id="fig-name"></div>
            <div class="fig-en" id="fig-en"></div>
            <div class="fig-meta" id="fig-meta"></div>
          </div>
        </div>
        <div class="fig-stats" id="fig-stats"></div>
        <p class="fig-bio" id="fig-bio"></p>
        <div class="fig-result"><span class="rl">中途島戰果</span><span id="fig-battle"></span></div>
        <div class="fig-result"><span class="rl">生涯戰果</span><span id="fig-career"></span></div>
      </div>
    </div>
  `;

  // 事件刻度
  const ticks = document.getElementById('timeline-ticks');
  const pct = (t) => `${((t - TIME_START) / (TIME_END - TIME_START)) * 100}%`;
  for (const e of events) {
    const tick = document.createElement('i');
    tick.style.left = pct(e.t);
    if (e.cinematic) tick.classList.add('major');
    tick.title = e.title;
    ticks.appendChild(tick);
  }
  // 王牌攻擊時刻(★ 可點開人物小卡;標於該次攻擊的時點)
  for (const ace of aces) {
    for (const s of ace.sorties) {
      const markT = (s.spawnT + s.despawnT) / 2;
      const star = document.createElement('button');
      star.className = 'ace-tick';
      star.textContent = '★';
      star.style.left = pct(markT);
      star.dataset.fig = ace.id;
      star.title = `★ ${ace.name} 攻擊（${formatClock(markT)}）`;
      ticks.appendChild(star);
    }
  }

  // 重要事件章節:可點按的簡短按鈕,點擊即跳轉至該時點
  const chaptersEl = document.getElementById('chapters');
  const chapterBtns = [];
  for (const e of events) {
    if (!e.short) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chapter';
    btn.textContent = e.short;
    btn.title = `${formatClock(e.t)}　${e.title}`;
    btn.setAttribute('aria-label', `跳至 ${formatClock(e.t)}：${e.title}`);
    btn.addEventListener('click', () => callbacks.onJump(e.t));
    chaptersEl.appendChild(btn);
    chapterBtns.push({ t: e.t, btn });
  }
  let activeChapterT = null;
  function setActiveChapter(t) {
    let active = null;
    for (const c of chapterBtns) {
      if (c.t <= t + 1e-6) active = c;
      else break;
    }
    const at = active ? active.t : null;
    if (at === activeChapterT) return; // 僅在切換章節時更新 DOM
    activeChapterT = at;
    for (const c of chapterBtns) c.btn.classList.toggle('active', c === active);
    if (active) {
      const left = active.btn.offsetLeft - chaptersEl.clientWidth / 2 + active.btn.clientWidth / 2;
      chaptersEl.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }

  // 方位羅盤(羅經卡隨鏡頭轉動)
  const compassRose = document.getElementById('compass-rose');
  const compassHdg = document.getElementById('compass-hdg');

  // 控制列事件
  const btnPlay = document.getElementById('btn-play');
  const btnSpeed = document.getElementById('btn-speed');
  const btnMode = document.getElementById('btn-mode');
  const slider = document.getElementById('timeline');
  const speeds = [1, 2, 4, 8];
  let speedIdx = 1;

  btnPlay.addEventListener('click', () => callbacks.onPlayToggle());
  btnSpeed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    btnSpeed.textContent = `${speeds[speedIdx]}×`;
    callbacks.onSpeedChange(speeds[speedIdx]);
  });
  btnMode.addEventListener('click', () => {
    const free = btnMode.classList.toggle('active');
    btnMode.textContent = free ? '🎬 導演模式' : '🔓 自由視角';
    callbacks.onModeToggle(free ? 'director' : 'free');
  });
  slider.addEventListener('input', () => {
    const t = parseFloat(slider.value);
    callbacks.onScrub(t);
    setActiveChapter(t);
  });
  document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('intro').classList.add('hidden');
    callbacks.onStart();
  });

  // 行動版面板抽屜
  const panelRed = document.getElementById('panel-red');
  const panelBlue = document.getElementById('panel-blue');
  const backdrop = document.getElementById('panel-backdrop');
  const btnPanelRed = document.getElementById('btn-panel-red');
  const btnPanelBlue = document.getElementById('btn-panel-blue');
  function setPanel(side) {
    const openRed = side === 'red';
    const openBlue = side === 'blue';
    panelRed.classList.toggle('open', openRed);
    panelBlue.classList.toggle('open', openBlue);
    backdrop.classList.toggle('shown', openRed || openBlue);
    btnPanelRed.classList.toggle('active', openRed);
    btnPanelBlue.classList.toggle('active', openBlue);
  }
  btnPanelRed.addEventListener('click', () =>
    setPanel(panelRed.classList.contains('open') ? null : 'red')
  );
  btnPanelBlue.addEventListener('click', () =>
    setPanel(panelBlue.classList.contains('open') ? null : 'blue')
  );
  backdrop.addEventListener('click', () => setPanel(null));

  // 戰損比較表(播放結束)
  const summary = document.getElementById('summary');
  buildSummary();
  document.getElementById('btn-replay').addEventListener('click', () => callbacks.onReplay());

  // 人物小卡
  const figureCard = document.getElementById('figure-card');
  function openFigure(id) {
    const f = figureById[id];
    if (!f) return;
    const av = document.getElementById('fig-avatar');
    av.textContent = f.avatar;
    av.className = 'fig-avatar ' + f.side;
    document.getElementById('fig-name').textContent = f.name;
    document.getElementById('fig-en').textContent = f.nameEn;
    document.getElementById('fig-meta').textContent = `${f.rank}　${f.affil}`;
    document.getElementById('fig-stats').innerHTML =
      `<span>${f.born}–${f.died}</span><span><i>戰役時</i> ${f.age} 歲</span>`;
    document.getElementById('fig-bio').textContent = f.bio;
    document.getElementById('fig-battle').textContent = f.battle;
    document.getElementById('fig-career').textContent = f.career;
    figureCard.classList.remove('hidden');
    figureCard.classList.remove('animate');
    void figureCard.offsetWidth;
    figureCard.classList.add('animate');
  }
  function closeFigure() {
    figureCard.classList.add('hidden');
  }
  document.getElementById('fig-close').addEventListener('click', closeFigure);
  figureCard.addEventListener('click', (e) => {
    if (e.target === figureCard) closeFigure();
  });
  // 點面板中帶 data-fig 的項目即開啟小卡
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-fig]');
    if (el) openFigure(el.dataset.fig);
  });

  function buildSummary() {
    const unitFor = (k) => (k === 'aircraft' ? '架' : k === 'killed' ? '人' : '艘');
    const approx = (k) => k === 'aircraft' || k === 'killed';
    const fmt = (k, v) => `${approx(k) ? '約 ' : ''}${v} ${unitFor(k)}`;
    const rows = outcome.rows
      .map(
        (r) => `<tr>
          <td class="sv red">${fmt(r.key, outcome.red.values[r.key])}</td>
          <td class="sl">${r.label}</td>
          <td class="sv blue">${fmt(r.key, outcome.blue.values[r.key])}</td>
        </tr>`
      )
      .join('');
    document.querySelector('.sum-table').innerHTML = `
      <table>
        <thead>
          <tr>
            <th class="red"><span class="sn">${outcome.red.name}</span><span class="sd">${outcome.red.detail}</span></th>
            <th class="metric"></th>
            <th class="blue"><span class="sn">${outcome.blue.name}</span><span class="sd">${outcome.blue.detail}</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // 字卡
  const card = document.getElementById('event-card');
  let cardTimer = null;

  // 戰力血條:主力航艦清單(艦隊戰力計算用)+ 更新單一血條
  const carrierIds = {
    red: sides.red.unitIds.filter((id) => units.find((u) => u.id === id)?.kind === 'carrier'),
    blue: sides.blue.unitIds.filter((id) => units.find((u) => u.id === id)?.kind === 'carrier'),
  };
  function setBar(side, kind, pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const fill = document.getElementById(`hp-${kind}-${side}`);
    const ghost = document.getElementById(`hp-${kind}-ghost-${side}`);
    const val = document.getElementById(`hp-${kind}-val-${side}`);
    if (fill) fill.style.width = `${p}%`;
    if (ghost) ghost.style.width = `${p}%`; // 慢速追上 fill,露出剛損失的一段
    if (val) {
      val.textContent = `${p}%`;
      val.classList.toggle('warn', p < 50 && p >= 25);
      val.classList.toggle('crit', p < 25);
    }
  }

  // 面板骨架
  buildPanel('red');
  buildPanel('blue');

  function buildPanel(side) {
    const s = sides[side];
    const en = side === 'blue'; // 美軍:英文在前,繁中在後
    const el = document.getElementById(`panel-${side}`);
    const aceList = figures.filter((f) => f.type === 'ace' && f.side === side);
    el.innerHTML = `
      <h2>${s.name}</h2>
      <div class="hp-bars">
        <div class="hp-row">
          <span class="hp-label">航空戰力</span>
          <div class="hp-track"><div class="hp-ghost" id="hp-air-ghost-${side}"></div><div class="hp-fill" id="hp-air-${side}"></div></div>
          <span class="hp-val" id="hp-air-val-${side}">100%</span>
        </div>
        <div class="hp-row">
          <span class="hp-label">艦隊戰力</span>
          <div class="hp-track"><div class="hp-ghost" id="hp-fleet-ghost-${side}"></div><div class="hp-fill" id="hp-fleet-${side}"></div></div>
          <span class="hp-val" id="hp-fleet-val-${side}">100%</span>
        </div>
      </div>
      <div class="cmdrs">
        ${s.commanders
          .map((c) => {
            const primary = en ? c.nameEn : c.name;
            const secondary = en ? `${c.name}・${c.role}` : c.role;
            const fig = c.id ? ` data-fig="${c.id}"` : '';
            return `<div class="cmdr${c.id ? ' clickable' : ''}"${fig}><b>${primary}</b><small>${secondary}</small></div>`;
          })
          .join('')}
      </div>
      <div class="formations">
        ${s.formations
          .map((f) => {
            const ships = (f.ships ?? [])
              .map((sh) => `<small class="ship">${sh}</small>`)
              .join('');
            const escort = f.escort ? `<small class="escort">${f.escort}</small>` : '';
            return `<div class="formation"><b>${f.name}</b>${ships}${escort}</div>`;
          })
          .join('')}
      </div>
      ${
        aceList.length
          ? `<div class="aces-block">
        <div class="strength-title">關鍵飛行員</div>
        ${aceList
          .map(
            (f) =>
              `<div class="fig-row clickable" data-fig="${f.id}"><span class="fr-star">★</span><span class="fr-name">${f.name}</span><span class="fr-go">›</span></div>`
          )
          .join('')}
      </div>`
          : ''
      }
      <div class="strength">
        <div class="strength-title">主力艦艇 / 航空戰力</div>
        ${s.unitIds
          .map((id) => {
            const u = units.find((x) => x.id === id);
            const nameHtml =
              en && u.nameEn
                ? `<span class="en">${u.nameEn}</span><span class="zh">${u.name}</span>`
                : `<span class="zh">${u.name}</span>`;
            const capId = captainOf[id];
            const fig = capId ? ` data-fig="${capId}"` : '';
            return `<div class="unit-row${capId ? ' clickable' : ''}" id="row-${id}"${fig}>
              <span class="u-name">${nameHtml}</span>
              <span class="u-status" id="status-${id}"></span>
              <span class="u-count" id="count-${id}">${u.strength.aircraft ?? ''}</span>
            </div>`;
          })
          .join('')}
        <div class="unit-row total"><span class="u-name"><span class="zh">航空戰力合計</span></span><span class="u-count" id="total-${side}">${s.baseAircraft}</span></div>
      </div>
    `;
  }

  return {
    setPlaying(playing) {
      btnPlay.textContent = playing ? '❚❚' : '▶';
    },
    setTime(t) {
      document.getElementById('clock').textContent = formatClock(t);
      slider.value = t;
      setActiveChapter(t);
    },
    setHeading(camBearing) {
      // 羅經卡轉動使紅針指向場景正北(-z);數字為目前視向(0=N、90=E)
      if (compassRose) compassRose.setAttribute('transform', `rotate(${-camBearing} 50 50)`);
      if (compassHdg) {
        const h = Math.round(((camBearing % 360) + 360) % 360) % 360;
        compassHdg.textContent = `${String(h).padStart(3, '0')}°`;
      }
    },
    updatePanels(states) {
      for (const side of ['red', 'blue']) {
        let total = 0;
        for (const id of sides[side].unitIds) {
          const st = states.get(id);
          if (!st) continue;
          const n = st.strength.aircraft ?? 0;
          total += n;
          document.getElementById(`count-${id}`).textContent = n;
          document.getElementById(`status-${id}`).textContent = STATUS_ICON[st.status] ?? '';
          document.getElementById(`row-${id}`).classList.toggle('lost', st.status === 'sunk');
        }
        document.getElementById(`total-${side}`).textContent = total;

        // 航空戰力:現存艦載機 / 初始
        setBar(side, 'air', (total / sides[side].baseAircraft) * 100);
        // 艦隊戰力:主力航艦(正常=1、燃燒=0.3、沉沒=0)平均
        let fleetHp = 0;
        for (const id of carrierIds[side]) {
          const st = states.get(id);
          fleetHp += !st ? 1 : st.status === 'sunk' ? 0 : st.status === 'burning' ? 0.3 : 1;
        }
        setBar(side, 'fleet', (fleetHp / carrierIds[side].length) * 100);
      }
    },
    showEvent(e) {
      document.getElementById('ec-time').textContent = formatClock(e.t);
      document.getElementById('ec-title').textContent = e.title;
      document.getElementById('ec-desc').textContent = e.desc;
      card.classList.remove('hidden');
      card.classList.remove('animate');
      void card.offsetWidth; // 重新觸發動畫
      card.classList.add('animate');
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => card.classList.add('hidden'), 11000);
    },
    hideEvent() {
      clearTimeout(cardTimer);
      card.classList.add('hidden');
    },
    showSummary() {
      summary.classList.remove('hidden');
      summary.classList.remove('animate');
      void summary.offsetWidth;
      summary.classList.add('animate');
    },
    hideSummary() {
      summary.classList.add('hidden');
    },
    openFigure(id) {
      openFigure(id);
    },
  };
}
