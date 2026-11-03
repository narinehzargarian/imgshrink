#!/usr/bin/env bash
# Compiles the C++ core to WebAssembly for the browser. Needs Emscripten (em++) on the PATH.
# Emscripten downloads and builds its libjpeg and libpng ports the first time, then caches them.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/web/src/wasm"
mkdir -p "$out"

em++ \
  "$root/core/src/image.cpp" \
  "$root/core/src/resize.cpp" \
  "$root/core/src/quantize.cpp" \
  "$root/core/src/encode.cpp" \
  "$root/core/wasm/api.cpp" \
  -I"$root/core/include" \
  -std=c++17 -O3 -fexceptions \
  -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createImgshrink \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS='["_ims_alloc","_ims_free","_ims_process","_ims_resize","_ims_result_data","_ims_result_size","_ims_result_width","_ims_result_height","_ims_error"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","UTF8ToString"]' \
  -o "$out/imgshrink.js"

ls -l "$out"
