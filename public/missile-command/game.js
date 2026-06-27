// ============================================================
//  MISSILE COMMAND  —  classic arcade defense, pure canvas + vanilla JS
//  Runs straight from file:// (no modules, no fetch, no build step).
//  Everything is drawn procedurally; audio is WebAudio-only, lazy-started.
//
//  You defend 6 cities along the bottom. Enemy missiles streak down from
//  the top. Aim with the mouse and CLICK to launch an interceptor from the
//  nearest ammo base; it flies to the cursor and bursts into an expanding
//  blast ring that destroys any enemy missile it touches. Limited ammo per
//  base (refills each wave). Waves escalate; later ones split into MIRVs.
// ============================================================
(() => {
  'use strict';

  // ---- Canvas + context ------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // internal resolution: 760 x 560
  const H = canvas.height;

  const GROUND_Y = H - 34;  // top of the ground strip where cities sit

  // ---- Tunables (tweak these to change the feel) -----------
  const CITY_COUNT      = 6;     // cities to defend
  const BASE_AMMO       = 10;    // interceptors per base, per wave
  const INTERCEPT_SPEED = 620;   // px/sec — speed of OUR missiles
  const BLAST_MAX_R     = 46;    // radius an explosion grows to
  const BLAST_GROW      = 150;   // px/sec the blast radius expands
  const BLAST_HOLD      = 0.12;  // seconds the blast lingers at max size
  const BLAST_FADE      = 110;   // px/sec the blast shrinks while fading
  const ENEMY_BASE_SPD  = 38;    // px/sec downward speed of wave 1 missiles
  const ENEMY_SPD_STEP  = 7;     // extra px/sec per wave
  const SCORE_PER_KILL  = 25;    // points for shooting an enemy missile
  const CITY_BONUS      = 100;   // end-of-wave bonus per surviving city
  const AMMO_BONUS      = 5;     // end-of-wave bonus per leftover interceptor
  const WAVE_BANNER_T   = 2.0;   // seconds the "WAVE N" banner shows

  // Layout: 3 ammo bases interleaved with the cities along the bottom.
  // Positions are computed once at load so the title screen can draw them.
  const BASE_COUNT = 3;

  // ---- High score (localStorage, guarded) ------------------
  const HS_KEY = 'missilecommand.best';
  function loadBest() {
    try { return parseInt(localStorage.getItem(HS_KEY), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(HS_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ============================================================
  //  AUDIO  —  built entirely in code, started on first user input.
  //  Wrapped so a missing/blocked AudioContext can never break play.
  // ============================================================
  const Sound = (() => {
    let ac = null;
    let ok = false;
    let alarmOsc = null, alarmGain = null, alarmLfo = null;

    function init() {
      if (ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        ok = true;
      } catch (e) { ok = false; }
    }
    function resume() {
      try { if (ac && ac.state === 'suspended') ac.resume(); } catch (e) {}
    }

    // A short tonal blip with a pitch slide — used for launches.
    function blip(f0, f1, dur, type, vol) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
        g.gain.setValueAtTime(vol || 0.10, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(ac.destination);
        osc.start(t);
        osc.stop(t + dur);
      } catch (e) {}
    }

    // Filtered white-noise burst — chunky explosion "boom".
    function boom(dur, vol, lowpass) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const frames = Math.floor(ac.sampleRate * dur);
        const buf = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
          // decaying noise
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const filt = ac.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(lowpass || 900, t);
        filt.frequency.exponentialRampToValueAtTime(120, t + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(vol || 0.22, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filt).connect(g).connect(ac.destination);
        src.start(t);
        src.stop(t + dur);
      } catch (e) {}
    }

    // Sound effects exposed to the game --------------------------------
    function launch()      { blip(660, 180, 0.22, 'square', 0.09); }   // our missile away
    function explode()     { boom(0.45, 0.26, 1100); }                 // a blast detonates
    function cityHit()     { boom(0.7, 0.32, 700); blip(180, 60, 0.5, 'sawtooth', 0.12); }
    function emptyClick()  { blip(150, 120, 0.06, 'sine', 0.05); }     // out of ammo
    function waveClear()   {                                           // little victory arpeggio
      blip(523, 523, 0.12, 'triangle', 0.10);
      setTimeout(() => blip(659, 659, 0.12, 'triangle', 0.10), 110);
      setTimeout(() => blip(784, 784, 0.18, 'triangle', 0.10), 220);
    }

    // A looping low "incoming" alarm while enemies are on screen.
    function alarmOn() {
      if (!ok || alarmOsc) return;
      try {
        const t = ac.currentTime;
        alarmOsc = ac.createOscillator();
        alarmGain = ac.createGain();
        alarmLfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        alarmOsc.type = 'sawtooth';
        alarmOsc.frequency.value = 110;
        alarmLfo.type = 'sine';
        alarmLfo.frequency.value = 5;     // wobble rate
        lfoGain.gain.value = 22;          // wobble depth (Hz)
        alarmLfo.connect(lfoGain).connect(alarmOsc.frequency);
        alarmGain.gain.setValueAtTime(0.0001, t);
        alarmGain.gain.linearRampToValueAtTime(0.035, t + 0.4);
        alarmOsc.connect(alarmGain).connect(ac.destination);
        alarmOsc.start(t);
        alarmLfo.start(t);
      } catch (e) { alarmOsc = null; }
    }
    function alarmOff() {
      if (!ok || !alarmOsc) return;
      try {
        const t = ac.currentTime;
        alarmGain.gain.cancelScheduledValues(t);
        alarmGain.gain.setValueAtTime(alarmGain.gain.value, t);
        alarmGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        alarmOsc.stop(t + 0.3);
        alarmLfo.stop(t + 0.3);
      } catch (e) {}
      alarmOsc = null; alarmGain = null; alarmLfo = null;
    }

    return { init, resume, launch, explode, cityHit, emptyClick, waveClear, alarmOn, alarmOff };
  })();

  // ============================================================
  //  GAME STATE  —  EVERY field initialized at LOAD so the title and
  //  game-over screens can safely run update() + render() without ever
  //  reading an undefined value. (House rule #1.)
  // ============================================================
  const STATE = { TITLE: 0, PLAYING: 1, WAVE_CLEAR: 2, GAMEOVER: 3 };

  let gameState   = STATE.TITLE;
  let score       = 0;
  let best        = loadBest();
  let wave        = 1;
  let mouseX      = W / 2;        // crosshair position (valid from the start)
  let mouseY      = H / 2;
  let shake       = 0;            // screen-shake magnitude, decays over time
  let bannerTimer = 0;            // counts down the "WAVE N" banner
  let waveClearT  = 0;            // pause timer between waves (bonus tally)
  let titlePulse  = 0;            // animates the title prompt
  let pendingBonus = 0;           // bonus being tallied during WAVE_CLEAR

  // Entity arrays — start EMPTY (never undefined).
  let cities       = [];   // {x, alive}
  let bases        = [];   // {x, ammo}
  let enemies      = [];   // incoming enemy missiles
  let interceptors = [];   // our friendly missiles in flight
  let blasts       = [];   // expanding explosion rings
  let particles    = [];   // debris / sparks
  let stars        = [];   // background starfield

  // Wave spawn bookkeeping
  let toSpawn      = 0;    // enemy missiles left to release this wave
  let spawnTimer   = 0;    // countdown to next spawn

  // ---- Build the static city + base layout -----------------
  // 6 cities + 3 bases sit on the ground. Bases go at the far-left,
  // center, and far-right; cities fill 3 + 3 around the center base.
  function buildLayout() {
    cities = [];
    bases = [];
    const margin = 60;
    const usable = W - margin * 2;

    // Base x-positions: left, center, right.
    const baseXs = [margin, W / 2, W - margin];
    for (let i = 0; i < BASE_COUNT; i++) {
      bases.push({ x: baseXs[i], ammo: BASE_AMMO });
    }

    // Cities: 3 between left & center base, 3 between center & right base.
    const leftSeg = (W / 2 - margin);
    const rightSeg = (W - margin) - W / 2;
    for (let i = 0; i < 3; i++) {
      const x = margin + leftSeg * ((i + 1) / 4);
      cities.push({ x: x, alive: true });
    }
    for (let i = 0; i < 3; i++) {
      const x = W / 2 + rightSeg * ((i + 1) / 4);
      cities.push({ x: x, alive: true });
    }
    void usable;
  }

  // ---- Starfield (static twinkle behind everything) --------
  function buildStars() {
    stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (GROUND_Y - 20),
        r: Math.random() * 1.3 + 0.3,
        tw: Math.random() * Math.PI * 2,   // twinkle phase
      });
    }
  }

  // ---- Reset for a fresh game ------------------------------
  function resetGame() {
    score = 0;
    wave = 1;
    shake = 0;
    pendingBonus = 0;
    enemies = [];
    interceptors = [];
    blasts = [];
    particles = [];
    buildLayout();
    startWave();
  }

  // ---- Begin a wave: refill ammo, schedule enemy spawns ----
  function startWave() {
    // Refill every base to full each wave (classic-ish; rewards survival).
    for (const b of bases) b.ammo = BASE_AMMO;

    // Escalation: more missiles and faster each wave.
    toSpawn = Math.min(8 + wave * 3, 34);
    spawnTimer = 0.6;
    bannerTimer = WAVE_BANNER_T;
    gameState = STATE.PLAYING;
  }

  // ---- Spawn one enemy missile from the top edge -----------
  // It targets a random surviving city or base. Later waves it may be a
  // MIRV that splits into 2–3 warheads partway down.
  function spawnEnemy(splitsLeft, fromX, fromY) {
    const targets = [];
    for (const c of cities) if (c.alive) targets.push(c.x);
    for (const b of bases) targets.push(b.x);
    if (targets.length === 0) targets.push(W / 2);

    const tx = targets[(Math.random() * targets.length) | 0] + (Math.random() * 40 - 20);
    const ty = GROUND_Y;
    const sx = (fromX != null) ? fromX : Math.random() * W;
    const sy = (fromY != null) ? fromY : -10;

    const speed = ENEMY_BASE_SPD + (wave - 1) * ENEMY_SPD_STEP + Math.random() * 14;
    const dx = tx - sx, dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;

    // MIRV chance scales with wave; only "fresh" top missiles can split.
    let canSplit = false, splitAtY = 0;
    if (splitsLeft == null) {
      const mirvChance = Math.min(0.05 + (wave - 3) * 0.07, 0.45);
      if (wave >= 4 && Math.random() < mirvChance) {
        canSplit = true;
        splitAtY = GROUND_Y * (0.32 + Math.random() * 0.18);
      }
      splitsLeft = canSplit ? (2 + ((Math.random() * 2) | 0)) : 0;
    }

    enemies.push({
      x: sx, y: sy,
      sx: sx, sy: sy,            // origin (for drawing the trail)
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      tx: tx, ty: ty,
      canSplit: canSplit,
      splitAtY: splitAtY,
      splitsLeft: splitsLeft,
      trail: [],
    });
  }

  // ---- Fire an interceptor toward (gx, gy) from nearest base
  function fireInterceptor(gx, gy) {
    if (gameState !== STATE.PLAYING) return;
    // Don't fire into the ground or below it.
    if (gy >= GROUND_Y - 4) gy = GROUND_Y - 4;

    // Pick the nearest base that still has ammo.
    let best = -1, bestD = Infinity;
    for (let i = 0; i < bases.length; i++) {
      if (bases[i].ammo <= 0) continue;
      const d = Math.abs(bases[i].x - gx);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) { Sound.emptyClick(); return; }   // all dry

    const b = bases[best];
    b.ammo--;

    const sx = b.x, sy = GROUND_Y - 6;
    const dx = gx - sx, dy = gy - sy;
    const len = Math.hypot(dx, dy) || 1;
    interceptors.push({
      x: sx, y: sy,
      sx: sx, sy: sy,
      vx: (dx / len) * INTERCEPT_SPEED,
      vy: (dy / len) * INTERCEPT_SPEED,
      tx: gx, ty: gy,
      trail: [],
    });
    Sound.launch();
  }

  // ---- Spawn an explosion blast at (x,y) -------------------
  function spawnBlast(x, y, friendly) {
    blasts.push({
      x: x, y: y,
      r: 2,
      phase: 0,            // 0 grow, 1 hold, 2 fade
      hold: BLAST_HOLD,
      friendly: !!friendly,
      hue: friendly ? 190 : 30,   // bluish for ours, orange for enemy
    });
    Sound.explode();
    spawnSparks(x, y, friendly ? '#bdf0ff' : '#ffd089', 10);
  }

  // ---- Particle bursts (sparks / debris) -------------------
  function spawnSparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 140;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        color: color,
        size: 1 + Math.random() * 2,
        grav: 120,
      });
    }
  }

  // ============================================================
  //  INPUT
  // ============================================================
  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = pointerToCanvas(e.clientX, e.clientY);
    mouseX = p.x; mouseY = p.y;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    Sound.init(); Sound.resume();
    const p = pointerToCanvas(e.clientX, e.clientY);
    mouseX = p.x; mouseY = p.y;

    if (gameState === STATE.TITLE)        { resetGame(); return; }   // a click also starts
    if (gameState === STATE.GAMEOVER)     { resetGame(); return; }
    if (gameState === STATE.PLAYING)      { fireInterceptor(mouseX, mouseY); }
  });

  // Touch: aim + fire (works on mobile / touchscreens too).
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    Sound.init(); Sound.resume();
    const t = e.changedTouches[0];
    const p = pointerToCanvas(t.clientX, t.clientY);
    mouseX = p.x; mouseY = p.y;
    if (gameState === STATE.PLAYING) fireInterceptor(mouseX, mouseY);
    else resetGame();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const p = pointerToCanvas(t.clientX, t.clientY);
    mouseX = p.x; mouseY = p.y;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter' ||
        e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      Sound.init(); Sound.resume();
      if (gameState === STATE.TITLE || gameState === STATE.GAMEOVER) {
        resetGame();
      }
    }
  });

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    titlePulse += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    // Twinkle the stars in every state.
    for (const s of stars) s.tw += dt * 2;

    // Particles update in every state (debris keeps settling).
    updateParticles(dt);
    updateBlasts(dt);

    if (gameState === STATE.PLAYING) {
      if (bannerTimer > 0) bannerTimer -= dt;
      updatePlaying(dt);
    } else if (gameState === STATE.WAVE_CLEAR) {
      updateWaveClear(dt);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      if (b.phase === 0) {                 // growing
        b.r += BLAST_GROW * dt;
        if (b.r >= BLAST_MAX_R) { b.r = BLAST_MAX_R; b.phase = 1; }
      } else if (b.phase === 1) {          // holding at full size
        b.hold -= dt;
        if (b.hold <= 0) b.phase = 2;
      } else {                             // fading / shrinking
        b.r -= BLAST_FADE * dt;
        if (b.r <= 0) { blasts.splice(i, 1); }
      }
    }
  }

  function updatePlaying(dt) {
    // --- Release enemy missiles over the course of the wave ---
    if (toSpawn > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy(null, null, null);
        toSpawn--;
        // Faster trickle as waves climb; small random jitter for variety.
        const base = Math.max(0.35, 1.5 - wave * 0.08);
        spawnTimer = base * (0.6 + Math.random() * 0.8);
      }
    }

    // --- Alarm on whenever enemies are airborne ---
    if (enemies.length > 0) Sound.alarmOn(); else Sound.alarmOff();

    // --- Move our interceptors; detonate when they reach target ---
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const m = interceptors[i];
      const remaining = Math.hypot(m.tx - m.x, m.ty - m.y);
      const step = INTERCEPT_SPEED * dt;
      pushTrail(m, 14);
      if (remaining <= step) {
        spawnBlast(m.tx, m.ty, true);
        interceptors.splice(i, 1);
      } else {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
      }
    }

    // --- Move enemy missiles; handle MIRV splits + ground impact ---
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      pushTrail(en, 22);
      en.x += en.vx * dt;
      en.y += en.vy * dt;

      // MIRV: split into a fan of warheads on the way down.
      if (en.canSplit && en.y >= en.splitAtY) {
        en.canSplit = false;
        const kids = en.splitsLeft;
        for (let k = 0; k < kids; k++) {
          spawnEnemy(0, en.x, en.y);
        }
        spawnSparks(en.x, en.y, '#ff9a6a', 6);
        enemies.splice(i, 1);
        continue;
      }

      // Reached the ground? Hit whatever is there.
      if (en.y >= en.ty || en.y >= GROUND_Y) {
        impactGround(en.x, en.ty);
        enemies.splice(i, 1);
      }
    }

    // --- Blast vs enemy collisions (chain reactions) ---
    for (let bi = 0; bi < blasts.length; bi++) {
      const b = blasts[bi];
      const rr = b.r * b.r;
      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const en = enemies[ei];
        const dx = en.x - b.x, dy = en.y - b.y;
        if (dx * dx + dy * dy <= rr) {
          // Boom — score it, spawn a fresh blast at the kill (chain!).
          score += SCORE_PER_KILL;
          spawnBlast(en.x, en.y, true);
          spawnSparks(en.x, en.y, '#ffd089', 8);
          enemies.splice(ei, 1);
        }
      }
    }

    // --- Wave finished? (all spawned and none airborne) ---
    if (toSpawn === 0 && enemies.length === 0 && interceptors.length === 0) {
      // No cities left means it's actually game over (checked below first),
      // otherwise tally bonuses and advance.
      if (aliveCities() > 0) {
        beginWaveClear();
      }
    }

    // --- Lose condition: all cities gone ---
    if (aliveCities() === 0) {
      endGame();
    }
  }

  function updateWaveClear(dt) {
    waveClearT -= dt;
    // Drip the bonus into the score for a satisfying tally.
    if (pendingBonus > 0) {
      const inc = Math.min(pendingBonus, Math.ceil(420 * dt));
      pendingBonus -= inc;
      score += inc;
    }
    if (waveClearT <= 0 && pendingBonus <= 0) {
      wave++;
      startWave();
    }
  }

  function beginWaveClear() {
    Sound.alarmOff();
    Sound.waveClear();
    // Bonus: surviving cities + leftover interceptors across all bases.
    let ammoLeft = 0;
    for (const b of bases) ammoLeft += b.ammo;
    pendingBonus = aliveCities() * CITY_BONUS + ammoLeft * AMMO_BONUS;
    waveClearT = 2.4;
    gameState = STATE.WAVE_CLEAR;
  }

  function impactGround(x, y) {
    // Big ground blast, screen-shake, and destroy the nearest city if close.
    spawnBlast(x, y, false);
    spawnSparks(x, y, '#ff7a4a', 16);
    shake = Math.min(14, shake + 9);

    let hitCity = -1, bestD = 30;   // a city is destroyed within ~30px
    for (let i = 0; i < cities.length; i++) {
      if (!cities[i].alive) continue;
      const d = Math.abs(cities[i].x - x);
      if (d < bestD) { bestD = d; hitCity = i; }
    }
    if (hitCity >= 0) {
      cities[hitCity].alive = false;
      Sound.cityHit();
      spawnSparks(cities[hitCity].x, GROUND_Y - 6, '#ff9a6a', 26);
      shake = Math.min(18, shake + 6);
    }
  }

  function aliveCities() {
    let n = 0;
    for (const c of cities) if (c.alive) n++;
    return n;
  }

  function endGame() {
    if (gameState === STATE.GAMEOVER) return;
    Sound.alarmOff();
    if (score > best) { best = score; saveBest(best); }
    if (window.Arcade) Arcade.submitScore('missile-command', score);  // raw points
    gameState = STATE.GAMEOVER;
  }

  // Keep a short position history on a missile for drawing its trail.
  function pushTrail(m, maxLen) {
    m.trail.push(m.x, m.y);
    while (m.trail.length > maxLen * 2) { m.trail.shift(); m.trail.shift(); }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    ctx.save();

    // Screen-shake: jitter the whole frame a touch.
    if (shake > 0) {
      const dx = (Math.random() * 2 - 1) * shake;
      const dy = (Math.random() * 2 - 1) * shake;
      ctx.translate(dx, dy);
    }

    // Background (slightly larger than canvas to cover shake offset).
    ctx.fillStyle = '#05060a';
    ctx.fillRect(-20, -20, W + 40, H + 40);

    drawStars();
    drawGround();
    drawCities();
    drawBases();
    drawEnemies();
    drawInterceptors();
    drawBlasts();
    drawParticles();
    drawCrosshair();

    ctx.restore();   // end shake transform before HUD (HUD stays steady)

    drawHUD();

    if (gameState === STATE.TITLE)      drawTitle();
    if (gameState === STATE.WAVE_CLEAR) drawWaveClear();
    if (gameState === STATE.GAMEOVER)   drawGameOver();
    if (gameState === STATE.PLAYING && bannerTimer > 0) drawWaveBanner();
  }

  function drawStars() {
    for (const s of stars) {
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#9fb4d4';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawGround() {
    // Ground strip with a subtle top highlight.
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#243046');
    g.addColorStop(1, '#10151f');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = 'rgba(159,180,212,0.5)';
    ctx.fillRect(0, GROUND_Y, W, 2);
  }

  function drawCities() {
    for (const c of cities) {
      if (c.alive) drawCity(c.x, GROUND_Y, false);
      else         drawRubble(c.x, GROUND_Y);
    }
  }

  // A little procedural city: a cluster of glowing buildings.
  function drawCity(x, baseY, ghost) {
    const heights = [10, 18, 14, 22, 12, 16];
    const widths  = [6, 7, 6, 8, 6, 7];
    let bx = x - 19;
    ctx.save();
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      const w = widths[i];
      ctx.fillStyle = ghost ? 'rgba(120,170,210,0.25)' : '#5fa8d8';
      ctx.shadowColor = 'rgba(95,168,216,0.7)';
      ctx.shadowBlur = ghost ? 0 : 8;
      ctx.fillRect(bx, baseY - h, w, h);
      // lit windows
      if (!ghost) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(190,230,255,0.85)';
        for (let wy = baseY - h + 3; wy < baseY - 2; wy += 5) {
          ctx.fillRect(bx + 1, wy, 2, 2);
          if (w > 6) ctx.fillRect(bx + w - 3, wy, 2, 2);
        }
      }
      bx += w + 1;
    }
    ctx.restore();
  }

  // Smouldering rubble where a city used to be.
  function drawRubble(x, baseY) {
    ctx.save();
    ctx.fillStyle = '#3a2418';
    let bx = x - 18;
    const lumps = [4, 6, 3, 5, 4, 5];
    for (let i = 0; i < lumps.length; i++) {
      ctx.fillRect(bx, baseY - lumps[i], 6, lumps[i]);
      bx += 6;
    }
    // faint ember glow
    ctx.fillStyle = 'rgba(255,90,40,0.18)';
    ctx.beginPath();
    ctx.arc(x, baseY - 2, 16, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  // Ammo base: a triangular bunker with a stack of interceptor pips.
  function drawBases() {
    for (const b of bases) {
      const x = b.x, y = GROUND_Y;
      const dead = aliveCities() === 0;
      ctx.save();
      ctx.fillStyle = dead ? '#444' : '#7fd0a0';
      ctx.shadowColor = 'rgba(127,208,160,0.6)';
      ctx.shadowBlur = dead ? 0 : 8;
      ctx.beginPath();
      ctx.moveTo(x - 16, y);
      ctx.lineTo(x + 16, y);
      ctx.lineTo(x, y - 16);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Ammo readout: stacked pips above the base.
      const cols = 5;
      for (let a = 0; a < b.ammo; a++) {
        const col = a % cols;
        const row = (a / cols) | 0;
        const px = x - 8 + col * 4;
        const py = y - 22 - row * 4;
        ctx.fillStyle = '#e8fff2';
        ctx.fillRect(px, py, 2.5, 2.5);
      }
      // "empty" marker
      if (b.ammo === 0) {
        ctx.fillStyle = '#ff6a6a';
        ctx.font = 'bold 9px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('OUT', x, y - 22);
      }
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const en of enemies) {
      // Trail
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      strokeTrail(en, 'rgba(255,110,80,0.85)', 'rgba(255,60,40,0.05)');
      // Head — a hot point with glow.
      ctx.save();
      ctx.shadowColor = '#ff5a30';
      ctx.shadowBlur = 10;
      ctx.fillStyle = en.canSplit ? '#ffd24a' : '#ff8a5a';
      ctx.beginPath();
      ctx.arc(en.x, en.y, en.canSplit ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawInterceptors() {
    for (const m of interceptors) {
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      strokeTrail(m, 'rgba(150,225,255,0.95)', 'rgba(120,200,255,0.05)');
      // Target marker (small X where it's headed).
      ctx.strokeStyle = 'rgba(150,225,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.tx - 4, m.ty - 4); ctx.lineTo(m.tx + 4, m.ty + 4);
      ctx.moveTo(m.tx + 4, m.ty - 4); ctx.lineTo(m.tx - 4, m.ty + 4);
      ctx.stroke();
      // Head
      ctx.save();
      ctx.shadowColor = '#9fe1ff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#dffaff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw a missile trail as a fading polyline from origin to head.
  function strokeTrail(m, headColor, tailColor) {
    const t = m.trail;
    if (t.length >= 4) {
      const grad = ctx.createLinearGradient(t[0], t[1], m.x, m.y);
      grad.addColorStop(0, tailColor);
      grad.addColorStop(1, headColor);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(t[0], t[1]);
      for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    } else {
      // Fallback: straight line from origin so a fresh missile still shows.
      ctx.strokeStyle = headColor;
      ctx.beginPath();
      ctx.moveTo(m.sx, m.sy);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    }
  }

  function drawBlasts() {
    for (const b of blasts) {
      const light = 60 + (b.phase === 1 ? 18 : 0);
      // Filled glow
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, b.r));
      grad.addColorStop(0, 'hsla(' + b.hue + ',100%,80%,0.95)');
      grad.addColorStop(0.5, 'hsla(' + b.hue + ',100%,' + light + '%,0.55)');
      grad.addColorStop(1, 'hsla(' + b.hue + ',100%,50%,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, b.r), 0, Math.PI * 2);
      ctx.fill();
      // Crisp ring
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'hsla(' + b.hue + ',100%,85%,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, b.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawCrosshair() {
    if (gameState !== STATE.PLAYING) return;
    const x = mouseX, y = mouseY;
    ctx.save();
    ctx.strokeStyle = 'rgba(159,225,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y);  ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4);  ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159,225,255,0.9)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.restore();
  }

  // ---- HUD: score, best, wave, cities --------------------
  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + score, 14, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('BEST ' + best, W - 14, 24);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#cdd6e4';
    ctx.fillText('WAVE ' + wave, W / 2, 24);

    // Cities-remaining indicator (small dots, top-center under wave).
    const n = aliveCities();
    const dotW = 10;
    const totalW = CITY_COUNT * dotW;
    let dx = W / 2 - totalW / 2 + dotW / 2;
    for (let i = 0; i < CITY_COUNT; i++) {
      ctx.beginPath();
      ctx.fillStyle = i < n ? '#5fa8d8' : 'rgba(120,140,170,0.3)';
      ctx.arc(dx, 38, 3, 0, Math.PI * 2);
      ctx.fill();
      dx += dotW;
    }
    ctx.restore();
  }

  // ---- Overlay screens -----------------------------------
  function dimScreen(alpha) {
    ctx.fillStyle = 'rgba(5,6,10,' + alpha + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    dimScreen(0.55);
    ctx.save();
    ctx.textAlign = 'center';

    ctx.fillStyle = '#9fb4d4';
    ctx.font = '600 40px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(95,168,216,0.6)';
    ctx.shadowBlur = 18;
    ctx.fillText('MISSILE COMMAND', W / 2, H / 2 - 56);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Defend your cities. Aim with the mouse,', W / 2, H / 2 - 16);
    ctx.fillText('click to launch an interceptor and detonate it on the incoming.', W / 2, H / 2 + 6);

    // Pulsing prompt.
    const pulse = 0.55 + 0.45 * Math.sin(titlePulse * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#9fe1ff';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Press  SPACE / ENTER  or CLICK to start', W / 2, H / 2 + 48);
    ctx.globalAlpha = 1;

    if (best > 0) {
      ctx.fillStyle = '#6b7890';
      ctx.font = '13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Best  ' + best, W / 2, H / 2 + 78);
    }
    ctx.restore();
  }

  function drawWaveBanner() {
    // Slides/fades a "WAVE N" banner at the top of the wave.
    const t = bannerTimer / WAVE_BANNER_T;       // 1 -> 0
    const a = Math.min(1, t * 1.6);              // fade out near the end
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fe1ff';
    ctx.shadowColor = 'rgba(95,168,216,0.6)';
    ctx.shadowBlur = 16;
    ctx.font = '600 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WAVE ' + wave, W / 2, H / 2 - 70);
    ctx.restore();
  }

  function drawWaveClear() {
    dimScreen(0.45);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7fd0a0';
    ctx.shadowColor = 'rgba(127,208,160,0.5)';
    ctx.shadowBlur = 14;
    ctx.font = '600 32px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WAVE ' + wave + ' CLEARED', W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    let ammoLeft = 0;
    for (const b of bases) ammoLeft += b.ammo;
    ctx.fillText(aliveCities() + ' cities  +  ' + ammoLeft + ' interceptors  =  bonus', W / 2, H / 2 + 6);

    ctx.fillStyle = '#9fe1ff';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Next wave incoming...', W / 2, H / 2 + 40);
    ctx.restore();
  }

  function drawGameOver() {
    dimScreen(0.6);
    ctx.save();
    ctx.textAlign = 'center';

    ctx.fillStyle = '#ff7a6a';
    ctx.shadowColor = 'rgba(255,90,60,0.5)';
    ctx.shadowBlur = 16;
    ctx.font = '600 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('THE END', W / 2, H / 2 - 44);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('All cities destroyed', W / 2, H / 2 - 12);

    ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('Score  ' + score, W / 2, H / 2 + 18);
    if (score >= best && score > 0) {
      ctx.fillStyle = '#9fe1ff';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('NEW BEST!', W / 2, H / 2 + 40);
    } else {
      ctx.fillStyle = '#6b7890';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Best  ' + best, W / 2, H / 2 + 40);
    }

    const pulse = 0.55 + 0.45 * Math.sin(titlePulse * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#9fe1ff';
    ctx.font = '600 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Press  SPACE / ENTER  or CLICK to play again', W / 2, H / 2 + 74);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ============================================================
  //  MAIN LOOP  —  requestAnimationFrame with clamped delta-time.
  // ============================================================
  let lastT = performance.now();
  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    // Clamp so a tab-switch / long pause can't teleport everything.
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot: build static state so the TITLE screen is fully drawn ----
  buildStars();
  buildLayout();
  requestAnimationFrame(frame);
})();
