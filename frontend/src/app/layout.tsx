import type { Metadata } from "next";
import "../styles/globals.css";
import { ChatDrawer } from "@/components/ChatDrawer";

export const metadata: Metadata = {
  title: "ReceiptWise",
  description: "AI-powered receipt tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {children}
        <ChatDrawer />
      </body>
    </html>
  );
}
