"use client";

import { useCallback, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
// Dev-mode escape hatch matching backend's X-Dev-User header
const DEV_HEADERS = { "X-Dev-User": "dev@local" };

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

interface Receipt {
  id: string;
  merchant: string;
  total: number;
  currency: string;
  category: string;
  status: string;
  confidence: number;
}

export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`${API}/api/v1/receipts/`, { headers: DEV_HEADERS });
    if (r.ok) setReceipts(await r.json());
  }, []);

  const onUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setMessage("Compressing…");
      try {
        const blob = await compressImage(file);
        if (blob.size > 300 * 1024) {
          setMessage(`Too large after compression (${Math.round(blob.size / 1024)}KB > 300KB) — try a tighter crop.`);
          return;
        }
        setMessage(`Uploading ${Math.round(blob.size / 1024)}KB…`);
        const fd = new FormData();
        fd.append("file", blob, "receipt.webp");
        const r = await fetch(`${API}/api/v1/receipts/upload`, {
          method: "POST",
          headers: DEV_HEADERS,
          body: fd,
        });
        const json = await r.json();
        setMessage(r.ok ? `Uploaded — status: ${json.status}` : `Error: ${JSON.stringify(json.detail)}`);
        await refresh();
      } catch (e) {
        setMessage(`Upload failed: ${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [refresh]
  );

  const onChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const q = chatInput;
    setChatLog((l) => [...l, `You: ${q}`]);
    setChatInput("");
    const r = await fetch(`${API}/api/v1/chat/`, {
      method: "POST",
      headers: { ...DEV_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ message: q, session_id: sessionId }),
    });
    const d = await r.json();
    if (r.ok) {
      setSessionId(d.session_id);
      setChatLog((l) => [...l, `Assistant: ${d.message}${d.sql ? `\n  (sql: ${d.sql})` : ""}`]);
    } else {
      setChatLog((l) => [...l, `Error: ${JSON.stringify(d.detail)}`]);
    }
  }, [chatInput, sessionId]);

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">ReceiptWise</h1>
      <p className="text-gray-600 mb-8">AI-powered receipt tracking ($-ready API {API})</p>

      <section className="mb-8 p-4 bg-white rounded shadow">
        <h2 className="text-xl font-semibold mb-3">Scan a receipt</h2>
        <label className="block">
          <span className="sr-only">Choose receipt photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </label>
        {uploading && <p className="text-sm text-blue-600 mt-2">Working…</p>}
        {message && <p className="text-sm mt-2">{message}</p>}
      </section>

      <section className="mb-8 p-4 bg-white rounded shadow">
        <h2 className="text-xl font-semibold mb-3">Recent receipts</h2>
        <button onClick={refresh} className="text-sm text-blue-600 underline mb-2">refresh</button>
        <ul className="text-sm space-y-1">
          {receipts.map((r) => (
            <li key={r.id} className="flex justify-between border-b py-1">
              <span>{r.merchant || "(unparsed)"} — {r.status}</span>
              <span>{r.currency} {r.total.toFixed(2)}</span>
            </li>
          ))}
          {receipts.length === 0 && <li className="text-gray-400">No receipts yet</li>}
        </ul>
      </section>

      <section className="p-4 bg-white rounded shadow">
        <h2 className="text-xl font-semibold mb-3">Chat with your data</h2>
        <div className="border rounded p-2 h-48 overflow-auto mb-2 bg-gray-50 text-sm">
          {chatLog.map((m, i) => (
            <p key={i} className="whitespace-pre-wrap mb-1">{m}</p>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-2 py-1 text-sm"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onChat()}
            placeholder="Ask: how much did I spend on groceries this month?"
          />
          <button onClick={onChat} className="bg-blue-600 text-white px-4 rounded text-sm">Send</button>
        </div>
      </section>
    </main>
  );
}
