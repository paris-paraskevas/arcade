// ============================================================
//  TETRIS  —  pure Canvas + vanilla JS, runs from file://
//  No libraries, no assets. All drawing is procedural; audio is
//  WebAudio built in code and started on first key press.
//
//  The interesting bits are commented for a learner:
//    - the 7-bag randomizer   (fair piece order)
//    - rotation + wall kick    (how pieces turn near walls)
//    - line clearing           (full rows removed, rest shift down)
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 560
  const H = canvas.height;  // 640

  // ---------- Playfield geometry ----------
  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;                 // 10*30 = 300 wide, 20*30 = 600 tall
  const FIELD_W = COLS * CELL;     // 300
  const FIELD_H = ROWS * CELL;     // 600
  const FIELD_X = 24;              // left margin of the board
  const FIELD_Y = (H - FIELD_H) / 2; // vertically centered (20px top/bottom)
  const PANEL_X = FIELD_X + FIELD_W + 26; // side panel starts here

  // ---------- Palette ----------
  // Standard-ish tetromino colors, each distinct.
  const COLORS = {
    I: '#36c5e0', // cyan
    O: '#f5d743', // yellow
    T: '#b06cff', // purple
    S: '#56d364', // green
    Z: '#f0556a', // red
    J: '#5a7bff', // blue
    L: '#ff9e3b', // orange
  };
  const EMPTY = null;
  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';

  // ---------- Tetromino definitions ----------
  // Each piece is a list of rotation states. A state is a list of
  // [x, y] cell offsets relative to the piece's pivot/origin. Pre-baking
  // all 4 rotations keeps the draw/collision code dead simple — we never
  // rotate a matrix at runtime, we just pick the next state in the list.
  const SHAPES = {
    I: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
    O: [
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  };
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // ---------- Game state ----------
  // States: 'title' -> 'playing' <-> 'paused' -> 'over' -> 'playing'
  let state = 'title';
  let grid;            // ROWS x COLS, each cell EMPTY or a color string
  let current;         // active piece: { type, rot, x, y }
  let nextType;        // type of the upcoming piece
  let bag = [];        // 7-bag queue of upcoming types
  let score, lines, level, best;

  // Timing
  let dropTimer = 0;     // ms accumulated toward the next gravity step
  let dropInterval = 1000;
  let lastTime = 0;

  // Line-clear flash effect: rows currently flashing + remaining time
  let flashRows = [];
  let flashTime = 0;
  const FLASH_MS = 180;

  // ---------- High score (localStorage, fail-safe) ----------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('tetris.best') || '0', 10);
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem('tetris.best', String(best)); } catch (e) { /* ignore */ }
  }
  best = loadBest();

  // ---------- 7-bag randomizer ----------
  // Real Tetris doesn't pick pieces at pure random (you could wait ages for
  // an I-piece). Instead it shuffles all 7 types into a "bag", deals them
  // one by one, and reshuffles a fresh bag when empty. Over any 7 pieces you
  // see each type exactly once — fair, but still unpredictable.
  function refillBag() {
    const b = TYPES.slice();
    for (let i = b.length - 1; i > 0; i--) {     // Fisher-Yates shuffle
      const j = (Math.random() * (i + 1)) | 0;
      const t = b[i]; b[i] = b[j]; b[j] = t;
    }
    bag = b;
  }
  function nextFromBag() {
    if (bag.length === 0) refillBag();
    return bag.pop();
  }

  // ---------- Grid helpers ----------
  function makeGrid() {
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      g[r] = new Array(COLS).fill(EMPTY);
    }
    return g;
  }

  // Cells occupied by a piece given a type/rotation/position.
  function cellsOf(type, rot, x, y) {
    const shape = SHAPES[type][rot];
    const out = [];
    for (let i = 0; i < shape.length; i++) {
      out.push([x + shape[i][0], y + shape[i][1]]);
    }
    return out;
  }

  // Would this placement collide with a wall, the floor, or a locked cell?
  function collides(type, rot, x, y) {
    const cells = cellsOf(type, rot, x, y);
    for (let i = 0; i < cells.length; i++) {
      const cx = cells[i][0], cy = cells[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true; // out of bounds (top is allowed)
      if (cy >= 0 && grid[cy][cx] !== EMPTY) return true;  // overlaps a settled block
    }
    return false;
  }

  // ---------- Spawning ----------
  function spawn() {
    const type = nextType;
    nextType = nextFromBag();
    // Spawn near top center. y = -1 lets the piece poke above the field a row.
    current = { type, rot: 0, x: 3, y: -1 };
    // If it can't even appear, it's game over.
    if (collides(current.type, current.rot, current.x, current.y)) {
      gameOver();
    }
  }

  function startGame() {
    grid = makeGrid();
    score = 0; lines = 0; level = 1;
    dropTimer = 0;
    dropInterval = intervalForLevel(level);
    flashRows = []; flashTime = 0;
    refillBag();
    nextType = nextFromBag();
    spawn();
    state = 'playing';
  }

  function gameOver() {
    state = 'over';
    if (score > best) { best = score; saveBest(); }
    blip(140, 0.25, 'sawtooth', 0.18);
  }

  // Gravity interval (ms) per level. Speeds up as you clear lines.
  function intervalForLevel(lv) {
    // Classic-ish curve: starts ~1s, floors near 80ms.
    return Math.max(80, Math.round(1000 * Math.pow(0.82, lv - 1)));
  }

  // ---------- Movement ----------
  function tryMove(dx, dy) {
    if (!collides(current.type, current.rot, current.x + dx, current.y + dy)) {
      current.x += dx;
      current.y += dy;
      return true;
    }
    return false;
  }

  // Rotation with a basic wall kick.
  // We compute the next rotation state, then test the piece in place. If it
  // collides (e.g. it's flush against a wall), we "kick" it by nudging it
  // left, then right, then up by one cell and accept the first offset that
  // fits. If none fit, the rotation is cancelled. This is a simplified kick
  // table — enough to make spins near walls feel right without full SRS.
  function rotate(dir) {
    if (current.type === 'O') return; // square never needs to rotate
    const newRot = (current.rot + (dir > 0 ? 1 : 3)) % 4;
    const kicks = [
      [0, 0],   // try in place first
      [-1, 0],  // nudge left
      [1, 0],   // nudge right
      [-2, 0],  // I-piece sometimes needs a bigger left nudge
      [2, 0],   // ...or right
      [0, -1],  // nudge up
    ];
    for (let i = 0; i < kicks.length; i++) {
      const kx = kicks[i][0], ky = kicks[i][1];
      if (!collides(current.type, newRot, current.x + kx, current.y + ky)) {
        current.rot = newRot;
        current.x += kx;
        current.y += ky;
        blip(330, 0.04, 'square', 0.06);
        return;
      }
    }
    // No kick worked — leave the piece as it was.
  }

  // Soft drop: one row down, tiny score reward.
  function softDrop() {
    if (tryMove(0, 1)) {
      score += 1;
      dropTimer = 0; // reset so it doesn't double-step this frame
    } else {
      lockPiece();
    }
  }

  // Hard drop: fall as far as possible, score per cell, then lock.
  function hardDrop() {
    let dist = 0;
    while (!collides(current.type, current.rot, current.x, current.y + 1)) {
      current.y += 1;
      dist++;
    }
    score += dist * 2;
    blip(180, 0.06, 'square', 0.08);
    lockPiece();
  }

  // ---------- Locking + line clears ----------
  function lockPiece() {
    const cells = cellsOf(current.type, current.rot, current.x, current.y);
    for (let i = 0; i < cells.length; i++) {
      const cx = cells[i][0], cy = cells[i][1];
      if (cy < 0) {                 // a cell locked above the top => topped out
        gameOver();
        return;
      }
      grid[cy][cx] = COLORS[current.type];
    }
    blip(220, 0.05, 'triangle', 0.07);
    clearLines();
    if (state === 'playing') spawn();
  }

  // Find full rows, flash them, score, then collapse everything above.
  function clearLines() {
    const full = [];
    for (let r = 0; r < ROWS; r++) {
      let complete = true;
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === EMPTY) { complete = false; break; }
      }
      if (complete) full.push(r);
    }
    if (full.length === 0) return;

    // Score: classic values, scaled by current level.
    const points = [0, 100, 300, 500, 800][full.length] * level;
    score += points;
    lines += full.length;

    // Rebuild the grid skipping the full rows, then pad empty rows on top.
    // This is the whole "shift everything down" step in one pass.
    const kept = [];
    for (let r = 0; r < ROWS; r++) {
      if (full.indexOf(r) === -1) kept.push(grid[r]);
    }
    while (kept.length < ROWS) {
      kept.unshift(new Array(COLS).fill(EMPTY));
    }
    grid = kept;

    // Level up every 10 lines; gravity gets faster.
    const newLevel = Math.floor(lines / 10) + 1;
    if (newLevel !== level) {
      level = newLevel;
      dropInterval = intervalForLevel(level);
    }

    // Juice: flash the cleared rows; a 4-line "Tetris" gets a brighter sound.
    flashRows = full.slice();
    flashTime = FLASH_MS;
    if (full.length === 4) blip(880, 0.25, 'square', 0.14);
    else blip(520, 0.12, 'square', 0.1);
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
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur); // quick fade
      o.start(now);
      o.stop(now + dur);
    } catch (e) { /* audio must never break the game */ }
  }

  // ---------- Rendering ----------
  function px(col) { return FIELD_X + col * CELL; }
  function py(row) { return FIELD_Y + row * CELL; }

  // Draw a single block with a subtle bevel so it reads as a 3D cell.
  function drawCell(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, CELL, CELL);
    // top/left highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, CELL, 3);
    ctx.fillRect(x, y, 3, CELL);
    // bottom/right shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x, y + CELL - 3, CELL, 3);
    ctx.fillRect(x + CELL - 3, y, 3, CELL);
    // thin separator so adjacent cells stay distinct
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }

  // Ghost piece: an outline at the landing position of the current piece.
  function drawGhost() {
    let gy = current.y;
    while (!collides(current.type, current.rot, current.x, gy + 1)) gy++;
    const cells = cellsOf(current.type, current.rot, current.x, gy);
    ctx.save();
    ctx.strokeStyle = 'rgba(207,214,228,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < cells.length; i++) {
      const cy = cells[i][1];
      if (cy < 0) continue;
      const x = px(cells[i][0]), y = py(cy);
      ctx.strokeRect(x + 2.5, y + 2.5, CELL - 5, CELL - 5);
    }
    ctx.restore();
  }

  function drawBoard() {
    // Board background
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);

    // Faint grid lines
    ctx.strokeStyle = 'rgba(159,180,212,0.06)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(px(c) + 0.5, FIELD_Y);
      ctx.lineTo(px(c) + 0.5, FIELD_Y + FIELD_H);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(FIELD_X, py(r) + 0.5);
      ctx.lineTo(FIELD_X + FIELD_W, py(r) + 0.5);
      ctx.stroke();
    }

    // Settled blocks
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== EMPTY) drawCell(px(c), py(r), grid[r][c]);
      }
    }

    // Line-clear flash overlay (drawn over the rows about to vanish)
    if (flashTime > 0 && flashRows.length) {
      const alpha = Math.max(0, flashTime / FLASH_MS);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.75 * alpha).toFixed(3) + ')';
      for (let i = 0; i < flashRows.length; i++) {
        ctx.fillRect(FIELD_X, py(flashRows[i]), FIELD_W, CELL);
      }
    }

    // Active piece + ghost (only while playing/paused, not during the flash gap)
    if ((state === 'playing' || state === 'paused') && current) {
      drawGhost();
      const cells = cellsOf(current.type, current.rot, current.x, current.y);
      for (let i = 0; i < cells.length; i++) {
        const cy = cells[i][1];
        if (cy < 0) continue;
        drawCell(px(cells[i][0]), py(cy), COLORS[current.type]);
      }
    }

    // Board border
    ctx.strokeStyle = 'rgba(159,180,212,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(FIELD_X - 1, FIELD_Y - 1, FIELD_W + 2, FIELD_H + 2);
  }

  // Small helper to draw a mini piece centered in a preview box.
  function drawPreview(type, boxX, boxY, boxW, boxH) {
    const shape = SHAPES[type][0];
    let minX = 99, maxX = -99, minY = 99, maxY = -99;
    for (let i = 0; i < shape.length; i++) {
      minX = Math.min(minX, shape[i][0]); maxX = Math.max(maxX, shape[i][0]);
      minY = Math.min(minY, shape[i][1]); maxY = Math.max(maxY, shape[i][1]);
    }
    const wCells = maxX - minX + 1;
    const hCells = maxY - minY + 1;
    const mini = 22;
    const ox = boxX + (boxW - wCells * mini) / 2 - minX * mini;
    const oy = boxY + (boxH - hCells * mini) / 2 - minY * mini;
    for (let i = 0; i < shape.length; i++) {
      const x = ox + shape[i][0] * mini;
      const y = oy + shape[i][1] * mini;
      ctx.fillStyle = COLORS[type];
      ctx.fillRect(x, y, mini, mini);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, y, mini, 2); ctx.fillRect(x, y, 2, mini);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(x, y + mini - 2, mini, 2); ctx.fillRect(x + mini - 2, y, 2, mini);
    }
  }

  function label(text, x, y, color, size, weight) {
    ctx.fillStyle = color;
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  function drawPanel() {
    const x = PANEL_X;
    const w = W - PANEL_X - 24; // panel width with right margin
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // NEXT box
    label('NEXT', x, FIELD_Y + 18, MUTED, 12);
    const boxY = FIELD_Y + 28;
    const boxH = 84;
    ctx.fillStyle = 'rgba(159,180,212,0.06)';
    ctx.fillRect(x, boxY, w, boxH);
    ctx.strokeStyle = 'rgba(159,180,212,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, boxY + 0.5, w - 1, boxH - 1);
    if (nextType) drawPreview(nextType, x, boxY, w, boxH);

    // Stats
    let sy = boxY + boxH + 40;
    const stat = (name, val) => {
      label(name, x, sy, MUTED, 12);
      label(String(val), x, sy + 24, TEXT, 22, 700);
      sy += 56;
    };
    stat('SCORE', score);
    stat('BEST', best);
    stat('LEVEL', level);
    stat('LINES', lines);
  }

  // Centered overlay used by title / pause / game-over screens.
  function overlay(lines2) {
    ctx.save();
    ctx.fillStyle = 'rgba(7,9,16,0.82)';
    ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
    ctx.textAlign = 'center';
    const cx = FIELD_X + FIELD_W / 2;
    let cy = FIELD_Y + FIELD_H / 2 - (lines2.length - 1) * 18;
    for (let i = 0; i < lines2.length; i++) {
      const l = lines2[i];
      label(l.t, cx, cy, l.c || TEXT, l.s || 16, l.w || 600);
      cy += (l.gap || 36);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBoard();
    drawPanel();

    ctx.textAlign = 'center';
    if (state === 'title') {
      overlay([
        { t: 'TETRIS', c: ACCENT, s: 34, w: 700, gap: 46 },
        { t: '← →  move      ↓  soft drop', c: TEXT, s: 14, gap: 26 },
        { t: '↑ / X  rotate      Z  rotate ccw', c: TEXT, s: 14, gap: 26 },
        { t: 'Space  hard drop      P  pause', c: TEXT, s: 14, gap: 40 },
        { t: 'Press ENTER to start', c: ACCENT, s: 18, w: 700, gap: 26 },
      ]);
    } else if (state === 'paused') {
      overlay([
        { t: 'PAUSED', c: ACCENT, s: 30, w: 700, gap: 40 },
        { t: 'Press P to resume', c: TEXT, s: 15, gap: 26 },
      ]);
    } else if (state === 'over') {
      overlay([
        { t: 'GAME OVER', c: '#f0556a', s: 30, w: 700, gap: 46 },
        { t: 'Score  ' + score, c: TEXT, s: 18, gap: 30 },
        { t: 'Best  ' + best, c: MUTED, s: 15, gap: 44 },
        { t: 'Press ENTER to play again', c: ACCENT, s: 16, w: 700, gap: 26 },
      ]);
    }
    ctx.textAlign = 'left';
  }

  // ---------- Main loop ----------
  function update(dt) {
    // Tick down the line-clear flash regardless of state-ish logic.
    if (flashTime > 0) {
      flashTime -= dt;
      if (flashTime < 0) flashTime = 0;
    }

    if (state !== 'playing') return;

    // Gravity: accumulate time and step down when we cross the interval.
    dropTimer += dt;
    if (dropTimer >= dropInterval) {
      dropTimer -= dropInterval;
      if (!tryMove(0, 1)) {
        lockPiece(); // can't fall -> lock in place (and maybe clear/spawn)
      }
    }
  }

  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100; // clamp after tab-switch so the piece doesn't teleport
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  const HANDLED = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'];
  document.addEventListener('keydown', (e) => {
    initAudio(); // browsers require a user gesture before audio can play

    const k = e.key;
    // Stop the page from scrolling on arrows / space.
    if (HANDLED.indexOf(k) !== -1) e.preventDefault();

    // Start / restart with ENTER (Space is reserved for hard drop).
    if (k === 'Enter') {
      if (state === 'title' || state === 'over') startGame();
      return;
    }

    if (state === 'title' || state === 'over') return;

    // Pause toggle works any time we're in a game.
    if (k === 'p' || k === 'P') {
      if (state === 'playing') state = 'paused';
      else if (state === 'paused') { state = 'playing'; lastTime = 0; }
      return;
    }

    if (state !== 'playing') return;

    switch (k) {
      case 'ArrowLeft':  tryMove(-1, 0); break;
      case 'ArrowRight': tryMove(1, 0); break;
      case 'ArrowDown':  softDrop(); break;
      case 'ArrowUp':
      case 'x': case 'X': rotate(1); break;   // clockwise
      case 'z': case 'Z': rotate(-1); break;  // counter-clockwise
      case ' ': case 'Spacebar': hardDrop(); break;
      default: break;
    }
  });

  // Pause automatically if the tab loses focus mid-game (feels nicer).
  window.addEventListener('blur', () => {
    if (state === 'playing') state = 'paused';
  });

  // ---------- Go ----------
  grid = makeGrid();        // so the title screen has a board to draw over
  score = 0; lines = 0; level = 1; // so the panel shows 0s, not "undefined", pre-game
  refillBag();
  nextType = nextFromBag();
  requestAnimationFrame(frame);
})();
