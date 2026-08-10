/**
 * API client.
 *
 * Auth is Bearer-header primary: register()/login() capture the returned
 * access_token into sessionStorage and every request attaches it as
 * `Authorization: Bearer <token>`. That works in every browser privacy mode —
 * including Chrome Incognito, which BLOCKS third-party cookies on send even
 * though it stores them (the bug that forced this design).
 *
 * `credentials: "include"` is kept on every request so the httpOnly `rw_access`
 * cookie still rides along where the browser allows it (same-origin localhost,
 * or a future same-registrable-domain deploy such as app.example.com +
 * api.example.com). The backend accepts either; the header wins when both
 * exist. Cookies stay as the secondary path — removing them would only matter
 * once cross-site is gone for good.
 */

export const API =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const TOKEN_KEY = "rw_token";
// In-memory mirror so reads are fast and we don't re-parse storage on every call.
let tokenMemory: string | null = null;

export function getToken(): string | null {
  if (tokenMemory) return tokenMemory;
  if (typeof window === "undefined") return null;
  tokenMemory = window.sessionStorage.getItem(TOKEN_KEY);
  return tokenMemory;
}

export function setToken(token: string): void {
  tokenMemory = token;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearToken(): void {
  tokenMemory = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(TOKEN_KEY);
  }
}

/** True when a token exists in this tab's session (UX hint, not a security check). */
export function isAuthed(): boolean {
  return getToken() !== null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === "string") return d;
    // FastAPI 422 returns a list of {loc, msg, type}
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
    return JSON.stringify(d ?? body);
  } catch {
    return res.statusText || `Request failed (${res.status})`;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  // Local dev escape hatch: when there's no session token (e.g. testing a page
  // in isolation), fall back to the backend's non-prod X-Dev-User header. The
  // header is only sent in non-production builds, so it can never assert an
  // identity in prod. Saves the login dance when verifying a page by URL.
  const devHeaders: Record<string, string> =
    process.env.NODE_ENV !== "production" && !token
      ? { "X-Dev-User": "dev@local" }
      : {};
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include", // keep: cookie is the secondary path (see header note)
    headers: {
      // Caller may set Content-Type etc.; Authorization added when we have a token.
      ...devHeaders,
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    // A dead token is worse than none: clear it so the next render routes to login.
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, await parseError(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiJson<T = unknown>(
  path: string,
  method: string,
  body: unknown
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Types + auth calls
// ---------------------------------------------------------------------------

export type Intent = "personal" | "splits" | "business";

export interface User {
  id: string;
  email: string;
  full_name: string;
  timezone: string;
  intent: Intent | null;
}

export const register = async (
  email: string,
  password: string,
  full_name: string
) => {
  const res = await apiJson<{ access_token: string }>(
    "/api/v1/auth/register",
    "POST",
    { email, password, full_name }
  );
  setToken(res.access_token);
  return res;
};

/** Login is an OAuth2 password form, not JSON — `username` carries the email. */
export const login = async (email: string, password: string) => {
  const res = await apiFetch<{ access_token: string }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }).toString(),
  });
  setToken(res.access_token);
  return res;
};

/** Clear the server-side cookie (best-effort) AND the tab's stored token. */
export const logout = async () => {
  try {
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
};

export const me = () => apiFetch<User>("/api/v1/auth/me");

export const setIntent = (intent: Intent) =>
  apiJson<User>("/api/v1/auth/set-intent", "POST", { intent });

// ---------------------------------------------------------------------------
// Receipts + chat
// ---------------------------------------------------------------------------

export interface Receipt {
  id: string;
  merchant: string;
  merchant_raw?: string;
  purchased_at: string | null;
  total: number;
  subtotal: number;
  tax: number;
  currency: string;
  category: string;
  status: string;
  confidence: number;
  error_message?: string;
  line_items?: LineItem[];
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export const listReceipts = () => apiFetch<Receipt[]>("/api/v1/receipts/");

export const getReceipt = (id: string) =>
  apiFetch<Receipt>(`/api/v1/receipts/${id}`);

/** Presigned URL for the receipt image (private bucket). 404 if none. */
export const getReceiptImage = (id: string) =>
  apiFetch<{ url: string }>(`/api/v1/receipts/${id}/image`);

/** Human-in-the-loop correction; flips status to reviewed. */
export interface ReceiptReviewInput {
  merchant?: string;
  purchased_at?: string | null;
  total?: number;
  subtotal?: number;
  tax?: number;
  currency?: string;
  category?: string;
  line_items?: Omit<LineItem, "id">[];
}
export const reviewReceipt = (id: string, body: ReceiptReviewInput) =>
  apiJson<Receipt>(`/api/v1/receipts/${id}/review`, "POST", body);

/** Re-run AI extraction on the stored image (resets extraction fields). */
export const retryReceipt = (id: string) =>
  apiFetch<Receipt>(`/api/v1/receipts/${id}/retry`, { method: "POST" });

/** Soft-delete; the receipt disappears from lists but stays in the DB. */
export const deleteReceipt = (id: string) =>
  apiFetch(`/api/v1/receipts/${id}`, { method: "DELETE" });

/** Multipart — don't set Content-Type, the browser adds the boundary. */
export const uploadReceipt = (blob: Blob) => {
  const fd = new FormData();
  fd.append("file", blob, "receipt.webp");
  return apiFetch<Receipt>("/api/v1/receipts/upload", {
    method: "POST",
    body: fd,
  });
};

export const sendChat = (message: string, session_id: string | null) =>
  apiJson<{ session_id: string; message: string }>("/api/v1/chat/", "POST", {
    message,
    session_id,
  });
