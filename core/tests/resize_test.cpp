#include <gtest/gtest.h>

#include <cstdlib>

#include "imgshrink/resize.h"
#include "test_util.h"

using imgshrink::Image;
using imgshrink::resize;

TEST(Resize, ProducesTheRequestedSize) {
    const Image out = resize(testutil::photoLike(640, 480), 213, 160);
    EXPECT_EQ(out.width, 213);
    EXPECT_EQ(out.height, 160);
    EXPECT_EQ(out.rgba.size(), 213u * 160u * 4u);
}

TEST(Resize, KeepsASolidColorExactly) {
    const Image out = resize(testutil::solid(300, 200, 12, 140, 230), 97, 61);
    for (std::size_t p = 0; p < out.rgba.size(); p += 4) {
        ASSERT_EQ(out.rgba[p], 12);
        ASSERT_EQ(out.rgba[p + 1], 140);
        ASSERT_EQ(out.rgba[p + 2], 230);
        ASSERT_EQ(out.rgba[p + 3], 255);
    }
}

// A black and white checkerboard should average to 50% light, which is sRGB 188. Averaging the
// sRGB numbers directly gives 128, a visibly darker gray: the classic resizing mistake.
TEST(Resize, AveragesInLinearLight) {
    Image board(64, 64);
    for (int y = 0; y < 64; ++y) {
        for (int x = 0; x < 64; ++x) {
            const std::uint8_t v = ((x + y) % 2) ? 255 : 0;
            std::uint8_t* p = board.pixel(x, y);
            p[0] = p[1] = p[2] = v;
            p[3] = 255;
        }
    }
    const Image out = resize(board, 8, 8);
    for (int y = 1; y < 7; ++y) {
        for (int x = 1; x < 7; ++x) {
            EXPECT_NEAR(out.pixel(x, y)[0], 188, 2) << "at " << x << "," << y;
        }
    }
}

// The color stored in fully transparent pixels is invisible and often garbage. It must not
// bleed into the visible edge when shrinking.
TEST(Resize, TransparentPixelsDoNotBleedColor) {
    Image img(100, 100);
    for (int y = 0; y < 100; ++y) {
        for (int x = 0; x < 100; ++x) {
            std::uint8_t* p = img.pixel(x, y);
            if (x < 50) {  // invisible bright red
                p[0] = 255;
                p[1] = 0;
                p[2] = 0;
                p[3] = 0;
            } else {  // visible blue
                p[0] = 0;
                p[1] = 0;
                p[2] = 255;
                p[3] = 255;
            }
        }
    }
    const Image out = resize(img, 20, 20);
    for (int y = 0; y < 20; ++y) {
        for (int x = 0; x < 20; ++x) {
            const std::uint8_t* p = out.pixel(x, y);
            if (p[3] > 0) EXPECT_LE(p[0], 2) << "red bled into " << x << "," << y;
        }
    }
}

TEST(Resize, ShrinkingKeepsAPhotoCloseToTheOriginalLook) {
    // Shrink, then compare to the same image drawn directly at the small size.
    const Image big = testutil::photoLike(1200, 900);
    const Image small = resize(big, 300, 225);
    EXPECT_GT(testutil::psnr(small, testutil::photoLike(300, 225)), 35.0);
}

TEST(Resize, SameSizeReturnsTheImageUnchanged) {
    const Image img = testutil::photoLike(50, 40);
    EXPECT_EQ(resize(img, 50, 40).rgba, img.rgba);
}

TEST(Resize, RejectsZeroSizes) {
    EXPECT_THROW(resize(testutil::solid(10, 10, 0, 0, 0), 0, 5), std::invalid_argument);
}
