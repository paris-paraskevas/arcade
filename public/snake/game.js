// ============================================================
//  SNAKE  —  the classic, in pure HTML5 Canvas + vanilla JS.
//  No libraries, no asset files. Just open index.html.
//
//  How it works: the board is a 24x24 grid. The snake is a list
//  of {x,y} cells; the HEAD is index 0. On each "tick" we add a
//  new head one step in the current direction and drop the tail
//  (unless we just ate, in which case the tail stays and the
//  snake grows). Rendering & input run every animation frame,
//  but movement only advances on the tick timer — that split is
//  what makes the motion feel grid-crisp instead of jittery.
//  Read step() and the game loop at the bottom to see it all.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 600 — fixed internal resolution
  const HEIGHT = canvas.height;  // 600 — (CSS scales it to the page)

  // ---- Board config (tweak these to change the feel) ----------
  const COLS = 24;                  // grid is COLS x ROWS cells
  const ROWS = 24;
  const CELL = WIDTH / COLS;        // 25px per cell

  const START_TICK = 1000 / 8;      // ms per move at start (~8 moves/sec)
  const MIN_TICK = 1000 / 18;       // fastest allowed (speed cap, stays playable)
  const SPEEDUP = 3;                // ms shaved off the tick per food eaten

  // Accent colours (greens) + theme bits
  const C = {
    grid: 'rgba(120,170,150,0.06)',
    bg: '#0c1812',
    head: '#3ddc84',
    body1: '#2bb673',
    body2: '#23985f',
    food: '#ff5d6c',
    foodGlow: 'rgba(255,93,108,0.5)',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
  };

  // ---- Game state ---------------------------------------------
  // States: 'title' | 'playing' | 'dead'
  let state = 'title';
  let snake;          // array of {x,y}, snake[0] is the head
  let dir;            // current direction {x,y}
  let queue;          // buffered turns (so fast presses aren't lost)
  let food;           // {x,y} or null
  let score, best;
  let tickMs;         // current ms-per-move (shrinks as you eat)
  let acc;            // time accumulator for the fixed-step tick
  let foodPulse;      // 0..1 animation timer for the food pop
  let deathFlash;     // >0 = show red death flash, counts down
  let last;           // timestamp of previous frame

  // ---- High score (localStorage, guarded so it can't crash) ---
  function loadBest() {
    try { return parseInt(localStorage.getItem('snake.best'), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('snake.best', String(v)); } catch (e) { /* ignore */ }
  }
  best = loadBest();

  // ---- Audio (WebAudio, lazy-created on first input) ----------
  // Everything is wrapped so a missing/blocked AudioContext can
  // NEVER break the game — audio is pure garnish.
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
  }
  function blip(freq, dur, type) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = 0.06;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* ignore — never break the game for a sound */ }
  }
  const sndEat = () => blip(660, 0.09, 'square');
  const sndDie = () => { blip(180, 0.25, 'sawtooth'); blip(90, 0.35, 'sawtooth'); };

  // ---- Setup / reset ------------------------------------------
  function resetGame() {
    // Start as a length-3 snake near the middle, heading right.
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    dir = { x: 1, y: 0 };
    queue = [];
    score = 0;
    tickMs = START_TICK;
    acc = 0;
    foodPulse = 0;
    deathFlash = 0;
    spawnFood();
  }

  // Pick a random cell that the snake doesn't occupy.
  function spawnFood() {
    const occupied = new Set(snake.map(s => s.x + ',' + s.y));
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!occupied.has(x + ',' + y)) free.push({ x, y });
      }
    }
    if (free.length === 0) { food = null; return; } // board full = win-ish
    food = free[(Math.random() * free.length) | 0];
    foodPulse = 0;
  }

  // ---- Direction handling -------------------------------------
  // We queue turns and apply one per tick. A turn is rejected if
  // it would reverse straight back onto the neck (instant death
  // otherwise). We compare against the last *queued* direction so
  // chaining two quick turns (e.g. up then left) stays legal.
  function pushDir(nx, ny) {
    const lastDir = queue.length ? queue[queue.length - 1] : dir;
    if (nx === -lastDir.x && ny === -lastDir.y) return; // no 180s
    if (nx === lastDir.x && ny === lastDir.y) return;   // no duplicates
    if (queue.length < 2) queue.push({ x: nx, y: ny }); // small buffer
  }

  // ---- One movement step --------------------------------------
  function step() {
    if (queue.length) dir = queue.shift(); // apply the next buffered turn

    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    // Wall collision.
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die();

    // Self collision. The current tail cell is about to move, so
    // it's only a real hit if we're NOT growing into it this tick.
    const eating = food && nx === food.x && ny === food.y;
    const checkLen = eating ? snake.length : snake.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (snake[i].x === nx && snake[i].y === ny) return die();
    }

    // Move: new head on the front.
    snake.unshift({ x: nx, y: ny });

    if (eating) {
      score++;
      if (score > best) { best = score; saveBest(best); }
      tickMs = Math.max(MIN_TICK, tickMs - SPEEDUP); // nudge faster
      sndEat();
      spawnFood();
      // (tail kept — snake grew by one)
    } else {
      snake.pop(); // drop the tail — length unchanged
    }
  }

  function die() {
    state = 'dead';
    deathFlash = 1;       // start the red flash (fades in draw())
    sndDie();
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
    for (let i = 1; i < COLS; i++) {
      ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, HEIGHT);
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.moveTo(0, j * CELL); ctx.lineTo(WIDTH, j * CELL);
    }
    ctx.stroke();
  }

  function drawFood() {
    if (!food) return;
    // Pulsing pellet: radius eases up then settles, plus a soft glow.
    const cx = food.x * CELL + CELL / 2;
    const cy = food.y * CELL + CELL / 2;
    const pop = Math.sin(Math.min(foodPulse, 1) * Math.PI) * 0.18; // 0->.18->0 on spawn
    const breathe = 0.06 * Math.sin(performance.now() / 220);      // gentle idle pulse
    const r = CELL * (0.30 + pop + breathe);

    ctx.save();
    ctx.shadowColor = C.foodGlow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = C.food;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake() {
    const pad = 2; // gap inside each cell so segments read as rounded blocks
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const x = s.x * CELL + pad;
      const y = s.y * CELL + pad;
      const w = CELL - pad * 2;
      const isHead = i === 0;

      ctx.fillStyle = isHead ? C.head : (i % 2 ? C.body1 : C.body2);
      roundRect(x, y, w, w, isHead ? 8 : 6);
      ctx.fill();

      if (isHead) drawEyes(s);
    }
  }

  // Two little eyes on the head, oriented to face the travel dir.
  function drawEyes(head) {
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const off = CELL * 0.20;  // sideways spread of the eyes
    const fwd = CELL * 0.14;  // how far forward they sit
    // Perpendicular axis to the direction, for left/right placement.
    const px = -dir.y, py = dir.x;
    const ex = cx + dir.x * fwd;
    const ey = cy + dir.y * fwd;

    ctx.fillStyle = '#0c1812';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + px * off * sgn, ey + py * off * sgn, CELL * 0.09, 0, Math.PI * 2);
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

  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = C.text;
    ctx.fillText('SCORE ' + score, 14, 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.dim;
    ctx.fillText('BEST ' + best, WIDTH - 14, 12);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  function drawOverlay(lines) {
    // Dim the board so overlay text pops.
    ctx.fillStyle = 'rgba(8,14,11,0.66)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const ln of lines) text(ln.t, WIDTH / 2, ln.y, ln.s, ln.c, ln.w);
  }

  // ---- The frame --------------------------------------------------
  function draw() {
    // Board background + grid.
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawGrid();

    drawFood();
    drawSnake();
    drawHUD();

    // Title screen.
    if (state === 'title') {
      drawOverlay([
        { t: 'SNAKE', y: HEIGHT * 0.34, s: 54, c: C.head, w: 800 },
        { t: 'Arrow keys or WASD to turn', y: HEIGHT * 0.50, s: 17, c: C.text, w: 600 },
        { t: "Don't hit the walls or yourself", y: HEIGHT * 0.555, s: 15, c: C.dim, w: 500 },
        { t: 'Press  Space  to play', y: HEIGHT * 0.66, s: 20, c: C.accent, w: 700 },
      ]);
    }

    // Game-over screen.
    if (state === 'dead') {
      drawOverlay([
        { t: 'GAME OVER', y: HEIGHT * 0.34, s: 46, c: C.food, w: 800 },
        { t: 'Score  ' + score, y: HEIGHT * 0.49, s: 22, c: C.text, w: 700 },
        { t: 'Best  ' + best, y: HEIGHT * 0.545, s: 18, c: C.dim, w: 600 },
        { t: 'Press  Space  to play again', y: HEIGHT * 0.66, s: 20, c: C.accent, w: 700 },
      ]);
    }

    // Red death flash, painted on top and fading out.
    if (deathFlash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (deathFlash * 0.5) + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  // ---- Main loop ----------------------------------------------
  // Fixed-step movement: we accumulate real elapsed time and run
  // step() once per tickMs. Rendering happens every frame, so the
  // game stays smooth even if the tick is slow.
  function loop(now) {
    const dt = Math.min(now - last, 100); // clamp big gaps (tab switches)
    last = now;

    if (foodPulse < 1) foodPulse = Math.min(1, foodPulse + dt / 180);
    if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt / 450);

    if (state === 'playing') {
      acc += dt;
      // while-loop catches up if multiple ticks are due, but state
      // can flip to 'dead' mid-catch-up, so re-check each pass.
      while (acc >= tickMs && state === 'playing') {
        acc -= tickMs;
        step();
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input --------------------------------------------------
  const KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first user gesture unlocks WebAudio

    // Space: start from title, or restart after death.
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'title' || state === 'dead') {
        resetGame();
        state = 'playing';
      }
      return;
    }

    const d = KEYS[e.code];
    if (d) {
      e.preventDefault();
      if (state === 'playing') pushDir(d[0], d[1]);
    }
  });

  // ---- Go -----------------------------------------------------
  resetGame();          // build a board behind the title screen
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
