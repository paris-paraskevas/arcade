// ============================================================
//  TIC-TAC-TOE  —  classic 3x3, pure HTML5 Canvas + vanilla JS.
//  No libraries, no asset files. Just open index.html.
//
//  Two modes, chosen on the title screen:
//    1) vs CPU     — you are X, the computer is O and uses MINIMAX,
//                    so it plays perfectly: you can draw, never win.
//    2) hotseat    — two humans share the mouse, X then O.
//
//  How it works: the board is a flat array of 9 cells holding
//  '', 'X' or 'O'. Clicking an empty cell places the current
//  player's mark; we then check the 8 winning lines. Each mark
//  animates a quick "stroke-in" (a 0->1 progress timer) so the
//  X/O draw on rather than pop. A running scoreboard persists in
//  localStorage. Read minimax() and place() to see the brains.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 480 — fixed internal resolution
  const HEIGHT = canvas.height;  // 560 — (CSS scales it to the page)

  // ---- Layout (tweak to reshape the board) --------------------
  const BOARD = 432;                     // board is BOARD x BOARD px
  const OX = (WIDTH - BOARD) / 2;         // board left edge (centered)
  const OY = 104;                         // board top edge (room for HUD)
  const CELL = BOARD / 3;                 // 144px per cell

  // ---- Theme --------------------------------------------------
  const C = {
    bg: '#0c0f17',
    grid: 'rgba(159,180,212,0.22)',
    x: '#5ec8ff',          // X — cool blue
    xGlow: 'rgba(94,200,255,0.5)',
    o: '#ff7a9c',          // O — warm pink
    oGlow: 'rgba(255,122,156,0.5)',
    win: '#3ddc84',        // winning-line highlight (green)
    winGlow: 'rgba(61,220,132,0.6)',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    cellHover: 'rgba(159,180,212,0.06)',
  };

  // The 8 ways to win: rows, columns, then the two diagonals.
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],   // cols
    [0, 4, 8], [2, 4, 6],              // diagonals
  ];

  // ---- Game state (ALL initialized here, at load) -------------
  // States: 'title' | 'playing' | 'over'
  let state = 'title';
  let mode = 'cpu';            // 'cpu' (1P vs minimax) or 'hotseat' (2P)
  let board;                  // length-9 array of '', 'X', 'O'
  let current;                // 'X' or 'O' — whose turn it is
  let progress;               // length-9 array, 0..1 stroke-in per cell
  let winner;                 // 'X' | 'O' | 'draw' | null
  let winLine;                // [a,b,c] winning triple, or null
  let winFlash;               // 0..1 timer for the win highlight pulse
  let hoverCell;              // index 0..8 under the mouse, or -1
  let cpuTimer;               // ms countdown before the CPU moves (think pause)
  let restartTimer;           // ms countdown to auto-start the next round
  let last;                   // timestamp of previous frame
  let scores;                 // { X, O, draw } running tally across rounds

  const CPU_THINK = 380;       // ms the CPU "thinks" before placing
  const AUTO_RESTART = 1700;   // ms after a result before the next round

  // ---- Scoreboard persistence (guarded) -----------------------
  function loadScores() {
    try {
      const raw = JSON.parse(localStorage.getItem('ttt.scores'));
      if (raw && typeof raw === 'object') {
        return { X: raw.X | 0, O: raw.O | 0, draw: raw.draw | 0 };
      }
    } catch (e) { /* ignore */ }
    return { X: 0, O: 0, draw: 0 };
  }
  function saveScores() {
    try { localStorage.setItem('ttt.scores', JSON.stringify(scores)); }
    catch (e) { /* ignore */ }
  }
  scores = loadScores();

  // ---- Audio (WebAudio, lazy on first input, never fatal) -----
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
      const v = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* never break the game for a sound */ }
  }
  const sndPlace = (p) => blip(p === 'X' ? 540 : 430, 0.08, 'triangle', 0.07);
  const sndWin = () => {
    blip(660, 0.12, 'sine', 0.08);
    setTimeout(() => blip(880, 0.16, 'sine', 0.08), 90);
    setTimeout(() => blip(1175, 0.22, 'sine', 0.08), 200);
  };
  const sndDraw = () => { blip(300, 0.2, 'sine', 0.06); };

  // ---- Round setup --------------------------------------------
  // Reset the board but KEEP the scoreboard. X always opens.
  function newRound() {
    board = ['', '', '', '', '', '', '', '', ''];
    progress = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    current = 'X';
    winner = null;
    winLine = null;
    winFlash = 0;
    cpuTimer = 0;
    restartTimer = 0;
    // (In vs-CPU, the human is X and moves first, so no CPU kick-off.)
  }

  // ---- Win / draw detection -----------------------------------
  // Returns 'X' | 'O' | 'draw' | null for the given cells array.
  function evaluate(cells) {
    for (const ln of LINES) {
      const [a, b, c] = ln;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
        return cells[a];
      }
    }
    return cells.every(v => v) ? 'draw' : null;
  }
  function findWinLine(cells, mark) {
    for (const ln of LINES) {
      const [a, b, c] = ln;
      if (cells[a] === mark && cells[b] === mark && cells[c] === mark) return ln;
    }
    return null;
  }

  // ---- Place a mark + resolve the round -----------------------
  function place(i, mark) {
    if (board[i] || winner) return;
    board[i] = mark;
    progress[i] = 0;            // start its stroke-in animation
    sndPlace(mark);

    const result = evaluate(board);
    if (result) {
      finish(result);
    } else {
      current = mark === 'X' ? 'O' : 'X';
      // Hand off to the CPU if it's now O's turn in vs-CPU mode.
      if (mode === 'cpu' && current === 'O') cpuTimer = CPU_THINK;
    }
  }

  function finish(result) {
    winner = result;
    state = 'over';
    restartTimer = AUTO_RESTART;
    if (result === 'draw') {
      scores.draw++;
      sndDraw();
    } else {
      scores[result]++;
      winLine = findWinLine(board, result);
      winFlash = 1;
      sndWin();
    }
    saveScores();
  }

  // ---- The AI: MINIMAX (perfect play) -------------------------
  // The CPU is O (the maximizer). It explores every continuation
  // and scores terminal boards: +10 for an O win, -10 for an X win,
  // 0 for a draw. We subtract/add depth so the AI prefers the
  // FASTEST win and the SLOWEST loss (tidier, more human play).
  // Against perfect play tic-tac-toe is a forced draw, so the CPU
  // can never lose — the player can only draw, or lose if they err.
  function minimax(cells, isMax, depth) {
    const result = evaluate(cells);
    if (result === 'O') return 10 - depth;
    if (result === 'X') return depth - 10;
    if (result === 'draw') return 0;

    if (isMax) {                 // O's move — maximize
      let best = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (!cells[i]) {
          cells[i] = 'O';
          best = Math.max(best, minimax(cells, false, depth + 1));
          cells[i] = '';
        }
      }
      return best;
    } else {                     // X's move — minimize
      let best = Infinity;
      for (let i = 0; i < 9; i++) {
        if (!cells[i]) {
          cells[i] = 'X';
          best = Math.min(best, minimax(cells, true, depth + 1));
          cells[i] = '';
        }
      }
      return best;
    }
  }

  // Pick O's best cell. We mirror the board so minimax can mutate
  // a throwaway copy. Ties are broken randomly so the CPU isn't
  // robotically identical every game (still optimal, just varied).
  function bestCpuMove() {
    const cells = board.slice();
    let bestScore = -Infinity;
    let candidates = [];
    for (let i = 0; i < 9; i++) {
      if (!cells[i]) {
        cells[i] = 'O';
        const score = minimax(cells, false, 0);
        cells[i] = '';
        if (score > bestScore) { bestScore = score; candidates = [i]; }
        else if (score === bestScore) candidates.push(i);
      }
    }
    return candidates[(Math.random() * candidates.length) | 0];
  }

  // ---- Input --------------------------------------------------
  // Translate a mouse event into board-space and act on it.
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    // Map CSS pixels back to the canvas's internal resolution.
    const mx = (e.clientX - rect.left) * (WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (HEIGHT / rect.height);
    if (mx < OX || my < OY || mx >= OX + BOARD || my >= OY + BOARD) return -1;
    const col = Math.floor((mx - OX) / CELL);
    const row = Math.floor((my - OY) / CELL);
    return row * 3 + col;
  }

  function startGame(m) {
    mode = m;
    newRound();
    state = 'playing';
  }

  canvas.addEventListener('mousemove', (e) => {
    hoverCell = state === 'playing' ? cellFromEvent(e) : -1;
  });
  canvas.addEventListener('mouseleave', () => { hoverCell = -1; });

  canvas.addEventListener('click', (e) => {
    ensureAudio(); // first gesture unlocks WebAudio

    if (state === 'title') return;            // title uses keys (1 / 2)

    if (state === 'over') {                    // click skips the pause
      newRound();
      state = 'playing';
      return;
    }

    // Playing: ignore clicks while the CPU is to move.
    if (mode === 'cpu' && current === 'O') return;

    const i = cellFromEvent(e);
    if (i >= 0 && !board[i]) place(i, current);
  });

  window.addEventListener('keydown', (e) => {
    ensureAudio();

    if (e.key === '1') { startGame('cpu'); return; }
    if (e.key === '2') { startGame('hotseat'); return; }

    // R resets the running scoreboard (any time).
    if (e.key === 'r' || e.key === 'R') {
      scores = { X: 0, O: 0, draw: 0 };
      saveScores();
      return;
    }
  });

  // ---- Drawing helpers ----------------------------------------
  function text(str, x, y, size, color, weight, align) {
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = align || 'center';
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

  // easeOutCubic — makes the stroke-in decelerate nicely.
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function cellCenter(i) {
    const col = i % 3, row = (i / 3) | 0;
    return { x: OX + col * CELL + CELL / 2, y: OY + row * CELL + CELL / 2 };
  }

  function drawGrid() {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(OX + i * CELL, OY + 8);
      ctx.lineTo(OX + i * CELL, OY + BOARD - 8);
      ctx.moveTo(OX + 8, OY + i * CELL);
      ctx.lineTo(OX + BOARD - 8, OY + i * CELL);
    }
    ctx.stroke();
  }

  // Draw an X as two diagonal strokes that "draw on" with progress.
  function drawX(i, p) {
    const c = cellCenter(i);
    const r = CELL * 0.27;
    const e = ease(Math.min(p, 1));
    // First stroke draws fully over the first half of progress,
    // then the second stroke draws over the second half.
    const s1 = Math.min(1, e / 0.5);
    const s2 = Math.max(0, (e - 0.5) / 0.5);

    ctx.save();
    ctx.strokeStyle = C.x;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.shadowColor = C.xGlow;
    ctx.shadowBlur = 12;

    // top-left -> bottom-right
    ctx.beginPath();
    ctx.moveTo(c.x - r, c.y - r);
    ctx.lineTo(c.x - r + 2 * r * s1, c.y - r + 2 * r * s1);
    ctx.stroke();

    // top-right -> bottom-left (second half)
    if (s2 > 0) {
      ctx.beginPath();
      ctx.moveTo(c.x + r, c.y - r);
      ctx.lineTo(c.x + r - 2 * r * s2, c.y - r + 2 * r * s2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw an O as an arc sweeping from the top, clockwise.
  function drawO(i, p) {
    const c = cellCenter(i);
    const r = CELL * 0.27;
    const e = ease(Math.min(p, 1));
    const start = -Math.PI / 2;             // start at 12 o'clock
    const end = start + Math.PI * 2 * e;     // sweep grows with progress

    ctx.save();
    ctx.strokeStyle = C.o;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.shadowColor = C.oGlow;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, start, end);
    ctx.stroke();
    ctx.restore();
  }

  function drawMarks() {
    for (let i = 0; i < 9; i++) {
      if (board[i] === 'X') drawX(i, progress[i]);
      else if (board[i] === 'O') drawO(i, progress[i]);
    }
  }

  // Bright pulsing line through the three winning cells.
  function drawWinLine() {
    if (!winLine) return;
    const a = cellCenter(winLine[0]);
    const c = cellCenter(winLine[2]);
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 110);

    ctx.save();
    ctx.strokeStyle = C.win;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 10 + pulse * 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = C.winGlow;
    ctx.shadowBlur = 18 + pulse * 14;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawHoverGhost() {
    if (state !== 'playing' || hoverCell < 0 || board[hoverCell]) return;
    if (mode === 'cpu' && current === 'O') return; // not your turn
    const col = hoverCell % 3, row = (hoverCell / 3) | 0;
    ctx.fillStyle = C.cellHover;
    ctx.fillRect(OX + col * CELL + 2, OY + row * CELL + 2, CELL - 4, CELL - 4);
  }

  function drawHUD() {
    // Title row: mode + whose turn / result.
    let modeLabel = mode === 'cpu' ? 'VS CPU' : 'HOTSEAT';
    text(modeLabel, OX, 30, 14, C.dim, 600, 'left');

    let status;
    if (state === 'over') {
      if (winner === 'draw') status = 'DRAW';
      else if (mode === 'cpu') status = winner === 'X' ? 'YOU WIN!' : 'CPU WINS';
      else status = winner + ' WINS';
    } else {
      if (mode === 'cpu') status = current === 'X' ? 'YOUR TURN' : 'CPU THINKING…';
      else status = current + ' TO MOVE';
    }
    const statusColor = state === 'over'
      ? (winner === 'draw' ? C.accent : (winner === 'X' ? C.x : C.o))
      : (current === 'X' ? C.x : C.o);
    text(status, WIDTH - OX, 30, 16, statusColor, 700, 'right');

    // Scoreboard row.
    const y = 64;
    const labelX = mode === 'cpu' ? 'X (you)' : 'X';
    const labelO = mode === 'cpu' ? 'O (cpu)' : 'O';
    text(labelX + '  ' + scores.X, OX + 6, y, 15, C.x, 600, 'left');
    text('DRAWS  ' + scores.draw, WIDTH / 2, y, 15, C.dim, 600, 'center');
    text(scores.O + '  ' + labelO, WIDTH - OX - 6, y, 15, C.o, 600, 'right');
  }

  function drawTitle() {
    ctx.fillStyle = 'rgba(8,11,18,0.82)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    text('TIC-TAC-TOE', WIDTH / 2, HEIGHT * 0.26, 40, C.accent, 800);

    // Little decorative X and O.
    text('X', WIDTH * 0.40, HEIGHT * 0.40, 44, C.x, 800);
    text('O', WIDTH * 0.60, HEIGHT * 0.40, 44, C.o, 800);

    text('Press  1  —  1 player vs CPU', WIDTH / 2, HEIGHT * 0.55, 19, C.text, 600);
    text('(perfect AI: you can draw, never win)', WIDTH / 2, HEIGHT * 0.60, 13, C.dim, 500);
    text('Press  2  —  2 players hotseat', WIDTH / 2, HEIGHT * 0.68, 19, C.text, 600);

    text('Click a cell to place  ·  R resets scores', WIDTH / 2, HEIGHT * 0.80, 14, C.accent, 600);
  }

  // ---- The frame ----------------------------------------------
  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Board + marks always render (title overlays on top) so the
    // canvas is never blank — the #1 rule.
    drawHoverGhost();
    drawGrid();
    drawMarks();
    if (state === 'over' && winner && winner !== 'draw') drawWinLine();
    drawHUD();

    if (state === 'title') drawTitle();

    // "Next round" nudge under the board during the pause.
    if (state === 'over') {
      text('click for next round', WIDTH / 2, OY + BOARD + 26, 13, C.dim, 500);
    }
  }

  // ---- Main loop ----------------------------------------------
  function loop(now) {
    const dt = Math.min(now - last, 100); // clamp tab-switch gaps
    last = now;

    // Advance stroke-in animations for any freshly placed marks.
    for (let i = 0; i < 9; i++) {
      if (board && board[i] && progress[i] < 1) {
        progress[i] = Math.min(1, progress[i] + dt / 220);
      }
    }
    if (winFlash > 0) winFlash = Math.max(0, winFlash - dt / 600);

    // CPU turn: think for a beat, then play its minimax move.
    if (state === 'playing' && mode === 'cpu' && current === 'O' && !winner) {
      cpuTimer -= dt;
      if (cpuTimer <= 0) {
        const move = bestCpuMove();
        if (move != null) place(move, 'O');
      }
    }

    // Auto-start the next round after the result pause.
    if (state === 'over') {
      restartTimer -= dt;
      if (restartTimer <= 0) {
        newRound();
        state = 'playing';
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  // ---- Go -----------------------------------------------------
  newRound();            // build a real board behind the title screen
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
