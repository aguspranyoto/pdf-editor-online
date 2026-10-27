export type ToolId =
  | "select"
  | "text"
  | "editText"
  | "draw"
  | "highlight"
  | "whiteout"
  | "image"
  | "rect"
  | "ellipse"
  | "line";

/** crypto.randomUUID is unavailable in insecure contexts (plain LAN IP). */
export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type FontFamilyId = "helvetica" | "times" | "courier";

export interface Point {
  x: number;
  y: number;
}

interface BaseAnnotation {
  id: string;
  pageIndex: number;
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  fontFamily: FontFamilyId;
  bold: boolean;
  italic: boolean;
}

export interface DrawAnnotation extends BaseAnnotation {
  type: "draw";
  points: Point[];
  color: string;
  strokeWidth: number;
}

export type ShapeKind = "rect" | "ellipse" | "line" | "highlight" | "whiteout";

export interface ShapeAnnotation extends BaseAnnotation {
  type: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
}

export interface ImageAnnotation extends BaseAnnotation {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type Annotation =
  | TextAnnotation
  | DrawAnnotation
  | ShapeAnnotation
  | ImageAnnotation;

/** Rough bounding box used for hit testing / selection UI. */
export function annoBounds(a: Annotation): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (a.type === "draw") {
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    const minX = Math.min(...xs) - a.strokeWidth;
    const minY = Math.min(...ys) - a.strokeWidth;
    return {
      x: minX,
      y: minY,
      width: Math.max(...xs) + a.strokeWidth - minX,
      height: Math.max(...ys) + a.strokeWidth - minY,
    };
  }
  if (a.type === "line") {
    const x1 = a.x;
    const y1 = a.y;
    const x2 = a.x + a.width;
    const y2 = a.y + a.height;
    const pad = a.strokeWidth;
    return {
      x: Math.min(x1, x2) - pad,
      y: Math.min(y1, y2) - pad,
      width: Math.abs(x2 - x1) + 2 * pad,
      height: Math.abs(y2 - y1) + 2 * pad,
    };
  }
  if (a.type === "text") return { x: a.x, y: a.y, width: a.width, height: a.height };
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.type === "draw") {
    return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { ...a, x: a.x + dx, y: a.y + dy };
}

/** Scale a bounded annotation by corner-resize deltas, in page points. */
export function resizeAnnotation(
  a: Annotation,
  handle: "nw" | "ne" | "sw" | "se",
  dx: number,
  dy: number,
): Annotation {
  const b = annoBounds(a);
  let nx = b.x;
  let ny = b.y;
  let nw = b.width + dx;
  let nh = b.height + dy;
  if (handle.includes("w")) {
    nx = b.x + dx;
    nw = b.width - dx;
  }
  if (handle.includes("n")) {
    ny = b.y + dy;
    nh = b.height - dy;
  }
  nw = Math.max(8, nw);
  nh = Math.max(8, nh);
  if (handle.includes("w")) nx = b.x + b.width - nw;
  if (handle.includes("n")) ny = b.y + b.height - nh;

  switch (a.type) {
    case "text":
      return { ...a, x: nx, y: ny, width: nw, height: nh };
    case "line": {
      const ob = annoBounds(a);
      if (ob.width === 0 || ob.height === 0) {
        return { ...a, x: nx, y: ny, width: nw, height: nh };
      }
      const sx = nw / ob.width;
      const sy = nh / ob.height;
      const x1 = nx + (a.x - ob.x) * sx;
      const y1 = ny + (a.y - ob.y) * sy;
      const x2 = nx + (a.x + a.width - ob.x) * sx;
      const y2 = ny + (a.y + a.height - ob.y) * sy;
      return { ...a, x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    case "draw": {
      const sx = nw / b.width || 1;
      const sy = nh / b.height || 1;
      return {
        ...a,
        points: a.points.map((p) => ({
          x: nx + (p.x - b.x) * sx,
          y: ny + (p.y - b.y) * sy,
        })),
      };
    }
    default:
      return { ...a, x: nx, y: ny, width: nw, height: nh };
  }
}
