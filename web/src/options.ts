export type Format = "jpeg" | "png" | "png-palette";

export interface Options {
  format: Format;
  /** JPEG quality, 1 to 100. */
  quality: number;
  /** Longest side in pixels; 0 keeps the original size. Images are never enlarged. */
  maxSide: number;
  /** For "png-palette": the most colors to keep, 2 to 256. */
  colors: number;
  /** For "png-palette": spread rounding error to avoid banding. */
  dither: boolean;
  /** JPEG has no transparency; transparent areas become this color. */
  background: string;
}

export const DEFAULT_OPTIONS: Options = {
  format: "jpeg",
  quality: 80,
  maxSide: 1920,
  colors: 256,
  dither: true,
  background: "#ffffff",
};

export const SIZE_CHOICES = [0, 3840, 2560, 1920, 1600, 1280, 1024, 800, 640];
export const COLOR_CHOICES = [256, 128, 64, 32, 16, 8];

const FORMAT_CODES: Record<Format, number> = { jpeg: 0, png: 1, "png-palette": 2 };
export const formatCode = (format: Format) => FORMAT_CODES[format];

export const mimeType = (format: Format) => (format === "jpeg" ? "image/jpeg" : "image/png");
export const extension = (format: Format) => (format === "jpeg" ? "jpg" : "png");

/** Fills in anything missing or invalid, so old or edited saved settings can't break the app. */
export function normalizeOptions(value: unknown): Options {
  const v = (value ?? {}) as Partial<Options>;
  const pick = <T>(ok: boolean, given: T, fallback: T) => (ok ? given : fallback);
  return {
    format: pick(v.format === "jpeg" || v.format === "png" || v.format === "png-palette", v.format!, DEFAULT_OPTIONS.format),
    quality: pick(Number.isInteger(v.quality) && v.quality! >= 1 && v.quality! <= 100, v.quality!, DEFAULT_OPTIONS.quality),
    maxSide: pick(Number.isInteger(v.maxSide) && v.maxSide! >= 0 && v.maxSide! <= 20000, v.maxSide!, DEFAULT_OPTIONS.maxSide),
    colors: pick(Number.isInteger(v.colors) && v.colors! >= 2 && v.colors! <= 256, v.colors!, DEFAULT_OPTIONS.colors),
    dither: pick(typeof v.dither === "boolean", v.dither!, DEFAULT_OPTIONS.dither),
    background: pick(typeof v.background === "string" && /^#[0-9a-f]{6}$/i.test(v.background), v.background!, DEFAULT_OPTIONS.background),
  };
}
