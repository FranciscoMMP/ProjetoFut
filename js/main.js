import { instalarTransmissao } from './transmissao.js';
import { Game, Tactics, Scenarios } from './motor-campo.js';
import { Central, Escolha, Liga, continuarCampeonato, novoCampeonato } from './campeonato.js';
import { Som } from './audio.js';

/* =============================================================================
   NEW STAR TREINEIROS — ponto de entrada (ES Modules)
     motor-campo.js     : configuração, física, jogadores, táticas, gerador de lances, classe Game (campo) e Input
     render-sprites.js  : cores, aparência, sprites pixel art, animação e Renderer (campo, câmera, HUD do canvas)
     transmissao.js     : narração, relógio, minuto a minuto, transição transmissão <-> campo, placar e fim de jogo
     campeonato.js      : dados do Brasileirão, escalações, simulação dos bots, tabela/calendário e telas Central/Escolha
     main.js (este)     : instala a transmissão no Game, cria o jogo e liga os botões, sliders e menu

   Os módulos se importam entre si (ciclos), o que é seguro porque nenhum usa o outro no topo do arquivo, só dentro de
   funções/métodos chamados depois que tudo carregou. Ao editar, mantenha essa regra (ou mova o valor para o módulo que o usa).
   ============================================================================= */

instalarTransmissao(Game);                   // métodos da transmissão entram no protótipo antes de criar o jogo

/* ------------------------------- Inicialização ----------------------------- */
const game = new Game(document.getElementById('game'), document.getElementById('stage'));

// Sliders do menu -> atributos em tempo real (+ resumo Ataque x Defesa)
const SLIDERS = ['force', 'curve', 'speed', 'dribble', 'pos', 'reflex', 'mark', 'oatk', 'mdef'];
function updateBalance() {
  const a = game.attr;
  const atk = Math.round(a.force * 0.2 + a.curve * 0.2 + a.speed * 0.2 + a.dribble * 0.25 + a.pos * 0.15);
  const def = Math.round(a.mark * 0.6 + a.reflex * 0.4);
  document.getElementById('bal').innerHTML =
    `Seu ATAQUE <b>${atk}</b> × DEFESA adv. <b>${def}</b> &nbsp;|&nbsp; ATAQUE adv. <b>${a.oatk}</b> × Sua DEFESA <b>${a.mdef}</b><br>Lances decisivos: sorteados em segredo no início do jogo`;
  if (game.match) game.refreshStatus();
}
const DEFAULTS = { force: 70, curve: 60, speed: 60, dribble: 50, pos: 50, reflex: 50, mark: 50, oatk: 60, mdef: 50 };
for (const key of SLIDERS) {
  const slider = document.getElementById('s-' + key), out = document.getElementById('o-' + key);
  const apply = () => { game.attr[key] = +slider.value; out.textContent = slider.value; updateBalance(); };
  slider.addEventListener('input', apply); apply();
}
/** Puxa os valores de game.attr para os sliders (ao voltar do treino ou restaurar padrões). */
function syncSliders() {
  for (const key of SLIDERS) { document.getElementById('s-' + key).value = game.attr[key]; document.getElementById('o-' + key).textContent = game.attr[key]; }
  updateBalance();
}
const ZOOMS = [[1, 'Normal'], [1.3, 'Perto'], [1.6, 'Mais perto']];
function applyZoom(z) {
  const r = game.renderer; r.zoom = z; r.resize(); r.snapCamera(game);
  const lbl = (ZOOMS.find(q => q[0] === z) || ZOOMS[0])[1];
  document.getElementById('zoom').textContent = 'Zoom: ' + lbl;
  try { localStorage.setItem('nst_zoom', String(z)); } catch (_) {}
}
document.getElementById('zoom').addEventListener('click', () => {
  const i = ZOOMS.findIndex(q => q[0] === game.renderer.zoom);
  applyZoom(ZOOMS[(i + 1) % ZOOMS.length][0]);
});
{ const z0 = game.renderer.zoom; applyZoom(ZOOMS.some(q => q[0] === z0) ? z0 : 1); }
document.getElementById('s-aids').addEventListener('change', e => { game.showAids = e.target.checked; });
document.getElementById('resetdef').addEventListener('click', () => { Object.assign(game.attr, DEFAULTS); syncSliders(); game.showAids = false; document.getElementById('s-aids').checked = false; });
const SCN_DESC = {
  rand: 'Sorteia um tipo diferente a cada lance.',
  contra: 'Contra-ataque a partir do meio-campo: 3x2, 2x1, 3x3 (defesa se recompondo) ou 4x3.',
  entrada: 'Ataque posicional na entrada da área contra 3 ou 4 zagueiros fechados.',
  parada: 'Falta frontal ou lateral com barreira. O batedor fica parado: arraste da bola para bater.',
  ponta: 'Bola na ponta: cruze para os atacantes que entram na área.',
  fechada: 'Retranca: 5 zagueiros dentro da área contra 2 ou 3 atacantes.',
  posicional: 'Muita gente (5 a 7 por lado): tenha paciência, troque passes e ache a brecha.',
  escanteio: 'Área cheia (4-6 atacantes x 7-9 defensores). Arraste forte: o cruzamento sai no alto e a cabeçada é automática. Às vezes é curto.',
  penalti: 'Só você e o goleiro: arraste da bola para escolher o canto e a força.',
  um_x_um: 'Você escapou da marcação: drible o goleiro, toque para o apoio ou chute.',
  costas: 'Defesa com a linha alta: lance em profundidade, mas cuidado com o impedimento.',
  roubada: 'Bola recuperada no campo de ataque, defesa desorganizada: aja rápido.',
  lado: 'Superioridade numérica junto à lateral (3x2 ou 4x3) com a defesa deslocada.',
  fundo: 'Ponta na linha de fundo: passe rasteiro para trás, para quem vem de frente para o gol.',
  rebote: 'A bola sobrou na entrada da área: chute de primeira ou toque rápido.',
  bloco: 'Defesa recuada deixa espaço na entrada da área: chute de fora ou procure a brecha.',
};
// Formações táticas (valem a partir do próximo lance)
for (const [id, key] of [['s-fa', 'us'], ['s-fd', 'opp']]) {
  const sel = document.getElementById(id);
  for (const f of Object.keys(Tactics.FORMATIONS)) sel.add(new Option(f, f, false, f === Tactics.forms[key]));
  sel.addEventListener('change', e => { Tactics.forms[key] = e.target.value; });
}
document.getElementById('s-n').addEventListener('change', e => { Scenarios.forceN = +e.target.value; });
document.getElementById('s-scn').addEventListener('change', e => { game.forceScn = e.target.value; document.getElementById('scn-desc').textContent = SCN_DESC[e.target.value]; });
document.getElementById('reset').addEventListener('click', () => game.fullReset());
document.getElementById('next').addEventListener('click', () => game.skipPlay());
document.getElementById('sim').addEventListener('click', () => game.quickSim());
document.getElementById('sim-bc').addEventListener('click', () => game.quickSim());
document.getElementById('newmatch').addEventListener('click', () => game.newMatch());
document.getElementById('e-new').addEventListener('click', () => { if (game.lineups) Central.mostrar(); else game.newMatch(); });
// Menu retrátil "Config Teste" (começa fechado); o ResizeObserver do palco reajusta o canvas
document.getElementById('toggle').addEventListener('click', e => {
  const open = document.getElementById('cfg').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});

// ----- Transmissão ao vivo (ETAPA 7): velocidade, status e menu retrátil de teste -----
document.getElementById('bc-speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { game.speed = +b.dataset.s; game._hudKey = ''; } });
document.getElementById('bc-status').addEventListener('click', () => document.getElementById('bc-stpanel').classList.toggle('show'));
document.getElementById('bc-cfgbtn').addEventListener('click', e => {
  const open = document.getElementById('cfg').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
  const f = document.getElementById('bc-feed'); f.scrollTop = f.scrollHeight;
});
document.getElementById('bc-menu').addEventListener('click', () => openMenu());

// ----- Menu principal (treino / lances de partida) -----
const menuEl = document.getElementById('menu');
function openMenu() {
  game.menuOpen = true; game.input.cancel();
  const tela = Central.aberta() || Escolha.aberta();
  // "Continuar" só aparece com um treino/partida pausado pelo botão Menu (nunca por cima da Central ou da escolha do clube)
  const canResume = !tela && game.started && !(game.mode === 'match' && game.match.over);
  document.getElementById('m-cont').style.display = canResume ? '' : 'none';
  document.getElementById('m-cont-t').textContent = game.mode === 'train' ? 'Continuar treino' : 'Continuar partida';
  ligaMenu(false);
  menuEl.classList.add('show');
}
/** Sub-opções do Campeonato Brasileiro no menu: Continuar (se houver save) e Novo (com aviso de perda do save). */
const $m = id => document.getElementById(id);
function ligaMenu(aberto) {
  const r = Liga.resumoSalvo();
  $m('m-liga').setAttribute('aria-expanded', aberto ? 'true' : 'false');
  $m('m-liga-op').hidden = !aberto; $m('m-liga-aviso').hidden = true;
  $m('m-liga-cont').hidden = !r;
  if (r) {
    const txt = `${r.clube} · ${r.acabou ? 'campeonato encerrado' : 'rodada ' + r.rodada + ' de ' + r.total} · ${r.pts} ponto${r.pts === 1 ? '' : 's'}`;
    $m('m-liga-info').textContent = txt; $m('m-liga-perde').textContent = txt;
  }
}
function closeMenu() { game.menuOpen = Central.aberta() || Escolha.aberta(); menuEl.classList.remove('show'); }
document.getElementById('menu-btn').addEventListener('click', openMenu);
document.getElementById('m-cont').addEventListener('click', closeMenu);
document.getElementById('m-train').addEventListener('click', () => { Central.ocultar(); Escolha.ocultar(); game.startTraining(); closeMenu(); });
document.getElementById('m-match').addEventListener('click', () => { Central.ocultar(); Escolha.ocultar(); game.startMatch(); closeMenu(); });
document.getElementById('m-liga').addEventListener('click', () => ligaMenu($m('m-liga-op').hidden));
$m('m-liga-cont').addEventListener('click', () => { menuEl.classList.remove('show'); continuarCampeonato(); });
$m('m-liga-novo').addEventListener('click', () => {
  if (Liga.resumoSalvo()) { $m('m-liga-aviso').hidden = false; $m('m-liga-sim').focus(); }      // há save: confirma antes de apagar
  else { menuEl.classList.remove('show'); novoCampeonato(); }
});
$m('m-liga-sim').addEventListener('click', () => { menuEl.classList.remove('show'); novoCampeonato(); });
$m('m-liga-nao').addEventListener('click', () => { $m('m-liga-aviso').hidden = true; });


// ----- Áudio: efeitos 16 bits + torcida (destrava no 1º clique/toque); botões SOM: ON/OFF na transmissão e na Central -----
Som.init();
document.addEventListener('click', e => { if (e.target.closest('.som-btn')) Som.alternar(); });
Som.vigiar(() => game.started && game.mode === 'match' && !!game.match && !game.match.over && !game.menuOpen && !document.hidden);   // torcida só com a partida rolando

openMenu();                                  // o jogo abre no menu inicial: Campeonato Brasileiro, Amistoso e Treino

export { syncSliders, game, openMenu };
