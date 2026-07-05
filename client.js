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
let stroke = null;         // { startX, startY, angle } mientras se arrastra el taco
let power = 0;
let oppAim = null;         // ángulo de puntería del rival
let lastAimSent = 0;
let lastFrame = 0;

// ---------------------------------------------------------------- lobby

$('createBtn').addEventListener('click', () => connect({ t: 'create', name: $('nameInput').value }));
$('joinBtn').addEventListener('click', joinFromInput);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromInput(); });

function joinFromInput() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) { $('lobbyError').textContent = 'Introduce el código de la mesa.'; return; }
  connect({ t: 'join', name: $('nameInput').value, room: code });
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
      addChat(null, `${m.name} se ha unido a la mesa.`);
      break;

    case 'start':
      $('overMsg').classList.add('hidden');
      pendingResult = null;
      animating = false;
      break;

    case 'state':
      applyState(m);
      break;

    case 'result':
      if (animating) pendingResult = m;
      else applyState(m);
      break;

    case 'shot': {
      // Animar el tiro localmente (ambos jugadores)
      oppAim = null;
      stroke = null; power = 0; updatePowerBar();
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

function applyState(m) {
  state = m;
  names = m.names.slice();
  balls = m.balls.map(b => ({ ...b, vx: 0, vy: 0 }));
  oppAim = null;
  if (m.msg) addChat(null, m.msg);
  updateHud();

  if (m.phase === 'over') {
    $('overText').textContent = m.msg || 'Fin de la partida';
    $('overMsg').classList.remove('hidden');
    if (m.winner === mySeat) playSound('win');
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
    if (cue) {
      aimAngle = Math.atan2(p.y - cue.y, p.x - cue.x);
      const now = performance.now();
      if (now - lastAimSent > 100 && ws) {
        lastAimSent = now;
        ws.send(JSON.stringify({ t: 'aim', angle: aimAngle }));
      }
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

// ---------------------------------------------------------------- animación

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0);
  lastFrame = ts;

  if (animating) {
    const events = [];
    const stopped = Physics.step(balls, dt, events);
    for (const ev of events) {
      if (ev.type === 'hit' && ev.speed > 30) playSound('hit', ev.speed);
      else if (ev.type === 'cushion') playSound('cushion', ev.speed);
      else if (ev.type === 'pot') playSound('pot');
    }
    if (stopped) {
      animating = false;
      if (pendingResult) {
        const r = pendingResult;
        pendingResult = null;
        applyState(r);
      }
    }
  }

  draw();
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- dibujo

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Marco de madera
  roundRect(0, 0, CANVAS_W, CANVAS_H, 18);
  const wood = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  wood.addColorStop(0, '#7a4a24');
  wood.addColorStop(1, '#5a3416');
  ctx.fillStyle = wood;
  ctx.fill();

  // Paño
  ctx.save();
  ctx.translate(M, M);
  ctx.fillStyle = '#1f7a43';
  ctx.fillRect(-8, -8, Physics.W + 16, Physics.H + 16);
  const felt = ctx.createRadialGradient(
    Physics.W / 2, Physics.H / 2, 100, Physics.W / 2, Physics.H / 2, 700);
  felt.addColorStop(0, 'rgba(255,255,255,.06)');
  felt.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = felt;
  ctx.fillRect(-8, -8, Physics.W + 16, Physics.H + 16);

  // Marcas de mosaico (diamantes) en la madera
  ctx.fillStyle = '#e8d9b0';
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    dot(i * Physics.W / 8, -M / 2 - 4, 3.5);
    dot(i * Physics.W / 8, Physics.H + M / 2 + 4, 3.5);
  }
  for (let i = 1; i <= 3; i++) {
    dot(-M / 2 - 4, i * Physics.H / 4, 3.5);
    dot(Physics.W + M / 2 + 4, i * Physics.H / 4, 3.5);
  }

  // Troneras
  for (const p of Physics.POCKETS) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Guías de puntería
  if (!animating && state && state.phase === 'aim') {
    const cue = cueBall();
    if (cue && !state.ballInHand) {
      if (myTurn()) drawAim(cue, stroke ? stroke.angle : aimAngle, true);
      else if (oppAim !== null) drawAim(cue, oppAim, false);
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

  ctx.restore();
}

function drawAim(cue, angle, mine) {
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

  // Taco (solo el propio, con retroceso según la potencia)
  if (mine) {
    const pull = 14 + power * 90;
    const bx = cue.x - Math.cos(angle) * pull;
    const by = cue.y - Math.sin(angle) * pull;
    const tx = cue.x - Math.cos(angle) * (pull + 260);
    const ty = cue.y - Math.sin(angle) * (pull + 260);
    const g = ctx.createLinearGradient(bx, by, tx, ty);
    g.addColorStop(0, '#d8b06a');
    g.addColorStop(0.7, '#8a5a2a');
    g.addColorStop(1, '#4a2e12');
    ctx.strokeStyle = g;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(x, y, id) {
  const R = Physics.BALL_R;
  ctx.save();

  // Sombra
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fill();

  // Cuerpo
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = id >= 9 ? '#f5f1e8' : BALL_COLORS[id];
  ctx.fill();

  // Banda de las rayadas
  if (id >= 9) {
    ctx.clip();
    ctx.fillStyle = BALL_COLORS[id];
    ctx.fillRect(x - R, y - R * 0.55, R * 2, R * 1.1);
  }

  // Círculo del número
  if (id > 0) {
    ctx.beginPath();
    ctx.arc(x, y, R * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#f5f1e8';
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `bold ${Math.round(R * 0.75)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(id), x, y + 0.5);
  }

  // Brillo
  ctx.beginPath();
  ctx.arc(x - R * 0.35, y - R * 0.4, R * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.fill();

  ctx.restore();
}

function dot(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  if (!audioCtx) return;
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
