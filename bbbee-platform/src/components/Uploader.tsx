"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result = { filename: string; outcome: string; reason?: string; documentClass?: string };

export function Uploader({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    setResults(null);
    const body = new FormData();
    list.forEach((f) => body.append("files", f));
    try {
      const res = await fetch(`/api/engagements/${engagementId}/documents`, { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Upload failed.");
      else {
        setResults(json.results);
        router.refresh();
      }
    } catch {
      setError("Upload failed — network error.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-6 text-center text-sm ${drag ? "border-brand-500 bg-brand-50" : "border-slate-300"}`}
      >
        <p className="font-medium text-slate-700">{busy ? "Uploading and scanning…" : "Drop verification files or a ZIP pack here"}</p>
        <p className="mt-1 text-xs text-slate-500">PDF, scanned PDF, Excel, CSV, Word, JPEG, PNG, ZIP · originals are stored immutably</p>
        <label className="mt-3 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          Choose files
          <input ref={input} type="file" multiple disabled={busy} className="sr-only" accept=".pdf,.xlsx,.xlsm,.xls,.csv,.docx,.doc,.jpg,.jpeg,.png,.zip" onChange={(e) => e.target.files && upload(e.target.files)} />
        </label>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {results && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">
          {results.map((r, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="truncate">{r.filename}</span>
              <span className={r.outcome === "REJECTED" ? "text-red-700" : r.outcome === "STORED" ? "text-emerald-700" : "text-amber-700"} title={r.reason}>
                {r.outcome.replace(/_/g, " ")}{r.reason ? `: ${r.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
