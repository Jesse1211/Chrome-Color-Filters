/* T0 feasibility spike — throwaway probe. Not production code.
 * Approach is baked in by the harness via config.js (same isolated world),
 * so the page URL and page globals stay untouched.
 *   off  = no filter (baseline)
 *   a1   = filter on document.documentElement
 *   a2   = filter on documentElement + compensation CSS for fixed/sticky
 *   a3   = fixed full-viewport overlay using backdrop-filter
 *   a4   = filter on document.body only
 *   a5   = RECOMMENDED: root filter + top-layer compensation
 */
(function () {
  // Written by the harness into config.js before each Chrome launch, so the
  // page URL stays pristine (a URL hash would itself perturb the page).
  var APPROACH = (typeof self.__T0_APPROACH === 'string') ? self.__T0_APPROACH : 'off';
  if (APPROACH === 'off') return;

  var STYLE_ID = '__t0_spike_style';
  var OVERLAY_ID = '__t0_spike_overlay';
  var FILTER = 'grayscale(1)';

  function injectStyle(css) {
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  }

  if (APPROACH === 'a1') {
    injectStyle('html{filter:' + FILTER + ' !important;}');
  }

  if (APPROACH === 'a2') {
    // filter on root + attempt to compensate: force fixed elements back into
    // viewport-relative positioning by re-anchoring them. There is no CSS
    // property that opts an element out of an ancestor's containing block, so
    // the only compensation available is JS re-offsetting on scroll.
    injectStyle('html{filter:' + FILTER + ' !important;}');
    var compensate = function () {
      var y = window.scrollY, x = window.scrollX;
      var all = document.querySelectorAll('body *');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var cs = getComputedStyle(el);
        if (cs.position === 'fixed') {
          el.style.setProperty('transform',
            'translate(' + x + 'px,' + y + 'px)', 'important');
        }
      }
    };
    window.addEventListener('scroll', compensate, { passive: true });
    document.addEventListener('DOMContentLoaded', compensate);
    window.__t0_compensate = compensate;
  }

  if (APPROACH === 'a3') {
    // Full-viewport fixed overlay that filters whatever is painted behind it.
    // The overlay is pointer-events:none so hit testing is untouched, and it
    // is NOT an ancestor of page content, so no containing block is created.
    injectStyle(
      '#' + OVERLAY_ID + '{' +
        'position:fixed !important;' +
        'inset:0 !important;' +
        'z-index:2147483647 !important;' +
        'pointer-events:none !important;' +
        '-webkit-backdrop-filter:' + FILTER + ' !important;' +
        'backdrop-filter:' + FILTER + ' !important;' +
        'margin:0 !important;padding:0 !important;border:0 !important;' +
        'contain:strict !important;' +
      '}'
    );
    var mount = function () {
      if (document.getElementById(OVERLAY_ID)) return;
      var d = document.createElement('div');
      d.id = OVERLAY_ID;
      d.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(d);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  if (APPROACH === 'a5') {
    // RECOMMENDED: root filter + top-layer compensation.
    injectStyle(
      'html{filter:' + FILTER + ' !important;}' +
      ':modal,[popover]:popover-open,:fullscreen,::backdrop{filter:' + FILTER + ' !important;}'
    );
  }

  if (APPROACH === 'a4') {
    injectStyle('body{filter:' + FILTER + ' !important;}');
  }
})();
