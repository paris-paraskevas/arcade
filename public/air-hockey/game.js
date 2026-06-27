// ============================================================
//  AIR HOCKEY  —  local 2-player (or 1P vs CPU), pure HTML5
//  Canvas + vanilla JS. No libraries, no asset files. Just open
//  index.html.
//
//  A portrait table (560x720) with a goal at the TOP (Player 2)
//  and a goal at the BOTTOM (Player 1). Each player drives a
//  mallet confined to their own half. The puck slides with
//  friction, bounces off the side walls, and is struck by the
//  mallets: on contact it's pushed out along the contact normal
//  AND inherits some of the mallet's velocity (so a moving mallet
//  smacks harder than a still one). Drive the puck into the
//  opponent's goal mouth to score. First to TARGET_SCORE wins;
//  the puck re-centres (and is served toward whoever was scored
//  on) after each goal.
//
//  Read step() for the physics, resolveMalletPuck() for the hit
//  model, and the loop at the bottom for the fixed-timestep flow.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 560 — fixed internal resolution
  const H = canvas.height;  // 720 — (CSS scales it to the page)

  // ---- Table geometry (tweak these to change the feel) --------
  const WALL = 10;                 // side-wall thickness (visual + collision)
  const GOAL_W = 200;              // width of each goal mouth
  const GOAL_X0 = (W - GOAL_W) / 2;
  const GOAL_X1 = (W + GOAL_W) / 2;
  const CENTER_Y = H / 2;

  const PUCK_R = 16;               // puck radius
  const MALLET_R = 30;             // mallet (paddle) radius

  // Physics constants.
  const FRICTION = 0.992;          // per-frame velocity retention (slick ice)
  const PUCK_MAX = 17;             // speed cap so rallies stay controllable
  const MALLET_SPEED = 7.2;        // mallet move speed (px/step at 60fps)
  const MALLET_ACCEL = 0.55;       // how fast the mallet reaches target speed
  const RESTITUTION = 1.04;        // wall/mallet bounce liveliness (>1 = peppy)
  const HIT_TRANSFER = 0.62;       // share of mallet velocity imparted to puck
  const TARGET_SCORE = 7;          // first to this many goals wins

  // ---- CPU difficulty -----------------------------------------
  // Four tiers tune the 1P opponent. "Unbeatable" is the ORIGINAL
  // CPU (fast, eases at MALLET_SPEED*0.92, always intercepts). The
  // softer tiers cut the mallet's top speed, make it hang back and
  // defend more (lower `attack`), react slower (`reactFrames` of lag
  // before it commits to a moving puck), and aim less precisely
  // (`aimError` px of random wobble on the intercept point).
  //   speed     : top mallet speed as a fraction of MALLET_SPEED
  //   ease      : how snappily it closes distance (bigger = snappier)
  //   attack    : 0..1 chance it goes for an offensive strike vs just
  //               guarding its goal when the puck is reachable
  //   strike    : multiplier on its forward lunge speed when attacking
  //   reactFrames: frames of reaction delay before chasing a new puck
  //   aimError  : px of random error added to its target each retarget
  //   guardBias : 0..1 how far back toward its own goal it rests
  const DIFFS = [
    { key: 'easy',       label: 'Easy',       speed: 0.50, ease: 26, attack: 0.12, strike: 0.55, reactFrames: 22, aimError: 60, guardBias: 0.85 },
    { key: 'medium',     label: 'Medium',     speed: 0.70, ease: 34, attack: 0.40, strike: 0.80, reactFrames: 12, aimError: 32, guardBias: 0.55 },
    { key: 'hard',       label: 'Hard',       speed: 0.88, ease: 40, attack: 0.72, strike: 1.00, reactFrames: 5,  aimError: 14, guardBias: 0.30 },
    { key: 'unbeatable', label: 'Unbeatable', speed: 0.92, ease: 40, attack: 1.00, strike: 1.00, reactFrames: 0,  aimError: 0,  guardBias: 0.00 },
  ];
  let difficulty = 1;              // index into DIFFS; default Medium

  // Per-player visual + spatial kit. P1 = bottom (cyan), P2 = top (amber).
  const C = {
    bg: '#0a0d15',
    ice: '#0e1422',
    iceEdge: '#111b2e',
    wall: '#1d2940',
    wallHi: '#2c3d5e',
    line: 'rgba(159,180,212,0.22)',
    text: '#cdd6e4',
    accent: '#9fb4d4',
    dim: '#6b7890',
    puck: '#eef4ff',
    puckGlow: 'rgba(180,210,255,0.55)',
  };
  // index 0 = bottom (P1), index 1 = top (P2)
  const SIDES = [
    { name: 'P1', color: '#36d6ff', glow: 'rgba(54,214,255,0.55)', rim: '#0a2531', goalGlow: 'rgba(54,214,255,0.5)' },
    { name: 'P2', color: '#ffc24b', glow: 'rgba(255,194,75,0.55)', rim: '#2b1d05', goalGlow: 'rgba(255,194,75,0.5)' },
  ];

  // ---- Audio (WebAudio, lazy-created on first input) ----------
  // Wrapped so a missing/blocked AudioContext can NEVER break the
  // game — audio is pure garnish.
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
  }
  function blip(freq, dur, type, vol) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      const v = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* ignore — never break the game for a sound */ }
  }
  // Wall thud — pitch scales a touch with impact speed.
  const sndWall = (spd) => blip(150 + Math.min(spd, 18) * 9, 0.07, 'square', 0.05);
  // Mallet "clack" — two quick partials for a hard plasticky hit.
  const sndHit = (spd) => {
    const f = 240 + Math.min(spd, 24) * 12;
    blip(f, 0.06, 'square', 0.07);
    blip(f * 1.5, 0.05, 'triangle', 0.04);
  };
  const sndGoal = () => { blip(523, 0.1, 'triangle', 0.08); blip(392, 0.18, 'triangle', 0.07); blip(330, 0.26, 'sawtooth', 0.06); };
  const sndServe = () => { blip(440, 0.07, 'triangle', 0.06); blip(660, 0.09, 'triangle', 0.06); };
  const sndWin = () => { blip(660, 0.1, 'triangle', 0.08); blip(880, 0.12, 'triangle', 0.08); blip(1175, 0.18, 'triangle', 0.08); };

  // ---- localStorage (best win streak, harmless garnish) -------
  let bestStreak = 0;
  try {
    const v = localStorage.getItem('airhockey.beststreak');
    if (v != null) bestStreak = parseInt(v, 10) || 0;
  } catch (e) { /* storage may be blocked under file:// */ }
  function saveStreak(s) {
    if (s <= bestStreak) return;
    bestStreak = s;
    try { localStorage.setItem('airhockey.beststreak', String(s)); } catch (e) { /* ignore */ }
  }

  // ---- Game state ---------------------------------------------
  // states: 'title' | 'serve' | 'playing' | 'goal' | 'gameover'
  // Every one of these is initialised right here at module load so
  // the title screen's update()+render() never read undefined.
  let state = 'title';
  let mode = 2;             // 1 = vs CPU, 2 = two-player (chosen on title)
  let puck;                 // {x,y,vx,vy}
  let mallets;             // [bottomP1, topP2], each {x,y,px,py,vx,vy,target?}
  let scores;              // [p1, p2]
  let serveTo;             // which side gets served toward next (0 or 1)
  let serveTimer;          // countdown frames before puck releases on serve
  let stuckTimer;          // frames the puck has sat nearly motionless (watchdog)
  let winner;              // -1 none, 0 = P1, 1 = P2
  let winStreak;           // consecutive matches the same side has won (for best)
  let lastWinSide;         // side that won the previous match (-1 none)

  // CPU brain state (1P mode only). cpuReact counts down reaction
  // lag; cpuTX/cpuTY is the (lazily-jittered) target it steers toward
  // so aim error & delay stay stable between retargets instead of
  // jittering every frame.
  let cpuReact;
  let cpuTX, cpuTY;
  let cpuAttacking;        // whether this possession it commits to a strike

  // Juice.
  let trail;               // array of {x,y,life} puck afterimages
  let particles;           // array of {x,y,vx,vy,life,max,color,r}
  let shake;               // screen-shake magnitude (counts down)
  let goalFlashSide;       // -1 none, else side index that just got scored ON
  let goalFlash;           // 0..1 flash intensity
  let banner;              // big centre text or ''
  let bannerColor;
  let titlePulse;          // animates the "press start" prompt
  let last;                // timestamp of previous frame (for dt)
  let acc;                 // fixed-timestep accumulator

  // Held-key map for both players (and serve/start).
  const keys = Object.create(null);

  // ---- Setup helpers ------------------------------------------
  function makeMallet(side) {
    // side 0 = bottom, 1 = top. Start centred in own half.
    const x = W / 2;
    const y = side === 0 ? H - 90 : 90;
    return { x, y, px: x, py: y, vx: 0, vy: 0, side };
  }

  function centrePuck() {
    puck = { x: W / 2, y: CENTER_Y, vx: 0, vy: 0 };
  }

  // Full match reset (called when leaving title or on rematch).
  function startMatch(selectedMode) {
    mode = selectedMode;
    mallets = [makeMallet(0), makeMallet(1)];
    scores = [0, 0];
    winner = -1;
    trail = [];
    particles = [];
    shake = 0;
    goalFlashSide = -1;
    goalFlash = 0;
    banner = '';
    // Fresh CPU brain.
    cpuReact = 0;
    cpuTX = W / 2;
    cpuTY = WALL + MALLET_R + 60;
    cpuAttacking = false;
    // Serve toward a random side to open.
    serveTo = Math.random() < 0.5 ? 0 : 1;
    beginServe();
  }

  // Park the puck at centre and wait for the serving player to
  // press Space/Enter (or auto-release after a beat). The puck is
  // nudged toward `serveTo` when released.
  function beginServe() {
    state = 'serve';
    centrePuck();
    serveTimer = 90;        // ~1.5s auto-serve if nobody presses
    stuckTimer = 0;
    banner = '';
  }

  function releaseServe() {
    // Gentle opening velocity toward the chosen side, slight angle.
    const dir = serveTo === 1 ? -1 : 1;   // toward top = up (-y)
    const angle = (Math.random() * 0.7 - 0.35);
    const speed = 6.2;
    puck.vx = Math.sin(angle) * speed;
    puck.vy = dir * Math.cos(angle) * speed;
    state = 'playing';
    sndServe();
  }

  // ---- Particles / juice --------------------------------------
  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random()) * power;
      const max = 18 + Math.random() * 18;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: max, max,
        color,
        r: 1.5 + Math.random() * 2.5,
      });
    }
  }

  // ---- Vector helpers -----------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function capSpeed(p, cap) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > cap) {
      const k = cap / sp;
      p.vx *= k; p.vy *= k;
    }
    return sp;
  }

  // ---- Input handling -----------------------------------------
  // Move each mallet toward a target velocity from its held keys,
  // then clamp it inside its own half + the side walls. We keep the
  // PREVIOUS position (px,py) so we can derive the mallet's actual
  // velocity for the hit model and stop the puck tunnelling.
  function driveMallet(m) {
    let tx = 0, ty = 0;
    if (m.side === 0) {
      // P1 — WASD
      if (keys['a']) tx -= 1;
      if (keys['d']) tx += 1;
      if (keys['w']) ty -= 1;
      if (keys['s']) ty += 1;
    } else {
      // P2 — arrows (only when human; CPU overrides below)
      if (keys['arrowleft']) tx -= 1;
      if (keys['arrowright']) tx += 1;
      if (keys['arrowup']) ty -= 1;
      if (keys['arrowdown']) ty += 1;
    }
    applyMalletTarget(m, tx, ty, MALLET_SPEED);
  }

  // Shared steering: ease current velocity toward the desired
  // direction*speed, integrate, then constrain to the half + walls.
  function applyMalletTarget(m, tx, ty, speed) {
    const len = Math.hypot(tx, ty) || 1;
    const desX = (tx / len) * speed * (tx || ty ? 1 : 0);
    const desY = (ty / len) * speed * (tx || ty ? 1 : 0);
    m.vx += (desX - m.vx) * MALLET_ACCEL;
    m.vy += (desY - m.vy) * MALLET_ACCEL;

    m.px = m.x; m.py = m.y;
    m.x += m.vx;
    m.y += m.vy;

    // Confine to side walls.
    const minX = WALL + MALLET_R;
    const maxX = W - WALL - MALLET_R;
    m.x = clamp(m.x, minX, maxX);

    // Confine to own half (mallets can graze the centre line but
    // not cross it) and to the top/bottom edges.
    if (m.side === 0) {
      m.y = clamp(m.y, CENTER_Y + MALLET_R, H - WALL - MALLET_R);
    } else {
      m.y = clamp(m.y, WALL + MALLET_R, CENTER_Y - MALLET_R);
    }

    // Recompute the real velocity after clamping so wall-pinned
    // mallets don't keep "carrying" phantom speed into the puck.
    m.vx = m.x - m.px;
    m.vy = m.y - m.py;
  }

  // Difficulty-aware CPU for player 2 (top mallet). At "Unbeatable"
  // this collapses to the original behaviour: every frame it aims just
  // behind an approaching puck and recovers to a centred guard line
  // otherwise, easing at MALLET_SPEED*0.92 with zero lag and perfect
  // aim. Softer tiers cut the top speed, hang further back on the
  // guard line (guardBias), only commit to an offensive strike with
  // probability `attack`, react `reactFrames` late to a fresh puck,
  // and smear the target by `aimError` px.
  function driveCPU(m) {
    const d = DIFFS[difficulty];
    const guardY = WALL + MALLET_R + 60;            // base defensive line
    // Rest deeper toward the goal as guardBias rises (weak CPUs camp).
    const restY = guardY + (WALL + MALLET_R - guardY) * d.guardBias * 0.5;
    const puckComing = puck.vy < 0 || puck.y < CENTER_Y;

    // Reaction delay: when the puck first heads our way, hesitate for
    // reactFrames before chasing (it keeps holding its prior target).
    if (puckComing) {
      if (cpuReact > 0) cpuReact--;
    } else {
      // Puck left our half — re-arm the reaction lag and re-roll
      // whether we'll attack on the next possession.
      cpuReact = d.reactFrames;
      cpuAttacking = Math.random() < d.attack;
    }
    const reacting = puckComing && cpuReact <= 0;

    let aimX, aimY;
    if (reacting) {
      // Intercept: aim slightly behind the puck so it can push it back.
      aimX = puck.x;
      aimY = clamp(puck.y - PUCK_R - 4, WALL + MALLET_R, CENTER_Y - MALLET_R);
      // Defensive tiers shade the intercept back toward goal centre,
      // so they swat the puck away rather than drive it forward.
      if (!cpuAttacking) {
        aimX = W / 2 + (aimX - W / 2) * (1 - d.guardBias * 0.6);
      }
    } else {
      // Recover to a (bias-deepened) centred guard.
      aimX = W / 2 + (puck.x - W / 2) * 0.3 * (1 - d.guardBias);
      aimY = restY;
    }

    // Aim error: jitter the committed target, but only re-roll when the
    // puck is moving (so the wobble doesn't buzz while it sits idle).
    if (d.aimError > 0 && Math.hypot(puck.vx, puck.vy) > 0.5) {
      aimX += (Math.random() * 2 - 1) * d.aimError;
      aimY += (Math.random() * 2 - 1) * d.aimError * 0.5;
    }
    cpuTX = aimX;
    cpuTY = aimY;

    const dx = cpuTX - m.x;
    const dy = cpuTY - m.y;
    const tx = Math.abs(dx) > 2 ? Math.sign(dx) * Math.min(1, Math.abs(dx) / d.ease) : 0;
    const ty = Math.abs(dy) > 2 ? Math.sign(dy) * Math.min(1, Math.abs(dy) / d.ease) : 0;

    // Top speed scales with the tier; when actively attacking, lunge a
    // bit harder (strike) so harder CPUs hit with authority.
    let spd = MALLET_SPEED * d.speed;
    if (reacting && cpuAttacking) spd *= d.strike;
    applyMalletTarget(m, tx, ty, spd);
  }

  // ---- Collision: puck vs one mallet --------------------------
  // Circle-vs-circle. On overlap we (1) push the puck out along the
  // contact normal, (2) reflect its velocity about that normal with
  // restitution, and (3) add a share of the mallet's velocity so a
  // moving mallet drives the puck. Contact point matters because the
  // normal is the line between centres — hitting the puck off-centre
  // sends it off at an angle.
  function resolveMalletPuck(m) {
    const dx = puck.x - m.x;
    const dy = puck.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minDist = PUCK_R + MALLET_R;
    if (dist >= minDist || dist === 0) return false;

    const nx = dx / dist;     // contact normal (mallet -> puck)
    const ny = dy / dist;

    // 1) De-penetrate: place the puck exactly on the mallet's rim.
    puck.x = m.x + nx * minDist;
    puck.y = m.y + ny * minDist;

    // 2) Reflect puck velocity about the normal (only the inbound
    //    component), with restitution for a peppy bounce.
    const vDotN = puck.vx * nx + puck.vy * ny;
    if (vDotN < 0) {
      puck.vx -= (1 + RESTITUTION) * vDotN * nx;
      puck.vy -= (1 + RESTITUTION) * vDotN * ny;
    }

    // 3) Impart mallet motion (its velocity projected onto the
    //    normal, only when the mallet is moving into the puck).
    const mDotN = m.vx * nx + m.vy * ny;
    if (mDotN > 0) {
      puck.vx += nx * mDotN * (1 + HIT_TRANSFER);
      puck.vy += ny * mDotN * (1 + HIT_TRANSFER);
    }
    // Always carry a little of the mallet's tangential motion too,
    // so "brushing" the puck curves it — feels alive.
    puck.vx += m.vx * 0.18;
    puck.vy += m.vy * 0.18;

    const spd = capSpeed(puck, PUCK_MAX);
    sndHit(spd);
    burst(puck.x, puck.y, SIDES[m.side].color, 6, 1.6 + spd * 0.12);
    shake = Math.max(shake, Math.min(5, spd * 0.22));
    return true;
  }

  // ---- One physics step (fixed 60Hz) --------------------------
  function step() {
    titlePulse += 0.05;
    // Decay juice timers regardless of state.
    if (shake > 0) shake = Math.max(0, shake - 0.5);
    if (goalFlash > 0) goalFlash = Math.max(0, goalFlash - 0.04);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    // Trail fades on every state so the title puck glows softly too.
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].life--;
      if (trail[i].life <= 0) trail.splice(i, 1);
    }

    if (state === 'title' || state === 'gameover') {
      // Gentle idle drift of the puck so the canvas is never static.
      // It slowly floats around the rink, bouncing off the rails
      // (no goals, no scoring — pure ambience behind the panel).
      idleDrift();
      pushTrail();
      return;
    }

    // Drive mallets (human input, plus CPU for P2 in 1P mode).
    driveMallet(mallets[0]);
    if (mode === 1) driveCPU(mallets[1]);
    else driveMallet(mallets[1]);

    if (state === 'serve') {
      // Hold puck at centre; let the server smack it or auto-release.
      serveTimer--;
      // A player can serve early with Space/Enter (handled in keydown),
      // here we just auto-serve when the timer runs out.
      if (serveTimer <= 0) releaseServe();
      // Still resolve mallet contact so an eager player can tap it in.
      if (resolveMalletPuck(mallets[0]) || resolveMalletPuck(mallets[1])) {
        state = 'playing';
      }
      pushTrail();
      return;
    }

    if (state === 'goal') {
      // Brief celebratory pause, then re-serve.
      serveTimer--;
      if (serveTimer <= 0) {
        if (scores[0] >= TARGET_SCORE || scores[1] >= TARGET_SCORE) {
          endMatch();
        } else {
          beginServe();
        }
      }
      pushTrail();
      return;
    }

    // ---- state === 'playing': move + collide the puck ----------
    puck.x += puck.vx;
    puck.y += puck.vy;
    puck.vx *= FRICTION;
    puck.vy *= FRICTION;

    // Side walls (left/right): reflect x.
    const minX = WALL + PUCK_R;
    const maxX = W - WALL - PUCK_R;
    if (puck.x < minX) {
      puck.x = minX;
      puck.vx = -puck.vx * RESTITUTION;
      wallFx(minX, puck.y, Math.abs(puck.vx));
    } else if (puck.x > maxX) {
      puck.x = maxX;
      puck.vx = -puck.vx * RESTITUTION;
      wallFx(maxX, puck.y, Math.abs(puck.vx));
    }

    // Top / bottom: a goal mouth in the middle, solid wall either
    // side of it. Once the puck centre reaches an end line, either it
    // is lined up with the goal span (GOAL) or it bounces off the end
    // wall. Checking at the rim (not deep inside) means a fast puck
    // can't tunnel through the slot in a single step.
    const topLine = WALL + PUCK_R;
    const botLine = H - WALL - PUCK_R;
    const inGoalSpan = puck.x > GOAL_X0 && puck.x < GOAL_X1;

    if (puck.y <= topLine) {
      if (inGoalSpan) {
        // Crossed into the TOP goal -> P1 (bottom) scores.
        scoreGoal(0, 1);
        return;
      }
      puck.y = topLine;
      puck.vy = -puck.vy * RESTITUTION;
      wallFx(puck.x, topLine, Math.abs(puck.vy));
    } else if (puck.y >= botLine) {
      if (inGoalSpan) {
        // Crossed into the BOTTOM goal -> P2 (top) scores.
        scoreGoal(1, 0);
        return;
      }
      puck.y = botLine;
      puck.vy = -puck.vy * RESTITUTION;
      wallFx(puck.x, botLine, Math.abs(puck.vy));
    }

    // Mallets.
    resolveMalletPuck(mallets[0]);
    resolveMalletPuck(mallets[1]);

    capSpeed(puck, PUCK_MAX);

    // Stuck-puck watchdog: friction can leave the puck dead in a
    // corner that neither mallet can reach (each is locked to its
    // own half). If it idles too long, gently re-rack it toward the
    // centre so a rally can never stall out.
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed < 0.45) {
      stuckTimer++;
      if (stuckTimer > 120) {            // ~2s of near-stillness
        const dx = (W / 2) - puck.x;
        const dy = (CENTER_Y) - puck.y;
        const d = Math.hypot(dx, dy) || 1;
        puck.vx += (dx / d) * 2.4;       // a soft shove back into play
        puck.vy += (dy / d) * 2.4;
        burst(puck.x, puck.y, '#9fb4d4', 8, 1.6);
        stuckTimer = 0;
      }
    } else {
      stuckTimer = 0;
    }

    pushTrail();
  }

  function pushTrail() {
    trail.push({ x: puck.x, y: puck.y, life: 14 });
    if (trail.length > 26) trail.shift();
  }

  // Ambient puck motion for the title / game-over screens. Keeps a
  // gentle constant speed and bounces off all four rails (treats the
  // goal mouths as solid here — it's just decoration).
  function idleDrift() {
    puck.x += puck.vx;
    puck.y += puck.vy;
    const minX = WALL + PUCK_R, maxX = W - WALL - PUCK_R;
    const minY = WALL + PUCK_R, maxY = H - WALL - PUCK_R;
    if (puck.x < minX) { puck.x = minX; puck.vx = Math.abs(puck.vx); }
    else if (puck.x > maxX) { puck.x = maxX; puck.vx = -Math.abs(puck.vx); }
    if (puck.y < minY) { puck.y = minY; puck.vy = Math.abs(puck.vy); }
    else if (puck.y > maxY) { puck.y = maxY; puck.vy = -Math.abs(puck.vy); }
    // Keep the idle speed steady (re-normalise to ~1.8 px/step).
    const sp = Math.hypot(puck.vx, puck.vy) || 1;
    const k = 1.8 / sp;
    puck.vx *= k; puck.vy *= k;
  }

  function wallFx(x, y, spd) {
    if (spd < 0.6) return;
    sndWall(spd);
    burst(x, y, '#9fb4d4', 4, 1.2 + spd * 0.1);
    shake = Math.max(shake, Math.min(4, spd * 0.18));
  }

  // scoredBy = side that SCORED; scoredOn = side that conceded.
  function scoreGoal(scoredBy, scoredOn) {
    scores[scoredBy]++;
    state = 'goal';
    serveTimer = 48;             // ~0.8s celebration pause
    serveTo = scoredOn;          // next serve goes toward the conceding side
    goalFlashSide = scoredOn;
    goalFlash = 1;
    shake = 12;
    sndGoal();
    // Big particle pop at the goal mouth that was breached.
    const gy = scoredOn === 1 ? WALL : H - WALL;
    burst(puck.x, gy, SIDES[scoredBy].color, 40, 4.2);
    banner = '';
    // Stash the puck out of sight during the pause.
    puck.vx = 0; puck.vy = 0;
  }

  function endMatch() {
    winner = scores[0] >= TARGET_SCORE ? 0 : 1;
    state = 'gameover';
    // Track a "win streak" for the same side across rematches (best score).
    if (lastWinSide === winner) winStreak++;
    else winStreak = 1;
    lastWinSide = winner;
    saveStreak(winStreak);
    sndWin();
    burst(W / 2, CENTER_Y, SIDES[winner].color, 60, 5);
    shake = 14;
  }

  // ---- Rendering ----------------------------------------------
  function render() {
    ctx.save();

    // Screen-shake offset.
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // Table background.
    ctx.fillStyle = C.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    drawTable();
    drawTrail();
    drawPuck();
    drawMallet(mallets[1]);
    drawMallet(mallets[0]);
    drawParticles();

    // Goal flash overlay (the conceding end glows red-white).
    if (goalFlash > 0 && goalFlashSide >= 0) {
      const g = ctx.createLinearGradient(0, goalFlashSide === 1 ? 0 : H, 0, goalFlashSide === 1 ? H * 0.4 : H * 0.6);
      g.addColorStop(0, `rgba(255,255,255,${0.35 * goalFlash})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    drawHUD();
    ctx.restore();

    // Overlays (drawn without shake so text stays crisp).
    if (state === 'title') drawTitle();
    else if (state === 'gameover') drawGameOver();
    else if (state === 'goal') drawGoalBanner();
  }

  function drawTable() {
    // Ice surface with a subtle inner gradient.
    const ig = ctx.createRadialGradient(W / 2, CENTER_Y, 40, W / 2, CENTER_Y, H * 0.6);
    ig.addColorStop(0, C.ice);
    ig.addColorStop(1, C.iceEdge);
    ctx.fillStyle = ig;
    ctx.fillRect(WALL, WALL, W - WALL * 2, H - WALL * 2);

    // Side rails (left/right) — bright inner highlight.
    ctx.fillStyle = C.wall;
    ctx.fillRect(0, 0, WALL, H);
    ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.fillStyle = C.wallHi;
    ctx.fillRect(WALL - 2, 0, 2, H);
    ctx.fillRect(W - WALL, 0, 2, H);

    // End rails (top/bottom) with the goal mouth cut out.
    ctx.fillStyle = C.wall;
    // top rail, left + right of the goal
    ctx.fillRect(0, 0, GOAL_X0, WALL);
    ctx.fillRect(GOAL_X1, 0, W - GOAL_X1, WALL);
    // bottom rail
    ctx.fillRect(0, H - WALL, GOAL_X0, WALL);
    ctx.fillRect(GOAL_X1, H - WALL, W - GOAL_X1, WALL);

    // Centre line + face-off circle.
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(WALL, CENTER_Y);
    ctx.lineTo(W - WALL, CENTER_Y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W / 2, CENTER_Y, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, CENTER_Y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C.line;
    ctx.fill();

    // Each goal crease (a half-circle) tinted with the owner's colour.
    drawCrease(0);   // top goal owned by P2
    drawCrease(1);   // bottom goal owned by P1

    // Goal mouths — glowing slot at each end.
    drawGoalMouth(0);  // top = P2's goal
    drawGoalMouth(1);  // bottom = P1's goal
  }

  // creaseSide: 0 = top crease, 1 = bottom crease.
  function drawCrease(topOrBottom) {
    const ownerSide = topOrBottom === 0 ? 1 : 0; // top crease belongs to P2
    const y = topOrBottom === 0 ? WALL : H - WALL;
    ctx.save();
    ctx.strokeStyle = SIDES[ownerSide].color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, y, GOAL_W * 0.55, topOrBottom === 0 ? 0 : Math.PI, topOrBottom === 0 ? Math.PI : Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGoalMouth(topOrBottom) {
    const ownerSide = topOrBottom === 0 ? 1 : 0;
    const y = topOrBottom === 0 ? 0 : H - WALL;
    const s = SIDES[ownerSide];
    ctx.save();
    // Dark slot.
    ctx.fillStyle = '#04060a';
    ctx.fillRect(GOAL_X0, y, GOAL_W, WALL);
    // Glowing edge bar.
    ctx.shadowColor = s.goalGlow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = s.color;
    const barY = topOrBottom === 0 ? WALL - 3 : H - WALL;
    ctx.fillRect(GOAL_X0, barY, GOAL_W, 3);
    // Posts.
    ctx.fillRect(GOAL_X0 - 3, topOrBottom === 0 ? 0 : H - WALL, 3, WALL + 3);
    ctx.fillRect(GOAL_X1, topOrBottom === 0 ? 0 : H - WALL, 3, WALL + 3);
    ctx.restore();
  }

  function drawTrail() {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      const a = (t.life / 14) * (i / trail.length) * 0.5;
      if (a <= 0.01) continue;
      ctx.beginPath();
      ctx.fillStyle = `rgba(180,210,255,${a})`;
      ctx.arc(t.x, t.y, PUCK_R * (0.4 + 0.6 * (i / trail.length)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPuck() {
    ctx.save();
    ctx.shadowColor = C.puckGlow;
    ctx.shadowBlur = 22;
    // Puck body — radial sheen.
    const g = ctx.createRadialGradient(puck.x - 5, puck.y - 5, 2, puck.x, puck.y, PUCK_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, C.puck);
    g.addColorStop(1, '#9fb6d6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    // Rim ring.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_R - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawMallet(m) {
    const s = SIDES[m.side];
    ctx.save();
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 18;
    // Outer disc.
    const g = ctx.createRadialGradient(m.x, m.y, 4, m.x, m.y, MALLET_R);
    g.addColorStop(0, s.color);
    g.addColorStop(0.7, s.color);
    g.addColorStop(1, s.rim);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MALLET_R, 0, Math.PI * 2);
    ctx.fill();
    // Handle knob (inner ring + dot) — gives the mallet a top-down look.
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.rim;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MALLET_R * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, MALLET_R * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, MALLET_R * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Big mirrored score HUD: P2 (top) reads from the top edge, P1
  // (bottom) from the bottom. Each player sees their own number the
  // "right way up" from their side of the table.
  function drawHUD() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // P2 (top) — drawn rotated 180° so it faces the top player.
    drawSideScore(1, scores[1], W / 2, 60, true);
    // P1 (bottom).
    drawSideScore(0, scores[0], W / 2, H - 60, false);

    ctx.restore();
  }

  function drawSideScore(side, value, x, y, flip) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = SIDES[side].color;
    ctx.globalAlpha = 0.18;
    ctx.fillText(String(value), 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(String(value), 0, 0);
    // Tiny label. The CPU shows its difficulty tier so the HUD always
    // reflects the chosen level.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = SIDES[side].color;
    const label = (side === 1 && mode === 1)
      ? 'CPU · ' + DIFFS[difficulty].label
      : SIDES[side].name;
    ctx.fillText(label, 0, 28);
    ctx.restore();
  }

  // ---- Overlay screens ----------------------------------------
  function panel(cx, cy, w, h) {
    ctx.fillStyle = 'rgba(8,11,18,0.82)';
    ctx.strokeStyle = 'rgba(159,180,212,0.25)';
    ctx.lineWidth = 1.5;
    roundRect(cx - w / 2, cy - h / 2, w, h, 16);
    ctx.fill();
    ctx.stroke();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Recomputed every title frame so the click/touch handler can hit-
  // test the same rectangles we draw. {x,y,w,h, action, value}.
  let titleHits = [];

  function drawTitle() {
    titleHits = [];
    const top = CENTER_Y - 215;     // panel top edge (taller now)
    panel(W / 2, CENTER_Y, 440, 430);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = C.accent;
    ctx.font = '700 44px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('AIR HOCKEY', W / 2, top + 46);

    ctx.fillStyle = C.dim;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('first to ' + TARGET_SCORE + ' goals wins', W / 2, top + 78);

    // ---- Mode chooser (two tappable pills) --------------------
    const modeY = top + 116;
    drawTitleButton('1  vs CPU', W / 2 - 100, modeY, 184, 34, mode === 1, 'mode', 1);
    drawTitleButton('2  Two Player', W / 2 + 100, modeY, 184, 34, mode === 2, 'mode', 2);

    // ---- Difficulty chooser (only meaningful for 1P) ----------
    ctx.fillStyle = mode === 1 ? C.text : C.dim;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.globalAlpha = mode === 1 ? 1 : 0.4;
    ctx.fillText('CPU DIFFICULTY', W / 2, modeY + 38);
    ctx.globalAlpha = 1;

    // 2x2 grid of difficulty pills.
    const dimmed = mode !== 1;
    const gx = W / 2, gy = modeY + 90;
    const bw = 130, bh = 34, padX = 7, padY = 7;
    for (let i = 0; i < DIFFS.length; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const cx = gx + (col === 0 ? -(bw / 2 + padX) : (bw / 2 + padX));
      const cy = gy + (row === 0 ? -(bh / 2 + padY) : (bh / 2 + padY));
      drawTitleButton(
        (i + 1) + '  ' + DIFFS[i].label,
        cx, cy, bw, bh,
        difficulty === i, 'diff', i, dimmed
      );
    }

    // Controls.
    ctx.fillStyle = C.dim;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('P1 bottom: W A S D     P2 top: arrow keys', W / 2, gy + 64);

    // Pulsing start prompt.
    const pulse = 0.6 + 0.4 * Math.sin(titlePulse * 1.6);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = C.accent;
    ctx.font = '700 19px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE / ENTER', W / 2, gy + 92);
    ctx.globalAlpha = 1;

    if (bestStreak > 1) {
      ctx.fillStyle = C.dim;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('best win streak: ' + bestStreak, W / 2, gy + 118);
    }
  }

  // A pill button: centred at (cx,cy). Registers a hit-rect unless
  // `dimmed` (shown faint and non-interactive, e.g. difficulty in 2P).
  function drawTitleButton(text, cx, cy, w, h, active, action, value, dimmed) {
    const x = cx - w / 2, y = cy - h / 2;
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.3 : 1;
    ctx.fillStyle = active ? 'rgba(54,214,255,0.16)' : 'rgba(159,180,212,0.06)';
    ctx.strokeStyle = active ? '#36d6ff' : 'rgba(159,180,212,0.28)';
    ctx.lineWidth = active ? 2 : 1.25;
    roundRect(x, y, w, h, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? '#36d6ff' : C.text;
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
    if (!dimmed) titleHits.push({ x, y, w, h, action, value });
  }

  function drawGoalBanner() {
    // Scored-by side text shoots across the middle briefly.
    const scoredBy = goalFlashSide === 1 ? 0 : 1;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const a = clamp(goalFlash * 1.3, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = SIDES[scoredBy].color;
    ctx.shadowColor = SIDES[scoredBy].glow;
    ctx.shadowBlur = 24;
    ctx.font = '800 60px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('GOAL!', W / 2, CENTER_Y);
    ctx.restore();
  }

  function drawGameOver() {
    panel(W / 2, CENTER_Y, 420, 260);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const wname = (winner === 1 && mode === 1) ? 'CPU' : SIDES[winner].name;
    ctx.fillStyle = SIDES[winner].color;
    ctx.shadowColor = SIDES[winner].glow;
    ctx.shadowBlur = 20;
    ctx.font = '800 52px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(wname + ' WINS', W / 2, CENTER_Y - 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = C.text;
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(scores[0] + '  :  ' + scores[1], W / 2, CENTER_Y - 14);
    ctx.fillStyle = C.dim;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SIDES[0].name + ' (bottom)        ' + (mode === 1 ? 'CPU' : SIDES[1].name) + ' (top)', W / 2, CENTER_Y + 16);

    const pulse = 0.6 + 0.4 * Math.sin(titlePulse * 1.6);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = C.accent;
    ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRESS SPACE / ENTER TO REMATCH', W / 2, CENTER_Y + 64);
    ctx.globalAlpha = 1;

    ctx.fillStyle = C.dim;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('press  T  for title', W / 2, CENTER_Y + 96);
  }

  // ---- Input wiring -------------------------------------------
  function onStartKey() {
    ensureAudio();
    if (state === 'title') {
      startMatch(mode);
    } else if (state === 'gameover') {
      startMatch(mode);
    } else if (state === 'serve') {
      releaseServe();
    }
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    // Track held movement keys.
    keys[k] = true;

    // Prevent the page scrolling on arrows / space.
    if (k === ' ' || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
      e.preventDefault();
    }

    ensureAudio();

    if (k === ' ' || k === 'enter') {
      onStartKey();
      return;
    }
    if (state === 'title') {
      // Number keys 1–4 pick the CPU difficulty (Easy/Medium/Hard/
      // Unbeatable) and switch to vs-CPU mode — difficulty only means
      // anything against the CPU. Two-player is picked by clicking its
      // on-canvas pill (touch-friendly). Key 1 therefore doubles as
      // "vs CPU", preserving the original 1 = vs CPU shortcut.
      if (k >= '1' && k <= '4') {
        difficulty = k.charCodeAt(0) - 49; // '1'->0 .. '4'->3
        mode = 1;
        blip(700, 0.05, 'triangle', 0.05);
      } else if (k === 'p') {           // quick keyboard hop to two-player
        mode = 2;
        blip(560, 0.05, 'triangle', 0.05);
      }
    } else if (state === 'gameover') {
      if (k === 't') { state = 'title'; }
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // Map a pointer event to canvas-internal (560x720) coordinates,
  // accounting for the CSS scale of the <canvas>.
  function eventToCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = r.width ? W / r.width : 1;
    const sy = r.height ? H / r.height : 1;
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  }

  // On the title, a tap can land on a mode/difficulty pill. Returns
  // true if it hit a control (so we DON'T also start the match).
  function handleTitleTap(clientX, clientY) {
    if (state !== 'title') return false;
    const p = eventToCanvas(clientX, clientY);
    for (const h of titleHits) {
      if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
        if (h.action === 'mode') {
          mode = h.value;
          blip(700, 0.05, 'triangle', 0.05);
        } else if (h.action === 'diff') {
          difficulty = h.value;
          mode = 1;            // choosing a difficulty implies vs CPU
          blip(760, 0.05, 'triangle', 0.05);
        }
        return true;
      }
    }
    return false;
  }

  // A click also starts / serves / rematches (per the spec) and
  // unlocks audio. We don't use the mouse for paddle control. On the
  // title, taps on the mode/difficulty pills are consumed first.
  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    if (handleTitleTap(e.clientX, e.clientY)) return;
    onStartKey();
  });
  // Touch: same as a click.
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    ensureAudio();
    const t = e.changedTouches && e.changedTouches[0];
    if (t && handleTitleTap(t.clientX, t.clientY)) return;
    onStartKey();
  }, { passive: false });

  // Safety: if the window loses focus, clear held keys so a mallet
  // doesn't keep sliding when the player tabs away.
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  // ---- Main loop (fixed 60Hz steps, dt-accumulated) -----------
  const STEP = 1000 / 60;
  function frame(now) {
    if (last == null) last = now;
    let dt = now - last;
    last = now;
    // Clamp dt so a tab-switch can't fast-forward the sim.
    if (dt > 250) dt = 250;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 5) {
      step();
      acc -= STEP;
      guard++;
    }
    if (guard >= 5) acc = 0;   // dump backlog after a long stall
    render();
    requestAnimationFrame(frame);
  }

  // ---- Initialise ALL state at load (title screen is alive) ---
  // This is the #1 house rule: update()/render() must never read an
  // undefined value, even on the title and game-over screens.
  mode = 2;
  scores = [0, 0];
  mallets = [makeMallet(0), makeMallet(1)];
  centrePuck();
  serveTo = 0;
  serveTimer = 0;
  stuckTimer = 0;
  winner = -1;
  winStreak = 0;
  lastWinSide = -1;
  cpuReact = 0;
  cpuTX = W / 2;
  cpuTY = WALL + MALLET_R + 60;
  cpuAttacking = false;
  trail = [];
  particles = [];
  shake = 0;
  goalFlashSide = -1;
  goalFlash = 0;
  banner = '';
  bannerColor = C.accent;
  titlePulse = 0;
  acc = 0;
  last = null;
  // Give the title puck a slow idle drift just for life; idleDrift()
  // takes over from here while we're on the title / game-over screen.
  puck.vx = 1.4; puck.vy = -1.0;

  requestAnimationFrame(frame);
})();
