(() => {
  const init = () => {
    const product = document.querySelector(".tabby-product");
    const tabs = [...document.querySelectorAll("[data-tabby-mode]")];
    const activateTab = (button) => {
        const mode = button.getAttribute("data-tabby-mode") || "ask";
        tabs.forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
          item.tabIndex = active ? 0 : -1;
        });
        document
          .querySelectorAll("[data-tabby-pane]")
          .forEach((pane) => {
            const active = pane.getAttribute("data-tabby-pane") === mode;
            pane.classList.toggle("is-active", active);
            pane.hidden = !active;
          });
        product?.setAttribute("data-tabby-product", mode);
    };
    tabs.forEach((button, index) => {
      button.addEventListener("click", () => activateTab(button));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        activateTab(tabs[next]);
      });
    });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const films = [...document.querySelectorAll("video.tabby-film")];
    if (reducedMotion) films.forEach((film) => film.pause());
    else if ("IntersectionObserver" in window) {
      const filmObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
        const film = entry.target;
        if (entry.isIntersecting) film.play().catch(() => {});
        else film.pause();
      }), { rootMargin: "180px 0px", threshold: 0.05 });
      films.forEach((film) => filmObserver.observe(film));
    }

    const revealTargets = document.querySelectorAll(
      ".hero-line, .hero-close, .manifesto h2, .manifesto-grid, .demo-copy, .tabby-product, .chaos-copy, .proof-copy, .proof-facts, .finale-copy"
    );
    document.querySelector(".lp")?.classList.add("motion-ready");
    revealTargets.forEach((target) => target.setAttribute("data-reveal", ""));
    if (reducedMotion) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }
    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 }
    );
    revealTargets.forEach((target) => observer.observe(target));
    window.setTimeout(() => revealTargets.forEach((target) => target.classList.add("is-visible")), 1800);
  };
  window.cotabLanding = init;
})();
