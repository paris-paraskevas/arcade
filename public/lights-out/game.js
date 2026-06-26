// ============================================================
//  LIGHTS OUT  —  pure HTML5 Canvas + vanilla JS, no assets.
//  Just open index.html (runs straight from file://).
//
//  The board is a 5x5 grid of lights. Clicking a cell FLIPS that
//  cell and its 4 orthogonal neighbours (a "plus" stamp). The goal
//  is to switch every light OFF.
//
//  Why every puzzle is solvable: we start from an all-OFF board and
//  apply a handful of random *valid clicks*. Because a click is its
//  own inverse (clicking the same plus twice cancels out), replaying
//  that exact sequence of clicks returns the board to all-off — so a
//  solution provably exists. We never hand the player a random
//  bit-pattern (half of which are unsolvable on a 5x5 board).
//
//  Read toggle(), scramble() and the loop at the bottom for the gist.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 520 — fixed internal resolution
  const HEIGHT = canvas.height;  // 560 — (CSS scales it to the page)

  // ---- Board layout (tweak these to change the feel) ----------
  const N = 5;                       // 5x5 grid
  const BOARD = 460;                 // pixel size of the board square
  const OX = (WIDTH - BOARD) / 2;    // board origin x (centered)
  const OY = 78;                     // board origin y (room for HUD on top)
  const GAP = 12;                    // gap between cells
  const CELL = (BOARD - GAP * (N - 1)) / N; // size of one cell
  const RAD = 14;                    // cell corner radius

  // How many random clicks to scramble with at each level. More
  // clicks = (usually) a knottier solve. Climbs gently per level.
  const baseScramble = (level) => 3 + Math.min(level, 9);

  // Accent palette + theme bits.
  const C = {
    bg: '#0a0d13',
    panel: 'rgba(255,255,255,0.02)',
    offFill: '#141b27',
    offEdge: 'rgba(159,180,212,0.10)',
    onFill: '#ffd76a',     // warm "lit" core
    onEdge: '#ffe9a8',
    onGlow: 'rgba(255,196,77,0.55)',
    cursor: '#9fb4d4',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    win: '#7ef0b0',
  };

  // ---- Game state ---------------------------------------------
  // States: 'title' | 'playing' | 'won'
  // Initialise EVERYTHING here at load so the title screen's
  // update+render never touch an undefined value (house rule #1).
  let state = 'title';
  let grid;          // N*N array of 0/1 — the logical light states
  let glow;          // N*N array of 0..1 — eased visual brightness
  let moves = 0;     // clicks made on the current puzzle
  let level = 1;     // increments each solve
  let best;          // fewest moves ever to clear a puzzle (localStorage)
  let cursor = { x: 2, y: 2 };  // keyboard cursor position
  let particles = []; // win-flourish sparks
  let winTimer = 0;   // counts up after a win (drives the flourish)
  let titlePulse = 0; // cosmetic timer for the title "press" prompt
  let last = 0;       // timestamp of previous frame

  // ---- High score (localStorage, guarded so it can't crash) ---
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('lightsout.best'), 10);
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch (e) { return null; }
  }
  function saveBest(v) {
    try { localStorage.setItem('lightsout.best', String(v)); } catch (e) { /* ignore */ }
  }
  best = loadBest();

  // ---- Audio (WebAudio, lazily created on the FIRST user input) ----
  // Wrapped so a blocked/missing AudioContext can NEVER break the game.
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
      o.type = type || 'sine';
      o.frequency.value = freq;
      const t = audioCtx.currentTime;
      const v = vol == null ? 0.06 : vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.008); // quick attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* ignore — never break the game for a sound */ }
  }
  // Soft, slightly different click depending on whether the centre
  // light turned on or off — a tiny bit of tactile feedback.
  const sndClick = (turningOn) => blip(turningOn ? 430 : 300, 0.10, 'triangle', 0.05);
  function sndWin() {
    // Little ascending arpeggio.
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.22, 'sine', 0.06), i * 90));
  }

  // ---- Board helpers ------------------------------------------
  const idx = (x, y) => y * N + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  // Flip a cell and its 4 orthogonal neighbours (the "plus" stamp).
  // This is the one and only board mutation — both the player's
  // clicks and the scrambler go through it, which is exactly why
  // generated puzzles stay solvable.
  function stamp(x, y) {
    const deltas = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of deltas) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny)) grid[idx(nx, ny)] ^= 1;
    }
  }

  // A real player move: stamp, count it, play feedback, check win.
  function toggle(x, y) {
    if (state !== 'playing') return;
    const wasOn = grid[idx(x, y)] === 1;
    stamp(x, y);
    moves++;
    sndClick(!wasOn); // centre cell flipped to the opposite of wasOn
    if (isCleared()) win();
  }

  function isCleared() {
    for (let i = 0; i < grid.length; i++) if (grid[i]) return false;
    return true;
  }

  // Build a fresh, guaranteed-solvable puzzle for the given level.
  function scramble() {
    grid = new Array(N * N).fill(0);          // start fully OFF
    const clicks = baseScramble(level);
    // Apply random valid clicks. (We don't bother de-duplicating —
    // duplicates simply cancel, and the result is still solvable.
    // We do loop until the board isn't already solved, so the
    // player never gets a "win" handed to them for free.)
    let guard = 0;
    do {
      grid.fill(0);
      for (let i = 0; i < clicks; i++) {
        stamp((Math.random() * N) | 0, (Math.random() * N) | 0);
      }
      guard++;
    } while (isCleared() && guard < 40);
    moves = 0;
  }

  function newPuzzle() {
    scramble();
    // glow already exists (init at load); sync it to the new board so
    // lights don't all flash on — they ease from their current value.
    if (!glow) glow = new Array(N * N).fill(0);
    particles = [];
    winTimer = 0;
    state = 'playing';
  }

  function win() {
    state = 'won';
    winTimer = 0;
    if (best == null || moves < best) { best = moves; saveBest(best); }
    spawnConfetti();
    sndWin();
  }

  // ---- Win flourish: confetti bursting from the board centre ----
  function spawnConfetti() {
    const cx = OX + BOARD / 2;
    const cy = OY + BOARD / 2;
    const cols = ['#ffd76a', '#7ef0b0', '#9fb4d4', '#ff8fa3', '#7fd1ff'];
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 320;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,   // bias upward
        life: 1,
        size: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        col: cols[(Math.random() * cols.length) | 0],
      });
    }
  }

  // ---- Cell hit-test (canvas pixel -> grid cell, or null) ------
  function cellAt(px, py) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cx = OX + x * (CELL + GAP);
        const cy = OY + y * (CELL + GAP);
        if (px >= cx && px <= cx + CELL && py >= cy && py <= cy + CELL) {
          return { x, y };
        }
      }
    }
    return null;
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

  // Centered-text helper with a soft shadow.
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

  // Mix two #rrggbb colours by t (0..1). Used to fade a cell between
  // its OFF and ON look as the glow eases.
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function drawCell(x, y) {
    const cx = OX + x * (CELL + GAP);
    const cy = OY + y * (CELL + GAP);
    const g = glow[idx(x, y)];          // 0..1 eased brightness
    const breathe = g * (0.5 + 0.5 * Math.sin(performance.now() / 360 + (x + y))); // subtle live shimmer when lit

    // Soft outer glow for lit cells (draw first, behind the cell).
    if (g > 0.02) {
      ctx.save();
      ctx.shadowColor = C.onGlow;
      ctx.shadowBlur = 18 + 14 * g;
      ctx.globalAlpha = 0.9 * g;
      ctx.fillStyle = C.onFill;
      roundRect(cx, cy, CELL, CELL, RAD);
      ctx.fill();
      ctx.restore();
    }

    // The cell face: interpolate fill + edge from OFF to ON.
    ctx.fillStyle = mix(C.offFill, C.onFill, g);
    roundRect(cx, cy, CELL, CELL, RAD);
    ctx.fill();

    // Inner highlight bar — sells the "glassy button" feel and
    // brightens with the glow.
    ctx.save();
    ctx.globalAlpha = 0.10 + 0.35 * g + 0.10 * breathe;
    const grad = ctx.createLinearGradient(cx, cy, cx, cy + CELL);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    roundRect(cx + 4, cy + 4, CELL - 8, CELL * 0.55, RAD - 4);
    ctx.fill();
    ctx.restore();

    // Crisp edge stroke.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = g > 0.5 ? C.onEdge : C.offEdge;
    roundRect(cx, cy, CELL, CELL, RAD);
    ctx.stroke();
  }

  // The keyboard cursor ring (only while playing, to guide arrows).
  function drawCursor() {
    if (state !== 'playing') return;
    const cx = OX + cursor.x * (CELL + GAP);
    const cy = OY + cursor.y * (CELL + GAP);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = C.cursor;
    ctx.globalAlpha = 0.5 + 0.4 * pulse;
    roundRect(cx - 3, cy - 3, CELL + 6, CELL + 6, RAD + 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = C.text;
    ctx.fillText('MOVES ' + moves, 16, 30);

    ctx.textAlign = 'center';
    ctx.fillStyle = C.accent;
    ctx.fillText('LEVEL ' + level, WIDTH / 2, 30);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.dim;
    ctx.fillText(best == null ? 'BEST —' : 'BEST ' + best, WIDTH - 16, 30);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      ctx.restore();
    }
  }

  function drawOverlay(lines, fade) {
    ctx.fillStyle = 'rgba(7,10,16,' + (fade == null ? 0.72 : fade) + ')';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const ln of lines) text(ln.t, WIDTH / 2, ln.y, ln.s, ln.c, ln.w);
  }

  // ---- The frame ----------------------------------------------
  function draw() {
    // Background.
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle board backing panel.
    ctx.fillStyle = C.panel;
    roundRect(OX - 14, OY - 14, BOARD + 28, BOARD + 28, 20);
    ctx.fill();

    drawHUD();

    // All cells.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) drawCell(x, y);
    }
    drawCursor();
    drawParticles();

    // ---- Title screen ----
    if (state === 'title') {
      drawOverlay([
        { t: 'LIGHTS OUT', y: HEIGHT * 0.30, s: 50, c: C.onFill, w: 800 },
        { t: 'Click a light to flip it and its neighbours', y: HEIGHT * 0.46, s: 16, c: C.text, w: 600 },
        { t: 'Turn every light OFF to win', y: HEIGHT * 0.515, s: 15, c: C.dim, w: 500 },
        { t: 'Press  R  or  Enter  to play', y: HEIGHT * 0.64, s: 20, c: pulseColor(), w: 700 },
      ], 0.78);
    }

    // ---- Win screen ---- (drawn semi-transparent so confetti shows)
    if (state === 'won') {
      const f = Math.min(0.6, winTimer * 0.9); // ease the dim in
      ctx.fillStyle = 'rgba(7,10,16,' + f + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      drawParticles(); // re-draw on top of the dim so sparks pop
      text('LIGHTS OUT!', WIDTH / 2, HEIGHT * 0.34, 44, C.win, 800);
      text('Cleared in ' + moves + (moves === 1 ? ' move' : ' moves'), WIDTH / 2, HEIGHT * 0.47, 22, C.text, 700);
      text(best == null ? '' : 'Best  ' + best, WIDTH / 2, HEIGHT * 0.525, 17, C.dim, 600);
      text('Press  R  or  Enter  for the next puzzle', WIDTH / 2, HEIGHT * 0.65, 19, pulseColor(), 700);
    }
  }

  // Gently pulsing accent for "press to play" prompts.
  function pulseColor() {
    const t = 0.5 + 0.5 * Math.sin(titlePulse * 3);
    return mix('#5b6b86', '#bfd2f0', t);
  }

  // ---- Update -------------------------------------------------
  function update(dt) {
    titlePulse += dt / 1000;

    // Ease each cell's visual glow toward its logical 0/1 target.
    // Independent per cell => smooth on/off transitions when a stamp
    // flips a cluster. Approach factor is frame-rate independent.
    if (grid && glow) {
      const k = 1 - Math.pow(0.0001, dt / 1000); // ~smoothing
      for (let i = 0; i < grid.length; i++) {
        glow[i] += (grid[i] - glow[i]) * k;
        if (Math.abs(grid[i] - glow[i]) < 0.001) glow[i] = grid[i];
      }
    }

    // Advance confetti.
    if (particles.length) {
      for (const p of particles) {
        p.vy += 520 * (dt / 1000);          // gravity
        p.x += p.vx * (dt / 1000);
        p.y += p.vy * (dt / 1000);
        p.rot += p.vr * (dt / 1000);
        p.life -= dt / 1400;
      }
      particles = particles.filter(p => p.life > 0 && p.y < HEIGHT + 40);
    }

    if (state === 'won') winTimer += dt / 1000;
  }

  // ---- Main loop ----------------------------------------------
  function loop(now) {
    const dt = Math.min(now - last, 100); // clamp big gaps (tab switches)
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input: keyboard ----------------------------------------
  const MOVE = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first user gesture unlocks WebAudio

    // R / Enter: start from the title, advance after a win, or just
    // deal a fresh puzzle mid-game.
    if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (state === 'won') level++;          // solving advances the level
      newPuzzle();
      return;
    }

    if (state === 'title') return; // ignore movement on the title

    // Arrow / WASD: move the keyboard cursor.
    const m = MOVE[e.code];
    if (m) {
      e.preventDefault();
      if (state === 'playing') {
        cursor.x = Math.max(0, Math.min(N - 1, cursor.x + m[0]));
        cursor.y = Math.max(0, Math.min(N - 1, cursor.y + m[1]));
      }
      return;
    }

    // Space: toggle the cell under the cursor.
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'playing') toggle(cursor.x, cursor.y);
    }
  });

  // ---- Input: mouse -------------------------------------------
  // Translate a DOM click (in CSS pixels) into canvas-internal
  // coordinates — the canvas is scaled down by CSS, so we must
  // rescale the pointer position before hit-testing.
  function canvasPos(evt) {
    const r = canvas.getBoundingClientRect();
    const sx = WIDTH / r.width;
    const sy = HEIGHT / r.height;
    return { x: (evt.clientX - r.left) * sx, y: (evt.clientY - r.top) * sy };
  }

  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    if (state === 'title' || state === 'won') return; // click is play-only
    const p = canvasPos(e);
    const cell = cellAt(p.x, p.y);
    if (cell) {
      cursor.x = cell.x; cursor.y = cell.y; // keep cursor in sync
      toggle(cell.x, cell.y);
    }
  });

  // ---- Go -----------------------------------------------------
  // Build a real, solvable board behind the title screen so the very
  // first frame shows lit cells (never a blank canvas).
  glow = new Array(N * N).fill(0);
  scramble();                 // fills `grid` with a solvable layout
  for (let i = 0; i < glow.length; i++) glow[i] = grid[i]; // pre-light so the title looks alive
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
