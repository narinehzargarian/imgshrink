#include <gtest/gtest.h>

#include <set>

#include "imgshrink/quantize.h"
#include "test_util.h"

using imgshrink::expand;
using imgshrink::Image;
using imgshrink::quantize;

TEST(Quantize, NeverUsesMoreColorsThanAsked) {
    const Image img = testutil::photoLike(200, 150);
    for (int colors : {2, 16, 64, 256}) {
        const auto out = quantize(img, colors, true);
        EXPECT_LE(out.palette.size(), static_cast<std::size_t>(colors));
        for (std::uint8_t i : out.indices) ASSERT_LT(i, out.palette.size());
    }
}

TEST(Quantize, KeepsAFewColorImageExactly) {
    // Like a logo or a screenshot: three flat colors, which a palette can hold losslessly.
    Image img(90, 30);
    const std::uint8_t colors[3][4] = {{230, 57, 70, 255}, {29, 53, 87, 255}, {241, 250, 238, 255}};
    for (int y = 0; y < 30; ++y) {
        for (int x = 0; x < 90; ++x) std::copy(colors[x / 30], colors[x / 30] + 4, img.pixel(x, y));
    }
    const auto out = quantize(img, 256, false);
    EXPECT_EQ(out.palette.size(), 3u);
    EXPECT_EQ(expand(out).rgba, img.rgba);
}

TEST(Quantize, A256ColorPaletteLooksCloseOnAPhoto) {
    const Image img = testutil::photoLike(400, 300);
    EXPECT_GT(testutil::psnr(expand(quantize(img, 256, false)), img), 32.0);
}

// Dithering trades per-pixel accuracy for getting the average color right over an area, which
// is what removes banding. Over each 8x8 block, the dithered average should be closer.
TEST(Quantize, DitheringKeepsAreaAveragesCloser) {
    const Image img = testutil::photoLike(256, 256);
    const Image plain = expand(quantize(img, 8, false));
    const Image dithered = expand(quantize(img, 8, true));
    auto blockError = [&](const Image& out) {
        double total = 0;
        for (int by = 0; by < 256; by += 8) {
            for (int bx = 0; bx < 256; bx += 8) {
                for (int c = 0; c < 3; ++c) {
                    double a = 0, b = 0;
                    for (int y = by; y < by + 8; ++y) {
                        for (int x = bx; x < bx + 8; ++x) {
                            a += img.pixel(x, y)[c];
                            b += out.pixel(x, y)[c];
                        }
                    }
                    total += std::abs(a - b) / 64.0;
                }
            }
        }
        return total;
    };
    EXPECT_LT(blockError(dithered), blockError(plain) * 0.6);
}

TEST(Quantize, KeepsTransparentPixelsTransparent) {
    Image img = testutil::photoLike(64, 64);
    for (int y = 0; y < 64; ++y) {
        for (int x = 0; x < 16; ++x) img.pixel(x, y)[3] = 0;
    }
    const Image out = expand(quantize(img, 32, true));
    for (int y = 0; y < 64; ++y) {
        for (int x = 0; x < 16; ++x) ASSERT_EQ(out.pixel(x, y)[3], 0) << x << "," << y;
        for (int x = 16; x < 64; ++x) ASSERT_EQ(out.pixel(x, y)[3], 255) << x << "," << y;
    }
}

TEST(Quantize, RejectsAnOutOfRangeColorCount) {
    EXPECT_THROW(quantize(testutil::solid(4, 4, 0, 0, 0), 1, false), std::invalid_argument);
    EXPECT_THROW(quantize(testutil::solid(4, 4, 0, 0, 0), 257, false), std::invalid_argument);
}
