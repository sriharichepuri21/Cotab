"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { ApiError, clearToken, isAuthed, logout } from "@/lib/api";
import { routes } from "@/lib/routes";
import { scanAndUpload } from "@/lib/upload";

type NavItem = { href: string; label: string; icon: ReactNode; match: (path: string) => boolean };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons = {
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 11l8-7 8 7v9H4z" />
    </svg>
  ),
  tab: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
  house: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 5h18M7 5v4h4V5M13 5v4h4V5M7 9h4v9l-2-1-2 1zM13 9h4v9l-2-1-2 1z" />
    </svg>
  ),
  budgets: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 19h16M7 16v-5M12 16V8M17 16V5" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  ),
};

const HOME: NavItem = {
  href: routes.home,
  label: "Home",
  match: (p) => p === routes.home,
  icon: icons.home,
};
const TAB: NavItem = {
  href: routes.tab,
  label: "Tab",
  match: (p) => p.startsWith(routes.tab) || p.startsWith("/app/receipts"),
  icon: icons.tab,
};
const HOUSE: NavItem = {
  href: routes.groups,
  label: "House",
  match: (p) => p.startsWith(routes.groups),
  icon: icons.house,
};
const BUDGETS: NavItem = {
  href: routes.budgets,
  label: "Budgets",
  match: (p) => p.startsWith(routes.budgets),
  icon: icons.budgets,
};
const SETTINGS: NavItem = {
  href: routes.settings,
  label: "Settings",
  match: (p) => p.startsWith(routes.settings),
  icon: icons.settings,
};

/** Sidebar has room for everything; the phone bar keeps the prototype's five. */
const SIDEBAR = [HOME, TAB, HOUSE, BUDGETS];

const askIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);

const scanIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.2}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8" />
  </svg>
);

function openChat() {
  window.dispatchEvent(new CustomEvent("rw:chat", { detail: "" }));
}

type ScanState = { kind: "idle" } | { kind: "busy" } | { kind: "done" | "error"; text: string };

/**
 * Frame for every signed-in page: a bottom tab bar on phones, a sidebar on
 * wider screens, and the gold Scan button in both. It is also the one place
 * that sends signed-out visitors to the sign-in page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [scan, setScan] = useState<ScanState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onScan(file: File | undefined) {
    if (!file) return;
    clearTimeout(timer.current);
    setScan({ kind: "busy" });
    try {
      const result = await scanAndUpload(file);
      setScan(
        result.status === "failed"
          ? { kind: "error", text: "We couldn't read that one. Open it from your tab to retry." }
          : { kind: "done", text: `${result.merchant || "Receipt"} is on your tab.` }
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        router.replace(routes.login);
        return;
      }
      setScan({ kind: "error", text: (e as Error).message || "Upload failed. Try again." });
    }
    timer.current = setTimeout(() => setScan({ kind: "idle" }), 4000);
  }

  async function onSignOut() {
    try {
      await logout();
    } finally {
      router.push(routes.login);
    }
  }

  if (!ready) return null;

  const scanInput = (
    <input
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      disabled={scan.kind === "busy"}
      onChange={(e) => {
        onScan(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-2 border-r border-line bg-paper px-4 py-6 md:flex">
        <Link href={routes.home} aria-label="Cotab home" className="mb-6 px-2">
          <Logo />
        </Link>
        <label className="mb-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-button bg-gold font-semibold text-ink ring-1 ring-ink">
          {scanIcon}
          {scan.kind === "busy" ? "Reading…" : "Scan a receipt"}
          {scanInput}
        </label>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {SIDEBAR.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-button px-3 font-medium ${
                  active ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openChat}
            className="flex min-h-11 items-center gap-3 rounded-button px-3 text-left font-medium text-ink hover:bg-ink/5"
          >
            {askIcon}
            Ask Cotab
          </button>
        </nav>
        <Link
          href={SETTINGS.href}
          aria-current={SETTINGS.match(pathname) ? "page" : undefined}
          className={`mt-auto flex min-h-11 items-center gap-3 rounded-button px-3 font-medium ${
            SETTINGS.match(pathname) ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"
          }`}
        >
          {SETTINGS.icon}
          Settings
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-11 rounded-button px-3 text-left text-sm font-medium text-muted hover:text-ink"
        >
          Sign out
        </button>
      </aside>

      <div className="min-w-0 flex-1 pb-24 md:pb-0">{children}</div>

      {scan.kind !== "idle" && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-card bg-ink px-4 py-3 text-sm text-paper md:bottom-6"
        >
          <span
            aria-hidden="true"
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
              scan.kind === "error" ? "bg-rose text-paper" : "bg-gold text-ink"
            }`}
          >
            {scan.kind === "busy" ? "…" : scan.kind === "error" ? "!" : "✓"}
          </span>
          {scan.kind === "busy" ? "Reading your receipt…" : scan.text}
        </div>
      )}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex h-20 items-start border-t border-line bg-paper px-2 pt-1.5 md:hidden"
      >
        <TabLink item={HOME} active={HOME.match(pathname)} />
        <TabLink item={TAB} active={TAB.match(pathname)} />
        <label
          className="flex flex-1 cursor-pointer flex-col items-center"
          aria-label="Scan a receipt"
        >
          <span className="-mt-6 grid h-14 w-14 place-items-center rounded-full border-[3px] border-paper bg-gold text-ink ring-1 ring-ink">
            {scanIcon}
          </span>
          {scanInput}
        </label>
        <TabLink item={HOUSE} active={HOUSE.match(pathname)} />
        <button
          type="button"
          onClick={openChat}
          className="flex min-h-[52px] flex-1 flex-col items-center gap-1 py-2 text-[11px] font-semibold text-muted"
        >
          {askIcon}
          Ask
        </button>
      </nav>
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[52px] flex-1 flex-col items-center gap-1 py-2 text-[11px] font-semibold ${
        active ? "text-ink" : "text-muted"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}
