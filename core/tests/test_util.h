#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <vector>

#include <jpeglib.h>
#include <png.h>

#include "imgshrink/encode.h"
#include "imgshrink/image.h"

namespace testutil {

inline imgshrink::Image solid(int w, int h, std::uint8_t r, std::uint8_t g, std::uint8_t b, std::uint8_t a = 255) {
    imgshrink::Image img(w, h);
    for (std::size_t p = 0; p < img.rgba.size(); p += 4) {
        img.rgba[p] = r;
        img.rgba[p + 1] = g;
        img.rgba[p + 2] = b;
        img.rgba[p + 3] = a;
    }
    return img;
}

// A smooth, photo-like test image: diagonal color gradients plus a soft circle.
inline imgshrink::Image photoLike(int w, int h) {
    imgshrink::Image img(w, h);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            std::uint8_t* p = img.pixel(x, y);
            const double dx = x - w / 2.0, dy = y - h / 2.0;
            const double circle = std::exp(-(dx * dx + dy * dy) / (w * h / 8.0));
            p[0] = static_cast<std::uint8_t>(255.0 * x / (w - 1));
            p[1] = static_cast<std::uint8_t>(255.0 * y / (h - 1));
            p[2] = static_cast<std::uint8_t>(255.0 * circle);
            p[3] = 255;
        }
    }
    return img;
}

// photoLike plus the grain a real camera sensor adds (deterministic, so tests are repeatable).
// Smooth computer-made gradients compress unrealistically well as lossless PNG; real photos don't.
inline imgshrink::Image noisyPhoto(int w, int h) {
    imgshrink::Image img = photoLike(w, h);
    std::uint32_t state = 12345;
    for (std::size_t p = 0; p < img.rgba.size(); p += 4) {
        for (int c = 0; c < 3; ++c) {
            state = state * 1664525u + 1013904223u;
            const int noise = static_cast<int>((state >> 24) % 13) - 6;  // -6 to +6
            img.rgba[p + c] = static_cast<std::uint8_t>(std::clamp(img.rgba[p + c] + noise, 0, 255));
        }
    }
    return img;
}

// Peak signal-to-noise ratio over RGB, in dB. Above about 35 dB differences are hard to see.
inline double psnr(const imgshrink::Image& a, const imgshrink::Image& b) {
    if (a.width != b.width || a.height != b.height) throw std::invalid_argument("psnr: size mismatch");
    double sum = 0;
    std::size_t n = 0;
    for (std::size_t p = 0; p < a.rgba.size(); p += 4) {
        for (int c = 0; c < 3; ++c, ++n) {
            const double d = static_cast<double>(a.rgba[p + c]) - b.rgba[p + c];
            sum += d * d;
        }
    }
    const double mse = sum / n;
    return mse == 0 ? 99.0 : 10.0 * std::log10(255.0 * 255.0 / mse);
}

inline imgshrink::Image decodeJpeg(const imgshrink::Bytes& bytes) {
    jpeg_decompress_struct cinfo{};
    jpeg_error_mgr jerr{};
    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_decompress(&cinfo);
    jpeg_mem_src(&cinfo, bytes.data(), static_cast<unsigned long>(bytes.size()));
    jpeg_read_header(&cinfo, TRUE);
    cinfo.out_color_space = JCS_RGB;
    jpeg_start_decompress(&cinfo);
    imgshrink::Image img(static_cast<int>(cinfo.output_width), static_cast<int>(cinfo.output_height));
    std::vector<std::uint8_t> row(cinfo.output_width * 3);
    while (cinfo.output_scanline < cinfo.output_height) {
        const int y = static_cast<int>(cinfo.output_scanline);
        JSAMPROW r = row.data();
        jpeg_read_scanlines(&cinfo, &r, 1);
        for (int x = 0; x < img.width; ++x) {
            std::uint8_t* p = img.pixel(x, y);
            p[0] = row[x * 3];
            p[1] = row[x * 3 + 1];
            p[2] = row[x * 3 + 2];
            p[3] = 255;
        }
    }
    jpeg_finish_decompress(&cinfo);
    jpeg_destroy_decompress(&cinfo);
    return img;
}

inline imgshrink::Image decodePng(const imgshrink::Bytes& bytes) {
    png_image image{};
    image.version = PNG_IMAGE_VERSION;
    if (!png_image_begin_read_from_memory(&image, bytes.data(), bytes.size())) throw std::runtime_error(image.message);
    image.format = PNG_FORMAT_RGBA;
    imgshrink::Image img(static_cast<int>(image.width), static_cast<int>(image.height));
    if (!png_image_finish_read(&image, nullptr, img.rgba.data(), 0, nullptr)) throw std::runtime_error(image.message);
    return img;
}

}  // namespace testutil
