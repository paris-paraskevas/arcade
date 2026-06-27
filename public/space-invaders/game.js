// ============================================================
//  SPACE INVADERS  —  pure HTML5 canvas + vanilla JS
//  Runs straight from file:// (no modules, no fetch, no build).
//  Everything is drawn procedurally; audio is WebAudio-only and
//  is created lazily on the first key press.
//
//  Classic tension: a formation of aliens marches side to side,
//  steps down + reverses at the edges, and SPEEDS UP as you thin
//  the swarm. They drop bombs; you have shields and 3 lives.
// ============================================================
(() => {
  'use strict';

  // ---- Canvas + context ------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // internal resolution: 700 x 600
  const H = canvas.height;

  // ============================================================
  //  TUNABLES  (tweak these to change the feel)
  // ============================================================
  const COLS = 11;           // aliens per row
  const ROWS = 5;            // rows of aliens
  const ALIEN_W = 30;        // alien collision/draw width
  const ALIEN_H = 22;        // alien collision/draw height
  const CELL_W = 46;         // horizontal spacing between alien centres
  const CELL_H = 38;         // vertical spacing between alien centres
  const FORMATION_TOP = 96;  // y of the top row at wave 1 (drops each wave)
  const STEP_DOWN = 24;      // px the swarm drops when it hits an edge
  const EDGE_PAD = 24;       // keep the formation this far from the walls

  const PLAYER_W = 44;
  const PLAYER_H = 18;
  const PLAYER_Y = H - 54;   // fixed vertical position of the ship
  const PLAYER_SPEED = 300;  // px/sec
  const PLAYER_BULLET_SPEED = 620;
  const MAX_PLAYER_BULLETS = 1; // classic single-shot feel (raise for easier)
  const FIRE_COOLDOWN = 0.0;    // extra delay after a shot leaves the screen

  const BOMB_SPEED = 200;       // px/sec falling bombs
  const BASE_BOMB_CHANCE = 0.6; // bombs/sec at wave start (scaled by wave)

  const START_LIVES = 3;

  // Per-row score: the back (top) rows are worth more — classic.
  // Row 0 is the top row. Five rows -> [30,20,20,10,10].
  const ROW_SCORE = [30, 20, 20, 10, 10];

  // Bonus UFO that occasionally slides across the top.
  const UFO_Y = 56;
  const UFO_W = 40;
  const UFO_H = 16;
  const UFO_SPEED = 150;
  const UFO_SCORES = [50, 100, 150, 200, 300];
  const UFO_MIN_GAP = 9;   // seconds (min) between UFO appearances
  const UFO_MAX_GAP = 18;  // seconds (max)

  // ---- High score (localStorage, guarded) ------------------
  const HS_KEY = 'spaceinvaders.best';
  function loadBest() {
    try { return parseInt(localStorage.getItem(HS_KEY), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(HS_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ============================================================
  //  AUDIO  —  built entirely in code, started on first input.
  //  Every call is wrapped so a blocked/missing AudioContext can
  //  NEVER break the game.
  // ============================================================
  const Sound = (() => {
    let ac = null;
    let ok = false;

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

    // A short tone with an exponential pitch slide.
    function tone(f0, f1, dur, type, vol) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(ac.destination);
        osc.start(t);
        osc.stop(t + dur);
      } catch (e) {}
    }

    // Filtered white-noise burst for explosions / hits.
    function noise(dur, vol, cutoff) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
        const buf = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(cutoff || 1200, t);
        lp.frequency.exponentialRampToValueAtTime(180, t + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(vol || 0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(lp).connect(g).connect(ac.destination);
        src.start(t);
        src.stop(t + dur);
      } catch (e) {}
    }

    // The iconic four-note descending march; we cycle the index.
    const marchNotes = [196.0, 174.6, 155.6, 146.8]; // G3 F3 D#3 D3-ish
    return {
      init() { init(); },
      resume,
      shoot()  { resume(); tone(880, 520, 0.12, 'square', 0.10); },
      hit()    { resume(); noise(0.18, 0.22, 1500); },           // alien killed
      bomb()   { resume(); tone(220, 90, 0.16, 'sawtooth', 0.06); }, // bomb dropped
      ufo()    { resume(); tone(660, 760, 0.10, 'triangle', 0.07); }, // UFO bonus
      playerHit() { resume(); noise(0.6, 0.4, 900); tone(160, 50, 0.5, 'sawtooth', 0.18); },
      march(step) { resume(); tone(marchNotes[step % 4], marchNotes[step % 4] * 0.96, 0.08, 'square', 0.10); },
    };
  })();

  // ============================================================
  //  INPUT  (key edges + held state)
  // ============================================================
  const keys = Object.create(null);
  const LEFT_CODES  = { ArrowLeft: 1, KeyA: 1 };
  const RIGHT_CODES = { ArrowRight: 1, KeyD: 1 };
  const FIRE_CODES  = { Space: 1 };
  const START_CODES = { Space: 1, Enter: 1, NumpadEnter: 1 };

  window.addEventListener('keydown', (e) => {
    // First interaction wakes the audio engine (autoplay policies).
    Sound.init(); Sound.resume();

    // Stop the page scrolling on arrows / space.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();

    if (!keys[e.code]) onKeyDown(e.code); // fire only on the press edge
    keys[e.code] = true;
  }, { passive: false });

  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  // Losing focus shouldn't leave a key stuck "down".
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ============================================================
  //  GAME STATE
  //  IMPORTANT: every variable that update()/render() reads is
  //  initialised to a valid value HERE, at load — so the title and
  //  game-over screens never touch undefined. resetGame() only
  //  re-seeds for a fresh run.
  // ============================================================
  const STATE = { TITLE: 0, PLAY: 1, OVER: 2, WIN_PAUSE: 3 };
  let state = STATE.TITLE;

  let player = makePlayer();
  let aliens = [];          // {col,row,x,y,alive}
  let bullets = [];         // player shots {x,y}
  let bombs = [];           // alien shots {x,y,kind}
  let shields = [];         // destructible bunkers -> grid of blocks
  let particles = [];       // explosion debris
  let ufo = null;           // active bonus saucer or null

  let score = 0;
  let best = loadBest();
  let lives = START_LIVES;
  let wave = 1;

  // Formation movement bookkeeping.
  let dir = 1;              // +1 moving right, -1 moving left
  let formTop = FORMATION_TOP; // current top-row y for this wave
  let pendingDrop = false;  // marks "step down + reverse next frame"
  let marchTimer = 0;       // counts down to the next horizontal step
  let marchStep = 0;        // 0..3, drives the two-frame animation + sound
  let animFrame = 0;        // 0/1 — which procedural alien pose to draw

  let fireTimer = 0;        // optional cooldown after a shot
  let bombTimer = 0;        // counts down to the next bomb roll
  let ufoTimer = randRange(UFO_MIN_GAP, UFO_MAX_GAP); // until next saucer
  let ufoScoreFlash = null; // {x,y,val,t} floating points after a UFO kill

  let shake = 0;            // screen-shake magnitude
  let respawnTimer = 0;     // brief pause + invuln after the player is hit
  let flashTimer = 0;       // white flash on player death
  let titlePulse = 0;       // animates the "press start" prompt
  let winTimer = 0;         // short celebratory pause between waves

  // ---- Factory: the player ship ----------------------------
  function makePlayer() {
    return { x: W / 2, y: PLAYER_Y, w: PLAYER_W, h: PLAYER_H };
  }

  // ============================================================
  //  SETUP / RESET
  // ============================================================
  function resetGame() {
    score = 0;
    lives = START_LIVES;
    wave = 1;
    particles = [];
    ufo = null;
    ufoScoreFlash = null;
    ufoTimer = randRange(UFO_MIN_GAP, UFO_MAX_GAP);
    shake = 0;
    flashTimer = 0;
    player = makePlayer();
    startWave();
  }

  // Build a fresh formation + shields for the current `wave`.
  // Each wave starts a little LOWER and a little FASTER (escalation).
  function startWave() {
    aliens = [];
    bullets = [];
    bombs = [];
    dir = 1;
    pendingDrop = false;
    marchStep = 0;
    animFrame = 0;
    fireTimer = 0;
    respawnTimer = 0;

    // Lower the swarm by 18px per wave (capped so it stays fair).
    formTop = FORMATION_TOP + Math.min(wave - 1, 6) * 18;

    const startX = (W - (COLS - 1) * CELL_W) / 2; // centre the grid
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        aliens.push({
          col: c, row: r,
          x: startX + c * CELL_W,
          y: formTop + r * CELL_H,
          alive: true,
        });
      }
    }

    marchTimer = currentStepInterval();
    buildShields();
  }

  // ---- Destructible shields (bunkers) ----------------------
  // Each bunker is a small grid of square blocks; bullets/bombs
  // chew away individual blocks. We carve a notch out of the
  // bottom-centre so they look like the classic arched bunkers.
  const SHIELD_COUNT = 4;
  const BLOCK = 8;       // block size in px
  const SH_COLS = 9;     // blocks wide
  const SH_ROWS = 6;     // blocks tall
  function buildShields() {
    shields = [];
    const shieldW = SH_COLS * BLOCK;
    const gap = (W - SHIELD_COUNT * shieldW) / (SHIELD_COUNT + 1);
    const baseY = PLAYER_Y - 96;
    for (let s = 0; s < SHIELD_COUNT; s++) {
      const ox = gap + s * (shieldW + gap);
      const blocks = [];
      for (let by = 0; by < SH_ROWS; by++) {
        for (let bx = 0; bx < SH_COLS; bx++) {
          // Carve an arch: skip blocks in the bottom-centre notch.
          const inNotch = by >= SH_ROWS - 2 && bx >= 3 && bx <= 5;
          if (inNotch) continue;
          blocks.push({
            x: ox + bx * BLOCK,
            y: baseY + by * BLOCK,
            alive: true,
          });
        }
      }
      shields.push({ blocks });
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================
  function randRange(a, b) { return a + Math.random() * (b - a); }

  // How long (seconds) between horizontal steps right now.
  // Fewer aliens -> shorter interval -> faster march. Higher waves
  // are faster too. This is the core "tension" curve.
  function currentStepInterval() {
    const total = COLS * ROWS;
    const aliveCount = countAlive();
    // Fraction of the swarm remaining (1 down to ~0).
    const frac = aliveCount / total;
    // Slowest ~0.62s when full, fastest ~0.045s near-empty.
    const base = 0.045 + frac * 0.58;
    // Each wave shaves a bit more time off (caps so it stays playable).
    const waveScale = Math.max(0.45, 1 - (wave - 1) * 0.08);
    return base * waveScale;
  }

  function countAlive() {
    let n = 0;
    for (let i = 0; i < aliens.length; i++) if (aliens[i].alive) n++;
    return n;
  }

  // Axis-aligned rectangle overlap test.
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // A burst of short-lived debris particles at (x,y).
  function burst(x, y, n, speed, life, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = randRange(speed * 0.25, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: randRange(life * 0.5, life),
        maxLife: life,
        size: randRange(1.5, 3.5),
        color: color || '#cdd6e4',
      });
    }
  }

  function addShake(amount) { shake = Math.min(shake + amount, 16); }

  // ============================================================
  //  EVENTS (key-press edges)
  // ============================================================
  function onKeyDown(code) {
    if (state === STATE.TITLE) {
      if (code in START_CODES) { resetGame(); state = STATE.PLAY; }
      return;
    }
    if (state === STATE.OVER) {
      if (code in START_CODES) { resetGame(); state = STATE.PLAY; }
      return;
    }
    if (state === STATE.PLAY) {
      if (code in FIRE_CODES) fire();
    }
  }

  function fire() {
    if (state !== STATE.PLAY) return;
    if (respawnTimer > 0) return;                  // can't shoot mid-respawn
    if (fireTimer > 0) return;
    if (bullets.length >= MAX_PLAYER_BULLETS) return;
    bullets.push({ x: player.x, y: player.y - PLAYER_H, prevY: player.y - PLAYER_H });
    fireTimer = FIRE_COOLDOWN;
    Sound.shoot();
  }

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    titlePulse += dt;

    // Always let particles + shake settle so screens feel alive.
    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);

    if (state !== STATE.PLAY && state !== STATE.WIN_PAUSE) return;

    if (state === STATE.WIN_PAUSE) {
      winTimer -= dt;
      updateUfo(dt); // let a saucer finish flying off, looks tidy
      if (winTimer <= 0) { wave++; startWave(); state = STATE.PLAY; }
      return;
    }

    // ---- Respawn / death pause -----------------------------
    if (respawnTimer > 0) {
      respawnTimer -= dt;
      if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
      // Bombs keep falling during the brief pause so it still reads.
      updateBombs(dt);
      updateParticles(dt);
      return;
    }
    if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
    if (fireTimer > 0) fireTimer = Math.max(0, fireTimer - dt);

    updatePlayer(dt);
    updateBullets(dt);
    updateFormation(dt);
    updateBombs(dt);
    updateUfo(dt);

    // ---- Win check: wave cleared ---------------------------
    if (countAlive() === 0) {
      winTimer = 1.1;
      state = STATE.WIN_PAUSE;
      bullets = [];
    }
  }

  function updatePlayer(dt) {
    let vx = 0;
    for (const k in LEFT_CODES) if (keys[k]) vx -= 1;
    for (const k in RIGHT_CODES) if (keys[k]) vx += 1;
    player.x += vx * PLAYER_SPEED * dt;
    const half = player.w / 2;
    if (player.x < half) player.x = half;
    if (player.x > W - half) player.x = W - half;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.prevY = b.y;
      b.y -= PLAYER_BULLET_SPEED * dt;
      if (b.y < -10) { bullets.splice(i, 1); continue; }

      let consumed = false;

      // Hit the bonus UFO?
      if (ufo && rectsOverlap(b.x - 2, b.y - 8, 4, 12, ufo.x, ufo.y, UFO_W, UFO_H)) {
        const val = UFO_SCORES[Math.floor(Math.random() * UFO_SCORES.length)];
        addScore(val);
        ufoScoreFlash = { x: ufo.x + UFO_W / 2, y: ufo.y, val, t: 1.2 };
        burst(ufo.x + UFO_W / 2, ufo.y + UFO_H / 2, 26, 200, 0.7, '#ff7bd0');
        addShake(8);
        Sound.ufo(); Sound.hit();
        ufo = null;
        bullets.splice(i, 1);
        continue;
      }

      // Hit an alien? Sweep from prevY..y so fast bullets don't skip.
      for (let a = 0; a < aliens.length; a++) {
        const al = aliens[a];
        if (!al.alive) continue;
        if (rectsOverlap(b.x - 2, b.y - 8, 4, 14, al.x, al.y, ALIEN_W, ALIEN_H)) {
          al.alive = false;
          addScore(ROW_SCORE[al.row] || 10);
          burst(al.x + ALIEN_W / 2, al.y + ALIEN_H / 2, 16, 170, 0.6, alienColor(al.row));
          addShake(4);
          Sound.hit();
          consumed = true;
          break;
        }
      }
      if (consumed) { bullets.splice(i, 1); continue; }

      // Chew a shield block?
      if (hitShields(b.x, b.y, 3)) { bullets.splice(i, 1); }
    }
  }

  // Move the whole formation. The trick: decide the step using the
  // CURRENT extents, drop+reverse when an edge is touched, and let
  // the march interval shrink as the swarm thins.
  function updateFormation(dt) {
    marchTimer -= dt;
    if (marchTimer > 0) return;

    marchTimer += currentStepInterval();
    if (marchTimer < 0) marchTimer = 0; // guard huge dt after a tab-switch

    // Animate + play the marching note on each step.
    animFrame ^= 1;
    Sound.march(marchStep);
    marchStep = (marchStep + 1) % 4;

    if (pendingDrop) {
      // Step DOWN and reverse direction.
      pendingDrop = false;
      dir *= -1;
      for (const al of aliens) if (al.alive) al.y += STEP_DOWN;
      // Reaching the player's row = game over (classic lose condition).
      if (formationBottom() >= PLAYER_Y - 6) { endGame(); return; }
    } else {
      // Step sideways by one alien width's worth of nudge.
      const stepX = 10 * dir;
      for (const al of aliens) if (al.alive) al.x += stepX;
      // If we touched a wall, queue the drop for the NEXT step.
      const left = formationLeft();
      const right = formationRight();
      if (left <= EDGE_PAD || right >= W - EDGE_PAD) pendingDrop = true;
    }
  }

  function formationLeft() {
    let m = Infinity;
    for (const al of aliens) if (al.alive && al.x < m) m = al.x;
    return m === Infinity ? W / 2 : m;
  }
  function formationRight() {
    let m = -Infinity;
    for (const al of aliens) if (al.alive && al.x + ALIEN_W > m) m = al.x + ALIEN_W;
    return m === -Infinity ? W / 2 : m;
  }
  function formationBottom() {
    let m = -Infinity;
    for (const al of aliens) if (al.alive && al.y + ALIEN_H > m) m = al.y + ALIEN_H;
    return m === -Infinity ? 0 : m;
  }

  function updateBombs(dt) {
    // Roll for a new bomb. Chance scales with the wave so later
    // swarms are nastier even with the same alien count.
    bombTimer -= dt;
    if (bombTimer <= 0 && countAlive() > 0 && state === STATE.PLAY) {
      const chance = BASE_BOMB_CHANCE * (1 + (wave - 1) * 0.35);
      // Fire from a random *bottom-most* alien in some column.
      dropBomb();
      // Average gap shrinks as `chance` grows.
      bombTimer = randRange(0.25, 1.1) / Math.max(0.3, chance);
    }

    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.y += BOMB_SPEED * dt;
      b.wobble += dt * 12;

      // Off the bottom?
      if (b.y > H + 10) { bombs.splice(i, 1); continue; }

      // Hit the player?
      if (respawnTimer <= 0 &&
          rectsOverlap(b.x - 3, b.y, 6, 12,
                       player.x - player.w / 2, player.y - player.h, player.w, player.h)) {
        bombs.splice(i, 1);
        hurtPlayer();
        continue;
      }

      // Chew a shield block?
      if (hitShields(b.x, b.y + 6, 4)) { bombs.splice(i, 1); }
    }
  }

  // Pick a column that still has aliens, then fire from its lowest one.
  function dropBomb() {
    const bottomByCol = {};
    for (const al of aliens) {
      if (!al.alive) continue;
      const cur = bottomByCol[al.col];
      if (!cur || al.y > cur.y) bottomByCol[al.col] = al;
    }
    const cols = Object.keys(bottomByCol);
    if (cols.length === 0) return;
    const src = bottomByCol[cols[Math.floor(Math.random() * cols.length)]];
    bombs.push({
      x: src.x + ALIEN_W / 2,
      y: src.y + ALIEN_H,
      wobble: Math.random() * Math.PI * 2,
      kind: Math.random() < 0.5 ? 0 : 1, // two procedural bomb looks
    });
    Sound.bomb();
  }

  function updateUfo(dt) {
    if (ufoScoreFlash) {
      ufoScoreFlash.t -= dt;
      ufoScoreFlash.y -= dt * 18;
      if (ufoScoreFlash.t <= 0) ufoScoreFlash = null;
    }

    if (ufo) {
      ufo.x += ufo.dir * UFO_SPEED * dt;
      if (ufo.dir > 0 && ufo.x > W + 4) ufo = null;
      else if (ufo.dir < 0 && ufo.x < -UFO_W - 4) ufo = null;
      return;
    }

    if (state !== STATE.PLAY) return;
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      const fromLeft = Math.random() < 0.5;
      ufo = {
        x: fromLeft ? -UFO_W : W,
        y: UFO_Y,
        dir: fromLeft ? 1 : -1,
        pulse: 0,
      };
      ufoTimer = randRange(UFO_MIN_GAP, UFO_MAX_GAP);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  // ---- Shared shield collision: kill the first block hit ----
  // Returns true if a block was destroyed at (x,y) within radius r.
  function hitShields(x, y, r) {
    for (const sh of shields) {
      for (const blk of sh.blocks) {
        if (!blk.alive) continue;
        if (x >= blk.x - r && x <= blk.x + BLOCK + r &&
            y >= blk.y - r && y <= blk.y + BLOCK + r) {
          blk.alive = false;
          burst(blk.x + BLOCK / 2, blk.y + BLOCK / 2, 5, 90, 0.35, '#6fe3a0');
          return true;
        }
      }
    }
    return false;
  }

  function addScore(v) {
    score += v;
    if (score > best) { best = score; saveBest(best); }
  }

  // Player loses a life: explosion, brief pause, then respawn —
  // or game over if that was the last life.
  function hurtPlayer() {
    lives--;
    burst(player.x, player.y - player.h / 2, 30, 220, 0.8, '#9fd0ff');
    addShake(14);
    flashTimer = 0.18;
    Sound.playerHit();
    if (lives <= 0) { endGame(); return; }
    respawnTimer = 1.0;          // pause + invulnerability window
    player.x = W / 2;            // recentre the ship
    bombs = [];                  // clear bombs so respawn is fair
  }

  function endGame() {
    state = STATE.OVER;
    burst(player.x, player.y - player.h / 2, 36, 240, 1.0, '#9fd0ff');
    addShake(16);
    flashTimer = 0.2;
    if (score > best) { best = score; saveBest(best); }
    if (window.Arcade) Arcade.submitScore('space-invaders', score); // leaderboard
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    ctx.clearRect(0, 0, W, H);

    // Background: subtle vertical gradient + a faint starfield band.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070b12');
    g.addColorStop(1, '#04060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    drawStars();

    // Screen-shake: translate the whole field by a random jitter.
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    }

    drawShields();
    drawAliens();
    drawUfo();
    drawBombs();
    drawBullets();
    drawPlayer();
    drawParticles();

    ctx.restore();

    // White flash overlay on hits (drawn over the shake layer).
    if (flashTimer > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(flashTimer / 0.2) * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHUD();

    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.OVER) drawGameOver();
  }

  // A cheap, deterministic starfield so the backdrop isn't flat.
  function drawStars() {
    ctx.save();
    for (let i = 0; i < 60; i++) {
      // Hash i into pseudo-random but stable positions.
      const sx = (i * 73 % W);
      const sy = (i * 137 % (H - 80)) + 10;
      const tw = 0.3 + ((i * 31) % 10) / 14;
      ctx.fillStyle = `rgba(160,180,210,${0.10 + (i % 5) * 0.04})`;
      ctx.fillRect(sx, sy, tw, tw);
    }
    ctx.restore();
  }

  // ---- Alien colours by row (back rows pop more) ------------
  function alienColor(row) {
    switch (row) {
      case 0: return '#ff8fb0'; // top row (highest score) — pink
      case 1: return '#ffc36b'; // amber
      case 2: return '#ffe07a'; // yellow
      default: return '#7fe3a0'; // front rows — green
    }
  }

  // Draw the formation. Each alien is one of three procedural
  // species (by row band) and toggles between two poses with
  // `animFrame` — that's the classic two-frame march wiggle.
  function drawAliens() {
    for (const al of aliens) {
      if (!al.alive) continue;
      drawAlien(al.x, al.y, al.row, animFrame, alienColor(al.row));
    }
  }

  function drawAlien(x, y, row, frame, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;

    const species = row === 0 ? 0 : (row <= 2 ? 1 : 2);
    const w = ALIEN_W, h = ALIEN_H;

    if (species === 0) {
      // "Squid" — domed body, two big eyes, legs that flip per frame.
      ctx.fillRect(8, 2, w - 16, 6);          // top dome
      ctx.fillRect(4, 8, w - 8, 8);           // body
      // eyes (dark cut-outs)
      ctx.save();
      ctx.fillStyle = '#05060a';
      ctx.fillRect(9, 9, 4, 4);
      ctx.fillRect(w - 13, 9, 4, 4);
      ctx.restore();
      // legs / tentacles
      if (frame === 0) {
        ctx.fillRect(2, 16, 4, 5);
        ctx.fillRect(w - 6, 16, 4, 5);
        ctx.fillRect(10, 17, 4, 4);
        ctx.fillRect(w - 14, 17, 4, 4);
      } else {
        ctx.fillRect(0, 17, 4, 4);
        ctx.fillRect(w - 4, 17, 4, 4);
        ctx.fillRect(7, 16, 4, 5);
        ctx.fillRect(w - 11, 16, 4, 5);
      }
    } else if (species === 1) {
      // "Crab" — wide body with antennae that wave per frame.
      ctx.fillRect(6, 6, w - 12, 10);         // body
      ctx.fillRect(2, 9, 4, 6);               // left arm
      ctx.fillRect(w - 6, 9, 4, 6);           // right arm
      ctx.save();
      ctx.fillStyle = '#05060a';
      ctx.fillRect(10, 9, 4, 4);
      ctx.fillRect(w - 14, 9, 4, 4);
      ctx.restore();
      if (frame === 0) {
        ctx.fillRect(8, 2, 3, 5);             // antennae up
        ctx.fillRect(w - 11, 2, 3, 5);
        ctx.fillRect(8, 16, 4, 4);            // feet
        ctx.fillRect(w - 12, 16, 4, 4);
      } else {
        ctx.fillRect(5, 3, 3, 4);
        ctx.fillRect(w - 8, 3, 3, 4);
        ctx.fillRect(4, 16, 4, 4);
        ctx.fillRect(w - 8, 16, 4, 4);
      }
    } else {
      // "Bug" — compact round body, blinking legs.
      ctx.fillRect(7, 4, w - 14, 12);
      ctx.fillRect(4, 7, 3, 6);
      ctx.fillRect(w - 7, 7, 3, 6);
      ctx.save();
      ctx.fillStyle = '#05060a';
      ctx.fillRect(11, 8, 3, 4);
      ctx.fillRect(w - 14, 8, 3, 4);
      ctx.restore();
      if (frame === 0) {
        ctx.fillRect(8, 16, 3, 4);
        ctx.fillRect(w - 11, 16, 3, 4);
      } else {
        ctx.fillRect(11, 16, 3, 4);
        ctx.fillRect(w - 14, 16, 3, 4);
      }
    }
    ctx.restore();
  }

  // ---- The player ship (procedural cannon) -----------------
  function drawPlayer() {
    // Hide/blink the ship during the respawn window.
    if (respawnTimer > 0 && Math.floor(respawnTimer * 12) % 2 === 0) return;
    if (state === STATE.OVER) return; // ship is gone after the final hit

    const x = player.x, y = player.y, w = player.w, h = player.h;
    ctx.save();
    ctx.fillStyle = '#9fd0ff';
    // base
    ctx.fillRect(x - w / 2, y - 6, w, 6);
    // mid hull
    ctx.fillRect(x - w / 4, y - 12, w / 2, 8);
    // barrel
    ctx.fillRect(x - 2, y - h, 4, 8);
    // glow tip
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(x - 1, y - h, 2, 4);
    ctx.restore();
  }

  function drawBullets() {
    ctx.save();
    ctx.fillStyle = '#eaf4ff';
    ctx.shadowColor = '#9fd0ff';
    ctx.shadowBlur = 8;
    for (const b of bullets) ctx.fillRect(b.x - 1.5, b.y - 8, 3, 12);
    ctx.restore();
  }

  function drawBombs() {
    ctx.save();
    for (const b of bombs) {
      ctx.fillStyle = b.kind === 0 ? '#ff9a6b' : '#ff6bd0';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      if (b.kind === 0) {
        // jagged "lightning" bolt drawn as offset segments
        const off = Math.sin(b.wobble) * 2.5;
        ctx.fillRect(b.x - 1.5 + off, b.y, 3, 5);
        ctx.fillRect(b.x - 1.5 - off, b.y + 5, 3, 5);
      } else {
        // pulsing dot bomb
        const s = 2 + Math.abs(Math.sin(b.wobble)) * 1.5;
        ctx.fillRect(b.x - s / 2, b.y, s, 6);
      }
    }
    ctx.restore();
  }

  function drawShields() {
    ctx.save();
    for (const sh of shields) {
      for (const blk of sh.blocks) {
        if (!blk.alive) continue;
        ctx.fillStyle = '#5fcf8e';
        ctx.fillRect(blk.x, blk.y, BLOCK, BLOCK);
        // subtle inner shade for a little depth
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(blk.x + BLOCK - 2, blk.y + BLOCK - 2, 2, 2);
      }
    }
    ctx.restore();
  }

  function drawUfo() {
    if (!ufo) return;
    ufo.pulse += 0.2;
    const x = ufo.x, y = ufo.y;
    ctx.save();
    // saucer body
    ctx.fillStyle = '#ff7bd0';
    ctx.shadowColor = '#ff7bd0';
    ctx.shadowBlur = 10;
    ctx.fillRect(x + 6, y + 6, UFO_W - 12, 6);  // lower hull
    ctx.fillRect(x + 2, y + 9, UFO_W - 4, 4);   // rim
    ctx.fillRect(x + 12, y + 2, UFO_W - 24, 5); // dome
    // blinking window lights
    ctx.shadowBlur = 0;
    ctx.fillStyle = (Math.floor(ufo.pulse) % 2) ? '#fff' : '#ffd0ee';
    ctx.fillRect(x + 8, y + 10, 2, 2);
    ctx.fillRect(x + UFO_W / 2 - 1, y + 10, 2, 2);
    ctx.fillRect(x + UFO_W - 10, y + 10, 2, 2);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD: score, best, lives, wave -----------------------
  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + score, 14, 12);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('WAVE ' + wave, W / 2, 12);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#8aa0c4';
    ctx.fillText('BEST ' + best, W - 14, 12);

    // Lives drawn as little ship icons at the bottom-left.
    ctx.shadowBlur = 0;
    for (let i = 0; i < lives; i++) {
      const lx = 18 + i * 28, ly = H - 18;
      ctx.fillStyle = '#9fd0ff';
      ctx.fillRect(lx - 10, ly, 20, 4);
      ctx.fillRect(lx - 5, ly - 5, 10, 5);
      ctx.fillRect(lx - 1, ly - 9, 2, 4);
    }

    // Floating UFO bonus value.
    if (ufoScoreFlash) {
      ctx.globalAlpha = Math.min(1, ufoScoreFlash.t);
      ctx.fillStyle = '#ff9ad8';
      ctx.textAlign = 'center';
      ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('+' + ufoScoreFlash.val, ufoScoreFlash.x, ufoScoreFlash.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---- Title screen ----------------------------------------
  function drawTitle() {
    dimBackdrop();
    ctx.save();
    ctx.textAlign = 'center';

    // Show a couple of live alien sprites as decoration.
    drawAlien(W / 2 - 120, 188, 0, animFrameTitle(), alienColor(0));
    drawAlien(W / 2 - 15, 188, 1, animFrameTitle(), alienColor(1));
    drawAlien(W / 2 + 90, 188, 3, animFrameTitle(), alienColor(3));

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '700 40px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(120,160,220,0.4)';
    ctx.shadowBlur = 16;
    ctx.fillText('SPACE INVADERS', W / 2, 250);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#8aa0c4';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Defend Earth. Clear the swarm before it lands.', W / 2, 300);

    // Tiny scoring legend.
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = alienColor(0); ctx.fillText('top row = 30', W / 2, 338);
    ctx.fillStyle = alienColor(1); ctx.fillText('mid rows = 20', W / 2, 358);
    ctx.fillStyle = alienColor(3); ctx.fillText('front rows = 10', W / 2, 378);
    ctx.fillStyle = '#ff9ad8';     ctx.fillText('bonus UFO = mystery!', W / 2, 398);

    // Pulsing prompt.
    const pulse = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Press SPACE or ENTER to start', W / 2, 452);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#6b7890';
    ctx.font = '500 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Move: ← → / A D     Shoot: SPACE', W / 2, 492);
    ctx.restore();
  }

  // Animate the title sprites independently of gameplay.
  function animFrameTitle() { return Math.floor(titlePulse * 3) % 2; }

  // ---- Game-over screen ------------------------------------
  function drawGameOver() {
    dimBackdrop();
    ctx.save();
    ctx.textAlign = 'center';

    ctx.fillStyle = '#ff9ab0';
    ctx.font = '700 42px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(255,120,150,0.4)';
    ctx.shadowBlur = 16;
    ctx.fillText('GAME OVER', W / 2, 226);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Score ' + score, W / 2, 286);

    ctx.fillStyle = '#8aa0c4';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    const isBest = score >= best && score > 0;
    ctx.fillText(isBest ? 'New best! ★  ' + best : 'Best ' + best, W / 2, 320);

    ctx.fillStyle = '#9fb4d4';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Reached wave ' + wave, W / 2, 350);

    const pulse = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = pulse;
    ctx.font = '700 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Press SPACE or ENTER to play again', W / 2, 408);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Darken the play field behind title/over text for readability.
  function dimBackdrop() {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,12,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ============================================================
  //  MAIN LOOP  —  requestAnimationFrame with clamped delta-time.
  //  Clamping dt stops a backgrounded tab from teleporting things.
  // ============================================================
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // clamp big gaps (tab switch, hitching)
    if (dt < 0) dt = 0;

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  // Kick off the loop. State is fully initialised above, so the
  // very first frame (the TITLE screen) renders safely.
  requestAnimationFrame(frame);
})();
