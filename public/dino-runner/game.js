// ============================================================
//  DINO RUNNER  —  a Chrome-dino-style endless runner.
//  Pure HTML5 Canvas + vanilla JavaScript. No libraries, no
//  asset files. Just open index.html in a browser (file://).
//
//  The world scrolls left at `speed`, which creeps up over
//  distance so the game starts gentle and turns brutal. The
//  runner auto-runs in place; you only JUMP (variable height
//  by how long you hold) over ground cacti and DUCK under the
//  flying foes that show up once you're fast enough.
//
//  Everything is drawn procedurally. Read update() for the
//  physics + spawning, and the draw* helpers for the art.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;    // 800 — fixed internal resolution
  const H = canvas.height;   // 300  (CSS scales it to the page)

  // ---- World constants (tweak these to change the feel) -------
  const GROUND_Y = H - 56;            // y of the ground line (top of dirt)
  const GRAVITY = 2600;               // downward accel (px/s^2)
  const JUMP_V = -880;                // initial jump velocity (px/s)
  const JUMP_CUT = 0.42;              // velocity kept when you release early
  const COYOTE = 0.08;                // grace window to still jump after leaving ground

  const START_SPEED = 320;            // px/s the world scrolls at the start
  const MAX_SPEED = 920;              // hard cap so it stays (barely) playable
  const SPEED_RAMP = 10;              // px/s added per second survived
  const FLYER_SPEED = 560;            // world speed at which flyers start appearing

  // Runner ("dino") body box used for physics + collision.
  const DINO_X = 90;                  // fixed horizontal position
  const DINO_W = 40;
  const DINO_H = 46;
  const DUCK_H = 28;                  // shorter hitbox while ducking

  // ---- Colors (dark arcade palette) ---------------------------
  const COL = {
    skyTop: '#0c1320', skyBot: '#10192b',
    ground: '#3a4660', groundLine: '#5a6a90',
    dino: '#9fe6c0', dinoDark: '#5fb98e', dinoEye: '#0c1320',
    cactus: '#7fae7a', cactusDark: '#4f7a55',
    bird: '#c9b6f0', birdDark: '#8f78c8',
    star: '#cdd6e4', moon: '#e9eefc',
    sun: '#ffe27a',
    dust: '#8aa0c4',
    hud: '#cdd6e4', hudDim: '#6b7890', accent: '#9fb4d4', warn: '#ff6b6b',
  };

  // ---- Best score (localStorage, fails silently) --------------
  function loadBest() {
    try { return Number(localStorage.getItem('dinoRunnerBest') || 0) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('dinoRunnerBest', String(v)); } catch (e) { /* ignore */ }
  }

  // ---- Game state ---------------------------------------------
  // IMPORTANT: every field update()/render() reads is initialized
  // HERE, at load — the title & game-over screens run the loop too.
  const state = {
    mode: 'title',      // title | playing | over
    speed: START_SPEED,
    distance: 0,        // world units travelled (drives the score)
    score: 0,
    best: loadBest(),
    timeAlive: 0,
    dayNight: 0,        // 0..1 phase that slowly flips day <-> night
    shake: 0,           // screen-shake amount (px), decays
    flash: 0,           // white death flash (0..1), decays
    nextMilestone: 500, // next score that triggers a beep
  };

  // The runner.
  const dino = {
    y: GROUND_Y - DINO_H, // top of the body box
    vy: 0,
    onGround: true,
    ducking: false,
    coyote: 0,            // time left where a jump is still allowed
    runPhase: 0,          // cycles the two-frame leg animation
    blink: 0,             // eye blink timer
  };

  const obstacles = [];   // {x,y,w,h,type:'cactus'|'bird',flap}
  const particles = [];   // landing dust {x,y,vx,vy,life,max}
  const clouds = [];      // parallax background {x,y,scale,spd}
  const stars = [];       // night sky {x,y,r,tw}
  let spawnTimer = 0;     // seconds until the next obstacle
  let groundScroll = 0;   // x offset of the dotted ground texture

  // ---- Seed the decorative background (once, at load) ---------
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: Math.random() * W,
      y: 30 + Math.random() * 90,
      scale: 0.6 + Math.random() * 0.9,
      spd: 0.12 + Math.random() * 0.18,   // fraction of world speed (parallax)
    });
  }
  for (let i = 0; i < 38; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * (GROUND_Y - 40),
      r: Math.random() < 0.8 ? 1 : 1.5,
      tw: Math.random() * Math.PI * 2,    // twinkle phase
    });
  }

  // ---- Helpers ------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // current night-ness: 0 = full day, 1 = full night (smooth flip)
  function nightFactor() {
    return 0.5 - 0.5 * Math.cos(state.dayNight * Math.PI * 2);
  }

  // ---- Input --------------------------------------------------
  // We track whether jump is *held* so jump height scales with hold.
  const input = { jumpHeld: false, duckHeld: false };

  function pressJump() {
    initAudio();
    if (state.mode === 'title' || state.mode === 'over') {
      startRun();
      return;
    }
    if (state.mode !== 'playing') return;
    input.jumpHeld = true;
    // Jump if grounded OR within the coyote-time grace window.
    if (dino.onGround || dino.coyote > 0) {
      dino.vy = JUMP_V;
      dino.onGround = false;
      dino.coyote = 0;
      dino.ducking = false;
      sfxJump();
    }
  }

  function onKeyDown(e) {
    switch (e.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        if (!e.repeat) pressJump();
        break;
      case 'ArrowDown':
      case 'KeyS':
        e.preventDefault();
        input.duckHeld = true;
        break;
    }
  }

  function onKeyUp(e) {
    switch (e.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        input.jumpHeld = false;
        // Variable jump height: releasing early cuts the upward velocity.
        if (dino.vy < 0) dino.vy *= JUMP_CUT;
        break;
      case 'ArrowDown':
      case 'KeyS':
        input.duckHeld = false;
        break;
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Pointer support (tap = jump) so it works on touch screens too.
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); pressJump(); });
  canvas.addEventListener('pointerup', () => { input.jumpHeld = false; if (dino.vy < 0) dino.vy *= JUMP_CUT; });

  // ---- Audio (WebAudio, lazy, never throws) -------------------
  let actx = null;

  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
    } catch (e) { actx = null; }
  }

  // A short tone with an envelope. All audio is wrapped so a
  // failure can never break the game.
  function tone(freq, dur, type, gain, slideTo) {
    if (!actx) return;
    try {
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  const sfxJump = () => tone(620, 0.12, 'square', 0.12, 880);     // upward blip
  const sfxMilestone = () => tone(990, 0.1, 'triangle', 0.13);    // score beep
  function sfxDeath() {
    // A low "thud" plus a quick downward sweep.
    tone(160, 0.22, 'square', 0.16, 60);
    tone(90, 0.4, 'sawtooth', 0.1, 38);
  }

  // ---- Start / reset / end ------------------------------------
  function startRun() {
    state.mode = 'playing';
    state.speed = START_SPEED;
    state.distance = 0;
    state.score = 0;
    state.timeAlive = 0;
    state.shake = 0;
    state.flash = 0;
    state.nextMilestone = 500;
    // keep state.dayNight running so the cycle feels continuous

    dino.y = GROUND_Y - DINO_H;
    dino.vy = 0;
    dino.onGround = true;
    dino.ducking = false;
    dino.coyote = 0;
    dino.runPhase = 0;
    dino.blink = rand(1.5, 4);

    obstacles.length = 0;
    particles.length = 0;
    spawnTimer = 0.9;       // small grace before the first obstacle
  }

  function endRun() {
    state.mode = 'over';
    state.shake = 12;
    state.flash = 1;
    sfxDeath();
    const s = Math.floor(state.score);
    if (s > state.best) { state.best = s; saveBest(s); }
  }

  // ---- Spawning -----------------------------------------------
  // Gap between obstacles shrinks as you speed up, with jitter so
  // the pattern never feels metronomic. A minimum gap (scaled to
  // speed) guarantees every spawn is physically clearable.
  function scheduleNextSpawn() {
    const sp = state.speed;
    const minGapPx = sp * 0.62 + 120;          // reaction distance grows with speed
    const maxGapPx = sp * 1.25 + 320;
    const gapPx = rand(minGapPx, maxGapPx);
    spawnTimer = gapPx / sp;                    // px -> seconds at current speed
  }

  function spawnObstacle() {
    const sp = state.speed;
    // Flyers only once we're fast; even then, mix in ground cacti.
    const canFly = sp > FLYER_SPEED;
    const makeFlyer = canFly && Math.random() < 0.32;

    if (makeFlyer) {
      // Bird at one of three heights. The lowest one MUST be ducked;
      // the higher ones can be jumped or ducked.
      const tier = Math.floor(rand(0, 3));
      const yByTier = [
        GROUND_Y - 30,                 // low  -> duck (or skim a jump)
        GROUND_Y - 58,                 // mid  -> duck or jump
        GROUND_Y - 86,                 // high -> jump under it
      ];
      obstacles.push({
        type: 'bird',
        x: W + 20,
        y: yByTier[tier],
        w: 42, h: 26,
        flap: Math.random() * Math.PI * 2,
      });
    } else {
      // A cactus cluster of 1–3 stalks; width scales the difficulty.
      const count = Math.random() < 0.45 ? 1 : (Math.random() < 0.7 ? 2 : 3);
      const stalkW = 16;
      const w = count * stalkW + (count - 1) * 4;
      const h = rand(34, 52);
      obstacles.push({
        type: 'cactus',
        x: W + 20,
        y: GROUND_Y - h,
        w, h,
        count, stalkW,
      });
    }
  }

  // ---- Particles ----------------------------------------------
  function burstDust(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = rand(Math.PI, Math.PI * 2);   // upward / outward
      const sp = rand(40, 160);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp - state.speed * 0.25,
        vy: Math.sin(a) * sp * 0.6,
        life: rand(0.25, 0.5),
        max: 0.5,
      });
    }
  }

  // ---- Collision ----------------------------------------------
  // Tight AABB with a small inset so near-misses feel fair.
  function dinoBox() {
    const h = dino.ducking && dino.onGround ? DUCK_H : DINO_H;
    return { x: DINO_X + 6, y: dino.y + (DINO_H - h) + 4, w: DINO_W - 12, h: h - 6 };
  }
  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---- Update -------------------------------------------------
  function update(dt) {
    // Day/night phase advances slowly regardless of mode.
    state.dayNight = (state.dayNight + dt * 0.018) % 1;

    // Drift clouds and twinkle stars on every screen.
    for (const c of clouds) {
      c.x -= state.speed * c.spd * dt;
      if (c.x < -90) { c.x = W + rand(0, 120); c.y = 30 + Math.random() * 90; c.scale = 0.6 + Math.random() * 0.9; }
    }
    for (const s of stars) s.tw += dt * 2;

    if (state.mode !== 'playing') {
      // Idle decay so a death flash/shake on the game-over screen settles.
      state.shake = Math.max(0, state.shake - dt * 30);
      state.flash = Math.max(0, state.flash - dt * 2);
      return;
    }

    // --- difficulty: speed creeps up, distance & score grow ---
    state.timeAlive += dt;
    state.speed = Math.min(MAX_SPEED, START_SPEED + state.timeAlive * SPEED_RAMP);
    state.distance += state.speed * dt;
    state.score = state.distance * 0.1;          // ~10 units travelled = 1 point

    // milestone beep every 500 points
    if (state.score >= state.nextMilestone) {
      state.nextMilestone += 500;
      sfxMilestone();
    }

    // scroll the dotted ground texture
    groundScroll = (groundScroll + state.speed * dt) % 40;

    // --- runner physics ---
    dino.ducking = input.duckHeld && dino.onGround;

    dino.vy += GRAVITY * dt;
    // Fast-fall: holding duck in the air drops you quicker (feels snappy).
    if (input.duckHeld && !dino.onGround) dino.vy += GRAVITY * 0.6 * dt;
    dino.y += dino.vy * dt;

    const floor = GROUND_Y - DINO_H;
    if (dino.y >= floor) {
      if (!dino.onGround) burstDust(DINO_X + DINO_W * 0.5, GROUND_Y);  // landing dust
      dino.y = floor;
      dino.vy = 0;
      dino.onGround = true;
      dino.coyote = COYOTE;
    } else {
      dino.onGround = false;
      dino.coyote = Math.max(0, dino.coyote - dt);
    }

    // two-frame leg cycle, faster as we speed up; frozen mid-air
    if (dino.onGround) dino.runPhase += dt * (state.speed / 26);
    dino.blink -= dt;
    if (dino.blink < -0.12) dino.blink = rand(1.5, 4.5);  // schedule next blink

    // --- spawning ---
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      scheduleNextSpawn();
    }

    // --- move obstacles & test collisions ---
    const box = dinoBox();
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= state.speed * dt;
      if (o.type === 'bird') {
        o.flap += dt * 12;
        o.x -= 40 * dt;   // birds fly a touch faster than the ground
      }
      if (o.x + o.w < -10) { obstacles.splice(i, 1); continue; }
      if (hit(box, o)) { endRun(); break; }
    }

    // --- particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 420 * dt;          // gravity on dust
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // --- juice decay ---
    state.shake = Math.max(0, state.shake - dt * 30);
    state.flash = Math.max(0, state.flash - dt * 2.5);
  }

  // ============================================================
  //  RENDERING
  // ============================================================

  function render() {
    const night = nightFactor();

    // screen-shake offset
    const sx = state.shake ? rand(-state.shake, state.shake) : 0;
    const sy = state.shake ? rand(-state.shake, state.shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    drawSky(night);
    drawCelestial(night);
    drawClouds(night);
    drawGround(night);
    drawParticles();
    drawObstacles(night);
    drawDino(night);

    ctx.restore();   // stop shaking before HUD/overlays (keeps text crisp)

    drawHUD(night);

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.mode === 'title') drawTitle();
    if (state.mode === 'over') drawGameOver();
  }

  // ---- Background layers --------------------------------------
  function mix(a, b, t) {
    // blend two #rrggbb colors by t (0..1)
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function drawSky(night) {
    // Day sky is a touch lighter/bluer; night sky deep and dark.
    const top = mix('#1c2b48', COL.skyTop, night);
    const bot = mix('#26405f', COL.skyBot, night);
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y);

    // stars fade in with night
    if (night > 0.05) {
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(s.tw);
        ctx.globalAlpha = night * tw;
        ctx.fillStyle = COL.star;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCelestial(night) {
    // Sun and moon ride an arc across the sky, opposite each other,
    // crossfading with the day/night phase.
    const cx = W * 0.78, cy = GROUND_Y - 30, rad = 120;
    const ang = state.dayNight * Math.PI * 2;

    // sun (visible by day)
    const sunY = cy - Math.sin(ang) * rad;
    const sunX = cx + Math.cos(ang) * 40;
    if (night < 0.95) {
      ctx.globalAlpha = 1 - night;
      ctx.fillStyle = COL.sun;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // moon (visible by night), half a cycle out of phase
    const moonY = cy + Math.sin(ang) * rad;
    const moonX = cx - Math.cos(ang) * 40;
    if (night > 0.05) {
      ctx.globalAlpha = night;
      ctx.fillStyle = COL.moon;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 18, 0, Math.PI * 2);
      ctx.fill();
      // crater shadow to give it a crescent feel
      ctx.fillStyle = mix('#26405f', COL.skyTop, night);
      ctx.beginPath();
      ctx.arc(moonX + 7, moonY - 3, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawClouds(night) {
    ctx.fillStyle = mix('#9fb4d4', '#2a3550', night);
    for (const c of clouds) {
      const s = c.scale;
      const x = c.x, y = c.y;
      ctx.globalAlpha = 0.5;
      // a few overlapping ellipses make a lumpy cloud
      ctx.beginPath();
      ctx.ellipse(x, y, 26 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 22 * s, y + 4 * s, 20 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 20 * s, y + 5 * s, 16 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawGround(night) {
    // dirt band
    ctx.fillStyle = mix('#4a577a', COL.ground, night);
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    // the crisp ground line
    ctx.strokeStyle = mix('#7c8db5', COL.groundLine, night);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(W, GROUND_Y + 1);
    ctx.stroke();

    // scrolling dashes + little pebbles for a sense of speed
    ctx.fillStyle = mix('#7c8db5', COL.groundLine, night);
    for (let x = -groundScroll; x < W; x += 40) {
      ctx.fillRect(x, GROUND_Y + 10, 14, 2);
      ctx.fillRect(x + 24, GROUND_Y + 24, 5, 2);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = COL.dust;
      const r = 1 + a * 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Obstacles ----------------------------------------------
  function drawObstacles(night) {
    for (const o of obstacles) {
      if (o.type === 'cactus') drawCactus(o, night);
      else drawBird(o, night);
    }
  }

  function drawCactus(o, night) {
    const body = mix('#9ccf95', COL.cactus, night);
    const dark = mix('#6f9c72', COL.cactusDark, night);
    for (let i = 0; i < o.count; i++) {
      const x = o.x + i * (o.stalkW + 4);
      const w = o.stalkW;
      const h = o.h * (0.78 + (i % 2) * 0.22);   // stagger cluster heights
      const y = GROUND_Y - h;
      // trunk
      ctx.fillStyle = body;
      roundRect(x, y, w, h, 4);
      ctx.fill();
      // shaded edge
      ctx.fillStyle = dark;
      roundRect(x + w - 4, y, 4, h, 2);
      ctx.fill();
      // a stubby arm
      const armY = y + h * 0.4;
      ctx.fillStyle = body;
      roundRect(x - 5, armY, 5, 3, 2); ctx.fill();
      roundRect(x - 5, armY - 9, 4, 12, 2); ctx.fill();
      roundRect(x + w, armY - 4, 5, 3, 2); ctx.fill();
      roundRect(x + w + 1, armY - 13, 4, 12, 2); ctx.fill();
    }
  }

  function drawBird(o, night) {
    const body = mix('#d8c7f5', COL.bird, night);
    const dark = mix('#a892d8', COL.birdDark, night);
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const flap = Math.sin(o.flap);   // -1..1 wing position

    // body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, o.w * 0.32, o.h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(cx - o.w * 0.3, cy);
    ctx.lineTo(cx - o.w * 0.5, cy - 3);
    ctx.lineTo(cx - o.w * 0.5, cy + 3);
    ctx.closePath(); ctx.fill();
    // flapping wings (triangles that pivot on flap)
    ctx.fillStyle = body;
    const wy = flap * 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 3);
    ctx.lineTo(cx + o.w * 0.42, cy - 3 - wy);
    ctx.lineTo(cx + o.w * 0.1, cy + 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy + 3);
    ctx.lineTo(cx + o.w * 0.42, cy + 3 + wy);
    ctx.lineTo(cx + o.w * 0.1, cy - 2);
    ctx.closePath(); ctx.fill();
    // eye
    ctx.fillStyle = COL.dinoEye;
    ctx.beginPath();
    ctx.arc(cx - o.w * 0.16, cy - 3, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- The runner ---------------------------------------------
  function drawDino(night) {
    const body = mix('#c2f2d8', COL.dino, night);
    const dark = mix('#7fc9a3', COL.dinoDark, night);
    const ducking = dino.ducking;

    const bx = DINO_X;
    const fullTop = dino.y;
    // When ducking, the body is shorter and lower.
    const h = ducking ? DUCK_H : DINO_H;
    const top = ducking ? GROUND_Y - DUCK_H : fullTop;
    const w = ducking ? DINO_W + 14 : DINO_W;   // stretches forward when ducking

    // shadow on the ground (shrinks as you rise)
    const airT = clamp((GROUND_Y - DINO_H - fullTop) / 120, 0, 1);
    ctx.globalAlpha = 0.28 * (1 - airT * 0.7);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(bx + w * 0.5, GROUND_Y + 2, w * 0.5 * (1 - airT * 0.3), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // --- legs: two-frame run cycle (only animates on the ground) ---
    ctx.fillStyle = dark;
    if (dino.onGround) {
      const frame = Math.floor(dino.runPhase) % 2;   // 0 or 1
      const legY = top + h;
      if (frame === 0) {
        ctx.fillRect(bx + 8, legY, 8, 10);            // front leg down
        ctx.fillRect(bx + w - 18, legY - 4, 8, 8);    // back leg up
      } else {
        ctx.fillRect(bx + 8, legY - 4, 8, 8);         // front leg up
        ctx.fillRect(bx + w - 18, legY, 8, 10);       // back leg down
      }
    } else {
      // tucked legs in the air
      ctx.fillRect(bx + 10, top + h - 2, 9, 7);
      ctx.fillRect(bx + w - 19, top + h - 2, 9, 7);
    }

    // --- body ---
    ctx.fillStyle = body;
    roundRect(bx, top, w, h, 8);
    ctx.fill();

    // belly shading
    ctx.fillStyle = dark;
    roundRect(bx + 3, top + h * 0.55, w - 6, h * 0.4, 6);
    ctx.fill();

    // tail
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(bx + 2, top + h * 0.35);
    ctx.lineTo(bx - 14, top + h * 0.2);
    ctx.lineTo(bx - 8, top + h * 0.6);
    ctx.closePath();
    ctx.fill();

    // --- head ---
    // Ducking lowers and flattens the head onto the front of the body.
    const headW = 22, headH = 18;
    const headX = ducking ? bx + w - headW + 2 : bx + w - 10;
    const headY = ducking ? top - 2 : top - 12;
    ctx.fillStyle = body;
    roundRect(headX, headY, headW, headH, 6);
    ctx.fill();
    // snout
    roundRect(headX + headW - 6, headY + 6, 8, 7, 3);
    ctx.fill();

    // eye (blinks)
    const blinking = dino.blink < 0;
    ctx.fillStyle = COL.dinoEye;
    if (blinking) {
      ctx.fillRect(headX + headW - 11, headY + 6, 4, 1.5);
    } else {
      ctx.beginPath();
      ctx.arc(headX + headW - 9, headY + 6, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // nostril
    ctx.fillRect(headX + headW - 1, headY + 8, 1.5, 1.5);
  }

  // ---- HUD + overlays -----------------------------------------
  function text(str, x, y, size, color, align, weight) {
    ctx.font = `${weight || '700'} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';     // subtle shadow
    ctx.fillText(str, x + 1.5, y + 1.5);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function pad6(n) {
    let s = String(Math.floor(n));
    while (s.length < 5) s = '0' + s;
    return s;
  }

  function drawHUD() {
    text('SCORE', W - 188, 34, 14, COL.hudDim, 'left');
    text(pad6(state.score), W - 132, 34, 20, COL.hud, 'left');
    text('BEST ' + pad6(state.best), W - 188, 56, 13, COL.hudDim, 'left');
  }

  function dim(alpha) {
    ctx.fillStyle = `rgba(6,10,20,${alpha != null ? alpha : 0.55})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    dim(0.5);
    text('DINO RUNNER', W / 2, H * 0.4, 46, '#eaf2ff', 'center');
    text('Press SPACE / ↑ to run', W / 2, H * 0.55, 20, COL.sun, 'center');
    text('↑ / Space jump (hold = higher)   ·   ↓ duck under birds', W / 2, H * 0.68, 14, COL.accent, 'center');
  }

  function drawGameOver() {
    dim(0.55);
    text('GAME OVER', W / 2, H * 0.36, 46, COL.warn, 'center');
    text('Score ' + Math.floor(state.score) + '   ·   Best ' + state.best, W / 2, H * 0.52, 20, '#eaf2ff', 'center');
    text('Press SPACE / ↑ to run again', W / 2, H * 0.66, 18, COL.sun, 'center');
  }

  // small rounded-rect path helper (path only; caller fills/strokes)
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Main loop (delta-time, clamped) ------------------------
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;     // clamp so a tab-switch can't teleport anything
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ---------------------------------------------------
  requestAnimationFrame(frame);
})();
