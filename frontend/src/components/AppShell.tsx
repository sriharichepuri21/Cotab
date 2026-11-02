"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AppSplash, useLaunchSplash } from "@/components/AppSplash";
import { isAuthed, UNAUTHED_EVENT, VERIFY_EVENT } from "@/lib/api";
import { invalidateSpending, prefetchTabs, useMe } from "@/lib/data";
import { registerWorker } from "@/lib/push";
import { routes, withNext } from "@/lib/routes";
import { UPLOADED_EVENT } from "@/lib/upload";

/**
 * The gate to the signed-in app, which draws its own navigation (NewApp). It is
 * the one place that sends signed-out visitors to the sign-in page, and that
 * walks new accounts through email, mobile number and onboarding first.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const splashHeld = useLaunchSplash();

  // The worker that shows notifications and opens the tab they point to.
  useEffect(() => {
    registerWorker();
  }, []);

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
    // The screen lives in the query (?panel=budgets), so keep it for the way back.
    const here = pathname + window.location.search;
    if (user.email_verified === false) router.replace(withNext(routes.verify, here));
    else if (user.phone === null) router.replace(withNext(routes.phone, here));
    else if (!user.intent) router.replace(routes.welcome);
  }, [user, router, pathname]);

  // The server can also say so mid-session (e.g. a stale tab).
  useEffect(() => {
    const onVerify = () =>
      router.replace(withNext(routes.verify, window.location.pathname + window.location.search));
    window.addEventListener(VERIFY_EVENT, onVerify);
    return () => window.removeEventListener(VERIFY_EVENT, onVerify);
  }, [router]);

  // A session can expire on any page; send people to sign in from wherever.
  useEffect(() => {
    const onUnauthed = () => router.replace(`${routes.login}?expired=1`);
    window.addEventListener(UNAUTHED_EVENT, onUnauthed);
    return () => window.removeEventListener(UNAUTHED_EVENT, onUnauthed);
  }, [router]);

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

  if (!ready || splashHeld) return <AppSplash />;
  return <>{children}</>;
}
