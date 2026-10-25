"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { CatAvatar } from "@/components/Tabby";
import { Icon } from "@/components/ui";
import { AddExpenseSheet, OPEN_EXPENSE_EVENT } from "@/components/AddExpenseSheet";
import { ScanSheet, useScanItems, useScanPickers } from "@/components/ScanSheet";
import { isAuthed, logout, UNAUTHED_EVENT, VERIFY_EVENT } from "@/lib/api";
import { invalidateSpending, prefetchTabs, useMe } from "@/lib/data";
import { registerWorker } from "@/lib/push";
import { routes, withNext } from "@/lib/routes";
import { userTabby } from "@/lib/tabby";
import {
  addFiles,
  clearFinished,
  isFinished,
  MAX_BATCH,
  OPEN_SCANNER_EVENT,
} from "@/lib/scanQueue";
import { UPLOADED_EVENT } from "@/lib/upload";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  match: (path: string) => boolean;
};

const HOME: NavItem = {
  href: routes.home,
  label: "Home",
  icon: "home",
  match: (p) => p === routes.home,
};
const INSIGHTS: NavItem = {
  href: routes.insights,
  label: "Insights",
  icon: "bar_chart",
  match: (p) =>
    p.startsWith(routes.insights) ||
    p === routes.tab ||
    p.startsWith(`${routes.tab}/`) ||
    p.startsWith(routes.budgets) ||
    p.startsWith("/app/receipts"),
};
const SPLITS: NavItem = {
  href: routes.groups,
  label: "Splits",
  icon: "group",
  match: (p) => p.startsWith(routes.groups),
};

/** The sidebar has room to list every place; the phone bar keeps five. */
const SIDEBAR: NavItem[] = [
  HOME,
  { ...INSIGHTS, match: (p) => p.startsWith(routes.insights) },
  {
    href: routes.tab,
    label: "Receipts",
    icon: "receipt_long",
    match: (p) => p === routes.tab || p.startsWith("/app/receipts"),
  },
  {
    href: routes.budgets,
    label: "Budgets",
    icon: "donut_large",
    match: (p) => p.startsWith(routes.budgets),
  },
  SPLITS,
  {
    href: routes.tabby,
    label: "What Tabby did",
    icon: "history",
    match: (p) => p.startsWith(routes.tabby),
  },
];

function openChat() {
  window.dispatchEvent(new CustomEvent("rw:chat", { detail: "" }));
}

type Note = { tone: "done" | "error"; text: string } | null;

/**
 * Frame for every signed-in page: a floating tab bar with Scan in the middle
 * on phones, a sidebar on wider screens. It is also the one place
 * that sends signed-out visitors to the sign-in page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Add expense by hand; `tabId` when opened from a tab, to split it there.
  const [expense, setExpense] = useState<{ tabId?: string } | null>(null);
  const [note, setNote] = useState<Note>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const items = useScanItems();

  const flash = useCallback((next: NonNullable<Note>) => {
    clearTimeout(timer.current);
    setNote(next);
    timer.current = setTimeout(() => setNote(null), 4000);
  }, []);

  const onPicked = useCallback(
    (files: File[]) => {
      const { added, tooMany, unsupported } = addFiles(files);
      setScanOpen(true);
      if (tooMany)
        flash({
          tone: "error",
          text: `Up to ${MAX_BATCH} at a time. ${tooMany} left out; add them next.`,
        });
      else if (unsupported && !added)
        flash({ tone: "error", text: "Cotab can read photos and PDFs. Try another file." });
    },
    [flash]
  );
  const pickers = useScanPickers(onPicked);

  // When a scan run ends cleanly (every item added, nothing to decide), close
  // the sheet and just say so. Anything refused or doubtful stays open.
  // The worker that shows notifications and opens the tab they point to.
  useEffect(() => {
    registerWorker();
  }, []);

  useEffect(() => {
    if (!items.length || !items.every((i) => isFinished(i.status))) return;
    const clean = items.every(
      (i) => i.status === "added" && !i.possibleDuplicateOf && i.result?.status !== "failed"
    );
    if (!clean) return;
    flash({
      tone: "done",
      text:
        items.length === 1
          ? `${items[0].result?.merchant || "Receipt"} is on your tab.`
          : `${items.length} receipts are on your tab.`,
    });
    setScanOpen(false);
    clearFinished();
  }, [items, flash]);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    setReady(true);
  }, [router]);

  // The signed-in user is loaded once here and shared through the cache, so
  // pages don't each ask "who is this?" before loading their own data.
  const { data: user } = useMe();
  useEffect(() => {
    if (!user) return;
    // Confirming the email comes before everything else, then the mobile
    // number, then onboarding.
    if (user.email_verified === false) router.replace(withNext(routes.verify, pathname));
    else if (user.phone === null) router.replace(withNext(routes.phone, pathname));
    else if (!user.intent) router.replace(routes.welcome);
  }, [user, router, pathname]);

  // The server can also say so mid-session (e.g. a stale tab).
  useEffect(() => {
    const onVerify = () => router.replace(withNext(routes.verify, window.location.pathname));
    window.addEventListener(VERIFY_EVENT, onVerify);
    return () => window.removeEventListener(VERIFY_EVENT, onVerify);
  }, [router]);

  // A session can expire on any page; send people to sign in from wherever.
  useEffect(() => {
    const onUnauthed = () => router.replace(`${routes.login}?expired=1`);
    window.addEventListener(UNAUTHED_EVENT, onUnauthed);
    return () => window.removeEventListener(UNAUTHED_EVENT, onUnauthed);
  }, [router]);

  useEffect(() => {
    const open = (e: Event) => {
      setScanOpen(false);
      setExpense({ tabId: (e as CustomEvent<{ tabId?: string }>).detail?.tabId });
    };
    window.addEventListener(OPEN_EXPENSE_EVENT, open);
    return () => window.removeEventListener(OPEN_EXPENSE_EVENT, open);
  }, []);
  const closeExpense = useCallback(() => setExpense(null), []);

  // Pages can ask for the scanner (e.g. "Scan the receipt" on a tap).
  useEffect(() => {
    const open = () => setScanOpen(true);
    window.addEventListener(OPEN_SCANNER_EVENT, open);
    return () => window.removeEventListener(OPEN_SCANNER_EVENT, open);
  }, []);

  // A new scan changes totals, lists and budgets everywhere.
  useEffect(() => {
    window.addEventListener(UPLOADED_EVENT, invalidateSpending);
    return () => window.removeEventListener(UPLOADED_EVENT, invalidateSpending);
  }, []);

  // Once the first page has drawn, warm the other tabs in the background.
  useEffect(() => {
    if (!ready) return;
    const idle =
      (window as Window & { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
    idle(prefetchTabs);
  }, [ready]);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onSignOut() {
    try {
      await logout();
    } finally {
      router.push(routes.login);
    }
  }

  if (!ready) return null;

  const working = items.filter((i) => ["checking", "waiting", "reading"].includes(i.status)).length;
  const waiting =
    items.filter((i) => !isFinished(i.status) && i.status === "needs_ok").length +
    items.filter((i) => ["refused", "duplicate", "error"].includes(i.status)).length;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-2 px-5 py-7 md:flex">
        <Link href={routes.home} aria-label="Cotab home" className="mb-7 px-2">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="press mb-5 flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-forest font-bold text-paper shadow-[0_14px_24px_-14px_rgb(15_61_49/0.9)]"
        >
          <Icon name="document_scanner" size={22} className="text-gold" />
          Scan receipts
        </button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {SIDEBAR.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-full px-4 text-[15px] ${
                  active
                    ? "bg-card font-extrabold text-ink shadow-[0_0_0_1px_rgb(12_17_14/0.05)]"
                    : "font-semibold text-muted hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <Icon name={item.icon} fill={active} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openChat}
            className="flex min-h-11 items-center gap-3 rounded-full px-4 text-left text-[15px] font-semibold text-muted hover:bg-ink/[0.04] hover:text-ink"
          >
            <CatAvatar choice={{ look: "hoodie", mood: "hmm", bg: "mood" }} size={24} />
            Ask Tabby
          </button>
        </nav>
        <Link
          href={routes.settings}
          aria-current={pathname.startsWith(routes.settings) ? "page" : undefined}
          className={`mt-auto flex items-center gap-3 rounded-card p-2.5 ${
            pathname.startsWith(routes.settings) ? "bg-card" : "hover:bg-ink/[0.04]"
          }`}
        >
          <CatAvatar choice={userTabby(user)} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-extrabold">
              {user?.full_name?.split(" ")[0] || "You"}
            </span>
            <span className="block text-xs font-semibold text-faint">Profile and settings</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-10 rounded-full px-4 text-left text-sm font-semibold text-faint hover:text-ink"
        >
          Sign out
        </button>
      </aside>

      <div className="min-w-0 flex-1 pb-32 md:pb-0">{children}</div>

      {pickers.inputs}
      <ScanSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        pick={pickers.open}
        onPicked={onPicked}
      />
      <AddExpenseSheet open={!!expense} tabId={expense?.tabId} onClose={closeExpense} />

      {!scanOpen && working > 0 && (
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="rise fixed inset-x-4 bottom-28 z-40 mx-auto flex max-w-md items-center gap-3 rounded-tile bg-forest px-4 py-3 text-left text-sm font-semibold text-paper shadow-[0_18px_30px_-16px_rgb(15_61_49/0.8)] md:bottom-6"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-gold"
          />
          <span className="flex-1">
            Reading {working} receipt{working === 1 ? "" : "s"}…
          </span>
          <span className="font-semibold underline underline-offset-4">Show</span>
        </button>
      )}
      {!scanOpen && working === 0 && waiting > 0 && (
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="rise fixed inset-x-4 bottom-28 z-40 mx-auto flex max-w-md items-center gap-3 rounded-tile bg-gold px-4 py-3 text-left text-sm text-ink shadow-[0_18px_30px_-16px_rgb(12_17_14/0.4)] md:bottom-6"
        >
          <span className="flex-1 font-semibold">
            {waiting} scan{waiting === 1 ? " needs" : "s need"} a look
          </span>
          <span className="underline underline-offset-4">Show</span>
        </button>
      )}
      {note && !(working > 0 && !scanOpen) && (
        <div
          role="status"
          className="rise fixed inset-x-4 bottom-28 z-[55] mx-auto flex max-w-md items-center gap-3 rounded-tile bg-forest px-4 py-3 text-sm font-semibold text-paper shadow-[0_18px_30px_-16px_rgb(15_61_49/0.8)] md:bottom-6"
        >
          <span
            aria-hidden="true"
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
              note.tone === "error" ? "bg-rose text-paper" : "bg-gold text-ink"
            }`}
          >
            {note.tone === "error" ? "!" : "✓"}
          </span>
          {note.text}
        </div>
      )}

      <nav
        aria-label="Main"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[118px] bg-gradient-to-t from-paper from-50% to-paper/0 md:hidden"
      >
        <div className="pointer-events-auto absolute inset-x-3.5 bottom-[max(14px,env(safe-area-inset-bottom))] grid h-[66px] grid-cols-[1fr_1fr_86px_1fr_1fr] items-center rounded-[24px] bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.04),0_16px_32px_-14px_rgb(12_17_14/0.22)]">
          <TabLink item={HOME} active={HOME.match(pathname)} />
          <TabLink item={INSIGHTS} active={INSIGHTS.match(pathname)} />
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            aria-label="Scan a receipt"
            className="press scan-pulse relative -mt-11 grid h-[66px] w-[66px] place-items-center justify-self-center rounded-full border-[5px] border-paper bg-[radial-gradient(circle_at_35%_30%,#1E5A48,#0F3D31_70%)] [box-sizing:content-box]"
          >
            <Icon name="document_scanner" size={30} className="relative text-gold" />
          </button>
          <TabLink item={SPLITS} active={SPLITS.match(pathname)} />
          <button
            type="button"
            onClick={openChat}
            className="flex min-h-[52px] flex-col items-center justify-center gap-[3px] text-[11px] font-semibold text-faint"
          >
            <CatAvatar
              choice={{ look: "hoodie", mood: "hmm", bg: "mood" }}
              size={27}
              ring="#C9CFCB"
            />
            Tabby
          </button>
        </div>
      </nav>
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[52px] flex-col items-center justify-center gap-[3px] text-[11px] ${
        active ? "font-extrabold text-ink" : "font-semibold text-faint"
      }`}
    >
      <Icon name={item.icon} size={25} fill={active} />
      {item.label}
    </Link>
  );
}
