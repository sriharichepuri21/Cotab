"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApplePaySetup } from "@/components/ApplePaySetup";
import { ForwardingSetup } from "@/components/ForwardingSetup";
import { NotificationsCard } from "@/components/NotificationsCard";
import { PayHandlesForm } from "@/components/PayHandlesForm";
import {
  DeleteAccount,
  ExportData,
  NameForm,
  PhoneForm,
  saveProfile,
} from "@/components/ProfileForms";
import { Icon } from "@/components/ui";
import {
  getMyPayHandles,
  logout,
  saveMyPayHandles,
  type PayHandles,
  type ProfileUpdate,
} from "@/lib/api";
import { useMe } from "@/lib/data";
import { prettyPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { BackHeader, Cat, V3_MOODS, v3 } from "./parts";

type View = "personal" | "tabby" | "notifications" | "inbox" | "money" | "privacy";

const TITLES: Record<View, string> = {
  personal: "Personal information",
  tabby: "Your Tabby",
  notifications: "Notifications",
  inbox: "Receipt capture",
  money: "Money and payments",
  privacy: "Data and privacy",
};

const INTENT: Record<string, string> = {
  personal: "Just me",
  splits: "Me and the people I live with",
  business: "Work expenses",
};

/**
 * Profile: your account, your Tabby, capture, payments and privacy. Each
 * part is the same component and API the rest of the app uses; nothing here
 * is kept only on this screen.
 */
export function Profile({
  back,
  dark,
  toggleTheme,
  goBudgets,
  goTabby,
}: {
  back: () => void;
  dark: boolean;
  toggleTheme: () => void;
  goBudgets: () => void;
  goTabby: () => void;
}) {
  const router = useRouter();
  const { data: user } = useMe();
  const [view, setView] = useState<View | null>(null);
  const [handles, setHandles] = useState<PayHandles | undefined>(undefined);
  const [error, setError] = useState("");
  const mood = v3(user?.avatar_mood);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    if (view !== "money" || handles) return;
    getMyPayHandles()
      .then(setHandles)
      .catch(() => setHandles({}));
  }, [view, handles]);

  async function save(change: ProfileUpdate) {
    setError("");
    try {
      await saveProfile(change);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      router.push(routes.login);
    }
  }

  const [first, ...rest] = (user?.full_name || "").split(" ");
  const rows: Array<{ id: View; icon: string; title: string; sub: string }> = [
    {
      id: "personal",
      icon: "person",
      title: "Personal information",
      sub: "Name, mobile and email",
    },
    {
      id: "notifications",
      icon: "notifications_none",
      title: "Notifications",
      sub: "Reminders and Tabby notes on this device",
    },
    {
      id: "inbox",
      icon: "mail",
      title: "Receipt capture",
      sub: "Email forwarding and Apple Pay taps",
    },
    {
      id: "money",
      icon: "account_balance_wallet",
      title: "Money and payments",
      sub: "Budgets and ways friends can pay you",
    },
    {
      id: "privacy",
      icon: "shield",
      title: "Data and privacy",
      sub: "Export data or delete the account",
    },
  ];

  if (view)
    return (
      <main className="px-5 pb-12 pt-5">
        <BackHeader title={TITLES[view]} back={() => setView(null)} backLabel="Profile" />
        {error && (
          <p role="alert" className="mt-4 text-[12px] font-semibold text-[#a74132]">
            {error}
          </p>
        )}
        <div className="profile-panel ios-surface mt-7 rounded-[22px] p-5">
          {view === "personal" && (
            <>
              <NameForm first={first ?? ""} last={rest.join(" ")} />
              <PhoneForm phone={user?.phone ?? null} />
              <dl className="mt-2 text-[13px]">
                {(
                  [
                    ["Email", user?.email ?? "—"],
                    ["Mobile", user?.phone ? prettyPhone(user.phone) : "Not added"],
                    ["Using Cotab for", user?.intent ? INTENT[user.intent] : "—"],
                    ["Time zone", user?.timezone || "—"],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex min-h-11 items-center justify-between gap-4 border-t border-black/[0.07] py-2"
                  >
                    <dt className="text-[#77776f]">{label}</dt>
                    <dd className="truncate font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {view === "tabby" && (
            <>
              <div className="flex items-center gap-4">
                <Cat mood={mood} size={72} />
                <div>
                  <b className="block text-[15px]">How Tabby looks for you</b>
                  <span className="text-[12px] text-[#77776f]">
                    Friends see this Tabby next to your name.
                  </span>
                </div>
              </div>
              <div
                role="radiogroup"
                aria-label="Tabby's look"
                className="mt-5 grid grid-cols-4 gap-3"
              >
                {Array.from(V3_MOODS).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={m === mood}
                    aria-label={m.replace(/-/g, " ")}
                    onClick={() => save({ avatar_mood: m as ProfileUpdate["avatar_mood"] })}
                    className={`grid place-items-center rounded-full p-1 ${m === mood ? "ring-2 ring-[#103e33] ring-offset-2" : ""}`}
                  >
                    <Cat mood={m} size={52} />
                  </button>
                ))}
              </div>
              <label className="mt-6 flex min-h-12 items-center justify-between gap-4 border-t border-black/[0.07] pt-4">
                <span>
                  <b className="block text-[14px]">Tabby reacts to your money</b>
                  <span className="text-[11px] text-[#77776f]">
                    Its face follows your budget and tabs on each screen.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={user?.tabby_reacts !== false}
                  onChange={(e) => save({ tabby_reacts: e.target.checked })}
                  className="h-6 w-11 accent-[#103e33]"
                />
              </label>
              <button
                onClick={goTabby}
                className="mt-4 flex min-h-12 w-full items-center gap-3 border-t border-black/[0.07] pt-4 text-left"
              >
                <Icon name="psychology" size={20} />
                <span className="flex-1">
                  <b className="block text-[14px]">Rules, actions and memory</b>
                  <span className="text-[11px] text-[#77776f]">
                    Review, pause or undo Tabby’s work
                  </span>
                </span>
                <Icon name="chevron_right" size={18} />
              </button>
            </>
          )}
          {view === "notifications" && <NotificationsCard />}
          {view === "inbox" && (
            <>
              <ForwardingSetup />
              <h3 className="mb-3 mt-6 border-t border-black/[0.07] pt-5 text-[15px] font-semibold">
                Apple Pay taps
              </h3>
              <ApplePaySetup />
            </>
          )}
          {view === "money" && (
            <>
              <button
                onClick={goBudgets}
                className="flex min-h-12 w-full items-center gap-3 text-left"
              >
                <Icon name="donut_large" size={20} />
                <b className="flex-1 text-[14px]">Budgets</b>
                <Icon name="chevron_right" size={18} />
              </button>
              <h3 className="mt-4 border-t border-black/[0.07] pt-5 text-[15px] font-semibold">
                Get paid
              </h3>
              <p className="mb-4 mt-1 text-[12px] text-[#77776f]">
                When friends owe you, their settle-up screen opens these apps with the amount filled
                in. Only people you split with see them.
              </p>
              <PayHandlesForm initial={handles} onSave={saveMyPayHandles} idPrefix="me" />
            </>
          )}
          {view === "privacy" && (
            <>
              <ExportData />
              <div className="mt-6 border-t border-black/[0.07] pt-5">
                <DeleteAccount />
              </div>
            </>
          )}
        </div>
      </main>
    );

  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader title="Profile" back={back} />
      <section className="ios-surface mt-7 grid grid-cols-[minmax(0,1fr)_110px] items-end overflow-hidden rounded-[24px] pl-5">
        <div className="min-w-0 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
            Your Cotab
          </p>
          <h2 className="mt-2 truncate text-[24px] font-semibold tracking-[-.04em]">
            {user?.full_name || "Your account"}
          </h2>
          <p className="mt-1 truncate text-[12px] text-[#77776f]">{user?.email}</p>
          <button
            onClick={() => setView("personal")}
            className="mt-4 min-h-10 text-[12px] font-bold text-[#103e33]"
          >
            Edit account details →
          </button>
        </div>
        <div className="tabby-v3-stage tabby-v3-stage-profile relative flex h-[142px] items-end justify-center">
          <img
            src={`/cat-v3-stock/png/${mood}.png`}
            alt=""
            className="tabby-v3-figure h-[148px] w-full object-contain object-bottom"
          />
        </div>
      </section>
      <button
        onClick={toggleTheme}
        className="ios-surface mt-4 flex w-full items-center gap-3 rounded-[18px] p-4 text-left"
      >
        <span className="ios-theme-glyph grid h-10 w-10 place-items-center rounded-[13px]">
          <Icon name={dark ? "dark_mode" : "light_mode"} size={20} />
        </span>
        <span className="flex-1">
          <b className="block text-[14px]">Appearance</b>
          <span className="text-[11px] text-[#77776f]">
            {dark ? "Dark material" : "Light material"}
          </span>
        </span>
        <span className="text-[12px] font-semibold text-[#77776f]">{dark ? "Dark" : "Light"}</span>
        <Icon name="chevron_right" size={18} className="text-[#9c9c95]" />
      </button>
      <section className="mt-8">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
          Your Tabby
        </p>
        <button
          onClick={() => setView("tabby")}
          className="profile-tabby mt-3 w-full rounded-[20px] bg-[#edf9b7] p-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <b className="block text-[#22231f]">
                Tabby · {mood.charAt(0).toUpperCase() + mood.slice(1).replace(/-/g, " ")}
              </b>
              <span className="text-[12px] text-[#526346]">
                {user?.tabby_reacts === false
                  ? "Stays as you picked"
                  : "Reacts when your spending changes"}
              </span>
            </div>
            <Cat mood={mood} size={52} />
          </div>
        </button>
      </section>
      <section className="mt-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
          Account
        </p>
        <div className="ios-surface rounded-[20px] px-4">
          {rows.map((row, i) => (
            <button
              key={row.id}
              onClick={() => setView(row.id)}
              className={`flex min-h-14 w-full items-center gap-3 py-4 text-left ${i ? "border-t border-black/[0.07]" : ""}`}
            >
              <Icon name={row.icon} size={20} />
              <span className="flex-1">
                <b className="block text-[14px]">{row.title}</b>
                <span className="text-[11px] text-[#77776f]">{row.sub}</span>
              </span>
              <Icon name="chevron_right" size={18} className="text-[#9c9c95]" />
            </button>
          ))}
        </div>
      </section>
      <button
        onClick={signOut}
        className="profile-signout mt-6 min-h-12 w-full rounded-full border border-black/10 bg-[#fffefa] py-3.5 text-[13px] font-bold text-[#22231f]"
      >
        Sign out
      </button>
    </main>
  );
}
