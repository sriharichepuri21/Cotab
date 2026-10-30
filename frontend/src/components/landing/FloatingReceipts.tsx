"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { Clip } from "./Clip";

type Paper = {
  shop: string;
  total: string;
  x: number;
  y: number;
  size: number;
  /** How close it floats: 0 sits far back, 1 passes right by you. */
  depth: number;
  tilt: [number, number, number];
};

const PAPERS: Paper[] = [
  {
    shop: "Corner Market",
    total: "46.53",
    x: 7,
    y: 8,
    size: 150,
    depth: 0.9,
    tilt: [18, -24, -14],
  },
  {
    shop: "Night Noodles",
    total: "32.10",
    x: 22,
    y: 30,
    size: 104,
    depth: 0.3,
    tilt: [-14, 26, 12],
  },
  { shop: "Daily Grind", total: "6.75", x: 4, y: 56, size: 172, depth: 1, tilt: [22, 18, 16] },
  {
    shop: "City Pharmacy",
    total: "18.20",
    x: 24,
    y: 72,
    size: 118,
    depth: 0.45,
    tilt: [-20, -18, -22],
  },
  { shop: "Green Grocer", total: "85.58", x: 80, y: 6, size: 126, depth: 0.5, tilt: [16, 28, 20] },
  { shop: "Fuel Stop", total: "41.05", x: 66, y: 28, size: 96, depth: 0.2, tilt: [-22, -14, -10] },
  {
    shop: "Trattoria Sole",
    total: "118.40",
    x: 84,
    y: 44,
    size: 168,
    depth: 0.95,
    tilt: [20, -26, 12],
  },
  { shop: "Book Nook", total: "24.99", x: 66, y: 74, size: 112, depth: 0.4, tilt: [-16, 22, 24] },
  { shop: "Home Goods", total: "63.55", x: 86, y: 78, size: 136, depth: 0.7, tilt: [24, 16, -18] },
];

/** Receipts drift in 3D around Tabby, at their own depth, following the cursor and the scroll. */
export function FloatingReceipts() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const pointer = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - box.left) / box.width - 0.5).toFixed(3));
      el.style.setProperty("--my", ((e.clientY - box.top) / box.height - 0.5).toFixed(3));
    };
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const through = (box.top + box.height / 2 - innerHeight / 2) / innerHeight;
        el.style.setProperty("--sy", Math.max(-1.5, Math.min(1.5, through)).toFixed(3));
      });
    };
    // Airborne from 0.45s to 2.5s of the clip: the shadow lifts with Tabby and returns on landing.
    const video = el.querySelector("video");
    const shadow = el.querySelector(".floor-shadow");
    const hop = () =>
      video &&
      shadow?.classList.toggle("is-air", video.currentTime > 0.45 && video.currentTime < 2.5);
    video?.addEventListener("timeupdate", hop);
    scroll();
    el.addEventListener("pointermove", pointer);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      video?.removeEventListener("timeupdate", hop);
      el.removeEventListener("pointermove", pointer);
      window.removeEventListener("scroll", scroll);
    };
  }, []);

  return (
    <section ref={root} className="float day" aria-labelledby="float-title">
      <h2 id="float-title" className="float-title">
        <span>Snapped.</span>
        <span>Read.</span>
        <span>Settled.</span>
      </h2>
      <p className="float-deck">
        Every receipt lands with Tabby, and comes back filed, budgeted and split.
      </p>
      <div className="float-field" aria-hidden="true">
        {PAPERS.map((p, i) => (
          <div
            key={p.shop}
            className="float-slot"
            style={
              {
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                "--depth": p.depth,
                "--blur": `${p.depth > 0.85 ? 3 : p.depth < 0.35 ? 1.5 : 0}px`,
                "--rx": `${p.tilt[0]}deg`,
                "--ry": `${p.tilt[1]}deg`,
                "--rz": `${p.tilt[2]}deg`,
                "--drift": `${7 + (i % 4) * 1.5}s`,
                "--delay": `${i * -1.3}s`,
              } as CSSProperties
            }
          >
            <div className="float-paper">
              <b>{p.shop}</b>
              <i />
              <i />
              <i />
              <span>
                Total <b>${p.total}</b>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="float-tabby">
        <span className="floor-shadow" aria-hidden="true" />
        <Clip name="catch" label="Tabby catches a receipt" />
      </div>
    </section>
  );
}
