import { Aparencia, Cores, Sprites, Visual, desenharJogador } from './render-sprites.js';
import { Rnd, Gen } from './motor-campo.js';
import { Som } from './audio.js';
import { game, openMenu } from './main.js';
import { Tatica, Painel } from './tatica.js';

/* =============================================================================
   MODO CAMPEONATO BRASILEIRO SÉRIE A (OFFLINE, 38 RODADAS)
   Tudo aqui é DADOS e REGRAS: não toca na física, nos controles, na IA da zaga nem nos sprites.
     Clubes    : identidade visual (sigla, cores e padrão do uniforme) de cada clube.
     Dados     : carrega brasileirao2026.json (fetch; guarda cópia no localStorage; aceita arquivo escolhido à mão).
     Elenco    : monta o elenco completo de cada clube (tamanho livre) e a escalação na formação (vagas em tatica.js),
                 converte os atributos EFETIVOS (energia + improviso) nos atributos do jogo (game.attr) e veste os bonecos.
     Sim       : simula as partidas entre bots (Poisson por força de ataque x defesa) com autores dos gols.
     Liga      : calendário turno e returno (método do círculo), tabela, artilharia e persistência em localStorage
                 (inclui o estado tático do seu clube: formação, postura, titulares e energia de cada jogador).
   Sistema tático (fôlego, energia, formações, postura, improviso e substituições): tatica.js.
   ============================================================================= */

/* ------------------------------ Identidade dos clubes ------------------------------ */
const Clubes = {
  /**
   * Identidade dos clubes com DOIS uniformes, nas cores reais da temporada 2026: t = titular (camisa 1), r = reserva (camisa 2).
   * a/b/c = cores da camisa (principal/detalhe/terceira, opcional); pad = padrão (lisa | vertical | horizontal | faixa | peito | peito2 | tricolor);
   * cal = calção; mei = meião.
   */
  VIS: {
    'Flamengo':             { sg: 'FLA', t: { a: '#dc2626', b: '#111827', pad: 'horizontal', cal: '#111827', mei: '#111827' },
                             r: { a: '#f8fafc', b: '#dc2626', pad: 'peito', cal: '#f8fafc', mei: '#f8fafc' } },
    'Palmeiras':            { sg: 'PAL', t: { a: '#15803d', b: '#f8fafc', pad: 'lisa', cal: '#f8fafc', mei: '#15803d' },
                             r: { a: '#f8fafc', b: '#15803d', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Cruzeiro':             { sg: 'CRU', t: { a: '#1d4ed8', b: '#f8fafc', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' },
                             r: { a: '#f8fafc', b: '#1d4ed8', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'São Paulo':            { sg: 'SAO', t: { a: '#f8fafc', b: '#dc2626', c: '#111827', pad: 'peito2', cal: '#f8fafc', mei: '#f8fafc' },
                             r: { a: '#dc2626', b: '#f8fafc', c: '#111827', pad: 'tricolor', cal: '#111827', mei: '#111827' } },
    'Athletico Paranaense': { sg: 'CAP', t: { a: '#111827', b: '#dc2626', pad: 'faixa', cal: '#111827', mei: '#111827' },
                             r: { a: '#f8fafc', b: '#dc2626', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Bahia':                { sg: 'BAH', t: { a: '#f8fafc', b: '#1d4ed8', pad: 'lisa', cal: '#1d4ed8', mei: '#f8fafc' },
                             r: { a: '#1d4ed8', b: '#f8fafc', c: '#dc2626', pad: 'tricolor', cal: '#f8fafc', mei: '#f8fafc' } },
    'Atlético Mineiro':     { sg: 'CAM', t: { a: '#f8fafc', b: '#111827', pad: 'vertical', cal: '#111827', mei: '#f8fafc' },
                             r: { a: '#f8fafc', b: '#111827', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Red Bull Bragantino':  { sg: 'RBB', t: { a: '#f8fafc', b: '#dc2626', pad: 'faixa', cal: '#f8fafc', mei: '#f8fafc' },
                             r: { a: '#111827', b: '#7f1d1d', pad: 'vertical', cal: '#111827', mei: '#111827' } },
    'Vitória':              { sg: 'VIT', t: { a: '#111827', b: '#dc2626', pad: 'vertical', cal: '#111827', mei: '#dc2626' },
                             r: { a: '#f8fafc', b: '#dc2626', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Botafogo':             { sg: 'BOT', t: { a: '#111827', b: '#f8fafc', pad: 'vertical', cal: '#111827', mei: '#f8fafc' },
                             r: { a: '#111827', b: '#f8fafc', pad: 'lisa', cal: '#111827', mei: '#111827' } },
    'Corinthians':          { sg: 'COR', t: { a: '#f8fafc', b: '#111827', pad: 'lisa', cal: '#111827', mei: '#f8fafc' },
                             r: { a: '#111827', b: '#f8fafc', pad: 'lisa', cal: '#f8fafc', mei: '#111827' } },
    'Grêmio':               { sg: 'GRE', t: { a: '#0ea5e9', b: '#111827', c: '#f8fafc', pad: 'tricolor', cal: '#111827', mei: '#f8fafc' },
                             r: { a: '#f8fafc', b: '#0284c7', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Mirassol':             { sg: 'MIR', t: { a: '#facc15', b: '#15803d', pad: 'lisa', cal: '#15803d', mei: '#facc15' },
                             r: { a: '#f8fafc', b: '#15803d', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Internacional':        { sg: 'INT', t: { a: '#dc2626', b: '#f8fafc', pad: 'lisa', cal: '#f8fafc', mei: '#dc2626' },
                             r: { a: '#f8fafc', b: '#dc2626', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Remo':                 { sg: 'REM', t: { a: '#1e3a8a', b: '#f8fafc', pad: 'lisa', cal: '#f8fafc', mei: '#1e3a8a' },
                             r: { a: '#f1ede2', b: '#1e3a8a', pad: 'lisa', cal: '#1e3a8a', mei: '#f1ede2' } },
    'Chapecoense':          { sg: 'CHA', t: { a: '#16a34a', b: '#f8fafc', pad: 'vertical', cal: '#f8fafc', mei: '#16a34a' },
                             r: { a: '#f8fafc', b: '#16a34a', pad: 'lisa', cal: '#16a34a', mei: '#f8fafc' } },
    'Santos':               { sg: 'SAN', t: { a: '#f8fafc', b: '#111827', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' },
                             r: { a: '#111827', b: '#f8fafc', pad: 'vertical', cal: '#111827', mei: '#111827' } },
    'Vasco':                { sg: 'VAS', t: { a: '#111827', b: '#f8fafc', pad: 'faixa', cal: '#111827', mei: '#111827' },
                             r: { a: '#f8fafc', b: '#111827', pad: 'faixa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Fluminense':           { sg: 'FLU', t: { a: '#7f1d1d', b: '#f8fafc', c: '#15803d', pad: 'tricolor', cal: '#f8fafc', mei: '#f8fafc' },
                             r: { a: '#f8fafc', b: '#7f1d1d', pad: 'lisa', cal: '#f8fafc', mei: '#f8fafc' } },
    'Coritiba':             { sg: 'CFC', t: { a: '#f8fafc', b: '#16a34a', pad: 'peito', cal: '#111827', mei: '#f8fafc' },
                             r: { a: '#16a34a', b: '#f8fafc', pad: 'vertical', cal: '#f8fafc', mei: '#16a34a' } },
  },
  /** Visual do clube: sigla, cores do titular (a, b... usados nas faixas da interface) e os dois uniformes em kits[0] / kits[1].
   *  Se o nome não estiver na tabela (JSON com outros clubes), gera sigla e cores a partir do nome. */
  visual(nome) {
    const v = this.VIS[nome];
    if (v) return { sg: v.sg, ...v.t, kits: [v.t, v.r] };
    const h = Aparencia.hash(nome), pal = ['#dc2626', '#15803d', '#1d4ed8', '#facc15', '#111827', '#f97316', '#f8fafc'];
    const a = pal[h % pal.length], b = pal[(h >> 3) % pal.length] === a ? '#f8fafc' : pal[(h >> 3) % pal.length];
    const t = { a, b, pad: ['lisa', 'vertical', 'horizontal', 'faixa'][h % 4], cal: '#111827', mei: a };
    const claro = Cores.lum(a) > 0.55, r = { a: claro ? '#111827' : '#f8fafc', b: a, pad: 'lisa', cal: claro ? '#111827' : '#f8fafc', mei: claro ? '#111827' : '#f8fafc' };
    return { sg: nome.replace(/[^A-Za-zÀ-ú]/g, '').slice(0, 3).toUpperCase(), ...t, kits: [t, r] };
  },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
};

/* ------------------------------- Carga do JSON -------------------------------- */
const Dados = {
  URL: 'brasileirao2026.json', KEY: 'nst_dados_v1', json: null,
  /** Aceita o arquivo se tiver clubes em número par (>= 4) e 11 titulares em cada um. */
  validar(j) {
    return !!j && Array.isArray(j.clubes) && j.clubes.length >= 4 && j.clubes.length % 2 === 0 &&
      j.clubes.every(c => c && c.nome && Array.isArray(c.jogadores) && c.jogadores.filter(p => p.titular).length === 11);
  },
  guardar(j) { this.json = j; try { localStorage.setItem(this.KEY, JSON.stringify(j)); } catch (_) {} },
  /** 1) tenta buscar o arquivo ao lado do jogo; 2) usa a cópia guardada no navegador; senão devolve false (a tela pede o arquivo). */
  async carregar() {
    try { const r = await fetch(this.URL, { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); if (this.validar(j)) { this.guardar(j); return true; } } } catch (_) {}
    try { const s = localStorage.getItem(this.KEY); if (s) { const j = JSON.parse(s); if (this.validar(j)) { this.json = j; return true; } } } catch (_) {}
    return false;
  },
  usarTexto(txt) { try { const j = JSON.parse(txt); if (!this.validar(j)) return false; this.guardar(j); return true; } catch (_) { return false; } },
};

/* ----------------------------------- Elenco ----------------------------------- */
/**
 * Cada clube tem o ELENCO completo do JSON e uma escalação de 11 nas vagas da formação (tatica.js). Cada titular ocupa um
 * "slot" da formação (chave = função + lado, ex.: 'LB|-0.85'); é por essa chave que o cenário de cada lance encontra o jogador real.
 * Bots jogam sempre no 4-3-3 com os 11 titulares do JSON; o seu clube usa a escalação salva em Tática & Elenco.
 */
const Elenco = {
  FORM: '4-3-3',
  chave(pos, slotX) { return pos + '|' + slotX; },
  mean(l, f) { return l.length ? l.reduce((s, p) => s + f(p), 0) / l.length : 0; },
  /** "Giorgian de Arrascaeta" -> "Arrascaeta" (nome curto do rótulo em campo); com até 2 palavras a narração usa o nome inteiro. */
  curto(nome) {
    const p = nome.trim().split(/\s+/), suf = /^(jr\.?|júnior|junior|filho|neto|sobrinho)$/i; let k = p.length - 1;
    if (k > 0 && suf.test(p[k])) k--;
    return p[k];
  },
  falado(nome) { const p = nome.trim().split(/\s+/); return p.length <= 2 ? nome.trim() : this.curto(nome); },

  /** Monta o clube: elenco completo (com fôlego e energia), escalação padrão no 4-3-3 com os titulares do JSON, camisas e forças. */
  montar(clube, idx) {
    const vis = Clubes.visual(clube.nome);
    const elenco = clube.jogadores.map(p => ({ ...p, folego: Tatica.folego(p), nomeFalado: this.falado(p.nome), rot: this.curto(p.nome), clube: idx,
                                               energia: 100, num: null, slotKey: null, slotPos: null, vaga: null }));
    const L = { idx, nome: clube.nome, sg: vis.sg, vis, elenco, postura: 'equilibrada' };
    Tatica.escalar(L, this.FORM, Tatica.auto(this.FORM, elenco.filter(p => p.titular)));
    Tatica.numerar(L);
    return L;
  },
  /** Jogador do time para um slot do cenário (pos = função, x = lado na formação). */
  porSlot(L, pos, x) { return L.slots.get(this.chave(pos, x)) || null; },

  /**
   * Converte o elenco nos atributos do jogo (os mesmos nove sliders), sempre com os valores EFETIVOS (energia + improviso):
   * os cinco ofensivos vêm dos atacantes (60%) e meias (40%) do SEU time; Marcação e Reflexo vêm da zaga/volantes e do goleiro
   * do ADVERSÁRIO; Ataque do Adversário e Sua Defesa saem das mesmas fórmulas do jogo.
   */
  attr(us, op) {
    const M = this.mean.bind(this), c = v => Math.max(1, Math.min(99, Math.round(v))), E = (p, k) => Tatica.ef(p, k), A = l => Tatica.ativos(l);
    const off = (L, k) => 0.6 * M(A(L.ata), p => E(p, k)) + 0.4 * M(A(L.mei), p => E(p, k)), marc = L => 0.7 * M(A(L.def), p => E(p, 'marcacao')) + 0.3 * M(A(L.mei), p => E(p, 'marcacao'));
    const atk = L => 0.2 * off(L, 'forca') + 0.2 * off(L, 'curva') + 0.2 * off(L, 'velocidade') + 0.25 * off(L, 'drible') + 0.15 * off(L, 'posicionamento');
    const inf = L => 1 - 0.05 * Tatica.expulsos(L).length;                        // com um a menos, cada um cobre mais campo e rende menos
    const iu = inf(us), io = inf(op);
    return { force: c(off(us, 'forca') * iu), curve: c(off(us, 'curva') * iu), speed: c(off(us, 'velocidade') * iu), dribble: c(off(us, 'drible') * iu), pos: c(off(us, 'posicionamento') * iu),
             reflex: c(E(op.gk, 'reflexo')), mark: c(marc(op) * io), oatk: c(atk(op) * io), mdef: c((0.6 * marc(us) + 0.4 * E(us.gk, 'reflexo')) * iu) };
  },
  /**
   * Quantidade de lances jogáveis da partida: compara o overall do SEU ataque com o overall da DEFESA adversária (+ sorte,
   * sorteada uma vez por partida) e aplica a postura (ofensiva = mais lances, defensiva = menos). 2 a 10.
   */
  qtdLances(us, op, sorte = Rnd.r(-1.3, 1.3), postura = 'equilibrada') {
    const dif = us.ataque - op.defesa, mul = (Tatica.POSTURAS[postura] || Tatica.POSTURAS.equilibrada).lances;
    return Math.max(2, Math.min(10, Math.round((5 + dif * 0.22 + sorte) * mul)));
  },

  /* ----- Uniformes ----- */
  dist(h1, h2) { const a = Cores.rgb(h1), b = Cores.rgb(h2); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
  NOMES_KIT: ['Titular', 'Reserva'],
  /** Uniforme i (0 = titular, 1 = reserva) do clube, no formato que os sprites usam. */
  kit(L, i) { const v = L.vis.kits[i] || L.vis.kits[0]; return { camisaPrimaria: v.a, camisaSecundaria: v.b, ...(v.c ? { camisaTerciaria: v.c } : {}), padrao: v.pad, calcao: v.cal, meiao: v.mei }; },
  /** Camisas parecidas demais para jogar uma contra a outra (mesma régua usada para os goleiros). */
  choque(k1, k2) { return this.dist(k1.camisaPrimaria, k2.camisaPrimaria) < 110; },
  /** Sugestão automática: mandante de titular; visitante de titular, ou de reserva se a titular confundir. */
  sugestao(casa, fora) { return { casa: 0, fora: this.choque(this.kit(casa, 0), this.kit(fora, 0)) && !this.choque(this.kit(casa, 0), this.kit(fora, 1)) ? 1 : 0 }; },
  GOLEIROS: ['#f97316', '#a3e635', '#22d3ee', '#f43f5e', '#facc15', '#a855f7'],
  kitGol(cor) { return { camisaPrimaria: cor, camisaSecundaria: '#111827', padrao: 'faixa', calcao: '#111827', meiao: cor, luva: '#f8fafc', mangaLonga: true, goleiro: true }; },
  /** Veste os dois times com os uniformes escolhidos (esc = { us: 0|1, op: 0|1 }); goleiros em cores diferentes dos dois. */
  vestir(us, op, esc = { us: 0, op: 0 }) {
    const ku = this.kit(us, esc.us), ko = this.kit(op, esc.op);
    us.kitJogo = ku; op.kitJogo = ko;                                          // placar da transmissão usa as cores do uniforme em campo
    const livres = this.GOLEIROS.filter(c => this.dist(c, ku.camisaPrimaria) > 110 && this.dist(c, ko.camisaPrimaria) > 110);
    us.kitGolJogo = this.kitGol(livres[1] || this.GOLEIROS[1]); op.kitGolJogo = this.kitGol(livres[0] || this.GOLEIROS[0]);
    this.pintar(us); this.pintar(op);
  },
  /** Aparência de TODO o elenco (reservas também, para entrarem já vestidos); quem está no gol usa a camisa de goleiro. */
  pintar(L) { for (const p of L.elenco) p.visual = this.visual(p, p.slotPos === 'GK' ? L.kitGolJogo : L.kitJogo); },
  visual(p, kit) {
    const a = p.aparencia || {}, gol = !!kit.goleiro;
    return { pele: a.pele, cabeloEstilo: Aparencia.ESTILOS.includes(a.cabeloEstilo) ? a.cabeloEstilo : 'curto', cabeloCor: a.cabeloCor, barba: !!a.barba,
             uniforme: { ...kit, chuteira: gol ? '#111827' : Aparencia.CHUTEIRAS[Aparencia.hash(p.nome) % Aparencia.CHUTEIRAS.length] } };
  },
};

/* ------------------------- Partidas entre bots (simulação) ------------------------- */
const Sim = {
  K: 0.05,                    // sensibilidade: cada ponto de overall de vantagem muda ~5% a média de gols
  BASE_CASA: 1.38, BASE_FORA: 1.12,   // média de gols por jogo (soma ~2,5, com mando de campo)
  media: { atk: 75, def: 74 },
  calibrar(Ls) { this.media = { atk: Elenco.mean(Ls, l => l.ataque), def: Elenco.mean(Ls, l => l.defesa) }; },
  /** Gols esperados de quem ataca (atk) contra quem defende (def). */
  lambda(atk, def, casa) {
    const l = (casa ? this.BASE_CASA : this.BASE_FORA) * Math.exp(this.K * ((atk - this.media.atk) - (def - this.media.def)));
    return Math.max(0.2, Math.min(4.5, l));
  },
  poisson(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L && k < 12); return k - 1; },
  /** Autor do gol: sorteio ponderado por posição (atacante > meia > zagueiro) e overall. */
  autor(L) {
    const w = { ST: 1.6, LW: 1.1, RW: 1.1, AM: 0.8, LM: 0.6, RM: 0.6, CM: 0.5, LWB: 0.25, RWB: 0.25, DM: 0.22, LB: 0.12, RB: 0.12, CB: 0.14, GK: 0 };
    const ps = Tatica.ativos(L.tit).map(p => ({ p, w: (w[p.slotPos] || 0.1) * Math.pow(p.ovr / 75, 4) * (0.7 + 0.3 * p.forca / 75) }));
    let r = Math.random() * ps.reduce((s, o) => s + o.w, 0);
    for (const o of ps) { r -= o.w; if (r <= 0) return o.p; }
    return ps[0].p;
  },
  /**
   * Joga uma partida (h = time da casa, a = visitante, como lineups). aj = { h, a }: pontos de ataque somados a cada lado
   * (postura do usuário quando ele só simula a partida). Devolve { hg, ag, g:[[minuto, 'h'|'a', autor]] }.
   */
  jogo(h, a, aj = {}) {
    const hg = Math.min(8, this.poisson(this.lambda(h.ataque + (aj.h || 0), a.defesa, true))), ag = Math.min(8, this.poisson(this.lambda(a.ataque + (aj.a || 0), h.defesa, false))), g = [];
    for (let i = 0; i < hg; i++) g.push([Rnd.i(1, 90), 'h', this.autor(h).nome]);
    for (let i = 0; i < ag; i++) g.push([Rnd.i(1, 90), 'a', this.autor(a).nome]);
    g.sort((u, v) => u[0] - v[0]);
    return { hg, ag, g };
  },
};

/* ------------------------ Campeonato: calendário, tabela, save ------------------------ */
const Liga = {
  KEY: 'nst_liga_v1',
  S: null,          // estado salvo: { v, user, round, nomes, fx: [rodada][jogo] = { h, a, hg, ag, g }, tat: {form, postura, tit}, energia: {nome: %},
                    //                 disc: {clube: {nome: {am: amarelos acumulados, susp: jogos de suspensão}}} }
  avisoSusp: [],    // trocas automáticas da última rodada no seu time (suspenso sai, reserva entra), para o card da Central
  L: [],            // times (lineups) na ordem do JSON
  /** Monta os times a partir do JSON carregado e calibra a simulação (com as escalações padrão, todos descansados). */
  prepararDados() { this.L = Dados.json.clubes.map((c, i) => Elenco.montar(c, i)); Sim.calibrar(this.L); },

  /**
   * Turno e returno pelo método do círculo (tabela de Berger): n clubes -> 2(n-1) rodadas de n/2 jogos.
   * Mando alternado como no futebol de verdade: nenhum clube joga mais de DUAS seguidas em casa ou fora (nem na virada de turno),
   * cada um faz metade dos jogos em casa e o returno espelha o turno (mandos invertidos). O returno começa pelo espelho da 2ª rodada
   * e termina com o da 1ª: assim a virada não cria 3 jogos seguidos com o mesmo mando nem repete adversário em rodadas seguidas.
   */
  calendario(n) {
    const R = n - 1, emb = Gen.shuffle(Array.from({ length: n }, (_, i) => i)), turno = [];
    for (let r = 0; r < R; r++) {
      const rod = [r % 2 === 0 ? { h: R, a: r } : { h: r, a: R }];                 // o clube fixo do círculo alterna casa/fora a cada rodada
      for (let i = 1; i < n / 2; i++) {
        const x = (r + i) % R, y = (r - i + R) % R;
        rod.push(i % 2 === 1 ? { h: x, a: y } : { h: y, a: x });
      }
      turno.push(rod.map(j => ({ h: emb[j.h], a: emb[j.a] })));                     // embaralha quais clubes ocupam cada posição
    }
    const mk = j => ({ h: j.h, a: j.a, hg: null, ag: null, g: [] });
    const returno = turno.map(rd => rd.map(j => ({ h: j.a, a: j.h })));
    return [...turno, ...returno.slice(1), returno[0]].map(rd => rd.map(mk));
  },
  /** Maior sequência de jogos seguidos com o mesmo mando (casa ou fora) de qualquer clube na tabela. */
  maiorSequencia(fx, n) {
    let pior = 0;
    for (let t = 0; t < n; t++) {
      let run = 0, ult = null;
      for (const rd of fx) { const j = rd.find(f => f.h === t || f.a === t); if (!j) continue; const c = j.h === t; run = c === ult ? run + 1 : 1; ult = c; pior = Math.max(pior, run); }
    }
    return pior;
  },

  novo(user) {
    this.S = { v: 1, user, round: 0, nomes: this.L.map(l => l.nome), fx: this.calendario(this.L.length), criado: Date.now() };
    Tatica.carregar(this.L[user], this.S);                                     // escalação padrão, todos com 100% de energia
    this.aplicarDisciplina();
  },
  /* ----- Disciplina: cartões acumulados e suspensões (todos os clubes) ----- */
  disc(i) { const d = this.S.disc || (this.S.disc = {}); return d[i] || (d[i] = {}); },
  /**
   * Marca em cada elenco quem está suspenso (p.suspenso) e quantos amarelos acumula (p.amarelos), e tira os suspensos da escalação:
   * no seu clube, o titular suspenso dá lugar ao melhor reserva da posição (o resto da sua escalação não muda); os bots voltam
   * à escalação padrão e cobrem os suspensos do mesmo jeito. Salva o estado tático.
   */
  aplicarDisciplina() {
    this.avisoSusp = [];
    for (const L of this.L) {
      const d = (this.S.disc && this.S.disc[L.idx]) || {};
      for (const p of L.elenco) { const r = d[p.nome]; p.suspenso = !!(r && r.susp > 0); p.amarelos = r ? r.am : 0; }
      if (L.idx === this.S.user) this.avisoSusp = Tatica.cobrirSuspensos(L);
      else { Tatica.escalar(L, Elenco.FORM, Tatica.auto(Elenco.FORM, L.elenco.filter(p => p.titular))); Tatica.cobrirSuspensos(L); }
    }
    this.salvarTatica();
  },
  /**
   * Fim da rodada: quem estava suspenso cumpriu (todos os clubes jogam toda rodada); depois entram os cartões desta partida:
   * expulsão = fora da próxima rodada (os amarelos que viraram vermelho não acumulam); amarelo soma 1 e o 3º em jogos
   * diferentes suspende da próxima rodada e zera a contagem. cartoes = { clube: [{ nome, am, verm }] }.
   */
  registrarCartoes(cartoes) {
    for (const d of Object.values(this.S.disc || {})) for (const r of Object.values(d)) if (r.susp > 0) r.susp--;
    for (const [i, lst] of Object.entries(cartoes || {})) {
      const d = this.disc(i);
      for (const c of lst) {
        const r = d[c.nome] || (d[c.nome] = { am: 0, susp: 0 });
        if (c.verm) r.susp = 1;
        else if (c.am) { r.am++; if (r.am >= 3) { r.am = 0; r.susp = 1; } }
      }
    }
  },
  salvar() { try { localStorage.setItem(this.KEY, JSON.stringify(this.S)); } catch (_) {} },
  /** Grava o estado tático do seu clube (formação, postura, titulares e energias) junto com o campeonato. */
  salvarTatica() {
    if (!this.S || !this.L[this.S.user]) return;
    const L = this.L[this.S.user];
    this.S.tat = Tatica.serializar(L); this.S.energia = Tatica.energias(L);
    this.salvar();
  },
  /** Lê o campeonato salvo; descarta se o elenco/JSON mudou de clubes ou o arquivo estiver corrompido. */
  carregar() {
    try {
      const s = localStorage.getItem(this.KEY); if (!s) return false;
      const o = JSON.parse(s), n = this.L.length;
      if (!o || o.v !== 1 || !Array.isArray(o.fx) || o.fx.length !== 2 * (n - 1) || o.fx.some(r => r.length !== n / 2) || o.nomes.join('|') !== this.L.map(l => l.nome).join('|') || !(o.user >= 0 && o.user < n)) return false;
      if (o.round === 0 && this.maiorSequencia(o.fx, n) > 2) o.fx = this.calendario(n);   // save antigo sem jogos: tabela nova
      this.S = o; Tatica.carregar(this.L[o.user], o);                          // save antigo sem tática: escalação padrão e 100% de energia
      this.aplicarDisciplina();                                                // save antigo sem disciplina: ninguém suspenso
      return true;
    } catch (_) { return false; }
  },
  /** Apaga o save e remonta os elencos (a escalação do clube antigo não pode sobrar na memória). */
  reiniciar() { try { localStorage.removeItem(this.KEY); } catch (_) {} this.S = null; if (Dados.json) this.prepararDados(); },
  /** Resumo do campeonato salvo para o menu (lido direto do localStorage, sem precisar dos elencos). null = não há save. */
  resumoSalvo() {
    try {
      const o = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (!o || o.v !== 1 || !Array.isArray(o.fx) || !Array.isArray(o.nomes) || !o.nomes[o.user]) return null;
      let pts = 0;
      for (const r of o.fx) for (const f of r) if (f.hg !== null && (f.h === o.user || f.a === o.user)) {
        const [g, c] = f.h === o.user ? [f.hg, f.ag] : [f.ag, f.hg]; pts += g > c ? 3 : g === c ? 1 : 0;
      }
      return { clube: o.nomes[o.user], rodada: Math.min(o.round + 1, o.fx.length), total: o.fx.length, pts, acabou: o.round >= o.fx.length };
    } catch (_) { return null; }
  },
  get total() { return this.S.fx.length; },
  get acabou() { return this.S.round >= this.S.fx.length; },
  feito(f) { return f.hg !== null; },
  /** Jogo do usuário na rodada r (padrão: a rodada atual). */
  jogoDoUsuario(r = this.S.round) { return (this.S.fx[r] || []).find(f => f.h === this.S.user || f.a === this.S.user) || null; },

  /**
   * Registra o resultado da partida do usuário e SIMULA os outros jogos da rodada (bots). Avança a rodada e salva.
   * g = gols [[minuto, 'h'|'a', autor]]; cartoes = cartões da partida do usuário (ver registrarCartoes). Devolve o índice da rodada.
   */
  concluirRodada(fx, hg, ag, g, cartoes = {}) {
    const r = this.S.round; if (this.feito(fx)) return r;
    fx.hg = hg; fx.ag = ag; fx.g = g;
    for (const f of this.S.fx[r]) if (f !== fx && !this.feito(f)) { const s = Sim.jogo(this.L[f.h], this.L[f.a]); f.hg = s.hg; f.ag = s.ag; f.g = s.g; }
    this.S.round = r + 1;
    this.registrarCartoes(cartoes); this.aplicarDisciplina();               // suspensões cumpridas/novas e escalações da próxima rodada (salva)
    return r;
  },
  /** Joga a partida do usuário só por simulação (sem entrar no campo): a postura pesa no placar e os titulares se desgastam. */
  simularUsuario() {
    const fx = this.jogoDoUsuario(); if (!fx) return -1;
    const u = this.S.user, eu = this.L[u], P = Tatica.POSTURAS[eu.postura] || Tatica.POSTURAS.equilibrada, casa = fx.h === u;
    const s = Sim.jogo(this.L[fx.h], this.L[fx.a], casa ? { h: P.simEu, a: P.simEle } : { h: P.simEle, a: P.simEu });
    Tatica.desgastar(eu, eu.postura, 90, false); Tatica.recuperar(eu); Tatica.recalc(eu); this.salvarTatica();
    return this.concluirRodada(fx, s.hg, s.ag, s.g);
  },
  /** Classificação: Pontos, Vitórias, Saldo de Gols, Gols Pró (e nome, só para não oscilar). */
  tabela() {
    const t = this.L.map((l, i) => ({ i, P: 0, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, SG: 0 }));
    for (const rod of this.S.fx) for (const f of rod) {
      if (!this.feito(f)) continue;
      const H = t[f.h], A = t[f.a];
      H.J++; A.J++; H.GP += f.hg; H.GC += f.ag; A.GP += f.ag; A.GC += f.hg;
      if (f.hg > f.ag) { H.V++; A.D++; H.P += 3; } else if (f.hg < f.ag) { A.V++; H.D++; A.P += 3; } else { H.E++; A.E++; H.P++; A.P++; }
    }
    for (const x of t) x.SG = x.GP - x.GC;
    return t.sort((u, v) => v.P - u.P || v.V - u.V || v.SG - u.SG || v.GP - u.GP || this.L[u.i].nome.localeCompare(this.L[v.i].nome, 'pt-BR'));
  },
  /** Artilharia: soma os gols de todas as partidas (derivada do histórico, por isso nunca fica fora de sincronia). */
  artilharia() {
    const mapa = new Map();
    for (const rod of this.S.fx) for (const f of rod) for (const [, lado, nome] of f.g) {
      const clube = lado === 'h' ? f.h : f.a, k = clube + '|' + nome, o = mapa.get(k) || { clube, nome, gols: 0 };
      o.gols++; mapa.set(k, o);
    }
    return [...mapa.values()].sort((u, v) => v.gols - u.gols || this.L[u.clube].nome.localeCompare(this.L[v.clube].nome, 'pt-BR') || u.nome.localeCompare(v.nome, 'pt-BR'));
  },
  /** Últimos n resultados de um clube ('V' | 'E' | 'D'), do mais antigo ao mais recente. */
  forma(i, n = 5) {
    const r = [];
    for (const rod of this.S.fx) for (const f of rod) {
      if (!this.feito(f) || (f.h !== i && f.a !== i)) continue;
      const pro = f.h === i ? f.hg : f.ag, contra = f.h === i ? f.ag : f.hg;
      r.push(pro > contra ? 'V' : pro < contra ? 'D' : 'E');
    }
    return r.slice(-n);
  },
};

/* =============================================================================
   TELAS DO CAMPEONATO: ESCOLHA DO CLUBE E CENTRAL DO CAMPEONATO
   Só HTML/CSS por cima do jogo (nada de canvas aqui). Enquanto uma delas está aberta, game.menuOpen = true (o relógio não anda).
   ============================================================================= */
const $id = id => document.getElementById(id);
const esc = Clubes.esc;
const strip = v => `<i class="strip2" style="--a:${v.a};--b:${v.b}"></i>`;
const nomeDe = i => `<span class="full">${esc(Liga.L[i].nome)}</span><span class="sg">${esc(Liga.L[i].sg)}</span>`;

/* ------------------------------- Escolha do clube ------------------------------- */
const Escolha = {
  el: $id('pick'), body: $id('pk-body'), go: $id('pk-go'), info: $id('pk-sel'), sel: null,
  aberta() { return this.el.classList.contains('show'); },
  ocultar() { this.el.classList.remove('show'); },
  abrir() { Central.ocultar(); $id('menu').classList.remove('show'); game.menuOpen = true; game.input.cancel(); this.el.classList.add('show'); this.el.scrollTop = 0; },
  /** Lista os 20 clubes (do mais forte ao mais fraco pelo overall médio dos titulares). */
  mostrar() {
    this.abrir(); this.sel = null; this.go.disabled = true; this.info.textContent = 'Toque em um clube para escolher';
    const ordem = Liga.L.slice().sort((a, b) => b.ovr - a.ovr);
    this.body.innerHTML = `<div class="pk-grid">${ordem.map(L => `
      <button type="button" class="pk-card" data-i="${L.idx}" style="--a:${L.vis.a};--b:${L.vis.b}">
        ${strip(L.vis)}
        <span class="pk-n">${esc(L.nome)}</span><span class="pk-sg">${esc(L.sg)}</span>
        <span class="pk-ovr"><b>${L.ovr.toFixed(1)}</b><small>OVR</small></span>
        <span class="pk-st">ATAQUE <b>${Math.round(L.ataque)}</b> · DEFESA <b>${Math.round(L.defesa)}</b></span>
      </button>`).join('')}</div>`;
  },
  escolher(i) {
    this.sel = i; const L = Liga.L[i], craque = L.tit.slice().sort((a, b) => b.ovr - a.ovr)[0];
    for (const b of this.body.querySelectorAll('.pk-card')) b.classList.toggle('on', +b.dataset.i === i);
    this.info.innerHTML = `<b>${esc(L.nome)}</b> · OVR ${L.ovr.toFixed(1)} · craque ${esc(craque.nome)} (${craque.ovr})`;
    this.go.disabled = false;
  },
  iniciar() { if (this.sel === null) return; Liga.novo(this.sel); this.ocultar(); Central.mostrar(); },
  carregando() { this.abrir(); this.go.disabled = true; this.info.textContent = ''; this.body.innerHTML = '<p class="lg-msg">Carregando elencos do Brasileirão...</p>'; },
  /** Sem o JSON (ex.: página aberta direto do disco): pede o arquivo uma vez; a cópia fica guardada no navegador. */
  erroDados() {
    this.abrir(); this.go.disabled = true; this.info.textContent = '';
    this.body.innerHTML = `<div class="lg-card"><h3>Elencos não encontrados</h3><div class="lg-pad">
      <p class="lg-msg">Não consegui abrir <b>${Dados.URL}</b> ao lado do jogo. Se você abriu o <b>index.html</b> direto da pasta, o navegador bloqueia a leitura.
      Escolha o arquivo uma vez (ele fica guardado neste navegador) ou rode o jogo por um servidor local / GitHub Pages.</p>
      <label class="btn" for="pk-file">Escolher brasileirao2026.json</label><input id="pk-file" type="file" accept=".json,application/json" hidden>
      <p class="lg-msg" id="pk-err"></p>
      <button type="button" class="btn alt sm" data-a="menu">Ir para treino e amistoso</button></div></div>`;
  },
};
Escolha.el.addEventListener('click', e => {
  const c = e.target.closest('.pk-card'); if (c) return Escolha.escolher(+c.dataset.i);
  if (e.target.closest('#pk-go')) return Escolha.iniciar();
  if (e.target.closest('[data-a="menu"]')) openMenu();
});
Escolha.el.addEventListener('change', async e => {
  if (e.target.id !== 'pk-file') return;
  const f = e.target.files[0]; if (!f) return;
  if (!Dados.usarTexto(await f.text())) { $id('pk-err').textContent = 'Arquivo inválido: preciso de 20 clubes com 11 titulares cada.'; return; }
  Liga.prepararDados(); if (Liga.carregar()) Central.mostrar(); else Escolha.mostrar();
});

/* ------------------------------- Central do Campeonato ------------------------------- */
const Central = {
  el: $id('liga'), ver: 0, armado: null,
  aberta() { return this.el.classList.contains('show'); },
  ocultar() { this.el.classList.remove('show'); },
  /** A partida do usuário nesta rodada já está rolando (dá para retomar sem perder o placar). */
  emAndamento() { const fx = Liga.jogoDoUsuario(); return !!(fx && game.lineups && game.match && !game.match.over && game.match.fx === fx); },
  mostrar() {
    Escolha.ocultar(); $id('menu').classList.remove('show'); game.menuOpen = true; game.input.cancel();
    this.ver = Liga.acabou ? Liga.total - 1 : Math.max(0, Liga.S.round - 1);       // placar: última rodada concluída (ou a 1ª, antes de jogar)
    this.el.classList.add('show'); this.render(); this.el.scrollTop = 0;
  },
  jogar() {
    const fx = Liga.jogoDoUsuario(); if (!fx) return;
    if (this.emAndamento()) { this.ocultar(); game.menuOpen = false; game.input.cancel(); return; }   // retomar: uniformes já escolhidos
    Uniformes.abrir(fx);                                                                              // antes de cada partida: escolher os uniformes
  },
  simular() { if (this.emAndamento() || Liga.acabou) return; Liga.simularUsuario(); this.mostrar(); },
  reiniciar(btn) {
    if (this.armado) {
      clearTimeout(this.armado); this.armado = null;
      Liga.reiniciar(); game.sairLiga(); game.started = false; game.newMatch(); this.ocultar(); Escolha.mostrar(); return;
    }
    btn.textContent = 'Toque de novo para apagar o campeonato'; btn.classList.add('danger');
    this.armado = setTimeout(() => { this.armado = null; btn.textContent = 'Reiniciar campeonato'; btn.classList.remove('danger'); }, 4000);
  },

  render() {
    const S = Liga.S, me = Liga.L[S.user], tab = Liga.tabela(), pos = i => tab.findIndex(t => t.i === i) + 1;
    const fx = Liga.jogoDoUsuario(), and = this.emAndamento(), fim = Liga.acabou, rodada = fim ? Liga.total : S.round + 1;
    let h = `<div class="lg-wrap">
      <header class="lg-head">
        <div class="lg-id">${strip(me.vis)}<div><span class="lg-eyebrow">${esc(Dados.json.campeonato || 'Campeonato')}</span><b class="lg-club">${esc(me.nome)}</b></div></div>
        <div class="lg-round"><span>${fim ? 'ENCERRADO' : 'RODADA'}</span><b>${fim ? Liga.total + '/' + Liga.total : rodada + '/' + Liga.total}</b></div>
        <div class="lg-actions">
          <button type="button" class="btn alt sm som-btn" aria-pressed="true">SOM: ON</button>
          <button type="button" class="btn alt sm" data-a="menu">Menu</button>
          <button type="button" class="btn alt sm" data-a="tat">Tática</button>
          ${fim ? '' : `<button type="button" class="btn lg-play" data-a="play">${and ? 'Retomar partida' : 'Jogar partida'}</button>`}
        </div>
      </header>`;
    if (fim) h += this.final(tab, pos);
    h += `<div class="lg-grid">`;
    if (fx) h += `<section class="lg-card a-next">${this.proximo(fx, tab, pos)}</section>`;
    h += `<section class="lg-card a-tat">${Painel.cartaoCentral()}</section>
          <section class="lg-card a-tab">${this.classificacao(tab)}</section>
          <section class="lg-card a-rod">${this.placar()}</section>
          <section class="lg-card a-art">${this.artilharia()}</section>
        </div>
        <div class="lg-foot">${fx && !and ? '<button type="button" class="btn alt sm" data-a="sim">Simular minha partida</button>' : ''}
          <button type="button" class="btn alt sm" data-a="reset">Reiniciar campeonato</button></div>
      </div>`;
    this.el.innerHTML = h; Som.atualizarBotoes();
  },

  /** Card do próximo confronto: mando, overall médio, notas e prévia. */
  proximo(fx, tab, pos) {
    const me = Liga.L[Liga.S.user], casa = fx.h === Liga.S.user, op = Liga.L[casa ? fx.a : fx.h], jogou = tab.find(t => t.i === me.idx).J > 0;
    const forma = i => { const f = Liga.forma(i); return f.length ? f.map(x => `<i class="fm ${x}">${x}</i>`).join('') : '<span class="mute">—</span>'; };
    const craque = L => { const c = L.tit.slice().sort((a, b) => b.ovr - a.ovr)[0]; return `${esc(c.nomeFalado)} <small>${c.ovr}</small>`; };
    const dif = me.ovr - op.ovr, quem = Math.abs(dif) < 1.5 ? 'Confronto equilibrado' : dif > 0 ? `${esc(me.nome)} chega com a vantagem de overall` : `${esc(op.nome)} chega com a vantagem de overall`;
    const pv = (a, rot, b) => `<div class="pv"><span>${a}</span><em>${rot}</em><span>${b}</span></div>`;
    return `<h3>Próximo confronto <span class="badge ${casa ? 'casa' : 'fora'}">${casa ? 'Em casa' : 'Fora de casa'}</span></h3>
      <div class="lg-vs">
        <div class="vs-t">${strip(me.vis)}<b>${esc(me.nome)}</b><small>${casa ? 'CASA' : 'FORA'}</small></div>
        <div class="vs-x">X</div>
        <div class="vs-t r">${strip(op.vis)}<b>${esc(op.nome)}</b><small>${casa ? 'FORA' : 'CASA'}</small></div>
      </div>
      <div class="lg-pad">
        ${pv(me.ovr.toFixed(1), 'OVR médio dos titulares', op.ovr.toFixed(1))}
        ${pv(Math.round(me.ataque), 'Ataque', Math.round(op.ataque))}
        ${pv(Math.round(me.defesa), 'Defesa', Math.round(op.defesa))}
        ${pv(jogou ? pos(me.idx) + 'º' : '—', 'Classificação', jogou ? pos(op.idx) + 'º' : '—')}
        ${pv(forma(me.idx), 'Últimos 5', forma(op.idx))}
        ${pv(craque(me), 'Destaque', craque(op))}
        <p class="lg-prev">${quem}.</p>
      </div>`;
  },

  /** Tabela completa (20 times). */
  classificacao(tab) {
    const n = tab.length, u = Liga.S.user;
    const rows = tab.map((t, k) => {
      const L = Liga.L[t.i], z = k < 4 ? ' z-lib' : k >= n - 4 ? ' z-rb' : k < 6 ? ' z-pre' : '';
      return `<tr class="${t.i === u ? 'me' : ''}${z}"><td class="pos">${k + 1}</td><td class="cl">${strip(L.vis)}<b>${nomeDe(t.i)}</b></td>
        <td class="pt">${t.P}</td><td>${t.J}</td><td>${t.V}</td><td>${t.E}</td><td>${t.D}</td><td>${t.GP}</td><td>${t.GC}</td><td>${t.SG > 0 ? '+' : ''}${t.SG}</td></tr>`;
    }).join('');
    return `<h3>Classificação</h3><div class="tbl-w"><table class="tbl"><thead><tr><th>Pos</th><th class="cl">Clube</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="lg-leg"><i class="z-lib"></i>G4 <i class="z-pre"></i>G6 <i class="z-rb"></i>Z4</div>`;
  },

  /** Resultados da rodada (com os autores dos gols); setas navegam entre as rodadas. */
  placar() {
    const r = this.ver, rod = Liga.S.fx[r].slice(), u = Liga.S.user;
    rod.sort((a, b) => (b.h === u || b.a === u) - (a.h === u || a.a === u));
    const gols = (f, lado) => {
      const m = new Map(); for (const [min, l, nome] of f.g) if (l === lado) m.set(nome, [...(m.get(nome) || []), min + "'"]);
      return [...m].map(([n, ms]) => `${esc(Elenco.falado(n))} ${ms.join(' ')}`).join('<br>');
    };
    const rows = rod.map(f => {
      const done = Liga.feito(f), mine = f.h === u || f.a === u;
      return `<div class="rd${mine ? ' me' : ''}"><div class="rd-t"><span class="rd-h"><b>${nomeDe(f.h)}</b>${strip(Liga.L[f.h].vis)}</span>
        <span class="rd-s">${done ? `${f.hg}<em>x</em>${f.ag}` : '<em>x</em>'}</span><span class="rd-a">${strip(Liga.L[f.a].vis)}<b>${nomeDe(f.a)}</b></span></div>
        ${done && f.g.length ? `<div class="rd-g"><span>${gols(f, 'h')}</span><span class="rd-c"></span><span>${gols(f, 'a')}</span></div>` : ''}</div>`;
    }).join('');
    const jogada = Liga.S.round > r;
    return `<h3>Placar da rodada</h3><div class="rd-nav"><button type="button" class="btn alt sm" data-a="prev" ${r === 0 ? 'disabled' : ''} aria-label="Rodada anterior">&lsaquo;</button>
      <span>RODADA ${r + 1} <small>${jogada ? 'encerrada' : r === Liga.S.round ? 'a jogar' : 'a disputar'}</small></span>
      <button type="button" class="btn alt sm" data-a="next" ${r >= Liga.total - 1 ? 'disabled' : ''} aria-label="Próxima rodada">&rsaquo;</button></div>${rows}`;
  },

  artilharia() {
    const a = Liga.artilharia().slice(0, 10);
    if (!a.length) return '<h3>Artilharia</h3><p class="lg-msg lg-pad">Nenhum gol marcado ainda.</p>';
    return `<h3>Artilharia</h3><table class="tbl art"><tbody>${a.map((o, k) => `<tr class="${o.clube === Liga.S.user ? 'me' : ''}"><td class="pos">${k + 1}</td>
      <td class="cl"><b>${esc(o.nome)}</b></td><td class="sgc">${strip(Liga.L[o.clube].vis)}${esc(Liga.L[o.clube].sg)}</td><td class="pt">${o.gols}</td></tr>`).join('')}</tbody></table>`;
  },

  final(tab, pos) {
    const camp = Liga.L[tab[0].i], eu = pos(Liga.S.user), art = Liga.artilharia()[0];
    return `<section class="lg-card lg-final"><h3>Campeonato encerrado</h3><div class="lg-pad">
      <p>Campeão: <b>${esc(camp.nome)}</b>${tab[0].i === Liga.S.user ? ' (você!)' : ''}. Seu clube terminou em <b>${eu}º</b> lugar com ${tab[eu - 1].P} pontos.</p>
      ${art ? `<p>Artilheiro: <b>${esc(art.nome)}</b> (${esc(Liga.L[art.clube].nome)}), ${art.gols} gols.</p>` : ''}
      <button type="button" class="btn" data-a="reset">Novo campeonato</button></div></section>`;
  },
};
Central.el.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  switch (b.dataset.a) {
    case 'play': Central.jogar(); break;
    case 'sim': Central.simular(); break;
    case 'menu': openMenu(); break;
    case 'tat': Painel.abrir('central'); break;
    case 'reset': Central.reiniciar(b); break;
    case 'prev': Central.ver = Math.max(0, Central.ver - 1); Central.render(); break;
    case 'next': Central.ver = Math.min(Liga.total - 1, Central.ver + 1); Central.render(); break;
  }
});

/* ------------------------------- Uniformes da partida ------------------------------- */
/** Antes de cada partida do campeonato: o usuário escolhe o uniforme (titular/reserva) do seu time e do adversário. */
const Uniformes = {
  el: $id('kits'), fx: null, esc: null,
  aberta() { return this.el.classList.contains('show'); },
  ocultar() { this.el.classList.remove('show'); },
  /** Volta da tela Tática & Elenco aberta no pré-jogo (as escolhas de uniforme continuam as mesmas). */
  reabrir() { if (!this.fx) return Central.mostrar(); this.el.classList.add('show'); game.menuOpen = true; game.input.cancel(); },
  abrir(fx) {
    const u = Liga.S.user, casa = fx.h === u, us = Liga.L[u], op = Liga.L[casa ? fx.a : fx.h], sug = Elenco.sugestao(Liga.L[fx.h], Liga.L[fx.a]);
    this.fx = fx; this.esc = { us: casa ? sug.casa : sug.fora, op: casa ? sug.fora : sug.casa };
    Central.ocultar(); this.el.classList.add('show'); this.el.scrollTop = 0; game.menuOpen = true; game.input.cancel();
    this.render(us, op, casa);
  },
  /** Boneco do jogo (o craque do time) vestindo o uniforme, desenhado pelo mesmo renderizador do campo. */
  boneco(cv, L, kit) {
    const p = L.tit.filter(q => q.slotPos !== 'GK').sort((a, b) => b.ovr - a.ovr)[0], dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = cv.clientWidth || 88, h = cv.clientHeight || 104; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'), s = (h * dpr) / (Sprites.H * Sprites.PX) * 0.95;
    ctx.setTransform(s, 0, 0, s, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const j = { x: (w * dpr / s) / 2, y: (h * dpr / s) * 0.83 - Sprites.PES_DY, facing: Math.PI / 2, visual: Elenco.visual(p, kit), estadoAnim: Object.assign(Visual.novoEstado(), { dir: 4 }) };   // dir 4 = de frente para a câmera
    desenharJogador(ctx, j);
  },
  render(us, op, casa) {
    const lado = (L, k, quem, mando) => `<section class="kt-time" data-lado="${k}">
        <h3>${strip(L.vis)}<b>${esc(L.nome)}</b><small>${quem} · ${mando}</small></h3>
        <div class="kt-ops">${[0, 1].map(i => { const v = L.vis.kits[i]; return `<button type="button" class="kt-op" data-lado="${k}" data-i="${i}" aria-pressed="false">
          <canvas class="kt-cv" data-lado="${k}" data-i="${i}" aria-hidden="true"></canvas>
          <span class="kt-n">${Elenco.NOMES_KIT[i]}</span><span class="kt-c">${[v.a, v.b, v.c, v.cal].filter(Boolean).map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`; }).join('')}</div>
      </section>`;
    this.el.innerHTML = `<div class="lg-wrap kt-wrap">
      <header class="kt-head"><span class="lg-eyebrow">Rodada ${Liga.S.round + 1} · antes de entrar em campo</span><h2>Uniformes da <span>partida</span></h2>
        <p>Escolha o uniforme do seu time e o do adversário. Confira a escalação em Tática &amp; Elenco antes de entrar.</p></header>
      <div class="kt-grid">${(() => { const meu = lado(us, 'us', 'Seu time', casa ? 'em casa' : 'fora de casa'), deles = lado(op, 'op', 'Adversário', casa ? 'fora de casa' : 'em casa');
        return casa ? meu + deles : deles + meu; })()}</div>                                    <!-- mandante sempre à esquerda, visitante à direita -->
      <div class="kt-foot"><button type="button" class="btn alt" data-a="voltar">Voltar</button><button type="button" class="btn alt" data-a="tat">Tática &amp; Elenco</button>
        <button type="button" class="btn lg-play" data-a="ok">Entrar em campo</button></div>
    </div>`;
    this.L = { us, op }; this.marcar();
    for (const cv of this.el.querySelectorAll('.kt-cv')) { const L = this.L[cv.dataset.lado]; this.boneco(cv, L, Elenco.kit(L, +cv.dataset.i)); }
  },
  /** Destaca a escolha atual de cada lado (a decisão é do usuário; nenhum aviso). */
  marcar() {
    for (const b of this.el.querySelectorAll('.kt-op')) { const on = +b.dataset.i === this.esc[b.dataset.lado]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  },
  confirmar() {
    const fx = this.fx; if (!fx) return;
    this.ocultar(); game.startLeagueMatch(fx, { ...this.esc }); game.menuOpen = false; game.input.cancel();
  },
};
Uniformes.el.addEventListener('click', e => {
  const op = e.target.closest('.kt-op'); if (op) { Uniformes.esc[op.dataset.lado] = +op.dataset.i; return Uniformes.marcar(); }
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'voltar') { Uniformes.ocultar(); Central.mostrar(); }
  if (b.dataset.a === 'tat') Painel.abrir('kits');
  if (b.dataset.a === 'ok') Uniformes.confirmar();
});

/** Menu > Continuar campeonato: abre a Central do campeonato salvo (se o save não servir mais, cai na escolha do clube). */
function continuarCampeonato() { if (Liga.S) Central.mostrar(); else iniciarCampeonato(); }

/** Menu > Novo campeonato: apaga o save (o menu já pediu confirmação), sai de uma partida do campeonato em andamento e abre a escolha do clube. */
async function novoCampeonato() {
  Liga.reiniciar();
  if (game.lineups) { game.sairLiga(); game.started = false; game.newMatch(); }
  Escolha.carregando();
  if (!(await Dados.carregar())) return Escolha.erroDados();
  Liga.prepararDados();
  Escolha.mostrar();
}

/** Carrega os elencos e abre a Central (campeonato salvo) ou a escolha do clube (primeira vez). */
async function iniciarCampeonato() {
  Escolha.carregando();
  if (!(await Dados.carregar())) return Escolha.erroDados();
  Liga.prepararDados();
  if (Liga.carregar()) Central.mostrar(); else Escolha.mostrar();
}

export { Clubes, Elenco, Liga, Sim, Central, Escolha, Uniformes, Dados, iniciarCampeonato, continuarCampeonato, novoCampeonato };
