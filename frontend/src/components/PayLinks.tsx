"use client";

import { useState } from "react";

import type { PayLink } from "@/lib/api";

const tint: Record<string, string> = {
  venmo: "bg-[#008CFF] text-white",
  paypal: "bg-[#003087] text-white",
  cashapp: "bg-[#00D64F] text-ink",
  zelle: "bg-[#6D1ED4] text-white",
};

/**
 * One button per way the other person takes money. Venmo, PayPal and Cash App
 * open with the amount filled in; Zelle has no link, so it copies their details.
 * Opening a link pays nobody by itself: the person still confirms in the app.
 */
export function PayLinks({
  links,
  onOpened,
}: {
  links: PayLink[];
  onOpened?: (method: string) => void;
}) {
  const [copied, setCopied] = useState("");
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) =>
        link.url ? (
          <a
            key={link.method}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => onOpened?.(link.method)}
            className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-bold ${tint[link.method]}`}
          >
            Pay with {link.label}
          </a>
        ) : (
          <button
            key={link.method}
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link.copy ?? "");
                setCopied(link.method);
              } catch {
                setCopied("");
              }
              onOpened?.(link.method);
            }}
            className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-bold ${tint[link.method]}`}
          >
            {copied === link.method ? `Copied ${link.copy}` : `Zelle: ${link.copy}`}
          </button>
        )
      )}
    </div>
  );
}
