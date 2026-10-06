/* ══════════════════════════════════════════════════════════
   LEA'S COLLECTION · every card, in order
   To add a new card, add one line at the end of LEA_CARDS.
   Every page that includes this file shows the new stamp, but only
   once its date arrives, so a card can go live early without spoiling it.

   On a page:  <div data-lea-cards data-theme="light"></div>
               <script src="/cards.js" defer></script>
   data-theme is "light" or "dark". data-current="ID" is optional,
   otherwise the current card is matched from the URL.
   ══════════════════════════════════════════════════════════ */
window.LEA_CARDS = [
  { id: '1YA',     title: 'One Year Anniversary', date: '2026-04-07', href: '/1YA/',     icon: '🥂', tint: '#F3E6CF' },
  { id: '2026it',  title: 'Italy',                date: '2026-04-14', href: '/2026it/',  icon: '🌿', tint: '#DDE8CF' },
  { id: 'MD26',    title: "Mother's Day",         date: '2026-05-10', href: '/MD26/',    icon: '🐾', tint: '#F2DCCB' },
  { id: 'NWD2026', title: 'National Wife Day',    date: '2026-09-20', href: '/NWD2026/', icon: '💐', tint: '#F6E3DA' },
  { id: 'BD2026',  title: 'Birthday',             date: '2026-10-07', href: '/BD2026/',  icon: '🎂', tint: '#FCE3E9' }
];

(function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var CSS =
    '.lea-cards{margin:2rem auto 1.4rem;text-align:center;line-height:1.2;letter-spacing:normal;text-transform:none}' +
    '.lea-cards .lea-cards-title{margin:0 0 16px;font-size:10px;font-style:normal;font-weight:700;line-height:1.3;letter-spacing:.3em;text-transform:uppercase;opacity:.72}' +
    '.lea-stamps{display:flex;flex-wrap:wrap;justify-content:center;gap:14px 4px}' +
    '.lea-stamp{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;color:inherit;text-decoration:none;-webkit-tap-highlight-color:transparent}' +
    '.lea-st{display:block;width:48px;height:56px;padding:4px;background:radial-gradient(circle,transparent 2.3px,#FFFCF8 2.7px) -4px -4px/8px 8px;filter:drop-shadow(0 3px 4px rgba(40,20,20,.22));transition:transform .25s ease}' +
    '.lea-st i{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-style:normal;font-size:19px;line-height:1}' +
    'a.lea-stamp:hover .lea-st,a.lea-stamp:focus-visible .lea-st{transform:translateY(-3px) rotate(-2deg)}' +
    'a.lea-stamp:focus-visible{outline:none}' +
    '.lea-stamp small{font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.7}' +
    '.lea-stamp.is-here .lea-st{transform:translateY(-4px) rotate(-3deg)}' +
    '.lea-stamp.is-here small{opacity:1;color:var(--lea-accent)}' +
    '.lea-postmark{position:absolute;top:-10px;right:-14px;width:40px;height:40px;transform:rotate(-14deg);pointer-events:none}' +
    '.lea-stamp.is-next .lea-st{background:none;filter:none;border:1.5px dashed currentColor;border-radius:3px;opacity:.4}' +
    '.lea-stamp.is-next i{font-size:20px}' +
    '.lea-light{color:#3D1E24;--lea-accent:#C8323F}' +
    '.lea-dark{color:#FFF6EC;--lea-accent:#F4D27F}' +
    '.lea-dark .lea-st{filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))}';

  function shortDate(iso) {
    var p = iso.split('-');
    return MONTHS[+p[1] - 1] + ' ' + (+p[2]);
  }

  function isCurrent(card, el) {
    var forced = el.getAttribute('data-current');
    if (forced) return forced === card.id;
    return location.pathname.replace(/index\.html?$/, '') === card.href;
  }

  function isOut(card) {
    var p = card.date.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]) <= new Date();
  }

  function postmark(card) {
    var p = card.date.split('-');
    var ink = 'rgba(61,30,36,.72)';
    return '<svg class="lea-postmark" viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="17" fill="none" stroke="' + ink + '" stroke-width="1.4"/>' +
      '<circle cx="20" cy="20" r="13" fill="none" stroke="' + ink + '" stroke-width=".8" opacity=".6"/>' +
      '<text x="20" y="18.6" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="6.2" fill="' + ink + '">' + MONTHS[+p[1] - 1].toUpperCase() + ' ' + (+p[2]) + '</text>' +
      '<text x="20" y="26" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="6.2" fill="' + ink + '">' + p[0] + '</text>' +
      '</svg>';
  }

  function render(el) {
    var theme = el.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var html = '<p class="lea-cards-title">' + (el.getAttribute('data-title') || 'Your collection') + '</p><div class="lea-stamps">';
    window.LEA_CARDS.forEach(function (card) {
      var here = isCurrent(card, el);
      if (!here && !isOut(card)) return;
      html += '<a class="lea-stamp' + (here ? ' is-here' : '') + '" href="' + card.href + '" title="' + card.title + '"' +
        ' aria-label="' + card.title + ', ' + shortDate(card.date) + '"' + (here ? ' aria-current="page"' : '') + '>' +
        '<span class="lea-st"><i style="background:' + card.tint + '">' + card.icon + '</i></span>' +
        '<small>' + shortDate(card.date) + '</small>' + (here ? postmark(card) : '') + '</a>';
    });
    html += '<span class="lea-stamp is-next" aria-hidden="true"><span class="lea-st"><i>?</i></span><small>Next</small></span></div>';
    el.innerHTML = html;
    el.classList.add('lea-cards', 'lea-' + theme);
  }

  function init() {
    if (!document.getElementById('lea-cards-css')) {
      var style = document.createElement('style');
      style.id = 'lea-cards-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var els = document.querySelectorAll('[data-lea-cards]');
    for (var i = 0; i < els.length; i++) render(els[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
