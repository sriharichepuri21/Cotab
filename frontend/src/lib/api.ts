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
  full_name: string;
  timezone: string;
  intent: Intent | null;
}

export const register = async (email: string, password: string, full_name: string) => {
  const res = await apiJson<{ access_token: string }>("/api/v1/auth/register", "POST", {
    email,
    password,
    full_name,
  });
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

/** Permanently close the account. The server checks the password first. */
export const deleteAccount = async (password: string) => {
  await apiJson("/api/v1/auth/delete-account", "POST", { password });
  clearToken();
};

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
  source?: "photo" | "pdf" | "tap" | "email";
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
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
    category: string;
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
}

export const listBudgets = () => apiFetch<BudgetState[]>("/api/v1/budgets/");
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
  line_items?: Omit<LineItem, "id">[];
}
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
  payload: Record<string, unknown>;
  status: string;
  expires_at: string;
}

/** One event from the chat stream (one JSON object per line). */
export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "proposal"; proposal: ChatProposal }
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
export const confirmChatProposal = (id: string) =>
  apiFetch<{ status: string; result: Record<string, unknown> }>(
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
}
export interface SplitGroup {
  id: string;
  name: string;
  share_code: string;
  share_url: string;
  members: Array<{ id: string; name: string; email?: string | null }>;
}
export interface SplitSummary {
  group_id: string;
  group_name: string;
  share_code: string;
  members: Array<{ id: string; name: string; email?: string | null }>;
  member_count: number;
  total_spend: number;
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
    shares: Array<{ member: string; amount: number; settled: boolean }>;
  }>;
  suggested_settlements: Array<{ from: string; to: string; amount: number }>;
}
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
export const addReceiptSplit = (
  groupId: string,
  body: {
    receipt_id: string;
    paid_by: string;
    mode: "even" | "itemized";
    tax_mode: "pro_rata" | "even" | "payer";
    assignments?: Record<string, string[]>;
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
