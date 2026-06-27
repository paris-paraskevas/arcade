// ============================================================
//  FROGGER  —  the arcade classic, pure HTML5 Canvas + vanilla JS.
//  No libraries, no asset files. Just open index.html.
//
//  The board is a grid of rows, each TILE px tall (see TILE):
//    row 0            -> the HOME bank with 5 slots to fill
//    rows 1..5        -> the RIVER (logs + turtles drift; water kills)
//    row 6            -> the GRASS median (safe)
//    rows 7..11       -> the ROAD (cars + trucks; collision kills)
//    row 12           -> the START bank (safe, where the frog spawns)
//
//  Each lane carries "movers" (vehicles or platforms) that scroll
//  left or right and wrap around. The frog hops one whole tile at a
//  time. On the river it must be standing ON a log/turtle or it
//  drowns; while riding it drifts along with the platform. A per-trip
//  timer drains — run out and you lose a life. Fill all 5 homes to
//  clear the level; each level speeds everything up.
//
//  Read step()/update() and the lane setup in buildLevel() to see
//  how the whole thing fits together.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 600 — fixed internal resolution
  const HEIGHT = canvas.height;  // 680 — (CSS scales it to the page)

  // ---- Board geometry (tweak these to change the feel) --------
  const TILE = 40;                 // px per grid tile
  const COLS = WIDTH / TILE;       // 15 columns across
  const ROWS = HEIGHT / TILE;      // 17 rows tall
  const HUD_H = TILE * 1;          // top strip reserved for HUD text

  // Playfield rows are measured from the row just under the HUD.
  // We lay the field out in 16 "field rows" (HEIGHT - HUD_H = 640 = 16*40).
  // Row indices used in the lane tables below:
  const FIELD_TOP = HUD_H;                 // y where the field starts
  const FIELD_ROWS = (HEIGHT - HUD_H) / TILE; // 16

  // Map a field-row index (0 = top home bank) to a pixel Y.
  function rowY(r) { return FIELD_TOP + r * TILE; }

  // Logical rows within the field:
  const ROW_HOME = 0;     // home slots live here
  const ROW_RIVER0 = 1;   // first river lane
  const ROW_RIVER_LAST = 5;
  const ROW_MEDIAN = 6;   // safe grass strip
  const ROW_ROAD0 = 7;    // first road lane
  const ROW_ROAD_LAST = 11;
  const ROW_START = 12;   // frog spawns here (safe bank)
  // rows 13..15 are a little extra bank/HUD padding at the very bottom

  const START_COL = (COLS - 1) / 2;  // 7 — middle column

  const NUM_HOMES = 5;
  const START_LIVES = 3;
  const TRIP_TIME = 30;              // seconds per trip before the timer kills you

  // ---- Palette ------------------------------------------------
  const C = {
    water: '#16455e',
    waterDark: '#103447',
    road: '#23262d',
    roadLine: '#5b6472',
    grass: '#1f7a44',
    grassDark: '#176236',
    bank: '#1f7a44',
    home: '#0d3b22',
    homeLip: '#2fd07e',
    frog: '#7ee06b',
    frogDark: '#3da94f',
    frogEye: '#0c1812',
    log: '#8a5a32',
    logDark: '#6e4626',
    turtle: '#2fa36b',
    turtleDark: '#1f7a4f',
    turtleShell: '#155c3a',
    text: '#e8eef6',
    accent: '#9fb4d4',
    dim: '#8190a6',
    danger: '#ff5d6c',
    gold: '#ffd35e',
  };

  // Vehicle colours, cycled per lane for variety.
  const CAR_COLORS = ['#ff5d6c', '#5ec8ff', '#ffd35e', '#c08bff', '#ff9a4d'];
  const TRUCK_COLOR = '#d8dee9';

  // ============================================================
  //  GAME STATE  — every field is given a real value here AND in
  //  resetGame()/buildLevel(), so the title & game-over screens
  //  (which still run update+render) never read undefined.
  // ============================================================
  let state = 'title';      // 'title' | 'playing' | 'won' | 'dead'
  let lanes = [];           // array of lane objects (see buildLevel)
  let homes = [];           // 5 home slots: {x, filled}
  let frog = makeFrog();    // the player frog (always exists)
  let particles = [];       // death/score particle bursts
  let lives = START_LIVES;
  let score = 0;
  let best = 0;
  let level = 1;
  let homesFilled = 0;
  let tripTimer = TRIP_TIME; // counts down in seconds
  let flash = 0;            // screen-flash intensity 0..1 (fades)
  let shake = 0;            // screen-shake magnitude (fades)
  let last = 0;             // timestamp of previous frame
  let furthestRow = ROW_START; // furthest-forward row reached this trip (for bonus)
  let bgPhase = 0;          // animates water shimmer

  // ---- Frog factory (so it's never undefined) -----------------
  function makeFrog() {
    return {
      col: START_COL,        // grid column (can be fractional while riding)
      row: ROW_START,        // field-row index
      px: START_COL * TILE,  // pixel position (top-left of tile)
      py: rowY(ROW_START),
      tx: START_COL * TILE,  // hop target (we ease px->tx for a snappy hop)
      ty: rowY(ROW_START),
      hopStartX: START_COL * TILE, // where the current hop began (for the ease)
      hopStartY: rowY(ROW_START),
      hopT: 1,               // hop progress 0..1 (1 = settled)
      facing: 'up',          // direction the frog sprite faces
      dead: false,           // briefly true during a death animation
      deathTimer: 0,         // counts down during the death anim before respawn
      onPlatform: null,      // the mover the frog is riding, or null
    };
  }

  // ---- High score (localStorage, guarded) ---------------------
  function loadBest() {
    try { return parseInt(localStorage.getItem('frogger.best'), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('frogger.best', String(v)); } catch (e) { /* ignore */ }
  }
  best = loadBest();

  // ---- Audio (WebAudio, lazy on first input, fully guarded) ---
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
      o.type = type || 'square';
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
  // A quick downward chirp for the hop.
  function sndHop() {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(760, t + 0.08);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.start(t); o.stop(t + 0.13);
    } catch (e) { /* ignore */ }
  }
  const sndSplash = () => { blip(300, 0.18, 'sine', 0.08); blip(150, 0.3, 'sine', 0.06); };
  const sndSquish = () => { blip(160, 0.22, 'sawtooth', 0.08); blip(70, 0.34, 'sawtooth', 0.07); };
  const sndHome = () => { blip(660, 0.1, 'square'); setTimeout(() => blip(880, 0.14, 'square'), 90); };
  const sndWin = () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.07), i * 110));
  };

  // ============================================================
  //  LEVEL / LANE SETUP
  //  Each lane is one field-row that carries movers in one
  //  direction. dir = +1 (rightward) or -1 (leftward). speed is in
  //  tiles/second. Movers wrap seamlessly using the lane's total span.
  // ============================================================
  function makeLane(row, kind, dir, speed, opts) {
    opts = opts || {};
    const lane = {
      row: row,
      y: rowY(row),
      kind: kind,            // 'road' | 'river'
      dir: dir,              // +1 or -1
      speed: speed,          // tiles per second (scaled by level)
      movers: [],            // {x (px), w (px), len (tiles), type}
      type: opts.type || 'car',
      gap: opts.gap || 3,    // gap (tiles) between movers
      len: opts.len || 1,    // length of each mover in tiles
      color: opts.color || CAR_COLORS[0],
    };

    // Lay movers across the row with the given length+gap, plus a
    // random phase so lanes don't line up. We span a bit beyond the
    // screen on both sides so wrapping is invisible.
    const period = lane.len + lane.gap;            // tiles between mover starts
    const count = Math.ceil(COLS / period) + 2;    // enough to cover + spare
    const phase = Math.random() * period;          // random stagger
    for (let i = 0; i < count; i++) {
      const startTile = i * period + phase - period; // start a touch off-screen left
      lane.movers.push({
        x: startTile * TILE,
        w: lane.len * TILE,
        len: lane.len,
        type: lane.type,
        // turtles can periodically dive (become deadly water) — flagged per mover
        diver: lane.type === 'turtle' && Math.random() < 0.5,
        divePhase: Math.random() * Math.PI * 2,
      });
    }
    // The wrap span: width that, when a mover passes it, resets it to
    // the other side. Use count*period tiles so spacing stays uniform.
    lane.span = count * period * TILE;
    return lane;
  }

  // Build all lanes for the current level. Higher levels => faster.
  function buildLevel() {
    const sp = 1 + (level - 1) * 0.18;   // global speed multiplier per level
    lanes = [];

    // --- RIVER lanes (rows 1..5): logs & turtles -------------
    // Mix lengths/directions so the crossing reads as a real river.
    lanes.push(makeLane(ROW_RIVER0,     'river', -1, 1.1 * sp, { type: 'turtle', len: 1, gap: 2.4, color: C.turtle }));
    lanes.push(makeLane(ROW_RIVER0 + 1, 'river', +1, 0.8 * sp, { type: 'log',    len: 3, gap: 3.5, color: C.log }));
    lanes.push(makeLane(ROW_RIVER0 + 2, 'river', +1, 1.5 * sp, { type: 'log',    len: 2, gap: 3,   color: C.log }));
    lanes.push(makeLane(ROW_RIVER0 + 3, 'river', -1, 1.0 * sp, { type: 'turtle', len: 1, gap: 2.2, color: C.turtle }));
    lanes.push(makeLane(ROW_RIVER0 + 4, 'river', +1, 0.95 * sp,{ type: 'log',    len: 4, gap: 4,   color: C.log }));

    // --- ROAD lanes (rows 7..11): cars & trucks --------------
    lanes.push(makeLane(ROW_ROAD0,     'road', -1, 1.3 * sp, { type: 'car',   len: 1, gap: 3.5, color: CAR_COLORS[0] }));
    lanes.push(makeLane(ROW_ROAD0 + 1, 'road', +1, 1.8 * sp, { type: 'car',   len: 1, gap: 4,   color: CAR_COLORS[1] }));
    lanes.push(makeLane(ROW_ROAD0 + 2, 'road', -1, 1.0 * sp, { type: 'truck', len: 2, gap: 4.5, color: TRUCK_COLOR }));
    lanes.push(makeLane(ROW_ROAD0 + 3, 'road', +1, 2.2 * sp, { type: 'car',   len: 1, gap: 5,   color: CAR_COLORS[3] }));
    lanes.push(makeLane(ROW_ROAD0 + 4, 'road', -1, 1.6 * sp, { type: 'truck', len: 2, gap: 5,   color: TRUCK_COLOR }));
  }

  // ---- Homes (5 evenly spaced slots on the top bank) ----------
  function buildHomes() {
    homes = [];
    // 5 slots placed at columns 1,4,7,10,13 (each 2 tiles wide visually,
    // but the landing target is the single column listed here).
    const cols = [1, 4, 7, 10, 13];
    for (let i = 0; i < NUM_HOMES; i++) {
      homes.push({ col: cols[i], filled: false });
    }
  }

  // ============================================================
  //  RESET
  // ============================================================
  function resetGame() {
    lives = START_LIVES;
    score = 0;
    level = 1;
    homesFilled = 0;
    particles = [];
    flash = 0;
    shake = 0;
    buildLevel();
    buildHomes();
    placeFrogAtStart();
  }

  function nextLevel() {
    level++;
    homesFilled = 0;
    buildLevel();
    buildHomes();
    placeFrogAtStart();
    sndWin();
  }

  // Put the frog on the start bank, reset its trip state.
  function placeFrogAtStart() {
    frog = makeFrog();
    tripTimer = TRIP_TIME;
    furthestRow = ROW_START;
  }

  // ============================================================
  //  INPUT  —  hop one tile. Rejected mid-hop so moves feel crisp.
  // ============================================================
  const HOP_KEYS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  function tryHop(dir) {
    if (state !== 'playing') return;
    if (frog.dead) return;
    if (frog.hopT < 1) return;        // already mid-hop — ignore

    let nc = frog.col, nr = frog.row;
    if (dir === 'up') nr -= 1;
    else if (dir === 'down') nr += 1;
    else if (dir === 'left') nc -= 1;
    else if (dir === 'right') nc += 1;
    frog.facing = dir;

    // Snap fractional column (from riding a log) to the nearest tile
    // before committing a horizontal/vertical hop, so we land on-grid.
    if (dir === 'up' || dir === 'down') nc = Math.round(frog.col);

    // Clamp to the board; ignore hops that would leave the field.
    if (nr < ROW_HOME || nr > ROW_START) return;
    if (nc < 0 || nc > COLS - 1) {
      // Allow facing change but no move past the side walls.
      if (dir === 'left' || dir === 'right') return;
    }

    frog.col = nc;
    frog.row = nr;
    frog.onPlatform = null;          // leaving any platform we rode
    frog.hopStartX = frog.px;        // remember where the hop began...
    frog.hopStartY = frog.py;
    frog.tx = nc * TILE;             // ...and where it's going
    frog.ty = rowY(nr);
    frog.hopT = 0;                   // begin hop animation (0 -> 1)
    sndHop();

    // Reaching a new furthest-forward row gives a little score.
    if (nr < furthestRow) {
      furthestRow = nr;
      addScore(10);
    }
  }

  function addScore(n) {
    score += n;
    if (score > best) { best = score; saveBest(best); }
  }

  // ============================================================
  //  UPDATE  (dt in seconds)
  // ============================================================
  function update(dt) {
    bgPhase += dt;

    // Move every lane's movers (always animate, even on title, so the
    // board behind the overlay looks alive).
    for (const lane of lanes) {
      const dx = lane.dir * lane.speed * TILE * dt;
      for (const m of lane.movers) {
        m.x += dx;
        // Wrap: keep movers cycling within [-span/2-ish, +span/2-ish].
        if (lane.dir > 0 && m.x > WIDTH + TILE) m.x -= lane.span;
        else if (lane.dir < 0 && m.x + m.w < -TILE) m.x += lane.span;
        // Turtle dive cycle (visual + lethality).
        if (m.type === 'turtle') {
          m.divePhase += dt * 1.3;
        }
      }
    }

    // Particles drift + fade regardless of state.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 220 * dt;          // gravity
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (shake > 0) shake = Math.max(0, shake - dt * 26);

    if (state !== 'playing') return;

    // --- Frog hop animation ------------------------------------
    // Advance the hop timer, then ease the pixel position from the
    // remembered start (hopStartX/Y, set in tryHop) toward the target.
    if (frog.hopT < 1) {
      frog.hopT = Math.min(1, frog.hopT + dt * 9); // ~0.11s per hop
      const e = easeOutQuad(frog.hopT);
      frog.px = frog.hopStartX + (frog.tx - frog.hopStartX) * e;
      frog.py = frog.hopStartY + (frog.ty - frog.hopStartY) * e;
      if (frog.hopT >= 1) { frog.px = frog.tx; frog.py = frog.ty; }
    }

    // --- Trip timer --------------------------------------------
    tripTimer -= dt;
    if (tripTimer <= 0) {
      killFrog('time');
      return;
    }

    // --- River physics: ride platforms or drown ----------------
    const r = frog.row;
    const settled = frog.hopT >= 1;

    if (r >= ROW_RIVER0 && r <= ROW_RIVER_LAST) {
      const lane = laneAtRow(r);
      let riding = null;
      if (lane) {
        // Use the frog's CURRENT pixel centre to test what it's on.
        const fcx = frog.px + TILE / 2;
        for (const m of lane.movers) {
          // A diving turtle that's currently submerged doesn't carry you.
          if (m.type === 'turtle' && m.diver && isSubmerged(m)) continue;
          if (fcx >= m.x && fcx <= m.x + m.w) { riding = m; break; }
        }
      }
      if (riding) {
        frog.onPlatform = riding;
        // Drift with the log/turtle (only once the hop has settled, so a
        // hop in progress isn't fought by the current).
        if (settled) {
          frog.px += lane.dir * lane.speed * TILE * dt;
          frog.tx = frog.px;                 // keep target synced while riding
          frog.col = frog.px / TILE;         // fractional column
          // Carried off the screen edge => lost in the river.
          if (frog.px < -TILE * 0.5 || frog.px > WIDTH - TILE * 0.5) {
            killFrog('water');
            return;
          }
        }
      } else if (settled) {
        // In a river row with nothing under us => splash.
        killFrog('water');
        return;
      }
    } else {
      frog.onPlatform = null;
    }

    // --- Road physics: vehicle collision -----------------------
    if (r >= ROW_ROAD0 && r <= ROW_ROAD_LAST && settled) {
      const lane = laneAtRow(r);
      if (lane) {
        const fl = frog.px + 6;            // small forgiveness inset
        const fr = frog.px + TILE - 6;
        for (const m of lane.movers) {
          if (fr > m.x + 3 && fl < m.x + m.w - 3) {
            killFrog('squish');
            return;
          }
        }
      }
    }

    // --- Reaching the home bank --------------------------------
    if (r === ROW_HOME && settled) {
      tryEnterHome();
    }
  }

  function laneAtRow(row) {
    for (const lane of lanes) if (lane.row === row) return lane;
    return null;
  }

  // Is a diving turtle currently submerged (deadly)? Smooth sine cycle;
  // submerged for the lower part of the wave.
  function isSubmerged(m) {
    return Math.sin(m.divePhase) < -0.45;
  }

  // Try to drop the frog into a home slot. Must align with an empty slot.
  function tryEnterHome() {
    const fcx = frog.px + TILE / 2;
    for (const h of homes) {
      const hx = h.col * TILE + TILE / 2;
      if (!h.filled && Math.abs(fcx - hx) < TILE * 0.6) {
        h.filled = true;
        homesFilled++;
        addScore(50 + Math.max(0, Math.ceil(tripTimer)) * 2); // time bonus
        burst(hx, rowY(ROW_HOME) + TILE / 2, C.homeLip, 26);
        flash = Math.min(1, flash + 0.5);
        sndHome();
        if (homesFilled >= NUM_HOMES) {
          // Level cleared!
          addScore(200);
          state = 'won';
          flash = 1;
          shake = 8;
        } else {
          placeFrogAtStart();
        }
        return;
      }
    }
    // Landed on the bank but not in a slot (hit the lip) => death.
    killFrog('squish');
  }

  // ---- Death --------------------------------------------------
  function killFrog(cause) {
    if (frog.dead) return;
    frog.dead = true;
    lives--;
    shake = 9;
    flash = Math.min(1, flash + 0.45);
    const cx = frog.px + TILE / 2, cy = frog.py + TILE / 2;
    if (cause === 'water' || cause === 'time') {
      burst(cx, cy, '#6fd0ff', 30);
      sndSplash();
    } else {
      burst(cx, cy, C.danger, 30);
      sndSquish();
    }
    // Short delay before respawn / game over (handled by a timer field).
    frog.deathTimer = 0.7;
  }

  // ---- Particle burst -----------------------------------------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 160;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1,
        color: color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  // ---- Math helpers -------------------------------------------
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

  // ============================================================
  //  DEATH / RESPAWN TICK  (separate so update() stays readable)
  // ============================================================
  function tickDeath(dt) {
    if (!frog.dead) return;
    frog.deathTimer -= dt;
    if (frog.deathTimer <= 0) {
      if (lives <= 0) {
        state = 'dead';
      } else {
        placeFrogAtStart();
      }
    }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function draw() {
    // Optional screen-shake offset.
    let ox = 0, oy = 0;
    if (shake > 0) {
      ox = (Math.random() * 2 - 1) * shake;
      oy = (Math.random() * 2 - 1) * shake;
    }
    ctx.save();
    ctx.translate(ox, oy);

    drawField();
    drawHomes();
    drawLanes();
    drawParticles();
    if (state === 'playing' || state === 'won' || (state === 'dead')) drawFrog();

    ctx.restore();

    drawHUD();

    // Overlays (drawn without shake so text is steady).
    if (state === 'title') drawTitle();
    else if (state === 'won') drawWon();
    else if (state === 'dead') drawGameOver();

    // Screen flash on top of everything.
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.35) + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  // Background bands: bank / road / median / river / home bank.
  function drawField() {
    // Whole field base.
    ctx.fillStyle = '#0a1410';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // HUD strip backdrop.
    ctx.fillStyle = '#0c0f16';
    ctx.fillRect(0, 0, WIDTH, HUD_H);

    // River block (rows 1..5).
    drawWater(rowY(ROW_RIVER0), TILE * (ROW_RIVER_LAST - ROW_RIVER0 + 1));

    // Home bank (row 0) — grass with planted bushes between slots.
    ctx.fillStyle = C.home;
    ctx.fillRect(0, rowY(ROW_HOME), WIDTH, TILE);

    // Median grass (row 6).
    drawGrass(rowY(ROW_MEDIAN), TILE);

    // Road block (rows 7..11).
    drawRoad(rowY(ROW_ROAD0), TILE * (ROW_ROAD_LAST - ROW_ROAD0 + 1));

    // Start bank + bottom padding (rows 12..15).
    drawGrass(rowY(ROW_START), HEIGHT - rowY(ROW_START));
  }

  function drawGrass(y, h) {
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, y, WIDTH, h);
    // Subtle darker stripes for texture.
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < WIDTH; x += TILE) {
      if (((x / TILE) | 0) % 2 === 0) ctx.fillRect(x, y, TILE, h);
    }
  }

  function drawWater(y, h) {
    ctx.fillStyle = C.water;
    ctx.fillRect(0, y, WIDTH, h);
    // Shimmer: faint moving horizontal highlights.
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < h / TILE; i++) {
      const yy = y + i * TILE + (Math.sin(bgPhase * 1.5 + i) * 3 + TILE * 0.5);
      ctx.fillRect(0, yy, WIDTH, 2);
    }
  }

  function drawRoad(y, h) {
    ctx.fillStyle = C.road;
    ctx.fillRect(0, y, WIDTH, h);
    // Dashed lane dividers between road rows.
    ctx.strokeStyle = C.roadLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 16]);
    for (let i = 1; i < (h / TILE); i++) {
      const ly = y + i * TILE;
      ctx.beginPath();
      ctx.moveTo(0, ly); ctx.lineTo(WIDTH, ly);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Solid kerb lines top & bottom of the road.
    ctx.strokeStyle = '#8a93a3';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, y + 1); ctx.lineTo(WIDTH, y + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y + h - 1); ctx.lineTo(WIDTH, y + h - 1); ctx.stroke();
  }

  // Home slots: 5 cosy nooks; filled ones show a happy frog.
  function drawHomes() {
    const y = rowY(ROW_HOME);
    // Bushes fill the bank; carve out the 5 slot openings.
    for (const h of homes) {
      const cx = h.col * TILE + TILE / 2;
      // Slot opening (slightly inset rounded rect).
      ctx.fillStyle = h.filled ? C.homeLip : '#09301c';
      roundRect(cx - TILE * 0.42, y + 4, TILE * 0.84, TILE - 8, 8);
      ctx.fill();
      if (h.filled) {
        drawMiniFrog(cx, y + TILE / 2);
      } else {
        // Inner shadow to read as an empty nook.
        ctx.fillStyle = '#06241544';
        roundRect(cx - TILE * 0.30, y + 8, TILE * 0.6, TILE - 16, 6);
        ctx.fill();
      }
    }
  }

  function drawMiniFrog(cx, cy) {
    ctx.save();
    ctx.fillStyle = C.frog;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.frogEye;
    ctx.beginPath(); ctx.arc(cx - 5, cy - 4, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, cy - 4, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Draw all movers in all lanes.
  function drawLanes() {
    for (const lane of lanes) {
      for (const m of lane.movers) {
        if (lane.kind === 'river') {
          if (m.type === 'log') drawLog(m, lane);
          else drawTurtle(m, lane);
        } else {
          if (m.type === 'truck') drawVehicle(m, lane, true);
          else drawVehicle(m, lane, false);
        }
      }
    }
  }

  function drawLog(m, lane) {
    const y = lane.y + 5, h = TILE - 10;
    ctx.fillStyle = C.logDark;
    roundRect(m.x, y + 2, m.w, h, 9);
    ctx.fill();
    ctx.fillStyle = C.log;
    roundRect(m.x, y, m.w, h - 2, 9);
    ctx.fill();
    // End-grain rings on the left cap.
    ctx.strokeStyle = C.logDark;
    ctx.lineWidth = 2;
    const ry = y + (h - 2) / 2;
    ctx.beginPath(); ctx.arc(m.x + 9, ry, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(m.x + 9, ry, 2, 0, Math.PI * 2); ctx.stroke();
    // Bark streaks.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let sx = m.x + 18; sx < m.x + m.w - 6; sx += 14) {
      ctx.beginPath(); ctx.moveTo(sx, y + 6); ctx.lineTo(sx + 6, y + h - 8); ctx.stroke();
    }
  }

  function drawTurtle(m, lane) {
    const submerged = m.diver && isSubmerged(m);
    const cx = m.x + m.w / 2, cy = lane.y + TILE / 2;
    const r = TILE * 0.34;
    if (submerged) {
      // Just ripples when dived (a warning that it won't carry you).
      ctx.strokeStyle = 'rgba(180,230,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r * (0.7 + 0.2 * Math.sin(bgPhase * 4)), 0, Math.PI * 2); ctx.stroke();
      return;
    }
    // Body.
    ctx.fillStyle = C.turtleDark;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.turtle;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2); ctx.fill();
    // Shell pattern.
    ctx.fillStyle = C.turtleShell;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
    // Little head poking in the travel direction.
    ctx.fillStyle = C.turtle;
    ctx.beginPath();
    ctx.arc(cx + lane.dir * r * 0.9, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawVehicle(m, lane, isTruck) {
    const y = lane.y + 6, h = TILE - 12;
    const x = m.x, w = m.w;
    // Body.
    ctx.fillStyle = lane.color;
    roundRect(x + 2, y, w - 4, h, isTruck ? 4 : 7);
    ctx.fill();
    if (isTruck) {
      // Cab vs trailer split.
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      const cabW = TILE * 0.7;
      const cabX = lane.dir > 0 ? x + w - cabW - 4 : x + 4;
      roundRect(cabX, y + 2, cabW, h - 4, 4);
      ctx.fill();
    } else {
      // Windshield.
      ctx.fillStyle = 'rgba(10,20,30,0.55)';
      const winX = lane.dir > 0 ? x + w * 0.5 : x + w * 0.2;
      roundRect(winX, y + 3, w * 0.3, h - 6, 4);
      ctx.fill();
    }
    // Headlights — a hint of direction.
    ctx.fillStyle = C.gold;
    const lx = lane.dir > 0 ? x + w - 5 : x + 1;
    ctx.fillRect(lx, y + 3, 4, 4);
    ctx.fillRect(lx, y + h - 7, 4, 4);
  }

  function drawFrog() {
    // Hop "lift": frog scales up slightly at the apex of a hop.
    const apex = Math.sin(Math.min(frog.hopT, 1) * Math.PI);
    const lift = frog.dead ? 0 : apex * 4;
    const scale = frog.dead ? 1 + (0.7 - (frog.deathTimer || 0)) * 0.6 : 1 + apex * 0.12;

    const cx = frog.px + TILE / 2;
    const cy = frog.py + TILE / 2 - lift;
    const R = TILE * 0.36 * scale;

    ctx.save();
    ctx.translate(cx, cy);
    // Face the hop direction.
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[frog.facing] || 0;
    ctx.rotate(rot);

    if (frog.dead) {
      ctx.globalAlpha = Math.max(0, (frog.deathTimer || 0) / 0.7);
    }

    // Hind legs (little splayed feet).
    ctx.fillStyle = C.frogDark;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sgn * R * 0.75, R * 0.6, R * 0.28, R * 0.5, sgn * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Front legs.
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sgn * R * 0.7, -R * 0.5, R * 0.22, R * 0.42, sgn * -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Body.
    ctx.fillStyle = C.frogDark;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.frog;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.fill();
    // Back stripe.
    ctx.fillStyle = C.frogDark;
    roundRect(-R * 0.12, -R * 0.6, R * 0.24, R * 1.0, R * 0.12);
    ctx.fill();
    // Eyes up top (two bumps).
    ctx.fillStyle = C.frog;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sgn * R * 0.42, -R * 0.62, R * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = C.frogEye;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sgn * R * 0.42, -R * 0.66, R * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD ----------------------------------------------------
  function drawHUD() {
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 5;

    // Score (left).
    ctx.textAlign = 'left';
    ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText('SCORE ' + score, 12, HUD_H / 2);

    // Lives as little frog dots (centre-left).
    ctx.shadowBlur = 0;
    for (let i = 0; i < Math.max(0, lives); i++) {
      const lx = 168 + i * 22;
      ctx.fillStyle = C.frog;
      ctx.beginPath(); ctx.arc(lx, HUD_H / 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.frogEye;
      ctx.beginPath(); ctx.arc(lx - 2.5, HUD_H / 2 - 2, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(lx + 2.5, HUD_H / 2 - 2, 1.6, 0, Math.PI * 2); ctx.fill();
    }

    // Level (centre).
    ctx.shadowBlur = 5;
    ctx.textAlign = 'center';
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText('LEVEL ' + level, WIDTH * 0.62, HUD_H / 2);

    // Best (right).
    ctx.textAlign = 'right';
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = C.dim;
    ctx.fillText('BEST ' + best, WIDTH - 12, HUD_H / 2);
    ctx.shadowBlur = 0;

    // Trip-timer bar pinned to the very bottom edge.
    if (state === 'playing' || state === 'won') {
      const frac = Math.max(0, Math.min(1, tripTimer / TRIP_TIME));
      const barH = 5;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, HEIGHT - barH, WIDTH, barH);
      // Colour shifts green -> amber -> red as time runs out.
      const col = frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffd35e' : '#ff5d6c';
      ctx.fillStyle = col;
      ctx.fillRect(0, HEIGHT - barH, WIDTH * frac, barH);
    }
  }

  // ---- Overlays -----------------------------------------------
  function text(str, x, y, size, color, weight) {
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function dimPanel() {
    ctx.fillStyle = 'rgba(6,12,9,0.7)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawTitle() {
    dimPanel();
    text('FROGGER', WIDTH / 2, HEIGHT * 0.30, 56, C.frog, 800);
    text('Get the frog across road & river — home safe.', WIDTH / 2, HEIGHT * 0.42, 17, C.text, 600);
    text('Arrow keys or W A S D to hop', WIDTH / 2, HEIGHT * 0.485, 15, C.dim, 500);
    text('Ride logs & turtles · avoid cars & water · fill all 5 homes', WIDTH / 2, HEIGHT * 0.53, 14, C.dim, 500);
    text('Press  Space  or  Enter  to play', WIDTH / 2, HEIGHT * 0.64, 20, C.accent, 700);
  }

  function drawWon() {
    dimPanel();
    text('LEVEL ' + level + ' CLEAR!', WIDTH / 2, HEIGHT * 0.34, 44, C.gold, 800);
    text('All homes filled', WIDTH / 2, HEIGHT * 0.45, 18, C.text, 600);
    text('Score  ' + score, WIDTH / 2, HEIGHT * 0.51, 18, C.dim, 600);
    text('Press  Space  or  Enter  for the next level', WIDTH / 2, HEIGHT * 0.63, 19, C.accent, 700);
  }

  function drawGameOver() {
    dimPanel();
    text('GAME OVER', WIDTH / 2, HEIGHT * 0.33, 48, C.danger, 800);
    text('Score  ' + score, WIDTH / 2, HEIGHT * 0.46, 22, C.text, 700);
    text('Best  ' + best, WIDTH / 2, HEIGHT * 0.515, 18, C.dim, 600);
    text('Reached level ' + level, WIDTH / 2, HEIGHT * 0.56, 15, C.dim, 500);
    text('Press  Space  or  Enter  to play again', WIDTH / 2, HEIGHT * 0.66, 20, C.accent, 700);
  }

  // ---- Rounded-rect helper ------------------------------------
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

  // ============================================================
  //  MAIN LOOP  — delta-time, clamped so a tab-switch can't
  //  teleport everything across the screen.
  // ============================================================
  function loop(now) {
    let dt = (now - last) / 1000;   // seconds
    last = now;
    if (dt > 0.05) dt = 0.05;       // clamp (max ~20fps step)

    update(dt);
    tickDeath(dt);
    draw();

    requestAnimationFrame(loop);
  }

  // ============================================================
  //  INPUT
  // ============================================================
  function startOrAdvance() {
    if (state === 'title' || state === 'dead') {
      resetGame();
      state = 'playing';
    } else if (state === 'won') {
      nextLevel();
      state = 'playing';
    }
  }

  window.addEventListener('keydown', (e) => {
    ensureAudio();  // first gesture unlocks WebAudio

    // Start / restart / advance on Space OR Enter.
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      startOrAdvance();
      return;
    }

    const dir = HOP_KEYS[e.code];
    if (dir) {
      e.preventDefault();
      tryHop(dir);
    }
  });

  // A click also starts/advances (handy on touch / when canvas has focus).
  canvas.addEventListener('mousedown', () => {
    ensureAudio();
    startOrAdvance();
  });
  // Touch: tap to start; (movement stays on keys per the brief).
  canvas.addEventListener('touchstart', (e) => {
    ensureAudio();
    startOrAdvance();
    e.preventDefault();
  }, { passive: false });

  // ============================================================
  //  GO  — build a live board BEHIND the title screen, then run.
  // ============================================================
  resetGame();              // fills lanes/homes/frog with real values
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
