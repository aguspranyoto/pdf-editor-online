"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type {
  Annotation,
  DrawAnnotation,
  Point,
  ShapeAnnotation,
  TextAnnotation,
  ToolId,
} from "@/lib/annotations";
import {
  annoBounds,
  moveAnnotation,
  resizeAnnotation,
  uid,
} from "@/lib/annotations";

const HANDLES = ["nw", "ne", "sw", "se"] as const;
type Handle = (typeof HANDLES)[number];

interface TextStyle {
  color: string;
  fontSize: number;
  fontFamily: FontFamilyId;
  bold: boolean;
  italic: boolean;
}
type FontFamilyId = TextAnnotation["fontFamily"];

interface PageViewProps {
  doc: PDFDocumentProxy;
  info: { index: number; width: number; height: number };
  displayScale: number;
  annotations: Annotation[];
  tool: ToolId;
  color: string;
  strokeWidth: number;
  textStyle: TextStyle;
  selectedId: string | null;
  editingId: string | null;
  onHover: () => void;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (id: string, text: string, heightPt: number) => void;
  onCreate: (a: Annotation) => void;
  onReplacePdfText: (
    pageIndex: number,
    box: { x: number; y: number; width: number; height: number },
    text: string,
    fontSize: number,
    style: { fontFamily: FontFamilyId; bold: boolean; italic: boolean },
  ) => void;
  onUpdateLive: (a: Annotation) => void;
  onBeginInteraction: () => Annotation[] | null;
  onEndInteraction: (pre: Annotation[] | null) => void;
}

export function PageView(props: PageViewProps) {
  const { doc, info, displayScale } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "800px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let proxy: { cleanup: () => void } | null = null;
    (async () => {
      try {
        const page = await doc.getPage(info.index + 1);
        proxy = page;
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: displayScale * dpr });
        const canvas = wrapRef.current?.querySelector("canvas");
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const ctx = canvas.getContext("2d")!;
        task = page.render({ canvas, canvasContext: ctx, viewport });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        /* render cancelled */
      } finally {
        proxy?.cleanup();
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, info.index, displayScale, visible]);

  const cssW = Math.round(info.width * displayScale);
  const cssH = Math.round(info.height * displayScale);

  return (
    <div
      ref={wrapRef}
      data-page-index={info.index}
      className="relative shadow-[0_2px_12px_rgba(15,23,42,0.15)]"
      onPointerEnter={props.onHover}
    >
      <canvas
        className="block rounded-[2px] bg-white"
        style={{ width: cssW, height: cssH }}
      />
      {!rendered && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white text-xs text-slate-400"
          style={{ width: cssW, height: cssH }}
        >
          Rendering…
        </div>
      )}
      <AnnotationLayer {...props} cssW={cssW} cssH={cssH} overlayRef={overlayRef} />
      <PdfTextLayer
        doc={doc}
        pageIndex={info.index}
        displayScale={displayScale}
        cssW={cssW}
        cssH={cssH}
        active={props.tool === "editText"}
        visible={visible}
        onReplace={props.onReplacePdfText}
      />
    </div>
  );
}

/* ================= Annotation layer ================= */

interface LayerProps extends PageViewProps {
  cssW: number;
  cssH: number;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

function AnnotationLayer(props: LayerProps) {
  const {
    annotations,
    tool,
    displayScale: s,
    cssW,
    cssH,
    overlayRef,
    editingId,
    selectedId,
  } = props;

  // live interaction state
  const dragRef = useRef<{
    mode: "move" | "resize" | "create" | "draw";
    id?: string;
    handle?: Handle;
    startPt: Point;
    orig?: Annotation;
    preSnapshot: Annotation[] | null;
    moved: boolean;
  } | null>(null);

  const [drawPreview, setDrawPreview] = useState<Point[] | null>(null);
  const drawPreviewRef = useRef<Point[] | null>(null);
  const [shapePreview, setShapePreview] = useState<
    { x: number; y: number; width: number; height: number } | null
  >(null);

  const toPt = useCallback(
    (e: React.PointerEvent): Point => {
      const rect = overlayRef.current!.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / s,
        y: (e.clientY - rect.top) / s,
      };
    },
    [overlayRef, s],
  );

  const cursor =
    tool === "select"
      ? "default"
      : tool === "text"
        ? "text"
        : tool === "draw" || tool === "highlight"
          ? "crosshair"
          : "crosshair";

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingId) return; // let text editing behave normally
    if (tool === "editText") return; // clicks go to the native PDF text layer
    const pt = toPt(e);
    const pre = props.onBeginInteraction();

    if (tool === "select") {
      props.onSelect(null);
      props.onEndInteraction(null);
      dragRef.current = null;
      return;
    }

    overlayRef.current?.setPointerCapture(e.pointerId);

    if (tool === "draw") {
      dragRef.current = {
        mode: "draw",
        startPt: pt,
        preSnapshot: pre,
        moved: false,
      };
      drawPreviewRef.current = [pt];
      setDrawPreview([pt]);
      return;
    }

    if (tool === "text") {
      // Prevent the browser's default mousedown focus-shift, which would
      // immediately blur (and thereby delete) the freshly created text box.
      e.preventDefault();
      const id = uid();
      const a: TextAnnotation = {
        id,
        pageIndex: props.info.index,
        type: "text",
        x: pt.x,
        y: pt.y - 8,
        width: Math.max(40, Math.min(220, props.info.width - pt.x - 8)),
        height: props.textStyle.fontSize * 1.35,
        text: "",
        color: props.textStyle.color,
        fontSize: props.textStyle.fontSize,
        fontFamily: props.textStyle.fontFamily,
        bold: props.textStyle.bold,
        italic: props.textStyle.italic,
      };
      props.onCreate(a);
      props.onStartEdit(id);
      dragRef.current = null;
      return;
    }

    // shape tools
    dragRef.current = {
      mode: "create",
      startPt: pt,
      preSnapshot: pre,
      moved: false,
    };
    setShapePreview({ x: pt.x, y: pt.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const pt = toPt(e);
    const dx = pt.x - d.startPt.x;
    const dy = pt.y - d.startPt.y;

    if (d.mode === "draw" && drawPreviewRef.current) {
      const last = drawPreviewRef.current[drawPreviewRef.current.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 1.5) {
        const next = [...drawPreviewRef.current, pt];
        drawPreviewRef.current = next;
        setDrawPreview(next);
      }
      d.moved = true;
      return;
    }
    if (d.mode === "create") {
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (tool !== "select") {
        if (tool === "line") {
          setShapePreview({
            x: d.startPt.x,
            y: d.startPt.y,
            width: dx,
            height: dy,
          });
        } else {
          setShapePreview({
            x: Math.min(d.startPt.x, pt.x),
            y: Math.min(d.startPt.y, pt.y),
            width: Math.abs(dx),
            height: Math.abs(dy),
          });
        }
      }
      return;
    }
    if ((d.mode === "move" || d.mode === "resize") && d.orig) {
      if (Math.hypot(dx, dy) > 2) d.moved = true;
      if (d.mode === "move") {
        props.onUpdateLive(moveAnnotation(d.orig, dx, dy));
      } else if (d.id && d.handle) {
        props.onUpdateLive(resizeAnnotation(d.orig, d.handle, dx, dy));
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    if (d.mode === "draw" && drawPreviewRef.current) {
      const points = drawPreviewRef.current;
      drawPreviewRef.current = null;
      setDrawPreview(null);
      if (points.length >= 2 && d.moved) {
        const a: DrawAnnotation = {
          id: uid(),
          pageIndex: props.info.index,
          type: "draw",
          points,
          color: props.color,
          strokeWidth: props.strokeWidth,
        };
        props.onCreate(a);
      } else {
        props.onEndInteraction(null);
      }
      return;
    }

    if (d.mode === "create" && shapePreview && d.moved) {
      setShapePreview(null);
      const kindMap: Record<string, ShapeAnnotation["type"]> = {
        rect: "rect",
        ellipse: "ellipse",
        line: "line",
        highlight: "highlight",
        whiteout: "whiteout",
      };
      const kind = kindMap[props.tool];
      if (kind) {
        const a: ShapeAnnotation = {
          id: uid(),
          pageIndex: props.info.index,
          type: kind,
          ...shapePreview,
          color:
            kind === "highlight"
              ? "#fde047"
              : kind === "whiteout"
                ? "#ffffff"
                : props.color,
          strokeWidth: props.strokeWidth,
        };
        props.onCreate(a);
        props.onSelect(a.id);
        setToolAfterShape();
      }
      return;
    }

    setShapePreview(null);
    props.onEndInteraction(d.moved ? d.preSnapshot : null);
  };

  // After creating a shape, switch back to select like most editors.
  const setToolAfterShape = () => {
    /* handled by parent via selection; keep current tool */
  };

  return (
    <div
      ref={overlayRef}
      className="absolute left-0 top-0 touch-none"
      style={{
        width: cssW,
        height: cssH,
        cursor,
        pointerEvents: tool === "editText" ? "none" : "auto",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* annotations */}
      {annotations.map((a) => (
        <AnnotationItem
          key={a.id}
          a={a}
          s={s}
          selected={selectedId === a.id && tool === "select"}
          editing={editingId === a.id}
          canInteract={tool === "select"}
          onStartEdit={() => {
            props.onSelect(a.id);
            props.onStartEdit(a.id);
          }}
          onEndEdit={(text, h) => props.onEndEdit(a.id, text, h)}
          onHandleDown={(handle, e) => {
            e.stopPropagation();
            const rect = overlayRef.current!.getBoundingClientRect();
            const startPt = {
              x: (e.clientX - rect.left) / s,
              y: (e.clientY - rect.top) / s,
            };
            dragRef.current = {
              mode: "resize",
              id: a.id,
              handle,
              startPt,
              orig: a,
              preSnapshot: props.onBeginInteraction(),
              moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onBodyDown={(e) => {
            const rect = overlayRef.current!.getBoundingClientRect();
            const startPt = {
              x: (e.clientX - rect.left) / s,
              y: (e.clientY - rect.top) / s,
            };
            dragRef.current = {
              mode: "move",
              id: a.id,
              startPt,
              orig: a,
              preSnapshot: props.onBeginInteraction(),
              moved: false,
            };
            props.onSelect(a.id);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        />
      ))}

      {/* previews */}
      {shapePreview && tool === "line" && (shapePreview.width !== 0 || shapePreview.height !== 0) && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={cssW}
          height={cssH}
          viewBox={`0 0 ${cssW} ${cssH}`}
        >
          <line
            x1={shapePreview.x * s}
            y1={shapePreview.y * s}
            x2={(shapePreview.x + shapePreview.width) * s}
            y2={(shapePreview.y + shapePreview.height) * s}
            stroke={props.color}
            strokeWidth={props.strokeWidth * s}
            strokeDasharray="6 3"
            strokeLinecap="round"
          />
        </svg>
      )}
      {shapePreview && shapePreview.width > 0 && shapePreview.height > 0 && tool !== "line" && (
        <div
          className="pointer-events-none absolute border border-dashed border-brand-500/80 bg-brand-500/10"
          style={{
            left: shapePreview.x * s,
            top: shapePreview.y * s,
            width: shapePreview.width * s,
            height: shapePreview.height * s,
          }}
        />
      )}
      {drawPreview && drawPreview.length > 1 && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={cssW}
          height={cssH}
          viewBox={`0 0 ${cssW} ${cssH}`}
        >
          <polyline
            fill="none"
            stroke={props.color}
            strokeWidth={props.strokeWidth * s}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={drawPreview.map((p) => `${p.x * s},${p.y * s}`).join(" ")}
          />
        </svg>
      )}
    </div>
  );
}

/* ================= Single annotation ================= */

function AnnotationItem({
  a,
  s,
  selected,
  editing,
  canInteract,
  onStartEdit,
  onEndEdit,
  onHandleDown,
  onBodyDown,
}: {
  a: Annotation;
  s: number;
  selected: boolean;
  editing: boolean;
  canInteract: boolean;
  onStartEdit: () => void;
  onEndEdit: (text: string, heightPt: number) => void;
  onHandleDown: (h: Handle, e: React.PointerEvent) => void;
  onBodyDown: (e: React.PointerEvent) => void;
}) {
  if (a.type === "text") {
    return (
      <TextItem
        a={a}
        s={s}
        selected={selected}
        editing={editing}
        canInteract={canInteract}
        onStartEdit={onStartEdit}
        onEndEdit={onEndEdit}
        onBodyDown={onBodyDown}
        onHandleDown={onHandleDown}
      />
    );
  }

  if (a.type === "draw") {
    const b = annoBounds(a);
    const w = Math.max(b.width * s, 2);
    const h = Math.max(b.height * s, 2);
    return (
      <div
        className="absolute"
        style={{
          left: b.x * s,
          top: b.y * s,
          width: w,
          height: h,
        }}
        onPointerDown={(e) => {
          if (!canInteract || editing) return;
          e.stopPropagation();
          onBodyDown(e);
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${w} ${h}`}
        >
          <polyline
            fill="none"
            stroke={a.color}
            strokeWidth={a.strokeWidth * s}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={a.points.map((p) => `${(p.x - b.x) * s},${(p.y - b.y) * s}`).join(" ")}
          />
        </svg>
        {selected && (
          <SelectionFrame onHandleDown={onHandleDown} />
        )}
      </div>
    );
  }

  if (a.type === "image") {
    const b = annoBounds(a);
    return (
      <div
        className="absolute"
        style={{
          left: b.x * s,
          top: b.y * s,
          width: b.width * s,
          height: b.height * s,
          cursor: canInteract ? "move" : "inherit",
        }}
        onPointerDown={(e) => {
          if (!canInteract || editing) return;
          e.stopPropagation();
          onBodyDown(e);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.dataUrl}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full select-none"
        />
        {selected && (
          <SelectionFrame onHandleDown={onHandleDown} />
        )}
      </div>
    );
  }

  // shapes incl. highlight & whiteout
  const b = annoBounds(a);
  const common: React.CSSProperties = {
    position: "absolute",
    left: b.x * s,
    top: b.y * s,
    width: b.width * s,
    height: b.height * s,
    pointerEvents: canInteract ? "auto" : "none",
    cursor: canInteract ? "move" : "inherit",
  };

  let inner: React.ReactNode;
  if (a.type === "highlight") {
    inner = <div className="h-full w-full opacity-40 mix-blend-multiply" style={{ background: a.color }} />;
  } else if (a.type === "whiteout") {
    inner = <div className="h-full w-full" style={{ background: a.color }} />;
  } else if (a.type === "rect") {
    inner = (
      <div
        className="h-full w-full"
        style={{ border: `${a.strokeWidth * s}px solid ${a.color}` }}
      />
    );
  } else if (a.type === "ellipse") {
    inner = (
      <div
        className="h-full w-full rounded-[50%]"
        style={{ border: `${a.strokeWidth * s}px solid ${a.color}` }}
      />
    );
  } else {
    const localX1 = (a.x - b.x) * s;
    const localY1 = (a.y - b.y) * s;
    const localX2 = (a.x + a.width - b.x) * s;
    const localY2 = (a.y + a.height - b.y) * s;
    inner = (
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <line
          x1={localX1}
          y1={localY1}
          x2={localX2}
          y2={localY2}
          stroke={a.color}
          strokeWidth={a.strokeWidth * s}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <div
      style={common}
      onPointerDown={(e) => {
        if (!canInteract || editing) return;
        e.stopPropagation();
        onBodyDown(e);
      }}
    >
      {inner}
      {selected && (
        <SelectionFrame onHandleDown={onHandleDown} />
      )}
    </div>
  );
}

function SelectionFrame({
  onHandleDown,
}: {
  onHandleDown: (h: Handle, e: React.PointerEvent) => void;
}) {
  return (
    <>
      <div className="pointer-events-none absolute -inset-px border-2 border-brand-500" />
      {HANDLES.map((h) => {
        const pos: React.CSSProperties = {
          nw: { left: -5, top: -5, cursor: "nwse-resize" },
          ne: { right: -5, top: -5, cursor: "nesw-resize" },
          sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
          se: { right: -5, bottom: -5, cursor: "nwse-resize" },
        }[h];
        return (
          <div
            key={h}
            role="button"
            aria-label={`Resize ${h}`}
            tabIndex={-1}
            onPointerDown={(e) => onHandleDown(h, e)}
            className="absolute h-2.5 w-2.5 rounded-sm border border-brand-600 bg-white shadow-sm"
            style={pos}
          />
        );
      })}
    </>
  );
}

/* ================= Text annotation ================= */

function fontCss(family: FontFamilyId): string {
  if (family === "times") return "'Times New Roman', Times, serif";
  if (family === "courier") return "'Courier New', Courier, monospace";
  return "Helvetica, Arial, sans-serif";
}

function TextItem({
  a,
  s,
  selected,
  editing,
  canInteract,
  onStartEdit,
  onEndEdit,
  onBodyDown,
  onHandleDown,
}: {
  a: TextAnnotation;
  s: number;
  selected: boolean;
  editing: boolean;
  canInteract: boolean;
  onStartEdit: () => void;
  onEndEdit: (text: string, heightPt: number) => void;
  onBodyDown: (e: React.PointerEvent) => void;
  onHandleDown: (h: Handle, e: React.PointerEvent) => void;
}) {
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    // Defer focus to the next frame so the browser finishes the default
    // mousedown handling (focus-shift) first — otherwise the box would be
    // blurred instantly and removed as empty.
    const raf = requestAnimationFrame(() => {
      const el = editRef.current;
      if (!el) return;
      el.innerText = a.text;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    const el = editRef.current;
    if (!el) return;
    onEndEdit(el.innerText.replace(/\u00a0/g, " "), el.scrollHeight / s);
  };

  const base: React.CSSProperties = {
    left: a.x * s,
    top: a.y * s,
    width: a.width * s,
    minHeight: a.fontSize * 1.35 * s,
    fontFamily: fontCss(a.fontFamily),
    fontSize: a.fontSize * s,
    lineHeight: 1.35,
    fontWeight: a.bold ? 700 : 400,
    fontStyle: a.italic ? "italic" : "normal",
    color: a.color,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  if (editing) {
    return (
      <div
        key="edit"
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        className="absolute z-20 outline-none ring-2 ring-brand-500"
        style={{ ...base, background: "rgba(255,255,255,0.85)", cursor: "text" }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.target as HTMLElement).blur();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLElement).blur();
          }
        }}
      />
    );
  }

  return (
    <div
      key="view"
      className="absolute"
      style={{
        ...base,
        minHeight: undefined,
        height: a.height * s,
        cursor: canInteract ? "move" : "inherit",
        padding: 1,
        margin: -1,
      }}
      onPointerDown={(e) => {
        if (!canInteract) return;
        e.stopPropagation();
        onBodyDown(e); // single click selects + starts move; dblclick opens editor
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
    >
      {a.text || " "}
      {selected && <SelectionFrame onHandleDown={onHandleDown} />}
    </div>
  );
}

/* ================= Native PDF text (edit existing text) ================= */

interface PdfTextStyle {
  fontFamily: FontFamilyId;
  bold: boolean;
  italic: boolean;
}

interface PdfLine extends PdfTextStyle {
  id: number;
  /** Box in PDF points (top-left origin). */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
}

/** Multiply two 2D affine matrices in pdf.js [a,b,c,d,e,f] form. */
function multMatrix(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

interface PdfFontObject {
  name?: string;
  psName?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  fallbackName?: string;
  systemFontInfo?: {
    baseFontName?: string;
    style?: { weight?: string; style?: string };
  };
}

/** Resolve bold/italic/family from a loaded PDF font object.
 * getTextContent only gives an internal id (e.g. "g_d0_f2"), so the real
 * name/flags must come from page.commonObjs (populated via getOperatorList).
 * Covers embedded subset names ("ABCDEE+Calibri-Bold") and system-font
 * substitution info (Helvetica-Bold, Arial-BoldMT, TimesNewRoman-Italic). */
function styleFromFontObject(fontObj: PdfFontObject | undefined, fallbackFamily?: string): PdfTextStyle {
  const raw = [fontObj?.name, fontObj?.psName, fontObj?.systemFontInfo?.baseFontName]
    .filter(Boolean)
    .join(" ");
  const n = raw.toLowerCase();
  const weight = fontObj?.systemFontInfo?.style?.weight;
  const slant = fontObj?.systemFontInfo?.style?.style;
  const bold =
    !!fontObj?.bold ||
    !!fontObj?.black ||
    /bold|black|heavy|demi|semibold|extrabold/.test(n) ||
    weight === "bold" ||
    (typeof weight === "string" && parseInt(weight, 10) >= 700);
  const italic =
    !!fontObj?.italic || /italic|oblique/.test(n) || slant === "italic";
  let fontFamily: FontFamilyId = "helvetica";
  if (/courier|monospace|consola|fixedsys/.test(n)) fontFamily = "courier";
  else if (/times|georgia|garamond|palatino|bookman|charter/.test(n))
    fontFamily = "times";
  else {
    const fb = `${fontObj?.fallbackName || ""} ${fallbackFamily || ""}`.toLowerCase();
    if (fb.includes("mono")) fontFamily = "courier";
    else if (fb.includes("serif") && !fb.includes("sans")) fontFamily = "times";
  }
  return { fontFamily, bold, italic };
}

function PdfTextLayer({
  doc,
  pageIndex,
  displayScale,
  cssW,
  cssH,
  active,
  visible,
  onReplace,
}: {
  doc: PDFDocumentProxy;
  pageIndex: number;
  displayScale: number;
  cssW: number;
  cssH: number;
  active: boolean;
  visible: boolean;
  onReplace: (
    pageIndex: number,
    box: { x: number; y: number; width: number; height: number },
    text: string,
    fontSize: number,
    style: PdfTextStyle,
  ) => void;
}) {
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [lines, setLines] = useState<PdfLine[] | null>(null);
  const [draft, setDraft] = useState<
    (PdfLine & { original: string; value: string }) | null
  >(null);

  // Extract native text boxes once the page is on screen. Boxes are computed
  // in PDF points, so zoom changes need no refetch.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      let page: PDFPageProxy | null = null;
      try {
        page = await doc.getPage(pageIndex + 1);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        if (cancelled) return;
        // getTextContent only yields internal font ids (e.g. "g_d0_f2"), so
        // resolve real names/flags via the operator list's loaded font objects.
        const fontObjs = new Map<string, PdfFontObject>();
        try {
          const ops = await page.getOperatorList();
          const OPS_SET_FONT = 37; // pdf.js OPS.setFont
          const ids = new Set<string>();
          for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === OPS_SET_FONT && typeof ops.argsArray[i]?.[0] === "string") {
              ids.add(ops.argsArray[i][0]);
            }
          }
          for (const id of ids) {
            try {
              if (page.commonObjs.has(id)) fontObjs.set(id, page.commonObjs.get(id));
            } catch { /* not resolved yet */ }
          }
        } catch { /* fall back to name guessing */ }
        const raws: {
          x: number;
          top: number;
          right: number;
          bottom: number;
          fs: number;
          text: string;
          style: PdfTextStyle;
        }[] = [];
        for (const raw of tc.items) {
          if (!("str" in raw) || !raw.str) continue;
          if (!raw.str.trim()) continue; // gap besar antar kolom datang sebagai item spasi — buang biar gap asli kelihatan dan jadi pemisah cluster
          const tx = multMatrix(vp.transform, raw.transform);
          const angle = Math.atan2(tx[1], tx[0]);
          // Skip vertical / rotated text (rare); we only edit horizontal lines.
          if (
            Math.abs(angle) > 0.08 &&
            Math.abs(Math.abs(angle) - Math.PI) > 0.08
          )
            continue;
          const fs = Math.hypot(tx[2], tx[3]);
          if (!(fs > 0.5)) continue;
          const w =
            typeof raw.width === "number" && raw.width > 0
              ? raw.width
              : raw.str.length * fs * 0.5;
          const x = tx[4];
          const top = tx[5] - fs;
          const fontId = "fontName" in raw ? (raw.fontName ?? "") : "";
          const style = styleFromFontObject(
            fontObjs.get(fontId),
            tc.styles?.[fontId]?.fontFamily,
          );
          raws.push({
            x,
            top,
            right: x + w,
            bottom: top + fs,
            fs,
            text: raw.str,
            style,
          });
        }
        raws.sort((a, b) => a.top - b.top || a.x - b.x);
        const accs: {
          top: number;
          bottom: number;
          fs: number;
          parts: {
            x: number;
            right: number;
            text: string;
            style: PdfTextStyle;
          }[];
        }[] = [];
        for (const r of raws) {
          const tol = Math.max(2, r.fs * 0.3);
          const acc = accs.find((a) => Math.abs(a.top - r.top) <= tol);
          if (acc) {
            acc.top = Math.min(acc.top, r.top);
            acc.bottom = Math.max(acc.bottom, r.bottom);
            acc.fs = Math.max(acc.fs, r.fs);
            acc.parts.push({ x: r.x, right: r.right, text: r.text, style: r.style });
          } else {
            accs.push({
              top: r.top,
              bottom: r.bottom,
              fs: r.fs,
              parts: [{ x: r.x, right: r.right, text: r.text, style: r.style }],
            });
          }
        }
        const built: PdfLine[] = [];
        let nextId = 0;
        for (const acc of accs) {
          acc.parts.sort((a, b) => a.x - b.x);
          // Split one visual row into separate segments when there is a big
          // horizontal gap (e.g. two columns / separate boxes in one row),
          // so editing one segment doesn't swallow its neighbor.
          const clusters: (typeof acc.parts)[] = [];
          let cursor = -Infinity;
          for (const p of acc.parts) {
            const last = clusters[clusters.length - 1];
            if (
              last &&
              last.length > 0 &&
              p.x - cursor > acc.fs * 1.0
            ) {
              clusters.push([]);
            }
            if (clusters.length === 0) clusters.push([]);
            clusters[clusters.length - 1].push(p);
            cursor = Math.max(cursor, p.right);
          }
          for (const parts of clusters) {
            let text = "";
            let cur = -Infinity;
            for (const p of parts) {
              if (
                text &&
                p.x - cur > acc.fs * 0.2 &&
                !text.endsWith(" ") &&
                !p.text.startsWith(" ")
              )
                text += " ";
              text += p.text;
              cur = Math.max(cur, p.right);
            }
            if (!text.trim()) continue;
            const x = Math.min(...parts.map((p) => p.x));
            const right = Math.max(...parts.map((p) => p.right));
            if (right - x < 1) continue;
            // Dominant style by character count.
            let total = 0;
            let boldChars = 0;
            let italicChars = 0;
            const famCount: Record<FontFamilyId, number> = {
              helvetica: 0,
              times: 0,
              courier: 0,
            };
            for (const p of parts) {
              const len = p.text.length;
              total += len;
              if (p.style.bold) boldChars += len;
              if (p.style.italic) italicChars += len;
              famCount[p.style.fontFamily] += len;
            }
            const fontFamily = (
              Object.entries(famCount).sort((a, b) => b[1] - a[1])[0]?.[0] ??
              "helvetica"
            ) as FontFamilyId;
            built.push({
              id: nextId++,
              x,
              y: acc.top,
              width: right - x,
              height: Math.max(acc.bottom - acc.top, acc.fs * 0.8),
              fontSize: acc.fs,
              text,
              fontFamily,
              bold: total > 0 && boldChars * 2 >= total,
              italic: total > 0 && italicChars * 2 >= total,
            });
          }
        }
        if (!cancelled) setLines(built);
      } catch {
        if (!cancelled) setLines([]);
      } finally {
        try {
          page?.cleanup();
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, visible]);

  useEffect(() => {
    if (draft) draftRef.current?.focus();
  }, [draft]);

  // Switching tools blurs the textarea first, which commits. So when the
  // tool is off there is nothing to show.
  if (!active) return null;

  const commit = () => {
    if (!draft) return;
    const clean = draft.value.trim();
    const box = {
      x: draft.x,
      y: draft.y,
      width: draft.width,
      height: draft.height,
    };
    const fontSize = draft.fontSize;
    const style: PdfTextStyle = {
      fontFamily: draft.fontFamily,
      bold: draft.bold,
      italic: draft.italic,
    };
    const unchanged = clean === draft.original.trim();
    setDraft(null);
    if (!clean || unchanged) return;
    onReplace(pageIndex, box, clean, fontSize, style);
  };

  return (
    <div className="absolute left-0 top-0" style={{ width: cssW, height: cssH }}>
      {lines !== null &&
        (lines.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <p className="rounded-lg bg-slate-900/80 px-3 py-1.5 text-center text-xs text-white">
              No selectable text on this page — scanned PDF?
            </p>
          </div>
        ) : (
          lines.map((l) => (
            <div
              key={l.id}
              onClick={() => setDraft({ ...l, original: l.text, value: l.text })}
              className="absolute rounded-[2px] transition-colors hover:bg-brand-500/25 hover:outline hover:outline-1 hover:outline-brand-500"
              style={{
                left: l.x * displayScale,
                top: l.y * displayScale,
                width: Math.max(l.width * displayScale, 4),
                height: l.height * displayScale,
                cursor: "text",
              }}
            />
          ))
        ))}
      {draft && (
        <textarea
          ref={draftRef}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setDraft(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          rows={1}
          style={{
            position: "absolute",
            left: draft.x * displayScale - 2,
            top: draft.y * displayScale - 2,
            width: Math.max(draft.width * displayScale + 8, 80),
            height: Math.max(
              draft.height * displayScale + 6,
              draft.fontSize * displayScale * 1.5,
            ),
            fontSize: draft.fontSize * displayScale,
            lineHeight: 1.3,
            fontFamily: fontCss(draft.fontFamily),
            fontWeight: draft.bold ? 700 : 400,
            fontStyle: draft.italic ? "italic" : "normal",
          }}
          className="z-20 resize-none overflow-hidden bg-white px-0.5 outline-none ring-2 ring-brand-500"
        />
      )}
    </div>
  );
}
