"use client";

import { useEffect, useState } from "react";
import { dismissInsight, Insight, listInsights } from "@/lib/api";

export function InsightsCard() {
  const [items, setItems] = useState<Insight[]>([]);
  useEffect(() => {
    listInsights()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  if (!items.length) return null;
  return (
    <section className="mb-6 rounded-xl border border-line bg-gradient-to-br from-mint/40 to-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink">AI insights</p>
          <h2 className="mt-1 text-lg font-semibold">Worth noticing</h2>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.slice(0, 2).map((item) => (
          <article key={item.id} className="rounded-lg border bg-card p-4">
            <div className="flex justify-between gap-3">
              <strong className="text-sm">{item.title}</strong>
              <button
                aria-label={`Dismiss ${item.title}`}
                onClick={async () => {
                  await dismissInsight(item.id);
                  setItems((v) => v.filter((x) => x.id !== item.id));
                }}
                className="text-muted"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("rw:chat", {
                    detail: `Tell me more about this insight: ${item.title}. ${item.body}`,
                  })
                )
              }
              className="mt-3 text-sm font-medium text-ink"
            >
              Tell me more →
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
