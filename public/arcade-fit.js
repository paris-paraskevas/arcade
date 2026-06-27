// Shared canvas fitter for every arcade game page.
// Sizes the <canvas> to FILL both the viewport width and height (minus the
// title/hint chrome), preserving aspect ratio, in any orientation — scaling UP
// on laptop/desktop so games aren't marooned at their native pixel size, and
// DOWN on phones. Reads the canvas's own width/height attributes, so it needs
// zero per-game config. Games map pointer coordinates via getBoundingClientRect,
// so changing the *display* size is safe (input stays aligned).
(() => {
  'use strict';
  function init() {
    const c = document.querySelector('canvas');
    if (!c || !c.width || !c.height) return;
    const aspect = c.width / c.height;

    // Single-screen games — never scroll. Some games' own CSS (min-height:100vh
    // + flex centering) reports a phantom overflow once the canvas is upscaled to
    // fill; the content always fits, so clipping that phantom keeps the page static.
    document.documentElement.style.overflow = 'hidden';

    // Vertical space taken by the title + hint + (fixed) touch overlay, PLUS the
    // body's own padding and flex gaps — otherwise a filled canvas overflows and
    // the page scrolls. Measured live so it adapts to each game's chrome.
    function chrome() {
      const cs = getComputedStyle(document.body);
      let used = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const gap = parseFloat(cs.rowGap) || parseFloat(cs.gap) || 0;
      document.querySelectorAll('h1, .hint, .arcade-touch').forEach((el) => { used += el.offsetHeight + gap; });
      return used + 12; // safety margin so the playfield never forces a scroll
    }
    function fit() {
      const availW = window.innerWidth * 0.98;
      const availH = Math.max(120, window.innerHeight - chrome());
      // Largest size that fits both axes, preserving aspect — upscaling allowed
      // so the playfield fills big screens (was capped at c.width = native res).
      let w = Math.min(availW, availH * aspect);
      let h = w / aspect;
      c.style.maxWidth = 'none';
      c.style.maxHeight = 'none';
      c.style.width = Math.round(w) + 'px';
      c.style.height = Math.round(h) + 'px';
    }
    fit();
    window.addEventListener('resize', fit, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(fit, 120));
    // Re-fit after fonts / layout settle.
    setTimeout(fit, 60);
    setTimeout(fit, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
