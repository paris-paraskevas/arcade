// ============================================================
//  MINESWEEPER  —  pure Canvas + vanilla JS, runs from file://
//  No libraries, no assets. Cells, numbers, the smiley face and
//  every banner are drawn procedurally; audio is WebAudio built
//  in code and started on the first user input.
//
//  The interesting bits are commented for a learner:
//    - first-click safety   (mines are placed AFTER the first reveal,
//                            never under it or its 8 neighbors)
//    - flood fill           (revealing a 0 opens its whole empty region
//                            plus the numbered border around it)
//    - win/lose detection   (win = every safe cell revealed)
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 560
  const H = canvas.height;  // 640

  // ---------- Board geometry ----------
  const COLS = 12;
  const ROWS = 14;
  const MINE_RATIO = 0.16;                                  // ~16% of cells are mines
  const MINES = Math.round(COLS * ROWS * MINE_RATIO);       // = 27

  // The header sits at the top; the grid fills the space beneath it.
  const HEADER_H = 64;
  const PAD = 16;                                           // outer margin around the grid
  const GRID_X = PAD;
  const GRID_Y = HEADER_H + PAD;
  const GRID_W = W - PAD * 2;
  const GRID_H = H - GRID_Y - PAD;
  // Square cells: pick the largest size that fits both dimensions, then
  // center the (possibly slightly smaller) grid in the available area.
  const CELL = Math.floor(Math.min(GRID_W / COLS, GRID_H / ROWS));
  const BOARD_W = CELL * COLS;
  const BOARD_H = CELL * ROWS;
  const BX = GRID_X + Math.floor((GRID_W - BOARD_W) / 2);   // board left
  const BY = GRID_Y + Math.floor((GRID_H - BOARD_H) / 2);   // board top

  // ---------- Palette ----------
  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';
  // Classic minesweeper number colors (1 blue … 8 grey), tuned for dark cells.
  const NUM_COLORS = [
    '',         // 0 (unused)
    '#5a9bff',  // 1 blue
    '#56d364',  // 2 green
    '#f0556a',  // 3 red
    '#b06cff',  // 4 purple
    '#ff9e3b',  // 5 orange
    '#36c5e0',  // 6 cyan
    '#cdd6e4',  // 7 light
    '#9aa6ba',  // 8 grey
  ];

  // ---------- Game state ----------
  // States: 'title' -> 'playing' -> 'won' | 'lost' -> 'playing'
  let state = 'title';
  let grid;                 // ROWS*COLS array of cell objects
  let minesPlaced;          // false until the first click seeds the mines
  let revealedCount;        // how many safe cells are open (for win check)
  let flagCount;            // flags currently planted
  let hitMine;              // {r,c} of the mine the player detonated (for the loss screen)
  let elapsed;              // seconds elapsed, shown in the header
  let timerRunning;         // ticks only while playing, after the first reveal
  let best;                 // fastest win in seconds (localStorage)
  let lastTime;             // for delta-time timing

  // Juice: a brief flash + light "shake" when something pops.
  let shake = 0;            // remaining shake time (ms)
  let particles = [];       // boom debris on a loss

  // ---------- A single cell ----------
  function makeCell() {
    return { mine: false, adj: 0, revealed: false, flagged: false };
  }

  // ---------- Best time (localStorage, fail-safe) ----------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('minesweeper.best') || '0', 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem('minesweeper.best', String(best)); } catch (e) { /* ignore */ }
  }
  best = loadBest();

  // ---------- Grid helpers ----------
  function idx(r, c) { return r * COLS + c; }
  function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  function makeGrid() {
    const g = new Array(ROWS * COLS);
    for (let i = 0; i < g.length; i++) g[i] = makeCell();
    return g;
  }

  // Visit the (up to) 8 neighbors of a cell, calling fn(r, c) for each.
  function forNeighbors(r, c, fn) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) fn(nr, nc);
      }
    }
  }

  // ---------- Mine placement (first-click safe) ----------
  // Called once, AFTER the player's first reveal. We forbid mines on the
  // clicked cell and its 8 neighbors so the first click always opens into
  // an empty region — the classic "you never die on move one" rule.
  function placeMines(safeR, safeC) {
    // Build the list of cells that are allowed to hold a mine.
    const forbidden = new Set();
    forbidden.add(idx(safeR, safeC));
    forNeighbors(safeR, safeC, (nr, nc) => forbidden.add(idx(nr, nc)));

    const candidates = [];
    for (let i = 0; i < grid.length; i++) {
      if (!forbidden.has(i)) candidates.push(i);
    }

    // Partial Fisher-Yates: shuffle just enough to pick MINES distinct cells.
    const want = Math.min(MINES, candidates.length);
    for (let i = 0; i < want; i++) {
      const j = i + ((Math.random() * (candidates.length - i)) | 0);
      const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
      grid[candidates[i]].mine = true;
    }

    // Precompute each non-mine cell's adjacent-mine count.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[idx(r, c)].mine) continue;
        let n = 0;
        forNeighbors(r, c, (nr, nc) => { if (grid[idx(nr, nc)].mine) n++; });
        grid[idx(r, c)].adj = n;
      }
    }
    minesPlaced = true;
  }

  // ---------- Reveal + flood fill ----------
  // Reveal one cell. If it's a 0, flood-fill outward: an explicit stack
  // opens every connected zero cell and the numbered cells bordering them.
  function reveal(r, c) {
    const start = grid[idx(r, c)];
    if (start.revealed || start.flagged) return;

    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const cell = grid[idx(cr, cc)];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      revealedCount++;
      // Only zero cells spread the flood; numbers form the border and stop it.
      if (cell.adj === 0 && !cell.mine) {
        forNeighbors(cr, cc, (nr, nc) => {
          const nb = grid[idx(nr, nc)];
          if (!nb.revealed && !nb.flagged) stack.push([nr, nc]);
        });
      }
    }
  }

  // ---------- Click handling ----------
  function primaryClickAt(r, c) {
    // First reveal of the game seeds the mines (so it can't be one) and
    // starts the clock.
    if (!minesPlaced) {
      placeMines(r, c);
      timerRunning = true;
      lastTime = 0;
    }

    const cell = grid[idx(r, c)];
    if (cell.revealed || cell.flagged) return;

    if (cell.mine) {
      loseGame(r, c);
      return;
    }

    reveal(r, c);
    blip(420, 0.05, 'square', 0.05);   // soft tick on a safe reveal
    checkWin();
  }

  function toggleFlagAt(r, c) {
    const cell = grid[idx(r, c)];
    if (cell.revealed) return;          // can't flag an open cell
    cell.flagged = !cell.flagged;
    flagCount += cell.flagged ? 1 : -1;
    blip(cell.flagged ? 660 : 300, 0.05, 'triangle', 0.06);
  }

  // ---------- Win / lose ----------
  function checkWin() {
    // You win the instant every non-mine cell is revealed.
    if (revealedCount >= ROWS * COLS - MINES) {
      state = 'won';
      timerRunning = false;
      // Auto-flag the remaining mines for a tidy finished board.
      for (let i = 0; i < grid.length; i++) {
        if (grid[i].mine && !grid[i].flagged) { grid[i].flagged = true; }
      }
      flagCount = MINES;
      if (best === 0 || elapsed < best) { best = elapsed; saveBest(); }
      winJingle();
    }
  }

  function loseGame(r, c) {
    state = 'lost';
    timerRunning = false;
    hitMine = { r, c };
    // Reveal the whole board so the player sees where every mine was.
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].mine) grid[i].revealed = true;
    }
    shake = 320;
    spawnBoom(BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2);
    boomSound();
  }

  // ---------- Particles (loss "boom") ----------
  function spawnBoom(x, y) {
    particles = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        r: 2 + Math.random() * 3,
      });
    }
  }

  // ---------- New game ----------
  function startGame() {
    grid = makeGrid();
    minesPlaced = false;
    revealedCount = 0;
    flagCount = 0;
    hitMine = null;
    elapsed = 0;
    timerRunning = false;       // clock waits for the first reveal
    shake = 0;
    particles = [];
    lastTime = 0;
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
      g.gain.value = vol || 0.07;
      o.connect(g); g.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);  // quick fade
      o.start(now);
      o.stop(now + dur);
    } catch (e) { /* audio must never break the game */ }
  }
  // A short noise burst through a falling low-pass: the mine "boom".
  function boomSound() {
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const dur = 0.5;
      const buf = audioCtx.createBuffer(1, (audioCtx.sampleRate * dur) | 0, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1200, now);
      lp.frequency.exponentialRampToValueAtTime(120, now + dur);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
      src.start(now);
      src.stop(now + dur);
    } catch (e) { /* ignore */ }
  }
  // A little rising arpeggio on a win.
  function winJingle() {
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < notes.length; i++) {
      setTimeout(() => blip(notes[i], 0.18, 'triangle', 0.1), i * 90);
    }
  }

  // ---------- Update ----------
  function update(dt) {
    if (timerRunning && state === 'playing') {
      elapsed += dt / 1000;
    }
    if (shake > 0) shake = Math.max(0, shake - dt);

    // Advance loss particles.
    if (particles.length) {
      const s = dt / 1000;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * s;
        p.y += p.vy * s;
        p.vy += 520 * s;          // gravity
        p.vx *= 0.98;
        p.life -= s;
        if (p.life <= 0) particles.splice(i, 1);
      }
    }
  }

  // ---------- Rendering ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // A raised, beveled (un-revealed) cell.
  function drawCovered(x, y, s) {
    const m = 1;                       // tiny gap so cells read as separate tiles
    ctx.fillStyle = '#2a313f';
    ctx.fillRect(x + m, y + m, s - m * 2, s - m * 2);
    // top/left highlight
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + m, y + m, s - m * 2, 2);
    ctx.fillRect(x + m, y + m, 2, s - m * 2);
    // bottom/right shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + m, y + s - m - 2, s - m * 2, 2);
    ctx.fillRect(x + s - m - 2, y + m, 2, s - m * 2);
  }

  // A sunken (revealed) cell.
  function drawOpen(x, y, s) {
    const m = 1;
    ctx.fillStyle = '#171c25';
    ctx.fillRect(x + m, y + m, s - m * 2, s - m * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + m + 0.5, y + m + 0.5, s - m * 2 - 1, s - m * 2 - 1);
  }

  function drawFlag(x, y, s) {
    const cx = x + s * 0.5;
    const poleX = x + s * 0.40;
    const top = y + s * 0.24;
    const bot = y + s * 0.74;
    // pole
    ctx.strokeStyle = '#cdd6e4';
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(poleX, top);
    ctx.lineTo(poleX, bot);
    ctx.stroke();
    // base
    ctx.fillStyle = '#cdd6e4';
    ctx.fillRect(x + s * 0.28, bot - 1, s * 0.34, Math.max(2, s * 0.06));
    // flag cloth
    ctx.fillStyle = '#f0556a';
    ctx.beginPath();
    ctx.moveTo(poleX, top);
    ctx.lineTo(poleX + s * 0.26, top + s * 0.11);
    ctx.lineTo(poleX, top + s * 0.22);
    ctx.closePath();
    ctx.fill();
    // suppress unused-var lint clarity
    void cx;
  }

  function drawMine(x, y, s, detonated) {
    const cx = x + s / 2, cy = y + s / 2;
    const rad = s * 0.22;
    if (detonated) {
      ctx.fillStyle = '#f0556a';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
    ctx.fillStyle = detonated ? '#1a0f12' : '#0c0f15';
    // spikes
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(2, s * 0.06);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * rad * 1.55, cy + Math.sin(ang) * rad * 1.55);
      ctx.stroke();
    }
    // body
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(cx - rad * 0.3, cy - rad * 0.3, rad * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawNumber(x, y, s, n) {
    ctx.fillStyle = NUM_COLORS[n] || TEXT;
    ctx.font = `700 ${Math.floor(s * 0.56)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x + s / 2, y + s / 2 + s * 0.04);
  }

  // The smiley/face button in the header — changes with game state.
  function drawFace(cx, cy, r) {
    // disc
    ctx.fillStyle = '#f5d743';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#1a1206';
    ctx.strokeStyle = '#1a1206';
    const ey = cy - r * 0.18;
    const ex = r * 0.34;

    if (state === 'lost') {
      // dead face: X eyes + frown
      ctx.lineWidth = Math.max(2, r * 0.12);
      const e = r * 0.13;
      [[cx - ex, ey], [cx + ex, ey]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.moveTo(px - e, py - e); ctx.lineTo(px + e, py + e);
        ctx.moveTo(px + e, py - e); ctx.lineTo(px - e, py + e);
        ctx.stroke();
      });
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.55, r * 0.34, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (state === 'won') {
      // cool face: sunglasses + grin
      ctx.fillRect(cx - r * 0.55, ey - r * 0.06, r * 0.42, r * 0.26);
      ctx.fillRect(cx + r * 0.13, ey - r * 0.06, r * 0.42, r * 0.26);
      ctx.fillRect(cx - r * 0.13, ey + r * 0.0, r * 0.26, r * 0.07);
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.18, r * 0.4, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    } else {
      // smile
      ctx.beginPath(); ctx.arc(cx - ex, ey, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + ex, ey, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.12, r * 0.42, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }

  // A small "LED" style number readout (mines left / timer).
  function drawReadout(x, y, w, h, value) {
    roundRect(x, y, w, h, 6);
    ctx.fillStyle = '#0a0d13';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0556a';
    ctx.font = `700 ${Math.floor(h * 0.62)}px "Consolas", "Segoe UI", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x + w / 2, y + h / 2 + 1);
  }

  function pad3(n) {
    n = Math.max(-99, Math.min(999, n | 0));
    if (n < 0) return '-' + String(-n).padStart(2, '0');
    return String(n).padStart(3, '0');
  }

  // Face button hit-box (also used by the click handler).
  function faceRect() {
    const r = 22;
    return { cx: W / 2, cy: HEADER_H / 2, r, x: W / 2 - r, y: HEADER_H / 2 - r, w: r * 2, h: r * 2 };
  }

  function drawHeader() {
    // header bar
    ctx.fillStyle = '#1b212c';
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, HEADER_H - 2, W, 2);

    const rh = 30, rw = 78, ry = (HEADER_H - rh) / 2;
    // mines remaining (mines minus flags planted)
    drawReadout(PAD, ry, rw, rh, pad3(MINES - flagCount));
    // timer
    drawReadout(W - PAD - rw, ry, rw, rh, pad3(Math.floor(elapsed)));

    const f = faceRect();
    drawFace(f.cx, f.cy, f.r);
  }

  function drawBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = BX + c * CELL;
        const y = BY + r * CELL;
        const cell = grid[idx(r, c)];
        if (cell.revealed) {
          drawOpen(x, y, CELL);
          if (cell.mine) {
            const det = hitMine && hitMine.r === r && hitMine.c === c;
            drawMine(x, y, CELL, det);
          } else if (cell.adj > 0) {
            drawNumber(x, y, CELL, cell.adj);
          }
        } else {
          drawCovered(x, y, CELL);
          if (cell.flagged) drawFlag(x, y, CELL);
        }
      }
    }
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = i % 2 ? '#f0556a' : '#ff9e3b';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Centered banner used by title / win / lose overlays.
  function banner(lines) {
    ctx.fillStyle = 'rgba(7,9,16,0.74)';
    ctx.fillRect(0, 0, W, H);
    let y = H / 2 - (lines.length - 1) * 22;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      ctx.fillStyle = ln.color || TEXT;
      ctx.font = ln.font || `600 ${ln.size || 18}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ln.text, W / 2, y);
      y += (ln.gap || 30);
    }
  }

  function render() {
    // background
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, W, H);

    // screen-shake offset (only the playfield jolts)
    let sx = 0, sy = 0;
    if (shake > 0) {
      const k = shake / 320;
      sx = (Math.random() * 2 - 1) * 6 * k;
      sy = (Math.random() * 2 - 1) * 6 * k;
    }

    ctx.save();
    ctx.translate(sx, sy);
    drawBoard();
    drawParticles();
    ctx.restore();

    drawHeader();  // header stays steady above the jolt

    if (state === 'title') {
      banner([
        { text: 'MINESWEEPER', color: ACCENT, size: 30, gap: 44, font: '600 30px "Segoe UI", system-ui, sans-serif' },
        { text: `${COLS} × ${ROWS} grid  ·  ${MINES} mines`, color: TEXT, size: 16, gap: 30 },
        { text: 'Left-click to reveal · Right-click to flag', color: MUTED, size: 14, gap: 24 },
        { text: 'The first click is always safe.', color: MUTED, size: 14, gap: 40 },
        { text: 'Click anywhere to begin', color: ACCENT, size: 16, gap: 26 },
        best > 0 ? { text: `Best time: ${best}s`, color: MUTED, size: 13, gap: 20 } : { text: '', size: 1, gap: 0 },
      ]);
    } else if (state === 'won') {
      banner([
        { text: 'CLEARED!', color: '#56d364', size: 34, gap: 46, font: '700 34px "Segoe UI", system-ui, sans-serif' },
        { text: `Time: ${Math.floor(elapsed)}s` + (best > 0 ? `   ·   Best: ${best}s` : ''), color: TEXT, size: 16, gap: 34 },
        { text: 'Click the face or press R to play again', color: ACCENT, size: 15, gap: 24 },
      ]);
    } else if (state === 'lost') {
      banner([
        { text: 'BOOM', color: '#f0556a', size: 38, gap: 48, font: '700 38px "Segoe UI", system-ui, sans-serif' },
        { text: 'You hit a mine.', color: TEXT, size: 16, gap: 34 },
        { text: 'Click the face or press R to try again', color: ACCENT, size: 15, gap: 24 },
      ]);
    }
  }

  // ---------- Main loop (delta-time, clamped) ----------
  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100;       // clamp after a tab-switch so the timer doesn't jump
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Pointer → cell ----------
  // Translate a mouse event (CSS pixels) into a board cell, accounting for
  // the canvas being scaled down by CSS. Returns {r,c} or null.
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const c = Math.floor((px - BX) / CELL);
    const r = Math.floor((py - BY) / CELL);
    if (!inBounds(r, c)) return null;
    return { r, c, px, py };
  }

  function hitFace(px, py) {
    const f = faceRect();
    return px >= f.x && px <= f.x + f.w && py >= f.y && py <= f.y + f.h;
  }

  // ---------- Input ----------
  canvas.addEventListener('mousedown', (e) => {
    initAudio();                  // browsers need a user gesture before audio
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    // The face button restarts from any state.
    if (hitFace(px, py)) {
      startGame();
      blip(520, 0.06, 'square', 0.08);
      return;
    }

    if (state === 'title') {
      startGame();
      // fall through so this same click also reveals the cell under it
    }

    if (state !== 'playing') return;

    const cell = cellFromEvent(e);
    if (!cell) return;

    if (e.button === 2) {
      toggleFlagAt(cell.r, cell.c);     // right-click flags
    } else if (e.button === 0) {
      primaryClickAt(cell.r, cell.c);   // left-click reveals
    }
  });

  // Disable the browser context menu on the canvas so right-click can flag.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    initAudio();
    if (e.key === 'r' || e.key === 'R') {
      startGame();
      blip(520, 0.06, 'square', 0.08);
    }
  });

  // ---------- Go (initialize ALL state at load) ----------
  // The title screen runs update()+render() too, so the grid and every
  // counter must already be valid before the first frame — never undefined.
  startGame();
  state = 'title';                // show the title; startGame primed the board
  requestAnimationFrame(frame);
})();
