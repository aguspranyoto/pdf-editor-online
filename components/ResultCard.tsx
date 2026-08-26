"use client";

import { CheckCircle2, Download, RotateCcw } from "lucide-react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ResultCardProps {
  url: string;
  size: number;
  fileName: string;
  onReset: () => void;
}

export function ResultCard({ url, size, fileName, onReset }: ResultCardProps) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
      <div>
        <p className="text-lg font-semibold text-slate-900">
          Your document is ready
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {fileName} · {formatSize(size)}
        </p>
      </div>
      <a
        href={url}
        download={fileName}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
      >
        <Download className="h-5 w-5" />
        Download
      </a>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <RotateCcw className="h-4 w-4" />
        Start over
      </button>
    </div>
  );
}
