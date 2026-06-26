(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + context.  Portrait 480x640 internal resolution.
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 640

  const GROUND_H = 96;            // height of the ground strip at the bottom
  const FLOOR_Y = H - GROUND_H;   // y of the top of the ground (the lethal line)

  // ---------------------------------------------------------------------------
  // Tunables — the "hard but fair" sweet spot.  All in canvas-units / seconds.
  //   GRAVITY pulls the bird down constantly; a FLAP sets velocity to a fixed
  //   upward value (an impulse, not an additive nudge, so the feel is crisp).
  //   The pipe GAP is generous enough to thread but the SPACING + SPEED keep
  //   the pressure on.  Speed creeps up slightly with score for escalation.
  // ---------------------------------------------------------------------------
  const GRAVITY = 1500;       // downward accel (units/s^2)
  const FLAP_VELOCITY = -430; // instantaneous upward velocity on a flap
  const MAX_FALL = 620;       // terminal velocity so dives stay controllable
  const PIPE_GAP = 168;       // vertical opening between top & bottom pipe
  const PIPE_W = 70;          // pipe width
  const PIPE_SPACING = 230;   // horizontal distance between successive pipes
  const BASE_SCROLL = 150;    // starting scroll speed (units/s)
  const MAX_SCROLL = 250;     // speed cap as the run heats up
  const SCROLL_RAMP = 4;      // +units/s of scroll per point scored
  const BIRD_X = 130;         // bird's fixed horizontal position
  const BIRD_R = 14;          // bird collision radius (a touch forgiving)
  const GAP_MARGIN = 70;      // keep gaps away from the very top / ground

  // ---------------------------------------------------------------------------
  // High score (localStorage, guarded so a locked-down file:// can't crash us).
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'flappy_best';
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
  // Audio — WebAudio only, created lazily on the first user gesture, and every
  // call guarded so a missing/blocked AudioContext can NEVER break the game.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // A short tone with an envelope.  `slideTo` lets us bend the pitch.
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
  // Short noise burst (used for the crash) built from a buffer of random samples.
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
      // Low-pass keeps it a "thud" rather than harsh static.
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, now);
      src.connect(lp).connect(g).connect(audioCtx.destination);
      src.start(now);
      src.stop(now + dur);
    } catch (e) { /* ignore */ }
  }
  const sndFlap  = () => tone(520, 0.10, 'square', 0.09, 700);
  const sndScore = () => tone(740, 0.09, 'triangle', 0.11, 980);
  const sndCrash = () => { tone(180, 0.35, 'sawtooth', 0.14, 60); noiseBurst(0.30, 0.30); };

  // ---------------------------------------------------------------------------
  // Game state.  EVERYTHING below is initialised here at load so the title and
  // game-over screens (which also run update + render) never touch undefined.
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, PLAYING: 1, DEAD: 2 };
  let state = STATE.TITLE;

  let score = 0;
  let scroll = BASE_SCROLL;   // current scroll speed
  let scoreXTimer = 0;        // counts down the "score pop" scale animation

  // The bird.  `y` is its centre; `vy` vertical velocity; `rot` the drawn tilt.
  const bird = {
    y: H * 0.42,
    vy: 0,
    rot: 0,
    flapTimer: 0,   // drives the wing-flap animation
  };

  // Pipes scroll right-to-left.  Each: x (left edge), gapY (centre of opening),
  // and `passed` (have we already scored it?).
  let pipes = [];

  const particles = [];   // crash debris + flap puffs
  let shake = 0;          // screen-shake magnitude (decays over time)
  let flash = 0;          // white death-flash alpha (decays over time)
  let deadTimer = 0;      // small delay before restart is accepted (avoids misclicks)

  // Parallax background layers (clouds + hills) — initialised so the title
  // screen already has a living sky behind it.
  const clouds = [];
  const hills = [];
  function seedBackground() {
    clouds.length = 0;
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * W,
        y: 40 + Math.random() * (FLOOR_Y * 0.5),
        s: 0.5 + Math.random() * 0.7,   // size scale
        sp: 8 + Math.random() * 14,     // own drift speed (parallax, slow)
      });
    }
    hills.length = 0;
    for (let i = 0; i < 5; i++) {
      hills.push({
        x: i * 130 + Math.random() * 30,
        h: 70 + Math.random() * 70,     // hill height
      });
    }
  }
  seedBackground();

  // ---------------------------------------------------------------------------
  // Pipe helpers.
  // ---------------------------------------------------------------------------
  function randomGapY() {
    // Keep the opening's centre within a band that never hugs the ceiling/ground.
    const minY = GAP_MARGIN + PIPE_GAP / 2;
    const maxY = FLOOR_Y - GAP_MARGIN - PIPE_GAP / 2;
    return minY + Math.random() * (maxY - minY);
  }

  function spawnPipe(x) {
    pipes.push({ x: x, gapY: randomGapY(), passed: false });
  }

  // Fill the screen (and a bit beyond the right edge) with the starting pipes.
  function seedPipes() {
    pipes = [];
    const firstX = W + 80;   // give the player a beat before the first pipe
    for (let i = 0; i < 4; i++) spawnPipe(firstX + i * PIPE_SPACING);
  }
  seedPipes();   // so the title screen shows pipes drifting too

  // ---------------------------------------------------------------------------
  // Lifecycle.
  // ---------------------------------------------------------------------------
  function startGame() {
    score = 0;
    scroll = BASE_SCROLL;
    bird.y = H * 0.42;
    bird.vy = 0;
    bird.rot = 0;
    bird.flapTimer = 0;
    seedPipes();
    particles.length = 0;
    shake = 0;
    flash = 0;
    scoreXTimer = 0;
    state = STATE.PLAYING;
    flap(); // an immediate flap so the bird doesn't instantly sink on start
  }

  function flap() {
    bird.vy = FLAP_VELOCITY;
    bird.flapTimer = 0.18;
    sndFlap();
    // A couple of little puffs trailing the wing.
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: BIRD_X - 6, y: bird.y + 6,
        vx: -40 - Math.random() * 50,
        vy: 10 + Math.random() * 40,
        life: 0.35, max: 0.35,
        size: 2 + Math.random() * 2,
        color: 'rgba(210,225,245,0.7)',
        grav: 60,
      });
    }
  }

  function die() {
    if (state !== STATE.PLAYING) return;
    state = STATE.DEAD;
    deadTimer = 0.55;
    shake = 16;
    flash = 0.9;
    sndCrash();
    if (score > best) { best = score; saveBest(best); }
    // Burst of debris from the bird.
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      particles.push({
        x: BIRD_X, y: bird.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        life: 0.6 + Math.random() * 0.4, max: 1.0,
        size: 2 + Math.random() * 3,
        color: Math.random() < 0.6 ? '#ffd54a' : '#ff8a3d',
        grav: 520,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Input.  One action — "flap" — serves to start, to flap, and to restart.
  // ---------------------------------------------------------------------------
  function onUserGesture() { initAudio(); }

  function doAction() {
    if (state === STATE.TITLE) {
      startGame();
    } else if (state === STATE.PLAYING) {
      flap();
    } else if (state === STATE.DEAD) {
      if (deadTimer <= 0) startGame();
    }
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'spacebar' || k === 'space' ||
        k === 'arrowup' || k === 'w') {
      e.preventDefault();      // stop Space/↑ from scrolling the page
      onUserGesture();
      doAction();
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onUserGesture();
    doAction();
  });

  // Touch: a tap flaps.  passive:false so preventDefault actually suppresses
  // the synthetic mouse event / page scroll on mobile.
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onUserGesture();
    doAction();
  }, { passive: false });

  // ---------------------------------------------------------------------------
  // Update.
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay transient effects in every state so they finish even after death.
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (scoreXTimer > 0) scoreXTimer = Math.max(0, scoreXTimer - dt);
    if (deadTimer > 0) deadTimer = Math.max(0, deadTimer - dt);
    if (bird.flapTimer > 0) bird.flapTimer = Math.max(0, bird.flapTimer - dt);

    updateBackground(dt);
    updateParticles(dt);

    if (state === STATE.TITLE) {
      // The bird gently bobs on the title screen — alive, not frozen.
      bird.y = H * 0.42 + Math.sin(performance.now() / 380) * 10;
      bird.rot = Math.sin(performance.now() / 380) * 0.12;
      // Keep the title pipes drifting so the scene reads as "in motion".
      driftTitlePipes(dt);
      return;
    }

    if (state === STATE.DEAD) {
      // After death the bird keeps falling until it hits the ground (a nice
      // little ragdoll), but pipes stop and no scoring happens.
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;
      if (bird.y + BIRD_R > FLOOR_Y) { bird.y = FLOOR_Y - BIRD_R; bird.vy = 0; }
      bird.rot = Math.min(bird.rot + dt * 4, Math.PI / 2);
      return;
    }

    // ---- PLAYING ----
    // Bird physics.
    bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
    bird.y += bird.vy * dt;

    // Tilt by velocity: nose up when rising, dive forward when falling.
    const targetRot = Math.max(-0.5, Math.min(Math.PI / 2, bird.vy / 520));
    bird.rot += (targetRot - bird.rot) * Math.min(1, dt * 10);

    // Speed creeps up with score, capped, for gentle escalation.
    scroll = Math.min(MAX_SCROLL, BASE_SCROLL + score * SCROLL_RAMP);

    // Move pipes; score when the bird's x passes a pipe's centre.
    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      p.x -= scroll * dt;
      if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
        p.passed = true;
        score++;
        scoreXTimer = 0.25;           // trigger the score pop
        if (score > best) { best = score; saveBest(best); }
        sndScore();
      }
    }

    // Recycle pipes that have fully scrolled off the left edge, appending a new
    // one a fixed spacing beyond the current right-most pipe.
    while (pipes.length && pipes[0].x + PIPE_W < -10) {
      pipes.shift();
      let maxX = 0;
      for (const p of pipes) if (p.x > maxX) maxX = p.x;
      spawnPipe(maxX + PIPE_SPACING);
    }

    // Collisions.
    if (bird.y - BIRD_R < 0) {           // ceiling
      bird.y = BIRD_R;
      die();
      return;
    }
    if (bird.y + BIRD_R > FLOOR_Y) {     // ground
      bird.y = FLOOR_Y - BIRD_R;
      die();
      return;
    }
    for (const p of pipes) {
      if (hitsPipe(p)) { die(); return; }
    }
  }

  // Circle-vs-pipe test.  A pipe is two rectangles (top & bottom) sharing the
  // gap; the bird only collides if it overlaps the pipe's x-span AND is outside
  // the vertical opening.  We use a circle-rectangle distance check on the
  // nearest gap edge for a fair, slightly rounded feel.
  function hitsPipe(p) {
    const withinX = (BIRD_X + BIRD_R > p.x) && (BIRD_X - BIRD_R < p.x + PIPE_W);
    if (!withinX) return false;
    const gapTop = p.gapY - PIPE_GAP / 2;
    const gapBot = p.gapY + PIPE_GAP / 2;
    // Comfortably inside the opening -> safe.
    if (bird.y - BIRD_R > gapTop && bird.y + BIRD_R < gapBot) return false;
    // Otherwise do a precise circle/rect check against whichever rect we're near.
    const rectY = (bird.y < p.gapY) ? 0 : gapBot;        // top rect starts at 0
    const rectH = (bird.y < p.gapY) ? gapTop : (FLOOR_Y - gapBot);
    return circleRect(BIRD_X, bird.y, BIRD_R, p.x, rectY, PIPE_W, rectH);
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function driftTitlePipes(dt) {
    // Slowly recycle the title-screen pipes so the backdrop stays animated.
    for (const p of pipes) p.x -= (BASE_SCROLL * 0.5) * dt;
    while (pipes.length && pipes[0].x + PIPE_W < -10) {
      pipes.shift();
      let maxX = 0;
      for (const p of pipes) if (p.x > maxX) maxX = p.x;
      spawnPipe(maxX + PIPE_SPACING);
    }
  }

  function updateBackground(dt) {
    // Clouds drift left at their own slow speed (parallax behind the pipes).
    for (const c of clouds) {
      c.x -= c.sp * dt;
      if (c.x < -60) { c.x = W + 60; c.y = 40 + Math.random() * (FLOOR_Y * 0.5); }
    }
    // Hills scroll a touch faster than clouds but slower than pipes.
    const hillSpeed = (state === STATE.PLAYING ? scroll : BASE_SCROLL * 0.5) * 0.25;
    const totalW = hills.length * 130;
    for (const h of hills) {
      h.x -= hillSpeed * dt;
      if (h.x < -130) h.x += totalW;
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

    drawSky();
    drawHills();
    drawClouds();
    drawPipes();
    drawGround();
    drawParticles();

    // Hide the bird only briefly — it persists into DEAD so we see it fall.
    drawBird();

    drawHUD();

    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.DEAD) drawGameOver();

    ctx.restore();

    // Death flash sits on top of everything (and outside the shake transform).
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    g.addColorStop(0, '#1d3350');
    g.addColorStop(0.6, '#274a6e');
    g.addColorStop(1, '#3a6b8f');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, FLOOR_Y + 40);
  }

  function drawClouds() {
    for (const c of clouds) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#cdddee';
      const r = 16 * c.s;
      // A cloud = a few overlapping circles.
      blob(c.x, c.y, r);
      blob(c.x + r * 1.1, c.y + r * 0.2, r * 0.85);
      blob(c.x - r * 1.0, c.y + r * 0.25, r * 0.8);
      blob(c.x + r * 0.2, c.y - r * 0.5, r * 0.7);
      ctx.restore();
    }
  }
  function blob(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHills() {
    ctx.fillStyle = '#2c5466';
    for (const h of hills) {
      const baseY = FLOOR_Y;
      ctx.beginPath();
      ctx.moveTo(h.x - 80, baseY);
      ctx.quadraticCurveTo(h.x, baseY - h.h, h.x + 80, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPipes() {
    for (const p of pipes) {
      const gapTop = p.gapY - PIPE_GAP / 2;
      const gapBot = p.gapY + PIPE_GAP / 2;
      drawPipeRect(p.x, 0, PIPE_W, gapTop, true);                 // top pipe
      drawPipeRect(p.x, gapBot, PIPE_W, FLOOR_Y - gapBot, false); // bottom pipe
    }
  }

  // A single pipe body with a gradient, a darker outline, and a wider "lip"
  // at the gap end (the classic Flappy look).
  function drawPipeRect(x, y, w, h, isTop) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#3fae50');
    g.addColorStop(0.45, '#62d36f');
    g.addColorStop(0.55, '#4cc05c');
    g.addColorStop(1, '#2f8f3f');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#236b30';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Lip at the gap end.
    const lipH = 18, lipOver = 5;
    const lipY = isTop ? (y + h - lipH) : y;
    ctx.fillStyle = g;
    ctx.fillRect(x - lipOver, lipY, w + lipOver * 2, lipH);
    ctx.strokeStyle = '#236b30';
    ctx.strokeRect(x - lipOver + 1, lipY + 1, w + lipOver * 2 - 2, lipH - 2);
    // Glossy highlight stripe.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 6, y, 6, h);
  }

  function drawGround() {
    // Dirt base.
    const g = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    g.addColorStop(0, '#caa86a');
    g.addColorStop(1, '#9c814b');
    ctx.fillStyle = g;
    ctx.fillRect(0, FLOOR_Y, W, GROUND_H);
    // Grass cap.
    ctx.fillStyle = '#5fbf57';
    ctx.fillRect(0, FLOOR_Y, W, 12);
    ctx.fillStyle = '#4aa247';
    ctx.fillRect(0, FLOOR_Y + 12, W, 4);
    // Scrolling diagonal hatch on the dirt to sell the motion.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, FLOOR_Y + 16, W, GROUND_H - 16);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,96,52,0.5)';
    ctx.lineWidth = 6;
    const speed = (state === STATE.PLAYING ? scroll : BASE_SCROLL * 0.5);
    const off = (performance.now() / 1000 * speed) % 40;
    for (let x = -40 - off; x < W + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 30, FLOOR_Y + 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // The bird: a round body drawn at BIRD_X / bird.y, rotated by bird.rot, with
  // an animated wing, an eye, and a little beak.
  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rot);

    // Soft glow.
    ctx.shadowColor = 'rgba(255, 210, 90, 0.6)';
    ctx.shadowBlur = 12;

    // Body.
    const bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R + 2);
    bg.addColorStop(0, '#ffe17a');
    bg.addColorStop(1, '#f3b53a');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Belly highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(-3, 3, BIRD_R * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Wing — angle swings during the flap animation.
    const wingPhase = bird.flapTimer > 0 ? (1 - bird.flapTimer / 0.18) : 1;
    const wingAng = -0.6 + Math.sin(wingPhase * Math.PI) * 1.1;
    ctx.save();
    ctx.translate(-2, 1);
    ctx.rotate(wingAng);
    ctx.fillStyle = '#f0a32c';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d98e1f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Beak.
    ctx.fillStyle = '#ff7a2f';
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 2, -3);
    ctx.lineTo(BIRD_R + 8, 0);
    ctx.lineTo(BIRD_R - 2, 3);
    ctx.closePath();
    ctx.fill();

    // Eye.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5, -5, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16202e';
    ctx.beginPath();
    ctx.arc(6.4, -5, 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // -- HUD + overlays ---------------------------------------------------------
  function drawHUD() {
    if (state === STATE.TITLE) return; // title screen has its own layout
    // Big centred score with a "pop" scale when it just incremented.
    const pop = 1 + (scoreXTimer > 0 ? Math.sin((scoreXTimer / 0.25) * Math.PI) * 0.35 : 0);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(W / 2, 70);
    ctx.scale(pop, pop);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(10,16,26,0.85)';
    ctx.font = '700 52px "Segoe UI", system-ui, sans-serif';
    ctx.strokeText(String(score), 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), 0, 0);
    ctx.restore();

    // Best, small, top-right.
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#cdd6e4';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('BEST  ' + best, W - 14, 14);
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
    dimScreen(0.35);
    centerText('FLAPPY', H / 2 - 120, 56, '#ffe17a', 700);
    centerText('Tap to flap. Thread the pipes.', H / 2 - 70, 17, '#cdd6e4', 400);
    centerText('Don’t hit a pipe, the ground, or the sky.', H / 2 - 44, 15, '#9fb4d4', 400);
    if (best > 0) centerText('BEST  ' + best, H / 2 + 8, 20, '#9fb4d4', 600);
    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE / ↑ / Click', H / 2 + 70, 22, '#62d36f', 700);
    ctx.globalAlpha = 1;
  }

  function drawGameOver() {
    dimScreen(0.55);
    centerText('GAME OVER', H / 2 - 90, 46, '#ff5d73', 700);
    centerText('SCORE  ' + score, H / 2 - 34, 26, '#ffffff', 700);
    const isBest = score >= best && score > 0;
    centerText((isBest ? 'NEW BEST!  ' : 'BEST  ') + best,
               H / 2 + 4, 20, isBest ? '#ffe17a' : '#9fb4d4', 600);
    // Prompt fades in only once the brief restart lock-out has elapsed.
    if (deadTimer <= 0) {
      const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
      ctx.globalAlpha = a;
      centerText('Press SPACE / ↑ / Click to retry', H / 2 + 64, 20, '#62d36f', 700);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — delta-time RAF, dt clamped so a tab-switch can't teleport the
  // bird across the screen in a single frame.
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
  requestAnimationFrame(frame);
})();
