// ============================================================
//  CONNECT FOUR  —  pure Canvas + vanilla JS, runs from file://
//  No libraries, no assets. All drawing is procedural; audio is
//  WebAudio built in code and started on the first user input.
//
//  Two modes: 1-player vs a minimax CPU, or 2-player hotseat. The CPU has
//  four difficulty levels (Easy / Medium / Hard / Unbeatable) chosen on a
//  title sub-screen, selectable by number keys or by tapping the canvas.
//
//  The interesting bits are commented for a learner:
//    - win detection            (scan 4 directions from every cell)
//    - the falling-disc animation (cosmetic; the board commits instantly)
//    - the CPU                  (depth-limited minimax with alpha-beta
//                                pruning + a positional heuristic; the
//                                search depth is the difficulty dial, and
//                                Easy skips the search entirely)
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 560
  const H = canvas.height;  // 620

  // ---------- Board geometry ----------
  const COLS = 7;
  const ROWS = 6;
  const CELL = 72;                       // disc cell size
  const GAP = 8;                         // padding inside the blue frame around each hole
  const BOARD_W = COLS * CELL;           // 504
  const BOARD_H = ROWS * CELL;           // 432
  const BOARD_X = (W - BOARD_W) / 2;     // centered horizontally (28px margins)
  const TOP = 110;                       // space above the board for the floating disc + HUD
  const BOARD_Y = TOP;
  const R = (CELL - GAP * 2) / 2;        // disc radius (28)
  const HOVER_Y = TOP - CELL / 2 - 6;    // y-center of the floating "to drop" disc

  // ---------- Players / palette ----------
  const EMPTY = 0;
  const RED = 1;     // player 1 (goes first)
  const YELLOW = 2;  // player 2 / CPU

  const COL_RED = '#f0556a';
  const COL_RED_HI = '#ff8a98';
  const COL_YELLOW = '#f5d743';
  const COL_YELLOW_HI = '#ffe97a';
  const COL_BOARD = '#2b5cd6';   // classic blue board
  const COL_BOARD_HI = '#3f72ef';
  const COL_HOLE = '#0a0d13';    // empty hole color (matches page bg)

  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';

  function discColor(p) { return p === RED ? COL_RED : COL_YELLOW; }
  function discHi(p) { return p === RED ? COL_RED_HI : COL_YELLOW_HI; }
  function discName(p) { return p === RED ? 'RED' : 'YELLOW'; }

  // ---------- Game state ----------
  // states: 'title' -> 'difficulty' (vs-CPU only) -> 'playing'
  //         -> ('falling' transient) -> 'win' | 'draw'
  // (the falling disc is an animation overlaid while state stays 'playing'
  //  but input is locked via `anim` being non-null.)
  let state = 'title';
  let mode = 1;            // 1 = vs CPU, 2 = hotseat

  // ---------- Difficulty ----------
  // Four levels. "Unbeatable" is the original depth-6 search. Easy is a
  // heuristic-free random mover that only grabs an instant win / instant
  // block. Medium/Hard are shallower minimax searches.
  // levels: { name, depth }  — depth 0 means "Easy" (special-cased, no search).
  const DIFFICULTIES = [
    { name: 'Easy', depth: 0 },
    { name: 'Medium', depth: 2 },
    { name: 'Hard', depth: 4 },
    { name: 'Unbeatable', depth: 6 },
  ];
  let difficulty = 1;      // index into DIFFICULTIES; default = Medium
  // Clickable rectangles for the difficulty picker, rebuilt each render.
  // Each: { x, y, w, h, idx }.
  let diffHit = [];
  let grid;                // ROWS x COLS, EMPTY/RED/YELLOW. row 0 is the TOP.
  let current;             // whose turn it is (RED or YELLOW)
  let cursorCol;           // highlighted column for keyboard play
  let winner;              // EMPTY, RED, YELLOW, or -1 for draw
  let winLine = [];        // the four [row,col] cells that won (for highlight)
  let moveCount;           // discs placed (used to detect a full-board draw)
  let redWins, yelWins;    // running scoreboard across rounds
  let roundStarter;        // who started the current round (alternates each R)

  // Falling-disc animation. While non-null, input is ignored.
  // { col, targetRow, player, y, vy } — y is the disc center in px.
  let anim = null;

  // Small celebratory particle burst on a win.
  let particles = [];
  // Win banner pulse + a brief "winning cells" flash phase.
  let winPulse = 0;

  // CPU "thinking" delay so its move doesn't feel instant.
  let cpuTimer = 0;
  let cpuPending = false;

  let lastTime = 0;

  // ---------- Persistent scoreboard (localStorage, fail-safe) ----------
  function loadScores() {
    try {
      const r = parseInt(localStorage.getItem('c4.red') || '0', 10);
      const y = parseInt(localStorage.getItem('c4.yel') || '0', 10);
      redWins = Number.isFinite(r) ? r : 0;
      yelWins = Number.isFinite(y) ? y : 0;
    } catch (e) { redWins = 0; yelWins = 0; }
  }
  function saveScores() {
    try {
      localStorage.setItem('c4.red', String(redWins));
      localStorage.setItem('c4.yel', String(yelWins));
    } catch (e) { /* ignore */ }
  }

  // ---------- Grid helpers ----------
  function makeGrid() {
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) g[r] = new Array(COLS).fill(EMPTY);
    return g;
  }

  // Lowest empty row in a column, or -1 if the column is full.
  // Row 0 is the top, so "lowest empty" means the largest row index.
  function dropRow(g, col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][col] === EMPTY) return r;
    }
    return -1;
  }

  function boardFull(g) {
    for (let c = 0; c < COLS; c++) {
      if (g[0][c] === EMPTY) return false;
    }
    return true;
  }

  // ---------- Win detection ----------
  // From a just-placed disc at (row,col), check the 4 line directions
  // (horizontal, vertical, and the two diagonals). For each we count how
  // far the same color extends both ways; 4+ in a row is a win. Returns the
  // list of winning cells (length>=4) or null.
  const DIRS = [
    [0, 1],   // horizontal →
    [1, 0],   // vertical ↓
    [1, 1],   // diagonal ↘
    [1, -1],  // diagonal ↙
  ];
  function winningCellsAt(g, row, col) {
    const p = g[row][col];
    if (p === EMPTY) return null;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      const cells = [[row, col]];
      // extend forward
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && g[r][c] === p) {
        cells.push([r, c]); r += dr; c += dc;
      }
      // extend backward
      r = row - dr; c = col - dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && g[r][c] === p) {
        cells.unshift([r, c]); r -= dr; c -= dc;
      }
      if (cells.length >= 4) return cells.slice(0, 4);
    }
    return null;
  }

  // Does player p have a win anywhere on the board? (used by the CPU search)
  function isWin(g, p) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (g[r][c] !== p) continue;
        for (let d = 0; d < DIRS.length; d++) {
          const dr = DIRS[d][0], dc = DIRS[d][1];
          const er = r + 3 * dr, ec = c + 3 * dc;
          if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
          if (g[r + dr][c + dc] === p && g[r + 2 * dr][c + 2 * dc] === p && g[er][ec] === p) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // ---------- Rounds / flow ----------
  // Start a fresh round with `starter` (RED/YELLOW) to move first.
  function newRound(starter) {
    grid = makeGrid();
    roundStarter = starter;
    current = starter;
    cursorCol = 3;
    winner = EMPTY;
    winLine = [];
    moveCount = 0;
    anim = null;
    particles = [];
    winPulse = 0;
    cpuPending = false;
    cpuTimer = 0;
    state = 'playing';
    maybeQueueCpu();   // if the starter is the CPU, queue its move
  }

  // Picking a mode (or restarting one) always begins with RED to move.
  function startGame(m) {
    mode = m;
    newRound(RED);
  }

  // Enter the difficulty picker (vs-CPU only). The actual game starts once a
  // level is confirmed via confirmDifficulty().
  function openDifficulty() {
    mode = 1;
    state = 'difficulty';
  }

  // Confirm a difficulty index and start a vs-CPU game.
  function confirmDifficulty(idx) {
    if (idx >= 0 && idx < DIFFICULTIES.length) difficulty = idx;
    startGame(1);
  }

  // ---------- Move execution ----------
  // Begin dropping `player`'s disc into `col`. Kicks off the falling
  // animation; the grid is committed when the disc lands (in update()).
  function startDrop(col, player) {
    if (anim) return;                       // already a disc in flight
    const targetRow = dropRow(grid, col);
    if (targetRow < 0) return;              // column full — ignore
    anim = {
      col: col,
      targetRow: targetRow,
      player: player,
      y: HOVER_Y,                           // start above the board
      vy: 0,
    };
    plonk(180, 0.04, 'square', 0.05);       // soft "release" tick
  }

  // Called when a falling disc reaches its slot.
  function landDisc(a) {
    grid[a.targetRow][a.col] = a.player;
    moveCount++;
    anim = null;

    // Satisfying landing thud, pitch drops the lower the disc lands.
    plonk(120 + (ROWS - a.targetRow) * 26, 0.12, 'triangle', 0.16);
    spawnDust(a.col, a.targetRow);

    // Win?
    const cells = winningCellsAt(grid, a.targetRow, a.col);
    if (cells) {
      winner = a.player;
      winLine = cells;
      state = 'win';
      winPulse = 0;
      if (a.player === RED) redWins++; else yelWins++;
      saveScores();
      spawnConfetti();
      fanfare(a.player);
      return;
    }
    // Draw?
    if (boardFull(grid)) {
      winner = -1;
      state = 'draw';
      plonk(160, 0.3, 'sine', 0.12);
      return;
    }
    // Otherwise pass the turn.
    current = (current === RED) ? YELLOW : RED;
    maybeQueueCpu();
  }

  // If it's the CPU's turn (mode 1, YELLOW), schedule its move after a beat.
  function maybeQueueCpu() {
    if (mode === 1 && current === YELLOW && state === 'playing') {
      cpuPending = true;
      cpuTimer = 360;   // ms of "thinking" before it drops
    }
  }

  // ---------- CPU: depth-limited minimax with alpha-beta ----------
  // The CPU is YELLOW. It searches a few plies ahead, scoring leaf/board
  // positions with a heuristic that rewards its own 2s/3s-in-a-row and
  // punishes the opponent's. Immediate wins and blocking forced losses
  // fall out of the search naturally, but we also short-circuit the obvious
  // win/block at the root so the very first replies feel sharp.
  const CPU = YELLOW;
  const HUMAN = RED;
  const WIN_SCORE = 1000000;

  // The active search depth for the current difficulty (set when a game
  // starts). "Unbeatable" keeps the original depth-6 search.
  function searchDepth() { return DIFFICULTIES[difficulty].depth; }

  // Score a "window" of 4 consecutive cells from CPU's perspective.
  function scoreWindow(w) {
    let cpu = 0, hum = 0, empty = 0;
    for (let i = 0; i < 4; i++) {
      if (w[i] === CPU) cpu++;
      else if (w[i] === HUMAN) hum++;
      else empty++;
    }
    // A window with both colors is dead (nobody can complete it) -> 0.
    if (cpu > 0 && hum > 0) return 0;
    if (cpu === 4) return 100;
    if (cpu === 3 && empty === 1) return 12;
    if (cpu === 2 && empty === 2) return 4;
    if (hum === 4) return -100;
    if (hum === 3 && empty === 1) return -14;   // value blocking slightly higher
    if (hum === 2 && empty === 2) return -4;
    return 0;
  }

  // Static evaluation of a non-terminal board (CPU's perspective).
  function evaluate(g) {
    let score = 0;
    // Prefer central columns — they participate in more winning lines.
    const centerWeights = [0, 1, 2, 4, 2, 1, 0];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (g[r][c] === CPU) score += centerWeights[c];
        else if (g[r][c] === HUMAN) score -= centerWeights[c];
      }
    }
    // Slide a 4-wide window across every row, column and both diagonals.
    // Horizontal
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c <= COLS - 4; c++)
        score += scoreWindow([g[r][c], g[r][c + 1], g[r][c + 2], g[r][c + 3]]);
    // Vertical
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r <= ROWS - 4; r++)
        score += scoreWindow([g[r][c], g[r + 1][c], g[r + 2][c], g[r + 3][c]]);
    // Diagonal ↘
    for (let r = 0; r <= ROWS - 4; r++)
      for (let c = 0; c <= COLS - 4; c++)
        score += scoreWindow([g[r][c], g[r + 1][c + 1], g[r + 2][c + 2], g[r + 3][c + 3]]);
    // Diagonal ↙
    for (let r = 0; r <= ROWS - 4; r++)
      for (let c = 3; c < COLS; c++)
        score += scoreWindow([g[r][c], g[r + 1][c - 1], g[r + 2][c - 2], g[r + 3][c - 3]]);
    return score;
  }

  function validCols(g) {
    const out = [];
    // Search center-out: improves alpha-beta pruning and tie-breaks toward
    // the strong central columns.
    const order = [3, 2, 4, 1, 5, 0, 6];
    for (let i = 0; i < order.length; i++) {
      if (g[0][order[i]] === EMPTY) out.push(order[i]);
    }
    return out;
  }

  // Returns the best score for the player "to move" (maximizing = CPU).
  // `rootDepth` is the full depth of this search so we can reward sooner wins.
  function minimax(g, depth, alpha, beta, maximizing, rootDepth) {
    const cols = validCols(g);
    // Terminal checks first.
    if (isWin(g, CPU)) return WIN_SCORE - (rootDepth - depth);   // sooner wins score higher
    if (isWin(g, HUMAN)) return -WIN_SCORE + (rootDepth - depth);
    if (cols.length === 0) return 0;        // draw (full board)
    if (depth === 0) return evaluate(g);

    if (maximizing) {
      let best = -Infinity;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const row = dropRow(g, col);
        g[row][col] = CPU;
        const sc = minimax(g, depth - 1, alpha, beta, false, rootDepth);
        g[row][col] = EMPTY;                // undo
        if (sc > best) best = sc;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;           // beta cut-off
      }
      return best;
    } else {
      let best = Infinity;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const row = dropRow(g, col);
        g[row][col] = HUMAN;
        const sc = minimax(g, depth - 1, alpha, beta, true, rootDepth);
        g[row][col] = EMPTY;
        if (sc < best) best = sc;
        if (best < beta) beta = best;
        if (alpha >= beta) break;           // alpha cut-off
      }
      return best;
    }
  }

  // Find an immediate winning column for player `p`, or -1.
  function findImmediate(p) {
    const cols = validCols(grid);
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const row = dropRow(grid, col);
      grid[row][col] = p;
      const won = isWin(grid, p);
      grid[row][col] = EMPTY;
      if (won) return col;
    }
    return -1;
  }

  // Pick the CPU's column based on the current difficulty.
  //   Easy       : grab an instant win, else block the player's instant win,
  //                else a random legal column (no lookahead — very beatable).
  //   Medium/Hard/Unbeatable : depth-2 / depth-4 / depth-6 alpha-beta search.
  function cpuChooseColumn() {
    const cols = validCols(grid);
    if (cols.length === 0) return -1;

    const depth = searchDepth();

    // Easy: only the two "obvious" tactics, then random.
    if (depth <= 0) {
      const win = findImmediate(CPU);
      if (win >= 0) return win;
      const block = findImmediate(HUMAN);
      if (block >= 0) return block;
      return cols[(Math.random() * cols.length) | 0];
    }

    // Stronger levels: take an immediate win, then block, then search. The
    // win/block short-circuit keeps the obvious replies sharp at any depth.
    const win = findImmediate(CPU);
    if (win >= 0) return win;
    const block = findImmediate(HUMAN);
    if (block >= 0) return block;

    // Full minimax search at the difficulty's depth. Root level: evaluate each
    // move, keep the best; collect ties and pick randomly so the CPU isn't
    // perfectly predictable.
    let best = -Infinity;
    let bestCols = [cols[0]];
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const row = dropRow(grid, col);
      grid[row][col] = CPU;
      const sc = minimax(grid, depth - 1, -Infinity, Infinity, false, depth);
      grid[row][col] = EMPTY;
      if (sc > best) { best = sc; bestCols = [col]; }
      else if (sc === best) bestCols.push(col);
    }
    return bestCols[(Math.random() * bestCols.length) | 0];
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
  function plonk(freq, dur, type, vol) {
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
  // A short ascending arpeggio for the winner.
  function fanfare(player) {
    if (!audioCtx) return;
    const base = player === RED ? 392 : 330; // G4 / E4 root
    const notes = [0, 4, 7, 12];              // major-ish climb
    for (let i = 0; i < notes.length; i++) {
      const f = base * Math.pow(2, notes[i] / 12);
      setTimeout(() => plonk(f, 0.18, 'square', 0.12), i * 110);
    }
  }

  // ---------- Particles (win confetti + landing dust) ----------
  function spawnConfetti() {
    particles = [];
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 80 + Math.random() * 320;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 120,
        life: 1, decay: 0.4 + Math.random() * 0.5,
        size: 3 + Math.random() * 4,
        color: Math.random() < 0.5 ? COL_RED : COL_YELLOW,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI,
      });
    }
  }
  // A little puff of dust where a disc lands.
  function spawnDust(col, row) {
    const cx = BOARD_X + col * CELL + CELL / 2;
    const cy = BOARD_Y + row * CELL + CELL / 2 + R * 0.4;
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const spd = 30 + Math.random() * 70;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1, decay: 2.2 + Math.random(),
        size: 2 + Math.random() * 2,
        color: 'rgba(159,180,212,0.6)',
        spin: 0, rot: 0,
      });
    }
  }
  function updateParticles(dt) {
    const s = dt / 1000;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 520 * s;                 // gravity
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.rot += p.spin * s;
      p.life -= p.decay * s;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---------- Rendering ----------
  function cellCenterX(col) { return BOARD_X + col * CELL + CELL / 2; }
  function cellCenterY(row) { return BOARD_Y + row * CELL + CELL / 2; }

  // A disc with a soft radial sheen so it reads as a glossy checker.
  function drawDisc(x, y, player, radius, highlight) {
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
    grad.addColorStop(0, highlight ? discHi(player) : discHi(player));
    grad.addColorStop(0.55, discColor(player));
    grad.addColorStop(1, player === RED ? '#9c2230' : '#a08a12');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // rim
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.stroke();
    // little top glint
    ctx.beginPath();
    ctx.arc(x - radius * 0.32, y - radius * 0.36, radius * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  // The blue board is drawn as a rounded rect with circular holes punched
  // out. We draw the frame, then for each cell either the disc or an empty
  // hole (the page background color), giving the classic Connect Four look.
  function drawBoard() {
    // Frame
    roundRect(BOARD_X - GAP, BOARD_Y - GAP, BOARD_W + GAP * 2, BOARD_H + GAP * 2, 16);
    const fg = ctx.createLinearGradient(0, BOARD_Y, 0, BOARD_Y + BOARD_H);
    fg.addColorStop(0, COL_BOARD_HI);
    fg.addColorStop(1, COL_BOARD);
    ctx.fillStyle = fg;
    ctx.fill();
    // subtle inner shadow line
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // Cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = cellCenterX(c), y = cellCenterY(r);
        const v = grid[r][c];
        if (v === EMPTY) {
          // recessed empty hole
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fillStyle = COL_HOLE;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.stroke();
        } else {
          drawDisc(x, y, v, R, false);
        }
      }
    }
  }

  // Bright pulsing ring around each of the four winning discs.
  function drawWinLine() {
    if (!winLine.length) return;
    const pulse = 0.5 + 0.5 * Math.sin(winPulse / 140);
    for (let i = 0; i < winLine.length; i++) {
      const x = cellCenterX(winLine[i][1]);
      const y = cellCenterY(winLine[i][0]);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, R + 3, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.45 * pulse).toFixed(3) + ')';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 12 * pulse;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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

  function label(text, x, y, color, size, weight, align) {
    ctx.fillStyle = color;
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  // The HUD: scoreboard left/right and the turn indicator in the middle.
  function drawHud() {
    ctx.textBaseline = 'alphabetic';

    // RED score (left)
    drawDisc(BOARD_X + 14, 30, RED, 13, false);
    label(String(redWins), BOARD_X + 32, 36, COL_RED, 20, 700, 'left');

    // YELLOW score (right)
    const ry = BOARD_X + BOARD_W - 14;
    drawDisc(ry, 30, YELLOW, 13, false);
    label(String(yelWins), ry - 18, 36, COL_YELLOW, 20, 700, 'right');

    // Mode tag, centered up top. In vs-CPU mode, append the difficulty.
    const modeTag = mode === 1
      ? 'VS CPU · ' + DIFFICULTIES[difficulty].name.toUpperCase()
      : 'HOTSEAT';
    label(modeTag, W / 2, 24, MUTED, 11, 600, 'center');

    // Turn / result text, centered just under the score row
    let msg, col;
    if (state === 'win') {
      msg = (mode === 1 && winner === YELLOW) ? 'CPU WINS!' : discName(winner) + ' WINS!';
      col = discColor(winner);
    } else if (state === 'draw') {
      msg = 'DRAW';
      col = ACCENT;
    } else {
      const who = (mode === 1 && current === YELLOW) ? 'CPU' : discName(current);
      msg = who + (cpuPending ? ' thinking…' : ' to move');
      col = discColor(current);
    }
    label(msg, W / 2, 56, col, 16, 700, 'center');
  }

  // The disc that hovers above the active column before you drop it.
  function drawHoverDisc() {
    if (state !== 'playing' || anim) return;
    if (mode === 1 && current === YELLOW) return;  // hide during CPU's turn
    const x = cellCenterX(cursorCol);
    const y = HOVER_Y;
    // guide line down the column
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = discColor(current);
    ctx.fillRect(BOARD_X + cursorCol * CELL + GAP, BOARD_Y, CELL - GAP * 2, BOARD_H);
    ctx.restore();
    drawDisc(x, y, current, R, true);
    // little down-arrow chevron under it
    ctx.fillStyle = discColor(current);
    ctx.beginPath();
    ctx.moveTo(x - 6, y + R + 6);
    ctx.lineTo(x + 6, y + R + 6);
    ctx.lineTo(x, y + R + 14);
    ctx.closePath();
    ctx.fill();
  }

  function drawFallingDisc() {
    if (!anim) return;
    drawDisc(cellCenterX(anim.col), anim.y, anim.player, R, false);
  }

  // Centered modal overlay used by the title & game-over screens.
  function overlay(lines, dimAll) {
    ctx.save();
    ctx.fillStyle = dimAll ? 'rgba(7,9,16,0.86)' : 'rgba(7,9,16,0.62)';
    ctx.fillRect(0, 0, W, H);
    let cy = H / 2 - (lines.length - 1) * 16;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      label(l.t, W / 2, cy, l.c || TEXT, l.s || 16, l.w || 600, 'center');
      cy += (l.gap || 34);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // The difficulty picker (vs-CPU). Draws four tappable buttons and records
  // their hit-rects into `diffHit` so clicks/taps can be mapped back to a
  // level. The current `difficulty` index is highlighted as the default.
  function drawDifficulty() {
    ctx.save();
    ctx.fillStyle = 'rgba(7,9,16,0.86)';
    ctx.fillRect(0, 0, W, H);

    label('CHOOSE DIFFICULTY', W / 2, H / 2 - 150, ACCENT, 26, 700, 'center');
    label('vs CPU', W / 2, H / 2 - 122, MUTED, 13, 600, 'center');

    const subtitle = [
      'only blocks & grabs obvious wins',
      'looks 2 moves ahead',
      'looks 4 moves ahead',
      'perfect play — good luck',
    ];

    const bw = 320, bh = 52, gap = 14;
    const x = (W - bw) / 2;
    let y = H / 2 - 88;
    diffHit = [];
    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const sel = i === difficulty;
      roundRect(x, y, bw, bh, 12);
      ctx.fillStyle = sel ? 'rgba(63,114,239,0.30)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = sel ? COL_BOARD_HI : 'rgba(159,180,212,0.25)';
      ctx.stroke();

      // number key chip on the left
      label(String(i + 1), x + 22, y + bh / 2 + 7, sel ? '#ffffff' : ACCENT, 20, 700, 'center');
      // name + one-line description
      label(DIFFICULTIES[i].name, x + 46, y + bh / 2 - 2, sel ? '#ffffff' : TEXT, 18, 700, 'left');
      label(subtitle[i], x + 46, y + bh / 2 + 16, MUTED, 11, 500, 'left');

      diffHit.push({ x: x, y: y, w: bw, h: bh, idx: i });
      y += bh + gap;
    }

    label('press  1–4  or  tap      ·      default: ' + DIFFICULTIES[difficulty].name,
      W / 2, y + 16, MUTED, 12, 500, 'center');
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Always-valid board + HUD draw underneath everything (title included).
    drawBoard();
    drawHud();
    drawHoverDisc();
    drawFallingDisc();
    drawWinLine();
    drawParticles();

    if (state === 'title') {
      overlay([
        { t: 'CONNECT FOUR', c: ACCENT, s: 30, w: 700, gap: 50 },
        { t: 'Drop discs · line up four to win', c: TEXT, s: 14, gap: 40 },
        { t: 'Press  1  —  1 player vs CPU', c: COL_YELLOW, s: 17, w: 700, gap: 30 },
        { t: 'Press  2  —  2 player hotseat', c: COL_RED, s: 17, w: 700, gap: 44 },
        { t: '← →  move      Space / ↓  drop      click a column', c: MUTED, s: 12, gap: 22 },
      ], true);
    } else if (state === 'difficulty') {
      drawDifficulty();
    } else if (state === 'win' || state === 'draw') {
      let head, hc;
      if (state === 'draw') { head = 'DRAW — board full'; hc = ACCENT; }
      else if (mode === 1 && winner === YELLOW) { head = 'CPU WINS'; hc = COL_YELLOW; }
      else if (mode === 1 && winner === RED) { head = 'YOU WIN!'; hc = COL_RED; }
      else { head = discName(winner) + ' WINS'; hc = discColor(winner); }
      overlay([
        { t: head, c: hc, s: 30, w: 700, gap: 46 },
        { t: 'RED ' + redWins + '   —   ' + yelWins + ' YELLOW', c: TEXT, s: 16, gap: 40 },
        { t: 'Press  R  for next round', c: ACCENT, s: 16, w: 700, gap: 26 },
        { t: 'Press  1  vs CPU (pick level)  ·  2  hotseat', c: MUTED, s: 12, gap: 22 },
      ], false);
    }
  }

  // ---------- Main loop ----------
  function update(dt) {
    updateParticles(dt);

    if (state === 'win') {
      winPulse += dt;
    }

    // Advance the falling-disc animation. We integrate a simple gravity so
    // the disc accelerates, with a tiny squash-on-impact feel via overshoot
    // clamp. When it reaches the target slot center, commit it.
    if (anim) {
      const s = dt / 1000;
      anim.vy += 2400 * s;            // px/s^2 gravity
      anim.y += anim.vy * s;
      const targetY = cellCenterY(anim.targetRow);
      if (anim.y >= targetY) {
        anim.y = targetY;
        landDisc(anim);
      }
      return;                         // input stays locked while a disc flies
    }

    // CPU turn: count down the "thinking" timer, then compute + drop.
    if (cpuPending && state === 'playing') {
      cpuTimer -= dt;
      if (cpuTimer <= 0) {
        cpuPending = false;
        const col = cpuChooseColumn();
        if (col >= 0) startDrop(col, CPU);
      }
    }
  }

  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100;           // clamp after a tab-switch
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input: keyboard ----------
  // True if it's a human's turn and we're free to accept a move.
  function humanCanPlay() {
    if (state !== 'playing' || anim) return false;
    if (mode === 1 && current === YELLOW) return false;  // CPU's turn
    return true;
  }

  const PREVENT = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'];
  document.addEventListener('keydown', (e) => {
    initAudio();   // browsers need a user gesture before audio
    const k = e.key;
    if (PREVENT.indexOf(k) !== -1) e.preventDefault();

    // ---- Difficulty picker (vs-CPU) ----
    // 1–4 pick a level and start; Space/Enter confirms the current default;
    // 2-player is still reachable, and Esc/Backspace backs out to the title.
    if (state === 'difficulty') {
      if (k >= '1' && k <= '4') { confirmDifficulty(parseInt(k, 10) - 1); return; }
      if (k === ' ' || k === 'Spacebar' || k === 'Enter') { confirmDifficulty(difficulty); return; }
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); state = 'title'; return; }
      return;
    }

    // Mode select is available on the title and after a result.
    //   1 -> open the difficulty picker (vs CPU)
    //   2 -> start a 2-player hotseat game immediately
    if (k === '1') { openDifficulty(); return; }
    if (k === '2') { startGame(2); return; }
    // Space / Enter / click on the title opens the difficulty picker (default
    // vs CPU) so it begins like every other arcade game; 1/2 still pick mode.
    if (state === 'title' && (k === ' ' || k === 'Spacebar' || k === 'Enter')) { openDifficulty(); return; }

    if (state === 'title') return;

    // R resets the round. We alternate who starts each round for fairness:
    // whoever did NOT start the previous round goes first this time.
    if (k === 'r' || k === 'R') {
      const nextStarter = (roundStarter === RED) ? YELLOW : RED;
      newRound(nextStarter);
      return;
    }

    if (!humanCanPlay()) return;

    switch (k) {
      case 'ArrowLeft':
        cursorCol = (cursorCol + COLS - 1) % COLS;
        tick();
        break;
      case 'ArrowRight':
        cursorCol = (cursorCol + 1) % COLS;
        tick();
        break;
      case 'ArrowDown':
      case ' ':
      case 'Spacebar':
        startDrop(cursorCol, current);
        break;
      default: break;
    }
  });

  function tick() { plonk(420, 0.03, 'square', 0.05); }

  // ---------- Input: mouse ----------
  // Map a click x-coordinate to a board column (canvas may be CSS-scaled,
  // so convert via the bounding-rect ratio).
  function colFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const x = (clientX - rect.left) * scaleX;
    const c = Math.floor((x - BOARD_X) / CELL);
    return (c >= 0 && c < COLS) ? c : -1;
  }

  canvas.addEventListener('mousemove', (e) => {
    // On the difficulty picker, hovering a button previews it as the default.
    if (state === 'difficulty') {
      const p = pointFromClient(e.clientX, e.clientY);
      for (let i = 0; i < diffHit.length; i++) {
        const b = diffHit[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          difficulty = b.idx;
          break;
        }
      }
      return;
    }
    if (!humanCanPlay()) return;
    const c = colFromClientX(e.clientX);
    if (c >= 0 && c !== cursorCol) cursorCol = c;
  });

  // Convert a client point to canvas coordinates (canvas may be CSS-scaled).
  function pointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (W / rect.width),
      y: (clientY - rect.top) * (H / rect.height),
    };
  }

  canvas.addEventListener('click', (e) => {
    initAudio();
    // Title: a click opens the difficulty picker (vs CPU); 1/2 pick the mode.
    if (state === 'title') { openDifficulty(); return; }
    // Difficulty picker: hit-test the tappable level buttons.
    if (state === 'difficulty') {
      const p = pointFromClient(e.clientX, e.clientY);
      for (let i = 0; i < diffHit.length; i++) {
        const b = diffHit[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          confirmDifficulty(b.idx);
          return;
        }
      }
      return;
    }
    if (!humanCanPlay()) return;
    const c = colFromClientX(e.clientX);
    if (c >= 0) { cursorCol = c; startDrop(c, current); }
  });

  // Keep the page from scrolling when the canvas is focused/clicked.
  canvas.addEventListener('mousedown', (e) => e.preventDefault());

  // ---------- Go ----------
  // Initialize EVERY piece of state the renderer touches, at load, so the
  // title screen draws a valid (empty) board and HUD — never `undefined`.
  loadScores();
  grid = makeGrid();
  current = RED;
  roundStarter = RED;
  cursorCol = 3;
  winner = EMPTY;
  winLine = [];
  moveCount = 0;
  anim = null;
  particles = [];
  winPulse = 0;
  cpuPending = false;
  cpuTimer = 0;
  state = 'title';
  requestAnimationFrame(frame);
})();
