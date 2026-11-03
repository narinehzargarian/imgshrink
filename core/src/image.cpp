#include "imgshrink/image.h"

#include <algorithm>
#include <cmath>

namespace imgshrink {

void fitWithin(int width, int height, int maxWidth, int maxHeight, int& outWidth, int& outHeight) {
    double scale = 1.0;
    if (maxWidth > 0 && width > maxWidth) scale = std::min(scale, static_cast<double>(maxWidth) / width);
    if (maxHeight > 0 && height > maxHeight) scale = std::min(scale, static_cast<double>(maxHeight) / height);
    outWidth = std::max(1, static_cast<int>(std::lround(width * scale)));
    outHeight = std::max(1, static_cast<int>(std::lround(height * scale)));
    // Rounding must never push a side past its limit.
    if (maxWidth > 0) outWidth = std::min(outWidth, std::max(maxWidth, 1));
    if (maxHeight > 0) outHeight = std::min(outHeight, std::max(maxHeight, 1));
}

}  // namespace imgshrink
