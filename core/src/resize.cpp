#include "imgshrink/resize.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace imgshrink {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kLobes = 3.0;  // Lanczos3

double sinc(double x) {
    if (x == 0.0) return 1.0;
    x *= kPi;
    return std::sin(x) / x;
}

double lanczos(double x) {
    x = std::fabs(x);
    return x < kLobes ? sinc(x) * sinc(x / kLobes) : 0.0;
}

// sRGB to linear, as a 256-entry table since inputs are 8-bit.
const std::array<float, 256>& toLinearTable() {
    static const std::array<float, 256> table = [] {
        std::array<float, 256> t{};
        for (int i = 0; i < 256; ++i) {
            const double c = i / 255.0;
            t[i] = static_cast<float>(c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4));
        }
        return t;
    }();
    return table;
}

// Linear to sRGB, through a 4096-entry table: finer than 8-bit output needs, and much faster
// than calling pow for every pixel.
const std::array<std::uint8_t, 4096>& toSrgbTable() {
    static const std::array<std::uint8_t, 4096> table = [] {
        std::array<std::uint8_t, 4096> t{};
        for (int i = 0; i < 4096; ++i) {
            const double l = i / 4095.0;
            const double s = l <= 0.0031308 ? l * 12.92 : 1.055 * std::pow(l, 1.0 / 2.4) - 0.055;
            t[i] = static_cast<std::uint8_t>(std::lround(std::clamp(s, 0.0, 1.0) * 255.0));
        }
        return t;
    }();
    return table;
}

std::uint8_t linearToSrgb(float l) {
    const int i = static_cast<int>(std::clamp(l, 0.0f, 1.0f) * 4095.0f + 0.5f);
    return toSrgbTable()[i];
}

// For each output pixel along one axis: the first source pixel it reads and the weights.
struct Contributions {
    std::vector<int> first;
    std::vector<int> count;
    std::vector<float> weights;  // count[i] weights per output pixel, packed with stride `stride`
    int stride = 0;
};

Contributions computeContributions(int sourceSize, int targetSize) {
    const double scale = static_cast<double>(targetSize) / sourceSize;
    // When shrinking, stretch the filter so every source pixel contributes (no aliasing).
    const double filterScale = std::max(1.0, 1.0 / scale);
    const double support = kLobes * filterScale;

    Contributions c;
    c.stride = static_cast<int>(std::ceil(support * 2.0)) + 2;
    c.first.resize(targetSize);
    c.count.resize(targetSize);
    c.weights.assign(static_cast<std::size_t>(targetSize) * c.stride, 0.0f);

    for (int i = 0; i < targetSize; ++i) {
        const double center = (i + 0.5) / scale;
        const int start = std::max(0, static_cast<int>(std::floor(center - support)));
        const int end = std::min(sourceSize, static_cast<int>(std::ceil(center + support)));
        double total = 0.0;
        int n = 0;
        std::vector<double> local;
        for (int j = start; j < end && n < c.stride; ++j, ++n) {
            const double w = lanczos((j + 0.5 - center) / filterScale);
            local.push_back(w);
            total += w;
        }
        c.first[i] = start;
        c.count[i] = n;
        for (int k = 0; k < n; ++k) {
            c.weights[static_cast<std::size_t>(i) * c.stride + k] = static_cast<float>(total != 0.0 ? local[k] / total : 0.0);
        }
    }
    return c;
}

}  // namespace

Image resize(const Image& source, int width, int height) {
    if (source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) {
        throw std::invalid_argument("resize: sizes must be positive");
    }
    if (width == source.width && height == source.height) return source;

    const auto& lin = toLinearTable();
    const int sw = source.width;
    const int sh = source.height;

    // Horizontal pass: sw x sh -> width x sh. Each source row is converted to linear,
    // premultiplied floats just before it's used, so the full-size image never needs a float
    // copy (that would be 16 bytes per pixel, about 380 MB for a 24-megapixel photo).
    const Contributions h = computeContributions(sw, width);
    std::vector<float> mid(static_cast<std::size_t>(width) * sh * 4);
    std::vector<float> rowBuffer(static_cast<std::size_t>(sw) * 4);
    for (int y = 0; y < sh; ++y) {
        const std::uint8_t* px = source.pixel(0, y);
        for (int x = 0; x < sw; ++x, px += 4) {
            const float a = px[3] / 255.0f;
            rowBuffer[x * 4 + 0] = lin[px[0]] * a;
            rowBuffer[x * 4 + 1] = lin[px[1]] * a;
            rowBuffer[x * 4 + 2] = lin[px[2]] * a;
            rowBuffer[x * 4 + 3] = a;
        }
        const float* row = rowBuffer.data();
        float* out = &mid[static_cast<std::size_t>(y) * width * 4];
        for (int x = 0; x < width; ++x) {
            float acc[4] = {0, 0, 0, 0};
            const float* w = &h.weights[static_cast<std::size_t>(x) * h.stride];
            const float* in = row + static_cast<std::size_t>(h.first[x]) * 4;
            for (int k = 0; k < h.count[x]; ++k, in += 4) {
                acc[0] += in[0] * w[k];
                acc[1] += in[1] * w[k];
                acc[2] += in[2] * w[k];
                acc[3] += in[3] * w[k];
            }
            out[x * 4 + 0] = acc[0];
            out[x * 4 + 1] = acc[1];
            out[x * 4 + 2] = acc[2];
            out[x * 4 + 3] = acc[3];
        }
    }

    // Vertical pass: width x sh -> width x height, converting back to 8-bit sRGB.
    const Contributions v = computeContributions(sh, height);
    Image result(width, height);
    std::vector<float> acc(static_cast<std::size_t>(width) * 4);
    for (int y = 0; y < height; ++y) {
        std::fill(acc.begin(), acc.end(), 0.0f);
        const float* w = &v.weights[static_cast<std::size_t>(y) * v.stride];
        for (int k = 0; k < v.count[y]; ++k) {
            const float* row = &mid[static_cast<std::size_t>(v.first[y] + k) * width * 4];
            const float wk = w[k];
            for (int i = 0; i < width * 4; ++i) acc[i] += row[i] * wk;
        }
        std::uint8_t* out = result.pixel(0, y);
        for (int x = 0; x < width; ++x) {
            // Lanczos can overshoot slightly past 0 and 1; clamp before un-premultiplying.
            const float a = std::clamp(acc[x * 4 + 3], 0.0f, 1.0f);
            if (a <= 0.0f) {
                out[x * 4 + 0] = out[x * 4 + 1] = out[x * 4 + 2] = out[x * 4 + 3] = 0;
                continue;
            }
            out[x * 4 + 0] = linearToSrgb(acc[x * 4 + 0] / a);
            out[x * 4 + 1] = linearToSrgb(acc[x * 4 + 1] / a);
            out[x * 4 + 2] = linearToSrgb(acc[x * 4 + 2] / a);
            out[x * 4 + 3] = static_cast<std::uint8_t>(std::lround(a * 255.0f));
        }
    }
    return result;
}

}  // namespace imgshrink
