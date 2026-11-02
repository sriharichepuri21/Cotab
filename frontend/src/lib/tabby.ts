import type { TabbyChoice, TabbyLook, TabbyMood, User } from "@/lib/api";

/** Tabby, Cotab's agent. Every picture lives in /public/tabby. */

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
  { id: "working", label: "Working", when: "Doing a task for you", tint: ["#E4F1FA", "#B5D3E8"] },
  { id: "done", label: "Done", when: "A task finished", tint: ["#E1F4DC", "#AFD9A3"] },
  { id: "oops", label: "Oops", when: "Something was undone", tint: ["#F6E9F7", "#D9BEDC"] },
  {
    id: "remember",
    label: "Remember",
    when: "Noting something down",
    tint: ["#FFF4D6", "#F0D58F"],
  },
  {
    id: "autopilot",
    label: "Autopilot",
    when: "A rule ran by itself",
    tint: ["#E6EEEA", "#B9CEC2"],
  },
  { id: "morning", label: "Morning", when: "Your morning note", tint: ["#FFEEDC", "#F5C79A"] },
  { id: "celebrate", label: "Celebrate", when: "Your month wrap-up", tint: ["#F2F8D2", "#D2E58A"] },
  {
    id: "thinking",
    label: "Thinking",
    when: "Working something out",
    tint: ["#ECEAF8", "#C6C1EA"],
  },
];

export const LOOKS: Array<{ id: TabbyLook; label: string }> = [
  { id: "hoodie", label: "Hoodie" },
  { id: "headphones", label: "Headphones" },
  { id: "beanie", label: "Beanie" },
];

const SAGE: [string, string] = ["#EEF3EF", "#C9D6CD"];

export const tint = (mood: TabbyMood) => MOODS.find((m) => m.id === mood)?.tint ?? SAGE;

/** Tabby's twenty poses, and the one each mood and scene wears. */
const POSE: Record<string, string> = {
  hi: "hello",
  cool: "happy",
  hmm: "thinking",
  "over-budget": "worried",
  payday: "wow",
  "need-money": "thinking",
  "out-of-cash": "worried",
  "bill-shock": "worried",
  love: "love",
  salute: "checklist",
  working: "focused",
  done: "excited",
  oops: "worried",
  remember: "reading",
  autopilot: "running",
  morning: "neutral",
  celebrate: "celebrate",
  thinking: "thinking",
};

/** Path to a Tabby picture. Every look is the same Tabby now. */
export function catSrc(mood: TabbyMood, _look: TabbyLook = "hoodie", _head = false) {
  return tabbyArt(mood, 256);
}

/** One mood for each pose, so a picker doesn't offer the same picture twice. */
export const POSE_MOODS = MOODS.filter(
  (m, i) => MOODS.findIndex((o) => POSE[o.id] === POSE[m.id]) === i
);

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

/** A pose by name, for the moments no mood covers. */
export const tabbyPose = (pose: string, width: 256 | 640 = 640) => `/tabby/${pose}-${width}.webp`;

/** Small WebPs of public/tabby: 256px for avatars and small figures, 640px for the big ones. */
export const tabbyArt = (mood: string, width: 256 | 640 = 256) =>
  `/tabby/${POSE[mood] ?? "hello"}-${width}.webp`;

const DUO: Record<DuoScene, string> = {
  "settle-up": "payday",
  confirmed: "done",
  "send-payment": "payday",
  "payment-received": "payday",
  "split-bill": "love",
  "equal-share": "love",
  reminder: "remember",
  pending: "thinking",
  thanks: "love",
  "save-together": "need-money",
  "goal-reached": "celebrate",
  "debt-cleared": "done",
};

export const duoSrc = (scene: DuoScene) => tabbyArt(DUO[scene], 640);

export const DEFAULT_TABBY: TabbyChoice = { look: "hoodie", mood: "hi", bg: "mood" };

/** The picture this person chose, or the hoodie Tabby saying hi. */
/** A saved value Cotab still draws; an older look or a seeded "happy" isn't. */
const known = <T extends string>(list: Array<{ id: T }>, value: string | null | undefined) =>
  list.find((item) => item.id === value)?.id;

export function userTabby(user: User | null | undefined): TabbyChoice {
  return {
    look: known(LOOKS, user?.avatar_look) ?? DEFAULT_TABBY.look,
    mood: known(MOODS, user?.avatar_mood) ?? DEFAULT_TABBY.mood,
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
    mood: FRIEND_MOODS[(hash >>> 1) % FRIEND_MOODS.length],
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
