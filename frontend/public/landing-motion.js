/* Motion for the landing page: entrances, Tabby's clips, pointer depth and scroll tilt. */
window.cotabLanding = function () {
  var root = document.querySelector(".lp");
  if (!root || root.dataset.moving) return;
  root.dataset.moving = "1";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var io = "IntersectionObserver" in window;
  root.classList.add("js");

  // Each section's parts rise in once, in reading order.
  var parts = root.querySelectorAll("[data-reveal]");
  if (!io || reduce) {
    parts.forEach(function (el) {
      el.classList.add("in");
    });
  } else {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          seen.unobserve(e.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    parts.forEach(function (el, i) {
      el.style.setProperty("--d", (i % 3) * 80 + "ms");
      seen.observe(el);
    });
  }

  // Tabby's cut-out clips: HEVC keeps transparency in Safari, VP9 everywhere else.
  // They load and play only while on screen; with reduced motion he holds his poster.
  var ua = navigator.userAgent;
  var safari = /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua);
  var ext = safari ? ".mov" : ".webm";
  var clips = root.querySelectorAll("video[data-clip]");
  if (!reduce && io) {
    var onScreen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) {
            if (!v.src) v.src = v.dataset.src || "/landing/cut/tabby-" + v.dataset.clip + ext;
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
          } else if (v.src) v.pause();
        });
      },
      { threshold: 0.2 }
    );
    clips.forEach(function (v) {
      onScreen.observe(v);
    });
  }

  // The leak total counts up once it is seen.
  root.querySelectorAll("[data-count]").forEach(function (el) {
    if (reduce || !io) return;
    var to = parseFloat(el.dataset.count);
    var fmt = function (n) {
      return (
        "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
    };
    var once = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      once.disconnect();
      var t0 = performance.now();
      var step = function (t) {
        var k = Math.min(1, (t - t0) / 1400);
        el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    once.observe(el);
  });

  if (reduce) return;

  // Pointer depth: the hero's glass chips drift by their data-depth, and every
  // [data-tilt] stage leans toward the pointer as if it were a real object.
  var fine = window.matchMedia("(pointer: fine)").matches;
  if (fine) {
    root.querySelectorAll("[data-tilt]").forEach(function (el) {
      var raf = 0;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          el.style.setProperty("--rx", (-y * 6).toFixed(2) + "deg");
          el.style.setProperty("--ry", (x * 8).toFixed(2) + "deg");
        });
      });
      el.addEventListener("pointerleave", function () {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });
    var hero = root.querySelector("[data-parallax]");
    if (hero) {
      var orbs = hero.querySelectorAll("[data-depth]");
      hero.addEventListener("pointermove", function (e) {
        var x = e.clientX / window.innerWidth - 0.5;
        var y = e.clientY / window.innerHeight - 0.5;
        orbs.forEach(function (o) {
          var d = parseFloat(o.dataset.depth);
          o.style.setProperty("--px", (x * d * 28).toFixed(1) + "px");
          o.style.setProperty("--py", (y * d * 22).toFixed(1) + "px");
        });
      });
    }
  }

  // Scroll tilt: [data-scroll] gets --s from -1 (below the fold) to 1 (leaving the top).
  var tilted = root.querySelectorAll("[data-scroll]");
  if (tilted.length) {
    var ticking = false;
    var tilt = function () {
      ticking = false;
      var h = window.innerHeight;
      tilted.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var s = (h / 2 - (r.top + r.height / 2)) / (h / 2 + r.height / 2);
        el.style.setProperty("--s", Math.max(-1, Math.min(1, s)).toFixed(3));
      });
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(tilt);
        }
      },
      { passive: true }
    );
    tilt();
  }
};
