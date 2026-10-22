/* Motion for the landing page: receipt print, Tabby hop, mood demo. */
window.cotabLanding = function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // hero sequence: receipt prints, stamp, cat hops in, says hi, chips float in
  var rows = $$('#receipt .row');
  var t = reduce ? 0 : 450;
  rows.forEach(function (r, i) { setTimeout(function () { r.classList.add('on'); }, t + i * (reduce ? 0 : 160)); });
  var after = reduce ? 0 : t + rows.length * 160 + 250;
  setTimeout(function () { $('#stamp').classList.add('on'); }, after);
  setTimeout(function () { $('#herocat').classList.add('on'); $('#floor').classList.add('on'); }, after + (reduce ? 0 : 350));
  setTimeout(function () { $('#say').classList.add('on'); }, after + (reduce ? 0 : 1100));
  setTimeout(function () { $('#chip1').classList.add('on'); }, after + (reduce ? 0 : 1450));
  setTimeout(function () { $('#chip2').classList.add('on'); }, after + (reduce ? 0 : 1700));

  // tilt the hero stage with the pointer
  var stage = $('#stage'), tilt = $('#tilt');
  if (!reduce && window.matchMedia('(pointer: fine)').matches) {
    stage.addEventListener('pointermove', function (e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.transform = 'rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
    });
    stage.addEventListener('pointerleave', function () { tilt.style.transform = ''; });
  }

  // cats hop in when their section scrolls into view
  var hops = $$('.hopin');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } });
    }, { threshold: 0.35 });
    hops.forEach(function (h) { io.observe(h); });
  } else { hops.forEach(function (h) { h.classList.add('on'); }); }

  // mood demo
  var TINTS = {
    'cool': ['#D6EFE2', '#9CC9AD', 'Cool. Well under budget.'],
    'hmm': ['#FFF2CA', '#F3D38B', 'Hmm. Getting close.'],
    'over-budget': ['#FFE6DA', '#F4B6AC', 'Over budget. Arms folded.'],
    'out-of-cash': ['#E9E4F4', '#C2B9DD', 'Out of cash.'],
    'payday': ['#E2F6D5', '#B6DB9B', 'Payday!'],
    'bill-shock': ['#FFEADC', '#F6C0A4', 'Bill shock!'],
    'salute': ['#DAECFB', '#B2D0E9', 'Goal hit. Salute.'],
    'love': ['#FFE2EA', '#F8B5C5', 'Split with love.'],
  };
  var spend = $('#spend'), amt = $('#amt'), disc = $('#disc'), label = $('#moodlabel'), fx = $('#fx'), ms = $('#moodstage');
  var current = null, eventTimer = null;
  function setMood(m) {
    if (m === current) return;
    current = m;
    $$('.moodcat').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-mood') === m); });
    var c = TINTS[m];
    disc.style.background = 'linear-gradient(165deg, ' + c[0] + ', ' + c[1] + ')';
    label.textContent = c[2];
    label.classList.remove('bump'); void label.offsetWidth; label.classList.add('bump');
  }
  function moodFromSpend() {
    var v = +spend.value, p = v / 1800;
    spend.style.setProperty('--p', (v / 2400 * 100) + '%');
    amt.textContent = '$' + v.toLocaleString('en-US');
    return p < 0.6 ? 'cool' : p <= 1 ? 'hmm' : p <= 1.2 ? 'over-budget' : 'out-of-cash';
  }
  spend.addEventListener('input', function () {
    clearTimeout(eventTimer);
    var m = moodFromSpend();
    if (m === 'over-budget' && current !== 'over-budget') shakeAndSteam();
    setMood(m);
  });
  setMood(moodFromSpend());

  function add(el, life) { fx.appendChild(el); setTimeout(function () { el.remove(); }, life); }
  var R = Math.random;
  function coins() {
    for (var i = 0; i < 22; i++) {
      var c = document.createElement('span'); c.className = 'coin'; c.textContent = '$';
      c.style.left = (R() * 92) + '%'; c.style.top = '0';
      c.style.animationDuration = (1.4 + R() * 1.1) + 's'; c.style.animationDelay = (R() * 0.9) + 's';
      add(c, 3600);
    }
  }
  function hearts() {
    var cols = ['#E8244A', '#FF5C7C', '#FF8FA6'];
    for (var i = 0; i < 14; i++) {
      var h = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      h.setAttribute('viewBox', '0 0 32 29'); h.setAttribute('class', 'heart');
      h.innerHTML = '<path d="M16 28 C-6 14 2 -4 16 6 C30 -4 38 14 16 28 Z" fill="' + cols[i % 3] + '"/>';
      h.style.left = (10 + R() * 80) + '%'; h.style.bottom = '10%';
      h.style.setProperty('--sx', ((R() - 0.5) * 80) + 'px');
      h.style.animationDuration = (1.8 + R() * 1.2) + 's'; h.style.animationDelay = (R() * 0.8) + 's';
      add(h, 4000);
    }
  }
  function slips() {
    for (var i = 0; i < 10; i++) {
      var s = document.createElement('span'); s.className = 'slip';
      var a = (i / 10) * Math.PI * 2 + R() * 0.3;
      s.style.left = '50%'; s.style.top = '48%';
      s.style.setProperty('--dx', Math.cos(a) * (180 + R() * 60) + 'px');
      s.style.setProperty('--dy', Math.sin(a) * (180 + R() * 60) + 'px');
      s.style.setProperty('--r', ((R() - 0.5) * 600) + 'deg');
      s.style.animationDelay = (i * 0.04) + 's';
      add(s, 2200);
    }
    ms.classList.remove('shake'); void ms.offsetWidth; ms.classList.add('shake');
  }
  function confetti() {
    var cols = ['#D7F45B', '#FFD84D', '#FF8A5B', '#5CB7F2', '#FF5C7C', '#FFFFFF'];
    for (var i = 0; i < 40; i++) {
      var c = document.createElement('span'); c.className = 'conf';
      c.style.left = (R() * 98) + '%'; c.style.top = '-20px'; c.style.background = cols[i % cols.length];
      c.style.animationDuration = (1.6 + R() * 1.4) + 's'; c.style.animationDelay = (R() * 0.6) + 's';
      add(c, 3800);
    }
  }
  function shakeAndSteam() {
    if (reduce) return;
    for (var i = 0; i < 8; i++) {
      var p = document.createElement('span'); p.className = 'puff';
      var side = i % 2 ? -1 : 1;
      p.style.left = 'calc(50% + ' + (side * (60 + R() * 50)) + 'px)'; p.style.top = '22%';
      p.style.setProperty('--dx', (side * (20 + R() * 30)) + 'px'); p.style.animationDelay = (R() * 0.4) + 's';
      add(p, 2000);
    }
    ms.classList.remove('shake'); void ms.offsetWidth; ms.classList.add('shake');
  }
  var FX = { payday: coins, love: hearts, 'bill-shock': slips, salute: confetti };
  $$('.events button').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-event');
      clearTimeout(eventTimer);
      current = null; setMood(m);
      if (!reduce) FX[m]();
      eventTimer = setTimeout(function () { current = null; setMood(moodFromSpend()); }, 3800);
    });
  });
};
