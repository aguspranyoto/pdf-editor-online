"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { ResultCard } from "@/components/ResultCard";
import { ToolHeader } from "@/components/ToolHeader";
import { openDocument, pageThumbnail } from "@/lib/pdfjs";
import { PDFDocument, degrees } from "pdf-lib";
import { takePendingFile } from "@/lib/fileStore";

interface PageItem {
  index: number;
  thumb: string;
  rotation: number;
  deleted: boolean;
}

export default function OrganizePage() {
  const [fileName, setFileName] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    size: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const stored = new Uint8Array(buf.byteLength);
      stored.set(new Uint8Array(buf));
      setBytes(stored);
      const doc = await openDocument(buf);
      const items: PageItem[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 }).rotation;
        items.push({
          index: i,
          thumb: await pageThumbnail(page, 160),
          rotation: ((base % 360) + 360) % 360,
          deleted: false,
        });
      }
      await doc.destroy();
      setFileName(file.name);
      setPages(items);
      setOrder(items.map((p) => p.index));
    } catch {
      setError("Could not read this PDF.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const pending = takePendingFile();
      if (pending) void load(pending);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const rotate = (index: number, delta: number) => {
    setPages((prev) =>
      prev.map((p) =>
        p.index === index
          ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 }
          : p,
      ),
    );
  };

  const toggleDelete = (index: number) => {
    setPages((prev) =>
      prev.map((p) => (p.index === index ? { ...p, deleted: !p.deleted } : p)),
    );
  };

  const move = (pos: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const j = pos + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[pos], next[j]] = [next[j], next[pos]];
      return next;
    });
  };

  const apply = async () => {
    if (!bytes) return;
    setBusy(true);
    setError(null);
    try {
      const src = await PDFDocument.load(bytes.slice(0), {
        ignoreEncryption: true,
      });
      const out = await PDFDocument.create();
      for (const idx of order) {
        const item = pages.find((p) => p.index === idx)!;
        if (item.deleted) continue;
        const [copied] = await out.copyPages(src, [idx]);
        const norm = ((((item.rotation % 360) + 360) % 360) / 90) % 4;
        copied.setRotation(degrees(norm * 90));
        out.addPage(copied);
      }
      if (out.getPageCount() === 0) {
        setError("All pages are deleted — keep at least one page.");
        setBusy(false);
        return;
      }
      const outBytes = await out.save();
      const blob = new Blob([outBytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      setResult({
        url: URL.createObjectURL(blob),
        size: blob.size,
        name: fileName.replace(/\.pdf$/i, "") + "-organized.pdf",
      });
    } catch {
      setError("Organizing failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const activeCount = pages.filter((p) => !p.deleted).length;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <ToolHeader toolName="Organize PDF" />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900">Organize pages</h1>
        <p className="-mt-3 text-sm text-slate-500">
          Reorder, rotate or delete pages — then download the result.
        </p>

        {result ? (
          <ResultCard
            url={result.url}
            size={result.size}
            fileName={result.name}
            onReset={() => {
              URL.revokeObjectURL(result.url);
              setBytes(null);
              setPages([]);
              setResult(null);
            }}
          />
        ) : pages.length === 0 ? (
          loading ? (
            <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
          ) : (
            <>
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                  {error}
                </p>
              )}
              <Dropzone
                onFiles={(f) => void load(f[0])}
                title="Select a PDF file to organize"
                subtitle="or drop it here"
              />
            </>
          )
        ) : (
          <>
            <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {order.map((idx, pos) => {
                const page = pages.find((p) => p.index === idx)!;
                return (
                  <div
                    key={idx}
                    className={`flex flex-col rounded-xl border bg-white p-2 shadow-sm transition ${
                      page.deleted
                        ? "border-red-200 opacity-50"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="relative mb-2 flex h-40 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.thumb}
                        alt={`Page ${idx + 1}`}
                        draggable={false}
                        className="max-h-full max-w-full select-none transition-transform"
                        style={{
                          transform: `rotate(${page.rotation}deg)`,
                          aspectRatio:
                            page.rotation % 180 === 90 ? "auto" : undefined,
                        }}
                      />
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                        {idx + 1}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-0.5">
                      <MiniBtn label="Move up" onClick={() => move(pos, -1)} disabled={pos === 0}>
                        ↑
                      </MiniBtn>
                      <MiniBtn
                        label="Move down"
                        onClick={() => move(pos, 1)}
                        disabled={pos === order.length - 1}
                      >
                        ↓
                      </MiniBtn>
                      <MiniBtn label="Rotate left" onClick={() => rotate(idx, -90)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </MiniBtn>
                      <MiniBtn label="Rotate right" onClick={() => rotate(idx, 90)}>
                        <RotateCw className="h-3.5 w-3.5" />
                      </MiniBtn>
                      {page.deleted ? (
                        <MiniBtn label="Restore" onClick={() => toggleDelete(idx)}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </MiniBtn>
                      ) : (
                        <MiniBtn danger label="Delete page" onClick={() => toggleDelete(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </MiniBtn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              onClick={() => void apply()}
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply & Download ({activeCount} page{activeCount === 1 ? "" : "s"})
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function MiniBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}
