#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "imgshrink/image.h"

namespace imgshrink {

using Color = std::array<std::uint8_t, 4>;  // RGBA

struct PalettedImage {
    int width = 0;
    int height = 0;
    std::vector<Color> palette;          // at most 256 entries
    std::vector<std::uint8_t> indices;   // one palette index per pixel
};

// Reduces an image to at most maxColors colors (2 to 256), so it can be saved as a small
// palette PNG. Picks the palette with median cut, refines it with a few rounds of k-means,
// and, if dither is set, spreads the rounding error to neighboring pixels (Floyd-Steinberg)
// so gradients don't turn into visible bands.
PalettedImage quantize(const Image& image, int maxColors, bool dither);

// Turns a paletted image back into RGBA, for tests and previews.
Image expand(const PalettedImage& image);

}  // namespace imgshrink
