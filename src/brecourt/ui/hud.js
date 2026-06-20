// HUD:標題列、時間軸控制、雙方面板、事件字卡、情報落差卡、音效控制、開場、結算
import { TIME_START, TIME_END, formatClock, sides, units, events, outcome, aces } from '../data/battle.js';
import { figures, figureById, leaderOf } from '../data/figures.js';

const STATUS_ICON = { normal: '', destroyed: ' ✕ 摧毀' };
const gunIds = units.filter((u) => u.kind === 'gun').map((u) => u.id);

export function createHUD(callbacks) {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="topbar">
      <div class="tb-left">
        <a href="/" class="home-link">◀ 戰史檔案館</a>
        <span class="battle-title">布雷庫爾奪砲戰 <small>Brécourt Manor</small></span>
      </div>
      <div class="tb-instruments">
        <div class="compass-wrap">
          <div class="compass" id="compass" title="方位羅盤">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="cmp-bezel" cx="50" cy="50" r="47" />
            <circle class="cmp-face" cx="50" cy="50" r="42" />
            <polygon class="cmp-lubber" points="50,1 44,12 56,12" />
            <g id="compass-rose">
              <g class="cmp-ticks">
                <line x1="50" y1="6" x2="50" y2="13" /><line x1="94" y1="50" x2="87" y2="50" />
                <line x1="50" y1="94" x2="50" y2="87" /><line x1="6" y1="50" x2="13" y2="50" />
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
          <span class="tbc-tag" aria-hidden="true">D-DAY · 1944</span>
          <div class="tb-clock" id="clock">—</div>
        </div>
      </div>
      <div class="tb-right">
        <button id="btn-audio" class="hud-btn audio-btn" title="音效開關">🔊</button>
        <input id="vol" class="vol-slider" type="range" min="0" max="100" value="50" title="音量" />
        <button id="btn-panel-red" class="hud-btn panel-toggle"><i class="dot red"></i>德軍</button>
        <button id="btn-panel-blue" class="hud-btn panel-toggle"><i class="dot blue"></i>美軍</button>
        <button id="btn-mode" class="hud-btn active">🎬 導演模式</button>
      </div>
    </div>

    <div id="hp-mini" aria-hidden="true">
      <div class="hpm-row red">
        <span class="hpm-side"><i class="dot"></i>德軍</span>
        <span class="hpm-cell">
          <i class="hpm-ico" title="兵力">兵</i>
          <span class="hpm-track"><span class="hpm-ghost" id="mini-hp-men-ghost-red"></span><span class="hpm-fill" id="mini-hp-men-red"></span></span>
          <span class="hpm-val" id="mini-hp-men-val-red">100%</span>
        </span>
      </div>
      <div class="hpm-row blue">
        <span class="hpm-side"><i class="dot"></i>美軍</span>
        <span class="hpm-cell">
          <i class="hpm-ico" title="兵力">兵</i>
          <span class="hpm-track"><span class="hpm-ghost" id="mini-hp-men-ghost-blue"></span><span class="hpm-fill" id="mini-hp-men-blue"></span></span>
          <span class="hpm-val" id="mini-hp-men-val-blue">100%</span>
        </span>
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

    <div id="intel-card" class="hidden">
      <div class="intel-head">⚠ 情報落差 · FOG OF WAR</div>
      <div class="intel-believed" id="intel-believed"></div>
      <div class="intel-actual" id="intel-actual"></div>
    </div>

    <div id="legend">
      <span><i class="dot red"></i>德軍</span>
      <span><i class="dot blue"></i>美軍 E 連</span>
      <span class="hint">藍線：主攻路線 · 藍錐：基底火力</span>
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
        <p class="intro-kicker">戰史檔案館 · 3D 戰術解析</p>
        <h1>布雷庫爾奪砲戰</h1>
        <p class="intro-sub">Brécourt Manor · 1944/6/6 · D 日</p>
        <p class="intro-desc">
          D 日清晨，溫斯特中尉以約 13 名空降兵，
          攻擊轟擊猶他灘出口的四門德軍 105mm 榴彈砲。
          基底火力、側翼接近、逐砲縱射，
          這場 13 對 50 的勝利，至今仍是西點軍校的攻擊教案。
        </p>
        <button id="btn-start" class="hud-btn start">▶ 進入戰場</button>
        <p class="intro-src">資料依據：Stephen Ambrose《Band of Brothers》、506 PIR 團史、西點軍校攻擊教案</p>
      </div>
    </div>

    <div id="summary" class="hidden">
      <div class="summary-box">
        <p class="sum-kicker">任務達成 · MISSION ACCOMPLISHED</p>
        <h2 class="sum-title">${outcome.headline}</h2>
        <p class="sum-sub">${outcome.sub}</p>
        <div class="sum-table"></div>
        <div class="sum-actions">
          <button id="btn-replay" class="hud-btn start">↻ 重播</button>
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
        <div class="fig-result"><span class="rl">布雷庫爾戰績</span><span id="fig-battle"></span></div>
        <div class="fig-result"><span class="rl">生涯</span><span id="fig-career"></span></div>
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
  // 關鍵人物時刻(★ 可點開小卡)
  for (const ace of aces) {
    const markT = (ace.activeFrom + ace.activeTo) / 2;
    const star = document.createElement('button');
    star.className = 'ace-tick';
    star.textContent = '★';
    star.style.left = pct(markT);
    star.dataset.fig = ace.id;
    star.title = `★ ${ace.name}（${formatClock(markT)}）`;
    ticks.appendChild(star);
  }

  // 章節
  const chaptersEl = document.getElementById('chapters');
  const chapterBtns = [];
  for (const e of events) {
    if (!e.short) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chapter'; btn.textContent = e.short;
    btn.title = `${formatClock(e.t)}　${e.title}`;
    btn.addEventListener('click', () => callbacks.onJump(e.t));
    chaptersEl.appendChild(btn);
    chapterBtns.push({ t: e.t, btn });
  }
  let activeChapterT = null;
  function setActiveChapter(t) {
    let active = null;
    for (const c of chapterBtns) { if (c.t <= t + 1e-6) active = c; else break; }
    const at = active ? active.t : null;
    if (at === activeChapterT) return;
    activeChapterT = at;
    for (const c of chapterBtns) c.btn.classList.toggle('active', c === active);
    if (active) {
      const left = active.btn.offsetLeft - chaptersEl.clientWidth / 2 + active.btn.clientWidth / 2;
      chaptersEl.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }

  const compassRose = document.getElementById('compass-rose');
  const compassHdg = document.getElementById('compass-hdg');

  // 控制列
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
    callbacks.onScrub(t); setActiveChapter(t);
  });
  document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('hp-mini').classList.add('show');
    callbacks.onStart();
  });

  // 音效控制
  let audioOn = true;
  const btnAudio = document.getElementById('btn-audio');
  const vol = document.getElementById('vol');
  btnAudio.addEventListener('click', () => {
    audioOn = !audioOn;
    btnAudio.textContent = audioOn ? '🔊' : '🔇';
    btnAudio.classList.toggle('off', !audioOn);
    callbacks.onAudioToggle(audioOn);
  });
  vol.addEventListener('input', () => callbacks.onVolume(parseInt(vol.value, 10) / 100));

  // 面板抽屜
  const panelRed = document.getElementById('panel-red');
  const panelBlue = document.getElementById('panel-blue');
  const backdrop = document.getElementById('panel-backdrop');
  const btnPanelRed = document.getElementById('btn-panel-red');
  const btnPanelBlue = document.getElementById('btn-panel-blue');
  function setPanel(side) {
    const openRed = side === 'red', openBlue = side === 'blue';
    panelRed.classList.toggle('open', openRed);
    panelBlue.classList.toggle('open', openBlue);
    backdrop.classList.toggle('shown', openRed || openBlue);
    btnPanelRed.classList.toggle('active', openRed);
    btnPanelBlue.classList.toggle('active', openBlue);
  }
  btnPanelRed.addEventListener('click', () => setPanel(panelRed.classList.contains('open') ? null : 'red'));
  btnPanelBlue.addEventListener('click', () => setPanel(panelBlue.classList.contains('open') ? null : 'blue'));
  backdrop.addEventListener('click', () => setPanel(null));

  const summary = document.getElementById('summary');
  buildSummary();
  document.getElementById('btn-replay').addEventListener('click', () => callbacks.onReplay());

  // 人物小卡
  const figureCard = document.getElementById('figure-card');
  function openFigure(id) {
    const f = figureById[id];
    if (!f) return;
    const av = document.getElementById('fig-avatar');
    av.textContent = f.avatar; av.className = 'fig-avatar ' + f.side;
    document.getElementById('fig-name').textContent = f.name + (f.kia ? ' ✝' : '');
    document.getElementById('fig-en').textContent = f.nameEn;
    document.getElementById('fig-meta').textContent = `${f.rank}　${f.affil}`;
    const dates = (f.born || f.died) ? `${f.born}–${f.died}` : '生卒年不詳';
    const ageHtml = f.age ? `<span><i>戰役時</i> ${f.age} 歲</span>` : '';
    document.getElementById('fig-stats').innerHTML = `<span>${dates}</span>${ageHtml}`;
    document.getElementById('fig-bio').textContent = f.bio;
    document.getElementById('fig-battle').textContent = f.battle;
    document.getElementById('fig-career').textContent = f.career;
    figureCard.classList.remove('hidden', 'animate');
    void figureCard.offsetWidth; figureCard.classList.add('animate');
  }
  function closeFigure() { figureCard.classList.add('hidden'); }
  document.getElementById('fig-close').addEventListener('click', closeFigure);
  figureCard.addEventListener('click', (e) => { if (e.target === figureCard) closeFigure(); });
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-fig]');
    if (el) openFigure(el.dataset.fig);
  });

  function buildSummary() {
    const fmt = (v) => `約 ${v} 人`;
    const rows = outcome.rows.map((r) => `<tr>
        <td class="sv red">${fmt(outcome.red.values[r.key])}</td>
        <td class="sl">${r.label}</td>
        <td class="sv blue">${fmt(outcome.blue.values[r.key])}</td>
      </tr>`).join('');
    const achieve = outcome.achievement
      ? `<div class="sum-achieve"><span class="sa-tag">E 連戰果</span>${outcome.achievement}</div>` : '';
    document.querySelector('.sum-table').innerHTML = `
      <table>
        <thead><tr>
          <th class="red"><span class="sn">${outcome.red.name}</span><span class="sd">${outcome.red.detail}</span></th>
          <th class="metric"></th>
          <th class="blue"><span class="sn">${outcome.blue.name}</span><span class="sd">${outcome.blue.detail}</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>${achieve}`;
  }

  const card = document.getElementById('event-card');
  let cardTimer = null;
  const intelCard = document.getElementById('intel-card');

  function setBar(side, kind, p) {
    p = Math.max(0, Math.min(100, Math.round(p)));
    for (const prefix of ['hp', 'mini-hp']) {
      const fill = document.getElementById(`${prefix}-${kind}-${side}`);
      const ghost = document.getElementById(`${prefix}-${kind}-ghost-${side}`);
      const val = document.getElementById(`${prefix}-${kind}-val-${side}`);
      if (fill) fill.style.width = `${p}%`;
      if (ghost) ghost.style.width = `${p}%`;
      if (val) {
        val.textContent = `${p}%`;
        val.classList.toggle('warn', p < 50 && p >= 25);
        val.classList.toggle('crit', p < 25);
      }
    }
  }

  buildPanel('red');
  buildPanel('blue');

  // 人物名冊(依分組列出全部成員,點開生平小卡)
  function rosterHtml(side) {
    const list0 = figures.filter((f) => f.side === side);
    if (!list0.length) return '';
    const order = ['指揮官', '突擊隊', '機槍組', '增援'];
    let html = '<div class="aces-block">';
    for (const g of order) {
      const list = list0.filter((f) => f.group === g);
      if (!list.length) continue;
      html += `<div class="strength-title">${g}</div>`;
      html += list.map((f) => `<div class="fig-row clickable" data-fig="${f.id}"${f.kia ? ' title="當日陣亡"' : ''}><span class="fr-star">${f.kia ? '✝' : '★'}</span><span class="fr-name">${f.name} <small class="fr-rank">${f.rank}</small></span><span class="fr-go">›</span></div>`).join('');
    }
    return html + '</div>';
  }

  function buildPanel(side) {
    const s = sides[side];
    const en = side === 'blue';
    const el = document.getElementById(`panel-${side}`);
    const gunBar = side === 'red'
      ? `<div class="hp-row">
           <span class="hp-label">火砲</span>
           <div class="hp-track"><div class="hp-ghost" id="hp-guns-ghost-red"></div><div class="hp-fill" id="hp-guns-red"></div></div>
           <span class="hp-val" id="hp-guns-val-red">100%</span>
         </div>` : '';
    el.innerHTML = `
      <h2>${s.name}</h2>
      <div class="hp-bars">
        <div class="hp-row">
          <span class="hp-label">兵力</span>
          <div class="hp-track"><div class="hp-ghost" id="hp-men-ghost-${side}"></div><div class="hp-fill" id="hp-men-${side}"></div></div>
          <span class="hp-val" id="hp-men-val-${side}">100%</span>
        </div>
        ${gunBar}
      </div>
      <div class="cmdrs">
        ${s.commanders.map((c) => {
          const primary = en && c.nameEn ? c.nameEn : c.name;
          const secondary = en && c.nameEn ? `${c.name}・${c.role}` : c.role;
          const fig = c.id ? ` data-fig="${c.id}"` : '';
          return `<div class="cmdr${c.id ? ' clickable' : ''}"${fig}><b>${primary}</b><small>${secondary}</small></div>`;
        }).join('')}
      </div>
      <div class="formations">
        ${s.formations.map((f) => {
          const ships = (f.ships ?? []).map((sh) => `<small class="ship">${sh}</small>`).join('');
          const escort = f.escort ? `<small class="escort">${f.escort}</small>` : '';
          return `<div class="formation"><b>${f.name}</b>${ships}${escort}</div>`;
        }).join('')}
      </div>
      ${rosterHtml(side)}
      <div class="strength">
        <div class="strength-title">單位</div>
        ${s.unitIds.map((id) => {
          const u = units.find((x) => x.id === id);
          if (!u) return '';
          const figId = leaderOf[id];
          const fig = figId ? ` data-fig="${figId}"` : '';
          const count = u.strength?.men != null ? `${u.strength.men}` : '';
          return `<div class="unit-row${figId ? ' clickable' : ''}" id="row-${id}"${fig}>
            <span class="u-name"><span class="zh">${u.name}</span></span>
            <span class="u-status" id="status-${id}"></span>
            <span class="u-count" id="count-${id}">${count}</span>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  return {
    setPlaying(playing) { btnPlay.textContent = playing ? '❚❚' : '▶'; },
    setTime(t) { document.getElementById('clock').textContent = formatClock(t); slider.value = t; setActiveChapter(t); },
    setHeading(camBearing) {
      if (compassRose) compassRose.setAttribute('transform', `rotate(${-camBearing} 50 50)`);
      if (compassHdg) {
        const h = Math.round(((camBearing % 360) + 360) % 360) % 360;
        compassHdg.textContent = `${String(h).padStart(3, '0')}°`;
      }
    },
    updatePanels(states) {
      for (const side of ['red', 'blue']) {
        let men = 0;
        for (const id of sides[side].unitIds) {
          const st = states.get(id);
          if (!st) continue;
          const n = st.strength.men;
          if (n != null) men += n;
          const cnt = document.getElementById(`count-${id}`);
          if (cnt && n != null) cnt.textContent = n;
          const stEl = document.getElementById(`status-${id}`);
          if (stEl) stEl.textContent = STATUS_ICON[st.status] ?? '';
          const row = document.getElementById(`row-${id}`);
          if (row) row.classList.toggle('lost', st.status === 'destroyed');
        }
        setBar(side, 'men', (men / sides[side].baseMen) * 100);
      }
      // 紅方火砲
      const gunsLeft = gunIds.filter((id) => states.get(id)?.status !== 'destroyed').length;
      setBar('red', 'guns', (gunsLeft / gunIds.length) * 100);
    },
    showEvent(e) {
      document.getElementById('ec-time').textContent = formatClock(e.t);
      document.getElementById('ec-title').textContent = e.title;
      document.getElementById('ec-desc').textContent = e.desc;
      card.classList.remove('hidden', 'animate');
      void card.offsetWidth; card.classList.add('animate');
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => card.classList.add('hidden'), 11000);
    },
    hideEvent() { clearTimeout(cardTimer); card.classList.add('hidden'); },
    showIntel(intel) {
      document.getElementById('intel-believed').textContent = intel.believed || '';
      const actualEl = document.getElementById('intel-actual');
      actualEl.textContent = intel.actual || '';
      actualEl.style.display = intel.actual ? 'block' : 'none';
      intelCard.classList.remove('hidden', 'animate');
      void intelCard.offsetWidth; intelCard.classList.add('animate');
    },
    hideIntel() { intelCard.classList.add('hidden'); },
    showSummary() {
      summary.classList.remove('hidden', 'animate');
      void summary.offsetWidth; summary.classList.add('animate');
    },
    hideSummary() { summary.classList.add('hidden'); },
    openFigure(id) { openFigure(id); },
  };
}
