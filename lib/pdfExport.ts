"use client";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { Annotation, TextAnnotation } from "./annotations";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

/** WinAnsi-safe: strip characters standard fonts cannot encode. */
function sanitizeText(text: string): string {
  return text
    .split("")
    .map((ch) => (ch.codePointAt(0)! <= 0xff ? ch : ""))
    .join("");
}

function fontFor(
  a: TextAnnotation,
  fonts: Record<string, PDFFont>,
): PDFFont {
  const key = `${a.fontFamily}-${a.bold ? "b" : ""}${a.italic ? "i" : ""}`;
  return fonts[key] ?? fonts["helvetica-"];
}

async function embedImageBytes(
  doc: PDFDocument,
  dataUrl: string,
): Promise<PDFImage | null> {
  const res = await fetch(dataUrl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return doc.embedPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return doc.embedJpg(bytes);
  // Fallback: re-encode through canvas
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("bad image"));
      img.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const png = canvas.toDataURL("image/png");
    const res2 = await fetch(png);
    return doc.embedPng(new Uint8Array(await res2.arrayBuffer()));
  } catch {
    return null;
  }
}

export interface ExportResult {
  blob: Blob;
}

export async function exportEditedPdf(
  originalBytes: Uint8Array,
  annotationsByPage: Map<number, Annotation[]>,
): Promise<ExportResult> {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvO = await doc.embedFont(StandardFonts.HelveticaOblique);
  const helvBO = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const timesB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const timesI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBI = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const cour = await doc.embedFont(StandardFonts.Courier);
  const courB = await doc.embedFont(StandardFonts.CourierBold);
  const courO = await doc.embedFont(StandardFonts.CourierOblique);
  const courBI = await doc.embedFont(StandardFonts.CourierBoldOblique);

  const fonts: Record<string, PDFFont> = {
    "helvetica-bi": helvBO,
    "helvetica-b": helvB,
    "helvetica-i": helvO,
    "helvetica-": helv,
    "times-bi": timesBI,
    "times-b": timesB,
    "times-i": timesI,
    "times-": times,
    "courier-bi": courBI,
    "courier-b": courB,
    "courier-i": courO,
    "courier-": cour,
  };

  const pages = doc.getPages();

  for (const [pageIndex, annos] of annotationsByPage) {
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page: PDFPage = pages[pageIndex];
    const { height: ph } = page.getSize();

    for (const a of annos) {
      // Overlay coords are top-left origin; PDF is bottom-left.
      const yFromBottom = (y: number) => ph - y;

      if (a.type === "text") {
        const font = fontFor(a, fonts);
        const lineHeight = a.fontSize * 1.35;
        const lines = a.text.split("\n");
        lines.forEach((line, i) => {
          const x = a.x;
          let text = sanitizeText(line);
          while (text.length > 1 && font.widthOfTextAtSize(text, a.fontSize) > a.width) {
            text = text.slice(0, -1);
          }
          try {
            page.drawText(text, {
              x,
              y: yFromBottom(a.y + lineHeight * (i + 1) - lineHeight * 0.22),
              size: a.fontSize,
              font,
              color: rgb(...(Object.values(hexToRgb(a.color)) as [number, number, number])),
            });
          } catch {
            /* skip unencodable line */
          }
        });
      } else if (a.type === "draw") {
        const { r, g, b } = hexToRgb(a.color);
        for (let i = 1; i < a.points.length; i++) {
          const p0 = a.points[i - 1];
          const p1 = a.points[i];
          page.drawLine({
            start: { x: p0.x, y: yFromBottom(p0.y) },
            end: { x: p1.x, y: yFromBottom(p1.y) },
            thickness: a.strokeWidth,
            color: rgb(r, g, b),
            lineCap: 1,
          });
        }
      } else if (a.type === "image") {
        const img = await embedImageBytes(doc, a.dataUrl);
        if (!img) continue;
        page.drawImage(img, {
          x: a.x,
          y: yFromBottom(a.y + a.height),
          width: a.width,
          height: a.height,
        });
      } else {
        const { r, g, b } = hexToRgb(a.color);
        const color = rgb(r, g, b);
        const x = a.x;
        const w = Math.max(1, a.width);
        const h = Math.max(1, a.height);
        const top = yFromBottom(a.y);
        if (a.type === "highlight") {
          page.drawRectangle({
            x,
            y: top - h,
            width: w,
            height: h,
            color,
            opacity: 0.4,
          });
        } else if (a.type === "whiteout") {
          page.drawRectangle({ x, y: top - h, width: w, height: h, color });
        } else if (a.type === "rect") {
          page.drawRectangle({
            x,
            y: top - h,
            width: w,
            height: h,
            borderColor: color,
            borderWidth: a.strokeWidth,
          });
        } else if (a.type === "ellipse") {
          page.drawEllipse({
            x: x + w / 2,
            y: top - h / 2,
            xScale: w / 2,
            yScale: h / 2,
            borderColor: color,
            borderWidth: a.strokeWidth,
          });
        } else if (a.type === "line") {
          page.drawLine({
            start: { x, y: top },
            end: { x: x + w, y: top - h },
            thickness: a.strokeWidth,
            color,
          });
        }
      }
    }
  }

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes as unknown as BlobPart], {
      type: "application/pdf",
    }),
  };
}
