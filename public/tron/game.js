// ============================================================
//  TRON LIGHT-CYCLES  —  local 2-player, pure HTML5 Canvas + JS.
//  No libraries, no asset files. Just open index.html.
//
//  Two light-cycles share one arena grid and advance together on
//  the same fixed tick. Every cell a cycle leaves becomes a solid
//  wall of light (its trail). A cycle is "derezzed" if its next
//  cell is off the arena, already filled by ANY trail (its own or
//  the rival's), or if both cycles try to enter the SAME cell on
//  the same tick (a head-on counts as a mutual crash). Last cycle
//  riding wins the round; if both crash on one tick it's a draw.
//  First to TARGET_WINS rounds takes the match. Speed ramps up a
//  little as a round goes on. Each player can BUFFER one turn so a
//  fast double-tap isn't dropped. Read step() + the loop at the
//  bottom to see the simultaneous move + collision resolution.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 700 — fixed internal resolution
  const HEIGHT = canvas.height;  // 600 — (CSS scales it to the page)

  // ---- Arena config (tweak these to change the feel) ----------
  const CELL = 10;                       // pixels per grid cell
  const COLS = Math.floor(WIDTH / CELL); // 70 columns
  const ROWS = Math.floor(HEIGHT / CELL);// 60 rows
  const GRID_W = COLS * CELL;            // drawable arena width
  const GRID_H = ROWS * CELL;            // drawable arena height

  const START_TICK = 1000 / 11;  // ms per move at round start (~11 moves/sec)
  const MIN_TICK = 1000 / 22;    // fastest allowed (speed cap, stays fair)
  const SPEEDUP = 0.06;          // ms shaved off the tick every move (ramps up)
  const TARGET_WINS = 3;         // best-of: first to this many round wins
  const COUNTDOWN_MS = 1100;     // "3..2..1" lead-in before a round goes live

  // Direction vectors. Index into this; never store raw dx/dy so we
  // can cheaply test "is this the exact opposite of my heading?".
  const DIRS = [
    { x: 0, y: -1 }, // 0 up
    { x: 1, y: 0 },  // 1 right
    { x: 0, y: 1 },  // 2 down
    { x: -1, y: 0 }, // 3 left
  ];
  const opposite = (d) => (d + 2) % 4; // up<->down, left<->right

  // Theme + two clearly distinct neon kits (cyan vs orange).
  const C = {
    bg: '#05080e',
    grid: 'rgba(90,150,200,0.06)',
    frame: 'rgba(120,180,230,0.35)',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
  };
  const PLAYERS = [
    {
      name: 'P1', keys: 'W A S D',
      trail: '#27c8ff', trailDim: '#0f6f96', head: '#d6f6ff',
      glow: 'rgba(39,200,255,0.9)', soft: 'rgba(39,200,255,0.25)',
    },
    {
      name: 'P2', keys: '↑ ← ↓ →',
      trail: '#ff9b2f', trailDim: '#9c5a12', head: '#fff0d6',
      glow: 'rgba(255,155,47,0.9)', soft: 'rgba(255,155,47,0.25)',
    },
  ];

  // ---- Game state (states: title | countdown | playing | roundover | matchover)
  // EVERY one of these is given a real value below at module load, so the
  // title / game-over screens can safely run update()+render() without ever
  // touching an undefined value. (House rule #1.)
  let state = 'title';
  let cycles;        // [c1, c2], each: {x,y, dir, nextDir, alive, crashCell, hue idx}
  let occupied;      // Uint8Array grid: 0 empty, 1 = P1 trail, 2 = P2 trail
  let wins;          // [p1wins, p2wins] across the match
  let round;         // current round number (1-based)
  let tickMs;        // current ms-per-move (shrinks through a round)
  let acc;           // time accumulator for the fixed-step movement tick
  let last;          // timestamp of previous frame (for delta time)
  let countdown;     // ms remaining on the lead-in counter
  let roundWinner;   // -1 draw, 0 = P1, 1 = P2, null = none yet (round live)
  let matchWinner;   // 0 or 1 once someone reaches TARGET_WINS, else null
  let shake;         // screen-shake magnitude (decays each frame)
  let flash;         // white crash-flash alpha (decays each frame)
  let particles;     // derez spark particles [{x,y,vx,vy,life,max,color}]
  let pulse;         // free-running clock for title/HUD glow animation

  // ---- Audio (WebAudio, created lazily on first input) --------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // Short blip. Wrapped so audio can NEVER break the game.
  function blip(freq, dur, type, gain) {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  // Falling "derez" sweep when a cycle crashes.
  function derezSound() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.6);
    } catch (e) { /* ignore */ }
  }
  // Low engine-hum tick that rises subtly with speed (called each move).
  function hum() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      // map current tick speed (slow->fast) to a pitch (low->higher)
      const k = (START_TICK - tickMs) / (START_TICK - MIN_TICK); // 0..1
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(58 + k * 46, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.09);
    } catch (e) { /* ignore */ }
  }

  // ---- localStorage (remember match wins tally) ---------------
  const LS_KEY = 'tron_lightcycles_wins';
  function loadWins() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (Array.isArray(v) && v.length === 2) return [v[0] | 0, v[1] | 0];
      }
    } catch (e) { /* ignore */ }
    return [0, 0];
  }
  function saveWins() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(wins)); }
    catch (e) { /* ignore */ }
  }

  // ---- Grid helpers -------------------------------------------
  const idx = (cx, cy) => cy * COLS + cx;
  const inBounds = (cx, cy) => cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS;

  // ---- Round / match setup ------------------------------------
  // Place both cycles facing each other, a few cells in from the
  // sides, heading toward the middle. Their starting cell is marked.
  function newRound() {
    occupied = new Uint8Array(COLS * ROWS);
    const midY = Math.floor(ROWS / 2);
    cycles = [
      // P1: left third, heading right
      { id: 0, x: Math.floor(COLS * 0.22), y: midY, dir: 1, nextDir: 1, alive: true, crashCell: null },
      // P2: right third, heading left
      { id: 1, x: Math.floor(COLS * 0.78), y: midY, dir: 3, nextDir: 3, alive: true, crashCell: null },
    ];
    for (const c of cycles) occupied[idx(c.x, c.y)] = c.id + 1;
    tickMs = START_TICK;
    acc = 0;
    roundWinner = null;
    particles = [];
    countdown = COUNTDOWN_MS;
    state = 'countdown';
  }

  function newMatch() {
    wins = [0, 0];
    round = 1;
    matchWinner = null;
    saveWins();
    newRound();
  }

  // ---- Turning (with one-deep buffered input) -----------------
  // We set nextDir, not dir, so a turn only "commits" on the next
  // movement tick — this both buffers fast taps and makes an instant
  // 180° reversal impossible (we reject the exact opposite heading).
  function queueTurn(cycleIndex, newDir) {
    const c = cycles[cycleIndex];
    if (!c || !c.alive) return;
    if (newDir === opposite(c.dir)) return; // no instant U-turn
    c.nextDir = newDir;
  }

  // ---- One movement tick: move both, then resolve collisions ---
  function step() {
    const before = cycles.filter((c) => c.alive).length;

    // 1) Commit each live cycle's buffered turn, then compute its target cell.
    const targets = [];
    for (const c of cycles) {
      if (!c.alive) { targets.push(null); continue; }
      c.dir = c.nextDir;                       // commit buffered input
      const d = DIRS[c.dir];
      targets.push({ x: c.x + d.x, y: c.y + d.y });
    }

    // 2) Decide who dies. A cycle crashes if its target is out of
    //    bounds OR already occupied by ANY trail. Head-on (both aim
    //    at the same empty cell) kills both.
    const dead = [false, false];
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i], t = targets[i];
      if (!c.alive) continue;
      if (!inBounds(t.x, t.y) || occupied[idx(t.x, t.y)] !== 0) {
        dead[i] = true;
        c.crashCell = { x: t.x, y: t.y };
      }
    }
    // Head-on into the same cell.
    if (cycles[0].alive && cycles[1].alive &&
        targets[0] && targets[1] &&
        targets[0].x === targets[1].x && targets[0].y === targets[1].y) {
      dead[0] = dead[1] = true;
      cycles[0].crashCell = { x: targets[0].x, y: targets[0].y };
      cycles[1].crashCell = { x: targets[1].x, y: targets[1].y };
    }

    // 3) Apply: survivors advance and lay trail; crashers derez.
    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      if (!c.alive) continue;
      if (dead[i]) {
        c.alive = false;
        spawnCrash(c);
      } else {
        const t = targets[i];
        c.x = t.x; c.y = t.y;
        occupied[idx(c.x, c.y)] = c.id + 1; // lay solid trail
      }
    }

    // 4) Speed ramps up a touch each move (toward the cap).
    tickMs = Math.max(MIN_TICK, tickMs - SPEEDUP);

    // 5) Did the round end? (someone died this tick)
    const after = cycles.filter((c) => c.alive).length;
    if (after < before || after === 0) {
      if (cycles.some((c) => !c.alive)) endRound();
    } else {
      hum(); // only hum on clean moves so crashes read clearly
    }
  }

  // Tally up the round outcome and roll into round-over / match-over.
  function endRound() {
    const p1 = cycles[0].alive, p2 = cycles[1].alive;
    if (p1 && !p2) { roundWinner = 0; wins[0]++; }
    else if (p2 && !p1) { roundWinner = 1; wins[1]++; }
    else { roundWinner = -1; } // both dead same tick = draw (no point)

    flash = 1;
    shake = 16;
    derezSound();
    saveWins();

    if (wins[0] >= TARGET_WINS) { matchWinner = 0; state = 'matchover'; }
    else if (wins[1] >= TARGET_WINS) { matchWinner = 1; state = 'matchover'; }
    else { state = 'roundover'; }
  }

  // ---- Crash particles ----------------------------------------
  function spawnCrash(c) {
    const cell = c.crashCell || { x: c.x, y: c.y };
    const px = cell.x * CELL + CELL / 2;
    const py = cell.y * CELL + CELL / 2;
    const col = PLAYERS[c.id].trail;
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 4.2;
      particles.push({
        x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, max: 0.5 + Math.random() * 0.5, color: col,
      });
    }
  }

  function updateParticles(dt) {
    const f = dt / 16.6667; // normalize to ~60fps step
    for (const p of particles) {
      p.x += p.vx * f; p.y += p.vy * f;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= (dt / 1000) / p.max;
    }
    // drop dead particles
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    pulse += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 0.05);
    if (flash > 0) flash = Math.max(0, flash - dt * 0.0022);
    updateParticles(dt);

    if (state === 'countdown') {
      countdown -= dt;
      if (countdown <= 0) { countdown = 0; state = 'playing'; }
      return;
    }
    if (state === 'playing') {
      acc += dt;
      // Fixed-step movement; guard against huge dt after a tab-switch.
      let steps = 0;
      while (acc >= tickMs && steps < 6) {
        acc -= tickMs;
        step();
        steps++;
        if (state !== 'playing') break; // round ended mid-loop
      }
    }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
      const px = x * CELL + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, GRID_H);
    }
    for (let y = 0; y <= ROWS; y++) {
      const py = y * CELL + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(GRID_W, py);
    }
    ctx.stroke();
    // Glowing arena frame (the walls you can crash into).
    ctx.strokeStyle = C.frame;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(120,180,230,0.6)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(1, 1, GRID_W - 2, GRID_H - 2);
    ctx.restore();
  }

  // Paint every filled cell as a glowing trail block, in its owner's hue.
  function drawTrails() {
    ctx.save();
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const v = occupied[idx(cx, cy)];
        if (v === 0) continue;
        const P = PLAYERS[v - 1];
        const px = cx * CELL, py = cy * CELL;
        ctx.shadowColor = P.glow;
        ctx.shadowBlur = 8;
        ctx.fillStyle = P.trailDim;
        ctx.fillRect(px + 1, py + 1, CELL - 1, CELL - 1);
        ctx.shadowBlur = 0;
        ctx.fillStyle = P.trail;
        ctx.fillRect(px + 2, py + 2, CELL - 3, CELL - 3);
      }
    }
    ctx.restore();
  }

  // Bright head of each live cycle, with a forward "headlight" smear.
  function drawHeads() {
    for (const c of cycles) {
      if (!c.alive) continue;
      const P = PLAYERS[c.id];
      const px = c.x * CELL, py = c.y * CELL;
      ctx.save();
      ctx.shadowColor = P.glow;
      ctx.shadowBlur = 16;
      ctx.fillStyle = P.head;
      ctx.fillRect(px, py, CELL, CELL);
      // small directional headlight glow
      const d = DIRS[c.dir];
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = P.soft;
      ctx.fillRect(px + d.x * CELL, py + d.y * CELL, CELL, CELL);
      ctx.restore();
    }
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      const s = 2 + p.life * 2;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  // Win-pip HUD: name + a row of pips (filled = rounds won) per player.
  function drawHud() {
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;

    // P1 (top-left)
    drawPlayerHud(0, 14, 12, 'left');
    // P2 (top-right)
    drawPlayerHud(1, WIDTH - 14, 12, 'right');

    // Round indicator, centered top.
    ctx.shadowBlur = 4;
    ctx.fillStyle = C.dim;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = matchWinner !== null ? 'MATCH' : ('ROUND ' + round);
    ctx.fillText(label + '   ·   FIRST TO ' + TARGET_WINS, WIDTH / 2, 14);
    ctx.restore();
  }

  function drawPlayerHud(i, anchorX, y, align) {
    const P = PLAYERS[i];
    ctx.textAlign = align;
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = P.trail;
    ctx.shadowColor = P.glow;
    ctx.shadowBlur = 8;
    ctx.fillText(P.name, anchorX, y);
    ctx.shadowBlur = 0;

    // Pips beneath the name.
    const pipR = 5, gap = 16;
    const total = TARGET_WINS;
    const startX = align === 'left' ? anchorX + pipR : anchorX - pipR - (total - 1) * gap;
    for (let p = 0; p < total; p++) {
      const cx = startX + p * gap;
      const cy = y + 28;
      ctx.beginPath();
      ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
      if (p < wins[i]) {
        ctx.fillStyle = P.trail;
        ctx.shadowColor = P.glow; ctx.shadowBlur = 8;
        ctx.fill();
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(160,180,210,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }

  // Centered glowing text helper.
  function centerText(text, y, size, color, glow) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + size + 'px "Segoe UI", system-ui, sans-serif';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 18; }
    ctx.fillStyle = color;
    ctx.fillText(text, WIDTH / 2, y);
    ctx.restore();
  }

  // Semi-transparent panel behind overlay text for legibility.
  function dim(alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,14,' + alpha + ')';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  function blinkPrompt(text, y) {
    const a = 0.55 + 0.45 * Math.sin(pulse / 320);
    ctx.save();
    ctx.globalAlpha = a;
    centerText(text, y, 16, C.accent, 'rgba(159,180,212,0.8)');
    ctx.restore();
  }

  function drawTitle() {
    dim(0.45);
    // Animated title with two-tone neon underline.
    centerText('TRON', HEIGHT / 2 - 92, 56, '#d6f6ff', PLAYERS[0].glow);
    centerText('LIGHT-CYCLES', HEIGHT / 2 - 44, 30, PLAYERS[1].head, PLAYERS[1].glow);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text;
    ctx.font = '400 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Local 2-player  ·  leave a trail, don’t crash  ·  best of ' + (TARGET_WINS * 2 - 1), WIDTH / 2, HEIGHT / 2 + 4);

    // Per-player control reminder in their own colours.
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = PLAYERS[0].trail;
    ctx.fillText('P1  ·  W A S D', WIDTH / 2 - 96, HEIGHT / 2 + 34);
    ctx.fillStyle = PLAYERS[1].trail;
    ctx.fillText('P2  ·  Arrow keys', WIDTH / 2 + 96, HEIGHT / 2 + 34);
    ctx.restore();

    blinkPrompt('PRESS SPACE / ENTER OR CLICK TO RIDE', HEIGHT / 2 + 86);
  }

  function drawCountdown() {
    const n = Math.ceil(countdown / (COUNTDOWN_MS / 3)); // 3,2,1
    const txt = n >= 3 ? '3' : n === 2 ? '2' : '1';
    // scale-pop per number
    const within = countdown % (COUNTDOWN_MS / 3);
    const phase = within / (COUNTDOWN_MS / 3); // 1..0 across the number
    const scale = 1 + 0.5 * phase;
    ctx.save();
    ctx.translate(WIDTH / 2, HEIGHT / 2);
    ctx.scale(scale, scale);
    centerText(txt, 0, 72, '#d6f6ff', PLAYERS[0].glow);
    ctx.restore();
    centerText('GET READY', HEIGHT / 2 + 86, 16, C.dim, null);
  }

  function drawRoundOver() {
    dim(0.5);
    let title, glow, color;
    if (roundWinner === -1) {
      title = 'DRAW'; color = C.accent; glow = 'rgba(159,180,212,0.8)';
    } else {
      const P = PLAYERS[roundWinner];
      title = P.name + ' WINS THE ROUND'; color = P.head; glow = P.glow;
    }
    centerText(title, HEIGHT / 2 - 36, 30, color, glow);
    centerText(wins[0] + '   –   ' + wins[1], HEIGHT / 2 + 8, 26, C.text, null);
    blinkPrompt('PRESS SPACE / ENTER FOR NEXT ROUND', HEIGHT / 2 + 64);
  }

  function drawMatchOver() {
    dim(0.55);
    const P = PLAYERS[matchWinner];
    centerText(P.name + ' WINS THE MATCH', HEIGHT / 2 - 40, 30, P.head, P.glow);
    centerText('Final  ' + wins[0] + '  –  ' + wins[1], HEIGHT / 2 + 6, 24, C.text, null);
    blinkPrompt('PRESS SPACE / ENTER FOR A REMATCH', HEIGHT / 2 + 62);
  }

  function render() {
    // Screen-shake: translate by a random offset that decays.
    ctx.save();
    if (shake > 0) {
      const dx = (Math.random() * 2 - 1) * shake;
      const dy = (Math.random() * 2 - 1) * shake;
      ctx.translate(dx, dy);
    }

    // Clear arena.
    ctx.fillStyle = C.bg;
    ctx.fillRect(-40, -40, WIDTH + 80, HEIGHT + 80);

    drawGrid();
    drawTrails();
    if (state === 'playing' || state === 'countdown') drawHeads();
    drawParticles();
    drawHud();

    // Crash flash (white wash that fades out).
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.restore();
    }

    // State overlays.
    if (state === 'title') drawTitle();
    else if (state === 'countdown') drawCountdown();
    else if (state === 'roundover') drawRoundOver();
    else if (state === 'matchover') drawMatchOver();

    ctx.restore();
  }

  // ============================================================
  //  MAIN LOOP — requestAnimationFrame + clamped delta time
  // ============================================================
  function frame(now) {
    let dt = now - last;
    last = now;
    if (!isFinite(dt) || dt < 0) dt = 16.6667;
    if (dt > 100) dt = 100; // clamp so a tab-switch can't teleport cycles
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ============================================================
  //  INPUT
  // ============================================================
  // "Confirm" advances title / round-over / match-over.
  function confirm() {
    if (state === 'title' || state === 'roundover') {
      if (state === 'title') { newMatch(); }
      else { round++; newRound(); }
      blip(660, 0.08, 'square', 0.1);
    } else if (state === 'matchover') {
      newMatch();
      blip(660, 0.08, 'square', 0.1);
    }
  }

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first input wakes WebAudio (house rule)

    const k = e.key;
    // Start / advance keys.
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      e.preventDefault();
      confirm();
      return;
    }

    // Steering only matters while a round is live (playing/countdown).
    if (state === 'playing' || state === 'countdown') {
      // Player 1: W A S D
      if (k === 'w' || k === 'W') { queueTurn(0, 0); e.preventDefault(); }
      else if (k === 'd' || k === 'D') { queueTurn(0, 1); e.preventDefault(); }
      else if (k === 's' || k === 'S') { queueTurn(0, 2); e.preventDefault(); }
      else if (k === 'a' || k === 'A') { queueTurn(0, 3); e.preventDefault(); }
      // Player 2: Arrow keys
      else if (k === 'ArrowUp') { queueTurn(1, 0); e.preventDefault(); }
      else if (k === 'ArrowRight') { queueTurn(1, 1); e.preventDefault(); }
      else if (k === 'ArrowDown') { queueTurn(1, 2); e.preventDefault(); }
      else if (k === 'ArrowLeft') { queueTurn(1, 3); e.preventDefault(); }
    }
  });

  // A click also starts/advances (so "must start on click" is satisfied).
  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    e.preventDefault();
    confirm();
  });
  // Touch: tap to start/advance too.
  canvas.addEventListener('touchstart', (e) => {
    ensureAudio();
    e.preventDefault();
    confirm();
  }, { passive: false });

  // ============================================================
  //  BOOT — initialize ALL state at load, THEN start the loop.
  //  The title screen renders a valid (empty) arena + HUD; update()
  //  and render() never see an undefined value. (House rule #1.)
  // ============================================================
  wins = loadWins();
  // Don't carry a finished tally into a fresh title screen.
  if (wins[0] >= TARGET_WINS || wins[1] >= TARGET_WINS) wins = [0, 0];
  round = 1;
  matchWinner = null;
  roundWinner = null;
  shake = 0;
  flash = 0;
  particles = [];
  pulse = 0;
  tickMs = START_TICK;
  acc = 0;
  countdown = COUNTDOWN_MS;
  // Build a valid (empty) arena + parked cycles so the title screen
  // can draw the HUD/arena without touching anything undefined.
  occupied = new Uint8Array(COLS * ROWS);
  const _midY = Math.floor(ROWS / 2);
  cycles = [
    { id: 0, x: Math.floor(COLS * 0.22), y: _midY, dir: 1, nextDir: 1, alive: true, crashCell: null },
    { id: 1, x: Math.floor(COLS * 0.78), y: _midY, dir: 3, nextDir: 3, alive: true, crashCell: null },
  ];
  state = 'title';
  last = performance.now();
  requestAnimationFrame(frame);
})();
