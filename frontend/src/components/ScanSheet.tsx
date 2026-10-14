"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { buttonClass } from "@/components/ui";
import { deleteReceipt } from "@/lib/api";
import { invalidateSpending } from "@/lib/data";
import { routes } from "@/lib/routes";
import {
  clearFinished,
  getItems,
  isFinished,
  MAX_BATCH,
  remove,
  retry,
  sendAnyway,
  subscribe,
  type ScanItem,
} from "@/lib/scanQueue";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons = {
  camera: (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  photos: (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </svg>
  ),
  file: (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13h6M9 17h6" />
    </svg>
  ),
};

/** Shared queue state, re-rendered whenever an item moves on. */
export function useScanItems() {
  return useSyncExternalStore(subscribe, getItems, getItems);
}

type Picker = "camera" | "photos" | "files";

/**
 * Hidden file inputs for the three ways in. Kept outside the sheet so the
 * Scan button can open the camera directly, and "Retake" works after the
 * sheet has closed.
 */
export function useScanPickers(onPicked: (files: File[]) => void) {
  const refs = {
    camera: useRef<HTMLInputElement>(null),
    photos: useRef<HTMLInputElement>(null),
    files: useRef<HTMLInputElement>(null),
  };
  const open = (which: Picker) => refs[which].current?.click();
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // picking the same photo again should still fire
    if (files.length) onPicked(files);
  };
  const inputs = (
    <>
      {/* Camera: one photo, straight from the back camera on phones. */}
      <input
        ref={refs.camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-camera"
      />
      {/* Photo library: several at once. */}
      <input
        ref={refs.photos}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-photos"
      />
      {/* Files: the system picker, which also reaches iCloud Drive, Google
          Drive, Dropbox and OneDrive when their apps are installed. */}
      <input
        ref={refs.files}
        type="file"
        accept="image/*,application/pdf,.pdf,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-files"
      />
    </>
  );
  return { open, inputs };
}

function Source({
  icon,
  title,
  sub,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-16 w-full items-center gap-4 rounded-card px-4 py-3 text-left ring-ink transition hover:ring-1 ${tone}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-button bg-paper/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm">{sub}</span>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

function statusLine(item: ScanItem): string {
  switch (item.status) {
    case "checking":
      return "Checking the photo…";
    case "waiting":
      return "Waiting to upload…";
    case "reading":
      return item.uploaded ? "Saved. Reading every line…" : "Uploading…";
    default:
      return item.message ?? "";
  }
}

const rowTone: Record<ScanItem["status"], string> = {
  checking: "bg-card",
  waiting: "bg-card",
  reading: "bg-card",
  needs_ok: "bg-gold/40",
  added: "bg-mint/70",
  refused: "bg-blush/70",
  duplicate: "bg-gold/40",
  error: "bg-blush/70",
};

function Row({
  item,
  onRetake,
  onChoose,
}: {
  item: ScanItem;
  onRetake: () => void;
  onChoose: () => void;
}) {
  const busy = item.status === "checking" || item.status === "waiting" || item.status === "reading";
  const [removing, setRemoving] = useState(false);

  async function removeDuplicate() {
    if (!item.receiptId) return;
    setRemoving(true);
    try {
      await deleteReceipt(item.receiptId);
      invalidateSpending();
      remove(item.id);
    } catch {
      setRemoving(false);
    }
  }

  const action = "min-h-10 rounded-button px-3 text-sm font-semibold";
  return (
    <li className={`rise flex gap-3 rounded-card p-3 ${rowTone[item.status]}`}>
      <span className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded border border-line bg-paper">
        {item.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-mono text-[10px] font-medium">PDF</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {item.title ?? (item.kind === "pdf" ? item.name : "Receipt photo")}
        </p>
        <p className={`text-sm ${busy ? "text-muted" : ""}`} aria-live="polite">
          {busy && (
            <span
              aria-hidden="true"
              className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-ink align-middle"
            />
          )}
          {statusLine(item)}
        </p>

        {item.status === "added" && item.possibleDuplicateOf && (
          <p className="mt-1 text-sm">
            It looks like one you already added: same store, total and day.
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          {item.status === "needs_ok" && (
            <>
              <button type="button" onClick={onRetake} className={`${action} bg-ink text-paper`}>
                Retake
              </button>
              <button type="button" onClick={onChoose} className={`${action} border border-ink`}>
                Choose another
              </button>
              <button
                type="button"
                onClick={() => sendAnyway(item.id)}
                className={`${action} underline underline-offset-4`}
              >
                Use it anyway
              </button>
            </>
          )}
          {item.status === "refused" && (
            <>
              <button type="button" onClick={onRetake} className={`${action} bg-ink text-paper`}>
                Try again
              </button>
              <button type="button" onClick={onChoose} className={`${action} border border-ink`}>
                Choose a photo
              </button>
            </>
          )}
          {item.status === "error" && (
            <button
              type="button"
              onClick={() => retry(item.id)}
              className={`${action} bg-ink text-paper`}
            >
              Try again
            </button>
          )}
          {item.receiptId && (item.status === "added" || item.status === "duplicate") && (
            <Link
              href={routes.receipt(item.receiptId)}
              className={`${action} inline-flex items-center border border-ink`}
            >
              {item.status === "duplicate" ? "Open it" : "Open"}
            </Link>
          )}
          {item.status === "added" && item.possibleDuplicateOf && (
            <>
              <Link
                href={routes.receipt(item.possibleDuplicateOf)}
                className={`${action} inline-flex items-center border border-ink`}
              >
                See the other one
              </Link>
              <button
                type="button"
                disabled={removing}
                onClick={removeDuplicate}
                className={`${action} text-rose underline underline-offset-4`}
              >
                {removing ? "Removing…" : "Remove this one"}
              </button>
            </>
          )}
        </div>
      </div>
      {!busy && (
        <button
          type="button"
          onClick={() => remove(item.id)}
          aria-label={`Dismiss ${item.title ?? "item"}`}
          className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg hover:bg-ink/10"
        >
          ×
        </button>
      )}
    </li>
  );
}

/**
 * The scanner: three ways to add receipts, then a live list of what happened
 * to each one. Opens as a sheet from the bottom on phones, a dialog on wider
 * screens.
 */
export function ScanSheet({
  open,
  onClose,
  pick,
  onPicked,
}: {
  open: boolean;
  onClose: () => void;
  pick: (which: Picker) => void;
  onPicked: (files: File[]) => void;
}) {
  const items = useScanItems();
  const dialog = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const finished = items.filter((i) => isFinished(i.status)).length;
  const retakeFor = (id: string) => () => {
    remove(id);
    pick("camera");
  };
  const chooseFor = (id: string) => () => {
    remove(id);
    pick("photos");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        className={`sheet flex max-h-[88vh] outline-none w-full flex-col rounded-t-2xl border-t border-ink bg-paper md:max-w-lg md:rounded-2xl md:border ${
          dragging ? "ring-4 ring-gold" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onPicked(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id="scan-title" className="font-display text-2xl">
            Add receipts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-ink/10"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6">
          <div className="flex flex-col gap-2">
            <Source
              icon={icons.camera}
              title="Take a photo"
              sub="Flat, well lit, the whole receipt in frame"
              tone="bg-gold"
              onClick={() => pick("camera")}
            />
            <Source
              icon={icons.photos}
              title="Choose from Photos"
              sub={`Pick up to ${MAX_BATCH} receipts at once`}
              tone="bg-mint"
              onClick={() => pick("photos")}
            />
            <Source
              icon={icons.file}
              title="Upload a file"
              sub="PDFs and photos from Files, iCloud Drive or Google Drive"
              tone="bg-blush"
              onClick={() => pick("files")}
            />
          </div>
          <p className="mt-3 hidden rounded-card border border-dashed border-line px-4 py-3 text-center text-sm text-muted md:block">
            Or drop photos and PDFs here
          </p>

          {items.length > 0 && (
            <section aria-label="Your scans" className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-bold">
                  {finished < items.length
                    ? `Working on ${items.length - finished} of ${items.length}`
                    : "Done"}
                </h3>
                {finished > 0 && (
                  <button
                    type="button"
                    onClick={clearFinished}
                    className="min-h-9 text-sm font-semibold underline underline-offset-4"
                  >
                    Clear finished
                  </button>
                )}
              </div>
              {items.some((i) => i.status === "reading" && i.uploaded) && (
                <p className="mb-2 text-sm text-muted">
                  You can close this. Cotab keeps reading, and each receipt fills in on your tab.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    onRetake={retakeFor(item.id)}
                    onChoose={chooseFor(item.id)}
                  />
                ))}
              </ul>
            </section>
          )}

          {items.length === 0 && (
            <button type="button" onClick={onClose} className={`${buttonClass.quiet} mt-4 w-full`}>
              Not now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
