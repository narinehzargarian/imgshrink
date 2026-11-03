// The functions JavaScript calls. Plain C names and integers only, so they cross the
// WebAssembly boundary without a binding layer. Pixels come in through a buffer JavaScript
// allocates with ims_alloc; the result stays in this module until the next call.

#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdlib>
#include <exception>
#include <string>

#include "imgshrink/encode.h"
#include "imgshrink/image.h"
#include "imgshrink/quantize.h"
#include "imgshrink/resize.h"

namespace {

imgshrink::Bytes result;
int resultWidth = 0;
int resultHeight = 0;
std::string lastError;

enum Format { kJpeg = 0, kPng = 1, kPalettePng = 2 };

imgshrink::Image fromBuffer(const std::uint8_t* rgba, int width, int height) {
    imgshrink::Image image(width, height);
    std::copy(rgba, rgba + image.rgba.size(), image.rgba.begin());
    return image;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE std::uint8_t* ims_alloc(int size) { return static_cast<std::uint8_t*>(std::malloc(static_cast<std::size_t>(size))); }

EMSCRIPTEN_KEEPALIVE void ims_free(void* pointer) { std::free(pointer); }

// Resizes to fit within maxWidth x maxHeight (0 = no limit) and encodes. Returns 0 on success;
// on failure returns 1 and ims_error() says why.
EMSCRIPTEN_KEEPALIVE int ims_process(const std::uint8_t* rgba, int width, int height, int maxWidth, int maxHeight, int format,
                                     int quality, int colors, int dither, int backgroundRgb) {
    try {
        lastError.clear();
        imgshrink::Image image = fromBuffer(rgba, width, height);
        int outWidth = width, outHeight = height;
        imgshrink::fitWithin(width, height, maxWidth, maxHeight, outWidth, outHeight);
        if (outWidth != width || outHeight != height) image = imgshrink::resize(image, outWidth, outHeight);
        resultWidth = outWidth;
        resultHeight = outHeight;

        switch (format) {
            case kJpeg: {
                imgshrink::JpegOptions options;
                options.quality = quality;
                options.background = {static_cast<std::uint8_t>((backgroundRgb >> 16) & 0xFF), static_cast<std::uint8_t>((backgroundRgb >> 8) & 0xFF),
                                       static_cast<std::uint8_t>(backgroundRgb & 0xFF), 255};
                result = imgshrink::encodeJpeg(image, options);
                break;
            }
            case kPng:
                result = imgshrink::encodePng(image);
                break;
            case kPalettePng:
                result = imgshrink::encodePalettePng(imgshrink::quantize(image, colors, dither != 0));
                break;
            default:
                throw std::invalid_argument("unknown format");
        }
        return 0;
    } catch (const std::exception& e) {
        lastError = e.what();
        result.clear();
        return 1;
    }
}

// Only resizes, leaving RGBA pixels as the result. Used by the speed comparison with JavaScript.
EMSCRIPTEN_KEEPALIVE int ims_resize(const std::uint8_t* rgba, int width, int height, int outWidth, int outHeight) {
    try {
        lastError.clear();
        imgshrink::Image image = imgshrink::resize(fromBuffer(rgba, width, height), outWidth, outHeight);
        result.assign(image.rgba.begin(), image.rgba.end());
        resultWidth = outWidth;
        resultHeight = outHeight;
        return 0;
    } catch (const std::exception& e) {
        lastError = e.what();
        result.clear();
        return 1;
    }
}

EMSCRIPTEN_KEEPALIVE const std::uint8_t* ims_result_data() { return result.data(); }
EMSCRIPTEN_KEEPALIVE int ims_result_size() { return static_cast<int>(result.size()); }
EMSCRIPTEN_KEEPALIVE int ims_result_width() { return resultWidth; }
EMSCRIPTEN_KEEPALIVE int ims_result_height() { return resultHeight; }
EMSCRIPTEN_KEEPALIVE const char* ims_error() { return lastError.c_str(); }

}  // extern "C"
