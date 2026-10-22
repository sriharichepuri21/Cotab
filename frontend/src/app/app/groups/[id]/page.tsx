"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PayHandlesForm } from "@/components/PayHandlesForm";
import { PayLinks } from "@/components/PayLinks";
import { TicketRail, type Ticket } from "@/components/TicketRail";
import {
  Button,
  ErrorNote,
  Field,
  fieldClass,
  PageHeader,
  PageSkeleton,
  Section,
} from "@/components/ui";
import {
  addGroupMember,
  recordSettlement,
  setMemberPayHandles,
  undoSettlement,
  type SplitSummary,
} from "@/lib/api";
import { mutate } from "@/lib/cache";
import { invalidateSplits, keys, useGroup } from "@/lib/data";
import { amount, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

/** Where each member stands once the suggested settlements are paid. */
function memberTickets(summary: SplitSummary): Ticket[] {
  const net = new Map<string, number>(summary.members.map((m) => [m.name, 0]));
  for (const s of summary.suggested_settlements) {
    net.set(s.from, (net.get(s.from) ?? 0) - s.amount);
    net.set(s.to, (net.get(s.to) ?? 0) + s.amount);
  }
  return Array.from(net.entries()).map(([name, n]) => {
    if (Math.abs(n) < 0.005)
      return { key: name, name, label: "even", amount: "0.00", tone: "mint" };
    return n < 0
      ? { key: name, name, label: "owes", amount: amount(-n), tone: "blush" }
      : { key: name, name, label: "is owed", amount: amount(n) };
  });
}

const modeLabel: Record<string, string> = { even: "split evenly", itemized: "split by item" };
const methodLabel: Record<string, string> = {
  venmo: "Venmo",
  paypal: "PayPal",
  cashapp: "Cash App",
  zelle: "Zelle",
  cash: "cash",
  other: "marked paid",
};

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const groupQ = useGroup(id);
  const summary = groupQ.data;
  const error = groupQ.error?.message ?? "";
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [lastMethod, setLastMethod] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  if (!summary) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        {error ? (
          <>
            <PageHeader title="Group" back={{ href: routes.groups, label: "House" }} />
            <ErrorNote>{error}</ErrorNote>
          </>
        ) : (
          <PageSkeleton rows={4} />
        )}
      </main>
    );
  }

  const shareUrl = `${window.location.origin}${routes.share(summary.share_code)}`;
  const names = summary.members.map((m) => m.name);
  const me = summary.me ?? null;

  async function run(label: string, action: () => Promise<SplitSummary | void>) {
    setBusy(label);
    setActionError("");
    try {
      const next = await action();
      if (next) mutate(keys.group(id), next);
      invalidateSplits();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function settle(i: number) {
    const row = summary!.suggested_settlements[i];
    if (!row.from_id || !row.to_id) return;
    run(`settle-${i}`, () =>
      recordSettlement(id, {
        from_member_id: row.from_id!,
        to_member_id: row.to_id!,
        amount: row.amount,
        method: lastMethod[i] ?? "other",
      })
    );
  }

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    await run("add", async () => {
      await addGroupMember(id, { name: newName.trim() });
      setNewName("");
      await groupQ.refresh();
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title={summary.group_name}
        sub={`${names.join(", ")}. ${money(summary.total_spend, summary.currency)} shared so far.`}
        back={{ href: routes.groups, label: "House" }}
      />
      {summary.is_owner === false && (
        <p className="-mt-3 mb-6 text-sm font-semibold text-muted">
          A shared tab you joined. Add your own receipts to it from any receipt&apos;s Split this.
        </p>
      )}

      <div className="mb-8">
        <TicketRail tickets={memberTickets(summary)} />
      </div>

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      <Section title="To settle up">
        {summary.suggested_settlements.length ? (
          <ul className="flex flex-col gap-3">
            {summary.suggested_settlements.map((row, i) => {
              const youPay = me && row.from_id === me;
              const youGet = me && row.to_id === me;
              const links = row.pay_links ?? [];
              return (
                <li
                  key={`${row.from_id}-${row.to_id}`}
                  className="rounded-card bg-gold/60 px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <strong>{youPay ? "You" : row.from}</strong> {youPay ? "pay" : "pays"}{" "}
                      <strong>{youGet ? "you" : row.to}</strong>
                    </span>
                    <strong className="font-mono">{amount(row.amount)}</strong>
                  </div>
                  {youPay && links.length > 0 && (
                    <div className="mt-3">
                      <PayLinks
                        links={links}
                        onOpened={(method) => setLastMethod({ ...lastMethod, [i]: method })}
                      />
                    </div>
                  )}
                  {youPay && links.length === 0 && (
                    <p className="mt-2 text-sm">
                      {row.to} hasn&apos;t added Venmo, PayPal, Cash App or Zelle yet.
                    </p>
                  )}
                  {!youPay && !youGet && links.length > 0 && (
                    <p className="mt-2 text-sm">
                      {row.to} takes {links.map((l) => l.label).join(", ")}. Send {row.from} this
                      tab&apos;s link to pay in one tap.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="!min-h-10 bg-card"
                      disabled={busy === `settle-${i}`}
                      onClick={() => settle(i)}
                    >
                      {busy === `settle-${i}`
                        ? "Saving…"
                        : youPay
                          ? `I've paid ${row.to}`
                          : youGet
                            ? `${row.from} paid me`
                            : "Mark as paid"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-card bg-gold px-4 py-4 font-semibold">Everyone is even.</p>
        )}
        <p className="mt-3 text-sm text-muted">
          Cotab works out the fewest payments that settle everyone. Paying in an app doesn&apos;t
          tell Cotab, so mark it paid here once it&apos;s sent.
        </p>
      </Section>

      {(summary.settlements?.length ?? 0) > 0 && (
        <Section title="Payments">
          <ul className="border-t border-ink">
            {summary.settlements!.map((payment) => (
              <li
                key={payment.id}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-line/70 py-3"
              >
                <span className="min-w-0">
                  <span className="block">
                    <strong>{payment.from}</strong> paid <strong>{payment.to}</strong>{" "}
                    <span className="font-mono">{amount(payment.amount)}</span>
                  </span>
                  <span className="block text-sm text-muted">
                    {methodLabel[payment.method] ?? payment.method}
                    {payment.created_at ? `, ${dayLabel(payment.created_at)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy === payment.id}
                  onClick={() => run(payment.id, () => undoSettlement(id, payment.id))}
                  className="min-h-11 shrink-0 px-2 text-sm font-semibold underline underline-offset-4"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="People on this tab">
        <ul className="border-t border-ink">
          {summary.members.map((member) => (
            <li key={member.id} className="border-b border-line/70 py-3">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {member.name}
                    {member.id === me ? " (you)" : ""}
                  </span>
                  <span className="block text-sm text-muted">
                    {member.joined ? "On Cotab" : "Not on Cotab yet"}
                    {member.pay_methods?.length
                      ? `. Takes ${member.pay_methods.map((m) => methodLabel[m]).join(", ")}`
                      : ""}
                  </span>
                </span>
                {member.own_handles && (
                  <button
                    type="button"
                    onClick={() => setEditing(editing === member.id ? null : member.id)}
                    className="min-h-11 shrink-0 px-2 text-sm font-semibold underline underline-offset-4"
                    aria-expanded={editing === member.id}
                  >
                    {editing === member.id ? "Close" : "Payment details"}
                  </button>
                )}
              </div>
              {editing === member.id && (
                <div className="mt-3 rounded-card bg-ink/[0.03] p-4">
                  <p className="mb-3 text-sm text-muted">
                    How {member.name} gets paid. Once they join with their own account, they manage
                    this themselves.
                  </p>
                  <PayHandlesForm
                    initial={member.handles}
                    idPrefix={`m-${member.id}`}
                    onSave={async (handles) => {
                      const saved = await setMemberPayHandles(id, member.id, handles);
                      await groupQ.refresh();
                      return saved;
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addPerson} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:flex-1">
            <Field label="Add someone">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={fieldClass}
                placeholder="Name"
                aria-label="Name of person to add"
              />
            </Field>
          </div>
          <Button type="submit" variant="ghost" disabled={busy === "add" || !newName.trim()}>
            Add
          </Button>
        </form>
      </Section>

      <Section title="Invite to this tab">
        <p className="mb-3 text-muted">
          Anyone with the link sees the balances and can pay in one tap. Friends with a Cotab
          account can join and add their own receipts.
        </p>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
        <p className="mt-2 break-all font-mono text-xs text-muted">{shareUrl}</p>
      </Section>

      <Section title="Shared purchases">
        <ul className="border-t border-ink">
          {summary.splits.map((split) => (
            <li key={split.split_id} className="border-b border-line/70 py-3">
              <Link
                href={routes.receipt(split.receipt_id)}
                className="flex items-start justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{split.merchant}</span>
                  <span className="block text-sm text-muted">
                    {dayLabel(split.purchased_at)}, {split.paid_by} paid,{" "}
                    {modeLabel[split.mode] ?? split.mode}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{amount(split.total)}</span>
              </Link>
              <div className="mt-2 flex flex-wrap gap-2">
                {split.shares.map((share) => (
                  <span
                    key={share.member}
                    className={`rounded-full px-3 py-1 font-mono text-xs ${
                      share.settled ? "bg-mint" : "bg-ink/[0.06]"
                    }`}
                  >
                    {share.member} {amount(share.amount)}
                    {share.settled ? ", paid" : ""}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {summary.splits.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            Nothing on this tab yet. Open a receipt on your{" "}
            <Link href={routes.tab} className="underline underline-offset-4">
              tab
            </Link>{" "}
            and tap Split this.
          </p>
        )}
      </Section>
    </main>
  );
}
