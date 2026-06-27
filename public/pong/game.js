(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + context. Internal resolution is fixed at 800x500; the CSS scales
  // the element, but all game maths happen in this 800x500 space.
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 800
  const H = canvas.height;  // 500

  // ---------------------------------------------------------------------------
  // Audio — WebAudio only, created lazily on the FIRST user gesture, and every
  // call is wrapped in try/catch so a blocked/missing AudioContext can NEVER
  // break the game.
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
      g.gain.exponentialRampToValueAtTime(gain || 0.12, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.08));
      osc.connect(g).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (dur || 0.08) + 0.02);
    } catch (e) { /* ignore */ }
  }
  // Distinct blips so wall, paddle and score each have their own character.
  const sndPaddle = () => blip(440, 0.05, 'square', 0.10);
  const sndWall   = () => blip(240, 0.045, 'square', 0.07);
  const sndScore  = () => { blip(180, 0.18, 'sawtooth', 0.12); setTimeout(() => blip(120, 0.22, 'sawtooth', 0.10), 90); };
  const sndWin    = () => { blip(523, 0.10, 'triangle', 0.12); setTimeout(() => blip(659, 0.10, 'triangle', 0.12), 110); setTimeout(() => blip(784, 0.16, 'triangle', 0.12), 220); };

  // ---------------------------------------------------------------------------
  // Game state machine.
  //   TITLE    — choose 1P or 2P
  //   SERVE    — ball parked, waiting for Space to serve toward the scored-on side
  //   PLAYING  — ball is live
  //   WIN      — someone reached the target score
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, SERVE: 1, PLAYING: 2, WIN: 3 };
  let state = STATE.TITLE;

  const WIN_SCORE = 11;     // first to 11 wins
  let mode = 1;             // 1 = vs CPU, 2 = two-player (default highlighted on title)

  // ---------------------------------------------------------------------------
  // CPU difficulty. FOUR tiers; default MEDIUM. "Unbeatable" is the original
  // tracking AI, untouched. The weaker tiers are produced by capping paddle
  // speed, widening the aim error (offset + jitter), and reacting late (only
  // chasing once the ball is heading this way and/or past mid-court).
  //   speedScale  — multiplies the original ramped CPU speed (1 = full).
  //   errorScale  — multiplies the original ramped aim-error amplitude.
  //   jitter      — extra px of random wobble added to every re-aim.
  //   reactX      — fraction of the field the ball must cross toward the CPU
  //                 before it starts truly chasing (0 = react immediately like
  //                 the original; 0.5 = only once the ball passes mid-court).
  // ---------------------------------------------------------------------------
  const DIFFICULTIES = [
    { key: 'EASY',       label: 'EASY',       speedScale: 0.55, errorScale: 2.0, jitter: 60, reactX: 0.62 },
    { key: 'MEDIUM',     label: 'MEDIUM',     speedScale: 0.78, errorScale: 1.4, jitter: 26, reactX: 0.30 },
    { key: 'HARD',       label: 'HARD',       speedScale: 0.95, errorScale: 0.7, jitter: 8,  reactX: 0.10 },
    { key: 'UNBEATABLE', label: 'UNBEATABLE', speedScale: 1.0,  errorScale: 1.0, jitter: 0,  reactX: 0.0  },
  ];
  let difficulty = 1;       // index into DIFFICULTIES; 1 = MEDIUM (default)

  // Scores.
  let scoreL = 0;
  let scoreR = 0;
  let winner = 0;           // 1 = left, 2 = right

  // ---------------------------------------------------------------------------
  // Paddles. Left is the human in both modes; right is human (2P) or CPU (1P).
  // ---------------------------------------------------------------------------
  const PADDLE_W = 14;
  const PADDLE_H = 86;
  const PADDLE_MARGIN = 26;       // distance of paddle face from each side wall
  const PADDLE_SPEED = 560;       // px/sec for human paddles

  const left = {
    x: PADDLE_MARGIN,
    y: (H - PADDLE_H) / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    vy: 0,                        // tracked so we can impart a little "english"
  };
  const right = {
    x: W - PADDLE_MARGIN - PADDLE_W,
    y: (H - PADDLE_H) / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    vy: 0,
  };

  // ---------------------------------------------------------------------------
  // Ball. speed is the current scalar magnitude; it ramps up on each paddle hit
  // and resets on serve.
  // ---------------------------------------------------------------------------
  const BALL_R = 8;
  const BASE_SPEED = 360;
  const MAX_SPEED = 760;
  const SPEEDUP = 26;             // added to scalar speed on every paddle hit
  const MAX_BOUNCE = Math.PI / 3.4; // ~53deg — steepest deflection at paddle edge

  const ball = {
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    speed: BASE_SPEED,
  };
  let serveDir = 1;               // +1 serve toward right, -1 toward left

  // Juice: ball trail, score-flash and a touch of screen shake.
  const trail = [];               // recent ball positions
  let shake = 0;
  let flashL = 0;                 // brief glow on a paddle when it just hit the ball
  let flashR = 0;
  let scoreFlash = 0;             // whole-screen flash timer when a point lands

  // CPU tuning — gets sharper as the rally's ball speed climbs, so early points
  // are forgiving but later rallies are genuinely tough.
  const CPU_BASE_SPEED = 360;     // px/sec the CPU paddle can move early on
  const CPU_MAX_SPEED = 600;      // cap once the ball is flying
  let cpuTargetY = H / 2;         // CPU's intended paddle center (with imperfection)
  let cpuReactT = 0;              // countdown; CPU re-aims when it hits zero

  // ---------------------------------------------------------------------------
  // Input. Track held keys for smooth paddle motion; Space/click drives the
  // single "action" entry point per screen.
  // ---------------------------------------------------------------------------
  const keys = { w: false, s: false, up: false, down: false };

  function onUserGesture() { initAudio(); }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') { keys.w = true; e.preventDefault(); }
    else if (k === 's') { keys.s = true; e.preventDefault(); }
    else if (k === 'arrowup') { keys.up = true; e.preventDefault(); }
    else if (k === 'arrowdown') { keys.down = true; e.preventDefault(); }
    else if (k === '1' || k === '2' || k === '3' || k === '4') {
      onUserGesture();
      // On the title, number keys configure the upcoming match:
      //   1/2 also pick the mode (preserved), and 1-4 pick the CPU difficulty.
      if (k === '1') chooseMode(1);
      else if (k === '2') chooseMode(2);
      chooseDifficulty(parseInt(k, 10) - 1);
    }
    else if (k === ' ' || k === 'spacebar' || k === 'space' || k === 'enter') {
      e.preventDefault();
      onUserGesture();
      handleAction();
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = false;
    else if (k === 's') keys.s = false;
    else if (k === 'arrowup') keys.up = false;
    else if (k === 'arrowdown') keys.down = false;
  });

  // Map a pointer event to internal 800x500 canvas coordinates (the element is
  // CSS-scaled, so we rescale from the bounding box).
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    const cx = src.clientX, cy = src.clientY;
    return {
      x: (cx - r.left) * (W / r.width),
      y: (cy - r.top) * (H / r.height),
    };
  }

  // On-canvas hit zones for the title screen (rebuilt every title render so the
  // click targets always match what's drawn). Each = {x,y,w,h, kind, value}.
  let titleZones = [];

  // A pointer down on the title may select a mode/difficulty option; anywhere
  // else (or on any other screen) it behaves like Space (start / serve / restart).
  function handlePointer(e) {
    e.preventDefault();
    onUserGesture();
    if (state === STATE.TITLE) {
      const p = pointerPos(e);
      for (const z of titleZones) {
        if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
          if (z.kind === 'mode') chooseMode(z.value);
          else if (z.kind === 'diff') chooseDifficulty(z.value);
          return; // consumed by an option; don't also start the match
        }
      }
    }
    handleAction();
  }

  canvas.addEventListener('mousedown', handlePointer);
  canvas.addEventListener('touchstart', handlePointer, { passive: false });

  // Pick a mode from the title screen. Selection only — the player still presses
  // Space / clicks Start to begin, so difficulty can be adjusted first.
  function chooseMode(m) {
    if (state !== STATE.TITLE) return;
    mode = m;
  }

  // Pick a CPU difficulty tier from the title screen (index into DIFFICULTIES).
  function chooseDifficulty(d) {
    if (state !== STATE.TITLE) return;
    if (d >= 0 && d < DIFFICULTIES.length) difficulty = d;
  }

  // One action entry point, behaviour depends on the current screen.
  function handleAction() {
    if (state === STATE.TITLE) {
      // Space on the title starts with the currently highlighted mode.
      startMatch();
    } else if (state === STATE.SERVE) {
      serve();
    } else if (state === STATE.WIN) {
      // Back to the title so the player can re-pick a mode.
      state = STATE.TITLE;
    }
    // During PLAYING, Space does nothing (ball is already live).
  }

  // ---------------------------------------------------------------------------
  // Match / round lifecycle.
  // ---------------------------------------------------------------------------
  function startMatch() {
    scoreL = 0;
    scoreR = 0;
    winner = 0;
    left.y = (H - PADDLE_H) / 2;
    right.y = (H - PADDLE_H) / 2;
    left.vy = 0;
    right.vy = 0;
    trail.length = 0;
    shake = 0;
    flashL = flashR = 0;
    scoreFlash = 0;
    // First serve goes to a random side so games don't always open the same way.
    serveDir = Math.random() < 0.5 ? -1 : 1;
    parkBallForServe();
    state = STATE.SERVE;
  }

  // Park the ball against the side that's about to serve (the scored-on side),
  // ready to launch toward the opponent when Space is pressed.
  function parkBallForServe() {
    ball.speed = BASE_SPEED;
    ball.vx = 0;
    ball.vy = 0;
    ball.y = H / 2;
    // Sit just in front of the serving paddle.
    if (serveDir > 0) ball.x = left.x + left.w + BALL_R + 6;     // serve to the right
    else ball.x = right.x - BALL_R - 6;                          // serve to the left
    trail.length = 0;
  }

  // Launch the parked ball toward serveDir with a mild random vertical angle.
  function serve() {
    const angle = (Math.random() * 0.6 - 0.3); // -0.3..0.3 rad off horizontal
    ball.speed = BASE_SPEED;
    ball.vx = Math.cos(angle) * ball.speed * serveDir;
    ball.vy = Math.sin(angle) * ball.speed;
    // Aim the CPU's first reaction.
    cpuReactT = 0;
    cpuTargetY = ball.y;
    state = STATE.PLAYING;
    sndPaddle();
  }

  // A point lands. Credit the scorer, then either end the match or set up the
  // next serve toward whoever was just scored on (classic Pong).
  function pointFor(side) {
    if (side === 1) scoreL++; else scoreR++;
    scoreFlash = 0.35;
    shake = Math.max(shake, 10);
    sndScore();

    if (scoreL >= WIN_SCORE || scoreR >= WIN_SCORE) {
      winner = scoreL > scoreR ? 1 : 2;
      state = STATE.WIN;
      sndWin();
      return;
    }
    // Serve toward the player who was just scored on. If LEFT scored (side 1),
    // the ball got past the RIGHT player, so the next serve heads right (+1).
    // If RIGHT scored (side 2), it got past the LEFT player, so serve left (-1).
    serveDir = (side === 1) ? 1 : -1;
    parkBallForServe();
    state = STATE.SERVE;
  }

  // ---------------------------------------------------------------------------
  // Update.
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay juice timers everywhere so they're always valid to read.
    if (shake > 0) shake = Math.max(0, shake - dt * 50);
    if (flashL > 0) flashL = Math.max(0, flashL - dt);
    if (flashR > 0) flashR = Math.max(0, flashR - dt);
    if (scoreFlash > 0) scoreFlash = Math.max(0, scoreFlash - dt);

    if (state === STATE.PLAYING || state === STATE.SERVE) {
      updatePaddles(dt);
    }
    if (state === STATE.PLAYING) {
      updateBall(dt);
    } else if (state === STATE.SERVE) {
      // Keep the parked ball glued to the serving paddle's face & height.
      if (serveDir > 0) { ball.x = left.x + left.w + BALL_R + 6; ball.y = clamp(left.y + left.h / 2, BALL_R, H - BALL_R); }
      else { ball.x = right.x - BALL_R - 6; ball.y = clamp(right.y + right.h / 2, BALL_R, H - BALL_R); }
    }

    updateTrail(dt);
  }

  function updatePaddles(dt) {
    // Left paddle is always human (W/S).
    let lvy = 0;
    if (keys.w) lvy -= PADDLE_SPEED;
    if (keys.s) lvy += PADDLE_SPEED;
    movePaddle(left, lvy, dt);

    // Right paddle: human in 2P, CPU in 1P.
    if (mode === 2) {
      let rvy = 0;
      if (keys.up) rvy -= PADDLE_SPEED;
      if (keys.down) rvy += PADDLE_SPEED;
      movePaddle(right, rvy, dt);
    } else {
      updateCPU(dt);
    }
  }

  // Move a paddle by velocity, clamp to the field, and record its actual vy so
  // a moving paddle can add a little spin to the ball on contact.
  function movePaddle(p, vy, dt) {
    const prevY = p.y;
    p.y += vy * dt;
    p.y = clamp(p.y, 0, H - p.h);
    p.vy = (p.y - prevY) / Math.max(dt, 1e-4);
  }

  // CPU paddle. It tracks the ball but only when the ball is heading its way,
  // re-aims on a short reaction timer with a deliberate aim error, and is capped
  // in speed. The cap and accuracy scale up with ball speed, so early rallies
  // are beatable while later ones get fierce.
  //
  // The "UNBEATABLE" tier runs this logic verbatim (its modifiers are all
  // identity: speedScale 1, errorScale 1, jitter 0, reactX 0). Easier tiers
  // weaken the paddle via three dials pulled from the active DIFFICULTIES entry:
  // a slower max speed, a wider aim error, and reacting late (the ball must
  // cross some fraction of the field toward the CPU before it truly chases).
  function updateCPU(dt) {
    const prevY = right.y;
    const D = DIFFICULTIES[difficulty];

    // How fast/sharp is the CPU right now? Ramp from base->max across the ball's
    // speed range, so a fresh serve is gentle and a long rally is brutal.
    const t = clamp((ball.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
    const cpuSpeed = (CPU_BASE_SPEED + (CPU_MAX_SPEED - CPU_BASE_SPEED) * t) * D.speedScale;
    // Aim error shrinks as the rally heats up (less wobble when fast).
    const errorAmp = ((1 - t) * 46 + 8) * D.errorScale + D.jitter; // ~54px early, ~8px late (UNBEATABLE)

    // Reaction lateness: how far the ball has travelled toward the CPU, 0..1.
    // For UNBEATABLE (reactX 0) this is always "engaged" so behaviour is identical.
    const incomingProgress = clamp(ball.x / W, 0, 1); // 0 at left wall, 1 at right (CPU) wall
    const engaged = incomingProgress >= D.reactX;

    cpuReactT -= dt;
    if (ball.vx > 0 && engaged) {
      // Ball incoming AND past the reaction threshold: periodically re-pick a
      // target with a random offset (bigger on easier tiers).
      if (cpuReactT <= 0) {
        cpuReactT = 0.07 + Math.random() * 0.09; // re-aim every ~70-160ms
        // Predict roughly where the ball is going, then add human-like error.
        cpuTargetY = ball.y + (Math.random() * 2 - 1) * errorAmp;
      }
    } else {
      // Ball moving away (or not yet engaged): drift lazily back toward center,
      // re-aiming slowly. This also produces the "reacts late" feel on easy tiers.
      if (cpuReactT <= 0) {
        cpuReactT = 0.25 + Math.random() * 0.2;
        cpuTargetY = H / 2 + (Math.random() * 2 - 1) * 30;
      }
    }

    const center = right.y + right.h / 2;
    const diff = cpuTargetY - center;
    const dead = 6; // don't jitter when essentially aligned
    let vy = 0;
    if (diff > dead) vy = cpuSpeed;
    else if (diff < -dead) vy = -cpuSpeed;
    // Don't overshoot the target in a single frame.
    const maxStep = Math.abs(diff);
    const step = clamp(vy * dt, -maxStep, maxStep);
    right.y = clamp(right.y + step, 0, H - right.h);
    right.vy = (right.y - prevY) / Math.max(dt, 1e-4);
  }

  function updateBall(dt) {
    // Sub-step so a fast ball can't tunnel through a thin paddle or the walls.
    const dist = ball.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / (BALL_R * 0.9)));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // --- Top / bottom walls ---
      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
        sndWall();
      } else if (ball.y + BALL_R > H) {
        ball.y = H - BALL_R;
        ball.vy = -Math.abs(ball.vy);
        sndWall();
      }

      // --- Left paddle (only while moving left toward it) ---
      if (ball.vx < 0 &&
          ball.x - BALL_R <= left.x + left.w &&
          ball.x - BALL_R >= left.x - 4 &&        // small grace so we don't miss fast frames
          ball.y >= left.y &&
          ball.y <= left.y + left.h) {
        bounceOffPaddle(left, +1);
        ball.x = left.x + left.w + BALL_R;        // lift clear of the paddle
      }
      // --- Right paddle (only while moving right toward it) ---
      else if (ball.vx > 0 &&
          ball.x + BALL_R >= right.x &&
          ball.x + BALL_R <= right.x + right.w + 4 &&
          ball.y >= right.y &&
          ball.y <= right.y + right.h) {
        bounceOffPaddle(right, -1);
        ball.x = right.x - BALL_R;
      }

      // --- Off the left/right edge = a point for the opposite side ---
      if (ball.x + BALL_R < 0) { pointFor(2); return; }   // passed left paddle -> right scores
      if (ball.x - BALL_R > W) { pointFor(1); return; }   // passed right paddle -> left scores
    }
  }

  // Reflect the ball off a paddle. The bounce ANGLE depends on where it hit:
  // dead-center => nearly flat, top/bottom edge => steep. dirX is +1 for the
  // left paddle (send right) or -1 for the right paddle (send left).
  function bounceOffPaddle(p, dirX) {
    // -1 (top edge) .. 0 (center) .. +1 (bottom edge)
    const rel = ((ball.y - (p.y + p.h / 2)) / (p.h / 2));
    const clamped = clamp(rel, -1, 1);
    const angle = clamped * MAX_BOUNCE; // angle away from horizontal

    // Speed up a touch on each hit, capped.
    ball.speed = Math.min(ball.speed + SPEEDUP, MAX_SPEED);

    ball.vx = Math.cos(angle) * ball.speed * dirX;
    ball.vy = Math.sin(angle) * ball.speed;
    // A moving paddle nudges the ball's vertical speed ("english"), kept in check.
    ball.vy += clamp(p.vy * 0.12, -140, 140);

    // Re-normalise to the scalar speed so the english can't inflate total speed.
    const mag = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / mag) * ball.speed;
    ball.vy = (ball.vy / mag) * ball.speed;

    if (p === left) flashL = 0.18; else flashR = 0.18;
    shake = Math.max(shake, 5);
    sndPaddle();
  }

  function updateTrail(dt) {
    if (state === STATE.PLAYING) {
      trail.push({ x: ball.x, y: ball.y, life: 0.22 });
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].life -= dt;
      if (trail[i].life <= 0) trail.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------
  function draw() {
    ctx.save();

    // Screen shake.
    if (shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * shake * 0.4, (Math.random() * 2 - 1) * shake * 0.4);
    }

    drawBackground();
    drawNet();

    // Ball trail (skip on title where the ball is hidden).
    if (state !== STATE.TITLE) {
      for (const t of trail) {
        const a = (t.life / 0.22) * 0.45;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(150, 230, 255, ' + a + ')';
        ctx.arc(t.x, t.y, BALL_R * (0.5 + t.life * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawPaddle(left, flashL);
    drawPaddle(right, flashR);
    if (state !== STATE.TITLE) drawBall();

    drawScores();

    // Whole-screen flash when a point lands.
    if (scoreFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (scoreFlash * 0.5) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // Overlays.
    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.SERVE) drawServeHint();
    else if (state === STATE.WIN) drawWin();

    ctx.restore();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c1220');
    g.addColorStop(1, '#05070b');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    // Subtle frame.
    ctx.strokeStyle = 'rgba(84, 214, 255, 0.10)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  // Dashed center net.
  function drawNet() {
    const dash = 16, gap = 14, x = W / 2;
    ctx.fillStyle = 'rgba(159, 180, 212, 0.30)';
    for (let y = 8; y < H - 8; y += dash + gap) {
      ctx.fillRect(x - 2, y, 4, dash);
    }
  }

  function drawPaddle(p, flash) {
    ctx.save();
    ctx.shadowColor = 'rgba(84, 214, 255, ' + (0.55 + flash * 2) + ')';
    ctx.shadowBlur = 14 + flash * 60;
    ctx.fillStyle = flash > 0 ? '#dff4ff' : '#54d6ff';
    roundRect(p.x, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.restore();
    // Inner gradient for a little depth.
    const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
    g.addColorStop(0, '#bff0ff');
    g.addColorStop(1, '#2aa7d6');
    ctx.fillStyle = g;
    roundRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4, 4);
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

  // Big scores, one per side of the net.
  function drawScores() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(207, 214, 228, 0.92)';
    ctx.font = '700 72px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(scoreL), W / 2 - 70, 22);
    ctx.fillText(String(scoreR), W / 2 + 70, 22);

    // Tiny side labels so it's clear who's who (esp. in 1P).
    ctx.shadowBlur = 4;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#6b7890';
    ctx.fillText('P1', W / 2 - 70, 100);
    ctx.fillText(mode === 1 ? 'CPU' : 'P2', W / 2 + 70, 100);

    // In 1P, surface the active CPU difficulty in the HUD, e.g. "CPU · MEDIUM".
    if (mode === 1) {
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#54d6ff';
      ctx.fillText('CPU · ' + DIFFICULTIES[difficulty].label, W / 2 + 70, 118);
    }
    ctx.restore();
  }

  // Shared overlay helpers.
  function dimScreen(alpha) {
    ctx.fillStyle = 'rgba(5, 7, 11, ' + alpha + ')';
    ctx.fillRect(0, 0, W, H);
  }
  function centerText(text, y, size, color, weight) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  // A pill button: rounded rect + centered label, returns its hit rect so the
  // caller can register it as a clickable zone.
  function drawPill(cx, cy, w, h, label, size, selected, accent) {
    const x = cx - w / 2, y = cy - h / 2;
    const ac = accent || '#54d6ff';
    ctx.save();
    // Body.
    ctx.fillStyle = selected ? 'rgba(84, 214, 255, 0.18)' : 'rgba(159, 180, 212, 0.06)';
    roundRect(x, y, w, h, h / 2);
    ctx.fill();
    // Border (glows when selected).
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? ac : 'rgba(159, 180, 212, 0.35)';
    if (selected) { ctx.shadowColor = ac; ctx.shadowBlur = 14; }
    roundRect(x, y, w, h, h / 2);
    ctx.stroke();
    ctx.restore();
    // Label.
    ctx.save();
    ctx.fillStyle = selected ? '#dff4ff' : '#9fb4d4';
    ctx.font = (selected ? 700 : 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
    ctx.restore();
    return { x: x, y: y, w: w, h: h };
  }

  function drawTitle() {
    dimScreen(0.58);
    titleZones = []; // rebuilt to match exactly what we draw this frame

    centerText('PONG', H / 2 - 168, 60, '#9fb4d4', 700);
    centerText('First to ' + WIN_SCORE + ' wins', H / 2 - 124, 16, '#cdd6e4', 400);

    // --- Mode chooser: two tappable pills (also keys 1 / 2) ---
    centerText('MODE', H / 2 - 92, 12, '#6b7890', 700);
    const modeY = H / 2 - 58;
    const z1 = drawPill(W / 2 - 116, modeY, 210, 40, '1  ·  1P (vs CPU)', 17, mode === 1);
    titleZones.push({ kind: 'mode', value: 1, x: z1.x, y: z1.y, w: z1.w, h: z1.h });
    const z2 = drawPill(W / 2 + 116, modeY, 210, 40, '2  ·  2P', 17, mode === 2);
    titleZones.push({ kind: 'mode', value: 2, x: z2.x, y: z2.y, w: z2.w, h: z2.h });

    // --- Difficulty chooser: four tappable pills (also keys 1-4) ---
    // Dim the whole row in 2P, where CPU difficulty is irrelevant.
    const diffActive = mode === 1;
    ctx.globalAlpha = diffActive ? 1 : 0.4;
    centerText('CPU DIFFICULTY', H / 2 + 6, 12, '#6b7890', 700);
    const diffY = H / 2 + 44;
    const pillW = 150, gap = 12;
    const totalW = pillW * 4 + gap * 3;
    let px = W / 2 - totalW / 2 + pillW / 2;
    for (let i = 0; i < DIFFICULTIES.length; i++) {
      const accent = (DIFFICULTIES[i].key === 'UNBEATABLE') ? '#ff5d73' : '#54d6ff';
      const z = drawPill(px, diffY, pillW, 38, (i + 1) + '  ' + DIFFICULTIES[i].label, 15, difficulty === i, accent);
      titleZones.push({ kind: 'diff', value: i, x: z.x, y: z.y, w: z.w, h: z.h });
      px += pillW + gap;
    }
    ctx.globalAlpha = 1;

    centerText('Left  W / S        Right  ↑ / ↓', H / 2 + 96, 15, '#cdd6e4', 400);

    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE to start', H / 2 + 138, 19, '#9fb4d4', 700);
    ctx.globalAlpha = 1;
  }

  function drawServeHint() {
    const a = 0.5 + 0.5 * Math.sin(performance.now() / 320);
    ctx.globalAlpha = a;
    const who = serveDir > 0 ? 'P1' : (mode === 1 ? 'CPU' : 'P2');
    const label = (mode === 1 && serveDir < 0) ? 'CPU serving…' : (who + ' to serve — press SPACE');
    centerText(label, H / 2 + 150, 18, '#9fb4d4', 600);
    ctx.globalAlpha = 1;
  }

  function drawWin() {
    dimScreen(0.62);
    const name = winner === 1 ? 'P1' : (mode === 1 ? 'CPU' : 'P2');
    const col = winner === 1 ? '#6bd968' : (mode === 1 ? '#ff5d73' : '#6bd968');
    centerText(name + ' WINS', H / 2 - 56, 56, col, 700);
    centerText(scoreL + '  —  ' + scoreR, H / 2 + 4, 30, '#cdd6e4', 600);
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press SPACE to play again', H / 2 + 70, 20, '#54d6ff', 700);
    ctx.globalAlpha = 1;
  }

  // Rounded-rectangle path helper (caller fills/strokes).
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

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---------------------------------------------------------------------------
  // In 1P, auto-serve for the CPU shortly after it's the CPU's turn, so the
  // human never has to press Space on the opponent's behalf.
  // ---------------------------------------------------------------------------
  let cpuServeT = 0;
  function maybeCpuServe(dt) {
    if (state === STATE.SERVE && mode === 1 && serveDir < 0) {
      cpuServeT += dt;
      if (cpuServeT > 0.8) { cpuServeT = 0; serve(); }
    } else {
      cpuServeT = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — delta-time rAF. dt is clamped so a tab switch can't teleport the
  // ball across the field in a single frame.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp ~20fps worst case
    maybeCpuServe(dt);
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
