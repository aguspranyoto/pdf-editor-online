"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Combine, Download, Loader2, PenLine, RotateCcw, X } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { ToolHeader } from "@/components/ToolHeader";
import { PDFDocument } from "pdf-lib";
import { setPendingFiles, takePendingFiles } from "@/lib/fileStore";
import { openDocument, pageThumbnail } from "@/lib/pdfjs";
import { uid } from "@/lib/annotations";
import { useEffect } from "react";

interface Item {
  id: string;
  file: File;
}

export default function MergePage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    size: number;
    name: string;
    bytes: Uint8Array;
    numPages: number;
    thumbs: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const pending = takePendingFiles();
      if (pending && pending.length > 0) {
        setItems(pending.map((file) => ({ id: uid(), file })));
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
      ...pdfs.map((file) => ({ id: uid(), file })),
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
      const merged = new Uint8Array(bytes);
      const blob = new Blob([merged as unknown as BlobPart], {
        type: "application/pdf",
      });

      // Build preview thumbnails so user can verify before download/edit.
      const doc = await openDocument(merged.slice(0));
      const thumbs: string[] = [];
      const previewCount = Math.min(doc.numPages, 12);
      for (let i = 0; i < previewCount; i++) {
        const page = await doc.getPage(i + 1);
        thumbs.push(await pageThumbnail(page, 200));
      }
      const numPages = doc.numPages;
      await doc.destroy().catch(() => {});

      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: "merged.pdf",
        bytes: merged,
        numPages,
        thumbs,
      });
    } catch {
      setError("One of the files could not be processed. Is it a valid PDF?");
    } finally {
      setBusy(false);
    }
  };

  const editMerged = useCallback(() => {
    if (!result) return;
    const file = new File([result.bytes as unknown as BlobPart], result.name, {
      type: "application/pdf",
    });
    setPendingFiles([file]);
    router.push("/edit");
  }, [result, router]);

  const reset = useCallback(() => {
    if (result) URL.revokeObjectURL(result.url);
    setItems([]);
    setResult(null);
  }, [result]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <ToolHeader toolName="Merge PDF" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">Merge PDF files</h1>
        <p className="-mt-3 text-sm text-slate-500">
          Combine documents in the order you choose — entirely in your browser.
        </p>

        {result ? (
          <div className="flex w-full flex-col items-center gap-6">
            <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-center text-lg font-semibold text-slate-900">
                Preview — {result.numPages} page{result.numPages === 1 ? "" : "s"} · {(result.size / 1024).toFixed(1)} KB
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {result.thumbs.map((src, i) => (
                  <div
                    key={i}
                    className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg bg-slate-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Merged page ${i + 1}`}
                      draggable={false}
                      className="max-h-full max-w-full select-none"
                    />
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
              {result.numPages > result.thumbs.length && (
                <p className="mt-3 text-center text-xs text-slate-400">
                  Showing first {result.thumbs.length} of {result.numPages} pages
                </p>
              )}
            </div>

            <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <p className="text-base font-semibold text-slate-900">
                Your merged document is ready
              </p>
              <p className=" -mt-2 text-sm text-slate-500">
                {result.name} · {(result.size / 1024).toFixed(1)} KB
              </p>
              <button
                onClick={editMerged}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-slate-700"
              >
                <PenLine className="h-5 w-5" />
                Preview & Edit (text, draw, image…)
              </button>
              <a
                href={result.url}
                download={result.name}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
              >
                <Download className="h-5 w-5" />
                Download directly
              </a>
              <button
                onClick={reset}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                Start over
              </button>
            </div>
          </div>
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
