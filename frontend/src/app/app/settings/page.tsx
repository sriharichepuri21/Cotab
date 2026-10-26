"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ApplePaySetup } from "@/components/ApplePaySetup";
import { ForwardingSetup } from "@/components/ForwardingSetup";
import { PayHandlesForm } from "@/components/PayHandlesForm";
import {
  DeleteAccount,
  ExportData,
  Group,
  NameForm,
  PhoneForm,
  TabbyPicker,
} from "@/components/ProfileForms";
import { NotificationsCard } from "@/components/NotificationsCard";
import { CatAvatar } from "@/components/Tabby";
import { Button, ErrorNote, Icon, PageHeader } from "@/components/ui";
import { getMyPayHandles, logout, saveMyPayHandles, type PayHandles } from "@/lib/api";
import { useMe } from "@/lib/data";
import { routes } from "@/lib/routes";
import { tint, userTabby } from "@/lib/tabby";

const intentLabel: Record<string, string> = {
  personal: "Just me",
  splits: "Me and the people I live with",
  business: "Work expenses",
};

function Row({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  return (
    <div
      className={`flex min-h-12 items-center justify-between gap-4 py-2.5 ${last ? "" : "border-b border-line"}`}
    >
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="truncate text-right text-[15px] font-bold">{value}</span>
    </div>
  );
}

export default function Settings() {
  const router = useRouter();
  const { data: user, error: userError } = useMe();
  const [handles, setHandles] = useState<PayHandles | undefined>(undefined);

  useEffect(() => {
    getMyPayHandles()
      .then(setHandles)
      .catch(() => setHandles({}));
  }, []);

  async function onSignOut() {
    try {
      await logout();
    } finally {
      router.push(routes.login);
    }
  }

  const [first, ...restName] = (user?.full_name || "").split(" ");
  const choice = userTabby(user);

  return (
    <main className="mx-auto max-w-2xl px-5 pb-12 pt-6 md:px-8 md:pt-10">
      <PageHeader title="Profile" back={{ href: routes.home, label: "Home" }} />

      {userError && <ErrorNote>{userError.message}</ErrorNote>}

      <section className="relative flex flex-col items-center overflow-hidden rounded-[28px] bg-card px-5 pb-6 pt-7 text-center">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-24"
          style={{
            background:
              choice.bg === "sage"
                ? "linear-gradient(#EEF3EF, #FFFFFF)"
                : `linear-gradient(${tint(choice.mood)[0]}, #FFFFFF)`,
          }}
        />
        <CatAvatar choice={choice} size={96} ring="#FFFFFF" className="relative" />
        <p className="relative mt-3 text-[22px] font-extrabold tracking-[-0.03em]">
          {user?.full_name || "Your account"}
        </p>
        <p className="relative text-sm font-medium text-faint">{user?.email}</p>
        <a
          href="#personal"
          className="press relative mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-paper px-4 text-sm font-bold"
        >
          <Icon name="edit" size={18} />
          Edit profile
        </a>
      </section>

      <TabbyPicker />

      <Link
        href={routes.tabby}
        className="press mt-4 flex items-center gap-3 rounded-card bg-card p-4 shadow-[0_0_0_1px_rgb(12_17_14/0.04)]"
      >
        <CatAvatar choice={{ look: "hoodie", mood: "autopilot", bg: "mood" }} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">What Tabby did, rules and memory</span>
          <span className="block text-[13px] text-faint">
            Undo anything Tabby did, pause its rules, see what it remembers
          </span>
        </span>
        <Icon name="chevron_right" className="text-faint" />
      </Link>

      <div className="mt-4">
        <NotificationsCard />
      </div>

      <Group id="personal" title="Personal info">
        <NameForm first={first ?? ""} last={restName.join(" ")} />
        <PhoneForm phone={user?.phone ?? null} />
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="Using Cotab for" value={user?.intent ? intentLabel[user.intent] : "—"} />
        <Row label="Time zone" value={user?.timezone || "—"} last />
      </Group>

      <Group title="Receipt inbox">
        <ForwardingSetup />
        <div className="mt-2 border-t border-line pt-5">
          <h3 className="mb-3 text-[15px] font-extrabold">Apple Pay taps</h3>
          <ApplePaySetup />
        </div>
      </Group>

      <Group title="Money">
        <Link
          href={routes.budgets}
          className="flex min-h-14 items-center gap-3 border-b border-line py-3"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-mint text-good">
            <Icon name="donut_large" size={21} />
          </span>
          <span className="flex-1 text-[15px] font-bold">Budgets</span>
          <Icon name="chevron_right" className="text-faint" />
        </Link>
        <h3 className="mt-5 text-[15px] font-extrabold">Get paid</h3>
        <p className="mb-4 mt-1 text-sm text-muted">
          When friends owe you, their settle-up screen shows buttons that open these apps with the
          amount filled in. Only people you split with see them.
        </p>
        <PayHandlesForm initial={handles} onSave={saveMyPayHandles} idPrefix="me" />
      </Group>

      <Group title="Data and privacy">
        <ExportData />
        <div className="mt-6 border-t border-line pt-5">
          <DeleteAccount />
        </div>
      </Group>

      <Button variant="ghost" onClick={onSignOut} className="mt-6 w-full">
        <Icon name="logout" size={20} />
        Sign out
      </Button>
    </main>
  );
}
