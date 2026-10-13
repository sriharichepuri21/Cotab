import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { ChatDrawer } from "@/components/ChatDrawer";

export const metadata: Metadata = {
  title: "Cotab",
  description: "Keep tabs on everything you buy.",
};

export const viewport: Viewport = {
  themeColor: "#0F3D31",
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,800&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <ChatDrawer />
      </body>
    </html>
  );
}
