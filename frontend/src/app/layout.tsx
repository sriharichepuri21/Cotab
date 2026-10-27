import type { Metadata, Viewport } from "next";
import "@fontsource-variable/urbanist";
import "@fontsource-variable/doto";
import "../styles/globals.css";
import "../styles/glass.css";
import "../styles/scan.css";
import { ChatDrawer } from "@/components/ChatDrawer";
import { ServerWaking } from "@/components/ServerWaking";

export const metadata: Metadata = {
  title: "Cotab",
  description: "Keep tabs on everything you buy.",
  // Installable: on iPhone, notifications only work once Cotab is on the
  // Home Screen.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cotab", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#050706",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Loaded at runtime rather than through next/font so builds never
            depend on reaching Google Fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* The rule below targets the old pages/ router; in the app router the
            root layout is shared by every page, which is what it asks for. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
        />
        {/* Icons load with display=block on purpose: with swap, each icon's name
            flashes as plain text ("home", "receipt_long") before the font arrives. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=block"
        />
      </head>
      <body>
        {children}
        <ChatDrawer />
        <ServerWaking />
      </body>
    </html>
  );
}
