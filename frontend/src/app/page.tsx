"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import {
  ApiError,
  listReceipts,
  logout,
  me,
  sendChat,
  uploadReceipt,
  type Receipt,
  type User,
} from "@/lib/api";

/** Client-side compress before upload: resize to 1600px max, convert to WebP. */
async function compressImage(file: File): Promise<Blob> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Failed to load image"));
    img.src = url;
  });
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return new Promise((res, rej) => {
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
      "image/webp",
      0.85
    );
  });
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /** Middleware only checks the cookie exists; the API decides if it's valid. */
  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return true;
      }
      return false;
    },
    [router]
  );

  const refresh = useCallback(async () => {
    try {
      setReceipts(await listReceipts());
      setLoadError(null);
    } catch (e) {
      if (handleAuthError(e)) return;
      // Surface this: a silent failure renders as an empty account.
      setLoadError((e as Error).message);
    }
  }, [handleAuthError]);

  useEffect(() => {
    (async () => {
      try {
        const u = await me();
        if (!u.intent) {
          router.push("/welcome");
          return;
        }
        setUser(u);
        await refresh();
      } catch (e) {
        if (!handleAuthError(e)) setLoadError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, router, handleAuthError]);

  const onUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setMessage("Compressing…");
      try {
        const blob = await compressImage(file);
        if (blob.size > 300 * 1024) {
          setMessage(
            `Too large after compression (${Math.round(blob.size / 1024)}KB > 300KB) — try a tighter crop.`
          );
          return;
        }
        setMessage(`Uploading ${Math.round(blob.size / 1024)}KB…`);
        const r = await uploadReceipt(blob);
        setMessage(`Uploaded — status: ${r.status}`);
        await refresh();
      } catch (e) {
        if (handleAuthError(e)) return;
        setMessage(`Upload failed: ${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [refresh, handleAuthError]
  );

  const onChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const q = chatInput;
    setChatLog((l) => [...l, `You: ${q}`]);
    setChatInput("");
    try {
      const d = await sendChat(q, sessionId);
      setSessionId(d.session_id);
      setChatLog((l) => [...l, `Assistant: ${d.message}`]);
    } catch (e) {
      if (handleAuthError(e)) return;
      setChatLog((l) => [...l, `Error: ${(e as Error).message}`]);
    }
  }, [chatInput, sessionId, handleAuthError]);

  const onLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }, [router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ReceiptWise</h1>
            {user && (
              <p className="text-sm text-gray-500">
                Signed in as {user.email}
              </p>
            )}
          </div>
          <button
            onClick={onLogout}
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            Log out
          </button>
        </header>

        {loadError && (
          <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Couldn&apos;t load receipts: {loadError}
          </p>
        )}

        {receipts.length === 0 && !loadError ? (
          <EmptyState
            intent={user?.intent ?? null}
            onFile={onUpload}
            busy={uploading}
            message={message}
          />
        ) : (
          <>
            <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">
                Scan a receipt
              </h2>
              <label className="inline-block cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
                {uploading ? "Working…" : "Choose photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) =>
                    e.target.files?.[0] && onUpload(e.target.files[0])
                  }
                />
              </label>
              {message && (
                <p className="mt-3 text-sm text-gray-600">{message}</p>
              )}
            </section>

            <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Recent receipts
                </h2>
                <button
                  onClick={refresh}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Refresh
                </button>
              </div>
              <ul className="text-sm">
                {receipts.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between border-b border-gray-100 py-2 last:border-0"
                  >
                    <span className="text-gray-900">
                      {r.merchant || "(unparsed)"}{" "}
                      <span className="text-gray-400">— {r.status}</span>
                    </span>
                    <span className="tabular-nums text-gray-900">
                      {r.currency} {r.total.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Chat with your data
          </h2>
          <div className="mb-3 h-48 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {chatLog.length === 0 ? (
              <p className="text-gray-400">
                Ask things like &ldquo;how much did I spend on groceries this
                month?&rdquo;
              </p>
            ) : (
              chatLog.map((m, i) => (
                <p key={i} className="mb-1 whitespace-pre-wrap">
                  {m}
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onChat()}
              placeholder="Ask about your spending…"
            />
            <button
              onClick={onChat}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Send
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
