"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";

interface DropzoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  subtitle: string;
}

export function Dropzone({
  accept = "application/pdf,.pdf",
  multiple = false,
  onFiles,
  title,
  subtitle,
}: DropzoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleList = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handleList(e.dataTransfer.files);
      }}
      className={`group flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-8 py-16 text-center transition ${
        over
          ? "border-brand-500 bg-brand-50"
          : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/40"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleList(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-600 transition group-hover:scale-105">
        <FileUp className="h-7 w-7" />
      </span>
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
