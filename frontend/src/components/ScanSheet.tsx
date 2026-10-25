"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { openAddExpense } from "@/components/AddExpenseSheet";
import { buttonClass, Icon } from "@/components/ui";
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
  camera: <Icon name="photo_camera" fill size={24} />,
  photos: <Icon name="photo_library" fill size={24} />,
  file: <Icon name="upload_file" fill size={24} />,
  hand: <Icon name="edit_note" fill size={24} />,
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
      className="press flex min-h-[72px] w-full items-center gap-3.5 rounded-card bg-card px-4 py-3 text-left shadow-[0_0_0_1px_rgb(12_17_14/0.04)]"
    >
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[16px] ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold">{title}</span>
        <span className="mt-0.5 block text-[13px] text-faint">{sub}</span>
      </span>
      <Icon name="chevron_right" className="text-faint" />
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
  needs_ok: "bg-[#FBEFD3]",
  added: "bg-mint",
  refused: "bg-blush",
  duplicate: "bg-[#FBEFD3]",
  error: "bg-blush",
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

  const action = "press min-h-10 rounded-full px-4 text-sm font-bold";
  return (
    <li className={`rise flex gap-3 rounded-card p-3 ${rowTone[item.status]}`}>
      <span className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-paper">
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
              className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-forest align-middle"
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
              <button type="button" onClick={onRetake} className={`${action} bg-forest text-paper`}>
                Retake
              </button>
              <button type="button" onClick={onChoose} className={`${action} bg-card`}>
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
              <button type="button" onClick={onRetake} className={`${action} bg-forest text-paper`}>
                Try again
              </button>
              <button type="button" onClick={onChoose} className={`${action} bg-card`}>
                Choose a photo
              </button>
            </>
          )}
          {item.status === "error" && (
            <button
              type="button"
              onClick={() => retry(item.id)}
              className={`${action} bg-forest text-paper`}
            >
              Try again
            </button>
          )}
          {item.receiptId && (item.status === "added" || item.status === "duplicate") && (
            <Link
              href={routes.receipt(item.receiptId)}
              className={`${action} inline-flex items-center bg-card`}
            >
              {item.status === "duplicate" ? "Open it" : "Open"}
            </Link>
          )}
          {item.status === "added" && item.possibleDuplicateOf && (
            <>
              <Link
                href={routes.receipt(item.possibleDuplicateOf)}
                className={`${action} inline-flex items-center bg-card`}
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
    // A screenshot copied on a laptop (Cmd+V / Ctrl+V) goes straight in.
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      onPicked(files);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    dialog.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [open, onClose, onPicked]);

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        className={`sheet flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-paper outline-none md:max-w-lg md:rounded-[28px] ${
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
        <div className="relative flex items-end gap-3 overflow-hidden bg-forest px-5 pb-5 pt-5 text-paper">
          <span
            aria-hidden="true"
            className="absolute -right-10 -top-24 h-64 w-40 rotate-[32deg] bg-gradient-to-b from-white/[0.08] to-white/0"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cat/hi.webp"
            alt=""
            className="tabby-hop relative -mb-5 h-[104px] w-auto shrink-0"
          />
          <div className="relative min-w-0 flex-1 pb-1">
            <h2 id="scan-title" className="text-[24px] font-extrabold tracking-[-0.035em]">
              Add receipts
            </h2>
            <p className="mt-0.5 text-sm font-medium text-paper/70">
              Receipts or order screenshots. Tabby reads every line, tax and total.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="relative grid h-10 w-10 shrink-0 self-start place-items-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 pb-6 pt-4">
          <div className="flex flex-col gap-2">
            <Source
              icon={icons.camera}
              title="Take a photo"
              sub="Flat, well lit, the whole receipt in frame"
              tone="bg-forest text-gold"
              onClick={() => pick("camera")}
            />
            <Source
              icon={icons.photos}
              title="Choose from Photos"
              sub={`Receipts or order screenshots, up to ${MAX_BATCH} at once`}
              tone="bg-sky text-[#1F5C99]"
              onClick={() => pick("photos")}
            />
            <Source
              icon={icons.file}
              title="Upload a file"
              sub="PDFs and photos from Files, iCloud Drive or Google Drive"
              tone="bg-blush text-rose"
              onClick={() => pick("files")}
            />
            <Source
              icon={icons.hand}
              title="Add by hand"
              sub="Cash, a bill, anything without a receipt"
              tone="bg-mint text-good"
              onClick={() => openAddExpense()}
            />
          </div>
          <p className="mt-3 hidden rounded-card border-[1.5px] border-dashed border-[#B9C0BB] px-4 py-3 text-center text-sm font-semibold text-faint md:block">
            Or drop photos, screenshots and PDFs here, or paste one (⌘V / Ctrl+V)
          </p>

          {items.length > 0 && (
            <section aria-label="Your scans" className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-extrabold">
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
                  You can close this. Tabby keeps reading, and each receipt fills in on your tab.
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
