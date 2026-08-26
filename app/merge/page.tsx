"use client";

import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, Combine, Loader2, X } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { ResultCard } from "@/components/ResultCard";
import { ToolHeader } from "@/components/ToolHeader";
import { PDFDocument } from "pdf-lib";
import { takePendingFiles } from "@/lib/fileStore";
import { useEffect } from "react";

interface Item {
  id: string;
  file: File;
}

export default function MergePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    size: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const pending = takePendingFiles();
      if (pending && pending.length > 0) {
        setItems(pending.map((file) => ({ id: crypto.randomUUID(), file })));
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const pdfs = files.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    setItems((prev) => [
      ...prev,
      ...pdfs.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    setResult(null);
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await PDFDocument.create();
      for (const item of items) {
        const src = await PDFDocument.load(await item.file.arrayBuffer(), {
          ignoreEncryption: true,
        });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: "merged.pdf",
      });
    } catch {
      setError("One of the files could not be processed. Is it a valid PDF?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <ToolHeader toolName="Merge PDF" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">Merge PDF files</h1>
        <p className="-mt-3 text-sm text-slate-500">
          Combine documents in the order you choose — entirely in your browser.
        </p>

        {result ? (
          <ResultCard
            url={result.url}
            size={result.size}
            fileName={result.name}
            onReset={() => {
              URL.revokeObjectURL(result.url);
              setItems([]);
              setResult(null);
            }}
          />
        ) : items.length === 0 ? (
          <Dropzone
            multiple
            onFiles={addFiles}
            title="Select PDF files to merge"
            subtitle="or drop two or more PDFs here"
          />
        ) : (
          <>
            <ul className="w-full space-y-2">
              {items.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                >
                  <Combine className="h-5 w-5 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {item.file.name}
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {(item.file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    aria-label="Move down"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      setItems((prev) => prev.filter((x) => x.id !== item.id))
                    }
                    aria-label="Remove"
                    className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <label className="cursor-pointer rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-600">
                Add more
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={() => void merge()}
                disabled={busy || items.length < 2}
                className="flex items-center gap-2 rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Merge {items.length >= 2 ? `${items.length} files` : "PDFs"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
