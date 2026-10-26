"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * An iOS large title: the big heading scrolls away and a frosted bar with a
 * small centred title (and the way back) takes its place at the top.
 */
export function LargeTitle({
  title,
  back,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = heading.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const watch = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), {
      rootMargin: "-44px 0px 0px 0px",
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <>
      <div
        aria-hidden={!compact}
        className={`material fixed inset-x-0 top-0 z-20 border-b border-ink/[0.08] pt-[env(safe-area-inset-top)] transition duration-300 md:left-64 ${
          compact ? "opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        <div className="relative mx-auto flex h-11 max-w-2xl items-center justify-center px-12">
          {back && (
            <Link
              href={back.href}
              tabIndex={compact ? 0 : -1}
              className="press absolute left-2 flex h-11 items-center pr-2 text-[17px] text-forest"
            >
              <Chevron />
              <span className="max-w-[7rem] truncate">{back.label}</span>
            </Link>
          )}
          <span className="truncate text-[17px] font-semibold">{title}</span>
        </div>
      </div>
      {back && (
        <Link
          href={back.href}
          className="press -ml-2 inline-flex w-fit items-center text-[17px] text-forest"
        >
          <Chevron />
          {back.label}
        </Link>
      )}
      <h1 ref={heading} className="font-display text-[34px] md:text-4xl">
        {title}
      </h1>
    </>
  );
}

function Chevron() {
  return (
    <span aria-hidden="true" className="ms -mr-0.5 text-[30px]">
      chevron_left
    </span>
  );
}
