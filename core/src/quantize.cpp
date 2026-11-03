#include "imgshrink/quantize.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace imgshrink {
namespace {

// One distinct color from the image (after light rounding), with how often it appears.
struct Entry {
    double sum[4] = {0, 0, 0, 0};  // sums of the exact colors that rounded to this entry
    double count = 0;
    double value(int channel) const { return sum[channel] / count; }
};

// A box in color space, holding a range of entries for median cut.
struct Box {
    int begin = 0;
    int end = 0;
    double count = 0;
    int widest = 0;      // channel with the largest spread
    double spread = 0;   // that spread, weighted by how many pixels the box covers
};

void measure(Box& box, const std::vector<Entry>& entries) {
    double lo[4], hi[4];
    std::fill(lo, lo + 4, std::numeric_limits<double>::max());
    std::fill(hi, hi + 4, std::numeric_limits<double>::lowest());
    box.count = 0;
    for (int i = box.begin; i < box.end; ++i) {
        box.count += entries[i].count;
        for (int c = 0; c < 4; ++c) {
            lo[c] = std::min(lo[c], entries[i].value(c));
            hi[c] = std::max(hi[c], entries[i].value(c));
        }
    }
    box.widest = 0;
    double best = -1;
    for (int c = 0; c < 4; ++c) {
        if (hi[c] - lo[c] > best) {
            best = hi[c] - lo[c];
            box.widest = c;
        }
    }
    // Weighting by count splits the boxes that cover the most pixels first, so large areas of
    // the image get accurate colors before rare ones do.
    box.spread = (box.end - box.begin) > 1 ? best * box.count : -1;
}

double distance(const double a[4], const Color& b) {
    double d = 0;
    for (int c = 0; c < 4; ++c) {
        const double diff = a[c] - b[c];
        d += diff * diff;
    }
    return d;
}

int nearest(const std::vector<Color>& palette, const double color[4]) {
    int best = 0;
    double bestDistance = std::numeric_limits<double>::max();
    for (int i = 0; i < static_cast<int>(palette.size()); ++i) {
        const double d = distance(color, palette[i]);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    }
    return best;
}

std::uint8_t toByte(double v) {
    return static_cast<std::uint8_t>(std::clamp(v + 0.5, 0.0, 255.0));
}

}  // namespace

PalettedImage quantize(const Image& image, int maxColors, bool dither) {
    if (maxColors < 2 || maxColors > 256) throw std::invalid_argument("quantize: maxColors must be 2 to 256");
    const std::size_t pixels = static_cast<std::size_t>(image.width) * image.height;

    // Histogram. Colors are rounded to 6 bits per channel so similar colors share an entry,
    // which keeps median cut fast on large photos; each entry keeps the exact average.
    std::unordered_map<std::uint32_t, int> index;
    std::vector<Entry> entries;
    index.reserve(1 << 16);
    for (std::size_t p = 0; p < pixels; ++p) {
        const std::uint8_t* px = &image.rgba[p * 4];
        // Fully transparent pixels all look the same, whatever their color values.
        const bool clear = px[3] == 0;
        const std::uint32_t key = clear ? 0xFFFFFFFFu
                                        : (static_cast<std::uint32_t>(px[0] >> 2) << 18) | (static_cast<std::uint32_t>(px[1] >> 2) << 12) |
                                              (static_cast<std::uint32_t>(px[2] >> 2) << 6) | static_cast<std::uint32_t>(px[3] >> 2);
        auto [it, inserted] = index.try_emplace(key, static_cast<int>(entries.size()));
        if (inserted) entries.emplace_back();
        Entry& e = entries[it->second];
        if (!clear) {
            for (int c = 0; c < 4; ++c) e.sum[c] += px[c];
        }
        e.count += 1;
    }

    PalettedImage out;
    out.width = image.width;
    out.height = image.height;

    // Median cut: repeatedly split the box with the widest weighted spread at its median pixel.
    std::vector<Box> boxes;
    if (!entries.empty()) {
        Box all;
        all.begin = 0;
        all.end = static_cast<int>(entries.size());
        measure(all, entries);
        boxes.push_back(all);
    }
    while (static_cast<int>(boxes.size()) < maxColors) {
        auto widest = std::max_element(boxes.begin(), boxes.end(), [](const Box& a, const Box& b) { return a.spread < b.spread; });
        if (widest == boxes.end() || widest->spread < 0) break;  // every box is a single color
        Box box = *widest;
        const int channel = box.widest;
        std::sort(entries.begin() + box.begin, entries.begin() + box.end,
                  [channel](const Entry& a, const Entry& b) { return a.value(channel) < b.value(channel); });
        double half = box.count / 2, seen = 0;
        int split = box.begin;
        while (split < box.end - 1 && seen + entries[split].count <= half) seen += entries[split++].count;
        if (split == box.begin) ++split;
        Box left = box, right = box;
        left.end = split;
        right.begin = split;
        measure(left, entries);
        measure(right, entries);
        *widest = left;
        boxes.push_back(right);
    }

    for (const Box& box : boxes) {
        double sum[4] = {0, 0, 0, 0};
        for (int i = box.begin; i < box.end; ++i) {
            for (int c = 0; c < 4; ++c) sum[c] += entries[i].sum[c];
        }
        out.palette.push_back({toByte(sum[0] / box.count), toByte(sum[1] / box.count), toByte(sum[2] / box.count), toByte(sum[3] / box.count)});
    }
    if (out.palette.empty()) out.palette.push_back({0, 0, 0, 0});

    // K-means refinement on the histogram: move each palette color to the average of the
    // entries closest to it. Median cut gets close; this fixes colors that straddled a split.
    for (int round = 0; round < 4; ++round) {
        std::vector<std::array<double, 5>> totals(out.palette.size(), {0, 0, 0, 0, 0});
        for (const Entry& e : entries) {
            double color[4];
            for (int c = 0; c < 4; ++c) color[c] = e.value(c);
            auto& t = totals[nearest(out.palette, color)];
            for (int c = 0; c < 4; ++c) t[c] += e.sum[c];
            t[4] += e.count;
        }
        for (std::size_t i = 0; i < out.palette.size(); ++i) {
            if (totals[i][4] > 0) {
                for (int c = 0; c < 4; ++c) out.palette[i][c] = toByte(totals[i][c] / totals[i][4]);
            }
        }
    }

    // Map every pixel to its nearest palette color. A cache keyed on the rounded color avoids
    // searching the whole palette for each of millions of pixels.
    out.indices.resize(pixels);
    std::unordered_map<std::uint32_t, std::uint8_t> cache;
    cache.reserve(1 << 15);
    auto lookup = [&](const double color[4]) -> std::uint8_t {
        std::uint8_t q[4];
        for (int c = 0; c < 4; ++c) q[c] = toByte(color[c]);
        if (q[3] == 0) q[0] = q[1] = q[2] = 0;
        const std::uint32_t key = (static_cast<std::uint32_t>(q[0]) << 24) | (static_cast<std::uint32_t>(q[1]) << 16) |
                                  (static_cast<std::uint32_t>(q[2]) << 8) | q[3];
        auto it = cache.find(key);
        if (it != cache.end()) return it->second;
        const double exact[4] = {static_cast<double>(q[0]), static_cast<double>(q[1]), static_cast<double>(q[2]), static_cast<double>(q[3])};
        const auto i = static_cast<std::uint8_t>(nearest(out.palette, exact));
        cache.emplace(key, i);
        return i;
    };

    if (!dither) {
        for (std::size_t p = 0; p < pixels; ++p) {
            const std::uint8_t* px = &image.rgba[p * 4];
            const double color[4] = {static_cast<double>(px[0]), static_cast<double>(px[1]), static_cast<double>(px[2]), static_cast<double>(px[3])};
            out.indices[p] = lookup(color);
        }
        return out;
    }

    // Floyd-Steinberg: push each pixel's rounding error onto the pixels to its right and below.
    const int w = image.width;
    std::vector<double> errCurrent(static_cast<std::size_t>(w + 2) * 4, 0.0);
    std::vector<double> errNext(static_cast<std::size_t>(w + 2) * 4, 0.0);
    for (int y = 0; y < image.height; ++y) {
        std::fill(errNext.begin(), errNext.end(), 0.0);
        for (int x = 0; x < w; ++x) {
            const std::uint8_t* px = image.pixel(x, y);
            double color[4];
            for (int c = 0; c < 4; ++c) color[c] = std::clamp(px[c] + errCurrent[(x + 1) * 4 + c], 0.0, 255.0);
            const std::uint8_t i = lookup(color);
            out.indices[static_cast<std::size_t>(y) * w + x] = i;
            for (int c = 0; c < 4; ++c) {
                // Damped slightly, which avoids speckle in flat areas.
                const double err = (color[c] - out.palette[i][c]) * 0.9;
                errCurrent[(x + 2) * 4 + c] += err * 7.0 / 16.0;
                errNext[(x + 0) * 4 + c] += err * 3.0 / 16.0;
                errNext[(x + 1) * 4 + c] += err * 5.0 / 16.0;
                errNext[(x + 2) * 4 + c] += err * 1.0 / 16.0;
            }
        }
        std::swap(errCurrent, errNext);
    }
    return out;
}

Image expand(const PalettedImage& image) {
    Image out(image.width, image.height);
    for (std::size_t p = 0; p < image.indices.size(); ++p) {
        const Color& c = image.palette.at(image.indices[p]);
        std::copy(c.begin(), c.end(), &out.rgba[p * 4]);
    }
    return out;
}

}  // namespace imgshrink
