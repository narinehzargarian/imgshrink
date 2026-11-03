#include <gtest/gtest.h>

#include "imgshrink/encode.h"
#include "imgshrink/quantize.h"
#include "test_util.h"

using imgshrink::Image;

TEST(Jpeg, DecodesBackToTheSameSizeAndLooksClose) {
    const Image img = testutil::photoLike(320, 240);
    imgshrink::JpegOptions options;
    options.quality = 90;
    const Image back = testutil::decodeJpeg(imgshrink::encodeJpeg(img, options));
    EXPECT_EQ(back.width, 320);
    EXPECT_EQ(back.height, 240);
    EXPECT_GT(testutil::psnr(back, img), 35.0);
}

TEST(Jpeg, LowerQualityMeansASmallerFile) {
    const Image img = testutil::photoLike(400, 300);
    imgshrink::JpegOptions high, low;
    high.quality = 95;
    low.quality = 50;
    EXPECT_LT(imgshrink::encodeJpeg(img, low).size(), imgshrink::encodeJpeg(img, high).size());
}

TEST(Jpeg, BlendsTransparencyOntoTheBackground) {
    const Image clear = testutil::solid(32, 32, 0, 0, 0, 0);
    imgshrink::JpegOptions options;
    options.quality = 95;
    options.background = {255, 255, 255, 255};
    const Image back = testutil::decodeJpeg(imgshrink::encodeJpeg(clear, options));
    EXPECT_GE(back.pixel(16, 16)[0], 250);
    EXPECT_GE(back.pixel(16, 16)[1], 250);
}

TEST(Jpeg, ProgressiveAndBaselineBothDecode) {
    const Image img = testutil::photoLike(64, 48);
    imgshrink::JpegOptions options;
    options.progressive = false;
    EXPECT_EQ(testutil::decodeJpeg(imgshrink::encodeJpeg(img, options)).width, 64);
    options.progressive = true;
    EXPECT_EQ(testutil::decodeJpeg(imgshrink::encodeJpeg(img, options)).width, 64);
}

TEST(Png, IsLossless) {
    Image img = testutil::photoLike(120, 80);
    img.pixel(5, 5)[3] = 100;  // some transparency
    EXPECT_EQ(testutil::decodePng(imgshrink::encodePng(img)).rgba, img.rgba);
}

TEST(Png, DropsTheAlphaChannelWhenTheImageIsOpaque) {
    const auto bytes = imgshrink::encodePng(testutil::photoLike(16, 16));
    // Byte 25 of a PNG is the color type in its header: 2 is RGB, 6 is RGBA.
    EXPECT_EQ(bytes.at(25), 2);
}

TEST(PalettePng, DecodesToExactlyTheQuantizedImage) {
    Image img = testutil::photoLike(150, 100);
    for (int y = 0; y < 100; ++y) img.pixel(0, y)[3] = 0;
    const auto paletted = imgshrink::quantize(img, 64, true);
    EXPECT_EQ(testutil::decodePng(imgshrink::encodePalettePng(paletted)).rgba, imgshrink::expand(paletted).rgba);
}

TEST(PalettePng, UsesFewerBitsForFewerColors) {
    // Two colors need only 1 bit per pixel. Byte 24 of a PNG is the bit depth.
    Image img(64, 64);
    for (int y = 0; y < 64; ++y) {
        for (int x = 0; x < 64; ++x) {
            std::uint8_t* p = img.pixel(x, y);
            p[0] = p[1] = p[2] = (x < 32) ? 0 : 255;
            p[3] = 255;
        }
    }
    const auto paletted = imgshrink::quantize(img, 256, false);
    ASSERT_EQ(paletted.palette.size(), 2u);
    const auto bytes = imgshrink::encodePalettePng(paletted);
    EXPECT_EQ(bytes.at(24), 1);
    EXPECT_EQ(testutil::decodePng(bytes).rgba, img.rgba);
}

TEST(PalettePng, IsMuchSmallerThanFullColorPngForAPhoto) {
    const Image img = testutil::noisyPhoto(400, 300);
    const auto full = imgshrink::encodePng(img);
    const auto palette = imgshrink::encodePalettePng(imgshrink::quantize(img, 256, true));
    EXPECT_LT(palette.size(), full.size() / 2);
}
