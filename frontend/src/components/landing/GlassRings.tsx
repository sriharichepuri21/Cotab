/**
 * The Cotab mark, two interlocking glass tubes (one tab, two halves), drawn with the
 * logo's own lighting filter at any size. The light slowly circles round them.
 */
export function GlassRings({ className = "", uid = "gr" }: { className?: string; uid?: string }) {
  const id = (k: string) => `${uid}-${k}`;
  const front = "M31.96 23.64 A13 13 0 1 0 31.96 40.36 A13 13 0 0 0 31.96 23.64";
  return (
    <svg className={className} viewBox="2 10 66 44" aria-hidden="true">
      <defs>
        <linearGradient
          id={id("tube")}
          gradientUnits="userSpaceOnUse"
          x1="8"
          y1="6"
          x2="56"
          y2="58"
        >
          <stop offset="0" stopColor="#e6f5e0" />
          <stop offset=".45" stopColor="#a8cba6" />
          <stop offset="1" stopColor="#4f7f5a" />
        </linearGradient>
        <filter
          id={id("glass")}
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
            <feDistantLight azimuth="225" elevation="52">
              <animate
                attributeName="azimuth"
                values="225;315;135;225"
                dur="14s"
                repeatCount="indefinite"
              />
            </feDistantLight>
          </feDiffuseLighting>
          <feSpecularLighting
            in="b"
            surfaceScale="3.2"
            specularConstant="1.2"
            specularExponent="26"
            lightingColor="#ffffff"
            result="s"
          >
            <feDistantLight azimuth="225" elevation="46">
              <animate
                attributeName="azimuth"
                values="225;315;135;225"
                dur="14s"
                repeatCount="indefinite"
              />
            </feDistantLight>
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
        <filter id={id("soft")} filterUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id={id("over")}>
          <circle cx="32" cy="40.3" r="6.4" />
        </clipPath>
      </defs>
      <g filter={`url(#${id("glass")})`}>
        <path
          d={front}
          strokeDasharray="63.53 18.151"
          fill="none"
          stroke={`url(#${id("tube")})`}
          strokeWidth="6.2"
          strokeLinecap="round"
        />
      </g>
      <g filter={`url(#${id("soft")})`} opacity=".38" transform="translate(1.6 2.2)">
        <circle cx="42" cy="32" r="13" fill="none" stroke="#0b100a" strokeWidth="6.2" />
      </g>
      <g filter={`url(#${id("glass")})`}>
        <circle
          cx="42"
          cy="32"
          r="13"
          fill="none"
          stroke={`url(#${id("tube")})`}
          strokeWidth="6.2"
        />
      </g>
      {/* Where the rings cross, the first one passes back over the second. */}
      <g filter={`url(#${id("glass")})`}>
        <g clipPath={`url(#${id("over")})`}>
          <path
            d={front}
            strokeDasharray="63.53 18.151"
            fill="none"
            stroke={`url(#${id("tube")})`}
            strokeWidth="6.2"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
