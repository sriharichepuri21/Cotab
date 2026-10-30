/**
 * Every in-app path in one place. Pages link through these helpers instead of
 * string literals, so moving a route is a one-line change.
 */
export const routes = {
  landing: "/",
  start: "/start",
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

/** Keep links returned by Tabby inside the query-driven app shell. */
export function newUiPath(path: string): string {
  if (!path.startsWith("/app")) return path;
  if (path === "/app" || path.startsWith("/app?")) return path;
  if (path === "/app/tabby") return "/app?tab=tabby";
  if (path === "/app/insights") return "/app?panel=insights";
  if (path === "/app/budgets") return "/app?panel=budgets";
  if (path === "/app/settings") return "/app?panel=profile";
  if (path === "/app/splits" || path === "/app/groups") return "/app?tab=circles";
  const group = path.match(/^\/app\/groups\/([^/?#]+)/);
  if (group) return `/app?tab=circles&group=${encodeURIComponent(group[1])}`;
  const receipt = path.match(/^\/app\/receipts\/([^/?#]+)/);
  if (receipt) return `/app?receipt=${encodeURIComponent(receipt[1])}`;
  return routes.home;
}

/**
 * Where to go after signing in, from a `?next=` value. Only paths inside the
 * app or a share link count; anything else (another site, `//evil.com`) is ignored.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.startsWith("//") || next.includes("\\")) return null;
  if (next.startsWith("/share/")) return next;
  // Authentication must never re-enter a legacy page. Keep the requested
  // context (receipt, circle, panel) but express it inside the New UI shell.
  if (next === "/app" || next.startsWith("/app/") || next.startsWith("/app?")) {
    return newUiPath(next);
  }
  return null;
}

export const withNext = (path: string, next: string) => `${path}?next=${encodeURIComponent(next)}`;
