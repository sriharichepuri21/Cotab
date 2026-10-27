"use client";

import { useEffect, useId, useState } from "react";

/**
 * The Cotab mark: a c and an o woven through each other, drawn as frosted
 * glass. The gap in the c is an open tab; it closes when the tab is settled.
 * Geometry matches the logo pack (Cotab-Logo-B) exactly: change it there first.
 *
 * Colour comes from CSS variables (--logo-a/b/c, set in glass.css) so the same
 * mark reads on dark and light grounds. Below ~28px the glass turns to mud, so
 * small sizes use the flat, one-colour drawing.
 */
const R = 13;
const W = 6.2;
const CC = [22, 32];
const OC = [42, 32];
const CIRC = 81.681;
const C_PATH = "M31.96 23.64 A13 13 0 1 0 31.96 40.36 A13 13 0 0 0 31.96 23.64";
const OVER = [32, 40.3, 6.4];
const UNDER = [32, 23.7, 6.4];
const OPEN_DASH = "63.530 18.151";
const OPEN_OFFSET = 0.0;
const LOADER_DASH = "63.530 18.151;63.530 18.151;81.681 0;81.681 0;63.530 18.151;63.530 18.151";
const LOADER_OFFSET = "0.000;0.000;0.000;0.000;0.000;0.000";
const LOADER_TIMES = "0;.125;.375;.6;.85;1";
const SPLINES = "0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1";

function usePlainMotion() {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    setCalm(Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  }, []);
  return calm;
}

/** The mark's drawing on a 64-unit grid. `settled` closes the c; `animated` loops it closing and opening. */
function MarkBody({
  uid,
  flat,
  settled,
  animated,
}: {
  uid: string;
  flat: boolean;
  settled: boolean;
  animated: boolean;
}) {
  const dash = settled ? `${CIRC.toFixed(3)} 0` : OPEN_DASH;
  const offset = settled ? 0 : OPEN_OFFSET;
  const anim = animated ? (
    <>
      <animate
        attributeName="stroke-dasharray"
        values={LOADER_DASH}
        keyTimes={LOADER_TIMES}
        keySplines={SPLINES}
        calcMode="spline"
        dur="2.4s"
        repeatCount="indefinite"
      />
      <animate
        attributeName="stroke-dashoffset"
        values={LOADER_OFFSET}
        keyTimes={LOADER_TIMES}
        keySplines={SPLINES}
        calcMode="spline"
        dur="2.4s"
        repeatCount="indefinite"
      />
    </>
  ) : null;
  const c = (stroke: string, extra?: object) => (
    <path
      d={C_PATH}
      fill="none"
      stroke={stroke}
      strokeWidth={W}
      strokeLinecap="round"
      strokeDasharray={dash}
      strokeDashoffset={offset}
      {...extra}
    >
      {anim}
    </path>
  );
  const over = (
    <clipPath id={`over${uid}`}>
      <circle cx={OVER[0]} cy={OVER[1]} r={OVER[2]} />
    </clipPath>
  );
  if (flat) {
    const gap = W + 2.6;
    return (
      <>
        <defs>
          {over}
          <clipPath id={`under${uid}`}>
            <circle cx={UNDER[0]} cy={UNDER[1]} r={UNDER[2]} />
          </clipPath>
          <mask id={`mc${uid}`} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
            <rect x="-8" y="-8" width="80" height="80" fill="#fff" />
            <g clipPath={`url(#under${uid})`}>
              <circle cx={OC[0]} cy={OC[1]} r={R} fill="none" stroke="#000" strokeWidth={gap} />
            </g>
          </mask>
          <mask id={`mo${uid}`} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
            <rect x="-8" y="-8" width="80" height="80" fill="#fff" />
            <g clipPath={`url(#over${uid})`}>{c("#000", { strokeWidth: gap })}</g>
          </mask>
        </defs>
        <g mask={`url(#mc${uid})`}>{c("currentColor")}</g>
        <g mask={`url(#mo${uid})`}>
          <circle cx={OC[0]} cy={OC[1]} r={R} fill="none" stroke="currentColor" strokeWidth={W} />
        </g>
        <g clipPath={`url(#over${uid})`}>{c("currentColor")}</g>
      </>
    );
  }
  const tube = `url(#tube${uid})`;
  const glass = `url(#glass${uid})`;
  const soft = `url(#soft${uid})`;
  return (
    <>
      <defs>
        <linearGradient
          id={`tube${uid}`}
          gradientUnits="userSpaceOnUse"
          x1="8"
          y1="6"
          x2="56"
          y2="58"
        >
          <stop offset="0" style={{ stopColor: "var(--logo-a, #e6f5e0)" }} />
          <stop offset=".45" style={{ stopColor: "var(--logo-b, #a8cba6)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-c, #4f7f5a)" }} />
        </linearGradient>
        <filter
          id={`glass${uid}`}
          filterUnits="userSpaceOnUse"
          x="-8"
          y="-8"
          width="80"
          height="80"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="b" />
          <feDiffuseLighting
            in="b"
            surfaceScale="3.2"
            diffuseConstant="1.05"
            lightingColor="#eaf8e4"
            result="d"
          >
            <feDistantLight azimuth="225" elevation="52" />
          </feDiffuseLighting>
          <feSpecularLighting
            in="b"
            surfaceScale="3.2"
            specularConstant="1.2"
            specularExponent="26"
            lightingColor="#ffffff"
            result="s"
          >
            <feDistantLight azimuth="225" elevation="46" />
          </feSpecularLighting>
          <feComposite in="d" in2="SourceAlpha" operator="in" result="dIn" />
          <feComposite in="s" in2="SourceAlpha" operator="in" result="sIn" />
          <feComposite
            in="SourceGraphic"
            in2="dIn"
            operator="arithmetic"
            k1="0"
            k2=".62"
            k3=".42"
            k4="0"
            result="lit"
          />
          <feComposite in="lit" in2="sIn" operator="arithmetic" k1="0" k2="1" k3=".8" k4="0" />
        </filter>
        <filter id={`soft${uid}`} filterUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        {over}
      </defs>
      <g filter={glass}>{c(tube)}</g>
      <g filter={soft} opacity=".38" transform="translate(1.6 2.2)">
        <circle cx={OC[0]} cy={OC[1]} r={R} fill="none" stroke="#12261a" strokeWidth={W} />
      </g>
      <g filter={glass}>
        <circle cx={OC[0]} cy={OC[1]} r={R} fill="none" stroke={tube} strokeWidth={W} />
      </g>
      <g filter={soft} opacity=".38" transform="translate(1.4 2)">
        <g clipPath={`url(#over${uid})`}>{c("#12261a")}</g>
      </g>
      <g filter={glass}>
        <g clipPath={`url(#over${uid})`}>{c(tube)}</g>
      </g>
    </>
  );
}

export type MarkProps = {
  /** Height in px of the mark's box. */
  size?: number;
  /** Close the c: the tab is settled. */
  settled?: boolean;
  /** Loop the c closing and opening (a loading state). */
  animated?: boolean;
  /** Force the flat drawing; it is chosen on its own below 28px. */
  flat?: boolean;
  className?: string;
  title?: string;
};

export function CotabMark({
  size = 32,
  settled = false,
  animated = false,
  flat,
  className = "",
  title = "Cotab",
}: MarkProps) {
  const uid = useId().replace(/:/g, "");
  const calm = usePlainMotion();
  const small = flat ?? size < 28;
  return (
    <svg
      viewBox="4 12 56 40"
      height={size}
      width={(size * 56) / 40}
      role="img"
      aria-label={title}
      className={`cotab-mark ${className}`}
    >
      <title>{title}</title>
      <MarkBody uid={uid} flat={small} settled={settled} animated={animated && !calm} />
    </svg>
  );
}

const WORD_D =
  "M28.900000000000002 1.1Q21.400000000000002 1.1 15.3 -2.2Q9.200000000000001 -5.5 5.700000000000001 -11.3Q2.2 -17.1 2.2 -24.3Q2.2 -31.6 5.75 -37.35Q9.3 -43.1 15.4 -46.400000000000006Q21.5 -49.7 29.1 -49.7Q34.800000000000004 -49.7 39.550000000000004 -47.75Q44.300000000000004 -45.800000000000004 48.0 -41.900000000000006L38.2 -32.1Q36.5 -34.0 34.25 -34.900000000000006Q32.0 -35.800000000000004 29.1 -35.800000000000004Q25.8 -35.800000000000004 23.25 -34.35Q20.700000000000003 -32.9 19.25 -30.35Q17.8 -27.8 17.8 -24.400000000000002Q17.8 -21.0 19.25 -18.4Q20.700000000000003 -15.8 23.300000000000004 -14.3Q25.900000000000002 -12.8 29.1 -12.8Q32.1 -12.8 34.45 -13.850000000000001Q36.800000000000004 -14.9 38.5 -16.8L48.2 -7.0Q44.400000000000006 -3.0 39.60000000000001 -0.95Q34.800000000000004 1.1 28.900000000000002 1.1Z M74.4 1.1Q66.9 1.1 60.85000000000001 -2.25Q54.800000000000004 -5.6000000000000005 51.300000000000004 -11.4Q47.800000000000004 -17.2 47.800000000000004 -24.400000000000002Q47.800000000000004 -31.6 51.300000000000004 -37.3Q54.800000000000004 -43.0 60.80000000000001 -46.35Q66.80000000000001 -49.7 74.4 -49.7Q82.0 -49.7 88.0 -46.400000000000006Q94.0 -43.1 97.5 -37.35Q101.0 -31.6 101.0 -24.400000000000002Q101.0 -17.2 97.5 -11.4Q94.0 -5.6000000000000005 88.0 -2.25Q82.0 1.1 74.4 1.1ZM74.4 -12.8Q77.7 -12.8 80.2 -14.25Q82.7 -15.700000000000001 84.05000000000001 -18.35Q85.4 -21.0 85.4 -24.400000000000002Q85.4 -27.8 84.0 -30.35Q82.6 -32.9 80.15 -34.35Q77.7 -35.800000000000004 74.4 -35.800000000000004Q71.2 -35.800000000000004 68.7 -34.35Q66.2 -32.9 64.80000000000001 -30.3Q63.400000000000006 -27.700000000000003 63.400000000000006 -24.3Q63.400000000000006 -21.0 64.80000000000001 -18.35Q66.2 -15.700000000000001 68.7 -14.25Q71.2 -12.8 74.4 -12.8Z M111.5 0.0V-35.6H100.5V-48.6H111.5V-68.7H126.80000000000001V-48.6H137.8V-35.6H126.80000000000001V0.0Z M160.8 1.0Q154.10000000000002 1.0 148.85000000000002 -2.3000000000000003Q143.60000000000002 -5.6000000000000005 140.55 -11.3Q137.50000000000003 -17.0 137.50000000000003 -24.3Q137.50000000000003 -31.6 140.55 -37.3Q143.60000000000002 -43.0 148.85000000000002 -46.3Q154.10000000000002 -49.6 160.8 -49.6Q165.70000000000002 -49.6 169.70000000000002 -47.7Q172.20000000000002 -46.5 174.20000000000002 -44.6V-48.6H189.20000000000002V0.0H174.20000000000002V-3.9000000000000004Q172.3 -2.1 169.70000000000002 -0.9Q165.70000000000002 1.0 160.8 1.0ZM163.90000000000003 -12.8Q168.8 -12.8 171.8 -16.05Q174.8 -19.3 174.8 -24.3Q174.8 -27.700000000000003 173.45000000000002 -30.3Q172.10000000000002 -32.9 169.65000000000003 -34.35Q167.20000000000002 -35.800000000000004 164.0 -35.800000000000004Q160.8 -35.800000000000004 158.35000000000002 -34.35Q155.90000000000003 -32.9 154.45000000000005 -30.3Q153.00000000000003 -27.700000000000003 153.00000000000003 -24.3Q153.00000000000003 -21.0 154.40000000000003 -18.4Q155.8 -15.8 158.3 -14.3Q160.8 -12.8 163.90000000000003 -12.8Z M224.00000000000003 1.0Q219.10000000000002 1.0 215.00000000000003 -1.1Q212.8 -2.1 211.10000000000002 -3.6V0.0H196.00000000000003V-72.60000000000001H211.3V-45.5Q213.00000000000003 -46.800000000000004 215.00000000000003 -47.7Q219.10000000000002 -49.6 224.00000000000003 -49.6Q230.90000000000003 -49.6 236.25000000000003 -46.3Q241.60000000000002 -43.0 244.65000000000003 -37.3Q247.70000000000002 -31.6 247.70000000000002 -24.3Q247.70000000000002 -17.0 244.65000000000003 -11.3Q241.60000000000002 -5.6000000000000005 236.25000000000003 -2.3000000000000003Q230.90000000000003 1.0 224.00000000000003 1.0ZM221.3 -12.8Q224.50000000000003 -12.8 226.95000000000005 -14.3Q229.40000000000003 -15.8 230.8 -18.4Q232.20000000000002 -21.0 232.20000000000002 -24.3Q232.20000000000002 -27.700000000000003 230.8 -30.3Q229.40000000000003 -32.9 226.95000000000005 -34.35Q224.50000000000003 -35.800000000000004 221.3 -35.800000000000004Q218.10000000000002 -35.800000000000004 215.60000000000002 -34.35Q213.10000000000002 -32.9 211.75000000000003 -30.3Q210.40000000000003 -27.700000000000003 210.40000000000003 -24.300000000000004Q210.40000000000003 -20.900000000000002 211.8 -18.3Q213.20000000000002 -15.700000000000001 215.65000000000003 -14.25Q218.10000000000002 -12.8 221.3 -12.8Z";

/** The mark and the word "cotab" (outlined Outfit Bold), aligned on one centre line. */
export function CotabLogo({
  height = 30,
  flat,
  className = "",
  title = "Cotab",
}: {
  height?: number;
  flat?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const small = flat ?? height < 26;
  return (
    <svg
      viewBox="0 0 391.2 73.7"
      height={height}
      width={(height * 391.2) / 73.7}
      role="img"
      aria-label={title}
      className={`cotab-logo ${className}`}
    >
      <title>{title}</title>
      <g transform="translate(-13.23 -34.93) scale(2.2430)">
        <MarkBody uid={uid} flat={small} settled={false} animated={false} />
      </g>
      <path transform="translate(141.09 72.60)" d={WORD_D} fill="currentColor" />
    </svg>
  );
}
