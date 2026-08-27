"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
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
    (async () => {
      try {
        const page = await doc.getPage(info.index + 1);
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
      d.moved = true;
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
      style={{ width: cssW, height: cssH, cursor }}
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
    return (
      <div
        className="absolute"
        style={{
          left: b.x * s,
          top: b.y * s,
          width: b.width * s,
          height: b.height * s,
        }}
        onPointerDown={(e) => {
          if (!canInteract || editing) return;
          e.stopPropagation();
          onBodyDown(e);
        }}
      >
        <svg
          className="absolute overflow-visible"
          style={{
            left: -b.x * s,
            top: -b.y * s,
            width: 0,
            height: 0,
          }}
        >
          <polyline
            fill="none"
            stroke={a.color}
            strokeWidth={a.strokeWidth * s}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={a.points.map((p) => `${p.x * s},${p.y * s}`).join(" ")}
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
