/// <reference lib="webworker" />
// Runs in the background: decodes the photo with the browser's own decoder, then resizes and
// encodes it with the C++ core compiled to WebAssembly. The page stays responsive meanwhile.
import createImgshrink from "./wasm/imgshrink.js";
import wasmUrl from "./wasm/imgshrink.wasm?url";
import { encode } from "./engine";
import { mimeType, type Options } from "./options";

export interface Job {
  id: number;
  file: File;
  options: Options;
}

export type JobResult =
  | { id: number; ok: true; bytes: ArrayBuffer; type: string; width: number; height: number; originalWidth: number; originalHeight: number; ms: number }
  | { id: number; ok: false; error: string };

export type WorkerMessage = { type: "ready"; urls: string[] } | { type: "result"; result: JobResult };

declare const self: DedicatedWorkerGlobalScope;

const engine = createImgshrink({ locateFile: () => new URL(wasmUrl, self.location.href).href });

engine.then(() => {
  // Tell the page which files this worker loaded, so the offline cache can keep them.
  const urls = [self.location.href, ...performance.getEntriesByType("resource").map((entry) => entry.name)];
  self.postMessage({ type: "ready", urls } satisfies WorkerMessage);
});

async function decode(file: File): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    // Applies the camera's rotation, so portrait phone photos come out upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't open this file as an image");
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Couldn't read the image's pixels");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<Job>) => {
  const { id, file, options } = event.data;
  const started = performance.now();
  try {
    const module = await engine;
    const pixels = await decode(file);
    const result = encode(module, pixels, options);
    const bytes = result.bytes.buffer as ArrayBuffer;
    const message: WorkerMessage = {
      type: "result",
      result: {
        id,
        ok: true,
        bytes,
        type: mimeType(options.format),
        width: result.width,
        height: result.height,
        originalWidth: pixels.width,
        originalHeight: pixels.height,
        ms: Math.round(performance.now() - started),
      },
    };
    self.postMessage(message, [bytes]);
  } catch (error) {
    self.postMessage({ type: "result", result: { id, ok: false, error: error instanceof Error ? error.message : String(error) } } satisfies WorkerMessage);
  }
};
