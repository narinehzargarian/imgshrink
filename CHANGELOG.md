# Changelog

## 0.1.0 (2026-11-02)

First release.

- Resize to a longest side with a Lanczos3 filter in linear light, with premultiplied alpha.
- Save as JPEG (progressive, optimized Huffman tables), PNG, or PNG with fewer colors (median cut, k-means refinement, optional Floyd-Steinberg dithering).
- Batches processed in parallel background workers, with a zip download.
- Phone photos rotated upright from their EXIF orientation.
- Offers the original when re-saving wouldn't make it smaller.
- Works offline after the first visit.
