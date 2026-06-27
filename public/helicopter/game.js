(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + context.  Landscape 760x440 internal resolution.
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 760
  const H = canvas.height;  // 440

  // ---------------------------------------------------------------------------
  // Tunables — the "twitchy but fair" sweet spot.  All in canvas-units/seconds.
  //   The chopper is held aloft only while the button is down: LIFT is an upward
  //   acceleration; GRAVITY pulls it down constantly.  Because lift > gravity it
  //   climbs while held and falls when released, with momentum (velocity) giving
  //   the classic floaty-but-responsive helicopter feel.  Velocity is clamped so
  //   neither a long hold nor a long drop becomes uncontrollable.
  // ---------------------------------------------------------------------------
  const GRAVITY = 900;        // constant downward accel (units/s^2)
  const LIFT = 1750;          // upward accel applied WHILE the button is held
  const MAX_UP = 360;         // terminal climb speed (clamp)
  const MAX_DOWN = 440;       // terminal fall speed (clamp)
  const HELI_X = 190;         // chopper's fixed horizontal screen position
  const HELI_W = 46;          // chopper body width  (for collision + drawing)
  const HELI_H = 20;          // chopper body height
  const HIT_PAD = 3;          // shrink the lethal box slightly -> a touch fair

  // Scroll speed ramps up with distance for escalating pressure.
  const BASE_SCROLL = 200;    // starting world speed (units/s)
  const MAX_SCROLL = 460;     // speed cap
  const SCROLL_RAMP = 7;      // +units/s added per 100 distance units travelled

  // The cave: two undulating walls (top + bottom) that breathe and slowly
  // narrow.  Built from "segments" of a fixed pixel width; each new segment's
  // gap centre + gap height are chosen so the opening drifts smoothly and never
  // becomes impossible.
  const SEG_W = 28;                 // pixel width of one wall segment
  const GAP_START = 240;            // starting vertical opening
  const GAP_MIN = 132;              // tightest the cave ever gets
  const GAP_NARROW_PER_DIST = 18;   // gap shrink per 1000 distance units
  const WALL_MARGIN = 26;           // keep the gap off the very top/bottom edges
  const MAX_GAP_DRIFT = 86;         // most a gap centre can move between segments

  // Floating block obstacles drift in from the right inside the open channel.
  const OBSTACLE_MIN_GAP = 360;     // min distance between obstacle spawns
  const OBSTACLE_MAX_GAP = 620;     // max distance between obstacle spawns
  const OBSTACLE_START_DIST = 900;  // no blocks until the player has settled in

  // ---------------------------------------------------------------------------
  // High score / best distance (localStorage, guarded so a locked-down file://
  // can never crash us).
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'helicopter_best';
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
  // Audio — WebAudio only, created lazily on the FIRST user gesture, every call
  // guarded so a missing/blocked AudioContext can NEVER break the game.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // A short tone with an envelope; `slideTo` bends the pitch over its duration.
  function tone(freq, dur, type, gain, slideTo) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.1, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  // Short noise burst (crash) built from a buffer of random samples + low-pass.
  function noiseBurst(dur, gain) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const n = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(gain || 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, now);
      src.connect(lp).connect(g).connect(audioCtx.destination);
      src.start(now);
      src.stop(now + dur);
    } catch (e) { /* ignore */ }
  }
  // A soft looping-ish rotor "chop": a low pulse retriggered while flying.  We
  // keep it cheap — one short tone per call, scheduled from the update loop.
  let rotorTimer = 0;
  function sndRotor(rate) {
    // pitch nudges up a touch with thrust so holding feels "powered".
    tone(70 + rate * 26, 0.06, 'square', 0.035, 60 + rate * 18);
  }
  const sndStart = () => { tone(440, 0.08, 'triangle', 0.10, 660); tone(660, 0.12, 'triangle', 0.08, 880); };
  const sndCrash = () => { tone(150, 0.40, 'sawtooth', 0.16, 50); noiseBurst(0.45, 0.34); };

  // ---------------------------------------------------------------------------
  // Game state.  EVERYTHING update()/render() reads is initialised here at LOAD
  // so the title and game-over screens (which also run update + render) never
  // touch an undefined value.  A blank canvas on load is a fail.
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, PLAYING: 1, DEAD: 2 };
  let state = STATE.TITLE;

  let dist = 0;            // distance travelled in world-units == raw score
  let score = 0;           // dist rounded to an int for display
  let scroll = BASE_SCROLL;
  let thrust = false;      // is the fly-up button currently held?
  let worldX = 0;          // total horizontal world offset (drives cave + parallax)

  // The chopper.  `y` is its vertical centre; `vy` vertical velocity; `tilt`
  // the drawn body pitch; `rotor` the spinning-blade phase; `bob` a gentle
  // idle hover used on the title screen.
  const heli = {
    y: H * 0.5,
    vy: 0,
    tilt: 0,
    rotor: 0,
    bob: 0,
  };

  // Cave wall segments.  `segs[i]` = { gapCenter, gapHalf } for the column at
  // world-x = caveBaseX + i*SEG_W.  We keep a rolling window covering the
  // screen plus a little buffer on each side.
  let segs = [];
  let caveBaseX = 0;       // world-x of segs[0]'s left edge
  let lastGapCenter = H * 0.5;
  let lastGapHalf = GAP_START / 2;

  // Floating obstacles: { x, y, w, h }.  x is a SCREEN x (moves left as we go).
  let obstacles = [];
  let nextObstacleAt = OBSTACLE_START_DIST;

  // Parallax: distant cave silhouettes drifting slower than the foreground.
  const farRocks = [];

  // Exhaust particles + crash debris.
  const particles = [];
  let shake = 0;           // screen-shake magnitude (decays)
  let flash = 0;           // white crash-flash alpha (decays)
  let deadTimer = 0;       // brief restart lock-out so a crash-press won't skip

  // ----- cave generation -----------------------------------------------------
  // Current target gap height shrinks with distance (clamped at GAP_MIN).
  // At ~10k distance the cave reaches its tightest, then holds there.
  function currentGap(atDist) {
    return Math.max(GAP_MIN, GAP_START - (atDist / 1000) * (GAP_NARROW_PER_DIST * 10));
  }

  // Pick the next segment's gap, drifting smoothly from the previous one and
  // keeping the whole opening inside the playfield.
  function nextSeg(atDist) {
    const gapHalf = currentGap(atDist) / 2;
    // Allowed band for the centre so neither wall pokes off-screen.
    const minC = WALL_MARGIN + gapHalf;
    const maxC = H - WALL_MARGIN - gapHalf;
    // Drift the centre by a bounded random amount (sinusoidal bias for a nice
    // rolling, undulating feel rather than pure noise).
    const wobble = Math.sin(atDist / 130) * MAX_GAP_DRIFT * 0.5;
    let c = lastGapCenter + (Math.random() * 2 - 1) * MAX_GAP_DRIFT * 0.5 + wobble * 0.04;
    if (c < minC) c = minC;
    if (c > maxC) c = maxC;
    lastGapCenter = c;
    lastGapHalf = gapHalf;
    return { gapCenter: c, gapHalf: gapHalf };
  }

  // Fill the rolling segment window from scratch (used at load + on restart).
  function seedCave() {
    segs = [];
    caveBaseX = 0;
    lastGapCenter = H * 0.5;
    lastGapHalf = GAP_START / 2;
    const count = Math.ceil(W / SEG_W) + 4;
    for (let i = 0; i < count; i++) {
      // Title screen uses a roomy, smooth cave so it reads cleanly behind text.
      segs.push(nextSeg(i * SEG_W * 0.5));
    }
  }

  // Map a world-x to the segment covering it, generating new segments on demand
  // as the world scrolls (and discarding ones that fell off the left).
  function segAt(screenX) {
    const wx = worldX + screenX;
    const idx = Math.floor((wx - caveBaseX) / SEG_W);
    return segs[idx];
  }

  // Keep the segment window populated for the visible range [−SEG_W, W+SEG_W].
  function updateCaveWindow() {
    // Discard segments that scrolled fully off the left.
    const leftWX = worldX - SEG_W;
    while (segs.length && caveBaseX + SEG_W < leftWX) {
      segs.shift();
      caveBaseX += SEG_W;
    }
    // Append segments until we cover the right edge + buffer.
    const rightWX = worldX + W + SEG_W * 2;
    while (caveBaseX + segs.length * SEG_W < rightWX) {
      segs.push(nextSeg(dist + segs.length * SEG_W));
    }
  }

  // ----- parallax -------------------------------------------------------------
  function seedFarRocks() {
    farRocks.length = 0;
    for (let i = 0; i < 10; i++) {
      farRocks.push({
        x: Math.random() * W,
        top: Math.random() < 0.5,            // hang from top or rise from bottom
        w: 50 + Math.random() * 90,
        h: 40 + Math.random() * 80,
        sp: 0.25 + Math.random() * 0.2,      // parallax factor of world speed
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle.
  // ---------------------------------------------------------------------------
  function startGame() {
    dist = 0;
    score = 0;
    scroll = BASE_SCROLL;
    worldX = 0;
    heli.y = H * 0.5;
    heli.vy = 0;
    heli.tilt = 0;
    heli.bob = 0;
    seedCave();
    obstacles = [];
    nextObstacleAt = OBSTACLE_START_DIST;
    particles.length = 0;
    shake = 0;
    flash = 0;
    rotorTimer = 0;
    state = STATE.PLAYING;
    sndStart();
  }

  function die() {
    if (state !== STATE.PLAYING) return;
    state = STATE.DEAD;
    deadTimer = 0.6;
    shake = 18;
    flash = 0.95;
    sndCrash();
    if (score > best) { best = score; saveBest(best); }
    if (window.Arcade) Arcade.submitScore('helicopter', score);  // raw distance survived (m)
    // Burst of fiery debris from the chopper.
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 260;
      particles.push({
        x: HELI_X, y: heli.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.6 + Math.random() * 0.5, max: 1.1,
        size: 2 + Math.random() * 3.5,
        color: Math.random() < 0.55 ? '#ffd24a' : (Math.random() < 0.6 ? '#ff8a3d' : '#ff5d3d'),
        grav: 520,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Exhaust — a steady stream of little puffs out the tail while flying, denser
  // when thrusting (gives the "powered climb" read).
  // ---------------------------------------------------------------------------
  function emitExhaust(dt) {
    const rate = thrust ? 90 : 45;              // particles/sec
    const n = rate * dt;
    let count = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: HELI_X - HELI_W * 0.5 - 2,
        y: heli.y + 4 + (Math.random() * 6 - 3),
        vx: -scroll * 0.5 - 30 - Math.random() * 40,
        vy: (Math.random() * 2 - 1) * 22 + (thrust ? 30 : 8),
        life: 0.3 + Math.random() * 0.25, max: 0.55,
        size: 2 + Math.random() * 2,
        color: thrust ? 'rgba(255,205,120,0.8)' : 'rgba(170,190,215,0.55)',
        grav: 30,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Input.  HOLD = thrust (ascend); release = fall.  A press also starts and
  // restarts.  Space OR Enter on the keyboard; mouse / touch via the canvas.
  // ---------------------------------------------------------------------------
  function onUserGesture() { initAudio(); }

  function pressStartOrRestart() {
    if (state === STATE.TITLE) {
      startGame();
    } else if (state === STATE.DEAD) {
      if (deadTimer <= 0) startGame();
    }
  }

  // Begin thrust (and use the same press to start/restart from non-playing).
  function beginThrust() {
    if (state === STATE.PLAYING) {
      thrust = true;
    } else {
      pressStartOrRestart();
      // If that started a fresh run, hold immediately so the press "takes".
      if (state === STATE.PLAYING) thrust = true;
    }
  }
  function endThrust() { thrust = false; }

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    const lk = (k || '').toLowerCase();
    const isFly = (lk === ' ' || lk === 'spacebar' || lk === 'space' ||
                   lk === 'arrowup' || lk === 'w');
    const isStart = isFly || lk === 'enter';
    if (!isStart) return;
    e.preventDefault();           // stop Space/↑/Enter from scrolling the page
    onUserGesture();
    if (e.repeat) {               // ignore key-repeat; we track held state ourselves
      if (state === STATE.PLAYING && isFly) thrust = true;
      return;
    }
    if (state === STATE.PLAYING) {
      if (isFly) thrust = true;   // Enter does nothing extra mid-run
    } else {
      // Title / dead: Space, ↑ or Enter all start/restart.
      pressStartOrRestart();
      if (state === STATE.PLAYING && isFly) thrust = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    const lk = (e.key || '').toLowerCase();
    if (lk === ' ' || lk === 'spacebar' || lk === 'space' ||
        lk === 'arrowup' || lk === 'w') {
      thrust = false;
    }
  });

  // Mouse: press-and-hold to fly.
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onUserGesture();
    beginThrust();
  });
  window.addEventListener('mouseup', () => { endThrust(); });

  // Touch: hold to fly.  passive:false so preventDefault suppresses scroll/zoom
  // and the synthetic mouse event on mobile.
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onUserGesture();
    beginThrust();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    endThrust();
  }, { passive: false });
  canvas.addEventListener('touchcancel', () => { endThrust(); });

  // Safety: if the tab loses focus mid-hold, stop thrusting so we don't fly
  // blindly into the ceiling on return.
  window.addEventListener('blur', () => { thrust = false; });

  // ---------------------------------------------------------------------------
  // Update.
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay transient effects in EVERY state so they finish even after death.
    if (shake > 0) shake = Math.max(0, shake - dt * 36);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.4);
    if (deadTimer > 0) deadTimer = Math.max(0, deadTimer - dt);

    heli.rotor += dt * (state === STATE.PLAYING ? 42 : 26); // blades always spin
    updateParticles(dt);

    if (state === STATE.TITLE) {
      // Idle hover: the chopper bobs gently so the scene is alive, not frozen.
      heli.bob += dt;
      heli.y = H * 0.5 + Math.sin(heli.bob * 1.8) * 14;
      heli.tilt = Math.sin(heli.bob * 1.8) * 0.05;
      // Drift the world slowly so the cave + parallax read as "in motion".
      worldX += BASE_SCROLL * 0.45 * dt;
      updateCaveWindow();
      updateParallax(BASE_SCROLL * 0.45, dt);
      return;
    }

    if (state === STATE.DEAD) {
      // Ragdoll: the chopper keeps falling until it settles, world stops.
      heli.vy = Math.min(heli.vy + GRAVITY * dt, MAX_DOWN);
      heli.y += heli.vy * dt;
      heli.tilt = Math.min(heli.tilt + dt * 3, 1.1);
      if (heli.y > H + 60) heli.y = H + 60;
      return;
    }

    // ---- PLAYING ----
    // Vertical physics: gravity always; lift only while held.  Clamp velocity.
    heli.vy += GRAVITY * dt;
    if (thrust) heli.vy -= LIFT * dt;
    if (heli.vy < -MAX_UP) heli.vy = -MAX_UP;
    if (heli.vy > MAX_DOWN) heli.vy = MAX_DOWN;
    heli.y += heli.vy * dt;

    // Body pitch leans with vertical velocity (nose-up climbing, nose-down dive)
    // plus a tiny rotor-driven wobble for life.
    const targetTilt = Math.max(-0.42, Math.min(0.5, heli.vy / 620));
    heli.tilt += (targetTilt - heli.tilt) * Math.min(1, dt * 12);

    // Advance the world; speed ramps with distance (capped).
    scroll = Math.min(MAX_SCROLL, BASE_SCROLL + (dist / 100) * SCROLL_RAMP);
    const adv = scroll * dt;
    worldX += adv;
    dist += adv;
    score = Math.floor(dist);

    updateCaveWindow();
    updateParallax(scroll, dt);

    // Exhaust + rotor SFX.
    emitExhaust(dt);
    rotorTimer -= dt;
    if (rotorTimer <= 0) {
      sndRotor(thrust ? 1 : 0.3);
      rotorTimer = thrust ? 0.085 : 0.16;
    }

    // ---- Obstacles ----
    // Spawn a floating block when we cross the next threshold, placed inside the
    // current open channel so it's always (just) avoidable.
    if (dist >= nextObstacleAt) {
      spawnObstacle();
      const gapAdd = OBSTACLE_MIN_GAP + Math.random() * (OBSTACLE_MAX_GAP - OBSTACLE_MIN_GAP);
      // Spawns get a little closer together as speed climbs.
      const tighten = Math.max(0.6, 1 - (scroll - BASE_SCROLL) / 900);
      nextObstacleAt = dist + gapAdd * tighten;
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= adv;
      if (o.x + o.w < -20) obstacles.splice(i, 1);
    }

    // ---- Collisions ----
    // The chopper's lethal box (slightly inset for fairness).
    const hx = HELI_X - HELI_W / 2 + HIT_PAD;
    const hy = heli.y - HELI_H / 2 + HIT_PAD;
    const hw = HELI_W - HIT_PAD * 2;
    const hh = HELI_H - HIT_PAD * 2;

    // Walls: sample the cave across the chopper's x-span; if its box pokes above
    // the gap's top or below its bottom at any sampled column, it's a crash.
    if (hitsWall(hx, hy, hw, hh)) { die(); return; }

    // Blocks.
    for (const o of obstacles) {
      if (hx < o.x + o.w && hx + hw > o.x && hy < o.y + o.h && hy + hh > o.y) {
        die();
        return;
      }
    }
  }

  // Sample several columns across the chopper to test against the undulating
  // walls (the walls are piecewise so we check a few points, not just one).
  function hitsWall(hx, hy, hw, hh) {
    const samples = 5;
    for (let i = 0; i <= samples; i++) {
      const sx = hx + (hw * i) / samples;
      const s = segAt(sx);
      if (!s) continue;
      const top = s.gapCenter - s.gapHalf;       // floor of the ceiling wall
      const bot = s.gapCenter + s.gapHalf;       // ceiling of the floor wall
      if (hy < top || hy + hh > bot) return true;
    }
    return false;
  }

  function spawnObstacle() {
    // Place inside the channel a bit to the right of the screen edge.
    const screenX = W + 30;
    const s = segAt(screenX) || { gapCenter: H / 2, gapHalf: GAP_START / 2 };
    const top = s.gapCenter - s.gapHalf;
    const bot = s.gapCenter + s.gapHalf;
    const channel = bot - top;
    // Block height scales with the channel but always leaves a gap to slip past.
    const h = Math.min(70, Math.max(24, channel * (0.28 + Math.random() * 0.22)));
    const w = 26 + Math.random() * 26;
    // Hug either the upper or lower wall, leaving a passable lane on the other.
    const margin = 14;
    const upper = Math.random() < 0.5;
    const y = upper
      ? top + margin + Math.random() * Math.max(0, (channel - h) * 0.35)
      : bot - margin - h - Math.random() * Math.max(0, (channel - h) * 0.35);
    obstacles.push({ x: screenX, y: y, w: w, h: h });
  }

  function updateParallax(speed, dt) {
    for (const r of farRocks) {
      r.x -= speed * r.sp * dt;
      if (r.x + r.w < -10) {
        r.x = W + Math.random() * 80;
        r.top = Math.random() < 0.5;
        r.w = 50 + Math.random() * 90;
        r.h = 40 + Math.random() * 80;
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      p.vx *= 0.99;
    }
  }

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------
  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * shake * 0.5,
                    (Math.random() * 2 - 1) * shake * 0.5);
    }

    drawBackground();
    drawParallax();
    drawCave();
    drawObstacles();
    drawParticles();
    drawHeli();
    drawHUD();

    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.DEAD) drawGameOver();

    ctx.restore();

    // Crash flash on top of everything (outside the shake transform).
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBackground() {
    // Deep cave gradient — darker at the edges, a faint glow down the channel.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f1a');
    g.addColorStop(0.5, '#101a2b');
    g.addColorStop(1, '#0a0f1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // A soft vignette-ish horizontal light beam through the middle.
    const beam = ctx.createLinearGradient(0, H * 0.5 - 120, 0, H * 0.5 + 120);
    beam.addColorStop(0, 'rgba(80,120,170,0)');
    beam.addColorStop(0.5, 'rgba(80,120,170,0.05)');
    beam.addColorStop(1, 'rgba(80,120,170,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(0, 0, W, H);
  }

  function drawParallax() {
    ctx.fillStyle = 'rgba(40,58,84,0.5)';
    for (const r of farRocks) {
      ctx.beginPath();
      if (r.top) {
        // Stalactite-ish wedge from the ceiling.
        ctx.moveTo(r.x, 0);
        ctx.lineTo(r.x + r.w, 0);
        ctx.lineTo(r.x + r.w * 0.5, r.h);
      } else {
        // Stalagmite-ish wedge from the floor.
        ctx.moveTo(r.x, H);
        ctx.lineTo(r.x + r.w, H);
        ctx.lineTo(r.x + r.w * 0.5, H - r.h);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw the two undulating cave walls as filled paths traced across the
  // segment window.  A lit rim line on each gap edge gives them dimension.
  function drawCave() {
    const firstScreenX = (caveBaseX - worldX);   // where segs[0] sits on-screen
    // ---- Ceiling wall (fills from y=0 down to gapTop) ----
    ctx.beginPath();
    ctx.moveTo(firstScreenX, 0);
    for (let i = 0; i < segs.length; i++) {
      const x = firstScreenX + i * SEG_W;
      const top = segs[i].gapCenter - segs[i].gapHalf;
      ctx.lineTo(x, top);
    }
    ctx.lineTo(firstScreenX + (segs.length - 1) * SEG_W, 0);
    ctx.closePath();
    const cg = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    cg.addColorStop(0, '#243a52');
    cg.addColorStop(1, '#16273b');
    ctx.fillStyle = cg;
    ctx.fill();

    // ---- Floor wall (fills from gapBot down to y=H) ----
    ctx.beginPath();
    ctx.moveTo(firstScreenX, H);
    for (let i = 0; i < segs.length; i++) {
      const x = firstScreenX + i * SEG_W;
      const bot = segs[i].gapCenter + segs[i].gapHalf;
      ctx.lineTo(x, bot);
    }
    ctx.lineTo(firstScreenX + (segs.length - 1) * SEG_W, H);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, H * 0.5, 0, H);
    fg.addColorStop(0, '#16273b');
    fg.addColorStop(1, '#243a52');
    ctx.fillStyle = fg;
    ctx.fill();

    // Glowing rim lines along the channel edges.
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(120,170,225,0.55)';
    // ceiling edge
    ctx.beginPath();
    for (let i = 0; i < segs.length; i++) {
      const x = firstScreenX + i * SEG_W;
      const top = segs[i].gapCenter - segs[i].gapHalf;
      if (i === 0) ctx.moveTo(x, top); else ctx.lineTo(x, top);
    }
    ctx.stroke();
    // floor edge
    ctx.beginPath();
    for (let i = 0; i < segs.length; i++) {
      const x = firstScreenX + i * SEG_W;
      const bot = segs[i].gapCenter + segs[i].gapHalf;
      if (i === 0) ctx.moveTo(x, bot); else ctx.lineTo(x, bot);
    }
    ctx.stroke();
  }

  function drawObstacles() {
    for (const o of obstacles) {
      // Metallic floating block with bolts + a hazard stripe.
      const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
      g.addColorStop(0, '#6b7686');
      g.addColorStop(0.5, '#4a5462');
      g.addColorStop(1, '#363e49');
      ctx.fillStyle = g;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = '#2a313a';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      // Hazard stripe.
      ctx.fillStyle = 'rgba(255,196,60,0.85)';
      ctx.fillRect(o.x, o.y + o.h * 0.5 - 3, o.w, 6);
      // Bolts.
      ctx.fillStyle = 'rgba(200,212,228,0.6)';
      const b = 2;
      ctx.fillRect(o.x + 3, o.y + 3, b, b);
      ctx.fillRect(o.x + o.w - 3 - b, o.y + 3, b, b);
      ctx.fillRect(o.x + 3, o.y + o.h - 3 - b, b, b);
      ctx.fillRect(o.x + o.w - 3 - b, o.y + o.h - 3 - b, b, b);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // The chopper: body, cockpit glass, tail boom + tail rotor, skids, and a
  // spinning main rotor disc.  Drawn at HELI_X / heli.y, pitched by heli.tilt.
  function drawHeli() {
    if (state === STATE.DEAD && heli.y > H + 40) return; // gone off-screen
    ctx.save();
    ctx.translate(HELI_X, heli.y);
    ctx.rotate(heli.tilt);

    // Subtle glow.
    ctx.shadowColor = 'rgba(120,180,230,0.45)';
    ctx.shadowBlur = 10;

    // Tail boom (drawn first, behind body).
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3f7ab5';
    ctx.beginPath();
    ctx.moveTo(-HELI_W * 0.35, -3);
    ctx.lineTo(-HELI_W * 0.95, -1);
    ctx.lineTo(-HELI_W * 0.95, 3);
    ctx.lineTo(-HELI_W * 0.35, 5);
    ctx.closePath();
    ctx.fill();
    // Tail fin.
    ctx.fillStyle = '#2f5c8a';
    ctx.beginPath();
    ctx.moveTo(-HELI_W * 0.95, -1);
    ctx.lineTo(-HELI_W * 1.02, -10);
    ctx.lineTo(-HELI_W * 0.86, 1);
    ctx.closePath();
    ctx.fill();
    // Tail rotor (small fast spin).
    ctx.save();
    ctx.translate(-HELI_W * 0.95, 1);
    ctx.rotate(heli.rotor * 2.3);
    ctx.strokeStyle = 'rgba(180,200,225,0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
    ctx.stroke();
    ctx.restore();

    // Body — rounded capsule with a gradient.
    const bg = ctx.createLinearGradient(0, -HELI_H / 2, 0, HELI_H / 2);
    bg.addColorStop(0, '#5fa0d8');
    bg.addColorStop(1, '#3f7ab5');
    ctx.fillStyle = bg;
    roundRectPath(-HELI_W * 0.5, -HELI_H * 0.5, HELI_W * 0.78, HELI_H, 9);
    ctx.fill();
    ctx.strokeStyle = '#2f5c8a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cockpit glass.
    ctx.fillStyle = 'rgba(190,225,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(HELI_W * 0.16, -1, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(HELI_W * 0.13, -3, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Skids.
    ctx.strokeStyle = '#2a4d73';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-HELI_W * 0.34, HELI_H * 0.5 + 5);
    ctx.lineTo(HELI_W * 0.22, HELI_H * 0.5 + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-HELI_W * 0.22, HELI_H * 0.5);
    ctx.lineTo(-HELI_W * 0.22, HELI_H * 0.5 + 5);
    ctx.moveTo(HELI_W * 0.1, HELI_H * 0.5);
    ctx.lineTo(HELI_W * 0.1, HELI_H * 0.5 + 5);
    ctx.stroke();

    // Rotor mast.
    ctx.fillStyle = '#2f5c8a';
    ctx.fillRect(-2, -HELI_H * 0.5 - 5, 4, 6);

    // Main rotor — a blurred disc plus two blade streaks.  A faint ellipse sells
    // the spin; the streaks give a stroboscopic flicker.
    ctx.save();
    ctx.translate(0, -HELI_H * 0.5 - 5);
    const span = HELI_W * 0.95;
    ctx.fillStyle = 'rgba(180,205,235,0.10)';
    ctx.beginPath();
    ctx.ellipse(0, 0, span, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(heli.rotor);
    ctx.strokeStyle = 'rgba(200,222,245,0.85)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-span, 0); ctx.lineTo(span, 0);
    ctx.stroke();
    // second blade, offset, fainter (motion).
    ctx.rotate(0.5);
    ctx.strokeStyle = 'rgba(200,222,245,0.4)';
    ctx.beginPath();
    ctx.moveTo(-span, 0); ctx.lineTo(span, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // -- HUD + overlays ---------------------------------------------------------
  function drawHUD() {
    if (state === STATE.TITLE) return;
    // Distance, big, top-centre.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(10,16,26,0.85)';
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    const txt = score + ' m';
    ctx.strokeText(txt, W / 2, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(txt, W / 2, 12);
    ctx.restore();

    // Best, small, top-right.
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9fb4d4';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('BEST  ' + best + ' m', W - 14, 16);
    ctx.restore();
  }

  function centerText(text, y, size, color, weight) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.font = `${weight || 600} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  function dimScreen(alpha) {
    ctx.fillStyle = `rgba(7, 11, 18, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    dimScreen(0.4);
    centerText('HELICOPTER', H / 2 - 96, 52, '#7fd0ff', 700);
    centerText('Hold to fly up — release to drop.', H / 2 - 50, 18, '#cdd6e4', 400);
    centerText('Thread the cave. Dodge the blocks.', H / 2 - 26, 15, '#9fb4d4', 400);
    if (best > 0) centerText('BEST  ' + best + ' m', H / 2 + 12, 20, '#9fb4d4', 600);
    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE / ENTER / Click', H / 2 + 66, 22, '#7fd0ff', 700);
    ctx.globalAlpha = 1;
  }

  function drawGameOver() {
    dimScreen(0.58);
    centerText('CRASHED', H / 2 - 82, 46, '#ff5d73', 700);
    centerText(score + ' m', H / 2 - 30, 30, '#ffffff', 700);
    const isBest = score >= best && score > 0;
    centerText((isBest ? 'NEW BEST!  ' : 'BEST  ') + best + ' m',
               H / 2 + 8, 20, isBest ? '#ffe17a' : '#9fb4d4', 600);
    if (deadTimer <= 0) {
      const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
      ctx.globalAlpha = a;
      centerText('Press SPACE / ENTER / Click to retry', H / 2 + 64, 19, '#7fd0ff', 700);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — delta-time RAF, dt clamped so a tab-switch can't teleport the
  // chopper across the screen in a single frame.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // clamp ~20fps worst case
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Seed everything BEFORE the first frame so the title screen is fully alive.
  seedCave();
  seedFarRocks();
  requestAnimationFrame(frame);
})();
