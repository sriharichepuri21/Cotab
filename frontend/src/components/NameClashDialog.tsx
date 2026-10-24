"use client";

import { useEffect, useState, type FormEvent } from "react";

import { fieldClass } from "@/components/ui";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Two different people (different numbers) with the same name in one split.
 * Their number is who they are; their name is only how the split tells them
 * apart, so it asks for two different names: usually a last name.
 */
export function NameClashDialog({
  name,
  existing,
  taken,
  suggestion,
  canRenameExisting,
  onConfirm,
  onCancel,
}: {
  /** The name both of them have, e.g. "Ben". */
  name: string;
  /** The one already in the split, and what tells them apart. */
  existing: { name: string; detail?: string };
  /** Every other name in the split, which neither new name may be. */
  taken: string[];
  /** Their full name from Cotab, when it's known, e.g. "Ben Lee". */
  suggestion?: string | null;
  canRenameExisting: boolean;
  onConfirm: (newName: string, existingName: string) => unknown;
  onCancel: () => void;
}) {
  const [fresh, setFresh] = useState(`${name.trim()} `);
  const [old, setOld] = useState(existing.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const others = taken.filter((t) => !same(t, existing.name));
  const problem = !fresh.trim()
    ? "Give them a name."
    : !old.trim()
      ? `Give ${existing.name} a name.`
      : same(fresh, old)
        ? "Give them two different names."
        : others.some((t) => same(t, fresh) || same(t, old))
          ? "That name is already in this split."
          : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(fresh.trim(), old.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`There's already a ${name.trim()} in this split`}
        onSubmit={submit}
        className="sheet flex w-full flex-col gap-4 rounded-t-[28px] bg-paper p-5 md:max-w-md md:rounded-[28px]"
      >
        <div>
          <h2 className="text-lg font-extrabold tracking-[-0.02em]">
            There&apos;s already a {name.trim()} in this split
          </h2>
          <p className="mt-1 text-sm text-muted">
            {existing.detail ? `${existing.name} (${existing.detail})` : existing.name} is a
            different person with a different number. Give them different names so nobody gets mixed
            up when splitting, like adding a last name.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-bold text-muted">
            The {name.trim()} you&apos;re adding
          </span>
          <input
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            className={fieldClass}
            aria-label={`New name for the ${name.trim()} you're adding`}
            autoFocus
          />
        </label>
        {suggestion && !same(suggestion, fresh) && !same(suggestion, old) && (
          <button
            type="button"
            onClick={() => setFresh(suggestion)}
            className="-mt-2 self-start text-[13px] font-bold text-forest underline underline-offset-4"
          >
            Use &ldquo;{suggestion}&rdquo;
          </button>
        )}

        {canRenameExisting && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-bold text-muted">
              The {name.trim()} already here (optional)
            </span>
            <input
              value={old}
              onChange={(e) => setOld(e.target.value)}
              className={fieldClass}
              aria-label={`Name for the ${name.trim()} already in this split`}
            />
          </label>
        )}

        {(problem || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`text-[13px] font-semibold ${error ? "text-rose" : "text-muted"}`}
          >
            {error || problem}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={Boolean(problem) || busy}
            className="press min-h-11 flex-1 rounded-full bg-forest px-5 text-sm font-bold text-gold disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="press min-h-11 rounded-full bg-card px-5 text-sm font-bold"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
