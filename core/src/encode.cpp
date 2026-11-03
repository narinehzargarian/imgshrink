#include "imgshrink/encode.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <vector>

#include <jpeglib.h>
#include <png.h>

namespace imgshrink {
namespace {

// libjpeg reports errors through a callback that must not return; turn them into exceptions.
[[noreturn]] void jpegError(j_common_ptr info) {
    char message[JMSG_LENGTH_MAX];
    (*info->err->format_message)(info, message);
    throw std::runtime_error(std::string("JPEG encoding failed: ") + message);
}

// Writes the JPEG into a growing buffer instead of a file.
struct JpegBuffer {
    jpeg_destination_mgr manager{};
    Bytes* out = nullptr;
    std::vector<JOCTET> chunk = std::vector<JOCTET>(64 * 1024);
};

void jpegInit(j_compress_ptr cinfo) {
    auto* buffer = reinterpret_cast<JpegBuffer*>(cinfo->dest);
    buffer->manager.next_output_byte = buffer->chunk.data();
    buffer->manager.free_in_buffer = buffer->chunk.size();
}

boolean jpegEmpty(j_compress_ptr cinfo) {
    auto* buffer = reinterpret_cast<JpegBuffer*>(cinfo->dest);
    buffer->out->insert(buffer->out->end(), buffer->chunk.begin(), buffer->chunk.end());
    buffer->manager.next_output_byte = buffer->chunk.data();
    buffer->manager.free_in_buffer = buffer->chunk.size();
    return TRUE;
}

void jpegTerm(j_compress_ptr cinfo) {
    auto* buffer = reinterpret_cast<JpegBuffer*>(cinfo->dest);
    const std::size_t used = buffer->chunk.size() - buffer->manager.free_in_buffer;
    buffer->out->insert(buffer->out->end(), buffer->chunk.begin(), buffer->chunk.begin() + used);
}

[[noreturn]] void pngError(png_structp, png_const_charp message) {
    throw std::runtime_error(std::string("PNG encoding failed: ") + message);
}

void pngWarning(png_structp, png_const_charp) {}

void pngWrite(png_structp png, png_bytep data, png_size_t length) {
    auto* out = static_cast<Bytes*>(png_get_io_ptr(png));
    out->insert(out->end(), data, data + length);
}

void pngFlush(png_structp) {}

// Owns libpng's structures so they're freed even when an error throws.
struct PngWriter {
    png_structp png = nullptr;
    png_infop info = nullptr;
    Bytes out;

    PngWriter() {
        png = png_create_write_struct(PNG_LIBPNG_VER_STRING, nullptr, pngError, pngWarning);
        if (!png) throw std::runtime_error("PNG encoding failed: out of memory");
        info = png_create_info_struct(png);
        if (!info) {
            png_destroy_write_struct(&png, nullptr);
            throw std::runtime_error("PNG encoding failed: out of memory");
        }
        png_set_write_fn(png, &out, pngWrite, pngFlush);
        png_set_compression_level(png, 9);
    }
    ~PngWriter() { png_destroy_write_struct(&png, &info); }
    PngWriter(const PngWriter&) = delete;
    PngWriter& operator=(const PngWriter&) = delete;

    void writeRows(const std::uint8_t* data, int height, std::size_t stride) {
        png_write_info(png, info);
        for (int y = 0; y < height; ++y) png_write_row(png, const_cast<png_bytep>(data + static_cast<std::size_t>(y) * stride));
        png_write_end(png, info);
    }
};

}  // namespace

Bytes encodeJpeg(const Image& image, const JpegOptions& options) {
    if (image.width <= 0 || image.height <= 0) throw std::invalid_argument("encodeJpeg: empty image");
    if (options.quality < 1 || options.quality > 100) throw std::invalid_argument("encodeJpeg: quality must be 1 to 100");

    // Blend onto the background, since JPEG can't store transparency.
    std::vector<std::uint8_t> rgb(static_cast<std::size_t>(image.width) * image.height * 3);
    for (std::size_t p = 0, n = static_cast<std::size_t>(image.width) * image.height; p < n; ++p) {
        const std::uint8_t* px = &image.rgba[p * 4];
        const unsigned a = px[3];
        for (int c = 0; c < 3; ++c) {
            rgb[p * 3 + c] = static_cast<std::uint8_t>((px[c] * a + options.background[c] * (255 - a) + 127) / 255);
        }
    }

    jpeg_compress_struct cinfo{};
    jpeg_error_mgr jerr{};
    cinfo.err = jpeg_std_error(&jerr);
    jerr.error_exit = jpegError;
    Bytes out;
    JpegBuffer buffer;
    buffer.out = &out;
    try {
        jpeg_create_compress(&cinfo);
        buffer.manager.init_destination = jpegInit;
        buffer.manager.empty_output_buffer = jpegEmpty;
        buffer.manager.term_destination = jpegTerm;
        cinfo.dest = &buffer.manager;
        cinfo.image_width = static_cast<JDIMENSION>(image.width);
        cinfo.image_height = static_cast<JDIMENSION>(image.height);
        cinfo.input_components = 3;
        cinfo.in_color_space = JCS_RGB;
        jpeg_set_defaults(&cinfo);
        jpeg_set_quality(&cinfo, options.quality, TRUE);
        cinfo.optimize_coding = TRUE;
        if (options.progressive) jpeg_simple_progression(&cinfo);
        jpeg_start_compress(&cinfo, TRUE);
        while (cinfo.next_scanline < cinfo.image_height) {
            JSAMPROW row = &rgb[static_cast<std::size_t>(cinfo.next_scanline) * image.width * 3];
            jpeg_write_scanlines(&cinfo, &row, 1);
        }
        jpeg_finish_compress(&cinfo);
        jpeg_destroy_compress(&cinfo);
    } catch (...) {
        jpeg_destroy_compress(&cinfo);
        throw;
    }
    return out;
}

Bytes encodePng(const Image& image) {
    if (image.width <= 0 || image.height <= 0) throw std::invalid_argument("encodePng: empty image");
    PngWriter writer;
    // A PNG without any transparency can drop the alpha channel, saving a quarter of the data.
    bool opaque = true;
    for (std::size_t p = 3; p < image.rgba.size(); p += 4) {
        if (image.rgba[p] != 255) {
            opaque = false;
            break;
        }
    }
    if (opaque) {
        std::vector<std::uint8_t> rgb(static_cast<std::size_t>(image.width) * image.height * 3);
        for (std::size_t p = 0, n = static_cast<std::size_t>(image.width) * image.height; p < n; ++p) {
            std::memcpy(&rgb[p * 3], &image.rgba[p * 4], 3);
        }
        png_set_IHDR(writer.png, writer.info, image.width, image.height, 8, PNG_COLOR_TYPE_RGB, PNG_INTERLACE_NONE,
                     PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
        writer.writeRows(rgb.data(), image.height, static_cast<std::size_t>(image.width) * 3);
    } else {
        png_set_IHDR(writer.png, writer.info, image.width, image.height, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE,
                     PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
        writer.writeRows(image.rgba.data(), image.height, static_cast<std::size_t>(image.width) * 4);
    }
    return std::move(writer.out);
}

Bytes encodePalettePng(const PalettedImage& image) {
    if (image.width <= 0 || image.height <= 0) throw std::invalid_argument("encodePalettePng: empty image");
    if (image.palette.empty() || image.palette.size() > 256) throw std::invalid_argument("encodePalettePng: palette must have 1 to 256 colors");

    // Fewer colors fit in fewer bits per pixel: 2 colors need 1 bit, 16 need 4.
    const std::size_t colors = image.palette.size();
    const int depth = colors <= 2 ? 1 : colors <= 4 ? 2 : colors <= 16 ? 4 : 8;

    // PNG stores transparency for palette entries in order, so put transparent ones first and
    // the trailing opaque ones need no entry.
    std::vector<int> order(colors);
    for (std::size_t i = 0; i < colors; ++i) order[i] = static_cast<int>(i);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return (image.palette[a][3] < 255) > (image.palette[b][3] < 255); });
    std::vector<int> remap(colors);
    std::vector<png_color> palette(colors);
    std::vector<png_byte> alpha;
    for (std::size_t i = 0; i < colors; ++i) {
        const Color& c = image.palette[order[i]];
        remap[order[i]] = static_cast<int>(i);
        palette[i] = {c[0], c[1], c[2]};
        if (c[3] < 255) alpha.push_back(c[3]);
    }

    PngWriter writer;
    png_set_IHDR(writer.png, writer.info, image.width, image.height, depth, PNG_COLOR_TYPE_PALETTE, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_set_PLTE(writer.png, writer.info, palette.data(), static_cast<int>(colors));
    if (!alpha.empty()) png_set_tRNS(writer.png, writer.info, alpha.data(), static_cast<int>(alpha.size()), nullptr);

    // Pack indices into rows at the chosen bit depth.
    const std::size_t stride = (static_cast<std::size_t>(image.width) * depth + 7) / 8;
    std::vector<std::uint8_t> rows(stride * image.height, 0);
    const int perByte = 8 / depth;
    for (int y = 0; y < image.height; ++y) {
        std::uint8_t* row = &rows[static_cast<std::size_t>(y) * stride];
        for (int x = 0; x < image.width; ++x) {
            const int index = remap[image.indices[static_cast<std::size_t>(y) * image.width + x]];
            const int shift = 8 - depth * (x % perByte + 1);
            row[x / perByte] |= static_cast<std::uint8_t>(index << shift);
        }
    }
    writer.writeRows(rows.data(), image.height, stride);
    return std::move(writer.out);
}

}  // namespace imgshrink
