"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfJsModule = typeof import("pdfjs-dist");

let modulePromise: Promise<PdfJsModule> | null = null;

export async function loadPdfjs(): Promise<PdfJsModule> {
  if (!modulePromise) {
    modulePromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return modulePromise;
}

export interface PageInfo {
  index: number;
  /** Page size in PDF points. */
  width: number;
  height: number;
  rotation: number;
}

export async function openDocument(
  data: ArrayBuffer | Uint8Array<ArrayBufferLike>,
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  // Copy so pdf.js can transfer the buffer to the worker without detaching ours.
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data));
  return pdfjs.getDocument({ data: bytes }).promise;
}

export function viewportSize(page: PDFPageProxy): PageInfo {
  const vp = page.getViewport({ scale: 1 });
  return {
    index: page.pageNumber - 1,
    width: vp.width,
    height: vp.height,
    rotation: vp.rotation,
  };
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scaleCss: number,
): Promise<void> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scaleCss * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const task = page.render({
    canvas,
    canvasContext: canvas.getContext("2d")!,
    viewport,
  });
  await task.promise;
}

/** Render a page to a PNG data URL at a small scale (thumbnails). */
export async function pageThumbnail(
  page: PDFPageProxy,
  maxWidth: number,
): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = maxWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({
    canvas,
    canvasContext: canvas.getContext("2d")!,
    viewport,
  }).promise;
  return canvas.toDataURL("image/png");
}
