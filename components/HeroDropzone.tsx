"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { PenLine } from "lucide-react";
import { setPendingFiles } from "@/lib/fileStore";

export function HeroDropzone() {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    (files: File[]) => {
      const pdf = files.find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
      if (!pdf) return;
      setBusy(true);
      setPendingFiles([pdf]);
      router.push("/edit");
    },
    [router],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => document.getElementById("hero-file-input")?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ")
          document.getElementById("hero-file-input")?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handleFiles(Array.from(e.dataTransfer.files));
      }}
      className={`mx-auto flex max-w-xl cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-white px-8 py-10 shadow-sm transition ${
        over
          ? "border-brand-500 bg-brand-50"
          : "border-slate-300 hover:border-brand-400 hover:bg-brand-50/40"
      }`}
    >
      <input
        id="hero-file-input"
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          handleFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
        <PenLine className="h-6 w-6" />
      </span>
      <p className="text-base font-semibold text-slate-800">
        {busy ? "Opening editor…" : "Select a PDF file to edit"}
      </p>
      <p className="text-sm text-slate-500">or drag & drop it here</p>
    </div>
  );
}
