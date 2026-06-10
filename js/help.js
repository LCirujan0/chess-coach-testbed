/* ============================================================================
 * js/help.js, per-training-type help (v0.80, owner ask).
 *
 * Every training page gets a (?) button in the branded header and a short,
 * visual "how this works" card: what this exercise is, what you are expected
 * to do, how to complete it, and what the data on screen means. It auto-opens
 * the FIRST time a user lands on each type (tracked per type in
 * chess-coach-help-seen-v1, local-only; re-showing once per device is fine,
 * arguably good), and is always one tap away afterwards.
 *
 * Window-global classic script (like streak.js). Pages opt in by including
 * this file; the type is detected from location.pathname. Styling uses tokens
 * only, same visual language as the shared .panel/coach cards.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'chess-coach-help-seen-v1';

  var ICONS = {
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/>',
    chat: '<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5z"/>',
    board: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a0 0 0 0 0 0 0v13a2 2 0 0 1 2 2h4z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    scale: '<path d="M5 20V9m4 11V4m4 16v-7m4 7V8"/>',
  };

  var CONTENT = {
    mistakes: {
      chip: 'Puzzles',
      title: 'Your mistakes, as puzzles',
      intro: 'Every puzzle here is a real position from YOUR games where a better move existed. Find it now so you find it next time it matters.',
      steps: [
        { icon: 'eye', t: 'Read the position', p: 'You always play the side that made the mistake. The intro shows what happened in your game first.' },
        { icon: 'target', t: 'Find the better move', p: 'Tap a piece, then its destination. You have up to 3 moves; staying within budget solves the puzzle.' },
        { icon: 'chat', t: 'Stuck? Ask the coach', p: 'It guides you with questions, never the answer. In Deep mode, the "think first" gate trains the habit of checking checks, captures and threats.' },
      ],
      data: 'The bar under the board tracks how much advantage your moves keep: green is on track, red means the move gave too much away (over ~1 pawn). Solved puzzles return later for spaced review.',
    },
    endgames: {
      chip: 'Endgames',
      title: 'Play the endgame out',
      intro: 'A winning (or drawn) position, you against Stockfish. The goal is not one move, it is converting the whole position.',
      steps: [
        { icon: 'book', t: 'Read the goal', p: 'Each lesson names its goal (convert the win, hold the draw) and the technique it teaches.' },
        { icon: 'board', t: 'Play it out', p: 'Move for your side; the engine answers instantly. Keep your advantage, drifting below the threshold fails the attempt.' },
        { icon: 'check', t: 'Convert it', p: 'Deliver mate, promote, or hold the draw to the end. Clean conversions mark the lesson as mastered.' },
      ],
      data: 'The rail shows the lesson goal and the coach. Your results feed the Endgames mastery count on Insights, and weak endgame play makes endgame blocks appear in your daily session.',
    },
    recognition: {
      chip: 'Recognition',
      title: 'Winning, drawn or losing?',
      intro: 'Strong players glance at an endgame and KNOW. This drill builds that instinct, 1,001 positions, one judgement each.',
      steps: [
        { icon: 'eye', t: 'Look, don’t calculate', p: 'Take a few seconds. Count material, look at the kings and pawns.' },
        { icon: 'scale', t: 'Judge it', p: 'Tap Winning, Drawn or Losing, always from the side to move’s point of view.' },
        { icon: 'chat', t: 'Learn the why', p: 'After you answer, the explanation names the rule (opposition, wrong bishop, the square…). The coach can take questions.' },
      ],
      data: 'Your accuracy by position type feeds Insights; types you misjudge resurface more often in your daily session.',
    },
    'board-vision': {
      chip: 'Board Vision',
      title: 'A daily eyesight warm-up',
      intro: 'Three quick drills plus a hide-the-board tracker, about 4 minutes that sharpen how clearly you see the board in your head.',
      steps: [
        { icon: 'target', t: 'Coordinates & knights', p: 'Tap the named square, or every square a knight can reach. Speed and accuracy both count.' },
        { icon: 'eye', t: 'The tracker', p: 'Watch a few moves, then the board hides. Answer from memory, where did the piece land, was it a check?' },
        { icon: 'check', t: 'Level up', p: 'Score 80%+ and the tracker gets one move longer. Six levels.' },
      ],
      data: 'Your scores and tracker level are on Insights under Mastery. This is the foundation for calculating ahead without moving pieces.',
    },
    openings: {
      chip: 'Openings',
      title: 'Learn lines you’ll actually play',
      intro: 'A repertoire trainer with the WHY of every move explained, not memorisation, understanding. Vienna first; verified by Stockfish.',
      steps: [
        { icon: 'book', t: 'Pick a line', p: 'Lines due for review come first, the schedule spaces them so they stick.' },
        { icon: 'board', t: 'Recall each move', p: 'Tap the from-square, then the to-square. The "why this move" panel explains the idea behind every step.' },
        { icon: 'clock', t: 'Come back tomorrow', p: 'A clean recall pushes the line further out; a slip brings it back sooner. A few minutes a day builds the repertoire.' },
      ],
      data: 'The hub shows each line’s memory box (1, 5). "Your openings" highlights repertoire lines you already reach in real games.',
    },
    calculation: {
      chip: 'Calculation',
      title: 'See the line before you move',
      intro: 'Two drills that train holding a forced sequence in your head, the biggest skill gap between 1000 and 1500.',
      steps: [
        { icon: 'eye', t: 'Follow the line', p: 'The board freezes at the start and the moves are told in words. Picture them, then answer: where does the piece end up?' },
        { icon: 'target', t: 'Count the forcers', p: 'A position from your own games, 20 seconds: how many checks or captures are available right now? The scan you should run before every move.' },
        { icon: 'check', t: 'Level up', p: 'Score 80%+ and the lines get one move longer. The 60s blitz keeps your best mark.' },
      ],
      data: 'Levels, blitz bests, and your trend feed Insights under Mastery, and sync across devices.',
    },
  };

  var PAGE_TYPE = {
    '/puzzle.html': 'mistakes',
    '/endgames.html': 'endgames',
    '/endgame-recognition.html': 'recognition',
    '/board-vision.html': 'board-vision',
    '/calculation.html': 'calculation',
    '/openings.html': 'openings',
  };

  function seen() { try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function markSeen(type) {
    try { var s = seen(); s[type] = 1; root.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { }
  }

  function ensureStyles() {
    if (document.getElementById('kp-help-styles')) return;
    var st = document.createElement('style');
    st.id = 'kp-help-styles';
    st.textContent = [
      '#kp-help-backdrop{position:fixed;inset:0;background:rgba(20,25,35,.45);z-index:480;}',
      '#kp-help-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:490;width:min(480px,calc(100vw - 28px));max-height:min(86vh,640px);overflow-y:auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:0 24px 60px -20px rgba(20,30,55,.5);padding:22px;}',
      '#kp-help-modal .kh-chip{display:inline-block;font-family:"Plus Jakarta Sans","Inter",sans-serif;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border-radius:var(--r-pill);padding:3px 10px;margin-bottom:9px;}',
      '#kp-help-modal h2{font-family:"Plus Jakarta Sans","Inter",sans-serif;font-size:18px;font-weight:800;letter-spacing:-.01em;margin:0 0 5px;}',
      '#kp-help-modal .kh-intro{font-size:13px;color:var(--muted);line-height:1.55;margin-bottom:15px;}',
      '#kp-help-modal .kh-step{display:flex;gap:12px;align-items:flex-start;padding:9px 0;}',
      '#kp-help-modal .kh-step + .kh-step{border-top:1px solid var(--surface2);}',
      '#kp-help-modal .kh-ic{flex-shrink:0;width:34px;height:34px;border-radius:10px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;}',
      '#kp-help-modal .kh-ic svg{width:18px;height:18px;stroke:var(--accent);fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}',
      '#kp-help-modal .kh-t{font-family:"Plus Jakarta Sans","Inter",sans-serif;font-weight:700;font-size:13.5px;margin-bottom:1px;}',
      '#kp-help-modal .kh-p{font-size:12.5px;color:var(--muted);line-height:1.5;}',
      '#kp-help-modal .kh-data{margin-top:13px;padding:11px 13px;background:var(--surface2);border-radius:var(--r-panel);font-size:12px;color:var(--ink);line-height:1.55;}',
      '#kp-help-modal .kh-data b{font-family:"Plus Jakarta Sans","Inter",sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:3px;}',
      '#kp-help-modal .kh-close{margin-top:15px;width:100%;padding:12px 16px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-btn);font-family:"Plus Jakarta Sans","Inter",sans-serif;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 10px 22px -10px var(--accent);}',
      '.kp-help-btn{margin-left:auto;flex-shrink:0;width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer;line-height:1;font-family:"Plus Jakarta Sans","Inter",sans-serif;}',
      '.kp-help-btn:hover{border-color:var(--accent);color:var(--accent);}',
      // header-bar already lays out children in a row; keep the chip beside the mode pills if present
      '.header-bar .kp-help-btn{order:99;}',
      // The extra 24px must never overflow a 375px header: the screen-chip is
      // the one element that can give up a few px gracefully (ellipsis).
      '.header-bar .screen-chip{flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function close() {
    var m = document.getElementById('kp-help-modal');
    var b = document.getElementById('kp-help-backdrop');
    if (m) m.remove();
    if (b) b.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(type) {
    var c = CONTENT[type];
    if (!c || document.getElementById('kp-help-modal')) return;
    ensureStyles();
    var back = document.createElement('div');
    back.id = 'kp-help-backdrop';
    back.addEventListener('click', close);
    var m = document.createElement('div');
    m.id = 'kp-help-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', c.title);
    m.innerHTML =
      '<span class="kh-chip">' + c.chip + ' · how it works</span>' +
      '<h2>' + c.title + '</h2>' +
      '<div class="kh-intro">' + c.intro + '</div>' +
      c.steps.map(function (s) {
        return '<div class="kh-step"><div class="kh-ic"><svg viewBox="0 0 24 24">' + (ICONS[s.icon] || ICONS.target) + '</svg></div>' +
          '<div><div class="kh-t">' + s.t + '</div><div class="kh-p">' + s.p + '</div></div></div>';
      }).join('') +
      '<div class="kh-data"><b>What the numbers mean</b>' + c.data + '</div>' +
      '<button type="button" class="kh-close">Got it</button>';
    document.body.appendChild(back);
    document.body.appendChild(m);
    var closeBtn = m.querySelector('.kh-close');
    closeBtn.addEventListener('click', close);
    closeBtn.focus(); // keyboard users land on the dismiss action
    document.addEventListener('keydown', onKey);
    markSeen(type);
  }

  function init() {
    var type = PAGE_TYPE[root.location.pathname];
    if (!type || !CONTENT[type]) return;
    ensureStyles();
    // (?) in the branded header, always available.
    var bar = document.querySelector('.header-bar');
    if (bar && !bar.querySelector('.kp-help-btn')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kp-help-btn';
      btn.textContent = '?';
      btn.setAttribute('aria-label', 'How ' + (CONTENT[type].chip || 'this') + ' works');
      btn.addEventListener('click', function () { open(type); });
      bar.appendChild(btn);
    }
    // Auto-open on the first visit to this training type.
    if (!seen()[type]) open(type);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.KPHelp = { open: open, CONTENT: CONTENT, KEY: KEY };
})(typeof window !== 'undefined' ? window : this);
