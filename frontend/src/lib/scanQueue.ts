"use client";

/**
 * Everything the scanner is working on, from the moment photos are picked to
 * the moment each one is on the tab (or refused, with the reason).
 *
 * One queue for the whole app, so scanning keeps going while the person moves
 * between tabs. Each item goes:
 *
 *   checking ─▶ needs_ok ─(Use it anyway)─▶ waiting ─▶ reading ─▶ added
 *       │                                        ▲          ├──▶ refused    (not a receipt, unreadable)
 *       └──────────── looks fine ────────────────┘          ├──▶ duplicate  (already on the tab)
 *                                                           └──▶ error      (network or server; can retry)
 *
 * "reading" covers both the upload and the server's read. The upload answers
 * in a moment with the receipt saved; the server then reads it in the
 * background while this polls for the outcome, so the upload slot is free for
 * the next photo straight away.
 */

import { ApiError, getScan, type ScanResult, uploadReceipt, type UploadResult } from "@/lib/api";
import { checkPhoto, QUALITY_MESSAGES, type QualityIssue } from "@/lib/scanQuality";
import { compressImage, UPLOADED_EVENT } from "@/lib/upload";

/** Any page can open the scanner by dispatching this on `window`. */
export const OPEN_SCANNER_EVENT = "rw:scan";

/** Photos per batch, as decided for the product: enough for a shopping trip. */
export const MAX_BATCH = 20;
/** Uploads in flight at once. Two keeps phones responsive on cellular. */
const PARALLEL = 2;
/** How often to ask how a background read is going, and for how long. */
const POLL_MS = [800, 1200, 1500, 2000];
const POLL_FOR_MS = 3 * 60 * 1000;
/** Files the server accepts unchanged (PDFs, and photos the browser can't shrink). */
const MAX_RAW_BYTES = 5 * 1024 * 1024;

export type ScanStatus =
  | "checking"
  | "needs_ok"
  | "waiting"
  | "reading"
  | "added"
  | "refused"
  | "duplicate"
  | "error";

export type ScanItem = {
  id: string;
  name: string;
  kind: "photo" | "pdf";
  /** Small preview for photos the browser can show. */
  preview?: string;
  status: ScanStatus;
  /** The quality problem found on the phone, while waiting for a decision. */
  issue?: QualityIssue;
  /** What to tell the person about this item, when there's something to say. */
  title?: string;
  message?: string;
  /** The receipt this became, or the one it duplicates. */
  receiptId?: string;
  result?: UploadResult;
  /** Set when another receipt looks like the same purchase. */
  possibleDuplicateOf?: string | null;
  /** Uploaded; the server is reading it. */
  uploaded?: boolean;
  file: File;
};

type State = { items: ScanItem[] };

let state: State = { items: [] };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}

function update(id: string, patch: Partial<ScanItem>) {
  set({ items: state.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getItems(): ScanItem[] {
  return state.items;
}

const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Some pickers hand over HEIC or PDF files with no type; trust the extension then. */
export function typeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? "";
}

export function isAccepted(file: File): boolean {
  const t = typeOf(file);
  return t === "application/pdf" || t.startsWith("image/");
}

let counter = 0;

/**
 * Add picked or captured files. Returns how many were taken and how many were
 * left out because the batch is full or the file isn't a photo or PDF.
 */
export function addFiles(files: File[]): { added: number; tooMany: number; unsupported: number } {
  const usable = files.filter(isAccepted);
  const unsupported = files.length - usable.length;
  const active = state.items.filter((i) => !isFinished(i.status)).length;
  const room = Math.max(0, MAX_BATCH - active);
  const taking = usable.slice(0, room);
  const fresh: ScanItem[] = taking.map((file) => {
    const pdf = typeOf(file) === "application/pdf";
    return {
      id: `scan-${Date.now()}-${counter++}`,
      name: file.name || (pdf ? "Receipt.pdf" : "Photo"),
      kind: pdf ? "pdf" : "photo",
      preview: pdf ? undefined : URL.createObjectURL(file),
      status: "checking",
      file,
    };
  });
  set({ items: [...state.items, ...fresh] });
  fresh.forEach((item) => void check(item));
  return { added: fresh.length, tooMany: usable.length - taking.length, unsupported };
}

export function isFinished(s: ScanStatus) {
  return s === "added" || s === "refused" || s === "duplicate" || s === "error";
}

async function check(item: ScanItem) {
  const report = item.kind === "photo" ? await checkPhoto(item.file).catch(() => null) : null;
  if (report?.issue) {
    const copy = QUALITY_MESSAGES[report.issue];
    update(item.id, {
      status: "needs_ok",
      issue: report.issue,
      title: copy.title,
      message: copy.body,
    });
    return;
  }
  update(item.id, { status: "waiting" });
  pump();
}

/** The person has seen the warning and wants to send it anyway. */
export function sendAnyway(id: string) {
  update(id, { status: "waiting", issue: undefined, title: undefined, message: undefined });
  pump();
}

export function retry(id: string) {
  update(id, { status: "waiting", title: undefined, message: undefined });
  pump();
}

export function remove(id: string) {
  const item = state.items.find((i) => i.id === id);
  if (item?.preview) URL.revokeObjectURL(item.preview);
  set({ items: state.items.filter((i) => i.id !== id) });
}

/** Clear everything that is done, keeping anything still in progress. */
export function clearFinished() {
  state.items
    .filter((i) => isFinished(i.status))
    .forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
  set({ items: state.items.filter((i) => !isFinished(i.status)) });
}

let running = 0;

function pump() {
  while (running < PARALLEL) {
    const next = state.items.find((i) => i.status === "waiting");
    if (!next) return;
    running++;
    update(next.id, { status: "reading" });
    void send(next).finally(() => {
      running--;
      pump();
    });
  }
}

/** Shrink photos the browser can decode; send PDFs and HEIC as they are. */
async function prepare(file: File): Promise<{ blob: Blob; name: string }> {
  const type = typeOf(file);
  if (type !== "application/pdf") {
    try {
      return { blob: await compressImage(file), name: "receipt.webp" };
    } catch {
      // HEIC in browsers that can't decode it: the server can.
    }
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new ApiError(
      413,
      "This file is over 5 MB. Try a smaller photo or a shorter PDF.",
      "too_large"
    );
  }
  const blob = file.type ? file : new Blob([file], { type });
  return { blob, name: file.name || (type === "application/pdf" ? "receipt.pdf" : "receipt") };
}

function announce(result: UploadResult) {
  window.dispatchEvent(new CustomEvent<UploadResult>(UPLOADED_EVENT, { detail: result }));
}

/** Show a finished read on the item, and tell the app (refreshes the tab, budget alerts). */
function finish(item: ScanItem, result: UploadResult) {
  const failed = result.status === "failed";
  update(item.id, {
    status: "added",
    uploaded: false,
    result,
    receiptId: result.id,
    possibleDuplicateOf: result.possible_duplicate_of ?? null,
    title: failed
      ? "Saved, but not read yet"
      : result.matched_tap
        ? `Joined to your Apple Pay tap at ${result.merchant || "this store"}`
        : `${result.merchant || "Receipt"} is on your tab`,
    message: failed
      ? result.error_message ||
        "Cotab couldn't reach its reader just now. Open it later and tap Read it again."
      : undefined,
  });
  announce(result);
}

function refuse(item: ScanItem, code: string | null | undefined, message: string) {
  update(item.id, {
    status: "refused",
    uploaded: false,
    title: code === "not_a_receipt" ? "Not a receipt" : "Couldn't read this one",
    message,
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask how the server's read is going until it's done. Runs on its own, so
 *  the next photo can upload meanwhile. */
async function follow(item: ScanItem, receiptId: string) {
  const started = Date.now();
  for (let i = 0; Date.now() - started < POLL_FOR_MS; i++) {
    await wait(POLL_MS[Math.min(i, POLL_MS.length - 1)]);
    if (!state.items.some((it) => it.id === item.id)) return; // removed
    let scan: ScanResult;
    try {
      scan = await getScan(receiptId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return;
      continue; // a blip on the network: keep asking
    }
    if (scan.state === "reading") continue;
    if (scan.state === "refused") {
      refuse(item, scan.code, scan.message);
      announce({ id: receiptId, status: "rejected" } as UploadResult);
      return;
    }
    if (scan.receipt) {
      finish(item, {
        ...scan.receipt,
        budget_alerts: scan.budget_alerts,
        possible_duplicate_of: scan.possible_duplicate_of,
        matched_tap: scan.state === "joined",
      });
    }
    return;
  }
  update(item.id, {
    status: "added",
    uploaded: false,
    title: "Still reading",
    message: "It's saved and will appear on your tab when it's done.",
  });
}

async function send(item: ScanItem) {
  try {
    const { blob, name } = await prepare(item.file);
    const result = await uploadReceipt(blob, name);
    if (result.status === "processing") {
      update(item.id, { uploaded: true, receiptId: result.id });
      announce(result); // it's on the tab now, as "Reading…"
      void follow(item, result.id);
      return;
    }
    finish(item, result);
  } catch (e) {
    const err = e instanceof ApiError ? e : null;
    if (err?.status === 401) return; // the app shell sends them to sign in
    if (err?.code === "duplicate") {
      update(item.id, {
        status: "duplicate",
        title: "Already on your tab",
        message: "You've added this exact receipt before.",
        receiptId: typeof err.extra.receipt_id === "string" ? err.extra.receipt_id : undefined,
      });
    } else if (err && err.status >= 400 && err.status < 500 && err.status !== 429) {
      refuse(item, err.code, err.message);
    } else {
      update(item.id, {
        status: "error",
        title: "Didn't upload",
        message:
          err?.status === 429
            ? "That's a lot of scans in an hour. Try again a little later."
            : "Check your connection and try again.",
      });
    }
  }
}

/** For tests: start from an empty queue. */
export function resetQueue() {
  state.items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
  running = 0;
  set({ items: [] });
}
