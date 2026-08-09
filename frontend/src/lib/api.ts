/**
 * API client.
 *
 * Every request sends credentials so the httponly `rw_access` cookie rides
 * along. That cookie is cross-site in production (vercel.app -> onrender.com),
 * which is why the backend sets SameSite=None; Secure and CORS runs with
 * allow_credentials. Omitting `credentials: "include"` here is the single most
 * common way this breaks: login appears to succeed, then every later request
 * 401s because the cookie was never sent.
 */

export const API =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
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

export const register = (email: string, password: string, full_name: string) =>
  apiJson<{ access_token: string }>("/api/v1/auth/register", "POST", {
    email,
    password,
    full_name,
  });

/** Login is an OAuth2 password form, not JSON — `username` carries the email. */
export const login = (email: string, password: string) =>
  apiFetch<{ access_token: string }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }).toString(),
  });

export const logout = () => apiFetch("/api/v1/auth/logout", { method: "POST" });

export const me = () => apiFetch<User>("/api/v1/auth/me");

export const setIntent = (intent: Intent) =>
  apiJson<User>("/api/v1/auth/set-intent", "POST", { intent });

// ---------------------------------------------------------------------------
// Receipts + chat
// ---------------------------------------------------------------------------

export interface Receipt {
  id: string;
  merchant: string;
  total: number;
  currency: string;
  category: string;
  status: string;
  confidence: number;
}

export const listReceipts = () => apiFetch<Receipt[]>("/api/v1/receipts/");

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
