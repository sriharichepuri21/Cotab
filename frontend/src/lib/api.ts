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

import { clearCache } from "@/lib/cache";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
  clearCache(); // a new sign-in never sees the previous person's data
  tokenMemory = token;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearToken(): void {
  clearCache();
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
  /** Machine-readable reason when the server gives one (e.g. "not_a_receipt"). */
  code?: string;
  /** Anything else the server attached to the refusal (e.g. receipt_id). */
  extra: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

type ParsedError = { message: string; code?: string; extra: Record<string, unknown> };

async function parseError(res: Response): Promise<ParsedError> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === "string") return { message: d, extra: {} };
    // Cotab refusals: {code, message, ...extra}
    if (d && typeof d === "object" && !Array.isArray(d) && typeof d.message === "string") {
      const { code, message, ...extra } = d as Record<string, unknown>;
      return { message: message as string, code: code as string | undefined, extra };
    }
    // FastAPI 422 returns a list of {loc, msg, type}
    if (Array.isArray(d) && d[0]?.msg) return { message: d[0].msg, extra: {} };
    return { message: JSON.stringify(d ?? body), extra: {} };
  } catch {
    return { message: res.statusText || `Request failed (${res.status})`, extra: {} };
  }
}

/** Fired with `detail: true` when any request has been waiting longer than
 *  SLOW_AFTER_MS, and `false` once nothing slow is left in flight. */
export const SLOW_EVENT = "rw:slow";
/** Fired when a signed-in request comes back 401 (session expired). */
export const UNAUTHED_EVENT = "rw:unauthed";
/** Fired when the server says this account must confirm its email first. */
export const VERIFY_EVENT = "rw:verify";
const SLOW_AFTER_MS = 2500;
let slowInFlight = 0;

function setSlow(delta: number) {
  const before = slowInFlight;
  slowInFlight = Math.max(0, slowInFlight + delta);
  if (typeof window === "undefined") return;
  if (before === 0 && slowInFlight > 0)
    window.dispatchEvent(new CustomEvent(SLOW_EVENT, { detail: true }));
  if (before > 0 && slowInFlight === 0)
    window.dispatchEvent(new CustomEvent(SLOW_EVENT, { detail: false }));
}

/** Track one request: if it outlives SLOW_AFTER_MS, count it as slow until it settles. */
async function timed<T>(work: Promise<T>): Promise<T> {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    setSlow(1);
  }, SLOW_AFTER_MS);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
    if (slow) setSlow(-1);
  }
}

let woken = false;
/**
 * Nudge the API awake without waiting for the answer. Called as soon as the
 * landing or sign-in page opens, so a sleeping free-tier server is already
 * booting while the person types their password.
 */
export function wakeServer(): void {
  if (woken || typeof window === "undefined") return;
  woken = true;
  fetch(`${API}/health`, { cache: "no-store" }).catch(() => {
    woken = false; // let the next page try again
  });
}

/**
 * Send a request and return the raw response, throwing ApiError on failure.
 * `expectSlow` marks calls that take seconds by design (reading a receipt or
 * answering a question with AI), so they never trigger the "waking up" notice.
 */
async function apiResponse(
  path: string,
  init: RequestInit = {},
  { expectSlow = false }: { expectSlow?: boolean } = {}
): Promise<Response> {
  const token = getToken();
  const request = fetch(`${API}${path}`, {
    ...init,
    credentials: "include", // keep: cookie is the secondary path (see header note)
    headers: {
      // Caller may set Content-Type etc.; Authorization added when we have a token.
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const res = await (expectSlow ? request : timed(request));
  if (!res.ok) {
    // A dead token is worse than none: clear it, and tell the app shell so it
    // can send the person to sign in from whichever page they are on.
    if (res.status === 401 && token) {
      clearToken();
      if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHED_EVENT));
    }
    if (res.status === 403 && res.headers.get("X-Verify-Email") && typeof window !== "undefined")
      window.dispatchEvent(new Event(VERIFY_EVENT));
    const err = await parseError(res);
    throw new ApiError(res.status, err.message, err.code, err.extra);
  }
  return res;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  opts: { expectSlow?: boolean } = {}
): Promise<T> {
  const res = await apiResponse(path, init, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiJson<T = unknown>(
  path: string,
  method: string,
  body: unknown,
  opts: { expectSlow?: boolean } = {}
): Promise<T> {
  return apiFetch<T>(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts
  );
}

// ---------------------------------------------------------------------------
// Types + auth calls
// ---------------------------------------------------------------------------

export type Intent = "personal" | "splits" | "business";

export interface User {
  id: string;
  email: string;
  /** "+14155550123", or null until they add it (the app then asks for it). */
  phone?: string | null;
  full_name: string;
  timezone: string;
  intent: Intent | null;
  /** False until the emailed code is entered. */
  email_verified?: boolean;
  /** False for accounts made with Google or Apple. */
  has_password?: boolean;
  avatar_look?: TabbyLook | null;
  avatar_mood?: TabbyMood | null;
  avatar_bg?: "mood" | "sage" | null;
  tabby_reacts?: boolean | null;
}

export type TabbyLook = "hoodie" | "headphones" | "beanie";
export type TabbyMood =
  | "hi"
  | "cool"
  | "hmm"
  | "over-budget"
  | "payday"
  | "need-money"
  | "out-of-cash"
  | "bill-shock"
  | "love"
  | "salute"
  | "working"
  | "done"
  | "oops"
  | "remember"
  | "autopilot"
  | "morning"
  | "celebrate"
  | "thinking";
export interface TabbyChoice {
  look: TabbyLook;
  mood: TabbyMood;
  bg: "mood" | "sage";
}

export type ProfileUpdate = Partial<
  Pick<User, "full_name" | "avatar_look" | "avatar_mood" | "avatar_bg" | "tabby_reacts">
>;
/** Change your name or your Tabby. Only the fields sent change. */
export const updateProfile = (body: ProfileUpdate) =>
  apiJson<User>("/api/v1/auth/me", "PATCH", body);

/** What every way of signing in returns. */
export interface SignedIn {
  access_token: string;
  /** False until the emailed code is entered; the app shows the code screen. */
  email_verified: boolean;
  new_account: boolean;
}

export const register = async (email: string, password: string, full_name: string) => {
  const res = await apiJson<SignedIn>("/api/v1/auth/register", "POST", {
    email,
    password,
    full_name,
  });
  setToken(res.access_token);
  return res;
};

/** Login is an OAuth2 password form, not JSON — `username` carries the email. */
export const login = async (email: string, password: string) => {
  const res = await apiFetch<SignedIn>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }).toString(),
  });
  setToken(res.access_token);
  return res;
};

/** Email a code for choosing a new password (same answer for any email). */
export const forgotPassword = (email: string) =>
  apiJson<{ sent: boolean; email: string }>("/api/v1/auth/password/forgot", "POST", { email });

/** The emailed code and a new password; signs in on success. */
export const resetPassword = async (email: string, code: string, new_password: string) => {
  const res = await apiJson<SignedIn>("/api/v1/auth/password/reset", "POST", {
    email,
    code,
    new_password,
  });
  setToken(res.access_token);
  return res;
};

/** Which sign-in options the server offers, with the public ids to start them. */
export interface Providers {
  google_client_id: string | null;
  apple_client_id: string | null;
}
export const getProviders = () => apiFetch<Providers>("/api/v1/auth/providers");

/** Sign in (or up) with the ID token Google gave the page. */
export const signInWithGoogle = async (credential: string, nonce: string) => {
  const res = await apiJson<SignedIn>("/api/v1/auth/google", "POST", { credential, nonce });
  setToken(res.access_token);
  return res;
};

/** Sign in (or up) with the ID token Apple gave the page. */
export const signInWithApple = async (idToken: string, nonce: string, name = "") => {
  const res = await apiJson<SignedIn>("/api/v1/auth/apple", "POST", {
    id_token: idToken,
    nonce,
    name,
  });
  setToken(res.access_token);
  return res;
};

/** Confirm the email with the 6-digit code Tabby sent. */
export const verifyEmail = (code: string) =>
  apiJson<User>("/api/v1/auth/verify-email", "POST", { code });

/** Ask for a fresh code. `retry_after` is seconds until another may be sent. */
export const resendCode = () =>
  apiJson<{ sent: boolean; email?: string; retry_after: number; email_verified?: boolean }>(
    "/api/v1/auth/verify-email/resend",
    "POST",
    {}
  );

/** Clear the server-side cookie (best-effort) AND the tab's stored token. */
export const logout = async () => {
  try {
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
};

export const me = () => apiFetch<User>("/api/v1/auth/me");

/** Permanently close the account. The server checks the password, or for
 *  Google / Apple accounts a code from `sendDeleteCode`. */
export const deleteAccount = async (proof: { password: string } | { code: string }) => {
  await apiJson("/api/v1/auth/delete-account", "POST", proof);
  clearToken();
};

/** Email a code that confirms deleting the account. */
export const sendDeleteCode = () =>
  apiJson<{ sent: boolean; email: string; retry_after: number }>(
    "/api/v1/auth/delete-account/code",
    "POST",
    {}
  );

export interface ExportResult {
  id: string;
  status: "pending" | "ready" | "failed" | string;
  download_url?: string | null;
  expires_at?: string | null;
}

/** Build a JSON copy of everything on the account and return a download link. */
export const requestExport = () =>
  apiJson<ExportResult>("/api/v1/exports/", "POST", {}, { expectSlow: true });

export const setIntent = (intent: Intent) =>
  apiJson<User>("/api/v1/auth/set-intent", "POST", { intent });

/** Add or change your mobile number; the server tidies and checks it. */
export const setPhone = (phone: string) => apiJson<User>("/api/v1/auth/me/phone", "PUT", { phone });

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
  /** How it reached the tab. */
  source?: "photo" | "pdf" | "tap" | "email" | "screenshot" | "manual";
  /** What the person wrote about it (expenses added by hand). */
  note?: string | null;
  /** What it cost you when it's split on a tab; null when it isn't split. */
  my_share?: number | null;
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  /** The product number printed on the line (a barcode or store item number). */
  item_code?: string | null;
  /** A fee, tip, tax or discount line: shared like tax in a split, never picked. */
  charge?: boolean;
  /** A readable name for a cryptic line ("KSWTR40PK" -> "Kirkland water, 40 pack"). */
  item_name?: string | null;
  size_qty?: number | null;
  size_unit?: string | null;
}

export interface ReceiptFilters {
  q?: string;
  category?: string;
  merchant?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  min_amount?: number | string;
  max_amount?: number | string;
  sort?: string;
  order?: string;
}

/** Drop blanks so an untouched filter never appears in the URL or the query. */
export function filtersToParams(f: ReceiptFilters): URLSearchParams {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      p.set(k, String(v));
    }
  });
  return p;
}

export type ReceiptPage = { rows: Receipt[]; total: number };

/**
 * One page of receipts plus how many match in total, so the app can keep
 * loading until it has them all.
 */
export const listReceiptPage = async (
  filters: ReceiptFilters = {},
  limit = 50,
  offset = 0
): Promise<ReceiptPage> => {
  const p = filtersToParams(filters);
  p.set("limit", String(limit));
  if (offset) p.set("offset", String(offset));
  const res = await apiResponse(`/api/v1/receipts/?${p.toString()}`);
  const rows = (await res.json()) as Receipt[];
  const header = Number(res.headers.get("X-Total-Count"));
  return { rows, total: Number.isFinite(header) && header >= rows.length ? header : rows.length };
};

/** The fixed category set the backend accepts (mirrors categories.py). */
export const CATEGORIES = [
  "groceries",
  "dining",
  "drinks",
  "bars",
  "transport",
  "utilities",
  "rent",
  "entertainment",
  "health",
  "shopping",
  "travel",
  "other",
] as const;

export interface Facets {
  categories: string[];
  merchants: string[];
  statuses: string[];
}
export const getFacets = () => apiFetch<Facets>("/api/v1/receipts/facets");

export const bulkAction = (
  receipt_ids: string[],
  action: "categorize" | "delete",
  category?: string
) =>
  apiJson<{ requested: number; updated: number }>("/api/v1/receipts/bulk", "POST", {
    receipt_ids,
    action,
    category,
  });

// --- analytics -------------------------------------------------------------

export interface NamedAmount {
  name: string;
  amount: number;
  count: number;
}
export interface DashboardSummary {
  this_month: {
    start_date: string;
    end_date: string;
    receipt_count: number;
    total_spent: number;
    currency: string;
  };
  top_category: NamedAmount | null;
  top_merchant: NamedAmount | null;
  categories: NamedAmount[];
  merchants: NamedAmount[];
  monthly_trend: { month: string; amount: number }[];
  budget_health: {
    /** The name to show: "Monthly total", "Paneer"... */
    category: string;
    level: "total" | "category" | "merchant" | "item";
    period: "weekly" | "monthly" | "yearly";
    limit: number;
    spent: number;
    percent_used: number;
    over_budget: boolean;
  }[];
  budget_alerts: BudgetState[];
  pending_review: number;
}

export const getSummary = (trendMonths = 6) =>
  apiFetch<DashboardSummary>(`/api/v1/analytics/summary?trend_months=${trendMonths}`);

/** One month's total, categories and stores ("2026-09"), your share after splits. */
export interface MonthSummary {
  month: string;
  totals: DashboardSummary["this_month"];
  categories: NamedAmount[];
  merchants: NamedAmount[];
}
export const getMonth = (month: string) =>
  apiFetch<MonthSummary>(`/api/v1/analytics/month?month=${encodeURIComponent(month)}`);

// --- budgets ---------------------------------------------------------------

export type BudgetLevel = "total" | "category" | "merchant" | "item";
export type BudgetPeriod = "weekly" | "monthly" | "yearly";

/** A budget plus its evaluated state — the API always returns them together,
 *  because a budget without its progress isn't useful to render. */
export interface BudgetState {
  budget_id: string;
  label: string;
  level: BudgetLevel;
  target: string;
  period: BudgetPeriod;
  limit: number;
  spent: number;
  remaining: number;
  percent_used: number;
  over_budget: boolean;
  period_start: string;
  period_end: string;
  thresholds: number[];
  threshold_reached: number | null;
}

export interface BudgetInput {
  level: BudgetLevel;
  target: string;
  period: BudgetPeriod;
  amount: number;
  /** "80,100,120": the percentages that alert; left out keeps what's set. */
  alert_thresholds?: string;
}

export const listBudgets = () => apiFetch<BudgetState[]>("/api/v1/budgets/");
/** Receipts read but not confirmed yet, least certain first. */
export const getReviewQueue = () => apiFetch<Receipt[]>("/api/v1/receipts/review-queue");
export const createBudget = (b: BudgetInput) =>
  apiJson<{ id: string }>("/api/v1/budgets/", "POST", b);
export const updateBudget = (id: string, b: BudgetInput) =>
  apiJson<{ id: string }>(`/api/v1/budgets/${id}`, "PATCH", b);
export const deleteBudget = (id: string) => apiFetch(`/api/v1/budgets/${id}`, { method: "DELETE" });

// --- saved views -----------------------------------------------------------

export interface SavedView {
  id: string;
  name: string;
  filters: ReceiptFilters;
}
export const listSavedViews = () => apiFetch<SavedView[]>("/api/v1/saved-views/");
export const createSavedView = (name: string, filters: ReceiptFilters) =>
  apiJson<SavedView>("/api/v1/saved-views/", "POST", { name, filters });
export const deleteSavedView = (id: string) =>
  apiFetch(`/api/v1/saved-views/${id}`, { method: "DELETE" });

export const getReceipt = (id: string) => apiFetch<Receipt>(`/api/v1/receipts/${id}`);

/** How an item's price compares with earlier visits to the same store. */
export type PriceStatus = "first" | "same" | "up" | "down" | "check";
export interface PricePoint {
  receipt_id: string;
  date: string;
  price: number;
  quantity: number;
}
export interface PricedItem {
  key: string;
  line_ids: string[];
  name: string;
  code: string | null;
  size_qty: number | null;
  size_unit: string | null;
  quantity: number;
  lines: number;
  /** What one of it cost on this receipt, after any discount line. */
  price: number;
  discounted: boolean;
  status: PriceStatus;
  /** More of it than any earlier visit: a note, since a receipt can't tell why. */
  more_than_usual?: boolean;
  usual_quantity?: number;
  last_price?: number;
  last_date?: string;
  usual_price?: number;
  lowest_price?: number;
  times?: number;
  change?: number;
  history: PricePoint[];
}
export interface PriceMemory {
  receipt_id: string;
  store: string;
  currency: string;
  compared: number;
  trip_change: number | null;
  tabby: { mood: TabbyMood; text: string };
  items: PricedItem[];
}
export const getReceiptPrices = (id: string) =>
  apiFetch<PriceMemory>(`/api/v1/receipts/${id}/prices`);

/** Presigned URL for the receipt image (private bucket). 404 if none. */
export const getReceiptImage = (id: string) =>
  apiFetch<{ url: string; kind?: "photo" | "pdf" }>(`/api/v1/receipts/${id}/image`);

/** Human-in-the-loop correction; flips status to reviewed. */
export interface ReceiptReviewInput {
  merchant?: string;
  purchased_at?: string | null;
  total?: number;
  subtotal?: number;
  tax?: number;
  currency?: string;
  category?: string;
  /** `id` on lines that were already there, so split item picks stay on them. */
  line_items?: Array<Omit<LineItem, "id"> & { id?: string }>;
}
/** An expense typed in by hand: cash, a bill, anything with no receipt. */
export const addExpense = (body: {
  description: string;
  amount?: number;
  date?: string;
  category?: string;
  store?: string;
  note?: string;
  items?: Array<{ description: string; total_price: number }>;
}) => apiJson<Receipt>("/api/v1/receipts/manual", "POST", body);

/** The category a description suggests ("Dinner at Nopa": dining). */
export const guessCategory = (text: string) =>
  apiFetch<{ category: string }>(
    `/api/v1/receipts/guess-category?text=${encodeURIComponent(text)}`
  );

export const reviewReceipt = (id: string, body: ReceiptReviewInput) =>
  apiJson<Receipt>(`/api/v1/receipts/${id}/review`, "POST", body);

/** Re-run AI extraction on the stored image (resets extraction fields). */
export const retryReceipt = (id: string) =>
  apiFetch<Receipt>(`/api/v1/receipts/${id}/retry`, { method: "POST" }, { expectSlow: true });

/** Soft-delete; the receipt disappears from lists but stays in the DB. */
export const deleteReceipt = (id: string) =>
  apiFetch(`/api/v1/receipts/${id}`, { method: "DELETE" });

/** Multipart — don't set Content-Type, the browser adds the boundary. */
/** Upload returns the receipt plus any budget thresholds it just crossed. */
export interface UploadResult extends Receipt {
  budget_alerts: BudgetState[];
  /** Another receipt with the same store, total and day, if there is one. */
  possible_duplicate_of?: string | null;
  /** True when this receipt filled in an earlier Apple Pay tap. */
  matched_tap?: boolean;
}

/** Where a background read has got to (`GET /receipts/{id}/scan`). */
export interface ScanResult {
  id: string;
  /** reading → added | joined (filled an Apple Pay tap) | refused | failed */
  state: "reading" | "added" | "joined" | "refused" | "failed";
  /** The receipt now on the tab (for "joined", the tap it filled in). */
  receipt: Receipt | null;
  code: string | null;
  message: string;
  budget_alerts: BudgetState[];
  possible_duplicate_of: string | null;
}

export const getScan = (id: string) => apiFetch<ScanResult>(`/api/v1/receipts/${id}/scan`);

/** Upload one photo or PDF. `name` keeps the original extension (.pdf, .heic).
 *  Answers at once with the receipt "processing"; poll `getScan` for the result. */
export const uploadReceipt = (blob: Blob, name = "receipt.webp") => {
  const fd = new FormData();
  fd.append("file", blob, name);
  return apiFetch<UploadResult>(
    "/api/v1/receipts/upload",
    { method: "POST", body: fd },
    { expectSlow: true }
  );
};

export interface ChatProposal {
  id: string;
  tool_name: string;
  summary: string;
  /** Tabby's plan: one sentence per step, in the order they'll run. */
  steps?: string[];
  payload: Record<string, unknown>;
  status: string;
  expires_at: string;
}

/** A button under Tabby's reply: a page to open, or a file to download. */
export interface ChatLink {
  label: string;
  href: string;
  /** Set for downloads (an API path fetched with the person's sign-in). */
  filename?: string;
}

/** One event from the chat stream (one JSON object per line). */
export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "proposal"; proposal: ChatProposal }
  /** Tabby needs a detail before acting: short answers to tap. */
  | { type: "choices"; options: string[] }
  /** Buttons to pages or downloads. */
  | { type: "links"; links: ChatLink[] }
  /** Something Tabby did at once (remembering), with its undo id. */
  | { type: "done_now"; summary: string; run_id: string }
  | { type: "done"; session_id: string };

/** Split streamed text into whole lines, holding a partial line until it ends. */
export function lineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) onLine(line);
        at = buffer.indexOf("\n");
      }
    },
    end() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = "";
    },
  };
}

/**
 * Ask a question and receive the answer as it is written. `onEvent` gets
 * each status, piece of text, proposal and the final "done".
 */
export async function streamChat(
  message: string,
  session_id: string | null,
  context: Record<string, unknown>,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await apiResponse(
    "/api/v1/chat/stream",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id, context }),
      signal,
    },
    { expectSlow: true }
  );
  const lines = lineSplitter((line) => {
    try {
      onEvent(JSON.parse(line) as ChatEvent);
    } catch {
      // A malformed line is skipped rather than ending the answer.
    }
  });
  const reader = res.body?.getReader();
  if (!reader) {
    lines.push(await res.text());
    lines.end();
    return;
  }
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    lines.push(decoder.decode(value, { stream: true }));
  }
  lines.end();
}
export interface PlanResult {
  run_id?: string;
  steps?: Array<{ summary: string; open?: string | null; undoable: boolean }>;
  open?: string | null;
  undoable?: boolean;
  [key: string]: unknown;
}
export const confirmChatProposal = (id: string) =>
  apiFetch<{ status: string; result: PlanResult }>(
    `/api/v1/chat/proposals/${id}/confirm`,
    { method: "POST" },
    { expectSlow: true }
  );
export const cancelChatProposal = (id: string) =>
  apiFetch<{ status: string }>(`/api/v1/chat/proposals/${id}/cancel`, { method: "POST" });

export interface Insight {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  severity: string;
  observed_at: string;
}
export const listInsights = () => apiFetch<Insight[]>("/api/v1/insights");
export const dismissInsight = (id: string) =>
  apiFetch(`/api/v1/insights/${id}/dismiss`, { method: "POST" });

// --- splits ----------------------------------------------------------------

export interface SplitMemberInput {
  name: string;
  email?: string;
  /** Their mobile number, typed any way; the server tidies and checks it. */
  phone?: string;
  /** Picked from your people: that exact person (a `Person.ref`). */
  from_member?: string;
}
/** Where someone on a tab stands with Cotab. */
export type MemberStatus = "joined" | "not_on_cotab" | "no_phone";
export interface SplitGroup {
  id: string;
  name: string;
  share_code: string;
  share_url: string;
  members: Array<{
    id: string;
    name: string;
    email?: string | null;
    joined?: boolean;
    status?: MemberStatus;
    /** "+14155550123"; only the tab's owner gets it. */
    phone?: string | null;
    /** Which Cotab account this is, once known. */
    account?: string | null;
  }>;
  /** False when someone else made this tab and you joined it from their link. */
  is_owner?: boolean;
  /** "direct" for splitting straight with people, no group name. */
  kind?: "group" | "direct";
}
export type PayMethod = "venmo" | "paypal" | "cashapp" | "zelle";
export type PayHandles = Partial<Record<PayMethod, string>>;
export interface PayLink {
  method: PayMethod;
  label: string;
  /** Opens the payment app with the amount filled in. Zelle has none. */
  url: string | null;
  /** Zelle only: the email or phone to pay. */
  copy?: string;
}
export interface SplitSummaryMember {
  id: string;
  name: string;
  email?: string | null;
  joined?: boolean;
  pay_methods?: PayMethod[];
  /** True for people without an account, whose handles the tab keeps. */
  own_handles?: boolean;
  handles?: PayHandles;
  /** The Tabby a member with an account picked for themselves. */
  avatar?: TabbyChoice | null;
  /** They use Cotab with notifications on, so a reminder can reach their phone. */
  notify?: boolean;
  status?: MemberStatus;
  /** "+14155550123"; only the tab's owner gets it. */
  phone?: string | null;
  /** Which Cotab account this is, once known. */
  account?: string | null;
}
export interface Settlement {
  id: string;
  from: string;
  to: string;
  amount: number;
  /** What it was paid in; older servers leave it out (the tab's currency). */
  currency?: string;
  method: string;
  created_at: string | null;
}
export interface SplitSummary {
  group_id: string;
  group_name: string;
  kind?: "group" | "direct";
  share_code: string;
  currency?: string;
  is_owner?: boolean;
  /** Your member id on this tab, when you're on it. */
  me?: string | null;
  members: SplitSummaryMember[];
  member_count: number;
  /** In the tab's main currency; totals has every currency on the tab. */
  total_spend: number;
  totals?: Array<{ currency: string; amount: number }>;
  splits: Array<{
    split_id: string;
    receipt_id: string;
    merchant: string;
    purchased_at: string | null;
    currency: string;
    total: number;
    mode: string;
    tax_mode: string;
    paid_by: string;
    /** Exact, percent and shares splits: what was typed, by person. */
    parts?: Record<string, number>;
    /** You added it, so you can change it. */
    mine?: boolean;
    /** Itemized splits: person -> the receipt line ids they had. */
    items?: Record<string, string[]>;
    shares: Array<{ member: string; amount: number; settled: boolean }>;
  }>;
  suggested_settlements: Array<{
    from: string;
    to: string;
    from_id?: string;
    to_id?: string;
    amount: number;
    /** Each currency is settled on its own, never added to another. */
    currency?: string;
    pay_links?: PayLink[];
    /** When you last reminded them (only on rows where they owe you). */
    last_reminded_at?: string | null;
  }>;
  settlements?: Settlement[];
}
export interface SplitPreview {
  /** Missing while exact or percent amounts don't add up yet. */
  shares?: Record<string, number>;
  /** Why there are no numbers yet, e.g. "These add up to $2.43; $7.57 is left to assign." */
  message?: string;
  total: number;
  items_total: number;
  /** Tax, tip, fees or discounts: the total minus the item lines. */
  extra: number;
  currency: string;
}

export type SplitMode = "even" | "itemized" | "exact" | "percent" | "shares";
export interface SplitSuggestions {
  contacts: Array<{ name: string; email?: string | null; split_count: number }>;
  merchant: string;
  merchant_history_count: number;
  suggested_people: Array<{ name: string; email?: string | null; split_count: number }>;
  assignments: Record<string, string[]>;
  confidence: number;
  auto_apply: boolean;
}
export interface NetBalance {
  person: string;
  email?: string | null;
  /** One row per person and currency. */
  currency?: string;
  net: number;
  direction: "owes_you" | "you_owe" | "settled";
  amount: number;
}

export const createSplitGroup = (body: {
  name: string;
  my_name: string;
  members: SplitMemberInput[];
}) => apiJson<SplitGroup>("/api/v1/splits/groups", "POST", body);
export const listSplitGroups = () => apiFetch<SplitGroup[]>("/api/v1/splits/groups");
/** The tab for splitting straight with these people; the same people always
 *  get the same tab, so the balance keeps one running total. */
export const createDirectSplit = (body: { my_name: string; members: SplitMemberInput[] }) =>
  apiJson<SplitGroup>("/api/v1/splits/direct", "POST", body);
export const addReceiptSplit = (
  groupId: string,
  body: {
    receipt_id: string;
    paid_by: string;
    mode: SplitMode;
    tax_mode: "pro_rata" | "even" | "payer";
    assignments?: Record<string, string[]>;
    /** Dollars, percent or shares per person (exact, percent, shares modes). */
    parts?: Record<string, number>;
    /** Redo this receipt's split on this tab. */
    replace?: boolean;
  }
) =>
  apiJson<{ split_id: string; shares: Record<string, number> }>(
    `/api/v1/splits/groups/${groupId}/splits`,
    "POST",
    body
  );
export const getSplitSummary = (groupId: string) =>
  apiFetch<SplitSummary>(`/api/v1/splits/groups/${groupId}/summary`);
export const getSplitSuggestions = (receiptId: string) =>
  apiFetch<SplitSuggestions>(`/api/v1/splits/suggestions/${receiptId}`);
export const getNetBalances = () => apiFetch<NetBalance[]>("/api/v1/splits/net-balances");
export const previewSplit = (body: {
  receipt_id: string;
  members: string[];
  paid_by: string;
  mode: SplitMode;
  tax_mode: "pro_rata" | "even" | "payer";
  assignments?: Record<string, string[]>;
  parts?: Record<string, number>;
}) => apiJson<SplitPreview>("/api/v1/splits/preview", "POST", body);
export const addGroupMember = (
  groupId: string,
  body: { name: string; email?: string; phone?: string; from_member?: string }
) => apiJson<SplitGroup>(`/api/v1/splits/groups/${groupId}/members`, "POST", body);
/** Someone you've split with before, for the "Add someone" list. */
export interface Person {
  /** Send as `from_member` to add this exact person. */
  ref: string;
  /** Their Cotab account: two Bens with different numbers are two accounts. */
  account: string;
  name: string;
  /** The number you typed in for them, if you did. */
  phone: string | null;
  /** "•••0199": the end of their own number, when they joined with an account. */
  hint: string | null;
  on_cotab: boolean;
  /** How many of your tabs they're on. */
  tabs: number;
}
export const myPeople = () => apiFetch<Person[]>("/api/v1/splits/people");
export interface NumberCheck {
  /** Whichever was looked up, tidied. */
  phone: string | null;
  email: string | null;
  you: boolean;
  on_cotab: boolean;
  /** The name they signed up with. */
  name: string | null;
  account: string | null;
}
/** Who a mobile number or email is on Cotab, once it's complete. */
export const checkNumber = (q: string) =>
  apiFetch<NumberCheck>(`/api/v1/splits/lookup?q=${encodeURIComponent(q)}`);
/** What someone is called on your tab, e.g. "Ben Carter" when another Ben
 *  joins (the tab's owner only). Who they are doesn't change. */
export const renameMember = (groupId: string, memberId: string, name: string) =>
  apiJson<SplitGroup>(`/api/v1/splits/groups/${groupId}/members/${memberId}/name`, "PUT", {
    name,
  });
/** Add or change the number of someone on your tab (the tab's owner only). */
export const setMemberPhone = (groupId: string, memberId: string, phone: string) =>
  apiJson<SplitGroup>(`/api/v1/splits/groups/${groupId}/members/${memberId}/phone`, "PUT", {
    phone,
  });
export const setMemberPayHandles = (groupId: string, memberId: string, body: PayHandles) =>
  apiJson<PayHandles>(
    `/api/v1/splits/groups/${groupId}/members/${memberId}/pay-handles`,
    "PUT",
    body
  );
export const recordSettlement = (
  groupId: string,
  body: {
    from_member_id: string;
    to_member_id: string;
    amount: number;
    method: string;
    currency?: string;
  }
) => apiJson<SplitSummary>(`/api/v1/splits/groups/${groupId}/settlements`, "POST", body);
export const undoSettlement = (groupId: string, settlementId: string) =>
  apiFetch<SplitSummary>(`/api/v1/splits/groups/${groupId}/settlements/${settlementId}`, {
    method: "DELETE",
  });
export const removeSplit = (groupId: string, splitId: string) =>
  apiFetch<SplitSummary>(`/api/v1/splits/groups/${groupId}/splits/${splitId}`, {
    method: "DELETE",
  });
export const joinTab = (shareCode: string, memberId?: string) =>
  apiJson<{ group_id: string; member_id: string | null }>(
    `/api/v1/splits/join/${shareCode}`,
    "POST",
    { member_id: memberId ?? null }
  );
export const getMyPayHandles = () => apiFetch<PayHandles>("/api/v1/auth/me/pay-handles");
export const saveMyPayHandles = (body: PayHandles) =>
  apiJson<PayHandles>("/api/v1/auth/me/pay-handles", "PUT", body);
export const getPublicSplit = async (shareCode: string) => {
  const response = await fetch(`${API}/api/v1/splits/share/${shareCode}`);
  if (!response.ok) {
    const err = await parseError(response);
    throw new ApiError(response.status, err.message, err.code, err.extra);
  }
  return (await response.json()) as SplitSummary;
};

// --- Apple Pay taps ---------------------------------------------------------

export interface CaptureKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}
export interface CaptureStatus {
  keys: CaptureKey[];
  last_tap_at: string | null;
  taps_this_month: number;
}

/** Where the iPhone shortcut sends each tap. */
export const TAP_URL = `${API}/api/v1/capture/tap`;

export const getCaptureStatus = () => apiFetch<CaptureStatus>("/api/v1/capture/status");
/** The plain key comes back once, here, and is never shown again. */
export const createCaptureKey = (name: string) =>
  apiJson<CaptureKey & { key: string }>("/api/v1/capture/keys", "POST", { name });
export const revokeCaptureKey = (id: string) =>
  apiFetch(`/api/v1/capture/keys/${id}`, { method: "DELETE" });

// --- Email forwarding ---------------------------------------------------------

export interface InboxEmail {
  id: string;
  subject: string;
  from_address: string;
  /** queued | added | matched | skipped | ignored | failed */
  status: string;
  reason: string;
  receipt_id: string | null;
  created_at: string;
}
export interface Inbox {
  /** False until the server is connected to the email service. */
  enabled: boolean;
  address: string | null;
  account_email: string;
  senders: { id: string; email: string }[];
  recent: InboxEmail[];
}

export const getInbox = () => apiFetch<Inbox>("/api/v1/inbox");
export const addInboxSender = (email: string) =>
  apiJson<Inbox>("/api/v1/inbox/senders", "POST", { email });
export const removeInboxSender = (id: string) =>
  apiFetch<Inbox>(`/api/v1/inbox/senders/${id}`, { method: "DELETE" });
export const newInboxAddress = () => apiJson<Inbox>("/api/v1/inbox/new-address", "POST", {});

// ---------------------------------------------------------------------------
// Tabby's page: what it did, what it remembers, its rules, the wrap-up
// ---------------------------------------------------------------------------

export interface TabbyRun {
  run_id: string;
  at: string | null;
  source: "chat" | "rule";
  status: "done" | "undone";
  undoable: boolean;
  steps: Array<{
    position: number;
    summary: string;
    status: "done" | "undone";
    open: string | null;
    undoable: boolean;
  }>;
}
export interface TabbyMemory {
  id: string;
  text: string;
  kind: string;
  at: string | null;
}
export interface TabbyRule {
  id: string;
  summary: string;
  active: boolean;
  action: "split" | "categorize";
  store: string | null;
  category: string | null;
  run_count: number;
  last_run_at: string | null;
}
export interface MonthWrap {
  month: string;
  label: string;
  currency: string;
  total: number;
  receipts: number;
  previous: number;
  change: number | null;
  top_category: { name: string; amount: number } | null;
  top_store: { name: string; visits: number } | null;
  categories: Array<{ name: string; amount: number }>;
  budgets: number;
  budgets_kept: number;
  splits: number;
  settled: number;
  tabby_tasks: number;
}

export const tabbyActivity = () => apiFetch<TabbyRun[]>("/api/v1/tabby/activity");
export const undoTabbyRun = (runId: string) =>
  apiFetch<{ run_id: string; undone: number }>(`/api/v1/tabby/runs/${runId}/undo`, {
    method: "POST",
  });
export const tabbyMemories = () => apiFetch<TabbyMemory[]>("/api/v1/tabby/memories");
export const addTabbyMemory = (text: string) =>
  apiJson<TabbyMemory>("/api/v1/tabby/memories", "POST", { text });
export const deleteTabbyMemory = (id: string) =>
  apiFetch(`/api/v1/tabby/memories/${id}`, { method: "DELETE" });
export const tabbyRules = () => apiFetch<TabbyRule[]>("/api/v1/tabby/rules");
export const setTabbyRule = (id: string, active: boolean) =>
  apiJson<TabbyRule>(`/api/v1/tabby/rules/${id}`, "PATCH", { active });
export const deleteTabbyRule = (id: string) =>
  apiFetch(`/api/v1/tabby/rules/${id}`, { method: "DELETE" });
export const monthWrap = (month?: string) =>
  apiFetch<MonthWrap>(`/api/v1/tabby/wrap${month ? `?month=${encodeURIComponent(month)}` : ""}`);

/** Download a file from the API with the person's sign-in, then save it. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await apiResponse(`/api/v1${path}`, {}, { expectSlow: true });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Remind someone on a tab what they owe you: "push" sends a notification to
 * their phone that opens the tab; "message" notes that you sent one yourself.
 */
export const remindFriend = (
  groupId: string,
  body: { member_id: string; channel: "push" | "message" }
) => apiJson<SplitSummary>(`/api/v1/splits/groups/${groupId}/remind`, "POST", body);
