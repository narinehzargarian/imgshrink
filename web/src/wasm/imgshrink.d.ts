// Types for the module Emscripten generates from core/ (built by scripts/build-wasm.sh).

export interface ImgshrinkModule {
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _ims_alloc(size: number): number;
  _ims_free(pointer: number): void;
  _ims_process(
    rgba: number,
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number,
    format: number,
    quality: number,
    colors: number,
    dither: number,
    backgroundRgb: number,
  ): number;
  _ims_resize(rgba: number, width: number, height: number, outWidth: number, outHeight: number): number;
  _ims_result_data(): number;
  _ims_result_size(): number;
  _ims_result_width(): number;
  _ims_result_height(): number;
  _ims_error(): number;
}

export interface ModuleOptions {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
}

export default function createImgshrink(options?: ModuleOptions): Promise<ImgshrinkModule>;
