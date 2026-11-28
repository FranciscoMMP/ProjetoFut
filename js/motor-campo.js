import { Aparencia, Visual, Renderer } from './render-sprites.js';
import { Ctx } from './transmissao.js';
import { Elenco } from './campeonato.js';
import { Som } from './audio.js';
import { Tatica } from './tatica.js';

/* =============================================================================
   NEW STAR TREINEIROS — ETAPA 4 + BONECOS PIXEL ART (4B)
   Gerador procedural de lances + fluxo de partida (90 minutos).
   Física, controles, companheiros, passe, impedimento, goleiro e IA da zaga das Etapas 1-3
   foram mantidos. O que mudou na Etapa 4:

     - Scenarios : sorteia a situação de cada lance (contra-ataque 3x2, ataque posicional contra
                   3-4 defensores, falta frontal/lateral com barreira, lançamento na ponta,
                   defesa fechada com 5 defensores). Posições, quantidade de atacantes/zagueiros
                   e posição da bola variam; o campo é espelhado aleatoriamente.
     - Game      : nº de atacantes/zagueiros agora é variável (loadScenario); coberturas são
                   atribuídas por menor custo (assignMarks); zagueiros sobrando fazem "zona";
                   barreira fixa até a bola sair (bola parada); atração dos companheiros para a
                   área em cruzamentos (AI.MATE.ATTRACT_*).
     - Partida   : placar, relógio 0'-90', barra de transição de 1,5 s entre lances, chance de gol
                   do adversário nos intervalos (Ataque do Adversário x Sua Defesa), fim de jogo.
     - Teste     : menu retrátil "Config Teste", "Próximo Lance" e "Simular Partida Rápida".

   ETAPA 4B (visual): os círculos viraram bonecos animados em pixel art retrô (módulos Aparencia, Sprites,
   Visual e a função desenharJogador). É SÓ desenho: física, colisões, hitboxes, controles e IA continuam idênticos.
   Os únicos ganchos fora do Renderer são 2 chamadas Visual.chute(...) (dispara a animação do chute) e
   o campo `visual` de cada jogador (aparência), pronto para receber jogadores reais.

   ETAPA 6 (gerador procedural): módulo Gen + 15 perfis em Scenarios (contra-ataque 3x2/2x1/3x3/4x3, entrada da área, falta, ponta,
   defesa fechada, jogo posicional, escanteio, pênalti, cara a cara, bola nas costas, bola recuperada, superioridade pelo lado, linha
   de fundo, segunda bola e bloco baixo). Cada lance sai de tabelas de equilíbrio numérico + bloco defensivo montado pela formação e é
   validado (impedimento, vulnerabilidade, buracos na linha) antes de começar. Escanteio: cruzamento no alto e cabeçada automática
   (Game.headerContest). Falta/escanteio/pênalti: adversários a no mínimo 9,15 m da bola (keepFromBall).

   SISTEMA TÁTICO (tatica.js): a formação e a postura do seu time mudam QUEM aparece no lance e ONDE (Tactics.ESTILO e
   Tactics.POSTURA: amplitude dos pontas, dupla de ataque próxima, alas projetados, mais ou menos gente na frente) e as
   infiltrações dos companheiros. Cada jogador real em campo carrega fatores individuais de energia/improviso (fv = velocidade,
   fd = drible, fm = marcação) que só escalam a corrida e os duelos dele; a física da bola não muda.

   Mundo virtual em px (16 px = 1 m; linha de gol em y=0); a câmera dinâmica segue o jogador e o
   canvas só escala a vista; assim a física NÃO muda com o tamanho da tela.
   ============================================================================= */

/* ----------------------------- Configuração ------------------------------- */
const M = 16;   // px por metro (campo = 1088 px de largura; meio-campo ao gol = 840 px)

const CFG = {
  M,
  FIELD: { w: 68 * M, midY: 52.5 * M, bottom: 60 * M },
  GOAL:  { w: 9 * M, depth: 2.2 * M },
  BOX:   { w: 40.32 * M, h: 16.5 * M },
  SIX:   { w: 18.32 * M, h: 5.5 * M },
  SPOT_Y: 11 * M, ARC_R: 9.15 * M,

  SPEED_MIN_MS: 3.0, SPEED_MAX_MS: 8.75,

  PLAYER_R: 10, BALL_R: 4.5,
  CARRY_DIST: 15,
  START: { x: 34 * M, y: 50 * M },

  AIM_LEN_MIN: 45, AIM_LEN_MAX: 130,

  CAM_VIS_W: 600, CAM_VIS_H: 760,
  CAM_LOOKAHEAD: 0.16,
  CAM_FOLLOW: 3.5, CAM_FOLLOW_BALL: 6,
  CAM_PAD: 36,

  FIXED_DT: 1 / 120,
  SLOWMO: 0.16,
  STRIKE_TIME: 1.8,
  STRIKE_TIME_PARADA: 4,     // s para escolher o ponto de contato em bola parada (falta, escanteio, pênalti): sem pressão de desarme
  STRIKE_SLOWMO: 0.1,
  AIM_TIME: 2.5,
  AIM_TIME_PARADA: 6,
  // RECOMPOSIÇÃO: adversário que estava fora do lance entra pela parte de baixo da tela e corre para pressionar o portador
  RECOMP: { DEPOIS: 8,         // s de lance (bola rolando, após o 1º toque) até o 1º jogador voltar
            RECUADO: 4,        // ... ou só 4 s se a bola fica recuada (antes do meio de campo, LINHA)
            LINHA: 52.5 * 16,  // px do mundo a partir do gol: o meio de campo (52,5 m); daí para trás conta como "bola recuada"
            SEGUNDO: 6,        // s depois do 1º para vir o 2º (máximo 2 por lance)
            VEL_MIN: 6.0, VEL_MAX: 7.6 },   // m/s (pela Marcação do adversário): quem dispara para o gol escapa, quem toca para trás é alcançado        // s para mirar em bola parada antes de a bola escapar (na bola rolando continua AIM_TIME)
  DECIDE_TIME: 1.6,

  AIM_MARGIN: 175,            // px do mundo entre a bola e a borda da tela (espaço para puxar o estilingue; MAX_PULL = 150)
  GRAB: 28,
  HEAD: { Z_MIN: 10, Z_MAX: 46, REACH: 30 },   // disputa de cabeça no escanteio: altura (px) e alcance (px) em que alguém alcança a bola
  FIRST_TOUCH_TIME: 10,        // s para dar o primeiro toque (correr ou mirar) na PARTIDA; estourou = lance perdido
  FIRST_TOUCH_WARN: 4,        // s finais em que a barrinha de tempo aparece
  MIN_PULL: 30, MAX_PULL: 150,   // MIN_PULL = raio (px do mundo) em volta da bola: soltar dentro dele CANCELA o chute/passe
  CONTACT_CURVE_SIGN: 1,
  GRAVITY: 700,
  AIR_DRAG: 0.25,
  GOAL_H: 2.44 * M,
  BOUNCE: 0.5,

  DRAG: 0.9,
  ROLL: 35,
  SPIN_DECAY: 0.5,
  PICKUP_DIST: 16, PICKUP_SPEED: 380, PICKUP_COOLDOWN: 0.45,

  // ETAPA 4: partida
  MATCH_MIN: 90,            // duração da partida (minutos simulados)
  TRANS_TIME: 1.5,          // s da barra de transição entre lances
  TRANS_GOAL_TIME: 2.2,     // s quando o adversário marca (precisa de tempo para ler)
  // ETAPA 7: transmissão ao vivo
  BC_MIN_SEC: 0.9,          // segundos reais por minuto de jogo na velocidade 1x (90' ≈ 81 s; no 2x, metade)
  BC_AUTO_DELAY: 3.0,       // s para o jogador se preparar entre o aviso "É a sua chance!" e a abertura automática do campo
  BC_RESULT_PAUSE: 1.5,     // s de respiro depois que o lance termina e a narração volta
  BC_HALF_PAUSE: 2.6,       // s de intervalo (em tempo de jogo; no 2x passa na metade do tempo)
  BC_PLAYS: [4, 6],         // quantidade de lances decisivos sorteados por partida
};

const AI = {
  KEEPER: {
    Y_MIN: 1.3 * M, Y_MAX: 4.2 * M,
    ADV_FAR: 18 * M, ADV_NEAR: 4 * M,
    TRACK_MIN: 3.0, TRACK_MAX: 6.5,
    DELAY_MAX_MS: 520, DELAY_MIN_MS: 110,
    DIVE_MIN: 3.5, DIVE_MAX: 10.5,
    DIVE_TIME: 0.55,
    ERR_MAX: 55, ERR_MIN: 4,
    READ_FROM: 0.25, READ_SPAN: 0.95,
    REACH: 17, REACH_DIVE: 27,
    CATCH_MIN: 330, CATCH_MAX: 640,
    SAVE_Z: 2.0 * M,
    NIVEL: 0.78,      // peso geral da habilidade dos goleiros (1 = original): o nível de cada goleiro continua o mesmo, só pesa menos
  },
  DEF: {
    HOME_Y: 16.5 * M + 1 * M,
    HOME_DX: 8 * M,
    TRIGGER: 20 * M,
    SPEED_MIN: 3.4, SPEED_MAX: 7.2,
    REACT_MIN: 3, REACT_MAX: 14,
    GAP_MIN: 7.5 * M, GAP_MAX: 2.4 * M,
    LANE_LOOSE: 0.5, LANE_TIGHT: 0.2,
    GOAL_SIDE: 1.2 * M,
    LUNGE: 3.4 * M,
    PATIENCE_MAX: 2.2, PATIENCE_MIN: 0.7,
    STALL_SPEED: 45,
    AIM_STALL_MUL: 3,
    TACKLE: 30,
    TACKLE_CD: 0.9,
    BLOCK_Z: 1.9 * M,
    BLOCK_SPEED: 220,
    CLEAR_MIN: 230, CLEAR_MAX: 480,      // velocidade (px/s) do chute de alívio do zagueiro (Marcação 1 -> 99)
    HOLD_IDLE: 2.5,   // s parado até a defesa abandonar a linha de espera
    SWITCH_GAP: 2.5 * M, SWITCH_LOCK: 1.5,   // troca de pressionador: só se o outro estiver bem mais perto E passado SWITCH_LOCK s da última troca
    MARK_STICK: 2 * M,
    // Atacante LIVRE (nenhum zagueiro a menos de FREE_DIST) e perigoso (à frente/ao lado da bola) vira prioridade de marcação e
    // quem vai nele ignora a coleira
    FREE_DIST: 6 * M, FREE_BONUS: 5 * M,
    // Disciplina: quanto cada zagueiro pode SAIR da sua posição de origem (x leash do cenário). Ninguém sobe todo mundo.
    LEASH_COVER: 6 * M, LEASH_PRESS: 11 * M, LEASH_X_COVER: 8 * M, LEASH_X_PRESS: 13 * M,
    ZONE_STEP: 8 * M,                  // zagueiro em ZONA (sem atacante para marcar) parte para cima do portador a esta distância (dobra a marcação)
  },
  DUEL_K: 0.009,

  MATE: {
    SPEED_MUL: 0.92,
    DECIDE_SLOW: 1.6, DECIDE_FAST: 0.6,
    READ_SLOW: 1.1, READ_FAST: 12,
    MARGIN_LOW: -5.5 * M,
    MARGIN_HIGH: 1.9 * M,
    MARGIN_FROM: 0.15, MARGIN_TO: 0.9,
    NOISE_LOW: 2.2 * M, NOISE_HIGH: 0.25 * M,
    CAND_MIN: 5, CAND_MAX: 16,
    RANGE_AHEAD: 16 * M, RANGE_BEHIND: 2 * M, RANGE_SIDE: 15 * M,
    W_FORWARD: 1.0, W_OPEN: 1.2, W_LANE: 1.6, W_SIDE: 0.6,
    // Paciência: só troca de espaço se o novo for claramente melhor (STICK) e prefere se oferecer para o passe
    // a uma distância segura do portador (SUPPORT_DIST), em vez de correr o tempo todo
    W_SUPPORT: 1.1, SUPPORT_DIST: 8 * M, STICK: 0.35,
    // Zona tática (ETAPA 5): fora da elipse da posição na formação a nota cai (W_ZONE); extremos gostam da linha lateral, centroavante da área
    W_ZONE: 2.2, W_WIDE: 1.0, W_BOX: 1.0, HOME_P: 0.65,
    // Noção de impedimento: ao perceber que está impedido (tempo menor com Posicionamento alto) volta para a posição legal e fica em alerta
    OFF_REACT_SLOW: 1.2, OFF_REACT_FAST: 0.25, OFF_MARGIN: 1.2 * M, OFF_SAFE_T: 2.5,
    OPEN_CAP: 7 * M, LANE_CAP: 3.5 * M,
    RUN_CHANCE: 0.25,
    RUN_DEPTH_MIN: 4 * M, RUN_DEPTH_MAX: 9 * M,
    RUN_TIME_MIN: 1.1, RUN_TIME_MAX: 1.7,
    RUN_COOL_MIN: 5, RUN_COOL_MAX: 9,
    RUN_NEAR: 3 * M,
    RUN_BALL_MAX: 26 * M,
    // ETAPA 4: em cruzamentos/faltas laterais o cenário define uma "zona de atração" (a área);
    // parte dos espaços avaliados é sorteada ao redor dela e ganha bônus de pontuação.
    ATTRACT_P: 0.75, W_ATTRACT: 2.2,
    // Bola parada (antes da cobrança): pequenos ajustes ao redor da posição inicial, sempre atrás da linha
    SET_MARGIN: 1.5 * M, SET_DX: 2.5 * M, SET_DY: 1.5 * M, SET_WAIT_MIN: 1.5, SET_WAIT_MAX: 3.5, SET_SPEED_MUL: 0.4,
  },

  PASS: {
    LANE_ACCEPT: 4.5 * M,
    LANE_GOAL: 1.8 * M,
    LEAD_T: 0.5,
    EXTEND: 8 * M,
    RECV_SPEED: 1.5,
    TIMEOUT: 6,
  },
};

/* ------------------------------- Utilidades ------------------------------- */
const Util = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  lvl: v => Math.max(0, Math.min(1, (v - 1) / 98)),     // atributo 1..99 -> 0..1
  lvlGol: v => Util.lvl(v) * AI.KEEPER.NIVEL,             // habilidade efetiva do goleiro (reflexo x peso geral)
  smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
  wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; },
  segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  },
};
/** Sorteios (ETAPA 4). */
const Rnd = {
  r: (a, b) => a + Math.random() * (b - a),
  i: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  chance: p => Math.random() < p,
};


/* --------------------------------- Física --------------------------------- */
const Physics = {
  /** Avança a bola um passo h (s): atrito, efeito Magnus (rad/s), gravidade e quique. */
  stepBall(b, h) {
    const air = b.z > 0.01 || b.vz > 0;
    const sp0 = Math.hypot(b.vx, b.vy);
    if (sp0 > 0.001) {
      const magnus = b.spin * Util.clamp(sp0 / 150, 0, 1);
      const ang = Math.atan2(b.vy, b.vx) + magnus * h;
      const sp = air ? sp0 * Math.exp(-CFG.AIR_DRAG * h)
                     : sp0 * Math.exp(-CFG.DRAG * h) - CFG.ROLL * h;
      if (sp < 5) { b.vx = 0; b.vy = 0; b.spin = 0; }
      else { b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp; }
    }
    b.spin *= Math.exp(-CFG.SPIN_DECAY * h);
    if (air) {
      b.vz -= CFG.GRAVITY * h;
      b.z += b.vz * h;
      if (b.z <= 0) {
        b.z = 0;
        if (b.vz < -60) { b.vz = -b.vz * CFG.BOUNCE; b.vx *= 0.85; b.vy *= 0.85; b.bounces = (b.bounces || 0) + 1; }
        else b.vz = 0;
      }
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
  },
};

/* ---------------------------- Fôlego do lance (momentâneo) ---------------------------- */
/**
 * FÔLEGO DO LANCE: barra momentânea (0–100%) de cada boneco que nasce cheia a cada lance e cai conforme ele CORRE.
 *  - Gasto por segundo = GASTO × papel × coef × esforço^1.6, onde esforço = velocidade atual / velocidade máxima base.
 *    Só conta o tempo simulado (na câmera lenta gasta devagar também).
 *  - Papel: os ATACANTES (seu time, que conduz e se desmarca) cansam o dobro dos zagueiros (que guardam posição).
 *  - coef: fôlego (atributo 1–99) e energia da partida — jogador de pouco fôlego ou já gasto na partida esvazia mais rápido.
 *  - Andando ou parado (esforço < ESFORCO_RECUP) o jogador recupera o ar aos poucos.
 *  - Abaixo de LIMIAR% a velocidade cai até PISO (−30% com a barra vazia); drible/marcação caem até −20% nos duelos.
 *  - O que foi gasto no lance pesa um pouco na energia da partida (RESIDUO), só no campeonato (Game.cansacoDoLance).
 */
const FolegoLance = {
  GASTO: 7,                  // %/s em corrida máxima (atacante, fôlego 50, energia cheia) → ~14 s de arrancada esvaziam a barra
  PAPEL: { atk: 1, def: 0.5, recomp: 0.6 },
  RECUP: 6,                  // %/s recuperados parado (menos andando)
  ESFORCO_RECUP: 0.3,        // abaixo desta fração da velocidade máxima o jogador recupera em vez de gastar
  LIMIAR: 50,                // a partir daqui (para baixo) a velocidade começa a cair
  PISO: 0.7,                 // fator de velocidade com a barra vazia
  DUELO: 0.2,                // perda máxima de drible/marcação nos duelos com a barra vazia
  RESIDUO: 0.02,             // cada 1% gasto no lance tira 0,02% de energia da partida (barra inteira = −2%)
  /** Multiplicador de gasto pelo atributo fôlego e pela energia da partida (sem jogador real: 1). */
  coef(real) {
    if (!real) return 1;
    const f = Tatica.folego(real), en = Number.isFinite(real.energia) ? real.energia : 100;
    return (1.4 - 0.8 * f / 100) * (1 + 0.8 * (1 - Util.clamp(en, 0, 100) / 100));
  },
  /** Fator de velocidade pela barra (1 acima do LIMIAR). */
  fator(gas) { return gas >= this.LIMIAR ? 1 : Util.lerp(this.PISO, 1, gas / this.LIMIAR); },
  /** Fator de duelo (drible de quem conduz / marcação de quem chega). */
  duelo(e) { return 1 - this.DUELO * (1 - Util.clamp((e.gas ?? 100) / this.LIMIAR, 0, 1)); },
  /** Zera a barra do boneco (início do lance). */
  encher(e) { e.gas = 100; e.gasto = 0; e.fg = 1; if (!Number.isFinite(e.kGas)) e.kGas = 1; },
  /** Um passo da física: sp = velocidade atual, ref = velocidade máxima base (sem cansaço), papel = 'atk'|'def'|'recomp'. */
  atualizar(e, sp, ref, papel, h) {
    const esf = Util.clamp(sp / Math.max(ref, 1), 0, 1.2);
    if (esf > this.ESFORCO_RECUP) {
      const g = this.GASTO * this.PAPEL[papel] * e.kGas * Math.pow(esf, 1.6) * h;
      e.gas = Math.max(0, e.gas - g); e.gasto += g;
    } else {
      e.gas = Math.min(100, e.gas + this.RECUP * (1 - esf / this.ESFORCO_RECUP) * h / Math.max(e.kGas, 0.6));
    }
    e.fg = this.fator(e.gas);
  },
};

/* -------------------------------- Atacante -------------------------------- */
class Player {
  constructor(num, sx, sy) {
    this.num = num; this.sx = sx; this.sy = sy; this.tgt = { x: 0, y: 0 };
    this.visual = Aparencia.gerar('us', num);      // ETAPA 4B: aparência (pele, cabelo, barba, uniforme) — substituível por dados reais
    this.estadoAnim = Visual.novoEstado();         // ETAPA 4B: estado da animação (só leitura da física)
    this.fv = 1; this.fd = 1;                      // SISTEMA TÁTICO: fator individual de velocidade / drible (energia + improviso)
    this.reset();
  }
  reset() {
    this.x = this.sx; this.y = this.sy;
    this.vx = 0; this.vy = 0;
    this.facing = -Math.PI / 2;
    this.target = null;
    this.phase = 0;
    this.speedMul = 1; this.runT = 0; this.cool = 1 + Math.random() * 2;
    this.pl = AI.DEF.HOME_Y; this.margin = 0; this.goalX = this.x; this.goalY = this.y;
    this.offT = 0; this.safeT = 0;   // tempo impedido / tempo "em alerta" depois de voltar para a posição legal
    this.decideT = Math.random() * 0.4; this.side = this.sx >= CFG.FIELD.w / 2 ? 1 : -1;
    FolegoLance.encher(this);        // fôlego do lance: barra cheia a cada lance
  }
  /** Velocidade máxima BASE (atributo Velocidade), sem cansaço nem ritmo: referência do esforço no fôlego do lance. */
  baseSpeed(attr) { return (CFG.SPEED_MIN_MS + (CFG.SPEED_MAX_MS - CFG.SPEED_MIN_MS) * (attr.speed - 1) / 98) * CFG.M; }
  maxSpeed(attr) {
    const t = (attr.speed - 1) / 98;
    return (CFG.SPEED_MIN_MS + (CFG.SPEED_MAX_MS - CFG.SPEED_MIN_MS) * t) * CFG.M * this.speedMul * (this.fv || 1) * (this.fg || 1);   // fg: fôlego do lance (cai quando a barra passa da metade)
  }
  update(h, attr) {
    let dvx = 0, dvy = 0;
    if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 5) this.target = null;
      else {
        const spd = this.maxSpeed(attr) * Util.clamp(d / 50, 0.12, 1);
        dvx = dx / d * spd; dvy = dy / d * spd;
      }
    }
    const k = 1 - Math.exp(-7 * h);
    this.vx += (dvx - this.vx) * k;
    this.vy += (dvy - this.vy) * k;
    this.x += this.vx * h; this.y += this.vy * h;
    const m = CFG.PLAYER_R;
    if (this.foraCampo) {                                       // cobrador do escanteio: começou fora do campo; não se afasta mais e volta ao normal ao entrar
      const out = Math.max(m - this.x, this.x - (CFG.FIELD.w - m), m - this.y, 0);
      this.foraCampo = out > 0 ? Math.min(this.foraCampo, out) : 0;
    }
    const f = this.foraCampo || 0;
    this.x = Util.clamp(this.x, m - f, CFG.FIELD.w - m + f);
    this.y = Util.clamp(this.y, m - f, CFG.FIELD.bottom - m);
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 25) {
      const diff = Util.wrapAngle(Math.atan2(this.vy, this.vx) - this.facing);
      this.facing += diff * (1 - Math.exp(-12 * h));
    }
    this.phase += sp * h * 0.06;
  }
}

/* --------------------------------- Goleiro -------------------------------- */
class Keeper {
  constructor() {
    this.num = 1;
    this.visual = Aparencia.gerar('golAdv', 1);    // ETAPA 4B: uniforme de goleiro (roxo/limão) distinto dos times
    this.reset();
  }
  reset() {
    this.x = CFG.FIELD.w / 2; this.y = AI.KEEPER.Y_MIN;
    this.vx = 0; this.state = 'idle'; this.timer = 0; this.plan = null; this.stayT = 0;
    this.tx = this.x; this.dir = 1; this.diveSpeed = 0; this.anim = 0;
    this.facing = Math.PI / 2; this.stun = 0; this.palmCd = 0;
    this.estadoAnim = Visual.novoEstado();         // ETAPA 4B: (anim = progresso do mergulho, usado só para desenhar o boneco esticado)
  }
  idealPos(b) {
    const K = AI.KEEPER, G = CFG.GOAL, cx = CFG.FIELD.w / 2, gl = cx - G.w / 2, gr = cx + G.w / 2;
    const dist = Math.hypot(b.x - cx, b.y);
    const adv = Util.clamp((K.ADV_FAR - dist) / (K.ADV_FAR - K.ADV_NEAR), 0, 1);
    const y = Util.lerp(K.Y_MIN, K.Y_MAX, adv);
    const ax = gl - b.x, ay = 0 - b.y, bx = gr - b.x, by = 0 - b.y;
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    let dx = ax / la + bx / lb, dy = ay / la + by / lb;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    let x = cx;
    if (dy < -0.05 && b.y > y) x = b.x + dx * ((b.y - y) / -dy);
    else x = b.x;
    const sideK = Util.clamp(Math.abs(b.x - cx) / (G.w / 2 + 4 * M), 0, 1);
    const tight = Util.clamp((10 * M - b.y) / (8 * M), 0, 1) * Util.clamp((Math.abs(b.x - cx) - G.w / 4) / (G.w / 2), 0, 1);
    const off = Util.lerp(1.1 * M, 0.65 * M, tight);
    if (sideK > 0) x = Util.lerp(x, cx + Math.sign(b.x - cx) * (G.w / 2 - off), Math.max(0.85 * Math.sqrt(sideK), tight));
    const yy = Util.lerp(y, K.Y_MIN, tight);
    const lim = G.w / 2 - 8;
    return { x: Util.clamp(x, cx - lim, cx + lim), y: yy };
  }
  onShot(game) {
    const K = AI.KEEPER, t = Util.lvlGol(game.attr.reflex), b = game.ball, G = CFG.GOAL, cx = CFG.FIELD.w / 2;
    const lineY = this.y;
    const s = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin };
    let hit = null;
    for (let i = 0; i < 360; i++) {
      if (s.y <= lineY) { hit = { x: s.x, z: s.z }; break; }
      Physics.stepBall(s, CFG.FIXED_DT);
      if (Math.hypot(s.vx, s.vy) < 8 && s.z <= 0) break;
    }
    this.plan = null; this.state = 'idle';
    if (game.penalty) {                      // PÊNALTI: sorteia uma zona (esquerda, centro ou direita) sem ler a bola; chance pequena de acertar
      let z = Gen.pick([[-1, 0.38], [1, 0.38], [0, 0.24]]);
      if (hit && Math.random() < Util.lerp(0.05, 0.20, t)) z = Math.abs(hit.x - cx) < 1.0 * M ? 0 : Math.sign(hit.x - cx);
      this.timer = Util.lerp(0.07, 0.03, t);
      if (z === 0) { this.stayT = 1.0; return; }                      // fica no meio: não pula
      this.plan = { tx: cx + z * (1.8 + Math.random() * 2.6) * M, penalty: true };   // pula de 1,8 m até a trave (4,4 m)
      this.state = 'react';
      return;
    }
    if (!hit || Math.abs(hit.x - cx) > G.w / 2 + 28 || hit.z > CFG.GOAL_H * 1.2) return;
    const sx = b.vy < -1 ? b.x + b.vx * ((lineY - b.y) / b.vy) : b.x;
    const read = Util.clamp((t - K.READ_FROM) / K.READ_SPAN, 0, 1);
    let ex = Util.lerp(sx, hit.x, read);
    ex += (Math.random() * 2 - 1) * Util.lerp(K.ERR_MAX, K.ERR_MIN, t);
    ex = Util.clamp(ex, cx - G.w / 2 - 10, cx + G.w / 2 + 10);
    this.plan = { tx: ex };
    this.state = 'react';
    this.timer = Util.lerp(K.DELAY_MAX_MS, K.DELAY_MIN_MS, t) / 1000;
  }
  update(h, game) {
    const K = AI.KEEPER, t = Util.lvlGol(game.attr.reflex), b = game.ball;
    if (this.stun > 0) this.stun -= h;
    if (this.palmCd > 0) this.palmCd -= h;
    if (this.state === 'react') {
      this.timer -= h;
      if (this.timer <= 0) {
        const S = (this.plan.penalty ? Util.lerp(19, 23, t) : Util.lerp(K.DIVE_MIN, K.DIVE_MAX, t)) * CFG.M;   // pênalti: pulo explosivo
        const maxD = S * K.DIVE_TIME;
        this.diveSpeed = S;
        this.tx = Util.clamp(this.plan.tx, this.x - maxD, this.x + maxD);
        this.dir = Math.sign(this.tx - this.x) || 1;
        this.state = 'dive'; this.diveT = 0;
      }
    }
    if (this.state === 'react' && this.plan && this.plan.penalty) { this.vx = 0; return; }   // pênalti: parado até decidir o pulo (não acompanha a bola)
    if (this.state === 'dive') {
      const v = Util.clamp((this.tx - this.x) * 12, -this.diveSpeed, this.diveSpeed);
      this.vx += (v - this.vx) * (1 - Math.exp(-20 * h));
      this.x += this.vx * h;
      this.anim = Math.min(1, this.anim + h * 5);
      this.diveT += h;
      if (this.diveT > 0.9) { this.state = 'idle'; this.vx = 0; this.plan = null; }
      return;
    }
    if (this.anim > 0) this.anim = Math.max(0, this.anim - h * 2.5);
    if (b.state === 'held') { this.vx = 0; return; }
    if (this.stayT > 0) { this.stayT -= h; this.vx = 0; return; }       // pênalti: ficou no meio
    if (game.penaltyHold) {                  // pênalti antes do chute: parado em cima da linha do gol, sem avançar
      this.vx = 0; this.x += (CFG.FIELD.w / 2 - this.x) * (1 - Math.exp(-10 * h));
      this.y += (0.7 * CFG.M - this.y) * (1 - Math.exp(-10 * h));
      this.facing = Math.PI / 2;
      return;
    }
    const sw = game.sweepTarget(this);
    if (sw) {
      const dx = sw.x - this.x, dy = sw.y - this.y, d = Math.hypot(dx, dy) || 1, st = Math.min(d, sw.v * h * (this.stun > 0 ? 0.3 : 1));
      this.x += dx / d * st; this.y += dy / d * st; this.vx = dx / d * st / h;
      this.facing = Math.atan2(b.y - this.y, b.x - this.x);
      return;
    }
    const ideal = this.idealPos(b);
    const sp = Util.lerp(K.TRACK_MIN, K.TRACK_MAX, t) * CFG.M * (this.stun > 0 ? 0.3 : 1);
    const dx = Util.clamp(ideal.x - this.x, -sp * h, sp * h);
    this.x += dx; this.vx = dx / h;
    if (this.state === 'idle') this.y += Util.clamp(ideal.y - this.y, -sp * 0.6 * h, sp * 0.6 * h);
    this.facing = Math.atan2(b.y - this.y, b.x - this.x);
  }
}

/* -------------------------------- Zagueiro -------------------------------- */
/** ETAPA 4: criado a partir de um spec do cenário {num,x,y,hx,hy,wall}. hx/hy = posição de espera (linha/zona/barreira). */
class Defender {
  constructor(s) {
    this.num = s.num; this.sx = s.x; this.sy = s.y; this.hx = s.x; this.hy = s.y; this.wall = !!s.wall;
    this.pos = s.pos; this.slot = s.slot; this.fixed = !!s.fixed;   // ETAPA 5: função tática; fixed = não segue a formação (barreira/marcadores de bola parada)
    this.visual = s.visual || Aparencia.gerar('adv', s.num);        // ETAPA 4B: aparência (uniforme do adversário); `visual` no spec = jogador real
    this.estadoAnim = Visual.novoEstado();
    this.fv = 1; this.fm = 1;                                       // SISTEMA TÁTICO: fator individual de velocidade / marcação (energia + improviso)
    this.reset();
  }
  reset() {
    this.x = this.sx; this.y = this.sy;
    this.vx = 0; this.vy = 0; this.facing = Math.PI / 2;
    this.seed(this.sx, this.sy);
    this.markRef = null; this.tackleCd = 0; this.clearCd = 0; this.role = 'cover';
    this.recomp = false;                           // true = jogador que voltou para recompor (entra por baixo e persegue a bola)
    FolegoLance.encher(this);                      // fôlego do lance: barra cheia a cada lance
  }
  /** Posições \"percebidas\" iniciais (alvo da pressão, bola e atacante marcado). */
  seed(x, y) { this.px = this.bx = this.mx = this.zx = x; this.py = this.by = this.my = this.zy = y; }
}

/* -------------------------- Esquemas táticos (ETAPA 5) -------------------------- */
/**
 * Cada time tem uma FORMAÇÃO (ex.: 4-3-3). Cada posição da formação é um "slot":
 *   [pos, x, rd, ra]  -> pos = função (LB, CB, DM, CM, AM, LM, LW, ST...), x = lado (-1 esquerda ... +1 direita, do ponto
 *   de vista do próprio time), rd = profundidade (m desde o próprio gol) ao DEFENDER, ra = profundidade ao ATACAR.
 * Os lances são montados a partir dos slots: quem aparece no lance é escolhido pela formação e pela posição da bola
 * (nem sempre o meio-campo aparece). Em jogo, cada atacante-IA tem uma ZONA (elipse ao redor da posição da formação,
 * que acompanha a bola): fora dela a pontuação do espaço cai, então o ponta direito não vira ponta esquerdo.
 * SISTEMA TÁTICO: ESTILO (por formação do seu time) e POSTURA (equilibrada/ofensiva/defensiva) ajustam essas posições.
 */
const Tactics = {
  forms: { us: '4-3-3', opp: '4-4-2' },
  postura: 'equilibrada',           // postura do SEU time (campeonato); treino e amistoso usam sempre 'equilibrada'
  vazios: { us: new Set(), opp: new Set() },   // vagas de jogadores EXPULSOS ("função|lado"): ninguém aparece nelas nos lances
  FORMATIONS: {
    '4-4-2': [['LB', -.85, 20, 34], ['CB', -.3, 20, 26], ['CB', .3, 20, 26], ['RB', .85, 20, 34],
              ['LM', -.85, 38, 52], ['CM', -.28, 38, 46], ['CM', .28, 38, 46], ['RM', .85, 38, 52],
              ['ST', -.25, 60, 64], ['ST', .25, 60, 64]],
    '4-3-3': [['LB', -.85, 20, 34], ['CB', -.3, 20, 26], ['CB', .3, 20, 26], ['RB', .85, 20, 34],
              ['DM', 0, 30, 38], ['CM', -.4, 38, 48], ['CM', .4, 38, 48],
              ['LW', -.85, 52, 62], ['ST', 0, 60, 66], ['RW', .85, 52, 62]],
    '4-2-3-1': [['LB', -.85, 20, 34], ['CB', -.3, 20, 26], ['CB', .3, 20, 26], ['RB', .85, 20, 34],
                ['DM', -.3, 30, 38], ['DM', .3, 30, 38],
                ['LW', -.8, 46, 58], ['AM', 0, 46, 56], ['RW', .8, 46, 58], ['ST', 0, 60, 66]],
    '3-5-2': [['CB', -.5, 20, 26], ['CB', 0, 20, 26], ['CB', .5, 20, 26],
              ['LWB', -.9, 32, 48], ['RWB', .9, 32, 48], ['DM', 0, 30, 38], ['CM', -.35, 38, 48], ['CM', .35, 38, 48],
              ['ST', -.25, 60, 64], ['ST', .25, 60, 64]],
    '5-3-2': [['LWB', -.9, 20, 44], ['CB', -.45, 20, 26], ['CB', 0, 20, 26], ['CB', .45, 20, 26], ['RWB', .9, 20, 44],
              ['CM', -.4, 38, 48], ['DM', 0, 32, 40], ['CM', .4, 38, 48],
              ['ST', -.25, 60, 64], ['ST', .25, 60, 64]],
    '3-4-3': [['CB', -.5, 20, 26], ['CB', 0, 20, 26], ['CB', .5, 20, 26],
              ['LM', -.85, 38, 52], ['CM', -.25, 38, 46], ['CM', .25, 38, 46], ['RM', .85, 38, 52],
              ['LW', -.8, 52, 62], ['ST', 0, 60, 66], ['RW', .8, 52, 62]],
    '4-1-4-1': [['LB', -.85, 20, 34], ['CB', -.3, 20, 26], ['CB', .3, 20, 26], ['RB', .85, 20, 34], ['DM', 0, 30, 38],
                ['LM', -.85, 40, 54], ['CM', -.3, 40, 48], ['CM', .3, 40, 48], ['RM', .85, 40, 54], ['ST', 0, 60, 66]],
  },
  TYPE: { LW: 'W', RW: 'W', LM: 'WM', RM: 'WM', LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB', CB: 'CB', DM: 'DM', CM: 'CM', AM: 'AM', ST: 'ST' },
  LABEL: { LB: 'LE', RB: 'LD', LWB: 'ALE', RWB: 'ALD', CB: 'ZG', DM: 'VOL', CM: 'MC', AM: 'MEI', LM: 'ME', RM: 'MD', LW: 'PE', RW: 'PD', ST: 'CA' },
  // Zona de cada tipo (m): rx = meia-largura lateral; up = quanto pode ir à frente (rumo ao gol); dn = quanto pode recuar;
  // wide = gosto por ficar aberto junto à linha lateral; box = gosto por frequentar a área
  PROFILE: {
    W: { rx: 9, up: 14, dn: 8, wide: 1 }, WM: { rx: 9, up: 12, dn: 9, wide: 0.7 }, FB: { rx: 7, up: 12, dn: 8, wide: 0.8 },
    ST: { rx: 11, up: 10, dn: 8, box: 1 }, AM: { rx: 12, up: 9, dn: 8 }, CM: { rx: 12, up: 9, dn: 9 },
    DM: { rx: 10, up: 7, dn: 7 }, CB: { rx: 8, up: 6, dn: 6 },
  },
  RUNNERS: new Set(['W', 'ST', 'AM', 'WM']),      // só estes tipos fazem ultrapassagem
  NUM: { LB: [3], RB: [2], LWB: [3, 13], RWB: [2, 12], CB: [4, 5, 15], DM: [6, 16], CM: [8, 17, 18], AM: [10, 20],
         LM: [11, 14], RM: [7, 19], LW: [11], RW: [7], ST: [9, 19, 21] },

  /**
   * Como cada formação do SEU time ataca nos lances (por tipo de função):
   *   amp   = multiplicador da abertura lateral da posição; depth = metros a mais à frente; aBonus = preferência extra para aparecer
   *   no lance; wide = gosto por ficar colado na linha lateral; runners = tipos que passam a fazer ultrapassagem.
   *   4-3-3: amplitude, pontas bem abertos. 4-4-2: dupla de ataque próxima, meio-campo compacto. 3-5-2: centro forte, alas projetados.
   */
  ESTILO: {
    '4-3-3': { amp: { W: 1.12 }, aBonus: { W: 3 }, wide: 1.35 },
    '4-4-2': { amp: { ST: 0.6, CM: 0.85, WM: 0.9 }, depth: { ST: -1 }, aBonus: { ST: 4, WM: 1 }, wide: 0.75 },
    '3-5-2': { amp: { CM: 0.8, FB: 1.04 }, depth: { FB: 5, CM: 1 }, aBonus: { CM: 2, FB: 5, DM: 1 }, wide: 1.1, runners: ['FB'] },
  },
  /** Postura do SEU time nos lances: dy = metros que o bloco sobe (+) ou recua (-); na = atacantes a mais/menos; run = chance de infiltração. */
  POSTURA: {
    equilibrada: { dy: 0, na: 0, run: 1 },
    ofensiva:    { dy: 3.5, na: 1, run: 1.5 },
    defensiva:   { dy: -4, na: -1, run: 0.6 },
  },
  estilo() { return this.ESTILO[this.forms.us] || {}; },
  post() { return this.POSTURA[this.postura] || this.POSTURA.equilibrada; },
  /** Esse tipo de função faz ultrapassagem na formação atual? */
  corre(tipo) { const E = this.estilo(); return this.RUNNERS.has(tipo) || !!(E.runners && E.runners.includes(tipo)); },

  // Preferência BASE por tipo (m de "bônus" na escolha de quem aparece no lance); cada cenário soma o seu.
  // Atacante: quem joga na frente aparece mais; zagueiros quase nunca. Defensor: a linha de trás aparece, atacantes do rival não.
  ABASE: { ST: 3, W: 3, AM: 2, WM: 2, CM: 0, DM: -2, FB: -5, CB: -12 },
  DBASE: { CB: 6, FB: 4, DM: 2, CM: 0, AM: -5, WM: -5, W: -10, ST: -12 },
  type(pos) { return this.TYPE[pos] || 'CM'; },
  slots(form) { return this.FORMATIONS[form].map(([pos, x, rd, ra]) => ({ pos, x, rd, ra })); },
  /** Slots de quem está em campo (sem as vagas dos expulsos): com um a menos, o lance tem um jogador a menos daquele setor. */
  emCampo(side) { const F = this.forms, vz = this.vazios[side]; return this.slots(side === 'us' ? F.us : F.opp).filter(s => !vz.has(s.pos + '|' + s.x)); },
  numFor(pos, used) {
    for (const n of this.NUM[pos]) if (!used.has(n)) { used.add(n); return n; }
    let n = 12; while (used.has(n)) n++; used.add(n); return n;
  },

  /**
   * Posição de formação de um ATACANTE (nosso time sobe: y menor = mais perto do gol). O bloco acompanha a bola.
   * O estilo da formação (abertura/profundidade de cada função) e a postura (bloco mais alto ou mais baixo) ajustam o lugar.
   */
  attackHome(slot, ball, lineY) {
    const W = CFG.FIELD.w, E = this.estilo(), t = this.type(slot.pos), P = this.post();
    const depth = slot.ra + ((E.depth && E.depth[t]) || 0) + P.dy + 0.85 * ((105 - ball.y / M) - 52);
    const y = Util.clamp((105 - depth) * M, lineY + 1.2 * M, CFG.FIELD.bottom - 2 * M);   // nunca à frente da linha de impedimento
    const x = W / 2 + slot.x * ((E.amp && E.amp[t]) || 1) * 28 * M;
    return { x: Util.clamp(x, 3 * M, W - 3 * M), y };
  },
  /** Posição de formação do ADVERSÁRIO defendendo (gol em y=0). tac = {line, comp, lat, by0}: a linha desce quando a bola avança. */
  defendHome(slot, tac, ball) {
    const W = CFG.FIELD.w, line = Util.clamp(tac.line + (ball.y - tac.by0) * 0.35, 5 * M, 40 * M);
    const x = W / 2 - slot.x * 28 * M * tac.lat + (ball.x - W / 2) * 0.25;
    return { x: Util.clamp(x, 8 * M, W - 8 * M), y: Math.max(2.5 * M, line + (slot.rd - 20) * tac.comp * M) };   // nunca colado na linha lateral
  },

  /** Afasta jogadores sobrepostos no momento de montar o lance. */
  relax(list) {
    const W = CFG.FIELD.w, R = CFG.PLAYER_R;
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2.6 * R) continue;
      const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0, push = (2.6 * R - d) / 2;
      if (i > 0) { a.x = Util.clamp(a.x - ux * push, R, W - R); a.y -= uy * push; }
      b.x = Util.clamp(b.x + ux * push, R, W - R); b.y += uy * push;
    }
  },

  /**
   * Monta atacantes e defensores a partir das formações.
   * c: {bx,by (bola), na, nd, line (linha defensiva, px), comp (compactação 0..1), lat (abertura lateral),
   *     carrier:[posições que podem receber a bola], aBonus:{tipo:m}, dBonus:{tipo:m}}.
   * O 1º atacante é o portador (fica na bola); os demais são os que a formação coloca mais perto da ação.
   * Postura ofensiva traz +1 atacante (sem quebrar o equilíbrio numérico do lance); defensiva, -1 (mínimo 2).
   */
  assemble(c) {
    const F = this.forms, ball = { x: c.bx, y: c.by }, tac = { line: c.line, comp: c.comp, lat: c.lat, by0: c.by };
    const E = this.estilo(), P = this.post(), aBonus = { ...c.aBonus };
    for (const k in (E.aBonus || {})) aBonus[k] = (aBonus[k] || 0) + E.aBonus[k];
    const SA = this.emCampo('us'), SD = this.emCampo('opp');
    let na = c.na + P.na;
    if (P.na > 0 && na - c.nd > 1) na = c.na;
    na = Util.clamp(na, Math.min(2, c.na), SA.length);
    const dist = e => Math.hypot(e.h.x - c.bx, e.h.y - c.by);
    const A = SA.map(s => ({ slot: s, pos: s.pos, h: this.attackHome(s, ball, c.line) }));
    const byDist = A.slice().sort((u, v) => dist(u) - dist(v));
    const car = A.filter(e => c.carrier.includes(e.pos)).sort((u, v) => dist(u) - dist(v))[0] || byDist[0];
    const rest = A.filter(e => e !== car).map(e => ({ e, k: dist(e) / M - (this.ABASE[this.type(e.pos)] || 0) - (aBonus[this.type(e.pos)] || 0) }))
                  .sort((u, v) => u.k - v.k).slice(0, na - 1).map(o => o.e);
    const ua = new Set();
    const attackers = [car, ...rest].map((e, i) => ({ pos: e.pos, slot: e.slot, num: this.numFor(e.pos, ua),
      x: i ? e.h.x : c.bx, y: i ? e.h.y : c.by }));
    const D = SD.map(s => ({ slot: s, pos: s.pos, h: this.defendHome(s, tac, ball) }));
    const pick = D.map(e => ({ e, k: dist(e) / M - (this.DBASE[this.type(e.pos)] || 0) - (c.dBonus[this.type(e.pos)] || 0) })).sort((u, v) => u.k - v.k).slice(0, c.nd).map(o => o.e);
    const ud = new Set();
    const defenders = pick.map(e => ({ pos: e.pos, slot: e.slot, num: this.numFor(e.pos, ud), x: e.h.x, y: e.h.y }));
    this.relax(attackers); this.relax(defenders);
    return { attackers, defenders, tac };
  },

  /**
   * Bola parada: posições já definidas pelo cenário; só atribui função/slot ao jogador da formação mais próximo de cada uma.
   * Com expulsos, faltando gente para todas as posições, as últimas ficam vazias (o time realmente tem menos jogadores).
   */
  fill(side, positions, c) {
    const ball = { x: c.bx, y: c.by }, tac = { line: c.line, comp: c.comp, lat: c.lat, by0: c.by };
    const pool = this.emCampo(side).map(s => ({ slot: s, pos: s.pos, taken: false,
      h: side === 'us' ? this.attackHome(s, ball, c.line) : this.defendHome(s, tac, ball) }));
    const used = new Set();
    return positions.map((p, i) => {
      let cand = pool.filter(e => !e.taken && (!(i === 0 && p.prefer) || p.prefer.includes(e.pos)));
      if (!cand.length) cand = pool.filter(e => !e.taken);
      if (!cand.length) return null;                                            // não sobrou ninguém em campo para esta posição
      cand.sort((u, v) => Math.hypot(u.h.x - p.x, u.h.y - p.y) - Math.hypot(v.h.x - p.x, v.h.y - p.y));
      const e = cand[0]; e.taken = true;
      return { ...p, pos: e.pos, slot: e.slot, num: this.numFor(e.pos, used) };
    }).filter(Boolean);
  },
};

/* ----------------------- Gerador procedural de lances (ETAPA 6) ----------------------- */
/**
 * Em vez de lances "de molde", cada PERFIL sorteia uma situação seguindo regras de futebol e o gerador VALIDA o resultado:
 *  - equilíbrio numérico realista (tabelas [atacantes, defensores]); em partida nunca passa de +1 atacante (nada de 5 x 1);
 *  - bloco defensivo montado pela formação (altura da linha, compactação, lado fraco fechando por dentro);
 *  - todo atacante nasce em posição legal (sem impedimento) e ninguém nasce colado no portador;
 *  - "vulnerabilidade": conta as opções livres do atacante (companheiro livre com linha de passe limpa + chute com a linha
 *    limpa) e exige que fique na faixa do perfil; se a defesa nascer exposta (ou o lance impossível), sorteia de novo.
 * Cada perfil devolve um spec com `rules` (faixas do validador). O spec final traz `qa` (métricas) para conferência.
 */
const Gen = {
  TRIES: 30,
  /** Sorteio ponderado em tabela [[valor, peso], ...]. */
  pick(tab) { let r = Math.random() * tab.reduce((s, t) => s + t[1], 0); for (const t of tab) { r -= t[1]; if (r <= 0) return t[0]; } return tab[0][0]; },
  shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; },
  /** Lado fraco fecha por dentro: quem está longe da bola (bx) se aproxima dela; k = força do deslocamento (0..1). */
  tuck(defs, bx, k) {
    const W = CFG.FIELD.w;
    for (const d of defs) d.x = Util.clamp(d.x + (bx - d.x) * k * Util.clamp(Math.abs(d.x - bx) / (20 * M), 0, 1), 2 * M, W - 2 * M);
  },
  /** Desorganização: tira cada jogador do lugar em até (jx, jy) metros (a partir do índice `from`). */
  jitter(list, jx, jy, from = 0) {
    const W = CFG.FIELD.w;
    list.forEach((o, i) => { if (i < from) return; o.x = Util.clamp(o.x + Rnd.r(-jx, jx) * M, 2 * M, W - 2 * M); o.y = Math.max(2 * M, o.y + Rnd.r(-jy, jy) * M); });
  },

  /** Métricas de um lance recém-montado (posições iniciais). */
  analyze(spec) {
    const A = spec.attackers, D = spec.defenders, car = A[0], cx = CFG.FIELD.w / 2;
    const kY = spec.keeper && spec.keeper.y != null ? spec.keeper.y : AI.KEEPER.Y_MIN;
    const ball = { x: car.x, y: car.y - CFG.CARRY_DIST };
    let m1 = kY, m2 = Infinity;                                    // linha de impedimento = 2º mais recuado (goleiro incluso)
    for (const d of D) { if (d.y < m1) { m2 = m1; m1 = d.y; } else if (d.y < m2) m2 = d.y; }
    const line = Math.min(m2, ball.y);
    let nearCar = Infinity, free = 0, offs = 0, shot = 0, gap = 0, minSep = Infinity;
    for (const d of D) nearCar = Math.min(nearCar, Math.hypot(d.x - car.x, d.y - car.y));
    for (const a of A.slice(1)) {
      if (a.y < CFG.FIELD.midY && a.y < line - 1) { offs++; continue; }
      let near = Infinity, lane = Infinity;
      for (const d of D) { near = Math.min(near, Math.hypot(d.x - a.x, d.y - a.y)); lane = Math.min(lane, Util.segDist(d.x, d.y, ball.x, ball.y, a.x, a.y)); }
      if (near >= 5 * M && lane >= 2 * M) free++;                 // companheiro livre e com linha de passe limpa
    }
    if (Math.hypot(ball.x - cx, ball.y) < 30 * M) {                // chute com a linha até o centro do gol limpa
      let lane = Infinity; for (const d of D) lane = Math.min(lane, Util.segDist(d.x, d.y, ball.x, ball.y, cx, 0));
      if (lane >= 2.2 * M) shot = 1;
    }
    const xs = D.map(d => d.x).sort((u, v) => u - v);              // maior buraco lateral entre defensores vizinhos
    for (let i = 0; i + 1 < xs.length; i++) gap = Math.max(gap, xs[i + 1] - xs[i]);
    const all = [...A, ...D];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) minSep = Math.min(minSep, Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y));
    return { free, shot, open: free + shot, offs, nearCar, gap, line, minSep, na: A.length, nd: D.length };
  },
  /** Nota de reprovação (0 = lance válido). */
  check(spec) {
    const r = spec.rules || {}, m = this.analyze(spec); let bad = 0;
    const diff = m.na - m.nd, maxDiff = r.maxDiff != null ? r.maxDiff : 1;
    if (diff > maxDiff) bad += 3 * (diff - maxDiff);                                   // superioridade numérica exagerada
    if (!spec.noOffside && m.offs) bad += 2 * m.offs;                                  // atacante já nasce impedido
    if (r.open) { if (m.open < r.open[0]) bad += r.open[0] - m.open; if (m.open > r.open[1]) bad += m.open - r.open[1]; }
    if (r.gap && m.nd >= 3 && m.gap > r.gap) bad += 1;                                 // buraco grande na linha defensiva
    if (r.minNear && m.nearCar < r.minNear) bad += 1;                                  // defensor colado no portador
    if (m.minSep < 1.6 * CFG.PLAYER_R) bad += 1;                                       // jogadores sobrepostos
    spec.qa = { ...m, bad };
    return bad;
  },
  /** Sorteia com o perfil, valida e repete até passar (ou fica com o melhor das TRIES tentativas). */
  gerar(make) {
    let best = null, bs = Infinity, i = 0;
    for (; i < this.TRIES; i++) { const s = make(); const b = this.check(s); if (b < bs) { bs = b; best = s; } if (b === 0) break; }
    best.qa.tentativas = i + 1;
    return best;
  },
};

/* ------------------------- Gerador de cenários (ETAPA 4/5/6) ------------------------ */
/**
 * Cada perfil define a situação (bola, números, bloco defensivo) e delega a montagem às formações (Tactics.assemble/fill).
 * Devolve um spec:
 *   { type, name, sub, attackers:[{num,pos,slot,x,y,visual?}] (o 1º começa com a bola), defenders:[{num,pos,slot,x,y,wall?,fixed?,visual?}],
 *     tac (linha defensiva dinâmica), holdY, leash, shift?, attract:{x,y,r}|null, setPiece:bool,
 *     rules (faixas do validador), noOffside?, corner?, keeper?:{x,y}, recv?:{vx,vy,maxZ,bounces} }
 */
const Scenarios = {
  TYPES: ['contra', 'entrada', 'parada', 'ponta', 'fechada', 'posicional', 'escanteio', 'penalti', 'um_x_um', 'costas', 'roubada', 'lado', 'fundo', 'rebote', 'bloco'],
  forceN: 0,   // 0 = sorteia 5 a 7 jogadores por lado no cenário posicional; senão fixa o número
  WEIGHTS: { contra: 1, entrada: 1, parada: 0.9, ponta: 0.8, fechada: 0.7, posicional: 1, escanteio: 1, penalti: 0.12, um_x_um: 0.6, costas: 0.8, roubada: 0.7, lado: 0.7, fundo: 0.6, rebote: 0.5, bloco: 0.7 },
  LABEL: { contra: 'Contra-ataque', entrada: 'Entrada da área', parada: 'Bola parada (falta)', ponta: 'Ponta/Cruzamento', fechada: 'Defesa fechada', posicional: 'Jogo posicional',
           escanteio: 'Escanteio', penalti: 'Pênalti', um_x_um: 'Cara a cara', costas: 'Bola nas costas', roubada: 'Bola recuperada', lado: 'Superioridade pelo lado',
           fundo: 'Linha de fundo', rebote: 'Segunda bola', bloco: 'Bloco baixo' },
  TALK: {
    contra: ['Roubou a bola! Saída em velocidade...', 'Erro na saída deles: contra-ataque!', 'Transição rápida pelo meio-campo...'],
    entrada: ['Boa triangulação no meio-campo...', 'Time empurra o rival para a área.', 'Posse paciente na entrada da área...'],
    parada: ['Falta perigosa perto da área!', 'Árbitro marca falta: bola parada!', 'Falta cometida, vem a cobrança!'],
    ponta: ['Bola longa para a ponta!', 'Lançamento açucarado pela lateral...', 'O ponta recebe aberto, olho na área!'],
    posicional: ['Jogo de posse, todo mundo no campo de ataque...', 'Time troca passes procurando o espaço.', 'Bola rodando: paciência para achar a brecha.'],
    fechada: ['Adversário recuou todo mundo...', 'Retranca! Rival se fecha lá atrás.', 'Defesa em duas linhas esperando.'],
    escanteio: ['Escanteio a favor! Área cheia...', 'A defesa afasta para escanteio.', 'Bola na bandeirinha: vem o cruzamento!'],
    penalti: ['PÊNALTI! O árbitro aponta a marca da cal!', 'Derrubado na área: pênalti!', 'Pênalti marcado! Silêncio no estádio...'],
    um_x_um: ['Passe açucarado! Cara a cara com o goleiro!', 'Quebrou a linha: vai ficar sozinho!', 'Escapou da marcação, goleiro na frente!'],
    costas: ['Bola nas costas da zaga! Cuidado com o impedimento...', 'Lançamento em profundidade!', 'A defesa sobe a linha: dá para explorar o espaço.'],
    roubada: ['Roubou a bola no campo de ataque!', 'Pressão alta funciona: bola recuperada!', 'A defesa foi pega desorganizada...'],
    lado: ['O time acumula gente pelo lado do campo...', 'Triangulação pela ponta: superioridade!', 'Jogada pelo corredor, defesa deslocada...'],
    fundo: ['Chegou na linha de fundo!', 'Ponta vence o lateral e vai ao fundo!', 'Bola rasteira para trás vem aí...'],
    rebote: ['A bola sobrou na entrada da área!', 'Rebote! Segunda bola para o ataque.', 'Dividida e a bola sobra...'],
    bloco: ['Rival se fecha e deixa o chute de fora...', 'Bloco baixo: tem espaço na entrada da área.', 'Defesa recuada espera o ataque.'],
  },
  KICKERS: ['AM', 'CM', 'LW', 'RW', 'LM', 'RM', 'DM', 'ST'],
  WINGERS: ['LW', 'RW', 'LM', 'RM', 'AM', 'CM'],

  /** Barreira a 9,15 m da bola, na linha bola -> centro do gol. */
  wall(bx, by, n) {
    const cx = CFG.FIELD.w / 2, dx = cx - bx, dy = -by, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const dist = 9.15 * M, px = -uy, py = ux, gap = 26;
    return Array.from({ length: n }, (_, i) => ({
      x: bx + ux * dist + px * (i - (n - 1) / 2) * gap, y: by + uy * dist + py * (i - (n - 1) / 2) * gap, wall: true, fixed: true }));
  },

  /* ---------- Jogo corrido ---------- */
  /** Contra-ataque: 3x2, 2x1, 3x3 (defesa se recompondo) ou 4x3, a partir do meio-campo. */
  contra() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 2], 0.35], [[2, 1], 0.2], [[3, 3], 0.25], [[4, 3], 0.2]]);
    const bx = cx + Rnd.r(-12, 12) * M, by = Rnd.r(48, 52) * M;
    const line = ({ 1: Rnd.r(23, 27), 2: Rnd.r(31, 35), 3: Rnd.r(27, 31) }[nd]) * M;
    const t = Tactics.assemble({ bx, by, na, nd, line, comp: nd === 3 ? 0.6 : 0.5, lat: 0.8,
      carrier: ['CM', 'DM', 'AM', 'ST'], aBonus: { W: 6, ST: 5, AM: 3, WM: 4 }, dBonus: { CB: 8, FB: 4 } });
    Gen.tuck(t.defenders, bx, 0.15); Tactics.relax(t.defenders);
    return { type: 'contra', name: nd === 3 ? 'CONTRA-ATAQUE • DEFESA SE RECOMPONDO' : 'CONTRA-ATAQUE RÁPIDO', sub: `${t.attackers.length} x ${nd} • espaço para correr, enfiar ou tabelar`, ...t,
      holdY: 1e9, leash: 3, attract: null, setPiece: false, rules: { open: nd === 3 ? [0, 2] : [1, 3], minNear: 6 * M } };
  },

  /** Ataque posicional contra uma linha fechada de 3 ou 4 defensores na entrada da área. */
  entrada() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 3], 0.3], [[3, 4], 0.25], [[4, 4], 0.3], [[4, 3], 0.15]]);
    const t = Tactics.assemble({ bx: cx + Rnd.r(-12, 12) * M, by: Rnd.r(23, 27) * M, na, nd, line: Rnd.r(17, 19.5) * M, comp: 0.55, lat: 0.75,
      carrier: ['AM', 'CM', 'ST', 'LW', 'RW', 'LM', 'RM'], aBonus: { ST: 4, AM: 3, W: 3, WM: 2, CM: 1 }, dBonus: { CB: 7, FB: 5, DM: 3 } });
    return { type: 'entrada', name: 'ATAQUE POSICIONAL', sub: `${t.attackers.length} x ${nd} • tabela, drible curto ou chute de fora`, ...t,
      holdY: 30 * M, attract: null, setPiece: false, rules: { open: [0, 2], gap: nd >= 4 ? 17 * M : 22 * M, minNear: 3.5 * M } };
  },

  /** Ponta recebe aberto; os outros atacantes correm para a área para finalizar. */
  ponta() {
    const W = CFG.FIELD.w, cx = W / 2, side = Rnd.chance(0.5) ? -1 : 1, [na, nd] = Gen.pick([[[3, 3], 0.3], [[3, 4], 0.3], [[4, 4], 0.25], [[4, 3], 0.15]]);
    const bx = side < 0 ? Rnd.r(3, 6) * M : W - Rnd.r(3, 6) * M;
    const t = Tactics.assemble({ bx, by: Rnd.r(34, 38) * M, na, nd, line: Rnd.r(14, 16.5) * M, comp: 0.5, lat: 0.8,
      carrier: side < 0 ? ['LW', 'LM', 'LWB', 'LB'] : ['RW', 'RM', 'RWB', 'RB'],
      aBonus: { ST: 8, AM: 6, W: 5, WM: 4, CM: 2 }, dBonus: { CB: 8, FB: 5 } });
    Gen.tuck(t.defenders, bx, 0.2); Tactics.relax(t.defenders);
    return { type: 'ponta', name: 'LANÇAMENTO NA PONTA', sub: `${t.attackers.length} x ${nd} • cruze para os atacantes na área`, ...t,
      holdY: 30 * M, attract: { x: cx, y: 9.5 * M, r: 6 * M }, setPiece: false, rules: { open: [0, 2], gap: 24 * M } };
  },

  /** Retranca: 5 defensores em duas linhas dentro da área contra 2 ou 3 atacantes. */
  fechada() {
    const cx = CFG.FIELD.w / 2, na = Rnd.chance(0.7) ? 3 : 2;
    const t = Tactics.assemble({ bx: cx + Rnd.r(-8, 8) * M, by: Rnd.r(21, 25) * M, na, nd: 5, line: Rnd.r(9, 10.5) * M, comp: 0.45, lat: 0.7,
      carrier: ['AM', 'CM', 'ST', 'LW', 'RW', 'LM', 'RM'], aBonus: { ST: 3, W: 4, AM: 3, WM: 3 }, dBonus: { CB: 10, FB: 8, DM: 5, CM: 3 } });
    return { type: 'fechada', name: 'DEFESA FECHADA', sub: `${t.attackers.length} x 5 • retranca: chute de fora, bola alçada ou drible curto`, ...t,
      holdY: 30 * M, shift: 0.6, leash: 2.2, attract: null, setPiece: false, rules: { open: [0, 1], minNear: 4 * M, maxDiff: 0 } };
  },

  /** Jogo posicional com muita gente (padrão 6 x 6, sorteia 5 a 7): quem aparece depende da formação. */
  posicional() {
    const cx = CFG.FIELD.w / 2, n = this.forceN || Rnd.i(5, 7);
    const t = Tactics.assemble({ bx: cx + Rnd.r(-10, 10) * M, by: Rnd.r(30, 34) * M, na: n, nd: n, line: Rnd.r(17, 19) * M, comp: 0.75, lat: 1,
      carrier: ['CM', 'AM', 'DM', 'LM', 'RM', 'ST'], aBonus: { ST: 3, AM: 3, W: 3, WM: 2, CM: 1 }, dBonus: { CB: 4, FB: 4, DM: 4, CM: 3 } });
    return { type: 'posicional', name: 'JOGO POSICIONAL', sub: `${t.attackers.length} x ${n} • tenha paciência: troque passes e ache a brecha`, ...t,
      holdY: 1e9, leash: 1, attract: null, setPiece: false, rules: { open: [0, 2], gap: 20 * M } };
  },

  /** Lançamento em profundidade: defesa com a linha ALTA e atacantes no limite do impedimento. */
  costas() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 4], 0.5], [[4, 4], 0.3], [[3, 5], 0.2]]);
    const bx = cx + Rnd.r(-14, 14) * M, by = Rnd.r(40, 47) * M, line = Rnd.r(25, 30) * M;
    const t = Tactics.assemble({ bx, by, na, nd, line, comp: 0.55, lat: 0.8, carrier: ['CM', 'DM', 'AM'],
      aBonus: { ST: 8, W: 6, AM: 3, WM: 3 }, dBonus: { CB: 8, FB: 5, DM: 2 } });
    return { type: 'costas', name: 'BOLA NAS COSTAS DA DEFESA', sub: `${t.attackers.length} x ${nd} • lançamento em profundidade, cuidado com o impedimento`, ...t,
      holdY: 34 * M, attract: { x: cx + Rnd.r(-8, 8) * M, y: line - 4 * M, r: 6 * M }, setPiece: false, rules: { open: [0, 2], gap: 22 * M, minNear: 8 * M } };
  },

  /** Bola recuperada no campo de ataque: defesa desorganizada, linha alta, poucos segundos para agir. */
  roubada() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 3], 0.4], [[4, 3], 0.2], [[3, 4], 0.2], [[4, 4], 0.2]]);
    const bx = cx + Rnd.r(-14, 14) * M, by = Rnd.r(33, 40) * M;
    const t = Tactics.assemble({ bx, by, na, nd, line: Rnd.r(21, 26) * M, comp: 0.75, lat: 1,
      carrier: ['CM', 'DM', 'AM', 'LM', 'RM', 'ST'], aBonus: { ST: 4, AM: 4, W: 4, WM: 3, CM: 2 }, dBonus: { CB: 5, FB: 5, DM: 3, CM: 3 } });
    Gen.jitter(t.defenders, 2.6, 3); Tactics.relax(t.defenders);
    return { type: 'roubada', name: 'BOLA RECUPERADA NO ATAQUE', sub: `${t.attackers.length} x ${nd} • defesa desorganizada: aja rápido`, ...t,
      holdY: 1e9, leash: 2, attract: null, setPiece: false, rules: { open: [1, 3], minNear: 3.8 * M, gap: 26 * M } };
  },

  /** Superioridade pelo corredor: 3x2 ou 4x3 junto à lateral; a defesa se desloca, mas o lado fraco ainda está chegando. */
  lado() {
    const W = CFG.FIELD.w, cx = W / 2, side = Rnd.chance(0.5) ? -1 : 1, [na, nd] = Gen.pick([[[3, 2], 0.5], [[4, 3], 0.5]]);
    const bx = side < 0 ? Rnd.r(5, 9) * M : W - Rnd.r(5, 9) * M, by = Rnd.r(30, 38) * M;
    const t = Tactics.assemble({ bx, by, na, nd, line: Rnd.r(16, 19) * M, comp: 0.5, lat: 0.55,
      carrier: side < 0 ? ['LW', 'LM', 'LWB', 'LB'] : ['RW', 'RM', 'RWB', 'RB'],
      aBonus: { ST: 6, AM: 5, W: 4, WM: 3, CM: 3 }, dBonus: { CB: 6, FB: 6, DM: 3, CM: 2 } });
    Gen.tuck(t.defenders, bx, 0.45); Tactics.relax(t.defenders);
    return { type: 'lado', name: 'SUPERIORIDADE PELO LADO', sub: `${t.attackers.length} x ${nd} • defesa deslocada: tabele ou cruze`, ...t,
      holdY: 28 * M, attract: { x: cx, y: 10 * M, r: 7 * M }, setPiece: false, rules: { open: [1, 3], minNear: 4.5 * M } };
  },

  /** Ponta chega à linha de fundo: passe rasteiro para trás, para quem vem de frente para o gol. */
  fundo() {
    const cx = CFG.FIELD.w / 2, side = Rnd.chance(0.5) ? -1 : 1, na = Rnd.chance(0.5) ? 3 : 4, nd = Rnd.chance(0.5) ? 4 : 5;
    const bx = cx + side * Rnd.r(14, 19) * M, by = Rnd.r(5, 8) * M, c = { bx, by, line: 6.5 * M, comp: 0.4, lat: 0.7 };
    const slots = [{ x: cx + side * Rnd.r(-1, 2) * M, y: Rnd.r(11, 12.5) * M }, { x: cx - side * Rnd.r(3, 6) * M, y: Rnd.r(10, 12) * M },
                   { x: cx + side * Rnd.r(-2, 5) * M, y: Rnd.r(16, 18) * M }];
    const atts = [{ x: bx, y: by, prefer: this.WINGERS }, ...slots.slice(0, na - 1)];
    const defs = [{ x: cx + side * Rnd.r(0.5, 2.5) * M, y: 5.5 * M }, { x: cx - side * Rnd.r(2, 3.5) * M, y: 5.5 * M },
                  { x: cx + side * Rnd.r(6, 8) * M, y: 4.5 * M }, { x: cx - side * Rnd.r(0, 2) * M, y: Rnd.r(14.5, 16) * M }];
    if (nd === 5) defs.push({ x: cx - side * Rnd.r(6.5, 8.5) * M, y: 5 * M });
    const A = Tactics.fill('us', atts, c), D = Tactics.fill('opp', defs, c); Tactics.relax(A); Tactics.relax(D);
    return { type: 'fundo', name: 'LINHA DE FUNDO • CRUZAMENTO RASTEIRO', sub: `${na} x ${nd} • rasteiro para trás: ache quem vem de frente para o gol`,
      attackers: A, defenders: D, tac: { line: c.line, comp: c.comp, lat: c.lat, by0: by },
      holdY: 1e9, attract: { x: cx, y: 10 * M, r: 6 * M }, setPiece: false, rules: { open: [0, 2] } };
  },

  /** Segunda bola na entrada da área: a bola sobra, dividida e defesa fora de posição. */
  rebote() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 3], 0.35], [[4, 4], 0.25], [[3, 4], 0.25], [[4, 3], 0.15]]);
    const bx = cx + Rnd.r(-11, 11) * M, by = Rnd.r(19, 23) * M;
    const t = Tactics.assemble({ bx, by, na, nd, line: Rnd.r(13, 16) * M, comp: 0.7, lat: 0.8, carrier: ['AM', 'CM', 'ST', 'DM'],
      aBonus: { ST: 4, AM: 4, W: 3, WM: 3, CM: 3 }, dBonus: { CB: 6, FB: 4, DM: 4, CM: 3 } });
    Gen.jitter(t.defenders, 2.4, 2.4);
    let k = 0; t.defenders.forEach((d, i) => { if (Math.hypot(d.x - bx, d.y - by) < Math.hypot(t.defenders[k].x - bx, t.defenders[k].y - by)) k = i; });
    t.defenders[k].x = bx + Rnd.r(-3, 3) * M; t.defenders[k].y = by - Rnd.r(4.5, 6) * M;      // alguém na dividida, à frente da bola
    Tactics.relax(t.defenders);
    return { type: 'rebote', name: 'SEGUNDA BOLA NA ENTRADA DA ÁREA', sub: `${t.attackers.length} x ${nd} • bola sobrou: chute de primeira ou toque rápido`, ...t,
      recv: { vx: Rnd.r(-70, 70), vy: -Rnd.r(100, 200), maxZ: 30, bounces: 1 },
      holdY: 1e9, leash: 1.6, attract: null, setPiece: false, rules: { open: [0, 2], minNear: 3.6 * M } };
  },

  /** Chute de fora contra bloco baixo: defesa recuada deixa a entrada da área aberta (bater ou tocar). */
  bloco() {
    const cx = CFG.FIELD.w / 2, [na, nd] = Gen.pick([[[3, 4], 0.35], [[3, 5], 0.25], [[4, 5], 0.2], [[4, 4], 0.2]]);
    const t = Tactics.assemble({ bx: cx + Rnd.r(-10, 10) * M, by: Rnd.r(26, 30) * M, na, nd, line: Rnd.r(11, 14) * M, comp: 0.5, lat: 0.7,
      carrier: ['CM', 'AM', 'DM'], aBonus: { ST: 3, W: 4, AM: 3, WM: 3 }, dBonus: { CB: 10, FB: 8, DM: 5, CM: 3 } });
    return { type: 'bloco', name: 'CHUTE DE FORA • BLOCO BAIXO', sub: `${t.attackers.length} x ${nd} • defesa recuada: bata de fora ou ache a brecha`, ...t,
      holdY: 32 * M, shift: 0.6, leash: 2.2, attract: null, setPiece: false, rules: { open: [0, 2], gap: 16 * M, minNear: 5 * M } };
  },

  /* ---------- Bola parada ---------- */
  /** Falta: frontal (cobrança direta, barreira de 2-3) ou lateral (cruzamento/passe ensaiado). */
  parada() { return Rnd.chance(0.5) ? this.frontal() : this.lateral(); },
  frontal() {
    const cx = CFG.FIELD.w / 2, nw = Rnd.chance(0.5) ? 2 : 3, bx = cx + Rnd.r(-7, 7) * M, by = Rnd.r(19.5, 24) * M;
    const c = { bx, by, line: 8 * M, comp: 0.5, lat: 0.8 };
    const defs = this.wall(bx, by, nw);
    defs.push({ x: cx - Rnd.r(3, 6) * M, y: Rnd.r(7, 10) * M, fixed: true }, { x: cx + Rnd.r(3, 6) * M, y: Rnd.r(7, 10) * M, fixed: true });
    const atts = [{ x: bx, y: by + CFG.CARRY_DIST, prefer: this.KICKERS },
                  { x: cx - Rnd.r(10, 13) * M, y: Rnd.r(18, 21) * M }, { x: cx + Rnd.r(10, 13) * M, y: Rnd.r(18, 21) * M }];
    return { type: 'parada', name: 'FALTA FRONTAL', sub: `barreira de ${nw} • bata direto ou ensaie o passe`,
      attackers: Tactics.fill('us', atts, c), defenders: Tactics.fill('opp', defs, c), tac: null,
      holdY: 1e9, attract: null, setPiece: true, rules: { maxDiff: 99 } };
  },
  lateral() {
    const cx = CFG.FIELD.w / 2, side = Rnd.chance(0.5) ? -1 : 1, bx = cx + side * Rnd.r(20, 24) * M, by = Rnd.r(27, 33) * M;
    const c = { bx, by, line: 8 * M, comp: 0.5, lat: 0.8 }, na = Rnd.chance(0.6) ? 3 : 4;
    const atts = [{ x: bx, y: by + CFG.CARRY_DIST, prefer: this.KICKERS }, { x: cx + Rnd.r(-7, -3) * M, y: Rnd.r(19, 22) * M },
                  { x: cx + Rnd.r(3, 8) * M, y: Rnd.r(19, 22) * M }];
    if (na === 4) atts.push({ x: cx + Rnd.r(-1, 1) * M, y: Rnd.r(23, 25) * M });
    const defs = this.wall(bx, by, 2);
    for (const k of [-5.5, 0, 5.5]) defs.push({ x: cx + k * M + Rnd.r(-1, 1) * M, y: Rnd.r(8, 12) * M, fixed: true });
    return { type: 'parada', name: 'FALTA LATERAL', sub: 'barreira de 2 • cruze ou ensaie o passe na área',
      attackers: Tactics.fill('us', atts, c), defenders: Tactics.fill('opp', defs, c), tac: null,
      holdY: 1e9, attract: { x: cx, y: 11 * M, r: 7 * M }, setPiece: true, rules: { maxDiff: 99 } };
  },

  /**
   * Escanteio: 4-6 atacantes na área contra 7-9 defensores (2 nas traves, marcação individual, zona na pequena área e, às vezes,
   * um esperando o contra-ataque fora da área). O cruzamento sai no alto (efeito automático) e a disputa de cabeça é decidida
   * pelo jogo (Posicionamento x Marcação). 25% das vezes é escanteio curto, com um companheiro perto do batedor.
   */
  escanteio() {
    const W = CFG.FIELD.w, cx = W / 2, s = Rnd.chance(0.5) ? -1 : 1;                // s: lado do escanteio (-1 esquerda, +1 direita)
    const curto = Rnd.chance(0.25), nIn = curto ? Rnd.i(3, 4) : Rnd.i(4, 6);
    const bx = s < 0 ? 8 : W - 8, by = 8, c = { bx, by, line: 8 * M, comp: 0.5, lat: 0.8 };      // bola dentro do arco de 1 m do canto
    const dir = Math.atan2(1, -s), kx = bx - Math.cos(dir) * CFG.CARRY_DIST, ky = by - Math.sin(dir) * CFG.CARRY_DIST;   // cobrador atrás da bola, fora do campo
    const slots = Gen.shuffle([{ x: cx + s * 4.5 * M, y: 7 * M }, { x: cx + s * 0.5 * M, y: 11 * M }, { x: cx - s * 4.5 * M, y: 8 * M },
                               { x: cx - s * 0.5 * M, y: 5.2 * M }, { x: cx + s * 5.5 * M, y: 14 * M }, { x: cx - s * 8.5 * M, y: 13 * M }]).slice(0, nIn);
    const ins = slots.map(p => ({ x: p.x + Rnd.r(-1.2, 1.2) * M, y: p.y + Rnd.r(-1, 1) * M }));
    const atts = [{ x: kx, y: ky, prefer: this.WINGERS }, ...ins];
    if (curto) atts.push({ x: bx - s * Rnd.r(4.5, 6) * M, y: Rnd.r(9, 11) * M });          // opção curta junto à lateral
    const nd = Gen.pick([[7, 0.35], [8, 0.4], [9, 0.25]]);
    const mk = Math.min(ins.length, nd - 3), rest = nd - 2 - mk, wait = rest >= 1 ? 1 : 0;
    const zoneAll = [{ x: cx - s * 2.4 * M, y: 5.2 * M }, { x: cx + s * 2.4 * M, y: 5.2 * M }, { x: cx, y: 8.6 * M }, { x: cx - s * 5.5 * M, y: 6.5 * M }];
    const zone = zoneAll.slice(0, Math.min(rest - wait, 4));
    const defs = [{ x: cx - 3.6 * M, y: 1.5 * M }, { x: cx + 3.6 * M, y: 1.5 * M }];                       // traves
    for (let i = 0; i < mk; i++) defs.push({ x: ins[i].x + (cx - ins[i].x) * 0.1, y: ins[i].y - 1.6 * M });      // marcação individual (lado do gol)
    defs.push(...zone);
    if (wait) defs.push({ x: cx + Rnd.r(-8, 8) * M, y: Rnd.r(21, 26) * M });                              // esperando o contra-ataque
    for (let k = 0; defs.length < nd; k++) defs.push({ x: cx + (k % 2 ? 1 : -1) * Rnd.r(2, 6) * M, y: 17.5 * M });   // sobrou gente: borda da área
    for (const d of defs) d.fixed = true;
    const A = Tactics.fill('us', atts, c), D = Tactics.fill('opp', defs, c); Tactics.relax(A); Tactics.relax(D);
    return { type: 'escanteio', name: curto ? 'ESCANTEIO CURTO' : 'ESCANTEIO', sub: curto ? `${A.length} x ${D.length} • toque curto ou cruze na área` : `${A.length} x ${D.length} • arraste forte: a bola vai no alto, a cabeçada é automática`,
      attackers: A, defenders: D, tac: null, holdY: 1e9, attract: { x: cx, y: 8 * M, r: 6 * M }, setPiece: true, noOffside: true, corner: true,
      ball: { x: bx, y: by }, facing: dir, foraCampo: 2 * M,
      rules: { maxDiff: 99 } };
  },

  /** Pênalti: só o batedor e o goleiro; os demais esperam fora da área e fora do arco (9,15 m da marca). */
  penalti() {
    const cx = CFG.FIELD.w / 2, na = Rnd.i(3, 4), nd = Rnd.i(3, 4), spot = CFG.SPOT_Y, c = { bx: cx, by: spot, line: 18 * M, comp: 0.5, lat: 0.8 };
    const atts = [{ x: cx, y: spot + CFG.CARRY_DIST, prefer: this.KICKERS }], defs = [];
    for (let i = 0; i < na - 1; i++) atts.push({ x: cx + (i - (na - 2) / 2) * Rnd.r(6, 8) * M, y: Rnd.r(20.5, 21.5) * M });
    for (let i = 0; i < nd; i++) defs.push({ x: cx + (i - (nd - 1) / 2) * Rnd.r(6, 8) * M + 3 * M * (i % 2 ? 1 : -1), y: Rnd.r(22.2, 23.2) * M, fixed: true });
    const A = Tactics.fill('us', atts, c), D = Tactics.fill('opp', defs, c); Tactics.relax(A); Tactics.relax(D);
    return { type: 'penalti', name: 'PÊNALTI', sub: 'cobrança direta • só você e o goleiro',
      attackers: A, defenders: D, tac: null, holdY: 1e9, attract: null, setPiece: true, noOffside: true, penalty: true, keeper: { x: cx, y: 0.7 * M }, rules: { maxDiff: 99 } };
  },

  /** Cara a cara: o atacante escapou da marcação; um zagueiro vem de trás (às vezes dois) e pode haver um companheiro de apoio. */
  um_x_um() {
    const cx = CFG.FIELD.w / 2, bx = cx + Rnd.r(-8, 8) * M, by = Rnd.r(19, 25) * M, c = { bx, by, line: 20 * M, comp: 0.5, lat: 0.8 };
    const apoio = Rnd.chance(0.35), nd = Rnd.chance(0.4) ? 2 : 1, sd = Rnd.chance(0.5) ? -1 : 1;
    const atts = [{ x: bx, y: by, prefer: ['ST', 'LW', 'RW', 'AM', 'CM'] }];
    if (apoio) atts.push({ x: bx + sd * Rnd.r(5, 8) * M, y: by + Rnd.r(2, 5) * M });
    const defs = [{ x: bx + Rnd.r(-1.5, 1.5) * M, y: by + Rnd.r(4.5, 6) * M, fixed: true }];
    if (nd === 2) defs.push({ x: bx - sd * Rnd.r(6, 10) * M, y: by + Rnd.r(8, 12) * M, fixed: true });
    const A = Tactics.fill('us', atts, c), D = Tactics.fill('opp', defs, c);
    return { type: 'um_x_um', name: 'CARA A CARA COM O GOLEIRO', sub: `${A.length} x ${D.length} • drible o goleiro, toque ou bata`,
      attackers: A, defenders: D, tac: null, holdY: 1e9, attract: null, setPiece: false, rules: { minNear: 4 * M } };
  },

  /** MODO TREINO: 4 atacantes contra 1 zagueiro (e o goleiro). A dica de cada lance ensina um controle por vez. */
  TIPS: ['1) Toque no gramado para CORRER com a bola. Chegue perto do gol!',
         '2) Arraste da bola PARA TRÁS e solte: é o chute/passe (estilingue).',
         '3) Mire num companheiro livre (anel azul) e solte para PASSAR.',
         '4) Sem ninguém na frente? Mire no gol e CHUTE.',
         '5) Depois de soltar, toque na bola: embaixo levanta, nos lados faz curva.',
         'Treino livre: tente driblar, tabelar e fazer gols de formas diferentes!'],
  treino(n) {
    const cx = CFG.FIELD.w / 2;
    const t = Tactics.assemble({ bx: cx + Rnd.r(-8, 8) * M, by: Rnd.r(27, 30) * M, na: 4, nd: 1, line: Rnd.r(15, 17) * M, comp: 0.5, lat: 0.6,
      carrier: ['CM', 'AM', 'DM'], aBonus: { ST: 6, W: 5, AM: 3, WM: 3, CM: 2 }, dBonus: { CB: 8 } });
    return { type: 'treino', name: `TREINO ${n + 1}`, sub: '4 atacantes x 1 zagueiro • faça o gol!', ...t, holdY: 1e9, attract: null, setPiece: false,
      tacLabel: 'Sem relógio, sem pressão', tip: this.TIPS[Math.min(n, this.TIPS.length - 1)] };
  },

  /** Monta o lance do tipo pedido já validado pelo gerador (regras de futebol + vulnerabilidade). */
  make(type) {
    const s = Gen.gerar(() => this[type]());
    const P = { ofensiva: '  •  Ofensiva', defensiva: '  •  Defensiva' }[Tactics.postura] || '';
    s.tacLabel = `Seu ${Tactics.forms.us}${P}  ×  Adv. ${Tactics.forms.opp}`;
    return s;
  },
};

/* Atributos do MODO TREINO (fáceis para quem está aprendendo): zagueiro lento e goleiro fraco, companheiros espertos */
const TRAIN_ATTR = { force: 70, curve: 60, speed: 60, dribble: 60, pos: 75, reflex: 20, mark: 12, oatk: 60, mdef: 50 };

/* ---------------------------------- Jogo ----------------------------------
   Classe Game: estado do lance, controles (corrida, estilingue, ponto de contato), companheiros, passe, impedimento,
   IA da zaga e do goleiro, passo fixo da física e loop principal. Os métodos da TRANSMISSÃO (relógio, narração,
   placar, campeonato na partida) ficam em transmissao.js e são instalados no protótipo por main.js. */
class Game {
  constructor(canvas, stage) {
    // Atributos ligados aos sliders. oatk = Ataque do Adversário; mdef = Sua Defesa (ambos só nos intervalos)
    this.attr = { force: 70, curve: 60, speed: 60, dribble: 50, pos: 50, reflex: 50, mark: 50, oatk: 60, mdef: 50 };
    this.attackers = []; this.player = null;
    this.keeper = new Keeper();
    this.defenders = [];
    this.pressIdx = 0; this.pressAtt = null; this.stallTime = 0;
    this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, rot: 0, state: 'carried' };
    this.pass = null; this.strike = null;
    this.renderer = new Renderer(canvas, stage);
    this.input = new Input(canvas, this);

    this.timeScale = 1; this.acc = 0;
    this.aim = null; this.cooldown = 0; this.path = [];
    this.scored = false; this.out = false; this.stopped = false;
    this.msg = null; this.resetTimer = 0;
    this.fps = 60; this.fpsAcc = 0; this.fpsFrames = 0;
    // ETAPA 4
    this.scn = null; this.tac = null; this.setPiece = null; this.holdY = 1e9; this.trans = null; this.banner = null;
    this.forceScn = 'rand'; this.lastType = null; this.match = null; this.goalCounted = false; this._hudKey = '';
    this.sinceRecv = 99; this.mode = 'match'; this.view = 'broadcast'; this.speed = 1; this.showAids = false; this.menuOpen = true; this.started = false; this.stash = null; this.trainStats = { plays: 0, goals: 0 };   // modos: 'match' | 'train'
    this.$ = id => document.getElementById(id);
    this.lineups = null; this.cx = new Ctx(); this.fora = false; this.fxAtual = null;   // CAMPEONATO: times reais da partida (null = treino/amistoso)
    this.tj = null;                                                                    // SISTEMA TÁTICO: substituições da partida do campeonato
    this.newMatch();

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ----- Carregamento de cenário ----- */
  /** Monta o lance a partir do spec: atacantes, zagueiros, bola e estado (substitui o reset fixo). */
  loadScenario(spec) {
    this.scn = spec; this.loadId = (this.loadId || 0) + 1;   // loadId: o Renderer usa para destacar o jogador no início do lance
    this.attackers = spec.attackers.map(s => {
      const a = new Player(s.num, s.x, s.y); a.pos = s.pos; a.slot = s.slot;
      if (s.visual) a.visual = s.visual;               // ETAPA 4B: aparência de jogador real vinda do cenário (opcional)
      return a;
    });
    this.player = this.attackers[0];
    this.keeper.reset();
    this.defenders = spec.defenders.map(s => new Defender(s));
    this.holdY = spec.holdY; this.tac = spec.tac; this.setPiece = spec.setPiece ? {} : null;
    this.pressIdx = 0; this.pressAtt = null; this.stallTime = 0; this.pass = null;
    this.lanceT = 0; this.recuoT = 0; this.recompN = 0; this.recompT = 0;   // relógio da recomposição (por lance)
    const b = this.ball, p = this.player;
    b.state = 'carried'; b.vx = b.vy = b.spin = 0; b.z = b.vz = 0;
    b.x = p.x; b.y = p.y - CFG.CARRY_DIST;
    if (spec.ball) { b.x = spec.ball.x; b.y = spec.ball.y; }                      // escanteio: bola no arco do canto
    if (spec.facing != null) p.facing = spec.facing;                             // ...com o cobrador de frente para a área
    p.foraCampo = spec.foraCampo || 0;                                                     // ...e podendo estar fora do campo até entrar
    if (this.setPiece) for (const d of this.defenders) { this.keepFromBall(d); this.keepFromBall(d, 'hx', 'hy'); this.keepFromBall(d, 'sx', 'sy'); }   // falta: ninguém a menos de 9,15 m
    for (const d of this.defenders) d.seed(p.x, p.y);
    const line = Math.min(this.offsideLineY(), b.y);          // companheiros já nascem lendo a linha real
    for (const a of this.attackers) a.pl = line;
    this.snapDef = true; this.sinceRecv = 99;
    this.penalty = !!spec.penalty; this.penaltyHold = this.penalty; this.restartKick = false;   // pênalti: goleiro na linha até o chute
    this.noOffside = !!spec.noOffside; this.corner = !!spec.corner; this.aerial = false; this.aerialUp = false;   // escanteio/pênalti: sem impedimento no 1º toque
    if (spec.keeper) { if (spec.keeper.x != null) this.keeper.x = spec.keeper.x; if (spec.keeper.y != null) this.keeper.y = spec.keeper.y; }
    if (spec.recv) { this.sinceRecv = 0.3; this.recvInfo = spec.recv; }                  // segunda bola: o 1º toque já é "de primeira"
    this.firstTouched = false; this.touchT = 0;               // limite para o primeiro toque (só na partida)
    this.aim = null; this.strike = null; this.path = [];
    this.scored = false; this.out = false; this.stopped = false; this.postHit = false;
    this.msg = null; this.toast = null; this.resetTimer = 0; this.decide = null;
    this.cooldown = 0; this.acc = 0; this.timeScale = 1; this.goalCounted = false; this.goalLog = null;
    this.shooter = null; this.tackler = null; this.offsideP = null;     // autor do último chute, quem desarmou, receptor impedido (só para a narração)
    this.aplicarElenco();
    this.input.cancel();
    this.renderer.snapCamera(this);
  }
  /**
   * Primeiro toque: enquanto o jogador não correr nem mirar, o lance fica "esperando" (a defesa pode ficar na linha).
   * Na PARTIDA há um limite (CFG.FIRST_TOUCH_TIME): estourou, o lance é perdido e o jogo segue. No treino não há limite.
   */
  tickFirstTouch(dt) {
    if (this.firstTouched || this.locked) return;
    if (this.aim || this.strike || this.player.target || this.ball.state !== 'carried') { this.firstTouched = true; return; }
    if (this.trans || this.menuOpen || this.mode !== 'match' || this.match.over) return;   // contagem só com o lance rolando
    this.touchT += dt;
    if (this.touchT >= CFG.FIRST_TOUCH_TIME) this.finish('TEMPO ESGOTADO!', '#fca5a5', 'Você demorou para dar o primeiro toque', 2);
  }
  /**
   * Regra da falta: nenhum adversário pode ficar a menos de 9,15 m da bola enquanto ela estiver parada.
   * Empurra (x, y) para fora do círculo; a barreira já nasce exatamente na borda e não é afetada.
   */
  keepFromBall(o, kx = 'x', ky = 'y') {
    const b = this.ball, R9 = 9.15 * CFG.M - 1;
    let dx = o[kx] - b.x, dy = o[ky] - b.y; const d = Math.hypot(dx, dy);
    if (d >= R9) return;
    if (d < 1e-3) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }      // sem direção definida: empurra para o lado do gol
    o[kx] = b.x + dx * R9; o[ky] = b.y + dy * R9;
  }
  showBanner() { const d = this.mode === 'train' ? 4.5 : 3.2; this.banner = { name: this.scn.name, sub: this.scn.sub, tac: this.scn.tacLabel, t: d, dur: d }; }

  /** Botão "Reiniciar Lance": refaz o MESMO cenário, sem contar o resultado. */
  fullReset() {
    if (this.mode === 'train') { this.loadScenario(this.scn); this.showBanner(); return; }
    if (this.view !== 'play' || this.match.over) return;
    if (this.goalCounted) {
      const m = this.match; m.home = Math.max(0, m.home - 1); m.goalsUs = Math.max(0, m.goalsUs - 1);
      m.log = m.log.filter(e => e !== this.goalLog);
    }
    this.loadScenario(this.scn); this.showBanner();
  }

  /* ----- Fôlego do lance ----- */
  /**
   * Atualiza a barra momentânea de cada boneco pela velocidade em que está correndo neste passo.
   * Atacantes usam o papel 'atk' (cansam mais); zagueiros 'def'; quem voltou para recompor 'recomp'. Goleiro não entra.
   */
  folegoLance(h) {
    const ref = this.attackers.length ? this.attackers[0].baseSpeed(this.attr) : 1;
    for (const a of this.attackers) FolegoLance.atualizar(a, Math.hypot(a.vx, a.vy), ref, 'atk', h);
    const D = AI.DEF, t = Util.lvl(this.attr.mark), C = CFG.RECOMP;
    const refD = Util.lerp(D.SPEED_MIN, D.SPEED_MAX, t) * CFG.M, refR = Util.lerp(C.VEL_MIN, C.VEL_MAX, t) * CFG.M;
    for (const d of this.defenders) FolegoLance.atualizar(d, Math.hypot(d.vx, d.vy), d.recomp ? refR : refD, d.recomp ? 'recomp' : 'def', h);
  }
  /**
   * Fim do lance (campeonato): o que cada jogador real gastou de fôlego no lance pesa um pouco na energia da partida
   * (barra inteira gasta = −2%). Chamado por afterPlay antes do desgaste do minuto.
   */
  cansacoDoLance() {
    if (!this.lineups) return;
    for (const e of [...this.attackers, ...this.defenders]) {
      if (!e.real || !(e.gasto > 0) || !Number.isFinite(e.real.energia)) continue;
      e.real.energia = Math.max(0, e.real.energia - e.gasto * FolegoLance.RESIDUO);
      e.gasto = 0;
    }
  }

  /* ----- Campeonato: elenco real no lance, uniformes e placar ----- */
  /**
   * Dá a cada boneco do lance o titular real do slot correspondente (nome, camisa e aparência/uniforme do clube) e os fatores
   * individuais de energia/improviso (fv velocidade, fd drible, fm marcação). Física da bola intacta.
   */
  aplicarElenco() {
    const L = this.lineups; if (!L) return;
    const poe = (e, time) => {
      const p = Elenco.porSlot(time, e.pos, e.slot && e.slot.x); if (!p) return;
      e.real = p; e.num = p.num; e.visual = p.visual;
      e.fv = Tatica.relativo(p, time, 'velocidade'); e.fd = Tatica.relativo(p, time, 'drible'); e.fm = Tatica.relativo(p, time, 'marcacao');
      e.kGas = FolegoLance.coef(p);             // fôlego do lance: pouco fôlego / energia baixa = barra esvazia mais rápido
    };
    for (const a of this.attackers) poe(a, L.us);
    for (const d of this.defenders) poe(d, L.op);
    this.keeper.real = L.op.gk; this.keeper.visual = L.op.gk.visual;
  }

  /* ----- Modos de jogo ----- */
  /** MODO TREINO: lances fáceis em sequência (4x1), sem relógio nem placar. Guarda os atributos da partida e usa um perfil fácil. */
  startTraining() {
    this.sairLiga();
    if (this.mode !== 'train') this.stash = { ...this.attr };
    Object.assign(this.attr, TRAIN_ATTR);
    this.mode = 'train'; this.started = true; this.trans = null; this.trainStats = { plays: 0, goals: 0 }; this._hudKey = '';
    this.$('end').classList.remove('show');
    document.body.classList.add('train'); this.$('next').textContent = 'Novo lance';
    this.view = 'play'; this.setBroadcastUI(false);          // treino: campo direto, sem transmissão
    this.loadTrainingPlay();
  }
  loadTrainingPlay() {
    this.loadScenario(Scenarios.treino(this.trainStats.plays));
    this.showBanner(); this.$('tip').textContent = this.scn.tip;
  }

  /** Ajudas visuais (linha de impedimento, alvo do passe, zona de cancelar): sempre no treino; na partida só se ligadas nas Opções. */
  get aids() { return this.mode === 'train' || this.showAids; }

  /** O lance terminou (gol, fora, defesa, desarme ou impedimento): a bola não pode mais ser jogada. */
  get locked() { return this.scored || this.out || this.stopped; }

  finish(text, color, sub, time) {
    if (this.locked) return;
    this.stopped = true;
    this.msg = { text, color, sub, age: 0 };
    this.resetTimer = time;
    this.aim = null; this.strike = null; this.pass = null; this.decide = null;
    for (const a of this.attackers) a.target = null;
  }

  /* ----- Controle de corrida ----- */
  setRunTarget(p) {
    if (this.locked || this.trans || this.setPiece) return;     // bola parada: o batedor fica no lugar
    this.decide = null;
    const m = CFG.PLAYER_R;
    this.player.target = {
      x: Util.clamp(p.x, m, CFG.FIELD.w - m),
      y: Util.clamp(p.y, m, CFG.FIELD.bottom - m),
    };
  }

  setActive(a) {
    const old = this.player;
    if (a === old) return;
    old.target = null; old.decideT = 0.15;
    this.player = a; a.target = null; a.speedMul = 1;
    this.stallTime = 0;
  }

  /* ----- Fase 1: estilingue (apenas direção e força) ----- */
  canGrab(p, grab) {
    if (this.locked || this.strike || this.ball.state !== 'carried') return false;
    return Math.hypot(p.x - this.ball.x, p.y - this.ball.y) <= grab ||
           Math.hypot(p.x - this.player.x, p.y - this.player.y) <= grab;
  }
  startAim(sx, sy) { this.aim = { sx, sy, dx: 0, dy: 0, t: 0, lim: this.setPiece ? CFG.AIM_TIME_PARADA : CFG.AIM_TIME }; }   // lim: bola parada dá mais tempo
  aimEscape() {
    const b = this.ball, p = this.player;
    if (b.state !== 'carried') { this.aim = null; return; }
    this.markRestart(p);                                       // a bola escapou do pé do batedor
    const a = Math.random() * Math.PI * 2, sp = 110 + Math.random() * 80;
    b.state = 'free'; b.vx = Math.cos(a) * sp + p.vx * 0.5; b.vy = Math.sin(a) * sp + p.vy * 0.5; b.vz = 0; b.spin = 0; Som.chute(0.3);
    this.cooldown = 0.6; this.path = []; this.pass = null; this.aim = null; this.decide = null;
    this.toast = { text: 'A BOLA ESCAPOU!', t: 1.3, color: '#fca5a5' };
  }
  updateAim(sx, sy) {
    const a = this.aim; if (!a) return;
    a.dx = (sx - a.sx) / this.renderer.s; a.dy = (sy - a.sy) / this.renderer.s;
  }
  computeShot() {
    const a = this.aim; if (!a) return null;
    const dx = a.dx, dy = a.dy, L = Math.hypot(dx, dy);
    if (L < CFG.MIN_PULL) return null;
    return {
      ux: -dx / L, uy: -dy / L,
      power: Util.clamp((L - CFG.MIN_PULL) / (CFG.MAX_PULL - CFG.MIN_PULL), 0, 1),
    };
  }
  buildKick(shot, mx, my) {
    let lift = Util.clamp(my, 0, 1); const drive = Util.clamp(-my, 0, 1);
    const cross = !!this.corner && shot.power > 0.3;            // escanteio com força: cruzamento no alto (efeito automático)
    if (cross) lift = Math.max(lift, 0.65);
    const maxShot = 240 + 6.5 * this.attr.force;
    let speed = 100 + shot.power * (maxShot - 100);
    speed *= (1 + 0.12 * drive) * (1 - 0.22 * lift) * (1 - 0.12 * Math.abs(mx));
    if (cross) speed *= 1.4;
    const maxSpin = 0.15 + 0.85 * (this.attr.curve / 99);
    return {
      vx: shot.ux * speed + this.player.vx * 0.3,
      vy: shot.uy * speed + this.player.vy * 0.3,
      vz: lift > 0.03 ? lift * (140 + 0.5 * speed) : 0,
      spin: -mx * maxSpin * CFG.CONTACT_CURVE_SIGN,
      lift, curve: -mx * CFG.CONTACT_CURVE_SIGN,
    };
  }
  predict(kick) {
    const b = { x: this.ball.x, y: this.ball.y, z: 0, vx: kick.vx, vy: kick.vy, vz: kick.vz, spin: kick.spin };
    const pts = [{ x: b.x, y: b.y }], h = CFG.FIXED_DT;
    let land = null, flew = kick.vz > 0;
    for (let i = 1; i <= 420; i++) {
      Physics.stepBall(b, h);
      if (flew && !land && b.z === 0) land = { x: b.x, y: b.y };
      if (i % 6 === 0) pts.push({ x: b.x, y: b.y });
      if (Math.hypot(b.vx, b.vy) < 12 || b.y < -CFG.GOAL.depth || b.x < -30 || b.x > CFG.FIELD.w + 30 || b.y > CFG.FIELD.bottom) break;
    }
    pts.push({ x: b.x, y: b.y });
    return { pts, land };
  }
  releaseAim() {
    const shot = this.computeShot();
    this.aim = null;
    if (!shot || this.ball.state !== 'carried') return;
    this.decide = null;
    // COMO e DE ONDE a bola aparece na tela de contato depende de como ela chegou ao jogador:
    //  - bola parada: fica PARADA no centro ('still');
    //  - chute de primeira: passe rasteiro desliza (vindo do lado de onde veio o passe), passe alto passa voando ('fly')
    //    e, se já tinha quicado, chega quicando ('bounce'/'drop');
    //  - bola conduzida: desliza reta ou em diagonal.
    const info = this.recvInfo, first = this.sinceRecv < 1.0 && !!info && !this.setPiece;
    let kind, dir = Math.random() < 0.5 ? 1 : -1, slope = Math.random() < 0.5 ? 1 : -1, n = 2;
    if (this.setPiece) kind = 'still';
    else if (first) {
      const sp = Math.hypot(info.vx, info.vy) || 1;
      if (Math.abs(info.vx) / sp > 0.25) dir = info.vx > 0 ? 1 : -1;       // vinha para a direita => entra pela esquerda
      if (info.maxZ <= 10) { kind = Math.abs(info.vy) / sp > 0.6 ? 'diag' : 'slide'; slope = info.vy < 0 ? 1 : -1; }
      else if (info.bounces > 0) { kind = Rnd.chance(0.4) ? 'drop' : 'bounce'; n = Util.clamp(info.bounces + 1, 2, 3); }
      else kind = 'fly';
    } else kind = Rnd.chance(0.6) ? 'slide' : 'diag';
    this.strike = { shot, mx: 0, my: 0, t: 0, p: 0, dir, kind, first, slope, n, x0: Rnd.r(0.3, 0.7), lim: this.setPiece ? CFG.STRIKE_TIME_PARADA : CFG.STRIKE_TIME };
  }

  /* ----- Fase 2: ponto de contato ----- */
  setStrikePoint(nx, ny) {
    const s = this.strike; if (!s) return;
    const len = Math.hypot(nx, ny), k = len > 1 ? 1 / len : 1;
    s.mx = nx * k; s.my = ny * k;
  }
  /** Bola parada que saiu do pé (mesmo sem querer): o batedor não pode tocar de novo antes de um adversário/trave. */
  markRestart(p) { this.restartKick = !!this.setPiece || this.corner; this.kicker = p; this.penaltyHold = false; }
  missStrike() {
    const s = this.strike; if (!s) return;
    const b = this.ball, p = this.player;
    this.markRestart(p);                                       // não acertou o ponto de contato: a bola sai mal e o toque seguinte é toque duplo
    b.state = 'free'; b.vx = s.shot.ux * 70 + p.vx * 0.5; b.vy = s.shot.uy * 70 + p.vy * 0.5; b.vz = 0; b.spin = 0; Som.chute(0.3);
    this.cooldown = 0.7; this.path = []; this.strike = null; this.pass = null;
    this.toast = { text: 'CHANCE PERDIDA!', t: 1.4, color: '#fca5a5' };
  }
  confirmStrike() {
    const s = this.strike; if (!s) return;
    const kick = this.buildKick(s.shot, s.mx, s.my);
    const b = this.ball, p = this.player;
    const rec = this.findReceiver(this.predict(kick));
    this.restartKick = !!this.setPiece || this.corner;          // bola parada: ninguém da equipe pode tocar de novo antes de goleiro/zagueiro
    this.penaltyHold = false;
    this.pass = rec ? { passer: p, receiver: rec.a, ip: rec.ip, offside: this.isOffside(rec.a, b.y), age: 0 } : null;
    b.state = 'free'; b.vx = kick.vx; b.vy = kick.vy; b.vz = kick.vz; b.spin = kick.spin;
    this.aerial = !!this.corner && kick.vz > 0; this.aerialUp = false; this.corner = false; this.kicker = p; this.shooter = p;   // cruzamento do escanteio: a cabeçada é decidida no ar
    this.cooldown = CFG.PICKUP_COOLDOWN; this.postHit = false;
    this.path = [{ x: b.x, y: b.y }];
    p.facing = Math.atan2(s.shot.uy, s.shot.ux);
    Visual.chute(p, s.mx);                                   // ETAPA 4B: dispara a animação do chute (só visual)
    Som.chute(Math.hypot(kick.vx, kick.vy, kick.vz) / 950);   // som do chute/passe, mais forte quanto mais força
    p.target = null; p.vx *= 0.4; p.vy *= 0.4;
    this.strike = null;
    if (this.penalty && s.shot.uy > 0) { this.finish('PÊNALTI PERDIDO!', '#fca5a5', 'No pênalti a bola não pode ir para trás', 2.0); return; }   // chute para trás (mesmo que pouco)
    if (!this.pass) this.keeper.onShot(this);
  }

  /**
   * PÊNALTI (antes do chute): além do batedor e do goleiro, ninguém entra na área nem no arco (9,15 m da marca).
   * Empurra para fora da área (y) e do círculo da marca; vale para os dois times.
   */
  keepOutOfBox() {
    const W = CFG.FIELD.w, cx = W / 2, R = CFG.PLAYER_R, yMin = CFG.BOX.h + R + 2, rArc = CFG.ARC_R + R;
    const out = o => {
      if (o.y < yMin) {
        o.y = yMin;
        if (o.vy < 0) o.vy = 0;
      }
      const dx = o.x - cx, dy = o.y - CFG.SPOT_Y, d = Math.hypot(dx, dy);
      if (d < rArc) { const k = rArc / (d || 1); o.x = Util.clamp(cx + dx * k, R, W - R); o.y = Math.max(yMin, CFG.SPOT_Y + dy * k); }
    };
    for (const d of this.defenders) out(d);
    for (const a of this.attackers) if (a !== this.player) out(a);
  }

  /* ----- Companheiros: linha de impedimento, espaço livre e passe ----- */
  offsideLineY() {
    let m1 = this.keeper.y, m2 = Infinity;
    for (const d of this.defenders) {
      if (d.y < m1) { m2 = m1; m1 = d.y; } else if (d.y < m2) m2 = d.y;
    }
    return m2;
  }
  isOffside(a, ballY) {
    if (this.noOffside) return false;                            // escanteio/pênalti: sem impedimento até o primeiro toque
    return a.y < CFG.FIELD.midY && a.y < Math.min(this.offsideLineY(), ballY) - 1;
  }
  assignSides() {
    const ai = this.attackers.filter(a => a !== this.player && !(this.pass && a === this.pass.receiver));
    if (ai.length >= 2) { ai.sort((u, v) => u.x - v.x); ai[0].side = -1; ai[ai.length - 1].side = 1; }
    else if (ai.length === 1) ai[0].side = ai[0].x >= this.ball.x ? 1 : -1;
  }
  decideRun(a, t) {
    const C = AI.MATE, b = this.ball, W = CFG.FIELD.w, R = CFG.PLAYER_R, at = this.scn && this.scn.attract;
    const E = Tactics.estilo(), P = Tactics.post();                // SISTEMA TÁTICO: estilo da formação e postura do seu time
    this.assignSides();
    const prof = a.slot ? Tactics.PROFILE[Tactics.type(a.pos)] : null;
    const hm = a.slot ? Tactics.attackHome(a.slot, b, this.offsideLineY()) : null;   // posição na formação (acompanha a bola)
    if (this.setPiece) {          // BOLA PARADA: atacantes quase parados, sempre em posição legal (nada de ultrapassagem)
      a.margin = C.SET_MARGIN;
      a.goalX = Util.clamp(a.sx + Rnd.r(-C.SET_DX, C.SET_DX), 3 * M, W - 3 * M);
      a.goalY = Math.max(a.sy + Rnd.r(-C.SET_DY, C.SET_DY), a.pl + a.margin);
      a.decideT = Rnd.r(C.SET_WAIT_MIN, C.SET_WAIT_MAX);
      return;
    }
    a.margin = Util.lerp(C.MARGIN_LOW, C.MARGIN_HIGH, Util.smooth(C.MARGIN_FROM, C.MARGIN_TO, t)) +
               (Math.random() * 2 - 1) * Util.lerp(C.NOISE_LOW, C.NOISE_HIGH, t);
    if (a.safeT > 0) a.margin = Math.max(a.margin, C.OFF_MARGIN);   // em alerta: não volta a se posicionar impedido
    const limY = a.pl + a.margin;
    const s = Util.smooth(C.MARGIN_FROM, C.MARGIN_TO, t);
    if (s > 0.5 && a.cool <= 0 && !this.attackers.some(o => o !== a && o.runT > 0) && (b.state === 'carried' || this.pass) && b.y - a.pl < C.RUN_BALL_MAX &&
        Math.abs(a.y - limY) < C.RUN_NEAR && (!a.slot || Tactics.corre(Tactics.type(a.pos))) && Math.random() < C.RUN_CHANCE * P.run * s) {
      const depth = Util.lerp(C.RUN_DEPTH_MIN, C.RUN_DEPTH_MAX, Math.random());
      a.runT = Util.lerp(C.RUN_TIME_MIN, C.RUN_TIME_MAX, Math.random());
      a.margin = -depth;
      a.goalY = Math.max(3 * M, a.pl - depth);
      a.goalX = Util.clamp(a.x + (CFG.FIELD.w / 2 - a.x) * 0.4, 3 * M, CFG.FIELD.w - 3 * M);
      a.decideT = a.runT;
      return;
    }
    const n = Math.round(Util.lerp(C.CAND_MIN, C.CAND_MAX, t));
    const span = C.RANGE_AHEAD + C.RANGE_BEHIND;
    /** Nota de um espaço (cx, cy): livre de zagueiros, linha de passe limpa, distância de apoio, atração da área... */
    const score = (cx, cy) => {
      let open = Infinity, lane = Infinity;
      for (const d of this.defenders) {
        open = Math.min(open, Math.hypot(cx - d.x, cy - d.y));
        lane = Math.min(lane, Util.segDist(d.x, d.y, b.x, b.y, cx, cy));
      }
      let s = C.W_FORWARD * ((b.y + C.RANGE_BEHIND - cy) / span)
            + C.W_OPEN * Math.min(open, C.OPEN_CAP) / C.OPEN_CAP
            + C.W_LANE * Math.min(lane, C.LANE_CAP) / C.LANE_CAP
            + C.W_SIDE * Util.clamp((cx - b.x) * a.side / (6 * M), -1, 1);
      s += C.W_SUPPORT * (1 - Util.clamp(Math.abs(Math.hypot(cx - b.x, cy - b.y) - C.SUPPORT_DIST) / C.SUPPORT_DIST, 0, 1));
      if (at) s += C.W_ATTRACT * (1 - Math.min(1, Math.hypot(cx - at.x, cy - at.y) / (2.2 * at.r)));
      if (hm) {                                          // ETAPA 5: zona da posição + tendências do papel
        const ell = Math.hypot((cx - hm.x) / (prof.rx * M), (cy - hm.y) / ((cy < hm.y ? prof.up : prof.dn) * M));
        s -= C.W_ZONE * (at ? 0.5 : 1) * Math.max(0, ell - 1);
        if (prof.wide) s += C.W_WIDE * prof.wide * (E.wide || 1) * (1 - Util.clamp(Math.abs(cx - (hm.x < W / 2 ? 5.5 * M : W - 5.5 * M)) / (7 * M), 0, 1));
        if (prof.box) s += C.W_BOX * prof.box * (1 - Util.clamp(Math.hypot(cx - W / 2, cy - 11 * M) / (14 * M), 0, 1));
      }
      for (const o of this.attackers) {
        if (o === a) continue;
        const od = Math.hypot(cx - o.goalX, cy - o.goalY);
        if (o === this.player) { if (Math.hypot(cx - b.x, cy - b.y) < 4 * M) s -= 1.2; }
        else if (od < 5 * M) s -= 1.5 * (5 * M - od) / (5 * M);
      }
      if (Math.abs(cx - W / 2) > 20 * M) s -= 0.8;
      s -= 0.4 * Math.hypot(cx - a.x, cy - a.y) / (20 * M);
      return s;
    };
    let best = null, bs = -1e9;
    for (let i = 0; i < n; i++) {
      let cx, cy;
      if (at && Math.random() < C.ATTRACT_P) {          // espaço sorteado ao redor da zona de ataque (a área)
        cx = Util.clamp(at.x + (Math.random() * 2 - 1) * at.r, 3 * M, W - 3 * M);
        cy = at.y + (Math.random() * 2 - 1) * at.r;
      } else if (hm && Math.random() < C.HOME_P) {      // espaço sorteado dentro da zona da posição
        cx = Util.clamp(hm.x + (Math.random() * 2 - 1) * prof.rx * M, 3 * M, W - 3 * M);
        cy = hm.y + (Math.random() * (prof.dn + prof.up) - prof.up) * M;
      } else {
        cx = Util.clamp(b.x + a.side * (Math.random() * 1.15 - 0.15) * C.RANGE_SIDE, 3 * M, W - 3 * M);
        cy = b.y + C.RANGE_BEHIND - Math.random() * span;
      }
      cy = Util.clamp(Math.max(cy, limY), 3 * M, CFG.FIELD.bottom - R);
      const sc = score(cx, cy);
      if (sc > bs) { bs = sc; best = { x: cx, y: cy }; }
    }
    // Paciência: segura o espaço atual (e aparece para o passe) a menos que o novo seja claramente melhor
    const cur = score(a.goalX, Math.max(a.goalY, limY));
    if (best && bs > cur + C.STICK) { a.goalX = best.x; a.goalY = best.y; }
    a.decideT = Util.lerp(C.DECIDE_SLOW, C.DECIDE_FAST, t) * (0.8 + Math.random() * 0.4);
  }
  updateTeammate(a, h) {
    const C = AI.MATE, t = Util.lvl(this.attr.pos), b = this.ball;
    a.speedMul = this.setPiece ? C.SET_SPEED_MUL : C.SPEED_MUL;   // bola parada: caminham, não correm
    if (this.locked) { a.target = null; a.update(h, this.attr); return; }
    const safe = Math.min(this.offsideLineY(), b.y);
    a.pl += (safe - a.pl) * (1 - Math.exp(-Util.lerp(C.READ_SLOW, C.READ_FAST, t) * h));
    if (a.cool > 0) a.cool -= h;
    if (a.safeT > 0) a.safeT -= h;
    // NOÇÃO DE IMPEDIMENTO: parado na posição impedida (fora de uma ultrapassagem), percebe depois de um tempo e volta
    if (a.runT <= 0 && this.isOffside(a, b.y)) {
      a.offT += h;
      if (a.offT > Util.lerp(C.OFF_REACT_SLOW, C.OFF_REACT_FAST, t)) {
        a.margin = Math.max(a.margin, C.OFF_MARGIN); a.goalY = Math.max(a.goalY, a.pl + a.margin + 0.5 * M);
        a.offT = 0; a.safeT = C.OFF_SAFE_T; a.decideT = Math.max(a.decideT, 0.5);
      }
    } else a.offT = Math.max(0, a.offT - h);
    if (a.runT > 0) {
      a.runT -= h;
      if (a.runT <= 0) { a.cool = Util.lerp(C.RUN_COOL_MIN, C.RUN_COOL_MAX, Math.random()); a.decideT = 0; }
    }
    a.decideT -= h;
    if (a.decideT <= 0) this.decideRun(a, t);
    a.tgt.x = a.goalX; a.tgt.y = Math.max(a.goalY, a.pl + a.margin);
    a.target = a.tgt;
    a.update(h, this.attr);
  }
  updateAttackers(h) {
    const p = this.player, pass = this.pass, b = this.ball;
    let chaser = null;
    if (!pass && !this.locked && b.state === 'free' && this.cooldown <= 0) {
      let bd = Infinity;
      for (const a of this.attackers) {
        if (a === p) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < bd) { bd = d; chaser = a; }
      }
    }
    for (const a of this.attackers) {
      if (a === chaser) { a.speedMul = 1; a.target = { x: b.x, y: b.y }; a.update(h, this.attr); }
      else if (a === p) { a.speedMul = 1; a.update(h, this.attr); }
      else if (pass && a === pass.receiver) { a.speedMul = 1; if (this.locked) a.target = null; a.update(h, this.attr); }
      else this.updateTeammate(a, h);
    }
  }
  findReceiver(pred) {
    const PS = AI.PASS, pts = pred.pts, hs = 6 * CFG.FIXED_DT, b = this.ball;
    if (pts.length < 2) return null;
    const end = pts[pts.length - 1], gl = (CFG.FIELD.w - CFG.GOAL.w) / 2, gr = gl + CFG.GOAL.w;
    const toGoal = end.y < 0 && end.x > gl - 6 && end.x < gr + 6;
    const lim = toGoal ? PS.LANE_GOAL : PS.LANE_ACCEPT;
    let best = null;
    for (const a of this.attackers) {
      if (a === this.player) continue;
      const spd = a.maxSpeed(this.attr) * 0.95 / a.speedMul;
      const lx = a.x + a.vx * PS.LEAD_T, ly = a.y + a.vy * PS.LEAD_T;
      let dMin = Infinity, closest = null, reach = null;
      for (let i = 1; i < pts.length; i++) {
        const q = pts[i], d = Util.segDist(lx, ly, pts[i - 1].x, pts[i - 1].y, q.x, q.y);
        if (d < dMin) { dMin = d; closest = q; }
        if (!reach && Math.hypot(q.x - b.x, q.y - b.y) > 20 && Math.hypot(q.x - a.x, q.y - a.y) <= spd * i * hs + 10) reach = q;
      }
      if (!toGoal && pts.length > 2) {
        const pe = pts[pts.length - 2], el = Math.hypot(end.x - pe.x, end.y - pe.y) || 1;
        const d = Util.segDist(lx, ly, end.x, end.y, end.x + (end.x - pe.x) / el * PS.EXTEND, end.y + (end.y - pe.y) / el * PS.EXTEND);
        if (d < dMin) { dMin = d; closest = end; }
      }
      if (dMin > lim) continue;
      if (!best || dMin < best.dMin) best = { a, dMin, ip: reach || closest };
    }
    return best;
  }
  updatePass(h) {
    const pass = this.pass; if (!pass || this.locked) return;
    const b = this.ball, r = pass.receiver;
    pass.age += h;
    const tl = Util.clamp(Math.hypot(b.x - r.x, b.y - r.y) / Math.max(r.maxSpeed(this.attr), 1), 0, 1.2);
    r.target = { x: b.x + b.vx * tl * 0.6, y: b.y + b.vy * tl * 0.6 };
    if (pass.age > AI.PASS.TIMEOUT) { this.pass = null; r.decideT = 0.1; }
  }
  receive(a) {
    const b = this.ball, pass = this.pass;
    if (this.restartKick && a === this.kicker) {   // TOQUE DUPLO: só o batedor; companheiro pegando a bola é permitido
      this.restartKick = false; b.vx = b.vy = b.vz = b.spin = 0; b.z = 0;
      this.finish('TOQUE DUPLO!', '#fbbf24', 'O batedor tocou na bola duas vezes', 2.0);
      return;
    }
    this.restartKick = false;                                      // outro companheiro dominou: a bola parada já foi "servida"
    this.noOffside = false; this.aerial = false;                  // primeiro toque: impedimento volta a valer
    this.recvInfo = { vx: b.vx, vy: b.vy, maxZ: this.flightMaxZ || 0, bounces: b.bounces || 0 };   // direção, altura e quiques do passe
    if (pass && pass.offside && a === pass.receiver) {
      this.offsideP = a; b.vx = b.vy = b.vz = b.spin = 0; b.z = 0;
      this.finish('IMPEDIMENTO!', '#fbbf24', 'Receptor adiantado na hora do passe', 2.0); Som.apito('curto');
      return;
    }
    if (pass && a === pass.receiver) {
      this.toast = { text: 'DOMINOU!', t: 0.8, color: '#86efac' };
      this.decide = { t: CFG.DECIDE_TIME };
      this.timeScale = 0; this.acc = 0;
    }
    b.state = 'carried'; b.vz = 0; b.z = 0; this.sinceRecv = 0;   // acabou de dominar: chute agora é "de primeira"
    this.setActive(a);
    this.pass = null; this.path = [];
  }

  /* ----- Defesa: duelos, zagueiros e goleiro ----- */
  duel(markLevel, dribLevel, bonus = 0) {
    const p = Util.clamp(0.5 + (markLevel - dribLevel) * AI.DUEL_K + bonus, 0.08, 0.92);
    return Math.random() < p;
  }

  /** ETAPA 4: atribui cada cobertura a um atacante distinto (custo total mínimo). Zagueiros sobrando ficam em zona (markRef=null). */
  assignMarks(covers, marks, cost) {
    const n = covers.length, m = marks.length;
    for (const d of covers) d.markRef = null;
    if (!n || !m) return;
    if (n > 4 || m > 4) {                                   // muitos jogadores: atribuição gulosa (a busca exata ficaria cara a 120 Hz)
      const pairs = [];
      covers.forEach((d, i) => marks.forEach((a, j) => pairs.push([cost(d, a), i, j])));
      pairs.sort((u, v) => u[0] - v[0]);
      const ud = new Set(), ua = new Set();
      for (const [, i, j] of pairs) { if (ud.has(i) || ua.has(j)) continue; ud.add(i); ua.add(j); covers[i].markRef = marks[j]; }
      return;
    }
    let best = Infinity, bestMap = null;
    const used = new Array(m).fill(false), cur = new Array(n).fill(-1);
    const rec = (i, acc, nulls) => {
      if (i === n) { if (acc < best) { best = acc; bestMap = cur.slice(); } return; }
      for (let j = 0; j < m; j++) if (!used[j]) { used[j] = true; cur[i] = j; rec(i + 1, acc + cost(covers[i], marks[j]), nulls); used[j] = false; }
      if (nulls > 0) { cur[i] = -1; rec(i + 1, acc, nulls - 1); }
    };
    rec(0, 0, Math.max(0, n - m));
    covers.forEach((d, i) => { d.markRef = bestMap[i] >= 0 ? marks[bestMap[i]] : null; });
  }

  /**
   * IA da zaga (papéis dinâmicos; agora com nº variável de zagueiros).
   *  - \"CÃO DE GUARDA\": o mais próximo do portador (ou do receptor) pressiona e parte para o bote.
   *  - \"COBERTURA\": marca os atacantes sem bola na linha de passe; sobrando zagueiro, ele faz ZONA (linha de espera).
   *  - BARREIRA (bola parada): fica fixa até a bola sair; ninguém pressiona o batedor.
   */
  updateDefense(h) {
    this.recompor(h);                                       // pode trazer um adversário pela parte de baixo da tela
    const D = AI.DEF, t = Util.lvl(this.attr.mark), p = this.player, b = this.ball, todos = this.defenders, ds = todos.filter(d => !d.recomp);
    const cx = CFG.FIELD.w / 2, R = CFG.PLAYER_R, pass = this.pass, inSet = !!this.setPiece;
    const pressAtt = pass ? pass.receiver : p;
    const F = b.state === 'carried' ? p : b;
    const PT = pass ? pass.receiver : F;

    // ETAPA 5: a posição de origem de cada zagueiro vem da formação e acompanha a bola (linha sobe/desce, bloco desliza)
    if (!inSet && this.tac) for (const d of ds) if (d.slot && !d.fixed) { const hm = Tactics.defendHome(d.slot, this.tac, b); d.hx = hm.x; d.hy = hm.y; }

    this.pressLock = Math.max(0, (this.pressLock || 0) - h);
    // 1) Marcador: o mais próximo de PT (bola parada: ninguém pressiona)
    let presser = null;
    if (!inSet) {
      const dPT = d => Math.hypot(d.x - PT.x, d.y - PT.y);
      let near = 0;
      for (let i = 1; i < ds.length; i++) if (dPT(ds[i]) < dPT(ds[near])) near = i;
      if (this.pressAtt !== pressAtt) { this.pressIdx = near; this.pressAtt = pressAtt; this.pressLock = 0.6; }
      else if (this.pressLock <= 0 && near !== this.pressIdx && dPT(ds[near]) + D.SWITCH_GAP < dPT(ds[this.pressIdx])) { this.pressIdx = near; this.pressLock = D.SWITCH_LOCK; }   // trava de tempo: evita o vai e vem entre dois zagueiros
      presser = ds[this.pressIdx];
    }

    // Atacantes LIVRES e perigosos (sem zagueiro por perto, ao lado/à frente da bola): prioridade de marcação
    const freeDanger = new Set();
    for (const a of this.attackers) {
      if (a === pressAtt || a.y > b.y + 3 * M) continue;
      let nd = Infinity; for (const d of ds) nd = Math.min(nd, Math.hypot(d.x - a.x, d.y - a.y));
      if (nd > D.FREE_DIST) freeDanger.add(a);
    }
    // 2) Coberturas (menor custo total; barreira não marca)
    const covers = ds.filter(d => d !== presser && !(inSet && d.wall));
    const marks = this.attackers.filter(a => a !== pressAtt);
    this.assignMarks(covers, marks, (d, a) => Math.hypot(d.x - a.x, d.y - a.y) + 0.6 * Math.abs(d.hx - a.x) - (d.markRef === a ? D.MARK_STICK : 0) - (freeDanger.has(a) ? D.FREE_BONUS : 0));   // prefere marcar quem está na sua zona
    if (presser) presser.markRef = null;
    if (inSet) for (const d of ds) if (d.wall) d.markRef = null;

    // Atacante mais perigoso = o mais próximo da linha de fundo (menor y). O zagueiro que SOBRA (sem atacante para
    // marcar) vira LÍBERO: fica no lado do gol dele, cobrindo a diagonal, para ninguém sair livre pelas costas da marcação.
    let threat = this.attackers[0];
    for (const a of this.attackers) if (a.y < threat.y) threat = a;
    // 3) Percepção com atraso
    const kk = this.snapDef ? 1 : 1 - Math.exp(-Util.lerp(D.REACT_MIN, D.REACT_MAX, t) * h);
    this.snapDef = false;   // (só no 1º quadro: sem isso a zaga \"enxerga\" todos os atacantes na posição do portador)
    for (const d of ds) {
      const T = d.markRef || PT;
      d.px += (PT.x - d.px) * kk; d.py += (PT.y - d.py) * kk;
      d.bx += (b.x - d.bx) * kk;  d.by += (b.y - d.by) * kk;
      d.mx += (T.x - d.mx) * kk;  d.my += (T.y - d.my) * kk;
      d.zx += (threat.x - d.zx) * kk; d.zy += (threat.y - d.zy) * kk;   // percepção do atacante mais perigoso (libero)
      if (d.tackleCd > 0) d.tackleCd -= h;
      if (d.clearCd > 0) d.clearCd -= h;
    }

    const P = presser ? { x: presser.px, y: presser.py } : { x: PT.x, y: PT.y };
    // Linha de espera (bola longe): se o portador FICA PARADO (sem arrastar para chutar) por HOLD_IDLE s, a defesa para de esperar e
    // sai para pressionar/marcar normalmente (com a disciplina de sempre), para o lance nunca ficar congelado
    const idleBall = b.state === 'carried' && !this.locked && !this.aim && !this.strike && !this.decide && Math.hypot(p.vx, p.vy) < D.STALL_SPEED;
    this.holdIdle = idleBall ? (this.holdIdle || 0) + h : 0;
    const hold = P.y > this.holdY && this.holdIdle < D.HOLD_IDLE;
    const shift = this.scn && this.scn.shift != null ? this.scn.shift : 0.35;
    const leash = this.scn && this.scn.leash != null ? this.scn.leash : 1.6;   // multiplicador da disciplina (menor = defesa mais presa)   // quanto o bloco desliza para o lado da bola
    // Dos zagueiros sem atacante para marcar, só UM é líbero (o mais fundo); os demais compõem o bloco de zona
    let libero = null;
    for (const d of ds) if (d !== presser && !d.markRef && !(inSet && d.wall) && (!libero || d.y < libero.y)) libero = d;                         // bola longe (limite definido pelo cenário): só mantém a linha
    if (libero && ds.some(d => d.markRef === threat)) libero = null;   // perigo já marcado: o que sobra ajuda no lado da bola em vez de ficar atrás
    let ux = cx - P.x, uy = 0 - P.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const gap = Util.lerp(D.GAP_MIN, D.GAP_MAX, t);
    const laneF = Util.lerp(D.LANE_LOOSE, D.LANE_TIGHT, t), goalSide = Util.lerp(0, D.GOAL_SIDE, t);

    const stalling = presser && b.state === 'carried' && !hold && !this.locked && Math.hypot(p.vx, p.vy) < D.STALL_SPEED &&
                     Math.hypot(presser.x - p.x, presser.y - p.y) < gap + 3 * CFG.M;
    if (stalling) this.stallTime += h * (this.aim ? D.AIM_STALL_MUL : 1);
    else this.stallTime = Math.max(0, this.stallTime - 2 * h);
    const commit = this.stallTime >= Util.lerp(D.PATIENCE_MAX, D.PATIENCE_MIN, t);

    for (const d of ds) {
      d.role = d === presser ? 'press' : 'cover';
      let tx, ty, mul = 1, free = false;                   // free = bote/bola solta: ignora a disciplina
      if (inSet && d.wall) { tx = d.hx; ty = d.hy; }
      else if (hold && !(d.role !== 'press' && d.markRef && freeDanger.has(d.markRef))) {   // bola longe: só mantém a linha (exceto quem vigia um atacante livre)
        tx = d.hx + (P.x - cx) * shift; ty = d.hy;
      } else if (d.role === 'press') {
        tx = P.x + ux * gap; ty = P.y + uy * gap;
        if (d.tackleCd <= 0 && (commit || Math.hypot(d.x - F.x, d.y - F.y) < D.LUNGE)) { tx = F.x; ty = F.y; mul = 1.15; free = true; }
        else if (b.state === 'free' && !this.locked && Math.hypot(b.vx, b.vy) < 150) { tx = b.x; ty = b.y; mul = 1.1; free = true; }
      } else if (d.markRef && inSet) {                       // bola parada: marca colado, do lado do gol (não sobe para a bola)
        tx = d.mx + (cx - d.mx) * 0.12; ty = d.my - 1.8 * M;
      } else if (d.markRef) {
        // Marcação à distância (corta a linha de passe) só longe do gol; perto do gol, ou se o atacante está LIVRE, marca colado
        const dk = Math.max(Util.clamp((26 * M - Math.hypot(d.mx - cx, d.my)) / (10 * M), 0, 1), freeDanger.has(d.markRef) ? 1 : 0);
        const lf = Util.lerp(laneF, 0.1, dk);
        tx = d.mx + (d.bx - d.mx) * lf;
        ty = d.my + (d.by - d.my) * lf - goalSide - 1.0 * M * dk;
      } else if (d !== libero) {                            // BLOCO DE ZONA: mantém a linha, desliza com a bola e dobra a marcação se o portador chega perto
        if (!inSet && b.state === 'carried' && d.tackleCd <= 0 && Math.hypot(d.x - F.x, d.y - F.y) < D.ZONE_STEP) { tx = F.x; ty = F.y; mul = 1.1; free = true; }
        else {                                              // desliza para o lado da bola e sobe junto com ela (apoio rápido ao marcador)
          tx = d.hx + (P.x - cx) * shift + (inSet ? 0 : (P.x - d.hx) * 0.3); ty = d.hy + (inSet ? 0 : Math.max(0, (P.y - d.hy) * 0.35));   // bola parada: bloco fica no lugar
        }
      } else {                                              // LÍBERO: atrás do atacante mais avançado, no caminho do gol (nunca à frente da marcação)
        const gs = Util.lerp(2.5 * M, 4 * M, t);            // distância do lado do gol (Marcação alta = mais seguro)
        tx = d.zx + (cx - d.zx) * 0.3;
        ty = Math.max(4 * M, Math.min(d.hy, d.zy - gs));
      }
      const tA = d.markRef || (d === libero ? threat : null);
      if (!free && !(inSet && d.wall) && (!hold || d.markRef) && !(tA && freeDanger.has(tA))) {   // quem vai no homem livre ignora a coleira          // disciplina: limita o quanto sai da posição (y maior = sair para o meio-campo)
        const lk = leash * (d.role === 'press' ? 1 : 1), Ly = (d.role === 'press' ? D.LEASH_PRESS : D.LEASH_COVER) * lk,
              Lx = (d.role === 'press' ? D.LEASH_X_PRESS : D.LEASH_X_COVER) * lk;
        ty = Math.min(ty, d.hy + Ly); tx = Util.clamp(tx, d.hx - Lx, d.hx + Lx);
      }
      tx = Util.clamp(tx, R, CFG.FIELD.w - R); ty = Util.clamp(ty, R, CFG.FIELD.bottom - R);

      let dvx = 0, dvy = 0;
      if (!this.locked) {
        const dx = tx - d.x, dy = ty - d.y, dd = Math.hypot(dx, dy);
        if (dd > 3) {
          const spd = Util.lerp(D.SPEED_MIN, D.SPEED_MAX, t) * CFG.M * mul * (d.fv || 1) * (d.fg || 1) * Util.clamp(dd / 40, 0.15, 1);   // fv: zagueiro cansado/improvisado corre menos; fg: fôlego do lance
          dvx = dx / dd * spd; dvy = dy / dd * spd;
        }
      }
      const k = 1 - Math.exp(-8 * h);
      d.vx += (dvx - d.vx) * k; d.vy += (dvy - d.vy) * k;
      d.x += d.vx * h; d.y += d.vy * h;
      if (inSet) this.keepFromBall(d);                      // falta: nunca entra nos 9,15 m da bola
      d.facing = Math.atan2(F.y - d.y, F.x - d.x);
    }

    this.moverRecomp(h, F);                                 // quem voltou para recompor: persegue a bola, sem formação nem coleira

    // Tentativa de desarme (só com a bola na condução; qualquer zagueiro que chegar perto, inclusive quem voltou)
    if (b.state === 'carried' && !this.locked) {
      for (const d of todos) {
        if (d.tackleCd > 0 || Math.hypot(d.x - p.x, d.y - p.y) > D.TACKLE) continue;
        d.tackleCd = D.TACKLE_CD; this.stallTime = 0; this.tackler = d;
        const mv = Math.hypot(p.vx, p.vy), still = mv < D.STALL_SPEED;
        const slowBonus = 0.3 * (1 - Util.clamp(mv / (0.5 * p.maxSpeed(this.attr)), 0, 1));
        if (still || this.duel(this.attr.mark * (d.fm || 1) * FolegoLance.duelo(d), this.attr.dribble * (p.fd || 1) * FolegoLance.duelo(p), slowBonus)) {   // marcação de quem chegou x drible de quem conduz
          const a = Math.atan2(d.y - p.y, d.x - p.x);
          b.state = 'free'; b.vx = Math.cos(a) * 130; b.vy = Math.sin(a) * 130; b.z = b.vz = 0; b.spin = 0;
          this.cooldown = 1; this.path = [];
          p.vx *= 0.3; p.vy *= 0.3;
          this.finish('DESARMADO!', '#fb7185', 'O zagueiro tomou a bola', 1.7);
          break;
        } else {
          this.toast = { text: 'DRIBLE!', t: 0.9, color: '#86efac' };
        }
      }
    }

    // Goleiro sai nos pés do atacante que chega muito perto (duelo Reflexo x Drible)
    const k = this.keeper;
    if (b.state === 'carried' && !this.locked && k.stun <= 0 && Math.hypot(b.x - k.x, b.y - k.y) < 24) {
      if (Math.hypot(p.vx, p.vy) < D.STALL_SPEED || this.duel(this.attr.reflex * AI.KEEPER.NIVEL, this.attr.dribble * (p.fd || 1) * FolegoLance.duelo(p), 0.1)) {
        b.state = 'held'; b.vx = b.vy = 0;
        this.finish('DEFENDEU!', '#67e8f9', 'Goleiro saiu e encaixou', 1.8);
      } else {
        k.stun = 1.0;
        this.toast = { text: 'DRIBLE NO GOLEIRO!', t: 1.0, color: '#86efac' };
      }
    }
  }

  /**
   * RECOMPOSIÇÃO: com a bola rolando há DEPOIS s (ou RECUADO s com a bola recuada), um adversário que estava fora do lance
   * entra por BAIXO da tela (fora da vista) e corre para pressionar. Impede ficar trocando passes para trás para sempre.
   * Só na partida, só com a bola rolando (bola parada e treino não têm).
   */
  recompor(h) {
    const C = CFG.RECOMP, b = this.ball;
    if (this.mode !== 'match' || this.setPiece || this.locked || !this.firstTouched || b.state === 'held' || this.recompN >= 2) return;
    this.lanceT += h; this.recompT += h;
    if (b.y > C.LINHA) this.recuoT += h;
    const espera = this.recompN === 0 ? (this.recuoT >= C.RECUADO || this.lanceT >= C.DEPOIS) : this.recompT >= C.SEGUNDO;
    if (!espera) return;
    const R = this.renderer, baixo = R.cam.y + R.h / R.s / 2, F = b.state === 'carried' ? this.player : b;
    const x = Util.clamp(F.x + Rnd.r(-90, 90), 2 * CFG.PLAYER_R, CFG.FIELD.w - 2 * CFG.PLAYER_R), y = Math.max(baixo + 30, F.y + 120);
    // quem volta: um titular do adversário que ainda não está no lance (volante/meia de preferência)
    const L = this.lineups && this.lineups.op, usados = new Set(this.defenders.map(d => d.real && d.real.nome));
    const real = L ? L.tit.filter(q => q.slotPos !== 'GK' && !q.expulso && !usados.has(q.nome)).sort((a, z) => ({ DM: 0, CM: 1, ST: 2 }[a.slotPos] ?? 3) - ({ DM: 0, CM: 1, ST: 2 }[z.slotPos] ?? 3))[0] : null;
    const num = real ? real.num : [5, 8, 10][this.recompN];
    const d = new Defender({ num, x, y, pos: real ? real.slotPos : 'DM', slot: null, fixed: true, visual: real ? real.visual : undefined });
    d.recomp = true; d.real = real || null; d.vy = -60; d.facing = -Math.PI / 2;
    if (real) { d.fv = Tatica.relativo(real, L, 'velocidade'); d.fm = Tatica.relativo(real, L, 'marcacao'); d.kGas = FolegoLance.coef(real); }   // quem volta cansado chega mais devagar
    this.defenders.push(d); this.recompN++; this.recompT = 0;
  }
  /** Movimento de quem voltou: vai direto no portador (ou no receptor do passe / na bola solta), sem formação nem coleira. */
  moverRecomp(h, F) {
    const C = CFG.RECOMP, t = Util.lvl(this.attr.mark), vmax = Util.lerp(C.VEL_MIN, C.VEL_MAX, t) * CFG.M;
    for (const d of this.defenders) {
      if (!d.recomp) continue;
      const alvo = this.pass ? this.pass.receiver : F;
      let dvx = 0, dvy = 0;
      if (!this.locked) {
        const dx = alvo.x - d.x, dy = alvo.y - d.y, dd = Math.hypot(dx, dy);
        if (dd > 3) { const spd = vmax * (d.fv || 1) * (d.fg || 1) * Util.clamp(dd / 30, 0.2, 1); dvx = dx / dd * spd; dvy = dy / dd * spd; }
      }
      const k = 1 - Math.exp(-6 * h);
      d.vx += (dvx - d.vx) * k; d.vy += (dvy - d.vy) * k;
      d.x += d.vx * h; d.y += d.vy * h;
      d.x = Util.clamp(d.x, CFG.PLAYER_R, CFG.FIELD.w - CFG.PLAYER_R);
      if (d.tackleCd > 0) d.tackleCd -= h;
      if (d.clearCd > 0) d.clearCd -= h;
      d.facing = Math.atan2(alvo.y - d.y, alvo.x - d.x);
    }
  }

  separate(a, b, minD, both) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= minD || d < 0.001) return;
    const o = (minD - d) / d, f = both ? 0.5 : 1;
    b.x += dx * o * f; b.y += dy * o * f;
    if (both) { a.x -= dx * o * 0.5; a.y -= dy * o * 0.5; }
  }
  separateAll() {
    const R = CFG.PLAYER_R, ds = this.defenders, as = this.attackers;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) this.separate(ds[i], ds[j], 2.4 * R, true);
    for (const d of ds) for (const a of as) this.separate(d, a, 2 * R, true);
    for (let i = 0; i < as.length; i++) for (let j = i + 1; j < as.length; j++) this.separate(as[i], as[j], 2.2 * R, true);
  }

  sweepTarget(k) {
    const b = this.ball, K = AI.KEEPER, cx = CFG.FIELD.w / 2, R = CFG.PLAYER_R;
    if (this.locked || b.state !== 'free' || k.state !== 'idle') return null;
    if (b.y > CFG.BOX.h || Math.abs(b.x - cx) > CFG.BOX.w / 2) return null;
    const tx = Util.clamp(b.x + b.vx * 0.35, R, CFG.FIELD.w - R), ty = Util.clamp(b.y + b.vy * 0.35, R, CFG.BOX.h);
    const v = Util.lerp(K.TRACK_MIN, K.TRACK_MAX, Util.lvlGol(this.attr.reflex)) * CFG.M * 1.15;
    const kt = Math.hypot(tx - k.x, ty - k.y) / v;
    for (const a of this.attackers) {
      if (Math.hypot(tx - a.x, ty - a.y) / a.maxSpeed(this.attr) < kt * 1.1) return null;
    }
    return { x: tx, y: ty, v };
  }

  collideKeeper() {
    const k = this.keeper, b = this.ball, K = AI.KEEPER;
    if (this.locked || b.state !== 'free' || k.palmCd > 0) return;   // acabou de espalmar: não toca de novo na mesma bola
    const diving = k.state === 'dive';
    const reach = (diving ? K.REACH_DIVE : K.REACH) * (this.penalty ? 0.85 : 1) + CFG.BALL_R;   // pênalti: alcance um pouco menor
    const maxZ = diving ? CFG.GOAL_H * 1.1 : K.SAVE_Z;
    const d = Math.hypot(b.x - k.x, b.y - k.y);
    if (d > reach || b.z > maxZ) return;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp <= Util.lerp(K.CATCH_MIN, K.CATCH_MAX, Util.lvlGol(this.attr.reflex))) {
      b.state = 'held'; b.vx = b.vy = b.vz = b.spin = 0; b.z = 0;
      this.finish('DEFENDEU!', '#67e8f9', 'Goleiro encaixou', 1.8);
    } else {
      // ESPALMOU: prioriza mandar a bola para os LADOS (longe do centro da área), com um pouco de saída para a frente.
      // O lance NÃO acaba: a bola fica viva (rebote para atacante, zagueiro ou o próprio goleiro) até sair, ser agarrada ou virar gol.
      const side = Math.abs(b.x - k.x) > 3 ? Math.sign(b.x - k.x) : (b.x < CFG.FIELD.w / 2 ? -1 : 1);
      const ang = Math.atan2(0.2 + Math.random() * 0.45, side) + (Math.random() * 2 - 1) * 0.2;
      const out = sp * 0.42;
      b.vx = Math.cos(ang) * out; b.vy = Math.sin(ang) * out; b.vz = 70 + Math.random() * 60; b.spin = 0;
      b.x = k.x + Math.cos(ang) * (reach + 1); b.y = k.y + Math.sin(ang) * (reach + 1);
      k.palmCd = 0.35; this.pass = null; this.cooldown = Math.max(this.cooldown, 0.12);
      this.toast = { text: 'ESPALMOU!', t: 0.9, color: '#67e8f9' };
    }
  }

  /**
   * Corpo dos zagueiros (bola ao alcance e abaixo de BLOCK_Z; por cima passa).
   * O lance NÃO acaba mais no contato: o zagueiro DÁ UM CHUTE DE ALÍVIO em direção à lateral/linha de fundo mais
   * próxima (com desvio aleatório). A força do alívio cresce com a Marcação: alívio fraco pode sobrar para um
   * atacante (domínio normal em tryReceive); alívio forte sai do campo (\"PARA FORA!\") ou fica longe do alcance.
   * O lance só termina por gol, bola fora, defesa do goleiro, desarme na condução ou impedimento.
   */
  collideDefenders() {
    const b = this.ball, D = AI.DEF;
    if (this.locked || b.state !== 'free') return;
    for (const d of this.defenders) {
      if (d.clearCd > 0) continue;                                   // acabou de aliviar: não toca de novo na mesma bola
      const dx = b.x - d.x, dy = b.y - d.y, dist = Math.hypot(dx, dy), min = CFG.PLAYER_R + CFG.BALL_R;
      if (dist >= min || b.z > D.BLOCK_Z) continue;
      // Direção do alívio: para a lateral mais próxima da bola; perto da linha de fundo também afasta do gol (y positivo)
      const side = b.x < CFG.FIELD.w / 2 ? -1 : 1;
      const nearGoal = Util.clamp(1 - b.y / (14 * M), 0, 1);
      let ang = Math.atan2(0.25 + 0.9 * nearGoal, side) + (Math.random() * 2 - 1) * 0.4;
      const t = Util.lvl(this.attr.mark);
      const sp = Util.lerp(D.CLEAR_MIN, D.CLEAR_MAX, t) * (0.85 + Math.random() * 0.3);
      b.x = d.x + Math.cos(ang) * (min + 1); b.y = d.y + Math.sin(ang) * (min + 1);
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp; b.vz = 0; b.spin = 0;
      d.clearCd = 0.4; d.facing = ang;
      Visual.chute(d); Som.chute(0.6);                               // ETAPA 4B: animação do chute de alívio (só visual) + som
      this.pass = null; this.cooldown = Math.max(this.cooldown, 0.12);   // passe cortado; rebote livre para os atacantes
      this.toast = { text: 'ZAGUEIRO CORTOU!', t: 0.9, color: '#fca5a5' };
      return;
    }
  }

  /* ----- Simulação (passo fixo) ----- */
  step(h) {
    const b = this.ball; this.sinceRecv += h;
    if (b.state === 'carried') { this.flightMaxZ = 0; b.bounces = 0; } else if (b.state === 'free') this.flightMaxZ = Math.max(this.flightMaxZ || 0, b.z);   // como a bola veio: alta? quicou?
    if (this.setPiece && b.state !== 'carried') this.setPiece = null;   // bola saiu do pé: barreira e marcação liberadas
    this.updateAttackers(h);
    this.keeper.update(h, this);
    this.updateDefense(h);
    this.separateAll();
    if (!this.locked) this.folegoLance(h);
    if (this.penaltyHold) this.keepOutOfBox();
    const p = this.player;

    if (b.state === 'carried') {
      this.pass = null;
      const sp = Math.hypot(p.vx, p.vy);
      const dist = CFG.CARRY_DIST + Math.sin(p.phase * 2) * 2.5 * Util.clamp(sp / 150, 0, 1);
      const tx = p.x + Math.cos(p.facing) * dist, ty = p.y + Math.sin(p.facing) * dist;
      const k = 1 - Math.exp(-20 * h);
      b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
      if (p.foraCampo) { const R = CFG.BALL_R; b.x = Util.clamp(b.x, R, CFG.FIELD.w - R); b.y = Math.max(b.y, R); }   // cobrador ainda fora do campo: a bola fica dentro
      b.vx = p.vx; b.vy = p.vy; b.spin = 0; b.z = 0; b.vz = 0;
      b.rot += sp * h / CFG.BALL_R;
    } else if (b.state === 'held') {
      b.x = this.keeper.x; b.y = this.keeper.y + 6; b.z = 0; b.vx = b.vy = 0;
    } else {
      const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * h / 2.5)), hs = h / n;
      for (let i = 0; i < n; i++) {
        Physics.stepBall(b, hs); this.collideField(hs);
        this.headerContest();
        if (b.state !== 'free' || this.locked) break;
        this.tryReceive();
        if (b.state !== 'free' || this.locked) break;
        this.collideKeeper(); this.collideDefenders();
        if (this.restartKick && (this.keeper.palmCd > 0 || b.state !== 'free' || this.defenders.some(d => d.clearCd > 0))) this.restartKick = false;   // só goleiro/zagueiro tocando libera a bola (a trave NÃO libera: rebote da trave no batedor é toque duplo)
        if (b.state !== 'free') break;
      }
      b.rot += Math.hypot(b.vx, b.vy) * h / CFG.BALL_R;
      this.cooldown -= h;
      if (this.path.length < 600 && Math.hypot(b.vx, b.vy) > 8) this.path.push({ x: b.x, y: b.y });
      this.updatePass(h);
    }
  }

  /**
   * ESCANTEIO: disputa de cabeça AUTOMÁTICA. Enquanto a bola do cruzamento passa pela altura de cabeça (CFG.HEAD) ao alcance de
   * jogadores, sorteia quem chega nela: peso do atacante = Posicionamento, do zagueiro = Marcação (marcador colado ganha um
   * bônus), do goleiro = Reflexo; todos pesam menos quanto mais longe da bola. Atacante vencedor cabeceia para o gol (direção
   * e força pelos atributos e pela distância); zagueiro corta; goleiro agarra. Nada disso mexe na física da bola em si:
   * o resultado é só uma nova velocidade, e a trajetória segue o mesmo motor de sempre.
   */
  headerContest() {
    if (!this.aerial || this.locked) return;
    const b = this.ball, H = CFG.HEAD;
    if (b.z > 4) this.aerialUp = true;
    else if (this.aerialUp) { this.aerial = false; return; }      // a bola já caiu no chão sem ninguém alcançar
    if (b.z < H.Z_MIN || b.z > H.Z_MAX || b.vz >= 0) return;       // só na DESCIDA da bola, quando ela chega à altura da cabeça
    const cand = [], prox = d => 1 - 0.6 * (d / H.REACH);
    const pos = Util.lvl(this.attr.pos), mark = Util.lvl(this.attr.mark), refl = Util.lvlGol(this.attr.reflex);
    for (const a of this.attackers) {
      if (a === this.kicker) continue;                             // o batedor não cabeceia o próprio cruzamento
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= H.REACH) cand.push({ o: a, kind: 'att', w: (0.35 + 0.65 * pos) * prox(d) * (this.pass && this.pass.receiver === a ? 1.25 : 1) });
    }
    for (const d of this.defenders) {
      const dd = Math.hypot(d.x - b.x, d.y - b.y);
      if (dd <= H.REACH) cand.push({ o: d, kind: 'def', w: (0.35 + 0.75 * mark) * prox(dd) * (d.markRef ? 1.1 : 1) });
    }
    const k = this.keeper, dk = Math.hypot(k.x - b.x, k.y - b.y);
    if (dk <= H.REACH * 1.4 && b.z <= H.Z_MAX + 6 && k.palmCd <= 0) cand.push({ o: k, kind: 'gk', w: (0.3 + 0.7 * refl) * prox(dk / 1.4) });
    if (!cand.length) return;
    let r = Math.random() * cand.reduce((s, c) => s + c.w, 0), win = cand[cand.length - 1];
    for (const c of cand) { r -= c.w; if (r <= 0) { win = c; break; } }
    this.aerial = false; this.noOffside = false; this.restartKick = false; this.pass = null; this.cooldown = Math.max(this.cooldown, 0.3);
    const o = win.o, cx = CFG.FIELD.w / 2, G = CFG.GOAL;
    if (win.kind === 'gk') {
      b.state = 'held'; b.vx = b.vy = b.vz = b.spin = 0; b.z = 0;
      this.finish('DEFENDEU!', '#67e8f9', 'Goleiro saiu e pegou o cruzamento', 1.8);
    } else if (win.kind === 'att') {
      // cabeçada ao gol: ponto dentro do gol (longe do goleiro quando dá) + erro que cresce com a distância e cai com o Posicionamento
      const dist = Math.hypot(o.x - cx, o.y), sideAway = Math.sign(cx - this.keeper.x) || (Math.random() < 0.5 ? -1 : 1);
      const tx = cx + (Math.random() < 0.6 ? sideAway : -sideAway) * Rnd.r(0.15, 0.85) * (G.w / 2);
      const sigma = Util.lerp(0.30, 0.08, pos) * (0.7 + dist / (14 * M));
      const gauss = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
      const ang = Math.atan2(-Math.max(o.y, 8), tx - o.x) + gauss * sigma;
      const spd = Util.lerp(360, 560, Util.lvl(this.attr.force)) * Util.clamp(1.1 - dist / (40 * M), 0.65, 1);
      b.x = o.x; b.y = o.y; b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd; b.vz = Rnd.r(-90, 15); b.spin = 0;
      o.facing = ang; Visual.salto(o); this.shooter = o;
      this.path = [{ x: b.x, y: b.y }];
      this.toast = { text: 'CABECEIO!', t: 1.0, color: '#fde047' };
      this.keeper.onShot(this);
    } else {
      const side = o.x < cx ? -1 : 1, ang = Math.atan2(0.5 + Math.random() * 0.5, side) + (Math.random() * 2 - 1) * 0.3;
      const sp = Util.lerp(AI.DEF.CLEAR_MIN, AI.DEF.CLEAR_MAX, mark) * (0.85 + Math.random() * 0.3);
      b.x = o.x + Math.cos(ang) * 12; b.y = o.y + Math.sin(ang) * 12;
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp; b.vz = Rnd.r(60, 120); b.spin = 0;
      o.clearCd = 0.4; o.facing = ang; Visual.salto(o);
      this.toast = { text: 'ZAGUEIRO CORTOU DE CABEÇA!', t: 1.0, color: '#fca5a5' };
    }
  }

  tryReceive() {
    const b = this.ball;
    if (this.locked || b.state !== 'free' || b.z >= 14) return;
    const sp = Math.hypot(b.vx, b.vy), reach = CFG.PICKUP_DIST + 2;
    let who = null, wd = reach;
    if (this.pass) {
      const r = this.pass.receiver, d = Math.hypot(b.x - r.x, b.y - r.y);
      if (d < reach && (this.pass.offside || sp < CFG.PICKUP_SPEED * AI.PASS.RECV_SPEED)) { who = r; wd = d; }
    } else if (this.cooldown <= 0 && sp < CFG.PICKUP_SPEED) {
      for (const a of this.attackers) {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < wd) { wd = d; who = a; }
      }
    }
    if (!who) return;
    const touch = CFG.PLAYER_R + CFG.BALL_R;
    if (b.z <= AI.DEF.BLOCK_Z) {
      for (const d of this.defenders) {
        const dd = Math.hypot(b.x - d.x, b.y - d.y);
        if (dd < touch && dd < wd) return;
      }
    }
    this.receive(who);
  }

  collideField(h) {
    const b = this.ball, W = CFG.FIELD.w, R = CFG.BALL_R;
    const gl = (W - CFG.GOAL.w) / 2, gr = gl + CFG.GOAL.w, depth = CFG.GOAL.depth;
    for (const px of [gl, gr]) {
      const dx = b.x - px, dy = b.y, d = Math.hypot(dx, dy), min = R + 3;
      if (b.z < CFG.GOAL_H && d < min && d > 0.001) {
        if (!this.postHit) Som.trave();                    // bola na trave (uma vez por lance de contato)
        this.postHit = true;
        const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
        b.x = px + nx * min; b.y = ny * min;
        if (vn < 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; b.spin *= 0.4; }
      }
    }
    if (!this.locked && b.y < 0 && b.x > gl && b.x < gr) {
      if (b.z > CFG.GOAL_H && !(this.postHit && b.z <= CFG.GOAL_H * 1.6)) {
        this.out = true; this.pass = null;
        this.msg = { text: 'PARA FORA!', color: '#ffffff', sub: 'Por cima do travessão', age: 0 };
        this.resetTimer = 1.4;
      } else {
        this.scored = true; this.pass = null;
        this.msg = { text: 'GOL!', color: '#facc15', sub: '', age: 0 };
        this.resetTimer = 2.2;
        this.onGoal();                                   // ETAPA 4: soma no placar
      }
    }
    if (this.scored && b.y < 0) {
      if (b.x < gl + R) { b.x = gl + R; b.vx *= -0.3; }
      if (b.x > gr - R) { b.x = gr - R; b.vx *= -0.3; }
      if (b.y < -depth + R) { b.y = -depth + R; b.vy *= -0.15; }
      const damp = Math.exp(-4 * h); b.vx *= damp; b.vy *= damp; b.spin = 0;
    }
    if (!this.locked && (b.x < 0 || b.x > W || b.y < 0)) {
      this.out = true; this.pass = null;
      this.msg = { text: 'PARA FORA!', color: '#ffffff', sub: '', age: 0 };
      this.resetTimer = 1.4;
    }
    if (b.y > CFG.FIELD.bottom - R) { b.y = CFG.FIELD.bottom - R; b.vy *= -0.5; }
  }

  /* ----- Loop principal ----- */
  loop(t) {
    requestAnimationFrame(this.loop);
    const dt = Math.min((t - this.last) / 1000 || 0, 0.05);
    this.last = t;

    const bcv = this.view === 'broadcast';                          // ETAPA 7: na transmissão o motor do campo fica parado
    if (bcv && !this.menuOpen && this.started) this.tickBroadcast(dt);   // relógio minuto a minuto
    const paused = bcv || this.match.over || this.menuOpen;       // menu aberto = jogo pausado

    if (!paused) {
      this.input.tick();
      if (this.aim) { this.aim.t += dt; if (this.aim.t >= this.aim.lim) this.aimEscape(); }
      if (this.decide && !this.aim && !this.strike) { this.decide.t -= dt; if (this.decide.t <= 0) this.decide = null; }
      const frozen = this.decide && !this.aim && !this.strike;
      const target = this.strike ? CFG.STRIKE_SLOWMO : this.aim ? CFG.SLOWMO : frozen ? 0 : 1;
      this.timeScale = frozen ? 0 : this.timeScale + (target - this.timeScale) * (1 - Math.exp(-12 * dt));
      if (this.strike) {
        this.strike.t = Math.min(1, this.strike.t + dt / 0.3);
        this.strike.p += dt / this.strike.lim;
        if (this.strike.p >= 1) this.missStrike();
      }
      if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; }
      if (this.msg) this.msg.age += dt;
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }

      this.tickFirstTouch(dt);
      const waiting = this.mode === 'match' && !this.firstTouched && !this.locked;   // lance parado até o 1º toque (com tolerância de FIRST_TOUCH_TIME s)
      if (!waiting) this.acc += dt * this.timeScale; else this.acc = 0;
      let n = 0;
      while (this.acc >= CFG.FIXED_DT && n < 30) { this.step(CFG.FIXED_DT); this.acc -= CFG.FIXED_DT; n++; }
      if (n === 30) this.acc = 0;

      // Fim do lance (tempo real): registra e segue para o próximo, com a barra de transição
      if (this.resetTimer > 0) { this.resetTimer -= dt; if (this.resetTimer <= 0) this.afterPlay(false); }
    }

    if (!bcv) this.renderer.draw(this, t, dt);                    // campo só é desenhado nos lances jogáveis
    this.updateHud();

    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.$('fps').textContent = Math.round(this.fpsFrames / this.fpsAcc) + ' fps';
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
  }
}

/* --------------------------------- Entrada -------------------------------- */
class Input {
  constructor(canvas, game) {
    this.canvas = canvas; this.game = game;
    this.id = null; this.mode = null; this.last = null;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  /** Solta o ponteiro atual (novo lance carregado). */
  cancel() { this.id = null; this.mode = null; this.last = null; }
  world(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.game.renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  }
  screen(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  down(e) {
    if (this.id !== null) return;
    e.preventDefault();
    const g = this.game;
    if (g.menuOpen || g.trans || g.view !== 'play' || (g.match && g.match.over)) return;          // barra de transição / fim de jogo: sem controle
    if (g.strike) {
      this.id = e.pointerId; this.mode = 'strike';
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const sc = this.screen(e), G = g.renderer.strikeGeom(g.strike);   // sem cancelar: soltou o estilingue, assumiu o risco
      const nx = (sc.x - G.cx) / G.r, ny = (sc.y - G.cy) / G.r;
      if (Math.hypot(nx, ny) <= 1.1) { g.setStrikePoint(nx, ny); g.confirmStrike(); }
      return;
    }
    this.id = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const p = this.world(e);
    const grab = Math.max(CFG.GRAB, 44 / g.renderer.s);
    const sc = this.screen(e); this.last = sc;
    if (g.canGrab(p, grab)) { this.mode = 'aim'; g.startAim(sc.x, sc.y); }
    else { this.mode = 'run'; g.setRunTarget(p); }
  }
  move(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    if (this.mode === 'strike') return;
    const sc = this.screen(e); this.last = sc;
    if (this.mode === 'aim') this.game.updateAim(sc.x, sc.y);
    else if (this.mode === 'run') this.game.setRunTarget(this.world(e));
  }
  tick() {
    if (this.mode === 'run' && this.last) this.game.setRunTarget(this.game.renderer.toWorld(this.last.x, this.last.y));
  }
  up(e) {
    if (e.pointerId !== this.id) return;
    if (this.mode === 'aim') this.game.releaseAim();
    this.id = null; this.mode = null;
  }
}


export { Util, CFG, M, Tactics, Rnd, Scenarios, Game, Gen, FolegoLance };
