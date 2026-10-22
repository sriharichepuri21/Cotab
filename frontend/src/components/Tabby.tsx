/* eslint-disable @next/next/no-img-element -- small local webps, already sized */
import type { CSSProperties, ReactNode } from "react";

import type { TabbyChoice, TabbyMood } from "@/lib/api";
import { catSrc, duoSrc, tint, type DuoScene } from "@/lib/tabby";

const SAGE = "radial-gradient(circle at 50% 35%, #F4F7F4, #C9D6CD 75%)";

function circleBg(choice: TabbyChoice, soft = false) {
  if (choice.bg === "sage") return SAGE;
  const [light, deep] = tint(choice.mood);
  return soft
    ? `radial-gradient(circle at 50% 35%, #FFFFFF, ${light} 70%)`
    : `radial-gradient(circle at 50% 35%, ${light}, ${deep})`;
}

/** A Tabby head in a tinted circle: profile pictures, friends, the nav icon. */
export function CatAvatar({
  choice,
  size = 48,
  soft = false,
  ring,
  className = "",
  label,
}: {
  choice: TabbyChoice;
  size?: number;
  /** Paler tint, for rows of friends. */
  soft?: boolean;
  /** Outline colour, e.g. a white ring on a coloured card. */
  ring?: string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`relative block shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: circleBg(choice, soft),
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
      }}
    >
      <img
        src={catSrc(choice.mood, choice.look, true)}
        alt=""
        width={size}
        height={size}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
    </span>
  );
}

/**
 * Tabby standing on top of whatever comes next (usually a card), hopping in
 * with a speech bubble. Put it directly above the card; it overlaps by `sink`.
 */
export function TabbyStand({
  mood,
  look = "hoodie",
  height = 140,
  bubble,
  side = "right",
  alt,
  className = "",
}: {
  mood: TabbyMood;
  look?: TabbyChoice["look"];
  height?: number;
  bubble?: ReactNode;
  side?: "left" | "right";
  alt?: string;
  className?: string;
}) {
  const catSide: CSSProperties = side === "right" ? { right: 18 } : { left: 18 };
  const bubbleSide: CSSProperties =
    side === "right"
      ? { left: 6, borderRadius: "20px 20px 6px 20px", transformOrigin: "100% 100%" }
      : { right: 6, borderRadius: "20px 20px 20px 6px", transformOrigin: "0% 100%" };
  return (
    <div className={`relative ${className}`} style={{ height: height - 12 }}>
      {bubble && (
        <div
          className="tabby-bubble absolute top-[34px] max-w-[210px] bg-card px-3.5 py-3 text-sm font-semibold leading-snug text-ink shadow-[0_14px_28px_-16px_rgb(12_17_14/0.35)]"
          style={bubbleSide}
        >
          {bubble}
        </div>
      )}
      <span
        aria-hidden="true"
        className="tabby-shadow absolute z-[2] h-3.5 rounded-full"
        style={{
          ...(side === "right" ? { right: 30 } : { left: 30 }),
          bottom: -19,
          width: height * 0.78,
        }}
      />
      <img
        src={catSrc(mood, look)}
        alt={alt ?? "Tabby"}
        className="tabby-hop absolute top-0 z-[3]"
        style={{ ...catSide, height }}
        draggable={false}
      />
    </div>
  );
}

/** Two cats together, for the moments money changes hands. */
export function Duo({
  scene,
  width = 200,
  alt = "",
  className = "",
}: {
  scene: DuoScene;
  width?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={duoSrc(scene)}
      alt={alt}
      width={width}
      height={Math.round((width * 278) / 331)}
      className={`rounded-[18px] ${className}`}
      draggable={false}
    />
  );
}

const CONFETTI = ["#D7F45B", "#0F3D31", "#FF8A5B", "#5CB7F2", "#FF5C7C", "#F3D38B"];

/** A short burst of confetti over its parent (which must be `relative`). */
export function Confetti({ pieces = 26 }: { pieces?: number }) {
  return (
    <span
      aria-hidden="true"
      className="confetti pointer-events-none absolute inset-0 overflow-hidden"
    >
      {Array.from({ length: pieces }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI[i % CONFETTI.length],
            animationDelay: `${(i % 7) * 0.08}s`,
            transform: `rotate(${i * 29}deg)`,
          }}
        />
      ))}
    </span>
  );
}
