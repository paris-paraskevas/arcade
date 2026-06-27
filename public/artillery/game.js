/* ARTILLERY DUEL — local 2-player, turn-based tank artillery.
 *
 * Two tanks on a randomly generated hilly battlefield lob shells at each
 * other under gravity, fighting against a per-round wind. Set ANGLE + POWER,
 * fire, watch the arc, blow craters, win the round, win the match.
 *
 * House rules: self-contained, classic <script> + IIFE, file:// safe,
 * WebAudio created lazily on first input and fully try/catch wrapped, and
 * EVERY piece of state is initialized at module load so the title screen is
 * never blank or reading an undefined value.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas / constants
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 800
  const H = canvas.height;  // 500

  const GRAVITY = 320;          // px/s^2 pulling shells down
  const POWER_TO_SPEED = 4.2;   // shell launch speed = power * this
  const MIN_POWER = 5;
  const MAX_POWER = 100;
  const TANK_W = 30;            // tank hull width
  const TANK_H = 12;            // tank hull height
  const BARREL_LEN = 22;        // cannon barrel length
  const SHELL_R = 4;            // shell radius
  const BLAST_R = 34;           // explosion / crater radius
  const MAX_HEALTH = 100;
  const HIT_DMG = 55;           // damage at the very centre of a blast
  const ROUNDS_TO_WIN = 3;      // best of 5 -> first to 3 round wins

  // Per-player display colours.
  const P_COLORS = [
    { body: '#5bd6a6', dark: '#2f8f6a', name: 'PLAYER 1' },
    { body: '#ff7b6b', dark: '#b04437', name: 'PLAYER 2' }
  ];

  // ---------------------------------------------------------------------------
  // Game phases
  // ---------------------------------------------------------------------------
  const PHASE_TITLE = 'title';   // start screen
  const PHASE_AIM = 'aim';       // a player is aiming
  const PHASE_FLY = 'fly';       // shell in flight
  const PHASE_BOOM = 'boom';     // explosion settling, brief pause
  const PHASE_ROUND = 'round';   // round over, waiting to advance
  const PHASE_MATCH = 'match';   // match over, waiting to rematch

  // ---------------------------------------------------------------------------
  // State (ALL initialized here at load so title/render never see undefined)
  // ---------------------------------------------------------------------------
  let phase = PHASE_TITLE;
  let terrain = [];          // height (y of ground surface) per column, length W
  let tanks = [];            // [{x, y, angle, power, health, dir}]
  let current = 0;           // index of player whose turn it is
  let wind = 0;              // horizontal acceleration applied to shells
  let shell = null;          // {x, y, vx, vy, trail:[]}
  let particles = [];        // explosion debris
  let smoke = [];            // lingering smoke puffs from craters
  let scores = [0, 0];       // round wins per player
  let roundNo = 1;
  let roundWinner = -1;      // who won the last round (-1 none yet)
  let matchWinner = -1;
  let shake = 0;             // screen-shake magnitude
  let boomTimer = 0;         // countdown during PHASE_BOOM
  let flash = 0;             // white muzzle/impact flash alpha
  let titlePulse = 0;        // animates the title prompt
  let lastFireMiss = false;  // for a little feedback text

  // Held-key repeat timers so holding arrows ramps adjustments smoothly.
  const held = { left: false, right: false, up: false, down: false };
  let adjustAccel = 0;       // grows while a key is held -> faster changes

  // ---------------------------------------------------------------------------
  // RNG helpers
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ---------------------------------------------------------------------------
  // Terrain: layered sine hills, smoothed, kept inside a comfortable band.
  // terrain[x] = surface Y (smaller = higher ground).
  // ---------------------------------------------------------------------------
  function generateTerrain() {
    terrain = new Array(W);
    const baseline = H * 0.72;             // average ground line
    const amp = H * 0.16;                  // hill amplitude
    // Three random sine components for a varied but smooth ridge.
    const o1 = rand(0, Math.PI * 2), f1 = rand(1.2, 2.2) / W * Math.PI * 2;
    const o2 = rand(0, Math.PI * 2), f2 = rand(2.5, 4.5) / W * Math.PI * 2;
    const o3 = rand(0, Math.PI * 2), f3 = rand(5, 8) / W * Math.PI * 2;
    for (let x = 0; x < W; x++) {
      const y = baseline
        - Math.sin(x * f1 + o1) * amp
        - Math.sin(x * f2 + o2) * amp * 0.4
        - Math.sin(x * f3 + o3) * amp * 0.18;
      terrain[x] = clamp(y, H * 0.34, H - 24);
    }
  }

  // Average terrain height across a span (used to seat tanks flat-ish).
  function groundAt(x) {
    const xi = clamp(Math.round(x), 0, W - 1);
    return terrain[xi];
  }

  // Flatten a little pad under each tank so they don't float on a spike.
  function flattenUnder(cx) {
    const half = Math.ceil(TANK_W / 2) + 2;
    let sum = 0, n = 0;
    for (let x = cx - half; x <= cx + half; x++) {
      if (x < 0 || x >= W) continue;
      sum += terrain[x]; n++;
    }
    const lvl = sum / n;
    for (let x = cx - half; x <= cx + half; x++) {
      if (x < 0 || x >= W) continue;
      terrain[x] = lvl;
    }
    return lvl;
  }

  // ---------------------------------------------------------------------------
  // Round / match setup
  // ---------------------------------------------------------------------------
  function placeTanks() {
    const x1 = Math.round(rand(W * 0.08, W * 0.20));
    const x2 = Math.round(rand(W * 0.80, W * 0.92));
    const y1 = flattenUnder(x1);
    const y2 = flattenUnder(x2);
    tanks = [
      { x: x1, y: y1, angle: 50, power: 55, health: MAX_HEALTH, dir: 1 },
      { x: x2, y: y2, angle: 130, power: 55, health: MAX_HEALTH, dir: -1 }
    ];
  }

  function newRound() {
    generateTerrain();
    placeTanks();
    // Wind varies each round; sign + strength shown by the arrow indicator.
    wind = rand(-90, 90);
    shell = null;
    particles = [];
    smoke = [];
    shake = 0;
    flash = 0;
    roundWinner = -1;
    lastFireMiss = false;
    // Loser of last round (or P1 on round 1) shoots first — keeps it fair.
    current = (roundNo % 2 === 1) ? 0 : 1;
    phase = PHASE_AIM;
  }

  function newMatch() {
    scores = [0, 0];
    roundNo = 1;
    matchWinner = -1;
    newRound();
  }

  // ---------------------------------------------------------------------------
  // Audio — WebAudio, lazy, fully guarded so it can never break the game.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // Generic short tone.
  function tone(freq, dur, type, vol, slideTo) {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* never let audio crash the loop */ }
  }
  // Filtered noise burst for the explosion.
  function boomSound() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const dur = 0.5;
      const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const k = 1 - i / data.length;
        data[i] = (Math.random() * 2 - 1) * k * k; // decaying noise
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + dur);
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp).connect(gain).connect(audioCtx.destination);
      src.start(t);
      src.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  const sndFire = () => tone(420, 0.18, 'square', 0.18, 120);
  const sndTick = () => tone(660, 0.03, 'square', 0.05);
  const sndWin = () => { tone(523, 0.12, 'triangle', 0.2); setTimeout(() => tone(784, 0.18, 'triangle', 0.2), 110); };

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------
  function barrelTip(tk) {
    const a = tk.angle * Math.PI / 180;
    // Barrel pivots from the top-centre of the hull. Angle 0 = +x (right),
    // 90 = straight up, 180 = left. We draw "up" as negative y.
    const px = tk.x + Math.cos(a) * BARREL_LEN;
    const py = (tk.y - TANK_H) - Math.sin(a) * BARREL_LEN;
    return { x: px, y: py };
  }

  function fire() {
    if (phase !== PHASE_AIM) return;
    const tk = tanks[current];
    const a = tk.angle * Math.PI / 180;
    const speed = tk.power * POWER_TO_SPEED;
    const tip = barrelTip(tk);
    shell = {
      x: tip.x,
      y: tip.y,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed, // negative = upward
      trail: []
    };
    flash = 1;
    shake = Math.max(shake, 4);
    // Little muzzle puff.
    for (let i = 0; i < 8; i++) {
      const ang = a + rand(-0.4, 0.4);
      particles.push({
        x: tip.x, y: tip.y,
        vx: Math.cos(ang) * rand(20, 80),
        vy: -Math.sin(ang) * rand(20, 80),
        life: rand(0.2, 0.5), max: 0.5, r: rand(1.5, 3),
        col: '#d9e2ef', g: 60
      });
    }
    sndFire();
    lastFireMiss = false;
    phase = PHASE_FLY;
  }

  // ---------------------------------------------------------------------------
  // Explosion: spawn particles + smoke, carve a crater, apply damage.
  // ---------------------------------------------------------------------------
  function explode(x, y) {
    shake = Math.max(shake, 14);
    flash = 1;
    boomSound();

    // Sparks + debris.
    for (let i = 0; i < 46; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(40, 320);
      particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - rand(20, 90),
        life: rand(0.3, 0.9), max: 0.9,
        r: rand(1.5, 4),
        col: i % 3 === 0 ? '#ffd36b' : (i % 3 === 1 ? '#ff8a3d' : '#ff5a3c'),
        g: 280
      });
    }
    // Smoke.
    for (let i = 0; i < 10; i++) {
      smoke.push({
        x: x + rand(-12, 12), y: y + rand(-12, 12),
        vy: -rand(8, 24), r: rand(8, 18),
        life: rand(0.8, 1.6), max: 1.6
      });
    }

    // Carve crater into terrain (round dome push-down).
    carveCrater(x, y, BLAST_R);

    // Damage tanks within blast radius (falls off with distance).
    for (let i = 0; i < tanks.length; i++) {
      const tk = tanks[i];
      const cx = tk.x, cy = tk.y - TANK_H / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < BLAST_R + TANK_W * 0.45) {
        const f = clamp(1 - d / (BLAST_R + TANK_W * 0.45), 0, 1);
        tk.health = Math.max(0, tk.health - Math.round(HIT_DMG * f));
      }
    }
  }

  // Push terrain down inside a circle to make a believable crater.
  function carveCrater(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (Math.abs(dx) > r) continue;
      // depth of crater at this column (semicircle profile)
      const depth = Math.sqrt(r * r - dx * dx);
      const craterFloor = cy + depth * 0.6;
      // Only lower ground that's currently above the crater floor.
      if (terrain[x] < craterFloor) {
        terrain[x] = Math.min(H - 6, craterFloor);
      }
    }
    // Re-seat tanks so they ride the new ground (they can fall into craters).
    for (const tk of tanks) {
      const g = groundAt(tk.x);
      if (tk.y < g) tk.y = g;
    }
  }

  // ---------------------------------------------------------------------------
  // Turn handoff & round/match resolution
  // ---------------------------------------------------------------------------
  function afterImpact() {
    // Check for a dead tank.
    const dead = [];
    for (let i = 0; i < tanks.length; i++) if (tanks[i].health <= 0) dead.push(i);

    if (dead.length > 0) {
      // If both died (rare splash), the firer survives the tiebreak.
      let winner;
      if (dead.length === tanks.length) winner = current;
      else winner = dead[0] === 0 ? 1 : 0;
      roundWinner = winner;
      scores[winner]++;
      sndWin();
      if (scores[winner] >= ROUNDS_TO_WIN) {
        matchWinner = winner;
        phase = PHASE_MATCH;
      } else {
        phase = PHASE_ROUND;
      }
      return;
    }
    // No kill: pass the turn.
    current = current === 0 ? 1 : 0;
    phase = PHASE_AIM;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    titlePulse += dt;

    // Decay juice.
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    if (flash > 0) flash = Math.max(0, flash - dt * 4);

    // Particles.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.g || 200) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    // Smoke rises and fades.
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life -= dt;
      if (s.life <= 0) { smoke.splice(i, 1); continue; }
      s.y += s.vy * dt;
      s.r += dt * 6;
    }

    // Aiming: apply held-key adjustments with acceleration.
    if (phase === PHASE_AIM) {
      const tk = tanks[current];
      const any = held.left || held.right || held.up || held.down;
      if (any) {
        adjustAccel = Math.min(adjustAccel + dt * 2.4, 4);
      } else {
        adjustAccel = 0;
      }
      const angRate = (28 + adjustAccel * 60) * dt;  // deg/sec
      const powRate = (26 + adjustAccel * 55) * dt;
      let changed = false;
      if (held.left)  { tk.angle = clamp(tk.angle + angRate, 1, 179); changed = true; }
      if (held.right) { tk.angle = clamp(tk.angle - angRate, 1, 179); changed = true; }
      if (held.up)    { tk.power = clamp(tk.power + powRate, MIN_POWER, MAX_POWER); changed = true; }
      if (held.down)  { tk.power = clamp(tk.power - powRate, MIN_POWER, MAX_POWER); changed = true; }
      if (changed && Math.random() < 0.25) sndTick();
    }

    // Shell flight.
    if (phase === PHASE_FLY && shell) {
      // Sub-step for stable collision at high speed.
      const steps = 4;
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        shell.vx += wind * h;
        shell.vy += GRAVITY * h;
        shell.x += shell.vx * h;
        shell.y += shell.vy * h;
        // Trail sample.
        if (shell.trail.length === 0 ||
            Math.hypot(shell.x - shell.trail[shell.trail.length - 1].x,
                       shell.y - shell.trail[shell.trail.length - 1].y) > 5) {
          shell.trail.push({ x: shell.x, y: shell.y });
          if (shell.trail.length > 90) shell.trail.shift();
        }

        // Direct tank hit?
        let hitTank = false;
        for (const tk of tanks) {
          const cx = tk.x, cy = tk.y - TANK_H / 2;
          if (Math.hypot(shell.x - cx, shell.y - cy) < TANK_W * 0.55 + SHELL_R) {
            hitTank = true; break;
          }
        }
        // Ground hit?
        const groundHit = shell.y >= groundAt(shell.x) - SHELL_R;
        // Off the sides/bottom -> dud (miss), no explosion but turn passes.
        const offMap = shell.x < -40 || shell.x > W + 40 || shell.y > H + 60;

        if (hitTank || groundHit) {
          explode(clamp(shell.x, 0, W - 1), Math.min(shell.y, H - 4));
          shell = null;
          boomTimer = 0.55;
          phase = PHASE_BOOM;
          break;
        }
        if (offMap) {
          shell = null;
          lastFireMiss = true;
          // brief settle so the player registers the miss
          boomTimer = 0.25;
          phase = PHASE_BOOM;
          break;
        }
      }
    }

    // Explosion settle.
    if (phase === PHASE_BOOM) {
      boomTimer -= dt;
      if (boomTimer <= 0) afterImpact();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    ctx.save();

    // Screen shake offset.
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    drawSky();
    drawTerrain();
    drawTanks();
    if (phase === PHASE_AIM) drawAimGuide();
    drawShell();
    drawSmoke();
    drawParticles();

    ctx.restore(); // shake doesn't affect HUD / overlays

    // White flash overlay.
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHUD();
    drawWind();

    if (phase === PHASE_TITLE) drawTitle();
    else if (phase === PHASE_ROUND) drawRoundOver();
    else if (phase === PHASE_MATCH) drawMatchOver();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#162033');
    g.addColorStop(0.6, '#0d1320');
    g.addColorStop(1, '#0a0f1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // A few faint stars for atmosphere.
    ctx.fillStyle = 'rgba(180,200,230,0.5)';
    for (let i = 0; i < 36; i++) {
      // deterministic-ish positions from i so they don't twinkle wildly
      const x = (i * 137) % W;
      const y = (i * 53) % Math.floor(H * 0.45);
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }

  function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, terrain[x]);
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
    g.addColorStop(0, '#2c4434');
    g.addColorStop(1, '#13241a');
    ctx.fillStyle = g;
    ctx.fill();
    // Grass highlight line along the surface.
    ctx.beginPath();
    ctx.moveTo(0, terrain[0]);
    for (let x = 1; x < W; x++) ctx.lineTo(x, terrain[x]);
    ctx.strokeStyle = '#5bd6a6';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawTank(tk, idx, isTurn) {
    const col = P_COLORS[idx];
    ctx.save();
    ctx.translate(tk.x, tk.y);

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 2, TANK_W * 0.6, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Treads.
    ctx.fillStyle = '#2b3340';
    roundRect(-TANK_W / 2, -TANK_H + 2, TANK_W, TANK_H, 4);
    ctx.fill();
    // Tread wheels.
    ctx.fillStyle = '#1b2027';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * (TANK_W / 3), 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hull.
    ctx.fillStyle = col.body;
    roundRect(-TANK_W / 2 + 3, -TANK_H - 6, TANK_W - 6, 9, 3);
    ctx.fill();
    // Turret.
    ctx.fillStyle = col.dark;
    ctx.beginPath();
    ctx.arc(0, -TANK_H - 2, 7, Math.PI, 0);
    ctx.fill();

    // Barrel (rotates with angle).
    const a = tk.angle * Math.PI / 180;
    ctx.save();
    ctx.translate(0, -TANK_H);
    ctx.rotate(-a); // screen y is down, so negate for intuitive up
    ctx.fillStyle = '#cdd6e4';
    roundRect(0, -2.5, BARREL_LEN, 5, 2);
    ctx.fill();
    ctx.restore();

    // Health bar above tank.
    const bw = 34, bh = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-bw / 2, -TANK_H - 22, bw, bh);
    const hp = tk.health / MAX_HEALTH;
    ctx.fillStyle = hp > 0.5 ? '#5bd6a6' : hp > 0.25 ? '#ffd36b' : '#ff5a3c';
    ctx.fillRect(-bw / 2, -TANK_H - 22, bw * hp, bh);

    // Turn indicator: bobbing arrow above the active tank.
    if (isTurn) {
      const bob = Math.sin(titlePulse * 5) * 3;
      ctx.fillStyle = col.body;
      const ay = -TANK_H - 32 + bob;
      ctx.beginPath();
      ctx.moveTo(0, ay + 8);
      ctx.lineTo(-6, ay);
      ctx.lineTo(6, ay);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawTanks() {
    for (let i = 0; i < tanks.length; i++) {
      const isTurn = (phase === PHASE_AIM) && i === current;
      drawTank(tanks[i], i, isTurn);
    }
  }

  // Dotted predicted arc from the active tank's barrel (aim assist / feel).
  function drawAimGuide() {
    const tk = tanks[current];
    const a = tk.angle * Math.PI / 180;
    const speed = tk.power * POWER_TO_SPEED;
    const tip = barrelTip(tk);
    let x = tip.x, y = tip.y;
    let vx = Math.cos(a) * speed;
    let vy = -Math.sin(a) * speed;
    const dt = 0.045;
    ctx.fillStyle = 'rgba(205,214,228,0.55)';
    for (let i = 0; i < 26; i++) {
      vx += wind * dt;
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (y > groundAt(x) || x < 0 || x > W) break;
      ctx.globalAlpha = 0.55 * (1 - i / 30);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShell() {
    if (!shell) return;
    // Trail.
    for (let i = 0; i < shell.trail.length; i++) {
      const t = shell.trail[i];
      const a = i / shell.trail.length;
      ctx.fillStyle = `rgba(255,210,120,${a * 0.7})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 1 + a * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shell body with glow.
    ctx.fillStyle = '#ffe39a';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(shell.x, shell.y, SHELL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSmoke() {
    for (const s of smoke) {
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1) * 0.4;
      ctx.fillStyle = '#9aa6b5';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // HUD: per-player angle / power / health + whose turn + scoreboard + wind
  // ---------------------------------------------------------------------------
  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;

    // Left player panel.
    drawStatPanel(tanks[0], 0, 12, 12, 'left');
    // Right player panel.
    drawStatPanel(tanks[1], 1, W - 12, 12, 'right');

    // Scoreboard centre-top.
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`ROUND ${roundNo}  ·  BEST OF ${ROUNDS_TO_WIN * 2 - 1}`, W / 2, 20);
    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = P_COLORS[0].body;
    ctx.textAlign = 'right';
    ctx.fillText(String(scores[0]), W / 2 - 16, 44);
    ctx.fillStyle = '#6b7890';
    ctx.textAlign = 'center';
    ctx.fillText('–', W / 2, 44);
    ctx.fillStyle = P_COLORS[1].body;
    ctx.textAlign = 'left';
    ctx.fillText(String(scores[1]), W / 2 + 16, 44);

    // "Whose turn" prompt during aiming.
    if (phase === PHASE_AIM) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = P_COLORS[current].body;
      ctx.fillText(`${P_COLORS[current].name}  —  AIM & FIRE`, W / 2, H - 14);
    } else if (phase === PHASE_BOOM && lastFireMiss) {
      ctx.textAlign = 'center';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#9aa6b5';
      ctx.fillText('MISS', W / 2, H - 14);
    }

    ctx.restore();
  }

  function drawStatPanel(tk, idx, x, y, align) {
    const col = P_COLORS[idx];
    ctx.textAlign = align;
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = col.body;
    ctx.fillText(col.name, x, y + 4);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#cdd6e4';
    // Angle is shown relative to the tank's facing so it's intuitive
    // (0 = flat toward the enemy, 90 = straight up).
    const shownAngle = idx === 0 ? Math.round(tk.angle) : Math.round(180 - tk.angle);
    ctx.fillText(`ANGLE ${shownAngle}°`, x, y + 22);
    ctx.fillText(`POWER ${Math.round(tk.power)}`, x, y + 38);
    ctx.fillText(`HP ${tk.health}`, x, y + 54);
  }

  // Wind arrow indicator (centre, just under the scoreboard).
  function drawWind() {
    const cx = W / 2, cy = 64;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#6b7890';
    ctx.fillText('WIND', cx, cy - 8);

    const mag = Math.abs(wind) / 90;          // 0..1
    const len = 18 + mag * 34;
    const dir = wind >= 0 ? 1 : -1;
    const x0 = cx - dir * len / 2;
    const x1 = cx + dir * len / 2;
    ctx.strokeStyle = mag > 0.6 ? '#ff8a3d' : '#9fb4d4';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x1, cy);
    ctx.stroke();
    // Arrowhead.
    ctx.beginPath();
    ctx.moveTo(x1, cy);
    ctx.lineTo(x1 - dir * 7, cy - 4);
    ctx.lineTo(x1 - dir * 7, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Overlays: title / round-over / match-over
  // ---------------------------------------------------------------------------
  function dim(alpha) {
    ctx.fillStyle = `rgba(7,9,16,${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    dim(0.55);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('ARTILLERY DUEL', W / 2, H / 2 - 40);

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Two tanks. One hill. Mind the wind.', W / 2, H / 2 - 6);
    ctx.fillStyle = '#8a97ab';
    ctx.font = '500 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('← → angle   ·   ↑ ↓ power   ·   Space fire   ·   hold to adjust faster', W / 2, H / 2 + 22);
    ctx.fillText('Local 2-player hotseat   ·   first to 3 round wins', W / 2, H / 2 + 44);

    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 3.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE OR ENTER TO START', W / 2, H / 2 + 84);
    ctx.globalAlpha = 1;
  }

  function drawRoundOver() {
    dim(0.6);
    ctx.textAlign = 'center';
    const col = P_COLORS[roundWinner];
    ctx.fillStyle = col.body;
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${col.name} WINS THE ROUND`, W / 2, H / 2 - 14);
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${scores[0]}  –  ${scores[1]}`, W / 2, H / 2 + 18);
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 3.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE OR ENTER FOR NEXT ROUND', W / 2, H / 2 + 56);
    ctx.globalAlpha = 1;
  }

  function drawMatchOver() {
    dim(0.7);
    ctx.textAlign = 'center';
    const col = P_COLORS[matchWinner];
    ctx.fillStyle = col.body;
    ctx.font = '700 42px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${col.name} WINS!`, W / 2, H / 2 - 20);
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`Final score  ${scores[0]} – ${scores[1]}`, W / 2, H / 2 + 14);
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 3.2);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE / ENTER / R FOR A REMATCH', W / 2, H / 2 + 54);
    ctx.globalAlpha = 1;
  }

  // Rounded-rect helper (path only; caller fills/strokes).
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function startOrAdvance() {
    if (phase === PHASE_TITLE) { newRound(); }
    else if (phase === PHASE_ROUND) {
      roundNo++;
      newRound();
    }
    else if (phase === PHASE_MATCH) { newMatch(); }
  }

  window.addEventListener('keydown', (e) => {
    ensureAudio();
    const k = e.key;

    // Start / advance on Space or Enter.
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      e.preventDefault();
      if (phase === PHASE_AIM) { fire(); }
      else { startOrAdvance(); }
      return;
    }

    if (k === 'r' || k === 'R') {
      e.preventDefault();
      if (phase !== PHASE_TITLE) newMatch();
      return;
    }

    // Aiming controls (also flag held for repeat).
    if (phase === PHASE_AIM) {
      if (k === 'ArrowLeft')  { held.left = true;  e.preventDefault(); }
      else if (k === 'ArrowRight') { held.right = true; e.preventDefault(); }
      else if (k === 'ArrowUp')    { held.up = true;    e.preventDefault(); }
      else if (k === 'ArrowDown')  { held.down = true;  e.preventDefault(); }
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft')  held.left = false;
    else if (k === 'ArrowRight') held.right = false;
    else if (k === 'ArrowUp')    held.up = false;
    else if (k === 'ArrowDown')  held.down = false;
  });

  // Click: starts the game / advances, and also fires during aim.
  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    e.preventDefault();
    if (phase === PHASE_AIM) fire();
    else startOrAdvance();
  });

  // Safety: release all held keys if the window loses focus.
  window.addEventListener('blur', () => {
    held.left = held.right = held.up = held.down = false;
  });

  // ---------------------------------------------------------------------------
  // Main loop — rAF with clamped delta time.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;       // clamp so a tab-switch can't teleport
    if (dt < 0) dt = 0;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // Seed a battlefield immediately so the title screen draws over a real scene
  // (state is valid from the very first frame — no blank canvas, no undefined).
  generateTerrain();
  placeTanks();
  wind = rand(-90, 90);
  requestAnimationFrame(frame);
})();
