"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { MemberInvite, memberStatusLabel } from "@/components/MemberInvite";
import { NotificationsCard } from "@/components/NotificationsCard";
import { PersonPicker } from "@/components/PersonPicker";
import { PayHandlesForm } from "@/components/PayHandlesForm";
import { RemindSheet, remindedLabel, reminderText } from "@/components/RemindSheet";
import { PayLinks } from "@/components/PayLinks";
import { CatAvatar, Confetti, Duo } from "@/components/Tabby";
import { type Ticket } from "@/components/TicketRail";
import { Button, ErrorNote, Icon, PageHeader, PageSkeleton } from "@/components/ui";
import {
  addGroupMember,
  renameMember,
  recordSettlement,
  removeSplit,
  setMemberPayHandles,
  undoSettlement,
  type SplitSummary,
} from "@/lib/api";
import { mutate } from "@/lib/cache";
import { invalidateSplits, keys, useGroup, useMe } from "@/lib/data";
import { amount, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";
import { friendTabby, userTabby } from "@/lib/tabby";

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

const modeLabel: Record<string, string> = {
  even: "split evenly",
  itemized: "split by item",
  exact: "split by exact amounts",
  percent: "split by percentage",
  shares: "split by shares",
};
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
  const [editing, setEditing] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [reminding, setReminding] = useState<number | null>(null);
  const [remindNote, setRemindNote] = useState("");
  const { data: user } = useMe();

  if (!summary) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        {error ? (
          <>
            <PageHeader title="Group" back={{ href: routes.groups, label: "Splits" }} />
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
    run(`settle-${i}`, async () => {
      const next = await recordSettlement(id, {
        from_member_id: row.from_id!,
        to_member_id: row.to_id!,
        amount: row.amount,
        method: lastMethod[i] ?? "other",
      });
      setCelebrate(`${row.from} paid ${row.to} ${money(row.amount, summary!.currency)}.`);
      return next;
    });
  }

  const tickets = memberTickets(summary);
  const tabbyFor = (name: string) => {
    const member = summary.members.find((m) => m.name === name);
    if (member && member.id === me && user) return userTabby(user);
    return member?.avatar ?? friendTabby(name);
  };
  const card = "rounded-card bg-card p-5";
  const h2 = "text-lg font-extrabold tracking-[-0.02em]";

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-6 md:px-8 md:pt-10">
      {celebrate && (
        <div
          role="status"
          className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-6 backdrop-blur-[2px]"
          onClick={() => setCelebrate(null)}
        >
          <div className="rise relative w-full max-w-sm overflow-hidden rounded-[28px] bg-card px-6 pb-6 pt-4 text-center">
            <Confetti />
            <Duo scene="settle-up" width={240} alt="Two cats shaking hands" className="mx-auto" />
            <p className="mt-2 text-[22px] font-extrabold tracking-[-0.03em]">Settled up!</p>
            <p className="mt-1 text-sm text-muted">{celebrate}</p>
            <Button className="mt-5 w-full" onClick={() => setCelebrate(null)}>
              Nice
            </Button>
          </div>
        </div>
      )}

      <PageHeader
        title={summary.group_name}
        sub={`${names.join(", ")}. ${money(summary.total_spend, summary.currency)} shared so far.`}
        back={{ href: routes.groups, label: "Splits" }}
      />
      {summary.is_owner === false && (
        <p className="-mt-3 mb-5 inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-[13px] font-bold text-good">
          <Icon name="group" size={17} />A shared tab you joined
        </p>
      )}

      <div className="-mx-5 mb-6 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        {tickets.map((t) => (
          <div key={t.key} className="w-[104px] flex-none rounded-card bg-card p-3 text-center">
            <CatAvatar choice={tabbyFor(t.name)} size={52} soft className="mx-auto" />
            <p className="mt-2 truncate text-sm font-bold">{t.name}</p>
            <p
              className={`text-[13px] font-extrabold ${
                t.tone === "blush" ? "text-rose" : t.tone === "mint" ? "text-faint" : "text-good"
              }`}
            >
              {t.tone === "mint" ? "Even" : `${t.tone === "blush" ? "owes" : "gets"} ${t.amount}`}
            </p>
          </div>
        ))}
      </div>

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      <section className={card}>
        <h2 className={h2}>To settle up</h2>
        {summary.suggested_settlements.length ? (
          <ul className="mt-3 flex flex-col gap-3">
            {summary.suggested_settlements.map((row, i) => {
              const youPay = me && row.from_id === me;
              const youGet = me && row.to_id === me;
              const links = row.pay_links ?? [];
              return (
                <li key={`${row.from_id}-${row.to_id}`} className="rounded-[20px] bg-paper p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center">
                      <CatAvatar choice={tabbyFor(row.from)} size={40} ring="#F3F4F1" />
                      <Icon name="arrow_forward" size={18} className="mx-1 text-faint" />
                      <CatAvatar choice={tabbyFor(row.to)} size={40} ring="#F3F4F1" />
                    </span>
                    <span className="min-w-0 flex-1 text-[15px]">
                      <strong className="font-extrabold">{youPay ? "You" : row.from}</strong>{" "}
                      {youPay ? "pay" : "pays"}{" "}
                      <strong className="font-extrabold">{youGet ? "you" : row.to}</strong>
                    </span>
                    <strong className="text-[17px] font-extrabold">
                      {money(row.amount, summary.currency)}
                    </strong>
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
                    <p className="mt-2 text-sm text-muted">
                      {row.to} hasn&apos;t added Venmo, PayPal, Cash App or Zelle yet.
                    </p>
                  )}
                  {!youPay && !youGet && links.length > 0 && (
                    <p className="mt-2 text-sm text-muted">
                      {row.to} takes {links.map((l) => l.label).join(", ")}. Send {row.from} this
                      tab&apos;s link to pay in one tap.
                    </p>
                  )}
                  {youGet && (
                    <div className="mt-3 flex items-center gap-3">
                      <Button
                        variant="ghost"
                        className="!min-h-11 flex-1"
                        onClick={() => {
                          setRemindNote("");
                          setReminding(i);
                        }}
                      >
                        <Icon name="notifications" size={20} />
                        Remind {row.from}
                      </Button>
                      {remindedLabel(row.last_reminded_at) && (
                        <span className="shrink-0 text-[13px] font-semibold text-faint">
                          {remindedLabel(row.last_reminded_at)}
                        </span>
                      )}
                    </div>
                  )}
                  <Button
                    variant={youPay || youGet ? "primary" : "ghost"}
                    className="mt-3 !min-h-11 w-full"
                    disabled={busy === `settle-${i}`}
                    onClick={() => settle(i)}
                  >
                    <Icon name="check" size={20} />
                    {busy === `settle-${i}`
                      ? "Saving…"
                      : youPay
                        ? `I've paid ${row.to}`
                        : youGet
                          ? `${row.from} paid me`
                          : "Mark as paid"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-3 flex items-center gap-3 rounded-[20px] bg-mint p-3">
            <Duo scene="debt-cleared" width={96} />
            <p className="font-extrabold text-good">Everyone is even.</p>
          </div>
        )}
        {remindNote && (
          <p role="status" className="mt-3 text-sm font-semibold text-good">
            {remindNote}
          </p>
        )}
        {summary.suggested_settlements.some((r) => me && r.from_id === me) && (
          <div className="mt-3">
            <NotificationsCard compact />
          </div>
        )}
        <p className="mt-3 text-[13px] text-faint">
          Tabby works out the fewest payments that settle everyone. Paying in an app doesn&apos;t
          tell Cotab, so mark it paid here once it&apos;s sent.
        </p>
      </section>

      {(summary.settlements?.length ?? 0) > 0 && (
        <section className={`${card} mt-4`}>
          <h2 className={h2}>Payments</h2>
          <ul className="mt-1">
            {summary.settlements!.map((payment, i) => (
              <li
                key={payment.id}
                className={`flex items-center gap-3 py-3 ${i ? "border-t border-line" : ""}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-mint text-good">
                  <Icon name="check_circle" fill size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]">
                    <strong className="font-bold">{payment.from}</strong> paid{" "}
                    <strong className="font-bold">{payment.to}</strong>{" "}
                    <span className="font-extrabold">
                      {money(payment.amount, summary.currency)}
                    </span>
                  </span>
                  <span className="block text-[13px] text-faint">
                    {methodLabel[payment.method] ?? payment.method}
                    {payment.created_at ? `, ${dayLabel(payment.created_at)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy === payment.id}
                  onClick={() => run(payment.id, () => undoSettlement(id, payment.id))}
                  className="min-h-10 shrink-0 rounded-full px-3 text-sm font-bold text-forest underline underline-offset-4"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} mt-4`}>
        <h2 className={h2}>People on this tab</h2>
        <ul className="mt-1">
          {summary.members.map((member, i) => (
            <li key={member.id} className={`py-3 ${i ? "border-t border-line" : ""}`}>
              <div className="flex items-center gap-3">
                <CatAvatar choice={tabbyFor(member.name)} size={44} soft />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">
                    {member.name}
                    {member.id === me ? " (you)" : ""}
                  </span>
                  <span className="block text-[13px] text-faint">
                    {memberStatusLabel(member, Boolean(summary.is_owner))}
                    {member.pay_methods?.length
                      ? `. Takes ${member.pay_methods.map((m) => methodLabel[m]).join(", ")}`
                      : ""}
                  </span>
                </span>
                {member.own_handles && (
                  <button
                    type="button"
                    onClick={() => setEditing(editing === member.id ? null : member.id)}
                    className="min-h-10 shrink-0 rounded-full bg-paper px-3 text-[13px] font-bold"
                    aria-expanded={editing === member.id}
                  >
                    {editing === member.id ? "Close" : "Payment details"}
                  </button>
                )}
              </div>
              {summary.is_owner && member.id !== me && (
                <MemberInvite
                  member={member}
                  groupId={id}
                  shareCode={summary.share_code}
                  tab={{ name: summary.group_name, kind: summary.kind }}
                  from={
                    summary.members.find((m) => m.id === me)?.name || user?.full_name || "A friend"
                  }
                  onSaved={() => groupQ.refresh()}
                />
              )}
              {editing === member.id && (
                <div className="mt-3 rounded-[20px] bg-paper p-4">
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
        <div className="mt-4">
          <PersonPicker
            existing={summary.members.map((m) => ({
              name: m.name,
              phone: m.phone,
              email: m.email,
              ref: m.id,
              account: m.account,
            }))}
            busy={busy === "add"}
            onAdd={async (person) => {
              setBusy("add");
              try {
                await addGroupMember(id, person);
                invalidateSplits();
                await groupQ.refresh();
              } finally {
                setBusy("");
              }
            }}
            onRename={
              summary.is_owner
                ? async (who, name) => {
                    if (who.ref) await renameMember(id, who.ref, name);
                  }
                : undefined
            }
          />
        </div>
      </section>

      <section className="relative mt-4 overflow-hidden rounded-card bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_48%,#FFFFFF_100%)] p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className={h2}>Invite to this tab</h2>
            <p className="mt-1 text-sm text-muted">
              Anyone with the link sees the balances and can pay in one tap. Friends with a Cotab
              account can join and add their own receipts.
            </p>
          </div>
          <Duo scene="split-bill" width={92} className="shrink-0" />
        </div>
        <Button
          className="mt-4"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Icon name={copied ? "check" : "link"} size={20} />
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
        <p className="mt-2 break-all text-xs font-semibold text-faint">{shareUrl}</p>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className={h2}>Shared purchases</h2>
        <ul className="mt-1">
          {summary.splits.map((split, i) => (
            <li key={split.split_id} className={`py-3 ${i ? "border-t border-line" : ""}`}>
              <Link
                href={routes.receipt(split.receipt_id)}
                className="flex items-start justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-bold">{split.merchant}</span>
                  <span className="block text-[13px] text-faint">
                    {dayLabel(split.purchased_at)}, {split.paid_by} paid,{" "}
                    {modeLabel[split.mode] ?? split.mode}
                  </span>
                </span>
                <span className="shrink-0 text-[15px] font-extrabold">
                  {money(split.total, split.currency)}
                </span>
              </Link>
              {(split.mine || summary.is_owner) && (
                <div className="mt-2 flex gap-4">
                  {split.mine && (
                    <Link
                      href={`${routes.splitReceipt(split.receipt_id)}?tab=${id}`}
                      className="text-sm font-bold text-forest underline underline-offset-4"
                    >
                      Edit split
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={busy === split.split_id}
                    onClick={() => {
                      if (window.confirm(`Take ${split.merchant} off this tab?`))
                        run(split.split_id, () => removeSplit(id, split.split_id));
                    }}
                    className="text-sm font-bold text-forest underline underline-offset-4"
                  >
                    {busy === split.split_id ? "Removing…" : "Remove"}
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {split.shares.map((share) => (
                  <span
                    key={share.member}
                    className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-bold ${
                      share.settled ? "bg-mint text-good" : "bg-paper"
                    }`}
                  >
                    <CatAvatar choice={tabbyFor(share.member)} size={20} />
                    {share.member} {amount(share.amount)}
                    {share.settled ? ", paid" : ""}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {summary.splits.length === 0 && (
          <p className="mt-2 text-sm text-muted">
            Nothing on this tab yet. Open a receipt in{" "}
            <Link href={routes.tab} className="font-bold underline underline-offset-4">
              Receipts
            </Link>{" "}
            and tap Split this.
          </p>
        )}
      </section>
      {reminding !== null &&
        (() => {
          const row = summary.suggested_settlements[reminding];
          const friend = summary.members.find((m) => m.id === row?.from_id);
          if (!row || !friend) return null;
          return (
            <RemindSheet
              groupId={id}
              friend={{ id: friend.id, name: friend.name, notify: friend.notify }}
              me={(user?.full_name || "").split(" ")[0] || "me"}
              amount={row.amount}
              currency={summary.currency ?? "USD"}
              text={reminderText({
                friend: friend.name,
                me: (user?.full_name || "").split(" ")[0] || "me",
                amount: row.amount,
                currency: summary.currency ?? "USD",
                links: row.pay_links ?? [],
                shareUrl,
              })}
              onClose={() => setReminding(null)}
              onSent={(next, note) => {
                if (next) mutate(keys.group(id), next);
                setRemindNote(note);
                setReminding(null);
              }}
            />
          );
        })()}
    </main>
  );
}
