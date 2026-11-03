import { extension, type Format } from "./options";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** "-62%" for a smaller file, "+8%" for a larger one. */
export function formatChange(before: number, after: number): string {
  if (before <= 0) return "";
  const change = Math.round(((after - before) / before) * 100);
  return change <= 0 ? `${change}%` : `+${change}%`;
}

/** The output file name: same base name, new extension. "IMG_0042.HEIC" becomes "IMG_0042.jpg". */
export function outputName(original: string, format: Format): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original || "image";
  return `${base}.${extension(format)}`;
}
