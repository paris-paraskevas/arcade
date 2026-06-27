// ============================================================
//  2048  —  pure Canvas + vanilla JS, runs from file://
//  No libraries, no assets. All drawing is procedural; audio is
//  WebAudio built in code and started on the first key press.
//
//  The interesting bits are commented for a learner:
//    - the slide+merge of a single line (the whole game in one
//      function, reused for all four directions via rotation)
//    - tile animations (each tile knows where it slid FROM, so we
//      can interpolate it into place; merges get a little pop)
//    - "only spawn if the board actually changed"
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 500
  const H = canvas.height;  // 600

  // ---------- Board geometry ----------
  const N = 4;                       // 4x4 grid
  const HUD_H = 96;                  // top strip for title + scores
  const PAD = 18;                    // outer padding around the board
  const BOARD = W - PAD * 2;         // board is square, fills the width
  const BOARD_X = PAD;
  const BOARD_Y = HUD_H + (H - HUD_H - BOARD) / 2; // center board below the HUD
  const GAP = 12;                    // gap between cells
  const CELL = (BOARD - GAP * (N + 1)) / N; // size of one tile cell
  const RADIUS = 8;                  // tile corner radius

  // ---------- Palette ----------
  // Classic warm 2048 tile colors. Each value gets its own swatch;
  // anything above 2048 reuses the top (dark) swatch.
  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';
  const BOARD_BG = '#15110c';        // warm dark board backing
  const EMPTY_CELL = 'rgba(238,228,218,0.10)'; // faint slot for empty cells

  // value -> { bg, fg }. fg flips to white once the tiles get dark.
  const TILE_STYLES = {
    2:    { bg: '#eee4da', fg: '#6b5b4b' },
    4:    { bg: '#ede0c8', fg: '#6b5b4b' },
    8:    { bg: '#f2b179', fg: '#ffffff' },
    16:   { bg: '#f59563', fg: '#ffffff' },
    32:   { bg: '#f67c5f', fg: '#ffffff' },
    64:   { bg: '#f65e3b', fg: '#ffffff' },
    128:  { bg: '#edcf72', fg: '#ffffff' },
    256:  { bg: '#edcc61', fg: '#ffffff' },
    512:  { bg: '#edc850', fg: '#ffffff' },
    1024: { bg: '#edc53f', fg: '#ffffff' },
    2048: { bg: '#edc22e', fg: '#ffffff' },
  };
  const SUPER_STYLE = { bg: '#3c3a32', fg: '#ffffff' }; // for >2048
  function styleFor(v) { return TILE_STYLES[v] || SUPER_STYLE; }
  // Smaller font for longer numbers so they always fit in the cell.
  function fontSizeFor(v) {
    if (v < 100) return Math.round(CELL * 0.42);
    if (v < 1000) return Math.round(CELL * 0.36);
    if (v < 10000) return Math.round(CELL * 0.30);
    return Math.round(CELL * 0.24);
  }

  // ---------- Game state ----------
  // States: 'title' -> 'playing' -> 'over' (R/Enter restarts).
  // 'won' is tracked separately so you can keep playing past 2048.
  let state = 'title';
  let grid;            // N x N, each cell 0 (empty) or a tile value
  let score, best;
  let hasWon;          // showed the win banner already?
  let keepGoing;       // player dismissed the win banner and kept playing

  // ---------- Animation bookkeeping ----------
  // After a move we don't snap tiles to their new cells instantly — we
  // remember, for each moving tile, where it came from and animate it
  // there. `anims` holds those moving sprites for the duration of one
  // slide; `spawn`/`pop` give freshly-created and merged tiles a little
  // scale bounce. While `animTime > 0` we draw `anims` instead of `grid`.
  let anims = [];          // [{ value, fromR, fromC, toR, toC, merged }]
  let spawnAnim = null;    // { r, c, value } — the tile that just appeared
  let animTime = 0;        // ms remaining in the current slide animation
  const ANIM_MS = 90;      // slide duration (snappy)
  const POP_MS = 110;      // merge/spawn pop duration
  let popTime = 0;         // ms remaining for pop bounces

  // ---------- High score (localStorage, fail-safe) ----------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('p2048.best') || '0', 10);
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem('p2048.best', String(best)); } catch (e) { /* ignore */ }
  }

  // ---------- Grid helpers ----------
  function makeGrid() {
    const g = new Array(N);
    for (let r = 0; r < N; r++) g[r] = new Array(N).fill(0);
    return g;
  }
  function emptyCells() {
    const out = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (grid[r][c] === 0) out.push([r, c]);
    return out;
  }
  // Spawn a 2 (90%) or 4 (10%) in a random empty cell. Returns the cell
  // so the renderer can give it a spawn pop, or null if the board is full.
  function spawnTile() {
    const cells = emptyCells();
    if (cells.length === 0) return null;
    const [r, c] = cells[(Math.random() * cells.length) | 0];
    const value = Math.random() < 0.9 ? 2 : 4;
    grid[r][c] = value;
    return { r, c, value };
  }

  // ---------- The core move logic ----------
  // We only ever solve ONE case: sliding a single row to the LEFT.
  // Every other direction is the same operation on a rotated copy of the
  // board, which we rotate back afterwards. This keeps the tricky merge
  // rule (each tile merges at most once per move) in a single place.
  //
  // Returns { line, gained, moves } where:
  //   line   = the resulting row (length N, zeros padded on the right)
  //   gained = score earned from merges in this row
  //   moves  = mapping of source index -> destination index for animation
  function slideLeft(row) {
    // 1) pull non-zero values to the front, remembering their origin column
    const vals = [];      // surviving values, in order
    const origins = [];   // original column index for each value
    for (let c = 0; c < N; c++) {
      if (row[c] !== 0) { vals.push(row[c]); origins.push(c); }
    }
    // 2) merge equal neighbours once, left to right
    const out = [];
    const moves = [];     // { from, to, merged } per source tile
    let gained = 0;
    let i = 0;
    while (i < vals.length) {
      if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
        const sum = vals[i] * 2;
        const dest = out.length;
        out.push(sum);
        gained += sum;
        // both source tiles travel to `dest`; the second one is the merger
        moves.push({ from: origins[i], to: dest, merged: false });
        moves.push({ from: origins[i + 1], to: dest, merged: true });
        i += 2;
      } else {
        const dest = out.length;
        out.push(vals[i]);
        moves.push({ from: origins[i], to: dest, merged: false });
        i += 1;
      }
    }
    while (out.length < N) out.push(0);
    return { line: out, gained, moves };
  }

  // Read a "line" out of the grid for a given direction, as if we were
  // always sliding left. dir: 0=left,1=right,2=up,3=down. `idx` is which
  // line (row for left/right, column for up/down). Returns the cells in
  // slide order plus the (r,c) each came from so we can map animations.
  function readLine(dir, idx) {
    const cells = [];   // values in slide order
    const coords = [];  // matching [r,c] in slide order
    for (let k = 0; k < N; k++) {
      let r, c;
      if (dir === 0) { r = idx; c = k; }            // left:  scan columns L->R
      else if (dir === 1) { r = idx; c = N - 1 - k; } // right: scan columns R->L
      else if (dir === 2) { r = k; c = idx; }       // up:    scan rows T->B
      else { r = N - 1 - k; c = idx; }              // down:  scan rows B->T
      cells.push(grid[r][c]);
      coords.push([r, c]);
    }
    return { cells, coords };
  }
  // Inverse of readLine: write slide-order index `k` back to a grid cell.
  function lineCoord(dir, idx, k) {
    if (dir === 0) return [idx, k];
    if (dir === 1) return [idx, N - 1 - k];
    if (dir === 2) return [k, idx];
    return [N - 1 - k, idx];
  }

  // Perform a full move in a direction. Builds the new grid, the list of
  // tile animations, the score gained, and whether anything actually moved.
  function move(dir) {
    const newGrid = makeGrid();
    const newAnims = [];
    let gained = 0;
    let changed = false;

    for (let idx = 0; idx < N; idx++) {
      const { cells, coords } = readLine(dir, idx);
      const res = slideLeft(cells);

      // Write the merged line back into the new grid.
      for (let k = 0; k < N; k++) {
        const [r, c] = lineCoord(dir, idx, k);
        newGrid[r][c] = res.line[k];
      }

      // Did this line change at all? (compare to the pre-move line)
      for (let k = 0; k < N; k++) {
        if (cells[k] !== res.line[k]) { changed = true; break; }
      }

      // Build animations: each source tile slides from its old cell to the
      // destination cell. `from`/`to` here are slide-order indices.
      for (let m = 0; m < res.moves.length; m++) {
        const mv = res.moves[m];
        const [fr, fc] = coords[mv.from];          // where it started
        const [tr, tc] = lineCoord(dir, idx, mv.to); // where it lands
        newAnims.push({
          value: cells[mv.from],
          fromR: fr, fromC: fc,
          toR: tr, toC: tc,
          merged: mv.merged,
          mergedValue: res.line[mv.to], // value shown once it lands
        });
      }
      gained += res.gained;
    }

    if (!changed) return false; // IMPORTANT: no change => no spawn, no sound

    grid = newGrid;
    score += gained;
    if (score > best) { best = score; saveBest(); }

    // Kick off the slide animation; tiles are drawn from `anims` until it ends.
    anims = newAnims;
    animTime = ANIM_MS;

    // Spawn one new tile in an empty cell (90% 2 / 10% 4).
    spawnAnim = spawnTile();

    // Win check (once). You can keep playing afterwards.
    if (!hasWon && reached2048()) {
      hasWon = true;
      blip(880, 0.18, 'triangle', 0.14);
      blip(1320, 0.22, 'triangle', 0.10);
    }

    // Sounds: a soft slide tick, plus a brighter blip if a merge happened.
    if (gained > 0) blip(330 + Math.min(gained, 1024) * 0.2, 0.07, 'square', 0.10);
    else blip(180, 0.04, 'sine', 0.05);

    // After the slide settles, the merged/spawned tiles get a pop.
    popTime = POP_MS;

    // Game-over check happens once the board is full and no merges remain.
    if (isGameOver()) gameOver();

    return true;
  }

  function reached2048() {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (grid[r][c] >= 2048) return true;
    return false;
  }

  // Board full AND no two equal neighbours (horizontally or vertically).
  function isGameOver() {
    if (emptyCells().length > 0) return false;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = grid[r][c];
        if (c + 1 < N && grid[r][c + 1] === v) return false;
        if (r + 1 < N && grid[r + 1][c] === v) return false;
      }
    }
    return true;
  }

  function gameOver() {
    state = 'over';
    if (score > best) { best = score; saveBest(); }
    if (window.Arcade) Arcade.submitScore('2048', score); // leaderboard: final points
    blip(160, 0.3, 'sawtooth', 0.16);
  }

  function startGame() {
    grid = makeGrid();
    score = 0;
    hasWon = false;
    keepGoing = false;
    anims = []; spawnAnim = null; animTime = 0; popTime = 0;
    // Two starting tiles, classic 2048 opening.
    spawnTile();
    spawnTile();
    state = 'playing';
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
  // Pixel position of a cell's top-left corner.
  function cellX(c) { return BOARD_X + GAP + c * (CELL + GAP); }
  function cellY(r) { return BOARD_Y + GAP + r * (CELL + GAP); }

  // Rounded rectangle path (used for the board, slots, and tiles).
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

  // Draw a tile centered on (cx, cy) at a given size with its value text.
  // `size` lets us scale the tile for spawn/merge pops.
  function drawTile(value, centerX, centerY, size) {
    const st = styleFor(value);
    const x = centerX - size / 2;
    const y = centerY - size / 2;
    roundRect(x, y, size, size, RADIUS);
    ctx.fillStyle = st.bg;
    ctx.fill();
    // subtle top highlight for a soft 3D feel
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(x, y, size, size * 0.5, RADIUS);
    ctx.fill();

    // number
    ctx.fillStyle = st.fg;
    ctx.font = '700 ' + fontSizeFor(value) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), centerX, centerY + 1);
  }

  // The empty board grid (always drawn; tiles are layered on top).
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

  // easeOutQuad — makes slides decelerate into place.
  function easeOut(t) { return t * (2 - t); }

  function drawTiles() {
    // While a slide is animating, draw the moving sprites instead of the grid.
    if (animTime > 0 && anims.length) {
      const t = easeOut(1 - animTime / ANIM_MS); // 0..1 progress
      for (let i = 0; i < anims.length; i++) {
        const a = anims[i];
        const fx = cellX(a.fromC) + CELL / 2;
        const fy = cellY(a.fromR) + CELL / 2;
        const tx = cellX(a.toC) + CELL / 2;
        const ty = cellY(a.toR) + CELL / 2;
        const cx = fx + (tx - fx) * t;
        const cy = fy + (ty - fy) * t;
        // show the pre-merge value while sliding; it becomes the sum on landing
        drawTile(a.value, cx, cy, CELL);
      }
      return;
    }

    // Otherwise draw the settled grid. Freshly spawned / merged tiles pop:
    // they scale up past 1.0 briefly then settle (a tiny overshoot bounce).
    const pop = popTime > 0 ? (popTime / POP_MS) : 0; // 1..0
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        const cx = cellX(c) + CELL / 2;
        const cy = cellY(r) + CELL / 2;
        let size = CELL;
        if (pop > 0) {
          // spawn tile: grow from small. merged tiles: gentle overshoot.
          if (spawnAnim && spawnAnim.r === r && spawnAnim.c === c) {
            size = CELL * (0.3 + 0.7 * (1 - pop)); // 0.3 -> 1.0
          } else {
            // overshoot: peaks ~1.08 at mid-pop, returns to 1.0
            const k = 1 - pop;                 // 0..1
            size = CELL * (1 + 0.10 * Math.sin(k * Math.PI));
          }
        }
        drawTile(v, cx, cy, size);
      }
    }
  }

  function drawHUD() {
    // Title (left) and SCORE / BEST pills (right).
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ACCENT;
    ctx.font = '700 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('2048', PAD, 56);

    // Two little score boxes.
    const boxW = 104, boxH = 56, gap = 12;
    const bx2 = W - PAD - boxW;            // BEST (rightmost)
    const bx1 = bx2 - gap - boxW;          // SCORE
    drawScoreBox(bx1, 18, boxW, boxH, 'SCORE', score);
    drawScoreBox(bx2, 18, boxW, boxH, 'BEST', best);
  }
  function drawScoreBox(x, y, w, h, label, value) {
    roundRect(x, y, w, h, 8);
    ctx.fillStyle = 'rgba(238,228,218,0.10)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(label, x + w / 2, y + 20);
    ctx.fillStyle = TEXT;
    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(value), x + w / 2, y + 44);
    ctx.textAlign = 'left';
  }

  // Centered overlay used by title / win / game-over screens.
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

    if (state === 'title') {
      overlay([
        { t: '2048', c: ACCENT, s: 46, w: 700, gap: 54 },
        { t: 'Join the tiles, reach 2048!', c: TEXT, s: 16, gap: 30 },
        { t: '← ↑ → ↓  or  WASD  to slide', c: TEXT, s: 14, gap: 44 },
        { t: 'Press ENTER to start', c: ACCENT, s: 18, w: 700, gap: 26 },
      ]);
    } else if (state === 'over') {
      overlay([
        { t: 'GAME OVER', c: '#f0556a', s: 32, w: 700, gap: 48 },
        { t: 'Score  ' + score, c: TEXT, s: 20, gap: 32 },
        { t: 'Best  ' + best, c: MUTED, s: 15, gap: 46 },
        { t: 'Press R or ENTER to play again', c: ACCENT, s: 16, w: 700, gap: 26 },
      ]);
    } else if (state === 'playing' && hasWon && !keepGoing) {
      // Win banner — dismiss with any move/Space/Enter and keep going.
      overlay([
        { t: 'YOU WIN!', c: '#edc22e', s: 40, w: 700, gap: 50 },
        { t: 'You reached 2048', c: TEXT, s: 18, gap: 34 },
        { t: 'Press SPACE to keep going', c: ACCENT, s: 16, w: 700, gap: 28 },
        { t: 'or R to restart', c: MUTED, s: 14, gap: 24 },
      ], 0.74);
    }
  }

  // ---------- Main loop ----------
  function update(dt) {
    if (animTime > 0) {
      animTime -= dt;
      if (animTime < 0) animTime = 0;
    } else if (popTime > 0) {
      // Pop only ticks once the slide has finished, so tiles bounce in place.
      popTime -= dt;
      if (popTime < 0) popTime = 0;
    }
  }

  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100; // clamp after a tab-switch
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  let lastTime = 0;

  // ---------- Input ----------
  const DIR_KEYS = {
    ArrowLeft: 0, a: 0, A: 0,
    ArrowRight: 1, d: 1, D: 1,
    ArrowUp: 2, w: 2, W: 2,
    ArrowDown: 3, s: 3, S: 3,
  };
  const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'];

  document.addEventListener('keydown', (e) => {
    initAudio(); // browsers require a user gesture before audio can play
    const k = e.key;
    if (NAV_KEYS.indexOf(k) !== -1) e.preventDefault(); // no page scroll

    // Start / restart with ENTER from title or game-over.
    if (k === 'Enter') {
      if (state === 'title' || state === 'over') startGame();
      return;
    }
    // R restarts any time (also starts from the title).
    if (k === 'r' || k === 'R') {
      startGame();
      return;
    }

    if (state === 'title' || state === 'over') return;

    // If the win banner is up, SPACE dismisses it and we keep playing.
    if (hasWon && !keepGoing) {
      if (k === ' ' || k === 'Spacebar') { keepGoing = true; return; }
      // A direction key also implicitly dismisses it and performs the move.
      if (k in DIR_KEYS) keepGoing = true;
      else return;
    }

    // Don't queue another move mid-slide; wait for the animation to finish.
    if (animTime > 0) return;

    if (k in DIR_KEYS) {
      move(DIR_KEYS[k]); // move() itself decides whether anything changed
    }
  });

  // ---------- Go ----------
  // Initialize EVERY piece of state at load so the title screen can draw a
  // valid (empty) board and zeroed scores without touching anything undefined.
  grid = makeGrid();
  score = 0;
  best = loadBest();
  hasWon = false;
  keepGoing = false;
  anims = [];
  spawnAnim = null;
  animTime = 0;
  popTime = 0;
  requestAnimationFrame(frame);
})();
