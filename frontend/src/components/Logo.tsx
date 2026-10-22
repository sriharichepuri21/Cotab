/** The Cotab mark: a torn receipt slip with an interlocked c and o. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M10 16a10 10 0 0 1 10-10h24a10 10 0 0 1 10 10v36l-4 4.6-3.6-4-4.1 5-3.9-4.4-4.4 4.8-3.7-4.6-4.2 5-4-4.5-3.7 4.1L10 54z"
        fill="currentColor"
      />
      <circle cx="32" cy="12.5" r="2.3" fill="rgb(var(--c-gold))" />
      <path
        d="M33.5 27.5A8.5 8.5 0 1 0 33.5 38.5"
        fill="none"
        stroke="rgb(var(--c-gold))"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="38" cy="33" r="5.6" fill="none" stroke="rgb(var(--c-gold))" strokeWidth="5" />
      <path d="M51.6 22v24" stroke="rgb(var(--c-rose))" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Tabby's face in a rounded tile, then the name. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <span className="relative h-9 w-9 overflow-hidden rounded-[12px] bg-[radial-gradient(circle_at_50%_35%,#fff,#9DD7CD_75%)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cat/hi-head.webp" alt="" className="h-full w-full object-cover" />
      </span>
      <span className="text-[22px] font-extrabold tracking-[-0.05em]">cotab</span>
    </span>
  );
}
