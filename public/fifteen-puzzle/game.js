// ============================================================
//  15 PUZZLE  —  pure Canvas + vanilla JS, runs from file://
//  No libraries, no assets. All drawing is procedural; audio is
//  WebAudio built in code and started on the first input.
//
//  Notes for a learner:
//    - The board is just a flat array of 16 numbers (0 = blank).
//      Index i maps to row = i / 4, col = i % 4.
//    - We SHUFFLE by doing many random LEGAL slides from the solved
//      board. That is the safe way: a random permutation of 1..15 is
//      only solvable half the time, but any sequence of real slides
//      always leaves a solvable position.
//    - Each tile remembers the cell it slid FROM so we can smoothly
//      animate it into place (simple lerp + ease-out).
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 460
  const H = canvas.height;  // 560

  // ---------- Board geometry ----------
  const N = 4;                          // 4x4 grid
  const HUD_H = 92;                     // top strip for title + stats
  const PAD = 18;                       // outer padding around the board
  const BOARD = W - PAD * 2;            // board is square, fills the width
  const BOARD_X = PAD;
  const BOARD_Y = HUD_H + (H - HUD_H - BOARD) / 2; // center board below the HUD
  const GAP = 10;                       // gap between tiles
  const CELL = (BOARD - GAP * (N + 1)) / N; // size of one tile cell
  const RADIUS = 9;                     // tile corner radius

  // ---------- Palette ----------
  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';
  const BOARD_BG = '#10141d';
  const EMPTY_CELL = 'rgba(159,180,212,0.06)'; // faint slot under the blank
  const TILE_BG = '#2b3650';            // normal tile
  const TILE_BG_OK = '#2f5d4a';         // tile sitting in its solved spot
  const TILE_TOP = 'rgba(255,255,255,0.10)'; // top highlight

  // ---------- Game state ----------
  // States: 'title' -> 'playing' -> 'won' (Space/Enter/R reshuffles).
  let state = 'title';
  let board;            // flat array length 16; values 0..15 (0 = blank)
  let blank;            // index of the blank cell
  let moves;            // move counter for the current game
  let elapsed;          // seconds elapsed this game
  let running;          // is the timer counting? (true while 'playing')
  let bestMoves, bestTime; // records from localStorage

  // ---------- Animation bookkeeping ----------
  // For each tile we track its current drawn position (ax, ay in cell
  // coords) and where it is heading. While moving, we lerp toward the
  // target. This makes the slide feel smooth without per-tile timers.
  let pos;              // pos[value] = { ax, ay } animated cell coords (col,row floats)
  let SLIDE_SPEED = 14; // cells per second the tile glides (snappy)

  // Win flourish particles + a sweep highlight.
  let particles = [];   // [{x,y,vx,vy,life,max,hue}]
  let winFlash = 0;     // ms of bright flash right after solving
  let winTime = 0;      // ms since the win, drives the sweep animation

  // ---------- High score (localStorage, fail-safe) ----------
  function loadBest() {
    try {
      const m = parseInt(localStorage.getItem('p15.bestMoves') || '0', 10);
      const t = parseInt(localStorage.getItem('p15.bestTime') || '0', 10);
      bestMoves = Number.isFinite(m) && m > 0 ? m : 0;
      bestTime  = Number.isFinite(t) && t > 0 ? t : 0;
    } catch (e) { bestMoves = 0; bestTime = 0; }
  }
  function saveBest() {
    try {
      localStorage.setItem('p15.bestMoves', String(bestMoves));
      localStorage.setItem('p15.bestTime', String(bestTime));
    } catch (e) { /* ignore */ }
  }

  // ---------- Board helpers ----------
  function row(i) { return (i / N) | 0; }
  function col(i) { return i % N; }
  function idx(r, c) { return r * N + c; }

  // Solved board: 1,2,...,15,0  (blank last).
  function makeSolved() {
    const b = new Array(N * N);
    for (let i = 0; i < N * N - 1; i++) b[i] = i + 1;
    b[N * N - 1] = 0;
    return b;
  }

  // The four cells orthogonally adjacent to a given index.
  function neighbors(i) {
    const r = row(i), c = col(i);
    const out = [];
    if (r > 0) out.push(idx(r - 1, c));
    if (r < N - 1) out.push(idx(r + 1, c));
    if (c > 0) out.push(idx(r, c - 1));
    if (c < N - 1) out.push(idx(r, c + 1));
    return out;
  }

  // Swap the blank with a neighbouring tile (the actual slide).
  function swapBlank(tileIndex) {
    board[blank] = board[tileIndex];
    board[tileIndex] = 0;
    blank = tileIndex;
  }

  // Is the board solved? (1..15 in order, blank last)
  function isSolved() {
    for (let i = 0; i < N * N - 1; i++) if (board[i] !== i + 1) return false;
    return board[N * N - 1] === 0;
  }

  // ---------- Shuffle (always solvable) ----------
  // Do a long random walk of legal slides. We avoid immediately undoing
  // the previous slide so the walk actually scrambles the board instead
  // of dithering in place. Finally, guard against the (tiny) chance we
  // landed back on the solved board.
  function shuffle() {
    board = makeSolved();
    blank = N * N - 1;
    let prev = -1; // the cell the blank came from last step
    const STEPS = 250;
    for (let s = 0; s < STEPS; s++) {
      const opts = neighbors(blank).filter((n) => n !== prev);
      const pick = opts[(Math.random() * opts.length) | 0];
      prev = blank;
      swapBlank(pick);
    }
    // Extremely unlikely, but make sure we never start already solved.
    if (isSolved()) {
      const opts = neighbors(blank);
      swapBlank(opts[(Math.random() * opts.length) | 0]);
    }
  }

  // ---------- Animation positions ----------
  // Snap every tile's drawn position to its current board cell (no glide).
  function syncPositions(snap) {
    if (!pos) pos = {};
    for (let i = 0; i < N * N; i++) {
      const v = board[i];
      if (v === 0) continue;
      const target = { ax: col(i), ay: row(i) };
      if (snap || !pos[v]) pos[v] = { ax: target.ax, ay: target.ay };
    }
  }

  // ---------- New game ----------
  function startGame() {
    shuffle();
    moves = 0;
    elapsed = 0;
    running = true;
    particles = [];
    winFlash = 0;
    winTime = 0;
    syncPositions(true);   // tiles appear instantly in their shuffled spots
    state = 'playing';
    blip(300, 0.05, 'square', 0.08);
  }

  // ---------- Try to slide a tile into the blank ----------
  // Accepts a cell index. If it is adjacent to the blank, slide it.
  function trySlide(tileIndex) {
    if (state !== 'playing') return;
    if (tileIndex < 0 || tileIndex >= N * N) return;
    if (board[tileIndex] === 0) return;            // can't slide the blank
    if (neighbors(blank).indexOf(tileIndex) === -1) return; // not adjacent
    swapBlank(tileIndex);
    moves++;
    blip(220 + Math.random() * 40, 0.045, 'square', 0.09); // soft slide click
    if (isSolved()) win();
  }

  // Arrow keys describe which tile slides INTO the blank. e.g. pressing
  // Left moves the tile to the RIGHT of the blank leftward into it.
  function slideByDir(dir) {
    const r = row(blank), c = col(blank);
    let tr = r, tc = c;
    if (dir === 'left')  tc = c + 1;
    else if (dir === 'right') tc = c - 1;
    else if (dir === 'up')    tr = r + 1;
    else if (dir === 'down')  tr = r - 1;
    if (tr < 0 || tr >= N || tc < 0 || tc >= N) return;
    trySlide(idx(tr, tc));
  }

  function win() {
    running = false;
    state = 'won';
    winFlash = 420;
    winTime = 0;
    // Records: fewest moves and fastest time (tracked independently).
    let improved = false;
    if (bestMoves === 0 || moves < bestMoves) { bestMoves = moves; improved = true; }
    const t = Math.ceil(elapsed);
    if (bestTime === 0 || t < bestTime) { bestTime = t; improved = true; }
    if (improved) saveBest();
    if (window.Arcade) Arcade.submitScore('fifteen-puzzle', moves); // fewest moves wins (dir=lo)
    spawnConfetti();
    // little ascending win chime
    blip(523, 0.12, 'triangle', 0.12);
    setTimeout(() => blip(659, 0.12, 'triangle', 0.12), 90);
    setTimeout(() => blip(784, 0.18, 'triangle', 0.12), 180);
    setTimeout(() => blip(1047, 0.22, 'triangle', 0.10), 300);
  }

  function spawnConfetti() {
    particles = [];
    const cx = BOARD_X + BOARD / 2;
    const cy = BOARD_Y + BOARD / 2;
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 220;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        life: 0, max: 0.9 + Math.random() * 0.8,
        hue: (Math.random() * 360) | 0,
        size: 3 + Math.random() * 4,
      });
    }
  }

  // ---------- Audio (WebAudio, created lazily, never throws) ----------
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  function blip(freq, dur, type, vol) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = vol || 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.start(now);
      o.stop(now + dur);
    } catch (e) { /* audio must never break the game */ }
  }

  // ---------- Rendering ----------
  function cellX(c) { return BOARD_X + GAP + c * (CELL + GAP); }
  function cellY(r) { return BOARD_Y + GAP + r * (CELL + GAP); }

  function roundRect(x, y, w, h, rad) {
    const r = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw one numbered tile. `gx, gy` are FLOAT cell coords (col,row), so a
  // mid-slide tile lands between cells. `solvedSpot` tints it green.
  function drawTile(value, gx, gy, solvedSpot, lift) {
    const x = cellX(gx);
    const y = cellY(gy) - (lift || 0);
    // soft drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(x + 2, y + 3, CELL, CELL, RADIUS);
    ctx.fill();
    // body
    roundRect(x, y, CELL, CELL, RADIUS);
    ctx.fillStyle = solvedSpot ? TILE_BG_OK : TILE_BG;
    ctx.fill();
    // top highlight
    ctx.fillStyle = TILE_TOP;
    roundRect(x, y, CELL, CELL * 0.5, RADIUS);
    ctx.fill();
    // number
    ctx.fillStyle = solvedSpot ? '#bfe9d4' : TEXT;
    ctx.font = '700 ' + Math.round(CELL * 0.42) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + CELL / 2, y + CELL / 2 + 1);
  }

  function drawBoardBase() {
    roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 12);
    ctx.fillStyle = BOARD_BG;
    ctx.fill();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        roundRect(cellX(c), cellY(r), CELL, CELL, RADIUS);
        ctx.fillStyle = EMPTY_CELL;
        ctx.fill();
      }
    }
  }

  function drawTiles() {
    // Whether each value is currently in its home cell (for the green tint).
    for (let i = 0; i < N * N; i++) {
      const v = board[i];
      if (v === 0) continue;
      const p = pos[v] || { ax: col(i), ay: row(i) };
      const home = (v === i + 1);
      drawTile(v, p.ax, p.ay, home, 0);
    }
  }

  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ACCENT;
    ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('15', PAD, 50);
    ctx.fillStyle = MUTED;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PUZZLE', PAD + 42, 50);

    // MOVES / TIME stat boxes on the right.
    const boxW = 92, boxH = 54, gap = 10;
    const bx2 = W - PAD - boxW;
    const bx1 = bx2 - gap - boxW;
    drawStatBox(bx1, 18, boxW, boxH, 'MOVES', String(moves), bestLabelMoves());
    drawStatBox(bx2, 18, boxW, boxH, 'TIME', fmtTime(elapsed), bestLabelTime());
  }
  function bestLabelMoves() { return bestMoves > 0 ? 'best ' + bestMoves : ''; }
  function bestLabelTime() { return bestTime > 0 ? 'best ' + fmtTime(bestTime) : ''; }

  function drawStatBox(x, y, w, h, label, value, sub) {
    roundRect(x, y, w, h, 8);
    ctx.fillStyle = 'rgba(159,180,212,0.08)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(label, x + w / 2, y + 16);
    ctx.fillStyle = TEXT;
    ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(value, x + w / 2, y + 36);
    if (sub) {
      ctx.fillStyle = MUTED;
      ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(sub, x + w / 2, y + 49);
    }
    ctx.textAlign = 'left';
  }

  function fmtTime(secs) {
    const s = Math.max(0, Math.floor(secs));
    const m = (s / 60) | 0;
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = Math.max(0, 1 - p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'hsl(' + p.hue + ',85%,62%)';
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // Centered overlay used by title / win screens.
  function overlay(lines, dimAlpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(7,9,16,' + (dimAlpha == null ? 0.82 : dimAlpha) + ')';
    roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 12);
    ctx.fill();
    ctx.textAlign = 'center';
    const cx = BOARD_X + BOARD / 2;
    let cy = BOARD_Y + BOARD / 2 - (lines.length - 1) * 18;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      ctx.fillStyle = l.c || TEXT;
      ctx.font = (l.w || 600) + ' ' + (l.s || 16) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.t, cx, cy);
      cy += (l.gap || 36);
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawHUD();
    drawBoardBase();
    drawTiles();

    // Win sweep: a soft bright bar wipes across the solved board.
    if (state === 'won') {
      const sweep = (winTime % 1400) / 1400;
      const sx = BOARD_X + sweep * BOARD;
      const grad = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
      grad.addColorStop(0, 'rgba(159,233,212,0)');
      grad.addColorStop(0.5, 'rgba(159,233,212,0.18)');
      grad.addColorStop(1, 'rgba(159,233,212,0)');
      ctx.save();
      roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 12);
      ctx.clip();
      ctx.fillStyle = grad;
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD, BOARD);
      ctx.restore();
    }

    drawParticles();

    // Bright flash on the instant of solving.
    if (winFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (winFlash / 420 * 0.35) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'title') {
      overlay([
        { t: '15 PUZZLE', c: ACCENT, s: 38, w: 700, gap: 50 },
        { t: 'Slide the tiles into order', c: TEXT, s: 16, gap: 28 },
        { t: '1 to 15, blank in the corner', c: MUTED, s: 14, gap: 42 },
        { t: 'Click a tile or use Arrow keys', c: TEXT, s: 14, gap: 38 },
        { t: 'Press SPACE or ENTER to start', c: ACCENT, s: 17, w: 700, gap: 26 },
      ]);
    } else if (state === 'won') {
      overlay([
        { t: 'SOLVED!', c: '#7ee0b0', s: 40, w: 700, gap: 50 },
        { t: moves + ' moves  ·  ' + fmtTime(elapsed), c: TEXT, s: 19, gap: 32 },
        { t: 'Best  ' + (bestMoves || '—') + ' moves  ·  ' + (bestTime ? fmtTime(bestTime) : '—'), c: MUTED, s: 14, gap: 44 },
        { t: 'Press SPACE / ENTER / R to play again', c: ACCENT, s: 15, w: 700, gap: 26 },
      ], 0.74);
    }
  }

  // ---------- Main loop ----------
  function update(dt) {
    // dt is in seconds here.
    if (state === 'playing' && running) elapsed += dt;

    // Glide each tile toward its board cell (ease via fixed speed cap).
    if (pos) {
      const step = SLIDE_SPEED * dt;
      for (let i = 0; i < N * N; i++) {
        const v = board[i];
        if (v === 0) continue;
        const p = pos[v];
        if (!p) { pos[v] = { ax: col(i), ay: row(i) }; continue; }
        const tx = col(i), ty = row(i);
        // move a fraction toward target so it eases, but never overshoots
        const dx = tx - p.ax, dy = ty - p.ay;
        const dist = Math.hypot(dx, dy);
        if (dist <= step || dist < 0.002) { p.ax = tx; p.ay = ty; }
        else { p.ax += (dx / dist) * step; p.ay += (dy / dist) * step; }
      }
    }

    if (winFlash > 0) { winFlash -= dt * 1000; if (winFlash < 0) winFlash = 0; }
    if (state === 'won') winTime += dt * 1000;

    // Confetti physics.
    if (particles.length) {
      const G = 360; // gravity px/s^2
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life += dt;
        p.vy += G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      particles = particles.filter((p) => p.life < p.max);
    }
  }

  let lastTime = 0;
  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 1000; // seconds
    lastTime = now;
    if (dt > 0.1) dt = 0.1; // clamp after a tab-switch
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  const ARROW = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
  };
  const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'];

  document.addEventListener('keydown', (e) => {
    initAudio(); // browsers require a user gesture before audio can play
    const k = e.key;
    if (NAV_KEYS.indexOf(k) !== -1) e.preventDefault(); // no page scroll

    // Start / restart from title or win on Space / Enter / R.
    if (k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'r' || k === 'R') {
      if (state === 'title' || state === 'won') { startGame(); return; }
      if (k === 'r' || k === 'R') { startGame(); return; } // R reshuffles mid-game
      // Space/Enter during play do nothing else.
      return;
    }

    if (state !== 'playing') return;
    if (k in ARROW) slideByDir(ARROW[k]);
  });

  // Pointer: figure out which cell was clicked, then try to slide it.
  function handlePoint(clientX, clientY) {
    initAudio();
    if (state === 'title' || state === 'won') { startGame(); return; }
    const rect = canvas.getBoundingClientRect();
    // map CSS pixels back to the canvas's internal resolution
    const x = (clientX - rect.left) * (W / rect.width);
    const y = (clientY - rect.top) * (H / rect.height);
    // which cell?
    const c = Math.floor((x - BOARD_X - GAP / 2) / (CELL + GAP));
    const r = Math.floor((y - BOARD_Y - GAP / 2) / (CELL + GAP));
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    trySlide(idx(r, c));
  }

  canvas.addEventListener('click', (e) => handlePoint(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length) {
      e.preventDefault();
      handlePoint(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  // ---------- Go ----------
  // Initialize EVERY piece of state at load so the title screen draws a
  // valid (already shuffled) board with zeroed stats — nothing undefined.
  loadBest();
  shuffle();              // gives us a valid board + blank for the title bg
  moves = 0;
  elapsed = 0;
  running = false;        // timer is paused until the player starts
  pos = {};
  particles = [];
  winFlash = 0;
  winTime = 0;
  syncPositions(true);
  state = 'title';
  requestAnimationFrame(frame);
})();
