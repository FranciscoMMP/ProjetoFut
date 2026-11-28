import { Tactics, Util } from './motor-campo.js';
import { Aparencia } from './render-sprites.js';
import { Elenco, Liga, Central, Uniformes, Clubes } from './campeonato.js';
import { game } from './main.js';
import { Som } from './audio.js';

/* =============================================================================
   SISTEMA TÁTICO DO CAMPEONATO
     Tatica : REGRAS, sem DOM. Vagas de cada formação (4-3-3, 4-4-2, 4-2-3-1, 4-1-4-1, 3-5-2, 3-4-3, 5-3-2), escalação automática, penalidade por
              improviso fora de posição (inclusive dentro da defesa: LD, LE e ZAG, pelo campo posicaoDetalhada do JSON), fôlego/energia (desgaste por minuto e recuperação entre rodadas), postura
              (Equilibrada / Ofensiva / Defensiva), atributos EFETIVOS usados pela simulação minuto a minuto e pelos
              lances no campo, e (de)serialização do estado tático no save do campeonato (localStorage).
     Painel : tela TÁTICA & ELENCO. Abre na Central, no pré-jogo (tela de uniformes) e durante a transmissão
              (botão TÁTICA / SUBSTITUIR, com o relógio pausado). Até 5 substituições por partida.

   Os jogadores do elenco (Liga.L[i].elenco) são objetos únicos por sessão: a escalação só marca neles a vaga
   ocupada (slotKey, slotPos, vaga). A energia (0 a 100) também fica no próprio jogador.
   Nada aqui mexe na física da bola, nos controles nem nos sprites.
   ============================================================================= */

const GRUPOS = ['GOL', 'DEF', 'MEI', 'ATA'];
/** Posição exigida por cada função tática da formação. */
const VAGA = { GK: 'GOL', LB: 'DEF', RB: 'DEF', CB: 'DEF', LWB: 'MEI', RWB: 'MEI', DM: 'MEI', CM: 'MEI', AM: 'MEI', LM: 'MEI', RM: 'MEI', LW: 'ATA', RW: 'ATA', ST: 'ATA' };
/**
 * Ordem de preenchimento das vagas na escalação automática (no 4-3-3 é a mesma ordem histórica). Meias pelos lados (alas e meias
 * abertos) vêm depois dos centrais: quando faltam meias, o improviso cai na ala (lateral/ponta), que é o mais natural.
 */
const PRIOR = { GK: 0, LB: 1, RB: 2, CB: 3, DM: 4, CM: 6, AM: 7, LWB: 7.5, LM: 7.5, RWB: 7.6, RM: 7.6, ST: 8, LW: 9, RW: 10 };
/** Critério de escolha para cada função (escalação automática dos bots e remanejamento ao trocar a formação). */
const CRIT = {
  GK: p => p.ovr, CB: p => p.marcacao, DM: p => p.marcacao, CM: p => p.ovr, AM: p => p.ovr,
  ST: p => p.forca + p.posicionamento + p.ovr,
};
const critDe = pos => CRIT[pos] || (p => p.velocidade);              // laterais, alas, meias abertos e pontas: velocidade
/** Atributo característico de cada função (usado na "melhor escalação", junto com o OVR e a energia). */
const PAPEL = { GK: 'reflexo', CB: 'marcacao', DM: 'marcacao', CM: 'posicionamento', AM: 'drible', ST: 'posicionamento' };
/** Camisas da escalação padrão (4-3-3). Reservas recebem 12, 13... na ordem do JSON. */
const NUM_433 = { 'GK|0': 1, 'RB|0.85': 2, 'LB|-0.85': 3, 'CB|-0.3': 4, 'CB|0.3': 5, 'DM|0': 6, 'RW|0.85': 7, 'CM|-0.4': 8, 'ST|0': 9, 'CM|0.4': 10, 'LW|-0.85': 11 };
/**
 * Posição DETALHADA (campo posicaoDetalhada do JSON): GOL, ZAG, LD, LE, MEI, ATA. Só a defesa é desmembrada: as vagas de
 * lateral pedem o lado certo e a de zagueiro pede zagueiro. JSON antigo (sem o campo) = sem distinção dentro da defesa.
 */
const DETALHADAS = ['GOL', 'ZAG', 'LD', 'LE', 'MEI', 'ATA'];
const VAGA_DET = { LB: 'LE', RB: 'LD', CB: 'ZAG' };
/** Alas e meias abertos (vagas de MEI): o lateral do MESMO lado faz a função quase sem perda. */
const LADO_ALA = { LWB: 'LE', LM: 'LE', RWB: 'LD', RM: 'LD' };
/**
 * Rendimento dentro da defesa fora da posição detalhada, e do lateral na ala do seu lado.
 * LATERAL_NA_ALA = formações de 4 ou 5 defensores (a ala é do meio-campo: −5% para o lateral).
 * LATERAL_NA_ALA3 = formações de 3 zagueiros: a ala É a função do lateral (e do meia aberto), sem penalidade.
 */
const FATOR_DET = { LATERAL_TROCADO: 0.9, LATERAL_ZAGUEIRO: 0.85, LATERAL_NA_ALA: 0.95, LATERAL_NA_ALA3: 1 };
/** Ordem de exibição na lista de reservas. */
const ORDEM_DET = ['GOL', 'ZAG', 'LD', 'LE', 'DEF', 'MEI', 'ATA'];
/** Atributos mostrados na ficha do jogador (Tática & Elenco), na ordem do JSON. */
const FICHA_ATTR = [['forca', 'Força'], ['curva', 'Curva'], ['velocidade', 'Velocidade'], ['drible', 'Drible'],
                    ['posicionamento', 'Posicionamento'], ['marcacao', 'Marcação'], ['reflexo', 'Reflexo'], ['folego', 'Fôlego']];
/** Atributos que caem com o cansaço (os demais só sofrem com o improviso). */
const ENERGIA_ATTR = new Set(['velocidade', 'drible', 'marcacao', 'reflexo']);

const Tatica = {
  FORMACOES: ['4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2'],
  PADRAO: '4-3-3',
  MAX_SUBS: 5,
  DESGASTE: 0.58,                 // % de energia por minuto de um jogador de fôlego médio na postura equilibrada (antes do fator de fôlego)
  DESC_FORM: {
    '4-3-3': '1 GOL, 4 DEF, 3 MEI, 3 ATA. Amplitude: os pontas jogam bem abertos, colados na linha lateral, e atacam o espaço.',
    '4-4-2': '1 GOL, 4 DEF, 4 MEI, 2 ATA. Dupla de ataque próxima e meio-campo compacto, com os meias abertos mais por dentro.',
    '3-5-2': '1 GOL, 3 DEF, 5 MEI, 2 ATA. Presença central forte e alas que se projetam pelos lados e fazem ultrapassagens. As alas aceitam laterais ou meias, sem penalidade.',
    '4-2-3-1': '1 GOL, 4 DEF, 5 MEI, 1 ATA. Dois volantes protegem a defesa e o meia de ligação joga atrás de um centroavante isolado. Pontas abertos pelo meio-campo.',
    '4-1-4-1': '1 GOL, 4 DEF, 5 MEI, 1 ATA. Um volante de proteção e quatro meias em linha, com um único atacante. Time compacto, que chega ao ataque com os meias.',
    '3-4-3': '1 GOL, 3 DEF, 4 MEI, 3 ATA. Ataque com três e meias abertos que ocupam o corredor inteiro. As alas aceitam laterais ou meias, sem penalidade; a defesa fica exposta.',
    '5-3-2': '1 GOL, 5 DEF, 3 MEI, 2 ATA. Cinco na defesa, com alas que apoiam pelos lados; time fechado que chega menos ao ataque. Aqui as alas são vagas de meio-campo: o lateral rende 5% a menos.',
  },
  /**
   * Postura tática. lances = multiplicador dos lances jogáveis do seu time; golContra = chance de gol do rival nos minutos
   * narrados; ritmo = desgaste de energia; chOpp / chUs = frequência de chances narradas de cada lado; simEu / simEle =
   * pontos de ataque somados a cada lado quando a partida é só simulada. A parte do CAMPO fica em Tactics.POSTURA (motor-campo.js).
   */
  POSTURAS: {
    equilibrada: { nome: 'Equilibrada', lances: 1, golContra: 1, ritmo: 1, chOpp: 1, chUs: 1, simEu: 0, simEle: 0,
                   desc: 'Ritmo padrão: consumo normal de energia e equilíbrio entre criar chances e proteger a defesa.' },
    ofensiva:    { nome: 'Ofensiva', lances: 1.3, golContra: 1.4, ritmo: 1.3, chOpp: 1.5, chUs: 1.4, simEu: 4, simEle: 5,
                   desc: 'Mais lances de ataque e mais gente projetada na frente, mas a defesa fica exposta ao contra-ataque e o time cansa bem mais rápido.' },
    defensiva:   { nome: 'Defensiva', lances: 0.7, golContra: 0.55, ritmo: 0.8, chOpp: 0.55, chUs: 0.6, simEu: -4, simEle: -8,
                   desc: 'Time fechado: o rival cria muito menos e a energia rende mais, mas você ganha menos lances e tem menos gente no ataque.' },
  },
  GRUPOS,

  /* -------------------------------- Expulsões -------------------------------- */
  /**
   * Jogador expulso fica no "slot" como um BURACO (p.expulso = true): não joga, não cansa, não aparece nos lances nem na narração.
   * O setor do buraco pesa: EXPOSICAO = quanto o rival passa a chegar (zaga desfalcada é o pior caso); REDUCAO = quanto o
   * próprio ataque perde. Cada expulsão multiplica (dois expulsos = efeito em dobro). Dá para mover o buraco de setor
   * trocando o expulso de posição com outro titular na Tática & Elenco.
   */
  EXPOSICAO: { DEF: 1.45, MEI: 1.3, ATA: 1.12, GOL: 1.6 },
  REDUCAO: { ATA: 0.72, MEI: 0.82, DEF: 0.92, GOL: 1 },
  expulsos(L) { return L.tit.filter(p => p.expulso); },
  /** Só quem ainda está em campo (se o grupo inteiro foi expulso, devolve o grupo para as médias não zerarem). */
  ativos(lst) { const a = lst.filter(p => !p.expulso); return a.length ? a : lst; },
  exposicao(L) { return this.expulsos(L).reduce((f, p) => f * (this.EXPOSICAO[p.vaga] || 1), 1); },
  reducaoAtaque(L) { return this.expulsos(L).reduce((f, p) => f * (this.REDUCAO[p.vaga] || 1), 1); },
  /** Zera o estado de UMA partida (expulsão e cartões recebidos no jogo); a disciplina acumulada fica no save. */
  limparPartida(L) { for (const p of L.elenco) { p.expulso = false; p.cj = null; } },

  /* ---------------------------------- Vagas ---------------------------------- */
  _slots: new Map(),
  /** Vagas da formação: goleiro + as 10 posições de Tactics.FORMATIONS. key = "função|lado" (a mesma chave usada pelos lances). */
  slots(form) {
    let s = this._slots.get(form);
    if (!s) {
      const f = Tactics.FORMATIONS[form];
      // Formação de 3 defensores (3-5-2, 3-4-3): as alas são vagas de lateral-meia, sem penalidade. Com 4 ou 5 defensores (o 5-3-2
      // também tem 3 zagueiros, mais 2 alas na defesa), a ala segue sendo do meio-campo e o lateral rende menos.
      const tres = form.split('-')[0] === '3';
      s = [{ key: 'GK|0', pos: 'GK', x: 0, rd: 4, vaga: 'GOL', rot: 'GOL', ala3: false },
           ...f.map(([pos, x, rd]) => ({ key: pos + '|' + x, pos, x, rd, vaga: VAGA[pos] || 'MEI', rot: Tactics.LABEL[pos] || pos, ala3: tres && !!LADO_ALA[pos] }))];
      this._slots.set(form, s);
    }
    return s;
  },
  /** Vagas na ordem de preenchimento (meias centrais da direita para a esquerda, como na escalação original). */
  ordem(form) {
    return this.slots(form).slice().sort((a, b) => (PRIOR[a.pos] ?? 6) - (PRIOR[b.pos] ?? 6) || (a.pos === 'CM' ? b.x - a.x : a.x - b.x));
  },

  /* ---------------------------------- Fôlego ---------------------------------- */
  /** Fôlego (1-99) do JSON; sem o campo (save/JSON antigo), calcula a partir do OVR, da velocidade e da posição (determinístico). */
  folego(p) {
    if (Number.isFinite(p.folego)) return Util.clamp(Math.round(p.folego), 1, 99);
    const h = Aparencia.hash(p.nome) % 17 - 8, ovr = p.ovr || 60;
    if (p.posicao === 'GOL') return Util.clamp(Math.round(48 + 0.28 * ovr + h * 0.6), 40, 85);
    const bonus = { DEF: 4, MEI: 9, ATA: 0 }[p.posicao] || 0;
    return Util.clamp(Math.round(18 + 0.36 * ovr + 0.24 * (p.velocidade || ovr) + bonus + h), 35, 97);
  },

  /* ------------------------------- Improvisação ------------------------------- */
  /** Fator de rendimento de um jogador da posição natural `nat` jogando numa vaga `vaga`. */
  fatorImprov(nat, vaga) {
    if (!vaga || nat === vaga) return 1;
    if (vaga === 'GOL') return 0.45;                                    // jogador de linha no gol: penalidade severa
    if (nat === 'GOL') return 0.55;                                     // goleiro na linha
    return Math.abs(GRUPOS.indexOf(nat) - GRUPOS.indexOf(vaga)) === 1 ? 0.8 : 0.7;   // setor vizinho -20%, defesa <-> ataque -30%
  },
  /** Posição detalhada do jogador (null no JSON antigo ou com valor desconhecido). */
  det(p) { return DETALHADAS.includes(p.posicaoDetalhada) ? p.posicaoDetalhada : null; },
  /** Rótulo da posição para a interface: LD, LE e ZAG em vez de DEF quando o JSON traz a posição detalhada. */
  rotPos(p) { return this.det(p) || p.posicao; },
  /** Rótulo da vaga: LD, LE e ZAG nas vagas da defesa; o grupo nas demais. */
  rotVaga(vaga, slotPos) { return VAGA_DET[slotPos] || vaga; },
  /**
   * Fator de rendimento do jogador p numa vaga (grupo `vaga`, função `slotPos`).
   * Grupos diferentes: as regras de sempre (fatorImprov), exceto o lateral na ala/meia aberto do seu lado (−5%).
   * Dentro da defesa: lateral do outro lado −10%; lateral de zagueiro ou zagueiro de lateral −15%.
   * ala3 = a vaga é ala de uma formação com 3 zagueiros: o lateral do mesmo lado joga ali sem perda (como o meia).
   */
  fator(p, vaga, slotPos, ala3 = false) {
    if (!vaga) return 1;
    const d = this.det(p);
    if (p.posicao === vaga) {
      const dv = VAGA_DET[slotPos];
      if (!dv || !d || d === dv) return 1;
      return d !== 'ZAG' && dv !== 'ZAG' ? FATOR_DET.LATERAL_TROCADO : FATOR_DET.LATERAL_ZAGUEIRO;
    }
    if (p.posicao === 'DEF' && vaga === 'MEI' && d && LADO_ALA[slotPos] === d) return ala3 ? FATOR_DET.LATERAL_NA_ALA3 : FATOR_DET.LATERAL_NA_ALA;
    return this.fatorImprov(p.posicao, vaga);
  },
  improv(p) { return this.fator(p, p.vaga, p.slotPos, p.slotAla3); },
  /** Etiqueta do alerta de improviso (null = está na posição). grave = vermelho; senão, amarelo. */
  rotuloImprov(p) {
    const f = this.improv(p); if (f >= 1) return null;
    const pct = Math.round((1 - f) * 100);
    if (p.vaga === 'GOL') return { txt: `Goleiro improvisado (−${pct}%)`, curto: `NO GOL −${pct}%`, grave: true };
    return { txt: `Improvisado como ${this.rotVaga(p.vaga, p.slotPos)} (−${pct}%)`, curto: `IMPROV. −${pct}%`, grave: pct >= 30 };
  },

  /* ---------------------------------- Energia ---------------------------------- */
  /** Rendimento pela energia: inteiro até 60%, cai até 85% em 35% e despenca no estado crítico (abaixo de 35%). */
  fatorEnergia(e) {
    e = Util.clamp(e == null ? 100 : e, 0, 100);
    if (e >= 60) return 1;
    if (e >= 35) return 0.85 + 0.15 * (e - 35) / 25;
    return 0.62 + 0.23 * e / 35;
  },
  estadoEnergia(e) { return e < 35 ? 'crit' : e < 60 ? 'baixa' : ''; },
  /** Atributo efetivo k (forca, curva, velocidade, drible, posicionamento, marcacao, reflexo) com improviso e cansaço. */
  ef(p, k) {
    const base = Number.isFinite(p[k]) ? p[k] : 50;
    return base * this.improv(p) * (ENERGIA_ATTR.has(k) ? this.fatorEnergia(p.energia) : 1);
  },
  /** OVR efetivo (força do time): improviso inteiro + cansaço parcial (só parte dos atributos cai com a energia). */
  ovrEf(p) { return p.ovr * this.improv(p) * (0.35 + 0.65 * this.fatorEnergia(p.energia)); },
  fatorCampo(p, k) { return this.improv(p) * (ENERGIA_ATTR.has(k) ? this.fatorEnergia(p.energia) : 1); },
  /**
   * Fator INDIVIDUAL de um jogador no campo, relativo à média dos companheiros de linha. O time inteiro já entra com os
   * atributos efetivos (game.attr); este fator só diferencia o cansado/improvisado do companheiro inteiro, sem contar duas vezes.
   */
  relativo(p, L, k) {
    if (!p || !L || !L.tit) return 1;
    const lin = L.tit.filter(q => q.vaga !== 'GOL' && !q.expulso);
    const med = lin.reduce((s, q) => s + this.fatorCampo(q, k), 0) / (lin.length || 1);
    return Util.clamp(this.fatorCampo(p, k) / (med || 1), 0.55, 1.3);
  },
  /** Desgaste por minuto: fôlego alto cansa bem mais devagar; postura ofensiva acelera; goleiro quase não cansa. */
  gastoPorMin(p, postura) {
    const k = 1.6 - 1.2 * Util.clamp(p.folego, 1, 99) / 100, P = this.POSTURAS[postura] || this.POSTURAS.equilibrada;
    return this.DESGASTE * k * P.ritmo * (p.vaga === 'GOL' ? 0.35 : 1);
  },
  desgastar(L, postura, min = 1, ruido = true) {
    for (const p of L.tit) if (!p.expulso) p.energia = Math.max(0, p.energia - this.gastoPorMin(p, postura) * min * (ruido ? 0.85 + Math.random() * 0.3 : 1));
  },
  /** Recuperação entre uma rodada e outra: +40% a +50% conforme o fôlego. Quem jogou 90' no limite começa a próxima abaixo de 100%. */
  recuperar(L) { for (const p of L.elenco) p.energia = Math.min(100, p.energia + 30 + 0.2 * p.folego); },
  /** Intervalo: fôlego extra para quem está em campo. */
  intervalo(L) { for (const p of L.tit) if (!p.expulso) p.energia = Math.min(100, p.energia + 3); },

  /* ---------------------------- Escalação do time ---------------------------- */
  /** Coloca cada jogador do mapa (chave da vaga -> jogador) na sua vaga e recalcula tudo o que depende da escalação. */
  escalar(L, form, mapa) {
    for (const p of L.elenco) { p.slotKey = null; p.slotPos = null; p.vaga = null; p.slotAla3 = false; }
    L.form = form; L.slots = new Map(); L.tit = [];
    for (const s of this.slots(form)) {
      const p = mapa.get(s.key);
      p.slotKey = s.key; p.slotPos = s.pos; p.vaga = s.vaga; p.slotAla3 = s.ala3;
      L.slots.set(s.key, p); L.tit.push(p);
    }
    L.gk = L.slots.get('GK|0');
    L.ata = L.tit.filter(p => p.vaga === 'ATA'); L.mei = L.tit.filter(p => p.vaga === 'MEI'); L.def = L.tit.filter(p => p.vaga === 'DEF');
    this.recalc(L);
    if (L.kitJogo) Elenco.pintar(L);                                     // durante a partida: quem vai para o gol veste a camisa de goleiro
  },
  /**
   * Overall, ataque e defesa do time com os valores EFETIVOS (energia + improviso), só com quem está em campo, e -4% por
   * expulsão (inferioridade numérica). Com todos inteiros e ninguém expulso = valores originais.
   */
  recalc(L) {
    const M = (l, f) => l.length ? l.reduce((s, p) => s + f(p), 0) / l.length : 0, o = p => this.ovrEf(p), A = l => this.ativos(l);
    const inf = 1 - 0.04 * this.expulsos(L).length;
    L.ovr = M(A(L.tit), o);
    L.ataque = (0.6 * M(A(L.ata), o) + 0.4 * M(A(L.mei), o)) * inf;
    L.defesa = (0.55 * M(A(L.def), o) + 0.30 * (L.gk ? o(L.gk) : 0) + 0.15 * M(A(L.mei), o)) * inf;
  },
  /**
   * Escalação automática: 1ª passada põe nas vagas quem é da posição (pelo critério da função); 2ª passada completa as vagas
   * que sobraram com o improviso de MENOR penalidade. valor(slot, jogador) define o "melhor" (padrão: critério da função).
   */
  auto(form, pool, valor = (s, p) => critDe(s.pos)(p)) {
    const livres = [...pool], mapa = new Map(), pend = [];
    const tira = p => livres.splice(livres.indexOf(p), 1);
    const melhorDe = (s, lst) => lst.slice().sort((a, b) => valor(s, b) - valor(s, a))[0];
    for (const s of this.ordem(form)) {
      const c = livres.filter(p => this.fator(p, s.vaga, s.pos, s.ala3) === 1);        // na posição (inclusive o lado do lateral)
      if (c.length) { const p = melhorDe(s, c); tira(p); mapa.set(s.key, p); } else pend.push(s);
    }
    for (const s of pend) {
      const best = Math.max(...livres.map(p => this.fator(p, s.vaga, s.pos, s.ala3)));
      const p = melhorDe(s, livres.filter(q => this.fator(q, s.vaga, s.pos, s.ala3) === best)); tira(p); mapa.set(s.key, p);
    }
    return mapa;
  },
  /** Nota de um jogador para uma vaga: OVR + atributo da função, pesando a energia atual. */
  valorVaga(s, p) { return (0.75 * p.ovr + 0.25 * (p[PAPEL[s.pos] || 'velocidade'] || p.ovr)) * (0.4 + 0.6 * this.fatorEnergia(p.energia)); },
  /** Melhor escalação do elenco inteiro para a formação atual (suspensos ficam de fora). */
  melhor(L) {
    this.escalar(L, L.form, this.auto(L.form, L.elenco.filter(p => !p.suspenso), (s, p) => this.valorVaga(s, p)));
  },
  /**
   * Suspensão: tira da escalação quem está suspenso e põe no lugar o melhor reserva disponível da MESMA posição da vaga
   * (sem ninguém da posição, o improviso de menor penalidade). Os outros titulares continuam onde estavam.
   * Devolve as trocas feitas [{ sai, entra }] para avisar o usuário.
   */
  cobrirSuspensos(L) {
    const fora = L.tit.filter(p => p.suspenso); if (!fora.length) return [];
    const mapa = new Map(L.slots), livres = L.elenco.filter(p => !p.slotKey && !p.suspenso), trocas = [];
    for (const sai of fora) {
      const s = this.slots(L.form).find(q => q.key === sai.slotKey); if (!livres.length) break;
      const best = Math.max(...livres.map(p => this.fator(p, s.vaga, s.pos, s.ala3)));
      const entra = livres.filter(p => this.fator(p, s.vaga, s.pos, s.ala3) === best).sort((a, b) => this.valorVaga(s, b) - this.valorVaga(s, a))[0];
      livres.splice(livres.indexOf(entra), 1); mapa.set(s.key, entra); trocas.push({ sai, entra });
    }
    this.escalar(L, L.form, mapa);
    return trocas;
  },
  numerar(L) {
    const usados = new Set();
    for (const p of L.tit) { p.num = NUM_433[p.slotKey] || null; if (p.num) usados.add(p.num); }
    let n = 12;
    for (const p of L.elenco) if (!p.num) { while (usados.has(n)) n++; p.num = n; usados.add(n); }
  },
  trocarPosicoes(L, a, b) { const m = new Map(L.slots); m.set(a.slotKey, b); m.set(b.slotKey, a); this.escalar(L, L.form, m); },
  substituir(L, sai, entra) { const m = new Map(L.slots); m.set(sai.slotKey, entra); this.escalar(L, L.form, m); },
  /** Troca de formação mantendo os 11 em campo: cada um vai para a vaga que mais combina com a sua posição. */
  mudarFormacao(L, form) { if (this.FORMACOES.includes(form)) this.escalar(L, form, this.auto(form, L.tit)); },

  /* ----------------------------- Partida e save ----------------------------- */
  lerEnergias(L, S) {
    const en = (S && S.energia) || {};
    for (const p of L.elenco) { const e = en[p.nome]; p.energia = Number.isFinite(e) ? Util.clamp(e, 0, 100) : 100; }
  },
  /** Aplica o estado tático salvo (formação, postura, titulares e energias) no clube do usuário; sem save válido, usa a escalação padrão. */
  carregar(L, S) {
    this.lerEnergias(L, S);
    const t = S && S.tat, nomes = new Map(L.elenco.map(p => [p.nome, p]));
    let form = this.PADRAO, mapa = null;
    if (t && this.FORMACOES.includes(t.form) && t.tit) {
      const usados = new Set(); mapa = new Map();
      for (const s of this.slots(t.form)) {
        const p = nomes.get(t.tit[s.key]);
        if (!p || usados.has(p)) { mapa = null; break; }
        usados.add(p); mapa.set(s.key, p);
      }
      if (mapa) form = t.form;
    }
    if (!mapa) mapa = this.auto(form, L.elenco.filter(p => p.titular));
    L.postura = t && this.POSTURAS[t.postura] ? t.postura : 'equilibrada';
    this.escalar(L, form, mapa);
  },
  serializar(L) { return { form: L.form, postura: L.postura || 'equilibrada', tit: Object.fromEntries([...L.slots].map(([k, p]) => [k, p.nome])) }; },
  energias(L) { return Object.fromEntries(L.elenco.map(p => [p.nome, Math.round(p.energia * 10) / 10])); },
  /** Rival volta inteiro (o cansaço de uma partida não pode vazar para a simulação das rodadas seguintes). */
  resetarRival(L) { for (const p of L.elenco) p.energia = 100; this.recalc(L); },
  prepararPartida(us, op, S) { this.limparPartida(us); this.limparPartida(op); this.lerEnergias(us, S); this.recalc(us); this.resetarRival(op); },
  fimPartida(us, op) { this.limparPartida(us); this.limparPartida(op); this.recuperar(us); this.recalc(us); this.resetarRival(op); },
  resumo(L) {
    const t = this.ativos(L.tit);
    return { energia: Math.round(t.reduce((s, p) => s + p.energia, 0) / t.length), cansados: t.filter(p => p.energia < 60).length,
             criticos: t.filter(p => p.energia < 35).length, improv: t.filter(p => this.improv(p) < 1).length };
  },
};

/* =============================================================================
   TELA TÁTICA & ELENCO
   Toque num titular e depois num reserva = troca (na partida, conta como substituição). Toque em dois titulares = trocam
   de vaga (não conta). Formação e postura mudam na hora. Funciona com mouse e toque (tudo é botão).
   ============================================================================= */
const $ = id => document.getElementById(id);
const esc = s => Clubes.esc(s);
const barra = e => `<span class="tt-en ${Tatica.estadoEnergia(e)}" title="Energia ${e}%"><i style="width:${e}%"></i></span>`;
/**
 * Ícones de cartão no card do jogador. São três símbolos diferentes para não confundir:
 *   - PENDURADO (2 amarelos acumulados em jogos diferentes): dois cartões amarelos sobrepostos;
 *   - cartão recebido NESTA partida: um cartão com borda branca + o minuto (amarelo ou vermelho);
 *   - SUSPENSO (cumpre a próxima partida): etiqueta vermelha escrita SUSPENSO.
 */
const cartoes = (p, vivo) => {
  let h = '';
  if (vivo && p.cj && p.cj.verm != null) h += `<span class="cj" title="Expulso nesta partida aos ${p.cj.verm}'"><i class="cj-c verm"></i>${p.cj.verm}'</span>`;
  else if (vivo && p.cj && p.cj.am != null) h += `<span class="cj" title="Amarelo nesta partida aos ${p.cj.am}'"><i class="cj-c am"></i>${p.cj.am}'</span>`;
  if (p.amarelos >= 2) h += '<i class="pend" title="Pendurado: 2 amarelos acumulados. O próximo amarelo tira o jogador da partida seguinte."></i>';
  return h ? `<span class="tt-cards">${h}</span>` : '';
};

const Painel = {
  el: $('tatica'), volta: 'central', sel: null, ver: null, msg: '', msgTipo: '',
  aberta() { return this.el.classList.contains('show'); },
  L() { return Liga.L[Liga.S.user]; },
  /** A partida do usuário desta rodada está rolando (mudanças viram substituições/mudanças táticas na narração). */
  aoVivo() { const m = game.match; return !!(Liga.S && game.lineups && game.tj && m && !m.over && m.fx && m.fx === Liga.jogoDoUsuario()); },
  /** Pode abrir pela transmissão? Só com o relógio correndo ou no respiro entre lances (nunca no aviso de lance ou no campo). */
  podeAbrirNoJogo() { const m = game.match; return this.aoVivo() && game.view === 'broadcast' && (m.phase === 'run' || m.phase === 'pause'); },
  expulso(p) { return !!p.expulso; },

  /** volta: 'central' | 'kits' (pré-jogo) | 'jogo' (transmissão, relógio pausado). */
  abrir(volta = 'central') {
    if (!Liga.S || !Liga.L.length) return;
    if (volta === 'jogo' && !this.podeAbrirNoJogo()) return;
    this.volta = volta; this.sel = null; this.ver = null; this.msg = ''; this.msgTipo = '';
    if (volta === 'central') Central.ocultar(); else if (volta === 'kits') Uniformes.ocultar();
    game.menuOpen = true; game.input.cancel();                      // menuOpen pausa o relógio da transmissão
    this.el.classList.add('show'); this.render(); this.el.scrollTop = 0;
  },
  fechar() {
    this.el.classList.remove('show'); this.sel = null;
    if (this.volta === 'central') Central.mostrar();
    else if (this.volta === 'kits') Uniformes.reabrir();
    else { game.menuOpen = false; game.input.cancel(); }
  },
  avisar(txt, tipo = '') { this.msg = txt; this.msgTipo = tipo; },

  /* ----- Ações ----- */
  tocarTitular(k) {
    const L = this.L(), p = L.slots.get(k), s = this.sel; if (!p) return;
    this.ver = p.nome;                                                   // a ficha mostra o último jogador tocado
    if (!s && p.expulso) { this.sel = { t: 'tit', k }; this.avisar(`${p.nomeFalado} foi expulso e deixou um buraco na vaga ${Tatica.slots(L.form).find(q => q.key === k).rot}. Toque em outro titular para ele cobrir essa vaga (o buraco passa para a posição dele).`, 'warn'); }
    else if (!s) { this.sel = { t: 'tit', k }; this.avisar(`${p.nomeFalado} selecionado (${Tatica.slots(L.form).find(q => q.key === k).rot}). Toque em um reserva para trocar ou em outro titular para inverter as posições.`); }
    else if (s.t === 'tit') { if (s.k === k) { this.sel = null; this.avisar(''); } else this.trocarTitulares(L.slots.get(s.k), p); }
    else this.substituir(p, L.elenco.find(q => q.nome === s.n));
    this.render();
  },
  tocarReserva(n) {
    const L = this.L(), r = L.elenco.find(q => q.nome === n), s = this.sel; if (!r || r.slotKey) return;
    this.ver = r.nome;
    if (r.suspenso) { this.erro(`${r.nomeFalado} está suspenso e não pode jogar esta partida.`); return this.render(); }
    if (s && s.t === 'tit') this.substituir(L.slots.get(s.k), r);
    else if (s && s.t === 'res' && s.n === n) { this.sel = null; this.avisar(''); }
    else { this.sel = { t: 'res', n }; this.avisar(`${r.nomeFalado} selecionado. Agora toque no titular que vai sair.`); }
    this.render();
  },
  erro(txt) { this.sel = null; this.avisar(txt, 'err'); },
  substituir(sai, entra) {
    if (!sai || !entra) return;
    const L = this.L(), vivo = this.aoVivo(), tj = game.tj;
    if (entra.suspenso) return this.erro(`${entra.nomeFalado} está suspenso e não pode jogar esta partida.`);
    if (vivo) {
      if (this.expulso(sai)) return this.erro(`${sai.nomeFalado} foi expulso: não pode ser substituído.`);
      if (tj.subs >= Tatica.MAX_SUBS) return this.erro(`Limite de ${Tatica.MAX_SUBS} substituições atingido nesta partida.`);
      if (tj.saiu.has(entra.nome)) return this.erro(`${entra.nomeFalado} já foi substituído nesta partida e não pode voltar.`);
    }
    Tatica.substituir(L, sai, entra); this.sel = null;
    if (vivo) { tj.subs++; tj.saiu.add(sai.nome); game.aposMudancaTatica('sub', `SUBSTITUIÇÃO: Sai ${sai.nomeFalado}, entra ${entra.nomeFalado}.`); }
    Liga.salvarTatica();
    const imp = Tatica.rotuloImprov(entra);
    this.avisar(`Sai ${sai.nomeFalado}, entra ${entra.nomeFalado}${imp ? ' — ' + imp.txt.toLowerCase() : ''}.` + (vivo ? ` Substituições: ${tj.subs}/${Tatica.MAX_SUBS}.` : ''), imp ? 'warn' : 'ok');
    Som.apito('curto');
  },
  /** Inverte dois titulares. Com um expulso, o outro passa a cobrir a vaga dele e o buraco muda de setor (o goleiro não sai do gol). */
  trocarTitulares(a, b) {
    const L = this.L(), vivo = this.aoVivo(), ea = a.expulso, eb = b.expulso;
    if (ea && eb) return this.erro('Os dois foram expulsos: não há quem cobrir a vaga.');
    if ((ea && b.vaga === 'GOL') || (eb && a.vaga === 'GOL')) return this.erro('O goleiro não pode sair do gol para cobrir a vaga do expulso.');
    const cobre = ea ? b : eb ? a : null, exp = ea ? a : eb ? b : null;
    Tatica.trocarPosicoes(L, a, b); this.sel = null;
    if (cobre) {
      if (vivo) game.aposMudancaTatica('tat', `MUDANÇA TÁTICA: ${cobre.nomeFalado} vai cobrir a vaga de ${exp.nomeFalado}, expulso. O buraco passa para ${exp.vaga === 'ATA' ? 'o ataque' : exp.vaga === 'MEI' ? 'o meio-campo' : 'a defesa'}.`);
      Liga.salvarTatica();
      return this.avisar(`${cobre.nomeFalado} cobre a vaga do expulso. O time joga com o buraco no ${exp.vaga === 'ATA' ? 'ataque (o rival chega menos, você cria menos)' : exp.vaga === 'MEI' ? 'meio-campo' : 'setor defensivo (o rival chega bem mais)'}.`, 'ok');
    }
    if (vivo) game.aposMudancaTatica('tat', `MUDANÇA TÁTICA: ${a.nomeFalado} e ${b.nomeFalado} trocam de posição.`);
    Liga.salvarTatica();
    const imp = [a, b].map(p => Tatica.rotuloImprov(p) && p.nomeFalado).filter(Boolean);
    this.avisar(`${a.nomeFalado} e ${b.nomeFalado} trocaram de posição.` + (imp.length ? ` Fora de posição: ${imp.join(' e ')}.` : ''), imp.length ? 'warn' : 'ok');
  },
  formacao(f) {
    const L = this.L(); if (f === L.form || !Tatica.FORMACOES.includes(f)) return;
    Tatica.mudarFormacao(L, f); this.sel = null;
    if (this.aoVivo()) game.aposMudancaTatica('tat', `MUDANÇA TÁTICA: {U} passa a jogar no ${f}.`);
    Liga.salvarTatica();
    const n = Tatica.resumo(L).improv;
    this.avisar(`Formação ${f}. ` + (n ? `${n} jogador${n > 1 ? 'es' : ''} fora de posição: traga reservas da posição certa para tirar a penalidade.` : 'Todos na posição de origem.'), n ? 'warn' : 'ok');
  },
  postura(k) {
    const L = this.L(); if (k === L.postura || !Tatica.POSTURAS[k]) return;
    L.postura = k;
    if (this.aoVivo()) {
      const txt = { ofensiva: 'MUDANÇA TÁTICA: {U} se lança ao ataque (postura ofensiva).', defensiva: 'MUDANÇA TÁTICA: {U} recua as linhas e se fecha (postura defensiva).',
                    equilibrada: 'MUDANÇA TÁTICA: {U} volta a jogar equilibrado.' }[k];
      game.aposMudancaTatica('tat', txt);
    }
    Liga.salvarTatica();
    this.avisar(`Postura ${Tatica.POSTURAS[k].nome}: ${Tatica.POSTURAS[k].desc}`, 'ok');
  },
  automatica() {
    const L = this.L(); if (this.aoVivo()) return;
    Tatica.melhor(L); this.sel = null; Liga.salvarTatica();
    this.avisar(`Escalação automática no ${L.form}: os melhores de cada posição, pesando a energia de cada um.`, 'ok');
  },

  /* ----- Desenho ----- */
  /** Posição do card no campinho (seu gol embaixo): x = lado da formação, y = profundidade ao defender. */
  posCampo(s) {
    if (s.pos === 'GK') return { left: 50, top: 91 };
    return { left: Util.clamp(50 + s.x * 41, 11, 89), top: Util.clamp(78 - (s.rd - 20) * 1.6, 8, 84) };
  },
  render() {
    const L = this.L(), vivo = this.aoVivo(), m = game.match, tj = game.tj, R = Tatica.resumo(L), post = L.postura || 'equilibrada';
    const sel = this.sel, selP = sel && sel.t === 'tit' ? L.slots.get(sel.k) : null, selR = sel && sel.t === 'res' ? L.elenco.find(q => q.nome === sel.n) : null;
    const eyebrow = vivo ? `AO VIVO · ${String(Math.min(90, m.minute)).padStart(2, '0')}' · SUBSTITUIÇÕES ${tj.subs}/${Tatica.MAX_SUBS}`
                         : `PRÉ-JOGO · ${Liga.acabou ? 'CAMPEONATO ENCERRADO' : 'RODADA ' + (Liga.S.round + 1)}`;
    const cardSlot = s => {
      const p = L.slots.get(s.key), imp = Tatica.rotuloImprov(p), ex = vivo && this.expulso(p), en = Math.round(p.energia), pos = this.posCampo(s);
      const fit = selR ? (Tatica.fator(selR, s.vaga, s.pos, s.ala3) === 1 ? ' fit' : '') : '';
      const cls = 'tt-slot' + (imp ? (imp.grave ? ' grave' : ' imp') : '') + (selP === p ? ' on' : '') + (ex ? ' exp' : '') + fit;
      const ovr = imp ? Math.round(p.ovr * Tatica.improv(p)) : p.ovr;
      return `<button type="button" class="${cls}" data-k="${esc(s.key)}" style="left:${pos.left}%;top:${pos.top}%" aria-pressed="${selP === p}"
          aria-label="${esc(`${s.rot}: ${p.nome}, ${Tatica.rotPos(p)}, OVR ${ovr}, energia ${en}%${imp ? ', ' + imp.txt : ''}`)}">
        <span class="tt-top"><span class="tt-vaga">${esc(s.rot)}</span>${cartoes(p, vivo)}<span class="tt-num">${p.num}</span></span>
        <b class="tt-nm">${esc(p.rot)}</b>
        <span class="tt-meta"><em class="tt-pos p-${p.posicao}">${Tatica.rotPos(p)}</em><span class="tt-ovr${imp ? ' down' : ''}" title="OVR ${p.ovr}">${ovr}</span><span class="tt-enp ${Tatica.estadoEnergia(en)}" title="Energia atual">${ex ? '—' : en + '<small>%</small>'}</span></span>
        ${barra(en)}
        ${ex ? '<span class="tt-imp">EXPULSO</span>' : imp ? `<span class="tt-imp">${imp.curto}</span>` : ''}
      </button>`;
    };
    const res = L.elenco.filter(p => !p.slotKey).sort((a, b) => ORDEM_DET.indexOf(Tatica.rotPos(a)) - ORDEM_DET.indexOf(Tatica.rotPos(b)) || b.ovr - a.ovr);
    const linhaRes = p => {
      const saiu = vivo && tj.saiu.has(p.nome), en = Math.round(p.energia), bloq = saiu || p.suspenso;
      const fit = selP && !bloq ? (Tatica.fator(p, selP.vaga, selP.slotPos, selP.slotAla3) === 1 ? ' fit' : ' nofit') : '';
      return `<button type="button" class="tt-r${selR === p ? ' on' : ''}${bloq ? ' saiu' : ''}${fit}" data-n="${esc(p.nome)}" ${bloq ? 'disabled' : ''}>
        <em class="tt-pos p-${p.posicao}">${Tatica.rotPos(p)}</em><span class="tt-rn"><b>${esc(p.nome)}</b>${cartoes(p, vivo)}</span><span class="c-ovr">${p.ovr}</span>
        <span class="c-en">${barra(en)}<small>${en}%</small></span>${p.suspenso ? '<span class="tag susp">SUSPENSO · cumpre esta rodada</span>' : saiu ? '<span class="tag">JÁ SAIU</span>' : ''}</button>`;
    };
    const seg = (a, itens, atual) => itens.map(([v, txt]) => `<button type="button" data-a="${a}" data-v="${v}" class="${v === atual ? 'on' : ''}" aria-pressed="${v === atual}">${txt}</button>`).join('');
    const dica = vivo
      ? `Substituições: <b>${tj.subs} de ${Tatica.MAX_SUBS}</b>. Toque no titular que sai e depois no reserva que entra. Inverter dois titulares, trocar a formação ou a postura não conta como substituição.`
      : 'Toque em um titular e depois em um reserva para trocar, ou em dois titulares para inverter as posições. Antes do jogo as trocas são livres.';
    const msg = this.msg || dica;
    this.el.innerHTML = `<div class="lg-wrap tt-wrap">
      <header class="lg-head">
        <div class="lg-id"><i class="strip2" style="--a:${L.vis.a};--b:${L.vis.b}"></i><div><span class="lg-eyebrow">${eyebrow}</span><b class="lg-club">Tática &amp; Elenco</b></div></div>
        <div class="lg-actions">${vivo ? '' : '<button type="button" class="btn alt sm" data-a="auto">Escalação automática</button>'}
          <button type="button" class="btn lg-play" data-a="fechar">${vivo && this.volta === 'jogo' ? 'Voltar ao jogo' : 'Pronto'}</button></div>
      </header>
      <div class="tt-ctl">
        <section class="lg-card"><h3>Formação</h3><div class="lg-pad"><div class="seg tt-seg tt-forms" role="group" aria-label="Formação">${seg('form', Tatica.FORMACOES.map(f => [f, f]), L.form)}</div>
          <p class="tt-d">${Tatica.DESC_FORM[L.form]}</p></div></section>
        <section class="lg-card"><h3>Postura</h3><div class="lg-pad"><div class="seg tt-seg" role="group" aria-label="Postura">${seg('post', Object.entries(Tatica.POSTURAS).map(([k, v]) => [k, v.nome]), post)}</div>
          <p class="tt-d">${Tatica.POSTURAS[post].desc}</p></div></section>
      </div>
      <div class="tt-sum">
        <div><b>${Math.round(L.ataque)}</b><span>ATAQUE</span></div><div><b>${Math.round(L.defesa)}</b><span>DEFESA</span></div>
        <div><b>${L.ovr.toFixed(1)}</b><span>OVR EFETIVO</span></div>
        <div class="${R.criticos ? 'bad' : R.cansados ? 'warn' : ''}"><b>${R.energia}%</b><span>ENERGIA MÉDIA</span></div>
        <div class="${R.improv ? 'bad' : ''}"><b>${R.improv}</b><span>IMPROVISADOS</span></div>
        ${vivo ? `<div class="${tj.subs >= Tatica.MAX_SUBS ? 'bad' : ''}"><b>${tj.subs}/${Tatica.MAX_SUBS}</b><span>SUBSTITUIÇÕES</span></div>` : ''}
      </div>
      <p class="tt-msg ${this.msg ? this.msgTipo : ''}" role="status">${this.msg ? esc(msg) : msg}</p>
      ${this.ficha(L, vivo)}
      <div class="tt-grid">
        <section class="lg-card"><h3>Titulares <small>${L.form} · seu gol embaixo</small></h3>
          <div class="tt-campo"><i class="tt-l meio"></i><i class="tt-l circ"></i><i class="tt-l area-a"></i><i class="tt-l area-d"></i>${Tatica.slots(L.form).map(cardSlot).join('')}</div></section>
        <section class="lg-card"><h3>Reservas <small>${res.length} disponíveis</small></h3>
          <div class="tt-res"><div class="tt-rh"><span>POS</span><span>NOME</span><span>OVR</span><span>ENERGIA</span></div>${res.map(linhaRes).join('')}</div></section>
      </div>
      <div class="tt-foot"><p class="tt-leg"><b>Fora de posição:</b> −20% em setor vizinho (DEF↔MEI, MEI↔ATA), −30% entre defesa e ataque, goleiro improvisado −55%.
        Na defesa: lateral do outro lado −10%, lateral de zagueiro (ou o contrário) −15%; lateral na ala do seu lado −5%.
        <b>Energia:</b> abaixo de 60% o jogador perde velocidade, drible, marcação e reflexo; abaixo de 35% fica crítico. Fôlego alto cansa mais devagar.
        <b>Cartões:</b> <i class="pend"></i> pendurado (2 amarelos acumulados: o 3º suspende) · <span class="cj"><i class="cj-c am"></i>34'</span> cartão nesta partida ·
        2 amarelos no mesmo jogo = expulsão. Expulso não pode ser substituído e cumpre suspensão na rodada seguinte; mova o buraco trocando o expulso de posição com outro titular.</p>
        <button type="button" class="btn lg-play" data-a="fechar">${vivo && this.volta === 'jogo' ? 'Voltar ao jogo' : 'Pronto'}</button></div>
    </div>`;
  },

  /**
   * Ficha do jogador tocado por último (titular ou reserva): posição, idade, OVR e os 8 atributos. Fica sempre no mesmo
   * lugar e com a mesma altura (sem jogador, mostra a dica), para a lista não pular entre um toque e outro de uma troca.
   * Em campo, o valor efetivo (improviso + cansaço) aparece ao lado quando for menor que o do jogador inteiro.
   */
  ficha(L, vivo) {
    const p = this.ver ? L.elenco.find(q => q.nome === this.ver) : null;
    if (!p) return `<section class="lg-card tt-ficha vazia" aria-live="polite"><h3>Ficha do jogador</h3>
      <p class="tt-fi-dica">Toque em um jogador (titular ou reserva) para ver os atributos dele.</p></section>`;
    const nasc = p.nascimento ? new Date(p.nascimento + 'T12:00:00') : null, hoje = new Date();
    const idade = nasc && !isNaN(nasc) ? hoje.getFullYear() - nasc.getFullYear() - (hoje < new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate()) ? 1 : 0) : null;
    const emCampo = !!p.slotKey, imp = emCampo ? Tatica.rotuloImprov(p) : null;
    const ovrEf = emCampo ? Math.round(Tatica.ovrEf(p)) : p.ovr;
    const nivel = v => v >= 80 ? 'a' : v >= 70 ? 'b' : v >= 60 ? 'c' : 'd';
    const linha = ([k, rot]) => {
      const v = Number.isFinite(p[k]) ? Math.round(p[k]) : 0;
      const ef = emCampo && k !== 'folego' ? Math.round(Tatica.ef(p, k)) : v;
      return `<div class="tt-fa"><span>${rot}</span><span class="tt-fb ${nivel(v)}"><i style="width:${Util.clamp(v, 0, 99)}%"></i></span>
        <b>${v}</b>${ef < v ? `<small title="Valor em campo agora (improviso e cansaço)">${ef}</small>` : '<small></small>'}</div>`;
    };
    const onde = emCampo ? `Titular · ${Tatica.slots(L.form).find(s => s.key === p.slotKey).rot}` : 'Reserva';
    return `<section class="lg-card tt-ficha" aria-live="polite"><h3>Ficha do jogador <small>${esc(onde)}</small>
        <button type="button" class="tt-fi-x" data-a="ficha-x" aria-label="Fechar ficha">×</button></h3>
      <div class="tt-fi">
        <div class="tt-fi-id"><em class="tt-pos p-${p.posicao}">${Tatica.rotPos(p)}</em><b>${esc(p.nome)}</b>
          <span>${idade != null ? idade + ' anos · ' : ''}energia ${Math.round(p.energia)}%${p.suspenso ? ' · <span class="tt-susp">suspenso</span>' : ''}</span>
          ${imp ? `<span class="tt-fi-imp">${esc(imp.txt)}</span>` : ''}</div>
        <div class="tt-fi-ovr"><b>${p.ovr}</b><span>OVR</span>${emCampo && ovrEf < p.ovr ? `<small title="OVR em campo agora (improviso e cansaço)">em campo ${ovrEf}</small>` : ''}</div>
        <div class="tt-fi-at">${FICHA_ATTR.map(linha).join('')}</div>
      </div></section>`;
  },

  /** Card resumido da Central do Campeonato. */
  cartaoCentral() {
    const L = this.L(), R = Tatica.resumo(L), P = Tatica.POSTURAS[L.postura || 'equilibrada'];
    const nomes = l => l.map(p => esc(p.nomeFalado)).join(', ');
    const susp = L.elenco.filter(p => p.suspenso), pend = L.elenco.filter(p => p.amarelos >= 2 && !p.suspenso);
    const alerta = [R.improv ? `${R.improv} titular${R.improv > 1 ? 'es' : ''} fora de posição` : '', R.cansados ? `${R.cansados} titular${R.cansados > 1 ? 'es' : ''} abaixo de 60% de energia` : '',
                    susp.length ? `<span class="tt-susp">Suspenso${susp.length > 1 ? 's' : ''}: ${nomes(susp)}</span>` : '',
                    pend.length ? `<i class="pend"></i> Pendurado${pend.length > 1 ? 's' : ''}: ${nomes(pend)}` : '',
                    ...(Liga.avisoSusp || []).map(t => `${esc(t.entra.nomeFalado)} entra no lugar de ${esc(t.sai.nomeFalado)}`)]
      .filter(Boolean).join(' · ');
    return `<h3>Tática &amp; Elenco <span class="badge casa">${L.form}</span></h3><div class="lg-pad">
      <div class="tt-mini"><div><span>Formação</span><b>${L.form}</b></div><div><span>Postura</span><b>${P.nome}</b></div>
        <div class="${R.cansados ? 'warn' : ''}"><span>Energia média</span><b>${R.energia}%</b></div><div class="${R.improv ? 'warn' : ''}"><span>Improvisados</span><b>${R.improv}</b></div></div>
      <p class="lg-msg">${alerta || 'Titulares descansados e todos na posição de origem.'}</p>
      <button type="button" class="btn" data-a="tat">Abrir Tática &amp; Elenco</button></div>`;
  },
};

Painel.el.addEventListener('click', e => {
  const b = e.target.closest('[data-a],[data-k],[data-n]'); if (!b || b.disabled) return;
  if (b.dataset.k) return Painel.tocarTitular(b.dataset.k);
  if (b.dataset.n) return Painel.tocarReserva(b.dataset.n);
  switch (b.dataset.a) {
    case 'fechar': Painel.fechar(); break;
    case 'form': Painel.formacao(b.dataset.v); Painel.render(); break;
    case 'post': Painel.postura(b.dataset.v); Painel.render(); break;
    case 'auto': Painel.automatica(); Painel.render(); break;
    case 'ficha-x': Painel.ver = null; Painel.render(); break;
  }
});
// Botão TÁTICA / SUBSTITUIR da transmissão (pausa o cronômetro enquanto a tela está aberta)
$('bc-tat').addEventListener('click', () => Painel.abrir('jogo'));

export { Tatica, Painel };
