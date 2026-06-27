(() => {
  'use strict';

  // ===========================================================================
  // DOODLE JUMP — a vertical, auto-bouncing platform jumper.
  //   * The hopper bounces upward off platforms forever; you only steer L/R.
  //   * Leaving one side of the screen wraps you to the other.
  //   * The camera scrolls up as you climb; score = max height reached.
  //   * Platform variety: static, horizontally-moving, and breakable (one-use).
  //   * Springs launch you extra high. Fall off the bottom -> game over.
  // Canvas is a fixed 480x640 internal resolution (portrait).
  // ===========================================================================

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 640

  // ---------------------------------------------------------------------------
  // Tunables — the "lively but controllable" sweet spot. Units are canvas-px
  // and seconds. GRAVITY pulls down constantly; a bounce sets velocity to a
  // fixed upward impulse so every hop feels identical and predictable. The
  // jump arc is tuned so the apex lands a little above the next platform gap.
  // ---------------------------------------------------------------------------
  const GRAVITY = 1500;          // downward accel (px/s^2)
  const BOUNCE_V = -760;         // upward velocity applied on a normal bounce
  const SPRING_V = -1250;        // much stronger launch from a spring
  const MOVE_ACCEL = 2400;       // horizontal accel from steering input
  const MOVE_MAX = 430;          // horizontal speed cap
  const MOVE_FRICTION = 0.86;    // per-frame damping when no key is held (~60fps)
  const PLAYER_W = 46;           // hopper body width (collision box)
  const PLAYER_H = 42;           // hopper body height
  const PLAT_W = 70;             // platform width
  const PLAT_H = 16;             // platform height
  const PLAT_GAP_MIN = 56;       // min vertical spacing between platforms
  const PLAT_GAP_MAX = 96;       // max vertical spacing (must stay < jump height)
  const CAMERA_LINE = H * 0.42;  // player is held around here; world scrolls instead
  const MOVE_GROW = 55;          // pixels a moving platform travels each direction

  // Platform kinds.
  const STATIC = 0;     // ordinary green platform
  const MOVING = 1;     // slides left/right
  const BREAK = 2;      // crumbles after one bounce

  // ---------------------------------------------------------------------------
  // High score (localStorage, guarded so a locked-down file:// can't crash us).
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'doodlejump_best';
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
  // A short tone with an envelope. `slideTo` bends the pitch over the duration.
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
  function sfxBounce()  { tone(420, 0.10, 'square',   0.10, 700); }  // hop "blip"
  function sfxSpring()  { tone(300, 0.26, 'sawtooth', 0.12, 1200); } // spring "boing"
  function sfxBreak()   { tone(220, 0.18, 'triangle', 0.12, 90); }   // platform crack
  function sfxDie()     { tone(360, 0.55, 'sawtooth', 0.16, 70); }   // falling wah

  // ---------------------------------------------------------------------------
  // Game state. EVERYTHING that update()/render() touches is initialised here
  // at module load (NOT only in reset()), so the TITLE screen — which also runs
  // update + render — never reads an undefined value. A blank canvas = fail.
  // ---------------------------------------------------------------------------
  const TITLE = 0, PLAYING = 1, DEAD = 2;
  let mode = TITLE;

  let player = { x: W / 2, y: H - 120, vx: 0, vy: 0, sx: 1, sy: 1, face: 1 };
  let platforms = [];     // each: { x, y, kind, dir, base, broken, springY|null }
  let particles = [];     // break/spring debris
  let stars = [];         // parallax background dots (two depths)

  let cameraY = 0;        // world-space y of the top of the viewport
  let highestY = player.y; // smallest (highest) y the player has reached
  let score = 0;
  let deathFlash = 0;     // 1 -> 0 white flash on death
  let landFlash = 0;      // brief tint when a platform is hit (subtle juice)
  let titlePulse = 0;     // animates the "press space" prompt
  let bgHue = 0;          // slowly drifts the backdrop as you climb

  const keys = { left: false, right: false };

  // Build the drifting starfield once. Two layers scroll at different rates for
  // a parallax feel; they wrap vertically so the field is effectively endless.
  function buildStars() {
    stars = [];
    for (let i = 0; i < 60; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.6 + 0.4,
        depth: Math.random() < 0.5 ? 0.25 : 0.55, // parallax factor
      });
    }
  }
  buildStars();

  // ---------------------------------------------------------------------------
  // Platform spawning. We always keep the world populated from a little above
  // the camera down past the player. `spawnY` tracks the y of the next (higher)
  // platform to create as the player climbs.
  // ---------------------------------------------------------------------------
  let spawnY = 0;

  function makePlatform(x, y, kind) {
    const p = { x, y, kind, dir: Math.random() < 0.5 ? -1 : 1, base: x, broken: false, spring: false };
    // ~22% of solid (non-breakable) platforms get a spring bolted on top.
    if (kind !== BREAK && Math.random() < 0.22) p.spring = true;
    return p;
  }

  // Pick a platform kind with difficulty scaling: the higher you climb (bigger
  // score) the more moving/breakable platforms appear, raising the challenge.
  function pickKind() {
    const diff = Math.min(1, score / 6000); // 0 at start -> 1 deep in a run
    const r = Math.random();
    const movingChance = 0.12 + diff * 0.26; // 12% -> 38%
    const breakChance  = 0.06 + diff * 0.22; // 6%  -> 28%
    if (r < breakChance) return BREAK;
    if (r < breakChance + movingChance) return MOVING;
    return STATIC;
  }

  // Fill upward until we've created platforms above the top of the viewport.
  function fillPlatformsAbove() {
    while (spawnY > cameraY - 40) {
      const gap = PLAT_GAP_MIN + Math.random() * (PLAT_GAP_MAX - PLAT_GAP_MIN);
      spawnY -= gap;
      const x = Math.random() * (W - PLAT_W);
      // Never make the very first reachable platforms breakable (avoid early death).
      const kind = pickKind();
      platforms.push(makePlatform(x, spawnY, kind));
    }
  }

  // ---------------------------------------------------------------------------
  // Reset to a fresh run. Lays down a guaranteed safe starting platform under
  // the player plus a dense ladder of static platforms so the opening is gentle.
  // ---------------------------------------------------------------------------
  function reset() {
    player = { x: W / 2, y: H - 120, vx: 0, vy: 0, sx: 1, sy: 1, face: 1 };
    platforms = [];
    particles = [];
    cameraY = 0;
    highestY = player.y;
    score = 0;
    deathFlash = 0;
    landFlash = 0;
    bgHue = 0;

    // A solid platform directly beneath the player's feet to launch from.
    platforms.push(makePlatform(W / 2 - PLAT_W / 2, H - 70, STATIC));

    // A friendly ladder of mostly-static platforms for the first stretch.
    spawnY = H - 70;
    for (let i = 0; i < 9; i++) {
      const gap = PLAT_GAP_MIN + Math.random() * 26;
      spawnY -= gap;
      const x = Math.random() * (W - PLAT_W);
      // First several are always static & spring-free so the start is fair.
      const p = makePlatform(x, spawnY, STATIC);
      p.spring = false;
      platforms.push(p);
    }
    fillPlatformsAbove();
  }

  // ---------------------------------------------------------------------------
  // Particles — used for platform crumbs and spring sparks.
  // ---------------------------------------------------------------------------
  function spawnParticles(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread + 40;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        color,
        size: Math.random() * 3 + 2,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Bounce helpers.
  // ---------------------------------------------------------------------------
  function doBounce(spring) {
    player.vy = spring ? SPRING_V : BOUNCE_V;
    // Squash on impact: wide & short, then it eases back to 1 each frame.
    player.sx = spring ? 1.5 : 1.35;
    player.sy = spring ? 0.55 : 0.7;
    landFlash = spring ? 0.5 : 0.28;
    if (spring) sfxSpring(); else sfxBounce();
  }

  // ---------------------------------------------------------------------------
  // Input. Space/Enter starts & restarts; arrows / A,D steer. The AudioContext
  // is created on the first gesture (browser autoplay policy).
  // ---------------------------------------------------------------------------
  function startOrRestart() {
    if (mode === PLAYING) return;
    reset();
    mode = PLAYING;
  }

  window.addEventListener('keydown', (e) => {
    initAudio();
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      startOrRestart();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });

  // A click/tap starts the game (per spec). During play, a tap also nudges the
  // hopper toward the side of the canvas you touched, so it's playable on mobile.
  canvas.addEventListener('pointerdown', (e) => {
    initAudio();
    if (mode !== PLAYING) { startOrRestart(); return; }
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    if (px < W / 2) { keys.left = true; keys.right = false; }
    else { keys.right = true; keys.left = false; }
  });
  // Release pointer-steering when the tap ends or leaves the canvas.
  function releasePointer() { keys.left = false; keys.right = false; }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', () => {
    // Only clear on leave if a pointer was actually steering (mouse hover safe).
    if (mode === PLAYING) releasePointer();
  });

  // ===========================================================================
  // UPDATE
  // ===========================================================================
  function update(dt) {
    // Animate title prompt + background drift regardless of mode (title runs too).
    titlePulse += dt;
    bgHue += dt * 6;

    // Always advance particles and the parallax field so the screen feels alive
    // even on the title / game-over screens.
    updateParticles(dt);
    updateStars(dt);

    if (landFlash > 0) landFlash = Math.max(0, landFlash - dt * 2.2);
    if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt * 1.8);

    if (mode !== PLAYING) return;

    // --- Horizontal steering -------------------------------------------------
    if (keys.left && !keys.right) {
      player.vx -= MOVE_ACCEL * dt;
      player.face = -1;
    } else if (keys.right && !keys.left) {
      player.vx += MOVE_ACCEL * dt;
      player.face = 1;
    } else {
      // Ease the horizontal speed toward 0 (frame-rate-independent friction).
      player.vx *= Math.pow(MOVE_FRICTION, dt * 60);
    }
    if (player.vx > MOVE_MAX) player.vx = MOVE_MAX;
    if (player.vx < -MOVE_MAX) player.vx = -MOVE_MAX;

    player.x += player.vx * dt;

    // Screen wrap: exiting one side re-enters from the other (classic Doodle).
    if (player.x < -PLAYER_W / 2) player.x = W + PLAYER_W / 2;
    else if (player.x > W + PLAYER_W / 2) player.x = -PLAYER_W / 2;

    // --- Vertical (gravity + bounce) ----------------------------------------
    player.vy += GRAVITY * dt;
    const prevFeet = player.y + PLAYER_H / 2; // feet position before moving
    player.y += player.vy * dt;
    const feet = player.y + PLAYER_H / 2;

    // Ease the squash/stretch back toward neutral (1,1) every frame.
    player.sx += (1 - player.sx) * Math.min(1, dt * 12);
    player.sy += (1 - player.sy) * Math.min(1, dt * 12);

    // --- Platform collision --------------------------------------------------
    // Only when falling (vy > 0). We test that the feet *crossed* the platform
    // top this frame so a fast fall can't tunnel straight through it.
    if (player.vy > 0) {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (p.broken) continue;
        const top = p.y;
        const withinX = player.x + PLAYER_W / 2 > p.x && player.x - PLAYER_W / 2 < p.x + PLAT_W;
        const crossed = prevFeet <= top + 6 && feet >= top && feet <= top + PLAT_H + 14;
        if (withinX && crossed) {
          if (p.spring) {
            // Spring overrides: extra-high launch + spark burst.
            doBounce(true);
            spawnParticles(p.x + PLAT_W / 2, top - 6, '#ffd166', 14, 160);
          } else if (p.kind === BREAK) {
            // Breakables give NO bounce — they crumble and you keep falling.
            p.broken = true;
            sfxBreak();
            spawnParticles(p.x + PLAT_W / 2, top, '#e07a5f', 16, 140);
          } else {
            doBounce(false);
          }
          break; // one platform per frame
        }
      }
    }

    // --- Moving platforms ----------------------------------------------------
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.kind === MOVING && !p.broken) {
        p.x += p.dir * 70 * dt;
        if (p.x < p.base - MOVE_GROW) { p.x = p.base - MOVE_GROW; p.dir = 1; }
        else if (p.x > p.base + MOVE_GROW) { p.x = p.base + MOVE_GROW; p.dir = -1; }
        // Keep them inside the play area too.
        if (p.x < 0) { p.x = 0; p.dir = 1; }
        else if (p.x > W - PLAT_W) { p.x = W - PLAT_W; p.dir = -1; }
      }
    }

    // --- Camera follow + scoring --------------------------------------------
    // The camera only ever moves up. When the player climbs above the camera
    // line we slide the world's viewport up to keep them near CAMERA_LINE.
    if (player.y < highestY) highestY = player.y;
    const targetCam = highestY - CAMERA_LINE;
    if (targetCam < cameraY) cameraY = targetCam;

    // Score is the climb height in "metres" (10 px per metre), max reached.
    score = Math.max(score, Math.floor((H - 120 - highestY) / 10));

    // Generate new platforms above and drop ones that fell well below the view.
    fillPlatformsAbove();
    const cullY = cameraY + H + 60;
    platforms = platforms.filter((p) => p.y < cullY);

    // --- Death: fell below the bottom of the visible screen ------------------
    if (player.y - PLAYER_H / 2 > cameraY + H) {
      mode = DEAD;
      deathFlash = 1;
      sfxDie();
      if (score > best) { best = score; saveBest(best); }
      if (window.Arcade) Arcade.submitScore('doodle-jump', score); // final height reached
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 520 * dt;       // particle gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateStars(dt) {
    // Stars drift down slowly so the climb reads as upward motion even at rest.
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y += dt * 14 * s.depth * 3;
      if (s.y > H) { s.y -= H; s.x = Math.random() * W; }
    }
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  function render() {
    // Backdrop: a dark vertical gradient whose hue drifts a touch as you climb.
    const hue = 210 + Math.sin(bgHue * 0.02) * 14;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${hue}, 36%, 11%)`);
    g.addColorStop(1, '#0b0e14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawStars();

    // World-space rendering: translate so cameraY maps to the top of the canvas.
    ctx.save();
    ctx.translate(0, -cameraY);
    drawPlatforms();
    drawParticles();
    if (mode !== TITLE) drawPlayer();
    ctx.restore();

    drawHUD();

    // Subtle white flash when landing, full flash on death.
    if (landFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${landFlash * 0.12})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (deathFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${deathFlash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (mode === TITLE) drawTitle();
    else if (mode === DEAD) drawGameOver();
  }

  function drawStars() {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      ctx.globalAlpha = 0.35 + s.depth * 0.5;
      ctx.fillStyle = '#9fb4d4';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlatforms() {
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.broken) continue;
      const x = p.x, y = p.y;

      // Body colour by kind.
      let top, bot;
      if (p.kind === MOVING) { top = '#5aa9e6'; bot = '#2f6fb0'; }
      else if (p.kind === BREAK) { top = '#e0a35f'; bot = '#9c5a2e'; }
      else { top = '#7ec85a'; bot = '#3f8f33'; }

      const grad = ctx.createLinearGradient(0, y, 0, y + PLAT_H);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bot);
      ctx.fillStyle = grad;
      roundRect(x, y, PLAT_W, PLAT_H, 6);
      ctx.fill();

      // Breakable platforms get a hairline "crack" to telegraph their fragility.
      if (p.kind === BREAK) {
        ctx.strokeStyle = 'rgba(40,20,10,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + PLAT_W * 0.3, y + 2);
        ctx.lineTo(x + PLAT_W * 0.45, y + PLAT_H - 2);
        ctx.moveTo(x + PLAT_W * 0.62, y + 2);
        ctx.lineTo(x + PLAT_W * 0.52, y + PLAT_H - 2);
        ctx.stroke();
      }

      // A glossy highlight strip along the top edge.
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(x + 3, y + 2, PLAT_W - 6, 3, 1.5);
      ctx.fill();

      // Spring: a little coiled launcher sitting on top of the platform.
      if (p.spring) drawSpring(x + PLAT_W / 2, y);
    }
  }

  function drawSpring(cx, platTop) {
    ctx.save();
    ctx.translate(cx, platTop);
    // Coil (zig-zag) drawn above the platform.
    ctx.strokeStyle = '#cdd6e4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, -4);
    ctx.lineTo(-5, -8);
    ctx.lineTo(5, -12);
    ctx.stroke();
    // Cap plate on top of the coil.
    ctx.fillStyle = '#ffd166';
    roundRect(-8, -16, 16, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // The hopper: a rounded body with eyes, a snout and feet, squash-stretched by
  // (sx, sy) so a bounce visibly flattens it. Faces its travel direction.
  function drawPlayer() {
    const cx = player.x;
    const cy = player.y;
    const w = PLAYER_W * player.sx;
    const h = PLAYER_H * player.sy;

    ctx.save();
    ctx.translate(cx, cy);

    // Soft shadow blob beneath for grounding.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, h / 2 + 2, w * 0.4, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Feet (two stubby legs).
    ctx.fillStyle = '#3f8f33';
    ctx.beginPath();
    ctx.ellipse(-w * 0.22, h / 2 - 2, 6, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.22, h / 2 - 2, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    const bodyGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    bodyGrad.addColorStop(0, '#9be36f');
    bodyGrad.addColorStop(1, '#5fb43f');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snout poking out the front (direction of travel).
    ctx.fillStyle = '#7ec85a';
    ctx.beginPath();
    ctx.ellipse(player.face * w * 0.34, h * 0.06, w * 0.2, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (two whites with pupils, biased toward the facing side).
    const ex = player.face * w * 0.14;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex - 7, -h * 0.18, 6, 0, Math.PI * 2);
    ctx.arc(ex + 7, -h * 0.18, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a2230';
    ctx.beginPath();
    ctx.arc(ex - 7 + player.face * 2, -h * 0.18, 2.6, 0, Math.PI * 2);
    ctx.arc(ex + 7 + player.face * 2, -h * 0.18, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD — score top-left, best top-right, with a subtle drop shadow.
  // ---------------------------------------------------------------------------
  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(score), 14, 12);

    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#8aa0c0';
    ctx.textAlign = 'right';
    ctx.fillText('BEST ' + best, W - 14, 16);
    ctx.restore();
  }

  // Shared overlay box for title / game-over panels.
  function panel(yTop, h) {
    ctx.fillStyle = 'rgba(8,12,22,0.78)';
    roundRect((W - 320) / 2, yTop, 320, h, 16);
    ctx.fill();
  }

  function drawTitle() {
    panel(H * 0.30, 230);
    ctx.textAlign = 'center';

    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('DOODLE', W / 2, H * 0.30 + 54);
    ctx.fillText('JUMP', W / 2, H * 0.30 + 94);

    ctx.fillStyle = '#8aa0c0';
    ctx.font = '500 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Bounce up the platforms. Don’t fall.', W / 2, H * 0.30 + 132);
    ctx.fillText('← → / A D to steer · wrap around the edges', W / 2, H * 0.30 + 154);

    // Pulsing call-to-action.
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#9be36f';
    ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE / ENTER', W / 2, H * 0.30 + 196);
    ctx.globalAlpha = 1;
  }

  function drawGameOver() {
    panel(H * 0.32, 200);
    ctx.textAlign = 'center';

    ctx.fillStyle = '#e07a5f';
    ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('GAME OVER', W / 2, H * 0.32 + 50);

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Height ' + score, W / 2, H * 0.32 + 92);

    ctx.fillStyle = '#8aa0c0';
    ctx.font = '500 14px "Segoe UI", system-ui, sans-serif';
    const tag = score >= best && score > 0 ? 'NEW BEST!' : 'Best ' + best;
    ctx.fillStyle = (score >= best && score > 0) ? '#ffd166' : '#8aa0c0';
    ctx.fillText(tag, W / 2, H * 0.32 + 118);

    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#9be36f';
    ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE / ENTER', W / 2, H * 0.32 + 162);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Small canvas helper: a filled/strokeable rounded rectangle path.
  // ---------------------------------------------------------------------------
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

  // ===========================================================================
  // MAIN LOOP — requestAnimationFrame with a clamped delta time so a tab-switch
  // (huge dt) can't fling the player across the world in a single step.
  // ===========================================================================
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp (~20fps floor) — never teleport on lag
    if (dt < 0) dt = 0;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
