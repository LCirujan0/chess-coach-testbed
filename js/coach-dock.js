/* ============================================================================
 * js/coach-dock.js (v0.82, owner ask): on phones the always-open coach card
 * pushed the training info below the fold. The coach now docks into a
 * floating knight bubble; tapping it slides the full chat up as a sheet, so
 * the board + exercise panel fit on screen without scrolling and the coach is
 * still one thumb-tap away. Desktop keeps the inline rail card.
 * Classic script; pages with a .coach-card in the rail just include it.
 * CSS lives in css/train.css (body.kp-coach-dock rules).
 * ==========================================================================*/
(function () {
  'use strict';
  function init() {
    var card = document.querySelector('.coach-card');
    if (!card || document.querySelector('.kp-coach-fab')) return;
    document.body.classList.add('kp-coach-dock');
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'kp-coach-fab';
    fab.setAttribute('aria-label', 'Open the coach');
    fab.innerHTML = '♞';
    fab.addEventListener('click', function () {
      var open = document.body.classList.toggle('kp-coach-open');
      fab.innerHTML = open ? '✕' : '♞';
      fab.setAttribute('aria-label', open ? 'Close the coach' : 'Open the coach');
      if (open) {
        var input = card.querySelector('.coach-input');
        if (input && window.matchMedia('(min-width: 880px)').matches) input.focus();
      }
    });
    document.body.appendChild(fab);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
