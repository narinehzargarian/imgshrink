import type { ImgshrinkModule } from "./wasm/imgshrink.js";
import { formatCode, type Options } from "./options";

export interface Encoded {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Copies pixels into WebAssembly memory, runs `call`, and always frees the copy. */
function withPixels<T>(module: ImgshrinkModule, rgba: Uint8ClampedArray | Uint8Array, call: (pointer: number) => T): T {
  const pointer = module._ims_alloc(rgba.length);
  if (!pointer) throw new Error("Not enough memory for this image");
  try {
    // Read HEAPU8 fresh each time: it's replaced when WebAssembly memory grows.
    module.HEAPU8.set(rgba, pointer);
    return call(pointer);
  } finally {
    module._ims_free(pointer);
  }
}

function takeResult(module: ImgshrinkModule, status: number): Encoded {
  if (status !== 0) throw new Error(module.UTF8ToString(module._ims_error()) || "Processing failed");
  const start = module._ims_result_data();
  const bytes = module.HEAPU8.slice(start, start + module._ims_result_size());
  return { bytes, width: module._ims_result_width(), height: module._ims_result_height() };
}

/** Resizes and encodes RGBA pixels with the C++ core. */
export function encode(module: ImgshrinkModule, pixels: ImageData | { data: Uint8ClampedArray; width: number; height: number }, options: Options): Encoded {
  const background = parseInt(options.background.slice(1), 16);
  return withPixels(module, pixels.data, (pointer) =>
    takeResult(
      module,
      module._ims_process(
        pointer,
        pixels.width,
        pixels.height,
        options.maxSide,
        options.maxSide,
        formatCode(options.format),
        options.quality,
        options.colors,
        options.dither ? 1 : 0,
        background,
      ),
    ),
  );
}

/** Only resizes, returning RGBA pixels. Used by the speed comparison. */
export function resizePixels(module: ImgshrinkModule, rgba: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number): Encoded {
  return withPixels(module, rgba, (pointer) => takeResult(module, module._ims_resize(pointer, width, height, outWidth, outHeight)));
}
