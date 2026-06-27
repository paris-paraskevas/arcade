// arcade-touch.js — shared touch controls for every game page.
// On touch devices (or with ?touch in the URL for testing) it renders an
// on-screen control overlay and bridges taps / swipes / button presses to the
// keydown + mouse inputs the games already listen for. Config is a central
// registry keyed by the URL slug, so games need ZERO code changes.
//
// Buttons use Pointer Events (work for touch AND mouse, so they're testable).
// Synthetic KeyboardEvents are dispatched on `document` with bubbles:true, so
// they reach both document- and window-level listeners with a single dispatch.
(() => {
  'use strict';
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const forced = location.search.indexOf('touch') !== -1;
  if (!coarse && !forced) return; // desktop with a mouse: keep keyboard, no overlay

  const parts = location.pathname.split('/').filter(Boolean);
  const slug = parts.filter((p) => p.indexOf('.') === -1).pop() || '';

  // ---- key dispatch -------------------------------------------------------
  const CODE2KEY = { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Space: ' ', Enter: 'Enter', KeyU: 'u', KeyR: 'r', KeyZ: 'z', KeyX: 'x' };
  const KEYCODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32, Enter: 13, KeyU: 85, KeyR: 82, KeyZ: 90, KeyX: 88 };
  function key(type, code) {
    const init = { key: CODE2KEY[code] || code, code, keyCode: KEYCODE[code] || 0, which: KEYCODE[code] || 0, bubbles: true, cancelable: true };
    try { document.dispatchEvent(new KeyboardEvent(type, init)); } catch (e) {}
  }
  function tapKey(code) { key('keydown', code); setTimeout(() => key('keyup', code), 70); }

  // ---- registry: slug -> control scheme -----------------------------------
  // canvas: 'press' = down→keydown(code) / up→keyup(code) (tap & hold both work)
  //         'drag'  = bridge touch → mouse (for mouse-driven games)
  // swipe: 4-direction swipe → arrow keys (tap → start)
  // left/right: button clusters; each {l: label, c: code}
  const DPAD = [{ l: '◀', c: 'ArrowLeft' }, { l: '▶', c: 'ArrowRight' }, { l: '▲', c: 'ArrowUp' }, { l: '▼', c: 'ArrowDown' }];
  const LR = [{ l: '◀', c: 'ArrowLeft' }, { l: '▶', c: 'ArrowRight' }];
  const REG = {
    // one-button (tap/hold the playfield)
    flappy: { start: 'Space', canvas: 'press', code: 'Space' },
    helicopter: { start: 'Space', canvas: 'press', code: 'Space' },
    'stack-tower': { start: 'Space', canvas: 'press', code: 'Space' },
    'dino-runner': { start: 'Space', canvas: 'press', code: 'Space', right: [{ l: 'DUCK', c: 'ArrowDown' }] },
    // 4-direction
    snake: { start: 'Space', left: DPAD, swipe: true },
    frogger: { start: 'Space', left: DPAD, swipe: true },
    sokoban: { start: 'Space', left: DPAD, right: [{ l: 'UNDO', c: 'KeyU' }, { l: 'RST', c: 'KeyR' }] },
    '2048': { start: 'Enter', swipe: true },
    'doodle-jump': { start: 'Space', left: LR },
    // multi-button action
    'weekend-racer': { start: 'Space', left: [{ l: '◀', c: 'ArrowLeft' }, { l: '▶', c: 'ArrowRight' }], right: [{ l: 'GAS', c: 'ArrowUp' }, { l: 'BRK', c: 'ArrowDown' }] },
    asteroids: { start: 'Enter', left: [{ l: '↺', c: 'ArrowLeft' }, { l: '↻', c: 'ArrowRight' }], right: [{ l: 'THR', c: 'ArrowUp' }, { l: 'FIRE', c: 'Space' }] },
    tetris: { start: 'Enter', left: [{ l: '◀', c: 'ArrowLeft' }, { l: '▶', c: 'ArrowRight' }, { l: '▼', c: 'ArrowDown' }], right: [{ l: '⟳', c: 'ArrowUp' }, { l: 'DROP', c: 'Space' }] },
    artillery: { start: 'Space', left: [{ l: '◀', c: 'ArrowLeft' }, { l: '▶', c: 'ArrowRight' }], right: [{ l: 'PWR+', c: 'ArrowUp' }, { l: 'PWR-', c: 'ArrowDown' }, { l: 'FIRE', c: 'Space' }] },
    pong: { start: 'Space', right: [{ l: '▲', c: 'ArrowUp' }, { l: '▼', c: 'ArrowDown' }] },
    // pointer/tap (mouse-driven games; tap & drag bridge to mouse)
    breakout: { start: 'Space', canvas: 'drag' },
    minesweeper: { start: 'Space', canvas: 'drag' },
    memory: { start: 'Enter', canvas: 'drag' },
    'connect-four': { start: 'Space', canvas: 'drag' },
    'tic-tac-toe': { start: 'Space', canvas: 'drag' },
    simon: { start: 'Space', canvas: 'drag' },
    'lights-out': { start: 'Enter', canvas: 'drag' },
    'whack-a-mole': { start: 'Space', canvas: 'drag' },
    'fifteen-puzzle': { start: 'Enter', canvas: 'drag' },
    'match-three': { start: 'Space', canvas: 'drag' },
    'bubble-shooter': { start: 'Space', canvas: 'drag' },
    'missile-command': { start: 'Space', canvas: 'drag' },
    // 2-player on one phone is awkward — Phase 2. For now: start + tap.
    tron: { start: 'Space', twoPlayer: true },
    'snake-duel': { start: 'Space', twoPlayer: true },
    'air-hockey': { start: 'Space', twoPlayer: true },
  };
  const cfg = REG[slug] || { start: 'Space', canvas: 'drag' };

  // ---- styles -------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
    .at-wrap{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;justify-content:space-between;align-items:flex-end;
      padding:10px max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));
      pointer-events:none;gap:10px;font-family:"Segoe UI",system-ui,sans-serif;}
    .at-cluster{display:flex;gap:8px;flex-wrap:wrap;max-width:46vw;pointer-events:none;}
    .at-cluster.right{justify-content:flex-end;}
    .at-btn{pointer-events:auto;min-width:56px;height:56px;padding:0 12px;border-radius:14px;border:1px solid rgba(159,180,212,.35);
      background:rgba(16,20,31,.6);color:#eaf2ff;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);user-select:none;-webkit-user-select:none;touch-action:none;}
    .at-btn.small{font-size:12px;min-width:50px;height:44px;}
    .at-btn:active,.at-btn.on{background:rgba(122,162,255,.5);border-color:#7aa2ff;}
    .at-start{pointer-events:auto;align-self:center;}
    .at-hint{position:fixed;left:0;right:0;bottom:74px;text-align:center;color:#9fb4d4;font-size:11px;z-index:9998;pointer-events:none;opacity:.8;}
  `;
  document.head.appendChild(css);

  function mkBtn(label, code, small) {
    const b = document.createElement('button');
    b.className = 'at-btn' + (small ? ' small' : '');
    b.textContent = label;
    let down = false;
    const press = (e) => { e.preventDefault(); if (down) return; down = true; b.classList.add('on'); key('keydown', code); };
    const release = (e) => { if (!down) return; down = false; b.classList.remove('on'); key('keyup', code); };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  function build() {
    const canvas = document.querySelector('canvas');

    // canvas bridges
    if (canvas && cfg.canvas === 'press') {
      let dn = false;
      canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); dn = true; key('keydown', cfg.code); });
      const up = () => { if (dn) { dn = false; key('keyup', cfg.code); } };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    } else if (canvas && cfg.canvas === 'drag') {
      // bridge real touch → mouse (mouse/pen already fire native events)
      const synth = (type, e) => {
        const m = new MouseEvent(type, { clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true, view: window, button: 0 });
        canvas.dispatchEvent(m);
      };
      canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); synth('mousemove', e); synth('mousedown', e); });
      canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); synth('mousemove', e); });
      canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') return; e.preventDefault(); synth('mouseup', e); synth('click', e); });
    }

    if (canvas && cfg.swipe) {
      let sx = 0, sy = 0, t0 = 0;
      canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; t0 = Date.now(); });
      canvas.addEventListener('pointerup', (e) => {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.hypot(dx, dy) < 26) { tapKey(cfg.start); return; }   // tap = start
        if (Math.abs(dx) > Math.abs(dy)) tapKey(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
        else tapKey(dy > 0 ? 'ArrowDown' : 'ArrowUp');
      });
    }

    // overlay (skip the button bar for pure pointer/drag games; they tap the canvas)
    const hasButtons = cfg.left || cfg.right;
    const wrap = document.createElement('div');
    wrap.className = 'at-wrap arcade-touch';

    const left = document.createElement('div');
    left.className = 'at-cluster left';
    (cfg.left || []).forEach((b) => left.appendChild(mkBtn(b.l, b.c)));

    const startBtn = mkBtn('▶', cfg.start, true);
    startBtn.classList.add('at-start');

    const right = document.createElement('div');
    right.className = 'at-cluster right';
    (cfg.right || []).forEach((b) => right.appendChild(mkBtn(b.l, b.c, b.l.length > 1)));

    wrap.appendChild(left);
    wrap.appendChild(startBtn);
    wrap.appendChild(right);
    document.body.appendChild(wrap);

    if (cfg.twoPlayer) {
      const h = document.createElement('div');
      h.className = 'at-hint';
      h.textContent = '2-player — best on a keyboard for now';
      document.body.appendChild(h);
    }

    // let the canvas fitter reserve room for the controls
    window.dispatchEvent(new Event('resize'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
