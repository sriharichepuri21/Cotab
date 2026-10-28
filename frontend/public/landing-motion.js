/* Motion for the landing page: section entrances, Tabby's clips, the drifting ribbon. */
window.cotabLanding = function () {
  var root = document.querySelector(".lp");
  if (!root) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");

  // Each section's parts rise in once, in reading order.
  var parts = root.querySelectorAll("[data-reveal], .note");
  if (!("IntersectionObserver" in window) || reduce) {
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
      { rootMargin: "0px 0px -10% 0px" }
    );
    parts.forEach(function (el, i) {
      el.style.setProperty("--d", (i % 3) * 80 + "ms");
      seen.observe(el);
    });
  }

  // Tabby only moves while he is on screen; with reduced motion he holds his poster frame.
  var clips = root.querySelectorAll("video[data-clip]");
  if (!reduce && "IntersectionObserver" in window) {
    var onScreen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) {
            v.preload = "auto";
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
          } else v.pause();
        });
      },
      { threshold: 0.25 }
    );
    clips.forEach(function (v) {
      onScreen.observe(v);
    });
  }

  // The long receipt drifts against the scroll, as if it were still unrolling.
  var ribbon = root.querySelector("[data-drift]");
  if (ribbon && !reduce) {
    var ticking = false;
    var drift = function () {
      ticking = false;
      var r = ribbon.parentElement.getBoundingClientRect();
      var t = (window.innerHeight - r.top) / (window.innerHeight + r.height);
      t = Math.max(0, Math.min(1, t));
      ribbon.style.transform = "translateY(" + ((0.5 - t) * 80).toFixed(1) + "px) rotate(-2deg)";
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(drift);
        }
      },
      { passive: true }
    );
    drift();
  }
};
