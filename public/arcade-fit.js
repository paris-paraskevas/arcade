// Shared canvas fitter for every arcade game page.
// Sizes the <canvas> to fit BOTH the viewport width and height (minus the
// title/hint chrome), preserving aspect ratio, in any orientation — and never
// upscaling past its intrinsic resolution. Reads the canvas's own width/height
// attributes, so it needs zero per-game config. Games map pointer coordinates
// via getBoundingClientRect, so changing the *display* size is safe.
(() => {
  'use strict';
  function init() {
    const c = document.querySelector('canvas');
    if (!c || !c.width || !c.height) return;
    const aspect = c.width / c.height;

    // Vertical space taken by the title + hint (measured live).
    function chrome() {
      let used = 16;
      document.querySelectorAll('h1, .hint, .arcade-touch').forEach((el) => { used += el.offsetHeight + 8; });
      return used;
    }
    function fit() {
      const availW = window.innerWidth * 0.98;
      const availH = Math.max(120, window.innerHeight - chrome());
      let w = Math.min(availW, availH * aspect, c.width); // never upscale past intrinsic
      let h = w / aspect;
      if (h > availH) { h = availH; w = h * aspect; }
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
