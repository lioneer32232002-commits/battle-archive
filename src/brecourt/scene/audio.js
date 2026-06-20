// 音效引擎 — 純 Web Audio 即時合成,零版權、檔案極小、音量可控。
// 配樂:低沉的小調環境底噪 + 緩慢低頻脈動(戰爭張力,預設很小聲)。
// 音效:槍聲、機槍連射、爆炸、衝鋒 — 由 main.js 在進攻/拔砲事件觸發。
// 進階:若 setMusicUrl() 指定了免版權音樂檔,改放檔案、停用合成底噪。

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.volume = 0.5;
    this._noise = null;
    this._ambient = null;
    this._musicEl = null;
    this._musicUrl = null;
  }

  // 在使用者手勢(開始鈕)內呼叫,解鎖音訊
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32; // 配樂相對小聲
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1.0;
    this.sfxGain.connect(this.master);
    this._noise = this._makeNoise(1.2);
    this.startAmbient();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? v : 0, this.ctx.currentTime, 0.05);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  // 指定免版權音樂檔(放進 public/ 或戰役資料夾);有檔即改播檔案
  setMusicUrl(url) { this._musicUrl = url; }

  // ── 配樂:小調 drone + 緩慢脈動 ───────────────────────
  startAmbient() {
    if (!this.ctx || this._ambient) return;
    // 若指定了音樂檔,改用檔案
    if (this._musicUrl) { this._startMusicFile(); return; }
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    g.gain.setTargetAtTime(0.9, t, 2.5); // 緩慢淡入
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.6;
    g.connect(lp); lp.connect(this.musicGain);

    // 小調 drone(A1、C2、E2 微失諧)
    const freqs = [55, 65.4, 82.4];
    const oscs = [];
    for (const f of freqs) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const og = this.ctx.createGain();
      og.gain.value = 0.18;
      o.connect(og); og.connect(g);
      o.start(t);
      oscs.push(o);
    }
    // 緩慢低頻脈動(戰鼓般的心跳)
    const pulse = this.ctx.createOscillator();
    pulse.type = 'sine'; pulse.frequency.value = 41;
    const pulseGain = this.ctx.createGain();
    pulseGain.gain.value = 0.0;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.5; // 每 2 秒一次
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.22;
    lfo.connect(lfoGain); lfoGain.connect(pulseGain.gain);
    pulse.connect(pulseGain); pulseGain.connect(g);
    pulse.start(t); lfo.start(t);

    this._ambient = { g, oscs, pulse, lfo };
  }

  stopAmbient() {
    if (this._musicEl) { this._musicEl.pause(); }
    if (!this._ambient) return;
    const t = this.ctx.currentTime;
    this._ambient.g.gain.setTargetAtTime(0, t, 0.4);
    const a = this._ambient;
    setTimeout(() => {
      for (const o of a.oscs) o.stop();
      a.pulse.stop(); a.lfo.stop();
    }, 800);
    this._ambient = null;
  }

  _startMusicFile() {
    if (!this._musicEl) {
      this._musicEl = new Audio(this._musicUrl);
      this._musicEl.loop = true;
      const src = this.ctx.createMediaElementSource(this._musicEl);
      src.connect(this.musicGain);
    }
    this._musicEl.play?.().catch(() => {});
    this._ambient = { file: true };
  }

  // ── 音效零件 ─────────────────────────────────────────
  _shot(time, { gain = 0.5, dur = 0.07, freq = 1700 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'highpass'; bp.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    src.start(time); src.stop(time + dur + 0.02);
    // 低頻 thump 增加身體感
    const o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(160, time);
    o.frequency.exponentialRampToValueAtTime(70, time + 0.05);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain * 0.5, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    o.connect(og); og.connect(this.sfxGain);
    o.start(time); o.stop(time + 0.1);
  }

  _boom(time, { gain = 0.8 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, time);
    lp.frequency.exponentialRampToValueAtTime(120, time + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.85);
    src.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    src.start(time); src.stop(time + 0.9);
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(90, time);
    o.frequency.exponentialRampToValueAtTime(34, time + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.7);
    o.connect(og); og.connect(this.sfxGain);
    o.start(time); o.stop(time + 0.75);
  }

  // ── 對外觸發 ─────────────────────────────────────────
  sfx(kind) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'gunfire':
        for (let i = 0; i < 4; i++) this._shot(t + Math.random() * 0.5, { gain: 0.32, freq: 1500 + Math.random() * 600 });
        break;
      case 'mg':
        for (let i = 0; i < 9; i++) this._shot(t + i * 0.055, { gain: 0.26, dur: 0.05, freq: 1300 });
        break;
      case 'assault':
        for (let i = 0; i < 8; i++) this._shot(t + Math.random() * 1.4, { gain: 0.3, freq: 1500 + Math.random() * 700 });
        this._boom(t + 0.6, { gain: 0.5 }); // 手榴彈
        this._boom(t + 1.1, { gain: 0.45 });
        break;
      case 'destroy':
      case 'explosion':
        this._boom(t, { gain: 0.85 });
        for (let i = 0; i < 3; i++) this._shot(t + 0.1 + Math.random() * 0.4, { gain: 0.2 });
        break;
      case 'flak':
        for (let i = 0; i < 6; i++) this._boom(t + Math.random() * 1.2, { gain: 0.22 });
        break;
      case 'reveal': {
        // 情報落差揭示:低沉緊張上揚音
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(150, t + 1.4);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 500;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
        o.start(t); o.stop(t + 1.9);
        break;
      }
    }
  }
}
