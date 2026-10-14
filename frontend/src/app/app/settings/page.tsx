"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApplePaySetup } from "@/components/ApplePaySetup";
import { ForwardingSetup } from "@/components/ForwardingSetup";
import { Button, buttonClass, ErrorNote, PageHeader, Section } from "@/components/ui";
import { ApiError, deleteAccount, logout, requestExport, type ExportResult } from "@/lib/api";
import { useMe } from "@/lib/data";
import { routes } from "@/lib/routes";

const intentLabel: Record<string, string> = {
  personal: "Just me",
  splits: "Me and the people I live with",
  business: "Work expenses",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-line/70 py-3">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

export default function Settings() {
  const router = useRouter();
  const { data: user, error: userError } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onExport() {
    setExporting(true);
    setExported(null);
    try {
      setExported(await requestExport());
    } catch (e) {
      setExported({ id: "", status: "failed" });
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function onDelete(e: FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(password);
      router.replace(routes.login);
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.status === 403
          ? "That password doesn't match. Nothing was deleted."
          : (err as Error).message
      );
      setDeleting(false);
    }
  }

  async function onSignOut() {
    try {
      await logout();
    } finally {
      router.push(routes.login);
    }
  }

  const initial = (user?.full_name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader title="Settings" back={{ href: routes.home, label: "Home" }} />

      {(error || userError) && <ErrorNote>{error ?? userError?.message}</ErrorNote>}

      <div className="mb-8 flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink font-display text-xl text-gold">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{user?.full_name || "Your account"}</p>
          <p className="truncate text-sm text-muted">{user?.email}</p>
        </div>
      </div>

      <Section title="Your account">
        <div className="border-t border-ink">
          <Row label="Using Cotab for" value={user?.intent ? intentLabel[user.intent] : "—"} />
          <Row label="Time zone" value={user?.timezone || "—"} />
          <Row
            label="Budgets"
            value={
              <Link href={routes.budgets} className="underline underline-offset-4">
                Manage budgets
              </Link>
            }
          />
        </div>
      </Section>

      <Section title="Apple Pay taps">
        <ApplePaySetup />
      </Section>

      <ForwardingSetup />

      <Section title="Your data">
        <p className="mb-4 text-muted">
          Download a copy of every purchase on your tab as a JSON file. Links last 7 days.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={onExport} disabled={exporting}>
            {exporting ? "Preparing your copy…" : "Download my data"}
          </Button>
          {exported?.status === "ready" && exported.download_url && (
            <a
              href={exported.download_url}
              className={buttonClass.primary}
              target="_blank"
              rel="noreferrer"
            >
              Save the file
            </a>
          )}
        </div>
        {exported && exported.status !== "ready" && (
          <p role="status" className="mt-3 text-sm text-rose">
            We couldn&apos;t build the file just now. Try again in a minute.
          </p>
        )}
      </Section>

      <Section title="Leave">
        <div className="flex flex-col gap-3">
          <Button variant="ghost" onClick={onSignOut} className="w-full sm:w-fit">
            Sign out
          </Button>

          {!confirming ? (
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              className="w-full sm:w-fit"
            >
              Delete my account
            </Button>
          ) : (
            <form
              onSubmit={onDelete}
              className="rise rounded-card border border-rose bg-blush/40 p-5"
            >
              <p className="font-semibold">Delete your account for good?</p>
              <p className="mt-1 text-sm">
                Every receipt, budget and split goes with it. This can&apos;t be undone.
              </p>
              <label className="mt-4 block text-sm font-semibold" htmlFor="delete-password">
                Type your password to confirm
              </label>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-button border border-ink bg-card px-3"
                required
              />
              {deleteError && (
                <p role="alert" className="mt-2 text-sm text-rose">
                  {deleteError}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={deleting || !password}
                  className={`${buttonClass.primary} !bg-rose`}
                >
                  {deleting ? "Deleting…" : "Delete everything"}
                </button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setConfirming(false);
                    setPassword("");
                    setDeleteError(null);
                  }}
                >
                  Keep my account
                </Button>
              </div>
            </form>
          )}
        </div>
      </Section>
    </main>
  );
}
