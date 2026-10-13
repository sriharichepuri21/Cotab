/**
 * Every in-app path in one place. Pages link through these helpers instead of
 * string literals, so moving a route is a one-line change.
 */
export const routes = {
  landing: "/",
  login: "/login",
  register: "/register",
  welcome: "/welcome",
  home: "/app",
  tab: "/app/tab",
  settings: "/app/settings",
  budgets: "/app/budgets",
  groups: "/app/groups",
  group: (id: string) => `/app/groups/${id}`,
  receipt: (id: string) => `/app/receipts/${id}`,
  splitReceipt: (id: string) => `/app/receipts/${id}/split`,
  share: (code: string) => `/share/${code}`,
} as const;
