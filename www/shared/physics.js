'use strict';
// Motor de física 2D de billar, compartido entre servidor (Node) y cliente (navegador).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const W = 1000;            // ancho del área de juego
  const H = 500;             // alto del área de juego
  const BALL_R = 11;         // radio de bola
  const FRICTION = 140;      // desaceleración por rodadura (u/s^2)
  const STOP_SPEED = 6;      // por debajo de esto la bola se para
  const CUSHION_REST = 0.9;  // rebote en banda
  const MAX_SHOT_SPEED = 1500;
  const SUBSTEP = 1 / 240;   // paso máximo de integración

  const POCKETS = [
    { x: 0, y: 0, r: 25 },
    { x: W, y: 0, r: 25 },
    { x: 0, y: H, r: 25 },
    { x: W, y: H, r: 25 },
    { x: W / 2, y: -7, r: 21 },
    { x: W / 2, y: H + 7, r: 21 },
  ];

  function nearPocket(x, y, margin) {
    for (const p of POCKETS) {
      const dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < (p.r + margin) * (p.r + margin)) return p;
    }
    return null;
  }

  function pocketAt(x, y) {
    for (const p of POCKETS) {
      const dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) return p;
    }
    return null;
  }

  // Crea las 16 bolas con la piña reglamentaria. `rand` permite barajar (servidor).
  function createBalls(rand) {
    rand = rand || Math.random;
    const solids = [1, 2, 3, 4, 5, 6, 7];
    const stripes = [9, 10, 11, 12, 13, 14, 15];
    shuffle(solids, rand);
    shuffle(stripes, rand);
    // Mezcla ambos grupos y garantiza esquinas traseras de grupos distintos.
    const pool = shuffle(solids.concat(stripes), rand);
    const order = []; // 14 posiciones (la 5ª de la fila 3 es la bola 8)
    for (const id of pool) order.push(id);

    const positions = [];
    const apexX = 0.72 * W, cy = H / 2;
    const dx = BALL_R * 2 * Math.cos(Math.PI / 6) + 0.4;
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i <= r; i++) {
        positions.push({
          x: apexX + r * dx,
          y: cy + (i - r / 2) * (BALL_R * 2 + 0.4),
          row: r, idx: i,
        });
      }
    }
    // Índice de la posición central de la 3ª fila (para la 8) y esquinas traseras.
    const centerIdx = positions.findIndex(p => p.row === 2 && p.idx === 1);
    const backA = positions.findIndex(p => p.row === 4 && p.idx === 0);
    const backB = positions.findIndex(p => p.row === 4 && p.idx === 4);

    const ids = [];
    let k = 0;
    for (let i = 0; i < positions.length; i++) {
      if (i === centerIdx) ids.push(8);
      else ids.push(order[k++]);
    }
    // Esquinas traseras: una lisa y una rayada.
    const isSolid = id => id >= 1 && id <= 7;
    if (isSolid(ids[backA]) === isSolid(ids[backB])) {
      const want = !isSolid(ids[backA]);
      for (let i = 0; i < ids.length; i++) {
        if (i !== centerIdx && i !== backA && isSolid(ids[i]) === want) {
          const t = ids[i]; ids[i] = ids[backB]; ids[backB] = t;
          break;
        }
      }
    }

    const balls = [{ id: 0, x: 0.25 * W, y: H / 2, vx: 0, vy: 0, inPlay: true }];
    for (let i = 0; i < positions.length; i++) {
      balls.push({ id: ids[i], x: positions[i].x, y: positions[i].y, vx: 0, vy: 0, inPlay: true });
    }
    balls.sort((a, b) => a.id - b.id);
    return balls;
  }

  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Aplica el tiro a la bola blanca. power en [0,1].
  function shoot(balls, angle, power) {
    const cue = balls.find(b => b.id === 0);
    if (!cue || !cue.inPlay) return;
    const v = Math.max(0.05, Math.min(1, power)) * MAX_SHOT_SPEED;
    cue.vx = Math.cos(angle) * v;
    cue.vy = Math.sin(angle) * v;
  }

  // Avanza la simulación `dt` segundos. Añade eventos a `events` si se pasa.
  // Devuelve true si todas las bolas están paradas.
  function step(balls, dt, events) {
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      subStep(balls, h, events);
    }
    return allStopped(balls);
  }

  function subStep(balls, h, events) {
    for (const b of balls) {
      if (!b.inPlay) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const dec = FRICTION * h;
        if (sp <= dec || sp < STOP_SPEED) { b.vx = 0; b.vy = 0; }
        else { b.vx -= (b.vx / sp) * dec; b.vy -= (b.vy / sp) * dec; }
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
    }

    // Troneras
    for (const b of balls) {
      if (!b.inPlay) continue;
      if (pocketAt(b.x, b.y)) {
        b.inPlay = false; b.vx = 0; b.vy = 0;
        if (events) events.push({ type: 'pot', id: b.id, x: b.x, y: b.y });
      }
    }

    // Bandas (se ignoran cerca de la boca de una tronera)
    for (const b of balls) {
      if (!b.inPlay) continue;
      const nearP = nearPocket(b.x, b.y, BALL_R * 0.9);
      if (nearP) continue;
      let bounced = 0;
      if (b.x < BALL_R) { b.x = BALL_R; if (b.vx < 0) { b.vx = -b.vx * CUSHION_REST; bounced = Math.abs(b.vx); } }
      else if (b.x > W - BALL_R) { b.x = W - BALL_R; if (b.vx > 0) { b.vx = -b.vx * CUSHION_REST; bounced = Math.abs(b.vx); } }
      if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < 0) { b.vy = -b.vy * CUSHION_REST; bounced = Math.abs(b.vy); } }
      else if (b.y > H - BALL_R) { b.y = H - BALL_R; if (b.vy > 0) { b.vy = -b.vy * CUSHION_REST; bounced = Math.abs(b.vy); } }
      if (bounced > 20 && events) events.push({ type: 'cushion', id: b.id, speed: bounced, x: b.x, y: b.y });
    }

    // Colisiones bola-bola
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.inPlay) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j];
        if (!c.inPlay) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = BALL_R * 2;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        // Separación posicional
        const overlap = (min - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        c.x += nx * overlap; c.y += ny * overlap;
        // Impulso elástico (masas iguales): intercambio de componente normal
        const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (rel > 0) {
          a.vx -= rel * nx; a.vy -= rel * ny;
          c.vx += rel * nx; c.vy += rel * ny;
          if (events) events.push({ type: 'hit', a: a.id, b: c.id, speed: rel, x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
        }
      }
    }
  }

  function allStopped(balls) {
    for (const b of balls) {
      if (b.inPlay && (b.vx !== 0 || b.vy !== 0)) return false;
    }
    return true;
  }

  // Simula un tiro completo de golpe (servidor). Devuelve los eventos.
  function simulateShot(balls, angle, power) {
    const events = [];
    shoot(balls, angle, power);
    let t = 0;
    while (!step(balls, 1 / 60, events)) {
      t += 1 / 60;
      if (t > 40) { // seguridad: nunca debería pasar
        for (const b of balls) { b.vx = 0; b.vy = 0; }
        break;
      }
    }
    return events;
  }

  // Raycast para la línea de puntería: primera bola o banda en la dirección dada.
  function aimRay(balls, ox, oy, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let bestT = Infinity, hitBall = null;
    for (const b of balls) {
      if (!b.inPlay || b.id === 0) continue;
      const rx = b.x - ox, ry = b.y - oy;
      const proj = rx * dx + ry * dy;
      if (proj <= 0) continue;
      const perp2 = (rx * rx + ry * ry) - proj * proj;
      const R2 = (BALL_R * 2) * (BALL_R * 2);
      if (perp2 >= R2) continue;
      const t = proj - Math.sqrt(R2 - perp2);
      if (t > 0 && t < bestT) { bestT = t; hitBall = b; }
    }
    // Bandas
    const walls = [];
    if (dx > 0) walls.push((W - BALL_R - ox) / dx);
    if (dx < 0) walls.push((BALL_R - ox) / dx);
    if (dy > 0) walls.push((H - BALL_R - oy) / dy);
    if (dy < 0) walls.push((BALL_R - oy) / dy);
    for (const t of walls) if (t > 0 && t < bestT) { bestT = t; hitBall = null; }
    if (!isFinite(bestT)) bestT = 0;
    const gx = ox + dx * bestT, gy = oy + dy * bestT;
    let objDir = null;
    if (hitBall) {
      const nx = hitBall.x - gx, ny = hitBall.y - gy;
      const n = Math.hypot(nx, ny) || 1;
      objDir = { x: nx / n, y: ny / n };
    }
    return { x: gx, y: gy, ball: hitBall, objDir };
  }

  // Validación de colocación de bola en mano.
  function canPlaceCue(balls, x, y) {
    if (x < BALL_R || x > W - BALL_R || y < BALL_R || y > H - BALL_R) return false;
    if (nearPocket(x, y, BALL_R)) return false;
    for (const b of balls) {
      if (!b.inPlay || b.id === 0) continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < (BALL_R * 2) * (BALL_R * 2)) return false;
    }
    return true;
  }

  return {
    W, H, BALL_R, POCKETS, MAX_SHOT_SPEED,
    createBalls, shoot, step, simulateShot, allStopped, aimRay, canPlaceCue, pocketAt,
  };
});
