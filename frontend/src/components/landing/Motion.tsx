"use client";

import Lenis from "lenis";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect } from "react";

import { gsap, prefersReducedMotion } from "@/lib/motion";

const money = (n: number) => {
  const [whole, cents] = n.toFixed(2).split(".");
  return `$${Number(whole).toLocaleString("en-US")}<sup class="cents">.${cents}</sup>`;
};

/** Where a slot sits in the story, read from layout so transforms don't skew it. */
function slotAt(slot: HTMLElement, main: HTMLElement) {
  let x = 0;
  let y = 0;
  let el: HTMLElement | null = slot;
  while (el && el !== main) {
    x += el.offsetLeft;
    y += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  return { x, y, width: slot.offsetWidth };
}

/** The dinner's items travel between five scenes: it plays itself in view, or by the steps. */
function story() {
  const root = document.querySelector<HTMLElement>("[data-story]");
  const main = root?.querySelector<HTMLElement>("[data-main]");
  if (!root || !main) return undefined;
  root.classList.add("is-live");
  const sel = <T extends HTMLElement>(q: string) => gsap.utils.toArray<T>(q, root);
  const copies = sel("[data-copy]");
  const scenes = sel("[data-scene]");
  const items = sel("[data-item]");
  const marks = sel("[data-mark]");
  const fills = sel("[data-fill]");
  const slot = (id: string, n: number) =>
    scenes[n].querySelector<HTMLElement>(`[data-slot="${id}"]`);
  const place = (item: HTMLElement, n: number, key: "x" | "y" | "width") => {
    const target = slot(item.dataset.item ?? "", n);
    return target ? slotAt(target, main)[key] : 0;
  };
  const rest = () =>
    items.forEach((item) =>
      gsap.set(item, {
        x: place(item, 0, "x"),
        y: place(item, 0, "y"),
        width: place(item, 0, "width"),
      })
    );

  gsap.set(copies.slice(1), { autoAlpha: 0 });
  gsap.set(scenes.slice(1), { autoAlpha: 0 });
  gsap.set(items, { autoAlpha: 0 });
  rest();

  const STARTS = [0, 1.7, 3.5, 5.3, 7.1];
  const STOPS = [1.5, 3.2, 5, 6.8, 8.5];
  const GLOW = [-14, 12, 0, -8, 14];
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });

  // Snap: the three ways in land on the bill, and its lines appear.
  tl.to(
    "[data-source]",
    { x: 0, y: 0, scale: 0.5, autoAlpha: 0, stagger: 0.12, duration: 0.7 },
    0.1
  ).to(items, { autoAlpha: 1, stagger: 0.08, duration: 0.3, ease: "none" }, 0.5);

  const move = (n: number) => {
    const at = STARTS[n];
    tl.to(copies[n - 1], { autoAlpha: 0, y: -28, duration: 0.25 }, at)
      .fromTo(copies[n], { y: 44 }, { autoAlpha: 1, y: 0, duration: 0.5 }, at + 0.25)
      .to(scenes[n - 1], { autoAlpha: 0, duration: 0.3 }, at)
      .to(scenes[n], { autoAlpha: 1, duration: 0.3 }, at + 0.15)
      .fromTo(
        scenes[n].querySelectorAll("[data-pop]"),
        { y: 56, scale: 0.9 },
        { y: 0, scale: 1, stagger: 0.1, duration: 0.6, ease: "back.out(1.5)" },
        at + 0.15
      )
      .to("[data-story-bg]", { xPercent: GLOW[n], duration: 1, ease: "sine.inOut" }, at);
    items.forEach((item, i) => {
      if (slot(item.dataset.item ?? "", n))
        tl.to(
          item,
          {
            x: () => place(item, n, "x"),
            y: () => place(item, n, "y"),
            width: () => place(item, n, "width"),
            duration: 0.9,
            ease: "power3.inOut",
          },
          at + i * 0.05
        );
      else tl.to(item, { autoAlpha: 0, scale: 0.7, duration: 0.3 }, at);
    });
  };
  [1, 2, 3, 4].forEach(move);

  // Your share: the big number falls by your part only.
  const count = { v: 2266.6 };
  const out = root.querySelector<HTMLElement>("[data-count]");
  if (out) out.innerHTML = money(count.v);
  tl.to(
    count,
    {
      v: 2242.65,
      duration: 0.9,
      ease: "none",
      onUpdate: () => {
        if (out) out.innerHTML = money(count.v);
      },
    },
    5.8
  ).fromTo("[data-meter]", { width: "5.6%" }, { width: "6.6%", duration: 0.9, ease: "none" }, 5.8);
  tl.to({}, { duration: 0.1 }, 8.5);

  // Each step plays, holds while its bar fills, then hands over.
  let hold: gsap.core.Tween | undefined;
  let run: gsap.core.Tween | undefined;
  let started = false;
  const show = (n: number) => {
    started = true;
    hold?.kill();
    run?.kill();
    marks.forEach((m, i) => m.toggleAttribute("data-on", i === n));
    gsap.set(fills, { scaleX: 0 });
    run = tl.tweenTo(STOPS[n], {
      duration: Math.min(1.8, Math.max(0.4, Math.abs(tl.time() - STOPS[n]) * 0.8)),
      ease: "none",
      onComplete: () => {
        hold = gsap.to(fills[n], {
          scaleX: 1,
          duration: 3.4,
          ease: "none",
          onComplete: () => show((n + 1) % STOPS.length),
        });
      },
    });
  };
  const pause = (on: boolean) => [hold, run].forEach((t) => t?.paused(on));
  marks.forEach((mark, n) => mark.addEventListener("click", () => show(n)));
  // Hovering holds the current step, never a move halfway through.
  const onEnter = () => hold?.pause();
  const onLeave = () => hold?.resume();
  main.addEventListener("pointerenter", onEnter);
  main.addEventListener("pointerleave", onLeave);
  const seen = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !started) show(0);
      else pause(!e.isIntersecting);
    },
    { threshold: 0.45 }
  );
  seen.observe(root);

  // Sizes change the slots, so measure again and return to the same moment.
  let wait: ReturnType<typeof setTimeout> | undefined;
  const remeasure = () => {
    clearTimeout(wait);
    wait = setTimeout(() => {
      const at = tl.time();
      tl.pause(0).invalidate();
      rest();
      tl.time(at);
    }, 150);
  };
  window.addEventListener("resize", remeasure);
  document.fonts?.ready.then(remeasure);
  return () => {
    clearTimeout(wait);
    hold?.kill();
    run?.kill();
    seen.disconnect();
    window.removeEventListener("resize", remeasure);
    main.removeEventListener("pointerenter", onEnter);
    main.removeEventListener("pointerleave", onLeave);
  };
}

/** The leaks arrive one by one, and the total counts itself up. */
function lost() {
  const out = document.querySelector<HTMLElement>(".ln-lost-card .ln-card-total b");
  if (!out) return;
  const sum = { v: 0 };
  gsap
    .timeline({ scrollTrigger: { trigger: ".ln-lost-card", start: "top 75%", once: true } })
    .from(".ln-lost-card li", { x: -14, opacity: 0, stagger: 0.07, duration: 0.45 })
    .to(
      sum,
      {
        v: 285.21,
        duration: 1,
        ease: "power2.out",
        onUpdate: () => {
          out.textContent = `$${sum.v.toFixed(2)}`;
        },
      },
      0.2
    );
}

/** Each tile plays its own small proof as it arrives. */
function tiles() {
  const once = (trigger: string) => ({ trigger, start: "top 80%", once: true });
  gsap.from(".ln-chat p", {
    y: 12,
    opacity: 0,
    stagger: 0.5,
    duration: 0.45,
    scrollTrigger: once(".ln-tile-ask"),
  });
  gsap.fromTo(
    "[data-draw]",
    { strokeDasharray: 1, strokeDashoffset: 1 },
    {
      strokeDashoffset: 0,
      duration: 1.3,
      ease: "power2.inOut",
      scrollTrigger: once(".ln-tile-price"),
    }
  );
  const price = document.querySelector<HTMLElement>("[data-price]");
  const cost = { v: 4.29 };
  gsap.to(cost, {
    v: 4.79,
    duration: 1,
    delay: 0.4,
    onUpdate: () => {
      if (price) price.textContent = `$${cost.v.toFixed(2)}`;
    },
    scrollTrigger: once(".ln-tile-price"),
  });
  gsap.from(".ln-inbox li", {
    x: 18,
    opacity: 0,
    stagger: 0.12,
    duration: 0.45,
    scrollTrigger: once(".ln-inbox"),
  });
  gsap.from(".ln-paylink div span", {
    scale: 0.7,
    opacity: 0,
    stagger: 0.07,
    duration: 0.4,
    ease: "back.out(2)",
    scrollTrigger: once(".ln-paylink"),
  });
}

/** Four panels in one pinned, sideways move; narrower screens keep the native swipe. */
function gallery(lenis: Lenis) {
  const root = document.querySelector<HTMLElement>("[data-gallery]");
  const track = document.querySelector<HTMLElement>("[data-track]");
  if (!root || !track || !window.matchMedia("(min-width: 1024px)").matches) return undefined;
  root.classList.add("is-pinned");
  const panels = gsap.utils.toArray<HTMLElement>(".ln-panel");
  const distance = () => track.scrollWidth - window.innerWidth;
  const slide = gsap.to(track, {
    x: () => -distance(),
    ease: "none",
    scrollTrigger: {
      trigger: root,
      pin: true,
      start: "top top",
      end: () => `+=${distance() * 0.6}`,
      scrub: 0.5,
      invalidateOnRefresh: true,
    },
  });
  gsap.to("[data-gallery-bar]", {
    scaleX: 1,
    ease: "none",
    scrollTrigger: {
      trigger: root,
      start: "top top",
      end: () => `+=${distance() * 0.6}`,
      scrub: true,
    },
  });
  // Each panel's stage eases in as it slides past.
  panels.slice(1).forEach((panel) => {
    const stage = panel.querySelector(".ln-stage, .ln-month");
    if (stage)
      gsap.from(stage, {
        scale: 0.94,
        ease: "none",
        scrollTrigger: {
          trigger: panel,
          containerAnimation: slide,
          start: "left 90%",
          end: "left 30%",
          scrub: true,
        },
      });
  });
  // The nav can't reach a panel by scrolling down to it, so go by position.
  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest?.("a[href^='#']");
    const id = link?.getAttribute("href")?.slice(1);
    const at = panels.findIndex((p) => p.id === id);
    const st = slide.scrollTrigger;
    if (!st || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    lenis.scrollTo(st.start + ((st.end - st.start) * at) / (panels.length - 1));
  };
  window.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("click", onClick, true);
    root.classList.remove("is-pinned");
  };
}

/** Tabby leans toward the cursor, buttons pull to it, and tiles tilt under it. */
function hover() {
  const off: Array<() => void> = [];
  const listen = (
    el: HTMLElement,
    type: "pointermove" | "pointerleave",
    fn: (e: PointerEvent) => void
  ) => {
    el.addEventListener(type, fn as EventListener);
    off.push(() => el.removeEventListener(type, fn as EventListener));
  };
  const hero = document.querySelector<HTMLElement>(".ln-hero");
  const tabby = ".ln-hero-tabby";
  const toX = gsap.quickTo(tabby, "x", { duration: 0.8, ease: "power3" });
  const toY = gsap.quickTo(tabby, "y", { duration: 0.8, ease: "power3" });
  const toR = gsap.quickTo(tabby, "rotation", { duration: 0.8, ease: "power3" });
  if (hero)
    listen(hero, "pointermove", (e) => {
      const dx = e.clientX / window.innerWidth - 0.5;
      toX(dx * 36);
      toY((e.clientY / window.innerHeight - 0.5) * 14);
      toR(dx * 4);
    });
  gsap.utils.toArray<HTMLElement>(".ln-hero .ln-btn, .ln-close .ln-btn").forEach((btn) => {
    const x = gsap.quickTo(btn, "x", { duration: 0.4, ease: "power3" });
    const y = gsap.quickTo(btn, "y", { duration: 0.4, ease: "power3" });
    listen(btn, "pointermove", (e) => {
      const box = btn.getBoundingClientRect();
      x((e.clientX - box.left - box.width / 2) * 0.25);
      y((e.clientY - box.top - box.height / 2) * 0.35);
    });
    listen(btn, "pointerleave", () => {
      x(0);
      y(0);
    });
  });
  const main = document.querySelector<HTMLElement>("[data-main]");
  if (main) {
    gsap.set(main, { transformPerspective: 1400 });
    const mx = gsap.quickTo(main, "rotationY", { duration: 0.7, ease: "power3" });
    const my = gsap.quickTo(main, "rotationX", { duration: 0.7, ease: "power3" });
    listen(main, "pointermove", (e) => {
      const box = main.getBoundingClientRect();
      mx(((e.clientX - box.left) / box.width - 0.5) * 3);
      my(((e.clientY - box.top) / box.height - 0.5) * -3);
    });
    listen(main, "pointerleave", () => {
      mx(0);
      my(0);
    });
  }
  gsap.utils.toArray<HTMLElement>("[data-tilt]").forEach((tile) => {
    gsap.set(tile, { transformPerspective: 900 });
    const rx = gsap.quickTo(tile, "rotationX", { duration: 0.5, ease: "power3" });
    const ry = gsap.quickTo(tile, "rotationY", { duration: 0.5, ease: "power3" });
    listen(tile, "pointermove", (e) => {
      const box = tile.getBoundingClientRect();
      tile.style.setProperty("--sx", `${e.clientX - box.left}px`);
      tile.style.setProperty("--sy", `${e.clientY - box.top}px`);
      ry(((e.clientX - box.left) / box.width - 0.5) * 7);
      rx(((e.clientY - box.top) / box.height - 0.5) * -7);
    });
    listen(tile, "pointerleave", () => {
      rx(0);
      ry(0);
    });
  });
  return () => off.forEach((fn) => fn());
}

/** Smooth scroll and scroll-driven moves; with reduced motion the page stays still. */
export function Motion() {
  useEffect(() => {
    if (prefersReducedMotion()) {
      document.querySelector<HTMLVideoElement>("[data-film]")?.pause();
      const bar = document.querySelector(".ln-nav");
      const onScroll = () => bar?.classList.toggle("is-stuck", window.scrollY > 120);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ anchors: { offset: -72 } });
    lenis.on("scroll", ScrollTrigger.update);
    const nav = document.querySelector(".ln-nav");
    lenis.on("scroll", ({ scroll }: { scroll: number }) =>
      nav?.classList.toggle("is-stuck", scroll > 120)
    );
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Bars rest full, so they still show if this never runs.
    const chart = document.querySelector(".ln .chart");
    chart?.classList.add("is-waiting");
    const bars = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        chart?.classList.remove("is-waiting");
        bars.disconnect();
      },
      { threshold: 0.4 }
    );
    if (chart) bars.observe(chart);

    let galleryOff: (() => void) | undefined;
    let storyOff: (() => void) | undefined;
    const ctx = gsap.context(() => {
      const ease = "power2.out";
      gsap.from("[data-intro]", { y: 18, opacity: 0, duration: 0.9, stagger: 0.09, ease });
      gsap.from(".ln-hero-tabby", { yPercent: 14, duration: 1.4, ease: "power3.out" });
      const hero = { trigger: ".ln-hero", start: "top top", end: "bottom top", scrub: true };
      gsap.to(".ln-hero-tabby", { scale: 1.08, ease: "none", scrollTrigger: hero });
      gsap.to(".ln-hero-copy", { y: 60, opacity: 0, ease: "none", scrollTrigger: hero });

      gsap.set("[data-rise]", { y: 22, opacity: 0 });
      ScrollTrigger.batch("[data-rise]", {
        start: "top 88%",
        once: true,
        onEnter: (group) =>
          gsap.to(group, { y: 0, opacity: 1, duration: 0.7, ease, stagger: 0.08 }),
      });
      storyOff = story();
      lost();
      tiles();
      galleryOff = gallery(lenis);
      const mm = gsap.matchMedia();
      mm.add("(hover: hover) and (min-width: 1024px)", () => hover());
    });

    return () => {
      bars.disconnect();
      galleryOff?.();
      storyOff?.();
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
