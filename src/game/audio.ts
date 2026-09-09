export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.42, this.ctx.currentTime, 0.03);
    }
  }

  private env(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, low = false) {
    if (!this.ctx || !this.master || this.muted) return;
    const n = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (low) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 380;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.master);
    src.start(t);
  }

  boom(big = false) {
    this.noise(big ? 0.55 : 0.32, big ? 0.7 : 0.45, true);
    this.env(big ? 90 : 140, 0.35, "sine", 0.5, big ? -60 : -80);
  }
  whoosh() {
    this.noise(0.18, 0.22, false);
    this.env(420, 0.16, "sawtooth", 0.08, -280);
  }
  tick() {
    this.env(880, 0.05, "square", 0.07);
  }
  splash() {
    this.noise(0.28, 0.3, true);
    this.env(240, 0.2, "triangle", 0.12, -120);
  }
  hurt() {
    this.env(220, 0.12, "square", 0.12, -80);
  }
  click() {
    this.env(620, 0.04, "square", 0.06);
  }
  jump() {
    this.env(280, 0.12, "square", 0.08, 140);
  }
  win() {
    this.env(523, 0.18, "sine", 0.16);
    this.env(659, 0.22, "sine", 0.14);
    this.env(784, 0.4, "sine", 0.14);
  }
  charge() {
    this.env(180, 0.06, "sine", 0.05);
  }
}
