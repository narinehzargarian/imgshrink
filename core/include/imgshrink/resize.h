#pragma once

#include "imgshrink/image.h"

namespace imgshrink {

// Resizes with a Lanczos3 filter, the filter photo editors use for sharp downscaling.
//
// The work is done in linear light with premultiplied alpha. Averaging sRGB values directly
// darkens fine detail, and averaging without premultiplying lets the color of fully transparent
// pixels bleed into the edges of transparent images.
Image resize(const Image& source, int width, int height);

}  // namespace imgshrink
