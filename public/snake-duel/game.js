// ============================================================
//  SNAKE DUEL  —  local 2-player snake, pure HTML5 Canvas + JS.
//  No libraries, no asset files. Just open index.html.
//
//  Two snakes share one 32x32 grid and both advance on the same
//  fixed tick. Each snake is a list of {x,y} cells (HEAD = index
//  0). A snake dies if its new head leaves the board, lands on
//  ANY snake's body (its own or the rival's), or both heads swap
//  /collide on the same tick. Last snake standing wins the round;
//  if both die on the same tick it's a draw. Win rounds to take
//  the match (first to TARGET_WINS). Speed ramps slightly as the
//  round goes on. Read step() and the loop at the bottom to see
//  how the simultaneous movement + collision resolution works.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 640 — fixed internal resolution
  const HEIGHT = canvas.height;  // 640 — (CSS scales it to the page)

  // ---- Board config (tweak these to change the feel) ----------
  const COLS = 32;                  // grid is COLS x ROWS cells
  const ROWS = 32;
  const CELL = WIDTH / COLS;        // 20px per cell
  const FOOD_COUNT = 2;             // how many pellets on the board at once

  const START_TICK = 1000 / 9;      // ms per move at round start (~9 moves/sec)
  const MIN_TICK = 1000 / 17;       // fastest allowed (speed cap, stays fair)
  const SPEEDUP = 0.9;              // ms shaved off the tick each food eaten
  const TARGET_WINS = 3;            // best-of: first to this many round wins

  // Two clearly distinct palettes (cyan vs amber) + theme bits.
  const C = {
    grid: 'rgba(140,160,200,0.05)',
    bg: '#0c0f17',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    food: '#ff5d6c',
    foodGlow: 'rgba(255,93,108,0.55)',
  };
  // Per-player colour kit. body1/body2 alternate for a striped look.
  const PLAYERS = [
    { name: 'P1', head: '#36d6ff', body1: '#27a8d6', body2: '#1f86ac', glow: 'rgba(54,214,255,0.5)', eye: '#06212b' },
    { name: 'P2', head: '#ffc24b', body1: '#e89b22', body2: '#bd7c18', glow: 'rgba(255,194,75,0.5)', eye: '#2b1d05' },
  ];

  // ---- Game state ---------------------------------------------
  // states: 'title' | 'playing' | 'roundover' | 'matchover'
  let state = 'title';
  let snakes;         // [snakeP1, snakeP2], each: {body:[{x,y}], dir, queue, alive, score, grow}
  let foods;          // array of {x,y} pellets
  let wins;           // [p1wins, p2wins] across the match
  let round;          // current round number (1-based)
  let tickMs;         // current ms-per-move (shrinks through a round)
  let acc;            // time accumulator for the fixed-step tick
  let foodPulse;      // 0..1 spawn-pop timer (shared, just for juice)
  let deathFlash;     // >0 = white elimination flash, counts down
  let shake;          // >0 = screen-shake magnitude, counts down
  let banner;         // round/winner banner text or ''
  let bannerColor;    // colour for the banner text
  let lastWinner;     // -1 draw, 0 = P1, 1 = P2, null = none yet (for matchover)
  let last;           // timestamp of previous frame

  // ---- Audio (WebAudio, lazy-created on first input) ----------
  // Wrapped so a missing/blocked AudioContext can NEVER break the
  // game — audio is pure garnish.
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
  }
  function blip(freq, dur, type, vol) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      const v = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* ignore — never break the game for a sound */ }
  }
  const sndEat = () => blip(660, 0.08, 'square');
  const sndDie = () => { blip(170, 0.28, 'sawtooth', 0.08); blip(85, 0.4, 'sawtooth', 0.07); };
  const sndStart = () => { blip(520, 0.08, 'triangle'); blip(780, 0.1, 'triangle'); };
  const sndWin = () => { blip(660, 0.1, 'triangle'); blip(880, 0.12, 'triangle'); blip(1175, 0.16, 'triangle'); };

  // ---- Setup / reset ------------------------------------------
  // Build a fresh snake for a player. P1 starts left heading right,
  // P2 starts right heading left — mirrored, length 4.
  function makeSnake(playerIndex) {
    const cy = Math.floor(ROWS / 2);
    let body, dir;
    if (playerIndex === 0) {
      const sx = Math.floor(COLS * 0.25);
      body = [{ x: sx, y: cy }, { x: sx - 1, y: cy }, { x: sx - 2, y: cy }, { x: sx - 3, y: cy }];
      dir = { x: 1, y: 0 };
    } else {
      const sx = Math.floor(COLS * 0.75);
      body = [{ x: sx, y: cy }, { x: sx + 1, y: cy }, { x: sx + 2, y: cy }, { x: sx + 3, y: cy }];
      dir = { x: -1, y: 0 };
    }
    return { body, dir, queue: [], alive: true, score: 0 };
  }

  // Reset only the round (keeps the match win tally).
  function resetRound() {
    snakes = [makeSnake(0), makeSnake(1)];
    foods = [];
    tickMs = START_TICK;
    acc = 0;
    foodPulse = 0;
    deathFlash = 0;
    shake = 0;
    for (let i = 0; i < FOOD_COUNT; i++) spawnFood();
  }

  // Reset the whole match (called from title / rematch).
  function resetMatch() {
    wins = [0, 0];
    round = 1;
    lastWinner = null;
    resetRound();
  }

  // Every occupied cell across both snakes, as a "x,y" Set.
  function occupiedCells() {
    const occ = new Set();
    for (const s of snakes) {
      for (const c of s.body) occ.add(c.x + ',' + c.y);
    }
    return occ;
  }

  // Drop a pellet on a random free cell (avoids snakes + other food).
  function spawnFood() {
    const occ = occupiedCells();
    for (const f of foods) occ.add(f.x + ',' + f.y);
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!occ.has(x + ',' + y)) free.push({ x, y });
      }
    }
    if (free.length === 0) return;          // board full — skip
    foods.push(free[(Math.random() * free.length) | 0]);
    foodPulse = 0;
  }

  // ---- Direction handling -------------------------------------
  // Queue turns and apply one per tick. Reject a 180 (reverse onto
  // the neck = instant death) and duplicates. Compare against the
  // last *queued* dir so chaining two quick turns stays legal.
  function pushDir(s, nx, ny) {
    const lastDir = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    if (nx === -lastDir.x && ny === -lastDir.y) return; // no 180s
    if (nx === lastDir.x && ny === lastDir.y) return;   // no duplicates
    if (s.queue.length < 2) s.queue.push({ x: nx, y: ny }); // small buffer
  }

  // ---- One movement step (both snakes advance simultaneously) -
  // 1) apply each snake's buffered turn and compute its new head.
  // 2) decide growth (did the head land on food?).
  // 3) resolve deaths against the board state, treating both moves
  //    as happening at once — this is what makes head-on crashes
  //    and tail-chasing fair. Then commit surviving moves.
  function step() {
    const alive = snakes.filter(s => s.alive);
    if (alive.length === 0) return;

    // -- 1) apply turns, compute next heads --
    const heads = [];
    for (const s of snakes) {
      if (!s.alive) { heads.push(null); continue; }
      if (s.queue.length) s.dir = s.queue.shift();
      heads.push({ x: s.body[0].x + s.dir.x, y: s.body[0].y + s.dir.y });
    }

    // -- 2) growth decisions (which food, if any, each head eats) --
    const eatIndex = [-1, -1]; // index into foods[] that snake i eats, or -1
    for (let i = 0; i < snakes.length; i++) {
      if (!snakes[i].alive) continue;
      const h = heads[i];
      for (let f = 0; f < foods.length; f++) {
        if (foods[f].x === h.x && foods[f].y === h.y) { eatIndex[i] = f; break; }
      }
    }

    // -- 3) decide who dies (evaluate against the CURRENT bodies) --
    // A snake's own tail will vacate this tick UNLESS it's growing,
    // so the last cell is only solid when grow>0 or it just ate.
    const dead = [false, false];
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive) continue;
      const h = heads[i];

      // wall
      if (h.x < 0 || h.y < 0 || h.x >= COLS || h.y >= ROWS) { dead[i] = true; continue; }

      // body collisions vs BOTH snakes (own + rival)
      for (let j = 0; j < snakes.length; j++) {
        const other = snakes[j];
        // The tail cell moves away this tick unless that snake is
        // growing (it just ate), in which case the whole body is solid.
        const solidLen = eatIndex[j] >= 0 ? other.body.length : other.body.length - 1;
        for (let k = 0; k < solidLen; k++) {
          if (other.body[k].x === h.x && other.body[k].y === h.y) { dead[i] = true; break; }
        }
        if (dead[i]) break;
      }
    }

    // Head-on cases the body check can miss when both move at once:
    //  (a) both new heads land on the same empty cell  -> both die.
    //  (b) heads swap places (pass through each other) -> both die.
    if (alive.length === 2 && snakes[0].alive && snakes[1].alive) {
      const h0 = heads[0], h1 = heads[1];
      if (h0.x === h1.x && h0.y === h1.y) { dead[0] = true; dead[1] = true; }     // (a)
      if (h0.x === snakes[1].body[0].x && h0.y === snakes[1].body[0].y &&
          h1.x === snakes[0].body[0].x && h1.y === snakes[0].body[0].y) {          // (b)
        dead[0] = true; dead[1] = true;
      }
    }

    // -- commit: move survivors, kill the doomed --
    let someoneDied = false;
    let ate = false;
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive) continue;
      if (dead[i]) { s.alive = false; someoneDied = true; continue; }

      // advance: new head on the front
      s.body.unshift({ x: heads[i].x, y: heads[i].y });
      if (eatIndex[i] >= 0) {
        s.score++;           // ate: keep the tail (grow by one), score
        ate = true;
      } else {
        s.body.pop();        // normal move — drop the tail
      }
    }

    // Remove eaten pellets (after commit so indices stay valid),
    // then top the board back up and nudge the speed.
    if (eatIndex[0] >= 0 || eatIndex[1] >= 0) {
      const toRemove = new Set();
      if (eatIndex[0] >= 0) toRemove.add(eatIndex[0]);
      if (eatIndex[1] >= 0) toRemove.add(eatIndex[1]);
      foods = foods.filter((_, idx) => !toRemove.has(idx));
      while (foods.length < FOOD_COUNT) spawnFood();
      tickMs = Math.max(MIN_TICK, tickMs - SPEEDUP * toRemove.size);
    }

    if (ate) sndEat();
    if (someoneDied) { deathFlash = 1; shake = 8; sndDie(); }

    // Round end? (someone just died OR the board emptied of snakes)
    const stillAlive = snakes.filter(s => s.alive);
    if (someoneDied) endRound(stillAlive);
  }

  // Resolve a finished round: figure out winner, bump tallies,
  // raise the banner, and flip to roundover / matchover.
  function endRound(stillAlive) {
    if (stillAlive.length === 1) {
      lastWinner = snakes.indexOf(stillAlive[0]);
      wins[lastWinner]++;
    } else {
      lastWinner = -1; // both died same tick = draw, no point awarded
    }

    if (wins[0] >= TARGET_WINS || wins[1] >= TARGET_WINS) {
      state = 'matchover';
      const champ = wins[0] >= TARGET_WINS ? 0 : 1;
      banner = PLAYERS[champ].name + ' WINS THE MATCH';
      bannerColor = PLAYERS[champ].head;
      sndWin();
    } else {
      state = 'roundover';
      if (lastWinner === -1) { banner = 'DRAW'; bannerColor = C.text; }
      else { banner = PLAYERS[lastWinner].name + ' WINS THE ROUND'; bannerColor = PLAYERS[lastWinner].head; }
    }
  }

  // Advance from roundover to the next round.
  function nextRound() {
    round++;
    resetRound();
    state = 'playing';
    sndStart();
  }

  // ---- Drawing helpers ----------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGrid() {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < COLS; i++) { ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, HEIGHT); }
    for (let j = 1; j < ROWS; j++) { ctx.moveTo(0, j * CELL); ctx.lineTo(WIDTH, j * CELL); }
    ctx.stroke();
  }

  function drawFood() {
    const pop = Math.sin(Math.min(foodPulse, 1) * Math.PI) * 0.18;   // 0->.18->0 on spawn
    const breathe = 0.06 * Math.sin(performance.now() / 220);         // gentle idle pulse
    for (const f of foods) {
      const cx = f.x * CELL + CELL / 2;
      const cy = f.y * CELL + CELL / 2;
      const r = CELL * (0.32 + pop + breathe);
      ctx.save();
      ctx.shadowColor = C.foodGlow;
      ctx.shadowBlur = 14;
      ctx.fillStyle = C.food;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawSnake(s, pal) {
    if (s.body.length === 0) return;
    const pad = 2; // gap inside each cell so segments read as rounded blocks
    // Tail-to-head so the head paints on top.
    for (let i = s.body.length - 1; i >= 0; i--) {
      const c = s.body[i];
      const x = c.x * CELL + pad;
      const y = c.y * CELL + pad;
      const w = CELL - pad * 2;
      const isHead = i === 0;

      if (isHead) {
        ctx.save();
        ctx.shadowColor = pal.glow;
        ctx.shadowBlur = 12;
        ctx.fillStyle = pal.head;
        roundRect(x, y, w, w, 7);
        ctx.fill();
        ctx.restore();
        drawEyes(s, pal);
      } else {
        ctx.fillStyle = i % 2 ? pal.body1 : pal.body2;
        roundRect(x, y, w, w, 5);
        ctx.fill();
      }
    }
  }

  // Two eyes on the head, oriented to face the travel direction.
  function drawEyes(s, pal) {
    const head = s.body[0];
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const off = CELL * 0.22;   // sideways spread
    const fwd = CELL * 0.12;   // forward offset
    const px = -s.dir.y, py = s.dir.x;   // perpendicular axis
    const ex = cx + s.dir.x * fwd;
    const ey = cy + s.dir.y * fwd;
    ctx.fillStyle = pal.eye;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + px * off * sgn, ey + py * off * sgn, CELL * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Reusable centered-text helper with a soft shadow.
  function text(str, x, y, size, color, weight) {
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // HUD: each player's round-score + their win pips, plus the round
  // number centered. Pips show progress toward TARGET_WINS.
  function drawHUD() {
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;

    // P1 (top-left)
    ctx.textAlign = 'left';
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = PLAYERS[0].head;
    ctx.fillText(PLAYERS[0].name + '  ' + snakes[0].score, 14, 12);
    drawPips(0, 14, 34, false);

    // P2 (top-right)
    ctx.textAlign = 'right';
    ctx.fillStyle = PLAYERS[1].head;
    ctx.fillText(snakes[1].score + '  ' + PLAYERS[1].name, WIDTH - 14, 12);
    drawPips(1, WIDTH - 14, 34, true);

    // round number (top-center)
    ctx.textAlign = 'center';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = C.dim;
    ctx.fillText('ROUND ' + round + '  ·  FIRST TO ' + TARGET_WINS, WIDTH / 2, 14);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  // Small filled/empty circles showing a player's match wins.
  function drawPips(pi, anchorX, y, rightAlign) {
    const r = 5, gap = 16;
    for (let i = 0; i < TARGET_WINS; i++) {
      const x = rightAlign ? anchorX - i * gap - r : anchorX + i * gap + r;
      ctx.beginPath();
      ctx.arc(x, y + r, r, 0, Math.PI * 2);
      if (i < wins[pi]) { ctx.fillStyle = PLAYERS[pi].head; ctx.fill(); }
      else { ctx.strokeStyle = PLAYERS[pi].body2; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  function drawOverlay() {
    ctx.fillStyle = 'rgba(8,11,18,0.7)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // ---- The frame ----------------------------------------------
  function draw() {
    ctx.save();

    // Screen-shake: jitter the whole board for a few frames on a kill.
    if (shake > 0) {
      const m = shake;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    // Board background + grid.
    ctx.fillStyle = C.bg;
    ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
    drawGrid();

    drawFood();
    drawSnake(snakes[0], PLAYERS[0]);
    drawSnake(snakes[1], PLAYERS[1]);

    ctx.restore(); // shake should not jitter the HUD/overlays

    drawHUD();

    // Title screen.
    if (state === 'title') {
      drawOverlay();
      text('SNAKE DUEL', WIDTH / 2, HEIGHT * 0.30, 50, PLAYERS[0].head, 800);
      text('Two snakes, one grid — last one alive wins', WIDTH / 2, HEIGHT * 0.43, 17, C.text, 600);
      text('P1 moves with W A S D', WIDTH / 2, HEIGHT * 0.52, 16, PLAYERS[0].head, 600);
      text('P2 moves with the Arrow keys', WIDTH / 2, HEIGHT * 0.57, 16, PLAYERS[1].head, 600);
      text('First to ' + TARGET_WINS + ' rounds takes the match', WIDTH / 2, HEIGHT * 0.65, 15, C.dim, 600);
      text('Press  Space  to start', WIDTH / 2, HEIGHT * 0.75, 20, C.accent, 700);
    }

    // Between-rounds scoreboard.
    if (state === 'roundover') {
      drawOverlay();
      text(banner, WIDTH / 2, HEIGHT * 0.30, 36, bannerColor, 800);
      // scoreboard: wins so far
      text(PLAYERS[0].name, WIDTH * 0.34, HEIGHT * 0.45, 18, PLAYERS[0].head, 700);
      text(PLAYERS[1].name, WIDTH * 0.66, HEIGHT * 0.45, 18, PLAYERS[1].head, 700);
      text(String(wins[0]), WIDTH * 0.34, HEIGHT * 0.54, 46, PLAYERS[0].head, 800);
      text('–', WIDTH * 0.5, HEIGHT * 0.54, 40, C.dim, 700);
      text(String(wins[1]), WIDTH * 0.66, HEIGHT * 0.54, 46, PLAYERS[1].head, 800);
      text('Press  Space  for round ' + (round + 1), WIDTH / 2, HEIGHT * 0.70, 19, C.accent, 700);
    }

    // Match-over screen.
    if (state === 'matchover') {
      drawOverlay();
      const champ = wins[0] >= TARGET_WINS ? 0 : 1;
      text(PLAYERS[champ].name + ' WINS!', WIDTH / 2, HEIGHT * 0.31, 48, PLAYERS[champ].head, 800);
      text('Final score  ' + wins[0] + ' – ' + wins[1], WIDTH / 2, HEIGHT * 0.46, 22, C.text, 700);
      text('A hard-fought duel', WIDTH / 2, HEIGHT * 0.52, 15, C.dim, 600);
      text('Press  Space  for a rematch', WIDTH / 2, HEIGHT * 0.66, 20, C.accent, 700);
    }

    // Elimination flash (white), painted on top and fading out.
    if (deathFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (deathFlash * 0.32) + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  // ---- Main loop ----------------------------------------------
  // Fixed-step movement: accumulate real elapsed time and run
  // step() once per tickMs. Rendering happens every frame so the
  // game stays smooth even when the tick is slow.
  function loop(now) {
    const dt = Math.min(now - last, 100); // clamp big gaps (tab switches)
    last = now;

    if (foodPulse < 1) foodPulse = Math.min(1, foodPulse + dt / 180);
    if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt / 450);
    if (shake > 0) shake = Math.max(0, shake - dt / 45);

    if (state === 'playing') {
      acc += dt;
      // catch up if multiple ticks are due, but state can flip to
      // roundover mid-catch-up, so re-check each pass.
      while (acc >= tickMs && state === 'playing') {
        acc -= tickMs;
        step();
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input --------------------------------------------------
  // P1 = WASD, P2 = Arrow keys. Each maps to a [dx,dy] vector.
  const P1_KEYS = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  const P2_KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first user gesture unlocks WebAudio

    // Space / Enter: start, advance to next round, or rematch.
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === 'title') { resetMatch(); state = 'playing'; sndStart(); }
      else if (state === 'roundover') { nextRound(); }
      else if (state === 'matchover') { resetMatch(); state = 'playing'; sndStart(); }
      return;
    }

    if (state !== 'playing') return;

    const d1 = P1_KEYS[e.code];
    if (d1) { e.preventDefault(); pushDir(snakes[0], d1[0], d1[1]); return; }
    const d2 = P2_KEYS[e.code];
    if (d2) { e.preventDefault(); pushDir(snakes[1], d2[0], d2[1]); }
  });

  // ---- Go -----------------------------------------------------
  // Build a full match behind the title screen so update + render
  // never touch undefined state on load.
  resetMatch();
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
