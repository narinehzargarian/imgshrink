// Runs the real WebAssembly module (built by scripts/build-wasm.sh) under Node, through the same
// TypeScript wrapper the browser worker uses.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { encode, resizePixels } from "../../src/engine";
import { resizeJs } from "../../src/jsResize";
import { DEFAULT_OPTIONS, type Options } from "../../src/options";
import createImgshrink, { type ImgshrinkModule } from "../../src/wasm/imgshrink.js";

let module: ImgshrinkModule;

beforeAll(async () => {
  module = await createImgshrink({ wasmBinary: readFileSync(new URL("../../src/wasm/imgshrink.wasm", import.meta.url)) });
});

function photo(width: number, height: number, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = (255 * x) / width;
      data[p + 1] = (255 * y) / height;
      data[p + 2] = 128 + 100 * Math.sin(x / 9) * Math.cos(y / 7);
      data[p + 3] = alpha;
    }
  }
  return { data, width, height };
}

const opts = (change: Partial<Options>): Options => ({ ...DEFAULT_OPTIONS, ...change });
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

describe("encode", () => {
  it("makes a JPEG that fits the longest-side limit and keeps the aspect ratio", () => {
    const out = encode(module, photo(800, 600), opts({ format: "jpeg", maxSide: 400 }));
    expect(startsWith(out.bytes, [0xff, 0xd8, 0xff])).toBe(true);
    expect([out.width, out.height]).toEqual([400, 300]);
  });

  it("never enlarges a small image", () => {
    const out = encode(module, photo(120, 90), opts({ maxSide: 1920 }));
    expect([out.width, out.height]).toEqual([120, 90]);
  });

  it("makes PNGs, and the fewer-colors PNG is smaller", () => {
    const image = photo(300, 200);
    const full = encode(module, image, opts({ format: "png", maxSide: 0 }));
    const palette = encode(module, image, opts({ format: "png-palette", maxSide: 0, colors: 64 }));
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(startsWith(full.bytes, signature)).toBe(true);
    expect(startsWith(palette.bytes, signature)).toBe(true);
    expect(palette.bytes.length).toBeLessThan(full.bytes.length);
  });

  it("reports C++ errors as JavaScript errors", () => {
    expect(() => encode(module, photo(10, 10), opts({ quality: 0 }))).toThrow(/quality must be 1 to 100/);
  });

  it("keeps working after an error and across many calls (no leaked memory blocks)", () => {
    for (let i = 0; i < 50; i++) encode(module, photo(64, 64), opts({ maxSide: 32 }));
    expect(encode(module, photo(64, 64), opts({ maxSide: 32 })).width).toBe(32);
  });
});

describe("resizePixels", () => {
  it("matches the TypeScript version of the same algorithm", () => {
    const image = photo(400, 300);
    const wasm = resizePixels(module, image.data, 400, 300, 160, 120).bytes;
    const js = resizeJs(image.data, 400, 300, 160, 120);
    let maxDifference = 0;
    for (let i = 0; i < js.length; i++) maxDifference = Math.max(maxDifference, Math.abs(js[i]! - wasm[i]!));
    expect(maxDifference).toBeLessThanOrEqual(1);
  });
});
