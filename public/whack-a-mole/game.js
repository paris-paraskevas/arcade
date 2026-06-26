// ============================================================
//  WHACK-A-MOLE  —  pure HTML5 Canvas + vanilla JS.
//  No libraries, no asset files. Just open index.html.
//
//  How it works: nine holes sit in a 3x3 grid. A scheduler pops
//  moles out of random empty holes for a short, shrinking window;
//  click one while it's "up" to whack it. Each hole runs its own
//  little state machine — rising -> up -> falling -> empty — and
//  the renderer clips each mole to its hole so it really looks
//  like it's climbing out of the ground. A 60s clock counts down
//  while difficulty ramps: spawns get faster, up-time shrinks,
//  and double pop-ups (and bombs) start showing up. Read
//  spawnMole(), updateHole() and the scheduler in update() to see
//  the whole thing.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;    // 600 — fixed internal resolution
  const HEIGHT = canvas.height;  // 560 — (CSS scales it to the page)

  // ---- Tunables (change these to reshape the feel) ------------
  const GAME_TIME = 60;          // seconds on the clock
  const COLS = 3, ROWS = 3;      // 3x3 grid of holes
  const HOLES = COLS * ROWS;

  // Grid geometry. The board area sits below a HUD strip.
  const HUD_H = 64;              // top strip reserved for score/time
  const FIELD_Y = HUD_H;
  const FIELD_H = HEIGHT - HUD_H;
  const CELL_W = WIDTH / COLS;
  const CELL_H = FIELD_H / ROWS;
  const HOLE_RX = CELL_W * 0.34; // hole ellipse radii
  const HOLE_RY = CELL_H * 0.20;

  // Difficulty ramps from t=0 (easy) to t=1 (end of game).
  const SPAWN_MIN = 0.95;        // sec between spawns, early
  const SPAWN_MAX_GAP = 0.55;    // shrink toward (SPAWN_MIN - this) late
  const UP_MIN = 0.65;           // shortest "fully up" window, late
  const UP_MAX = 1.25;           // longest "fully up" window, early
  const RISE_TIME = 0.12;        // sec to rise out of the hole
  const FALL_TIME = 0.16;        // sec to drop back down
  const DOUBLE_AT = 0.35;        // progress past which doubles can occur
  const BOMB_AT = 0.22;          // progress past which bombs can appear
  const BOMB_CHANCE = 0.16;      // odds a given pop-up is a bomb (late-ish)
  const HIT_PENALTY = 8;         // points lost for whacking a bomb

  // ---- Colours / theme ----------------------------------------
  const C = {
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    dirt: '#3a2d22',
    dirtRim: '#4d3b2c',
    holeDark: '#140d08',
    grass1: '#27331c',
    grass2: '#1d2716',
    mole: '#8a6a4a',
    moleDark: '#6f5238',
    moleBelly: '#caa985',
    bomb: '#23262e',
    bombHi: '#3a3f4b',
    fuse: '#ffb454',
    good: '#3ddc84',
    bad: '#ff5d6c',
    gold: '#ffd86b',
  };

  // ---- Game state (ALL initialized here at LOAD) --------------
  // States: 'title' | 'playing' | 'over'
  let state = 'title';
  let holes = [];                // 9 hole state-machines (built below)
  let particles = [];            // pop/whack debris
  let floaters = [];             // little "+1" / "MISS" score pops
  let score = 0;
  let best = 0;
  let combo = 0;                 // consecutive hits, drives the multiplier
  let bestCombo = 0;
  let hits = 0, misses = 0, bombsHit = 0;
  let timeLeft = GAME_TIME;
  let spawnTimer = 0;            // counts down to the next spawn
  let progress = 0;              // 0..1 difficulty ramp (1 - timeLeft/total)
  let shake = 0;                 // screen-shake magnitude, decays
  let flash = 0;                 // full-screen red flash alpha (bomb hits)
  let last = 0;                  // timestamp of previous frame

  // Build the nine holes. Each is its own tiny state machine:
  //   phase: 'empty' | 'rising' | 'up' | 'falling'
  //   t:     seconds elapsed in the current phase
  //   up:    duration to stay fully up (set when it rises)
  //   bomb:  true if this pop-up is a bomb (don't hit!)
  //   bonk:  >0 squash animation timer when whacked, decays
  function buildHoles() {
    holes = [];
    for (let i = 0; i < HOLES; i++) {
      const col = i % COLS;
      const row = (i / COLS) | 0;
      holes.push({
        i,
        cx: col * CELL_W + CELL_W / 2,
        cy: FIELD_Y + row * CELL_H + CELL_H * 0.56, // hole sits low in its cell
        phase: 'empty',
        t: 0,
        up: UP_MAX,
        bomb: false,
        bonk: 0,
        wobble: Math.random() * Math.PI * 2, // idle phase offset per hole
      });
    }
  }

  // ---- High score (localStorage, guarded) ---------------------
  function loadBest() {
    try { return parseInt(localStorage.getItem('whack.best'), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('whack.best', String(v)); } catch (e) { /* ignore */ }
  }

  // ---- Audio (WebAudio, lazy-created on first input) ----------
  // Wrapped so a blocked/missing AudioContext can NEVER break play.
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
  }
  // Generic short tone with an envelope.
  function tone(freq, dur, type, vol, slideTo) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      const t = audioCtx.currentTime;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      const v = vol == null ? 0.08 : vol;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* never break the game for a sound */ }
  }
  // Short filtered noise burst — used for the bonk thud / explosion.
  function noise(dur, vol, lowpass) {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const n = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(vol == null ? 0.18 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = src;
      if (lowpass) {
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lowpass;
        src.connect(f); f.connect(g);
      } else {
        src.connect(g);
      }
      g.connect(audioCtx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  const sndBonk = () => { tone(420, 0.08, 'square', 0.09, 150); noise(0.10, 0.12, 1200); };
  const sndWhiff = () => tone(180, 0.10, 'sine', 0.05, 90);
  const sndPop   = () => tone(700, 0.05, 'triangle', 0.04);
  const sndBoom  = () => { noise(0.4, 0.3, 700); tone(70, 0.45, 'sawtooth', 0.12, 35); };
  const sndStart = () => { tone(523, 0.08, 'square', 0.07); tone(784, 0.12, 'square', 0.07); };
  const sndOver  = () => { tone(392, 0.14, 'square', 0.07); tone(294, 0.22, 'square', 0.07); };

  // ---- Setup / reset ------------------------------------------
  function resetGame() {
    buildHoles();
    particles = [];
    floaters = [];
    score = 0;
    combo = 0;
    bestCombo = 0;
    hits = 0; misses = 0; bombsHit = 0;
    timeLeft = GAME_TIME;
    progress = 0;
    spawnTimer = 0.5;            // brief beat before the first mole
    shake = 0;
    flash = 0;
  }

  // ---- Spawning -----------------------------------------------
  // Pop a mole out of a random EMPTY hole. Later in the game we
  // sometimes pop two at once and sometimes make a pop-up a bomb.
  function spawnMole(forceNoBomb) {
    const empty = holes.filter(h => h.phase === 'empty');
    if (empty.length === 0) return false;
    const h = empty[(Math.random() * empty.length) | 0];
    h.phase = 'rising';
    h.t = 0;
    h.bonk = 0;
    // Up-window shrinks as progress climbs.
    h.up = UP_MAX - (UP_MAX - UP_MIN) * progress;
    // Bombs only after BOMB_AT, and never on a forced second spawn
    // pile-up that already produced one (keeps it fair).
    const canBomb = !forceNoBomb && progress > BOMB_AT;
    h.bomb = canBomb && Math.random() < BOMB_CHANCE * Math.min(1, progress + 0.3);
    sndPop();
    return true;
  }

  function scheduleSpawns(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    // Gap between spawns shrinks with progress.
    const gap = SPAWN_MIN - SPAWN_MAX_GAP * progress;
    spawnTimer = gap * (0.7 + Math.random() * 0.6); // jitter so it's not metronomic
    const firstWasBomb = !spawnMoleAndReport();
    // Chance of a simultaneous second mole, growing with progress.
    if (progress > DOUBLE_AT && Math.random() < (progress - DOUBLE_AT) * 0.9) {
      spawnMole(true); // second one is never a bomb on the same beat
    }
    void firstWasBomb;
  }
  // Tiny wrapper so the double-spawn logic reads clearly.
  function spawnMoleAndReport() { return spawnMole(false); }

  // ---- Per-hole update ----------------------------------------
  function updateHole(h, dt) {
    if (h.bonk > 0) h.bonk = Math.max(0, h.bonk - dt * 4);
    h.wobble += dt;

    if (h.phase === 'rising') {
      h.t += dt;
      if (h.t >= RISE_TIME) { h.phase = 'up'; h.t = 0; }
    } else if (h.phase === 'up') {
      h.t += dt;
      if (h.t >= h.up) { h.phase = 'falling'; h.t = 0; }
    } else if (h.phase === 'falling') {
      h.t += dt;
      if (h.t >= FALL_TIME) {
        // It escaped un-hit. Bombs are SAFE to ignore — only a real
        // mole going down counts as a "miss" and breaks the combo.
        if (!h.bomb) { misses++; combo = 0; }
        h.phase = 'empty';
        h.t = 0;
        h.bomb = false;
      }
    }
  }

  // How far out of the ground a hole's mole currently is (0..1).
  function moleRaise(h) {
    if (h.phase === 'rising') return h.t / RISE_TIME;
    if (h.phase === 'up') return 1;
    if (h.phase === 'falling') return 1 - h.t / FALL_TIME;
    return 0;
  }

  // ---- Hit testing --------------------------------------------
  // A hole is "whackable" only while it's rising/up/falling and has
  // actually emerged a bit. We test the visible mole's bounding
  // ellipse, lifted by how far it has risen.
  function whackHoleAt(px, py) {
    for (const h of holes) {
      if (h.phase === 'empty') continue;
      const raise = moleRaise(h);
      if (raise <= 0.15) continue;
      const lift = raise * CELL_H * 0.42;
      const mx = h.cx;
      const my = h.cy - lift - HOLE_RY * 0.2;
      const rx = HOLE_RX * 0.95;
      const ry = HOLE_RY * 1.7;
      const dx = (px - mx) / rx;
      const dy = (py - my) / ry;
      if (dx * dx + dy * dy <= 1) { whack(h); return true; }
    }
    return false;
  }

  function whack(h) {
    if (h.bomb) {
      // Whacked a bomb — penalty, combo reset, big juice.
      bombsHit++;
      score = Math.max(0, score - HIT_PENALTY);
      combo = 0;
      h.phase = 'empty'; h.t = 0; h.bomb = false; h.bonk = 0;
      shake = Math.min(18, shake + 14);
      flash = 0.8;
      burst(h.cx, h.cy - CELL_H * 0.35, C.bad, 26, 5);
      floaters.push({ x: h.cx, y: h.cy - CELL_H * 0.4, t: 0, life: 0.9,
        txt: '-' + HIT_PENALTY, color: C.bad, size: 30 });
      sndBoom();
      return;
    }
    // Good hit. Combo grows; every 3 in a row adds a multiplier step.
    hits++;
    combo++;
    if (combo > bestCombo) bestCombo = combo;
    const mult = 1 + Math.floor(combo / 3);
    const gained = 10 * mult;
    score += gained;
    if (score > best) { best = score; saveBest(best); }

    h.phase = 'falling';      // knock it back down
    h.t = FALL_TIME * 0.5;    // start mid-fall so it snaps down fast
    h.bonk = 1;               // squash animation
    shake = Math.min(10, shake + 4);
    burst(h.cx, h.cy - CELL_H * 0.3, C.moleBelly, 14, 3.5);
    const col = mult >= 3 ? C.gold : C.good;
    floaters.push({ x: h.cx, y: h.cy - CELL_H * 0.42, t: 0, life: 0.8,
      txt: '+' + gained + (mult > 1 ? ' x' + mult : ''), color: col, size: 24 });
    sndBonk();
  }

  function registerMiss(px, py) {
    // Clicked dirt (no mole there). Small combo reset + whiff.
    misses++;
    combo = 0;
    floaters.push({ x: px, y: py, t: 0, life: 0.6, txt: 'miss', color: C.dim, size: 18 });
    sndWhiff();
  }

  // ---- Particles / floaters -----------------------------------
  function burst(x, y, color, n, speed) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.5, // bias upward so debris arcs
        life: 0.5 + Math.random() * 0.4,
        t: 0,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.vy += 16 * dt;        // gravity
      p.x += p.vx;
      p.y += p.vy;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.t >= f.life) { floaters.splice(i, 1); continue; }
      f.y -= 34 * dt;         // drift upward
    }
  }

  // ---- Update -------------------------------------------------
  function update(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 36);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    updateParticles(dt);
    for (const h of holes) updateHole(h, dt);

    if (state !== 'playing') return;

    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame();
      return;
    }
    progress = 1 - timeLeft / GAME_TIME;
    scheduleSpawns(dt);
  }

  function endGame() {
    state = 'over';
    if (score > best) { best = score; saveBest(best); }
    // Send any still-up moles back down for a tidy game-over board.
    for (const h of holes) {
      if (h.phase === 'rising' || h.phase === 'up') { h.phase = 'falling'; h.t = 0; }
    }
    sndOver();
  }

  // ---- Drawing helpers ----------------------------------------
  function ellipse(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }

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

  // The grassy field with nine dirt holes.
  function drawField() {
    // Grass background with subtle vertical banding.
    const grad = ctx.createLinearGradient(0, FIELD_Y, 0, HEIGHT);
    grad.addColorStop(0, C.grass1);
    grad.addColorStop(1, C.grass2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, FIELD_Y, WIDTH, FIELD_H);

    // Faint grass texture: scattered short blades (deterministic-ish).
    ctx.strokeStyle = 'rgba(120,150,90,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const gx = (i * 67) % WIDTH;
      const gy = FIELD_Y + ((i * 113) % FIELD_H);
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 1.5, gy - 5);
    }
    ctx.stroke();

    for (const h of holes) drawHole(h);
  }

  function drawHole(h) {
    // Dirt mound rim.
    ctx.save();
    ellipse(h.cx, h.cy + HOLE_RY * 0.35, HOLE_RX * 1.18, HOLE_RY * 1.15);
    ctx.fillStyle = C.dirtRim;
    ctx.fill();
    ellipse(h.cx, h.cy + HOLE_RY * 0.25, HOLE_RX * 1.05, HOLE_RY * 1.0);
    ctx.fillStyle = C.dirt;
    ctx.fill();
    // The dark hole opening.
    ellipse(h.cx, h.cy, HOLE_RX, HOLE_RY);
    ctx.fillStyle = C.holeDark;
    ctx.fill();
    ctx.restore();

    // Draw the mole clipped to the hole opening so it appears to
    // climb out of the ground rather than float over the rim.
    const raise = moleRaise(h);
    if (raise > 0.001) {
      ctx.save();
      // Clip region: the hole plus everything above it.
      ctx.beginPath();
      ctx.rect(h.cx - HOLE_RX * 1.4, FIELD_Y - 40, HOLE_RX * 2.8, (h.cy - FIELD_Y) + 40 + HOLE_RY);
      ctx.ellipse(h.cx, h.cy, HOLE_RX, HOLE_RY, 0, 0, Math.PI * 2);
      ctx.clip();
      drawMole(h, raise);
      ctx.restore();
    }

    // Front lip of the hole, drawn over the mole's bottom so it
    // really reads as "inside" the opening.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(h.cx, h.cy, HOLE_RX, HOLE_RY, 0, 0, Math.PI, false);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  function drawMole(h, raise) {
    // Vertical lift from the hole, plus a squash when bonked.
    const lift = raise * CELL_H * 0.42;
    const squash = h.bonk > 0 ? h.bonk * 0.35 : 0;
    const cx = h.cx;
    const cy = h.cy - lift - HOLE_RY * 0.2;
    const bodyRx = HOLE_RX * (0.82 + squash * 0.5);
    const bodyRy = HOLE_RX * (0.92 - squash * 0.6); // a touch taller than wide

    if (h.bomb) { drawBomb(cx, cy, bodyRx, bodyRy, h); return; }

    // ---- Mole body ----
    ctx.save();
    // Body.
    ellipse(cx, cy, bodyRx, bodyRy);
    ctx.fillStyle = C.mole;
    ctx.fill();
    // Belly highlight.
    ellipse(cx, cy + bodyRy * 0.18, bodyRx * 0.6, bodyRy * 0.62);
    ctx.fillStyle = C.moleBelly;
    ctx.fill();
    // Snout.
    ellipse(cx, cy + bodyRy * 0.30, bodyRx * 0.30, bodyRy * 0.22);
    ctx.fillStyle = C.moleDark;
    ctx.fill();
    // Nose.
    ellipse(cx, cy + bodyRy * 0.28, bodyRx * 0.10, bodyRy * 0.08);
    ctx.fillStyle = '#2a1d14';
    ctx.fill();
    // Ears.
    for (const sgn of [-1, 1]) {
      ellipse(cx + sgn * bodyRx * 0.62, cy - bodyRy * 0.45, bodyRx * 0.20, bodyRy * 0.20);
      ctx.fillStyle = C.moleDark;
      ctx.fill();
    }
    // Eyes — squeeze shut while being bonked (cute hit feedback).
    const eyeY = cy - bodyRy * 0.12;
    const eyeOff = bodyRx * 0.34;
    if (h.bonk > 0.25) {
      ctx.strokeStyle = '#2a1d14';
      ctx.lineWidth = 2.5;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sgn * eyeOff - 5, eyeY);
        ctx.lineTo(cx + sgn * eyeOff + 5, eyeY);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#1a110a';
      for (const sgn of [-1, 1]) {
        ellipse(cx + sgn * eyeOff, eyeY, bodyRx * 0.085, bodyRx * 0.10);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBomb(cx, cy, rx, ry, h) {
    const r = Math.min(rx, ry) * 1.0;
    ctx.save();
    // Body.
    ellipse(cx, cy, r, r);
    ctx.fillStyle = C.bomb;
    ctx.fill();
    // Highlight glint.
    ellipse(cx - r * 0.30, cy - r * 0.32, r * 0.26, r * 0.20);
    ctx.fillStyle = C.bombHi;
    ctx.fill();
    // Fuse cap.
    ctx.fillStyle = '#11131a';
    ctx.fillRect(cx - r * 0.18, cy - r * 1.18, r * 0.36, r * 0.30);
    // Sparking fuse — flickers.
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.05);
    ctx.quadraticCurveTo(cx + r * 0.45, cy - r * 1.5, cx + r * 0.15, cy - r * 1.7);
    ctx.stroke();
    const spark = 0.6 + 0.4 * Math.sin(h.wobble * 30);
    ctx.fillStyle = C.fuse;
    ctx.shadowColor = C.fuse;
    ctx.shadowBlur = 10 * spark;
    ellipse(cx + r * 0.15, cy - r * 1.7, 3 + spark * 2, 3 + spark * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const f of floaters) {
      const a = 1 - f.t / f.life;
      ctx.globalAlpha = Math.max(0, a);
      text(f.txt, f.x, f.y, f.size, f.color, 800);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    // Top strip backdrop.
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, WIDTH, HUD_H);

    // Score (left).
    text('SCORE', 18, 20, 12, C.dim, 600, 'left');
    text(String(score), 18, 42, 26, C.text, 800, 'left');

    // Time (center) — turns red in the final stretch and pulses.
    const lowTime = timeLeft <= 10 && state === 'playing';
    const tColor = lowTime ? C.bad : C.accent;
    const pulse = lowTime ? 1 + 0.08 * Math.sin(performance.now() / 120) : 1;
    ctx.save();
    ctx.translate(WIDTH / 2, HUD_H / 2);
    ctx.scale(pulse, pulse);
    text(Math.ceil(timeLeft) + 's', 0, 0, 30, tColor, 800);
    ctx.restore();

    // Best + combo (right).
    text('BEST ' + best, WIDTH - 18, 20, 12, C.dim, 600, 'right');
    if (combo >= 2 && state === 'playing') {
      const mult = 1 + Math.floor(combo / 3);
      const cc = mult >= 3 ? C.gold : C.good;
      text('COMBO ' + combo + (mult > 1 ? '  x' + mult : ''), WIDTH - 18, 44, 16, cc, 800, 'right');
    } else {
      text('COMBO ' + combo, WIDTH - 18, 44, 14, C.dim, 600, 'right');
    }

    // Time bar along the very top.
    const frac = Math.max(0, timeLeft / GAME_TIME);
    ctx.fillStyle = lowTime ? C.bad : C.accent;
    ctx.fillRect(0, 0, WIDTH * frac, 4);
  }

  function drawOverlay(lines) {
    ctx.fillStyle = 'rgba(8,12,8,0.72)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const ln of lines) text(ln.t, WIDTH / 2, ln.y, ln.s, ln.c, ln.w);
  }

  // ---- The frame ----------------------------------------------
  function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Screen-shake: jitter the whole field by a decaying offset.
    ctx.save();
    if (shake > 0) {
      const dx = (Math.random() * 2 - 1) * shake;
      const dy = (Math.random() * 2 - 1) * shake;
      ctx.translate(dx, dy);
    }

    drawField();
    drawParticles();

    ctx.restore();

    drawHUD();

    // Full-screen flash (bomb hits) — a quick red wash that fades.
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,93,108,' + Math.min(0.5, flash) + ')';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // Title screen.
    if (state === 'title') {
      drawOverlay([
        { t: 'WHACK-A-MOLE', y: HEIGHT * 0.30, s: 46, c: C.mole, w: 800 },
        { t: 'Click the moles as they pop up', y: HEIGHT * 0.45, s: 18, c: C.text, w: 600 },
        { t: 'Build combos · dodge the bombs', y: HEIGHT * 0.51, s: 15, c: C.dim, w: 500 },
        { t: '60 seconds on the clock', y: HEIGHT * 0.565, s: 15, c: C.dim, w: 500 },
        { t: 'Press  Space  to play', y: HEIGHT * 0.70, s: 20, c: C.accent, w: 700 },
      ]);
    }

    // Game-over screen.
    if (state === 'over') {
      const acc = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;
      drawOverlay([
        { t: "TIME'S UP", y: HEIGHT * 0.24, s: 42, c: C.gold, w: 800 },
        { t: 'Score  ' + score, y: HEIGHT * 0.38, s: 30, c: C.text, w: 800 },
        { t: 'Best  ' + best, y: HEIGHT * 0.45, s: 18, c: C.dim, w: 600 },
        { t: 'Hits ' + hits + '   ·   Accuracy ' + acc + '%', y: HEIGHT * 0.53, s: 16, c: C.dim, w: 600 },
        { t: 'Best combo ' + bestCombo + '   ·   Bombs hit ' + bombsHit, y: HEIGHT * 0.58, s: 16, c: C.dim, w: 600 },
        { t: 'Press  Space  to play again', y: HEIGHT * 0.72, s: 20, c: C.accent, w: 700 },
      ]);
    }
  }

  // ---- Main loop (delta-time, clamped) ------------------------
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05); // seconds, clamped (tab switch)
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- Input --------------------------------------------------
  function startOrRestart() {
    if (state === 'title' || state === 'over') {
      resetGame();
      state = 'playing';
      sndStart();
    }
  }

  // Map a DOM mouse/touch event to canvas-internal coordinates,
  // accounting for the CSS scaling (canvas is drawn at 600x560 but
  // displayed at min(96vw,600px)).
  function eventToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (WIDTH / rect.width);
    const cy = (e.clientY - rect.top) * (HEIGHT / rect.height);
    return { x: cx, y: cy };
  }

  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    if (state !== 'playing') { startOrRestart(); return; }
    const p = eventToCanvas(e);
    if (!whackHoleAt(p.x, p.y)) registerMiss(p.x, p.y);
  });

  // Touch support — same as a click on the tapped point.
  canvas.addEventListener('touchstart', (e) => {
    ensureAudio();
    e.preventDefault();
    if (state !== 'playing') { startOrRestart(); return; }
    const t = e.changedTouches[0];
    const p = eventToCanvas(t);
    if (!whackHoleAt(p.x, p.y)) registerMiss(p.x, p.y);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    ensureAudio(); // first user gesture unlocks WebAudio

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      startOrRestart();
      return;
    }

    // Bonus: number keys 1-9 map to holes (left-to-right, top-to-bottom).
    if (state === 'playing') {
      let idx = -1;
      if (e.code.startsWith('Digit')) idx = parseInt(e.code.slice(5), 10) - 1;
      else if (e.code.startsWith('Numpad')) idx = parseInt(e.code.slice(6), 10) - 1;
      if (idx >= 0 && idx < HOLES) {
        e.preventDefault();
        const h = holes[idx];
        if (h.phase !== 'empty' && moleRaise(h) > 0.15) whack(h);
        else registerMiss(h.cx, h.cy - CELL_H * 0.3);
      }
    }
  });

  // ---- Go -----------------------------------------------------
  best = loadBest();
  resetGame();            // build a valid board behind the title screen
  state = 'title';
  last = performance.now();
  requestAnimationFrame(loop);
})();
