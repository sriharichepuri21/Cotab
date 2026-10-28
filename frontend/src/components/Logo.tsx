/* eslint-disable @next/next/no-img-element -- approved outlined brand SVGs */

type LogoTone = "light" | "dark" | "flat";

/** The approved v1.1 “Two halves” mark from the Cotab brand pack. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/brand/cotab-mark-flat-ink.svg"
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: "auto" }}
    />
  );
}

/** Official outlined wordmark. Never re-typeset the Cotab name beside the mark. */
export function Logo({ height = 36, tone = "light" }: { height?: number; tone?: LogoTone }) {
  const file =
    tone === "dark"
      ? "cotab-horizontal-glass-on-dark.svg"
      : tone === "flat"
        ? "cotab-horizontal-flat-ink.svg"
        : "cotab-horizontal-glass-on-light.svg";
  return (
    <img
      src={`/brand/${file}`}
      alt="Cotab"
      width={Math.round(height * 4.39)}
      height={height}
      style={{ width: "auto", height }}
    />
  );
}
