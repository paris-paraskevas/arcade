/*
 * SIMON — the memory-sequence game.
 *
 * Each round the machine appends one more pad to a growing sequence and plays
 * it back (light + tone). The player must repeat the whole sequence by clicking
 * the pads. A full correct repeat advances the round and speeds playback up a
 * touch; a single wrong press ends the run. Best round is kept in localStorage.
 *
 * House-rules notes:
 *  - Self-contained, file://-safe, classic <script> + IIFE. No external files.
 *  - ALL state is initialised at load (see the `state` object and pad table)
 *    so the title screen's update()/render() never touch anything undefined.
 *  - WebAudio is created lazily on the first user input and every audio call is
 *    wrapped in try/catch, so sound can never break the game.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Canvas + constants
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 520
  const H = canvas.height;  // 560

  const HUD_H = 40;                 // bottom band reserved for score text
  const BOARD = H - HUD_H;          // 520 — the square playfield for the pads
  const CX = W / 2;
  const CY = BOARD / 2;
  const OUTER_R = 240;              // outer radius of the pad ring
  const INNER_R = 96;              // inner radius (the dark hub punches a hole)
  const GAP = 0.045;                // radian gap between adjacent pads

  // localStorage key for the best round reached.
  const LS_KEY = 'simon.best';

  // The four pads. Each owns a quadrant (angles in radians, 0 = +x, clockwise
  // because canvas y grows downward), a base/lit colour, a tone frequency, and
  // a key binding. The angle ranges below place: green=top-left, red=top-right,
  // yellow=bottom-left, blue=bottom-right.
  const PADS = [
    { name: 'green',  start: Math.PI,            end: Math.PI * 1.5,      base: '#1f7a3d', lit: '#5dffa0', freq: 329.63, key: '1' }, // E4
    { name: 'red',    start: Math.PI * 1.5,      end: Math.PI * 2,        base: '#8f2230', lit: '#ff6b7d', freq: 261.63, key: '2' }, // C4
    { name: 'yellow', start: Math.PI * 0.5,      end: Math.PI,            base: '#9a8420', lit: '#ffe45e', freq: 220.00, key: '3' }, // A3
    { name: 'blue',   start: 0,                  end: Math.PI * 0.5,      base: '#1f4f8f', lit: '#6bb6ff', freq: 392.00, key: '4' }  // G4
  ];

  // ---------------------------------------------------------------------------
  // Game state — every field gets a valid value right here at load time.
  // ---------------------------------------------------------------------------
  const PHASE = { TITLE: 'title', PLAYBACK: 'playback', INPUT: 'input', OVER: 'over' };

  const state = {
    phase: PHASE.TITLE,
    sequence: [],        // array of pad indices, grows by one each round
    round: 0,            // current round number (== sequence length while playing)
    best: loadBest(),    // best round reached, from localStorage
    inputPos: 0,         // how many correct presses the player has made this round
    // Playback bookkeeping:
    pbIndex: 0,          // which step of the sequence is being shown
    pbTimer: 0,          // ms accumulator for the current playback step
    pbOn: 100,           // ms a pad stays lit (set from speed each round)
    pbOff: 90,           // ms gap between lit pads
    pbLit: false,        // is a pad currently lit during playback?
    // Visual flash per pad: flash[i] decays 1 -> 0 and brightens that pad.
    flash: [0, 0, 0, 0],
    activePad: -1,       // pad currently held down by the player (for press feel)
    overTimer: 0,        // ms since game over (drives the buzzer flash)
    titlePulse: 0,       // animates the title prompt
    shake: 0             // screen-shake magnitude on a wrong answer
  };

  // ---------------------------------------------------------------------------
  // localStorage helpers (wrapped — storage can throw in some browsers)
  // ---------------------------------------------------------------------------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(LS_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(LS_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // WebAudio — created lazily on first input, every call guarded by try/catch.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }

  // Sustained, slightly soft tone for a pad. `dur` in seconds.
  function playTone(freq, dur) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      // Quick attack, gentle release so repeated tones don't click.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      gain.gain.setValueAtTime(0.22, now + Math.max(0.02, dur - 0.06));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (e) { /* never let audio break the game */ }
  }

  // Harsh descending buzzer for a mistake.
  function playBuzzer() {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.6);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.62);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Round / sequence control
  // ---------------------------------------------------------------------------
  // ms countdown for the pause between a correct repeat and the next playback.
  // Declared at load (not undefined) and reset whenever a game starts.
  let nextRoundDelay = 0;

  function startGame() {
    state.sequence = [];
    state.round = 0;
    state.flash = [0, 0, 0, 0];
    state.activePad = -1;
    nextRoundDelay = 0;
    nextRound();
  }

  // Append one random pad and begin playback of the whole sequence.
  function nextRound() {
    state.round += 1;
    state.sequence.push((Math.random() * 4) | 0);
    state.inputPos = 0;

    // Playback gets faster as the round climbs, with a sensible floor so it
    // stays watchable. ~100ms quicker isn't applied all at once — we shorten
    // both the lit time and the gap a little each round.
    const speedup = Math.min(state.round * 14, 220);
    state.pbOn = Math.max(180, 480 - speedup);
    state.pbOff = Math.max(70, 200 - speedup);

    beginPlayback();
  }

  function beginPlayback() {
    state.phase = PHASE.PLAYBACK;
    state.pbIndex = 0;
    state.pbTimer = 0;
    state.pbLit = false;
  }

  // Player pressed a pad during the INPUT phase. Validate against the sequence.
  function registerPress(padIndex) {
    if (state.phase !== PHASE.INPUT) return;
    // Ignore presses during the brief success pause before the next round,
    // otherwise inputPos would already equal the length and a stray click
    // would read sequence[inputPos] === undefined and falsely end the game.
    if (nextRoundDelay > 0) return;

    // Light + sound the pressed pad regardless of correctness for feedback.
    state.flash[padIndex] = 1;

    const expected = state.sequence[state.inputPos];
    if (padIndex !== expected) {
      // Wrong — game over.
      playBuzzer();
      state.shake = 14;
      state.phase = PHASE.OVER;
      state.overTimer = 0;
      if (state.round - 1 > state.best) {   // round - 1: last fully-cleared round
        state.best = state.round - 1;
        saveBest(state.best);
      }
      // We also track the round actually reached as the score; keep `round`.
      return;
    }

    // Correct press.
    playTone(PADS[padIndex].freq, 0.3);
    state.inputPos += 1;

    if (state.inputPos >= state.sequence.length) {
      // Whole sequence repeated — pause briefly (handled in update) so the
      // success registers, then nextRound() starts the next playback.
      scheduleNextRound();
    }
  }

  // Use a tiny timer (handled in update) to pause before the next round.
  function scheduleNextRound() {
    nextRoundDelay = 520; // ms
  }

  // ---------------------------------------------------------------------------
  // Hit testing — convert a click point to a pad index (or -1).
  // ---------------------------------------------------------------------------
  function padAtPoint(px, py) {
    const dx = px - CX;
    const dy = py - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < INNER_R || dist > OUTER_R) return -1; // hub or outside ring
    // atan2 gives -PI..PI; normalise to 0..2PI to match pad ranges.
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI * 2;
    for (let i = 0; i < PADS.length; i++) {
      if (a >= PADS[i].start && a < PADS[i].end) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------
  function handlePadActivate(padIndex) {
    if (padIndex < 0) return;
    state.activePad = padIndex;
    registerPress(padIndex);
  }

  function onPointerDown(e) {
    ensureAudio();
    e.preventDefault();

    // Title or game-over: any click starts / restarts.
    if (state.phase === PHASE.TITLE || state.phase === PHASE.OVER) {
      startGame();
      return;
    }
    if (state.phase !== PHASE.INPUT) return; // locked out during playback

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    handlePadActivate(padAtPoint(px, py));
  }

  function onPointerUp() {
    state.activePad = -1;
  }

  function onKeyDown(e) {
    ensureAudio();
    const k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'Spacebar') {
      e.preventDefault();
      if (state.phase === PHASE.TITLE || state.phase === PHASE.OVER) startGame();
      return;
    }

    // Keys 1-4 map to pads (bonus control), only during the input phase.
    if (state.phase === PHASE.INPUT) {
      for (let i = 0; i < PADS.length; i++) {
        if (k === PADS[i].key) {
          e.preventDefault();
          handlePadActivate(i);
          return;
        }
      }
    }
  }

  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('touchstart', (e) => {
    // Route the first touch through the same path as a mouse click.
    if (e.touches && e.touches.length) {
      const t = e.touches[0];
      onPointerDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
    }
  }, { passive: false });
  window.addEventListener('touchend', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  // ---------------------------------------------------------------------------
  // Update — advances playback, flash decay, timers. dt is in ms (clamped).
  // ---------------------------------------------------------------------------
  function update(dt) {
    // Decay every pad's flash toward 0 (fast enough to feel snappy).
    for (let i = 0; i < state.flash.length; i++) {
      if (state.flash[i] > 0) {
        state.flash[i] -= dt / 220;
        if (state.flash[i] < 0) state.flash[i] = 0;
      }
    }

    // Decay screen-shake.
    if (state.shake > 0) {
      state.shake -= dt / 40;
      if (state.shake < 0) state.shake = 0;
    }

    state.titlePulse += dt / 600;

    if (state.phase === PHASE.PLAYBACK) {
      updatePlayback(dt);
    } else if (state.phase === PHASE.INPUT) {
      // Handle the scheduled pause before the next round.
      if (nextRoundDelay > 0) {
        nextRoundDelay -= dt;
        if (nextRoundDelay <= 0) {
          nextRoundDelay = 0;
          nextRound();
        }
      }
    } else if (state.phase === PHASE.OVER) {
      state.overTimer += dt;
    }
  }

  // Steps through the sequence: light a pad for pbOn ms, dark for pbOff ms.
  function updatePlayback(dt) {
    state.pbTimer += dt;

    if (!state.pbLit) {
      // Waiting in the gap before lighting the next pad.
      if (state.pbTimer >= state.pbOff) {
        state.pbTimer = 0;
        state.pbLit = true;
        const pad = state.sequence[state.pbIndex];
        state.flash[pad] = 1;
        playTone(PADS[pad].freq, state.pbOn / 1000);
      }
    } else {
      // Pad is lit; hold for pbOn then move on.
      if (state.pbTimer >= state.pbOn) {
        state.pbTimer = 0;
        state.pbLit = false;
        state.pbIndex += 1;
        if (state.pbIndex >= state.sequence.length) {
          // Playback finished — hand control to the player.
          state.phase = PHASE.INPUT;
          state.inputPos = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Blend a base colour toward its lit colour by t (0..1). Colours are #rrggbb.
  function mix(baseHex, litHex, t) {
    const b = hexToRgb(baseHex);
    const l = hexToRgb(litHex);
    const r = Math.round(b.r + (l.r - b.r) * t);
    const g = Math.round(b.g + (l.g - b.g) * t);
    const bl = Math.round(b.b + (l.b - b.b) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // Draw a single quadrant pad as a thick ring segment.
  function drawPad(i) {
    const pad = PADS[i];
    const lit = Math.max(state.flash[i], state.activePad === i ? 0.5 : 0);
    const color = lit > 0 ? mix(pad.base, pad.lit, Math.min(1, lit)) : pad.base;

    // Slightly inset each segment using the GAP so pads read as separate.
    const a0 = pad.start + GAP;
    const a1 = pad.end - GAP;

    ctx.beginPath();
    ctx.arc(CX, CY, OUTER_R, a0, a1, false);
    ctx.arc(CX, CY, INNER_R, a1, a0, true);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();

    // Glow when lit.
    if (lit > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = pad.lit;
      ctx.shadowBlur = 40 * lit;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.12 * lit) + ')';
      ctx.fill();
      ctx.restore();
    }

    // Subtle edge so the disc has definition on the dark page.
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
  }

  function drawBoard() {
    // Outer dark disc behind the pads.
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER_R + 8, 0, Math.PI * 2);
    ctx.fillStyle = '#05070b';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#12161f';
    ctx.stroke();

    for (let i = 0; i < PADS.length; i++) drawPad(i);

    // Central hub.
    ctx.beginPath();
    ctx.arc(CX, CY, INNER_R - 6, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(CX, CY - 20, 10, CX, CY, INNER_R);
    grad.addColorStop(0, '#1a2230');
    grad.addColorStop(1, '#0a0d13');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#222b3a';
    ctx.stroke();

    // Hub label depends on phase.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state.phase === PHASE.PLAYBACK) {
      ctx.fillStyle = '#9fb4d4';
      ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('WATCH', CX, CY - 10);
      ctx.fillStyle = '#6b7890';
      ctx.font = '13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('round ' + state.round, CX, CY + 14);
    } else if (state.phase === PHASE.INPUT) {
      ctx.fillStyle = '#9fb4d4';
      ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('REPEAT', CX, CY - 10);
      ctx.fillStyle = '#6b7890';
      ctx.font = '13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(state.inputPos + ' / ' + state.sequence.length, CX, CY + 14);
    } else {
      // Title / over: a small Simon glyph.
      ctx.fillStyle = '#3a4658';
      ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('SIMON', CX, CY);
    }
  }

  function drawHUD() {
    ctx.textBaseline = 'middle';
    const y = BOARD + HUD_H / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#cdd6e4';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    // While playing, show the round the player is currently on.
    const shown = (state.phase === PHASE.TITLE) ? 0 : state.round;
    ctx.fillText('ROUND  ' + shown, 18, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#9fb4d4';
    ctx.fillText('BEST  ' + state.best, W - 18, y);
    ctx.restore();
  }

  // A centered translucent panel used by title and game-over overlays.
  function drawPanel(lines) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,11,0.72)';
    ctx.fillRect(0, 0, W, BOARD);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = CY - (lines.length - 1) * 18;
    for (const line of lines) {
      ctx.fillStyle = line.color || '#cdd6e4';
      ctx.font = line.font || '16px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(line.text, CX, y);
      y += line.gap || 36;
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Apply screen-shake by translating the whole board a touch.
    ctx.save();
    if (state.shake > 0) {
      const s = state.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawBoard();
    ctx.restore();

    drawHUD();

    if (state.phase === PHASE.TITLE) {
      const pulse = 0.5 + 0.5 * Math.sin(state.titlePulse);
      drawPanel([
        { text: 'SIMON', color: '#9fb4d4', font: '700 40px "Segoe UI", system-ui, sans-serif', gap: 46 },
        { text: 'Watch the sequence, then repeat it.', color: '#cdd6e4', font: '15px "Segoe UI", system-ui, sans-serif', gap: 28 },
        { text: 'Each round adds one more step.', color: '#8a97ac', font: '13px "Segoe UI", system-ui, sans-serif', gap: 44 },
        { text: 'Press  SPACE  or  CLICK  to start', color: 'rgba(159,180,212,' + (0.45 + 0.55 * pulse) + ')', font: '600 16px "Segoe UI", system-ui, sans-serif', gap: 30 }
      ]);
    } else if (state.phase === PHASE.OVER) {
      // Red wash that fades as the buzzer dies down.
      const flash = Math.max(0, 1 - state.overTimer / 600);
      ctx.fillStyle = 'rgba(255,40,60,' + (0.25 * flash) + ')';
      ctx.fillRect(0, 0, W, BOARD);

      const reached = state.round;            // round at which the mistake happened
      const cleared = Math.max(0, state.round - 1);
      const pulse = 0.5 + 0.5 * Math.sin(state.titlePulse);
      drawPanel([
        { text: 'GAME OVER', color: '#ff6b7d', font: '700 36px "Segoe UI", system-ui, sans-serif', gap: 44 },
        { text: 'You cleared round ' + cleared, color: '#cdd6e4', font: '17px "Segoe UI", system-ui, sans-serif', gap: 28 },
        { text: 'Best round: ' + state.best, color: '#9fb4d4', font: '14px "Segoe UI", system-ui, sans-serif', gap: 46 },
        { text: 'Press  SPACE  or  CLICK  to play again', color: 'rgba(159,180,212,' + (0.45 + 0.55 * pulse) + ')', font: '600 15px "Segoe UI", system-ui, sans-serif', gap: 30 }
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop — rAF with clamped delta time.
  // ---------------------------------------------------------------------------
  let lastTime = performance.now();
  function frame(now) {
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100; // clamp so a tab-switch can't fast-forward playback
    if (dt < 0) dt = 0;

    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // Kick off the loop. State is already fully initialised above, so the title
  // screen renders correctly on the very first frame.
  requestAnimationFrame(frame);
})();
