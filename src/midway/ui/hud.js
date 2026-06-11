// HUD:標題列、時間軸控制、部隊面板、事件字卡、圖例、開場畫面
import { TIME_START, TIME_END, formatClock, sides, units, events, outcome } from '../data/battle.js';

const STATUS_ICON = { normal: '', burning: ' 🔥', sunk: ' ✚沉沒' };

export function createHUD(callbacks) {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="topbar">
      <div class="tb-left">
        <a href="/" class="home-link">◀ 戰史檔案館</a>
        <span class="battle-title">中途島戰役 <small>Battle of Midway</small></span>
      </div>
      <div class="tb-clock" id="clock">—</div>
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
      <button id="btn-play" class="hud-btn big">▶</button>
      <button id="btn-speed" class="hud-btn">2×</button>
      <div id="timeline-wrap">
        <div id="timeline-ticks"></div>
        <input type="range" id="timeline" min="${TIME_START}" max="${TIME_END}" step="0.5" value="${TIME_START}" />
      </div>
    </div>

    <div id="intro">
      <div class="intro-box">
        <p class="intro-kicker">戰史檔案館 · 3D 戰役模擬</p>
        <h1>中途島戰役</h1>
        <p class="intro-sub">Battle of Midway · 1942年6月4日–7日</p>
        <p class="intro-desc">
          日本海軍企圖攻佔中途島、殲滅美軍太平洋艦隊殘部；
          但美軍已破譯密碼，三艘航空母艦在東北海域靜候伏擊。
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
  `;

  // 事件刻度
  const ticks = document.getElementById('timeline-ticks');
  for (const e of events) {
    const tick = document.createElement('i');
    tick.style.left = `${((e.t - TIME_START) / (TIME_END - TIME_START)) * 100}%`;
    if (e.cinematic) tick.classList.add('major');
    tick.title = e.title;
    ticks.appendChild(tick);
  }

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
  slider.addEventListener('input', () => callbacks.onScrub(parseFloat(slider.value)));
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

  // 面板骨架
  buildPanel('red');
  buildPanel('blue');

  function buildPanel(side) {
    const s = sides[side];
    const en = side === 'blue'; // 美軍:英文在前,繁中在後
    const el = document.getElementById(`panel-${side}`);
    el.innerHTML = `
      <h2>${s.name}</h2>
      <div class="cmdrs">
        ${s.commanders
          .map((c) => {
            const primary = en ? c.nameEn : c.name;
            const secondary = en ? `${c.name}・${c.role}` : c.role;
            return `<div class="cmdr"><b>${primary}</b><small>${secondary}</small></div>`;
          })
          .join('')}
      </div>
      <div class="formations">
        ${s.formations.map((f) => `<div class="formation"><b>${f.name}</b><small>${f.detail}</small></div>`).join('')}
      </div>
      <div class="strength">
        <div class="strength-title">主力艦艇 / 航空戰力</div>
        ${s.unitIds
          .map((id) => {
            const u = units.find((x) => x.id === id);
            const nameHtml =
              en && u.nameEn
                ? `<span class="en">${u.nameEn}</span><span class="zh">${u.name}</span>`
                : `<span class="zh">${u.name}</span>`;
            return `<div class="unit-row" id="row-${id}">
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
  };
}
