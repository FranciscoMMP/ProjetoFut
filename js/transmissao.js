import { Rnd, Tactics, Scenarios, CFG, Util, Game, Gen } from './motor-campo.js';
import { Liga, Elenco, Sim } from './campeonato.js';
import { syncSliders } from './main.js';
import { Cores, Estadio } from './render-sprites.js';
import { Som } from './audio.js';

/* =============================================================================
   TRANSMISSÃO: narração (Ctx + bancos de frases), relógio da partida, minuto a minuto, cartões, gols do adversário,
   aviso do lance decisivo -> campo em tela cheia -> resultado de volta ao feed, placar/HUD e fim de jogo.
   Os métodos de TransmissaoMetodos são da classe Game (usam this = o jogo); instalarTransmissao(Game) os copia para o protótipo.
   ============================================================================= */

/* ----------------------- Narração: contexto com nomes reais ----------------------- */
/**
 * Sorteia nomes reais dos titulares para as frases. Sem campeonato (treino/amistoso) devolve "camisa N" e "seu time" / "Adversário".
 * Fichas das frases: {U} {u} seu clube | {O} {o} clube adversário | {ua} {um} {ud} {ug} {up} atacante/meia/zagueiro/goleiro/qualquer jogador do SEU time |
 * {oa} {om} {od} {og} {op} idem do adversário (um dígito no fim, ex. {um2}, pede outro jogador) | {S} {A} {C} {T} {R} nomes dados pelo jogo.
 */
class Ctx {
  constructor(us, op) { this.us = us || null; this.op = op || null; }
  club(lado, minus) {
    const L = lado === 'us' ? this.us : this.op;
    if (L) return L.nome;
    return lado === 'us' ? (minus ? 'seu time' : 'Seu time') : (minus ? 'o Adversário' : 'Adversário');
  }
  /** Jogador sorteado: papel a (ataque), m (meio), d (defesa), g (goleiro), p (qualquer de linha). */
  jog(lado, papel) {
    const L = lado === 'us' ? this.us : this.op;
    if (!L) return papel === 'g' ? 'o goleiro' : 'camisa ' + Rnd.i(2, 11);
    const pool = papel === 'a' ? L.ata : papel === 'm' ? L.mei : papel === 'd' ? L.def : papel === 'g' ? [L.gk] : L.tit.filter(p => p.slotPos !== 'GK');
    return Rnd.pick(pool).nomeFalado;
  }
  /** Goleiro. */
  goleiro(lado) { return this.jog(lado, 'g'); }
  /** Troca as fichas {..} de um modelo de frase. `ex` traz nomes definidos pelo jogo (autor do gol, quem desarmou...). */
  fmt(t, ex = {}) {
    const memo = {}, usados = new Set(Object.values(ex));
    const s = t.replace(/\{(\w+)\}/g, (_, k) => {
      if (k in ex) return ex[k];
      if (k === 'U') return this.club('us'); if (k === 'u') return this.club('us', true);
      if (k === 'O') return this.club('op'); if (k === 'o') return this.club('op', true);
      const m = /^([uo])([amdgp])\d?$/.exec(k); if (!m) return '';
      if (memo[k]) return memo[k];
      let nm; for (let i = 0; i < 8; i++) { nm = this.jog(m[1] === 'u' ? 'us' : 'op', m[2]); if (!usados.has(nm)) break; }
      usados.add(nm); return (memo[k] = nm);
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

/* ------------------------ Narração da transmissão (ETAPA 7 + nomes) ------------------------ */
/** Bancos de frases do minuto a minuto (ver as fichas em Ctx). Passes, infiltrações, desarmes da zaga, defesas, cartões, escanteios e gols. */
const Narracao = {
  US: ['{ua} recebe de {um} e tenta a infiltração, mas a zaga fecha o espaço.', '{um} e {um2} trocam passes no meio-campo e não acham linha de passe.',
       '{U} sobe a marcação e {um} pressiona a saída de bola.', '{ua} tenta o drible em cima de {od} e perde a bola.',
       'Lançamento de {um} para {ua}, mas {od} antecipa e afasta.', '{ud} sai jogando com calma e acha {um} no círculo central.',
       'Boa triangulação entre {um}, {ua} e {ua2}, mas a bola volta para trás.', '{ua} se infiltra pela meia-esquerda e {od} faz a cobertura.',
       '{um} arrisca o passe em profundidade e a defesa corta.', 'Cruzamento de {ud} para a área e {od} rebate de cabeça.'],
  OPP: ['{oa} tenta ligação direta para {oa2}, mas {ud} afasta.', '{O} troca passes sem perigo e {om} recua a bola para {od}.', '{om} erra o passe e entrega a bola para {um}.',
        '{O} pressiona a saída de bola, mas {ud} resolve.', 'Bola longa de {od} e {ug} sai do gol para ficar com ela.', '{oa} cruza na área e {ud} afasta sem dificuldade.',
        '{om} tenta o chute de longe e {um} bloqueia.', '{oa} recebe de costas, gira, e a zaga fecha rápido.'],
  MID: ['Jogo truncado no meio-campo: {um} e {om} disputam cada bola.', 'A bola não para com ninguém: disputa intensa no círculo central.', 'Equilíbrio total, os times se estudam.',
        'Jogo corrido, mas nenhum dos times cria perigo.', 'A torcida empurra e a bola rola sem dono no meio.'],
  DESARME_US: ['{ud} chega firme em {oa} e recupera a bola para {U}.', '{ud} desarma {oa} com um carrinho limpo!', '{ud} faz o corte providencial e evita o perigo.'],
  DESARME_OPP: ['{od} desarma {ua} na entrada da área.', '{od} chega antes de {ua} e afasta o perigo.', '{od} faz o desarme firme em {um} e o contra-ataque nasce.'],
  FOUL_US: ['{um} derruba {oa} no meio-campo. O árbitro apita.', 'Entrada forte de {ud} em {oa}, falta marcada.'],
  FOUL_OPP: ['Falta de {od} em {ua}! O árbitro marca.', '{om} derruba {um} e o juiz paralisa o jogo.', 'Falta dura de {od}. {U} ganha fôlego.'],
  YELLOW: ['Cartão amarelo para {X}! Entrada atrasada em {Y}.', 'Amarelo para {X} por reclamação.', 'Cartão amarelo para {X}! Falta por trás em {Y}.', '{X} é advertido com o cartão amarelo.'],
  SECOND_US: 'Segundo amarelo e EXPULSÃO de {X}! {U} fica com um a menos.',
  SECOND_OPP: 'Segundo amarelo e EXPULSÃO de {X}! {U} joga com um a mais.',
  RED_US: 'EXPULSO! {X} leva o vermelho direto. {U} fica com um a menos!',
  RED_OPP: 'EXPULSO! {X} vê o vermelho direto. {U} joga com um a mais!',
  CORNER_US: ['A zaga desvia o cruzamento de {um} e a bola sai pela linha de fundo: escanteio para {u}.', 'Escanteio para {u}! {ua} força o corte e {ug} fica de olho.'],
  CORNER_OPP: ['Escanteio para {o}. {ud} afasta de cabeça.', '{o} ganha escanteio, mas {ug} sai bem e fica com a bola.'],
  SAVE: ['{ug} salta e defende a finalização de {oa} no canto! Que reflexo!', 'DEFESAÇA de {ug}! {oa} bate forte e ele espalma para escanteio.', '{oa} chuta cruzado e {ug} faz a defesa com os pés!'],
  OPP_MISS: ['{oa} chuta de longe e a bola passa perto da trave!', 'Cabeçada de {oa} vai por cima do gol.', '{oa} finaliza mal e a bola sai pela linha de fundo.'],
  US_WASTE: ['{ua} arrisca de longe e a bola vai por cima.', '{og} faz boa defesa em chute de {ua}.', 'Finalização de {um} é bloqueada por {od}.', 'Chute de fora da área de {um} passa rente à trave!'],
  OPP_GOAL: ['Chute cruzado de {S}, sem chance para {ug}.', 'Contra-ataque rápido: {A} lança e {S} finaliza com categoria.', 'Cabeceio firme de {S} depois do cruzamento de {A}.',
             'Falha na marcação de {ud} e {S} bate com liberdade no canto.', 'Bomba de fora da área de {S}, no ângulo!'],
  /** Aviso de "é a sua chance!" por tipo de lance ({C} = quem está com a bola). */
  HEAD: {
    contra: '{C} sai em CONTRA-ATAQUE perigoso! É a sua chance!', entrada: '{C} recebe na entrada da área! É a sua chance!', parada: 'FALTA PERIGOSA a favor! {C} vai para a cobrança. É a sua chance!',
    ponta: '{C} recebe aberto na ponta e vai cruzar. É a sua chance!', fechada: '{O} se fecha na área, mas a bola está com {C}! É a sua chance!', posicional: '{U} domina a posse e {C} acha o espaço! É a sua chance!',
    escanteio: 'ESCANTEIO a favor! {C} vai à bola, área cheia. É a sua chance!', penalti: 'PÊNALTI! {C} pega a bola. É a sua chance!', um_x_um: 'CARA A CARA com {og}! {C} está sozinho. É a sua chance!',
    costas: '{C} recebe nas costas da zaga! É a sua chance!', roubada: '{C} rouba a bola no ataque! É a sua chance!', lado: '{C} acumula pelo lado com os companheiros! É a sua chance!',
    fundo: '{C} chega à linha de fundo! É a sua chance!', rebote: 'A bola sobrou para {C} na entrada da área! É a sua chance!', bloco: '{C} tem espaço para o chute de fora! É a sua chance!',
  },
  /** Resultado do lance jogado: chave = mensagem do jogo. */
  RES: {
    'DEFENDEU!': ['save', 'DEFENDEU! {og} faz a defesa e segura o placar.'],
    'PARA FORA!': ['miss', 'PARA FORA! {S} finaliza e a bola passa longe do gol... que chance!'],
    'IMPEDIMENTO!': ['flag', 'IMPEDIMENTO! {R} estava adiantado. O bandeirinha levanta a bandeira e anula a jogada.'],
    'DESARMADO!': ['miss', 'DESARMADO! {T} chega firme e rouba a bola de {C}.'],
    'TEMPO ESGOTADO!': ['miss', 'A jogada esfria: {C} demorou e a defesa se reorganizou.'],
    'TOQUE DUPLO!': ['flag', 'TOQUE DUPLO de {C}! O árbitro anula a cobrança.'],
    'BOLA PERDIDA!': ['miss', 'BOLA PERDIDA! A jogada de {C} passou do limite e morreu.'],
    'PÊNALTI PERDIDO!': ['miss', 'PÊNALTI PERDIDO! {C} chutou errado...'],
  },
  GOL_US: { abre: 'GOLAÇO! {S} abre o placar para {u}!', empata: 'GOLAÇO! {S} empata a partida!', diminui: 'GOL! {S} diminui a desvantagem!', frente: 'GOLAÇO! {S} coloca {u} na frente!', amplia: 'GOL! {S} amplia a vantagem!' },
};

/* ------------------- Cores dos lances na narração (cada time com a sua, texto de alto contraste) ------------------- */
const FUNDO_FEED = '#111417', TEXTO_CLARO = '#ffffff', TEXTO_ESCURO = '#0b0d0f';
/** Luminância relativa e razão de contraste (WCAG 2.x). */
const lumRel = hex => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = Cores.rgb(hex); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contraste = (a, b) => { const x = lumRel(a), y = lumRel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const distCor = (a, b) => { const p = Cores.rgb(a), q = Cores.rgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
/**
 * Cor da faixa dos lances de um time — SEMPRE uma cor do próprio uniforme em campo (cands, em ordem: camisa, detalhe, 3ª cor, calção).
 * Usa a 1ª cor que não se pareça com a do outro time (evitar); se nenhuma servir, a mais diferente delas.
 * Cor escura que some no fundo da narração (camisa preta, por exemplo) continua sendo a cor do time, mas ganha contorno (ol) na cor
 * do próprio uniforme mais visível. Texto branco ou quase preto, o de maior contraste com a faixa.
 */
function corDoTime(cands, evitar) {
  const cs = [...new Set(cands.filter(Boolean))];
  const bg = (evitar ? cs.find(c => distCor(c, evitar) >= 130) || cs.slice().sort((a, b) => distCor(b, evitar) - distCor(a, evitar))[0] : cs[0]) || '#4b5563';
  const fg = contraste(bg, TEXTO_CLARO) >= contraste(bg, TEXTO_ESCURO) ? TEXTO_CLARO : TEXTO_ESCURO;
  const someNoFundo = contraste(bg, FUNDO_FEED) < 1.45;
  const realce = someNoFundo ? (cs.filter(c => c !== bg).sort((a, b) => contraste(b, FUNDO_FEED) - contraste(a, FUNDO_FEED))[0] || '#e5e7eb') : null;
  return { bg, fg, bd: realce || Cores.tint(bg, lumRel(bg) > 0.35 ? -0.35 : 0.4), ol: realce || 'transparent' };
}

/* ------------------------------ Métodos da transmissão (classe Game) ------------------------------ */
class TransmissaoMetodos {
  /* ----- Campeonato na partida: começar, uniformes/siglas, placar com mando, registro do resultado ----- */
  /** Começa a partida do usuário na rodada: veste os times, converte o elenco nos atributos do jogo e abre a transmissão. */
  startLeagueMatch(fx, esc) {
    const eu = Liga.S.user, us = Liga.L[eu], op = Liga.L[fx.h === eu ? fx.a : fx.h];
    Elenco.vestir(us, op, esc || { us: 0, op: 0 });
    this.lineups = { us, op }; this.cx = new Ctx(us, op); this.fora = fx.a === eu; this.fxAtual = fx;
    Tactics.forms.us = Tactics.forms.opp = Elenco.FORM;
    for (const [id, k] of [['s-fa', 'us'], ['s-fd', 'opp']]) document.getElementById(id).value = Tactics.forms[k];
    this.forceScn = 'rand'; document.getElementById('s-scn').value = 'rand'; Scenarios.forceN = 0; this.showAids = false; document.getElementById('s-aids').checked = false;
    this.stash = null; Object.assign(this.attr, Elenco.attr(us, op)); syncSliders();
    document.body.classList.remove('train'); document.body.classList.add('liga'); this.$('cfg').classList.remove('open');
    this.mode = 'match'; this.started = true; this.$('next').textContent = 'Pular lance';
    this.mostrarTimes();
    this.newMatch(); this.match.fx = fx;
  }
  /** Volta ao modo sem campeonato (treino/amistoso): nomes e uniformes genéricos. */
  sairLiga() { this.lineups = null; this.cx = new Ctx(); this.fora = false; this.fxAtual = null; document.body.classList.remove('liga'); this.mostrarTimes(); }
  /** Siglas e cores de cada lado nos placares (quem joga em casa fica à esquerda). */
  mostrarTimes() {
    const L = this.lineups;
    const cor = t => t.kitJogo ? { a: t.kitJogo.camisaPrimaria, b: t.kitJogo.camisaSecundaria } : { a: t.vis.a, b: t.vis.b };
    const eu = L ? { sg: L.us.sg, ...cor(L.us), nome: L.us.nome } : { sg: 'MEU', a: '#facc15', b: '#15803d', nome: 'Meu Time' };
    const rv = L ? { sg: L.op.sg, ...cor(L.op), nome: L.op.nome } : { sg: 'ADV', a: '#dc2626', b: '#f8fafc', nome: 'Adversário' };
    const [l, r] = this.fora ? [rv, eu] : [eu, rv], lEu = !this.fora;
    this.$('tv-ln').textContent = l.sg; this.$('tv-rn').textContent = r.sg;
    for (const [id, t] of [['tv-ls', l], ['tv-rs', r]]) { const s = this.$(id); s.style.setProperty('--a', t.a); s.style.setProperty('--b', t.b); }
    this.$('tv-l').title = l.nome; this.$('tv-r').title = r.nome;
    this.$('tv-l').className = 'tv-team home ' + (lEu ? 'me' : 'rv'); this.$('tv-r').className = 'tv-team away ' + (lEu ? 'rv' : 'me');
    this.$('h-l').textContent = L ? l.sg : (lEu ? 'MEU TIME' : 'ADVERSÁRIO'); this.$('h-r').textContent = L ? r.sg : (lEu ? 'ADVERSÁRIO' : 'MEU TIME');
    this.$('h-l').className = lEu ? 'us' : 'op'; this.$('h-r').className = lEu ? 'op' : 'us';
    const kc = t => t && t.kitJogo ? [t.kitJogo.camisaPrimaria, t.kitJogo.camisaSecundaria, t.kitJogo.camisaTerciaria, t.kitJogo.calcao] : null;
    const cu = corDoTime(kc(L && L.us) || [eu.a, eu.b]), co = corDoTime(kc(L && L.op) || [rv.a, rv.b], cu.bg), fd = this.$('bc-feed');
    for (const [k, c] of [['us', cu], ['op', co]]) for (const p of ['bg', 'fg', 'bd', 'ol']) fd.style.setProperty(`--${k}-${p}`, c[p]);   // usadas por .ev.t-us / .ev.t-op
    // Estádio do MANDANTE: torcida e decoração com as cores tradicionais (camisa titular) de cada clube
    const tradicao = (t, a, b) => t ? { sg: t.sg, cores: [t.vis.a, t.vis.b, t.vis.c].filter(Boolean) } : { sg: a, cores: b };
    const meu = tradicao(L && L.us, 'MEU', ['#facc15', '#15803d']), deles = tradicao(L && L.op, 'ADV', ['#dc2626', '#f8fafc']);
    const [casa, fora] = this.fora ? [deles, meu] : [meu, deles];
    Estadio.montar(casa, fora);
    this.$('bc-head').style.setProperty('--torcida', `url(${Estadio.cfg.torCasa[0].toDataURL()})`);   // fundo do placar da transmissão
  }
  /** [gols da esquerda, gols da direita] nos placares. */
  lr() { const m = this.match; return this.fora ? [m.away, m.home] : [m.home, m.away]; }
  /** "Flamengo 2 x 1 Vasco" (campeonato) ou "MEU TIME 2 x 1 ADVERSÁRIO". */
  placarTxt() {
    const [l, r] = this.lr(), L = this.lineups;
    if (!L) return `MEU TIME ${l} x ${r} ADVERSÁRIO`;
    const [a, b] = this.fora ? [L.op, L.us] : [L.us, L.op];
    return `${a.nome} ${l} x ${r} ${b.nome}`;
  }
  /** Campeonato: grava o resultado, simula os outros 9 jogos da rodada (bots) e salva. */
  registrarLiga() {
    const m = this.match, fx = m.fx, casa = fx.h === Liga.S.user;
    const g = m.log.slice().sort((a, b) => a.min - b.min).map(e => [Math.max(1, Math.min(90, e.min)), (e.us === casa) ? 'h' : 'a', e.scorer || 'Autor não informado']);
    Liga.concluirRodada(fx, casa ? m.home : m.away, casa ? m.away : m.home, g);
  }

  /** MODO LANCES DE PARTIDA: devolve os atributos escolhidos pelo jogador e começa uma partida nova. */
  startMatch() {
    this.sairLiga();
    if (this.stash) { Object.assign(this.attr, this.stash); this.stash = null; if (typeof syncSliders === 'function') syncSliders(); }
    this.mode = 'match'; this.started = true;
    document.body.classList.remove('train'); this.$('next').textContent = 'Pular lance';
    this.newMatch();
  }

  /* ----- Partida: TRANSMISSÃO AO VIVO + lances jogáveis (ETAPA 7) ----- */
  /**
   * Dois modos alternados (this.view):
   *   'broadcast' : tela de transmissão (texto minuto a minuto). O campo fica escondido; o motor da física fica PAUSADO.
   *   'play'      : o canvas do campo em tela cheia, para você jogar um dos 4-6 lances decisivos da partida.
   * Fases da transmissão (match.phase): 'run' (relógio correndo) | 'pause' (intervalo / respiro após o lance) |
   * 'prompt' (aviso "É a sua chance!", 1 s) | 'play' (jogando no campo) | 'final' (apito final) | 'end' (resumo).
   */
  newMatch() {
    this.match = this.freshMatch();
    this.lastType = null; this._hudKey = '';
    this.$('end').classList.remove('show');
    this.$('bc-feed').innerHTML = ''; this.$('bc-stpanel').classList.remove('show');
    this.match.plan = this.planPlays(); this.match.total = this.match.plan.length;
    this.loadScenario(Scenarios.make(this.match.plan[0].type));      // só para o motor ter um estado válido; o lance de verdade é sorteado ao jogar
    this.view = 'broadcast'; this.setBroadcastUI(true);
    this.feed(0, 'info', '', this.lineups
      ? `RODADA ${Liga.S.round + 1} · COMEÇA O JOGO! ${this.lineups.us.nome} e ${this.lineups.op.nome}, ${this.fora ? 'fora de casa' : 'em casa'}. A bola rola no estádio lotado...`
      : 'COMEÇA O JOGO! A bola rola no estádio lotado...');
    if (this.started) Som.apito('curto');                         // apito inicial
  }
  /** Estado de uma partida nova. rhythm = "ritmo" da partida (sorteado), usado só na estimativa de equilíbrio. */
  freshMatch() {
    const g = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());   // normal(0,1)
    return { minute: 0, clock: 0, phase: 'run', pauseT: 0, after: null, cur: null, promptEl: null, plan: [], total: 0, goalsUs: 0,
             cards: { us: { y: 0, r: 0 }, opp: { y: 0, r: 0 } },
             home: 0, away: 0, over: false, plays: 0, log: [], stats: {}, simulated: false, rhythm: Math.exp(0.4 * g()), g, scheduled: 0,
             amarelos: new Set(), expulsos: new Set(), fx: null, registrado: false };
  }
  /** Sorteia os lances decisivos: um por "faixa" da partida (bem espalhados), nunca no intervalo, cada um com um tipo de cenário (pênalti raro, no máximo 1). */
  planPlays() {
    const n = this.lineups ? Elenco.qtdLances(this.lineups.us, this.lineups.op) : Rnd.i(CFG.BC_PLAYS[0], CFG.BC_PLAYS[1]), lo = 3, hi = 88, seg = (hi - lo) / n, plan = [];
    this.penPlanned = false;                                                     // pênalti: no máximo um por partida
    for (let k = 0; k < n; k++) {
      let min = Math.round(lo + (k + Rnd.r(0.15, 0.85)) * seg);
      if (min >= 44 && min <= 46) min = 47;
      if (plan.length && min <= plan[plan.length - 1].min + 3) min = plan[plan.length - 1].min + 4;
      min = Math.min(min, 87);
      const type = this.nextType(); this.lastType = type; if (type === 'penalti') this.penPlanned = true;
      plan.push({ min, type });
    }
    this.lastType = null;
    return plan;
  }
  /**
   * Chances do SEU time por minuto (só para a estimativa de equilíbrio mostrada nas Opções). Depende da força relativa
   * (seu ataque + sua defesa) x (ataque + defesa do adversário).
   */
  lanceRate(withRhythm = true) {
    const a = this.attr, atk = a.force * 0.2 + a.curve * 0.2 + a.speed * 0.2 + a.dribble * 0.25 + a.pos * 0.15, def = a.mark * 0.6 + a.reflex * 0.4;
    const us = 0.6 * atk + 0.4 * a.mdef, opp = 0.6 * a.oatk + 0.4 * def;
    const r = 0.155 * Math.exp(2.0 * (us - opp) / 100) * (withRhythm && this.match ? this.match.rhythm : 1);
    return Util.clamp(r, 0.03, 0.55);
  }
  nextType() {
    if (this.forceScn !== 'rand') return this.forceScn;
    const T = Scenarios.TYPES, w = T.map(k => k === this.lastType || (k === 'penalti' && this.penPlanned) ? 0 : Scenarios.WEIGHTS[k]);
    let r = Math.random() * w.reduce((s, v) => s + v, 0);
    for (let i = 0; i < T.length; i++) { r -= w[i]; if (r <= 0) return T[i]; }
    return T[0];
  }

  /* ----- Interface da transmissão ----- */
  /** Liga/desliga a tela de transmissão (fade) e leva o menu de Config junto. */
  setBroadcastUI(on) {
    document.body.classList.toggle('bc-on', on);
    document.body.classList.toggle('mplay', !on && this.mode === 'match');
    const cfg = this.$('cfg'), host = on ? this.$('bc-cfgslot') : this.$('top');
    if (cfg.parentNode !== host) host.appendChild(cfg);
    this.input.cancel();
  }
  /** Acrescenta uma linha na narração (minuto + texto, ícone vetorial pela classe) e rola o feed. btn = bloco de lance decisivo; time = 'us' | 'op' pinta a linha com a cor do time. */
  feed(min, cls, _ico, text, btn, time) {
    const box = this.$('bc-feed'), row = document.createElement('div');
    row.className = 'ev ev-' + cls;
    const t = time || (cls === 'us' || cls === 'usgoal' ? 'us' : cls === 'opp' || cls === 'oppgoal' ? 'op' : null);   // de qual time é o lance
    if (t && !btn) row.classList.add('t-' + t);                                                                       // faixa na cor do time
    const mm = document.createElement('div'); mm.className = 'ev-min'; mm.textContent = String(Math.min(CFG.MATCH_MIN, min)).padStart(2, '0') + "'";
    const tx = document.createElement('div'); tx.className = 'ev-txt';
    const ic = Game.ICON[cls]; if (ic) { const sp = document.createElement('span'); sp.className = ic[0] === '<' ? 'ico' : 'cardsym ' + ic; if (ic[0] === '<') sp.innerHTML = ic; tx.append(sp); }
    tx.append(document.createTextNode(text));
    if (btn) {
      const top = document.createElement('div'); top.className = 'row'; top.append(mm, tx); row.append(top);
      const pr = document.createElement('div'); pr.className = 'prep';
      pr.innerHTML = '<span>Prepare-se · começa em <b class="cd">' + Math.ceil(CFG.BC_AUTO_DELAY) + '</b>s</span><i class="pbar"></i>';
      pr.querySelector('.pbar').style.setProperty('--d', CFG.BC_AUTO_DELAY + 's');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn bc-play'; b.textContent = 'Entrar no lance';
      b.addEventListener('click', () => this.startPlay());
      row.append(pr, b); row.classList.add('live');
    } else row.append(mm, tx);
    box.appendChild(row);
    while (box.children.length > 220) box.removeChild(box.firstChild);
    const quick = this.match && this.match.simulated;
    box.scrollTo({ top: box.scrollHeight, behavior: quick ? 'auto' : 'smooth' });
    return row;
  }
  dropPrompt() {
    const m = this.match, row = m.promptEl; m.promptEl = null; if (!row) return;
    row.classList.remove('live'); for (const q of row.querySelectorAll('.bc-play,.prep')) q.remove();
  }
  teamTag(side) { return side === 'us' ? 'seu time' : 'Adversário'; }

  /* ----- Relógio da transmissão ----- */
  tickBroadcast(dt) {
    const m = this.match; if (!m || m.over) return;
    const sp = this.speed;
    if (m.phase === 'run') {
      m.clock = Math.min(CFG.MATCH_MIN, m.clock + dt * sp / CFG.BC_MIN_SEC);
      while (m.phase === 'run' && m.minute < Math.floor(m.clock)) { m.minute++; this.processMinute(m.minute); }
    } else if (m.phase === 'pause') {
      m.pauseT -= dt * sp;
      if (m.pauseT <= 0) { m.phase = 'run'; const f = m.after; m.after = null; if (f) f(); }
    } else if (m.phase === 'prompt') {
      m.pauseT -= dt; const cd = m.promptEl && m.promptEl.querySelector('.cd'); if (cd) cd.textContent = Math.max(1, Math.ceil(m.pauseT));
      if (m.pauseT <= 0) this.startPlay();          // transição automática (depois do tempo de preparo)
    } else if (m.phase === 'final') {
      m.pauseT -= dt; if (m.pauseT <= 0) { m.phase = 'end'; this.endMatch(); }
    }
  }
  processMinute(min) {
    const m = this.match;
    if (min >= CFG.MATCH_MIN) return this.finalWhistle();
    if (min === 45) return this.halfTime();
    if (m.plan.length && m.plan[0].min <= min) return this.promptPlay(min);
    this.minuteEvents(min, false);
  }
  halfTime() {
    const m = this.match; m.clock = 45; m.phase = 'pause'; m.pauseT = CFG.BC_HALF_PAUSE;
    this.feed(45, 'info', '', `FIM DO PRIMEIRO TEMPO! Intervalo: ${this.placarTxt()}.`);
    Som.apito('intervalo');
    m.after = () => { this.feed(46, 'info', '', 'ROLA A BOLA para o segundo tempo!'); Som.apito('curto'); };
  }
  finalWhistle() {
    const m = this.match; m.clock = CFG.MATCH_MIN; m.phase = 'final'; m.pauseT = 1.6;
    const r = m.home > m.away ? 'Vitória do seu time!' : m.home < m.away ? 'Vitória do Adversário.' : 'Tudo igual no placar.';
    this.feed(CFG.MATCH_MIN, 'info', '', `FIM DE JOGO! Apita o árbitro: ${this.placarTxt()}. ${r}`); Som.apito('fim');
  }

  /** Eventos de um minuto sem lance jogável: gol do adversário (força do ataque dele x sua defesa) ou lances de narração. */
  minuteEvents(min, quiet) {
    const m = this.match, A = Util.lvl(this.attr.oatk), D = Util.lvl(this.attr.mdef);
    let rate = 0.0035 + 0.026 * Math.pow(A, 1.6) * (1 - 0.5 * D);                   // mesma taxa de gol do adversário de antes
    rate *= (m.cards.opp.r ? 0.7 : 1) * (m.cards.us.r ? 1.35 : 1);                    // expulsões pesam
    if (Math.random() < 1 - Math.exp(-rate)) { this.oppGoal(min); return; }
    if (quiet || Math.random() > 0.6) return;                                         // nem todo minuto rende uma linha
    const kind = Gen.pick([['neutral', 40], ['tackle', 12], ['foul', 13], ['yellow', 7], ['corner', 8], ['oppchance', 4 + 12 * A], ['uswaste', 7], ['red', 0.35]]);
    const us = Rnd.chance(0.5), side = us ? 'us' : 'opp', cx = this.cx, say = arr => cx.fmt(Rnd.pick(arr));
    switch (kind) {
      case 'neutral': { const r = Math.random(); if (r < 0.4) this.feed(min, 'us', '', say(Narracao.US)); else if (r < 0.8) this.feed(min, 'opp', '', say(Narracao.OPP)); else this.feed(min, 'neutral', '', say(Narracao.MID)); break; }
      case 'tackle': this.feed(min, 'neutral', '', say(us ? Narracao.DESARME_US : Narracao.DESARME_OPP), false, us ? 'us' : 'op'); break;
      case 'foul': Som.apito('curto'); this.feed(min, 'neutral', '', say(us ? Narracao.FOUL_US : Narracao.FOUL_OPP), false, us ? 'us' : 'op'); break;
      case 'yellow': Som.apito('curto'); this.cartao(min, side, false); break;
      case 'red': Som.apito('curto'); this.cartao(min, side, true); break;
      case 'corner': this.feed(min, 'corner', '', say(us ? Narracao.CORNER_US : Narracao.CORNER_OPP), false, us ? 'us' : 'op'); break;
      case 'oppchance': if (Math.random() < 0.58) this.feed(min, 'save', '', say(Narracao.SAVE), false, 'op'); else this.feed(min, 'opp', '', say(Narracao.OPP_MISS)); break;
      case 'uswaste': this.feed(min, 'us', '', say(Narracao.US_WASTE)); break;
    }
  }
  /** Cartão com nome real: o 2º amarelo no mesmo jogador vira vermelho; expulso não é punido de novo; um vermelho por time. */
  cartao(min, side, direto) {
    const m = this.match, cx = this.cx, L = this.lineups && this.lineups[side === 'opp' ? 'op' : 'us'], c = m.cards[side];
    let nome, key;
    if (L) { const p = Rnd.pick(L.tit.filter(q => q.slotPos !== 'GK' && !m.expulsos.has(q.nome))); nome = p.nomeFalado; key = side + p.nome; }
    else { const n = Rnd.i(2, 11); nome = 'camisa ' + n; key = side + n; }
    if (m.expulsos.has(key)) return;
    const dois = !direto && m.amarelos.has(key);
    if (direto || dois) {
      if (c.r) return;
      m.expulsos.add(key); c.r++; if (dois) c.y++;
      this.feed(min, 'red', '', cx.fmt(side === 'us' ? (dois ? Narracao.SECOND_US : Narracao.RED_US) : (dois ? Narracao.SECOND_OPP : Narracao.RED_OPP), { X: nome }), false, side === 'us' ? 'us' : 'op');
    } else {
      m.amarelos.add(key); c.y++;
      this.feed(min, 'yellow', '', cx.fmt(Rnd.pick(Narracao.YELLOW), { X: nome, Y: cx.jog(side === 'us' ? 'op' : 'us', 'p') }), false, side === 'us' ? 'us' : 'op');
    }
  }
  /** Gol do adversário entre os seus lances: o autor é sorteado entre os titulares (atacantes têm mais chance). */
  oppGoal(min) {
    const m = this.match, cx = this.cx, L = this.lineups, S = L ? Sim.autor(L.op) : null, nome = S ? S.nomeFalado : cx.jog('op', 'a');
    let A = cx.jog('op', 'm'); if (A === nome) A = cx.jog('op', 'a');
    m.away++; Som.gol(false);
    m.log.push({ min, text: S ? `Gol de ${S.nome}` : 'Gol do Adversário', us: false, scorer: S ? S.nome : null });
    this.feed(min, 'oppgoal', '', `GOL DO ${cx.club('op').toUpperCase()}! ` + cx.fmt(Rnd.pick(Narracao.OPP_GOAL), { S: nome, A }));
    this.flash('op'); const el = this.$('bc'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  /* ----- Lance decisivo: aviso na narração -> campo em tela cheia -> resultado volta para o feed ----- */
  promptPlay(min) {
    const m = this.match; m.cur = m.plan.shift(); m.cur.min = min;
    m.cur.type = this.forceScn !== 'rand' ? this.forceScn : m.cur.type; m.cur.spec = Scenarios.make(m.cur.type);   // o lance já nasce aqui: o aviso cita quem está com a bola
    const car = m.cur.spec.attackers[0], real = this.lineups ? Elenco.porSlot(this.lineups.us, car.pos, car.slot && car.slot.x) : null;
    m.phase = 'prompt'; m.pauseT = CFG.BC_AUTO_DELAY;
    m.promptEl = this.feed(min, 'chance', '', this.cx.fmt(Narracao.HEAD[m.cur.type] || 'É a sua chance!', { C: real ? real.nomeFalado : 'o camisa ' + car.num }), true);
  }
  startPlay() {
    const m = this.match; if (!m || m.phase !== 'prompt' || this.view !== 'broadcast') return;
    const type = this.forceScn !== 'rand' ? this.forceScn : m.cur.type;
    this.lastType = type; m.scheduled++;
    this.dropPrompt();
    this.loadScenario(m.cur.spec || Scenarios.make(type)); this.showBanner();
    m.phase = 'play'; this.view = 'play'; this.setBroadcastUI(false);                // o canvas abre (fade) e o motor volta a rodar
  }
  /** Texto + estilo da linha de resultado do lance (GOL!, DEFENDEU!, PARA FORA!, IMPEDIMENTO!, DESARMADO!...). */
  playResult(skipped, before) {
    const t = this.msg ? this.msg.text : '', cx = this.cx;
    const nm = e => e && e.real ? e.real.nomeFalado : e && e.num != null ? 'camisa ' + e.num : 'o atacante';
    const perto = this.defenders.slice().sort((u, v) => Math.hypot(u.x - this.player.x, u.y - this.player.y) - Math.hypot(v.x - this.player.x, v.y - this.player.y))[0];
    const ex = { S: nm(this.shooter || this.player), C: nm(this.player), T: nm(this.tackler || perto), R: nm(this.offsideP || this.player) };
    if (this.goalCounted) {
      const d = before.home - before.away;
      const k = before.home === 0 && before.away === 0 ? 'abre' : d === -1 ? 'empata' : d < -1 ? 'diminui' : d === 0 ? 'frente' : 'amplia';
      return { cls: 'usgoal', ico: '', text: cx.fmt(Narracao.GOL_US[k], ex) };
    }
    const R = Narracao.RES[t];
    if (R) return { cls: R[0], ico: '', text: cx.fmt(R[1], ex) };
    if (skipped || !t) return { cls: 'miss', ico: '⏭', text: 'A chance se perdeu e o jogo segue.' };
    return { cls: 'miss', ico: '', text: t + (this.msg.sub ? ' ' + this.msg.sub + '.' : '') };
  }
  onGoal() {
    if (this.goalCounted) return;
    this.goalCounted = true; Som.gol(true); if (this.mode === 'train') return;   // treino não mexe no placar
    const m = this.match; m.home++; m.goalsUs++;
    const S = (this.shooter && this.shooter.real) || (this.player && this.player.real) || null;     // autor do gol (campeonato)
    this.goalLog = { min: m.minute + 1, text: S ? `Gol de ${S.nome}` : 'Gol do seu time!', us: true, scorer: S ? S.nome : null };
    m.log.push(this.goalLog); this.flash('us');
  }
  /** Fim do lance (mensagem exibida): registra, volta suavemente para a transmissão e continua do minuto onde parou. */
  afterPlay(skipped) {
    if (this.mode === 'train') {                                  // treino: conta e já monta o próximo lance
      this.trainStats.plays++; if (this.goalCounted) this.trainStats.goals++;
      this.loadTrainingPlay(); return;
    }
    const m = this.match; if (m.over || this.view !== 'play') return;
    const before = { home: m.home - (this.goalCounted ? 1 : 0), away: m.away };
    const st = m.stats[this.scn.type] || (m.stats[this.scn.type] = { plays: 0, goals: 0 });
    st.plays++; if (this.goalCounted) st.goals++; m.plays++;
    const R = this.playResult(skipped, before);
    m.minute = Math.min(CFG.MATCH_MIN - 1, m.minute + 1); m.clock = m.minute;                // o lance consome 1 minuto
    this.resetTimer = 0; this.view = 'broadcast'; this.setBroadcastUI(true);
    this.feed(m.minute, R.cls, R.ico, R.text, false, 'us');               // resultado do SEU lance
    m.phase = 'pause'; m.pauseT = CFG.BC_RESULT_PAUSE; m.after = null;
  }
  /** Botão "Pular lance" (durante o campo). */
  skipPlay() {
    if (this.mode === 'train') { this.resetTimer = 0; this.afterPlay(true); return; }
    if (this.view !== 'play') return;
    this.resetTimer = 0; this.afterPlay(true);
  }
  endMatch() {
    const m = this.match; m.over = true; m.phase = 'end'; this.aim = null; this.strike = null;
    const win = m.home > m.away, draw = m.home === m.away;
    this.$('e-res').textContent = this.placarTxt();
    const vd = this.$('e-vd'); vd.textContent = win ? 'VITÓRIA!' : draw ? 'EMPATE' : 'DERROTA';
    vd.style.color = win ? '#86efac' : draw ? '#fde047' : '#fca5a5';
    this.$('e-plays').textContent = m.plays; this.$('e-goals').textContent = m.goalsUs; this.$('e-conc').textContent = m.away;
    this.$('e-note').textContent = m.simulated ? 'Parte dos lances foi simulada por fórmula de equilíbrio (não pela física do jogo).' : '';
    let rows = '<table><tr><th>Cenário</th><th>Lances</th><th>Gols</th></tr>';
    for (const k of Scenarios.TYPES) { const s = m.stats[k]; if (s) rows += `<tr><td>${Scenarios.LABEL[k]}</td><td>${s.plays}</td><td>${s.goals}</td></tr>`; }
    this.$('e-stats').innerHTML = m.plays ? rows + '</table>' : '';
    this.$('e-log').innerHTML = m.log.length
      ? m.log.slice().sort((a, b) => a.min - b.min).map(e => `<div style="color:${e.us ? '#86efac' : '#fca5a5'}">${e.min}' — ${e.text}</div>`).join('')
      : 'Sem gols na partida.';
    this.$('e-new').textContent = this.lineups ? 'Voltar à Central' : 'Jogar nova partida';
    if (this.lineups && m.fx && !m.registrado) { m.registrado = true; this.registrarLiga(); }       // campeonato: resultado + simulação dos outros jogos
    this.$('end').classList.add('show');
  }
  /** Estimativa por fórmula (só para testar equilíbrio): chance de gol por tipo de lance. */
  estimateChance(type) {
    const a = this.attr, atk = a.force * 0.2 + a.curve * 0.2 + a.speed * 0.2 + a.dribble * 0.25 + a.pos * 0.15;
    const def = a.mark * 0.6 + a.reflex * 0.4;
    const base = { contra: 0.26, entrada: 0.14, parada: 0.13, ponta: 0.17, fechada: 0.08, posicional: 0.12, escanteio: 0.1, penalti: 0.76, um_x_um: 0.45,
                   costas: 0.22, roubada: 0.2, lado: 0.22, fundo: 0.15, rebote: 0.12, bloco: 0.1 }[type] || 0.12;
    return Util.clamp(base * Math.exp(2.2 * (atk - def) / 100), 0.02, 0.85);
  }
  /** Botão "Simular resto da partida": resolve o que falta (lances por fórmula) e vai direto ao resumo. */
  quickSim() {
    if (this.mode !== 'match' || this.view !== 'broadcast') return;
    if (this.match.over) this.newMatch();
    const m = this.match; m.simulated = true; m.after = null;
    const resolve = (cur, min) => {
      const st = m.stats[cur.type] || (m.stats[cur.type] = { plays: 0, goals: 0 }); st.plays++; m.plays++;
      if (Math.random() < this.estimateChance(cur.type)) {
        const S = this.lineups ? Sim.autor(this.lineups.us) : null;
        st.goals++; m.home++; m.goalsUs++; m.log.push({ min, text: S ? `Gol de ${S.nome}` : 'Gol do seu time!', us: true, scorer: S ? S.nome : null });
        this.feed(min, 'usgoal', '', S ? this.cx.fmt('GOLAÇO! {S} marca para {u} (lance simulado).', { S: S.nomeFalado }) : 'GOLAÇO! Seu time marca (lance simulado).'); this.flash('us');
      }
    };
    if (m.phase === 'prompt') { this.dropPrompt(); resolve(m.cur, m.minute); }
    while (m.minute < CFG.MATCH_MIN - 1) {
      m.minute++; const min = m.minute;
      if (min === 45) this.feed(45, 'info', '', `FIM DO PRIMEIRO TEMPO! ${this.placarTxt()}.`);
      if (m.plan.length && m.plan[0].min <= min) resolve(m.plan.shift(), min); else this.minuteEvents(min, true);
    }
    m.minute = CFG.MATCH_MIN; m.clock = CFG.MATCH_MIN; this.finalWhistle(); m.phase = 'end'; this.endMatch();
  }
  flash(side) {
    for (const id of ['h-score', 'bc-score']) { const el = this.$(id); el.classList.remove('flash-us', 'flash-op'); void el.offsetWidth; el.classList.add('flash-' + side); }
  }
  /** Chip de status (rodapé da transmissão) e painel retrátil com os números do time. */
  refreshStatus() {
    const m = this.match, a = this.attr; if (!m) return; const c0 = m.cards;
    const atk = Math.round(a.force * 0.2 + a.curve * 0.2 + a.speed * 0.2 + a.dribble * 0.25 + a.pos * 0.15), def = Math.round(a.mark * 0.6 + a.reflex * 0.4);
    this.$('bc-status').textContent = `${Tactics.forms.us} · Lances jogados ${m.plays}`;          // o total sorteado fica escondido (surpresa)
    const c = m.cards;
    this.$('bc-stpanel').innerHTML = `<b>Seu time</b> ${Tactics.forms.us} × <b>Adv.</b> ${Tactics.forms.opp}<br>` +
      `Seu ATAQUE <b>${atk}</b> × DEFESA adv. <b>${def}</b> • ATAQUE adv. <b>${a.oatk}</b> × Sua DEFESA <b>${a.mdef}</b><br>` +
      `Lances decisivos jogados: <b>${m.plays}</b> • Gols marcados: <b>${m.goalsUs}</b><br>` +
      `Cartões, seu time: ${c.us.y} amarelo(s), ${c.us.r} vermelho(s) · Adversário: ${c.opp.y} amarelo(s), ${c.opp.r} vermelho(s)`;
  }
  updateHud() {
    if (this.mode === 'train') {
      const ts = this.trainStats, key = `T${ts.plays}|${ts.goals}`; if (key === this._hudKey) return; this._hudKey = key;
      this.$('t-hud').textContent = `Lance ${ts.plays + 1} • Gols ${ts.goals}`; return;
    }
    const m = this.match, min = Math.min(CFG.MATCH_MIN, Math.floor(m.clock));
    const key = `${m.home}x${m.away}|${min}|${m.phase}|${this.speed}|${m.plays}|${m.cards.us.y}${m.cards.us.r}${m.cards.opp.y}${m.cards.opp.r}`;
    if (key === this._hudKey) return; this._hudKey = key;
    const [gl, gr] = this.lr(), sc = `${gl} x ${gr}`, sc2 = `${gl} - ${gr}`, pct = (min / CFG.MATCH_MIN * 100) + '%';
    this.$('h-score').textContent = sc; this.$('h-min').textContent = min + "'"; this.$('clockfill').style.width = pct;
    this.$('bc-score').textContent = sc2; this.$('bc-min').textContent = String(min).padStart(2, '0') + "'"; this.$('bc-fill').style.width = pct;
    for (const bt of this.$('bc-speed').children) bt.classList.toggle('on', +bt.dataset.s === this.speed);
    this.$('bc-period').textContent = m.over || m.phase === 'final' || m.phase === 'end' ? 'FIM DE JOGO' : m.phase === 'prompt' || m.phase === 'play' ? ' SUA CHANCE'
                                    : m.phase === 'pause' && m.minute === 45 ? 'INTERVALO' : min < 45 ? '1º TEMPO' : '2º TEMPO';
    this.refreshStatus();
  }
}

/** Ícones vetoriais de traço fino da narração (por classe da linha). Cartões são retângulos de cor (classe CSS). */
const ICON = (() => {
  const v = d => '<svg class="i" viewBox="0 0 24 24">' + d + '</svg>';
  const ball = v('<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.6 2.6-1.4 4.2H9.8l-1.4-4.2z"/>');
  const flag = v('<path d="M6 21V4M6 5h11l-2.5 3.5L17 12H6"/>');
  return { us: ball, opp: ball, neutral: v('<path d="M5 12h14M13 6l6 6-6 6"/>'), usgoal: ball, oppgoal: ball, yellow: 'y', red: 'r', corner: flag, flag,
           save: v('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>'), miss: v('<path d="M6 6l12 12M18 6L6 18"/>'),
           info: v('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), chance: v('<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>') };
})();
/** Copia os métodos da transmissão para Game.prototype (mesmos descritores: getters e não-enumeráveis) e define Game.ICON. */
function instalarTransmissao(Game) {
  for (const k of Object.getOwnPropertyNames(TransmissaoMetodos.prototype)) {
    if (k === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Game.prototype, k)) throw new Error('Método duplicado em Game: ' + k);
    Object.defineProperty(Game.prototype, k, Object.getOwnPropertyDescriptor(TransmissaoMetodos.prototype, k));
  }
  Game.ICON = ICON;
}

export { Ctx, instalarTransmissao };
