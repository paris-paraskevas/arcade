/* STACK TOWER — a timing stacker.
 * Slide a block left/right, press to drop it onto the stack. Overhang gets
 * sliced off, so the playable width shrinks with every imperfect drop. Land a
 * pixel-perfect drop and you keep the full width plus a combo bonus. The tower
 * scrolls down as it climbs so the active block stays in view, and the slide
 * speed ramps with height. Miss the stack entirely (zero overlap) -> game over.
 *
 * House-rules note: EVERY variable that update()/render() touch is given a
 * valid value at module load (see resetGame() called immediately below), so the
 * title screen never reads an undefined array/number.
 */
(() => {
  'use strict';

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 480
  const H = canvas.height;  // 680

  // ---- Tunables -----------------------------------------------------------
  const BLOCK_H = 34;            // height of every block (px)
  const FIRST_WIDTH = 220;       // starting block width
  const START_X = (W - FIRST_WIDTH) / 2;
  const BASE_Y = H - 70;         // y of the very first block's top, before scroll
  const BASE_SPEED = 150;        // px/sec horizontal slide at the start
  const SPEED_PER_BLOCK = 7;     // slide speed gained per block placed
  const MAX_SPEED = 420;         // cap so it stays (barely) playable
  const PERFECT_TOL = 4;         // px tolerance counted as a "perfect" drop
  const CAM_LERP = 0.12;         // camera smoothing toward its target
  const FLASH_TIME = 0.45;       // seconds the perfect-drop flash lingers

  // ---- Game state (declared up top; filled by resetGame at load) ----------
  // States: 'title' | 'playing' | 'over'
  let state = 'title';
  let stack = [];          // placed blocks: {x, w, y, hue}
  let mover = null;        // the currently sliding block: {x, w, y, hue, dir, speed}
  let particles = [];      // slice-off debris {x, y, w, h, vx, vy, life, hue}
  let score = 0;           // blocks successfully stacked
  let best = 0;            // best from localStorage
  let combo = 0;           // consecutive perfect drops
  let cameraY = 0;         // current vertical pan offset
  let cameraTarget = 0;    // where the camera wants to be
  let flash = 0;           // perfect-drop flash timer
  let shake = 0;           // screen-shake magnitude (decays)
  let titlePulse = 0;      // animates the title prompt
  let lastDropPerfect = false;

  // ---- Best-score persistence (try/catch — storage may be blocked) --------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem('stackTowerBest') || '0', 10);
      return Number.isFinite(v) ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem('stackTowerBest', String(best)); } catch (e) { /* ignore */ }
  }

  // ---- Audio (WebAudio, created lazily on first input, fully guarded) ------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  // A short tone. `step` lets perfect-combo chimes rise in pitch.
  function tone(freq, dur, type, gain) {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.18, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* never let audio break the game */ }
  }
  function sndPlace() { tone(220, 0.12, 'square', 0.12); }
  function sndPerfect() {
    // rising chime — pitch climbs with the current combo
    const base = 520 + Math.min(combo, 8) * 70;
    tone(base, 0.16, 'triangle', 0.2);
    tone(base * 1.5, 0.18, 'sine', 0.12);
  }
  function sndSlice() { tone(140, 0.18, 'sawtooth', 0.1); }
  function sndOver() {
    tone(200, 0.25, 'sawtooth', 0.18);
    tone(120, 0.4, 'square', 0.14);
  }

  // ---- Color: gradient that climbs the tower ------------------------------
  // Hue cycles slowly with height so the stack reads as a smooth rainbow.
  function hueForLevel(level) {
    return (200 + level * 14) % 360;
  }
  function blockFill(hue, top, bottom) {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, `hsl(${hue}, 70%, 64%)`);
    g.addColorStop(1, `hsl(${hue}, 65%, 46%)`);
    return g;
  }

  // ---- Reset / start ------------------------------------------------------
  function resetGame() {
    best = loadBest();
    score = 0;
    combo = 0;
    particles = [];
    flash = 0;
    shake = 0;
    cameraY = 0;
    cameraTarget = 0;
    lastDropPerfect = false;

    // Foundation block sits centered at the bottom.
    stack = [{ x: START_X, w: FIRST_WIDTH, y: BASE_Y, hue: hueForLevel(0) }];

    spawnMover();
  }

  // Create a fresh sliding block above the top of the stack.
  function spawnMover() {
    const topBlock = stack[stack.length - 1];
    const w = topBlock.w;                 // inherit current playable width
    const y = topBlock.y - BLOCK_H;       // sits one row above the stack top
    const speed = Math.min(BASE_SPEED + score * SPEED_PER_BLOCK, MAX_SPEED);
    // Alternate the entry side and direction so it feels lively.
    const fromLeft = score % 2 === 0;
    mover = {
      x: fromLeft ? -w : W,
      w: w,
      y: y,
      hue: hueForLevel(stack.length),
      dir: fromLeft ? 1 : -1,
      speed: speed,
    };
  }

  function startGame() {
    resetGame();
    state = 'playing';
  }

  // ---- The drop: slice overhang, detect perfect, advance or end ----------
  function dropBlock() {
    const top = stack[stack.length - 1];
    const m = mover;

    // Overlap between the moving block and the block beneath it.
    const left = Math.max(m.x, top.x);
    const right = Math.min(m.x + m.w, top.x + top.w);
    const overlap = right - left;

    if (overlap <= 0) {
      // Total miss — the whole block tumbles away. Game over.
      spawnDebris(m.x, m.y, m.w, m.hue, true);
      mover = null;
      shake = 14;
      endGame();
      return;
    }

    const offset = Math.abs(m.x - top.x);
    if (offset <= PERFECT_TOL) {
      // PERFECT: snap to full alignment, keep the width, grow the combo.
      const placed = { x: top.x, w: top.w, y: m.y, hue: m.hue };
      stack.push(placed);
      combo += 1;
      flash = FLASH_TIME;
      lastDropPerfect = true;
      sndPerfect();
    } else {
      // Imperfect: slice the overhang off and let the offcut fall.
      const placed = { x: left, w: overlap, y: m.y, hue: m.hue };
      stack.push(placed);
      combo = 0;
      lastDropPerfect = false;

      // Spawn the sliced-off sliver as falling debris.
      if (m.x < top.x) {
        // overhang on the LEFT
        spawnDebris(m.x, m.y, top.x - m.x, m.hue, false, -1);
      } else {
        // overhang on the RIGHT
        const cutX = top.x + top.w;
        spawnDebris(cutX, m.y, (m.x + m.w) - cutX, m.hue, false, 1);
      }
      sndSlice();
      sndPlace();
      shake = 4;
    }

    score += 1;
    if (score > best) { best = score; saveBest(); }

    // Camera: keep the next block in the upper third of the view.
    const newTopY = stack[stack.length - 1].y;
    cameraTarget = Math.max(0, (BASE_Y - newTopY) - (H * 0.45));

    spawnMover();
  }

  // ---- Particles: chunky debris for the sliced-off piece ------------------
  // `whole` = the entire block missed; emit a wider burst. `side` tilts the
  // sideways velocity so offcuts fly outward.
  function spawnDebris(x, y, w, hue, whole, side) {
    if (w <= 0 && !whole) return;
    const cols = Math.max(2, Math.min(8, Math.round(w / 12)));
    const cw = (w || 40) / cols;
    for (let i = 0; i < cols; i++) {
      particles.push({
        x: (w ? x : x) + i * cw,
        y: y,
        w: Math.max(4, cw - 2),
        h: BLOCK_H,
        vx: (side || (Math.random() * 2 - 1)) * (40 + Math.random() * 80),
        vy: -60 - Math.random() * 80,
        life: 1.2 + Math.random() * 0.5,
        maxLife: 1.7,
        hue: hue,
        spin: (Math.random() * 2 - 1) * 6,
        rot: 0,
      });
    }
  }

  function endGame() {
    state = 'over';
    sndOver();
    if (window.Arcade) Arcade.submitScore('stack-tower', score);  // raw blocks stacked (height)
  }

  // ---- Input --------------------------------------------------------------
  function onPrimaryAction() {
    ensureAudio(); // create/resume audio on first interaction
    if (audioCtx && audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) { /* ignore */ }
    }
    if (state === 'playing') {
      dropBlock();
    } else {
      // title OR game-over -> (re)start
      startGame();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ' || e.code === 'Enter' || e.key === 'Enter') {
      e.preventDefault();
      onPrimaryAction();
    }
  }, { passive: false });

  // Pointer (mouse) and touch both drop / start.
  canvas.addEventListener('mousedown', (e) => { e.preventDefault(); onPrimaryAction(); });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onPrimaryAction(); }, { passive: false });

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // Camera always eases toward its target (so title/over screens are calm).
    cameraY += (cameraTarget - cameraY) * CAM_LERP;

    titlePulse += dt;
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 30);

    if (state === 'playing' && mover) {
      // Slide the active block, bouncing off both edges of the canvas.
      mover.x += mover.dir * mover.speed * dt;
      const minX = -mover.w * 0.15;          // allow a little overhang past edges
      const maxX = W - mover.w * 0.85;
      if (mover.x <= minX) { mover.x = minX; mover.dir = 1; }
      else if (mover.x >= maxX) { mover.x = maxX; mover.dir = -1; }
    }

    // Advance debris (gravity) regardless of state so it can finish falling.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y - cameraY > H + 80) particles.splice(i, 1);
    }
  }

  // ---- Render -------------------------------------------------------------
  function drawBlock(x, y, w, hue) {
    const top = y;
    const bottom = y + BLOCK_H;
    ctx.fillStyle = blockFill(hue, top, bottom);
    roundRect(x, top, w, BLOCK_H, 5);
    ctx.fill();
    // top highlight strip for a touch of dimensionality
    ctx.fillStyle = `hsla(${hue}, 80%, 78%, 0.5)`;
    roundRect(x + 2, top + 2, Math.max(0, w - 4), 5, 3);
    ctx.fill();
  }

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

  function render() {
    // Backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0c1320');
    bg.addColorStop(1, '#0a0d16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();

    // Screen-shake offset (only meaningful while it decays).
    const sx = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    // World is drawn shifted UP by cameraY so a growing tower stays on screen.
    ctx.translate(sx, cameraY + sy);

    // Stack
    for (let i = 0; i < stack.length; i++) {
      const b = stack[i];
      drawBlock(b.x, b.y, b.w, b.hue);
    }

    // Active sliding block
    if (state === 'playing' && mover) {
      drawBlock(mover.x, mover.y, mover.w, mover.hue);
      // Guide line down to the block beneath, to read alignment at a glance.
      const top = stack[stack.length - 1];
      ctx.strokeStyle = 'rgba(159,180,212,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(mover.x, mover.y + BLOCK_H);
      ctx.lineTo(mover.x, top.y);
      ctx.moveTo(mover.x + mover.w, mover.y + BLOCK_H);
      ctx.lineTo(mover.x + mover.w, top.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Falling debris (chunky rectangles)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(p.rot);
      ctx.fillStyle = `hsl(${p.hue}, 65%, 55%)`;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    ctx.restore(); // drop camera/shake transform — HUD is screen-space

    // Perfect-drop flash overlay
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(flash / FLASH_TIME) * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHud();

    if (state === 'title') drawTitle();
    else if (state === 'over') drawOver();
  }

  // ---- HUD & overlays -----------------------------------------------------
  function shadowText(text, x, y, font, color, align) {
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawHud() {
    // Height / score top-left, best top-right.
    shadowText(String(score), 18, 46, '700 34px "Segoe UI", system-ui, sans-serif', '#e7eefc', 'left');
    shadowText('HEIGHT', 18, 62, '600 11px "Segoe UI", system-ui, sans-serif', '#6b7890', 'left');
    shadowText('BEST ' + best, W - 18, 30, '600 13px "Segoe UI", system-ui, sans-serif', '#9fb4d4', 'right');

    // Combo badge when on a streak.
    if (state === 'playing' && combo > 1) {
      shadowText('PERFECT x' + combo, W / 2, 38, '700 16px "Segoe UI", system-ui, sans-serif', '#ffd66b', 'center');
    }
  }

  function dimPanel() {
    ctx.fillStyle = 'rgba(8,11,18,0.62)';
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    dimPanel();
    shadowText('STACK', W / 2, H / 2 - 64, '700 52px "Segoe UI", system-ui, sans-serif', '#cfe0ff', 'center');
    shadowText('TOWER', W / 2, H / 2 - 14, '700 52px "Segoe UI", system-ui, sans-serif', '#9fb4d4', 'center');

    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    shadowText('Press SPACE / ENTER to start', W / 2, H / 2 + 48, '600 17px "Segoe UI", system-ui, sans-serif', '#e7eefc', 'center');
    ctx.globalAlpha = 1;

    shadowText('Tap or press to drop each block.', W / 2, H / 2 + 92, '500 13px "Segoe UI", system-ui, sans-serif', '#8a99b3', 'center');
    shadowText('Line them up — overhang gets sliced off.', W / 2, H / 2 + 114, '500 13px "Segoe UI", system-ui, sans-serif', '#8a99b3', 'center');
  }

  function drawOver() {
    dimPanel();
    shadowText('GAME OVER', W / 2, H / 2 - 40, '700 40px "Segoe UI", system-ui, sans-serif', '#ff8a8a', 'center');
    shadowText('Height ' + score, W / 2, H / 2 + 6, '600 22px "Segoe UI", system-ui, sans-serif', '#e7eefc', 'center');

    const newBest = score > 0 && score >= best;
    if (newBest) {
      shadowText('NEW BEST!', W / 2, H / 2 + 38, '700 16px "Segoe UI", system-ui, sans-serif', '#ffd66b', 'center');
    } else {
      shadowText('Best ' + best, W / 2, H / 2 + 38, '600 15px "Segoe UI", system-ui, sans-serif', '#9fb4d4', 'center');
    }

    const a = 0.55 + 0.45 * Math.sin(titlePulse * 4);
    ctx.globalAlpha = a;
    shadowText('Press SPACE / ENTER to play again', W / 2, H / 2 + 84, '600 16px "Segoe UI", system-ui, sans-serif', '#e7eefc', 'center');
    ctx.globalAlpha = 1;
  }

  // ---- Main loop (delta-time, clamped against tab-switch jumps) -----------
  let lastT = performance.now();
  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05; // clamp: a backgrounded tab can't teleport blocks
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot: initialize ALL state before the first frame ------------------
  best = loadBest();
  resetGame();        // fills stack/mover/etc. so the title screen has real data
  state = 'title';    // ...but we sit on the title until the player presses go
  requestAnimationFrame(frame);
})();
