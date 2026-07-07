'use strict';
/* global Physics */

// ---------------------------------------------------------------- constantes

const M = 46; // margen de madera alrededor del paño
const CANVAS_W = Physics.W + M * 2;
const CANVAS_H = Physics.H + M * 2;

const BALL_COLORS = {
  0: '#f5f1e8', 1: '#f2c231', 2: '#2757ba', 3: '#d43a2f', 4: '#6a2e8f',
  5: '#e8772e', 6: '#1e7a3c', 7: '#8f2e35', 8: '#111111',
  9: '#f2c231', 10: '#2757ba', 11: '#d43a2f', 12: '#6a2e8f',
  13: '#e8772e', 14: '#1e7a3c', 15: '#8f2e35',
};

// ---------------------------------------------------------------- elementos

const $ = id => document.getElementById(id);
const canvas = $('table');
const ctx = canvas.getContext('2d');

// Lienzo con la resolución física real de la pantalla (hasta 2x) para que la
// línea de puntería y los círculos no se vean pixelados/toscos en pantallas
// de alta densidad; el tamaño en CSS (y por tanto el layout) no cambia.
const DPR = Math.min(2, window.devicePixelRatio || 1);
canvas.width = CANVAS_W * DPR;
canvas.height = CANVAS_H * DPR;
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

// ---------------------------------------------------------------- estado

let ws = null;
let mySeat = null;
let roomCode = null;
let names = [null, null];

let state = null;          // último estado autoritativo del servidor
let balls = [];            // copia local para renderizar/animar
let animating = false;
let pendingResult = null;

let mouse = { x: 0, y: 0, inside: false };
let aimAngle = 0;
let targetAim = 0;         // ángulo objetivo (crudo, del puntero); aimAngle lo persigue suavizado
let stroke = null;         // { startX, startY, angle } mientras se arrastra el taco
let power = 0;
let oppAim = null;         // ángulo de puntería del rival
let lastAimSent = 0;
let lastFrame = 0;

// ---------------------------------------------------------------- efectos
let effects = [];                    // animaciones transitorias: {type, t, dur, ...}
let shakeTimer = 0, shakeTotal = 0, shakeMag = 0;
let pendingBreakShot = false;        // el próximo 'shot' recibido es la rotura
let pendingBreakEffect = false;      // aún no se ha dibujado el impacto de la rotura
let shotIsBreak = false;
let shotCaromHits = new Map();       // bolas distintas golpeadas por la blanca en el tiro actual

// ------------------------------------------------------------- trofeos
let matchStats = null;               // estadísticas de la partida en curso, para los logros
let currentShotShooter = null;       // asiento que efectuó el último tiro (viene en el propio mensaje 'shot')

function addEffect(fx) { effects.push({ t: 0, ...fx }); }
function triggerShake(duration, magnitude) { shakeTimer = duration; shakeTotal = duration; shakeMag = magnitude; }

// ------------------------------------------------------------- cosméticos
// Elección personal (no se guarda en ningún sitio: se resetea con cada
// recarga, ya que de momento no hay grabación de partidas).
let myChar = 0, myCue = 0, myFelt = 0;
let cosmetics = [null, null]; // { char, cue, felt } por asiento, según el servidor

// ---------------------------------------------------------------- lobby

$('createBtn').addEventListener('click', () =>
  connect({ t: 'create', name: $('nameInput').value, char: myChar, cue: myCue, felt: myFelt }));
$('joinBtn').addEventListener('click', joinFromInput);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromInput(); });

function joinFromInput() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) { $('lobbyError').textContent = 'Introduce el código de la mesa.'; return; }
  connect({ t: 'join', name: $('nameInput').value, room: code, char: myChar, cue: myCue, felt: myFelt });
}

// Código en la URL (?mesa=XXXX) para unirse con un enlace
const urlRoom = new URLSearchParams(location.search).get('mesa');
if (urlRoom) $('codeInput').value = urlRoom.toUpperCase();

function connect(firstMsg) {
  $('lobbyError').textContent = '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = window.BILLAR_SERVER_URL || `${proto}://${location.host}${location.pathname}`;
  ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify(firstMsg));
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (mySeat !== null) {
      setStatus('Conexión perdida. Recarga la página para volver a jugar.');
    } else {
      $('lobbyError').textContent = 'No se pudo conectar con el servidor.';
    }
  };
}

function shareLink() {
  if (window.BILLAR_SHARE_URL) return `${window.BILLAR_SHARE_URL}?mesa=${roomCode}`;
  return location.href;
}

// ------------------------------------------------------- selección cosmética

// Retrato vectorial de un personaje; se reutiliza tanto para las miniaturas
// del lobby como para los avatares del HUD (solo cambia el radio/posición).
function drawPortrait(ctx2, cx, cy, r, charDef) {
  ctx2.save();

  // hombros / cuello
  ctx2.fillStyle = charDef.outfit;
  ctx2.beginPath();
  ctx2.moveTo(cx - r * 0.95, cy + r * 1.3);
  ctx2.quadraticCurveTo(cx, cy + r * 0.3, cx + r * 0.95, cy + r * 1.3);
  ctx2.closePath();
  ctx2.fill();

  // cabeza
  ctx2.fillStyle = charDef.skin;
  ctx2.beginPath(); ctx2.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx2.fill();

  // pelo (una forma distinta por estilo, para que se distingan a golpe de vista)
  ctx2.fillStyle = charDef.hair;
  if (charDef.hairStyle === 'ponytail') {
    ctx2.beginPath(); ctx2.arc(cx, cy - r * 0.08, r * 0.66, Math.PI * 1.02, Math.PI * 1.98); ctx2.fill();
    ctx2.beginPath(); ctx2.ellipse(cx + r * 0.55, cy + r * 0.3, r * 0.15, r * 0.4, 0.5, 0, Math.PI * 2); ctx2.fill();
  } else if (charDef.hairStyle === 'bun') {
    ctx2.beginPath(); ctx2.arc(cx, cy - r * 0.08, r * 0.66, Math.PI * 1.02, Math.PI * 1.98); ctx2.fill();
    ctx2.beginPath(); ctx2.arc(cx, cy - r * 0.78, r * 0.22, 0, Math.PI * 2); ctx2.fill();
  } else if (charDef.hairStyle === 'short') {
    ctx2.beginPath(); ctx2.arc(cx, cy - r * 0.1, r * 0.68, Math.PI * 1.05, Math.PI * 1.95); ctx2.fill();
  } else if (charDef.hairStyle === 'buzz') {
    ctx2.beginPath(); ctx2.arc(cx, cy - r * 0.15, r * 0.64, Math.PI * 1.1, Math.PI * 1.9); ctx2.fill();
  } else if (charDef.hairStyle === 'undercut') {
    ctx2.beginPath(); ctx2.arc(cx - r * 0.04, cy - r * 0.26, r * 0.46, Math.PI * 1.0, Math.PI * 1.85); ctx2.fill();
  }

  // ojos
  ctx2.fillStyle = '#222';
  ctx2.beginPath(); ctx2.arc(cx - r * 0.2, cy + r * 0.05, r * 0.06, 0, Math.PI * 2); ctx2.fill();
  ctx2.beginPath(); ctx2.arc(cx + r * 0.2, cy + r * 0.05, r * 0.06, 0, Math.PI * 2); ctx2.fill();

  // accesorio
  if (charDef.accessory === 'glasses') {
    ctx2.strokeStyle = '#222';
    ctx2.lineWidth = Math.max(1, r * 0.05);
    ctx2.beginPath(); ctx2.arc(cx - r * 0.2, cy + r * 0.05, r * 0.16, 0, Math.PI * 2); ctx2.stroke();
    ctx2.beginPath(); ctx2.arc(cx + r * 0.2, cy + r * 0.05, r * 0.16, 0, Math.PI * 2); ctx2.stroke();
    ctx2.beginPath(); ctx2.moveTo(cx - r * 0.04, cy + r * 0.05); ctx2.lineTo(cx + r * 0.04, cy + r * 0.05); ctx2.stroke();
  } else if (charDef.accessory === 'tattoo') {
    ctx2.strokeStyle = 'rgba(60,40,120,.85)';
    ctx2.lineWidth = Math.max(1, r * 0.045);
    ctx2.beginPath();
    ctx2.arc(cx + r * 0.42, cy + r * 0.28, r * 0.15, Math.PI * 0.2, Math.PI * 1.1);
    ctx2.stroke();
  }

  ctx2.restore();
}

function drawCueSwatch(ctx2, w, h, cueDef) {
  ctx2.clearRect(0, 0, w, h);
  if (cueDef.glow) { ctx2.shadowColor = cueDef.glow; ctx2.shadowBlur = 6; }
  const g = ctx2.createLinearGradient(4, h - 4, w - 4, 4);
  g.addColorStop(0, cueDef.colors[0]);
  g.addColorStop(0.7, cueDef.colors[1]);
  g.addColorStop(1, cueDef.colors[2]);
  ctx2.strokeStyle = g;
  ctx2.lineWidth = 5;
  ctx2.lineCap = 'round';
  ctx2.beginPath();
  ctx2.moveTo(4, h - 4);
  ctx2.lineTo(w - 4, 4);
  ctx2.stroke();
}

function drawFeltSwatch(ctx2, w, h, feltDef) {
  ctx2.clearRect(0, 0, w, h);
  ctx2.fillStyle = feltDef.base;
  roundRectOn(ctx2, 2, 2, w - 4, h - 4, 6);
  ctx2.fill();
}
function roundRectOn(ctx2, x, y, w, h, r) {
  ctx2.beginPath();
  ctx2.moveTo(x + r, y);
  ctx2.arcTo(x + w, y, x + w, y + h, r);
  ctx2.arcTo(x + w, y + h, x, y + h, r);
  ctx2.arcTo(x, y + h, x, y, r);
  ctx2.arcTo(x, y, x + w, y, r);
  ctx2.closePath();
}

function buildPicker(containerId, items, size, drawFn, onSelect) {
  const container = $(containerId);
  items.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick' + (idx === 0 ? ' selected' : '');
    btn.title = item.name;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    btn.appendChild(cv);
    drawFn(cv.getContext('2d'), size, item);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pick').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      onSelect(idx);
    });
    container.appendChild(btn);
  });
}

buildPicker('charPicker', Cosmetics.CHARACTERS, 44,
  (c2, s, item) => drawPortrait(c2, s / 2, s / 2, s * 0.42, item),
  idx => { myChar = idx; });
buildPicker('cuePicker', Cosmetics.CUES, 44,
  (c2, s, item) => drawCueSwatch(c2, s, s, item),
  idx => { myCue = idx; });
buildPicker('feltPicker', Cosmetics.FELTS, 44,
  (c2, s, item) => drawFeltSwatch(c2, s, s, item),
  idx => { myFelt = idx; });

// ---------------------------------------------------------------- mensajes

function onMessage(m) {
  switch (m.t) {
    case 'error':
      $('lobbyError').textContent = m.msg;
      ws.close(); ws = null;
      break;

    case 'joined':
      mySeat = m.seat;
      roomCode = m.room;
      names = m.names.slice();
      cosmetics = m.cosmetics ? m.cosmetics.slice() : [null, null];
      renderAvatars();
      $('lobby').classList.add('hidden');
      $('game').classList.remove('hidden');
      $('roomCode').textContent = roomCode;
      history.replaceState(null, '', `?mesa=${roomCode}`);
      if (!names[1 - mySeat]) {
        setStatus('Esperando rival… comparte el enlace o el código de la mesa.');
        addChat(null, `Comparte este enlace para invitar: ${shareLink()}`);
      }
      initAudio();
      break;

    case 'opponent':
      names[1 - mySeat] = m.name;
      cosmetics[1 - mySeat] = m.cosmetics;
      renderAvatars();
      addChat(null, `${m.name} se ha unido a la mesa.`);
      break;

    case 'start':
      $('overMsg').classList.add('hidden');
      $('trophyRow').innerHTML = '';
      $('trophyRow').classList.add('hidden');
      pendingResult = null;
      animating = false;
      pendingBreakShot = true;
      currentShotShooter = null;
      matchStats = { fouls: [0, 0], maxDeficit: [0, 0], legalBreak: [false, false], bestCarom: [0, 0], totalShots: 0 };
      break;

    case 'state':
      applyState(m);
      break;

    case 'result':
      if (animating) pendingResult = m;
      else applyState(m, { isShotResult: true });
      break;

    case 'shot': {
      // Animar el tiro localmente (ambos jugadores)
      oppAim = null;
      stroke = null; power = 0; updatePowerBar();
      shotIsBreak = pendingBreakShot;
      pendingBreakEffect = pendingBreakShot;
      pendingBreakShot = false;
      shotCaromHits = new Map();
      currentShotShooter = m.seat;
      if (matchStats) matchStats.totalShots++;
      Physics.shoot(balls, m.angle, m.power);
      animating = true;
      break;
    }

    case 'aim':
      oppAim = m.angle;
      break;

    case 'chat':
      addChat(m.from, m.text, m.seat);
      break;

    case 'tomato':
      addEffect({ type: 'tomato', dur: 2.6 });
      playSound('tomato');
      break;

    case 'left':
      addChat(null, 'Tu rival ha abandonado la mesa.');
      setStatus('Esperando rival… comparte el enlace o el código de la mesa.');
      names = [names[mySeat], null];
      mySeat = 0;
      state = null;
      balls = [];
      $('overMsg').classList.add('hidden');
      updateHud();
      break;
  }
}

function applyState(m, opts) {
  opts = opts || {};
  const prevGroups = state ? state.groups : null;
  const prevTurn = state ? state.turn : null;
  const prevBallInHand = state ? state.ballInHand : false;
  const prevPotted = state ? state.potted.map(a => a.length) : [0, 0];

  state = m;
  names = m.names.slice();
  balls = m.balls.map(b => ({ ...b, vx: 0, vy: 0 }));
  oppAim = null;
  if (m.msg) addChat(null, m.msg);
  updateHud();

  // Falta: siempre que el servidor pone la bola en mano es porque ha habido
  // una falta (regla del propio servidor), así que es una señal exacta.
  // prevTurn es quien tiró (y por tanto quien ha cometido la falta).
  const fouled = !prevBallInHand && m.ballInHand;
  if (fouled) {
    addEffect({ type: 'foul', dur: 0.7 });
    triggerShake(0.35, 6);
    playSound('foul');
    if (matchStats && prevTurn !== null) matchStats.fouls[prevTurn]++;
  }

  // Rotura limpia: el tiro que se acaba de resolver era el saque, no ha
  // habido falta y quien tiró ha entronado alguna bola.
  if (opts.isShotResult && shotIsBreak && !fouled && matchStats && currentShotShooter !== null &&
      m.potted[currentShotShooter].length > prevPotted[currentShotShooter]) {
    matchStats.legalBreak[currentShotShooter] = true;
  }

  // Diferencia máxima de bolas a favor/en contra de cada asiento, para
  // detectar remontadas (solo tiene sentido una vez hay grupos asignados).
  if (matchStats && m.groups[0] && m.groups[1]) {
    const diff0 = m.potted[0].length - m.potted[1].length;
    matchStats.maxDeficit[0] = Math.max(matchStats.maxDeficit[0], -diff0);
    matchStats.maxDeficit[1] = Math.max(matchStats.maxDeficit[1], diff0);
  }

  // Asignación de grupo (mesa abierta resuelta): ambos asientos pasan de
  // null a lisas/rayadas a la vez.
  if (prevGroups && prevGroups[mySeat] === null && m.groups && m.groups[mySeat] !== null) {
    addEffect({ type: 'groupBanner', group: m.groups[mySeat], dur: 1.4 });
  }

  // Sigue tirando: solo tras resolver un tiro (no tras "Rompe X." ni al
  // colocar la bola en mano), mismo turno que antes y sin falta.
  if (opts.isShotResult && prevTurn !== null && m.phase === 'aim' &&
      !m.ballInHand && !prevBallInHand && m.turn === prevTurn) {
    addEffect({ type: 'continue', dur: 0.55 });
  }

  if (m.phase === 'over') {
    $('overText').textContent = m.msg || 'Fin de la partida';
    $('overMsg').classList.remove('hidden');
    if (m.winner === mySeat) {
      playSound('win');
      addEffect({ type: 'victory', dur: 2.2 });
    } else {
      addEffect({ type: 'defeat', dur: 1.6 });
      triggerShake(0.5, 4);
    }
    if (m.winner !== null) renderTrophies(computeTrophies(m.winner));
  } else if (myTurn() && m.ballInHand) {
    setStatus('Bola en mano: haz clic donde quieras colocar la blanca.');
  } else if (myTurn()) {
    setStatus('Tu turno: apunta con el ratón y arrastra hacia atrás para tirar.');
  } else {
    setStatus(`Turno de ${names[state.turn]}…`);
  }
}

function myTurn() {
  return state && state.phase === 'aim' && state.turn === mySeat;
}

// ---------------------------------------------------------------- HUD

function setStatus(text) { $('status').textContent = text; }

function updateHud() {
  for (const seat of [0, 1]) {
    const el = $('p' + seat);
    el.querySelector('.pname').textContent =
      (names[seat] || '—') + (seat === mySeat ? ' (tú)' : '');
    const grp = state && state.groups ? state.groups[seat] : null;
    el.querySelector('.pgroup').textContent =
      grp ? (grp === 'solid' ? 'Lisas' : 'Rayadas') : '';
    el.classList.toggle('active', !!(state && state.phase === 'aim' && state.turn === seat));

    // Bandeja de bolas
    const tray = el.querySelector('.tray');
    tray.innerHTML = '';
    if (state && grp) {
      const ids = grp === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
      for (const id of ids) {
        const dot = document.createElement('div');
        dot.className = 'mini' + (state.potted[seat].includes(id) ? ' potted' : '');
        dot.style.background = BALL_COLORS[id];
        if (id > 8) dot.style.boxShadow = 'inset 0 -4px 0 #fff, inset 0 4px 0 #fff';
        tray.appendChild(dot);
      }
    }
  }
}

// ---------------------------------------------------------------- trofeos

const TROPHIES = {
  perfect:    { icon: '🛡️', name: 'Partida perfecta',  desc: 'Has ganado sin cometer ninguna falta.' },
  domination: { icon: '👑', name: 'Dominación',         desc: 'El rival se ha quedado con más de 5 bolas propias sin entronar.' },
  cleanBreak: { icon: '💥', name: 'Rotura magistral',   desc: 'Has entronado una bola limpiamente en el saque.' },
  triCarom:   { icon: '🔗', name: 'Carambola triple',   desc: 'Has tocado 3 o más bolas distintas con la blanca en un mismo tiro.' },
  comeback:   { icon: '📈', name: 'Remontada',          desc: 'Has ganado tras ir por detrás en el marcador por 4 bolas o más.' },
  lightning:  { icon: '⚡', name: 'Victoria relámpago', desc: 'La partida ha terminado en 15 tiros o menos entre ambos jugadores.' },
};

function computeTrophies(winner) {
  if (!matchStats) return [];
  const loser = 1 - winner;
  const list = [];
  if (matchStats.fouls[winner] === 0) list.push(TROPHIES.perfect);
  if (state.groups[loser] && (7 - state.potted[loser].length) > 5) list.push(TROPHIES.domination);
  if (matchStats.legalBreak[winner]) list.push(TROPHIES.cleanBreak);
  if (matchStats.bestCarom[winner] >= 3) list.push(TROPHIES.triCarom);
  if (matchStats.maxDeficit[winner] >= 4) list.push(TROPHIES.comeback);
  if (matchStats.totalShots > 0 && matchStats.totalShots <= 15) list.push(TROPHIES.lightning);
  return list;
}

function renderTrophies(list) {
  const row = $('trophyRow');
  row.innerHTML = '';
  if (!list.length) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  for (const tr of list) {
    const el = document.createElement('div');
    el.className = 'trophy';
    el.title = tr.desc;
    el.innerHTML = `<span class="ticon">${tr.icon}</span><span class="tname">${tr.name}</span>`;
    row.appendChild(el);
  }
}

function renderAvatars() {
  for (const seat of [0, 1]) {
    const canv = $('p' + seat).querySelector('.avatar');
    const c2 = canv.getContext('2d');
    c2.clearRect(0, 0, canv.width, canv.height);
    const charDef = Cosmetics.CHARACTERS[(cosmetics[seat] && cosmetics[seat].char) || 0];
    drawPortrait(c2, canv.width / 2, canv.height / 2, canv.width * 0.42, charDef);
  }
}

// ---------------------------------------------------------------- chat

$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text && ws) ws.send(JSON.stringify({ t: 'chat', text }));
  $('chatInput').value = '';
});

function addChat(from, text, seat) {
  const log = $('chatLog');
  const div = document.createElement('div');
  if (from === null || from === undefined) {
    div.className = 'sys';
    div.textContent = text;
  } else {
    const b = document.createElement('span');
    b.className = 'from' + (seat === mySeat ? ' me' : '');
    b.textContent = from + ': ';
    div.appendChild(b);
    div.appendChild(document.createTextNode(text));
  }
  log.appendChild(div);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------- pánico

let panicActive = false;
let panicMuted = false;
let panicGridBuilt = false;

const PANIC_WORDS = ['Presupuesto', 'Previsión', 'Real', 'Varianza', 'Ingresos', 'Coste',
  'Margen', 'Unidades', 'Cabezas', 'Q1', 'Q2', 'Q3', 'Q4', 'Norte', 'Sur', 'EMEA', 'APAC', 'Total'];

function buildPanicGrid() {
  const table = $('pncGrid');
  const cols = 14, rows = 32;
  const thead = document.createElement('tr');
  thead.appendChild(document.createElement('th'));
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    th.textContent = String.fromCharCode(65 + c);
    thead.appendChild(th);
  }
  table.appendChild(thead);
  for (let r = 1; r <= rows; r++) {
    const tr = document.createElement('tr');
    const rowTh = document.createElement('td');
    rowTh.textContent = String(r);
    tr.appendChild(rowTh);
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      const roll = Math.random();
      if (roll < 0.18) td.textContent = PANIC_WORDS[Math.floor(Math.random() * PANIC_WORDS.length)];
      else if (roll < 0.55) td.textContent = '$' + Math.round(Math.random() * 90000 + 100).toLocaleString('es-ES');
      else if (roll < 0.75) td.textContent = (Math.random() * 100).toFixed(1) + '%';
      else td.textContent = '';
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

function showPanic() {
  if (panicActive) return;
  panicActive = true;
  if (!panicGridBuilt) { buildPanicGrid(); panicGridBuilt = true; }
  $('panicOverlay').classList.remove('hidden');
  panicMuted = true;
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
}

function hidePanic() {
  if (!panicActive) return;
  panicActive = false;
  $('panicOverlay').classList.add('hidden');
  panicMuted = false;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

$('panicBtn').addEventListener('click', showPanic);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && panicActive) hidePanic(); });

// ---------------------------------------------------------------- entrada

function toTable(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (CANVAS_W / r.width) - M,
    y: (e.clientY - r.top) * (CANVAS_H / r.height) - M,
  };
}

canvas.addEventListener('pointermove', e => {
  const p = toTable(e);
  mouse.x = p.x; mouse.y = p.y; mouse.inside = true;

  if (stroke) {
    // Potencia = distancia arrastrada en sentido contrario a la puntería
    const dx = p.x - stroke.startX, dy = p.y - stroke.startY;
    const back = -(dx * Math.cos(stroke.angle) + dy * Math.sin(stroke.angle));
    power = Math.max(0, Math.min(1, back / 220));
    updatePowerBar();
  } else if (myTurn() && !state.ballInHand && !animating) {
    const cue = cueBall();
    // Si el puntero está casi sobre la propia bola blanca, atan2 se vuelve
    // inestable (pequeños temblores dan ángulos muy distintos); en ese caso
    // se ignora la muestra y se conserva el último ángulo objetivo válido.
    if (cue && Math.hypot(p.x - cue.x, p.y - cue.y) > 6) {
      targetAim = Math.atan2(p.y - cue.y, p.x - cue.x);
    }
  }
});

canvas.addEventListener('pointerdown', e => {
  if (!myTurn() || animating) return;
  const p = toTable(e);

  if (state.ballInHand) {
    if (Physics.canPlaceCue(balls.filter(b => b.id !== 0), p.x, p.y)) {
      ws.send(JSON.stringify({ t: 'place', x: p.x, y: p.y }));
    }
    return;
  }

  const cue = cueBall();
  if (!cue) return;
  aimAngle = Math.atan2(p.y - cue.y, p.x - cue.x);
  targetAim = aimAngle;
  stroke = { startX: p.x, startY: p.y, angle: aimAngle };
  power = 0;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', () => {
  if (!stroke) return;
  const shotPower = power;
  const angle = stroke.angle;
  stroke = null;
  power = 0;
  updatePowerBar();
  if (shotPower > 0.04 && myTurn() && !animating) {
    ws.send(JSON.stringify({ t: 'shoot', angle, power: shotPower }));
  }
});

canvas.addEventListener('pointerleave', () => { mouse.inside = false; });

$('rematchBtn').addEventListener('click', () => {
  if (ws) ws.send(JSON.stringify({ t: 'rematch' }));
  $('rematchBtn').textContent = 'Esperando al rival…';
  setTimeout(() => { $('rematchBtn').textContent = 'Revancha'; }, 4000);
});

const TOMATO_COOLDOWN_MS = 3000;
let tomatoCooldownUntil = 0;

$('tomatoBtn').addEventListener('click', () => {
  if (!ws || !names[1 - mySeat] || Date.now() < tomatoCooldownUntil) return;
  ws.send(JSON.stringify({ t: 'tomato' }));
  tomatoCooldownUntil = Date.now() + TOMATO_COOLDOWN_MS;
  updateTomatoBtn();
});

function updateTomatoBtn() {
  const remain = tomatoCooldownUntil - Date.now();
  const btn = $('tomatoBtn');
  if (remain > 0) {
    btn.disabled = true;
    btn.textContent = `🍅 ${Math.ceil(remain / 1000)}s`;
    setTimeout(updateTomatoBtn, 200);
  } else {
    btn.disabled = false;
    btn.textContent = '🍅 Tomatazo';
  }
}

function cueBall() {
  const c = balls.find(b => b.id === 0);
  return c && c.inPlay ? c : null;
}

function updatePowerBar() {
  const bar = $('powerBar');
  const pct = Math.round(power * 100) + '%';
  bar.style.height = pct;
  bar.style.width = pct; // versión móvil (horizontal)
}

// Interpola un ángulo hacia otro por el camino más corto (evita el salto al
// cruzar el límite ±π).
function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + diff * t;
}

// ---------------------------------------------------------------- animación

const AIM_SMOOTH_TAU = 0.045; // segundos; más bajo = más ágil pero también más tosco

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0);
  lastFrame = ts;

  // En el lobby (mesa oculta) o en segundo plano no hay nada que animar.
  // Redibujar la mesa igualmente saturaba el hilo principal en móviles
  // modestos: hasta teclear el nombre iba a tirones dentro de la app.
  if (document.hidden || $('game').classList.contains('hidden')) return;

  effects.forEach(fx => { fx.t += dt; });
  effects = effects.filter(fx => fx.t < fx.dur);
  if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - dt);

  if (myTurn() && !state.ballInHand && !animating && !stroke) {
    aimAngle = lerpAngle(aimAngle, targetAim, 1 - Math.exp(-dt / AIM_SMOOTH_TAU));
    const now = performance.now();
    if (now - lastAimSent > 60 && ws) {
      lastAimSent = now;
      ws.send(JSON.stringify({ t: 'aim', angle: aimAngle }));
    }
  }

  if (animating) {
    const events = [];
    const stopped = Physics.step(balls, dt, events);
    for (const ev of events) {
      if (ev.type === 'hit' && ev.speed > 30) playSound('hit', ev.speed);
      else if (ev.type === 'cushion') playSound('cushion', ev.speed);
      else if (ev.type === 'pot') playSound('pot');

      if (ev.type === 'hit') {
        if (pendingBreakEffect) {
          pendingBreakEffect = false;
          addEffect({ type: 'break', x: ev.x, y: ev.y, dur: 0.55 });
          triggerShake(0.3, 5);
        }
        // Carambola: la blanca toca varias bolas distintas en el mismo tiro.
        if ((ev.a === 0 || ev.b === 0)) {
          const otherId = ev.a === 0 ? ev.b : ev.a;
          if (!shotCaromHits.has(otherId)) shotCaromHits.set(otherId, { x: ev.x, y: ev.y });
        }
      } else if (ev.type === 'pot') {
        addEffect({ type: 'pot', x: ev.x, y: ev.y, id: ev.id, dur: 0.6 });
      }
    }
    if (stopped) {
      animating = false;
      if (shotCaromHits.size >= 2) {
        addEffect({ type: 'carom', points: Array.from(shotCaromHits.values()), dur: 0.9 });
        playSound('carom');
      }
      if (matchStats && currentShotShooter !== null) {
        matchStats.bestCarom[currentShotShooter] = Math.max(matchStats.bestCarom[currentShotShooter], shotCaromHits.size);
      }
      shotCaromHits = new Map();
      if (pendingResult) {
        const r = pendingResult;
        pendingResult = null;
        applyState(r, { isShotResult: true });
      }
    }
  }

  draw();
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- dibujo

// El fondo de la mesa (madera, paño, diamantes, troneras) es estático:
// regenerar sus gradientes en cada frame era, con diferencia, lo más caro
// del bucle de render en móviles modestos. Se dibuja una vez en un canvas
// aparte y solo se reconstruye si cambia el paño (que decide el asiento 0).
let bgCanvas = null;
let bgFeltIdx = -1;
function tableBackground() {
  const feltIdx = (cosmetics[0] && cosmetics[0].felt) || 0;
  if (bgCanvas && bgFeltIdx === feltIdx) return bgCanvas;
  bgFeltIdx = feltIdx;
  if (!bgCanvas) {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = CANVAS_W * DPR;
    bgCanvas.height = CANVAS_H * DPR;
  }
  const c = bgCanvas.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Marco de madera
  roundRectOn(c, 0, 0, CANVAS_W, CANVAS_H, 18);
  const wood = c.createLinearGradient(0, 0, 0, CANVAS_H);
  wood.addColorStop(0, '#7a4a24');
  wood.addColorStop(1, '#5a3416');
  c.fillStyle = wood;
  c.fill();

  c.save();
  c.translate(M, M);
  // El tapete es un elemento compartido de la mesa: manda siempre el
  // asiento 0 (quien la creó), no la elección personal de cada jugador.
  const feltDef0 = Cosmetics.FELTS[feltIdx];
  c.fillStyle = feltDef0.base;
  c.fillRect(-8, -8, Physics.W + 16, Physics.H + 16);
  const felt = c.createRadialGradient(
    Physics.W / 2, Physics.H / 2, 100, Physics.W / 2, Physics.H / 2, 700);
  felt.addColorStop(0, 'rgba(255,255,255,.06)');
  felt.addColorStop(1, 'rgba(0,0,0,.18)');
  c.fillStyle = felt;
  c.fillRect(-8, -8, Physics.W + 16, Physics.H + 16);

  // Marcas de mosaico (diamantes) en la madera
  c.fillStyle = '#e8d9b0';
  const dotOn = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    dotOn(i * Physics.W / 8, -M / 2 - 4, 3.5);
    dotOn(i * Physics.W / 8, Physics.H + M / 2 + 4, 3.5);
  }
  for (let i = 1; i <= 3; i++) {
    dotOn(-M / 2 - 4, i * Physics.H / 4, 3.5);
    dotOn(Physics.W + M / 2 + 4, i * Physics.H / 4, 3.5);
  }

  // Troneras
  for (const p of Physics.POCKETS) {
    c.beginPath();
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    c.fillStyle = '#0a0a0a';
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)';
    c.lineWidth = 4;
    c.stroke();
  }
  c.restore();
  return bgCanvas;
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  let shakeX = 0, shakeY = 0;
  if (shakeTimer > 0) {
    const k = shakeTimer / shakeTotal;
    shakeX = (Math.random() * 2 - 1) * shakeMag * k;
    shakeY = (Math.random() * 2 - 1) * shakeMag * k;
  }

  // La sacudida es "de cámara": ahora desplaza la imagen completa de la mesa
  // (madera incluida) en vez de solo el interior, que es lo que permite usar
  // el fondo cacheado también durante la sacudida.
  ctx.drawImage(tableBackground(), shakeX, shakeY, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.translate(M + shakeX, M + shakeY);

  // Guías de puntería
  if (!animating && state && state.phase === 'aim') {
    const cue = cueBall();
    if (cue && !state.ballInHand) {
      if (myTurn()) {
        drawAim(cue, stroke ? stroke.angle : aimAngle, true, Cosmetics.CUES[myCue]);
      } else if (oppAim !== null) {
        const oppCue = Cosmetics.CUES[(cosmetics[1 - mySeat] && cosmetics[1 - mySeat].cue) || 0];
        drawAim(cue, oppAim, false, oppCue);
      }
    }
  }

  // Bolas
  for (const b of balls) {
    if (b.inPlay) drawBall(b.x, b.y, b.id);
  }

  // Bola en mano: fantasma bajo el ratón
  if (!animating && myTurn() && state.ballInHand && mouse.inside) {
    const ok = Physics.canPlaceCue(balls.filter(b => b.id !== 0), mouse.x, mouse.y);
    ctx.globalAlpha = 0.55;
    drawBall(mouse.x, mouse.y, 0);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, Physics.BALL_R + 3, 0, Math.PI * 2);
    ctx.strokeStyle = ok ? '#7CFC00' : '#ff5252';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawTableEffects(ctx);
  ctx.restore();
  drawScreenEffects(ctx);
}

function drawAim(cue, angle, mine, cueDef) {
  const others = balls;
  const hit = Physics.aimRay(others, cue.x, cue.y, angle);

  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = mine ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(hit.x, hit.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bola fantasma y dirección prevista de la bola objetivo
  ctx.beginPath();
  ctx.arc(hit.x, hit.y, Physics.BALL_R, 0, Math.PI * 2);
  ctx.stroke();
  if (hit.ball && hit.objDir) {
    ctx.strokeStyle = mine ? 'rgba(240,197,65,.9)' : 'rgba(240,197,65,.35)';
    ctx.beginPath();
    ctx.moveTo(hit.ball.x, hit.ball.y);
    ctx.lineTo(hit.ball.x + hit.objDir.x * 70, hit.ball.y + hit.objDir.y * 70);
    ctx.stroke();
  }

  // Taco: el propio con retroceso según la potencia; el del rival con un
  // retroceso fijo (no se conoce su potencia hasta que suelta el tiro) y
  // más translúcido para no competir visualmente con el propio.
  // Se dibuja desde un sprite pre-renderizado y rotado: el shadowBlur del
  // glow y el degradado eran demasiado caros para repetirlos cada frame.
  const pull = mine ? 14 + power * 90 : 30;
  ctx.save();
  ctx.globalAlpha = mine ? 1 : 0.4;
  ctx.translate(cue.x, cue.y);
  ctx.rotate(angle + Math.PI); // el taco se extiende en sentido opuesto al tiro
  ctx.drawImage(cueSprite(cueDef), pull - CUE_PAD, -CUE_PAD, CUE_LEN + CUE_PAD * 2, CUE_PAD * 2);
  ctx.restore();
  ctx.restore();
}

const CUE_LEN = 260;
const CUE_PAD = 22; // hueco para el glow (shadowBlur 14) y el remate redondeado
const cueSprites = new Map();
function cueSprite(cueDef) {
  let s = cueSprites.get(cueDef);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = (CUE_LEN + CUE_PAD * 2) * DPR;
  s.height = CUE_PAD * 2 * DPR;
  const c = s.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (cueDef.glow) { c.shadowColor = cueDef.glow; c.shadowBlur = 14; }
  const g = c.createLinearGradient(CUE_PAD, 0, CUE_PAD + CUE_LEN, 0);
  g.addColorStop(0, cueDef.colors[0]);
  g.addColorStop(0.7, cueDef.colors[1]);
  g.addColorStop(1, cueDef.colors[2]);
  c.strokeStyle = g;
  c.lineWidth = 7;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(CUE_PAD, CUE_PAD);
  c.lineTo(CUE_PAD + CUE_LEN, CUE_PAD);
  c.stroke();
  cueSprites.set(cueDef, s);
  return s;
}

// Cada bola se pre-renderiza una sola vez en un sprite: dibujarla a mano
// implicaba un clip y un fillText por bola y por frame, y el render de texto
// era lo más caro que quedaba en el bucle tras cachear el fondo de la mesa.
const ballSprites = new Map();
function ballSprite(id) {
  let s = ballSprites.get(id);
  if (s) return s;
  const R = Physics.BALL_R;
  const PAD = R + 4; // margen para la sombra (desplazada +2,+3)
  s = document.createElement('canvas');
  s.width = PAD * 2 * DPR;
  s.height = PAD * 2 * DPR;
  const c = s.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const x = PAD, y = PAD;
  c.save();

  // Sombra
  c.beginPath();
  c.arc(x + 2, y + 3, R, 0, Math.PI * 2);
  c.fillStyle = 'rgba(0,0,0,.3)';
  c.fill();

  // Cuerpo
  c.beginPath();
  c.arc(x, y, R, 0, Math.PI * 2);
  c.fillStyle = id >= 9 ? '#f5f1e8' : BALL_COLORS[id];
  c.fill();

  // Banda de las rayadas
  if (id >= 9) {
    c.clip();
    c.fillStyle = BALL_COLORS[id];
    c.fillRect(x - R, y - R * 0.55, R * 2, R * 1.1);
  }

  // Círculo del número
  if (id > 0) {
    c.beginPath();
    c.arc(x, y, R * 0.52, 0, Math.PI * 2);
    c.fillStyle = '#f5f1e8';
    c.fill();
    c.fillStyle = '#111';
    c.font = `bold ${Math.round(R * 0.75)}px Arial`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(id), x, y + 0.5);
  }

  // Brillo
  c.beginPath();
  c.arc(x - R * 0.35, y - R * 0.4, R * 0.32, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.45)';
  c.fill();

  c.restore();
  ballSprites.set(id, s);
  return s;
}

function drawBall(x, y, id) {
  const PAD = Physics.BALL_R + 4;
  ctx.drawImage(ballSprite(id), x - PAD, y - PAD, PAD * 2, PAD * 2);
}

// ---------------------------------------------------------------- efectos

// Efectos "sobre el paño": comparten el sistema de coordenadas de las bolas.
function drawTableEffects(ctx) {
  for (const fx of effects) {
    if (fx.type === 'pot') drawPotEffect(ctx, fx);
    else if (fx.type === 'break') drawBreakEffect(ctx, fx);
    else if (fx.type === 'carom') drawCaromEffect(ctx, fx);
    else if (fx.type === 'victory') drawVictoryEffect(ctx, fx);
  }
}

// Efectos "de pantalla": vinculados al marco completo, no al paño.
function drawScreenEffects(ctx) {
  for (const fx of effects) {
    if (fx.type === 'foul') drawFoulEffect(ctx, fx);
    else if (fx.type === 'defeat') drawDefeatEffect(ctx, fx);
    else if (fx.type === 'groupBanner') drawGroupBanner(ctx, fx);
    else if (fx.type === 'continue') drawContinueEffect(ctx, fx);
    else if (fx.type === 'tomato') drawTomatoEffect(ctx, fx);
  }
}

// Entrar una bola: gira y se encoge en espiral hacia la tronera, con un
// halo de succión oscuro y partículas del color de la propia bola.
function drawPotEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k);
  const grd = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, Physics.BALL_R * 2.6);
  grd.addColorStop(0, 'rgba(0,0,0,.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, Physics.BALL_R * 2.6 * (1 + k * 0.7), 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(fx.x, fx.y);
  ctx.rotate(k * Math.PI * 1.6);
  const s = Math.max(0.001, 1 - k);
  ctx.scale(s, s);
  ctx.translate(-fx.x, -fx.y);
  drawBall(fx.x, fx.y, fx.id);
  ctx.restore();

  if (!fx.particles) {
    fx.particles = Array.from({ length: 9 }, () => ({
      a: Math.random() * Math.PI * 2, sp: 35 + Math.random() * 65, r: 1.5 + Math.random() * 2,
    }));
  }
  const color = fx.id >= 9 ? BALL_COLORS[fx.id] : BALL_COLORS[fx.id] || '#fff';
  for (const p of fx.particles) {
    const d = p.sp * fx.t;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(fx.x + Math.cos(p.a) * d, fx.y + Math.sin(p.a) * d, p.r * (1 - k), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Rotura: onda expansiva blanca + polvo de madera en el punto de impacto.
function drawBreakEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 4 * (1 - k) + 1;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, 8 + k * 75, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  if (!fx.particles) {
    fx.particles = Array.from({ length: 14 }, () => ({
      a: Math.random() * Math.PI * 2, sp: 55 + Math.random() * 95, r: 1 + Math.random() * 2,
    }));
  }
  for (const p of fx.particles) {
    const d = p.sp * fx.t;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.fillStyle = '#c9a15a';
    ctx.beginPath(); ctx.arc(fx.x + Math.cos(p.a) * d, fx.y + Math.sin(p.a) * d, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Carambola: cadena dorada entre los puntos de contacto, con una chispa que
// recorre el camino y un rótulo que aparece y se retira con rebote.
function drawCaromEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  const pts = fx.points;

  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k * 0.85);
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ffcf40';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();

  const travel = Math.min(1, fx.t / (fx.dur * 0.55));
  const segs = pts.length - 1;
  const segF = travel * segs;
  const segI = Math.min(segs - 1, Math.floor(segF));
  const lt = segF - segI;
  const p0 = pts[segI], p1 = pts[segI + 1] || p0;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - Math.max(0, (k - 0.55) / 0.45));
  ctx.fillStyle = '#fff6d0';
  ctx.beginPath(); ctx.arc(p0.x + (p1.x - p0.x) * lt, p0.y + (p1.y - p0.y) * lt, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const scale = k < 0.2 ? k / 0.2 : (k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1);
  ctx.save();
  ctx.globalAlpha = scale;
  ctx.translate(Physics.W / 2, Physics.H * 0.3);
  ctx.scale(scale, scale);
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.strokeText('¡Carambola!', 0, 0);
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('¡Carambola!', 0, 0);
  ctx.restore();
}

// Victoria: confeti con los colores de las bolas, cayendo desde el centro.
function drawVictoryEffect(ctx, fx) {
  if (!fx.particles) {
    const colors = Object.values(BALL_COLORS);
    fx.particles = Array.from({ length: 55 }, () => ({
      vx: (Math.random() * 2 - 1) * 230, vy: -Math.random() * 240 - 60,
      color: colors[Math.floor(Math.random() * colors.length)], r: 3 + Math.random() * 3,
      spin: Math.random() * 8 - 4,
    }));
  }
  const g = 380;
  ctx.save();
  for (const p of fx.particles) {
    const x = Physics.W / 2 + p.vx * fx.t;
    const y = Physics.H / 2 + p.vy * fx.t + 0.5 * g * fx.t * fx.t;
    if (y > Physics.H + 20) continue;
    ctx.globalAlpha = Math.max(0, 1 - fx.t / fx.dur);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.spin * fx.t);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Falta: viñeta roja que pulsa y se retira rápido.
function drawFoulEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  const alpha = Math.max(0, 1 - k) * 0.5;
  ctx.save();
  const grd = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, Math.min(CANVAS_W, CANVAS_H) * 0.22,
    CANVAS_W / 2, CANVAS_H / 2, Math.max(CANVAS_W, CANVAS_H) * 0.75);
  grd.addColorStop(0, 'rgba(200,30,30,0)');
  grd.addColorStop(1, `rgba(190,20,20,${alpha})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

// Derrota: oscurecimiento lento con grietas sutiles; el reverso pausado y
// pesado de la victoria.
function drawDefeatEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  const alpha = Math.min(1, k / 0.5) * 0.55 * Math.max(0, 1 - Math.max(0, (k - 0.75) / 0.25));
  ctx.save();
  ctx.fillStyle = `rgba(12,6,6,${alpha})`;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (!fx.cracks) {
    fx.cracks = Array.from({ length: 5 }, () => ({
      x: Math.random() * CANVAS_W, y: Math.random() * CANVAS_H * 0.6,
      len: 55 + Math.random() * 85, ang: Math.random() * Math.PI * 2,
    }));
  }
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
  ctx.lineWidth = 1.5;
  for (const c of fx.cracks) {
    const grow = Math.min(1, k * 2);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(c.ang) * c.len * grow, c.y + Math.sin(c.ang) * c.len * grow);
    ctx.stroke();
  }
  ctx.restore();
}

// Asignación de grupo: banner que baja con rebote desde arriba.
function drawGroupBanner(ctx, fx) {
  const inK = Math.min(1, fx.t / 0.3);
  const ease = 1 - Math.pow(1 - inK, 3);
  const y = -34 + ease * 56;
  const fade = fx.t > fx.dur - 0.3 ? Math.max(0, (fx.dur - fx.t) / 0.3) : 1;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(CANVAS_W / 2, Math.max(y, 0));
  const w = 280, h = 46, r = 10;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
  ctx.fillStyle = fx.group === 'solid' ? 'rgba(240,197,65,.94)' : 'rgba(45,90,170,.94)';
  ctx.fill();
  ctx.fillStyle = '#12181f';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`¡Juegas con las ${fx.group === 'solid' ? 'lisas' : 'rayadas'}!`, 0, 1);
  ctx.restore();
}

// Sigue tirando: marca discreta y positiva, breve y sin estridencias.
function drawContinueEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.translate(CANVAS_W / 2, 20);
  const s = 1 + k * 0.5;
  ctx.scale(s, s);
  ctx.strokeStyle = '#5fd97a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#5fd97a';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+', 0, -1);
  ctx.restore();
}

// Tomatazo: mancha de tomate a pantalla completa con destello inicial y
// churretes que crecen hacia abajo; un "impacto húmedo" burlón, distinto de
// la viñeta de falta (contenida en las esquinas) y del oscurecer de la derrota.
function drawTomatoEffect(ctx, fx) {
  const k = fx.t / fx.dur;
  if (!fx.blobs) {
    fx.blobs = Array.from({ length: 16 }, () => {
      const cx = Math.random() * CANVAS_W, cy = Math.random() * CANVAS_H * 0.85;
      const R = 30 + Math.random() * 70;
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return { a, r: R * (0.6 + Math.random() * 0.6) };
      });
      return { cx, cy, pts, pip: Math.random() < 0.6 };
    });
    fx.drips = Array.from({ length: 10 }, () => ({
      x: Math.random() * CANVAS_W, len: 40 + Math.random() * 120, w: 6 + Math.random() * 10,
    }));
  }

  const fadeIn = Math.min(1, k / 0.12);
  const fadeOut = k > 0.72 ? Math.max(0, 1 - (k - 0.72) / 0.28) : 1;
  const alpha = fadeIn * fadeOut;

  ctx.save();
  ctx.fillStyle = `rgba(150,25,20,${0.88 * alpha})`;
  for (const b of fx.blobs) {
    ctx.beginPath();
    b.pts.forEach((p, i) => {
      const x = b.cx + Math.cos(p.a) * p.r * fadeIn, y = b.cy + Math.sin(p.a) * p.r * fadeIn;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = `rgba(60,120,40,${0.6 * alpha})`;
  for (const b of fx.blobs) {
    if (!b.pip) continue;
    ctx.beginPath(); ctx.arc(b.cx, b.cy, 4, 0, Math.PI * 2); ctx.fill();
  }
  const grow = Math.min(1, k / 0.5);
  ctx.fillStyle = `rgba(140,20,18,${0.8 * alpha})`;
  for (const d of fx.drips) ctx.fillRect(d.x - d.w / 2, 0, d.w, d.len * grow);
  ctx.restore();

  if (k < 0.12) {
    ctx.save();
    ctx.globalAlpha = (1 - k / 0.12) * 0.7;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- sonido

let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { /* sin sonido */ }
  }
}

function playSound(kind, speed) {
  if (!audioCtx || panicMuted) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  const vol = Math.min(1, (speed || 400) / 900);

  if (kind === 'hit' || kind === 'cushion') {
    const buf = audioCtx.createBuffer(1, 1024, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = kind === 'hit' ? 2400 : 500;
    const gain = audioCtx.createGain();
    gain.gain.value = (kind === 'hit' ? 0.5 : 0.3) * vol;
    src.connect(filt).connect(gain).connect(audioCtx.destination);
    src.start(t);
  } else if (kind === 'pot') {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.18);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.25);
  } else if (kind === 'carom') {
    // arpegio ascendente y brillante, distinto de todo lo demás
    [700, 900, 1200, 1500].forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = audioCtx.createGain();
      const t0 = t + i * 0.055;
      gain.gain.setValueAtTime(0.22, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.22);
    });
  } else if (kind === 'foul') {
    // zumbido corto y descendente, seco
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.32);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.36);
  } else if (kind === 'tomato') {
    // golpe húmedo (ruido filtrado paso-bajo) + "bloop" descendente
    const buf = audioCtx.createBuffer(1, 2048, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.6;
    src.connect(filt).connect(gain).connect(audioCtx.destination);
    src.start(t);
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.28);
    const oGain = audioCtx.createGain();
    oGain.gain.setValueAtTime(0.4, t);
    oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(oGain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.32);
  } else if (kind === 'win') {
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = audioCtx.createGain();
      const t0 = t + i * 0.13;
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.32);
    });
  }
}
