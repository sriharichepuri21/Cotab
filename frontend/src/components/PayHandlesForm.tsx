"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Field, fieldClass } from "@/components/ui";
import type { PayHandles, PayMethod } from "@/lib/api";

const FIELDS: Array<{ key: PayMethod; label: string; placeholder: string; hint: string }> = [
  { key: "venmo", label: "Venmo", placeholder: "@your-name", hint: "Your Venmo username" },
  { key: "paypal", label: "PayPal", placeholder: "yourname", hint: "The name in paypal.me/…" },
  { key: "cashapp", label: "Cash App", placeholder: "$yourtag", hint: "Your $Cashtag" },
  { key: "zelle", label: "Zelle", placeholder: "you@email.com", hint: "Email or phone on Zelle" },
];

/** Venmo, PayPal, Cash App and Zelle details. Blank fields are simply left off. */
export function PayHandlesForm({
  initial,
  onSave,
  saveLabel = "Save",
  idPrefix = "pay",
}: {
  initial: PayHandles | undefined;
  onSave: (handles: PayHandles) => Promise<PayHandles>;
  saveLabel?: string;
  idPrefix?: string;
}) {
  const [values, setValues] = useState<PayHandles>(initial ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [touched, setTouched] = useState(false);
  // `initial` is undefined until the saved details have loaded. Fields stay
  // locked until then, and a late load never overwrites what was typed.
  const loading = initial === undefined;

  useEffect(() => {
    if (!touched) setValues(initial ?? {});
  }, [initial, touched]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setValues(await onSave(values));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <input
              id={`${idPrefix}-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setTouched(true);
                setValues({ ...values, [field.key]: e.target.value });
              }}
              disabled={loading}
              className={fieldClass}
              placeholder={field.placeholder}
              aria-label={field.hint}
              autoComplete="off"
              inputMode={field.key === "zelle" ? "email" : "text"}
            />
          </Field>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || loading}>
          {busy ? "Saving…" : saveLabel}
        </Button>
        {saved && (
          <span role="status" className="text-sm font-semibold text-muted">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
