// ============================================================
//  MATCH THREE  —  a Bejeweled-style gem swapper.
//  Pure HTML5 Canvas + vanilla JS, runs straight from file://.
//  No libraries, no images, no audio files — every gem shape and
//  every sound is generated procedurally in code.
//
//  The interesting bits are commented for a learner:
//    - match detection      (scan rows + cols for runs of 3+)
//    - the gravity refill    (gems fall into gaps, new ones drop in)
//    - cascades              (clearing can trigger new matches -> combos)
//    - the swap legality test (only swaps that make a match are allowed)
//    - a "phase" state machine that drives all the animation so input
//      is locked while gems are sliding / popping / falling.
// ============================================================
(() => {
  'use strict';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 540
  const H = canvas.height;  // 640

  // ---------- Board geometry ----------
  const N = 8;                       // 8x8 grid
  const CELL = 58;                   // px per gem cell
  const BOARD = N * CELL;            // 464
  const BX = (W - BOARD) / 2;        // left edge of board (38px margin)
  const BY = 150;                    // top edge — leaves room for the HUD
  const GEM_R = CELL * 0.40;         // gem "radius" used by the shape drawers

  // ---------- Gems ----------
  // Seven distinct gem types, each with its own colour AND its own shape so
  // the board is readable even without relying on colour alone.
  const TYPES = 7;
  const GEM = [
    { name: 'ruby',     shape: 'diamond',  c: '#ff5d6c', hi: '#ffb3ba', dk: '#a01f2c' },
    { name: 'emerald',  shape: 'square',   c: '#3ad97f', hi: '#a9f5c9', dk: '#157a40' },
    { name: 'sapphire', shape: 'circle',   c: '#4d8dff', hi: '#b3cfff', dk: '#1d4ba8' },
    { name: 'topaz',    shape: 'triangle', c: '#ffce4d', hi: '#fff0b3', dk: '#a8821d' },
    { name: 'amethyst', shape: 'hexagon',  c: '#b86dff', hi: '#e1c2ff', dk: '#6f2db8' },
    { name: 'citrine',  shape: 'star',     c: '#ff9b3d', hi: '#ffd9b3', dk: '#a85e15' },
    { name: 'aqua',     shape: 'pentagon', c: '#33d6d6', hi: '#b3f0f0', dk: '#157a7a' },
  ];

  const TEXT = '#cdd6e4';
  const ACCENT = '#9fb4d4';
  const MUTED = '#6b7890';

  // ---------- Tuning ----------
  const START_MOVES = 25;            // a round lasts this many swaps
  const SWAP_TIME = 140;             // ms for the swap-slide animation
  const POP_TIME = 240;              // ms for the clear/pop animation
  const FALL_GRAV = 2600;            // px/s^2 gravity for falling gems
  const BASE_MATCH = 30;             // points per gem in a match

  // ---------- Game state ----------
  // grid[r][c] holds a gem type (0..TYPES-1) or -1 for an empty hole.
  // states: 'title' -> 'playing' -> 'over'
  // While 'playing', a `phase` sub-state machine sequences the animation:
  //   'idle'    accepting input
  //   'swap'    two gems sliding toward each other
  //   'unswap'  an illegal swap sliding back
  //   'pop'     matched gems shrinking out
  //   'fall'    gems falling + new gems dropping in to refill
  let state = 'title';
  let phase = 'idle';

  let grid;                          // N x N of gem types (or -1)
  let score, best, moves;
  let combo;                         // current cascade depth (1,2,3,...)

  // Per-cell visual offset used for slide & fall animation. offY[r][c] is the
  // number of pixels a gem is drawn ABOVE its true cell (positive = higher).
  // offX handles the horizontal slide during a swap.
  let offX, offY, vel;               // vel = current fall speed per cell (px/s)

  // Selection / dragging.
  let sel = null;                    // {r,c} of the currently selected gem
  let dragFrom = null;               // {r,c} where a press began (for drag-swap)
  let pressPx = null;                // pixel pos of the press (to measure drag)

  // Swap animation bookkeeping.
  let swapA = null, swapB = null;    // the two cells being swapped
  let swapT = 0;                     // 0..1 progress

  // Pop animation bookkeeping.
  let popping = [];                  // [{r,c,type}] cells currently popping
  let popT = 0;                      // 0..1 progress

  // Particles (gem shards on pop) + floating combo popups.
  let particles = [];
  let popups = [];                   // [{x,y,text,life,color,vy}]
  let shake = 0;                     // screen-shake magnitude (px)

  let lastTime = 0;

  // ---------- Persistent best (localStorage, fail-safe) ----------
  function loadBest() {
    try {
      const b = parseInt(localStorage.getItem('m3.best') || '0', 10);
      best = Number.isFinite(b) ? b : 0;
    } catch (e) { best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem('m3.best', String(best)); } catch (e) { /* ignore */ }
  }

  // ---------- Grid helpers ----------
  function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function randType() { return (Math.random() * TYPES) | 0; }

  function makeGrid() {
    const g = new Array(N);
    for (let r = 0; r < N; r++) g[r] = new Array(N).fill(-1);
    return g;
  }
  // Allocate the per-cell animation buffers.
  function makeBuffers() {
    offX = makeGrid(); offY = makeGrid(); vel = makeGrid();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) { offX[r][c] = 0; offY[r][c] = 0; vel[r][c] = 0; }
    }
  }

  // Build a fresh board with NO pre-existing matches, and guarantee at least
  // one legal move exists (reshuffle from scratch until both hold).
  function freshBoard() {
    let guard = 0;
    do {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          // Pick a type that does not immediately complete a 3-run with the
          // two cells to the left or above — the cheap way to seed a board
          // that starts with zero matches.
          let t;
          let tries = 0;
          do {
            t = randType();
            tries++;
          } while (tries < 20 && (
            (c >= 2 && grid[r][c - 1] === t && grid[r][c - 2] === t) ||
            (r >= 2 && grid[r - 1][c] === t && grid[r - 2][c] === t)
          ));
          grid[r][c] = t;
        }
      }
      guard++;
    } while (guard < 50 && (findMatches().length > 0 || !hasAnyMove()));
  }

  // ---------- Match detection ----------
  // Scan every row then every column for a run of 3+ identical gems and
  // collect the matched cell coordinates into a Set (so overlaps at corners
  // of an L/T shape aren't double-counted). Returns an array of "r*N+c" keys.
  function findMatches() {
    const hits = new Set();
    // Horizontal runs
    for (let r = 0; r < N; r++) {
      let run = 1;
      for (let c = 1; c <= N; c++) {
        const same = c < N && grid[r][c] !== -1 && grid[r][c] === grid[r][c - 1];
        if (same) { run++; }
        else {
          if (run >= 3) for (let k = 0; k < run; k++) hits.add(r * N + (c - 1 - k));
          run = 1;
        }
      }
    }
    // Vertical runs
    for (let c = 0; c < N; c++) {
      let run = 1;
      for (let r = 1; r <= N; r++) {
        const same = r < N && grid[r][c] !== -1 && grid[r][c] === grid[r - 1][c];
        if (same) { run++; }
        else {
          if (run >= 3) for (let k = 0; k < run; k++) hits.add((r - 1 - k) * N + c);
          run = 1;
        }
      }
    }
    return Array.from(hits);
  }

  // Would swapping (r1,c1) with (r2,c2) create at least one match?
  // We swap on the real grid, test, then swap back — no clone needed.
  function swapMakesMatch(r1, c1, r2, c2) {
    const a = grid[r1][c1], b = grid[r2][c2];
    grid[r1][c1] = b; grid[r2][c2] = a;
    const ok = findMatches().length > 0;
    grid[r1][c1] = a; grid[r2][c2] = b;   // restore
    return ok;
  }

  // Is there ANY legal swap on the board? (used to detect a dead board.)
  // Try swapping each cell with its right and down neighbour.
  function hasAnyMove() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (c + 1 < N && swapMakesMatch(r, c, r, c + 1)) return true;
        if (r + 1 < N && swapMakesMatch(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  // ---------- Round flow ----------
  function startGame() {
    grid = makeGrid();
    makeBuffers();
    freshBoard();
    score = 0;
    moves = START_MOVES;
    combo = 0;
    sel = null; dragFrom = null; pressPx = null;
    swapA = swapB = null; swapT = 0;
    popping = []; popT = 0;
    particles = []; popups = []; shake = 0;
    state = 'playing';
    phase = 'idle';
  }

  function endGame() {
    state = 'over';
    phase = 'idle';
    sel = null;
    if (score > best) { best = score; saveBest(); }
    sfxGameOver();
  }

  // ---------- Pixel <-> cell mapping ----------
  function cellX(c) { return BX + c * CELL; }
  function cellY(r) { return BY + r * CELL; }
  function centerX(c) { return BX + c * CELL + CELL / 2; }
  function centerY(r) { return BY + r * CELL + CELL / 2; }

  // Convert a client (mouse/touch) coordinate to a grid cell, accounting for
  // the canvas being CSS-scaled to fit the page. Returns {r,c} or null.
  function cellFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = W / rect.width, sy = H / rect.height;
    const x = (clientX - rect.left) * sx;
    const y = (clientY - rect.top) * sy;
    const c = Math.floor((x - BX) / CELL);
    const r = Math.floor((y - BY) / CELL);
    if (!inBounds(r, c)) return null;
    return { r, c };
  }

  // ---------- Initiating a swap ----------
  // Only adjacent (orthogonal, distance 1) cells may swap.
  function adjacent(a, b) {
    return (a.r === b.r && Math.abs(a.c - b.c) === 1) ||
           (a.c === b.c && Math.abs(a.r - b.r) === 1);
  }

  // Begin a swap animation between two adjacent cells.
  function beginSwap(a, b) {
    swapA = { r: a.r, c: a.c };
    swapB = { r: b.r, c: b.c };
    swapT = 0;
    phase = 'swap';
    sel = null;
    sfxSwap();
  }

  // Commit the gem-type swap on the grid (called at the midpoint of the
  // slide so the visuals line up), then decide legal vs illegal.
  function commitSwap() {
    const ta = grid[swapA.r][swapA.c];
    const tb = grid[swapB.r][swapB.c];
    grid[swapA.r][swapA.c] = tb;
    grid[swapB.r][swapB.c] = ta;
  }

  // ---------- Resolving matches (the cascade engine) ----------
  // Mark all currently-matched cells for popping. Returns how many matched.
  function startPop() {
    const hits = findMatches();
    if (hits.length === 0) return 0;
    combo++;
    popping = hits.map((k) => {
      const r = (k / N) | 0, c = k % N;
      return { r, c, type: grid[r][c] };
    });
    popT = 0;
    phase = 'pop';

    // Score: each gem is worth BASE_MATCH, multiplied by the combo depth so
    // chain reactions pay off big. A nice rising "ding" matches the combo.
    const gained = popping.length * BASE_MATCH * combo;
    score += gained;

    // Combo popup text floats up from the centroid of the cleared gems.
    let sx = 0, sy = 0;
    for (const p of popping) { sx += centerX(p.c); sy += centerY(p.r); }
    sx /= popping.length; sy /= popping.length;
    const label = combo > 1 ? ('COMBO x' + combo) : ('+' + gained);
    popups.push({ x: sx, y: sy, text: label, life: 1, vy: -34, color: combo > 1 ? '#ffd95e' : ACCENT });
    if (combo > 1) popups.push({ x: sx, y: sy + 22, text: '+' + gained, life: 1, vy: -28, color: TEXT });

    // Juice: shard particles + a touch of shake that grows with the combo.
    for (const p of popping) spawnShards(p.r, p.c, p.type);
    shake = Math.min(10, 2 + combo * 1.5);
    sfxMatch(combo, popping.length);
    return popping.length;
  }

  // After the pop animation finishes: blank the popped cells, then make gems
  // above fall down and spawn new gems entering from the top. We set up the
  // visual offsets so everything animates from its old position.
  function applyGravityAndRefill() {
    // 1) Clear popped cells.
    for (const p of popping) grid[p.r][p.c] = -1;
    popping = [];

    // 2) For each column, compact non-empty gems toward the bottom, then fill
    //    the top with brand-new random gems. We track how far each gem moved
    //    (in cells) so we can animate the fall from above.
    for (let c = 0; c < N; c++) {
      // Pull existing gems down.
      let write = N - 1;                 // next row to place a gem into (bottom-up)
      for (let r = N - 1; r >= 0; r--) {
        if (grid[r][c] !== -1) {
          const t = grid[r][c];
          if (write !== r) {
            grid[write][c] = t;
            grid[r][c] = -1;
            // It fell (write - r) cells: start it that many cells higher.
            offY[write][c] = (write - r) * CELL;
            vel[write][c] = 0;
          }
          write--;
        }
      }
      // Fill the remaining top cells with new gems, stacked above the board so
      // they drop in. `write` now points at the lowest empty cell.
      let spawnIndex = 1;
      for (let r = write; r >= 0; r--) {
        grid[r][c] = randType();
        // Each new gem starts above the visible top, staggered by depth so a
        // column of newcomers streams in rather than teleporting as a block.
        offY[r][c] = (write - r + spawnIndex) * CELL + (r + 1) * 6;
        vel[r][c] = 0;
        spawnIndex++;
      }
    }
    phase = 'fall';
  }

  // ---------- Update: the phase state machine ----------
  function update(dt) {
    const s = dt / 1000;
    updateParticles(dt);
    updatePopups(dt);
    if (shake > 0) { shake -= dt * 0.03; if (shake < 0) shake = 0; }

    if (state !== 'playing') return;

    if (phase === 'swap' || phase === 'unswap') {
      swapT += dt / SWAP_TIME;
      // Commit the grid swap exactly once, at the visual midpoint.
      if (phase === 'swap' && swapT >= 0.5 && !swapA.done) {
        swapA.done = true;
        commitSwap();
      }
      if (swapT >= 1) {
        swapT = 1;
        if (phase === 'swap') {
          // The grid is now swapped. Legal if it produced a match.
          if (findMatches().length > 0) {
            moves--;                         // a successful move is spent here
            combo = 0;                       // fresh cascade chain
            swapA = swapB = null;
            startPop();
          } else {
            // Illegal: animate the gems sliding back, undoing the grid swap.
            commitSwap();                    // swap types back
            phase = 'unswap';
            swapT = 0;
            swapA.done = false;
            sfxBad();
          }
        } else {
          // Unswap finished — back to idle, no move spent.
          swapA = swapB = null;
          phase = 'idle';
        }
      }
      return;
    }

    if (phase === 'pop') {
      popT += dt / POP_TIME;
      if (popT >= 1) { popT = 1; applyGravityAndRefill(); }
      return;
    }

    if (phase === 'fall') {
      // Integrate gravity on every cell that still has a positive offset.
      let moving = false;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (offY[r][c] > 0) {
            vel[r][c] += FALL_GRAV * s;
            offY[r][c] -= vel[r][c] * s;
            if (offY[r][c] <= 0) {
              offY[r][c] = 0; vel[r][c] = 0;
              // tiny settle puff + click as a gem lands
              if (Math.random() < 0.5) sfxTick(560 + Math.random() * 120);
            } else {
              moving = true;
            }
          }
        }
      }
      if (!moving) {
        // Everything has settled. Resolve a possible cascade.
        if (findMatches().length > 0) {
          startPop();                        // -> chains the combo (combo++)
        } else {
          // Board is stable. If it's now a dead board, reshuffle it.
          if (!hasAnyMove()) reshuffle();
          combo = 0;
          phase = 'idle';
          if (moves <= 0) endGame();
        }
      }
      return;
    }
  }

  // Reshuffle the existing gems (keep the multiset) until there's a legal move
  // and no immediate matches. Gives a quick flash so the player notices.
  function reshuffle() {
    const flat = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) flat.push(grid[r][c]);
    let guard = 0;
    do {
      // Fisher-Yates shuffle.
      for (let i = flat.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = flat[i]; flat[i] = flat[j]; flat[j] = tmp;
      }
      let k = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) grid[r][c] = flat[k++];
      guard++;
    } while (guard < 80 && (findMatches().length > 0 || !hasAnyMove()));
    shake = 6;
    popups.push({ x: W / 2, y: BY + BOARD / 2, text: 'SHUFFLE!', life: 1, vy: -20, color: '#ffd95e' });
    sfxShuffle();
  }

  // ---------- Particles (gem shards) ----------
  function spawnShards(r, c, type) {
    const g = GEM[type];
    const cx = centerX(c), cy = centerY(r);
    const n = 7 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 220;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        life: 1, decay: 1.1 + Math.random() * 1.1,
        size: 3 + Math.random() * 4,
        color: Math.random() < 0.5 ? g.c : g.hi,
        spin: (Math.random() - 0.5) * 14,
        rot: Math.random() * Math.PI,
      });
    }
  }
  function updateParticles(dt) {
    const s = dt / 1000;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 700 * s;
      p.x += p.vx * s; p.y += p.vy * s;
      p.rot += p.spin * s;
      p.life -= p.decay * s;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function updatePopups(dt) {
    const s = dt / 1000;
    for (let i = popups.length - 1; i >= 0; i--) {
      const u = popups[i];
      u.y += u.vy * s;
      u.life -= s * 0.9;
      if (u.life <= 0) popups.splice(i, 1);
    }
  }

  // ============================================================
  //  Audio — WebAudio, created lazily on first input, fail-safe.
  // ============================================================
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // Generic short tone. Every call is wrapped so audio can NEVER break play.
  function tone(freq, dur, type, vol, when) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + (when || 0);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* never throw from audio */ }
  }
  function sfxSwap()  { tone(420, 0.08, 'sine', 0.06); }
  function sfxBad()   { tone(180, 0.14, 'sawtooth', 0.07); tone(120, 0.16, 'sawtooth', 0.05, 0.04); }
  function sfxTick(f) { tone(f, 0.05, 'square', 0.04); }
  function sfxShuffle() {
    for (let i = 0; i < 5; i++) tone(300 + i * 60, 0.06, 'triangle', 0.05, i * 0.05);
  }
  // Match sound: pitch RISES with the combo depth so chains feel escalating.
  function sfxMatch(comboDepth, count) {
    const base = 440 * Math.pow(2, Math.min(comboDepth - 1, 8) / 12);
    tone(base, 0.10, 'triangle', 0.09);
    tone(base * 1.5, 0.12, 'sine', 0.07, 0.05);
    if (count >= 4) tone(base * 2, 0.14, 'sine', 0.06, 0.1);  // bonus sparkle for big clears
  }
  function sfxGameOver() {
    const notes = [392, 330, 262];
    for (let i = 0; i < notes.length; i++) tone(notes[i], 0.22, 'triangle', 0.09, i * 0.14);
  }

  // ============================================================
  //  Rendering
  // ============================================================

  // Draw a single gem of `type` centred at (x,y), scaled by `scale`
  // (1 = normal). Each gem type has a distinct silhouette plus a glossy
  // radial fill and a bright facet highlight so they look like cut stones.
  function drawGem(x, y, type, scale, alpha) {
    const g = GEM[type];
    const R = GEM_R * scale;
    if (R <= 0.5) return;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);

    // Glossy fill gradient (light from the upper-left).
    const grad = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.15);
    grad.addColorStop(0, g.hi);
    grad.addColorStop(0.45, g.c);
    grad.addColorStop(1, g.dk);
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;

    pathForShape(g.shape, R);
    ctx.fill();
    ctx.stroke();

    // Facet highlight: a small bright shape offset to the upper-left.
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-R * 0.28, -R * 0.32, R * 0.26, R * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Trace the outline for a given gem shape, centred at the current origin.
  function pathForShape(shape, R) {
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(0, 0, R, 0, Math.PI * 2);
    } else if (shape === 'square') {
      const s = R * 0.92, rr = R * 0.22;
      roundRectPath(-s, -s, s * 2, s * 2, rr);
    } else if (shape === 'diamond') {
      ctx.moveTo(0, -R * 1.12);
      ctx.lineTo(R * 0.92, 0);
      ctx.lineTo(0, R * 1.12);
      ctx.lineTo(-R * 0.92, 0);
      ctx.closePath();
    } else if (shape === 'triangle') {
      ctx.moveTo(0, -R * 1.05);
      ctx.lineTo(R * 0.98, R * 0.8);
      ctx.lineTo(-R * 0.98, R * 0.8);
      ctx.closePath();
    } else if (shape === 'star') {
      polyStar(5, R * 1.08, R * 0.5);
    } else if (shape === 'hexagon') {
      polyReg(6, R, Math.PI / 6);
    } else if (shape === 'pentagon') {
      polyReg(5, R * 1.02, -Math.PI / 2);
    } else {
      ctx.arc(0, 0, R, 0, Math.PI * 2);
    }
  }
  function polyReg(sides, R, rot) {
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const px = Math.cos(a) * R, py = Math.sin(a) * R;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function polyStar(points, outer, inner) {
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
      const rad = (i % 2 === 0) ? outer : inner;
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); roundRectPath(x, y, w, h, r); }

  function label(text, x, y, color, size, weight, align) {
    ctx.fillStyle = color;
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  // The board frame + a subtle checker so empty/holes read as a grid.
  function drawBoardBg() {
    roundRect(BX - 10, BY - 10, BOARD + 20, BOARD + 20, 16);
    const fg = ctx.createLinearGradient(0, BY, 0, BY + BOARD);
    fg.addColorStop(0, '#1a2030');
    fg.addColorStop(1, '#11151f');
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(159,180,212,0.12)';
    ctx.stroke();

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if ((r + c) % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.022)';
          ctx.fillRect(cellX(c), cellY(r), CELL, CELL);
        }
      }
    }
  }

  // Draw all gems, applying the per-cell slide (swap) and fall offsets.
  function drawGems() {
    // Cells currently popping are drawn separately (shrinking), so skip them.
    const popSet = new Set(popping.map((p) => p.r * N + p.c));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = grid[r][c];
        if (t === -1) continue;
        if (popSet.has(r * N + c)) continue;

        let x = centerX(c);
        let y = centerY(r) - offY[r][c];

        // Swap slide: ease the two swapping gems toward each other's cell.
        if ((phase === 'swap' || phase === 'unswap') && swapA && swapB) {
          const e = easeInOut(swapT);
          if (r === swapA.r && c === swapA.c) {
            x = centerX(c) + (centerX(swapB.c) - centerX(c)) * e;
            y = centerY(r) + (centerY(swapB.r) - centerY(r)) * e;
          } else if (r === swapB.r && c === swapB.c) {
            x = centerX(c) + (centerX(swapA.c) - centerX(c)) * e;
            y = centerY(r) + (centerY(swapA.r) - centerY(r)) * e;
          }
        }

        // Selected gem gets a gentle pulse so it's obvious what's picked.
        let scale = 1;
        if (sel && sel.r === r && sel.c === c) {
          scale = 1 + 0.06 * Math.sin(performance.now() / 110);
          // selection ring
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#fff';
          ctx.shadowBlur = 10;
          roundRect(cellX(c) + 3, cellY(r) + 3, CELL - 6, CELL - 6, 10);
          ctx.stroke();
          ctx.restore();
        }
        drawGem(x, y, t, scale, 1);
      }
    }

    // Popping gems: shrink + fade + spin a touch.
    if (popping.length) {
      const e = 1 - popT;                  // shrink from 1 -> 0
      for (const p of popping) {
        ctx.save();
        ctx.translate(centerX(p.c), centerY(p.r));
        ctx.rotate(popT * 1.2);
        ctx.translate(-centerX(p.c), -centerY(p.r));
        drawGem(centerX(p.c), centerY(p.r), p.type, Math.max(0, e), Math.max(0, e));
        ctx.restore();
      }
      // a soft flash where each gem clears
      for (const p of popping) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, e) * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(centerX(p.c), centerY(p.r), GEM_R * (0.6 + popT * 0.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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

  function drawPopups() {
    for (let i = 0; i < popups.length; i++) {
      const u = popups[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, u.life));
      const sz = u.text.indexOf('COMBO') === 0 ? 22 : 17;
      label(u.text, u.x, u.y, u.color, sz, 800, 'center');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // HUD: SCORE (left), MOVES (centre big), BEST (right) + a moves bar.
  function drawHud() {
    label('SCORE', BX, 36, MUTED, 12, 700, 'left');
    label(String(score), BX, 64, TEXT, 28, 800, 'left');

    label('BEST', BX + BOARD, 36, MUTED, 12, 700, 'right');
    label(String(best), BX + BOARD, 64, ACCENT, 22, 800, 'right');

    label('MOVES LEFT', W / 2, 36, MUTED, 12, 700, 'center');
    const movesColor = moves <= 5 ? '#ff7a85' : TEXT;
    label(String(Math.max(0, moves)), W / 2, 70, movesColor, 30, 800, 'center');

    // Moves progress bar just above the board.
    const barW = BOARD, barX = BX, barY = BY - 30, barH = 8;
    roundRect(barX, barY, barW, barH, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    const frac = Math.max(0, Math.min(1, moves / START_MOVES));
    if (frac > 0) {
      roundRect(barX, barY, barW * frac, barH, 4);
      ctx.fillStyle = moves <= 5 ? '#ff7a85' : '#5fa8ff';
      ctx.fill();
    }
  }

  // Centered modal overlay for title / game-over.
  function overlay(lines) {
    ctx.save();
    ctx.fillStyle = 'rgba(7,9,16,0.82)';
    ctx.fillRect(0, 0, W, H);
    let cy = H / 2 - (lines.length - 1) * 18;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      label(l.t, W / 2, cy, l.c || TEXT, l.s || 16, l.w || 600, 'center');
      cy += (l.gap || 34);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // A little gem parade on the title screen so it never looks empty.
  function drawTitleGems() {
    const y = H / 2 - 96;
    for (let i = 0; i < TYPES; i++) {
      const x = W / 2 + (i - (TYPES - 1) / 2) * 56;
      const bob = Math.sin(performance.now() / 320 + i) * 6;
      drawGem(x, y + bob, i, 0.92, 1);
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Screen-shake: translate everything by a small random jolt that decays.
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawBoardBg();

    // Clip gems to the board so falling newcomers don't show above the frame.
    ctx.save();
    roundRect(BX, BY, BOARD, BOARD, 10);
    ctx.clip();
    drawGems();
    ctx.restore();

    drawParticles();
    drawHud();
    drawPopups();

    ctx.restore();  // undo shake

    if (state === 'title') {
      drawTitleGems();
      overlay([
        { t: 'MATCH THREE', c: ACCENT, s: 32, w: 800, gap: 30 },
        { t: 'Swap adjacent gems to line up 3 or more', c: TEXT, s: 14, gap: 30 },
        { t: 'Chain cascades for combo bonuses!', c: MUTED, s: 13, gap: 50 },
        { t: 'Press  SPACE / ENTER  to play', c: '#ffd95e', s: 18, w: 700, gap: 30 },
        { t: 'Click a gem then a neighbour · or drag to swap', c: MUTED, s: 12, gap: 22 },
      ]);
    } else if (state === 'over') {
      const beat = (score >= best && score > 0);
      overlay([
        { t: 'OUT OF MOVES', c: '#ff7a85', s: 30, w: 800, gap: 44 },
        { t: 'Score  ' + score, c: TEXT, s: 22, w: 800, gap: 32 },
        { t: (beat ? 'NEW BEST!' : 'Best  ' + best), c: beat ? '#ffd95e' : ACCENT, s: 16, w: 700, gap: 46 },
        { t: 'Press  SPACE / ENTER  to play again', c: '#ffd95e', s: 16, w: 700, gap: 22 },
      ]);
    }
  }

  // ---------- Easing ----------
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ---------- Main loop (delta-time, clamped) ----------
  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 60) dt = 60;                 // clamp after a tab-switch / GC pause
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ============================================================
  //  Input
  // ============================================================

  // Try to select/swap based on a click on cell (r,c).
  function pickCell(cell) {
    if (state !== 'playing' || phase !== 'idle') return;
    if (!sel) {
      sel = { r: cell.r, c: cell.c };
      sfxTick(640);
      return;
    }
    // Clicking the same gem deselects it.
    if (sel.r === cell.r && sel.c === cell.c) { sel = null; return; }
    // Clicking an adjacent gem attempts a swap.
    if (adjacent(sel, cell)) {
      beginSwap(sel, cell);
    } else {
      // Non-adjacent: move the selection to the new gem.
      sel = { r: cell.r, c: cell.c };
      sfxTick(640);
    }
  }

  // ----- Keyboard: start / restart -----
  document.addEventListener('keydown', (e) => {
    initAudio();
    const k = e.key;
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      e.preventDefault();
      if (state === 'title' || state === 'over') startGame();
      return;
    }
    // R also restarts mid-game for convenience.
    if ((k === 'r' || k === 'R') && state === 'playing') startGame();
  });

  // ----- Mouse / pointer: click-to-select and click-drag to swap -----
  // We use pointer events where available so a press+drag works for both
  // mouse and touch; the drag direction maps to the adjacent neighbour.
  function onPressClient(clientX, clientY) {
    initAudio();
    if (state === 'title' || state === 'over') { startGame(); return; }
    const cell = cellFromClient(clientX, clientY);
    if (!cell) return;
    dragFrom = cell;
    pressPx = { x: clientX, y: clientY };
    // Also treat the press as a tentative select so a plain click works.
    if (state === 'playing' && phase === 'idle') {
      if (!sel) { sel = { r: cell.r, c: cell.c }; sfxTick(640); }
    }
  }

  function onReleaseClient(clientX, clientY) {
    if (state !== 'playing') { dragFrom = null; pressPx = null; return; }
    if (!dragFrom || !pressPx) { dragFrom = null; pressPx = null; return; }

    // Measure the drag in canvas pixels to decide if it was a drag-swap.
    const rect = canvas.getBoundingClientRect();
    const sx = W / rect.width, sy = H / rect.height;
    const dx = (clientX - pressPx.x) * sx;
    const dy = (clientY - pressPx.y) * sy;
    const dist = Math.hypot(dx, dy);

    if (dist > CELL * 0.35 && phase === 'idle') {
      // Drag: pick the dominant axis -> the adjacent target cell.
      let tr = dragFrom.r, tc = dragFrom.c;
      if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1;
      else tr += dy > 0 ? 1 : -1;
      if (inBounds(tr, tc)) {
        sel = { r: dragFrom.r, c: dragFrom.c };
        beginSwap(sel, { r: tr, c: tc });
      }
    } else {
      // A tap/click: run the select-or-swap logic against the released cell.
      const cell = cellFromClient(clientX, clientY);
      if (cell) {
        // If we pre-selected on press, that selection is this same cell;
        // route through pickCell using the existing selection so a two-click
        // swap (click A, then click adjacent B) still works.
        if (sel && (sel.r !== cell.r || sel.c !== cell.c)) {
          pickCell(cell);
        } else if (sel && sel.r === cell.r && sel.c === cell.c) {
          // pressed and released on the same, freshly selected gem: keep it
          // selected (do nothing) so the next click can complete a swap.
        } else {
          pickCell(cell);
        }
      }
    }
    dragFrom = null; pressPx = null;
  }

  // Prefer Pointer Events; fall back to mouse if unavailable.
  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onPressClient(e.clientX, e.clientY); });
    canvas.addEventListener('pointerup', (e) => { e.preventDefault(); onReleaseClient(e.clientX, e.clientY); });
  } else {
    canvas.addEventListener('mousedown', (e) => { e.preventDefault(); onPressClient(e.clientX, e.clientY); });
    canvas.addEventListener('mouseup', (e) => { e.preventDefault(); onReleaseClient(e.clientX, e.clientY); });
  }
  // Block context menu / scrolling jank on the canvas.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  // ============================================================
  //  Boot — initialize EVERY piece of state the renderer reads, at LOAD,
  //  so the title screen draws a valid board and HUD (never undefined).
  // ============================================================
  loadBest();
  grid = makeGrid();
  makeBuffers();
  freshBoard();              // a valid, match-free board sits behind the title
  score = 0;
  best = best || 0;
  moves = START_MOVES;
  combo = 0;
  sel = null; dragFrom = null; pressPx = null;
  swapA = swapB = null; swapT = 0;
  popping = []; popT = 0;
  particles = []; popups = []; shake = 0;
  state = 'title';
  phase = 'idle';
  requestAnimationFrame(frame);
})();
