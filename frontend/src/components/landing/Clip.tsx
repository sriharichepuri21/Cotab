/**
 * Tabby's clips. By default he is cut out of his background and landing-motion.js picks the
 * format that keeps the transparency (HEVC for Safari, VP9 for the rest). A `boxed` clip is
 * the original film, set on a surface painted its own background colour.
 */
export function Clip({
  name,
  label,
  className = "",
  boxed = false,
}: {
  name: string;
  label: string;
  className?: string;
  boxed?: boolean;
}) {
  return (
    <video
      className={`clip ${boxed ? "clip-boxed " : ""}${className}`}
      data-clip={name}
      data-src={boxed ? `/landing/tabby-${name}.mp4` : undefined}
      muted
      loop
      playsInline
      preload="none"
      poster={boxed ? `/landing/tabby-${name}.jpg` : `/landing/cut/tabby-${name}.webp`}
      aria-label={label}
      width={720}
      height={720}
    />
  );
}
