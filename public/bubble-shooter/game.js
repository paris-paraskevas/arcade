(() => {
  'use strict';

  // ===========================================================================
  // BUBBLE SHOOTER  (Puzzle-Bobble style)
  // Self-contained: pure canvas + vanilla JS, runs from file://.
  // ===========================================================================

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 540 internal resolution
  const H = canvas.height;  // 640

  // ---------------------------------------------------------------------------
  // Grid geometry. We use an "offset" (brick-laid) layout: every odd row is
  // shifted right by half a bubble, which approximates a hex packing so that a
  // bubble touches up to 6 neighbours.
  // ---------------------------------------------------------------------------
  const R = 18;                 // bubble radius
  const D = R * 2;              // bubble diameter = horizontal step on a row
  const COLS = 14;             // bubbles per (even) row  -> 14*36 = 504 wide field
  const ROW_H = Math.round(R * 1.74); // vertical step (~ sqrt(3)*R for hex packing)
  const FIELD_X = (W - COLS * D) / 2;  // left padding so the field is centred
  const FIELD_TOP = 6;         // y of the ceiling line
  const DEATH_LINE = H - 96;   // if any bubble dips below this, you lose

  // Number of distinct colours currently in play (grows a touch with level).
  const BASE_COLORS = 5;
  const MAX_COLORS = 7;

  // Procedural, distinct bubble palette (hue-spread so colours never blur).
  // Each entry: {core, light, dark} used for the 3D-ish shaded sphere.
  const PALETTE = [
    { h: 0,   name: 'red'    },
    { h: 35,  name: 'orange' },
    { h: 55,  name: 'yellow' },
    { h: 135, name: 'green'  },
    { h: 200, name: 'cyan'   },
    { h: 230, name: 'blue'   },
    { h: 290, name: 'purple' },
  ];
  function hsl(h, s, l) { return 'hsl(' + h + ',' + s + '%,' + l + '%)'; }

  // ---------------------------------------------------------------------------
  // High score (localStorage, guarded so a locked-down file:// can't crash us).
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'bubble_shooter_best';
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ }
  }
  let best = loadBest();

  // ---------------------------------------------------------------------------
  // Audio — WebAudio only, created lazily on first gesture, every call guarded.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  function blip(freq, dur, type, gain) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.08));
      osc.connect(g).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (dur || 0.08) + 0.02);
    } catch (e) { /* ignore */ }
  }
  const sndShoot = () => blip(520, 0.06, 'square', 0.07);
  const sndStick = () => blip(300, 0.05, 'sine', 0.08);
  const sndWall  = () => blip(220, 0.04, 'square', 0.05);
  const sndPop   = (n) => blip(440 + n * 55, 0.08, 'triangle', 0.11);
  const sndDrop  = () => blip(180, 0.22, 'sawtooth', 0.10);
  const sndWin   = () => { blip(660, 0.12, 'square', 0.12); setTimeout(() => blip(880, 0.18, 'square', 0.12), 110); };
  const sndLose  = () => blip(110, 0.40, 'sawtooth', 0.14);
  const sndDescend = () => blip(150, 0.10, 'square', 0.08);

  // ---------------------------------------------------------------------------
  // Grid helpers. grid[r] is an array of length COLS (odd rows use COLS-1 of
  // them so they sit inside the walls). A cell is null (empty) or a colour idx.
  // ---------------------------------------------------------------------------
  const ROWS = 30; // generous backing store; only the top portion is ever filled
  let grid = [];   // grid[r][c] = colorIndex | null
  let rowOffset = 0; // 0 => row 0 is "even" (flush left). Flips as field descends.

  function rowIsOdd(r) { return ((r + rowOffset) & 1) === 1; }
  function colsInRow(r) { return rowIsOdd(r) ? COLS - 1 : COLS; }

  // Pixel centre of a cell.
  function cellX(r, c) {
    const indent = rowIsOdd(r) ? R : 0;
    return FIELD_X + R + indent + c * D;
  }
  function cellY(r) {
    return FIELD_TOP + R + r * ROW_H;
  }

  function makeEmptyGrid() {
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      g[r] = new Array(COLS).fill(null);
    }
    return g;
  }

  // Neighbour offsets differ for odd/even rows in an offset layout.
  function neighbors(r, c) {
    const odd = rowIsOdd(r);
    const out = [];
    // same row
    out.push([r, c - 1]);
    out.push([r, c + 1]);
    if (odd) {
      out.push([r - 1, c]);
      out.push([r - 1, c + 1]);
      out.push([r + 1, c]);
      out.push([r + 1, c + 1]);
    } else {
      out.push([r - 1, c - 1]);
      out.push([r - 1, c]);
      out.push([r + 1, c - 1]);
      out.push([r + 1, c]);
    }
    // keep only valid, occupied-range cells
    const res = [];
    for (let i = 0; i < out.length; i++) {
      const rr = out[i][0], cc = out[i][1];
      if (rr < 0 || rr >= ROWS) continue;
      if (cc < 0 || cc >= colsInRow(rr)) continue;
      res.push(out[i]);
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Game state — ALL initialised here at module load so title/over screens that
  // also run update()+render() never read an undefined value. (House rule #1.)
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, PLAY: 1, OVER: 2, WIN: 3 };
  let state = STATE.TITLE;

  let score = 0;
  let level = 1;
  let shotsUntilDescend = 0;
  let shotsPerDescend = 6;
  let descendStep = 0;        // how many times the field has descended (for warning)

  let launcherX = W / 2;
  let launcherY = H - 46;
  let aimAngle = -Math.PI / 2; // straight up by default
  let aimX = launcherX, aimY = launcherY - 100; // mouse target (valid at load)

  let curColor = 0;            // colour in the launcher
  let nextColor = 1;           // on-deck colour
  let availableColors = BASE_COLORS;

  // The flying bubble (null when none in flight).
  let shot = null;             // { x, y, vx, vy, color }
  const SHOT_SPEED = 560;      // px/sec

  let particles = [];          // pop sparks
  let fallers = [];            // bubbles detached from ceiling, dropping with gravity
  let popFlashes = [];         // brief ring flashes where clusters popped
  let shake = 0;               // screen-shake magnitude

  let descendWarn = 0;         // 0..1 pulsing alarm when field nears death line
  let comboText = null;        // floating "+N" feedback { x, y, t, msg }

  // RNG of colours currently present in the grid, used so the launcher only
  // ever serves colours that can actually be matched (feels fair).
  function colorsInGrid() {
    const set = new Set();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < colsInRow(r); c++) {
        if (grid[r][c] !== null) set.add(grid[r][c]);
      }
    }
    return set;
  }
  function pickColor() {
    const present = colorsInGrid();
    let pool = [];
    present.forEach((v) => pool.push(v));
    // If too few colours remain, fall back to the full available range so the
    // game keeps mixing while still being winnable.
    if (pool.length === 0) pool = [Math.floor(Math.random() * availableColors)];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------------------------------------------------------------------------
  // Level setup — fill the top rows with a random-but-fair pattern.
  // ---------------------------------------------------------------------------
  function buildLevel() {
    grid = makeEmptyGrid();
    rowOffset = 0;
    descendStep = 0;
    availableColors = Math.min(MAX_COLORS, BASE_COLORS + Math.floor((level - 1) / 2));
    const filledRows = Math.min(7 + Math.floor((level - 1)), 11);
    for (let r = 0; r < filledRows; r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        // Leave occasional gaps in lower rows for a more organic field.
        if (r >= 5 && Math.random() < 0.18) { grid[r][c] = null; continue; }
        grid[r][c] = Math.floor(Math.random() * availableColors);
      }
    }
  }

  function resetGame() {
    score = 0;
    level = 1;
    shotsPerDescend = 6;
    buildLevel();
    shotsUntilDescend = shotsPerDescend;
    shot = null;
    particles = [];
    fallers = [];
    popFlashes = [];
    shake = 0;
    descendWarn = 0;
    comboText = null;
    availableColors = Math.min(MAX_COLORS, BASE_COLORS + Math.floor((level - 1) / 2));
    curColor = pickColor();
    nextColor = pickColor();
  }

  // Initialise a sane field at LOAD so the title screen renders a real board.
  resetGame();
  state = STATE.TITLE;

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    let cx, cy;
    if (evt.touches && evt.touches.length) {
      cx = evt.touches[0].clientX; cy = evt.touches[0].clientY;
    } else {
      cx = evt.clientX; cy = evt.clientY;
    }
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  }

  function updateAimFromPoint(p) {
    aimX = p.x; aimY = p.y;
    let a = Math.atan2(p.y - launcherY, p.x - launcherX);
    // Clamp so you can never aim sideways/down into the floor. Keep a small
    // margin off perfectly horizontal so shots always make progress upward.
    const minA = -Math.PI + 0.22; // pointing up-left
    const maxA = -0.22;           // pointing up-right
    if (a > maxA && a < Math.PI / 2) a = maxA;
    else if (a >= Math.PI / 2 || a < minA) a = minA;
    if (a < minA) a = minA;
    if (a > maxA) a = maxA;
    aimAngle = a;
  }

  canvas.addEventListener('mousemove', (e) => {
    updateAimFromPoint(canvasPoint(e));
  });
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    initAudio();
    updateAimFromPoint(canvasPoint(e));
    handleAction();
  });
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    initAudio();
    updateAimFromPoint(canvasPoint(e));
    handleAction();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    updateAimFromPoint(canvasPoint(e));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      initAudio();
      handleAction();
    }
  });

  // A single "action" handles start / continue / restart / fire by state.
  function handleAction() {
    if (state === STATE.TITLE) { state = STATE.PLAY; return; }
    if (state === STATE.WIN) { startNextLevel(); return; }   // keep the run going
    if (state === STATE.OVER) { resetGame(); state = STATE.PLAY; return; }
    if (state === STATE.PLAY) { fire(); }
  }

  function fire() {
    if (shot) return; // one bubble at a time
    const vx = Math.cos(aimAngle) * SHOT_SPEED;
    const vy = Math.sin(aimAngle) * SHOT_SPEED;
    shot = { x: launcherX, y: launcherY, vx: vx, vy: vy, color: curColor };
    sndShoot();
    // Advance the queue.
    curColor = nextColor;
    nextColor = pickColor();
  }

  // ---------------------------------------------------------------------------
  // Snap a flying bubble into the nearest empty grid cell, then resolve matches.
  // ---------------------------------------------------------------------------
  function snapShot() {
    const sx = shot.x, sy = shot.y, col = shot.color;
    // Estimate the row from y, then scan a small window for the closest empty
    // cell that is adjacent to an occupied one (or the ceiling).
    let bestR = -1, bestC = -1, bestD = Infinity;
    const approxR = Math.round((sy - FIELD_TOP - R) / ROW_H);
    for (let r = Math.max(0, approxR - 2); r <= Math.min(ROWS - 1, approxR + 2); r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== null) continue;
        const dx = sx - cellX(r, c);
        const dy = sy - cellY(r);
        const dist = dx * dx + dy * dy;
        if (dist >= bestD) continue;
        // The cell must be "supported": row 0 (ceiling) or adjacent to a bubble.
        let supported = (r === 0);
        if (!supported) {
          const nb = neighbors(r, c);
          for (let i = 0; i < nb.length; i++) {
            if (grid[nb[i][0]][nb[i][1]] !== null) { supported = true; break; }
          }
        }
        if (!supported) continue;
        bestD = dist; bestR = r; bestC = c;
      }
    }
    // Fallback: if nothing found (shouldn't happen), clamp to top row.
    if (bestR < 0) {
      bestR = 0;
      bestC = Math.max(0, Math.min(colsInRow(0) - 1, Math.round((sx - FIELD_X - R) / D)));
    }

    grid[bestR][bestC] = col;
    sndStick();

    // If we placed at/under the death line already, that's an immediate loss.
    if (cellY(bestR) + R >= DEATH_LINE) {
      loseGame();
      return;
    }

    resolveMatches(bestR, bestC);
  }

  // Flood-fill same-colour cluster starting at (r,c).
  function findCluster(r, c, matchColor) {
    const color = matchColor;
    const seen = {};
    const stack = [[r, c]];
    const out = [];
    while (stack.length) {
      const cur = stack.pop();
      const rr = cur[0], cc = cur[1];
      const key = rr + ',' + cc;
      if (seen[key]) continue;
      seen[key] = true;
      if (grid[rr][cc] !== color) continue;
      out.push([rr, cc]);
      const nb = neighbors(rr, cc);
      for (let i = 0; i < nb.length; i++) stack.push(nb[i]);
    }
    return out;
  }

  function resolveMatches(r, c) {
    const color = grid[r][c];
    const cluster = findCluster(r, c, color);
    if (cluster.length < 3) return; // no pop

    // Pop the cluster.
    let popped = 0;
    for (let i = 0; i < cluster.length; i++) {
      const rr = cluster[i][0], cc = cluster[i][1];
      spawnPop(cellX(rr, cc), cellY(rr), color);
      grid[rr][cc] = null;
      popped++;
    }
    sndPop(Math.min(8, popped));
    popFlashes.push({ x: cellX(r, c), y: cellY(r), t: 0, r: 0 });

    // Detach pass: any bubble not connected to the ceiling falls (bonus).
    const dropped = dropFloating();

    let gained = popped * 10;
    if (dropped > 0) gained += dropped * 25; // drops are worth more
    score += gained;
    if (score > best) { best = score; saveBest(best); }

    shake = Math.min(14, 4 + popped + dropped * 0.6);
    comboText = {
      x: cellX(r, c), y: cellY(r) - 6, t: 0,
      msg: '+' + gained + (dropped > 0 ? '  DROP x' + dropped : '')
    };

    // Win check — board cleared.
    if (isFieldEmpty()) winLevel();
  }

  // Mark all cells reachable from the ceiling; anything unmarked falls.
  function dropFloating() {
    const connected = {};
    const stack = [];
    // Seed from every occupied cell in row 0.
    const n0 = colsInRow(0);
    for (let c = 0; c < n0; c++) {
      if (grid[0][c] !== null) { stack.push([0, c]); connected['0,' + c] = true; }
    }
    while (stack.length) {
      const cur = stack.pop();
      const nb = neighbors(cur[0], cur[1]);
      for (let i = 0; i < nb.length; i++) {
        const rr = nb[i][0], cc = nb[i][1];
        const key = rr + ',' + cc;
        if (connected[key]) continue;
        if (grid[rr][cc] === null) continue;
        connected[key] = true;
        stack.push([rr, cc]);
      }
    }
    // Everything occupied but not connected becomes a faller.
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] === null) continue;
        if (connected[r + ',' + c]) continue;
        fallers.push({
          x: cellX(r, c), y: cellY(r),
          vx: (Math.random() - 0.5) * 60,
          vy: 20 + Math.random() * 30,
          color: grid[r][c]
        });
        grid[r][c] = null;
        count++;
      }
    }
    if (count > 0) sndDrop();
    return count;
  }

  function isFieldEmpty() {
    for (let r = 0; r < ROWS; r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) if (grid[r][c] !== null) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Descend — push the whole field down a row. Implemented by shifting cells
  // down one row and flipping the parity offset so the brick pattern stays put.
  // ---------------------------------------------------------------------------
  function descendField() {
    // Shift every row down by one.
    for (let r = ROWS - 1; r >= 1; r--) {
      grid[r] = grid[r - 1];
    }
    grid[0] = new Array(COLS).fill(null);
    rowOffset = (rowOffset + 1) & 1; // flip parity so offsets remain consistent
    descendStep++;
    sndDescend();

    // New top row: sprinkle fresh bubbles so the field keeps pressure on.
    const n = colsInRow(0);
    for (let c = 0; c < n; c++) {
      if (Math.random() < 0.7) grid[0][c] = Math.floor(Math.random() * availableColors);
    }

    // Check loss after descending.
    if (fieldCrossedDeathLine()) loseGame();
  }

  function fieldCrossedDeathLine() {
    for (let r = ROWS - 1; r >= 0; r--) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== null && cellY(r) + R >= DEATH_LINE) return true;
      }
    }
    return false;
  }

  function lowestBubbleY() {
    let y = FIELD_TOP;
    for (let r = ROWS - 1; r >= 0; r--) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== null) { y = Math.max(y, cellY(r) + R); }
      }
    }
    return y;
  }

  function winLevel() {
    sndWin();
    level++;
    score += 200; // clear bonus
    if (score > best) { best = score; saveBest(best); }
    state = STATE.WIN;
  }

  function loseGame() {
    sndLose();
    shake = 18;
    state = STATE.OVER;
    if (window.Arcade) Arcade.submitScore('bubble-shooter', score); // final score to leaderboard
  }

  function startNextLevel() {
    shotsPerDescend = Math.max(3, 6 - Math.floor(level / 2));
    buildLevel();
    shotsUntilDescend = shotsPerDescend;
    shot = null;
    particles = [];
    fallers = [];
    popFlashes = [];
    curColor = pickColor();
    nextColor = pickColor();
    state = STATE.PLAY;
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------
  function spawnPop(x, y, color) {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.3,
        t: 0,
        color: color,
        r: 2 + Math.random() * 3
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay juice timers in every state so they finish even on title/over.
    if (shake > 0) shake = Math.max(0, shake - dt * 40);

    // Particles always animate.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      if (p.t >= p.life) particles.splice(i, 1);
    }
    // Pop flashes expand and fade.
    for (let i = popFlashes.length - 1; i >= 0; i--) {
      const f = popFlashes[i];
      f.t += dt;
      f.r += dt * 140;
      if (f.t > 0.35) popFlashes.splice(i, 1);
    }
    // Floating combo text drifts up.
    if (comboText) {
      comboText.t += dt;
      comboText.y -= dt * 26;
      if (comboText.t > 1.0) comboText = null;
    }
    // Fallers drop off the bottom (visual bonus juice).
    for (let i = fallers.length - 1; i >= 0; i--) {
      const f = fallers[i];
      f.vy += 700 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y - R > H) fallers.splice(i, 1);
    }

    if (state !== STATE.PLAY) return;

    // Descend-warning pulse intensity based on how close the field is.
    const lowY = lowestBubbleY();
    const closeness = (lowY - (DEATH_LINE - 130)) / 130;
    descendWarn = Math.max(0, Math.min(1, closeness));

    // Move the flying bubble with substeps so it can't tunnel through bubbles.
    if (shot) {
      const steps = 4;
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        shot.x += shot.vx * sdt;
        shot.y += shot.vy * sdt;

        // Bounce off side walls.
        if (shot.x - R < FIELD_X) { shot.x = FIELD_X + R; shot.vx = Math.abs(shot.vx); sndWall(); }
        else if (shot.x + R > W - FIELD_X) { shot.x = W - FIELD_X - R; shot.vx = -Math.abs(shot.vx); sndWall(); }

        // Hit the ceiling -> snap.
        if (shot.y - R <= FIELD_TOP) { shot.y = FIELD_TOP + R; afterShotResolved(); return; }

        // Collide with any nearby placed bubble.
        if (hitsAnyBubble(shot.x, shot.y)) { afterShotResolved(); return; }
      }
    }
  }

  function hitsAnyBubble(x, y) {
    // Only test a band of rows around the shot for speed.
    const approxR = Math.round((y - FIELD_TOP - R) / ROW_H);
    const touch = (D - 2) * (D - 2); // slightly less than full diameter
    for (let r = Math.max(0, approxR - 2); r <= Math.min(ROWS - 1, approxR + 2); r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] === null) continue;
        const dx = x - cellX(r, c);
        const dy = y - cellY(r);
        if (dx * dx + dy * dy <= touch) return true;
      }
    }
    return false;
  }

  // After the shot lands: snap it, handle descend cadence, ready the launcher.
  function afterShotResolved() {
    snapShot();
    shot = null;
    if (state !== STATE.PLAY) return; // snap may have ended the game

    shotsUntilDescend--;
    if (shotsUntilDescend <= 0) {
      descendField();
      shotsUntilDescend = shotsPerDescend;
    }
    // Make sure the launcher colour is still useful; if its colour vanished
    // from the field, re-roll to something present (keeps the game fair).
    const present = colorsInGrid();
    if (present.size > 0 && !present.has(curColor)) curColor = pickColor();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawBubble(x, y, colorIdx, scale) {
    const s = scale || 1;
    const rr = R * s;
    const hue = PALETTE[colorIdx % PALETTE.length].h;
    // Radial gradient gives each bubble a glossy sphere look.
    const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.35, rr * 0.15, x, y, rr);
    g.addColorStop(0, hsl(hue, 90, 78));
    g.addColorStop(0.45, hsl(hue, 85, 58));
    g.addColorStop(1, hsl(hue, 80, 38));
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Rim.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hsl(hue, 70, 28);
    ctx.stroke();
    // Specular highlight.
    ctx.beginPath();
    ctx.arc(x - rr * 0.32, y - rr * 0.34, rr * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
  }

  function drawField() {
    for (let r = 0; r < ROWS; r++) {
      const n = colsInRow(r);
      for (let c = 0; c < n; c++) {
        if (grid[r][c] === null) continue;
        const y = cellY(r);
        if (y - R > H) continue;
        drawBubble(cellX(r, c), y, grid[r][c], 1);
      }
    }
  }

  function drawAimGuide() {
    // Simulate the shot path (with wall bounces) and draw a dotted guide.
    let x = launcherX, y = launcherY;
    let vx = Math.cos(aimAngle), vy = Math.sin(aimAngle);
    const stepLen = 9;
    let dotted = 0;
    ctx.save();
    for (let i = 0; i < 220; i++) {
      x += vx * stepLen;
      y += vy * stepLen;
      if (x - R < FIELD_X) { x = FIELD_X + R; vx = Math.abs(vx); }
      else if (x + R > W - FIELD_X) { x = W - FIELD_X - R; vx = -Math.abs(vx); }
      if (y - R <= FIELD_TOP) break;
      if (hitsAnyBubble(x, y)) break;
      if ((dotted++ % 2) === 0) {
        const fade = 1 - i / 220;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(159,180,212,' + (0.5 * fade + 0.12) + ')';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawLauncher() {
    // Barrel pointing along the aim angle.
    ctx.save();
    ctx.translate(launcherX, launcherY);
    ctx.rotate(aimAngle);
    ctx.fillStyle = '#2a3346';
    ctx.strokeStyle = '#46506b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-7, -6, R + 16, 12, 5) : ctx.rect(-7, -6, R + 16, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Base hub.
    ctx.beginPath();
    ctx.arc(launcherX, launcherY, R + 7, 0, Math.PI * 2);
    ctx.fillStyle = '#1a2030';
    ctx.fill();
    ctx.strokeStyle = '#46506b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current bubble sits in the launcher (only when not in flight).
    if (!shot && state === STATE.PLAY) drawBubble(launcherX, launcherY, curColor, 1);
    else if (state !== STATE.PLAY) drawBubble(launcherX, launcherY, curColor, 1);
  }

  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;

    // Score (left) and best (right).
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('SCORE ' + score, 10, H - 26);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('LV ' + level, W / 2, 8);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#8a96ad';
    ctx.fillText('BEST ' + best, W - 10, H - 26);

    // Next bubble preview (top-right of the launcher area).
    ctx.shadowBlur = 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6b7890';
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXT', W - 64, launcherY);
    drawBubble(W - 40, launcherY, nextColor, 0.7);

    // Shots-until-descend pips (top-left).
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b7890';
    ctx.fillText('DESCEND IN', 10, 14);
    for (let i = 0; i < shotsPerDescend; i++) {
      ctx.beginPath();
      ctx.arc(94 + i * 12, 14, 4, 0, Math.PI * 2);
      ctx.fillStyle = i < shotsUntilDescend ? '#9fb4d4' : '#2a3346';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDeathLine() {
    // Dashed danger line; pulses red as the field gets close.
    const pulse = descendWarn;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(' + Math.floor(120 + pulse * 135) + ',' +
      Math.floor(70 - pulse * 40) + ',' + Math.floor(80 - pulse * 40) + ',' +
      (0.4 + pulse * 0.5) + ')';
    ctx.beginPath();
    ctx.moveTo(FIELD_X, DEATH_LINE);
    ctx.lineTo(W - FIELD_X, DEATH_LINE);
    ctx.stroke();
    ctx.restore();

    if (pulse > 0.55) {
      const a = (Math.sin(performance.now() / 90) * 0.5 + 0.5) * (pulse - 0.55) / 0.45;
      ctx.save();
      ctx.fillStyle = 'rgba(220,60,70,' + (0.12 * a) + ')';
      ctx.fillRect(0, DEATH_LINE, W, H - DEATH_LINE);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const hue = PALETTE[p.color % PALETTE.length].h;
      const a = 1 - p.t / p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + hue + ',85%,65%,' + a + ')';
      ctx.fill();
    }
  }

  function drawFallers() {
    for (let i = 0; i < fallers.length; i++) {
      drawBubble(fallers[i].x, fallers[i].y, fallers[i].color, 1);
    }
  }

  function drawPopFlashes() {
    for (let i = 0; i < popFlashes.length; i++) {
      const f = popFlashes[i];
      const a = 1 - f.t / 0.35;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 * a) + ')';
      ctx.stroke();
    }
  }

  function drawComboText() {
    if (!comboText) return;
    const a = 1 - comboText.t / 1.0;
    ctx.save();
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,238,150,' + a + ')';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(comboText.msg, comboText.x, comboText.y);
    ctx.restore();
  }

  // Centred panel used by title / win / over overlays.
  function panel(title, lines, accent) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,11,0.78)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = accent || '#9fb4d4';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '700 38px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - 70);

    ctx.shadowBlur = 0;
    ctx.font = '400 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#cdd6e4';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], W / 2, H / 2 - 18 + i * 26);
    }
    ctx.restore();
  }

  // A little decorative bubble cluster behind the title.
  function drawTitleBubbles() {
    const demo = [0, 4, 1, 3, 6, 2, 5];
    for (let i = 0; i < demo.length; i++) {
      const x = W / 2 - (demo.length - 1) * (D + 4) / 2 + i * (D + 4);
      const y = H / 2 + 86;
      drawBubble(x, y, demo[i], 1);
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Subtle screen shake.
    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // Playfield frame.
    ctx.save();
    ctx.strokeStyle = 'rgba(70,80,107,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(FIELD_X - 2, FIELD_TOP - 2, COLS * D + 4, DEATH_LINE - FIELD_TOP + 4);
    ctx.restore();

    drawField();
    drawDeathLine();
    drawPopFlashes();
    drawFallers();
    drawParticles();

    if (state === STATE.PLAY) {
      drawAimGuide();
      if (shot) drawBubble(shot.x, shot.y, shot.color, 1);
    }
    drawLauncher();
    drawComboText();
    drawHUD();

    if (state === STATE.TITLE) {
      drawTitleBubbles();
      panel('BUBBLE SHOOTER', [
        'Aim with the mouse, match 3+ colours to pop.',
        'Drop disconnected bubbles for bonus points.',
        'Clear the field to advance — don\'t let it reach the line!',
        '',
        'Press SPACE / ENTER or CLICK to start'
      ]);
    } else if (state === STATE.WIN) {
      panel('LEVEL CLEAR', [
        'Score: ' + score + '    Best: ' + best,
        'Next up: level ' + level,
        '',
        'Press SPACE / ENTER or CLICK to continue'
      ], '#7ee0a0');
    } else if (state === STATE.OVER) {
      panel('GAME OVER', [
        'Score: ' + score + '    Best: ' + best,
        'The bubbles crossed the line.',
        '',
        'Press SPACE / ENTER or CLICK to restart'
      ], '#e08a8a');
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Main loop — fixed-ish timestep via rAF with clamped delta.
  // ---------------------------------------------------------------------------
  let lastT = performance.now();
  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05; // clamp so a tab-switch can't teleport the shot
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Prevent the page from scrolling on space when the canvas isn't focused.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
  }, { passive: false });

})();
