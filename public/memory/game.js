(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + context
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 600 internal resolution
  const H = canvas.height;  // 600

  // ---------------------------------------------------------------------------
  // Board geometry. Default 4x4 = 16 cards = 8 pairs.
  // ---------------------------------------------------------------------------
  const COLS = 4;
  const ROWS = 4;
  const PAIRS = (COLS * ROWS) / 2; // 8
  const BOARD_TOP = 96;            // leave room for the HUD up top
  const BOARD_PAD = 24;            // outer margin around the grid
  const CARD_GAP = 14;
  const CARD_W = (W - BOARD_PAD * 2 - CARD_GAP * (COLS - 1)) / COLS;
  const CARD_H = (H - BOARD_TOP - BOARD_PAD - CARD_GAP * (ROWS - 1)) / ROWS;

  // Per-card flip / mismatch timing (seconds).
  const FLIP_TIME = 0.22;     // how long the flip animation takes
  const MISMATCH_HOLD = 0.75; // how long a mismatched pair stays revealed

  // ---------------------------------------------------------------------------
  // Symbol set — 12 procedurally drawn glyphs, each its own colour. We pick the
  // first PAIRS of them per game, so every pair is a visually distinct symbol.
  // Each draw fn renders centred at (0,0) within a roughly [-r, r] box.
  // ---------------------------------------------------------------------------
  const SYMBOLS = [
    { color: '#ff5d73', draw: drawHeart },
    { color: '#54d6ff', draw: drawStar },
    { color: '#6bd968', draw: drawClover },
    { color: '#ffd93d', draw: drawBolt },
    { color: '#c084fc', draw: drawDiamond },
    { color: '#ff9f43', draw: drawSun },
    { color: '#7c8cff', draw: drawMoon },
    { color: '#34e0c4', draw: drawDrop },
    { color: '#ff7ac6', draw: drawFlower },
    { color: '#9fe04a', draw: drawTriangle },
    { color: '#ff6b6b', draw: drawSpade },
    { color: '#5ad1ff', draw: drawAnchor },
  ];

  // ---------------------------------------------------------------------------
  // Best score (fewest moves + fastest time) via localStorage, fully guarded.
  // ---------------------------------------------------------------------------
  const BEST_KEY = 'memory_match_best';
  function loadBest() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (!raw) return { moves: 0, time: 0 };
      const o = JSON.parse(raw);
      return {
        moves: Number.isFinite(o.moves) ? o.moves : 0,
        time: Number.isFinite(o.time) ? o.time : 0,
      };
    } catch (e) { return { moves: 0, time: 0 }; }
  }
  function saveBest(b) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
  }
  let best = loadBest();

  // ---------------------------------------------------------------------------
  // Audio — WebAudio only, created lazily on the first gesture, every call
  // guarded so a blocked/missing AudioContext can NEVER break the game.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }
  function tone(freq, dur, type, gain, delay) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.1));
      osc.connect(g).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (dur || 0.1) + 0.02);
    } catch (e) { /* ignore */ }
  }
  const sndFlip     = () => tone(360, 0.06, 'triangle', 0.08);
  const sndMatch    = () => { tone(660, 0.10, 'triangle', 0.12); tone(990, 0.14, 'triangle', 0.10, 0.08); };
  const sndMismatch = () => { tone(180, 0.18, 'sawtooth', 0.10); tone(120, 0.20, 'sawtooth', 0.09, 0.04); };
  function sndWin() {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, i * 0.10));
  }

  // ---------------------------------------------------------------------------
  // Game state — ALL initialized here at load so the title screen's update +
  // render never touch undefined. A valid board exists before the first frame.
  // ---------------------------------------------------------------------------
  const STATE = { TITLE: 0, PLAYING: 1, WIN: 2 };
  let state = STATE.TITLE;

  let cards = [];          // each card: {symIndex, col, row, x, y, faceUp, matched, flip, pulse}
  let first = null;        // first flipped card this turn (or null)
  let second = null;       // second flipped card (set briefly during resolve)
  let resolving = false;   // true while a mismatched pair is showing -> ignore clicks
  let resolveT = 0;        // countdown while resolving
  let moves = 0;
  let matchesFound = 0;
  let elapsed = 0;         // seconds since the first flip of the game
  let started = false;     // timer starts on the first card flip
  let winFlash = 0;        // brightness flourish on win
  const particles = [];    // confetti on win

  // Build a fresh, shuffled board. Called at load AND on restart, so a valid
  // grid is always present.
  function newGame() {
    cards = [];
    first = null;
    second = null;
    resolving = false;
    resolveT = 0;
    moves = 0;
    matchesFound = 0;
    elapsed = 0;
    started = false;
    winFlash = 0;
    particles.length = 0;

    // Choose PAIRS distinct symbols, two of each, then shuffle.
    const deck = [];
    for (let i = 0; i < PAIRS; i++) { deck.push(i); deck.push(i); }
    shuffle(deck);

    for (let i = 0; i < deck.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      cards.push({
        symIndex: deck[i],
        col, row,
        x: BOARD_PAD + col * (CARD_W + CARD_GAP),
        y: BOARD_TOP + row * (CARD_H + CARD_GAP),
        faceUp: false,    // logically revealed?
        matched: false,
        flip: 0,          // 0 = face-down, 1 = face-up (animated)
        pulse: 0,         // brief scale pop when matched
      });
    }
  }

  // Fisher–Yates shuffle.
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }

  // CRITICAL: build the board now so render() at load has real data.
  newGame();

  // ---------------------------------------------------------------------------
  // Confetti for the win flourish.
  // ---------------------------------------------------------------------------
  const CONFETTI_COLORS = ['#ff5d73', '#54d6ff', '#ffd93d', '#6bd968', '#c084fc', '#ff9f43'];
  function spawnConfetti() {
    for (let i = 0; i < 140; i++) {
      particles.push({
        x: Math.random() * W,
        y: -10 - Math.random() * H * 0.5,
        vx: (Math.random() * 2 - 1) * 60,
        vy: 80 + Math.random() * 200,
        size: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() * 2 - 1) * 8,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        life: 2.0 + Math.random() * 1.5,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function onUserGesture() { initAudio(); }

  // Map a clientX/Y onto the canvas's internal 600x600 coordinate space.
  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  function cardAt(px, py) {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (px >= c.x && px <= c.x + CARD_W && py >= c.y && py <= c.y + CARD_H) return c;
    }
    return null;
  }

  // The first flip of the game starts the timer.
  function flipCard(c) {
    if (!started) { started = true; elapsed = 0; }
    c.faceUp = true;
    sndFlip();
  }

  function handleClick(px, py) {
    if (state === STATE.TITLE) { state = STATE.PLAYING; return; }
    if (state === STATE.WIN) { newGame(); state = STATE.PLAYING; return; }

    // Ignore clicks entirely while a mismatched pair is resolving.
    if (resolving) return;

    const c = cardAt(px, py);
    if (!c) return;
    if (c.matched || c.faceUp) return; // already revealed or solved

    if (!first) {
      // First card of the turn.
      first = c;
      flipCard(c);
    } else if (c !== first) {
      // Second card -> count a move and check for a match.
      second = c;
      flipCard(c);
      moves++;

      if (first.symIndex === c.symIndex) {
        // Match! Lock both, pop them, score the pair.
        first.matched = true;
        c.matched = true;
        first.pulse = 1;
        c.pulse = 1;
        matchesFound++;
        sndMatch();
        first = null;
        second = null;
        if (matchesFound >= PAIRS) winGame();
      } else {
        // Mismatch -> hold both face-up briefly, then flip back. Lock input.
        resolving = true;
        resolveT = MISMATCH_HOLD;
        sndMismatch();
      }
    }
  }

  function winGame() {
    state = STATE.WIN;
    winFlash = 1;
    started = false;
    spawnConfetti();
    sndWin();
    // Update best: prefer fewer moves; tie-break on faster time.
    const better =
      best.moves === 0 ||
      moves < best.moves ||
      (moves === best.moves && elapsed < best.time);
    if (better) {
      best = { moves, time: Math.round(elapsed * 10) / 10 };
      saveBest(best);
    }
  }

  // Click / tap.
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onUserGesture();
    const p = pointerToCanvas(e.clientX, e.clientY);
    handleClick(p.x, p.y);
  });
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onUserGesture();
    if (e.touches[0]) {
      const p = pointerToCanvas(e.touches[0].clientX, e.touches[0].clientY);
      handleClick(p.x, p.y);
    }
  }, { passive: false });

  // Keyboard: R or Enter = new game / restart (and start from title).
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r' || k === 'enter') {
      e.preventDefault();
      onUserGesture();
      if (state === STATE.TITLE) {
        state = STATE.PLAYING;
      } else {
        newGame();
        state = STATE.PLAYING;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Tick the play clock once the first card has been flipped.
    if (state === STATE.PLAYING && started) elapsed += dt;

    // Animate every card's flip toward its target (0 face-down, 1 face-up).
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const target = c.faceUp ? 1 : 0;
      const step = dt / FLIP_TIME;
      if (c.flip < target) c.flip = Math.min(target, c.flip + step);
      else if (c.flip > target) c.flip = Math.max(target, c.flip - step);
      if (c.pulse > 0) c.pulse = Math.max(0, c.pulse - dt * 3.2);
    }

    // Resolve a mismatched pair: after the hold, flip both back and unlock.
    if (resolving) {
      resolveT -= dt;
      if (resolveT <= 0) {
        if (first) first.faceUp = false;
        if (second) second.faceUp = false;
        first = null;
        second = null;
        resolving = false;
      }
    }

    // Win flourish decay + confetti physics.
    if (winFlash > 0) winFlash = Math.max(0, winFlash - dt * 1.5);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 20) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt; // gravity
      p.vx *= 0.99;
      p.rot += p.vrot * dt;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function draw() {
    drawBackground();
    drawHUD();

    for (let i = 0; i < cards.length; i++) drawCard(cards[i]);

    // Confetti on top of the board.
    for (const p of particles) drawConfetti(p);

    if (state === STATE.TITLE) drawTitle();
    else if (state === STATE.WIN) drawWin();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0c1220');
    g.addColorStop(1, '#05070b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(124, 140, 255, 0.10)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }

  function drawHUD() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#cdd6e4';
    ctx.fillText('MOVES  ' + moves, 18, 20);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cdd6e4';
    ctx.fillText('TIME  ' + formatTime(elapsed), W - 18, 20);

    // Best line (centred, dimmer). Only meaningful once a game's been won.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb4d4';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    if (best.moves > 0) {
      ctx.fillText('BEST  ' + best.moves + ' moves · ' + formatTime(best.time), W / 2, 24);
    } else {
      ctx.fillText('BEST  —', W / 2, 24);
    }

    // Pairs-found progress, centred just below.
    ctx.fillStyle = '#6b7890';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PAIRS  ' + matchesFound + ' / ' + PAIRS, W / 2, 50);
    ctx.restore();
  }

  // Draw a single card. The flip is faked with a horizontal scale: as `flip`
  // crosses 0.5 we swap from the back design to the face. Squeezing scaleX to
  // ~0 at the midpoint reads as a card turning over.
  function drawCard(c) {
    const cx = c.x + CARD_W / 2;
    const cy = c.y + CARD_H / 2;

    // flip 0..1 -> scaleX. cos gives 1 -> 0 -> 1 as flip goes 0 -> .5 -> 1.
    let scaleX = Math.cos(c.flip * Math.PI);
    const showFace = c.flip > 0.5;        // past halfway we show the front
    scaleX = Math.abs(scaleX);
    if (scaleX < 0.02) scaleX = 0.02;     // keep a sliver visible at the edge

    // Matched cards get a brief pop (overall scale) for juice.
    const pop = 1 + c.pulse * 0.10;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX * pop, pop);
    ctx.translate(-CARD_W / 2, -CARD_H / 2);

    if (showFace) drawCardFace(c);
    else drawCardBack(c);

    ctx.restore();
  }

  // Face-down: a deep panel with a subtle diamond motif and a soft border.
  function drawCardBack(c) {
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, '#243049');
    g.addColorStop(1, '#161d2e');
    ctx.fillStyle = g;
    roundRect(0, 0, CARD_W, CARD_H, 12);
    ctx.fill();

    ctx.strokeStyle = 'rgba(159, 180, 212, 0.35)';
    ctx.lineWidth = 2;
    roundRect(2, 2, CARD_W - 4, CARD_H - 4, 10);
    ctx.stroke();

    // Centre diamond emblem.
    ctx.save();
    ctx.translate(CARD_W / 2, CARD_H / 2);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#9fb4d4';
    ctx.lineWidth = 2;
    const r = Math.min(CARD_W, CARD_H) * 0.18;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.5, 0); ctx.lineTo(0, r * 0.5); ctx.lineTo(-r * 0.5, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Face-up: light panel + the card's symbol drawn in its colour. Matched cards
  // get a coloured glow so the solved pairs stand out.
  function drawCardFace(c) {
    const sym = SYMBOLS[c.symIndex];

    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, c.matched ? '#1c2c2a' : '#eef3fb');
    g.addColorStop(1, c.matched ? '#142421' : '#cdd9ec');
    ctx.fillStyle = g;
    roundRect(0, 0, CARD_W, CARD_H, 12);
    ctx.fill();

    ctx.strokeStyle = c.matched ? sym.color : 'rgba(124,140,255,0.5)';
    ctx.lineWidth = c.matched ? 3 : 2;
    roundRect(2, 2, CARD_W - 4, CARD_H - 4, 10);
    ctx.stroke();

    // Draw the symbol centred, scaled to the card.
    ctx.save();
    ctx.translate(CARD_W / 2, CARD_H / 2);
    const r = Math.min(CARD_W, CARD_H) * 0.30;
    if (c.matched) {
      ctx.shadowColor = sym.color;
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = sym.color;
    ctx.strokeStyle = sym.color;
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.lineJoin = 'round';
    sym.draw(r);
    ctx.restore();
  }

  function drawConfetti(p) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }

  // Shared overlay helpers ----------------------------------------------------
  function dimScreen(alpha) {
    ctx.fillStyle = `rgba(5, 7, 11, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }
  function centerText(text, y, size, color, weight) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.font = `${weight || 600} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  function drawTitle() {
    dimScreen(0.62);
    centerText('MEMORY MATCH', H / 2 - 96, 46, '#9fb4d4', 700);
    centerText('Flip cards two at a time and find every pair', H / 2 - 46, 18, '#cdd6e4', 400);
    centerText('Fewest moves & fastest time win', H / 2 - 18, 16, '#9fb4d4', 400);

    // A little row of preview symbols for flavour.
    const preview = [0, 1, 2, 3, 4];
    const spacing = 64;
    const startX = W / 2 - (preview.length - 1) * spacing / 2;
    for (let i = 0; i < preview.length; i++) {
      const s = SYMBOLS[preview[i]];
      ctx.save();
      ctx.translate(startX + i * spacing, H / 2 + 36);
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      s.draw(18);
      ctx.restore();
    }

    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Click any card  ·  or press ENTER', H / 2 + 104, 22, '#54d6ff', 700);
    ctx.globalAlpha = 1;
  }

  function drawWin() {
    // Brief white flash on the moment of victory, fading out.
    if (winFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${winFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    dimScreen(0.5);
    centerText('YOU WIN!', H / 2 - 86, 56, '#ffd93d', 700);
    centerText('Moves  ' + moves, H / 2 - 22, 26, '#cdd6e4', 600);
    centerText('Time  ' + formatTime(elapsed), H / 2 + 14, 24, '#cdd6e4', 600);
    if (best.moves > 0) {
      centerText('Best  ' + best.moves + ' moves · ' + formatTime(best.time),
        H / 2 + 50, 18, '#9fb4d4', 500);
    }
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 350);
    ctx.globalAlpha = a;
    centerText('Press R or ENTER to play again', H / 2 + 108, 22, '#54d6ff', 700);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Symbol drawing functions. Each is centred at (0,0); `r` is the symbol's
  // radius. ctx.fillStyle / strokeStyle are pre-set to the symbol's colour.
  // ---------------------------------------------------------------------------
  function drawHeart(r) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.85);
    ctx.bezierCurveTo(r * 1.3, r * 0.1, r * 0.55, -r * 0.95, 0, -r * 0.25);
    ctx.bezierCurveTo(-r * 0.55, -r * 0.95, -r * 1.3, r * 0.1, 0, r * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  function drawStar(r) {
    star(r, r * 0.45, 5);
    ctx.fill();
  }
  function star(outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = (i % 2 === 0) ? outer : inner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawClover(r) {
    const lr = r * 0.42;
    const off = r * 0.42;
    ctx.beginPath(); ctx.arc(0, -off, lr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-off, off * 0.5, lr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(off, off * 0.5, lr, 0, Math.PI * 2); ctx.fill();
    // stem
    ctx.fillRect(-r * 0.07, off * 0.3, r * 0.14, r * 0.7);
  }
  function drawBolt(r) {
    ctx.beginPath();
    ctx.moveTo(r * 0.15, -r);
    ctx.lineTo(-r * 0.55, r * 0.15);
    ctx.lineTo(-r * 0.05, r * 0.15);
    ctx.lineTo(-r * 0.2, r);
    ctx.lineTo(r * 0.6, -r * 0.2);
    ctx.lineTo(r * 0.05, -r * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  function drawDiamond(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.8, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    // facet lines for sparkle
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0);
    ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
  }
  function drawSun(r) {
    // rays
    ctx.lineWidth = Math.max(2, r * 0.14);
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawMoon(r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2.2, Math.PI / 2.2, false);
    ctx.arc(r * 0.5, 0, r * 0.85, Math.PI / 2.6, -Math.PI / 2.6, true);
    ctx.closePath();
    ctx.fill();
  }
  function drawDrop(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.9, -r * 0.1, r * 0.7, r, 0, r);
    ctx.bezierCurveTo(-r * 0.7, r, -r * 0.9, -r * 0.1, 0, -r);
    ctx.closePath();
    ctx.fill();
  }
  function drawFlower(r) {
    const petals = 6;
    const pr = r * 0.42;
    for (let i = 0; i < petals; i++) {
      const a = (Math.PI * 2 / petals) * i;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    // centre
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawTriangle(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.92, r * 0.7);
    ctx.lineTo(-r * 0.92, r * 0.7);
    ctx.closePath();
    ctx.fill();
  }
  function drawSpade(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 1.05, r * 0.15, r * 0.5, r * 0.6, r * 0.12, r * 0.3);
    ctx.bezierCurveTo(r * 0.3, r * 0.7, r * 0.4, r * 0.78, r * 0.5, r * 0.9);
    ctx.lineTo(-r * 0.5, r * 0.9);
    ctx.bezierCurveTo(-r * 0.4, r * 0.78, -r * 0.3, r * 0.7, -r * 0.12, r * 0.3);
    ctx.bezierCurveTo(-r * 0.5, r * 0.6, -r * 1.05, r * 0.15, 0, -r);
    ctx.closePath();
    ctx.fill();
  }
  function drawAnchor(r) {
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.lineCap = 'round';
    // ring
    ctx.beginPath();
    ctx.arc(0, -r * 0.78, r * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    // shaft
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5);
    ctx.lineTo(0, r * 0.8);
    ctx.stroke();
    // crossbar
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.2);
    ctx.lineTo(r * 0.5, -r * 0.2);
    ctx.stroke();
    // arc fluke
    ctx.beginPath();
    ctx.arc(0, r * 0.2, r * 0.65, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.stroke();
  }

  // Rounded-rectangle path helper (fill/stroke applied by the caller).
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

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // ---------------------------------------------------------------------------
  // Main loop — delta-time with requestAnimationFrame. dt is clamped so a tab
  // switch can't make the timer jump or fling confetti in one frame.
  // ---------------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp worst-case
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
