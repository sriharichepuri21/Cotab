"use client";

import { useState } from "react";

/** A value to paste somewhere else (an address, a key), with a copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <p className="mb-1 text-sm font-semibold">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-button border border-line bg-card px-3 py-2.5 font-mono text-[13px]">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="min-h-11 shrink-0 rounded-button bg-forest px-4 text-sm font-semibold text-paper"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
