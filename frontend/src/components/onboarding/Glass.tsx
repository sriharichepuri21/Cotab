/**
 * The logo's glass, for the onboarding visuals: one SVG filter that lights any shape
 * like the mark's tubes (diffuse plus a specular highlight from the top left), and the
 * mint gradient they are filled with. Put <GlassDefs /> once on the page.
 */
export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="ob-tube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6f5e0" />
          <stop offset=".45" stopColor="#a8cba6" />
          <stop offset="1" stopColor="#4f7f5a" />
        </linearGradient>
        <linearGradient id="ob-deep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fbf93" />
          <stop offset=".5" stopColor="#2f6a45" />
          <stop offset="1" stopColor="#123222" />
        </linearGradient>
        <filter
          id="ob-glass"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b" />
          <feDiffuseLighting
            in="b"
            surfaceScale="5"
            diffuseConstant="1.05"
            lightingColor="#eaf8e4"
            result="d"
          >
            <feDistantLight azimuth="225" elevation="52" />
          </feDiffuseLighting>
          <feSpecularLighting
            in="b"
            surfaceScale="5"
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
      </defs>
    </svg>
  );
}
