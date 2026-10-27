import type { ReactNode } from "react";

/** The scan screens' own icons: one 24px grid with a 1.8 round stroke. */
export type ScanIconName = "photos" | "files" | "pen" | "camera" | "more" | "check" | "alert";

const shapes: Record<ScanIconName, (on: boolean) => ReactNode> = {
  photos: () => (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <circle cx="9" cy="10.2" r="1.6" />
      <path d="m4.5 17 4.6-4.4 3.3 3 2.6-2.4 4.5 4" />
    </>
  ),
  files: () => (
    <>
      <path d="M7 3.5h6.5L18.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M13.5 3.5v5h5M12 17v-5m0 0-2.2 2.2M12 12l2.2 2.2" />
    </>
  ),
  pen: () => (
    <>
      <path d="m4.5 19.5 1-4L16.8 4.2a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L8.5 18.5z" />
      <path d="m14.8 6.2 3 3" />
    </>
  ),
  camera: () => (
    <>
      <path d="M4.5 8.5a2 2 0 0 1 2-2h1.6l1.2-1.7h5.4l1.2 1.7h1.6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.8" r="3.3" />
    </>
  ),
  more: () => (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  check: () => <path d="m5.5 12.8 4.2 4.2 8.8-9.6" strokeWidth="2.4" />,
  alert: () => (
    <>
      <path d="M12 7.5v6" strokeWidth="2.4" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function ScanIcon({
  name,
  active = false,
  size = 24,
}: {
  name: ScanIconName;
  active?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name](active)}
    </svg>
  );
}
