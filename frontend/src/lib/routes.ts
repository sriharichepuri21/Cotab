/**
 * Every in-app path in one place. Pages link through these helpers instead of
 * string literals, so moving a route is a one-line change.
 */
export const routes = {
  landing: "/",
  login: "/login",
  register: "/register",
  welcome: "/welcome",
  verify: "/verify",
  phone: "/phone",
  forgot: "/forgot",
  home: "/app",
  tab: "/app/tab",
  insights: "/app/insights",
  settings: "/app/settings",
  budgets: "/app/budgets",
  groups: "/app/groups",
  group: (id: string) => `/app/groups/${id}`,
  receipt: (id: string) => `/app/receipts/${id}`,
  splitReceipt: (id: string) => `/app/receipts/${id}/split`,
  share: (code: string) => `/share/${code}`,
  tabby: "/app/tabby",
  tabbyWrap: (month?: string) => `/app/tabby/wrap${month ? `?month=${month}` : ""}`,
} as const;

/**
 * Where to go after signing in, from a `?next=` value. Only paths inside the
 * app or a share link count; anything else (another site, `//evil.com`) is ignored.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.startsWith("//") || next.includes("\\")) return null;
  return next.startsWith("/share/") || next === "/app" || next.startsWith("/app/") ? next : null;
}

export const withNext = (path: string, next: string) => `${path}?next=${encodeURIComponent(next)}`;
