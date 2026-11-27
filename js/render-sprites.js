import { Util, CFG, M, Tactics } from './motor-campo.js';

/* =============================================================================
   APARÊNCIA + SPRITES PIXEL ART (ETAPA 4B)
   Troca os círculos por bonecos animados em pixel art retrô. NADA aqui mexe na física, nas colisões,
   nos controles ou na IA: tudo é leitura do estado dos jogadores (x, y, vx, vy, facing...) na hora de DESENHAR.

   Estrutura:
     Cores       : utilidades de cor (hex -> pacote RGBA, clarear/escurecer).
     Aparencia   : objeto de configuração visual de cada jogador (jogador.visual) + gerador automático.
                   { pele, cabeloEstilo, cabeloCor, barba, uniforme:{camisaPrimaria, camisaSecundaria, camisaTerciaria?, calcao, meiao, chuteira} }
                   >>> Para injetar jogadores reais depois: basta atribuir  jogador.visual = {...}  (ou passar `visual`
                   no spec do cenário: attackers[i].visual / defenders[i].visual). Campos faltando recebem valores padrão.
     Sprites     : monta cada pose do boneco como um pequeno modelo 3D de "voxels" (cabeça, tronco, braços, pernas
                   com cinemática inversa) projetado em baixa resolução e guarda em cache (nitidez de pixel art).
     Visual      : máquina de estados da animação (parado / corrida / lateral / chute / mergulho) + orientação.
     desenharJogador(ctx, jogador) : sombra + sprite, com imageSmoothingEnabled = false.
   ============================================================================= */

/* ------------------------------- Cores ------------------------------------ */
const Cores = {
  _rgb: new Map(), _u32: new Map(), _tint: new Map(),
  rgb(hex) {
    let c = this._rgb.get(hex);
    if (!c) {
      let h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, m => m + m);
      const n = parseInt(h, 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; this._rgb.set(hex, c);
    }
    return c;
  },
  /** Cor empacotada (ABGR little-endian, alfa 255) para escrever direto em Uint32Array/ImageData. */
  u32(hex) {
    let v = this._u32.get(hex);
    if (v === undefined) { const [r, g, b] = this.rgb(hex); v = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; this._u32.set(hex, v); }
    return v;
  },
  toHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); },
  /** amt > 0 clareia (em direção ao branco), amt < 0 escurece (em direção ao preto). */
  tint(hex, amt) {
    const k = hex + '|' + amt; let v = this._tint.get(k);
    if (!v) {
      const [r, g, b] = this.rgb(hex), t = amt > 0 ? 255 : 0, a = Math.abs(amt);
      v = this.toHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a); this._tint.set(k, v);
    }
    return v;
  },
  mix(h1, h2, t) { const a = this.rgb(h1), b = this.rgb(h2); return this.toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); },
  lum(hex) { const [r, g, b] = this.rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; },
};

/* ----------------------------- Aparência ---------------------------------- */
const Aparencia = {
  PELES: { claro: '#f3cfae', moreno: '#d9a273', pardo: '#b57a4d', negro: '#6b4126' },
  ESTILOS: ['curto', 'careca', 'black_power', 'moicano', 'longo'],
  CHUTEIRAS: ['#111827', '#f8fafc', '#f97316', '#22d3ee', '#a3e635', '#e11d48', '#facc15'],

  /** Uniformes-base. Meu time x Adversário x Goleiros têm cores bem distintas para leitura rápida no campo. */
  KITS: {
    us:     { camisaPrimaria: '#facc15', camisaSecundaria: '#15803d', padrao: 'lisa',       calcao: '#1d4ed8', meiao: '#f8fafc' },
    adv:    { camisaPrimaria: '#dc2626', camisaSecundaria: '#f8fafc', padrao: 'vertical',   calcao: '#111827', meiao: '#dc2626' },
    golAdv: { camisaPrimaria: '#7c3aed', camisaSecundaria: '#a3e635', padrao: 'faixa',      calcao: '#111827', meiao: '#7c3aed', luva: '#a3e635', mangaLonga: true, goleiro: true },
    golUs:  { camisaPrimaria: '#0ea5e9', camisaSecundaria: '#fde047', padrao: 'horizontal', calcao: '#0f172a', meiao: '#0ea5e9', luva: '#fde047', mangaLonga: true, goleiro: true },
  },

  /** Gerador pseudo-aleatório com semente (mesmo time + número = mesma aparência, sempre). */
  rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },
  sorteia(r, tab) { let x = r() * tab.reduce((s, e) => s + e[1], 0); for (const [v, w] of tab) { x -= w; if (x <= 0) return v; } return tab[0][0]; },

  /** Gera uma aparência variada (pele, cabelo, barba, chuteira) com o uniforme do `time` ('us' | 'adv' | 'golAdv' | 'golUs'). */
  gerar(time, num) {
    const r = this.rng(this.hash(time + '#' + num)), kit = this.KITS[time] || this.KITS.us, gol = !!kit.goleiro;
    const pele = this.sorteia(r, [['claro', .28], ['moreno', .22], ['pardo', .28], ['negro', .22]]);
    const forte = pele === 'negro' || pele === 'pardo';
    const estilo = this.sorteia(r, forte ? [['curto', .36], ['black_power', .26], ['careca', .12], ['moicano', .12], ['longo', .06]]
                                         : [['curto', .50], ['longo', .14], ['careca', .10], ['moicano', .12], ['black_power', .04]]);
    const base = forte ? ['#0b0b0b', '#16110d', '#26180f'] : ['#16110d', '#33200f', '#5a3a1c', '#8a5a2b', '#caa24a', '#a3451d'];
    let cor = base[Math.floor(r() * base.length)];
    if (r() < (estilo === 'moicano' ? 0.45 : 0.07)) cor = r() < 0.5 ? '#fde68a' : '#e5e7eb';        // descolorido
    const barba = r() < 0.28 ? (r() < 0.85 ? true : '#cbd5e1') : false;
    const chuteira = gol ? '#111827' : this.CHUTEIRAS[Math.floor(r() * this.CHUTEIRAS.length)];
    return { pele, cabeloEstilo: estilo, cabeloCor: cor, barba, uniforme: { ...kit, chuteira } };
  },

  /** Preenche o que faltar (útil para dados reais incompletos). pele aceita nome ('claro'...) ou hex. */
  completar(v) {
    v = v || {};
    const u = { ...this.KITS.us, chuteira: '#111827', ...(v.uniforme || {}) };
    const pele = v.pele && v.pele[0] === '#' ? v.pele : (this.PELES[v.pele] || this.PELES.moreno);
    const cabeloCor = v.cabeloCor || '#16110d';
    const barbaCor = v.barba ? (typeof v.barba === 'string' ? v.barba : Cores.tint(cabeloCor, -0.1)) : null;
    return { pele, cabeloEstilo: v.cabeloEstilo || 'curto', cabeloCor, barba: barbaCor, uniforme: u };
  },

  _chaves: new WeakMap(),
  /** Chave de cache do sprite (muda se a aparência ou o número mudar). Chame invalidar() ao editar jogador.visual. */
  chave(j) {
    let k = this._chaves.get(j.visual);
    if (!k) { const c = this.completar(j.visual); k = JSON.stringify([c.pele, c.cabeloEstilo, c.cabeloCor, c.barba, c.uniforme]); this._chaves.set(j.visual, k); }
    return k + '#' + j.num;
  },
  invalidar(j) { this._chaves.delete(j.visual); },
};

/* ------------------------------- Sprites ---------------------------------- */
/**
 * Cada pose vira um sprite 44x40 "pixels de arte" montado a partir de voxels (mini-3D) com z-buffer:
 *   - eixos do modelo: f = para frente, r = para a direita do boneco, z = para cima (1 unidade = 1 pixel de arte);
 *   - o modelo gira em 16 direções (22,5°) em volta do eixo vertical e é projetado numa visão 3/4 de cima;
 *   - braços e pernas usam cinemática inversa (joelho/cotovelo dobram sozinhos);
 *   - contorno escuro de 1 px + luz suave vinda de cima/esquerda.
 * O resultado é guardado em cache por (aparência, direção, pose, quadro), então desenhar custa só um drawImage.
 */
const Sprites = {
  W: 44, H: 40, AX: 22, AY: 33,      // tamanho do sprite e ponto de ancoragem (pés)
  PX: 1.5,                           // pixels do MUNDO por pixel de arte (boneco ~29 px de altura no mundo)
  K: 0.72, KZ: 0.95,                 // achatamento do chão e da altura na projeção 3/4
  PES_DY: 7,                         // pés ficam 7 px abaixo do centro do círculo de física (hitbox inalterada)
  cache: new Map(),

  FONTE: { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
           5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111' },

  obter(j) {
    const A = j.estadoAnim;
    const key = Aparencia.chave(j) + '|' + A.dir + '|' + A.kind + '|' + A.frame + '|' + A.amp + '|' + A.lat + '|' + A.extra;
    let s = this.cache.get(key);
    if (!s) { if (this.cache.size > 2500) this.cache.clear(); s = this.construir(j, A); this.cache.set(key, s); }
    return s;
  },

  /** Cinemática inversa de 2 ossos no plano (f, z). (pf, pz) = lado para onde a articulação prefere dobrar. */
  ik(hf, hz, tf, tz, L1, L2, pf, pz) {
    let dx = tf - hf, dz = tz - hz, d = Math.hypot(dx, dz) || 1e-3;
    const mx = L1 + L2 - 0.02;
    if (d > mx) { tf = hf + dx / d * mx; tz = hz + dz / d * mx; dx = tf - hf; dz = tz - hz; d = mx; }
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const ux = dx / d, uz = dz / d;
    let nx = -uz, nz = ux;
    if (nx * pf + nz * pz < 0) { nx = -nx; nz = -nz; }
    return { kf: hf + ux * a + nx * h, kz: hz + uz * a + nz * h, tf, tz };
  },

  /** Junta as posições-alvo (pés, mãos, altura do quadril, inclinação) de cada pose. */
  pose(A) {
    const HR = 1.9, SR = 4.3, TAU = Math.PI * 2;
    const feet = [{ f: 0, r: -HR - 0.6, z: 0 }, { f: 0, r: HR + 0.6, z: 0 }];
    const hands = [{ f: 2, r: -SR + 0.3, z: 9.6 }, { f: 2, r: SR - 0.3, z: 9.6 }];
    let hipZ = 8.2, lean = 0, pitch = 0;
    const cr = A.extra.includes('c');
    if (A.kind === 'parado') {                         // postura pronta + respiração (2 quadros)
      const br = A.frame ? 0.3 : 0;
      hipZ = 8.2 - br - (cr ? 1.5 : 0); lean = cr ? 0.9 : 0.15;
      feet[0].f = -0.9; feet[1].f = 0.9;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        if (cr) { feet[i].r += s * 0.9; hands[i].r = s * (SR + 1.4); hands[i].z = 10.2 - br; hands[i].f = 2.6; }
        else hands[i].z = 9.6 - br;
      }
      if (A.extra.includes('h')) { hands[0] = { f: 2.4, r: -1.5, z: 12.3 }; hands[1] = { f: 2.4, r: 1.5, z: 12.3 }; }   // goleiro com a bola
    } else if (A.kind === 'corrida') {                 // ciclo de 8 quadros; amplitude cresce com a velocidade
      const [Af, Az, Aa, drop, ln] = [[2.4, 1.2, 1.6, 0.1, 0.2], [3.8, 2.3, 2.8, 0.7, 0.7], [5.2, 3.4, 3.8, 1.5, 1.4]][A.amp];
      const ph = A.frame / 8 * TAU;
      hipZ = 8.2 - drop - (cr ? 0.6 : 0) + 0.35 * Math.cos(2 * ph); lean = ln;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, psi = ph + (i ? 0 : Math.PI);
        feet[i].f = Af * Math.cos(psi); feet[i].z = Az * Math.max(0, -Math.sin(psi)); feet[i].r = s * (HR + 0.3);
        hands[i].f = -Aa * Math.cos(psi) + 1.2; hands[i].z = 9.4 + 0.9 * Math.cos(psi); hands[i].r = s * (SR - 0.6);   // braço oposto à perna
      }
    } else if (A.kind === 'lateral') {                 // passada lateral do goleiro (corpo virado para a bola)
      const ph = A.frame / 8 * TAU;
      hipZ = 7.0; lean = 0.7;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, psi = ph + (i ? 0 : Math.PI);
        feet[i].r = s * (HR + 0.8) + A.lat * 2.6 * Math.cos(psi); feet[i].f = 0.2; feet[i].z = 1.6 * Math.max(0, -Math.sin(psi));
        hands[i] = { f: 1.8, r: s * (SR + 1.5) + A.lat * 0.9 * Math.cos(psi), z: 10.6 };
      }
    } else if (A.kind === 'chute') {                   // 6 quadros em ~260 ms: perna vai para trás e golpeia
      const kl = A.lat > 0 ? 1 : 0, sk = kl ? 1 : -1, fr = A.frame;
      const KF = [[-1.5, 0.5], [-5, 3.2], [1, 2], [6.2, 1.6], [7, 3.4], [3, 0.6]];
      lean = [-0.4, -0.8, 0.3, 1.5, 1.9, 0.8][fr]; hipZ = [8, 7.8, 7.6, 7.4, 7.6, 7.9][fr];
      feet[kl].f = KF[fr][0]; feet[kl].z = KF[fr][1]; feet[kl].r = sk * (HR + 0.5);
      feet[1 - kl].f = -0.7; feet[1 - kl].z = 0; feet[1 - kl].r = -sk * (HR + 1.0);
      hands[kl] = { f: -2.4 - (fr >= 3 ? 0.8 : 0), r: sk * (SR + 0.8), z: 9.8 };      // braço do lado da perna vai para trás
      hands[1 - kl] = { f: 2.8, r: -sk * (SR + 1.6), z: 11.4 };                         // o outro abre para a frente (equilíbrio)
    } else if (A.kind === 'mergulho') {                // goleiro esticado na horizontal (6 níveis de inclinação)
      pitch = [0.15, 0.45, 0.8, 1.1, 1.3, 1.42][A.frame];
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        feet[i].f = -0.8; feet[i].r = s * (HR + 0.5);
        hands[i] = { f: 0.6, r: s * 1.5, z: 22.2 };   // braços para cima; a inclinação os joga para a frente
      }
    }
    return { feet, hands, hipZ, lean, pitch };
  },

  /** Monta o sprite (offscreen) de uma pose: voxels -> z-buffer -> luz -> número -> contorno. */
  construir(j, A) {
    const V = Aparencia.completar(j.visual), U = V.uniforme, P = this.pose(A);
    const { W, H, AX, AY, K, KZ } = this;
    const th = A.dir * Math.PI / 8, co = Math.cos(th), si = Math.sin(th);
    const zb = new Float32Array(W * H).fill(-1e9), px = new Uint32Array(W * H);
    const pitch = P.pitch, cp = Math.cos(pitch), sp = Math.sin(pitch), lift = -6.4 * sp;
    const dz = P.hipZ - 8.2, ln = P.lean;

    /** Coloca um voxel (já com a inclinação do mergulho e o giro da direção) no z-buffer. */
    const add = (f, r, z, c) => {
      if (pitch) { const d = z - 10; const nf = f * cp + d * sp; z = -f * sp + d * cp + 10 + lift; f = nf; }
      const X = f * co - r * si, Y = f * si + r * co;
      const x = Math.round(AX + X), y = Math.round(AY + Y * K - z * KZ);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const dep = Y * 0.7 + z * 0.7, i = y * W + x;
      if (dep > zb[i]) { zb[i] = dep; px[i] = c; }
    };
    const lat = (h, st) => { const n = Math.max(1, Math.round(2 * h / st)), a = []; for (let i = 0; i <= n; i++) a.push(-h + 2 * h * i / n); return a; };
    const box = (cf, cr, cz, hf, hr, hz, col) => {
      const fn = typeof col === 'function';
      for (const a of lat(hf, 0.9)) for (const b of lat(hr, 0.9)) for (const c of lat(hz, 0.9)) add(cf + a, cr + b, cz + c, fn ? col(cf + a, cr + b, cz + c) : col);
    };
    const osso = (a, b, h, col) => {
      const n = Math.max(1, Math.ceil(Math.hypot(b.f - a.f, b.r - a.r, b.z - a.z) / 0.7)), O = lat(h, h);
      for (let i = 0; i <= n; i++) {
        const t = i / n, f = a.f + (b.f - a.f) * t, r = a.r + (b.r - a.r) * t, z = a.z + (b.z - a.z) * t, c = col(t);
        for (const x of O) for (const y of O) for (const w of O) add(f + x, r + y, z + w, c);
      }
    };

    const cu = Cores.u32.bind(Cores);
    const pele = cu(V.pele), pri = cu(U.camisaPrimaria), sec = cu(U.camisaSecundaria), ter = U.camisaTerciaria ? cu(U.camisaTerciaria) : sec,   // 3ª cor (opcional) para camisas tricolores
          calcao = cu(U.calcao), meia = cu(U.meiao), bota = cu(U.chuteira);
    const luva = U.luva ? cu(U.luva) : pele, manga = U.mangaLonga ? pri : pele;

    // ---- pernas (coxa -> canela -> chuteira) ----
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, ft = P.feet[i], hr = s * 1.9;
      const k = this.ik(0, P.hipZ, ft.f, ft.z, 4.3, 4.3, 1, 0);
      const Hp = { f: 0, r: hr, z: P.hipZ }, Kn = { f: k.kf, r: (hr + ft.r) / 2, z: k.kz }, Ft = { f: k.tf, r: ft.r, z: k.tz };
      osso(Hp, Kn, 0.9, t => t < 0.55 ? calcao : pele);
      osso(Kn, Ft, 0.85, t => t < 0.22 ? pele : meia);
      box(Ft.f + 1.0, Ft.r, Ft.z + 0.6, 1.9, 0.9, 0.6, bota);
    }
    // ---- calção e tronco (camisa com padrão, gola e punhos na cor secundária) ----
    box(ln * 0.3, 0, P.hipZ + 0.5, 1.6, 3.3, 1.3, calcao);
    const padrao = U.padrao;
    box(ln, 0, 11.6 + dz, 1.6, 3.5, 3.2, (f, r, z) => {
      if (z > 13.9 + dz && f > ln + 0.6 && Math.abs(r) < 1.7) return sec;                       // gola
      if (padrao === 'vertical') return (Math.floor((r + 3.6) / 1.2) & 1) ? sec : pri;
      if (padrao === 'horizontal') return (Math.floor((z - dz - 8.4) / 1.6) & 1) ? sec : pri;
      if (padrao === 'faixa') return Math.abs(r * 0.9 + (z - dz - 11.6)) < 1.0 ? sec : pri;
      if (padrao === 'peito') return Math.abs(z - dz - 12.6) < 0.75 ? sec : pri;               // uma faixa horizontal no peito (Coritiba...)
      if (padrao === 'peito2') { const zz = z - dz; return Math.abs(zz - 13.0) < 0.55 ? sec : Math.abs(zz - 11.9) < 0.55 ? ter : pri; }   // duas faixas no peito (São Paulo)
      if (padrao === 'tricolor') return [pri, sec, ter][((Math.floor((r + 3.6) / 1.2) % 3) + 3) % 3];   // listras verticais de 3 cores (Fluminense, Grêmio...)
      return pri;
    });
    box(ln * 1.2, 0, 15.1 + dz, 0.8, 0.8, 0.8, pele);                                             // pescoço
    // ---- braços (manga -> antebraço -> mão/luva) ----
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, hd = P.hands[i];
      const sh = { f: ln, r: s * 4.3, z: 13.6 + dz }, hand = { f: hd.f + ln, r: hd.r, z: hd.z + dz };
      const LA = A.kind === 'mergulho' ? 3.9 : 3.3;                                  // no mergulho o braço fica bem esticado
      const k = this.ik(sh.f, sh.z, hand.f, hand.z, LA, LA, 0, -1);
      const el = { f: k.kf, r: (sh.r + hand.r) / 2, z: k.kz }, hn = { f: k.tf, r: hand.r, z: k.tz };
      osso(sh, el, 0.95, t => t > 0.78 ? sec : pri);
      osso(el, hn, 0.85, () => manga);
      box(hn.f, hn.r, hn.z, 0.9, 0.9, 0.9, luva);
    }
    // ---- cabeça: pele, olhos, barba ----
    const hcf = ln * 1.4 + 0.3, hcz = 17.8 + dz, olho = cu('#14141a'), barbaC = V.barba ? cu(V.barba) : 0;
    for (const a of lat(2.7, 0.6)) for (const b of lat(2.7, 0.6)) for (const c of lat(2.7, 0.6)) {
      const rho = Math.hypot(a, b, c); if (rho > 2.8) continue;
      let col = pele;
      if (a > 1.9 && Math.abs(Math.abs(b) - 0.9) < 0.5 && Math.abs(c - 0.4) < 0.5) col = olho;
      else if (barbaC && c < -0.5 && a > -0.8 && rho > 2.1) col = barbaC;
      add(hcf + a, b, hcz + c, col);
    }
    // ---- cabelo (cada estilo é uma região em volta da cabeça) ----
    const est = V.cabeloEstilo, hc = cu(V.cabeloCor), HG = lat(4.5, 0.6);
    if (est !== 'careca') for (const a of HG) for (const b of HG) for (const c of HG) {
      const rho = Math.hypot(a, b, c);
      let ok = false, col = hc;
      const cap = rho >= 2.55 && rho <= 3.3 && ((c > 0.9 && !(a > 1.7 && c < 2.0)) || (a < -0.8 && c > -1.5));
      if (est === 'curto') ok = cap;
      else if (est === 'longo') ok = cap || (a < -2.0 && a > -3.6 && Math.abs(b) <= 2.9 && c > -4.9 && c <= 1.5) ||
                                      (Math.abs(b) >= 2.4 && Math.abs(b) <= 3.3 && a > -2.4 && a < 0.6 && c > -3 && c < 1.5 && rho >= 2.5 && rho <= 3.6);
      else if (est === 'black_power') { const e = Math.hypot(a + 0.2, b, c - 0.7); ok = e >= 2.4 && e <= 4.4 && c > -1.8 && !(a > 1.4 && c < 1.8 && Math.abs(b) < 2.7); }
      else if (est === 'moicano') {
        if (Math.abs(b) <= 0.8 && a >= -3.2 && a <= 2.6 && c >= 1.6 && c <= Math.sqrt(Math.max(0, 11.5 - a * a * 0.9)) + 1.0) ok = true;
        else if (rho >= 2.7 && rho <= 3.0 && c > 0.6 && Math.abs(b) > 0.8) { ok = true; col = cu(Cores.mix(V.pele, V.cabeloCor, 0.35)); }   // laterais raspadas
      }
      if (ok) add(hcf + a, b, hcz + c, col);
    }

    // ---- composição: luz + pixels ----
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H), out = new Uint32Array(img.data.buffer);
    const lim = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
    const shade = (c, x, y) => {
      const s = 1 + Util.clamp(-(x - AX) * 0.022 - (y - AY + 12) * 0.010, -0.14, 0.14);
      return ((255 << 24) | (lim((c >> 16 & 255) * s) << 16) | (lim((c >> 8 & 255) * s) << 8) | lim((c & 255) * s)) >>> 0;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (zb[i] > -1e8) out[i] = shade(px[i], x, y); }

    // número da camisa NAS COSTAS (só quando o boneco está de costas para a câmera)
    if (!pitch && j.num != null && -si > 0.5) {
      const txt = String(j.num), w = txt.length * 4 - 1;
      const bx = Math.round(AX + (ln - 1.7) * co), by = Math.round(AY + (ln - 1.7) * si * K - (11.4 + dz) * KZ);
      const left = bx - (w >> 1), top = by - 2;
      const dig = cu(Cores.lum(U.camisaPrimaria) > 0.55 ? '#111827' : '#ffffff'), patch = padrao !== 'lisa';
      if (patch) for (let y = top - 1; y <= top + 5; y++) for (let x = left - 1; x <= left + w; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && zb[y * W + x] > -1e8) out[y * W + x] = shade(pri, x, y);
      }
      for (let n = 0; n < txt.length; n++) {
        const gl = this.FONTE[txt[n]]; if (!gl) continue;
        for (let k = 0; k < 15; k++) if (gl[k] === '1') {
          const x = left + n * 4 + (k % 3), y = top + ((k / 3) | 0);
          if (x >= 0 && y >= 0 && x < W && y < H && zb[y * W + x] > -1e8) out[y * W + x] = dig;
        }
      }
    }
    // contorno escuro de 1 px em volta de tudo
    const OUT = ((225 << 24) | (0x16 << 16) | (0x10 << 8) | 0x0c) >>> 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (zb[i] > -1e8) continue;
      if ((x > 0 && zb[i - 1] > -1e8) || (x < W - 1 && zb[i + 1] > -1e8) || (y > 0 && zb[i - W] > -1e8) || (y < H - 1 && zb[i + W] > -1e8)) out[i] = OUT;
    }
    g.putImageData(img, 0, 0);
    return { cv };
  },
};

/* --------------------------- Estados da animação --------------------------- */
const Visual = {
  novoEstado() { return { yaw: null, dir: 0, kind: 'parado', frame: 0, amp: 0, lat: 0, extra: '', ph: 0, t: Math.random() * 4, kick: null }; },

  /** Dispara a animação de chute (~260 ms, em tempo real). `curva` < 0 usa a perna esquerda. Só visual: não altera a bola. */
  /** Pulo curto (cabeçada): sobe e desce em ~0,45 s. Só visual. */
  salto(e) { if (e && e.estadoAnim) e.estadoAnim.salto = { t: 0, dur: 0.45 }; },
  chute(e, curva = 0) { if (e && e.estadoAnim) e.estadoAnim.kick = { t: 0, dur: 0.26, lado: curva < 0 ? -1 : 1 }; },

  /**
   * Atualiza a pose de um jogador a cada quadro de DESENHO (dt = tempo real, sim = tempo simulado, que respeita a câmera lenta).
   * tipo: 'atacante' | 'zagueiro' | 'goleiro'. A corrida usa a velocidade real do jogador (e.vx/e.vy).
   */
  atualizar(e, tipo, game, dt, sim) {
    const A = e.estadoAnim; if (!A) return;
    const TAU = Math.PI * 2, gk = tipo === 'goleiro';
    const pausado = game.menuOpen || !!game.trans || (game.match && game.match.over);
    const vx = pausado ? 0 : (e.vx || 0), vy = pausado || gk ? 0 : (e.vy || 0);       // o goleiro só desliza no eixo x
    const sp = Math.hypot(vx, vy);
    A.t += dt;
    if (A.kick) { A.kick.t += dt; if (A.kick.t >= A.kick.dur) A.kick = null; }
    if (A.salto) { A.salto.t += dt; if (A.salto.t >= A.salto.dur) A.salto = null; }

    // --- qual animação? ---
    const mov = sp > 40 || (sp > 22 && (A.kind === 'corrida' || A.kind === 'lateral'));
    let kind = 'parado';
    if (A.kick) kind = 'chute';
    else if (gk && e.anim > 0.03) kind = 'mergulho';
    else if (mov) kind = gk ? 'lateral' : 'corrida';

    // --- para onde o corpo olha? (correndo: direção da corrida; mirando: direção do chute; senão: para onde olha) ---
    let alvo = e.facing;
    if (kind === 'mergulho') alvo = e.dir >= 0 ? 0 : Math.PI;
    else if (kind !== 'chute' && !gk && sp > 30) alvo = Math.atan2(vy, vx);
    else if (kind !== 'chute' && e === game.player && game.aim) { const s = game.computeShot(); if (s) alvo = Math.atan2(s.uy, s.ux); }
    if (A.yaw === null) A.yaw = alvo;
    A.yaw += Util.wrapAngle(alvo - A.yaw) * (1 - Math.exp(-(kind === 'mergulho' ? 24 : 14) * dt));
    A.dir = ((Math.round(A.yaw / (TAU / 16)) % 16) + 16) % 16;

    // --- quadro da animação ---
    A.lat = 0; A.amp = 0; A.extra = '';
    if (kind === 'corrida' || kind === 'lateral') {
      A.ph += sp * sim * (kind === 'lateral' ? 0.17 : 0.13);                          // passada proporcional à velocidade
      A.frame = Math.floor((((A.ph / TAU) % 1) + 1) % 1 * 8);
      A.amp = sp < 80 ? 0 : sp < 115 ? 1 : 2;
      if (kind === 'lateral') { const d = vx * -Math.sin(A.yaw) + vy * Math.cos(A.yaw); A.lat = d < 0 ? -1 : 1; }
    } else if (kind === 'chute') {
      A.frame = Math.min(5, Math.floor(A.kick.t / A.kick.dur * 6)); A.lat = A.kick.lado;
    } else if (kind === 'mergulho') {
      A.frame = Math.min(5, Math.round(e.anim * 5));
    } else {
      A.frame = (A.t * 1.6) % 1 < 0.5 ? 0 : 1;                                        // respiração
      if (gk) A.extra = (game.ball.state === 'held' ? 'h' : '') + (e.state === 'react' || e.state === 'dive' ? 'c' : '');
    }
    A.kind = kind;
  },
};

/** Desenha um jogador (sombra suave + sprite pixel art). Precisa de jogador.visual e jogador.estadoAnim. */
function desenharJogador(ctx, jogador) {
  const A = jogador.estadoAnim; if (!A) return;
  const m = ctx.getTransform(), sc = m.a, fx = jogador.x, fy = jogador.y + Sprites.PES_DY;
  const mer = A.kind === 'mergulho', rx = mer ? 15 : 8, ry = mer ? 4.4 : 3.6;
  ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.ellipse(fx, fy, rx + 2, ry + 1.3, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.20)'; ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, 0, 0, 6.2832); ctx.fill();

  const spr = Sprites.obter(jogador);
  const v = Sprites.PX * sc, art = v >= 3 ? Math.round(v) : v;      // telas grandes: pixel inteiro; telas pequenas: escala exata
  const w = Math.round(Sprites.W * art), h = Math.round(Sprites.H * art);
  const pulo = A.salto ? Math.sin(Math.PI * A.salto.t / A.salto.dur) * 9 : 0;                 // cabeçada: o boneco sobe, a sombra fica no chão
  const dx = Math.round(m.a * fx + m.e - Sprites.AX * art), dy = Math.round(m.d * (fy - pulo) + m.f - Sprites.AY * art);
  if (dx > ctx.canvas.width || dy > ctx.canvas.height || dx + w < 0 || dy + h < 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;                                 // pixels nítidos (sem borrar)
  ctx.drawImage(spr.cv, dx, dy, w, h);
  ctx.restore();
}



/* ------------------------------- Estádio (ambientação) ------------------------------- */
/**
 * Arquibancadas com torcida, placas de publicidade e faixas nas cores do MANDANTE (setor visitante menor, com as cores do visitante).
 * Tudo fica FORA das linhas do campo, a partir de 1,6 m (26 px), na margem que a câmera já mostrava: não cobre jogadores, bola,
 * linhas, rede nem a área de mira; no celular só aparece quando o lance chega perto da lateral ou do fundo.
 * Desenho barato (60 FPS): ladrilhos pré-renderizados viram padrões de canvas; a torcida "pula" alternando 2 quadros.
 */
const Estadio = {
  ALT: 4,                                   // resolução dos ladrilhos: pixels de arte por px do mundo
  PLACA: 26, PLACA_H: 8, ARQ: 44,           // distância linha -> placa, altura da placa, início da arquibancada (px do mundo)
  PELES: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac'],
  cfg: null, _pat: new Map(),
  /** casa / fora = { sg, cores: [principal, secundária, terceira?] }. Refaz os ladrilhos só quando os times mudam. */
  montar(casa, fora) {
    const k = JSON.stringify([casa, fora]); if (this.cfg && this.cfg.k === k) return;
    this._pat.clear();
    this.cfg = { k, casa, fora, torCasa: [0, 1].map(q => this.torcida(casa.cores, q)), torFora: [0, 1].map(q => this.torcida(fora.cores, q)),
                 placa: this.placa(casa), faixa: this.faixa(casa.cores) };
  },
  rnd(seed) { let s = seed | 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) | 0, ((s >>> 8) & 0xffff) / 65536); },
  tela(w, h) { const cv = document.createElement('canvas'); cv.width = w * this.ALT; cv.height = h * this.ALT; const g = cv.getContext('2d'); g.scale(this.ALT, this.ALT); return [cv, g]; },
  /** Ladrilho de torcida (96 x 48 do mundo): degraus de concreto e torcedores com a camisa do time. quadro 1 = metade pulando, braços erguidos. */
  torcida(cores, quadro) {
    const W = 96, H = 48, [cv, g] = this.tela(W, H), r = this.rnd(97 + cores.join('').charCodeAt(3) * 31);
    for (let y = 0; y < H; y += 8) { g.fillStyle = '#1b2027'; g.fillRect(0, y, W, 8); g.fillStyle = '#29303a'; g.fillRect(0, y + 7, W, 1); }
    for (let y = 0; y < H; y += 8) for (let x = 1; x < W; x += 4) {
      const vazio = r(), jx = r() < 0.5 ? 0 : 1, qc = r(), qc2 = r(), pele = this.PELES[Math.floor(r() * this.PELES.length)], pula = r() < 0.5, braco = r() < 0.18;
      if (vazio < 0.1) continue;
      const cor = qc < 0.7 ? cores[0] : qc2 < 0.6 ? (cores[1] || cores[0]) : (cores[2] || cores[1] || cores[0]), dy = quadro && pula ? -1 : 0;
      g.fillStyle = cor; g.fillRect(x + jx, y + 3 + dy, 3, 3);
      g.fillStyle = pele; g.fillRect(x + jx + 0.5, y + 1 + dy, 2, 2);
      if (quadro && braco) { g.fillStyle = cor; g.fillRect(x + jx - 1, y + dy, 1, 3); g.fillRect(x + jx + 3, y + dy, 1, 3); }
    }
    g.fillStyle = 'rgba(9,11,14,0.5)'; g.fillRect(0, 0, W, H);       // véu escuro já no ladrilho: o campo continua sendo o destaque
    return cv;
  },
  /** Placa de publicidade (120 x 8): cor do mandante, sigla e estrela na cor de maior contraste. */
  placa(casa) {
    const W = 120, H = this.PLACA_H, [cv, g] = this.tela(W, H), [a, b] = casa.cores, txt = Cores.lum(a) > 0.55 ? '#111827' : '#ffffff';
    g.fillStyle = a; g.fillRect(0, 0, W, H);
    g.fillStyle = b && b !== a ? b : txt; g.fillRect(0, 0, W, 1); g.fillRect(0, H - 1, W, 1);
    g.fillStyle = txt; g.font = '700 5.4px "Chakra Petch", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(casa.sg, 30, H / 2 + 0.3); g.fillText('★', 60, H / 2 + 0.2); g.fillText(casa.sg, 90, H / 2 + 0.3);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(W - 1, 0, 1, H);
    return cv;
  },
  /** Faixa de torcida (listras nas cores do time), pendurada no alambrado atrás do gol. */
  faixa(cores) {
    const W = 44, H = 10, [cv, g] = this.tela(W, H), cs = cores.filter(Boolean);
    const n = Math.max(2, cs.length), lw = W / (n * 2);
    for (let i = 0; i < n * 2; i++) { g.fillStyle = cs[i % cs.length]; g.fillRect(i * lw, 0, lw + 0.2, H); }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, H - 1.2, W, 1.2);
    return cv;
  },
  pat(g, cv, rot) {
    const k = cv; let p = this._pat.get(k) && this._pat.get(k)[rot ? 1 : 0];
    if (!p) {
      p = g.createPattern(cv, 'repeat'); const m = new DOMMatrix().scaleSelf(1 / this.ALT, 1 / this.ALT);
      p.setTransform(rot ? new DOMMatrix().rotateSelf(90).scaleSelf(1 / this.ALT, 1 / this.ALT) : m);
      const par = this._pat.get(k) || []; par[rot ? 1 : 0] = p; this._pat.set(k, par);
    }
    return p;
  },
  /** festa = { casa, fora }: a torcida desse lado pula mais rápido (gol). */
  desenhar(g, R, t, festa) {
    const c = this.cfg; if (!c) return;
    const F = CFG.FIELD, hw = R.w / R.s / 2, hh = R.h / R.s / 2;
    const x0 = R.cam.x - hw - 2, x1 = R.cam.x + hw + 2, y0 = R.cam.y - hh - 2, y1 = R.cam.y + hh + 2;
    const P = this.PLACA, PH = this.PLACA_H, A = this.ARQ;
    if (x0 > -P && x1 < F.w + P && y0 > -P) return;                 // nada do estádio na tela (o comum no celular)
    const qc = festa.casa ? Math.floor(t / 110) & 1 : Math.floor(t / 430) & 1, qf = festa.fora ? Math.floor(t / 110) & 1 : Math.floor((t + 170) / 430) & 1;
    const fy0 = F.bottom * 0.28, fy1 = F.bottom * 0.5;              // setor visitante: lateral direita
    g.save(); g.imageSmoothingEnabled = false;
    const area = (pat, ax0, ay0, ax1, ay1) => {
      ax0 = Math.max(ax0, x0); ay0 = Math.max(ay0, y0); ax1 = Math.min(ax1, x1); ay1 = Math.min(ay1, y1);
      if (ax1 > ax0 && ay1 > ay0) { g.fillStyle = pat; g.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0); }
    };
    const casa = this.pat(g, c.torCasa[qc]), fora = this.pat(g, c.torFora[qf]), BIG = 4000;
    // arquibancadas: fundo (atrás do gol), esquerda, direita (com o setor visitante)
    area(casa, -BIG, -BIG, F.w + BIG, -A);
    area(casa, -BIG, -A, -A, BIG);
    area(casa, F.w + A, -A, F.w + BIG, fy0); area(fora, F.w + A, fy0, F.w + BIG, fy1); area(casa, F.w + A, fy1, F.w + BIG, BIG);
    // separação do setor visitante
    g.fillStyle = '#9aa4ae'; area(g.fillStyle, F.w + A, fy0 - 1, F.w + BIG, fy0 + 1); area(g.fillStyle, F.w + A, fy1 - 1, F.w + BIG, fy1 + 1);
    // alambrado (linha escura) na frente da arquibancada
    g.fillStyle = '#0d1114';
    area(g.fillStyle, -A - 2, -A - 2, F.w + A + 2, -A); area(g.fillStyle, -A - 2, -A, -A, BIG); area(g.fillStyle, F.w + A, -A, F.w + A + 2, BIG);
    // faixas da torcida penduradas no alambrado, dos dois lados do gol
    const fx = this.pat(g, c.faixa);
    for (const cx of [F.w / 2 - 230, F.w / 2 + 186]) {
      if (cx + 44 < x0 || cx > x1 || -A - 11 > y1 || -A - 1 < y0) continue;     // fora da tela
      g.save(); g.translate(cx, -A - 11); g.fillStyle = fx; g.fillRect(0, 0, 44, 10); g.restore();
    }
    // placas de publicidade (em volta do campo, a 1,6 m das linhas)
    const pv = this.pat(g, c.placa), ph = this.pat(g, c.placa, true);
    area(pv, -P - PH, -P - PH, F.w + P + PH, -P);
    area(ph, -P - PH, -P, -P, BIG); area(ph, F.w + P, -P, F.w + P + PH, BIG);
    g.restore();
  },
};

/* -------------------------------- Renderização ----------------------------- */
class Renderer {
  constructor(canvas, stage) {
    this.canvas = canvas; this.stage = stage; this.ctx = canvas.getContext('2d');
    this.s = 1; this.dpr = 1; this.w = 1; this.h = 1;
    this.zoom = 1;                              // 1 = normal; maior = bonecos maiores (menos campo visível)
    try { const z = parseFloat(localStorage.getItem('nst_zoom')); this.zoom = z > 0 ? z : (window.innerWidth < 700 ? 1.3 : 1); } catch (_) { this.zoom = window.innerWidth < 700 ? 1.3 : 1; }   // celular: já abre com zoom
    this.cam = { x: CFG.FIELD.w / 2, y: CFG.START.y };
    this.net = { imp: null, was: false };      // impacto da bola na rede (animação visual)
    this.vb = { x: 0, y: 0, off: null };        // bola VISUAL: posição desenhada (nos pés) — a física da bola não muda
    this.spot = { id: -1, f: 0 };  // destaque do portador da bola no início do lance
    new ResizeObserver(() => this.resize()).observe(stage);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, this.stage.clientWidth);
    this.h = Math.max(1, this.stage.clientHeight);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.sBase = Math.min(this.w / CFG.CAM_VIS_W, this.h / CFG.CAM_VIS_H) * this.zoom;   // só muda a vista: a física não depende da escala
    this.s = this.sBase;   // o zoom do escanteio (setZoom) é reaplicado suavemente a cada quadro
  }
  toWorld(cx, cy) {
    return { x: (cx - this.w / 2) / this.s + this.cam.x, y: (cy - this.h / 2) / this.s + this.cam.y };
  }
  setWorld(ctx) {
    const { dpr, s } = this;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.w / 2 - this.cam.x * s), dpr * (this.h / 2 - this.cam.y * s));
  }

  /* ----- Câmera dinâmica ----- */
  camTarget(game) {
    const f = (game.ball.state === 'free' || game.ball.state === 'held') ? game.ball : game.player, F = CFG.FIELD;
    const visW = this.w / this.s, visH = this.h / this.s, hw = visW / 2, hh = visH / 2;
    const st = game.strike ? 1 : 0;
    let tx = f.x, ty = f.y - (st ? 0.3 : CFG.CAM_LOOKAHEAD) * visH;

    if (!st && (game.ball.state === 'carried' || game.pass)) {
      const b = game.ball, pad = CFG.CAM_PAD;
      let x0 = b.x, x1 = b.x, y0 = b.y, y1 = b.y;
      for (const a of game.attackers) {
        x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y);
      }
      const loX = x1 + pad - hw, hiX = x0 - pad + hw, loY = y1 + pad - hh, hiY = y0 - pad + hh;
      tx = loX <= hiX ? Util.clamp(tx, loX, hiX) : (loX + hiX) / 2;
      ty = loY <= hiY ? Util.clamp(ty, loY, hiY) : (loY + hiY) / 2;
      // Enquadrar os companheiros é só "o melhor possível": a bola e o jogador controlado SEMPRE ficam na tela
      const v = this.mustSee(game, hw, hh);
      tx = Util.clamp(tx, v.loX, v.hiX); ty = Util.clamp(ty, v.loY, v.hiY);
    }
    // O GOL TEM QUE APARECER: com a bola no pé (ou na mira/chute), sobe a vista até enquadrar o gol, desde que a bola e o
    // jogador continuem na tela com folga. Se ainda estiverem longe demais para caber os dois, vale a câmera normal.
    if (st || game.ball.state === 'carried' || game.pass) {
      const goalTy = hh - (CFG.GOAL.depth + 24), minTy = this.mustSee(game, hw, hh).loY;
      if (goalTy >= minTy) ty = Math.min(ty, goalTy);
    }
    const minX = hw - 40, maxX = F.w - hw + 40, minY = -70 + hh - st * 0.3 * visH, maxY = F.bottom + 40 - hh;
    tx = minX > maxX ? F.w / 2 : Util.clamp(tx, minX, maxX);
    ty = minY > maxY ? (minY + maxY) / 2 : Util.clamp(ty, minY, maxY);
    // ESPAÇO PARA MIRAR: o estilingue puxa até MAX_PULL (150 px do mundo) para qualquer lado, então com a bola no pé ela precisa ficar a
    // pelo menos CFG.AIM_MARGIN da borda da tela (no escanteio, a bola está colada na linha). Esta regra vence o limite do campo:
    // a câmera pode mostrar um pouco de fora do campo. Se a tela for pequena demais para o eixo, centraliza naquele eixo.
    if (!st && game.ball.state === 'carried' && !game.locked) {
      const b = game.ball, m = CFG.AIM_MARGIN;
      tx = hw > m ? Util.clamp(tx, b.x - hw + m, b.x + hw - m) : b.x;
      ty = hh > m ? Util.clamp(ty, b.y - hh + m, b.y + hh - m) : b.y;
    }
    return { x: tx, y: ty };
  }
  /** Faixa de centros de câmera em que a bola, o portador (e o receptor de um passe) ficam visíveis com folga. */
  mustSee(game, hw, hh) {
    const pts = [game.ball, game.player]; if (game.pass) pts.push(game.pass.receiver);
    const px = 44, pyTop = 60, pyBot = 80;                       // folga (px): embaixo maior por causa do texto de dica
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const loX = x1 + px - hw, hiX = x0 - px + hw, loY = y1 + pyBot - hh, hiY = y0 - pyTop + hh;
    return { loX: loX <= hiX ? loX : (loX + hiX) / 2, hiX: loX <= hiX ? hiX : (loX + hiX) / 2,
             loY: loY <= hiY ? loY : (loY + hiY) / 2, hiY: loY <= hiY ? hiY : (loY + hiY) / 2 };
  }
  /** Escanteio em tela estreita (celular): afasta a câmera para caber a área e ainda sobrar espaço para o estilingue. */
  setZoom(game) { return game && game.corner && this.w < 700 ? 0.6 : 1; }
  snapCamera(game) { this.s = this.sBase * this.setZoom(game); const t = this.camTarget(game); this.cam.x = t.x; this.cam.y = t.y; }
  updateCamera(game, dt) {
    this.s += (this.sBase * this.setZoom(game) - this.s) * (1 - Math.exp(-5 * dt));   // zoom suave (escanteio no celular)
    const t = this.camTarget(game);
    const k = 1 - Math.exp(-(game.ball.state === 'free' ? CFG.CAM_FOLLOW_BALL : CFG.CAM_FOLLOW) * dt);
    this.cam.x += (t.x - this.cam.x) * k; this.cam.y += (t.y - this.cam.y) * k;
    if (!game.strike) {                                          // a suavização nunca deixa a bola sair da vista
      const hw = this.w / this.s / 2, hh = this.h / this.s / 2, b = game.ball;
      this.cam.x = Util.clamp(this.cam.x, b.x + 44 - hw, b.x - 44 + hw);
      this.cam.y = Util.clamp(this.cam.y, b.y + 80 - hh, b.y - 60 + hh);
    }
  }

  /** Gol do seu time no lance: a torcida do seu lado (casa ou visitante) comemora. */
  festa(game) { const g = !!(game.scored && game.goalCounted); return { casa: g && !game.fora, fora: g && !!game.fora }; }

  /* ----- Campo ----- */
  drawPitch(g) {
    const F = CFG.FIELD, G = CFG.GOAL, cx = F.w / 2, gl = cx - G.w / 2;
    const hw = this.w / this.s / 2, hh = this.h / this.s / 2;
    const x0 = this.cam.x - hw - 2, x1 = this.cam.x + hw + 2, y0 = this.cam.y - hh - 2, y1 = this.cam.y + hh + 2;
    const band = 100;
    for (let y = Math.floor(y0 / band) * band; y < y1; y += band) {
      g.fillStyle = (Math.round(y / band) & 1) ? '#2f8a43' : '#38a04e';
      g.fillRect(x0, y, x1 - x0, band + 0.6);
    }
    g.fillStyle = 'rgba(0,20,8,0.32)';
    g.beginPath(); g.rect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10); g.rect(0, 0, F.w, F.bottom); g.fill('evenodd');
    g.strokeStyle = 'rgba(255,255,255,0.93)'; g.fillStyle = 'rgba(255,255,255,0.93)'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, F.bottom); g.lineTo(0, 0); g.lineTo(F.w, 0); g.lineTo(F.w, F.bottom); g.stroke();
    g.beginPath(); g.moveTo(0, F.midY); g.lineTo(F.w, F.midY); g.stroke();
    g.beginPath(); g.arc(cx, F.midY, CFG.ARC_R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, F.midY, 4, 0, Math.PI * 2); g.fill();
    g.strokeRect(cx - CFG.BOX.w / 2, 0, CFG.BOX.w, CFG.BOX.h);
    g.strokeRect(cx - CFG.SIX.w / 2, 0, CFG.SIX.w, CFG.SIX.h);
    g.beginPath(); g.arc(cx, CFG.SPOT_Y, 4, 0, Math.PI * 2); g.fill();
    const a = Math.asin((CFG.BOX.h - CFG.SPOT_Y) / CFG.ARC_R);
    g.beginPath(); g.arc(cx, CFG.SPOT_Y, CFG.ARC_R, a, Math.PI - a); g.stroke();
    g.beginPath(); g.arc(0, 0, M, 0, Math.PI / 2); g.stroke();
    g.beginPath(); g.arc(F.w, 0, M, Math.PI / 2, Math.PI); g.stroke();
    if (y0 < 5) {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(gl, -G.depth, G.w, G.depth);      // fundo escuro do gol (a rede é desenhada depois, por cima da bola)
      g.strokeStyle = '#fff'; g.lineWidth = 3.5;
      g.beginPath(); g.moveTo(gl, 0); g.lineTo(gl, -G.depth); g.lineTo(gl + G.w, -G.depth); g.lineTo(gl + G.w, 0); g.stroke();
      g.fillStyle = '#fff';
      for (const px of [gl, gl + G.w]) { g.beginPath(); g.arc(px, 0, 3.5, 0, Math.PI * 2); g.fill(); }
    }
  }

  /**
   * Rede do gol (só visual): malha de nós que balança sempre de leve e, quando sai gol, ondula a partir do ponto
   * em que a bola bateu (onda amortecida). Fica por cima da bola, que parece "presa" atrás dela. No gol, a rede e a
   * moldura brilham em amarelo; sem gol, a rede continua branca e parada (só o balanço sutil).
   */
  drawNet(ctx, game, t) {
    const G = CFG.GOAL, W = CFG.FIELD.w, gl = (W - G.w) / 2, D = G.depth, b = game.ball, N = this.net;
    if (this.cam.y - this.h / this.s / 2 > 8) return;                       // gol fora da tela
    if (game.scored && !N.was) {                                           // começou o gol: registra onde a bola bateu na rede
      const sp = Math.hypot(b.vx, b.vy), tb = b.vy < -1 ? (-D - b.y) / b.vy : 0;
      N.imp = { x: Util.clamp(b.x + b.vx * Math.max(0, tb), gl + 4, gl + G.w - 4), y: -D * 0.75, sp, t0: t };
    }
    N.was = game.scored;
    if (!game.scored && N.imp && t - N.imp.t0 > 4000) N.imp = null;
    const imp = N.imp, age = imp ? (t - imp.t0) / 1000 : 99;
    const env = imp ? Math.exp(-age * 2.4) : 0, amp = imp ? 5 + 11 * Util.clamp(imp.sp / 600, 0, 1) : 0;
    const glow = game.scored ? Util.clamp(1.3 - age * 0.5, 0.25, 1) : 0;    // brilho enquanto o gol está sendo comemorado
    const cols = 18, rows = 5, node = [];
    for (let j = 0; j <= rows; j++) {
      const y0 = -D + j * D / rows, k = (D + y0 > 0 ? -y0 / D : 0);          // k: 1 no fundo, 0 na linha do gol (presa à trave)
      for (let i = 0; i <= cols; i++) {
        const x0 = gl + i * G.w / cols, side = Math.min(1, Math.min(i, cols - i) / 3);
        let dx = 0, dy = Math.sin(t / 520 + i * 0.7 + j * 0.5) * 0.55 * k * side;   // balanço sutil sempre ligado
        if (imp && k > 0) {
          const d = Math.hypot(x0 - imp.x, y0 - imp.y), w = Math.exp(-(d * d) / 2400), push = amp * env * w * Math.cos(age * 22 - d * 0.09);
          dy -= push * k * side * 0.9; dx += (x0 - imp.x) / (d + 6) * push * 0.5 * k * side;
        }
        node.push({ x: x0 + dx, y: y0 + dy });
      }
    }
    const at = (i, j) => node[j * (cols + 1) + i];
    ctx.save();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {        // painéis: mais claros onde a rede está esticada
      const a = at(i, j), c = at(i + 1, j), d = at(i + 1, j + 1), e = at(i, j + 1);
      const st = Math.min(1, Math.abs(a.y - (-D + j * D / rows)) / 8);
      ctx.fillStyle = glow ? `rgba(255,240,150,${0.26 + 0.22 * st + 0.12 * glow})` : `rgba(235,245,238,${0.30 + 0.22 * st})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 1; ctx.strokeStyle = glow ? `rgba(255,248,200,${0.7 + 0.3 * glow})` : 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    for (let j = 0; j <= rows; j++) { ctx.moveTo(at(0, j).x, at(0, j).y); for (let i = 1; i <= cols; i++) ctx.lineTo(at(i, j).x, at(i, j).y); }
    for (let i = 0; i <= cols; i++) { ctx.moveTo(at(i, 0).x, at(i, 0).y); for (let j = 1; j <= rows; j++) ctx.lineTo(at(i, j).x, at(i, j).y); }
    ctx.stroke();
    if (glow) {                                                            // moldura amarela pulsando = GOL
      ctx.lineWidth = 4; ctx.strokeStyle = `rgba(250,204,21,${(0.55 + 0.45 * Math.sin(t / 110)) * glow})`; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(gl, 0); ctx.lineTo(gl, -D); ctx.lineTo(gl + G.w, -D); ctx.lineTo(gl + G.w, 0); ctx.stroke();
    }
    ctx.restore();
  }

  drawOffsideLine(ctx, game) {
    const y = Math.min(game.offsideLineY(), game.ball.y);
    if (y >= CFG.FIELD.midY) return;
    ctx.strokeStyle = 'rgba(250,204,21,.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.FIELD.w, y); ctx.stroke(); ctx.setLineDash([]);
    this.label(ctx, 'LINHA DE IMPEDIMENTO', this.cam.x - this.w / this.s / 2 + 8 / this.s, y - 9 / this.s, 9, 'rgba(250,204,21,.85)', 'left');
  }

  label(ctx, str, x, y, px, fill, align = 'center') {
    ctx.font = `700 ${px / this.s}px "Chakra Petch",system-ui,sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 / this.s; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y); ctx.fillStyle = fill; ctx.fillText(str, x, y);
  }

  /* ----- Quadro dinâmico ----- */
  draw(game, t, dt = 0.016) {
    const ctx = this.ctx, p = game.player, b = game.ball;
    this.updateCamera(game, dt);
    this.setWorld(ctx);
    this.drawPitch(ctx);
    Estadio.desenhar(ctx, this, t, this.festa(game));                // ambientação do mandante, só fora das linhas
    if (game.aids && !game.noOffside) this.drawOffsideLine(ctx, game);

    if (game.path.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(game.path[0].x, game.path[0].y);
      for (let i = 1; i < game.path.length; i++) ctx.lineTo(game.path[i].x, game.path[i].y);
      ctx.stroke();
    }

    if (p.target) {
      const pulse = (t % 800) / 800;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 - pulse * 0.6})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.target.x, p.target.y, 4 + pulse * 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(p.target.x, p.target.y, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    this.drawJogadores(ctx, game, t, dt);                          // ETAPA 4B: goleiro, zagueiros e atacantes em pixel art
    if (game.setPiece) {                                           // ETAPA 4: rótulo da barreira
      const w = game.defenders.filter(d => d.wall);
      if (w.length) this.label(ctx, 'BARREIRA', w.reduce((s, d) => s + d.x, 0) / w.length, Math.min(...w.map(d => d.y)) - 36 - 6 / this.s, 10, '#fecaca');
    }
    const noGol = b.y < 0 && b.x > (CFG.FIELD.w - CFG.GOAL.w) / 2 && b.x < (CFG.FIELD.w + CFG.GOAL.w) / 2;
    if (noGol) ctx.globalAlpha = 0.5;                              // bola dentro do gol: aparece "por trás" da rede
    this.drawBall(ctx, this.ballVisual(game, dt));
    ctx.globalAlpha = 1;
    this.drawNet(ctx, game, t);                                    // rede animada POR CIMA da bola
    if (game.aim) this.drawAim(ctx, game, t);

    // ----- Elementos em espaço de tela -----
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (game.strike) {
      this.drawStrike(ctx, game);
      this.drawTimer(ctx, game.strike.lim * (1 - game.strike.p), 1 - game.strike.p, this.strikeGeom(game.strike).cx < this.w / 2);
    } else if (game.aim) {
      this.drawTimer(ctx, game.aim.lim - game.aim.t, 1 - game.aim.t / game.aim.lim, (b.x - this.cam.x) * this.s + this.w / 2 < this.w / 2);
    }

    const slow = Util.clamp((1 - game.timeScale) / (1 - CFG.SLOWMO), 0, 1);
    if (slow > 0.01) {
      const gr = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.25,
                                          this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,10,30,${0.5 * slow})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, this.w, this.h);
    }

    if (game.msg) {
      const m = game.msg, pop = 1 + 0.45 * Math.pow(Math.max(0, 1 - m.age / 0.28), 2);
      const fs = Math.min(64, this.w * 0.13);
      ctx.save(); ctx.translate(this.w / 2, this.h * 0.42); ctx.scale(pop, pop);
      ctx.globalAlpha = Util.clamp(m.age / 0.08, 0, 1);
      ctx.font = `900 ${fs}px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineJoin = 'round';
      ctx.strokeText(m.text, 0, 0, this.w - 16); ctx.fillStyle = m.color; ctx.fillText(m.text, 0, 0, this.w - 16);
      if (m.sub) {
        ctx.font = `700 ${Math.max(13, fs * 0.3)}px "Chakra Petch",system-ui,sans-serif`;
        ctx.lineWidth = 4; ctx.strokeText(m.sub, 0, fs * 0.72, this.w - 16); ctx.fillStyle = '#e2e8f0'; ctx.fillText(m.sub, 0, fs * 0.72, this.w - 16);
      }
      ctx.restore();
    }

    if (game.decide && !game.aim && !game.strike) {
      const bw = Math.min(this.w - 40, 260), bx = (this.w - bw) / 2, by = this.h * 0.2, left = Util.clamp(game.decide.t / CFG.DECIDE_TIME, 0, 1);
      ctx.fillStyle = 'rgba(2,10,24,.25)'; ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = 'rgba(15,23,42,.85)'; ctx.fillRect(bx, by, bw, 7);
      ctx.fillStyle = '#67e8f9'; ctx.fillRect(bx, by, bw * left, 7);
      ctx.font = '800 14px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
      const msg = 'DECIDA: arraste da bola (chute/passe) ou toque para correr';
      ctx.strokeText(msg, this.w / 2, by - 14, this.w - 16); ctx.fillStyle = '#e2e8f0'; ctx.fillText(msg, this.w / 2, by - 14, this.w - 16);
    }

    if (game.toast) {
      ctx.font = '900 30px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = Util.clamp(game.toast.t / 0.4, 0, 1);
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
      ctx.strokeText(game.toast.text, this.w / 2, this.h * 0.3); ctx.fillStyle = game.toast.color || '#fca5a5'; ctx.fillText(game.toast.text, this.w / 2, this.h * 0.3);
      ctx.globalAlpha = 1;
    }

    // Dica (bola parada tem instrução própria)
    ctx.font = '600 12px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    const wait = game.mode === 'match' && !game.firstTouched && !game.locked;
    const hint = wait ? 'LANCE PARADO: toque no gramado ou arraste da bola para começar' : game.setPiece ? 'BOLA PARADA: arraste da bola para trás para chutar ou passar' : 'Toque no gramado: correr  •  Arraste da bola para trás: chute ou passe (mire num companheiro)';
    ctx.fillText(game.strike ? '' : hint, this.w / 2, this.h - 10, this.w - 16);

    if (!game.strike && !game.trans) this.drawOffscreenArrows(ctx, game);
    if (game.banner && !game.trans) this.drawBanner(ctx, game.banner);
    if (game.trans) this.drawTransition(ctx, game.trans);
  }

  /**
   * Setinhas sutis na borda da tela apontando para jogadores que estão fora da vista (com o zoom alto isso acontece).
   * Amarelo = seus companheiros (com o número), vermelho mais apagado = zagueiros.
   */
  drawOffscreenArrows(ctx, game) {
    const s = this.s, w = this.w, h = this.h, R = CFG.PLAYER_R * s, pad = 16;
    const x0 = pad, x1 = w - pad, y0 = pad, y1 = h - 30, cx = w / 2, cy = h / 2;   // embaixo sobra espaço para o texto de dica
    const one = (q, fill, alpha, label) => {
      const sx = (q.x - this.cam.x) * s + cx, sy = (q.y - this.cam.y) * s + cy;
      if (sx > -R * 0.3 && sx < w + R * 0.3 && sy > -R * 0.3 && sy < h + R * 0.3) return;     // visível: sem seta
      const dx = sx - cx, dy = sy - cy;
      const t = Math.min(dx ? (dx > 0 ? (x1 - cx) / dx : (x0 - cx) / dx) : Infinity, dy ? (dy > 0 ? (y1 - cy) / dy : (y0 - cy) / dy) : Infinity);
      const px = cx + dx * t, py = cy + dy * t, a = Math.atan2(dy, dx), z = label ? 9.5 : 7;
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(px, py);
      ctx.save(); ctx.rotate(a);
      ctx.fillStyle = fill; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.shadowColor = fill; ctx.shadowBlur = label ? 8 : 0;   // brilho leve só nos companheiros
      ctx.beginPath(); ctx.moveTo(z, 0); ctx.lineTo(-z * 0.7, -z * 0.8); ctx.lineTo(-z * 0.3, 0); ctx.lineTo(-z * 0.7, z * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.restore();
      if (label) {
        ctx.font = '900 12px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lx = -Math.cos(a) * 17, ly = -Math.sin(a) * 17;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(label, lx, ly); ctx.fillStyle = fill; ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    };
    for (const d of game.defenders) one(d, '#fca5a5', 0.3, '');
    for (const a of game.attackers) if (a !== game.player) one(a, '#facc15', 0.95, String(a.num));
  }

  /** ETAPA 4: nome e descrição do cenário sorteado (some sozinho). */
  drawBanner(ctx, b) {
    const a = Util.clamp(((b.dur || 3.2) - b.t) / 0.2, 0, 1) * Util.clamp(b.t / 0.6, 0, 1);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bw = Math.min(this.w - 16, 400);
    ctx.fillStyle = 'rgba(2,10,24,.86)'; ctx.beginPath(); ctx.roundRect((this.w - bw) / 2, 8, bw, 58, 10); ctx.fill();   // mais opaco: legível sobre a torcida
    ctx.font = '900 15px "Chakra Petch",system-ui,sans-serif'; ctx.fillStyle = '#facc15'; ctx.fillText(b.name, this.w / 2, 24, bw - 16);
    ctx.font = '600 12px "Chakra Petch",system-ui,sans-serif'; ctx.fillStyle = '#e2e8f0'; ctx.fillText(b.sub, this.w / 2, 41, bw - 16);
    ctx.font = '700 11px "Chakra Petch",system-ui,sans-serif'; ctx.fillStyle = '#67e8f9'; ctx.fillText(b.tac || '', this.w / 2, 57, bw - 16);
    ctx.restore();
  }

  /** ETAPA 4: barra de transição entre lances (minuto avançando + comentário / gol do adversário). */
  drawTransition(ctx, T) {
    const w = this.w, h = this.h, goal = T.goalShown, a = Util.clamp(T.t / 0.18, 0, 1);
    const bh = Math.max(60, Math.min(76, h * 0.12)), y = h * 0.3, mw = Math.min(96, w * 0.24);
    ctx.fillStyle = 'rgba(2,10,24,.4)'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = goal ? 'rgba(69,10,10,.94)' : 'rgba(2,10,24,.92)'; ctx.fillRect(0, y, w, bh);
    const acc = goal ? '#ef4444' : '#22c55e';
    ctx.fillStyle = acc; ctx.fillRect(0, y, w, 3); ctx.fillRect(0, y + bh - 3, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(0, y + 3, mw, bh - 6);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = `900 ${Math.min(38, bh * 0.56)}px "Chakra Petch",system-ui,sans-serif`;
    ctx.fillStyle = goal ? '#fecaca' : '#facc15'; ctx.fillText(Math.min(CFG.MATCH_MIN, Math.floor(T.shown)) + "'", mw / 2, y + bh / 2 + 1, mw - 8);
    const tx = mw + 14, maxW = w - tx - 10;
    ctx.textAlign = 'left';
    ctx.font = `800 ${Math.min(17, w * 0.042)}px "Chakra Petch",system-ui,sans-serif`; ctx.fillStyle = goal ? '#fca5a5' : '#f1f5f9';
    ctx.fillText(goal ? `${T.g}' - Gol do Adversário!` : `${T.to}' - ${T.text}`, tx, y + bh * 0.38, maxW);
    ctx.font = '600 12px "Chakra Petch",system-ui,sans-serif'; ctx.fillStyle = '#94a3b8';
    const sub = goal ? (T.next || 'Fim de jogo!') : T.next;
    if (sub) ctx.fillText(sub, tx, y + bh * 0.7, maxW);
    ctx.restore();
  }

  /**
   * ETAPA 4B: desenha todos os jogadores como bonecos pixel art. Só LÊ o estado da física (x, y, vx, vy, facing...).
   * Camadas: (1) chão: linhas de marcação, anéis e indicador do jogador controlado; (2) sprites ordenados por y
   * (quem está mais embaixo na tela aparece na frente); (3) textos: número, função tática e IMPEDIDO.
   */
  drawJogadores(ctx, game, t, dt) {
    const p = game.player, b = game.ball, s = this.s, DY = Sprites.PES_DY, sim = dt * game.timeScale;

    // 0) animação de cada boneco (corrida sincronizada com a velocidade real; câmera lenta respeitada)
    Visual.atualizar(game.keeper, 'goleiro', game, dt, sim);
    for (const d of game.defenders) Visual.atualizar(d, 'zagueiro', game, dt, sim);
    for (const a of game.attackers) Visual.atualizar(a, 'atacante', game, dt, sim);

    // 1) chão
    for (const d of game.defenders) {
      if (d.role === 'cover' && d.markRef) {
        ctx.strokeStyle = 'rgba(254,202,202,.28)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(d.x, d.y + DY); ctx.lineTo(d.markRef.x, d.markRef.y + DY); ctx.stroke(); ctx.setLineDash([]);
      }
      if (d.role === 'press') {
        ctx.strokeStyle = 'rgba(254,202,202,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t / 60;
        ctx.beginPath(); ctx.ellipse(d.x, d.y + DY, 14, 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
    }
    for (const a of game.attackers) {
      if (a !== p && game.aids && game.isOffside(a, b.y)) {
        const pulse = 0.55 + 0.45 * Math.sin(t / 120);
        ctx.strokeStyle = `rgba(248,113,113,${pulse})`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(a.x, a.y + DY, 15, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    this.drawDestaque(ctx, game, t, dt);
    this.drawIndicador(ctx, p, t);

    // 2) sprites (sombra + boneco), ordenados pela posição dos pés
    const lista = [game.keeper, ...game.defenders, ...game.attackers].sort((u, v) => u.y - v.y);
    for (const e of lista) desenharJogador(ctx, e);

    // 3) textos (número da camisa acima da cabeça dos atacantes + função tática sob os pés)
    for (const a of game.attackers) {
      if (a !== p && game.aids && game.isOffside(a, b.y)) this.label(ctx, 'IMPEDIDO', a.x, a.y - 46, 9, '#fca5a5');
      this.label(ctx, String(a.num), a.x, a.y - 31, a === p ? 10 : 9, a === p ? '#fde047' : '#fef9c3');
      if (a.pos) this.label(ctx, a.real ? a.real.rot.toUpperCase() : Tactics.LABEL[a.pos], a.x, a.y + DY + 6 + 5 / s, 8, 'rgba(254,249,195,.9)');
    }
    for (const d of game.defenders) if (d.pos) this.label(ctx, d.real ? d.real.rot.toUpperCase() : Tactics.LABEL[d.pos], d.x, d.y + DY + 6 + 5 / s, 8, 'rgba(254,202,202,.85)');
  }

  /**
   * Bola VISUAL (só desenho). Na física a bola conduzida fica CARRY_DIST px à frente do centro do jogador — com o boneco alto
   * isso cai na altura do peito/cabeça. Aqui ela é desenhada rente aos pés, um pouco à frente e fixa (sem balançar) enquanto corre. No chute, o deslocamento visual se dissolve em ~80 ms: a bola parece sair do pé e entrar na trajetória real.
   * Devolve um objeto com os mesmos campos da bola (x, y, z, rot) para drawBall; b.x/b.y da física ficam intactos.
   */
  ballVisual(game, dt) {
    const b = game.ball, p = game.player, v = this.vb;
    if (b.state === 'carried') {
      const f = p.facing;
      // posição FIXA em relação ao boneco (sem balançar): um pouco à frente e levemente ao lado de um pé
      const fw = 10.5, side = 0.35;
      const fx = Math.cos(f), fy = Math.sin(f) * 0.72;             // "frente" na projeção 3/4 do boneco
      const lx = -Math.sin(f), ly = Math.cos(f) * 0.72;
      const tx = p.x + fx * fw + lx * 5.5 * side;
      const ty = p.y + Sprites.PES_DY + fy * fw + ly * 5.5 * side - 1;
      const k = v.off === null ? 1 : 1 - Math.exp(-30 * dt);
      v.x = v.off === null ? tx : v.x + (tx - v.x) * k;
      v.y = v.off === null ? ty : v.y + (ty - v.y) * k;
      v.off = { x: v.x - b.x, y: v.y - b.y };
    } else if (v.off) {
      const k = Math.exp(-14 * dt);                                           // solta: o deslocamento some rápido
      v.off.x *= k; v.off.y *= k;
      if (Math.abs(v.off.x) + Math.abs(v.off.y) < 0.1) v.off = null;
    }
    const o = b.state === 'carried' || v.off ? v.off : null;
    return o ? { x: b.x + o.x, y: b.y + o.y, z: b.z, rot: b.rot } : b;
  }

  /**
   * Destaque do portador no início do lance (discreto, ~3 s): halo suave de luz no gramado, dois anéis que convergem
   * para os pés e uma etiqueta "COM A BOLA". Some antes se o jogador já se mexeu/mirou.
   */
  drawDestaque(ctx, game, t, dt) {
    const S = this.spot, p = game.player;
    if (S.id !== game.loadId) { S.id = game.loadId; S.f = 0; }
    // aparece já na barra de transição e fica até o primeiro toque; depois esmaece em ~0,4 s
    const alvo = game.firstTouched || game.locked ? 0 : 1;
    S.f += Util.clamp(alvo - S.f, -dt / 0.4, dt / 0.25);
    const fade = S.f; if (fade <= 0.01) return;
    const fx = p.x, fy = p.y + Sprites.PES_DY, pul = 0.5 + 0.5 * Math.sin(t / 220);
    ctx.save();
    // halo de luz (elipse achatada, como o chão em perspectiva)
    ctx.translate(fx, fy); ctx.scale(1, 0.55);
    const R = 46 + 4 * pul, g = ctx.createRadialGradient(0, 0, 4, 0, 0, R);
    g.addColorStop(0, `rgba(253,224,71,${0.38 * fade})`); g.addColorStop(0.6, `rgba(253,224,71,${0.14 * fade})`); g.addColorStop(1, 'rgba(253,224,71,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    // anéis convergindo (chamam o olhar para os pés)
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const ph = ((t / 900) + i * 0.5) % 1, r = 44 - 30 * ph;
      ctx.strokeStyle = `rgba(254,240,138,${0.75 * (1 - ph) * fade})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = fade; this.label(ctx, 'COM A BOLA', p.x, p.y - 56, 9, '#fde047');
    // partida: barrinha de tempo para o primeiro toque, nos segundos finais
    const resta = CFG.FIRST_TOUCH_TIME - game.touchT;
    if (game.mode === 'match' && !game.trans && resta <= CFG.FIRST_TOUCH_WARN) {
      const w = 34, h = 3.5, k = Util.clamp(resta / CFG.FIRST_TOUCH_WARN, 0, 1), y = p.y - 66;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = k > 0.4 ? '#facc15' : '#f87171'; ctx.fillRect(p.x - w / 2, y, w * k, h);
    }
    ctx.globalAlpha = 1;
  }

  /** Indicador do jogador controlado: anel pulsante no gramado sob os pés + setinha amarela quicando acima do número. */
  drawIndicador(ctx, p, t) {
    const fx = p.x, fy = p.y + Sprites.PES_DY, pulse = 0.5 + 0.5 * Math.sin(t / 150), bob = Math.sin(t / 170) * 2;
    const rx = 13 + 2 * pulse, ry = rx * 0.5;
    ctx.save();
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.30)';
    ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(250,204,21,${0.7 + 0.3 * pulse})`; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t / 70;
    ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    const ay = p.y - 42 + bob;
    ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#422006'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p.x - 5, ay - 5); ctx.lineTo(p.x + 5, ay - 5); ctx.lineTo(p.x, ay + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawBall(ctx, b) {
    const R = CFG.BALL_R, z = b.z || 0;
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.1, 0.3 - z / 220)})`;
    ctx.beginPath(); ctx.ellipse(b.x + 1, b.y + 1.5, R, R * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    const by = b.y - z * 0.35, r = R * (1 + z / 60);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(b.x, by, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1f2937';
    for (let i = 0; i < 3; i++) {
      const a = b.rot + i * 2.094;
      ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * r * 0.5, by + Math.sin(a) * r * 0.5, r * 0.25, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawPath(ctx, pred, color, power) {
    const pts = pred.pts, maxLen = CFG.AIM_LEN_MIN + (CFG.AIM_LEN_MAX - CFG.AIM_LEN_MIN) * power;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([0.1, 8]); ctx.lineCap = 'round';
    let acc = 0;
    for (let i = 1; i < pts.length && acc < maxLen; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      ctx.globalAlpha = Math.max(0, 1 - acc / maxLen);
      ctx.lineDashOffset = -acc;
      ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      acc += seg;
    }
    ctx.globalAlpha = 1; ctx.lineDashOffset = 0; ctx.setLineDash([]); ctx.lineCap = 'butt';
  }

  drawAim(ctx, game, t) {
    const a = game.aim, b = game.ball, vo = this.vb.off || { x: 0, y: 0 };   // vo: deslocamento da bola visual (pés)
    let dx = a.dx, dy = a.dy;
    const L = Math.hypot(dx, dy);
    if (L > CFG.MAX_PULL) { dx *= CFG.MAX_PULL / L; dy *= CFG.MAX_PULL / L; }
    const hx = b.x + dx, hy = b.y + dy;
    // ponta do dedo (discreta): a seta de força é o indicador principal
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // zona de cancelamento (só com ajudas): soltar com o dedo dentro deste círculo não faz nada
    const inCancel = L < CFG.MIN_PULL;
    if (game.aids) { ctx.save(); ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = inCancel ? 'rgba(252,165,165,.95)' : 'rgba(255,255,255,.35)';
    ctx.fillStyle = inCancel ? 'rgba(248,113,113,.18)' : 'rgba(255,255,255,.04)';
    ctx.beginPath(); ctx.arc(b.x + vo.x, b.y + vo.y, CFG.MIN_PULL, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
    const shot = game.computeShot();
    if (!shot) { if (game.aids) this.label(ctx, 'soltar aqui = cancelar', b.x, b.y + (CFG.MIN_PULL + 14) / 1, 11, '#fecaca'); return; }
    const color = this.powerColor(shot.power);
    const pred = game.predict(game.buildKick(shot, 0, 0));
    this.drawPowerArrow(ctx, { x: b.x + vo.x, y: b.y + vo.y }, shot);
    const rec = game.aids ? game.findReceiver(pred) : null;
    if (!game.aids) return;                                  // sem ajudas: só a trajetória e a força
    if (rec) {
      const off = game.isOffside(rec.a, b.y), col = off ? '#f87171' : '#67e8f9', R = CFG.PLAYER_R;
      const pulse = (t % 700) / 700;
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(rec.a.x, rec.a.y, R + 7 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(rec.ip.x - 4, rec.ip.y - 4); ctx.lineTo(rec.ip.x + 4, rec.ip.y + 4);
      ctx.moveTo(rec.ip.x + 4, rec.ip.y - 4); ctx.lineTo(rec.ip.x - 4, rec.ip.y + 4); ctx.stroke();
      this.label(ctx, off ? `PASSE p/ ${rec.a.num} • IMPEDIDO!` : `PASSE p/ ${rec.a.num}`, rec.a.x, rec.a.y - R - 16 / this.s, 12, col);
    } else {
    }
  }

  /** Cor da força: amarelo (fraca) -> vermelho escuro (máxima). */
  powerColor(pw) { return `hsl(${Math.round(52 - 52 * pw)},95%,${Math.round(58 - 28 * pw)}%)`; }

  /** Seta de força: sai da bola na direção do chute, alonga e escurece conforme a força. */
  drawPowerArrow(ctx, b, shot) {
    const pw = shot.power, len = 34 + 116 * pw, w = 5 + 5 * pw, hl = 14 + 6 * pw, hw = w * 1.7;
    ctx.save(); ctx.translate(b.x + shot.ux * 10, b.y + shot.uy * 10); ctx.rotate(Math.atan2(shot.uy, shot.ux));
    ctx.fillStyle = this.powerColor(pw); ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.96;
    ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(len - hl, -w / 2); ctx.lineTo(len - hl, -hw); ctx.lineTo(len, 0);
    ctx.lineTo(len - hl, hw); ctx.lineTo(len - hl, w / 2); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** Cronômetro (canto superior oposto ao lado em que a bola está): segundos que faltam para perder o chute. */
  drawTimer(ctx, secs, frac, ballOnLeft) {
    const r = 27, x = ballOnLeft ? this.w - 14 - r : 14 + r, y = 14 + r, f = Util.clamp(frac, 0, 1);
    const col = `hsl(${Math.round(120 * f)},90%,55%)`;
    ctx.save();
    ctx.fillStyle = 'rgba(2,10,24,.78)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, r - 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
    ctx.font = '900 17px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText(Math.max(0, secs).toFixed(1), x, y - 1);
    ctx.font = '700 8px "Chakra Petch",system-ui,sans-serif'; ctx.fillStyle = col; ctx.fillText('SEG', x, y + 12);
    ctx.restore();
  }

  /**
   * Posição da bola grande na tela de contato. kind: 'slide' (desliza reta), 'diag' (desliza subindo/descendo),
   * 'bounce' (atravessa quicando) e 'drop' (cai de cima, quica e sai pelo lado). air = altura (0 chão .. 1 alto) para a sombra.
   */
  strikeGeom(st) {
    const w = this.w, h = this.h, r = Math.min(w * 0.26, h * 0.17), span = w + 2 * r, p = st ? st.p : 0, travel = span * p;
    const dir = st ? st.dir : 1, kind = st ? st.kind : 'slide', base = h * 0.38, gy = h * 0.48, amp = h * 0.17;
    let cx = dir > 0 ? -r + travel : w + r - travel, cy = base, air = 0, ground = base;
    if (kind === 'still') { cx = w / 2; cy = base; ground = base; }                       // bola parada: não se mexe
    else if (kind === 'fly') { const f = Math.pow(1 - p, 1.4); cy = base - amp * f; air = f; }   // passe alto: vem voando e desce, sem quicar
    else if (kind === 'diag') { cy = base + st.slope * (0.5 - p) * h * 0.32; ground = cy; }
    else if (kind === 'bounce') { const hg = Math.abs(Math.sin(Math.PI * st.n * p)) * (1 - 0.5 * p); cy = gy - amp * hg; air = hg; ground = gy; }
    else if (kind === 'drop') {
      const x0 = st.x0 * w, ex = dir > 0 ? w + 1.3 * r : -1.3 * r; cx = x0 + (ex - x0) * p; ground = gy;
      if (p < 0.28) { const f = p / 0.28; cy = -1.2 * r + (gy + 1.2 * r) * f * f; air = 1 - f; }
      else { const u = (p - 0.28) / 0.72, hg = Math.abs(Math.sin(2 * Math.PI * u)) * (1 - u) * 0.9; cy = gy - amp * 0.7 * hg; air = hg; }
    }
    return { cx, cy, r, travel: kind === 'still' ? 0 : travel, gy: ground, air };
  }

  drawStrike(ctx, game) {
    const s = game.strike, G = this.strikeGeom(s), r = G.r, k = 1 - Math.pow(1 - s.t, 3);
    ctx.fillStyle = `rgba(2,10,24,${0.42 * k})`; ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.globalAlpha = 1 - 0.5 * G.air; ctx.beginPath(); ctx.ellipse(G.cx, G.gy + r + 14, r * 0.9 * (1 - 0.35 * G.air), r * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    for (let i = s.kind === 'still' ? 0 : 3; i >= 1; i--) {   // rastro de movimento (a bola parada não tem)
      ctx.fillStyle = `rgba(255,255,255,${0.05 * (4 - i)})`;
      ctx.beginPath(); ctx.arc(G.cx - s.dir * i * r * 0.28, G.cy, r, 0, Math.PI * 2); ctx.fill();
    }
    const gr = ctx.createRadialGradient(G.cx - r * 0.3, G.cy - r * 0.35, r * 0.1, G.cx, G.cy, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#e2e8f0'); gr.addColorStop(1, '#64748b');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(G.cx, G.cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(G.cx, G.cy); ctx.rotate(s.dir * G.travel / r); ctx.translate(-G.cx, -G.cy);
    ctx.fillStyle = '#1e293b';
    const pent = (x, y, rad, rot) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { const a = rot + i * Math.PI * 2 / 5; ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill();
    };
    pent(G.cx, G.cy, r * 0.24, -Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + Math.PI / 5 + i * Math.PI * 2 / 5;
      pent(G.cx + Math.cos(a) * r * 0.82, G.cy + Math.sin(a) * r * 0.82, r * 0.17, a);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(G.cx + Math.cos(a + Math.PI / 5) * r * 0.22, G.cy + Math.sin(a + Math.PI / 5) * r * 0.22);
      ctx.lineTo(G.cx + Math.cos(a + Math.PI / 5) * r * 0.62, G.cy + Math.sin(a + Math.PI / 5) * r * 0.62); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(G.cx, G.cy, r, 0, Math.PI * 2); ctx.stroke();
    if (game.aids) {                                   // mira na bola: só nas ajudas (treino)
      ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(G.cx - r, G.cy); ctx.lineTo(G.cx + r, G.cy);
      ctx.moveTo(G.cx, G.cy - r); ctx.lineTo(G.cx, G.cy + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(G.cx, G.cy, r * 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    const text = (str, y, px, fill) => {
      ctx.font = `800 ${px}px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
      ctx.globalAlpha = k; ctx.strokeText(str, this.w / 2, y, this.w - 16); ctx.fillStyle = fill; ctx.fillText(str, this.w / 2, y, this.w - 16); ctx.globalAlpha = 1;
    };
    const ty = this.h * 0.38;                           // textos fixos (a bola pode estar quicando)
    text(s.first ? 'DE PRIMEIRA! TOQUE NA BOLA!' : 'TOQUE NA BOLA!', ty - r - 46, 24, '#facc15');
    text('Embaixo: levanta  •  Lados: efeito  •  Em cima: rasteira', ty - r - 20, 12, '#e2e8f0');
    text('Se a bola passar, você perde a chance', this.h * 0.38 + r + 64, 12, '#cbd5e1');
  }
}


export { Aparencia, Visual, Renderer, Cores, Sprites, desenharJogador, Estadio };
