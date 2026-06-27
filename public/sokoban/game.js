// ============================================================
//  SOKOBAN  —  pure HTML5 Canvas + vanilla JS, no assets.
//  Just open index.html (runs straight from file://).
//
//  Push every box ($) onto a target (.). You can only PUSH a box,
//  never pull it, and only one box at a time — you cannot shove a
//  box into a wall or into a second box. Solve the grid by parking
//  every box on a goal; the floor highlights as boxes land.
//
//  Levels are hand-authored ASCII maps (see LEVELS below):
//    '#' wall   '@' player   '$' box   '.' target
//    '*' box-on-target   '+' player-on-target   ' ' / '-' floor
//  Each bundled level was checked solvable with a BFS solver.
//
//  Read step(), tryMove() and the loop at the bottom for the gist.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 560 — fixed internal resolution
  const HEIGHT = canvas.height;  // 600 — (CSS scales it to the page)

  // ---- Theme palette ------------------------------------------
  const C = {
    bg: '#0a0d13',
    panel: 'rgba(255,255,255,0.02)',
    floor: '#11161f',
    floorEdge: 'rgba(159,180,212,0.05)',
    wallTop: '#39455c',
    wallSide: '#222b3a',
    wallEdge: 'rgba(0,0,0,0.35)',
    target: '#7fd1ff',
    targetGlow: 'rgba(127,209,255,0.45)',
    box: '#caa46a',          // warm crate
    boxLit: '#7ef0b0',       // box sitting on a target (solved cell)
    boxEdge: '#1c130a',
    player: '#ff8fa3',
    playerEdge: '#5a1f2c',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    win: '#7ef0b0',
  };

  // ---- Levels (hand-designed, increasing difficulty) ----------
  // Stored as arrays of strings. '-' is just a readable floor space.
  // All verified solvable by the BFS solver at the bottom of this file.
  const LEVELS = [
    // 1 — gentle warm-up: two boxes, short pushes.
    [
      '#######',
      '#.    #',
      '#  $  #',
      '#  @  #',
      '#  $  #',
      '#    .#',
      '#######',
    ],
    // 2 — a corridor turn; learn not to corner a box.
    [
      '########',
      '#  .   #',
      '# $$   #',
      '#  @   #',
      '#   .  #',
      '#      #',
      '########',
    ],
    // 3 — classic "push around the post" middle wall.
    [
      '########',
      '#      #',
      '# .##. #',
      '# $  $ #',
      '#  @   #',
      '# .  . #',
      '# $  $ #',
      '#      #',
      '########',
    ],
    // 4 — three boxes, a pillar to route around.
    [
      '#########',
      '#       #',
      '#  ###  #',
      '#  $.$  #',
      '# .$@   #',
      '#   .   #',
      '#       #',
      '#########',
    ],
    // 5 — the famous microban-style room.
    [
      '######',
      '#    #',
      '# .$ #',
      '#  $.#',
      '#.$  #',
      '# $. #',
      '#  @ #',
      '######',
    ],
    // 6 — staggered cluster; you must order the pushes carefully.
    [
      '########',
      '#  .   #',
      '# $$. ##',
      '# .$@  #',
      '## $.  #',
      '#      #',
      '########',
    ],
    // 7 — a longer haul, route boxes across the room.
    [
      '##########',
      '#        #',
      '# .#### . #',
      '# $    $  #',
      '#  @ $    #',
      '# $    .  #',
      '# .####   #',
      '#        #',
      '##########',
    ],
    // 8 — finale: five boxes into the narrow top slots; route with care.
    [
      '#########',
      '#.#.#.#.#',
      '#       #',
      '# $$ $$ #',
      '#   @   #',
      '#  $.   #',
      '#########',
    ],
  ];

  // ---- Game state ---------------------------------------------
  // States: 'title' | 'playing' | 'solved' (between-level flourish) | 'win'
  // Initialise EVERYTHING here at load so the title screen's
  // update+render never touch an undefined value (house rule #1).
  let state = 'title';
  let level = 0;             // index into LEVELS
  let grid = [];             // static map: 0 floor, 1 wall, 2 target
  let boxes = [];            // [{x,y}] live box positions
  let player = { x: 0, y: 0 };
  let rows = 0, cols = 0;    // grid dimensions of the current level
  let moves = 0;             // pushes + steps taken this level
  let pushes = 0;            // boxes pushed (informational)
  let history = [];          // undo stack of move snapshots
  let cell = 48;             // pixel size of one tile (computed per level)
  let originX = 0, originY = 0; // top-left pixel of the board (centered)

  // Cosmetic / juice timers and effects.
  let titlePulse = 0;        // drives the "press to play" pulse
  let solveTimer = 0;        // counts up on a solve (the flourish)
  let particles = [];        // confetti on solve / win
  let shake = 0;             // tiny screen-shake when a push is blocked
  let lastDir = { x: 0, y: -1 }; // facing direction for the player sprite
  let landFlash = [];        // per-box flash when it lands on a target
  let best = null;           // fewest total moves to clear all levels
  let runMoves = 0;          // running move total across the whole run
  let last = 0;              // timestamp of previous frame

  // ---- High score (localStorage, guarded so it can't crash) ---
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('sokoban.best'), 10);
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch (e) { return null; }
  }
  function saveBest(v) {
    try { localStorage.setItem('sokoban.best', String(v)); } catch (e) { /* ignore */ }
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
      const v = vol == null ? 0.05 : vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.008); // quick attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* ignore — never break the game for a sound */ }
  }
  const sndStep = () => blip(180, 0.06, 'sine', 0.025);            // footstep
  const sndPush = () => blip(120, 0.10, 'square', 0.035);          // crate scrape
  const sndBlocked = () => blip(90, 0.10, 'sawtooth', 0.04);       // bonk
  const sndLand = () => blip(660, 0.12, 'triangle', 0.06);         // box on target (click)
  const sndUndo = () => blip(300, 0.08, 'triangle', 0.04);         // rewind
  function sndSolve() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.22, 'sine', 0.06), i * 90));
  }
  function sndWin() {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.30, 'sine', 0.07), i * 110));
  }

  // ---- Map cell codes -----------------------------------------
  const FLOOR = 0, WALL = 1, TARGET = 2;
  const idx = (x, y) => y * cols + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const isWall = (x, y) => !inBounds(x, y) || grid[idx(x, y)] === WALL;
  const isTarget = (x, y) => inBounds(x, y) && grid[idx(x, y)] === TARGET;
  const boxAt = (x, y) => boxes.findIndex(b => b.x === x && b.y === y);

  // ---- Load a level from its ASCII map ------------------------
  // Splits the map into a STATIC grid (walls/targets/floor) and a
  // dynamic list of boxes + the player start. This separation is what
  // lets a box rest "on" a target without losing the target cell.
  function parseLevel(map) {
    rows = map.length;
    cols = map.reduce((m, r) => Math.max(m, r.length), 0);
    grid = new Array(rows * cols).fill(FLOOR);
    boxes = [];
    player = { x: 0, y: 0 };

    for (let y = 0; y < rows; y++) {
      const line = map[y];
      for (let x = 0; x < cols; x++) {
        const ch = line[x] || ' ';
        switch (ch) {
          case '#': grid[idx(x, y)] = WALL; break;
          case '.': grid[idx(x, y)] = TARGET; break;
          case '$': boxes.push({ x, y }); break;
          case '*': grid[idx(x, y)] = TARGET; boxes.push({ x, y }); break;
          case '@': player = { x, y }; break;
          case '+': grid[idx(x, y)] = TARGET; player = { x, y }; break;
          default:  /* ' ' or '-' => floor */ break;
        }
      }
    }
  }

  // Compute tile size + centered origin so the board fills the canvas
  // nicely whatever its dimensions. Leaves a band at the top for the HUD.
  function layout() {
    const hudH = 60;
    const padding = 24;
    const availW = WIDTH - padding * 2;
    const availH = HEIGHT - hudH - padding * 2;
    cell = Math.floor(Math.min(availW / cols, availH / rows));
    const boardW = cell * cols;
    const boardH = cell * rows;
    originX = Math.floor((WIDTH - boardW) / 2);
    originY = Math.floor(hudH + (HEIGHT - hudH - boardH) / 2);
  }

  // Start (or restart) the current level fresh.
  function startLevel() {
    parseLevel(LEVELS[level]);
    layout();
    moves = 0;
    pushes = 0;
    history = [];
    particles = [];
    landFlash = [];
    solveTimer = 0;
    lastDir = { x: 0, y: -1 };
  }

  // ---- Solve detection ----------------------------------------
  function isSolved() {
    for (const b of boxes) if (!isTarget(b.x, b.y)) return false;
    return true;
  }

  // ---- Core move logic (the heart of Sokoban) -----------------
  // Attempt to move the player by (dx,dy). If a box is in the way we
  // push it — but only when the cell beyond it is empty (no wall, no
  // second box). Pulls are impossible by construction.
  function tryMove(dx, dy) {
    if (state !== 'playing') return;
    lastDir = { x: dx, y: dy };

    const nx = player.x + dx, ny = player.y + dy;
    if (isWall(nx, ny)) { bonk(); return; }

    const bi = boxAt(nx, ny);
    if (bi >= 0) {
      // There's a box ahead — can we push it?
      const bx = nx + dx, by = ny + dy;
      if (isWall(bx, by) || boxAt(bx, by) >= 0) { bonk(); return; }

      // Snapshot BEFORE mutating so undo is exact.
      pushHistory();

      const wasOnTarget = isTarget(nx, ny);
      boxes[bi].x = bx; boxes[bi].y = by;
      player.x = nx; player.y = ny;
      moves++; pushes++;

      const nowOnTarget = isTarget(bx, by);
      if (nowOnTarget && !wasOnTarget) {
        // The box just clicked into a goal — flash + click sound.
        landFlash.push({ x: bx, y: by, t: 0 });
        sndLand();
      } else {
        sndPush();
      }
    } else {
      // Plain step into empty floor.
      pushHistory();
      player.x = nx; player.y = ny;
      moves++;
      sndStep();
    }

    if (isSolved()) solve();
  }

  // Tiny feedback when a move is illegal — a bonk + a nudge of shake.
  function bonk() {
    shake = Math.min(shake + 5, 8);
    sndBlocked();
  }

  // Snapshot current state onto the undo stack.
  function pushHistory() {
    history.push({
      px: player.x, py: player.y,
      boxes: boxes.map(b => ({ x: b.x, y: b.y })),
      moves, pushes,
    });
    // Cap the stack so a very long session can't grow without bound.
    if (history.length > 2000) history.shift();
  }

  function undo() {
    if (state !== 'playing' || history.length === 0) return;
    const s = history.pop();
    player.x = s.px; player.y = s.py;
    boxes = s.boxes.map(b => ({ x: b.x, y: b.y }));
    moves = s.moves; pushes = s.pushes;
    sndUndo();
  }

  function solve() {
    state = 'solved';
    solveTimer = 0;
    runMoves += moves;
    spawnConfetti();
    if (level === LEVELS.length - 1) {
      // Last level cleared — record best total moves for the run.
      if (best == null || runMoves < best) { best = runMoves; saveBest(best); }
      if (window.Arcade) Arcade.submitScore('sokoban', runMoves); // total moves across all levels (full run)
      sndWin();
    } else {
      sndSolve();
    }
  }

  // Advance to the next level (or the win screen after the last).
  function advance() {
    if (level === LEVELS.length - 1) {
      state = 'win';
      return;
    }
    level++;
    startLevel();
    state = 'playing';
  }

  // ---- Confetti flourish --------------------------------------
  function spawnConfetti() {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const cols2 = ['#caa46a', '#7ef0b0', '#9fb4d4', '#ff8fa3', '#7fd1ff'];
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 340;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,   // bias upward
        life: 1,
        size: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        col: cols2[(Math.random() * cols2.length) | 0],
      });
    }
  }

  // ---- Drawing helpers ----------------------------------------
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

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

  // Convert a tile coord to its pixel top-left.
  const px = (x) => originX + x * cell;
  const py = (y) => originY + y * cell;

  // ---- Tile draws (with bevels) -------------------------------
  function drawFloor(x, y) {
    const X = px(x), Y = py(y);
    ctx.fillStyle = C.floor;
    ctx.fillRect(X, Y, cell, cell);
    // faint grid lines
    ctx.strokeStyle = C.floorEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(X + 0.5, Y + 0.5, cell - 1, cell - 1);
  }

  function drawWall(x, y) {
    const X = px(x), Y = py(y);
    const b = Math.max(3, cell * 0.12); // bevel depth
    // dark side block
    ctx.fillStyle = C.wallSide;
    ctx.fillRect(X, Y, cell, cell);
    // lighter top face, inset to read as a raised block
    ctx.fillStyle = C.wallTop;
    ctx.fillRect(X, Y, cell - b, cell - b);
    // top + left highlight bevels
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(X, Y, cell - b, b * 0.5);
    ctx.fillRect(X, Y, b * 0.5, cell - b);
    // bottom + right shade
    ctx.fillStyle = C.wallEdge;
    ctx.fillRect(X + cell - b, Y, b, cell);
    ctx.fillRect(X, Y + cell - b, cell, b);
  }

  function drawTarget(x, y) {
    const X = px(x) + cell / 2, Y = py(y) + cell / 2;
    const r = cell * 0.16;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420 + (x + y));
    ctx.save();
    ctx.shadowColor = C.targetGlow;
    ctx.shadowBlur = 8 + 6 * pulse;
    ctx.strokeStyle = C.target;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.stroke();
    // inner dot
    ctx.fillStyle = C.target;
    ctx.globalAlpha = 0.35 + 0.3 * pulse;
    ctx.beginPath();
    ctx.arc(X, Y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBox(b) {
    const X = px(b.x), Y = py(b.y);
    const onT = isTarget(b.x, b.y);
    const inset = Math.max(3, cell * 0.10);
    const w = cell - inset * 2, h = cell - inset * 2;
    const r = Math.max(3, cell * 0.10);

    // landing flash (box just clicked onto a target)
    const fl = landFlash.find(f => f.x === b.x && f.y === b.y);
    const flash = fl ? Math.max(0, 1 - fl.t / 0.35) : 0;

    ctx.save();
    if (onT) {
      ctx.shadowColor = 'rgba(126,240,176,0.55)';
      ctx.shadowBlur = 14 + 16 * flash;
    }
    // crate body
    ctx.fillStyle = onT ? C.boxLit : C.box;
    roundRect(X + inset, Y + inset, w, h, r);
    ctx.fill();
    ctx.restore();

    // bevel: top highlight + bottom shade
    ctx.save();
    ctx.globalAlpha = 0.9;
    const grad = ctx.createLinearGradient(X, Y + inset, X, Y + cell - inset);
    grad.addColorStop(0, 'rgba(255,255,255,0.30)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = grad;
    roundRect(X + inset, Y + inset, w, h, r);
    ctx.fill();
    ctx.restore();

    // diagonal "strapping" lines for crate texture
    ctx.strokeStyle = onT ? 'rgba(10,40,25,0.5)' : 'rgba(28,19,10,0.55)';
    ctx.lineWidth = Math.max(2, cell * 0.05);
    ctx.beginPath();
    ctx.moveTo(X + inset + 4, Y + inset + 4);
    ctx.lineTo(X + cell - inset - 4, Y + cell - inset - 4);
    ctx.moveTo(X + cell - inset - 4, Y + inset + 4);
    ctx.lineTo(X + inset + 4, Y + cell - inset - 4);
    ctx.stroke();

    // crisp edge
    ctx.strokeStyle = onT ? 'rgba(10,40,25,0.7)' : C.boxEdge;
    ctx.lineWidth = 1.5;
    roundRect(X + inset, Y + inset, w, h, r);
    ctx.stroke();

    // a tiny bright tick when freshly landed
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.fillStyle = '#eafff3';
      const cx = X + cell / 2, cy = Y + cell / 2;
      ctx.fillRect(cx - cell * 0.18, cy - 2, cell * 0.36, 4);
      ctx.fillRect(cx - 2, cy - cell * 0.18, 4, cell * 0.36);
      ctx.restore();
    }
  }

  function drawPlayer() {
    const X = px(player.x) + cell / 2, Y = py(player.y) + cell / 2;
    const r = cell * 0.30;
    ctx.save();
    // body
    ctx.shadowColor = 'rgba(255,143,163,0.4)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = C.player;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body highlight
    ctx.save();
    ctx.globalAlpha = 0.35;
    const grad = ctx.createLinearGradient(X, Y - r, X, Y + r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // edge
    ctx.strokeStyle = C.playerEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.stroke();

    // a little "facing" nub showing which way you'd push
    ctx.fillStyle = '#fff';
    const fx = X + lastDir.x * r * 0.55;
    const fy = Y + lastDir.y * r * 0.55;
    ctx.beginPath();
    ctx.arc(fx, fy, Math.max(2, r * 0.18), 0, Math.PI * 2);
    ctx.fill();
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

  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = C.text;
    ctx.fillText('MOVES ' + moves, 18, 30);

    ctx.textAlign = 'center';
    ctx.fillStyle = C.accent;
    ctx.fillText('LEVEL ' + (level + 1) + ' / ' + LEVELS.length, WIDTH / 2, 30);

    // boxes-on-target tally on the right
    let on = 0;
    for (const b of boxes) if (isTarget(b.x, b.y)) on++;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.dim;
    ctx.fillText('BOXES ' + on + ' / ' + boxes.length, WIDTH - 18, 30);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  function drawBoard() {
    // backing panel sized to the board
    const pad = Math.max(8, cell * 0.18);
    ctx.fillStyle = C.panel;
    roundRect(originX - pad, originY - pad, cell * cols + pad * 2, cell * rows + pad * 2, 16);
    ctx.fill();

    // static tiles
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[idx(x, y)];
        if (v === WALL) { drawWall(x, y); continue; }
        drawFloor(x, y);
        if (v === TARGET) drawTarget(x, y);
      }
    }
    // boxes then player on top
    for (const b of boxes) drawBox(b);
    drawPlayer();
  }

  // Gently pulsing accent for "press to play" prompts.
  function pulseColor() {
    const t = 0.5 + 0.5 * Math.sin(titlePulse * 3);
    return mix('#5b6b86', '#bfd2f0', t);
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  // ---- The frame ----------------------------------------------
  function draw() {
    ctx.save();
    // screen-shake offset
    if (shake > 0.2) {
      const a = (Math.random() - 0.5) * shake;
      const bsh = (Math.random() - 0.5) * shake;
      ctx.translate(a, bsh);
    }

    // background
    ctx.fillStyle = C.bg;
    ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);

    drawHUD();
    drawBoard();
    drawParticles();

    // ---- Title screen ----
    if (state === 'title') {
      ctx.fillStyle = 'rgba(7,10,16,0.78)';
      ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
      text('SOKOBAN', WIDTH / 2, HEIGHT * 0.30, 52, C.box, 800);
      text('Push every box onto a glowing target', WIDTH / 2, HEIGHT * 0.45, 17, C.text, 600);
      text('Boxes only push — never pull. Don’t get one stuck!', WIDTH / 2, HEIGHT * 0.505, 14, C.dim, 500);
      text('Arrows / WASD move  ·  U undo  ·  R restart', WIDTH / 2, HEIGHT * 0.57, 14, C.dim, 500);
      text('Press  Space  or  Enter  to play', WIDTH / 2, HEIGHT * 0.68, 20, pulseColor(), 700);
    }

    // ---- Solved (between levels) — semi-transparent so confetti shows ----
    if (state === 'solved') {
      const f = Math.min(0.62, solveTimer * 0.9);
      ctx.fillStyle = 'rgba(7,10,16,' + f + ')';
      ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
      drawParticles();
      text('LEVEL ' + (level + 1) + ' SOLVED', WIDTH / 2, HEIGHT * 0.36, 40, C.win, 800);
      text('in ' + moves + (moves === 1 ? ' move' : ' moves'), WIDTH / 2, HEIGHT * 0.47, 22, C.text, 700);
      const prompt = level === LEVELS.length - 1
        ? 'Press  Space  or  Enter  to finish'
        : 'Press  Space  or  Enter  for the next level';
      text(prompt, WIDTH / 2, HEIGHT * 0.63, 19, pulseColor(), 700);
    }

    // ---- Win screen ----
    if (state === 'win') {
      ctx.fillStyle = 'rgba(7,10,16,0.7)';
      ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);
      drawParticles();
      text('ALL LEVELS CLEARED!', WIDTH / 2, HEIGHT * 0.32, 38, C.win, 800);
      text('Total moves: ' + runMoves, WIDTH / 2, HEIGHT * 0.45, 24, C.text, 700);
      text(best == null ? '' : 'Best run  ' + best + ' moves', WIDTH / 2, HEIGHT * 0.51, 17, C.dim, 600);
      text('Press  Space  or  Enter  to play again', WIDTH / 2, HEIGHT * 0.66, 19, pulseColor(), 700);
    }

    ctx.restore();
  }

  // ---- Update -------------------------------------------------
  function update(dt) {
    const s = dt / 1000;
    titlePulse += s;

    // decay screen-shake
    shake *= Math.pow(0.0025, s);
    if (shake < 0.2) shake = 0;

    // advance landing flashes
    if (landFlash.length) {
      for (const f of landFlash) f.t += s;
      landFlash = landFlash.filter(f => f.t < 0.5);
    }

    // confetti physics
    if (particles.length) {
      for (const p of particles) {
        p.vy += 520 * s;
        p.x += p.vx * s;
        p.y += p.vy * s;
        p.rot += p.vr * s;
        p.life -= dt / 1500;
      }
      particles = particles.filter(p => p.life > 0 && p.y < HEIGHT + 40);
    }

    if (state === 'solved') solveTimer += s;
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

  // Space / Enter starts from the title and advances after a solve/win.
  function confirmKey() {
    if (state === 'title') {
      level = 0; runMoves = 0;
      startLevel();
      state = 'playing';
    } else if (state === 'solved') {
      advance();
    } else if (state === 'win') {
      level = 0; runMoves = 0;
      startLevel();
      state = 'playing';
    }
  }

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first user gesture unlocks WebAudio

    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      confirmKey();
      return;
    }

    if (state !== 'playing') return;

    const m = MOVE[e.code];
    if (m) { e.preventDefault(); tryMove(m[0], m[1]); return; }

    if (e.code === 'KeyU') { e.preventDefault(); undo(); return; }
    if (e.code === 'KeyR') { e.preventDefault(); startLevel(); return; }
  });

  // ---- Input: mouse (click to start / advance) ----------------
  canvas.addEventListener('mousedown', () => {
    ensureAudio();
    if (state !== 'playing') confirmKey();
  });

  // ---- Solvability check (dev aid; runs once, cheap, no UI) ----
  // A BFS over (player, boxes) states. This is ONLY used to assert the
  // bundled levels are winnable — it never blocks gameplay. If a level
  // somehow weren't solvable it logs a warning to the console.
  function verifyLevel(map) {
    // local parse into independent structures (don't touch live state)
    const R = map.length;
    const Cc = map.reduce((m, r) => Math.max(m, r.length), 0);
    const g = new Array(R * Cc).fill(0); // 0 floor,1 wall,2 target
    const bx = [];
    let pStart = -1;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < Cc; x++) {
        const ch = (map[y][x]) || ' ';
        const i = y * Cc + x;
        if (ch === '#') g[i] = 1;
        else if (ch === '.') g[i] = 2;
        else if (ch === '$') bx.push(i);
        else if (ch === '*') { g[i] = 2; bx.push(i); }
        else if (ch === '@') pStart = i;
        else if (ch === '+') { g[i] = 2; pStart = i; }
      }
    }
    const targets = [];
    for (let i = 0; i < g.length; i++) if (g[i] === 2) targets.push(i);
    if (bx.length !== targets.length) return { ok: false, why: 'box/target count mismatch' };

    const wall = (i) => g[i] === 1;
    const tset = new Set(targets);
    const done = (bset) => { for (const b of bset) if (!tset.has(b)) return false; return true; };

    // Dead-square pruning: a non-target square in a wall corner can
    // never hold a box, so any state with a box there is unsolvable.
    const dead = new Set();
    for (let y = 1; y < R - 1; y++) {
      for (let x = 1; x < Cc - 1; x++) {
        const i = y * Cc + x;
        if (g[i] === 1 || tset.has(i)) continue;
        const up = wall(i - Cc), dn = wall(i + Cc), lf = wall(i - 1), rt = wall(i + 1);
        if ((up && lf) || (up && rt) || (dn && lf) || (dn && rt)) dead.add(i);
      }
    }

    const keyOf = (p, bset) => p + '|' + Array.from(bset).sort((a, c) => a - c).join(',');
    const start = { p: pStart, b: new Set(bx) };
    if (done(start.b)) return { ok: true };

    const seen = new Set([keyOf(start.p, start.b)]);
    const queue = [start];
    let head = 0; // pointer instead of shift() — O(1) dequeue keeps it fast
    const dirs = [-Cc, Cc, -1, 1];
    let expansions = 0;
    const LIMIT = 3000000; // generous cap; these levels are tiny

    while (head < queue.length) {
      const cur = queue[head++];
      if (++expansions > LIMIT) return { ok: false, why: 'search limit hit' };
      for (const d of dirs) {
        const np = cur.p + d;
        if (np < 0 || np >= g.length || wall(np)) continue;
        const nb = cur.b;
        if (nb.has(np)) {
          // pushing a box
          const beyond = np + d;
          if (beyond < 0 || beyond >= g.length || wall(beyond) || nb.has(beyond)) continue;
          if (dead.has(beyond)) continue; // pruned dead square
          const b2 = new Set(nb);
          b2.delete(np); b2.add(beyond);
          if (done(b2)) return { ok: true };
          const k = keyOf(np, b2);
          if (!seen.has(k)) { seen.add(k); queue.push({ p: np, b: b2 }); }
        } else {
          // plain walk
          const k = keyOf(np, nb);
          if (!seen.has(k)) { seen.add(k); queue.push({ p: np, b: nb }); }
        }
      }
    }
    return { ok: false, why: 'no solution found' };
  }

  function verifyAll() {
    try {
      LEVELS.forEach((m, i) => {
        const r = verifyLevel(m);
        if (!r.ok) console.warn('[sokoban] Level ' + (i + 1) + ' UNSOLVABLE:', r.why);
      });
    } catch (e) { /* never let a dev check break the game */ }
  }

  // ---- Go -----------------------------------------------------
  // Build a real level behind the title so the first frame already
  // shows a populated board (never a blank canvas — house rule #1).
  best = loadBest();
  level = 0;
  startLevel();
  state = 'title';
  // expose the verifier so a headless harness can call it too
  window.__sokobanVerify = verifyLevel;
  verifyAll();
  last = performance.now();
  requestAnimationFrame(loop);
})();
