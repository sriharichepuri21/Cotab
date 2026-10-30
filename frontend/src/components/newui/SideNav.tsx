"use client";
/* eslint-disable @next/next/no-img-element -- the logo is a static SVG */

import { CotabLogo } from "@/components/CotabLogo";
import { Icon } from "@/components/ui";
import { useMe, useReviewQueue } from "@/lib/data";

import { Cat } from "./parts";

const MAIN: [string, string, string][] = [
  ["today", "Today", "home"],
  ["activity", "Activity", "receipt_long"],
  ["circles", "Tabs", "group"],
  ["tabby", "Tabby", "pets"],
];
const MONEY: [string, string, string][] = [
  ["insights", "Insights", "insights"],
  ["budgets", "Budgets", "account_balance_wallet"],
  ["send", "Send money", "north_east"],
  ["notifications", "Notifications", "notifications_none"],
];

/**
 * The app's navigation on wide screens (1024px and up): every place in one
 * column, Scan first. Phones keep the bottom bar. `here` is the tab or panel
 * showing; `go` opens one by the same name.
 */
export function SideNav({
  here,
  go,
  scan,
  dark,
  toggleTheme,
}: {
  here: string;
  go: (place: string) => void;
  scan: () => void;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const { data: user } = useMe();
  const waiting = useReviewQueue().data?.length ?? 0;
  const place = ([id, label, icon]: [string, string, string]) => (
    <button
      key={id}
      onClick={() => go(id)}
      aria-current={here === id ? "page" : undefined}
      className="side-item"
    >
      <Icon name={icon} size={20} fill={here === id} />
      <span className="flex-1 text-left">{label}</span>
      {id === "notifications" && waiting > 0 && (
        <span className="side-count" aria-label={`${waiting} new`}>
          {waiting}
        </span>
      )}
    </button>
  );
  return (
    <aside className="side-nav">
      <CotabLogo height={26} className="side-logo" />
      <button onClick={scan} aria-label="Scan a receipt" className="side-scan glass-cta">
        <img src="/brand/cotab-mark-glass.svg" alt="" width={24} />
        Scan a receipt
      </button>
      <nav aria-label="Main" className="mt-6 grid gap-1">
        {MAIN.map(place)}
        <p className="side-label">Money</p>
        {MONEY.map(place)}
      </nav>
      <div className="mt-auto grid gap-1">
        <button onClick={toggleTheme} className="side-item">
          <Icon name={dark ? "light_mode" : "dark_mode"} size={20} />
          <span className="flex-1 text-left">{dark ? "Day theme" : "Night theme"}</span>
        </button>
        <button
          onClick={() => go("profile")}
          aria-current={here === "profile" ? "page" : undefined}
          className="side-item side-me"
        >
          <Cat mood={user?.avatar_mood || "cool"} size={32} />
          <span className="min-w-0 flex-1 truncate text-left">
            {user?.full_name?.split(" ")[0] || "Profile"}
          </span>
          <Icon name="settings" size={18} />
        </button>
      </div>
    </aside>
  );
}
