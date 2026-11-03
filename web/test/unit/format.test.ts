import { describe, expect, it } from "vitest";
import { formatBytes, formatChange, outputName } from "../../src/format";
import { DEFAULT_OPTIONS, normalizeOptions } from "../../src/options";

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(250 * 1024)).toBe("250 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.25 MB");
  });
});

describe("formatChange", () => {
  it("shows savings as negative and growth as positive", () => {
    expect(formatChange(1000, 380)).toBe("-62%");
    expect(formatChange(1000, 1080)).toBe("+8%");
    expect(formatChange(1000, 1000)).toBe("0%");
    expect(formatChange(0, 10)).toBe("");
  });
});

describe("outputName", () => {
  it("keeps the base name and swaps the extension", () => {
    expect(outputName("IMG_0042.HEIC", "jpeg")).toBe("IMG_0042.jpg");
    expect(outputName("logo.final.png", "png-palette")).toBe("logo.final.png");
    expect(outputName("noext", "png")).toBe("noext.png");
    expect(outputName(".hidden", "jpeg")).toBe(".hidden.jpg");
  });
});

describe("normalizeOptions", () => {
  it("falls back to defaults for missing or invalid saved settings", () => {
    expect(normalizeOptions(null)).toEqual(DEFAULT_OPTIONS);
    expect(normalizeOptions("garbage")).toEqual(DEFAULT_OPTIONS);
    const fixed = normalizeOptions({ format: "gif", quality: 500, maxSide: 1280, colors: 1, dither: "yes", background: "red" });
    expect(fixed).toEqual({ ...DEFAULT_OPTIONS, maxSide: 1280 });
  });
});
