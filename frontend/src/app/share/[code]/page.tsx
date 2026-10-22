"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { PayLinks } from "@/components/PayLinks";
import { CatAvatar, Duo } from "@/components/Tabby";
import { buttonClass, Icon } from "@/components/ui";
import { getPublicSplit, getToken, joinTab, type SplitSummary } from "@/lib/api";
import { invalidateSplits } from "@/lib/data";
import { amount, money } from "@/lib/format";
import { routes, withNext } from "@/lib/routes";
import { friendTabby } from "@/lib/tabby";

export default function PublicSplitPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [data, setData] = useState<SplitSummary | null>(null);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [joining, setJoining] = useState("");
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
    getPublicSplit(code)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [code]);

  async function join(memberId?: string) {
    setJoining(memberId ?? "new");
    setJoinError("");
    try {
      const result = await joinTab(code, memberId);
      invalidateSplits();
      router.push(routes.group(result.group_id));
    } catch (e) {
      setJoinError((e as Error).message);
      setJoining("");
    }
  }

  if (!data)
    return (
      <main className="mx-auto max-w-xl px-5 py-8">
        <Logo />
        <div className="mt-10 flex items-center gap-3">
          <CatAvatar
            choice={{ look: "hoodie", mood: error ? "hmm" : "hi", bg: "mood" }}
            size={48}
          />
          <p className="font-semibold text-muted">{error || "Loading the tab…"}</p>
        </div>
      </main>
    );

  const here = routes.share(code);
  const open = data.members.filter((m) => !m.joined);
  const tabbyFor = (name: string) =>
    data.members.find((m) => m.name === name)?.avatar ?? friendTabby(name);

  return (
    <main className="mx-auto max-w-xl px-5 pb-12 pt-8">
      <Link href={routes.landing} aria-label="Cotab">
        <Logo />
      </Link>

      <section className="relative mt-8 overflow-hidden rounded-[28px] bg-forest px-5 pb-5 pt-5 text-[#F3F6F1]">
        <span
          aria-hidden="true"
          className="absolute -right-[60px] -top-[90px] h-[300px] w-[220px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
        />
        <div className="relative flex items-end gap-3">
          <div className="min-w-0 flex-1 pb-2">
            <p className="text-sm font-semibold text-[#F3F6F1]/70">A shared tab</p>
            <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-[-0.04em]">
              {data.group_name}
            </h1>
            <p className="mt-1.5 text-sm text-[#F3F6F1]/70">
              {data.members.map((m) => m.name).join(", ")}.{" "}
              <strong className="text-gold">{money(data.total_spend, data.currency)}</strong>{" "}
              shared.
            </p>
          </div>
          <Duo scene="split-bill" width={120} className="shrink-0" />
        </div>
      </section>

      <section className="mt-4 rounded-card bg-card p-5">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">To settle up</h2>
        {data.suggested_settlements.length ? (
          <ul className="mt-3 flex flex-col gap-3">
            {data.suggested_settlements.map((row, i) => (
              <li key={i} className="rounded-[20px] bg-paper p-4">
                <div className="flex items-center gap-3">
                  <span className="flex items-center">
                    <CatAvatar choice={tabbyFor(row.from)} size={40} ring="#F3F4F1" />
                    <Icon name="arrow_forward" size={18} className="mx-1 text-faint" />
                    <CatAvatar choice={tabbyFor(row.to)} size={40} ring="#F3F4F1" />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px]">
                    <strong className="font-extrabold">{row.from}</strong> pays{" "}
                    <strong className="font-extrabold">{row.to}</strong>
                  </span>
                  <strong className="text-[17px] font-extrabold">
                    {money(row.amount, data.currency)}
                  </strong>
                </div>
                {(row.pay_links?.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[13px] font-semibold text-muted">
                      {row.from}, pay {row.to} in one tap:
                    </p>
                    <PayLinks links={row.pay_links!} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 flex items-center gap-3 rounded-[20px] bg-mint p-3">
            <Duo scene="debt-cleared" width={96} />
            <p className="font-extrabold text-good">Everyone is even.</p>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-card bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_48%,#FFFFFF_100%)] p-5">
        <div className="flex items-center gap-3">
          <CatAvatar choice={{ look: "hoodie", mood: "love", bg: "mood" }} size={52} soft />
          <div>
            <h2 className="text-lg font-extrabold tracking-[-0.02em]">Join this tab</h2>
            <p className="text-sm text-muted">
              Add your own receipts, mark payments and see the balance update for everyone.
            </p>
          </div>
        </div>
        {signedIn ? (
          <div className="mt-4 flex flex-col gap-2">
            {open.length > 0 && <p className="text-sm font-bold">Which one is you?</p>}
            <div className="flex flex-wrap gap-2">
              {open.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  disabled={Boolean(joining)}
                  onClick={() => join(member.id)}
                  className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-card py-1 pl-1 pr-4 font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.06)] disabled:opacity-50"
                >
                  <CatAvatar choice={tabbyFor(member.name)} size={34} />
                  {joining === member.id ? "Joining…" : `I'm ${member.name}`}
                </button>
              ))}
              <button
                type="button"
                disabled={Boolean(joining)}
                onClick={() => join()}
                className="press min-h-11 rounded-full bg-forest px-5 font-bold text-paper disabled:opacity-50"
              >
                {joining === "new" ? "Joining…" : open.length ? "I'm someone new" : "Join"}
              </button>
            </div>
            {joinError && (
              <p role="alert" className="text-sm font-semibold text-rose">
                {joinError}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={withNext(routes.register, here)} className={buttonClass.primary}>
              Create a free account
            </Link>
            <Link href={withNext(routes.login, here)} className={buttonClass.ghost}>
              Log in
            </Link>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-card bg-card p-5">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Shared purchases</h2>
        <ul className="mt-1">
          {data.splits.map((split, i) => (
            <li key={split.split_id} className={`py-3 ${i ? "border-t border-line" : ""}`}>
              <div className="flex justify-between gap-3">
                <span className="text-[15px] font-bold">{split.merchant}</span>
                <span className="text-[15px] font-extrabold">
                  {money(split.total, split.currency)}
                </span>
              </div>
              <p className="text-[13px] text-faint">Paid by {split.paid_by}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {split.shares.map((share) => (
                  <span
                    key={share.member}
                    className="inline-flex items-center gap-1.5 rounded-full bg-paper py-1 pl-1 pr-2.5 text-xs font-bold"
                  >
                    <CatAvatar choice={tabbyFor(share.member)} size={20} />
                    {share.member} {amount(share.amount)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-8 text-center text-[13px] font-semibold text-faint">
        Anyone with this link can see this summary. Made with Cotab.
      </p>
    </main>
  );
}
