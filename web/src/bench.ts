// Speed comparison, run by `npm run bench`: the C++ resize compiled to WebAssembly, the same
// algorithm in plain TypeScript, and the browser's built-in canvas resize. Each is timed on the
// main thread on the same synthetic 12-megapixel photo.
import createImgshrink from "./wasm/imgshrink.js";
import wasmUrl from "./wasm/imgshrink.wasm?url";
import { resizePixels } from "./engine";
import { resizeJs } from "./jsResize";

const W = 4000, H = 3000, OUT_W = 1600, OUT_H = 1200, RUNS = 5;

function makePhoto(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = (seed >>> 24) % 13 - 6;
      const p = (y * W + x) * 4;
      data[p] = (255 * x) / W + noise;
      data[p + 1] = (255 * y) / H + noise;
      data[p + 2] = 128 + 100 * Math.sin(x / 90) * Math.cos(y / 70) + noise;
      data[p + 3] = 255;
    }
  }
  return data;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function time(run: () => unknown | Promise<unknown>): Promise<number> {
  await run(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  return Math.round(median(times));
}

async function runBench() {
  const module = await createImgshrink({ locateFile: () => new URL(wasmUrl, location.href).href });
  const photo = makePhoto();

  const wasm = resizePixels(module, photo, W, H, OUT_W, OUT_H).bytes;
  const js = resizeJs(photo, W, H, OUT_W, OUT_H);
  let maxDifference = 0;
  for (let i = 0; i < js.length; i++) maxDifference = Math.max(maxDifference, Math.abs(js[i]! - wasm[i]!));

  const source = new OffscreenCanvas(W, H);
  source.getContext("2d")!.putImageData(new ImageData(photo, W, H), 0, 0);
  const canvasResize = () => {
    const target = new OffscreenCanvas(OUT_W, OUT_H);
    const context = target.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, OUT_W, OUT_H);
    return context.getImageData(0, 0, OUT_W, OUT_H); // forces the work to finish
  };

  // Quality check: a fine black and white checkerboard should shrink to 50% light, which is
  // gray 188 in sRGB. Averaging the sRGB numbers directly gives 128, visibly too dark.
  const B = 512;
  const board = new Uint8ClampedArray(B * B * 4);
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      const v = (x + y) % 2 ? 255 : 0;
      board.set([v, v, v, 255], (y * B + x) * 4);
    }
  }
  const wasmGray = resizePixels(module, board, B, B, 64, 64).bytes[(32 * 64 + 32) * 4]!;
  const boardCanvas = new OffscreenCanvas(B, B);
  boardCanvas.getContext("2d")!.putImageData(new ImageData(board, B, B), 0, 0);
  const smallBoard = new OffscreenCanvas(64, 64);
  const smallContext = smallBoard.getContext("2d")!;
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(boardCanvas, 0, 0, 64, 64);
  const canvasGray = smallContext.getImageData(32, 32, 1, 1).data[0]!;

  const results = {
    image: `${W}x${H} to ${OUT_W}x${OUT_H}`,
    checkerboardGray: { correct: 188, wasm: wasmGray, canvas: canvasGray },
    runs: RUNS,
    wasmMs: await time(() => resizePixels(module, photo, W, H, OUT_W, OUT_H)),
    jsMs: await time(() => resizeJs(photo, W, H, OUT_W, OUT_H)),
    canvasMs: await time(canvasResize),
    maxDifferenceWasmVsJs: maxDifference,
    userAgent: navigator.userAgent,
  };
  (window as unknown as { benchResults: typeof results }).benchResults = results;
}

void runBench();
