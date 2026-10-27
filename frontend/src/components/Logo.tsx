import { CotabLogo, CotabMark } from "@/components/CotabLogo";

/** The Cotab mark on its own, for avatars, loading states and small spaces. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return <CotabMark size={size} />;
}

/** The mark and the name. Takes its colour from the text around it. */
export function Logo() {
  return <CotabLogo height={34} className="text-ink" />;
}
