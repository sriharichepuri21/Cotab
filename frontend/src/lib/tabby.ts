import type { TabbyChoice, TabbyLook, TabbyMood, User } from "@/lib/api";

/**
 * Tabby, Cotab's cat. Every picture lives in /public/cat:
 *   {mood}.webp / {mood}-head.webp       Tabby in the hoodie (you)
 *   hp-{mood}…, bn-{mood}…               friends in headphones or a beanie
 *   duo-{scene}.webp                     two cats, for settling up
 */

export const MOODS: Array<{
  id: TabbyMood;
  label: string;
  /** When Tabby wears this face on its own. */
  when: string;
  /** Soft gradient behind the cat: light centre, deeper edge. */
  tint: [string, string];
}> = [
  { id: "hi", label: "Hi", when: "A new receipt", tint: ["#DCF3EF", "#9DD7CD"] },
  { id: "cool", label: "Cool", when: "Under budget", tint: ["#D6EFE2", "#9CC9AD"] },
  { id: "hmm", label: "Hmm", when: "Close to a limit", tint: ["#FFF2CA", "#F3D38B"] },
  {
    id: "over-budget",
    label: "Over budget",
    when: "Past a limit",
    tint: ["#FFE6DA", "#F4B6AC"],
  },
  { id: "payday", label: "Payday", when: "A friend paid you", tint: ["#E2F6D5", "#B6DB9B"] },
  {
    id: "need-money",
    label: "Need money",
    when: "Owed for two weeks",
    tint: ["#E5EDFD", "#B7CFF0"],
  },
  {
    id: "out-of-cash",
    label: "Out of cash",
    when: "Budget ran out",
    tint: ["#E9E4F4", "#C2B9DD"],
  },
  {
    id: "bill-shock",
    label: "Bill shock",
    when: "A receipt over $200",
    tint: ["#FFEADC", "#F6C0A4"],
  },
  { id: "love", label: "Love", when: "Splitting with friends", tint: ["#FFE2EA", "#F8B5C5"] },
  { id: "salute", label: "Salute", when: "A goal reached", tint: ["#DAECFB", "#B2D0E9"] },
];

export const LOOKS: Array<{ id: TabbyLook; label: string }> = [
  { id: "hoodie", label: "Hoodie" },
  { id: "headphones", label: "Headphones" },
  { id: "beanie", label: "Beanie" },
];

const PREFIX: Record<TabbyLook, string> = { hoodie: "", headphones: "hp-", beanie: "bn-" };
const SAGE: [string, string] = ["#EEF3EF", "#C9D6CD"];

export const tint = (mood: TabbyMood) => MOODS.find((m) => m.id === mood)?.tint ?? SAGE;

/** Path to a Tabby picture: the whole cat, or just the head for avatars. */
export function catSrc(mood: TabbyMood, look: TabbyLook = "hoodie", head = false) {
  return `/cat/${PREFIX[look]}${mood}${head ? "-head" : ""}.webp`;
}

export type DuoScene =
  | "settle-up"
  | "confirmed"
  | "send-payment"
  | "payment-received"
  | "split-bill"
  | "equal-share"
  | "reminder"
  | "pending"
  | "thanks"
  | "save-together"
  | "goal-reached"
  | "debt-cleared";

export const duoSrc = (scene: DuoScene) => `/cat/duo-${scene}.webp`;

export const DEFAULT_TABBY: TabbyChoice = { look: "hoodie", mood: "hi", bg: "mood" };

/** The picture this person chose, or the hoodie Tabby saying hi. */
export function userTabby(user: User | null | undefined): TabbyChoice {
  return {
    look: user?.avatar_look ?? DEFAULT_TABBY.look,
    mood: user?.avatar_mood ?? DEFAULT_TABBY.mood,
    bg: user?.avatar_bg ?? DEFAULT_TABBY.bg,
  };
}

/**
 * Friends without their own pick still get a cat, the same one every time:
 * headphones or beanie (the hoodie is yours), in a friendly face.
 */
const FRIEND_MOODS: TabbyMood[] = ["cool", "love", "salute", "hi", "payday", "hmm"];
export function friendTabby(name: string): TabbyChoice {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    look: hash % 2 ? "headphones" : "beanie",
    mood: FRIEND_MOODS[(hash >> 1) % FRIEND_MOODS.length],
    bg: "mood",
  };
}

/** How Tabby feels about a budget: used share of the limit vs. the month gone by. */
export function budgetMood(used: number, limit: number, monthDone: number): TabbyMood {
  if (!limit) return "hi";
  const share = used / limit;
  if (share >= 1) return "out-of-cash";
  if (share > 0.9) return "over-budget";
  if (share > monthDone + 0.1) return "hmm";
  return "cool";
}
