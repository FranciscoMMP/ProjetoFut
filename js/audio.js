/* =============================================================================
   ÁUDIO — efeitos 16 bits e torcida, tudo gerado na hora pela Web Audio API (nenhum arquivo obrigatório).
     Efeitos : apito (curto / intervalo / fim), chute, trave, gol, clique.
     Torcida : ambiente em loop durante a partida (ruído filtrado) + comemoração forte no gol.
               Se existirem ./assets/audio/torcida-ambiente.mp3 e ./assets/audio/gol-torcida.mp3, eles são usados no lugar
               do ruído; se não existirem (ou falharem), o som gerado continua valendo, sem erro.
   O navegador só libera áudio após um gesto do usuário: o contexto é criado/retomado no primeiro clique, toque ou tecla.
   Preferência SOM: ON/OFF salva em localStorage ('nst_som').
   ============================================================================= */

const ARQ = { ambiente: './assets/audio/torcida-ambiente.mp3', gol: './assets/audio/gol-torcida.mp3' };
const KEY = 'nst_som';

const Som = {
  ctx: null, master: null, sfx: null, torc: null,
  ligado: true,
  buf: { ruido: null, ambiente: null, gol: null },   // ruido = gerado; ambiente/gol = MP3 opcionais (null se não existirem)
  amb: null,                                          // torcida ambiente tocando: { src, gain, filtro }
  _ultimo: {},                                        // anti-repetição por efeito (ex.: trave detectada em vários passos de física)
  _vigia: null,

  /* ------------------------------ Inicialização ------------------------------ */
  init() {
    try { this.ligado = localStorage.getItem(KEY) !== '0'; } catch (_) { this.ligado = true; }
    const destravar = () => { this.destravar(); };
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) window.addEventListener(ev, destravar, { capture: true, passive: true });
    // Clique: qualquer botão da interface (menus, Central, uniformes, transmissão)
    document.addEventListener('click', e => { if (e.target.closest('button, .mbtn, .pk-card, .kt-op')) this.clique(); }, true);
    document.addEventListener('visibilitychange', () => { if (this.ctx) document.hidden ? this.ctx.suspend() : this.ctx.resume(); });
    this.atualizarBotoes();
  },
  /** Cria (ou retoma) o AudioContext no primeiro gesto do usuário. Idempotente. */
  destravar() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.ligado ? 1 : 0; this.master.connect(this.ctx.destination);
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
      this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(comp);
      this.torc = this.ctx.createGain(); this.torc.gain.value = 0.9; this.torc.connect(comp);
      this.buf.ruido = this.ruidoRosa(3);
      this.carregarArquivos();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  /** MP3 opcionais: se não existirem, ficam null e o som gerado é usado. Nunca lança erro. */
  async carregarArquivos() {
    for (const [k, url] of Object.entries(ARQ)) {
      try {
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) continue;
        this.buf[k] = await this.ctx.decodeAudioData(await r.arrayBuffer());
        if (k === 'ambiente' && this.amb) { this.pararTorcida(true); this.vigiar(this._quer); }   // troca o ruído pelo arquivo
      } catch (_) { /* arquivo ausente ou inválido: segue com o som gerado */ }
    }
  },
  pronto() { return !!(this.ctx && this.ctx.state === 'running' && this.ligado); },

  /* ------------------------------ Liga / desliga ------------------------------ */
  setLigado(on) {
    this.ligado = !!on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    if (!on) this.pararTorcida();
    this.atualizarBotoes();
  },
  alternar() { this.destravar(); this.setLigado(!this.ligado); },
  atualizarBotoes() {
    for (const b of document.querySelectorAll('.som-btn')) {
      b.textContent = this.ligado ? 'SOM: ON' : 'SOM: OFF'; b.setAttribute('aria-pressed', this.ligado ? 'true' : 'false'); b.classList.toggle('off', !this.ligado);
    }
  },

  /* ------------------------------ Blocos de síntese ------------------------------ */
  ruidoRosa(seg) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seg), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
    for (let i = 0; i < n; i++) {                                   // filtro de Paul Kellet (ruído rosa)
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
    }
    const f = Math.floor(c.sampleRate * 0.05);                      // emenda suave para o loop não estalar
    for (let i = 0; i < f; i++) { const t = i / f; d[n - f + i] = d[n - f + i] * (1 - t) + d[i] * t; }
    return b;
  },
  /** Nota 16 bits: onda quadrada/pulso/triângulo com envelope curto. */
  nota(freq, ini, dur, { tipo = 'square', vol = 0.3, ate = null, destino = null } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + ini;
    o.type = tipo; o.frequency.setValueAtTime(freq, t); if (ate) o.frequency.exponentialRampToValueAtTime(ate, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(destino || this.sfx); o.start(t); o.stop(t + dur + 0.02);
  },
  /** Rajada de ruído filtrado (impacto, chiado). */
  rajada(ini, dur, { freq = 1200, q = 1, vol = 0.4, tipo = 'bandpass', destino = null } = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + ini;
    s.buffer = this.buf.ruido; f.type = tipo; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(destino || this.sfx); s.start(t, Math.random() * 2); s.stop(t + dur + 0.02);
  },
  podeTocar(nome, intervalo) {
    if (!this.pronto()) return false;
    const agora = this.ctx.currentTime; if (agora - (this._ultimo[nome] || -9) < intervalo) return false;
    this._ultimo[nome] = agora; return true;
  },

  /* ------------------------------ Efeitos ------------------------------ */
  /** Apito do árbitro: 'curto' (falta/recomeço), 'intervalo' (dois toques) ou 'fim' (três, o último longo). */
  apito(tipo = 'curto') {
    if (!this.podeTocar('apito', 0.25)) return;
    const toques = tipo === 'fim' ? [[0, 0.22], [0.32, 0.22], [0.64, 0.9]] : tipo === 'intervalo' ? [[0, 0.25], [0.36, 0.55]] : [[0, 0.32]];
    for (const [ini, dur] of toques) {
      const c = this.ctx, t = c.currentTime + ini, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 2350; lfo.type = 'square'; lfo.frequency.value = 32; lg.gain.value = 140;   // trinado do apito
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.015); g.gain.setValueAtTime(0.13, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    }
  },
  /** Chute: estalo de ruído + "tum" grave descendente. forca 0..1. */
  chute(forca = 0.7) {
    if (!this.podeTocar('chute', 0.08)) return;
    const f = Math.max(0.25, Math.min(1, forca));
    this.rajada(0, 0.07, { freq: 1800, q: 0.8, vol: 0.35 * f });
    this.nota(190 + 90 * f, 0, 0.13, { tipo: 'triangle', vol: 0.5 * f, ate: 55 });
  },
  /** Trave: "plim" metálico (duas ondas quadradas desafinadas, decaimento longo). */
  trave() {
    if (!this.podeTocar('trave', 0.3)) return;
    this.rajada(0, 0.05, { freq: 3500, q: 2, vol: 0.3 });
    for (const [fq, v] of [[880, 0.16], [1324, 0.1], [2210, 0.06]]) this.nota(fq, 0, 0.9, { tipo: 'square', vol: v, ate: fq * 0.985 });
  },
  /** Gol: fanfarra 16 bits + explosão da torcida. nosso = gol do seu time (comemoração mais longa e alta). */
  gol(nosso = true) {
    if (!this.pronto()) return;
    const notas = nosso ? [523, 659, 784, 1047, 784, 1047] : [392, 330, 262];
    notas.forEach((fq, i) => { this.nota(fq, i * 0.11, i === notas.length - 1 ? 0.5 : 0.14, { tipo: 'square', vol: 0.16 }); this.nota(fq / 2, i * 0.11, 0.12, { tipo: 'triangle', vol: 0.12 }); });
    this.comemoracao(nosso ? 1 : 0.55);
  },
  /** Clique de interface: blip curto. */
  clique() {
    if (!this.podeTocar('clique', 0.04)) return;
    this.nota(1320, 0, 0.045, { tipo: 'square', vol: 0.07, ate: 990 });
  },

  /* ------------------------------ Torcida ------------------------------ */
  /** Torcida ambiente em loop (MP3 se existir, senão ruído rosa filtrado com "ondas" lentas de volume). */
  tocarTorcida() {
    if (this.amb || !this.pronto()) return;
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), t = c.currentTime;
    const arquivo = this.buf.ambiente;
    s.buffer = arquivo || this.buf.ruido; s.loop = true;
    let ult = g;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(arquivo ? 0.5 : 0.11, t + 1.2);
    const nos = [s];
    if (!arquivo) {                                                  // ruído -> banda de vozes (300-2000 Hz) + ondas de volume
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const onda = c.createGain(); onda.gain.value = 1;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 0.3; lfo.connect(lg); lg.connect(onda.gain); lfo.start();
      s.connect(bp); bp.connect(lp); lp.connect(onda); onda.connect(g); nos.push(lfo);
    } else s.connect(g);
    ult.connect(this.torc); s.start(t, Math.random() * 2);
    this.amb = { src: s, gain: g, nos };
  },
  pararTorcida(rapido) {
    const a = this.amb; if (!a) return; this.amb = null;
    const c = this.ctx, t = c.currentTime;
    a.gain.gain.cancelScheduledValues(t); a.gain.gain.setValueAtTime(a.gain.gain.value, t); a.gain.gain.linearRampToValueAtTime(0, t + (rapido ? 0.05 : 0.6));
    for (const n of a.nos) try { n.stop(t + (rapido ? 0.08 : 0.7)); } catch (_) {}
  },
  /** Explosão da torcida no gol (MP3 se existir, senão ruído com envelope: sobe rápido, sustenta e cai). */
  comemoracao(intens = 1) {
    if (!this.pronto()) return;
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), t = c.currentTime, dur = 1.6 + 2.6 * intens;
    if (this.buf.gol) { s.buffer = this.buf.gol; s.connect(g); g.gain.setValueAtTime(0.9 * intens, t); s.start(t); g.connect(this.torc); return; }
    s.buffer = this.buf.ruido; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1300, t + 0.4); bp.Q.value = 0.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55 * intens, t + 0.25); g.gain.setValueAtTime(0.5 * intens, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(this.torc); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
    if (this.amb) { const a = this.amb.gain.gain; a.setTargetAtTime(0.2, t, 0.2); a.setTargetAtTime(this.buf.ambiente ? 0.5 : 0.11, t + dur, 0.8); }   // a torcida ambiente sobe junto
  },
  /** Liga a torcida enquanto quer() for verdadeiro (partida rolando); desliga fora dela (menu, Central, fim de jogo). */
  vigiar(quer) {
    this._quer = quer; clearInterval(this._vigia);
    this._vigia = setInterval(() => { const q = !!quer(); if (q && !this.amb) this.tocarTorcida(); else if (!q && this.amb) this.pararTorcida(); }, 250);
  },
};

export { Som };
