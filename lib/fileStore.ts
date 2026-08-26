"use client";

/**
 * Hands a file chosen on the landing page to a tool page after navigation.
 * Module-level singleton — lives only for the current tab session.
 */
let pendingFile: File | null = null;
let pendingFiles: File[] | null = null;

export function setPendingFiles(files: File[]) {
  pendingFiles = files.length > 1 ? files : null;
  pendingFile = files[0] ?? null;
}

export function takePendingFile(): File | null {
  const f = pendingFile;
  pendingFile = null;
  return f;
}

export function takePendingFiles(): File[] | null {
  const f = pendingFiles;
  pendingFiles = null;
  return f;
}
