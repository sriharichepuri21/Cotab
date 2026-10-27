import { CotabMark, CotabWord } from "@/components/CotabLogo";

/**
 * The first frame of the signed-in app, while the session is checked: the mark
 * with its c opening and closing, then the name. It uses the app's launch
 * colour (see manifest.webmanifest), so it joins the phone's own splash.
 */
export function AppSplash() {
  return (
    <div
      role="status"
      aria-label="Opening Cotab"
      className="app-splash fixed inset-0 z-[80] grid place-items-center"
    >
      <div className="grid justify-items-center gap-5">
        <CotabMark size={92} animated />
        <CotabWord height={30} className="splash-word" />
      </div>
    </div>
  );
}
