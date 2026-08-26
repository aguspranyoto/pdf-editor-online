"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Circle,
  Download,
  Eraser,
  Highlighter,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  Trash2,
  Copy,
  Bold,
  Italic,
} from "lucide-react";
import { openDocument, type PageInfo } from "@/lib/pdfjs";
import type {
  Annotation,
  FontFamilyId,
  ShapeAnnotation,
  TextAnnotation,
  ToolId,
} from "@/lib/annotations";
import { uid } from "@/lib/annotations";
import { exportEditedPdf } from "@/lib/pdfExport";
import { takePendingFile } from "@/lib/fileStore";
import { PageView } from "./PageView";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const COLORS = [
  "#111827",
  "#e03a25",
  "#2563eb",
  "#16a34a",
  "#eab308",
  "#ffffff",
];

interface TextStyle {
  color: string;
  fontSize: number;
  fontFamily: FontFamilyId;
  bold: boolean;
  italic: boolean;
}

export function EditClient() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("document.pdf");
  const bytesRef = useRef<Uint8Array | null>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof openDocument>> | null>(
    null,
  );
  const [pages, setPages] = useState<PageInfo[]>([]);

  // Editor state
  const [tool, setTool] = useState<ToolId>("select");
  const [zoom, setZoom] = useState(1);
  const [color, setColor] = useState("#e03a25");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [textStyle, setTextStyle] = useState<TextStyle>({
    color: "#111827",
    fontSize: 14,
    fontFamily: "helvetica",
    bold: false,
    italic: false,
  });

  const [annos, setAnnosState] = useState<Annotation[]>([]);
  const annosRef = useRef<Annotation[]>([]);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const hoverPageRef = useRef(0);
  const [currentPage, setCurrentPage] = useState(0);

  const loadFile = useCallback(async (file: File) => {
    setStatus("loading");
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      bytesRef.current = new Uint8Array(buf);
      const d = await openDocument(buf);
      const infos: PageInfo[] = [];
      for (let i = 0; i < d.numPages; i++) {
        const page = await d.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        infos.push({
          index: i,
          width: vp.width,
          height: vp.height,
          rotation: vp.rotation,
        });
      }
      setFileName(file.name || "document.pdf");
      setDoc(d);
      setPages(infos);
      setAnnosState([]);
      annosRef.current = [];
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setEditingId(null);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setError(
        "Could not open this file. Make sure it is a valid, non-corrupted PDF.",
      );
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    // Consume the pending file inside the deferred callback so Strict Mode's
    // double effect-run + cleanup cycle can't swallow it.
    const t = setTimeout(() => {
      const pending = takePendingFile();
      if (pending) void loadFile(pending);
    }, 0);
    return () => clearTimeout(t);
  }, [loadFile]);

  /* ---------- history-aware mutations ---------- */

  const applyAnnos = useCallback((next: Annotation[]) => {
    annosRef.current = next;
    setAnnosState(next);
  }, []);

  const commitHistory = useCallback((pre: Annotation[] | null) => {
    if (!pre) return;
    if (JSON.stringify(pre) === JSON.stringify(annosRef.current)) return;
    setPast((p) => [...p.slice(-49), pre]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [annosRef.current, ...f.slice(0, 49)]);
      annosRef.current = prev;
      setAnnosState(prev);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p.slice(-49), annosRef.current]);
      annosRef.current = next;
      setAnnosState(next);
      return f.slice(1);
    });
  }, []);

  const addAnnotation = useCallback(
    (a: Annotation) => {
      commitHistory(annosRef.current);
      applyAnnos([...annosRef.current, a]);
      setSelectedId(a.id);
    },
    [applyAnnos, commitHistory],
  );

  const updateAnnotation = useCallback(
    (a: Annotation, pre: Annotation[] | null) => {
      applyAnnos(annosRef.current.map((x) => (x.id === a.id ? a : x)));
      if (pre) commitHistory(pre);
    },
    [applyAnnos, commitHistory],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commitHistory(annosRef.current);
    applyAnnos(annosRef.current.filter((a) => a.id !== selectedId));
    setSelectedId(null);
    setEditingId(null);
  }, [selectedId, applyAnnos, commitHistory]);

  const duplicateSelected = useCallback(() => {
    const a = annosRef.current.find((x) => x.id === selectedId);
    if (!a) return;
    const copy = structuredClone(a);
    copy.id = uid();
    if (copy.type !== "draw") {
      copy.x += 16;
      copy.y += 16;
    } else {
      copy.points = copy.points.map((p) => ({ x: p.x + 16, y: p.y + 16 }));
    }
    commitHistory(annosRef.current);
    applyAnnos([...annosRef.current, copy]);
    setSelectedId(copy.id);
  }, [selectedId, applyAnnos, commitHistory]);

  const patchStyleToSelected = useCallback(
    (patch: Partial<TextAnnotation> & Partial<ShapeAnnotation>) => {
      if (!selectedId) return;
      const a = annosRef.current.find((x) => x.id === selectedId);
      if (!a) return;
      updateAnnotation({ ...a, ...patch } as Annotation, null);
    },
    [selectedId, updateAnnotation],
  );

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedId &&
        !editingId
      ) {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Escape") {
        setEditingId(null);
        setSelectedId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelected, selectedId, editingId]);

  /* ---------- current page tracking ---------- */

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pages.length === 0) return;
    const onScroll = () => {
      const center = el.scrollTop + el.clientHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      el.querySelectorAll<HTMLElement>("[data-page-index]").forEach((n) => {
        const idx = Number(n.dataset.pageIndex);
        const top = n.offsetTop;
        const dist = Math.abs(top + n.offsetHeight / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          best = idx;
        }
      });
      setCurrentPage(best);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pages.length]);

  const goToPage = useCallback(
    (idx: number) => {
      const el = scrollRef.current;
      const node = el?.querySelector<HTMLElement>(
        `[data-page-index="${idx}"]`,
      );
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [],
  );

  /* ---------- image insertion ---------- */

  const insertImage = useCallback(
    async (file: File) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const size = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 4, h: 3 });
        img.src = dataUrl;
      });
      const pageInfo = pages[Math.min(hoverPageRef.current, pages.length - 1)];
      if (!pageInfo) return;
      const maxW = Math.min(pageInfo.width * 0.45, 320);
      const w = maxW;
      const h = (size.h / size.w) * w;
      const id = uid();
      addAnnotation({
        id,
        pageIndex: pageInfo.index,
        type: "image",
        x: (pageInfo.width - w) / 2,
        y: (pageInfo.height - h) / 2,
        width: w,
        height: h,
        dataUrl,
      });
      setTool("select");
    },
    [pages, addAnnotation],
  );

  /* ---------- export ---------- */

  const [exporting, setExporting] = useState(false);
  const download = useCallback(async () => {
    if (!bytesRef.current) return;
    setExporting(true);
    try {
      const byPage = new Map<number, Annotation[]>();
      for (const a of annosRef.current) {
        const list = byPage.get(a.pageIndex) ?? [];
        list.push(a);
        byPage.set(a.pageIndex, list);
      }
      const { blob } = await exportEditedPdf(bytesRef.current, byPage);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error(e);
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [fileName]);

  /* ---------- derived ---------- */

  const annosByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annos) {
      const list = m.get(a.pageIndex) ?? [];
      list.push(a);
      m.set(a.pageIndex, list);
    }
    return m;
  }, [annos]);

  const selectedAnno = useMemo(
    () => annos.find((a) => a.id === selectedId) ?? null,
    [annos, selectedId],
  );

  const needsColor = [
    "draw",
    "highlight",
    "whiteout",
    "rect",
    "ellipse",
    "line",
  ].includes(tool);
  const showStroke = ["draw", "rect", "ellipse", "line"].includes(tool);
  const showTextStyle = tool === "text";

  /* ---------- idle / loading screens ---------- */

  if (status !== "ready") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4">
        <Link
          href="/"
          className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-500 shadow-sm transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> All tools
        </Link>
        {status === "loading" ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-brand-600" />
            <p className="font-medium text-slate-700">Preparing your PDF…</p>
          </div>
        ) : (
          <>
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-10 py-14 text-center shadow-sm transition hover:border-brand-400 hover:bg-brand-50/40">
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = "";
                }}
              />
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <Type className="h-7 w-7" />
              </span>
              <span className="text-lg font-semibold text-slate-800">
                Select a PDF file to edit
              </span>
              <span className="text-sm text-slate-500">
                or drag & drop it anywhere on this page
              </span>
            </label>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-100">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">All tools</span>
        </Link>
        <span className="mx-1 hidden truncate text-sm font-semibold text-slate-800 sm:block">
          {fileName}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <IconBtn label="Undo (Ctrl+Z)" onClick={undo} disabled={past.length === 0}>
            <Undo2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={future.length === 0}>
            <Redo2 className="h-4 w-4" />
          </IconBtn>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <IconBtn
            label="Zoom out"
            onClick={() =>
              setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)
            }
            disabled={zoom <= ZOOMS[0]}
          >
            <ZoomOut className="h-4 w-4" />
          </IconBtn>
          <span className="w-11 select-none text-center text-xs font-medium tabular-nums text-slate-600">
            {Math.round(zoom * 100)}%
          </span>
          <IconBtn
            label="Zoom in"
            onClick={() =>
              setZoom(
                (z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z,
              )
            }
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
          >
            <ZoomIn className="h-4 w-4" />
          </IconBtn>
          <button
            onClick={() => void download()}
            disabled={exporting}
            className="ml-2 flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download
          </button>
        </div>
      </header>

      {/* Format bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3">
        {(showTextStyle || selectedAnno?.type === "text") && (
          <FormatGroup>
            <Select
              value={selectedAnno?.type === "text" ? selectedAnno.fontFamily : textStyle.fontFamily}
              onChange={(v) => {
                if (selectedAnno?.type === "text")
                  patchStyleToSelected({ fontFamily: v as FontFamilyId });
                else setTextStyle((s) => ({ ...s, fontFamily: v as FontFamilyId }));
              }}
              options={[
                ["helvetica", "Helvetica"],
                ["times", "Times"],
                ["courier", "Courier"],
              ]}
            />
            <NumberInput
              value={selectedAnno?.type === "text" ? selectedAnno.fontSize : textStyle.fontSize}
              min={6}
              max={96}
              onChange={(v) => {
                if (selectedAnno?.type === "text") patchStyleToSelected({ fontSize: v });
                else setTextStyle((s) => ({ ...s, fontSize: v }));
              }}
            />
            <ToggleBtn
              active={selectedAnno?.type === "text" ? selectedAnno.bold : textStyle.bold}
              onClick={() => {
                if (selectedAnno?.type === "text")
                  patchStyleToSelected({ bold: !selectedAnno.bold });
                else setTextStyle((s) => ({ ...s, bold: !s.bold }));
              }}
              label="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </ToggleBtn>
            <ToggleBtn
              active={selectedAnno?.type === "text" ? selectedAnno.italic : textStyle.italic}
              onClick={() => {
                if (selectedAnno?.type === "text")
                  patchStyleToSelected({ italic: !selectedAnno.italic });
                else setTextStyle((s) => ({ ...s, italic: !s.italic }));
              }}
              label="Italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </ToggleBtn>
          </FormatGroup>
        )}

        {(needsColor || showTextStyle) && (
          <Swatches
            colors={COLORS}
            value={
              selectedAnno && "color" in selectedAnno
                ? selectedAnno.color
                : showTextStyle
                  ? textStyle.color
                  : color
            }
            onChange={(c) => {
              if (selectedAnno && "color" in selectedAnno) {
                patchStyleToSelected({ color: c });
              } else if (showTextStyle) setTextStyle((s) => ({ ...s, color: c }));
              else setColor(c);
            }}
          />
        )}

        {showStroke && (
          <FormatGroup>
            <span className="text-xs font-medium text-slate-500">Stroke</span>
            <input
              type="range"
              min={1}
              max={10}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-24 accent-brand-600"
            />
            <span className="w-4 text-xs tabular-nums text-slate-600">{strokeWidth}</span>
          </FormatGroup>
        )}

        {tool === "highlight" && !selectedAnno && (
          <p className="text-xs text-slate-400">
            Drag across text to highlight it.
          </p>
        )}
        {tool === "whiteout" && !selectedAnno && (
          <p className="text-xs text-slate-400">
            Drag to cover content with white.
          </p>
        )}

        {selectedAnno && tool === "select" && (
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs capitalize text-slate-400">
              {selectedAnno.type} selected
            </span>
            <IconBtn label="Duplicate" onClick={duplicateSelected}>
              <Copy className="h-4 w-4" />
            </IconBtn>
            <IconBtn label="Delete" onClick={deleteSelected}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </IconBtn>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Tool rail */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-2">
          <RailBtn active={tool === "select"} onClick={() => setTool("select")} label="Select (Esc)">
            <MousePointer2 className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "text"} onClick={() => setTool("text")} label="Add text">
            <Type className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "draw"} onClick={() => setTool("draw")} label="Draw">
            <Pencil className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "highlight"} onClick={() => setTool("highlight")} label="Highlight">
            <Highlighter className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "whiteout"} onClick={() => setTool("whiteout")} label="Whiteout">
            <Eraser className="h-5 w-5" />
          </RailBtn>
          <RailBtn
            active={false}
            onClick={() => imageInputRef.current?.click()}
            label="Insert image"
          >
            <ImagePlus className="h-5 w-5" />
          </RailBtn>
          <div className="my-1 h-px w-6 bg-slate-200" />
          <RailBtn active={tool === "rect"} onClick={() => setTool("rect")} label="Rectangle">
            <Square className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "ellipse"} onClick={() => setTool("ellipse")} label="Ellipse">
            <Circle className="h-5 w-5" />
          </RailBtn>
          <RailBtn active={tool === "line"} onClick={() => setTool("line")} label="Line">
            <Minus className="h-5 w-5" />
          </RailBtn>
        </nav>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImage(f);
            e.target.value = "";
          }}
        />

        {/* Pages */}
        <div
          ref={scrollRef}
          className="editor-scroll no-select relative flex-1 overflow-auto p-6"
        >
          <div className="mx-auto flex w-fit flex-col items-center gap-8">
            {pages.map((info) => (
              <PageView
                key={info.index}
                doc={doc!}
                info={info}
                displayScale={(4 / 3) * zoom}
                annotations={annosByPage.get(info.index) ?? []}
                tool={tool}
                color={color}
                strokeWidth={strokeWidth}
                textStyle={textStyle}
                selectedId={selectedId}
                editingId={editingId}
                onHover={() => (hoverPageRef.current = info.index)}
                onSelect={(id) => {
                  setSelectedId(id);
                  if (id === null) setEditingId(null);
                }}
                onStartEdit={(id) => {
                  setEditingId(id);
                  setSelectedId(id);
                }}
                onEndEdit={(id, text, heightPt) => {
                  setEditingId(null);
                  const a = annosRef.current.find(
                    (x): x is Extract<Annotation, { type: "text" }> =>
                      x.id === id && x.type === "text",
                  );
                  if (!a) return;
                  if (!text.trim()) {
                    commitHistory(annosRef.current);
                    applyAnnos(annosRef.current.filter((x) => x.id !== id));
                    setSelectedId(null);
                    return;
                  }
                  updateAnnotation(
                    { ...a, text, height: Math.max(heightPt, a.fontSize * 1.35) },
                    annosRef.current,
                  );
                }}
                onCreate={(a) => addAnnotation(a)}
                onUpdateLive={(a) => updateAnnotation(a, null)}
                onBeginInteraction={() => annosRef.current}
                onEndInteraction={(pre) => commitHistory(pre)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Page nav */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 text-sm text-white shadow-lg backdrop-blur">
          <button
            className="rounded-full px-2 py-0.5 transition hover:bg-white/15 disabled:opacity-40"
            disabled={currentPage <= 0}
            onClick={() => goToPage(currentPage - 1)}
          >
            ↑
          </button>
          <span className="tabular-nums">
            Page {currentPage + 1} of {pages.length}
          </span>
          <button
            className="rounded-full px-2 py-0.5 transition hover:bg-white/15 disabled:opacity-40"
            disabled={currentPage >= pages.length - 1}
            onClick={() => goToPage(currentPage + 1)}
          >
            ↓
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- small UI atoms ---------- */

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function RailBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
        active
          ? "bg-brand-600 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function FormatGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
      {children}
    </div>
  );
}

function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      {colors.map((c) => (
        <button
          key={c}
          title={c}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={`h-5 w-5 rounded-full border transition ${
            value.toLowerCase() === c.toLowerCase()
              ? "ring-2 ring-brand-500 ring-offset-1"
              : "border-slate-300 hover:scale-110"
          }`}
        />
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 outline-none focus:border-brand-400"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-xs tabular-nums outline-none focus:border-brand-400"
    />
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded transition ${
        active ? "bg-brand-100 text-brand-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
