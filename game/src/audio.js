// Synthesized sound effects: every sound is built from oscillators and
// filtered noise at runtime, so the game ships no audio files and makes no
// network request. The context is created on the first user gesture; all
// methods are safe to call before that (they no-op).
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  /** Call from a user gesture (Deploy click). Safe to call twice. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  /** Distance attenuation: 0 at the ear, 1 at maxDist and beyond. */
  _gainAt(dist, maxDist) {
    if (!this.ctx) return 0;
    if (dist === undefined || dist === null) return 0.9;
    return Math.max(0, 0.9 * (1 - dist / maxDist));
  }

  _noise(dur, filterType, freq, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, type, gain, slideTo = null, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(kind, dist) {
    const g = this._gainAt(dist, 55);
    if (!g) return;
    if (kind === 'scatter') {
      this._noise(0.28, 'lowpass', 900, g, 0);
      this._tone(140, 0.16, 'sine', g * 0.7, 55);
    } else if (kind === 'smg') {
      this._noise(0.09, 'bandpass', 1800, g * 0.8);
      this._tone(220, 0.07, 'square', g * 0.25, 90);
    } else if (kind === 'carbine') {
      this._noise(0.16, 'lowpass', 1400, g);
      this._tone(170, 0.12, 'sine', g * 0.6, 60);
    } else {
      this._noise(0.11, 'bandpass', 2200, g * 0.9);
      this._tone(260, 0.08, 'square', g * 0.2, 110);
    }
  }

  dryFire() { this._tone(1400, 0.03, 'square', 0.12); }
  reload() {
    this._tone(900, 0.04, 'square', 0.15);
    this._tone(600, 0.04, 'square', 0.15, null, 0.28);
    this._tone(1200, 0.05, 'square', 0.18, null, 0.55);
  }
  hit() { this._tone(1900, 0.05, 'sine', 0.25); }
  kill() {
    this._tone(880, 0.07, 'sine', 0.25);
    this._tone(1320, 0.1, 'sine', 0.25, null, 0.07);
  }
  hurt() {
    this._tone(180, 0.18, 'sawtooth', 0.3, 90);
    this._noise(0.12, 'lowpass', 500, 0.25);
  }
  step(dist) {
    const g = this._gainAt(dist, 18);
    if (g > 0.02) this._noise(0.06, 'lowpass', 300 + Math.random() * 120, g * 0.35);
  }
  grenadeThrow() { this._noise(0.15, 'bandpass', 900, 0.3); }
  explosion(dist) {
    const g = this._gainAt(dist, 90);
    if (!g) return;
    this._noise(1.1, 'lowpass', 320, g);
    this._tone(70, 0.9, 'sine', g * 0.9, 28);
  }
  beep(final = false) {
    this._tone(final ? 1560 : 1180, final ? 0.22 : 0.09, 'sine', 0.3);
  }
  plantTick() { this._tone(1050, 0.05, 'sine', 0.2); }
  roundStart() {
    this._tone(523, 0.12, 'triangle', 0.25);
    this._tone(784, 0.18, 'triangle', 0.25, null, 0.12);
  }
  roundWin() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.25, null, i * 0.11));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.22, null, i * 0.13));
  }
  buy() { this._tone(990, 0.06, 'sine', 0.2); this._tone(1320, 0.08, 'sine', 0.2, null, 0.06); }
  denied() { this._tone(220, 0.12, 'square', 0.2, 160); }
  defuse() { this._tone(700, 0.05, 'sine', 0.18); }
}
