// ============================================================
//  ASTEROIDS  —  classic vector arcade, pure canvas + vanilla JS
//  Runs straight from file:// (no modules, no fetch, no build).
//  Everything is drawn procedurally; audio is WebAudio-only.
// ============================================================
(() => {
  'use strict';

  // ---- Canvas + context ------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // internal resolution: 820 x 600
  const H = canvas.height;

  // ---- Tunables (tweak these to change the feel) -----------
  const SHIP_RADIUS    = 14;     // collision + drawing size of the ship
  const TURN_SPEED     = 4.2;    // radians/sec while rotating
  const THRUST_ACCEL   = 320;    // px/sec^2 acceleration when thrusting
  const DRAG           = 0.55;   // velocity retained per second (coast/friction)
  const BULLET_SPEED   = 520;    // px/sec
  const BULLET_LIFE    = 1.0;    // seconds before a bullet expires
  const FIRE_COOLDOWN  = 0.18;   // seconds between shots
  const MAX_BULLETS    = 5;      // on-screen bullet cap (keeps it classic)
  const INVULN_TIME    = 2.5;    // seconds of safety after respawn
  const START_LIVES    = 3;
  const RESPAWN_CLEAR_R = 120;   // keep asteroids this far from a respawn

  // Asteroid sizes: radius, score, and how many it splits into.
  const ROCK = {
    large:  { r: 52, score: 20,  next: 'medium' },
    medium: { r: 30, score: 50,  next: 'small'  },
    small:  { r: 16, score: 100, next: null     },
  };

  // ---- High score (localStorage, guarded) ------------------
  const HS_KEY = 'asteroids.best';
  function loadBest() {
    try { return parseInt(localStorage.getItem(HS_KEY), 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(HS_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ============================================================
  //  AUDIO  —  built entirely in code, started on first input.
  //  Wrapped so a missing/blocked AudioContext can never break play.
  // ============================================================
  const Sound = (() => {
    let ac = null;
    let ok = false;
    let humOsc = null, humGain = null;

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

    // A short percussive blip/noise used for fire + explosions.
    function blip(freq, dur, type, vol) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.4), t + dur);
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(ac.destination);
        osc.start(t);
        osc.stop(t + dur);
      } catch (e) {}
    }

    // Filtered white noise for a chunky "boom".
    function boom(dur, vol) {
      if (!ok) return;
      try {
        const t = ac.currentTime;
        const frames = Math.floor(ac.sampleRate * dur);
        const buf = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
          // fade the noise out so it decays like a thump
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(180, t + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(vol || 0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(lp).connect(g).connect(ac.destination);
        src.start(t);
        src.stop(t + dur);
      } catch (e) {}
    }

    // Continuous low engine hum while thrusting.
    function thrust(on) {
      if (!ok) return;
      try {
        if (on) {
          if (humOsc) return;
          humOsc = ac.createOscillator();
          humGain = ac.createGain();
          humOsc.type = 'sawtooth';
          humOsc.frequency.value = 55;
          humGain.gain.value = 0.05;
          humOsc.connect(humGain).connect(ac.destination);
          humOsc.start();
        } else if (humOsc) {
          const t = ac.currentTime;
          humGain.gain.setValueAtTime(humGain.gain.value, t);
          humGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
          humOsc.stop(t + 0.1);
          humOsc = null; humGain = null;
        }
      } catch (e) { humOsc = null; humGain = null; }
    }

    return {
      init() { init(); },
      resume,
      fire()  { resume(); blip(880, 0.12, 'square', 0.10); },
      bangBig()   { resume(); boom(0.45, 0.30); },
      bangMed()   { resume(); boom(0.32, 0.24); },
      bangSmall() { resume(); boom(0.20, 0.18); },
      death()     { resume(); boom(0.7, 0.4); blip(140, 0.5, 'sawtooth', 0.18); },
      thrust,
    };
  })();

  // ---- Input -----------------------------------------------
  const keys = Object.create(null);
  const FIRE_CODES  = { Space: 1 };
  const START_CODES = { Enter: 1, NumpadEnter: 1 };

  window.addEventListener('keydown', (e) => {
    // First interaction wakes the audio engine (autoplay policies).
    Sound.init(); Sound.resume();

    // Stop the page from scrolling on arrows / space.
    if (e.code in FIRE_CODES || e.code.startsWith('Arrow') || e.code === 'Space') {
      e.preventDefault();
    }
    if (!keys[e.code]) onKeyDown(e.code);
    keys[e.code] = true;
  }, { passive: false });

  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  // Releasing focus shouldn't leave the engine humming forever.
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ============================================================
  //  GAME STATE
  // ============================================================
  const STATE = { TITLE: 0, PLAY: 1, OVER: 2 };
  let state = STATE.TITLE;

  let ship, bullets, asteroids, particles;
  let score, best, lives, wave;
  let shake = 0;            // current screen-shake magnitude
  let invuln = 0;           // remaining invulnerability time
  let fireTimer = 0;        // fire cooldown countdown
  let thrustFlicker = 0;    // animates the flame
  let wasThrusting = false; // tracks hum on/off edges
  let titlePulse = 0;       // animates "press enter" prompt

  best = loadBest();

  function makeShip() {
    return {
      x: W / 2, y: H / 2,
      vx: 0, vy: 0,
      angle: -Math.PI / 2, // facing up
      alive: true,
    };
  }

  function resetGame() {
    ship = makeShip();
    bullets = [];
    asteroids = [];
    particles = [];
    score = 0;
    lives = START_LIVES;
    wave = 1;
    shake = 0;
    invuln = INVULN_TIME;
    fireTimer = 0;
    spawnWave(wave);
  }

  // ---- Wave spawning ---------------------------------------
  // Asteroids spawn at the edges (and never on top of the ship),
  // so the player gets a moment to react each wave.
  function spawnWave(n) {
    const count = 3 + n; // wave 1 -> 4 rocks, grows each wave
    for (let i = 0; i < count; i++) {
      const a = makeAsteroid('large', null, null, 0.9 + n * 0.06);
      asteroids.push(a);
    }
  }

  function makeAsteroid(size, x, y, speedScale) {
    const def = ROCK[size];
    // If no position given, pick one away from the ship.
    if (x == null) {
      let px, py, tries = 0;
      do {
        // Spawn around the border ring.
        if (Math.random() < 0.5) { px = Math.random() * W; py = Math.random() < 0.5 ? 0 : H; }
        else { px = Math.random() < 0.5 ? 0 : W; py = Math.random() * H; }
        tries++;
      } while (ship && dist(px, py, ship.x, ship.y) < RESPAWN_CLEAR_R + def.r && tries < 30);
      x = px; y = py;
    }
    const ang = Math.random() * Math.PI * 2;
    const spd = (30 + Math.random() * 50) * (speedScale || 1);

    // Pre-bake a jagged polygon (offsets from the base radius).
    const verts = 9 + Math.floor(Math.random() * 5);
    const shape = [];
    for (let i = 0; i < verts; i++) {
      shape.push(0.72 + Math.random() * 0.46); // 0.72..1.18 of radius
    }
    return {
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      r: def.r,
      size,
      shape,
      verts,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.2, // radians/sec
    };
  }

  // ============================================================
  //  HELPERS
  // ============================================================
  function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Screen wrap: an object leaving one edge reappears on the opposite.
  function wrap(o) {
    if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
    if (o.y < 0) o.y += H; else if (o.y >= H) o.y -= H;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Spawn a burst of short line particles (debris) at a point.
  function burst(x, y, n, speed, life, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(life * 0.5, life),
        maxLife: life,
        len: rand(4, 10),
        color: color || '#cdd6e4',
      });
    }
  }

  function addShake(amount) { shake = Math.min(shake + amount, 22); }

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
    // PLAY: firing happens here on the press edge (cooldown handles rate).
    if (code in FIRE_CODES) fire();
  }

  function fire() {
    if (state !== STATE.PLAY || !ship.alive) return;
    if (fireTimer > 0 || bullets.length >= MAX_BULLETS) return;
    fireTimer = FIRE_COOLDOWN;
    // Bullet starts at the ship's nose and inherits the ship's facing.
    const nx = ship.x + Math.cos(ship.angle) * SHIP_RADIUS;
    const ny = ship.y + Math.sin(ship.angle) * SHIP_RADIUS;
    bullets.push({
      x: nx, y: ny,
      vx: Math.cos(ship.angle) * BULLET_SPEED + ship.vx,
      vy: Math.sin(ship.angle) * BULLET_SPEED + ship.vy,
      life: BULLET_LIFE,
    });
    Sound.fire();
  }

  // ============================================================
  //  UPDATE
  // ============================================================
  function update(dt) {
    titlePulse += dt;
    if (fireTimer > 0) fireTimer -= dt;
    if (shake > 0) shake = Math.max(0, shake - 40 * dt); // decay shake

    // Always animate particles so death/explosions look right on OVER too.
    updateParticles(dt);

    if (state !== STATE.PLAY) { Sound.thrust(false); wasThrusting = false; return; }

    if (invuln > 0) invuln -= dt;

    updateShip(dt);
    updateBullets(dt);
    updateAsteroids(dt);
    collide();

    // Next wave once the field is clear.
    if (asteroids.length === 0) {
      wave++;
      invuln = Math.max(invuln, 1.2); // small grace before the new wave
      spawnWave(wave);
    }
  }

  function updateShip(dt) {
    if (!ship.alive) return;

    // Rotation.
    if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= TURN_SPEED * dt;
    if (keys['ArrowRight'] || keys['KeyD']) ship.angle += TURN_SPEED * dt;

    // Thrust: accelerate ALONG the facing direction (vector physics).
    // Decompose the thrust into x/y using cos/sin of the heading.
    const thrusting = keys['ArrowUp'] || keys['KeyW'];
    if (thrusting) {
      ship.vx += Math.cos(ship.angle) * THRUST_ACCEL * dt;
      ship.vy += Math.sin(ship.angle) * THRUST_ACCEL * dt;
      thrustFlicker += dt * 40;
      // Occasional exhaust spark behind the ship.
      if (Math.random() < 0.6) {
        const bx = ship.x - Math.cos(ship.angle) * SHIP_RADIUS;
        const by = ship.y - Math.sin(ship.angle) * SHIP_RADIUS;
        particles.push({
          x: bx, y: by,
          vx: -Math.cos(ship.angle) * 80 + rand(-30, 30) - ship.vx * 0.1,
          vy: -Math.sin(ship.angle) * 80 + rand(-30, 30) - ship.vy * 0.1,
          life: rand(0.2, 0.4), maxLife: 0.4, len: rand(2, 5),
          color: '#ffb15a',
        });
      }
    }
    if (thrusting !== wasThrusting) { Sound.thrust(thrusting); wasThrusting = thrusting; }

    // Drag: exponential decay so the ship coasts and eventually slows.
    // Frame-rate independent: multiply velocity by DRAG^dt.
    const d = Math.pow(DRAG, dt);
    ship.vx *= d;
    ship.vy *= d;

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrap(ship);
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b);
      b.life -= dt;
      if (b.life <= 0) bullets.splice(i, 1);
    }
  }

  function updateAsteroids(dt) {
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.spin * dt;
      wrap(a);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.4, dt); // particles slow down
      p.vy *= Math.pow(0.4, dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---- Collisions ------------------------------------------
  function collide() {
    // Bullets vs asteroids.
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (dist(a.x, a.y, b.x, b.y) < a.r) {
          bullets.splice(j, 1);
          destroyAsteroid(i);
          break;
        }
      }
    }

    // Ship vs asteroids (only when alive and not invulnerable).
    if (ship.alive && invuln <= 0) {
      for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        if (dist(a.x, a.y, ship.x, ship.y) < a.r + SHIP_RADIUS * 0.8) {
          killShip();
          break;
        }
      }
    }
  }

  // Split an asteroid (large->2 medium, medium->2 small, small->gone).
  function destroyAsteroid(index) {
    const a = asteroids[index];
    asteroids.splice(index, 1);

    score += ROCK[a.size].score;
    if (score > best) { best = score; saveBest(best); }

    burst(a.x, a.y, 10 + Math.floor(a.r / 4), 140, 0.7, '#cdd6e4');

    if (a.size === 'large')      { addShake(5);  Sound.bangBig(); }
    else if (a.size === 'medium'){ addShake(3);  Sound.bangMed(); }
    else                         { addShake(1.5); Sound.bangSmall(); }

    const next = ROCK[a.size].next;
    if (next) {
      // Two children inherit position + a touch of the parent's momentum.
      for (let k = 0; k < 2; k++) {
        const child = makeAsteroid(next, a.x, a.y, 1);
        child.vx += a.vx * 0.4;
        child.vy += a.vy * 0.4;
        asteroids.push(child);
      }
    }
  }

  function killShip() {
    ship.alive = false;
    lives--;
    addShake(18);
    Sound.thrust(false); wasThrusting = false;
    Sound.death();
    burst(ship.x, ship.y, 30, 220, 1.0, '#9fd0ff');
    burst(ship.x, ship.y, 14, 120, 0.9, '#ffb15a');

    if (lives <= 0) {
      // Let the explosion play, then go to game over.
      setTimeout(() => { if (state === STATE.PLAY) state = STATE.OVER; }, 900);
    } else {
      setTimeout(() => {
        if (state !== STATE.PLAY) return;
        // Respawn at center; nudge nearby rocks won't matter — give invuln.
        ship = makeShip();
        invuln = INVULN_TIME;
      }, 900);
    }
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function render() {
    // Clear to near-black space.
    ctx.save();
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    // Apply screen shake as a random small translation.
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    // Faint vector glow for the whole scene.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    drawParticles();
    drawAsteroids();
    if (state === STATE.PLAY) drawBulletsAndShip();

    ctx.restore();

    if (state !== STATE.TITLE) drawHUD();
    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.OVER) drawGameOver();
  }

  // Draw an object both at its position AND shifted by ±W/±H when it
  // straddles an edge, so the wrap looks seamless.
  function drawWrapped(x, y, r, drawFn) {
    const offs = [];
    offs.push([0, 0]);
    if (x < r) offs.push([W, 0]);
    if (x > W - r) offs.push([-W, 0]);
    if (y < r) offs.push([0, H]);
    if (y > H - r) offs.push([0, -H]);
    // Corners (covers diagonal straddles).
    if (x < r && y < r) offs.push([W, H]);
    if (x < r && y > H - r) offs.push([W, -H]);
    if (x > W - r && y < r) offs.push([-W, H]);
    if (x > W - r && y > H - r) offs.push([-W, -H]);
    for (const [ox, oy] of offs) drawFn(x + ox, y + oy);
  }

  function drawAsteroids() {
    ctx.strokeStyle = '#cdd6e4';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(159,180,212,0.5)';
    ctx.shadowBlur = 6;
    for (const a of asteroids) {
      drawWrapped(a.x, a.y, a.r, (cx, cy) => {
        ctx.beginPath();
        for (let i = 0; i < a.verts; i++) {
          const ang = a.rot + (i / a.verts) * Math.PI * 2;
          const rr = a.r * a.shape[i];
          const px = cx + Math.cos(ang) * rr;
          const py = cy + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      });
    }
    ctx.shadowBlur = 0;
  }

  function drawBulletsAndShip() {
    // Bullets.
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 8;
    for (const b of bullets) {
      drawWrapped(b.x, b.y, 2, (cx, cy) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.shadowBlur = 0;

    if (!ship.alive) return;

    // Blink while invulnerable (skip drawing on alternating windows).
    const blinkOn = invuln <= 0 || (Math.floor(invuln * 10) % 2 === 0);
    if (!blinkOn) return;

    drawWrapped(ship.x, ship.y, SHIP_RADIUS + 8, (cx, cy) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ship.angle);

      // Flame behind the ship while thrusting (flickers).
      if ((keys['ArrowUp'] || keys['KeyW']) && Math.floor(thrustFlicker) % 2 === 0) {
        ctx.strokeStyle = '#ffb15a';
        ctx.shadowColor = 'rgba(255,177,90,0.8)';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.6;
        const flick = rand(0.6, 1.2);
        ctx.beginPath();
        ctx.moveTo(-SHIP_RADIUS * 0.6, -5);
        ctx.lineTo(-SHIP_RADIUS * (1.1 + flick), 0);
        ctx.lineTo(-SHIP_RADIUS * 0.6, 5);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Ship triangle (nose points along +x before rotation).
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(159,208,255,0.7)';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(SHIP_RADIUS, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.8, -SHIP_RADIUS * 0.7);
      ctx.lineTo(-SHIP_RADIUS * 0.5, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.8, SHIP_RADIUS * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    });
  }

  function drawParticles() {
    ctx.lineWidth = 1.6;
    for (const p of particles) {
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = t;
      ctx.strokeStyle = p.color;
      const ang = Math.atan2(p.vy, p.vx);
      const ex = p.x - Math.cos(ang) * p.len;
      const ey = p.y - Math.sin(ang) * p.len;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD + screens ---------------------------------------
  function textShadow(on) {
    if (on) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; }
    else { ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  }

  function drawHUD() {
    ctx.fillStyle = '#cdd6e4';
    textShadow(true);
    ctx.textBaseline = 'top';

    // Score (left).
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(score).padStart(5, '0'), 16, 14);

    // Best (center).
    ctx.font = '500 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9fb4d4';
    ctx.textAlign = 'center';
    ctx.fillText('BEST  ' + String(best).padStart(5, '0'), W / 2, 18);

    // Wave (right).
    ctx.textAlign = 'right';
    ctx.fillText('WAVE ' + wave, W - 16, 18);

    // Lives as little ship icons (top-left, under score).
    ctx.fillStyle = '#cdd6e4';
    for (let i = 0; i < lives; i++) {
      drawLifeIcon(26 + i * 22, 52);
    }
    textShadow(false);
  }

  function drawLifeIcon(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2); // point up
    ctx.strokeStyle = '#9fb4d4';
    ctx.lineWidth = 1.6;
    const r = 9;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.8, -r * 0.7);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r * 0.8, r * 0.7);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawTitle() {
    ctx.save();
    ctx.textAlign = 'center';
    textShadow(true);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(159,208,255,0.6)';
    ctx.shadowBlur = 16;
    ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('ASTEROIDS', W / 2, H / 2 - 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#9fb4d4';
    ctx.font = '500 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('rotate · thrust · shoot the rocks', W / 2, H / 2);

    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS  ENTER', W / 2, H / 2 + 56);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#6b7890';
    ctx.font = '500 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('← → / A D  rotate    ↑ / W  thrust    SPACE  fire', W / 2, H / 2 + 104);
    textShadow(false);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.textAlign = 'center';

    // Dim the field slightly.
    ctx.fillStyle = 'rgba(5,6,10,0.55)';
    ctx.fillRect(0, 0, W, H);

    textShadow(true);
    ctx.fillStyle = '#ff7a7a';
    ctx.shadowColor = 'rgba(255,122,122,0.5)';
    ctx.shadowBlur = 14;
    ctx.font = '700 56px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('SCORE  ' + String(score).padStart(5, '0'), W / 2, H / 2 + 2);

    ctx.fillStyle = '#9fb4d4';
    ctx.font = '500 16px "Segoe UI", system-ui, sans-serif';
    const isBest = score >= best && score > 0;
    ctx.fillText(isBest ? 'NEW BEST!' : 'BEST  ' + String(best).padStart(5, '0'), W / 2, H / 2 + 36);

    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS  ENTER  TO  PLAY  AGAIN', W / 2, H / 2 + 86);
    ctx.globalAlpha = 1;
    textShadow(false);
    ctx.restore();
  }

  // ============================================================
  //  MAIN LOOP  —  requestAnimationFrame with delta time.
  // ============================================================
  let last = performance.now();
  function frame(now) {
    // dt in seconds, clamped so a background tab / lag spike can't
    // teleport objects across the screen.
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  // Start with an empty but VALID world so the TITLE/OVER screens can
  // update + render safely before the first game begins. Without this,
  // update() touches `particles` (and friends) before resetGame() ever
  // defines them, which throws on frame one and freezes the whole game.
  bullets = [];
  asteroids = [];
  particles = [];
  score = 0;
  lives = START_LIVES;
  wave = 1;

  // Boot.
  requestAnimationFrame(frame);
})();
