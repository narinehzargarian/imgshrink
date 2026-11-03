#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "imgshrink/image.h"
#include "imgshrink/quantize.h"

namespace imgshrink {

using Bytes = std::vector<std::uint8_t>;

// JPEG has no transparency, so transparent pixels are blended onto this background first.
struct JpegOptions {
    int quality = 80;            // 1 to 100
    bool progressive = true;     // usually smaller, and loads blurry-to-sharp on slow connections
    Color background = {255, 255, 255, 255};
};

// Encodes a JPEG with optimized Huffman tables. Throws std::runtime_error on failure.
Bytes encodeJpeg(const Image& image, const JpegOptions& options);

// Encodes a full-color PNG (lossless). Throws std::runtime_error on failure.
Bytes encodePng(const Image& image);

// Encodes a palette PNG, with per-color transparency when the palette has any. Throws
// std::runtime_error on failure.
Bytes encodePalettePng(const PalettedImage& image);

}  // namespace imgshrink
