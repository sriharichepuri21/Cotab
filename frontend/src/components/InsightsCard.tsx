"use client";

import { dismissInsight, Insight } from "@/lib/api";
import { mutate } from "@/lib/cache";
import { keys, useInsights } from "@/lib/data";

/** Up to two things Cotab noticed in your receipts, each one tap from Ask. */
export function InsightsCard() {
  const items = useInsights().data ?? [];
  if (!items.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">Cotab noticed</h2>
      <ul className="flex flex-col gap-3">
        {items.slice(0, 2).map((item) => (
          <li key={item.id} className="rounded-card bg-blush/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{item.title}</p>
              <button
                type="button"
                aria-label={`Dismiss ${item.title}`}
                onClick={() => {
                  // Gone from the screen at once; the server catches up.
                  mutate<Insight[]>(keys.insights, (v = []) => v.filter((x) => x.id !== item.id));
                  dismissInsight(item.id).catch(() => undefined);
                }}
                className="-mr-2 -mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg hover:bg-ink/10"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-[15px] leading-relaxed">{item.body}</p>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("rw:chat", {
                    detail: `Tell me more about this: ${item.title}. ${item.body}`,
                  })
                )
              }
              className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-4"
            >
              Ask about this
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
