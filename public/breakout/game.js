(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + context
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 800 internal resolution
  const H = canvas.height;  // 600

  // ---------------------------------------------------------------------------
  // High score (localStorage, wrapped so a locked-down file:// can't crash us)
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'breakout_best';
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
  // call is guarded so a missing/blocked AudioContext can NEVER break the game.
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
  // Distinct pitches give each event its own character.
  const sndPaddle = () => blip(420, 0.06, 'square', 0.10);
  const sndWall   = () => blip(260, 0.05, 'square', 0.07);
  const sndBrick  = (row) => blip(540 + row * 60, 0.06, 'square', 0.10);
  const sndLose   = () => blip(120, 0.30, 'sawtooth', 0.14);
  const sndLevel  = () => { blip(523, 0.10, 'triangle', 0.12); setTimeout(() => blip(784, 0.14, 'triangle', 0.12), 110); };

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, READY: 1, PLAYING: 2, LEVELUP: 3, GAMEOVER: 4, PAUSED: 5 };
  let state = STATE.TITLE;

  let score = 0;
  let lives = 3;
  let level = 1;

  // Paddle
  const paddle = {
    w: 110,
    h: 14,
    x: (W - 110) / 2,
    y: H - 44,
    speed: 620, // px/sec for keyboard control
  };

  // Ball
  const BALL_R = 8;
  const ball = {
    x: W / 2,
    y: paddle.y - BALL_R,
    vx: 0,
    vy: 0,
    speed: 320,   // current scalar speed (px/sec)
    stuck: true,  // resting on the paddle, awaiting launch
  };
  const BASE_SPEED = 320;
  const MAX_SPEED = 720;

  // Bricks
  const COLS = 11;
  const BRICK_TOP = 70;
  const BRICK_LEFT = 40;
  const BRICK_GAP = 6;
  const BRICK_H = 24;
  const BRICK_W = (W - BRICK_LEFT * 2 - BRICK_GAP * (COLS - 1)) / COLS;
  // Row colours (top = warmest/most valuable -> bottom).
  const ROW_COLORS = ['#ff5d73', '#ff9f43', '#ffd93d', '#6bd968', '#54d6ff', '#7c8cff'];
  let bricks = [];
  let bricksLeft = 0;

  // Particles + ball trail + screen shake
  const particles = [];
  const trail = [];
  let shake = 0;
  let levelBannerT = 0; // countdown timer for the "Level N" banner

  // ---------------------------------------------------------------------------
  // Brick grid generation. Rows increase by one each level (capped), and the
  // ball gets a touch faster every level.
  // ---------------------------------------------------------------------------
  function buildLevel() {
    bricks = [];
    const rows = Math.min(3 + level, ROW_COLORS.length); // 4 rows on lvl1 ... up to 6
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        bricks.push({
          x: BRICK_LEFT + c * (BRICK_W + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          w: BRICK_W,
          h: BRICK_H,
          row: r,
          color: ROW_COLORS[r % ROW_COLORS.length],
          alive: true,
          // Higher rows (smaller r) are worth more points.
          points: (rows - r) * 10,
        });
      }
    }
    bricksLeft = bricks.length;
    // Ball base speed ramps gently with level.
    ball.speed = Math.min(BASE_SPEED + (level - 1) * 28, MAX_SPEED);
  }

  function resetBall() {
    ball.stuck = true;
    ball.vx = 0;
    ball.vy = 0;
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - BALL_R - 1;
    trail.length = 0;
  }

  function launchBall() {
    if (!ball.stuck) return;
    ball.stuck = false;
    // Launch upward with a slight random horizontal lean.
    const angle = (-Math.PI / 2) + (Math.random() * 0.5 - 0.25);
    ball.vx = Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    sndPaddle();
  }

  function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    paddle.x = (W - paddle.w) / 2;
    buildLevel();
    resetBall();
    particles.length = 0;
    shake = 0;
    state = STATE.READY;
  }

  function nextLevel() {
    level++;
    buildLevel();
    paddle.x = (W - paddle.w) / 2;
    resetBall();
    levelBannerT = 1.6;
    state = STATE.LEVELUP;
    sndLevel();
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------
  function spawnParticles(x, y, color) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.35,
        max: 0.85,
        color,
        size: 2 + Math.random() * 2.5,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const keys = { left: false, right: false };
  let mouseX = null; // null until the mouse moves over the canvas

  function onUserGesture() {
    initAudio();
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { keys.left = true; e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { keys.right = true; e.preventDefault(); }
    else if (k === ' ' || k === 'spacebar' || k === 'space') {
      e.preventDefault();
      onUserGesture();
      handleAction();
    } else if (k === 'p') {
      if (state === STATE.PLAYING) state = STATE.PAUSED;
      else if (state === STATE.PAUSED) state = STATE.PLAYING;
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    else if (k === 'arrowright' || k === 'd') keys.right = false;
  });

  // Map a clientX onto the canvas's internal 800px coordinate space.
  function pointerToCanvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener('mousemove', (e) => {
    mouseX = pointerToCanvasX(e.clientX);
  });

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onUserGesture();
    mouseX = pointerToCanvasX(e.clientX);
    handleAction();
  });

  // Touch support: move + launch.
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onUserGesture();
    if (e.touches[0]) mouseX = pointerToCanvasX(e.touches[0].clientX);
    handleAction();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches[0]) mouseX = pointerToCanvasX(e.touches[0].clientX);
  }, { passive: false });

  // One entry point for "Space / click / tap" depending on the current screen.
  function handleAction() {
    if (state === STATE.TITLE) {
      startGame();
    } else if (state === STATE.READY) {
      launchBall();
      state = STATE.PLAYING;
    } else if (state === STATE.PLAYING) {
      launchBall();
    } else if (state === STATE.GAMEOVER) {
      startGame();
    } else if (state === STATE.LEVELUP) {
      // skip the banner early
      levelBannerT = 0;
      state = STATE.READY;
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay screen shake regardless of state.
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    if (state === STATE.LEVELUP) {
      levelBannerT -= dt;
      if (levelBannerT <= 0) state = STATE.READY;
    }

    // Paddle movement is allowed while ready or playing (feels responsive).
    if (state === STATE.PLAYING || state === STATE.READY) {
      updatePaddle(dt);
    }

    // Ball physics only while actively playing.
    if (state === STATE.PLAYING || state === STATE.READY) {
      if (ball.stuck) {
        // Glue the ball to the paddle until launch.
        ball.x = paddle.x + paddle.w / 2;
        ball.y = paddle.y - BALL_R - 1;
      } else {
        updateBall(dt);
      }
    }

    updateParticles(dt);
  }

  function updatePaddle(dt) {
    // Mouse takes priority when it has moved; otherwise keyboard.
    if (mouseX !== null) {
      paddle.x = mouseX - paddle.w / 2;
    }
    if (keys.left) paddle.x -= paddle.speed * dt;
    if (keys.right) paddle.x += paddle.speed * dt;
    // If a key is pressed, drop mouse priority so keys feel authoritative.
    if (keys.left || keys.right) mouseX = paddle.x + paddle.w / 2;

    // Clamp to the playfield.
    if (paddle.x < 0) paddle.x = 0;
    if (paddle.x + paddle.w > W) paddle.x = W - paddle.w;
  }

  function updateBall(dt) {
    // Gradually speed the ball up the longer a rally lasts, capped.
    ball.speed = Math.min(ball.speed + 6 * dt, MAX_SPEED);

    // Normalise velocity to the current scalar speed (keeps angle, fixes drift).
    const mag = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / mag) * ball.speed;
    ball.vy = (ball.vy / mag) * ball.speed;

    // Sub-step the motion so a fast ball can't tunnel through bricks/walls.
    const steps = Math.max(1, Math.ceil((ball.speed * dt) / (BALL_R)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // --- Wall collisions ---
      if (ball.x - BALL_R < 0) {
        ball.x = BALL_R;
        ball.vx = Math.abs(ball.vx);
        sndWall();
      } else if (ball.x + BALL_R > W) {
        ball.x = W - BALL_R;
        ball.vx = -Math.abs(ball.vx);
        sndWall();
      }
      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
        sndWall();
      }

      // --- Paddle collision ---
      // Only when moving downward and overlapping the paddle's rectangle.
      if (ball.vy > 0 &&
          ball.y + BALL_R >= paddle.y &&
          ball.y - BALL_R <= paddle.y + paddle.h &&
          ball.x + BALL_R >= paddle.x &&
          ball.x - BALL_R <= paddle.x + paddle.w) {
        // Where did it hit? -1 (left edge) .. 0 (center) .. +1 (right edge).
        const hit = ((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2));
        const clamped = Math.max(-1, Math.min(1, hit));
        // Map that offset to a bounce angle. Center -> straight up (~ -90deg),
        // edges -> up to ~60deg from vertical. This is the classic Breakout feel.
        const maxAngle = (Math.PI / 3); // 60 degrees
        const angle = clamped * maxAngle;          // angle from vertical
        const dir = -Math.cos(angle);              // always upward (negative y)
        ball.vx = ball.speed * Math.sin(angle);
        ball.vy = ball.speed * dir;
        ball.y = paddle.y - BALL_R - 0.1;          // lift out of the paddle
        sndPaddle();
      }

      // --- Brick collisions (AABB) ---
      checkBrickCollisions();

      // --- Fell below the paddle -> lose a life ---
      if (ball.y - BALL_R > H) {
        loseLife();
        return;
      }
    }
  }

  // Axis-Aligned Bounding-Box collision between the ball (treated as a box for
  // the overlap test) and each brick. On hit we compare horizontal vs vertical
  // penetration depth to decide which axis to reflect — the smaller overlap is
  // the side the ball actually entered from.
  function checkBrickCollisions() {
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;

      // Quick AABB overlap test (ball expanded by its radius).
      if (ball.x + BALL_R < b.x ||
          ball.x - BALL_R > b.x + b.w ||
          ball.y + BALL_R < b.y ||
          ball.y - BALL_R > b.y + b.h) {
        continue;
      }

      // Overlap depths on each axis.
      const overlapLeft = (ball.x + BALL_R) - b.x;          // pushing right into brick
      const overlapRight = (b.x + b.w) - (ball.x - BALL_R); // pushing left into brick
      const overlapTop = (ball.y + BALL_R) - b.y;           // pushing down into brick
      const overlapBottom = (b.y + b.h) - (ball.y - BALL_R);// pushing up into brick

      const minX = Math.min(overlapLeft, overlapRight);
      const minY = Math.min(overlapTop, overlapBottom);

      if (minX < minY) {
        // Hit a vertical face -> flip horizontal velocity.
        ball.vx = -ball.vx;
        if (overlapLeft < overlapRight) ball.x = b.x - BALL_R;
        else ball.x = b.x + b.w + BALL_R;
      } else {
        // Hit a horizontal face -> flip vertical velocity.
        ball.vy = -ball.vy;
        if (overlapTop < overlapBottom) ball.y = b.y - BALL_R;
        else ball.y = b.y + b.h + BALL_R;
      }

      // Destroy the brick.
      b.alive = false;
      bricksLeft--;
      score += b.points;
      if (score > best) { best = score; saveBest(best); }
      spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color);
      sndBrick(b.row);

      if (bricksLeft <= 0) {
        nextLevel();
      }
      // One brick per sub-step keeps the bounce believable.
      break;
    }
  }

  function loseLife() {
    lives--;
    shake = 14;
    sndLose();
    if (lives <= 0) {
      if (score > best) { best = score; saveBest(best); }
      if (window.Arcade) Arcade.submitScore('breakout', score); // leaderboard: final points
      state = STATE.GAMEOVER;
    } else {
      resetBall();
      state = STATE.READY;
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt; // gravity
      p.vx *= 0.99;
    }
    // Ball trail samples.
    if (state === STATE.PLAYING && !ball.stuck) {
      trail.push({ x: ball.x, y: ball.y, life: 0.25 });
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].life -= dt;
      if (trail[i].life <= 0) trail.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function draw() {
    ctx.save();

    // Screen shake offset.
    if (shake > 0) {
      const s = shake;
      ctx.translate((Math.random() * 2 - 1) * s * 0.4, (Math.random() * 2 - 1) * s * 0.4);
    }

    // Background.
    drawBackground();

    // Bricks.
    for (const b of bricks) {
      if (!b.alive) continue;
      drawBrick(b);
    }

    // Ball trail.
    for (const t of trail) {
      const a = (t.life / 0.25) * 0.4;
      ctx.beginPath();
      ctx.fillStyle = `rgba(120, 220, 255, ${a})`;
      ctx.arc(t.x, t.y, BALL_R * (0.5 + t.life), 0, Math.PI * 2);
      ctx.fill();
    }

    // Particles.
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Paddle + ball (hide ball entirely only on title/gameover).
    drawPaddle();
    if (state !== STATE.TITLE && state !== STATE.GAMEOVER) drawBall();

    // HUD.
    drawHUD();

    // Overlays per state.
    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.READY) drawReadyHint();
    else if (state === STATE.PAUSED) drawPaused();
    else if (state === STATE.GAMEOVER) drawGameOver();

    // Level banner draws on top of play.
    if (state === STATE.LEVELUP || levelBannerT > 0) drawLevelBanner();

    ctx.restore();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c1220');
    g.addColorStop(1, '#05070b');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Subtle vignette border to frame the playfield.
    ctx.strokeStyle = 'rgba(84, 214, 255, 0.10)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  function drawBrick(b) {
    ctx.fillStyle = b.color;
    roundRect(b.x, b.y, b.w, b.h, 4);
    ctx.fill();
    // Top glossy highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(b.x + 2, b.y + 2, b.w - 4, (b.h - 4) * 0.4, 3);
    ctx.fill();
  }

  function drawPaddle() {
    // Glow.
    ctx.save();
    ctx.shadowColor = 'rgba(84, 214, 255, 0.8)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#54d6ff';
    roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.fill();
    ctx.restore();
    // Inner gradient strip.
    const g = ctx.createLinearGradient(0, paddle.y, 0, paddle.y + paddle.h);
    g.addColorStop(0, '#bff0ff');
    g.addColorStop(1, '#2aa7d6');
    ctx.fillStyle = g;
    roundRect(paddle.x + 2, paddle.y + 2, paddle.w - 4, paddle.h - 4, 5);
    ctx.fill();
  }

  function drawBall() {
    ctx.save();
    ctx.shadowColor = 'rgba(150, 230, 255, 0.9)';
    ctx.shadowBlur = 14;
    const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, BALL_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#7fdcff');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillText('SCORE  ' + score, 16, 14);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('BEST  ' + best, W / 2, 14);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cdd6e4';
    ctx.fillText('LEVEL ' + level, W - 16, 14);

    // Lives as little ball icons under the score.
    ctx.textAlign = 'left';
    for (let i = 0; i < lives; i++) {
      ctx.beginPath();
      ctx.fillStyle = '#54d6ff';
      ctx.arc(24 + i * 22, 46, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Shared overlay helpers ----------------------------------------------------
  function dimScreen(alpha) {
    ctx.fillStyle = `rgba(5, 7, 11, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
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

  function drawTitle() {
    dimScreen(0.55);
    centerText('BREAKOUT', H / 2 - 90, 56, '#9fb4d4', 700);
    centerText('Clear every brick to advance', H / 2 - 38, 18, '#cdd6e4', 400);
    centerText('Move:  Mouse   or   ← → / A D', H / 2 + 6, 18, '#cdd6e4', 400);
    centerText('Launch:  Space   or   Click', H / 2 + 36, 18, '#cdd6e4', 400);
    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE to start', H / 2 + 92, 22, '#54d6ff', 700);
    ctx.globalAlpha = 1;
  }

  function drawReadyHint() {
    const a = 0.5 + 0.5 * Math.sin(performance.now() / 320);
    ctx.globalAlpha = a;
    centerText('Press SPACE or Click to launch', paddle.y - 70, 18, '#9fb4d4', 600);
    ctx.globalAlpha = 1;
  }

  function drawPaused() {
    dimScreen(0.5);
    centerText('PAUSED', H / 2 - 10, 48, '#9fb4d4', 700);
    centerText('Press P to resume', H / 2 + 38, 18, '#cdd6e4', 400);
  }

  function drawGameOver() {
    dimScreen(0.6);
    centerText('GAME OVER', H / 2 - 70, 52, '#ff5d73', 700);
    centerText('Score  ' + score, H / 2 - 14, 24, '#cdd6e4', 600);
    centerText('Best  ' + best, H / 2 + 18, 20, '#9fb4d4', 500);
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE to play again', H / 2 + 78, 22, '#54d6ff', 700);
    ctx.globalAlpha = 1;
  }

  function drawLevelBanner() {
    // Fade in/out over its lifetime.
    const t = Math.max(0, levelBannerT);
    const a = Math.min(1, t * 2) * Math.min(1, (1.6 - t) * 3 + 0.2);
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    centerText('LEVEL ' + level, H / 2, 60, '#ffd93d', 700);
    ctx.globalAlpha = 1;
  }

  // Rounded-rectangle path helper (fills/strokes are applied by the caller).
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Main loop — delta-time with requestAnimationFrame. dt is clamped so a tab
  // switch (huge gap) can't fling the ball across the screen in one frame.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp ~20fps worst case
    if (state !== STATE.PAUSED) update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
