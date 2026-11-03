# imgshrink

[![CI](https://github.com/narinehzargarian/imgshrink/actions/workflows/ci.yml/badge.svg)](https://github.com/narinehzargarian/imgshrink/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Resize and compress photos in your browser. **Nothing is uploaded:** the image processing is C++ compiled to WebAssembly, and it runs on your own device.

**Use it:** https://narinehzargarian.github.io/imgshrink/

- **Batches.** Drop in a folder's worth of photos, get them all back as one zip.
- **Smaller files.** Resize to a longest side (1920 px by default), re-encode as JPEG, or save logos and screenshots as PNG with fewer colors, which is often 60 to 80% smaller.
- **Correct colors.** Resizing is done in linear light with a Lanczos3 filter, so fine detail doesn't turn darker or blurrier the way it does in most quick resizers (see [the comparison](#how-it-compares)).
- **Phone photos come out upright.** The camera's rotation tag is applied before resizing.
- **Never worse.** If re-saving would make a file bigger without changing its size or format, you get the original back.
- **Private and offline.** No accounts, no tracking, no server. After the first visit it works without internet.

## Why not just use...

- **Squoosh** (Google) is excellent for fine-tuning one image at a time. imgshrink is for doing many at once with one setting.
- **Upload-based sites** send your photos to their servers. imgshrink can't: there is no server, only static files. You can check in your browser's developer tools (Network tab) that processing makes no requests.

## How it compares

Shrinking a 12-megapixel image (4000×3000) to 1600×1200 in Chrome, median of 5 runs, from `npm run bench`:

| Method | Time | Gray from a black and white checkerboard (correct: 188) |
| --- | --- | --- |
| imgshrink (C++ → WebAssembly) | **82 ms** | **188** |
| The same algorithm in plain TypeScript | 243 ms | 188 |
| The browser's canvas (`imageSmoothingQuality: "high"`) | 3 ms | 128 |

The WebAssembly build is about 3× faster than identical JavaScript, and the two produce the same pixels (within 1 level). The canvas is faster still because it runs on the GPU, but it averages sRGB values directly, so detail comes out too dark: a checkerboard should become 50% light (gray 188), and the canvas gives 128. Numbers are from one Mac; [`web/bench/results.json`](web/bench/results.json) has the details.

## How it works

```
your photo ──► browser decodes it ──► Web Worker ──► C++ in WebAssembly ──► file to download
               (JPEG, PNG, WebP...)     (off the       resize (Lanczos3, linear light)
                                         main thread)   JPEG (libjpeg) / PNG (libpng)
                                                        color reduction (median cut + k-means,
                                                        Floyd-Steinberg dithering)
```

| Part | Where |
| --- | --- |
| Resizing, color reduction, JPEG and PNG encoding | [`core/src`](core/src) (C++17) |
| The functions JavaScript calls | [`core/wasm/api.cpp`](core/wasm/api.cpp) |
| WebAssembly build (Emscripten, with its libjpeg and libpng ports) | [`scripts/build-wasm.sh`](scripts/build-wasm.sh) |
| Background workers, decoding, and the app | [`web/src`](web/src) (React, TypeScript, Vite) |
| Zip download, written from scratch | [`web/src/zip.ts`](web/src/zip.ts) |
| Offline support | [`web/public/sw.js`](web/public/sw.js) |

Up to three workers process photos in parallel, each with its own copy of the module. A large photo needs a few hundred MB while it's resized, so the count is capped.

## Limits

- **Output is JPEG or PNG.** WebP and AVIF output aren't supported yet.
- **Input is whatever your browser can open.** Chrome, Edge, and Firefox read JPEG, PNG, WebP, GIF, BMP, and AVIF. HEIC (iPhone) photos open only in Safari.
- **Metadata is removed.** Re-encoded files don't keep EXIF data such as camera model or GPS location. That's usually what you want when sharing photos, but it means dates and locations aren't carried over.
- **Very large images** (above about 50 megapixels) can run out of memory, depending on the device.

## Development

Needs Emscripten (`brew install emscripten`), CMake, GoogleTest, libjpeg, libpng, and Node 20 or later.

```sh
# C++ unit tests (native)
cmake -S core -B core/build -DCMAKE_BUILD_TYPE=Release
cmake --build core/build && core/build/imgshrink_tests

# Same tests with AddressSanitizer and UndefinedBehaviorSanitizer
cmake -S core -B core/build-asan -DIMGSHRINK_SANITIZE=ON && cmake --build core/build-asan && core/build-asan/imgshrink_tests

# WebAssembly build, then the web app
./scripts/build-wasm.sh
cd web
npm install
npx playwright install chromium
npm run dev          # local development
npm test             # unit tests, including the WebAssembly module under Node
npm run test:e2e     # browser tests against the production build
npm run bench        # the comparison above
```

On macOS with Homebrew, add `-DCMAKE_PREFIX_PATH="$(brew --prefix jpeg-turbo);$(brew --prefix libpng);$(brew --prefix googletest)"` to the first `cmake` command.

The test images in `web/test/fixtures` are generated by [`scripts/make_fixtures.py`](scripts/make_fixtures.py), so the repository contains no one else's photos.

## License

[MIT](LICENSE). Uses libjpeg (IJG license) and libpng and zlib (zlib-style licenses), built from Emscripten's ports.
