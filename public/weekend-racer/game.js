// ============================================================
//  WEEKEND RACER  —  a pseudo-3D arcade racer (OutRun-style)
//  Pure HTML5 Canvas + vanilla JavaScript. No libraries, no
//  asset files. Just open index.html in a browser.
//
//  The "3D" is faked: the road is a long list of flat segments
//  at increasing depth (z). Each frame we project every visible
//  segment from world space to the screen with simple
//  perspective, then paint them far-to-near. Curves and hills
//  are an illusion created by shifting/raising those segments.
//  Read render() + project() to see exactly how.
// ============================================================

(() => {
  'use strict';

  // ---- Canvas -------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;     // fixed internal resolution
  const HEIGHT = canvas.height;   // (CSS scales it to the page)

  // ---- Config (tweak these to change the feel) ----------------
  const CONFIG = {
    fov: 100,            // camera field of view, degrees
    cameraHeight: 1000,  // camera height above the road
    drawDistance: 320,   // how many segments ahead we draw
    segmentLength: 200,  // length (z) of one road segment
    rumbleLength: 3,     // segments per rumble-strip stripe
    roadWidth: 2000,     // road half-width in world units
    lanes: 3,
    fogDensity: 5,       // higher = thicker distance haze
    centrifugal: 0.22,   // how hard curves fling you outward
    fogColor: '#bfe0f2',
  };

  const FPS = 60;
  const STEP = 1 / FPS;  // fixed physics timestep (seconds)
  const cameraDepth = 1 / Math.tan((CONFIG.fov / 2) * Math.PI / 180);
  const PLAYER_Z = CONFIG.cameraHeight * cameraDepth; // player sits this far ahead of camera

  // derived speeds
  const MAX_SPEED   = CONFIG.segmentLength / STEP; // top speed: ~1 segment / frame
  const ACCEL       =  MAX_SPEED / 5;              // 0 -> top in ~5s
  const BRAKING     = -MAX_SPEED;
  const DECEL       = -MAX_SPEED / 5;              // natural coast-down
  const OFFROAD_DECEL = -MAX_SPEED / 2;            // grass drag
  const OFFROAD_LIMIT =  MAX_SPEED / 4;            // max speed on grass

  // ---- Colors -------------------------------------------------
  const LIGHT = { road: '#6f6f6f', grass: '#22a23a', rumble: '#f4f4f4', lane: '#e2e2e2' };
  const DARK  = { road: '#696969', grass: '#1d8f33', rumble: '#cf3b3b', lane: '#696969' };
  const START = { road: '#dddddd', grass: '#22a23a', rumble: '#dddddd', lane: '#dddddd' };

  // ---- Track data ---------------------------------------------
  const segments = [];
  let trackLength = 0;

  function lastY() {
    return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
  }

  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n,
      curve,
      cars: [],
      color: Math.floor(n / CONFIG.rumbleLength) % 2 ? DARK : LIGHT,
      p1: { world: { x: 0, y: lastY(),    z: n * CONFIG.segmentLength },       camera: {}, screen: {} },
      p2: { world: { x: 0, y,             z: (n + 1) * CONFIG.segmentLength },  camera: {}, screen: {} },
      clip: 0,
    });
  }

  const easeIn    = (a, b, p) => a + (b - a) * Math.pow(p, 2);
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

  // enter/hold/leave = segment counts; curve = bend; height = world-units climb
  function addRoad(enter, hold, leave, curve, height) {
    const startY = lastY();
    const endY = startY + height;
    const total = enter + hold + leave;
    let n;
    for (n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter),          easeInOut(startY, endY, n / total));
    for (n = 0; n < hold;  n++) addSegment(curve,                                easeInOut(startY, endY, (enter + n) / total));
    for (n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave),       easeInOut(startY, endY, (enter + hold + n) / total));
  }

  const LEN   = { SHORT: 25, MEDIUM: 50, LONG: 100 };
  const CURVE = { EASY: 2, MEDIUM: 4, HARD: 6 };
  const HILL  = { LOW: 2000, MEDIUM: 4000, HIGH: 6000 };

  function buildTrack() {
    segments.length = 0;
    addRoad(LEN.SHORT, LEN.LONG,   LEN.SHORT,  0,            0);             // start straight
    addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, CURVE.MEDIUM,  HILL.LOW);
    addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM, 0,            -HILL.LOW);
    addRoad(LEN.SHORT,  LEN.MEDIUM, LEN.SHORT, -CURVE.EASY,    0);
    addRoad(LEN.LONG,   LEN.LONG,   LEN.LONG,   CURVE.EASY,    HILL.MEDIUM);
    addRoad(LEN.MEDIUM, LEN.SHORT,  LEN.MEDIUM,-CURVE.MEDIUM, -HILL.LOW);
    addRoad(LEN.SHORT,  LEN.SHORT,  LEN.SHORT,  CURVE.HARD,    0);
    addRoad(LEN.LONG,   LEN.MEDIUM, LEN.LONG,  -CURVE.MEDIUM,  HILL.HIGH);
    addRoad(LEN.MEDIUM, LEN.LONG,   LEN.MEDIUM, 0,            -HILL.MEDIUM);
    addRoad(LEN.SHORT,  LEN.MEDIUM, LEN.SHORT,  CURVE.EASY,    0);
    addRoad(LEN.MEDIUM, LEN.MEDIUM, LEN.MEDIUM,-CURVE.HARD,    HILL.LOW);
    addRoad(LEN.LONG,   LEN.LONG,   LEN.SHORT,  CURVE.MEDIUM, -HILL.MEDIUM);

    // paint a start/finish stripe on the first few segments
    for (let n = 0; n < CONFIG.rumbleLength; n++) segments[n].color = START;

    trackLength = segments.length * CONFIG.segmentLength;
  }

  // ---- Traffic ------------------------------------------------
  const traffic = [];
  const CAR_COLORS = ['#3b7dd8', '#e6b800', '#9b59d0', '#2bb673', '#e8722c', '#d94f6b'];

  function buildTraffic(count) {
    traffic.length = 0;
    for (let i = 0; i < count; i++) {
      traffic.push({
        offset: (Math.random() * 1.6) - 0.8,            // lateral position, road units
        z: Math.floor(Math.random() * segments.length) * CONFIG.segmentLength,
        speed: MAX_SPEED * (0.18 + Math.random() * 0.42),
        color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
      });
    }
  }

  // ---- Helpers ------------------------------------------------
  const clamp  = (v, a, b) => Math.max(a, Math.min(b, v));
  const interp = (a, b, p) => a + (b - a) * p;

  function increase(start, amount, max) {
    let r = start + amount;
    while (r >= max) r -= max;
    while (r < 0)   r += max;
    return r;
  }

  function findSegment(z) {
    return segments[Math.floor(z / CONFIG.segmentLength) % segments.length];
  }

  function exponentialFog(distRatio, density) {
    return 1 / Math.pow(Math.E, distRatio * distRatio * density);
  }

  function overlap(x1, w1, x2, w2) {
    const min1 = x1 - w1 / 2, max1 = x1 + w1 / 2;
    const min2 = x2 - w2 / 2, max2 = x2 + w2 / 2;
    return !(max1 < min2 || min1 > max2);
  }

  // ---- Game state ---------------------------------------------
  const state = {
    mode: 'title',     // title | countdown | playing | over
    position: 0,       // camera z along the track
    speed: 0,
    playerX: 0,        // -1..1 on road; beyond = grass
    countdown: 3,
    time: 60,
    score: 0,
    laps: 0,
    shake: 0,
    skyOffset: 0,
    best: Number(localStorage.getItem('weekendRacerBest') || 0),
  };

  let flash = 0;      // red collision flash (seconds)
  let banner = '';    // transient center banner text
  let bannerT = 0;    // banner time left

  function showBanner(text, t = 1.4) { banner = text; bannerT = t; }

  function startRun() {
    state.position = 0;
    state.speed = 0;
    state.playerX = 0;
    state.time = 60;
    state.score = 0;
    state.laps = 0;
    state.shake = 0;
    state.skyOffset = 0;
    state.countdown = 3;
    state.mode = 'countdown';
    buildTraffic(60);
  }

  function endGame() {
    state.mode = 'over';
    const result = Math.floor(state.score);
    if (result > state.best) {
      state.best = result;
      localStorage.setItem('weekendRacerBest', String(result));
    }
    if (window.Arcade) Arcade.submitScore('weekend-racer', result); // distance/points racer (dir=hi)
  }

  // ---- Input --------------------------------------------------
  const keys = { left: false, right: false, up: false, down: false };

  function onKey(e, down) {
    switch (e.code) {
      case 'ArrowLeft':  case 'KeyA': keys.left  = down; e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': keys.right = down; e.preventDefault(); break;
      case 'ArrowUp':    case 'KeyW': keys.up    = down; e.preventDefault(); break;
      case 'ArrowDown':  case 'KeyS': keys.down  = down; e.preventDefault(); break;
      case 'Space':
        e.preventDefault();
        if (down) {
          initAudio();
          if (state.mode === 'title' || state.mode === 'over') startRun();
        }
        break;
    }
  }
  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup',   e => onKey(e, false));

  // ---- Audio (optional, fails silently) -----------------------
  let actx = null, engineOsc = null, engineGain = null;

  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      const filt = actx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 900;
      engineOsc = actx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineGain = actx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filt); filt.connect(engineGain); engineGain.connect(actx.destination);
      engineOsc.start();
    } catch (err) { actx = null; }
  }

  function audioUpdate() {
    if (!actx) return;
    const sp = state.speed / MAX_SPEED;
    engineOsc.frequency.value = 55 + sp * 230;
    const target = state.mode === 'playing' ? 0.015 + sp * 0.05 : 0;
    engineGain.gain.value += (target - engineGain.gain.value) * 0.2;
  }

  function sfxCrash() {
    if (!actx) return;
    try {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 130;
      g.gain.value = 0.14;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime;
      o.frequency.exponentialRampToValueAtTime(45, t + 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.24);
    } catch (err) { /* ignore */ }
  }

  // ---- Simulation ---------------------------------------------
  function update(dt) {
    const playerSeg = findSegment(state.position + PLAYER_Z);
    const speedPercent = state.speed / MAX_SPEED;
    const steerSpeed = dt * 2.5 * speedPercent;   // can't steer much when slow

    // move traffic and re-bucket it into segments (for draw + collision)
    for (const s of segments) s.cars.length = 0;
    for (const car of traffic) {
      car.z = increase(car.z, dt * car.speed, trackLength);
      findSegment(car.z).cars.push(car);
    }

    // steering + the outward pull of the current curve
    if (keys.left)  state.playerX -= steerSpeed;
    if (keys.right) state.playerX += steerSpeed;
    state.playerX -= steerSpeed * speedPercent * playerSeg.curve * CONFIG.centrifugal;

    // throttle / brake / coast
    if (keys.up)        state.speed += ACCEL * dt;
    else if (keys.down) state.speed += BRAKING * dt;
    else                state.speed += DECEL * dt;

    // grass drag
    if ((state.playerX < -1 || state.playerX > 1) && state.speed > OFFROAD_LIMIT) {
      state.speed += OFFROAD_DECEL * dt;
      state.shake = Math.min(1, state.shake + dt * 3);
    }

    state.playerX = clamp(state.playerX, -2.2, 2.2);
    state.speed   = clamp(state.speed, 0, MAX_SPEED);

    // collide with traffic in the player's segment
    for (const car of playerSeg.cars) {
      if (state.speed > car.speed && overlap(state.playerX, 0.6, car.offset, 0.6)) {
        state.speed = car.speed * 0.4;
        state.time = Math.max(0, state.time - 1.5);
        state.shake = 1; flash = 0.3;
        sfxCrash();
        break;
      }
    }

    // advance along the track + detect a completed lap (wrap)
    const prev = state.position;
    state.position = increase(state.position, dt * state.speed, trackLength);
    if (state.position < prev) {
      state.laps++;
      state.time += 25;
      showBanner('LAP ' + state.laps + '  +25s');
    }

    // scroll the sky with the curve for a sense of turning
    state.skyOffset += playerSeg.curve * speedPercent * dt * 4;

    // score + timer
    state.score += (state.speed * dt) / 50;
    state.time -= dt;
    state.shake = Math.max(0, state.shake - dt * 2);
    if (state.time <= 0) { state.time = 0; endGame(); }
  }

  // ---- Projection: world point -> screen point ----------------
  function project(p, camX, camY, camZ) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = Math.round(WIDTH  / 2 + p.screen.scale * p.camera.x * WIDTH  / 2);
    p.screen.y = Math.round(HEIGHT / 2 - p.screen.scale * p.camera.y * HEIGHT / 2);
    p.screen.w = Math.round(p.screen.scale * CONFIG.roadWidth * WIDTH / 2);
  }

  function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath(); ctx.fill();
  }

  function drawSegment(seg, fog) {
    const p1 = seg.p1.screen, p2 = seg.p2.screen, c = seg.color;

    // grass band behind this slice of road
    ctx.fillStyle = c.grass;
    ctx.fillRect(0, p2.y, WIDTH, p1.y - p2.y);

    const rw1 = p1.w / 5, rw2 = p2.w / 5;
    // rumble strips
    poly(p1.x - p1.w, p1.y, p1.x - p1.w + rw1, p1.y, p2.x - p2.w + rw2, p2.y, p2.x - p2.w, p2.y, c.rumble);
    poly(p1.x + p1.w, p1.y, p1.x + p1.w - rw1, p1.y, p2.x + p2.w - rw2, p2.y, p2.x + p2.w, p2.y, c.rumble);
    // road
    poly(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, c.road);

    // lane dashes (only on LIGHT segments -> they flicker = dashes)
    if (c === LIGHT) {
      const lw1 = p1.w * 0.03, lw2 = p2.w * 0.03;
      for (let l = 1; l < CONFIG.lanes; l++) {
        const off = -1 + (2 * l) / CONFIG.lanes;
        const lx1 = p1.x + off * p1.w, lx2 = p2.x + off * p2.w;
        poly(lx1 - lw1, p1.y, lx1 + lw1, p1.y, lx2 + lw2, p2.y, lx2 - lw2, p2.y, c.lane);
      }
    }

    // distance haze
    if (fog < 1) {
      ctx.globalAlpha = 1 - fog;
      ctx.fillStyle = CONFIG.fogColor;
      ctx.fillRect(0, p2.y, WIDTH, p1.y - p2.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---- Drawing the cars ---------------------------------------
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCar(cx, cy, w, color, isPlayer, clipY) {
    if (clipY != null && cy > clipY + 2) return; // hidden behind a hill
    if (w < 6) { ctx.fillStyle = color; ctx.fillRect(cx - w / 2, cy - w * 0.5, w, w * 0.5); return; }

    const h = w * 0.55;
    const x = cx - w / 2, y = cy - h;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.55, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    roundRectPath(x, y, w, h, w * 0.16); ctx.fillStyle = color; ctx.fill();
    // cabin / rear window
    ctx.fillStyle = 'rgba(18,26,38,0.85)';
    roundRectPath(x + w * 0.18, y + h * 0.12, w * 0.64, h * 0.42, w * 0.06); ctx.fill();
    // lights
    ctx.fillStyle = isPlayer ? '#ffd24d' : '#ff453a';
    ctx.fillRect(x + w * 0.08, y + h * 0.62, w * 0.17, h * 0.2);
    ctx.fillRect(x + w * 0.75, y + h * 0.62, w * 0.17, h * 0.2);
  }

  function drawPlayerCar(shakeX) {
    const w = WIDTH * 0.17;
    const sp = state.speed / MAX_SPEED;
    const bounce = Math.sin(state.position * 0.18) * 2.4 * sp;   // engine wobble
    const steer = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    const cx = WIDTH / 2 + shakeX + steer * 7;
    const cy = HEIGHT - HEIGHT * 0.055 + bounce;
    drawCar(cx, cy, w, '#e23b30', true, null);
  }

  // ---- Background --------------------------------------------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0f2747');
    g.addColorStop(0.55, '#2f6fa6');
    g.addColorStop(1, CONFIG.fogColor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // sun, drifts opposite to the curve
    const sunX = WIDTH * 0.5 - state.skyOffset % WIDTH;
    ctx.fillStyle = 'rgba(255, 236, 180, 0.9)';
    ctx.beginPath();
    ctx.arc(sunX, HEIGHT * 0.34, 46, 0, Math.PI * 2);
    ctx.fill();

    // far hill band
    ctx.fillStyle = 'rgba(20, 60, 50, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT * 0.55);
    const off = state.skyOffset * 0.5;
    for (let i = 0; i <= 8; i++) {
      const x = (i / 8) * WIDTH;
      const y = HEIGHT * 0.55 - Math.sin(i * 1.3 + off * 0.01) * 26 - 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WIDTH, HEIGHT * 0.6);
    ctx.lineTo(0, HEIGHT * 0.6);
    ctx.closePath(); ctx.fill();
  }

  // ---- Render -------------------------------------------------
  function render() {
    drawBackground();

    const baseSeg = findSegment(state.position);
    const basePercent = (state.position % CONFIG.segmentLength) / CONFIG.segmentLength;
    const playerSeg = findSegment(state.position + PLAYER_Z);
    const playerPercent = ((state.position + PLAYER_Z) % CONFIG.segmentLength) / CONFIG.segmentLength;
    const playerY = interp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);

    const shakeX = state.shake ? Math.sin(state.position * 0.7) * 7 * state.shake : 0;

    let maxy = HEIGHT;
    let x = 0;
    let dx = -(baseSeg.curve * basePercent);

    // 1) the road, near -> far
    for (let i = 0; i < CONFIG.drawDistance; i++) {
      const seg = segments[(baseSeg.index + i) % segments.length];
      const looped = seg.index < baseSeg.index;
      const camZ = state.position - (looped ? trackLength : 0);
      const fog = exponentialFog(i / CONFIG.drawDistance, CONFIG.fogDensity);

      project(seg.p1, state.playerX * CONFIG.roadWidth - x,      playerY + CONFIG.cameraHeight, camZ);
      project(seg.p2, state.playerX * CONFIG.roadWidth - x - dx, playerY + CONFIG.cameraHeight, camZ);
      x += dx; dx += seg.curve;

      seg.clip = maxy;
      if (seg.p1.camera.z <= cameraDepth || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy)
        continue;

      drawSegment(seg, fog);
      maxy = seg.p2.screen.y;
    }

    // 2) the cars, far -> near (so nearer ones overlap correctly)
    for (let i = CONFIG.drawDistance - 1; i > 0; i--) {
      const seg = segments[(baseSeg.index + i) % segments.length];
      for (const car of seg.cars) {
        const s = seg.p1.screen;
        const carX = s.x + car.offset * s.w;
        const carW = s.w * 0.62;
        drawCar(carX, s.y, carW, car.color, false, seg.clip);
      }
    }

    // 3) player + UI
    drawPlayerCar(shakeX);
    drawHUD();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,70,70,${flash})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (bannerT > 0) drawCenter(banner, '#ffe27a', 40, HEIGHT * 0.3);
    if (state.mode === 'title')     drawTitle();
    if (state.mode === 'countdown') drawCenter(Math.ceil(state.countdown) > 0 ? String(Math.ceil(state.countdown)) : 'GO', '#ffffff', 120);
    if (state.mode === 'over')      drawGameOver();
  }

  // ---- HUD + overlays -----------------------------------------
  function text(str, x, y, size, color, align = 'left', weight = '700') {
    ctx.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(str, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function drawHUD() {
    const mph = Math.round((state.speed / MAX_SPEED) * 220);
    text(mph + ' mph', 20, 44, 30, '#eaf2ff', 'left');
    text('SCORE ' + Math.floor(state.score), 20, 74, 18, '#9fb4d4', 'left');
    text('BEST ' + state.best, 20, 98, 14, '#6b7890', 'left');

    const t = Math.max(0, state.time);
    const timeColor = t < 10 ? '#ff6b6b' : '#eaf2ff';
    text(t.toFixed(1), WIDTH - 20, 44, 34, timeColor, 'right');
    text('TIME', WIDTH - 20, 64, 14, '#9fb4d4', 'right');
    text('LAP ' + (state.laps + 1), WIDTH - 20, 92, 18, '#9fb4d4', 'right');
  }

  function drawCenter(str, color, size, y = HEIGHT / 2) {
    text(str, WIDTH / 2, y, size, color, 'center');
  }

  function dim() {
    ctx.fillStyle = 'rgba(6,10,20,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawTitle() {
    dim();
    drawCenter('WEEKEND RACER', '#eaf2ff', 56, HEIGHT * 0.4);
    drawCenter('Press SPACE to start', '#ffe27a', 24, HEIGHT * 0.52);
    drawCenter('↑↓ accelerate / brake   ←→ steer   ·   beat the clock', '#9fb4d4', 16, HEIGHT * 0.6);
  }

  function drawGameOver() {
    dim();
    drawCenter("TIME'S UP", '#ff6b6b', 56, HEIGHT * 0.38);
    drawCenter('Score ' + Math.floor(state.score) + '   ·   Best ' + state.best, '#eaf2ff', 24, HEIGHT * 0.5);
    drawCenter('Press SPACE to race again', '#ffe27a', 20, HEIGHT * 0.6);
  }

  // ---- Main loop (fixed-timestep) -----------------------------
  let last = performance.now();
  let acc = 0;

  function tick(dt) {
    if (state.mode === 'countdown') {
      state.countdown -= dt;
      if (state.countdown <= 0) { state.mode = 'playing'; showBanner('GO!', 0.7); }
    }
    if (state.mode === 'playing') update(dt);
    audioUpdate();
    if (bannerT > 0) bannerT -= dt;
    if (flash > 0) flash -= dt;
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;       // avoid huge jumps after a tab switch
    acc += dt;
    while (acc >= STEP) { tick(STEP); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ---------------------------------------------------
  buildTrack();
  buildTraffic(60);
  requestAnimationFrame(frame);
})();
