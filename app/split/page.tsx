"use client";

import { useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { ResultCard } from "@/components/ResultCard";
import { ToolHeader } from "@/components/ToolHeader";
import { PDFDocument } from "pdf-lib";

function parseRanges(input: string, max: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(seg);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
      if (p >= 1 && p <= max) pages.add(p - 1);
    }
  }
  return [...pages].sort((x, y) => x - y);
}

export default function SplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    size: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setNumPages(doc.getPageCount());
      setFile(f);
      setRanges(`1-${doc.getPageCount()}`);
    } catch {
      setError("Could not read this PDF.");
    }
  };

  const split = async () => {
    if (!file) return;
    const indices = parseRanges(ranges, numPages);
    if (indices.length === 0) {
      setError("Enter at least one valid page or range, e.g. 1-3, 5.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const src = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: file.name.replace(/\.pdf$/i, "") + "-split.pdf",
      });
    } catch {
      setError("Splitting failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <ToolHeader toolName="Split PDF" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">Split a PDF</h1>
        <p className="-mt-3 text-sm text-slate-500">
          Extract the pages you need into a new document.
        </p>

        {result ? (
          <ResultCard
            url={result.url}
            size={result.size}
            fileName={result.name}
            onReset={() => {
              URL.revokeObjectURL(result.url);
              setFile(null);
              setResult(null);
              setNumPages(0);
            }}
          />
        ) : !file ? (
          <Dropzone
            onFiles={(f) => void onFiles(f)}
            title="Select a PDF file to split"
            subtitle="or drop it here"
          />
        ) : (
          <>
            <div className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <Scissors className="h-5 w-5 shrink-0 text-brand-600" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {file.name}
                </span>
                <span className="text-xs tabular-nums text-slate-400">
                  {numPages} page{numPages === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => setFile(null)}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Change
                </button>
              </div>
            </div>

            <label className="w-full text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Pages to keep
              </span>
              <input
                value={ranges}
                onChange={(e) => setRanges(e.target.value)}
                placeholder={`e.g. 1-${numPages}, or 1-3, 7`}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Use commas and dashes — e.g. <code>2</code>, <code>1-3, 8</code>.
                Your PDF has {numPages} page{numPages === 1 ? "" : "s"}.
              </span>
            </label>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              onClick={() => void split()}
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Split PDF
            </button>
          </>
        )}
      </main>
    </div>
  );
}
