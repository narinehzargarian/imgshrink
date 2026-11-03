#pragma once

#include <cstdint>
#include <vector>

namespace imgshrink {

// An 8-bit RGBA image, rows top to bottom, not premultiplied. This is the layout the browser's
// ImageData uses, so pixels move between JavaScript and C++ without conversion.
struct Image {
    int width = 0;
    int height = 0;
    std::vector<std::uint8_t> rgba;  // width * height * 4 bytes

    Image() = default;
    Image(int w, int h) : width(w), height(h), rgba(static_cast<std::size_t>(w) * h * 4, 0) {}

    std::uint8_t* pixel(int x, int y) { return &rgba[(static_cast<std::size_t>(y) * width + x) * 4]; }
    const std::uint8_t* pixel(int x, int y) const { return &rgba[(static_cast<std::size_t>(y) * width + x) * 4]; }
};

// The largest size that fits inside maxWidth x maxHeight without changing the aspect ratio or
// enlarging the image. A limit of 0 means no limit on that side.
void fitWithin(int width, int height, int maxWidth, int maxHeight, int& outWidth, int& outHeight);

}  // namespace imgshrink
